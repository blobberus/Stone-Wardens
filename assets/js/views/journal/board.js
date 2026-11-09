// Shared pieces of the journal's boards (family trees and timelines): the form controls of their item dialogs (a
// date as year + month + age, tags, colours, symbols, a short markdown description), the item dialog itself, and the
// hover card (the expanded view of an item: mouse over it, focus it, or tap it; clicking keeps it open).
import { h } from '../../core/dom.js';
import { icon, openModal, field, markdownEditor, toast, isTouch } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { calendar, normDate, dateValue, cmpDate, COLORS, colorVar } from './calendar.js';
import { SYMBOLS } from './symbols.js';
import { cleanTag, tagsOf } from './kinds.js';
import { tagList } from './parts.js';
import * as J from './data.js';

const overlays = () => document.querySelector('body > #overlays') || document.body;
let seq = 0;
const uidOf = (p) => `${p}-${(seq += 1)}-${Math.random().toString(36).slice(2, 6)}`;

/** A short random id for a board item. */
export const itemId = (prefix = 'x') => `${prefix}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- form controls ----------

/**
 * Year (an integer box), month (blank allowed) and age (the calendar's ages, in their order).
 * -> {el, get() -> date | null, error() -> message | null, focus()}. optional: a blank year means no date.
 */
export function dateFields({ value = null, optional = false, legend = 'When', hint = null, ageFallback = null } = {}) {
  const cal = calendar();
  const d = normDate(value);
  const id = uidOf('date');
  const year = h('input', {
    class: 'input jr-date-year', type: 'number', step: '1', inputmode: 'numeric', id: `${id}-y`,
    value: d ? String(d.year) : '', placeholder: optional ? 'Year' : 'e.g. 100', 'aria-label': `${legend}: year`,
  });
  const month = h('select', { class: 'select jr-date-month', 'aria-label': `${legend}: month` },
    h('option', { value: '' }, 'No month'),
    cal.months.map((m, i) => h('option', { value: String(i + 1), selected: d?.month === i + 1 }, m)));
  const ageId = d?.age || ageFallback || cal.defaultAge;
  const age = h('select', { class: 'select jr-date-age', 'aria-label': `${legend}: age` },
    cal.ages.map((a) => h('option', { value: a.id, selected: a.id === ageId, title: a.name }, `${a.abbr} · ${a.name}`)),
    !cal.byId.has(ageId) ? h('option', { value: ageId, selected: true }, `${ageId} (not in the ages list)`) : null);
  const el = h('fieldset', { class: 'field jr-date' },
    h('legend', { class: 'field-label' }, legend),
    h('div', { class: 'jr-date-row' },
      h('label', { class: 'jr-date-part', for: `${id}-y` }, h('span', { class: 'jr-date-cap' }, 'Year'), year),
      h('label', { class: 'jr-date-part' }, h('span', { class: 'jr-date-cap' }, 'Month (optional)'), month),
      h('label', { class: 'jr-date-part' }, h('span', { class: 'jr-date-cap' }, 'Age'), age)),
    hint ? h('span', { class: 'field-hint' }, hint) : null);
  const raw = () => String(year.value).trim();
  return {
    el,
    get() {
      if (!raw()) return null;
      return dateValue({ year: Number(raw()), month: month.value ? Number(month.value) : null, age: age.value });
    },
    error() {
      if (!raw()) return optional ? null : `${legend}: give the year.`;
      if (!/^-?\d+$/.test(raw())) return `${legend}: the year is a whole number.`;
      return null;
    },
    focus() { year.focus(); },
  };
}

/** Tags as chips with a box to type more (Enter, comma or space adds one). -> {el, get() -> [tags]} */
export function tagsInput(tags = [], { label = 'Tags' } = {}) {
  let list = tagsOf(tags);
  const listId = uidOf('tags');
  const known = J.allTags().map((t) => t.tag);
  const chips = h('ul', { class: 'jr-chips', role: 'list' });
  const box = h('input', {
    class: 'jr-chip-input', type: 'text', list: listId, autocomplete: 'off', spellcheck: false,
    placeholder: 'Add a tag…', 'aria-label': `${label}: add a tag`,
  });
  const draw = () => {
    chips.replaceChildren(...list.map((t, i) => h('li', { class: 'chip jr-chip' },
      h('span', null, `#${t}`),
      h('button', {
        type: 'button', class: 'chip-x jr-chip-x', 'aria-label': `Remove the tag ${t}`, title: 'Remove',
        onclick: () => { list.splice(i, 1); draw(); box.focus(); },
      }, icon('close')))));
  };
  const commit = () => {
    const parts = box.value.split(/[,\s]+/).map(cleanTag).filter(Boolean);
    for (const t of parts) if (!list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
    box.value = '';
    draw();
  };
  box.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && !e.isComposing) {
      if (box.value.trim()) { e.preventDefault(); e.stopPropagation(); commit(); } else if (e.key !== 'Enter') e.preventDefault();
    } else if (e.key === 'Backspace' && !box.value && list.length) { list.pop(); draw(); }
  });
  box.addEventListener('change', commit);
  box.addEventListener('blur', commit);
  draw();
  const el = h('div', { class: 'field jr-tags-field' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'jr-chipbox', onclick: (e) => { if (e.target === e.currentTarget || e.target === chips) box.focus(); } }, chips, box),
    h('datalist', { id: listId }, known.map((t) => h('option', { value: t }))),
    h('span', { class: 'field-hint' }, 'Press Enter after each tag. Tags show on the item and find this note in the Tags pane and in tag: searches.'));
  return { el, get() { commit(); return [...list]; } };
}

