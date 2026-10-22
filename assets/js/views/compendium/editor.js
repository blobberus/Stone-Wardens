// openEntryEditor(kind, entry?) -> Promise<savedEntry|null>
// One modal form per kind. New entries and edits of custom entries save to content/library/<kind>/<id>.json
// via compendium.saveCustom; editing an SRD/stub entry saves a custom copy (the original stays untouched).
import { h } from '../../core/dom.js';
import { openModal, select, checkbox, markdownEditor, toast, confirmDialog, icon } from '../../core/ui.js';
import { saveCustom, entries, cached, preloadAll } from '../../core/compendium.js';
import { uid, slugify, clone, nameKey } from '../../core/util.js';
import { store } from '../../core/store.js';
import * as M from './meta.js';
import { RANKS } from '../map/ranks.js';

// ---------- path helpers ----------

const getP = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function setP(o, path, v) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) {
    if (x[k] == null || typeof x[k] !== 'object') x[k] = {};
    x = x[k];
  }
  x[ks[ks.length - 1]] = v;
}
const blankStr = (v) => v == null || String(v).trim() === '';
const toNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
let seq = 0;
const nextId = (p) => `cp-f-${p}-${++seq}`;

// ---------- form kit ----------

function formKit(d, markDirty) {
  const refs = {};
  const deps = new Set();
  const get = (p) => getP(d, p);
  const set = (p, v) => { setP(d, p, v); markDirty(); };
  const update = () => deps.forEach((fn) => fn());

  /** Field wrapper (div, so clicking the label never toggles a chip or toolbar button). */
  function fld(label, control, { hint, wide = false, req = false, id } = {}) {
    const lab = typeof label === 'string'
      ? h(id ? 'label' : 'span', { class: 'field-label', for: id || null }, label, req ? h('span', { class: 'cp-req', 'aria-hidden': 'true' }, ' *') : null)
      : label;
    return h('div', { class: ['field', wide && 'cp-span-all'] }, lab, control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  }
  function text(path, props = {}) {
    const id = nextId('t');
    const el = h('input', { class: 'input', type: 'text', id, value: get(path) ?? '', ...props, oninput: (e) => { set(path, e.target.value); props.oninput?.(e); } });
    refs[path] = el;
    return el;
  }
  function num(path, props = {}) {
    const id = nextId('n');
    const el = h('input', {
      class: 'input input-number', type: 'number', inputmode: 'numeric', id, value: get(path) ?? '', ...props,
      oninput: (e) => { set(path, toNum(e.target.value)); props.onchange?.(toNum(e.target.value)); },
    });
    refs[path] = el;
    return el;
  }
  function sel(path, options, { onChange, blank } = {}) {
    const opts = blank != null ? [{ value: '', label: blank }, ...options] : options;
    const el = select(opts, get(path) ?? '', (v) => { set(path, v === '' ? null : v); onChange?.(v); });
    el.id = nextId('s');
    refs[path] = el;
    return el;
  }
  function check(path, label, onChange) {
    return checkbox(!!get(path), (v) => { set(path, v); onChange?.(v); }, label);
  }
  /** Toggle chips bound to an array value. */
  function chips(path, options, { max, onChange, label } = {}) {
    const wrap = h('div', { class: 'cp-chips', role: 'group', 'aria-label': label || null });
    const buttons = options.map((o) => h('button', {
      type: 'button', class: 'chip', 'data-value': o.value, title: o.title || null,
      onclick: () => {
        let cur = [...(get(path) || [])];
        if (cur.includes(o.value)) cur = cur.filter((x) => x !== o.value);
        else { cur.push(o.value); if (max && cur.length > max) cur.shift(); }
        set(path, cur);
        paint();
        onChange?.(cur);
      },
    }, o.label));
    const paint = () => {
      const cur = get(path) || [];
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(cur.includes(b.dataset.value))));
    };
    paint();
    wrap.append(...buttons);
    refs[path] = buttons[0] || wrap;
    return wrap;
  }
  function mdEditor(path, { rows = 6, placeholder } = {}) {
    const ed = markdownEditor({ value: get(path) || '', rows, placeholder, onInput: (v) => set(path, v) });
    refs[path] = ed.textarea;
    return ed;
  }
  function cost(path = 'cost') {
    if (!get(path)) setP(d, path, { qty: null, unit: 'gp' });
    return h('div', { class: 'cp-cost row row-nowrap' },
      num(`${path}.qty`, { min: 0, step: 'any', placeholder: '—', 'aria-label': 'Cost amount' }),
      sel(`${path}.unit`, M.COINS.map((c) => ({ value: c, label: c.toUpperCase() }))));
  }
  /** A block that re-renders when update() is called (after discrete changes). */
  function dyn(fn) {
    const box = h('div', { class: 'cp-dyn' });
    const run = () => box.replaceChildren(...[fn()].flat(3).filter(Boolean));
    run();
    deps.add(run);
    return box;
  }
  const grid = (...kids) => h('div', { class: 'field-grid cp-grid' }, kids.flat().filter(Boolean));
  const sec = (title, ...kids) => h('fieldset', { class: 'cp-fieldset' }, title ? h('legend', null, title) : null, kids.flat().filter(Boolean));

  /** Repeating list of sub-objects (traits, features). fields: [{key, label, type:'text'|'number'|'md', ...}] */
  function listEditor(path, { fields, addLabel = 'Add', blank = () => ({}), itemLabel = 'Item' }) {
    if (!Array.isArray(get(path))) setP(d, path, []);
    const box = h('div', { class: 'cp-list' });
    const draw = (focusIndex) => {
      const items = get(path);
      const rows = items.map((it, i) => {
        const controls = fields.map((f) => {
          const id = nextId('l');
          let c;
          if (f.type === 'md') {
            c = markdownEditor({ value: it[f.key] || '', rows: f.rows || 3, onInput: (v) => { it[f.key] = v; markDirty(); } });
          } else if (f.type === 'number') {
            c = h('input', { class: 'input input-number', type: 'number', id, min: f.min, max: f.max, value: it[f.key] ?? '', oninput: (e) => { it[f.key] = toNum(e.target.value); markDirty(); } });
          } else {
            c = h('input', { class: 'input', type: 'text', id, value: it[f.key] ?? '', placeholder: f.placeholder || null, oninput: (e) => { it[f.key] = e.target.value; markDirty(); } });
          }
          return fld(f.type === 'md' ? f.label : h('label', { class: 'field-label', for: id }, f.label), c, { wide: f.type === 'md' });
        });
        const move = (dir) => { const j = i + dir; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; markDirty(); draw(); };
        return h('div', { class: 'cp-list-item' },
          h('div', { class: 'cp-list-head' },
            h('span', { class: 'cp-list-num' }, `${itemLabel} ${i + 1}`),
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, icon('chevron-up')),
            h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Move down', 'aria-label': 'Move down', disabled: i === items.length - 1, onclick: () => move(1) }, icon('chevron-down')),
            h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Remove', 'aria-label': `Remove ${itemLabel.toLowerCase()} ${i + 1}`, onclick: () => { items.splice(i, 1); markDirty(); draw(); } }, icon('trash'))),
          h('div', { class: 'field-grid cp-grid' }, controls));
      });
      box.replaceChildren(...rows,
        h('button', { type: 'button', class: 'btn btn-sm cp-list-add', onclick: () => { items.push(blank()); markDirty(); draw(items.length - 1); } }, icon('plus'), addLabel));
      if (focusIndex != null) box.querySelectorAll('.cp-list-item')[focusIndex]?.querySelector('input, textarea')?.focus();
    };
    draw();
    refs[path] = box;
    return box;
  }

  /** Editor for a `modifiers` object (all additive). */
  function modifiers(path = 'modifiers', { open = false } = {}) {
    if (!get(path) || typeof get(path) !== 'object') setP(d, path, {});
    const m = get(path);
    const n = (key, label, unit) => fld(label + (unit ? ` (${unit})` : ''), num(`${path}.${key}`, { step: 1, placeholder: '0' }));
    const abil = (group) => h('div', { class: 'cp-abil-grid' }, [...(group === 'saves' ? ['all'] : []), ...M.ABILITY_IDS].map((a) => {
      const id = nextId('m');
      return h('label', { class: 'cp-abil', for: id }, h('span', null, a === 'all' ? 'All' : M.abilityAbbr(a)),
        h('input', { class: 'input input-number input-sm', type: 'number', id, step: 1, placeholder: '0', value: m[group]?.[a] ?? '',
          oninput: (e) => { setP(d, `${path}.${group}.${a}`, toNum(e.target.value)); markDirty(); } }));
    }));
    // Skills: rows of [skill][bonus]
    const skillRows = Object.entries(m.skills || {}).map(([skill, v]) => ({ skill, v }));
    const skillBox = h('div', { class: 'cp-skill-rows' });
    const writeSkills = () => {
      const o = {};
      for (const r of skillRows) if (r.skill) o[r.skill] = r.v;
      setP(d, `${path}.skills`, o);
      markDirty();
    };
    const skillOpts = [{ value: 'all', label: 'All skills' }, ...M.ruleList('skills').map((s) => ({ value: s.id, label: s.name }))];
    const drawSkills = () => skillBox.replaceChildren(
      ...skillRows.map((r, i) => h('div', { class: 'row row-nowrap cp-skill-row' },
        select(skillOpts, r.skill, (v) => { r.skill = v; writeSkills(); }, { 'aria-label': 'Skill' }),
        h('input', { class: 'input input-number', type: 'number', step: 1, value: r.v ?? '', 'aria-label': 'Bonus', oninput: (e) => { r.v = toNum(e.target.value); writeSkills(); } }),
        h('button', { type: 'button', class: 'btn-icon btn-sm', 'aria-label': 'Remove skill bonus', onclick: () => { skillRows.splice(i, 1); writeSkills(); drawSkills(); } }, icon('trash')))),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { skillRows.push({ skill: 'perception', v: 1 }); writeSkills(); drawSkills(); } }, icon('plus'), 'Skill bonus'));
    drawSkills();
    const hasAny = M.modifiersSummary(m).length > 0;
    return h('details', { class: 'cp-mods', open: open || hasAny },
      h('summary', null, 'Modifiers', h('span', { class: 'muted' }, ' — bonuses applied to the character sheet (optional)')),
      grid(
        n('ac', 'Armor Class'), n('speed', 'Speed', 'ft.'), n('initiative', 'Initiative'),
        n('hpMax', 'HP maximum'), n('hpPerLevel', 'HP per level'), n('profBonus', 'Proficiency bonus'),
        n('attack', 'Attack rolls'), n('damage', 'Damage rolls'), n('spellDc', 'Spell save DC'), n('spellAttack', 'Spell attack')),
      fld('Ability scores', abil('abilities'), { wide: true }),
      fld('Saving throws', abil('saves'), { wide: true }),
      fld('Skills', skillBox, { wide: true }),
      fld('Resistances', chips(`${path}.resistances`, M.ruleList('damageTypes').map((t) => ({ value: t.id, label: t.name })), { label: 'Resistances' }), { wide: true }),
      fld('Senses', text(`${path}.senses`, { placeholder: 'e.g. Darkvision 60 ft.' }), { wide: true }));
  }

  return { refs, get, set, update, fld, text, num, sel, check, chips, mdEditor, cost, dyn, grid, sec, listEditor, modifiers };
}

