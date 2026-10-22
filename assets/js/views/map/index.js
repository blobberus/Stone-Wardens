// Map tab: a Wonderdraft-style world map (Leaflet + CRS.Simple over one image) with player-made pins.
// A location's x/y are image pixels (origin top-left); in Leaflet, lat = -y and lng = x, so pins never
// move when the image bounds change.
import { h, mount, clear } from '../../core/dom.js';
import { icon, toast } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { href, current } from '../../core/router.js';
import { debounce } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';
import * as data from './data.js';
import { pinIcon, glyphsReady } from './pins.js';
import { createDrawer } from './drawer.js';
import { createSearch, createLegend, createMenu, closePopovers } from './controls.js';
import { openTypeForm } from './typeform.js';
import { replaceImage, resetImage, renameMap } from './image.js';

const PREFS_KEY = 'sw:map:prefs';
const DENSE = 40; // above this many pins, minor labels wait for a closer zoom
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSheet = () => !!S.root && S.root.clientWidth <= 640; // matches the @container rule in map.css

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}
const prefs = loadPrefs();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota */ } };

let L = null;
const S = {
  root: null, canvas: null, map: null, overlay: null, layer: null,
  bounds: null, size: { w: 0, h: 0 }, fitZoom: 0, url: null, info: null, cfgToken: 0, needsFit: false,
  markers: new Map(), // id -> {id, marker, loc, type, sig}
  hidden: new Set(Array.isArray(prefs.hidden) ? prefs.hidden : []),
  match: null, // Set of ids matching the search, or null
  selectedId: null, previewId: null,
  mode: 'idle', // 'idle' | 'placing' | 'moving'
  moveId: null, moveFrom: null, ghost: null,
  ready: false, visible: false, pendingRoute: null, staleMentions: false,
  dirty: { locs: false, types: false, config: false, journal: false }, syncQueued: false,
  ctxClosedAt: 0, resizeRaf: 0, emptyKey: '',
};
let drawer, search, legend, menu, banner, emptyCard, nameEl, addBtn, labelsBtn, ctxMenu = null;

const toLatLng = (x, y) => L.latLng(-y, x);
const toXY = (ll) => ({ x: ll.lng, y: -ll.lat });
const clampXY = ({ x, y }) => ({
  x: Math.min(Math.max(x, 0), S.size.w || x),
  y: Math.min(Math.max(y, 0), S.size.h || y),
});
const markerSig = (loc, type) => [loc.name, type.id, type.css, type.icon, type.rank, type.light].join('\u0000');
const labelsOn = () => prefs.labels !== false;

// ---------- mount ----------

