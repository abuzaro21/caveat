// Test harness: the same suites run on SQLite (default) and on PostgreSQL when CAVEAT_TEST_DATABASE_URL is set.
import { randomBytes } from 'node:crypto';
import { SqliteDb, PgDb, type Db } from '../src/db.ts';
import { Caveat } from '../src/memory.ts';
import { DAY, scopeKey, type Evidence, type PredicateId, type Scope, type SourceKind, type Stance, type SubjectId } from '../src/model.ts';
import { START } from '../src/seed.ts';

export const SECRET = 'test-secret-0123456789abcdef';
export const PG_URL = process.env.CAVEAT_TEST_DATABASE_URL;
export const STORE = PG_URL ? 'postgres' : 'sqlite';

const open: Db[] = [];
export async function makeDb(): Promise<Db> {
  const db = PG_URL ? await PgDb.open(PG_URL, `t_${randomBytes(4).toString('hex')}`) : new SqliteDb(':memory:');
  open.push(db); return db;
}
export async function makeCaveat() {
  const c = new Caveat(await makeDb(), SECRET);
  const { sid, token } = await c.createSession();
  return { c, sid, token };
}
export async function closeAll() { while (open.length) await open.pop()!.close().catch(() => {}); }

let n = 0;
/** Build an Evidence record for pure policy tests. */
export function ev(p: Partial<Evidence> & { predicate: PredicateId; value: unknown; sourceKind: SourceKind; daysAgo: number; scope?: Scope; subject?: SubjectId; stance?: Stance }): Evidence {
  const t = START - p.daysAgo * DAY;
  return {
    id: p.id ?? `e${++n}`, subject: p.subject ?? 'maya', predicate: p.predicate, scopeKey: scopeKey(p.predicate, p.scope), value: p.value, stance: p.stance ?? 'supports',
    sourceKind: p.sourceKind, channel: 'test', sourceLabel: p.sourceLabel ?? p.sourceKind, lineage: p.lineage ?? `src:${n}`, originId: `o${n}`, excerpt: p.excerpt ?? '',
    observedAt: t, ingestedAt: t, validFrom: p.validFrom ?? null, validUntil: p.validUntil ?? null, corrects: p.corrects ?? p.sourceKind === 'user_correction', seq: n,
  };
}
export const q = (predicate: PredicateId, purpose: 'advice' | 'action' | 'inspection' = 'action', scope?: Scope, extra: Record<string, unknown> = {}) =>
  ({ actor: 'maya' as const, subject: 'maya' as const, predicate, scope, purpose, consentPurpose: 'delivery-planning', now: START, ...extra });
