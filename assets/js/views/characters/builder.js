// Creation menu (#/characters/new): a skippable, revisitable stepper with a live summary.
// Name → Class & level (+ multiclass) → Subclass → Species → Background → Ability scores →
// Class choices → Hit points → Spells → Details. Inventory starts empty (by design).
import { h, mount } from '../../core/dom.js';
import { icon, toast, input, select, field, markdownEditor, numberInput, confirmDialog, pickFromList } from '../../core/ui.js';
import { href, navigate } from '../../core/router.js';
import { store } from '../../core/store.js';
import { uid, nameKey, clone } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';
import { saveSoon, majorSaveOn } from '../../core/saving.js';
import { VIEW, ABILITIES, DETAIL_FIELDS, normalize, persist, totalLevel, prettify } from './data.js';
import {
  ready, isReady, cat, findEntry, entryName, derive, allChoices, newCharacter, canMulticlass, skillName, R, entrySubtitle, onReady,
  availableSpells,
} from './bridge.js';
import { renderChoiceGroups, isAnswered, currentValue } from './choices.js';
import { renderScores, setMethod } from './scores.js';
import { rerender, portrait, portraitField, md, fmt, rollDie, loading, entryModal } from './widgets.js';

const STEPS = [
  { id: 'identity', label: 'Name & portrait' },
  { id: 'class', label: 'Class & level' },
  { id: 'subclass', label: 'Subclass' },
  { id: 'species', label: 'Species' },
  { id: 'background', label: 'Background' },
  { id: 'abilities', label: 'Ability scores' },
  { id: 'choices', label: 'Class choices' },
  { id: 'hp', label: 'Hit points' },
  { id: 'spells', label: 'Spells' },
  { id: 'details', label: 'Details' },
];

const KEY = () => `sw:ch:builder:${store.scope || 'local'}`;
const B = { root: null, char: null, step: 0, hpMode: 'average', ui: {}, q: { species: '', background: '' } };
let saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY(), JSON.stringify({ char: B.char, step: B.step, hpMode: B.hpMode, ui: B.ui })); } catch { /* quota */ }
  }, 300);
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY()) || 'null');
    if (s?.char) { B.char = normalize(s.char); B.step = Math.min(STEPS.length - 1, Number(s.step) || 0); B.hpMode = s.hpMode || 'average'; B.ui = s.ui || {}; return true; }
  } catch { /* corrupt */ }
  return false;
}

function fresh() {
  B.char = newCharacter({ name: '', player: getSetting('playerName') || '' });
  B.char.abilityMethod = 'standard';
  B.step = 0;
  B.hpMode = 'average';
  B.ui = {};
  setMethod(B.char, 'standard', B.ui);
  saveState();
}

export function showBuilder(root) {
  B.root = root;
  if (!B.char && !loadState()) fresh();
  if (!isReady()) {
    mount(root, loading('Opening the rulebooks…'));
    ready().then(() => { if (B.root === root) render(); });
    return;
  }
  render();
}

onReady(() => { if (B.root?.isConnected && !B.root.closest('[hidden]') && B.char && location.hash.startsWith(`#/${VIEW}/new`)) render(); });

function mutate(fn) {
  fn(B.char);
  ensureHp(B.char, B.hpMode);
  saveState();
  render();
}

/** Keep classes[].hp sized to levels; first class level 1 = max die. */
function ensureHp(char, mode) {
  char.classes.forEach((row, ci) => {
    const die = findEntry('class', row.id)?.hitDie || 8;
    const avg = Math.floor(die / 2) + 1;
    row.hp = (row.hp || []).slice(0, row.level);
    while (row.hp.length < row.level) row.hp.push(mode === 'roll' ? rollDie(die) : avg);
    if (ci === 0 && row.hp.length) row.hp[0] = die;
  });
}

function go(i) {
  B.step = Math.max(0, Math.min(STEPS.length - 1, i));
  saveState();
  render();
  B.root.closest('.view')?.scrollTo({ top: 0 });
}

// ---------- choice partitions per step ----------

