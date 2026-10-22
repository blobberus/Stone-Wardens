// Location type picker (used in the pin editor) and the small create/edit form for custom types.
import { h, mount } from '../../core/dom.js';
import { icon, openModal, input, confirmDialog, toast } from '../../core/ui.js';
import { saveCustom, removeCustom } from '../../core/compendium.js';
import * as data from './data.js';
import { swatch, pinPreview, glyph } from './pins.js';
import { RANKS } from './ranks.js';

/**
 * typePicker({value, types, open, onChange(id), onNew()}) -> element with .update(types, selectedId)
 * Shows the current type; "Change" expands a grid of every type plus "New type…".
 */
export function typePicker({ value, types, open = false, onChange, onNew }) {
  const el = h('div', { class: 'map-typepick' });
  let list = types;
  let cur = value;
  let expanded = open;
  const stayOpen = open;

  function draw() {
    const t = data.typeOf(cur);
    mount(el,
      h('button', {
        type: 'button', class: 'map-typepick-current', 'aria-expanded': String(expanded),
        onclick: () => { expanded = !expanded; draw(); if (expanded) el.querySelector('.map-typepick-opt.is-active, .map-typepick-opt')?.focus(); },
      }, swatch(t), h('span', { class: 'map-typepick-name' }, t.name), h('span', { class: 'map-typepick-more' }, expanded ? 'Hide' : 'Change')),
      expanded ? h('div', { class: 'map-typepick-grid', role: 'radiogroup', 'aria-label': 'Location type' },
        list.map((x) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(x.id === cur), class: ['map-typepick-opt', x.id === cur && 'is-active'],
          onclick: () => { cur = x.id; onChange?.(x.id); if (!stayOpen) expanded = false; draw(); el.querySelector('.map-typepick-current')?.focus(); },
        }, swatch(x), h('span', null, x.name))),
        h('button', { type: 'button', class: 'map-typepick-opt map-typepick-new', onclick: () => onNew?.() },
          h('span', { class: 'map-swatch map-swatch-new', 'aria-hidden': 'true' }, icon('plus')), h('span', null, 'New type…'))) : null);
  }
  el.update = (nextTypes, selected) => {
    list = nextTypes;
    if (selected) cur = selected;
    draw();
  };
  draw();
  return el;
}

