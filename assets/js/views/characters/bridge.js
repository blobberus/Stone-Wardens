// Bridge to the rules engine (./engine.js) and the Compendium API (../compendium/api.js).
// Both are imported dynamically so the Characters tab still opens (with basic values and
// simple pickers) if either module is missing or throws; every call is wrapped.
import { h } from '../../core/dom.js';
import { store } from '../../core/store.js';
import { KINDS, entries, cached, saveCustom, srd } from '../../core/compendium.js';
import { pickFromList, openModal, field, input, select, checkbox, numberInput, markdownEditor, toast } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { clone, abilityMod } from '../../core/util.js';
import { ABILITY_IDS, ABILITIES, SKILLS, blankCharacter, normalize, totalLevel, prettify } from './data.js';

let E = null;
let API = null;
export let engineError = null;
export let apiError = null;

const engineP = import('./engine.js')
  .then((m) => { E = m; return m; })
  .catch((e) => { engineError = e; console.error('[characters] engine.js failed to load — using basic fallback values', e); return null; });
const apiP = import('../compendium/api.js')
  .then((m) => { API = m; return m; })
  .catch((e) => { apiError = e; console.error('[characters] compendium/api.js failed to load — using simple pickers', e); return null; });

export const engine = () => E;
export const hasEngine = () => !!(E && E.derive);

let rulesVal = null;
let srdRules = null;
let readyP = null;
let version = 0;
const readyListeners = new Set();

/** Load engine, compendium API, every catalog and the rules. Resolves the engine's rules object (or null). */
export function ready() {
  if (!readyP) {
    readyP = (async () => {
      await Promise.all([engineP, apiP]);
      await Promise.all(KINDS.map((k) => entries(k.kind).catch(() => [])));
      try { srdRules = await srd('rules'); } catch (e) { console.warn('[characters] rules.json unavailable', e); srdRules = {}; }
      if (E?.loadRules) {
        try { rulesVal = await E.loadRules({ reload: version > 0 }); } catch (e) { console.error('[characters] loadRules failed', e); engineError = engineError || e; rulesVal = null; }
      }
      version += 1;
      readyListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      return rulesVal;
    })();
  }
  return readyP;
}
export const isReady = () => version > 0 && !!readyP;
export const rules = () => rulesVal;
export const onReady = (fn) => { readyListeners.add(fn); return () => readyListeners.delete(fn); };

/** Custom library entries changed: re-merge catalogs and rules. */
export function invalidate() {
  if (!readyP) return;
  readyP = null;
  if (E?.invalidateRules) { try { E.invalidateRules(); } catch (e) { console.warn(e); } }
  return ready();
}

