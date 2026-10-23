// Edit mode: a side panel (bottom sheet on phones) listing every place on the current map with inline
// editing, group selection, dragging and arrow-key nudging of pins, bulk rank/type/delete, a numeric
// offset/scale tool (pins are stored in image pixels, so a differently sized export needs this), the
// per-map zoom bands of the hierarchy, and undo. Every change is a store draft; close() reports whether there were
// any, so the view commits them once when editing ends (saving.js saveSoon), or they wait for Save.
// The DM (or anyone while no DM is set up) also gets the Design, Pictures and Fog tabs (designpanel.js).
import { h, mount, clear } from '../../core/dom.js';
import { icon, toast, confirmDialog, openModal, markdownEditor } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { debounce, nameKey } from '../../core/util.js';
import { majorSaveOn } from '../../core/saving.js';
import * as data from './data.js';
import { swatch } from './pins.js';
import { rankPicker } from './drawer.js';
import { RANKS, DEFAULT_BANDS, normBands, sameBands, rankName } from './ranks.js';
import { mapOptions } from './submaps.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fieldOf = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
const numIn = (value, oninput, props = {}) => h('input', { class: 'input input-number', type: 'number', step: 'any', value, oninput, ...props });

/** Put nodes into parent in order, moving as little as possible (keeps a focused row attached). */
function reconcile(parent, nodes) {
  const keep = new Set(nodes);
  for (const c of [...parent.children]) if (!keep.has(c)) c.remove();
  let ref = parent.firstChild;
  for (const n of nodes) {
    if (n === ref) { ref = ref.nextSibling; continue; }
    parent.insertBefore(n, ref);
  }
}

/**
 * ctx: {root, leaflet(), mapId(), info(), locations(), typeOf, types(), marker(id) -> {marker, loc},
 *       toLatLng(x, y), toXY(latlng), clampXY(p), applyStates(), focusLoc(loc, zoom), openDetails(id), exit(),
 *       replaceImage(), newSubmap({name, parent}) -> Promise<id|null>, setBandPreview(bands|null), zoomU(), rankShift(),
 *       design (designpanel.js, optional), canDesign() -> the design tabs are offered,
 *       allLocations() -> every place, also those the fog hides from this viewer (moved by Offset / scale)}
 */
