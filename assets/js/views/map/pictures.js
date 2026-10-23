// Pictures laid on a map (data.js picturesOn): uploaded images placed, sized and turned anywhere on the map, above
// the map image and below the fog and the pins. The Pictures tab of Edit map (designpanel.js) adds them; while it is
// open the pictures take the pointer: drag one to move it, a corner handle to resize it (it keeps its shape), the
// knob above it to turn it (Shift: 15° steps). Hidden pictures (DM mode) show with a dashed outline.
import { h } from '../../core/dom.js';
import { toast } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { slugify, stripExt, extOf } from '../../core/util.js';
import { isHidden, dmNewHidden, isDm } from '../../core/dm.js';
import { boundsLayer, pxPerImagePx } from './layers.js';
import * as data from './data.js';

export const PIC_PANE = 'mapPictures';
const OK_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']);
const MAX_IN = 40 * 1024 * 1024;
const MAX_SIDE = 4096; // larger raster pictures are scaled down (WebP keeps transparency)
const SHRINK_OVER = 4 * 1024 * 1024;

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

function naturalSize(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth || 300, h: img.naturalHeight || 200, img, url }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** The file as it will be stored: big rasters shrink to MAX_SIDE as WebP. -> {blob, ext, w, h} */
async function prepare(file) {
  let ext = extOf(file.name) || (file.type.split('/')[1] || '').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  if (!OK_EXT.has(ext)) throw new Error('Choose an image (PNG, JPG, WebP, GIF, AVIF or SVG).');
  if (file.size > MAX_IN) throw new Error(`That image is ${Math.round(file.size / 1048576)} MB, too large.`);
  if (ext === 'jpeg') ext = 'jpg';
  const nat = await naturalSize(file);
  if (!nat) throw new Error('Could not read that image.');
  try {
    const big = Math.max(nat.w, nat.h) > MAX_SIDE;
    if (ext === 'svg' || ext === 'gif' || (!big && file.size <= SHRINK_OVER)) return { blob: file, ext, w: nat.w, h: nat.h };
    const k = Math.min(1, MAX_SIDE / Math.max(nat.w, nat.h));
    const c = document.createElement('canvas');
    c.width = Math.round(nat.w * k);
    c.height = Math.round(nat.h * k);
    c.getContext('2d').drawImage(nat.img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.9));
    if (blob && blob.size < file.size) return { blob, ext: 'webp', w: c.width, h: c.height };
    return { blob: file, ext, w: nat.w, h: nat.h };
  } finally { URL.revokeObjectURL(nat.url); }
}

/**
 * ctx: {map(), root, mapId(), editing() -> the Pictures tab is open, picked(id|null) (the selection changed on the
 *       map), edited() (a picture changed), viewRect() -> the visible part of the map in image px}
 */