/** Strip zero/empty modifier values; null when nothing is left. */
export function cleanModifiers(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const k of ['ac', 'speed', 'initiative', 'hpPerLevel', 'hpMax', 'profBonus', 'attack', 'damage', 'spellDc', 'spellAttack']) {
    if (Number(m[k])) out[k] = Number(m[k]);
  }
  for (const g of ['abilities', 'saves', 'skills']) {
    const o = {};
    for (const [k, v] of Object.entries(m[g] || {})) if (k && Number(v)) o[k] = Number(v);
    if (Object.keys(o).length) out[g] = o;
  }
  if (Array.isArray(m.resistances) && m.resistances.length) out.resistances = [...m.resistances];
  if (m.senses && String(m.senses).trim()) out.senses = String(m.senses).trim();
  return Object.keys(out).length ? out : null;
}

// ---------- defaults ----------

const pinColors = () => {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  return ['rubric', 'vermilion', 'ochre', 'gold', 'green', 'verdigris', 'lapis', 'slate', 'murrey', 'umber', 'ink']
    .map((n) => cs?.getPropertyValue(`--pin-${n}`).trim()).filter(Boolean);
};

const BLANK = {
  weapon: () => ({ category: 'simple', weaponKind: 'melee', damage: '1d6', damageType: 'slashing', versatile: null, properties: [], mastery: null, range: null, thrown: null, weight: null, cost: { qty: null, unit: 'gp' }, description: '' }),
  armor: () => ({ category: 'light', ac: { base: 11, dex: true, maxDex: null }, strMin: null, stealthDisadvantage: false, weight: null, cost: { qty: null, unit: 'gp' }, don: '', doff: '', description: '' }),
  gear: () => ({ category: 'adventuring-gear', cost: { qty: null, unit: 'gp' }, weight: null, description: '' }),
  'magic-item': () => ({ category: 'wondrous-item', type: '', rarity: 'uncommon', attunement: false, attunementNote: '', description: '' }),
  spell: () => ({ level: 1, school: 'evocation', classes: [], castingTime: 'Action', ritual: false, range: '60 feet', components: ['V', 'S'], material: '', duration: 'Instantaneous', concentration: false, description: '', higherLevel: '' }),
  feat: () => ({ category: 'general', prerequisite: '', prereq: {}, repeatable: false, description: '' }),
  ability: () => ({ description: '', uses: null, recharge: null }),
  species: () => ({ type: 'Humanoid', size: 'Medium', speed: 30, darkvision: null, traits: [], description: '' }),
  class: () => ({ hitDie: 8, primaryAbility: [], saves: [], proficiencies: { armor: [], weapons: ['simple'], tools: [] }, skillChoices: { choose: 2, from: [] }, spellcasting: null, features: [], description: '' }),
  subclass: () => ({ class: null, summary: '', description: '', features: [] }),
  background: () => ({ abilityScores: [], feat: { id: null, note: null }, skills: [], tool: null, equipment: { text: '', options: [] }, description: '' }),
  'location-type': () => ({ icon: 'mk-landmark', color: pinColors()[6] || '#22507c', rank: 3, major: false }),
};

