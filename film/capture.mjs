// Captures REAL footage of the current CAVEAT build for the film: one continuous browser session against a local server
// with an in-memory SQLite store, driven only by the clicks below. A small ring marks the pointer so viewers can follow it.
// Scenes are paced to the narration (film/out/audio/durations.json), so each scene is one continuous take.
// Output: film/out/raw/session.webm and session.json (the second at which each scene starts).
// Usage: npm run build && python film/tts.py && node film/capture.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const F = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PORT = 3420, OUT = F('./out/raw/');
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.ts'], {
  env: { ...process.env, PORT: String(PORT), CAVEAT_DB: ':memory:', CAVEAT_SECRET: 'film-capture-only-secret', DATABASE_URL: '' }, stdio: 'inherit',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

const POINTER = `addEventListener('DOMContentLoaded', () => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:99999;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:2px solid #f0b04f;background:#f0b04f2e;pointer-events:none;transition:transform .12s;left:-50px;top:-50px';
  document.body.appendChild(d);
  addEventListener('mousemove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { d.style.transform = 'scale(.6)'; }, true);
  addEventListener('mouseup', () => { d.style.transform = 'scale(1)'; }, true);
});`;

const browser = await chromium.launch();
const tmp = F('./out/raw/tmp/');
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } });
await ctx.addInitScript(POINTER);
const page = await ctx.newPage();
const t0 = Date.now(), marks = {};
const wait = (ms) => page.waitForTimeout(ms);
const glide = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 }); };
const press = async (loc) => { await glide(loc); await wait(550); await loc.click(); };
const guide = (name) => page.getByRole('navigation', { name: 'Guided demo' }).getByRole('button', { name });
const voice = JSON.parse(readFileSync(F('./out/audio/durations.json'), 'utf8'));
const LEAD = 0.3, TAIL = 0.4;
const at = async (start, s) => { const ms = start + s * 1000 - Date.now(); if (ms > 0) await wait(ms); };
async function scene(id, fn) {
  const start = Date.now();
  marks[id] = (start - t0) / 1000;
  console.log(`${id} @ ${marks[id].toFixed(1)}s`);
  await fn((s) => at(start, s));
  await at(start, voice[id] + LEAD + TAIL);
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('heading', { name: 'Talking to Maya' }).waitFor();
  await page.mouse.move(960, 600);
  await wait(800);
  await scene('title', async (t) => { await t(1.5); await glide(page.locator('.inspector').first()); });
  await scene('intro', async (t) => {
    const cards = page.locator('.inspector .mem');
    for (const [i, s] of [[0, 0.5], [1, 3.0], [2, 5.5], [3, 8.0]]) { await t(s); if ((await cards.count()) > i) await glide(cards.nth(i)); }
  });
  await scene('conflict', async (t) => {
    await t(0.6); await press(guide('Book the sofa'));
    await t(6.5); await glide(page.getByRole('group', { name: 'Conflicting evidence' }));
    await t(11.0); await glide(page.locator('.ask-card').first());
  });
  await scene('answer', async (t) => {
    await t(0.5); await press(page.locator('.ask-card').first().getByRole('button', { name: 'Afternoons' }));
    await t(3.5); await glide(page.locator('.booking').first());
  });
  await scene('stale', async (t) => {
    await t(0.3); await press(guide('Jump 30 days ahead'));
    await t(2.4); await press(guide('Send the repair to the office'));
    await t(8.6); await press(page.locator('.ask-card').first().getByRole('button', { name: /Yes, still/ }));
  });
  const dialog = page.getByRole('dialog');
  await scene('forget', async (t) => {
    await t(0.3); await press(guide('Forget the private location'));
    await t(3.2); await press(dialog.getByRole('button', { name: 'Forget it' }));
    await dialog.locator('.checks').waitFor();
    await t(7.0); await glide(dialog.locator('.checks li').last());
  });
  await scene('proofs', async (t) => {
    await t(0.3); await press(dialog.getByRole('button', { name: 'Run the proofs' }));
    await dialog.locator('.proof-pass').nth(5).waitFor({ timeout: 20_000 });
    await glide(dialog.locator('.proofs li').last());
  });
  await scene('naive', async (t) => {
    // Forgetting clears the evidence panel, so plan the sofa again to bring a decision back into view.
    await t(0.2); await press(dialog.getByRole('button', { name: 'Close' }));
    await press(guide('Book the sofa'));
    await press(page.getByRole('button', { name: 'Show what a naive memory does' }));
    await page.locator('.naive-body').waitFor();
    await glide(page.locator('.naive-body'));
  });
  marks.end = (Date.now() - t0) / 1000;
} finally {
  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), F('./out/raw/session.webm'));
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(F('./out/raw/session.json'), JSON.stringify(marks, null, 2));
  await browser.close();
  server.kill();
}
