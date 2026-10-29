'use strict';

const STORAGE_KEY = 'fitness-tracker-v1';
const FACES = { bad: '😞', mid: '😐', good: '😊' };
const COLORS = { bad: '#dc2626', mid: '#d97706', good: '#16a34a' };
const RATINGS = ['bad', 'mid', 'good'];
const RATING_VALUE = { bad: 1, mid: 2, good: 3 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const $ = id => document.getElementById(id);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = load();
let currentId = null;
let showSettings = false;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.exercises)) {
      migrate(data);
      data.fasting = cleanFasting(data.fasting);
      return data;
    }
  } catch (e) { /* ignore corrupt or unavailable storage */ }
  return { exercises: [], fasting: defaultFasting() };
}

// Exercises are either 'time' (stored in seconds) or 'reps'. Older data had a free-text unit.
function migrate(data) {
  for (const ex of data.exercises) {
    if (ex.type) continue;
    const mins = /^(m|min|mins|minute|minutes)$/i.test(ex.unit);
    const secs = /^(s|sec|secs|second|seconds)$/i.test(ex.unit);
    if (mins) ex.entries.forEach(e => { e.value = Math.round(e.value * 60); });
    ex.type = mins || secs ? 'time' : 'reps';
    ex.unit = ex.type === 'time' ? 'sec' : 'reps';
  }
  return data;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { alert('Could not save to this device\'s storage.'); }
}

// The fasting card opens the same detail page as an exercise, backed by state.fasting.
const FASTING_ID = 'fasting';
const fastingEx = () => ({
  id: FASTING_ID, name: 'Intermittent fasting', type: 'fasting', unit: '',
  get entries() { return state.fasting.entries; },
  set entries(v) { state.fasting.entries = v; },
});
const current = () => currentId === FASTING_ID
  ? (state.fasting.enabled ? fastingEx() : null)
  : state.exercises.find(e => e.id === currentId);
const sorted = ex => [...ex.entries].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);

function render() {
  const ex = current();
  const onList = !ex && !showSettings;
  $('list-view').hidden = !onList;
  $('settings-view').hidden = !showSettings;
  $('detail-view').hidden = !ex;
  // The left button is the cog on the list and a back arrow everywhere else.
  $('icon-cog').style.display = onList ? '' : 'none';
  $('icon-back').hidden = onList;
  $('nav').setAttribute('aria-label', onList ? 'Settings' : 'Back');
  $('add-ex').hidden = !onList;
  $('title').textContent = ex ? ex.name : showSettings ? 'Settings' : 'Fitness Tracker';
  applyHeader();
  if (ex) renderDetail(ex);
  else if (onList) renderList();
  else renderSettings();
}

function renderList() {
  $('empty').hidden = state.exercises.length > 0 || state.fasting.enabled;
  $('exercises').innerHTML = state.exercises.map(ex => {
    const last = sorted(ex).pop();
    return `<li data-id="${ex.id}">
      <div class="grow"><div class="name">${esc(ex.name)}</div>
      <div class="sub">${last ? `${last.value} ${esc(ex.unit)} · ${last.date}` : 'No entries yet'} · ${ex.entries.length} total</div></div>
      <div class="last">${last ? FACES[last.rating] : ''}</div></li>`;
  }).join('') + fastingCard();
}

function fastingCard() {
  if (!state.fasting.enabled) return '';
  const last = sorted(fastingEx()).pop();
  return `<li data-id="${FASTING_ID}">
    <div class="grow"><div class="name">Intermittent fasting</div>
    <div class="sub">${esc(fastingStatus())}${last ? ` · last: ${last.date}` : ''}</div></div>
    <div class="last">${last ? FACES[last.rating] : ''}</div></li>`;
}

function renderDetail(ex) {
  const isTime = ex.type === 'time', isFasting = ex.type === 'fasting';
  $('timer-panel').hidden = !isTime;
  $('time-hint').hidden = !isTime;
  $('value-label').hidden = isTime || isFasting;
  $('value').required = !isTime && !isFasting;
  $('entry-form').parentElement.hidden = isFasting;
  $('delete-ex').hidden = isFasting;
  $('fast-panel').hidden = !isFasting;
  if (isFasting) $('fast-status').textContent = fastingStatus();
  $('chart').innerHTML = chartSvg(sorted(ex), ex.unit, isFasting ? FASTING_SCALE : null);
  const rows = sorted(ex).reverse();
  $('history').innerHTML = rows.length ? rows.map(e => `<li>
    <span class="face">${FACES[e.rating]}</span>
    <div class="grow"><strong>${isFasting ? RATING_LABEL[e.rating] : `${e.value} ${esc(ex.unit)}`}</strong><div class="date">${e.date}</div></div>
    <button data-del="${e.id}" aria-label="Delete entry">✕</button></li>`).join('')
    : '<li class="muted">No entries yet.</li>';
}

