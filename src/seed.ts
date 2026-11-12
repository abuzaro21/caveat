// The synthetic household every demo session starts with. Fictional people, fictional places, fixed virtual dates.
// Virtual "today" is Thursday 12 November 2026, 09:00 UTC; every scenario advances from there.
import type { PredicateId, Scope, SourceKind, Stance, SubjectId } from './model.ts';

export const START = Date.UTC(2026, 10, 12, 9, 0, 0);
const at = (y: number, m: number, d: number, h = 10, min = 0) => Date.UTC(y, m - 1, d, h, min);

export type SeedItem = {
  subject: SubjectId; predicate: PredicateId; scope?: Scope; value: unknown; stance?: Stance;
  sourceKind: SourceKind; channel: string; sourceLabel: string; lineage: string; originId: string;
  excerpt: string; observedAt: number; validFrom?: number; validUntil?: number;
};

export const SEED: SeedItem[] = [
  { subject: 'maya', predicate: 'delivery.window', scope: { place: 'home' }, value: 'morning', sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Maya, in chat', lineage: 'subject:maya', originId: 'seed-1', observedAt: at(2026, 7, 14),
    excerpt: 'Mornings are best for deliveries at home. I am always in before noon.' },
  { subject: 'maya', predicate: 'delivery.window', scope: { place: 'office' }, value: 'morning', sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Maya, in chat', lineage: 'subject:maya', originId: 'seed-2', observedAt: at(2026, 9, 1),
    excerpt: 'At the office mornings are fine. Reception opens at 8.' },
  ...[at(2026, 10, 28, 9, 40), at(2026, 11, 4, 9, 55), at(2026, 11, 10, 10, 15)].map((t, i) => ({
    subject: 'maya' as const, predicate: 'delivery.window' as const, scope: { place: 'home' as const }, value: 'morning', stance: 'opposes' as const,
    sourceKind: 'observed_event' as const, channel: 'courier', sourceLabel: 'ParcelCo delivery log', lineage: 'courier:parcelco', originId: `seed-courier-${i + 1}`,
    observedAt: t, excerpt: `Morning attempt at ${new Date(t).toISOString().slice(11, 16)}: nobody home, card left.` })),
  { subject: 'maya', predicate: 'delivery.window', scope: { place: 'home' }, value: 'evening', sourceKind: 'model_inference', channel: 'inference',
    sourceLabel: 'Order-pattern inference', lineage: 'model:order-times', originId: 'seed-6', observedAt: at(2026, 11, 11, 22),
    excerpt: 'Most orders are placed 19:00–21:00, so evenings might suit.' },
  { subject: 'sam', predicate: 'delivery.window', scope: { place: 'home' }, value: 'evening', sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Sam, in chat', lineage: 'subject:sam', originId: 'seed-7', observedAt: at(2026, 10, 2),
    excerpt: 'Evenings for my parcels, please.' },
  { subject: 'maya', predicate: 'work.office_days', value: ['tue', 'thu'], sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Maya, in chat', lineage: 'subject:maya', originId: 'seed-8', observedAt: at(2026, 8, 20),
    excerpt: 'I am in the office on Tuesdays and Thursdays.' },
  { subject: 'maya', predicate: 'home.city', value: 'Porto', sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Maya, in chat', lineage: 'subject:maya', originId: 'seed-9', observedAt: at(2024, 10, 1),
    excerpt: 'I live in Porto.' },
  { subject: 'maya', predicate: 'home.city', value: 'Porto', sourceKind: 'trusted_import', channel: 'import:addressbook',
    sourceLabel: 'Connected address book', lineage: 'import:addressbook', originId: 'seed-10', observedAt: at(2025, 1, 15),
    excerpt: 'Contact card: city Porto.' },
  { subject: 'maya', predicate: 'location.private', value: { label: 'Harbour Physio', day: 'fri', from: 15, to: 17 }, sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Maya, in chat', lineage: 'subject:maya', originId: 'seed-11', observedAt: at(2026, 11, 5),
    excerpt: 'Never book anything on Friday 15:00–17:00. I am at Harbour Physio on Rua das Flores.' },
  { subject: 'maya', predicate: 'delivery.hold', value: true, sourceKind: 'user_statement', channel: 'chat',
    sourceLabel: 'Maya, in chat', lineage: 'subject:maya', originId: 'seed-12', observedAt: at(2026, 7, 25),
    validFrom: at(2026, 8, 1, 0), validUntil: at(2026, 8, 15, 23, 59), excerpt: 'Away 1–15 August. Hold all deliveries.' },
];
