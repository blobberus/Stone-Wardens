// "Does this fit my character?" labels for compendium entries seen from a sheet (2024 rules / SRD 5.2).
// Pure ES module: no DOM; Node-testable (tools/test_spells.mjs). Used by the sheet's pickers (row badges) and entry
// modals (a short line with the consequence when the character isn't proficient). Never blocks anything.
import { onCasterList } from './engine-spells.js';
import { featPrereqReason } from './engine-choices.js';

const cap = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtMod = (n) => (Number(n) >= 0 ? `+${Number(n)}` : `−${Math.abs(Number(n))}`);
const ARMOR_TRAINING = { light: 'light', medium: 'medium', heavy: 'heavy', shield: 'shields' };
const TOOL_CATEGORIES = new Set(['artisans-tools', 'musical-instruments', 'gaming-sets', 'other-tools']);
const FOCUS = { 'arcane-foci': /arcane focus/i, 'holy-symbols': /holy symbol/i, 'druidic-foci': /druidic focus/i, 'musical-instruments': /musical instrument/i };
const NO_ARMOR_TRAINING = 'Disadvantage on any D20 Test that uses Strength or Dexterity, and you can’t cast spells';

const profs = (sheet, k) => (Array.isArray(sheet?.proficiencies?.[k]) ? sheet.proficiencies[k] : []);

/** Weapon proficiency: {proficient, via:'Martial weapons'|'Longsword', mastery:{id, name}|null, category} */
export function weaponFit(w, sheet) {
  const list = profs(sheet, 'weapons');
  const cat = w?.category || null;
  const id = w?.id;
  const byCat = !!cat && list.includes(cat);
  const byId = !!id && list.includes(id);
  const masteries = Array.isArray(sheet?.weaponMasteries) ? sheet.weaponMasteries : [];
  return {
    proficient: byCat || byId, category: cat,
    via: byCat ? `${cap(cat)} weapons` : byId ? w.name || cap(id) : null,
    mastery: w?.mastery && id && masteries.includes(id) ? { id: w.mastery, name: cap(w.mastery) } : null,
  };
}

/** Armor training: {proficient, training:'medium'|'shields', strShort: needed STR or 0, stealth} */
export function armorFit(a, sheet) {
  const training = ARMOR_TRAINING[a?.category] || a?.category || null;
  const str = Number(sheet?.abilities?.str?.score) || 10;
  const strMin = Number(a?.strMin) || 0;
  return { proficient: !!training && profs(sheet, 'armor').includes(training), training, strShort: strMin > str ? strMin : 0, stealth: !!a?.stealthDisadvantage };
}

/** Tools (artisan's tools, instruments, gaming sets, kits): {proficient} or null when the gear isn't a tool. */
export function toolFit(g, sheet) {
  if (!g || !(g.tool || TOOL_CATEGORIES.has(g.category))) return null;
  return { proficient: profs(sheet, 'tools').includes(g.id) };
}

/** Spellcasting focus a class of this character can use: [className] */
export function focusFor(g, sheet) {
  const re = FOCUS[g?.category];
  if (!re) return [];
  return (Array.isArray(sheet?.spellcasting) ? sheet.spellcasting : []).filter((sc) => re.test(String(sc.focus || ''))).map((sc) => sc.name || cap(sc.class));
}

/**
 * Attunement restrictions ("by a Cleric or Paladin", "by a Spellcaster", "by a Dwarf…"):
 * {required, note, meets:true|false|null (null = can't tell), reason}
 */
export function attunementFit(entry, sheet, { speciesName = '' } = {}) {
  if (!entry?.attunement) return { required: false, note: '', meets: true, reason: '' };
  const note = String(entry.attunementNote || '').trim();
  if (!note) return { required: true, note: '', meets: true, reason: '' };
  const low = note.toLowerCase();
  const classes = (Array.isArray(sheet?.classes) ? sheet.classes : []).map((c) => String(c.name || c.id || '').toLowerCase()).filter(Boolean);
  if (/\bspellcaster\b/.test(low)) {
    const caster = (sheet?.spellcasting || []).length > 0 || (sheet?.innate || []).length > 0;
    return { required: true, note, meets: caster, reason: caster ? '' : 'Needs a spellcaster' };
  }
  const named = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'].filter((c) => low.includes(c));
  if (named.some((c) => classes.includes(c))) return { required: true, note, meets: true, reason: '' };
  const sp = String(speciesName || '').toLowerCase();
  if (sp && low.includes(sp)) return { required: true, note, meets: true, reason: '' };
  if (named.length) return { required: true, note, meets: false, reason: `Attunement ${note}` };
  return { required: true, note, meets: null, reason: '' };
}

