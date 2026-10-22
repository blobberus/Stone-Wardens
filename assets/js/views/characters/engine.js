// Character rules engine (D&D 2024 / SRD 5.2). Pure ES module: no DOM, no store; importable in Node.
// Contract: docs/character-model.md. Data shapes: docs/srd-schema.md.
//
// Modules: engine-rules.js (buildRules/loadRules), engine-choices.js (feature walk, Choice objects, key scheme),
// engine-derive.js (derive), engine-items.js (itemStats), engine-known.js (mechanics the data only has as prose),
// engine-util.js (helpers).
//
// ---------------------------------------------------------------------------------------------
// CHOICE KEYS (char.choices[key] = value)
//   `${featureId}@${classId}:${classLevel}`  class & subclass features; a feature listed at several levels gets one
//                                            key per level (ASI 4/8/12…, Expertise 1+6, Metamagic 2/10/17).
//                                            Choices with `countKey` (Weapon Mastery, Eldritch Invocations) live at
//                                            the level the feature first appears and hold the running TOTAL list.
//   `class-skills@${classId}:1`               class skill proficiencies (first class: mirrored into char.skills;
//                                            later classes: the multiclass skill pick, if any)
//   `class-tools@${classId}:1`                class tool proficiencies (Bard instruments, Monk tool)
//   `${classId}-subclass@${classId}:3`        subclass pick (mirrored into classes[i].subclass, which wins on read)
//   `species:${traitId}`                      species / subspecies trait choices
//   `species:subspecies`, `species:size`      canonical keys, mirrored into char.species.subspecies / .size
//   `background:abilities`                    {str:2,con:1} (+2/+1 or +1/+1/+1), mirrored into background.abilityBonuses
//   `background:tool`                         background tool pick when the background offers a category
//   `origin:languages`                        the two starting languages (Common is automatic); falls back to
//                                            extraProficiencies.languages when that already lists two
//   `feat:${featId}`                          choices inside a feat; repeated instances of the same feat use
//                                            `feat:${featId}@2`, `@3`… in walk order (background, species, classes, char.feats)
//   `ability:${abilityId}`                    choices inside a custom ability
//   suffix `/${part.key ?? index}`            each part of a `multi` choice is its own Choice (no parent Choice)
//   suffix `>${optionId}` (`@n` if repeated)  the nested choice of a picked option (e.g. Agonizing Blast's cantrip),
//                                            also used for fighting-style alternatives (`…>blessed-warrior`)
// VALUES
//   lists (skills, expertise, tools, languages, weapon-mastery, spells, options count>1) -> [id]
//   single (subclass, feat, options count 1, ability, damage-type, subspecies, size) -> id (or [id])
//   ability-increase -> {str:1}                     asi-or-feat -> {asi:{str:2}} or {feat:'grappler', asi:{str:1}}
//   (a feat chosen through asi-or-feat keeps its ability increase in `asi`; its other choices use `feat:${id}`)
//   wild-shape-forms -> [free text]
// Choice object: {key, featureId, label, type, count, options:[{id,name,description,meta?,disabled?,reason?,entry?}],
//   value, complete, source, sourceType, classId, classLevel, parentKey, featKey, + raw descriptors from the data
//   (from, category, points, max, maxPerAbility, list, listFrom, level (SPELL level), levelByClassLevel, school,
//   ritual, alwaysPrepared, changeable, note, alternatives, countKey, countByLevel, countFrom, partKey)}
// ---------------------------------------------------------------------------------------------
import { ABILITIES, asArray, clone, isObj, slugify, toNum } from './engine-util.js';
import { buildRules, loadRules, invalidateRules } from './engine-rules.js';
import { compute, averageHp } from './engine-derive.js';
import { getChoiceValue, setChoice as setChoiceRaw, featPrereqReason } from './engine-choices.js';
import { itemStats } from './engine-items.js';
import { lastLeveledClass } from './engine-xp.js';