/** rules.json (skills, languages, conditions, pointBuy…). */
export const R = () => srdRules || {};
export const cat = (kind) => cached(kind);
export const findEntry = (kind, id) => (id ? cached(kind).find((e) => e.id === id) || null : null);
export const entryName = (kind, id) => findEntry(kind, id)?.name || prettify(id);
export const skillList = () => (R().skills?.length ? R().skills : SKILLS);
export const skillName = (id) => skillList().find((s) => s.id === id)?.name || prettify(id);
export const toolList = () => cat('gear').filter((g) => g.tool);
export const languageList = () => R().languages || [];
export const conditionList = () => R().conditions || [];
export const damageTypes = () => R().damageTypes || [];
export const masteryInfo = (id) => (R().weaponMasteries || []).find((m) => m.id === id) || null;
export const propertyInfo = (id) => (R().weaponProperties || []).find((m) => m.id === String(id).split(/[ (]/)[0]) || null;
export const languageName = (id) => languageList().find((l) => l.id === id)?.name || prettify(id);
export function profName(kind, id) {
  if (kind === 'skills' || kind === 'expertise') return skillName(id);
  if (kind === 'saves') return ABILITIES.find((a) => a.id === id)?.full || prettify(id);
  if (kind === 'languages') return languageName(id);
  if (kind === 'tools') return entryName('gear', id);
  if (kind === 'weapons') return findEntry('weapon', id)?.name || ({ simple: 'Simple weapons', martial: 'Martial weapons', improvised: 'Improvised weapons' }[id] || prettify(id));
  if (kind === 'armor') return ({ light: 'Light armor', medium: 'Medium armor', heavy: 'Heavy armor', shields: 'Shields', shield: 'Shields' }[id] || entryName('armor', id));
  return prettify(id);
}

// ---------- engine wrappers ----------

export function newCharacter({ name = '', player = '' } = {}) {
  let doc = blankCharacter({ name, player });
  if (E?.newCharacter) {
    try { doc = { ...doc, ...E.newCharacter({ name, player }) }; } catch (e) { console.error(e); }
  }
  return normalize(doc);
}

/** derive() that never throws and always returns a complete Sheet. */
export function derive(char) {
  let sheet = null;
  if (E?.derive && rulesVal) {
    try { sheet = E.derive(char, rulesVal); } catch (e) { console.error('[characters] derive failed', e); }
  }
  if (!sheet) sheet = fallbackDerive(char);
  return completeSheet(sheet, char);
}

/** Every Choice for the character (answered ones carry `value`). Pass the derived sheet to skip a recompute. */
export function allChoices(char, sheet) {
  if (sheet && Array.isArray(sheet.choices) && hasEngine() && rulesVal) return sheet.choices;
  if (E?.choicesFor && rulesVal) {
    try { return E.choicesFor(char, rulesVal) || []; } catch (e) { console.error('[characters] choicesFor failed', e); }
  }
  return pendingChoices(char, sheet);
}

/** Unanswered choices. */
export function pendingChoices(char, sheet) {
  if (sheet && Array.isArray(sheet.pending) && hasEngine() && rulesVal) return sheet.pending;
  if (E?.validateChoices && rulesVal) {
    try { return E.validateChoices(char, rulesVal) || []; } catch (e) { console.error('[characters] validateChoices failed', e); }
  }
  return (sheet || derive(char)).pending || [];
}

const SUBCLASS_RE = /^[^/>]*subclass@([^:/>]+):\d+$/;
const CLASS_SKILLS_RE = /^class-skills@([^:/>]+):1$/;
const isEmptyVal = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** Store a choice value IN PLACE on `char` (mirrors subclass / subspecies / size / background bonuses / class skills). */
export function storeChoice(char, key, value) {
  if (E?.setChoice) {
    try { Object.assign(char, E.setChoice(char, key, value)); return char; } catch (e) { console.error('[characters] setChoice failed', e); }
  }
  const empty = isEmptyVal(value);
  char.choices = { ...(char.choices || {}) };
  if (empty) delete char.choices[key]; else char.choices[key] = clone(value);
  if (key === 'species:subspecies') char.species = { ...char.species, subspecies: empty ? null : value };
  else if (key === 'species:size') char.species = { ...char.species, size: empty ? null : value };
  else if (key === 'background:abilities') char.background = { ...char.background, abilityBonuses: empty ? {} : clone(value) };
  else {
    let m = CLASS_SKILLS_RE.exec(key);
    if (m && char.classes?.[0]?.id === m[1]) char.skills = empty ? [] : asArr(value);
    m = SUBCLASS_RE.exec(key);
    if (m) char.classes = (char.classes || []).map((r) => (r.id === m[1] ? { ...r, subclass: empty ? null : asArr(value)[0] ?? null } : r));
  }
  return char;
}

/** Current value of a Choice for `char` (reads mirrored doc fields too). */
export function choiceValue(char, choice) {
  if (E?.getChoiceValue) {
    try { const v = E.getChoiceValue(char, choice.key); if (v !== undefined) return v; } catch (e) { console.error(e); }
  } else {
    const v = char?.choices?.[choice.key];
    if (v !== undefined) return v;
  }
  return choice.value;
}

export function levelUpPlan(char, classId) {
  if (E?.levelUpPlan && rulesVal) {
    try { return completePlan(E.levelUpPlan(char, rulesVal, classId), char, classId); } catch (e) { console.error('[characters] levelUpPlan failed', e); }
  }
  return completePlan(null, char, classId);
}

/** Throws (with a readable message) when the engine refuses the level (prerequisites, level 20). */
export function applyLevelUp(char, classId, opts = {}) {
  if (E?.applyLevelUp && rulesVal) return normalize(E.applyLevelUp(clone(char), rulesVal, classId, opts));
  // Fallback: append a level with the given HP and merge choices.
  const c = clone(char);
  const cls = findEntry('class', classId);
  let row = c.classes.find((x) => x.id === classId);
  if (!row) { row = { id: classId, level: 0, subclass: null, hp: [] }; c.classes.push(row); }
  row.level += 1;
  const die = cls?.hitDie || 8;
  row.hp.push(totalLevel(char) === 0 ? die : Number(opts.hpRoll) || Math.floor(die / 2) + 1);
  Object.assign(c.choices, opts.choices || {});
  return normalize(c);
}

/** Remove the last level of a class (and that level's choices). */
export function levelDown(char, classId) {
  if (E?.levelDown && rulesVal) {
    try { return normalize(E.levelDown(clone(char), rulesVal, classId)); } catch (e) { console.error('[characters] levelDown failed', e); }
  }
  const c = clone(char);
  const row = c.classes.find((r) => r.id === classId);
  if (!row) return c;
  const L = row.level;
  const re = new RegExp(`@${classId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${L}(?![0-9])`);
  for (const k of Object.keys(c.choices)) if (re.test(k)) delete c.choices[k];
  if (L <= 1) c.classes = c.classes.filter((r) => r.id !== classId);
  else { row.level = L - 1; row.hp = (row.hp || []).slice(0, L - 1); if (row.level < (findEntry('class', classId)?.subclassLevel || 3)) row.subclass = null; }
  return normalize(c);
}

/** Spells a caster class can take: {list, lists, maxLevel, cantrips, prepared, cantripCount, preparedCount, alwaysPrepared, spells}. */
export function availableSpells(char, classId) {
  if (E?.availableSpells && rulesVal) {
    try { return E.availableSpells(char, rulesVal, classId); } catch (e) { console.error('[characters] availableSpells failed', e); }
  }
  const sheet = derive(char);
  const sc = sheet.spellcasting.find((x) => x.class === classId);
  const list = sc?.list || findEntry('class', classId)?.spellcasting?.list || classId;
  const maxLevel = sc?.maxSpellLevel ?? 1;
  return { classId, list, lists: [list], maxLevel, cantrips: sc?.cantrips ?? 0, prepared: sc?.prepared ?? 0, alwaysPrepared: [], spells: cat('spell').filter((s) => (s.classes || []).includes(list) && (Number(s.level) || 0) <= maxLevel) };
}

/** -> {ok, reasons:[string]} */
export function canMulticlass(char, classId) {
  if (E?.canMulticlass && rulesVal) {
    try {
      const r = E.canMulticlass(char, rulesVal, classId);
      if (typeof r === 'boolean') return { ok: r, reasons: r ? [] : ['Ability score prerequisites not met.'] };
      if (r && typeof r === 'object') {
        const ok = r.ok ?? r.allowed ?? r.can ?? !(r.reasons?.length || r.missing?.length);
        const reasons = [].concat(r.reasons || r.missing || r.unmet || r.reason || []).map((x) => (typeof x === 'string' ? x : x.text || `${String(x.ability || '').toUpperCase()} ${x.min}+`));
        return { ok: !!ok, reasons };
      }
    } catch (e) { console.error('[characters] canMulticlass failed', e); }
  }
  return fallbackMulticlass(char, classId);
}

export function longRest(char) {
  if (E?.longRest && rulesVal) {
    try { return normalize(E.longRest(clone(char), rulesVal)); } catch (e) { console.error('[characters] longRest failed', e); }
  }
  const c = clone(char);
  const sheet = derive(c);
  c.hp = { current: sheet.hpMax, temp: 0 };
  c.slotsUsed = c.slotsUsed.map(() => 0);
  c.pactUsed = 0;
  c.resourcesUsed = {};
  c.deathSaves = { success: 0, fail: 0 };
  c.exhaustion = Math.max(0, (Number(c.exhaustion) || 0) - 1);
  for (const hd of sheet.hitDice) {
    const regain = Math.max(1, Math.floor(hd.total / 2));
    c.hitDiceUsed[hd.die] = Math.max(0, (Number(c.hitDiceUsed[hd.die]) || 0) - regain);
  }
  return normalize(c);
}

/** opts: {hitDiceSpent: {10: 2}, healed: n} */
export function shortRest(char, opts = {}) {
  let out = null;
  if (E?.shortRest && rulesVal) {
    try { out = normalize(E.shortRest(clone(char), rulesVal, opts)); } catch (e) { console.error('[characters] shortRest failed', e); }
  }
  if (!out) {
    out = clone(char);
    out.pactUsed = 0;
    const sheet = derive(out);
    for (const r of sheet.resources) if (r.recharge === 'short') delete out.resourcesUsed[r.key];
    for (const [die, n] of Object.entries(opts.hitDiceSpent || {})) out.hitDiceUsed[die] = (Number(out.hitDiceUsed[die]) || 0) + Number(n || 0);
    const cur = out.hp.current == null ? sheet.hpMax : Number(out.hp.current);
    out.hp.current = Math.min(sheet.hpMax, cur + (Number(opts.healed) || 0));
    out = normalize(out);
  }
  return out;
}

// ---------- sheet completion & fallbacks ----------

const asArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function completeSheet(s, char) {
  const sheet = { ...s };
  sheet.totalLevel = sheet.totalLevel ?? totalLevel(char);
  sheet.profBonus = Number(sheet.profBonus ?? 2);
  sheet.abilities = { ...(sheet.abilities || {}) };
  for (const id of ABILITY_IDS) {
    const a = sheet.abilities[id] || {};
    const score = Number(a.score ?? char.baseAbilities?.[id] ?? 10);
    const mod = Number(a.mod ?? abilityMod(score));
    sheet.abilities[id] = { score, mod, save: Number(a.save ?? mod), saveProf: !!a.saveProf, ...a };
  }
  sheet.skills = { ...(sheet.skills || {}) };
  for (const sk of skillList()) {
    const x = sheet.skills[sk.id] || {};
    sheet.skills[sk.id] = { ability: sk.ability, prof: false, expertise: false, bonus: sheet.abilities[x.ability || sk.ability]?.mod ?? 0, ...x };
  }
  const per = sheet.skills.perception?.bonus ?? 0;
  sheet.passive = { perception: 10 + per, insight: 10 + (sheet.skills.insight?.bonus ?? 0), investigation: 10 + (sheet.skills.investigation?.bonus ?? 0), ...(sheet.passive || {}) };
  sheet.ac = typeof sheet.ac === 'number' ? { value: sheet.ac, formula: '' } : { value: 10, formula: '', ...(sheet.ac || {}) };
  sheet.initiative = Number(sheet.initiative ?? sheet.abilities.dex.mod);
  sheet.speed = typeof sheet.speed === 'number' ? { walk: sheet.speed } : { walk: 30, ...(sheet.speed || {}) };
  sheet.hpMax = Math.max(0, Number(sheet.hpMax ?? 0));
  for (const k of ['hitDice', 'languages', 'resistances', 'features', 'resources', 'spellcasting', 'attacks', 'pending', 'warnings']) sheet[k] = asArr(sheet[k]);
  sheet.proficiencies = { armor: [], weapons: [], tools: [], ...(sheet.proficiencies || {}) };
  sheet.slots = Array.from({ length: 9 }, (_, i) => Number(sheet.slots?.[i]) || 0);
  sheet.pact = sheet.pact && sheet.pact.slots ? sheet.pact : null;
  sheet.encumbrance = { carried: 0, capacity: sheet.abilities.str.score * 15, ...(sheet.encumbrance || {}) };
  sheet.classLine = sheet.classLine || classLine(char);
  return sheet;
}

export function classLine(char) {
  return (char.classes || []).map((c) => {
    const sub = c.subclass ? findEntry('subclass', c.subclass)?.name || prettify(c.subclass) : '';
    return `${entryName('class', c.id)} ${c.level}${sub ? ` (${sub})` : ''}`;
  }).join(' / ');
}

function fallbackDerive(char) {
  const rr = R();
  const lvl = totalLevel(char);
  const prof = Number(char.overrides?.profBonus ?? rr.profBonusByLevel?.[Math.max(1, lvl) - 1] ?? (2 + Math.floor((Math.max(lvl, 1) - 1) / 4)));
  const first = findEntry('class', char.classes[0]?.id);
  const saveProfs = new Set([...(first?.saves || []), ...char.extraProficiencies.saves]);
  const abilities = {};
  for (const id of ABILITY_IDS) {
    const score = Number(char.overrides?.abilities?.[id] ?? ((Number(char.baseAbilities[id]) || 10) + (Number(char.background.abilityBonuses?.[id]) || 0)));
    const mod = abilityMod(score);
    const saveProf = saveProfs.has(id);
    abilities[id] = { score, mod, saveProf, save: mod + (saveProf ? prof : 0) + (Number(char.overrides?.saves?.[id]) || 0) };
  }
  const bg = findEntry('background', char.background.id);
  const profSkills = new Set([...char.skills, ...(bg?.skills || []), ...char.extraProficiencies.skills]);
  const expertise = new Set(char.extraProficiencies.expertise);
  const skills = {};
  for (const sk of skillList()) {
    const p = profSkills.has(sk.id);
    const ex = expertise.has(sk.id);
    skills[sk.id] = { ability: sk.ability, prof: p, expertise: ex, bonus: abilities[sk.ability].mod + (ex ? prof * 2 : p ? prof : 0) + (Number(char.overrides?.skills?.[sk.id]) || 0) };
  }
  const con = abilities.con.mod;
  let hpMax = 0;
  char.classes.forEach((c) => (c.hp || []).forEach((v) => { hpMax += Math.max(1, (Number(v) || 0) + con); }));
  const species = findEntry('species', char.species.id);
  const hitDice = char.classes.map((c) => {
    const die = findEntry('class', c.id)?.hitDie || 8;
    return { die, total: c.level, used: Number(char.hitDiceUsed[die]) || 0 };
  });
  const carried = char.inventory.reduce((n, it) => n + (Number(findEntry(it.kind, it.ref)?.weight) || 0) * (Number(it.qty) || 1), 0);
  return {
    totalLevel: lvl, profBonus: prof, abilities, skills,
    ac: { value: Number(char.overrides?.ac ?? 10 + abilities.dex.mod), formula: '10 + DEX' },
    initiative: Number(char.overrides?.initiative ?? abilities.dex.mod),
    speed: { walk: Number(char.overrides?.speed ?? species?.speed ?? 30) },
    hpMax: Number(char.overrides?.hpMax ?? hpMax),
    hitDice, size: char.species.size || species?.size || 'Medium', senses: species?.darkvision ? `Darkvision ${species.darkvision} ft.` : '',
    languages: char.extraProficiencies.languages, resistances: [],
    proficiencies: { armor: [...(first?.proficiencies?.armor || []), ...char.extraProficiencies.armor], weapons: [...(first?.proficiencies?.weapons || []), ...char.extraProficiencies.weapons], tools: char.extraProficiencies.tools },
    features: [], resources: [], spellcasting: [], slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], pact: null, attacks: [],
    encumbrance: { carried, capacity: abilities.str.score * 15 },
    pending: [],
    warnings: [hasEngine() ? 'The rules engine could not compute this sheet; showing basic values.' : 'Rules engine not loaded; showing basic values only.'],
  };
}

