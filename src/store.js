// Settings persisted locally (localStorage). No account, nothing leaves the device.
const KEY = 'mq.settings.v1';
export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const DEFAULTS = Object.freeze({
  lang: 'auto',
  loc: null,              // {mode:'auto'|'manual', lat, lng, tz, name:{ar,en}|null, ts}
  notify: true,           // master switch (still needs browser permission)
  bg: true,               // deliver via the push relay so alerts arrive while the app is closed
  adhan: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  afterMin: 5,            // reminder N minutes after adhan (0 = off)
  beforeMin: 0,           // reminder N minutes before adhan (0 = off)
  iqama: {
    fajr: { on: false, min: 25 }, dhuhr: { on: false, min: 20 }, asr: { on: false, min: 20 },
    maghrib: { on: false, min: 10 }, isha: { on: false, min: 20 },
  },
  sound: true,
  volume: 0.6,
  ramadan: false,
});

const clone = o => JSON.parse(JSON.stringify(o));
function merge(def, val) {
  if (val === undefined || val === null || typeof def !== 'object' || def === null) return val ?? def;
  if (typeof val !== 'object') return def;
  const out = {};
  for (const k of Object.keys(def)) out[k] = merge(def[k], val[k]);
  return out;
}

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    const s = merge(clone(DEFAULTS), raw || {});
    s.loc = raw && raw.loc && isFinite(raw.loc.lat) ? raw.loc : null;
    return s;
  } catch { return clone(DEFAULTS); }
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full/blocked */ } }
export function resetSettings(keepLoc) { const s = clone(DEFAULTS); s.loc = keepLoc || null; save(s); return s; }