const isSpeciesChoice = (c) => /^species:/.test(c.key) || c.sourceType === 'species' || c.sourceType === 'subspecies';
function isBackgroundChoice(c, char) {
  const bg = findEntry('background', char.background.id);
  return /^(background|origin):/.test(c.key) || c.sourceType === 'background' || c.sourceType === 'origin'
    || (bg?.feat?.id && String(c.key).startsWith(`feat:${bg.feat.id}`));
}
const isSubclassChoice = (c) => c.type === 'subclass';

function partition(choices, char) {
  const species = choices.filter(isSpeciesChoice);
  const background = choices.filter((c) => !isSpeciesChoice(c) && isBackgroundChoice(c, char));
  const subclass = choices.filter(isSubclassChoice);
  const rest = choices.filter((c) => !species.includes(c) && !background.includes(c) && !subclass.includes(c));
  return { species, background, subclass, rest };
}

const openCount = (list, char) => list.filter((c) => !isAnswered(c, currentValue(c, char))).length;

// ---------- render ----------

function render() {
  if (!B.root || !B.char) return;
  const c = B.char;
  const s = derive(c);
  B.sheet = s;
  const choices = allChoices(c, s);
  const parts = partition(choices, c);
  const open = {
    subclass: openCount(parts.subclass, c), species: openCount(parts.species, c), background: openCount(parts.background, c),
    choices: openCount(parts.rest, c),
  };
  const ctx = { char: c, sheet: s, mutate, choices, parts, open };
  const step = STEPS[B.step];
  const body = STEP_RENDER[step.id](ctx);
  rerender(B.root, () => mount(B.root,
    h('header', { class: 'view-head' },
      h('h1', { class: 'view-title' }, 'New character'),
      h('p', { class: 'view-sub' }, 'Every step can be skipped and revisited. Nothing is saved until you create the sheet; your progress is kept on this device.'),
      h('div', { class: 'view-actions' },
        h('a', { class: 'btn btn-ghost', href: href(VIEW) }, icon('chevron-left'), 'Roster'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: startOver }, icon('undo'), 'Start over'))),
    h('div', { class: 'ch-builder' },
      h('nav', { class: 'ch-steps', 'aria-label': 'Steps' }, h('ol', { role: 'list' }, STEPS.map((st, i) => {
        const n = open[st.id] || 0;
        return h('li', null, h('button', {
          type: 'button', class: ['ch-step', i === B.step && 'is-active', i < B.step && 'is-past'], 'aria-current': i === B.step ? 'step' : null,
          onclick: () => go(i),
        }, h('span', { class: 'ch-step-n num' }, String(i + 1)), h('span', { class: 'ch-step-label' }, st.label), n ? h('span', { class: 'badge badge-warn', title: `${n} open choice${n === 1 ? '' : 's'}` }, String(n)) : null));
      }))),
      h('section', { class: 'ch-builder-main panel', 'aria-labelledby': 'ch-step-title' },
        h('header', { class: 'panel-head' }, h('h2', { class: 'ch-sec-title', id: 'ch-step-title' }, `${B.step + 1}. ${step.label}`)),
        h('div', { class: 'panel-body stack' }, body),
        h('footer', { class: 'panel-foot ch-builder-foot' },
          h('button', { class: 'btn btn-ghost', type: 'button', disabled: B.step === 0, onclick: () => go(B.step - 1) }, icon('chevron-left'), 'Back'),
          h('span', { class: 'spacer' }),
          B.step < STEPS.length - 1 ? h('button', { class: 'btn', type: 'button', onclick: () => go(B.step + 1) }, 'Skip') : null,
          B.step < STEPS.length - 1
            ? h('button', { class: 'btn', type: 'button', onclick: () => go(B.step + 1) }, 'Next', icon('chevron-right'))
            : null,
          h('button', { class: 'btn btn-primary', type: 'button', onclick: create }, icon('check'), 'Create character'))),
      summary(ctx))));
}

async function startOver() {
  if (!(await confirmDialog('Throw away this unfinished character and start again?', { okLabel: 'Start over', danger: true }))) return;
  fresh();
  render();
}

