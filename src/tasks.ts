// The assistant's consequential tasks. Planning is pure: it turns decisions into a proposed slot or a refusal.
// Booking (src/memory.ts) recomputes this inside the write transaction, so a stale plan in the browser carries no authority.
import { DAY, WEEKDAYS, WINDOW_HOURS, DAY_NAMES, type Evidence, type PredicateId, type Scope } from './model.ts';
import { evaluate, type Decision, type Tombstone } from './policy.ts';

export type TaskId = 'sofa-home' | 'repair-office';
export const TASKS: Record<TaskId, { label: string; place: 'home' | 'office'; needs: { predicate: PredicateId; scope?: Scope }[] }> = {
  'sofa-home': { label: 'Book the sofa delivery to home', place: 'home', needs: [{ predicate: 'delivery.window', scope: { place: 'home' } }] },
  'repair-office': { label: 'Send the laptop repair to the office', place: 'office', needs: [{ predicate: 'delivery.window', scope: { place: 'office' } }, { predicate: 'work.office_days' }] },
};
export const isTask = (t: unknown): t is TaskId => typeof t === 'string' && Object.hasOwn(TASKS, t);

export type Plan = {
  task: TaskId; label: string; place: string;
  decisions: Decision[];          // the memories the task depends on, each with its verdict
  privacy: { used: boolean; note: string; evidenceIds: string[] };
  hold: { active: boolean; note: string };
  canBook: boolean;
  blockedBy: Decision | null;     // the first memory that is not safe to act on
  slot: { start: number; end: number; label: string } | null;
  skipped: { label: string; reason: string; deps: string[] }[]; // deps: the evidence that caused the skip
  evidenceIds: string[];          // what a booking would rely on (recorded as "where used")
};

const dayKey = (t: number) => WEEKDAYS[(new Date(t).getUTCDay() + 6) % 7] as string | undefined; // mon..fri, undefined at weekends
export const slotLabel = (s: number, e: number) =>
  `${new Date(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${new Date(s).getUTCHours()}:00–${new Date(e).getUTCHours()}:00`;

export function plan(all: Evidence[], tombs: Tombstone[], task: TaskId, now: number): Plan {
  const t = TASKS[task];
  const q = (predicate: PredicateId, scope?: Scope) => evaluate(all, tombs, { actor: 'maya', subject: 'maya', predicate, scope, purpose: 'action', consentPurpose: 'delivery-planning', now });
  const decisions = t.needs.map((n) => q(n.predicate, n.scope));
  const blockedBy = decisions.find((d) => d.outcome !== 'USE') ?? null;

  const holdD = evaluate(all, tombs, { actor: 'maya', subject: 'maya', predicate: 'delivery.hold', purpose: 'action', now });
  const hold = { active: holdD.outcome === 'USE', note: holdD.outcome === 'USE' ? 'Deliveries are on hold right now.' : 'No delivery hold applies today.' };

  // The private location is used only for its consented purpose, and only while it is fresh and uncontested.
  const priv = q('location.private');
  const privacy = priv.outcome === 'USE'
    ? { used: true, note: 'Avoiding the times you said you are out.', evidenceIds: priv.considered.filter((c) => c.role === 'leader' || c.role === 'supports').map((c) => c.id) }
    : { used: false, note: priv.blockedBy === 'revoked' ? 'A forgotten memory is not used.' : 'No private-schedule memory is used.', evidenceIds: [] };

  const base = { task, label: t.label, place: t.place, decisions, privacy, hold, skipped: [] as Plan['skipped'] };
  const evidenceIds = [...new Set([...decisions.flatMap((d) => d.considered.filter((c) => c.role === 'leader' || c.role === 'supports').map((c) => c.id)), ...privacy.evidenceIds])];
  if (blockedBy || hold.active) return { ...base, canBook: false, blockedBy, slot: null, evidenceIds };

  const window = decisions[0].value as keyof typeof WINDOW_HOURS;
  const days = t.place === 'office' ? (decisions.find((d) => d.predicate === 'work.office_days')!.value as string[]) : [...WEEKDAYS];
  const [h0, h1] = WINDOW_HOURS[window];
  const pv = privacy.used ? (priv.value as { label: string; day: string; from: number; to: number }) : null;
  const skipped: Plan['skipped'] = [];
  const day0 = Math.floor(now / DAY) * DAY;
  for (let i = 1; i <= 21; i++) {
    const d = day0 + i * DAY; const k = dayKey(d);
    if (!k || !days.includes(k)) continue;
    const start = d + h0 * 3600_000, end = d + h1 * 3600_000;
    if (pv && pv.day === k && pv.from < h1 && pv.to > h0) {
      skipped.push({ label: slotLabel(start, end), reason: `you are usually at ${pv.label} on ${DAY_NAMES[k]}s ${pv.from}:00–${pv.to}:00`, deps: privacy.evidenceIds });
      continue;
    }
    // A hold is checked against the whole delivery slot, not only against today: at both ends, and at every moment
    // inside the slot where a hold's validity starts or ends, so a hold wholly inside the slot also blocks it.
    const inside = (t: number | null) => t !== null && t > start && t < end;
    const points = new Set([start, end - 1]);
    for (const e of all) if (e.predicate === 'delivery.hold') for (const b of [e.validFrom, e.validUntil]) if (inside(b)) { points.add(b!); points.add(b! - 1); }
    const held = [...points].sort((a, b) => a - b).map((at) => evaluate(all, tombs, { actor: 'maya', subject: 'maya', predicate: 'delivery.hold', purpose: 'action', now: at })).find((h) => h.value === true);
    if (held) {
      skipped.push({ label: slotLabel(start, end), reason: 'your deliveries are on hold then', deps: held.considered.filter((c) => c.role === 'leader' || c.role === 'supports').map((c) => c.id) });
      continue;
    }
    return { ...base, skipped, canBook: true, blockedBy: null, slot: { start, end, label: slotLabel(start, end) }, evidenceIds };
  }
  return { ...base, skipped, canBook: false, blockedBy: null, slot: null, evidenceIds };
}
