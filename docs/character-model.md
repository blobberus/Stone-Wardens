# Character model & engine contract (2024 rules)

Shared by `assets/js/views/characters/` (UI) and `assets/js/views/characters/engine.js` (pure rules) and
`assets/js/views/compendium/api.js` (pickers/editors). SRD data shapes: `docs/srd-schema.md`.

## Stored document — `content/characters/<id>.json`
Only player decisions are stored; everything derivable is computed by `derive()`.
```jsonc
{
  "id": "thorin-k3x9", "name": "Thorin", "player": "Mira", "portrait": null,   // portrait: content/… path or https URL
  "species": { "id": "dwarf", "subspecies": null, "size": null },
  "background": { "id": "soldier", "abilityBonuses": { "str": 2, "con": 1 } },  // +2/+1 or +1/+1/+1 among the bg's 3 abilities
  "classes": [ { "id": "fighter", "level": 5, "subclass": "champion", "hp": [10, 6, 7, 8, 5] } ], // hp[i] = hit die result at that class level (first = max die)
  "abilityMethod": "standard",           // standard | pointbuy | roll | manual
  "baseAbilities": { "str": 15, "dex": 13, "con": 14, "int": 8, "wis": 12, "cha": 10 },
  "choices": {                            // key scheme: see "Choice keys" below
    "fighter-fighting-style@fighter:1": "defense",                         // feat id
    "fighter-ability-score-improvement@fighter:4": { "asi": { "str": 2 } }, // or { "feat": "great-weapon-master", "asi": {"str":1} }
    "fighter-weapon-mastery@fighter:1": ["longsword", "handaxe", "javelin"], // countKey choices hold the running total
    "rogue-expertise@rogue:1": ["stealth", "perception"],
    "species:elven-lineage/spellcasting-ability": "wis",
    "feat:magic-initiate/1": ["guidance", "sacred-flame"]
  },
  "skills": ["athletics", "intimidation"],    // chosen class skill proficiencies (background/species skills are derived)
  "extraProficiencies": { "skills": [], "expertise": [], "saves": [], "armor": [], "weapons": [], "tools": [], "languages": ["common", "dwarvish"] },
  "feats": [ { "id": "savage-attacker", "from": "background" } ],    // feats not granted by a recorded choice
  "spells": [ { "id": "fire-bolt", "class": "wizard", "prepared": true, "always": false } ],
  "slotsUsed": [0,0,0,0,0,0,0,0,0], "pactUsed": 0,
  "inventory": [ { "uid": "a1b2", "kind": "weapon", "ref": "longsword", "name": "Longsword", "qty": 1,
                   "equipped": true, "attuned": false, "notes": "", "custom": null } ],   // custom = inline overrides of ref stats
  "currency": { "cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0 },
  "hp": { "current": 44, "temp": 0 }, "hitDiceUsed": { "10": 0 }, "deathSaves": { "success": 0, "fail": 0 },
  "resourcesUsed": { "rage": 1 }, "conditions": [], "exhaustion": 0, "heroicInspiration": false, "xp": 0,
  "xpLog": [ { "at": "ISO", "delta": 450, "total": 450, "note": "Goblin ambush" } ],   // optional; see "XP & levels" below
  "levelOrder": ["fighter", "wizard"],                                                // optional; class of each level gained
  "abilities": [ { "ref": "ability/second-wind-plus" }, { "name": "Stoneborn Grit", "description": "…", "uses": 1,
                   "recharge": "long", "modifiers": { "ac": 1 }, "tags": ["defense"] } ],   // advanced: extra/custom abilities;
                                                                       // optional `tags` = smart-tag ids (engine-tags.js TAGS)
  "overrides": { "ac": null, "speed": null, "initiative": null, "hpMax": null, "profBonus": null,
                 "passivePerception": null, "abilities": {}, "saves": {}, "skills": {},   // number = replace; skills/saves values are flat BONUS
                 "proficiency": { "skills": { "athletics": "none", "stealth": "expertise" }, "saves": { "dex": true } } },
                 // ^ Edit all → Proficiencies: final say on skill level ('none'|'proficient'|'expertise') / save proficiency
  "style": { "accent": "#7a1f1f" },                 // sheet highlight colour (#rrggbb; null = default oxblood #7a1f1f)
  "details": { "alignment": "", "pronouns": "", "gender": "", "sexuality": "", "age": "", "height": "", "weight": "",
               "eyes": "", "hair": "", "skin": "", "appearance": "", "personalityTraits": "", "socialTraits": "",
               "mentalTraits": "", "ideals": "", "bonds": "", "flaws": "", "likes": "", "dislikes": "",
               "location": "", "groups": "", "religion": "", "resistances": "", "backstory": "", "notes": "" },
  "createdBy": "Mira", "created": "ISO", "updated": "ISO"
}
```
`modifiers` (on custom abilities, feats or magic items): `{ ac, speed, initiative, hpPerLevel, hpMax, profBonus,
abilities:{str:+2}, saves:{all|str:+1}, skills:{all|stealth:+1}, attack, damage, spellDc, spellAttack,
checks (all ability checks), resistances:[…], senses:"…", abilitySet:{str:19} (score becomes at least n) }` — all
additive except `abilitySet`. Item modifiers apply while the item is equipped (attuned, if it needs attunement).
Negative values are debuffs (curses, cursed items): they are applied and explained in `sheet.adjust` (below).

