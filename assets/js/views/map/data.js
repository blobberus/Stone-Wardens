// Map data layer: maps (the main map + nested sub-maps), location documents, location types (built-in +
// custom), backlinks from the journal, and the [[map:…]] link type (registered at import).
// Layout: content/map/config.json = the main map; content/maps/<mapId>.json = a sub-map, its image in
// content/maps/<mapId>/; content/locations/<id>.json = a place ("map" field = its sub-map, absent = main);
// content/map-pictures/<id>.json = a picture laid on a map; content/fog/<mapId>.json = a map's fog of war.
// DM mode: a hidden map (the main map too) takes its places, image, pictures, fog and sub-maps with it (companions),
// and whatever is added to a hidden map starts hidden. A sub-map document with `parent: null` is a map of its own
// (maptree.js). While the main map is hidden, content/map/hidden.json ({hidden: true}, public) tells players' devices
// so, and the Map tab shows a map of its own instead. See docs/map-model.md and docs/map-design.md.
import { store } from '../../core/store.js';
import { registerLinkType, matchNames } from '../../core/links.js';
import { entries } from '../../core/compendium.js';
import { extractLinks, parseFrontmatter } from '../../core/markdown.js';
import { href } from '../../core/router.js';
import { uid, nameKey, slugify, byName, baseName } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';
import { registerHideable, isHidden, hideItem, isDm, dmConfigured, onDmMode } from '../../core/dm.js';
import { validRank, normBands } from './ranks.js';
import { normDesign } from './design.js';
import { FOG_DIR, fogPath, normFog, scaleAreas, fogCovers } from './fog.js';
import { mapTree, canMoveInto } from './maptree.js';
import { linkTwins, sharedOf, sharedDiffer } from './twins.js';

export const LOC_DIR = 'content/locations';
export const MAP_DIR = 'content/map';
export const MAPS_DIR = 'content/maps';
export const CONFIG_PATH = `${MAP_DIR}/config.json`;
/** Public marker while the DM hides the main map: it says only that (players can't read the sealed map). */
export const MAIN_HIDDEN_PATH = `${MAP_DIR}/hidden.json`;
export const MAIN_MAP = 'main';
export const TYPE_KIND = 'location-type';
export const TYPE_DIR = `content/library/${TYPE_KIND}`;
export const JOURNAL_DIR = 'content/journal';
export const PIC_DIR = 'content/map-pictures';
export const PIC_MEDIA = 'content/media/map-pictures';
export { FOG_DIR, fogPath };
export const PLACEHOLDER_IMAGE = 'assets/img/placeholder-map.svg';
export const DEFAULT_SIZE = { width: 4000, height: 3000 };
export const DEFAULT_MAP_NAME = 'The Uncharted Realm';

export const MARKER_ICONS = [
  'city', 'town', 'village', 'temple', 'danger', 'dungeon', 'ruins', 'castle', 'port', 'camp',
  'cave', 'forest', 'mountain', 'landmark', 'tavern', 'shop', 'portal', 'battle', 'quest', 'custom',
].map((n) => `mk-${n}`);

// Pin pigments: mirror of the --pin-* tokens in tokens.css (identical in both themes, since the map
// image does not change). Docs store the hex; pins render var(--pin-<key>) when the hex is a pigment.
export const PIGMENTS = [
  { key: 'vermilion', name: 'Vermilion', hex: '#a8321c' },
  { key: 'rubric', name: 'Oxblood', hex: '#8e1b1b' },
  { key: 'umber', name: 'Umber', hex: '#5c4a36' },
  { key: 'ochre', name: 'Ochre', hex: '#82600f' },
  { key: 'gold', name: 'Gold', hex: '#8f6a14' },
  { key: 'green', name: 'Terre verte', hex: '#3b6b2a' },
  { key: 'verdigris', name: 'Verdigris', hex: '#23675f' },
  { key: 'lapis', name: 'Lapis', hex: '#22507c' },
  { key: 'slate', name: 'Slate', hex: '#465266' },
  { key: 'murrey', name: 'Murrey', hex: '#6e3a5c' },
  { key: 'ink', name: 'Iron-gall ink', hex: '#1f1a14' },
];
const PIGMENT_BY_HEX = new Map(PIGMENTS.map((p) => [p.hex, p]));
const pig = (key) => PIGMENTS.find((p) => p.key === key).hex;
export const SWATCHES = PIGMENTS.map((p) => p.hex);
export const FALLBACK_COLOR = pig('slate');

// rank = the default hierarchy rank (1-4, see ranks.js) for places of this type that have no rank of
// their own. Danger is the only vermilion pin so it reads as the loud one.
export const BUILTIN_TYPES = [
  { id: 'city', name: 'City', color: pig('murrey'), rank: 1 },
  { id: 'town', name: 'Town', color: pig('lapis'), rank: 2 },
  { id: 'village', name: 'Village', color: pig('ochre'), rank: 3 },
  { id: 'castle', name: 'Castle', color: pig('slate'), rank: 2 },
  { id: 'temple', name: 'Temple', color: pig('gold'), rank: 3 },
  { id: 'port', name: 'Port', color: pig('verdigris'), rank: 2 },
  { id: 'danger', name: 'Danger', color: pig('vermilion'), rank: 3 },
  { id: 'dungeon', name: 'Dungeon', color: pig('ink'), rank: 3 },
  { id: 'ruins', name: 'Ruins', color: pig('umber'), rank: 3 },
  { id: 'cave', name: 'Cave', color: pig('umber'), rank: 3 },
  { id: 'camp', name: 'Camp', color: pig('green'), rank: 4 },
  { id: 'forest', name: 'Forest', color: pig('green'), rank: 2 },
  { id: 'mountain', name: 'Mountain', color: pig('slate'), rank: 2 },
  { id: 'landmark', name: 'Landmark', color: pig('murrey'), rank: 3 },
  { id: 'tavern', name: 'Tavern', color: pig('ochre'), rank: 4 },
  { id: 'shop', name: 'Shop', color: pig('verdigris'), rank: 4 },
  { id: 'portal', name: 'Portal', color: pig('lapis'), rank: 3 },
  { id: 'battle', name: 'Battlefield', color: pig('rubric'), rank: 3 },
  { id: 'quest', name: 'Quest', color: pig('gold'), rank: 3 },
  { id: 'other', name: 'Other', color: pig('ink'), rank: 3, icon: 'mk-custom' },
].map((t) => withPaint({ icon: `mk-${t.id}`, ...t, builtin: true, custom: false }));
const BUILTIN = new Map(BUILTIN_TYPES.map((t) => [t.id, t]));

/** Adds css (what goes into --pin) and light (pale pin -> dark glyph) to a type. */
export function withPaint(t) {
  const p = PIGMENT_BY_HEX.get(String(t.color).toLowerCase());
  t.css = p ? `var(--pin-${p.key})` : t.color;
  t.light = !p && luminance(t.color) > 0.42;
  return t;
}