export function createPictures(ctx) {
  const st = { items: new Map(), sel: null, live: null };

  function srcUrl(src) {
    if (/^https:/i.test(src)) return Promise.resolve(src);
    return store.fileUrl(src).catch(() => null);
  }

  function build(pic) {
    const img = h('img', { class: 'map-pic-img', alt: '', draggable: 'false', decoding: 'async' });
    const handles = ['nw', 'ne', 'se', 'sw'].map((k) => h('span', { class: ['map-pic-handle', `is-${k}`], 'data-h': 'scale' }));
    const knob = h('span', { class: 'map-pic-knob', 'data-h': 'rotate', title: 'Drag to turn (Shift: 15° steps)' });
    const inner = h('div', { class: 'map-pic-inner' }, img, handles, knob);
    const el = h('div', { class: 'map-pic', 'data-id': pic.id }, inner);
    el.addEventListener('pointerdown', (e) => onDown(e, pic.id));
    const layer = boundsLayer(el, pic, { pane: PIC_PANE });
    return { layer, el, inner, img, src: null, pic };
  }

  function apply(it, pic) {
    it.pic = pic;
    it.layer.setRect(pic);
    it.inner.style.transform = pic.rotation ? `rotate(${pic.rotation}deg)` : '';
    it.img.style.opacity = String(pic.opacity);
    it.el.classList.toggle('is-picked', st.sel === pic.id && ctx.editing());
    it.el.classList.toggle('is-dm-hidden', isDm() && isHidden(pic.path));
    it.el.title = ctx.editing() ? pic.name : '';
    if (it.src !== pic.src) {
      it.src = pic.src;
      srcUrl(pic.src).then((url) => { if (it.src === pic.src) { if (url) it.img.src = url; else it.el.classList.add('is-missing'); } });
    }
  }

  /** Draw the current map's pictures (bottom first). */
  function sync() {
    const map = ctx.map();
    if (!map) return;
    const list = data.picturesOn(ctx.mapId());
    const seen = new Set();
    for (const pic of list) {
      seen.add(pic.id);
      let it = st.items.get(pic.id);
      if (!it) { it = build(pic); st.items.set(pic.id, it); it.layer.addTo(map); }
      if (st.live?.id === pic.id) continue; // being dragged: the store catches up on release
      apply(it, pic);
    }
    for (const [id, it] of st.items) if (!seen.has(id)) { it.layer.remove(); st.items.delete(id); }
    const pane = map.getPane(PIC_PANE);
    for (const pic of list) { const el = st.items.get(pic.id)?.el; if (el && el.parentNode === pane) pane.appendChild(el); } // stacking = order
    if (st.sel && !seen.has(st.sel)) select(null);
  }

  function select(id) {
    if (st.sel === id) return;
    st.sel = id;
    for (const it of st.items.values()) it.el.classList.toggle('is-picked', it.pic.id === id && ctx.editing());
    ctx.picked(id);
  }

  // ---------- dragging ----------

  function onDown(e, id) {
    if (!ctx.editing() || e.button !== 0) return;
    const it = st.items.get(id);
    if (!it) return;
    e.preventDefault();
    e.stopPropagation();
    select(id);
    const map = ctx.map();
    const kind = e.target?.dataset?.h || 'move';
    const p0 = it.pic;
    const k = pxPerImagePx(map);
    const c = map.latLngToContainerPoint([-(p0.y + p0.h / 2), p0.x + p0.w / 2]);
    const rect = map.getContainer().getBoundingClientRect();
    const cx = rect.left + c.x;
    const cy = rect.top + c.y;
    const start = { x: e.clientX, y: e.clientY, d: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, a: Math.atan2(e.clientY - cy, e.clientX - cx) };
    st.live = { ...p0 };
    map.dragging.disable();
    try { it.el.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    it.el.classList.add('is-dragging');
    const move = (ev) => {
      const l = st.live;
      if (kind === 'move') {
        l.x = p0.x + (ev.clientX - start.x) / k;
        l.y = p0.y + (ev.clientY - start.y) / k;
      } else if (kind === 'scale') {
        const f = Math.max(4 / Math.min(p0.w * k, p0.h * k), Math.hypot(ev.clientX - cx, ev.clientY - cy) / start.d);
        l.w = p0.w * f;
        l.h = p0.h * f;
        l.x = p0.x + (p0.w - l.w) / 2;
        l.y = p0.y + (p0.h - l.h) / 2;
      } else {
        let deg = p0.rotation + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - start.a) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        l.rotation = ((deg % 360) + 360) % 360;
      }
      it.layer.setRect(l);
      it.inner.style.transform = l.rotation ? `rotate(${l.rotation}deg)` : '';
    };
    const up = () => {
      it.el.removeEventListener('pointermove', move);
      it.el.removeEventListener('pointerup', up);
      it.el.removeEventListener('pointercancel', up);
      it.el.classList.remove('is-dragging');
      map.dragging.enable();
      const l = st.live;
      st.live = null;
      if (l && (l.x !== p0.x || l.y !== p0.y || l.w !== p0.w || l.rotation !== p0.rotation)) {
        data.savePicture(l);
        ctx.edited();
      }
    };
    it.el.addEventListener('pointermove', move);
    it.el.addEventListener('pointerup', up);
    it.el.addEventListener('pointercancel', up);
  }

  // ---------- adding ----------

  /** Ask for an image and lay it in the middle of the view (must be called from a click). Returns its id. */
  async function add() {
    const file = await pickFile();
    if (!file) return null;
    const mapId = ctx.mapId();
    try {
      const { blob, ext, w, h: hh } = await prepare(file);
      const hidden = data.mapHidden(mapId) || dmNewHidden();
      const path = `${data.PIC_MEDIA}/${slugify(stripExt(file.name)).slice(0, 40) || 'picture'}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
      await store.putBinary(path, blob, { hidden });
      const v = ctx.viewRect();
      const pw = Math.min(v.w * 0.3, w * 4);
      const ph = (pw * hh) / w;
      const order = Math.max(0, ...data.picturesOn(mapId).map((p) => p.order)) + 1;
      const id = data.savePicture({ map: mapId, name: stripExt(file.name).slice(0, 60) || 'Picture', src: path, x: v.x + v.w / 2 - pw / 2, y: v.y + v.h / 2 - ph / 2, w: pw, h: ph, rotation: 0, opacity: 1, order }, { hidden });
      ctx.edited();
      sync();
      select(id);
      return id;
    } catch (e) {
      toast(`Could not add the picture: ${e.message || e}`, { type: 'error', timeout: 7000 });
      return null;
    }
  }

  return {
    sync,
    add,
    select,
    get selected() { return st.sel; },
    /** Show a change on the map before it is saved (a slider being dragged). */
    preview(id, patch) {
      const it = st.items.get(id);
      if (it) apply(it, { ...it.pic, ...patch });
    },
    /** Edit mode's Pictures tab opened or closed: pictures take the pointer only while it is open. */
    setEditing(on) {
      ctx.root.classList.toggle('is-pic-editing', !!on);
      if (!on) st.sel = null;
      for (const it of st.items.values()) apply(it, it.pic);
    },
    clear() { for (const it of st.items.values()) it.layer.remove(); st.items.clear(); st.sel = null; },
  };
}
