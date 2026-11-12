// Thin client for the CAVEAT API. The browser holds no authority: every decision is recomputed on the server.
import type { Decision, Considered } from '../../src/policy.ts';
import type { PredicatePolicy, PredicateId } from '../../src/model.ts';
export type { Decision, Considered, PredicateId };

export type Memory = {
  key: string; predicate: PredicateId; scopeKey: string; policy: PredicatePolicy; decision: Decision;
  actionOutcome: Decision['outcome']; status: 'active' | 'contested' | 'stale' | 'uncertain' | 'expired';
  usedIn: { task: string; at: number }[];
};
export type Check = { check: string; expected: string; actual: string; pass: boolean };
export type Receipt = {
  id: string; kind: 'forget' | 'retention'; at: number;
  request: { subject: string; topic: string; mode: string };
  deleted: Record<string, number>; rewritten: Record<string, number>; storage?: string;
  retained: string[]; verification: Check[]; verified: boolean; limitations: string[];
};
export type Booking = { id: string; task: string; label: string; start: number; end: number; place: string; window: string; reason: string; bookedAt: number; evidenceIds: string[] };
export type State = {
  clock: number; start: number; revision: number; memories: Memory[]; otherPeople: number; receipts: Receipt[]; bookings: Booking[];
  audit: { seq: number; at: number; op: string; detail: Record<string, unknown> }[];
  tombstones: { subject: string; topic: string; predicate: string; mode: string; revokedAt: number; revision: number }[];
  summary: { text: string; revision: number } | null; counts: Record<string, number>; workerQueued: boolean;
};
export type Plan = {
  task: string; label: string; place: string; decisions: Decision[]; privacy: { used: boolean; note: string; evidenceIds: string[] };
  hold: { active: boolean; note: string }; canBook: boolean; blockedBy: Decision | null;
  slot: { start: number; end: number; label: string } | null; skipped: { label: string; reason: string }[]; evidenceIds: string[];
};
export type Trace = { step: string; detail: string; ms: number }[];
export type AskResult = { reply: string; decisions: Decision[]; trace: Trace; revision: number; clock: number; inventory: boolean };
export type Naive = {
  booking: { window: string; basedOn: string; said: string; problems: string[] }; stale: { said: string };
  forgetting: { hiddenFromUi: boolean; stillInIndex: number; stillInExport: boolean; reimportAccepted: boolean; label: string }; note: string;
};

export class ApiError extends Error { status: number; body: any; constructor(status: number, body: any) { super(body?.error ?? `HTTP ${status}`); this.status = status; this.body = body; } }

async function raw(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}
async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  try { return await raw(method, path, body); }
  catch (e) { if (e instanceof ApiError && e.status === 401) { await raw('POST', '/api/session'); return raw(method, path, body); } throw e; }
}

export const api = {
  session: (): Promise<State> => raw('POST', '/api/session'),
  reset: (): Promise<State> => raw('POST', '/api/reset'),
  state: (): Promise<State> => call('GET', '/api/state'),
  ask: (text: string, actor: 'maya' | 'sam' = 'maya'): Promise<AskResult> => call('POST', '/api/ask', { text, actor }),
  plan: (task: string): Promise<Plan> => call('POST', '/api/plan', { task }),
  book: async (task: string): Promise<{ ok: true; booking: Booking; plan: Plan } | { ok: false; plan: Plan }> => {
    try { const r = await call('POST', '/api/book', { task, idem: crypto.randomUUID() }); return { ok: true, ...r }; }
    catch (e) { if (e instanceof ApiError && e.status === 409) return { ok: false, plan: e.body.plan }; throw e; }
  },
  answer: (predicate: string, value: unknown, place?: string): Promise<{ kind: 'reconfirmed' | 'corrected'; result: { status: string; reason?: string } }> => call('POST', '/api/answer', { predicate, value, place }),
  forget: (predicate: string, mode: 'block' | 'before'): Promise<Receipt> => call('POST', '/api/forget', { predicate, mode }),
  advance: (days: number): Promise<{ clock: number; retention: Receipt | null }> => call('POST', '/api/clock', { days }),
  exportEnvelope: (): Promise<any> => call('GET', '/api/export'),
  importEnvelope: (envelope: unknown): Promise<{ signed: boolean; reason: string; results: { index: number; status: string; reason?: string }[] }> => call('POST', '/api/import', { envelope }),
  queueWorker: (): Promise<{ id: string; baseRevision: number }> => call('POST', '/api/worker/queue'),
  releaseWorker: (): Promise<{ job: string; written: boolean; baseRevision: number; revision: number; reason: string }> => call('POST', '/api/worker/release'),
  reload: (): Promise<{ cacheEntriesDropped: number; state: State }> => call('POST', '/api/reload'),
  naive: (): Promise<Naive> => call('GET', '/api/naive'),
  health: (): Promise<{ ok: boolean; store: string; sessions: number }> => call('GET', '/api/health'),
};

export const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const OUTCOME_LABEL: Record<Decision['outcome'], string> = { USE: 'Use', QUALIFY: 'Use with caveat', ASK: 'Ask first', ABSTAIN: 'Abstain' };
export const KIND_LABEL: Record<string, string> = { user_statement: 'Direct statement', user_correction: 'Explicit correction', trusted_import: 'Trusted import', observed_event: 'Observed event', third_party: 'Third-party report', model_inference: 'Model inference' };
export const ROLE_LABEL: Record<string, string> = {
  leader: 'Relied on', supports: 'Supports', conflict: 'Conflicts', dispute: 'Disputes (overruled)', 'weak-dissent': 'Weak dissent', outdated: 'Outdated',
  corrected: 'Superseded by correction', 'less-specific': 'Less specific', 'out-of-scope': 'Different scope', 'not-valid-now': 'Another time',
};