function completePlan(p, char, classId) {
  const cls = findEntry('class', classId);
  const row = char.classes.find((c) => c.id === classId);
  const newLevel = (row?.level || 0) + 1;
  const die = cls?.hitDie || 8;
  const base = {
    newLevel, hitDie: die, hpAverage: Math.floor(die / 2) + 1, features: [], choices: [],
    slotsBefore: derive(char).slots, slotsAfter: null, newCantrips: 0, newPrepared: 0,
  };
  if (!p) {
    const lvl = cls?.levels?.[newLevel - 1];
    base.features = (lvl?.features || []).map((id) => ({ id, name: prettify(id.replace(`${classId}-`, '')), description: '' }));
  }
  const out = { ...base, ...(p || {}) };
  out.features = asArr(out.features);
  out.choices = asArr(out.choices);
  return out;
}

function fallbackMulticlass(char, classId) {
  const reasons = [];
  const sheet = derive(char);
  const check = (cls) => {
    const pre = cls?.multiclass?.prereq;
    if (!pre) return;
    const test = (r) => (sheet.abilities[r.ability]?.score ?? 0) >= r.min;
    if (pre.all && !pre.all.every(test)) reasons.push(`${cls.name}: ${pre.all.map((r) => `${r.ability.toUpperCase()} ${r.min}`).join(' and ')}`);
    if (pre.any && !pre.any.some(test)) reasons.push(`${cls.name}: ${pre.any.map((r) => `${r.ability.toUpperCase()} ${r.min}`).join(' or ')}`);
  };
  check(findEntry('class', classId));
  char.classes.forEach((c) => check(findEntry('class', c.id)));
  return { ok: !reasons.length, reasons };
}

