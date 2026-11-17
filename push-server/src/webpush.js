// Web Push (RFC 8030) with payload encryption (RFC 8291, aes128gcm / RFC 8188) and VAPID (RFC 8292).
// Pure WebCrypto — runs in Cloudflare Workers and Node ≥ 20.
const enc = new TextEncoder();

export const b64u = {
  encode(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = ''; for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  },
};
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF-Expand with a single block (length ≤ 32)
const expand = async (prk, info, len) => (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);

/** Encrypt `payload` (string) for a PushSubscription's keys. Returns the request body bytes. */
export async function encryptPayload(payload, p256dhB64, authB64) {
  const uaPublic = b64u.decode(p256dhB64), authSecret = b64u.decode(authB64);
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await expand(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = await expand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(enc.encode(payload), new Uint8Array([2]));       // single, final record
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const rs = 4096, header = new Uint8Array(21);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, rs); header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

const jwtCache = new Map();
/** VAPID Authorization header value for an endpoint. privateJwk: ES256 private key as JWK. */
export async function vapidAuth(endpoint, privateJwk, publicB64, subject) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  const now = Math.floor(Date.now() / 1000);
  if (hit && hit.exp - now > 3600) return hit.value;
  const exp = now + 12 * 3600;
  const part = o => b64u.encode(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)); // raw r||s
  const value = `vapid t=${unsigned}.${b64u.encode(sig)}, k=${publicB64}`;
  jwtCache.set(aud, { value, exp });
  return value;
}

/** Send one push message. Returns the HTTP status. */
export async function sendPush(sub, payload, opts) { return (await sendPushRes(sub, payload, opts)).status; }

/** Send one push message. Returns the push service's Response (status + reason body). */
export async function sendPushRes(sub, payload, { privateJwk, publicKey, subject, ttl = 900, urgency = 'high', topic }) {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  const headers = {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    TTL: String(ttl), Urgency: urgency,
    Authorization: await vapidAuth(sub.endpoint, privateJwk, publicKey, subject),
  };
  if (topic) headers.Topic = topic;
  return fetch(sub.endpoint, { method: 'POST', headers, body });
}

/** One-off helper: new VAPID key pair. */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicKey = b64u.encode(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { privateJwk, publicKey };
}
