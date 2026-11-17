// Automated checks: accuracy vs Manhaj reference data + scheduler behaviour. Run: node tools/test.mjs
import { readFileSync } from 'node:fs';
import { computeDay, methodForZone } from '../src/prayer.js';

// --- shims for browser APIs used by scheduler.js
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
let NOW = Date.now();
const realNow = Date.now;
Date.now = () => NOW;
const { buildEvents, Runner, dayTimes, ymdIn, clearLedger } = await import('../src/scheduler.js');
const { DEFAULTS } = await import('../src/store.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('  ✗ ' + msg); } };
const fmt = (d, tz) => new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(d);
const S = () => JSON.parse(JSON.stringify(DEFAULTS));

// 1. accuracy against Manhaj API captures
console.log('1. Manhaj reference comparison');
const ref = JSON.parse(readFileSync(new URL('./ref-2026-11-17.json', import.meta.url)));
for (const [city, r] of Object.entries(ref)) {
  const [y, m, d] = r.date.split('-').map(Number);
  const t = computeDay({ y, m, d }, r.lat, r.lng, methodForZone(r.tz));
  const mine = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map(k => fmt(t[k], r.tz));
  const same = [...mine].sort().join() === [...r.times].sort().join();   // Manhaj sorts its list by time
  ok(same, `${city}: ${mine.join(' ')} != ${r.times.join(' ')}`);
}
console.log(`   ${Object.keys(ref).length} cities checked`);

// 2. events with defaults
console.log('2. default notification plan');
const riyadh = { mode: 'manual', lat: 24.7136, lng: 46.6753, tz: 'Asia/Riyadh', name: null, ts: 0 };
NOW = Date.parse('2026-11-17T06:00:00Z');           // 09:00 Riyadh
let ev = buildEvents(riyadh, S(), NOW);
const today = ev.filter(e => e.day === '2026-11-17');
ok(today.filter(e => e.type === 'adhan').length === 4, 'today after 09:00 should have dhuhr..isha adhan (4)');
ok(today.filter(e => e.type === 'after').length === 4, 'after-adhan reminders (4)');
ok(!ev.some(e => e.type === 'iqama' || e.type === 'before'), 'iqama/before off by default');
ok(new Set(ev.map(e => e.id)).size === ev.length, 'event ids unique');
const dh = today.find(e => e.prayer === 'dhuhr' && e.type === 'adhan'), dha = today.find(e => e.prayer === 'dhuhr' && e.type === 'after');
ok(fmt(new Date(dh.at), 'Asia/Riyadh') === '11:38 AM', 'dhuhr adhan at 11:38');
ok(dha.at - dh.at === 5 * 60e3, 'after reminder = +5 min');
ok(ev.some(e => e.day === '2026-11-24'), 'plan covers 7 days ahead');

// 3. custom settings
console.log('3. custom settings');
const s3 = S(); s3.afterMin = 10; s3.beforeMin = 15; s3.adhan.asr = false; s3.iqama.maghrib = { on: true, min: 10 }; s3.afterMin = 0;
ev = buildEvents(riyadh, s3, NOW).filter(e => e.day === '2026-11-17');
ok(!ev.some(e => e.prayer === 'asr' && e.type !== 'iqama'), 'asr disabled → no asr adhan/before/after');
ok(!ev.some(e => e.type === 'after'), 'afterMin=0 disables after-reminder');
const mg = ev.find(e => e.prayer === 'maghrib' && e.type === 'adhan'), mi = ev.find(e => e.prayer === 'maghrib' && e.type === 'iqama');
ok(mi && mi.at - mg.at === 10 * 60e3, 'maghrib iqama +10');
const mb = ev.find(e => e.prayer === 'maghrib' && e.type === 'before');
ok(mb && mg.at - mb.at === 15 * 60e3, 'before reminder -15');

// 4. runner: fire once, grace, multiple runners (tabs)
console.log('4. runner firing / dedupe / grace');
clearLedger();
const fired = [];
NOW = dh.at - 1000;
const evs = buildEvents(riyadh, S(), NOW);
const r1 = new Runner(e => fired.push(['r1', e.id])), r2 = new Runner(e => fired.push(['r2', e.id]));
r1.events = evs.slice(); r2.events = evs.slice();
NOW = dh.at + 2000;  // just after dhuhr
await r1.check(); await r2.check();
clearTimeout(r1.timer); clearTimeout(r2.timer);
ok(fired.filter(f => f[1] === dh.id).length === 1, `dhuhr adhan fired exactly once across two tabs (got ${fired.length})`);
NOW = dha.at + 20 * 60e3;   // device was asleep, woke 20 min after the +5 reminder
await r1.check(); clearTimeout(r1.timer);
ok(!fired.some(f => f[1] === dha.id), 'reminder 20 min late is skipped (grace 10 min)');
await r1.check(); clearTimeout(r1.timer);
ok(fired.length === 1, 'no repeats on later checks');
// late but within grace
clearLedger(); fired.length = 0;
const r3 = new Runner(e => fired.push(e.id)); r3.events = buildEvents(riyadh, S(), dh.at - 1000);
NOW = dh.at + 7 * 60e3; await r3.check(); clearTimeout(r3.timer);
ok(fired.includes(dh.id) && fired.includes(dha.id), 'adhan and +5 fired when woken 7 min late');
// rebuilding after a settings change does not re-fire
const before = fired.length; r3.events = buildEvents(riyadh, S(), NOW); await r3.check(); clearTimeout(r3.timer);
ok(fired.length === before, 'rebuild does not duplicate fired events');

// 5. day transition
console.log('5. day transition');
NOW = Date.parse('2026-11-17T20:59:00Z');   // 23:59 Riyadh
ev = buildEvents(riyadh, S(), NOW);
ok(ev[0].day === '2026-11-18' && ev[0].prayer === 'fajr' && ev[0].type === 'adhan', 'next event after midnight is next-day fajr');
ok(ymdIn('Asia/Riyadh', new Date(Date.parse('2026-11-17T21:00:00Z'))).d === 18, 'local date rolls at local midnight');

// 6. time-zone differences between cities
console.log('6. time zones');
const cairo = { lat: 30.0444, lng: 31.2357, tz: 'Africa/Cairo' };
const dc = dayTimes(cairo, S(), { y: 2026, m: 11, d: 17 });
ok(dc.method === 'MWL' && fmt(dc.times.isha, 'Africa/Cairo') === '06:16 PM', 'Cairo uses MWL, isha 6:16 PM');
const dr = dayTimes(riyadh, S(), { y: 2026, m: 11, d: 17 });
ok(dr.method === 'UmmAlQura' && dr.times.isha - dr.times.maghrib === 90 * 60e3, 'Riyadh uses Umm al-Qura, isha = maghrib + 90');

// 7. DST (London spring forward 2027-03-28)
console.log('7. daylight saving');
const lon = { lat: 51.5074, lng: -0.1278, tz: 'Europe/London' };
const a = fmt(dayTimes(lon, S(), { y: 2027, m: 3, d: 27 }).times.dhuhr, 'Europe/London');
const b = fmt(dayTimes(lon, S(), { y: 2027, m: 3, d: 28 }).times.dhuhr, 'Europe/London');
ok(a.startsWith('12:') && b.startsWith('01:'), `London dhuhr shifts with DST (${a} → ${b})`);

// 8. Ramadan option (Ramadan 1448 ≈ Feb 2027)
console.log('8. Ramadan option');
const sr = S(); sr.ramadan = true;
const rd = dayTimes(riyadh, sr, { y: 2027, m: 2, d: 20 });
ok(rd.ramadan && rd.times.isha - rd.times.maghrib === 120 * 60e3, 'Ramadan + option → isha = maghrib + 120');
const rd0 = dayTimes(riyadh, S(), { y: 2027, m: 2, d: 20 });
ok(!rd0.ramadan && rd0.times.isha - rd0.times.maghrib === 90 * 60e3, 'default → 90 even in Ramadan (Manhaj-compatible)');

// 9. performance
console.log('9. performance');
const t0 = realNow(); for (let i = 0; i < 365; i++) computeDay({ y: 2027, m: 1, d: 1 + i }, 24.7, 46.7, 'UmmAlQura'); const dt = realNow() - t0;
ok(dt < 200, `365 days computed in ${dt} ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