// ---------- Compendium API wrappers (with simple fallbacks) ----------

const KIND_ONE = Object.fromEntries(KINDS.map((k) => [k.kind, k.one]));

export function entrySubtitle(e) {
  if (!e) return '';
  const bits = [];
  if (e.kind === 'weapon') bits.push(`${prettify(e.category)} ${e.weaponKind || (e.range && !e.thrown ? 'ranged' : 'melee')}`.trim(), [e.damage, e.damageType].filter(Boolean).join(' '));
  else if (e.kind === 'armor') bits.push(prettify(e.category), e.ac ? `AC ${e.ac.base}${e.ac.dex ? (e.ac.maxDex ? ` + DEX (max ${e.ac.maxDex})` : ' + DEX') : ''}` : '');
  else if (e.kind === 'spell') bits.push(e.level ? `Level ${e.level} ${prettify(e.school)}` : `${prettify(e.school)} cantrip`);
  else if (e.kind === 'magic-item') bits.push(prettify(e.rarity), e.attunement ? 'attunement' : '');
  else if (e.kind === 'feat') bits.push(`${prettify(e.category)} feat`, e.prerequisite || '');
  else if (e.category) bits.push(prettify(e.category));
  else bits.push(KIND_ONE[e.kind] || '');
  if (e.origin === 'stub') bits.push(e.source || 'stub');
  if (e.origin === 'custom') bits.push('custom');
  return bits.filter(Boolean).join(' · ');
}

