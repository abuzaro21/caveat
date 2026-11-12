// Regression tests for Codex adversarial review 2 (docs/reviews/codex-review-2.md). Finding 1 (browser-held copies) is a
// browser concern and is covered in e2e/caveat.spec.ts ("C2"); findings 2 and 3 are covered here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteDb, PgDb, type Db } from '../src/db.ts';
import { Caveat } from '../src/memory.ts';
import { DAY } from '../src/model.ts';
import { makeCaveat, closeAll, SECRET, PG_URL } from './helpers.ts';

after(closeAll);
const HOME = { place: 'home' as const };

test('R2-2: a database created before bookings.parts existed is migrated, and forgetting still deletes and rewrites', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'caveat-r2-'));
  const schema = `t_${randomBytes(4).toString('hex')}`;
  const openDb = async (): Promise<Db> => (PG_URL ? PgDb.open(PG_URL, schema) : new SqliteDb(join(dir, 'legacy.db')));
  try {
    // 1. A session with a booking whose explanation quotes the private location.
    let db = await openDb();
    let c = new Caveat(db, SECRET);
    const { sid } = await c.createSession();
    await c.answer(sid, 'delivery.window', HOME, 'afternoon');
    const b = await c.book(sid, 'sofa-home', 'legacy-1');
    assert.ok(b);
    // 2. Turn it into the previous schema: no parts column, so nothing records what the text depends on.
    await db.tx(null, (q) => q.run('ALTER TABLE bookings DROP COLUMN parts'));
    const before = await db.tx(null, (q) => q.all<{ reason: string }>('SELECT reason FROM bookings WHERE session = ?', [sid]));
    assert.match(before[0].reason, /Harbour/, 'the legacy explanation quotes the private location');
    await db.close();
    // 3. Reopen with the current code: the migration runs before anything is served.
    db = await openDb();
    c = new Caveat(db, SECRET);
    const r = await c.forget(sid, 'maya', 'location.private', 'block');
    assert.equal(r.verified, true, JSON.stringify(r.verification.filter((v) => !v.pass)));
    const rows = await db.tx(null, (q) => q.all<{ reason: string; window_label: string; parts: string }>('SELECT reason, window_label, parts FROM bookings WHERE session = ?', [sid]));
    assert.equal(rows.length, 1, 'the booking itself is kept: it is an action already taken');
    assert.doesNotMatch(JSON.stringify(rows), /Harbour|Physio|Flores/);
    const ev = await db.tx(null, (q) => q.all('SELECT id FROM evidence WHERE session = ? AND predicate = ?', [sid, 'location.private']));
    assert.equal(ev.length, 0);
    // 4. New bookings work on the migrated schema.
    await c.answer(sid, 'delivery.window', HOME, 'morning');
    assert.ok(await c.book(sid, 'sofa-home', 'after-migration'));
    await db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R2-3: a hold wholly inside a delivery slot blocks that slot', async () => {
  const { c, sid } = await makeCaveat();
  await c.answer(sid, 'delivery.window', HOME, 'afternoon');
  await c.forget(sid, 'maya', 'location.private', 'block'); // so Friday 13 Nov is otherwise the first free afternoon
  const now = await c.clock(sid);
  const fri = Math.floor(now / DAY) * DAY + DAY; // Fri 13 Nov 2026, 00:00 UTC
  const hold = { from: fri + 14 * 3600_000, to: fri + 16 * 3600_000 };
  const p0 = await c.plan(sid, 'sofa-home');
  assert.equal(p0.slot?.start, fri + 13 * 3600_000, 'without the hold, Friday afternoon would be booked');
  await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: 'delivery.hold', value: true, validFrom: hold.from, validUntil: hold.to } as never]);
  const p = await c.plan(sid, 'sofa-home');
  assert.equal(p.canBook, true);
  assert.ok(p.slot!.start >= hold.to || p.slot!.end <= hold.from, `slot ${p.slot!.label} overlaps the hold`);
  assert.ok(p.skipped.some((s) => /on hold/.test(s.reason)));
  const b = await c.book(sid, 'sofa-home', 'hold-inside');
  assert.ok(b.booking.start >= hold.to || b.booking.end <= hold.from);
});

