// Mawaqit push relay — Cloudflare Worker + D1 + 1-minute cron.
// Stores ONLY: the browser's push endpoint/keys, and the alert times + texts the app computed on the device.
// No coordinates, no account, no analytics.
import { sendPush, sendPushRes } from './webpush.js';

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/];
const MAX_EVENTS = 1500, HORIZON = 40 * 864e5, LATE = 10 * 60e3, LOOKAHEAD = 30e3;
const NUDGE = {
  ar: { title: 'افتح «مواقيت» لتحديث التنبيهات', body: 'قاربت جدولة التنبيهات على الانتهاء. افتح التطبيق مرة واحدة لتجديدها.' },
  en: { title: 'Open Mawaqit to renew reminders', body: 'Your reminder schedule is about to run out. Open the app once to renew it.' },
};

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function corsFor(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
function validEndpoint(ep, env) {
  try {
    const u = new URL(ep);
    if (env.ALLOW_ANY_ENDPOINT === '1') return /^https?:$/.test(u.protocol);       // local testing only
    return u.protocol === 'https:' && PUSH_HOSTS.some(r => r.test(u.hostname));
  } catch { return false; }
}
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

async function handleSync(req, env, cors) {
  if (+(req.headers.get('Content-Length') || 0) > 400_000) return json({ error: 'too large' }, 413, cors);
  let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
  const s = b && b.subscription;
  if (!s || !validEndpoint(s.endpoint, env) || !s.keys || !str(s.keys.p256dh, 200) || !str(s.keys.auth, 100))
    return json({ error: 'bad subscription' }, 400, cors);
  const lang = b.lang === 'ar' ? 'ar' : 'en';
  const now = Date.now();
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, MAX_EVENTS)
    .filter(e => e && Number.isFinite(e.at) && e.at > now - 60e3 && e.at < now + HORIZON && str(e.tag, 64) && str(e.title, 160) && (!e.body || str(e.body, 240)));
  const id = await sha256(s.endpoint);
  const horizon = events.reduce((m, e) => Math.max(m, e.at), now);

  const stmts = [
    env.DB.prepare(`INSERT INTO subs (id, endpoint, p256dh, auth, lang, synced_at, horizon, nudged) VALUES (?1,?2,?3,?4,?5,?6,?7,0)
      ON CONFLICT(id) DO UPDATE SET endpoint=?2, p256dh=?3, auth=?4, lang=?5, synced_at=?6, horizon=?7, nudged=0`)
      .bind(id, s.endpoint, s.keys.p256dh, s.keys.auth, lang, now, horizon),
    env.DB.prepare('DELETE FROM events WHERE sub_id = ?').bind(id),
  ];
  for (let i = 0; i < events.length; i += 20) {          // ≤ 100 bound params per statement
    const chunk = events.slice(i, i + 20);
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO events (sub_id, tag, at, payload) VALUES ${chunk.map(() => '(?,?,?,?)').join(',')}`)
      .bind(...chunk.flatMap(e => [id, e.tag, Math.round(e.at), JSON.stringify({ title: e.title, body: e.body || '', tag: e.tag, at: e.at, silent: !!e.silent })])));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, count: events.length, horizon }, 200, cors);
}

async function handleUnsubscribe(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
  if (!b || typeof b.endpoint !== 'string') return json({ error: 'bad request' }, 400, cors);
  const id = await sha256(b.endpoint);
  await env.DB.batch([env.DB.prepare('DELETE FROM events WHERE sub_id = ?').bind(id), env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(id)]);
  return json({ ok: true }, 200, cors);
}

function vapid(env) {
  return { privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), publicKey: env.VAPID_PUBLIC_KEY, subject: env.VAPID_SUBJECT };
}
async function dropSub(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM events WHERE sub_id = ?').bind(id), env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(id)]);
}

// Runs every minute: atomically claim due events (DELETE … RETURNING) so overlapping runs never double-send.
export async function dispatch(env, now = Date.now()) {
  const { results } = await env.DB.prepare(`DELETE FROM events WHERE rowid IN
      (SELECT rowid FROM events WHERE at <= ?1 ORDER BY at LIMIT 300) RETURNING sub_id, tag, at, payload`).bind(now + LOOKAHEAD).all();
  if (!results.length) return { sent: 0, stale: 0 };
  const ids = [...new Set(results.map(r => r.sub_id))];
  const subs = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT id, endpoint, p256dh, auth FROM subs WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    r.results.forEach(s => subs.set(s.id, s));
  }
  const keys = vapid(env);
  let sent = 0, stale = 0, failed = 0;
  const gone = new Set(), log = [];
  const note = (ev, status, reason = '') => log.push([Date.now(), ev.at, ev.sub_id.slice(0, 8), ev.tag.replace(/^\d{4}-/, ''), status, reason.slice(0, 120)]);
  const jobs = results.map(ev => async () => {
    const sub = subs.get(ev.sub_id);
    if (!sub || gone.has(ev.sub_id)) return;
    if (ev.at < now - LATE) { stale++; note(ev, 0, 'stale'); return; }   // relay was down too long — don't alert late
    const ttl = Math.max(60, Math.round((ev.at + LATE - now) / 1000));
    try {
      const res = await sendPushRes(sub, ev.payload, { ...keys, ttl, urgency: 'high' });
      const status = res.status, reason = status >= 300 ? await res.text().catch(() => '') : '';
      note(ev, status, reason);
      if (status === 404 || status === 410) { gone.add(ev.sub_id); await dropSub(env, ev.sub_id); }
      else if (status >= 200 && status < 300) sent++;
      else { failed++; console.warn('push status', status, new URL(sub.endpoint).host, reason); }
    } catch (e) { failed++; note(ev, -1, String(e)); console.warn('push error', String(e)); }
  });
  for (let i = 0; i < jobs.length; i += 25) await Promise.all(jobs.slice(i, i + 25).map(j => j()));
  // Delivery log (no texts, no endpoints): when each alert went out and what the push service answered.
  for (let i = 0; i < log.length; i += 15)
    await env.DB.prepare(`INSERT INTO sendlog (sent_at, due_at, sub, tag, status, reason) VALUES ${log.slice(i, i + 15).map(() => '(?,?,?,?,?,?)').join(',')}`)
      .bind(...log.slice(i, i + 15).flat()).run().catch(() => {});
  return { sent, stale, failed, gone: gone.size };
}

// Hourly housekeeping: remind devices whose schedule is about to run out, drop long-abandoned ones.
export async function housekeeping(env, now = Date.now()) {
  const keys = vapid(env);
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth, lang FROM subs WHERE nudged = 0 AND horizon < ? LIMIT 100')
    .bind(now + 3 * 864e5).all();
  for (const s of results) {
    const t = NUDGE[s.lang] || NUDGE.en;
    try {
      const status = await sendPush(s, JSON.stringify({ ...t, tag: 'mq-renew', at: now }), { ...keys, ttl: 86400, urgency: 'normal' });
      if (status === 404 || status === 410) await dropSub(env, s.id);
    } catch { /* retry next hour */ }
    await env.DB.prepare('UPDATE subs SET nudged = 1 WHERE id = ?').bind(s.id).run();
  }
  const old = await env.DB.prepare('SELECT id FROM subs WHERE synced_at < ?').bind(now - 60 * 864e5).all();
  for (const r of old.results) await dropSub(env, r.id);
  await env.DB.prepare('DELETE FROM sendlog WHERE sent_at < ?').bind(now - 7 * 864e5).run().catch(() => {});
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsFor(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (url.pathname === '/v1/health') return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY }, 200, cors || {});
    if (!cors) return json({ error: 'origin not allowed' }, 403, {});
    if (req.method === 'POST' && url.pathname === '/v1/sync') return handleSync(req, env, cors);
    if (req.method === 'POST' && url.pathname === '/v1/unsubscribe') return handleUnsubscribe(req, env, cors);
    return json({ error: 'not found' }, 404, cors);
  },
  async scheduled(ctl, env, ctx) {
    const now = ctl.scheduledTime || Date.now();
    const r = await dispatch(env, Math.max(now, Date.now()));
    if (r.sent || r.stale || r.failed) console.log('dispatch', JSON.stringify(r));
    if (new Date(now).getUTCMinutes() === 0) ctx.waitUntil(housekeeping(env));
  },
};
