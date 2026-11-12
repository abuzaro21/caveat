// The memory service: write path, retrieval, the forgetting coordinator, retention, import/export and the delayed
// worker. Every operation is scoped to one session (a synthetic household); every mutation locks that session row.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { LEGACY_DEP, type Db, type Q } from './db.ts';
import {
  DAY, PREDICATES, SUBJECTS, isPredicate, scopeKey, validateValue, valueLabel,
  type Evidence, type PredicateId, type Purpose, type Scope, type SourceKind, type Stance, type SubjectId,
} from './model.ts';
import { evaluate, type Decision, type Tombstone } from './policy.ts';
import { SEED, START } from './seed.ts';
import { plan, isTask, TASKS, type Plan, type TaskId } from './tasks.ts';

export class NotFound extends Error {}
export class Rejected extends Error { status = 400; }
export class Blocked extends Error { status = 409; plan: Plan; constructor(p: Plan) { super('memory does not permit this action'); this.plan = p; } }

export const LIMITS = { evidencePerSession: 200, importItems: 50, excerpt: 280, label: 60, maxClockDays: 365 * 3 };

export type IngestItem = {
  subject: SubjectId; predicate: PredicateId; scope?: Scope; value: unknown; stance?: Stance;
  sourceLabel?: string; lineage?: string; originId?: string; excerpt?: string;
  observedAt?: number; validFrom?: number | null; validUntil?: number | null; sourceKind?: SourceKind;
};
export type IngestResult = { index: number; status: 'stored' | 'duplicate' | 'rejected'; reason?: string; id?: string };

type Row = Record<string, any>;
const toEvidence = (r: Row): Evidence => ({
  id: r.id, subject: r.subject, predicate: r.predicate, scopeKey: r.scope_key, value: JSON.parse(r.value), stance: r.stance,
  sourceKind: r.source_kind, channel: r.channel, sourceLabel: r.source_label, lineage: r.lineage, originId: r.origin_id,
  excerpt: r.excerpt, observedAt: r.observed_at, ingestedAt: r.ingested_at, validFrom: r.valid_from ?? null, validUntil: r.valid_until ?? null, corrects: !!r.corrects, seq: r.seq,
});
const rid = (p: string) => `${p}_${randomBytes(6).toString('hex')}`;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'you', 'your', 'with', 'from', 'that', 'this', 'have', 'not', 'all', 'any', 'nobody', 'please', 'might', 'always', 'never', 'most', 'some', 'what', 'when', 'where', 'which', 'should', 'about', 'there', 'they', 'then', 'into', 'than']);
const SYN: Record<string, string> = { deliver: 'delivery', parcel: 'delivery', package: 'delivery', courier: 'delivery', live: 'city', work: 'office', clinic: 'physio', appointment: 'private' };
export function terms(text: string): string[] {
  const out = new Set<string>();
  for (let w of text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
    if (w.length < 3) continue;
    if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y'; else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
    w = SYN[w] ?? w;
    if (!STOP.has(w)) out.add(w);
  }
  return [...out].slice(0, 40);
}
const indexTerms = (e: Pick<Evidence, 'predicate' | 'value' | 'excerpt' | 'scopeKey'>) =>
  terms(`${PREDICATES[e.predicate].label} ${e.predicate.replace('.', ' ')} ${valueLabel(e.predicate, e.value)} ${e.excerpt} ${e.scopeKey.replace('place=', '')}`);

/** A delayed job, as another process would hold it: identifiers and the revision it was planned against, never content. */
type WorkerJob = { id: string; baseRevision: number; evidenceIds: string[]; queuedAt: number };
/** One piece of a booking's stored explanation, with the evidence it was derived from. */
type BookingPart = { key: string; text: string; deps: string[] };
const REMOVED = '[removed: it relied on a memory you asked me to forget]';
function composeReason(parts: BookingPart[]) {
  const out: string[] = [];
  for (const x of parts) if (x.key !== 'window' && !(x.text === REMOVED && out[out.length - 1] === REMOVED)) out.push(x.text);
  return out.join(' ');
}

export type Trace = { step: string; detail: string; ms: number }[];

export class Caveat {
  readonly db: Db;
  private secret: Buffer;
  private cache = new Map<string, Decision>();   // decision cache, keyed by session + revision + clock + query
  private worker = new Map<string, WorkerJob>(); // "remote" worker inbox, one delayed digest job per session
  hooks: { beforeRead?: () => Promise<void> } = {}; // test barrier for revocation-vs-retrieval races
  constructor(db: Db, secret: string) {
    if (!secret || secret.length < 16) throw new Error('CAVEAT_SECRET must be at least 16 characters');
    this.db = db; this.secret = Buffer.from(secret);
  }
  private mac(s: string) { return createHmac('sha256', this.secret).update(s).digest('hex'); }

  // ---------- sessions ----------
  static sid(token: string) { return createHash('sha256').update(`caveat-session:${token}`).digest('hex').slice(0, 40); }
  async createSession(): Promise<{ token: string; sid: string }> {
    const token = randomBytes(24).toString('base64url');
    const sid = Caveat.sid(token);
    await this.db.tx(null, async (q) => {
      await q.run('INSERT INTO sessions (id, created, last_active, clock, revision, audit_seq) VALUES (?, ?, ?, ?, 0, 0)', [sid, Date.now(), Date.now(), START]);
      for (const s of SEED) await this.insert(q, sid, START, {
        id: rid('ev'), subject: s.subject, predicate: s.predicate, scopeKey: scopeKey(s.predicate, s.scope), value: s.value, stance: s.stance ?? 'supports',
        sourceKind: s.sourceKind, channel: s.channel, sourceLabel: s.sourceLabel, lineage: s.lineage, originId: s.originId, excerpt: s.excerpt,
        observedAt: s.observedAt, ingestedAt: s.observedAt, validFrom: s.validFrom ?? null, validUntil: s.validUntil ?? null, corrects: false,
      });
      await this.bump(q, sid, START);
      await this.refreshSummaries(q, sid, START);
      await this.audit(q, sid, START, 'session.seeded', { evidence: SEED.length });
    });
    return { token, sid };
  }
  /** Resolve a cookie token to a live session, refreshing its idle timer. */
  async resolve(token: string | undefined): Promise<string | null> {
    if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
    const sid = Caveat.sid(token);
    const n = await this.db.tx(null, (q) => q.run('UPDATE sessions SET last_active = ? WHERE id = ?', [Date.now(), sid]));
    return n === 1 ? sid : null;
  }
  async dropSession(sid: string) { this.purgeCache(sid); this.floor.delete(sid); this.worker.delete(sid); await this.db.tx(null, (q) => q.run('DELETE FROM sessions WHERE id = ?', [sid])); }
  /** Retention for whole sessions: idle demo households are deleted (rows cascade), not archived. */
  async expireSessions(idleMs: number): Promise<number> {
    const gone = await this.db.tx(null, async (q) => {
      const rows = await q.all<{ id: string }>('SELECT id FROM sessions WHERE last_active < ?', [Date.now() - idleMs]);
      for (const r of rows) await q.run('DELETE FROM sessions WHERE id = ?', [r.id]);
      return rows.map((r) => r.id);
    });
    for (const s of gone) { this.purgeCache(s); this.floor.delete(s); this.worker.delete(s); }
    return gone.length;
  }
  async sessionCount() { return (await this.db.tx(null, (q) => q.all<{ n: number }>('SELECT count(*) AS n FROM sessions')))[0].n; }