function mountView(el) {
  L = window.L;
  el.classList.add('map-view');
  S.root = h('div', { class: ['map-root', labelsOn() && 'map-labels'], 'data-lvl': '3' });
  el.append(S.root);
  if (!L) {
    S.root.append(h('div', { class: 'empty-state map-fail' },
      h('h3', null, 'The map could not be drawn'),
      h('p', null, 'The map library did not load. Check your connection and reload the page.')));
    return;
  }

  S.canvas = h('div', { class: 'map-canvas', 'aria-label': 'World map. Arrow keys pan, plus and minus zoom.' });
  drawer = createDrawer({
    typeOf: data.typeOf,
    types: () => data.allTypes(),
    close: (opts) => closeDrawer(opts),
    startMove,
    finishMove,
    isMoving: () => S.mode === 'moving',
    saved: afterSave,
    preview: previewMarker,
    resetPreview,
    newType: createType,
    search: (q) => { search.set(q); search.focus(); },
    setLastType: (id) => { prefs.lastType = id; savePrefs(); },
  });
  search = createSearch({
    locations: () => data.locations(),
    typeOf: data.typeOf,
    onFilter: setMatch,
    onPick: (id) => openLocation(id, { fly: true }),
  });
  legend = createLegend({
    types: () => data.allTypes(),
    typeOf: data.typeOf,
    counts: typeCounts,
    hidden: () => S.hidden,
    toggleType: (id) => { const n = new Set(S.hidden); if (n.has(id)) n.delete(id); else n.add(id); setHidden(n); },
    soloType: (id) => setHidden(allTypeIds().filter((t) => t !== id)),
    showAll: () => setHidden([]),
    hideAll: () => setHidden(allTypeIds()),
    newType: createType,
    editType,
  });
  const info = () => S.info || { name: data.DEFAULT_MAP_NAME, width: 0, height: 0, image: data.PLACEHOLDER_IMAGE, isPlaceholder: true };
  menu = createMenu({
    info,
    rename: () => renameMap(info()),
    replaceImage: () => replaceImage(info()),
    resetImage: () => resetImage(info()),
    fit: () => fitMap(true),
  });
  addBtn = h('button', {
    class: 'btn btn-primary map-tool-btn map-add', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Add location',
    title: 'Add a location, then click the map', onclick: () => (S.mode === 'placing' ? cancelPlacing() : startPlacing()),
  }, icon('plus'), h('span', { class: 'map-tool-label' }, 'Add location'));
  labelsBtn = h('button', {
    class: 'btn map-tool-btn', type: 'button', 'aria-pressed': String(labelsOn()), 'aria-label': 'Place name labels',
    title: 'Show place names on the map', onclick: toggleLabels,
  }, icon('tag'), h('span', { class: 'map-tool-label' }, 'Labels'));
  banner = h('div', { class: 'map-banner', role: 'status', hidden: true });
  emptyCard = h('div', { class: 'map-empty', hidden: true });
  nameEl = h('span', { class: 'map-cartouche-name' });

  S.root.append(
    S.canvas,
    h('div', { class: 'map-tools map-tools-left' }, search.el),
    h('div', { class: 'map-tools map-tools-right', role: 'toolbar', 'aria-label': 'Map tools' },
      h('div', { class: 'map-tool' }, addBtn), legend.el, h('div', { class: 'map-tool' }, labelsBtn), menu.el),
    banner,
    emptyCard,
    h('div', { class: 'map-zoom', role: 'group', 'aria-label': 'Zoom' },
      h('button', { class: 'map-zoom-btn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => S.map.zoomIn() }, icon('plus')),
      h('button', { class: 'map-zoom-btn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => S.map.zoomOut() }, icon('minus')),
      h('button', { class: 'map-zoom-btn', type: 'button', 'aria-label': 'Show the whole map', title: 'Show the whole map', onclick: () => fitMap(true) }, icon('compass'))),
    h('div', { class: 'map-cartouche', 'aria-hidden': 'true' }, nameEl),
    drawer.el);

  S.map = L.map(S.canvas, {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false,
    trackResize: false, // handled below (only while visible)
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    minZoom: -8,
    maxZoom: 8,
    maxBoundsViscosity: 0.8,
    bounceAtZoomLimits: false,
    keyboardPanDelta: 120,
  });
  S.map.setView([0, 0], 0);
  S.layer = L.layerGroup().addTo(S.map);

  S.map.on('click', onMapClick);
  S.map.on('contextmenu', onContextMenu);
  S.map.on('zoomend', updateLabelLevel);
  S.map.on('movestart zoomstart', () => closeCtx());
  S.map.on('moveend', saveView);
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(S.canvas);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  store.on(onStore);
  init();
}

async function init() {
  try {
    await Promise.all([data.typesReady(), glyphsReady]);
    await applyConfig({ initial: true });
  } catch (e) {
    console.error('[map] init failed', e);
    toast(`The map could not load: ${e.message}`, { type: 'error' });
  }
  syncMarkers();
  S.ready = true;
  updateEmpty();
  const r = S.pendingRoute;
  S.pendingRoute = null;
  if (r) applyRoute(r, true);
}

// ---------- image / config ----------

function measure(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function applyConfig({ initial = false } = {}) {
  const token = ++S.cfgToken;
  const info = await data.effectiveConfig();
  let url = info.image;
  if (url.startsWith('content/')) {
    url = await store.fileUrl(url).catch(() => null);
    if (!url) {
      if (token === S.cfgToken) toast(`The map image ${info.image} is missing, so the placeholder is shown.`, { type: 'error' });
      url = data.PLACEHOLDER_IMAGE;
      if (!(info.width > 0 && info.height > 0)) Object.assign(info, await data.placeholderSize());
    }
  }
  if (!(info.width > 0 && info.height > 0)) Object.assign(info, (await measure(url)) || data.DEFAULT_SIZE);
  if (token !== S.cfgToken || !S.map) return;

  const resized = info.width !== S.size.w || info.height !== S.size.h;
  S.info = info;
  S.size = { w: info.width, h: info.height };
  S.bounds = L.latLngBounds([[-info.height, 0], [0, info.width]]);
  if (!S.overlay) {
    S.overlay = L.imageOverlay(url, S.bounds, { className: 'map-image', interactive: false, alt: '' }).addTo(S.map);
    S.overlay.on('error', () => toast('The map image could not be displayed.', { type: 'error' }));
  } else {
    if (url !== S.url) S.overlay.setUrl(url);
    if (resized) S.overlay.setBounds(S.bounds);
  }
  S.url = url;
  S.root.classList.toggle('is-placeholder', info.isPlaceholder);
  nameEl.textContent = info.name;
  updateZoomLimits();
  if (initial) restoreView();
  else if (resized) fitMap(false);
  menu.pop.refresh();
}

function updateZoomLimits() {
  if (!S.map || !S.bounds) return;
  const size = S.map.getSize();
  if (!size.x || !size.y) return;
  const fit = Math.log2(Math.min(size.x / S.size.w, size.y / S.size.h));
  S.fitZoom = Math.floor(fit * 4) / 4;
  S.map.setMinZoom(S.fitZoom - 0.75);
  S.map.setMaxZoom(Math.max(S.fitZoom + 4.5, 2)); // well past 1:1 for detail
  S.map.setMaxBounds(S.bounds.pad(0.25));
  updateLabelLevel();
  if (S.needsFit) { S.needsFit = false; restoreView(); }
}

function restoreView() {
  const size = S.map.getSize();
  if (!size.x || !size.y) { S.needsFit = true; return; }
  const v = prefs.view;
  if (v && v.w === S.size.w && v.h === S.size.h && [v.x, v.y, v.zoom].every(Number.isFinite)) {
    S.map.setView(toLatLng(v.x, v.y), Math.min(Math.max(v.zoom, S.map.getMinZoom()), S.map.getMaxZoom()), { animate: false });
  } else fitMap(false);
}

function fitMap(animate = true) {
  if (!S.bounds) return;
  const padR = drawer?.isOpen && !isSheet() ? drawer.el.offsetWidth + 16 : 8;
  const padB = drawer?.isOpen && isSheet() ? drawer.el.offsetHeight + 8 : 8;
  S.map.fitBounds(S.bounds, { animate: animate && !reduceMotion(), paddingTopLeft: [8, 8], paddingBottomRight: [padR, padB] });
}

const saveView = debounce(() => {
  if (!S.ready || !S.visible || !S.map) return;
  const c = toXY(S.map.getCenter());
  prefs.view = { x: Math.round(c.x), y: Math.round(c.y), zoom: S.map.getZoom(), w: S.size.w, h: S.size.h };
  savePrefs();
}, 600);

function onResize() {
  if (!S.visible || !S.map || !S.canvas.clientWidth || !S.canvas.clientHeight || S.resizeRaf) return;
  S.resizeRaf = requestAnimationFrame(() => {
    S.resizeRaf = 0;
    S.map.invalidateSize({ debounceMoveend: true });
    updateZoomLimits();
  });
}

// ---------- store sync ----------

function onStore(ev) {
  if (!['put', 'remove', 'pulled', 'load'].includes(ev.type)) return;
  const paths = ev.path ? [ev.path] : ev.paths || [];
  const all = ev.type === 'load';
  const touches = (dir) => all || paths.some((p) => p.startsWith(`${dir}/`));
  let hit = false;
  if (touches(data.LOC_DIR)) { S.dirty.locs = true; hit = true; }
  if (touches(data.TYPE_DIR)) { S.dirty.types = true; hit = true; }
  if (touches(data.MAP_DIR)) { S.dirty.config = true; hit = true; }
  if (touches(data.JOURNAL_DIR)) { S.dirty.journal = true; hit = true; }
  if (hit && !S.syncQueued) { S.syncQueued = true; queueMicrotask(runSync); }
}

async function runSync() {
  S.syncQueued = false;
  if (!S.ready) return; // init does a full sync
  const d = S.dirty;
  S.dirty = { locs: false, types: false, config: false, journal: false };
  if (d.config) applyConfig().catch((e) => console.error('[map] config', e));
  if (d.types) await data.typesReady();
  if (d.locs || d.types) syncMarkers();
  if (drawer.mode === 'view') {
    if (!data.locationById(drawer.id)) {
      closeDrawer({ force: true });
      toast('That location was removed from the map.');
    } else {
      drawer.refresh({ force: d.types });
      if (d.journal) refreshMentions();
    }
  }
}

const refreshMentions = debounce(() => {
  if (S.visible) drawer.refresh({ force: true });
  else S.staleMentions = true;
}, 500);

function syncMarkers() {
  if (!S.map) return;
  const seen = new Set();
  for (const loc of data.locations()) {
    seen.add(loc.id);
    const type = data.typeOf(loc.type);
    const sig = markerSig(loc, type);
    let e = S.markers.get(loc.id);
    if (!e) {
      const marker = L.marker(toLatLng(loc.x, loc.y), {
        icon: pinIcon(loc, type, { selected: loc.id === S.selectedId }),
        keyboard: true, riseOnHover: true, riseOffset: 2000,
      });
      e = { id: loc.id, marker, loc, type, sig };
      const entry = e;
      marker.on('click', (ev) => onMarkerClick(entry, ev));
      marker.on('add', () => applyState(entry));
      marker.on('dragend', () => onMarkerDragEnd(entry));
      S.markers.set(loc.id, e);
    } else {
      const moving = S.mode === 'moving' && S.moveId === loc.id;
      if (e.sig !== sig && loc.id !== S.previewId) {
        e.marker.setIcon(pinIcon(loc, type, { selected: loc.id === S.selectedId }));
        e.sig = sig;
      }
      if (!moving && (e.loc.x !== loc.x || e.loc.y !== loc.y)) e.marker.setLatLng(toLatLng(loc.x, loc.y));
      e.loc = loc;
      e.type = type;
    }
    updateVisibility(e);
    applyState(e);
  }
  for (const [id, e] of S.markers) {
    if (!seen.has(id)) { e.marker.remove(); S.markers.delete(id); }
  }
  legend.update();
  search.refresh();
  updateLabelLevel();
  updateEmpty();
}

function applyState(e) {
  const el = e.marker.getElement();
  if (!el) return;
  const sel = e.id === S.selectedId;
  el.classList.toggle('is-selected', sel);
  el.classList.toggle('is-dimmed', !!S.match && !S.match.has(e.id) && !sel);
  el.classList.toggle('is-moving', S.moveId === e.id);
  el.setAttribute('aria-label', `${e.loc.name}, ${e.type.name}`);
  el.removeAttribute('title');
}

function updateVisibility(e) {
  const show = !S.hidden.has(e.type.id) || e.id === S.selectedId || e.id === S.moveId;
  const has = S.layer.hasLayer(e.marker);
  if (show && !has) S.layer.addLayer(e.marker);
  else if (!show && has) S.layer.removeLayer(e.marker);
}

function select(id) {
  const prev = S.selectedId;
  if (prev === id) return;
  S.selectedId = id;
  for (const k of [prev, id]) {
    const e = k && S.markers.get(k);
    if (!e) continue;
    e.marker.setZIndexOffset(k === id ? 1000 : 0);
    updateVisibility(e);
    applyState(e);
  }
}

function setMatch(set) {
  S.match = set;
  for (const e of S.markers.values()) applyState(e);
}

function typeCounts() {
  const m = new Map();
  for (const e of S.markers.values()) m.set(e.type.id, (m.get(e.type.id) || 0) + 1);
  return m;
}

function allTypeIds() {
  return [...new Set([...data.allTypes().map((t) => t.id), ...typeCounts().keys()])];
}

function setHidden(ids) {
  S.hidden = new Set(ids);
  prefs.hidden = [...S.hidden];
  savePrefs();
  for (const e of S.markers.values()) updateVisibility(e);
  legend.update();
  updateEmpty();
}

function toggleLabels() {
  prefs.labels = !labelsOn();
  savePrefs();
  S.root.classList.toggle('map-labels', prefs.labels);
  labelsBtn.setAttribute('aria-pressed', String(prefs.labels));
}

function updateLabelLevel() {
  if (!S.map || !S.root) return;
  const dz = S.map.getZoom() - S.fitZoom;
  const lvl = S.markers.size <= DENSE || dz >= 1.5 ? 3 : dz >= 0.5 ? 2 : 1;
  if (S.root.dataset.lvl !== String(lvl)) S.root.dataset.lvl = String(lvl);
}

function updateEmpty() {
  if (!emptyCard) return;
  const idle = S.ready && S.mode === 'idle' && !drawer.isOpen;
  const n = S.markers.size;
  let key = '';
  if (idle && n === 0) key = 'none';
  else if (idle && n > 0 && S.layer.getLayers().length === 0) key = 'hidden';
  if (key === S.emptyKey) return;
  S.emptyKey = key;
  emptyCard.hidden = !key;
  if (key === 'none') {
    mount(emptyCard,
      h('span', { class: 'map-empty-mark', 'aria-hidden': 'true' }, icon('pin')),
      h('div', { class: 'map-empty-text' },
        h('p', { class: 'map-empty-title' }, 'The map is unmarked.'),
        h('p', null, 'Add the first location. You can also right-click (or long-press) anywhere on the map.')),
      h('button', { class: 'btn', type: 'button', onclick: startPlacing }, icon('plus'), h('span', null, 'Add location')));
  } else if (key === 'hidden') {
    mount(emptyCard,
      h('span', { class: 'map-empty-mark', 'aria-hidden': 'true' }, icon('filter')),
      h('div', { class: 'map-empty-text' },
        h('p', { class: 'map-empty-title' }, 'Every place is hidden.'),
        h('p', null, 'The type filter is hiding all locations.')),
      h('button', { class: 'btn', type: 'button', onclick: () => setHidden([]) }, icon('eye'), h('span', null, 'Show all types')));
  } else clear(emptyCard);
}

// ---------- types ----------

async function createType() {
  const saved = await openTypeForm();
  if (!saved?.id) return null;
  await data.refreshTypes();
  syncMarkers();
  return data.typeOf(saved.id);
}

async function editType(t) {
  const usage = typeCounts().get(t.id) || 0;
  const r = await openTypeForm({ type: t, usage });
  if (!r) return;
  await data.refreshTypes();
  syncMarkers();
  drawer.refresh({ force: true });
}

// ---------- selection, drawer, hash ----------

/** The drawer brings its own primary action, so the toolbar's Add button steps down to secondary. */
function setDrawerOpen(on) {
  S.root.classList.toggle('has-drawer', on);
  addBtn.classList.toggle('btn-primary', !on);
}

function setHash(id) {
  if (!S.visible || current().view !== 'map') return;
  const target = id ? href('map', 'loc', id) : '#/map';
  if (location.hash !== target) history.replaceState(history.state, '', target);
}

function visibleRect() {
  const size = S.map.getSize();
  const top = 64; // floating toolbar
  let w = size.x;
  let hh = size.y;
  if (drawer.isOpen) {
    if (isSheet()) hh -= drawer.el.offsetHeight;
    else w -= drawer.el.offsetWidth + 16;
  }
  return { x0: 0, y0: top, w: Math.max(w, 120), h: Math.max(hh - top, 120) };
}

/** Map centre that puts latlng in the middle of the part of the map not covered by the drawer. */
function centerFor(ll, zoom) {
  const v = visibleRect();
  const size = S.map.getSize();
  const off = L.point(size.x / 2 - (v.x0 + v.w / 2), size.y / 2 - (v.y0 + v.h / 2));
  return S.map.unproject(S.map.project(ll, zoom).add(off), zoom);
}

function flyToLoc(loc) {
  const ll = toLatLng(loc.x, loc.y);
  const z = Math.min(S.map.getMaxZoom() - 1, Math.max(S.map.getZoom(), S.fitZoom + 2));
  const c = centerFor(ll, z);
  if (reduceMotion()) S.map.setView(c, z, { animate: false });
  else S.map.flyTo(c, z, { duration: 0.8 });
}

function ensureVisible({ x, y }) {
  const ll = toLatLng(x, y);
  const p = S.map.latLngToContainerPoint(ll);
  const v = visibleRect();
  const m = 48;
  if (p.x < v.x0 + m || p.x > v.x0 + v.w - m || p.y < v.y0 + m || p.y > v.y0 + v.h - m) {
    S.map.panTo(centerFor(ll, S.map.getZoom()), { animate: !reduceMotion() });
  }
}

async function openLocation(id, { fly = false } = {}) {
  const loc = data.locationById(id);
  if (!loc) return false;
  closeCtx();
  if (drawer.mode === 'view' && drawer.id === loc.id) {
    setHash(loc.id);
    if (fly) flyToLoc(loc);
    return true;
  }
  if (!(await drawer.confirmLeave())) {
    setHash(drawer.mode === 'view' ? drawer.id : null);
    return false;
  }
  if (S.mode === 'moving') finishMove(false);
  if (S.mode === 'placing') cancelPlacing();
  removeGhost();
  resetPreview();
  select(loc.id);
  drawer.showLocation(loc.id);
  setDrawerOpen(true);
  setHash(loc.id);
  if (fly) flyToLoc(loc);
  else requestAnimationFrame(() => ensureVisible(loc));
  updateEmpty();
  return true;
}

async function closeDrawer({ force = false } = {}) {
  if (!drawer.isOpen) return true;
  if (!force && !(await drawer.confirmLeave())) return false;
  if (S.mode === 'moving') finishMove(false);
  const hadFocus = drawer.el.contains(document.activeElement);
  removeGhost();
  resetPreview();
  drawer.close();
  select(null);
  setDrawerOpen(false);
  setHash(null);
  if (hadFocus) S.canvas.focus({ preventScroll: true });
  updateEmpty();
  return true;
}

function afterSave(loc, isNew) {
  removeGhost();
  S.previewId = null;
  syncMarkers();
  select(loc.id);
  drawer.showLocation(loc.id);
  setDrawerOpen(true);
  setHash(loc.id);
  const hint = getSetting('autoCommit') ? 'It will be committed automatically.' : 'Press Save to share it with the party.';
  toast(isNew ? `Added “${loc.name}” to the map. ${hint}` : `Saved “${loc.name}”. ${hint}`, { type: 'success' });
}

/** Live preview of the type/name being edited, on the ghost pin (new) or the real marker (edit). */
function previewMarker(f) {
  const type = data.typeOf(f.type);
  if (drawer.mode === 'new' && S.ghost) {
    S.ghost.setIcon(pinIcon({ name: f.name.trim() || 'New location' }, type, { ghost: true, selected: true }));
    return;
  }
  if (drawer.mode === 'edit') {
    const e = S.markers.get(drawer.id);
    if (!e) return;
    S.previewId = e.id;
    e.marker.setIcon(pinIcon({ name: f.name.trim() || e.loc.name }, type, { selected: true }));
    applyState(e);
  }
}

function resetPreview() {
  const id = S.previewId;
  S.previewId = null;
  const e = id && S.markers.get(id);
  if (!e) return;
  e.marker.setIcon(pinIcon(e.loc, e.type, { selected: id === S.selectedId }));
  e.sig = markerSig(e.loc, e.type);
  applyState(e);
}

// ---------- adding ----------

function showBanner(text, actions = [], hint = '') {
  mount(banner,
    h('span', { class: 'map-banner-text' }, text, hint ? h('small', null, hint) : null),
    actions.map((a) => h('button', { type: 'button', class: ['btn', 'btn-sm', a.primary ? 'btn-primary' : 'btn-ghost'], onclick: a.onClick }, a.label)));
  banner.hidden = false;
}
function hideBanner() { banner.hidden = true; clear(banner); }

async function startPlacing() {
  closePopovers();
  closeCtx();
  if (drawer.isOpen && !(await closeDrawer())) return;
  if (S.mode === 'moving') finishMove(false);
  S.mode = 'placing';
  S.root.classList.add('is-placing');
  addBtn.setAttribute('aria-pressed', 'true');
  showBanner('Click the map where the new location should go.', [{ label: 'Cancel', onClick: cancelPlacing }], 'Enter drops it at the centre · Esc cancels');
  updateEmpty();
}

function cancelPlacing() {
  if (S.mode !== 'placing') return false;
  S.mode = 'idle';
  S.root.classList.remove('is-placing');
  addBtn.setAttribute('aria-pressed', 'false');
  hideBanner();
  updateEmpty();
  return true;
}

function placeAt(ll) {
  cancelPlacing();
  beginNewAt(clampXY(toXY(ll)));
}

function placeAtCenter() {
  const v = visibleRect();
  placeAt(S.map.containerPointToLatLng([v.x0 + v.w / 2, v.y0 + v.h / 2]));
}

function placeGhost(xy, typeId) {
  removeGhost();
  S.ghost = L.marker(toLatLng(xy.x, xy.y), {
    icon: pinIcon({ name: 'New location' }, data.typeOf(typeId), { ghost: true, selected: true }),
    draggable: true, keyboard: false, zIndexOffset: 5000,
  }).addTo(S.map);
  S.ghost.on('dragend', () => {
    const p = clampXY(toXY(S.ghost.getLatLng()));
    S.ghost.setLatLng(toLatLng(p.x, p.y));
    drawer.setPosition(p);
  });
}

function removeGhost() {
  if (S.ghost) { S.ghost.remove(); S.ghost = null; }
}

async function beginNewAt(xy) {
  closeCtx();
  if (S.mode === 'placing') cancelPlacing();
  if (S.mode === 'moving') finishMove(false);
  if (drawer.isOpen && !(await drawer.confirmLeave())) return;
  resetPreview();
  select(null);
  const last = data.typeOf(prefs.lastType || 'landmark');
  const type = last.missing ? 'landmark' : last.id;
  placeGhost(xy, type);
  drawer.openNew({ x: xy.x, y: xy.y, type });
  setDrawerOpen(true);
  setHash(null);
  requestAnimationFrame(() => ensureVisible(xy));
  updateEmpty();
}

// ---------- moving ----------

function startMove(id) {
  const e = S.markers.get(id);
  if (!e) return;
  cancelPlacing();
  closeCtx();
  S.mode = 'moving';
  S.moveId = id;
  S.moveFrom = e.marker.getLatLng();
  updateVisibility(e);
  e.marker.dragging?.enable();
  S.root.classList.add('is-moving');
  applyState(e);
  showBanner(`Drag “${e.loc.name}” to its new place, or click the map.`, [
    { label: 'Cancel', onClick: () => finishMove(false) },
    { label: 'Save position', primary: true, onClick: () => finishMove(true) },
  ], 'Enter saves · Esc cancels');
  drawer.setMoving(true);
  updateEmpty();
}

function finishMove(save) {
  if (S.mode !== 'moving') return;
  const e = S.markers.get(S.moveId);
  const from = S.moveFrom;
  S.mode = 'idle';
  S.moveId = null;
  S.moveFrom = null;
  S.root.classList.remove('is-moving');
  hideBanner();
  if (e) {
    e.marker.dragging?.disable();
    if (save) {
      const p = clampXY(toXY(e.marker.getLatLng()));
      const was = toXY(from);
      if (Math.abs(p.x - was.x) > 0.01 || Math.abs(p.y - was.y) > 0.01) {
        data.saveLocation({ ...e.loc, x: p.x, y: p.y });
        toast(`Moved “${e.loc.name}”.`, { type: 'success' });
      }
    } else e.marker.setLatLng(from);
    updateVisibility(e);
    applyState(e);
  }
  drawer.setMoving(false);
  updateEmpty();
}

function onMarkerDragEnd(e) {
  if (S.moveId !== e.id) return;
  const p = clampXY(toXY(e.marker.getLatLng()));
  e.marker.setLatLng(toLatLng(p.x, p.y));
}

// ---------- map events ----------

function onMarkerClick(e, ev) {
  closeCtx();
  if (S.mode === 'placing') { placeAt(ev.latlng); return; }
  if (S.mode === 'moving') return;
  openLocation(e.id);
}

function onMapClick(ev) {
  if (closeCtx() || Date.now() - S.ctxClosedAt < 350) return;
  if (S.mode === 'placing') { placeAt(ev.latlng); return; }
  const p = clampXY(toXY(ev.latlng));
  if (S.mode === 'moving') { S.markers.get(S.moveId)?.marker.setLatLng(toLatLng(p.x, p.y)); return; }
  if (drawer.mode === 'new' && S.ghost) { S.ghost.setLatLng(toLatLng(p.x, p.y)); drawer.setPosition(p); return; }
  if (drawer.mode === 'view') closeDrawer();
}

function onContextMenu(ev) {
  if (S.mode === 'moving') return;
  if (S.mode === 'placing') { placeAt(ev.latlng); return; }
  openCtx(ev.containerPoint, ev.latlng);
}

function openCtx(pt, ll) {
  closeCtx();
  closePopovers();
  const xy = clampXY(toXY(ll));
  ctxMenu = h('div', { class: 'map-ctx', role: 'menu', 'aria-label': 'Map actions' },
    h('button', { type: 'button', class: 'map-menu-item', role: 'menuitem', onclick: () => { closeCtx(); beginNewAt(xy); } },
      icon('plus'), h('span', { class: 'map-menu-text' }, h('span', null, 'Add location here'))),
    h('button', { type: 'button', class: 'map-menu-item', role: 'menuitem', onclick: () => { closeCtx(); S.map.panTo(ll, { animate: !reduceMotion() }); } },
      icon('pin'), h('span', { class: 'map-menu-text' }, h('span', null, 'Centre the map here'))),
    h('button', { type: 'button', class: 'map-menu-item', role: 'menuitem', onclick: () => { closeCtx(); fitMap(true); } },
      icon('compass'), h('span', { class: 'map-menu-text' }, h('span', null, 'Show the whole map'))));
  S.root.append(ctxMenu);
  const w = S.root.clientWidth;
  const hh = S.root.clientHeight;
  ctxMenu.style.left = `${Math.max(8, Math.min(pt.x, w - ctxMenu.offsetWidth - 8))}px`;
  ctxMenu.style.top = `${Math.max(8, Math.min(pt.y, hh - ctxMenu.offsetHeight - 8))}px`;
  ctxMenu.querySelector('button')?.focus({ preventScroll: true });
  ctxMenu.addEventListener('keydown', (e) => {
    const items = [...ctxMenu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener('pointerdown', ctxOutside, true);
}

function ctxOutside(e) {
  if (ctxMenu && !ctxMenu.contains(e.target)) { closeCtx(); S.ctxClosedAt = Date.now(); }
}

function closeCtx() {
  if (!ctxMenu) return false;
  ctxMenu.remove();
  ctxMenu = null;
  document.removeEventListener('pointerdown', ctxOutside, true);
  return true;
}

function onKey(e) {
  if (!S.visible || !S.map) return;
  if (e.key === 'Escape') {
    if (e.defaultPrevented || document.querySelector('.modal-backdrop')) return;
    if (closeCtx()) { e.preventDefault(); S.canvas.focus({ preventScroll: true }); return; }
    if (closePopovers()) { e.preventDefault(); return; }
    if (S.mode === 'placing') { e.preventDefault(); cancelPlacing(); return; }
    if (S.mode === 'moving') { e.preventDefault(); finishMove(false); return; }
    if (drawer.isOpen) { e.preventDefault(); closeDrawer(); }
    return;
  }
  if (document.querySelector('.modal-backdrop')) return;
  const t = e.target;
  const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const onButton = t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement;
  if (e.key === 'Enter' && !onButton && S.mode === 'placing') { e.preventDefault(); placeAtCenter(); return; }
  if (e.key === 'Enter' && !onButton && S.mode === 'moving') { e.preventDefault(); finishMove(true); return; }
  if (e.key === '/') { e.preventDefault(); search.focus(); }
}

// ---------- routes ----------

function applyRoute(target, fly) {
  if (target) {
    const loc = data.findLocation(target, { loose: true });
    if (!loc) {
      toast(`There is no “${target}” on the map.`, { type: 'error' });
      setHash(drawer.mode === 'view' ? drawer.id : null);
      return;
    }
    if (drawer.mode === 'view' && drawer.id === loc.id) {
      setHash(loc.id);
      if (fly) flyToLoc(loc);
      return;
    }
    openLocation(loc.id, { fly: true });
  } else if (drawer.mode === 'view') {
    closeDrawer({ force: true });
  }
}

function showView(route) {
  if (!S.map) return;
  const fromElsewhere = !S.visible;
  S.visible = true;
  requestAnimationFrame(() => {
    S.map.invalidateSize();
    updateZoomLimits();
  });
  if (S.staleMentions) { S.staleMentions = false; drawer.refresh({ force: true }); }
  const [sub, target] = route?.parts || [];
  const want = sub === 'loc' && target ? target : null;
  if (!S.ready) { S.pendingRoute = want; return; }
  applyRoute(want, fromElsewhere);
}

function hideView() {
  S.visible = false;
  cancelPlacing();
  closeCtx();
  closePopovers();
}

export default {
  id: 'map',
  title: 'Map',
  icon: 'map',
  mount: mountView,
  show: showView,
  hide: hideView,
};
