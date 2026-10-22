// Node test for the character rules engine (no deps): node tools/test_engine.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/characters/engine.js')).href);
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'srd', `${name}.json`), 'utf8'));

const files = {
  classes: load('classes'), features: load('features'), subclasses: load('subclasses'), species: load('species'),
  backgrounds: load('backgrounds'), feats: load('feats'), spells: load('spells'), weapons: load('weapons'), armor: load('armor'),
  gear: load('gear'), magicItems: load('magic-items'), rules: load('rules'),
  stubs: { subclasses: load('stubs/subclasses'), species: load('stubs/species'), backgrounds: load('stubs/backgrounds'), feats: load('stubs/feats') },
  custom: {
    weapon: [{ id: 'stone-sling-x1', name: 'Warden Sling', kind: 'weapon', weaponKind: 'ranged', category: 'simple', damage: '1d6', damageType: 'bludgeoning', properties: ['ammunition'], mastery: 'slow', range: { normal: 30, long: 120 }, weight: 0 }],
    ability: [{ id: 'stoneborn-grit', name: 'Stoneborn Grit', description: 'Once per long rest…', uses: 1, recharge: 'long', modifiers: { ac: 1 } }],
  },
};
const rules = E.buildRules(files);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`- ${t}`);

const char = (over = {}) => ({ ...E.newCharacter({ name: 'Test', player: 'Tester' }), ...over });
const choiceByKey = (sheet, key) => sheet.choices.find((c) => c.key === key);
const res = (sheet, key) => sheet.resources.find((r) => r.key === key);
const inv = (uid, kind, ref, extra = {}) => ({ uid, kind, ref, qty: 1, equipped: true, attuned: false, notes: '', custom: null, ...extra });

// ------------------------------------------------------------------------------------------------
section('rules index');
check('classes indexed', !!rules.classById.fighter && rules.classes.length >= 12);
check('stub subclasses merged', rules.subclassById['eldritch-knight']?.origin === 'stub');
check('custom weapon merged with weaponKind', rules.weaponById['stone-sling-x1']?.weaponKind === 'ranged' && rules.weaponById['stone-sling-x1']?.origin === 'custom');
check('srd weapon kind normalised', rules.weaponById.longbow.weaponKind === 'ranged' && rules.weaponById.longsword.weaponKind === 'melee');
check('subclassesByClass includes stubs', rules.subclassesByClass.fighter.some((s) => s.id === 'battle-master'));

// ------------------------------------------------------------------------------------------------
section('blank / partial documents');
{
  const s = E.derive(char(), rules);
  eq('blank totalLevel', s.totalLevel, 0);
  eq('blank hpMax', s.hpMax, 0);
  eq('blank AC', s.ac.value, 10);
  eq('blank speed', s.speed.walk, 30);
  eq('blank prof bonus', s.profBonus, 2);
  eq('blank warnings', s.warnings, []);
  check('blank has 18 skills', Object.keys(s.skills).length === 18);
  check('blank pending languages only', s.pending.length === 1 && s.pending[0].key === 'origin:languages', s.pending.map((p) => p.key));
  check('blank unarmed strike attack', s.attacks.length === 1 && s.attacks[0].damage === '1');
  for (const junk of [null, undefined, {}, { classes: 'x', inventory: [null, 5, { kind: 'weapon', ref: 'nope', equipped: true }], species: { id: 'nope' }, choices: null, spells: [null, { id: 'no-such-spell', class: 'wizard' }] }]) {
    let ok = true;
    let sheet;
    try { sheet = E.derive(junk, rules); } catch (e) { ok = false; }
    check(`derive(${JSON.stringify(junk)?.slice(0, 40)}) does not throw`, ok && sheet && typeof sheet.ac.value === 'number');
  }
  const s2 = E.derive({ species: { id: 'nope' }, classes: [{ id: 'nope', level: 3 }] }, rules);
  check('unknown ids produce warnings', s2.warnings.length >= 2, s2.warnings);
  let ok = true;
  try { E.derive(char(), {}); E.derive(char(), null); } catch { ok = false; }
  check('derive with empty rules does not throw', ok);
}

