// Compendium tab: SRD 5.2 + stubs + the party's shared library (content/library/<kind>/<id>.json).
// Routes: #/compendium (home), #/compendium/<kind> (reference table), #/compendium/<kind>/<id> (entry page).
import { h } from '../../core/dom.js';
import { icon, toast, confirmDialog, promptDialog, pickFromList } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate, href } from '../../core/router.js';
import { KINDS, removeCustom } from '../../core/compendium.js';
import { extractLinks, parseFrontmatter } from '../../core/markdown.js';
import { fmtDate, baseName, debounce, nameKey } from '../../core/util.js';
import { findEntry } from './linktypes.js'; // registers the [[weapon:…]] etc. link types at import
import * as M from './meta.js';
import { renderEntry } from './render.js';
import { openEntryEditor } from './editor.js';

const ROWS_PAGE = 150;
const tableState = new Map(); // kind -> {q, f:{}, sort, dir}
let root = null;
let page = null; // {key, el, refresh(), update?(route), destroy?()}
let stale = false;

const visible = () => !!root && root.isConnected && !root.closest('[hidden]');
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true }));
const words = (s) => String(s || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
const matchesWords = (e, ws) => { const s = M.searchText(e); return ws.every((w) => s.includes(w)); };

/** Mirror filter state into the URL (no navigation). Only while that page is the one on screen. */
function setQuery(base, params) {
  const cur = location.hash.split('?')[0].replace(/\/$/, '');
  if (cur !== base || !visible()) return;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const next = `${base}${qs ? `?${qs}` : ''}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** Name ranking for search results: prefix, then contains, then stat-only matches. */
function ranked(list, term) {
  const t = term.trim().toLowerCase();
  return list.map((e, i) => {
    const n = String(e.name).toLowerCase();
    return [n === t ? 0 : n.startsWith(t) ? 1 : n.includes(t) ? 2 : 3, i, e];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

const miniBadges = (e) => [
  e.origin === 'custom' ? h('span', { class: 'badge badge-accent cp-mini' }, 'Custom') : null,
  e.origin === 'custom' && e.path && store.isDirty(e.path) ? h('span', { class: 'badge badge-warn cp-mini', title: 'Not yet saved to the repository' }, 'Unsaved') : null,
  e.origin === 'stub' ? h('span', { class: 'badge cp-mini', title: 'Summary only' }, e.source || 'Stub') : null,
  e.legacy ? h('span', { class: 'badge cp-mini', title: 'Legacy (2014)' }, '2014') : null,
];

function crumbs(kind, e) {
  return h('nav', { class: 'cp-crumbs', 'aria-label': 'Breadcrumb' },
    h('a', { href: href('compendium') }, 'Compendium'),
    kind ? [h('span', { class: 'cp-crumb-sep', 'aria-hidden': 'true' }, '›'), e ? h('a', { href: href('compendium', kind) }, M.kindLabel(kind)) : h('span', { 'aria-current': 'page' }, M.kindLabel(kind))] : null,
    e ? [h('span', { class: 'cp-crumb-sep', 'aria-hidden': 'true' }, '›'), h('span', { 'aria-current': 'page' }, e.name)] : null);
}

async function newEntry(kind, prefill) {
  const saved = await openEntryEditor(kind, prefill || null);
  if (saved) navigate(M.entryHref(saved));
}

async function newAny(prefillName) {
  const k = await pickFromList({
    title: 'Add to the shared library',
    items: KINDS,
    search: (x) => `${x.label} ${x.one}`,
    render: (x) => h('div', { class: 'picker-item-main' },
      h('span', { class: 'picker-item-title' }, icon(M.kindIcon(x.kind), 16), ' ', x.one),
      h('span', { class: 'muted' }, M.kindBlurb(x.kind))),
  });
  if (k) newEntry(k.kind, prefillName ? { name: prefillName } : null);
}

// ---------- home ----------

function homePage(route) {
  const el = h('div', { class: 'cp-home' });
  const all = new Map();
  const q = h('input', { class: 'input', type: 'search', value: route.query.q || '', placeholder: 'Search every weapon, spell, item, feat, species…', 'aria-label': 'Search the compendium', autocomplete: 'off' });
  const results = h('div', { class: 'cp-results', 'aria-live': 'polite' });
  const cards = h('div', { class: 'grid cp-kinds' });
  const cardsSec = h('section', { class: 'view-section' }, h('h2', { class: 'sr-only' }, 'Sections'), cards);
  const recent = h('section', { class: 'view-section cp-recent' });
  el.append(
    h('header', { class: 'view-head' },
      h('h1', { class: 'view-title' }, 'Compendium'),
      h('div', { class: 'view-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newAny() }, icon('plus'), 'New custom entry')),
      h('p', { class: 'view-sub' }, 'SRD 5.2 rules, short summaries of other books, and the party’s shared library. Anything you add here is saved to the repository for everyone.')),
    h('label', { class: 'search cp-global' }, icon('search'), q),
    results, cardsSec, recent);

  const drawCards = () => cards.replaceChildren(...KINDS.map((k) => {
    const list = all.get(k.kind) || [];
    const custom = list.filter((e) => e.origin === 'custom').length;
    return h('a', { class: 'card cp-kind-card', href: href('compendium', k.kind) },
      h('span', { class: 'cp-kind-icon', 'aria-hidden': 'true' }, icon(M.kindIcon(k.kind), 24)),
      h('span', { class: 'cp-kind-text' },
        h('span', { class: 'card-title' }, k.label),
        h('span', { class: 'card-sub' }, M.kindBlurb(k.kind)),
        h('span', { class: 'cp-kind-count' }, `${list.length} ${list.length === 1 ? 'entry' : 'entries'}`, custom ? h('span', { class: 'cp-kind-custom' }, ` · ${custom} custom`) : null)));
  }));

  const drawRecent = () => {
    const mine = [...all.values()].flat().filter((e) => e.origin === 'custom')
      .sort((a, b) => cmp(b.updated || b.created || '', a.updated || a.created || '')).slice(0, 12);
    recent.replaceChildren(h('h2', null, 'Recently added by the party'),
      mine.length
        ? h('ul', { class: 'cp-recent-list', role: 'list' }, mine.map((e) => h('li', null,
          h('a', { class: 'cp-recent-item', href: M.entryHref(e) },
            h('span', { class: 'cp-recent-icon', 'aria-hidden': 'true' }, e.kind === 'location-type' ? M.locationSwatch(e, 28) : icon(M.kindIcon(e.kind), 18)),
            h('span', { class: 'cp-recent-main' },
              h('span', { class: 'cp-recent-name' }, e.name, ...miniBadges(e).slice(1, 2)),
              h('span', { class: 'cp-recent-meta' }, `${M.kindOne(e.kind)} · added by ${e.createdBy || 'a Warden'}${e.updated ? ` · ${fmtDate(e.updated)}` : ''}`))))))
        : h('div', { class: 'empty-state' },
          icon('sparkle'),
          h('h3', null, 'Nothing added yet'),
          h('p', null, 'Custom weapons, items, spells, feats and abilities you create are saved to the repository, so every Warden can use them.'),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => newAny() }, icon('plus'), 'New custom entry'))));
  };

  const drawResults = () => {
    const raw = q.value.trim();
    setQuery(href('compendium'), { q: raw });
    const ws = words(raw);
    results.hidden = !ws.length;
    cardsSec.hidden = !!ws.length;
    recent.hidden = !!ws.length;
    if (!ws.length) { results.replaceChildren(); return; }
    const groups = [];
    for (const k of KINDS) {
      const hits = (all.get(k.kind) || []).filter((e) => matchesWords(e, ws));
      if (hits.length) groups.push({ kind: k.kind, hits: ranked(hits, raw) });
    }
    groups.sort((a, b) => {
      const best = (g) => { const n = String(g.hits[0].name).toLowerCase(); return n === raw.toLowerCase() ? 0 : n.startsWith(raw.toLowerCase()) ? 1 : 2; };
      return best(a) - best(b);
    });
    results.replaceChildren(groups.length
      ? h('div', { class: 'cp-result-groups' }, groups.map((g) => h('section', { class: 'cp-result-group' },
        h('h2', { class: 'cp-result-title' }, icon(M.kindIcon(g.kind), 18), M.kindLabel(g.kind), h('span', { class: 'badge num' }, String(g.hits.length))),
        h('ul', { class: 'cp-result-list', role: 'list' }, g.hits.slice(0, 8).map((e) => h('li', null,
          h('a', { class: 'cp-result', href: M.entryHref(e) },
            h('span', { class: 'cp-result-name' }, e.name, ...miniBadges(e)),
            h('span', { class: 'cp-result-meta' }, M.statLine(e)))))),
        g.hits.length > 8 ? h('a', { class: 'cp-result-more', href: `${href('compendium', g.kind)}?q=${encodeURIComponent(raw)}` }, `See all ${g.hits.length} ${M.kindLabel(g.kind).toLowerCase()}`, icon('chevron-right', 16)) : null)))
      : h('div', { class: 'empty-state' },
        icon('search'),
        h('h3', null, 'Nothing found'),
        h('p', null, `No entry matches “${raw}”. Is it something of your own?`),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => newAny(raw) }, icon('plus'), `Create “${raw}”`))));
  };

  q.addEventListener('input', debounce(drawResults, 60));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = results.querySelector('a.cp-result'); if (first) { e.preventDefault(); navigate(first.getAttribute('href')); } }
  });

  const refresh = async () => {
    await M.rulesReady();
    const lists = await Promise.all(KINDS.map((k) => M.listEntries(k.kind).catch(() => [])));
    KINDS.forEach((k, i) => all.set(k.kind, lists[i]));
    drawCards(); drawRecent(); drawResults();
  };
  cards.append(h('p', { class: 'muted' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Opening the codex…'));
  refresh();
  queueMicrotask(() => { if (!matchMedia('(max-width: 759px)').matches) q.focus({ preventScroll: true }); });
  return {
    el, refresh,
    update(r) { const v = r.query.q || ''; if (v !== q.value.trim()) { q.value = v; drawResults(); } },
  };
}

// ---------- kind page (reference table) ----------

function defaultSort(kind) { return kind === 'spell' ? 'level' : 'name'; }

function kindPage(kind, route) {
  const cols = M.columnsFor(kind);
  const filters = M.filtersFor(kind);
  const st = tableState.get(kind) || { q: '', f: {}, sort: defaultSort(kind), dir: 'asc' };
  tableState.set(kind, st);
  const fromQuery = (query) => {
    if (!Object.keys(query || {}).length) return;
    st.q = query.q || '';
    st.f = Object.fromEntries(filters.map((f) => [f.key, query[f.key] || '']).filter(([, v]) => v));
    if (query.sort && cols.some((c) => c.key === query.sort)) st.sort = query.sort;
    st.dir = query.dir === 'desc' ? 'desc' : 'asc';
  };
  fromQuery(route.query);

  let list = [];
  let shown = [];
  let limit = ROWS_PAGE;
  let observer = null;
  const el = h('div', { class: 'cp-kind' });
  const q = h('input', { class: 'input', type: 'search', value: st.q, placeholder: `Filter ${M.kindLabel(kind).toLowerCase()}…`, 'aria-label': `Filter ${M.kindLabel(kind)}`, autocomplete: 'off' });
  const selects = filters.map((f) => {
    const s = h('select', { class: 'select cp-qf', 'aria-label': f.label, onchange: (e) => { st.f[f.key] = e.target.value; limit = ROWS_PAGE; run(); } });
    s.dataset.key = f.key;
    return s;
  });
  const count = h('span', { class: 'cp-count muted num' });
  const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { st.q = ''; st.f = {}; q.value = ''; fillSelects(); limit = ROWS_PAGE; run(); } }, icon('close', 16), 'Clear');
  const thead = h('thead');
  const tbody = h('tbody');
  const table = h('table', { class: ['table', 'table-sticky', 'cp-table', `cp-table-${kind}`] }, h('caption', { class: 'sr-only' }, M.kindLabel(kind)), thead, tbody);
  const empty = h('div', { class: 'empty-state', hidden: true });
  const custom = h('span', { class: 'muted cp-kind-note' });

  el.append(
    crumbs(kind),
    h('header', { class: 'view-head' },
      h('h1', { class: 'view-title' }, M.kindLabel(kind)),
      h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newEntry(kind) }, icon('plus'), `New custom ${M.kindOne(kind).toLowerCase()}`)),
      h('p', { class: 'view-sub' }, M.kindBlurb(kind), ' ', custom)),
    h('div', { class: 'toolbar cp-toolbar' }, h('label', { class: 'search' }, icon('search'), q), selects, clearBtn, h('span', { class: 'spacer' }), count),
    h('div', { class: 'table-wrap cp-table-wrap' }, table),
    empty);

  function fillSelects() {
    selects.forEach((s, i) => {
      const f = filters[i];
      const v = st.f[f.key] || '';
      s.replaceChildren(h('option', { value: '' }, `${f.label}: any`), ...f.options().map((o) => h('option', { value: String(o.value), selected: String(o.value) === v }, o.label)));
      s.value = v;
    });
  }
  function drawHead() {
    thead.replaceChildren(h('tr', null, cols.map((c) => {
      const on = st.sort === c.key;
      return h('th', { class: c.cls || null, scope: 'col', 'aria-sort': on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        c.label ? h('button', {
          type: 'button', class: ['cp-sort', on && 'is-active'], title: `Sort by ${c.label.toLowerCase()}`,
          onclick: () => { if (st.sort === c.key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = c.key; st.dir = 'asc'; } drawHead(); run(); },
        }, c.label, h('span', { class: 'cp-sort-mark', 'aria-hidden': 'true' }, on ? (st.dir === 'asc' ? '▲' : '▼') : '')) : h('span', { class: 'sr-only' }, 'Icon'));
    })));
  }
  function sorted(items) {
    const col = cols.find((c) => c.key === st.sort) || cols.find((c) => c.key === 'name') || cols[0];
    const dir = st.dir === 'desc' ? -1 : 1;
    return items.map((e) => { const v = col.sort(e); return [v instanceof Node ? '' : v, e]; })
      .sort((a, b) => dir * cmp(a[0], b[0]) || cmp(a[1].name, b[1].name)).map((x) => x[1]);
  }
  function run() {
    st.q = q.value.trim();
    setQuery(href('compendium', kind), { q: st.q, ...st.f, sort: st.sort !== defaultSort(kind) || st.dir !== 'asc' ? st.sort : '', dir: st.dir === 'desc' ? 'desc' : '' });
    const ws = words(st.q);
    let items = M.applyFilters(kind, list, st.f);
    if (ws.length) items = items.filter((e) => matchesWords(e, ws));
    shown = sorted(items);
    count.textContent = `${shown.length} of ${list.length}`;
    clearBtn.hidden = !st.q && !Object.values(st.f).some(Boolean);
    drawBody();
  }
  function rowOf(e) {
    return h('tr', {
      class: 'is-clickable',
      onclick: (ev) => { if (ev.target.closest('a, button')) return; navigate(M.entryHref(e)); },
    }, cols.map((c) => {
      if (c.key === 'name') {
        return h('td', { class: 'cell-name' }, h('a', { href: M.entryHref(e) }, e.name), ...miniBadges(e));
      }
      const v = c.get(e);
      return h('td', { class: c.cls || null }, v instanceof Node ? v : String(v ?? '—'));
    }));
  }
  function drawBody() {
    observer?.disconnect();
    const n = Math.min(limit, shown.length);
    tbody.replaceChildren(...shown.slice(0, n).map(rowOf));
    if (shown.length > n) {
      const more = h('tr', { class: 'cp-more-row' }, h('td', { colspan: cols.length },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { limit += ROWS_PAGE; drawBody(); } }, `Show ${Math.min(ROWS_PAGE, shown.length - n)} more of ${shown.length - n}`)));
      tbody.append(more);
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { limit += ROWS_PAGE; drawBody(); } }, { rootMargin: '400px' });
        observer.observe(more);
      }
    }
    table.parentElement.hidden = !shown.length;
    empty.hidden = !!shown.length;
    if (!shown.length) {
      const raw = st.q;
      empty.replaceChildren(icon('search'), h('h3', null, list.length ? 'Nothing matches these filters' : 'Nothing here yet'),
        h('p', null, list.length ? 'Try fewer filters, or add your own entry.' : `The party has not added any ${M.kindLabel(kind).toLowerCase()} yet.`),
        h('div', { class: 'row' },
          list.length ? h('button', { class: 'btn', type: 'button', onclick: () => clearBtn.click() }, 'Clear filters') : null,
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newEntry(kind, raw ? { name: raw } : null) }, icon('plus'), raw ? `Create “${raw}”` : `New custom ${M.kindOne(kind).toLowerCase()}`)));
    }
  }

  q.addEventListener('input', debounce(() => { limit = ROWS_PAGE; run(); }, 40));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); navigate(M.entryHref(shown[0])); } });

  const refresh = async () => {
    await M.rulesReady();
    list = await M.listEntries(kind);
    const n = list.filter((e) => e.origin === 'custom').length;
    const stubs = list.filter((e) => e.origin === 'stub').length;
    custom.textContent = [n ? `${n} added by the party.` : '', stubs ? `${stubs} are short summaries (stubs) of non-SRD books.` : ''].filter(Boolean).join(' ');
    fillSelects();
    drawHead();
    run();
  };
  tbody.append(h('tr', null, h('td', { colspan: cols.length, class: 'muted' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Loading…')));
  drawHead();
  refresh();
  return {
    el, refresh,
    update(r) {
      if (!Object.keys(r.query || {}).length) return;
      fromQuery(r.query);
      q.value = st.q;
      fillSelects(); drawHead(); run();
    },
    destroy() { observer?.disconnect(); },
  };
}

// ---------- entry page ----------

function charactersUsing(e) {
  const out = [];
  const inv = ['weapon', 'armor', 'gear', 'magic-item'].includes(e.kind);
  for (const { path, data: c } of store.list('content/characters')) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const where = [];
    if (inv) {
      const n = (c.inventory || []).filter((it) => it && it.ref === e.id && (!it.kind || it.kind === e.kind)).reduce((s, it) => s + (Number(it.qty) || 1), 0);
      if (n) where.push(n > 1 ? `Inventory × ${n}` : 'Inventory');
    }
    if (e.kind === 'ability' && (c.abilities || []).some((a) => a && (a.ref === `ability/${e.id}` || a.ref === e.id))) where.push('Abilities');
    if (e.kind === 'spell' && (c.spells || []).some((s) => s?.id === e.id)) where.push('Spells');
    if (e.kind === 'feat') {
      const picked = Object.values(c.choices || {}).some((v) => v === e.id || v?.feat === e.id || (Array.isArray(v) && v.includes(e.id)));
      if ((c.feats || []).some((f) => f?.id === e.id) || picked) where.push('Feat');
    }
    if (e.kind === 'species' && c.species?.id === e.id) where.push('Species');
    if (e.kind === 'background' && c.background?.id === e.id) where.push('Background');
    if (e.kind === 'class') { const k = (c.classes || []).find((x) => x?.id === e.id); if (k) where.push(`Level ${k.level || 1}`); }
    if (e.kind === 'subclass' && (c.classes || []).some((x) => x?.subclass === e.id)) where.push('Subclass');
    if (e.kind === 'weapon' && !where.length && Object.values(c.choices || {}).some((v) => Array.isArray(v) && v.includes(e.id))) where.push('Weapon mastery');
    if (where.length) out.push({ id: c.id || baseName(path).replace(/\.json$/i, ''), name: c.name || 'Unnamed hero', player: c.player, where });
  }
  return out.sort((a, b) => cmp(a.name, b.name));
}

function locationsUsingType(e) {
  return store.list('content/locations').map(({ path, data }) => ({ id: baseName(path).replace(/\.json$/i, ''), data }))
    .filter((x) => x.data && String(x.data.type || '') === e.id)
    .map((x) => ({ id: x.id, name: x.data.name || 'Unnamed place' }));
}

/** Journal notes and map locations whose text links to this entry. */
function mentionsOf(e) {
  const prefix = M.linkPrefix(e.kind);
  if (!prefix) return [];
  const hit = (l) => l.prefix === prefix && findEntry(e.kind, l.target)?.id === e.id;
  const out = [];
  for (const { path, data } of store.list('content/journal', { recursive: true })) {
    if (!path.endsWith('.md') || typeof data !== 'string' || !data.includes('[[')) continue;
    if (!extractLinks(data).some(hit)) continue;
    const rel = path.slice('content/journal/'.length).replace(/\.md$/i, '');
    const parts = rel.split('/');
    const chapter = parts.length > 1 ? parts[0] : '_';
    const slug = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    const { data: fm, body } = parseFrontmatter(data);
    const title = String(fm.title || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || M.prettify(slug));
    out.push({ title, href: href('journal', chapter, slug), context: 'Journal' });
  }
  for (const { path, data } of store.list('content/locations')) {
    const d = data?.description;
    if (typeof d !== 'string' || !d.includes('[[') || !extractLinks(d).some(hit)) continue;
    out.push({ title: data.name || 'Unnamed place', href: href('map', 'loc', baseName(path).replace(/\.json$/i, '')), context: 'Map' });
  }
  return out.sort((a, b) => cmp(a.context, b.context) || cmp(a.title, b.title));
}

async function copyLink(e) {
  const text = M.linkText(e);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text} — paste it into any note or description.`, { type: 'success' });
  } catch {
    await promptDialog('Copy this link', { label: 'Select and copy:', value: text, okLabel: 'Done' });
  }
}