function summary({ char: c, sheet: s, open }) {
  const lvl = totalLevel(c);
  const profSkills = Object.entries(s.skills).filter(([, x]) => x.prof).map(([id, x]) => `${skillName(id)}${x.expertise ? ' (E)' : ''}`);
  const totalOpen = Object.values(open).reduce((a, b) => a + b, 0);
  return h('aside', { class: 'ch-summary panel', 'aria-label': 'Live summary' },
    h('div', { class: 'panel-body stack stack-sm' },
      h('div', { class: 'row row-nowrap' }, portrait(c, { size: 'sm' }), h('div', null,
        h('h3', { class: 'card-title' }, c.name || 'Unnamed'),
        h('p', { class: 'card-sub' }, [lvl ? `Level ${lvl}` : 'No class yet', c.species.id ? entryName('species', c.species.id) : null].filter(Boolean).join(' · ')),
        s.classLine ? h('p', { class: 'ch-card-line' }, s.classLine) : null,
        c.background.id ? h('p', { class: 'ch-card-line' }, entryName('background', c.background.id)) : null)),
      h('dl', { class: 'ch-card-stats' },
        sumStat('HP', s.hpMax), sumStat('AC', s.ac.value), sumStat('Init', fmt(s.initiative)), sumStat('Speed', s.speed.walk ?? 30), sumStat('Prof', fmt(s.profBonus)), sumStat('Passive', s.passive.perception)),
      h('div', { class: 'ch-sum-abil' }, ABILITIES.map((a) => h('div', { class: 'ch-sum-ab' },
        h('span', { class: 'ch-card-ab-name' }, a.name), h('strong', { class: 'num' }, String(s.abilities[a.id].score)), h('span', { class: 'num muted' }, fmt(s.abilities[a.id].mod)),
        s.abilities[a.id].saveProf ? h('span', { class: 'ch-save-dot', title: 'Saving throw proficiency' }) : null))),
      profSkills.length ? h('p', { class: 'ui text-sm' }, h('strong', null, 'Skills: '), profSkills.join(', ')) : null,
      s.languages.length ? h('p', { class: 'ui text-sm' }, h('strong', null, 'Languages: '), s.languages.map((l) => (R().languages || []).find((x) => x.id === l)?.name || prettify(l)).join(', ')) : null,
      totalOpen ? h('p', { class: 'ui text-sm' }, h('span', { class: 'badge badge-warn' }, `${totalOpen} open`), ' choices left — fine to finish later.') : h('p', { class: 'ui text-sm muted' }, 'No open choices.'),
      s.warnings.length ? h('details', { class: 'ui text-sm' }, h('summary', { class: 'muted' }, `${s.warnings.length} note${s.warnings.length === 1 ? '' : 's'}`), h('ul', null, s.warnings.slice(0, 12).map((w) => h('li', null, String(w))))) : null));
}

const sumStat = (label, value) => h('div', { class: 'ch-card-stat' }, h('dt', null, label), h('dd', { class: 'num' }, String(value)));

// ---------- steps ----------