// ------------------------------------------------------------------------------------------------
section('Fighter 5 Champion (Dwarf, Soldier)');
const fighter = char({
  species: { id: 'dwarf', subspecies: null, size: null },
  background: { id: 'soldier', abilityBonuses: { str: 2, con: 1 } },
  baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  classes: [{ id: 'fighter', level: 5, subclass: 'champion', hp: [10, 6, 6, 6, 6] }],
  skills: ['acrobatics', 'perception'],
  choices: {
    'fighter-fighting-style@fighter:1': 'defense',
    'fighter-ability-score-improvement@fighter:4': { asi: { str: 2 } },
    'fighter-weapon-mastery@fighter:1': ['longsword', 'handaxe', 'javelin', 'greatsword'],
    'background:tool': ['dice'],
    'origin:languages': ['dwarvish', 'giant'],
  },
  inventory: [inv('a', 'armor', 'chain-mail'), inv('b', 'armor', 'shield'), inv('c', 'weapon', 'longsword'), inv('d', 'weapon', 'handaxe', { equipped: false, qty: 2 })],
});
{
  const s = E.derive(fighter, rules);
  eq('fighter classLine', s.classLine, 'Fighter 5 (Champion)');
  eq('fighter prof', s.profBonus, 3);
  eq('fighter STR 15+2+2', s.abilities.str.score, 19);
  eq('fighter CON 14+1', s.abilities.con.score, 15);
  // 12 (10+2) + 4×(6+2) + Dwarven Toughness 5
  eq('fighter hpMax', s.hpMax, 49);
  eq('fighter AC chain+shield+defense', s.ac.value, 19);
  check('fighter AC formula mentions Defense', /Chain Mail 16/.test(s.ac.formula) && /Defense/.test(s.ac.formula), s.ac.formula);
  const ls = s.attacks.find((a) => a.weaponId === 'longsword');
  eq('longsword attack bonus', ls?.bonus, 7);
  eq('longsword damage', ls?.damage, '1d8+4');
  eq('longsword versatile', ls?.versatile, '1d10+4');
  eq('longsword mastery', ls?.mastery?.id, 'sap');
  check('unequipped handaxe not an attack', !s.attacks.some((a) => a.weaponId === 'handaxe'));
  eq('saves: STR prof', [s.abilities.str.saveProf, s.abilities.con.saveProf, s.abilities.dex.saveProf], [true, true, false]);
  eq('STR save', s.abilities.str.save, 7);
  check('soldier skills', s.skills.athletics.prof && s.skills.intimidation.prof);
  check('class skills from char.skills', s.skills.acrobatics.prof && s.skills.perception.prof);
  eq('perception bonus', s.skills.perception.bonus, 1 + 3);
  eq('passive perception', s.passive.perception, 14);
  check('dwarf poison resistance', s.resistances.includes('poison'));
  eq('darkvision', s.darkvision, 120);
  check('second wind resource', res(s, 'second-wind')?.max === 3 && res(s, 'second-wind')?.shortRegain === 1);
  check('action surge resource', res(s, 'action-surge')?.max === 1 && res(s, 'action-surge')?.recharge === 'short');
  const asi = choiceByKey(s, 'fighter-ability-score-improvement@fighter:4');
  check('ASI choice present & complete', asi?.type === 'asi-or-feat' && asi.complete, asi);
  const wm = choiceByKey(s, 'fighter-weapon-mastery@fighter:1');
  eq('weapon mastery count at fighter 5 (data: 4 from level 4)', wm?.count, 4);
  check('weapon mastery complete', wm?.complete);
  check('features include Improved Critical (Champion 3)', s.features.some((f) => f.id === 'champion-improved-critical' && f.source === 'Champion 3'));
  check('features include savage attacker (background feat)', s.features.some((f) => f.id === 'savage-attacker' && f.source === 'Feat'));
  check('no subclass placeholder when subclass chosen', !s.features.some((f) => /subclass-feature$/.test(f.id)));
  eq('fighter pending', s.pending.map((p) => p.key), []);
  check('languages', ['common', 'dwarvish', 'giant'].every((l) => s.languages.includes(l)), s.languages);
  check('tools: dice from background', s.proficiencies.tools.includes('dice'));
  check('hit dice d10 ×5', s.hitDice.length === 1 && s.hitDice[0].die === 10 && s.hitDice[0].total === 5);
  check('encumbrance', s.encumbrance.carried === 55 + 6 + 3 + 4 && s.encumbrance.capacity === 19 * 15, s.encumbrance);
  // weapon mastery count at level 3 is 3
  const f3 = E.derive({ ...fighter, classes: [{ id: 'fighter', level: 3, subclass: 'champion', hp: [10, 6, 6] }] }, rules);
  eq('weapon mastery count at fighter 3', choiceByKey(f3, 'fighter-weapon-mastery@fighter:1')?.count, 3);
  // heavy armor without the STR
  const weak = E.derive({ ...fighter, baseAbilities: { ...fighter.baseAbilities, str: 8 }, choices: { ...fighter.choices, 'fighter-ability-score-improvement@fighter:4': { asi: { dex: 2 } } } }, rules);
  eq('chain mail STR 13 speed penalty', weak.speed.walk, 20);
}

// ------------------------------------------------------------------------------------------------
section('Wizard 5');
{
  const s = E.derive(char({
    species: { id: 'human', size: 'Medium' }, background: { id: 'sage', abilityBonuses: { int: 2, con: 1 } },
    baseAbilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    classes: [{ id: 'wizard', level: 5, subclass: 'evoker', hp: [6, 4, 4, 4, 4] }],
    spells: [{ id: 'fire-bolt', class: 'wizard' }, { id: 'magic-missile', class: 'wizard', prepared: true }, { id: 'shield', class: 'wizard', prepared: false }],
  }), rules);
  eq('wizard slots 4/3/2', s.slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  const sc = s.spellcasting.find((x) => x.class === 'wizard');
  eq('wizard DC', sc?.dc, 8 + 3 + 4);
  eq('wizard attack', sc?.attack, 3 + 4);
  eq('wizard cantrips/prepared', [sc?.cantrips, sc?.prepared, sc?.maxSpellLevel], [4, 9, 3]);
  eq('wizard prepared count (spellbook)', sc?.preparedCount, 1);
  eq('wizard spellbook size', sc?.spellbook?.size, 14);
  check('magic initiate (sage) defaults to wizard list', choiceByKey(s, 'feat:magic-initiate/spell-list')?.value === 'wizard');
  const mi = choiceByKey(s, 'feat:magic-initiate/1');
  check('magic initiate cantrip options are wizard cantrips', mi?.options.length > 0 && mi.options.every((o) => o.level === 0 && rules.spellById[o.id].classes.includes('wizard')), mi?.options?.length);
  const av = E.availableSpells(char({ classes: [{ id: 'wizard', level: 5 }] }), rules, 'wizard');
  check('availableSpells max level 3 and wizard list', av.maxLevel === 3 && av.spells.length > 20 && av.spells.every((x) => x.level <= 3));
  check('human versatile origin feat choice', choiceByKey(s, 'species:versatile')?.type === 'feat');
  check('human size choice', choiceByKey(s, 'species:size')?.value === 'Medium');
}

// ------------------------------------------------------------------------------------------------
section('Warlock 5');
{
  const s = E.derive(char({ baseAbilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 }, classes: [{ id: 'warlock', level: 5, subclass: 'fiend-patron' }] }), rules);
  eq('warlock pact slots', s.pact && [s.pact.slots, s.pact.level], [2, 3]);
  eq('warlock no regular slots', s.slots, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  eq('warlock invocations count', choiceByKey(s, 'warlock-eldritch-invocations@warlock:1')?.count, 5);
  const sc = s.spellcasting.find((x) => x.class === 'warlock');
  eq('warlock kind & max level', [sc?.kind, sc?.maxSpellLevel], ['pact', 3]);
  check('fiend always-prepared spells', ['burning-hands', 'command', 'scorching-ray', 'suggestion', 'fireball', 'stinking-cloud'].every((id) => sc.alwaysPrepared.includes(id)), sc?.alwaysPrepared);
  // Agonizing Blast nested choice
  const s2 = E.derive(char({ classes: [{ id: 'warlock', level: 5 }], choices: { 'warlock-eldritch-invocations@warlock:1': ['agonizing-blast', 'armor-of-shadows'] } }), rules);
  check('nested option choice key', !!choiceByKey(s2, 'warlock-eldritch-invocations@warlock:1>agonizing-blast'));
}

// ------------------------------------------------------------------------------------------------
section('Rogue 6 expertise');
{
  const c = char({
    background: { id: 'criminal', abilityBonuses: { dex: 2, int: 1 } },
    baseAbilities: { str: 10, dex: 15, con: 14, int: 12, wis: 12, cha: 8 },
    classes: [{ id: 'rogue', level: 6, subclass: 'thief' }],
    skills: ['acrobatics', 'perception', 'deception', 'insight'],
    choices: { 'rogue-expertise@rogue:1': ['stealth', 'perception'] },
  });
  const s = E.derive(c, rules);
  const e1 = choiceByKey(s, 'rogue-expertise@rogue:1');
  const e6 = choiceByKey(s, 'rogue-expertise@rogue:6');
  check('two expertise keys', !!e1 && !!e6 && e1.count === 2 && e6.count === 2);
  check('expertise 1 complete, 6 pending', e1.complete && !e6.complete && s.pending.some((p) => p.key === e6.key));
  eq('stealth expertise bonus', s.skills.stealth.bonus, 3 + 2 * 3);
  check('expertise options only proficient skills', e6.options.every((o) => s.skills[o.id].prof), e6.options.map((o) => o.id));
  check('sneak attack counter on class', s.classes[0].counters.sneak_attack === '3d6');
  check("thieves' tools proficiency", s.proficiencies.tools.includes('thieves-tools'));
}

// ------------------------------------------------------------------------------------------------
section('Barbarian');
{
  const base = char({ baseAbilities: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 8 }, classes: [{ id: 'barbarian', level: 3 }] });
  const s = E.derive(base, rules);
  eq('barbarian unarmored AC 10+2+3', s.ac.value, 15);
  eq('rage count at 3', res(s, 'rage')?.max, 3);
  eq('rage recharge', [res(s, 'rage')?.recharge, res(s, 'rage')?.shortRegain], ['long', 1]);
  const sh = E.derive({ ...base, inventory: [inv('s', 'armor', 'shield')] }, rules);
  eq('barbarian unarmored + shield', sh.ac.value, 17);
  const b5 = E.derive({ ...base, classes: [{ id: 'barbarian', level: 5 }] }, rules);
  eq('fast movement', b5.speed.walk, 40);
  eq('barbarian pending subclass', E.validateChoices(base, rules).some((p) => p.key === 'barbarian-subclass@barbarian:3'), true);
}

