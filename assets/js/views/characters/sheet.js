// The character sheet: header, combat strip, abilities/saves/skills, attacks, spellcasting,
// features, resources, inventory, currency, proficiencies, details and notes.
// Every tick/pip/value change re-derives instantly and persists a local draft (debounced).
import { h, mount } from '../../core/dom.js';
import { icon, toast, openModal, confirmDialog, select, numberInput, markdownEditor, field, input, checkbox } from '../../core/ui.js';
import { href, navigate } from '../../core/router.js';
import { clone } from '../../core/util.js';
import {
  VIEW, ABILITIES, DETAIL_FIELDS, CURRENCY, getCharacter, persist, flushPersist, hasPendingWrite, normalizeAnchor,
  prettify, shortId, totalLevel,
} from './data.js';
import {
  derive, allChoices, findEntry, entryName, skillList, profName, conditionList, masteryInfo, propertyInfo, R,
  openPicker, openEntryEditor, renderEntry, longRest, shortRest, describeModifiers, onReady, isReady, ready, availableSpells, cat,
} from './bridge.js';
import { renderChoice, valueNames, currentValue } from './choices.js';
import { rerender, pips, statBox, section, md, mdInline, portrait, entryModal, chip, hpBar, fmt, rollDie } from './widgets.js';
import { levelUpFlow, openLevelDown } from './levelup.js';
// XP / level and spell (v2) helpers — own import lines (aliased) so they never clash with the shared ones above
import { xpMeter, openXpWindow, levelsDue } from './xp.js';
import { spellStats, spellIssues, addSpellIssues, rollDice } from './engine-spells.js';
import { adjustedValue as adjValue } from './widgets.js';
import { choiceDialog as choiceDlg } from '../../core/ui.js';
// Debuffed values, highlight colour and proficiency marks (abilities / skills / combat / attacks / nav)
import { adjustedValue, accentAttrs, profMark } from './widgets.js';
import { getSetting, setSetting } from '../../core/settings.js';

const S = { root: null, id: null, char: null, sheet: null, stale: false, notesEditing: false, openFeatures: new Set() };

export const currentSheetId = () => S.id;

// ---------- lifecycle ----------

export function showSheet(root, id, section, { reload = false } = {}) {
  S.root = root;
  if (reload || S.id !== id || !S.char) {
    if (S.id) flushPersist(S.id);
    S.id = id;
    S.char = getCharacter(id);
    S.stale = false;
    S.notesEditing = false;
    S.openFeatures = new Set();
  }
  if (!S.char) {
    mount(root, h('div', { class: 'empty-state ch-missing' }, icon('warning'), h('h3', null, 'Character not found'),
      h('p', null, `There is no sheet called “${id}”. It may have been deleted, or not fetched yet.`),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: href(VIEW) }, icon('chevron-left'), 'All characters'))));
    return;
  }
  S.sheet = derive(S.char);
  render();
  if (!isReady()) ready().then(() => { if (S.id === id && S.root?.isConnected) { S.sheet = derive(S.char); render(); } });
  if (section) requestAnimationFrame(() => focusSection(section));
}

export function hideSheet() {
  if (S.id) flushPersist(S.id);
}

/** Called when the stored doc changed outside this sheet (pull, another view). */
export function sheetExternalChange(id) {
  if (!S.char || S.id !== id || !S.root?.isConnected) return;
  const fresh = getCharacter(id);
  if (!fresh) { S.char = null; showSheet(S.root, id); return; }
  const a = document.activeElement;
  const editing = hasPendingWrite(id) || (a && S.root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  if (editing) { S.stale = true; render(); return; }
  S.char = fresh;
  S.sheet = derive(fresh);
  S.stale = false;
  render();
}

onReady(() => { if (S.char && S.root?.isConnected && !S.root.closest('[hidden]')) { S.sheet = derive(S.char); render(); } });

function mutate(fn, { redraw = true } = {}) {
  fn(S.char);
  S.sheet = derive(S.char);
  persist(S.char);
  if (redraw) render();
}

function replaceChar(next) {
  S.char = next;
  S.sheet = derive(next);
  persist(next);
  render();
}

function focusSection(sec) {
  const a = normalizeAnchor(sec);
  if (!a || !S.root) return;
  const sel = `[data-stat="${CSS.escape(a)}"], [data-sec="${CSS.escape(a)}"]`;
  let el = S.root.querySelector(sel);
  if (!el) {
    const feat = S.sheet.features.find((f) => normalizeAnchor(f.name) === a || f.id === a);
    if (feat) el = S.root.querySelector(`[data-stat="${CSS.escape(feat.id)}"]`);
  }
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('ch-flash');
  void el.offsetWidth;
  el.classList.add('ch-flash');
  setTimeout(() => el.classList.remove('ch-flash'), 2200);
}

function goSection(id) {
  history.replaceState(null, '', href(VIEW, S.id, id));
  focusSection(id);
}

const editHref = (s) => `${href(VIEW, S.id, 'edit')}${s ? `?s=${encodeURIComponent(s)}` : ''}`;

function rollToast(label, bonus) {
  const d = rollDie(20);
  const total = d + (Number(bonus) || 0);
  const note = d === 20 ? ' — natural 20!' : d === 1 ? ' — natural 1' : '';
  toast(`${label}: d20 (${d}) ${fmt(bonus)} = ${total}${note}`, { type: d === 20 ? 'success' : 'info', timeout: 5000 });
}

// ---------- render ----------

function render() {
  if (!S.root || !S.char) return;
  const c = S.char;
  const s = S.sheet;
  rerender(S.root, () => mount(S.root,
    header(c, s),
    nav(s),
    S.stale ? h('div', { class: 'callout ch-stale', 'data-callout': 'warning' },
      h('div', { class: 'callout-title' }, 'This sheet changed elsewhere'),
      h('div', { class: 'callout-content row' }, h('span', null, 'Another Warden (or another tab) updated it.'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { flushPersist(S.id); S.char = getCharacter(S.id); S.sheet = derive(S.char); S.stale = false; render(); } }, 'Load their version'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { S.stale = false; persist(S.char, { now: true }); render(); } }, 'Keep mine'))) : null,
    s.pending.length ? h('div', { class: 'callout ch-pending', 'data-callout': 'todo' },
      h('div', { class: 'callout-title' }, `${s.pending.length} choice${s.pending.length === 1 ? '' : 's'} still open`),
      h('div', { class: 'callout-content row' },
        h('span', null, s.pending.slice(0, 4).map((p) => p.label || prettify(p.featureId)).join(', '), s.pending.length > 4 ? '…' : ''),
        h('a', { class: 'btn btn-sm', href: editHref('choices') }, 'Make choices'))) : null,
    s.warnings.length ? h('details', { class: 'ch-warnings' }, h('summary', { class: 'muted ui text-sm' }, icon('info'), ` ${s.warnings.length} rules note${s.warnings.length === 1 ? '' : 's'}`),
      h('ul', { class: 'ui text-sm' }, s.warnings.map((w) => h('li', null, String(w))))) : null,
    // D&D Beyond proportions: ability row, combat strip, then senses & proficiencies | skills | actions & features.
    abilities(c, s),
    combat(c, s),
    h('div', { class: 'ch-body' }, h('div', { class: 'ch-body-grid' },
      h('div', { class: 'ch-col ch-col-l' }, passive(s), proficiencies(c, s)),
      h('div', { class: 'ch-col ch-col-m' }, skills(c, s)),
      h('div', { class: 'ch-col ch-col-r' }, attacks(c, s), resources(c, s), features(c, s)))),
    spells(c, s),
    h('div', { class: 'ch-layout' },
      h('div', { class: 'ch-col ch-col-a' }, currency(c)),
      h('div', { class: 'ch-col ch-col-b' }, inventory(c, s))),
    details(c, s),
    notes(c)));
}

function header(c, s) {
  const species = c.species.id ? entryName('species', c.species.id) : '';
  const sub = c.species.subspecies ? (findEntry('species', c.species.id)?.subspecies || []).find((x) => x.id === c.species.subspecies)?.name : '';
  const bg = c.background.id ? entryName('background', c.background.id) : '';
  const align = c.details.alignment ? ((R().alignments || []).find((a) => a.id === c.details.alignment)?.name || c.details.alignment) : '';
  const lvl = totalLevel(c);
  const due = levelsDue(c);
  const meta = [align, c.player ? `Player: ${c.player}` : ''].filter(Boolean).join(' · ');
  return h('header', { class: 'ch-head' },
    h('a', { class: 'btn btn-ghost btn-sm ch-back', href: href(VIEW) }, icon('chevron-left'), 'All characters'),
    h('div', { class: 'ch-head-main' },
      portrait(c, { size: 'lg' }),
      h('div', { class: 'ch-head-id' },
        h('h1', { class: 'ch-name' }, c.name || 'Unnamed'),
        h('p', { class: 'ch-line' }, [lvl ? `Level ${lvl}` : 'Level 0', [species, sub ? `(${sub})` : ''].filter(Boolean).join(' '), s.classLine, bg].filter(Boolean).join(' · ')),
        meta ? h('p', { class: 'ch-meta ui' }, meta) : null,
        h('div', { class: 'ch-xp-row' },
          xpMeter(c, { onOpen: () => xpWindow(), onAdd: () => xpWindow('amount') }),
          lvl ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => levelDownDialog(), title: 'Remove the most recent level (confirms first)', 'data-fk': 'lvl-down' }, h('span', { class: 'ch-flip' }, icon('level-up')), 'Level down') : null))),
    h('div', { class: 'ch-head-actions' },
      h('button', {
        class: ['btn', 'btn-primary', due && 'ch-lu-due'], type: 'button', onclick: () => levelUp(), disabled: lvl >= 20, 'data-fk': 'lvl-up',
        title: lvl >= 20 ? 'Already level 20' : due ? `Your XP has reached level ${lvl + due}` : lvl ? 'Gain a level now (milestone — ignores XP)' : 'Choose a first class',
      }, icon('level-up'), !lvl ? 'Choose a class' : due ? (due > 1 ? `Level up · ${due} due` : 'Level up available') : 'Level up'),
      h('button', { class: 'btn', type: 'button', onclick: shortRestDialog, title: 'Spend Hit Dice; recharge short-rest features' }, icon('clock'), 'Short rest'),
      h('button', { class: 'btn', type: 'button', onclick: longRestDialog, title: 'Regain HP, slots and features' }, icon('moon'), 'Long rest'),
      h('a', { class: 'btn', href: editHref(), title: 'Edit every field, choice and override' }, icon('edit'), 'Edit all'),
      h('button', {
        class: 'btn-icon', type: 'button', title: 'Copy a [[char:…]] link', 'aria-label': 'Copy link',
        onclick: async () => { const t = `[[char:${c.name || c.id}]]`; try { await navigator.clipboard.writeText(t); toast(`Copied ${t}`); } catch { toast(t); } },
      }, icon('link'))));
}

