// itemStats: resolve an inventory item to its weapon / armor / gear / magic-item record + inline `custom` overrides.
import { asArray, isObj, prettify, toNum } from './engine-util.js';
import { KNOWN_ITEMS, baseFromType, magicArmorBonus, magicWeaponBonus } from './engine-known.js';
import { weaponKindOf } from './engine-rules.js';

const LOOKUP = { weapon: 'weaponById', armor: 'armorById', gear: 'gearById', 'magic-item': 'magicItemById' };
const WEAPON_KEYS = ['category', 'weaponKind', 'damage', 'damageType', 'versatile', 'properties', 'mastery', 'range', 'thrown', 'ammunition'];
const ARMOR_KEYS = ['category', 'ac', 'strMin', 'stealthDisadvantage'];

function weaponStats(rec, over = {}) {
  if (!rec && !over.damage) return null;
  const w = { ...(rec || {}) };
  for (const k of WEAPON_KEYS) if (over[k] !== undefined) w[k] = over[k];
  if (over.kind === 'melee' || over.kind === 'ranged') w.weaponKind = over.kind;
  return {
    id: rec?.id ?? null,
    category: w.category || 'simple',
    weaponKind: weaponKindOf(w),
    damage: w.damage || '1',
    damageType: w.damageType || '',
    versatile: w.versatile || null,
    properties: asArray(w.properties),
    mastery: w.mastery || null,
    range: w.range || null,
    thrown: w.thrown || null,
    ammunition: w.ammunition || null,
  };
}

function armorStats(rec, over = {}) {
  if (!rec && !over.ac) return null;
  const a = { ...(rec || {}) };
  for (const k of ARMOR_KEYS) if (over[k] !== undefined) a[k] = over[k];
  const ac = { base: 10, dex: false, maxDex: null, ...(isObj(rec?.ac) ? rec.ac : {}), ...(isObj(over.ac) ? over.ac : {}) };
  if (typeof over.ac === 'number') ac.base = over.ac;
  if (over.acBase != null) ac.base = toNum(over.acBase, ac.base);
  return {
    id: rec?.id ?? null,
    category: a.category || 'light',
    ac: { base: toNum(ac.base, 10), dex: !!ac.dex, maxDex: ac.maxDex == null ? null : toNum(ac.maxDex) },
    strMin: a.strMin == null ? null : toNum(a.strMin),
    stealthDisadvantage: !!a.stealthDisadvantage,
  };
}

function mergeModifiers(...list) {
  const out = {};
  for (const m of list) {
    if (!isObj(m)) continue;
    for (const [k, v] of Object.entries(m)) {
      if (isObj(v)) {
        out[k] = { ...(out[k] || {}) };
        for (const [kk, vv] of Object.entries(v)) out[k][kk] = toNum(out[k][kk]) + toNum(vv);
      } else if (Array.isArray(v)) out[k] = [...asArray(out[k]), ...v];
      else if (typeof v === 'number') out[k] = toNum(out[k]) + v;
      else if (v != null && v !== '') out[k] = out[k] ? `${out[k]}, ${v}` : v;
    }
  }
  return out;
}

/**
 * Resolve an inventory entry {uid, kind, ref, name, qty, equipped, attuned, custom}. `custom` holds inline overrides:
 * any record field (name, damage, damageType, versatile, properties, mastery, range, category, ac{base,dex,maxDex},
 * strMin, weight, description), plus `base` (weapon/armor id a magic item is made from), `bonus` (+N attack & damage for
 * weapons, +N AC for armor/shields), `attackBonus`, `damageBonus`, `acBonus`, `modifiers`, `abilitySet`, `attunement`.
 */