function luminance(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return 0;
  const hex = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/-]+\))$/i;
export function safeColor(c, fallback = FALLBACK_COLOR) {
  const s = String(c || '').trim();
  if (!COLOR_RE.test(s)) return fallback;
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', s)) return fallback;
  return s;
}

export function safeIcon(name, fallback = 'mk-custom') {
  let s = String(name || '').trim().replace(/^#?i-/, '');
  if (s && !s.startsWith('mk-')) s = `mk-${s}`;
  return MARKER_ICONS.includes(s) ? s : fallback;
}

const prettify = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v) => Math.round(num(v) * 100) / 100;
const isObj = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- location types ----------

let customTypes = [];
let typeIndex = null;
let typesPromise = null;

/**
 * Default rank of a custom type: its own rank, else the older "major" flag, else the built-in's.
 * The compendium editor still toggles `major`, so a contradicting flag wins over a stale rank.
 */
function typeRank(c, base) {
  const minor = base?.rank && base.rank !== 1 ? base.rank : 2;
  const r = validRank(c.rank);
  if (c.major === true) return 1;
  if (c.major === false && (r === 1 || !r)) return r === 1 ? minor : (base?.rank === 1 ? 2 : base?.rank || 3);
  return r || base?.rank || 3;
}

function normType(c, base) {
  return withPaint({
    id: String(c.id),
    name: String(c.name || base?.name || prettify(c.id)),
    icon: safeIcon(c.icon, base?.icon || 'mk-custom'),
    color: safeColor(c.color, base?.color || FALLBACK_COLOR),
    rank: typeRank(c, base),
    builtin: !!base,
    custom: true,
    entry: c,
  });
}

function typeMap() {
  if (!typeIndex) {
    const m = new Map(BUILTIN);
    for (const c of customTypes) if (c?.id) m.set(String(c.id), normType(c, BUILTIN.get(String(c.id))));
    typeIndex = m;
  }
  return typeIndex;
}

/** Re-read custom types (compendium kind 'location-type'). Resolves the merged list. */
export function refreshTypes() {
  typesPromise = entries(TYPE_KIND)
    .then((list) => { customTypes = list.filter((t) => t && t.id); typeIndex = null; })
    .catch((e) => console.warn('[map] location types unavailable', e))
    .then(() => allTypes());
  return typesPromise;
}
export const typesReady = () => typesPromise || refreshTypes();

/** Built-ins first (in their curated order), then custom types by name. */
export function allTypes() {
  const m = typeMap();
  const builtins = BUILTIN_TYPES.map((t) => m.get(t.id));
  const customs = [...m.values()].filter((t) => !BUILTIN.has(t.id)).sort(byName);
  return [...builtins, ...customs];
}

export function typeOf(id) {
  const m = typeMap();
  const key = String(id || '');
  const hit = m.get(key) || m.get(key.toLowerCase());
  if (hit) return hit;
  if (key) {
    const k = nameKey(key);
    for (const t of m.values()) if (nameKey(t.name) === k) return t;
  }
  return withPaint({ id: key || 'other', name: key ? prettify(key) : 'Other', icon: 'mk-custom', color: FALLBACK_COLOR, rank: 3, missing: true, builtin: false, custom: false });
}

// ---------- maps ----------

let mapIndex = null;

export const mapPath = (id) => (id === MAIN_MAP ? CONFIG_PATH : `${MAPS_DIR}/${id}.json`);
/** Folder for a map's uploaded image. */
export const mapImageDir = (id) => (id === MAIN_MAP ? MAP_DIR : `${MAPS_DIR}/${id}`);

export function readConfig() {
  const c = store.get(CONFIG_PATH);
  return isObj(c) ? c : {};
}

/**
 * Is the main map hidden from this viewer? The DM hid it (the public marker is there) and this device can't read it:
 * a player, or the DM with DM mode locked. In DM mode it shows (with a lock) once its envelope is open.
 */
export const mainUnrevealed = () => !isDm() && !store.has(CONFIG_PATH) && store.has(MAIN_HIDDEN_PATH);

function mapsIdx() {
  if (mapIndex) return mapIndex;
  const cfg = readConfig();
  const gone = mainUnrevealed();
  const main = { id: MAIN_MAP, isMain: true, parent: null, standalone: false, unrevealed: gone, name: String(cfg.name || '').trim() || DEFAULT_MAP_NAME, path: CONFIG_PATH, image: cfg.image || '', rankBands: cfg.rankBands };
  const subs = [];
  for (const { path, data: d } of store.list(MAPS_DIR)) {
    if (!path.endsWith('.json') || !isObj(d)) continue;
    const id = baseName(path).replace(/\.json$/i, '');
    if (!id || id === MAIN_MAP) continue;
    subs.push({ ...d, id, isMain: false, parent: d.parent === null ? null : d.parent, name: String(d.name || '').trim() || 'Unnamed map', path, image: d.image || '' });
  }
  // parents: unknown / self / loops = the main map; null = a map of its own (maptree.js)
  const tree = mapTree(subs, { mainShown: !gone, compare: byName });
  for (const m of subs) { m.parent = tree.parent.get(m.id); m.standalone = m.parent === null; }
  const all = new Map([[MAIN_MAP, main], ...subs.map((m) => [m.id, m])]);
  const list = tree.order.map(({ id, depth }) => Object.assign(all.get(id), { depth }));
  const byId = new Map(list.map((m) => [m.id, m])); // the main map is not there while it is hidden from this viewer
  const byKey = new Map();
  const bySlug = new Map();
  for (const m of list) {
    if (!byKey.has(nameKey(m.name))) byKey.set(nameKey(m.name), m);
    if (!bySlug.has(slugify(m.name))) bySlug.set(slugify(m.name), m);
    if (m.id !== m.id.toLowerCase()) byId.set(m.id.toLowerCase(), m);
  }
  mapIndex = { list, byId, kids: tree.kids, byKey, bySlug, main, parents: tree.parent };
  return mapIndex;
}

/**
 * Every map this viewer can see: the main map and its sub-maps first, then the maps of their own, each followed by its
 * sub-maps (depth-first by name; each has .depth). Treat as read-only.
 */
export const maps = () => mapsIdx().list;
/** A map by id (null for the main map while it is hidden from this viewer: mainUnrevealed). */
export const mapById = (id) => mapsIdx().byId.get(String(id ?? '')) || null;
/** The main map's entry even while it is hidden from this viewer (fallback for drawing the empty Map tab). */
export const mainMap = () => mapsIdx().main;
/** Maps directly inside id (null: the maps of their own). */
export const childMaps = (id) => mapsIdx().kids.get(id) || [];
/** The map #/map shows: the main map, or while it is hidden from this viewer the first map of its own (null: none). */
export const homeMapId = () => (mapById(MAIN_MAP) ? MAIN_MAP : maps()[0]?.id || null);

