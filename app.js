'use strict';

const STORAGE_KEY = 'fitness-tracker-v1';
const FACES = { bad: '😞', mid: '😐', good: '😊' };
const COLORS = { bad: '#dc2626', mid: '#d97706', good: '#16a34a' };
const RATINGS = ['bad', 'mid', 'good'];
const LANGS = ['auto', 'de', 'en'];
const RATING_VALUE = { bad: 1, mid: 2, good: 3 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const $ = id => document.getElementById(id);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ratingLabel = r => t('rating.' + r);
const unitLabel = u => ({ sec: t('unit.sec'), reps: t('unit.reps') }[u] || u);
const dayName = d => new Date(2024, 0, 7 + d).toLocaleDateString(locale(), { weekday: 'short' }); // 2024-01-07 was a Sunday

let state = load();
let currentId = null;
let showSettings = false;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.exercises)) {
      migrate(data);
      data.fasting = cleanFasting(data.fasting);
      delete data.food; // the calorie beta was removed; a later save drops its data
      data.lang = LANGS.includes(data.lang) ? data.lang : 'auto';
      return data;
    }
  } catch (e) { /* ignore corrupt or unavailable storage */ }
  return { exercises: [], fasting: defaultFasting(), lang: 'auto' };
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
  catch (e) { alert(t('err.storage')); }
}

// The fasting card opens the same detail page as an exercise, backed by state.fasting.
const FASTING_ID = 'fasting';
const fastingEx = () => ({
  id: FASTING_ID, get name() { return t('fast.title'); }, type: 'fasting', unit: '',
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
  $('nav').setAttribute('aria-label', t(onList ? 'nav.settings' : 'nav.back'));
  $('add-ex').hidden = !onList;
  $('title').textContent = ex ? ex.name : showSettings ? t('set.title') : t('app.title');
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
      <div class="sub">${last ? `${last.value} ${esc(unitLabel(ex.unit))} · ${last.date}` : t('list.noEntries')} · ${t('list.total', { n: ex.entries.length })}</div></div>
      <div class="last">${last ? FACES[last.rating] : ''}</div></li>`;
  }).join('') + fastingCard();
}

function fastingCard() {
  if (!state.fasting.enabled) return '';
  const last = sorted(fastingEx()).pop();
  return `<li data-id="${FASTING_ID}">
    <div class="grow"><div class="name">${esc(t('fast.title'))}</div>
    <div class="sub">${esc(fastingStatus())}${last ? ` · ${esc(t('fast.last', { date: last.date }))}` : ''}</div></div>
    <div class="last">${last ? FACES[last.rating] : ''}</div></li>`;
}

function renderDetail(ex) {
  const isTime = ex.type === 'time', isFasting = ex.type === 'fasting';
  $('timer-panel').hidden = !isTime;
  $('time-hint').hidden = !isTime;
  $('value-label-text').textContent = t(isTime ? 'form.seconds' : 'form.reps');
  $('value').required = !isFasting;
  $('entry-form').parentElement.hidden = isFasting;
  $('delete-ex').hidden = isFasting;
  $('fast-panel').hidden = !isFasting;
  $('streak-panel').hidden = isFasting;
  if (!isFasting) renderStreaks(ex);
  if (isFasting) $('fast-status').textContent = fastingStatus();
  $('chart').innerHTML = chartSvg(sorted(ex), unitLabel(ex.unit), isFasting ? FASTING_SCALE : null);
  const rows = sorted(ex).reverse();
  $('history').innerHTML = rows.length ? rows.map(e => `<li>
    <span class="face">${FACES[e.rating]}</span>
    <div class="grow"><strong>${isFasting ? ratingLabel(e.rating) : `${e.value} ${esc(unitLabel(ex.unit))}`}</strong><div class="date">${e.date}</div></div>
    <button data-del="${e.id}" aria-label="${esc(t('history.deleteEntry'))}">✕</button></li>`).join('')
    : `<li class="muted">${esc(t('history.empty'))}</li>`;
}

// `scale` pins the y axis to labelled ticks (used for the fasting ratings).
function chartSvg(entries, unit, scale) {
  const W = 320, H = 200, L = 36, R = 12, T = 14, B = 28;
  if (!entries.length) return `<p class="muted">${esc(t(scale ? 'fast.empty' : 'chart.empty'))}</p>`;
  const fmt = n => (max - min > 10 ? Math.round(n) : +n.toFixed(1)); // whole numbers once the range is wide
  let min, max, ticks;
  if (scale) ({ min, max, ticks } = scale);
  else {
    const vals = entries.map(e => e.value);
    min = Math.min(...vals); max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1; min = Math.max(0, min - pad); max += pad;
    ticks = [0, 1, 2, 3, 4].map(i => { const v = min + (max - min) * i / 4; return { v, label: fmt(v).toLocaleString(locale()) }; });
  }
  const x = i => L + (entries.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (entries.length - 1));
  const y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('chart.label'))}">`;
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
  value = parseInt($('value').value, 10);
  if (!isFinite(value) || value < 1) return;
  const before = streakStats(ex.entries).current;
  ex.entries.push({
    id: uid(), ts: Date.now(), value, date: $('date').value || today(),
    rating: document.querySelector('input[name=rating]:checked').value,
  });
  const after = streakStats(ex.entries).current;
  save();
  $('value').value = '';
  stopTimer();
  render();
  const reached = MILESTONES.filter(m => before < m.days && after >= m.days).pop();
  if (reached) celebrate(reached, ex.name);
  else showToast(t('toast.saved'));
});