const STEP_RENDER = {
  identity({ char: c }) {
    return [
      h('div', { class: 'field-grid' },
        field('Character name', input({ value: c.name, placeholder: 'e.g. Ysolde of the Grey Cairn', autofocus: true, 'data-fk': 'b-name', onchange: (e) => mutate((x) => { x.name = e.target.value.trim(); }) })),
        field('Player', input({ value: c.player, placeholder: 'Who plays them', 'data-fk': 'b-player', onchange: (e) => mutate((x) => { x.player = e.target.value.trim(); }) }))),
      portraitField(c, (v) => mutate((x) => { x.portrait = v; })),
      h('p', { class: 'muted ui text-sm' }, 'Tip: the sheet shows up on the roster by this name, and [[char:Name]] links to it from any note.'),
    ];
  },

  class({ char: c, sheet: s }) {
    const primary = c.classes[0];
    const total = totalLevel(c);
    const classes = cat('class');
    const pickPrimary = (id) => mutate((x) => {
      const old = x.classes[0];
      if (old?.id === id) return;
      if (old) dropClassChoices(x, old.id);
      const lvl = old?.level || 1;
      x.classes = [{ id, level: lvl, subclass: null, hp: [] }, ...x.classes.slice(1).filter((r) => r.id !== id)];
      x.skills = [];
      // Until the player touches the scores, keep the standard array in the order that suits the class.
      if (x.abilityMethod === 'standard' && !B.ui.scoresTouched) { x.baseAbilities.str = 0; setMethod(x, 'standard', B.ui); }
    });
    return [
      h('div', { class: 'ch-cards ch-class-cards' }, classes.map((cls) => {
        const on = primary?.id === cls.id;
        return h('button', { type: 'button', class: ['ch-optcard', on && 'is-selected'], 'aria-pressed': String(on), onclick: () => pickPrimary(cls.id), 'data-fk': `cls-${cls.id}` },
          h('span', { class: 'ch-optcard-head' }, h('span', { class: 'ch-opt-name' }, cls.name), h('span', { class: 'badge' }, `d${cls.hitDie}`), cls.origin === 'custom' ? h('span', { class: 'badge' }, 'custom') : null),
          h('span', { class: 'ch-optcard-desc' }, [
            (cls.primaryAbility || []).map((a) => a.toUpperCase()).join(cls.primaryAbilityMode === 'and' ? ' & ' : ' or '),
            cls.saves?.length ? `Saves ${cls.saves.map((a) => a.toUpperCase()).join(', ')}` : '',
            cls.spellcasting ? `${prettify(cls.spellcasting.kind)} caster` : 'Martial',
          ].filter(Boolean).join(' · ')));
      })),
      primary ? h('div', { class: 'ch-class-levels stack stack-sm' },
        h('h3', { class: 'ch-mini-head' }, 'Levels'),
        c.classes.map((row, i) => h('div', { class: 'row ch-class-row' },
          h('strong', null, entryName('class', row.id)),
          i ? h('span', { class: 'badge' }, 'multiclass') : h('span', { class: 'badge badge-info' }, 'first class'),
          h('span', { class: 'spacer' }),
          h('label', { class: 'row row-nowrap' }, h('span', { class: 'muted ui text-sm' }, 'Level'),
            numberInput(row.level, (v) => mutate((x) => {
              const others = totalLevel(x) - x.classes[i].level;
              const nv = Math.max(1, Math.min(20 - others, v || 1));
              if (nv < x.classes[i].level) dropLevelsAbove(x, row.id, nv);
              x.classes[i].level = nv;
            }), { class: 'input input-sm ch-w-num', min: 1, max: 20, 'data-fk': `lvl-${row.id}` })),
          i ? h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove ${entryName('class', row.id)}`, title: 'Remove', onclick: () => mutate((x) => { dropClassChoices(x, row.id); x.classes = x.classes.filter((r) => r.id !== row.id); }) }, icon('trash')) : null)),
        h('p', { class: 'muted ui text-sm' }, `Total level ${total} of 20. Higher starting levels open every feature, choice and spell slot up to that level.`),
        total < 20 ? multiclassAdd(c) : null) : h('p', { class: 'muted' }, 'Pick a class to begin. You can add more classes (multiclass) below once one is chosen.'),
      primary ? classInfo(findEntry('class', primary.id)) : null,
    ];
  },

  subclass({ char: c, parts }) {
    const eligible = c.classes.filter((r) => r.level >= (findEntry('class', r.id)?.subclassLevel || 3));
    if (!c.classes.length) return h('p', { class: 'muted' }, 'Choose a class first.');
    if (!eligible.length) return h('p', { class: 'muted' }, 'Subclasses are chosen at level 3. Raise the starting level in “Class & level”, or pick one later when you level up.');
    return [
      h('p', { class: 'muted ui text-sm' }, 'SRD 5.2 subclasses carry full rules text. Others are labeled with their book and summarized in our own words.'),
      renderChoiceGroups(parts.subclass, builderCtx(), { empty: 'No subclass choice is open for these classes.' }),
    ];
  },

  species({ char: c, parts }) {
    const list = filterBy(cat('species'), B.q.species);
    const sel = findEntry('species', c.species.id);
    return [
      searchBox('species', 'Search species'),
      h('div', { class: 'ch-cards ch-pick-cards' }, list.map((sp) => {
        const on = sp.id === c.species.id;
        return h('button', {
          type: 'button', class: ['ch-optcard', on && 'is-selected'], 'aria-pressed': String(on), 'data-fk': `sp-${sp.id}`,
          onclick: () => mutate((x) => {
            if (x.species.id === sp.id) return;
            for (const k of Object.keys(x.choices)) if (k.startsWith('species:')) delete x.choices[k];
            x.species = { id: sp.id, subspecies: null, size: null };
          }),
        },
        h('span', { class: 'ch-optcard-head' }, h('span', { class: 'ch-opt-name' }, sp.name), originBadge(sp)),
        h('span', { class: 'ch-optcard-desc' }, [sp.size || (sp.sizeOptions || []).join('/'), `${sp.speed ?? 30} ft`, sp.darkvision ? `Darkvision ${sp.darkvision} ft` : ''].filter(Boolean).join(' · ')));
      })),
      sel ? h('div', { class: 'stack ch-step-detail' },
        h('h3', { class: 'ch-mini-head' }, `${sel.name} traits`),
        h('div', { class: 'ch-traits' }, (sel.traits || []).map((t) => h('details', { class: 'ch-feat' },
          h('summary', null, h('span', { class: 'ch-feat-name' }, t.name), t.level > 1 ? h('span', { class: 'badge' }, `Level ${t.level}`) : null),
          h('div', { class: 'ch-feat-body' }, md(t.description))))),
        parts.species.length ? [h('h3', { class: 'ch-mini-head' }, 'Species choices'), renderChoiceGroups(parts.species, builderCtx())] : null) : null,
    ];
  },

  background({ char: c, parts }) {
    const list = filterBy(cat('background'), B.q.background);
    const sel = findEntry('background', c.background.id);
    return [
      searchBox('background', 'Search backgrounds'),
      h('div', { class: 'ch-cards ch-pick-cards' }, list.map((bg) => {
        const on = bg.id === c.background.id;
        return h('button', {
          type: 'button', class: ['ch-optcard', on && 'is-selected'], 'aria-pressed': String(on), 'data-fk': `bg-${bg.id}`,
          onclick: () => mutate((x) => {
            if (x.background.id === bg.id) return;
            const old = findEntry('background', x.background.id);
            for (const k of Object.keys(x.choices)) {
              if (k.startsWith('background:') || (old?.feat?.id && k.startsWith(`feat:${old.feat.id}`))) delete x.choices[k];
            }
            x.background = { id: bg.id, abilityBonuses: {} };
          }),
        },
        h('span', { class: 'ch-optcard-head' }, h('span', { class: 'ch-opt-name' }, bg.name), originBadge(bg)),
        h('span', { class: 'ch-optcard-desc' }, [
          (bg.abilityScores || []).map((a) => a.toUpperCase()).join(', '),
          bg.feat?.id ? entryName('feat', bg.feat.id) + (bg.feat.note ? ` (${bg.feat.note})` : '') : '',
          (bg.skills || []).map(skillName).join(', '),
        ].filter(Boolean).join(' · ')));
      })),
      sel ? h('div', { class: 'stack ch-step-detail' },
        h('dl', { class: 'ch-dl' },
          h('dt', null, 'Ability scores'), h('dd', null, (sel.abilityScores || []).map((a) => a.toUpperCase()).join(', ')),
          h('dt', null, 'Origin feat'), h('dd', null, sel.feat?.id ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(findEntry('feat', sel.feat.id)) }, entryName('feat', sel.feat.id)) : '—', sel.feat?.note ? ` (${sel.feat.note})` : ''),
          h('dt', null, 'Skills'), h('dd', null, (sel.skills || []).map(skillName).join(', ') || '—'),
          h('dt', null, 'Tool'), h('dd', null, sel.tool?.name || '—')),
        sel.description ? md(sel.description) : null,
        h('h3', { class: 'ch-mini-head' }, 'Background choices'),
        h('p', { class: 'muted ui text-sm' }, 'Increase one of the three abilities by 2 and another by 1, or all three by 1 (max 20).'),
        renderChoiceGroups(parts.background, builderCtx(), { empty: 'Nothing to choose for this background.' })) : null,
    ];
  },

  abilities({ char: c, sheet: s }) {
    return renderScores({ char: c, sheet: s, mutate: (fn) => { B.ui.scoresTouched = true; mutate(fn); }, ui: B.ui });
  },

  choices({ char: c, parts }) {
    if (!c.classes.length) return h('p', { class: 'muted' }, 'Choose a class first; its skills, fighting style, weapon masteries, expertise, invocations and other menus appear here.');
    return [
      h('p', { class: 'muted ui text-sm' }, 'Every menu your classes, feats and levels open. Leave any of them for later; open ones stay listed on the sheet.'),
      renderChoiceGroups(parts.rest, builderCtx(), { empty: 'No class choices at these levels.' }),
    ];
  },

  hp({ char: c, sheet: s }) {
    if (!c.classes.length) return h('p', { class: 'muted' }, 'Choose a class first.');
    const con = s.abilities.con.mod;
    return [
      h('div', { class: 'row' },
        h('span', { class: 'ui' }, `CON modifier ${fmt(con)} per level. Maximum HP: `, h('strong', { class: 'num' }, String(s.hpMax))),
        h('span', { class: 'spacer' }),
        h('button', { class: ['btn', 'btn-sm', B.hpMode === 'average' && 'is-active'], type: 'button', onclick: () => { B.hpMode = 'average'; mutate((x) => { x.classes.forEach((r) => { r.hp = []; }); }); } }, 'Average for all'),
        h('button', { class: ['btn', 'btn-sm', B.hpMode === 'roll' && 'is-active'], type: 'button', onclick: () => { B.hpMode = 'roll'; mutate((x) => { x.classes.forEach((r) => { r.hp = []; }); }); } }, icon('d20'), 'Roll all')),
      c.classes.map((row, ci) => {
        const die = findEntry('class', row.id)?.hitDie || 8;
        return h('div', { class: 'ch-hp-levels' },
          h('h3', { class: 'ch-mini-head' }, `${entryName('class', row.id)} · d${die}`),
          h('div', { class: 'ch-hp-level-grid' }, row.hp.map((v, li) => {
            const locked = ci === 0 && li === 0;
            return h('label', { class: 'field ch-hp-level' }, h('span', { class: 'field-label' }, `Level ${li + 1}`),
              h('span', { class: 'row row-nowrap' },
                numberInput(v, (n) => mutate((x) => { x.classes[ci].hp[li] = Math.max(1, Math.min(die, n || 1)); }), { class: 'input input-sm ch-w-num', min: 1, max: die, disabled: locked, 'data-fk': `hp-${row.id}-${li}` }),
                locked ? h('span', { class: 'muted ui text-xs' }, 'max') : h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Roll d${die}`, 'aria-label': `Roll d${die}`, onclick: () => mutate((x) => { x.classes[ci].hp[li] = rollDie(die); }) }, icon('d20'))));
          })));
      }),
      h('p', { class: 'field-hint' }, 'Level 1 of your first class always takes the maximum. Each level adds the die result plus your CON modifier (at least 1).'),
    ];
  },

  spells({ char: c, sheet: s }) {
    const casters = s.spellcasting;
    const always = (Array.isArray(s.spells) ? s.spells : []).filter((x) => x.always);
    if (!casters.length && !always.length) return h('p', { class: 'muted' }, 'No spellcasting at these levels. Spells from species traits and feats are chosen in their own steps.');
    return [
      casters.map((sc) => casterPicker(c, s, sc)),
      always.length ? h('div', null, h('h3', { class: 'ch-mini-head' }, 'Always prepared'),
        h('div', { class: 'row ch-chip-row' }, always.map((x) => h('span', { class: 'chip', title: x.source || 'Always prepared' }, icon('lock'), x.name || entryName('spell', x.id))))) : null,
    ];
  },

  details({ char: c }) {
    const short = DETAIL_FIELDS.filter((f) => !f.long);
    const long = DETAIL_FIELDS.filter((f) => f.long);
    return [
      h('div', { class: 'field-grid' }, short.map((f) => field(f.label, f.type === 'alignment'
        ? select([{ value: '', label: '—' }, ...(R().alignments || []).map((a) => ({ value: a.id, label: a.name }))], c.details[f.key], (v) => mutate((x) => { x.details[f.key] = v; }), { 'data-fk': `d-${f.key}` })
        : input({ value: c.details[f.key] || '', 'data-fk': `d-${f.key}`, onchange: (e) => { c.details[f.key] = e.target.value; saveState(); } }), f.hint))),
      long.map((f) => field(f.label, markdownEditor({ value: c.details[f.key] || '', rows: 3, onInput: (v) => { c.details[f.key] = v; saveState(); } }), f.hint)),
    ];
  },
};

