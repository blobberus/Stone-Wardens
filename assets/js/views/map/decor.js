// Map decorations from the map's design (design.js): the background around the image, a border around it, the
// compass (in a screen corner, or drawn on the map at a spot) and the scale bar (a screen corner, re-measured every
// zoom frame), plus the ruler (measure tool, for everyone once a scale is set) and the crop handles of the Design tab.
// ⋯ → "Hide compass, scale and border" turns the decorations off on this device (ctx.hidden()).
import { h } from '../../core/dom.js';
import { store } from '../../core/store.js';
import { boundsLayer, pxPerImagePx } from './layers.js';
import { compassSvg, borderSvg, niceScale, fmtNum, unitName, fmtDistance, pathLength } from './design.js';
import { TOOL_PANE } from './fogview.js';

export const DECOR_PANE = 'mapDecor';
export const BORDER_PANE = 'mapBorder';
const BG_CLASSES = ['map-bg-parchment', 'map-bg-sea', 'map-bg-night', 'map-bg-color', 'map-bg-image'];

/**
 * ctx: {map(), root, design() -> design, rect() -> the shown part of the image {x, y, w, h}, size() -> {w, h},
 *       hidden() -> decorations off on this device, editing() -> the Design tab is open (the map compass can be
 *       dragged), compassMoved({x, y}) (fractions of the image)}
 */
