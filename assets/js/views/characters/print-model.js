// Character printouts (pure, no DOM; node tools/test_print.mjs): what each PDF shows, as plain data for print-pdf.js.
//   major  "Major points": who the character is and the numbers that rarely change (AC, initiative, speed,
//          proficiency, HP maximum, hit dice, abilities, saves, skills, senses, proficiencies, attacks, spellcasting
//          numbers with spell names, features by name). No inventory, coins, current HP, used slots or rules text: the
//          Paper Companion view keeps those. print.js derives it without conditions and Exhaustion, so passing states
//          don't end up on paper.
//   full   "Detailed sheet": the same plus how things stand now (HP, hit dice left, death saves, conditions, exhaustion,
//          inspiration, XP, slots and feature uses left), a spell table, the inventory with each item's key stats, and
//          coins. One short line per entry; never a description.
// Also the header's vision words (visionOf), shared with sheet.js.
import { spellStats, shortCastingTime, shortRange } from './engine-spells.js';

export const PRINT_KINDS = [
  { id: 'major', label: 'Major points', file: 'Major points', hint: 'Name, portrait and the stats that rarely change. Track HP, spell slots, items and coins in the Paper Companion view.' },
  { id: 'full', label: 'Detailed sheet', file: 'Character sheet', hint: 'The whole sheet as it stands now, with inventory, coins, HP and spell slots. Short lines, no long descriptions.' },
];

/** How far normal sight reaches: outdoors on a clear day, until something blocks the view (rain ~1 mile, fog 100–300 ft). */
export const NORMAL_SIGHT = '2 mi';
export const NORMAL_SIGHT_NOTE = 'Normal sight, no special senses: outdoors on a clear day you can see about 2 miles until something blocks the view (about 1 mile in rain, 100–300 ft in fog). In darkness you need light.';

/** Vision for the header: other senses (blindsight, truesight…) or "Normal", and the best darkvision range or null. */
export function visionOf(s) {
  const list = s?.sensesList || [];
  const ranges = list.map((x) => /darkvision\D*(\d+)/i.exec(x)).filter(Boolean).map((m) => Number(m[1]));
  const dark = Math.max(Number(s?.darkvision) || 0, ...ranges, 0) || null;
  const other = list.filter((x) => !/darkvision/i.test(x)).map((x) => x.replace(/\.$/, ''));
  return { dark, vision: other.length ? other.join(', ') : 'Normal' };
}

const ABILITY_LIST = [['str', 'STR', 'Strength'], ['dex', 'DEX', 'Dexterity'], ['con', 'CON', 'Constitution'],
  ['int', 'INT', 'Intelligence'], ['wis', 'WIS', 'Wisdom'], ['cha', 'CHA', 'Charisma']].map(([id, name, full]) => ({ id, name, full }));
const COINS = [{ id: 'cp', name: 'Copper', gp: 0.01 }, { id: 'sp', name: 'Silver', gp: 0.1 }, { id: 'ep', name: 'Electrum', gp: 0.5 },
  { id: 'gp', name: 'Gold', gp: 1 }, { id: 'pp', name: 'Platinum', gp: 10 }];

