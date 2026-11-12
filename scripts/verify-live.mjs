// Verifies a deployed CAVEAT against its real HTTP API: scenarios A, B and C, ingestion and retrieval, session
// isolation, resurrection attempts, the proxy-hop rate limit and (with --after-restart) restart recovery.
// It records results only. Cookies, secrets and memory content are not written out.
// Usage: node scripts/verify-live.mjs <base-url> [--before-restart <state-file> | --after-restart <state-file>] [--rate-limit]
import { writeFileSync, readFileSync } from 'node:fs';

const [BASE, mode, stateFile] = process.argv.slice(2).filter((a) => a !== '--rate-limit');
const RATE = process.argv.includes('--rate-limit');
if (!BASE?.startsWith('https://')) throw new Error('give the https base URL');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`); };

function client(cookie = '') {
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  return { call, get cookie() { return cookie; } };
}
const has = (x, s) => JSON.stringify(x).includes(s);

if (mode !== '--after-restart') {
  // Transport
  const head = await fetch(BASE + '/');
  check('HTTPS page loads', head.ok, `${head.status}`);
  check('HSTS header', /max-age=\d+/.test(head.headers.get('strict-transport-security') ?? ''), head.headers.get('strict-transport-security') ?? 'missing');
  check('Content-Security-Policy header', !!head.headers.get('content-security-policy'));
  const plain = await fetch(BASE.replace('https://', 'http://') + '/api/health', { redirect: 'manual' });
  check('plain HTTP is redirected to HTTPS', plain.status >= 300 && plain.status < 400 && (plain.headers.get('location') ?? '').startsWith('https://'), `${plain.status}`);
  const health = await (await fetch(BASE + '/api/health')).json();
  check('health endpoint, PostgreSQL store', health.ok === true && health.store === 'postgres', JSON.stringify(health));

  // Scenario A: contradiction, "I might be wrong", backend abstention, correction
  const A = client();
  await A.call('POST', '/api/session', {});
  const ask = await A.call('POST', '/api/ask', { text: 'When should deliveries come to my home?' });
  check('A: retrieval answers from memory', ask.status === 200 && ask.json.decisions?.length > 0);
  const plan = await A.call('POST', '/api/plan', { task: 'sofa-home' });
  const d = plan.json.blockedBy;
  check('A: contradiction detected (contested)', d?.conflict?.state === 'contested', d?.conflict?.state);
  check('A: "I might be wrong about this." is said, with the evidence', /^I might be wrong about this\. You told me mornings/.test(d?.sentence ?? ''));
  const blocked = await A.call('POST', '/api/book', { task: 'sofa-home', idem: 'live-direct-attempt' });
  check('A: backend refuses the booking (409)', blocked.status === 409, `${blocked.status}`);
  const corr = await A.call('POST', '/api/answer', { predicate: 'delivery.window', place: 'home', value: 'afternoon' });
  check('A: the answer is stored as a correction', corr.json.kind === 'corrected', corr.json.kind);
  const booked = await A.call('POST', '/api/book', { task: 'sofa-home', idem: 'live-booking-0001' });
  check('A: booking goes through after the correction', booked.status === 200 && booked.json.booking?.window === 'afternoons', `${booked.status}`);

  // Scenario B: stale memory on the virtual clock
  await A.call('POST', '/api/clock', { days: 30 });
  const pb = await A.call('POST', '/api/plan', { task: 'repair-office' });
  check('B: memory past its horizon is not acted on', pb.json.canBook === false && pb.json.blockedBy?.freshness?.state === 'review-due', pb.json.blockedBy?.freshness?.state);
  await A.call('POST', '/api/answer', { predicate: 'work.office_days', value: ['tue', 'thu'] });
  check('B: reconfirming makes it usable again', (await A.call('POST', '/api/plan', { task: 'repair-office' })).json.canBook === true);

  // Scenario C: forget, then try to bring it back
  const before = await A.call('POST', '/api/ask', { text: 'Where am I on Friday afternoon?' });
  check('C: the private memory is retrievable before the forget', has(before.json, 'Harbour Physio'));
  const oldExport = (await A.call('GET', '/api/export')).json;
  await A.call('POST', '/api/worker/queue', {});
  const f = await A.call('POST', '/api/forget', { predicate: 'location.private', mode: 'block' });
  check('C: forget verified, 14 receipt checks, all passing', f.json.verified === true && f.json.verification?.length === 14 && f.json.verification.every((v) => v.pass), `${f.json.verification?.filter((v) => v.pass).length}/${f.json.verification?.length}`);
  check('C: receipt holds no forgotten content', !has(f.json, 'Harbour') && !has(f.json, 'Physio'));
  const after = await A.call('POST', '/api/ask', { text: 'Where am I on Friday afternoon?' });
  check('C: asking again abstains', after.json.decisions?.[0]?.outcome === 'ABSTAIN' && !has(after.json, 'Harbour'), after.json.decisions?.[0]?.outcome);
  const st = (await A.call('GET', '/api/state')).json;
  check('C: state, bookings and audit hold no trace', !has(st, 'Harbour') && !has(st, 'Physio') && !has(st, 'Flores'));
  const rel = (await A.call('POST', '/api/reload', {})).json;
  check('C: cold reload brings nothing back', !has(rel, 'Harbour'));
  const imp = (await A.call('POST', '/api/import', { envelope: oldExport })).json;
  check('C: restoring the old backup is refused for that topic', imp.signed === true && imp.results.some((r) => r.status === 'rejected') && !has((await A.call('GET', '/api/state')).json, 'Harbour'));
  const job = (await A.call('POST', '/api/worker/release', {})).json;
  check('C: the delayed job is fenced and writes nothing', job.written === false, job.reason?.slice(0, 40));
  const exp2 = (await A.call('GET', '/api/export')).json;
  check('C: a fresh export does not contain it', !has(exp2, 'Harbour') && !exp2.items.some((i) => i.predicate === 'location.private'));

  // Ingestion and retrieval in a second session: forget with "may relearn", teach a new value, retrieve it
  const B = client();
  await B.call('POST', '/api/session', {});
  await B.call('POST', '/api/forget', { predicate: 'location.private', mode: 'before' });
  const told = await B.call('POST', '/api/tell', { predicate: 'location.private', value: { label: 'Riverside Pool', day: 'fri', from: 15, to: 17 }, excerpt: 'Riverside Pool' });
  check('ingestion: a new memory is stored', told.status === 200 && told.json[0]?.status === 'stored', told.json[0]?.status);
  check('retrieval: the new memory is answered', has((await B.call('POST', '/api/ask', { text: 'Where am I on Friday afternoon?' })).json, 'Riverside Pool'));

  // Isolation: a fresh visitor still has the seeded memory, and A's forget did not touch it
  const C = client();
  const cs = (await C.call('POST', '/api/session', {})).json;
  check('isolation: another session is untouched by the forget', has(cs, 'Harbour Physio') && cs.tombstones.length === 0);
  check('isolation: no session sees another\'s data', !has((await C.call('GET', '/api/state')).json, 'Riverside Pool'));

  if (mode === '--before-restart') writeFileSync(stateFile, JSON.stringify({ cookieA: A.cookie, oldExport }), { mode: 0o600 });
} else {
  // Restart recovery: the same session after the service restarted
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  const A = client(saved.cookieA);
  const health = await (await fetch(BASE + '/api/health')).json();
  check('restart: service healthy on PostgreSQL', health.ok === true && health.store === 'postgres');
  const st = await A.call('GET', '/api/state');
  check('restart: the session survived', st.status === 200 && st.json.bookings?.length >= 1, `${st.status}`);
  check('restart: the memory is still forgotten, tombstone kept', !has(st.json, 'Harbour') && st.json.tombstones?.some((t) => t.predicate === 'location.private'));
  const imp = (await A.call('POST', '/api/import', { envelope: saved.oldExport })).json;
  check('restart: the old backup is still refused', imp.signed === true && !has((await A.call('GET', '/api/state')).json, 'Harbour'));
  check('restart: asking still abstains', (await A.call('POST', '/api/ask', { text: 'Where am I on Friday afternoon?' })).json.decisions?.[0]?.outcome === 'ABSTAIN');
}

if (RATE) {
  // Proxy hops: forged left-most X-Forwarded-For values must not create new rate-limit buckets.
  // Wait out the current 60 s window first, so the burst starts a fresh one and the 301st request must be refused.
  await new Promise((r) => setTimeout(r, 61_000));
  let first429 = 0;
  for (let i = 1; i <= 330 && !first429; i++) {
    const r = await fetch(BASE + '/api/health', { headers: { 'x-forwarded-for': `203.0.113.${i % 250}, 198.51.100.${i % 200}` } });
    if (r.status === 429) first429 = i;
  }
  check('rate limit: forged X-Forwarded-For is ignored (one bucket: the 301st request is refused)', first429 === 301, `first 429 at request ${first429}`);
}

const out = { base: BASE, phase: mode ?? 'full', at: new Date().toISOString(), passed: results.filter((r) => r.ok).length, total: results.length, results };
const file = process.env.OUT; if (file) writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`${out.passed}/${out.total} passed`);
process.exit(out.passed === out.total ? 0 : 1);