/** A row of colour swatches (radio). -> {el, get()} */
export function colorPicker(value, { label = 'Colour', none = false } = {}) {
  const name = uidOf('color');
  let cur = value || (none ? '' : COLORS[0].id);
  const opts = [...(none ? [{ id: '', label: 'None' }] : []), ...COLORS];
  const el = h('fieldset', { class: 'field jr-swatches' },
    h('legend', { class: 'field-label' }, label),
    h('div', { class: 'jr-swatch-row' }, opts.map((c) => h('label', { class: ['jr-swatch', !c.id && 'is-none'], title: c.label, style: c.id ? `--sw:${colorVar(c.id)}` : null },
      h('input', { type: 'radio', name, value: c.id, checked: c.id === cur, 'aria-label': c.label, onchange: () => { cur = c.id; } }),
      h('span', { class: 'jr-swatch-dot', 'aria-hidden': 'true' })))));
  return { el, get: () => cur || null };
}

/** The event symbols as a grid of toggles (radio; "None" first). -> {el, get()} */
export function symbolPicker(value) {
  const name = uidOf('sym');
  let cur = value || '';
  const el = h('fieldset', { class: 'field jr-symbols' },
    h('legend', { class: 'field-label' }, 'Symbol'),
    h('div', { class: 'jr-symbol-grid' },
      [{ id: '', label: 'No symbol', icon: null }, ...SYMBOLS].map((s) => h('label', { class: 'jr-symbol', title: s.label },
        h('input', { type: 'radio', name, value: s.id, checked: s.id === cur, 'aria-label': s.label, onchange: () => { cur = s.id; } }),
        h('span', { class: 'jr-symbol-face', 'aria-hidden': 'true' }, s.icon ? icon(s.icon) : h('span', { class: 'jr-symbol-none' }, '—'))))));
  return { el, get: () => cur || null };
}

/** A few lines of markdown with [[ link suggestions. -> {el, get()} */
export function textField(value, { label = 'Description', hint = 'A paragraph or two. [[Links]], **bold** and #tags work as in notes.', rows = 4 } = {}) {
  const ed = markdownEditor({ value: value || '', rows, placeholder: 'Write a few lines…' });
  ed.classList.add('jr-item-text');
  const el = h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), ed, hint ? h('span', { class: 'field-hint' }, hint) : null);
  return { el, get: () => ed.value.trim() };
}

/**
 * An item's dialog. fields: nodes; save() -> true to close (false keeps it open, e.g. a missing title);
 * remove: shows Delete (asks first). -> Promise<'saved' | 'removed' | null>
 */
export function itemDialog({ title, fields, save, remove = null, removeLabel = 'Delete', saveLabel = 'Save', wide = false }) {
  return new Promise((resolve) => {
    let result = null;
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const fail = (msg) => { err.textContent = msg; err.hidden = false; return false; };
    const actions = [];
    if (remove) actions.push({ label: removeLabel, kind: 'danger jr-item-remove', onClick: async () => { if ((await remove()) === false) return false; result = 'removed'; return true; } });
    actions.push({ label: 'Cancel', kind: 'ghost' });
    actions.push({ label: saveLabel, kind: 'primary', onClick: () => { err.hidden = true; const ok = save(fail); if (ok) result = 'saved'; return !!ok; } });
    const m = openModal({
      title, wide, className: 'jr-item-dialog',
      body: h('div', { class: 'stack jr-dialog jr-item-form' }, fields, err),
      actions,
      onClose: () => resolve(result),
    });
    // Enter in a one-line box saves (not in the description or the tag box, which use Enter themselves)
    m.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.classList.contains('jr-chip-input') || ['radio', 'checkbox'].includes(t.type)) return;
      e.preventDefault();
      m.el.querySelector('.modal-foot .btn-primary')?.click();
    });
  });
}

/** Is date b on or after date a? (a missing date is fine) */
export const notBefore = (a, b) => !a || !b || cmpDate(a, b) <= 0;

// ---------- hover card ----------

let card = null; // {el, anchor, pinned}
let hideTimer = 0;
let showTimer = 0;

