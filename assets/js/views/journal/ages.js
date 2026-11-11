// The master Ages menu: the world's ages in order (a date in an age higher up the list comes before every date in one
// lower down: with AFF above BCC, 100 AFF comes before 1 BCC), each with a short description, its range of years, a
// colour and tags; the month names; and, opened from a timeline, which ages that timeline shows. Changes are kept in
// the dialog until Save (calendar.js saveCalendar -> content/calendar.json).
import { h } from '../../core/dom.js';
import { icon, openModal, field, input, confirmDialog, checkbox } from '../../core/ui.js';
import { calendar, saveCalendar, newAgeId, colorVar, COLORS } from './calendar.js';
import { isBoard, boardData, tagsOf } from './kinds.js';
import { colorPicker, tagsInput, textField, itemDialog } from './board.js';
import { plural } from './text.js';
import * as J from './data.js';

/** How many dates use an age, across every timeline and family tree: {count, notes: [titles]}. */
export function ageUse(id) {
  let count = 0;
  const notes = [];
  for (const n of J.index().notes) {
    if (!isBoard(n.kind)) continue;
    const d = boardData(n.fm);
    const dates = n.kind === 'timeline'
      ? [...d.events, ...d.markers, ...d.spans.flatMap((s) => [s.from, s.to])]
      : d.people.flatMap((p) => [p.born, p.died]);
    const c = dates.filter((x) => x && typeof x === 'object' && String(x.age) === id).length;
    if (c) { count += c; notes.push(n.title); }
  }
  return { count, notes };
}

const intText = (v) => (v == null ? '' : String(v));
const parseInt10 = (s) => (String(s).trim() === '' ? null : Number(String(s).trim()));

/** The form of one age (new when `age` is null). Resolves the edited age or null. */
function ageForm(age, ages) {
  return new Promise((resolve) => {
    const isNew = !age;
    const a = age || { id: null, abbr: '', name: '', color: COLORS[ages.length % COLORS.length].id, start: null, end: null, countdown: false, text: '', tags: [] };
    const abbr = input({ value: a.abbr, maxlength: 12, placeholder: 'e.g. AFF', autofocus: true, class: 'input jr-age-abbr' });
    const name = input({ value: a.name, maxlength: 80, placeholder: 'e.g. After the Fallen Firmament' });
    const from = h('input', { class: 'input', type: 'number', step: '1', inputmode: 'numeric', value: intText(a.start), placeholder: 'e.g. 1', 'aria-label': 'Range: first year' });
    const to = h('input', { class: 'input', type: 'number', step: '1', inputmode: 'numeric', value: intText(a.end), placeholder: 'ongoing', 'aria-label': 'Range: last year' });
    const down = checkbox(a.countdown, null, 'Years count down (like BC: 300 comes before 1)');
    const color = colorPicker(a.color);
    const text = textField(a.text, { label: 'Description', hint: 'A short paragraph about this age. [[Links]] and #tags work.', rows: 3 });
    const tags = tagsInput(a.tags);
    let out = null;
    itemDialog({
      title: isNew ? 'New age' : `Edit ${a.abbr}`,
      saveLabel: isNew ? 'Add age' : 'Done',
      fields: [
        h('div', { class: 'jr-form-row' }, field('Abbreviation', abbr, 'Shown after years: 100 AFF'), field('Name', name)),
        h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Range of years'),
          h('div', { class: 'jr-form-row jr-range-row' }, field('From', from), h('span', { class: 'jr-range-dash', 'aria-hidden': 'true' }, '–'), field('To', to)),
          h('span', { class: 'field-hint' }, 'Optional. Leave “To” blank while the age goes on. The age’s band on a timeline covers its range and every date in it.')),
        down, color.el, text.el, tags.el,
      ],
      save(fail) {
        const ab = abbr.value.trim();
        if (!ab) { abbr.focus(); return fail('Give the age an abbreviation, like AFF.'); }
        if (ages.some((x) => x !== age && x.abbr.toLowerCase() === ab.toLowerCase())) { abbr.focus(); return fail(`There is already an age called ${ab}.`); }
        for (const [el, what] of [[from, 'first'], [to, 'last']]) {
          if (String(el.value).trim() && !/^-?\d+$/.test(String(el.value).trim())) { el.focus(); return fail(`The ${what} year is a whole number.`); }
        }
        out = {
          ...a,
          id: a.id || newAgeId(ab, ages),
          abbr: ab,
          name: name.value.trim() || ab,
          color: color.get(),
          start: parseInt10(from.value),
          end: parseInt10(to.value),
          countdown: down.querySelector('input').checked,
          text: text.get(),
          tags: tags.get(),
        };
        return true;
      },
    }).then(() => resolve(out));
  });
}

/**
 * Open the ages menu. shown: ids this timeline lists itself (null: not opened from a timeline); used: ids its items
 * use (always shown); startNew: open the new-age form at once (the timeline's "Age" tool).
 * Resolves {saved, shown} (shown: the timeline's list after the dialog) or null when cancelled.
 */