export function itemStats(item, rules) {
  const it = isObj(item) ? item : {};
  const R = rules || {};
  const custom = isObj(it.custom) ? it.custom : {};
  let kind = it.kind || custom.kind || null;
  const ref = it.ref || null;
  let record = ref && LOOKUP[kind] ? R[LOOKUP[kind]]?.[ref] || null : null;
  if (!record && ref) {
    for (const [k, map] of Object.entries(LOOKUP)) {
      if (R[map]?.[ref]) { record = R[map][ref]; kind = k; break; }
    }
  }
  const known = kind === 'magic-item' ? KNOWN_ITEMS[ref] || {} : {};
  let weapon = null;
  let armor = null;
  let magic = null;
  const bonus = { attack: 0, damage: 0, ac: 0 };

  if (kind === 'magic-item' || (record && record.rarity && !LOOKUP[record.kind])) {
    magic = record;
    const baseId = custom.base || custom.baseWeapon || custom.baseArmor || it.base || known.base
      || (record && R.itemIdByName ? baseFromType(record, R.itemIdByName) : null);
    const cat = custom.category && !['light', 'medium', 'heavy', 'shield', 'simple', 'martial'].includes(custom.category) ? custom.category : record?.category;
    const baseWeapon = baseId ? R.weaponById?.[baseId] : null;
    const baseArmor = baseId ? R.armorById?.[baseId] : null;
    if (baseWeapon || (cat === 'weapon' && custom.damage)) {
      weapon = weaponStats(baseWeapon, custom);
      const b = custom.bonus != null ? toNum(custom.bonus) : magicWeaponBonus(record);
      bonus.attack = b; bonus.damage = b;
    } else if (baseArmor || (cat === 'armor' && custom.ac)) {
      armor = armorStats(baseArmor, custom);
      bonus.ac = custom.bonus != null ? toNum(custom.bonus) : magicArmorBonus(record);
    } else if (cat === 'armor' && /shield/i.test(record?.type || '')) {
      armor = armorStats(R.armorById?.shield || { category: 'shield', ac: { base: 2 } }, custom);
      bonus.ac = custom.bonus != null ? toNum(custom.bonus) : magicArmorBonus(record);
    } else if (cat === 'weapon' || cat === 'armor') {
      bonus.attack = bonus.damage = cat === 'weapon' ? magicWeaponBonus(record) : 0;
      if (cat === 'armor') bonus.ac = magicArmorBonus(record);
    }
  } else if (kind === 'weapon') {
    weapon = weaponStats(record, custom);
    if (custom.bonus != null) { bonus.attack = toNum(custom.bonus); bonus.damage = toNum(custom.bonus); }
  } else if (kind === 'armor') {
    armor = armorStats(record, custom);
    if (custom.bonus != null) bonus.ac = toNum(custom.bonus);
  }
  if (custom.attackBonus != null) bonus.attack = toNum(custom.attackBonus);
  if (custom.damageBonus != null) bonus.damage = toNum(custom.damageBonus);
  if (custom.acBonus != null) bonus.ac = toNum(custom.acBonus);

  const requiresAttunement = !!(custom.attunement ?? record?.attunement);
  const equipped = !!it.equipped;
  const attuned = !!it.attuned;
  const qty = Math.max(0, toNum(it.qty, 1));
  const baseRec = (weapon?.id && R.weaponById?.[weapon.id]) || (armor?.id && R.armorById?.[armor.id]) || null;
  const weight = toNum(custom.weight ?? record?.weight ?? baseRec?.weight, 0);
  return {
    uid: it.uid ?? null,
    name: it.name || custom.name || record?.name || prettify(ref) || 'Item',
    kind, ref, record, qty, weight, totalWeight: weight * qty, equipped, attuned, requiresAttunement,
    /** effects apply: worn/wielded, and attuned when the item needs attunement */
    active: requiresAttunement ? attuned : equipped,
    weapon, armor, magic, bonus,
    modifiers: mergeModifiers(known.modifiers, record?.modifiers, custom.modifiers),
    abilitySet: { ...(known.abilitySet || {}), ...(isObj(record?.abilitySet) ? record.abilitySet : {}), ...(isObj(custom.abilitySet) ? custom.abilitySet : {}) },
    acUnarmoredNoShield: toNum(custom.acUnarmoredNoShield ?? known.acUnarmoredNoShield),
    description: custom.description || record?.description || '',
    isTool: !!record?.tool,
    unresolved: !!ref && !record && !Object.keys(custom).length,
  };
}
