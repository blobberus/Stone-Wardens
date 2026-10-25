// Sub-map dialogs: create a map (name, parent or none = a map of its own, the place that opens it, image; DM mode:
// hidden or not), duplicate one (with its places, pictures and fog), move one into another map (or out, to a map of
// its own) and delete one (its places move up to the parent map or are deleted; links to it are cleared).
import { h, mount } from '../../core/dom.js';
import { openModal, toast, choiceDialog, confirmDialog, icon } from '../../core/ui.js';
import { saveSoon, saveHint } from '../../core/saving.js';
import { hiddenChoice } from '../../core/dm-ui.js';
import * as data from './data.js';
import { chooseImage, stageImage } from './image.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mb = (n) => (n / 1024 / 1024).toFixed(1);
/** "Inside" selects: the value of "No parent (a map of its own)". */
export const OWN = '';
const OWN_LABEL = 'No parent (a map of its own)';
const parentOf = (v) => (v === OWN || v == null ? null : v);

/**
 * <option>s for every map, indented by depth. exclude: an id or a list of ids; none: label of a first '' option;
 * own: add "No parent (a map of its own)" last (value OWN) for the "Inside" selects (selected = null picks it).
 */
export function mapOptions(selected, { exclude = null, none = null, own = false } = {}) {
  const skip = new Set([].concat(exclude ?? []));
  const opts = none ? [h('option', { value: '', selected: !selected }, none)] : [];
  for (const m of data.maps()) {
    if (skip.has(m.id)) continue;
    opts.push(h('option', { value: m.id, selected: m.id === selected }, `${' '.repeat(m.depth)}${m.name}`));
  }
  if (own) opts.push(h('option', { value: OWN, selected: selected === null || selected === OWN }, OWN_LABEL));
  return opts;
}

/** A parent for a new map: the asked one if this viewer has it, null stays null, else the main map (or none). */
function startParent(p) {
  if (p === null) return null;
  if (data.mapById(p)) return data.mapById(p).id;
  return data.mapById(data.MAIN_MAP) ? data.MAIN_MAP : null;
}

/**
 * openNewMapDialog({parent, fromLoc, name, title}) -> Promise<mapId|null>
 * fromLoc: a place (on the parent map) that should open the new map. parent null: a map of its own.
 */
export function openNewMapDialog({ parent = data.MAIN_MAP, fromLoc = null, name = '', title = 'Add a sub-map' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const f = { name: name || fromLoc?.name || '', parent: startParent(fromLoc?.map || parent), from: fromLoc?.id || '', picked: null };
    const vis = { hidden: data.mapHidden(f.parent) ? true : null }; // DM mode: a new map hidden from the players?
    const err = h('span', { class: 'map-field-error', role: 'alert', hidden: true }, 'Give the map a name.');
    const nameIn = h('input', { class: 'input', value: f.name, placeholder: 'e.g. Duskhold, The Undercroft', maxlength: 80, autofocus: true, oninput: (e) => { f.name = e.target.value; err.hidden = true; } });
    const fromSel = h('select', { class: 'select', onchange: (e) => { f.from = e.target.value; } });
    const drawFrom = () => {
      const places = f.parent ? data.locationsOn(f.parent).filter((l) => !l.submap || l.id === f.from) : [];
      if (!places.some((l) => l.id === f.from)) f.from = '';
      mount(fromSel, h('option', { value: '', selected: !f.from }, f.parent ? 'No place (open it from the map menu)' : 'No place (a map of its own)'),
        places.map((l) => h('option', { value: l.id, selected: l.id === f.from }, l.name)));
      fromSel.disabled = !f.parent;
    };
    const parentSel = h('select', { class: 'select', onchange: (e) => { f.parent = parentOf(e.target.value); drawFrom(); } }, mapOptions(f.parent, { own: true }));
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
      hiddenChoice(vis),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), nameIn, err),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Inside'), parentSel, h('span', { class: 'field-hint' }, 'The breadcrumb leads back up to this map. A map of its own is not linked to the main map: it is listed beside it.')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Opened from'), fromSel, h('span', { class: 'field-hint' }, 'That place gets an “Open map” link and a small seal on its pin.')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Image'), imgBox));

    const create = async () => {
      const n = f.name.trim();
      if (!n) { err.hidden = false; nameIn.focus(); return false; }
      const id = data.createMap({ name: n, parent: f.parent, hidden: vis.hidden }); // inside a hidden map: always hidden
      if (f.picked) await stageImage(id, f.picked);
      const loc = f.from && data.locationById(f.from);
      if (loc) data.saveLocation({ ...loc, submap: id });
      result = id;
      toast(data.mapHidden(id)
        ? `Created the map “${n}”, hidden from the players. Release it with the switch under its name or from the DM Screen.`
        : `Created the map “${n}”. ${saveHint('Press Save to share it.')}`.trim(), { type: 'success', timeout: data.mapHidden(id) ? 6000 : 3500 });
      saveSoon(`map: new sub-map “${n}”`);
      return true;
    };
    const m = openModal({
      title,
      body,
      className: 'map-nm-modal',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create map', kind: 'primary', onClick: create }],
      onClose: () => resolve(result),
    });
    nameIn.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); if (await create()) m.close(); } });
  });
}