const opt = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const listOpt = (key) => M.ruleList(key).map((x) => ({ value: x.id, label: x.name }));
const abilOpts = () => M.ABILITY_IDS.map((a) => ({ value: a, label: M.abilityAbbr(a), title: M.abilityName(a) }));
const DICE_HINT = 'Dice like 1d8 or 2d6, or a flat number.';

// ---------- per-kind forms ----------
// build(f, d) -> nodes; validate(d) -> [{path, msg}]; normalize(d) mutates before saving.

const FORMS = {
  weapon: {
    build(f, d) {
      return [
        f.sec('Weapon',
          f.grid(
            f.fld('Category', f.sel('category', [{ value: 'simple', label: 'Simple' }, { value: 'martial', label: 'Martial' }])),
            f.fld('Melee or ranged', f.sel('weaponKind', [{ value: 'melee', label: 'Melee' }, { value: 'ranged', label: 'Ranged' }], { onChange: f.update })),
            f.fld('Damage', f.text('damage', { placeholder: '1d8', autocomplete: 'off' }), { hint: DICE_HINT, req: true }),
            f.fld('Damage type', f.sel('damageType', listOpt('damageTypes'))),
            f.fld('Mastery', f.sel('mastery', listOpt('weaponMasteries'), { blank: 'None' })),
            f.fld('Weight (lb.)', f.num('weight', { min: 0, step: 'any', placeholder: '—' })),
            f.fld('Cost', f.cost()))),
        f.sec('Properties',
          f.chips('properties', listOpt('weaponProperties'), { onChange: f.update, label: 'Properties' }),
          f.dyn(() => {
            const p = d.properties || [];
            const ranged = d.weaponKind === 'ranged' || p.includes('ammunition') || p.includes('range');
            const ammo = cached('gear').filter((g) => g.category === 'ammunition').map((g) => ({ value: g.id, label: g.name }));
            return f.grid(
              p.includes('versatile') ? f.fld('Versatile damage (two hands)', f.text('versatile', { placeholder: '1d10' }), { hint: DICE_HINT, req: true }) : null,
              ranged ? [f.fld('Range, normal (ft.)', f.num('range.normal', { min: 0, placeholder: '80' }), { req: true }), f.fld('Range, long (ft.)', f.num('range.long', { min: 0, placeholder: '320' }))] : null,
              p.includes('thrown') ? [f.fld('Thrown, normal (ft.)', f.num('thrown.normal', { min: 0, placeholder: '20' }), { req: true }), f.fld('Thrown, long (ft.)', f.num('thrown.long', { min: 0, placeholder: '60' }))] : null,
              p.includes('ammunition') && ammo.length ? f.fld('Ammunition', f.sel('ammunition', ammo, { blank: 'Any / none' })) : null,
              f.fld('Notes', f.text('notes', { placeholder: 'e.g. Two-handed unless mounted' }), { wide: true }));
          })),
        f.fld('Description', f.mdEditor('description', { placeholder: 'What makes this weapon special. [[links]] work: [[spell:Fire Bolt]], [[map:Old Mill]]…' }), { wide: true }),
      ];
    },
    validate(d) {
      const e = [];
      if (!M.DICE_RE.test(String(d.damage || '').trim())) e.push({ path: 'damage', msg: 'Damage must be dice like 1d8 (or a flat number).' });
      if ((d.properties || []).includes('versatile') && !M.DICE_RE.test(String(d.versatile || '').trim())) e.push({ path: 'versatile', msg: 'Versatile weapons need their two-handed damage dice.' });
      const p = d.properties || [];
      if ((d.weaponKind === 'ranged' || p.includes('ammunition') || p.includes('range')) && !(Number(d.range?.normal) > 0)) e.push({ path: 'range.normal', msg: 'Ranged weapons need a normal range.' });
      if (p.includes('thrown') && !(Number(d.thrown?.normal) > 0)) e.push({ path: 'thrown.normal', msg: 'Thrown weapons need a thrown range.' });
      return e;
    },
    normalize(d) {
      const p = d.properties || [];
      d.damage = String(d.damage).replace(/\s+/g, '');
      d.weaponKind = d.weaponKind === 'ranged' ? 'ranged' : 'melee';
      d.versatile = p.includes('versatile') ? String(d.versatile).replace(/\s+/g, '') : null;
      const ranged = d.weaponKind === 'ranged' || p.includes('ammunition') || p.includes('range');
      d.range = ranged ? { normal: Number(d.range.normal), long: toNum(d.range?.long) ?? Number(d.range.normal) } : null;
      d.thrown = p.includes('thrown') ? { normal: Number(d.thrown.normal), long: toNum(d.thrown?.long) ?? Number(d.thrown.normal) } : null;
      if (!p.includes('ammunition') || !d.ammunition) delete d.ammunition;
      if (blankStr(d.notes)) delete d.notes;
      d.mastery = d.mastery || null;
    },
  },

  armor: {
    build(f, d) {
      const setCat = (cat) => {
        const base = { light: 11, medium: 13, heavy: 16, shield: 2 }[cat];
        d.ac = { base: d.ac?.base ?? base, dex: cat === 'light' || cat === 'medium', maxDex: cat === 'medium' ? 2 : null };
        if (cat === 'shield') d.ac.base = 2;
        f.update();
      };
      return [
        f.sec('Armor',
          f.grid(
            f.fld('Category', f.sel('category', opt(M.ARMOR_CATS), { onChange: setCat })),
            f.dyn(() => [
              f.fld(d.category === 'shield' ? 'AC bonus' : 'Base Armor Class', f.num('ac.base', { min: 0, max: 30 }), { req: true }),
              d.category === 'shield' ? null : f.fld('Dexterity', f.check('ac.dex', 'Add Dex modifier', f.update)),
              d.category !== 'shield' && d.ac?.dex ? f.fld('Max Dex bonus', f.num('ac.maxDex', { min: 0, max: 10, placeholder: 'No limit' }), { hint: 'Leave blank for no limit.' }) : null,
            ]),
            f.fld('Strength requirement', f.num('strMin', { min: 0, max: 30, placeholder: 'None' })),
            f.fld('Stealth', f.check('stealthDisadvantage', 'Disadvantage on Stealth')),
            f.fld('Weight (lb.)', f.num('weight', { min: 0, step: 'any', placeholder: '—' })),
            f.fld('Cost', f.cost()),
            f.fld('Don', f.text('don', { placeholder: '1 minute' })),
            f.fld('Doff', f.text('doff', { placeholder: '1 minute' })))),
        f.fld('Description', f.mdEditor('description'), { wide: true }),
      ];
    },
    validate(d) {
      return Number.isFinite(Number(d.ac?.base)) && d.ac?.base !== null ? [] : [{ path: 'ac.base', msg: 'Give the armor its Armor Class.' }];
    },
    normalize(d) {
      d.ac = { base: Number(d.ac.base), dex: d.category === 'shield' ? false : !!d.ac.dex, maxDex: d.ac.dex ? toNum(d.ac.maxDex) : null };
      d.strMin = toNum(d.strMin);
      d.stealthDisadvantage = !!d.stealthDisadvantage;
    },
  },

  gear: {
    build(f, d) {
      return [
        f.sec('Gear',
          f.grid(
            f.fld('Category', f.sel('category', opt(M.GEAR_CATS))),
            f.fld('Weight (lb.)', f.num('weight', { min: 0, step: 'any', placeholder: '—' })),
            f.fld('Cost', f.cost()),
            f.fld('Tool', f.check('tool', 'This is a tool (grants a proficiency)', f.update)),
            f.dyn(() => (d.tool ? f.fld('Tool ability', f.sel('ability', M.ABILITY_IDS.map((a) => ({ value: a, label: M.abilityName(a) })), { blank: '—' })) : null)))),
        f.fld('Description', f.mdEditor('description'), { wide: true }),
      ];
    },
    validate: () => [],
    normalize(d) {
      if (!d.tool) { delete d.tool; delete d.ability; }
    },
  },

  'magic-item': {
    build(f, d) {
      const baseFor = (cat) => (cat === 'weapon' ? 'weapon' : cat === 'armor' ? 'armor' : null);
      return [
        f.sec('Magic item',
          f.grid(
            f.fld('Category', f.sel('category', opt(M.ITEM_CATS), { onChange: () => { if (!baseFor(d.category)) delete d.base; f.update(); } })),
            f.fld('Rarity', f.sel('rarity', opt(M.RARITIES))),
            f.fld('Type line', f.text('type', { placeholder: 'e.g. Wondrous Item, Weapon (Longsword)' }), { hint: 'Leave blank to use the category (and base item).' }),
            f.fld('Attunement', f.check('attunement', 'Requires attunement', f.update)),
            f.dyn(() => (d.attunement ? f.fld('Attunement by', f.text('attunementNote', { placeholder: 'e.g. by a Wizard' })) : null)),
            f.dyn(() => {
              const k = baseFor(d.category);
              if (!k) return null;
              if (!d.base || d.base.kind !== k) d.base = { kind: k, id: null };
              const list = cached(k).map((x) => ({ value: x.id, label: x.name }));
              return f.fld(k === 'weapon' ? 'Base weapon' : 'Base armor', f.sel('base.id', list, { blank: 'Any / not specific' }),
                { hint: 'The sheet uses the base item’s stats for attacks or AC.' });
            }))),
        f.fld('Description', f.mdEditor('description', { placeholder: 'What the item does. [[links]] work everywhere.' }), { wide: true, req: true }),
        f.modifiers('modifiers'),
      ];
    },
    validate: (d) => (blankStr(d.description) ? [{ path: 'description', msg: 'Describe what the item does.' }] : []),
    normalize(d) {
      if (!d.base?.id) delete d.base;
      if (blankStr(d.type)) {
        const cat = M.ITEM_CATS[d.category] || 'Wondrous Item';
        d.type = d.base?.id ? `${cat} (${M.entryName(d.base.kind, d.base.id)})` : cat;
      }
      d.attunement = !!d.attunement;
      if (!d.attunement || blankStr(d.attunementNote)) delete d.attunementNote;
      d.modifiers = cleanModifiers(d.modifiers);
      if (!d.modifiers) delete d.modifiers;
    },
  },

  spell: {
    build(f, d) {
      const dl = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));
      const ids = { t: nextId('dl'), r: nextId('dl'), d: nextId('dl') };
      const comps = [{ value: 'V', label: 'Verbal (V)' }, { value: 'S', label: 'Somatic (S)' }, { value: 'M', label: 'Material (M)' }];
      return [
        f.sec('Spell',
          f.grid(
            f.fld('Level', f.sel('level', M.SPELL_LEVELS.map((l) => ({ value: String(l), label: M.spellLevelLabel(l) })), { onChange: (v) => { d.level = Number(v); f.update(); } })),
            f.fld('School', f.sel('school', listOpt('magicSchools'))),
            f.fld('Casting time', f.text('castingTime', { list: ids.t, placeholder: 'Action' }), { req: true }),
            f.fld('Range', f.text('range', { list: ids.r, placeholder: '60 feet' }), { req: true }),
            f.fld('Duration', f.text('duration', { list: ids.d, placeholder: 'Instantaneous' }), { req: true, hint: 'With concentration, write “Up to 1 minute”.' }),
            f.fld('Flags', h('div', { class: 'stack stack-sm' }, f.check('concentration', 'Concentration'), f.check('ritual', 'Ritual')))),
          dl(ids.t, ['Action', 'Bonus Action', 'Reaction', '1 minute', '10 minutes', '1 hour', '8 hours']),
          dl(ids.r, ['Self', 'Touch', '5 feet', '30 feet', '60 feet', '90 feet', '120 feet', '150 feet', '300 feet', '1 mile', 'Sight', 'Unlimited']),
          dl(ids.d, ['Instantaneous', '1 round', 'Up to 1 minute', '1 minute', 'Up to 10 minutes', '10 minutes', 'Up to 1 hour', '1 hour', '8 hours', '24 hours', 'Until dispelled']),
          f.fld('Components', f.chips('components', comps, { onChange: f.update, label: 'Components' }), { wide: true }),
          f.dyn(() => ((d.components || []).includes('M') ? f.fld('Material component', f.text('material', { placeholder: 'e.g. a bit of bat fur' }), { wide: true }) : null)),
          f.fld('Classes', f.chips('classes', M.classOptions(), { label: 'Classes' }), { wide: true, hint: 'Which spell lists include it.' })),
        f.fld('Description', f.mdEditor('description', { rows: 8 }), { wide: true, req: true }),
        f.fld(h('span', { class: 'field-label' }, f.dyn(() => (Number(d.level) === 0 ? 'Cantrip upgrade' : 'Using a higher-level spell slot'))),
          f.mdEditor('higherLevel', { rows: 3, placeholder: 'Optional' }), { wide: true }),
        h('details', { class: 'cp-mods', open: !!(d.attack || d.save || d.damage?.dice) },
          h('summary', null, 'Mechanics', h('span', { class: 'muted' }, ' — attack, save and damage for the sheet (optional)')),
          f.grid(
            f.fld('Spell attack', f.sel('attack', [{ value: 'melee', label: 'Melee spell attack' }, { value: 'ranged', label: 'Ranged spell attack' }], { blank: 'None' })),
            f.fld('Saving throw', f.sel('save', M.ABILITY_IDS.map((a) => ({ value: a, label: M.abilityName(a) })), { blank: 'None' })),
            f.fld('Damage dice', f.text('damage.dice', { placeholder: 'e.g. 8d6' })),
            f.fld('Damage type', f.sel('damage.type', listOpt('damageTypes'), { blank: '—' })))),
      ];
    },
    validate(d) {
      const e = [];
      for (const [p, label] of [['castingTime', 'a casting time'], ['range', 'a range'], ['duration', 'a duration']]) if (blankStr(d[p])) e.push({ path: p, msg: `Give the spell ${label}.` });
      if (blankStr(d.description)) e.push({ path: 'description', msg: 'Describe what the spell does.' });
      if (d.damage?.dice && !M.DICE_RE.test(String(d.damage.dice).trim())) e.push({ path: 'damage.dice', msg: 'Damage must be dice like 8d6.' });
      return e;
    },
    normalize(d) {
      d.level = Number(d.level) || 0;
      d.components = ['V', 'S', 'M'].filter((c) => (d.components || []).includes(c));
      d.material = d.components.includes('M') && !blankStr(d.material) ? d.material.trim() : null;
      d.higherLevel = blankStr(d.higherLevel) ? null : d.higherLevel;
      d.concentration = !!d.concentration;
      d.ritual = !!d.ritual;
      d.classes = d.classes || [];
      if (!d.attack) delete d.attack;
      if (!d.save) delete d.save;
      if (blankStr(d.damage?.dice)) delete d.damage;
      else d.damage = { type: d.damage.type || null, dice: String(d.damage.dice).replace(/\s+/g, '') };
    },
  },

  feat: {
    build(f, d) {
      const choice = d.choice;
      const asiEditable = !choice || choice.type === 'ability-increase';
      const ui = { asi: choice?.type === 'ability-increase' };
      if (ui.asi) d._asi = { points: choice.points || 1, from: choice.from || [], max: choice.max || 20 };
      else d._asi = { points: 1, from: [], max: 20 };
      return [
        f.sec('Feat',
          f.grid(
            f.fld('Category', f.sel('category', opt(M.FEAT_CATS))),
            f.fld('Prerequisite', f.text('prerequisite', { placeholder: 'e.g. Level 4+, Strength 13+' }), { hint: 'Shown as written.' }),
            f.fld('Minimum level', f.num('prereq.level', { min: 1, max: 20, placeholder: '—' }), { hint: 'Used by the character builder.' }),
            f.fld('Repeatable', f.check('repeatable', 'Can be taken more than once')))),
        f.fld('Description', f.mdEditor('description', { rows: 8 }), { wide: true, req: true }),
        asiEditable
          ? f.sec('Ability score increase',
            checkbox(ui.asi, (v) => { ui.asi = v; f.set('_asiOn', v); f.update(); }, 'This feat increases an ability score'),
            f.dyn(() => ((d._asiOn ?? ui.asi) ? f.grid(
              f.fld('Points', f.sel('_asi.points', [{ value: '1', label: '+1' }, { value: '2', label: '+2' }])),
              f.fld('Maximum', f.sel('_asi.max', [{ value: '20', label: '20' }, { value: '30', label: '30 (epic boon)' }])),
              f.fld('Which abilities', f.chips('_asi.from', abilOpts(), { label: 'Abilities' }), { wide: true, hint: 'Leave all off for any ability.' })) : null)))
          : h('p', { class: 'muted cp-note' }, 'This feat’s choices from the original entry are kept as they are.'),
        f.modifiers('modifiers'),
      ];
    },
    validate: (d) => (blankStr(d.description) ? [{ path: 'description', msg: 'Describe what the feat does.' }] : []),
    normalize(d) {
      const on = d._asiOn ?? d.choice?.type === 'ability-increase';
      if (!d.choice || d.choice.type === 'ability-increase') {
        if (on) d.choice = { type: 'ability-increase', points: Number(d._asi.points) || 1, from: d._asi.from?.length ? d._asi.from : [...M.ABILITY_IDS], max: Number(d._asi.max) || 20 };
        else delete d.choice;
      }
      delete d._asi; delete d._asiOn;
      d.prerequisite = blankStr(d.prerequisite) ? null : d.prerequisite.trim();
      const lvl = toNum(d.prereq?.level);
      d.prereq = { ...(d.prereq || {}) };
      if (lvl) d.prereq.level = lvl; else delete d.prereq.level;
      d.repeatable = !!d.repeatable;
      d.modifiers = cleanModifiers(d.modifiers);
      if (!d.modifiers) delete d.modifiers;
    },
  },

  ability: {
    build(f) {
      return [
        f.sec('Ability',
          f.grid(
            f.fld('Uses', f.num('uses', { min: 0, placeholder: 'Unlimited' }), { hint: 'Leave blank if it is always on.' }),
            f.fld('Recharge', f.sel('recharge', [{ value: 'short', label: 'Short or Long Rest' }, { value: 'long', label: 'Long Rest' }], { blank: 'No recharge' })))),
        f.fld('Description', f.mdEditor('description', { rows: 6 }), { wide: true, req: true }),
        f.modifiers('modifiers', { open: true }),
      ];
    },
    validate: (d) => (blankStr(d.description) ? [{ path: 'description', msg: 'Describe what the ability does.' }] : []),
    normalize(d) {
      d.uses = toNum(d.uses);
      d.recharge = d.recharge === 'short' || d.recharge === 'long' ? d.recharge : null;
      d.modifiers = cleanModifiers(d.modifiers);
      if (!d.modifiers) delete d.modifiers;
    },
  },

  species: {
    build(f, d) {
      if (Array.isArray(d.sizeOptions) && d.sizeOptions.length) {
        const so = d.sizeOptions;
        d.size = so.length === 2 && so.includes('Small') && so.includes('Medium') ? 'Small or Medium' : so.join(' or ');
      }
      const sizes = ['Tiny', 'Small', 'Medium', 'Small or Medium', 'Large'];
      if (d.size && !sizes.includes(d.size)) sizes.push(d.size);
      return [
        f.sec('Species',
          f.grid(
            f.fld('Creature type', f.text('type', { placeholder: 'Humanoid' })),
            f.fld('Size', f.sel('size', sizes.map((s) => ({ value: s, label: s })))),
            f.fld('Speed (ft.)', f.num('speed', { min: 0, step: 5 }), { req: true }),
            f.fld('Darkvision (ft.)', f.num('darkvision', { min: 0, step: 30, placeholder: 'None' })),
            f.fld('Fly speed (ft.)', f.num('speeds.fly', { min: 0, step: 5, placeholder: '—' })),
            f.fld('Swim speed (ft.)', f.num('speeds.swim', { min: 0, step: 5, placeholder: '—' })),
            f.fld('Climb speed (ft.)', f.num('speeds.climb', { min: 0, step: 5, placeholder: '—' })))),
        f.fld('Description', f.mdEditor('description', { rows: 4, placeholder: 'Optional overview.' }), { wide: true }),
        f.sec('Traits', f.listEditor('traits', {
          itemLabel: 'Trait', addLabel: 'Add trait', blank: () => ({ name: '', description: '' }),
          fields: [{ key: 'name', label: 'Trait name', placeholder: 'e.g. Stonecunning' }, { key: 'level', label: 'Character level', type: 'number', min: 1, max: 20 }, { key: 'description', label: 'What it does', type: 'md' }],
        })),
      ];
    },
    validate(d) {
      const e = [];
      if (!(Number(d.speed) >= 0) || d.speed === null) e.push({ path: 'speed', msg: 'Give the species a speed.' });
      if ((d.traits || []).some((t) => blankStr(t.name))) e.push({ path: 'traits', msg: 'Every trait needs a name (or remove the empty one).' });
      return e;
    },
    normalize(d) {
      if (/ or /.test(d.size || '')) { d.sizeOptions = d.size.split(/\s+or\s+/).map((s) => s.trim()).filter(Boolean); delete d.size; } else delete d.sizeOptions;
      d.speed = Number(d.speed) || 0;
      d.darkvision = toNum(d.darkvision) || null;
      const speeds = Object.fromEntries(Object.entries(d.speeds || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
      if (Object.keys(speeds).length) d.speeds = speeds; else delete d.speeds;
      const base = slugify(d.name);
      d.traits = (d.traits || []).map((t) => {
        const out = { ...t, id: t.id || `${base}-${slugify(t.name)}`, name: t.name.trim(), description: t.description || '' };
        if (!(Number(t.level) > 1)) delete out.level;
        return out;
      });
    },
  },

  class: {
    build(f, d) {
      const casterOpts = [{ value: 'none', label: 'None' }, ...opt(M.CASTER_KINDS)];
      d._caster = d.spellcasting?.kind || 'none';
      d._casterAbility = d.spellcasting?.ability || 'int';
      d._origInline = (d.features || []).map((x) => x.id).filter(Boolean);
      return [
        f.sec('Class',
          f.grid(
            f.fld('Hit die', f.sel('hitDie', [6, 8, 10, 12].map((n) => ({ value: String(n), label: `d${n}` })))),
            f.fld('Skill choices', f.num('skillChoices.choose', { min: 0, max: 6 }), { hint: 'How many skills a new character picks.' }),
            f.fld('Spellcasting', f.sel('_caster', casterOpts, { onChange: f.update })),
            f.dyn(() => (d._caster && d._caster !== 'none' ? f.fld('Spellcasting ability', f.sel('_casterAbility', M.ABILITY_IDS.map((a) => ({ value: a, label: M.abilityName(a) })))) : null))),
          f.fld('Primary ability', f.chips('primaryAbility', abilOpts(), { max: 2, label: 'Primary ability' }), { wide: true }),
          f.fld('Saving throw proficiencies', f.chips('saves', abilOpts(), { max: 2, label: 'Saving throws' }), { wide: true, hint: 'Pick two.' }),
          f.fld('Armor training', f.chips('proficiencies.armor', [{ value: 'light', label: 'Light' }, { value: 'medium', label: 'Medium' }, { value: 'heavy', label: 'Heavy' }, { value: 'shields', label: 'Shields' }], { label: 'Armor training' }), { wide: true }),
          f.fld('Weapon proficiencies', f.chips('proficiencies.weapons', [{ value: 'simple', label: 'Simple weapons' }, { value: 'martial', label: 'Martial weapons' }], { label: 'Weapons' }), { wide: true }),
          f.fld('Skills to choose from', f.chips('skillChoices.from', M.ruleList('skills').map((s) => ({ value: s.id, label: s.name })), { label: 'Skills' }), { wide: true })),
        f.fld('Description', f.mdEditor('description', { rows: 4 }), { wide: true }),
        f.sec('Class features', f.listEditor('features', {
          itemLabel: 'Feature', addLabel: 'Add feature', blank: () => ({ name: '', level: 1, description: '' }),
          fields: [{ key: 'name', label: 'Feature name' }, { key: 'level', label: 'Class level', type: 'number', min: 1, max: 20 }, { key: 'description', label: 'What it does', type: 'md' }],
        })),
      ];
    },
    validate(d) {
      const e = [];
      if ((d.saves || []).length !== 2) e.push({ path: 'saves', msg: 'Pick two saving throw proficiencies.' });
      if ((d.features || []).some((x) => blankStr(x.name) || !(Number(x.level) >= 1 && Number(x.level) <= 20))) e.push({ path: 'features', msg: 'Every feature needs a name and a level from 1 to 20.' });
      return e;
    },
    normalize(d) {
      d.hitDie = Number(d.hitDie) || 8;
      const kind = d._caster;
      d.spellcasting = kind && kind !== 'none'
        ? { ...(d.spellcasting || {}), ability: d._casterAbility || d.spellcasting?.ability || 'int', kind, prepared: true, list: d.spellcasting?.list || d.id }
        : null;
      delete d._caster; delete d._casterAbility;
      d.skillChoices = { choose: Number(d.skillChoices?.choose) || 0, from: d.skillChoices?.from || [] };
      d.proficiencies = { armor: [], weapons: [], tools: [], ...(d.proficiencies || {}) };
      d.features = (d.features || []).map((x) => ({ ...x, id: x.id || `${d.id}-${slugify(x.name)}`, name: x.name.trim(), level: Number(x.level), description: x.description || '' }));
      d.subclassLevel = d.subclassLevel || 3;
      // A level table the character engine can read, like the SRD classes (features referenced by id).
      // Feature ids that came from elsewhere (an SRD class being copied -> features.json) are kept;
      // inline features are re-placed at their (possibly edited) level, removed ones dropped.
      const inlineIds = new Set(d._origInline || []);
      delete d._origInline;
      d.levels = Array.from({ length: 20 }, (_, i) => {
        const prev = Array.isArray(d.levels) ? d.levels[i] : null;
        const kept = (prev?.features || []).filter((id) => !inlineIds.has(id) && !d.features.some((x) => x.id === id));
        return {
          ...(prev || {}), level: i + 1, prof: M.RULES.profBonusByLevel?.[i] ?? Math.ceil((i + 1) / 4) + 1,
          features: [...kept, ...d.features.filter((x) => x.level === i + 1).map((x) => x.id)], counters: prev?.counters || {},
        };
      });
    },
  },

  subclass: {
    build(f) {
      return [
        f.sec('Subclass',
          f.grid(
            f.fld('Class', f.sel('class', M.classOptions(), { blank: 'Choose…' }), { req: true }),
            f.fld('Summary', f.text('summary', { placeholder: 'One line, e.g. “Channel Rage into Violent Fury”' }), { wide: true }))),
        f.fld('Description', f.mdEditor('description', { rows: 4 }), { wide: true }),
        f.sec('Subclass features', f.listEditor('features', {
          itemLabel: 'Feature', addLabel: 'Add feature', blank: () => ({ name: '', level: 3, description: '' }),
          fields: [{ key: 'name', label: 'Feature name' }, { key: 'level', label: 'Class level', type: 'number', min: 1, max: 20 }, { key: 'description', label: 'What it does', type: 'md' }],
        })),
      ];
    },
    validate(d) {
      const e = [];
      if (!d.class) e.push({ path: 'class', msg: 'Choose the class this subclass belongs to.' });
      if ((d.features || []).some((x) => blankStr(x.name) || !(Number(x.level) >= 1 && Number(x.level) <= 20))) e.push({ path: 'features', msg: 'Every feature needs a name and a level from 1 to 20.' });
      return e;
    },
    normalize(d) {
      d.summary = (d.summary || '').trim();
      d.features = (d.features || []).map((x) => ({ ...x, id: x.id || `${d.id}-${slugify(x.name)}`, name: x.name.trim(), level: Number(x.level), description: x.description || '' }));
    },
  },

  background: {
    build(f, d) {
      const feats = cached('feat').filter((x) => x.category === 'origin').map((x) => ({ value: x.id, label: x.name }));
      const tools = [...cached('gear').filter((g) => g.tool).map((g) => ({ value: g.id, label: g.name }))].sort((a, b) => a.label.localeCompare(b.label));
      d._tool = d.tool?.id || '';
      return [
        f.sec('Background',
          f.fld('Ability scores', f.chips('abilityScores', abilOpts(), { max: 3, label: 'Ability scores' }), { wide: true, hint: 'Pick three. The player adds +2/+1 or +1/+1/+1 among them.' }),
          f.grid(
            f.fld('Origin feat', f.sel('feat.id', feats, { blank: 'None' })),
            f.fld('Feat note', f.text('feat.note', { placeholder: 'e.g. Cleric (for Magic Initiate)' })),
            f.fld('Tool proficiency', f.sel('_tool', tools, { blank: 'None' }))),
          f.fld('Skill proficiencies', f.chips('skills', M.ruleList('skills').map((s) => ({ value: s.id, label: s.name })), { max: 2, label: 'Skills' }), { wide: true, hint: 'Pick two.' }),
          f.fld('Starting equipment', f.text('equipment.text', { placeholder: 'e.g. (A) Dagger, Map, Traveler’s Clothes, 12 GP; or (B) 50 GP' }), { wide: true })),
        f.fld('Description', f.mdEditor('description', { rows: 5 }), { wide: true }),
      ];
    },
    validate(d) {
      const e = [];
      if ((d.abilityScores || []).length !== 3) e.push({ path: 'abilityScores', msg: 'Pick exactly three ability scores.' });
      if ((d.skills || []).length !== 2) e.push({ path: 'skills', msg: 'Pick exactly two skills.' });
      return e;
    },
    normalize(d) {
      d.feat = d.feat?.id ? { id: d.feat.id, note: blankStr(d.feat.note) ? null : d.feat.note.trim() } : null;
      d.tool = d._tool ? { id: d._tool, name: M.entryName('gear', d._tool) } : (d.tool && !d.tool.id ? d.tool : null);
      delete d._tool;
      d.equipment = { options: [], ...(d.equipment || {}), text: (d.equipment?.text || '').trim() };
    },
  },

  'location-type': {
    build(f, d) {
      if (!RANKS.some((r) => r.rank === Number(d.rank))) d.rank = d.major ? 1 : 3;
      const colors = pinColors();
      const preview = () => h('div', { class: 'cp-loc-preview' }, M.locationSwatch(d, 40), h('span', null, (d.name || '').trim() || 'New type'));
      const icons = h('div', { class: 'cp-icon-grid', role: 'radiogroup', 'aria-label': 'Icon' });
      const drawIcons = () => icons.replaceChildren(...M.MARKER_ICONS.map((ic) => {
        const svg = h('svg', { class: 'icon', 'aria-hidden': 'true' });
        svg.append(h('use', { href: `assets/img/icons.svg#${ic}` }));
        return h('button', {
          type: 'button', role: 'radio', class: ['cp-icon-opt', d.icon === ic && 'is-active'], 'aria-checked': String(d.icon === ic),
          title: M.prettify(ic.slice(3)), 'aria-label': M.prettify(ic.slice(3)),
          onclick: () => { f.set('icon', ic); drawIcons(); f.update(); },
        }, svg);
      }));
      drawIcons();
      const colorIn = h('input', { type: 'color', class: 'cp-color-input', value: /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : '#22507c', 'aria-label': 'Any colour', oninput: (e) => { f.set('color', e.target.value); drawSw(); f.update(); } });
      const sw = h('div', { class: 'cp-swatches', role: 'radiogroup', 'aria-label': 'Colour' });
      const drawSw = () => sw.replaceChildren(...colors.map((c) => h('button', {
        type: 'button', role: 'radio', class: ['cp-swatch-opt', String(d.color).toLowerCase() === c.toLowerCase() && 'is-active'],
        'aria-checked': String(String(d.color).toLowerCase() === c.toLowerCase()), style: { '--cp-pin': c }, title: c, 'aria-label': `Colour ${c}`,
        onclick: () => { f.set('color', c); colorIn.value = c; drawSw(); f.update(); },
      })), h('label', { class: 'cp-swatch-custom' }, colorIn, h('span', null, 'Any colour')));
      drawSw();
      return [
        f.dyn(preview),
        f.fld('Icon', icons, { wide: true }),
        f.fld('Colour', sw, { wide: true }),
        f.fld('Default rank', f.sel('rank', RANKS.map((r) => ({ value: String(r.rank), label: `${r.rank} · ${r.name} — ${r.hint}` }))),
          { wide: true, hint: 'Places of this type use it unless they pick their own rank. Rank 1 shows fully zoomed out; lower ranks appear as you zoom in.' }),
        d._builtin ? h('p', { class: 'muted cp-note' }, 'This changes the built-in type for everyone on the map.') : null,
      ];
    },
    validate: () => [],
    normalize(d) {
      d.rank = Math.min(4, Math.max(1, Math.round(Number(d.rank)) || 3));
      d.major = d.rank === 1; // kept in step for older readers of `major`
      if (!M.MARKER_ICONS.includes(d.icon)) d.icon = 'mk-custom';
      delete d._builtin;
    },
  },
};

// ---------- modal guard (don't lose a half-written entry to a stray click) ----------

function guardModal(m, isDirty) {
  const backdrop = m.el.parentElement;
  const host = backdrop?.parentElement;
  const ask = async () => {
    if (!isDirty() || (await confirmDialog('Discard this unsaved entry?', { title: 'Discard changes?', okLabel: 'Discard', danger: true }))) m.close();
  };
  m.dismiss = ask; // Escape
  const onDown = (e) => { if (e.target === backdrop && isDirty()) { e.stopPropagation(); ask(); } };
  const onClick = (e) => { if (e.target.closest?.('.modal-close') && isDirty()) { e.stopPropagation(); e.preventDefault(); ask(); } };
  host?.addEventListener('mousedown', onDown, true);
  m.el.addEventListener('click', onClick, true);
  return () => host?.removeEventListener('mousedown', onDown, true);
}

// ---------- public ----------

/**
 * openEntryEditor(kind, entry?) -> Promise<savedEntry|null>
 * entry: an existing entry (custom = edit in place; srd/stub/builtin = save a custom copy), a partial object to
 * prefill a new entry (e.g. {name}), or nothing.
 */
export async function openEntryEditor(kind, entry = null) {
  if (!FORMS[kind]) throw new Error(`Unknown compendium kind: ${kind}`);
  await Promise.all([M.rulesReady(), preloadAll().catch(() => null)]);
  const origin = entry?.origin || null;
  const isEdit = origin === 'custom';
  const isCopy = origin === 'srd' || origin === 'stub' || origin === 'builtin';
  const overrideBuiltin = kind === 'location-type' && origin === 'builtin';
  const src = clone(entry || {});
  const { path: _p, kind: _k, origin: _o, overrides: _ov, ...rest } = src;
  const d = { ...BLANK[kind](), ...rest };
  if (kind === 'weapon') d.weaponKind = M.weaponKind(entry || d);
  if (isCopy && !overrideBuiltin) {
    for (const k of ['stub', 'verify', 'source', 'legacy', 'createdBy', 'created', 'updated']) delete d[k];
    d.basedOn = { kind, id: entry.id, origin };
  }
  if (overrideBuiltin) d._builtin = true;
  // Edits keep their id (a built-in location type is overridden under its own id); others get one on submit.
  const freshId = !isEdit && !overrideBuiltin;
  d.id = freshId ? null : entry.id;

  return new Promise((resolve) => {
    let result = null;
    let dirty = false;
    const markDirty = () => { dirty = true; };
    const f = formKit(d, markDirty);
    const errBox = h('div', { class: 'callout cp-form-errors', 'data-callout': 'danger', role: 'alert', hidden: true });
    const nameHint = h('span', { class: 'field-hint' });
    const nameIn = f.text('name', {
      placeholder: `Name of the ${M.kindOne(kind).toLowerCase()}`, autofocus: true, maxlength: 120, autocomplete: 'off',
      oninput: () => { checkName(); if (kind === 'location-type') f.update(); },
    });
    const checkName = () => {
      const clash = nameClash(kind, d.name, d.id);
      const custom = clash.find((x) => x.origin === 'custom');
      const prefix = M.linkPrefix(kind);
      nameHint.textContent = custom ? `There is already a custom ${M.kindOne(kind).toLowerCase()} called “${custom.name}”.`
        : clash.length ? `The ${M.ORIGINS[clash[0].origin] || 'library'} entry has the same name${prefix ? `, and [[${prefix}:${d.name.trim()}]] links open that one` : ''}. A distinct name avoids mix-ups.` : '';
      nameHint.classList.toggle('field-error', !!custom);
      return custom;
    };
    checkName();

    const intro = isCopy && !overrideBuiltin
      ? h('p', { class: 'cp-note muted' }, `This saves your own copy of “${entry.name}” to the shared library. The original ${M.ORIGINS[origin] || ''} entry stays as it is.`)
      : null;
    const body = h('div', { class: ['cp-form', `cp-form-${kind}`] },
      errBox, intro,
      f.fld('Name', nameIn, { req: true, id: nameIn.id }), nameHint,
      FORMS[kind].build(f, d));

    const submit = async () => {
      d.name = String(d.name || '').trim();
      const errors = [];
      if (!d.name) errors.push({ path: 'name', msg: 'Give it a name.' });
      else if (checkName()) errors.push({ path: 'name', msg: nameHint.textContent });
      errors.push(...FORMS[kind].validate(d));
      body.querySelectorAll('[aria-invalid="true"]').forEach((x) => x.removeAttribute('aria-invalid'));
      if (errors.length) {
        errBox.replaceChildren(h('div', { class: 'callout-title' }, h('span', null, errors.length === 1 ? 'One thing to fix' : `${errors.length} things to fix`)),
          h('div', { class: 'callout-content' }, h('ul', null, errors.map((x) => h('li', null, x.msg)))));
        errBox.hidden = false;
        errors.forEach((x) => f.refs[x.path]?.setAttribute?.('aria-invalid', 'true'));
        const first = f.refs[errors[0].path];
        (first?.matches?.('input, select, textarea, button') ? first : first?.querySelector?.('input, select, textarea, button'))?.focus();
        if (!first) errBox.scrollIntoView({ block: 'nearest' });
        return false;
      }
      try {
        const payload = clone(d);
        // New entries and copies get their id now (from the final name), so normalize() can derive feature ids from it.
        if (freshId) payload.id = uid(payload.name);
        FORMS[kind].normalize(payload);
        if (!payload.created && !isEdit) payload.created = new Date().toISOString();
        const saved = saveCustom(kind, { ...payload, origin: 'custom' });
        await entries(kind).catch(() => null);
        result = { ...saved, path: `content/library/${kind}/${saved.id}.json` };
        toast(isEdit ? 'Saved to the shared library — Save to publish' : 'Added to the shared library — Save to publish', { type: 'success' });
        return true;
      } catch (e) {
        console.error(e);
        errBox.replaceChildren(h('div', { class: 'callout-title' }, h('span', null, `Could not save: ${e.message}`)));
        errBox.hidden = false;
        return false;
      }
    };

    const title = isEdit ? `Edit ${entry.name}` : isCopy ? (overrideBuiltin ? `Edit ${entry.name}` : `Custom copy of ${entry.name}`) : `New ${M.kindOne(kind).toLowerCase()}`;
    let unguard = () => {};
    const m = openModal({
      title,
      body,
      wide: true,
      className: 'cp-editor-modal',
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: async () => { if (dirty && !(await confirmDialog('Discard this unsaved entry?', { title: 'Discard changes?', okLabel: 'Discard', danger: true }))) return false; return true; } },
        { label: isEdit || overrideBuiltin ? 'Save changes' : 'Add to library', kind: 'primary', onClick: submit },
      ],
      onClose: () => { unguard(); resolve(result); },
    });
    unguard = guardModal(m, () => dirty && !result);
    body.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (await submit()) m.close(); }
    });
    if (store.mode === 'sandbox') body.append(h('p', { class: 'field-hint cp-note' }, 'Sandbox mode: the library entry stays in this browser.'));
  });
}

function nameClash(kind, name, selfId) {
  const k = nameKey(name);
  if (!k) return [];
  return M.listCached(kind).filter((e) => nameKey(e.name) === k && e.id !== selfId);
}
