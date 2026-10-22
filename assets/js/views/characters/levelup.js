// Level Up dialog: pick the class to advance (or multiclass, gated by canMulticlass), review the
// levelUpPlan (features, HP, slots), answer the new choice menus, then applyLevelUp.
// XP aware: says when the level comes from experience ("1 of 3" when several are due, see levelUpFlow) or is a
// milestone level (offers to raise XP to the new level's minimum). openLevelDown: the reverse, with a list of what
// goes (features, choices, HP, slots, spells) and an offer to reset XP.
import { h, mount } from '../../core/dom.js';
import { icon, openModal, toast } from '../../core/ui.js';
import { clone } from '../../core/util.js';
import { totalLevel, prettify, normalize } from './data.js';
import {
  cat, findEntry, entryName, derive, levelUpPlan, applyLevelUp, canMulticlass, allChoices, pendingChoices, R, engine, rules as engineRules,
  levelDown as bridgeLevelDown,
} from './bridge.js';
import { renderChoiceGroups, isAnswered, currentValue, valueNames } from './choices.js';
import { md, rollDie, fmt } from './widgets.js';
import { xpStatus, xpForLevel, setXp, lastLeveledClass, xpAfterLevelChange } from './engine-xp.js';

const n = (v) => (Number(v) || 0).toLocaleString('en-US');

/**
 * Level up once per due level: opens openLevelUp, and after each applied level opens the next while XP still has
 * levels due (fromXp). onApply(next) runs after every level.
 */
export function levelUpFlow(char, { onApply, fromXp = true } = {}) {
  const due = xpStatus(char, R()).due;
  const total = fromXp && due > 1 ? due : 1;
  const step = (doc, index) => openLevelUp(doc, {
    chain: total > 1 ? { index, total } : null,
    onApply: (next) => {
      onApply?.(next);
      if (index < total && xpStatus(next, R()).due > 0 && totalLevel(next) < 20) setTimeout(() => step(next, index + 1), 60);
    },
  });
  return step(char, 1);
}

