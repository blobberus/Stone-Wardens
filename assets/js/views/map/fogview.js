// Fog of war on the map (fog.js model, fogdraw.js painting), modelled on the Combat Ring's fog: one canvas over the image
// in its own pane, above the pictures and below the pins, a faded wash in the map's background color. Players see it as
// painted and the places under it are hidden; the DM sees through it (a lighter wash; in the Fog tab every area's
// outline, dashed gold, revealed ones dotted) unless "Player view" is on. When the fog changes while someone is
// looking, the old fog fades into the new one; a device also remembers a small picture of the fog it last showed a
// player, so land revealed since their last visit clears gradually too.
// Editing (the Fog tab of Edit map, designpanel.js): draw Fog or a Clearing with a lasso, a polygon or a rectangle
// (Alt flips which); click an area to reveal / hide it; Select areas (click, Shift-click, drag a box) to reveal, hide or
// delete them; cover the whole map, reveal / hide / delete all; undo / redo of this session's changes.
import { toast } from '../../core/ui.js';
import { boundsLayer, eventXY, pxPerImagePx } from './layers.js';
import { paintFog, snapshot } from './fogdraw.js';
import { fogActive, fogCovers, fogHash, areaAt, areasIn, addArea, cutFog, rectPts, wholeMap, simplify, polyArea, MAX_AREAS } from './fog.js';
import * as data from './data.js';

const SEEN_KEY = 'sw:map:fogseen2'; // {mapId: {h, img, t}}: the fog this device last showed a player (a small picture)
const SEEN_MAPS = 4;
const FADE_MS = 2600;
const CLICK_PX = 5; // a press that moves less than this is a click (toggles the area under it)
const CLOSE_PX = 12; // a polygon closes on a click this near its first point
export const FOG_PANE = 'mapFog';
export const FOG_EDGE_PANE = 'mapFogEdges';
export const TOOL_PANE = 'mapTools';
export const FOG_TOOLS = ['pan', 'lasso', 'poly', 'rect', 'toggle', 'select'];

function loadSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; } }
function saveSeen(mapId, h, cnv) {
  const s = loadSeen();
  if (s[mapId]?.h === h) return;
  s[mapId] = { h, img: cnv ? snapshot(cnv) : '', t: Date.now() };
  for (const k of Object.keys(s).sort((a, b) => (s[b].t || 0) - (s[a].t || 0)).slice(SEEN_MAPS)) delete s[k];
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

/**
 * ctx: {map(), root, canvas, mapId(), size() -> {w, h}, seeThrough() -> bool, editing() -> bool (the Fog tab is open),
 *       color() -> the wash's color (the map's background), changed() (fog changed: re-check pins),
 *       edited() (the fog was changed in edit mode)}
 */
export function createFogView(ctx) {
  const L = window.L;
  const st = {
    layer: null, key: '', mapId: null, fog: null, preview: false,
    tool: 'pan', what: 'fog', // what a drawing makes: 'fog' | 'clear'
    stroke: null, poly: null, draft: null, renderer: null, edgeRenderer: null, edges: null, edgeKey: '', edgeEls: new Map(),
    hover: null, picked: new Set(), undo: [], redo: [], pointers: new Set(), space: false, active: false, onUi: null,
    clip: '', // CSS clip-path keeping the fog inside the shown (cropped) part of the image
  };
  const ui = () => st.onUi?.();
  const clipStyle = (r, size) => (r && size.w > 0 && (r.x > 0 || r.y > 0 || r.w < size.w || r.h < size.h)
    ? `inset(${(r.y / size.h) * 100}% ${((size.w - r.x - r.w) / size.w) * 100}% ${((size.h - r.y - r.h) / size.h) * 100}% ${(r.x / size.w) * 100}%)`
    : '');
  const ll = (p) => L.latLng(-p.y, p.x);
  const llPts = (p) => { const out = []; for (let i = 0; i < p.length; i += 2) out.push(L.latLng(-p[i + 1], p[i])); return out; };

  // ---------- showing ----------

  function addLayer(cnv, size) {
    cnv.className = 'map-fog';
    cnv.setAttribute('aria-hidden', 'true');
    cnv.style.clipPath = st.clip;
    return boundsLayer(cnv, { x: 0, y: 0, w: size.w, h: size.h }, { pane: FOG_PANE }).addTo(ctx.map());
  }

  function fadeOut(layer, ms = FADE_MS) {
    const el = layer.getElement();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { layer.remove(); return; }
    el.style.transition = `opacity ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '0'; }));
    setTimeout(() => layer.remove(), ms + 100);
  }

  /** The remembered picture of a player's last fog, laid over the new one and cleared (land revealed meanwhile). */
  function fadeFromMemory(img, size) {
    const pic = new Image();
    pic.onload = () => {
      if (!ctx.map()) return;
      pic.className = 'map-fog';
      pic.style.clipPath = st.clip;
      const layer = boundsLayer(pic, { x: 0, y: 0, w: size.w, h: size.h }, { pane: FOG_PANE }).addTo(ctx.map());
      setTimeout(() => fadeOut(layer), 400); // a moment to see the old fog, then it clears
    };
    pic.src = img;
  }

  /** Show the current map's fog. animate: fade the old fog into the new one (a change while looking). */
  function sync({ animate = true } = {}) {
    const map = ctx.map();
    const size = ctx.size();
    const mapId = ctx.mapId();
    const first = st.mapId !== mapId;
    if (first) { st.mapId = mapId; st.undo = []; st.redo = []; st.picked.clear(); st.hover = null; cancelDraft(); }
    const fog = data.fogOf(mapId);
    st.fog = fog;
    for (const id of [...st.picked]) if (!fog.areas.some((a) => a.id === id)) st.picked.delete(id);
    const see = ctx.seeThrough();
    // The DM still sees switched-off fog while editing it; players only see fog that is on
    const shown = (fog.on || (see && ctx.editing())) && fog.areas.some((a) => a.on);
    ctx.root.classList.toggle('fog-see', see && shown);
    drawEdges();
    if (!map || !(size.w > 0 && size.h > 0) || !shown) {
      if (st.layer) { if (animate && !first) fadeOut(st.layer); else st.layer.remove(); }
      st.layer = null;
      st.key = '';
      if (!see) saveSeen(mapId, fogHash(fog), null);
      return;
    }
    const color = ctx.color();
    const key = JSON.stringify([fogHash({ ...fog, on: true }), fog.opacity, fog.softness, color, size.w, size.h, see]);
    if (key === st.key && st.layer) return;
    st.key = key;
    const old = first ? null : st.layer;
    if (first && st.layer) st.layer.remove();
    const painted = paintFog(fog, size.w, size.h, { color, dm: see });
    st.layer = painted ? addLayer(painted, size) : null;
    if (old) { if (animate) fadeOut(old); else old.remove(); }
    if (!see) {
      const h = fogHash(fog);
      const seen = loadSeen()[mapId];
      if (first && seen?.img && seen.h !== h) fadeFromMemory(seen.img, size);
      saveSeen(mapId, h, painted);
    }
  }

  function clearLayer() {
    if (st.layer) st.layer.remove();
    st.layer = null;
    st.key = '';
    removeEdges();
  }

  // ---------- the DM's outlines (Fog tab) ----------

  function removeEdges() {
    if (st.edges) st.edges.remove();
    st.edges = null;
    st.edgeKey = '';
    st.edgeEls.clear();
  }

  function edgeClass(a) {
    return ['map-fog-edge', !a.on && 'is-off', st.hover === a.id && 'is-hover', st.picked.has(a.id) && 'is-picked'].filter(Boolean).join(' ');
  }

  function drawEdges() {
    const map = ctx.map();
    const fog = st.fog;
    if (!map || !fog || !ctx.editing() || st.preview || !fog.areas.length) { removeEdges(); return; }
    const key = fogHash({ on: true, areas: fog.areas.map((a) => ({ ...a, on: true })) }) + fog.areas.map((a) => (a.on ? 1 : 0)).join('');
    if (key === st.edgeKey && st.edges) { restyleEdges(); return; }
    removeEdges();
    st.edgeKey = key;
    if (!st.edgeRenderer) st.edgeRenderer = L.svg({ pane: FOG_EDGE_PANE, padding: 0.5 });
    st.edges = L.layerGroup().addTo(map);
    for (const a of fog.areas) {
      const poly = L.polygon([llPts(a.pts), ...a.holes.map(llPts)], { renderer: st.edgeRenderer, interactive: false, className: edgeClass(a) });
      poly.addTo(st.edges);
      st.edgeEls.set(a.id, poly);
    }
  }
  function restyleEdges() {
    if (!st.fog) return;
    for (const a of st.fog.areas) {
      const el = st.edgeEls.get(a.id)?.getElement();
      if (el) el.setAttribute('class', edgeClass(a));
    }
  }
  function setHover(id) {
    if (st.hover === id) return;
    st.hover = id;
    restyleEdges();
  }

  // ---------- editing ----------

  const areasNow = () => data.fogOf(ctx.mapId()).areas;

  function write(areas, { history = true } = {}) {
    const mapId = ctx.mapId();
    const cur = data.fogOf(mapId);
    if (areas.length > MAX_AREAS) { toast(`The fog has too many areas (at most ${MAX_AREAS}). Delete some, or “Delete all fog” and cover the map afresh.`, { type: 'error', timeout: 7000 }); return false; }
    if (history) {
      st.undo.push(cur.areas);
      if (st.undo.length > 60) st.undo.shift();
      st.redo = [];
    }
    data.saveFog(mapId, { ...cur, areas });
    ctx.edited();
    ui();
    return true;
  }

  function undoRedo(from, to) {
    const prev = from.pop();
    if (!prev) return false;
    const mapId = ctx.mapId();
    const cur = data.fogOf(mapId);
    to.push(cur.areas);
    data.saveFog(mapId, { ...cur, areas: prev });
    ctx.edited();
    ui();
    return true;
  }

  const scale = () => pxPerImagePx(ctx.map());

  /** A finished shape: fog over it, or a clearing cut out of the fog. */
  function apply(what, pts) {
    if (pts.length < 6) return;
    if (what === 'clear') write(cutFog(areasNow(), pts));
    else write(addArea(areasNow(), pts));
  }

  function setOn(ids, on) {
    const set = new Set(ids);
    let n = 0;
    const areas = areasNow().map((a) => { if (!set.has(a.id) || a.on === on) return a; n += 1; return { ...a, on }; });
    if (n) write(areas);
    return n;
  }

  /** Click with Lasso, Rectangle or "Click to reveal / hide": the area under it changes side. */
  function toggleAt(p) {
    const a = areaAt(data.fogOf(ctx.mapId()), p.x, p.y);
    if (!a) return;
    setOn([a.id], !a.on);
    toast(a.on ? 'Revealed to the players.' : 'Fog back: the players can’t see this area.');
  }

  function pickAt(p, add) {
    const a = areaAt(data.fogOf(ctx.mapId()), p.x, p.y);
    if (!add) st.picked.clear();
    if (a) { if (add && st.picked.has(a.id)) st.picked.delete(a.id); else st.picked.add(a.id); }
    restyleEdges();
    ui();
  }

  function rendererFor() {
    if (!st.renderer) st.renderer = L.svg({ pane: TOOL_PANE, padding: 0.5 });
    return st.renderer;
  }

  /** The shape being drawn: gold for fog, blue for a clearing, the focus color for a selection box. */
  function drawDraft(cursor = null) {
    if (st.draft) { st.draft.remove(); st.draft = null; }
    const s = st.stroke;
    const base = { renderer: rendererFor(), interactive: false };
    if (st.poly) {
      const pts = cursor ? [...st.poly.pts, cursor] : st.poly.pts;
      const cls = `map-fog-draft is-${st.poly.what}`;
      st.draft = pts.length > 1 ? L.polygon(pts.map(ll), { ...base, className: cls }) : L.circleMarker(ll(pts[0]), { ...base, radius: 4, className: cls });
      st.draft.addTo(ctx.map());
      return;
    }
    if (!s || s.pts.length < 2) return;
    const cls = `map-fog-draft is-${s.kind === 'select' ? 'select' : s.what}`;
    if (s.kind === 'rect' || s.kind === 'select') st.draft = L.rectangle(L.latLngBounds(ll(s.pts[0]), ll(s.pts[s.pts.length - 1])), { ...base, className: cls });
    else st.draft = L.polygon(s.pts.map(ll), { ...base, className: cls });
    st.draft.addTo(ctx.map());
  }
  function cancelDraft() {
    st.stroke = null;
    st.poly = null;
    if (st.draft) { st.draft.remove(); st.draft = null; }
  }

  function finishPoly() {
    const poly = st.poly;
    st.poly = null;
    drawDraft();
    if (!poly || poly.pts.length < 3) return;
    apply(poly.what, poly.pts.flatMap((p) => [p.x, p.y]));
  }

  const whatOf = (e) => (e.altKey ? (st.what === 'fog' ? 'clear' : 'fog') : st.what);
  const drawing = () => st.active && st.tool !== 'pan' && !st.space;

  function onDown(e) {
    if (!drawing()) return;
    st.pointers.add(e.pointerId);
    if (st.pointers.size > 1) { cancelDraft(); return; } // a second finger: pinch zoom, not a drawing
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { ctx.canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    const p = eventXY(ctx.map(), e);
    const at = { x: e.clientX, y: e.clientY };
    if (st.tool === 'poly') {
      if (!st.poly) st.poly = { what: whatOf(e), pts: [p], at: [at] };
      else {
        const f = st.poly.at[0];
        if (st.poly.pts.length >= 3 && Math.hypot(at.x - f.x, at.y - f.y) <= CLOSE_PX) { finishPoly(); return; }
        st.poly.pts.push(p);
        st.poly.at.push(at);
      }
      drawDraft();
      return;
    }
    st.stroke = { kind: st.tool, what: whatOf(e), pts: [p], at, last: at, moved: false, add: e.shiftKey || e.ctrlKey || e.metaKey };
  }

  function onMove(e) {
    if (!drawing()) return;
    const p = eventXY(ctx.map(), e);
    const s = st.stroke;
    if (st.poly) { drawDraft(p); return; }
    if (!s) { // hover: the area a click would change
      const a = ['toggle', 'select', 'lasso', 'rect'].includes(st.tool) ? areaAt(data.fogOf(ctx.mapId()), p.x, p.y) : null;
      setHover(a?.id || null);
      return;
    }
    e.preventDefault();
    if (Math.hypot(e.clientX - s.last.x, e.clientY - s.last.y) < 2) return;
    s.last = { x: e.clientX, y: e.clientY };
    if (Math.hypot(e.clientX - s.at.x, e.clientY - s.at.y) >= CLICK_PX) s.moved = true;
    if (s.kind === 'rect' || s.kind === 'select') s.pts = [s.pts[0], p]; else if (s.kind === 'lasso') s.pts.push(p);
    if (s.moved && s.kind !== 'toggle') drawDraft();
  }

  function onUp(e) {
    st.pointers.delete(e.pointerId);
    const s = st.stroke;
    if (!s) return;
    st.stroke = null;
    drawDraft();
    const p = s.pts[s.pts.length - 1];
    if (!s.moved) { // a click
      if (s.kind === 'select') pickAt(s.pts[0], s.add);
      else toggleAt(s.pts[0]);
      return;
    }
    if (s.kind === 'toggle') return;
    if (s.kind === 'select') {
      const a = s.pts[0];
      const box = [Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x), Math.max(a.y, p.y)];
      if (!s.add) st.picked.clear();
      for (const x of areasIn(data.fogOf(ctx.mapId()), box)) st.picked.add(x.id);
      restyleEdges();
      ui();
    } else if (s.kind === 'rect') {
      const a = s.pts[0];
      apply(s.what, rectPts(a.x, a.y, p.x - a.x, p.y - a.y));
    } else if (s.kind === 'lasso') {
      const k = scale();
      const flat = simplify(s.pts.flatMap((q) => [q.x, q.y]), 0.7 / k);
      if (flat.length >= 6 && Math.abs(polyArea(flat)) * k * k >= 60) apply(s.what, flat);
    }
  }

  function onDblClick(e) {
    if (!drawing() || st.tool !== 'poly') return;
    e.preventDefault();
    e.stopPropagation();
    if (st.poly) { st.poly.pts.pop(); st.poly.at.pop(); } // the double-click's second press added a point
    finishPoly();
  }

  const onLeave = () => setHover(null);

  function onSpace(e) {
    if (e.code !== 'Space' || !st.active) return;
    const t = e.target;
    const onMap = !t || t === document.body || ctx.root.contains(t);
    if (!onMap || t.isContentEditable || /^(input|textarea|select|button)$/i.test(t.tagName || '') || t.closest?.('.map-edit')) return;
    const down = e.type === 'keydown';
    if (down) e.preventDefault();
    if (down === st.space) return;
    st.space = down;
    applyMode();
  }

  /** Map dragging and cursors follow the tool (Space held = pan, as in the Combat Ring). */
  function applyMode() {
    const map = ctx.map();
    if (!map) return;
    const draw = drawing();
    ctx.root.classList.toggle('is-fog-tool', draw);
    ctx.root.classList.toggle('is-fog-select', draw && st.tool === 'select');
    ctx.root.classList.toggle('is-fog-toggle', draw && st.tool === 'toggle');
    if (draw) map.dragging.disable(); else map.dragging.enable();
    if (!draw) { setHover(null); if (st.stroke) cancelDraft(); }
  }

  function setActive(on) {
    if (on === st.active) return;
    st.active = on;
    if (on) {
      ctx.canvas.addEventListener('pointerdown', onDown, true);
      ctx.canvas.addEventListener('pointermove', onMove, true);
      ctx.canvas.addEventListener('dblclick', onDblClick, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('keydown', onSpace, true);
      window.addEventListener('keyup', onSpace, true);
      ctx.canvas.addEventListener('pointerleave', onLeave);
    } else {
      cancelDraft();
      st.space = false;
      ctx.canvas.removeEventListener('pointerdown', onDown, true);
      ctx.canvas.removeEventListener('pointermove', onMove, true);
      ctx.canvas.removeEventListener('dblclick', onDblClick, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onSpace, true);
      window.removeEventListener('keyup', onSpace, true);
      ctx.canvas.removeEventListener('pointerleave', onLeave);
      st.pointers.clear();
      st.picked.clear();
      st.hover = null;
    }
    applyMode();
  }

  return {
    sync,
    clear: clearLayer,
    /** Keep the fog inside rect {x, y, w, h} (the crop), or the whole image (null). */
    clipTo(rect) {
      st.clip = clipStyle(rect, ctx.size());
      for (const el of ctx.root.querySelectorAll('.map-fog')) el.style.clipPath = st.clip;
    },
    /** Is this point of the current map under its fog (for the players)? */
    covers: (x, y) => !!st.fog && fogActive(st.fog) && fogCovers(st.fog, x, y),
    get fog() { return st.fog || data.fogOf(ctx.mapId()); },
    /** The wash's color (the map's background). */
    get color() { return ctx.color(); },
    /** "Player view": the DM sees the fog as the players do. */
    get preview() { return st.preview; },
    setPreview(on) { st.preview = !!on; ctx.changed(); sync({ animate: false }); ui(); },
    /** The Fog tab is open (tools listen) or closed. */
    setActive,
    get tool() { return st.tool; },
    setTool(t) { st.tool = FOG_TOOLS.includes(t) ? t : 'pan'; cancelDraft(); if (st.tool !== 'select') { st.picked.clear(); restyleEdges(); } applyMode(); },
    get what() { return st.what; },
    setWhat(w) { st.what = w === 'clear' ? 'clear' : 'fog'; if (st.poly) st.poly.what = st.what; drawDraft(); },
    /** A callback for the panel: the selection, history or fog changed. */
    onUi(fn) { st.onUi = fn; },
    get picked() { return [...st.picked]; },
    pickedAreas() { return areasNow().filter((a) => st.picked.has(a.id)); },
    clearPicked() { st.picked.clear(); restyleEdges(); ui(); },
    revealPicked: () => setOn([...st.picked], false),
    hidePicked: () => setOn([...st.picked], true),
    deletePicked() {
      const n = st.picked.size;
      if (!n) return 0;
      const ids = new Set(st.picked);
      st.picked.clear();
      write(areasNow().filter((a) => !ids.has(a.id)));
      toast(`Deleted ${n} fog area${n === 1 ? '' : 's'}. Ctrl+Z brings ${n === 1 ? 'it' : 'them'} back.`);
      return n;
    },
    coverAll: () => write(addArea(areasNow(), wholeMap(ctx.size()))),
    revealAll: () => setOn(areasNow().map((a) => a.id), false),
    hideAll: () => setOn(areasNow().map((a) => a.id), true),
    deleteAll: () => { st.picked.clear(); return write([]); },
    /** On / off for the players, opacity, softness (not part of undo, which is for the areas). */
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
    /** Keys while the Fog tab is open. Returns true when handled. */
    onKey(e) {
      if (e.key === 'Escape') {
        if (st.poly || st.stroke) { cancelDraft(); return true; }
        if (st.picked.size) { st.picked.clear(); restyleEdges(); ui(); return true; }
        return false;
      }
      if (e.key === 'Enter' && st.poly) { finishPoly(); return true; }
      if (e.key === 'Backspace' && st.poly) { st.poly.pts.pop(); st.poly.at.pop(); if (!st.poly.pts.length) st.poly = null; drawDraft(); return true; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.picked.size) { this.deletePicked(); return true; }
      return false;
    },
  };
}
