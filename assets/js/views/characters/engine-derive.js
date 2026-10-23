// derive(): computes the Sheet from a stored character doc + rules. Never throws on partial docs.
import {
  ABILITIES, ABILITY_NAMES, abilityMod, asArray, dieAverage, dmg, increaseMap, isObj, pad9, pickedIds, prettify, toNum, uniq,
} from './engine-util.js';
import {
  CLASS_RESOURCES, KNOWN_OPTIONS, knownFor, parseUses, usesMax,
} from './engine-known.js';
import { featAsiSpec, publicChoices, walk } from './engine-choices.js';
import { itemStats } from './engine-items.js';
import { buildRules } from './engine-rules.js';
import {
  CONDITION_EFFECTS, D20_KEYS, activeConditions, armorTrainingReasons, buildAdjust, conditionReasons, modifierReasons,
} from './engine-adjust.js';

const FIXED_HP = { 6: 4, 8: 5, 10: 6, 12: 7 };

/** Average hit points per level for a hit die (d10 -> 6). */
export function averageHp(die, rules) {
  const d = toNum(die, 8);
  const fixed = rules?.core?.hitPoints?.perLevelFixed?.[d] ?? FIXED_HP[d];
  return fixed != null ? toNum(fixed) : Math.floor(d / 2) + 1;
}

const ovNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function newFx() {
  return {
    hpPerLevel: 0, hpMax: 0, hpClass: [], speed: 0, speedUnlessHeavy: 0, speedSet: null, speeds: {},
    initiativePB: false, initiativeAbilities: [], unarmoredAC: [], acExtras: [], jack: false,
    abilityBonus: [], abilitySet: {}, increases: [],
    saves: new Set(), skills: new Set(), expertise: new Set(), condExpertise: [], armor: new Set(), weapons: new Set(),
    tools: new Set(), languages: new Set(), resistances: new Set(), senses: [], cantripBonus: {}, spells: [],
    alwaysPrepared: [], expanded: {}, spellLists: {}, skillBonusAbility: [], saveBonusAbility: [],
    mods: { speed: 0, initiative: 0, hpPerLevel: 0, hpMax: 0, profBonus: 0, attack: 0, damage: 0, spellDc: 0, spellAttack: 0, checks: 0, abilities: {}, saves: {}, skills: {} },
    unarmed: [], rangedAttack: 0, duelingDamage: 0, mediumMaxDex: null, carry: 1, masteries: new Set(),
    heroicOnLongRest: false, resources: [],
    // where each save / skill / expertise proficiency comes from: {save:{str:[label]}, skill:{…}, expertise:{…}}
    src: { save: {}, skill: {}, expertise: {}, cond: {} },
    neg: [], // negative modifier entries {field, sub, amount, label} (debuffs; skipped in the pure pass)
    pure: false,
  };
}

function addSrc(fx, kind, id, label) {
  if (!id || !label) return;
  const list = (fx.src[kind][id] = fx.src[kind][id] || []);
  if (!list.includes(label)) list.push(label);
}

/** "Background: Soldier", "Species: Elf (Keen Senses)", "Feat: Skilled", "Rogue 1: Expertise". */
function grantLabel(g) {
  const st = g.sourceType;
  if (st === 'background') return `Background: ${g.source || g.name}`;
  if (st === 'species' || st === 'subspecies') return `Species: ${g.source}${g.name && g.name !== g.source ? ` (${g.name})` : ''}`;
  if (st === 'feat') return `Feat: ${g.name}`;
  if (st === 'custom') return `Ability: ${g.name}`;
  return g.source ? `${g.source}: ${g.name}` : g.name;
}

function choiceLabel(ch) {
  if (ch.featureId === 'class-skills') return `Class: ${String(ch.source || '').replace(/ \d+$/, '')}`;
  const st = ch.sourceType;
  if (st === 'background') return `Background: ${ch.source}`;
  if (st === 'species' || st === 'subspecies') return `Species: ${ch.source}${ch.label && !String(ch.label).startsWith(ch.source) ? ` (${ch.label})` : ''}`;
  if (st === 'feat') return String(ch.source || '').startsWith('Feat') ? ch.source : `Feat: ${ch.label}`;
  if (st === 'custom') return `Ability: ${ch.label}`;
  return ch.source ? `${ch.source}: ${String(ch.label || '').replace(/:.*$/, '')}` : ch.label;
}

function applyModifiers(fx, m, label) {
  if (!isObj(m)) return;
  const M = fx.mods;
  // The pure pass (base values for sheet.adjust) ignores penalties; the real pass records them as debuffs.
  const take = (field, n, sub) => {
    if (n >= 0) return n;
    if (fx.pure) return 0;
    fx.neg.push({ field, sub: sub ?? null, amount: n, label: label || 'Modifier' });
    return n;
  };
  for (const k of ['speed', 'initiative', 'hpPerLevel', 'hpMax', 'profBonus', 'attack', 'damage', 'spellDc', 'spellAttack', 'checks']) M[k] += take(k, toNum(m[k]));
  const ac = take('ac', toNum(m.ac));
  if (ac) fx.acExtras.push({ label: label || 'Bonus', value: ac, when: 'always' });
  for (const group of ['abilities', 'saves', 'skills']) {
    if (!isObj(m[group])) continue;
    for (const [k, n] of Object.entries(m[group])) M[group][k] = toNum(M[group][k]) + take(group, toNum(n), k);
  }
  for (const r of asArray(m.resistances)) if (r) fx.resistances.add(String(r).toLowerCase());
  if (m.senses) fx.senses.push(String(m.senses));
  if (isObj(m.abilitySet)) for (const [a, n] of Object.entries(m.abilitySet)) fx.abilitySet[a] = Math.max(toNum(fx.abilitySet[a]), toNum(n));
}

function applyGrantsObj(fx, gr, g, ctx) {
  if (!isObj(gr)) return;
  for (const w of asArray(gr.weapons)) fx.weapons.add(w);
  for (const a of asArray(gr.armor)) fx.armor.add(a === 'shield' ? 'shields' : a);
  const label = grantLabel(g);
  for (const s of asArray(gr.saves)) { fx.saves.add(s); addSrc(fx, 'save', s, label); }
  const skillIds = gr.skills === 'all' ? ctx.rules.skills.map((s) => s.id) : asArray(gr.skills);
  for (const s of skillIds) { fx.skills.add(s); addSrc(fx, 'skill', s, label); }
  for (const t of asArray(gr.tools)) fx.tools.add(t);
  for (const l of asArray(gr.languages)) fx.languages.add(l);
  for (const r of asArray(gr.resistances)) fx.resistances.add(String(r).toLowerCase());
  if (gr.cantrips) fx.cantripBonus[g.classId || '_'] = toNum(fx.cantripBonus[g.classId || '_']) + toNum(gr.cantrips);
  for (const sp of asArray(gr.spells)) {
    const id = isObj(sp) ? sp.id : sp;
    const lvl = isObj(sp) ? toNum(sp.level, 1) : 1;
    if (id && lvl <= Math.max(1, ctx.totalLevel)) fx.spells.push({ id, label: g.name, source: g.source, group: groupOfGrant(g), innate: true, always: true });
  }
}