function builderCtx() {
  return { char: B.char, sheet: B.sheet || derive(B.char), mutate };
}

function originBadge(e) {
  if (e.origin === 'stub') return h('span', { class: 'badge', title: 'Summary in our own words; see the book' }, e.source || 'stub');
  if (e.origin === 'custom') return h('span', { class: 'badge' }, 'custom');
  return h('span', { class: 'badge badge-info' }, 'SRD');
}

function searchBox(which, placeholder) {
  return h('label', { class: 'search ch-step-search' }, icon('search'), h('input', {
    class: 'input', type: 'search', placeholder, value: B.q[which], 'data-fk': `q-${which}`, 'aria-label': placeholder,
    oninput: (e) => { B.q[which] = e.target.value; render(); },
  }));
}

const filterBy = (list, q) => {
  const t = nameKey(q);
  return t ? list.filter((e) => nameKey(`${e.name} ${e.source || ''}`).includes(t)) : list;
};

function classInfo(cls) {
  if (!cls) return null;
  const p = cls.proficiencies || {};
  return h('details', { class: 'ch-class-info' }, h('summary', { class: 'ui' }, `About the ${cls.name}`),
    h('dl', { class: 'ch-dl' },
      h('dt', null, 'Hit die'), h('dd', null, `d${cls.hitDie}`),
      h('dt', null, 'Saving throws'), h('dd', null, (cls.saves || []).map((a) => ABILITIES.find((x) => x.id === a)?.full || a).join(', ')),
      h('dt', null, 'Armor'), h('dd', null, (p.armor || []).map(prettify).join(', ') || 'None'),
      h('dt', null, 'Weapons'), h('dd', null, (p.weapons || []).map(prettify).join(', ') || 'None'),
      h('dt', null, 'Skills'), h('dd', null, cls.skillChoices ? `Choose ${cls.skillChoices.choose}: ${(cls.skillChoices.from || []).map(skillName).join(', ')}` : '—'),
      cls.spellcasting ? [h('dt', null, 'Spellcasting'), h('dd', null, `${prettify(cls.spellcasting.kind)} caster (${String(cls.spellcasting.ability).toUpperCase()})`)] : null,
      h('dt', null, 'Subclass'), h('dd', null, `At level ${cls.subclassLevel || 3}`)));
}