// Sticky section bar; once the name in the header scrolls away, "Name · Player" fills its empty right side.
const NAV = { io: null, stuck: false, id: null };

function nav(s) {
  const c = S.char;
  if (NAV.id !== S.id) { NAV.id = S.id; NAV.stuck = false; }
  const items = [['abilities', 'Abilities'], ['hp', 'Combat'], ['passive', 'Senses'], ['skills', 'Skills'], ['attacks', 'Attacks'], ['features', 'Features'],
    (s.spellcasting.length || c.spells.length) ? ['spells', 'Spells'] : null, ['inventory', 'Inventory'], ['details', 'Details'], ['notes', 'Notes']].filter(Boolean);
  const el = h('nav', { class: ['ch-nav', NAV.stuck && 'is-stuck'], 'aria-label': 'Sheet sections' },
    h('div', { class: 'ch-nav-chips' }, items.map(([id, label]) => h('button', { class: 'chip', type: 'button', onclick: () => goSection(id) }, label))),
    h('button', {
      class: 'ch-nav-who', type: 'button', title: 'Back to the top',
      onclick: () => (S.root.closest('.view') || window).scrollTo({ top: 0, behavior: 'smooth' }),
    }, h('span', { class: 'ch-nav-name' }, c.name || 'Unnamed'), c.player ? h('span', { class: 'ch-nav-player' }, ` · ${c.player}`) : null));
  queueMicrotask(() => watchNav(el));
  return el;
}

function watchNav(el) {
  NAV.io?.disconnect();
  NAV.io = null;
  const name = S.root?.querySelector('.ch-name') || S.root?.querySelector('.ch-head');
  if (!el.isConnected || !name || typeof IntersectionObserver !== 'function') return;
  NAV.io = new IntersectionObserver(([e]) => {
    if (!e) return;
    NAV.stuck = !e.isIntersecting && e.boundingClientRect.top < (e.rootBounds ? e.rootBounds.top : 0);
    el.classList.toggle('is-stuck', NAV.stuck);
  }, { root: S.root.closest('.view'), rootMargin: `-${Math.ceil(el.offsetHeight)}px 0px 0px 0px` });
  NAV.io.observe(name);
}

// ---------- combat strip ----------

function combat(c, s) {
  const max = s.hpMax;
  const cur = c.hp.current == null ? max : Number(c.hp.current);
  const temp = Number(c.hp.temp) || 0;
  const amount = h('input', { class: 'input input-sm ch-hp-amt', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Amount', 'aria-label': 'Damage or healing amount', 'data-fk': 'hp-amt' });
  const doDamage = () => { const n = Math.max(0, Number(amount.value) || 0); if (!n) return; mutate((x) => applyDamage(x, n, max)); };
  const doHeal = () => { const n = Math.max(0, Number(amount.value) || 0); if (!n) return; mutate((x) => applyHeal(x, n, max)); };
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? doHeal() : doDamage(); } });
  const speedSub = Object.entries(s.speed).filter(([k, v]) => k !== 'walk' && v).map(([k, v]) => `${prettify(k)} ${v}`).join(' · ');
  const ex = Number(c.exhaustion) || 0;
  const conds = conditionList().filter((x) => x.id !== 'exhaustion');
  return h('section', { class: 'ch-combat', 'data-sec': 'combat', 'aria-label': 'Combat' },
    h('div', { class: 'ch-combat-stats' },
      statBox({ label: 'Armor Class', value: adjustedValue(s, 'ac', String(s.ac.value)), sub: s.armorWorn?.name || (s.shield ? 'Shield' : 'Unarmored'), stat: 'ac', title: s.adjust?.ac ? null : s.ac.formula, onClick: () => acInfo(s) }),
      statBox({ label: 'Initiative', value: adjustedValue(s, 'initiative', fmt(s.initiative)), stat: 'initiative', title: s.adjust?.initiative ? null : 'Roll initiative', onClick: () => rollToast('Initiative', s.initiative) }),
      statBox({ label: 'Speed', value: adjustedValue(s, 'speed', `${s.speed.walk ?? 0} ft`), sub: speedSub || null, stat: 'speed' }),
      statBox({ label: 'Proficiency', value: adjustedValue(s, 'profBonus', fmt(s.profBonus)), stat: 'prof' })),
    h('div', { class: 'ch-hp', 'data-sec': 'hp' },
      h('div', { class: 'ch-hp-top' },
        h('span', { class: 'ch-stat-label' }, icon('heart'), ' Hit points'),
        h('span', { class: 'ch-hp-now num', title: s.adjust?.hpMax ? null : 'Current + temporary' }, String(cur + temp), h('span', { class: 'ch-hp-max' }, ' / ', adjustedValue(s, 'hpMax', String(max))))),
      hpBar(cur, max, temp),
      h('div', { class: 'ch-hp-grid' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Current'),
          numberInput(cur, (v) => mutate((x) => { x.hp.current = Math.max(0, Math.min(max, v ?? max)); }), { class: 'input input-sm', min: 0, max, 'data-fk': 'hp-cur' })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Temp HP'),
          numberInput(temp, (v) => mutate((x) => { x.hp.temp = Math.max(0, v || 0); }), { class: 'input input-sm', min: 0, 'data-fk': 'hp-temp' })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Damage taken'),
          numberInput(Math.max(0, max - cur), (v) => mutate((x) => { x.hp.current = Math.max(0, max - Math.max(0, v || 0)); }), { class: 'input input-sm', min: 0, max, 'data-fk': 'hp-dmg' }))),
      h('div', { class: 'ch-hp-actions' }, amount,
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: doDamage, 'data-fk': 'hp-dmg-btn' }, 'Damage'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: doHeal, 'data-fk': 'hp-heal-btn' }, 'Heal'))),
    h('div', { class: 'ch-combat-side' },
      h('div', { class: 'ch-mini', 'data-stat': 'hit-dice' },
        h('span', { class: 'ch-stat-label' }, 'Hit dice'),
        s.hitDice.length ? s.hitDice.map((hd) => h('div', { class: 'ch-mini-row' },
          h('span', { class: 'num ch-die' }, `d${hd.die}`),
          hd.total <= 12
            ? pips({ max: hd.total, used: hd.used, label: `d${hd.die} hit dice`, fk: `hd${hd.die}`, onChange: (u) => mutate((x) => { x.hitDiceUsed[hd.die] = u; }) })
            : numberInput(hd.used, (v) => mutate((x) => { x.hitDiceUsed[hd.die] = Math.max(0, Math.min(hd.total, v || 0)); }), { class: 'input input-sm ch-w-num', min: 0, max: hd.total }),
          h('span', { class: 'muted ui text-xs' }, `${hd.total - hd.used}/${hd.total} left`))) : h('span', { class: 'faint ui text-sm' }, '—')),
      h('div', { class: 'ch-mini', 'data-sec': 'death-saves' },
        h('span', { class: 'ch-stat-label' }, 'Death saves'),
        h('div', { class: 'ch-mini-row' }, h('span', { class: 'ui text-sm ch-ds-label' }, 'Successes'), deathBoxes('success', c.deathSaves.success)),
        h('div', { class: 'ch-mini-row' }, h('span', { class: 'ui text-sm ch-ds-label' }, 'Failures'), deathBoxes('fail', c.deathSaves.fail))),
      h('div', { class: 'ch-mini' },
        h('span', { class: 'ch-stat-label' }, 'Heroic inspiration'),
        h('button', {
          class: ['btn', 'btn-sm', 'ch-insp', c.heroicInspiration && 'is-active'], type: 'button', 'aria-pressed': String(!!c.heroicInspiration), 'data-fk': 'insp', 'data-stat': 'inspiration',
          onclick: () => mutate((x) => { x.heroicInspiration = !x.heroicInspiration; }),
        }, icon('star'), c.heroicInspiration ? 'Inspired' : 'None')),
      h('div', { class: 'ch-mini', 'data-stat': 'exhaustion' },
        h('span', { class: 'ch-stat-label' }, 'Exhaustion'),
        h('div', { class: 'ch-mini-row' }, pips({ max: 6, used: ex, kind: 'mark', label: 'Exhaustion level', fk: 'exh', onChange: (u) => mutate((x) => { x.exhaustion = u; }) }),
          h('span', { class: 'muted ui text-xs' }, ex ? `−${ex * 2} to d20 tests, −${ex * 5} ft speed${ex >= 6 ? ' (death)' : ''}` : 'None'))),
      h('div', { class: 'ch-mini ch-conds', 'data-stat': 'conditions' },
        h('span', { class: 'ch-stat-label' }, 'Conditions'),
        h('div', { class: 'row ch-chip-row' },
          c.conditions.map((id) => {
            const info = conds.find((x) => x.id === id);
            return chip(info?.name || prettify(id), { title: info ? info.description.slice(0, 300) : null, className: 'ch-cond', onRemove: () => mutate((x) => { x.conditions = x.conditions.filter((y) => y !== id); }) });
          }),
          select([{ value: '', label: c.conditions.length ? 'Add…' : 'Add condition…' }, ...conds.filter((x) => !c.conditions.includes(x.id)).map((x) => ({ value: x.id, label: x.name }))], '',
            (v) => v && mutate((x) => { x.conditions = [...x.conditions, v]; }), { class: 'select input-sm ch-cond-add', 'aria-label': 'Add condition', 'data-fk': 'cond-add' })))));
}

