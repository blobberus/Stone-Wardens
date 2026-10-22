// Map data layer: location documents, location types (built-in + custom), the map config,
// backlinks from the journal, and the [[map:…]] link type (registered at import).
import { store } from '../../core/store.js';
import { registerLinkType, matchNames } from '../../core/links.js';
import { entries } from '../../core/compendium.js';
import { extractLinks, parseFrontmatter } from '../../core/markdown.js';
import { href } from '../../core/router.js';
import { uid, nameKey, slugify, byName, baseName } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';

export const LOC_DIR = 'content/locations';
export const MAP_DIR = 'content/map';
export const CONFIG_PATH = `${MAP_DIR}/config.json`;
export const TYPE_KIND = 'location-type';
export const TYPE_DIR = `content/library/${TYPE_KIND}`;
export const JOURNAL_DIR = 'content/journal';
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

// rank: 1 = labelled even when zoomed out, 2 = labelled at medium zoom, 3 = labelled when zoomed in.
// Danger is the only vermilion pin so it reads as the loud one.
export const BUILTIN_TYPES = [
  { id: 'city', name: 'City', color: pig('murrey'), rank: 1 },
  { id: 'town', name: 'Town', color: pig('lapis'), rank: 2 },
  { id: 'village', name: 'Village', color: pig('ochre'), rank: 3 },
  { id: 'castle', name: 'Castle', color: pig('slate'), rank: 1 },
  { id: 'temple', name: 'Temple', color: pig('gold'), rank: 2 },
  { id: 'port', name: 'Port', color: pig('verdigris'), rank: 2 },
  { id: 'danger', name: 'Danger', color: pig('vermilion'), rank: 3 },
  { id: 'dungeon', name: 'Dungeon', color: pig('ink'), rank: 3 },
  { id: 'ruins', name: 'Ruins', color: pig('umber'), rank: 3 },
  { id: 'cave', name: 'Cave', color: pig('umber'), rank: 3 },
  { id: 'camp', name: 'Camp', color: pig('green'), rank: 3 },
  { id: 'forest', name: 'Forest', color: pig('green'), rank: 2 },
  { id: 'mountain', name: 'Mountain', color: pig('slate'), rank: 2 },
  { id: 'landmark', name: 'Landmark', color: pig('murrey'), rank: 2 },
  { id: 'tavern', name: 'Tavern', color: pig('ochre'), rank: 3 },
  { id: 'shop', name: 'Shop', color: pig('verdigris'), rank: 3 },
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

// ---------- location types ----------

let customTypes = [];
let typeIndex = null;
let typesPromise = null;

function normType(c, base) {
  return withPaint({
    id: String(c.id),
    name: String(c.name || base?.name || prettify(c.id)),
    icon: safeIcon(c.icon, base?.icon || 'mk-custom'),
    color: safeColor(c.color, base?.color || FALLBACK_COLOR),
    rank: c.major === true ? 1 : c.major === false ? (base?.rank === 1 ? 2 : base?.rank || 3) : Number(c.rank) || base?.rank || 3,
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

// ---------- locations ----------

let locIndex = null;

function normLoc(d, path) {
  const fileId = baseName(path).replace(/\.json$/i, '');
  return {
    ...d,
    id: fileId, // the filename is the id
    name: String(d.name ?? '').trim() || 'Unnamed place',
    type: String(d.type || 'other'),
    x: num(d.x),
    y: num(d.y),
    description: typeof d.description === 'string' ? d.description : '',
    tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    path,
  };
}

function index() {
  if (!locIndex) {
    const list = [];
    for (const { path, data } of store.list(LOC_DIR)) {
      if (!path.endsWith('.json') || !data || typeof data !== 'object' || Array.isArray(data)) continue;
      list.push(normLoc(data, path));
    }
    list.sort(byName);
    const byId = new Map();
    const byKey = new Map();
    const bySlug = new Map();
    for (const l of list) {
      byId.set(l.id, l);
      if (l.id !== String(l.id).toLowerCase()) byId.set(String(l.id).toLowerCase(), l);
      const k = nameKey(l.name);
      if (!byKey.has(k)) byKey.set(k, l);
      const s = slugify(l.name);
      if (!bySlug.has(s)) bySlug.set(s, l);
    }
    for (const { path, data } of store.list(LOC_DIR)) { // tolerate hand-edited docs whose id != filename
      if (data?.id && !byId.has(String(data.id))) { const l = byId.get(baseName(path).replace(/\.json$/i, '')); if (l) byId.set(String(data.id), l); }
    }
    locIndex = { list, byId, byKey, bySlug };
  }
  return locIndex;
}

/** All locations, sorted by name. Shared objects: treat as read-only. */
export const locations = () => index().list;
export const locationById = (id) => index().byId.get(String(id ?? '')) || null;

/** Match an id, a (case/diacritic-insensitive) name, or — with loose — a slug of the name. */
export function findLocation(target, { loose = false } = {}) {
  const t = String(target ?? '').trim();
  if (!t) return null;
  const ix = index();
  return ix.byId.get(t) || ix.byId.get(t.toLowerCase()) || ix.byKey.get(nameKey(t)) || (loose ? ix.bySlug.get(slugify(t)) : null) || null;
}

export const locPath = (id) => `${LOC_DIR}/${id}.json`;

/** Create or update a location. Returns the normalized saved location. */
export function saveLocation(loc) {
  const now = new Date().toISOString();
  const { path, id: _id, name, type, x, y, description, tags, createdBy, created, updated: _u, ...extra } = loc;
  let id = loc.id;
  if (!id) {
    id = uid(name || 'location');
    while (store.has(locPath(id))) id = uid(name || 'location');
  }
  const doc = {
    id,
    name: String(name || '').trim() || 'Unnamed place',
    type: type || 'other',
    x: round(x),
    y: round(y),
    description: description || '',
    tags: Array.isArray(tags) ? tags : [],
    createdBy: createdBy ?? (getSetting('playerName') || ''),
    created: created || now,
    updated: now,
    ...extra,
  };
  const p = path || locPath(id);
  store.put(p, doc);
  return locationById(baseName(p).replace(/\.json$/i, '')) || normLoc(doc, p);
}

export function deleteLocation(loc) {
  store.remove(loc.path || locPath(loc.id));
}

/** Text for a [[map:…]] link that survives odd characters in names. */
export function linkText(loc) {
  return /[[\]|#^]/.test(loc.name) ? `[[map:${loc.id}|${loc.name.replace(/[[\]|]/g, '')}]]` : `[[map:${loc.name}]]`;
}

// ---------- map config ----------

export function readConfig() {
  const c = store.get(CONFIG_PATH);
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  const { image, width, height, name, ...rest } = next;
  store.put(CONFIG_PATH, { image, width, height, name, ...rest });
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

/** Config with defaults filled in: {image, width, height, name, isPlaceholder}. width/height may be 0 (unknown). */
export async function effectiveConfig() {
  const c = readConfig();
  const placeholder = isPlaceholderImage(c.image);
  let width = Number(c.width) || 0;
  let height = Number(c.height) || 0;
  if (placeholder && !(width > 0 && height > 0)) ({ width, height } = await placeholderSize());
  return {
    image: placeholder ? PLACEHOLDER_IMAGE : String(c.image),
    width,
    height,
    name: String(c.name || '').trim() || DEFAULT_MAP_NAME,
    isPlaceholder: placeholder,
  };
}

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

/** Journal notes (and other locations) that link to loc. -> [{title, href, context, snippet}] */
export function backlinks(loc) {
  const key = nameKey(loc.name);
  const ids = new Set([loc.id, String(loc.id).toLowerCase()]);
  const matches = (l) => {
    if (l.prefix === 'map') return ids.has(l.target) || ids.has(String(l.target).toLowerCase()) || nameKey(l.target) === key;
    if (!l.prefix) return nameKey(l.target) === key;
    return false;
  };
  const docs = store.list(JOURNAL_DIR, { recursive: true });
  const chapters = new Map();
  for (const { path, data } of docs) {
    if (path.endsWith('/_chapter.json') && data && typeof data === 'object') chapters.set(path.split('/')[2], data);
  }
  const out = [];
  for (const { path, data } of docs) {
    if (!path.endsWith('.md') || typeof data !== 'string') continue;
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
    if (other.id === loc.id || !other.description.includes('[[')) continue;
    if (extractLinks(other.description).some(matches)) out.push({ title: other.name, href: href('map', 'loc', other.id), context: 'Map', snippet: '' });
  }
  return out;
}

// ---------- cache invalidation + link type ----------

store.on((ev) => {
  const paths = ev.path ? [ev.path] : ev.paths || [];
  const all = ev.type === 'load';
  if (all || paths.some((p) => p.startsWith(`${LOC_DIR}/`))) locIndex = null;
  if (all || paths.some((p) => p.startsWith(`${TYPE_DIR}/`))) refreshTypes();
});
refreshTypes();

registerLinkType('map', {
  label: 'Location',
  order: 20,
  resolve(target) {
    const loc = findLocation(target);
    if (!loc) return null;
    return { href: href('map', 'loc', loc.id), title: `${loc.name} · ${typeOf(loc.type).name} (map)`, exists: true };
  },
  suggest(q) {
    return matchNames(locations(), q, (l) => l.name, 10).map((l) => ({ label: l.name, value: l.name }));
  },
  embed(target) {
    const loc = findLocation(target);
    if (!loc) return null;
    return { markdown: loc.description.trim() || `*${typeOf(loc.type).name} on the map. No description yet.*` };
  },
});