function multiclassAdd(c) {
  const opts = cat('class').filter((cls) => !c.classes.some((r) => r.id === cls.id)).map((cls) => {
    const mc = canMulticlass(c, cls.id);
    return { cls, mc };
  });
  return h('div', { class: 'row ch-mc-add' },
    select([{ value: '', label: 'Add a multiclass…' }, ...opts.map(({ cls, mc }) => ({ value: cls.id, label: `${cls.name}${mc.ok ? '' : ` — needs ${mc.reasons.join('; ')}`}` }))], '', (v) => {
      if (!v) return;
      const { mc } = opts.find((o) => o.cls.id === v);
      if (!mc.ok) toast(`Multiclass prerequisites not met yet (${mc.reasons.join('; ')}). Added anyway: set your ability scores to qualify.`, { type: 'error' });
      mutate((x) => { if (totalLevel(x) < 20) x.classes.push({ id: v, level: 1, subclass: null, hp: [] }); });
    }, { class: 'select input-sm', 'aria-label': 'Add a multiclass', 'data-fk': 'mc-add' }),
    h('span', { class: 'field-hint' }, 'Multiclassing needs 13+ in the primary abilities of every class involved.'));
}

/** Remove stored choices keyed to a class (all levels). */
function dropClassChoices(x, classId) {
  for (const k of Object.keys(x.choices)) if (k.includes(`@${classId}:`)) delete x.choices[k];
  x.spells = x.spells.filter((s) => s.class !== classId);
}