export function agesDialog({ shown = null, used = new Set(), startNew = false } = {}) {
  return new Promise((resolve) => {
    const cal = calendar();
    const ages = cal.ages.map((a) => ({ ...a, tags: [...a.tags] }));
    let def = cal.defaultAge;
    const on = shown ? new Set(shown) : null;
    const months = h('textarea', { class: 'textarea jr-months', rows: 6, value: cal.months.join('\n'), spellcheck: true, 'aria-label': 'Month names, one per line' });
    const listEl = h('ol', { class: 'jr-ages', 'aria-label': 'Ages, earliest first' });
    let result = null;

    const move = (i, by) => {
      const j = i + by;
      if (j < 0 || j >= ages.length) return;
      [ages[i], ages[j]] = [ages[j], ages[i]];
      draw(ages[j].id);
    };
    const edit = async (a) => {
      const next = await ageForm(a, ages);
      if (!next) return;
      ages.splice(ages.indexOf(a), 1, next);
      draw(next.id);
    };
    const add = async () => {
      const next = await ageForm(null, ages);
      if (!next) return;
      ages.push(next);
      on?.add(next.id);
      draw(next.id);
    };
    const del = async (a) => {
      if (ages.length === 1) return;
      const use = ageUse(a.id);
      const msg = use.count
        ? `${plural(use.count, 'date')} in ${use.notes.slice(0, 3).map((t) => `“${t}”`).join(', ')}${use.notes.length > 3 ? ' and more' : ''} use ${a.abbr}. They keep their years but lose their place in order until you give them another age. Delete ${a.abbr}?`
        : `Delete the age ${a.abbr} (${a.name})?`;
      if (!(await confirmDialog(msg, { title: 'Delete age', okLabel: 'Delete age', danger: true }))) return;
      ages.splice(ages.indexOf(a), 1);
      on?.delete(a.id);
      if (def === a.id) def = ages[0].id;
      draw();
    };

    function draw(focusId = null) {
      listEl.replaceChildren(...ages.map((a, i) => {
        const range = a.start != null || a.end != null ? `${a.start ?? '…'} – ${a.end ?? 'ongoing'}` : 'no set range';
        const usedHere = used.has(a.id);
        return h('li', { class: 'jr-age', style: `--item:${colorVar(a.color)}`, 'data-age': a.id },
          h('span', { class: 'jr-age-swatch', 'aria-hidden': 'true' }),
          h('div', { class: 'jr-age-main' },
            h('div', { class: 'jr-age-name' }, h('strong', null, a.abbr), h('span', null, a.name)),
            h('div', { class: 'jr-age-meta' },
              h('span', null, range),
              a.countdown ? h('span', null, 'counts down') : null,
              tagsOf(a.tags).length ? h('span', null, tagsOf(a.tags).map((t) => `#${t}`).join(' ')) : null),
            a.text ? h('p', { class: 'jr-age-text' }, a.text) : null),
          h('div', { class: 'jr-age-tools' },
            on ? h('label', { class: 'checkbox jr-age-on', title: usedHere ? 'Items on this timeline use this age, so it shows' : 'Show this age on the timeline even without events in it' },
              h('input', { type: 'checkbox', checked: usedHere || on.has(a.id), disabled: usedHere, onchange: (e) => { if (e.target.checked) on.add(a.id); else on.delete(a.id); } }),
              h('span', null, 'On this timeline')) : null,
            // the default's slot keeps the place of the others' "Make default", so every row's controls line up
            a.id !== def
              ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm jr-age-def', title: `Make ${a.abbr} the age new dates start in`, onclick: () => { def = a.id; draw(a.id); } }, 'Make default')
              : h('span', { class: 'jr-age-def is-default', title: 'New dates start in this age' }, icon('check'), 'Default'),
            h('span', { class: 'jr-age-btns' },
              h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Earlier', 'aria-label': `Move ${a.abbr} earlier`, disabled: i === 0, 'data-move': 'up', onclick: () => move(i, -1) }, icon('chevron-up')),
              h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Later', 'aria-label': `Move ${a.abbr} later`, disabled: i === ages.length - 1, 'data-move': 'down', onclick: () => move(i, 1) }, icon('chevron-down')),
              h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Edit', 'aria-label': `Edit ${a.abbr}`, onclick: () => edit(a) }, icon('edit')),
              h('button', { type: 'button', class: 'btn-icon btn-sm', title: 'Delete', 'aria-label': `Delete ${a.abbr}`, disabled: ages.length === 1, onclick: () => del(a) }, icon('trash')))));
      }));
      if (focusId) requestAnimationFrame(() => listEl.querySelector(`[data-age="${CSS.escape(focusId)}"] .btn-icon[title="Edit"]`)?.focus());
    }
    draw();

    openModal({
      title: 'Ages',
      wide: true,
      className: 'jr-ages-dialog',
      body: h('div', { class: 'stack jr-dialog' },
        h('p', { class: 'jr-hint' }, 'The ages of the world, earliest first, shared by every timeline and family tree. A date in an age higher up the list comes before any date in one lower down: with AFF above BCC, 100 AFF comes before 1 BCC.'),
        listEl,
        h('div', null, h('button', { type: 'button', class: 'btn btn-sm', onclick: add }, icon('plus'), h('span', null, 'New age'))),
        h('details', { class: 'jr-months-box' }, h('summary', null, 'Month names'),
          field('One per line, in order', months, 'Dates can name a month or leave it blank.'))),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Save ages', kind: 'primary', onClick: () => {
          saveCalendar({ ages, months: months.value.split('\n'), defaultAge: def });
          result = { saved: true, shown: on ? new Set([...on].filter((id) => ages.some((a) => a.id === id))) : null };
        } },
      ],
      onClose: () => resolve(result),
    });
    if (startNew) requestAnimationFrame(add);
  });
}