/** A parent for a new or moved map: null stays null (a map of its own); an unknown map falls back to the main map. */
function validParent(p) {
  if (p === null) return null;
  const m = mapById(p);
  if (m) return m.id;
  return mapById(MAIN_MAP) ? MAIN_MAP : null;
}

/** Match a map id, a name, or (loose) a slug of the name. */
export function findMap(target, { loose = false } = {}) {
  const t = String(target ?? '').trim();
  if (!t) return null;
  const ix = mapsIdx();
  return ix.byId.get(t) || ix.byId.get(t.toLowerCase()) || ix.byKey.get(nameKey(t)) || (loose ? ix.bySlug.get(slugify(t)) : null) || null;
}

/** Breadcrumb: [main, …, the map]. */
export function mapChain(id) {
  const out = [];
  const seen = new Set();
  for (let m = mapById(id) || mapById(MAIN_MAP); m && !seen.has(m.id); m = m.parent ? mapById(m.parent) : null) {
    seen.add(m.id);
    out.unshift(m);
  }
  return out;
}

/** Ids of every map below id (not including id). */
export function descendantIds(id) {
  const out = [];
  const walk = (k) => { for (const c of childMaps(k)) { out.push(c.id); walk(c.id); } };
  walk(id);
  return out;
}

export function readMapConfig(id) {
  const c = store.get(mapPath(id));
  return isObj(c) ? c : {};
}

/** Patch a map's config document (main: content/map/config.json, sub-maps: content/maps/<id>.json). */
export function writeMapConfig(id, patch) {
  const next = { ...readMapConfig(id), ...patch };
  if (id === MAIN_MAP) {
    // Hidden from this viewer: a write would bring back a blank public main map beside the sealed one.
    if (mainUnrevealed()) { console.warn('[map] the main map is hidden; not written'); return; }
    const { image, width, height, name, ...rest } = next;
    // A visible main map stays visible: never sealed by the "New: hidden" safety net (a fresh site has no config yet).
    store.put(CONFIG_PATH, { image, width, height, name, ...rest }, { hidden: isHidden(CONFIG_PATH) ? null : false });
    return;
  }
  const { id: _id, name, parent, image, width, height, ...rest } = next;
  store.put(mapPath(id), { id, name, parent: parent === null ? null : parent || MAIN_MAP, image: image || '', width: width || 0, height: height || 0, ...rest, updated: new Date().toISOString() });
}

/** Back-compat: patch the main map's config. */
export const writeConfig = (patch) => writeMapConfig(MAIN_MAP, patch);

/** The main map's config exists (a fresh site has none until something is changed): written blank if missing. */
export function ensureMainConfig() {
  if (!store.has(CONFIG_PATH) && !mainUnrevealed()) writeMapConfig(MAIN_MAP, {});
}

/**
 * Can this device manage maps: their design, pictures and fog, and new maps, images, names, copies, moves, deletions,
 * zoom bands and the bulk offset / scale? The DM in DM mode; anyone while no DM is set up. (Places are everyone's.)
 */
export const canDesign = () => isDm() || !dmConfigured();
/** Is this map (the main map too) hidden from the players (DM mode)? */
export const mapHidden = (id) => !!id && isHidden(mapPath(id));

/**
 * Move a sub-map into another map (or out: parent null = a map of its own), with everything on it. A loop is refused.
 * Moved into a hidden map (DM mode), it is hidden too, with everything on it. -> {hidden: true if it was hidden now}.
 */
export async function moveMap(id, parent) {
  const m = mapById(id);
  if (!m || m.isMain) throw new Error('The main map sits inside no other map.');
  const to = parent === null ? null : mapById(parent)?.id;
  if (to === undefined) throw new Error('That map no longer exists.');
  if (!canMoveInto(mapsIdx().parents, id, to)) throw new Error('A map can’t go inside itself or one of its own sub-maps.');
  if ((m.parent ?? null) === to) return { hidden: false };
  const hide = !!to && mapHidden(to) && !mapHidden(id);
  if (hide) await hideItem(mapPath(id)); // first, so a failure leaves it where it was; the move is then sealed too
  writeMapConfig(id, { parent: to });
  return { hidden: hide };
}

/** Create a sub-map (blank placeholder image). Returns its id. hidden (DM mode): a sub-map of a hidden map always is. */
export function createMap({ name, parent = MAIN_MAP, hidden = null }) {
  const n = String(name || '').trim() || 'New map';
  const par = validParent(parent); // null: a map of its own
  const base = mapHidden(par) || hidden === true ? 'map' : n; // a hidden map's id must not spell its name: visible places may name it (submap)
  let id = uid(base);
  while (id === MAIN_MAP || store.has(mapPath(id))) id = uid(base);
  const now = new Date().toISOString();
  store.put(mapPath(id), {
    id, name: n, parent: par, image: '', width: 0, height: 0,
    createdBy: getSetting('playerName') || '', created: now, updated: now,
  }, { hidden: mapHidden(par) ? true : hidden });
  return id;
}

export function isPlaceholderImage(image) {
  return !image || image === PLACEHOLDER_IMAGE;
}

/** Width/height of an SVG document from its viewBox (preferred) or width/height attributes. */
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(String(text || ''))?.[0];
  if (!tag) return null;
  const vb = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(tag);
  if (vb) {
    const n = vb[1].trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n[2] > 0 && n[3] > 0) return { width: n[2], height: n[3] };
  }
  const w = /\swidth\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i.exec(tag);
  const hh = /\sheight\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i.exec(tag);
  if (w && hh && +w[1] > 0 && +hh[1] > 0) return { width: +w[1], height: +hh[1] };
  return null;
}

let placeholderPromise = null;
export function placeholderSize() {
  if (!placeholderPromise) {
    placeholderPromise = fetch(PLACEHOLDER_IMAGE)
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => svgSize(t) || DEFAULT_SIZE)
      .catch(() => DEFAULT_SIZE);
  }
  return placeholderPromise;
}

/** Config with defaults filled in: {id, image, width, height, name, isPlaceholder, bands}. width/height may be 0. */
export async function effectiveConfig(id = MAIN_MAP) {
  const m = mapById(id) || mapById(MAIN_MAP) || mainMap();
  const c = readMapConfig(m.id);
  const placeholder = isPlaceholderImage(c.image);
  let width = Number(c.width) || 0;
  let height = Number(c.height) || 0;
  if (placeholder && !(width > 0 && height > 0)) ({ width, height } = await placeholderSize());
  return {
    id: m.id,
    isMain: m.isMain,
    standalone: !!m.standalone,
    image: placeholder ? PLACEHOLDER_IMAGE : String(c.image),
    width,
    height,
    name: m.name,
    isPlaceholder: placeholder,
    bands: normBands(c.rankBands),
    design: normDesign(c.design, { width, height }),
  };
}

