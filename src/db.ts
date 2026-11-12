// One SQL schema, two drivers. SQLite (node:sqlite) for local runs, tests and a clean clone; PostgreSQL for the hosted
// demo, where Render's web-service disk is ephemeral. Statements use `?` placeholders; the PostgreSQL driver rewrites
// them to $1..$n. Every mutation runs in a transaction that first locks the session row, so writes, forgetting,
// retrieval and simulated actions on one session are serialised (invariant 5, docs/ARCHITECTURE-DECISIONS.md).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export interface Q {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<number>;
}
export interface Db {
  readonly kind: 'sqlite' | 'postgres';
  /** Run `fn` in one transaction. With `lock`, the session row is locked first (FOR UPDATE on PostgreSQL). */
  tx<T>(lock: string | null, fn: (q: Q) => Promise<T>): Promise<T>;
  /** After a purge: make deleted bytes unrecoverable from files this process controls (see PRIVACY-AND-FORGETTING.md). */
  compact(): Promise<string>;
  close(): Promise<void>;
}

export const DDL = `
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created BIGINT NOT NULL, last_active BIGINT NOT NULL,
  clock BIGINT NOT NULL, revision BIGINT NOT NULL DEFAULT 0, audit_seq BIGINT NOT NULL DEFAULT 0, ev_seq BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS evidence (session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, id TEXT NOT NULL,
  subject TEXT NOT NULL, predicate TEXT NOT NULL, scope_key TEXT NOT NULL, value TEXT NOT NULL, stance TEXT NOT NULL,
  source_kind TEXT NOT NULL, channel TEXT NOT NULL, source_label TEXT NOT NULL, lineage TEXT NOT NULL, origin_id TEXT NOT NULL,
  excerpt TEXT NOT NULL, observed_at BIGINT NOT NULL, ingested_at BIGINT NOT NULL, valid_from BIGINT, valid_until BIGINT,
  corrects INTEGER NOT NULL, seq BIGINT NOT NULL, PRIMARY KEY (session, id), UNIQUE (session, origin_id));
CREATE TABLE IF NOT EXISTS memory_index (session TEXT NOT NULL, evidence_id TEXT NOT NULL, term TEXT NOT NULL,
  FOREIGN KEY (session, evidence_id) REFERENCES evidence(session, id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS memory_index_term ON memory_index (session, term);
CREATE INDEX IF NOT EXISTS memory_index_ev ON memory_index (session, evidence_id);
CREATE TABLE IF NOT EXISTS summaries (session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, subject TEXT NOT NULL,
  revision BIGINT NOT NULL, text TEXT NOT NULL, deps TEXT NOT NULL, PRIMARY KEY (session, subject));
CREATE TABLE IF NOT EXISTS uses (session TEXT NOT NULL, evidence_id TEXT NOT NULL, task TEXT NOT NULL, at BIGINT NOT NULL,
  outcome TEXT NOT NULL, FOREIGN KEY (session, evidence_id) REFERENCES evidence(session, id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS uses_ev ON uses (session, evidence_id);
CREATE TABLE IF NOT EXISTS bookings (session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, id TEXT NOT NULL,
  task TEXT NOT NULL, idem TEXT NOT NULL, slot_start BIGINT NOT NULL, slot_end BIGINT NOT NULL, place TEXT NOT NULL,
  window_label TEXT NOT NULL, evidence_ids TEXT NOT NULL, reason TEXT NOT NULL, parts TEXT NOT NULL, booked_at BIGINT NOT NULL,
  PRIMARY KEY (session, id), UNIQUE (session, idem));
CREATE TABLE IF NOT EXISTS tombstones (session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, subject TEXT NOT NULL,
  predicate TEXT NOT NULL, mode TEXT NOT NULL, revoked_at BIGINT NOT NULL, revision BIGINT NOT NULL,
  PRIMARY KEY (session, subject, predicate));
CREATE TABLE IF NOT EXISTS receipts (session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, id TEXT NOT NULL,
  at BIGINT NOT NULL, real_at BIGINT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (session, id));
CREATE TABLE IF NOT EXISTS audit (session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq BIGINT NOT NULL,
  at BIGINT NOT NULL, real_at BIGINT NOT NULL, op TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY (session, seq));
`;
/** A dependency that matches every forget. Bookings written before reasons were tracked per part get it, so the
 *  first forget or retention purge rewrites their explanation instead of leaving untracked text behind. */
export const LEGACY_DEP = '*legacy*';
export const legacyParts = (windowLabel: string, reason: string) =>
  JSON.stringify([{ key: 'window', text: windowLabel, deps: [LEGACY_DEP] }, { key: 'legacy', text: reason, deps: [LEGACY_DEP] }]);