function deathBoxes(kind, n) {
  return h('span', { class: ['ch-ds', `ch-ds-${kind}`] }, [0, 1, 2].map((i) => h('input', {
    type: 'checkbox', class: 'checkbox', checked: i < n, 'aria-label': `${kind === 'success' ? 'Success' : 'Failure'} ${i + 1}`, 'data-fk': `ds-${kind}-${i}`,
    onchange: (e) => mutate((x) => { x.deathSaves[kind] = e.target.checked ? i + 1 : i; }),
  })));
}

function applyDamage(x, n, max) {
  const cur = x.hp.current == null ? max : Number(x.hp.current);
  const temp = Number(x.hp.temp) || 0;
  const fromTemp = Math.min(temp, n);
  x.hp.temp = temp - fromTemp;
  x.hp.current = Math.max(0, cur - (n - fromTemp));
}

function applyHeal(x, n, max) {
  const cur = x.hp.current == null ? max : Number(x.hp.current);
  x.hp.current = Math.min(max, cur + n);
  if (x.hp.current > 0) x.deathSaves = { success: 0, fail: 0 };
}

function acInfo(s) {
  const adj = s.adjust?.ac;
  openModal({
    title: `Armor Class ${s.ac.value}`,
    body: h('div', { class: 'stack' },
      h('p', null, s.ac.formula || 'Computed from armor, shield, Dexterity and features.'),
      adj ? h('div', { class: 'callout ch-ac-adj', 'data-callout': 'warning' },
        h('div', { class: 'callout-title' }, adj.value !== adj.base ? `Lowered from ${adj.base}` : 'Penalties'),
        h('ul', { class: 'callout-content ui text-sm' }, adj.reasons.map((r) => h('li', null, h('strong', null, r.label), r.amount ? ` ${fmt(r.amount)}` : '', r.note ? ` — ${r.note}` : '')))) : null,
      Array.isArray(s.ac.parts) && s.ac.parts.length ? h('ul', { class: 'ui text-sm' }, s.ac.parts.map((p) => h('li', null, typeof p === 'string' ? p : `${p.label || p.name || ''} ${p.value != null ? fmt(p.value) : ''}`.trim()))) : null,
      s.armorWorn ? h('p', { class: 'muted' }, `Armor worn: ${s.armorWorn.name || ''}${s.armorWorn.proficient === false ? ' (not proficient)' : ''}${s.armorWorn.stealthDisadvantage ? ' · Disadvantage on Stealth' : ''}`) : null,
      s.shield ? h('p', { class: 'muted' }, `Shield: ${s.shield.name || 'Shield'} (+${s.shield.ac ?? 2})${s.shield.proficient === false ? ' (not proficient)' : ''}`) : null,
      h('p', { class: 'muted ui text-sm' }, 'Equip armor in the inventory, or set an override in Edit all → Overrides.')),
    actions: [{ label: 'Overrides', kind: 'ghost', onClick: () => navigate(editHref('overrides')) }, { label: 'Close', kind: 'primary' }],
  });
}

// ---------- abilities, saves, passive, skills ----------

/** "Proficient · Background: Soldier" for a mark's tooltip; notes a change made in Edit all. */
function profTitle(level, info) {
  const word = { none: 'Not proficient', proficient: 'Proficient', expertise: 'Expertise', half: 'Half proficiency (Jack of All Trades)' }[level] || 'Not proficient';
  const src = (info?.sources || []).filter((x) => level === 'expertise' || x.level !== 'expertise').map((x) => x.label);
  const changed = info && info.override != null && info.override !== info.rules;
  return [word, level !== 'none' && level !== 'half' && src.length ? `from ${src.join(', ')}` : '', changed ? '(changed in Edit all)' : ''].filter(Boolean).join(' ');
}

function abilities(c, s) {
  const saves = s.proficiencyInfo?.saves || {};
  return section('abilities', 'Abilities & saving throws', {
    iconName: 'd20', attrs: accentAttrs(c), className: 'ch-sec-abils', sub: 'Click to roll.',
    actions: [h('a', { class: 'btn btn-ghost btn-sm', href: editHref('abilities') }, icon('edit'), 'Scores'),
      h('a', { class: 'btn btn-ghost btn-sm', href: editHref('proficiencies'), title: 'Saving throw proficiencies are changed in Edit all' }, icon('edit'), 'Saves')],
  },
  h('div', { class: 'ch-abils', 'data-sec': 'saves' }, ABILITIES.map((a) => {
    const x = s.abilities[a.id];
    const check = x.check ?? x.mod;
    return h('div', { class: 'ch-abil', 'data-stat': a.id },
      h('button', { class: 'ch-abil-check', type: 'button', 'aria-label': `${a.full} check`, onclick: () => rollToast(`${a.full} check`, check) },
        h('span', { class: 'ch-abil-name' }, a.full),
        adjustedValue(s, `ability:${a.id}`, fmt(check), { className: 'ch-abil-mod' }),
        adjustedValue(s, `score:${a.id}`, String(x.score), { className: 'ch-abil-score' })),
      h('button', { class: 'ch-abil-save', type: 'button', 'aria-label': `${a.full} saving throw`, onclick: () => rollToast(`${a.full} save`, x.save) },
        profMark(x.saveProf ? 'proficient' : 'none', { title: profTitle(x.saveProf ? 'proficient' : 'none', saves[a.id]) }),
        h('span', { class: 'ch-abil-save-label' }, 'Save'),
        adjustedValue(s, `save:${a.id}`, fmt(x.save), { className: 'ch-abil-save-val' })));
  })));
}

function passive(s) {
  return section('passive', 'Passive scores & senses', { iconName: 'eye' },
    h('dl', { class: 'ch-dl' },
      h('dt', null, 'Passive Perception'), h('dd', { class: 'num', 'data-stat': 'passive-perception' }, adjustedValue(s, 'passive:perception', String(s.passive.perception))),
      h('dt', null, 'Passive Insight'), h('dd', { class: 'num' }, adjustedValue(s, 'passive:insight', String(s.passive.insight))),
      h('dt', null, 'Passive Investigation'), h('dd', { class: 'num' }, adjustedValue(s, 'passive:investigation', String(s.passive.investigation))),
      h('dt', null, 'Size'), h('dd', { 'data-stat': 'size' }, s.size || '—'),
      s.senses ? [h('dt', null, 'Senses'), h('dd', null, Array.isArray(s.senses) ? s.senses.join(', ') : typeof s.senses === 'object' ? Object.entries(s.senses).map(([k, v]) => `${prettify(k)} ${v} ft.`).join(', ') : String(s.senses))] : null));
}

// Compact skill list (D&D Beyond sizing): mark · ability · name · bonus box. "Proficient only" folds it (per device).
function skills(c, s) {
  const info = s.proficiencyInfo?.skills || {};
  const level = (x) => (x.expertise ? 'expertise' : x.prof ? 'proficient' : x.half ? 'half' : 'none');
  const all = skillList().map((sk) => ({ sk, x: s.skills[sk.id] }));
  const folded = !!getSetting('chSkillsFolded') && all.some(({ x }) => x.prof || x.expertise);
  const rows = folded ? all.filter(({ x }) => x.prof || x.expertise) : all;
  return section('skills', 'Skills', {
    iconName: 'compass', attrs: accentAttrs(c), className: 'ch-sec-skills',
    actions: [
      h('button', {
        class: 'btn-icon btn-sm', type: 'button', 'aria-pressed': String(folded), 'aria-label': folded ? 'Show all skills' : 'Show proficient skills only',
        title: folded ? 'Show all 18 skills' : 'Show proficient skills only', onclick: () => { setSetting('chSkillsFolded', !folded); render(); },
      }, icon(folded ? 'chevron-down' : 'chevron-up')),
      h('a', { class: 'btn-icon btn-sm', href: editHref('proficiencies'), title: 'Change proficiency and expertise (Edit all)', 'aria-label': 'Change skill proficiencies' }, icon('edit'))],
  },
  h('div', { class: 'ch-skl-head ui', 'aria-hidden': 'true' }, h('span', null, 'Prof'), h('span', null, 'Mod'), h('span', null, 'Skill'), h('span', null, 'Bonus')),
  h('ul', { class: 'ch-skl', role: 'list', 'aria-label': 'Skills' }, rows.map(({ sk, x }) => h('li', { class: ['ch-skl-row', x.prof && 'is-prof'], 'data-stat': sk.id },
    profMark(level(x), { title: profTitle(level(x), info[sk.id]) }),
    h('span', { class: 'ch-skl-ab ui' }, String(x.ability || sk.ability).toUpperCase()),
    h('span', { class: 'ch-skl-name' }, sk.name),
    h('button', { class: 'ch-skl-bonus', type: 'button', 'aria-label': `Roll ${sk.name}`, onclick: () => rollToast(sk.name, x.bonus) }, adjustedValue(s, `skill:${sk.id}`, fmt(x.bonus)))))),
  h('p', { class: 'ch-plegend ui text-xs' },
    h('span', null, profMark('proficient'), 'Proficient'), h('span', null, profMark('expertise'), 'Expertise'),
    all.some(({ x }) => x.half) ? h('span', null, profMark('half'), 'Half') : null,
    folded ? h('span', null, `${all.length - rows.length} more hidden`) : null));
}