function applyKnown(fx, k, g, ctx) {
  if (!k) return;
  applyGrantsObj(fx, k.grants, g, ctx);
  fx.hpPerLevel += toNum(k.hpPerLevel);
  fx.hpMax += toNum(k.hpMax);
  if (k.hpPerClassLevel && g.classId) fx.hpClass.push({ classId: g.classId, n: toNum(k.hpPerClassLevel) });
  fx.speed += toNum(k.speed);
  fx.speedUnlessHeavy += toNum(k.speedUnlessHeavy);
  if (k.initiativePB) fx.initiativePB = true;
  if (k.initiativeAbility) fx.initiativeAbilities.push(k.initiativeAbility);
  if (k.unarmoredAC) fx.unarmoredAC.push({ ...k.unarmoredAC, label: k.unarmoredAC.label || g.name });
  if (k.acInArmor) fx.acExtras.push({ label: g.name, value: toNum(k.acInArmor), when: 'armor' });
  if (k.acHeavyArmor) fx.acExtras.push({ label: g.name, value: toNum(k.acHeavyArmor), when: 'heavy' });
  if (k.abilityBonus) fx.abilityBonus.push({ map: k.abilityBonus, max: toNum(k.abilityMax, 20) });
  if (k.jackOfAllTrades) fx.jack = true;
  fx.rangedAttack += toNum(k.rangedAttack);
  fx.duelingDamage += toNum(k.duelingDamage);
  if (k.mediumMaxDex) fx.mediumMaxDex = Math.max(toNum(fx.mediumMaxDex), toNum(k.mediumMaxDex));
  if (k.unarmed) fx.unarmed.push({ type: 'bludgeoning', ...k.unarmed });
  if (k.carryMultiplier) fx.carry = Math.max(fx.carry, toNum(k.carryMultiplier, 1));
  if (k.saveBonusAbility) fx.saveBonusAbility.push(k.saveBonusAbility);
  if (k.skillBonusAbility) fx.skillBonusAbility.push(k.skillBonusAbility);
  if (k.heroicInspirationOnLongRest) fx.heroicOnLongRest = true;
}

function groupOfGrant(g) {
  if (g.featKey) return g.featKey;
  if (g.sourceType === 'species' || g.sourceType === 'subspecies') return 'species';
  if (g.classId) return `class:${g.classId}`;
  return `${g.sourceType}:${g.id}`;
}

function groupOfChoice(ch) {
  if (ch.featKey) return ch.featKey;
  if (ch.sourceType === 'species' || ch.sourceType === 'subspecies') return 'species';
  if (ch.classId) return `class:${ch.classId}`;
  return ch.key;
}

const containsSpellChoice = (def) => isObj(def) && (def.type === 'spells' || asArray(def.parts).some(containsSpellChoice));
const RESIST_RE = /(?:^|-)resistance-([a-z]+)$/;

function classLevelOf(ctx, classId) {
  return ctx.classes.find((c) => c.id === classId)?.level ?? 0;
}

function collectGrantEffects(ctx, fx) {
  const R = ctx.rules;
  const damageIds = new Set(R.damageTypes.map((d) => d.id));
  for (const g of ctx.grants) {
    const rec = g.record || {};
    applyGrantsObj(fx, rec.grants, g, ctx);
    const known = g.sourceType === 'option' ? KNOWN_OPTIONS[`${g.featureId}:${rec.id}`] : knownFor(rec.id);
    applyKnown(fx, known, g, ctx);
    if (g.sourceType === 'species' || g.sourceType === 'subspecies') {
      if (isObj(rec.unarmoredAC)) fx.unarmoredAC.push({ base: toNum(rec.unarmoredAC.base, 10), abilities: rec.unarmoredAC.dex ? ['dex'] : [], shield: true, label: rec.name });
      if (toNum(rec.acBonus)) fx.acExtras.push({ label: rec.name, value: toNum(rec.acBonus), when: 'always' });
      if (isObj(rec.unarmed)) fx.unarmed.push({ damage: rec.unarmed.damage, type: rec.unarmed.type || 'bludgeoning', label: rec.name });
      if (typeof rec.speed === 'number') fx.speedSet = Math.max(toNum(fx.speedSet), rec.speed);
      if (isObj(rec.speeds)) Object.assign(fx.speeds, rec.speeds);
      if (rec.spell && !containsSpellChoice(rec.choice)) fx.spells.push({ id: rec.spell, label: rec.name, source: g.source, group: 'species', innate: true, always: true });
      const m = RESIST_RE.exec(rec.id || '');
      if (m && damageIds.has(m[1])) fx.resistances.add(m[1]);
    }
    if (rec.resistance) fx.resistances.add(String(rec.resistance).toLowerCase());
    if (isObj(rec.alwaysPrepared)) {
      const lvl = g.classId ? classLevelOf(ctx, g.classId) : ctx.totalLevel;
      for (const [k, ids] of Object.entries(rec.alwaysPrepared)) {
        if (toNum(k, 1) > lvl) continue;
        for (const id of asArray(ids)) {
          if (g.classId) fx.alwaysPrepared.push({ id, classId: g.classId, label: g.name });
          else fx.spells.push({ id, label: g.name, source: g.source, group: groupOfGrant(g), innate: true, always: true });
        }
      }
    }
    if (isObj(rec.expandedSpells) && g.classId) {
      const lvl = classLevelOf(ctx, g.classId);
      for (const [k, ids] of Object.entries(rec.expandedSpells)) {
        if (toNum(k, 1) <= lvl) (fx.expanded[g.classId] = fx.expanded[g.classId] || []).push(...asArray(ids));
      }
    }
    if (asArray(rec.spellLists).length && g.classId) fx.spellLists[g.classId] = asArray(rec.spellLists);
    if (isObj(rec.modifiers)) applyModifiers(fx, rec.modifiers, rec.name);
    // limited uses
    if (g.sourceType === 'custom') {
      if (toNum(rec.uses) > 0) fx.resources.push({ key: `ability:${rec.id}`, label: rec.name, max: toNum(rec.uses), recharge: rec.recharge === 'short' ? 'short' : 'long', source: 'Custom', featureId: rec.id });
    } else if (g.sourceType !== 'class' && g.sourceType !== 'background' && g.sourceType !== 'origin') {
      // Lineage-picker traits describe every lineage's uses; the picked subspecies trait carries its own.
      const picksLineage = isObj(rec.choice) && JSON.stringify(rec.choice).includes('"subspecies"');
      const u = isObj(rec.uses) ? rec.uses : picksLineage ? null : parseUses(rec.description);
      if (u) fx.resources.push({ key: rec.id, label: rec.name, uses: u, source: g.source || 'Feat', featureId: rec.id, auto: !isObj(rec.uses) });
    }
  }
}

function clampIncrease(map, spec) {
  const from = asArray(spec?.from).length ? spec.from : ABILITIES;
  const points = toNum(spec?.points, 99);
  const per = toNum(spec?.maxPerAbility, points);
  const out = {};
  let left = points;
  for (const [a, n] of Object.entries(map)) {
    if (!from.includes(a) || left <= 0) continue;
    const v = Math.min(per, n, left);
    if (v > 0) { out[a] = v; left -= v; }
  }
  return out;
}

