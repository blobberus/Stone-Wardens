// Merged rules library: SRD 5.2 data + stubs (non-SRD, own-words summaries) + custom entries from the repo.
import { store } from './store.js';
import { uid, byName } from './util.js';
import { getSetting } from './settings.js';

export const KINDS = [
  { kind: 'weapon', label: 'Weapons', one: 'Weapon', srd: 'weapons' },
  { kind: 'armor', label: 'Armor', one: 'Armor', srd: 'armor' },
  { kind: 'gear', label: 'Gear & Tools', one: 'Gear', srd: 'gear' },
  { kind: 'magic-item', label: 'Magic Items', one: 'Magic item', srd: 'magic-items' },
  { kind: 'spell', label: 'Spells', one: 'Spell', srd: 'spells' },
  { kind: 'feat', label: 'Feats', one: 'Feat', srd: 'feats', stubs: 'stubs/feats' },
  { kind: 'ability', label: 'Abilities', one: 'Ability' },
  { kind: 'species', label: 'Species', one: 'Species', srd: 'species', stubs: 'stubs/species' },
  { kind: 'class', label: 'Classes', one: 'Class', srd: 'classes' },
  { kind: 'subclass', label: 'Subclasses', one: 'Subclass', srd: 'subclasses', stubs: 'stubs/subclasses' },
  { kind: 'background', label: 'Backgrounds', one: 'Background', srd: 'backgrounds', stubs: 'stubs/backgrounds' },
  { kind: 'location-type', label: 'Location Types', one: 'Location type' },
];
export const kindInfo = (kind) => KINDS.find((k) => k.kind === kind);

const fileCache = new Map();
const merged = new Map(); // kind -> array (sync access once loaded)

/** Raw SRD file loader: srd('rules'), srd('features'), srd('stubs/feats'). */
export function srd(name) {
  if (!fileCache.has(name)) {
    fileCache.set(name, fetch(`srd/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`srd/${name}.json: ${r.status}`);
      return r.json();
    }).catch((e) => { fileCache.delete(name); throw e; }));
  }
  return fileCache.get(name);
}

const customDir = (kind) => `content/library/${kind}`;

function customEntries(kind) {
  return store.list(customDir(kind)).map(({ path, data }) => ({ ...data, kind, origin: 'custom', path }));
}

/** All entries of a kind, custom overriding SRD/stub entries with the same id. */
export async function entries(kind) {
  const info = kindInfo(kind);
  const load = async (file, origin) => {
    if (!file) return [];
    try {
      const data = await srd(file);
      // A record's own `kind` (weapons: 'melee'|'ranged') would be shadowed by the compendium kind: keep it as weaponKind.
      return (Array.isArray(data) ? data : Object.values(data)).map((e) => ({
        ...e, ...(e.kind && e.kind !== kind ? { weaponKind: e.kind } : null), kind, origin,
      }));
    } catch (e) {
      console.warn(`[compendium] ${file} unavailable`, e);
      return [];
    }
  };
  const [base, stubs] = await Promise.all([load(info?.srd, 'srd'), load(info?.stubs, 'stub')]);
  const byId = new Map();
  for (const e of [...base, ...stubs, ...customEntries(kind)]) byId.set(e.id, e);
  const list = [...byId.values()].sort(byName);
  merged.set(kind, list);
  return list;
}

/** Synchronous access to the last loaded list (empty until entries(kind)/preload ran). */
export function cached(kind) {
  return merged.get(kind) || [];
}

export async function entry(kind, id) {
  return (await entries(kind)).find((e) => e.id === id) || null;
}

export function findByName(kind, name) {
  const n = String(name || '').trim().toLowerCase();
  return cached(kind).find((e) => e.name?.toLowerCase() === n || e.id === n) || null;
}

/** Create or update a custom entry. Returns the saved object. */
export function saveCustom(kind, obj) {
  // Editing a custom entry keeps its id; copying an SRD/stub entry (or a new one) gets a fresh id.
  const id = obj.origin === 'custom' && obj.id ? obj.id : uid(obj.name);
  const { path: _p, origin: _o, kind: _k, ...rest } = obj;
  const data = {
    ...rest, id,
    createdBy: rest.createdBy || getSetting('playerName') || undefined,
    updated: new Date().toISOString(),
  };
  store.put(`${customDir(kind)}/${id}.json`, data);
  refreshKind(kind);
  return { ...data, kind, origin: 'custom' };
}

export function removeCustom(kind, id) {
  store.remove(`${customDir(kind)}/${id}.json`);
  refreshKind(kind);
}

function refreshKind(kind) {
  if (!merged.has(kind)) return;
  entries(kind);
}

let readyPromise = null;
/** Load every kind once (used for link resolution). Re-merges custom entries when the store changes. */
export function preloadAll() {
  if (!readyPromise) {
    readyPromise = Promise.all(KINDS.map((k) => entries(k.kind))).then(() => true);
    store.on((ev) => {
      const paths = ev.path ? [ev.path] : ev.paths || [];
      const kinds = new Set(paths.filter((p) => p.startsWith('content/library/')).map((p) => p.split('/')[2]));
      if (ev.type === 'load') KINDS.forEach((k) => kinds.add(k.kind));
      kinds.forEach((k) => merged.has(k) && entries(k));
    });
  }
  return readyPromise;
}
