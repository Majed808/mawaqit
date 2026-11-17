// End-to-end: wrangler dev (real Workers runtime + local D1) → cron → mock push service that decrypts like a browser.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import ece from 'http_ece';
import { generateVapidKeys, b64u } from '../src/webpush.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 'http://127.0.0.1:8788', PUSH = 'http://127.0.0.1:8899';

// keys
const { privateJwk, publicKey } = await generateVapidKeys();
writeFileSync('.dev.vars', `VAPID_PRIVATE_JWK=${JSON.stringify(privateJwk)}\nVAPID_PUBLIC_KEY=${publicKey}\nALLOW_ANY_ENDPOINT=1\n`);
rmSync('.wrangler/state', { recursive: true, force: true });
execSync('npx wrangler d1 execute mawaqit-push --local --file schema.sql', { stdio: 'ignore' });

// mock push service (behaves like FCM/APNs web push: verifies VAPID, stores decrypted payloads)
const ua = createECDH('prime256v1'); ua.generateKeys();
const auth = randomBytes(16);
const received = [];
const vapidPub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y }, format: 'jwk' });
const mock = createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    if (req.url.startsWith('/gone')) { res.writeHead(410).end(); received.push({ gone: true }); return; }
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.authorization || '');
    const [h, c, s] = m ? m[1].split('.') : [];
    const vapidOk = !!m && verify('sha256', Buffer.from(`${h}.${c}`), { key: vapidPub, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64u.decode(s)));
    let payload = null;
    try { payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ua, authSecret: auth }).toString()); } catch { /* bad */ }
    received.push({ vapidOk, payload, ttl: req.headers.ttl, urgency: req.headers.urgency, enc: req.headers['content-encoding'] });
    res.writeHead(201).end();
  });
}).listen(8899, '127.0.0.1');

const wr = spawn('npx', ['wrangler', 'dev', '--test-scheduled', '--port', '8788', '--ip', '127.0.0.1'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; wr.stdout.on('data', d => { log += d; }); wr.stderr.on('data', d => { log += d; });
for (let i = 0; i < 60; i++) { try { if ((await fetch(W + '/v1/health')).ok) break; } catch { /* starting */ } await sleep(1000); }

try {
  const sub = { endpoint: PUSH + '/sub/1', keys: { p256dh: b64u.encode(ua.getPublicKey()), auth: b64u.encode(auth) } };
  const now = Date.now();
  const events = [
    { at: now - 5000, tag: '2026-11-17:dhuhr:adhan', title: 'حان وقت صلاة الظهر', body: 'أذان الظهر ١١:٣٨ صباحًا' },
    { at: now + 10 * 60e3, tag: '2026-11-17:dhuhr:after', title: 'مضى على وقت أذان صلاة الظهر ٥ دقائق', body: '' },
    { at: now - 20 * 60e3, tag: 'old', title: 'stale', body: '' },
  ];
  const post = (path, body, origin = 'http://localhost:5173') => fetch(W + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

  const bad = await post('/v1/sync', { subscription: sub, events }, 'https://evil.example');
  ok(bad.status === 403, 'foreign origin rejected (403)');
  const pre = await fetch(W + '/v1/sync', { method: 'OPTIONS', headers: { Origin: 'https://majed808.github.io', 'Access-Control-Request-Method': 'POST' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://majed808.github.io', 'CORS preflight allowed for the app origin');

  const r = await (await post('/v1/sync', { subscription: sub, lang: 'ar', events })).json();
  ok(r.ok && r.count === 2, `sync stored 2 events, dropped the stale one (count=${r.count})`);

  await fetch(W + '/__scheduled?cron=*+*+*+*+*'); await sleep(1500);
  ok(received.length === 1, `cron delivered exactly 1 due push (got ${received.length})`);
  const p = received[0] || {};
  ok(p.vapidOk && p.enc === 'aes128gcm' && p.urgency === 'high', 'VAPID valid, aes128gcm, urgency high');
  ok(p.payload && p.payload.title === 'حان وقت صلاة الظهر' && p.payload.tag === '2026-11-17:dhuhr:adhan', 'decrypted payload = Dhuhr adhan (Arabic intact)');

  await fetch(W + '/__scheduled?cron=*+*+*+*+*'); await sleep(1500);
  ok(received.length === 1, 'second cron run sends nothing again (no duplicates)');

  // re-sync replaces the schedule (settings change) — the future event is replaced, not duplicated
  const r2 = await (await post('/v1/sync', { subscription: sub, lang: 'ar', events: [{ at: Date.now() - 1000, tag: 'x:isha:iqama', title: 'حان وقت إقامة صلاة العشاء', body: '' }] })).json();
  ok(r2.count === 1, 're-sync replaces the schedule');
  await fetch(W + '/__scheduled?cron=*+*+*+*+*'); await sleep(1500);
  ok(received.length === 2 && received[1].payload.tag === 'x:isha:iqama', 'only the new schedule fires after re-sync');

  // expired subscription → 410 → removed
  const gone = { endpoint: PUSH + '/gone/2', keys: sub.keys };
  await post('/v1/sync', { subscription: gone, lang: 'en', events: [{ at: Date.now() - 1000, tag: 't', title: 'x' }, { at: Date.now() + 3e5, tag: 't2', title: 'y' }] });
  await fetch(W + '/__scheduled?cron=*+*+*+*+*'); await sleep(1500);
  const left = execSync(`npx wrangler d1 execute mawaqit-push --local --json --command "SELECT COUNT(*) AS n FROM subs; SELECT COUNT(*) AS n FROM events"`).toString();
  const counts = JSON.parse(left).map(x => x.results[0].n);
  ok(received.some(x => x.gone) && counts[0] === 1 && counts[1] === 0, `410 Gone removes the subscription and its events (subs=${counts[0]}, events=${counts[1]})`);

  const un = await (await post('/v1/unsubscribe', { endpoint: sub.endpoint })).json();
  ok(un.ok, 'unsubscribe');
} finally {
  mock.close();
  wr.kill();
  try { execSync(`taskkill /pid ${wr.pid} /T /F`, { stdio: 'ignore' }); } catch { /* not windows */ }
  rmSync('.dev.vars', { force: true });
  if (fail) console.log(log.slice(-3000));
}
process.exit(fail ? 1 : 0);