function proficiencies(c, s) {
  const list = (items, kind) => (items?.length ? h('div', { class: 'row ch-chip-row' }, [...new Set(items)].map((id) => h('span', { class: 'chip' }, profName(kind, id)))) : h('span', { class: 'faint ui text-sm' }, 'None'));
  const res = [...new Set([...(s.resistances || [])])];
  return section('proficiencies', 'Proficiencies & languages', { iconName: 'book-open', actions: [h('a', { class: 'btn-icon btn-sm', href: editHref('proficiencies'), title: 'Edit proficiencies', 'aria-label': 'Edit proficiencies' }, icon('edit'))] },
    h('div', { class: 'stack stack-sm ch-profs' },
      h('div', null, h('h4', { class: 'ch-mini-head' }, 'Armor'), list(s.proficiencies.armor, 'armor')),
      h('div', null, h('h4', { class: 'ch-mini-head' }, 'Weapons'), list(s.proficiencies.weapons, 'weapons')),
      h('div', null, h('h4', { class: 'ch-mini-head' }, 'Tools'), list(s.proficiencies.tools, 'tools')),
      h('div', null, h('h4', { class: 'ch-mini-head' }, 'Languages'), list(s.languages, 'languages')),
      h('div', { 'data-stat': 'resistances' }, h('h4', { class: 'ch-mini-head' }, 'Resistances'),
        res.length ? h('div', { class: 'row ch-chip-row' }, res.map((r) => h('span', { class: 'chip' }, prettify(typeof r === 'object' ? r.type || r.id : r)))) : null,
        c.details.resistances ? md(c.details.resistances) : res.length ? null : h('span', { class: 'faint ui text-sm' }, 'None'))));
}

// ---------- attacks ----------

function attacks(c, s) {
  const rows = s.attacks;
  return section('attacks', 'Attacks', {
    iconName: 'sword',
    actions: [h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addItems(['weapon']) }, icon('plus'), 'Weapon')],
  },
  rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense ch-attacks' },
    h('thead', null, h('tr', null, h('th', null, 'Attack'), h('th', { class: 'num' }, 'Hit'), h('th', null, 'Damage'), h('th', null, 'Range'), h('th', null, 'Mastery'), h('th', null, 'Notes'))),
    h('tbody', null, rows.map((a) => {
      const item = a.uid ? c.inventory.find((i) => i.uid === a.uid) : null;
      const entry = item ? findEntry(item.kind, item.ref) : null;
      const m = a.mastery && typeof a.mastery === 'object' ? a.mastery : a.mastery ? masteryInfo(a.mastery) : null;
      const range = typeof a.range === 'object' && a.range ? `${a.range.normal}${a.range.long ? `/${a.range.long}` : ''} ft` : a.range || '';
      const notesText = Array.isArray(a.notes) ? a.notes.join(' · ') : a.notes || '';
      return h('tr', { 'data-stat': a.uid || (a.unarmed ? 'unarmed' : null), class: a.proficient === false ? 'is-unproficient' : null },
        h('td', { class: 'cell-name' }, entry ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(entry) }, a.name) : a.name,
          a.properties?.length ? h('div', { class: 'ch-props' }, a.properties.map((p, pi) => h('span', { class: 'ch-prop', title: propertyInfo(p)?.description?.slice(0, 300) || null }, a.propertyNames?.[pi] || prettify(p)))) : null),
        h('td', { class: 'num' }, h('button', { class: 'ch-link-btn num ch-bonus', type: 'button', 'aria-label': `Roll to hit with ${a.name}`, onclick: () => rollToast(`${a.name} to hit`, a.bonus) },
          adjustedValue(s, `attack:${a.uid || (a.unarmed ? 'unarmed' : '')}`, typeof a.bonus === 'number' ? fmt(a.bonus) : String(a.bonus ?? '')))),
        h('td', null, adjustedValue(s, `damage:${a.uid || (a.unarmed ? 'unarmed' : '')}`, a.damage || ''), a.damageType ? ` ${prettify(a.damageType)}` : '', a.versatile ? h('div', { class: 'cell-muted text-xs ui' }, `Two-handed: ${a.versatile}`) : null),
        h('td', { class: 'cell-muted' }, range),
        h('td', null, m ? h('span', { class: 'badge badge-accent', title: m.description || '' }, m.name || prettify(m.id)) : h('span', { class: 'faint' }, '—')),
        h('td', { class: ['cell-muted', a.proficient === false && 'danger-text'] }, notesText));
    })))) : null,
  !rows.some((a) => a.uid) ? h('p', { class: 'muted ui text-sm' }, 'Add a weapon and tick “Equipped” in the inventory to list its attack here.') : null);
}

// ---------- spellcasting ----------

/** The casting numbers behind a spell row: its class's spellcasting, or the species/feat (innate) group. */
function spellCaster(x, s) {
  const sc = x.class ? s.spellcasting.find((y) => y.class === x.class) : null;
  if (sc) return { sc, key: sc.class, attack: sc.attack, dc: sc.dc, mod: sc.mod ?? s.abilities[sc.ability]?.mod ?? 0, label: sc.name || entryName('class', sc.class) };
  const g = x.innate || !x.class ? (s.innate || []).find((y) => y.key === x.group || (y.spells || []).includes(x.id)) : null;
  if (g && (x.innate || x.always)) return { sc: null, key: `innate:${g.key}`, attack: g.attack, dc: g.dc, mod: s.abilities[g.ability]?.mod ?? 0, label: g.source || 'Innate' };
  return null;
}

function spellRows(c, s) {
  const src = Array.isArray(s.spells) ? s.spells : c.spells;
  const lvl = Number(s.totalLevel) || totalLevel(c) || 1;
  return src.map((x) => {
    const entry = findEntry('spell', x.id);
    const caster = spellCaster(x, s);
    const stored = !x.always && !x.innate && c.spells.some((y) => y.id === x.id && (y.class || null) === (x.class || null));
    // Off-list: stored spells that don't fit the class (not on its list, too high, no spellcasting) — shown, never blocked
    const issues = entry && stored ? spellIssues(entry, caster?.sc || null, { className: x.class ? entryName('class', x.class) : null }) : [];
    return {
      ...x, entry, name: x.name || entry?.name || prettify(x.id), level: Number(x.level ?? entry?.level ?? 0), caster, stored, issues,
      stats: entry ? spellStats(entry, { charLevel: lvl, caster }) : null,
    };
  });
}

/** Roll a spell's damage or healing into a toast ("Fire Bolt: 2d10 (3, 7) = 10 Fire"). */
function rollSpellEffect(name, parts, { heal = false, count = null } = {}) {
  const out = [];
  for (const d of parts) {
    const r = rollDice({ dice: d.dice, bonus: d.bonus });
    if (!r) continue;
    out.push(`${d.dice}${d.bonus ? ` ${d.bonus < 0 ? '−' : '+'} ${Math.abs(d.bonus)}` : ''} (${r.rolls.join(', ')}) = ${r.total}${heal ? ' HP' : d.typeName ? ` ${d.typeName}` : ''}`);
    if (d.alt) break;
  }
  if (!out.length) return;
  toast(`${name}${heal ? ' heals' : ''}: ${out.join(' + ')}${count && count.count > 1 ? ` — each of ${count.count} ${count.unit}s` : ''}`, { type: 'info', timeout: 6000 });
}

/** To-hit / save DC and damage / healing chips of one spell row. */
function spellFx(r, s) {
  const st = r.stats;
  if (!st) return null;
  const key = r.caster?.key;
  const chips = [];
  if (st.attack) {
    chips.push(st.toHit != null
      ? h('button', { class: 'ch-spell-chip ch-spell-hit', type: 'button', title: `Roll a ${st.attack} spell attack with ${r.name}`, onclick: () => rollToast(`${r.name} (spell attack)`, st.toHit), 'data-fk': `hit-${r.class || r.group}-${r.id}` },
        adjValue(s, `spellAttack:${key}`, fmt(st.toHit)), h('span', { class: 'ch-spell-chip-label' }, 'to hit'))
      : h('span', { class: 'ch-spell-chip is-muted', title: 'No spellcasting ability for this spell' }, `${prettify(st.attack)} spell attack`));
  }
  if (st.save) {
    const ab = (ABILITIES.find((a) => a.id === st.save)?.name || st.save.toUpperCase());
    chips.push(st.dc != null
      ? h('span', { class: 'ch-spell-chip ch-spell-dc', title: `${ABILITIES.find((a) => a.id === st.save)?.full || ab} saving throw` }, h('span', { class: 'ch-spell-chip-label' }, 'DC'), adjValue(s, `spellDc:${key}`, String(st.dc)), ` ${ab}`)
      : h('span', { class: 'ch-spell-chip is-muted' }, `${ab} save`));
  }
  const tip = [st.scaling?.next ? `At character level ${st.scaling.next.level}: ${st.scaling.kind === 'count' ? `${st.scaling.next.count} ${st.count?.unit || 'beam'}s` : st.scaling.next.dice}.` : '', st.higherLevel ? `${r.level ? 'Using a higher-level spell slot' : 'Cantrip upgrade'}: ${st.higherLevel}` : '', st.parsed ? '(Read from the spell text.)' : ''].filter(Boolean).join('\n');
  if (st.damage.length) {
    const count = st.count && st.count.count > 1 ? `${st.count.count} × ` : '';
    chips.push(h('button', { class: 'ch-spell-chip ch-spell-dmg', type: 'button', title: `Roll damage${tip ? `\n${tip}` : ''}`, onclick: () => rollSpellEffect(r.name, st.damage, { count: st.count }), 'data-fk': `dmg-${r.class || r.group}-${r.id}` },
      h('span', { class: 'num' }, `${count}${st.damageText}`)));
  }
  if (st.heal) {
    const rollable = !!st.heal.dice;
    chips.push(h(rollable ? 'button' : 'span', { class: 'ch-spell-chip ch-spell-heal', type: rollable ? 'button' : null, title: `${rollable ? 'Roll healing' : 'Healing'}${tip ? `\n${tip}` : ''}`, onclick: rollable ? () => rollSpellEffect(r.name, [st.heal], { heal: true }) : null },
      icon('heart'), h('span', { class: 'num' }, st.heal.text)));
  }
  return chips.length ? h('div', { class: 'ch-spell-fx' }, chips) : null;
}

