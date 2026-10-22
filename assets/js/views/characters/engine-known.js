// Machine-readable mechanics for SRD / stub records whose data only has prose.
// Effects use the same vocabulary as `modifiers` plus a few engine-only keys:
//   grants:{weapons,armor,saves,skills,tools,languages,resistances}  hpPerLevel (per character level)
//   hpPerClassLevel (per level of the granting class)  hpMax  speed  speedUnlessHeavy  initiativePB
//   initiativeAbility  unarmoredAC:{base, abilities:[…], shield:bool, label}  acInArmor  acHeavyArmor
//   acUnarmoredNoShield  abilityBonus:{abil:n} + abilityMax  abilitySet:{abil:n}  jackOfAllTrades
//   rangedAttack  duelingDamage  mediumMaxDex  unarmed:{damage, label}  carryMultiplier
//   saveFromAbilityIncrease  saveBonusAbility:{ability, min}  optionResistance  choiceResistance
//   skillBonusAbility:{skillId: abil}  heroicInspirationOnLongRest  choice (an extra Choice def)
import { ABILITY_BY_WORD, toNum } from './engine-util.js';

export const KNOWN = {
  // ----- class features (SRD 5.2)
  'barbarian-unarmored-defense': { unarmoredAC: { base: 10, abilities: ['dex', 'con'], shield: true, label: 'Unarmored Defense' } },
  'monk-unarmored-defense': { unarmoredAC: { base: 10, abilities: ['dex', 'wis'], shield: false, label: 'Unarmored Defense' } },
  'barbarian-fast-movement': { speedUnlessHeavy: 10 },
  'bard-jack-of-all-trades': { jackOfAllTrades: true },
  'rogue-slippery-mind': { grants: { saves: ['wis', 'cha'] } },
  'barbarian-primal-champion': { abilityBonus: { str: 4, con: 4 }, abilityMax: 25 },
  'monk-body-and-mind': { abilityBonus: { dex: 4, wis: 4 }, abilityMax: 25 },
  'paladin-aura-of-protection': { saveBonusAbility: { ability: 'cha', min: 1 } },
  // ----- SRD subclass features
  'draconic-sorcery-draconic-resilience': { hpPerClassLevel: 1, unarmoredAC: { base: 10, abilities: ['dex', 'cha'], shield: true, label: 'Draconic Resilience' } },
  'draconic-sorcery-elemental-affinity': { optionResistance: true },
  'fiend-patron-fiendish-resilience': { optionResistance: true },
  // ----- stub subclass features (prose only in the data)
  'college-of-dance-dazzling-footwork': { unarmoredAC: { base: 10, abilities: ['dex', 'cha'], shield: false, label: 'Dazzling Footwork' } },
  'college-of-valor-martial-training': { grants: { weapons: ['martial'], armor: ['medium', 'shields'] } },
  'college-of-swords-bonus-proficiencies': { grants: { armor: ['medium'], weapons: ['scimitar'] } },
  'twilight-domain-bonus-proficiencies': { grants: { weapons: ['martial'], armor: ['heavy'] } },
  'forge-domain-bonus-proficiencies': { grants: { armor: ['heavy'], tools: ['smiths-tools'] } },
  'forge-domain-soul-of-the-forge': { grants: { resistances: ['fire'] }, acHeavyArmor: 1 },
  'order-domain-bonus-proficiencies': { grants: { armor: ['heavy'] } },
  'rune-knight-bonus-proficiencies': { grants: { tools: ['smiths-tools'], languages: ['giant'] } },
  'assassin-assassins-tools': { grants: { tools: ['disguise-kit', 'poisoners-kit'] } },
  'mastermind-master-of-intrigue': { grants: { tools: ['disguise-kit', 'forgery-kit'] } },
  'bladesinging-training-in-war-and-song': { grants: { armor: ['light'], skills: ['performance'] } },
  'gloom-stalker-iron-mind': { grants: { saves: ['wis'] } },
  'gloom-stalker-dread-ambusher': { initiativeAbility: 'wis' },
  'oath-of-glory-aura-of-alacrity': { speed: 10 },
  // ----- species traits
  'dwarven-toughness': { hpPerLevel: 1 },
  'dwarven-resilience': { grants: { resistances: ['poison'] } },
  'powerful-build': { carryMultiplier: 2 },
  'resourceful': { heroicInspirationOnLongRest: true },
  // ----- feats
  alert: { initiativePB: true },
  tough: { hpPerLevel: 2 },
  speedy: { speed: 10 },
  'boon-of-speed': { speed: 30 },
  'boon-of-fortitude': { hpMax: 40 },
  'boon-of-energy-resistance': { choiceResistance: true },
  defense: { acInArmor: 1 },
  archery: { rangedAttack: 2 },
  dueling: { duelingDamage: 2 },
  'medium-armor-master': { mediumMaxDex: 3 },
  resilient: { saveFromAbilityIncrease: true },
  'tavern-brawler': { unarmed: { damage: '1d4', label: 'Tavern Brawler' } },
  'unarmed-fighting': { unarmed: { damage: '1d6', label: 'Unarmed Fighting', noWeaponDamage: '1d8' } },
  // ----- fighting-style alternatives (Paladin / Ranger)
  'blessed-warrior': { choice: { type: 'spells', count: 2, level: 0, list: ['cleric'], note: 'Cleric cantrips; Charisma is your spellcasting ability for them.' }, cantripClass: 'paladin' },
  'druidic-warrior': { choice: { type: 'spells', count: 2, level: 0, list: ['druid'], note: 'Druid cantrips; Wisdom is your spellcasting ability for them.' }, cantripClass: 'ranger' },
};