const toHex = (c) => {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s.slice(1).split('').map((x) => x + x).join('')}`.toLowerCase();
  return data.FALLBACK_COLOR;
};

/**
 * openTypeForm({type, usage}) -> Promise<savedEntry|null>
 * type: a normalized type to edit (built-ins are overridden by a custom entry with the same id).
 */
export function openTypeForm({ type = null, usage = 0 } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const f = {
      name: type?.name || '',
      icon: type?.icon || 'mk-landmark',
      color: type?.color || data.PIGMENTS.find((p) => p.key === 'lapis').hex,
      rank: type?.rank || 3,
    };
    const err = h('span', { class: 'map-field-error', role: 'alert', hidden: true });
    const preview = h('div', { class: 'map-tf-preview', 'aria-hidden': 'true' });
    const drawPreview = () => mount(preview,
      pinPreview(data.withPaint({ icon: f.icon, color: data.safeColor(f.color), rank: f.rank })),
      h('span', { class: 'map-tf-preview-name' }, f.name.trim() || 'New type'));

    const nameIn = input({
      value: f.name, placeholder: 'e.g. Shrine, Wizard’s tower, Dragon lair', maxlength: 60, autofocus: true,
      oninput: (e) => { f.name = e.target.value; err.hidden = true; drawPreview(); },
    });

    const icons = h('div', { class: 'map-tf-icons', role: 'radiogroup', 'aria-label': 'Icon' });
    const drawIcons = () => mount(icons, data.MARKER_ICONS.map((ic) => h('button', {
      type: 'button', role: 'radio', class: ['map-tf-icon', f.icon === ic && 'is-active'], 'aria-checked': String(f.icon === ic),
      'aria-label': ic.slice(3), title: ic.slice(3),
      onclick: () => { f.icon = ic; drawIcons(); drawPreview(); },
    }, glyph(ic))));

    const colorIn = h('input', {
      type: 'color', class: 'map-tf-color-input', value: toHex(f.color), 'aria-label': 'Custom colour',
      oninput: (e) => { f.color = e.target.value; drawSwatches(); drawPreview(); },
    });
    const swatches = h('div', { class: 'map-tf-swatches', role: 'radiogroup', 'aria-label': 'Colour' });
    const drawSwatches = () => {
      const cur = toHex(f.color);
      const custom = !data.PIGMENTS.some((p) => p.hex === cur);
      mount(swatches,
        data.PIGMENTS.map((p) => h('button', {
          type: 'button', role: 'radio', class: ['map-tf-swatch', cur === p.hex && 'is-active'], style: `--pin:var(--pin-${p.key})`,
          'aria-checked': String(cur === p.hex), 'aria-label': p.name, title: p.name,
          onclick: () => { f.color = p.hex; colorIn.value = p.hex; drawSwatches(); drawPreview(); },
        })),
        h('label', { class: ['map-tf-custom', custom && 'is-active'], title: 'Pick any colour' }, colorIn, h('span', null, 'Custom')));
    };

    const rankSel = h('select', { class: 'select', id: 'map-tf-rank', onchange: (e) => { f.rank = Number(e.target.value); drawPreview(); } },
      RANKS.map((r) => h('option', { value: r.rank, selected: r.rank === f.rank }, `${r.rank} · ${r.name} — ${r.hint}`)));
    const major = h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'map-tf-rank' }, 'Default rank'), rankSel,
      h('span', { class: 'field-hint' }, 'Places of this type use it unless they pick their own rank. Rank 1 shows fully zoomed out; lower ranks appear as you zoom in.'));

    drawPreview();
    drawIcons();
    drawSwatches();

    const body = h('div', { class: 'map-tf stack' },
      h('div', { class: 'map-tf-top' },
        preview,
        h('label', { class: 'field map-tf-name' }, h('span', { class: 'field-label' }, 'Name'), nameIn, err)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Icon'), icons),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colour'), swatches),
      major,
      type?.builtin ? h('p', { class: 'muted map-tf-note' }, 'This changes the built-in type for everyone on the map.') : null);

    const submit = () => {
      const name = f.name.trim();
      if (!name) { err.textContent = 'Give the type a name.'; err.hidden = false; nameIn.focus(); return false; }
      const clash = data.allTypes().find((t) => t.name.toLowerCase() === name.toLowerCase() && t.id !== type?.id);
      if (clash) { err.textContent = `There is already a “${clash.name}” type.`; err.hidden = false; nameIn.focus(); return false; }
      // `major` mirrors rank 1 for the compendium's location-type editor.
      const fields = { name, icon: f.icon, color: data.safeColor(f.color), rank: f.rank, major: f.rank === 1 };
      let payload;
      if (type?.entry) payload = { ...type.entry, ...fields }; // existing custom entry keeps its id
      else if (type?.builtin) payload = { id: type.id, origin: 'custom', ...fields }; // override a built-in
      else payload = fields;
      try {
        result = saveCustom(data.TYPE_KIND, payload);
      } catch (e) {
        console.error(e);
        err.textContent = `Could not save: ${e.message}`;
        err.hidden = false;
        return false;
      }
      return true;
    };

    const actions = [{ label: 'Cancel', kind: 'ghost' }];
    if (type?.entry) {
      const restoring = type.builtin;
      actions.push({
        label: restoring ? 'Restore default' : 'Delete type',
        kind: 'danger',
        onClick: async () => {
          const msg = restoring
            ? `Restore the original look of “${data.typeOf(type.id).name}”?`
            : `Delete the “${type.name}” type?${usage ? ` ${usage} location${usage === 1 ? '' : 's'} use it and will show as “Unknown” until you pick another type.` : ''}`;
          if (!(await confirmDialog(msg, { title: restoring ? 'Restore type' : 'Delete type', okLabel: restoring ? 'Restore' : 'Delete', danger: !restoring }))) return false;
          removeCustom(data.TYPE_KIND, type.id);
          toast(restoring ? 'Type restored.' : `Deleted the “${type.name}” type.`);
          result = { deleted: true, id: type.id };
          return true;
        },
      });
    }
    actions.push({ label: type ? 'Save type' : 'Create type', kind: 'primary', onClick: () => submit() });

    const m = openModal({ title: type ? 'Edit location type' : 'New location type', body, actions, className: 'map-tf-modal', onClose: () => resolve(result) });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (submit()) m.close(); } });
  });
}