/** Second line of a spell row: casting time · range · class, plus cantrip scaling / upcast note. */
function spellMeta(r) {
  const st = r.stats;
  const note = st?.scaling && r.level === 0
    ? (st.scaling.next ? `${st.scaling.kind === 'count' ? `${st.scaling.next.count} ${st.count?.unit || 'beam'}s` : st.scaling.next.dice} at level ${st.scaling.next.level}` : '')
    : st?.upcast && (st.damage.length || st.heal || st.upcast.what === 'count') ? `Higher slots ${st.upcast.what === 'count' ? `+1 ${st.upcast.unit}` : `+${st.upcast.dice}`} each` : '';
  return h('div', { class: 'ch-spell-meta muted ui' },
    [r.entry?.castingTime, r.entry?.range, r.class ? entryName('class', r.class) : r.source].filter(Boolean).join(' · '),
    note ? [' · ', h('span', { class: 'ch-spell-up', title: st.higherLevel || null }, note)] : null);
}

function spells(c, s) {
  const rows = spellRows(c, s);
  if (!s.spellcasting.length && !rows.length && !s.slots.some(Boolean) && !s.pact) return null;
  const byLevel = new Map();
  rows.forEach((r) => { if (!byLevel.has(r.level)) byLevel.set(r.level, []); byLevel.get(r.level).push(r); });
  const preparedCount = (sc) => sc.preparedCount ?? c.spells.filter((x) => x.class === sc.class && x.prepared && !x.always && (Number(findEntry('spell', x.id)?.level) || 0) > 0).length;
  const cantripCount = (sc) => sc.cantripCount ?? c.spells.filter((x) => x.class === sc.class && (Number(findEntry('spell', x.id)?.level) || 0) === 0 && !x.always).length;
  const innate = Array.isArray(s.innate) ? s.innate : [];
  const togglePrepared = (r, on) => mutate((y) => {
    const t = y.spells.find((x) => x.id === r.id && (x.class || null) === (r.class || null)) || y.spells.find((x) => x.id === r.id);
    if (t) t.prepared = on;
  });
  const removeSpell = (r) => mutate((y) => { y.spells = y.spells.filter((x) => !(x.id === r.id && (x.class || null) === (r.class || null))); });
  return section('spells', 'Spellcasting', {
    iconName: 'sparkle',
    actions: [h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addSpells(s) }, icon('plus'), 'Spells')],
  },
  s.spellcasting.length ? h('div', { class: 'ch-casters' }, s.spellcasting.map((sc) => h('div', { class: 'ch-caster' },
    h('strong', null, entryName('class', sc.class) || prettify(sc.class)),
    h('span', { class: 'badge' }, String(sc.ability || '').toUpperCase()),
    h('span', null, 'Save DC ', adjValue(s, `spellDc:${sc.class}`, String(sc.dc), { className: 'ch-caster-num' })),
    h('span', null, 'Attack ', h('button', { class: 'ch-link-btn ch-bonus', type: 'button', title: 'Roll a spell attack', onclick: () => rollToast(`${entryName('class', sc.class)} spell attack`, sc.attack) }, adjValue(s, `spellAttack:${sc.class}`, fmt(sc.attack)))),
    sc.cantrips ? h('span', { class: cantripCount(sc) > sc.cantrips ? 'danger-text' : 'muted' }, `Cantrips ${cantripCount(sc)}/${sc.cantrips}`) : null,
    sc.prepared ? h('span', { class: preparedCount(sc) > sc.prepared ? 'danger-text' : 'muted' }, `Prepared ${preparedCount(sc)}/${sc.prepared}`) : null,
    sc.spellbook ? h('span', { class: 'muted' }, `Spellbook ${sc.spellbook.count}${sc.spellbook.size ? `/${sc.spellbook.size}+` : ''}`) : null))) : null,
  innate.length ? h('div', { class: 'ch-casters' }, innate.map((g) => h('div', { class: 'ch-caster' },
    h('strong', null, g.source || 'Innate'),
    h('span', { class: 'badge' }, String(g.ability || '').toUpperCase()),
    h('span', null, 'Save DC ', adjValue(s, `spellDc:innate:${g.key}`, String(g.dc), { className: 'ch-caster-num' })),
    h('span', null, 'Attack ', h('button', { class: 'ch-link-btn ch-bonus', type: 'button', title: 'Roll a spell attack', onclick: () => rollToast(`${g.source || 'Innate'} spell attack`, g.attack) }, adjValue(s, `spellAttack:innate:${g.key}`, fmt(g.attack)))),
    h('span', { class: 'muted' }, (g.spells || []).map((id) => entryName('spell', id)).join(', '))))) : null,
  s.slots.some(Boolean) || s.pact ? h('div', { class: 'ch-slots', 'data-sec': 'slots' },
    s.slots.map((n, i) => (n ? h('div', { class: 'ch-slot-row' },
      h('span', { class: 'ch-slot-lvl' }, `Level ${i + 1}`),
      pips({ max: n, used: c.slotsUsed[i], label: `Level ${i + 1} slots`, fk: `slot${i}`, onChange: (u) => mutate((y) => { y.slotsUsed[i] = u; }) }),
      h('span', { class: 'muted ui text-xs' }, `${Math.max(0, n - (c.slotsUsed[i] || 0))} left`)) : null)),
    s.pact ? h('div', { class: 'ch-slot-row ch-pact' },
      h('span', { class: 'ch-slot-lvl' }, `Pact (L${s.pact.level ?? s.pact.slotLevel ?? '?'})`),
      pips({ max: s.pact.slots, used: c.pactUsed, label: 'Pact Magic slots', fk: 'pact', onChange: (u) => mutate((y) => { y.pactUsed = u; }) }),
      h('span', { class: 'muted ui text-xs' }, 'short rest')) : null) : null,
  rows.length ? h('div', { class: 'ch-spell-levels' }, [...byLevel.keys()].sort((a, b) => a - b).map((lvl) => {
    const slots = lvl > 0 ? Number(s.slots[lvl - 1]) || 0 : 0;
    const pactLvl = s.pact ? Number(s.pact.level) || 0 : 0;
    const pactHere = lvl > 0 && pactLvl >= lvl;
    return h('div', { class: 'ch-spell-level' },
      h('h4', { class: 'ch-mini-head ch-spell-lvl-head' }, lvl === 0 ? 'Cantrips' : `Level ${lvl}`,
        h('span', { class: 'ch-spell-lvl-sub' }, [
          lvl === 0 ? 'at will' : slots ? `${Math.max(0, slots - (c.slotsUsed[lvl - 1] || 0))} of ${slots} slots left` : '',
          pactHere ? (pactLvl === lvl ? `${Math.max(0, s.pact.slots - (c.pactUsed || 0))} of ${s.pact.slots} pact slots` : `cast with level ${pactLvl} pact slots`) : '',
          lvl > 0 && !slots && !pactHere ? 'no slots' : ''].filter(Boolean).join(' · '))),
      h('ul', { class: 'ch-spell-list', role: 'list' }, byLevel.get(lvl).sort((a, b) => a.name.localeCompare(b.name)).map((r) => h('li', {
        class: ['ch-spell', r.prepared || r.always || lvl === 0 ? 'is-prepared' : 'is-unprepared', r.issues.length && 'is-off'], 'data-stat': r.id,
      },
      lvl > 0 ? h('input', {
        type: 'checkbox', class: 'checkbox ch-spell-prep', checked: !!(r.prepared || r.always), disabled: !!r.always, 'data-fk': `prep-${r.class}-${r.id}`,
        title: r.always ? 'Always prepared' : 'Prepared', 'aria-label': `Prepare ${r.name}`, onchange: (e) => togglePrepared(r, e.target.checked),
      }) : h('span', { class: 'ch-spell-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'ch-spell-id' },
        h('div', { class: 'ch-spell-title' },
          h('button', { class: 'ch-link-btn ch-spell-name', type: 'button', onclick: () => r.entry ? entryModal(r.entry) : toast('This spell is not in the SRD; see your book.') }, r.name),
          r.always ? h('span', { class: 'badge badge-info', title: r.source || 'Always prepared' }, icon('lock'), 'always') : null,
          r.entry?.concentration ? h('span', { class: 'badge', title: 'Concentration' }, 'C') : null,
          r.entry?.ritual ? h('span', { class: 'badge', title: 'Ritual' }, 'R') : null,
          r.issues.length ? h('span', { class: 'ch-spell-off', tabindex: 0, title: `Added anyway: ${r.issues.map((i) => i.text).join(' ')}`, 'aria-label': `Off-list: ${r.issues.map((i) => i.text).join(' ')}` }, 'off-list') : null),
        spellMeta(r)),
      spellFx(r, s),
      !r.always && r.stored ? h('button', { class: 'btn-icon btn-sm ch-row-x', type: 'button', 'aria-label': `Remove ${r.name}`, title: 'Remove', onclick: () => removeSpell(r) }, icon('close')) : h('span', { class: 'ch-row-x', 'aria-hidden': 'true' })))));
  })) : h('p', { class: 'muted ui text-sm' }, 'No spells chosen yet.'));
}

