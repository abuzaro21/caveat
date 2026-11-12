// Regression tests for Codex adversarial review 1 (docs/reviews/codex-review-1.md). One test per finding, numbered alike.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { DAY } from '../src/model.ts';
import { createApp } from '../src/server.ts';
import { evaluate } from '../src/policy.ts';
import { makeCaveat, closeAll, ev, q } from './helpers.ts';

after(closeAll);
const HOME = { place: 'home' as const };

async function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => s.end(text));
    let out = ''; s.on('data', (d) => (out += d)); s.on('end', () => resolve(out)); s.on('error', reject);
  });
}

test('R1-1: a malformed request target is a 400 for that request, and the server keeps serving', async () => {
  const { c } = await makeCaveat();
  const { server } = createApp({ caveat: c, publicDir: 'test/no-ui' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await rawRequest(port, 'GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    assert.match(res, /^HTTP\/1\.1 400/);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
  } finally { await new Promise((r) => server.close(r)); }
});

test('R1-2: caller-declared lineages cannot manufacture corroboration or unlock a booking', async () => {
  const { c, sid } = await makeCaveat();
  const now = await c.clock(sid);
  const item = (n: number) => ({ subject: 'maya', predicate: 'delivery.window', scope: HOME, value: 'evening', observedAt: now, originId: `forged-${n}`, lineage: `independent-${n}`, sourceLabel: `Courier ${n}` });
  await c.importEnvelope(sid, { items: [item(1), item(2), item(3)] });
  const d = await c.decide(sid, { predicate: 'delivery.window', scope: HOME, purpose: 'action' });
  assert.notEqual(d.outcome, 'USE');
  assert.ok(!d.considered.some((x) => x.grade === 'corroborated'), 'three unsigned items from one caller are not independent');
  assert.equal((await c.plan(sid, 'sofa-home')).canBook, false);
  // The policy itself, with no stronger memory in the way: unsigned reports with caller-chosen lineages stay "reported".
  const unsigned = (n: number) => ({ ...ev({ predicate: 'delivery.window', scope: HOME, value: 'evening', sourceKind: 'third_party', daysAgo: 1, lineage: `independent-${n}` }), channel: 'import:unsigned' });
  const d2 = evaluate([unsigned(1), unsigned(2)], [], q('delivery.window', 'action', HOME));
  assert.equal(d2.grade, 'reported');
  assert.equal(d2.outcome, 'ASK');
  // Two server-attributed independent sources still corroborate.
  const d3 = evaluate([ev({ predicate: 'delivery.window', scope: HOME, value: 'evening', sourceKind: 'third_party', daysAgo: 1, lineage: 'courier:a' }), ev({ predicate: 'delivery.window', scope: HOME, value: 'evening', sourceKind: 'third_party', daysAgo: 2, lineage: 'courier:b' })], [], q('delivery.window', 'action', HOME));
  assert.equal(d3.grade, 'corroborated');
  assert.equal(d3.freshness?.ageDays, 2, 'corroboration dates from the second independent report');
});

test('R1-3: an unsigned agreeing report neither settles a conflict nor refreshes an old correction', async () => {
  {
    const { c, sid } = await makeCaveat();
    const now = await c.clock(sid);
    await c.importEnvelope(sid, { items: [{ subject: 'maya', predicate: 'delivery.window', scope: HOME, value: 'morning', observedAt: now, originId: 'echo-1' }] });
    const d = await c.decide(sid, { predicate: 'delivery.window', scope: HOME, purpose: 'action' });
    assert.equal(d.outcome, 'ASK');
    assert.equal(d.conflict.state, 'contested');
    assert.ok(d.mightBeWrong);
    assert.equal(d.considered.find((x) => x.role === 'leader')?.sourceKind, 'user_statement');
  }
  {
    const { c, sid } = await makeCaveat();
    await c.answer(sid, 'delivery.window', HOME, 'afternoon');
    await c.advance(sid, 181);
    const now = await c.clock(sid);
    await c.importEnvelope(sid, { items: [{ subject: 'maya', predicate: 'delivery.window', scope: HOME, value: 'afternoon', observedAt: now, originId: 'echo-2' }] });
    const d = await c.decide(sid, { predicate: 'delivery.window', scope: HOME, purpose: 'action' });
    assert.equal(d.freshness?.state, 'review-due');
    assert.equal(d.freshness?.ageDays, 181);
    assert.equal(d.outcome, 'ASK');
  }
});

test('R1-4: forgetting removes booking text by dependency, including short words and the window label', async () => {
  const { c, sid } = await makeCaveat();
  await c.answer(sid, 'delivery.window', HOME, 'afternoon');
  await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: 'location.private', value: { label: 'Gym', day: 'fri', from: 15, to: 17 }, excerpt: 'Gym' }]);
  await c.book(sid, 'sofa-home', 'review1-book-1');
  const before = (await c.state(sid)).bookings[0];
  assert.match(before.reason, /Gym/);
  const r = await c.forget(sid, 'maya', 'location.private', 'block');
  assert.equal(r.verified, true);
  assert.ok(r.verification.some((v) => v.check === 'Booking text derived from deleted evidence' && v.pass));
  const after1 = (await c.state(sid)).bookings[0];
  assert.doesNotMatch(after1.reason, /Gym|15:00|17:00/);
  assert.equal(after1.start, before.start, 'the booking itself (an action already taken) stays');
  await c.forget(sid, 'maya', 'delivery.window', 'block');
  const after2 = (await c.state(sid)).bookings[0];
  assert.doesNotMatch(JSON.stringify(after2), /afternoons/);
  assert.equal(after2.window, '13:00–17:00');
});