/** Effects of a chosen option, keyed `${featureId}:${optionId}`. */
export const KNOWN_OPTIONS = {
  'cleric-divine-order:thaumaturge': { skillBonusAbility: { arcana: 'wis', religion: 'wis' } },
  'druid-primal-order:magician': { skillBonusAbility: { arcana: 'wis', nature: 'wis' } },
};

/** Look up engine-known effects for a record id (with suffix matches for repeated stub trait names). */
export function knownFor(id) {
  if (!id) return null;
  if (KNOWN[id]) return KNOWN[id];
  if (/-(powerful-build|equine-build)$/.test(id)) return { carryMultiplier: 2 };
  if (/-dwarven-resilience$/.test(id)) return null; // stub dwarves carry grants already
  return null;
}

// ----- magic items -----------------------------------------------------------------------------

/** Wondrous items / rings / staves whose bonuses are unconditional while worn (and attuned if required). */
export const KNOWN_ITEMS = {
  'ring-of-protection': { modifiers: { ac: 1, saves: { all: 1 } } },
  'cloak-of-protection': { modifiers: { ac: 1, saves: { all: 1 } } },
  'bracers-of-defense': { acUnarmoredNoShield: 2 },
  'gauntlets-of-ogre-power': { abilitySet: { str: 19 } },
  'headband-of-intellect': { abilitySet: { int: 19 } },
  'amulet-of-health': { abilitySet: { con: 19 } },
  'luck-blade': { modifiers: { saves: { all: 1 } } },
  'robe-of-stars': { modifiers: { saves: { all: 1 } } },
  'staff-of-power': { modifiers: { ac: 2, saves: { all: 2 }, spellAttack: 2 } },
  'staff-of-the-magi': { modifiers: { spellAttack: 2 } },
  'staff-of-the-woodlands': { modifiers: { spellAttack: 2 } },
  'talisman-of-pure-good': { modifiers: { spellAttack: 2 } },
  'talisman-of-ultimate-evil': { modifiers: { spellAttack: 2 } },
  'wand-of-the-war-mage-1': { modifiers: { spellAttack: 1 } },
  'wand-of-the-war-mage-2': { modifiers: { spellAttack: 2 } },
  'wand-of-the-war-mage-3': { modifiers: { spellAttack: 3 } },
  'dwarven-plate': { base: 'plate-armor' },
  'elven-chain': { base: 'chain-shirt' },
  'glamoured-studded-leather': { base: 'studded-leather-armor' },
  'demon-armor': { base: 'plate-armor' },
  'plate-armor-of-etherealness': { base: 'plate-armor' },
  'dragon-scale-mail': { base: 'scale-mail' },
};

/** "+2 bonus to attack rolls and damage rolls made with this magic weapon" -> 2. */
export function magicWeaponBonus(item) {
  const m = /\+(\d) bonus to attack rolls and damage rolls made with (?:this|it)/i.exec(item?.description || '');
  if (m) return Number(m[1]);
  const v = /-(\d)$/.exec(item?.id || '');
  return v && item?.variantOf ? Number(v[1]) : 0;
}

