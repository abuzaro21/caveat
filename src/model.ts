// CAVEAT memory model: the types and the predicate registry (the documented policy every decision is computed from).
// A memory is not a row of truth. It is EVIDENCE: a structured assertion with a source, an observation time, a scope
// and a stance. Claims, grades, freshness and decisions are computed from evidence at query time (src/policy.ts).

export const DAY = 86_400_000;

export type SubjectId = 'maya' | 'sam';
export const SUBJECTS: Record<SubjectId, { name: string }> = { maya: { name: 'Maya' }, sam: { name: 'Sam' } };

/** Where a piece of evidence came from. The server assigns this from the ingestion channel, never from the payload. */
export type SourceKind =
  | 'user_statement'   // the subject said it directly
  | 'user_correction'  // the subject explicitly corrected an earlier memory
  | 'trusted_import'   // a structured record from a connected source the subject approved
  | 'observed_event'   // something that happened (e.g. a courier log) — behaviour, not intent
  | 'third_party'      // someone else's report, or an unsigned import
  | 'model_inference'; // the system guessed it from patterns

/** Evidence grades, strongest first. Categorical on purpose: no calibrated probabilities exist for this data. */
export type Grade = 'authoritative' | 'corroborated' | 'reported' | 'inferred' | 'unsupported';
export const GRADE_ORDER: Grade[] = ['unsupported', 'inferred', 'reported', 'corroborated', 'authoritative'];
export const gradeRank = (g: Grade) => GRADE_ORDER.indexOf(g);

export type Stance = 'supports' | 'opposes';
export type Purpose = 'advice' | 'action' | 'inspection';
export type Outcome = 'USE' | 'QUALIFY' | 'ASK' | 'ABSTAIN';
export type Scope = { place?: 'home' | 'office' };

export type Evidence = {
  id: string;
  subject: SubjectId;
  predicate: PredicateId;
  scopeKey: string;          // canonical scope, '' = general (applies to every place)
  value: unknown;            // JSON value; for 'opposes' the value being argued against
  stance: Stance;
  sourceKind: SourceKind;
  channel: string;           // how it entered: chat | correction | import:signed | import:unsigned | courier | inference | seed
  sourceLabel: string;       // human-readable source, e.g. "ParcelCo delivery log"
  lineage: string;           // original-source identity; copies share it, so they never count as corroboration
  originId: string;          // dedup key: the same ingested item can never be stored twice
  excerpt: string;           // what was actually said / observed (content: purged on forget)
  observedAt: number;        // when it was said or happened (virtual clock)
  ingestedAt: number;        // when CAVEAT learned it (virtual clock) — never refreshes freshness
  validFrom: number | null;
  validUntil: number | null;
  corrects: boolean;         // explicit correction: supersedes earlier evidence in the same subject/predicate/scope
  seq: number;               // ingestion order within the session: breaks ties between evidence observed at the same instant
};

export type PredicateId = 'delivery.window' | 'work.office_days' | 'home.city' | 'location.private' | 'delivery.hold';

export type PredicatePolicy = {
  label: string;
  /** Who is entitled to establish this fact. A user can establish their own preference, not a courier's schedule. */
  authoritativeKinds: SourceKind[];
  /** Max age of the latest confirmation for a consequential action, and for advice with a caveat (days). */
  actionHorizonDays: number;
  adviceHorizonDays: number;
  /** Retention: evidence of these kinds is deleted after this many days (virtual), without anyone remembering to. */
  retention?: { kinds: SourceKind[]; days: number };
  sensitive: boolean;
  /** Purposes the subject consented to. Sensitive predicates are used only for these (plus the subject's own inspection). */
  consentedPurposes: string[];
  /** Other household members may read this predicate about the subject. */
  householdShared: boolean;
  scoped: boolean;           // has a place dimension
  why: string;               // why the freshness numbers are what they are (shown in the inspector)
};