/** openPicker(kinds, {title, filter(entry)->bool, multi}) */
export async function openPicker(kinds, opts = {}) {
  await apiP;
  if (API?.openPicker) {
    try { return await API.openPicker(kinds, opts); } catch (e) { console.error('[characters] openPicker failed, using fallback', e); }
  }
  const ks = asArr(kinds);
  const lists = await Promise.all(ks.map((k) => entries(k).catch(() => [])));
  let items = lists.flat();
  if (typeof opts.filter === 'function') items = items.filter(opts.filter);
  return pickFromList({
    title: opts.title || `Choose ${ks.map((k) => KIND_ONE[k] || k).join(' / ')}`,
    items, multi: !!opts.multi,
    render: (e) => h('div', { class: 'picker-item-main' }, h('span', { class: 'picker-item-title' }, e.name), h('small', { class: 'muted' }, entrySubtitle(e))),
    search: (e) => `${e.name} ${e.category || ''} ${e.school || ''} ${e.kind}`,
  });
}

export async function openEntryEditor(kind, entry) {
  await apiP;
  if (API?.openEntryEditor) {
    try { return await API.openEntryEditor(kind, entry); } catch (e) { console.error('[characters] openEntryEditor failed, using fallback', e); }
  }
  return fallbackEntryEditor(kind, entry);
}

