'use strict';

const STORAGE_KEY = 'fitness-tracker-v1';
const FACES = { bad: '😞', mid: '😐', good: '😊' };
const COLORS = { bad: '#dc2626', mid: '#d97706', good: '#16a34a' };
const RATINGS = ['bad', 'mid', 'good'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
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
      data.food = cleanFood(data.food);
      data.lang = LANGS.includes(data.lang) ? data.lang : 'auto';
      return data;
    }
  } catch (e) { /* ignore corrupt or unavailable storage */ }
  return { exercises: [], fasting: defaultFasting(), food: cleanFood(), lang: 'auto' };
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
  const ex = current(), inFood = foodOpen();
  const onList = !ex && !showSettings && !inFood;
  $('list-view').hidden = !onList;
  $('settings-view').hidden = !showSettings;
  $('detail-view').hidden = !ex;
  $('food-view').hidden = !inFood;
  // The left button is the cog on the list and a back arrow everywhere else.
  $('icon-cog').style.display = onList ? '' : 'none';
  $('icon-back').hidden = onList;
  $('nav').setAttribute('aria-label', t(onList ? 'nav.settings' : 'nav.back'));
  $('add-ex').hidden = !onList;
  $('title').textContent = ex ? ex.name : inFood ? t('food.card') : showSettings ? t('set.title') : t('app.title');
  applyHeader();
  if (ex) renderDetail(ex);
  else if (inFood) renderFood();
  else if (onList) renderList();
  else renderSettings();
}

function renderList() {
  $('empty').hidden = state.exercises.length > 0 || state.fasting.enabled || state.food.enabled;
  $('exercises').innerHTML = state.exercises.map(ex => {
    const last = sorted(ex).pop();
    return `<li data-id="${ex.id}">
      <div class="grow"><div class="name">${esc(ex.name)}</div>
      <div class="sub">${last ? `${last.value} ${esc(unitLabel(ex.unit))} · ${last.date}` : t('list.noEntries')} · ${t('list.total', { n: ex.entries.length })}</div></div>
      <div class="last">${last ? FACES[last.rating] : ''}</div></li>`;
  }).join('') + fastingCard() + foodCard();
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
  if (!isFasting) renderStreaks(ex.entries);
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
    s += `<circle cx="${x(i)}" cy="${y(e.value)}" r="5" fill="${e.color || COLORS[e.rating]}" stroke="#fff" stroke-width="1.5"><title>${e.date}: ${scale ? '' : `${e.value} ${esc(unit)} `}${e.rating ? FACES[e.rating] : ''}</title></circle>`;
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
  if (currentId === FOOD_ID) foodDate = today();
  $('date').value = today();
  render();
  scrollTo(0, 0);
});

