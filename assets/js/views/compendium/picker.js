// openPicker(kinds, {title, filter, multi}) -> Promise<entry|entry[]|null>
// Modal chooser: kind tabs, search, quick filters, compact rows with key stats, a live preview (renderEntry)
// and "+ Create custom…" which chains into openEntryEditor and returns the new entry.
import { h } from '../../core/dom.js';
import { openModal, icon, select } from '../../core/ui.js';
import { preloadAll } from '../../core/compendium.js';
import {
  rulesReady, listEntries, filtersFor, applyFilters, searchText, statLine, kindLabel, kindOne, isKind,
} from './meta.js';
import { renderEntry } from './render.js';
import { openEntryEditor } from './editor.js';

const PAGE = 120;
const keyOf = (e) => `${e.kind}:${e.id}`;
const narrow = () => matchMedia('(max-width: 759px)').matches;

/**
 * openPicker(kinds, opts)
 *   kinds: 'weapon' | ['weapon', 'armor', 'gear', 'magic-item'] …
 *   opts.title     modal title
 *   opts.filter    (entry) => bool, applied to every kind; or an object of initial quick-filter values ({level:'0'})
 *   opts.multi     return an array (checkboxes + "Add N")
 *   opts.selected  (multi) ids or entries to pre-select
 *   opts.query     initial search text;  opts.kind  initial tab;  opts.allowCreate (default true)
 *   opts.widen     {label, filter?, on?, hint?}: adds a "Show all…" checkbox; while ticked the list uses widen.filter
 *                  (default: every entry) instead of opts.filter
 *   opts.mark      (entry) => null | string | {label, title, tone?} | [...]: small badges on a row (e.g. "off-list",
 *                  "Proficient"); tone 'ok' | 'warn' (default) | 'info' | 'muted'
 * Resolves the chosen entry (merged compendium entry, with kind/origin), an array when multi, or null.
 */