function place(el, anchor) {
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const vw = innerWidth;
  const vh = innerHeight;
  let top = a.bottom + 8;
  if (top + r.height > vh - 8 && a.top - r.height - 8 > 8) top = a.top - r.height - 8;
  top = Math.max(8, Math.min(top, vh - r.height - 8));
  let left = a.left + a.width / 2 - r.width / 2;
  left = Math.max(8, Math.min(left, vw - r.width - 8));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

export function hideCard(force = true) {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  if (!card || (card.pinned && !force)) return;
  card.anchor?.classList.remove('is-carded');
  card.el.remove();
  card = null;
}
const hideSoon = (ms = 240) => { clearTimeout(hideTimer); hideTimer = setTimeout(() => hideCard(false), ms); };

/** Show the expanded view of an item next to `anchor`. build() -> content nodes. */
export function showCard(anchor, build, { pinned = false } = {}) {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  if (card && card.anchor === anchor && card.el.isConnected) {
    if (pinned && !card.pinned) { card.pinned = true; card.el.classList.add('is-pinned'); }
    return card.el;
  }
  hideCard(true);
  const el = h('div', { class: ['jr-bcard', pinned && 'is-pinned'], role: 'dialog', 'aria-label': anchor.getAttribute('aria-label') || 'Details' }, build());
  el.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && card && !card.pinned) hideSoon(); });
  el.addEventListener('click', (e) => { if (e.target.closest('a[href]')) hideCard(true); });
  overlays().append(el);
  place(el, anchor);
  anchor.classList.add('is-carded');
  card = { el, anchor, pinned };
  return el;
}

document.addEventListener('pointerdown', (e) => {
  if (!card) return;
  if (card.el.contains(e.target) || card.anchor.contains(e.target)) return;
  if (e.target.closest?.('.modal-backdrop, .jr-menu, .md-suggest')) return;
  hideCard(true);
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card && !document.querySelector('.modal-backdrop')) { e.stopPropagation(); hideCard(true); } }, true);
document.addEventListener('scroll', (e) => { if (card && !card.el.contains(e.target)) hideCard(true); }, true);
window.addEventListener('resize', () => hideCard(true));
window.addEventListener('hashchange', () => hideCard(true));

/**
 * Wire an item element: hover (mouse) or keyboard focus shows its card, a click or tap keeps it open (pinned),
 * a double click or Enter runs open() (the editor).
 */
export function hoverable(el, build, { open = null } = {}) {
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(showTimer);
    if (card && !card.pinned) showCard(el, build); // moving along the timeline: no delay between items
    else if (!card) showTimer = setTimeout(() => showCard(el, build), 160);
  });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { clearTimeout(showTimer); if (card?.anchor === el && !card.pinned) hideSoon(); } });
  el.addEventListener('click', () => showCard(el, build, { pinned: true }));
  if (open) el.addEventListener('dblclick', (e) => { e.preventDefault(); hideCard(true); open(); });
  el.addEventListener('focus', () => { if (el.matches(':focus-visible') && !isTouch()) showCard(el, build); });
  el.addEventListener('blur', () => { if (card?.anchor === el && !card.pinned) hideSoon(120); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && open) { e.preventDefault(); hideCard(true); open(); }
  });
}

/**
 * The content of a card. {glyph: icon name, color, kicker, title, when, text (markdown), tags, note, actions: [nodes]}
 */
export function cardBody({ glyph = null, color = null, kicker = null, title, when = null, text = '', tags = [], note = null, actions = [] }) {
  const prose = text ? h('div', { class: 'jr-bcard-text' }) : null;
  if (prose) {
    const render = () => renderInto(prose, text, { startNotes: note ? J.startsNotes(note) : false });
    if (note) J.withNote(note, render); else render();
  }
  const t = tagsOf(tags);
  return h('div', { class: 'jr-bcard-in', style: color ? `--item:${colorVar(color)}` : null },
    h('div', { class: 'jr-bcard-head' },
      glyph ? h('span', { class: 'jr-bcard-glyph' }, icon(glyph)) : color ? h('span', { class: 'jr-bcard-swatch', 'aria-hidden': 'true' }) : null,
      h('div', { class: 'jr-bcard-titles' },
        kicker ? h('span', { class: 'jr-bcard-kicker' }, kicker) : null,
        h('strong', { class: 'jr-bcard-title' }, title),
        when ? h('span', { class: 'jr-bcard-when' }, when) : null)),
    prose,
    t.length ? tagList(t, { className: 'jr-bcard-tags' }) : null,
    actions.length ? h('div', { class: 'jr-bcard-actions' }, actions) : null);
}

/** A small button for a card's action row. */
export const cardBtn = (label, ic, onClick) => h('button', {
  type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); hideCard(true); onClick(); },
}, ic ? icon(ic) : null, h('span', null, label));

/** Copy a [[Note#Item]] link to the clipboard. */
export async function copyItemLink(note, title) {
  const safe = (s) => String(s).replace(/[|\]#]/g, ' ').replace(/\s+/g, ' ').trim();
  const link = `[[${safe(note.title)}#${safe(title)}]]`;
  try {
    await navigator.clipboard.writeText(link);
    toast(`Copied ${link}. Paste it in any note to link here.`, { type: 'success' });
  } catch {
    toast(`Link: ${link}`, { timeout: 8000 });
  }
}