export function createDecor(ctx) {
  const L = window.L;
  const corners = {};
  for (const c of ['bl', 'br', 'tl', 'tr']) corners[c] = h('div', { class: ['map-decor-corner', `at-${c}`] });
  const compassEl = h('div', { class: 'map-compass', role: 'img', 'aria-label': 'Compass' });
  const scaleBar = h('div', { class: 'map-scale-bar' });
  const scaleLabel = h('span', { class: 'map-scale-end' });
  const scaleEl = h('div', { class: 'map-scale', role: 'img' }, scaleBar, h('div', { class: 'map-scale-labels' }, h('span', null, '0'), scaleLabel));
  ctx.root.append(...Object.values(corners));
  const st = {
    border: null, borderKey: '', mapCompass: null, mapCompassKey: '', compassKey: '', bgKey: '', bgUrl: null,
    scaleKey: '', crop: null, measure: null, renderer: null,
  };

  // ---------- background ----------

  async function drawBackground(d) {
    const b = d.background;
    const key = JSON.stringify(b);
    if (key === st.bgKey) return;
    st.bgKey = key;
    ctx.root.classList.remove(...BG_CLASSES);
    ctx.root.style.removeProperty('--map-bg-color');
    ctx.root.style.removeProperty('--map-bg-image');
    if (b.kind === 'theme') return;
    ctx.root.classList.add(`map-bg-${b.kind}`, b.fit === 'cover' ? 'map-bg-cover' : 'map-bg-tile');
    if (b.kind === 'color') ctx.root.style.setProperty('--map-bg-color', b.color);
    if (b.kind === 'image') {
      const url = await store.fileUrl(b.image).catch(() => null);
      if (st.bgKey !== key) return;
      if (url) ctx.root.style.setProperty('--map-bg-image', `url("${url.replace(/"/g, '%22')}")`);
    }
  }

  // ---------- border (on the map, around the shown part of the image) ----------

  function drawBorder(d, off) {
    const show = d.border.show && !off;
    const rect = ctx.rect();
    const key = show ? JSON.stringify([d.border, rect]) : '';
    if (key === st.borderKey) return;
    st.borderKey = key;
    if (st.border) { st.border.remove(); st.border = null; }
    if (!show || !(rect.w > 0 && rect.h > 0)) return;
    const { svg, box } = borderSvg(d.border, rect);
    const el = h('div', { class: 'map-border', innerHTML: svg });
    st.border = boundsLayer(el, box, { pane: BORDER_PANE }).addTo(ctx.map());
  }

  // ---------- compass ----------

  function drawCompass(d, off) {
    const c = d.compass;
    const onScreen = c.show && !off && c.anchor === 'screen';
    const onMap = c.show && !off && c.anchor === 'map';
    const key = onScreen ? JSON.stringify([c.type, c.color, c.rotation, c.size, c.corner]) : '';
    if (key !== st.compassKey) {
      st.compassKey = key;
      if (!onScreen) compassEl.remove();
      else {
        compassEl.innerHTML = compassSvg(c.type, { color: c.color, rotation: c.rotation });
        compassEl.style.width = `${c.size}px`;
        compassEl.style.height = `${c.size}px`;
        corners[c.corner].prepend(compassEl);
      }
    }
    const size = ctx.size();
    const mkey = onMap && size.w > 0 ? JSON.stringify([c.type, c.color, c.rotation, c.x, c.y, c.mapSize, size.w, size.h]) : '';
    if (mkey !== st.mapCompassKey) {
      st.mapCompassKey = mkey;
      if (st.mapCompass) { st.mapCompass.remove(); st.mapCompass = null; }
      if (mkey) {
        const s = c.mapSize * size.w;
        const el = h('div', { class: 'map-compass-onmap', innerHTML: compassSvg(c.type, { color: c.color, rotation: c.rotation }) });
        st.mapCompass = boundsLayer(el, { x: c.x * size.w - s / 2, y: c.y * size.h - s / 2, w: s, h: s }, { pane: DECOR_PANE }).addTo(ctx.map());
        el.addEventListener('pointerdown', (e) => dragCompass(e, el));
      }
    }
    if (st.mapCompass) st.mapCompass.getElement().classList.toggle('is-draggable', !!ctx.editing());
  }

  /** Design tab: drag the compass drawn on the map to another spot. */
  function dragCompass(e, el) {
    if (!ctx.editing() || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const map = ctx.map();
    const start = { x: e.clientX, y: e.clientY, rect: st.mapCompass.getRect() };
    map.dragging.disable();
    try { el.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    const move = (ev) => {
      const k = pxPerImagePx(map);
      st.mapCompass?.setRect({ ...start.rect, x: start.rect.x + (ev.clientX - start.x) / k, y: start.rect.y + (ev.clientY - start.y) / k });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      map.dragging.enable();
      const r = st.mapCompass?.getRect();
      const size = ctx.size();
      if (r && size.w > 0) ctx.compassMoved({ x: Math.min(1, Math.max(0, (r.x + r.w / 2) / size.w)), y: Math.min(1, Math.max(0, (r.y + r.h / 2) / size.h)) });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ---------- scale bar ----------

  function drawScale() {
    const d = ctx.design();
    const s = d.scale;
    const map = ctx.map();
    const show = s.show && s.perPx > 0 && !ctx.hidden() && map;
    if (!show) { if (scaleEl.isConnected) scaleEl.remove(); st.scaleKey = ''; return; }
    if (scaleEl.parentNode !== corners[s.corner]) corners[s.corner].append(scaleEl);
    const n = niceScale(s.perPx / pxPerImagePx(map), 150);
    if (!n) return;
    scaleBar.style.width = `${n.px.toFixed(1)}px`;
    const key = `${s.style}|${n.value}|${n.segments}|${s.unit}|${s.custom}`;
    if (key === st.scaleKey) return;
    st.scaleKey = key;
    scaleEl.className = `map-scale is-${s.style}`;
    scaleBar.replaceChildren(...Array.from({ length: n.segments }, () => h('span', { class: 'map-scale-seg' })));
    const text = `${fmtNum(n.value)} ${unitName(s, n.value)}`;
    scaleLabel.textContent = text;
    scaleEl.setAttribute('aria-label', `Scale: the bar is ${text}`);
  }

  // ---------- ruler (measure tool) ----------

  const ll = (p) => L.latLng(-p.y, p.x);
  function renderer() {
    if (!st.renderer) st.renderer = L.svg({ pane: TOOL_PANE, padding: 0.5 });
    return st.renderer;
  }
  function drawMeasure(hover = null) {
    const m = st.measure;
    if (!m) return;
    const map = ctx.map();
    const pts = hover && !m.done ? [...m.pts, hover] : m.pts;
    if (!m.line) {
      m.line = L.polyline([], { renderer: renderer(), interactive: false, color: '#1f1a14', weight: 3, dashArray: '8 6', opacity: 0.9 }).addTo(map);
      m.halo = L.polyline([], { renderer: renderer(), interactive: false, color: '#ffffff', weight: 6, opacity: 0.7 }).addTo(map);
      m.line.bringToFront();
    }
    m.halo.setLatLngs(pts.map(ll));
    m.line.setLatLngs(pts.map(ll));
    if (m.dots.length !== m.pts.length) { // only when a point was added (not on every hover)
      for (const v of m.dots) v.remove();
      m.dots = m.pts.map((p) => L.circleMarker(ll(p), { renderer: renderer(), interactive: false, radius: 4, color: '#1f1a14', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).addTo(map));
    }
    const s = ctx.design().scale;
    const last = pts[pts.length - 1];
    if (m.label) { m.label.remove(); m.label = null; }
    if (last && pts.length > 1) {
      const text = fmtDistance(s, pathLength(pts) * s.perPx);
      m.label = L.marker(ll(last), {
        pane: TOOL_PANE, interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'map-measure-label', html: `<span>${text.replace(/[<>&]/g, '')}</span>`, iconSize: null, iconAnchor: [-10, 14] }),
      }).addTo(map);
      m.text = text;
    }
  }
  function clearMeasureShapes() {
    const m = st.measure;
    if (!m) return;
    for (const x of [m.line, m.halo, m.label, ...m.dots]) x?.remove();
    m.line = m.halo = m.label = null;
    m.dots = [];
  }

  // ---------- crop handles (Design tab) ----------

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handlePos(r, k) {
    const x = k.includes('w') ? r.x : k.includes('e') ? r.x + r.w : r.x + r.w / 2;
    const y = k.includes('n') ? r.y : k.includes('s') ? r.y + r.h : r.y + r.h / 2;
    return { x, y };
  }
  function shadePath(r, size) {
    return `M0 0H${size.w}V${size.h}H0Z M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`;
  }
  function startCrop(rect, { change, commit }) {
    stopCrop();
    const map = ctx.map();
    const size = ctx.size();
    const c = { rect: { ...rect }, handles: new Map() };
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('class', 'map-crop-shade');
    const frame = document.createElementNS(svgNS, 'rect');
    frame.setAttribute('class', 'map-crop-frame');
    svg.append(path, frame);
    const el = h('div', { class: 'map-crop' });
    el.append(svg);
    c.shade = boundsLayer(el, { x: 0, y: 0, w: size.w, h: size.h }, { pane: TOOL_PANE }).addTo(map);
    const paint = () => {
      const r = c.rect;
      path.setAttribute('d', shadePath(r, size));
      for (const [a, v] of [['x', r.x], ['y', r.y], ['width', r.w], ['height', r.h]]) frame.setAttribute(a, v);
      for (const [k, mk] of c.handles) { const p = handlePos(r, k); mk.setLatLng(ll(p)); }
    };
    for (const k of HANDLES) {
      const mk = L.marker(ll(handlePos(c.rect, k)), {
        pane: TOOL_PANE, draggable: true, keyboard: false,
        icon: L.divIcon({ className: `map-crop-handle is-${k}`, iconSize: [16, 16] }),
      }).addTo(map);
      mk.on('drag', () => {
        const p = mk.getLatLng();
        const x = Math.min(size.w, Math.max(0, p.lng));
        const y = Math.min(size.h, Math.max(0, -p.lat));
        const r = c.rect;
        let x0 = r.x; let y0 = r.y; let x1 = r.x + r.w; let y1 = r.y + r.h;
        if (k.includes('w')) x0 = Math.min(x, x1 - 16);
        if (k.includes('e')) x1 = Math.max(x, x0 + 16);
        if (k.includes('n')) y0 = Math.min(y, y1 - 16);
        if (k.includes('s')) y1 = Math.max(y, y0 + 16);
        c.rect = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
        paint();
        change?.(c.rect);
      });
      mk.on('dragend', () => { paint(); commit?.(c.rect); });
      c.handles.set(k, mk);
    }
    st.crop = c;
    paint();
  }
  function stopCrop() {
    const c = st.crop;
    if (!c) return;
    c.shade.remove();
    for (const mk of c.handles.values()) mk.remove();
    st.crop = null;
  }

  // ---------- api ----------

  function update() {
    const d = ctx.design();
    const off = ctx.hidden();
    drawBackground(d);
    drawBorder(d, off || !!st.crop);
    drawCompass(d, off);
    drawScale();
  }

  return {
    update,
    onZoom: drawScale,
    /** Remove everything drawn on the map (switching maps); update() draws it again. */
    reset() {
      if (st.border) st.border.remove();
      if (st.mapCompass) st.mapCompass.remove();
      st.border = st.mapCompass = null;
      st.borderKey = st.mapCompassKey = '';
      stopCrop();
      this.stopMeasure();
    },
    // ruler
    get measuring() { return !!st.measure; },
    startMeasure() { st.measure = { pts: [], dots: [], done: false }; ctx.root.classList.add('is-measuring'); },
    stopMeasure() { clearMeasureShapes(); st.measure = null; ctx.root.classList.remove('is-measuring'); },
    /** A click while measuring: a new point (after a finished path, a new measurement). */
    measureAt(xy) {
      const m = st.measure;
      if (!m) return;
      if (m.done) { clearMeasureShapes(); m.pts = []; m.done = false; }
      const last = m.pts[m.pts.length - 1];
      if (last && Math.hypot(last.x - xy.x, last.y - xy.y) * pxPerImagePx(ctx.map()) < 4) return; // a double-click's second click
      m.pts.push(xy);
      drawMeasure();
    },
    measureHover(xy) { if (st.measure && st.measure.pts.length && !st.measure.done) drawMeasure(xy); },
    /** Finish the path (it stays shown until the next click). Returns its length text. */
    finishMeasure() {
      const m = st.measure;
      if (!m) return '';
      m.done = true;
      drawMeasure();
      return m.pts.length > 1 ? m.text : '';
    },
    // crop
    startCrop,
    stopCrop() { stopCrop(); update(); },
    get cropping() { return !!st.crop; },
  };
}