function dropLevelsAbove(x, classId, level) {
  for (const k of Object.keys(x.choices)) {
    const m = new RegExp(`@${classId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(k);
    if (m && Number(m[1]) > level) delete x.choices[k];
  }
}

function casterPicker(c, s, sc) {
  const avail = availableSpells(c, sc.class);
  const max = avail.maxLevel ?? sc.maxSpellLevel ?? 1;
  const always = new Set(avail.alwaysPrepared || sc.alwaysPrepared || []);
  const mine = c.spells.filter((x) => x.class === sc.class && !x.always);
  const levelOf = (id) => Number(findEntry('spell', id)?.level) || 0;
  const cantrips = mine.filter((x) => levelOf(x.id) === 0);
  const leveled = mine.filter((x) => levelOf(x.id) > 0);
  const pool = (avail.spells || []).filter((e) => !always.has(e.id));
  const choose = async (isCantrip) => {
    const items = pool.filter((e) => (isCantrip ? (Number(e.level) || 0) === 0 : (Number(e.level) || 0) >= 1 && (Number(e.level) || 0) <= max));
    const current = (isCantrip ? cantrips : leveled).map((x) => x.id);
    const res = await pickFromList({
      title: `${entryName('class', sc.class)} ${isCantrip ? 'cantrips' : `spells (level 1–${max})`}`,
      items, multi: true, selected: items.filter((e) => current.includes(e.id)),
      render: (e) => h('div', { class: 'picker-item-main' }, h('span', { class: 'picker-item-title' }, e.name), h('small', { class: 'muted' }, entrySubtitle(e))),
      search: (e) => `${e.name} ${e.school}`,
    });
    if (!res) return;
    mutate((x) => {
      x.spells = x.spells.filter((sp) => !(sp.class === sc.class && !sp.always && (levelOf(sp.id) === 0) === isCantrip));
      res.forEach((e) => x.spells.push({ id: e.id, class: sc.class, prepared: true, always: false }));
    });
  };
  const chips = (arr) => (arr.length ? h('div', { class: 'row ch-chip-row' }, arr.map((x) => h('span', { class: 'chip' },
    h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(findEntry('spell', x.id)) }, entryName('spell', x.id)),
    h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${entryName('spell', x.id)}`, onclick: () => mutate((y) => { y.spells = y.spells.filter((sp) => !(sp.id === x.id && sp.class === sc.class)); }) }, icon('close'))))) : h('span', { class: 'faint ui text-sm' }, 'None yet'));
  const over = (n, cap) => cap != null && n > cap;
  return h('div', { class: 'ch-caster-pick stack stack-sm' },
    h('h3', { class: 'ch-mini-head' }, `${entryName('class', sc.class)} · ${String(sc.ability || '').toUpperCase()} · DC ${sc.dc} · attack ${fmt(sc.attack)}`),
    sc.cantrips ? h('div', { class: 'stack stack-sm' },
      h('div', { class: 'row' }, h('strong', { class: over(cantrips.length, sc.cantrips) ? 'danger-text' : null }, `Cantrips ${cantrips.length} / ${sc.cantrips}`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose(true) }, icon('plus'), 'Choose cantrips')),
      chips(cantrips)) : null,
    h('div', { class: 'stack stack-sm' },
      h('div', { class: 'row' }, h('strong', { class: over(leveled.length, sc.prepared) ? 'danger-text' : null }, `Prepared spells ${leveled.length}${sc.prepared != null ? ` / ${sc.prepared}` : ''}`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => choose(false) }, icon('plus'), 'Choose spells')),
      chips(leveled),
      sc.class === 'wizard' ? h('p', { class: 'field-hint' }, 'Wizards: these go in the spellbook as prepared. Add extra spellbook spells on the sheet and untick “prepared”.') : null));
}

// ---------- create ----------

async function create() {
  const c = clone(B.char);
  if (!c.name) {
    c.name = 'Unnamed adventurer';
    toast('No name given; called them “Unnamed adventurer”. Rename them in Edit all.');
  }
  const id = uid(c.name);
  c.id = id;
  const now = new Date().toISOString();
  c.created = now;
  c.createdBy = c.createdBy || getSetting('playerName') || c.player || '';
  ensureHp(c, B.hpMode);
  const s = derive(c);
  c.hp = { current: s.hpMax, temp: 0 };
  c.inventory = [];
  persist(normalize(c), { now: true });
  try { localStorage.removeItem(KEY()); } catch { /* ignore */ }
  B.char = null;
  toast(`${c.name} joins the party.${majorSaveOn() ? '' : ' Press Save to share the sheet.'}`, { type: 'success' });
  saveSoon(`new character “${c.name}”`);
  navigate(href(VIEW, id));
}

/** Forget the in-memory builder (e.g. after another tab created it). */
export function resetBuilder() { B.char = null; }