$('nav').addEventListener('click', () => {
  if (current() || showSettings || foodOpen()) { stopTimer(); currentId = null; showSettings = false; }
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
  $('food-enabled').checked = state.food.enabled;
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

// ---- Calorie tracking (beta) -------------------------------------------------
const FOOD_ID = 'food';
const OFF = 'https://world.openfoodfacts.org';
let foodDate = today(), foodMeal = 'breakfast';

const foodOpen = () => currentId === FOOD_ID && state.food.enabled;
const dayItems = date => state.food.items.filter(i => i.date === date);
const sumKcal = items => items.reduce((n, i) => n + i.kcal, 0);

// Tolerant for stored data; strict (throws) for imported files.
function cleanFood(f, strict) {
  const out = { enabled: false, items: [] };
  if (!f || typeof f !== 'object') { if (strict) throw new Error(t('food.err.invalid')); return out; }
  out.enabled = f.enabled === true;
  for (const i of Array.isArray(f.items) ? f.items : []) {
    const ok = i && typeof i.id === 'string' && typeof i.name === 'string' && i.name.trim() && DATE_RE.test(i.date)
      && MEALS.includes(i.meal) && typeof i.kcal === 'number' && isFinite(i.kcal) && i.kcal >= 0;
    if (!ok) {
      if (strict) throw new Error(t('food.err.item'));
      continue;
    }
    out.items.push({ id: i.id, ts: Number(i.ts) || 0, date: i.date, meal: i.meal, name: i.name.trim().slice(0, 80),
      grams: isFinite(i.grams) && i.grams > 0 ? Number(i.grams) : null, kcal: Math.round(Number(i.kcal)) });
  }
  return out;
}

function foodCard() {
  if (!state.food.enabled) return '';
  return `<li data-id="${FOOD_ID}">
    <div class="grow"><div class="name">${esc(t('food.card'))} <span class="badge">beta</span></div>
    <div class="sub">${esc(t('food.today', { kcal: sumKcal(dayItems(today())) }))}</div></div>
    <div class="last">🍽️</div></li>`;
}

function dayLabel(date) {
  const y = dateStr(new Date(Date.now() - 86400000));
  if (date === today()) return t('day.today');
  if (date === y) return t('day.yesterday');
  return new Date(date + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function renderFood() {
  const items = dayItems(foodDate);
  $('food-date').textContent = dayLabel(foodDate);
  $('food-next').disabled = foodDate >= today();
  $('food-total').innerHTML = `${sumKcal(items)} <small>kcal</small>`;
  $('meals').innerHTML = MEALS.map(id => {
    const label = t('meal.' + id);
    const list = items.filter(i => i.meal === id).sort((a, b) => a.ts - b.ts);
    return `<section class="panel"><div class="meal-head"><h2>${label}</h2><span class="sum">${sumKcal(list)} kcal</span>
      <button type="button" data-add="${id}" aria-label="${esc(t('food.addTo', { meal: label }))}">＋</button></div>
      <ul class="items">${list.map(i => `<li><div class="grow"><div>${esc(i.name)}</div>
        <div class="sub">${i.grams ? `${+i.grams.toFixed(1)} g · ` : ''}${i.kcal} kcal</div></div>
        <button type="button" data-del-food="${i.id}" aria-label="${esc(t('common.delete'))}">✕</button></li>`).join('')}</ul></section>`;
  }).join('');
  const totals = {};
  for (const i of state.food.items) totals[i.date] = (totals[i.date] || 0) + i.kcal;
  const days = Object.keys(totals).sort().slice(-30).map(date => ({ date, value: totals[date], color: '#0f766e' }));
  $('food-chart').innerHTML = chartSvg(days, 'kcal');
}

function shiftFoodDay(n) {
  const d = new Date(foodDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const next = dateStr(d);
  if (next > today()) return;
  foodDate = next;
  renderFood();
}
$('food-prev').addEventListener('click', () => shiftFoodDay(-1));
$('food-next').addEventListener('click', () => shiftFoodDay(1));

$('food-enabled').addEventListener('change', e => {
  state.food.enabled = e.target.checked;
  save(); render();
});

$('meals').addEventListener('click', e => {
  const add = e.target.closest('[data-add]'), del = e.target.closest('[data-del-food]');
  if (add) openFoodDialog(add.dataset.add);
  else if (del && confirm(t('food.confirmDelete'))) {
    state.food.items = state.food.items.filter(i => i.id !== del.dataset.delFood);
    save(); renderFood();
  }
});

// -- add-food dialog
function openFoodDialog(meal) {
  foodMeal = meal;
  $('food-dialog-title').textContent = t('food.dialogTitle', { meal: t('meal.' + meal) });
  $('food-form').reset();
  $('food-results').innerHTML = '';
  $('food-scan').hidden = !('BarcodeDetector' in window && navigator.mediaDevices);
  $('food-dialog').returnValue = '';
  updateFoodPreview();
  $('food-dialog').showModal();
}

function updateFoodPreview() {
  const g = parseFloat($('food-grams').value), k = parseFloat($('food-kcal100').value);
  $('food-preview').textContent = g > 0 && k >= 0 ? `= ${Math.round(k * g / 100)} kcal` : '';
}
$('food-grams').addEventListener('input', updateFoodPreview);
$('food-kcal100').addEventListener('input', updateFoodPreview);

// Open Food Facts returns kcal per 100 g, or only kJ for some products.
function kcalPer100(n) {
  if (!n) return null;
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
  if (isFinite(num(n['energy-kcal_100g']))) return Math.round(num(n['energy-kcal_100g']));
  if (isFinite(num(n['energy_100g']))) return Math.round(num(n['energy_100g']) / 4.184);
  return null;
}

function toProduct(p) {
  const name = [p.product_name, p.brands && p.brands.split(',')[0]].filter(Boolean).join(' – ');
  return { name, kcal100: kcalPer100(p.nutriments), serving: parseFloat(p.serving_quantity) || null };
}

async function offFetch(url) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const FIELDS = 'code,product_name,brands,nutriments,serving_quantity';
let foundProducts = [];

function showResults(products, note) {
  foundProducts = products;
  $('food-results').innerHTML = note ? `<li class="note">${esc(note)}</li>` : products.map((p, i) =>
    `<li tabindex="0" data-i="${i}">${esc(p.name)}<div class="sub">${esc(p.kcal100 === null ? t('food.noData') : t('food.per100', { kcal: p.kcal100 }))}</div></li>`).join('');
}

async function searchFood() {
  const q = $('food-q').value.trim();
  if (!q) return;
  showResults([], t('food.searching'));
  try {
    let products;
    if (/^\d{8,14}$/.test(q)) {
      const data = await offFetch(`${OFF}/api/v2/product/${q}.json?fields=${FIELDS}`);
      products = data.status === 1 && data.product ? [toProduct(data.product)] : [];
    } else {
      const data = await offFetch(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&fields=${FIELDS}`);
      products = (data.products || []).map(toProduct).filter(p => p.name);
    }
    showResults(products, products.length ? '' : t('food.none'));
  } catch (e) {
    showResults([], t('food.offline'));
  }
}

function pickProduct(i) {
  const p = foundProducts[i];
  if (!p) return;
  $('food-name').value = p.name;
  $('food-kcal100').value = p.kcal100 === null ? '' : p.kcal100;
  $('food-grams').value = p.serving || 100;
  $('food-results').innerHTML = '';
  updateFoodPreview();
  (p.kcal100 === null ? $('food-kcal100') : $('food-grams')).focus();
}

$('food-search').addEventListener('click', searchFood);
$('food-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchFood(); } });
$('food-results').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pickProduct(+li.dataset.i); });
$('food-results').addEventListener('keydown', e => {
  const li = e.target.closest('li[data-i]');
  if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickProduct(+li.dataset.i); }
});

// -- barcode scanning (BarcodeDetector: Android Chrome and desktop Chromium, not iOS Safari)
let scanStream = null;

function stopScan() {
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanStream = null;
  $('scan-video').hidden = true;
}

$('food-scan').addEventListener('click', async () => {
  if (scanStream) return stopScan();
  try {
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const stream = scanStream, video = $('scan-video');
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    while (scanStream === stream) {
      const codes = await detector.detect(video).catch(() => []);
      if (codes.length) {
        stopScan();
        $('food-q').value = codes[0].rawValue;
        return searchFood();
      }
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {
    stopScan();
    showResults([], t('food.camera'));
  }
});

$('food-dialog').addEventListener('close', () => {
  stopScan();
  if ($('food-dialog').returnValue !== 'ok') return;
  const name = $('food-name').value.trim(), grams = parseFloat($('food-grams').value), k100 = parseFloat($('food-kcal100').value);
  if (!name || !(grams > 0) || !(k100 >= 0)) return;
  state.food.items.push({ id: uid(), ts: Date.now(), date: foodDate, meal: foodMeal, name: name.slice(0, 80), grams, kcal: Math.round(k100 * grams / 100) });
  save(); render();
});

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

function renderStreaks(entries) {
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
  return JSON.stringify({ app: 'fitness-tracker', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), exercises: state.exercises, fasting: state.fasting, food: state.food }, null, 2);
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
    return { id: ex.id, name: ex.name.trim().slice(0, 40), type: ex.type, unit: ex.unit || '', entries };
  }) }).exercises;
  return {
    exercises,
    fasting: data.fasting === undefined ? null : cleanFasting(data.fasting, true),
    food: data.food === undefined ? null : cleanFood(data.food, true),
  };
}

function mergeExercises({ exercises: incoming, fasting, food }) {
  let addedEx = 0, addedEntries = 0;
  if (food) {
    const ids = new Set(state.food.items.map(i => i.id));
    for (const i of food.items) if (!ids.has(i.id)) { state.food.items.push(i); addedEntries++; }
  }
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
  const { exercises, fasting, food } = pendingImport;
  const n = exercises.reduce((sum, ex) => sum + ex.entries.length, 0);
  $('import-summary').textContent = t('imp.found', { ex: exercises.length, n })
    + (fasting ? t('imp.foundFasting', { n: fasting.entries.length }) : '') + (food ? t('imp.foundFood', { n: food.items.length }) : '');
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
    if (incoming.food) state.food = incoming.food;
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
