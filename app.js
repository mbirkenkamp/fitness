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
    if (data && Array.isArray(data.exercises)) return data;
  } catch (e) { /* ignore corrupt or unavailable storage */ }
  return { exercises: [] };
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
  $('unit-label').textContent = ex.unit;
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
  currentId = li.dataset.id;
  $('date').value = today();
  render();
  scrollTo(0, 0);
});

$('back').addEventListener('click', () => { currentId = null; render(); });

$('add-ex').addEventListener('click', () => { $('ex-name').value = ''; $('ex-dialog').showModal(); $('ex-name').focus(); });

$('ex-dialog').addEventListener('close', () => {
  if ($('ex-dialog').returnValue !== 'ok') return;
  const name = $('ex-name').value.trim(), unit = $('ex-unit').value.trim();
  if (!name || !unit) return;
  state.exercises.push({ id: uid(), name, unit, entries: [] });
  save(); render();
});

$('entry-form').addEventListener('submit', e => {
  e.preventDefault();
  const ex = current();
  const value = parseFloat($('value').value);
  if (!ex || !isFinite(value)) return;
  ex.entries.push({
    id: uid(), ts: Date.now(), value, date: $('date').value || today(),
    rating: document.querySelector('input[name=rating]:checked').value,
  });
  save();
  $('value').value = '';
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
  currentId = null;
  save(); render();
});

render();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