async function addSpells(s) {
  const casters = s.spellcasting;
  let sc = casters[0] || null;
  if (casters.length > 1) {
    sc = await new Promise((resolve) => {
      let pick = null;
      const m = openModal({
        title: 'Add spells for…',
        body: h('div', { class: 'stack' }, casters.map((x) => h('button', { class: 'btn', type: 'button', onclick: () => { pick = x; m.close(); } }, entryName('class', x.class)))),
        onClose: () => resolve(pick),
      });
    });
    if (!sc) return;
  }
  const avail = sc ? availableSpells(S.char, sc.class) : null;
  const allowed = avail?.spells?.length ? new Set(avail.spells.map((e) => e.id)) : null;
  const max = avail?.maxLevel ?? sc?.maxSpellLevel ?? 9;
  const className = sc ? entryName('class', sc.class) : '';
  // already known for this class: stored picks + always-prepared / granted spells (re-adding would hide "always")
  const have = new Set([...S.char.spells, ...(Array.isArray(s.spells) ? s.spells : [])].filter((x) => (x.class || null) === (sc?.class || null)).map((x) => x.id));
  const issuesOf = (e) => (sc ? spellIssues(e, sc, { className }) : []);
  const res = await openPicker('spell', {
    title: sc ? `${className} spells (up to level ${max})` : 'Add spells',
    multi: true,
    filter: (e) => !have.has(e.id) && (!allowed || allowed.has(e.id)),
    // Any spell may be added; the ones that don't fit get a notice first and an "off-list" mark on the sheet.
    widen: sc ? { label: 'Show all spells', hint: `Include spells outside the ${className} list or above level ${max}. You’ll be told why they don’t fit and can add them anyway.`, filter: (e) => !have.has(e.id) } : null,
    mark: sc ? (e) => { const is = issuesOf(e); return is.length ? { label: is.some((i) => i.code === 'not-on-list') ? 'off-list' : 'too high', title: is.map((i) => i.text).join(' ') } : null; } : null,
  });
  let picked = [].concat(res || []).filter(Boolean);
  if (!picked.length) return;
  // Compatibility notice (never blocks): list, slot level, cantrip / prepared limits, no spellcasting class
  let plan = addSpellIssues(picked, sc, { className });
  if (!sc) plan = plan.map((x) => ({ ...x, issues: [{ code: 'no-caster', text: s.innate?.length ? 'Not tied to a spellcasting class: it uses no class’s attack bonus or save DC.' : `${S.char.name || 'This character'} has no spellcasting class, so the sheet can’t show an attack bonus or save DC.` }] }));
  const bad = plan.filter((x) => x.issues.length);
  if (bad.length) {
    const fits = plan.length - bad.length;
    const choice = await choiceDlg(h('div', { class: 'stack stack-sm ch-offlist-notice' },
      h('p', null, sc ? `${bad.length === 1 ? 'This spell doesn’t' : `${bad.length} of these spells don’t`} fit ${className} ${sc.classLevel ?? ''} as built:` : 'A heads-up before adding:'),
      h('ul', { class: 'ui text-sm' }, bad.map((x) => h('li', null, h('strong', null, x.record.name), ` (${Number(x.record.level) ? `level ${x.record.level}` : 'cantrip'}) — `, x.issues.map((i) => i.text).join(' ')))),
      h('p', { class: 'muted ui text-sm' }, 'You can still add them (a house rule, a scroll, a DM’s gift…). They get a small “off-list” mark on the sheet.')),
    [{ label: 'Cancel', value: null, kind: 'ghost' }, fits ? { label: `Add only the ${fits} that fit`, value: 'fits' } : null, { label: bad.length === plan.length ? 'Add anyway' : 'Add all anyway', value: 'all', kind: 'primary' }].filter(Boolean),
    { title: 'Not a usual pick for this build' });
    if (!choice) return;
    if (choice === 'fits') plan = plan.filter((x) => !x.issues.length);
  }
  picked = plan.map((x) => x.record);
  mutate((y) => {
    for (const x of plan) {
      if (y.spells.some((z) => z.id === x.record.id && (z.class || null) === (sc?.class || null))) continue;
      y.spells.push({ id: x.record.id, class: sc?.class || null, prepared: x.prepared, always: false });
    }
  });
  const off = plan.filter((x) => x.issues.some((i) => ['not-on-list', 'too-high', 'no-caster'].includes(i.code))).length;
  const unprepared = plan.filter((x) => !x.prepared).length;
  toast(`Added ${picked.length} spell${picked.length === 1 ? '' : 's'}${off ? ` (${off} off-list)` : ''}${unprepared ? `; ${unprepared} went into the spellbook unprepared (no room to prepare)` : ''}.`);
}

// ---------- features & resources ----------

function featureGroup(f) {
  const st = f.sourceType;
  if ((st === 'class' || st === 'option') && f.classId) return [`1:${f.classId}`, `${entryName('class', f.classId)} features`];
  if (st === 'subclass' && f.subclassId) return [`2:${f.subclassId}`, entryName('subclass', f.subclassId)];
  if (st === 'species' || st === 'subspecies') return ['3:species', 'Species traits'];
  if (st === 'background' || st === 'origin') return ['4:background', 'Background'];
  if (st === 'feat' || f.source === 'Feat') return ['5:feat', 'Feats'];
  if (st === 'custom' || f.source === 'Custom') return ['6:custom', 'Special abilities'];
  return [`7:${f.source || 'other'}`, f.source || 'Other'];
}

function features(c, s) {
  const groups = new Map();
  for (const f of s.features) {
    const [k, label] = featureGroup(f);
    if (!groups.has(k)) groups.set(k, { label, list: [] });
    groups.get(k).list.push(f);
  }
  const choices = Array.isArray(s.choices) && s.choices.length ? s.choices : (() => { try { return allChoices(c); } catch { return []; } })();
  const choiceByKey = new Map(choices.map((x) => [x.key, x]));
  const resByKey = new Map(s.resources.map((r) => [r.key, r]));
  return section('features', 'Features & traits', {
    iconName: 'scroll',
    actions: [
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setAllFeatures(true) }, 'Expand all'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setAllFeatures(false) }, 'Collapse'),
      h('a', { class: 'btn btn-ghost btn-sm', href: editHref('advanced') }, icon('plus'), 'Ability')],
  },
  s.features.length ? [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => h('div', { class: 'ch-feat-group' },
    h('h3', { class: 'ch-feat-group-title' }, g.label),
    g.list.map((f) => feature(f, choiceByKey, resByKey)))) : h('p', { class: 'muted ui text-sm' }, 'No features yet. Choose a class, species and background.'));
}

function setAllFeatures(open) {
  S.root.querySelectorAll('details.ch-feat').forEach((d) => { d.open = open; });
}