export { buildRules, loadRules, invalidateRules, itemStats, averageHp, getChoiceValue, featPrereqReason };
export { XP_TABLE, xpTable, xpForLevel, levelForXp, xpStatus, xpLevelsCrossed, addXp, setXp, xpAfterLevelChange, lastLeveledClass } from './engine-xp.js';
export { spellStats, spellIssues, addSpellIssues, onCasterList, parseDice, rollDice, diceText, cantripTier } from './engine-spells.js';
export { isBonusActionSpell, bonusActionOptions, bonusActionFeatures, featureHealing, offhandAttacks } from './engine-actions.js';
export const ENGINE_VERSION = 1;

const ensureRules = (rules) => (rules && rules.classById ? rules : buildRules(rules || {}));
const clampLevel = (n) => Math.max(1, Math.min(20, Math.floor(toNum(n, 1))));

// ----- documents -----------------------------------------------------------------------------

const DETAIL_KEYS = ['alignment', 'pronouns', 'gender', 'sexuality', 'age', 'height', 'weight', 'eyes', 'hair', 'skin',
  'appearance', 'personalityTraits', 'socialTraits', 'mentalTraits', 'ideals', 'bonds', 'flaws', 'likes', 'dislikes',
  'location', 'groups', 'religion', 'resistances', 'backstory', 'notes'];