// ------------------------------------------------------------------------------------------------
section('Monk 5');
{
  const c = char({ species: { id: 'human' }, baseAbilities: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 10 }, classes: [{ id: 'monk', level: 5 }] });
  const s = E.derive(c, rules);
  const ua = s.attacks.find((a) => a.unarmed);
  eq('monk martial arts unarmed', [ua?.damage, ua?.ability, ua?.bonus], ['1d8+3', 'dex', 6]);
  eq('focus points', [res(s, 'focus-points')?.max, res(s, 'focus-points')?.recharge], [5, 'short']);
  eq('monk AC 10+3+2', s.ac.value, 15);
  eq('monk speed 30+10', s.speed.walk, 40);
  const qs = E.derive({ ...c, inventory: [inv('q', 'weapon', 'quarterstaff')] }, rules);
  const q = qs.attacks.find((a) => a.weaponId === 'quarterstaff');
  eq('monk weapon uses DEX + MA die', [q?.ability, q?.damage], ['dex', '1d8+3']);
  const sh = E.derive({ ...c, inventory: [inv('s', 'armor', 'shield')] }, rules);
  // 2024 Armor Training: no Shield training -> no AC bonus from it (and Unarmored Defense is lost while holding it).
  check('monk with shield loses Unarmored Defense (untrained shield: no AC)', sh.ac.value === 10 + 3 && sh.speed.walk === 30, [sh.ac, sh.speed]);
  eq('untrained shield AC reason', [sh.adjust.ac?.base, sh.adjust.ac?.value, sh.adjust.ac?.reasons?.[0]?.amount], [15, 13, -2]);
}

// ------------------------------------------------------------------------------------------------
section('Multiclass Paladin 2 / Sorcerer 3');
{
  const c = char({
    baseAbilities: { str: 14, dex: 10, con: 14, int: 8, wis: 10, cha: 16 },
    classes: [{ id: 'paladin', level: 2, hp: [10, 6] }, { id: 'sorcerer', level: 3, hp: [4, 4, 4] }],
  });
  const s = E.derive(c, rules);
  eq('caster level ceil(2/2)+3 = 4', s.casterLevel, 4);
  eq('multiclass slots 4/3', s.slots, [4, 3, 0, 0, 0, 0, 0, 0, 0]);
  eq('saves from first class only', [s.abilities.wis.saveProf, s.abilities.cha.saveProf, s.abilities.con.saveProf], [true, true, false]);
  eq('two spellcasting entries', s.spellcasting.map((x) => x.class), ['paladin', 'sorcerer']);
  eq('hit dice per die size', s.hitDice.map((h) => [h.die, h.total]), [[10, 2], [6, 3]]);
  const ok = E.canMulticlass(char({ baseAbilities: { str: 14, dex: 10, con: 14, int: 8, wis: 10, cha: 16 }, classes: [{ id: 'paladin', level: 2 }] }), rules, 'sorcerer');
  eq('canMulticlass paladin->sorcerer', ok.ok, true);
  const no = E.canMulticlass(char({ baseAbilities: { str: 14, dex: 10, con: 14, int: 8, wis: 10, cha: 12 }, classes: [{ id: 'paladin', level: 2 }] }), rules, 'sorcerer');
  check('canMulticlass fails without CHA 13', !no.ok && no.reasons.length >= 2, no);
  const sorcSkill = choiceByKey(s, 'class-skills@sorcerer:1');
  check('no multiclass skill pick for sorcerer', !sorcSkill);
}