/** "+1 bonus to Armor Class while wearing this armor" -> 1 (skips conditional "against …" bonuses). */
export function magicArmorBonus(item) {
  const m = /\+(\d) bonus to Armor Class(?! against)/i.exec(item?.description || '');
  if (m) return Number(m[1]);
  const v = /-(\d)$/.exec(item?.id || '');
  return v && item?.variantOf ? Number(v[1]) : 0;
}

/** "Weapon (Longsword)" -> "longsword" when the magic item names exactly one base item. */
export function baseFromType(item, nameToId) {
  const m = /^(?:Weapon|Armor) \(([^)]+)\)$/.exec(item?.type || '');
  if (!m) return null;
  const inner = m[1].trim();
  if (/\b(any|or|rare|uncommon|very rare|shield)\b/i.test(inner) || inner.includes(',')) return /^shield$/i.test(inner) ? 'shield' : null;
  return nameToId(inner) || null;
}

// ----- class resources (limited-use features) --------------------------------------------------
// counter: levels[L-1].counters key | uses: fixed | abilityMod (+min) | appearances: number of times the
// feature id appears up to the class level. recharge: 'short' (all back on a Short Rest) or 'long';
// shortRegain: uses regained on a Short Rest when recharge is 'long'.
export const CLASS_RESOURCES = [
  { feature: 'barbarian-rage', key: 'rage', label: 'Rage', counter: 'rage_count', recharge: 'long', shortRegain: 1 },
  { feature: 'barbarian-persistent-rage', key: 'persistent-rage', label: 'Persistent Rage (regain Rage)', uses: 1, recharge: 'long' },
  { feature: 'bard-bardic-inspiration', key: 'bardic-inspiration', label: 'Bardic Inspiration', abilityMod: 'cha', min: 1, recharge: 'long', shortFrom: 'bard-font-of-inspiration', dieCounter: 'bardic_inspiration_die' },
  { feature: 'cleric-channel-divinity', key: 'channel-divinity', label: 'Channel Divinity', counter: 'channel_divinity_charges', recharge: 'long', shortRegain: 1 },
  { feature: 'cleric-divine-intervention', key: 'divine-intervention', label: 'Divine Intervention', uses: 1, recharge: 'long' },
  { feature: 'druid-wild-shape', key: 'wild-shape', label: 'Wild Shape', counter: 'wild_shape_uses', recharge: 'long', shortRegain: 1 },
  { feature: 'druid-wild-resurgence', key: 'wild-resurgence', label: 'Wild Resurgence (spell slot)', uses: 1, recharge: 'long' },
  { feature: 'fighter-second-wind', key: 'second-wind', label: 'Second Wind', counter: 'second_wind_uses', recharge: 'long', shortRegain: 1 },
  { feature: 'fighter-action-surge', key: 'action-surge', label: 'Action Surge', appearances: true, recharge: 'short' },
  { feature: 'fighter-indomitable', key: 'indomitable', label: 'Indomitable', appearances: true, recharge: 'long' },
  { feature: 'monk-monks-focus', key: 'focus-points', label: 'Focus Points', counter: 'focus_points', recharge: 'short' },
  { feature: 'monk-uncanny-metabolism', key: 'uncanny-metabolism', label: 'Uncanny Metabolism', uses: 1, recharge: 'long' },
  { feature: 'paladin-lay-on-hands', key: 'lay-on-hands', label: 'Lay on Hands (HP pool)', counter: 'lay_on_hands_pool', recharge: 'long' },
  { feature: 'paladin-paladins-smite', key: 'paladins-smite', label: "Paladin's Smite (free Divine Smite)", uses: 1, recharge: 'long' },
  { feature: 'paladin-channel-divinity', key: 'channel-divinity-paladin', label: 'Channel Divinity', counter: 'channel_divinity_charges', recharge: 'long', shortRegain: 1 },
  { feature: 'paladin-faithful-steed', key: 'faithful-steed', label: 'Faithful Steed (free Find Steed)', uses: 1, recharge: 'long' },
  { feature: 'ranger-favored-enemy', key: 'favored-enemy', label: "Favored Enemy (free Hunter's Mark)", counter: 'favored_enemies', recharge: 'long' },
  { feature: 'ranger-tireless', key: 'tireless', label: 'Tireless (Temp HP)', abilityMod: 'wis', min: 1, recharge: 'long' },
  { feature: 'ranger-natures-veil', key: 'natures-veil', label: "Nature's Veil", abilityMod: 'wis', min: 1, recharge: 'long' },
  { feature: 'rogue-stroke-of-luck', key: 'stroke-of-luck', label: 'Stroke of Luck', uses: 1, recharge: 'short' },
  { feature: 'sorcerer-font-of-magic', key: 'sorcery-points', label: 'Sorcery Points', counter: 'sorcery_points', recharge: 'long' },
  { feature: 'sorcerer-innate-sorcery', key: 'innate-sorcery', label: 'Innate Sorcery', uses: 2, recharge: 'long' },
  { feature: 'sorcerer-sorcerous-restoration', key: 'sorcerous-restoration', label: 'Sorcerous Restoration', uses: 1, recharge: 'long' },
  { feature: 'warlock-magical-cunning', key: 'magical-cunning', label: 'Magical Cunning', uses: 1, recharge: 'long' },
  { feature: 'warlock-contact-patron', key: 'contact-patron', label: 'Contact Patron', uses: 1, recharge: 'long' },
  { feature: 'warlock-mystic-arcanum', key: 'mystic-arcanum', label: 'Mystic Arcanum (one cast per arcanum spell)', appearances: true, recharge: 'long' },
  { feature: 'wizard-arcane-recovery', key: 'arcane-recovery', label: 'Arcane Recovery', uses: 1, recharge: 'long' },
  { feature: 'wizard-signature-spells', key: 'signature-spells', label: 'Signature Spells (free casts)', uses: 2, recharge: 'short' },
];
export const CLASS_RESOURCE_FEATURES = new Set(CLASS_RESOURCES.map((r) => r.feature));

