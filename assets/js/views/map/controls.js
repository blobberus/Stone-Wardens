// Floating map controls: search box, the filter (ranks + location types), the "⋯" map menu, the map
// breadcrumb, and a tiny popover helper (also used by the map collection, collection.js).
import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { baseName } from '../../core/util.js';
import { swatch } from './pins.js';
import { RANKS } from './ranks.js';

// ---------- popovers ----------

const openPops = new Set();

/** Close every open popover. Returns true if one was open. */
export function closePopovers() {
  let any = false;
  for (const p of [...openPops]) { p.close(); any = true; }
  return any;
}

export function popover(button, render, { className = '', role = 'dialog', label = '' } = {}) {
  let panel = null;
  const outside = (e) => { if (panel && !panel.contains(e.target) && !button.contains(e.target)) api.close(); };
  const api = {
    get isOpen() { return !!panel; },
    open() {
      closePopovers();
      panel = h('div', { class: ['map-pop', className], role, 'aria-label': label || null });
      render(panel, api);
      button.parentElement.append(panel);
      button.setAttribute('aria-expanded', 'true');
      openPops.add(api);
      document.addEventListener('pointerdown', outside, true);
      panel.querySelector('button:not([disabled]), input, a[href]')?.focus({ preventScroll: true });
    },
    close({ focus = false } = {}) {
      if (!panel) return;
      panel.remove();
      panel = null;
      button.setAttribute('aria-expanded', 'false');
      openPops.delete(api);
      document.removeEventListener('pointerdown', outside, true);
      if (focus) button.focus();
    },
    toggle() { if (panel) api.close(); else api.open(); },
    refresh() {
      if (!panel) return;
      const scroll = panel.querySelector('.map-pop-scroll')?.scrollTop || 0;
      const key = panel.contains(document.activeElement) ? document.activeElement.dataset.key : null;
      clear(panel);
      render(panel, api);
      const sc = panel.querySelector('.map-pop-scroll');
      if (sc) sc.scrollTop = scroll;
      if (key) panel.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    },
  };
  button.setAttribute('aria-haspopup', role === 'menu' ? 'menu' : 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => api.toggle());
  return api;
}

// ---------- search ----------

/** Rank locations for a query. "#tag" terms must match a tag; other words match name/type/tags/description. */
export function searchLocations(list, query, typeOf) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const tagTerms = terms.filter((t) => t.startsWith('#') && t.length > 1).map((t) => t.slice(1));
  const words = terms.filter((t) => !t.startsWith('#'));
  const phrase = words.join(' ');
  const scored = [];
  for (const loc of list) {
    const tags = loc.tags.map((t) => t.toLowerCase());
    if (!tagTerms.every((t) => tags.some((x) => x.startsWith(t)))) continue;
    let score = 0;
    if (words.length) {
      const name = loc.name.toLowerCase();
      const tname = typeOf(loc.type).name.toLowerCase();
      const head = `${name} ${tname} ${tags.join(' ')}`;
      if (!words.every((w) => head.includes(w) || loc.description.toLowerCase().includes(w))) continue;
      if (name.startsWith(phrase)) score = 0;
      else if (name.includes(` ${phrase}`)) score = 1;
      else if (name.includes(phrase)) score = 2;
      else if (words.every((w) => name.includes(w))) score = 3;
      else if (words.every((w) => head.includes(w))) score = 4;
      else score = 5;
    }
    scored.push([score, loc]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, undefined, { sensitivity: 'base', numeric: true }));
  return scored.map((s) => s[1]);
}