// ------------------------------------------------------------------------------------------------
section('Level-up plan & apply');
{
  const f2 = char({ baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, classes: [{ id: 'fighter', level: 2, hp: [10, 6] }], hp: { current: 20, temp: 0 } });
  const plan = E.levelUpPlan(f2, rules, 'fighter');
  eq('plan new level', plan.newLevel, 3);
  const sub = plan.choices.find((ch) => ch.type === 'subclass');
  check('plan has subclass choice', sub?.key === 'fighter-subclass@fighter:3', plan.choices.map((x) => x.key));
  check('subclass options include SRD + stubs', ['champion', 'battle-master', 'eldritch-knight'].every((id) => sub.options.some((o) => o.id === id)));
  check('plan features include Fighter Subclass', plan.features.some((f) => f.id === 'fighter-subclass'));
  eq('plan hp average', [plan.hitDie, plan.hpAverage, plan.hpGain], [10, 6, 8]);
  const f3 = E.applyLevelUp(f2, rules, 'fighter', { hpRoll: 9, choices: { 'fighter-subclass@fighter:3': 'champion' } });
  eq('applied level/hp', [f3.classes[0].level, f3.classes[0].hp], [3, [10, 6, 9]]);
  eq('applied subclass mirrored', f3.classes[0].subclass, 'champion');
  eq('applied current hp rises', f3.hp.current, 20 + 11);
  check('input doc untouched', f2.classes[0].level === 2);
  const p4 = E.levelUpPlan(f3, rules, 'fighter');
  check('plan 4: ASI + weapon mastery count up', p4.choices.some((x) => x.key === 'fighter-ability-score-improvement@fighter:4') && p4.choices.some((x) => x.key === 'fighter-weapon-mastery@fighter:1' && x.count === 4), p4.choices.map((x) => `${x.key}:${x.count}`));
  let threw = false;
  try { E.applyLevelUp(f3, rules, 'wizard', {}); } catch { threw = true; }
  check('multiclass into wizard with INT 8 throws', threw);
  const fresh = E.applyLevelUp(char(), rules, 'cleric', {});
  eq('first level hp = max die', fresh.classes[0].hp, [8]);
  const w5 = char({ classes: [{ id: 'wizard', level: 4 }], baseAbilities: { str: 8, dex: 14, con: 14, int: 16, wis: 10, cha: 10 } });
  const wp = E.levelUpPlan(w5, rules, 'wizard');
  eq('wizard 4->5 new slot level', [wp.slotsBefore[2], wp.slotsAfter[2], wp.newPrepared], [0, 2, 2]);
  const down = E.levelDown(f3, rules, 'fighter');
  eq('levelDown removes subclass below 3 and the level choice', [down.classes[0].level, down.classes[0].subclass, down.choices['fighter-subclass@fighter:3']], [2, null, undefined]);
}

// ------------------------------------------------------------------------------------------------
section('Eldritch Knight (stub third-caster)');
{
  const ek = (lvl, extra = []) => char({ baseAbilities: { str: 15, dex: 12, con: 14, int: 14, wis: 10, cha: 8 }, classes: [{ id: 'fighter', level: lvl, subclass: 'eldritch-knight' }, ...extra] });
  eq('EK 3 slots', E.derive(ek(3), rules).slots, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const s7 = E.derive(ek(7), rules);
  eq('EK 7 slots', s7.slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  const sc = s7.spellcasting.find((x) => x.class === 'fighter');
  eq('EK casting', [sc?.kind, sc?.ability, sc?.list, sc?.cantrips, sc?.prepared], ['third', 'int', 'wizard', 2, 5]);
  eq('EK 2 has no casting', E.derive(ek(2), rules).spellcasting.length, 0);
  const mc = E.derive(ek(9, [{ id: 'wizard', level: 1 }]), rules);
  eq('EK 9 + Wizard 1 -> caster level 4', [mc.casterLevel, mc.slots.slice(0, 3)], [4, [4, 3, 0]]);
  check('EK spellcasting feature has no duplicate cantrip choice', !E.choicesFor(ek(3), rules).some((x) => x.key.startsWith('eldritch-knight-spellcasting')));
}

// ------------------------------------------------------------------------------------------------
section('Point buy');
{
  eq('standard array cost 27', E.abilityPointBuyCost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, rules), 27);
  eq('all 8 cost 0', E.abilityPointBuyCost({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), 0);
  eq('16 is invalid', E.abilityPointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), null);
  const info = E.pointBuyInfo({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }, rules);
  eq('pointBuyInfo', [info.cost, info.remaining, info.valid], [27, 0, true]);
  check('over budget invalid', !E.pointBuyInfo({ str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 }, rules).valid);
}

// ------------------------------------------------------------------------------------------------
section('Rests');
{
  const c = char({
    baseAbilities: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 8 },
    classes: [{ id: 'barbarian', level: 3, hp: [12, 7, 7] }, { id: 'warlock', level: 1, hp: [5] }],
    hp: { current: 5, temp: 4 }, hitDiceUsed: { 12: 2 }, slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 1,
    resourcesUsed: { rage: 3 }, exhaustion: 2, deathSaves: { success: 1, fail: 2 },
  });
  const sh = E.shortRest(c, rules, { hitDiceSpent: { 12: 1 }, healed: 9 });
  eq('short rest heals', sh.hp.current, 14);
  eq('short rest hit die spent', sh.hitDiceUsed['12'], 3);
  eq('short rest pact back', sh.pactUsed, 0);
  eq('short rest rage regains 1', sh.resourcesUsed.rage, 2);
  const lr = E.longRest(c, rules);
  const max = E.derive(c, rules).hpMax;
  eq('long rest hp', [lr.hp.current, lr.hp.temp], [max, 0]);
  eq('long rest resets', [lr.hitDiceUsed, lr.slotsUsed, lr.pactUsed, lr.resourcesUsed, lr.exhaustion, lr.deathSaves], [{}, [0, 0, 0, 0, 0, 0, 0, 0, 0], 0, {}, 1, { success: 0, fail: 0 }]);
  check('rests do not mutate input', c.hp.current === 5 && c.resourcesUsed.rage === 3);
  const human = E.longRest(char({ species: { id: 'human' }, classes: [{ id: 'fighter', level: 1 }] }), rules);
  eq('human resourceful heroic inspiration', human.heroicInspiration, true);
}