// `scale` pins the y axis to labelled ticks (used for the fasting ratings).
function chartSvg(entries, unit, scale) {
  const W = 320, H = 200, L = 36, R = 12, T = 14, B = 28;
  if (!entries.length) return `<p class="muted">${scale ? 'Your daily ratings will show up here.' : 'Add entries to see your progress.'}</p>`;
  const fmt = n => +n.toFixed(1);
  let min, max, ticks;
  if (scale) ({ min, max, ticks } = scale);
  else {
    const vals = entries.map(e => e.value);
    min = Math.min(...vals); max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1; min = Math.max(0, min - pad); max += pad;
    ticks = [0, 1, 2, 3, 4].map(i => { const v = min + (max - min) * i / 4; return { v, label: fmt(v) }; });
  }
  const x = i => L + (entries.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (entries.length - 1));
  const y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">`;
  for (const t of ticks) {
    const yy = y(t.v);
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 4}" y="${yy + 3}" text-anchor="end">${t.label}</text>`;
  }
  if (unit) s += `<text x="${L}" y="9">${esc(unit)}</text>`;
  s += `<polyline class="line" points="${entries.map((e, i) => `${x(i)},${y(e.value)}`).join(' ')}"/>`;
  entries.forEach((e, i) => {
    s += `<circle cx="${x(i)}" cy="${y(e.value)}" r="5" fill="${COLORS[e.rating]}" stroke="#fff" stroke-width="1.5"><title>${e.date}: ${scale ? '' : `${e.value} ${esc(unit)} `}${FACES[e.rating]}</title></circle>`;
  });
  const first = entries[0].date, last = entries[entries.length - 1].date;
  s += `<text x="${L}" y="${H - 8}">${first}</text>`;
  if (entries.length > 1) s += `<text x="${W - R}" y="${H - 8}" text-anchor="end">${last}</text>`;
  return s + '</svg>';
}

$('exercises').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  stopTimer();
  currentId = li.dataset.id;
  $('date').value = today();
  render();
  scrollTo(0, 0);
});

$('nav').addEventListener('click', () => {
  if (current() || showSettings) { stopTimer(); currentId = null; showSettings = false; }
  else showSettings = true;
  render();
  scrollTo(0, 0);
});

$('add-ex').addEventListener('click', () => { $('ex-name').value = ''; $('ex-dialog').returnValue = ''; $('ex-dialog').showModal(); $('ex-name').focus(); });

$('ex-dialog').addEventListener('close', () => {
  if ($('ex-dialog').returnValue !== 'ok') return;
  const name = $('ex-name').value.trim(), type = $('ex-type').value;
  if (!name) return;
  state.exercises.push({ id: uid(), name, type, unit: type === 'time' ? 'sec' : 'reps', entries: [] });
  save(); render();
});

$('entry-form').addEventListener('submit', e => {
  e.preventDefault();
  const ex = current();
  let value;
  if (!ex) return;
  if (ex.type === 'time') {
    value = Math.round(timerMs() / 1000);
    if (value < 1) return alert('Run the timer first.');
    if (timer.startedAt) return alert('Pause the timer before saving.');
  } else {
    value = parseInt($('value').value, 10);
    if (!isFinite(value) || value < 1) return;
  }
  ex.entries.push({
    id: uid(), ts: Date.now(), value, date: $('date').value || today(),
    rating: document.querySelector('input[name=rating]:checked').value,
  });
  save();
  $('value').value = '';
  stopTimer();
  render();
});

$('history').addEventListener('click', e => {
  const id = e.target.dataset.del, ex = current();
  if (!id || !ex || !confirm('Delete this entry?')) return;
  ex.entries = ex.entries.filter(x => x.id !== id);
  save(); render();
});

