// Debuffs on the sheet (pure; no DOM). derive() computes every stat WITH its debuffs (Exhaustion, conditions, negative
// modifiers, armour penalties) and registers a reason for each; a second "pure" pass without them gives the base values.
// buildAdjust() diffs the two passes: sheet.adjust[key] = {label, format, base, value, reasons:[{label, amount?, note?}]}.
// Keys: 'ac' 'initiative' 'speed' 'profBonus' 'hpMax' `score:<abil>` `ability:<abil>` (check) `save:<abil>`
// `skill:<id>` `passive:perception|insight|investigation` `attack:<uid>|unarmed` `damage:<uid>|unarmed`
// `spellAttack:<classId>` `spellDc:<classId>` `spellAttack:innate:<groupKey>` `spellDc:innate:<groupKey>`.
import { ABILITIES, ABILITY_NAMES, asArray, isObj, prettify, toNum, uniq } from './engine-util.js';

/**
 * What each condition does to the numbers on a sheet, from the SRD 5.2 condition text (srd/rules.json `conditions`).
 * Charmed and Invisible change nothing that is a debuff here; Exhaustion is `char.exhaustion` (levels), not a flag.
 * speed0: "Your Speed is 0 and can't increase."  failSaves: "automatically fail Strength and Dexterity saving throws".
 */
export const CONDITION_EFFECTS = {
  blinded: { attacks: 'Disadvantage on attack rolls', perception: 'Automatically fails any check that requires sight' },
  deafened: { perception: 'Automatically fails any check that requires hearing' },
  frightened: {
    checks: 'Disadvantage on ability checks while the source of fear is in sight',
    attacks: 'Disadvantage on attack rolls while the source of fear is in sight',
    passiveNote: '−5 while the source of fear is in sight (Disadvantage)',
  },
  grappled: { speed0: true, attacks: 'Disadvantage on attack rolls against any target other than the grappler' },
  incapacitated: { initiative: 'Disadvantage on Initiative rolled while Incapacitated', actions: "Can't take any action, Bonus Action or Reaction" },
  paralyzed: { implies: ['incapacitated'], speed0: true, failSaves: ['str', 'dex'] },
  petrified: { implies: ['incapacitated'], speed0: true, failSaves: ['str', 'dex'] },
  poisoned: { checks: 'Disadvantage on ability checks', attacks: 'Disadvantage on attack rolls', passive: -5 },
  prone: { attacks: 'Disadvantage on attack rolls', move: 'Can only crawl (1 extra foot per foot), or spend half your Speed to stand up' },
  restrained: { speed0: true, attacks: 'Disadvantage on attack rolls', saveDisadvantage: { dex: 'Disadvantage on Dexterity saving throws' } },
  stunned: { implies: ['incapacitated'], failSaves: ['str', 'dex'] },
  unconscious: { implies: ['incapacitated', 'prone'], speed0: true, failSaves: ['str', 'dex'] },
};

/** Conditions on the doc plus the ones they imply ("Incapacitated (from Stunned)"): [{id, label}]. */
export function activeConditions(char, rules) {
  const names = Object.fromEntries(asArray(rules?.core?.conditions).filter(isObj).map((x) => [x.id, x.name]));
  const nm = (id) => names[id] || prettify(id);
  const listed = uniq(asArray(char?.conditions).filter((x) => typeof x === 'string' && x && x !== 'exhaustion'));
  const out = listed.map((id) => ({ id, label: nm(id) }));
  const seen = new Set(listed);
  for (let i = 0; i < out.length; i++) {
    for (const imp of asArray(CONDITION_EFFECTS[out[i].id]?.implies)) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      out.push({ id: imp, label: `${nm(imp)} (from ${out[i].label.replace(/ \(from .*\)$/, '')})` });
    }
  }
  return out;
}

/** Every D20 Test the sheet shows (Exhaustion reduces them all). Passive scores count it too (see character-model.md). */
export const D20_KEYS = ['ability:*', 'save:*', 'skill:*', 'initiative', 'attack:*', 'spellAttack:*', 'passive:*'];
const STR_DEX_KEYS = ['ability:str', 'ability:dex', 'save:str', 'save:dex', 'skill:@str', 'skill:@dex', 'initiative', 'attack:@str', 'attack:@dex'];

/**
 * Register the condition reasons (numbers for speed / passives are applied by derive itself).
 * why(keys, label, {amount?, note?, temp?, cascade?, ability?})
 */