const prettify = (id) => String(id ?? '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim();
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const signed = (n) => { const v = num(n); return v >= 0 ? `+${v}` : `−${Math.abs(v)}`; };
export const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const round = (n) => Math.round(n * 100) / 100;
const recharge = (r) => (r === 'short' ? 'Short Rest' : r === 'long' ? 'Long Rest' : r ? prettify(r) : '');

/** Markdown to one plain line: [[target|alias]] -> alias, [[map:Place]] -> Place, no emphasis marks, collapsed spaces. */
export function plain(md, max = 0) {
  let t = String(md || '')
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, (m, x) => x.replace(/^[a-z-]+:/i, '').replace(/#.*/, ''))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~|`)/g, '').replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return t;
}

/** Group of a feature in the list (as on the sheet): [sort key, title]. */
function featureGroup(f, L) {
  const st = f.sourceType;
  if ((st === 'class' || st === 'option') && f.classId) return [`1:${f.classId}`, `${L.entryName('class', f.classId)} features`];
  if (st === 'subclass' && f.subclassId) return [`2:${f.subclassId}`, L.entryName('subclass', f.subclassId)];
  if (st === 'species' || st === 'subspecies') return ['3:species', 'Species traits'];
  if (st === 'background' || st === 'origin') return ['4:background', 'Background'];
  if (st === 'feat' || f.source === 'Feat') return ['5:feat', 'Feats'];
  if (st === 'custom' || f.source === 'Custom') return ['6:custom', 'Special abilities'];
  return [`7:${f.source || 'other'}`, f.source || 'Other'];
}

const kindLabel = (e) => (!e ? '' : ({ weapon: `${prettify(e.category)} weapon`, armor: e.category === 'shield' ? 'Shield' : `${prettify(e.category)} armor`,
  gear: prettify(e.category), 'magic-item': `${prettify(e.rarity)} ${prettify(e.category)}`.trim() }[e.kind] || prettify(e.kind)));

/**
 * "1d8 Slashing, two-handed 1d10, 20/60 ft, Finesse, Light" / "AC 14 + Dex (max 2)" / "+1 AC": the key stats of a
 * resolved inventory item (sheet.items). lib: {propertyName(id), masteryName(id)} (also the Paper Companion's items).
 */
export function itemSummary(r, lib = {}) { return itemStatsText(r, { ...DEFAULT_LIB, ...lib }); }

function itemStatsText(r, L) {
  const out = [];
  const w = r?.weapon;
  if (w) {
    out.push(`${w.damage}${r.bonus?.damage ? `${signed(r.bonus.damage)}` : ''} ${prettify(w.damageType)}`.trim());
    if (w.versatile) out.push(`two-handed ${w.versatile}`);
    if (w.range && typeof w.range === 'object' && w.range.normal) out.push(`${w.range.normal}${w.range.long ? `/${w.range.long}` : ''} ft`);
    const props = (w.properties || []).map((p) => L.propertyName(p)).filter(Boolean);
    if (props.length) out.push(props.join(', '));
    if (w.mastery) out.push(`Mastery: ${L.masteryName(w.mastery)}`);
    if (r.bonus?.attack) out.push(`${signed(r.bonus.attack)} to hit`);
  }
  const a = r?.armor;
  if (a) {
    if (a.category === 'shield') out.push(`AC ${signed(a.ac.base + num(r.bonus?.ac))}`);
    else out.push(`AC ${a.ac.base + num(r.bonus?.ac)}${a.ac.dex ? (a.ac.maxDex != null ? ` + Dex (max ${a.ac.maxDex})` : ' + Dex') : ''}`);
    if (a.strMin) out.push(`Str ${a.strMin}`);
    if (a.stealthDisadvantage) out.push('Stealth disadvantage');
  } else if (!w && r?.bonus?.ac) out.push(`${signed(r.bonus.ac)} AC`);
  return out.join(', ');
}

/** The casting numbers behind a spell (its class, or the species / feat group), as on the sheet's spell rows. */
function casterOf(x, s) {
  const sc = x.class ? (s.spellcasting || []).find((y) => y.class === x.class) : null;
  if (sc) return { attack: sc.attack, dc: sc.dc, mod: sc.mod ?? s.abilities?.[sc.ability]?.mod ?? 0 };
  const g = x.innate || !x.class ? (s.innate || []).find((y) => y.key === x.group || (y.spells || []).includes(x.id)) : null;
  if (g && (x.innate || x.always)) return { attack: g.attack, dc: g.dc, mod: s.abilities?.[g.ability]?.mod ?? 0 };
  return null;
}

const DEFAULT_LIB = {
  entryName: (kind, id) => prettify(id), findEntry: () => null, skillList: () => [], profName: (kind, id) => prettify(id),
  conditionName: (id) => prettify(id), masteryName: (id) => prettify(id), propertyName: (id) => prettify(String(id).split(/[ (]/)[0]),
  alignmentName: (id) => prettify(id), detailFields: [], abilities: ABILITY_LIST, currency: COINS,
};

/**
 * The printout of one character. kind 'major' | 'full'; date: when it is printed; link: the sheet's address on the site.
 * lib: {entryName(kind, id), findEntry(kind, id), skillList(), profName(kind, id), conditionName(id), masteryName(id),
 * propertyName(id), alignmentName(id), detailFields, abilities, currency} (characters/bridge.js and data.js in the app).
 */
export function printModel(char, sheet, lib = {}, { kind = 'major', date = new Date(), link = '' } = {}) {
  const L = { ...DEFAULT_LIB, ...lib };
  const c = char || {};
  const s = sheet || {};
  const full = kind === 'full';
  const lvl = num(s.totalLevel);
  const species = c.species?.id ? L.entryName('species', c.species.id) : '';
  const subId = c.species?.subspecies;
  const sub = subId ? ((L.findEntry('species', c.species.id)?.subspecies || []).find((x) => x.id === subId)?.name || prettify(subId)) : '';
  const bg = c.background?.id ? L.entryName('background', c.background.id) : '';
  const align = c.details?.alignment ? L.alignmentName(c.details.alignment) : '';
  const max = num(s.hpMax);
  const cur = c.hp?.current == null ? max : num(c.hp.current);
  const temp = num(c.hp?.temp);
  const hd = s.hitDice || [];
  const v = visionOf(s);
  const speeds = Object.entries(s.speed || {}).filter(([k, x]) => k !== 'walk' && x).map(([k, x]) => `${prettify(k)} ${x} ft`).join(', ');
  const armorSub = [s.armorWorn?.name, s.shield ? (s.shield.name || 'Shield') : ''].filter(Boolean).join(' + ') || 'Unarmored';
  const resByKey = new Map((s.resources || []).map((r) => [r.key, r]));
  const resOf = (f) => (f.uses && typeof f.uses === 'object' && f.uses.key && resByKey.get(f.uses.key)) || (typeof f.uses === 'string' && resByKey.get(f.uses)) || resByKey.get(f.id) || null;
  const usesText = (r) => (num(r?.max) ? `${num(r.max)} / ${recharge(r.recharge) || 'use'}` : '');
  const name = c.name || 'Unnamed';
  const kindInfo = PRINT_KINDS.find((k) => k.id === kind) || PRINT_KINDS[0];
  const dateText = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const core = [
    { label: 'Armor Class', value: String(s.ac?.value ?? 10), sub: armorSub },
    { label: 'Initiative', value: signed(s.initiative) },
    { label: 'Speed', value: `${s.speed?.walk ?? 0} ft`, sub: speeds || null },
    { label: 'Proficiency', value: signed(s.profBonus) },
    full ? { label: 'Hit Points', value: `${cur} / ${max}`, sub: temp ? `+${temp} temporary` : null } : { label: 'Hit Point Max', value: String(max) },
    { label: 'Hit Dice', value: hd.map((x) => `${x.total}d${x.die}`).join(' + ') || '—', sub: full && hd.length ? `${hd.reduce((n, x) => n + x.total - num(x.used), 0)} left` : null },
    { label: 'Passive Perception', value: String(s.passive?.perception ?? 10) },
    { label: 'Darkvision', value: v.dark ? `${v.dark} ft` : 'None', sub: v.vision === 'Normal' ? `Vision normal (${NORMAL_SIGHT})` : v.vision },
  ];

  const abilities = L.abilities.map((a) => {
    const x = s.abilities?.[a.id] || {};
    return { id: a.id, name: a.name, full: a.full, score: num(x.score, 10), mod: signed(x.check ?? x.mod), save: signed(x.save), saveProf: !!x.saveProf };
  });

  const skills = L.skillList().map((sk) => {
    const x = s.skills?.[sk.id] || {};
    return { id: sk.id, name: sk.name, ability: String(x.ability || sk.ability || '').toUpperCase(), bonus: signed(x.bonus), level: x.expertise ? 'expertise' : x.prof ? 'proficient' : x.half ? 'half' : 'none' };
  });

  const passives = [['Perception', s.passive?.perception], ['Insight', s.passive?.insight], ['Investigation', s.passive?.investigation]]
    .map(([label, value]) => ({ label, value: String(value ?? 10) }));

  const names = (items, k) => [...new Set(items || [])].map((id) => L.profName(k, id));
  const resist = [...new Set(s.resistances || [])].map((r) => prettify(typeof r === 'object' ? r.type || r.id : r));
  const resistNote = plain(c.details?.resistances, 160);
  const profs = [
    ['Armor', names(s.proficiencies?.armor, 'armor').join(', ') || 'None'],
    ['Weapons', names(s.proficiencies?.weapons, 'weapons').join(', ') || 'None'],
    ['Tools', names(s.proficiencies?.tools, 'tools').join(', ') || 'None'],
    ['Languages', names(s.languages, 'languages').join(', ') || 'None'],
    ['Resistances', [resist.join(', '), resistNote].filter(Boolean).join('. ') || 'None'],
    ['Senses', [v.dark ? `Darkvision ${v.dark} ft` : '', v.vision === 'Normal' ? `normal sight (about ${NORMAL_SIGHT} outdoors)` : v.vision].filter(Boolean).join(', ')],
    ['Size', s.size || '—'],
  ];

  const attacks = (s.attacks || []).map((a) => {
    const m = a.mastery && typeof a.mastery === 'object' ? a.mastery.name || prettify(a.mastery.id) : a.mastery ? L.masteryName(a.mastery) : '';
    const range = typeof a.range === 'object' && a.range ? `${a.range.normal}${a.range.long ? `/${a.range.long}` : ''} ft` : a.range ? String(a.range) : '';
    const props = (a.properties || []).map((p, i) => a.propertyNames?.[i] || L.propertyName(p));
    const notes = [...props, ...(Array.isArray(a.notes) ? a.notes : a.notes ? [a.notes] : [])];
    return {
      name: a.name, hit: typeof a.bonus === 'number' ? signed(a.bonus) : String(a.bonus ?? ''),
      damage: [`${a.damage || ''} ${prettify(a.damageType || '')}`.trim(), a.versatile ? `two-handed ${a.versatile}` : ''].filter(Boolean).join(', '),
      range, mastery: m, notes: notes.join(', '), proficient: a.proficient !== false,
    };
  });

  // Spellcasting: casters, slots, then every known spell (always-prepared, feat and species ones too)
  const charLevel = lvl || 1;
  const spellList = (Array.isArray(s.spells) ? s.spells : c.spells || []).map((x) => {
    const entry = L.findEntry('spell', x.id) || x.record || null;
    const level = num(x.level ?? entry?.level);
    const st = entry ? spellStats(entry, { charLevel, caster: casterOf(x, s) }) : null;
    const ab = st?.save ? (L.abilities.find((a) => a.id === st.save)?.name || String(st.save).toUpperCase()) : '';
    const hit = !st ? '' : st.attack ? (st.toHit != null ? `${signed(st.toHit)} hit` : 'attack') : st.save ? (st.dc != null ? `DC ${st.dc} ${ab}` : `${ab} save`) : '';
    const effect = !st ? '' : [...(st.damageGroups || []).map((g, gi) => `${gi === 0 && st.count?.count > 1 ? `${st.count.count} × ` : ''}${g.text}`),
      st.heal ? `heals ${st.heal.text}` : ''].filter(Boolean).join(' + ');
    return {
      id: x.id, name: x.name || entry?.name || prettify(x.id), level, ready: !!(x.prepared || x.always || level === 0),
      prepared: !!x.prepared, always: !!x.always, innate: !!x.innate,
      from: x.class ? L.entryName('class', x.class) : x.source || '',
      concentration: !!entry?.concentration, ritual: !!entry?.ritual,
      time: entry?.castingTime ? shortCastingTime(entry.castingTime) : '', range: entry?.range ? shortRange(entry.range) : '', hit, effect,
    };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const slots = (s.slots || []).map((n, i) => ({ level: i + 1, max: num(n), left: Math.max(0, num(n) - num(c.slotsUsed?.[i])) })).filter((x) => x.max);
  const pact = s.pact && num(s.pact.slots) ? { level: num(s.pact.level ?? s.pact.slotLevel), max: num(s.pact.slots), left: Math.max(0, num(s.pact.slots) - num(c.pactUsed)) } : null;
  const casters = [
    ...(s.spellcasting || []).map((sc) => ({
      name: sc.name || L.entryName('class', sc.class), ability: String(sc.ability || '').toUpperCase(), dc: sc.dc, attack: signed(sc.attack),
      counts: [sc.cantrips ? `Cantrips ${sc.cantripCount ?? '?'}/${sc.cantrips}` : '', sc.prepared ? `Prepared ${sc.preparedCount ?? '?'}/${sc.prepared}` : '',
        sc.spellbook ? `Spellbook ${sc.spellbook.count}` : ''].filter(Boolean).join(' · '),
    })),
    ...(s.innate || []).map((g) => ({ name: g.source || 'Innate', ability: String(g.ability || '').toUpperCase(), dc: g.dc, attack: signed(g.attack), counts: '' })),
  ];
  const levels = [...new Set(spellList.map((x) => x.level))];
  const casting = casters.length || spellList.length || slots.length || pact ? {
    casters, slots, pact, spells: spellList,
    lines: levels.map((l) => ({
      label: l === 0 ? 'Cantrips' : `${ordinal(l)} level`,
      names: spellList.filter((x) => x.level === l).map((x) => `${x.name}${x.concentration ? ' (C)' : ''}${x.ritual ? ' (R)' : ''}${x.always ? ' (always)' : ''}`).join(', '),
    })),
  } : null;

  const groups = new Map();
  for (const f of s.features || []) {
    const [k, label] = featureGroup(f, L);
    if (!groups.has(k)) groups.set(k, { title: label, items: [] });
    groups.get(k).items.push({
      name: f.name,
      // uses: the most per rest on Major points; the Detailed sheet lists what is left in its Feature uses table
      note: [f.levels?.length > 1 ? `Lv ${f.levels.join(', ')}` : f.level ? `Lv ${f.level}` : '', f.via ? `via ${f.via}` : '', full ? '' : usesText(resOf(f))].filter(Boolean).join(' · '),
    });
  }
  const features = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => g);

  const model = {
    kind, full, title: kindInfo.label, file: kindInfo.file, name, player: c.player || '',
    line: [lvl ? `Level ${lvl}` : 'Level 0', [species, sub ? `(${sub})` : ''].filter(Boolean).join(' '), s.classLine, bg].filter(Boolean).join(' · '),
    meta: [c.player ? `Player: ${c.player}` : '', align].filter(Boolean).join(' · '),
    date: dateText, link, core, abilities, skills, passives, profs, attacks, casting, features,
    footer: `${name} · ${kindInfo.label} · printed ${dateText}`,
  };
  if (!full) return model;

  // ---- the current state, inventory and coins (Detailed sheet only) ----
  model.state = {
    hp: { current: cur, max, temp },
    deathSaves: { success: num(c.deathSaves?.success), fail: num(c.deathSaves?.fail) },
    hitDice: hd.map((x) => ({ die: x.die, total: x.total, left: Math.max(0, x.total - num(x.used)) })),
    conditions: (c.conditions || []).map((id) => L.conditionName(id)),
    exhaustion: num(c.exhaustion),
    inspiration: !!c.heroicInspiration,
    xp: { now: num(c.xp), next: s.nextLevelXp ?? null },
  };
  model.resources = (s.resources || []).filter((r) => num(r.max)).map((r) => ({
    label: `${r.label}${r.die ? ` (${r.die})` : ''}`, left: Math.max(0, num(r.max) - num(r.used)), max: num(r.max), recharge: recharge(r.recharge),
  }));
  const items = new Map((s.items || []).map((x) => [x.uid, x]));
  const rows = (c.inventory || []).map((it) => {
    const r = items.get(it.uid) || {};
    const e = L.findEntry(it.kind, it.ref);
    const canEquip = ['weapon', 'armor', 'magic-item'].includes(it.kind) || !!it.equipped;
    const canAttune = !!(r.requiresAttunement || e?.attunement || it.custom?.attunement || it.attuned);
    const qty = num(it.qty);
    const weight = r.totalWeight != null ? num(r.totalWeight) : num(it.custom?.weight ?? e?.weight) * qty;
    return {
      name: it.name || e?.name || prettify(it.ref), kind: e ? kindLabel(e) : prettify(it.kind), qty, weight: round(weight),
      equipped: canEquip ? !!it.equipped : null, attuned: canAttune ? !!it.attuned : null, stats: itemStatsText(r, L), notes: plain(it.notes, 90),
    };
  });
  const enc = s.encumbrance || {};
  model.inventory = {
    rows,
    carried: round(num(enc.carried ?? rows.reduce((n, x) => n + x.weight, 0))),
    capacity: num(enc.capacity) || null,
    attuned: (c.inventory || []).filter((i) => i.attuned).length,
  };
  model.coins = L.currency.map((x) => ({ id: x.id.toUpperCase(), name: x.name, value: num(c.currency?.[x.id]) }));
  model.coinsGp = round(L.currency.reduce((n, x) => n + num(c.currency?.[x.id]) * x.gp, 0));
  model.details = [
    ['Species', [species, sub ? `(${sub})` : ''].filter(Boolean).join(' ')], ['Background', bg],
    ...L.detailFields.filter((f) => !f.long).map((f) => [f.label, f.key === 'alignment' ? align : plain(c.details?.[f.key], 80)]),
  ].filter(([, x]) => x);
  return model;
}