// ---- Intermittent fasting ----------------------------------------------------
const RATING_LABEL = { bad: 'Bad', mid: 'OK', good: 'Good' };
const FASTING_SCALE = { min: 0.5, max: 3.5, ticks: [1, 2, 3].map(v => ({ v, label: FACES[['bad', 'mid', 'good'][v - 1]] })) };
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; the index is Date#getDay()
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EATING_COLOR = '#15803d', FASTING_COLOR = '#b91c1c', DEFAULT_HEADER = '#0f766e';

function defaultFasting() {
  return {
    enabled: false, since: null, lastPrompted: null, entries: [],
    schedule: Array.from({ length: 7 }, () => ({ fast: true, from: '12:00', to: '20:00' })),
  };
}

// Tolerant for stored data; strict (throws) for imported files.
function cleanFasting(f, strict) {
  const out = defaultFasting();
  if (!f || typeof f !== 'object') { if (strict) throw new Error('The fasting data is invalid.'); return out; }
  out.enabled = f.enabled === true;
  out.since = DATE_RE.test(f.since) ? f.since : null;
  out.lastPrompted = DATE_RE.test(f.lastPrompted) ? f.lastPrompted : null;
  if (Array.isArray(f.schedule)) {
    out.schedule = out.schedule.map((d, i) => {
      const s = f.schedule[i] || {};
      return { fast: s.fast !== false, from: TIME_RE.test(s.from) ? s.from : d.from, to: TIME_RE.test(s.to) ? s.to : d.to };
    });
  }
  for (const e of Array.isArray(f.entries) ? f.entries : []) {
    if (!e || typeof e.id !== 'string' || !RATINGS.includes(e.rating) || !DATE_RE.test(e.date)) {
      if (strict) throw new Error('The fasting data contains an invalid entry.');
      continue;
    }
    out.entries.push({ id: e.id, ts: Number(e.ts) || 0, value: RATING_VALUE[e.rating], date: e.date, rating: e.rating });
  }
  return out;
}

const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3);
const dateStr = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// null when fasting is off; otherwise whether you are fasting right now and today's schedule.
function fastingNow(now = new Date()) {
  if (!state.fasting.enabled) return null;
  const day = state.fasting.schedule[now.getDay()];
  if (!day.fast) return { fasting: false, day };
  const t = now.getHours() * 60 + now.getMinutes(), a = toMin(day.from), b = toMin(day.to);
  const eating = a < b ? t >= a && t < b : a > b ? t >= a || t < b : false; // a > b: window runs past midnight
  return { fasting: !eating, day };
}

function fastingStatus() {
  const st = fastingNow();
  if (!st) return '';
  if (!st.day.fast) return 'No fasting today';
  return `${st.fasting ? 'Fasting' : 'Eating'} · window ${st.day.from}–${st.day.to}`;
}

// Green header while eating, red while fasting, the normal colour when fasting is off.
function applyHeader() {
  const st = fastingNow(), root = document.documentElement.style;
  const color = st ? (st.fasting ? FASTING_COLOR : EATING_COLOR) : null;
  if (color) root.setProperty('--header-bg', color); else root.removeProperty('--header-bg');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = color || DEFAULT_HEADER;
}

function renderSettings() {
  const f = state.fasting;
  $('fast-enabled').checked = f.enabled;
  $('fast-schedule').hidden = $('fast-hint').hidden = !f.enabled;
  $('fast-schedule').innerHTML = DAY_ORDER.map(d => {
    const s = f.schedule[d];
    const times = s.fast
      ? `<input type="time" data-day="${d}" data-k="from" value="${s.from}" aria-label="${DAY_NAMES[d]} eating from"> – <input type="time" data-day="${d}" data-k="to" value="${s.to}" aria-label="${DAY_NAMES[d]} eating until">`
      : '<span class="muted">no fasting</span>';
    return `<div class="day"><label class="chk"><input type="checkbox" data-day="${d}" data-k="fast"${s.fast ? ' checked' : ''}> ${DAY_NAMES[d]}</label><span class="times">${times}</span></div>`;
  }).join('');
}

$('fast-enabled').addEventListener('change', e => {
  const f = state.fasting;
  f.enabled = e.target.checked;
  if (f.enabled) { f.since = today(); f.lastPrompted = null; } // only ask about days from now on
  save(); render();
});

