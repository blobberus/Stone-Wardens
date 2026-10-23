// Sub-map dialogs: create a map (name, parent, the place that opens it, image) and delete one
// (its places move up to the parent map or are deleted; links to it are cleared).
import { h, mount } from '../../core/dom.js';
import { openModal, toast, choiceDialog, confirmDialog, icon } from '../../core/ui.js';
import { saveSoon, saveHint } from '../../core/saving.js';
import * as data from './data.js';
import { chooseImage, stageImage } from './image.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mb = (n) => (n / 1024 / 1024).toFixed(1);

/** <option>s for every map, indented by depth. */
export function mapOptions(selected, { exclude = null, none = null } = {}) {
  const opts = none ? [h('option', { value: '', selected: !selected }, none)] : [];
  for (const m of data.maps()) {
    if (m.id === exclude) continue;
    opts.push(h('option', { value: m.id, selected: m.id === selected }, `${' '.repeat(m.depth)}${m.name}`));
  }
  return opts;
}

/**
 * openNewMapDialog({parent, fromLoc, name}) -> Promise<mapId|null>
 * fromLoc: a place (on the parent map) that should open the new map.
 */
export function openNewMapDialog({ parent = data.MAIN_MAP, fromLoc = null, name = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const f = { name: name || fromLoc?.name || '', parent: data.mapById(fromLoc?.map || parent) ? (fromLoc?.map || parent) : data.MAIN_MAP, from: fromLoc?.id || '', picked: null };
    const err = h('span', { class: 'map-field-error', role: 'alert', hidden: true }, 'Give the map a name.');
    const nameIn = h('input', { class: 'input', value: f.name, placeholder: 'e.g. Duskhold, The Undercroft', maxlength: 80, autofocus: true, oninput: (e) => { f.name = e.target.value; err.hidden = true; } });
    const fromSel = h('select', { class: 'select', onchange: (e) => { f.from = e.target.value; } });
    const drawFrom = () => {
      const places = data.locationsOn(f.parent).filter((l) => !l.submap || l.id === f.from);
      if (!places.some((l) => l.id === f.from)) f.from = '';
      mount(fromSel, h('option', { value: '', selected: !f.from }, 'No place (open it from the map menu)'),
        places.map((l) => h('option', { value: l.id, selected: l.id === f.from }, l.name)));
    };
    const parentSel = h('select', { class: 'select', onchange: (e) => { f.parent = e.target.value; drawFrom(); } }, mapOptions(f.parent));
    const imgBox = h('div', { class: 'map-nm-image' });
    const drawImage = () => mount(imgBox,
      f.picked
        ? h('div', { class: 'map-nm-file' }, icon('image'),
          h('span', { class: 'map-nm-file-name' }, f.picked.file.name, h('small', null, `${Math.round(f.picked.size.width)} × ${Math.round(f.picked.size.height)} px · ${mb(f.picked.file.size)} MB`)),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { f.picked = null; drawImage(); } }, 'Use the blank map'))
        : h('div', { class: 'map-nm-file is-blank' }, icon('map'),
          h('span', { class: 'map-nm-file-name' }, 'Blank parchment', h('small', null, 'You can upload the real map later from its menu.')),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { const p = await chooseImage(); if (p) { f.picked = p; drawImage(); } } }, icon('upload'), h('span', null, 'Upload image…'))));
    drawFrom();
    drawImage();

    const body = h('div', { class: 'stack map-nm' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), nameIn, err),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Inside'), parentSel, h('span', { class: 'field-hint' }, 'The breadcrumb leads back up to this map.')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Opened from'), fromSel, h('span', { class: 'field-hint' }, 'That place gets an “Open map” link and a small seal on its pin.')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Image'), imgBox));

    const create = async () => {
      const n = f.name.trim();
      if (!n) { err.hidden = false; nameIn.focus(); return false; }
      const id = data.createMap({ name: n, parent: f.parent });
      if (f.picked) await stageImage(id, f.picked);
      const loc = f.from && data.locationById(f.from);
      if (loc) data.saveLocation({ ...loc, submap: id });
      result = id;
      toast(`Created the map “${n}”. ${saveHint('Press Save to share it.')}`.trim(), { type: 'success' });
      saveSoon(`map: new sub-map “${n}”`);
      return true;
    };
    const m = openModal({
      title: 'Add a sub-map',
      body,
      className: 'map-nm-modal',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create map', kind: 'primary', onClick: create }],
      onClose: () => resolve(result),
    });
    nameIn.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); if (await create()) m.close(); } });
  });
}

/** Delete a sub-map after asking what happens to its places. Resolves the parent id, or null if canceled. */
export async function deleteMapFlow(mapId) {
  const m = data.mapById(mapId);
  if (!m || m.isMain) return null;
  const parent = data.mapById(m.parent) || data.mapById(data.MAIN_MAP);
  const places = data.locationsOn(m.id).length;
  const kids = data.childMaps(m.id).length;
  const openers = data.linksTo(m.id).length;
  const notes = data.backlinks(m).length;
  const facts = [
    kids ? `Its ${plural(kids, 'sub-map')} will move up into “${parent.name}”.` : '',
    openers ? `${plural(openers, 'place')} that open${openers === 1 ? 's' : ''} it will lose the link.` : '',
    notes ? `${plural(notes, 'note')} link${notes === 1 ? 's' : ''} to it; ${notes === 1 ? 'that link stops' : 'those links stop'} working.` : '',
  ].filter(Boolean);
  let pins = 'move';
  if (places) {
    const anchor = data.linksTo(m.id).find((l) => l.map === parent.id);
    pins = await choiceDialog(
      h('div', { class: 'stack' },
        h('p', null, `“${m.name}” has ${plural(places, 'place')}. What should happen to ${places === 1 ? 'it' : 'them'}?`),
        h('p', { class: 'muted' }, `${places === 1 ? 'A moved place goes' : 'Moved places are gathered'} ${anchor ? `next to “${anchor.name}”` : 'in the middle'} on “${parent.name}”, ready to be arranged in Edit map.`),
        facts.length ? h('p', null, facts.join(' ')) : null),
      [
        { label: 'Cancel', value: null, kind: 'ghost' },
        { label: `Delete the ${places === 1 ? 'place' : `${places} places`} too`, value: 'delete', kind: 'danger' },
        { label: `Move ${places === 1 ? 'it' : 'them'} to “${parent.name}”`, value: 'move', kind: 'primary' },
      ],
      { title: `Delete the map “${m.name}”?` },
    );
    if (!pins) return null;
  } else if (!(await confirmDialog(`Delete the map “${m.name}”? ${facts.join(' ')}`.trim(), { title: 'Delete this map?', okLabel: 'Delete map', danger: true }))) {
    return null;
  }
  await data.deleteMap(m.id, { pins });
  toast(`Deleted the map “${m.name}”. ${saveHint('Press Save to send the change.')}`.trim());
  saveSoon(`map: delete sub-map “${m.name}”`);
  return parent.id;
}
