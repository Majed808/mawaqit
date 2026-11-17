// Verifies our RFC 8291 encryption decrypts with http_ece (reference implementation used by `web-push`),
// and that the VAPID JWT verifies with the public key.
import ece from 'http_ece';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import { encryptPayload, vapidAuth, generateVapidKeys, b64u } from '../src/webpush.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

// fake browser subscription keys
const ua = createECDH('prime256v1'); ua.generateKeys();
const auth = randomBytes(16);
const msg = JSON.stringify({ title: 'مضى على وقت أذان صلاة الظهر ٥ دقائق', body: 'test', tag: '2026-11-17:dhuhr:after' });
const body = await encryptPayload(msg, b64u.encode(ua.getPublicKey()), b64u.encode(auth));
const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
ok(plain.toString('utf8') === msg, 'payload decrypts with http_ece (aes128gcm) — Arabic text intact');
ok(body.length < 4096, `body ${body.length} bytes < 4 KB push limit`);

const { privateJwk, publicKey } = await generateVapidKeys();
const h = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', privateJwk, publicKey, 'https://example.org/');
const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
ok(k === publicKey, 'k= carries the public key');
const [hd, cl, sig] = t.split('.');
const claims = JSON.parse(Buffer.from(b64u.decode(cl)).toString());
ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000 && claims.sub, 'JWT claims aud/exp/sub');
const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y }, format: 'jwk' });
ok(verify('sha256', Buffer.from(`${hd}.${cl}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64u.decode(sig))), 'ES256 signature verifies');

process.exit(fail ? 1 : 0);