$('fast-schedule').addEventListener('change', e => {
  const t = e.target, day = state.fasting.schedule[t.dataset.day];
  if (!day) return;
  if (t.dataset.k === 'fast') { day.fast = t.checked; save(); render(); return; }
  if (!TIME_RE.test(t.value)) { t.value = day[t.dataset.k]; return; }
  day[t.dataset.k] = t.value;
  save();
  applyHeader();
});

$('fast-edit').addEventListener('click', () => { currentId = null; showSettings = true; render(); scrollTo(0, 0); });

// Once a day, ask how yesterday's fasting went (only for days you were meant to fast).
let askedFor = null;

function maybeAskYesterday() {
  const f = state.fasting;
  if (!f.enabled || document.querySelector('dialog[open]')) return;
  const now = new Date(), y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yDate = dateStr(y), tDate = dateStr(now);
  if (f.lastPrompted === tDate || (f.since && yDate < f.since)) return;
  if (!f.schedule[y.getDay()].fast || f.entries.some(e => e.date === yDate)) return;
  askedFor = yDate;
  $('fast-day').textContent = y.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('fast-dialog').returnValue = '';
  $('fast-dialog').showModal();
}

$('fast-dialog').addEventListener('close', () => {
  const rating = $('fast-dialog').returnValue;
  if (!askedFor) return;
  if (RATINGS.includes(rating)) {
    state.fasting.entries.push({ id: uid(), ts: Date.now(), value: RATING_VALUE[rating], date: askedFor, rating });
  }
  state.fasting.lastPrompted = dateStr(new Date()); // skipping also counts, so we ask at most once a day
  askedFor = null;
  save(); render();
});

// The window can start or end while the app is open, so re-check regularly and on return.
function refreshFasting() {
  applyHeader();
  if (!$('list-view').hidden) renderList();
  else if (!$('detail-view').hidden && currentId === FASTING_ID) $('fast-status').textContent = fastingStatus();
  maybeAskYesterday();
}
setInterval(refreshFasting, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFasting(); });

// ---- Export / import -------------------------------------------------------
const EXPORT_VERSION = 1;

function exportJson() {
  return JSON.stringify({ app: 'fitness-tracker', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), exercises: state.exercises, fasting: state.fasting }, null, 2);
}

$('export-btn').addEventListener('click', async () => {
  const file = new File([exportJson()], `fitness-backup-${today()}.json`, { type: 'application/json' });
  // The share sheet is the easy way out of an installed iOS PWA; elsewhere just download.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Fitness backup' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Returns a clean copy of the imported data ({ exercises, fasting }) or throws with a readable message.
function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('This is not a valid JSON file.'); }
  if (!data || data.app !== 'fitness-tracker' || !Array.isArray(data.exercises)) throw new Error('This file is not a fitness backup.');
  if (data.version > EXPORT_VERSION) throw new Error('This backup was made by a newer version of the app. Please update first.');
  const exercises = migrate({ exercises: data.exercises.map((ex, i) => {
    const where = `Exercise ${i + 1}`;
    if (!ex || typeof ex.id !== 'string' || typeof ex.name !== 'string' || !ex.name.trim()) throw new Error(`${where} is invalid.`);
    if (ex.type !== undefined && ex.type !== 'time' && ex.type !== 'reps') throw new Error(`${where} has an unknown type.`);
    if (!Array.isArray(ex.entries)) throw new Error(`${where} has no entries list.`);
    const entries = ex.entries.map(e => {
      if (!e || typeof e.id !== 'string' || !isFinite(e.value) || !RATINGS.includes(e.rating) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))
        throw new Error(`${where} ("${ex.name}") contains an invalid entry.`);
      return { id: e.id, ts: Number(e.ts) || 0, value: Number(e.value), date: e.date, rating: e.rating };
    });
    return { id: ex.id, name: ex.name.trim().slice(0, 40), type: ex.type, unit: ex.unit || '', entries };
  }) }).exercises;
  return { exercises, fasting: data.fasting === undefined ? null : cleanFasting(data.fasting, true) };
}

function mergeExercises({ exercises: incoming, fasting }) {
  let addedEx = 0, addedEntries = 0;
  if (fasting) {
    const ids = new Set(state.fasting.entries.map(e => e.id));
    for (const e of fasting.entries) if (!ids.has(e.id)) { state.fasting.entries.push(e); addedEntries++; }
  }
  for (const inc of incoming) {
    const own = state.exercises.find(x => x.id === inc.id);
    if (!own) { state.exercises.push(inc); addedEx++; addedEntries += inc.entries.length; continue; }
    const ids = new Set(own.entries.map(e => e.id));
    for (const e of inc.entries) if (!ids.has(e.id)) { own.entries.push(e); addedEntries++; }
  }
  return { addedEx, addedEntries };
}

