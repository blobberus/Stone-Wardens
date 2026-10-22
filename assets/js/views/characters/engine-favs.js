// Favourites: entries a player stars for quick use. Pure helpers (Node-testable, no DOM).
// Stored as char.favorites = { items: [inventory uid], skills: [skill id], features: ['<sourceType>:<feature id>'] }.
// Weapons are inventory items, so a favourite weapon is an `items` uid. Ids survive renames and level changes; a
// feature that is gone for now (level down) keeps its star for when it comes back. Deleted inventory rows and
// removed custom abilities drop theirs (normalizeFavorites / removeAbilityFavorites).

export const FAV_KINDS = ['items', 'skills', 'features'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const uniqStrings = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x))];

/** The favourites key of a derived sheet feature: "<sourceType>:<id>" (custom abilities: "custom:<ability id>"). */
export const featureFavKey = (f) => `${f?.sourceType || 'other'}:${f?.id || f?.name || ''}`;

/** Feature id of char.abilities[i], as engine-choices walkCustomAbilities assigns it (null for a broken entry). */
function abilityIdAt(ab, i) {
  if (!isObj(ab)) return null;
  const refId = ab.ref ? String(ab.ref).replace(/^ability\//, '') : null;
  return ab.id || refId || `custom-${i}`;
}

/** Feature ids of the character's custom abilities. */
export function customAbilityIds(abilities) {
  return (Array.isArray(abilities) ? abilities : []).map(abilityIdAt).filter(Boolean);
}

/** Clean favourites for a stored doc: string ids only, no duplicates, no deleted items or custom abilities. */
export function normalizeFavorites(fav, char = {}) {
  const f = isObj(fav) ? fav : {};
  const uids = new Set((Array.isArray(char.inventory) ? char.inventory : []).map((it) => it?.uid).filter(Boolean));
  const custom = new Set(customAbilityIds(char.abilities).map((id) => `custom:${id}`));
  return {
    items: uniqStrings(f.items).filter((uid) => uids.has(uid)),
    skills: uniqStrings(f.skills),
    features: uniqStrings(f.features).filter((k) => !k.startsWith('custom:') || custom.has(k)),
  };
}

const listOf = (char, kind) => {
  if (!isObj(char.favorites)) char.favorites = { items: [], skills: [], features: [] };
  if (!Array.isArray(char.favorites[kind])) char.favorites[kind] = [];
  return char.favorites[kind];
};

export function isFavorite(char, kind, key) {
  return !!key && Array.isArray(char?.favorites?.[kind]) && char.favorites[kind].includes(key);
}

/** Star or unstar (on = true/false, or omit to flip). Mutates `char`; returns the new state. */
export function toggleFavorite(char, kind, key, on) {
  if (!FAV_KINDS.includes(kind) || !key) return false;
  const list = listOf(char, kind);
  const has = list.includes(key);
  const next = on == null ? !has : !!on;
  if (next && !has) list.push(key);
  if (!next && has) list.splice(list.indexOf(key), 1);
  return next;
}

export const hasFavorites = (char) => FAV_KINDS.some((k) => (char?.favorites?.[k] || []).length);

/** Stable sort: favourites first, everything else keeps its order. */
export function favoritesFirst(list, isFav) {
  const arr = Array.isArray(list) ? list : [];
  return [...arr.filter((x) => isFav(x)), ...arr.filter((x) => !isFav(x))];
}

/**
 * Before removing char.abilities[index]: drop that ability's star and shift the stars of later index-named inline
 * abilities ("custom-<n>") down by one, so they stay on the same abilities. Mutates `char`.
 */
export function removeAbilityFavorites(char, index) {
  const list = char?.favorites?.features;
  if (!Array.isArray(list)) return;
  const gone = `custom:${abilityIdAt((char.abilities || [])[index], index)}`;
  char.favorites.features = list.filter((k) => k !== gone).map((k) => {
    const m = /^custom:custom-(\d+)$/.exec(k);
    return m && Number(m[1]) > index ? `custom:custom-${Number(m[1]) - 1}` : k;
  });
}
