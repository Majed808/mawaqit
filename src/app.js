import { LANGS, detectLang } from './i18n.js';
import { load, save, resetSettings, PRAYERS } from './store.js';
import { CITIES, nearestCity, distanceKm } from './cities.js';
import { dayTimes, ymdIn, buildEvents, Runner, clearLedger } from './scheduler.js';
import { chime, unlockAudio } from './sound.js';
import { AUTHOR } from './author.js';

const VERSION = '1.0.0';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const HOUR = 3600e3, DAY = 24 * HOUR;

let S = load();
let L, LK;                 // current dictionary + language key
let installEvt = null;
let lastListKey = '';
let lastDay = '';
let locMode = S.loc ? S.loc.mode : 'manual';   // settings UI tab
let cityFilter = '';

// ---------- language ----------
function applyLang() {
  LK = S.lang === 'auto' ? detectLang() : S.lang;
  L = LANGS[LK] || LANGS.en;
  document.documentElement.lang = LK;
  document.documentElement.dir = L.dir;
  document.title = L.appName;
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = L[el.dataset.t]; });
  for (const [id, k] of [['installBtn', 'install'], ['aboutBtn', 'about'], ['settingsBtn', 'settings']]) {
    $(id).title = L[k]; $(id).setAttribute('aria-label', L[k]);
  }
  document.querySelectorAll('[data-back]').forEach(b => b.setAttribute('aria-label', L.back));
  lastListKey = '';
}

