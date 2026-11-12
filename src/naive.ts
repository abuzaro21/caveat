// NEGATIVE CONTROL. A deliberately naive memory, run only on the static synthetic seed (never on a visitor's session,
// never on real data, no external calls). It shows what the same inputs produce without CAVEAT's policies:
// latest text wins, scope and person are ignored, freshness is ignored, and "forget" only hides a row.
import { PREDICATES, valueLabel } from './model.ts';
import { SEED } from './seed.ts';
import { WINDOW_HOURS } from './model.ts';

type Row = { id: number; predicate: string; text: string; value: unknown; writtenAt: number; hidden: boolean; who: string };

export function naiveDemo() {
  const rows: Row[] = SEED.filter((s) => (s.stance ?? 'supports') === 'supports')
    .map((s, i) => ({ id: i + 1, predicate: s.predicate, text: s.excerpt, value: s.value, writtenAt: s.observedAt, hidden: false, who: s.sourceLabel }));
  const index = new Map<number, string[]>(rows.map((r) => [r.id, r.text.toLowerCase().split(/\W+/).filter((w) => w.length > 3)]));
  const recall = (p: string) => rows.filter((r) => r.predicate === p && !r.hidden).sort((a, b) => b.writtenAt - a.writtenAt)[0];

  const w = recall('delivery.window')!;
  const booking = {
    window: valueLabel('delivery.window', w.value),
    hours: WINDOW_HOURS[w.value as keyof typeof WINDOW_HOURS],
    basedOn: `${w.who}: "${w.text}"`,
    said: `Booked: ${valueLabel('delivery.window', w.value)}. (No caveat, no question.)`,
    problems: ['used the newest row, which is a model guess', 'ignored whose preference it was and for which place', 'ignored three missed morning deliveries', 'ignored that the July statement was the only direct one'],
  };
  const office = recall('work.office_days')!;
  const stale = { said: `Office days: ${valueLabel('work.office_days', office.value)}. (Any age is "current".)` };

  const secret = rows.find((r) => r.predicate === 'location.private')!;
  secret.hidden = true; // naive "forget"
  const terms = index.get(secret.id)!;
  const exported = JSON.stringify(rows); // naive export dumps every row, hidden or not
  const forgetting = {
    hiddenFromUi: true,
    stillInIndex: terms.length,
    stillInExport: exported.includes(secret.text),
    reimportAccepted: true, // no tombstone: restoring an old backup brings it straight back
    label: PREDICATES['location.private'].label,
  };
  return { booking, stale, forgetting, note: 'Negative control on the fixed synthetic seed only. It never touches a visitor session.' };
}