$('history').addEventListener('click', e => {
  const id = e.target.dataset.del, ex = current();
  if (!id || !ex || !confirm(t('history.confirmDelete'))) return;
  ex.entries = ex.entries.filter(x => x.id !== id);
  save(); render();
});

// ---- Intermittent fasting ----------------------------------------------------
const FASTING_SCALE = { min: 0.5, max: 3.5, ticks: [1, 2, 3].map(v => ({ v, label: FACES[['bad', 'mid', 'good'][v - 1]] })) };
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; the index is Date#getDay()
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
  if (!f || typeof f !== 'object') { if (strict) throw new Error(t('fast.err.invalid')); return out; }
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
      if (strict) throw new Error(t('fast.err.entry'));
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
  if (!st.day.fast) return t('fast.noFastingToday');
  return `${t(st.fasting ? 'fast.fasting' : 'fast.eating')} · ${t('fast.window', { from: st.day.from, to: st.day.to })}`;
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
      ? `<input type="time" data-day="${d}" data-k="from" value="${s.from}" aria-label="${esc(t('fast.eatFrom', { day: dayName(d) }))}"> – <input type="time" data-day="${d}" data-k="to" value="${s.to}" aria-label="${esc(t('fast.eatUntil', { day: dayName(d) }))}">`
      : `<span class="muted">${esc(t('fast.noFasting'))}</span>`;
    return `<div class="day"><label class="chk"><input type="checkbox" data-day="${d}" data-k="fast"${s.fast ? ' checked' : ''}> ${esc(dayName(d))}</label><span class="times">${times}</span></div>`;
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
  $('fast-day').textContent = y.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
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

// Small confirmation at the bottom of the screen; it fades out by itself.
let toastTimer = null;

function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

// ---- Streaks and milestones --------------------------------------------------
// A day counts when the exercise was logged at least once; one missed day breaks the streak.
const MILESTONES = [
  { days: 7, n: 20 }, { days: 14, n: 30 }, { days: 30, n: 43 },
  { days: 90, n: 63 }, { days: 180, n: 87 }, { days: 365, n: 120 },
];
const dayNum = d => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);

function streakStats(entries, now = today()) {
  const set = new Set(entries.map(e => dayNum(e.date))), days = [...set].sort((a, b) => a - b);
  let longest = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    prev = d;
    longest = Math.max(longest, run);
  }
  // The streak stays alive today until the day is over, so it may end yesterday.
  const t = dayNum(now);
  let current = 0, d = set.has(t) ? t : t - 1;
  while (set.has(d)) { current++; d--; }
  return { current, longest, total: days.length };
}

