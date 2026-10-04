import { meta } from './meta.js';
import { renderSections, features } from './sections.js';

const storageKey = `${meta.id}:v${meta.version}:review`;
const records = new Map();
let saveTimer;
let storageError = '';
let activeRole = 'all';
renderSections();
const controls = [...document.querySelectorAll('[data-review]')];
const allowedKeys = new Set(controls.map(el => el.dataset.review));

function status(message) {
  document.querySelector('#review-status').textContent = message;
}
function currentStatus() {
  const reviewed = [...records.values()].filter(r => r.reviewed).length;
  const notes = [...records.values()].filter(r => r.note.trim()).length;
  status(storageError || `${reviewed} items reviewed · ${notes} notes · stored locally in this browser`);
}
function loadReview() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || saved.blueprint !== meta.id || saved.version !== meta.version || !Array.isArray(saved.entries)) throw new Error('Invalid saved review');
    for (const entry of saved.entries.slice(0,1000)) {
      if (!entry || !allowedKeys.has(entry.key) || typeof entry.reviewed !== 'boolean' || typeof entry.note !== 'string' || entry.note.length > 2000) continue;
      records.set(entry.key,{reviewed:entry.reviewed,note:entry.note});
    }
  } catch {
    storageError = 'Saved review could not be loaded. New notes remain available for export; no saved record has been cleared.';
  }
}
function payload() {
  return {blueprint:meta.id,version:meta.version,revision:meta.revision ?? 1,applicationSource:meta.source,updatedAt:new Date().toISOString(),
    meaning:'Review notes only; reviewed does not grant implementation approval, legal eligibility or funding authority.',
    entries:[...records].map(([key,value]) => ({key,...value}))};
}
function saveReview() {
  try {
    localStorage.setItem(storageKey,JSON.stringify(payload()));
    storageError = '';
  } catch {
    storageError = 'Browser storage is unavailable or full. Your notes remain on this page; use Export review before closing it.';
  }
  currentStatus();
}
loadReview();
for (const el of controls) {
  const key = el.dataset.review;
  const checkbox = el.querySelector('input');
  const textarea = el.querySelector('textarea');
  const saved = records.get(key);
  if (saved) { checkbox.checked = saved.reviewed; textarea.value = saved.note; }
  const record = () => {
    records.set(key,{reviewed:checkbox.checked,note:textarea.value.slice(0,2000)});
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveReview,250);
    status('Saving review locally…');
  };
  checkbox.addEventListener('change',record);
  textarea.addEventListener('input',record);
  textarea.addEventListener('change',saveReview);
}
currentStatus();
window.addEventListener('pagehide',() => { if (records.size) saveReview(); });

function filterFeatures() {
  const query = document.querySelector('#search').value.trim().toLocaleLowerCase();
  let count = 0;
  for (const feature of features) {
    const node = document.getElementById(`feature-${feature.id}`);
    const roleMatch = activeRole === 'all' || (activeRole === 'internal' ? feature.personas.length === 0 : feature.personas.includes(activeRole));
    const text = [feature.id,feature.title,feature.route,feature.capability,feature.permission,feature.evidence,...feature.checks].join(' ').toLocaleLowerCase();
    const matches = roleMatch && text.includes(query);
    node.classList.toggle('skipped',!matches);
    if (matches) count++;
  }
  document.querySelector('#feature-count').textContent = `${count} of ${features.length} screens / action groups`;
  document.querySelector('#feature-empty').classList.toggle('skipped',count > 0);
}
document.querySelector('#search').addEventListener('input',filterFeatures);
for (const button of document.querySelectorAll('[data-role]')) button.addEventListener('click',() => {
  activeRole = button.dataset.role;
  for (const other of document.querySelectorAll('[data-role]')) other.setAttribute('aria-pressed',String(other === button));
  filterFeatures();
});
filterFeatures();

document.querySelector('#export').addEventListener('click',() => {
  clearTimeout(saveTimer);
  saveReview();
  const blob = new Blob([JSON.stringify(payload(),null,2)+'\n'],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lockgate-blueprint-review-v${meta.version}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  status('Review export requested. Keep the downloaded JSON with this draft; it contains your notes only.');
});

let beforePrint;
function expandForPrint() {
  if (beforePrint) return;
  beforePrint = [...document.querySelectorAll('details')].map(el => [el,el.open]);
  for (const [el] of beforePrint) el.open = true;
}
function restoreAfterPrint() {
  if (!beforePrint) return;
  for (const [el,open] of beforePrint) el.open = open;
  beforePrint = undefined;
}
window.addEventListener('beforeprint',expandForPrint);
window.addEventListener('afterprint',restoreAfterPrint);
document.querySelector('#print').addEventListener('click',() => { expandForPrint(); window.print(); });
function expandTarget(hash, scroll = false) {
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  for (let parent = target; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  if (scroll) target.scrollIntoView();
}
document.addEventListener('click',event => {
  const link = event.target.closest('a[href^="#"]');
  if (link) expandTarget(link.hash);
});
window.addEventListener('hashchange',() => expandTarget(location.hash,true));
if (location.hash) expandTarget(location.hash,true);
