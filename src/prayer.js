// Prayer-time engine — Jean Meeus "Astronomical Algorithms" (same model as the Adhan library).
// Calculation profiles are chosen to reproduce the MWL "Manhaj" platform (portal.themwl.org),
// which picks the method from the device time-zone. See tools/verify.mjs and docs in about page.

const R = Math.PI / 180;
const sin = d => Math.sin(d * R), cos = d => Math.cos(d * R), tan = d => Math.tan(d * R);
const asin = x => Math.asin(x) / R, acos = x => Math.acos(x) / R, atan2 = (y, x) => Math.atan2(y, x) / R;
const unwind = a => { const b = a % 360; return b < 0 ? b + 360 : b; };
const norm1 = n => n - Math.floor(n);
const qshift = a => (a >= -180 && a <= 180) ? a : a - 360 * Math.round(a / 360);

function julianDay(y, m, d, h = 0) {
  const Y = m > 2 ? y : y - 1, M = m > 2 ? m : m + 12, D = d + h / 24;
  const A = Math.trunc(Y / 100), B = 2 - A + Math.trunc(A / 4);
  return Math.trunc(365.25 * (Y + 4716)) + Math.trunc(30.6001 * (M + 1)) + D + B - 1524.5;
}

function solar(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = unwind(280.4664567 + 36000.76983 * T + 0.0003032 * T * T);
  const Lp = unwind(218.3165 + 481267.8813 * T);
  const Om = unwind(125.04452 - 1934.136261 * T + 0.0020708 * T * T + T * T * T / 450000);
  const M = unwind(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const lam = unwind(L0 + C - 0.00569 - 0.00478 * sin(125.04 - 1934.136 * T));
  const e0 = 23.439291 - 0.013004167 * T - 0.0000001639 * T * T + 0.0000005036 * T * T * T;
  const eApp = e0 + 0.00256 * cos(125.04 - 1934.136 * T);
  const th0 = unwind(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - T * T * T / 38710000);
  const dPsi = (-17.2 / 3600) * sin(Om) - (1.32 / 3600) * sin(2 * L0) - (0.23 / 3600) * sin(2 * Lp) + (0.21 / 3600) * sin(2 * Om);
  const dEps = (9.2 / 3600) * cos(Om) + (0.57 / 3600) * cos(2 * L0) + (0.10 / 3600) * cos(2 * Lp) - (0.09 / 3600) * cos(2 * Om);
  return {
    dec: asin(sin(eApp) * sin(lam)),
    ra: unwind(atan2(cos(eApp) * sin(lam), cos(lam))),
    st: th0 + dPsi * cos(e0 + dEps),
  };
}

const interp = (y2, y1, y3, n) => { const a = y2 - y1, b = y3 - y2; return y2 + n / 2 * (a + b + n * (b - a)); };
const interpA = (y2, y1, y3, n) => { const a = unwind(y2 - y1), b = unwind(y3 - y2); return y2 + n / 2 * (a + b + n * (b - a)); };

// Solar events for a civil date (y,m,d) at lat/lng; results are UTC hours from 00:00 UT of that date.
function solarDay(y, m, d, lat, lng) {
  const jd = julianDay(y, m, d);
  const s = solar(jd), p = solar(jd - 1), n = solar(jd + 1);
  const Lw = -lng;
  const m0 = norm1((s.ra + Lw - s.st) / 360);
  const transit = (() => {
    const th = unwind(s.st + 360.985647 * m0), a = unwind(interpA(s.ra, p.ra, n.ra, m0));
    return (m0 - qshift(th - Lw - a) / 360) * 24;
  })();
  const hourAngle = (h0, after) => {
    const H0 = acos((sin(h0) - sin(lat) * sin(s.dec)) / (cos(lat) * cos(s.dec)));
    if (isNaN(H0)) return NaN;
    const mm = after ? m0 + H0 / 360 : m0 - H0 / 360;
    const th = unwind(s.st + 360.985647 * mm), a = unwind(interpA(s.ra, p.ra, n.ra, mm)), dd = interp(s.dec, p.dec, n.dec, mm);
    const H = th - Lw - a;
    const h = asin(sin(lat) * sin(dd) + cos(lat) * cos(dd) * cos(H));
    return (mm + (h - h0) / (360 * cos(dd) * cos(lat) * sin(H))) * 24;
  };
  return {
    transit, hourAngle,
    sunrise: hourAngle(-50 / 60, false), sunset: hourAngle(-50 / 60, true),
    asr: shadow => hourAngle(atan2(1, shadow + tan(Math.abs(lat - s.dec))), true),
  };
}

// Calculation profiles. adj = minutes added after computation (fajr,sunrise,dhuhr,asr,maghrib,isha).
export const METHODS = {
  UmmAlQura:  { fajr: 18.5, ishaMin: 90, ramadanIshaMin: 120, adj: [0, 0, 0, 0, 0, 0] },
  MWL:        { fajr: 18, isha: 17, adj: [0, 0, 1, 0, 0, 0] },
  Egyptian:   { fajr: 19.5, isha: 17.5, adj: [0, 0, 1, 0, 0, 0] },
  Karachi:    { fajr: 18, isha: 18, adj: [0, 0, 1, 0, 0, 0] },
  ISNA:       { fajr: 15, isha: 15, adj: [0, 0, 1, 0, 0, 0] },
  Dubai:      { fajr: 18.2, isha: 18.2, adj: [0, -3, 3, 3, 3, 0] },
  Kuwait:     { fajr: 18, isha: 17.5, adj: [0, 0, 0, 0, 0, 0] },
  Qatar:      { fajr: 18, ishaMin: 90, adj: [0, 0, 0, 0, 0, 0] },
  Singapore:  { fajr: 20, isha: 18, adj: [0, 0, 1, 0, 0, 0] },
  Turkey:     { fajr: 18, isha: 17, adj: [0, -7, 5, 4, 7, 0] },
};

export const NAMES = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * Compute prayer times for a civil date.
 * @returns {Object<string,Date>} absolute instants (rounded to nearest minute)
 */
export function computeDay({ y, m, d }, lat, lng, method = 'UmmAlQura', opts = {}) {
  const P = METHODS[method] || METHODS.UmmAlQura;
  const S = solarDay(y, m, d, lat, lng);
  const base = Date.UTC(y, m - 1, d);
  const at = h => new Date(base + h * 3600e3);
  const sunrise = S.sunrise, sunset = S.sunset;
  let fajr = S.hourAngle(-P.fajr, false);
  let isha = P.ishaMin ? sunset + (opts.ramadan && P.ramadanIshaMin ? P.ramadanIshaMin : P.ishaMin) / 60
    : S.hourAngle(-P.isha, true);
  // High-latitude safety (middle of the night) — only affects places where twilight never ends.
  const tomorrow = solarDay(...nextDate(y, m, d), lat, lng).sunrise + 24;
  const night = tomorrow - sunset;
  const estimated = [];
  if (isFinite(night)) {
    if (!isFinite(fajr) || sunrise - fajr > night / 2) { fajr = sunrise - night / 2; estimated.push('fajr'); }
    if (!P.ishaMin && (!isFinite(isha) || isha - sunset > night / 2)) { isha = sunset + night / 2; estimated.push('isha'); }
  }
  const raw = [fajr, sunrise, S.transit, S.asr(opts.hanafi ? 2 : 1), sunset, isha];
  const out = { estimated };
  NAMES.forEach((k, i) => {
    if (!isFinite(raw[i])) { out[k] = null; return; }
    const t = at(raw[i]).getTime() + P.adj[i] * 60e3;
    out[k] = new Date(Math.round(t / 60e3) * 60e3);
  });
  return out;
}

function nextDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

// Method chosen by time-zone, matching the Manhaj platform behaviour (verified in tools/verify.mjs).
export const ZONE_METHOD = {
  'Asia/Riyadh': 'UmmAlQura',
};
export function methodForZone(tz) { return ZONE_METHOD[tz] || 'MWL'; }

// Umm al-Qura-compatible Hijri date via Intl (islamic-umalqura calendar).
export function hijri(date, locale = 'ar', tz) {
  try {
    return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(date);
  } catch { return ''; }
}
export function hijriParts(date, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: tz }).formatToParts(date);
    const g = t => +p.find(x => x.type === t).value;
    return { d: g('day'), m: g('month'), y: parseInt(p.find(x => x.type === 'year').value) };
  } catch { return null; }
}
