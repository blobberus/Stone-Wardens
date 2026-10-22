// Character documents: paths, defaults, listing, lookup and debounced persistence.
// Only player decisions are stored (docs/character-model.md); everything else is derived.
import { store } from '../../core/store.js';
import { nameKey, clone } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';
import { normalizeFavorites } from './engine-favs.js';

export const VIEW = 'characters';
export const DIR = 'content/characters';
export const PORTRAIT_DIR = `${DIR}/portraits`;
export const pathOf = (id) => `${DIR}/${id}.json`;
export const idFromPath = (p) => String(p).split('/').pop().replace(/\.json$/, '');

export const ABILITIES = [
  { id: 'str', name: 'STR', full: 'Strength' },
  { id: 'dex', name: 'DEX', full: 'Dexterity' },
  { id: 'con', name: 'CON', full: 'Constitution' },
  { id: 'int', name: 'INT', full: 'Intelligence' },
  { id: 'wis', name: 'WIS', full: 'Wisdom' },
  { id: 'cha', name: 'CHA', full: 'Charisma' },
];
export const ABILITY_IDS = ABILITIES.map((a) => a.id);
export const abilityName = (id) => ABILITIES.find((a) => a.id === id)?.full || String(id || '').toUpperCase();

/** Fallback skill list (rules.json `skills` is preferred when loaded). */
export const SKILLS = [
  ['acrobatics', 'Acrobatics', 'dex'], ['animal-handling', 'Animal Handling', 'wis'], ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'], ['deception', 'Deception', 'cha'], ['history', 'History', 'int'],
  ['insight', 'Insight', 'wis'], ['intimidation', 'Intimidation', 'cha'], ['investigation', 'Investigation', 'int'],
  ['medicine', 'Medicine', 'wis'], ['nature', 'Nature', 'int'], ['perception', 'Perception', 'wis'],
  ['performance', 'Performance', 'cha'], ['persuasion', 'Persuasion', 'cha'], ['religion', 'Religion', 'int'],
  ['sleight-of-hand', 'Sleight of Hand', 'dex'], ['stealth', 'Stealth', 'dex'], ['survival', 'Survival', 'wis'],
].map(([id, name, ability]) => ({ id, name, ability }));

/** Sheet highlight colour (ability boxes, proficiency marks): `char.style.accent`; null = this default (oxblood). */
export const DEFAULT_ACCENT = '#7a1f1f';
/** Presets = the theme-independent pin pigments (tokens.css), each readable with light or dark ink. */
export const ACCENT_PRESETS = [
  ['Oxblood', '#7a1f1f'], ['Vermilion', '#a8321c'], ['Ochre', '#82600f'], ['Verdigris', '#23675f'], ['Green', '#3b6b2a'],
  ['Lapis', '#22507c'], ['Slate', '#465266'], ['Murrey', '#6e3a5c'], ['Umber', '#5c4a36'], ['Iron gall', '#1f1a14'],
].map(([name, value]) => ({ name, value }));

export const CURRENCY = [
  { id: 'cp', name: 'Copper', gp: 0.01 }, { id: 'sp', name: 'Silver', gp: 0.1 }, { id: 'ep', name: 'Electrum', gp: 0.5 },
  { id: 'gp', name: 'Gold', gp: 1 }, { id: 'pp', name: 'Platinum', gp: 10 },
];

/** Every template field of the bio. `long` fields are Markdown (links render as hyperlinks). */
export const DETAIL_FIELDS = [
  { key: 'alignment', label: 'Alignment', group: 'identity', type: 'alignment' },
  { key: 'pronouns', label: 'Pronouns', group: 'identity' },
  { key: 'gender', label: 'Gender', group: 'identity' },
  { key: 'sexuality', label: 'Sexuality', group: 'identity' },
  { key: 'age', label: 'Age', group: 'identity' },
  { key: 'height', label: 'Height', group: 'look' },
  { key: 'weight', label: 'Weight', group: 'look' },
  { key: 'eyes', label: 'Eyes', group: 'look' },
  { key: 'hair', label: 'Hair', group: 'look' },
  { key: 'skin', label: 'Skin', group: 'look' },
  { key: 'location', label: 'Location', group: 'world', hint: 'Where they are now. Try [[map:Place]].' },
  { key: 'groups', label: 'Associated group', group: 'world' },
  { key: 'religion', label: 'Religion', group: 'world' },
  { key: 'appearance', label: 'Appearance', long: true },
  { key: 'personalityTraits', label: 'Personality traits', long: true },
  { key: 'socialTraits', label: 'Social traits', long: true },
  { key: 'mentalTraits', label: 'Mental traits', long: true },
  { key: 'ideals', label: 'Ideals', long: true },
  { key: 'bonds', label: 'Bonds', long: true },
  { key: 'flaws', label: 'Flaws', long: true },
  { key: 'likes', label: 'Likes', long: true },
  { key: 'dislikes', label: 'Dislikes', long: true },
  { key: 'resistances', label: 'Resistances (notes)', long: true, hint: 'Free notes; resistances from species, feats and items are listed automatically.' },
  { key: 'backstory', label: 'Backstory', long: true },
];

