// Node test for XP helpers (engine-xp.js), spell numbers / compatibility (engine-spells.js) and levelDownPlan.
// node tools/test_spells.mjs   (no deps; complements tools/test_engine.mjs)
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
  custom: {},
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
const spell = (id) => rules.spellById[id];

// ------------------------------------------------------------------------------------------------
section('XP table & levels');
eq('table from rules.json', E.xpTable(rules).slice(0, 4), [0, 300, 900, 2700]);
eq('table from raw rules.json', E.xpTable(files.rules)[19], 355000);
eq('fallback table', E.xpTable(null)[1], 300);
eq('levelForXp', [0, 299, 300, 899, 900, 354999, 355000, 9e9, -5, 'x'].map((x) => E.levelForXp(x, rules)), [1, 1, 2, 2, 3, 19, 20, 20, 1, 1]);
eq('xpForLevel', [1, 2, 5, 20, 0, 99].map((l) => E.xpForLevel(l, rules)), [0, 300, 6500, 355000, 0, 355000]);
{
  const wiz1 = char({ classes: [{ id: 'wizard', level: 1, hp: [6] }], xp: 450 });
  const st = E.xpStatus(wiz1, rules);
  eq('status level 1 with 450 XP', [st.level, st.xpLevel, st.due, st.floor, st.next, st.toNext, st.pct], [1, 2, 1, 0, 300, 0, 100]);
  const st2 = E.xpStatus({ ...wiz1, classes: [{ id: 'wizard', level: 2, hp: [6, 4] }], xp: 600 }, rules);
  eq('status level 2 with 600 XP', [st2.due, st2.floor, st2.next, st2.toNext, st2.pct], [0, 300, 900, 300, 50]);
  eq('level-0 docs never due', E.xpStatus(char({ xp: 5000 }), rules).due, 0);
  const st20 = E.xpStatus({ ...wiz1, classes: [{ id: 'wizard', level: 20 }], xp: 400000 }, rules);
  eq('level 20 at max', [st20.atMax, st20.next, st20.due, st20.pct], [true, null, 0, 100]);
}
section('XP crossing (auto level-up trigger)');
eq('crossing 300 at level 1', E.xpLevelsCrossed(250, 450, 1, rules), 1);
eq('no new threshold while one is pending', E.xpLevelsCrossed(450, 800, 1, rules), 0);
eq('pending + a new threshold', E.xpLevelsCrossed(450, 950, 1, rules), 1);
eq('several thresholds at once', E.xpLevelsCrossed(0, 7000, 1, rules), 4);
eq('below current level never triggers', E.xpLevelsCrossed(0, 1000, 5, rules), 0);
eq('subtracting never triggers', E.xpLevelsCrossed(1000, 200, 1, rules), 0);
eq('level 0 never triggers', E.xpLevelsCrossed(0, 1000, 0, rules), 0);
eq('level 20 never triggers', E.xpLevelsCrossed(300000, 400000, 20, rules), 0);
section('addXp / setXp / log');
{
  const c0 = char({ xp: 100 });
  const c1 = E.addXp(c0, 450, { note: 'Goblin ambush', at: '2026-10-21T10:00:00.000Z' });
  eq('add', c1.xp, 550);
  eq('log entry', c1.xpLog, [{ at: '2026-10-21T10:00:00.000Z', delta: 450, total: 550, note: 'Goblin ambush' }]);
  check('addXp does not mutate', c0.xp === 100 && !c0.xpLog);
  const c2 = E.addXp(c1, -1000);
  eq('subtract clamps at 0', [c2.xp, c2.xpLog[1].delta], [0, -550]);
  const c3 = E.setXp(c2, 2700.4, { note: 'Fix' });
  eq('set exact', [c3.xp, c3.xpLog[2].set, c3.xpLog[2].delta], [2700, true, 2700]);
  eq('set to same value adds no log', E.setXp(c3, 2700).xpLog.length, 3);
  let c = char();
  for (let i = 0; i < 40; i++) c = E.addXp(c, 10);
  eq('log is capped', [c.xpLog.length, c.xp, c.xpLog[c.xpLog.length - 1].total], [E.XP_TABLE.length && 30, 400, 400]);
}
section('XP after manual level changes');
eq('milestone up raises XP to the minimum', E.xpAfterLevelChange(100, 3, 'up', rules), { xp: 900, changed: true, reason: 'raised to the level 3 minimum' });
eq('milestone up keeps higher XP', E.xpAfterLevelChange(1200, 3, 'up', rules).changed, false);
eq('down resets XP that still qualifies', E.xpAfterLevelChange(1000, 2, 'down', rules), { xp: 300, changed: true, reason: 'reset to the level 2 minimum' });
eq('down keeps XP below the old threshold', E.xpAfterLevelChange(500, 2, 'down', rules).changed, false);