// Codex review 3, finding 2: a legacy booking can quote a memory whose evidence an older engine already deleted.
test('R3-2: forgetting rewrites a migrated legacy explanation even when no evidence is left to delete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'caveat-r3-'));
  const schema = `t_${randomBytes(4).toString('hex')}`;
  const openDb = async (): Promise<Db> => (PG_URL ? PgDb.open(PG_URL, schema) : new SqliteDb(join(dir, 'legacy.db')));
  try {
    let db = await openDb();
    let c = new Caveat(db, SECRET);
    const { sid } = await c.createSession();
    await c.answer(sid, 'location.private', undefined, { label: 'Gym', day: 'fri', from: 15, to: 17 });
    await c.answer(sid, 'delivery.window', HOME, 'afternoon');
    await c.book(sid, 'sofa-home', 'legacy-gym');
    // What the pre-parts engine left behind: no parts column, the evidence gone, the booking text still quoting it.
    await db.tx(null, async (q) => {
      await q.run('ALTER TABLE bookings DROP COLUMN parts');
      await q.run('DELETE FROM memory_index WHERE session = ?', [sid]);
      await q.run('DELETE FROM uses WHERE session = ?', [sid]);
      await q.run('DELETE FROM evidence WHERE session = ? AND predicate = ?', [sid, 'location.private']);
    });
    const before = await db.tx(null, (q) => q.all<{ reason: string }>('SELECT reason FROM bookings WHERE session = ?', [sid]));
    assert.match(before[0].reason, /Gym/);
    await db.close();
    db = await openDb();
    c = new Caveat(db, SECRET);
    const r = await c.forget(sid, 'maya', 'location.private', 'block');
    assert.equal(r.verified, true, JSON.stringify(r.verification.filter((v) => !v.pass)));
    const rows = await db.tx(null, (q) => q.all('SELECT reason, window_label, parts FROM bookings WHERE session = ?', [sid]));
    assert.doesNotMatch(JSON.stringify(rows), /Gym/);
    await db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Codex review 4, finding 2: ingest audit entries written before they were counts-only still named evidence ids.
test('R4-2: old ingest audit entries are rewritten to counts on open, so no id outlives its evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'caveat-r4-'));
  const schema = `t_${randomBytes(4).toString('hex')}`;
  const openDb = async (): Promise<Db> => (PG_URL ? PgDb.open(PG_URL, schema) : new SqliteDb(join(dir, 'audit.db')));
  try {
    let db = await openDb();
    const c = new Caveat(db, SECRET);
    const { sid } = await c.createSession();
    const r = await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: 'location.private', value: { label: 'Gym', day: 'fri', from: 15, to: 17 }, excerpt: 'Gym' } as never]);
    const id = r[0]?.id;
    assert.ok(id, 'an evidence id was stored');
    await db.tx(null, (q) => q.run("UPDATE audit SET detail = ? WHERE session = ? AND op = 'ingest' AND seq = (SELECT MAX(seq) FROM audit WHERE session = ? AND op = 'ingest')",
      [JSON.stringify({ channel: 'chat', stored: [id], duplicates: 0, rejected: [] }), sid, sid]));
    await db.close();
    db = await openDb();
    const rows = await db.tx(null, (q) => q.all<{ detail: string }>("SELECT detail FROM audit WHERE session = ? AND op = 'ingest'", [sid]));
    assert.ok(rows.length > 0);
    assert.doesNotMatch(JSON.stringify(rows), new RegExp(id));
    assert.ok(rows.every((x) => typeof JSON.parse(x.detail).stored === 'number'));
    await db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