// ------------------------------------------------------------------------------------------------
section('Species, feats, items, custom');
{
  const drow = E.derive(char({ species: { id: 'elf', subspecies: 'elven-lineage-drow' }, classes: [{ id: 'rogue', level: 5 }] }), rules);
  eq('drow darkvision 120', drow.darkvision, 120);
  check('drow innate spells by level', drow.spells.some((x) => x.id === 'faerie-fire') && drow.spells.some((x) => x.id === 'darkness') && drow.innate.length === 1, drow.innate);
  check('elven lineage ability part key', !!choiceByKey(drow, 'species:elven-lineage/spellcasting-ability'));
  const mi = E.derive(char({ species: { id: 'human' }, background: { id: 'acolyte' }, classes: [{ id: 'paladin', level: 2 }], choices: { 'species:versatile': 'magic-initiate', 'paladin-fighting-style@paladin:2': 'blessed-warrior' } }), rules);
  eq('background Magic Initiate is instance 1 (cleric from feat.note)', choiceByKey(mi, 'feat:magic-initiate/spell-list')?.value, 'cleric');
  check('second Magic Initiate instance key', !!choiceByKey(mi, 'feat:magic-initiate@2/spell-list') && choiceByKey(mi, 'feat:magic-initiate@2/spell-list').value === undefined);
  check('Blessed Warrior alternative opens cleric cantrip choice', choiceByKey(mi, 'paladin-fighting-style@paladin:2>blessed-warrior')?.options.every((o) => o.level === 0));
  const wood = E.derive(char({ species: { id: 'elf', subspecies: 'elven-lineage-wood-elf' } }), rules);
  eq('wood elf speed', wood.speed.walk, 35);
  const sc = E.setChoice(char({ classes: [{ id: 'fighter', level: 3 }] }), 'fighter-subclass@fighter:3', 'champion');
  eq('setChoice mirrors subclass', sc.classes[0].subclass, 'champion');
  const sk = E.setChoice(char({ classes: [{ id: 'fighter', level: 1 }] }), 'class-skills@fighter:1', ['athletics', 'perception']);
  eq('setChoice mirrors class skills', sk.skills, ['athletics', 'perception']);
  const sp = E.setChoice(char({ species: { id: 'elf' } }), 'species:subspecies', 'elven-lineage-drow');
  eq('setChoice mirrors subspecies', sp.species.subspecies, 'elven-lineage-drow');
  // feat via ASI + Tough + Alert + ring + magic weapon
  const c = char({
    species: { id: 'human' }, background: { id: 'criminal', abilityBonuses: { dex: 2, con: 1 } },
    baseAbilities: { str: 10, dex: 16, con: 14, int: 10, wis: 12, cha: 10 },
    classes: [{ id: 'rogue', level: 4 }],
    choices: { 'species:versatile': 'tough', 'rogue-ability-score-improvement@rogue:4': { feat: 'resilient', asi: { con: 1 } } },
    inventory: [
      inv('r', 'magic-item', 'ring-of-protection', { equipped: true, attuned: true }),
      inv('w', 'magic-item', 'weapon-1', { custom: { base: 'rapier' }, name: 'Rapier +1' }),
      inv('x', 'weapon', 'stone-sling-x1'),
    ],
    abilities: [{ ref: 'ability/stoneborn-grit' }],
  });
  const s = E.derive(c, rules);
  eq('CON 14+1+1 (resilient)', s.abilities.con.score, 16);
  check('resilient grants CON save', s.abilities.con.saveProf);
  eq('tough + hp (8+3) + 3×(5+3) + 2×4', s.hpMax, 11 + 24 + 8);
  eq('alert initiative DEX+PB', s.initiative, 4 + 2);
  eq('AC unarmored 10+4 + ring 1 + Stoneborn Grit 1', s.ac.value, 16);
  eq('ring save bonus', s.abilities.wis.save, 1 + 1);
  const rap = s.attacks.find((a) => a.uid === 'w');
  eq('rapier +1', [rap?.name, rap?.bonus, rap?.damage, rap?.ability], ['Rapier +1', 4 + 2 + 1, '1d8+5', 'dex']);
  const sling = s.attacks.find((a) => a.uid === 'x');
  eq('custom ranged weapon uses DEX', [sling?.ability, sling?.range], ['dex', '30/120 ft']);
  check('custom ability resource', res(s, 'ability:stoneborn-grit')?.max === 1);
  check('resilient: no separate ability-increase choice', !s.choices.some((x) => x.key.startsWith('feat:resilient')));
  check('versatile tough feature', s.features.some((f) => f.id === 'tough'));
  const it = E.itemStats(inv('z', 'magic-item', 'armor-2', { custom: { base: 'half-plate-armor' } }), rules);
  eq('itemStats magic armor', [it.armor?.ac.base, it.bonus.ac, it.armor?.category], [15, 2, 'medium']);
  const ds = E.itemStats(inv('y', 'magic-item', 'dwarven-plate'), rules);
  eq('dwarven plate base + bonus', [ds.armor?.ac.base, ds.bonus.ac], [18, 2]);
}
{
  // Legacy subclass: sub-3 features granted at level 3; draconic resilience
  const tw = E.derive(char({ classes: [{ id: 'cleric', level: 3, subclass: 'twilight-domain' }] }), rules);
  check('legacy twilight level-1 features at cleric 3', tw.features.some((f) => f.subclassId === 'twilight-domain' && f.classLevel === 3), tw.features.filter((f) => f.subclassId).map((f) => `${f.id}@${f.classLevel}`));
  check('twilight martial/heavy via known grants', tw.proficiencies.armor.includes('heavy') && tw.proficiencies.weapons.includes('martial'));
  const dr = E.derive(char({ baseAbilities: { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 16 }, classes: [{ id: 'sorcerer', level: 4, subclass: 'draconic-sorcery', hp: [6, 4, 4, 4] }] }), rules);
  eq('draconic resilience hp (8+3×6+4)', dr.hpMax, 8 + 18 + 4);
  eq('draconic AC 10+2+3', dr.ac.value, 15);
  const bard = E.derive(char({ baseAbilities: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 16 }, classes: [{ id: 'bard', level: 5 }] }), rules);
  eq('jack of all trades half prof', [bard.skills.athletics.half, bard.skills.athletics.bonus], [true, -1 + 1]);
  eq('bardic inspiration uses & recharge at 5', [res(bard, 'bardic-inspiration')?.max, res(bard, 'bardic-inspiration')?.recharge], [3, 'short']);
}

