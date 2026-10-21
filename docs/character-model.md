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
  "choices": {                            // key = `${featureId}@${classId}:${level}` (or `${featureId}` for species/background/feat)
    "fighter-fighting-style@fighter:1": "defense",                 // feat id
    "ability-score-improvement@fighter:4": { "asi": { "str": 2 } }, // or { "feat": "great-weapon-master", "asi": {"str":1} }
    "weapon-mastery@fighter:1": ["longsword", "handaxe", "javelin"],
    "rogue-expertise@rogue:1": ["stealth", "perception"]
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
resistances:[…], senses:"…" }` — all additive.

## Engine — `engine.js` (pure; no DOM; Node-testable)
```js
loadRules()                      // Promise<rules> — fetches all srd files via compendium.srd + merges stubs/custom
newCharacter({name, player})     // blank doc (level 0 until a class is chosen)
derive(char, rules) -> Sheet     // never throws on partial/invalid docs; unknown ids are skipped with warnings
levelUpPlan(char, rules, classId) -> { newLevel, hitDie, hpAverage, features:[Feature], choices:[Choice],
                                       slotsBefore, slotsAfter, newCantrips, newPrepared }
applyLevelUp(char, rules, classId, {hpRoll, choices}) -> char   // returns a new doc
validateChoices(char, rules) -> Choice[]                         // pending (unanswered) choices
longRest(char, rules) / shortRest(char, rules, {hitDiceSpent}) -> char
```
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
`Choice`: `{ key, featureId, label, type, count, options:[{id, name, description}], value }` — types from the SRD
`choice` objects (`asi-or-feat`, `feat`, `weapon-mastery`, `expertise`, `skills`, `options`, `subclass`, …).

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
