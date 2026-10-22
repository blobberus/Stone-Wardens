// Edit-all menu (#/characters/<id>/edit[?s=section]): every stored field, every choice, extra proficiencies,
// overrides with computed hints, details, Advanced (special/custom abilities), delete.
import { h, mount } from '../../core/dom.js';
import { icon, toast, openModal, confirmDialog, input, select, field, markdownEditor, numberInput, checkbox, pickFromList } from '../../core/ui.js';
import { href, navigate } from '../../core/router.js';
import { uid, clone } from '../../core/util.js';
import { saveCustom } from '../../core/compendium.js';
import {
  VIEW, ABILITIES, DETAIL_FIELDS, getCharacter, persist, flushPersist, removeCharacter, normalize, totalLevel, prettify,
} from './data.js';
import {
  ready, isReady, onReady, cat, findEntry, entryName, derive, allChoices, skillList, toolList, languageList, profName, R,
  openPicker, openEntryEditor, describeModifiers, modifiersSummary, entrySubtitle, levelDown,
} from './bridge.js';
import { renderChoiceGroups, isAnswered, currentValue } from './choices.js';
import { renderScores } from './scores.js';
import { rerender, section, portraitField, md, fmt, chip, modifiersEditor, cleanModifiers, loading, entryModal } from './widgets.js';
import { openLevelUp } from './levelup.js';

const SECTIONS = [
  ['identity', 'Identity'], ['classes', 'Classes & levels'], ['origin', 'Species & background'], ['abilities', 'Ability scores'],
  ['choices', 'Choices'], ['proficiencies', 'Proficiencies'], ['feats', 'Feats'], ['spells', 'Spells'], ['overrides', 'Overrides'],
  ['advanced', 'Advanced abilities'], ['details', 'Details'], ['danger', 'Delete'],
];

const E = { root: null, id: null, char: null, ui: {} };

export function showEditor(root, id, sectionId, { reload = false } = {}) {
  E.root = root;
  if (reload || E.id !== id || !E.char) { if (E.id) flushPersist(E.id); E.id = id; E.char = getCharacter(id); E.ui = {}; }
  if (!E.char) {
    mount(root, h('div', { class: 'empty-state' }, icon('warning'), h('h3', null, 'Character not found'), h('div', { class: 'row' }, h('a', { class: 'btn', href: href(VIEW) }, 'All characters'))));
    return;
  }
  if (!isReady()) { mount(root, loading()); ready().then(() => { if (E.root === root && E.id === id) { render(); jump(sectionId); } }); return; }
  render();
  jump(sectionId);
}

export function hideEditor() { if (E.id) flushPersist(E.id); }

