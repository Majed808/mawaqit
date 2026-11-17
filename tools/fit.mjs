// Try every method against reference times captured from the Manhaj API for 2026-11-17.
import { computeDay, METHODS } from '../src/prayer.js';
const ref = JSON.parse(process.argv[2] ? (await import('node:fs')).readFileSync(process.argv[2], 'utf8') : '{}');
const fmt = (d, tz) => d ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(d) : '--';
for (const [city, r] of Object.entries(ref)) {
  const [y, m, d] = r.date.split('-').map(Number);
  const rows = [];
  for (const meth of Object.keys(METHODS)) {
    const t = computeDay({ y, m, d }, r.lat, r.lng, meth);
    const mine = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map(k => fmt(t[k], r.tz));
    const diff = mine.map((x, i) => x === r.times[i] ? 0 : 1).reduce((a, b) => a + b);
    rows.push([diff, meth, mine.join(' | ')]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  console.log(`${city.padEnd(10)} ref  ${r.times.join(' | ')}`);
  rows.slice(0, 2).forEach(([df, me, s]) => console.log(`${''.padEnd(10)} ${String(df)} ${me.padEnd(10)} ${s}`));
}