// ------------------------------------------------------------------------------------------------
section('levelOrder & lastLeveledClass');
{
  const f1 = char({ baseAbilities: { str: 15, dex: 13, con: 14, int: 13, wis: 10, cha: 8 }, classes: [{ id: 'fighter', level: 1, hp: [10] }] });
  eq('no history -> last class', E.lastLeveledClass(f1), 'fighter');
  eq('level 0 -> null', E.lastLeveledClass(char()), null);
  const mc = E.applyLevelUp(f1, rules, 'wizard', {});
  const mc2 = E.applyLevelUp(mc, rules, 'fighter', {});
  eq('levelOrder appended', mc2.levelOrder, ['wizard', 'fighter']);
  eq('latest class from history', E.lastLeveledClass(mc2), 'fighter');
  const down = E.levelDown(mc2, rules, 'fighter');
  eq('levelDown pops the class from levelOrder', [down.levelOrder, E.lastLeveledClass(down)], [['wizard'], 'wizard']);
}

section('levelDownPlan');
{
  const wiz5 = char({
    baseAbilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    classes: [{ id: 'wizard', level: 5, subclass: 'evoker', hp: [6, 4, 4, 4, 4] }],
    spells: [{ id: 'fire-bolt', class: 'wizard', prepared: true }, { id: 'magic-missile', class: 'wizard', prepared: true }, { id: 'fireball', class: 'wizard', prepared: true }],
    choices: { 'wizard-subclass@wizard:3': 'evoker', 'wizard-ability-score-improvement@wizard:4': { asi: { int: 2 } } },
  });
  const p = E.levelDownPlan(wiz5, rules, 'wizard');
  eq('levels', [p.fromLevel, p.toLevel, p.totalBefore, p.totalAfter, p.removesClass], [5, 4, 5, 4, false]);
  eq('slots lose level 3', [p.slotsBefore[2], p.slotsAfter[2], p.maxSpellLevelBefore, p.maxSpellLevelAfter], [2, 0, 3, 2]);
  eq('fireball at risk', p.spellsAtRisk.map((s) => s.id), ['fireball']);
  check('hp lost', p.hpLost === 6, p.hpLost);
  check('prof bonus drops', p.profBonusBefore === 3 && p.profBonusAfter === 2, [p.profBonusBefore, p.profBonusAfter]);
  check('a level-5 feature is lost', p.features.length >= 1 && p.features.every((f) => f.level === 5 || f.level == null), p.features);
  eq('next doc matches levelDown', p.next.classes[0].level, 4);
  const p4 = E.levelDownPlan(p.next, rules, 'wizard');
  eq('ASI choice listed as lost at 4 -> 3', p4.choices.map((x) => x.key), ['wizard-ability-score-improvement@wizard:4']);
  const p3 = E.levelDownPlan(E.levelDown(p.next, rules, 'wizard'), rules, 'wizard');
  eq('subclass lost at 3 -> 2', p3.subclass, 'evoker');
  const fw = char({
    baseAbilities: { str: 15, dex: 13, con: 14, int: 13, wis: 10, cha: 8 },
    classes: [{ id: 'fighter', level: 2, hp: [10, 6] }, { id: 'wizard', level: 1, hp: [4] }],
    spells: [{ id: 'fire-bolt', class: 'wizard', prepared: true }, { id: 'shield', class: 'wizard', prepared: true }],
  });
  const pw = E.levelDownPlan(fw, rules, 'wizard');
  eq('removing the multiclass', [pw.removesClass, pw.totalAfter, pw.spellsAtRisk.length, pw.next.classes.map((x) => x.id)], [true, 2, 2, ['fighter']]);
  eq('unknown class -> not allowed', E.levelDownPlan(fw, rules, 'bard').allowed, false);
  const wl5 = char({
    baseAbilities: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    classes: [{ id: 'warlock', level: 5, subclass: 'fiend-patron', hp: [8, 5, 5, 5, 5] }],
    choices: { 'warlock-subclass@warlock:3': 'fiend-patron', 'warlock-eldritch-invocations@warlock:1': ['agonizing-blast', 'armor-of-shadows', 'devils-sight', 'eldritch-mind', 'eldritch-spear'] },
  });
  const pl = E.levelDownPlan(wl5, rules, 'warlock');
  eq('invocations trimmed to the new total (newest go)', [pl.trimmed.map((x) => [x.before, x.after, x.removed]), pl.next.choices['warlock-eldritch-invocations@warlock:1']],
    [[[5, 3, ['eldritch-mind', 'eldritch-spear']]], ['agonizing-blast', 'armor-of-shadows', 'devils-sight']]);
  eq('patron spells of level 5 lost', pl.alwaysLost.map((x) => x.id), ['fireball', 'stinking-cloud']);
  eq('pact magic 3 -> 2', [pl.pactBefore?.level, pl.pactAfter?.level], [3, 2]);
  const fresh = E.levelDownPlan({ ...wl5, choices: { ...wl5.choices, 'warlock-eldritch-invocations@warlock:1': ['agonizing-blast'] } }, rules, 'warlock');
  eq('picks already under the new total are left alone', fresh.trimmed, []);
}

