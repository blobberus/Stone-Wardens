// Compendium metadata: rules lookups, formatters, per-kind table columns, quick filters and stat lines.
// Pure-ish helpers (DOM only for small cell nodes); everything sync once rulesReady() resolved.
import { KINDS, kindInfo, srd, cached, entries } from '../../core/compendium.js';
import { href } from '../../core/router.js';
import { h } from '../../core/dom.js';
import { nameKey } from '../../core/util.js';
import { rankName } from '../map/ranks.js';

// ---------- rules (sync access after load) ----------

export let RULES = {};
const rulesPromise = srd('rules').then((r) => { RULES = r || {}; return RULES; }).catch((e) => {
  console.warn('[compendium] rules unavailable', e);
  return RULES;
});
export const rulesReady = () => rulesPromise;

// ---------- kinds ----------

const PREFIX = {
  weapon: 'weapon', armor: 'armor', gear: 'gear', 'magic-item': 'item', spell: 'spell', feat: 'feat',
  ability: 'ability', species: 'species', class: 'class', subclass: 'subclass', background: 'background',
};
const ICONS = {
  weapon: 'sword', armor: 'shield', gear: 'backpack', 'magic-item': 'sparkle', spell: 'scroll', feat: 'star',
  ability: 'level-up', species: 'users', class: 'user', subclass: 'layers', background: 'book-open', 'location-type': 'pin',
};
const BLURBS = {
  weapon: 'Every simple and martial weapon, with masteries.',
  armor: 'Light, medium and heavy armor and shields.',
  gear: 'Adventuring gear, tools, foci and packs.',
  'magic-item': 'Wondrous items, arms, rings, potions and more.',
  spell: 'Cantrips to 9th level, by class and school.',
  feat: 'Origin, general, fighting style and epic boon feats.',
  ability: 'Custom abilities for character sheets.',
  species: 'Playable species and their traits.',
  class: 'The twelve classes, level by level.',
  subclass: 'Subclasses for every class.',
  background: 'Backgrounds: ability scores, feat, skills, tool.',
  'location-type': 'Map pin types: icon and colour.',
};

export const linkPrefix = (kind) => PREFIX[kind] || null;
export const kindForPrefix = (p) => Object.keys(PREFIX).find((k) => PREFIX[k] === String(p || '').toLowerCase()) || null;
export const LINK_KINDS = Object.keys(PREFIX);
export const kindLabel = (kind) => kindInfo(kind)?.label || prettify(kind);
export const kindOne = (kind) => kindInfo(kind)?.one || prettify(kind);
export const kindIcon = (kind) => ICONS[kind] || 'file';
export const kindBlurb = (kind) => BLURBS[kind] || '';
export const isKind = (kind) => !!kindInfo(kind);
export { KINDS };

export const entryHref = (e) => href('compendium', e.kind, e.id);

