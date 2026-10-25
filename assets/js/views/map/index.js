// Map tab: Wonderdraft-style maps (Leaflet + CRS.Simple over one image each) with player-made pins.
// There is a main map and any number of nested sub-maps; the view shows one "active" map at a time.
// A location's x/y are image pixels (origin top-left); in Leaflet, lat = -y and lng = x, so pins never
// move when the image bounds change.
// Performance: the image is drawn as pre-rendered canvas tiles (raster.js), zoom is continuous and eased
// (zoom.js), pins keep a stable z-index (pins.js), and the 4 hierarchy ranks live in their own panes
// whose opacity follows the zoom, so a zoom frame costs a transform per pin plus 4 opacity writes.
// Design (design.js, decor.js): background, crop, compass, scale bar / ruler and border per map; pictures laid on a
// map (pictures.js); fog of war (fog.js, fogview.js) that hides the places under it from the players. The DM edits
// them in the Design / Pictures / Fog tabs of Edit map (designpanel.js). docs/map-design.md.
import { h, mount, clear } from '../../core/dom.js';
import { icon, toast } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { current, navigate } from '../../core/router.js';
import { debounce } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';
import { saveSoon, saveHint } from '../../core/saving.js';
import * as data from './data.js';
import { pinIcon, glyphsReady, PinMarker } from './pins.js';
import { createDrawer } from './drawer.js';
import { createSearch, createLegend, createMenu, createCrumbs, closePopovers } from './controls.js';
import { openTypeForm } from './typeform.js';
import { replaceImage, resetImage, renameMap } from './image.js';
import { loadImageSource, createImageLayer } from './raster.js';
import { createZoomer } from './zoom.js';
import { RANK_IDS, rankOpacity, rankWhere, normBands } from './ranks.js';
import { openNewMapDialog, deleteMapFlow, openMoveMapDialog } from './submaps.js';
import { createEditor } from './edit.js';
import { createCollection } from './collection.js';
import { registerHideable, isHidden, onDmMode, isDm } from '../../core/dm.js';
import { visibilityToggle, hiddenMark } from '../../core/dm-ui.js';
import { normDesign, normCrop, borderPad, hasDecorations } from './design.js';
import { fogCovers, fogActive } from './fog.js';
import { createDecor, DECOR_PANE, BORDER_PANE } from './decor.js';
import { createFogView, FOG_PANE, FOG_EDGE_PANE, TOOL_PANE } from './fogview.js';
import { createPictures, PIC_PANE } from './pictures.js';
import { createDesignPanel } from './designpanel.js';
import { openCopyMapDialog } from './submaps.js';

// DM mode: places can be hidden from the players until released (core/dm.js); a place on a hidden map goes with it
registerHideable({
  prefix: `${data.LOC_DIR}/`, label: 'Map place', icon: 'pin', order: 50, accept: (p) => p.endsWith('.json'),
  describe: (path, d) => ({ title: d?.name, href: d?.id ? data.locHref({ ...d, map: d.map || data.MAIN_MAP }) : null }),
  releaseBlock: (path, d) => {
    const on = d?.map || data.MAIN_MAP; // no map field: the main map
    return data.mapHidden(on) ? `This place is on the hidden map “${data.mapById(on)?.name || on}”. Release that map to show it.` : null;
  },
});

const PREFS_KEY = 'sw:map:prefs';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSheet = () => !!S.root && S.root.clientWidth <= 640; // matches the @container rule in map.css
const SELECTED_Z = 100000; // z-index offsets (pins' own z-index is their image y)
const HOVER_Z = 200000;

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { p = {}; }
  if (!p.views || typeof p.views !== 'object') p.views = {};
  if (p.view && !p.views[data.MAIN_MAP]) p.views[data.MAIN_MAP] = p.view; // single-map prefs from before sub-maps
  delete p.view;
  return p;
}
const prefs = loadPrefs();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota */ } };

let L = null;
const S = {
  root: null, canvas: null, map: null, layer: null, image: null, imageKey: '',
  mapId: data.MAIN_MAP, mapParent: null, info: null, bounds: null, size: { w: 0, h: 0 }, fitZoom: 0, cfgToken: 0, needsFit: false,
  markers: new Map(), // id -> {id, marker, loc, type, rank, sub, sig}
  panes: {}, paneOp: {}, paneLbl: {}, zoomU: 0,
  hidden: new Set(Array.isArray(prefs.hidden) ? prefs.hidden : []),
  hiddenRanks: new Set(Array.isArray(prefs.hiddenRanks) ? prefs.hiddenRanks.map(Number) : []),
  allZoom: !!prefs.allZoom,
  bands: normBands(), bandPreview: null,
  match: null, // Set of ids matching the search, or null
  selectedId: null, previewId: null,
  mode: 'idle', // 'idle' | 'placing' | 'moving'
  moveId: null, moveFrom: null, ghost: null,
  ready: false, visible: false, pendingRoute: null, wantNewMap: false, staleMentions: false,
  dirty: { locs: false, types: false, config: false, journal: false, fog: false, pics: false }, syncQueued: false,
  ctxClosedAt: 0, resizeRaf: 0, emptyKey: '', loadTimer: 0,
  design: null, designDraft: null, view: null, imageUrl: '', cropping: false, designTab: null, pick: null,
};
let drawer, search, legend, menu, crumbs, collection, editor, zoomer, banner, emptyCard, addBtn, labelsBtn, measureBtn, ctxMenu = null;
let decor, fogV, pictures, designPanel;
let unrevealedCard = null; // players, while the DM hides the main map and there is no map of its own to show

const toLatLng = (x, y) => L.latLng(-y, x);
const toXY = (ll) => ({ x: ll.lng, y: -ll.lat });
const clampXY = ({ x, y }) => ({
  x: Math.min(Math.max(x, 0), S.size.w || x),
  y: Math.min(Math.max(y, 0), S.size.h || y),
});
const markerSig = (loc, type, rank, sub) => [loc.name, type.id, type.css, type.icon, rank, type.light, sub].join('\u0000');
const labelsOn = () => prefs.labels !== false;
const editing = () => !!editor?.isOpen;
const paneName = (r) => (r === 'pin' ? 'mapPinned' : `mapRank${r}`);
const info = () => S.info || { id: S.mapId, isMain: S.mapId === data.MAIN_MAP, name: data.mapById(S.mapId)?.name || data.DEFAULT_MAP_NAME, width: 0, height: 0, image: data.PLACEHOLDER_IMAGE, isPlaceholder: true, bands: normBands() };
/** The design shown: the Design tab's unsaved draft while it is open, else the map's own. */
const design = () => S.designDraft || S.design || normDesign(null);
const decorOff = () => prefs.decor === false;
/** The DM sees through the fog (so does whoever has the Fog tab open), unless previewing as the players. */
const seeThrough = () => !fogV?.preview && (isDm() || S.designTab === 'fog');
/** Is a place hidden by its map's fog from this viewer? */
const fogHidesLoc = (l) => !!l && !seeThrough() && fogCovers(data.fogOf(l.map), l.x, l.y);
/** Map-wide changes are the DM's (data.canDesign); a stray call from elsewhere just says so. */
const dmOnly = (what, fn) => (...args) => {
  if (data.canDesign()) return fn(...args);
  toast(`Only the DM can ${what}.`);
  return null;
};
/** The fog's wash: the color around the map (its background, which may follow the light or dark theme). */
function fogColor() {
  const c = S.canvas && getComputedStyle(S.canvas).backgroundColor;
  return c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c : (design().background.color || '#c9b98f');
}

// ---------- mount ----------