export async function openPicker(kinds, { title, filter, multi = false, selected = [], query = '', kind: startKind, allowCreate = true, confirmLabel, widen = null, mark = null } = {}) {
  const kindList = [].concat(kinds || []).filter(isKind);
  if (!kindList.length) throw new Error('openPicker: no valid kinds');
  const pred = typeof filter === 'function' ? filter : null;
  const preset = filter && typeof filter === 'object' ? filter : {};

  return new Promise((resolve) => {
    let result = null;
    const raw = new Map(); // kind -> every entry
    const lists = new Map(); // kind -> entries (after pred, or widen.filter while widened)
    let widened = !!widen?.on;
    const refilter = () => {
      const f = widened ? (typeof widen?.filter === 'function' ? widen.filter : null) : pred;
      for (const [k, l] of raw) lists.set(k, f ? l.filter(f) : l);
    };
    const fvals = new Map(kindList.map((k) => [k, { ...preset }]));
    const chosen = new Map(); // key -> entry (multi)
    let active = kindList.includes(startKind) ? startKind : kindList[0];
    let shown = [];
    let cursor = 0; // index into shown
    let limit = PAGE;

    // ----- elements -----
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Search by name or stats…', value: query, autofocus: true, 'aria-label': 'Search', 'aria-controls': 'cp-pick-list' });
    const tabs = kindList.length > 1 ? h('div', { class: 'tabs cp-pick-tabs', role: 'tablist' }) : null;
    const filtersBox = h('div', { class: 'cp-pick-filters' });
    const count = h('span', { class: 'cp-pick-count muted' });
    const listEl = h('ul', { class: 'picker-list cp-pick-list', id: 'cp-pick-list', role: 'listbox', 'aria-multiselectable': multi ? 'true' : null, tabindex: -1 });
    const preview = h('div', { class: 'cp-pick-preview', 'aria-live': 'polite' });
    const widenBox = widen ? h('label', { class: 'checkbox cp-pick-widen', title: widen.hint || null },
      h('input', { type: 'checkbox', checked: widened, onchange: (e) => { widened = e.target.checked; refilter(); cursor = 0; drawTabs(); run(); } }),
      h('span', null, widen.label || 'Show all')) : null;
    const body = h('div', { class: 'cp-picker' },
      tabs,
      h('div', { class: 'cp-pick-bar' }, h('label', { class: 'search cp-pick-search' }, icon('search'), q), filtersBox, widenBox, count),
      h('div', { class: 'cp-pick-main' }, listEl, preview));

    const actions = [];
    if (allowCreate) actions.push({ label: h('span', { class: 'cp-create-label' }, icon('plus'), ` Create custom ${kindOne(active).toLowerCase()}…`), kind: 'ghost', onClick: () => { createCustom(); return false; } });
    actions.push({ label: 'Cancel', kind: 'ghost' });
    actions.push({ label: confirmLabel || (multi ? 'Add' : 'Choose'), kind: 'primary', onClick: () => confirmPick() });

    const m = openModal({ title: title || (kindList.length === 1 ? `Choose ${kindOne(active).toLowerCase()}` : 'Choose from the compendium'), body, actions, wide: true, className: 'cp-picker-modal', onClose: () => resolve(result) });
    const foot = m.el.querySelector('.modal-foot');
    const createBtn = allowCreate ? foot?.querySelector('.btn') : null;
    createBtn?.classList.add('cp-pick-create');
    const okBtn = foot?.querySelector('.btn-primary');
    listEl.append(h('li', { class: 'picker-empty' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Loading…'));

    // ----- data -----
    Promise.all([rulesReady(), preloadAll().catch(() => null), ...kindList.map((k) => listEntries(k).then((l) => raw.set(k, l)))])
      .then(() => {
        refilter();
        for (const s of [].concat(selected || [])) {
          const id = typeof s === 'string' ? s : s?.id;
          for (const k of kindList) { const e = lists.get(k).find((x) => x.id === id && (typeof s === 'string' || !s.kind || s.kind === k)); if (e) { chosen.set(keyOf(e), e); break; } }
        }
        drawTabs(); drawFilters(); run();
      })
      .catch((e) => { console.error(e); listEl.replaceChildren(h('li', { class: 'picker-empty' }, `Could not load the compendium: ${e.message}`)); });

    // ----- drawing -----
    function drawTabs() {
      if (!tabs) return;
      tabs.replaceChildren(...kindList.map((k) => h('button', {
        type: 'button', role: 'tab', class: ['tab', k === active && 'is-active'], 'aria-selected': String(k === active),
        onclick: () => { if (k === active) return; active = k; cursor = 0; drawTabs(); drawFilters(); run(); updateCreate(); q.focus(); },
      }, kindLabel(k), h('span', { class: 'badge num' }, String(lists.get(k)?.length ?? '…')))));
    }
    function drawFilters() {
      const vals = fvals.get(active);
      filtersBox.replaceChildren(...filtersFor(active).map((f) => select(
        [{ value: '', label: `${f.label}: any` }, ...f.options().map((o) => ({ value: String(o.value), label: o.label }))],
        vals[f.key] ?? '',
        (v) => { vals[f.key] = v; cursor = 0; run(); },
        { class: 'select cp-qf', 'aria-label': f.label })));
    }
    function updateCreate() {
      const lab = createBtn?.querySelector('.cp-create-label');
      if (lab) lab.replaceChildren(icon('plus'), ` Create custom ${kindOne(active).toLowerCase()}…`);
    }
    function run() {
      const all = lists.get(active) || [];
      const term = q.value.trim().toLowerCase();
      const words = term.split(/\s+/).filter(Boolean);
      let items = applyFilters(active, all, fvals.get(active));
      if (words.length) {
        items = items.filter((e) => { const s = searchText(e); return words.every((w) => s.includes(w)); });
        // Name matches first: prefix, then contains, then stat matches.
        const rank = (e) => { const n = String(e.name).toLowerCase(); return n.startsWith(term) ? 0 : n.includes(term) ? 1 : 2; };
        items = items.map((e, i) => [rank(e), i, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
      }
      shown = items;
      cursor = Math.min(cursor, Math.max(0, shown.length - 1));
      limit = Math.max(PAGE, cursor + 1);
      count.textContent = `${shown.length} of ${all.length}`;
      drawList();
      drawPreview();
      updateOk();
    }
    let observer = null;
    function drawList() {
      observer?.disconnect();
      if (!shown.length) {
        listEl.replaceChildren(h('li', { class: 'picker-empty' },
          h('p', null, 'Nothing matches.'),
          allowCreate ? h('button', { type: 'button', class: 'btn btn-sm', onclick: createCustom }, icon('plus'), `Create “${q.value.trim() || `new ${kindOne(active).toLowerCase()}`}”`) : null));
        return;
      }
      listEl.replaceChildren(...shown.slice(0, limit).map(row));
      if (shown.length > limit) {
        const more = h('li', { class: 'picker-empty cp-pick-more' }, h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: showMore }, `Show ${Math.min(PAGE, shown.length - limit)} more`));
        listEl.append(more);
        if ('IntersectionObserver' in window) {
          observer = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) showMore(); }, { root: listEl, rootMargin: '200px' });
          observer.observe(more);
        }
      }
    }
    function showMore() { limit += PAGE; drawList(); }
    function row(e, i) {
      const isChosen = chosen.has(keyOf(e));
      let mk = null;
      if (typeof mark === 'function') { try { mk = mark(e); } catch { mk = null; } }
      const marks = [].concat(mk || []).map((x) => (typeof x === 'string' ? { label: x } : x)).filter((x) => x?.label);
      const TONE = { ok: 'badge-ok', warn: 'badge-warn', info: 'badge-info', muted: '' };
      return h('li', {
        class: ['picker-item', 'cp-pick-row', i === cursor && 'is-active', isChosen && 'is-selected'],
        role: 'option', 'aria-selected': String(multi ? isChosen : i === cursor), 'data-i': i,
        onclick: () => onRow(i),
        ondblclick: () => { if (!multi) pick(e); },
      },
      multi ? h('span', { class: 'picker-check', 'aria-hidden': 'true' }, isChosen ? '✓' : '') : null,
      h('div', { class: 'picker-item-main' },
        h('span', { class: 'picker-item-title' }, e.name,
          e.origin === 'custom' ? h('span', { class: 'badge badge-accent cp-mini' }, 'Custom') : null,
          e.origin === 'stub' ? h('span', { class: 'badge cp-mini', title: e.source || '' }, e.source || 'Stub') : null,
          e.legacy ? h('span', { class: 'badge cp-mini' }, '2014') : null,
          marks.map((x) => h('span', { class: ['badge', TONE[x.tone] ?? 'badge-warn', 'cp-mini'], title: x.title || null }, x.label))),
        h('span', { class: 'muted' }, statLine(e))));
    }
    function setCursor(i, scroll = true) {
      if (!shown.length) return;
      cursor = Math.max(0, Math.min(i, shown.length - 1));
      if (cursor >= limit) { limit = cursor + PAGE; drawList(); }
      listEl.querySelectorAll('.cp-pick-row').forEach((li) => {
        const on = Number(li.dataset.i) === cursor;
        li.classList.toggle('is-active', on);
        if (!multi) li.setAttribute('aria-selected', String(on));
      });
      if (scroll) listEl.querySelector('.cp-pick-row.is-active')?.scrollIntoView({ block: 'nearest' });
      drawPreview();
      updateOk();
    }
    function onRow(i) {
      const e = shown[i];
      if (!e) return;
      if (multi) { toggle(e); setCursor(i, false); return; }
      if (narrow() || i === cursor) { if (narrow()) pick(e); else setCursor(i, false); return; }
      setCursor(i, false);
    }
    function toggle(e) {
      const k = keyOf(e);
      if (chosen.has(k)) chosen.delete(k); else chosen.set(k, e);
      const li = listEl.querySelector(`.cp-pick-row[data-i="${shown.indexOf(e)}"]`);
      if (li) {
        li.classList.toggle('is-selected', chosen.has(k));
        li.setAttribute('aria-selected', String(chosen.has(k)));
        const c = li.querySelector('.picker-check');
        if (c) c.textContent = chosen.has(k) ? '✓' : '';
      }
      updateOk();
    }
    let lastPreview = null;
    function drawPreview() {
      const e = shown[cursor] || null;
      if (e === lastPreview && preview.firstChild) return;
      lastPreview = e;
      preview.replaceChildren(e ? renderEntry(e, { compact: true }) : h('p', { class: 'muted cp-pick-noprev' }, 'Select an entry to preview it.'));
      preview.scrollTop = 0;
    }
    function updateOk() {
      if (!okBtn) return;
      if (multi) {
        okBtn.textContent = confirmLabel || (chosen.size ? `Add ${chosen.size}` : 'Add');
        okBtn.disabled = !chosen.size;
      } else {
        const e = shown[cursor];
        okBtn.textContent = confirmLabel || (e ? `Choose ${e.name.length > 28 ? `${e.name.slice(0, 27)}…` : e.name}` : 'Choose');
        okBtn.disabled = !e;
      }
    }

    // ----- results -----
    function pick(e) { result = e; m.close(); }
    function confirmPick() {
      if (multi) { if (!chosen.size) return false; result = [...chosen.values()]; return true; }
      const e = shown[cursor];
      if (!e) return false;
      result = e;
      return true;
    }
    async function createCustom() {
      const name = q.value.trim();
      const saved = await openEntryEditor(active, name ? { name } : null);
      if (!saved) { q.focus(); return; }
      result = multi ? [...chosen.values(), saved] : saved;
      m.close();
    }

    // ----- keyboard -----
    q.addEventListener('input', () => { cursor = 0; run(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(cursor + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(cursor - 1); }
      else if (e.key === 'PageDown') { e.preventDefault(); setCursor(cursor + 10); }
      else if (e.key === 'PageUp') { e.preventDefault(); setCursor(cursor - 10); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const cur = shown[cursor];
        if (multi && (e.ctrlKey || e.metaKey)) { if (confirmPick()) m.close(); }
        else if (multi && cur) toggle(cur);
        else if (cur) pick(cur);
      }
    });
    updateOk();
  });
}