const HEAT_WEEKS = 16;

// -- weekly goal: "train on at least N different days per calendar week (Mon-Sun)"
const goalOf = ex => (Number.isInteger(ex.weeklyGoal) && ex.weeklyGoal >= 1 && ex.weeklyGoal <= 7 ? ex.weeklyGoal : null);
const weekOf = dayNumber => Math.floor((dayNumber + 3) / 7); // 1970-01-01 was a Thursday, so +3 aligns weeks to Monday

function weeklyStats(entries, goal, now = today()) {
  const perWeek = new Map();
  for (const e of entries) {
    const d = dayNum(e.date), w = weekOf(d);
    if (!perWeek.has(w)) perWeek.set(w, new Set());
    perWeek.get(w).add(d);
  }
  const count = w => (perWeek.has(w) ? perWeek.get(w).size : 0);
  const thisWeek = weekOf(dayNum(now));
  // The running week is still open: it only counts once the goal is met, otherwise the streak ends last week.
  let current = 0, w = count(thisWeek) >= goal ? thisWeek : thisWeek - 1;
  while (count(w) >= goal) { current++; w--; }
  let best = 0, run = 0, prev = null;
  for (const wk of [...perWeek.keys()].sort((a, b) => a - b)) {
    if (count(wk) < goal) { run = 0; prev = null; continue; }
    run = prev !== null && wk === prev + 1 ? run + 1 : 1;
    prev = wk;
    best = Math.max(best, run);
  }
  const recent = [];
  for (let i = 7; i >= 0; i--) recent.push({ n: count(thisWeek - i), current: i === 0 });
  return { count: count(thisWeek), current, best, recent };
}

function renderGoal(ex) {
  const goal = goalOf(ex);
  $('goal-select').innerHTML = `<option value="">${esc(t('goal.off'))}</option>`
    + [1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}">${esc(t('goal.option', { n }))}</option>`).join('');
  $('goal-select').value = goal ? String(goal) : '';
  $('goal-body').hidden = !goal;
  if (!goal) return;
  const ws = weeklyStats(ex.entries, goal), met = ws.count >= goal;
  $('ring-num').textContent = `${Math.min(ws.count, 99)}/${goal}`;
  $('ring-fg').style.strokeDasharray = `${264 * Math.min(ws.count / goal, 1)} 264`;
  $('ring-fg').classList.toggle('met', met);
  $('goal-line').textContent = t('goal.option', { n: goal });
  $('goal-sub').textContent = met ? t('goal.reached') : t('goal.remaining', { n: goal - ws.count });
  $('goal-streak').textContent = `${ws.current ? '🔥 ' : ''}${t('goal.weeks', { n: ws.current })} · ${t('goal.best', { n: ws.best })}`;
  $('goal-weeks').innerHTML = ws.recent.map(r => {
    const cls = [r.n >= goal ? 'met' : '', r.current ? 'cur' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" style="height:${Math.round(Math.min(r.n / goal, 1) * 100)}%" title="${r.n}/${goal}"></div>`;
  }).join('');
}

$('goal-select').addEventListener('change', e => {
  const ex = current();
  if (!ex) return;
  ex.weeklyGoal = e.target.value ? parseInt(e.target.value, 10) : null;
  save();
  render();
});

function renderStreaks(ex) {
  const entries = ex.entries;
  renderGoal(ex);
  const st = streakStats(entries);
  $('st-cur').textContent = st.current ? `🔥 ${st.current}` : '0';
  $('st-best').textContent = st.longest;
  $('st-total').textContent = st.total;

  const rank = { bad: 1, mid: 2, good: 3 }, byDay = {};
  for (const e of entries) {
    const day = byDay[e.date] || (byDay[e.date] = { best: e.rating });
    if (rank[e.rating] > rank[day.best]) day.best = e.rating; // a day shows its best rating
  }
  const now = new Date(), t = today();
  const start = new Date(now);
  start.setDate(now.getDate() - (now.getDay() + 6) % 7 - (HEAT_WEEKS - 1) * 7); // Monday, 16 weeks back
  let cells = '', months = [], lastMonth = -1;
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = dateStr(d), day = byDay[ds];
    if (i % 7 === 0 && d.getMonth() !== lastMonth) { months.push({ col: i / 7, label: d.toLocaleDateString(locale(), { month: 'short' }) }); lastMonth = d.getMonth(); }
    const cls = [day ? day.best : '', ds > t ? 'future' : '', ds === t ? 'today' : ''].filter(Boolean).join(' ');
    cells += `<i class="${cls}" title="${ds}${day ? ` · ${FACES[day.best]}` : ''}"></i>`;
  }
  $('heat').innerHTML = cells;
  // Skip a first label that would run into the next one.
  if (months.length > 1 && months[1].col < 3) months.shift();
  $('heat-months').innerHTML = months.map(m => `<span style="grid-column:${m.col + 1}">${m.label}</span>`).join('');
}