// ---------- locations ----------

let locIndex = null;
// Places sharing a name: links by name keep opening the older one (e.g. after a map was duplicated).
const older = (a, b) => String(a.created || '') < String(b.created || '');

function normLoc(d, path) {
  const fileId = baseName(path).replace(/\.json$/i, '');
  const raw = String(d.map || '').trim();
  const known = !raw || raw === MAIN_MAP || !!mapById(raw);
  return {
    ...d,
    id: fileId, // the filename is the id
    name: String(d.name ?? '').trim() || 'Unnamed place',
    type: String(d.type || 'other'),
    rank: validRank(d.rank),
    map: known ? raw || MAIN_MAP : MAIN_MAP, // a pin whose map is gone shows on the main map
    lostMap: known ? null : raw,
    submap: typeof d.submap === 'string' && d.submap.trim() ? d.submap.trim() : null,
    x: num(d.x),
    y: num(d.y),
    description: typeof d.description === 'string' ? d.description : '',
    tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    same: typeof d.same === 'string' && d.same.trim() ? d.same.trim() : null, // linked places (twins.js)
    sharedAt: typeof d.sharedAt === 'string' ? d.sharedAt : null,
    path,
  };
}

function index() {
  if (!locIndex) {
    const list = [];
    for (const { path, data } of store.list(LOC_DIR)) {
      if (!path.endsWith('.json') || !isObj(data)) continue;
      list.push(normLoc(data, path));
    }
    linkTwins(list); // linked places share name, type, description and tags; each gets `twins`
    list.sort(byName);
    const byId = new Map();
    const byKey = new Map();
    const bySlug = new Map();
    const byMap = new Map();
    for (const l of list) {
      byId.set(l.id, l);
      if (l.id !== String(l.id).toLowerCase()) byId.set(String(l.id).toLowerCase(), l);
      const k = nameKey(l.name);
      if (!byKey.has(k) || older(l, byKey.get(k))) byKey.set(k, l);
      const s = slugify(l.name);
      if (!bySlug.has(s) || older(l, bySlug.get(s))) bySlug.set(s, l);
      if (!byMap.has(l.map)) byMap.set(l.map, []);
      byMap.get(l.map).push(l);
    }
    for (const { path, data } of store.list(LOC_DIR)) { // tolerate hand-edited docs whose id != filename
      if (data?.id && !byId.has(String(data.id))) { const l = byId.get(baseName(path).replace(/\.json$/i, '')); if (l) byId.set(String(data.id), l); }
    }
    locIndex = { list, byId, byKey, bySlug, byMap };
  }
  return locIndex;
}

/** All locations on every map, sorted by name. Shared objects: treat as read-only. */
export const locations = () => index().list;
/** Locations on one map. */
export const locationsOn = (mapId) => index().byMap.get(mapId) || [];
export const locationById = (id) => index().byId.get(String(id ?? '')) || null;
/** The other places linked with this one (the same place on other maps), as this viewer can see them. */
export const twinsOf = (loc) => (loc?.twins || []).map((id) => locationById(id)).filter(Boolean);

/** Effective rank: the place's own rank, else its type's default rank. */
export const rankOf = (loc) => validRank(loc?.rank) || typeOf(loc?.type).rank || 3;

/** Match an id, a (case/diacritic-insensitive) name, or — with loose — a slug of the name. */
export function findLocation(target, { loose = false, map = null } = {}) {
  const t = String(target ?? '').trim();
  if (!t) return null;
  const ix = index();
  const byId = ix.byId.get(t) || ix.byId.get(t.toLowerCase());
  if (map) {
    if (byId && byId.map === map) return byId;
    const list = locationsOn(map);
    const k = nameKey(t);
    return list.find((l) => nameKey(l.name) === k) || (loose ? list.find((l) => slugify(l.name) === slugify(t)) : null) || null;
  }
  return byId || ix.byKey.get(nameKey(t)) || (loose ? ix.bySlug.get(slugify(t)) : null) || null;
}

export const locPath = (id) => `${LOC_DIR}/${id}.json`;

/**
 * Create or update a location. Returns the normalized saved location. opts.hidden: DM mode, a new place hidden.
 * Linked places (twins.js): loc.same keeps it in its group (null: unlinked); opts.linkTo: the id of a place to link
 * it with (it joins that place's group). A change to the shared fields is written to every member this viewer can see.
 */
export function saveLocation(loc, { hidden = null, linkTo = null } = {}) {
  const now = new Date().toISOString();
  const { path, id: _id, name, type, rank, map, lostMap: _lost, submap, x, y, description, tags, createdBy, created, updated: _u, same, sharedAt, twins: _tw, ...extra } = loc;
  let id = loc.id;
  if (!id) {
    id = uid(name || 'location');
    while (store.has(locPath(id))) id = uid(name || 'location');
  }
  const before = store.get(path || locPath(id)); // as stored (not as linked)
  let group = typeof same === 'string' && same ? same : null;
  const target = linkTo && linkTo !== id ? locationById(linkTo) : null;
  if (target) group = joinGroup(target, now);
  const r = validRank(rank);
  const doc = {
    id,
    name: String(name || '').trim() || 'Unnamed place',
    type: type || 'other',
    ...(r ? { rank: r } : {}),
    ...(map && map !== MAIN_MAP ? { map } : {}),
    ...(submap ? { submap } : {}),
    x: round(x),
    y: round(y),
    description: description || '',
    tags: Array.isArray(tags) ? tags : [],
    createdBy: createdBy ?? (getSetting('playerName') || ''),
    created: created || now,
    updated: now,
    ...extra,
  };
  const changed = !before || !!target || sharedDiffer(before, doc);
  if (group) Object.assign(doc, { same: group, sharedAt: changed ? now : sharedAt || before?.sharedAt || now });
  const p = path || locPath(id);
  // A place on a hidden map is hidden too: players would otherwise see it on the main map (normLoc's lost pins).
  const onHidden = mapHidden(doc.map);
  const isNew = !store.has(p);
  store.put(p, doc, { hidden: onHidden && isNew ? true : hidden });
  if (onHidden && !isNew && !isHidden(p)) hideItem(p).catch((e) => console.warn('[map] could not hide a place moved to a hidden map', e));
  if (group && changed) { // the other members get the shared fields (those this viewer can see; the rest catch up when read)
    for (const m of groupPaths(group)) {
      if (m === p) continue;
      const raw = store.get(m);
      if (raw && sharedDiffer(raw, doc)) store.put(m, { ...raw, ...sharedOf(doc), sharedAt: doc.sharedAt, updated: now });
    }
  }
  if (before?.same && before.same !== group) tidyGroup(before.same);
  return locationById(baseName(p).replace(/\.json$/i, '')) || normLoc(doc, p);
}

