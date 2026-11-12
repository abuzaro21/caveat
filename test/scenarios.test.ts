// The three demo scenarios, end to end through the memory service and a real database (SQLite, or PostgreSQL when
// CAVEAT_TEST_DATABASE_URL is set). These are the failure tests in docs/FAILURE-TEST.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Blocked } from '../src/memory.ts';
import { makeCaveat, closeAll } from './helpers.ts';

after(closeAll);

test('A — contradiction: the agent says it might be wrong, refuses to book, accepts a correction, then books', async () => {
  const { c, sid } = await makeCaveat();
  const p = await c.plan(sid, 'sofa-home');
  assert.equal(p.canBook, false);
  const d = p.blockedBy!;
  assert.equal(d.outcome, 'ASK'); assert.equal(d.conflict.state, 'contested'); assert.equal(d.valueLabel, 'mornings');
  assert.match(d.sentence, /^I might be wrong about this\. You told me mornings on 14 Jul 2026, but ParcelCo delivery log has 3 newer reports/);
  // Both sides of the conflict are surfaced, the guess is shown as weak, other scopes/people are not conflicts.
  const roles = Object.groupBy(d.considered, (x) => x.role);
  assert.equal(roles.leader?.length, 1); assert.equal(roles.conflict?.length, 3); assert.equal(roles['weak-dissent']?.length, 1);
  assert.equal(roles['out-of-scope']?.length, 2);
  // The backend refuses even a direct booking request.
  await assert.rejects(c.book(sid, 'sofa-home', 'direct-attempt-1'), (e) => e instanceof Blocked);
  assert.equal((await c.state(sid)).bookings.length, 0);
  // Correction → re-evaluation → booking.
  const a = await c.answer(sid, 'delivery.window', { place: 'home' }, 'afternoon');
  assert.equal(a.kind, 'corrected');
  const p2 = await c.plan(sid, 'sofa-home');
  assert.equal(p2.canBook, true); assert.equal(p2.decisions[0].outcome, 'USE'); assert.equal(p2.decisions[0].valueLabel, 'afternoons');
  assert.equal(p2.decisions[0].considered.filter((x) => x.role === 'corrected').length, 5); // July statement + 3 courier reports + the guess
  assert.equal(p2.slot!.label, 'Mon 16 Nov, 13:00–17:00');     // Friday skipped: private appointment
  assert.match(p2.skipped[0].reason, /Harbour Physio/);
  const b = await c.book(sid, 'sofa-home', 'booking-key-1');
  assert.equal(b.duplicate, false);
  const again = await c.book(sid, 'sofa-home', 'booking-key-1');
  assert.equal(again.duplicate, true); assert.equal((await c.state(sid)).bookings.length, 1);
  // The office preference was not touched by the home correction.
  assert.equal((await c.decide(sid, { predicate: 'delivery.window', scope: { place: 'office' }, purpose: 'action' })).valueLabel, 'mornings');
});

test('B — stale memory: advancing the clock past the policy horizon blocks the action until reconfirmed', async () => {
  const { c, sid } = await makeCaveat();
  assert.equal((await c.plan(sid, 'repair-office')).canBook, true);
  await c.advance(sid, 30);
  const p = await c.plan(sid, 'repair-office');
  assert.equal(p.canBook, false);
  assert.equal(p.blockedBy!.predicate, 'work.office_days'); assert.equal(p.blockedBy!.freshness!.state, 'review-due');
  assert.match(p.blockedBy!.sentence, /^I might be wrong about this\. You told me Tuesday & Thursday on 20 Aug 2026\. That was 113 days ago/);
  // The two-year-old home city is still fine: staleness is per-predicate policy, not age.
  assert.equal((await c.decide(sid, { predicate: 'home.city', purpose: 'action' })).outcome, 'USE');
  await c.answer(sid, 'work.office_days', undefined, ['mon', 'wed']);
  const p2 = await c.plan(sid, 'repair-office');
  assert.equal(p2.canBook, true); assert.match(p2.slot!.label, /^Mon 14 Dec/);
});

test('B — reconfirming the same value is a statement, not a correction', async () => {
  const { c, sid } = await makeCaveat();
  await c.advance(sid, 30);
  const a = await c.answer(sid, 'work.office_days', undefined, ['tue', 'thu']);
  assert.equal(a.kind, 'reconfirmed');
  assert.equal((await c.plan(sid, 'repair-office')).canBook, true);
});

