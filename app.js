'use strict';

const STORAGE_KEY = 'fitness-tracker-v1';
const FACES = { bad: '😞', mid: '😐', good: '😊' };
const COLORS = { bad: '#dc2626', mid: '#d97706', good: '#16a34a' };

const $ = id => document.getElementById(id);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = load();
let currentId = null;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.exercises)) return migrate(data);
  } catch (e) { /* ignore corrupt or unavailable storage */ }
  return { exercises: [] };
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

const current = () => state.exercises.find(e => e.id === currentId);
const sorted = ex => [...ex.entries].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);

function render() {
  const ex = current();
  $('list-view').hidden = !!ex;
  $('detail-view').hidden = !ex;
  $('back').hidden = !ex;
  $('add-ex').hidden = !!ex;
  $('title').textContent = ex ? ex.name : 'Fitness Tracker';
  ex ? renderDetail(ex) : renderList();
}

function renderList() {
  $('empty').hidden = state.exercises.length > 0;
  $('exercises').innerHTML = state.exercises.map(ex => {
    const last = sorted(ex).pop();
    return `<li data-id="${ex.id}">
      <div class="grow"><div class="name">${esc(ex.name)}</div>
      <div class="sub">${last ? `${last.value} ${esc(ex.unit)} · ${last.date}` : 'No entries yet'} · ${ex.entries.length} total</div></div>
      <div class="last">${last ? FACES[last.rating] : ''}</div></li>`;
  }).join('');
}

function renderDetail(ex) {
  const isTime = ex.type === 'time';
  $('timer-panel').hidden = !isTime;
  $('time-hint').hidden = !isTime;
  $('value-label').hidden = isTime;
  $('value').required = !isTime;
  $('chart').innerHTML = chartSvg(sorted(ex), ex.unit);
  const rows = sorted(ex).reverse();
  $('history').innerHTML = rows.length ? rows.map(e => `<li>
    <span class="face">${FACES[e.rating]}</span>
    <div class="grow"><strong>${e.value} ${esc(ex.unit)}</strong><div class="date">${e.date}</div></div>
    <button data-del="${e.id}" aria-label="Delete entry">✕</button></li>`).join('')
    : '<li class="muted">No entries yet.</li>';
}

function chartSvg(entries, unit) {
  const W = 320, H = 200, L = 36, R = 12, T = 14, B = 28;
  if (!entries.length) return '<p class="muted">Add entries to see your progress.</p>';
  const vals = entries.map(e => e.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1; min = Math.max(0, min - pad); max += pad;
  const x = i => L + (entries.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (entries.length - 1));
  const y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const fmt = n => +n.toFixed(1);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">`;
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4, yy = y(v);
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 4}" y="${yy + 3}" text-anchor="end">${fmt(v)}</text>`;
  }
  s += `<text x="${L}" y="9">${esc(unit)}</text>`;
  s += `<polyline class="line" points="${entries.map((e, i) => `${x(i)},${y(e.value)}`).join(' ')}"/>`;
  entries.forEach((e, i) => {
    s += `<circle cx="${x(i)}" cy="${y(e.value)}" r="5" fill="${COLORS[e.rating]}" stroke="#fff" stroke-width="1.5"><title>${e.date}: ${e.value} ${esc(unit)} ${FACES[e.rating]}</title></circle>`;
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

$('back').addEventListener('click', () => { stopTimer(); currentId = null; render(); });

$('add-ex').addEventListener('click', () => { $('ex-name').value = ''; $('ex-dialog').showModal(); $('ex-name').focus(); });

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