/** The documents in a group of linked places (as stored, so a member not yet caught up still counts). */
const groupPaths = (group) => store.list(LOC_DIR).filter((d) => d.path.endsWith('.json') && isObj(d.data) && d.data.same === group).map((d) => d.path);

/** The group a place is linked in, made for it (and written into it) if it has none yet. */
function joinGroup(target, now) {
  const raw = store.get(target.path);
  if (raw?.same) return raw.same;
  const group = uid('same'); // random: a hidden member's name must not show in a visible member's document
  store.put(target.path, { ...raw, same: group, sharedAt: raw?.sharedAt || raw?.updated || raw?.created || now });
  return group;
}

/** A group left with one member is no group: that place loses its link fields. */
function tidyGroup(group) {
  const rest = groupPaths(group);
  if (rest.length !== 1) return;
  const { same: _s, sharedAt: _a, ...raw } = store.get(rest[0]) || {};
  if (raw.id) store.put(rest[0], raw);
}

/** Take a place out of its group of linked places: it keeps the shared text as its own. */
export const unlinkLocation = (loc) => saveLocation({ ...loc, same: null });

export function deleteLocation(loc) {
  const p = loc.path || locPath(loc.id);
  const group = store.get(p)?.same;
  store.remove(p);
  if (group) tidyGroup(group);
}

/** Another place or map shares this name, so links by name would be ambiguous. */
function nameClash(name, selfId) {
  const k = nameKey(name);
  return locations().some((l) => l.id !== selfId && nameKey(l.name) === k) || maps().some((m) => m.id !== selfId && nameKey(m.name) === k);
}