Skill / save proficiency layers, in order: the rules (first class's saves, class skill picks, background skills,
species traits, feats, class features & choices) → `extraProficiencies.skills/expertise/saves` (older sheets ticked
these on the sheet) → `overrides.proficiency` (wins; can remove a granted proficiency). The sheet only displays
proficiency; Edit all → Proficiencies ticks/unticks every skill and save: it clears the `extraProficiencies` entry for
that id and stores an override only where the result differs from the rules ("Reset" = back to the rules).

Inventory `custom` (inline overrides of the ref'd record): any record field (`name damage damageType versatile
properties mastery range weaponKind category ac{base,dex,maxDex} strMin weight description`) plus `base` (weapon/armor
id a magic item is made from, e.g. `{kind:'magic-item', ref:'weapon-1', custom:{base:'rapier'}}`), `bonus` (+N attack
& damage for weapons, +N AC for armor/shields), `attackBonus`, `damageBonus`, `acBonus`, `modifiers`, `abilitySet`,
`attunement`. Weapons: melee/ranged is `weaponKind` (raw srd `kind` is normalised by `buildRules`).

### Choice keys (`char.choices[key]`)
| key | used for |
|---|---|
| `${featureId}@${classId}:${classLevel}` | class & subclass feature choices; one key per level a repeated feature appears at. `countKey` choices (Weapon Mastery, Invocations) live at the first level and hold the running total |
| `class-skills@${classId}:1` / `class-tools@${classId}:1` | class skill / tool picks (first class mirrors `char.skills`; later classes = multiclass pick) |
| `${classId}-subclass@${classId}:3` | subclass (mirrors `classes[i].subclass`, which wins on read) |
| `species:${traitId}` | species/subspecies trait choices; `species:subspecies` and `species:size` are canonical (mirror `species.subspecies/size`) |
| `background:abilities` | `{str:2,con:1}` (mirrors `background.abilityBonuses`); `background:tool` for category tools |
| `origin:languages` | the two starting languages (Common is automatic); satisfied by `extraProficiencies.languages` too |
| `feat:${featId}` | choices inside a feat; a second instance of a repeatable feat uses `feat:${featId}@2` (walk order: background, species, classes, `char.feats`) |
| `ability:${id}` | choices inside a custom ability |
| suffix `/${part.key ?? index}` | each part of a `multi` choice is its own Choice (no parent Choice is emitted) |
| suffix `>${optionId}` | nested choice of a picked option (Agonizing Blast's cantrip) or fighting-style alternative (`>blessed-warrior`) |

Values: list types → `[id]`; single picks → `id`; `ability-increase` → `{str:1}`; `asi-or-feat` → `{asi:{…}}` or
`{feat, asi}` (a feat taken through ASI keeps its ability increase in `asi`; its other choices use `feat:${id}…`).
Use `setChoice(char, key, value)` (or write `char.choices[key]` + the mirrored field yourself).

## Engine — `engine.js` (pure; no DOM; Node-testable)
```js
buildRules(files) -> rules       // pure: {classes, features, subclasses, species, backgrounds, feats, spells, weapons, armor,
                                 //  gear, magicItems, rules, stubs:{…}, custom:{<kind>:[…]}} -> merged lists + lookups
                                 //  (classById, featureById, subclassById, subclassesByClass, speciesById, featById,
                                 //  spellById, spellsByClass, weaponById, armorById, gearById, magicItemById, toolById,
                                 //  abilityById, skillById, languageById, masteryById, core = rules.json …)
loadRules({reload}?)             // Promise<rules> — srd files via compendium.srd + custom via compendium.entries; cached
invalidateRules()                // drop the cache (custom library changed)
newCharacter({name, player})     // blank doc (level 0 until a class is chosen)
derive(char, rules) -> Sheet     // never throws on partial/invalid docs; unknown ids are skipped with warnings
choicesFor(char, rules) -> Choice[]                              // every applicable choice, with stored `value`
validateChoices(char, rules) -> Choice[]                         // pending (unanswered / incomplete) choices
setChoice(char, key, value) -> char                              // new doc; null/[] removes; mirrors subclass etc.
pruneChoices(char, rules) -> char                                // drop keys that no longer apply
levelUpPlan(char, rules, classId) -> { newLevel, hitDie, hpAverage, hpGain, conMod, features:[Feature], choices:[Choice],
                                       slotsBefore, slotsAfter, pactBefore, pactAfter, newCantrips, newPrepared,
                                       allowed, reasons, isNewClass, multiclassProficiencies, … }
applyLevelUp(char, rules, classId, {hpRoll, choices}) -> char   // new doc; hpRoll = raw die (default average);
                                                                 // throws if multiclass prerequisites fail
levelDown(char, rules, classId) -> char                          // remove the last level (+ its choices)
canMulticlass(char, rules, classId) -> {ok, reasons:[string]}
availableSpells(char, rules, classId) -> {list, lists, maxLevel, cantrips, prepared, cantripCount, preparedCount,
                                          alwaysPrepared, spellbook, ability, dc, attack, spells:[Spell]}
itemStats(item, rules) -> {name, kind, record, weapon|null, armor|null, magic|null, bonus:{attack,damage,ac},
                           modifiers, weight, totalWeight, active, requiresAttunement, …}
abilityPointBuyCost(scores) -> number|null ; pointBuyInfo(scores) -> {cost, budget, remaining, valid, errors}
averageHp(die) -> 6 for d10
longRest(char, rules) / shortRest(char, rules, {hitDiceSpent:{10:2}|n, healed?}) -> char   // new docs
```
`char.spells[]`: for spellbook casters (Wizard) entries are the spellbook and `prepared:true` marks prepared spells;
for other casters every entry is prepared unless `prepared:false`. `always:true` = doesn't count against the limit.
`Sheet`:
```js
{ totalLevel, classLine:"Fighter 5 (Champion)", profBonus,
  abilities:{str:{score, mod, save, saveProf}}, skills:{stealth:{ability, prof, expertise, bonus}},
  passive:{perception, insight, investigation}, ac:{value, formula}, initiative, speed:{walk, …},
  hpMax, hitDice:[{die:10, total:5, used:0}], size, senses, languages:[], resistances:[],
  proficiencies:{armor:[], weapons:[], tools:[]},
  features:[{id, name, source:"Fighter 3"|"Dwarf"|"Feat"|"Custom", level, description, choiceKey?, uses?}],
  resources:[{key, label, max, used, recharge:"short"|"long"}],
  spellcasting:[{class, ability, dc, attack, cantrips, prepared, maxSpellLevel}], slots:[n1..n9], pact:{slots, level}|null,
  attacks:[{uid, name, bonus, damage:"1d8+3", damageType, versatile, range, properties:[], mastery|null, notes}],
  armorWorn, shield, encumbrance:{carried, capacity},
  pending:[Choice], warnings:[string] }
```
Also produced (additive): `classes:[{id,name,level,subclass,subclassName,hitDie,counters}]`, `saves:{str:n}`,
`skills.x.{name, half}` (Jack of All Trades), `ac.parts:[{label,value}]`, `hp:{current,temp,max}`, `senses` (string) +
`sensesList` + `darkvision`, `languages` (ids) + `languageNames`, `resistances` (damage-type ids),
`proficiencies.{saves,skills,expertise}`, `features[].{sourceType, classId, classLevel, levels, times, uses}`,
`resources[].{shortRegain (uses regained on a Short Rest), die, auto (parsed from prose)}`,
`spellcasting[].{name, kind, abilityName, list, lists, alwaysPrepared, cantripCount, preparedCount, spellbook, slots}`,
`casterLevel`, `pact.used`, `slotsUsed`, `spells:[{id,name,level,class,prepared,always,innate,source,record}]` (all known
spells incl. always-prepared, feat and species spells), `innate:[{source, ability, dc, attack, spells}]`,
`attacks[].{ability, proficient, propertyNames, magicBonus, unarmed}`, `weaponMasteries`, `items` (resolved inventory),
`choices` (all), `nextLevelXp`, `heroicInspirationOnLongRest`. All ids are ids (use rules lookups for names).

**Proficiency detail & debuffs** (`engine-derive.js` + `engine-adjust.js`):
- `abilities[a].check` = the ability-check bonus (mod + `checks` modifiers + Exhaustion); `attacks[].damageBonus`
  = the number added to the damage dice.
- `proficiencyInfo = { skills: {[id]: {state, rules, base, override, sources:[{label, level, extra?}]}},
  saves: {[abil]: {state, rules, base, override, sources:[{label, extra?}]}} }` — skill levels are
  `'none'|'proficient'|'expertise'`, saves booleans. `rules` = class/background/species/feats/choices only, `base` = +
  `extraProficiencies`, `state` = final (after `overrides.proficiency`). Labels: "Class: Fighter", "Background: Soldier",
  "Species: Elf (Keen Senses)", "Feat: Resilient", "Rogue 1: Expertise", "Added in Edit all" (`extra:true`).
- Every displayed number **already includes its debuffs** (`skills.x.bonus`, `abilities.x.save/check`, `ac.value`,
  `speed.*`, `initiative`, `passive.*`, `attacks[].bonus/damage`, `spellcasting[].attack/dc`, `innate[].attack/dc`,
  `hpMax`, `profBonus`). `adjust = { [key]: {label, format:'mod'|'num'|'ft'|'text', base, value, reasons:[{label,
  amount?, note?}]} }` lists each stat a debuff touched: `value` = shown value, `base` = value without debuffs
  (`value === base` → note-only, e.g. Disadvantage). Keys: `ac initiative speed profBonus hpMax`, `score:<abil>`,
  `ability:<abil>` (check), `save:<abil>`, `skill:<id>`, `passive:perception|insight|investigation`,
  `attack:<uid>|attack:unarmed`, `damage:<uid>|damage:unarmed`, `spellAttack:<classId>`, `spellDc:<classId>`,
  `spellAttack:innate:<group>`, `spellDc:innate:<group>`. UI: `widgets.adjustedValue(sheet, key, text)`.
  Built by diffing against a second "pure" derive pass (no debuffs); cascades (a cursed −2 STR lowering Athletics)
  are attributed to their source.
- Sources: **Exhaustion** (2024): −2 × level on every D20 Test shown (checks, skills, saves, initiative, weapon & spell
  attacks), Speed −5 ft × level (all speeds, min 0); never DCs, AC or damage. *Choice:* passive scores include it
  (a passive score is 10 + the check bonus), and Disadvantage on checks (Poisoned) is −5 to passives, as the SRD's
  Passive Perception rule says. **Conditions** (SRD 5.2 text in `rules.json`): Speed 0 for Grappled, Paralyzed,
  Petrified, Restrained, Unconscious; notes for Disadvantage (Blinded/Poisoned/Prone/Restrained attacks; Frightened
  checks & attacks while the source is in sight; Grappled attacks vs others; Restrained DEX saves), auto-fail STR/DEX
  saves (Paralyzed, Petrified, Stunned, Unconscious), Incapacitated (implied by those four: Initiative Disadvantage, no
  actions), Prone movement, Blinded/Deafened Perception. Charmed and Invisible change no numbers. **Negative
  modifiers** on custom abilities, feats and items (and negative item `bonus/attackBonus/damageBonus/acBonus`), labelled
  with the source name. **Armour**: heavy armour below its Strength −10 ft; armour without training → Disadvantage on
  STR/DEX D20 Tests and no spellcasting (notes); a Shield without training gives no AC (2024 Armor Training);
  Stealth-disadvantage armour → note on Stealth.
- Overrides: a stored number (`overrides.ac/initiative/speed/…`) replaces the computed value, so its permanent penalties
  vanish; temporary ones (Exhaustion, conditions) still apply on top (initiative, speed, passive Perception).

`Choice`: `{ key, featureId, label, type, count, options:[{id, name, description, meta?, disabled?, reason?, entry?}],
value, complete, source, sourceType, classId, classLevel, parentKey, featKey }` + the raw descriptors of the SRD
`choice` object (`from category points max maxPerAbility list listFrom level levelByClassLevel school ritual
alwaysPrepared changeable note alternatives countKey countByLevel countFrom`; `level` is the SPELL level). Types:
`asi-or-feat`, `feat`, `weapon-mastery`, `expertise`, `skills`, `tools`, `skills-or-tools`, `languages`, `options`,
`spells`, `subclass`, `subspecies`, `size`, `ability`, `ability-increase` (also used for `background:abilities`, with
`points:3, maxPerAbility:2`), `damage-type`, `wild-shape-forms`. `multi` and `spellcasting` are never emitted.

Rules to honour: proficiency by total level; HP = max die at first class level 1, then rolled/average + CON each level
(min 1), + modifiers.hpPerLevel; AC from worn armor (light: +DEX, medium: +DEX max 2, heavy: none) + shield 2 (only
with Shield training), or
Unarmored Defense (Barbarian CON, Monk WIS without shield) / other class formulas; attack = ability mod (STR melee,
DEX ranged, best for finesse) + prof if proficient; mastery shown when the weapon is in a weapon-mastery choice;
multiclass slots per the 2024 multiclass table (full + half(round up) + third(round down)); Warlock pact slots separate;
2024 backgrounds grant ability bonuses, the origin feat, 2 skills and a tool; ASI feat caps ability at 20.

## Compendium API — `assets/js/views/compendium/api.js`
```js
openPicker(kinds, {title, filter, multi}) -> Promise<entry|entry[]|null>  // kinds: 'weapon' | ['weapon','armor',…]
//   + {widen:{label, filter?, hint?, on?}}  a "Show all…" checkbox: while ticked the list uses widen.filter instead of filter
//   + {mark:(entry) => null|string|{label,title}}  a small warning badge on a row (the sheet marks "off-list" spells)
openEntryEditor(kind, entry?) -> Promise<savedEntry|null>                 // create/edit custom entries (saved to repo library)
renderEntry(entry) -> Node                                                // stat block + markdown description
```

## XP & levels — `engine-xp.js` (pure; re-exported by `engine.js`), UI `xp.js` + `levelup.js`
Doc fields: `xp` (≥ 0), `xpLog` (newest last, capped at 30: `{at, delta, total, note?, set?}`; `set:true` = "set exact"),
`levelOrder` (class id of every level gained through `applyLevelUp`, most recent last; `levelDown` pops the last
occurrence; may be shorter than the total level for characters built directly at a level). Thresholds: `rules.json`
`xpByLevel` (fallback `XP_TABLE`).
```js
xpTable(rules) -> [20]            xpForLevel(level, rules) -> min XP      levelForXp(xp, rules) -> 1..20
xpStatus(char, rules) -> {xp, level, xpLevel, due, floor, next, toNext, pct, atMax, levelForNext}   // due: levels earned, not taken
xpLevelsCrossed(beforeXp, afterXp, level, rules) -> n   // > 0 only when the change crosses a NEW threshold above level
addXp(char, delta, {note, at}) / setXp(char, value, {note, at}) -> char   // new doc + xpLog entry (never below 0)
xpAfterLevelChange(xp, newLevel, 'up'|'down', rules) -> {xp, changed, reason}  // milestone up: raise to the minimum;
                                                                                 // down: reset if XP still reaches higher
lastLeveledClass(char) -> classId|null                    // from levelOrder, else the last class in `classes`
levelDownPlan(char, rules, classId) -> {fromLevel, toLevel, removesClass, totalBefore, totalAfter, features, choices,
  hpBefore, hpAfter, hpLost, slotsBefore/After, pactBefore/After, maxSpellLevelBefore/After, cantripsBefore/After,
  preparedBefore/After, profBonusBefore/After, subclass, resourcesBefore/After, spellsAtRisk, alwaysLost, trimmed, next, isLatest}
  // engine.js; `next` = levelDown() + running-total picks (Invocations, Weapon Mastery…) cut back to the new count
```
Flow: the sheet header shows an XP meter (click → Experience window: add / subtract / set, history, XP table, "Level up
(ignore XP)", "Level down…"). When an XP change crosses a threshold (`xpLevelsCrossed > 0`) the window closes and
`levelUpFlow` opens Level Up once per due level ("1 of 3"); cancelling leaves "Level up · N due" on the header (it never
re-triggers on load). A level taken while no level is due is a milestone: Level Up offers to raise XP to the new level's
minimum. `openLevelDown` lists what goes and offers to remove now-uncastable spells and to reset XP.

## Spell numbers & compatibility — `engine-spells.js` (pure; re-exported by `engine.js`)
```js
spellStats(record, {charLevel, caster:{attack, dc, mod}|null}) -> {attack:'ranged'|'melee'|'weapon'|null, toHit, save, dc,
  damage:[{dice|null, bonus, type, types?, typeName, mod, extra?, weapon?, join:'new'|'and'|'or'|'then', group, alt, note, text}],
  damageGroups:[{parts, text, note, primary}],   // one per effect (sentence): Ice Knife ["1d10 Piercing", "2d6 Cold"]
  damageText ("5d6 Fire + 5d6 Radiant", groups joined by " · "), heal:{dice, bonus, text, all?, half?, upTo?, note}|null,
  count:{count, unit}|null, scaling:{kind:'dice'|'count', tiers, current, next}|null, upcast:{what, dice|count, unit?, above, text}|null,
  parsed, higherLevel}
spellIssues(record, sc, {className}) -> [{code:'no-caster'|'not-on-list'|'too-high', text}]   // sc = sheet.spellcasting[i]
addSpellIssues(records, sc, {className}) -> [{record, issues (+'cantrip-limit'|'prepared-limit'), prepared}]
onCasterList(record, sc)   parseDice('2d10 + 3')   diceText({dice, bonus})   rollDice(expr|{dice,bonus}, rand)   cantripTier(level)
```
Structured `attack` / `save` / `damage` first (the record's damage leads), then every damage component in the text:
"XdY (+N) <Type> damage" (several in one sentence: "and" = adds, "or" = alternatives, same type = later damage),
"<Type> damage equal to XdY plus your spellcasting ability modifier", type lists ("5d8 Acid, Cold, Fire, Lightning, or
Thunder damage"), "damage of the chosen type / a type you choose / the spirit's type / the type in parentheses" (the
types come from the "choose …" sentence), "extra XdY damage", Delayed Blast Fireball's base damage; each other sentence
is its own effect (chip). Weapon cantrips (True Strike, Shillelagh) attack with the spell ability; Prismatic Spray/Wall
take their ray types from a fixed list (the table text is garbled). Mishap/side damage is skipped (Dimension Door,
Teleport, Meld into Stone, Wish, Enlarge/Reduce). Healing: "regains Hit Points equal to XdY (+ mod)", "regains/restores
N Hit Points", "half the damage dealt", "all its Hit Points". Audit (2026-10-22): 339 SRD spells, 178 show numbers;
the rest are utility spells. Cantrips scale by character level (5/11/17); levelled spells show base dice + the upcast rule. The sheet renders
to-hit / DC through `adjustedValue(sheet, 'spellAttack:<class>' | 'spellDc:<class>' | '…:innate:<group>')`.
Spells added anyway (off the class list, above the highest slot level, no spellcasting class) are stored normally and
get a live "off-list" mark on the sheet; nothing is blocked.

## Bonus actions — `engine-actions.js` (pure; re-exported by `engine.js`), UI `sheet.js` `bonusActions()`
```js
isBonusActionSpell(record) -> bool                          // castingTime contains "Bonus Action"
bonusActionOptions(description) -> [{label|null, text, more?:[label]}]   // sentences that GRANT a Bonus Action
bonusActionFeatures(features) -> [{feature, options}]       // sheet.features (class, subclass, species, feat, custom);
                                                            // custom abilities may also set activation:'bonus'
featureHealing(text, sheet.classes) -> {dice, bonus, text}|null   // "1d10 plus your Fighter level" (Second Wind)
offhandAttacks(sheet) -> {eligible, reason, twoWeaponFighting, nick, options:[{uid, name, bonus, damage, damageType, nick}]}
```
Riders and restrictions ("Whenever you … with a Bonus Action", "As part of the Bonus Action…", "can do only one of the
following: … or take a Bonus Action") are not grants. Off-hand (2024 Light property): two equipped Light weapons (or a
stack of 2), damage without the ability modifier unless negative (Two-Weapon Fighting keeps it); Nick noted.

## Proficiency labels — `engine-prof.js` (pure; re-exported by `engine.js`)
```js
entryFit(entry, sheet, {base, speciesName}) -> {badges:[{label, tone:'ok'|'warn'|'info'|'muted', title}], lines:[{text, tone}]}
  // weapon: Proficient / Not proficient (+ "Mastery: Vex"); armor: Trained / No training (+ STR need, Stealth);
  // gear tools: Proficient / Not proficient, foci: "Focus"; magic items: via `base` weapon/armor + attunement
  // ("by a Cleric or Paladin" → Can't attune); spells: Prepared / Known / In spellbook / Off-list / Too high /
  // No spellcasting; feats: Taken / Prerequisite
weaponFit(w, sheet)  armorFit(a, sheet)  toolFit(g, sheet)  focusFor(g, sheet)  attunementFit(entry, sheet, {speciesName})  spellFit(record, sheet)
```
The sheet shows `badges` in picker rows (openPicker `mark`, which now accepts an array of `{label, title, tone}`) and
`badges` + `lines` at the top of entry modals (inventory, attacks, spells, item edit). 2024 consequences: no
Proficiency Bonus to attacks (weapon) / checks (tool); armor without training = Disadvantage on Str/Dex D20 Tests and
no spellcasting.

## Smart tags — `engine-tags.js` (pure; re-exported by `engine.js`), UI `sheet.js` `features()` (All | Smart)
```js
TAGS  [{id, label, hint}]  magic attack weaponry defense advantages interaction leveling healing movement senses
      exploration skills reactions resources
featureTags(feature, record?) -> [tagId]        // rules text + uses/levels/choiceKey + record.modifiers + record.tags
normalizeTags(ids|labels|"a, b") -> [tagId]     customAbilityRecords(char, abilityById) -> Map(featureId -> record)
tagFeatures(features, {records}) -> {tagged:[{feature, tags}], byTag:{tag:[…]}, counts:{tag:n}}
advantageSources(sheet, {conditions}) -> [{kind:'advantage'|'disadvantage'|'both', source, text, from}]   // features,
       // active conditions, equipped/attuned magic items, armor (Stealth, no training), Exhaustion
attacksPerAction(features) -> 1..4               // Extra Attack / Two / Three Extra Attacks
```
Smart view: tag chips with counts (the seven asked-for tags always, others when used, "Other" for untagged), the
character's related numbers (Defense → AC/HP/save profs/resistances; Magic → DC/attack/slots/magic items; Leveling → XP
and `levelUpPlan` of the latest class + open choices; Advantages → every source; …), then the tagged features. The
view and tag are remembered per device in localStorage `sw:characters:features`.