export function createEditor(ctx) {
  const st = { open: false, sel: new Set(), openRow: null, q: '', drag: null, nudge: null, undo: [], rows: new Map(), changed: false, tab: 'places' };

  const mapName = h('span', { class: 'map-edit-map' });
  const searchIn = h('input', {
    class: 'input map-edit-search', type: 'search', placeholder: 'Find a place…', 'aria-label': 'Find a place in the list', autocomplete: 'off',
    oninput: (e) => { st.q = e.target.value; renderList(); },
  });
  const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select every listed place', onchange: (e) => selectAll(e.target.checked) });
  const countEl = h('span', { class: 'map-edit-count', 'aria-live': 'polite' });
  const bulk = h('div', { class: 'map-edit-bulk', hidden: true, role: 'group', 'aria-label': 'Change the selected places' });
  const listEl = h('ul', { class: 'map-edit-list', role: 'list', 'aria-label': 'Places on this map' });
  const undoBtn = h('button', { type: 'button', class: 'btn btn-sm', disabled: true, onclick: () => doUndo() }, icon('undo'), h('span', null, 'Undo'));
  const bandsBody = h('div', { class: 'map-edit-bands-body' });
  const bandsEl = h('details', { class: 'map-edit-bands' },
    h('summary', null, h('span', null, 'Zoom bands'), h('small', null, 'when each rank shows')), bandsBody);
  bandsEl.addEventListener('toggle', () => { ctx.setBandPreview(bandsEl.open ? curBands() : null); drawBands(); });
  const hintEl = h('p', { class: 'map-edit-hint' });
  const drawHint = () => {
    hintEl.textContent = 'Drag pins to move them; Ctrl-click pins or tick rows to move several together. Arrow keys nudge the selection (Shift: 10 px). '
      + (majorSaveOn() ? 'Your changes are saved for the party when you press Done.' : 'Changes stay drafts until you press Save.');
  };

  const placesPane = h('div', { class: 'map-edit-pane', role: 'tabpanel', 'data-tab': 'places' },
    h('div', { class: 'map-edit-tools' },
      searchIn,
      h('div', { class: 'map-edit-selrow' }, h('label', { class: 'checkbox map-edit-all' }, allBox, h('span', null, 'Select all')), h('span', { class: 'map-spacer' }), countEl),
      bulk),
    listEl,
    bandsEl,
    h('footer', { class: 'map-edit-foot' },
      h('div', { class: 'map-edit-actions' },
        undoBtn,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openTransform(), title: 'Shift or scale pins by numbers, e.g. after replacing the image with a different size' }, icon('sort'), h('span', null, 'Offset / scale…')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ctx.replaceImage(), title: 'Upload a new image for this map' }, icon('upload'), h('span', null, 'Replace image…'))),
      hintEl));
  const designTabs = ctx.design?.tabs || [];
  for (const t of designTabs) {
    t.el.classList.add('map-edit-pane');
    t.el.setAttribute('role', 'tabpanel');
    t.el.hidden = true;
  }
  const tabsEl = h('div', { class: 'map-edit-tabs', role: 'tablist', 'aria-label': 'What to edit', hidden: true });
  const el = h('aside', { class: 'map-edit', 'aria-label': 'Edit map', hidden: true },
    h('header', { class: 'map-edit-head' },
      h('div', { class: 'map-edit-titles' }, h('h2', { class: 'map-edit-title' }, 'Edit map'), mapName),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.exit(), title: 'Back to the normal map (Esc)' }, icon('check'), h('span', null, 'Done'))),
    tabsEl,
    placesPane,
    designTabs.map((t) => t.el));

  // ---------- tabs: Places | Design | Pictures | Fog ----------

  const designOn = () => !!ctx.design && !!ctx.canDesign?.();
  function drawTabs() {
    tabsEl.hidden = !designOn();
    if (tabsEl.hidden) { clear(tabsEl); return; }
    mount(tabsEl, [{ id: 'places', label: 'Places', icon: 'pin' }, ...designTabs].map((t) => h('button', {
      type: 'button', role: 'tab', class: ['map-edit-tab', st.tab === t.id && 'is-on'], 'aria-selected': String(st.tab === t.id),
      onclick: () => setTab(t.id),
    }, icon(t.icon), h('span', null, t.label))));
  }
  function setTab(id) {
    if (id !== 'places' && !(designOn() && designTabs.some((t) => t.id === id))) id = 'places';
    const was = st.tab;
    st.tab = id;
    placesPane.hidden = id !== 'places';
    for (const t of designTabs) t.el.hidden = t.id !== id;
    drawTabs();
    if (id === 'places') {
      ctx.design?.hide();
      if (was !== 'places') { renderList(); drawSel(); }
    } else ctx.design.show(id);
  }

  // ---------- undo ----------

  function snapshot(ids) {
    return ids.map((id) => {
      const l = data.locationById(id);
      const path = l?.path || data.locPath(id);
      return { path, doc: store.get(path) };
    });
  }
  function pushUndo(label, snap) {
    st.changed = true;
    st.undo.push({ label, snap });
    if (st.undo.length > 40) st.undo.shift();
    drawUndo();
  }
  function drawUndo() {
    const last = st.undo[st.undo.length - 1];
    undoBtn.disabled = !last;
    undoBtn.title = last ? `Undo: ${last.label} (Ctrl+Z)` : 'Nothing to undo';
  }
  function doUndo() {
    const u = st.undo.pop();
    drawUndo();
    if (!u) return;
    for (const { path, doc } of u.snap) { if (doc) store.put(path, doc); else if (store.has(path)) store.remove(path); }
    toast(`Undone: ${u.label}.`);
  }

  // ---------- selection ----------

  const live = (ids) => ids.filter((id) => data.locationById(id)?.map === ctx.mapId());
  function setSel(ids) {
    st.sel = new Set(live([...ids]));
    ctx.applyStates();
    drawSel();
  }
  function toggle(id, on = !st.sel.has(id)) {
    const n = new Set(st.sel);
    if (on) n.add(id); else n.delete(id);
    setSel(n);
  }
  function selectAll(on) {
    setSel(on ? visibleLocs().map((l) => l.id) : []);
  }
  function drawSel() {
    const listed = visibleLocs();
    const n = st.sel.size;
    countEl.textContent = n ? `${n} of ${ctx.locations().length} selected` : plural(ctx.locations().length, 'place');
    allBox.checked = !!listed.length && listed.every((l) => st.sel.has(l.id));
    allBox.indeterminate = !allBox.checked && listed.some((l) => st.sel.has(l.id));
    for (const [id, r] of st.rows) {
      r.el.classList.toggle('is-picked', st.sel.has(id));
      r.box.checked = st.sel.has(id);
    }
    bulk.hidden = !n;
    if (!n) { clear(bulk); return; }
    const rankSel = h('select', { class: 'select', 'aria-label': 'Set the rank of the selected places', onchange: (e) => { const v = e.target.value; if (v) setField('rank', v === 'auto' ? null : Number(v), 'Set rank'); } },
      h('option', { value: '' }, 'Set rank…'), h('option', { value: 'auto' }, 'Auto (type default)'), RANKS.map((r) => h('option', { value: r.rank }, `${r.rank} · ${r.name}`)));
    const typeSel = h('select', { class: 'select', 'aria-label': 'Set the type of the selected places', onchange: (e) => { if (e.target.value) setField('type', e.target.value, 'Set type'); } },
      h('option', { value: '' }, 'Set type…'), ctx.types().map((t) => h('option', { value: t.id }, t.name)));
    mount(bulk,
      h('div', { class: 'map-edit-bulk-row' }, rankSel, typeSel),
      h('div', { class: 'map-edit-bulk-row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openTransform() }, icon('sort'), h('span', null, 'Move / scale…')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setSel([]) }, 'Clear'),
        h('span', { class: 'map-spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm map-del', onclick: () => removePlaces([...st.sel]) }, icon('trash'), h('span', null, 'Delete…'))));
  }

  function setField(key, value, label) {
    const ids = live([...st.sel]);
    if (!ids.length) return;
    const snap = snapshot(ids);
    for (const id of ids) { const l = data.locationById(id); if (l) data.saveLocation({ ...l, [key]: value }); }
    pushUndo(`${label} of ${plural(ids.length, 'place')}`, snap);
  }

  async function removePlaces(ids) {
    const list = live(ids).map((id) => data.locationById(id)).filter(Boolean);
    if (!list.length) return;
    const notes = list.reduce((n, l) => n + data.backlinks(l).length, 0);
    const msg = list.length === 1 ? `Delete “${list[0].name}”?` : `Delete ${list.length} places?`;
    const extra = notes ? ` ${plural(notes, 'link')} from notes will stop working.` : '';
    if (!(await confirmDialog(`${msg}${extra} You can undo this until you leave edit mode.`, { title: 'Delete places', okLabel: 'Delete', danger: true }))) return;
    const snap = snapshot(list.map((l) => l.id));
    for (const l of list) data.deleteLocation(l);
    pushUndo(list.length === 1 ? `Delete “${list[0].name}”` : `Delete ${list.length} places`, snap);
    setSel([...st.sel].filter((id) => !list.some((l) => l.id === id)));
    toast(`Deleted ${list.length === 1 ? `“${list[0].name}”` : plural(list.length, 'place')}. Undo is in the edit panel.`);
  }

  // ---------- list ----------

  function visibleLocs() {
    const q = nameKey(st.q.trim());
    const all = ctx.locations();
    if (!q) return all;
    return all.filter((l) => nameKey(l.name).includes(q) || nameKey(ctx.typeOf(l.type).name).includes(q) || l.tags.some((t) => nameKey(t).includes(q)));
  }

  const rowSig = (l) => JSON.stringify([l.name, l.type, l.rank, l.submap, l.description, l.x, l.y, st.openRow === l.id, ctx.typeOf(l.type).rank, ctx.typeOf(l.type).name]);
  const summary = (l) => [ctx.typeOf(l.type).name, l.submap && data.mapById(l.submap) ? `opens ${data.mapById(l.submap).name}` : ''].filter(Boolean).join(' · ');

  function buildRow(l, sig) {
    const t = ctx.typeOf(l.type);
    const rank = data.rankOf(l);
    const open = st.openRow === l.id;
    const box = h('input', { type: 'checkbox', checked: st.sel.has(l.id), 'aria-label': `Select ${l.name}`, onchange: (e) => toggle(l.id, e.target.checked) });
    const nameText = h('span', { class: 'map-edit-name-text' }, l.name);
    const small = h('small', null, summary(l));
    const rankEl = h('span', { class: ['map-edit-rank', `rank-${rank}`], title: `Rank ${rank} · ${rankName(rank)}${l.rank ? '' : ' (type default)'}` }, `R${rank}`);
    const row = h('li', { class: ['map-edit-row', st.sel.has(l.id) && 'is-picked', open && 'is-open'], 'data-id': l.id },
      h('div', { class: 'map-edit-line' },
        box, swatch(t),
        h('button', { type: 'button', class: 'map-edit-name', 'aria-expanded': String(open), title: open ? 'Close the editor' : 'Edit this place', onclick: () => onRowClick(l.id) }, nameText, small),
        rankEl,
        h('button', { type: 'button', class: 'btn-icon map-edit-go', title: 'Show it on the map', 'aria-label': `Show ${l.name} on the map`, onclick: () => { setSel([l.id]); ctx.focusLoc(l, true); } }, icon('pin'))),
      open ? rowForm(l) : null);
    return { el: row, box, nameText, small, rankEl, sig };
  }

  function rowForm(l) {
    const cur = () => data.locationById(l.id);
    const save = (patch, label) => {
      const c = cur();
      if (!c) return;
      const snap = snapshot([l.id]);
      data.saveLocation({ ...c, ...patch });
      pushUndo(`${label} “${c.name}”`, snap);
    };
    const nameIn = h('input', {
      class: 'input', value: l.name, maxlength: 120, 'aria-label': 'Name',
      onchange: (e) => { const v = e.target.value.trim(); const c = cur(); if (v && c && v !== c.name) save({ name: v }, 'Rename'); else if (c) e.target.value = c.name; },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
    });
    const types = ctx.types();
    const typeSel = h('select', { class: 'select', 'aria-label': 'Type', onchange: (e) => save({ type: e.target.value }, 'Change type of') },
      types.some((t) => t.id === l.type) ? null : h('option', { value: l.type, selected: true }, ctx.typeOf(l.type).name),
      types.map((t) => h('option', { value: t.id, selected: t.id === l.type }, t.name)));
    const ranks = rankPicker({ value: l.rank, typeRank: ctx.typeOf(l.type).rank, compact: true, onChange: (r) => save({ rank: r }, 'Re-rank') });
    const subSel = h('select', { class: 'select', 'aria-label': 'Opens a map' },
      mapOptions(l.submap || '', { exclude: l.map, none: 'No map' }), h('option', { value: '__new' }, 'New sub-map…'));
    subSel.addEventListener('change', async () => {
      if (subSel.value !== '__new') { save({ submap: subSel.value || null }, 'Link a map to'); return; }
      const id = await ctx.newSubmap({ name: cur()?.name || l.name, parent: l.map });
      if (id) save({ submap: id }, 'Link a map to');
      else subSel.value = cur()?.submap || '';
    });
    const desc = markdownEditor({ value: l.description, rows: 3, placeholder: 'Description. [[links]] work here too.' });
    desc.textarea.addEventListener('change', () => { const c = cur(); if (c && desc.value !== c.description) save({ description: desc.value }, 'Describe'); });
    return h('div', { class: 'map-edit-form' },
      fieldOf('Name', nameIn),
      fieldOf('Type', typeSel),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rank'), ranks, ranks.hint),
      fieldOf('Opens a map', subSel),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), desc),
      h('div', { class: 'map-edit-form-foot' },
        h('span', { class: 'map-pos' }, `Position ${Math.round(l.x)}, ${Math.round(l.y)}`),
        h('span', { class: 'map-spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ctx.openDetails(l.id) }, 'Details'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm map-del', onclick: () => removePlaces([l.id]) }, icon('trash'), h('span', null, 'Delete'))));
  }

  function onRowClick(id) {
    st.openRow = st.openRow === id ? null : id;
    if (!st.sel.has(id) || st.sel.size > 1) setSel([id]);
    const l = data.locationById(id);
    if (l) ctx.focusLoc(l, false);
    renderList();
    if (st.openRow) st.rows.get(id)?.el.querySelector('.map-edit-form input')?.focus({ preventScroll: true });
    st.rows.get(id)?.el.scrollIntoView({ block: 'nearest' });
  }

  function renderList() {
    if (!st.open) return;
    const locs = visibleLocs();
    const focusRow = listEl.contains(document.activeElement) ? document.activeElement.closest('.map-edit-row') : null;
    const ids = new Set(locs.map((l) => l.id));
    for (const id of [...st.rows.keys()]) if (!ids.has(id)) st.rows.delete(id);
    const nodes = locs.map((l) => {
      const old = st.rows.get(l.id);
      const sig = rowSig(l);
      if (old && (old.sig === sig || old.el === focusRow)) {
        if (old.sig !== sig) { // keep the focused row attached; refresh its summary only
          old.nameText.textContent = l.name;
          old.small.textContent = summary(l);
          const r = data.rankOf(l);
          old.rankEl.textContent = `R${r}`;
          old.rankEl.className = `map-edit-rank rank-${r}`;
        }
        return old.el;
      }
      const r = buildRow(l, sig);
      st.rows.set(l.id, r);
      return r.el;
    });
    if (!locs.length) {
      clear(listEl);
      st.rows.clear();
      listEl.append(h('li', { class: 'map-edit-empty' }, ctx.locations().length ? 'No place matches.' : 'No places on this map yet. Right-click (or long-press) the map to add one.'));
    } else reconcile(listEl, nodes);
    drawSel();
  }

  function scrollToRow(id) {
    if (st.q && !visibleLocs().some((l) => l.id === id)) { st.q = ''; searchIn.value = ''; renderList(); }
    st.rows.get(id)?.el.scrollIntoView({ block: 'nearest' });
  }

  // ---------- dragging + nudging ----------

  function dragStart(id) {
    if (!st.sel.has(id)) setSel([id]);
    const ids = [...st.sel];
    st.drag = { id, ids, snap: snapshot(ids), start: new Map(ids.map((i) => [i, ctx.marker(i)?.marker.getLatLng()])) };
  }
  function drag(id) {
    const d = st.drag;
    if (!d || d.id !== id || d.ids.length < 2) return;
    const ll = ctx.marker(id).marker.getLatLng();
    const s0 = d.start.get(id);
    for (const i of d.ids) {
      if (i === id) continue;
      const e = ctx.marker(i);
      const s = d.start.get(i);
      if (e && s) e.marker.setLatLng([s.lat + ll.lat - s0.lat, s.lng + ll.lng - s0.lng]);
    }
  }
  function commitPositions(ids, snap, label) {
    let moved = 0;
    for (const i of ids) {
      const e = ctx.marker(i);
      const loc = data.locationById(i);
      if (!e || !loc) continue;
      const p = ctx.clampXY(ctx.toXY(e.marker.getLatLng()));
      e.marker.setLatLng(ctx.toLatLng(p.x, p.y));
      if (Math.abs(p.x - loc.x) > 0.01 || Math.abs(p.y - loc.y) > 0.01) { data.saveLocation({ ...loc, x: p.x, y: p.y }); moved++; }
    }
    if (moved) pushUndo(`${label} ${plural(moved, 'place')}`, snap);
  }
  function dragEnd() {
    const d = st.drag;
    st.drag = null;
    if (d) commitPositions(d.ids, d.snap, 'Move');
  }
  const commitNudge = debounce(() => {
    const n = st.nudge;
    st.nudge = null;
    if (n) commitPositions(n.ids, n.snap, 'Nudge');
  }, 450);
  function nudge(dx, dy) {
    const k = 2 ** ctx.leaflet().getZoom(); // screen px per image px
    const ids = [...st.sel];
    if (!st.nudge) st.nudge = { ids, snap: snapshot(ids) };
    for (const id of ids) {
      const e = ctx.marker(id);
      if (!e) continue;
      const p = ctx.toXY(e.marker.getLatLng());
      e.marker.setLatLng(ctx.toLatLng(p.x + dx / k, p.y + dy / k));
    }
    commitNudge();
  }

  // ---------- offset / scale ----------

  function openTransform() {
    const info = ctx.info();
    const all = ctx.allLocations ? ctx.allLocations() : ctx.locations(); // places under the fog move too
    const shown = ctx.locations().length;
    const selIds = live([...st.sel]);
    const orig = new Map(all.map((l) => [l.id, { x: l.x, y: l.y }]));
    const f = { scope: selIds.length ? 'sel' : 'all', dx: 0, dy: 0, sx: 100, sy: 100, lock: true, origin: 'zero', oldW: Math.round(info.width), oldH: Math.round(info.height) };
    let applied = false;
    const ids = () => (f.scope === 'sel' ? selIds : all.map((l) => l.id));
    const originPt = (list) => {
      if (f.origin === 'zero') return { x: 0, y: 0 };
      if (f.origin === 'image') return { x: info.width / 2, y: info.height / 2 };
      const ps = list.map((id) => orig.get(id));
      const xs = ps.map((p) => p.x);
      const ys = ps.map((p) => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    };
    const compute = () => {
      const list = ids();
      const o = list.length ? originPt(list) : { x: 0, y: 0 };
      const out = new Map();
      for (const id of list) {
        const p = orig.get(id);
        out.set(id, { x: o.x + ((p.x - o.x) * f.sx) / 100 + f.dx, y: o.y + ((p.y - o.y) * f.sy) / 100 + f.dy });
      }
      return out;
    };
    const outside = h('p', { class: 'field-hint map-dupe', hidden: true });
    const preview = () => {
      const res = compute();
      let off = 0;
      for (const [id, p0] of orig) {
        const p = res.get(id) || p0;
        if (res.has(id) && (p.x < 0 || p.y < 0 || p.x > info.width || p.y > info.height)) off++;
        ctx.marker(id)?.marker.setLatLng(ctx.toLatLng(p.x, p.y));
      }
      outside.hidden = !off;
      outside.textContent = off ? `${plural(off, 'place')} would end up outside the image.` : '';
    };
    const restore = () => { for (const [id, p] of orig) ctx.marker(id)?.marker.setLatLng(ctx.toLatLng(p.x, p.y)); };
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const sxIn = numIn(f.sx, (e) => { f.sx = num(e.target.value) || 100; if (f.lock) { f.sy = f.sx; syIn.value = f.sx; } preview(); }, { 'aria-label': 'Horizontal scale in percent' });
    const syIn = numIn(f.sy, (e) => { f.sy = num(e.target.value) || 100; if (f.lock) { f.sx = f.sy; sxIn.value = f.sy; } preview(); }, { 'aria-label': 'Vertical scale in percent' });
    const lockBox = h('input', { type: 'checkbox', checked: f.lock, onchange: (e) => { f.lock = e.target.checked; if (f.lock) { f.sy = f.sx; syIn.value = f.sx; preview(); } } });
    const radio = (value, label) => h('label', { class: 'checkbox' },
      h('input', { type: 'radio', name: 'map-tr-scope', value, checked: f.scope === value, disabled: value === 'sel' && !selIds.length, onchange: () => { f.scope = value; restore(); preview(); } }),
      h('span', null, label));
    const originSel = h('select', { class: 'select', onchange: (e) => { f.origin = e.target.value; preview(); } },
      h('option', { value: 'zero' }, 'The image’s top-left corner (0, 0)'),
      h('option', { value: 'image' }, 'The middle of the image'),
      h('option', { value: 'places' }, 'The middle of these places'));
    const oldW = numIn(f.oldW, (e) => { f.oldW = num(e.target.value); }, { 'aria-label': 'Old image width', min: 1 });
    const oldH = numIn(f.oldH, (e) => { f.oldH = num(e.target.value); }, { 'aria-label': 'Old image height', min: 1 });
    const fit = () => {
      if (!(f.oldW > 0 && f.oldH > 0)) return;
      f.sx = Math.round((info.width / f.oldW) * 100000) / 1000;
      f.sy = Math.round((info.height / f.oldH) * 100000) / 1000;
      f.lock = Math.abs(f.sx - f.sy) < 0.001;
      lockBox.checked = f.lock;
      sxIn.value = f.sx;
      syIn.value = f.sy;
      f.origin = 'zero';
      originSel.value = 'zero';
      preview();
    };
    const body = h('div', { class: 'stack map-tr' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Apply to'),
        h('div', { class: 'map-tr-radios' }, radio('all', `All ${plural(shown, 'place')} on this map`), radio('sel', selIds.length ? `The ${plural(selIds.length, 'selected place')}` : 'Selected places (none selected)'))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Move by (image pixels)'),
        h('div', { class: 'map-tr-pair' },
          h('label', null, h('span', null, 'Right'), numIn(0, (e) => { f.dx = num(e.target.value); preview(); }, { 'aria-label': 'Move right by' })),
          h('label', null, h('span', null, 'Down'), numIn(0, (e) => { f.dy = num(e.target.value); preview(); }, { 'aria-label': 'Move down by' }))),
        h('span', { class: 'field-hint' }, 'Negative numbers move left / up.')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Scale (%)'),
        h('div', { class: 'map-tr-pair' },
          h('label', null, h('span', null, 'Across'), sxIn),
          h('label', null, h('span', null, 'Down'), syIn),
          h('label', { class: 'checkbox' }, lockBox, h('span', null, 'Keep proportions')))),
      fieldOf('Scale around', originSel),
      h('div', { class: 'field map-tr-fit' }, h('span', { class: 'field-label' }, 'Replaced the image with a different size?'),
        h('div', { class: 'map-tr-pair' },
          h('span', null, 'Pins were placed on'), oldW, h('span', null, '×'), oldH,
          h('button', { type: 'button', class: 'btn btn-sm', onclick: fit }, `Fit to ${Math.round(info.width)} × ${Math.round(info.height)}`)),
        h('span', { class: 'field-hint' }, 'Enter the old image size; the pins are scaled to the current image.')),
      outside,
      h('p', { class: 'muted map-tr-note' }, `The map previews the result. Nothing is saved until you press Apply (and then ${majorSaveOn() ? 'Done' : 'Save'}).`));
    openModal({
      title: 'Offset / scale pins',
      body,
      className: 'map-tr-modal',
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Apply',
          kind: 'primary',
          onClick: () => {
            const res = compute();
            const list = [...res.keys()];
            const snap = snapshot(list);
            for (const id of list) { const l = data.locationById(id); const p = res.get(id); if (l) data.saveLocation({ ...l, x: p.x, y: p.y }); }
            applied = true;
            if (list.length) pushUndo(`Offset / scale ${plural(list.length, 'place')}`, snap);
          },
        },
      ],
      onClose: () => { if (!applied) restore(); },
    });
    preview();
  }

  // ---------- zoom bands ----------

  let staged = null; // {bands, mapId} not yet written
  const curBands = () => staged?.bands || normBands(ctx.info().bands);
  const writeBands = debounce(() => {
    const s = staged;
    staged = null;
    if (!s || !data.mapById(s.mapId)) return;
    st.changed = true;
    data.writeMapConfig(s.mapId, { rankBands: sameBands(s.bands, DEFAULT_BANDS) ? undefined : s.bands });
  }, 500);
  function setBands(b) {
    staged = { bands: normBands(b), mapId: ctx.mapId() };
    ctx.setBandPreview(staged.bands);
    writeBands();
    drawBands();
  }
  function drawBands() {
    if (!bandsEl.open) { clear(bandsBody); return; }
    const b = curBands();
    const u = Math.round(ctx.zoomU() * 100);
    const sh = ctx.rankShift();
    mount(bandsBody,
      h('p', { class: 'map-edit-hint' }, 'Each band shows between two zoom positions: 0% is fully zoomed out, 100% fully zoomed in. While this is open the map previews the bands.'),
      sh ? h('p', { class: 'map-edit-hint' }, `The most important places here are rank ${sh + 1}, so rank ${sh + 1} uses the first band.`) : null,
      h('ul', { class: 'map-bands', role: 'list' }, RANKS.map((r, i) => {
        const [a, z] = b[i];
        const who = RANKS[i + sh];
        return h('li', { class: ['map-band', !who && 'is-unused'] },
          h('span', { class: 'map-band-name' }, who ? `${who.rank} · ${who.name}` : `Band ${i + 1}`),
          h('span', { class: 'map-band-track', 'aria-hidden': 'true' },
            h('i', { class: `map-band-seg rank-${r.rank}`, style: `left:${a}%;width:${z - a}%` }),
            h('b', { class: 'map-band-now', style: `left:${u}%` })),
          h('span', { class: 'map-band-nums' },
            numIn(a, (e) => { const n = b.map((x) => [...x]); n[i][0] = Number(e.target.value); setBands(n); }, { min: 0, max: 100, step: 1, disabled: i === 0, 'aria-label': `Rank ${r.rank} appears at (%)` }),
            h('span', null, '–'),
            numIn(z, (e) => { const n = b.map((x) => [...x]); n[i][1] = Number(e.target.value); setBands(n); }, { min: 0, max: 100, step: 1, disabled: i === 3, 'aria-label': `Rank ${r.rank} hides at (%)` })));
      })),
      h('div', { class: 'map-band-foot' },
        h('span', { class: 'map-edit-hint' }, `Now: ${u}%`),
        h('span', { class: 'map-spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: sameBands(b, DEFAULT_BANDS), onclick: () => setBands(DEFAULT_BANDS) }, 'Reset to default')));
  }

  // ---------- api ----------

  return {
    el,
    get isOpen() { return st.open; },
    get selection() { return st.sel; },
    isSelected: (id) => st.open && st.sel.has(id),
    /** Positions of these pins are being changed here; the view must not reset them from the store. */
    isDragging: (id) => !!(st.drag?.ids.includes(id) || st.nudge?.ids.includes(id)),
    /** Open edit mode on a tab ('places', or 'design' | 'pictures' | 'fog' for the DM). */
    open(tab = 'places') {
      st.open = true;
      st.changed = false;
      el.hidden = false;
      mapName.textContent = ctx.info().name;
      drawHint();
      renderList();
      drawUndo();
      st.tab = 'places';
      setTab(tab);
    },
    get tab() { return st.open ? st.tab : null; },
    setTab: (id) => { if (st.open) setTab(id); },
    /** Something was changed in a design tab: commit when editing ends. */
    markChanged() { st.changed = true; },
    /** DM mode turned on or off while editing: the design tabs come or go. */
    dmChanged() { if (st.open) setTab(designOn() ? st.tab : 'places'); },
    /** Leave edit mode (pending nudges and bands are written first). Returns true when anything was changed. */
    close() {
      commitNudge.flush();
      if (staged) writeBands.flush();
      ctx.design?.hide();
      for (const t of designTabs) t.el.hidden = true;
      placesPane.hidden = false;
      st.tab = 'places';
      const changed = st.changed;
      st.changed = false;
      st.open = false;
      st.openRow = null;
      st.sel = new Set();
      st.undo = [];
      el.hidden = true;
      if (bandsEl.open) bandsEl.open = false;
      ctx.setBandPreview(null);
      clear(listEl);
      st.rows.clear();
      return changed;
    },
    refresh() {
      if (!st.open) return;
      mapName.textContent = ctx.info().name;
      renderList();
      drawBands();
    },
    mapChanged() {
      if (!st.open) return;
      ctx.design?.mapChanged();
      commitNudge.flush();
      if (staged) writeBands.flush();
      st.sel = new Set();
      st.openRow = null;
      st.rows.clear();
      clear(listEl);
      if (bandsEl.open) ctx.setBandPreview(curBands());
      this.refresh();
    },
    onZoom() { if (st.open && bandsEl.open) drawBands(); },
    /** Write pending nudges/bands now (before the markers of this map go away). */
    flush() {
      commitNudge.flush();
      if (staged) writeBands.flush();
    },
    onMarkerClick(id, ev) {
      if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) toggle(id);
      else setSel([id]);
      scrollToRow(id);
    },
    clearSelection() { if (!st.sel.size) return false; setSel([]); return true; },
    dragStart,
    drag,
    dragEnd,
    /** Keys while editing (called in the capture phase). Returns true when handled. */
    onKey(e) {
      if (!st.open || document.querySelector('.modal-backdrop')) return false;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return false;
      if (!(ctx.root.contains(t) || t === document.body)) return false;
      if (st.tab !== 'places') return !!ctx.design?.onKey(e);
      const step = e.shiftKey ? 10 : 1;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key] && st.sel.size && !e.ctrlKey && !e.metaKey && !e.altKey) { nudge(...arrows[e.key]); return true; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel.size) { removePlaces([...st.sel]); return true; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { selectAll(true); return true; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { doUndo(); return true; }
      return false;
    },
  };
}
