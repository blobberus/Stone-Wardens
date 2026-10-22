// Ability score generation: standard array, point buy (budget counter), 4d6-drop-lowest roller, manual.
// Shared by the creation builder and the Edit-all menu. `ui` keeps the transient roll pool.
import { h } from '../../core/dom.js';
import { icon, numberInput, select } from '../../core/ui.js';
import { ABILITIES, ABILITY_IDS } from './data.js';
import { R, findEntry } from './bridge.js';
import { fmt, rollDie } from './widgets.js';

const METHODS = [
  { id: 'standard', label: 'Standard array' },
  { id: 'pointbuy', label: 'Point buy' },
  { id: 'roll', label: 'Roll 4d6' },
  { id: 'manual', label: 'Manual' },
];

const STANDARD = () => R().standardArray || [15, 14, 13, 12, 10, 8];
const POINTBUY = () => R().pointBuy || { budget: 27, min: 8, max: 15, cost: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } };

/** Abilities ordered for a class: primary abilities first, then CON, DEX, WIS, CHA, INT, STR. */
export function suggestedOrder(char) {
  const cls = findEntry('class', char.classes?.[0]?.id);
  const prim = cls?.primaryAbility || [];
  const rest = ['con', 'dex', 'wis', 'cha', 'int', 'str'].filter((a) => !prim.includes(a));
  return [...prim, ...rest].filter((a, i, arr) => ABILITY_IDS.includes(a) && arr.indexOf(a) === i);
}

export const pointCost = (scores) => ABILITY_IDS.reduce((n, a) => n + (POINTBUY().cost[String(scores[a])] ?? 99), 0);

export function roll4d6() {
  const dice = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)];
  const sorted = [...dice].sort((a, b) => a - b);
  return { dice, total: sorted[1] + sorted[2] + sorted[3] };
}

