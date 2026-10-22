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
  "abilities": [ { "ref": "ability/second-wind-plus" }, { "name": "Stoneborn Grit", "description": "…", "uses": 1,
                   "recharge": "long", "modifiers": { "ac": 1 } } ],   // advanced: extra/custom abilities
  "overrides": { "ac": null, "speed": null, "initiative": null, "hpMax": null, "profBonus": null,
                 "passivePerception": null, "abilities": {}, "saves": {}, "skills": {} },   // number = replace; skills/saves values are flat BONUS
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

`Choice`: `{ key, featureId, label, type, count, options:[{id, name, description, meta?, disabled?, reason?, entry?}],
value, complete, source, sourceType, classId, classLevel, parentKey, featKey }` + the raw descriptors of the SRD
`choice` object (`from category points max maxPerAbility list listFrom level levelByClassLevel school ritual
alwaysPrepared changeable note alternatives countKey countByLevel countFrom`; `level` is the SPELL level). Types:
`asi-or-feat`, `feat`, `weapon-mastery`, `expertise`, `skills`, `tools`, `skills-or-tools`, `languages`, `options`,
`spells`, `subclass`, `subspecies`, `size`, `ability`, `ability-increase` (also used for `background:abilities`, with
`points:3, maxPerAbility:2`), `damage-type`, `wild-shape-forms`. `multi` and `spellcasting` are never emitted.

Rules to honour: proficiency by total level; HP = max die at first class level 1, then rolled/average + CON each level
(min 1), + modifiers.hpPerLevel; AC from worn armor (light: +DEX, medium: +DEX max 2, heavy: none) + shield 2, or
Unarmored Defense (Barbarian CON, Monk WIS without shield) / other class formulas; attack = ability mod (STR melee,
DEX ranged, best for finesse) + prof if proficient; mastery shown when the weapon is in a weapon-mastery choice;
multiclass slots per the 2024 multiclass table (full + half(round up) + third(round down)); Warlock pact slots separate;
2024 backgrounds grant ability bonuses, the origin feat, 2 skills and a tool; ASI feat caps ability at 20.

## Compendium API — `assets/js/views/compendium/api.js`
```js
openPicker(kinds, {title, filter, multi}) -> Promise<entry|entry[]|null>  // kinds: 'weapon' | ['weapon','armor',…]
openEntryEditor(kind, entry?) -> Promise<savedEntry|null>                 // create/edit custom entries (saved to repo library)
renderEntry(entry) -> Node                                                // stat block + markdown description
```