/**
 * A spell against this character: {known, prepared, always, innate, casters:[{class, name, onList, castable, maxLevel}],
 * onAnyList, castable, noCaster}
 */
export function spellFit(record, sheet) {
  const known = (Array.isArray(sheet?.spells) ? sheet.spells : []).filter((x) => x.id === record?.id);
  const casters = (Array.isArray(sheet?.spellcasting) ? sheet.spellcasting : []).map((sc) => {
    const onList = onCasterList(record, sc);
    const lvl = Number(record?.level) || 0;
    return { class: sc.class, name: sc.name || cap(sc.class), onList, castable: onList && (lvl === 0 || lvl <= (Number(sc.maxSpellLevel) || 0)), maxLevel: Number(sc.maxSpellLevel) || 0 };
  });
  return {
    known: known.length > 0, prepared: known.some((x) => x.prepared || x.always || Number(x.level) === 0), always: known.some((x) => x.always),
    innate: known.some((x) => x.innate), casters, onAnyList: casters.some((x) => x.onList), castable: casters.some((x) => x.castable),
    noCaster: !casters.length,
  };
}

const badge = (label, tone, title = '') => ({ label, tone, title });
const line = (text, tone = 'info') => ({ text, tone });

/**
 * Labels for one compendium entry seen from `sheet`:
 *   opts.base         resolved base weapon/armor record of a magic item (inventory `custom.base` / itemStats)
 *   opts.speciesName  for species-limited attunement
 * -> {badges:[{label, tone:'ok'|'warn'|'info'|'muted', title}], lines:[{text, tone}]}  (empty when nothing applies)
 */