function isPermutation(scores, arr) {
  const a = ABILITY_IDS.map((k) => Number(scores[k])).sort((x, y) => x - y);
  const b = [...arr].sort((x, y) => x - y);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Switch method, converting the current scores into something valid for it. */
export function setMethod(char, method, ui) {
  char.abilityMethod = method;
  const base = char.baseAbilities;
  if (method === 'standard' && !isPermutation(base, STANDARD())) {
    const arr = [...STANDARD()].sort((a, b) => b - a);
    suggestedOrder(char).forEach((a, i) => { base[a] = arr[i]; });
  }
  if (method === 'pointbuy') {
    const pb = POINTBUY();
    if (ABILITY_IDS.some((a) => base[a] < pb.min || base[a] > pb.max) || pointCost(base) > pb.budget) ABILITY_IDS.forEach((a) => { base[a] = pb.min; });
  }
  if (method === 'roll' && !ui.rolls?.length) rollAll(char, ui);
}

export function rollAll(char, ui) {
  ui.rolls = Array.from({ length: 6 }, roll4d6);
  const order = suggestedOrder(char);
  const idx = ui.rolls.map((r, i) => [r.total, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  ui.assign = {};
  order.forEach((a, i) => { ui.assign[a] = idx[i]; char.baseAbilities[a] = ui.rolls[idx[i]].total; });
}

/**
 * renderScores({char, sheet, mutate, ui}) — method tabs, generator controls and a breakdown table.
 */
export function renderScores({ char, sheet, mutate, ui }) {
  const method = char.abilityMethod || 'manual';
  const base = char.baseAbilities;
  const tabs = h('div', { class: 'tabs ch-method-tabs', role: 'tablist' }, METHODS.map((m) => h('button', {
    type: 'button', role: 'tab', class: ['tab', m.id === method && 'is-active'], 'aria-selected': String(m.id === method), 'data-fk': `method-${m.id}`,
    onclick: () => mutate((c) => setMethod(c, m.id, ui)),
  }, m.label)));

  let controls;
  if (method === 'standard') {
    const arr = STANDARD();
    controls = h('div', { class: 'stack stack-sm' },
      h('p', { class: 'muted ui text-sm' }, `Assign ${arr.join(', ')} — picking a value already in use swaps the two.`),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => mutate((c) => { c.baseAbilities = { ...c.baseAbilities, str: 0 }; setMethod(c, 'standard', ui); }) }, 'Suggested order for my class'),
      h('div', { class: 'ch-score-grid' }, ABILITIES.map((a) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, a.full),
        select(arr.map((v) => ({ value: v, label: String(v) })), base[a.id], (v) => mutate((c) => {
          const nv = Number(v);
          const other = ABILITY_IDS.find((k) => k !== a.id && Number(c.baseAbilities[k]) === nv);
          if (other) c.baseAbilities[other] = c.baseAbilities[a.id];
          c.baseAbilities[a.id] = nv;
        }), { 'data-fk': `std-${a.id}` })))));
  } else if (method === 'pointbuy') {
    const pb = POINTBUY();
    const spent = pointCost(base);
    const left = pb.budget - spent;
    controls = h('div', { class: 'stack stack-sm' },
      h('p', { class: ['ui', left < 0 ? 'danger-text' : 'muted'] }, h('strong', { class: 'num' }, String(left)), ` of ${pb.budget} points left · scores ${pb.min}–${pb.max} before bonuses`),
      h('div', { class: 'ch-score-grid' }, ABILITIES.map((a) => {
        const v = Number(base[a.id]);
        const nextCost = (pb.cost[String(v + 1)] ?? 99) - (pb.cost[String(v)] ?? 0);
        return h('div', { class: 'field' }, h('span', { class: 'field-label' }, a.full),
          h('span', { class: 'ch-stepper' },
            h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: v <= pb.min, 'aria-label': `Lower ${a.full}`, 'data-fk': `pb-${a.id}-`, onclick: () => mutate((c) => { c.baseAbilities[a.id] = v - 1; }) }, icon('minus')),
            h('span', { class: 'ch-asi-val num' }, String(v)),
            h('button', { class: 'btn-icon btn-sm', type: 'button', disabled: v >= pb.max || nextCost > left, 'aria-label': `Raise ${a.full}`, 'data-fk': `pb-${a.id}+`, onclick: () => mutate((c) => { c.baseAbilities[a.id] = v + 1; }) }, icon('plus'))),
          h('span', { class: 'field-hint' }, `cost ${pb.cost[String(v)] ?? '?'}`));
      })));
  } else if (method === 'roll') {
    const rolls = ui.rolls || [];
    const assign = ui.assign || {};
    controls = h('div', { class: 'stack stack-sm' },
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => mutate((c) => rollAll(c, ui)), 'data-fk': 'roll-all' }, icon('d20'), rolls.length ? 'Reroll all' : 'Roll 4d6 × 6'),
        h('span', { class: 'muted ui text-sm' }, 'Roll four d6 and drop the lowest, six times. Assign each total to an ability.')),
      rolls.length ? h('div', { class: 'ch-rolls' }, rolls.map((r, i) => {
        const low = Math.min(...r.dice);
        let dropped = false;
        return h('span', { class: 'ch-roll' }, h('strong', { class: 'num' }, String(r.total)),
          h('span', { class: 'ch-roll-dice num' }, r.dice.map((d) => { const drop = !dropped && d === low; if (drop) dropped = true; return h('span', { class: drop ? 'is-dropped' : null }, String(d)); })),
          h('span', { class: 'sr-only' }, `roll ${i + 1}`));
      })) : null,
      rolls.length ? h('div', { class: 'ch-score-grid' }, ABILITIES.map((a) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, a.full),
        select(rolls.map((r, i) => ({ value: i, label: `${r.total}  (roll ${i + 1})` })), assign[a.id] ?? '', (v) => mutate((c) => {
          const idx = Number(v);
          const other = ABILITY_IDS.find((k) => k !== a.id && ui.assign[k] === idx);
          if (other != null) { ui.assign[other] = ui.assign[a.id]; c.baseAbilities[other] = rolls[ui.assign[other]]?.total ?? c.baseAbilities[other]; }
          ui.assign[a.id] = idx;
          c.baseAbilities[a.id] = rolls[idx].total;
        }), { 'data-fk': `roll-${a.id}` })))) : null);
  } else {
    controls = h('div', { class: 'ch-score-grid' }, ABILITIES.map((a) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, a.full),
      numberInput(base[a.id], (v) => mutate((c) => { c.baseAbilities[a.id] = Math.max(1, Math.min(30, v ?? 10)); }), { min: 1, max: 30, 'data-fk': `man-${a.id}` }))));
  }

  const bg = char.background?.abilityBonuses || {};
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense ch-score-table' },
    h('thead', null, h('tr', null, h('th', null, 'Ability'), h('th', { class: 'num' }, 'Base'), h('th', { class: 'num' }, 'Background'), h('th', { class: 'num' }, 'Other'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'Modifier'))),
    h('tbody', null, ABILITIES.map((a) => {
      const score = sheet.abilities[a.id].score;
      const b = Number(bg[a.id]) || 0;
      const other = score - (Number(base[a.id]) || 0) - b;
      return h('tr', null, h('td', { class: 'cell-name' }, a.full), h('td', { class: 'num' }, String(base[a.id])),
        h('td', { class: 'num' }, b ? `+${b}` : '—'), h('td', { class: 'num' }, other ? fmt(other) : '—'),
        h('td', { class: 'num' }, h('strong', null, String(score))), h('td', { class: 'num' }, fmt(sheet.abilities[a.id].mod)));
    }))));
  return h('div', { class: 'stack ch-scores' }, tabs, controls, table,
    h('p', { class: 'field-hint' }, 'Background bonuses are set in the Background step; ability score improvements and feats add the rest.'));
}