  // ---------- low-level helpers (inside a transaction) ----------
  private async session(q: Q, sid: string) {
    const r = (await q.all<{ clock: number; revision: number }>('SELECT clock, revision FROM sessions WHERE id = ?', [sid]))[0];
    if (!r) throw new NotFound('session not found');
    return r;
  }
  private async bump(q: Q, sid: string, _clock: number) { await q.run('UPDATE sessions SET revision = revision + 1 WHERE id = ?', [sid]); }
  private async audit(q: Q, sid: string, clock: number, op: string, detail: Record<string, unknown>) {
    // Audit entries are metadata only: operation, ids, predicate names and counts. Never values or excerpts.
    const seq = (await q.all<{ audit_seq: number }>('UPDATE sessions SET audit_seq = audit_seq + 1 WHERE id = ? RETURNING audit_seq', [sid]))[0].audit_seq;
    await q.run('INSERT INTO audit (session, seq, at, real_at, op, detail) VALUES (?, ?, ?, ?, ?, ?)', [sid, seq, clock, Date.now(), op, JSON.stringify(detail)]);
  }
  private async evidence(q: Q, sid: string) { return (await q.all<Row>('SELECT * FROM evidence WHERE session = ? ORDER BY observed_at, seq', [sid])).map(toEvidence); }
  private async tombstones(q: Q, sid: string): Promise<Tombstone[]> {
    return (await q.all<Row>('SELECT subject, predicate, mode, revoked_at FROM tombstones WHERE session = ?', [sid])).map((r) => ({ subject: r.subject, predicate: r.predicate, mode: r.mode, revokedAt: r.revoked_at }));
  }
  private async insert(q: Q, sid: string, _clock: number, e: Omit<Evidence, 'seq'>) {
    const seq = (await q.all<{ ev_seq: number }>('UPDATE sessions SET ev_seq = ev_seq + 1 WHERE id = ? RETURNING ev_seq', [sid]))[0].ev_seq;
    await q.run(`INSERT INTO evidence (session, id, subject, predicate, scope_key, value, stance, source_kind, channel, source_label, lineage, origin_id,
      excerpt, observed_at, ingested_at, valid_from, valid_until, corrects, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sid, e.id, e.subject, e.predicate, e.scopeKey, JSON.stringify(e.value), e.stance, e.sourceKind, e.channel, e.sourceLabel, e.lineage, e.originId,
        e.excerpt, e.observedAt, e.ingestedAt, e.validFrom, e.validUntil, e.corrects ? 1 : 0, seq]);
    for (const t of indexTerms(e)) await q.run('INSERT INTO memory_index (session, evidence_id, term) VALUES (?, ?, ?)', [sid, e.id, t]);
  }
  /** Derived per-subject summary ("what I know about you"): rebuilt from current evidence whenever evidence changes. */
  private summarize(all: Evidence[], tombs: Tombstone[], subject: SubjectId, now: number) {
    const lines: string[] = []; const deps: string[] = [];
    for (const [predicate, scopes] of this.slots(all, subject)) for (const sk of scopes) {
      const d = evaluate(all, tombs, { actor: subject, subject, predicate, scope: sk ? { place: sk.replace('place=', '') as 'home' } : undefined, purpose: 'inspection', now });
      if (d.outcome === 'ABSTAIN' || d.valueLabel === undefined) continue;
      lines.push(`${d.label}${sk ? ` (${d.scope})` : ''}: ${d.valueLabel}${d.mightBeWrong ? ' (uncertain)' : ''}`);
      deps.push(...d.considered.filter((c) => c.role === 'leader' || c.role === 'supports').map((c) => c.id));
    }
    return { text: lines.join('; '), deps };
  }
  private slots(all: Evidence[], subject: SubjectId) {
    const m = new Map<PredicateId, Set<string>>();
    for (const e of all) if (e.subject === subject) { if (!m.has(e.predicate)) m.set(e.predicate, new Set()); m.get(e.predicate)!.add(e.scopeKey); }
    return m;
  }
  private async refreshSummaries(q: Q, sid: string, clock: number) {
    const all = await this.evidence(q, sid); const tombs = await this.tombstones(q, sid);
    const rev = (await this.session(q, sid)).revision;
    let n = 0;
    for (const s of Object.keys(SUBJECTS) as SubjectId[]) {
      const { text, deps } = this.summarize(all, tombs, s, clock);
      await q.run('DELETE FROM summaries WHERE session = ? AND subject = ?', [sid, s]);
      if (text) { await q.run('INSERT INTO summaries (session, subject, revision, text, deps) VALUES (?, ?, ?, ?, ?)', [sid, s, rev, text, JSON.stringify(deps)]); n++; }
    }
    return n;
  }

  // ---------- WRITE PATH ----------
  /**
   * Ingest structured statements. Authority comes from the CHANNEL, never from the payload: a chat line is a direct
   * statement, an answer that changes a memory is a correction, an unsigned import is a third-party report.
   */
  async ingest(sid: string, channel: 'chat' | 'correction' | 'import:signed' | 'import:unsigned', items: IngestItem[], actor: SubjectId = 'maya'): Promise<IngestResult[]> {
    return this.db.tx(sid, async (q) => {
      const { clock } = await this.session(q, sid);
      const tombs = await this.tombstones(q, sid);
      let count = (await q.all<{ n: number }>('SELECT count(*) AS n FROM evidence WHERE session = ?', [sid]))[0].n;
      const out: IngestResult[] = [];
      for (const [index, it] of items.entries()) {
        const reject = (reason: string) => out.push({ index, status: 'rejected', reason });
        if (!it || typeof it !== 'object') { reject('not an object'); continue; }
        if (it.subject !== 'maya' && it.subject !== 'sam') { reject('unknown subject'); continue; }
        if (!isPredicate(it.predicate)) { reject('unknown predicate'); continue; }
        if ((channel === 'chat' || channel === 'correction') && it.subject !== actor) { reject('only the person a memory is about can state or correct it'); continue; }
        const bad = validateValue(it.predicate, it.value); if (bad) { reject(bad); continue; }
        const stance: Stance = it.stance === 'opposes' ? 'opposes' : 'supports';
        let sk: string; try { sk = scopeKey(it.predicate, it.scope); } catch { reject('bad scope'); continue; }
        const signed = channel === 'import:signed';
        const kind: SourceKind = channel === 'chat' ? 'user_statement' : channel === 'correction' ? 'user_correction'
          : signed && it.sourceKind && ['user_statement', 'user_correction', 'trusted_import', 'observed_event', 'third_party', 'model_inference'].includes(it.sourceKind) ? it.sourceKind : 'third_party';
        // Observation time: "now" for things said now; an import keeps its original time and can never look fresher.
        const observedAt = channel === 'chat' || channel === 'correction' ? clock : Number(it.observedAt);
        if (!Number.isFinite(observedAt) || observedAt > clock || observedAt < clock - 20 * 365 * DAY) { reject('observation time missing or out of range'); continue; }
        const validFrom = it.validFrom == null ? null : Number(it.validFrom), validUntil = it.validUntil == null ? null : Number(it.validUntil);
        if ((validFrom !== null && !Number.isFinite(validFrom)) || (validUntil !== null && !Number.isFinite(validUntil)) || (validFrom !== null && validUntil !== null && validFrom > validUntil)) { reject('bad validity interval'); continue; }
        // Revocation is checked before anything is stored: a blocked topic is never relearned, and nothing observed
        // before a revocation can come back (old exports, replays, delayed workers).
        // 'before' mode: only something the person says after the forget may be learned again. A chat statement or
        // correction is stamped by the server and serialized after the tombstone, so it is new by construction. An
        // unsigned import carries a caller-chosen date and could be an old copy re-dated, so it never repopulates a
        // forgotten topic; a signed one keeps its server-assigned date and must postdate the forget.
        const t = tombs.find((x) => x.subject === it.subject && x.predicate === it.predicate);
        if (t) {
          if (t.mode === 'block') { reject('topic revoked: not relearned'); continue; }
          if (channel === 'import:unsigned') { reject('revoked: an import cannot restore a forgotten topic; tell me directly instead'); continue; }
          if (channel === 'import:signed' && observedAt <= t.revokedAt) { reject('revoked: observed before the forget request'); continue; }
        }
        const ret = PREDICATES[it.predicate].retention;
        if (ret && ret.kinds.includes(kind) && observedAt < clock - ret.days * DAY) { reject('past its retention period'); continue; }
        const originId = channel === 'chat' || channel === 'correction' ? rid('chat') : clean(it.originId, 80) || `import-${createHash('sha256').update(JSON.stringify([it.subject, it.predicate, sk, it.value, stance, observedAt])).digest('hex').slice(0, 24)}`;
        if ((await q.all('SELECT 1 FROM evidence WHERE session = ? AND origin_id = ?', [sid, originId])).length) { out.push({ index, status: 'duplicate' }); continue; }
        if (count >= LIMITS.evidencePerSession) { reject('storage limit for this demo session reached'); continue; }
        const e: Omit<Evidence, 'seq'> = {
          id: rid('ev'), subject: it.subject, predicate: it.predicate, scopeKey: sk, value: it.value, stance, sourceKind: kind, channel,
          sourceLabel: channel === 'chat' ? `${SUBJECTS[actor].name}, in chat` : channel === 'correction' ? `${SUBJECTS[actor].name}, correction` : signed ? (clean(it.sourceLabel, LIMITS.label) || 'Restored export') : `Unsigned import${clean(it.sourceLabel, LIMITS.label) ? ` · ${clean(it.sourceLabel, LIMITS.label)}` : ''}`,
          lineage: channel === 'chat' || channel === 'correction' ? `subject:${actor}` : signed ? (clean(it.lineage, 60) || 'restored') : 'unsigned-import', // a caller cannot declare independence
          originId, excerpt: clean(it.excerpt, LIMITS.excerpt) || `${PREDICATES[it.predicate].label}: ${valueLabel(it.predicate, it.value)}`,
          observedAt, ingestedAt: clock, validFrom, validUntil, corrects: kind === 'user_correction',
        };
        await this.insert(q, sid, clock, e); count++;
        out.push({ index, status: 'stored', id: e.id });
      }
      const stored = out.filter((o) => o.status === 'stored');
      if (stored.length) { await this.bump(q, sid, clock); await this.refreshSummaries(q, sid, clock); }
      await this.audit(q, sid, clock, 'ingest', { channel, stored: stored.length, duplicates: out.filter((o) => o.status === 'duplicate').length, rejected: out.filter((o) => o.status === 'rejected').map((o) => o.reason) });
      return out;
    });
  }

  /** The user's answer to a question: a reconfirmation if it matches the current memory, otherwise an explicit correction. */
  async answer(sid: string, predicate: PredicateId, scope: Scope | undefined, value: unknown) {
    const snap = await this.snapshot(sid);
    const d = evaluate(snap.all, snap.tombs, { actor: 'maya', subject: 'maya', predicate, scope, purpose: 'inspection', now: snap.clock });
    const same = d.value !== undefined && JSON.stringify(d.value) === JSON.stringify(value);
    const excerpt = same ? `Confirmed: ${valueLabel(predicate, value)}${scope?.place ? ` at ${scope.place}` : ''}.` : `Correction: ${valueLabel(predicate, value)}${scope?.place ? ` at ${scope.place}` : ''} from now on.`;
    const r = await this.ingest(sid, same ? 'chat' : 'correction', [{ subject: 'maya', predicate, scope, value, excerpt }]);
    return { kind: same ? 'reconfirmed' as const : 'corrected' as const, result: r[0] };
  }

  // ---------- RETRIEVAL PATH ----------
  async clock(sid: string) { return (await this.db.tx(null, (q) => this.session(q, sid))).clock; }
  /** One consistent read of everything a decision needs, ordered against forgetting by the session lock. */
  private async snapshot(sid: string, indexTerms: string[] = []) {
    return this.db.tx(sid, async (q) => {
      if (this.hooks.beforeRead) await this.hooks.beforeRead();
      const s = await this.session(q, sid);
      const hits = indexTerms.length ? await q.all<{ evidence_id: string; term: string }>(`SELECT evidence_id, term FROM memory_index WHERE session = ? AND term IN (${indexTerms.map(() => '?').join(',')})`, [sid, ...indexTerms]) : [];
      return { ...s, all: await this.evidence(q, sid), tombs: await this.tombstones(q, sid), hits };
    });
  }
  async decide(sid: string, query: { actor?: SubjectId; subject?: SubjectId; predicate: PredicateId; scope?: Scope; purpose: Purpose; consentPurpose?: string }) {
    const snap = await this.snapshot(sid);
    const key = `${sid}|${snap.revision}|${snap.clock}|${JSON.stringify(query)}`;
    const hit = this.cache.get(key); if (hit) return hit;
    const d = evaluate(snap.all, snap.tombs, { actor: query.actor ?? 'maya', subject: query.subject ?? 'maya', predicate: query.predicate, scope: query.scope, purpose: query.purpose, consentPurpose: query.consentPurpose, now: snap.clock });
    if (this.cache.size > 5000) this.cache.clear();
    // A read that raced a forget is answered (it was ordered before it) but never cached below the purge floor.
    if (snap.revision >= (this.floor.get(sid) ?? 0)) this.cache.set(key, d);
    return d;
  }
  private floor = new Map<string, number>();
  private purgeCache(sid: string, floor?: number) {
    if (floor !== undefined) this.floor.set(sid, floor);
    let n = 0; for (const k of this.cache.keys()) if (k.startsWith(`${sid}|`)) { this.cache.delete(k); n++; } return n;
  }

  /**
   * Free-text question → candidate retrieval over the derived index → decisions. Access, consent and revocation are
   * applied BEFORE the index is searched: revoked or other people's sensitive evidence is never a candidate.
   */
  async ask(sid: string, text: string, actor: SubjectId = 'maya') {
    const trace: Trace = []; let t0 = performance.now();
    const lap = (step: string, detail: string) => { const t = performance.now(); trace.push({ step, detail, ms: Math.round((t - t0) * 100) / 100 }); t0 = t; };
    const qterms = terms(clean(text, 300));
    const snap = await this.snapshot(sid, qterms);
    lap('Identity + scope', `acting as ${SUBJECTS[actor].name}; household session; ${snap.all.length} evidence records in this session`);
    const blocked = new Set(snap.tombs.filter((t) => t.mode === 'block').map((t) => `${t.subject}|${t.predicate}`));
    const visible = snap.all.filter((e) => !blocked.has(`${e.subject}|${e.predicate}`) && (e.subject === actor || (PREDICATES[e.predicate].householdShared && !PREDICATES[e.predicate].sensitive)));
    lap('Consent + revocation filter', `${snap.all.length - visible.length} records excluded before search (other person, sensitive, or revoked); ${snap.tombs.length} tombstone${snap.tombs.length === 1 ? '' : 's'} checked`);

    const inventory = /remember|know about me|what do you know|memories/i.test(text);
    const hints = new Map<string, number>();
    const hint = (p: PredicateId, sk: string, w: number) => hints.set(`${p}|${sk}`, (hints.get(`${p}|${sk}`) ?? 0) + w);
    const place = /office|work/i.test(text) ? 'place=office' : /home/i.test(text) ? 'place=home' : '';
    if (/deliver|parcel|package|courier|sofa/i.test(text)) hint('delivery.window', place || 'place=home', 3);
    if (/office days|which days|in the office|days.*office/i.test(text)) hint('work.office_days', '', 4);
    if (/friday|physio|where am i|private|clinic|appointment/i.test(text)) hint('location.private', '', 4);
    if (/city|where do i live|live/i.test(text)) hint('home.city', '', 4);
    if (/hold|away|holiday/i.test(text)) hint('delivery.hold', '', 4);
    let candidates = 0;
    if (qterms.length) {
      const ids = new Set(visible.map((e) => e.id));
      for (const r of snap.hits) if (ids.has(r.evidence_id)) { const e = visible.find((x) => x.id === r.evidence_id)!; if (e.subject === actor) { hint(e.predicate, PREDICATES[e.predicate].scoped ? (e.scopeKey || place || 'place=home') : '', 1); candidates++; } }
    }
    lap('Candidate retrieval', inventory ? 'inventory request: every memory slot about you' : `${qterms.length} query terms → ${candidates} index hits across ${hints.size} memory slot${hints.size === 1 ? '' : 's'}`);

    let slots: [PredicateId, string][];
    if (inventory) slots = [...this.slots(visible, actor)].flatMap(([p, s]) => [...s].map((k) => [p, k] as [PredicateId, string]));
    else slots = [...hints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([k]) => k.split('|') as [PredicateId, string]);
    const decisions = slots.map(([p, sk]) => evaluate(snap.all, snap.tombs, { actor, subject: actor, predicate: p, scope: sk ? { place: sk.replace('place=', '') as 'home' } : undefined, purpose: inventory || PREDICATES[p].sensitive ? 'inspection' : 'advice', consentPurpose: undefined, now: snap.clock }));
    lap('Freshness + contradiction', decisions.map((d) => `${d.label}${d.scope !== 'everywhere' ? ` (${d.scope})` : ''}: ${d.freshness?.state ?? 'n/a'}, conflict ${d.conflict.state}`).join('; ') || 'nothing to evaluate');
    lap('Evidence ranking', decisions.map((d) => `${d.label}: leader ${d.grade ?? 'none'} of ${d.considered.length} considered`).join('; ') || 'no candidates');
    lap('Decision', decisions.map((d) => d.outcome).join(', ') || 'ABSTAIN');
    let reply: string;
    if (inventory) reply = decisions.length ? `Here is everything I hold about you — ${decisions.length} memories. Each one shows where it came from, how strong it is and how fresh it is.` : `I don't hold any memories about you.`;
    else if (decisions.length) reply = decisions[0].sentence;
    else reply = `I don't have a memory I can use for that.`;
    return { reply, decisions, trace, revision: snap.revision, clock: snap.clock, inventory };
  }

  // ---------- TASKS (consequential actions) ----------
  async plan(sid: string, task: TaskId) { const s = await this.snapshot(sid); return plan(s.all, s.tombs, task, s.clock); }
  /** The backend gate: the plan is recomputed inside the booking transaction; only USE on every needed memory books. */
  async book(sid: string, task: TaskId, idem: string) {
    if (!isTask(task)) throw new Rejected('unknown task');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(idem)) throw new Rejected('idempotency key required');
    return this.db.tx(sid, async (q) => {
      const { clock } = await this.session(q, sid);
      const prior = await q.all<Row>('SELECT * FROM bookings WHERE session = ? AND idem = ?', [sid, idem]);
      if (prior.length) return { booking: this.bookingView(prior[0]), duplicate: true, plan: null as Plan | null };
      const p = plan(await this.evidence(q, sid), await this.tombstones(q, sid), task, clock);
      if (!p.canBook || !p.slot) throw new Blocked(p);
      const id = rid('bk');
      // Every piece of the stored explanation records the evidence it came from, so forgetting removes it by dependency.
      const used = (d: Plan['decisions'][number]) => d.considered.filter((c) => c.role === 'leader' || c.role === 'supports').map((c) => c.id);
      const parts: BookingPart[] = [
        { key: 'window', text: String(p.decisions[0].valueLabel), deps: used(p.decisions[0]) },
        { key: 'head', text: `${TASKS[task].label}:`, deps: [] },
        ...p.decisions.map((d, i) => ({ key: `decision.${i}`, text: `${d.label.toLowerCase()} = ${d.valueLabel}${i === p.decisions.length - 1 ? '.' : ','}`, deps: used(d) })),
        ...p.skipped.map((sk, i) => ({ key: `skipped.${i}`, text: `Skipped ${sk.label}: ${sk.reason}.`, deps: sk.deps })),
      ];
      await q.run('INSERT INTO bookings (session, id, task, idem, slot_start, slot_end, place, window_label, evidence_ids, reason, parts, booked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sid, id, task, idem, p.slot.start, p.slot.end, p.place, parts[0].text, JSON.stringify(p.evidenceIds), composeReason(parts), JSON.stringify(parts), clock]);
      for (const ev of p.evidenceIds) await q.run('INSERT INTO uses (session, evidence_id, task, at, outcome) VALUES (?, ?, ?, ?, ?)', [sid, ev, task, clock, 'USE']);
      await this.bump(q, sid, clock);
      await this.audit(q, sid, clock, 'task.booked', { task, booking: id, relied_on: p.evidenceIds });
      const row = (await q.all<Row>('SELECT * FROM bookings WHERE session = ? AND id = ?', [sid, id]))[0];
      return { booking: this.bookingView(row), duplicate: false, plan: p };
    });
  }
  private bookingView(r: Row) { return { id: r.id, task: r.task, label: TASKS[r.task as TaskId]?.label ?? r.task, start: r.slot_start, end: r.slot_end, place: r.place, window: r.window_label, reason: r.reason, bookedAt: r.booked_at, evidenceIds: JSON.parse(r.evidence_ids) as string[] }; }

  // ---------- FORGET PATH ----------
  /**
   * Revoke a memory topic and delete its content everywhere CAVEAT controls, in one transaction: evidence rows, the
   * derived index, usage records, derived summaries, booking reasons that quoted it, and the decision cache.
   * A content-free tombstone stays so the topic cannot be relearned from old copies. Then verify, then issue the receipt.
   */
  async forget(sid: string, subject: SubjectId, predicate: PredicateId, mode: 'block' | 'before', reason: 'user-request' = 'user-request') {
    if (subject !== 'maya') throw new Rejected('you can only forget memories about yourself');
    if (!isPredicate(predicate)) throw new Rejected('unknown predicate');
    if (mode !== 'block' && mode !== 'before') throw new Rejected('mode must be block or before');
    let markers: string[] = [];
    const res = await this.db.tx(sid, async (q) => {
      const { clock, revision } = await this.session(q, sid);
      const all = await this.evidence(q, sid);
      const doomed = all.filter((e) => e.subject === subject && e.predicate === predicate);
      markers = distinctive(doomed, all.filter((e) => !doomed.includes(e)));
      const counts = await this.purge(q, sid, doomed.map((e) => e.id), markers);
      const prev = (await q.all<Row>('SELECT mode FROM tombstones WHERE session = ? AND subject = ? AND predicate = ?', [sid, subject, predicate]))[0];
      const finalMode = prev?.mode === 'block' ? 'block' : mode;
      await q.run('DELETE FROM tombstones WHERE session = ? AND subject = ? AND predicate = ?', [sid, subject, predicate]);
      await q.run('INSERT INTO tombstones (session, subject, predicate, mode, revoked_at, revision) VALUES (?, ?, ?, ?, ?, ?)', [sid, subject, predicate, finalMode, clock, revision + 1]);
      await this.bump(q, sid, clock);
      counts.summaries = await this.refreshSummaries(q, sid, clock);
      const id = rid('rc');
      await this.audit(q, sid, clock, 'forget', { subject, predicate, mode: finalMode, receipt: id, deleted: counts.evidence });
      return { id, clock, revision: revision + 1, counts, finalMode, reason, doomedIds: doomed.map((e) => e.id) };
    });
    const cacheEntries = this.purgeCache(sid, res.revision);
    const queued = this.worker.get(sid); if (queued) queued.evidenceIds = queued.evidenceIds.filter((x) => !res.doomedIds.includes(x));
    const storage = await this.db.compact();
    const verification = await this.verify(sid, subject, predicate, res.revision, markers, res.doomedIds);
    markers = []; // the distinctive terms existed only in memory, only for the verification scan
    return this.writeReceipt(sid, res.id, 'forget', res.clock, {
      request: { subject: SUBJECTS[subject].name, topic: PREDICATES[predicate].label, mode: res.finalMode === 'block' ? 'Forget and never relearn' : 'Forget what you know; may learn it again if I tell you' },
      deleted: { evidence: res.counts.evidence, indexEntries: res.counts.index, usageRecords: res.counts.uses, cacheEntries },
      storage,
      rewritten: { derivedSummaries: res.counts.summaries, bookingReasons: res.counts.bookings },
      retained: [
        `Tombstone: person + topic + revocation time (no value, no text). It blocks ${res.finalMode === 'block' ? 'relearning this topic' : 'anything observed before now'}, including old exports and delayed workers.`,
        'Audit entry: operation, topic name and counts (no value, no text).',
        'This receipt (no value, no text).',
      ],
      verification, verified: verification.every((v) => v.pass), revision: res.revision,
      limitations: LIMITATIONS,
    });
  }
  /** Delete evidence and everything derived from it. Returns counts. `markers` are distinctive terms of the deleted content. */
  private async purge(q: Q, sid: string, ids: string[], markers: string[]) {
    const counts = { evidence: 0, index: 0, uses: 0, bookings: 0, summaries: 0 };
    // No early return when nothing is left to delete: a legacy booking can still quote evidence deleted long ago.
    const inList = ids.map(() => '?').join(',');
    if (ids.length) {
      counts.index = await q.run(`DELETE FROM memory_index WHERE session = ? AND evidence_id IN (${inList})`, [sid, ...ids]);
      counts.uses = await q.run(`DELETE FROM uses WHERE session = ? AND evidence_id IN (${inList})`, [sid, ...ids]);
    }
    // Bookings that relied on the deleted memory keep their slot (the delivery is an action already taken), but every
    // stored piece of explanation derived from that evidence is replaced, by recorded dependency, not by word matching.
    void markers;
    for (const b of await q.all<Row>('SELECT id, evidence_ids, parts, slot_start, slot_end FROM bookings WHERE session = ?', [sid])) {
      const evs = JSON.parse(b.evidence_ids) as string[];
      const parts = JSON.parse(b.parts) as BookingPart[];
      const hit = (x: BookingPart) => x.deps.some((d) => d === LEGACY_DEP || ids.includes(d));
      if (!evs.some((x) => ids.includes(x)) && !parts.some(hit)) continue;
      const next = parts.map((x) => (!hit(x) ? x : { key: x.key, deps: [], text: x.key === 'window' ? `${new Date(b.slot_start).getUTCHours()}:00–${new Date(b.slot_end).getUTCHours()}:00` : REMOVED }));
      await q.run('UPDATE bookings SET evidence_ids = ?, window_label = ?, reason = ?, parts = ? WHERE session = ? AND id = ?',
        [JSON.stringify(evs.filter((x) => !ids.includes(x))), next[0].text, composeReason(next), JSON.stringify(next), sid, b.id]);
      counts.bookings++;
    }
    if (ids.length) counts.evidence = await q.run(`DELETE FROM evidence WHERE session = ? AND id IN (${inList})`, [sid, ...ids]);
    return counts;
  }
  /** Post-commit checks against the real tables, the export, the cache and the retrieval path. */
  private async verify(sid: string, subject: SubjectId, predicate: PredicateId, revision: number, markers: string[], doomedIds: string[]) {
    const checks: { check: string; expected: string; actual: string; pass: boolean }[] = [];
    const add = (check: string, expected: string, actual: string | number) => checks.push({ check, expected, actual: String(actual), pass: String(actual) === expected });
    await this.db.tx(null, async (q) => {
      add('Evidence rows for this topic', '0', (await q.all<{ n: number }>('SELECT count(*) AS n FROM evidence WHERE session = ? AND subject = ? AND predicate = ?', [sid, subject, predicate]))[0].n);
      add('Index entries pointing at deleted evidence', '0', (await q.all<{ n: number }>('SELECT count(*) AS n FROM memory_index i LEFT JOIN evidence e ON e.session = i.session AND e.id = i.evidence_id WHERE i.session = ? AND e.id IS NULL', [sid]))[0].n);
      add('Booking text derived from deleted evidence', '0', (await q.all<Row>('SELECT parts FROM bookings WHERE session = ?', [sid])).flatMap((r) => JSON.parse(r.parts) as BookingPart[]).filter((x) => x.deps.some((d) => d === LEGACY_DEP || doomedIds.includes(d))).length);
      add('Usage records pointing at deleted evidence', '0', (await q.all<{ n: number }>('SELECT count(*) AS n FROM uses u LEFT JOIN evidence e ON e.session = u.session AND e.id = u.evidence_id WHERE u.session = ? AND e.id IS NULL', [sid]))[0].n);
      if (markers.length) {
        const ph = markers.map(() => '?').join(',');
        add('Distinctive terms left in the search index', '0', (await q.all<{ n: number }>(`SELECT count(*) AS n FROM memory_index WHERE session = ? AND term IN (${ph})`, [sid, ...markers]))[0].n);
        const texts = [
          ...(await q.all<Row>('SELECT text AS t FROM summaries WHERE session = ?', [sid])).map((r) => ['summaries', r.t]),
          ...(await q.all<Row>('SELECT reason AS t FROM bookings WHERE session = ?', [sid])).map((r) => ['bookings', r.t]),
          ...(await q.all<Row>('SELECT detail AS t FROM audit WHERE session = ?', [sid])).map((r) => ['audit', r.t]),
          ...(await q.all<Row>('SELECT body AS t FROM receipts WHERE session = ?', [sid])).map((r) => ['receipts', r.t]),
        ];
        for (const table of ['summaries', 'bookings', 'audit', 'receipts'])
          add(`Deleted content in ${table}`, '0', texts.filter(([tb, t]) => tb === table && markers.some((m) => terms(String(t)).includes(m))).length);
      } else add('Distinctive-term scan', 'skipped', 'skipped');
      add('Tombstone holds no content', 'true', String(Object.keys((await q.all<Row>('SELECT * FROM tombstones WHERE session = ? AND predicate = ?', [sid, predicate]))[0] ?? {}).every((k) => ['session', 'subject', 'predicate', 'mode', 'revoked_at', 'revision'].includes(k))));
    });
    const exp = JSON.stringify(await this.exportEnvelope(sid));
    add('Deleted content in a fresh export', '0', markers.filter((m) => terms(exp).includes(m)).length);
    const job = this.worker.get(sid);
    add('Queued jobs holding a copy of it', '0', job ? Number(job.evidenceIds.some((x) => doomedIds.includes(x)) || markers.some((m) => terms(JSON.stringify(job)).includes(m))) : 0);
    add('Decision-cache entries for older revisions', '0', [...this.cache.keys()].filter((k) => k.startsWith(`${sid}|`) && Number(k.split('|')[1]) < revision).length);
    const d = await this.decide(sid, { predicate, purpose: 'inspection' });
    add('Retrieval of this topic now', 'ABSTAIN', d.outcome);
    return checks;
  }
  private async writeReceipt<T extends Record<string, unknown>>(sid: string, id: string, kind: string, clock: number, body: T): Promise<{ id: string; kind: string; at: number } & T> {
    const full = { id, kind, at: clock, ...body };
    await this.db.tx(sid, (q) => q.run('INSERT INTO receipts (session, id, at, real_at, kind, body) VALUES (?, ?, ?, ?, ?, ?)', [sid, id, clock, Date.now(), kind, JSON.stringify(full)]));
    return full;
  }

  // ---------- TIME + RETENTION ----------
  /** Advance the session's virtual clock (monotonic), then run scheduled retention. */
  async advance(sid: string, days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Rejected('days must be an integer from 1 to 365');
    const clock = await this.db.tx(sid, async (q) => {
      const s = await this.session(q, sid);
      if (s.clock + days * DAY > START + LIMITS.maxClockDays * DAY) throw new Rejected('the demo clock cannot run more than 3 years ahead');
      await q.run('UPDATE sessions SET clock = clock + ? WHERE id = ?', [days * DAY, sid]);
      await this.bump(q, sid, s.clock + days * DAY);
      await this.audit(q, sid, s.clock + days * DAY, 'clock.advanced', { days });
      return s.clock + days * DAY;
    });
    const retention = await this.sweepRetention(sid);
    return { clock, retention };
  }
  /** Retention expiry: evidence past its predicate's retention period is deleted without anyone having to remember. */
  async sweepRetention(sid: string) {
    let markers: string[] = [];
    const r = await this.db.tx(sid, async (q) => {
      const { clock } = await this.session(q, sid);
      const all = await this.evidence(q, sid);
      const doomed = all.filter((e) => { const ret = PREDICATES[e.predicate].retention; return ret && ret.kinds.includes(e.sourceKind) && e.observedAt < clock - ret.days * DAY; });
      if (!doomed.length) return null;
      markers = distinctive(doomed, all.filter((e) => !doomed.includes(e)));
      const counts = await this.purge(q, sid, doomed.map((e) => e.id), markers);
      await this.bump(q, sid, clock);
      counts.summaries = await this.refreshSummaries(q, sid, clock);
      const id = rid('rc');
      await this.audit(q, sid, clock, 'retention.expired', { receipt: id, deleted: counts.evidence, predicates: [...new Set(doomed.map((e) => e.predicate))] });
      return { id, clock, counts, topics: [...new Set(doomed.map((e) => PREDICATES[e.predicate].label))], kinds: [...new Set(doomed.map((e) => e.sourceKind))] };
    });
    markers = [];
    if (!r) return null;
    this.purgeCache(sid, (await this.db.tx(null, (q) => this.session(q, sid))).revision);
    await this.db.compact();
    return this.writeReceipt(sid, r.id, 'retention', r.clock, {
      request: { subject: 'Scheduled retention', topic: r.topics.join(', '), mode: `Delete ${r.kinds.join(', ').replace(/_/g, ' ')} records older than their retention period` },
      deleted: { evidence: r.counts.evidence, indexEntries: r.counts.index, usageRecords: r.counts.uses },
      rewritten: { derivedSummaries: r.counts.summaries, bookingReasons: r.counts.bookings },
      retained: ['Audit entry: operation and counts (no content).', 'This receipt (no content).'],
      verification: [], verified: true, limitations: LIMITATIONS,
    });
  }

  // ---------- EXPORT / IMPORT ----------
  /** A signed, session-bound export of the subject's own evidence. Signature = HMAC(server secret); it carries no session id. */
  async exportEnvelope(sid: string) {
    const { clock, revision, all } = await this.db.tx(sid, async (q) => ({ ...(await this.session(q, sid)), all: await this.evidence(q, sid) })); // one locked snapshot: the signed revision matches the evidence
    const items = all.filter((e) => e.subject === 'maya').map((e) => ({
      subject: e.subject, predicate: e.predicate, scope: e.scopeKey ? { place: e.scopeKey.replace('place=', '') } : undefined, value: e.value, stance: e.stance,
      sourceKind: e.sourceKind, sourceLabel: e.sourceLabel, lineage: e.lineage, originId: e.originId, excerpt: e.excerpt,
      observedAt: e.observedAt, validFrom: e.validFrom, validUntil: e.validUntil,
    }));
    const body = { format: 'caveat-export/1', binding: this.mac(`bind:${sid}`).slice(0, 32), revision, exportedAt: clock, items };
    return { ...body, sig: this.mac(JSON.stringify(body)) };
  }
  async importEnvelope(sid: string, env: unknown) {
    if (!env || typeof env !== 'object') throw new Rejected('import must be a JSON object');
    const e = env as Record<string, unknown>;
    if (!Array.isArray(e.items)) throw new Rejected('import needs an items array');
    if (e.items.length > LIMITS.importItems) throw new Rejected(`at most ${LIMITS.importItems} items per import`);
    const body = { format: e.format, binding: e.binding, revision: e.revision, exportedAt: e.exportedAt, items: e.items };
    const want = this.mac(JSON.stringify(body));
    const sigOk = typeof e.sig === 'string' && e.sig.length === want.length && timingSafeEqual(Buffer.from(e.sig), Buffer.from(want));
    const signed = sigOk && e.format === 'caveat-export/1' && e.binding === this.mac(`bind:${sid}`).slice(0, 32);
    const results = await this.ingest(sid, signed ? 'import:signed' : 'import:unsigned', e.items as IngestItem[]);
    return { signed, reason: signed ? 'signature valid: restored as your own records, with their original dates' : sigOk ? 'signed for another session: treated as an unsigned third-party report' : 'unsigned or modified: treated as a third-party report', results };
  }

  // ---------- DELAYED WORKER ----------
  /** Queue a nightly "profile digest" job. It records what it plans to summarize (ids + revision) and runs later. */
  async queueDigest(sid: string) {
    const snap = await this.snapshot(sid);
    const job: WorkerJob = { id: rid('job'), baseRevision: snap.revision, evidenceIds: snap.all.map((e) => e.id), queuedAt: snap.clock };
    this.worker.set(sid, job);
    await this.db.tx(sid, (q) => this.audit(q, sid, snap.clock, 'worker.queued', { job: job.id, base_revision: snap.revision }));
    return { id: job.id, baseRevision: job.baseRevision };
  }
  /** The worker commits its captured digest — fenced by revision, so anything captured before a forget is discarded. */
  async releaseDigest(sid: string) {
    const job = this.worker.get(sid);
    if (!job) throw new Rejected('no delayed worker job is queued');
    this.worker.delete(sid);
    return this.db.tx(sid, async (q) => {
      const { clock, revision } = await this.session(q, sid);
      if (revision !== job.baseRevision) {
        await this.audit(q, sid, clock, 'worker.fenced', { job: job.id, base_revision: job.baseRevision, revision });
        return { job: job.id, written: false, baseRevision: job.baseRevision, revision, reason: `fenced: the job was planned at revision ${job.baseRevision}, memory is now at revision ${revision}; it was discarded without writing` };
      }
      // Rehydrated under the session lock from current storage, never from a copy carried by the job.
      const all = (await this.evidence(q, sid)).filter((e) => job.evidenceIds.includes(e.id)); const tombs = await this.tombstones(q, sid);
      for (const subject of ['maya', 'sam'] as SubjectId[]) {
        const c = this.summarize(all, tombs, subject, clock);
        await q.run('DELETE FROM summaries WHERE session = ? AND subject = ?', [sid, subject]);
        if (c.text) await q.run('INSERT INTO summaries (session, subject, revision, text, deps) VALUES (?, ?, ?, ?, ?)', [sid, subject, revision, c.text, JSON.stringify(c.deps)]);
      }
      await this.audit(q, sid, clock, 'worker.committed', { job: job.id, revision });
      return { job: job.id, written: true, baseRevision: job.baseRevision, revision, reason: 'memory unchanged since the job was queued: digest written' };
    });
  }
  hasQueuedDigest(sid: string) { return this.worker.has(sid); }

  /** Cold reload: drop every in-memory cache; everything served afterwards is re-read from the database. */
  reload() { const n = this.cache.size; this.cache.clear(); return { cacheEntriesDropped: n }; }

  // ---------- INSPECTOR ----------
  async state(sid: string) {
    return this.db.tx(sid, async (q) => {
      const s = await this.session(q, sid);
      const all = await this.evidence(q, sid); const tombs = await this.tombstones(q, sid);
      const uses = await q.all<Row>('SELECT evidence_id, task, at FROM uses WHERE session = ? ORDER BY at', [sid]);
      const memories = [...this.slots(all, 'maya')].flatMap(([p, scopes]) => [...scopes].map((sk) => {
        const d = evaluate(all, tombs, { actor: 'maya', subject: 'maya', predicate: p, scope: sk ? { place: sk.replace('place=', '') as 'home' } : undefined, purpose: 'inspection', now: s.clock });
        const action = evaluate(all, tombs, { actor: 'maya', subject: 'maya', predicate: p, scope: sk ? { place: sk.replace('place=', '') as 'home' } : undefined, purpose: 'action', consentPurpose: 'delivery-planning', now: s.clock });
        const ids = new Set(d.considered.map((c) => c.id));
        const status = d.considered.every((c) => c.role === 'not-valid-now' || c.role === 'out-of-scope') ? 'expired'
          : d.conflict.state === 'contested' ? 'contested' : d.freshness && d.freshness.state !== 'fresh' ? 'stale' : d.grade && !['authoritative', 'corroborated'].includes(d.grade) ? 'uncertain' : 'active';
        return { key: `${p}|${sk}`, predicate: p, scopeKey: sk, policy: PREDICATES[p], decision: d, actionOutcome: action.outcome, status,
          usedIn: uses.filter((u) => ids.has(u.evidence_id)).map((u) => ({ task: TASKS[u.task as TaskId]?.label ?? u.task, at: u.at })).filter((u, i, a) => a.findIndex((x) => x.task === u.task && x.at === u.at) === i) };
      }));
      const others = all.filter((e) => e.subject !== 'maya').length;
      const receipts = (await q.all<Row>('SELECT body FROM receipts WHERE session = ? ORDER BY real_at DESC', [sid])).map((r) => JSON.parse(r.body));
      const bookings = (await q.all<Row>('SELECT * FROM bookings WHERE session = ? ORDER BY booked_at DESC, id', [sid])).map((r) => this.bookingView(r));
      const audit = (await q.all<Row>('SELECT seq, at, op, detail FROM audit WHERE session = ? ORDER BY seq DESC LIMIT 40', [sid])).map((r) => ({ seq: r.seq, at: r.at, op: r.op, detail: JSON.parse(r.detail) }));
      const tomb = (await q.all<Row>('SELECT subject, predicate, mode, revoked_at, revision FROM tombstones WHERE session = ?', [sid])).map((r) => ({ subject: r.subject, topic: PREDICATES[r.predicate as PredicateId]?.label ?? r.predicate, predicate: r.predicate, mode: r.mode, revokedAt: r.revoked_at, revision: r.revision }));
      const summary = (await q.all<Row>("SELECT text, revision FROM summaries WHERE session = ? AND subject = 'maya'", [sid]))[0] ?? null;
      const counts = Object.fromEntries(await Promise.all(['evidence', 'memory_index', 'summaries', 'uses', 'bookings', 'tombstones', 'receipts', 'audit'].map(async (t) => [t, (await q.all<{ n: number }>(`SELECT count(*) AS n FROM ${t} WHERE session = ?`, [sid]))[0].n])));
      return { clock: s.clock, start: START, revision: s.revision, memories, otherPeople: others, receipts, bookings, audit, tombstones: tomb, summary, counts, workerQueued: this.worker.has(sid) };
    });
  }
}

/** Terms that appear in the deleted evidence and nowhere in what remains (or in the fixed vocabulary). */
function distinctive(doomed: Evidence[], remaining: Evidence[]) {
  const keep = new Set(remaining.flatMap(indexTerms));
  for (const p of Object.values(PREDICATES)) for (const t of terms(p.label)) keep.add(t);
  for (const w of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'morning', 'afternoon', 'evening', 'home', 'office', 'delivery', 'book', 'anything']) keep.add(w);
  return [...new Set(doomed.flatMap(indexTerms))].filter((t) => !keep.has(t) && t.length >= 3);
}

export const LIMITATIONS = [
  'Copies made before the forget — a downloaded export, a screenshot, an answer already shown — are outside CAVEAT. They cannot be re-imported into this memory, but CAVEAT cannot erase them.',
  'PostgreSQL removes deleted rows from query results immediately; their bytes can persist in database pages until vacuum, in the write-ahead log, and in the hosting provider\'s backups for its retention period. CAVEAT cannot purge provider backups.',
  'A retrieval that completed before the forget may already have returned the memory to the screen.',
];