// -- milestone celebration: an emoji fountain plus a card
const fx = { raf: null, timer: null };

function stopCelebration() {
  cancelAnimationFrame(fx.raf);
  clearTimeout(fx.timer);
  fx.raf = fx.timer = null;
  const cv = $('fx');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  if ($('msg').classList.contains('on')) $('msg').className = 'off';
}

function celebrate(m, exName) {
  stopCelebration();
  const msg = $('msg');
  msg.innerHTML = `<div class="e">🔥</div><div class="num">${m.days}</div><div class="t">${esc(t('ms.line', { title: t('ms.' + m.days) }))}</div><div class="s">${esc(exName)}</div>`;
  msg.className = '';
  void msg.offsetWidth; // restart the pop-in animation
  msg.className = 'on';
  fx.timer = setTimeout(stopCelebration, 4800);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // card only, no movement

  const cv = $('fx'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rnd = (a, b) => a + Math.random() * (b - a), EMOJI = ['🔥', '🏆', '🎉', '💪', '⭐', '🔥'];
  const parts = [], total = m.n, dur = 1600;
  let spawned = 0, last = performance.now();
  const t0 = last;
  const frame = now => {
    const dt = Math.min(now - last, 50) / 16.67;
    last = now;
    ctx.clearRect(0, 0, W, H);
    const want = Math.min(total, Math.floor(total * Math.min((now - t0) / dur, 1)));
    while (spawned < want) {
      spawned++;
      parts.push({ x: W / 2 + rnd(-20, 20), y: H + 20, vx: rnd(-5, 5) * (W < 600 ? .8 : 1.4), vy: -rnd(12, 20) * (H < 700 ? .85 : 1),
        rot: rnd(-.5, .5), vr: rnd(-.08, .08), size: rnd(24, 46), e: EMOJI[Math.floor(Math.random() * EMOJI.length)] });
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += .3 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.y > H + 60 && p.vy > 0) { parts.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.font = `${p.size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.e, 0, 0);
      ctx.restore();
    }
    if (parts.length || spawned < total) fx.raf = requestAnimationFrame(frame);
  };
  fx.raf = requestAnimationFrame(frame);
}
$('msg').addEventListener('click', stopCelebration);

// ---- Export / import -------------------------------------------------------
const EXPORT_VERSION = 1;

function exportJson() {
  return JSON.stringify({ app: 'fitness-tracker', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), exercises: state.exercises, fasting: state.fasting }, null, 2);
}

$('export-btn').addEventListener('click', async () => {
  const file = new File([exportJson()], `fitness-backup-${today()}.json`, { type: 'application/json' });
  // The share sheet is the easy way out of an installed iOS PWA; elsewhere just download.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t('backup.shareTitle') }); return; }
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
  try { data = JSON.parse(text); } catch (e) { throw new Error(t('imp.err.json')); }
  if (!data || data.app !== 'fitness-tracker' || !Array.isArray(data.exercises)) throw new Error(t('imp.err.notBackup'));
  if (data.version > EXPORT_VERSION) throw new Error(t('imp.err.newer'));
  const exercises = migrate({ exercises: data.exercises.map((ex, i) => {
    const where = t('imp.exercise', { n: i + 1 });
    if (!ex || typeof ex.id !== 'string' || typeof ex.name !== 'string' || !ex.name.trim()) throw new Error(t('imp.err.invalid', { where }));
    if (ex.type !== undefined && ex.type !== 'time' && ex.type !== 'reps') throw new Error(t('imp.err.type', { where }));
    if (!Array.isArray(ex.entries)) throw new Error(t('imp.err.entries', { where }));
    const entries = ex.entries.map(e => {
      if (!e || typeof e.id !== 'string' || !isFinite(e.value) || !RATINGS.includes(e.rating) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))
        throw new Error(t('imp.err.entry', { where, name: ex.name }));
      return { id: e.id, ts: Number(e.ts) || 0, value: Number(e.value), date: e.date, rating: e.rating };
    });
    return { id: ex.id, name: ex.name.trim().slice(0, 40), type: ex.type, unit: ex.unit || '', weeklyGoal: goalOf(ex), entries };
  }) }).exercises;
  return {
    exercises,
    fasting: data.fasting === undefined ? null : cleanFasting(data.fasting, true),
  };
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
  $('import-summary').textContent = t('imp.found', { ex: exercises.length, n })
    + (fasting ? t('imp.foundFasting', { n: fasting.entries.length }) : '');
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
    alert(t('imp.doneReplace', { n: incoming.exercises.length }));
  } else {
    const { addedEx, addedEntries } = mergeExercises(incoming);
    alert(t('imp.doneMerge', { ex: addedEx, n: addedEntries }));
  }
  save(); render();
});

$('delete-ex').addEventListener('click', () => {
  const ex = current();
  if (!ex || !confirm(t('ex.confirmDelete', { name: ex.name }))) return;
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

// The running timer is a full-screen overlay with a big Stop button; the page keeps the last result.
function updateTimer() {
  const text = fmtTime(timerMs());
  $('timer-display').textContent = text;
  $('ov-time').textContent = text;
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
  for (const el of [$('timer-display'), $('ov-time')]) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 400);
  }
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

// Cancels and clears the timer, and closes the overlay.
function stopTimer() {
  clearInterval(timer.tick);
  timer.tick = null;
  timer.elapsed = 0;
  timer.startedAt = null;
  lastBuzz = 0;
  releaseWakeLock();
  $('timer-overlay').hidden = true;
  updateTimer();
}

$('timer-toggle').addEventListener('click', () => {
  unlockAudio();
  timer.elapsed = 0;
  timer.startedAt = Date.now();
  lastBuzz = 0;
  timer.tick = setInterval(tick, 100);
  acquireWakeLock();
  updateTimer();
  $('timer-overlay').hidden = false;
  $('ov-stop').focus();
});

// Stop: keep the measured time, put the seconds into the field and close the overlay.
$('ov-stop').addEventListener('click', () => {
  const ms = timerMs();
  clearInterval(timer.tick);
  timer.tick = null;
  timer.elapsed = ms;
  timer.startedAt = null;
  releaseWakeLock();
  $('timer-overlay').hidden = true;
  updateTimer();
  $('value').value = Math.max(1, Math.round(ms / 1000));
});

$('ov-close').addEventListener('click', stopTimer);

document.querySelectorAll('dialog form').forEach(form => form.addEventListener('keydown', e => {
  const primary = form.querySelector('.primary');
  if (e.key !== 'Enter' || e.defaultPrevented || e.target.tagName !== 'INPUT' || !primary) return;
  e.preventDefault();
  form.requestSubmit(primary);
}));

function applyLanguage() {
  setLang(state.lang === 'auto' ? detectLang() : state.lang);
  applyStatic();
  $('lang-select').value = state.lang;
  updateTimer();
  render();
}
$('lang-select').addEventListener('change', e => {
  state.lang = LANGS.includes(e.target.value) ? e.target.value : 'auto';
  save();
  applyLanguage();
});
addEventListener('languagechange', () => { if (state.lang === 'auto') applyLanguage(); });

applyLanguage();
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