export function conditionReasons(conds, why) {
  for (const x of conds) {
    const e = CONDITION_EFFECTS[x.id];
    if (!e) continue;
    const t = { temp: true };
    if (e.attacks) why(['attack:*', 'spellAttack:*'], x.label, { ...t, note: e.attacks });
    if (e.actions) why(['attack:*', 'spellAttack:*'], x.label, { ...t, note: e.actions });
    if (e.checks) why(['ability:*', 'skill:*', 'initiative'], x.label, { ...t, note: e.checks });
    if (e.passive) why(['passive:*'], x.label, { ...t, amount: e.passive, note: 'Disadvantage on checks: −5 to passive scores' });
    if (e.passiveNote) why(['passive:*'], x.label, { ...t, note: e.passiveNote });
    if (e.perception) why(['skill:perception', 'passive:perception'], x.label, { ...t, note: e.perception });
    if (e.initiative) why(['initiative'], x.label, { ...t, note: e.initiative });
    for (const a of asArray(e.failSaves)) why([`save:${a}`], x.label, { ...t, note: `Automatically fails ${ABILITY_NAMES[a]} saving throws` });
    for (const [a, note] of Object.entries(e.saveDisadvantage || {})) why([`save:${a}`], x.label, { ...t, note });
    if (e.move) why(['speed'], x.label, { ...t, note: e.move });
  }
}

/** Armour without training: Disadvantage on Str/Dex D20 Tests and no spellcasting (2024 Armor Training). */
export function armorTrainingReasons(name, why) {
  const label = `${name} (no armor training)`;
  why(STR_DEX_KEYS, label, { note: 'Disadvantage on Strength and Dexterity D20 Tests' });
  why(['spellAttack:*', 'spellDc:*'], label, { note: "Can't cast spells" });
}

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Reasons for negative `modifiers` entries ({field, sub, amount, label}) collected by applyModifiers. */
export function modifierReasons(neg, why, { totalLevel = 0 } = {}) {
  for (const n of asArray(neg)) {
    const L = n.label || 'Modifier';
    const amount = toNum(n.amount);
    if (!amount) continue;
    switch (n.field) {
      case 'ac': why(['ac'], L, { amount, field: 'ac' }); break;
      case 'speed': why(['speed'], L, { amount, note: `Speed ${signed(amount)} ft` }); break;
      case 'initiative': why(['initiative'], L, { amount }); break;
      case 'hpPerLevel': if (totalLevel) why(['hpMax'], L, { amount: amount * totalLevel, note: `${signed(amount)} HP per level` }); break;
      case 'hpMax': if (totalLevel) why(['hpMax'], L, { amount }); break;
      case 'profBonus':
        why(['profBonus'], L, { amount });
        why(['*'], L, { cascade: 'pb', note: `Proficiency Bonus ${signed(amount)}` });
        break;
      case 'attack': why(['attack:*'], L, { amount }); break;
      case 'damage': why(['damage:*'], L, { amount }); break;
      case 'spellDc': why(['spellDc:*'], L, { amount }); break;
      case 'spellAttack': why(['spellAttack:*'], L, { amount }); break;
      case 'checks': why(['ability:*', 'skill:*', 'initiative', 'passive:*'], L, { amount, note: 'All ability checks' }); break;
      case 'abilities':
        if (!ABILITIES.includes(n.sub)) break;
        why([`score:${n.sub}`], L, { amount });
        why(['*'], L, { cascade: 'ability', ability: n.sub, note: `${ABILITY_NAMES[n.sub]} score ${signed(amount)}` });
        break;
      case 'saves': why([n.sub === 'all' ? 'save:*' : `save:${n.sub}`], L, { amount }); break;
      case 'skills': why(n.sub === 'all' ? ['skill:*', 'passive:*'] : [`skill:${n.sub}`, `passive:${n.sub}`], L, { amount }); break;
      default: break;
    }
  }
}

// ----- diff -------------------------------------------------------------------------------------

function matchKey(pat, key, abil) {
  if (pat === '*' || pat === key) return true;
  const i = pat.indexOf(':');
  if (i < 0) return false;
  const pre = pat.slice(0, i + 1);
  const rest = pat.slice(i + 1);
  if (!key.startsWith(pre)) return false;
  if (rest === '*') return true;
  return rest[0] === '@' && abil.includes(rest.slice(1));
}

const attackKey = (a) => a?.uid || (a?.unarmed ? 'unarmed' : null);