// ------------------------------------------------------------------------------------------------
section('spellStats');
{
  const wiz = { attack: 5, dc: 13, mod: 3 };
  const fb5 = E.spellStats(spell('fire-bolt'), { charLevel: 5, caster: wiz });
  eq('Fire Bolt at level 5', [fb5.attack, fb5.toHit, fb5.damageText, fb5.scaling.current, fb5.scaling.next?.level], ['ranged', 5, '2d10 Fire', '2d10', 11]);
  eq('Fire Bolt at level 4 / 11 / 17', [4, 11, 17].map((l) => E.spellStats(spell('fire-bolt'), { charLevel: l }).damage[0].dice), ['1d10', '3d10', '4d10']);
  const fireball = E.spellStats(spell('fireball'), { charLevel: 5, caster: wiz });
  eq('Fireball', [fireball.save, fireball.dc, fireball.toHit, fireball.damageText, fireball.upcast?.text], ['dex', 13, null, '8d6 Fire', '+1d6 per slot level above 3']);
  const sf = E.spellStats(spell('sacred-flame'), { charLevel: 1, caster: { attack: 5, dc: 13, mod: 3 } });
  eq('Sacred Flame', [sf.save, sf.dc, sf.damageText], ['dex', 13, '1d8 Radiant']);
  const cw = E.spellStats(spell('cure-wounds'), { charLevel: 3, caster: { attack: 5, dc: 13, mod: 3 } });
  eq('Cure Wounds heals 2d8 + mod', [cw.heal?.text, cw.damage.length, cw.upcast?.what], ['2d8 + 3', 0, 'healing']);
  eq('Cure Wounds without a caster', E.spellStats(spell('cure-wounds')).heal.text, '2d8 + mod');
  eq('Healing Word', E.spellStats(spell('healing-word'), { caster: { mod: 4 } }).heal.text, '2d4 + 4');
  eq('Heal (fixed)', E.spellStats(spell('heal')).heal.text, '70');
  const mm = E.spellStats(spell('magic-missile'), { caster: wiz });
  eq('Magic Missile parsed', [mm.parsed, mm.damageText, mm.count, mm.upcast?.text], [true, '1d4 + 1 Force', { count: 3, unit: 'dart' }, '+1 dart per slot level above 1']);
  const eb = E.spellStats(spell('eldritch-blast'), { charLevel: 11, caster: wiz });
  eq('Eldritch Blast beams', [eb.damageText, eb.count], ['1d10 Force', { count: 3, unit: 'beam' }]);
  eq('Flame Strike two types', E.spellStats(spell('flame-strike')).damageText, '5d6 Fire + 5d6 Radiant');
  eq('Spirit Guardians alternatives', E.spellStats(spell('spirit-guardians')).damageText, '3d8 Radiant or Necrotic');
  eq('Fire Shield alternatives', E.spellStats(spell('fire-shield')).damageText, '2d8 Fire or Cold');
  eq('Prismatic Spray lists the ray types', E.spellStats(spell('prismatic-spray')).damageText, '12d6 Fire/Acid/Lightning/Poison/Cold');
  eq('Spiritual Weapon + mod', E.spellStats(spell('spiritual-weapon'), { caster: wiz }).damageText, '1d8 + 3 Force');
  eq('Chromatic Orb lists the choices', E.spellStats(spell('chromatic-orb')).damageText, '3d8 Acid/Cold/Fire/Lightning/Poison/Thunder');
  eq('Sorcerous Burst choices + cantrip scaling', E.spellStats(spell('sorcerous-burst'), { charLevel: 11 }).damageText, '3d8 Acid/Cold/Fire/Lightning/Poison/Psychic/Thunder');
  eq('Dragon\'s Breath choices', E.spellStats(spell('dragons-breath')).damageText, '3d6 Acid/Cold/Fire/Lightning/Poison');
  eq('Conjure Elemental: element types, then the restrained damage', E.spellStats(spell('conjure-elemental')).damageGroups.map((g) => g.text), ['8d8 Lightning/Thunder/Fire/Cold', '4d8 Lightning/Thunder/Fire/Cold']);
  eq('Conjure Minor Elementals extra damage', E.spellStats(spell('conjure-minor-elementals')).damageText, '2d8 Acid/Cold/Fire/Lightning');
  const ik = E.spellStats(spell('ice-knife'), { caster: wiz });
  eq('Ice Knife: hit + burst', [ik.toHit, ik.dc, ik.damageGroups.map((g) => g.text)], [5, 13, ['1d10 Piercing', '2d6 Cold']]);
  eq('Ice Storm adds both', E.spellStats(spell('ice-storm')).damageText, '2d10 Bludgeoning + 4d6 Cold');
  eq('Acid Arrow later damage', E.spellStats(spell('acid-arrow')).damageText, '4d4 Acid, then 2d4 Acid');
  eq('Arcane Hand: fist + crush with mod', E.spellStats(spell('arcane-hand'), { caster: wiz }).damageGroups.map((g) => g.text), ['5d8 Force', '4d6 + 3 Bludgeoning']);
  eq('Storm of Vengeance rounds', E.spellStats(spell('storm-of-vengeance')).damageGroups.map((g) => g.text), ['2d6 Thunder', '4d6 Acid', '10d6 Lightning', '2d6 Bludgeoning', '1d6 Cold']);
  eq('Wall of Thorns piercing / slashing', E.spellStats(spell('wall-of-thorns')).damageGroups.map((g) => g.text), ['7d8 Piercing', '7d8 Slashing']);
  eq('Searing Smite repeated damage listed once', E.spellStats(spell('searing-smite')).damageText, '1d6 Fire');
  eq('Vampiric Touch heals half', E.spellStats(spell('vampiric-touch')).heal.text, 'half the damage dealt');
  eq('Regenerate heals dice + 15', E.spellStats(spell('regenerate')).heal.text, '4d8 + 15');
  eq('Dimension Door mishap is not damage', E.spellStats(spell('dimension-door')).damage, []);
  eq('Enlarge/Reduce weapon die is not spell damage', E.spellStats(spell('enlarge-reduce')).damage, []);
  eq('Aura of Life: the 1 HP it gives', E.spellStats(spell('aura-of-life')).heal.text, '1');
  eq('Chill Touch blocks healing (no heal)', E.spellStats(spell('chill-touch')).heal, null);
  eq('Glyph of Warding type list', E.spellStats(spell('glyph-of-warding')).damageText, '5d8 Acid/Cold/Fire/Lightning/Thunder');
  eq('Forbiddance radiant or necrotic', E.spellStats(spell('forbiddance')).damageText, '5d10 Radiant/Necrotic');
  eq('Delayed Blast Fireball base damage', E.spellStats(spell('delayed-blast-fireball')).damageText, '12d6 Fire');
  const ts = (l) => E.spellStats(spell('true-strike'), { charLevel: l, caster: wiz });
  eq('True Strike: weapon attack with the spell ability, Radiant dice from level 5', [ts(1).attack, ts(1).toHit, ts(1).damageText, ts(5).damageText, ts(17).damageText],
    ['weapon', 5, 'weapon + 3', 'weapon + 3 + 1d6 Radiant', 'weapon + 3 + 3d6 Radiant']);
  eq('Shillelagh text', E.spellStats(spell('shillelagh'), { charLevel: 5, caster: wiz }).damageText, '1d10 + 3 Force or weapon type');
  eq('Shillelagh die by level', [1, 5, 11, 17].map((l) => E.spellStats(spell('shillelagh'), { charLevel: l, caster: wiz }).damage[0].dice), ['1d8', '1d10', '1d12', '2d6']);
  const as = E.spellStats(spell('alter-self'), { caster: wiz });
  eq('Alter Self natural weapons', [as.attack, as.damageText], ['melee', '1d6 + 3 Slashing/Piercing/Bludgeoning']);
  eq('Shield: no numbers', [E.spellStats(spell('shield')).damage.length, E.spellStats(spell('shield')).heal], [0, null]);
  let ok = true;
  try { E.spellStats(null); E.spellStats({}); E.spellStats({ level: 0, damage: { dice: 'x' } }, { charLevel: 'a' }); } catch { ok = false; }
  check('spellStats tolerates junk', ok);
  for (const s of rules.spells) { try { E.spellStats(s, { charLevel: 9, caster: wiz }); } catch (e) { ok = false; failures.push(`spellStats(${s.id}) threw ${e.message}`); } }
  check('spellStats on every SRD spell', ok);
}
section('dice');
eq('parseDice', [E.parseDice('2d10 + 3'), E.parseDice('d8'), E.parseDice('1d4-1'), E.parseDice('nope')], [{ count: 2, sides: 10, bonus: 3 }, { count: 1, sides: 8, bonus: 0 }, { count: 1, sides: 4, bonus: -1 }, null]);
{
  const r = E.rollDice('2d6 + 1', () => 0.99);
  eq('rollDice max', [r.total, r.rolls], [13, [6, 6]]);
  eq('rollDice object', E.rollDice({ dice: '1d8', bonus: 2 }, () => 0).total, 3);
  eq('diceText', [E.diceText({ dice: '2d8', bonus: 3 }), E.diceText({ dice: '1d4', bonus: -1 }), E.diceText({ dice: '1d6' })], ['2d8 + 3', '1d4 − 1', '1d6']);
}

