// Recovery: a real server process is stopped and started again on the same database. Revoked content must stay gone,
// and replaying an export taken before the forget must not bring it back. On SQLite the database files are also
// scanned byte-for-byte for the forgotten text after a clean shutdown (secure_delete + checkpoint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PG_URL, SECRET } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'caveat-restart-'));
const dbFile = join(dir, 'caveat.db');
const port = 3400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CAVEAT_DB: dbFile, CAVEAT_SECRET: SECRET, ...(PG_URL ? { DATABASE_URL: PG_URL, CAVEAT_PG_SCHEMA: `restart_${port}` } : { DATABASE_URL: '' }) };

async function start(): Promise<ChildProcess> {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return p; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  p.kill(); throw new Error('server did not start');
}
const stop = (p: ChildProcess) => new Promise<void>((r) => { p.once('exit', () => r()); p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 4000); });

test('forget → stop → start: still forgotten; old export replay rejected; database files hold no trace', async () => {
  let p = await start();
  const s = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = s.headers.get('set-cookie')!.split(';')[0];
  const call = async (path: string, body?: unknown) => (await fetch(`${base}${path}`, body === undefined ? { headers: { cookie } } : { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const oldExport = await call('/api/export');
  assert.ok(JSON.stringify(oldExport).includes('Harbour Physio'));
  await call('/api/answer', { predicate: 'delivery.window', place: 'home', value: 'afternoon' });
  await call('/api/book', { task: 'sofa-home', idem: 'restart-book-1' });
  const receipt = await call('/api/forget', { predicate: 'location.private', mode: 'block' });
  assert.equal(receipt.verified, true);
  await stop(p);

  if (!PG_URL) {
    for (const f of [dbFile, `${dbFile}-wal`]) if (existsSync(f)) {
      const bytes = readFileSync(f).toString('latin1');
      for (const m of ['Harbour', 'Physio', 'Flores']) assert.ok(!bytes.includes(m), `${f} still contains ${m}`);
    }
  }

  p = await start();
  try {
    const st = await call('/api/state');
    assert.equal(st.revision > 0, true, 'session survived the restart');
    assert.ok(!JSON.stringify(st).includes('Harbour'));
    assert.equal(st.bookings.length, 1);
    assert.equal(st.tombstones[0].predicate, 'location.private');
    const imp = await call('/api/import', { envelope: oldExport });
    assert.equal(imp.signed, true, 'same secret across restarts: the export is still recognised as ours');
    assert.deepEqual(imp.results.filter((r: any) => r.status === 'rejected').map((r: any) => r.reason), ['topic revoked: not relearned']);
    const ask = await call('/api/ask', { text: 'Where am I on Friday afternoons?' });
    assert.equal(ask.decisions[0].blockedBy, 'revoked');
    assert.ok(!JSON.stringify(await call('/api/state')).includes('Harbour'));
  } finally { await stop(p); rmSync(dir, { recursive: true, force: true }); }
});