export function entryFit(entry, sheet, { base = null, speciesName = '' } = {}) {
  const out = { badges: [], lines: [] };
  if (!entry || !sheet) return out;
  const pb = Number(sheet.profBonus) || 2;
  const kind = entry.kind;
  const weapon = (w, label = w?.name) => {
    const f = weaponFit(w, sheet);
    if (f.proficient) {
      out.badges.push(badge('Proficient', 'ok', `Proficient (${f.via})`));
      out.lines.push(line(`Proficient (${f.via}): add your Proficiency Bonus (${fmtMod(pb)}) to attack rolls.`, 'ok'));
    } else {
      out.badges.push(badge('Not proficient', 'warn', `Not proficient with ${f.category ? `${cap(f.category)} weapons` : label}`));
      out.lines.push(line(`Not proficient with ${label}${f.category ? ` (${cap(f.category)} weapon)` : ''}: no Proficiency Bonus to its attack rolls, and its mastery property can’t be used.`, 'warn'));
    }
    if (f.mastery) out.badges.push(badge(`Mastery: ${f.mastery.name}`, 'info', 'You can use this weapon’s mastery property'));
  };
  const armor = (a, label = a?.name) => {
    const f = armorFit(a, sheet);
    const what = f.training === 'shields' ? 'Shield' : `${cap(f.training)} armor`;
    if (f.proficient) {
      out.badges.push(badge('Trained', 'ok', `${what} training`));
      out.lines.push(line(`You have ${what} training.`, 'ok'));
    } else {
      out.badges.push(badge('No training', 'warn', `No ${what} training`));
      out.lines.push(line(`No ${what} training: while you wear ${label}, ${NO_ARMOR_TRAINING}.`, 'warn'));
    }
    if (f.strShort) out.lines.push(line(`Needs Strength ${f.strShort}: your Speed drops by 10 feet while you wear it.`, 'warn'));
    if (f.stealth) out.lines.push(line('Disadvantage on Dexterity (Stealth) checks while worn.', 'info'));
  };
  if (kind === 'weapon') weapon(entry);
  else if (kind === 'armor') armor(entry);
  else if (kind === 'gear') {
    const t = toolFit(entry, sheet);
    if (t) {
      if (t.proficient) {
        out.badges.push(badge('Proficient', 'ok', 'Tool proficiency'));
        out.lines.push(line(`Proficient: add your Proficiency Bonus (${fmtMod(pb)}) to ability checks made with it.`, 'ok'));
      } else {
        out.badges.push(badge('Not proficient', 'warn', 'No proficiency with this tool'));
        out.lines.push(line('Not proficient: you don’t add your Proficiency Bonus to ability checks made with it.', 'warn'));
      }
    }
    const foci = focusFor(entry, sheet);
    if (foci.length) {
      out.badges.push(badge('Focus', 'info', `Spellcasting focus for your ${foci.join(' and ')} spells`));
      out.lines.push(line(`You can use it as a spellcasting focus for your ${foci.join(' and ')} spells.`, 'info'));
    }
  } else if (kind === 'magic-item') {
    if (base?.kind === 'weapon' || (base && base.damage)) weapon(base, `${base.name}`);
    else if (base?.kind === 'armor' || (base && base.ac)) armor(base, `${base.name}`);
    else if (entry.category === 'weapon' || entry.category === 'armor') {
      out.lines.push(line(`Uses your proficiency with the ${entry.category === 'weapon' ? 'weapon' : 'armor'} it is made from${entry.type ? ` (${entry.type})` : ''}.`, 'info'));
    }
    const at = attunementFit(entry, sheet, { speciesName });
    if (at.required && at.meets === false) {
      out.badges.push(badge('Can’t attune', 'warn', `Requires attunement ${at.note}`));
      out.lines.push(line(`Requires attunement ${at.note}: your character doesn’t qualify.`, 'warn'));
    } else if (at.required) {
      out.badges.push(badge('Attunement', 'muted', `Requires attunement${at.note ? ` ${at.note}` : ''}`));
      if (at.note && at.meets) out.lines.push(line(`Requires attunement ${at.note}: you qualify.`, 'ok'));
    }
  } else if (kind === 'spell') {
    const f = spellFit(entry, sheet);
    const lvl = Number(entry.level) || 0;
    if (f.always) out.badges.push(badge('Always prepared', 'ok'));
    else if (f.known && f.prepared) out.badges.push(badge(lvl ? 'Prepared' : 'Known', 'ok'));
    else if (f.known) out.badges.push(badge('In spellbook', 'info', 'Known but not prepared'));
    if (f.noCaster && !f.known) {
      out.badges.push(badge('No spellcasting', 'warn'));
      out.lines.push(line('Your character has no spellcasting class; adding it is allowed (marked off-list).', 'warn'));
    } else if (!f.onAnyList && !f.innate) {
      out.badges.push(badge('Off-list', 'warn', `Not on the ${f.casters.map((x) => x.name).join(' or ')} spell list`));
      out.lines.push(line(`Not on your spell list${f.casters.length > 1 ? 's' : ''} (${f.casters.map((x) => x.name).join(', ')}). Adding it is allowed; it gets an off-list mark.`, 'warn'));
    } else if (!f.castable && !f.innate) {
      const best = Math.max(0, ...f.casters.filter((x) => x.onList).map((x) => x.maxLevel));
      out.badges.push(badge('Too high', 'warn', `Level ${lvl}; you can cast up to level ${best}`));
      out.lines.push(line(`On your ${f.casters.filter((x) => x.onList).map((x) => x.name).join(' / ')} list, but level ${lvl} is above the highest level you can cast (${best || 'none yet'}).`, 'warn'));
    } else if (f.castable) {
      const who = f.casters.filter((x) => x.castable).map((x) => x.name);
      out.lines.push(line(`On your ${who.join(' / ')} spell list${lvl ? ' and you can cast it' : ''}.`, 'ok'));
    }
  } else if (kind === 'feat') {
    const has = (Array.isArray(sheet.features) ? sheet.features : []).some((x) => x.id === entry.id && (x.sourceType === 'feat' || x.source === 'Feat'));
    if (has) out.badges.push(badge('Taken', 'ok'));
    let why = null;
    try { why = featPrereqReason(entry, { totalLevel: Number(sheet.totalLevel) || 0, grants: (sheet.features || []).map((x) => ({ sourceType: x.sourceType, name: x.name })) }, sheet); } catch { why = null; }
    if (why && !has) {
      out.badges.push(badge('Prerequisite', 'warn', why));
      out.lines.push(line(`${why}.`, 'warn'));
    }
  }
  return out;
}
