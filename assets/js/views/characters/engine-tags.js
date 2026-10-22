// Smart tags for features, traits, feats and custom abilities (the "Smart" view of Features & traits).
// Pure ES module: no DOM; Node-testable (tools/test_spells.mjs). Tags come from the rules text and the data
// (uses, levels, modifiers) plus manual `tags` on custom abilities; a feature can carry several.

export const TAGS = [
  { id: 'magic', label: 'Magic', hint: 'Spellcasting, spells, magical effects' },
  { id: 'attack', label: 'Attack', hint: 'Attack rolls, damage, Extra Attack, Initiative' },
  { id: 'weaponry', label: 'Weaponry', hint: 'Weapons, masteries, fighting styles' },
  { id: 'defense', label: 'Defense', hint: 'AC, saving throws, resistances, hit points' },
  { id: 'advantages', label: 'Advantages', hint: 'Sources of Advantage and Disadvantage' },
  { id: 'interaction', label: 'Interaction', hint: 'Social skills, languages, charm and fear' },
  { id: 'leveling', label: 'Leveling', hint: 'Grows with level, ASIs, subclass, choices' },
  { id: 'healing', label: 'Healing', hint: 'Regaining hit points, temporary hit points' },
  { id: 'movement', label: 'Movement', hint: 'Speed, Dash, climbing, flying, teleporting' },
  { id: 'senses', label: 'Senses', hint: 'Darkvision, detection, Perception' },
  { id: 'exploration', label: 'Exploration', hint: 'Stealth, survival, travel, tools' },
  { id: 'skills', label: 'Skills', hint: 'Proficiency and Expertise' },
  { id: 'reactions', label: 'Reactions', hint: 'Things you do with your Reaction' },
  { id: 'resources', label: 'Uses & rests', hint: 'Limited uses, Short and Long Rests' },
];
export const TAG_IDS = TAGS.map((t) => t.id);
const LABEL_TO_ID = Object.fromEntries(TAGS.flatMap((t) => [[t.id, t.id], [t.label.toLowerCase(), t.id]]));