function entryPage(kind, id) {
  const el = h('div', { class: 'cp-page' });
  el.append(crumbs(kind), h('p', { class: 'muted' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Loading…'));
  let current = null;

  async function edit(e) {
    const saved = await openEntryEditor(kind, e);
    if (saved && saved.id !== e.id) navigate(M.entryHref(saved));
    else if (saved) refresh();
  }
  async function del(e) {
    const users = charactersUsing(e);
    const restoring = e.kind === 'location-type' && e.overrides;
    const pins = e.kind === 'location-type' ? locationsUsingType(e).length : 0;
    const warn = users.length ? ` ${users.length} character${users.length === 1 ? '' : 's'} still use${users.length === 1 ? 's' : ''} it.` : pins && !restoring ? ` ${pins} map location${pins === 1 ? '' : 's'} use it.` : '';
    const ok = await confirmDialog(restoring ? `Restore the original look of “${e.name}”?` : `Delete “${e.name}” from the shared library?${warn}`, {
      title: restoring ? 'Restore default' : 'Delete entry', okLabel: restoring ? 'Restore' : 'Delete', danger: !restoring,
    });
    if (!ok) return;
    removeCustom(kind, e.id);
    toast(restoring ? 'Built-in type restored — Save to publish' : `Deleted “${e.name}” — Save to publish`);
    if (restoring) refresh(); else navigate(href('compendium', kind));
  }

  function actions(e) {
    const prefix = M.linkPrefix(kind);
    const btn = (label, ico, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, icon(ico), label);
    return h('div', { class: 'cp-actions row' },
      e.origin === 'custom' ? btn('Edit', 'edit', () => edit(e), 'btn btn-primary') : null,
      e.origin === 'srd' || e.origin === 'stub' ? btn('Copy as custom', 'copy', () => edit(e), 'btn btn-primary') : null,
      e.origin === 'builtin' ? btn('Edit type', 'edit', () => edit(e), 'btn btn-primary') : null,
      prefix ? btn('Copy link', 'link', () => copyLink(e)) : null,
      e.origin === 'custom' ? btn(e.overrides ? 'Restore default' : 'Delete', e.overrides ? 'undo' : 'trash', () => del(e), 'btn btn-danger') : null,
      prefix ? h('code', { class: 'cp-linktext', title: 'Link to this entry from any note' }, M.linkText(e)) : null);
  }

  function sidePanels(e) {
    const panels = [];
    if (kind === 'location-type') {
      const locs = locationsUsingType(e);
      panels.push(h('section', { class: 'panel cp-side-panel' },
        h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'On the map'), h('span', { class: 'badge num' }, String(locs.length))),
        h('div', { class: 'panel-body' }, locs.length
          ? h('ul', { class: 'cp-side-list', role: 'list' }, locs.slice(0, 40).map((l) => h('li', null, h('a', { href: href('map', 'loc', l.id) }, icon('pin', 16), l.name))))
          : h('p', { class: 'muted' }, 'No location uses this type yet.'))));
    } else {
      const users = charactersUsing(e);
      panels.push(h('section', { class: 'panel cp-side-panel' },
        h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Used by'), h('span', { class: 'badge num' }, String(users.length))),
        h('div', { class: 'panel-body' }, users.length
          ? h('ul', { class: 'cp-side-list', role: 'list' }, users.map((u) => h('li', null,
            h('a', { href: href('characters', u.id) }, icon('user', 16), u.name),
            h('span', { class: 'muted' }, ` ${u.where.join(', ')}${u.player ? ` · ${u.player}` : ''}`))))
          : h('p', { class: 'muted' }, 'No character uses this yet.'))));
      const refs = mentionsOf(e);
      if (refs.length) {
        panels.push(h('section', { class: 'panel cp-side-panel' },
          h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Mentioned in'), h('span', { class: 'badge num' }, String(refs.length))),
          h('div', { class: 'panel-body' }, h('ul', { class: 'cp-side-list', role: 'list' }, refs.slice(0, 30).map((r) => h('li', null,
            h('a', { href: r.href }, icon(r.context === 'Map' ? 'map' : 'journal', 16), r.title)))))));
      }
    }
    const rows = [
      ['Source', e.origin === 'srd' ? 'System Reference Document 5.2 (CC-BY-4.0)' : e.origin === 'stub' ? `${e.source || 'Non-SRD book'} — summary in our own words` : e.origin === 'builtin' ? 'Built-in map type' : 'The party’s shared library'],
      e.origin === 'custom' ? ['Added by', e.createdBy || '—'] : null,
      e.origin === 'custom' && e.updated ? ['Updated', fmtDate(e.updated)] : null,
      e.origin === 'custom' && e.path ? ['File', h('code', null, e.path.replace(/^content\//, ''))] : null,
      e.origin === 'custom' && e.path ? ['Status', store.isDirty(e.path) ? h('span', { class: 'badge badge-warn' }, 'Unsaved — press Save to publish') : 'In the repository'] : null,
      ['Id', h('code', null, e.id)],
    ].filter(Boolean);
    panels.push(h('section', { class: 'panel cp-side-panel' },
      h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Details')),
      h('dl', { class: 'panel-body cp-details' }, rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))))));
    return panels;
  }

  async function refresh() {
    await M.rulesReady();
    const list = await M.listEntries(kind);
    const e = list.find((x) => x.id === id) || (kind !== 'location-type' ? findEntry(kind, id) : list.find((x) => nameKey(x.name) === nameKey(id)));
    current = e;
    if (!e) {
      el.replaceChildren(crumbs(kind), h('div', { class: 'empty-state' },
        icon('warning'), h('h3', null, 'Not in the compendium'),
        h('p', null, `There is no ${M.kindOne(kind).toLowerCase()} “${id}”. It may have been deleted or renamed.`),
        h('div', { class: 'row' },
          h('a', { class: 'btn', href: href('compendium', kind) }, `All ${M.kindLabel(kind).toLowerCase()}`),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newEntry(kind, { name: id }) }, icon('plus'), `Create “${id}”`))));
      return;
    }
    if (page?.el === el && visible()) document.title = `${e.name} · Compendium · The Stone Wardens`;
    el.replaceChildren(
      crumbs(kind, e),
      actions(e),
      h('div', { class: 'cp-page-grid' },
        h('div', { class: 'cp-page-main' }, renderEntry(e)),
        h('aside', { class: 'cp-page-side' }, sidePanels(e))));
  }
  refresh();
  return { el, refresh, get entry() { return current; } };
}