test('C — revocation: purged everywhere, verified receipt, no retrieval, no resurrection by import or delayed worker', async () => {
  const { c, sid } = await makeCaveat();
  await c.answer(sid, 'delivery.window', { place: 'home' }, 'afternoon');
  const booked = await c.book(sid, 'sofa-home', 'booking-key-2');
  assert.match(booked.booking.reason, /Harbour Physio/);
  const before = await c.ask(sid, 'Where am I on Friday afternoons?');
  assert.match(before.reply, /Harbour Physio/);
  const oldExport = await c.exportEnvelope(sid);
  assert.ok(JSON.stringify(oldExport).includes('Harbour Physio'));
  await c.queueDigest(sid);

  const r = await c.forget(sid, 'maya', 'location.private', 'block');
  assert.equal(r.verified, true, JSON.stringify((r as any).verification.filter((v: any) => !v.pass)));
  assert.equal((r as any).deleted.evidence, 1); assert.ok((r as any).deleted.indexEntries > 0); assert.equal((r as any).deleted.usageRecords, 1);
  assert.equal((r as any).rewritten.bookingReasons, 1);
  assert.ok(!JSON.stringify(r).includes('Harbour'), 'receipt must not contain the forgotten content');

  const st = await c.state(sid);
  const dump = JSON.stringify(st);
  for (const marker of ['Harbour', 'Physio', 'Flores']) assert.ok(!dump.includes(marker), `state still contains ${marker}`);
  assert.equal(st.memories.some((m) => m.predicate === 'location.private'), false);
  assert.equal(st.bookings[0].start, booked.booking.start, 'the booking itself stays; only its quoted reason is removed');

  const after1 = await c.ask(sid, 'Where am I on Friday afternoons?');
  assert.equal(after1.decisions[0].outcome, 'ABSTAIN'); assert.equal(after1.decisions[0].blockedBy, 'revoked');
  assert.ok(!JSON.stringify(after1).includes('Harbour'));
  // A planner no longer avoids the private time: it truly does not know it.
  const p = await c.plan(sid, 'sofa-home');
  assert.equal(p.privacy.used, false); assert.equal(p.skipped.length, 0); assert.match(p.slot!.label, /^Fri 13 Nov/);

  c.reload();
  assert.ok(!JSON.stringify(await c.state(sid)).includes('Harbour'));
  const imp = await c.importEnvelope(sid, oldExport);
  assert.equal(imp.signed, true);
  assert.deepEqual(imp.results.filter((x) => x.status === 'rejected').map((x) => x.reason), ['topic revoked: not relearned']);
  assert.equal(imp.results.filter((x) => x.status === 'stored').length, 0, 'everything else is a duplicate');
  const w = await c.releaseDigest(sid);
  assert.equal(w.written, false); assert.match(w.reason, /^fenced/);
  assert.ok(!JSON.stringify(await c.state(sid)).includes('Harbour'));
  // Even telling it again is refused, because the user chose "never relearn".
  const again = await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: 'location.private', value: { label: 'Harbour Physio', day: 'fri', from: 15, to: 17 } }]);
  assert.equal(again[0].status, 'rejected');
});

test('C — "forget, but you may learn it again": old copies stay blocked, a new statement is accepted', async () => {
  const { c, sid } = await makeCaveat();
  const oldExport = await c.exportEnvelope(sid);
  const r = await c.forget(sid, 'maya', 'location.private', 'before');
  assert.equal(r.verified, true);
  const imp = await c.importEnvelope(sid, oldExport);
  assert.equal(imp.results.find((x) => x.status === 'rejected')!.reason, 'revoked: observed before the forget request');
  await c.advance(sid, 1);
  const fresh = await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: 'location.private', value: { label: 'Gym', day: 'mon', from: 18, to: 19 } }]);
  assert.equal(fresh[0].status, 'stored');
  const d = await c.decide(sid, { predicate: 'location.private', purpose: 'inspection' });
  assert.equal(d.valueLabel, 'Gym, Mondays 18:00–19:00');
});

test('retention: courier records are deleted automatically after 60 virtual days, with a receipt', async () => {
  const { c, sid } = await makeCaveat();
  const r1 = await c.advance(sid, 30);
  assert.equal(r1.retention, null);
  const r2 = await c.advance(sid, 17); // now 29 Dec: the 28 Oct record is past 60 days, 4 Nov and 10 Nov are not
  assert.ok(r2.retention); assert.equal((r2.retention as any).deleted.evidence, 1);
  const r3 = await c.advance(sid, 30);
  assert.equal((r3.retention as any).deleted.evidence, 2);
  const st = await c.state(sid);
  assert.equal(JSON.stringify(st).includes('ParcelCo'), false);
  assert.equal(st.receipts.filter((x: any) => x.kind === 'retention').length, 2);
  // An old import cannot bring an expired courier record back.
  const res = await c.importEnvelope(sid, { items: [{ subject: 'maya', predicate: 'delivery.window', scope: { place: 'home' }, value: 'morning', stance: 'opposes', observedAt: Date.UTC(2026, 9, 28), sourceKind: 'observed_event' }] });
  assert.equal(res.signed, false);
  assert.deepEqual(res.results[0], { index: 0, status: 'rejected', reason: 'past its retention period' });
});
