// Fog of war: clouds (or a faded color) over parts of a map that hide what lies beneath until the DM reveals it.
// One document per map, content/fog/<mapId>.json:
//   {map, on, style: 'clouds'|'mist'|'solid', color, opacity (0.2-1), softness (0-1), ops: [op…], updated}
// An op adds fog or cuts it away, in order: {t: 'add'|'cut', k: 'all'|'rect'|'poly'|'brush', p: [numbers], r}
//   all: the whole map · rect: p = [x, y, w, h] · poly: p = [x0, y0, x1, y1, …] (a closed shape) ·
//   brush: p = [x0, y0, …] (a stroke, round ends) with radius r. Coordinates are image pixels, like pins.
// So revealing is just more ops, and an older state is a prefix of the list (fogview.js animates the difference).
// Pure (no DOM): fogdraw.js paints it, fogview.js shows and edits it. node tools/test_mapdesign.mjs.

export const FOG_DIR = 'content/fog';
export const fogPath = (mapId) => `${FOG_DIR}/${mapId}.json`;
export const FOG_STYLES = [
  { id: 'clouds', label: 'Clouds' },
  { id: 'mist', label: 'Mist' },
  { id: 'solid', label: 'Faded color' },
];
const STYLE_IDS = new Set(FOG_STYLES.map((s) => s.id));
const KINDS = new Set(['all', 'rect', 'poly', 'brush']);
export const MAX_OPS = 4000; // fogview refuses more (Cover all / Reveal all start a fresh list)

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;

/** A valid op, or null. Coordinates are rounded to 0.1 px. */
export function normOp(o) {
  if (!isObj(o) || !KINDS.has(o.k)) return null;
  const t = o.t === 'cut' ? 'cut' : 'add';
  if (o.k === 'all') return { t, k: 'all' };
  const p = (Array.isArray(o.p) ? o.p : []).map(Number);
  if (p.some((v) => !Number.isFinite(v))) return null;
  if (o.k === 'rect') {
    if (p.length !== 4) return null;
    let [x, y, w, h] = p;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    return w > 0 && h > 0 ? { t, k: 'rect', p: [x, y, w, h].map(r1) } : null;
  }
  if (p.length % 2) p.pop();
  if (o.k === 'poly') return p.length >= 6 ? { t, k: 'poly', p: p.map(r1) } : null;
  const r = num(o.r);
  return p.length >= 2 && r > 0 ? { t, k: 'brush', p: p.map(r1), r: r1(r) } : null;
}

/** Fill in and sanitize a fog document. */
export function normFog(raw, mapId = '') {
  const d = isObj(raw) ? raw : {};
  return {
    map: typeof d.map === 'string' && d.map ? d.map : mapId,
    on: typeof d.on === 'boolean' ? d.on : true,
    style: STYLE_IDS.has(d.style) ? d.style : 'clouds',
    color: typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color.toLowerCase() : '#3a3f47',
    opacity: Math.round(clamp(num(d.opacity, 1), 0.2, 1) * 100) / 100,
    softness: Math.round(clamp(num(d.softness, 0.5), 0, 1) * 100) / 100,
    ops: (Array.isArray(d.ops) ? d.ops : []).map(normOp).filter(Boolean).slice(0, MAX_OPS),
    updated: typeof d.updated === 'string' ? d.updated : '',
  };
}

/** Does the fog cover anything at all? */
export const fogActive = (fog) => !!fog?.on && fog.ops.some((o) => o.t === 'add');

const boxes = new WeakMap(); // op -> [x0, y0, x1, y1] (brush and poly), for a quick miss
function boxOf(op) {
  let b = boxes.get(op);
  if (!b) {
    const p = op.p;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
    const r = op.r || 0;
    b = [x0 - r, y0 - r, x1 + r, y1 + r];
    boxes.set(op, b);
  }
  return b;
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Does one op's shape contain the point? */
export function opHits(op, x, y) {
  if (op.k === 'all') return true;
  const p = op.p;
  if (op.k === 'rect') return x >= p[0] && x <= p[0] + p[2] && y >= p[1] && y <= p[1] + p[3];
  const b = boxOf(op);
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  if (op.k === 'poly') {
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const yi = p[i + 1];
      const yj = p[j + 1];
      if ((yi > y) !== (yj > y) && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) inside = !inside;
    }
    return inside;
  }
  const r2 = op.r * op.r;
  if (p.length === 2) return (x - p[0]) ** 2 + (y - p[1]) ** 2 <= r2;
  for (let i = 2; i < p.length; i += 2) if (segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= r2) return true;
  return false;
}

/** Is the point under the fog? (The last op whose shape contains it decides; the soft edge is ignored.) */
export function fogCovers(fog, x, y) {
  if (!fog?.on) return false;
  const ops = fog.ops;
  for (let i = ops.length - 1; i >= 0; i--) if (opHits(ops[i], x, y)) return ops[i].t === 'add';
  return false;
}

/** Ramer–Douglas–Peucker on a flat [x0, y0, x1, y1, …] list: fewer points, same shape within tol px. */
export function simplify(p, tol = 1) {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(p[2 * i], p[2 * i + 1], p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1]);
      if (d > best) { best = d; bi = i; }
    }
    if (best > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}

/** A short fingerprint of the first n ops (FNV-1a), to tell whether a remembered state is a prefix of the list. */
export function opsHash(ops, n = ops.length) {
  const s = JSON.stringify(ops.slice(0, n));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Ops scaled with the image (a replacement image of another size, pins rescaled too). */
export function scaleOps(ops, sx, sy) {
  const s = Math.sqrt(Math.abs(sx * sy));
  return ops.map((o) => {
    if (o.k === 'all') return o;
    const p = o.p.map((v, i) => r1(v * (i % 2 ? sy : sx))); // [x, y, …] and rect [x, y, w, h] alike
    return o.k === 'brush' ? { ...o, p, r: r1(o.r * s) } : { ...o, p };
  });
}