function unknownPage(part) {
  const el = h('div', { class: 'cp-page' }, crumbs(null), h('div', { class: 'empty-state' },
    icon('warning'), h('h3', null, 'Unknown section'), h('p', null, `The compendium has no “${part}” section.`),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: href('compendium') }, 'Back to the compendium'))));
  return { el, refresh() {} };
}

// ---------- view ----------

function show(route) {
  const [part, idPart] = route.parts;
  const kind = part ? (M.isKind(part) ? part : M.kindForPrefix(part)) : null;
  const key = !part ? 'home' : !kind ? `unknown:${part}` : idPart ? `entry:${kind}:${idPart}` : `kind:${kind}`;
  if (page && page.key === key) {
    page.update?.(route);
    if (stale) { stale = false; page.refresh(); }
    return;
  }
  page?.destroy?.();
  page = !part ? homePage(route) : !kind ? unknownPage(part) : idPart ? entryPage(kind, idPart) : kindPage(kind, route);
  page.key = key;
  stale = false;
  root.replaceChildren(page.el);
  root.parentElement?.scrollTo?.(0, 0);
}

const refreshSoon = debounce(() => {
  if (!page) return;
  if (!visible()) { stale = true; return; }
  page.refresh();
}, 80);

export default {
  id: 'compendium',
  title: 'Compendium',
  icon: 'compendium',
  mount(el) {
    root = h('div', { class: 'cp-root' });
    el.append(root);
    store.on((ev) => {
      const paths = ev.path ? [ev.path] : ev.paths || [];
      if (ev.type === 'load' || ev.type === 'saved' || paths.some((p) => /^content\/(library|characters|journal|locations)\//.test(p))) refreshSoon();
    });
  },
  show,
  hide() {},
};