function collectChoiceEffects(ctx, fx) {
  const R = ctx.rules;
  for (const ch of ctx.choices) {
    const v = ch.value;
    const ids = pickedIds(v);
    const def = ch.def || {};
    const label = choiceLabel(ch);
    switch (ch.type) {
      case 'skills':
        if (/expertise instead/i.test(def.note || '')) { fx.condExpertise.push(...ids); ids.forEach((id) => addSrc(fx, 'cond', id, label)); }
        else ids.forEach((id) => { fx.skills.add(id); addSrc(fx, 'skill', id, label); });
        break;
      case 'expertise': ids.forEach((id) => { fx.expertise.add(id); addSrc(fx, 'expertise', id, label); }); break;
      case 'tools': ids.forEach((id) => fx.tools.add(id)); break;
      case 'skills-or-tools': ids.forEach((id) => { if (R.skillById[id]) { fx.skills.add(id); addSrc(fx, 'skill', id, label); } else fx.tools.add(id); }); break;
      case 'languages': ids.forEach((id) => fx.languages.add(id)); break;
      case 'weapon-mastery': ids.forEach((id) => fx.masteries.add(id)); break;
      case 'damage-type':
        if (knownFor(ch.featureId)?.choiceResistance) ids.forEach((id) => fx.resistances.add(id));
        break;
      case 'options':
        if (knownFor(ch.featureId)?.optionResistance) ids.forEach((id) => fx.resistances.add(id));
        break;
      case 'spells': {
        if (def.known) break; // picks among spells you already have (e.g. Agonizing Blast's cantrip)
        let classId = ch.spellClass || ((ch.sourceType === 'class' || ch.sourceType === 'subclass' || ch.sourceType === 'option') ? ch.classId : null);
        let list = null;
        if (def.listFrom) list = pickedIds(ctx.choices.find((c) => c.key === `${ch.parentKey}/${def.listFrom}`)?.value)[0] || null;
        const innate = !classId;
        for (const id of ids) {
          fx.spells.push({
            id, label: ch.label, source: ch.source, group: groupOfChoice(ch), classId, list, innate,
            always: !!def.alwaysPrepared || innate || !!def.levelByClassLevel || !!ch.spellClass,
            addToSpellbook: !!def.addToSpellbook, fromChoice: ch.key,
          });
        }
        break;
      }
      case 'ability-increase': {
        const map = clampIncrease(increaseMap(v), { from: def.from, points: def.points ?? 1, maxPerAbility: def.maxPerAbility });
        fx.increases.push({ map, max: toNum(def.max, 20), key: ch.key });
        if (ch.featKey && knownFor(ch.featureId)?.saveFromAbilityIncrease) {
          const fl = `Feat: ${R.featById[ch.featureId]?.name || prettify(ch.featureId)}`;
          Object.keys(map).forEach((a) => { fx.saves.add(a); addSrc(fx, 'save', a, fl); });
        }
        break;
      }
      case 'asi-or-feat': {
        if (!isObj(v)) break;
        const featId = v.feat && v.feat !== 'ability-score-improvement' ? v.feat : null;
        const spec = featId ? featAsiSpec(R.featById[featId]) : { points: 2, maxPerAbility: 2, from: ABILITIES, max: 20 };
        if (!spec) break;
        const map = clampIncrease(increaseMap(v.asi), { from: spec.from, points: spec.points ?? 1, maxPerAbility: spec.maxPerAbility });
        fx.increases.push({ map, max: toNum(spec.max, 20), key: ch.key });
        if (featId && knownFor(featId)?.saveFromAbilityIncrease) {
          const fl = `Feat: ${R.featById[featId]?.name || prettify(featId)}`;
          Object.keys(map).forEach((a) => { fx.saves.add(a); addSrc(fx, 'save', a, fl); });
        }
        break;
      }
      default: break;
    }
  }
}

function classProf(ce, field) {
  const p = ce.isFirst ? ce.cls.proficiencies : ce.cls.multiclass?.proficiencies;
  return asArray(p?.[field]);
}

function rangeText(w) {
  if (w.weaponKind === 'ranged' && w.range) return `${w.range.normal}/${w.range.long} ft`;
  const reach = asArray(w.properties).includes('reach') ? 10 : 5;
  return w.thrown ? `${reach} ft (thrown ${w.thrown.normal}/${w.thrown.long} ft)` : `${reach} ft`;
}

const saveOverride = (v) => (v === true || v === 'proficient' || v === 'expertise' ? true : v === false || v === 'none' ? false : null);
const skillOverride = (v) => (v === true ? 'proficient' : v === false ? 'none' : ['none', 'proficient', 'expertise'].includes(v) ? v : null);
const profLevel = (P, E, id) => (E.has(id) ? 'expertise' : P.has(id) ? 'proficient' : 'none');

/**
 * Full computation: {sheet, ctx}. Every stat includes its debuffs; `sheet.adjust` explains them (engine-adjust.js).
 * opts.pure: ignore debuffs (Exhaustion, conditions, negative modifiers, armor penalties) — the base values.
 * opts.lite: skip the Choice option lists.
 */
