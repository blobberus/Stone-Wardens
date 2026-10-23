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
import { spellStats, spellIssues, addSpellIssues, rollDice, shortCastingTime, shortRange, spellFxKeys, spellPasses, spellFilterOptions } from './engine-spells.js';
import { adjustedValue as adjValue } from './widgets.js';
import { choiceDialog as choiceDlg } from '../../core/ui.js';
import { isBonusActionSpell, bonusActionFeatures, featureHealing, offhandAttacks } from './engine-actions.js';
import { entryFit, spellFit } from './engine-prof.js';
import { TAGS, tagFeatures, customAbilityRecords, advantageSources, attacksPerAction } from './engine-tags.js';
import { levelUpPlan as luPlan } from './bridge.js';
import { xpStatus } from './engine-xp.js';
import { lastLeveledClass } from './engine-xp.js';
// Debuffed values, highlight color and proficiency marks (abilities / skills / combat / attacks / nav)
import { adjustedValue, accentAttrs, profMark } from './widgets.js';
import { applySkin } from './skin.js';
import { getSetting, setSetting } from '../../core/settings.js';
// Favorites (stars on items, weapons, skills, features, spells; the Favorites tab)
import { featureFavKey, spellFavKey, isFavorite, toggleFavorite, favoritesFirst, dropSpellFavorite } from './engine-favs.js';
import { abilityName } from './data.js';

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
  // A link into a folded region (HP controls, trackers, proficiencies) opens it for this session, then is followed.
  const fold = el.closest('[data-fold]');
  if (fold && !isOpen(fold.dataset.fold)) { FORCED.add(fold.dataset.fold); render(); requestAnimationFrame(() => focusSection(sec)); return; }
  // Inside the actions window: open its tab first; a whole tab scrolls the window (not its inner panel) into view.
  const panel = el.closest('[role="tabpanel"]');
  if (panel?.hidden) selectTab(panel.dataset.tab);
  if (panel && el.parentElement === panel) el = panel.closest('.ch-tabs') || el;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ block: el.classList.contains('ch-tabs') ? 'start' : 'center', behavior: 'smooth' });
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
  // The character's own colors, edges and fonts (skin.js) on the view; index.js clears them when it leaves the sheet.
  if (S.root.dataset.mode === 'sheet') applySkin(S.root.closest('.view') || S.root, c.style);
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
    // Compact D&D Beyond proportions: ability row, combat strip (HP on the right), then a narrow column
    // (skills, senses, collapsible proficiencies) | the wide column: actions window (Attacks · Spells · Bonus actions),
    // resources, inventory, currency and the compact features & traits (filling the space beside the skills);
    // then details, notes. Ability scores with the hit dice & conditions panel (shown by default) to their right.
    h('div', { class: 'ch-abil-row' }, h('div', { class: 'ch-abil-row-grid' }, abilities(c, s), trackers(c, s))),
    h('div', { class: 'ch-body' }, h('div', { class: 'ch-body-grid' },
      h('div', { class: 'ch-col ch-col-l' }, skills(c, s), passive(s), proficiencies(c, s)),
      h('div', { class: 'ch-col ch-col-r' }, actionTabs(c, s), resources(c, s), inventory(c, s), currency(c), features(c, s)))),
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
  // First row: identity (portrait, name, line, XP, one compact action row) | Hit points | Death saves |
  // AC · Initiative · Speed · Proficiency (one line when wide, 2 × 2 when tighter).
  // The hit dice & conditions panel sits beside the ability scores (trackers()).
  return h('header', { class: 'ch-head' }, h('div', { class: 'ch-head-grid' },
    h('div', { class: 'ch-head-id' },
      portrait(c, { size: 'md' }),
      h('div', { class: 'ch-head-text' },
        h('h1', { class: 'ch-name' }, c.name || 'Unnamed'),
        h('p', { class: 'ch-line' }, [lvl ? `Level ${lvl}` : 'Level 0', [species, sub ? `(${sub})` : ''].filter(Boolean).join(' '), s.classLine, bg].filter(Boolean).join(' · ')),
        meta ? h('p', { class: 'ch-meta ui' }, meta) : null,
        h('div', { class: 'ch-xp-row' }, xpMeter(c, { onOpen: () => xpWindow(), onAdd: () => xpWindow('amount') })),
        h('div', { class: 'ch-head-actions' },
          h('button', {
            class: ['btn', 'btn-sm', due || !lvl ? 'btn-primary' : null, due && 'ch-lu-due'], type: 'button', onclick: () => levelUp(), disabled: lvl >= 20, 'data-fk': 'lvl-up',
            title: lvl >= 20 ? 'Already level 20' : due ? `Your XP has reached level ${lvl + due}` : lvl ? 'Gain a level now (milestone — ignores XP)' : 'Choose a first class',
          }, icon('level-up'), !lvl ? 'Choose a class' : due ? (due > 1 ? `Level up · ${due} due` : 'Level up available') : 'Level up'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: shortRestDialog, title: 'Spend Hit Dice; recharge short-rest features' }, icon('clock'), 'Short rest'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: longRestDialog, title: 'Regain HP, slots and features' }, icon('moon'), 'Long rest'),
          h('a', { class: 'btn btn-sm', href: editHref(), title: 'Edit every field, choice and override' }, icon('edit'), 'Edit all'),
          lvl ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => levelDownDialog(), title: 'Remove the most recent level (confirms first)', 'data-fk': 'lvl-down', 'aria-label': 'Level down' }, h('span', { class: 'ch-flip' }, icon('level-up')), h('span', { class: 'ch-act-lbl' }, 'Level down')) : null,
          h('button', {
            class: 'btn-icon btn-sm', type: 'button', title: 'Copy a [[char:…]] link', 'aria-label': 'Copy link',
            onclick: async () => { const t = `[[char:${c.name || c.id}]]`; try { await navigator.clipboard.writeText(t); toast(`Copied ${t}`); } catch { toast(t); } },
          }, icon('link'))))),
    h('div', { class: 'ch-hp-col' }, hpWidget(c, s), trackersToggle()),
    deathSaves(c, s),
    statGrid(s)));
}

// Sticky section bar; once the name in the header scrolls away, "Name · Player" fills its empty right side.
const NAV = { io: null, stuck: false, id: null };

