// Map collection: the "Maps" button under the search and its panel. Lists every map (main first, sub-maps
// nested under their parent) with a thumbnail, its parent, its number of places and the [[map:…]] link
// that opens it from any note. Entries are plain links (#/map/m/<id>), so opening one is the same route
// as every other sub-map navigation.
import { h, clear } from '../../core/dom.js';
import { icon, toast } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { nameKey } from '../../core/util.js';
import * as data from './data.js';
import { popover } from './controls.js';
import { copyText } from './drawer.js';
import { hiddenMark } from '../../core/dm-ui.js';

const FILTER_FROM = 7; // the filter field appears once there are this many maps
const THUMB_W = 240; // px; drawn at 72 css px, so sharp up to 3x screens

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- thumbnails ----------
// Raster images are shrunk once per image version (one at a time: a Wonderdraft export can be huge), so the
// panel never keeps full-size bitmaps around. SVGs draw cheaply at any size and are used as they are.

const thumbs = new Map(); // object URL of the image -> Promise<thumbnail URL>
let queue = Promise.resolve();

async function shrink(src) {
  if (typeof createImageBitmap !== 'function') return src;
  const bmp = await createImageBitmap(await (await fetch(src)).blob(), { resizeWidth: THUMB_W, resizeQuality: 'medium' });
  const k = Math.min(1, THUMB_W / bmp.width); // in case resizeWidth was ignored
  const c = h('canvas', { width: Math.max(1, Math.round(bmp.width * k)), height: Math.max(1, Math.round(bmp.height * k)) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const out = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
  return out ? URL.createObjectURL(out) : src;
}

/** URL of a small picture of a map image ('' / placeholder -> the placeholder). Resolves null if missing. */
async function thumbUrl(image) {
  if (data.isPlaceholderImage(image)) return data.PLACEHOLDER_IMAGE;
  if (!String(image).startsWith('content/')) return image;
  const src = await store.fileUrl(image).catch(() => null);
  if (!src || /\.svg$/i.test(image)) return src;
  if (!thumbs.has(src)) {
    const job = queue.then(() => shrink(src)).catch(() => src);
    queue = job;
    thumbs.set(src, job);
  }
  return thumbs.get(src);
}

// ---------- panel ----------

/** Does a map match every word of the filter (name or parent name)? */
function matches(m, words) {
  const hay = nameKey(`${m.name} ${m.isMain ? 'main map' : data.mapById(m.parent)?.name || ''}`);
  return words.every((w) => hay.includes(w));
}

async function copyLink(m) {
  const text = data.mapLinkText(m);
  if (await copyText(text)) toast(`Copied ${text} — paste it into any note.`, { type: 'success' });
  else toast(`Could not copy. The link is ${text}`, { type: 'error' });
}

/**
 * ctx: {current() -> mapId, addSubmap(), canManage() -> may add maps (the DM)}
 * Returns {el, pop, open()}. The panel keeps itself up to date while open (store events).
 */
export function createCollection(ctx) {
  const button = h('button', {
    class: 'btn map-tool-btn map-coll-btn', type: 'button', 'aria-label': 'Map collection', title: 'Map collection: every map, and the link to each',
  }, icon('layers'), h('span', { class: 'map-tool-label' }, 'Maps'));
  const el = h('div', { class: 'map-tool map-coll-tool' }, button);
  let query = '';
  let listEl = null;
  let countEl = null;
  let io = null;

  function entry(m, cur, nested) {
    const here = m.id === cur;
    const n = ctx.placeCount ? ctx.placeCount(m.id) : data.locationsOn(m.id).length;
    const link = data.mapLinkText(m);
    const img = h('img', { class: 'map-coll-thumb', alt: '', width: 72, height: 54, decoding: 'async' });
    img.dataset.image = m.image || '';
    io.observe(img);
    return h('li', { class: ['map-coll-item', here && 'is-current'], style: `--depth:${nested ? m.depth : 0}` },
      h('a', {
        class: 'map-coll-open', href: data.mapHref(m.id), 'aria-current': here ? 'page' : null, title: here ? `${m.name} is shown now` : `Open ${m.name}`,
        onclick: () => pop.close(), // the link itself navigates (same route as every sub-map link)
      },
      img,
      h('span', { class: 'map-coll-text' },
        h('span', { class: 'map-coll-name' }, h('strong', null, m.name), m.isMain ? null : hiddenMark(data.mapPath(m.id)), here ? h('span', { class: 'badge badge-accent' }, 'Shown') : null),
        h('span', { class: 'map-coll-meta' }, `${m.isMain ? 'Main map' : `in ${data.mapById(m.parent)?.name || 'the main map'}`} · ${plural(n, 'place')}`),
        h('code', { class: 'map-coll-link' }, link))),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-icon btn-sm map-coll-copy', 'aria-label': `Copy the link to ${m.name}`, title: `Copy ${link}`,
        onclick: () => copyLink(m),
      }, icon('link')));
  }

  function drawList() {
    if (!listEl) return;
    const all = data.maps();
    const words = nameKey(query).split(/\s+/).filter(Boolean);
    const shown = words.length ? all.filter((m) => matches(m, words)) : all;
    const cur = ctx.current();
    io?.disconnect();
    io = new IntersectionObserver((seen) => {
      for (const e of seen) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const img = e.target;
        thumbUrl(img.dataset.image).then((url) => { if (url) img.src = url; else img.classList.add('is-missing'); });
      }
    }, { root: listEl, rootMargin: '160px 0px' });
    clear(listEl);
    if (shown.length) listEl.append(...shown.map((m) => entry(m, cur, !words.length)));
    else listEl.append(h('li', { class: 'map-pop-note' }, 'No maps match.'));
    countEl.textContent = words.length ? `${shown.length} of ${all.length}` : plural(all.length, 'map');
  }

  function move(panel, e) {
    const links = [...panel.querySelectorAll('.map-coll-open')];
    const filter = panel.querySelector('.map-coll-search');
    const at = document.activeElement?.closest?.('.map-coll-item')?.querySelector('.map-coll-open');
    const i = links.indexOf(at);
    let next = null;
    if (e.key === 'ArrowDown') next = links[i < 0 ? 0 : Math.min(links.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') next = i > 0 ? links[i - 1] : filter || links[0];
    else if (e.key === 'Home') next = links[0];
    else if (e.key === 'End') next = links[links.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  }

  const pop = popover(button, (panel) => {
    const many = data.maps().length >= FILTER_FROM || !!query;
    countEl = h('span', { class: 'map-coll-count' });
    listEl = h('ul', { class: 'map-pop-scroll map-coll-list', role: 'list' });
    panel.append(...[
      h('div', { class: 'map-pop-head' },
        h('strong', null, 'Map collection'), countEl,
        h('span', { class: 'map-spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => pop.close({ focus: true }) }, icon('close'))),
      many ? h('div', { class: 'map-coll-filter' },
        h('input', {
          type: 'search', class: 'input map-coll-search', placeholder: 'Filter maps…', value: query, autocomplete: 'off', spellcheck: 'false',
          'aria-label': 'Filter maps by name', oninput: (e) => { query = e.target.value; drawList(); },
        })) : null,
      listEl,
      h('div', { class: 'map-pop-foot map-coll-foot' },
        h('p', { class: 'map-pop-note' }, 'Paste a map’s link into any note or description to open it from there.'),
        ctx.canManage?.() === false ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { pop.close(); ctx.addSubmap(); } }, icon('plus'), h('span', null, 'Add a sub-map…'))),
    ].filter(Boolean));
    panel.addEventListener('keydown', (e) => {
      const inFilter = !!e.target.classList?.contains('map-coll-search');
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // the map's own Esc would also close the drawer / leave modes
        if (inFilter && e.target.value) { e.target.value = ''; query = ''; drawList(); return; }
        pop.close({ focus: true });
      } else if (e.key === 'ArrowDown' || (!inFilter && ['ArrowUp', 'Home', 'End'].includes(e.key))) move(panel, e);
    });
    drawList();
  }, { className: 'map-coll', label: 'Map collection' });

  /** Start on the map that is shown (popover() focused the first control). */
  function focusCurrent() {
    if (!pop.isOpen || !listEl) return;
    const cur = listEl.querySelector('.map-coll-open[aria-current]') || listEl.querySelector('.map-coll-open');
    cur?.focus({ preventScroll: true });
    cur?.scrollIntoView({ block: 'nearest' });
  }
  button.addEventListener('click', focusCurrent); // runs after popover()'s own toggle listener

  let queued = false;
  store.on((ev) => {
    if (!pop.isOpen || queued) return;
    const paths = ev.path ? [ev.path] : ev.paths || [];
    const hit = ev.type === 'load' || paths.some((p) => p === data.CONFIG_PATH || p.startsWith(`${data.MAPS_DIR}/`) || p.startsWith(`${data.LOC_DIR}/`));
    if (!hit) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (pop.isOpen) drawList(); });
  });

  return {
    el,
    pop,
    open() { if (!pop.isOpen) pop.open(); focusCurrent(); },
  };
}