function feature(f, choiceByKey, resByKey) {
  const fid = f.id || f.name;
  const res = (f.uses && typeof f.uses === 'object' && f.uses.key && resByKey.get(f.uses.key)) || (typeof f.uses === 'string' && resByKey.get(f.uses)) || resByKey.get(f.id) || null;
  const choice = f.choiceKey ? choiceByKey.get(f.choiceKey) : null;
  const value = choice ? currentValue(choice, S.char) : null;
  const picks = choice ? valueNames(choice, value, { char: S.char, sheet: S.sheet }) : '';
  const body = h('div', { class: 'ch-feat-body' });
  const fill = () => {
    if (body.dataset.filled) return;
    body.dataset.filled = '1';
    body.append(md(f.description, { empty: 'No description.' }));
    if (f.modifiers) body.append(h('p', { class: 'muted ui text-sm' }, describeModifiers(f.modifiers)));
  };
  const det = h('details', { class: 'ch-feat', 'data-stat': fid, open: S.openFeatures.has(fid) },
    h('summary', null,
      h('span', { class: 'ch-feat-name' }, f.name),
      f.levels?.length > 1 ? h('span', { class: 'badge' }, `Lv ${f.levels.join(', ')}`) : f.level ? h('span', { class: 'badge' }, `Lv ${f.level}`) : null,
      f.via ? h('span', { class: 'ch-feat-pick' }, `via ${f.via}`) : null,
      picks ? h('span', { class: 'ch-feat-pick' }, picks) : choice ? h('span', { class: 'badge badge-warn' }, 'choose') : null,
      h('span', { class: 'spacer' }),
      res ? resourcePips(res, true) : null),
    body,
    choice ? h('div', { class: 'ch-feat-choice row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openChoice(choice) }, icon('edit'), picks ? 'Change choice' : 'Choose')) : null);
  det.addEventListener('toggle', () => { if (det.open) { S.openFeatures.add(fid); fill(); } else S.openFeatures.delete(fid); });
  if (det.open) fill();
  return det;
}

function openChoice(choice) {
  const holder = h('div');
  let work = clone(S.char);
  const draw = () => {
    const sheet = derive(work);
    const fresh = allChoices(work, sheet).find((x) => x.key === choice.key) || choice;
    mount(holder, renderChoice(fresh, { char: work, sheet, showDescription: false, mutate: (fn) => { fn(work); draw(); } }));
  };
  draw();
  openModal({
    title: choice.label || 'Choice', wide: true, body: holder,
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Apply', kind: 'primary', onClick: () => replaceChar(work) }],
  });
}

function resourcePips(r, compact = false) {
  const max = Number(r.max) || 0;
  if (!max) return null;
  const set = (u) => mutate((y) => { y.resourcesUsed[r.key] = Math.max(0, Math.min(max, u)); });
  if (max > 10) {
    return h('span', { class: 'ch-res-num', onclick: (e) => { if (compact) e.preventDefault(); e.stopPropagation(); } },
      numberInput(Math.max(0, max - (r.used || 0)), (v) => set(max - (v ?? max)), { class: 'input input-sm ch-w-num', min: 0, max, 'aria-label': `${r.label} remaining`, 'data-fk': `res-${r.key}${compact ? '-c' : ''}` }),
      h('span', { class: 'muted ui text-xs' }, ` / ${max}`));
  }
  const p = pips({ max, used: r.used, label: r.label, fk: `res-${r.key}${compact ? '-c' : ''}`, onChange: set });
  if (compact) p.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  return p;
}

function resources(c, s) {
  if (!s.resources.length) return null;
  return section('resources', 'Resources', { iconName: 'layers' },
    h('ul', { class: 'ch-res-list', role: 'list' }, s.resources.map((r) => h('li', { class: 'ch-res', 'data-stat': r.key },
      h('span', { class: 'ch-res-label' }, r.label, r.die ? ` (${r.die})` : '', r.source ? h('span', { class: 'ch-inv-kind' }, r.source) : null),
      resourcePips(r),
      r.recharge ? h('span', { class: 'badge' }, r.recharge === 'short' ? 'Short rest' : r.recharge === 'long' ? 'Long rest' : prettify(r.recharge)) : null))));
}

// ---------- inventory & currency ----------

const ITEM_KINDS = ['weapon', 'armor', 'gear', 'magic-item'];

async function addItems(kinds = ITEM_KINDS) {
  const res = await openPicker(kinds, { title: 'Add to inventory', multi: true });
  const picked = [].concat(res || []).filter(Boolean);
  if (!picked.length) return;
  mutate((y) => { picked.forEach((e) => y.inventory.push(itemFromEntry(e))); });
  toast(`Added ${picked.map((e) => e.name).join(', ')}.`);
}

function itemFromEntry(e) {
  const kind = e.kind || 'gear';
  return { uid: shortId(), kind, ref: e.id, name: e.name, qty: Number(e.quantity) > 1 && kind === 'gear' && e.category === 'ammunition' ? Number(e.quantity) : 1, equipped: false, attuned: false, notes: '', custom: null };
}

async function createCustom() {
  const kind = await new Promise((resolve) => {
    let pick = null;
    const m = openModal({
      title: 'Create a custom item',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'It is saved to the shared library (Compendium) so the whole party can use it, then added to this inventory.'),
        h('div', { class: 'ch-kind-grid' }, [['weapon', 'Weapon', 'sword'], ['armor', 'Armor or shield', 'shield'], ['gear', 'Gear or tool', 'backpack'], ['magic-item', 'Magic item', 'sparkle']].map(([k, label, ic]) =>
          h('button', { class: 'btn ch-kind-btn', type: 'button', onclick: () => { pick = k; m.close(); } }, icon(ic), label)))),
      onClose: () => resolve(pick),
    });
  });
  if (!kind) return;
  const saved = await openEntryEditor(kind);
  if (!saved) return;
  mutate((y) => { y.inventory.push(itemFromEntry({ ...saved, kind: saved.kind || kind })); });
  toast(`${saved.name} saved to the library and added.`, { type: 'success' });
}

function itemWeight(it) {
  const resolved = (S.sheet?.items || []).find((x) => x.uid === it.uid);
  if (resolved && resolved.totalWeight != null) return Number(resolved.totalWeight) || 0;
  const e = findEntry(it.kind, it.ref);
  const w = it.custom?.weight ?? e?.weight ?? 0;
  return (Number(w) || 0) * (Number(it.qty) || 0);
}

function inventory(c, s) {
  const attuned = c.inventory.filter((i) => i.attuned).length;
  const enc = s.encumbrance;
  const carried = Number(enc.carried ?? c.inventory.reduce((n, i) => n + itemWeight(i), 0)) || 0;
  const cap = Number(enc.capacity) || 0;
  const over = cap && carried > cap;
  return section('inventory', 'Inventory', {
    iconName: 'backpack',
    actions: [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addItems() }, icon('plus'), 'Add item'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: createCustom }, icon('edit'), 'Create custom')],
  },
  h('div', { class: 'ch-inv-meta row ui text-sm' },
    h('span', { class: over ? 'danger-text' : 'muted' }, `Carried ${round(carried)} lb`, cap ? ` of ${cap} lb` : ''),
    cap ? h('span', { class: ['ch-weightbar', over && 'is-over'] }, h('span', { style: { width: `${Math.min(100, Math.round((carried / cap) * 100))}%` } })) : null,
    h('span', { class: attuned > 3 ? 'danger-text' : 'muted' }, `Attuned ${attuned}/3`)),
  c.inventory.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense ch-inv' },
    h('thead', null, h('tr', null, h('th', { class: 'center', title: 'Equipped' }, 'Equip'), h('th', { class: 'center', title: 'Attuned' }, 'Attune'), h('th', null, 'Item'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Weight'), h('th', { class: 'cell-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
    h('tbody', null, c.inventory.map((it) => {
      const e = findEntry(it.kind, it.ref);
      const resolved = (s.items || []).find((x) => x.uid === it.uid);
      const canAttune = !!(resolved?.requiresAttunement || e?.attunement || it.custom?.attunement || it.attuned);
      const canEquip = ['weapon', 'armor', 'magic-item'].includes(it.kind) || !!it.equipped;
      return h('tr', { 'data-stat': it.uid, class: it.equipped ? 'is-equipped' : null },
        h('td', { class: 'center' }, canEquip ? h('input', { type: 'checkbox', class: 'checkbox', checked: !!it.equipped, 'aria-label': `Equip ${it.name}`, 'data-fk': `eq-${it.uid}`, onchange: (ev) => mutate((y) => { const t = y.inventory.find((x) => x.uid === it.uid); if (t) t.equipped = ev.target.checked; }) }) : null),
        h('td', { class: 'center' }, canAttune ? h('input', { type: 'checkbox', class: 'checkbox', checked: !!it.attuned, 'aria-label': `Attune ${it.name}`, 'data-fk': `at-${it.uid}`, onchange: (ev) => mutate((y) => { const t = y.inventory.find((x) => x.uid === it.uid); if (t) t.attuned = ev.target.checked; }) }) : null),
        h('td', { class: 'cell-name' },
          e ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryModal(e) }, it.name || e.name) : (it.name || prettify(it.ref)),
          h('span', { class: 'ch-inv-kind' }, [e ? entryKindLabel(e) : prettify(it.kind), e?.origin === 'custom' ? 'custom' : ''].filter(Boolean).join(' · ')),
          it.notes ? h('div', { class: 'ch-inv-notes' }, mdInline(it.notes)) : null),
        h('td', { class: 'num' }, numberInput(it.qty, (v) => mutate((y) => { const t = y.inventory.find((x) => x.uid === it.uid); if (t) t.qty = Math.max(0, v ?? 0); }), { class: 'input input-sm ch-w-num', min: 0, 'aria-label': `Quantity of ${it.name}`, 'data-fk': `qty-${it.uid}` })),
        h('td', { class: 'num cell-muted' }, itemWeight(it) ? `${round(itemWeight(it))} lb` : '—'),
        h('td', { class: 'cell-actions' },
          h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Edit ${it.name}`, title: 'Edit', onclick: () => editItem(it) }, icon('edit')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove ${it.name}`, title: 'Remove', onclick: async () => { if (await confirmDialog(`Remove ${it.name} from the inventory?`, { okLabel: 'Remove', danger: true })) mutate((y) => { y.inventory = y.inventory.filter((x) => x.uid !== it.uid); }); } }, icon('trash'))));
    })))) : h('div', { class: 'empty-state ch-inv-empty' }, icon('backpack'), h('p', null, 'The pack is empty. Add weapons, armor, gear or magic items from the library, or create your own.')));
}

const round = (n) => Math.round(n * 100) / 100;
const entryKindLabel = (e) => ({ weapon: `${prettify(e.category)} weapon`, armor: e.category === 'shield' ? 'Shield' : `${prettify(e.category)} armor`, gear: prettify(e.category), 'magic-item': `${prettify(e.rarity)} ${prettify(e.category)}`.trim() }[e.kind] || prettify(e.kind));

