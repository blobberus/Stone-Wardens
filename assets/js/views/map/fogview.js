// Fog of war on the map (fog.js model, fogdraw.js painting): one canvas over the image in its own pane, above the
// pictures and below the pins. Players see it as painted and the places under it are hidden; the DM sees through it
// (pins under it get a cloud mark) unless "Preview as players" is on. When the fog changes while someone is looking,
// or changed since this device last showed it (the old ops are a prefix of the new ones), the old fog fades into the
// new one, so revealed land clears gradually.
// Editing (the Fog tab of Edit map, designpanel.js): brush, rectangle and lasso, each adding fog or revealing; cover
// all / reveal all; undo / redo of this session's changes.
import { toast } from '../../core/ui.js';
import { boundsLayer, eventXY, pxPerImagePx } from './layers.js';
import { paintFog } from './fogdraw.js';
import { normOp, simplify, fogCovers, fogActive, opsHash, MAX_OPS } from './fog.js';
import * as data from './data.js';

const SEEN_KEY = 'sw:map:fogseen'; // {mapId: {n, h}}: the fog this device last showed a player
const FADE_MS = 2600;
export const FOG_PANE = 'mapFog';
export const TOOL_PANE = 'mapTools';

function loadSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; } }
function saveSeen(mapId, ops) {
  const s = loadSeen();
  s[mapId] = { n: ops.length, h: opsHash(ops) };
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

/**
 * ctx: {map(), root, canvas, mapId(), size() -> {w, h}, seeThrough() -> bool, changed() (fog changed: re-check pins),
 *       edited() (the fog was changed in edit mode)}
 */
export function createFogView(ctx) {
  const L = window.L;
  const st = {
    layer: null, key: '', mapId: null, fog: null, preview: false,
    tool: null, // {kind: 'brush'|'rect'|'lasso', mode: 'add'|'cut', size (screen px)}
    stroke: null, shape: null, renderer: null, cursor: null, undo: [], redo: [], pointers: new Set(),
    clip: '', // CSS clip-path keeping the fog inside the shown (cropped) part of the image
  };
  const clipStyle = (r, size) => (r && size.w > 0 && (r.x > 0 || r.y > 0 || r.w < size.w || r.h < size.h)
    ? `inset(${(r.y / size.h) * 100}% ${((size.w - r.x - r.w) / size.w) * 100}% ${((size.h - r.y - r.h) / size.h) * 100}% ${(r.x / size.w) * 100}%)`
    : '');

  // ---------- showing ----------

  const keyOf = (fog, size, see) => JSON.stringify([fog.on, fog.style, fog.color, fog.opacity, fog.softness, size.w, size.h, opsHash(fog.ops), see]);

  function addLayer(cnv, size) {
    cnv.className = 'map-fog';
    cnv.setAttribute('aria-hidden', 'true');
    cnv.style.clipPath = st.clip;
    return boundsLayer(cnv, { x: 0, y: 0, w: size.w, h: size.h }, { pane: FOG_PANE }).addTo(ctx.map());
  }

  function fadeOut(layer) {
    const el = layer.getElement();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { layer.remove(); return; }
    el.style.transition = `opacity ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '0'; }));
    setTimeout(() => layer.remove(), FADE_MS + 100);
  }

  /** Show the current map's fog. animate: fade the old fog into the new one (a change while looking). */
  function sync({ animate = true } = {}) {
    const map = ctx.map();
    const size = ctx.size();
    const mapId = ctx.mapId();
    const first = st.mapId !== mapId;
    if (first) { st.mapId = mapId; st.undo = []; st.redo = []; }
    const fog = data.fogOf(mapId);
    st.fog = fog;
    const see = ctx.seeThrough();
    ctx.root.classList.toggle('fog-see', see && fogActive(fog));
    if (!map || !(size.w > 0 && size.h > 0) || !fogActive(fog)) {
      if (st.layer) { if (animate && !first) fadeOut(st.layer); else st.layer.remove(); }
      st.layer = null;
      st.key = '';
      if (!see && fog.on) saveSeen(mapId, fog.ops);
      return;
    }
    const key = keyOf(fog, size, see);
    if (key === st.key && st.layer) return;
    st.key = key;
    const old = first ? null : st.layer;
    if (first && st.layer) st.layer.remove();
    let from = null; // a remembered earlier state of this fog, for a player who has not seen the change yet
    if (first && !see) {
      const seen = loadSeen()[mapId];
      if (seen && seen.n < fog.ops.length && opsHash(fog.ops, seen.n) === seen.h) from = fog.ops.slice(0, seen.n);
    }
    st.layer = addLayer(paintFog(fog, size.w, size.h, { dm: see }), size);
    if (old) { if (animate) fadeOut(old); else old.remove(); }
    if (from) {
      const prev = from.some((o) => o.t === 'add') ? addLayer(paintFog(fog, size.w, size.h, { ops: from }), size) : null;
      if (prev) setTimeout(() => fadeOut(prev), 400); // a moment to see the old fog, then it clears
    }
    if (!see) saveSeen(mapId, fog.ops);
  }

  function clearLayer() {
    if (st.layer) st.layer.remove();
    st.layer = null;
    st.key = '';
  }

  // ---------- editing ----------

  function write(ops) {
    const mapId = ctx.mapId();
    const cur = data.fogOf(mapId);
    if (ops.length > MAX_OPS) { toast('The fog has too many strokes. Use “Cover all” or “Reveal all” to start a fresh layer.', { type: 'error', timeout: 7000 }); return false; }
    st.undo.push(cur.ops);
    if (st.undo.length > 60) st.undo.shift();
    st.redo = [];
    data.saveFog(mapId, { ...cur, ops });
    ctx.edited();
    return true;
  }
  const addOp = (op) => { const o = normOp(op); if (o) write([...data.fogOf(ctx.mapId()).ops, o]); };

  function undoRedo(from, to) {
    const prev = from.pop();
    if (!prev) return false;
    const mapId = ctx.mapId();
    const cur = data.fogOf(mapId);
    to.push(cur.ops);
    data.saveFog(mapId, { ...cur, ops: prev });
    ctx.edited();
    return true;
  }

  const scale = () => pxPerImagePx(ctx.map());
  const brushR = () => (st.tool?.size || 60) / 2 / scale(); // image px

  function rendererFor() {
    if (!st.renderer) st.renderer = L.svg({ pane: TOOL_PANE, padding: 0.5 });
    return st.renderer;
  }
  const ll = (p) => L.latLng(-p.y, p.x);
  const styleFor = (mode) => (mode === 'cut'
    ? { color: '#b8321c', weight: 2, dashArray: '6 5', fillColor: '#ffffff', fillOpacity: 0.12, opacity: 0.95 }
    : { color: '#ffffff', weight: 2, fillColor: '#eef1f4', fillOpacity: 0.55, opacity: 0.9 });

  function drawShape() {
    const s = st.stroke;
    if (st.shape) { st.shape.remove(); st.shape = null; }
    if (!s) return;
    const base = { renderer: rendererFor(), interactive: false, ...styleFor(s.mode) };
    if (s.kind === 'brush') {
      const w = Math.max(2, s.r * 2 * scale());
      st.shape = L.polyline(s.pts.map(ll), { ...base, weight: w, lineCap: 'round', lineJoin: 'round', dashArray: null, color: s.mode === 'cut' ? '#f3d3c8' : '#f4f6f8', opacity: s.mode === 'cut' ? 0.55 : 0.75 }).addTo(ctx.map());
    } else if (s.kind === 'rect') {
      const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
      st.shape = L.rectangle(L.latLngBounds(ll(a), ll(b)), base).addTo(ctx.map());
    } else {
      st.shape = L.polygon(s.pts.map(ll), base).addTo(ctx.map());
    }
  }

  function showCursor(e) {
    if (!st.cursor) { st.cursor = document.createElement('div'); st.cursor.className = 'map-fog-cursor'; ctx.root.append(st.cursor); }
    const c = st.cursor;
    const on = st.tool?.kind === 'brush' && e;
    c.hidden = !on;
    if (!on) return;
    const r = ctx.root.getBoundingClientRect();
    const d = st.tool.size;
    c.classList.toggle('is-cut', st.tool.mode === 'cut');
    c.style.width = `${d}px`;
    c.style.height = `${d}px`;
    c.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
  }

  function onDown(e) {
    if (!st.tool) return;
    st.pointers.add(e.pointerId);
    if (st.pointers.size > 1) { cancelStroke(); return; } // a second finger: pinch zoom, not a stroke
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { ctx.canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    const p = eventXY(ctx.map(), e);
    st.stroke = { kind: st.tool.kind, mode: st.tool.mode, r: brushR(), pts: [p], last: { x: e.clientX, y: e.clientY } };
    drawShape();
  }
  function onMove(e) {
    if (!st.tool) return;
    showCursor(e);
    const s = st.stroke;
    if (!s) return;
    e.preventDefault();
    if (Math.hypot(e.clientX - s.last.x, e.clientY - s.last.y) < 2) return;
    s.last = { x: e.clientX, y: e.clientY };
    const p = eventXY(ctx.map(), e);
    if (s.kind === 'rect') s.pts = [s.pts[0], p]; else s.pts.push(p);
    drawShape();
  }
  function onUp(e) {
    st.pointers.delete(e.pointerId);
    const s = st.stroke;
    if (!s) return;
    st.stroke = null;
    drawShape();
    const tol = 0.7 / scale();
    const flat = s.pts.flatMap((p) => [p.x, p.y]);
    if (s.kind === 'brush') addOp({ t: s.mode, k: 'brush', p: simplify(flat, tol), r: s.r });
    else if (s.kind === 'rect' && s.pts.length > 1) { const [a, b] = [s.pts[0], s.pts[1]]; addOp({ t: s.mode, k: 'rect', p: [a.x, a.y, b.x - a.x, b.y - a.y] }); } else if (s.kind === 'lasso') addOp({ t: s.mode, k: 'poly', p: simplify(flat, tol) });
  }
  function cancelStroke() {
    st.stroke = null;
    drawShape();
  }
  const onLeave = () => showCursor(null);
  const onZoom = () => { if (st.stroke) drawShape(); };

  function setTool(tool) {
    const map = ctx.map();
    const was = !!st.tool;
    st.tool = tool ? { kind: tool.kind || 'brush', mode: tool.mode || 'add', size: tool.size || 60 } : null;
    ctx.root.classList.toggle('is-fog-tool', !!st.tool);
    ctx.root.classList.toggle('is-fog-brush', st.tool?.kind === 'brush');
    if (st.tool && !was) {
      map.dragging.disable();
      ctx.canvas.addEventListener('pointerdown', onDown, true);
      ctx.canvas.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      ctx.canvas.addEventListener('pointerleave', onLeave);
      map.on('zoom', onZoom);
    } else if (!st.tool && was) {
      cancelStroke();
      map.dragging.enable();
      ctx.canvas.removeEventListener('pointerdown', onDown, true);
      ctx.canvas.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      ctx.canvas.removeEventListener('pointerleave', onLeave);
      map.off('zoom', onZoom);
      st.pointers.clear();
      showCursor(null);
    }
  }

  return {
    sync,
    clear: clearLayer,
    /** Keep the fog inside rect {x, y, w, h} (the crop), or the whole image (null). */
    clipTo(rect) {
      st.clip = clipStyle(rect, ctx.size());
      for (const el of ctx.root.querySelectorAll('.map-fog')) el.style.clipPath = st.clip;
    },
    /** Is this point of the current map under its fog? */
    covers: (x, y) => !!st.fog && fogActive(st.fog) && fogCovers(st.fog, x, y),
    get fog() { return st.fog || data.fogOf(ctx.mapId()); },
    get preview() { return st.preview; },
    setPreview(on) { st.preview = !!on; ctx.changed(); sync({ animate: false }); },
    get tool() { return st.tool; },
    setTool,
    coverAll: () => write([{ t: 'add', k: 'all' }]),
    revealAll: () => { const ops = data.fogOf(ctx.mapId()).ops; write(ops.length + 1 >= MAX_OPS ? [] : [...ops, { t: 'cut', k: 'all' }]); },
    /** Style, color, opacity, softness or on/off (not part of undo, which is for strokes). */
    setStyle(patch) {
      const mapId = ctx.mapId();
      data.saveFog(mapId, { ...data.fogOf(mapId), ...patch });
      ctx.edited();
    },
    undo: () => undoRedo(st.undo, st.redo),
    redo: () => undoRedo(st.redo, st.undo),
    get canUndo() { return st.undo.length > 0; },
    get canRedo() { return st.redo.length > 0; },
    resetHistory() { st.undo = []; st.redo = []; },
  };
}
