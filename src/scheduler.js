// Builds the notification plan for the next 7 days and fires each event exactly once.
import { computeDay, methodForZone, hijriParts } from './prayer.js';
import { PRAYERS } from './store.js';

const FIRED_KEY = 'mq.fired';
const GRACE = 10 * 60e3;   // fire a late event only if we are at most 10 min late (e.g. device woke up)
const DAYS = 7;

/** civil y/m/d in a time zone for an instant */
export function ymdIn(tz, date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const g = t => +p.find(x => x.type === t).value;
  return { y: g('year'), m: g('month'), d: g('day') };
}
const addDays = ({ y, m, d }, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
export const keyOf = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Prayer instants for the civil date `ymd` at location. */
export function dayTimes(loc, s, ymd) {
  const method = methodForZone(loc.tz);
  const noon = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12));
  const hp = hijriParts(noon, loc.tz);
  const ramadan = !!(s.ramadan && hp && hp.m === 9);
  const t = computeDay(ymd, loc.lat, loc.lng, method, { ramadan });
  const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay();
  return { ymd, key: keyOf(ymd), times: t, method, friday: dow === 5, ramadan };
}

export function buildEvents(loc, s, now = Date.now()) {
  if (!loc) return [];
  const start = addDays(ymdIn(loc.tz, new Date(now)), -1);
  const ev = [];
  for (let i = 0; i <= DAYS + 1; i++) {   // yesterday (late events) + today + 7 days
    const day = dayTimes(loc, s, addDays(start, i));
    for (const p of PRAYERS) {
      const at = day.times[p];
      if (!at) continue;
      const base = { prayer: p, prayerAt: +at, friday: day.friday && p === 'dhuhr', day: day.key };
      if (s.adhan[p]) {
        if (s.beforeMin > 0) ev.push({ ...base, type: 'before', at: +at - s.beforeMin * 60e3, n: s.beforeMin });
        ev.push({ ...base, type: 'adhan', at: +at });
        if (s.afterMin > 0) ev.push({ ...base, type: 'after', at: +at + s.afterMin * 60e3, n: s.afterMin });
      }
      const iq = s.iqama[p];
      if (iq && iq.on && iq.min > 0) ev.push({ ...base, type: 'iqama', at: +at + iq.min * 60e3, n: iq.min });
    }
  }
  ev.forEach(e => { e.id = `${e.day}:${e.prayer}:${e.type}`; });
  return ev.filter(e => e.at > now - GRACE).sort((a, b) => a.at - b.at);
}

// ---- fired-event ledger (shared by all tabs/windows through localStorage) ----
function ledger() { try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch { return {}; } }
function mark(id) {
  const l = ledger(), cut = Date.now() - 3 * 864e5;
  for (const k in l) if (l[k] < cut) delete l[k];
  l[id] = Date.now();
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}
export function clearLedger() { try { localStorage.removeItem(FIRED_KEY); } catch { /* ignore */ } }

/**
 * Runner: wakes at the next event (or every 30 s at most, to survive sleep/clock changes),
 * fires due events once, and skips events missed by more than GRACE.
 */
export class Runner {
  constructor(onFire, onTick) { this.onFire = onFire; this.onTick = onTick; this.events = []; this.timer = 0; }
  setEvents(events) { this.events = events; this.kick(); }
  kick() { clearTimeout(this.timer); this.check(); }
  async check() {
    const now = Date.now();
    const due = this.events.filter(e => e.at <= now);
    this.events = this.events.filter(e => e.at > now);
    for (const e of due) {
      const late = now - e.at, limit = e.type === 'before' ? e.prayerAt - e.at : GRACE;
      await this.once(e.id, () => { if (late <= limit) this.onFire(e); });
    }
    this.onTick && this.onTick();
    const next = this.events[0];
    const wait = next ? Math.min(Math.max(next.at - Date.now(), 250), 30e3) : 30e3;
    this.timer = setTimeout(() => this.check(), wait);
  }
  async once(id, fn) {
    const run = () => { if (ledger()[id]) return; mark(id); fn(); };
    if (navigator.locks) await navigator.locks.request('mq-fire', run); else run();
  }
}