// ------------------------------------------------------------------------------------------------
section('Proficiency overrides & sources');
{
  const pi = E.derive(fighter, rules).proficiencyInfo;
  eq('athletics source = background', pi.skills.athletics.sources.map((x) => x.label), ['Background: Soldier']);
  eq('perception source = class skill pick', pi.skills.perception.sources.map((x) => x.label), ['Class: Fighter']);
  eq('STR save source = first class', pi.saves.str.sources.map((x) => x.label), ['Class: Fighter']);
  eq('rules states', [pi.skills.athletics.rules, pi.skills.stealth.rules, pi.saves.str.rules, pi.saves.dex.rules, pi.skills.athletics.override], ['proficient', 'none', true, false, null]);
  const ov = { ...fighter, overrides: { ...fighter.overrides, proficiency: { skills: { athletics: 'none', perception: 'expertise', stealth: 'proficient' }, saves: { str: false, dex: true } } } };
  const s = E.derive(ov, rules);
  eq('override removes a background skill', [s.skills.athletics.prof, s.skills.athletics.bonus], [false, 4]);
  eq('override grants expertise (+ passive)', [s.skills.perception.expertise, s.skills.perception.bonus, s.passive.perception], [true, 1 + 6, 17]);
  eq('override adds a skill', [s.skills.stealth.prof, s.skills.stealth.bonus], [true, 4]);
  eq('override removes the class save / adds another', [s.abilities.str.saveProf, s.abilities.str.save, s.abilities.dex.saveProf, s.abilities.dex.save], [false, 4, true, 4]);
  check('proficiency lists follow overrides', !s.proficiencies.skills.includes('athletics') && s.proficiencies.saves.includes('dex') && !s.proficiencies.saves.includes('str'));
  eq('info: state / rules / override', [s.proficiencyInfo.skills.athletics.state, s.proficiencyInfo.skills.athletics.rules, s.proficiencyInfo.skills.athletics.override], ['none', 'proficient', 'none']);
  eq('info: save override', [s.proficiencyInfo.saves.str.state, s.proficiencyInfo.saves.str.rules, s.proficiencyInfo.saves.str.override], [false, true, false]);
  check('expertise choice options drop an un-proficient skill', !E.derive({ ...ov, classes: [{ id: 'rogue', level: 1 }], skills: ['acrobatics', 'perception', 'deception', 'insight'] }, rules).choices.find((c) => c.key === 'rogue-expertise@rogue:1')?.options.some((o) => o.id === 'athletics'));
  const exs = E.derive({ ...fighter, extraProficiencies: { ...fighter.extraProficiencies, skills: ['history'], expertise: ['athletics'], saves: ['wis'] } }, rules);
  eq('extraProficiencies still work', [exs.skills.history.prof, exs.skills.athletics.expertise, exs.abilities.wis.saveProf], [true, true, true]);
  check('extra listed as its own source', exs.proficiencyInfo.skills.history.sources.some((x) => x.extra && x.label === 'Added in Edit all') && exs.proficiencyInfo.saves.wis.sources.some((x) => x.extra));
  eq('extra: rules none, base proficient', [exs.proficiencyInfo.skills.history.rules, exs.proficiencyInfo.skills.history.base, exs.proficiencyInfo.skills.athletics.base], ['none', 'proficient', 'expertise']);
  const both = E.derive({ ...fighter, extraProficiencies: { ...fighter.extraProficiencies, skills: ['history'] }, overrides: { ...fighter.overrides, proficiency: { skills: { history: 'none' }, saves: {} } } }, rules);
  eq('override beats extraProficiencies', both.skills.history.prof, false);
  const rg = E.derive(char({ classes: [{ id: 'rogue', level: 1 }], skills: ['acrobatics', 'perception', 'deception', 'insight'], choices: { 'rogue-expertise@rogue:1': ['stealth', 'perception'] } }), rules);
  check('expertise source label from the class feature', rg.proficiencyInfo.skills.perception.sources.some((x) => x.level === 'expertise' && /^Rogue 1: /.test(x.label)), rg.proficiencyInfo.skills.perception.sources);
  const res = E.derive(char({ species: { id: 'human' }, classes: [{ id: 'rogue', level: 4 }], choices: { 'rogue-ability-score-improvement@rogue:4': { feat: 'resilient', asi: { con: 1 } } } }), rules);
  eq('Resilient save source', res.proficiencyInfo.saves.con.sources.map((x) => x.label), ['Feat: Resilient']);
}