/** ctx: {locations(), typeOf(id), mapId(), mapName(id), onFilter(Set|null), onPick(id)} — searches every map, this one first. */
export function createSearch(ctx) {
  const inp = h('input', {
    type: 'search', class: 'map-search-input', placeholder: 'Search places…', autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-label': 'Search locations (press / to focus)', 'aria-expanded': 'false', 'aria-controls': 'map-search-results', 'aria-autocomplete': 'list',
  });
  const list = h('ul', { class: 'map-search-results', id: 'map-search-results', role: 'listbox', 'aria-label': 'Matching locations', hidden: true });
  const clearBtn = h('button', { type: 'button', class: 'map-search-clear', 'aria-label': 'Clear search', title: 'Clear search', hidden: true, onclick: () => { set(''); inp.focus(); } }, icon('close'));
  const count = h('span', { class: 'map-search-count', 'aria-live': 'polite', hidden: true });
  const el = h('div', { class: 'map-search', role: 'search' },
    h('span', { class: 'map-search-icon', 'aria-hidden': 'true' }, icon('search')), inp, count, clearBtn, list);
  let results = [];
  let total = 0;
  let active = 0;

  function run() {
    const q = inp.value.trim();
    clearBtn.hidden = !q;
    if (!q) {
      results = [];
      total = 0;
      count.hidden = true;
      ctx.onFilter(null);
    } else {
      const here = ctx.mapId();
      const all = searchLocations(ctx.locations(), q, ctx.typeOf);
      const mine = all.filter((l) => l.map === here);
      const ordered = [...mine, ...all.filter((l) => l.map !== here)];
      total = ordered.length;
      results = ordered.slice(0, 40);
      count.hidden = false;
      count.textContent = String(mine.length);
      count.title = `${mine.length} matching place${mine.length === 1 ? '' : 's'} on this map${total > mine.length ? `, ${total - mine.length} on other maps` : ''}`;
      ctx.onFilter(new Set(mine.map((l) => l.id)));
    }
    active = 0;
    draw();
  }

  function draw() {
    const open = document.activeElement === inp && !!inp.value.trim();
    clear(list);
    list.hidden = !open;
    inp.setAttribute('aria-expanded', String(open));
    inp.removeAttribute('aria-activedescendant');
    if (!open) return;
    if (!results.length) { list.append(h('li', { class: 'map-sr-empty' }, 'No places match.')); return; }
    const here = ctx.mapId();
    results.forEach((loc, i) => {
      const t = ctx.typeOf(loc.type);
      const elsewhere = loc.map !== here;
      if (elsewhere && (i === 0 || results[i - 1].map === here)) list.append(h('li', { class: 'map-sr-group', role: 'presentation' }, 'On other maps'));
      list.append(h('li', {
        id: `map-sr-${i}`, role: 'option', 'aria-selected': String(i === active), class: ['map-sr', i === active && 'is-active'],
        onmousedown: (e) => { e.preventDefault(); pick(loc); },
      }, swatch(t), h('span', { class: 'map-sr-name' }, loc.name), h('span', { class: 'map-sr-type' }, elsewhere ? ctx.mapName(loc.map) : t.name)));
    });
    if (total > results.length) list.append(h('li', { class: 'map-sr-more' }, `+${total - results.length} more — keep typing to narrow`));
    inp.setAttribute('aria-activedescendant', `map-sr-${active}`);
  }

  function pick(loc) {
    inp.blur();
    draw();
    ctx.onPick(loc.id);
  }

  function set(q) {
    inp.value = q;
    run();
  }

  inp.addEventListener('input', run);
  inp.addEventListener('focus', draw);
  inp.addEventListener('blur', () => setTimeout(draw, 120));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) { active = (active + 1) % results.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && results.length) { active = (active - 1 + results.length) % results.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) pick(results[active]); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (inp.value) set(''); else inp.blur();
    }
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  });

  return {
    el,
    set,
    get query() { return inp.value.trim(); },
    focus() { inp.focus(); inp.select(); },
    refresh() { if (inp.value.trim()) run(); },
  };
}

// ---------- filter: ranks + location types ----------

const pips = (rank) => h('span', { class: 'map-rank-pips', 'aria-hidden': 'true' }, [1, 2, 3, 4].map((i) => h('i', { class: i >= rank ? 'on' : null })));

/**
 * ctx: {types(), typeOf(id), counts() -> Map(typeId -> n), hidden() -> Set, toggleType(id), soloType(id),
 *       showAll(), hideAll(), newType(), editType(type),
 *       rankCounts() -> Map(rank -> n), hiddenRanks() -> Set, toggleRank(r), soloRank(r), showAllRanks(),
 *       allZoom() -> bool, setAllZoom(bool), rankWhere(r) -> 'now'|'in'|'out', editing() -> bool, resetAll()}
 */