// ---------- formatting ----------
const loc = () => S.loc;
const tz = () => (S.loc && S.loc.tz) || deviceTz();
const fmtTime = d => d ? new Intl.DateTimeFormat(`${L.locale}-u-nu-latn`, { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(d) : '—';
const fmtGreg = d => new Intl.DateTimeFormat(`${L.locale}-u-ca-gregory-nu-latn`, { timeZone: tz(), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const fmtHijri = d => { try { return new Intl.DateTimeFormat(`${L.locale}-u-ca-islamic-umalqura-nu-latn`, { timeZone: tz(), day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch { return ''; } };
const fmtDate = d => new Intl.DateTimeFormat(`${L.locale}-u-ca-gregory-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
const pname = (p, friday) => L.prayers[friday && p === 'dhuhr' ? 'jumuah' : p];
const two = n => String(n).padStart(2, '0');
const cityName = c => (c && (c[LK] || c.en)) || '';
function placeName() {
  const l = loc();
  if (!l) return L.chooseCity;
  if (l.name) return cityName(l.name);
  if (l.near) return `${L.near} ${cityName(l.near)}`;
  return L.myLocation;
}

// ---------- home ----------
function computeView(now = new Date()) {
  const l = loc();
  const today = dayTimes(l, S, ymdIn(l.tz, now));
  const tmr = dayTimes(l, S, ymdIn(l.tz, new Date(+now + DAY)));
  const yst = dayTimes(l, S, ymdIn(l.tz, new Date(+now - DAY)));
  let next = null, prev = null;
  for (const p of PRAYERS) {
    const t = today.times[p];
    if (t && t > now) { next = { p, t, day: today }; break; }
    if (t) prev = { p, t, day: today };
  }
  if (!next) next = { p: 'fajr', t: tmr.times.fajr, day: tmr };
  if (!prev) prev = { p: 'isha', t: yst.times.isha, day: yst };
  return { today, next, prev };
}

function renderHome() {
  const l = loc();
  $('placeName').textContent = placeName();
  $('hero').classList.toggle('is-empty', !l);
  if (!l) { renderEmpty(); return; }
  const now = new Date();
  const v = computeView(now);
  $('hijri').textContent = fmtHijri(now);
  $('greg').textContent = fmtGreg(now);

  const rem = Math.max(0, v.next.t - now);
  const h = Math.floor(rem / HOUR), m = Math.floor(rem % HOUR / 60e3), s = Math.floor(rem % 60e3 / 1e3);
  $('nextLabel').textContent = L.next;
  $('nextName').textContent = pname(v.next.p, v.next.day.friday);
  $('nextTime').textContent = fmtTime(v.next.t);
  $('countdown').textContent = `${two(h)}:${two(m)}:${two(s)}`;
  $('countdown').setAttribute('aria-label', `${L.remaining} ${two(h)}:${two(m)}`);
  const span = v.next.t - v.prev.t;
  $('progress').style.width = `${Math.min(100, Math.max(0, (now - v.prev.t) / span * 100)).toFixed(2)}%`;

  // list: re-render only when the minute or settings change
  const key = `${v.today.key}|${v.next.p}|${Math.floor(now / 60e3)}|${LK}|${JSON.stringify([S.adhan, S.iqama, S.loc])}`;
  if (key !== lastListKey) {
    lastListKey = key;
    const est = v.today.times.estimated || [];
    $('list').innerHTML = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map(p => {
      const t = v.today.times[p];
      const isNext = v.next.day === v.today && v.next.p === p;
      const past = t && t <= now && !isNext;
      if (p === 'sunrise') {
        return `<li class="row sun${past ? ' past' : ''}"><span class="nm">${L.prayers.sunrise}</span><span class="tm">${fmtTime(t)}</span><span class="bell-ph"></span></li>`;
      }
      const iq = S.iqama[p];
      const sub = iq.on ? `<span class="sub">${L.iqama} ${L.after} ${iq.min} ${L.min}</span>` : '';
      const e = est.includes(p) ? ` <span class="est" title="${L.estimated}">≈</span>` : '';
      const on = S.adhan[p], nm = pname(p, v.today.friday);
      return `<li class="row${past ? ' past' : ''}${isNext ? ' next' : ''}">
        <span class="nm">${nm}${sub}</span>
        <span class="tm">${fmtTime(t)}${e}</span>
        <button class="bell${on ? '' : ' off'}" data-bell="${p}" type="button" aria-pressed="${on}" aria-label="${L.sAdhanCol}: ${nm}"><svg class="ic"><use href="#i-${on ? 'bell' : 'bell-off'}"/></svg></button>
      </li>`;
    }).join('');
    renderFoot(v);
  }
  renderStatus();
}

function renderEmpty() {
  const now = new Date();
  $('hijri').textContent = fmtHijri(now);
  $('greg').textContent = fmtGreg(now);
  $('nextLabel').textContent = ''; $('nextTime').textContent = '';
  $('nextName').textContent = L.noLocation; $('countdown').textContent = '';
  $('progress').style.width = '0';
  if (lastListKey !== 'empty' + LK) {
    lastListKey = 'empty' + LK;
    $('list').innerHTML = `<li class="empty"><p>${L.sLocWhy}</p>
      <button class="btn" data-act="detect" type="button"><svg class="ic"><use href="#i-locate"/></svg>${L.sDetect}</button>
      <button class="btn ghost" data-act="pick" type="button">${L.chooseCity}</button></li>`;
    $('foot').textContent = ''; $('alert').hidden = true;
  }
  renderStatus();
}

function renderFoot(v) {
  const l = loc();
  const parts = [LK === 'ar' ? 'المصدر: منصة منهاج — رابطة العالم الإسلامي' : 'Source: Manhaj platform — Muslim World League', L.method[v.today.method]];
  if (v.today.ramadan) parts.push(LK === 'ar' ? 'العشاء: 120 دقيقة بعد المغرب (رمضان)' : 'Isha: 120 min after Maghrib (Ramadan)');
  if (l.tz !== deviceTz()) parts.push(L.tzOther(l.tz));
  $('foot').innerHTML = parts.map(esc).join('<br>');
  const msgs = [];
  if (l.mode === 'auto' && Date.now() - l.ts > 30 * DAY) msgs.push(`${L.stale} — ${L.lastUpdate}: ${fmtDate(new Date(l.ts))}`);
  if ((v.today.times.estimated || []).length) msgs.push(`≈ ${L.estimated}`);
  $('alert').hidden = !msgs.length;
  $('alert').textContent = msgs.join(' · ');
}

function notifState() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (S.notify && Notification.permission === 'granted') return 'on';
  return 'off';
}
function renderStatus() {
  const st = notifState(), b = $('statusBtn');
  b.className = 'status ' + ({ on: 'on', off: 'off', denied: 'bad', unsupported: 'bad' })[st];
  $('statusText').textContent = ({ on: `${L.notifOn} · ${L.notifInApp}`, off: L.notifEnable, denied: L.notifBlocked, unsupported: L.notifUnsupported })[st];
}

// ---------- notifications ----------
async function enableNotifications() {
  unlockAudio();
  if (!('Notification' in window)) { toast(L.notifUnsupported); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  S.notify = perm === 'granted';
  persist();
  if (perm === 'denied') toast(L.notifBlocked);
  return S.notify;
}

async function show(title, body, tag, at) {
  const visible = document.visibilityState === 'visible';
  const played = S.sound && visible ? chime(S.volume) : false;
  // While hidden we rely on the OS notification sound, which honours Do-Not-Disturb.
  const opts = { body, tag, lang: LK, dir: L.dir, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
    silent: !S.sound || played, timestamp: at || Date.now(), data: { url: './' } };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) { console.warn('notification failed', e); }
  if (visible) toast(title);
  (window.__mqLog = window.__mqLog || []).push({ title, body, tag, at: Date.now() });
}

function onFire(e) {
  if (notifState() !== 'on') return;
  const p = pname(e.prayer, e.friday), n = L.minutes(e.n), place = placeName();
  const time = fmtTime(new Date(e.prayerAt));
  if (e.type === 'adhan') show(L.nAdhanTitle(p), L.nAdhanBody(p, time, place), e.id, e.at);
  else if (e.type === 'after') show(L.nAfter(p, n), place, e.id, e.at);
  else if (e.type === 'before') show(L.nBefore(p, n), `${p} ${time}`, e.id, e.at);
  else if (e.type === 'iqama') show(L.nIqamaTitle(p), L.nIqamaBody(p, n), e.id, e.at);
}

const runner = new Runner(onFire, () => {
  const l = loc();
  if (!l) return;
  if (l.mode === 'auto' && l.tz !== deviceTz()) {        // device moved to another time zone
    l.tz = deviceTz(); persist(); toast(L.nTzChanged);
  }
  const d = ymdIn(l.tz).d + l.tz;
  if (d !== lastDay) { lastDay = d; reschedule(); }       // day roll-over
});
function reschedule() { runner.setEvents(buildEvents(S.loc, S)); }

// ---------- location ----------
function setLocation(l) { S.loc = l; locMode = l ? l.mode : locMode; lastListKey = ''; persist(); }
function detect(silent) {
  if (!('geolocation' in navigator)) { if (!silent) toast(L.locFail); return; }
  if (!silent) toast(L.locating, 0);
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    const prev = S.loc;
    if (silent && prev && prev.mode === 'auto' && distanceKm(prev.lat, prev.lng, lat, lng) < 2) { prev.ts = Date.now(); save(S); return; }
    const nc = nearestCity(lat, lng), c = { ar: nc.city.ar, en: nc.city.en };
    setLocation({ mode: 'auto', lat: +lat.toFixed(5), lng: +lng.toFixed(5), tz: deviceTz(),
      name: nc.km < 20 ? c : null, near: nc.km < 80 ? c : null, ts: Date.now() });
    if (!silent) { hideToast(); if (location.hash === '#settings') renderSettings(); }
  }, err => {
    if (!silent) toast(err.code === 1 ? L.locDenied : L.locFail, 6000);
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 6 * HOUR });
}
async function refreshAutoLocation() {
  const l = loc();
  if (!l || l.mode !== 'auto' || Date.now() - l.ts < 6 * HOUR) return;
  try { // refresh silently only when permission is already granted — never prompt unexpectedly
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state === 'granted') detect(true);
  } catch { /* permissions API unavailable */ }
}

// ---------- persistence ----------
function persist() { save(S); reschedule(); renderHome(); }

// ---------- settings ----------
const sel = (k, vals, cur, f) => `<select data-k="${k}" aria-label="${k}">${vals.map(v => `<option value="${v}"${+v === +cur ? ' selected' : ''}>${f(v)}</option>`).join('')}</select>`;
const sw = (k, on, extra = '') => `<span class="sw"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''} ${extra}><span></span></span>`;

function renderSettings() {
  const l = loc(), manual = locMode === 'manual';
  const minsOff = v => +v ? L.minutes(+v) : L.sOff;
  const tzs = (Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) || [deviceTz()];
  const curTz = l ? l.tz : deviceTz();
  const locLine = l ? `<b>${esc(placeName())}</b><div class="hint" dir="ltr" style="text-align:start">${l.lat.toFixed(4)}, ${l.lng.toFixed(4)} · ${esc(l.tz)}</div>`
    : `<span class="hint">${L.noLocation}</span>`;
  $('settingsBody').innerHTML = `
  <div class="group"><h3>${L.sLocation}</h3><div class="card">
    <div class="item"><div class="seg" style="flex:1">
      <button type="button" data-act="mode-auto" aria-pressed="${!manual}">${L.sAuto}</button>
      <button type="button" data-act="mode-manual" aria-pressed="${manual}">${L.sManual}</button></div></div>
    <div class="item"><span class="lbl">${locLine}${l && l.mode === 'auto' ? `<div class="hint">${L.lastUpdate}: ${fmtDate(new Date(l.ts))}</div>` : ''}</span></div>
    ${manual ? `
      <div class="item"><input type="search" id="citySearch" placeholder="${L.sSearchCity}" value="${esc(cityFilter)}" autocomplete="off" aria-label="${L.sSearchCity}"></div>
      <div class="cities" id="cityList"></div>
      <div class="item"><span class="lbl">${L.sCoords}</span></div>
      <div class="coords">
        <input type="number" step="any" id="latIn" placeholder="${L.sLat}" value="${l ? l.lat : ''}" aria-label="${L.sLat}">
        <input type="number" step="any" id="lngIn" placeholder="${L.sLng}" value="${l ? l.lng : ''}" aria-label="${L.sLng}">
        <select id="tzIn" aria-label="${L.sTz}">${tzs.map(z => `<option${z === curTz ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select>
        <button class="btn ghost" type="button" data-act="coords">${L.sApply}</button>
      </div>` : `
      <div class="btns"><button class="btn" type="button" data-act="detect"><svg class="ic"><use href="#i-locate"/></svg>${L.sDetect}</button></div>`}
  </div><p class="hint">${L.sLocWhy}</p></div>

  <div class="group"><h3>${L.sLanguage}</h3><div class="card"><div class="item">
    <span class="lbl">${L.sLanguage}</span>
    <select data-k="lang" aria-label="${L.sLanguage}"><option value="auto"${S.lang === 'auto' ? ' selected' : ''}>${L.sLangAuto}</option>
      <option value="ar"${S.lang === 'ar' ? ' selected' : ''}>العربية</option><option value="en"${S.lang === 'en' ? ' selected' : ''}>English</option></select>
  </div></div></div>

  <div class="group"><h3>${L.sNotifications}</h3><div class="card">
    <div class="item"><label for="notifSw">${L.notifEnable}<div class="hint">${notifState() === 'denied' ? L.notifBlocked : L.sNotifWhy}</div></label>${sw('notify', notifState() === 'on', 'id="notifSw"')}</div>
    <div class="item"><span class="lbl">${L.sAfter}</span>${sel('afterMin', [0, 1, 2, 3, 5, 10, 15, 20, 25, 30], S.afterMin, minsOff)}</div>
    <div class="item"><span class="lbl">${L.sBefore}</span>${sel('beforeMin', [0, 5, 10, 15, 20, 30, 45, 60], S.beforeMin, minsOff)}</div>
    <div class="pgrid">
      <span class="h">${L.sPrayerCol}</span><span class="h">${L.sAdhanCol}</span><span class="h">${L.sIqamaCol}</span><span class="h">${L.sIqamaAfter}</span>
      ${PRAYERS.map(p => `<span>${L.prayers[p]}</span>${sw('adhan.' + p, S.adhan[p], `aria-label="${L.sAdhanCol} ${L.prayers[p]}"`)}${sw('iqama.' + p + '.on', S.iqama[p].on, `aria-label="${L.sIqamaCol} ${L.prayers[p]}"`)}
        ${sel('iqama.' + p + '.min', [5, 10, 15, 20, 25, 30, 35, 40, 45], S.iqama[p].min, v => `${v} ${L.min}`)}`).join('')}
    </div>
    <div class="btns"><button class="btn ghost" type="button" data-act="test-notif"><svg class="ic"><use href="#i-bell"/></svg>${L.sTestNotif}</button></div>
  </div></div>

  <div class="group"><h3>${L.sSound}</h3><div class="card">
    <div class="item"><label for="sndSw">${L.sSoundOn}</label>${sw('sound', S.sound, 'id="sndSw"')}</div>
    <div class="item"><span class="lbl">${L.sVolume}</span><input type="range" min="0" max="1" step="0.05" data-k="volume" value="${S.volume}" aria-label="${L.sVolume}"></div>
    <div class="btns"><button class="btn ghost" type="button" data-act="test-sound">${L.sTest}</button></div>
  </div></div>

  <div class="group"><h3>${L.sAdvanced}</h3><div class="card">
    <div class="item"><label for="ramSw">${L.sRamadan}<div class="hint">${L.sRamadanNote}</div></label>${sw('ramadan', S.ramadan, 'id="ramSw"')}</div>
    <div class="btns">
      <button class="btn danger" type="button" data-act="reset">${L.sReset}</button>
      <button class="btn danger" type="button" data-act="reset-loc">${L.sResetLoc}</button>
    </div>
  </div></div>`;
  if (manual) renderCities();
}

function renderCities() {
  const box = $('cityList'); if (!box) return;
  const q = cityFilter.trim().toLowerCase();
  box.innerHTML = CITIES.map((c, i) => [c, i]).filter(([c]) => !q || c.ar.includes(q) || c.en.toLowerCase().includes(q))
    .map(([c, i]) => `<button type="button" data-city="${i}"><span>${esc(cityName(c))}</span><small>${esc(LK === 'ar' ? c.en : c.ar)}</small></button>`).join('');
}

function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  while (ks.length > 1) o = o[ks.shift()];
  o[ks[0]] = val;
}

async function onSettingsChange(e) {
  const t = e.target, k = t.dataset.k;
  if (!k) return;
  const val = t.type === 'checkbox' ? t.checked : (k === 'lang' ? t.value : +t.value);
  if (k === 'notify') {
    if (val) await enableNotifications(); else { S.notify = false; persist(); }
    renderSettings(); return;
  }
  setPath(S, k, val);
  if (k === 'lang') { applyLang(); persist(); renderSettings(); return; }
  persist();
}

async function onAction(e) {
  const b = e.target.closest('[data-act],[data-city],[data-bell]');
  if (!b) return;
  unlockAudio();
  if (b.dataset.bell) { const p = b.dataset.bell; S.adhan[p] = !S.adhan[p]; persist(); return; }
  if (b.dataset.city) {
    const c = CITIES[+b.dataset.city];
    setLocation({ mode: 'manual', lat: c.lat, lng: c.lng, tz: c.tz, name: { ar: c.ar, en: c.en }, ts: Date.now() });
    cityFilter = ''; location.hash = ''; return;
  }
  switch (b.dataset.act) {
    case 'detect': detect(false); break;
    case 'pick': locMode = 'manual'; location.hash = 'settings'; break;
    case 'mode-auto': locMode = 'auto'; renderSettings(); break;
    case 'mode-manual': locMode = 'manual'; renderSettings(); { const s = $('citySearch'); s && s.focus({ preventScroll: true }); } break;
    case 'coords': {
      const lat = parseFloat($('latIn').value), lng = parseFloat($('lngIn').value), z = $('tzIn').value;
      if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) { toast(L.locFail); return; }
      const nc = nearestCity(lat, lng);
      setLocation({ mode: 'manual', lat, lng, tz: z, name: null, near: nc.km < 80 ? { ar: nc.city.ar, en: nc.city.en } : null, ts: Date.now() });
      renderSettings(); break;
    }
    case 'test-sound': chime(S.volume); break;
    case 'test-notif':
      if (notifState() === 'on' || await enableNotifications()) show(L.appName, L.nTest, 'test-' + Date.now());
      renderSettings(); break;
    case 'reset': if (confirm(L.sConfirmReset)) { S = resetSettings(S.loc); applyLang(); persist(); renderSettings(); } break;
    case 'reset-loc': S.loc = null; locMode = 'manual'; clearLedger(); persist(); location.hash = ''; break;
    case 'install': doInstall(); break;
    case 'share': doShare(); break;
    case 'update': navigator.serviceWorker.getRegistration().then(r => r && r.waiting && r.waiting.postMessage('skipWaiting')); break;
  }
}

// ---------- about ----------
function renderAbout() {
  const l = loc();
  const method = l ? L.method[dayTimes(l, S, ymdIn(l.tz)).method] : `${L.method.UmmAlQura} / ${L.method.MWL}`;
  const btns = `<div class="btns" style="padding:8px 0"><button class="btn" type="button" data-act="share"><svg class="ic"><use href="#i-share"/></svg>${L.share}</button>
    ${installEvt || (isIOS() && !isStandalone()) ? `<button class="btn ghost" type="button" data-act="install"><svg class="ic"><use href="#i-install"/></svg>${L.install}</button>` : ''}</div>`;
  const aName = esc(LK === 'ar' ? AUTHOR.ar : AUTHOR.en);
  const author = `<div class="card author"><span class="av">${esc(aName.charAt(0))}</span><div><b>${aName}</b>${AUTHOR.email ? `<br><a href="mailto:${esc(AUTHOR.email)}">${esc(AUTHOR.email)}</a>` : ''}</div></div>`;
  $('aboutBody').innerHTML = LK === 'ar' ? `
  <p><b>مواقيت</b> أداة خفيفة ومستقلة للتذكير بمواقيت الصلاة والإقامة، تعمل على الجوال والكمبيوتر دون حساب، ودون إنترنت بعد التثبيت.</p>
  <h3>مصدر المواقيت وطريقة الحساب</h3>
  <p>تعتمد الأداة مواقيت <a href="https://portal.themwl.org/ar/applications" target="_blank" rel="noopener">منصة منهاج — رابطة العالم الإسلامي</a>، التي تختار طريقة الحساب حسب المنطقة الزمنية:</p>
  <ul><li><b>داخل المملكة (توقيت الرياض):</b> تقويم أم القرى — الفجر عند انخفاض الشمس 18.5°، والعشاء بعد المغرب بـ 90 دقيقة.</li>
  <li><b>خارج المملكة:</b> طريقة رابطة العالم الإسلامي — الفجر 18°، والعشاء 17°.</li>
  <li>العصر عند صيرورة ظل الشيء مثله، والتقريب لأقرب دقيقة.</li></ul>
  <p>تُحسب المواقيت فلكيًا على جهازك بالخوارزمية نفسها، فتعمل دون إنترنت ولا يُرسل موقعك إلى أي جهة.</p>
  <p class="muted">التحقق: طوبقت النتائج مع منصة منهاج في 24 حالة (مكة، الرياض، جدة، المدينة، الدمام، أبها، تبوك، و17 مدينة وحالة دولية) بتاريخ 17 نوفمبر 2026 دون أي فرق. الطريقة الحالية: ${esc(method)}.</p>
  <p class="muted">ملاحظة: منصة منهاج لا تعرض مواقيت الأيام القادمة، لذا لم يُتحقق بعدُ من سلوكها في رمضان؛ خيار «العشاء بعد المغرب بساعتين في رمضان» متاح في الإعدادات وغير مفعّل افتراضيًا. المواقيت المعلَّمة بـ ≈ تقديرية لخطوط العرض المرتفعة.</p>
  <h3>الإشعارات — ما يجب معرفته</h3>
  <ul><li>تُجدول التنبيهات للأيام السبعة القادمة، ولا يُرسل أي تنبيه أكثر من مرة.</li>
  <li><b>الكمبيوتر (Windows / macOS):</b> ثبّت الأداة من Chrome أو Edge، ويمكن تصغير نافذتها. ولتعمل بعد إعادة التشغيل فعّل «بدء التطبيق عند تسجيل الدخول» من إعدادات التطبيق في المتصفح.</li>
  <li><b>Android:</b> تصل التنبيهات والتطبيق مفتوح أو في الخلفية. إذا أغلق النظام التطبيق كليًا فلا تستطيع تطبيقات الويب جدولة إشعار محلي — وهذا من قيود المتصفح.</li>
  <li><b>iPhone / iPad (iOS 16.4+):</b> يلزم «الإضافة إلى الشاشة الرئيسية» أولًا. يوقف iOS تطبيقات الويب في الخلفية، فتصل التنبيهات بموثوقية والتطبيق مفتوح فقط.</li>
  <li>عند فتح التطبيق بعد انقطاع يُرسل التنبيه الفائت إن لم يتأخر أكثر من 10 دقائق، وإلا يُتجاوز.</li>
  <li>حين يكون التطبيق مخفيًا يُستخدم صوت إشعار النظام، فيُحترم وضع «عدم الإزعاج».</li></ul>
  <h3>الخصوصية</h3>
  <ul><li>لا حساب، ولا خادم، ولا تتبع. الإعدادات والموقع محفوظة على جهازك فقط.</li>
  <li>يُطلب إذن الموقع لحساب المواقيت، وإذن الإشعارات للتنبيه — ولا شيء غيرهما.</li></ul>
  <h3>التثبيت والمشاركة</h3>
  <ul><li><b>Android (Chrome):</b> زر «تثبيت» أعلى الشاشة، أو قائمة المتصفح ← «تثبيت التطبيق».</li>
  <li><b>iPhone (Safari):</b> زر المشاركة ← «إضافة إلى الشاشة الرئيسية».</li>
  <li><b>Windows / macOS (Chrome أو Edge):</b> أيقونة التثبيت في شريط العنوان.</li></ul>
  ${btns}<h3>إعداد</h3>${author}<p class="muted">الإصدار ${VERSION}</p>`
  : `
  <p><b>Mawaqit</b> is a small, standalone prayer &amp; iqama reminder for phones and computers — no account, works offline once installed.</p>
  <h3>Source &amp; calculation</h3>
  <p>Times follow the <a href="https://portal.themwl.org/en/applications" target="_blank" rel="noopener">Manhaj platform — Muslim World League</a>, which selects the method by time zone:</p>
  <ul><li><b>Saudi Arabia (Riyadh time):</b> Umm al-Qura — Fajr at 18.5°, Isha 90 minutes after Maghrib.</li>
  <li><b>Elsewhere:</b> Muslim World League — Fajr 18°, Isha 17°.</li>
  <li>Asr at shadow length = object length; times rounded to the nearest minute.</li></ul>
  <p>The same astronomical algorithm runs on your device, so it works offline and your location never leaves it.</p>
  <p class="muted">Verification: matched the Manhaj platform in 24 cases (Makkah, Riyadh, Jeddah, Madinah, Dammam, Abha, Tabuk and 17 international cases) on 17 Nov 2026 with zero differences. Current method: ${esc(method)}.</p>
  <p class="muted">Note: Manhaj does not publish future days, so its Ramadan behaviour is not yet verified; “Isha 2 hours after Maghrib in Ramadan” is available in Settings and off by default. Times marked ≈ are high-latitude estimates.</p>
  <h3>Notifications — what to know</h3>
  <ul><li>Reminders are planned 7 days ahead; each one fires at most once.</li>
  <li><b>Windows / macOS:</b> install from Chrome or Edge; the window may be minimised. To keep working after a reboot, enable “Start app when you sign in” in the browser's app settings.</li>
  <li><b>Android:</b> alerts arrive while the app is open or in the background. If the system fully closes it, web apps cannot schedule local notifications — a browser limitation.</li>
  <li><b>iPhone / iPad (iOS 16.4+):</b> “Add to Home Screen” first. iOS suspends web apps in the background, so alerts are reliable only while the app is open.</li>
  <li>When reopened, a missed alert is still shown if it is at most 10 minutes late; otherwise it is skipped.</li>
  <li>While the app is hidden the system notification sound is used, so Do-Not-Disturb is respected.</li></ul>
  <h3>Privacy</h3>
  <ul><li>No account, no server, no tracking. Settings and location stay on your device.</li>
  <li>Only location (to calculate) and notification (to alert) permissions are requested.</li></ul>
  <h3>Install &amp; share</h3>
  <ul><li><b>Android (Chrome):</b> the Install button at the top, or browser menu → Install app.</li>
  <li><b>iPhone (Safari):</b> Share → Add to Home Screen.</li>
  <li><b>Windows / macOS (Chrome or Edge):</b> the install icon in the address bar.</li></ul>
  ${btns}<h3>Made by</h3>${author}<p class="muted">Version ${VERSION}</p>`;
}

// ---------- install / share ----------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function doInstall() {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBtn').hidden = true; }
  else if (isIOS()) toast(L.iosInstall, 8000);
}
async function doShare() {
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) await navigator.share({ title: L.appName, text: L.appTagline, url });
    else { await navigator.clipboard.writeText(url); toast(L.copied); }
  } catch { /* cancelled */ }
}

// ---------- toast ----------
let toastTimer;
function toast(msg, ms = 3500, action) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" data-act="${action.act}">${esc(action.label)}</button>` : ''}`;
  t.hidden = false; clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('toast').hidden = true; }

// ---------- routing ----------
function route() {
  const v = location.hash.slice(1);
  $('settings').hidden = v !== 'settings';
  $('about').hidden = v !== 'about';
  $('home').hidden = !!v;
  window.scrollTo(0, 0);
  if (v === 'settings') renderSettings();
  else if (v === 'about') renderAbout();
  else { lastListKey = ''; renderHome(); }
}

// ---------- boot ----------
function boot() {
  applyLang();
  document.addEventListener('click', onAction);
  $('settingsBody').addEventListener('change', onSettingsChange);
  $('settingsBody').addEventListener('input', e => {
    if (e.target.id === 'citySearch') { cityFilter = e.target.value; renderCities(); }
    else if (e.target.dataset.k === 'volume') { S.volume = +e.target.value; save(S); }
  });
  $('settingsBtn').onclick = () => { location.hash = 'settings'; };
  $('aboutBtn').onclick = () => { location.hash = 'about'; };
  $('placeBtn').onclick = () => { location.hash = 'settings'; };
  $('installBtn').onclick = doInstall;
  $('statusBtn').onclick = async () => { if (notifState() === 'off') await enableNotifications(); else location.hash = 'about'; };
  document.querySelectorAll('[data-back]').forEach(b => { b.onclick = () => { location.hash = ''; }; });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { runner.kick(); refreshAutoLocation(); if (!location.hash) renderHome(); }
  });
  window.addEventListener('focus', () => runner.kick());
  window.addEventListener('storage', ev => { if (ev.key === 'mq.settings.v1') { S = load(); applyLang(); reschedule(); route(); } });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  window.addEventListener('appinstalled', () => { installEvt = null; $('installBtn').hidden = true; });
  if (isIOS() && !isStandalone()) $('installBtn').hidden = false;

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const ask = () => toast(L.updateReady, 0, { act: 'update', label: L.updateNow });
      if (reg.waiting && navigator.serviceWorker.controller) ask();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(); });
      });
    }).catch(e => console.warn('SW', e));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  route();
  reschedule();
  refreshAutoLocation();
  setInterval(() => { if (!location.hash) renderHome(); }, 1000);
  window.__mq = { S: () => S, events: () => runner.events, runner };   // hook for automated tests
}
boot();