function nav(s) {
  const c = S.char;
  if (NAV.id !== S.id) { NAV.id = S.id; NAV.stuck = false; }
  const items = [['abilities', 'Abilities'], ['skills', 'Skills'], ['passive', 'Senses'], ['attacks', 'Attacks'],
    (s.spellcasting.length || c.spells.length) ? ['spells', 'Spells'] : null, ['bonus-actions', 'Bonus'], ['inventory', 'Inventory'],
    ['features', 'Features'], ['details', 'Details'], ['notes', 'Notes']].filter(Boolean);
  const el = h('nav', { class: ['ch-nav', NAV.stuck && 'is-stuck'], 'aria-label': 'Sheet sections' },
    h('a', { class: 'btn-icon btn-sm ch-nav-back', href: href(VIEW), title: 'All characters', 'aria-label': 'All characters' }, icon('chevron-left')),
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

// ---------- header widgets: HP, stats 2 × 2, trackers ----------

// Folding regions remember open/closed per device (settings); a deep link opens a folded region for this session only.
const FOLD_KEYS = { hp: 'chHpOpen', trackers: 'chTrackersShown', profs: 'chProfsOpen' };
const FORCED = new Set();
const isOpen = (key) => FORCED.has(key) || !!getSetting(key);
function toggleFold(key) {
  const next = !isOpen(key);
  FORCED.delete(key);
  setSetting(key, next);
  render();
}

/** Vision for the header: other senses (blindsight, truesight…) or "Normal", and the best darkvision range or null. */
function visionOf(s) {
  const list = s.sensesList || [];
  const ranges = list.map((x) => /darkvision\D*(\d+)/i.exec(x)).filter(Boolean).map((m) => Number(m[1]));
  const dark = Math.max(Number(s.darkvision) || 0, ...ranges, 0) || null;
  const other = list.filter((x) => !/darkvision/i.test(x)).map((x) => x.replace(/\.$/, ''));
  return { dark, vision: other.length ? other.join(', ') : 'Normal' };
}

/**
 * AC · Initiative · Speed · Proficiency at the right end of the first row (one line when wide, else 2 × 2), with
 * Vision under Speed and Darkvision under Proficiency: slim cells in room the header already has (characters.css),
 * so the header never grows for them.
 */
function statGrid(s) {
  const speedSub = Object.entries(s.speed).filter(([k, v]) => k !== 'walk' && v).map(([k, v]) => `${prettify(k)} ${v}`).join(' · ');
  const v = visionOf(s);
  // the label gives way to its icon when the cell is narrow (characters.css: each cell is its own container)
  const visCell = (cls, ic, label, value, title) => h('div', { class: ['ch-vis', cls], title, 'aria-label': `${label}: ${value}`, role: 'note' },
    h('span', { class: 'ch-vis-in', 'aria-hidden': 'true' }, icon(ic), h('span', { class: 'ch-vis-label' }, label), h('span', { class: 'ch-vis-value' }, value)));
  return h('div', { class: 'ch-stats', 'data-sec': 'combat' },
    statBox({ label: 'Armor Class', value: adjustedValue(s, 'ac', String(s.ac.value)), sub: s.armorWorn?.name || (s.shield ? 'Shield' : 'Unarmored'), stat: 'ac', title: s.adjust?.ac ? null : s.ac.formula, onClick: () => acInfo(s) }),
    statBox({ label: 'Initiative', value: adjustedValue(s, 'initiative', fmt(s.initiative)), stat: 'initiative', title: s.adjust?.initiative ? null : 'Roll initiative', onClick: () => rollToast('Initiative', s.initiative) }),
    statBox({ label: 'Speed', value: adjustedValue(s, 'speed', `${s.speed.walk ?? 0} ft`), sub: speedSub || null, stat: 'speed', title: speedSub && !s.adjust?.speed ? `Walk ${s.speed.walk ?? 0} ft · ${speedSub}` : null }),
    statBox({ label: 'Proficiency', value: adjustedValue(s, 'profBonus', fmt(s.profBonus)), stat: 'prof' }),
    visCell('ch-vis-sight', 'eye', 'Vision', v.vision, v.vision === 'Normal' ? 'Vision: normal sight, no special senses' : `Vision: ${v.vision}`),
    visCell('ch-vis-dark', 'moon', 'Darkvision', v.dark ? `${v.dark} ft` : 'None',
      v.dark ? `Darkvision ${v.dark} ft: dim light within range counts as bright light, darkness as dim light (shades of gray)` : 'Darkvision: none'));
}

/** The Hide / Show trackers button under the HP widget (toggles the hit dice & conditions panel). */
function trackersToggle() {
  const shown = isOpen(FOLD_KEYS.trackers);
  return h('button', {
    class: 'btn btn-sm ch-trk-toggle', type: 'button', 'aria-expanded': String(shown), 'aria-controls': 'ch-sec-trackers', 'data-fk': 'trk-toggle',
    title: shown ? 'Hide the hit dice & conditions panel (the Hit points box then shows anything active)' : 'Show hit dice, death saves, inspiration, exhaustion and conditions',
    onclick: () => toggleFold(FOLD_KEYS.trackers),
  }, icon('layers'), shown ? 'Hide trackers' : 'Show trackers');
}

/**
 * Hit points: folded = current / max, temp and the bar; open = + Current / Temp / Damage taken inputs and
 * Amount → Damage / Heal. While the trackers panel is hidden, chips for anything active show here instead.
 */
function hpWidget(c, s) {
  const open = isOpen(FOLD_KEYS.hp);
  const trk = isOpen(FOLD_KEYS.trackers);
  const max = s.hpMax;
  const cur = c.hp.current == null ? max : Number(c.hp.current);
  const temp = Number(c.hp.temp) || 0;
  const down = max > 0 && cur <= 0;
  const ex = Number(c.exhaustion) || 0;
  const conds = conditionList();
  const amount = h('input', { class: 'input input-sm ch-hp-amt', type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Amount', 'aria-label': 'Damage or healing amount', 'data-fk': 'hp-amt' });
  const doDamage = () => { const n = Math.max(0, Number(amount.value) || 0); if (!n) return; mutate((x) => applyDamage(x, n, max)); };
  const doHeal = () => { const n = Math.max(0, Number(amount.value) || 0); if (!n) return; mutate((x) => applyHeal(x, n, max)); };
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? doHeal() : doDamage(); } });
  const active = trk ? [] : [
    ...c.conditions.map((id) => chip(conds.find((x) => x.id === id)?.name || prettify(id), { className: 'ch-cond', title: 'Active condition', onRemove: () => mutate((x) => { x.conditions = x.conditions.filter((y) => y !== id); }) })),
    ex ? h('button', { class: 'chip ch-cond', type: 'button', title: `−${ex * 2} to D20 Tests, −${ex * 5} ft Speed (click to show the trackers)`, onclick: () => toggleFold(FOLD_KEYS.trackers) }, `Exhaustion ${ex}`) : null,
    c.heroicInspiration ? h('button', { class: 'chip ch-insp-chip', type: 'button', title: 'Heroic Inspiration (click to spend)', onclick: () => mutate((x) => { x.heroicInspiration = false; }) }, icon('star'), 'Inspired') : null,
  ].filter(Boolean);
  return h('div', { class: ['ch-hp', open && 'is-open', down && 'is-down'], 'data-sec': 'hp', 'data-fold': FOLD_KEYS.hp },
    h('div', { class: 'ch-hp-top' },
      h('button', {
        class: 'ch-fold', type: 'button', 'aria-expanded': String(open), 'aria-controls': 'ch-hp-edit', 'data-fk': 'hp-fold',
        title: open ? 'Hide the HP controls' : 'Change hit points', onclick: () => toggleFold(FOLD_KEYS.hp),
      }, icon(open ? 'chevron-down' : 'chevron-right'), h('span', { class: 'ch-stat-label' }, icon('heart'), 'Hit points')),
      h('span', { class: 'ch-hp-now num', title: s.adjust?.hpMax ? null : 'Current + temporary' }, String(cur + temp), h('span', { class: 'ch-hp-max' }, ' / ', adjustedValue(s, 'hpMax', String(max))))),
    hpBar(cur, max, temp),
    temp ? h('div', { class: 'ch-hp-temp ui text-xs' }, `includes ${temp} temporary`) : null,
    h('div', { class: 'ch-hp-edit', id: 'ch-hp-edit', hidden: !open },
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
    active.length ? h('div', { class: 'ch-hp-foot' }, active) : null);
}

/** Death saves: a small box between Hit points and AC; it turns red at 0 HP. */
function deathSaves(c, s) {
  const max = s.hpMax;
  const cur = c.hp.current == null ? max : Number(c.hp.current);
  const down = max > 0 && cur <= 0;
  return h('div', { class: ['ch-dsbox', down && 'is-down'], 'data-sec': 'death-saves', role: 'group', 'aria-label': 'Death saving throws' },
    h('span', { class: 'ch-stat-label' }, 'Death saves'),
    h('span', { class: 'ch-ds-mini' },
      h('span', { class: 'ch-ds-letter', title: 'Successes' }, 'S'), deathBoxes('success', c.deathSaves.success),
      h('span', { class: 'ch-ds-letter', title: 'Failures' }, 'F'), deathBoxes('fail', c.deathSaves.fail)));
}

/**
 * Hit dice, heroic inspiration, exhaustion, conditions: one compact line in a panel beside the ability scores
 * (below them when the row is narrow). Shown by default; the button under the HP widget hides it.
 */
function trackers(c, s) {
  const open = isOpen(FOLD_KEYS.trackers);
  const ex = Number(c.exhaustion) || 0;
  const conds = conditionList().filter((x) => x.id !== 'exhaustion');
  const exText = ex ? `Exhaustion ${ex}: −${ex * 2} to D20 Tests, −${ex * 5} ft Speed${ex >= 6 ? ' (death)' : ''}` : 'No Exhaustion';
  const group = (label, attrs, ...ctl) => h('div', { class: 'ch-trk', ...attrs }, h('span', { class: 'ch-trk-label' }, label), h('div', { class: 'ch-trk-ctl' }, ctl));
  return section('trackers', 'Hit dice & conditions', { iconName: 'layers', className: 'ch-sec-trackers', attrs: { 'data-fold': FOLD_KEYS.trackers, hidden: !open } },
  h('div', { class: 'ch-trk-line' },
    group('Hit dice', { 'data-stat': 'hit-dice' },
      s.hitDice.length ? s.hitDice.map((hd) => h('span', { class: 'ch-trk-hd', title: `${hd.total - hd.used} of ${hd.total} d${hd.die} left` },
        h('span', { class: 'num ch-die' }, `d${hd.die}`),
        hd.total <= 12
          ? pips({ max: hd.total, used: hd.used, label: `d${hd.die} hit dice`, fk: `hd${hd.die}`, onChange: (u) => mutate((x) => { x.hitDiceUsed[hd.die] = u; }) })
          : numberInput(hd.used, (v) => mutate((x) => { x.hitDiceUsed[hd.die] = Math.max(0, Math.min(hd.total, v || 0)); }), { class: 'input input-sm ch-w-num', min: 0, max: hd.total, 'aria-label': `d${hd.die} hit dice used` }),
        h('span', { class: 'num ch-trk-n' }, `${hd.total - hd.used}/${hd.total}`))) : h('span', { class: 'faint ui text-sm' }, '—')),
    group('Inspiration', { 'data-stat': 'inspiration' },
      h('button', {
        class: ['btn-icon', 'ch-insp', c.heroicInspiration && 'is-active'], type: 'button', 'aria-pressed': String(!!c.heroicInspiration), 'data-fk': 'insp',
        title: c.heroicInspiration ? 'Heroic Inspiration: you have it (click to spend)' : 'Heroic Inspiration: none (click to gain)', 'aria-label': 'Heroic Inspiration',
        onclick: () => mutate((x) => { x.heroicInspiration = !x.heroicInspiration; }),
      }, icon('star'))),
    group('Exhaustion', { 'data-stat': 'exhaustion', title: exText },
      pips({ max: 6, used: ex, kind: 'mark', label: 'Exhaustion level', fk: 'exh', onChange: (u) => mutate((x) => { x.exhaustion = u; }) }),
      h('span', { class: ['num', 'ch-trk-n', ex && 'danger-text'] }, String(ex))),
    group('Conditions', { 'data-stat': 'conditions', class: 'ch-trk ch-trk-conds' },
      c.conditions.map((id) => {
        const info = conds.find((x) => x.id === id);
        return chip(info?.name || prettify(id), { title: info ? info.description.slice(0, 300) : null, className: 'ch-cond', onRemove: () => mutate((x) => { x.conditions = x.conditions.filter((y) => y !== id); }) });
      }),
      select([{ value: '', label: '+' }, ...conds.filter((x) => !c.conditions.includes(x.id)).map((x) => ({ value: x.id, label: x.name }))], '',
        (v) => v && mutate((x) => { x.conditions = [...x.conditions, v]; }), { class: 'select input-sm ch-cond-plus', 'aria-label': 'Add a condition', title: 'Add a condition', 'data-fk': 'cond-add' }))));
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
      h('button', { class: 'ch-abil-check', type: 'button', onclick: () => rollToast(`${a.full} check`, check) },
        h('span', { class: 'ch-abil-name' }, h('span', { class: 'sr-only' }, 'Roll '),
          h('span', { class: 'ch-ab-full' }, a.full), h('span', { class: 'ch-ab-short', 'aria-hidden': 'true' }, a.name), h('span', { class: 'sr-only' }, ' check, score below')),
        adjustedValue(s, `ability:${a.id}`, fmt(check), { className: 'ch-abil-mod' }),
        adjustedValue(s, `score:${a.id}`, String(x.score), { className: 'ch-abil-score' })),
      h('button', { class: 'ch-abil-save', type: 'button', onclick: () => rollToast(`${a.full} save`, x.save) },
        h('span', { class: 'sr-only' }, `Roll ${a.full} saving throw: `),
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

// ---------- favorites: a star in each entry's own menu, a star in its row, listed first, the Favorites tab ----------

/** Ids starred for one kind ('items' | 'skills' | 'features') as a Set. */
const favSet = (c, kind) => new Set(c.favorites?.[kind] || []);

/** The small filled gold star shown before a favorite's name in its row. */
const favMark = () => h('span', { class: 'ch-fav-mark', title: 'Favorite', 'aria-label': 'Favorite', role: 'img' }, icon('star'));

/** "Favorite" toggle for an entry's own menu (modal or expanded row): saves at once and repaints itself. */
function favButton(kind, key, what) {
  const btn = h('button', { class: 'btn btn-sm ch-fav-btn', type: 'button', 'data-fk': `fav-${kind}-${key}` });
  const paint = () => {
    const on = isFavorite(S.char, kind, key);
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? `Remove ${what} from your favorites` : `Star ${what}: it is listed first and in the Favorites tab`;
    mount(btn, icon('star'), on ? 'Favorite' : 'Add to favorites');
  };
  btn.addEventListener('click', () => { mutate((x) => { toggleFavorite(x, kind, key); }); paint(); });
  paint();
  return btn;
}

/** Row for the top of an entry modal holding its Favorite toggle. */
const favRow = (kind, key, what) => h('div', { class: 'ch-fav-row' }, favButton(kind, key, what));

/** A skill's own menu: what it covers, the numbers, roll, and the Favorite toggle. */
function skillModal(sk) {
  const s = S.sheet;
  const x = s.skills[sk.id];
  if (!x) return;
  const lvl = x.expertise ? 'expertise' : x.prof ? 'proficient' : x.half ? 'half' : 'none';
  const desc = sk.description || skillList().find((k) => k.id === sk.id)?.description || '';
  openModal({
    title: sk.name,
    body: h('div', { class: 'stack ch-skill-info' },
      favRow('skills', sk.id, sk.name),
      h('dl', { class: 'ch-dl' },
        h('dt', null, 'Ability'), h('dd', null, abilityName(x.ability || sk.ability)),
        h('dt', null, 'Proficiency'), h('dd', null, profMark(lvl), ' ', profTitle(lvl, s.proficiencyInfo?.skills?.[sk.id])),
        h('dt', null, 'Bonus'), h('dd', { class: 'num' }, adjustedValue(s, `skill:${sk.id}`, fmt(x.bonus)))),
      desc ? md(desc) : null,
      h('p', { class: 'muted ui text-sm' }, h('a', { href: editHref('proficiencies') }, 'Change proficiency or expertise'), ' in Edit all.')),
    actions: [{ label: 'Close', kind: 'ghost' }, { label: `Roll ${sk.name}`, kind: 'primary', onClick: () => rollToast(sk.name, x.bonus) }],
  });
}

// Compact skill list (D&D Beyond sizing): mark · ability · name · bonus box. "Proficient only" folds it (per device).
// The name opens the skill's menu (Favorite toggle); favorites are listed first and stay when folded.
function skills(c, s) {
  const info = s.proficiencyInfo?.skills || {};
  const level = (x) => (x.expertise ? 'expertise' : x.prof ? 'proficient' : x.half ? 'half' : 'none');
  const favs = favSet(c, 'skills');
  const all = favoritesFirst(skillList().map((sk) => ({ sk, x: s.skills[sk.id] })), ({ sk }) => favs.has(sk.id));
  const folded = !!getSetting('chSkillsFolded') && all.some(({ x }) => x.prof || x.expertise);
  const rows = folded ? all.filter(({ sk, x }) => x.prof || x.expertise || favs.has(sk.id)) : all;
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
  h('ul', { class: 'ch-skl', role: 'list', 'aria-label': 'Skills' }, rows.map(({ sk, x }) => h('li', { class: ['ch-skl-row', x.prof && 'is-prof', favs.has(sk.id) && 'is-fav'], 'data-stat': sk.id },
    profMark(level(x), { title: profTitle(level(x), info[sk.id]) }),
    h('span', { class: 'ch-skl-ab ui' }, String(x.ability || sk.ability).toUpperCase()),
    h('button', { class: 'ch-skl-name', type: 'button', title: `${sk.name}: details and Favorite`, 'data-fk': `skl-${sk.id}`, onclick: () => skillModal(sk) },
      favs.has(sk.id) ? favMark() : null, sk.name),
    h('button', { class: 'ch-skl-bonus', type: 'button', onclick: () => rollToast(sk.name, x.bonus) }, h('span', { class: 'sr-only' }, `Roll ${sk.name} `), adjustedValue(s, `skill:${sk.id}`, fmt(x.bonus)))))),
  h('p', { class: 'ch-plegend ui text-xs' },
    h('span', null, profMark('proficient'), 'Proficient'), h('span', null, profMark('expertise'), 'Expertise'),
    all.some(({ x }) => x.half) ? h('span', null, profMark('half'), 'Half') : null,
    folded ? h('span', null, `${all.length - rows.length} more hidden`) : null));
}

// Proficiencies & languages: dense text rows; folds to its header (per device, folded by default) with a count summary.
function proficiencies(c, s) {
  const open = isOpen(FOLD_KEYS.profs);
  const names = (items, kind) => [...new Set(items || [])].map((id) => profName(kind, id));
  const res = [...new Set([...(s.resistances || [])])].map((r) => prettify(typeof r === 'object' ? r.type || r.id : r));
  const rows = [['Armor', names(s.proficiencies.armor, 'armor')], ['Weapons', names(s.proficiencies.weapons, 'weapons')],
    ['Tools', names(s.proficiencies.tools, 'tools')], ['Languages', names(s.languages, 'languages')]];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const summary = [count(rows[0][1].length, 'armor', 'armor'), count(rows[1][1].length, 'weapon', 'weapons'), count(rows[2][1].length, 'tool', 'tools'), count(rows[3][1].length, 'language', 'languages')].join(' · ');
  const toggle = () => toggleFold(FOLD_KEYS.profs);
  return section('proficiencies', h('button', { class: 'ch-fold', type: 'button', 'aria-expanded': String(open), 'aria-controls': 'ch-profs-body', 'data-fk': 'profs-fold', onclick: toggle },
    icon(open ? 'chevron-down' : 'chevron-right'), 'Proficiencies & languages'), {
    className: ['ch-sec-profs', !open && 'is-folded'].filter(Boolean).join(' '), sub: open ? null : summary, attrs: { 'data-fold': FOLD_KEYS.profs },
    actions: [h('a', { class: 'btn-icon btn-sm', href: editHref('proficiencies'), title: 'Edit proficiencies', 'aria-label': 'Edit proficiencies' }, icon('edit'))],
  },
  h('dl', { class: 'ch-dl ch-profs', id: 'ch-profs-body' },
    rows.map(([label, list]) => [h('dt', null, label), h('dd', null, list.length ? list.join(', ') : h('span', { class: 'faint' }, 'None'))]),
    h('dt', null, 'Resistances'), h('dd', { 'data-stat': 'resistances' },
      res.length ? res.join(', ') : null, c.details.resistances ? md(c.details.resistances) : res.length ? null : h('span', { class: 'faint' }, 'None'))));
}

// ---------- actions window: Attacks | Spells | Bonus actions (D&D Beyond style), switched in place ----------

const TABS = new Map(); // character id -> last open tab (this session)

function actionTabs(c, s) {
  const list = [['favorites', [h('span', { class: 'ch-tab-star', 'aria-hidden': 'true' }, icon('star')), h('span', { class: 'ch-tab-label' }, 'Favorites')], favoritesTab(c, s)],
    ['attacks', 'Attacks', attacks(c, s)], ['spells', 'Spells', spells(c, s)], ['bonus-actions', 'Bonus actions', bonusActions(c, s)]].filter(([, , el]) => el);
  let cur = TABS.get(S.id);
  if (!list.some(([id]) => id === cur)) cur = list[0][0];
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const onKey = (e) => {
    const i = list.findIndex(([id]) => id === e.currentTarget.dataset.tab);
    const j = e.key in keys ? (i + keys[e.key] + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (j == null) return;
    e.preventDefault();
    selectTab(list[j][0], { focus: true });
  };
  return h('div', { class: 'panel ch-tabs', 'data-sec': 'actions' },
    h('div', { class: 'ch-tabs-bar', role: 'tablist', 'aria-label': 'Actions' }, list.map(([id, label]) => h('button', {
      class: ['ch-tab', id === cur && 'is-active'], type: 'button', role: 'tab', id: `ch-tab-${id}`, 'aria-controls': `ch-tabp-${id}`,
      'aria-selected': String(id === cur), tabindex: id === cur ? '0' : '-1', 'data-tab': id, 'data-fk': `tab-${id}`,
      onclick: () => selectTab(id), onkeydown: onKey,
    }, label))),
    list.map(([id, , el]) => h('div', { class: 'ch-tabs-panel', role: 'tabpanel', id: `ch-tabp-${id}`, 'aria-labelledby': `ch-tab-${id}`, 'data-tab': id, hidden: id !== cur }, el)));
}

/** Show a tab of the actions window without re-rendering (remembered per character). */
function selectTab(id, { focus = false } = {}) {
  TABS.set(S.id, id);
  const win = S.root?.querySelector('.ch-tabs');
  if (!win) return;
  win.querySelectorAll('[role="tab"]').forEach((t) => {
    const on = t.dataset.tab === id;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  win.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = p.dataset.tab !== id; });
}

/** "+5 to hit" and "1d8+3 Slashing" roll chips for an attack row. */
function attackChips(a, label) {
  return [
    h('button', { class: 'ch-spell-chip ch-spell-hit', type: 'button', title: `Roll to hit with ${label}`, onclick: () => rollToast(`${label} to hit`, a.bonus) }, h('span', { class: 'num' }, fmt(a.bonus)), h('span', { class: 'ch-spell-chip-label' }, 'to hit')),
    a.damage ? h('button', { class: 'ch-spell-chip ch-spell-dmg', type: 'button', title: 'Roll damage', onclick: () => rollPlain(label, a.damage, a.damageType) }, h('span', { class: 'num' }, `${a.damage} ${prettify(a.damageType || '')}`.trim())) : null];
}

/**
 * Favorites tab: starred weapons (equipped ones roll from here), spells (the Spells tab's rows, by level, so their
 * to-hit and damage / healing chips roll here too), skills, other items and features, in the order they were starred.
 * Null (no tab) while nothing starred still exists on the sheet.
 */
function favoritesTab(c, s) {
  const fav = c.favorites || {};
  const items = (fav.items || []).map((uid) => c.inventory.find((i) => i.uid === uid)).filter(Boolean);
  const atkByUid = new Map(s.attacks.filter((a) => a.uid).map((a) => [a.uid, a]));
  const weapons = items.filter((it) => atkByUid.has(it.uid));
  const others = items.filter((it) => !atkByUid.has(it.uid));
  const skillsList = (fav.skills || []).map((id) => skillList().find((k) => k.id === id)).filter((sk) => sk && s.skills[sk.id]);
  const featByKey = new Map(s.features.map((f) => [featureFavKey(f), f]));
  const feats = (fav.features || []).map((k) => featByKey.get(k)).filter(Boolean);
  const spellList = (fav.spells || []).length ? spellRows(c, s).filter((r) => r.fav) : [];
  if (!weapons.length && !spellList.length && !others.length && !skillsList.length && !feats.length) return null;
  const spellLevels = [...new Set(spellList.map((r) => r.level))].sort((a, b) => a - b);
  const spellFrom = new Set(spellList.map((r) => r.from)).size > 1;
  const resByKey = new Map(s.resources.map((r) => [r.key, r]));
  const resOf = (f) => (f.uses && typeof f.uses === 'object' && f.uses.key && resByKey.get(f.uses.key)) || (typeof f.uses === 'string' && resByKey.get(f.uses)) || resByKey.get(f.id) || null;
  const itemName = (it) => {
    const e = findEntry(it.kind, it.ref);
    return e ? h('button', { class: 'ch-link-btn ch-ba-name', type: 'button', onclick: () => entryInfo(e, { item: it }) }, it.name || e.name)
      : h('button', { class: 'ch-link-btn ch-ba-name', type: 'button', onclick: () => editItem(it) }, it.name || prettify(it.ref));
  };
  const group = (title, sub, list) => h('div', { class: 'ch-ba-group ch-fav-group' },
    h('h4', { class: 'ch-mini-head ch-spell-lvl-head' }, title, sub ? h('span', { class: 'ch-spell-lvl-sub' }, sub) : null), list);
  return section('favorites', 'Favorites', { iconName: 'star', className: 'ch-sec-favs', sub: 'Star an entry in its own menu to keep it here.' },
    weapons.length ? group('Weapons', 'equipped', h('ul', { class: 'ch-ba-list', role: 'list' }, weapons.map((it) => {
      const a = atkByUid.get(it.uid);
      return h('li', { class: 'ch-ba ch-ba-row', 'data-stat': `fav-${it.uid}` }, itemName(it), h('span', { class: 'ch-ba-chips' }, attackChips(a, a.name)));
    }))) : null,
    spellList.length ? group('Spells', null, h('div', { class: 'ch-spell-levels ch-fav-spells' }, spellLevels.map((lvl) => h('div', { class: 'ch-spell-level' },
      spellHead(lvl === 0 ? 'Cantrips' : `Level ${lvl}`, slotText(lvl, c, s)),
      h('ul', { class: 'ch-spell-list', role: 'list' }, spellList.filter((r) => r.level === lvl).sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => spellItem(r, s, { from: spellFrom, fk: '-fav', stat: `fav-spell-${r.favKey}` }))))))) : null,
    skillsList.length ? group('Skills', 'click to roll', h('div', { class: 'ch-fav-skills' }, skillsList.map((sk) => {
      const x = s.skills[sk.id];
      return h('button', { class: ['ch-spell-chip', 'ch-fav-skill', (x.prof || x.expertise) && 'is-prof'], type: 'button', title: `Roll ${sk.name}`, 'data-fk': `fav-roll-${sk.id}`, onclick: () => rollToast(sk.name, x.bonus) },
        h('span', null, sk.name), h('span', { class: 'num' }, fmt(x.bonus)));
    }))) : null,
    others.length ? group('Items', null, h('ul', { class: 'ch-ba-list', role: 'list' }, others.map((it) => h('li', { class: 'ch-ba ch-ba-row', 'data-stat': `fav-${it.uid}` },
      h('span', { class: 'ch-ba-name' }, itemName(it), Number(it.qty) !== 1 ? h('span', { class: 'ch-inv-kind' }, `× ${it.qty}`) : null),
      h('span', { class: 'ch-ba-chips' },
        it.kind === 'weapon' && !it.equipped ? h('span', { class: 'badge', title: 'Tick Equipped in the inventory to roll its attack here' }, 'not equipped') : null,
        it.equipped && it.kind !== 'weapon' ? h('span', { class: 'badge' }, 'equipped') : null,
        it.attuned ? h('span', { class: 'badge badge-accent' }, 'attuned') : null,
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Edit ${it.name}`, title: 'Edit', onclick: () => editItem(it) }, icon('edit'))))))) : null,
    feats.length ? group('Features & traits', null, h('ul', { class: 'ch-ba-list', role: 'list' }, feats.map((f) => {
      const res = resOf(f);
      return h('li', { class: 'ch-ba ch-ba-row', 'data-stat': `fav-${f.id || f.name}` },
        h('span', { class: 'ch-ba-name' }, h('button', { class: 'ch-link-btn', type: 'button', onclick: () => featureModal(f) }, f.name), f.source ? h('span', { class: 'badge' }, f.source) : null),
        res ? h('span', { class: 'ch-ba-chips' }, resourcePips(res, false, '-fav')) : null);
    }))) : null);
}

// ---------- attacks ----------

function attacks(c, s) {
  const favs = favSet(c, 'items');
  const rows = favoritesFirst(s.attacks, (a) => a.uid && favs.has(a.uid));
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
        h('td', { class: 'cell-name' }, a.uid && favs.has(a.uid) ? favMark() : null,
          entry ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryInfo(entry, { item }) }, a.name) : a.name,
          a.properties?.length ? h('div', { class: 'ch-props' }, a.properties.map((p, pi) => h('span', { class: 'ch-prop', title: propertyInfo(p)?.description?.slice(0, 300) || null }, a.propertyNames?.[pi] || prettify(p)))) : null),
        h('td', { class: 'num' }, h('button', { class: 'ch-link-btn num ch-bonus', type: 'button', onclick: () => rollToast(`${a.name} to hit`, a.bonus) },
          h('span', { class: 'sr-only' }, `Roll to hit with ${a.name} `), adjustedValue(s, `attack:${a.uid || (a.unarmed ? 'unarmed' : '')}`, typeof a.bonus === 'number' ? fmt(a.bonus) : String(a.bonus ?? '')))),
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
  const favs = favSet(c, 'spells');
  return src.map((x) => {
    const entry = findEntry('spell', x.id);
    const caster = spellCaster(x, s);
    const stored = !x.always && !x.innate && c.spells.some((y) => y.id === x.id && (y.class || null) === (x.class || null));
    // Off-list: stored spells that don't fit the class (not on its list, too high, no spellcasting) — shown, never blocked
    const issues = entry && stored ? spellIssues(entry, caster?.sc || null, { className: x.class ? entryName('class', x.class) : null }) : [];
    const stats = entry ? spellStats(entry, { charLevel: lvl, caster }) : null;
    const level = Number(x.level ?? entry?.level ?? 0);
    const favKey = spellFavKey(x);
    return {
      ...x, entry, name: x.name || entry?.name || prettify(x.id), level, caster, stored, issues, stats,
      keys: entry ? spellFxKeys(entry, stats) : [], ready: !!(x.prepared || x.always || level === 0),
      from: x.class ? entryName('class', x.class) : caster?.label || x.source || '',
      favKey, fav: favs.has(favKey),
    };
  });
}

/** Roll a spell's damage or healing into a toast ("Fire Bolt: 2d10 (3, 7) = 10 Fire"). */
function rollSpellEffect(name, parts, { heal = false, count = null } = {}) {
  const out = [];
  for (const [i, d] of parts.entries()) {
    if (i && d.alt) continue; // "Radiant or Necrotic": one roll
    const r = d.dice ? rollDice({ dice: d.dice, bonus: d.bonus }) : null;
    if (!r) continue;
    out.push(`${out.length ? (d.join === 'then' ? ', then ' : ' + ') : ''}${d.dice}${d.bonus ? ` ${d.bonus < 0 ? '−' : '+'} ${Math.abs(d.bonus)}` : ''} (${r.rolls.join(', ')}) = ${r.total}${heal ? ' HP' : d.typeName ? ` ${d.typeName}` : ''}`);
  }
  if (!out.length) return;
  const weapon = parts.some((d) => d.weapon) ? ' (plus your weapon’s damage)' : '';
  toast(`${name}${heal ? ' heals' : ''}: ${out.join('')}${weapon}${count && count.count > 1 ? ` — each of ${count.count} ${count.unit}s` : ''}`, { type: 'info', timeout: 6000 });
}

/** Chips of one spell row: {hit: to-hit / save DC, effect: damage / healing}. */
function spellChips(r, s, fx = '') {
  const st = r.stats;
  if (!st) return { hit: [], effect: [] };
  const key = r.caster?.key;
  const chips = [];
  const effect = [];
  if (st.attack) {
    const what = st.attack === 'weapon' ? 'weapon attack using your spellcasting ability' : `${st.attack} spell attack`;
    chips.push(st.toHit != null
      ? h('button', { class: 'ch-spell-chip ch-spell-hit', type: 'button', title: `Roll a ${what} with ${r.name}`, onclick: () => rollToast(`${r.name} (${st.attack === 'weapon' ? 'weapon attack' : 'spell attack'})`, st.toHit), 'data-fk': `hit-${r.class || r.group}-${r.id}${fx}` },
        adjValue(s, `spellAttack:${key}`, fmt(st.toHit)), h('span', { class: 'ch-spell-chip-label' }, 'to hit'))
      : h('span', { class: 'ch-spell-chip is-muted', title: 'No spellcasting ability for this spell' }, st.attack === 'weapon' ? 'weapon attack' : `${prettify(st.attack)} spell attack`));
  }
  if (st.save) {
    const ab = (ABILITIES.find((a) => a.id === st.save)?.name || st.save.toUpperCase());
    chips.push(st.dc != null
      ? h('span', { class: 'ch-spell-chip ch-spell-dc', title: `${ABILITIES.find((a) => a.id === st.save)?.full || ab} saving throw` }, h('span', { class: 'ch-spell-chip-label' }, 'DC'), adjValue(s, `spellDc:${key}`, String(st.dc)), ` ${ab}`)
      : h('span', { class: 'ch-spell-chip is-muted' }, `${ab} save`));
  }
  const tip = [spellUpNote(r), st.higherLevel ? `${r.level ? 'Using a higher-level spell slot' : 'Cantrip upgrade'}: ${st.higherLevel}` : '', st.parsed ? '(Read from the spell text.)' : ''].filter(Boolean).join('\n');
  // one chip per effect: Ice Knife "1d10 Piercing" + "2d6 Cold"; Flame Strike "5d6 Fire + 5d6 Radiant"
  (st.damageGroups || []).forEach((g, gi) => {
    const count = gi === 0 && st.count && st.count.count > 1 ? `${st.count.count} × ` : '';
    const rollable = g.parts.some((d) => d.dice);
    const title = [rollable ? 'Roll damage' : 'Damage', (st.damageGroups.length > 1 || g.parts.some((d) => d.weapon)) && g.note ? g.note : '', gi === 0 ? tip : ''].filter(Boolean).join('\n');
    effect.push(h(rollable ? 'button' : 'span', {
      class: ['ch-spell-chip', 'ch-spell-dmg', gi > 0 && 'is-secondary'], type: rollable ? 'button' : null, title,
      onclick: rollable ? () => rollSpellEffect(r.name, g.parts, { count: gi === 0 ? st.count : null }) : null, 'data-fk': `dmg-${r.class || r.group}-${r.id}-${gi}${fx}`,
    }, h('span', { class: 'num' }, `${count}${g.text}`.replace(/\//g, '/​')))); // let "Acid/Cold/…" wrap
  });
  if (st.heal) {
    const rollable = !!st.heal.dice;
    effect.push(h(rollable ? 'button' : 'span', { class: 'ch-spell-chip ch-spell-heal', type: rollable ? 'button' : null, title: [rollable ? 'Roll healing' : 'Healing', st.heal.note, tip].filter(Boolean).join('\n'), onclick: rollable ? () => rollSpellEffect(r.name, [st.heal], { heal: true }) : null },
      icon('heart'), h('span', { class: 'num' }, st.heal.text)));
  }
  return { hit: chips, effect };
}

/** Cantrip scaling ("3d10 at level 11") or upcast ("Higher slots +1d6 each") note of a spell row, or ''. */
function spellUpNote(r) {
  const st = r.stats;
  if (st?.scaling && r.level === 0) return st.scaling.next ? `${st.scaling.kind === 'count' ? `${st.scaling.next.count} ${st.count?.unit || 'beam'}s` : st.scaling.next.dice} at level ${st.scaling.next.level}` : '';
  return st?.upcast && (st.damage.length || st.heal || st.upcast.what === 'count') ? `Higher slots ${st.upcast.what === 'count' ? `+1 ${st.upcast.unit}` : `+${st.upcast.dice}`} each` : '';
}

function togglePrepared(r, on) {
  mutate((y) => {
    const t = y.spells.find((x) => x.id === r.id && (x.class || null) === (r.class || null)) || y.spells.find((x) => x.id === r.id);
    if (t) t.prepared = on;
  });
}

/** A spell's own menu (its name in a row): the entry modal with the Favorite toggle; a short one for non-SRD spells. */
function spellInfo(r) {
  if (r.entry) return entryInfo(r.entry, { spell: r });
  return openModal({
    title: r.name,
    body: h('div', { class: 'stack' }, favRow('spells', r.favKey, r.name),
      r.from ? h('p', { class: 'muted ui text-sm' }, r.from) : null,
      h('p', null, 'This spell is not in the SRD; see your book.')),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
}

/** Remove a stored spell and its star (kept when a feature still lists the same spell, always prepared). */
function removeSpell(r) {
  mutate((y) => {
    y.spells = y.spells.filter((x) => !(x.id === r.id && (x.class || null) === (r.class || null)));
    if (isFavorite(y, 'spells', r.favKey)) dropSpellFavorite(y, r.favKey, derive(y).spells);
  });
}

/**
 * One spell line (Spells tab and Bonus actions tab): prepare box (lock when always prepared, dot for cantrips) |
 * name + badges (+ where it comes from) | casting time | range | to hit / save DC | damage / healing | remove.
 * On a narrow list the columns wrap under the name. data-* feed the Spells tab filter (applySpellFilter).
 * A starred spell shows the gold star before its name; the name opens its menu (Favorite toggle), and with a mouse
 * a small star at the end of the name cell toggles it right there (shown on hover / keyboard focus, takes no room).
 *   opts.time / timeTitle  replace the casting time cell (Bonus actions tab: the spell level)
 *   opts.from              show the spell's class / source after its name (several sources on the sheet)
 *   opts.stat              data-stat of the row (default the spell id; other tabs prefix it so links find the Spells tab)
 */
function spellItem(r, s, { time = null, timeTitle = null, from = false, fk = '', stat = null } = {}) {
  const lvl = r.level;
  const { hit, effect } = spellChips(r, s, fk);
  const none = () => h('span', { class: 'ch-spell-none faint', 'aria-hidden': 'true' }, '—');
  const range = r.entry?.range ? shortRange(r.entry.range) : '';
  return h('li', {
    class: ['ch-spell', r.ready ? 'is-prepared' : 'is-unprepared', r.issues.length && 'is-off', r.fav && 'is-fav'], 'data-stat': stat || r.id,
    'data-lvl': String(lvl), 'data-fx': r.keys.join(' '), 'data-ready': r.ready ? '1' : '0', 'data-fav': r.fav ? '1' : '0', 'data-name': r.name,
  },
    r.always ? h('span', { class: 'ch-spell-lock', title: `Always prepared${r.source ? ` (${r.source})` : ''}`, role: 'img', 'aria-label': 'Always prepared' }, icon('lock'))
      : lvl > 0 ? h('input', {
        type: 'checkbox', class: 'checkbox ch-spell-prep', checked: !!r.prepared, 'data-fk': `prep-${r.class}-${r.id}${fk}`,
        title: 'Prepared', 'aria-label': `Prepare ${r.name}`, onchange: (e) => togglePrepared(r, e.target.checked),
      }) : h('span', { class: 'ch-spell-dot', title: 'Cantrip: always ready', 'aria-hidden': 'true' }),
    h('div', { class: 'ch-spell-id' },
      r.fav ? favMark() : null,
      h('button', { class: 'ch-link-btn ch-spell-name', type: 'button', title: spellUpNote(r) || null, onclick: () => spellInfo(r) }, r.name),
      r.entry?.concentration ? h('span', { class: 'badge', title: 'Concentration' }, 'C') : null,
      r.entry?.ritual ? h('span', { class: 'badge', title: 'Ritual' }, 'R') : null,
      r.issues.length ? h('span', { class: 'ch-spell-off', tabindex: 0, title: `Added anyway: ${r.issues.map((i) => i.text).join(' ')}`, 'aria-label': `Off-list: ${r.issues.map((i) => i.text).join(' ')}` }, 'off-list') : null,
      from && r.from ? h('span', { class: 'ch-spell-from' }, r.from) : null,
      h('button', {
        class: ['ch-spell-star', r.fav && 'is-active'], type: 'button', 'aria-pressed': String(!!r.fav), 'data-fk': `spstar-${r.favKey}${fk}`,
        'aria-label': r.fav ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`,
        title: r.fav ? 'Remove from favorites' : 'Add to favorites (listed first and in the Favorites tab)',
        onclick: () => mutate((y) => { toggleFavorite(y, 'spells', r.favKey); }),
      }, icon('star'))),
    h('div', { class: 'ch-spell-cols' },
      h('span', { class: 'ch-spell-time', title: timeTitle || r.entry?.castingTime || null }, time || shortCastingTime(r.entry?.castingTime) || '—'),
      h('span', { class: ['ch-spell-range', !range && 'is-empty'], title: r.entry?.range || null }, range || '—'),
      hit.length ? h('span', { class: 'ch-spell-hit' }, hit) : none(),
      effect.length ? h('span', { class: 'ch-spell-fx' }, effect) : none()),
    !r.always && r.stored ? h('button', { class: 'btn-icon btn-sm ch-row-x', type: 'button', 'aria-label': `Remove ${r.name}`, title: 'Remove', onclick: () => removeSpell(r) }, icon('close')) : h('span', { class: 'ch-row-x', 'aria-hidden': 'true' }));
}

/** Heading of a block of spell rows; on a wide list it also labels the columns. */
function spellHead(title, sub, { time = 'Time' } = {}) {
  return h('h4', { class: 'ch-mini-head ch-spell-lvl-head' },
    h('span', { class: 'ch-spell-lvl-t' }, title, sub ? h('span', { class: 'ch-spell-lvl-sub' }, sub) : null),
    h('span', { class: 'ch-spell-col-labels', 'aria-hidden': 'true' }, [time, 'Range', 'Hit / DC', 'Effect'].map((t) => h('span', null, t))));
}

/** "2 of 3 slots left" / "cast with level 3 pact slots" / "at will" for a spell level. */
function slotText(lvl, c, s) {
  if (lvl === 0) return 'at will';
  const slots = Number(s.slots[lvl - 1]) || 0;
  const pactLvl = s.pact ? Number(s.pact.level) || 0 : 0;
  const pactHere = pactLvl >= lvl;
  return [
    slots ? `${Math.max(0, slots - (c.slotsUsed[lvl - 1] || 0))} of ${slots} slots left` : '',
    pactHere ? (pactLvl === lvl ? `${Math.max(0, s.pact.slots - (c.pactUsed || 0))} of ${s.pact.slots} pact slots` : `cast with level ${pactLvl} pact slots`) : '',
    !slots && !pactHere ? 'no slots' : ''].filter(Boolean).join(' · ');
}

/** Prepared leveled spells / cantrips a caster has now: the counts of the Spells tab's caster line. */
const casterPrepared = (c, sc) => sc.preparedCount ?? c.spells.filter((x) => x.class === sc.class && x.prepared && !x.always && (Number(findEntry('spell', x.id)?.level) || 0) > 0).length;
const casterCantrips = (c, sc) => sc.cantripCount ?? c.spells.filter((x) => x.class === sc.class && (Number(findEntry('spell', x.id)?.level) || 0) === 0 && !x.always).length;

function spells(c, s) {
  const rows = spellRows(c, s);
  // the Favorites chip goes with the last starred spell, and so does its filter
  if (spellFilter().favorite && !rows.some((r) => r.fav)) SPELL_FILTERS.set(S.id, { ...spellFilter(), favorite: false });
  const add = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addSpells(s) }, icon('plus'), 'Spells');
  if (!s.spellcasting.length && !rows.length && !s.slots.some(Boolean) && !s.pact) {
    return section('spells', 'Spellcasting', { iconName: 'sparkle', actions: [add] },
      h('div', { class: 'empty-state ch-spell-empty' }, icon('sparkle'),
        h('p', null, `${c.name || 'This character'} has no spellcasting yet. Spells from a class, a feat such as Magic Initiate, or your species appear here on their own; you can also add one by hand.`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addSpells(s) }, icon('plus'), 'Add a spell')));
  }
  const byLevel = new Map();
  rows.forEach((r) => { if (!byLevel.has(r.level)) byLevel.set(r.level, []); byLevel.get(r.level).push(r); });
  const preparedCount = (sc) => casterPrepared(c, sc);
  const cantripCount = (sc) => casterCantrips(c, sc);
  const innate = Array.isArray(s.innate) ? s.innate : [];
  const several = new Set(rows.map((r) => r.from)).size > 1;
  const el = section('spells', 'Spellcasting', {
    iconName: 'sparkle',
    actions: [add],
  },
  s.spellcasting.length || innate.length ? h('div', { class: 'ch-casters' }, s.spellcasting.map((sc) => h('div', { class: 'ch-caster' },
    h('strong', null, entryName('class', sc.class) || prettify(sc.class)),
    h('span', { class: 'badge' }, String(sc.ability || '').toUpperCase()),
    h('span', null, 'Save DC ', adjValue(s, `spellDc:${sc.class}`, String(sc.dc), { className: 'ch-caster-num' })),
    h('span', null, 'Attack ', h('button', { class: 'ch-link-btn ch-bonus', type: 'button', title: 'Roll a spell attack', onclick: () => rollToast(`${entryName('class', sc.class)} spell attack`, sc.attack) }, adjValue(s, `spellAttack:${sc.class}`, fmt(sc.attack)))),
    sc.cantrips ? h('span', { class: cantripCount(sc) > sc.cantrips ? 'danger-text' : 'muted' }, `Cantrips ${cantripCount(sc)}/${sc.cantrips}`) : null,
    sc.prepared ? h('span', { class: preparedCount(sc) > sc.prepared ? 'danger-text' : 'muted' }, `Prepared ${preparedCount(sc)}/${sc.prepared}`) : null,
    sc.spellbook ? h('span', { class: 'muted' }, `Spellbook ${sc.spellbook.count}${sc.spellbook.size ? `/${sc.spellbook.size}+` : ''}`) : null)),
  innate.map((g) => h('div', { class: 'ch-caster' },
    h('strong', null, g.source || 'Innate'),
    h('span', { class: 'badge' }, String(g.ability || '').toUpperCase()),
    h('span', null, 'Save DC ', adjValue(s, `spellDc:innate:${g.key}`, String(g.dc), { className: 'ch-caster-num' })),
    h('span', null, 'Attack ', h('button', { class: 'ch-link-btn ch-bonus', type: 'button', title: 'Roll a spell attack', onclick: () => rollToast(`${g.source || 'Innate'} spell attack`, g.attack) }, adjValue(s, `spellAttack:innate:${g.key}`, fmt(g.attack)))),
    h('span', { class: 'muted' }, (g.spells || []).map((id) => entryName('spell', id)).join(', '))))) : null,
  // Slots on one line: "Slots 1st ●●●● 2nd ●●● · Pact 3rd ●●"; what's left is in each level's heading
  s.slots.some(Boolean) || s.pact ? h('div', { class: 'ch-slots', 'data-sec': 'slots' },
    h('span', { class: 'ch-slots-label' }, 'Slots'),
    s.slots.map((n, i) => (n ? h('span', { class: 'ch-slot-row', title: `Level ${i + 1}: ${Math.max(0, n - (c.slotsUsed[i] || 0))} of ${n} left` },
      h('span', { class: 'ch-slot-lvl' }, ordinal(i + 1)),
      pips({ max: n, used: c.slotsUsed[i], label: `Level ${i + 1} slots`, fk: `slot${i}`, onChange: (u) => mutate((y) => { y.slotsUsed[i] = u; }) })) : null)),
    s.pact ? h('span', { class: 'ch-slot-row ch-pact', title: 'Pact Magic slots come back on a short rest' },
      h('span', { class: 'ch-slot-lvl' }, `Pact ${ordinal(s.pact.level ?? s.pact.slotLevel ?? '?')}`),
      pips({ max: s.pact.slots, used: c.pactUsed, label: 'Pact Magic slots', fk: 'pact', onChange: (u) => mutate((y) => { y.pactUsed = u; }) })) : null) : null,
  rows.length >= 4 ? spellFilterBar(rows) : null,
  rows.length ? h('div', { class: 'ch-spell-levels' }, [...byLevel.keys()].sort((a, b) => a - b).map((lvl) => h('div', { class: 'ch-spell-level' },
    spellHead(lvl === 0 ? 'Cantrips' : `Level ${lvl}`, slotText(lvl, c, s)),
    h('ul', { class: 'ch-spell-list', role: 'list' }, favoritesFirst(byLevel.get(lvl).sort((a, b) => a.name.localeCompare(b.name)), (r) => r.fav).map((r) => spellItem(r, s, { from: several })))))) : h('p', { class: 'muted ui text-sm' }, 'No spells chosen yet.'),
  rows.length >= 4 ? h('div', { class: 'ch-sf-none muted ui text-sm', hidden: true }, 'No spells match these filters. ',
    h('button', { class: 'ch-link-btn', type: 'button', onclick: (e) => setSpellFilter(e, null) }, 'Clear filters')) : null);
  applySpellFilter(el);
  return el;
}

const ordinal = (n) => (Number.isFinite(Number(n)) ? `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}` : String(n));

// ---------- Spells tab filter: level · effect (damage, healing, a damage type, concentration…) · prepared · favorites · name ----------

const SPELL_FILTERS = new Map(); // character id -> {level, fx, prepared, favorite, q} (this session)
const NO_SPELL_FILTER = { level: null, fx: null, prepared: false, favorite: false, q: '' };
const spellFilter = () => SPELL_FILTERS.get(S.id) || NO_SPELL_FILTER;

/** Change the filter (patch null = clear it) and show / hide the rows in place, without repainting the sheet. */
function setSpellFilter(e, patch) {
  SPELL_FILTERS.set(S.id, patch ? { ...spellFilter(), ...patch } : NO_SPELL_FILTER);
  const sec = e.currentTarget.closest('[data-sec="spells"]');
  if (!patch) { const q = sec?.querySelector('.ch-sf-q'); if (q) q.value = ''; }
  applySpellFilter(sec);
}

/**
 * Chips for the levels and effects present, Prepared and (with a starred spell) Favorites toggles, a name search and
 * a "5 of 19 · Clear" note.
 */
function spellFilterBar(rows) {
  const f = spellFilter();
  const opts = spellFilterOptions(rows);
  const chip = (label, n, attrs, onclick, title = null) => h('button', { class: ['chip', 'ch-sf-chip'], type: 'button', 'aria-pressed': 'false', title, onclick, ...attrs },
    label, n != null ? h('span', { class: 'ch-sf-n num' }, String(n)) : null);
  return h('div', { class: 'ch-sf', role: 'group', 'aria-label': 'Filter spells' },
    h('div', { class: 'ch-sf-row' },
      opts.levels.length > 1 ? h('div', { class: 'ch-sf-group', role: 'group', 'aria-label': 'Spell level' },
        chip('All', rows.length, { 'data-sf-level': 'all', 'data-fk': 'sf-level-all' }, (e) => setSpellFilter(e, { level: null })),
        opts.levels.map((o) => chip(o.level ? ordinal(o.level) : 'Cantrips', o.n, { 'data-sf-level': String(o.level), 'data-fk': `sf-level-${o.level}` },
          (e) => setSpellFilter(e, { level: spellFilter().level === o.level ? null : o.level }), o.level ? `Level ${o.level} spells` : null))) : null,
      chip('Prepared', null, { 'data-sf-prep': '', 'data-fk': 'sf-prep' }, (e) => setSpellFilter(e, { prepared: !spellFilter().prepared }), 'Only spells you can cast now: cantrips and prepared spells'),
      opts.favorites ? chip([h('span', { class: 'ch-sf-star', 'aria-hidden': 'true' }, icon('star')), 'Favorites'], opts.favorites, { 'data-sf-fav': '', 'data-fk': 'sf-fav' },
        (e) => setSpellFilter(e, { favorite: !spellFilter().favorite }), 'Only your starred spells') : null,
      h('span', { class: 'spacer' }),
      h('input', {
        class: 'input input-sm ch-sf-q', type: 'search', placeholder: 'Find a spell', value: f.q, 'aria-label': 'Find a spell by name', 'data-fk': 'sf-q',
        oninput: (e) => setSpellFilter(e, { q: e.target.value }),
      })),
    opts.effects.length ? h('div', { class: 'ch-sf-group ch-sf-fx', role: 'group', 'aria-label': 'Effect' },
      opts.effects.map((o) => chip(o.label, o.n, { 'data-sf-fx': o.key, 'data-fk': `sf-fx-${o.key}` }, (e) => setSpellFilter(e, { fx: spellFilter().fx === o.key ? null : o.key })))) : null,
    h('p', { class: 'ch-sf-status muted ui text-xs', hidden: true, 'aria-live': 'polite' },
      h('span', { class: 'ch-sf-count' }), ' · ',
      h('button', { class: 'ch-link-btn', type: 'button', 'data-fk': 'sf-clear', onclick: (e) => setSpellFilter(e, null) }, 'Clear filters')));
}

/** Show the spell rows (and level blocks) passing the current filter; mark the active chips. */
function applySpellFilter(sec) {
  if (!sec) return;
  const f = spellFilter();
  let shown = 0;
  let total = 0;
  sec.querySelectorAll('.ch-spell-level').forEach((block) => {
    let any = false;
    block.querySelectorAll('li.ch-spell').forEach((li) => {
      const ok = spellPasses({ level: Number(li.dataset.lvl), keys: (li.dataset.fx || '').split(' ').filter(Boolean), ready: li.dataset.ready === '1', fav: li.dataset.fav === '1', name: li.dataset.name }, f);
      li.hidden = !ok;
      total += 1;
      if (ok) { shown += 1; any = true; }
    });
    block.hidden = !any;
  });
  const on = (el, yes) => { el.setAttribute('aria-pressed', String(yes)); el.classList.toggle('is-active', yes); };
  sec.querySelectorAll('[data-sf-level]').forEach((b) => on(b, b.dataset.sfLevel === (f.level == null ? 'all' : String(f.level))));
  sec.querySelectorAll('[data-sf-fx]').forEach((b) => on(b, b.dataset.sfFx === f.fx));
  sec.querySelectorAll('[data-sf-prep]').forEach((b) => on(b, !!f.prepared));
  sec.querySelectorAll('[data-sf-fav]').forEach((b) => on(b, !!f.favorite));
  const active = f.level != null || !!f.fx || !!f.prepared || !!f.favorite || !!String(f.q || '').trim();
  const status = sec.querySelector('.ch-sf-status');
  if (status) {
    status.hidden = !active || !shown;
    status.querySelector('.ch-sf-count').textContent = `Showing ${shown} of ${total} spells`;
  }
  const none = sec.querySelector('.ch-sf-none');
  if (none) none.hidden = !(active && !shown);
}

// ---------- bonus actions (content of the "Bonus actions" tab) ----------

/**
 * Everything usable as a Bonus Action: prepared bonus-action spells (same chips as the Spells tab), features whose
 * rules text grants one (Cunning Action, Rage, Second Wind…; with their resource pips), custom abilities and the
 * Light-weapon off-hand attack. Logic in engine-actions.js.
 */
function bonusActions(c, s) {
  const baSpells = spellRows(c, s).filter((r) => r.entry && isBonusActionSpell(r.entry) && (r.prepared || r.always || r.level === 0))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const feats = bonusActionFeatures(s.features);
  const resByKey = new Map(s.resources.map((r) => [r.key, r]));
  const resOf = (f) => (f.uses && typeof f.uses === 'object' && f.uses.key && resByKey.get(f.uses.key)) || (typeof f.uses === 'string' && resByKey.get(f.uses)) || resByKey.get(f.id) || null;
  const off = offhandAttacks(s);
  const unarmed = s.attacks.find((a) => a.unarmed);
  const atkChips = attackChips;
  const featItem = ({ feature: f, options }) => {
    const res = resOf(f);
    const heal = options.map((o) => featureHealing(o.text, s.classes)).find(Boolean);
    return h('li', { class: 'ch-ba', 'data-stat': `ba-${f.id || f.name}` },
      h('div', { class: 'ch-ba-head' },
        h('button', { class: 'ch-link-btn ch-ba-name', type: 'button', onclick: () => featureModal(f) }, f.name),
        f.source ? h('span', { class: 'badge' }, f.source) : null,
        h('span', { class: 'spacer' }),
        res ? resourcePips(res) : null),
      h('ul', { class: 'ch-ba-opts', role: 'list' }, options.map((o, oi) => h('li', null,
        o.label && o.label !== options[oi - 1]?.label ? h('strong', null, `${o.label}. `) : null, o.text,
        o.more?.length ? h('span', { class: 'ch-ba-more' }, ` ${o.more.join(' · ')}`) : null,
        /Unarmed Strike/i.test(o.text) && unarmed ? h('span', { class: 'ch-ba-chips' }, atkChips(unarmed, 'Unarmed Strike')) : null))),
      heal ? h('div', { class: 'ch-ba-chips' }, h('button', { class: 'ch-spell-chip ch-spell-heal', type: 'button', title: 'Roll healing', onclick: () => rollPlain(`${f.name} heals`, heal.dice, null, heal.bonus) }, icon('heart'), h('span', { class: 'num' }, heal.text))) : null);
  };
  const groups = [
    baSpells.length ? h('div', { class: 'ch-ba-group' },
      h('div', { class: 'ch-spell-levels ch-ba-spells' }, h('div', { class: 'ch-spell-level' }, spellHead('Spells', 'cast as a Bonus Action', { time: 'Level' }),
        h('ul', { class: 'ch-spell-list', role: 'list' },
          baSpells.map((r) => spellItem(r, s, { time: r.level ? `Level ${r.level}` : 'Cantrip', timeTitle: r.level ? `Level ${r.level}: ${slotText(r.level, c, s)}` : 'Cantrip: at will', fk: '-ba' })))))) : null,
    feats.length ? h('div', { class: 'ch-ba-group' },
      h('h4', { class: 'ch-mini-head ch-spell-lvl-head' }, 'Features & traits'),
      h('ul', { class: 'ch-ba-list', role: 'list' }, feats.map(featItem))) : null,
    off.eligible ? h('div', { class: 'ch-ba-group' },
      h('h4', { class: 'ch-mini-head ch-spell-lvl-head' }, 'Off-hand attack', h('span', { class: 'ch-spell-lvl-sub' }, 'Light weapons')),
      h('ul', { class: 'ch-ba-list', role: 'list' }, off.options.map((o) => h('li', { class: 'ch-ba ch-ba-row', 'data-stat': `ba-off-${o.uid}` },
        h('span', { class: 'ch-ba-name' }, o.name, o.nick ? h('span', { class: 'badge badge-accent', title: 'Nick mastery: make the extra attack as part of the Attack action instead, once per turn' }, 'Nick') : null),
        h('span', { class: 'ch-ba-chips' }, atkChips(o, `${o.name} (off-hand)`))))),
      h('p', { class: 'muted ui text-xs ch-ba-note' },
        'When you take the Attack action and attack with a Light weapon, you can make one extra attack as a Bonus Action with a different Light weapon. ',
        off.twoWeaponFighting ? 'Two-Weapon Fighting: add your ability modifier to its damage. ' : 'Don’t add your ability modifier to its damage unless it’s negative (already left out above). ',
        off.nick ? 'Nick: with a Nick weapon the extra attack is part of the Attack action instead, so your Bonus Action stays free (once per turn).' : '')) : null,
  ].filter(Boolean);
  return section('bonus-actions', 'Bonus actions', { iconName: 'clock' },
    groups.length ? groups : h('div', { class: 'empty-state ch-spell-empty' }, icon('clock'),
      h('p', null, 'Nothing to do with a Bonus Action yet. Features such as Cunning Action or Second Wind, spells such as Healing Word, and a second Light weapon show up here.')),
    !off.eligible && off.reason ? h('p', { class: 'muted ui text-xs ch-ba-note' }, off.reason) : null);
}

/** Roll "1d6+3" (or dice + bonus) into a toast. */
function rollPlain(label, dice, type = null, bonus = 0) {
  const r = rollDice(bonus ? { dice, bonus } : String(dice).replace('−', '-'));
  if (!r) return;
  toast(`${label}: ${r.dice}${r.bonus ? ` ${r.bonus < 0 ? '−' : '+'} ${Math.abs(r.bonus)}` : ''} (${r.rolls.join(', ')}) = ${r.total}${type ? ` ${prettify(type)}` : ''}`, { type: 'info', timeout: 6000 });
}

function featureModal(f) {
  openModal({
    title: f.name, wide: true,
    body: h('div', { class: 'stack' }, favRow('features', featureFavKey(f), f.name),
      f.source ? h('p', { class: 'muted ui text-sm' }, f.source) : null, md(f.description, { empty: 'No description.' })),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
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
  // the counts of the Spells tab's caster line, for the limits box and the prepared flags of the new spells
  const scN = sc && { ...sc, cantripCount: casterCantrips(S.char, sc), preparedCount: casterPrepared(S.char, sc) };
  const limits = { prepareAnyway: false };
  const res = await openPicker('spell', {
    title: sc ? `${className} spells (up to level ${max})` : 'Add spells',
    multi: true,
    filter: (e) => !have.has(e.id) && (!allowed || allowed.has(e.id)),
    // Any spell may be added; the ones that don't fit get a notice first and an "off-list" mark on the sheet.
    widen: sc ? { label: 'Show all spells', hint: `Include spells outside the ${className} list or above level ${max}. You’ll be told why they don’t fit and can add them anyway.`, filter: (e) => !have.has(e.id) } : null,
    mark: (e) => {
      const out = [];
      const k = spellFit(e, s);
      if (k.known) out.push({ label: k.always ? 'Always prepared' : k.prepared ? 'Known' : 'In spellbook', tone: 'ok', title: 'Already on your sheet (another class or source)' });
      const is = issuesOf(e);
      if (is.length) out.push({ label: is.some((i) => i.code === 'not-on-list') ? 'off-list' : 'too high', title: is.map((i) => i.text).join(' ') });
      return out;
    },
    head: scN ? (chosen, { redraw }) => spellLimitsBox(scN, className, chosen, limits, redraw) : null,
  });
  let picked = [].concat(res || []).filter(Boolean);
  if (!picked.length) return;
  // Compatibility notice (never blocks): list, slot level, no spellcasting class; and a cantrip / prepared limit
  // only when the limits box didn't show it (a class without cantrips): going over a shown limit asks nothing more
  let plan = addSpellIssues(picked, scN, { className });
  if (limits.prepareAnyway) plan = plan.map((x) => ({ ...x, prepared: true }));
  if (!sc) plan = plan.map((x) => ({ ...x, issues: [{ code: 'no-caster', text: s.innate?.length ? 'Not tied to a spellcasting class: it uses no class’s attack bonus or save DC.' : `${S.char.name || 'This character'} has no spellcasting class, so the sheet can’t show an attack bonus or save DC.` }] }));
  const shownLimit = (i) => (i.code === 'cantrip-limit' && Number(sc?.cantrips) > 0) || (i.code === 'prepared-limit' && Number(sc?.prepared) > 0);
  const bad = plan.map((x) => ({ ...x, issues: x.issues.filter((i) => !shownLimit(i)) })).filter((x) => x.issues.length);
  if (bad.length) {
    const fits = plan.length - bad.length;
    const choice = await choiceDlg(h('div', { class: 'stack stack-sm ch-offlist-notice' },
      h('p', null, sc ? `${bad.length === 1 ? 'This spell doesn’t' : `${bad.length} of these spells don’t`} fit ${className} ${sc.classLevel ?? ''} as built:` : 'A heads-up before adding:'),
      h('ul', { class: 'ui text-sm' }, bad.map((x) => h('li', null, h('strong', null, x.record.name), ` (${Number(x.record.level) ? `level ${x.record.level}` : 'cantrip'}) — `, x.issues.map((i) => i.text).join(' ')))),
      h('p', { class: 'muted ui text-sm' }, 'You can still add them (a house rule, a scroll, a DM’s gift…). They get a small “off-list” mark on the sheet.')),
    [{ label: 'Cancel', value: null, kind: 'ghost' }, fits ? { label: `Add only the ${fits} that fit`, value: 'fits' } : null, { label: bad.length === plan.length ? 'Add anyway' : 'Add all anyway', value: 'all', kind: 'primary' }].filter(Boolean),
    { title: 'Not a usual pick for this build' });
    if (!choice) return;
    if (choice === 'fits') { const no = new Set(bad.map((x) => x.record)); plan = plan.filter((x) => !no.has(x.record)); }
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

/**
 * Box at the top of the Add spells picker: the caster's limits as on the Spells tab's caster line (cantrips, prepared,
 * spellbook), counting the spells ticked below. Going over is allowed: the count turns red and the note says by how
 * much. A spellbook caster's spells past the prepared limit go in unprepared unless "Prepare past the limit" is ticked.
 * sc carries the sheet's cantripCount / preparedCount; opts.prepareAnyway is read by addSpells.
 */
function spellLimitsBox(sc, className, picked, opts, redraw) {
  if (!sc.cantrips && !sc.prepared && !sc.spellbook) return null;
  const always = new Set(sc.alwaysPrepared || []);
  const plan = addSpellIssues(picked.filter((e) => !always.has(e.id)), sc);
  const leveled = plan.filter((x) => Number(x.record.level) > 0);
  const intoBook = leveled.filter((x) => !x.prepared).length;
  const cantrips = sc.cantripCount + plan.length - leveled.length;
  const prepared = sc.preparedCount + leveled.length - (opts.prepareAnyway ? 0 : intoBook);
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  const overC = sc.cantrips ? Math.max(0, cantrips - sc.cantrips) : 0;
  const overP = sc.prepared ? Math.max(0, prepared - sc.prepared) : 0;
  const over = [overC ? n(overC, 'cantrip') : '', overP ? n(overP, 'prepared spell') : ''].filter(Boolean);
  const count = (label, k, max, title, atLeast = false) => h('span', { class: ['ch-pick-limit', !atLeast && k > max && 'is-over'], title },
    `${label} `, h('span', { class: 'num' }, `${k}/${max}${atLeast ? '+' : ''}`));
  return h('div', { class: 'ch-pick-limits', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'ch-pick-limits-row' },
      h('strong', null, `${className}${sc.classLevel ? ` ${sc.classLevel}` : ''}`),
      sc.cantrips ? count('Cantrips', cantrips, sc.cantrips, 'Cantrips with the ticked ones / the most this class level knows') : null,
      sc.prepared ? count('Prepared', prepared, sc.prepared, 'Prepared spells with the ticked ones / the most this class level prepares') : null,
      sc.spellbook ? count('Spellbook', sc.spellbook.count + leveled.length, sc.spellbook.size, 'Spells in the spellbook with the ticked ones / how many it holds at least by this level', true) : null),
    h('p', { class: 'ch-pick-limits-note muted' }, !over.length ? 'Spells you tick below count toward these limits. You can go over them if you wish.'
      : picked.length ? `${over.join(' and ')} over the limit. You can still add ${overC + overP === 1 ? 'it' : 'them'}; the Spells tab shows the count in red.`
        : `${over.join(' and ')} over the limit already. You can still add more if you wish.`),
    intoBook ? h('label', { class: 'checkbox ch-pick-limits-prep' },
      h('input', { type: 'checkbox', checked: !!opts.prepareAnyway, 'data-fk': 'limits-prep', onchange: (e) => { opts.prepareAnyway = e.target.checked; redraw(); } }),
      h('span', null, 'Prepare past the limit', opts.prepareAnyway ? null
        : h('span', { class: 'muted' }, ` (otherwise ${intoBook === 1 ? '1 ticked spell goes' : `${intoBook} ticked spells go`} into the spellbook unprepared)`))) : null);
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

// View of Features & traits, remembered per device: {view:'all'|'smart', tag}
const FEAT_VIEW_KEY = 'sw:characters:features';
function featView() {
  try { const v = JSON.parse(localStorage.getItem(FEAT_VIEW_KEY) || '{}'); return { view: v.view === 'smart' ? 'smart' : 'all', tag: v.tag || 'magic' }; } catch { return { view: 'all', tag: 'magic' }; }
}
function setFeatView(patch) {
  try { localStorage.setItem(FEAT_VIEW_KEY, JSON.stringify({ ...featView(), ...patch })); } catch { /* private mode */ }
  render();
}

/** Smart tags of every feature this sheet shows (custom abilities read their own record: manual tags, modifiers). */
function featureTagging(c, s) {
  const lib = Object.fromEntries(cat('ability').map((a) => [a.id, a]));
  return tagFeatures(s.features, { records: customAbilityRecords(c, lib) });
}

function features(c, s) {
  const v = featView();
  const choices = Array.isArray(s.choices) && s.choices.length ? s.choices : (() => { try { return allChoices(c); } catch { return []; } })();
  const choiceByKey = new Map(choices.map((x) => [x.key, x]));
  const resByKey = new Map(s.resources.map((r) => [r.key, r]));
  const tagging = featureTagging(c, s);
  const tagsOf = new Map(tagging.tagged.map((x) => [x.feature, x.tags]));
  const favs = favSet(c, 'features');
  const isFav = (f) => favs.has(featureFavKey(f));
  const item = (f) => feature(f, choiceByKey, resByKey, tagsOf.get(f) || [], isFav(f));
  const favFirst = (list) => favoritesFirst(list, isFav);
  const seg = h('div', { class: 'ch-seg ch-feat-views', role: 'group', 'aria-label': 'Features view' },
    [['all', 'All'], ['smart', 'Smart']].map(([id, label]) => h('button', {
      class: ['ch-seg-btn', v.view === id && 'is-active'], type: 'button', 'aria-pressed': String(v.view === id), 'data-fk': `feat-view-${id}`,
      title: id === 'smart' ? 'Group by what features do: magic, attack, defense…' : 'Group by where features come from',
      onclick: () => setFeatView({ view: id }),
    }, label)));
  let body;
  if (!s.features.length) body = h('p', { class: 'muted ui text-sm' }, 'No features yet. Choose a class, species and background.');
  else if (v.view === 'smart') body = smartFeatures(c, s, tagging, item, v.tag, favFirst);
  else {
    const groups = new Map();
    for (const f of s.features) {
      const [k, label] = featureGroup(f);
      if (!groups.has(k)) groups.set(k, { label, list: [] });
      groups.get(k).list.push(f);
    }
    body = h('div', { class: 'ch-feat-flow' }, [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => h('div', { class: 'ch-feat-group' },
      h('h3', { class: 'ch-feat-group-title' }, g.label, h('span', { class: 'ch-feat-count' }, String(g.list.length))),
      h('div', { class: 'ch-feat-cols' }, favFirst(g.list).map(item)))));
  }
  return section('features', 'Features & traits', {
    iconName: 'scroll',
    actions: [seg,
      h('button', { class: 'btn-icon btn-sm ch-feat-fold', type: 'button', title: 'Expand all', 'aria-label': 'Expand all', onclick: () => setAllFeatures(true) }, icon('chevron-down')),
      h('button', { class: 'btn-icon btn-sm ch-feat-fold', type: 'button', title: 'Collapse all', 'aria-label': 'Collapse all', onclick: () => setAllFeatures(false) }, icon('chevron-up')),
      h('a', { class: 'btn btn-ghost btn-sm', href: editHref('advanced'), title: 'Add a special ability (Edit all → Advanced)' }, icon('plus'), 'Ability')],
  }, body);
}

/** Smart view: tag chips with counts, then the character's related numbers and the matching features. */
function smartFeatures(c, s, tagging, item, tag, favFirst = (l) => l) {
  const untagged = tagging.tagged.filter((x) => !x.tags.length).map((x) => x.feature);
  const ALWAYS = new Set(['magic', 'attack', 'weaponry', 'leveling', 'interaction', 'advantages', 'defense']);
  const tags = [...TAGS.filter((t) => ALWAYS.has(t.id) || tagging.counts[t.id]), ...(untagged.length ? [{ id: 'other', label: 'Other', hint: 'No smart tag' }] : [])];
  const cur = tags.some((t) => t.id === tag) ? tag : 'magic';
  const list = cur === 'other' ? untagged : (tagging.byTag[cur] || []).map((x) => x.feature);
  const aspects = tagAspects(cur, c, s);
  return h('div', { class: 'ch-smart' },
    h('div', { class: 'ch-smart-tags', role: 'tablist', 'aria-label': 'Smart tags' }, tags.map((t) => h('button', {
      class: ['chip', 'ch-smart-tag', t.id === cur && 'is-active'], type: 'button', role: 'tab', 'aria-selected': String(t.id === cur), title: t.hint, 'data-fk': `smart-${t.id}`,
      onclick: () => setFeatView({ view: 'smart', tag: t.id }),
    }, t.label, h('span', { class: 'ch-smart-n num' }, String(t.id === 'other' ? untagged.length : tagging.counts[t.id] || 0))))),
    aspects ? h('div', { class: 'ch-aspects', 'aria-label': 'On your sheet' }, aspects) : null,
    list.length ? h('div', { class: 'ch-feat-flow' }, h('div', { class: 'ch-feat-group' }, h('div', { class: 'ch-feat-cols' }, favFirst(list).map(item))))
      : h('p', { class: 'muted ui text-sm' }, `No features tagged ${tags.find((t) => t.id === cur)?.label || cur} yet.`));
}

/** One aspect row: label + value nodes. */
const aspect = (label, ...value) => h('div', { class: 'ch-aspect' }, h('dt', null, label), h('dd', null, value));
const chipList = (items) => (items.length ? h('span', { class: 'ch-aspect-chips' }, items.map((x) => h('span', { class: 'chip' }, x))) : h('span', { class: 'faint' }, '—'));

/** The character's numbers that belong with a smart tag (compact <dl>), or null. */
function tagAspects(tag, c, s) {
  const rows = [];
  const skill = (id) => { const x = s.skills[id]; const sk = skillList().find((k) => k.id === id); return x ? `${sk?.name || prettify(id)} ${fmt(x.bonus)}${x.expertise ? ' (Exp)' : x.prof ? ' (P)' : ''}` : null; };
  if (tag === 'magic') {
    for (const sc of s.spellcasting) rows.push(aspect(sc.name || entryName('class', sc.class), `${String(sc.ability).toUpperCase()} · DC `, adjValue(s, `spellDc:${sc.class}`, String(sc.dc)), ' · attack ', adjValue(s, `spellAttack:${sc.class}`, fmt(sc.attack)), sc.prepared ? ` · prepared ${sc.preparedCount ?? 0}/${sc.prepared}` : ''));
    for (const g of s.innate || []) rows.push(aspect(g.source || 'Innate', `${String(g.ability).toUpperCase()} · DC ${g.dc} · attack ${fmt(g.attack)} · ${(g.spells || []).map((id) => entryName('spell', id)).join(', ')}`));
    const sl = s.slots.map((n, i) => (n ? `L${i + 1} ${Math.max(0, n - (c.slotsUsed[i] || 0))}/${n}` : null)).filter(Boolean);
    if (sl.length) rows.push(aspect('Slots left', sl.join(' · ')));
    if (s.pact) rows.push(aspect('Pact slots', `${Math.max(0, s.pact.slots - (c.pactUsed || 0))}/${s.pact.slots} at level ${s.pact.level}`));
    const magicItems = (s.items || []).filter((i) => i.magic || i.kind === 'magic-item');
    if (magicItems.length) rows.push(aspect('Magic items', chipList(magicItems.map((i) => `${i.name}${i.attuned ? ' (attuned)' : i.requiresAttunement ? ' (not attuned)' : ''}`))));
    if (!rows.length) rows.push(aspect('Spellcasting', h('span', { class: 'faint' }, 'none')));
  } else if (tag === 'attack') {
    const n = attacksPerAction(s.features);
    rows.push(aspect('Attack action', `${n} attack${n === 1 ? '' : 's'}${n > 1 ? ' (Extra Attack)' : ''}`));
    rows.push(aspect('Attacks', s.attacks.length ? h('span', { class: 'ch-aspect-chips' }, s.attacks.map((a) => h('button', { class: 'chip', type: 'button', title: `Roll to hit with ${a.name}`, onclick: () => rollToast(`${a.name} to hit`, a.bonus) }, `${a.name} ${fmt(a.bonus)} · ${a.damage || ''} ${prettify(a.damageType || '')}`.trim()))) : h('span', { class: 'faint' }, '—')));
    rows.push(aspect('Initiative', fmt(s.initiative)));
  } else if (tag === 'weaponry') {
    rows.push(aspect('Proficient with', chipList([...new Set(s.proficiencies.weapons)].map((id) => profName('weapons', id)))));
    if ((s.weaponMasteries || []).length) rows.push(aspect('Masteries', chipList(s.weaponMasteries.map((id) => { const w = findEntry('weapon', id); return w ? `${w.name} (${prettify(w.mastery)})` : prettify(id); }))));
    const eq = s.attacks.filter((a) => a.uid);
    rows.push(aspect('Equipped', chipList(eq.map((a) => `${a.name}${a.propertyNames?.length ? ` · ${a.propertyNames.join(', ')}` : ''}`))));
  } else if (tag === 'defense') {
    rows.push(aspect('Armor Class', adjustedValue(s, 'ac', String(s.ac.value)), s.ac.formula ? h('span', { class: 'muted' }, ` · ${s.ac.formula}`) : null));
    rows.push(aspect('Hit points', `${c.hp.current ?? s.hpMax} / ${s.hpMax}${Number(c.hp.temp) ? ` (+${c.hp.temp} temp)` : ''}`));
    rows.push(aspect('Save proficiencies', chipList(ABILITIES.filter((a) => s.abilities[a.id]?.saveProf).map((a) => `${a.name} ${fmt(s.abilities[a.id].save)}`))));
    if ((s.resistances || []).length) rows.push(aspect('Resistances', chipList(s.resistances.map((r) => prettify(typeof r === 'object' ? r.type || r.id : r)))));
    if (s.armorWorn || s.shield) rows.push(aspect('Worn', [s.armorWorn?.name, s.shield ? (s.shield.name || 'Shield') : null].filter(Boolean).join(' + ')));
  } else if (tag === 'advantages') {
    const conds = conditionList().filter((x) => c.conditions.includes(x.id));
    const src = advantageSources(s, { conditions: conds });
    const adv = src.filter((x) => x.kind !== 'disadvantage');
    const dis = src.filter((x) => x.kind !== 'advantage');
    const li = (x) => h('li', null, h('strong', null, `${x.source}: `), x.text);
    rows.push(aspect('Advantage', adv.length ? h('ul', { class: 'ch-aspect-list', role: 'list' }, adv.map(li)) : h('span', { class: 'faint' }, '—')));
    rows.push(aspect('Disadvantage', dis.length ? h('ul', { class: 'ch-aspect-list', role: 'list' }, dis.map(li)) : h('span', { class: 'faint' }, '—')));
  } else if (tag === 'interaction') {
    rows.push(aspect('Social skills', chipList(['persuasion', 'deception', 'intimidation', 'performance', 'insight'].map(skill).filter(Boolean))));
    rows.push(aspect('Languages', chipList((s.languageNames?.length ? s.languageNames : s.languages).map(String))));
  } else if (tag === 'leveling') {
    const xs = xpStatus(c, R());
    rows.push(aspect('Experience', xs.atMax ? `level ${xs.level} (max)` : `${xs.xp.toLocaleString('en-US')} / ${Number(xs.next).toLocaleString('en-US')} XP${xs.due ? ` · ${xs.due} level${xs.due === 1 ? '' : 's'} due` : ` · ${xs.toNext.toLocaleString('en-US')} to level ${xs.levelForNext}`}`));
    const cls = lastLeveledClass(c);
    if (cls && xs.level < 20) {
      let plan = null;
      try { plan = luPlan(c, cls); } catch { plan = null; }
      if (plan) {
        const slotUp = plan.slotsAfter && plan.slotsBefore ? plan.slotsAfter.map((n, i) => (n > (plan.slotsBefore[i] || 0) ? `L${i + 1} +${n - (plan.slotsBefore[i] || 0)}` : null)).filter(Boolean) : [];
        rows.push(aspect(`Next: ${entryName('class', cls)} ${plan.newLevel}`, [
          plan.features.length ? plan.features.map((f) => f.name || prettify(f.id)).join(', ') : 'no new features',
          plan.hpAverage ? ` · +${plan.hpAverage} HP avg` : '', slotUp.length ? ` · slots ${slotUp.join(', ')}` : '',
          plan.choices?.length ? ` · ${plan.choices.length} choice${plan.choices.length === 1 ? '' : 's'}` : ''].join(''), ' ',
        h('button', { class: 'ch-link-btn', type: 'button', onclick: () => levelUp({ fromXp: true }) }, 'Level up…')));
      }
    }
    if (s.pending.length) rows.push(aspect('Open choices', s.pending.slice(0, 6).map((p) => p.label || prettify(p.featureId)).join(', '), s.pending.length > 6 ? '…' : '', ' ', h('a', { href: editHref('choices') }, 'Make choices')));
  } else if (tag === 'healing') {
    rows.push(aspect('Hit dice', s.hitDice.length ? s.hitDice.map((hd) => `d${hd.die} ${hd.total - hd.used}/${hd.total}`).join(' · ') : '—'));
    const heals = spellRows(c, s).filter((r) => r.stats?.heal && (r.prepared || r.always || r.level === 0));
    if (heals.length) rows.push(aspect('Healing spells', chipList(heals.map((r) => `${r.name} ${r.stats.heal.text}`))));
  } else if (tag === 'movement') {
    rows.push(aspect('Speed', Object.entries(s.speed).filter(([, x]) => x).map(([k, x]) => `${k === 'walk' ? 'Walk' : prettify(k)} ${x} ft`).join(' · ') || '—'));
  } else if (tag === 'senses') {
    rows.push(aspect('Senses', s.sensesList?.length ? s.sensesList.join(', ') : 'normal vision'));
    rows.push(aspect('Passive', `Perception ${s.passive.perception} · Insight ${s.passive.insight} · Investigation ${s.passive.investigation}`));
  } else if (tag === 'exploration') {
    rows.push(aspect('Skills', chipList(['stealth', 'survival', 'perception', 'investigation', 'athletics', 'acrobatics', 'sleight-of-hand', 'nature'].map(skill).filter(Boolean))));
    rows.push(aspect('Tools', chipList([...new Set(s.proficiencies.tools)].map((id) => profName('tools', id)))));
  } else if (tag === 'skills') {
    rows.push(aspect('Proficient', chipList(skillList().filter((k) => s.skills[k.id]?.prof || s.skills[k.id]?.expertise).map((k) => skill(k.id)))));
  } else if (tag === 'reactions') {
    const rs = spellRows(c, s).filter((r) => /reaction/i.test(r.entry?.castingTime || '') && (r.prepared || r.always || r.level === 0));
    rows.push(aspect('Reaction spells', chipList(rs.map((r) => r.name))));
    rows.push(aspect('Always', 'Opportunity Attack (when a creature you can see leaves your reach)'));
  } else if (tag === 'resources') {
    if (!s.resources.length) return null;
    rows.push(...s.resources.map((r) => aspect(r.label, resourcePips(r), r.recharge ? h('span', { class: 'muted' }, ` ${r.recharge === 'short' ? 'short rest' : 'long rest'}`) : null)));
  }
  return rows.length ? h('dl', { class: 'ch-aspect-grid' }, rows) : null;
}

function setAllFeatures(open) {
  S.root.querySelectorAll('details.ch-feat').forEach((d) => { d.open = open; });
}

function feature(f, choiceByKey, resByKey, tags = [], fav = false) {
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
    if (tags.length) {
      body.append(h('p', { class: 'ch-feat-tags ui text-xs' }, tags.map((t) => h('button', {
        class: 'ch-feat-tag', type: 'button', title: 'Show everything with this tag (Smart view)', onclick: () => setFeatView({ view: 'smart', tag: t }),
      }, TAGS.find((x) => x.id === t)?.label || t))));
    }
  };
  const det = h('details', { class: 'ch-feat', 'data-stat': fid, open: S.openFeatures.has(fid) },
    h('summary', null,
      fav ? favMark() : null,
      h('span', { class: 'ch-feat-name' }, f.name),
      f.levels?.length > 1 ? h('span', { class: 'badge' }, `Lv ${f.levels.join(', ')}`) : f.level ? h('span', { class: 'badge' }, `Lv ${f.level}`) : null,
      f.via ? h('span', { class: 'ch-feat-pick' }, `via ${f.via}`) : null,
      picks ? h('span', { class: 'ch-feat-pick' }, picks) : choice ? h('span', { class: 'badge badge-warn' }, 'choose') : null,
      h('span', { class: 'spacer' }),
      res ? resourcePips(res, true) : null),
    body,
    // The open row is the feature's own menu: its Favorite toggle (repaints the sheet) and, if any, its choice
    h('div', { class: 'ch-feat-choice row' }, favButton('features', featureFavKey(f), f.name),
      choice ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openChoice(choice) }, icon('edit'), picks ? 'Change choice' : 'Choose') : null));
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

function resourcePips(r, compact = false, fkSuffix = compact ? '-c' : '') {
  const max = Number(r.max) || 0;
  if (!max) return null;
  const set = (u) => mutate((y) => { y.resourcesUsed[r.key] = Math.max(0, Math.min(max, u)); });
  if (max > 10) {
    return h('span', { class: 'ch-res-num', onclick: (e) => { if (compact) e.preventDefault(); e.stopPropagation(); } },
      numberInput(Math.max(0, max - (r.used || 0)), (v) => set(max - (v ?? max)), { class: 'input input-sm ch-w-num', min: 0, max, 'aria-label': `${r.label} remaining`, 'data-fk': `res-${r.key}${fkSuffix}` }),
      h('span', { class: 'muted ui text-xs' }, ` / ${max}`));
  }
  const p = pips({ max, used: r.used, label: r.label, fk: `res-${r.key}${fkSuffix}`, onChange: set });
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

// ---------- proficiency labels (pickers + entry modals; logic in engine-prof.js) ----------

/** Fit of a compendium entry for this character; `item` = the inventory row (magic items use its base weapon/armor). */
function fitOf(entry, { item = null } = {}) {
  const s = S.sheet;
  const c = S.char;
  if (!s || !entry) return { badges: [], lines: [] };
  const resolved = item ? (s.items || []).find((x) => x.uid === item.uid) : null;
  const baseId = item?.custom?.base;
  const base = resolved?.weapon ? { ...resolved.weapon, kind: 'weapon', name: resolved.weapon.name || entryName('weapon', resolved.weapon.id) }
    : resolved?.armor ? { ...resolved.armor, kind: 'armor', name: resolved.armor.name || entryName('armor', resolved.armor.id) }
      : baseId ? (findEntry('weapon', baseId) || findEntry('armor', baseId)) : null;
  try { return entryFit(entry, s, { base, speciesName: c?.species?.id ? entryName('species', c.species.id) : '' }); } catch (e) { console.error(e); return { badges: [], lines: [] }; }
}

/** Picker row badges: proficiency, mastery, attunement, known spells… */
const fitMarks = (entry) => fitOf(entry).badges;

/** The short "for this character" block at the top of an entry modal. */
function fitBlock(entry, opts) {
  const f = fitOf(entry, opts);
  if (!f.badges.length && !f.lines.length) return null;
  return h('div', { class: 'ch-fit' },
    f.badges.length ? h('div', { class: 'ch-fit-badges' }, h('span', { class: 'ch-fit-who' }, S.char?.name || 'You'),
      f.badges.map((b) => h('span', { class: ['badge', { ok: 'badge-ok', warn: 'badge-warn', info: 'badge-info' }[b.tone] || ''], title: b.title || null }, b.label))) : null,
    f.lines.length ? h('ul', { class: 'ch-fit-lines', role: 'list' }, f.lines.map((l) => h('li', { class: `is-${l.tone}` }, l.text))) : null);
}

/**
 * Entry modal from the sheet: what this means for the character, then the stat block (+ Favorite for an owned item
 * or, opts.spell = its row, a spell on the sheet).
 */
function entryInfo(entry, opts = {}) {
  if (!entry) return null;
  const it = opts.item && S.char?.inventory.some((x) => x.uid === opts.item.uid) ? opts.item : null;
  const spKey = opts.spell ? spellFavKey(opts.spell) : '';
  const sp = spKey && (S.sheet?.spells || []).some((x) => spellFavKey(x) === spKey) ? opts.spell : null;
  return openModal({
    title: entry.name, wide: true,
    body: h('div', { class: 'ch-entry-info' }, it ? favRow('items', it.uid, it.name || entry.name) : sp ? favRow('spells', spKey, sp.name || entry.name) : null,
      fitBlock(entry, opts), renderEntry(entry)),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
}

async function addItems(kinds = ITEM_KINDS) {
  const res = await openPicker(kinds, { title: 'Add to inventory', multi: true, mark: fitMarks });
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
  const favs = favSet(c, 'items');
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
    h('tbody', null, favoritesFirst(c.inventory, (it) => favs.has(it.uid)).map((it) => {
      const e = findEntry(it.kind, it.ref);
      const resolved = (s.items || []).find((x) => x.uid === it.uid);
      const canAttune = !!(resolved?.requiresAttunement || e?.attunement || it.custom?.attunement || it.attuned);
      const canEquip = ['weapon', 'armor', 'magic-item'].includes(it.kind) || !!it.equipped;
      return h('tr', { 'data-stat': it.uid, class: it.equipped ? 'is-equipped' : null },
        h('td', { class: 'center' }, canEquip ? h('input', { type: 'checkbox', class: 'checkbox', checked: !!it.equipped, 'aria-label': `Equip ${it.name}`, 'data-fk': `eq-${it.uid}`, onchange: (ev) => mutate((y) => { const t = y.inventory.find((x) => x.uid === it.uid); if (t) t.equipped = ev.target.checked; }) }) : null),
        h('td', { class: 'center' }, canAttune ? h('input', { type: 'checkbox', class: 'checkbox', checked: !!it.attuned, 'aria-label': `Attune ${it.name}`, 'data-fk': `at-${it.uid}`, onchange: (ev) => mutate((y) => { const t = y.inventory.find((x) => x.uid === it.uid); if (t) t.attuned = ev.target.checked; }) }) : null),
        h('td', { class: 'cell-name' }, favs.has(it.uid) ? favMark() : null,
          e ? h('button', { class: 'ch-link-btn', type: 'button', onclick: () => entryInfo(e, { item: it }) }, it.name || e.name) : (it.name || prettify(it.ref)),
          h('span', { class: 'ch-inv-kind' }, [e ? entryKindLabel(e) : prettify(it.kind), e?.origin === 'custom' ? 'custom' : ''].filter(Boolean).join(' · ')),
          it.notes ? h('div', { class: 'ch-inv-notes' }, mdInline(it.notes)) : null),
        h('td', { class: 'num' }, numberInput(it.qty, (v) => mutate((y) => { const t = y.inventory.find((x) => x.uid === it.uid); if (t) t.qty = Math.max(0, v ?? 0); }), { class: 'input input-sm ch-w-num', min: 0, 'aria-label': `Quantity of ${it.name}`, 'data-fk': `qty-${it.uid}` })),
        h('td', { class: 'num cell-muted' }, itemWeight(it) ? `${round(itemWeight(it))} lb` : '—'),
        h('td', { class: 'cell-actions' },
          h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Edit ${it.name}`, title: 'Edit', onclick: () => editItem(it) }, icon('edit')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove ${it.name}`, title: 'Remove', onclick: async () => { if (await confirmDialog(`Remove ${it.name} from the inventory?`, { okLabel: 'Remove', danger: true })) mutate((y) => { y.inventory = y.inventory.filter((x) => x.uid !== it.uid); toggleFavorite(y, 'items', it.uid, false); }); } }, icon('trash'))));
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
      favRow('items', it.uid, it.name || e?.name || 'this item'), // saved at once, like the sheet's own ticks
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
      e ? fitBlock(e, { item: it }) : null,
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