function editItem(it) {
  const draft = clone(it);
  draft.custom = draft.custom || {};
  const e = findEntry(it.kind, it.ref);
  const notes = markdownEditor({ value: draft.notes || '', rows: 3, onInput: (v) => { draft.notes = v; } });
  const num = (key, label, hint) => field(label, numberInput(draft.custom[key] ?? '', (v) => { if (v == null) delete draft.custom[key]; else draft.custom[key] = v; }, { class: 'input input-sm', placeholder: '—' }), hint);
  const text = (key, label, ph) => field(label, input({ value: draft.custom[key] ?? '', placeholder: ph || '', onchange: (ev) => { const v = ev.target.value.trim(); if (v) draft.custom[key] = v; else delete draft.custom[key]; } }));
  const baseSel = () => field('Made from (weapon or armor)', select(
    [{ value: '', label: '— not a weapon or armor —' }, ...cat('weapon').map((w) => ({ value: w.id, label: `Weapon: ${w.name}` })), ...cat('armor').map((a) => ({ value: a.id, label: `Armor: ${a.name}` }))],
    draft.custom.base || '', (v) => { if (v) draft.custom.base = v; else delete draft.custom.base; }), 'Lets a magic weapon or armor attack / add AC like its base item.');
  const overrides = it.kind === 'weapon' ? [num('attackBonus', 'Attack bonus', 'e.g. 1 for a +1 weapon'), num('damageBonus', 'Damage bonus'), text('damage', 'Damage dice', e?.damage), text('damageType', 'Damage type', e?.damageType)]
    : it.kind === 'armor' ? [num('acBonus', 'AC bonus', 'e.g. 1 for +1 armor'), num('ac', 'Base AC override', e?.ac ? `Normally ${e.ac.base}` : '')]
      : it.kind === 'magic-item' ? [baseSel(), num('bonus', 'Magic bonus (+N)', 'Attack & damage for weapons, AC for armor')]
        : [];
  openModal({
    title: `Edit ${it.name}`, wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'field-grid' },
        field('Name', input({ value: draft.name || '', onchange: (ev) => { draft.name = ev.target.value; } })),
        field('Quantity', numberInput(draft.qty, (v) => { draft.qty = Math.max(0, v ?? 0); }, { min: 0 })),
        num('weight', 'Weight each (lb)', e ? `Normally ${e.weight ?? 0} lb` : '')),
      h('div', { class: 'row' },
        checkbox(draft.equipped, (v) => { draft.equipped = v; }, 'Equipped'),
        checkbox(draft.attuned, (v) => { draft.attuned = v; }, 'Attuned'),
        it.kind === 'magic-item' || it.kind === 'gear' ? checkbox(draft.custom.attunement, (v) => { draft.custom.attunement = v || undefined; }, 'Requires attunement') : null),
      overrides.length ? h('div', null, h('h4', { class: 'ch-mini-head' }, 'Stat overrides for this copy'), h('div', { class: 'field-grid' }, overrides)) : null,
      field('Notes', notes, 'Markdown; [[links]] work.'),
      e ? h('details', null, h('summary', { class: 'ui text-sm' }, 'Library entry'), entryModalBody(e)) : null),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: () => mutate((y) => {
          const i = y.inventory.findIndex((x) => x.uid === it.uid);
          if (i < 0) return;
          if (!Object.keys(draft.custom).length) draft.custom = null;
          y.inventory[i] = draft;
        }),
      },
    ],
  });
}

function entryModalBody(e) {
  return h('div', { class: 'ch-entry-inline' }, renderEntry(e));
}

function currency(c) {
  const total = CURRENCY.reduce((n, cur) => n + (Number(c.currency[cur.id]) || 0) * cur.gp, 0);
  return section('currency', 'Currency', { iconName: 'coins', sub: `≈ ${round(total)} gp` },
    h('div', { class: 'ch-coins' }, CURRENCY.map((cur) => h('label', { class: ['ch-coin', `ch-coin-${cur.id}`] },
      h('span', { class: 'ch-coin-id' }, cur.id.toUpperCase()),
      numberInput(c.currency[cur.id] || 0, (v) => mutate((y) => { y.currency[cur.id] = Math.max(0, v || 0); }), { class: 'input input-sm', min: 0, 'aria-label': `${cur.name} pieces`, 'data-fk': `cur-${cur.id}` })))));
}

// ---------- details & notes ----------

function details(c) {
  const short = DETAIL_FIELDS.filter((f) => !f.long);
  const long = DETAIL_FIELDS.filter((f) => f.long && f.key !== 'resistances');
  const species = c.species.id ? entryName('species', c.species.id) : '';
  const align = (R().alignments || []).find((a) => a.id === c.details.alignment)?.name || c.details.alignment;
  const filled = long.filter((f) => String(c.details[f.key] || '').trim());
  const empty = long.filter((f) => !String(c.details[f.key] || '').trim());
  return section('details', 'Details & story', { iconName: 'user', actions: [h('a', { class: 'btn btn-ghost btn-sm', href: editHref('details') }, icon('edit'), 'Edit details')] },
    h('dl', { class: 'ch-details-grid' },
      h('div', null, h('dt', null, 'Species'), h('dd', null, species || h('span', { class: 'faint' }, '—'))),
      h('div', null, h('dt', null, 'Background'), h('dd', null, c.background.id ? entryName('background', c.background.id) : h('span', { class: 'faint' }, '—'))),
      short.map((f) => h('div', { 'data-stat': f.key }, h('dt', null, f.label), h('dd', null, f.key === 'alignment' ? (align || h('span', { class: 'faint' }, '—')) : mdInline(c.details[f.key]))))),
    filled.length ? h('div', { class: 'ch-bio' }, filled.map((f) => h('div', { class: 'ch-bio-item', 'data-stat': f.key }, h('h3', { class: 'ch-bio-title' }, f.label), md(c.details[f.key])))) : null,
    empty.length ? h('p', { class: 'faint ui text-sm ch-bio-empty' }, 'Not written yet: ', empty.map((f) => f.label).join(', '), '. ', h('a', { href: editHref('details') }, 'Add them')) : null);
}

function notes(c) {
  const body = S.notesEditing
    ? markdownEditor({ value: c.details.notes || '', rows: 8, onInput: (v) => { S.char.details.notes = v; persist(S.char); } })
    : md(c.details.notes, { empty: 'Session notes, reminders, loot to sell… Links like [[note:Session 3]] and [[map:Old Mill]] work.' });
  return section('notes', 'Notes', {
    iconName: 'journal',
    actions: [h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { S.notesEditing = !S.notesEditing; render(); if (S.notesEditing) S.root.querySelector('[data-sec="notes"] textarea')?.focus(); } }, icon(S.notesEditing ? 'check' : 'edit'), S.notesEditing ? 'Done' : 'Edit')],
  }, body);
}

// ---------- level up & rests ----------

/** Level Up: chained once per due level when XP earned several (fromXp), else a single (milestone) level. */
function levelUp({ fromXp = true } = {}) {
  flushPersist(S.id);
  levelUpFlow(S.char, { fromXp, onApply: (next) => { replaceChar(next); toast(`${next.name || 'Character'} is now level ${totalLevel(next)}.`, { type: 'success' }); } });
}

function levelDownDialog() {
  flushPersist(S.id);
  openLevelDown(S.char, { onApply: (next) => { replaceChar(next); toast(`${next.name || 'Character'} is now level ${totalLevel(next)}.`); } });
}

/** The Experience window (award / set XP; reaching a threshold opens Level Up). */
function xpWindow(focus) {
  flushPersist(S.id);
  openXpWindow({
    getChar: () => S.char, focus,
    apply: (next) => replaceChar(next),
    levelUp: ({ fromXp } = {}) => levelUp({ fromXp }),
    levelDown: () => levelDownDialog(),
  });
}

function shortRestDialog() {
  const s = S.sheet;
  const c = S.char;
  const spend = Object.fromEntries(s.hitDice.map((hd) => [hd.die, 0]));
  const con = s.abilities.con.mod;
  const healIn = h('input', { class: 'input', type: 'number', min: 0, value: '', placeholder: 'average', inputmode: 'numeric' });
  const rows = h('div', { class: 'stack stack-sm' });
  const draw = () => {
    mount(rows, s.hitDice.map((hd) => {
      const left = hd.total - hd.used;
      return h('div', { class: 'row' },
        h('span', { class: 'num ch-die' }, `d${hd.die}`),
        h('span', { class: 'muted ui text-sm' }, `${left} left`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: !spend[hd.die], 'aria-label': 'Spend one fewer', onclick: () => { spend[hd.die] -= 1; draw(); } }, icon('minus')),
        h('span', { class: 'num' }, `Spend ${spend[hd.die]}`),
        h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: spend[hd.die] >= left, 'aria-label': 'Spend one more', onclick: () => { spend[hd.die] += 1; draw(); } }, icon('plus')));
    }));
  };
  draw();
  const roll = () => {
    let total = 0;
    const parts = [];
    for (const [die, n] of Object.entries(spend)) for (let i = 0; i < n; i++) { const r = rollDie(die); parts.push(r); total += Math.max(0, r + con); }
    healIn.value = String(total);
    toast(parts.length ? `Rolled ${parts.join(', ')} ${con ? `(${fmt(con)} each)` : ''} = ${total} HP` : 'Choose Hit Dice to spend first.');
  };
  openModal({
    title: 'Short rest',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Spend Hit Dice to heal (each die + CON modifier). Roll, type your own total, or leave it blank to take the average. Pact slots and short-rest features recharge.'),
      s.hitDice.length ? rows : h('p', { class: 'faint' }, 'No Hit Dice.'),
      h('div', { class: 'row' }, field('HP regained', healIn), h('button', { class: 'btn', type: 'button', onclick: roll }, icon('d20'), 'Roll'))),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Take short rest', kind: 'primary',
        onClick: () => {
          const hitDiceSpent = Object.fromEntries(Object.entries(spend).filter(([, n]) => n > 0));
          // An empty/zero field lets the engine heal the dice's average + CON.
          const healed = Number(healIn.value) > 0 ? Number(healIn.value) : undefined;
          const before = Number(c.hp.current ?? s.hpMax);
          const next = shortRest(c, { hitDiceSpent, healed });
          replaceChar(next);
          const gained = Number(next.hp.current ?? s.hpMax) - before;
          toast(`Short rest taken${gained > 0 ? `: +${gained} HP` : ''}.`, { type: 'success' });
        },
      },
    ],
  });
}

async function longRestDialog() {
  if (!(await confirmDialog('Regain all Hit Points and spell slots, recover half your Hit Dice, reset long-rest features and reduce Exhaustion by 1?', { title: 'Long rest', okLabel: 'Take long rest' }))) return;
  replaceChar(longRest(S.char));
  toast('Long rest taken. The wardens keep watch.', { type: 'success' });
}
