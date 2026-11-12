// HTTP boundary: sessions, cookies, content types, gates, rate limits, headers, and logs that never carry content.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Caveat } from '../src/memory.ts';
import { createApp } from '../src/server.ts';
import { makeDb, closeAll, SECRET } from './helpers.ts';

let base = ''; let close = () => {};
const logs: string[] = [];
const orig = { log: console.log, error: console.error, warn: console.warn };
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  const c = new Caveat(await makeDb(), SECRET);
  const { server } = createApp({ caveat: c, rateLimit: 400, publicDir: 'test/no-ui' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(async () => { close(); Object.assign(console, orig); await closeAll(); });

async function session() {
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie')!;
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  const cookie = sc.split(';')[0];
  const call = (path: string, body?: unknown) => fetch(`${base}${path}`, body === undefined ? { headers: { cookie } } : { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { cookie, call, state: await r.json() };
}

test('no cookie → 401; a fresh session is seeded and isolated', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const a = await session(), b = await session();
  assert.notEqual(a.cookie, b.cookie);
  assert.equal(a.state.memories.length, b.state.memories.length);
  await a.call('/api/forget', { predicate: 'location.private', mode: 'block' });
  assert.ok(JSON.stringify(await (await b.call('/api/state')).json()).includes('Harbour Physio'));
  assert.ok(!JSON.stringify(await (await a.call('/api/state')).json()).includes('Harbour Physio'));
});

test('POST requires JSON (blocks form-based cross-site requests)', async () => {
  const { cookie } = await session();
  const r = await fetch(`${base}/api/forget`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'predicate=location.private' });
  assert.equal(r.status, 415);
});

test('the booking gate holds over HTTP: 409 with the reasons, then 200 after a correction', async () => {
  const { call } = await session();
  const r = await call('/api/book', { task: 'sofa-home', idem: 'http-book-0001' });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.match(body.plan.blockedBy.sentence, /^I might be wrong about this\./);
  assert.equal((await call('/api/answer', { predicate: 'delivery.window', place: 'home', value: 'afternoon' })).status, 200);
  const ok = await call('/api/book', { task: 'sofa-home', idem: 'http-book-0002' });
  assert.equal(ok.status, 200);
});

test('bad input → 400, unknown routes → 404, oversized bodies refused', async () => {
  const { call, cookie } = await session();
  assert.equal((await call('/api/forget', { predicate: '__proto__' })).status, 400);
  assert.equal((await call('/api/clock', { days: -1 })).status, 400);
  assert.equal((await call('/api/book', { task: 'sofa-home' })).status, 400);
  assert.equal((await call('/api/nope', {})).status, 404);
  const big = await fetch(`${base}/api/import`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ envelope: { items: [], pad: 'x'.repeat(70_000) } }) }).catch(() => null);
  assert.ok(!big || big.status === 400);
});

test('security headers on API responses', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.match(r.headers.get('content-security-policy')!, /default-src 'self'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await r.json()).ok, true);
});

test('logs never contain memory content, even across forget, import and errors', async () => {
  const { call } = await session();
  await call('/api/ask', { text: 'Where am I on Friday afternoons?' });
  const env = await (await call('/api/export')).json();
  await call('/api/forget', { predicate: 'location.private', mode: 'block' });
  await call('/api/import', { envelope: env });
  await call('/api/import', { envelope: { items: [{ subject: 'maya', predicate: 'home.city', value: 'LOGMARKER', excerpt: 'LOGMARKER' }] } });
  const text = logs.join('\n');
  for (const m of ['Harbour', 'Physio', 'LOGMARKER', 'Porto']) assert.ok(!text.includes(m), `log leaked ${m}`);
});

test('rate limiting per client', async () => {
  const c = new Caveat(await makeDb(), SECRET);
  const { server } = createApp({ caveat: c, rateLimit: 5, publicDir: 'test/no-ui' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await fetch(url)).status);
  server.close();
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429]);
});