/** openLevelUp(char, {onApply(nextChar), classId, chain:{index,total}}) */
export function openLevelUp(char, { onApply, classId: preset, chain = null } = {}) {
  const total = totalLevel(char);
  if (total >= 20) { toast('Already level 20.'); return null; }
  const defaultClass = preset || (Array.isArray(char.levelOrder) && char.levelOrder.length ? lastLeveledClass(char) : null) || char.classes[0]?.id || null;
  const st = { classId: defaultClass, hpMode: 'average', hpRoll: null, work: null, plan: null };
  st.beforePending = new Set((() => { try { return pendingChoices(char).map((c) => c.key); } catch { return []; } })());
  // XP context: earned by experience, or a milestone level (XP below the new level's minimum)
  const xs = xpStatus(char, R());
  const need = total >= 1 ? xpForLevel(total + 1, R()) : 0;
  const milestone = total >= 1 && xs.due === 0;
  st.raiseXp = milestone && xs.xp < need;
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

  function xpBanner() {
    if (total < 1) return null;
    if (xs.due > 0) {
      const more = chain ? chain.total - chain.index : xs.due - 1;
      return h('div', { class: 'callout ch-lu-xp', 'data-callout': 'success' },
        h('div', { class: 'callout-title' }, chain ? `Level up ${chain.index} of ${chain.total} — from experience` : 'Level up from experience'),
        h('div', { class: 'callout-content' }, h('p', null, `${n(xs.xp)} XP reaches level ${xs.xpLevel}.`,
          more > 0 ? ` ${more} more level${more === 1 ? '' : 's'} ${chain ? (more === 1 ? 'follows' : 'follow') : (more === 1 ? 'is due' : 'are due')} after this one${chain ? '' : ' — level up again when you’re done'}.` : '')));
    }
    return h('div', { class: 'callout ch-lu-xp', 'data-callout': 'info' },
      h('div', { class: 'callout-title' }, 'Milestone level-up'),
      h('div', { class: 'callout-content stack stack-sm' },
        h('p', null, `Levelling without the experience: ${n(xs.xp)} XP${need ? ` (level ${total + 1} normally needs ${n(need)})` : ''}.`),
        xs.xp < need ? h('label', { class: 'checkbox' },
          h('input', { type: 'checkbox', checked: st.raiseXp, 'data-fk': 'lu-raise-xp', onchange: (e) => { st.raiseXp = e.target.checked; } }),
          h('span', null, `Raise XP to ${n(need)}, the level ${total + 1} minimum, so the XP bar stays in step`)) : null));
  }

  function draw() {
    const opts = classOptions();
    const s = st.work ? derive(st.work) : null;
    const choices = st.work ? levelChoices() : [];
    const unanswered = choices.filter((c) => !isAnswered(c, currentValue(c, st.work))).length;
    mount(body,
      xpBanner(),
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
    let next = st.work;
    if (milestone && st.raiseXp && xs.xp < need) next = setXp(next, need, { note: `Milestone: level ${total + 1}` });
    onApply?.(next);
    return true;
  }

  build();
  const m = openModal({ title: chain ? `Level up (${chain.index} of ${chain.total})` : 'Level up', wide: true, body, actions: [{ label: 'Cancel', kind: 'ghost' }, applyBtn] });
  draw();
  return m;
}

// ---------- level down ----------

function downPlan(char, classId) {
  const E = engine();
  const RR = engineRules();
  if (E?.levelDownPlan && RR) {
    try { return E.levelDownPlan(char, RR, classId); } catch (e) { console.error('[characters] levelDownPlan failed', e); }
  }
  const row = char.classes.find((r) => r.id === classId);
  const next = bridgeLevelDown(char, classId);
  const removesClass = !next.classes.some((r) => r.id === classId);
  const hpBefore = derive(char).hpMax;
  const hpAfter = derive(next).hpMax;
  return {
    classId, className: entryName('class', classId), fromLevel: row?.level || 0, toLevel: (row?.level || 1) - 1, removesClass, allowed: !!row,
    totalBefore: totalLevel(char), totalAfter: totalLevel(next), features: [], choices: [], hpBefore, hpAfter, hpLost: Math.max(0, hpBefore - hpAfter),
    spellsAtRisk: removesClass ? char.spells.filter((x) => x.class === classId).map((x) => ({ id: x.id, name: entryName('spell', x.id), level: Number(findEntry('spell', x.id)?.level) || 0, reason: 'class removed' })) : [],
    next,
  };
}

/** openLevelDown(char, {onApply(nextChar), classId}) — confirm, listing what that level takes away. */
export function openLevelDown(char, { onApply, classId: preset } = {}) {
  const total = totalLevel(char);
  if (!total) { toast('There is no level to remove.'); return null; }
  const latestKnown = Array.isArray(char.levelOrder) && char.levelOrder.length ? lastLeveledClass(char) : null;
  const st = { classId: preset && char.classes.some((r) => r.id === preset) ? preset : lastLeveledClass(char), removeSpells: true, resetXp: true, plan: null };
  const body = h('div', { class: 'ch-lu ch-ld' });
  const sheetBefore = derive(char);

  function draw() {
    st.plan = downPlan(char, st.classId);
    const p = st.plan;
    const xpFix = xpAfterLevelChange(char.xp, p.totalAfter, 'down', R());
    const slotsChanged = p.slotsBefore && p.slotsAfter && JSON.stringify(p.slotsBefore) !== JSON.stringify(p.slotsAfter);
    const pactChanged = JSON.stringify(p.pactBefore ? [p.pactBefore.slots, p.pactBefore.level] : null) !== JSON.stringify(p.pactAfter ? [p.pactAfter.slots, p.pactAfter.level] : null);
    const resLost = (p.resourcesBefore || []).map((b) => ({ b, a: (p.resourcesAfter || []).find((x) => x.key === b.key) }))
      .filter(({ b, a }) => (Number(a?.max) || 0) < (Number(b.max) || 0));
    const lost = [
      p.hpLost ? h('li', null, h('strong', null, 'Hit points: '), `−${p.hpLost} maximum (${p.hpBefore} → ${p.hpAfter})`) : null,
      p.subclass ? h('li', null, h('strong', null, 'Subclass: '), entryName('subclass', p.subclass)) : null,
      p.features?.length ? h('li', null, h('strong', null, `Feature${p.features.length === 1 ? '' : 's'}: `),
        p.features.map((f) => `${f.name || prettify(f.id)}${f.source ? ` (${f.source})` : ''}`).join(', ')) : null,
      ...(p.choices || []).map((x) => {
        const names = x.choice ? (() => { try { return valueNames(x.choice, x.value, { char, sheet: sheetBefore }); } catch { return ''; } })() : '';
        return h('li', null, h('strong', null, `${x.label}: `), names || (typeof x.value === 'string' ? prettify(x.value) : 'your pick'));
      }),
      ...(p.trimmed || []).map((x) => {
        const names = x.choice ? (() => { try { return valueNames(x.choice, x.removed, { char, sheet: sheetBefore }); } catch { return ''; } })() : '';
        return h('li', null, h('strong', null, `${x.label}: `), `${x.before} → ${x.after}; the newest go: ${names || x.removed.map(prettify).join(', ')}`);
      }),
      p.alwaysLost?.length ? h('li', null, h('strong', null, 'Always-prepared spells: '), p.alwaysLost.map((x) => x.name).join(', ')) : null,
      p.cantripsBefore > p.cantripsAfter ? h('li', null, h('strong', null, 'Cantrips known: '), `${p.cantripsBefore} → ${p.cantripsAfter}`) : null,
      p.preparedBefore > p.preparedAfter ? h('li', null, h('strong', null, 'Prepared spells: '), `${p.preparedBefore} → ${p.preparedAfter}`) : null,
      p.maxSpellLevelBefore > p.maxSpellLevelAfter ? h('li', null, h('strong', null, 'Highest spell level: '), `${p.maxSpellLevelBefore} → ${p.maxSpellLevelAfter || 'none'}`) : null,
      pactChanged ? h('li', null, h('strong', null, 'Pact Magic: '), `${p.pactBefore ? `${p.pactBefore.slots} × level ${p.pactBefore.level}` : 'none'} → ${p.pactAfter ? `${p.pactAfter.slots} × level ${p.pactAfter.level}` : 'none'}`) : null,
      ...resLost.map(({ b, a }) => h('li', null, h('strong', null, `${b.label}: `), `${b.max} → ${Number(a?.max) || 0}`)),
      p.profBonusBefore != null && p.profBonusBefore !== p.profBonusAfter ? h('li', null, h('strong', null, 'Proficiency bonus: '), `${fmt(p.profBonusBefore)} → ${fmt(p.profBonusAfter)}`) : null,
    ].filter(Boolean);
    const others = char.classes.length > 1;
    mount(body,
      others ? h('div', { class: 'ch-lu-classes' },
        h('h3', { class: 'ch-mini-head' }, 'Which class loses a level?'),
        h('div', { class: 'ch-cards' }, char.classes.map((row) => h('button', {
          type: 'button', class: ['ch-optcard', row.id === st.classId && 'is-selected'], 'aria-pressed': String(row.id === st.classId),
          onclick: () => { st.classId = row.id; draw(); },
        },
        h('span', { class: 'ch-optcard-head' }, h('span', { class: 'ch-opt-name' }, entryName('class', row.id)),
          h('span', { class: 'badge' }, row.level > 1 ? `${row.level} → ${row.level - 1}` : 'removed'),
          row.id === latestKnown ? h('span', { class: 'badge badge-info', title: 'The class that gained the most recent level' }, 'latest') : null),
        row.subclass ? h('span', { class: 'ch-optcard-desc' }, entryName('subclass', row.subclass)) : null)))) : null,
      h('div', { class: 'ch-lu-summary' },
        h('span', { class: 'ch-lu-big' }, p.removesClass ? `${p.className} ${p.fromLevel} → class removed` : `${p.className} ${p.fromLevel} → ${p.toLevel}`),
        h('span', { class: 'muted' }, `Character level ${p.totalBefore} → ${p.totalAfter}`)),
      p.totalAfter === 0 ? h('div', { class: 'callout', 'data-callout': 'warning' },
        h('div', { class: 'callout-title' }, 'This removes the only class'),
        h('div', { class: 'callout-content' }, h('p', null, 'The character goes back to level 0; choose a class again with Level up.'))) : null,
      h('div', null,
        h('h3', { class: 'ch-mini-head' }, 'What this level takes away'),
        lost.length ? h('ul', { class: 'ch-ld-list ui text-sm' }, lost) : h('p', { class: 'muted ui text-sm' }, 'Nothing beyond the level itself.'),
        slotsChanged ? h('div', { class: 'ch-ld-slots' }, h('h4', { class: 'ch-mini-head' }, 'Spell slots'), slotTable(p.slotsBefore, p.slotsAfter, { down: true })) : null),
      p.spellsAtRisk?.length ? h('label', { class: 'checkbox ch-ld-opt' },
        h('input', { type: 'checkbox', checked: st.removeSpells, onchange: (e) => { st.removeSpells = e.target.checked; } }),
        h('span', null, p.removesClass ? `Also remove the ${p.className}’s ${p.spellsAtRisk.length} spell${p.spellsAtRisk.length === 1 ? '' : 's'}: ` : `Also remove ${p.spellsAtRisk.length} spell${p.spellsAtRisk.length === 1 ? '' : 's'} above the new highest level: `,
          h('strong', null, p.spellsAtRisk.map((x) => `${x.name} (${x.level ? `level ${x.level}` : 'cantrip'})`).join(', ')))) : null,
      xpFix.changed ? h('div', { class: 'stack stack-sm' },
        h('label', { class: 'checkbox ch-ld-opt' },
          h('input', { type: 'checkbox', checked: st.resetXp, 'data-fk': 'ld-reset-xp', onchange: (e) => { st.resetXp = e.target.checked; } }),
          h('span', null, `Reset XP from ${n(char.xp)} to ${n(xpFix.xp)}, the level ${Math.max(1, p.totalAfter)} minimum`)),
        h('p', { class: 'muted ui text-xs ch-ld-hint' }, `Otherwise ${n(char.xp)} XP still reaches a higher level and the sheet keeps offering a level up.`)) : null);
  }

  function apply() {
    const p = st.plan;
    if (!p?.allowed) return false;
    let next = clone(p.next);
    next.choices = next.choices || {};
    if (p.removesClass) {
      // the whole class goes: also its level-1 picks (skills, tools)
      for (const k of Object.keys(next.choices)) if (k.includes(`@${p.classId}:`)) delete next.choices[k];
      if (!(next.classes || []).length) next.skills = [];
    }
    if (st.removeSpells && p.spellsAtRisk?.length) {
      const ids = new Set(p.spellsAtRisk.map((x) => x.id));
      next.spells = (next.spells || []).filter((x) => !(x.class === p.classId && ids.has(x.id)));
    }
    const xpFix = xpAfterLevelChange(char.xp, p.totalAfter, 'down', R());
    if (st.resetXp && xpFix.changed) next = setXp(next, xpFix.xp, { note: `Level down to ${p.totalAfter}` });
    onApply?.(normalize(next));
    return true;
  }

  draw();
  return openModal({ title: 'Level down', wide: true, body, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Level down', kind: 'danger', onClick: () => apply() }] });
}

function slotTable(before = [], after = [], { down = false } = {}) {
  const levels = [];
  for (let i = 0; i < 9; i++) if ((before[i] || 0) || (after[i] || 0)) levels.push(i);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense' },
    h('thead', null, h('tr', null, h('th', null, ''), levels.map((i) => h('th', { class: 'num' }, `L${i + 1}`)))),
    h('tbody', null,
      h('tr', null, h('td', { class: 'cell-muted' }, 'Before'), levels.map((i) => h('td', { class: 'num' }, String(before[i] || 0)))),
      h('tr', null, h('td', { class: 'cell-name' }, 'After'), levels.map((i) => h('td', { class: ['num', down ? (after[i] || 0) < (before[i] || 0) && 'danger-text' : (after[i] || 0) > (before[i] || 0) && 'accent'] }, String(after[i] || 0)))))));
}