// ------------------------------------------------------------------------------------------------
section('Debuffs: exhaustion, conditions, penalties (sheet.adjust)');
{
  const ls = (s) => s.attacks.find((a) => a.weaponId === 'longsword');
  eq('no debuffs -> empty adjust', E.derive({ ...fighter, inventory: fighter.inventory.slice(1) }, rules).adjust, {});
  eq('chain mail: only the Stealth note', Object.keys(E.derive(fighter, rules).adjust), ['skill:stealth']);
  const ex2 = E.derive({ ...fighter, exhaustion: 2 }, rules);
  eq('exhaustion 2: save/skill/check/initiative/attack −4', [ex2.abilities.str.save, ex2.skills.athletics.bonus, ex2.abilities.str.check, ex2.initiative, ls(ex2).bonus], [3, 3, 0, -3, 3]);
  eq('exhaustion 2: speed −10; AC, damage unchanged', [ex2.speed.walk, ex2.ac.value, ls(ex2).damage], [20, 19, '1d8+4']);
  eq('exhaustion 2: passive scores count it', ex2.passive.perception, 10);
  eq('adjust entry shape', ex2.adjust['skill:athletics'], { label: 'Athletics', format: 'mod', base: 7, value: 3, reasons: [{ label: 'Exhaustion 2', amount: -4 }] });
  eq('adjust speed', [ex2.adjust.speed.base, ex2.adjust.speed.value, ex2.adjust.speed.reasons[0].amount], [30, 20, -10]);
  check('AC is not a D20 Test', !ex2.adjust.ac && !ex2.adjust['damage:c']);
  const wz = E.derive(char({ baseAbilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 }, classes: [{ id: 'wizard', level: 5 }], exhaustion: 1 }), rules);
  const wsc = wz.spellcasting[0];
  eq('exhaustion: spell attack −2, save DC unchanged', [wsc.attack, wsc.dc, wz.adjust['spellAttack:wizard']?.base, !!wz.adjust['spellDc:wizard']], [4, 14, 6, false]);
  const drow = E.derive(char({ species: { id: 'elf', subspecies: 'elven-lineage-drow' }, classes: [{ id: 'rogue', level: 5 }], exhaustion: 1 }), rules);
  check('exhaustion: innate spell attack key', drow.adjust['spellAttack:innate:species']?.value === drow.innate[0].attack && drow.adjust['spellAttack:innate:species'].base === drow.innate[0].attack + 2);

  const po = E.derive({ ...fighter, conditions: ['poisoned'] }, rules);
  eq('poisoned: rolls unchanged, passives −5', [po.skills.athletics.bonus, ls(po).bonus, po.passive.perception, po.passive.insight], [7, 7, 9, 6]);
  const pa = po.adjust['attack:c'];
  check('poisoned: attack note only', pa && pa.base === pa.value && pa.reasons.some((r) => r.label === 'Poisoned' && /Disadvantage on attack rolls/.test(r.note)), pa);
  check('poisoned: checks noted (skills, abilities, initiative)', /Disadvantage on ability checks/.test(po.adjust['skill:history']?.reasons[0]?.note) && !!po.adjust['ability:wis'] && !!po.adjust.initiative);
  eq('poisoned: passive reason', po.adjust['passive:insight']?.reasons, [{ label: 'Poisoned', amount: -5, note: 'Disadvantage on checks: −5 to passive scores' }]);
  check('poisoned: saves untouched', !po.adjust['save:str']);

  const gr = E.derive({ ...fighter, conditions: ['grappled'] }, rules);
  eq('grappled: speed 0', gr.speed.walk, 0);
  eq('grappled: speed reason', gr.adjust.speed.reasons, [{ label: 'Grappled', amount: -30, note: "Speed 0 (can't increase)" }]);
  check('grappled: attack note', gr.adjust['attack:c']?.reasons.some((r) => /other than the grappler/.test(r.note)));
  const g2 = E.derive({ ...fighter, conditions: ['grappled', 'poisoned'], exhaustion: 2 }, rules);
  eq('exhaustion + grappled speed reasons sum', [g2.adjust.speed.base, g2.adjust.speed.value, g2.adjust.speed.reasons.map((r) => r.amount)], [30, 0, [-10, -20]]);

  const pz = E.derive({ ...fighter, conditions: ['paralyzed'] }, rules);
  check('paralyzed: auto-fail STR & DEX saves', /Automatically fails Strength/.test(pz.adjust['save:str']?.reasons[0]?.note) && /Automatically fails Dexterity/.test(pz.adjust['save:dex']?.reasons[0]?.note) && !pz.adjust['save:con']);
  check('paralyzed implies Incapacitated (initiative)', pz.adjust.initiative?.reasons.some((r) => r.label === 'Incapacitated (from Paralyzed)'), pz.adjust.initiative);
  eq('paralyzed: speed 0', pz.speed.walk, 0);
  const rs = E.derive({ ...fighter, conditions: ['restrained'] }, rules);
  check('restrained: Disadvantage on DEX saves only', /Disadvantage on Dexterity saving throws/.test(rs.adjust['save:dex']?.reasons[0]?.note) && !rs.adjust['save:str'] && rs.speed.walk === 0);
  const un = E.derive({ ...fighter, conditions: ['unconscious'] }, rules);
  check('unconscious implies Prone', un.adjust['attack:c']?.reasons.some((r) => r.label === 'Prone (from Unconscious)'));
  const bl = E.derive({ ...fighter, conditions: ['blinded'] }, rules);
  check('blinded: sight note on Perception', /sight/.test(bl.adjust['skill:perception']?.reasons[0]?.note) && /sight/.test(bl.adjust['passive:perception']?.reasons[0]?.note) && !bl.adjust['skill:athletics']);
  eq('charmed changes no numbers', Object.keys(E.derive({ ...fighter, conditions: ['charmed'] }, rules).adjust), ['skill:stealth']);
  const st = E.derive({ ...fighter, conditions: ['stunned'] }, rules);
  check('stunned: no speed change (2024)', st.speed.walk === 30 && !st.adjust.speed);

  const cursed = { ...fighter, abilities: [{ name: 'Curse of Frailty', modifiers: { abilities: { str: -2 }, ac: -1, skills: { stealth: -2 }, speed: -5 } }] };
  const cu = E.derive(cursed, rules);
  eq('curse: STR 17, AC 18, speed 25, stealth −1', [cu.abilities.str.score, cu.ac.value, cu.speed.walk, cu.skills.stealth.bonus], [17, 18, 25, -1]);
  eq('curse: score reason', cu.adjust['score:str'].reasons, [{ label: 'Curse of Frailty', amount: -2 }]);
  const ath = cu.adjust['skill:athletics'];
  eq('curse: athletics via STR mod', [ath.base, ath.value, ath.reasons[0]], [7, 6, { label: 'Curse of Frailty', amount: -1, note: 'Strength score −2' }]);
  eq('curse: AC reason', cu.adjust.ac.reasons, [{ label: 'Curse of Frailty', amount: -1 }]);
  eq('curse: damage via STR mod', [cu.adjust['damage:c']?.base, cu.adjust['damage:c']?.value], ['1d8+4', '1d8+3']);
  check('curse: stealth reasons (modifier + armor note)', cu.adjust['skill:stealth'].reasons.some((r) => r.amount === -2) && cu.adjust['skill:stealth'].reasons.some((r) => /Stealth/.test(r.note || '')));

  const bag = E.derive({ ...fighter, inventory: [...fighter.inventory, inv('k', 'magic-item', 'bag-of-holding', { name: 'Cursed Bag', custom: { modifiers: { attack: -1, initiative: -2 } } })] }, rules);
  eq('cursed item: attack −1, initiative −2', [ls(bag).bonus, bag.initiative, bag.adjust['attack:c'].reasons, bag.adjust.initiative.reasons], [6, -1, [{ label: 'Cursed Bag', amount: -1 }], [{ label: 'Cursed Bag', amount: -2 }]]);
  const rusty = E.derive({ ...fighter, inventory: [fighter.inventory[0], inv('r', 'weapon', 'longsword', { name: 'Rusty Longsword', custom: { attackBonus: -1, damageBonus: -1 } })] }, rules);
  const rl = rusty.attacks.find((a) => a.uid === 'r');
  eq('negative weapon bonus', [rl.bonus, rl.damage, rusty.adjust['attack:r'].reasons, rusty.adjust['damage:r'].base], [6, '1d8+3', [{ label: 'Rusty Longsword', amount: -1 }], '1d8+4']);

  const weak = E.derive({ ...fighter, baseAbilities: { ...fighter.baseAbilities, str: 8 }, choices: { ...fighter.choices, 'fighter-ability-score-improvement@fighter:4': { asi: { dex: 2 } } } }, rules);
  eq('heavy armor below STR: speed reason', [weak.adjust.speed.base, weak.adjust.speed.value, weak.adjust.speed.reasons[0].amount, weak.adjust.speed.reasons[0].label], [30, 20, -10, 'Chain Mail (needs Strength 13)']);
  const wl = E.derive(char({ baseAbilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 }, classes: [{ id: 'wizard', level: 5 }], inventory: [inv('l', 'armor', 'leather-armor')] }), rules);
  check('armor without training: STR/DEX notes', /Disadvantage on Strength and Dexterity/.test(wl.adjust['save:dex']?.reasons[0]?.note) && !!wl.adjust['skill:stealth'] && !wl.adjust['save:int']);
  check('armor without training: no spellcasting note', /Can't cast spells/.test(wl.adjust['spellAttack:wizard']?.reasons[0]?.note) && /Can't cast spells/.test(wl.adjust['spellDc:wizard']?.reasons[0]?.note));

  const ovr = E.derive({ ...fighter, exhaustion: 1, overrides: { ...fighter.overrides, initiative: 5, speed: 40, ac: 12 }, abilities: [{ name: 'Hex', modifiers: { checks: -1, ac: -2 } }] }, rules);
  eq('override + exhaustion: temp penalty applies on top', [ovr.initiative, ovr.speed.walk, ovr.ac.value], [3, 35, 12]);
  eq('override drops the replaced penalty', [ovr.adjust.initiative.reasons, !!ovr.adjust.ac], [[{ label: 'Exhaustion 1', amount: -2 }], false]);
  check('ordinary fields include the debuff', ovr.adjust['skill:athletics'].value === ovr.skills.athletics.bonus && ovr.skills.athletics.bonus === 7 - 2 - 1);
}