/** The [[prefix:Name]] text for an entry (id form when the name is ambiguous or unsafe). */
export function linkText(e) {
  const p = linkPrefix(e?.kind);
  if (!p) return null;
  const name = String(e.name || e.id);
  const key = nameKey(name);
  const dupes = cached(e.kind).filter((x) => nameKey(x.name) === key).length;
  if (/[[\]|#]/.test(name) || dupes > 1) return `[[${p}:${e.id}|${name.replace(/[[\]|]/g, '')}]]`;
  return `[[${p}:${name}]]`;
}

// ---------- generic helpers ----------

export function prettify(s) {
  return String(s ?? '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}
const list = (key) => (Array.isArray(RULES[key]) ? RULES[key] : []);
export const ruleList = list;
function ruleName(key, id) {
  const hit = list(key).find((x) => x.id === id);
  return hit?.name || prettify(id);
}
export const ruleDesc = (key, id) => list(key).find((x) => x.id === id)?.description || '';

const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const ABILITY_IDS = Object.keys(ABIL);
export const abilityName = (id) => list('abilities').find((a) => a.id === id)?.full || ABIL[id] || prettify(id);
export const abilityAbbr = (id) => (ABIL[id] ? id.charAt(0).toUpperCase() + id.slice(1) : prettify(id));
export const skillName = (id) => ruleName('skills', id);
export const damageName = (id) => ruleName('damageTypes', id);
export const schoolName = (id) => ruleName('magicSchools', id);
export const propertyName = (id) => ruleName('weaponProperties', id);
export const masteryName = (id) => (id ? ruleName('weaponMasteries', id) : '');
export const SKILL_IDS = () => list('skills').map((s) => s.id);

export function entryName(kind, id) {
  if (!id) return '';
  return cached(kind).find((e) => e.id === id)?.name || prettify(id);
}
export const className = (id) => entryName('class', id);

export const CLASS_IDS = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
export function classOptions() {
  const known = cached('class');
  const ids = known.length ? known.map((c) => c.id) : CLASS_IDS;
  return ids.map((id) => ({ value: id, label: className(id) }));
}

export const GEAR_CATS = {
  'adventuring-gear': 'Adventuring Gear', 'artisans-tools': 'Artisan’s Tools', 'musical-instruments': 'Musical Instrument',
  'gaming-sets': 'Gaming Set', 'other-tools': 'Other Tools', 'holy-symbols': 'Holy Symbol', 'arcane-foci': 'Arcane Focus',
  'druidic-foci': 'Druidic Focus', 'equipment-packs': 'Equipment Pack', ammunition: 'Ammunition',
};
export const ITEM_CATS = {
  'wondrous-item': 'Wondrous Item', armor: 'Armor', weapon: 'Weapon', ring: 'Ring', potion: 'Potion', wand: 'Wand',
  staff: 'Staff', rod: 'Rod', scroll: 'Scroll',
};
export const RARITIES = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', 'very-rare': 'Very Rare', legendary: 'Legendary',
  artifact: 'Artifact', varies: 'Varies',
};
const RARITY_RANK = { common: 1, uncommon: 2, varies: 2.5, rare: 3, 'very-rare': 4, legendary: 5, artifact: 6 };
export const FEAT_CATS = { origin: 'Origin', general: 'General', 'fighting-style': 'Fighting Style', 'epic-boon': 'Epic Boon' };
export const ARMOR_CATS = { light: 'Light', medium: 'Medium', heavy: 'Heavy', shield: 'Shield' };
export const CASTER_KINDS = { full: 'Full caster', half: 'Half caster', pact: 'Pact Magic', third: 'One-third caster' };
export const ORIGINS = { srd: 'SRD 5.2', stub: 'Stub', custom: 'Custom', builtin: 'Built-in' };
export const COIN_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];
export const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
export const spellLevelLabel = (lvl) => (Number(lvl) === 0 ? 'Cantrip' : `Level ${lvl}`);
export const spellLevelShort = (lvl) => (Number(lvl) === 0 ? 'Cantrip' : ordinal(Number(lvl)));

// ---------- formatters ----------

export function fmtCost(c) {
  if (!c || c.qty == null || c.qty === '') return '—';
  return `${Number(c.qty).toLocaleString()} ${String(c.unit || 'gp').toUpperCase()}`;
}
export const costCp = (c) => (c && Number.isFinite(Number(c.qty)) ? Number(c.qty) * (COIN_CP[c.unit] || 100) : -1);

export function fmtWeight(w) {
  if (w == null || w === '' || Number(w) === 0) return '—';
  const n = Number(w);
  const frac = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  if (frac[n]) return `${frac[n]} lb.`;
  const whole = Math.floor(n);
  if (frac[n - whole]) return `${whole}${frac[n - whole]} lb.`;
  return `${n} lb.`;
}

const rng = (r) => (r && r.normal ? `${r.normal}${r.long ? `/${r.long}` : ''}` : '');

export function fmtDamage(e) {
  if (!e?.damage) return '—';
  return `${e.damage}${e.damageType ? ` ${damageName(e.damageType)}` : ''}`;
}

/** Weapon properties as display strings: "Versatile (1d10)", "Thrown (Range 20/60)". */
export function weaponProps(e) {
  const out = [];
  for (const p of e?.properties || []) {
    const name = propertyName(p);
    if (p === 'versatile' && e.versatile) out.push(`${name} (${e.versatile})`);
    else if (p === 'thrown' && e.thrown) out.push(`${name} (Range ${rng(e.thrown)})`);
    else if (p === 'ammunition' && e.range) out.push(`${name} (Range ${rng(e.range)}${e.ammunition ? `; ${ammoName(e.ammunition)}` : ''})`);
    else if (p === 'range' && e.range) out.push(`${name} (${rng(e.range)})`);
    else out.push(name);
  }
  return out;
}
function ammoName(id) {
  const n = entryName('gear', id);
  return n.replace(/\s*\(.*\)$/, '').replace(/s$/, '') || n;
}

export function armorAC(e) {
  const ac = e?.ac || {};
  if (ac.base == null) return '—';
  if (e.category === 'shield') return `+${ac.base}`;
  if (ac.dex && ac.maxDex != null) return `${ac.base} + Dex modifier (max ${ac.maxDex})`;
  if (ac.dex) return `${ac.base} + Dex modifier`;
  return String(ac.base);
}
const armorACShort = (e) => {
  const ac = e?.ac || {};
  if (ac.base == null) return '—';
  if (e.category === 'shield') return `+${ac.base}`;
  return `${ac.base}${ac.dex ? ` + Dex${ac.maxDex != null ? ` (max ${ac.maxDex})` : ''}` : ''}`;
};

export function spellSubtitle(e) {
  const school = schoolName(e.school);
  const classes = (e.classes || []).map(className).join(', ');
  const head = Number(e.level) === 0 ? `${school} Cantrip` : `Level ${e.level} ${school}`;
  return classes ? `${head} (${classes})` : head;
}
export function spellDuration(e) {
  const d = String(e.duration || '—');
  if (!e.concentration || /^concentration/i.test(d)) return d;
  return `Concentration, ${/^up to/i.test(d) ? d.replace(/^up to/i, 'up to') : /^\d/.test(d) ? `up to ${d}` : d}`;
}
export function spellComponents(e) {
  const c = (e.components || []).join(', ');
  return e.material && (e.components || []).includes('M') ? `${c} (${e.material})` : c || '—';
}
export function castingTime(e) {
  let t = e.castingTime || '—';
  if (e.ritual) t += ' or Ritual';
  return t;
}

export const rarityText = (e) => e.rarityText || RARITIES[e.rarity] || prettify(e.rarity) || '—';
export function itemSubtitle(e) {
  const type = e.type || ITEM_CATS[e.category] || 'Magic Item';
  const att = e.attunement ? ` (Requires Attunement${e.attunementNote ? ` ${e.attunementNote}` : ''})` : '';
  return `${type}, ${rarityText(e)}${att}`;
}

export function featSubtitle(e) {
  const cat = FEAT_CATS[e.category] || prettify(e.category) || 'Custom';
  return `${cat} Feat${e.prerequisite ? ` (Prerequisite: ${e.prerequisite})` : ''}`;
}

export function usesText(e) {
  const r = e.recharge === 'short' ? 'Short Rest' : e.recharge === 'long' ? 'Long Rest' : '';
  if (e.uses && r) return `${e.uses} / ${r}`;
  if (e.uses) return `${e.uses} use${Number(e.uses) === 1 ? '' : 's'}`;
  if (r) return `Recharges on a ${r}`;
  return '—';
}

const signed = (n) => (Number(n) >= 0 ? `+${Number(n)}` : `−${Math.abs(Number(n))}`);

/** Human summary of a `modifiers` object: ["AC +1", "Str +2", "Stealth +1", "Resistance: Fire"]. */
export function modifiersSummary(m) {
  if (!m || typeof m !== 'object') return [];
  const out = [];
  const num = (k, label, unit = '') => { if (Number(m[k])) out.push(`${label} ${signed(m[k])}${unit}`); };
  num('ac', 'AC');
  num('speed', 'Speed', ' ft.');
  num('initiative', 'Initiative');
  num('hpMax', 'HP max');
  num('hpPerLevel', 'HP per level');
  num('profBonus', 'Proficiency');
  num('attack', 'Attack rolls');
  num('damage', 'Damage rolls');
  num('spellDc', 'Spell save DC');
  num('spellAttack', 'Spell attacks');
  for (const [a, v] of Object.entries(m.abilities || {})) if (Number(v)) out.push(`${abilityAbbr(a)} ${signed(v)}`);
  for (const [a, v] of Object.entries(m.saves || {})) if (Number(v)) out.push(`${a === 'all' ? 'All saves' : `${abilityAbbr(a)} saves`} ${signed(v)}`);
  for (const [s, v] of Object.entries(m.skills || {})) if (Number(v)) out.push(`${s === 'all' ? 'All skills' : skillName(s)} ${signed(v)}`);
  if (Array.isArray(m.resistances) && m.resistances.length) out.push(`Resistance: ${m.resistances.map(damageName).join(', ')}`);
  if (m.senses) out.push(String(m.senses));
  return out;
}

export function speciesSize(e) {
  if (Array.isArray(e.sizeOptions) && e.sizeOptions.length) return e.sizeOptions.join(' or ');
  return e.size || '—';
}
export function speciesSpeed(e) {
  const extra = Object.entries(e.speeds || {}).filter(([, v]) => v).map(([k, v]) => `${prettify(k)} ${v} ft.`);
  return [e.speed ? `${e.speed} ft.` : null, ...extra].filter(Boolean).join(', ') || '—';
}

const abilList = (ids, join = ', ') => (ids || []).map(abilityName).join(join);
export const primaryAbility = (c) => abilList(c.primaryAbility, c.primaryAbilityMode === 'and' ? ' and ' : ' or ') || '—';

/** Short one-line summary of the key stats (picker rows, embeds, search). */
export function statLine(e) {
  if (!e) return '';
  switch (e.kind) {
    case 'weapon': return [`${prettify(e.category)} ${weaponKind(e)}`.trim(), fmtDamage(e), masteryName(e.mastery), fmtWeight(e.weight), fmtCost(e.cost)]
      .filter((x) => x && x !== '—').join(' · ');
    case 'armor': return [`${ARMOR_CATS[e.category] || prettify(e.category)}${e.category === 'shield' ? '' : ' armor'}`, `AC ${armorACShort(e)}`,
      e.strMin ? `Str ${e.strMin}` : null, e.stealthDisadvantage ? 'Stealth disadvantage' : null, fmtWeight(e.weight), fmtCost(e.cost)].filter((x) => x && x !== '—').join(' · ');
    case 'gear': return [GEAR_CATS[e.category] || prettify(e.category), fmtWeight(e.weight), fmtCost(e.cost)].filter((x) => x && x !== '—').join(' · ');
    case 'magic-item': return [e.type || ITEM_CATS[e.category], rarityText(e), e.attunement ? 'Attunement' : null].filter(Boolean).join(' · ');
    case 'spell': return [`${spellLevelLabel(e.level)} ${schoolName(e.school)}`, e.castingTime, e.range,
      e.concentration ? 'Concentration' : null, e.ritual ? 'Ritual' : null].filter(Boolean).join(' · ');
    case 'feat': return [`${FEAT_CATS[e.category] || 'Custom'} feat`, e.prerequisite ? `Prereq: ${e.prerequisite}` : null, e.repeatable ? 'Repeatable' : null].filter(Boolean).join(' · ');
    case 'ability': return ['Ability', usesText(e) !== '—' ? usesText(e) : null, modifiersSummary(e.modifiers).join(', ') || null].filter(Boolean).join(' · ');
    case 'species': return [e.type || 'Species', speciesSize(e), speciesSpeed(e), e.darkvision ? `Darkvision ${e.darkvision} ft.` : null].filter((x) => x && x !== '—').join(' · ');
    case 'class': return [`Hit die d${e.hitDie || '?'}`, primaryAbility(e), e.spellcasting ? CASTER_KINDS[e.spellcasting.kind] || 'Spellcaster' : null].filter((x) => x && x !== '—').join(' · ');
    case 'subclass': return [`${className(e.class)} subclass`, e.summary].filter(Boolean).join(' · ');
    case 'background': return [abilList(e.abilityScores), e.feat?.id ? entryName('feat', e.feat.id) : null, (e.skills || []).map(skillName).join(', ')].filter(Boolean).join(' · ');
    case 'location-type': return `Location type · rank ${typeRankText(e)}`;
    default: return '';
  }
}
/**
 * Melee/ranged for weapons. Merged entries carry kind:'weapon', which shadows the SRD record's own
 * kind:'melee'|'ranged'; core/compendium.js keeps it as `weaponKind` (custom weapons store `weaponKind`).
 * Fallback: SRD ranged weapons are exactly those with a `range` (thrown melee weapons only have `thrown`).
 */
export function weaponKind(e) {
  const k = e.weaponKind || (e.range ? 'ranged' : 'melee');
  return k === 'ranged' ? 'ranged' : 'melee';
}

const searchCache = new WeakMap();
/** Lower-cased haystack for quick filtering. */
export function searchText(e) {
  let s = searchCache.get(e);
  if (s == null) {
    s = [e.name, statLine(e), e.source, e.createdBy, e.type, (e.classes || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
    s = `${s} ${nameKey(e.name)}`;
    searchCache.set(e, s);
  }
  return s;
}

// ---------- location types (built-ins live in the map view) ----------

let mapData = null;
const mapReady = import('../map/data.js').then((m) => { mapData = m; }).catch(() => null);

/** Built-in map types as compendium-like entries (origin 'builtin'), when the map module is available. */
export function builtinLocationTypes() {
  if (!mapData?.BUILTIN_TYPES) return [];
  return mapData.BUILTIN_TYPES.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, rank: t.rank, major: t.rank === 1, kind: 'location-type', origin: 'builtin' }));
}

/** A location type's default map rank (older docs only have `major`). */
export const typeRank = (e) => Number(e.rank) || (e.major ? 1 : 3);
/** "2 · Notable" */
export const typeRankText = (e) => `${typeRank(e)} · ${rankName(typeRank(e))}`;
export const MARKER_ICONS = [
  'city', 'town', 'village', 'temple', 'danger', 'dungeon', 'ruins', 'castle', 'port', 'camp',
  'cave', 'forest', 'mountain', 'landmark', 'tavern', 'shop', 'portal', 'battle', 'quest', 'custom',
].map((n) => `mk-${n}`);

function mergeLocationTypes(custom) {
  const byId = new Map(builtinLocationTypes().map((t) => [t.id, t]));
  for (const c of custom) byId.set(c.id, { ...c, overrides: byId.has(c.id) || undefined });
  return [...byId.values()];
}

/** Entries of a kind for display (location types include the map's built-ins). */
export async function listEntries(kind) {
  if (kind === 'location-type') {
    const [custom] = await Promise.all([entries(kind), mapReady]);
    return mergeLocationTypes(custom).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return entries(kind);
}
export function listCached(kind) {
  if (kind === 'location-type') return mergeLocationTypes(cached(kind)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return cached(kind);
}

// ---------- quick filters ----------

const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const F = (key, label, options, test) => ({ key, label, options, test: test || ((e, v) => String(e[key] ?? '') === v) });

const ORIGIN_FILTER = F('origin', 'Origin', () => [{ value: 'srd', label: 'SRD' }, { value: 'stub', label: 'Stub' }, { value: 'custom', label: 'Custom' }],
  (e, v) => (v === 'srd' ? e.origin === 'srd' || e.origin === 'builtin' : e.origin === v));
const EDITION_FILTER = F('edition', 'Edition', () => [{ value: '2024', label: '2024 rules' }, { value: 'legacy', label: 'Legacy (2014)' }],
  (e, v) => (v === 'legacy' ? !!e.legacy : !e.legacy));

export const FILTERS = {
  weapon: [
    F('category', 'Category', () => [{ value: 'simple', label: 'Simple' }, { value: 'martial', label: 'Martial' }]),
    F('wkind', 'Melee / ranged', () => [{ value: 'melee', label: 'Melee' }, { value: 'ranged', label: 'Ranged' }], (e, v) => weaponKind(e) === v),
    F('property', 'Property', () => list('weaponProperties').map((p) => ({ value: p.id, label: p.name })), (e, v) => (e.properties || []).includes(v)),
    F('mastery', 'Mastery', () => list('weaponMasteries').map((p) => ({ value: p.id, label: p.name }))),
  ],
  armor: [F('category', 'Category', () => opts(ARMOR_CATS))],
  gear: [F('category', 'Category', () => opts(GEAR_CATS))],
  'magic-item': [
    F('rarity', 'Rarity', () => opts(RARITIES)),
    F('category', 'Type', () => opts(ITEM_CATS)),
    F('attune', 'Attunement', () => [{ value: 'yes', label: 'Requires attunement' }, { value: 'no', label: 'No attunement' }], (e, v) => !!e.attunement === (v === 'yes')),
  ],
  spell: [
    F('level', 'Level', () => SPELL_LEVELS.map((l) => ({ value: String(l), label: spellLevelLabel(l) })), (e, v) => String(e.level) === v),
    F('class', 'Class', classOptions, (e, v) => (e.classes || []).includes(v)),
    F('school', 'School', () => list('magicSchools').map((s) => ({ value: s.id, label: s.name }))),
    F('flag', 'Flags', () => [{ value: 'concentration', label: 'Concentration' }, { value: 'ritual', label: 'Ritual' }, { value: 'neither', label: 'Neither' }],
      (e, v) => (v === 'neither' ? !e.concentration && !e.ritual : !!e[v])),
  ],
  feat: [F('category', 'Category', () => opts(FEAT_CATS)), F('repeatable', 'Repeatable', () => [{ value: 'yes', label: 'Repeatable' }], (e) => !!e.repeatable)],
  ability: [F('recharge', 'Recharge', () => [{ value: 'short', label: 'Short Rest' }, { value: 'long', label: 'Long Rest' }])],
  species: [EDITION_FILTER],
  class: [F('caster', 'Spellcasting', () => [...opts(CASTER_KINDS), { value: 'none', label: 'None' }], (e, v) => (v === 'none' ? !e.spellcasting : e.spellcasting?.kind === v))],
  subclass: [F('class', 'Class', classOptions), EDITION_FILTER],
  background: [],
  'location-type': [],
};
export const filtersFor = (kind) => [...(FILTERS[kind] || []), ...(kind === 'ability' ? [] : [ORIGIN_FILTER])];

/** Apply {key: value} quick-filter values. */
export function applyFilters(kind, items, values) {
  const active = filtersFor(kind).filter((f) => values?.[f.key] != null && values[f.key] !== '');
  if (!active.length) return items;
  return items.filter((e) => active.every((f) => f.test(e, String(values[f.key]))));
}

// ---------- table columns ----------

const badgeNode = (label, cls = '', title = '') => h('span', { class: ['badge', cls], title: title || null }, label);
const flagCell = (e) => h('span', { class: 'cp-flags' },
  e.concentration ? badgeNode('C', 'cp-flag', 'Concentration') : null,
  e.ritual ? badgeNode('R', 'cp-flag', 'Ritual') : null);
const yes = (v) => (v ? 'Yes' : '—');
const swatchCell = (e) => locationSwatch(e);

/** Coloured pin swatch with the type's marker glyph. */
export function locationSwatch(e, size = 26) {
  const svg = h('svg', { class: 'icon', 'aria-hidden': 'true', width: 16, height: 16 });
  svg.append(h('use', { href: `assets/img/icons.svg#${MARKER_ICONS.includes(e.icon) ? e.icon : 'mk-custom'}` }));
  return h('span', { class: 'cp-swatch', style: { '--cp-pin': e.color || 'var(--pin-slate)', width: `${size}px`, height: `${size}px` } }, svg);
}

const C = (label, get, o = {}) => ({ label, get, sort: o.sort || get, cls: o.cls || '', key: o.key || label.toLowerCase().replace(/\W+/g, '-') });
const NAME = C('Name', (e) => e.name, { key: 'name', sort: (e) => e.name });
const SOURCE = C('Source', (e) => (e.origin === 'srd' ? 'SRD 5.2' : e.origin === 'builtin' ? 'Map' : e.origin === 'custom' ? (e.createdBy ? `Custom · ${e.createdBy}` : 'Custom') : e.source || 'Stub'), { cls: 'cell-muted' });
const AUTHOR = C('Added by', (e) => e.createdBy || '—', { cls: 'cell-muted' });

export const COLUMNS = {
  weapon: [NAME,
    C('Type', (e) => `${prettify(e.category)} ${weaponKind(e)}`),
    C('Damage', fmtDamage, { sort: (e) => diceAvg(e.damage) }),
    C('Properties', (e) => weaponProps(e).join(', ') || '—'),
    C('Mastery', (e) => masteryName(e.mastery) || '—'),
    C('Weight', (e) => fmtWeight(e.weight), { cls: 'num', sort: (e) => Number(e.weight) || 0 }),
    C('Cost', (e) => fmtCost(e.cost), { cls: 'num', sort: (e) => costCp(e.cost) })],
  armor: [NAME,
    C('Category', (e) => ARMOR_CATS[e.category] || prettify(e.category), { sort: (e) => ['light', 'medium', 'heavy', 'shield'].indexOf(e.category) }),
    C('Armor Class', armorACShort, { sort: (e) => Number(e.ac?.base) || 0 }),
    C('Strength', (e) => (e.strMin ? `Str ${e.strMin}` : '—'), { sort: (e) => Number(e.strMin) || 0 }),
    C('Stealth', (e) => (e.stealthDisadvantage ? 'Disadvantage' : '—')),
    C('Weight', (e) => fmtWeight(e.weight), { cls: 'num', sort: (e) => Number(e.weight) || 0 }),
    C('Cost', (e) => fmtCost(e.cost), { cls: 'num', sort: (e) => costCp(e.cost) })],
  gear: [NAME,
    C('Category', (e) => GEAR_CATS[e.category] || prettify(e.category)),
    C('Weight', (e) => fmtWeight(e.weight), { cls: 'num', sort: (e) => Number(e.weight) || 0 }),
    C('Cost', (e) => fmtCost(e.cost), { cls: 'num', sort: (e) => costCp(e.cost) })],
  'magic-item': [NAME,
    C('Type', (e) => e.type || ITEM_CATS[e.category] || '—'),
    C('Rarity', rarityText, { sort: (e) => RARITY_RANK[e.rarity] || 0 }),
    C('Attunement', (e) => (e.attunement ? 'Required' : '—'))],
  spell: [
    C('Level', (e) => spellLevelShort(e.level), { key: 'level', sort: (e) => Number(e.level) || 0 }),
    NAME,
    C('School', (e) => schoolName(e.school)),
    C('Casting time', (e) => e.castingTime || '—'),
    C('Range', (e) => e.range || '—'),
    C('C / R', flagCell, { key: 'flags', cls: 'center', sort: (e) => (e.concentration ? 2 : 0) + (e.ritual ? 1 : 0) }),
    C('Classes', (e) => (e.classes || []).map(className).join(', ') || '—', { cls: 'cell-muted' })],
  feat: [NAME,
    C('Category', (e) => FEAT_CATS[e.category] || prettify(e.category) || '—'),
    C('Prerequisite', (e) => e.prerequisite || '—'),
    C('Repeatable', (e) => yes(e.repeatable)),
    SOURCE],
  ability: [NAME,
    C('Uses', usesText),
    C('Modifiers', (e) => modifiersSummary(e.modifiers).join(', ') || '—'),
    AUTHOR],
  species: [NAME,
    C('Size', speciesSize),
    C('Speed', speciesSpeed, { sort: (e) => Number(e.speed) || 0 }),
    C('Darkvision', (e) => (e.darkvision ? `${e.darkvision} ft.` : '—'), { sort: (e) => Number(e.darkvision) || 0 }),
    SOURCE],
  class: [NAME,
    C('Hit die', (e) => (e.hitDie ? `d${e.hitDie}` : '—'), { sort: (e) => Number(e.hitDie) || 0 }),
    C('Primary ability', primaryAbility),
    C('Saves', (e) => (e.saves || []).map(abilityAbbr).join(', ') || '—'),
    C('Spellcasting', (e) => (e.spellcasting ? CASTER_KINDS[e.spellcasting.kind] || 'Yes' : '—')),
    SOURCE],
  subclass: [NAME,
    C('Class', (e) => className(e.class)),
    C('Summary', (e) => e.summary || '—', { cls: 'cell-muted' }),
    SOURCE],
  background: [NAME,
    C('Ability scores', (e) => (e.abilityScores || []).map(abilityAbbr).join(', ') || '—'),
    C('Feat', (e) => (e.feat?.id ? entryName('feat', e.feat.id) : '—')),
    C('Skills', (e) => (e.skills || []).map(skillName).join(', ') || '—'),
    SOURCE],
  'location-type': [
    C('', swatchCell, { key: 'icon', sort: (e) => e.icon || '' }),
    NAME,
    C('Default rank', typeRankText, { sort: typeRank }),
    C('Source', (e) => (e.origin === 'builtin' ? 'Built-in' : e.overrides ? `Custom override${e.createdBy ? ` · ${e.createdBy}` : ''}` : `Custom${e.createdBy ? ` · ${e.createdBy}` : ''}`), { cls: 'cell-muted' })],
};
export const columnsFor = (kind) => COLUMNS[kind] || [NAME, SOURCE];

/** Average of a dice string ("2d6+1" -> 8), for sorting. */
export function diceAvg(s) {
  const m = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i.exec(String(s || '').trim());
  if (!m) return Number(s) || 0;
  const n = Number(m[1] || 1);
  return n * (Number(m[2]) + 1) / 2 + Number(String(m[3] || '0').replace(/\s/g, ''));
}
export const DICE_RE = /^(\d+|\d*d\d+(\s*[+-]\s*\d+)?)$/i;