test('R1-5: a queued job holds identifiers only, so a forget leaves no plaintext in the worker inbox', async () => {
  const { c, sid } = await makeCaveat();
  await c.queueDigest(sid);
  const r = await c.forget(sid, 'maya', 'location.private', 'block');
  const job = (c as unknown as { worker: Map<string, unknown> }).worker.get(sid);
  assert.ok(job);
  assert.doesNotMatch(JSON.stringify(job), /Harbour|Physio|Flores/);
  assert.ok(r.verification.some((v) => v.check === 'Queued jobs holding a copy of it' && v.pass));
  const w = await c.releaseDigest(sid);
  assert.equal(w.written, false);
  assert.doesNotMatch(JSON.stringify(await c.state(sid)), /Harbour|Physio|Flores/);
});

test('R1-6: "before" mode refuses a re-dated old copy, and accepts a new statement made right after the forget', async () => {
  const { c, sid } = await makeCaveat();
  const env = await c.exportEnvelope(sid);
  const copy = env.items.find((x) => x.predicate === 'location.private')!;
  await c.forget(sid, 'maya', 'location.private', 'before');
  await c.advance(sid, 1);
  const now = await c.clock(sid);
  const r = await c.importEnvelope(sid, { items: [{ ...copy, originId: 'redated-1', observedAt: now }] });
  assert.equal(r.results[0].status, 'rejected');
  assert.doesNotMatch(JSON.stringify(await c.state(sid)), /Harbour|Physio|Flores/);
  // A genuinely new statement, at the same virtual instant as a forget, is learned.
  const { c: c2, sid: s2 } = await makeCaveat();
  await c2.forget(s2, 'maya', 'location.private', 'before');
  const told = await c2.ingest(s2, 'chat', [{ subject: 'maya', predicate: 'location.private', value: { label: 'Choir practice', day: 'wed', from: 18, to: 20 } }]);
  assert.equal(told[0].status, 'stored');
  const d = await c2.decide(s2, { predicate: 'location.private', purpose: 'inspection' });
  assert.equal(d.outcome, 'USE'); assert.match(String(d.valueLabel), /Choir practice/);
});

test('R1-7: static files stay inside the public directory, even for sibling paths that share its prefix', async () => {
  const { c } = await makeCaveat();
  const { server } = createApp({ caveat: c, publicDir: 'test/h' }); // "test/helpers.ts" shares the "test/h" prefix
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    for (const p of ['/%2e%2e%2fhelpers.ts', '/..%2fhelpers.ts', '/%2e%2e%5chelpers.ts']) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      const body = await res.text();
      assert.equal(res.status, 400, p);
      assert.doesNotMatch(body, /makeCaveat/);
    }
  } finally { await new Promise((r) => server.close(r)); }
});

test('R1-8: a future delivery hold blocks the slots it covers', async () => {
  const { c, sid } = await makeCaveat();
  await c.answer(sid, 'delivery.window', HOME, 'afternoon');
  const now = await c.clock(sid);
  const until = now + 10 * DAY;
  await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: 'delivery.hold', value: true, validFrom: now + DAY, validUntil: until } as never]);
  const p = await c.plan(sid, 'sofa-home');
  assert.equal(p.canBook, true);
  assert.ok(p.slot!.start > until, `slot ${new Date(p.slot!.start).toISOString()} must be after the hold`);
  assert.ok(p.skipped.some((s) => /on hold/.test(s.reason)));
});

test('R1-9: an export is one locked snapshot: its signed revision matches the evidence it carries', async () => {
  const { c, sid } = await makeCaveat();
  const [env] = await Promise.all([c.exportEnvelope(sid), c.answer(sid, 'delivery.window', HOME, 'evening')]);
  const hasCorrection = env.items.some((x) => x.sourceKind === 'user_correction');
  const s = await c.state(sid);
  if (hasCorrection) assert.equal(env.revision, s.revision); else assert.ok(env.revision < s.revision);
});
