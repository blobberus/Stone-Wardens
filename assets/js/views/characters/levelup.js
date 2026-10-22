// Level Up dialog: pick the class to advance (or multiclass, gated by canMulticlass), review the
// levelUpPlan (features, HP, slots), answer the new choice menus, then applyLevelUp.
import { h, mount } from '../../core/dom.js';
import { icon, openModal, toast } from '../../core/ui.js';
import { clone } from '../../core/util.js';
import { totalLevel, prettify } from './data.js';
import { cat, findEntry, entryName, derive, levelUpPlan, applyLevelUp, canMulticlass, allChoices, pendingChoices } from './bridge.js';
import { renderChoiceGroups, isAnswered, currentValue } from './choices.js';
import { md, rollDie, fmt } from './widgets.js';

/** openLevelUp(char, {onApply(nextChar)}) */
export function openLevelUp(char, { onApply, classId: preset } = {}) {
  const total = totalLevel(char);
  if (total >= 20) { toast('Already level 20.'); return null; }
  const st = { classId: preset || char.classes[0]?.id || null, hpMode: 'average', hpRoll: null, work: null, plan: null };
  st.beforePending = new Set((() => { try { return pendingChoices(char).map((c) => c.key); } catch { return []; } })());
  const body = h('div', { class: 'ch-lu' });
  const applyBtn = { label: 'Apply level', kind: 'primary', onClick: () => apply() };

  function build() {
    if (!st.classId) { st.plan = null; st.work = null; return; }
    st.plan = levelUpPlan(char, st.classId);
    const first = total === 0;
    const hpRoll = first ? st.plan.hitDie : st.hpMode === 'average' ? st.plan.hpAverage : st.hpRoll ?? st.plan.hpAverage;
    const prev = st.work;
    st.error = null;
    try {
      st.work = applyLevelUp(char, st.classId, { hpRoll });
    } catch (e) {
      st.work = null;
      st.error = e.message || String(e);
      return;
    }
    if (prev) {
      // carry the picks made so far across an HP change
      for (const [k, v] of Object.entries(prev.choices || {})) if (JSON.stringify(char.choices?.[k]) !== JSON.stringify(v)) st.work.choices[k] = clone(v);
      prev.classes.forEach((pc) => { const row = st.work.classes.find((x) => x.id === pc.id); if (row && pc.subclass) row.subclass = pc.subclass; });
      if (prev.species) st.work.species = clone(prev.species);
    }
  }

  function levelChoices() {
    const w = st.work;
    if (!w) return [];
    const row = w.classes.find((x) => x.id === st.classId);
    const lvl = row?.level || st.plan.newLevel;
    const tag = `@${st.classId}:${lvl}`;
    const planKeys = new Set(st.plan.choices.map((c) => c.key));
    let pend = [];
    const ws = derive(w);
    try { pend = pendingChoices(w, ws).map((c) => c.key); } catch { pend = []; }
    const pendKeys = new Set(pend);
    const before = st.beforePending;
    const all = allChoices(w, ws);
    const list = all.filter((c) => String(c.key).includes(tag) || planKeys.has(c.key) || (pendKeys.has(c.key) && !before.has(c.key)));
    // plan choices the engine did not list (defensive)
    for (const c of st.plan.choices) if (!list.some((x) => x.key === c.key)) list.push(c);
    return list;
  }

  function draw() {
    const opts = classOptions();
    const s = st.work ? derive(st.work) : null;
    const choices = st.work ? levelChoices() : [];
    const unanswered = choices.filter((c) => !isAnswered(c, currentValue(c, st.work))).length;
    mount(body,
      h('div', { class: 'ch-lu-classes' },
        h('h3', { class: 'ch-mini-head' }, total ? `Level ${total} → ${total + 1}: which class gains the level?` : 'Choose your first class'),
        h('div', { class: 'ch-cards' }, opts.map((o) => h('button', {
          type: 'button', class: ['ch-optcard', o.id === st.classId && 'is-selected', !o.ok && 'is-blocked'], 'aria-pressed': String(o.id === st.classId),
          disabled: !o.ok, onclick: () => { st.classId = o.id; st.work = null; st.hpRoll = null; build(); draw(); },
        },
        h('span', { class: 'ch-optcard-head' }, h('span', { class: 'ch-opt-name' }, o.name), h('span', { class: ['badge', o.current ? 'badge-info' : ''] }, o.label)),
        o.reasons.length ? h('span', { class: 'ch-optcard-desc danger-text' }, o.reasons.join('; ')) : o.note ? h('span', { class: 'ch-optcard-desc' }, o.note) : null)))),
      st.error ? h('div', { class: 'callout', 'data-callout': 'warning' }, h('div', { class: 'callout-title' }, 'This level can’t be taken'), h('div', { class: 'callout-content' }, h('p', null, st.error))) : null,
      st.plan && st.work ? planView(s, choices, unanswered) : st.error ? null : h('p', { class: 'muted' }, 'Pick a class to see what this level brings.'));
    const btn = body.closest('.modal')?.querySelector('.modal-foot .btn-primary');
    if (btn) { btn.disabled = !st.work; btn.textContent = unanswered ? `Apply level (${unanswered} choice${unanswered === 1 ? '' : 's'} open)` : 'Apply level'; }
  }

  function classOptions() {
    const out = [];
    for (const row of char.classes) {
      const cls = findEntry('class', row.id);
      out.push({ id: row.id, name: cls?.name || prettify(row.id), label: `${row.level} → ${row.level + 1}`, current: true, ok: row.level < 20, reasons: [], note: row.subclass ? entryName('subclass', row.subclass) : '' });
    }
    for (const cls of cat('class')) {
      if (char.classes.some((r) => r.id === cls.id)) continue;
      if (!char.classes.length) { out.push({ id: cls.id, name: cls.name, label: `d${cls.hitDie}`, ok: true, reasons: [], note: (cls.primaryAbility || []).map((a) => a.toUpperCase()).join(cls.primaryAbilityMode === 'and' ? ' & ' : ' / ') }); continue; }
      const mc = canMulticlass(char, cls.id);
      out.push({ id: cls.id, name: cls.name, label: 'Multiclass', ok: mc.ok, reasons: mc.reasons, note: mc.ok ? 'Gains only the multiclass proficiencies' : '' });
    }
    return out;
  }

  function planView(s, choices, unanswered) {
    const p = st.plan;
    const cls = findEntry('class', st.classId);
    const first = p.firstLevel ?? total === 0;
    const con = p.conMod ?? s?.abilities?.con?.mod ?? 0;
    const extra = Number(p.hpBonusPerLevel) || 0;
    const hpGain = (first ? Math.max(1, p.hitDie + con) : Math.max(1, (st.hpMode === 'average' ? p.hpAverage : st.hpRoll ?? p.hpAverage) + con)) + extra;
    const rollIn = h('input', {
      class: 'input input-sm ch-w-num', type: 'number', min: 1, max: p.hitDie, value: st.hpRoll ?? '', placeholder: `1–${p.hitDie}`, 'aria-label': 'Hit die roll', 'data-fk': 'lu-roll',
      onchange: (e) => { st.hpMode = 'roll'; st.hpRoll = Math.max(1, Math.min(p.hitDie, Number(e.target.value) || 1)); build(); draw(); },
    });
    const slotsChanged = p.slotsAfter && JSON.stringify(p.slotsAfter) !== JSON.stringify(p.slotsBefore);
    return h('div', { class: 'stack' },
      h('div', { class: 'ch-lu-summary' },
        h('span', { class: 'ch-lu-big' }, `${cls?.name || prettify(st.classId)} ${p.newLevel}`),
        h('span', { class: 'muted' }, `Character level ${total + 1} · Proficiency ${fmt(s?.profBonus ?? 2)}`)),
      h('div', { class: 'ch-lu-hp panel' },
        h('div', { class: 'panel-body stack stack-sm' },
          h('h3', { class: 'ch-mini-head' }, `Hit points · d${p.hitDie}`),
          first ? h('p', null, `First level: maximum hit die (${p.hitDie}) ${fmt(con)} CON = `, h('strong', null, String(hpGain)), ' HP.')
            : h('div', { class: 'row' },
              h('label', { class: 'checkbox' }, h('input', { type: 'radio', name: 'lu-hp', checked: st.hpMode === 'average', onchange: () => { st.hpMode = 'average'; build(); draw(); } }), h('span', null, `Take the average (${p.hpAverage})`)),
              h('label', { class: 'checkbox' }, h('input', { type: 'radio', name: 'lu-hp', checked: st.hpMode === 'roll', onchange: () => { st.hpMode = 'roll'; if (st.hpRoll == null) st.hpRoll = rollDie(p.hitDie); build(); draw(); } }), h('span', null, 'Roll')),
              rollIn,
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { st.hpMode = 'roll'; st.hpRoll = rollDie(p.hitDie); build(); draw(); } }, icon('d20'), `Roll d${p.hitDie}`),
              h('span', { class: 'ui' }, `${fmt(con)} CON${extra ? ` ${fmt(extra)} other` : ''} → `, h('strong', null, `+${hpGain} HP`))))),
      p.multiclassProficiencies ? h('p', { class: 'ui text-sm' }, h('strong', null, 'Multiclass proficiencies: '),
        [...(p.multiclassProficiencies.armor || []).map(prettify), ...(p.multiclassProficiencies.weapons || []).map(prettify), ...(p.multiclassProficiencies.tools || []).map(prettify)].join(', ') || 'none',
        p.multiclassProficiencies.skills ? ` · choose ${p.multiclassProficiencies.skills.choose} skill` : '') : null,
      p.features.length ? h('div', null,
        h('h3', { class: 'ch-mini-head' }, 'New features'),
        p.features.map((f) => h('details', { class: 'ch-feat', open: p.features.length <= 2 },
          h('summary', null, h('span', { class: 'ch-feat-name' }, f.name || prettify(f.id)), f.source ? h('span', { class: 'badge' }, f.source) : null),
          h('div', { class: 'ch-feat-body' }, md(f.description, { empty: 'See the class description.' }))))) : h('p', { class: 'muted ui text-sm' }, 'No new features at this level.'),
      slotsChanged ? h('div', null, h('h3', { class: 'ch-mini-head' }, 'Spell slots'), slotTable(p.slotsBefore, p.slotsAfter)) : null,
      p.newCantrips || p.newPrepared ? h('p', { class: 'ui' }, [p.newCantrips ? `+${p.newCantrips} cantrip${p.newCantrips === 1 ? '' : 's'}` : '', p.newPrepared ? `+${p.newPrepared} prepared spell${p.newPrepared === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '), ' — choose them on the sheet’s Spells section after applying.') : null,
      choices.length ? h('div', null,
        h('h3', { class: 'ch-mini-head' }, `Choices${unanswered ? ` (${unanswered} open)` : ''}`),
        h('p', { class: 'muted ui text-sm' }, 'You can also leave these for later; they stay listed on the sheet until made.'),
        renderChoiceGroups(choices, { char: st.work, sheet: s, mutate: (fn) => { fn(st.work); draw(); } })) : null);
  }

  function apply() {
    if (!st.work) return false;
    onApply?.(st.work);
    return true;
  }

  build();
  const m = openModal({ title: 'Level up', wide: true, body, actions: [{ label: 'Cancel', kind: 'ghost' }, applyBtn] });
  draw();
  return m;
}

function slotTable(before = [], after = []) {
  const levels = [];
  for (let i = 0; i < 9; i++) if ((before[i] || 0) || (after[i] || 0)) levels.push(i);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense' },
    h('thead', null, h('tr', null, h('th', null, ''), levels.map((i) => h('th', { class: 'num' }, `L${i + 1}`)))),
    h('tbody', null,
      h('tr', null, h('td', { class: 'cell-muted' }, 'Before'), levels.map((i) => h('td', { class: 'num' }, String(before[i] || 0)))),
      h('tr', null, h('td', { class: 'cell-name' }, 'After'), levels.map((i) => h('td', { class: ['num', (after[i] || 0) > (before[i] || 0) && 'accent'] }, String(after[i] || 0)))))));
}