/** Remote change while the editor is open: reload unless a field is focused or a write is pending. */
export function editorExternalChange(id) {
  if (E.id !== id || !E.root?.isConnected || E.root.closest('[hidden]')) return;
  const a = document.activeElement;
  if (a && E.root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const fresh = getCharacter(id);
  if (fresh) { E.char = fresh; render(); }
}

export const currentEditorId = () => E.id;

onReady(() => { if (E.char && E.root?.isConnected && !E.root.closest('[hidden]')) render(); });

function jump(sectionId) {
  if (!sectionId) return;
  requestAnimationFrame(() => {
    const el = E.root.querySelector(`[data-sec="${CSS.escape(sectionId)}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function mutate(fn, { redraw = true } = {}) {
  fn(E.char);
  persist(E.char);
  if (redraw) render();
}

function render() {
  const c = E.char;
  const s = derive(c);
  const blankOv = { ...c, overrides: { ac: null, speed: null, initiative: null, hpMax: null, profBonus: null, passivePerception: null, abilities: {}, saves: {}, skills: {} } };
  const computed = derive(blankOv);
  const choices = allChoices(c, s);
  const ctx = { c, s, computed, choices };
  rerender(E.root, () => mount(E.root,
    h('header', { class: 'view-head' },
      h('h1', { class: 'view-title' }, `Edit ${c.name || 'character'}`),
      h('p', { class: 'view-sub' }, 'Every change applies instantly and is kept as a local draft; Save commits it for the party.'),
      h('div', { class: 'view-actions' },
        h('a', { class: 'btn btn-primary', href: href(VIEW, c.id) }, icon('check'), 'Back to sheet'))),
    h('div', { class: 'ch-editor' },
      h('nav', { class: 'ch-editor-nav', 'aria-label': 'Edit sections' }, h('ul', { role: 'list' }, SECTIONS.map(([id, label]) => {
        const n = id === 'choices' ? choices.filter((x) => !isAnswered(x, currentValue(x, c))).length : 0;
        return h('li', null, h('button', { class: 'nav-item', type: 'button', onclick: () => { history.replaceState(null, '', `${href(VIEW, c.id, 'edit')}?s=${id}`); jump(id); } },
          label, n ? h('span', { class: 'badge badge-warn' }, String(n)) : null));
      }))),
      h('div', { class: 'ch-editor-main stack-lg stack' },
        identity(ctx), classes(ctx), origin(ctx), abilities(ctx), choicesSec(ctx), proficiencies(ctx), feats(ctx), spells(ctx),
        overrides(ctx), advanced(ctx), details(ctx), danger(ctx)))));
}

// ---------- sections ----------

function identity({ c }) {
  return section('identity', 'Identity', { iconName: 'user' },
    h('div', { class: 'field-grid' },
      field('Name', input({ value: c.name, 'data-fk': 'e-name', onchange: (e) => mutate((x) => { x.name = e.target.value.trim(); }) })),
      field('Player', input({ value: c.player, 'data-fk': 'e-player', onchange: (e) => mutate((x) => { x.player = e.target.value.trim(); }) })),
      field('Experience points', numberInput(c.xp, (v) => mutate((x) => { x.xp = Math.max(0, v || 0); }), { min: 0, 'data-fk': 'e-xp' }), xpHint(c))),
    portraitField(c, (v) => mutate((x) => { x.portrait = v; })),
    h('p', { class: 'muted ui text-sm' }, `Created ${c.created ? new Date(c.created).toLocaleDateString() : '—'}${c.createdBy ? ` by ${c.createdBy}` : ''} · id ${c.id}`));
}

function xpHint(c) {
  const t = R().xpByLevel;
  const lvl = totalLevel(c);
  if (!t || lvl >= 20) return '';
  return `Level ${lvl + 1} at ${t[lvl]?.toLocaleString?.() ?? t[lvl]} XP`;
}

function classes({ c, s }) {
  const total = totalLevel(c);
  return section('classes', 'Classes & levels', {
    iconName: 'level-up',
    actions: [h('button', { class: 'btn btn-sm', type: 'button', disabled: total >= 20, onclick: () => { flushPersist(c.id); openLevelUp(E.char, { onApply: (next) => { E.char = next; persist(next); render(); toast(`Now level ${totalLevel(next)}.`, { type: 'success' }); } }); } }, icon('level-up'), total ? 'Level up…' : 'Add a class…')],
  },
  c.classes.length ? c.classes.map((row, ci) => {
    const cls = findEntry('class', row.id);
    const die = cls?.hitDie || 8;
    const subs = cat('subclass').filter((x) => x.class === row.id);
    const subLvl = cls?.subclassLevel || 3;
    return h('div', { class: 'ch-edit-class' },
      h('div', { class: 'row' },
        h('strong', { class: 'ch-edit-class-name' }, cls?.name || prettify(row.id)),
        h('span', { class: 'badge' }, `Level ${row.level}`), h('span', { class: 'badge' }, `d${die}`), ci === 0 ? h('span', { class: 'badge badge-info' }, 'first class') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => removeLevel(row.id) }, icon('minus'), row.level > 1 ? 'Remove a level' : 'Remove class')),
      field('Subclass', select([{ value: '', label: row.level < subLvl ? `— (chosen at level ${subLvl})` : '— none —' }, ...subs.map((x) => ({ value: x.id, label: `${x.name}${x.origin === 'stub' ? ` (${x.source || 'stub'})` : x.origin === 'custom' ? ' (custom)' : ''}` }))],
        row.subclass || '', (v) => mutate((x) => {
          const r = x.classes.find((y) => y.id === row.id);
          r.subclass = v || null;
          for (const k of Object.keys(x.choices)) if (/subclass@/.test(k) && k.includes(`@${row.id}:`)) { if (v) x.choices[k] = v; else delete x.choices[k]; }
        }), { 'data-fk': `e-sub-${row.id}` })),
      h('div', null, h('span', { class: 'field-label ui' }, 'Hit die result per level'),
        h('div', { class: 'ch-hp-level-grid' }, Array.from({ length: row.level }, (_, li) => h('label', { class: 'field ch-hp-level' },
          h('span', { class: 'field-hint' }, `L${li + 1}`),
          numberInput(row.hp?.[li] ?? '', (v) => mutate((x) => {
            const r = x.classes.find((y) => y.id === row.id);
            r.hp = Array.from({ length: r.level }, (_, i) => r.hp?.[i] ?? Math.floor(die / 2) + 1);
            r.hp[li] = Math.max(1, Math.min(die, v || 1));
          }), { class: 'input input-sm ch-w-num', min: 1, max: die, placeholder: String(Math.floor(die / 2) + 1), 'data-fk': `e-hp-${row.id}-${li}` }))))));
  }) : h('p', { class: 'muted' }, 'No class yet. Use “Add a class…”.'),
  h('p', { class: 'muted ui text-sm' }, `Total level ${total}. Maximum HP ${s.hpMax} (CON ${fmt(s.abilities.con.mod)} per level). Removing a level also clears the choices made at that level.`));
}

async function removeLevel(classId) {
  const c = E.char;
  const row = c.classes.find((r) => r.id === classId);
  if (!row) return;
  const name = entryName('class', classId);
  const msg = row.level > 1 ? `Remove ${name} level ${row.level}? Choices made at that level are cleared.` : `Remove the ${name} class entirely? Its choices are cleared.`;
  if (!(await confirmDialog(msg, { okLabel: 'Remove', danger: true }))) return;
  const wasLast = row.level <= 1;
  const next = levelDown(c, classId);
  if (wasLast) {
    // Removing the class entirely: also drop its level-1 picks (skills, tools) and its spells.
    for (const k of Object.keys(next.choices)) if (k.includes(`@${classId}:`)) delete next.choices[k];
    next.spells = next.spells.filter((sp) => sp.class !== classId);
    if (!next.classes.length) next.skills = [];
  }
  E.char = next;
  persist(next);
  render();
}

function isOriginChoice(x, c) {
  const bg = findEntry('background', c.background.id);
  return /^(species|background|origin):/.test(x.key) || ['species', 'subspecies', 'background', 'origin'].includes(x.sourceType)
    || (!!bg?.feat?.id && String(x.key).startsWith(`feat:${bg.feat.id}`) && !/@\d+/.test(String(x.key).split('/')[0]));
}

function origin({ c, s, choices }) {
  const sp = findEntry('species', c.species.id);
  const bg = findEntry('background', c.background.id);
  const list = choices.filter((x) => isOriginChoice(x, c));
  return section('origin', 'Species & background', { iconName: 'compass' },
    h('div', { class: 'field-grid' },
      field('Species', select([{ value: '', label: '— none —' }, ...cat('species').map((x) => ({ value: x.id, label: `${x.name}${x.origin === 'stub' ? ` (${x.source || 'stub'})` : ''}` }))], c.species.id || '', (v) => mutate((x) => {
        for (const k of Object.keys(x.choices)) if (k.startsWith('species:')) delete x.choices[k];
        x.species = { id: v || null, subspecies: null, size: null };
      }), { 'data-fk': 'e-species' })),
      field('Background', select([{ value: '', label: '— none —' }, ...cat('background').map((x) => ({ value: x.id, label: `${x.name}${x.origin === 'stub' ? ` (${x.source || 'stub'})` : ''}` }))], c.background.id || '', (v) => mutate((x) => {
        const old = findEntry('background', x.background.id);
        for (const k of Object.keys(x.choices)) if (k.startsWith('background:') || (old?.feat?.id && k.startsWith(`feat:${old.feat.id}`))) delete x.choices[k];
        x.background = { id: v || null, abilityBonuses: {} };
      }), { 'data-fk': 'e-bg' }))),
    sp || bg ? renderChoiceGroups(list, { char: c, sheet: s, mutate }, { empty: 'Nothing to choose here.' }) : null);
}

function abilities({ c, s }) {
  return section('abilities', 'Ability scores', { iconName: 'd20' }, renderScores({ char: c, sheet: s, mutate, ui: E.ui }));
}

function choicesSec({ c, s, choices }) {
  const open = choices.filter((x) => !isAnswered(x, currentValue(x, c))).length;
  return section('choices', 'Choices', { iconName: 'check', sub: open ? `${open} open` : 'All made' },
    h('p', { class: 'muted ui text-sm' }, 'Re-open any menu from your classes, levels and feats. Species and background choices are in “Species & background” above.'),
    renderChoiceGroups(choices, { char: c, sheet: s, mutate }, { empty: 'No class choices yet: add a class first.', exclude: (x) => isOriginChoice(x, c) }));
}

const PROF_KINDS = [
  ['skills', 'Skills'], ['expertise', 'Expertise'], ['saves', 'Saving throws'], ['armor', 'Armor'], ['weapons', 'Weapons'], ['tools', 'Tools'], ['languages', 'Languages'],
];

function profOptions(kind) {
  switch (kind) {
    case 'skills': case 'expertise': return skillList().map((x) => ({ id: x.id, name: x.name }));
    case 'saves': return ABILITIES.map((a) => ({ id: a.id, name: a.full }));
    case 'armor': return ['light', 'medium', 'heavy', 'shields'].map((id) => ({ id, name: profName('armor', id) }));
    case 'weapons': return [...['simple', 'martial', 'improvised'].map((id) => ({ id, name: profName('weapons', id) })), ...cat('weapon').map((w) => ({ id: w.id, name: w.name }))];
    case 'tools': return toolList().map((t) => ({ id: t.id, name: t.name, meta: prettify(t.category) }));
    case 'languages': return languageList().map((l) => ({ id: l.id, name: l.name, meta: l.rare ? 'rare' : '' }));
    default: return [];
  }
}

function proficiencies({ c, s }) {
  return section('proficiencies', 'Extra proficiencies', { iconName: 'book-open', sub: 'On top of what class, species, background and feats grant.' },
    h('div', { class: 'stack' }, PROF_KINDS.map(([kind, label]) => {
      const list = c.extraProficiencies[kind] || [];
      const add = async () => {
        const opts = profOptions(kind).filter((o) => !list.includes(o.id));
        const res = await pickFromList({ title: `Add ${label.toLowerCase()}`, items: opts, multi: true, render: (o) => h('div', { class: 'picker-item-main' }, h('span', { class: 'picker-item-title' }, o.name), o.meta ? h('small', { class: 'muted' }, o.meta) : null), search: (o) => o.name });
        if (res?.length) mutate((x) => { x.extraProficiencies[kind] = [...new Set([...(x.extraProficiencies[kind] || []), ...res.map((o) => o.id)])]; });
      };
      return h('div', { class: 'ch-prof-edit' },
        h('h4', { class: 'ch-mini-head' }, label),
        h('div', { class: 'row ch-chip-row' },
          list.map((id) => chip(profName(kind, id), { onRemove: () => mutate((x) => { x.extraProficiencies[kind] = x.extraProficiencies[kind].filter((y) => y !== id); }) })),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: add }, icon('plus'), 'Add')));
    })),
    h('p', { class: 'muted ui text-sm' }, `All armor: ${(s.proficiencies.armor || []).map((x) => profName('armor', x)).join(', ') || '—'} · Languages: ${(s.languages || []).map((x) => profName('languages', x)).join(', ') || '—'}`));
}

function feats({ c, s }) {
  const add = async () => {
    const res = await openPicker('feat', { title: 'Add a feat', multi: true });
    const picked = [].concat(res || []).filter(Boolean);
    if (picked.length) mutate((x) => { picked.forEach((f) => x.feats.push({ id: f.id, from: 'extra' })); });
  };
  const granted = s.features.filter((f) => f.source === 'Feat' || f.sourceType === 'feat');
  return section('feats', 'Feats', { iconName: 'star', actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: add }, icon('plus'), 'Add feat')] },
    h('p', { class: 'muted ui text-sm' }, 'Feats from your background, species and Ability Score Improvements are chosen in Choices. Add extra feats (DM rewards, boons) here.'),
    c.feats.length ? h('ul', { class: 'ch-edit-list', role: 'list' }, c.feats.map((f, i) => {
      const id = typeof f === 'object' ? f.id : f;
      const e = findEntry('feat', id);
      return h('li', { class: 'row' },
        e ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(e) }, e.name) : prettify(id),
        h('span', { class: 'muted ui text-xs' }, e ? entrySubtitle(e) : 'unknown feat'),
        typeof f === 'object' && f.from ? h('span', { class: 'badge' }, prettify(f.from)) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove ${e?.name || id}`, title: 'Remove', onclick: () => mutate((x) => { x.feats.splice(i, 1); }) }, icon('trash')));
    })) : h('p', { class: 'faint ui text-sm' }, 'No extra feats.'),
    granted.length ? h('p', { class: 'ui text-sm' }, h('strong', null, 'All feats on the sheet: '), [...new Set(granted.map((f) => f.name))].join(', ')) : null);
}