// Rules-text patterns per tag (the name counts too). Kept conservative: a word has to carry the meaning.
const RULES = {
  magic: /\bconcentration on\b|\bspells?\b|\bspellcasting\b|\bcantrips?\b|\bspell slots?\b|\britual\b|\bmagic(al)?\b|\barcane\b|\bchannel divinity\b|\bsorcery points?\b|\bpact magic\b|\binvocation/i,
  attack: /\bwhenever you hit\b|\bdeflect attacks\b|\battack rolls?\b|\bextra attack\b|\battacks? (?:action|twice|three times)|\bmake (?:one|two|an?|three) (?:\w+ ){0,3}attacks?\b|\bunarmed strikes?\b|\bsneak attack\b|\bcritical hits?\b|\bsmite\b|\bextra (?:\d+d\d+ )?(?:\w+ )?damage\b|\bdeals? (?:an )?extra\b|\bon a hit\b|\bwhen you hit\b|\bdamage (?:rolls?|dice|die)\b|\brage damage\b|\binitiative\b/i,
  weaponry: /\bweapons?\b|\bweapon mastery\b|\bmastery propert|\bfighting style\b|\barchery\b|\bdueling\b|\bthrown\b|\bammunition\b|\bfinesse\b|\bmartial arts\b/i,
  defense: /\barmor class\b|\bAC\b|\bresistance\b|\bimmun(?:e|ity|ities)\b|\bresistances\b|\bbonus (?:to|on) (?:\w+ ){0,3}saving throws?\b|\byour total for an? [^.]*saving throw|\baura of protection\b|\byou (?:have|gain|make|succeed|add|can)[^.]{0,50}\bsaving throws?\b|\bsaving throws? (?:you make|against)\b|\bproficiency in (?:\w+ ){0,2}saving throws?\b|\breduces? (?:the )?(?:\w+ ){0,3}damage\b|\bdamage (?:you|it) take\b|\bdodge\b|\bevasion\b|\bunarmored defense\b|\btemporary hit points\b|\bhit point maximum\b|\bdeath saving\b|\bcan't be (?:charmed|frightened|surprised)\b|\bdisengage\b|\bshields?\b/i,
  advantages: /\badvantage\b|\bdisadvantage\b|\breroll\b/i,
  interaction: /\bcharisma (?:check|\()|\bpersuasion\b|\bdeception\b|\bintimidat|\binsight\b|\bperformance\b|\blanguages?\b|\btelepath|\bspeak (?:with|to)\b|\bcommunicat|\bcharmed\b|\bfrightened\b|\bsocial\b|\binspir(e|ation)\b/i,
  leveling: /\bwhen you reach (?:\w+ )?levels?\b|\bat (?:\w+ )?levels? \d+|\blevels? \d+ \(|\bincreases? (?:to|when|as|by \d+ when)\b|\bability score improvement\b|\bepic boon\b|\bsubclass\b|\bas you gain levels\b|\bimproves? (?:at|when)\b|\bscores? increases?\b|\b(?:origin|general) feat\b|\bgain (?:an?|one) feat\b/i,
  healing: /\bregains? (?:\w+ ){0,4}hit points?\b|\brestores? (?:\w+ ){0,4}hit points?\b|\bheal(?:s|ing|ed)?\b|\btemporary hit points\b|\bhit dice\b|\bstabiliz/i,
  movement: /\bspeed\b|\bdash\b|\bclimb(?:ing)?\b|\bswim(?:ming)?\b|\bfly(?:ing)?\b|\bjump(?:ing)?\b|\bteleport|\bdifficult terrain\b|\bmove (?:up to|half|an? |through)|\bmovement\b/i,
  senses: /\bdarkvision\b|\bblindsight\b|\btremorsense\b|\btruesight\b|\bpassive perception\b|\bperception\b|\byou (?:can )?(?:sense|detect)\b|\bsenses?\b|\bsee (?:invisible|in darkness|through)\b/i,
  exploration: /\bstealth\b|\bsurvival\b|\bhide\b|\bhidden\b|\bforag|\btrack(?:ing|s)?\b|\bnavigat|\bterrain\b|\btravel\b|\btools?\b|\bsleight of hand\b|\binvestigat|\blocks?\b|\btraps?\b|\bunderwater\b|\bhold (?:your|its) breath\b/i,
  skills: /\bproficien(?:cy|t) (?:in|with) (?:one|two|three|a|an|the|\w+) (?:skill|tool)|\bskill proficienc|\bexpertise\b|\bskills?\b(?! check)/i,
  reactions: /\breaction\b/i,
  resources: /\bshort rest\b|\blong rest\b|\bexpended uses\b|\bregain all\b|\bnumber of times equal to\b|\buses? of (?:this|it)\b|\bexpend\b/i,
};
// Sentences that only say what you CAN'T do (Rage: "you can't cast spells") don't tag.
const NEGATIVE = /\bcan't (?:cast|maintain|speak|take)\b|\bcannot (?:cast|speak)\b|^\s*no (?:concentration|spells)\b/i;
// Modifier keys (custom abilities, feats) -> tags
const MOD_TAGS = { ac: 'defense', saves: 'defense', hpMax: 'defense', hpPerLevel: 'defense', resistances: 'defense', attack: 'attack', damage: 'attack', spellDc: 'magic', spellAttack: 'magic', speed: 'movement', skills: 'skills', checks: 'skills', senses: 'senses', initiative: 'defense', abilities: 'leveling' };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (f) => `${f?.name || ''}. ${String(f?.description || '').replace(/\*\*|__/g, '').split(/(?<=[.!?])\s+|\n+/).filter((s) => !NEGATIVE.test(s)).join(' ')}`;

/** Manual tags (ids or labels, any case) -> known tag ids, in TAGS order. */
export function normalizeTags(tags) {
  const set = new Set((Array.isArray(tags) ? tags : String(tags || '').split(/[,;]/)).map((t) => LABEL_TO_ID[String(t).trim().toLowerCase()]).filter(Boolean));
  return TAG_IDS.filter((t) => set.has(t));
}

/**
 * Tags of one feature: [tagId] in TAGS order.
 *   f        a sheet.features entry ({id, name, description, uses, levels, sourceType, …})
 *   record   the underlying record when known (custom ability / feat): {modifiers, tags, uses, recharge}
 */
export function featureTags(f, record = null) {
  const tags = new Set(normalizeTags(record?.tags ?? f?.tags));
  const t = text(f);
  for (const [tag, re] of Object.entries(RULES)) if (re.test(t)) tags.add(tag);
  if (f?.uses || record?.uses) tags.add('resources');
  if (Array.isArray(f?.levels) && f.levels.length > 1) tags.add('leveling');
  if (f?.choiceKey && /subclass|ability-score-improvement|epic-boon/.test(f.choiceKey)) tags.add('leveling');
  const mods = isObj(record?.modifiers) ? record.modifiers : isObj(f?.modifiers) ? f.modifiers : null;
  if (mods) for (const [k, v] of Object.entries(mods)) if (MOD_TAGS[k] && (isObj(v) ? Object.keys(v).length : Array.isArray(v) ? v.length : Number(v) || v)) tags.add(MOD_TAGS[k]);
  // "Spellcasting" / spell-granting features are magic even when the text only names the spells
  if (/spellcasting|pact magic/i.test(f?.name || '')) tags.add('magic');
  return TAG_IDS.filter((x) => tags.has(x));
}

/** Records behind custom-ability features: Map(featureId -> merged record), same id scheme as the engine. */
export function customAbilityRecords(char, abilityById = {}) {
  const out = new Map();
  (Array.isArray(char?.abilities) ? char.abilities : []).forEach((ab, i) => {
    if (!isObj(ab)) return;
    const refId = ab.ref ? String(ab.ref).replace(/^ability\//, '') : null;
    const base = refId ? abilityById[refId] || null : null;
    const { ref: _r, ...inline } = ab;
    const rec = { ...(base || {}), ...inline };
    out.set(rec.id || refId || `custom-${i}`, rec);
  });
  return out;
}

/** Group features by tag: {counts:{tag:n}, byTag:{tag:[{feature, tags}]}, tagged:[{feature, tags}]} */
export function tagFeatures(features, { records = new Map() } = {}) {
  const tagged = (Array.isArray(features) ? features : []).filter(Boolean).map((f) => ({ feature: f, tags: featureTags(f, records.get(f.id) || null) }));
  const byTag = Object.fromEntries(TAG_IDS.map((t) => [t, []]));
  for (const x of tagged) for (const t of x.tags) byTag[t].push(x);
  return { tagged, byTag, counts: Object.fromEntries(TAG_IDS.map((t) => [t, byTag[t].length])) };
}

const sentencesOf = (s) => String(s || '').replace(/\*\*|__/g, '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

/**
 * Every source of Advantage / Disadvantage the sheet knows about:
 * [{kind:'advantage'|'disadvantage'|'both', source, text, from:'feature'|'condition'|'item'|'armor'|'exhaustion'}]
 *   opts.conditions  [{id, name, description}] of the character's active conditions
 */
export function advantageSources(sheet, { conditions = [] } = {}) {
  const out = [];
  const push = (from, source, s) => {
    const adv = /\badvantage\b/i.test(s.replace(/disadvantage/gi, ''));
    const dis = /\bdisadvantage\b/i.test(s);
    if (!adv && !dis) return;
    out.push({ kind: adv && dis ? 'both' : adv ? 'advantage' : 'disadvantage', source, text: s.slice(0, 260), from });
  };
  for (const f of Array.isArray(sheet?.features) ? sheet.features : []) for (const s of sentencesOf(f.description)) push('feature', f.name, s);
  for (const c of conditions) for (const s of sentencesOf(c.description)) push('condition', c.name, s);
  for (const it of Array.isArray(sheet?.items) ? sheet.items : []) {
    if (!(it.equipped || it.attuned) || !(it.magic || it.record?.kind === 'magic-item')) continue;
    for (const s of sentencesOf(it.description || it.record?.description)) push('item', it.name, s);
  }
  const aw = sheet?.armorWorn;
  if (aw?.stealthDisadvantage) out.push({ kind: 'disadvantage', source: aw.name, text: 'Disadvantage on Dexterity (Stealth) checks while you wear it.', from: 'armor' });
  if (aw && aw.proficient === false) out.push({ kind: 'disadvantage', source: aw.name, text: 'No training with this armor: Disadvantage on any D20 Test that uses Strength or Dexterity, and no spellcasting.', from: 'armor' });
  if (sheet?.shield && sheet.shield.proficient === false) out.push({ kind: 'disadvantage', source: sheet.shield.name || 'Shield', text: 'No Shield training: Disadvantage on any D20 Test that uses Strength or Dexterity, and no spellcasting.', from: 'armor' });
  const ex = Number(sheet?.exhaustion) || 0;
  if (ex > 0) out.push({ kind: 'disadvantage', source: `Exhaustion ${ex}`, text: `−${ex * 2} to every D20 Test and −${ex * 5} feet of Speed.`, from: 'exhaustion' });
  return out;
}

/** Attacks per Attack action from Extra Attack features (2, 3 with "Two Extra Attacks", 4 with "Three …"). */
export function attacksPerAction(features) {
  let n = 1;
  for (const f of Array.isArray(features) ? features : []) {
    const name = String(f?.name || '');
    if (/three extra attacks/i.test(name)) n = Math.max(n, 4);
    else if (/two extra attacks/i.test(name)) n = Math.max(n, 3);
    else if (/\bextra attack\b/i.test(name)) n = Math.max(n, 2);
  }
  return n;
}
