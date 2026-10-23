// The Design, Pictures and Fog tabs of Edit map (edit.js shows them to the DM, or to everyone while no DM is set up).
//   Design: background, crop, compass, scale bar / ruler and travel time, border; "Hide compass, scale and border".
//   Pictures: add uploaded pictures to the map, then move, resize, turn, fade, stack, hide (DM) or delete them.
//   Fog: paint fog or reveal with a brush, rectangle or lasso; cover / reveal all; undo; its look; preview as players.
// Sliders preview while dragged and are written when let go; every change is a store draft that the view commits
// when editing ends (Done), like the rest of Edit map. docs/map-design.md.
import { h, mount } from '../../core/dom.js';
import { icon, toast, promptDialog, select } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { slugify, stripExt, extOf } from '../../core/util.js';
import { visibilityToggle, hiddenMark } from '../../core/dm-ui.js';
import {
  BACKGROUNDS, COMPASS_TYPES, CORNERS, UNITS, SCALE_STYLES, BORDER_TYPES, INK, normCrop, compassSvg, fmtNum, unitName,
} from './design.js';
import { FOG_STYLES } from './fog.js';
import * as data from './data.js';

const SWATCHES = [INK, '#ffffff', '#8e1b1b', '#22507c', '#8f6a14', '#23675f', '#465266'];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const BG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'avif']);

function pickFile() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*', style: 'position:fixed;left:-9999px;top:0' });
    let done = false;
    const finish = (f) => { if (done) return; done = true; inp.remove(); resolve(f); };
    inp.addEventListener('change', () => finish(inp.files?.[0] || null));
    inp.addEventListener('cancel', () => finish(null));
    document.body.append(inp);
    inp.click();
  });
}

// ---------- small controls (data-k: focus survives a redraw) ----------

const section = (title, ...kids) => h('section', { class: 'map-ds-sec' }, h('h3', { class: 'map-ds-title' }, title), ...kids);
const hint = (text) => h('p', { class: 'map-ds-hint' }, text);
const row = (...kids) => h('div', { class: 'map-ds-row' }, ...kids);

function toggle(k, label, on, onchange) {
  return h('label', { class: 'map-ds-switch' },
    h('input', { type: 'checkbox', role: 'switch', checked: !!on, 'data-k': k, onchange: (e) => onchange(e.target.checked) }),
    h('span', null, label));
}

function segmented(k, label, options, value, onchange, { icons = false } = {}) {
  return h('div', { class: 'map-ds-seg', role: 'radiogroup', 'aria-label': label },
    options.map((o) => h('button', {
      type: 'button', role: 'radio', class: ['map-ds-seg-btn', o.id === value && 'is-on'], 'aria-checked': String(o.id === value),
      'data-k': `${k}:${o.id}`, title: o.hint || o.label, onclick: () => { if (o.id !== value) onchange(o.id); },
    }, icons && o.icon ? icon(o.icon) : null, h('span', null, o.label))));
}

/** A slider: oninput previews (value), onchange writes (value). */
function range(k, label, { min, max, step = 1, value, fmt = String, oninput, onchange }) {
  const out = h('output', { class: 'map-ds-out' }, fmt(value));
  const inp = h('input', {
    type: 'range', class: 'map-ds-range', min, max, step, value, 'data-k': k, 'aria-label': label,
    oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); oninput?.(v); },
    onchange: (e) => onchange?.(Number(e.target.value)),
  });
  return h('label', { class: 'map-ds-field' }, h('span', { class: 'map-ds-label' }, label, out), inp);
}

function colors(k, value, onchange) {
  return h('div', { class: 'map-ds-colors', role: 'group', 'aria-label': 'Color' },
    SWATCHES.map((c) => h('button', {
      type: 'button', class: ['map-ds-swatch', c === value && 'is-on'], style: { background: c }, 'data-k': `${k}:${c}`,
      'aria-label': c === INK ? 'Ink' : c === '#ffffff' ? 'White' : c, 'aria-pressed': String(c === value), onclick: () => onchange(c),
    })),
    h('input', { type: 'color', class: 'map-ds-color', value, 'data-k': `${k}:custom`, 'aria-label': 'Custom color', onchange: (e) => onchange(e.target.value) }));
}