export function renderEntry(entry) {
  if (API?.renderEntry) {
    try { const n = API.renderEntry(entry); if (n) return n; } catch (e) { console.error('[characters] renderEntry failed', e); }
  }
  const box = h('div', { class: 'ch-entry' }, h('p', { class: 'muted ui' }, entrySubtitle(entry)));
  const body = h('div', { class: 'prose' });
  renderInto(body, [entry?.description, entry?.higherLevel ? `**At higher levels.** ${entry.higherLevel}` : ''].filter(Boolean).join('\n\n') || '*No description.*');
  box.append(body);
  return box;
}

/** "AC +1, Speed +5 ft." (the Compendium returns a list; joined here). */
export const modifiersSummary = (m) => {
  if (API?.modifiersSummary) {
    try { const r = API.modifiersSummary(m); return Array.isArray(r) ? r.join(', ') : String(r || ''); } catch { /* fall through */ }
  }
  return describeModifiers(m);
};

/** "AC +1, Speed +5, STR +2, Stealth +1" */
export function describeModifiers(m) {
  if (!m || typeof m !== 'object') return '';
  const out = [];
  const fmt = (n) => (Number(n) >= 0 ? `+${Number(n)}` : `−${Math.abs(Number(n))}`);
  const labels = { ac: 'AC', speed: 'Speed', initiative: 'Initiative', hpPerLevel: 'HP/level', hpMax: 'HP max', profBonus: 'Prof.', attack: 'Attack', damage: 'Damage', spellDc: 'Spell DC', spellAttack: 'Spell attack' };
  for (const [k, label] of Object.entries(labels)) if (Number(m[k])) out.push(`${label} ${fmt(m[k])}`);
  for (const [a, v] of Object.entries(m.abilities || {})) if (Number(v)) out.push(`${a.toUpperCase()} ${fmt(v)}`);
  for (const [a, v] of Object.entries(m.saves || {})) if (Number(v)) out.push(`${a === 'all' ? 'All saves' : `${a.toUpperCase()} save`} ${fmt(v)}`);
  for (const [s, v] of Object.entries(m.skills || {})) if (Number(v)) out.push(`${s === 'all' ? 'All skills' : skillName(s)} ${fmt(v)}`);
  if (m.resistances?.length) out.push(`Resist ${m.resistances.join(', ')}`);
  if (m.senses) out.push(m.senses);
  return out.join(', ');
}