type LegacyRow = { session: string; id: string; window_label: string; reason: string };
const BACKFILL_SELECT = "SELECT session, id, window_label, reason FROM bookings WHERE parts = ''";
const BACKFILL_UPDATE = 'UPDATE bookings SET parts = ? WHERE session = ? AND id = ?';

/** Every table that can hold session data, for verification scans. */
export const TABLES = ['evidence', 'memory_index', 'summaries', 'uses', 'bookings', 'tombstones', 'receipts', 'audit'] as const;

/** BIGINT columns come back as strings from pg; normalise every numeric-looking column we know is numeric. */
const NUMERIC = new Set(['created', 'last_active', 'clock', 'revision', 'audit_seq', 'observed_at', 'ingested_at', 'valid_from', 'valid_until', 'corrects', 'at', 'real_at', 'slot_start', 'slot_end', 'booked_at', 'revoked_at', 'seq', 'ev_seq', 'n']);
function norm<T>(rows: Record<string, unknown>[]): T[] {
  for (const r of rows) for (const k in r) if (NUMERIC.has(k) && r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]);
  return rows as T[];
}

export class SqliteDb implements Db {
  readonly kind = 'sqlite' as const;
  private db: DatabaseSync;
  private chain: Promise<unknown> = Promise.resolve(); // one transaction at a time on the single connection
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');
    this.db.exec(DDL);
    // Migration: databases created before bookings.parts existed. Runs before any request is served.
    const cols = this.db.prepare('PRAGMA table_info(bookings)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'parts')) this.db.exec("ALTER TABLE bookings ADD COLUMN parts TEXT NOT NULL DEFAULT ''");
    for (const r of this.db.prepare(BACKFILL_SELECT).all() as LegacyRow[]) this.db.prepare(BACKFILL_UPDATE).run(legacyParts(r.window_label, r.reason), r.session, r.id);
  }
  tx<T>(_lock: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    const run = async () => {
      const db = this.db;
      const q: Q = {
        all: async <R>(sql: string, p: unknown[] = []) => norm<R>(db.prepare(sql).all(...(p as any[])) as Record<string, unknown>[]),
        run: async (sql: string, p: unknown[] = []) => Number(db.prepare(sql).run(...(p as any[])).changes),
      };
      db.exec('BEGIN IMMEDIATE');
      try { const r = await fn(q); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
  /** secure_delete already zeroes freed cells; TRUNCATE checkpoints the WAL into the main file and empties it, so old
   *  page images (which still hold pre-delete content) do not linger in caveat.db-wal. */
  compact() {
    const run = async () => { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); return 'sqlite: secure_delete + WAL checkpoint(TRUNCATE)'; };
    const p = this.chain.then(run, run); this.chain = p.catch(() => {}); return p;
  }
  async close() { await this.chain; this.db.close(); }
}

export class PgDb implements Db {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;
  private constructor(pool: pg.Pool) { this.pool = pool; }
  static async open(url: string, schema = 'caveat') {
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('bad schema name');
    const pool = new pg.Pool({ connectionString: url, max: 5, ssl: /sslmode=require|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined });
    pool.on('connect', (c) => { c.query(`SET search_path TO ${schema}`).catch(() => {}); });
    const c = await pool.connect();
    try { await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`); await c.query(`SET search_path TO ${schema}`); await c.query(DDL);
      // Migration: databases created before bookings.parts existed. Runs before any request is served.
      await c.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS parts TEXT NOT NULL DEFAULT ''");
      for (const r of (await c.query(BACKFILL_SELECT)).rows as LegacyRow[]) await c.query('UPDATE bookings SET parts = $1 WHERE session = $2 AND id = $3', [legacyParts(r.window_label, r.reason), r.session, r.id]);
    } finally { c.release(); }
    return new PgDb(pool);
  }
  async tx<T>(lock: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    const conv = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
    const q: Q = {
      all: async <R>(sql: string, p: unknown[] = []) => norm<R>((await c.query(conv(sql), p)).rows),
      run: async (sql: string, p: unknown[] = []) => (await c.query(conv(sql), p)).rowCount ?? 0,
    };
    try {
      await c.query('BEGIN');
      if (lock) await c.query('SELECT 1 FROM sessions WHERE id = $1 FOR UPDATE', [lock]);
      const r = await fn(q);
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  /** PostgreSQL: deleted tuples are invisible at once; VACUUM later reclaims them. Provider WAL/backups are out of reach. */
  async compact() { return 'postgres: rows deleted; space reclaimed by autovacuum; provider WAL and backups not controllable'; }
  async close() { await this.pool.end(); }
}

export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return PgDb.open(url, process.env.CAVEAT_PG_SCHEMA ?? 'caveat');
  return new SqliteDb(process.env.CAVEAT_DB ?? 'data/caveat.db');
}
