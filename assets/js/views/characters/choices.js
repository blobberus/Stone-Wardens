// Generic renderer for engine Choice objects ({key, featureId, label, type, count, options, value}).
// Every SRD choice type is handled; values are written to char.choices[choice.key] through
// ctx.mutate(fn) so the caller re-derives and re-renders.
import { h } from '../../core/dom.js';
import { icon, pickFromList, select, input } from '../../core/ui.js';
import { renderInline } from '../../core/markdown.js';
import {
  cat, findEntry, entryName, skillList, skillName, toolList, languageList, languageName, damageTypes, entrySubtitle,
  storeChoice, choiceValue,
} from './bridge.js';
import { ABILITIES, ABILITY_IDS, abilityName, prettify, totalLevel } from './data.js';
import { md, entryModal } from './widgets.js';

// ---------- value encoding (single place to adapt to the engine) ----------

export const LIST_TYPES = new Set(['skills', 'expertise', 'tools', 'skills-or-tools', 'languages', 'weapon-mastery', 'spells', 'wild-shape-forms']);
export const INFO_TYPES = new Set(['spellcasting']);

/** Any stored value -> array of picked ids. */
export function readIds(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '').map((x) => (typeof x === 'object' ? x.id ?? x.value : x));
  if (typeof v === 'object') {
    if (v.id) return [v.id];
    if (v.feat) return [v.feat];
    if (Array.isArray(v.ids)) return v.ids;
    return Object.keys(v).filter((k) => v[k]);
  }
  return [v];
}

export function encode(choice, ids) {
  const clean = ids.filter((x) => x != null && x !== '');
  if (LIST_TYPES.has(choice.type)) return clean;
  if (choice.type === 'options') return countOf(choice) > 1 ? clean : clean[0] ?? null;
  return clean[0] ?? null;
}

