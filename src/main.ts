import { randomBytes } from 'node:crypto';
import { openDb } from './db.ts';
import { Caveat } from './memory.ts';
import { createApp } from './server.ts';

const db = await openDb();
let secret = process.env.CAVEAT_SECRET ?? '';
if (!secret) {
  // Without a configured secret, exports signed by this process cannot be verified after a restart (they then import
  // as unsigned third-party reports — the safe direction). Set CAVEAT_SECRET in production.
  secret = randomBytes(32).toString('hex');
  console.warn('[caveat] CAVEAT_SECRET not set: using an ephemeral signing secret');
}
const caveat = new Caveat(db, secret);
const { server } = createApp({
  caveat,
  trustProxyHops: Number(process.env.CAVEAT_TRUST_PROXY_HOPS ?? 0),
  secureCookie: process.env.NODE_ENV === 'production',
});
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`[caveat] listening on :${port} (store ${db.kind})`));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); db.close().finally(() => process.exit(0)); });