export const SECTION_IDS = ['hp', 'ac', 'initiative', 'speed', 'abilities', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'saves',
  'skills', 'passive', 'attacks', 'spells', 'bonus-actions', 'slots', 'features', 'resources', 'inventory', 'currency', 'death-saves',
  'proficiencies', 'details', 'notes'];

/** Friendly anchors used in [[char:Name#…]] links -> section ids. */
const ANCHOR_ALIASES = {
  'hit-points': 'hp', 'health': 'hp', 'armor-class': 'ac', 'armour-class': 'ac', 'init': 'initiative',
  'strength': 'str', 'dexterity': 'dex', 'constitution': 'con', 'intelligence': 'int', 'wisdom': 'wis', 'charisma': 'cha',
  'ability-scores': 'abilities', 'saving-throws': 'saves', 'saving-throw': 'saves', 'passive-perception': 'passive',
  'passive-scores': 'passive', 'weapons': 'attacks', 'attack': 'attacks', 'spellcasting': 'spells', 'spell-slots': 'slots',
  'traits': 'features', 'feats': 'features', 'abilities-and-features': 'features', 'items': 'inventory', 'equipment': 'inventory',
  'gear': 'inventory', 'money': 'currency', 'coins': 'currency', 'gold': 'currency', 'death': 'death-saves',
  'languages': 'proficiencies', 'bio': 'details', 'biography': 'details', 'backstory': 'details', 'note': 'notes',
  'actions': 'attacks', 'bonus': 'bonus-actions', 'bonus-action': 'bonus-actions', 'senses': 'passive',
};
export function normalizeAnchor(anchor) {
  const a = String(anchor || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ANCHOR_ALIASES[a] || a;
}

const EMPTY_DETAILS = Object.fromEntries([...DETAIL_FIELDS.map((f) => f.key), 'notes'].map((k) => [k, '']));

/** A blank stored document (level 0 until a class is chosen). */
export function blankCharacter({ name = '', player = '' } = {}) {
  const now = new Date().toISOString();
  return {
    id: '', name, player, portrait: null,
    species: { id: null, subspecies: null, size: null },
    background: { id: null, abilityBonuses: {} },
    classes: [],
    abilityMethod: 'standard',
    baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    choices: {},
    skills: [],
    extraProficiencies: { skills: [], expertise: [], saves: [], armor: [], weapons: [], tools: [], languages: [] },
    feats: [],
    spells: [],
    slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0,
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    hp: { current: null, temp: 0 }, hitDiceUsed: {}, deathSaves: { success: 0, fail: 0 },
    resourcesUsed: {}, conditions: [], exhaustion: 0, heroicInspiration: false, xp: 0,
    abilities: [],
    favorites: { items: [], skills: [], features: [] }, // starred entries (engine-favs.js)
    overrides: {
      ac: null, speed: null, initiative: null, hpMax: null, profBonus: null, passivePerception: null, abilities: {}, saves: {}, skills: {},
      proficiency: { skills: {}, saves: {} }, // Edit all: {skills:{stealth:'none'|'proficient'|'expertise'}, saves:{dex:true|false}}
    },
    style: { accent: null },
    details: { ...EMPTY_DETAILS },
    createdBy: getSetting('playerName') || '', created: now, updated: now,
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Fill every missing field with its default so views never trip over partial docs. */
export function normalize(doc) {
  const base = blankCharacter();
  const d = isObj(doc) ? clone(doc) : {};
  const out = { ...base, ...d };
  for (const k of ['species', 'background', 'baseAbilities', 'extraProficiencies', 'currency', 'hp', 'deathSaves', 'overrides', 'style', 'details']) {
    out[k] = { ...base[k], ...(isObj(d[k]) ? d[k] : {}) };
  }
  for (const k of ['abilities', 'saves', 'skills']) out.overrides[k] = isObj(out.overrides[k]) ? out.overrides[k] : {};
  const op = isObj(out.overrides.proficiency) ? out.overrides.proficiency : {};
  out.overrides.proficiency = { skills: isObj(op.skills) ? op.skills : {}, saves: isObj(op.saves) ? op.saves : {} };
  if (!/^#[0-9a-f]{6}$/i.test(out.style.accent || '')) out.style.accent = null;
  for (const k of Object.keys(base.extraProficiencies)) out.extraProficiencies[k] = Array.isArray(out.extraProficiencies[k]) ? out.extraProficiencies[k] : [];
  for (const k of ['classes', 'skills', 'feats', 'spells', 'inventory', 'conditions', 'abilities']) out[k] = Array.isArray(d[k]) ? d[k] : [];
  for (const k of ['choices', 'hitDiceUsed', 'resourcesUsed']) out[k] = isObj(d[k]) ? d[k] : {};
  if (!isObj(out.background.abilityBonuses)) out.background.abilityBonuses = {};
  out.slotsUsed = Array.from({ length: 9 }, (_, i) => Number(out.slotsUsed?.[i]) || 0);
  out.classes = out.classes.filter((c) => c && c.id).map((c) => ({ ...c, level: Math.max(1, Number(c.level) || 1), hp: Array.isArray(c.hp) ? c.hp : [] }));
  out.inventory = out.inventory.filter(Boolean).map((it) => ({ qty: 1, equipped: false, attuned: false, notes: '', custom: null, ...it, uid: it.uid || shortId() }));
  out.favorites = normalizeFavorites(d.favorites, out); // drops stars of deleted items / removed custom abilities
  return out;
}

export const shortId = () => Math.random().toString(36).slice(2, 8);
export const totalLevel = (char) => (char?.classes || []).reduce((n, c) => n + (Number(c.level) || 0), 0);

// ---------- listing & lookup ----------

export function listCharacters() {
  return store.list(DIR)
    .filter((d) => d.path.endsWith('.json') && d.data && typeof d.data === 'object')
    .map(({ path, data }) => normalize({ ...data, id: data.id || idFromPath(path) }));
}

export function getCharacter(id) {
  const data = store.get(pathOf(id));
  return data ? normalize({ ...data, id: data.id || id }) : null;
}

/** Match by id or by name, case/diacritic-insensitive. */
export function findCharacter(target) {
  const t = nameKey(target);
  if (!t) return null;
  const all = listCharacters();
  return all.find((c) => c.id === target) || all.find((c) => nameKey(c.id) === t) || all.find((c) => nameKey(c.name) === t) || null;
}

// ---------- persistence (local draft now, the global Save commits) ----------

const timers = new Map(); // id -> {timer, char}
let selfWrite = null;

/** True while our own store.put is emitting (so listeners can ignore it). */
export const isSelfWrite = (path) => selfWrite === path;

function write(char) {
  const path = pathOf(char.id);
  timers.delete(char.id);
  selfWrite = path;
  try { store.put(path, char); } finally { selfWrite = null; }
}

/** Persist a character as a local draft, debounced ~300ms (immediate with {now:true}). */
export function persist(char, { now = false } = {}) {
  if (!char?.id) return;
  char.updated = new Date().toISOString();
  const pending = timers.get(char.id);
  if (pending) clearTimeout(pending.timer);
  if (now) { write(char); return; }
  timers.set(char.id, { char, timer: setTimeout(() => write(char), 300) });
}

export function flushPersist(id) {
  for (const [k, p] of [...timers]) {
    if (id && k !== id) continue;
    clearTimeout(p.timer);
    write(p.char);
  }
}

export const hasPendingWrite = (id) => timers.has(id);

export function removeCharacter(id) {
  const p = timers.get(id);
  if (p) { clearTimeout(p.timer); timers.delete(id); }
  store.remove(pathOf(id));
}

// ---------- recently deleted (content/characters/recently-deleted/<id>.json, restorable until emptied) ----------

export const TRASH_DIR = `${DIR}/recently-deleted`;
export const trashPathOf = (id) => `${TRASH_DIR}/${id}.json`;

/** [{char, trashed:{at, by}}], newest first. */
export function listTrash() {
  return store.list(TRASH_DIR)
    .filter((d) => d.path.endsWith('.json') && d.data && typeof d.data === 'object')
    .map(({ path, data }) => ({ char: normalize({ ...data, id: data.id || idFromPath(path) }), trashed: data.trashed || {} }))
    .sort((a, b) => String(b.trashed.at || '').localeCompare(String(a.trashed.at || '')));
}

/** Move a sheet into Recently deleted. */
export function trashCharacter(id) {
  flushPersist(id);
  const doc = store.get(pathOf(id));
  if (!doc) return false;
  store.put(trashPathOf(id), { ...doc, trashed: { at: new Date().toISOString(), by: getSetting('playerName') || '' } });
  removeCharacter(id);
  return true;
}

/** Put a deleted sheet back in the roster. Returns its (possibly new) id. */
export function restoreCharacter(id) {
  const doc = store.get(trashPathOf(id));
  if (!doc) return null;
  const { trashed, ...rest } = doc;
  const target = store.has(pathOf(id)) ? `${id}-${shortId()}` : id;
  store.put(pathOf(target), { ...rest, id: target });
  store.remove(trashPathOf(id));
  return target;
}

/** Delete a sheet from Recently deleted for good (plus its uploaded portrait if nothing else uses it). */
export function purgeCharacter(id) {
  const doc = store.get(trashPathOf(id));
  store.remove(trashPathOf(id));
  const pic = doc?.portrait;
  if (typeof pic === 'string' && pic.startsWith(`${PORTRAIT_DIR}/`)
    && ![...listCharacters(), ...listTrash().map((t) => t.char)].some((c) => c.portrait === pic)) store.remove(pic);
}

// ---------- small text helpers ----------

/** "thieves-tools" -> "Thieves Tools" (used when an id has no catalog entry). */
export function prettify(id) {
  return String(id ?? '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Escape text so it is safe inside a markdown table cell / wikilink alias. */
export const mdSafe = (s) => String(s ?? '').replace(/[|[\]]/g, (c) => `\\${c}`);