const field = (label, control) => h('label', { class: 'map-ds-field' }, h('span', { class: 'map-ds-label' }, label), control);

/**
 * ctx: {mapId(), info(), design() -> the map's design, preview(design) (show without saving), write(design),
 *       startCrop(rect, {change, commit}), stopCrop(), cropping(), fog (fogview.js), pictures (pictures.js),
 *       pickPoints(n, text) -> Promise<[{x, y}]|null>, shown() -> the shown part of the image {x, y, w, h},
 *       edited(), setTab(id|null) (which design tab is open, for the view)}
 */
export function createDesignPanel(ctx) {
  const st = { tab: null, d: null, lastShown: null, tool: { kind: 'pan', mode: 'cut', size: 70 }, cropText: null };
  const designEl = h('div', { class: 'map-ds', 'data-tab': 'design' });
  const picsEl = h('div', { class: 'map-ds', 'data-tab': 'pictures' });
  const fogEl = h('div', { class: 'map-ds', 'data-tab': 'fog' });

  /** Redraw a tab, keeping the focus on the same control. */
  function redraw(el, draw) {
    const k = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset?.k : null;
    draw();
    if (k) el.querySelector(`[data-k="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  }

  // ---------- design ----------

  const D = () => st.d || (st.d = structuredClone(ctx.design()));
  const preview = () => ctx.preview(D());
  const commit = (redrawToo = true) => { ctx.write(D()); ctx.edited(); if (redrawToo) redraw(designEl, drawDesign); };
  const set = (fn, redrawToo = true) => { fn(D()); preview(); commit(redrawToo); };

  function toggleAll() {
    const d = D();
    const shown = { compass: d.compass.show, scale: d.scale.show, border: d.border.show };
    if (shown.compass || shown.scale || shown.border) {
      st.lastShown = shown;
      set((x) => { x.compass.show = false; x.scale.show = false; x.border.show = false; });
      toast('Compass, scale bar and border are hidden. The same button shows them again.');
    } else {
      const s = st.lastShown || { compass: true, scale: d.scale.perPx > 0, border: true };
      set((x) => { x.compass.show = s.compass; x.scale.show = s.scale; x.border.show = s.border; });
    }
  }

  async function uploadBackground() {
    const file = await pickFile();
    if (!file) return;
    let ext = extOf(file.name);
    if (ext === 'jpeg') ext = 'jpg';
    if (!BG_EXT.has(ext)) { toast('Choose a PNG, JPG, WebP, AVIF or SVG image.', { type: 'error' }); return; }
    if (file.size > 15 * 1048576) { toast('That image is over 15 MB. A background texture can be much smaller.', { type: 'error' }); return; }
    const mapId = ctx.mapId();
    const path = `${data.mapImageDir(mapId)}/background-${slugify(stripExt(file.name)).slice(0, 30) || 'image'}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    try { await store.putBinary(path, file, { hidden: data.mapHidden(mapId) }); } catch (e) { toast(`Could not add the image: ${e.message || e}`, { type: 'error' }); return; }
    const old = D().background.image;
    set((x) => { x.background = { ...x.background, kind: 'image', image: path }; });
    if (old && old !== path && old.startsWith(`${data.mapImageDir(mapId)}/background-`)) store.remove(old);
  }

  function cropSummary() {
    const info = ctx.info();
    const c = D().crop;
    return c ? `Showing ${Math.round(c.w)} × ${Math.round(c.h)} px of ${Math.round(info.width)} × ${Math.round(info.height)}.` : 'The whole image is shown.';
  }
  function startCrop() {
    const info = ctx.info();
    const rect = D().crop || { x: 0, y: 0, w: info.width, h: info.height };
    ctx.startCrop(rect, {
      change: (r) => { if (st.cropText) st.cropText.textContent = `Showing ${r.w} × ${r.h} px of ${Math.round(info.width)} × ${Math.round(info.height)}.`; },
      commit: (r) => { D().crop = normCrop(r, info.width, info.height); ctx.write(D()); ctx.edited(); },
    });
    redraw(designEl, drawDesign);
  }
  function stopCrop() { ctx.stopCrop(); preview(); redraw(designEl, drawDesign); }

  async function calibrate() {
    const d = D();
    const pts = await ctx.pickPoints(2, 'Click two points on the map whose distance you know (two towns, the ends of a road…).');
    if (!pts) return;
    const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (px < 1) { toast('Pick two different points.'); return; }
    const unit = unitName(d.scale, 2);
    const v = await promptDialog('Distance between the two points', { label: `In ${unit}`, placeholder: 'e.g. 40', okLabel: 'Set the scale' });
    const n = Number(String(v ?? '').replace(',', '.'));
    if (!(n > 0)) return;
    set((x) => { x.scale.perPx = n / px; if (!x.scale.show) x.scale.show = true; });
    toast(`Scale set: ${fmtNum(n)} ${unit} between the two points.`, { type: 'success' });
  }

  function drawDesign() {
    const d = D();
    const info = ctx.info();
    const shownW = ctx.shown().w || info.width || 1;
    const any = d.compass.show || d.scale.show || d.border.show;
    const cropping = ctx.cropping();
    st.cropText = h('p', { class: 'map-ds-hint' }, cropSummary());
    const c = d.compass;
    const s = d.scale;
    const b = d.border;
    const across = s.perPx > 0 ? Math.round(s.perPx * shownW * 1000) / 1000 : '';
    mount(designEl,
      h('div', { class: 'map-ds-top' },
        hint('This is how everyone sees the map. Your changes reach the party when you press Done.'),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'all', onclick: toggleAll },
          icon(any ? 'eye-off' : 'eye'), h('span', null, any ? 'Hide compass, scale and border' : 'Show compass, scale and border'))),
      section('Background',
        segmented('bg', 'Background', BACKGROUNDS, d.background.kind, (v) => {
          if (v === 'image' && !d.background.image) { uploadBackground(); return; }
          set((x) => { x.background.kind = v; });
        }),
        d.background.kind === 'color' ? colors('bgc', d.background.color, (v) => set((x) => { x.background.color = v; })) : null,
        d.background.kind === 'image' ? row(
          segmented('bgfit', 'Image fit', [{ id: 'tile', label: 'Tile' }, { id: 'cover', label: 'Cover' }], d.background.fit, (v) => set((x) => { x.background.fit = v; })),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'bgup', onclick: uploadBackground }, icon('upload'), h('span', null, 'Replace…'))) : null,
        hint('Shown around the map image, where it is cropped or when zoomed out.')),
      section('Crop',
        st.cropText,
        cropping
          ? row(h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-k': 'cropdone', onclick: stopCrop }, icon('check'), h('span', null, 'Done cropping')),
            h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'cropall', onclick: () => { D().crop = null; ctx.write(D()); ctx.edited(); stopCrop(); } }, h('span', null, 'Whole image')))
          : row(h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'crop', onclick: startCrop }, icon('crop'), h('span', null, d.crop ? 'Adjust the crop' : 'Crop the image…')),
            d.crop ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-k': 'cropall', onclick: () => set((x) => { x.crop = null; }) }, h('span', null, 'Whole image')) : null),
        cropping ? hint('Drag the handles on the map. Places outside the crop stay where they are.') : null),
      section('Compass',
        toggle('cshow', 'Show a compass', c.show, (v) => set((x) => { x.compass.show = v; })),
        c.show ? [
          h('div', { class: 'map-ds-compasses', role: 'radiogroup', 'aria-label': 'Compass style' }, COMPASS_TYPES.map((t) => h('button', {
            type: 'button', role: 'radio', class: ['map-ds-compass', t.id === c.type && 'is-on'], 'aria-checked': String(t.id === c.type), title: t.label,
            'aria-label': t.label, 'data-k': `ctype:${t.id}`, innerHTML: compassSvg(t.id, { color: c.color, title: t.label }), onclick: () => set((x) => { x.compass.type = t.id; }),
          }))),
          segmented('canchor', 'Where', [{ id: 'screen', label: 'Screen corner' }, { id: 'map', label: 'On the map' }], c.anchor, (v) => set((x) => { x.compass.anchor = v; })),
          c.anchor === 'screen'
            ? [field('Corner', select(CORNERS.map((x) => ({ value: x.id, label: x.label })), c.corner, (v) => set((x) => { x.compass.corner = v; }), { 'data-k': 'ccorner' })),
              range('csize', 'Size', { min: 48, max: 260, value: c.size, fmt: (v) => `${v} px`, oninput: (v) => { D().compass.size = v; preview(); }, onchange: () => commit(false) })]
            : [range('cmsize', 'Size', { min: 3, max: 60, value: Math.round(c.mapSize * 100), fmt: (v) => `${v}% of the map`, oninput: (v) => { D().compass.mapSize = v / 100; preview(); }, onchange: () => commit(false) }),
              hint('Drag the compass on the map to move it.')],
          range('crot', 'North points', { min: 0, max: 359, value: c.rotation, fmt: (v) => `${v}°`, oninput: (v) => { D().compass.rotation = v; preview(); }, onchange: () => commit(false) }),
          colors('ccol', c.color, (v) => set((x) => { x.compass.color = v; })),
        ] : null),
      section('Scale and ruler',
        row(field('Unit', select(UNITS.map((u) => ({ value: u.id, label: u.id === 'custom' ? 'Other…' : u.many })), s.unit, (v) => set((x) => { x.scale.unit = v; }), { 'data-k': 'unit' })),
          s.unit === 'custom' ? field('Name', h('input', { class: 'input', value: s.custom, maxlength: 24, placeholder: 'e.g. hexes', 'data-k': 'ucustom', onchange: (e) => set((x) => { x.scale.custom = e.target.value; }, false) })) : null),
        row(field(`The shown map is … ${unitName(s, 2)} across`, h('input', {
          class: 'input input-number', type: 'number', min: 0, step: 'any', value: across, placeholder: 'e.g. 300', 'data-k': 'across',
          onchange: (e) => { const v = Number(e.target.value); set((x) => { x.scale.perPx = v > 0 ? v / shownW : 0; if (v > 0 && !x.scale.show) x.scale.show = true; }); },
        })), h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'calib', onclick: calibrate, title: 'Set the scale from two points on the map' }, icon('ruler'), h('span', null, 'Measure two points…'))),
        s.perPx > 0 ? [
          toggle('sshow', 'Show a scale bar', s.show, (v) => set((x) => { x.scale.show = v; })),
          s.show ? row(field('Style', select(SCALE_STYLES.map((x) => ({ value: x.id, label: x.label })), s.style, (v) => set((x) => { x.scale.style = v; }), { 'data-k': 'sstyle' })),
            field('Corner', select(CORNERS.map((x) => ({ value: x.id, label: x.label })), s.corner, (v) => set((x) => { x.scale.corner = v; }), { 'data-k': 'scorner' }))) : null,
          toggle('ruler', 'Ruler: everyone can measure distances', s.ruler, (v) => set((x) => { x.scale.ruler = v; })),
          toggle('pace', 'Show travel time with distances', s.pace.on, (v) => set((x) => { x.scale.pace.on = v; })),
          s.pace.on ? row(
            field(`${unitName(s, 2)} per…`, h('input', { class: 'input input-number', type: 'number', min: 0, step: 'any', value: s.pace.per, 'data-k': 'pper', onchange: (e) => set((x) => { x.scale.pace.per = Number(e.target.value) || 24; }, false) })),
            field('Unit of time', h('input', { class: 'input', value: s.pace.label, maxlength: 24, 'data-k': 'plabel', onchange: (e) => set((x) => { x.scale.pace.label = e.target.value.trim() || 'days on foot'; }, false) }))) : null,
          s.pace.on ? hint('D&D travel pace: 24 miles a day at a normal pace, 30 fast, 18 slow.') : null,
        ] : hint('Set the distance first: type how far it is across, or measure two points.')),
      section('Border',
        toggle('bshow', 'Show a border', b.show, (v) => set((x) => { x.border.show = v; })),
        b.show ? [
          field('Style', select(BORDER_TYPES.map((x) => ({ value: x.id, label: x.label })), b.type, (v) => set((x) => { x.border.type = v; }), { 'data-k': 'btype' })),
          range('bwidth', 'Thickness', { min: 0.3, max: 6, step: 0.1, value: b.width, fmt: (v) => `${v}%`, oninput: (v) => { D().border.width = v; preview(); }, onchange: () => commit(false) }),
          colors('bcol', b.color, (v) => set((x) => { x.border.color = v; })),
        ] : null));
  }

  // ---------- pictures ----------

  function drawPictures() {
    const mapId = ctx.mapId();
    const list = data.picturesOn(mapId);
    const sel = ctx.pictures.selected;
    const front = (p, dir) => {
      const orders = list.map((x) => x.order);
      data.savePicture({ ...p, order: dir > 0 ? Math.max(...orders) + 1 : Math.min(...orders) - 1 });
      ctx.edited();
    };
    const rowOf = (p) => {
      const open = p.id === sel;
      const thumb = h('img', { class: 'map-ds-thumb', alt: '' });
      (/^https:/i.test(p.src) ? Promise.resolve(p.src) : store.fileUrl(p.src)).then((u) => { if (u) thumb.src = u; }).catch(() => {});
      return h('li', { class: ['map-ds-pic', open && 'is-open'] },
        h('button', { type: 'button', class: 'map-ds-pic-line', 'aria-expanded': String(open), 'data-k': `pic:${p.id}`, onclick: () => ctx.pictures.select(open ? null : p.id) },
          thumb, h('span', { class: 'map-ds-pic-name' }, p.name), hiddenMark(p.path)),
        open ? h('div', { class: 'map-ds-pic-form' },
          field('Name', h('input', { class: 'input', value: p.name, maxlength: 60, 'data-k': 'pname', onchange: (e) => { data.savePicture({ ...p, name: e.target.value }); ctx.edited(); } })),
          range('pop', 'Opacity', { min: 5, max: 100, value: Math.round(p.opacity * 100), fmt: (v) => `${v}%`, oninput: (v) => ctx.pictures.preview(p.id, { opacity: v / 100 }), onchange: (v) => { data.savePicture({ ...p, opacity: v / 100 }); ctx.edited(); } }),
          range('prot', 'Turn', { min: 0, max: 359, value: Math.round(p.rotation), fmt: (v) => `${v}°`, oninput: (v) => ctx.pictures.preview(p.id, { rotation: v }), onchange: (v) => { data.savePicture({ ...p, rotation: v }); ctx.edited(); } }),
          row(
            h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'pfront', onclick: () => front(p, 1), title: 'Above the other pictures' }, h('span', null, 'Bring to front')),
            h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'pback', onclick: () => front(p, -1), title: 'Below the other pictures' }, h('span', null, 'Send to back')),
            h('button', { type: 'button', class: 'btn btn-sm btn-ghost map-del', 'data-k': 'pdel', onclick: () => { data.deletePicture(p); ctx.edited(); toast(`Removed “${p.name}” from the map.`); } }, icon('trash'), h('span', null, 'Delete'))),
          visibilityToggle(p.path, { label: 'this picture' })) : null);
    };
    mount(picsEl,
      h('div', { class: 'map-ds-top' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-k': 'padd', onclick: () => ctx.pictures.add() }, icon('upload'), h('span', null, 'Add a picture…')),
        hint(list.length ? 'Drag a picture on the map to move it, a corner to resize it, the knob above it to turn it (Shift: 15° steps).' : 'Lay drawings, handouts, tokens or landmarks on the map. They sit under the fog and the pins.')),
      list.length ? h('ul', { class: 'map-ds-pics', role: 'list' }, [...list].reverse().map(rowOf)) : null);
  }

  // ---------- fog ----------

  const TOOLS = [
    { id: 'pan', label: 'Move map', icon: 'hand' },
    { id: 'brush', label: 'Brush', icon: 'brush' },
    { id: 'rect', label: 'Rectangle', icon: 'square-dashed' },
    { id: 'lasso', label: 'Lasso', icon: 'lasso' },
  ];
  function applyTool() {
    const t = st.tool;
    ctx.fog.setTool(st.tab === 'fog' && t.kind !== 'pan' ? t : null);
  }
  const countText = (n) => (n ? `${plural(n, 'stroke')} so far.` : 'No fog yet. “Cover all”, then reveal, is the quickest start.');
  function drawFog() {
    const f = ctx.fog.fog;
    const t = st.tool;
    const n = f.ops.length;
    mount(fogEl,
      h('div', { class: 'map-ds-top' },
        toggle('fon', 'Show the fog', f.on, (v) => { ctx.fog.setStyle({ on: v }); redraw(fogEl, drawFog); }),
        hint('Players see the fog as painted, and places under it are hidden from them until you reveal them. You see through it.')),
      section('Paint',
        segmented('ftool', 'Tool', TOOLS, t.kind, (v) => { t.kind = v; applyTool(); redraw(fogEl, drawFog); }, { icons: true }),
        t.kind !== 'pan' ? segmented('fmode', 'Paint', [{ id: 'add', label: 'Add fog' }, { id: 'cut', label: 'Reveal' }], t.mode, (v) => { t.mode = v; applyTool(); redraw(fogEl, drawFog); }) : null,
        t.kind === 'brush' ? range('fsize', 'Brush size', { min: 10, max: 260, value: t.size, fmt: (v) => `${v} px`, oninput: (v) => { t.size = v; applyTool(); } }) : null,
        hint(t.kind === 'pan' ? 'Pick a tool to paint on the map (keys B, R, L; M moves the map again).' : `${t.kind === 'brush' ? 'Drag on the map to paint.' : t.kind === 'rect' ? 'Drag a rectangle on the map.' : 'Draw a closed shape on the map.'} The wheel still zooms; “Move map” pans.`),
        row(
          h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'fcover', onclick: () => { ctx.fog.coverAll(); redraw(fogEl, drawFog); }, title: 'Fog over the whole map; then reveal what the party knows' }, icon('cloud'), h('span', null, 'Cover all')),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'freveal', onclick: () => { ctx.fog.revealAll(); redraw(fogEl, drawFog); } }, icon('eye'), h('span', null, 'Reveal all')),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'fundo', disabled: !ctx.fog.canUndo, onclick: () => { ctx.fog.undo(); redraw(fogEl, drawFog); }, title: 'Undo (Ctrl+Z)' }, icon('undo'), h('span', null, 'Undo')),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-k': 'fredo', disabled: !ctx.fog.canRedo, onclick: () => { ctx.fog.redo(); redraw(fogEl, drawFog); }, title: 'Redo (Ctrl+Shift+Z)' }, h('span', null, 'Redo'))),
        h('p', { class: 'map-ds-hint', 'data-count': '' }, countText(n))),
      section('Look',
        segmented('fstyle', 'Style', FOG_STYLES, f.style, (v) => { ctx.fog.setStyle({ style: v }); redraw(fogEl, drawFog); }),
        f.style === 'solid' ? colors('fcol', f.color, (v) => { ctx.fog.setStyle({ color: v }); redraw(fogEl, drawFog); }) : null,
        range('fop', 'Opacity', { min: 20, max: 100, value: Math.round(f.opacity * 100), fmt: (v) => `${v}%`, onchange: (v) => ctx.fog.setStyle({ opacity: v / 100 }) }),
        range('fsoft', 'Soft edges', { min: 0, max: 100, value: Math.round(f.softness * 100), fmt: (v) => `${v}%`, onchange: (v) => ctx.fog.setStyle({ softness: v / 100 }) }),
        hint('Faded color with a lower opacity lets players glimpse the land beneath.')),
      section('Check',
        toggle('fprev', 'Preview as the players see it', ctx.fog.preview, (v) => ctx.fog.setPreview(v)),
        hint('Players who open the map after you reveal land see the fog clear gradually. The fog only covers the picture: for a true secret, also hide the place itself (DM mode).')));
  }

  // ---------- api ----------

  const tabs = [
    { id: 'design', label: 'Design', icon: 'compass', el: designEl },
    { id: 'pictures', label: 'Pictures', icon: 'image', el: picsEl },
    { id: 'fog', label: 'Fog', icon: 'cloud', el: fogEl },
  ];
  const draws = { design: () => redraw(designEl, drawDesign), pictures: () => redraw(picsEl, drawPictures), fog: () => redraw(fogEl, drawFog) };

  return {
    tabs,
    /** Open a tab (edit.js has shown its element). */
    show(id) {
      if (st.tab && st.tab !== id) this.hide();
      st.tab = id;
      st.d = null;
      ctx.setTab(id);
      ctx.pictures.setEditing(id === 'pictures');
      applyTool();
      draws[id]?.();
    },
    /** Leave the open tab (another tab, Done, or another map). */
    hide() {
      if (!st.tab) return;
      if (ctx.cropping()) ctx.stopCrop();
      ctx.fog.setTool(null);
      ctx.pictures.setEditing(false);
      st.tab = null;
      st.d = null;
      ctx.setTab(null);
      ctx.preview(null);
    },
    get tab() { return st.tab; },
    /** The store changed (pictures, fog, the map): redraw what may be out of date. Sliders are never mid-drag here. */
    refresh(kind = null) {
      if (st.tab === 'design' && kind === 'design') { st.d = null; if (!ctx.cropping()) ctx.preview(D()); draws.design(); }
      if (st.tab === 'pictures' && (!kind || kind === 'pictures')) draws.pictures();
      if (st.tab === 'fog' && (!kind || kind === 'fog')) {
        const u = fogEl.querySelector('[data-k="fundo"]');
        const r = fogEl.querySelector('[data-k="fredo"]');
        if (u) u.disabled = !ctx.fog.canUndo;
        if (r) r.disabled = !ctx.fog.canRedo;
        const c = fogEl.querySelector('[data-count]');
        if (c) c.textContent = countText(ctx.fog.fog.ops.length);
      }
    },
    pictureSelected() { if (st.tab === 'pictures') draws.pictures(); },
    /** Change the design from the map (the compass dragged to a new spot): saved like a change made here. */
    patch(fn) { set(fn, st.tab === 'design'); },
    mapChanged() {
      if (!st.tab) return;
      const id = st.tab;
      this.hide();
      ctx.fog.resetHistory();
      this.show(id);
    },
    /** Keys while a design tab is open. Returns true when handled. */
    onKey(e) {
      if (!st.tab) return false;
      const z = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      if (st.tab === 'fog' && z) { if (e.shiftKey) ctx.fog.redo(); else ctx.fog.undo(); draws.fog(); return true; }
      if (st.tab === 'pictures' && (e.key === 'Delete' || e.key === 'Backspace') && ctx.pictures.selected) {
        const p = data.pictureById(ctx.pictures.selected);
        if (p) { data.deletePicture(p); ctx.edited(); toast(`Removed “${p.name}” from the map.`); }
        return true;
      }
      if (st.tab === 'fog' && /^[bBrRlLmM]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        st.tool.kind = { b: 'brush', r: 'rect', l: 'lasso', m: 'pan' }[e.key.toLowerCase()];
        applyTool();
        draws.fog();
        return true;
      }
      return false;
    },
  };
}