// Simple custom-entry editor used only when compendium/api.js is unavailable.
const FALLBACK_FIELDS = {
  weapon: [['category', 'Category', ['simple', 'martial']], ['damage', 'Damage dice'], ['damageType', 'Damage type'], ['versatile', 'Versatile dice'], ['properties', 'Properties (comma separated)', 'list'], ['mastery', 'Mastery'], ['weight', 'Weight (lb)', 'number']],
  armor: [['category', 'Category', ['light', 'medium', 'heavy', 'shield']], ['acBase', 'Base AC', 'number'], ['weight', 'Weight (lb)', 'number']],
  gear: [['category', 'Category'], ['weight', 'Weight (lb)', 'number']],
  'magic-item': [['category', 'Category'], ['rarity', 'Rarity', ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact']], ['attunement', 'Requires attunement', 'bool']],
  ability: [['uses', 'Uses', 'number'], ['recharge', 'Recharge', ['', 'short', 'long']]],
};

function fallbackEntryEditor(kind, entry) {
  return new Promise((resolve) => {
    const data = clone(entry) || { name: '', description: '' };
    let result = null;
    const nameIn = input({ value: data.name || '', placeholder: 'Name', autofocus: true });
    const desc = markdownEditor({ value: data.description || '', rows: 6 });
    const controls = (FALLBACK_FIELDS[kind] || []).map(([key, label, type]) => {
      const cur = key === 'acBase' ? data.ac?.base : data[key];
      let ctl;
      if (Array.isArray(type)) ctl = select(type.map((v) => ({ value: v, label: v ? prettify(v) : '—' })), cur ?? type[0], (v) => { data[key] = v; });
      else if (type === 'number') ctl = numberInput(cur, (v) => { if (key === 'acBase') data.ac = { base: v, dex: data.category === 'light' || data.category === 'medium', maxDex: data.category === 'medium' ? 2 : null }; else data[key] = v; });
      else if (type === 'bool') ctl = checkbox(cur, (v) => { data[key] = v; }, label);
      else ctl = input({ value: type === 'list' ? (cur || []).join(', ') : cur || '', onchange: (e) => { data[key] = type === 'list' ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : e.target.value; } });
      if (Array.isArray(type) && cur == null) data[key] = type[0];
      return type === 'bool' ? ctl : field(label, ctl);
    });
    openModal({
      title: `${entry ? 'Edit' : 'New'} custom ${KIND_ONE[kind] || kind}`,
      wide: true,
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted ui text-sm' }, 'Saved to the shared library in the repository so every Warden can use it.'),
        field('Name', nameIn), h('div', { class: 'field-grid' }, controls), field('Description', desc)),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save to library', kind: 'primary',
          onClick: () => {
            const name = nameIn.value.trim();
            if (!name) { toast('Give it a name first.', { type: 'error' }); return false; }
            result = saveCustom(kind, { ...data, name, description: desc.value });
            return true;
          },
        },
      ],
      onClose: () => resolve(result),
    });
  });
}

// Keep catalogs/rules in sync with custom library edits made anywhere on the site.
store.on((ev) => {
  const paths = ev.path ? [ev.path] : ev.paths || [];
  if (paths.some((p) => p.startsWith('content/library/'))) invalidate();
});