section('spell compatibility');
{
  const wiz1 = char({
    baseAbilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    classes: [{ id: 'wizard', level: 1, hp: [6] }],
    spells: [{ id: 'fire-bolt', class: 'wizard' }, { id: 'light', class: 'wizard' }, { id: 'magic-missile', class: 'wizard', prepared: true }],
  });
  const s = E.derive(wiz1, rules);
  const sc = s.spellcasting.find((x) => x.class === 'wizard');
  eq('fits', E.spellIssues(spell('shield'), sc), []);
  eq('not on list', E.spellIssues(spell('cure-wounds'), sc).map((x) => x.code), ['not-on-list']);
  eq('too high', E.spellIssues(spell('fireball'), sc).map((x) => x.code), ['too-high']);
  eq('both', E.spellIssues(spell('mass-cure-wounds'), sc).map((x) => x.code), ['not-on-list', 'too-high']);
  eq('no caster', E.spellIssues(spell('shield'), null, { className: 'Fighter' })[0], { code: 'no-caster', text: 'Fighter has no spellcasting.' });
  const add = E.addSpellIssues([spell('ray-of-frost'), spell('shocking-grasp'), spell('shield'), spell('sleep'), spell('burning-hands'), spell('detect-magic')], sc);
  eq('cantrip limit after the 3 allowed (2 known)', add.map((x) => x.issues.map((i) => i.code)), [[], ['cantrip-limit'], [], [], [], []]);
  eq('spellbook: prepared only while there is room', add.map((x) => x.prepared), [true, true, true, true, true, false]);
  const cleric = char({ baseAbilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 }, classes: [{ id: 'cleric', level: 1, hp: [8] }] });
  const csc = E.derive(cleric, rules).spellcasting.find((x) => x.class === 'cleric');
  const cadd = E.addSpellIssues([spell('bless'), spell('cure-wounds'), spell('guiding-bolt'), spell('healing-word'), spell('shield-of-faith')], csc);
  eq('cleric prepared limit', cadd.map((x) => x.issues.map((i) => i.code).join()), ['', '', '', '', 'prepared-limit']);
  check('always-prepared subclass spells are on the list', E.onCasterList({ id: 'x', classes: [] }, { lists: ['cleric'], alwaysPrepared: ['x'] }));
}

