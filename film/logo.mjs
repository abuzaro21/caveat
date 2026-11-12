// Renders the brand ending frame by frame from the product's vector mark (ui/public/logo.svg geometry):
// - the ink tile settles in;
// - the amber caret is drawn like a proofreader's mark;
// - the dot drops into place, and the broken baseline closes in from both sides;
// - the wordmark and tagline reveal, then the composition holds.
// Animations are CSS, paused and stepped to exact times, so every frame is deterministic.
// Output: film/out/logo/%04d.png (30 fps), encoded by build.mjs. Usage: node film/logo.mjs [seconds]
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';

const F = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SECONDS = Number(process.argv[2] ?? 8), FPS = 30, DIR = F('./out/logo/');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const font = (pkg, file) => readFileSync(F(`../node_modules/@fontsource-variable/${pkg}/files/${file}`)).toString('base64');

const html = `<!doctype html><style>
@font-face{font-family:'Fraunces';src:url(data:font/woff2;base64,${font('fraunces', 'fraunces-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:'Inter';src:url(data:font/woff2;base64,${font('inter', 'inter-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
*{margin:0;box-sizing:border-box}
body{width:1920px;height:1080px;background:radial-gradient(1100px 720px at 50% 32%,#1a1c22 0%,#0b0d11 70%);display:grid;place-items:center;font-family:'Inter',system-ui,sans-serif;color:#ece8df;overflow:hidden}
.c{text-align:center;display:flex;flex-direction:column;align-items:center}
svg{width:250px;height:250px;overflow:visible}
.tile{transform-origin:32px 32px;transform:scale(.86);opacity:0;animation:tile .9s cubic-bezier(.2,.8,.2,1) .15s forwards}
.caret{stroke-dasharray:100;stroke-dashoffset:100;animation:draw 1.1s cubic-bezier(.65,.05,.25,1) .7s forwards}
.dot{transform:translateY(-14px);opacity:0;animation:drop .55s cubic-bezier(.3,1.6,.5,1) 1.75s forwards}
.bl{transform:translateX(-10px);opacity:0;animation:slide .8s cubic-bezier(.2,.8,.2,1) 1.5s forwards}
.br{transform:translateX(10px);opacity:0;animation:slide .8s cubic-bezier(.2,.8,.2,1) 1.5s forwards}
.glow{opacity:0;animation:glow 2.4s ease-out 1.9s forwards}
.w{font-family:'Fraunces',Georgia,serif;font-size:124px;font-weight:600;letter-spacing:.36em;margin:40px 0 0 .1em;opacity:0;animation:word 1.3s cubic-bezier(.2,.8,.2,1) 2.2s forwards}
.t{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:46px;color:#f0b04f;margin-top:16px;opacity:0;transform:translateY(14px);animation:rise .9s ease-out 3.2s forwards}
.u{font-size:28px;color:#847f76;margin-top:48px;font-family:Consolas,monospace;opacity:0;animation:fade .8s ease-out 4.0s forwards}
.d{position:fixed;left:0;right:0;bottom:44px;text-align:center;font-size:21px;color:#6a665e;opacity:0;animation:fade .8s ease-out 4.5s forwards}
@keyframes tile{to{transform:none;opacity:1}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes drop{to{transform:none;opacity:1}}
@keyframes slide{to{transform:none;opacity:1}}
@keyframes fade{to{opacity:1}}
@keyframes glow{0%{opacity:0}35%{opacity:.85}100%{opacity:.3}}
@keyframes word{from{opacity:0;letter-spacing:.36em}to{opacity:1;letter-spacing:.12em}}
@keyframes rise{to{opacity:1;transform:none}}
</style><div class="c">
<svg viewBox="0 0 64 64" aria-label="CAVEAT">
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>
  <rect class="tile" width="64" height="64" rx="16" fill="#11141b" stroke="#262c37" stroke-width=".6"/>
  <path class="glow" d="M19 41 L32 23 L45 41" fill="none" stroke="#f0b04f" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#g)"/>
  <path class="caret" pathLength="100" d="M19 41 L32 23 L45 41" fill="none" stroke="#f0b04f" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="bl" d="M11 48 H25" stroke="#efe9dc" stroke-width="4" stroke-linecap="round"/>
  <path class="br" d="M39 48 H53" stroke="#efe9dc" stroke-width="4" stroke-linecap="round"/>
  <circle class="dot" cx="32" cy="12.5" r="3.6" fill="#f0b04f"/>
</svg>
<div class="w">CAVEAT</div><div class="t">Remember with reasons. Forget with proof.</div><div class="u">github.com/abuzaro21/caveat</div></div>
<div class="d">Real captures of the running build · fictional household · synthetic narration (Kokoro-82M)</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
const n = Math.round(SECONDS * FPS);
for (let i = 0; i < n; i++) {
  await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), (i * 1000) / FPS);
  await page.screenshot({ path: `${DIR}${String(i).padStart(4, '0')}.png` });
}
await browser.close();
console.log(`logo: ${n} frames`);