function mountView(el) {
  L = window.L;
  el.classList.add('map-view');
  S.root = h('div', { class: ['map-root', labelsOn() && 'map-labels'] });
  el.append(S.root);
  if (!L) {
    S.root.append(h('div', { class: 'empty-state map-fail' },
      h('h3', null, 'The map could not be drawn'),
      h('p', null, 'The map library did not load. Check your connection and reload the page.')));
    return;
  }

  S.canvas = h('div', { class: 'map-canvas', 'aria-label': 'Map. Arrow keys pan, plus and minus zoom.' });
  decor = createDecor({
    map: () => S.map,
    root: S.root,
    design,
    rect: () => S.view || { x: 0, y: 0, w: S.size.w, h: S.size.h },
    size: () => S.size,
    hidden: decorOff,
    editing: () => S.designTab === 'design',
    compassMoved: (p) => designPanel.patch((d) => { d.compass.x = p.x; d.compass.y = p.y; }),
  });
  fogV = createFogView({
    map: () => S.map,
    root: S.root,
    canvas: S.canvas,
    mapId: () => S.mapId,
    size: () => S.size,
    seeThrough,
    editing: () => S.designTab === 'fog',
    color: fogColor,
    changed: refreshPins,
    edited: () => editor.markChanged(),
  });
  pictures = createPictures({
    map: () => S.map,
    root: S.root,
    mapId: () => S.mapId,
    editing: () => S.designTab === 'pictures',
    picked: () => designPanel.pictureSelected(),
    edited: () => editor.markChanged(),
    viewRect,
  });
  designPanel = createDesignPanel({
    mapId: () => S.mapId,
    info,
    design: () => S.design || normDesign(null),
    preview: (d) => { S.designDraft = d ? normDesign(d, { width: S.size.w, height: S.size.h }) : null; refreshDesign(); },
    write: (d) => { // S.design at once, so closing the tab right after shows no flash of the old design
      S.design = normDesign(d, { width: S.size.w, height: S.size.h });
      data.writeMapConfig(S.mapId, { design: S.design });
    },
    startCrop,
    stopCrop,
    cropping: () => S.cropping,
    fog: fogV,
    pictures,
    pickPoints,
    shown: () => S.view || { x: 0, y: 0, w: S.size.w, h: S.size.h },
    edited: () => editor.markChanged(),
    setTab: (id) => { S.designTab = id; fogV.sync({ animate: false }); refreshPins(); decor.update(); },
  });
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
    mapId: () => S.mapId,
    newSubmap: dmOnly('add maps', ({ name, parent }) => openNewMapDialog({ parent, name })),
  });
  search = createSearch({
    locations: () => data.locations().filter((l) => !fogHidesLoc(l) && data.mapById(l.map)), // places under the fog stay unknown
    typeOf: data.typeOf,
    mapId: () => S.mapId,
    mapName: (id) => data.mapById(id)?.name || '',
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
    rankCounts,
    hiddenRanks: () => S.hiddenRanks,
    toggleRank: (r) => { const n = new Set(S.hiddenRanks); if (n.has(r)) n.delete(r); else n.add(r); setHiddenRanks(n); },
    soloRank: (r) => setHiddenRanks(RANK_IDS.filter((x) => x !== r)),
    showAllRanks: () => setHiddenRanks([]),
    allZoom: () => S.allZoom,
    setAllZoom,
    rankWhere: (r) => rankWhere(bandOf(r), S.zoomU, S.bands),
    editing,
    resetAll: () => { setHidden([]); setHiddenRanks([]); setAllZoom(false); },
  });
  menu = createMenu({
    info,
    editing,
    toggleEdit: () => toggleEdit(),
    canDesign: data.canDesign,
    designMap: () => toggleEdit(true, 'design'),
    copyMap: dmOnly('duplicate maps', () => copyCurrentMap()),
    hasDecor: () => hasDecorations(S.design),
    decorOff,
    toggleDecor,
    openFilter: () => legend.pop.open(),
    rename: dmOnly('rename maps', () => renameMap(info())),
    replaceImage: dmOnly('change map images', () => replaceImage(info())),
    resetImage: dmOnly('change map images', () => resetImage(info())),
    fit: () => fitMap(true),
    subMaps: () => data.childMaps(S.mapId).map((m) => ({ id: m.id, name: m.name, count: data.locationsOn(m.id).filter((l) => !fogHidesLoc(l)).length })),
    openMap: (id) => navigate(data.mapHref(id)),
    addSubmap: dmOnly('add maps', () => addSubmap()),
    moveMap: dmOnly('move maps', () => moveCurrentMap()),
    deleteMap: dmOnly('delete maps', () => deleteCurrentMap()),
    copyLink: copyMapLink,
    openSwitcher: () => collection.open(),
  });
  crumbs = createCrumbs({
    chain: () => data.mapChain(S.mapId),
    href: data.mapHref,
    mark: (m) => hiddenMark(data.mapPath(m.id)),
    // DM mode: hide the map shown (with its places, pictures, fog and sub-maps; the main map: every map inside it) or
    // release it to the players
    extra: () => visibilityToggle(data.mapPath(S.mapId), S.mapId === data.MAIN_MAP
      ? { label: 'the main map, the maps inside it and everything on them', before: data.ensureMainConfig, confirmHide: mainHideQuestion, onChange: () => crumbs.update() }
      : { label: 'this map and everything on it', onChange: () => crumbs.update() }),
  });
  collection = createCollection({
    current: () => S.mapId,
    placeCount: (id) => data.locationsOn(id).filter((l) => !fogHidesLoc(l)).length,
    addSubmap: dmOnly('add maps', () => addSubmap()),
    canManage: data.canDesign,
  });
  editor = createEditor({
    root: S.root,
    leaflet: () => S.map,
    mapId: () => S.mapId,
    info,
    locations: () => data.locationsOn(S.mapId).filter((l) => !fogHidesLoc(l)),
    allLocations: () => data.locationsOn(S.mapId),
    design: designPanel,
    canDesign: data.canDesign,
    typeOf: data.typeOf,
    types: () => data.allTypes(),
    marker: (id) => S.markers.get(id),
    toLatLng,
    toXY,
    clampXY,
    applyStates: () => { cull(); for (const e of S.markers.values()) applyState(e); },
    focusLoc: (loc, zoom) => (zoom ? flyToLoc(loc) : ensureVisible(loc)),
    openDetails: (id) => openLocation(id, { fly: false }),
    exit: () => toggleEdit(false),
    replaceImage: dmOnly('change map images', () => replaceImage(info())),
    rename: dmOnly('rename maps', () => renameMap(info())),
    newSubmap: dmOnly('add maps', ({ name, parent }) => openNewMapDialog({ parent, name })),
    setBandPreview: (b) => { S.bandPreview = b; updateRanks(); },
    zoomU: () => S.zoomU,
    rankShift: () => S.rankShift || 0,
  });
  addBtn = h('button', {
    class: 'btn btn-primary map-tool-btn map-add', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Add location',
    title: 'Add a location, then click the map', onclick: () => (S.mode === 'placing' ? cancelPlacing() : startPlacing()),
  }, icon('plus'), h('span', { class: 'map-tool-label' }, 'Add location'));
  labelsBtn = h('button', {
    class: 'btn map-tool-btn', type: 'button', 'aria-pressed': String(labelsOn()), 'aria-label': 'Place name labels',
    title: 'Show place names on the map', onclick: toggleLabels,
  }, icon('tag'), h('span', { class: 'map-tool-label' }, 'Labels'));
  measureBtn = h('button', {
    class: 'btn map-tool-btn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Ruler',
    title: 'Measure distances: click points on the map', onclick: () => (S.mode === 'measuring' ? stopMeasure() : startMeasure()),
  }, icon('ruler'), h('span', { class: 'map-tool-label' }, 'Ruler'));
  banner = h('div', { class: 'map-banner', role: 'status', hidden: true });
  emptyCard = h('div', { class: 'map-empty', hidden: true });
  unrevealedCard = h('div', { class: 'map-unrevealed', role: 'status', hidden: true },
    h('div', { class: 'map-unrevealed-card' },
      h('span', { class: 'map-unrevealed-mark', 'aria-hidden': 'true' }, icon('map')),
      h('h2', { class: 'map-unrevealed-title' }, 'The DM hasn’t revealed the map yet.'),
      h('p', null, 'It appears here as soon as the DM shows it to the players.')));

  S.root.append(
    S.canvas,
    // Top left: the search with the Maps button beside it, and the current map's name (its parents first) under them.
    h('div', { class: 'map-tools map-tools-left' }, h('div', { class: 'map-search-row' }, search.el, collection.el), crumbs.el),
    h('div', { class: 'map-tools map-tools-right', role: 'toolbar', 'aria-label': 'Map tools' },
      h('div', { class: 'map-tool' }, addBtn), legend.el, h('div', { class: 'map-tool' }, labelsBtn), h('div', { class: 'map-tool', hidden: true }, measureBtn), menu.el),
    banner,
    emptyCard,
    h('div', { class: 'map-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Unrolling the map…'),
    h('div', { class: 'map-zoom', role: 'group', 'aria-label': 'Zoom' },
      h('button', { class: 'map-zoom-btn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => zoomStep(1) }, icon('plus')),
      h('button', { class: 'map-zoom-btn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => zoomStep(-1) }, icon('minus')),
      h('button', { class: 'map-zoom-btn', type: 'button', 'aria-label': 'Show the whole map', title: 'Show the whole map', onclick: () => fitMap(true) }, icon('compass'))),
    editor.el,
    drawer.el,
    unrevealedCard);

  S.map = L.map(S.canvas, {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false,
    trackResize: false, // handled below (only while visible)
    zoomSnap: 0, // continuous zoom (zoom.js); the image tiles handle fractional levels
    zoomDelta: 1,
    zoomAnimation: false, // no CSS zoom transitions: every zoom is driven frame by frame
    scrollWheelZoom: false, // replaced by zoom.js
    doubleClickZoom: false, // ditto
    boxZoom: false,
    minZoom: -8,
    maxZoom: 8,
    maxBoundsViscosity: 0.8,
    bounceAtZoomLimits: false,
    keyboardPanDelta: 120,
  });
  if (S.map.keyboard) S.map.keyboard._zoomKeys = {}; // +/- go through the smooth zoom (onKey)
  S.map.setView([0, 0], 0);
  // Panes: one per rank (opacity follows the zoom), one for pins that must stay visible.
  RANK_IDS.forEach((r) => {
    const p = S.map.createPane(paneName(r));
    p.classList.add('map-pane', 'map-pane-rank', `rank-${r}`);
    p.style.zIndex = String(605 - r);
    S.panes[r] = p;
  });
  S.panes.pin = S.map.createPane(paneName('pin'));
  S.panes.pin.classList.add('map-pane', 'map-pane-pinned', 'has-labels');
  S.panes.pin.style.zIndex = '640';
  // Design layers: pictures, fog, border, a compass drawn on the map (all under the pins), tools (above them)
  for (const [name, z, cls] of [[PIC_PANE, 410, 'map-pane-pictures'], [FOG_PANE, 450, 'map-pane-fog'], [FOG_EDGE_PANE, 452, 'map-pane-fogedge'], [BORDER_PANE, 455, 'map-pane-border'], [DECOR_PANE, 460, 'map-pane-decor'], [TOOL_PANE, 650, 'map-pane-tools']]) {
    const pane = S.map.createPane(name);
    pane.style.zIndex = String(z);
    pane.classList.add(cls);
  }
  S.layer = L.layerGroup().addTo(S.map);
  zoomer = createZoomer(S.map);

  S.canvas.addEventListener('wheel', (e) => zoomer.onWheel(e), { passive: false });
  S.canvas.addEventListener('touchstart', (e) => { if (e.touches.length > 1) zoomer.cancel(); }, { passive: true });
  S.map.on('dblclick', (e) => {
    if (S.mode === 'measuring') { decor.finishMeasure(); return; }
    if (S.mode === 'idle' && !editing()) zoomer.zoomBy(e.originalEvent.shiftKey ? -1 : 1, e.containerPoint, 90);
  });
  S.map.on('mousemove', (e) => { if (S.mode === 'measuring') decor.measureHover(toXY(e.latlng)); });
  S.map.on('dragstart', () => zoomer.cancel());
  S.map.on('click', onMapClick);
  S.map.on('contextmenu', onContextMenu);
  S.map.on('zoom', () => { updateRanks(); decor.onZoom(); });
  S.map.on('move viewreset', cull);
  S.map.on('zoomstart', () => S.root.classList.add('is-zooming'));
  S.map.on('zoomend', onZoomEnd);
  S.map.on('movestart zoomstart', () => closeCtx());
  S.map.on('moveend', saveView);
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(S.canvas);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKeyCapture, true);
  document.addEventListener('keydown', onKey);
  store.on(onStore);
  // the fog's wash follows the background, which follows the light / dark theme by default
  new MutationObserver(() => fogV.sync({ animate: false })).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  onDmMode(() => { // DM mode on / off: lock marks, the fog seen through or not, the design tabs, the map's switch
    editor.dmChanged();
    fogV.sync({ animate: false });
    syncMarkers();
    pictures.sync();
    drawer.refresh({ force: true });
    crumbs.update();
    menu.pop.refresh();
  });
  init();
}

async function init() {
  try {
    await Promise.all([data.typesReady(), glyphsReady]);
  } catch (e) {
    console.error('[map] init failed', e);
  }
  const r = S.pendingRoute;
  S.pendingRoute = null;
  const want = r ? routeTarget(r) : { map: data.MAIN_MAP };
  const first = want.loc ? data.findLocation(want.loc, { loose: true })?.map : data.findMap(want.map, { loose: true })?.id;
  try {
    await loadMap((data.mapById(first) && first) || data.homeMapId() || data.MAIN_MAP); // main hidden from this viewer: a map of its own
  } catch (e) {
    console.error('[map] init failed', e);
    toast(`The map could not load: ${e.message}`, { type: 'error' });
  }
  S.ready = true;
  updateEmpty();
  if (r) await applyRoute(r, true);
  newMapAsked();
}

// ---------- maps / image / config ----------

function measure(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Make id the active map: markers, image, view, controls. */
async function loadMap(id) {
  const m = data.mapById(id) || data.mapById(data.MAIN_MAP) || data.mainMap(); // mainMap: hidden from this viewer
  editor.flush();
  S.mapId = m.id;
  S.mapParent = m.parent;
  S.selectedId = null;
  S.match = null;
  for (const e of S.markers.values()) e.marker.remove();
  S.markers.clear();
  S.root.classList.toggle('is-submap', !m.isMain);
  syncUnrevealed();
  crumbs.update();
  decor.reset();
  pictures.clear();
  fogV.clear();
  S.designDraft = null;
  S.cropping = false;
  await applyConfig({ initial: true });
  pictures.sync();
  syncMarkers();
  search.refresh();
  editor.mapChanged();
  menu.pop.refresh();
  updateEmpty();
}

async function switchMap(id) {
  if (id === S.mapId) return true;
  if (!(await drawer.confirmLeave())) return false;
  if (S.mode === 'moving') finishMove(false);
  cancelPlacing();
  stopMeasure();
  cancelPicking();
  removeGhost();
  resetPreview();
  closeCtx();
  closePopovers();
  zoomer.cancel();
  if (drawer.isOpen) { drawer.close(); setDrawerOpen(false); }
  saveView.flush();
  await loadMap(id);
  return true;
}

async function applyConfig({ initial = false } = {}) {
  const token = ++S.cfgToken;
  const mapId = S.mapId;
  const cfg = await data.effectiveConfig(mapId);
  let url = cfg.image;
  if (url.startsWith('content/')) {
    url = await store.fileUrl(url).catch(() => null);
    if (!url) {
      if (token === S.cfgToken) toast(`The image of “${cfg.name}” (${cfg.image}) is missing, so the placeholder is shown.`, { type: 'error' });
      url = data.PLACEHOLDER_IMAGE;
      cfg.isPlaceholder = true;
      if (!(cfg.width > 0 && cfg.height > 0)) Object.assign(cfg, await data.placeholderSize());
    }
  }
  if (!(cfg.width > 0 && cfg.height > 0)) Object.assign(cfg, (await measure(url)) || data.DEFAULT_SIZE);
  if (token !== S.cfgToken || !S.map || mapId !== S.mapId) return;

  const resized = cfg.width !== S.size.w || cfg.height !== S.size.h;
  S.info = cfg;
  S.bands = cfg.bands;
  S.size = { w: cfg.width, h: cfg.height };
  S.design = { ...cfg.design, crop: normCrop(cfg.design.crop, cfg.width, cfg.height) };
  if (S.designDraft) S.designDraft = { ...S.designDraft, crop: normCrop(S.designDraft.crop, cfg.width, cfg.height) };
  S.imageUrl = url;
  applyGeometry();
  setImage(url, cfg);
  S.root.classList.toggle('is-placeholder', cfg.isPlaceholder);
  updateZoomLimits();
  if (initial) restoreView();
  else if (resized) fitMap(false);
  updateRanks();
  menu.pop.refresh();
  crumbs.update();
  editor.refresh();
  decor.update();
  fogV.sync({ animate: !initial });
  updateMeasureBtn();
}

/** The part of the image shown (the design's crop, or all of it; all of it while the crop is being adjusted). */
function shownRect() {
  const c = !S.cropping && design().crop;
  return c ? { ...c } : { x: 0, y: 0, w: S.size.w, h: S.size.h };
}

/** S.view = the shown part of the image; S.bounds = that plus the border: what "Show the whole map" fits. */
function applyGeometry() {
  const r = shownRect();
  S.view = r;
  const pad = decorOff() || S.cropping ? 0 : borderPad(design().border, r);
  S.bounds = L.latLngBounds([[-(r.y + r.h + pad), r.x - pad], [-(r.y - pad), r.x + r.w + pad]]);
  fogV?.clipTo(r);
}

/** The design draft changed (Design tab) or the device setting: crop, bounds, decorations. */
function refreshDesign() {
  if (!S.map || !S.info) return;
  applyGeometry();
  setImage(S.imageUrl, S.info);
  updateZoomLimits();
  decor.update();
  updateMeasureBtn();
}

/** Show the map image as pre-rendered tiles (falls back to a plain <img> overlay), clipped to the crop. */
function setImage(url, cfg) {
  const crop = S.cropping ? null : design().crop;
  const key = `${url}\u0000${cfg.width}x${cfg.height}\u0000${crop ? [crop.x, crop.y, crop.w, crop.h].join(',') : ''}`;
  if (key === S.imageKey) return;
  S.imageKey = key;
  if (S.image) { S.image.remove(); S.image = null; }
  const done = () => { clearTimeout(S.loadTimer); S.root.classList.remove('is-loading-image'); };
  clearTimeout(S.loadTimer);
  S.loadTimer = setTimeout(() => S.root.classList.add('is-loading-image'), 150); // only for slow images
  const svg = cfg.isPlaceholder || /\.svg$/i.test(cfg.image);
  loadImageSource(url, { width: cfg.width, height: cfg.height, svg }).then((src) => {
    if (S.imageKey !== key || !S.map) return;
    S.image = createImageLayer(src, { crop }).addTo(S.map);
    S.image.once('load', done);
    setTimeout(done, 3000);
  }).catch((e) => {
    console.warn('[map] tiled image failed; using a plain image', e);
    if (S.imageKey !== key || !S.map) return;
    S.image = L.imageOverlay(url, L.latLngBounds([[-cfg.height, 0], [0, cfg.width]]), { className: 'map-image', interactive: false, alt: '' }).addTo(S.map);
    S.image.on('error', () => toast('The map image could not be displayed.', { type: 'error' }));
    done();
  });
}

function updateZoomLimits() {
  if (!S.map || !S.bounds) return;
  const size = S.map.getSize();
  if (!size.x || !size.y) return;
  const bw = S.bounds.getEast() - S.bounds.getWest();
  const bh = S.bounds.getNorth() - S.bounds.getSouth();
  const fit = Math.log2(Math.min(size.x / bw, size.y / bh));
  S.fitZoom = Math.floor(fit * 4) / 4;
  S.map.setMinZoom(S.fitZoom - 0.75);
  S.map.setMaxZoom(Math.max(S.fitZoom + 4.5, 2)); // well past 1:1 for detail
  // Like setMaxBounds, minus its immediate animated pan: a fit/restore right after would stop that
  // pan, whose 'moveend' then started another pan that dragged the view off the new image.
  const m = S.map;
  m.off('moveend', m._panInsideMaxBounds);
  m.options.maxBounds = S.bounds.pad(0.25);
  m.on('moveend', m._panInsideMaxBounds);
  updateRanks();
  if (S.needsFit) { S.needsFit = false; restoreView(); }
}

function restoreView() {
  const size = S.map.getSize();
  if (!size.x || !size.y) { S.needsFit = true; return; }
  const v = prefs.views[S.mapId];
  if (v && v.w === S.size.w && v.h === S.size.h && [v.x, v.y, v.zoom].every(Number.isFinite)) {
    S.map.setView(toLatLng(v.x, v.y), Math.min(Math.max(v.zoom, S.map.getMinZoom()), S.map.getMaxZoom()), { animate: false });
  } else fitMap(false);
}

function fitMap(animate = true) {
  if (!S.bounds) return;
  zoomer?.cancel();
  const v = visibleRect();
  const size = S.map.getSize();
  const opts = { paddingTopLeft: [v.x0 + 8, 8], paddingBottomRight: [size.x - (v.x0 + v.w) + 8, size.y - (v.y0 + v.h) + 8] };
  if (animate && !reduceMotion()) S.map.flyToBounds(S.bounds, { ...opts, duration: 0.5 });
  else S.map.fitBounds(S.bounds, { ...opts, animate: false });
}

const saveView = debounce(() => {
  if (!S.ready || !S.visible || !S.map || !S.info) return;
  const c = toXY(S.map.getCenter());
  prefs.views[S.mapId] = { x: Math.round(c.x), y: Math.round(c.y), zoom: Math.round(S.map.getZoom() * 1000) / 1000, w: S.size.w, h: S.size.h };
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

function zoomStep(dir) {
  const v = visibleRect();
  zoomer.zoomBy(dir, L.point(v.x0 + v.w / 2, v.y0 + v.h / 2), 90);
}

// ---------- hierarchy (rank panes) ----------

/**
 * Bands are relative to the highest rank present (after filters) on this map: on a city map whose
 * most important places are rank 3, rank 3 uses the "fully zoomed out" band, rank 4 the next one.
 */
function updateShift() {
  let top = 4;
  let n = 0;
  for (const e of known()) {
    n++;
    if (e.rank < top && !S.hidden.has(e.type.id) && !S.hiddenRanks.has(e.rank)) top = e.rank;
  }
  S.rankShift = n ? top - 1 : 0;
}

/** Markers this viewer may know about (not under the fog for players): counts and hints use these. */
function* known() {
  for (const e of S.markers.values()) if (!fogHidesLoc(e.loc)) yield e;
}

/** The fog or who sees through it changed: every pin's visibility and marks. */
function refreshPins() {
  if (!S.map) return;
  for (const e of S.markers.values()) { updateVisibility(e); applyState(e); }
  updateShift();
  updateRanks();
  legend?.update();
  search?.refresh();
  editor?.refresh();
  updateEmpty();
}
const bandOf = (r) => Math.max(1, Math.min(4, r - (S.rankShift || 0)));

/** Pane opacities from the zoom: called every zoom frame, so it only touches 4 elements. */
function updateRanks() {
  if (!S.map || !S.panes[1]) return;
  const min = S.map.getMinZoom();
  const max = S.map.getMaxZoom();
  const u = max > min ? Math.min(1, Math.max(0, (S.map.getZoom() - min) / (max - min))) : 0;
  S.zoomU = u;
  const bands = S.bandPreview || S.bands;
  const showAll = S.allZoom || (editing() && !S.bandPreview);
  for (const r of RANK_IDS) {
    const band = rankOpacity(bandOf(r), u, bands);
    const op = Math.round((showAll ? 1 : band) * 40) / 40;
    const lbl = band >= 0.7 || (S.allZoom && !editing());
    const p = S.panes[r];
    if (S.paneOp[r] !== op) {
      S.paneOp[r] = op;
      p.style.opacity = op >= 1 ? '' : String(op);
      p.classList.toggle('is-off', op <= 0.025);
    }
    if (S.paneLbl[r] !== lbl) { S.paneLbl[r] = lbl; p.classList.toggle('has-labels', lbl); }
  }
}

/**
 * Pins far outside the view get display:none, so a zoom frame only moves the pins you can see.
 * (Measured: 400 pins zoomed in cost ~3 ms/frame of re-layerising in Chrome; culled, ~0.7 ms.)
 */
function cull() {
  if (!S.map || !S.markers.size) return;
  const mp = S.map._getMapPanePos();
  const size = S.map.getSize();
  const mx = 200;
  for (const e of S.markers.values()) {
    const el = e.marker._icon;
    const p = el?._leaflet_pos;
    if (!p) continue;
    const x = p.x + mp.x;
    const y = p.y + mp.y;
    const out = x < -mx || x > size.x + mx || y < -mx || y > size.y + mx;
    if (e.culled === out) continue;
    e.culled = out;
    e.marker._culled = out;
    if (!out) L.DomUtil.setPosition(el, p); // it skipped position writes while hidden
    el.classList.toggle('is-culled', out);
  }
}

function onZoomEnd() {
  S.root.classList.remove('is-zooming');
  cull();
  updateRanks();
  if (legend.pop.isOpen) legend.pop.refresh();
  editor.onZoom();
  updateEmpty();
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
  if (touches(data.MAP_DIR) || touches(data.MAPS_DIR)) { S.dirty.config = true; hit = true; }
  if (touches(data.JOURNAL_DIR)) { S.dirty.journal = true; hit = true; }
  if (touches(data.FOG_DIR)) { S.dirty.fog = true; hit = true; }
  if (touches(data.PIC_DIR)) { S.dirty.pics = true; hit = true; }
  if (hit && !S.syncQueued) { S.syncQueued = true; queueMicrotask(runSync); }
}

async function runSync() {
  S.syncQueued = false;
  if (!S.ready) return; // init does a full sync
  const d = S.dirty;
  S.dirty = { locs: false, types: false, config: false, journal: false, fog: false, pics: false };
  if (d.config && !data.mapById(S.mapId)) { // the map we are on was deleted, or the DM hid it from this viewer
    const up = (S.mapParent && data.mapById(S.mapParent)?.id) || data.homeMapId();
    if (up || S.mapId !== data.MAIN_MAP) { // else: stay on the hidden main map, "not revealed yet" (syncUnrevealed)
      const to = up || data.MAIN_MAP;
      if (S.visible) navigate(data.mapHref(to), { replace: true });
      else await switchMap(to); // another tab is shown: change maps quietly
      return;
    }
  }
  if (d.config) {
    syncUnrevealed();
    applyConfig().then(() => designPanel.refresh('design')).catch((e) => console.error('[map] config', e));
    crumbs.update();
  }
  if (d.types) await data.typesReady();
  if (d.fog) { fogV.sync(); designPanel.refresh('fog'); } // a reveal fades in
  if (d.pics) { pictures.sync(); designPanel.refresh('pictures'); }
  if (d.locs || d.types || d.config || d.fog) syncMarkers();
  if (drawer.mode === 'view') {
    const loc = data.locationById(drawer.id);
    if (!loc || loc.map !== S.mapId) {
      closeDrawer({ force: true });
      toast(loc ? 'That location moved to another map.' : 'That location was removed from the map.');
    } else {
      drawer.refresh({ force: d.types || d.config });
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
  const Pin = PinMarker();
  for (const loc of data.locationsOn(S.mapId)) {
    seen.add(loc.id);
    const type = data.typeOf(loc.type);
    const rank = data.rankOf(loc);
    const sub = !!(loc.submap && data.mapById(loc.submap));
    const sig = markerSig(loc, type, rank, sub);
    let e = S.markers.get(loc.id);
    if (!e) {
      e = { id: loc.id, marker: null, loc, type, rank, sub, sig };
      const marker = new Pin(toLatLng(loc.x, loc.y), {
        icon: pinIcon(loc, type, { selected: loc.id === S.selectedId, rank, sub }),
        keyboard: true, riseOnHover: true, riseOffset: HOVER_Z, pane: paneName(isPinned(e) ? 'pin' : rank),
        autoPan: true, autoPanPadding: L.point(60, 60),
      });
      e.marker = marker;
      const entry = e;
      marker.on('click', (ev) => onMarkerClick(entry, ev));
      marker.on('add', () => { applyState(entry); if (editing()) marker.dragging?.enable(); });
      marker.on('dragstart', () => { if (editing() && S.moveId !== entry.id) editor.dragStart(entry.id); });
      marker.on('drag', () => { if (editing() && S.moveId !== entry.id) editor.drag(entry.id); });
      marker.on('dragend', () => onMarkerDragEnd(entry));
      S.markers.set(loc.id, e);
    } else {
      const moving = (S.mode === 'moving' && S.moveId === loc.id) || editor.isDragging(loc.id);
      e.rank = rank;
      e.sub = sub;
      if (e.sig !== sig && loc.id !== S.previewId) {
        e.marker.options.pane = paneName(isPinned(e) ? 'pin' : rank);
        e.marker.setIcon(pinIcon(loc, type, { selected: loc.id === S.selectedId, rank, sub }));
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
  cull();
  updateShift();
  updateRanks();
  legend.update();
  search.refresh();
  updateEmpty();
  editor.refresh();
  crumbs.update();
}

/** Selected, moving, previewed and searched-for pins stay visible at every zoom and filter. */
function isPinned(e) {
  return e.id === S.selectedId || e.id === S.moveId || e.id === S.previewId || !!S.match?.has(e.id) || editor?.isSelected(e.id);
}

function applyState(e) {
  const el = e.marker.getElement();
  if (!el) return;
  const sel = e.id === S.selectedId;
  el.classList.toggle('is-selected', sel);
  el.classList.toggle('is-dimmed', !!S.match && !S.match.has(e.id) && !sel && !editing());
  el.classList.toggle('is-moving', S.moveId === e.id);
  el.classList.toggle('is-picked', editor.isSelected(e.id));
  el.classList.toggle('is-culled', !!e.culled);
  el.classList.toggle('is-fogged', seeThrough() && fogV.covers(e.loc.x, e.loc.y)); // the DM's view of a place under fog
  const secret = isHidden(data.locPath(e.id)); // DM mode: hidden from the players
  el.classList.toggle('is-dm-hidden', secret);
  el.setAttribute('aria-label', `${e.loc.name}, ${e.type.name}, rank ${e.rank}${e.sub ? ', has its own map' : ''}${secret ? ', hidden from players' : ''}`);
  el.removeAttribute('title');
  const name = paneName(isPinned(e) ? 'pin' : e.rank);
  e.marker.options.pane = name;
  const pane = S.map.getPane(name);
  if (el.parentNode !== pane) pane.appendChild(el);
}

function updateVisibility(e) {
  // A place under the fog is hidden from players (unless it was opened from a link), even in edit mode.
  const show = fogHidesLoc(e.loc) ? e.id === S.selectedId : editing() || isPinned(e) || (!S.hidden.has(e.type.id) && !S.hiddenRanks.has(e.rank));
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
    e.marker.setZIndexOffset(k === id ? SELECTED_Z : 0);
    updateVisibility(e);
    applyState(e);
  }
}

function setMatch(set) {
  S.match = set && set.size ? set : set ? new Set() : null;
  for (const e of S.markers.values()) { updateVisibility(e); applyState(e); }
  updateEmpty();
}

function typeCounts() {
  const m = new Map();
  for (const e of known()) m.set(e.type.id, (m.get(e.type.id) || 0) + 1);
  return m;
}

function rankCounts() {
  const m = new Map();
  for (const e of known()) m.set(e.rank, (m.get(e.rank) || 0) + 1);
  return m;
}

function allTypeIds() {
  return [...new Set([...data.allTypes().map((t) => t.id), ...typeCounts().keys()])];
}

function afterFilter() {
  savePrefs();
  for (const e of S.markers.values()) updateVisibility(e);
  updateShift();
  legend.update();
  updateRanks();
  updateEmpty();
}

function setHidden(ids) {
  S.hidden = new Set(ids);
  prefs.hidden = [...S.hidden];
  afterFilter();
}

function setHiddenRanks(ranks) {
  S.hiddenRanks = new Set([...ranks].map(Number));
  prefs.hiddenRanks = [...S.hiddenRanks];
  afterFilter();
}

function setAllZoom(on) {
  S.allZoom = !!on;
  prefs.allZoom = S.allZoom;
  afterFilter();
}

function toggleDecor() {
  prefs.decor = decorOff() ? true : false;
  savePrefs();
  refreshDesign();
  toast(decorOff() ? 'Compass, scale bar and border are hidden on this device. ⋯ shows them again.' : 'Compass, scale bar and border are shown again.');
}

function updateMeasureBtn() {
  if (!measureBtn) return;
  const s = design().scale;
  const ok = s.perPx > 0 && s.ruler;
  measureBtn.parentElement.hidden = !ok;
  if (!ok) stopMeasure();
}

/** The visible part of the map (beside the panels), in image px. */
function viewRect() {
  const v = visibleRect();
  const a = toXY(S.map.containerPointToLatLng([v.x0, v.y0]));
  const b = toXY(S.map.containerPointToLatLng([v.x0 + v.w, v.y0 + v.h]));
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

function toggleLabels() {
  prefs.labels = !labelsOn();
  savePrefs();
  S.root.classList.toggle('map-labels', prefs.labels);
  labelsBtn.setAttribute('aria-pressed', String(prefs.labels));
}

function updateEmpty() {
  if (!emptyCard) return;
  const idle = S.ready && S.mode === 'idle' && !drawer.isOpen && !editing();
  const n = [...known()].length;
  let key = '';
  let shown = 0;
  if (idle && n) {
    for (const e of S.markers.values()) if (S.layer.hasLayer(e.marker)) shown++;
  }
  let zoomHidden = 0;
  if (idle && shown && !S.allZoom) {
    let visible = 0;
    for (const e of S.markers.values()) {
      if (!S.layer.hasLayer(e.marker)) continue;
      if (isPinned(e) || (S.paneOp[e.rank] ?? 1) > 0.025) visible++;
      else zoomHidden++;
    }
    if (visible) zoomHidden = 0;
  }
  const fogged = !seeThrough() && fogActive(fogV.fog); // players: the fog may hide places, so don't call it unmarked
  if (idle && n === 0) key = fogged ? 'none:fog' : 'none';
  else if (idle && n > 0 && shown === 0) key = 'hidden';
  else if (zoomHidden) key = `zoom:${zoomHidden}`;
  if (key === S.emptyKey) return;
  S.emptyKey = key;
  emptyCard.hidden = !key;
  emptyCard.classList.toggle('is-hint', key.startsWith('zoom'));
  if (key.startsWith('none')) {
    mount(emptyCard,
      h('span', { class: 'map-empty-mark', 'aria-hidden': 'true' }, icon('pin')),
      fogged
        ? h('div', { class: 'map-empty-text' }, h('p', { class: 'map-empty-title' }, 'Fog still hides much of this map.'), h('p', null, 'Places appear as the fog clears. You can still add one yourself.'))
        : h('div', { class: 'map-empty-text' },
          h('p', { class: 'map-empty-title' }, S.mapId === data.MAIN_MAP ? 'The map is unmarked.' : 'This map is unmarked.'),
          h('p', null, 'Add the first location. You can also right-click (or long-press) anywhere on the map.')),
      h('button', { class: 'btn', type: 'button', onclick: startPlacing }, icon('plus'), h('span', null, 'Add location')));
  } else if (key === 'hidden') {
    mount(emptyCard,
      h('span', { class: 'map-empty-mark', 'aria-hidden': 'true' }, icon('filter')),
      h('div', { class: 'map-empty-text' },
        h('p', { class: 'map-empty-title' }, 'Every place is hidden.'),
        h('p', null, 'The filter is hiding all locations on this map.')),
      h('button', { class: 'btn', type: 'button', onclick: () => { setHidden([]); setHiddenRanks([]); } }, icon('eye'), h('span', null, 'Show everything')));
  } else if (key.startsWith('zoom')) {
    mount(emptyCard,
      h('span', { class: 'map-empty-mark', 'aria-hidden': 'true' }, icon('search')),
      h('p', { class: 'map-empty-text' }, `${zoomHidden === 1 ? 'One place appears' : `${zoomHidden} places appear`} at another zoom.`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setAllZoom(true) }, 'Show every rank'));
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

// ---------- sub-maps ----------

async function addSubmap({ fromLoc = null, name = '', title } = {}) {
  const id = await openNewMapDialog({ parent: S.mapId, fromLoc, name, title });
  if (id) navigate(data.mapHref(id));
  return id;
}

/** #/map?new=1 (the DM Screen's "New map"): the new-map dialog over the main map, once it has loaded. */
function newMapAsked() {
  if (!S.wantNewMap) return;
  S.wantNewMap = false;
  dmOnly('add maps', () => addSubmap({ title: 'New map' }))();
}

async function copyCurrentMap() {
  const id = await openCopyMapDialog(S.mapId, { fogHides: fogHidesLoc });
  if (id) navigate(data.mapHref(id));
}

async function deleteCurrentMap() {
  const parent = await deleteMapFlow(S.mapId);
  if (parent) navigate(data.mapHref(parent));
}

/** ⋯ → Move into another map… (map-wide editing: the DM only, or anyone while no DM is set up). */
async function moveCurrentMap() {
  if (!data.canDesign()) { toast('Only the DM can move maps.'); return; }
  if (await openMoveMapDialog(S.mapId)) { S.mapParent = data.mapById(S.mapId)?.parent ?? null; crumbs.update(); menu.pop.refresh(); }
}

// ---------- the main map hidden (DM mode) ----------

/**
 * Players (and the DM with DM mode locked) while the DM hides the main map: #/map shows the first map of its own
 * (applyRoute), or, when there is none, this "not revealed yet" card over the blank parchment, without the tools.
 */
function syncUnrevealed() {
  const on = S.mapId === data.MAIN_MAP && !data.mapById(data.MAIN_MAP);
  S.root.classList.toggle('is-unrevealed', on);
  if (unrevealedCard) unrevealedCard.hidden = !on;
  if (on) { closePopovers(); if (drawer?.isOpen) closeDrawer({ force: true }); }
}

/** The DM's question before hiding the main map: what goes with it, what stays. */
function mainHideQuestion() {
  const n = data.mainHideCounts();
  const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [n.image && 'its image', n.fog && 'its fog', n.places && plural(n.places, 'place'), n.pictures && plural(n.pictures, 'picture'),
    n.maps && `the ${plural(n.maps, 'map')} inside it (with everything on them)`].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const single = parts.length === 1 && (n.image || n.fog || [n.places, n.pictures, n.maps].includes(1));
  return [
    `Hide “${data.mapById(data.MAIN_MAP)?.name || data.DEFAULT_MAP_NAME}” from the players?`,
    list ? `${list[0].toUpperCase()}${list.slice(1)} go${single ? 'es' : ''} with it.` : '',
    n.own ? `${n.own === 1 ? 'The map of its own stays' : `The ${n.own} maps of their own stay`} visible, and players see ${n.own === 1 ? 'it' : 'the first'} on the Map tab instead.` : 'Players see “The DM hasn’t revealed the map yet.” on the Map tab.',
    'Releasing it brings all of that back (except what you had hidden on its own).',
  ].filter(Boolean).join(' ');
}

async function copyMapLink() {
  const m = data.mapById(S.mapId);
  if (!m) return;
  const text = data.mapLinkText(m);
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text} — paste it into any note.`, { type: 'success' });
  } catch {
    toast(`The link to this map is ${text}`, { timeout: 8000 });
  }
}

// ---------- edit mode ----------

/** Keep the view centered in the part of the map beside / above the edit panel. */
function recenterForPanel(opening, size) {
  if (!S.map) return;
  if (S.map.getZoom() <= S.fitZoom + 0.3) { fitMap(true); return; }
  const sheet = isSheet();
  const dx = sheet ? 0 : (size.w + 16) / 2;
  const dy = sheet ? size.h / 2 : 0;
  const k = opening ? 1 : -1;
  S.map.panBy([-dx * k, dy * k], { animate: !reduceMotion() });
}

async function toggleEdit(on = !editing(), tab = 'places') {
  if (on && editing()) { editor.setTab(tab); return; }
  if (on === editing()) return;
  const panel = { w: editor.el.offsetWidth, h: editor.el.offsetHeight }; // measured while still shown (closing)
  if (on) {
    if (drawer.isOpen && !(await closeDrawer())) return;
    if (S.mode === 'moving') finishMove(false);
    cancelPlacing();
    closePopovers();
    closeCtx();
    search.set('');
    stopMeasure();
    cancelPicking();
    editor.open(tab);
  } else if (editor.close()) {
    saveSoon(`map: edit “${info().name}”`); // edit mode has its own undo, so its changes commit once, on Done
  }
  S.root.classList.toggle('is-editing', on);
  addBtn.classList.toggle('btn-primary', !on && !drawer.isOpen); // "Done" is the primary action now
  if (on) requestAnimationFrame(() => recenterForPanel(true, { w: editor.el.offsetWidth, h: editor.el.offsetHeight }));
  else recenterForPanel(false, panel);
  S.bandPreview = null;
  for (const e of S.markers.values()) {
    updateVisibility(e);
    if (on) e.marker.dragging?.enable(); else e.marker.dragging?.disable();
    applyState(e);
  }
  updateRanks();
  legend.update();
  menu.pop.refresh();
  updateEmpty();
}

// ---------- crop, picking points (Design tab) ----------

/** Show the whole image with crop handles; change(rect) while dragging, commit(rect) on each release. */
function startCrop(rect, cbs) {
  S.cropping = true;
  refreshDesign();
  decor.startCrop(rect, cbs);
}
function stopCrop() {
  if (!S.cropping) return;
  S.cropping = false;
  decor.stopCrop();
  refreshDesign();
}

/** Ask for n clicks on the map (e.g. to set the scale). Resolves [{x, y}…] or null when canceled. */
function pickPoints(n, text) {
  cancelPicking();
  stopMeasure();
  return new Promise((resolve) => {
    S.pick = { n, pts: [], dots: [], resolve, text };
    S.mode = 'picking';
    S.root.classList.add('is-picking');
    showBanner(text, [{ label: 'Cancel', onClick: () => cancelPicking() }], `0 of ${n} points · Esc cancels`);
  });
}
function pickAt(xy) {
  const p = S.pick;
  if (!p) return;
  p.pts.push(xy);
  p.dots.push(L.circleMarker(toLatLng(xy.x, xy.y), { pane: TOOL_PANE, interactive: false, radius: 6, color: '#1f1a14', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).addTo(S.map));
  if (p.pts.length >= p.n) finishPicking(p.pts);
  else showBanner(p.text, [{ label: 'Cancel', onClick: () => cancelPicking() }], `${p.pts.length} of ${p.n} points · Esc cancels`);
}
function finishPicking(pts) {
  const p = S.pick;
  if (!p) return;
  S.pick = null;
  S.mode = 'idle';
  S.root.classList.remove('is-picking');
  hideBanner();
  for (const d of p.dots) d.remove();
  p.resolve(pts);
}
function cancelPicking() {
  if (!S.pick) return false;
  finishPicking(null);
  return true;
}

// ---------- ruler ----------

async function startMeasure() {
  closePopovers();
  closeCtx();
  if (drawer.isOpen && !(await closeDrawer())) return false;
  if (S.mode === 'moving') finishMove(false);
  cancelPlacing();
  cancelPicking();
  S.mode = 'measuring';
  decor.startMeasure();
  measureBtn.setAttribute('aria-pressed', 'true');
  showBanner('Click points on the map to measure the distance.', [{ label: 'Done', onClick: () => stopMeasure() }], 'Double-click or Enter ends a path · Esc stops');
  updateEmpty();
  return true;
}
function stopMeasure() {
  if (S.mode !== 'measuring') return false;
  S.mode = 'idle';
  decor.stopMeasure();
  measureBtn.setAttribute('aria-pressed', 'false');
  hideBanner();
  updateEmpty();
  return true;
}

// ---------- selection, drawer, hash ----------

/** The drawer brings its own primary action, so the toolbar's Add button steps down to secondary. */
function setDrawerOpen(on) {
  S.root.classList.toggle('has-drawer', on);
  addBtn.classList.toggle('btn-primary', !on && !editing());
}

function setHash(id) {
  if (!S.visible || current().view !== 'map') return;
  const loc = id && data.locationById(id);
  const target = loc ? data.locHref(loc) : data.mapHref(S.mapId);
  if (location.hash !== target) history.replaceState(history.state, '', target);
}

/** The part of the map not covered by the toolbar, the drawer and the edit panel. */
function visibleRect() {
  const size = S.map.getSize();
  const top = 64; // floating toolbar
  let x0 = 0;
  let w = size.x;
  let hh = size.y;
  if (drawer.isOpen) {
    if (isSheet()) hh -= drawer.el.offsetHeight;
    else w -= drawer.el.offsetWidth + 16;
  }
  if (editing()) {
    if (isSheet()) hh -= editor.el.offsetHeight;
    else { const ew = editor.el.offsetWidth + 16; x0 += ew; w -= ew; }
  }
  return { x0, y0: top, w: Math.max(w, 120), h: Math.max(hh - top, 120) };
}

/** Map center that puts latlng in the middle of the part of the map not covered by panels. */
function centerFor(ll, zoom) {
  const v = visibleRect();
  const size = S.map.getSize();
  const off = L.point(size.x / 2 - (v.x0 + v.w / 2), size.y / 2 - (v.y0 + v.h / 2));
  return S.map.unproject(S.map.project(ll, zoom).add(off), zoom);
}

function flyToLoc(loc) {
  zoomer.cancel();
  const ll = toLatLng(loc.x, loc.y);
  const min = S.map.getMinZoom();
  const max = S.map.getMaxZoom();
  // Close enough that the place's own rank band is showing.
  const [a, z] = (S.bands[bandOf(data.rankOf(loc)) - 1] || [0, 100]).map((v) => min + ((max - min) * v) / 100);
  const lo = Math.max(S.fitZoom + 1.5, a + 0.1);
  const zoom = Math.min(max - 0.5, Math.max(S.map.getZoom(), lo), Math.max(z - 0.2, lo));
  const c = centerFor(ll, zoom);
  if (reduceMotion()) S.map.setView(c, zoom, { animate: false });
  else S.map.flyTo(c, zoom, { duration: 0.8 });
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
  if (loc.map !== S.mapId) { navigate(data.locHref(loc)); return true; } // the router switches maps
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
  // A new place is a big change and commits right away; edits to an existing one follow the auto-save timer.
  const hint = isNew ? saveHint() : getSetting('autoCommit') ? 'It will be committed automatically.' : 'Press Save to share it with the party.';
  toast(`${isNew ? `Added “${loc.name}” to the map.` : `Saved “${loc.name}”.`} ${hint}`.trim(), { type: 'success' });
  if (isNew) saveSoon(`map: new place “${loc.name}”`);
}

/** Live preview of the type/name/rank being edited, on the ghost pin (new) or the real marker (edit). */
function previewMarker(f) {
  const type = data.typeOf(f.type);
  const rank = f.rank || type.rank || 3;
  const sub = !!(f.submap && data.mapById(f.submap));
  if (drawer.mode === 'new' && S.ghost) {
    S.ghost.setIcon(pinIcon({ name: f.name.trim() || 'New location' }, type, { ghost: true, selected: true, rank, sub }));
    return;
  }
  if (drawer.mode === 'edit') {
    const e = S.markers.get(drawer.id);
    if (!e) return;
    S.previewId = e.id;
    e.marker.options.pane = paneName('pin');
    e.marker.setIcon(pinIcon({ name: f.name.trim() || e.loc.name }, type, { selected: true, rank, sub }));
    applyState(e);
  }
}

function resetPreview() {
  const id = S.previewId;
  S.previewId = null;
  const e = id && S.markers.get(id);
  if (!e) return;
  e.marker.setIcon(pinIcon(e.loc, e.type, { selected: id === S.selectedId, rank: e.rank, sub: e.sub }));
  e.sig = markerSig(e.loc, e.type, e.rank, e.sub);
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
  showBanner('Click the map where the new location should go.', [{ label: 'Cancel', onClick: cancelPlacing }], 'Enter drops it at the center · Esc cancels');
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
  const type = data.typeOf(typeId);
  S.ghost = L.marker(toLatLng(xy.x, xy.y), {
    icon: pinIcon({ name: 'New location' }, type, { ghost: true, selected: true, rank: type.rank }),
    draggable: true, keyboard: false, zIndexOffset: HOVER_Z, pane: paneName('pin'),
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

// ---------- moving (single pin, from the drawer) ----------

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
    if (!editing()) e.marker.dragging?.disable();
    if (save) {
      const p = clampXY(toXY(e.marker.getLatLng()));
      const was = toXY(from);
      if (Math.abs(p.x - was.x) > 0.01 || Math.abs(p.y - was.y) > 0.01) {
        data.saveLocation({ ...e.loc, x: p.x, y: p.y });
        toast(`Moved “${e.loc.name}”.`, { type: 'success' });
        saveSoon(`map: move “${e.loc.name}”`);
      }
    } else e.marker.setLatLng(from);
    updateVisibility(e);
    applyState(e);
  }
  drawer.setMoving(false);
  updateEmpty();
}

function onMarkerDragEnd(e) {
  if (editing() && S.moveId !== e.id) { editor.dragEnd(e.id); return; }
  if (S.moveId !== e.id) return;
  const p = clampXY(toXY(e.marker.getLatLng()));
  e.marker.setLatLng(toLatLng(p.x, p.y));
}

// ---------- map events ----------

function onMarkerClick(e, ev) {
  closeCtx();
  if (S.mode === 'measuring') { decor.measureAt({ x: e.loc.x, y: e.loc.y }); return; }
  if (S.mode === 'picking') { pickAt({ x: e.loc.x, y: e.loc.y }); return; }
  if (S.mode === 'placing') { placeAt(ev.latlng); return; }
  if (S.mode === 'moving') return;
  if (editing()) { editor.onMarkerClick(e.id, ev.originalEvent); return; }
  openLocation(e.id);
}

function onMapClick(ev) {
  if (closeCtx() || Date.now() - S.ctxClosedAt < 350) return;
  if (S.mode === 'measuring') { decor.measureAt(toXY(ev.latlng)); return; }
  if (S.mode === 'picking') { pickAt(toXY(ev.latlng)); return; }
  if (S.mode === 'placing') { placeAt(ev.latlng); return; }
  const p = clampXY(toXY(ev.latlng));
  if (S.mode === 'moving') { S.markers.get(S.moveId)?.marker.setLatLng(toLatLng(p.x, p.y)); return; }
  if (drawer.mode === 'new' && S.ghost) { S.ghost.setLatLng(toLatLng(p.x, p.y)); drawer.setPosition(p); return; }
  if (drawer.mode === 'view') { closeDrawer(); return; }
  if (editing() && S.designTab === 'pictures') { pictures.select(null); return; }
  if (editing() && !(ev.originalEvent?.ctrlKey || ev.originalEvent?.metaKey || ev.originalEvent?.shiftKey)) editor.clearSelection();
}

function onContextMenu(ev) {
  if (S.mode === 'moving' || S.mode === 'picking') return;
  if (S.mode === 'measuring') { decor.finishMeasure(); return; }
  if (S.mode === 'placing') { placeAt(ev.latlng); return; }
  openCtx(ev.containerPoint, ev.latlng);
}

function openCtx(pt, ll) {
  closeCtx();
  closePopovers();
  const xy = clampXY(toXY(ll));
  const item = (ic, label, fn) => h('button', { type: 'button', class: 'map-menu-item', role: 'menuitem', onclick: () => { closeCtx(); fn(); } },
    icon(ic), h('span', { class: 'map-menu-text' }, h('span', null, label)));
  ctxMenu = h('div', { class: 'map-ctx', role: 'menu', 'aria-label': 'Map actions' },
    item('plus', 'Add location here', () => beginNewAt(xy)),
    item('pin', 'Center the map here', () => S.map.panTo(ll, { animate: !reduceMotion() })),
    item('compass', 'Show the whole map', () => fitMap(true)),
    design().scale.perPx > 0 && design().scale.ruler ? item('ruler', 'Measure from here', () => startMeasure().then((ok) => ok && decor.measureAt(toXY(ll)))) : null,
    editing() ? null : item('edit', 'Edit map', () => toggleEdit(true)));
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

/** Capture phase: edit-mode keys (arrow nudges) must win over Leaflet's arrow-key panning. */
function onKeyCapture(e) {
  if (!S.visible || !S.map || !editing()) return;
  if (editor.onKey(e)) { e.preventDefault(); e.stopPropagation(); }
}

function onKey(e) {
  if (!S.visible || !S.map) return;
  if (e.key === 'Escape') {
    if (e.defaultPrevented || document.querySelector('.modal-backdrop')) return;
    if (closeCtx()) { e.preventDefault(); S.canvas.focus({ preventScroll: true }); return; }
    if (closePopovers()) { e.preventDefault(); return; }
    if (S.mode === 'picking') { e.preventDefault(); cancelPicking(); return; }
    if (S.mode === 'measuring') { e.preventDefault(); stopMeasure(); return; }
    if (S.cropping) { e.preventDefault(); stopCrop(); designPanel.refresh('design'); return; }
    if (S.mode === 'placing') { e.preventDefault(); cancelPlacing(); return; }
    if (S.mode === 'moving') { e.preventDefault(); finishMove(false); return; }
    if (drawer.isOpen) { e.preventDefault(); closeDrawer(); return; }
    if (editing()) { e.preventDefault(); if (!editor.clearSelection()) toggleEdit(false); }
    return;
  }
  if (document.querySelector('.modal-backdrop')) return;
  const t = e.target;
  const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!(S.root.contains(t) || t === document.body)) return;
  const onButton = t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement;
  if (e.key === 'Enter' && !onButton && S.mode === 'placing') { e.preventDefault(); placeAtCenter(); return; }
  if (e.key === 'Enter' && !onButton && S.mode === 'moving') { e.preventDefault(); finishMove(true); return; }
  if (e.key === 'Enter' && !onButton && S.mode === 'measuring') { e.preventDefault(); decor.finishMeasure(); return; }
  if (e.key === '/') { e.preventDefault(); search.focus(); return; }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(e.shiftKey && e.key === '=' ? 2 : 1); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(e.key === '_' ? -2 : -1); }
}

// ---------- routes ----------
// #/map                         main map
// #/map/loc/<id>                a place (on whatever map it is; sub-map places get the long form)
// #/map/m/<mapId>[/loc/<id>]    a sub-map, optionally with one of its places open
// #/map?new=1                   the main map with the new-map dialog open (DM Screen "New map")

function routeTarget(parts = []) {
  const [a, b, c, d] = parts;
  if (a === 'loc' && b) return { map: null, loc: b };
  if (a === 'm' && b) return { map: b, loc: c === 'loc' && d ? d : null };
  return { map: data.MAIN_MAP, loc: null };
}

async function applyRoute(parts, fly) {
  const r = routeTarget(parts);
  let mapId = r.map;
  let loc = null;
  if (r.loc) {
    loc = data.findLocation(r.loc, { loose: true, map: r.map && r.map !== data.MAIN_MAP ? (data.findMap(r.map, { loose: true })?.id || null) : null })
      || data.findLocation(r.loc, { loose: true });
    if (!loc) {
      toast(`There is no “${r.loc}” on the map.`, { type: 'error' });
      setHash(drawer.mode === 'view' ? drawer.id : null);
      return;
    }
    mapId = loc.map;
  } else if (mapId !== data.MAIN_MAP) {
    const m = data.findMap(mapId, { loose: true });
    if (!m) {
      toast(`There is no map called “${mapId}”.`, { type: 'error' });
      setHash(drawer.mode === 'view' ? drawer.id : null);
      return;
    }
    mapId = m.id;
  }
  if (mapId === data.MAIN_MAP && !data.mapById(data.MAIN_MAP)) { // the DM hides the main map from this viewer
    const home = data.homeMapId();
    if (home) { navigate(data.mapHref(home), { replace: true }); return; } // the first map of its own
    loc = null; // else "not revealed yet" (syncUnrevealed)
  }
  if (mapId !== S.mapId) {
    if (!(await switchMap(mapId))) { setHash(drawer.mode === 'view' ? drawer.id : null); return; }
    fly = true;
  }
  if (loc) {
    if (drawer.mode === 'view' && drawer.id === loc.id) {
      setHash(loc.id);
      if (fly) flyToLoc(loc);
      return;
    }
    openLocation(loc.id, { fly: true });
  } else {
    if (drawer.mode === 'view') closeDrawer({ force: true });
    setHash(null);
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
  const parts = route?.parts || [];
  if (route?.query?.new) { S.wantNewMap = true; history.replaceState(null, '', '#/map'); } // asked once: Back or reload don't reopen it
  if (!S.ready) { S.pendingRoute = parts; return; }
  applyRoute(parts, fromElsewhere).then(newMapAsked);
}

function hideView() {
  S.visible = false;
  cancelPlacing();
  stopMeasure();
  cancelPicking();
  closeCtx();
  closePopovers();
  zoomer?.cancel();
}

export default {
  id: 'map',
  title: 'Map',
  icon: 'map',
  mount: mountView,
  show: showView,
  hide: hideView,
};