export function countOf(choice, sheet) {
  if (choice.countFrom === 'proficiency-bonus' && sheet) return sheet.profBonus;
  const n = Number(choice.count);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function currentValue(choice, char) {
  return choiceValue(char, choice);
}

const pointsOf = (v) => Object.values(v || {}).reduce((s, n) => s + Math.max(0, Number(n) || 0), 0);

export function isAnswered(choice, value) {
  if (INFO_TYPES.has(choice.type)) return true;
  if (choice.type === 'multi') return true;
  if (typeof choice.complete === 'boolean' && JSON.stringify(value ?? null) === JSON.stringify(choice.value ?? null)) return choice.complete;
  if (choice.type === 'asi-or-feat') {
    if (!value || typeof value !== 'object') return false;
    if (value.feat && value.feat !== 'ability-score-improvement') return choice.featAsiPoints ? pointsOf(value.asi) >= choice.featAsiPoints : true;
    return pointsOf(value.asi) >= 2;
  }
  if (choice.type === 'ability-increase') return pointsOf(value) >= Number(choice.points ?? 1);
  const n = readIds(value).length;
  return LIST_TYPES.has(choice.type) || choice.type === 'options' ? n >= countOf(choice) : n > 0;
}

// ---------- key parsing & grouping ----------

/** `${featureId}@${classId}:${level}` (+ /part, >option), `species:${traitId}`, `feat:${featId}`, background… */
export function parseKey(key) {
  const k = String(key || '');
  const m = /^([^@/>]+)@([^:/>]+):(\d+)/.exec(k);
  if (m) return { source: 'class', featureId: m[1], classId: m[2], level: Number(m[3]) };
  const s = /^species:([^/>]+)/.exec(k);
  if (s) return { source: 'species', traitId: s[1] };
  const f = /^feat:([^/>@]+)/.exec(k);
  if (f) return { source: 'feat', featId: f[1] };
  if (/^(background|bg)[:/]/.test(k) || k === 'background') return { source: 'background' };
  return { source: 'other' };
}

const SOURCE_ORDER = { species: 0, subspecies: 0, background: 1, origin: 1.5, class: 2, subclass: 2, option: 2, feat: 3, custom: 4 };

export function groupOf(choice) {
  const p = parseKey(choice.key);
  const st = choice.sourceType;
  if (p.source === 'class' || ((st === 'class' || st === 'subclass') && choice.classId)) {
    const cid = p.classId || choice.classId;
    const lvl = p.level || choice.classLevel || 1;
    return { id: `class:${cid}:${String(lvl).padStart(2, '0')}`, label: choice.source && st !== 'option' ? choice.source : `${entryName('class', cid)} ${lvl}`, order: 2 };
  }
  if (p.source === 'species' || st === 'species' || st === 'subspecies') return { id: 'species', label: 'Species', order: 0 };
  if (p.source === 'background' || st === 'background') return { id: 'background', label: choice.source || 'Background', order: 1 };
  if (st === 'origin' || /^origin:/.test(choice.key)) return { id: 'origin', label: 'Origin', order: 1.5 };
  if (p.source === 'feat' || st === 'feat') return { id: `feat:${p.featId || choice.featKey}`, label: choice.source || `Feat: ${entryName('feat', p.featId)}`, order: 3 };
  return { id: `other:${choice.source || ''}`, label: choice.source || 'Other', order: SOURCE_ORDER[st] ?? 4 };
}

// ---------- option lists per type ----------

function prereqForFeat(feat, ctx) {
  const p = feat.prereq;
  if (!p || typeof p !== 'object') return null;
  const lvl = ctx.sheet?.totalLevel ?? totalLevel(ctx.char);
  if (p.level && lvl < p.level) return `Requires level ${p.level}`;
  const score = (a) => ctx.sheet?.abilities?.[a]?.score ?? 10;
  if (p.abilities?.any && !p.abilities.any.some((r) => score(r.ability) >= r.min)) return feat.prerequisite || 'Ability prerequisite';
  if (p.abilities?.all && !p.abilities.all.every((r) => score(r.ability) >= r.min)) return feat.prerequisite || 'Ability prerequisite';
  if (p.feature && !(ctx.sheet?.features || []).some((f) => String(f.name || '').includes(p.feature))) return `Requires ${p.feature}`;
  if (p.spellcasting && !(ctx.sheet?.spellcasting || []).length) return 'Requires Spellcasting';
  if (p.proficiency === 'medium-armor' && !(ctx.sheet?.proficiencies?.armor || []).includes('medium')) return 'Requires Medium armor training';
  return null;
}

function maxSpellLevel(sheet) {
  let m = 0;
  (sheet?.slots || []).forEach((n, i) => { if (n > 0) m = i + 1; });
  if (sheet?.pact?.level) m = Math.max(m, sheet.pact.level);
  (sheet?.spellcasting || []).forEach((s) => { m = Math.max(m, Number(s.maxSpellLevel) || 0); });
  return m;
}

function spellLevelOk(choice, level, ctx) {
  let L = choice.level;
  if (choice.levelByClassLevel) {
    const k = parseKey(choice.key);
    const table = choice.levelByClassLevel;
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    const at = keys.filter((x) => x <= (k.level || 99)).pop();
    if (at != null) L = table[at];
  }
  if (L == null) return true;
  if (typeof L === 'number') return level === L;
  if (Array.isArray(L)) return level >= L[0] && level <= L[1];
  const max = maxSpellLevel(ctx.sheet) || 1;
  if (L === 'slot') return level >= 1 && level <= max;
  if (L === 'cantrip-or-slot') return level <= max;
  return true;
}

function siblingValue(choice, partKey, ctx) {
  const base = String(choice.key).replace(/\/[^/>]*$/, '');
  return ctx.char.choices?.[`${base}/${partKey}`] ?? ctx.char.choices?.[partKey];
}

function spellOptions(choice, ctx) {
  let list = choice.list;
  if (choice.listFrom) {
    const v = siblingValue(choice, choice.listFrom, ctx);
    list = v ? readIds(v) : null;
  }
  const known = new Set((ctx.char.spells || []).map((s) => s.id));
  let spells = cat('spell');
  if (list === 'spellbook') spells = spells.filter((s) => (ctx.char.spells || []).some((x) => x.id === s.id && (x.class === 'wizard' || x.spellbook)));
  else if (Array.isArray(list) && list.length) spells = spells.filter((s) => (s.classes || []).some((c) => list.includes(c)));
  if (choice.known) spells = spells.filter((s) => known.has(s.id));
  if (choice.school) spells = spells.filter((s) => [].concat(choice.school).includes(s.school));
  if (choice.ritual) spells = spells.filter((s) => s.ritual);
  spells = spells.filter((s) => spellLevelOk(choice, Number(s.level) || 0, ctx));
  return spells.map((s) => ({ id: s.id, name: s.name, description: s.description, meta: entrySubtitle(s), entry: s }));
}

function toolOptions(from) {
  let tools = toolList();
  if (typeof from === 'string' && from !== 'any') tools = tools.filter((t) => t.category === from);
  else if (Array.isArray(from) && from.length) tools = tools.filter((t) => from.includes(t.id) || from.includes(t.category));
  return tools.map((t) => ({ id: t.id, name: t.name, meta: prettify(t.category), entry: t }));
}

function skillOptions(from, ctx, { mark = true } = {}) {
  const ids = Array.isArray(from) && from.length ? from : skillList().map((s) => s.id);
  return ids.map((id) => {
    const prof = mark && ctx.sheet?.skills?.[id]?.prof;
    return { id, name: skillName(id), meta: prof ? 'already proficient' : '' };
  });
}

function featOptions(choice, ctx) {
  let feats = cat('feat');
  if (Array.isArray(choice.from) && choice.from.length) feats = feats.filter((f) => choice.from.includes(f.id));
  else if (choice.category && !choice.orAnyFeat) feats = feats.filter((f) => [].concat(choice.category).includes(f.category));
  const out = feats.map((f) => {
    const reason = prereqForFeat(f, ctx);
    return { id: f.id, name: f.name, description: f.description, meta: entrySubtitle(f), disabled: !!reason, reason, entry: f };
  });
  for (const a of choice.alternatives || []) out.push({ id: a.id, name: a.name, description: a.description, meta: 'alternative' });
  return out;
}

function asiFeatOptions(ctx) {
  const lvl = ctx.sheet?.totalLevel ?? totalLevel(ctx.char);
  return cat('feat')
    .filter((f) => f.id !== 'ability-score-improvement' && (f.category !== 'epic-boon' || lvl >= 19))
    .map((f) => {
      const reason = prereqForFeat(f, ctx);
      return { id: f.id, name: f.name, description: f.description, meta: entrySubtitle(f), disabled: !!reason, reason, entry: f };
    });
}

/** Options for a choice: engine-provided when present, otherwise computed from the catalogs. */
export function optionsFor(choice, ctx) {
  const given = Array.isArray(choice.options) && choice.options.length ? choice.options : null;
  const t = choice.type;
  if (given) return given.map((o) => (typeof o === 'string' ? { id: o, name: prettify(o) } : o));
  switch (t) {
    case 'skills': return skillOptions(choice.from === 'any' ? null : choice.from, ctx);
    case 'expertise': {
      const pool = Array.isArray(choice.from) ? choice.from : skillList().map((s) => s.id);
      const mine = readIds(currentValue(choice, ctx.char));
      return pool.filter((id) => ctx.sheet?.skills?.[id]?.prof || mine.includes(id)).map((id) => ({ id, name: skillName(id), meta: ctx.sheet?.skills?.[id]?.expertise && !mine.includes(id) ? 'already expert' : '' }));
    }
    case 'tools': return toolOptions(choice.from);
    case 'skills-or-tools': return [...skillOptions(null, ctx).map((o) => ({ ...o, meta: `Skill${o.meta ? ` · ${o.meta}` : ''}` })), ...toolOptions(null).map((o) => ({ ...o, meta: `Tool · ${o.meta}` }))];
    case 'languages': {
      const known = new Set(ctx.sheet?.languages || []);
      return languageList().map((l) => ({ id: l.id, name: l.name, meta: [l.rare ? 'rare' : '', known.has(l.id) || known.has(l.name) ? 'known' : ''].filter(Boolean).join(' · ') }));
    }
    case 'weapon-mastery': return cat('weapon').filter((w) => w.mastery && (w.category === 'simple' || w.category === 'martial'))
      .map((w) => ({ id: w.id, name: w.name, meta: `${prettify(w.category)} · ${prettify(w.mastery)}`, entry: w }));
    case 'spells': return spellOptions(choice, ctx);
    case 'feat': return featOptions(choice, ctx);
    case 'subclass': {
      const classId = choice.class || choice.classId || parseKey(choice.key).classId;
      return cat('subclass').filter((s) => s.class === classId).map((s) => ({
        id: s.id, name: s.name, description: s.summary || '', meta: s.origin === 'stub' ? `${s.source || 'Stub'}${s.legacy ? ' · 2014' : ''}` : s.origin === 'custom' ? 'Custom' : 'SRD 5.2', entry: s,
      }));
    }
    case 'subspecies': {
      const sp = findEntry('species', choice.species || ctx.char.species?.id);
      return (sp?.subspecies || []).map((s) => ({ id: s.id, name: s.name, description: (s.traits || []).map((t) => `**${t.name}.** ${t.description || ''}`).join('\n\n') }));
    }
    case 'size': {
      const sp = findEntry('species', ctx.char.species?.id);
      return (choice.from || sp?.sizeOptions || ['Small', 'Medium']).map((s) => ({ id: s, name: s }));
    }
    case 'ability': return (choice.from || ABILITY_IDS).map((a) => ({ id: a, name: abilityName(a) }));
    case 'damage-type': {
      const all = damageTypes();
      return (choice.from || all.map((d) => d.id)).map((id) => ({ id, name: all.find((d) => d.id === id)?.name || prettify(id) }));
    }
    default: return [];
  }
}

/** Display names of the current picks ("Defense", "Longsword, Handaxe"). */
export function valueNames(choice, value, ctx) {
  if (choice.type === 'asi-or-feat') {
    if (!value) return '';
    const asi = Object.entries(value.asi || {}).filter(([, v]) => Number(v)).map(([a, v]) => `${a.toUpperCase()} +${v}`).join(', ');
    return [value.feat ? entryName('feat', value.feat) : value.asi ? 'Ability Score Improvement' : '', asi].filter(Boolean).join(' — ');
  }
  if (choice.type === 'ability-increase') return Object.entries(value || {}).filter(([, v]) => Number(v)).map(([a, v]) => `${a.toUpperCase()} +${v}`).join(', ');
  const ids = readIds(value);
  if (!ids.length) return '';
  let opts = [];
  try { opts = optionsFor(choice, ctx); } catch { opts = []; }
  return ids.map((id) => opts.find((o) => o.id === id)?.name || nameById(choice.type, id)).join(', ');
}

function nameById(type, id) {
  switch (type) {
    case 'skills': case 'expertise': return skillName(id);
    case 'tools': return entryName('gear', id);
    case 'languages': return languageName(id);
    case 'weapon-mastery': return entryName('weapon', id);
    case 'spells': return entryName('spell', id);
    case 'feat': return entryName('feat', id);
    case 'subclass': return entryName('subclass', id);
    case 'ability': return abilityName(id);
    case 'skills-or-tools': return skillList().some((s) => s.id === id) ? skillName(id) : entryName('gear', id);
    default: return prettify(id);
  }
}

// ---------- rendering ----------

/**
 * renderChoice(choice, ctx) -> Node
 * ctx: {char, sheet, mutate(fn), allKeys?:Set<string>, compact?:bool}
 */
export function renderChoice(choice, ctx) {
  const value = currentValue(choice, ctx.char);
  const count = countOf(choice, ctx.sheet);
  const answered = isAnswered(choice, value);
  const box = h('div', { class: ['ch-choice', answered ? 'is-answered' : 'is-pending', `ch-choice-${choice.type}`], 'data-choice': choice.key });
  const n = readIds(value).length;
  const status = INFO_TYPES.has(choice.type) || choice.type === 'multi' ? null
    : (LIST_TYPES.has(choice.type) || (choice.type === 'options' && count > 1))
      ? h('span', { class: ['badge', n >= count ? 'badge-ok' : 'badge-warn'] }, `${n} / ${count}`)
      : h('span', { class: ['badge', answered ? 'badge-ok' : 'badge-warn'] }, answered ? 'Chosen' : 'Choose');
  if (!ctx.headless) {
    box.append(h('div', { class: 'ch-choice-head' },
      h('span', { class: 'ch-choice-label' }, choice.label || choice.name || prettify(choice.featureId || choice.key)),
      choice.changeable ? h('span', { class: 'badge', title: 'You can change this later' }, `changeable: ${prettify(choice.changeable)}`) : null,
      h('span', { class: 'spacer' }),
      status));
  }
  if (choice.note) box.append(h('p', { class: 'ch-choice-note' }, choice.note));
  if (choice.description && ctx.showDescription) box.append(md(choice.description, { className: 'ch-choice-desc' }));
  box.append(renderBody(choice, value, count, ctx));
  return box;
}

function setChoice(choice, ctx, v) {
  ctx.mutate((c) => {
    storeChoice(c, choice.key, v);
    // Subclass choices whose key doesn't follow the `…subclass@class:L` pattern still update the class row.
    if (choice.type === 'subclass') {
      const classId = choice.class || choice.classId || parseKey(choice.key).classId;
      const row = (c.classes || []).find((x) => x.id === classId);
      if (row) row.subclass = readIds(v)[0] ?? null;
    }
  });
}

function renderBody(choice, value, count, ctx) {
  const t = choice.type;
  if (t === 'multi') return renderMulti(choice, ctx);
  if (t === 'spellcasting') return h('p', { class: 'muted ui text-sm' }, 'Cantrips and prepared spells are chosen in the Spells section.');
  if (t === 'asi-or-feat') return renderAsiOrFeat(choice, value, ctx);
  if (t === 'ability-increase') return abilityIncrease(choice, value || {}, (v) => setChoice(choice, ctx, v), ctx);
  if (t === 'wild-shape-forms') {
    const ids = readIds(value);
    return h('div', { class: 'stack stack-sm' },
      input({ value: ids.join(', '), placeholder: 'e.g. Wolf, Riding Horse, Giant Spider', 'data-fk': `wsf:${choice.key}`, onchange: (e) => setChoice(choice, ctx, e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) }),
      h('span', { class: 'field-hint' }, `Up to ${count} known Beast forms, separated by commas.`));
  }
  const options = optionsFor(choice, ctx);
  if (t === 'options') return renderOptionCards(choice, value, count, options, ctx);
  if (t === 'subclass' || t === 'subspecies') return renderRadioCards(choice, value, options, ctx);
  if (LIST_TYPES.has(t) || count > 1) return renderMultiPick(choice, value, count, options, ctx);
  return renderSinglePick(choice, value, options, ctx);
}

function renderMulti(choice, ctx) {
  const parts = choice.parts || [];
  return h('div', { class: 'ch-choice-parts' }, parts.map((p, i) => {
    const key = p.key && String(p.key).startsWith(choice.key) ? p.key : `${choice.key}/${p.key ?? i}`;
    if (ctx.allKeys?.has(key)) return null; // the engine lists this part as its own Choice
    return renderChoice({ ...p, key, label: p.label || partLabel(p) }, ctx);
  }));
}

function partLabel(p) {
  const n = Number(p.count) || 1;
  const map = {
    skills: n > 1 ? `${n} skills` : 'Skill', expertise: n > 1 ? `Expertise (${n})` : 'Expertise', tools: 'Tool', languages: n > 1 ? `${n} languages` : 'Language',
    spells: `${n} ${p.level === 0 ? (n > 1 ? 'cantrips' : 'cantrip') : (n > 1 ? 'spells' : 'spell')}`, ability: p.key === 'spellcasting-ability' ? 'Spellcasting ability' : 'Ability',
    options: prettify(p.key || 'Option'), subspecies: 'Lineage', size: 'Size', 'ability-increase': 'Ability scores', 'damage-type': 'Damage type',
  };
  return map[p.type] || prettify(p.type);
}

function optionLabel(o) {
  return h('span', { class: 'ch-opt-text' },
    h('span', { class: 'ch-opt-name' }, o.name),
    o.meta ? h('span', { class: 'ch-opt-meta' }, o.meta) : null,
    o.reason ? h('span', { class: 'ch-opt-meta danger-text' }, o.reason) : null);
}

function renderSinglePick(choice, value, options, ctx) {
  const cur = readIds(value)[0] ?? '';
  if (options.length > 40 || options.some((o) => o.entry && o.description)) return renderPickerButton(choice, value, 1, options, ctx);
  return select([{ value: '', label: '— choose —' }, ...options.map((o) => ({ value: o.id, label: `${o.name}${o.meta ? ` (${o.meta})` : ''}`, disabled: o.disabled && o.id !== cur }))],
    cur, (v) => setChoice(choice, ctx, encode(choice, v ? [v] : [])), { 'data-fk': `sel:${choice.key}` });
}

function renderMultiPick(choice, value, count, options, ctx) {
  const ids = readIds(value);
  if (options.length > 24 || choice.type === 'spells' || choice.type === 'weapon-mastery' || choice.type === 'feat') return renderPickerButton(choice, value, count, options, ctx);
  const full = ids.length >= count;
  return h('div', { class: 'ch-opt-chips', role: 'group' }, options.map((o) => {
    const on = ids.includes(o.id);
    return h('button', {
      type: 'button', class: ['chip', 'ch-opt-chip', on && 'is-active'], 'aria-pressed': String(on), 'data-fk': `chip:${choice.key}:${o.id}`,
      disabled: !on && (full || o.disabled), title: o.description ? String(o.description).slice(0, 240) : o.meta || null,
      onclick: () => setChoice(choice, ctx, encode(choice, on ? ids.filter((x) => x !== o.id) : count === 1 ? [o.id] : [...ids, o.id])),
    }, o.name, o.meta ? h('small', { class: 'ch-chip-meta' }, o.meta) : null);
  }));
}

function renderPickerButton(choice, value, count, options, ctx) {
  const ids = readIds(value);
  const byId = new Map(options.map((o) => [o.id, o]));
  const picked = ids.map((id) => byId.get(id) || { id, name: nameById(choice.type, id) });
  const open = async () => {
    const res = await pickFromList({
      title: choice.label || 'Choose',
      items: options,
      multi: count > 1,
      selected: options.filter((o) => ids.includes(o.id)),
      render: (o) => h('div', { class: 'picker-item-main' }, h('span', { class: 'picker-item-title' }, o.name, o.disabled ? ' (unavailable)' : ''), o.meta || o.reason ? h('small', { class: 'muted' }, [o.meta, o.reason].filter(Boolean).join(' · ')) : null),
      search: (o) => `${o.name} ${o.meta || ''}`,
      empty: 'No options match. Check the level, list or prerequisites.',
    });
    if (res == null) return;
    const next = (Array.isArray(res) ? res : [res]).filter((o) => !o.disabled || ids.includes(o.id)).map((o) => o.id).slice(0, count);
    setChoice(choice, ctx, encode(choice, next));
  };
  return h('div', { class: 'ch-picked' },
    picked.length ? h('div', { class: 'row ch-chip-row' }, picked.map((o) => h('span', { class: 'chip' },
      o.entry ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(o.entry) }, o.name) : o.name,
      h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${o.name}`, onclick: () => setChoice(choice, ctx, encode(choice, ids.filter((x) => x !== o.id))) }, icon('close'))))) : null,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: open, 'data-fk': `pick:${choice.key}` }, icon(picked.length ? 'edit' : 'plus'),
      picked.length ? (count > 1 ? `Change (${picked.length}/${count})` : 'Change') : count > 1 ? `Choose ${count}` : 'Choose…'),
    !options.length ? h('span', { class: 'field-hint' }, 'Nothing to choose from yet (check level, spell list or prerequisites).') : null);
}

function renderRadioCards(choice, value, options, ctx) {
  const cur = readIds(value)[0];
  if (!options.length) return h('p', { class: 'muted ui text-sm' }, 'No options available.');
  return h('div', { class: 'ch-cards', role: 'radiogroup' }, options.map((o) => {
    const on = o.id === cur;
    return h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(on), class: ['ch-optcard', on && 'is-selected'], 'data-fk': `card:${choice.key}:${o.id}`,
      onclick: () => setChoice(choice, ctx, on ? null : encode(choice, [o.id])),
    },
    h('span', { class: 'ch-optcard-head' }, h('span', { class: 'ch-opt-name' }, o.name), o.meta ? h('span', { class: ['badge', /SRD/.test(o.meta) ? 'badge-info' : ''] }, o.meta) : null),
    o.description ? h('span', { class: 'ch-optcard-desc' }, plain(o.description, 220)) : null);
  }));
}

function renderOptionCards(choice, value, count, options, ctx) {
  const ids = readIds(value);
  const full = ids.length >= count;
  const classLevel = (() => {
    const k = parseKey(choice.key);
    return k.classId ? (ctx.char.classes || []).find((c) => c.id === k.classId)?.level ?? k.level : ctx.sheet?.totalLevel ?? 0;
  })();
  const wrap = h('div', { class: 'ch-cards ch-cards-options' });
  for (const o of options) {
    const on = ids.includes(o.id);
    const lvlReq = o.prereq?.level && classLevel < o.prereq.level;
    const invReq = o.prereq?.invocation && !ids.includes(o.prereq.invocation);
    const blocked = !on && (full || lvlReq || invReq || o.disabled);
    const card = h('div', { class: ['ch-optcard', on && 'is-selected', blocked && 'is-blocked'] },
      h('label', { class: 'ch-optcard-head checkbox' },
        h('input', {
          type: count > 1 ? 'checkbox' : 'radio', name: `opt-${choice.key}`, checked: on, disabled: blocked, 'data-fk': `opt:${choice.key}:${o.id}`,
          onchange: () => setChoice(choice, ctx, encode(choice, on ? ids.filter((x) => x !== o.id) : count > 1 ? [...ids, o.id] : [o.id])),
        }),
        h('span', { class: 'ch-opt-name' }, o.name),
        o.prereq?.text ? h('span', { class: ['ch-opt-meta', (lvlReq || invReq) && 'danger-text'] }, o.prereq.text) : null),
      o.description ? h('div', { class: 'ch-optcard-desc', innerHTML: renderInline(String(o.description).split('\n')[0].slice(0, 400)) }) : null);
    if (on && o.choice) {
      const key = `${choice.key}>${o.id}`;
      if (!ctx.allKeys || !ctx.allKeys.has(key)) card.append(renderChoice({ ...o.choice, key, label: `${o.name}: ${partLabel(o.choice)}` }, ctx));
    }
    wrap.append(card);
  }
  if (count === 1 && ids.length) {
    wrap.append(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setChoice(choice, ctx, null) }, 'Clear choice'));
  }
  return wrap;
}

function plain(src, n) {
  const s = String(src || '').replace(/\*\*|__|\[\[([^\]|]*\|)?|\]\]|[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---------- ability increase & ASI / feat ----------

/** spec: {points, from, max, maxPerAbility}; value {str:1,…}. Scores shown exclude this choice's own bonus. */
export function abilityIncrease(spec, value, onChange, ctx) {
  const points = Number(spec.points ?? 2);
  const maxPer = Number(spec.maxPerAbility ?? points);
  const cap = Number(spec.max ?? 20);
  const from = spec.from?.length ? spec.from : ABILITY_IDS;
  const used = Object.values(value || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const left = points - used;
  const rows = ABILITIES.filter((a) => from.includes(a.id)).map((a) => {
    const mine = Number(value?.[a.id]) || 0;
    const shown = ctx.sheet?.abilities?.[a.id]?.score ?? 10;
    const base = shown - mine;
    const canUp = left > 0 && mine < maxPer && base + mine < cap;
    const set = (n) => {
      const next = { ...(value || {}) };
      if (n > 0) next[a.id] = n; else delete next[a.id];
      onChange(next);
    };
    return h('div', { class: ['ch-asi-row', mine && 'is-on'] },
      h('span', { class: 'ch-asi-name' }, a.full),
      h('span', { class: 'ch-asi-score num' }, String(base), mine ? h('span', { class: 'accent' }, ` → ${base + mine}`) : null),
      h('span', { class: 'ch-stepper' },
        h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: mine <= 0, 'aria-label': `Lower ${a.full}`, onclick: () => set(mine - 1), 'data-fk': `asi:${spec.key || ''}:${a.id}:-` }, icon('minus')),
        h('span', { class: 'ch-asi-val num' }, `+${mine}`),
        h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: !canUp, 'aria-label': `Raise ${a.full}`, onclick: () => set(mine + 1), 'data-fk': `asi:${spec.key || ''}:${a.id}:+` }, icon('plus'))));
  });
  return h('div', { class: 'ch-asi' },
    h('div', { class: 'ch-asi-left ui text-sm' }, left > 0 ? `${left} point${left === 1 ? '' : 's'} to spend` : 'All points spent', ` · max ${cap}`, maxPer < points ? ` · up to +${maxPer} each` : ''),
    rows);
}

function featAsiSpec(feat) {
  const c = feat?.choice;
  if (!c) return null;
  if (c.type === 'ability-increase') return c;
  if (c.type === 'multi') return (c.parts || []).find((p) => p.type === 'ability-increase') || null;
  return null;
}

function renderAsiOrFeat(choice, value, ctx) {
  const v = value && typeof value === 'object' ? value : {};
  const mode = v.feat ? 'feat' : 'asi';
  const set = (next) => setChoice(choice, ctx, next);
  const tabs = h('div', { class: 'ch-seg', role: 'tablist' },
    h('button', { type: 'button', role: 'tab', class: ['ch-seg-btn', mode === 'asi' && 'is-active'], 'aria-selected': String(mode === 'asi'), onclick: () => mode !== 'asi' && set({ asi: {} }), 'data-fk': `asim:${choice.key}:asi` }, 'Ability Score Improvement'),
    h('button', { type: 'button', role: 'tab', class: ['ch-seg-btn', mode === 'feat' && 'is-active'], 'aria-selected': String(mode === 'feat'), onclick: () => mode !== 'feat' && pickFeat(), 'data-fk': `asim:${choice.key}:feat` }, 'Feat'));
  const options = (choice.options?.length ? choice.options : asiFeatOptions(ctx)).filter((o) => o.id !== 'ability-score-improvement');
  async function pickFeat() {
    const res = await pickFromList({
      title: 'Choose a feat', items: options,
      render: (o) => h('div', { class: 'picker-item-main' }, h('span', { class: 'picker-item-title' }, o.name), h('small', { class: o.disabled ? 'danger-text' : 'muted' }, [o.meta, o.reason].filter(Boolean).join(' · '))),
      search: (o) => `${o.name} ${o.meta}`,
    });
    if (res) set({ feat: res.id, asi: {} }); // unmet prerequisites are flagged, not blocked (DM's call)
  }
  const body = [];
  if (mode === 'asi') {
    const fe = findEntry('feat', 'ability-score-improvement');
    const spec = featAsiSpec(fe) || { points: 2, maxPerAbility: 2, max: 20 };
    body.push(h('p', { class: 'ch-choice-note' }, 'Increase one ability score by 2, or two scores by 1 (max 20).'));
    body.push(abilityIncrease({ ...spec, from: ABILITY_IDS, key: choice.key }, v.asi || {}, (asi) => set({ asi }), ctx));
  } else {
    const feat = findEntry('feat', v.feat);
    const opt = options.find((o) => o.id === v.feat);
    body.push(h('div', { class: 'row' },
      h('button', { class: 'ch-link-btn ch-opt-name', type: 'button', onclick: () => feat && entryModal(feat) }, feat?.name || entryName('feat', v.feat)),
      opt?.reason ? h('span', { class: 'badge badge-warn' }, opt.reason) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: pickFeat }, icon('edit'), 'Change feat')));
    const spec = choice.featAsiPoints
      ? { points: choice.featAsiPoints, from: choice.from, max: choice.max, maxPerAbility: choice.maxPerAbility }
      : featAsiSpec(feat);
    if (spec) {
      body.push(h('p', { class: 'ch-choice-note' }, 'This feat also raises an ability score:'));
      body.push(abilityIncrease({ ...spec, key: choice.key }, v.asi || {}, (asi) => set({ ...v, asi }), ctx));
    }
    const other = feat?.choice && feat.choice.type !== 'ability-increase' && !(feat.choice.type === 'multi' && (feat.choice.parts || []).every((p) => p.type === 'ability-increase'));
    if (other) body.push(h('p', { class: 'field-hint' }, 'This feat has further choices; they appear in the list under “Feat: ', feat.name, '”.'));
  }
  return h('div', { class: 'stack stack-sm' }, tabs, body);
}

// ---------- lists ----------

/** Render many choices grouped by source ("Fighter 1", "Species", "Feat: Skilled"). */
export function renderChoiceGroups(choices, ctx, { empty = 'Nothing to choose here.', exclude } = {}) {
  const list = choices.filter((c) => !exclude || !exclude(c));
  if (!list.length) return h('p', { class: 'muted ui text-sm' }, empty);
  const allKeys = new Set(choices.map((c) => c.key));
  const listed = new Set(list.map((c) => c.key));
  // Children (an option's own choice, a feat's choices) render under their parent when it is listed.
  const parentOf = (c) => (c.parentKey && listed.has(c.parentKey) && c.parentKey !== c.key ? c.parentKey : null);
  const children = new Map();
  for (const c of list) {
    const p = parentOf(c);
    if (!p) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(c);
  }
  const groups = new Map();
  for (const c of list) {
    if (parentOf(c)) continue;
    const g = groupOf(c);
    if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
    groups.get(g.id).items.push(c);
  }
  const node = (c, depth = 0) => {
    const el = renderChoice(c, { ...ctx, allKeys });
    const kids = children.get(c.key);
    if (kids?.length && depth < 4) el.append(h('div', { class: 'ch-choice-children' }, kids.map((k) => node(k, depth + 1))));
    return el;
  };
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
  return h('div', { class: 'ch-choice-groups' }, sorted.map((g) => h('div', { class: 'ch-choice-group' },
    h('h3', { class: 'ch-choice-group-title' }, g.label),
    g.items.map((c) => node(c)))));
}
