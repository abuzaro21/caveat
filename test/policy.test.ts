// Pure decision-policy tests: every verdict is a function of evidence, tombstones, query and virtual time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy.ts';
import { DAY } from '../src/model.ts';
import { START } from '../src/seed.ts';
import { ev, q } from './helpers.ts';

const home = { place: 'home' as const }, office = { place: 'office' as const };

test('same statement, different scopes: not a contradiction', () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', scope: office, sourceKind: 'user_statement', daysAgo: 10 }),
    ev({ predicate: 'delivery.window', value: 'afternoon', scope: home, sourceKind: 'user_statement', daysAgo: 5 })];
  const h = evaluate(all, [], q('delivery.window', 'action', home));
  const o = evaluate(all, [], q('delivery.window', 'action', office));
  assert.equal(h.outcome, 'USE'); assert.equal(h.value, 'afternoon'); assert.equal(h.conflict.state, 'none');
  assert.equal(o.outcome, 'USE'); assert.equal(o.value, 'morning'); assert.equal(o.conflict.state, 'none');
  assert.equal(h.considered.find((c) => c.valueLabel === 'mornings')!.role, 'out-of-scope');
});

test("another person's preference is a different fact, not a contradiction", () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 10 }),
    ev({ subject: 'sam', predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'user_statement', daysAgo: 1 })];
  const d = evaluate(all, [], q('delivery.window', 'action', home));
  assert.equal(d.outcome, 'USE'); assert.equal(d.value, 'morning'); assert.equal(d.conflict.state, 'none');
});

test('newer reported evidence against an authoritative statement: contested, action asks, advice qualifies', () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 100 }),
    ev({ predicate: 'delivery.window', value: 'morning', stance: 'opposes', scope: home, sourceKind: 'observed_event', daysAgo: 3, sourceLabel: 'Courier' })];
  const a = evaluate(all, [], q('delivery.window', 'action', home));
  assert.equal(a.outcome, 'ASK'); assert.equal(a.conflict.state, 'contested'); assert.ok(a.mightBeWrong);
  assert.match(a.sentence, /^I might be wrong about this\./);
  const adv = evaluate(all, [], q('delivery.window', 'advice', home));
  assert.equal(adv.outcome, 'QUALIFY'); assert.ok(adv.sentence.startsWith('I might be wrong about this.'));
});

test('older contradicting evidence is outdated, not a conflict', () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', stance: 'opposes', scope: home, sourceKind: 'observed_event', daysAgo: 30 }),
    ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 2 })];
  const d = evaluate(all, [], q('delivery.window', 'action', home));
  assert.equal(d.outcome, 'USE'); assert.equal(d.considered.find((c) => c.stance === 'opposes')!.role, 'outdated');
});

test('a model inference never outweighs a direct statement, even when newer', () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 20 }),
    ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'model_inference', daysAgo: 1 })];
  const d = evaluate(all, [], q('delivery.window', 'action', home));
  assert.equal(d.outcome, 'USE'); assert.equal(d.value, 'morning'); assert.equal(d.conflict.state, 'weak-dissent');
});

test('an inference alone is never enough to act', () => {
  const d = evaluate([ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'model_inference', daysAgo: 1 })], [], q('delivery.window', 'action', home));
  assert.equal(d.outcome, 'ASK'); assert.equal(d.grade, 'inferred'); assert.ok(d.mightBeWrong);
});

test('low-authority source later than a user correction cannot override it', () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 60 }),
    ev({ predicate: 'delivery.window', value: 'afternoon', scope: home, sourceKind: 'user_correction', daysAgo: 10 }),
    ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'third_party', daysAgo: 1, sourceLabel: 'Imported note' })];
  const d = evaluate(all, [], q('delivery.window', 'action', home));
  assert.equal(d.outcome, 'USE'); assert.equal(d.value, 'afternoon'); assert.equal(d.conflict.state, 'disputed-after-correction');
  assert.equal(d.considered.find((c) => c.sourceLabel === 'Imported note')!.role, 'dispute');
});

test('a correction supersedes earlier evidence of any authority, in its own scope only', () => {
  const all = [ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 60 }),
    ev({ predicate: 'delivery.window', value: 'morning', scope: office, sourceKind: 'user_statement', daysAgo: 60 }),
    ev({ predicate: 'delivery.window', value: 'morning', stance: 'opposes', scope: home, sourceKind: 'observed_event', daysAgo: 5 }),
    ev({ predicate: 'delivery.window', value: 'afternoon', scope: home, sourceKind: 'user_correction', daysAgo: 0 })];
  const h = evaluate(all, [], q('delivery.window', 'action', home));
  assert.equal(h.value, 'afternoon'); assert.equal(h.outcome, 'USE');
  assert.equal(h.considered.filter((c) => c.role === 'corrected').length, 2);
  assert.equal(evaluate(all, [], q('delivery.window', 'action', office)).value, 'morning');
});

test('copies from one source never count as corroboration; independent sources do', () => {
  const copies = [1, 2, 3].map((i) => ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'third_party', daysAgo: i, lineage: 'blog:one' }));
  const d1 = evaluate(copies, [], q('delivery.window', 'action', home));
  assert.equal(d1.grade, 'reported'); assert.equal(d1.outcome, 'ASK');
  assert.ok(d1.gradeReasons.some((r) => /counted once/.test(r)));
  const indep = [ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'third_party', daysAgo: 1, lineage: 'a' }),
    ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'observed_event', daysAgo: 2, lineage: 'b' })];
  const d2 = evaluate(indep, [], q('delivery.window', 'action', home));
  assert.equal(d2.grade, 'corroborated'); assert.equal(d2.outcome, 'USE');
});

