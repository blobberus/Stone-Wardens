// buildRules (pure indexing of SRD + stub + custom data) and loadRules (browser loader with cache).
import { asArray, isObj } from './engine-util.js';

/** files key -> srd file name. */
const SRD_FILES = {
  classes: 'classes', features: 'features', subclasses: 'subclasses', species: 'species', backgrounds: 'backgrounds',
  feats: 'feats', spells: 'spells', weapons: 'weapons', armor: 'armor', gear: 'gear', magicItems: 'magic-items', rules: 'rules',
};
const STUB_FILES = { subclasses: 'stubs/subclasses', species: 'stubs/species', backgrounds: 'stubs/backgrounds', feats: 'stubs/feats' };
/** compendium kind -> files key. */
export const CUSTOM_KINDS = {
  weapon: 'weapons', armor: 'armor', gear: 'gear', 'magic-item': 'magicItems', spell: 'spells', feat: 'feats',
  ability: 'abilities', species: 'species', class: 'classes', subclass: 'subclasses', background: 'backgrounds',
};
const KIND_OF = Object.fromEntries(Object.entries(CUSTOM_KINDS).map(([k, v]) => [v, k]));

const byNameSort = (a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, { sensitivity: 'base', numeric: true });

/** melee/ranged of a weapon record from any source (raw srd uses `kind`, compendium/custom entries `weaponKind`). */
export const weaponKindOf = (w) => w?.weaponKind ?? (w?.kind === 'melee' || w?.kind === 'ranged' ? w.kind : (w?.range && !w?.thrown ? 'ranged' : 'melee'));

function normalizeRecord(list, e, origin) {
  const kind = KIND_OF[list];
  const rec = { ...e, origin: e.origin || origin };
  if (list === 'weapons') {
    rec.weaponKind = weaponKindOf(e);
    rec.kind = 'weapon';
  } else if (kind && !rec.kind) rec.kind = kind;
  return rec;
}

function mergeList(listName, base, stubs, custom) {
  const byId = new Map();
  for (const e of asArray(base)) if (e?.id) byId.set(e.id, normalizeRecord(listName, e, 'srd'));
  for (const e of asArray(stubs)) if (e?.id) byId.set(e.id, normalizeRecord(listName, e, 'stub'));
  for (const e of asArray(custom)) if (e?.id) byId.set(e.id, normalizeRecord(listName, e, 'custom'));
  return [...byId.values()].sort(byNameSort);
}

const index = (list) => Object.fromEntries(list.map((e) => [e.id, e]));

/**
 * Pure: index raw files into lookups. `files` = {classes, features, subclasses, species, backgrounds, feats, spells,
 * weapons, armor, gear, magicItems, rules, stubs:{subclasses, species, backgrounds, feats}, custom:{<kind|filesKey>:[…]}}.
 */
export function buildRules(files = {}) {
  const f = files || {};
  const stubs = f.stubs || {};
  const customIn = f.custom || {};
  const custom = {};
  for (const [k, v] of Object.entries(customIn)) custom[CUSTOM_KINDS[k] || k] = asArray(v);

  const core = isObj(f.rules) ? f.rules : {};
  const lists = {};
  for (const key of ['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'spells', 'weapons', 'armor', 'gear', 'magicItems']) {
    lists[key] = mergeList(key, f[key], stubs[key], custom[key]);
  }
  lists.abilities = mergeList('abilities', [], [], custom.abilities);

  // Features: features.json is an object keyed by id (accept an array too); custom classes may embed features.
  const featureById = {};
  const rawFeatures = Array.isArray(f.features) ? f.features : Object.values(f.features || {});
  for (const ft of rawFeatures) if (ft?.id) featureById[ft.id] = ft;
  for (const cls of lists.classes) {
    const own = Array.isArray(cls.features) ? cls.features : Object.values(isObj(cls.features) ? cls.features : {});
    for (const ft of own) if (ft?.id) featureById[ft.id] = { class: cls.id, subclass: null, ...ft };
  }
  // Subclass features (embedded): index them too, preferring the richer features.json record.
  const subclassFeatureById = {};
  for (const sc of lists.subclasses) {
    sc.features = asArray(sc.features).map((ft) => ({ ...(featureById[ft.id] || {}), ...ft, class: sc.class, subclass: sc.id }));
    for (const ft of sc.features) if (ft?.id) subclassFeatureById[ft.id] = ft;
  }

  const subclassesByClass = {};
  for (const sc of lists.subclasses) (subclassesByClass[sc.class] = subclassesByClass[sc.class] || []).push(sc);

  const spellsByClass = {};
  for (const sp of lists.spells) for (const c of asArray(sp.classes)) (spellsByClass[c] = spellsByClass[c] || []).push(sp);

  const tools = lists.gear.filter((g) => g.tool);
  const skills = asArray(core.skills);
  const languages = asArray(core.languages);

  const nameIndex = {};
  for (const key of ['weapons', 'armor']) for (const e of lists[key]) nameIndex[e.name.toLowerCase()] = e.id;

  return {
    core,
    ...lists,
    classById: index(lists.classes),
    subclassById: index(lists.subclasses),
    speciesById: index(lists.species),
    backgroundById: index(lists.backgrounds),
    featById: index(lists.feats),
    spellById: index(lists.spells),
    weaponById: index(lists.weapons),
    armorById: index(lists.armor),
    gearById: index(lists.gear),
    magicItemById: index(lists.magicItems),
    abilityById: index(lists.abilities),
    features: featureById,
    featureById,
    subclassFeatureById,
    subclassesByClass,
    spellsByClass,
    tools,
    toolById: index(tools),
    skills,
    skillById: index(skills),
    languages,
    languageById: index(languages),
    abilityList: asArray(core.abilities),
    damageTypes: asArray(core.damageTypes),
    weaponMasteries: asArray(core.weaponMasteries),
    masteryById: index(asArray(core.weaponMasteries)),
    weaponProperties: asArray(core.weaponProperties),
    propertyById: index(asArray(core.weaponProperties)),
    sizes: asArray(core.sizes),
    custom,
    /** "Longsword" / "Plate Armor" -> id (weapons + armor). */
    itemIdByName: (name) => nameIndex[String(name || '').trim().toLowerCase()] || null,
  };
}

// ----- browser loader ------------------------------------------------------------------------

let cache = null;

/**
 * Browser: loads every srd file through compendium.srd and the custom library entries through
 * compendium.entries(kind) (origin 'custom' only), then buildRules. Cached until invalidateRules().
 * opts.reload forces a refresh.
 */
export function loadRules(opts = {}) {
  if (opts?.reload) cache = null;
  if (!cache) {
    cache = (async () => {
      const comp = await import('../../core/compendium.js');
      const get = async (name) => {
        try { return await comp.srd(name); } catch (e) { console.warn(`[engine] srd/${name}.json unavailable`, e); return null; }
      };
      const files = { stubs: {}, custom: {} };
      await Promise.all([
        ...Object.entries(SRD_FILES).map(async ([key, name]) => { files[key] = await get(name); }),
        ...Object.entries(STUB_FILES).map(async ([key, name]) => { files.stubs[key] = await get(name); }),
        ...Object.keys(CUSTOM_KINDS).map(async (kind) => {
          try {
            const list = await comp.entries(kind);
            files.custom[kind] = asArray(list).filter((e) => e.origin === 'custom');
          } catch (e) { files.custom[kind] = []; }
        }),
      ]);
      return buildRules(files);
    })().catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/** Drop the cached rules (call after custom library entries change). */
export function invalidateRules() { cache = null; }
