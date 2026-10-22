// Experience: the compact XP meter in the sheet header and the Experience window (award / subtract / set XP,
// history, the XP table, milestone level-up and level down). Crossing a threshold opens the Level Up flow at once.
// Rules live in engine-xp.js (pure); this module only draws and calls back into the sheet.
import { h, mount } from '../../core/dom.js';
import { icon, openModal, toast } from '../../core/ui.js';
import { R } from './bridge.js';
import { xpStatus, xpTable, addXp, setXp, xpLevelsCrossed, charLevel } from './engine-xp.js';
import { rerender } from './widgets.js';

const n = (v) => (Number(v) || 0).toLocaleString('en-US');
const rules = () => R();

/** Is a level up earned by XP but not taken yet? -> number of levels due */
export const levelsDue = (char) => xpStatus(char, rules()).due;

/** Header meter: "XP 450 / 900", a bar, "450 to level 3" (or "Level 3 reached"). Click -> onOpen(). */
export function xpMeter(char, { onOpen, onAdd } = {}) {
  const st = xpStatus(char, rules());
  if (st.level < 1 && !st.xp) return null;
  const due = st.due > 0;
  const sub = st.level < 1 ? 'choose a class first'
    : due ? `Level ${st.xpLevel} reached${st.due > 1 ? ` · ${st.due} due` : ''}`
      : st.atMax ? 'maximum level' : `${n(st.toNext)} to level ${st.levelForNext}`;
  return h('div', { class: ['ch-xp', due && 'is-due'], 'data-stat': 'xp' },
    h('button', {
      class: 'ch-xp-meter', type: 'button', onclick: () => onOpen?.(), 'data-fk': 'xp-open',
      title: due ? 'Your experience has earned a level. Open the Experience window.' : 'Experience: award, subtract or set XP',
      'aria-label': `Experience ${st.xp} of ${st.next ?? st.xp}; ${sub}`,
    },
    h('span', { class: 'ch-xp-top' },
      h('span', { class: 'ch-xp-label' }, 'XP'),
      h('span', { class: 'ch-xp-val num' }, n(st.xp), st.next != null && !due ? h('span', { class: 'ch-xp-next' }, ` / ${n(st.next)}`) : null),
      h('span', { class: 'ch-xp-sub' }, sub)),
    h('span', { class: 'ch-xpbar', 'aria-hidden': 'true' }, h('span', { style: { width: `${st.pct}%` } }))),
    st.level >= 1 ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => onAdd?.(), title: 'Award experience', 'data-fk': 'xp-add' }, icon('plus'), 'XP') : null);
}

/**
 * The Experience window.
 *   getChar()            current doc
 *   apply(nextChar)      store + re-render the sheet
 *   levelUp({fromXp})    open the Level Up flow (chained when several levels are due)
 *   levelDown()          open the Level Down dialog
 *   focus: 'amount'      focus the award field
 */