// ------------------------------------------------------------------------------------------------
section('bonus actions');
{
  const feat = (id) => rules.featureById[id];
  eq('Cunning Action', E.bonusActionOptions(feat('rogue-cunning-action').description).map((o) => o.text), ['On your turn, you can take one of the following actions as a Bonus Action: Dash, Disengage, or Hide.']);
  eq('Monk\'s Focus options labelled', E.bonusActionOptions(feat('monk-monks-focus').description).map((o) => o.label), ['Flurry of Blows', 'Patient Defense', 'Patient Defense', 'Step of the Wind', 'Step of the Wind']);
  eq('Rage: enter + extend', E.bonusActionOptions(feat('barbarian-rage').description).length, 2);
  eq('Fast Hands lists its choices', E.bonusActionOptions(feat('thief-fast-hands').description)[0].more, ['Sleight of Hand', 'Use an Object']);
  const inn = E.bonusActionOptions(feat('sorcerer-innate-sorcery').description)[0];
  eq('Innate Sorcery inline list', [inn.text.endsWith('following benefits:'), inn.more.length], [true, 2]);
  eq('riders and restrictions are not grants', ['fighter-tactical-shift', 'barbarian-instinctive-pounce', 'paladin-abjure-foes', 'rogue-devious-strikes', 'open-hand-fleet-step', 'sorcerer-sorcery-incarnate'].map((id) => E.bonusActionOptions(feat(id).description).length), [0, 0, 0, 0, 0, 0]);
  check('species trait: Orc Adrenaline Rush', E.bonusActionOptions(rules.speciesById.orc.traits.find((t) => t.id === 'adrenaline-rush').description).length >= 1);
  eq('Bonus Action spells', ['healing-word', 'misty-step', 'spiritual-weapon', 'fireball', 'shield'].map((id) => E.isBonusActionSpell(spell(id))), [true, true, true, false, false]);
  eq('Second Wind healing', E.featureHealing(feat('fighter-second-wind').description, [{ id: 'fighter', name: 'Fighter', level: 3 }]), { dice: '1d10', bonus: 3, text: '1d10 + 3' });
  const custom = E.bonusActionFeatures([{ id: 'x', name: 'Stone Step', description: 'You can step through stone.', activation: 'bonus' }, { id: 'y', name: 'Plain', description: 'Nothing.' }]);
  eq('custom ability flagged as a Bonus Action', custom.map((x) => x.feature.id), ['x']);
  const rogue = char({
    baseAbilities: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
    classes: [{ id: 'rogue', level: 3, subclass: 'thief', hp: [8, 5, 5] }],
    inventory: [{ uid: 'a', kind: 'weapon', ref: 'shortsword', name: 'Shortsword', qty: 1, equipped: true }, { uid: 'b', kind: 'weapon', ref: 'dagger', name: 'Dagger', qty: 1, equipped: true }],
    choices: { 'rogue-weapon-mastery@rogue:1': ['dagger', 'shortsword'] },
  });
  const rs = E.derive(rogue, rules);
  const off = E.offhandAttacks(rs);
  eq('off-hand: two Light weapons, no DEX on damage, Nick noted', [off.eligible, off.options.map((o) => [o.name, o.damage]), off.nick], [true, [['Shortsword', '1d6'], ['Dagger', '1d4']], true]);
  const names = E.bonusActionFeatures(rs.features).map((x) => x.feature.id);
  check('rogue/thief features: Cunning Action, Fast Hands', names.includes('rogue-cunning-action') && names.includes('thief-fast-hands'), names);
  const one = E.offhandAttacks(E.derive({ ...rogue, inventory: [rogue.inventory[0]] }, rules));
  eq('one Light weapon: not eligible', [one.eligible, one.options.length], [false, 0]);
  const pair = E.offhandAttacks(E.derive({ ...rogue, inventory: [{ ...rogue.inventory[1], qty: 2 }] }, rules));
  eq('two daggers in one stack count', pair.eligible, true);
  const twf = E.offhandAttacks({ ...rs, features: [...rs.features, { id: 'two-weapon-fighting', name: 'Two-Weapon Fighting' }] });
  eq('Two-Weapon Fighting keeps the modifier', twf.options.map((o) => o.damage), ['1d6+3', '1d4+3']);
}

