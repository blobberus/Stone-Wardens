// Fog of war: a faded wash in the map's background color over parts of a map, hiding what lies beneath until the DM
// reveals it. Modelled on the Combat Ring's one-layer fog. One document per map, content/fog/<mapId>.json:
//   {map, v: 2, on, opacity (0.2-1), softness (0-1), areas: [area…], updated}
// An area is one patch of fog: {id, pts: [x0, y0, x1, y1, …] (its outline, a closed shape), holes: [[…], …] (clearings
// cut into it), on (true = hidden from the players; false = revealed, the DM still sees its outline), z (drawn oldest
// first)}. Coordinates are image pixels, like pins. Areas never overlap: a new area, or a clearing, is cut out of every
// area it touches (added to it as a hole; an area wholly inside it goes). So revealing a patch is a click, and select /
// reveal / hide / delete work per area.
// Documents of the first version (`ops`: add / cut × all / rect / poly / brush, and a style) are read into areas.
// Pure (no DOM): fogdraw.js paints it, fogview.js shows and edits it. node tools/test_mapdesign.mjs.

export const FOG_DIR = 'content/fog';
export const fogPath = (mapId) => `${FOG_DIR}/${mapId}.json`;
export const MAX_AREAS = 400; // fogview refuses more ("Delete all fog" or "Cover the whole map" start afresh)
export const AREA_BYTES = 40000; // an area's holes are simplified until it fits (like the Combat Ring's)
const FAR = 1e5; // the "whole map" of a fog whose map size isn't known

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
let seq = 0;
export const newAreaId = () => `f${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;

/** A flat point list [x0, y0, …] of a closed shape with at least 3 points, rounded to 0.1 px; or null. */
function normPts(p) {
  if (!Array.isArray(p)) return null;
  const out = p.map(Number);
  if (out.some((v) => !Number.isFinite(v))) return null;
  if (out.length % 2) out.pop();
  return out.length >= 6 ? out.map(r1) : null;
}

/** A valid area, or null. */
export function normArea(a, i = 0) {
  if (!isObj(a)) return null;
  const pts = normPts(a.pts);
  if (!pts) return null;
  return {
    id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : `f${i}`,
    pts,
    holes: (Array.isArray(a.holes) ? a.holes : []).map(normPts).filter(Boolean),
    on: a.on !== false,
    z: num(a.z, i),
  };
}

/** Fill in and sanitize a fog document (size {w, h}: the map's, for old "cover all" fog). */
export function normFog(raw, mapId = '', size = null) {
  const d = isObj(raw) ? raw : {};
  let areas = Array.isArray(d.areas) ? d.areas.map(normArea).filter(Boolean) : null;
  if (!areas) areas = Array.isArray(d.ops) ? areasFromOps(d.ops, size) : [];
  const ids = new Set();
  for (const a of areas) { while (ids.has(a.id)) a.id = `${a.id}x`; ids.add(a.id); }
  return {
    map: typeof d.map === 'string' && d.map ? d.map : mapId,
    v: 2,
    on: typeof d.on === 'boolean' ? d.on : true,
    opacity: Math.round(clamp(num(d.opacity, 1), 0.2, 1) * 100) / 100,
    softness: Math.round(clamp(num(d.softness, 0.5), 0, 1) * 100) / 100,
    areas: areas.slice(0, MAX_AREAS).sort((a, b) => a.z - b.z),
    updated: typeof d.updated === 'string' ? d.updated : '',
  };
}

/** Does the fog hide anything from the players? */
export const fogActive = (fog) => !!fog?.on && fog.areas.some((a) => a.on);

// ---------- geometry ----------

const boxes = new WeakMap(); // pts array -> [x0, y0, x1, y1]
export function bboxOf(p) {
  let b = boxes.get(p);
  if (!b) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
    b = [x0, y0, x1, y1];
    boxes.set(p, b);
  }
  return b;
}
const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Is the point inside the closed shape p (even-odd)? */
export function inPoly(p, x, y) {
  const b = bboxOf(p);
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const yi = p[i + 1];
    const yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) inside = !inside;
  }
  return inside;
}

/** Inside an area's outline and not in one of its clearings. */
export const inArea = (a, x, y) => inPoly(a.pts, x, y) && !a.holes.some((h) => inPoly(h, x, y));

/** Is the point hidden from the players? */
export function fogCovers(fog, x, y) {
  if (!fog?.on) return false;
  for (const a of fog.areas) if (a.on && inArea(a, x, y)) return true;
  return false;
}

/** The newest area under the point (revealed ones too: the DM can hide them again), or null. */
export function areaAt(fog, x, y) {
  for (let i = fog.areas.length - 1; i >= 0; i--) if (inArea(fog.areas[i], x, y)) return fog.areas[i];
  return null;
}

/** Areas whose fog meets the rectangle [x0, y0, x1, y1] (Select's box; a box inside one of an area's clearings misses it). */
export function areasIn(fog, box) {
  const r = rectPts(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  return fog.areas.filter((a) => polysMeet(a.pts, r) && !a.holes.some((hl) => polyInside(r, hl)));
}

function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Do two closed shapes overlap at all (a point of one inside the other, or crossing edges)? */
export function polysMeet(p, q) {
  const bp = bboxOf(p);
  const bq = bboxOf(q);
  if (!boxesMeet(bp, bq)) return false;
  if (inPoly(q, p[0], p[1]) || inPoly(p, q[0], q[1])) return true;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ex0 = Math.min(p[j], p[i]); const ex1 = Math.max(p[j], p[i]);
    const ey0 = Math.min(p[j + 1], p[i + 1]); const ey1 = Math.max(p[j + 1], p[i + 1]);
    if (ex1 < bq[0] || ex0 > bq[2] || ey1 < bq[1] || ey0 > bq[3]) continue;
    for (let k = 0, l = q.length - 2; k < q.length; l = k, k += 2) {
      if (segsCross(p[j], p[j + 1], p[i], p[i + 1], q[l], q[l + 1], q[k], q[k + 1])) return true;
    }
  }
  return false;
}

/** Is shape p wholly inside shape q (every point of p inside q, no crossing edges)? */
export function polyInside(p, q) {
  if (!boxesMeet(bboxOf(p), bboxOf(q))) return false;
  for (let i = 0; i < p.length; i += 2) if (!inPoly(q, p[i], p[i + 1])) return false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    for (let k = 0, l = q.length - 2; k < q.length; l = k, k += 2) {
      if (segsCross(p[j], p[j + 1], p[i], p[i + 1], q[l], q[l + 1], q[k], q[k + 1])) return false;
    }
  }
  return true;
}

/** Signed area of a closed shape (px²; the sign tells its winding). */
export function polyArea(p) {
  let s = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) s += (p[j] - p[i]) * (p[j + 1] + p[i + 1]);
  return s / 2;
}

export const rectPts = (x, y, w, h) => {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return [x, y, x + w, y, x + w, y + h, x, y + h].map(r1);
};
export const wholeMap = (size) => (size?.w > 0 && size?.h > 0 ? rectPts(0, 0, size.w, size.h) : rectPts(-FAR, -FAR, 2 * FAR, 2 * FAR));

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

/** Keep an area under AREA_BYTES by simplifying its clearings more and more. */
export function capArea(a) {
  const size = (x) => JSON.stringify(x).length;
  if (size(a) <= AREA_BYTES) return a;
  let out = a;
  for (let tol = 1; tol <= 64 && size(out) > AREA_BYTES; tol *= 2) {
    out = { ...a, holes: a.holes.map((h) => { const s = simplify(h, tol).map(r1); return s.length >= 6 ? s : h; }) };
  }
  return out;
}

/** Cut a shape out of the areas: added to each area it touches as a clearing; an area wholly inside it goes. */
export function cutFog(areas, cut) {
  const out = [];
  for (const a of areas) {
    if (!polysMeet(a.pts, cut)) { out.push(a); continue; }
    if (polyInside(a.pts, cut)) continue;
    const holes = a.holes.filter((hl) => !polyInside(hl, cut)); // the new clearing covers them
    out.push(capArea({ ...a, holes: [...holes, cut] }));
  }
  return out;
}

/** Add a new patch of fog over the areas (one layer: it is cut out of the ones it touches). */
export function addArea(areas, pts, { id = newAreaId(), z = Date.now(), on = true } = {}) {
  const shape = pts.map(r1);
  const cut = cutFog(areas, shape);
  const lastZ = cut.reduce((m, a) => Math.max(m, a.z), -Infinity);
  return [...cut, { id, pts: shape, holes: [], on, z: Math.max(z, lastZ + 1) }];
}

/** A brush stroke of the first version (a polyline with round ends, radius r) as a closed outline. */
export function strokeOutline(p, r) {
  const n = p.length / 2;
  const circle = (x, y) => Array.from({ length: 16 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 8), y + r * Math.sin((i * Math.PI) / 8)]).flat();
  if (n === 1 || p.length < 4) return circle(p[0], p[1]);
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let dx = p[2 * i1] - p[2 * i0];
    let dy = p[2 * i1 + 1] - p[2 * i0 + 1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    left.push(p[2 * i] - dy * r, p[2 * i + 1] + dx * r);
    right.push(p[2 * i] + dy * r, p[2 * i + 1] - dx * r);
  }
  const cap = (cx, cy, ax, ay, from) => { // a half circle from one side to the other around (cx, cy)
    const out = [];
    const a0 = Math.atan2(ay - cy, ax - cx);
    for (let k = 1; k < 8; k++) out.push(cx + r * Math.cos(a0 + from * (k * Math.PI) / 8), cy + r * Math.sin(a0 + from * (k * Math.PI) / 8));
    return out;
  };
  const back = [];
  for (let i = n - 1; i >= 0; i--) back.push(right[2 * i], right[2 * i + 1]);
  const endCap = cap(p[2 * n - 2], p[2 * n - 1], left[2 * n - 2], left[2 * n - 1], -1);
  const startCap = cap(p[0], p[1], right[0], right[1], -1);
  return [...left, ...endCap, ...back, ...startCap];
}

/** Ops of the first version, replayed into areas. */
export function areasFromOps(ops, size = null) {
  let areas = [];
  let z = 0;
  for (const o of ops) {
    if (!isObj(o)) continue;
    const p = (Array.isArray(o.p) ? o.p : []).map(Number);
    if (p.some((v) => !Number.isFinite(v))) continue;
    let shape = null;
    if (o.k === 'all') shape = wholeMap(size);
    else if (o.k === 'rect' && p.length === 4 && p[2] && p[3]) shape = rectPts(...p);
    else if (o.k === 'poly' && p.length >= 6) shape = p.slice(0, p.length - (p.length % 2));
    else if (o.k === 'brush' && p.length >= 2 && num(o.r) > 0) shape = strokeOutline(p.slice(0, p.length - (p.length % 2)), num(o.r));
    if (!shape) continue;
    z += 1;
    areas = o.t === 'cut' ? cutFog(areas, shape.map(r1)) : addArea(areas, shape, { id: `f${z}`, z });
    if (areas.length > MAX_AREAS) areas = areas.slice(-MAX_AREAS);
  }
  return areas;
}

/** A short fingerprint of what the players see (FNV-1a), to tell whether a device has seen this fog already. */
export function fogHash(fog) {
  const s = JSON.stringify(fog.on ? fog.areas.filter((a) => a.on).map((a) => [a.pts, a.holes]) : []);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Areas scaled with the image (a replacement image of another size, pins rescaled too). */
export function scaleAreas(areas, sx, sy) {
  const sc = (p) => p.map((v, i) => r1(v * (i % 2 ? sy : sx)));
  return areas.map((a) => ({ ...a, pts: sc(a.pts), holes: a.holes.map(sc) }));
}