const ME: SourceKind[] = ['user_statement', 'user_correction'];
export const PREDICATES: Record<PredicateId, PredicatePolicy> = {
  'delivery.window': {
    label: 'Delivery window', authoritativeKinds: ME, actionHorizonDays: 180, adviceHorizonDays: 365,
    retention: { kinds: ['observed_event', 'third_party'], days: 60 },
    sensitive: false, consentedPurposes: ['delivery-planning'], householdShared: true, scoped: true,
    why: 'Routines drift with jobs and seasons: an action needs a confirmation from the last 6 months.',
  },
  'work.office_days': {
    label: 'Office days', authoritativeKinds: ME, actionHorizonDays: 90, adviceHorizonDays: 180,
    sensitive: false, consentedPurposes: ['delivery-planning'], householdShared: false, scoped: false,
    why: 'Work patterns change with projects and teams: re-checked every 90 days before acting on them.',
  },
  'home.city': {
    label: 'Home city', authoritativeKinds: [...ME, 'trusted_import'], actionHorizonDays: 1825, adviceHorizonDays: 3650,
    sensitive: false, consentedPurposes: ['delivery-planning'], householdShared: true, scoped: false,
    why: 'People rarely move: a home city stays usable for years, so a 2-year-old statement is still fresh.',
  },
  'location.private': {
    label: 'Private recurring location', authoritativeKinds: ME, actionHorizonDays: 60, adviceHorizonDays: 90,
    sensitive: true, consentedPurposes: ['delivery-planning'], householdShared: false, scoped: false,
    why: 'Sensitive: used only to avoid booking deliveries while you are out, and only while confirmed in the last 60 days.',
  },
  'delivery.hold': {
    label: 'Delivery hold', authoritativeKinds: ME, actionHorizonDays: 30, adviceHorizonDays: 30,
    sensitive: false, consentedPurposes: ['delivery-planning'], householdShared: true, scoped: false,
    why: 'Only valid between its own start and end dates.',
  },
};
export const isPredicate = (p: unknown): p is PredicateId => typeof p === 'string' && Object.hasOwn(PREDICATES, p);

/** Closed value vocabularies. Anything else is rejected at the write path. */
export const WINDOWS = ['morning', 'afternoon', 'evening'] as const;
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export const DAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
export const WINDOW_HOURS: Record<(typeof WINDOWS)[number], [number, number]> = { morning: [8, 12], afternoon: [13, 17], evening: [18, 21] };

export function validateValue(p: PredicateId, v: unknown): string | null {
  switch (p) {
    case 'delivery.window': return typeof v === 'string' && (WINDOWS as readonly string[]).includes(v) ? null : 'window must be morning, afternoon or evening';
    case 'work.office_days': return Array.isArray(v) && v.length > 0 && v.length <= 5 && v.every((d) => (WEEKDAYS as readonly string[]).includes(d)) && new Set(v).size === v.length ? null : 'office days must be distinct weekdays';
    case 'home.city': return typeof v === 'string' && /^[\p{L} .'-]{2,40}$/u.test(v) ? null : 'city must be 2-40 letters';
    case 'location.private': return v && typeof v === 'object' && typeof (v as any).label === 'string' && (v as any).label.length <= 60 && WEEKDAYS.includes((v as any).day) && Number.isInteger((v as any).from) && Number.isInteger((v as any).to) && (v as any).from >= 0 && (v as any).to <= 24 && (v as any).from < (v as any).to ? null : 'private location needs label, day, from, to';
    case 'delivery.hold': return v === true ? null : 'hold must be true';
  }
}

export function scopeKey(p: PredicateId, s: Scope | undefined): string {
  if (!PREDICATES[p].scoped || !s?.place) return '';
  if (s.place !== 'home' && s.place !== 'office') throw new Error('bad place');
  return `place=${s.place}`;
}
export const scopeLabel = (k: string) => (k ? k.replace('place=', '') : 'everywhere');

export function valueLabel(p: PredicateId, v: unknown): string {
  switch (p) {
    case 'delivery.window': return `${String(v)}s`;
    case 'work.office_days': return (v as string[]).map((d) => DAY_NAMES[d]).join(' & ');
    case 'home.city': return String(v);
    case 'location.private': { const x = v as { label: string; day: string; from: number; to: number }; return `${x.label}, ${DAY_NAMES[x.day]}s ${x.from}:00–${x.to}:00`; }
    case 'delivery.hold': return 'hold deliveries';
  }
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