export function compute(charIn, rulesIn, opts = {}) {
  const pure = !!opts.pure;
  const warnings = [];
  const R = rulesIn && rulesIn.classById ? rulesIn : buildRules(rulesIn || {});
  const c = isObj(charIn) ? charIn : {};
  const ctx = walk(c, R, warnings);
  const fx = newFx();
  fx.pure = pure;
  collectGrantEffects(ctx, fx);
  collectChoiceEffects(ctx, fx);

  // ----- debuffs. 2024 Exhaustion: every D20 Test −2 × level, Speed −5 ft × level (not DCs; passive scores count it).
  const reasons = [];
  const why = (keys, label, extra = {}) => { if (!pure) reasons.push({ keys: asArray(keys), label, ...extra }); };
  const exh = pure ? 0 : Math.max(0, Math.min(6, Math.floor(toNum(c.exhaustion))));
  const d20 = -2 * exh;
  if (exh) why(D20_KEYS, `Exhaustion ${exh}`, { amount: d20, temp: true });
  const conds = pure ? [] : activeConditions(c, R);
  const hasCond = (id) => conds.some((x) => x.id === id);
  conditionReasons(conds, why);
  const nb = (n) => (pure ? Math.max(0, toNum(n)) : toNum(n)); // negative item bonuses (cursed −1 gear) are debuffs too

  // ----- inventory
  const items = asArray(c.inventory).filter(isObj).map((i) => itemStats(i, R));
  for (const it of items) {
    if (it.unresolved) warnings.push(`Unknown item "${it.ref}" (${it.name}).`);
    if (!it.active) continue;
    applyModifiers(fx, it.modifiers, it.name);
    for (const [a, n] of Object.entries(it.abilitySet || {})) fx.abilitySet[a] = Math.max(toNum(fx.abilitySet[a]), toNum(n));
    if (it.acUnarmoredNoShield) fx.acExtras.push({ label: it.name, value: it.acUnarmoredNoShield, when: 'unarmoredNoShield' });
  }
  const attunedCount = items.filter((i) => i.requiresAttunement && i.attuned).length;
  if (attunedCount > 3) warnings.push(`Attuned to ${attunedCount} items (maximum 3).`);

  // ----- ability scores
  const base = {};
  const scores = {};
  for (const a of ABILITIES) { base[a] = toNum(c.baseAbilities?.[a], 10); scores[a] = base[a]; }
  const inc = (a, n, max) => {
    if (!ABILITIES.includes(a)) return;
    const s = scores[a];
    if (s >= max) return;
    scores[a] = Math.min(max, s + toNum(n));
  };
  for (const x of fx.increases) for (const [a, n] of Object.entries(x.map)) inc(a, n, x.max);
  for (const x of fx.abilityBonus) for (const [a, n] of Object.entries(x.map)) inc(a, n, x.max);
  for (const [a, n] of Object.entries(fx.mods.abilities)) if (ABILITIES.includes(a)) scores[a] += toNum(n);
  for (const [a, n] of Object.entries(fx.abilitySet)) if (ABILITIES.includes(a)) scores[a] = Math.max(scores[a], toNum(n));
  for (const a of ABILITIES) { const o = ovNum(c.overrides?.abilities?.[a]); if (o != null) scores[a] = o; }
  const mod = {};
  for (const a of ABILITIES) mod[a] = abilityMod(scores[a]);

  // ----- proficiency bonus
  const pbOverride = ovNum(c.overrides?.profBonus);
  const pb = pbOverride != null ? pbOverride : ctx.pb + toNum(fx.mods.profBonus);

  // ----- saves (rules -> + extraProficiencies -> overrides.proficiency.saves {dex:false|true})
  const first = ctx.classes[0] || null;
  const ovProf = isObj(c.overrides?.proficiency) ? c.overrides.proficiency : {};
  const ovSaves = isObj(ovProf.saves) ? ovProf.saves : {};
  const ovSkills = isObj(ovProf.skills) ? ovProf.skills : {};
  const rulesSaves = new Set([...asArray(first?.cls.saves), ...fx.saves]);
  const extraSaves = new Set(asArray(c.extraProficiencies?.saves));
  const saveBase = new Set([...rulesSaves, ...extraSaves]);
  const saveProf = new Set(saveBase);
  for (const [a, v] of Object.entries(ovSaves)) {
    const on = saveOverride(v);
    if (on === true && ABILITIES.includes(a)) saveProf.add(a);
    else if (on === false) saveProf.delete(a);
  }
  let saveAll = toNum(fx.mods.saves.all);
  for (const sb of fx.saveBonusAbility) saveAll += Math.max(toNum(sb.min), mod[sb.ability] ?? 0);
  const abilities = {};
  for (const a of ABILITIES) {
    const prof = saveProf.has(a);
    abilities[a] = {
      score: scores[a], mod: mod[a], base: base[a], name: ABILITY_NAMES[a], label: a.toUpperCase(),
      check: mod[a] + toNum(fx.mods.checks) + d20,
      save: mod[a] + (prof ? pb : 0) + saveAll + toNum(fx.mods.saves[a]) + toNum(c.overrides?.saves?.[a]) + d20, saveProf: prof,
    };
  }

  // ----- proficiencies
  const armorP = new Set(fx.armor);
  const weaponP = new Set(fx.weapons);
  const toolP = new Set(fx.tools);
  for (const ce of ctx.classes) {
    classProf(ce, 'armor').forEach((x) => armorP.add(x === 'shield' ? 'shields' : x));
    classProf(ce, 'weapons').forEach((x) => weaponP.add(x));
    classProf(ce, 'tools').forEach((x) => toolP.add(x));
  }
  if (ctx.background?.tool?.id) toolP.add(ctx.background.tool.id);
  const ex = c.extraProficiencies || {};
  asArray(ex.armor).forEach((x) => armorP.add(x));
  asArray(ex.weapons).forEach((x) => weaponP.add(x));
  asArray(ex.tools).forEach((x) => toolP.add(x));

  // ----- skills (rules -> + extraProficiencies -> overrides.proficiency.skills {id:'none'|'proficient'|'expertise'})
  const bgSkills = asArray(ctx.background?.skills);
  const rulesP = new Set([...fx.skills, ...bgSkills]);
  const rulesE = new Set(fx.expertise);
  for (const id of fx.condExpertise) (rulesP.has(id) ? rulesE : rulesP).add(id);
  const skillP = new Set([...fx.skills, ...bgSkills, ...asArray(ex.skills)]);
  const expertise = new Set([...fx.expertise, ...asArray(ex.expertise)]);
  for (const id of fx.condExpertise) (skillP.has(id) ? expertise : skillP).add(id);
  const baseP = new Set(skillP);
  const baseE = new Set(expertise);
  for (const [id, v] of Object.entries(ovSkills)) {
    const lvl = skillOverride(v);
    if (lvl === 'none') { skillP.delete(id); expertise.delete(id); }
    else if (lvl === 'proficient') { skillP.add(id); expertise.delete(id); }
    else if (lvl === 'expertise') { skillP.add(id); expertise.add(id); }
  }
  const skills = {};
  const skillList = R.skills.length ? R.skills : [];
  for (const s of skillList) {
    const e = expertise.has(s.id);
    const p = skillP.has(s.id) || e;
    const half = fx.jack && !p;
    let bonus = mod[s.ability] + (e ? 2 * pb : p ? pb : half ? Math.floor(pb / 2) : 0);
    bonus += toNum(fx.mods.skills.all) + toNum(fx.mods.skills[s.id]) + toNum(fx.mods.checks) + toNum(c.overrides?.skills?.[s.id]) + d20;
    for (const sba of fx.skillBonusAbility) if (sba[s.id]) bonus += Math.max(1, mod[sba[s.id]] ?? 0);
    skills[s.id] = { name: s.name, ability: s.ability, prof: p, expertise: e, half, bonus };
  }
  for (const id of expertise) if (!skillP.has(id) && skills[id]) warnings.push(`Expertise in ${skills[id].name} without proficiency.`);
  // Passive score = 10 + the check bonus (Exhaustion included); Disadvantage on the checks (Poisoned) = −5 (SRD Passive Perception).
  const passivePen = hasCond('poisoned') ? CONDITION_EFFECTS.poisoned.passive : 0;
  const pov = ovNum(c.overrides?.passivePerception);
  const passive = {
    perception: (pov != null ? pov + d20 : 10 + (skills.perception?.bonus ?? mod.wis + d20)) + passivePen,
    insight: 10 + (skills.insight?.bonus ?? mod.wis + d20) + passivePen,
    investigation: 10 + (skills.investigation?.bonus ?? mod.int + d20) + passivePen,
  };

  // ----- where each save / skill proficiency comes from (Edit all shows it and offers "reset to rules")
  const EXTRA = 'Added in Edit all';
  const proficiencyInfo = { skills: {}, saves: {} };
  const bgLabel = ctx.background ? `Background: ${ctx.background.name}` : null;
  for (const s of skillList) {
    const id = s.id;
    const sources = [];
    const add = (label, level, extra) => { if (label && !sources.some((x) => x.label === label && x.level === level)) sources.push(extra ? { label, level, extra: true } : { label, level }); };
    if (bgSkills.includes(id)) add(bgLabel, 'proficient');
    (fx.src.skill[id] || []).forEach((l) => add(l, 'proficient'));
    (fx.src.cond[id] || []).forEach((l) => add(l, rulesE.has(id) && !fx.expertise.has(id) ? 'expertise' : 'proficient'));
    (fx.src.expertise[id] || []).forEach((l) => add(l, 'expertise'));
    if (asArray(ex.skills).includes(id)) add(EXTRA, 'proficient', true);
    if (asArray(ex.expertise).includes(id)) add(EXTRA, 'expertise', true);
    proficiencyInfo.skills[id] = {
      state: profLevel(skillP, expertise, id), rules: profLevel(rulesP, rulesE, id), base: profLevel(baseP, baseE, id),
      override: skillOverride(ovSkills[id]), sources,
    };
  }
  for (const a of ABILITIES) {
    const sources = [];
    if (asArray(first?.cls.saves).includes(a)) sources.push({ label: `Class: ${first.cls.name}` });
    (fx.src.save[a] || []).forEach((l) => { if (!sources.some((x) => x.label === l)) sources.push({ label: l }); });
    if (extraSaves.has(a)) sources.push({ label: EXTRA, extra: true });
    proficiencyInfo.saves[a] = { state: saveProf.has(a), rules: rulesSaves.has(a), base: saveBase.has(a), override: saveOverride(ovSaves[a]), sources };
  }

  // ----- armor & AC
  const worn = items.filter((i) => i.equipped && i.armor);
  const bodies = worn.filter((i) => i.armor.category !== 'shield');
  const shields = worn.filter((i) => i.armor.category === 'shield');
  if (bodies.length > 1) warnings.push(`Wearing ${bodies.length} suits of armor; only "${bodies[0].name}" counts.`);
  if (shields.length > 1) warnings.push(`Holding ${shields.length} shields; only one counts.`);
  const armorItem = bodies[0] || null;
  const shieldItem = shields[0] || null;
  const heavy = armorItem?.armor.category === 'heavy';
  const parts = [];
  if (armorItem) {
    const a = armorItem.armor;
    parts.push({ label: armorItem.name, value: a.ac.base });
    if (a.ac.dex) {
      let cap = a.ac.maxDex;
      if (a.category === 'medium' && fx.mediumMaxDex) cap = Math.max(toNum(cap), fx.mediumMaxDex);
      parts.push({ label: 'DEX', value: cap == null ? mod.dex : Math.min(mod.dex, cap) });
    }
    const magicAc = nb(armorItem.bonus.ac);
    if (magicAc) parts.push({ label: 'magic', value: magicAc });
    if (magicAc < 0) why('ac', armorItem.name, { amount: magicAc });
    if (!armorP.has(a.category)) {
      warnings.push(`Not proficient with ${a.category} armor (${armorItem.name}): Disadvantage on STR/DEX rolls and no spellcasting.`);
      armorTrainingReasons(armorItem.name, why);
    }
    if (a.stealthDisadvantage) why(['skill:stealth'], armorItem.name, { note: 'Disadvantage on Dexterity (Stealth) checks' });
  } else {
    const cands = [{ label: 'Unarmored', base: 10, abilities: ['dex'], shield: true }, ...fx.unarmoredAC]
      .filter((u) => !(shieldItem && u.shield === false))
      .map((u) => ({ ...u, value: toNum(u.base, 10) + asArray(u.abilities).reduce((s, x) => s + (mod[x] ?? 0), 0) }));
    const best = cands.reduce((b, x) => (x.value > b.value ? x : b), cands[0]);
    parts.push({ label: best.label, value: toNum(best.base, 10) });
    for (const x of asArray(best.abilities)) parts.push({ label: x.toUpperCase(), value: mod[x] ?? 0 });
  }
  if (shieldItem) {
    // 2024 Armor Training: a Shield used without training gives no Armor Class bonus.
    const shieldAc = shieldItem.armor.ac.base + nb(shieldItem.bonus.ac);
    if (shieldItem.bonus.ac < 0) why('ac', shieldItem.name, { amount: toNum(shieldItem.bonus.ac) });
    if (armorP.has('shields') || pure) parts.push({ label: shieldItem.name, value: shieldAc });
    else {
      parts.push({ label: `${shieldItem.name} (untrained)`, value: 0 });
      warnings.push(`Not proficient with shields (${shieldItem.name}): no AC bonus.`);
      why('ac', `${shieldItem.name} (no Shield training)`, { amount: -(shieldItem.armor.ac.base + toNum(shieldItem.bonus.ac)), note: 'No Armor Class bonus without Shield training' });
    }
  }
  for (const x of fx.acExtras) {
    if (x.when === 'armor' && !armorItem) continue;
    if (x.when === 'heavy' && !heavy) continue;
    if (x.when === 'unarmoredNoShield' && (armorItem || shieldItem)) continue;
    parts.push({ label: x.label, value: x.value });
  }
  const acValue = parts.reduce((s, p) => s + p.value, 0);
  const acOverride = ovNum(c.overrides?.ac);
  const ac = {
    value: acOverride ?? acValue,
    formula: acOverride != null ? `Override ${acOverride}` : parts.map((p, i) => (i === 0 ? `${p.label} ${p.value}` : `${p.value < 0 ? '−' : '+'} ${p.label} ${Math.abs(p.value)}`)).join(' '),
    parts,
    computed: acValue,
  };

  // ----- speed
  const sp = ctx.species;
  let walkSpeed = sp ? Math.max(toNum(sp.speed, 30), toNum(ctx.subspecies?.speed), toNum(fx.speedSet)) : 30;
  if (!heavy) walkSpeed += fx.speedUnlessHeavy;
  if (!armorItem && !shieldItem) for (const ce of ctx.classes) walkSpeed += toNum(ce.counters?.unarmored_movement_bonus);
  walkSpeed += fx.speed + toNum(fx.mods.speed);
  if (heavy && armorItem.armor.strMin && scores.str < armorItem.armor.strMin) {
    warnings.push(`${armorItem.name} needs STR ${armorItem.armor.strMin}: Speed −10 ft.`);
    if (!pure) { walkSpeed -= 10; why('speed', `${armorItem.name} (needs Strength ${armorItem.armor.strMin})`, { amount: -10, note: 'Heavy armor: Speed −10 ft' }); }
  }
  const rawSpeed = { walk: ovNum(c.overrides?.speed) ?? walkSpeed };
  for (const [k, v] of Object.entries({ ...(isObj(sp?.speeds) ? sp.speeds : {}), ...fx.speeds })) {
    rawSpeed[k] = typeof v === 'number' ? v : rawSpeed.walk;
  }
  // Exhaustion −5 ft per level; Grappled / Paralyzed / Petrified / Restrained / Unconscious: Speed 0 (can't increase).
  const zeroBy = conds.filter((x) => CONDITION_EFFECTS[x.id]?.speed0);
  const speed = {};
  for (const [k, v] of Object.entries(rawSpeed)) speed[k] = zeroBy.length ? 0 : exh ? Math.max(0, toNum(v) - 5 * exh) : v;
  const tired = exh ? Math.max(0, toNum(rawSpeed.walk) - 5 * exh) : toNum(rawSpeed.walk);
  if (exh) why('speed', `Exhaustion ${exh}`, { amount: tired - toNum(rawSpeed.walk), note: `Speed −${5 * exh} ft`, temp: true });
  zeroBy.forEach((x, i) => why('speed', x.label, { amount: i === 0 ? -tired : 0, note: "Speed 0 (can't increase)", temp: true }));

  // ----- initiative (a Dexterity check: Exhaustion applies on top of an override)
  let init = mod.dex + (fx.initiativePB ? pb : 0) + toNum(fx.mods.initiative) + toNum(fx.mods.checks);
  for (const a of fx.initiativeAbilities) init += mod[a] ?? 0;
  const initiative = (ovNum(c.overrides?.initiative) ?? init) + d20;

  // ----- hit points & hit dice
  let hp = 0;
  const dice = new Map();
  for (const ce of ctx.classes) {
    const die = toNum(ce.cls.hitDie, 8);
    dice.set(die, (dice.get(die) || 0) + ce.level);
    for (let L = 1; L <= ce.level; L++) {
      let roll;
      if (ce.isFirst && L === 1) roll = die;
      else {
        const r = Number(asArray(ce.entry.hp)[L - 1]);
        roll = Number.isFinite(r) && r > 0 ? r : averageHp(die, R);
      }
      hp += Math.max(1, roll + mod.con);
    }
  }
  if (ctx.totalLevel > 0) {
    hp += ctx.totalLevel * (fx.hpPerLevel + toNum(fx.mods.hpPerLevel));
    for (const x of fx.hpClass) hp += x.n * classLevelOf(ctx, x.classId);
    hp += fx.hpMax + toNum(fx.mods.hpMax);
  }
  const hpMax = ovNum(c.overrides?.hpMax) ?? Math.max(0, hp);
  const hitDice = [...dice.entries()].sort((a, b) => b[0] - a[0]).map(([die, total]) => ({
    die, total, used: Math.min(total, Math.max(0, toNum(c.hitDiceUsed?.[die] ?? c.hitDiceUsed?.[String(die)]))),
  }));

  // ----- spellcasting
  const casters = [];
  const mySpells = asArray(c.spells).filter((s) => isObj(s) && s.id);
  const spellLevel = (s) => (R.spellById[s.id] ? toNum(R.spellById[s.id].level) : toNum(s.level));
  for (const ce of ctx.classes) {
    const sc = ce.cls.spellcasting;
    const row = ce.cls.levels?.[ce.level - 1] || {};
    let kind; let ability; let list; let cantrips; let prepared; let own; let focus = null; let notes = null;
    if (sc) {
      kind = sc.kind || 'full'; ability = sc.ability; list = sc.list || ce.id; focus = sc.focus || null; notes = sc.notes || null;
      cantrips = toNum(row.cantrips); prepared = toNum(row.preparedSpells);
      own = kind === 'pact' ? pad9([]) : pad9(row.slots);
    } else if (ce.sub?.spellcasting) {
      const ss = ce.sub.spellcasting;
      const srow = asArray(ss.levels).filter((l) => toNum(l.level) <= ce.level).pop();
      if (!srow) continue;
      kind = ss.kind || 'third'; ability = ss.ability; list = ss.list; notes = ss.note || null;
      cantrips = toNum(srow.cantrips); prepared = toNum(srow.prepared ?? srow.preparedSpells);
      own = pad9(srow.slots);
    } else continue;
    if (!ABILITIES.includes(ability)) ability = 'int';
    cantrips += toNum(fx.cantripBonus[ce.id]);
    const maxSpellLevel = kind === 'pact' ? toNum(row.pact?.slotLevel) : own.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0);
    const wizardLike = sc?.ritual === 'spellbook' || !!sc?.spellbook;
    const mine = mySpells.filter((s) => s.class === ce.id);
    const always = uniq([
      ...fx.alwaysPrepared.filter((x) => x.classId === ce.id).map((x) => x.id),
      ...fx.spells.filter((x) => x.classId === ce.id && x.always).map((x) => x.id),
    ]);
    const entry = {
      class: ce.id, name: ce.cls.name, subclass: ce.sub?.id ?? null, kind, ability, abilityName: ABILITY_NAMES[ability],
      mod: mod[ability], dc: 8 + pb + mod[ability] + toNum(fx.mods.spellDc), attack: pb + mod[ability] + toNum(fx.mods.spellAttack) + d20,
      cantrips, prepared, maxSpellLevel, list, lists: uniq([list, ...asArray(fx.spellLists[ce.id])]),
      expanded: uniq(asArray(fx.expanded[ce.id])), classLevel: ce.level, alwaysPrepared: always,
      cantripCount: mine.filter((s) => spellLevel(s) === 0 && !s.always).length,
      preparedCount: mine.filter((s) => spellLevel(s) > 0 && !s.always && (wizardLike ? s.prepared === true : s.prepared !== false)).length,
      changePrepared: sc?.changePrepared ?? null, ritual: sc?.ritual ?? null, focus, notes,
      spellbook: wizardLike ? { size: toNum(sc.spellbook?.start, 6) + toNum(sc.spellbook?.perLevel, 2) * (ce.level - 1), count: mine.filter((s) => spellLevel(s) > 0).length } : null,
      ownSlots: own, pact: kind === 'pact' && row.pact ? { slots: toNum(row.pact.slots), level: toNum(row.pact.slotLevel) } : null,
      wizardLike,
    };
    casters.push(entry);
  }
  const nonPact = casters.filter((x) => x.kind !== 'pact');
  let slots = pad9([]);
  let casterLevel = 0;
  if (nonPact.length === 1) {
    slots = nonPact[0].ownSlots;
    casterLevel = null;
  } else if (nonPact.length > 1) {
    for (const x of nonPact) {
      if (x.kind === 'full') casterLevel += x.classLevel;
      else if (x.kind === 'half') casterLevel += Math.ceil(x.classLevel / 2);
      else if (x.kind === 'third') casterLevel += Math.floor(x.classLevel / 3);
    }
    slots = casterLevel > 0 ? pad9(R.core?.multiclassSlotTable?.[Math.min(20, casterLevel) - 1]) : pad9([]);
  }
  const pactCaster = casters.find((x) => x.pact);
  const pact = pactCaster ? { slots: pactCaster.pact.slots, level: pactCaster.pact.level, used: Math.min(pactCaster.pact.slots, toNum(c.pactUsed)) } : null;

  // ----- spell list (prepared/known + always-prepared + feat/species spells)
  const spells = [];
  const seenSpell = new Set();
  const addSpell = (o) => {
    const k = `${o.id}|${o.class || ''}|${o.group || ''}`;
    if (seenSpell.has(k)) return;
    seenSpell.add(k);
    const rec = R.spellById[o.id] || null;
    spells.push({
      id: o.id, name: rec?.name || o.name || prettify(o.id), level: rec ? toNum(rec.level) : toNum(o.level), school: rec?.school || null,
      class: o.class || null, prepared: !!o.prepared, always: !!o.always, innate: !!o.innate, source: o.source || '',
      group: o.group || (o.class ? `class:${o.class}` : null), fromChoice: o.fromChoice || null, resolved: !!rec, record: rec,
    });
  };
  for (const s of mySpells) {
    const caster = casters.find((x) => x.class === s.class);
    addSpell({
      id: s.id, class: s.class || null, always: !!s.always, source: caster?.name || prettify(s.class) || '',
      prepared: s.always ? true : spellLevel(s) === 0 ? true : caster?.wizardLike ? s.prepared === true : s.prepared !== false,
    });
  }
  for (const x of casters) {
    for (const id of x.alwaysPrepared) {
      const from = fx.alwaysPrepared.find((a) => a.classId === x.class && a.id === id)?.label || fx.spells.find((a) => a.classId === x.class && a.id === id)?.label;
      addSpell({ id, class: x.class, always: true, prepared: true, source: from || x.name });
    }
  }
  for (const s of fx.spells) {
    if (s.classId && s.always) continue; // listed above
    addSpell({ id: s.id, class: s.classId || null, always: s.always, prepared: s.always || !s.addToSpellbook, innate: s.innate, source: s.label, group: s.group, fromChoice: s.fromChoice });
  }
  for (const s of mySpells) if (!R.spellById[s.id]) warnings.push(`Spell "${s.id}" is not in the SRD list (shown by name).`);

  // innate casting groups (species / feats)
  const innate = [];
  const groups = new Map();
  for (const s of fx.spells.filter((x) => x.innate)) {
    if (!groups.has(s.group)) groups.set(s.group, { key: s.group, source: s.source || s.label, spells: [] });
    groups.get(s.group).spells.push(s.id);
  }
  for (const gq of groups.values()) {
    const isSpecies = gq.key === 'species';
    const abilityChoice = ctx.choices.find((ch) => ch.type === 'ability' && (isSpecies ? (ch.sourceType === 'species' || ch.sourceType === 'subspecies') : ch.key.startsWith(`${gq.key}/`) || ch.key === gq.key));
    let ability = pickedIds(abilityChoice?.value)[0];
    if (!ability) {
      const incr = fx.increases.find((x) => x.key === gq.key || x.key.startsWith(`${gq.key}/`));
      ability = Object.keys(incr?.map || {}).find((a) => ['int', 'wis', 'cha'].includes(a));
    }
    if (!ability) ability = ['int', 'wis', 'cha'].reduce((b, a) => (mod[a] > mod[b] ? a : b), 'int');
    innate.push({
      key: gq.key, source: isSpecies ? (ctx.species?.name || 'Species') : gq.source, ability, abilityName: ABILITY_NAMES[ability],
      dc: 8 + pb + mod[ability] + toNum(fx.mods.spellDc), attack: pb + mod[ability] + toNum(fx.mods.spellAttack) + d20, spells: uniq(gq.spells),
    });
  }

  // ----- attacks
  const attacks = [];
  const monk = ctx.classes.find((x) => x.id === 'monk');
  const maDie = monk ? `1${String(monk.counters?.martial_arts_die || 'd6').replace(/^1?d/, 'd')}` : null;
  const monkOK = !!monk && !armorItem && !shieldItem;
  const equippedWeapons = items.filter((i) => i.equipped && i.weapon);
  for (const it of equippedWeapons) {
    const w = it.weapon;
    const props = asArray(w.properties);
    const ranged = w.weaponKind === 'ranged';
    const monkWeapon = !ranged && (w.category === 'simple' || props.includes('light'));
    let abil = ranged ? 'dex' : 'str';
    const notes = [];
    if (props.includes('finesse') || (monkOK && monkWeapon)) abil = mod.dex > mod.str ? 'dex' : 'str';
    const baseId = w.id || it.ref;
    const proficient = weaponP.has(w.category) || (!!baseId && weaponP.has(baseId));
    if (!proficient) notes.push('Not proficient');
    let die = w.damage;
    if (monkOK && monkWeapon && dieAverage(maDie) > dieAverage(die)) { die = maDie; notes.push('Martial Arts die'); }
    const archery = ranged ? fx.rangedAttack : 0;
    if (archery) notes.push(`Archery +${archery}`);
    const dueling = fx.duelingDamage && !ranged && !props.includes('two-handed') && equippedWeapons.length === 1 ? fx.duelingDamage : 0;
    if (dueling) notes.push(`Dueling +${dueling}`);
    const itemAtk = nb(it.bonus.attack);
    const itemDmg = nb(it.bonus.damage);
    if (it.bonus.attack < 0) why([`attack:${it.uid}`], it.name, { amount: toNum(it.bonus.attack) });
    if (it.bonus.damage < 0) why([`damage:${it.uid}`], it.name, { amount: toNum(it.bonus.damage) });
    const dmgBonus = mod[abil] + itemDmg + toNum(fx.mods.damage);
    const mastery = w.mastery && fx.masteries.has(baseId)
      ? { id: w.mastery, name: R.masteryById[w.mastery]?.name || prettify(w.mastery), description: R.masteryById[w.mastery]?.description || '' }
      : null;
    attacks.push({
      uid: it.uid, name: it.name, weaponId: baseId, ability: abil, proficient,
      bonus: mod[abil] + (proficient ? pb : 0) + itemAtk + toNum(fx.mods.attack) + archery + d20,
      damage: dmg(die, dmgBonus + dueling), damageBonus: dmgBonus + dueling, damageType: w.damageType,
      versatile: w.versatile ? dmg(w.versatile, dmgBonus) : null,
      range: rangeText(w), properties: props, propertyNames: props.map((p) => R.propertyById[p]?.name || prettify(p)),
      mastery, notes, magicBonus: it.bonus.attack || 0,
    });
  }
  {
    const opts = [{ die: '1', abil: 'str', label: 'Unarmed Strike', type: 'bludgeoning' }];
    if (monkOK) opts.push({ die: maDie, abil: mod.dex > mod.str ? 'dex' : 'str', label: 'Martial Arts', type: 'bludgeoning' });
    for (const u of fx.unarmed) {
      const noWeapons = !equippedWeapons.length && !shieldItem;
      opts.push({ die: noWeapons && u.noWeaponDamage ? u.noWeaponDamage : u.damage, abil: 'str', label: u.label || 'Unarmed Strike', type: u.type || 'bludgeoning' });
    }
    const score = (o) => dieAverage(o.die) + (mod[o.abil] ?? 0);
    const best = opts.reduce((b, o) => (score(o) > score(b) ? o : b), opts[0]);
    attacks.push({
      uid: null, name: 'Unarmed Strike', weaponId: null, unarmed: true, ability: best.abil, proficient: true,
      bonus: mod[best.abil] + pb + toNum(fx.mods.attack) + d20, damage: dmg(best.die, mod[best.abil] + toNum(fx.mods.damage)),
      damageBonus: mod[best.abil] + toNum(fx.mods.damage),
      damageType: best.type, versatile: null, range: '5 ft', properties: [], propertyNames: [], mastery: null,
      notes: best.label !== 'Unarmed Strike' ? [best.label] : [], magicBonus: 0,
    });
  }

  // ----- resources
  const used = isObj(c.resourcesUsed) ? c.resourcesUsed : {};
  const resources = [];
  const resKeys = new Set();
  const pushRes = (r) => {
    if (!(r.max > 0) || resKeys.has(r.key)) return;
    resKeys.add(r.key);
    resources.push({ ...r, used: Math.min(r.max, Math.max(0, toNum(used[r.key]))) });
  };
  for (const ce of ctx.classes) {
    const appearances = (fid) => asArray(ce.cls.levels).slice(0, ce.level).filter((row) => asArray(row?.features).includes(fid)).length;
    for (const d of CLASS_RESOURCES) {
      if (!d.feature.startsWith(`${ce.id}-`)) continue;
      const n = appearances(d.feature);
      if (!n) continue;
      let max = 0;
      if (d.counter) max = toNum(ce.counters?.[d.counter]);
      else if (d.uses) max = d.uses;
      else if (d.abilityMod) max = Math.max(toNum(d.min), mod[d.abilityMod]);
      else if (d.appearances) max = n;
      const recharge = d.shortFrom && appearances(d.shortFrom) ? 'short' : d.recharge;
      const r = { key: d.key, label: d.label, max, recharge, source: ce.cls.name, classId: ce.id, featureId: d.feature };
      if (recharge === 'long' && d.shortRegain) r.shortRegain = d.shortRegain;
      if (d.dieCounter && ce.counters?.[d.dieCounter]) r.die = ce.counters[d.dieCounter];
      pushRes(r);
    }
  }
  for (const r of fx.resources) {
    const max = r.uses ? usesMax(r.uses, { pb, mods: mod }) : toNum(r.max);
    pushRes({ key: r.key, label: r.label, max, recharge: r.uses ? r.uses.recharge : r.recharge, source: r.source, featureId: r.featureId, auto: !!r.auto });
  }

  // ----- features list
  const features = [];
  const featIndex = new Map();
  for (const g of ctx.grants) {
    if (g.sourceType === 'feat' && g.id === 'ability-score-improvement') continue;
    const k = `${g.sourceType}|${g.classId || ''}|${g.id}|${g.featKey || ''}|${g.parentKey || ''}`;
    const prev = featIndex.get(k);
    if (prev) {
      if (g.classLevel != null) prev.levels.push(g.classLevel);
      prev.times += 1;
      if (!prev.choiceKey && g.choiceKey) prev.choiceKey = g.choiceKey;
      continue;
    }
    let source = g.source;
    if (g.sourceType === 'feat') source = 'Feat';
    const f = {
      id: g.id, name: g.name, source, sourceType: g.sourceType, via: g.via || null,
      level: g.classLevel ?? g.charLevel ?? null, classId: g.classId, classLevel: g.classLevel, subclassId: g.subclassId,
      description: g.description, choiceKey: g.choiceKey, parentKey: g.parentKey, featKey: g.featKey,
      levels: g.classLevel != null ? [g.classLevel] : [], times: 1,
    };
    const res = resources.find((r) => r.featureId === g.id);
    if (res) f.uses = { key: res.key, max: res.max, used: res.used, recharge: res.recharge };
    featIndex.set(k, f);
    features.push(f);
  }

  // ----- languages, resistances, senses, size, encumbrance
  const startKnown = asArray(R.core?.startingLanguages?.known ?? ['common']);
  const languages = uniq([...startKnown, ...fx.languages, ...asArray(ex.languages)].filter(Boolean));
  const dv = ctx.subspecies?.darkvision ?? sp?.darkvision ?? null;
  const sensesList = [dv ? `Darkvision ${dv} ft.` : null, ...fx.senses].filter(Boolean);
  const sizeRaw = c.species?.size || sp?.size || (asArray(sp?.sizeOptions).includes('Medium') ? 'Medium' : asArray(sp?.sizeOptions)[0]) || 'Medium';
  const size = prettify(sizeRaw);
  const cur = isObj(c.currency) ? c.currency : {};
  const coins = ['cp', 'sp', 'ep', 'gp', 'pp'].reduce((s, k) => s + Math.max(0, toNum(cur[k])), 0);
  const carried = Math.round((items.reduce((s, i) => s + i.totalWeight, 0) + coins / 50) * 100) / 100;
  const sizeMult = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8 }[size.toLowerCase()] ?? 1;
  const capacity = scores.str * toNum(R.core?.carryingCapacity?.perStr, 15) * sizeMult * fx.carry;

  const classLine = ctx.classes.map((ce) => `${ce.cls.name} ${ce.level}${ce.sub ? ` (${ce.sub.name})` : ''}`).join(' / ');
  const xpTable = asArray(R.core?.xpByLevel);
  const hpCur = c.hp?.current;

  const sheet = {
    name: c.name || '',
    totalLevel: ctx.totalLevel, level: ctx.totalLevel, classLine,
    classes: ctx.classes.map((ce) => ({
      id: ce.id, name: ce.cls.name, level: ce.level, subclass: ce.sub?.id ?? null, subclassName: ce.sub?.name ?? null,
      hitDie: toNum(ce.cls.hitDie, 8), counters: ce.counters,
    })),
    profBonus: pb, xp: toNum(c.xp), nextLevelXp: ctx.totalLevel < 20 ? xpTable[ctx.totalLevel] ?? null : null,
    abilities, saves: Object.fromEntries(ABILITIES.map((a) => [a, abilities[a].save])),
    skills, passive, ac, initiative, speed, hpMax,
    hp: { current: hpCur == null || hpCur === '' ? hpMax : Math.min(toNum(hpCur), hpMax), temp: Math.max(0, toNum(c.hp?.temp)), max: hpMax },
    hitDice, size, senses: sensesList.join(', '), sensesList, darkvision: dv,
    languages, languageNames: languages.map((l) => R.languageById[l]?.name || prettify(l)),
    resistances: uniq([...fx.resistances]),
    proficiencies: { armor: uniq([...armorP]), weapons: uniq([...weaponP]), tools: uniq([...toolP]), saves: [...saveProf], skills: [...skillP].filter((s) => skills[s]), expertise: [...expertise] },
    features, resources,
    spellcasting: casters.map(({ ownSlots, wizardLike, ...x }) => ({ ...x, slots: ownSlots })),
    slots, slotsUsed: pad9(c.slotsUsed).map((n, i) => Math.min(slots[i], Math.max(0, n))), casterLevel, pact, spells, innate,
    attacks, weaponMasteries: [...fx.masteries],
    armorWorn: armorItem ? { uid: armorItem.uid, name: armorItem.name, category: armorItem.armor.category, ac: armorItem.armor.ac, bonus: armorItem.bonus.ac, strMin: armorItem.armor.strMin, stealthDisadvantage: armorItem.armor.stealthDisadvantage, proficient: armorP.has(armorItem.armor.category) } : null,
    shield: shieldItem ? { uid: shieldItem.uid, name: shieldItem.name, ac: shieldItem.armor.ac.base + shieldItem.bonus.ac, proficient: armorP.has('shields') } : null,
    encumbrance: { carried, capacity, encumbered: carried > capacity, dragLiftPush: capacity * 2, coins },
    items,
    heroicInspirationOnLongRest: fx.heroicOnLongRest,
    exhaustion: Math.max(0, Math.min(6, toNum(c.exhaustion))),
    proficiencyInfo,
    adjust: {},
    choices: [], pending: [], warnings,
  };
  if (!opts.lite) {
    const choices = publicChoices(ctx, sheet);
    sheet.choices = choices;
    sheet.pending = choices.filter((ch) => !ch.complete);
  }
  if (!pure) {
    modifierReasons(fx.neg, why, { totalLevel: ctx.totalLevel });
    if (reasons.length) {
      const ov = c.overrides || {};
      const overridden = new Set([['ac', ov.ac], ['initiative', ov.initiative], ['speed', ov.speed], ['hpMax', ov.hpMax], ['profBonus', ov.profBonus], ['passive:perception', ov.passivePerception]]
        .filter(([, v]) => ovNum(v) != null).map(([k]) => k));
      for (const a of ABILITIES) if (ovNum(ov.abilities?.[a]) != null) overridden.add(`score:${a}`);
      // Only numeric reasons need the base pass; note-only debuffs (Disadvantage…) diff against the sheet itself.
      const baseSheet = reasons.some((r) => r.amount || r.cascade) ? compute(c, R, { pure: true, lite: true }).sheet : sheet;
      sheet.adjust = buildAdjust(sheet, baseSheet, reasons, { overridden, initiativeAbilities: fx.initiativeAbilities, initiativePB: fx.initiativePB });
    }
  }
  return { sheet, ctx };
}