export function openXpWindow({ getChar, apply, levelUp, levelDown, focus } = {}) {
  const body = h('div', { class: 'ch-xpw' });
  let amount = '';
  let note = '';
  let exact = '';
  let tableOpen = false;
  let m = null;

  // Store the new XP; if it crosses a threshold above the current level, close and open Level Up at once.
  const change = (next, before, msg) => {
    const lvl = charLevel(next);
    const crossed = xpLevelsCrossed(before, next.xp, lvl, rules());
    apply(next);
    if (crossed > 0) {
      const st = xpStatus(next, rules());
      m?.close();
      toast(`${msg} — ${next.name || 'the character'} reached level ${st.xpLevel}${st.due > 1 ? ` (${st.due} levels to take)` : ''}!`, { type: 'success', timeout: 5000 });
      setTimeout(() => levelUp?.({ fromXp: true }), 0);
      return;
    }
    toast(msg);
    draw();
  };
  const award = (sign) => {
    const v = Math.round(Math.abs(Number(String(amount).replace(/[^\d.-]/g, '')) || 0));
    if (!v) { toast('Enter an amount of XP first.'); body.querySelector('[data-fk="xpw-amt"]')?.focus(); return; }
    const c = getChar();
    const before = Number(c.xp) || 0;
    const next = addXp(c, sign * v, { note });
    amount = ''; note = '';
    change(next, before, `${sign > 0 ? '+' : '−'}${n(v)} XP${next.xp !== before + sign * v ? ' (XP can’t go below 0)' : ''}, total ${n(next.xp)}`);
  };
  const setExact = () => {
    const raw = String(exact).trim();
    if (raw === '' || !Number.isFinite(Number(raw))) { toast('Enter the exact XP total first.'); return; }
    const c = getChar();
    const before = Number(c.xp) || 0;
    const next = setXp(c, Math.max(0, Number(raw)), { note: note || 'Set exact XP' });
    exact = ''; note = '';
    change(next, before, `XP set to ${n(next.xp)}`);
  };

  function draw() {
    const c = getChar();
    const st = xpStatus(c, rules());
    const table = xpTable(rules());
    const log = Array.isArray(c.xpLog) ? c.xpLog.slice().reverse() : [];
    const amt = h('input', {
      class: 'input ch-xpw-amt', type: 'text', inputmode: 'numeric', value: amount, placeholder: 'e.g. 450', 'aria-label': 'XP amount', 'data-fk': 'xpw-amt',
      oninput: (e) => { amount = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); award(String(amount).trim().startsWith('-') || e.shiftKey ? -1 : 1); } },
    });
    const noteIn = h('input', { class: 'input', type: 'text', value: note, placeholder: 'What for? (optional)', maxlength: 140, 'aria-label': 'Note', 'data-fk': 'xpw-note', oninput: (e) => { note = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); award(1); } } });
    const exactIn = h('input', { class: 'input ch-xpw-exact', type: 'number', min: 0, inputmode: 'numeric', value: exact, placeholder: String(st.xp), 'aria-label': 'Exact XP total', 'data-fk': 'xpw-exact', oninput: (e) => { exact = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); setExact(); } } });
    rerender(body, () => mount(body,
      h('div', { class: ['ch-xpw-sum', st.due > 0 && 'is-due'] },
        h('div', { class: 'ch-xpw-head' },
          h('span', { class: 'ch-xpw-level' }, st.level ? `Level ${st.level}` : 'Level 0'),
          h('span', { class: 'ch-xpw-total num' }, `${n(st.xp)} XP`)),
        h('span', { class: 'ch-xpbar ch-xpbar-lg', role: 'meter', 'aria-valuemin': st.floor, 'aria-valuemax': st.next ?? st.xp, 'aria-valuenow': st.xp, 'aria-label': 'Progress to the next level' },
          h('span', { style: { width: `${st.pct}%` } })),
        h('div', { class: 'ch-xpw-scale ui text-sm' },
          h('span', { class: 'muted num' }, `${n(st.floor)} (level ${Math.max(1, st.level)})`),
          h('span', { class: st.due ? 'accent' : 'muted' }, st.level < 1 ? 'Choose a class to start levelling.' : st.atMax ? 'Level 20 — the highest level.' : st.due ? `Level ${st.xpLevel} reached` : `${n(st.toNext)} XP to level ${st.levelForNext}`),
          st.next != null ? h('span', { class: 'muted num' }, `${n(st.next)} (level ${st.levelForNext})`) : h('span'))),
      st.due > 0 ? h('div', { class: 'callout', 'data-callout': 'success' },
        h('div', { class: 'callout-title' }, st.due > 1 ? `${st.due} levels are due` : 'A level up is due'),
        h('div', { class: 'callout-content row' },
          h('span', null, `${n(st.xp)} XP reaches level ${st.xpLevel}.${st.due > 1 ? ' The Level Up window opens once per level.' : ''}`),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { m?.close(); setTimeout(() => levelUp?.({ fromXp: true }), 0); } }, icon('level-up'), st.due > 1 ? `Level up (${st.due})` : 'Level up now'))) : null,
      h('section', { class: 'ch-xpw-block' },
        h('h3', { class: 'ch-mini-head' }, 'Award experience'),
        h('div', { class: 'ch-xpw-award' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Amount'), amt),
          h('label', { class: 'field ch-xpw-note' }, h('span', { class: 'field-label' }, 'Note'), noteIn),
          h('div', { class: 'ch-xpw-btns' },
            h('button', { class: ['btn', !st.due && 'btn-primary'], type: 'button', onclick: () => award(1), 'data-fk': 'xpw-addbtn' }, icon('plus'), 'Add'),
            h('button', { class: 'btn', type: 'button', onclick: () => award(-1), 'data-fk': 'xpw-subbtn' }, icon('minus'), 'Subtract'))),
        h('p', { class: 'muted ui text-xs ch-xpw-hint' }, 'Enter adds; Shift+Enter (or a leading −) subtracts. Reaching the next threshold opens Level Up straight away.')),
      h('section', { class: 'ch-xpw-block' },
        h('h3', { class: 'ch-mini-head' }, 'Set exact total'),
        h('div', { class: 'row ch-xpw-set' }, exactIn, h('button', { class: 'btn', type: 'button', onclick: setExact }, 'Set XP'))),
      st.level >= 1 ? h('section', { class: 'ch-xpw-block' },
        h('h3', { class: 'ch-mini-head' }, 'Change level without XP'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', disabled: st.atMax, onclick: () => { m?.close(); setTimeout(() => levelUp?.({ fromXp: false }), 0); } }, icon('level-up'), 'Level up (ignore XP)'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { m?.close(); setTimeout(() => levelDown?.(), 0); } }, h('span', { class: 'ch-flip' }, icon('level-up')), 'Level down…')),
        h('p', { class: 'muted ui text-xs' }, 'A milestone level-up offers to raise XP to the new level’s minimum; levelling down offers to reset XP to the lower level’s minimum, so a level up doesn’t show as due straight after.')) : null,
      log.length ? h('section', { class: 'ch-xpw-block' },
        h('h3', { class: 'ch-mini-head' }, 'History'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table-dense ch-xpw-log' },
          h('thead', null, h('tr', null, h('th', null, 'When'), h('th', { class: 'num' }, 'Change'), h('th', { class: 'num' }, 'Total'), h('th', null, 'Note'))),
          h('tbody', null, log.slice(0, 12).map((e) => h('tr', null,
            h('td', { class: 'cell-muted' }, fmtWhen(e.at)),
            h('td', { class: ['num', e.delta < 0 && 'danger-text'] }, e.set ? `= ${n(e.total)}` : `${e.delta >= 0 ? '+' : '−'}${n(Math.abs(e.delta))}`),
            h('td', { class: 'num' }, n(e.total)),
            h('td', { class: 'cell-muted' }, e.note || ''))))))) : null,
      h('details', { class: 'ch-xpw-table', open: tableOpen, ontoggle: (e) => { tableOpen = e.target.open; } },
        h('summary', { class: 'ui text-sm' }, 'XP needed for each level'),
        h('ol', { class: 'ch-xpw-levels', role: 'list' }, table.map((x, i) => h('li', { class: [i + 1 === st.level && 'is-current', i + 1 === st.levelForNext && 'is-next'] },
          h('span', { class: 'ch-xpw-lvl' }, `Level ${i + 1}`), h('span', { class: 'num' }, n(x))))))));
  }

  draw();
  m = openModal({ title: 'Experience', wide: true, body, className: 'ch-xp-modal', actions: [{ label: 'Close', kind: 'ghost' }] });
  if (focus === 'amount') queueMicrotask(() => body.querySelector('[data-fk="xpw-amt"]')?.focus());
  return m;
}

function fmtWhen(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const same = new Date().toDateString() === d.toDateString();
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