/**
 * Duplicate a map (the main map's copy becomes a sub-map): name, where it goes, and what comes along. Resolves the
 * new map's id, or null.
 */
export function openCopyMapDialog(mapId, { fogHides = () => false } = {}) {
  const src = data.mapById(mapId);
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    let result = null;
    const nPlaces = data.locationsOn(src.id).filter((l) => !fogHides(l)).length; // what this viewer may know of
    const nPics = data.picturesOn(src.id).length;
    const hasFog = data.fogOf(src.id).ops.length > 0;
    const fogLocked = hasFog && !data.canDesign(); // places under the fog only travel with their fog
    const f = { name: `${src.name} (copy)`, parent: src.isMain ? data.MAIN_MAP : src.parent, places: true, pictures: true, fog: true };
    const vis = { hidden: data.mapHidden(src.id) ? true : null };
    const err = h('span', { class: 'map-field-error', role: 'alert', hidden: true }, 'Give the copy a name.');
    const nameIn = h('input', { class: 'input', value: f.name, maxlength: 80, autofocus: true, oninput: (e) => { f.name = e.target.value; err.hidden = true; } });
    const parentSel = h('select', { class: 'select', onchange: (e) => { f.parent = parentOf(e.target.value); } }, mapOptions(f.parent, { own: true }));
    const check = (key, label, n, locked = false) => h('label', { class: 'checkbox' },
      h('input', { type: 'checkbox', checked: f[key], disabled: !n || locked, onchange: (e) => { f[key] = e.target.checked; } }), h('span', null, label));
    const body = h('div', { class: 'stack map-nm' },
      hiddenChoice(vis),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), nameIn, err),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Inside'), parentSel),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Copy along'),
        h('div', { class: 'map-copy-what' },
          check('places', nPlaces ? `${plural(nPlaces, 'place')}, with their descriptions, types, ranks and tags` : 'No places to copy', nPlaces),
          check('pictures', nPics ? plural(nPics, 'picture') : 'No pictures to copy', nPics),
          check('fog', hasFog ? 'The fog of war' : 'No fog to copy', hasFog, fogLocked)),
        h('span', { class: 'field-hint' }, 'The image and the design (background, crop, compass, scale, border) always come along. Copied places get new links; links in notes keep opening the originals.')));
    const create = async (m) => {
      const n = f.name.trim();
      if (!n) { err.hidden = false; nameIn.focus(); return false; }
      m?.el?.classList.add('is-busy');
      try {
        result = await data.copyMap(src.id, { name: n, parent: f.parent, places: f.places && data.locationsOn(src.id).length > 0, pictures: f.pictures && !!nPics, fog: (f.fog || fogLocked) && hasFog, hidden: vis.hidden === true });
      } catch (e) {
        toast(`Could not copy the map: ${e.message || e}`, { type: 'error' });
        return false;
      } finally { m?.el?.classList.remove('is-busy'); }
      toast(`Created “${n}”, a copy of “${src.name}”. ${saveHint('Press Save to share it.')}`.trim(), { type: 'success' });
      saveSoon(`map: copy “${src.name}”`);
      return true;
    };
    const m = openModal({
      title: `Duplicate “${src.name}”`,
      body,
      className: 'map-nm-modal',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Duplicate', kind: 'primary', onClick: () => create(m) }],
      onClose: () => resolve(result),
    });
    nameIn.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); if (await create(m)) m.close(); } });
  });
}

/**
 * Delete a sub-map after asking what happens to its places. Resolves the map to show next (its parent; for a map of
 * its own, where its places went or the main map), or null if canceled.
 */