/** Every debuffable stat: {key, label, format:'mod'|'num'|'ft'|'text', abil:[ability ids it uses], pb, get(sheet), num?(sheet)}. */
function statDefs(s, meta) {
  const defs = [];
  const add = (key, label, format, abil, pb, get, num) => defs.push({ key, label, format, abil: abil.filter(Boolean), pb, get, num });
  const acAbil = ABILITIES.filter((a) => asArray(s.ac?.parts).some((p) => p?.label === a.toUpperCase()));
  add('ac', 'Armor Class', 'num', acAbil, false, (x) => x.ac?.value);
  add('initiative', 'Initiative', 'mod', ['dex', ...asArray(meta.initiativeAbilities)], !!meta.initiativePB, (x) => x.initiative);
  add('speed', 'Speed', 'ft', [], false, (x) => x.speed?.walk);
  add('profBonus', 'Proficiency Bonus', 'mod', [], false, (x) => x.profBonus);
  add('hpMax', 'Hit Point Maximum', 'num', ['con'], false, (x) => x.hpMax);
  for (const a of ABILITIES) {
    const N = ABILITY_NAMES[a];
    add(`score:${a}`, `${N} score`, 'num', [a], false, (x) => x.abilities?.[a]?.score);
    add(`ability:${a}`, `${N} check`, 'mod', [a], false, (x) => x.abilities?.[a]?.check);
    add(`save:${a}`, `${N} saving throw`, 'mod', [a], true, (x) => x.abilities?.[a]?.save);
  }
  for (const [id, sk] of Object.entries(s.skills || {})) add(`skill:${id}`, sk.name || prettify(id), 'mod', [sk.ability], true, (x) => x.skills?.[id]?.bonus);
  for (const [id, ab] of [['perception', 'wis'], ['insight', 'wis'], ['investigation', 'int']]) {
    add(`passive:${id}`, `Passive ${prettify(id)}`, 'num', [s.skills?.[id]?.ability || ab], true, (x) => x.passive?.[id]);
  }
  for (const at of asArray(s.attacks)) {
    const k = attackKey(at);
    if (!k) continue;
    const find = (x) => asArray(x.attacks).find((y) => attackKey(y) === k);
    add(`attack:${k}`, `${at.name}: attack roll`, 'mod', [at.ability], true, (x) => find(x)?.bonus);
    add(`damage:${k}`, `${at.name}: damage`, 'text', [at.ability], false, (x) => find(x)?.damage, (x) => find(x)?.damageBonus);
  }
  for (const sc of asArray(s.spellcasting)) {
    const find = (x) => asArray(x.spellcasting).find((y) => y.class === sc.class);
    add(`spellAttack:${sc.class}`, `${sc.name || prettify(sc.class)} spell attack`, 'mod', [sc.ability], true, (x) => find(x)?.attack);
    add(`spellDc:${sc.class}`, `${sc.name || prettify(sc.class)} spell save DC`, 'num', [sc.ability], true, (x) => find(x)?.dc);
  }
  for (const g of asArray(s.innate)) {
    const find = (x) => asArray(x.innate).find((y) => y.key === g.key);
    add(`spellAttack:innate:${g.key}`, `${g.source || 'Innate'} spell attack`, 'mod', [g.ability], true, (x) => find(x)?.attack);
    add(`spellDc:innate:${g.key}`, `${g.source || 'Innate'} spell save DC`, 'num', [g.ability], true, (x) => find(x)?.dc);
  }
  return defs;
}

/**
 * sheet.adjust from the debuffed sheet, the pure (no-debuff) sheet and the registered reasons.
 * meta: {overridden:Set<key> (a stored override replaces it: only temporary reasons count), initiativeAbilities, initiativePB}
 */
export function buildAdjust(sheet, base, reasons, meta = {}) {
  const out = {};
  if (!reasons.length) return out;
  const overridden = meta.overridden instanceof Set ? meta.overridden : new Set();
  for (const d of statDefs(sheet, meta)) {
    const rs = reasons.filter((r) => r.keys.some((p) => matchKey(p, d.key, d.abil)));
    if (!rs.length) continue;
    const value = d.get(sheet);
    const b0 = d.get(base);
    const baseValue = b0 === undefined ? value : b0;
    const numOf = d.num || d.get;
    const diff = toNum(numOf(sheet)) - toNum(numOf(base) ?? numOf(sheet));
    const changed = diff !== 0 || value !== baseValue;
    const ov = overridden.has(d.key);
    const list = [];
    const seen = new Set();
    const push = (r) => {
      const sig = `${r.label}|${r.amount ?? ''}|${r.note ?? ''}`;
      if (!seen.has(sig)) { seen.add(sig); list.push(r); }
    };
    const notes = rs.filter((r) => !r.cascade && !r.amount && r.note).map((r) => ({ label: r.label, note: r.note }));
    if (changed) {
      const explicit = rs.filter((r) => !r.cascade && r.amount && (!ov || r.temp));
      for (const r of explicit) push(r.note ? { label: r.label, amount: r.amount, note: r.note } : { label: r.label, amount: r.amount });
      const residual = diff - explicit.reduce((n, r) => n + r.amount, 0);
      if (residual) {
        const cands = ov ? [] : rs.filter((r) => r.cascade && (r.cascade === 'pb' ? d.pb : d.abil.includes(r.ability)));
        if (cands.length === 1) push({ label: cands[0].label, amount: residual, note: cands[0].note });
        else if (cands.length > 1) cands.forEach((r) => push({ label: r.label, note: r.note }));
        else push({ label: 'Other penalties', amount: residual });
      }
    }
    notes.forEach(push);
    if (!list.length) continue;
    out[d.key] = { label: d.label, format: d.format, base: baseValue, value, reasons: list };
  }
  return out;
}