// ------------------------------------------------------------------------------------------------
section('proficiency labels (engine-prof)');
{
  const P = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/characters/engine-prof.js')).href);
  const kind = (k, e) => ({ ...e, kind: k });
  const rogue = char({
    baseAbilities: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
    classes: [{ id: 'rogue', level: 3, subclass: 'thief', hp: [8, 5, 5] }],
    choices: { 'rogue-weapon-mastery@rogue:1': ['dagger', 'shortsword'] },
  });
  const rs = E.derive(rogue, rules);
  const labels = (e, o) => P.entryFit(e, rs, o).badges.map((b) => b.label);
  eq('rogue: shortsword proficient + mastery', labels(kind('weapon', rules.weaponById.shortsword)), ['Proficient', 'Mastery: Vex']);
  eq('rogue: longsword not proficient', labels(kind('weapon', rules.weaponById.longsword)), ['Not proficient']);
  check('not proficient line says no PB', /no Proficiency Bonus/.test(P.entryFit(kind('weapon', rules.weaponById.longsword), rs).lines[0].text));
  eq('rogue: leather trained, plate not', [labels(kind('armor', rules.armorById['leather-armor'])), labels(kind('armor', rules.armorById['plate-armor']))], [['Trained'], ['No training']]);
  const plate = P.entryFit(kind('armor', rules.armorById['plate-armor']), rs).lines.map((l) => l.text).join(' ');
  check('plate: disadvantage + no spells + STR 15 speed + stealth', /Disadvantage on any D20 Test/.test(plate) && /can’t cast spells/.test(plate) && /Strength 15/.test(plate) && /Stealth/.test(plate), plate);
  eq('rogue: thieves\' tools proficient, lute not', [labels(kind('gear', rules.gearById['thieves-tools'])), labels(kind('gear', rules.gearById.lute))], [['Proficient'], ['Not proficient']]);
  eq('plain gear: no labels', labels(kind('gear', rules.gearById.rope || rules.gear.find((g) => g.category === 'adventuring-gear'))), []);
  eq('magic weapon via its base', labels(kind('magic-item', rules.magicItemById['weapon-1']), { base: rules.weaponById.longsword }), ['Not proficient']);
  const cleric = char({ baseAbilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 }, classes: [{ id: 'cleric', level: 5, hp: [8, 5, 5, 5, 5] }], spells: [{ id: 'bless', class: 'cleric', prepared: true }] });
  const cs = E.derive(cleric, rules);
  const mi = (id) => kind('magic-item', rules.magicItems.find((x) => x.attunementNote === id) || {});
  eq('attunement by class', [P.attunementFit(mi('by a Cleric or Paladin'), cs).meets, P.attunementFit(mi('by a Sorcerer, Warlock, or Wizard'), cs).meets, P.attunementFit(mi('by a Spellcaster'), cs).meets, P.attunementFit(mi('by a Spellcaster'), rs).meets], [true, false, true, false]);
  eq('species name inside a class name doesn\'t count (Orc / Sorcerer)', P.attunementFit(mi('by a Druid, Sorcerer, Warlock, or Wizard'), rs, { speciesName: 'Orc' }).meets, false);
  eq('species attunement', [P.attunementFit(mi('by a Dwarf or a Creature Attuned to a Belt of Dwarvenkind'), cs, { speciesName: 'Dwarf' }).meets, P.attunementFit(mi('by a Dwarf or a Creature Attuned to a Belt of Dwarvenkind'), cs).meets], [true, null]);
  const sl = (id) => P.entryFit(kind('spell', spell(id)), cs).badges.map((b) => b.label);
  eq('cleric spells: prepared / castable / too high / off-list', [sl('bless'), sl('cure-wounds'), sl('flame-strike'), sl('fireball')], [['Prepared'], [], ['Too high'], ['Off-list']]);
  eq('no caster', P.entryFit(kind('spell', spell('fire-bolt')), rs).badges.map((b) => b.label), ['No spellcasting']);
  eq('holy symbol is a cleric focus', P.entryFit(kind('gear', rules.gear.find((g) => g.category === 'holy-symbols')), cs).badges.map((b) => b.label), ['Focus']);
  eq('feat prerequisite', P.entryFit(kind('feat', rules.featById.grappler), cs).badges.map((b) => b.label), ['Prerequisite']);
}