export async function deleteMapFlow(mapId) {
  const m = data.mapById(mapId);
  if (!m || m.isMain) return null;
  const parent = m.parent ? data.mapById(m.parent) : null; // null: a map of its own
  const dest = data.mapById(data.moveTargetOf(m.id)); // where moved places go (a map of its own: the main map)
  const places = data.locationsOn(m.id).length;
  const kids = data.childMaps(m.id).length;
  const openers = data.linksTo(m.id).length;
  const notes = data.backlinks(m).length;
  const facts = [
    kids ? (parent ? `Its ${plural(kids, 'sub-map')} will move up into “${parent.name}”.` : `Its ${plural(kids, 'sub-map')} will become ${kids === 1 ? 'a map' : 'maps'} of ${kids === 1 ? 'its' : 'their'} own.`) : '',
    openers ? `${plural(openers, 'place')} that open${openers === 1 ? 's' : ''} it will lose the link.` : '',
    notes ? `${plural(notes, 'note')} link${notes === 1 ? 's' : ''} to it; ${notes === 1 ? 'that link stops' : 'those links stop'} working.` : '',
  ].filter(Boolean);
  let pins = 'move';
  if (places && dest) {
    const anchor = data.linksTo(m.id).find((l) => l.map === dest.id);
    pins = await choiceDialog(
      h('div', { class: 'stack' },
        h('p', null, `“${m.name}” has ${plural(places, 'place')}. What should happen to ${places === 1 ? 'it' : 'them'}?`),
        h('p', { class: 'muted' }, `${places === 1 ? 'A moved place goes' : 'Moved places are gathered'} ${anchor ? `next to “${anchor.name}”` : 'in the middle'} on “${dest.name}”, ready to be arranged in Edit map.`),
        facts.length ? h('p', null, facts.join(' ')) : null),
      [
        { label: 'Cancel', value: null, kind: 'ghost' },
        { label: `Delete the ${places === 1 ? 'place' : `${places} places`} too`, value: 'delete', kind: 'danger' },
        { label: `Move ${places === 1 ? 'it' : 'them'} to “${dest.name}”`, value: 'move', kind: 'primary' },
      ],
      { title: `Delete the map “${m.name}”?` },
    );
    if (!pins) return null;
  } else if (!(await confirmDialog(`Delete the map “${m.name}”?${places ? ` Its ${plural(places, 'place')} will be deleted too.` : ''} ${facts.join(' ')}`.trim(), { title: 'Delete this map?', okLabel: 'Delete map', danger: true }))) {
    return null;
  }
  await data.deleteMap(m.id, { pins: dest ? pins : 'delete' });
  toast(`Deleted the map “${m.name}”. ${saveHint('Press Save to send the change.')}`.trim());
  saveSoon(`map: delete sub-map “${m.name}”`);
  return parent?.id || (pins === 'move' && dest ? dest.id : null) || data.homeMapId() || data.MAIN_MAP;
}

/**
 * Move a sub-map into another map, or out to a map of its own ("Move into another map…" in the ⋯ menu). Its places,
 * pictures, fog and sub-maps move with it; it can't go inside itself or one of its own sub-maps. Resolves true if moved.
 */
export function openMoveMapDialog(mapId) {
  const m = data.mapById(mapId);
  if (!m || m.isMain) return Promise.resolve(false);
  return new Promise((resolve) => {
    let moved = false;
    const below = [m.id, ...data.descendantIds(m.id)];
    const cur = m.parent ?? null;
    const sel = h('select', { class: 'select' }, mapOptions(cur, { exclude: below, own: true }));
    const hint = h('span', { class: 'field-hint' });
    const drawHint = () => {
      const to = parentOf(sel.value);
      hint.textContent = to === null
        ? 'A map of its own is not linked to the main map: it is listed beside it, and its breadcrumb starts with it.'
        : data.mapHidden(to) && !data.mapHidden(m.id)
          ? `“${data.mapById(to)?.name}” is hidden from the players, so “${m.name}” will be hidden with it, with everything on it.`
          : `Its breadcrumb will lead back up through “${data.mapById(to)?.name}”.`;
    };
    sel.addEventListener('change', drawHint);
    drawHint();
    const kids = below.length - 1;
    const go = async (md) => {
      const to = parentOf(sel.value);
      if (to === cur) return true;
      md?.el?.classList.add('is-busy');
      try {
        const r = await data.moveMap(m.id, to);
        moved = true;
        const where = to === null ? 'a map of its own' : `inside “${data.mapById(to)?.name || to}”`;
        toast(`“${m.name}” is now ${where}.${r.hidden ? ' It is hidden from the players with that map.' : ''} ${saveHint('Press Save to share it.')}`.trim(), { type: 'success', timeout: r.hidden ? 6000 : 3500 });
        saveSoon(`map: move “${m.name}”`);
        return true;
      } catch (e) {
        toast(`Could not move the map: ${e.message || e}`, { type: 'error' });
        return false;
      } finally { md?.el?.classList.remove('is-busy'); }
    };
    const md = openModal({
      title: `Move “${m.name}”`,
      body: h('div', { class: 'stack map-nm' },
        h('p', { class: 'muted ui text-sm' }, kids ? `Its places, pictures, fog and ${plural(kids, 'sub-map')} move with it.` : 'Its places, pictures and fog move with it.'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Inside'), sel, hint)),
      className: 'map-nm-modal',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Move map', kind: 'primary', onClick: () => go(md) }],
      onClose: () => resolve(moved),
    });
  });
}