/** A blank stored document (level 0 until a class is chosen). */
export function newCharacter({ name = '', player = '' } = {}) {
  const now = new Date().toISOString();
  const doc = {
    id: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`, name, player, portrait: null,
    species: { id: null, subspecies: null, size: null },
    background: { id: null, abilityBonuses: {} },
    classes: [],
    abilityMethod: 'standard',
    baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    choices: {},
    skills: [],
    extraProficiencies: { skills: [], expertise: [], saves: [], armor: [], weapons: [], tools: [], languages: [] },
    feats: [], spells: [],
    slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0,
    inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    hp: { current: null, temp: 0 }, hitDiceUsed: {}, deathSaves: { success: 0, fail: 0 },
    resourcesUsed: {}, conditions: [], exhaustion: 0, heroicInspiration: false, xp: 0,
    abilities: [],
    overrides: { ac: null, speed: null, initiative: null, hpMax: null, profBonus: null, passivePerception: null, abilities: {}, saves: {}, skills: {} },
    details: Object.fromEntries(DETAIL_KEYS.map((k) => [k, ''])),
    created: now, updated: now,
  };
  if (player) doc.createdBy = player;
  return doc;
}

// ----- derive & choices ------------------------------------------------------------------------

function fallbackSheet(char, error) {
  const abilities = {};
  for (const a of ABILITIES) {
    const score = toNum(char?.baseAbilities?.[a], 10);
    const mod = Math.floor((score - 10) / 2);
    abilities[a] = { score, mod, base: score, save: mod, saveProf: false, name: a, label: a.toUpperCase() };
  }
  return {
    name: char?.name || '', totalLevel: 0, level: 0, classLine: '', classes: [], profBonus: 2, xp: 0, nextLevelXp: null,
    abilities, saves: {}, skills: {}, passive: { perception: 10, insight: 10, investigation: 10 },
    ac: { value: 10 + abilities.dex.mod, formula: '', parts: [], computed: 10 + abilities.dex.mod }, initiative: abilities.dex.mod,
    speed: { walk: 30 }, hpMax: 0, hp: { current: 0, temp: 0, max: 0 }, hitDice: [], size: 'Medium', senses: '', sensesList: [], darkvision: null,
    languages: [], languageNames: [], resistances: [], proficiencies: { armor: [], weapons: [], tools: [], saves: [], skills: [], expertise: [] },
    features: [], resources: [], spellcasting: [], slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], casterLevel: 0,
    pact: null, spells: [], innate: [], attacks: [], weaponMasteries: [], armorWorn: null, shield: null,
    encumbrance: { carried: 0, capacity: abilities.str.score * 15, encumbered: false, dragLiftPush: abilities.str.score * 30, coins: 0 },
    items: [], heroicInspirationOnLongRest: false, exhaustion: 0, choices: [], pending: [],
    warnings: [`Rules engine error: ${error?.message || error}`],
  };
}

/** Sheet for a stored doc. Never throws: unknown ids are skipped with warnings. */
export function derive(char, rules) {
  try {
    return compute(char, ensureRules(rules)).sheet;
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[engine] derive failed', e);
    return fallbackSheet(char, e);
  }
}

/** Every Choice applicable at the current levels (answered ones carry `value`, `complete`). */
export function choicesFor(char, rules) {
  try { return compute(char, ensureRules(rules)).sheet.choices; } catch (e) { console.error('[engine] choicesFor failed', e); return []; }
}

/** Pending (unanswered or incomplete) choices. */
export function validateChoices(char, rules) {
  try { return compute(char, ensureRules(rules)).sheet.pending; } catch (e) { console.error('[engine] validateChoices failed', e); return []; }
}

/** Store a choice value; returns a NEW doc. null/empty removes it. */
export function setChoice(char, key, value) {
  return setChoiceRaw(char, key, value);
}

/** Drop stored choice keys that no longer apply (e.g. after changing subclass or a feat). Returns a new doc. */
export function pruneChoices(char, rules) {
  const keys = new Set(choicesFor(char, rules).map((c) => c.key));
  const next = { ...(isObj(char) ? char : {}) };
  next.choices = Object.fromEntries(Object.entries(isObj(next.choices) ? next.choices : {}).filter(([k]) => keys.has(k)));
  return next;
}

// ----- point buy -------------------------------------------------------------------------------

const DEFAULT_POINT_BUY = { budget: 27, min: 8, max: 15, cost: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } };

/** Total point-buy cost of {str..cha} base scores; null if any score is outside 8–15. */
export function abilityPointBuyCost(scores, rules) {
  const table = rules?.core?.pointBuy?.cost || DEFAULT_POINT_BUY.cost;
  let total = 0;
  for (const a of ABILITIES) {
    const s = toNum(scores?.[a], 8);
    const c = table[String(s)];
    if (c == null) return null;
    total += toNum(c);
  }
  return total;
}

/** {cost, budget, remaining, valid, errors[]} */
export function pointBuyInfo(scores, rules) {
  const pbr = { ...DEFAULT_POINT_BUY, ...(rules?.core?.pointBuy || {}) };
  const errors = [];
  for (const a of ABILITIES) {
    const s = toNum(scores?.[a], 8);
    if (s < pbr.min || s > pbr.max) errors.push(`${a.toUpperCase()} ${s} is outside ${pbr.min}–${pbr.max}`);
  }
  const cost = abilityPointBuyCost(scores, rules);
  if (cost != null && cost > pbr.budget) errors.push(`Costs ${cost} of ${pbr.budget} points`);
  return { cost, budget: pbr.budget, remaining: cost == null ? null : pbr.budget - cost, valid: !errors.length, errors };
}

// ----- multiclassing ---------------------------------------------------------------------------

/** -> {ok, reasons:[string]}. Needs the new class's prerequisites AND those of every current class. */
export function canMulticlass(char, rules, classId) {
  const R = ensureRules(rules);
  const target = R.classById[classId];
  if (!target) return { ok: false, reasons: [`Unknown class "${classId}"`] };
  const { sheet, ctx } = compute(char, R);
  if (!ctx.classes.length || ctx.classes.some((c) => c.id === classId)) {
    return sheet.totalLevel >= 20 ? { ok: false, reasons: ['Already at level 20'] } : { ok: true, reasons: [] };
  }
  const reasons = [];
  if (sheet.totalLevel >= 20) reasons.push('Already at level 20');
  const score = (a) => sheet.abilities[a]?.score ?? 10;
  const fmt = (r) => `${String(r.ability).toUpperCase()} ${r.min}`;
  const check = (cls) => {
    const pre = cls?.multiclass?.prereq;
    if (!isObj(pre)) return;
    const all = asArray(pre.all);
    const any = asArray(pre.any);
    if (all.length && !all.every((r) => score(r.ability) >= r.min)) reasons.push(`${cls.name} needs ${all.map(fmt).join(' and ')}`);
    if (any.length && !any.some((r) => score(r.ability) >= r.min)) reasons.push(`${cls.name} needs ${any.map(fmt).join(' or ')}`);
  };
  check(target);
  for (const ce of ctx.classes) check(ce.cls);
  return { ok: !reasons.length, reasons };
}

// ----- level up --------------------------------------------------------------------------------

/** Append one level of classId to a copy of the doc (hp roll = raw die result; default = average). */
function appendLevel(char, R, classId, hpRoll) {
  const next = clone(isObj(char) ? char : {});
  const cls = R.classById[classId];
  const die = toNum(cls?.hitDie, 8);
  next.classes = asArray(next.classes).filter((x) => x && x.id);
  const roll = hpRoll === undefined || hpRoll === null || hpRoll === '' ? null : Math.max(1, Math.round(toNum(hpRoll, 1)));
  const idx = next.classes.findIndex((x) => x.id === classId);
  if (idx >= 0) {
    const row = { ...next.classes[idx] };
    const lvl = clampLevel(row.level);
    const hp = asArray(row.hp).slice(0, lvl).map((n) => toNum(n));
    while (hp.length < lvl) hp.push(idx === 0 && hp.length === 0 ? die : averageHp(die, R));
    hp.push(roll ?? averageHp(die, R));
    row.level = lvl + 1;
    row.hp = hp;
    next.classes[idx] = row;
  } else {
    const firstEver = !next.classes.length;
    next.classes.push({ id: classId, level: 1, subclass: null, hp: [firstEver ? die : roll ?? averageHp(die, R)] });
  }
  return next;
}

const grantKey = (g) => `${g.sourceType}|${g.classId || ''}|${g.id}|${g.classLevel ?? ''}|${g.charLevel ?? ''}|${g.featKey || ''}|${g.parentKey || ''}`;

/**
 * What the next level of classId brings: {classId, className, newLevel, totalLevel, isNewClass, firstLevel, allowed,
 * reasons, hitDie, hpAverage, conMod, hpGain, features:[Feature], choices:[Choice], slotsBefore, slotsAfter, pactBefore,
 * pactAfter, newCantrips, newPrepared, maxSpellLevelBefore, maxSpellLevelAfter, profBonusBefore, profBonusAfter,
 * multiclassProficiencies}
 */
export function levelUpPlan(char, rules, classId) {
  const R = ensureRules(rules);
  const c = isObj(char) ? char : {};
  const cls = R.classById[classId];
  if (!cls) {
    return {
      classId, newLevel: 1, allowed: false, reasons: [`Unknown class "${classId}"`], hitDie: 8, hpAverage: 5, features: [], choices: [],
      slotsBefore: [], slotsAfter: [], newCantrips: 0, newPrepared: 0,
    };
  }
  const { sheet: before, ctx: bctx } = compute(c, R);
  const row = bctx.classes.find((x) => x.id === classId);
  const isNew = !row;
  const firstEver = !bctx.classes.length;
  const mc = canMulticlass(c, R, classId);
  const atMax = before.totalLevel >= 20 || (row && row.level >= 20);
  const { sheet: after, ctx: actx } = compute(appendLevel(c, R, classId, null), R);
  const newLevel = (row ? row.level : 0) + 1;

  const bKeys = new Set(bctx.grants.map(grantKey));
  const features = actx.grants
    .filter((g) => !bKeys.has(grantKey(g)) && !(g.sourceType === 'feat' && g.id === 'ability-score-improvement'))
    .map((g) => ({
      id: g.id, name: g.name, source: g.sourceType === 'feat' ? 'Feat' : g.source, sourceType: g.sourceType,
      level: g.classLevel ?? g.charLevel ?? null, classId: g.classId, classLevel: g.classLevel, description: g.description,
      choiceKey: g.choiceKey, parentKey: g.parentKey,
    }));
  const bCh = new Map(before.choices.map((x) => [x.key, x]));
  const choices = after.choices.filter((x) => {
    const b = bCh.get(x.key);
    return !b || toNum(x.count) > toNum(b.count) || (b.complete && !x.complete);
  });
  const sb = before.spellcasting.find((s) => s.class === classId);
  const sa = after.spellcasting.find((s) => s.class === classId);
  const avg = averageHp(cls.hitDie, R);
  return {
    classId, className: cls.name, newLevel, totalLevel: after.totalLevel, isNewClass: isNew, firstLevel: firstEver,
    allowed: mc.ok && !atMax, reasons: [...mc.reasons, ...(atMax && !mc.reasons.length ? ['Already at level 20'] : [])],
    hitDie: toNum(cls.hitDie, 8), hpAverage: firstEver ? toNum(cls.hitDie, 8) : avg, conMod: after.abilities.con.mod,
    hpGain: after.hpMax - before.hpMax,
    hpBonusPerLevel: after.hpMax - before.hpMax - Math.max(1, (firstEver ? toNum(cls.hitDie, 8) : avg) + after.abilities.con.mod),
    features, choices,
    slotsBefore: before.slots, slotsAfter: after.slots, pactBefore: before.pact, pactAfter: after.pact,
    newCantrips: toNum(sa?.cantrips) - toNum(sb?.cantrips), newPrepared: toNum(sa?.prepared) - toNum(sb?.prepared),
    maxSpellLevelBefore: toNum(sb?.maxSpellLevel), maxSpellLevelAfter: toNum(sa?.maxSpellLevel),
    profBonusBefore: before.profBonus, profBonusAfter: after.profBonus,
    multiclassProficiencies: isNew && !firstEver ? cls.multiclass?.proficiencies || null : null,
  };
}

/**
 * Append a level of classId: opts.hpRoll = the raw hit-die result (default: fixed average; first character level is
 * always the max die), opts.choices = {key: value} stored through setChoice. Current HP rises by the max-HP gain.
 * Throws if the level-up isn't allowed (multiclass prerequisites, level 20, unknown class).
 */
export function applyLevelUp(char, rules, classId, opts = {}) {
  const R = ensureRules(rules);
  const c = isObj(char) ? char : {};
  if (!R.classById[classId]) throw new Error(`Unknown class "${classId}"`);
  const mc = canMulticlass(c, R, classId);
  if (!mc.ok) throw new Error(mc.reasons.join('; ') || 'Cannot take a level in this class');
  const before = compute(c, R).sheet.hpMax;
  let next = appendLevel(c, R, classId, opts?.hpRoll);
  for (const [k, v] of Object.entries(isObj(opts?.choices) ? opts.choices : {})) next = setChoiceRaw(next, k, v);
  const after = compute(next, R).sheet.hpMax;
  const cur = c.hp?.current == null || c.hp?.current === '' ? before : toNum(c.hp.current);
  next.hp = { ...(isObj(next.hp) ? next.hp : {}), current: Math.max(0, Math.min(after, cur + (after - before))), temp: toNum(next.hp?.temp) };
  // levelOrder: which class each gained level went to (most recent last) -> "level down" defaults to the latest one
  next.levelOrder = [...asArray(next.levelOrder).filter((x) => typeof x === 'string'), classId].slice(-20);
  return next;
}

/** Remove the last level of classId (and the choices stored for that level). Returns a new doc. */
export function levelDown(char, rules, classId) {
  const R = ensureRules(rules);
  const next = clone(isObj(char) ? char : {});
  next.classes = asArray(next.classes).filter((x) => x && x.id);
  const idx = next.classes.findIndex((x) => x.id === classId);
  if (idx < 0) return next;
  const row = { ...next.classes[idx] };
  const lvl = clampLevel(row.level);
  const levelKey = new RegExp(`@${classId}:${lvl}(?![0-9])`);
  next.choices = Object.fromEntries(Object.entries(isObj(next.choices) ? next.choices : {}).filter(([k]) => !levelKey.test(k)));
  if (lvl <= 1) next.classes.splice(idx, 1);
  else {
    row.level = lvl - 1;
    row.hp = asArray(row.hp).slice(0, lvl - 1);
    if (row.level < toNum(R.classById[classId]?.subclassLevel, 3)) row.subclass = null;
    next.classes[idx] = row;
  }
  const max = compute(next, R).sheet.hpMax;
  if (next.hp && next.hp.current != null) next.hp = { ...next.hp, current: Math.min(toNum(next.hp.current), max) };
  if (Array.isArray(next.levelOrder)) {
    const i = next.levelOrder.lastIndexOf(classId);
    if (i >= 0) next.levelOrder = [...next.levelOrder.slice(0, i), ...next.levelOrder.slice(i + 1)];
  }
  return next;
}

/**
 * What levelDown(char, rules, classId) would take away: {classId, className, fromLevel, toLevel, removesClass,
 * totalBefore, totalAfter, features:[{id, name, source, level}], choices:[{key, label, value, choice}], hpBefore,
 * hpAfter, hpLost, slotsBefore, slotsAfter, pactBefore, pactAfter, maxSpellLevelBefore, maxSpellLevelAfter,
 * cantripsBefore, cantripsAfter, preparedBefore, preparedAfter, profBonusBefore, profBonusAfter, subclass (id lost)|null,
 * spellsAtRisk:[{id, name, level, reason}] (this class's spells above the new highest spell level, or all of them
 * when the class goes), resourcesBefore, resourcesAfter, next (the resulting doc), isLatest (classId is the
 * most recently levelled class), trimmed:[{key, label, before, after, removed:[id]}] (running-total picks such as
 * Eldritch Invocations cut back to the new count in `next`, newest first), alwaysLost:[{id, name, level}]}
 */
export function levelDownPlan(char, rules, classId) {
  const R = ensureRules(rules);
  const c = isObj(char) ? char : {};
  const { sheet: before, ctx: bctx } = compute(c, R);
  const row = bctx.classes.find((x) => x.id === classId);
  const cls = R.classById[classId];
  if (!row) {
    return { classId, className: cls?.name || classId, fromLevel: 0, toLevel: 0, removesClass: false, totalBefore: before.totalLevel, totalAfter: before.totalLevel, features: [], choices: [], hpLost: 0, spellsAtRisk: [], next: clone(c), allowed: false };
  }
  const next = levelDown(c, R, classId);
  let { sheet: after, ctx: actx } = compute(next, R);
  // Running-total picks (Eldritch Invocations, Weapon Mastery, …) that now allow fewer: drop the newest extras
  const trimmed = [];
  for (const ch of after.choices) {
    const v = next.choices?.[ch.key];
    const cap = toNum(ch.count, NaN);
    const was = before.choices.find((x) => x.key === ch.key);
    if (!Array.isArray(v) || !Number.isFinite(cap) || cap < 0 || v.length <= cap || !(toNum(was?.count) > cap)) continue;
    trimmed.push({ key: ch.key, label: ch.label || ch.key, before: v.length, after: cap, removed: v.slice(cap), choice: was });
    next.choices = { ...next.choices, [ch.key]: v.slice(0, cap) };
  }
  if (trimmed.length) ({ sheet: after, ctx: actx } = compute(next, R));
  const aKeys = new Set(actx.grants.map(grantKey));
  const features = bctx.grants
    .filter((g) => !aKeys.has(grantKey(g)) && !(g.sourceType === 'feat' && g.id === 'ability-score-improvement'))
    .map((g) => ({ id: g.id, name: g.name, source: g.sourceType === 'feat' ? 'Feat' : g.source, sourceType: g.sourceType, level: g.classLevel ?? g.charLevel ?? null }));
  const byKey = new Map(before.choices.map((x) => [x.key, x]));
  const kept = isObj(next.choices) ? next.choices : {};
  const choices = Object.entries(isObj(c.choices) ? c.choices : {}).filter(([k]) => !(k in kept))
    .map(([key, value]) => ({ key, value, label: byKey.get(key)?.label || key, choice: byKey.get(key) || null }));
  const sb = before.spellcasting.find((s) => s.class === classId);
  const sa = after.spellcasting.find((s) => s.class === classId);
  const removesClass = !next.classes.some((x) => x.id === classId);
  const maxAfter = toNum(sa?.maxSpellLevel);
  const spellsAtRisk = asArray(c.spells).filter((s) => isObj(s) && s.id && s.class === classId).map((s) => {
    const rec = R.spellById[s.id];
    const level = rec ? toNum(rec.level) : toNum(s.level);
    const reason = removesClass ? 'class removed' : level > 0 && level > maxAfter ? `above level ${maxAfter || 0}` : null;
    return reason ? { id: s.id, name: rec?.name || s.id, level, reason } : null;
  }).filter(Boolean);
  const subclassRow = c.classes?.find?.((x) => x?.id === classId);
  const nextRow = next.classes.find((x) => x.id === classId);
  return {
    classId, className: cls?.name || classId, fromLevel: row.level, toLevel: row.level - 1, removesClass,
    totalBefore: before.totalLevel, totalAfter: after.totalLevel, allowed: true,
    features, choices,
    hpBefore: before.hpMax, hpAfter: after.hpMax, hpLost: Math.max(0, before.hpMax - after.hpMax),
    slotsBefore: before.slots, slotsAfter: after.slots, pactBefore: before.pact, pactAfter: after.pact,
    maxSpellLevelBefore: toNum(sb?.maxSpellLevel), maxSpellLevelAfter: maxAfter,
    cantripsBefore: toNum(sb?.cantrips), cantripsAfter: toNum(sa?.cantrips), preparedBefore: toNum(sb?.prepared), preparedAfter: toNum(sa?.prepared),
    profBonusBefore: before.profBonus, profBonusAfter: after.profBonus,
    subclass: subclassRow?.subclass && !nextRow?.subclass ? subclassRow.subclass : null,
    resourcesBefore: before.resources.map((r) => ({ key: r.key, label: r.label, max: r.max })),
    resourcesAfter: after.resources.map((r) => ({ key: r.key, label: r.label, max: r.max })),
    spellsAtRisk, isLatest: lastLeveledClass(c) === classId, next, trimmed,
    alwaysLost: asArray(sb?.alwaysPrepared).filter((id) => !asArray(sa?.alwaysPrepared).includes(id)).map((id) => ({ id, name: R.spellById[id]?.name || id, level: toNum(R.spellById[id]?.level) })),
  };
}

// ----- spells & items --------------------------------------------------------------------------

/** Spells a class can prepare: {classId, list, lists, maxLevel, cantrips, prepared, cantripCount, preparedCount, alwaysPrepared, spellbook, ability, dc, attack, spells:[Spell]} */
export function availableSpells(char, rules, classId) {
  const R = ensureRules(rules);
  const { sheet } = compute(char, R);
  const sc = sheet.spellcasting.find((s) => s.class === classId);
  if (!sc) return { classId, list: null, lists: [], maxLevel: 0, cantrips: 0, prepared: 0, cantripCount: 0, preparedCount: 0, alwaysPrepared: [], spellbook: null, spells: [] };
  const lists = sc.lists;
  const expanded = new Set(sc.expanded);
  const spells = R.spells.filter((s) => (asArray(s.classes).some((x) => lists.includes(x)) || expanded.has(s.id)) && toNum(s.level) <= sc.maxSpellLevel);
  return {
    classId, list: sc.list, lists, maxLevel: sc.maxSpellLevel, cantrips: sc.cantrips, prepared: sc.prepared,
    cantripCount: sc.cantripCount, preparedCount: sc.preparedCount, alwaysPrepared: sc.alwaysPrepared, spellbook: sc.spellbook,
    ability: sc.ability, dc: sc.dc, attack: sc.attack, spells,
  };
}

// ----- rests -----------------------------------------------------------------------------------

/** Long Rest (2024): full HP, temp HP gone, all Hit Dice, slots and resources back, exhaustion −1. Returns a new doc. */
export function longRest(char, rules) {
  const R = ensureRules(rules);
  const c = isObj(char) ? char : {};
  const { sheet } = compute(c, R);
  const next = clone(c);
  next.hp = { ...(isObj(next.hp) ? next.hp : {}), current: sheet.hpMax, temp: 0 };
  next.hitDiceUsed = {};
  next.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  next.pactUsed = 0;
  next.resourcesUsed = {};
  next.deathSaves = { success: 0, fail: 0 };
  if (toNum(next.exhaustion) > 0) next.exhaustion = toNum(next.exhaustion) - 1;
  if (sheet.heroicInspirationOnLongRest) next.heroicInspiration = true;
  return next;
}

/**
 * Short Rest: opts.hitDiceSpent = {10: 2} (or a count, spent from the largest die), opts.healed (or hpRegained) = HP
 * rolled; without it each spent die heals its average + CON (min 1). Pact slots back; short-recharge resources reset;
 * `shortRegain` resources (Rage, Channel Divinity, Wild Shape, Second Wind) regain that many uses. Returns a new doc.
 */
export function shortRest(char, rules, opts = {}) {
  const R = ensureRules(rules);
  const c = isObj(char) ? char : {};
  const { sheet } = compute(c, R);
  const next = clone(c);
  let spent = opts?.hitDiceSpent;
  if (typeof spent === 'number') {
    let left = Math.max(0, Math.floor(spent));
    const m = {};
    for (const hd of sheet.hitDice) { const n = Math.min(left, hd.total - hd.used); if (n > 0) { m[hd.die] = n; left -= n; } }
    spent = m;
  }
  const used = { ...(isObj(next.hitDiceUsed) ? next.hitDiceUsed : {}) };
  let avgHeal = 0;
  let any = false;
  for (const hd of sheet.hitDice) {
    const want = Math.max(0, Math.floor(toNum(spent?.[hd.die] ?? spent?.[String(hd.die)])));
    const n = Math.min(want, hd.total - hd.used);
    if (n <= 0) continue;
    any = true;
    used[hd.die] = hd.used + n;
    avgHeal += n * Math.max(1, (hd.die / 2 + 0.5) + sheet.abilities.con.mod);
  }
  next.hitDiceUsed = used;
  const heal = opts?.healed ?? opts?.hpRegained;
  const gain = heal != null && heal !== '' ? Math.max(0, toNum(heal)) : any ? Math.floor(avgHeal) : 0;
  const cur = c.hp?.current == null || c.hp?.current === '' ? sheet.hpMax : toNum(c.hp.current);
  next.hp = { ...(isObj(next.hp) ? next.hp : {}), current: Math.min(sheet.hpMax, cur + gain) };
  next.pactUsed = 0;
  const ru = { ...(isObj(next.resourcesUsed) ? next.resourcesUsed : {}) };
  for (const r of sheet.resources) {
    if (r.recharge === 'short') delete ru[r.key];
    else if (r.shortRegain && ru[r.key]) {
      const v = Math.max(0, toNum(ru[r.key]) - r.shortRegain);
      if (v) ru[r.key] = v; else delete ru[r.key];
    }
  }
  next.resourcesUsed = ru;
  return next;
}