let pendingImport = null;

$('import-btn').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async () => {
  const input = $('import-file'), file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    pendingImport = parseImport(await file.text());
  } catch (e) { return alert(e.message); }
  const { exercises, fasting } = pendingImport;
  const n = exercises.reduce((sum, ex) => sum + ex.entries.length, 0);
  $('import-summary').textContent = `${exercises.length} exercise(s) with ${n} entries found` + (fasting ? ` and ${fasting.entries.length} fasting rating(s).` : '.');
  $('import-dialog').returnValue = '';
  $('import-dialog').showModal();
});

$('import-dialog').addEventListener('close', () => {
  const choice = $('import-dialog').returnValue, incoming = pendingImport;
  pendingImport = null;
  if (!incoming || (choice !== 'merge' && choice !== 'replace')) return;
  if (choice === 'replace') {
    state.exercises = incoming.exercises;
    if (incoming.fasting) state.fasting = incoming.fasting;
    alert(`Imported ${incoming.exercises.length} exercise(s).`);
  } else {
    const { addedEx, addedEntries } = mergeExercises(incoming);
    alert(`Added ${addedEx} exercise(s) and ${addedEntries} entries.`);
  }
  save(); render();
});

$('delete-ex').addEventListener('click', () => {
  const ex = current();
  if (!ex || !confirm(`Delete "${ex.name}" and all its history?`)) return;
  state.exercises = state.exercises.filter(x => x.id !== ex.id);
  stopTimer();
  currentId = null;
  save(); render();
});

// Timer: timestamp based, so it stays correct if the tab is throttled or backgrounded.
const timer = { elapsed: 0, startedAt: null, tick: null };
const timerMs = () => timer.elapsed + (timer.startedAt ? Date.now() - timer.startedAt : 0);

function fmtTime(ms) {
  const t = Math.floor(ms / 100), tenths = t % 10, sec = Math.floor(t / 10) % 60, min = Math.floor(t / 600);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`;
}

const BUZZ_EVERY_MS = 30000;
let lastBuzz = 0;
let wakeLock = null;

function updateTimer() {
  const ms = timerMs(), running = !!timer.startedAt;
  $('timer-display').textContent = fmtTime(ms);
  $('timer-toggle').textContent = running ? 'Pause' : ms ? 'Resume' : 'Start';
}

// iOS has no vibration API, so there we fall back to a short beep and a flash of the display.
let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
}

function beep() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.25);
}

function alertUser() {
  if (navigator.vibrate) { navigator.vibrate(200); return; }
  beep();
  const el = $('timer-display');
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 400);
}

// Short alert each full 30 s while running.
function tick() {
  updateTimer();
  const n = Math.floor(timerMs() / BUZZ_EVERY_MS);
  if (n > lastBuzz) {
    lastBuzz = n;
    alertUser();
  }
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* denied or unsupported: timer still works */ }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// The browser drops the lock when the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer.startedAt) acquireWakeLock();
});

function stopTimer() {
  clearInterval(timer.tick);
  timer.tick = null;
  timer.elapsed = 0;
  timer.startedAt = null;
  lastBuzz = 0;
  releaseWakeLock();
  updateTimer();
}

$('timer-toggle').addEventListener('click', () => {
  if (timer.startedAt) {
    timer.elapsed = timerMs();
    timer.startedAt = null;
    clearInterval(timer.tick);
    releaseWakeLock();
  } else {
    unlockAudio();
    timer.startedAt = Date.now();
    lastBuzz = Math.floor(timer.elapsed / BUZZ_EVERY_MS);
    timer.tick = setInterval(tick, 100);
    acquireWakeLock();
  }
  updateTimer();
});
$('timer-reset').addEventListener('click', stopTimer);

render();
maybeAskYesterday();

if ('serviceWorker' in navigator) {
  // Only reload for an update, not on the very first install (no previous controller).
  let hadController = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloading || timer.startedAt) return; // never interrupt a running timer
    reloading = true;
    location.reload();
  });

  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update().catch(() => {});
      // Installed PWAs stay alive in the background, so check again whenever the app comes back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