export function createLegend(ctx) {
  const badge = h('span', { class: 'map-tool-badge', hidden: true });
  const button = h('button', { class: 'btn map-tool-btn', type: 'button', title: 'Filter places by rank or type', 'aria-label': 'Filter places' },
    icon('filter'), h('span', { class: 'map-tool-label' }, 'Filter'), badge);
  const wrap = h('div', { class: 'map-tool' }, button);
  let showUnused = false;

  const pop = popover(button, (panel) => {
    const counts = ctx.counts();
    const hidden = ctx.hidden();
    const known = ctx.types();
    const knownIds = new Set(known.map((t) => t.id));
    const orphans = [...counts.keys()].filter((id) => !knownIds.has(id)).map((id) => ctx.typeOf(id));
    const all = [...known, ...orphans];
    const used = all.filter((t) => counts.get(t.id));
    const unused = all.filter((t) => !counts.get(t.id));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const rCounts = ctx.rankCounts();
    const rHidden = ctx.hiddenRanks();
    const allZoom = ctx.allZoom();

    const typeRow = (t) => {
      const n = counts.get(t.id) || 0;
      const off = hidden.has(t.id);
      return h('li', { class: ['map-legend-row', off && 'is-off', !n && 'is-empty'] },
        h('button', {
          type: 'button', class: 'map-legend-toggle', role: 'switch', 'aria-checked': String(!off), 'data-key': `t:${t.id}`,
          title: off ? `Show ${t.name}` : `Hide ${t.name}`, onclick: () => { ctx.toggleType(t.id); pop.refresh(); },
        }, h('span', { class: 'map-check', 'aria-hidden': 'true' }), swatch(t), h('span', { class: 'map-legend-name' }, t.name), h('span', { class: 'map-legend-count' }, String(n))),
        n ? h('button', { type: 'button', class: 'map-legend-only', 'data-key': `o:${t.id}`, title: `Show only ${t.name}`, 'aria-label': `Show only ${t.name}`, onclick: () => { ctx.soloType(t.id); pop.refresh(); } }, 'only') : null,
        t.missing ? null : h('button', { type: 'button', class: 'map-legend-edit', title: `Edit the ${t.name} type`, 'aria-label': `Edit the ${t.name} type`, onclick: async () => { pop.close(); await ctx.editType(t); } }, icon('edit')));
    };

    const rankRow = ({ rank, name, hint }) => {
      const n = rCounts.get(rank) || 0;
      const off = rHidden.has(rank);
      const where = off || allZoom || ctx.editing() ? 'now' : ctx.rankWhere(rank);
      return h('li', { class: ['map-legend-row', off && 'is-off', !n && 'is-empty'] },
        h('button', {
          type: 'button', class: 'map-legend-toggle', role: 'switch', 'aria-checked': String(!off), 'data-key': `r:${rank}`,
          title: `${off ? 'Show' : 'Hide'} rank ${rank} places. ${hint}`, onclick: () => { ctx.toggleRank(rank); pop.refresh(); },
        }, h('span', { class: 'map-check', 'aria-hidden': 'true' }), pips(rank),
        h('span', { class: 'map-legend-name' }, `${rank} · ${name}`),
        where !== 'now' && n ? h('span', { class: 'map-legend-where' }, where === 'in' ? 'zoom in' : 'zoom out') : null,
        h('span', { class: 'map-legend-count' }, String(n))),
        n ? h('button', { type: 'button', class: 'map-legend-only', 'data-key': `ro:${rank}`, title: `Show only rank ${rank}`, 'aria-label': `Show only rank ${rank}`, onclick: () => { ctx.soloRank(rank); pop.refresh(); } }, 'only') : null);
    };

    panel.append(
      h('div', { class: 'map-pop-head' },
        h('strong', null, 'Filter places'),
        h('span', { class: 'map-spacer' }),
        h('button', { type: 'button', class: 'map-linkbtn', onclick: () => { ctx.resetAll(); pop.refresh(); } }, 'Show everything')),
      h('div', { class: 'map-pop-scroll' },
        ctx.editing() ? h('p', { class: 'map-pop-note map-pop-warn' }, 'Edit mode shows every place; the filter applies again when you finish editing.') : null,
        h('div', { class: 'map-legend-sub' },
          h('span', null, 'Hierarchy'),
          h('span', { class: 'map-spacer' }),
          rHidden.size ? h('button', { type: 'button', class: 'map-linkbtn', onclick: () => { ctx.showAllRanks(); pop.refresh(); } }, 'All ranks') : null),
        h('ul', { class: 'map-legend-list' }, RANKS.map(rankRow)),
        h('label', { class: 'map-legend-row map-legend-switch' },
          h('input', { type: 'checkbox', checked: allZoom, 'data-key': 'allzoom', onchange: (e) => { ctx.setAllZoom(e.target.checked); pop.refresh(); } }),
          h('span', { class: 'map-legend-name' }, 'Show every rank at every zoom', h('small', null, 'Otherwise lower ranks appear as you zoom in'))),
        h('div', { class: 'map-legend-sub' },
          h('span', null, 'Location types'),
          h('span', { class: 'map-spacer' }),
          h('button', { type: 'button', class: 'map-linkbtn', onclick: () => { ctx.showAll(); pop.refresh(); } }, 'All'),
          h('button', { type: 'button', class: 'map-linkbtn', onclick: () => { ctx.hideAll(); pop.refresh(); } }, 'None')),
        used.length
          ? h('ul', { class: 'map-legend-list' }, used.map(typeRow))
          : h('p', { class: 'map-pop-note' }, 'No places on this map yet. These are the kinds you can add:'),
        unused.length ? (used.length
          ? h('div', { class: 'map-legend-unused' },
            h('button', { type: 'button', class: 'map-linkbtn', 'aria-expanded': String(showUnused), onclick: () => { showUnused = !showUnused; pop.refresh(); } },
              showUnused ? 'Hide unused types' : `Show ${unused.length} unused type${unused.length === 1 ? '' : 's'}`),
            showUnused ? h('ul', { class: 'map-legend-list' }, unused.map(typeRow)) : null)
          : h('ul', { class: 'map-legend-list' }, unused.map(typeRow))) : null),
      h('div', { class: 'map-pop-foot' },
        h('span', { class: 'map-pop-note' }, `${total} place${total === 1 ? '' : 's'} on this map`),
        h('span', { class: 'map-spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { pop.close(); await ctx.newType(); } }, icon('plus'), h('span', null, 'New type…'))));
  }, { className: 'map-legend', label: 'Filter places' });

  return {
    el: wrap,
    pop,
    update() {
      const n = ctx.hidden().size + ctx.hiddenRanks().size;
      const filtered = n > 0 || ctx.allZoom();
      badge.hidden = !n;
      badge.textContent = n ? `${n} hidden` : '';
      button.setAttribute('aria-label', n ? `Filter places (${n} hidden)` : ctx.allZoom() ? 'Filter places (every rank shown)' : 'Filter places');
      button.classList.toggle('is-filtered', filtered);
      pop.refresh();
    },
  };
}

// ---------- map menu ----------

/**
 * ctx: {info() -> {name, width, height, image, isPlaceholder, isMain}, editing(), toggleEdit(), openFilter(),
 *       rename(), replaceImage(), resetImage(), fit(), subMaps() -> [{id, name, count}], openMap(id),
 *       addSubmap(), deleteMap(), copyLink(), openSwitcher()}
 */
export function createMenu(ctx) {
  const button = h('button', { class: 'btn map-tool-btn map-tool-icon', type: 'button', 'aria-label': 'Map menu', title: 'Map menu: edit, sub-maps, image' }, icon('more'));
  const wrap = h('div', { class: 'map-tool' }, button);
  const pop = popover(button, (panel, api) => {
    const info = ctx.info();
    const item = (ic, label, fn, { disabled = false, hint = '', cls = '' } = {}) => h('button', {
      type: 'button', class: ['map-menu-item', cls], role: 'menuitem', disabled,
      onclick: () => { api.close(); fn(); },
    }, icon(ic), h('span', { class: 'map-menu-text' }, h('span', null, label), hint ? h('small', null, hint) : null));
    const dims = info.width && info.height ? `${Math.round(info.width)} × ${Math.round(info.height)} px` : '';
    const subs = ctx.subMaps();
    const editing = ctx.editing();
    panel.append(
      h('div', { class: 'map-menu-head' },
        h('strong', null, info.name),
        h('span', null, [info.isMain ? 'Main map' : 'Sub-map', info.isPlaceholder ? 'blank placeholder' : baseName(info.image), dims].filter(Boolean).join(' · '))),
      h('div', { class: 'map-pop-scroll map-menu-scroll' },
        item(editing ? 'check' : 'edit', editing ? 'Finish editing' : 'Edit map', ctx.toggleEdit, { hint: editing ? 'Back to the normal map' : 'Move, rename and re-rank every place', cls: 'map-menu-strong' }),
        item('filter', 'Filter places…', ctx.openFilter, { hint: 'By rank or location type' }),
        ctx.canDesign?.() ? item('compass', 'Design map…', ctx.designMap, { hint: 'Background, crop, compass, scale, border, pictures, fog' }) : null,
        ctx.hasDecor?.() ? item(ctx.decorOff() ? 'eye' : 'eye-off', ctx.decorOff() ? 'Show compass, scale and border' : 'Hide compass, scale and border', ctx.toggleDecor, { hint: 'On this device only' }) : null,
        h('hr', { class: 'map-menu-sep' }),
        h('p', { class: 'map-menu-label' }, info.isMain ? 'Sub-maps' : `Sub-maps of ${info.name}`),
        subs.map((m) => item('layers', m.name, () => ctx.openMap(m.id), { hint: `${m.count} place${m.count === 1 ? '' : 's'}` })),
        item('plus', 'Add a sub-map…', ctx.addSubmap, { hint: 'A separate map for a place, e.g. a city or dungeon' }),
        editing ? null : item('layers', 'Map collection…', ctx.openSwitcher, { hint: 'Every map, with the link to each' }),
        h('hr', { class: 'map-menu-sep' }),
        item('upload', 'Replace map image…', ctx.replaceImage, { hint: 'PNG, JPG, WebP or SVG — e.g. a Wonderdraft export' }),
        item('undo', 'Reset to placeholder', ctx.resetImage, { disabled: info.isPlaceholder }),
        item('edit', 'Rename map…', ctx.rename),
        item('copy', 'Duplicate this map…', ctx.copyMap, { hint: 'A new map with the same image, design, places, pictures and fog' }),
        item('link', 'Copy link to this map', ctx.copyLink),
        item('compass', 'Show the whole map', ctx.fit),
        info.isMain ? null : [h('hr', { class: 'map-menu-sep' }), item('trash', 'Delete this map…', ctx.deleteMap, { cls: 'map-menu-danger' })]));
  }, { className: 'map-menu', role: 'menu', label: 'Map menu' });
  return { el: wrap, pop };
}

// ---------- current map name (breadcrumb) ----------

/**
 * ctx: {chain() -> [map], href(id), mark(map) -> node|null, extra() -> node|null}. The name of the map shown, under
 * the search; on a sub-map its parents come first as links ("The Uncharted Realm › Starfall Vale"). The map
 * collection (collection.js) lists every map. mark: a lock beside a hidden map's name, extra: the DM's hide /
 * release switch for the map shown (DM mode).
 */
export function createCrumbs(ctx) {
  const list = h('ol', { class: 'map-crumbs-list' });
  const slot = h('div', { class: 'map-crumbs-extra' });
  const el = h('nav', { class: 'map-crumbs', 'aria-label': 'Current map', hidden: true }, list);
  const wrap = h('div', { class: 'map-crumbs-wrap' }, el, slot);

  return {
    el: wrap,
    update() {
      const chain = ctx.chain();
      el.hidden = !chain.length;
      el.classList.toggle('is-main', chain.length === 1);
      clear(list);
      chain.forEach((m, i) => {
        const last = i === chain.length - 1;
        list.append(h('li', null, last
          ? h('span', { class: 'map-crumb is-current', 'aria-current': 'page' }, m.name, ctx.mark?.(m))
          : h('a', { class: 'map-crumb', href: ctx.href(m.id), title: `Back to ${m.name}` }, m.name, ctx.mark?.(m))));
      });
      const extra = ctx.extra?.() || null;
      slot.hidden = !extra;
      if (extra) slot.replaceChildren(extra); else clear(slot);
    },
  };
}