// ----- prose heuristics for limited uses (subclass features, species traits, feats) -------------

const WORD_COUNT = { once: 1, one: 1, twice: 2, two: 2, three: 3, four: 4 };

/**
 * Parse "uses equal your Wisdom modifier per Long Rest", "a number of times equal to your Proficiency Bonus …
 * Long Rest", "once per Short or Long Rest", "can't use it again until you finish a Long Rest" ->
 * {max:number|'pb'|abil, min, recharge} | null.
 */
export function parseUses(text) {
  const src = String(text || '').replace(/\*\*/g, '');
  if (!src) return null;
  const sentences = src.split(/(?<=[.;!?])\s+|\n+/);
  for (const s of sentences) {
    if (!/Long Rest|Short Rest/i.test(s)) continue;
    const recharge = /Short or Long Rest|Short Rest/i.test(s) && !/until you finish a Long Rest/i.test(s) ? 'short' : 'long';
    let m = /(?:a number of times(?: per (?:Short or )?Long Rest)?|uses?(?: per (?:Short or )?Long Rest)?) equal(?:s)?(?: to)? (?:your )?(Proficiency Bonus|(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|Str|Dex|Con|Int|Wis|Cha) modifier)/i.exec(s);
    if (m) return { max: m[2] ? ABILITY_BY_WORD[m[2].toLowerCase()] : 'pb', min: 1, recharge };
    m = /\((Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier\) per (?:Short or )?Long Rest/i.exec(s);
    if (m) return { max: ABILITY_BY_WORD[m[1].toLowerCase()], min: 1, recharge };
    m = /\b(once|twice|one|two|three|four)(?: (?:uses?|times))? per (?:Short or )?(?:Long|Short) Rest/i.exec(s);
    if (m) return { max: WORD_COUNT[m[1].toLowerCase()] || 1, min: 1, recharge };
    m = /can(?:'|’)t (?:use (?:it|this (?:feature|trait|benefit|ability))|do so|cast it (?:in )?this way) again until you finish a (Short or )?Long Rest/i.exec(s);
    if (m) return { max: 1, min: 1, recharge: m[1] ? 'short' : 'long' };
  }
  return null;
}

export function usesMax(u, { pb, mods }) {
  if (!u) return 0;
  if (u.max === 'pb') return pb;
  if (typeof u.max === 'string') return Math.max(u.min ?? 1, toNum(mods[u.max]));
  return toNum(u.max);
}