/** Text for a [[map:…]] link that survives odd characters and duplicate names. */
export function linkText(loc) {
  return /[[\]|#^]/.test(loc.name) || nameClash(loc.name, loc.id) ? `[[map:${loc.id}|${loc.name.replace(/[[\]|]/g, '')}]]` : `[[map:${loc.name}]]`;
}

/** Link text for a whole map. */
export function mapLinkText(m) {
  return /[[\]|#^]/.test(m.name) || nameClash(m.name, m.id) ? `[[map:${m.id}|${m.name.replace(/[[\]|]/g, '')}]]` : `[[map:${m.name}]]`;
}

export const mapHref = (mapId) => (!mapId || mapId === MAIN_MAP ? '#/map' : href('map', 'm', mapId));
export const locHref = (loc) => (loc.map === MAIN_MAP ? href('map', 'loc', loc.id) : href('map', 'm', loc.map, 'loc', loc.id));

/** Places on other maps that open this map. */
export const linksTo = (mapId) => locations().filter((l) => l.submap === mapId);

/** Where the places of a deleted map can go: its parent, or (a map of its own) the main map; null = nowhere. */
export function moveTargetOf(id) {
  const m = mapById(id);
  if (!m) return null;
  return (m.parent && mapById(m.parent)?.id) || (mapById(MAIN_MAP) ? MAIN_MAP : null);
}

/**
 * Delete a sub-map. pins: 'move' (to the parent map, around the place that opened it; a map of its own: to the main
 * map) or 'delete'. Child maps move up to the parent (a map of its own: they become maps of their own); places that
 * opened this map lose the link.
 */
export async function deleteMap(id, { pins = 'move' } = {}) {
  const m = mapById(id);
  if (!m || m.isMain) return;
  const parent = m.parent && mapById(m.parent) ? m.parent : null; // null: it is a map of its own
  const dest = moveTargetOf(id);
  const own = locationsOn(id);
  if (pins === 'delete' || !dest) own.forEach(deleteLocation);
  else if (own.length) {
    const p = await effectiveConfig(dest);
    const anchor = locationsOn(dest).find((l) => l.submap === id);
    const W = p.width || DEFAULT_SIZE.width;
    const H = p.height || DEFAULT_SIZE.height;
    const cx = anchor ? anchor.x : W / 2;
    const cy = anchor ? anchor.y : H / 2;
    const r0 = Math.min(W, H) * 0.012;
    own.forEach((l, i) => { // a small sunflower spiral, so moved pins don't sit on top of each other
      const a = i * 2.39996;
      const r = r0 * Math.sqrt(i + 1);
      saveLocation({ ...l, map: dest, x: Math.min(W, Math.max(0, cx + Math.cos(a) * r)), y: Math.min(H, Math.max(0, cy + Math.sin(a) * r)) });
    });
  }
  for (const c of childMaps(id)) writeMapConfig(c.id, { parent }); // null: they become maps of their own
  for (const l of linksTo(id)) saveLocation({ ...l, submap: null });
  for (const pic of picturesOn(id)) deletePicture(pic);
  if (store.has(fogPath(id))) store.remove(fogPath(id));
  for (const f of store.files(`${mapImageDir(id)}/`)) store.remove(f.path);
  store.remove(mapPath(id));
}

// ---------- pictures laid on a map ----------

let picIndex = null;
const fin = (v, d = 0) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export const picPath = (id) => `${PIC_DIR}/${id}.json`;

function normPic(d, path) {
  return {
    ...d,
    id: baseName(path).replace(/\.json$/i, ''),
    path,
    map: typeof d.map === 'string' && d.map ? d.map : MAIN_MAP,
    name: String(d.name ?? '').trim() || 'Picture',
    src: typeof d.src === 'string' && /^(content\/|https:\/\/)/.test(d.src) && !d.src.includes('..') ? d.src : '',
    x: fin(d.x),
    y: fin(d.y),
    w: Math.max(1, fin(d.w, 100)),
    h: Math.max(1, fin(d.h, 100)),
    rotation: ((fin(d.rotation) % 360) + 360) % 360,
    opacity: Math.min(1, Math.max(0.05, fin(d.opacity, 1))),
    order: fin(d.order),
  };
}

/** Every picture, by map. */
function pics() {
  if (!picIndex) {
    picIndex = new Map();
    for (const { path, data } of store.list(PIC_DIR)) {
      if (!path.endsWith('.json') || !isObj(data)) continue;
      const p = normPic(data, path);
      if (!picIndex.has(p.map)) picIndex.set(p.map, []);
      picIndex.get(p.map).push(p);
    }
    for (const l of picIndex.values()) l.sort((a, b) => a.order - b.order || String(a.created || '').localeCompare(String(b.created || '')));
  }
  return picIndex;
}
/** Pictures on a map, bottom first. Shared objects: treat as read-only. */
export const picturesOn = (mapId) => pics().get(mapId) || [];
export const pictureById = (id) => { for (const l of pics().values()) { const p = l.find((x) => x.id === id); if (p) return p; } return null; };

/** Create or update a picture; returns its id. A new picture on a hidden map is hidden. */
export function savePicture(pic, { hidden = null } = {}) {
  const now = new Date().toISOString();
  let id = pic.id;
  if (!id) {
    id = uid(pic.name || 'picture');
    while (store.has(picPath(id))) id = uid(pic.name || 'picture');
  }
  const { path: _p, id: _i, ...rest } = pic;
  const doc = {
    ...rest,
    id,
    map: pic.map || MAIN_MAP,
    name: String(pic.name || '').trim() || 'Picture',
    x: round(pic.x), y: round(pic.y), w: round(pic.w), h: round(pic.h),
    rotation: Math.round((fin(pic.rotation) % 360) * 10) / 10,
    opacity: Math.round(fin(pic.opacity, 1) * 100) / 100,
    createdBy: pic.createdBy ?? (getSetting('playerName') || ''),
    created: pic.created || now,
    updated: now,
  };
  const p = picPath(id);
  store.put(p, doc, { hidden: !store.has(p) && mapHidden(doc.map) ? true : hidden });
  return id;
}

/** Delete a picture (its uploaded image too, once no other picture uses it). */
export function deletePicture(pic) {
  store.remove(pic.path || picPath(pic.id));
  if (pic.src?.startsWith(`${PIC_MEDIA}/`) && ![...pics().values()].flat().some((x) => x.id !== pic.id && x.src === pic.src)) store.remove(pic.src);
}

// ---------- fog of war ----------

const fogCache = new Map(); // mapId -> normalized fog (dropped when the document changes)
/** The fog of a map (normalized; areas: [] when it has none). Shared object: treat as read-only. */
export function fogOf(mapId) {
  if (!fogCache.has(mapId)) {
    const raw = store.get(fogPath(mapId));
    const cfg = raw && !Array.isArray(raw.areas) ? readMapConfig(mapId) : null; // a first-version fog's "cover all" needs the size
    fogCache.set(mapId, normFog(raw, mapId, cfg?.width > 0 ? { w: cfg.width, h: cfg.height } : null));
  }
  return fogCache.get(mapId);
}
/** Write a map's fog (a new fog document of a hidden map is hidden). */
export function saveFog(mapId, fog) {
  const p = fogPath(mapId);
  const { map: _m, updated: _u, ...rest } = fog;
  store.put(p, { map: mapId, ...rest, updated: new Date().toISOString() }, { hidden: !store.has(p) && mapHidden(mapId) ? true : null });
}

// ---------- duplicate, rescale ----------

/**
 * Duplicate a map: its image (copied into the new map's folder), design, and optionally its places (new ids, same
 * names, types, ranks, descriptions, tags and positions), pictures and fog. hidden (DM mode): the copy and
 * everything in it start hidden; a copy inside a hidden map always is. Returns the new map's id.
 */
export async function copyMap(srcId, { name = '', parent = MAIN_MAP, places = true, pictures = true, fog = true, hidden = false } = {}) {
  const src = mapById(srcId);
  if (!src) throw new Error('That map no longer exists.');
  const cfg = readMapConfig(src.id);
  const n = String(name || '').trim() || `${src.name} (copy)`;
  const par = validParent(parent); // null: a map of its own
  const hide = mapHidden(par) || !!hidden;
  let id = uid(hide ? 'map' : n); // see createMap
  while (id === MAIN_MAP || store.has(mapPath(id))) id = uid(hide ? 'map' : n);
  // On a hidden source map everything is hidden with the map, so the copy decides; otherwise each item keeps its own.
  const hiddenItem = (path) => hide || (!mapHidden(src.id) && isHidden(path));
  const copyFile = async (path) => {
    if (!path || !path.startsWith('content/')) return path || '';
    const blob = await store.fileBlob(path);
    if (!blob) return '';
    const dest = `${MAPS_DIR}/${id}/${baseName(path)}`;
    await store.putBinary(dest, blob, { hidden: hide });
    return dest;
  };
  const design = isObj(cfg.design) ? structuredClone(cfg.design) : null;
  if (design?.background?.image) design.background.image = await copyFile(design.background.image);
  const image = isPlaceholderImage(cfg.image) ? '' : await copyFile(cfg.image);
  const { id: _i, name: _n, parent: _p, image: _img, width, height, design: _d, createdBy: _c, created: _cr, updated: _u, ...rest } = cfg;
  const now = new Date().toISOString();
  store.put(mapPath(id), {
    id, name: n, parent: par, image, width: width || 0, height: height || 0, ...rest, ...(design ? { design } : {}),
    copiedFrom: src.id, createdBy: getSetting('playerName') || '', created: now, updated: now,
  }, { hidden: hide });
  mapIndex = null;
  if (places) {
    for (const l of locationsOn(src.id)) {
      const { id: _li, path: _lp, lostMap: _lm, created: _lc, createdBy: _lb, updated: _lu, same: _ls, sharedAt: _la, ...keep } = l;
      saveLocation({ ...keep, map: id }, { hidden: hiddenItem(l.path) }); // a copy, not linked with the original
    }
  }
  if (pictures) {
    for (const pic of picturesOn(src.id)) {
      const { id: _pi, path: _pp, created: _pc, createdBy: _pb, updated: _pu, ...keep } = pic;
      const hidePic = hiddenItem(pic.path);
      if (!hidePic && isHidden(pic.src)) { // a visible copy needs its own visible image file
        const blob = await store.fileBlob(pic.src);
        if (blob) {
          keep.src = `${PIC_MEDIA}/${baseName(pic.src).replace(/(\.[a-z0-9]+)$/i, `-${uid('').slice(-4)}$1`)}`;
          await store.putBinary(keep.src, blob, { hidden: false });
        }
      }
      savePicture({ ...keep, map: id }, { hidden: hidePic });
    }
  }
  if (fog && store.has(fogPath(src.id))) saveFog(id, fogOf(src.id));
  return id;
}

/** After a new image of another size: pins, pictures, fog, crop and scale follow (sx, sy = new / old size). */
export function rescaleMapContent(mapId, sx, sy) {
  if (!(sx > 0 && sy > 0) || (sx === 1 && sy === 1)) return;
  for (const loc of locationsOn(mapId)) saveLocation({ ...loc, x: loc.x * sx, y: loc.y * sy });
  for (const pic of picturesOn(mapId)) savePicture({ ...pic, x: pic.x * sx, y: pic.y * sy, w: pic.w * sx, h: pic.h * sy });
  if (store.has(fogPath(mapId))) { const f = fogOf(mapId); saveFog(mapId, { ...f, areas: scaleAreas(f.areas, sx, sy) }); }
  const cfg = readMapConfig(mapId);
  if (isObj(cfg.design)) {
    const d = structuredClone(cfg.design);
    if (isObj(d.crop)) d.crop = { x: fin(d.crop.x) * sx, y: fin(d.crop.y) * sy, w: fin(d.crop.w) * sx, h: fin(d.crop.h) * sy };
    if (isObj(d.scale) && fin(d.scale.perPx) > 0) d.scale.perPx = fin(d.scale.perPx) / Math.sqrt(sx * sy);
    writeMapConfig(mapId, { design: d });
  }
}

// ---------- DM mode: hiding a map hides what is on it ----------

const mapIdOfPath = (path) => path.slice(MAPS_DIR.length + 1).split('/')[0].replace(/\.json$/i, '');
const isMapDoc = (path) => /^content\/maps\/[^/]+\.json$/.test(path);
const fileExists = (path) => store.has(path) || store.files(path).some((f) => f.path === path);

/** What hides (and is released) with a map: its image and background image, fog, pictures, places and sub-maps. */
function mapCompanions(id) {
  const cfg = readMapConfig(id);
  const out = [];
  for (const img of [cfg.image, cfg.design?.background?.image]) if (typeof img === 'string' && img.startsWith('content/') && fileExists(img)) out.push(img);
  if (store.has(fogPath(id))) out.push(fogPath(id));
  for (const p of picturesOn(id)) out.push(p.path);
  for (const l of locationsOn(id)) out.push(l.path);
  for (const c of childMaps(id)) out.push(mapPath(c.id));
  return out;
}
const hiddenMapReason = (id, what) => (mapHidden(id) ? `${what} is on the hidden map “${mapById(id)?.name || id}”. Release that map to show it.` : null);
const mainName = () => mainMap().name;

/**
 * What hiding the main map takes along (not counting what is hidden already), for the DM's confirmation.
 * -> {image, fog, places, pictures, maps (all below it), own (visible maps of their own: what players see instead)}
 */
export function mainHideCounts() {
  const cfg = readConfig();
  const shown = (p) => !isHidden(p);
  return {
    image: !isPlaceholderImage(cfg.image) && shown(cfg.image),
    fog: store.has(fogPath(MAIN_MAP)) && shown(fogPath(MAIN_MAP)),
    places: locationsOn(MAIN_MAP).filter((l) => shown(l.path)).length,
    pictures: picturesOn(MAIN_MAP).filter((p) => shown(p.path)).length,
    maps: descendantIds(MAIN_MAP).filter((id) => !mapHidden(id)).length,
    own: childMaps(null).filter((m) => !mapHidden(m.id)).length,
  };
}

// The main map (content/map/config.json): hidden with its image, fog, pictures, places and every map inside it (each
// with what is on it); maps of their own stay. While it is hidden, the public marker content/map/hidden.json tells the
// players' devices to show a map of their own (or "not revealed yet") instead of a blank placeholder.
registerHideable({
  prefix: `${MAP_DIR}/`, label: 'Map', icon: 'map', order: 44, accept: (p) => p === CONFIG_PATH,
  describe: (path, d) => (path === CONFIG_PATH
    ? { title: String(d?.name || '').trim() || DEFAULT_MAP_NAME, href: mapHref(MAIN_MAP) }
    : { title: `Image of ${mainName()}`, href: mapHref(MAIN_MAP) }),
  companions: (path) => (path === CONFIG_PATH ? mapCompanions(MAIN_MAP) : []),
  // its hidden places, picked in the release question (one notification for the map and the ones ticked)
  releaseChoices: (path) => (path === CONFIG_PATH ? locationsOn(MAIN_MAP).map((l) => l.path) : []),
  choiceNoun: ['place', 'places'],
  releaseBlock: (path) => (path === CONFIG_PATH ? null : hiddenMapReason(MAIN_MAP, 'This image')),
  afterHide: (path) => { if (path === CONFIG_PATH) store.put(MAIN_HIDDEN_PATH, { hidden: true }, { hidden: false }); },
  afterRelease: (path) => { if (path === CONFIG_PATH && store.has(MAIN_HIDDEN_PATH)) store.remove(MAIN_HIDDEN_PATH); },
});
registerHideable({
  prefix: `${MAPS_DIR}/`, label: 'Map', icon: 'map', order: 45, accept: isMapDoc,
  describe: (path, d) => {
    const id = mapIdOfPath(path);
    return isMapDoc(path) ? { title: d?.name || mapById(id)?.name || 'Map', href: mapHref(id) } : { title: `Image of ${mapById(id)?.name || 'a map'}`, href: mapHref(id) };
  },
  companions: (path) => (isMapDoc(path) ? mapCompanions(mapIdOfPath(path)) : []),
  releaseChoices: (path) => (isMapDoc(path) ? locationsOn(mapIdOfPath(path)).map((l) => l.path) : []),
  choiceNoun: ['place', 'places'],
  releaseBlock: (path) => (isMapDoc(path) ? null : hiddenMapReason(mapIdOfPath(path), 'This image')),
  // Inside a map that is still hidden: released as a map of its own (parent null), with everything on it.
  releaseAs: (path, d) => {
    if (!isMapDoc(path)) return null;
    const id = mapIdOfPath(path);
    const up = mapById(id)?.parent;
    if (!up || !mapHidden(up)) return null;
    const name = d?.name || mapById(id)?.name || 'This map';
    return {
      title: 'Release it as a map of its own?',
      question: `“${name}” is inside the hidden map “${mapById(up)?.name || up}”. Release it as a map of its own, not linked to that map? Its places, pictures, fog and sub-maps come with it.`,
      okLabel: 'Release as a map of its own',
      data: { ...d, parent: null, updated: new Date().toISOString() },
    };
  },
});
registerHideable({
  prefix: `${PIC_DIR}/`, label: 'Map picture', icon: 'image', order: 52, accept: (p) => p.endsWith('.json'),
  describe: (path, d) => ({ title: d?.name || 'Picture', href: mapHref(d?.map || MAIN_MAP) }),
  releaseBlock: (path, d) => hiddenMapReason(d?.map || MAIN_MAP, 'This picture'),
});
registerHideable({
  prefix: `${FOG_DIR}/`, label: 'Map fog', icon: 'map', order: 95, pickable: false, accept: () => false,
  describe: (path, d) => ({ title: `Fog of ${mapById(d?.map)?.name || 'a map'}`, href: mapHref(d?.map || MAIN_MAP) }),
  releaseBlock: (path, d) => hiddenMapReason(d?.map || MAIN_MAP, 'This fog'),
});

// ---------- backlinks ----------

function plainLine(line) {
  return line
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, t) => t.replace(/^[a-z-]+:/i, '').split('#')[0])
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s*)?/, '')
    .replace(/^\s*>\s*(?:\[![\w-]+\][+-]?\s*)?/, '')
    .replace(/^#+\s+/, '')
    .replace(/[*_=`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does a parsed [[map:…]] / [[…]] link point at this target ({loc} or {map})? */
function linkHits(l, want) {
  if (l.prefix === 'map') {
    const r = resolveTarget(l.target, l.anchor);
    return !!r && (want.loc ? !!r.loc && (r.loc.id === want.loc.id || want.loc.twins?.includes(r.loc.id)) : r.map?.id === want.map.id);
  }
  if (!l.prefix) return nameKey(l.target) === nameKey(want.loc ? want.loc.name : want.map.name);
  return false;
}

/** Journal notes (and places) that link to a place or a map. -> [{title, href, context, snippet}] */
export function backlinks(target) {
  const want = target && 'x' in target ? { loc: target } : { map: target };
  const matches = (l) => linkHits(l, want);
  const docs = store.list(JOURNAL_DIR, { recursive: true });
  const chapters = new Map();
  for (const { path, data } of docs) {
    if (path.endsWith('/_chapter.json') && isObj(data)) chapters.set(path.split('/')[2], data);
  }
  const out = [];
  for (const { path, data } of docs) {
    if (!path.endsWith('.md') || typeof data !== 'string' || !data.includes('[[')) continue;
    if (!extractLinks(data).some(matches)) continue;
    const rel = path.slice(JOURNAL_DIR.length + 1).replace(/\.md$/i, '');
    const parts = rel.split('/');
    const chapter = parts.length > 1 ? parts[0] : '_';
    const slug = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    const { data: fm, body } = parseFrontmatter(data);
    const title = String(fm.title || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || prettify(slug));
    const ch = chapters.get(chapter);
    const context = chapter === '_' ? 'Journal' : String(ch?.title || ch?.name || prettify(chapter));
    let snippet = '';
    for (const line of body.split('\n')) {
      if (line.includes('[[') && extractLinks(line).some(matches)) { snippet = plainLine(line); break; }
    }
    if (snippet.length > 160) snippet = `${snippet.slice(0, 157).trimEnd()}…`;
    out.push({ title, href: href('journal', chapter, slug), context, snippet, sort: `${context}\u0000${title}` });
  }
  out.sort((a, b) => a.sort.localeCompare(b.sort, undefined, { numeric: true, sensitivity: 'base' }));
  for (const other of locations()) {
    if (want.loc && (other.id === want.loc.id || want.loc.twins?.includes(other.id))) continue; // its own (shared) text
    if (!other.description.includes('[[')) continue;
    if (extractLinks(other.description).some(matches)) out.push({ title: other.name, href: locHref(other), context: other.map === MAIN_MAP ? 'Map' : (mapById(other.map)?.name || 'Map'), snippet: '' });
  }
  return out;
}

// ---------- cache invalidation + link type ----------

store.on((ev) => {
  const paths = ev.path ? [ev.path] : ev.paths || [];
  const all = ev.type === 'load';
  const mapsChanged = all || paths.some((p) => p.startsWith(`${MAP_DIR}/`) || p.startsWith(`${MAPS_DIR}/`)); // config, the hidden marker
  if (mapsChanged) mapIndex = null;
  if (all || paths.some((p) => p.startsWith(`${PIC_DIR}/`))) picIndex = null;
  if (all) fogCache.clear();
  else for (const p of paths) if (p.startsWith(`${FOG_DIR}/`)) fogCache.delete(baseName(p).replace(/\.json$/i, ''));
  if (mapsChanged || paths.some((p) => p.startsWith(`${LOC_DIR}/`))) locIndex = null;
  if (all || paths.some((p) => p.startsWith(`${TYPE_DIR}/`))) refreshTypes();
});
onDmMode(() => { mapIndex = null; locIndex = null; }); // the main map hidden from this viewer or not (mainUnrevealed)
refreshTypes();

/**
 * [[map:X]] precedence: a place id, then a map id, then a place name, then a map name.
 * [[map:Map name#Place]] finds a place on that map (for names used on several maps).
 */
export function resolveTarget(target, anchor) {
  const t = String(target ?? '').trim();
  if (!t) return null;
  if (anchor) {
    const m = findMap(t);
    const loc = m && findLocation(anchor, { map: m.id });
    if (loc) return { loc };
  }
  const ix = index();
  const mx = mapsIdx();
  const loc = ix.byId.get(t) || ix.byId.get(t.toLowerCase());
  if (loc) return { loc };
  const m = mx.byId.get(t) || mx.byId.get(t.toLowerCase());
  if (m) return { map: m };
  const k = nameKey(t);
  if (ix.byKey.has(k)) return { loc: ix.byKey.get(k) };
  if (mx.byKey.has(k)) return { map: mx.byKey.get(k) };
  return null;
}

registerLinkType('map', {
  label: 'Place',
  order: 20,
  resolve(target, anchor) {
    const r = resolveTarget(target, anchor);
    if (r?.loc) {
      const where = r.loc.map === MAIN_MAP ? 'map' : `map of ${mapById(r.loc.map)?.name || 'a sub-map'}`;
      return { href: locHref(r.loc), title: `${r.loc.name} · ${typeOf(r.loc.type).name} (${where})`, exists: true };
    }
    if (r?.map) return { href: mapHref(r.map.id), title: `${r.map.name} (map, ${plural(locationsOn(r.map.id).length, 'place')})`, exists: true };
    return null;
  },
  suggest(q) {
    const ms = matchNames(maps(), q, (m) => m.name, 4).map((m) => ({ label: `${m.name} (map)`, value: /[[\]|#^]/.test(m.name) || nameClash(m.name, m.id) ? `${m.id}|${m.name.replace(/[[\]|]/g, '')}` : m.name }));
    const known = isDm() ? locations() : locations().filter((l) => !fogCovers(fogOf(l.map), l.x, l.y)); // places under the fog stay unknown
    const ls = matchNames(known, q, (l) => l.name, 10).map((l) => ({ label: l.map === MAIN_MAP ? l.name : `${l.name} · ${mapById(l.map)?.name || ''}`, value: /[[\]|#^]/.test(l.name) || nameClash(l.name, l.id) ? `${l.id}|${l.name.replace(/[[\]|]/g, '')}` : l.name }));
    return [...ms, ...ls];
  },
  embed(target, anchor) {
    const r = resolveTarget(target, anchor);
    if (r?.loc) return { markdown: r.loc.description.trim() || `*${typeOf(r.loc.type).name} on the map. No description yet.*` };
    if (r?.map) {
      const top = locationsOn(r.map.id).filter((l) => rankOf(l) <= 2).slice(0, 8);
      return { markdown: `*A map of ${plural(locationsOn(r.map.id).length, 'place')}.*${top.length ? ` ${top.map((l) => linkText(l)).join(', ')}` : ''}` };
    }
    return null;
  },
});
