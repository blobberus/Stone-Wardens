// Small pure helpers shared by the engine modules (no DOM, no store; Node-safe).

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const ABILITY_BY_WORD = {
  strength: 'str', str: 'str', dexterity: 'dex', dex: 'dex', constitution: 'con', con: 'con',
  intelligence: 'int', int: 'int', wisdom: 'wis', wis: 'wis', charisma: 'cha', cha: 'cha',
};

export const abilityMod = (score) => Math.floor((toNum(score, 10) - 10) / 2);

export function toNum(v, d = 0) {
  if (v === null || v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const uniq = (arr) => [...new Set(arr)];
export const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Ids picked in a choice value (string | [string] | {id} | {feat}). */
export function pickedIds(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '').map((x) => (isObj(x) ? x.id ?? x.value : x)).filter((x) => x != null);
  if (isObj(v)) {
    if (v.id) return [v.id];
    if (v.feat) return [v.feat];
    return [];
  }
  return [v];
}

/** Sum of an {abil: n} map. */
export function sumPoints(v) {
  if (!isObj(v)) return typeof v === 'string' && ABILITIES.includes(v) ? 1 : 0;
  return Object.values(v).reduce((s, n) => s + Math.max(0, toNum(n)), 0);
}

/** Normalise an ability-increase value: {str:1} | 'str' | ['str','dex'] -> {str:1}. */
export function increaseMap(v) {
  if (typeof v === 'string') return ABILITIES.includes(v) ? { [v]: 1 } : {};
  if (Array.isArray(v)) {
    const out = {};
    for (const a of v) if (ABILITIES.includes(a)) out[a] = (out[a] || 0) + 1;
    return out;
  }
  if (!isObj(v)) return {};
  const out = {};
  for (const [a, n] of Object.entries(v)) if (ABILITIES.includes(a) && toNum(n) > 0) out[a] = toNum(n);
  return out;
}

/** "1d8" + 3 -> "1d8+3"; "1d8" + -1 -> "1d8-1"; "1d8" + 0 -> "1d8". */
export function dmg(die, bonus) {
  if (die == null || die === '') return '';
  const b = toNum(bonus);
  if (/^\d+$/.test(String(die))) return String(Math.max(0, toNum(die) + b));
  if (!b) return String(die);
  return `${die}${b > 0 ? '+' : '-'}${Math.abs(b)}`;
}

/** Faces of a die string: "d6" / "1d8" -> 6 / 8; "1" -> 1. */
export function dieFaces(d) {
  const s = String(d ?? '');
  const m = /d(\d+)/i.exec(s);
  if (m) return Number(m[1]);
  return toNum(s, 0);
}

/** Average of a die string, for comparing dice ("1d6" vs "1d8"). */
export function dieAverage(d) {
  const s = String(d ?? '');
  const m = /^(\d*)d(\d+)$/i.exec(s.trim());
  if (m) return (toNum(m[1], 1) || 1) * (Number(m[2]) + 1) / 2;
  return toNum(s, 0);
}

export function prettify(id) {
  return String(id ?? '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'character';
}

export const fmtSigned = (n) => (n >= 0 ? `+${n}` : `-${Math.abs(n)}`);

/** Largest table value whose key (a level) is <= level. table = {"3":3,"7":5}. */
export function byLevelTable(table, level) {
  if (!isObj(table)) return undefined;
  let best;
  let bestKey = -Infinity;
  for (const [k, v] of Object.entries(table)) {
    const n = Number(k);
    if (Number.isFinite(n) && n <= level && n > bestKey) { best = v; bestKey = n; }
  }
  return best;
}

export const pad9 = (arr) => Array.from({ length: 9 }, (_, i) => toNum(asArray(arr)[i]));