test('confidence is not cosmetic: the same wording with weaker evidence blocks the action', () => {
  const strong = evaluate([ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'user_statement', daysAgo: 1, excerpt: 'Evenings please' })], [], q('delivery.window', 'action', home));
  const weak = evaluate([ev({ predicate: 'delivery.window', value: 'evening', scope: home, sourceKind: 'third_party', daysAgo: 1, excerpt: 'Evenings please' })], [], q('delivery.window', 'action', home));
  assert.equal(strong.outcome, 'USE'); assert.equal(weak.outcome, 'ASK');
});

test('staleness depends on the predicate policy, not on age alone', () => {
  const city = ev({ predicate: 'home.city', value: 'Porto', sourceKind: 'user_statement', daysAgo: 730 });
  const days = ev({ predicate: 'work.office_days', value: ['tue'], sourceKind: 'user_statement', daysAgo: 100 });
  assert.equal(evaluate([city], [], q('home.city')).outcome, 'USE');              // 2 years old, still fresh
  const d = evaluate([days], [], q('work.office_days'));
  assert.equal(d.outcome, 'ASK'); assert.equal(d.freshness!.state, 'review-due'); // 100 days old, too old to act on
  assert.equal(evaluate([days], [], q('work.office_days', 'advice')).outcome, 'QUALIFY');
  const ancient = ev({ predicate: 'work.office_days', value: ['tue'], sourceKind: 'user_statement', daysAgo: 400 });
  assert.equal(evaluate([ancient], [], q('work.office_days', 'advice')).freshness!.state, 'stale');
});

test('the same claim becomes stale when the virtual clock advances', () => {
  const e = ev({ predicate: 'work.office_days', value: ['tue', 'thu'], sourceKind: 'user_statement', daysAgo: 80 });
  assert.equal(evaluate([e], [], q('work.office_days')).outcome, 'USE');
  assert.equal(evaluate([e], [], q('work.office_days', 'action', undefined, { now: START + 30 * DAY })).outcome, 'ASK');
});

test('validity intervals: an expired hold describes another time', () => {
  const hold = ev({ predicate: 'delivery.hold', value: true, sourceKind: 'user_statement', daysAgo: 100, validFrom: START - 90 * DAY, validUntil: START - 75 * DAY });
  const d = evaluate([hold], [], q('delivery.hold', 'advice'));
  assert.equal(d.outcome, 'ABSTAIN'); assert.equal(d.considered[0].role, 'not-valid-now'); assert.match(d.sentence, /another time/);
  assert.equal(evaluate([hold], [], q('delivery.hold', 'advice', undefined, { now: START - 80 * DAY })).outcome, 'USE');
});

test('consent: a sensitive memory is unavailable outside its consented purpose', () => {
  const p = ev({ predicate: 'location.private', value: { label: 'Clinic', day: 'fri', from: 15, to: 17 }, sourceKind: 'user_statement', daysAgo: 3 });
  assert.equal(evaluate([p], [], q('location.private', 'action')).outcome, 'USE');
  const d = evaluate([p], [], q('location.private', 'advice', undefined, { consentPurpose: 'marketing' }));
  assert.equal(d.outcome, 'ABSTAIN'); assert.equal(d.blockedBy, 'consent'); assert.equal(d.considered.length, 0);
});

test("access: Sam cannot read Maya's sensitive memory, nor inspect hers", () => {
  const p = ev({ predicate: 'location.private', value: { label: 'Clinic', day: 'fri', from: 15, to: 17 }, sourceKind: 'user_statement', daysAgo: 3 });
  const d = evaluate([p], [], q('location.private', 'action', undefined, { actor: 'sam' }));
  assert.equal(d.outcome, 'ABSTAIN'); assert.equal(d.blockedBy, 'not-permitted'); assert.equal(d.considered.length, 0);
  assert.equal(evaluate([p], [], q('location.private', 'inspection', undefined, { actor: 'sam' })).blockedBy, 'not-permitted');
});

test('a revoked topic abstains even if evidence were somehow still present', () => {
  const p = ev({ predicate: 'location.private', value: { label: 'Clinic', day: 'fri', from: 15, to: 17 }, sourceKind: 'user_statement', daysAgo: 3 });
  const d = evaluate([p], [{ subject: 'maya', predicate: 'location.private', mode: 'block', revokedAt: START }], q('location.private', 'inspection'));
  assert.equal(d.outcome, 'ABSTAIN'); assert.equal(d.blockedBy, 'revoked'); assert.equal(d.considered.length, 0);
});

test('no evidence: advice abstains and does not claim it might be wrong; action asks', () => {
  const a = evaluate([], [], q('home.city', 'advice'));
  assert.equal(a.outcome, 'ABSTAIN'); assert.equal(a.mightBeWrong, false);
  assert.equal(evaluate([], [], q('home.city', 'action')).outcome, 'ASK');
});

test('specific scope beats general; general is used as a labelled fallback', () => {
  const g = ev({ predicate: 'delivery.window', value: 'evening', sourceKind: 'user_statement', daysAgo: 5 });
  const d = evaluate([g], [], q('delivery.window', 'advice', home));
  assert.equal(d.scopeMatch, 'general'); assert.equal(d.outcome, 'USE'); assert.ok(d.reasons.some((r) => /general memory/.test(r)));
  const s = ev({ predicate: 'delivery.window', value: 'morning', scope: home, sourceKind: 'user_statement', daysAgo: 50 });
  const d2 = evaluate([g, s], [], q('delivery.window', 'action', home));
  assert.equal(d2.value, 'morning'); assert.equal(d2.scopeMatch, 'exact');
});
