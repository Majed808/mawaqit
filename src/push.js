// Web Push client: subscribe this device and hand the relay the next 30 days of alerts.
// Only alert times + texts + the push endpoint are sent — never the location.
import { PUSH } from './config.js';

const STATE = 'mq.push';
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const bytesToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const pushConfigured = () => !!(PUSH.url && PUSH.publicKey);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;

export function pushState() { try { return JSON.parse(localStorage.getItem(STATE) || '{}'); } catch { return {}; } }
function setState(s) { try { localStorage.setItem(STATE, JSON.stringify(s)); } catch { /* ignore */ } }

async function subscription(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const k = sub && sub.options && sub.options.applicationServerKey;
  if (sub && k && bytesToB64u(k) !== PUSH.publicKey) { await sub.unsubscribe(); sub = null; }   // server key rotated
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(PUSH.publicKey) });
  return sub;
}

/** Send the schedule. `hash` identifies settings; skipped when unchanged and synced < 20 h ago. */
export async function syncPush(events, lang, hash, force = false) {
  const st = pushState();
  if (!force && st.ok && st.hash === hash && Date.now() - st.at < 20 * 3600e3) return st;
  try {
    const sub = await subscription(true);
    const res = await fetch(PUSH.url + '/v1/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), lang, events }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = await res.json();
    const ns = { ok: true, at: Date.now(), hash, horizon: r.horizon, count: r.count };
    setState(ns); return ns;
  } catch (e) {
    const ns = { ...st, ok: false, err: String(e && e.message || e), failedAt: Date.now() };
    setState(ns); return ns;
  }
}

export async function stopPush() {
  setState({});
  try {
    const sub = await subscription(false);
    if (!sub) return;
    fetch(PUSH.url + '/v1/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  } catch { /* ignore */ }
}

/** Push is delivering this device's alerts right now. */
export function pushActive() {
  const st = pushState();
  return pushConfigured() && st.ok && st.horizon > Date.now();
}
