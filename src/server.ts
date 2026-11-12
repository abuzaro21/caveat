// HTTP API + static UI. Sessions are synthetic households identified by an HttpOnly cookie; the database only ever
// sees a hash of the token. All policy runs server-side; the browser cannot supply authority, time, or identity.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Caveat, NotFound, Rejected, Blocked } from './memory.ts';
import { isPredicate, PREDICATES, type Scope } from './model.ts';
import { isTask } from './tasks.ts';
import { naiveDemo } from './naive.ts';

export type AppOptions = { caveat: Caveat; publicDir?: string; trustProxyHops?: number; maxSessions?: number; idleMs?: number; rateLimit?: number; sessionsPerMinute?: number; secureCookie?: boolean };

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const SECURITY = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cross-origin-opener-policy': 'same-origin',
};
const COOKIE = 'caveat_sid';

export function createApp(o: AppOptions) {
  const c = o.caveat;
  const publicDir = resolve(o.publicDir ?? 'public');
  const maxSessions = o.maxSessions ?? 1500;
  const idleMs = o.idleMs ?? 3 * 3600_000;
  const limit = o.rateLimit ?? 300; // requests per minute per client
  const hsts: Record<string, string> = o.secureCookie ? { 'strict-transport-security': 'max-age=31536000' } : {}; // HTTPS deployments only
  const buckets = new Map<string, { n: number; reset: number; created: number }>();
  let lastSweep = 0;

  const clientIp = (req: IncomingMessage) => {
    const hops = o.trustProxyHops ?? 0;
    if (hops > 0) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length >= hops) return xff[xff.length - hops];
    }
    return req.socket.remoteAddress ?? 'unknown';
  };
  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { ...SECURITY, ...hsts, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(data);
  };
  const readBody = (req: IncomingMessage): Promise<any> => new Promise((ok, fail) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => { size += d.length; if (size > 64 * 1024) { fail(new Rejected('body too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { if (!chunks.length) return ok({}); try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(new Rejected('invalid JSON')); } });
    req.on('error', fail);
  });
  const token = (req: IncomingMessage) => String(req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const cookie = (t: string) => `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(idleMs / 1000)}${o.secureCookie ? '; Secure' : ''}`;
  const scopeOf = (b: any): Scope | undefined => (b?.place === 'home' || b?.place === 'office' ? { place: b.place } : undefined);

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const ip = clientIp(req);
    const now = Date.now();
    const b = buckets.get(ip) ?? { n: 0, reset: now + 60_000, created: 0 };
    if (now > b.reset) { b.n = 0; b.created = 0; b.reset = now + 60_000; }
    b.n++; buckets.set(ip, b);
    if (buckets.size > 20_000) buckets.clear();
    if (b.n > limit) return send(res, 429, { error: 'rate limited: slow down' }, { 'retry-after': '30' });
    if (now - lastSweep > 60_000) { lastSweep = now; c.expireSessions(idleMs).catch(() => {}); }

    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, store: c.db.kind, sessions: await c.sessionCount() });
    if (req.method === 'GET' && path === '/api/naive') return send(res, 200, naiveDemo());
    if (req.method === 'GET' && path === '/api/policy') return send(res, 200, { predicates: PREDICATES });
    if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'send application/json' });

    if (req.method === 'POST' && (path === '/api/session' || path === '/api/reset')) {
      const old = await c.resolve(token(req));
      if (path === '/api/session' && old) return send(res, 200, await c.state(old));
      if (old) await c.dropSession(old);
      if (++b.created > (o.sessionsPerMinute ?? 10)) return send(res, 429, { error: 'too many new sessions from this address' });
      if ((await c.sessionCount()) >= maxSessions) { await c.expireSessions(idleMs / 6); if ((await c.sessionCount()) >= maxSessions) return send(res, 503, { error: 'the demo is at capacity; try again shortly' }); }
      const s = await c.createSession();
      return send(res, 200, await c.state(s.sid), { 'set-cookie': cookie(s.token) });
    }

    const sid = await c.resolve(token(req));
    if (!sid) return send(res, 401, { error: 'no-session' });
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (req.method === 'GET' && path === '/api/state') return send(res, 200, await c.state(sid));
    if (req.method === 'POST' && path === '/api/ask') {
      if (typeof body.text !== 'string' || !body.text.trim()) throw new Rejected('text required');
      const actor = body.actor === 'sam' ? 'sam' : 'maya';
      return send(res, 200, await c.ask(sid, body.text, actor));
    }
    if (req.method === 'POST' && path === '/api/plan') { if (!isTask(body.task)) throw new Rejected('unknown task'); return send(res, 200, await c.plan(sid, body.task)); }
    if (req.method === 'POST' && path === '/api/book') {
      if (!isTask(body.task)) throw new Rejected('unknown task');
      try { return send(res, 200, await c.book(sid, body.task, String(body.idem ?? ''))); }
      catch (e) { if (e instanceof Blocked) return send(res, 409, { error: 'blocked by memory policy', plan: e.plan }); throw e; }
    }
    if (req.method === 'POST' && path === '/api/answer') {
      if (!isPredicate(body.predicate)) throw new Rejected('unknown predicate');
      return send(res, 200, await c.answer(sid, body.predicate, scopeOf(body), body.value));
    }
    if (req.method === 'POST' && path === '/api/tell') {
      if (!isPredicate(body.predicate)) throw new Rejected('unknown predicate');
      return send(res, 200, await c.ingest(sid, 'chat', [{ subject: 'maya', predicate: body.predicate, scope: scopeOf(body), value: body.value, excerpt: typeof body.excerpt === 'string' ? body.excerpt : undefined }]));
    }
    if (req.method === 'POST' && path === '/api/forget') {
      if (!isPredicate(body.predicate)) throw new Rejected('unknown predicate');
      return send(res, 200, await c.forget(sid, 'maya', body.predicate, body.mode === 'before' ? 'before' : 'block'));
    }
    if (req.method === 'POST' && path === '/api/clock') return send(res, 200, await c.advance(sid, Number(body.days)));
    if (req.method === 'GET' && path === '/api/export') return send(res, 200, await c.exportEnvelope(sid), { 'content-disposition': 'attachment; filename="caveat-export.json"' });
    if (req.method === 'POST' && path === '/api/import') return send(res, 200, await c.importEnvelope(sid, body.envelope));
    if (req.method === 'POST' && path === '/api/worker/queue') return send(res, 200, await c.queueDigest(sid));
    if (req.method === 'POST' && path === '/api/worker/release') return send(res, 200, await c.releaseDigest(sid));
    if (req.method === 'POST' && path === '/api/reload') return send(res, 200, { ...c.reload(), state: await c.state(sid) });
    return send(res, 404, { error: 'not found' });
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    let rel: string;
    try { rel = decodeURIComponent(path); } catch { return send(res, 400, { error: 'bad path' }); }
    // A backslash is a separator on Windows and an ordinary character on Linux. No asset name has one, so refuse it
    // everywhere, and the same request gets the same answer on every platform.
    if (rel.includes('\\')) return send(res, 400, { error: 'bad path' });
    let file = resolve(publicDir, '.' + rel);
    // Path-component containment, not a string prefix: "public-backup" is not inside "public".
    const inside = relative(publicDir, file);
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || rel.includes(String.fromCharCode(0))) return send(res, 400, { error: 'bad path' });
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(publicDir, 'index.html'); }
    try {
      const data = await readFile(file);
      const immutable = file.includes(`${normalize('/assets/')}`);
      res.writeHead(200, { ...SECURITY, ...hsts, 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { send(res, 404, { error: 'UI not built: run npm run build' }); }
  }

  const server = createServer(async (req, res) => {
    let path = '/';
    try {
      // Parsed inside the error boundary: a malformed request target is a 400 for that request, never a crash.
      try { path = new URL(req.url ?? '/', 'http://x').pathname; } catch { throw new Rejected('malformed request target'); }
      if (path.startsWith('/api/')) await api(req, res, path);
      else await serveStatic(req, res, path);
    } catch (e) {
      const status = e instanceof Rejected ? 400 : e instanceof NotFound ? 404 : 500;
      if (status === 500) console.error(`[caveat] ${req.method} ${path} failed: ${(e as Error).name}`); // never log bodies or content
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : (e as Error).message });
      else res.end();
    }
  });
  return { server, requestId: () => randomBytes(4).toString('hex') };
}