section('smart tags (engine-tags)');
{
  const T = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/characters/engine-tags.js')).href);
  const tags = (id) => T.featureTags(rules.featureById[id]);
  check('Spellcasting is magic', tags('wizard-spellcasting').includes('magic'));
  check('Extra Attack is attack', tags('fighter-extra-attack').includes('attack'));
  check('Second Wind: healing + uses', ['healing', 'resources'].every((t) => tags('fighter-second-wind').includes(t)));
  check('Rage is not magic (it forbids spells)', !tags('barbarian-rage').includes('magic') && tags('barbarian-rage').includes('advantages'));
  check('Unarmored Defense is defense', tags('barbarian-unarmored-defense').includes('defense'));
  check('Aura of Protection is defense', tags('paladin-aura-of-protection').includes('defense'));
  check('Cunning Action: movement + exploration', ['movement', 'exploration'].every((t) => tags('rogue-cunning-action').includes(t)));
  check('ASI is leveling', tags('fighter-ability-score-improvement').includes('leveling'));
  check('Bardic Inspiration is interaction', tags('bard-bardic-inspiration').includes('interaction'));
  eq('manual tags (labels or ids) + modifiers', T.featureTags({ id: 'x', name: 'Stone Skin', description: 'Your skin hardens.' }, { tags: ['Magic', 'exploration', 'nope'], modifiers: { ac: 1, speed: 5 } }), ['magic', 'defense', 'movement', 'exploration']);
  eq('normalizeTags', T.normalizeTags('Uses & rests, magic; Defense'), ['magic', 'defense', 'resources']);
  const recs = T.customAbilityRecords({ abilities: [{ name: 'A', tags: ['healing'] }, { ref: 'ability/lib-1' }] }, { 'lib-1': { id: 'lib-1', name: 'Lib', tags: ['senses'] } });
  eq('custom ability records (engine id scheme)', [...recs.keys()], ['custom-0', 'lib-1']);
  const grouped = T.tagFeatures([{ id: 'custom-0', name: 'A', description: '' }, rules.featureById['fighter-second-wind']], { records: recs });
  eq('tagFeatures counts', [grouped.counts.healing, grouped.counts.resources, grouped.byTag.healing.map((x) => x.feature.id)], [2, 1, ['custom-0', 'fighter-second-wind']]);
  eq('attacks per action', [T.attacksPerAction([{ name: 'Extra Attack' }]), T.attacksPerAction([{ name: 'Extra Attack' }, { name: 'Two Extra Attacks' }]), T.attacksPerAction([])], [2, 3, 1]);
  const barb = E.derive(char({ baseAbilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, classes: [{ id: 'barbarian', level: 2, hp: [12, 7] }], exhaustion: 2 }), rules);
  const adv = T.advantageSources(barb, { conditions: [{ id: 'poisoned', name: 'Poisoned', description: 'You have Disadvantage on attack rolls and ability checks.' }] });
  check('advantage sources: features, conditions, exhaustion', adv.some((x) => x.source === 'Rage' && x.kind === 'advantage') && adv.some((x) => x.source === 'Reckless Attack') && adv.some((x) => x.from === 'condition' && x.kind === 'disadvantage') && adv.some((x) => x.from === 'exhaustion'), adv.map((x) => `${x.source}:${x.kind}`));
}