// ------------------------------------------------------------------------------------------------
section('Favourites (engine-favs.js)');
{
  const doc = {
    inventory: [inv('w1', 'weapon', 'longsword'), inv('g1', 'gear', 'rope-hempen')],
    abilities: [{ name: 'Grit' }, { ref: 'ability/stoneborn-grit' }, { id: 'luck-x1', name: 'Luck' }, { name: 'Hex' }],
    favorites: { items: ['w1', 'gone', 'w1', 7], skills: ['stealth', 'stealth', ''], features: ['class:fighter-second-wind', 'custom:custom-0', 'custom:stoneborn-grit', 'custom:luck-x1', 'custom:custom-9', 'custom:deleted-y'] },
  };
  const n = E.normalizeFavorites(doc.favorites, doc);
  eq('normalize: deleted items, duplicates and non-strings dropped', n.items, ['w1']);
  eq('normalize: skills unique', n.skills, ['stealth']);
  eq('normalize: class features kept, custom only while the ability exists', n.features, ['class:fighter-second-wind', 'custom:custom-0', 'custom:stoneborn-grit', 'custom:luck-x1']);
  eq('normalize: missing / junk -> empty lists', E.normalizeFavorites(null, {}), { items: [], skills: [], features: [] });
  eq('custom ability ids follow the engine (inline index, ref, explicit id)', E.customAbilityIds(doc.abilities), ['custom-0', 'stoneborn-grit', 'luck-x1', 'custom-3']);

  const c = { inventory: doc.inventory };
  check('toggle on creates the store', E.toggleFavorite(c, 'skills', 'arcana') === true && E.isFavorite(c, 'skills', 'arcana') && E.hasFavorites(c));
  check('toggle again turns it off', E.toggleFavorite(c, 'skills', 'arcana') === false && !E.isFavorite(c, 'skills', 'arcana') && !E.hasFavorites(c));
  E.toggleFavorite(c, 'items', 'g1', true); E.toggleFavorite(c, 'items', 'g1', true);
  eq('explicit on is idempotent', c.favorites.items, ['g1']);
  check('unknown kind / empty key ignored', E.toggleFavorite(c, 'spells', 'x') === false && E.toggleFavorite(c, 'items', '') === false && !('spells' in c.favorites));
  eq('favoritesFirst is stable', E.favoritesFirst(['a', 'b', 'c', 'd'], (x) => x === 'c' || x === 'a'), ['a', 'c', 'b', 'd']);

  // Removing an inline ability: its star goes, later index-named ones shift with their abilities
  const r = { abilities: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { ref: 'ability/stoneborn-grit' }], favorites: { items: [], skills: [], features: ['custom:custom-1', 'custom:custom-2', 'custom:stoneborn-grit', 'class:x'] } };
  E.removeAbilityFavorites(r, 1);
  r.abilities.splice(1, 1);
  eq('remove ability: star dropped, later inline stars shift down', r.favorites.features, ['custom:custom-1', 'custom:stoneborn-grit', 'class:x']);
  check('remove ability: shifted key now names C', E.customAbilityIds(r.abilities)[1] === 'custom-1' && r.abilities[1].name === 'C');

  // Feature keys from a derived sheet are stable across levels (same key at 1 and 5)
  const f1 = E.derive({ ...char(), classes: [{ id: 'fighter', level: 1, hp: [10] }] }, rules);
  const f5 = E.derive({ ...char(), classes: [{ id: 'fighter', level: 5, hp: [10, 6, 6, 6, 6] }] }, rules);
  const sw1 = f1.features.find((f) => /second wind/i.test(f.name));
  const sw5 = f5.features.find((f) => /second wind/i.test(f.name));
  check('feature key: Second Wind same at level 1 and 5', !!sw1 && E.featureFavKey(sw1) === E.featureFavKey(sw5) && E.featureFavKey(sw1).startsWith('class:'), [sw1 && E.featureFavKey(sw1), sw5 && E.featureFavKey(sw5)]);
  const withAb = E.derive({ ...char(), classes: [{ id: 'fighter', level: 1, hp: [10] }], abilities: [{ name: 'Grit', description: 'x' }] }, rules);
  check('feature key: inline custom ability -> custom:custom-0', withAb.features.some((f) => E.featureFavKey(f) === 'custom:custom-0'));
}

// ------------------------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