function spells({ c, s }) {
  const casters = s.spellcasting.map((x) => x.class);
  const classOpts = [{ value: '', label: '— other —' }, ...[...new Set([...casters, ...c.classes.map((r) => r.id)])].map((id) => ({ value: id, label: entryName('class', id) }))];
  const add = async () => {
    const res = await openPicker('spell', { title: 'Add spells', multi: true });
    const picked = [].concat(res || []).filter(Boolean);
    if (picked.length) mutate((x) => { picked.forEach((e) => x.spells.push({ id: e.id, class: casters[0] || null, prepared: true, always: false })); });
  };
  return section('spells', 'Spells', { iconName: 'sparkle', actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: add }, icon('plus'), 'Add spells')] },
    c.spells.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense' },
      h('thead', null, h('tr', null, h('th', null, 'Spell'), h('th', { class: 'num' }, 'Level'), h('th', null, 'Class'), h('th', { class: 'center' }, 'Prepared'), h('th', { class: 'center' }, 'Always'), h('th', { class: 'cell-actions' }, h('span', { class: 'sr-only' }, 'Remove')))),
      h('tbody', null, c.spells.map((sp, i) => {
        const e = findEntry('spell', sp.id);
        return h('tr', null,
          h('td', { class: 'cell-name' }, e ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(e) }, e.name) : prettify(sp.id)),
          h('td', { class: 'num' }, e ? (e.level ? String(e.level) : 'C') : '—'),
          h('td', null, select(classOpts, sp.class || '', (v) => mutate((x) => { x.spells[i].class = v || null; }), { class: 'select input-sm', 'aria-label': 'Class', 'data-fk': `e-spc-${i}` })),
          h('td', { class: 'center' }, h('input', { type: 'checkbox', class: 'checkbox', checked: !!sp.prepared, 'aria-label': 'Prepared', 'data-fk': `e-spp-${i}`, onchange: (ev) => mutate((x) => { x.spells[i].prepared = ev.target.checked; }) })),
          h('td', { class: 'center' }, h('input', { type: 'checkbox', class: 'checkbox', checked: !!sp.always, 'aria-label': 'Always prepared', 'data-fk': `e-spa-${i}`, onchange: (ev) => mutate((x) => { x.spells[i].always = ev.target.checked; }) })),
          h('td', { class: 'cell-actions' }, h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove ${e?.name || sp.id}`, title: 'Remove', onclick: () => mutate((x) => { x.spells.splice(i, 1); }) }, icon('trash'))));
      })))) : h('p', { class: 'faint ui text-sm' }, 'No spells recorded.'),
    h('p', { class: 'muted ui text-sm' }, 'Spells granted by features, species and feats are listed on the sheet automatically and don’t need to be added here.'));
}

function overrides({ c, s, computed }) {
  const ov = c.overrides;
  const num = (key, label, value) => field(label,
    numberInput(ov[key] ?? '', (v) => mutate((x) => { x.overrides[key] = v; }), { placeholder: String(value ?? ''), 'data-fk': `ov-${key}` }),
    `Computed: ${value ?? '—'}${ov[key] != null ? ' · overridden' : ''}`);
  return section('overrides', 'Overrides', {
    iconName: 'settings',
    sub: 'Leave blank to use the computed value.',
    actions: [h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => mutate((x) => { x.overrides = { ac: null, speed: null, initiative: null, hpMax: null, profBonus: null, passivePerception: null, abilities: {}, saves: {}, skills: {} }; }) }, icon('undo'), 'Clear all')],
  },
  h('div', { class: 'field-grid' },
    num('ac', 'Armor Class', computed.ac.value),
    num('speed', 'Speed (ft)', computed.speed.walk),
    num('initiative', 'Initiative', computed.initiative),
    num('hpMax', 'Hit point maximum', computed.hpMax),
    num('profBonus', 'Proficiency bonus', computed.profBonus),
    num('passivePerception', 'Passive Perception', computed.passive.perception)),
  h('h4', { class: 'ch-mini-head' }, 'Ability scores (replace)'),
  h('div', { class: 'ch-mod-grid ch-mod-grid-6' }, ABILITIES.map((a) => field(a.name,
    numberInput(ov.abilities[a.id] ?? '', (v) => mutate((x) => { if (v == null) delete x.overrides.abilities[a.id]; else x.overrides.abilities[a.id] = v; }), { class: 'input input-sm', placeholder: String(computed.abilities[a.id].score), 'data-fk': `ov-ab-${a.id}` }),
    `= ${computed.abilities[a.id].score}`))),
  h('h4', { class: 'ch-mini-head' }, 'Saving throws (flat bonus)'),
  h('div', { class: 'ch-mod-grid ch-mod-grid-6' }, ABILITIES.map((a) => field(a.name,
    numberInput(ov.saves[a.id] ?? '', (v) => mutate((x) => { if (!v) delete x.overrides.saves[a.id]; else x.overrides.saves[a.id] = v; }), { class: 'input input-sm', placeholder: '0', 'data-fk': `ov-sv-${a.id}` }),
    `now ${fmt(s.abilities[a.id].save)}`))),
  h('h4', { class: 'ch-mini-head' }, 'Skills (flat bonus)'),
  h('div', { class: 'ch-mod-grid ch-mod-grid-skills' }, skillList().map((sk) => field(sk.name,
    numberInput(ov.skills[sk.id] ?? '', (v) => mutate((x) => { if (!v) delete x.overrides.skills[sk.id]; else x.overrides.skills[sk.id] = v; }), { class: 'input input-sm', placeholder: '0', 'data-fk': `ov-sk-${sk.id}` }),
    `now ${fmt(s.skills[sk.id].bonus)}`))));
}

// ---------- Advanced: special & custom abilities ----------

function advanced({ c }) {
  const fromCompendium = async () => {
    const res = await openPicker(['ability', 'feat'], { title: 'Add a special ability or feat', multi: true });
    const picked = [].concat(res || []).filter(Boolean);
    if (!picked.length) return;
    mutate((x) => {
      for (const e of picked) {
        if (e.kind === 'feat') x.feats.push({ id: e.id, from: 'extra' });
        else x.abilities.push({ ref: `ability/${e.id}` });
      }
    });
    toast(`Added ${picked.map((e) => e.name).join(', ')}.`);
  };
  const createShared = async () => {
    const saved = await openEntryEditor('ability');
    if (saved) { mutate((x) => { x.abilities.push({ ref: `ability/${saved.id}` }); }); toast(`${saved.name} saved to the library and added.`, { type: 'success' }); }
  };
  return section('advanced', 'Advanced: special abilities', {
    iconName: 'sparkle',
    actions: [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: fromCompendium }, icon('compendium'), 'From compendium'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: createShared }, icon('plus'), 'New (shared library)'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editInline(null) }, icon('edit'), 'New (this character only)')],
  },
  h('p', { class: 'muted ui text-sm' }, 'Boons, blessings, homebrew powers and DM rewards. Modifiers (AC, speed, scores, saves, skills, attack, damage, spell DC…) are added to the sheet automatically.'),
  c.abilities.length ? h('div', { class: 'stack' }, c.abilities.map((ab, i) => {
    const refId = ab.ref ? String(ab.ref).replace(/^ability\//, '') : null;
    const base = refId ? findEntry('ability', refId) : null;
    const rec = { ...(base || {}), ...ab };
    const mods = rec.modifiers ? (modifiersSummary(rec.modifiers) || describeModifiers(rec.modifiers)) : '';
    return h('div', { class: 'ch-ability card' },
      h('div', { class: 'row' },
        h('strong', null, rec.name || prettify(refId) || 'Custom ability'),
        h('span', { class: 'badge' }, refId ? (base ? (base.origin === 'custom' ? 'library' : prettify(base.origin)) : 'missing from library') : 'this character'),
        rec.uses ? h('span', { class: 'badge' }, `${rec.uses} use${rec.uses === 1 ? '' : 's'}${rec.recharge ? ` / ${rec.recharge} rest` : ''}`) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit', 'aria-label': `Edit ${rec.name}`, onclick: () => (refId && base && !ab.name ? editShared(base) : editInline(i)) }, icon('edit')),
        refId && base && !ab.name ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Copy into this character to tweak it without changing the library', onclick: () => mutate((x) => { const { id: _i, kind: _k, origin: _o, path: _p, ...rest } = base; x.abilities[i] = { ...clone(rest), ...x.abilities[i], name: base.name, ref: undefined }; delete x.abilities[i].ref; }) }, icon('copy'), 'Make local copy') : null,
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove', 'aria-label': `Remove ${rec.name}`, onclick: async () => { if (await confirmDialog(`Remove ${rec.name || 'this ability'} from ${c.name}?`, { okLabel: 'Remove', danger: true })) mutate((x) => { x.abilities.splice(i, 1); }); } }, icon('trash'))),
      rec.description ? md(rec.description) : null,
      mods ? h('p', { class: 'ui text-sm accent' }, mods) : null);
  })) : h('p', { class: 'faint ui text-sm' }, 'No special abilities yet.'));
}

async function editShared(entry) {
  const saved = await openEntryEditor('ability', entry);
  if (saved) { toast(`${saved.name} updated in the library.`); render(); }
}

function editInline(index) {
  const existing = index == null ? null : E.char.abilities[index];
  const draft = clone(existing) || { name: '', description: '', uses: null, recharge: '', modifiers: {} };
  delete draft.ref;
  const desc = markdownEditor({ value: draft.description || '', rows: 5, onInput: (v) => { draft.description = v; } });
  const mods = modifiersEditor(draft.modifiers || {}, (m) => { draft.modifiers = m; });
  const nameIn = input({ value: draft.name || '', placeholder: 'e.g. Stoneborn Grit', autofocus: true });
  openModal({
    title: existing ? `Edit ${existing.name || 'ability'}` : 'New special ability',
    wide: true,
    body: h('div', { class: 'stack' },
      field('Name', nameIn),
      field('Description', desc, 'Markdown; [[links]] work.'),
      h('div', { class: 'field-grid' },
        field('Uses', numberInput(draft.uses ?? '', (v) => { draft.uses = v; }, { min: 0, placeholder: 'unlimited' })),
        field('Recharge', select([{ value: '', label: '—' }, { value: 'short', label: 'Short or long rest' }, { value: 'long', label: 'Long rest' }], draft.recharge || '', (v) => { draft.recharge = v; }))),
      h('h3', { class: 'ch-mini-head' }, 'Modifiers'), mods,
      h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', id: 'ch-ab-share' }), h('span', null, 'Also save to the shared library (Compendium → Abilities)'))),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: (m) => {
          const name = nameIn.value.trim();
          if (!name) { toast('Give the ability a name.', { type: 'error' }); return false; }
          const rec = { name, description: draft.description || '', uses: draft.uses || null, recharge: draft.recharge || null, modifiers: cleanModifiers(draft.modifiers) };
          if (!rec.uses) delete rec.uses;
          if (!rec.recharge) delete rec.recharge;
          if (!Object.keys(rec.modifiers).length) delete rec.modifiers;
          const share = m.el.querySelector('#ch-ab-share')?.checked;
          if (share) {
            const saved = saveCustom('ability', rec);
            mutate((x) => { if (index == null) x.abilities.push({ ref: `ability/${saved.id}` }); else x.abilities[index] = { ref: `ability/${saved.id}` }; });
            toast(`${name} saved to the library.`, { type: 'success' });
            return true;
          }
          mutate((x) => { if (index == null) x.abilities.push(rec); else x.abilities[index] = rec; });
          return true;
        },
      },
    ],
  });
}

// ---------- details & danger ----------

function details({ c }) {
  const short = DETAIL_FIELDS.filter((f) => !f.long);
  const long = DETAIL_FIELDS.filter((f) => f.long);
  return section('details', 'Details & story', { iconName: 'journal' },
    h('div', { class: 'field-grid' }, short.map((f) => field(f.label, f.type === 'alignment'
      ? select([{ value: '', label: '—' }, ...(R().alignments || []).map((a) => ({ value: a.id, label: a.name }))], c.details[f.key], (v) => mutate((x) => { x.details[f.key] = v; }), { 'data-fk': `ed-${f.key}` })
      : input({ value: c.details[f.key] || '', 'data-fk': `ed-${f.key}`, onchange: (e) => mutate((x) => { x.details[f.key] = e.target.value; }, { redraw: false }) }), f.hint))),
    [...long, { key: 'notes', label: 'Notes', long: true }].map((f) => field(f.label, markdownEditor({ value: c.details[f.key] || '', rows: 3, onInput: (v) => { E.char.details[f.key] = v; persist(E.char); } }), f.hint)));
}

function danger({ c }) {
  return section('danger', 'Duplicate or delete', { iconName: 'warning' },
    h('div', { class: 'row' },
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const copy = normalize(clone(E.char));
          copy.name = `${E.char.name || 'Character'} (copy)`;
          copy.id = uid(copy.name);
          copy.created = new Date().toISOString();
          persist(copy, { now: true });
          toast(`Created ${copy.name}.`);
          navigate(href(VIEW, copy.id));
        },
      }, icon('copy'), 'Duplicate'),
      h('button', {
        class: 'btn btn-danger', type: 'button',
        onclick: async () => {
          if (!(await confirmDialog(`Delete ${c.name || 'this character'}? The sheet is removed from the repository with the next Save. Journal links to it will show as unresolved.`, { title: 'Delete character', okLabel: 'Delete', danger: true }))) return;
          removeCharacter(c.id);
          E.char = null; E.id = null;
          toast(`${c.name || 'Character'} deleted. Save to apply it to the repository.`);
          navigate(href(VIEW));
        },
      }, icon('trash'), 'Delete character')));
}