section('spell list columns and filters');
{
  eq('short casting times', ['Action', 'Bonus Action', 'Reaction, which you take when you are hit', '1 minute', '10 minutes', '8 hours', 'Action (Overgrowth) or 8 hours (Enrichment)'].map(E.shortCastingTime),
    ['Action', 'Bonus', 'Reaction', '1 min', '10 min', '8 hr', 'Action']);
  eq('short ranges', ['120 feet', 'Self', 'Touch', 'Self (15-foot cone)', '1 mile'].map(E.shortRange), ['120 ft', 'Self', 'Touch', 'Self (15-ft cone)', '1 mile']);
  eq('Fire Bolt keys', E.spellFxKeys(spell('fire-bolt')), ['damage', 'fire']);
  eq('Cure Wounds keys', E.spellFxKeys(spell('cure-wounds')), ['heal']);
  eq('Healing Word: healing + bonus action', E.spellFxKeys(spell('healing-word')), ['heal', 'bonus']);
  eq('Shield: reaction only', E.spellFxKeys(spell('shield')), ['reaction']);
  eq('Detect Magic: concentration + ritual', E.spellFxKeys(spell('detect-magic')), ['conc', 'ritual']);
  check('Ice Knife: piercing and cold', ['damage', 'piercing', 'cold'].every((k) => E.spellFxKeys(spell('ice-knife')).includes(k)), E.spellFxKeys(spell('ice-knife')));
  check('Wish deals no (incidental) damage', !E.spellFxKeys(spell('wish')).includes('damage'), E.spellFxKeys(spell('wish')));
  const starred = new Set(['fire-bolt', 'shield']);
  const rows = ['fire-bolt', 'light', 'cure-wounds', 'burning-hands', 'shield', 'scorching-ray'].map((id) => ({ level: spell(id).level, keys: E.spellFxKeys(spell(id)), ready: id !== 'shield', fav: starred.has(id), name: spell(id).name }));
  const pass = (f) => rows.filter((r) => E.spellPasses(r, f)).map((r) => r.name);
  eq('no filter keeps all', pass({}).length, 6);
  eq('level 1', pass({ level: 1 }), ['Cure Wounds', 'Burning Hands', 'Shield']);
  eq('cantrips (level 0)', pass({ level: 0 }), ['Fire Bolt', 'Light']);
  eq('fire', pass({ fx: 'fire' }), ['Fire Bolt', 'Burning Hands', 'Scorching Ray']);
  eq('level 1 + fire', pass({ level: 1, fx: 'fire' }), ['Burning Hands']);
  eq('healing', pass({ fx: 'heal' }), ['Cure Wounds']);
  eq('prepared only', pass({ prepared: true }).includes('Shield'), false);
  eq('name search folds case and spaces', pass({ q: '  fire  BOLT ' }), ['Fire Bolt']);
  eq('favorites only', pass({ favorite: true }), ['Fire Bolt', 'Shield']);
  eq('favorites + prepared', pass({ favorite: true, prepared: true }), ['Fire Bolt']);
  eq('favorites + level 1', pass({ favorite: true, level: 1 }), ['Shield']);
  eq('favorites + fire', pass({ favorite: true, fx: 'fire' }), ['Fire Bolt']);
  eq('favorite off keeps unstarred rows', pass({ favorite: false }).length, 6);
  const opts = E.spellFilterOptions(rows);
  eq('level chips', opts.levels, [{ level: 0, n: 2 }, { level: 1, n: 3 }, { level: 2, n: 1 }]);
  eq('effect chips in order, only present ones', opts.effects.map((x) => `${x.key}:${x.n}`), ['damage:3', 'heal:1', 'fire:3', 'reaction:1']);
  eq('favorites count (chip shown when > 0)', [opts.favorites, E.spellFilterOptions(rows.map((r) => ({ ...r, fav: false }))).favorites], [2, 0]);
}

// ------------------------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
