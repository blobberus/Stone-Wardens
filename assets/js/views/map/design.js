// Map design: the `design` field of a map document (content/map/config.json, content/maps/<id>.json) — background,
// crop, compass, scale bar and ruler, border. Pure (no DOM, no store): defaults and sanitizing, the scale bar's round
// numbers, distances, and the SVG markup of compasses and borders. docs/map-design.md; node tools/test_mapdesign.mjs.
//
// design = {
//   background: {kind: 'theme'|'parchment'|'sea'|'night'|'color'|'image', color, image (repo path), fit: 'tile'|'cover'},
//   crop: {x, y, w, h} in image px, or null (the whole image),
//   compass: {show, type, anchor: 'screen'|'map', corner, size (screen px), x, y (map: fractions of the image),
//             mapSize (map: fraction of the image width), rotation (degrees), color},
//   scale: {show, ruler, unit, custom (unit name), perPx (units per image px; 0 = not set), style, corner,
//           pace: {on, per (units per pace unit), label}},
//   border: {show, type, color, accent ('' = the style's own), width (band, percent of the image's short side),
//            pad (mat between the image and the frame, same unit), corners ('auto' = the style's own),
//            mat: 'paper'|'color'|'none', matColor},
// }

export const BACKGROUNDS = [
  { id: 'theme', label: 'Default', hint: 'Follows the light or dark theme' },
  { id: 'parchment', label: 'Parchment' },
  { id: 'sea', label: 'Sea' },
  { id: 'night', label: 'Night' },
  { id: 'color', label: 'Color' },
  { id: 'image', label: 'Image' },
];
export const COMPASS_TYPES = [
  { id: 'rose', label: 'Compass rose' },
  { id: 'star', label: 'Sixteen-point star' },
  { id: 'ornate', label: 'Ornate ring' },
  { id: 'arrow', label: 'North arrow' },
  { id: 'minimal', label: 'Minimal' },
];
export const CORNERS = [
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
];
export const UNITS = [
  { id: 'miles', one: 'mile', many: 'miles' },
  { id: 'km', one: 'km', many: 'km' },
  { id: 'leagues', one: 'league', many: 'leagues' },
  { id: 'feet', one: 'foot', many: 'feet' },
  { id: 'm', one: 'm', many: 'm' },
  { id: 'days', one: 'day', many: 'days' },
  { id: 'custom', one: '', many: '' },
];
export const SCALE_STYLES = [
  { id: 'checkered', label: 'Checkered bar' },
  { id: 'line', label: 'Line' },
  { id: 'ticks', label: 'Ruler ticks' },
];
/**
 * Frame styles. accent = what the second color paints (none: no second color), tint = that color by default (else the
 * ink), paper = always on a sheet, width = a good thickness for it (the Design tab moves to it when switching styles).
 */
export const BORDER_TYPES = [
  { id: 'line', label: 'Single line', width: 1.2 },
  { id: 'double', label: 'Double line', accent: 'inner line', width: 1.6 },
  { id: 'inked', label: 'Hand-inked', accent: 'inner line', width: 1.8 },
  { id: 'checker', label: 'Checkered band', accent: 'light blocks', width: 1.6 },
  { id: 'ruler', label: 'Graduated', accent: 'ticks', width: 1.8 },
  { id: 'ornate', label: 'Ornate', accent: 'diamonds', width: 1.8 },
  { id: 'rope', label: 'Rope', accent: 'strands', width: 1.8 },
  { id: 'meander', label: 'Greek key', accent: 'ground', width: 2 },
  { id: 'vine', label: 'Vine', accent: 'leaves', width: 2.6 },
  { id: 'beads', label: 'Bead and reel', accent: 'beads', width: 1.6 },
  { id: 'scallop', label: 'Scalloped', accent: 'drops', width: 2 },
  { id: 'deco', label: 'Art deco', accent: 'inner lines', width: 2 },
  { id: 'deckle', label: 'Torn edge', accent: 'aged edge', tint: '#8b6b3d', paper: true, width: 2.4 },
  { id: 'burnt', label: 'Burnt edge', accent: 'scorch', tint: '#7a4a1f', paper: true, width: 2.6 },
  { id: 'wash', label: 'Ink wash', accent: 'wash', tint: '#5a4632', width: 3 },
];
/** Corner ornaments; 'auto' = the style's own (OWN_CORNERS). */
export const BORDER_CORNERS = [
  { id: 'auto', label: 'Auto', hint: 'The style’s own corners' },
  { id: 'none', label: 'None' },
  { id: 'square', label: 'Square' },
  { id: 'rosette', label: 'Rosette' },
  { id: 'knot', label: 'Knot' },
  { id: 'star', label: 'Star' },
];
/** What fills the band and the space between the image and the frame. */
export const BORDER_MATS = [
  { id: 'paper', label: 'Parchment' },
  { id: 'color', label: 'Color' },
  { id: 'none', label: 'None', hint: 'See-through: the map’s background shows' },
];
export const INK = '#1f1a14';
export const PAPER = '#efe5cc';

const ids = (list) => new Set(list.map((x) => x.id));
const BG_IDS = ids(BACKGROUNDS);
const COMPASS_IDS = ids(COMPASS_TYPES);
const CORNER_IDS = ids(CORNERS);
const UNIT_IDS = ids(UNITS);
const STYLE_IDS = ids(SCALE_STYLES);
const BORDER_IDS = ids(BORDER_TYPES);
const BORDER_CORNER_IDS = ids(BORDER_CORNERS);
const MAT_IDS = ids(BORDER_MATS);
/** Each style's own corners: an ornament, 'blocks' / 'jewel' (drawn by the style itself) or nothing. */
const OWN_CORNERS = { checker: 'blocks', ornate: 'square', rope: 'knot', vine: 'rosette', deco: 'jewel' };
const ORNAMENTS = new Set(['square', 'rosette', 'knot', 'star', 'jewel']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const oneOf = (v, set, d) => (set.has(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const str = (v, max = 40) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A #rgb / #rrggbb color (what <input type=color> gives), else the fallback. */
export const hexColor = (v, d) => (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : d);
/** A repo path under content/ (an uploaded image), else ''. */
const repoPath = (v) => (typeof v === 'string' && /^content\/[^\s]+\.(png|jpe?g|webp|gif|avif|svg)$/i.test(v) && !v.includes('..') ? v : '');

/**
 * The crop rectangle clamped to the image, or null for the whole image. While the size is not known yet the numbers
 * are kept as they are (normCrop runs again once it is).
 */
export function normCrop(c, W, H) {
  if (!isObj(c)) return null;
  if (!(W > 0 && H > 0)) return { x: num(c.x), y: num(c.y), w: num(c.w), h: num(c.h) };
  const x = clamp(Math.round(num(c.x)), 0, W - 16);
  const y = clamp(Math.round(num(c.y)), 0, H - 16);
  const w = clamp(Math.round(num(c.w, W)), 16, W - x);
  const hh = clamp(Math.round(num(c.h, H)), 16, H - y);
  if (x === 0 && y === 0 && w === W && hh === H) return null;
  return { x, y, w, h: hh };
}

/** Fill in and sanitize a design (unknown fields are dropped). size: {width, height} of the image, if known. */
export function normDesign(raw, size = {}) {
  const d = isObj(raw) ? raw : {};
  const b = isObj(d.background) ? d.background : {};
  const c = isObj(d.compass) ? d.compass : {};
  const s = isObj(d.scale) ? d.scale : {};
  const p = isObj(s.pace) ? s.pace : {};
  const r = isObj(d.border) ? d.border : {};
  const btype = oneOf(r.type, BORDER_IDS, 'double');
  const image = repoPath(b.image);
  let kind = oneOf(b.kind, BG_IDS, 'theme');
  if (kind === 'image' && !image) kind = 'theme';
  return {
    background: { kind, color: hexColor(b.color, '#c9b98f'), image, fit: b.fit === 'cover' ? 'cover' : 'tile' },
    crop: normCrop(d.crop, num(size.width), num(size.height)),
    compass: {
      show: bool(c.show, false),
      type: oneOf(c.type, COMPASS_IDS, 'rose'),
      anchor: c.anchor === 'map' ? 'map' : 'screen',
      corner: oneOf(c.corner, CORNER_IDS, 'bl'),
      size: Math.round(clamp(num(c.size, 112), 48, 260)),
      x: clamp(num(c.x, 0.1), 0, 1),
      y: clamp(num(c.y, 0.82), 0, 1),
      mapSize: clamp(num(c.mapSize, 0.12), 0.03, 0.6),
      rotation: Math.round(((num(c.rotation) % 360) + 360) % 360),
      color: hexColor(c.color, INK),
    },
    scale: {
      show: bool(s.show, false),
      ruler: bool(s.ruler, true),
      unit: oneOf(s.unit, UNIT_IDS, 'miles'),
      custom: str(s.custom, 24),
      perPx: num(s.perPx) > 0 && num(s.perPx) < 1e9 ? num(s.perPx) : 0,
      style: oneOf(s.style, STYLE_IDS, 'checkered'),
      corner: oneOf(s.corner, CORNER_IDS, 'bl'),
      pace: { on: bool(p.on, false), per: num(p.per) > 0 ? num(p.per) : 24, label: str(p.label, 24) || 'days on foot' },
    },
    border: {
      show: bool(r.show, false),
      type: btype,
      color: hexColor(r.color, INK),
      accent: hexColor(r.accent, ''),
      width: Math.round(clamp(num(r.width, 1.6), 0.3, 6) * 10) / 10,
      pad: Math.round(clamp(num(r.pad, 0), 0, 5) * 10) / 10,
      corners: oneOf(r.corners, BORDER_CORNER_IDS, 'auto'),
      mat: oneOf(r.mat, MAT_IDS, btype === 'line' ? 'none' : 'paper'), // older designs: the single line had no mat
      matColor: hexColor(r.matColor, PAPER),
    },
  };
}

/** Is there anything to draw for this design (a compass, scale bar or border that is shown)? */
export const hasDecorations = (d) => !!(d?.compass?.show || (d?.scale?.show && d.scale.perPx > 0) || d?.border?.show);

// ---------- distances ----------

/** Unit name for a value: "1 mile", "3 miles"; a custom unit is used as typed. */
export function unitName(scale, value) {
  if (scale.unit === 'custom') return scale.custom || 'units';
  const u = UNITS.find((x) => x.id === scale.unit) || UNITS[0];
  return Math.abs(value - 1) < 1e-9 ? u.one : u.many;
}

/** A number for a label: at most 3 significant digits below 100, whole numbers above; no trailing zeros. */
export function fmtNum(v) {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  const n = a >= 100 ? Math.round(v) : a >= 10 ? Math.round(v * 10) / 10 : a >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000;
  return String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "12.5 miles" (+ " · ≈ 0.52 days on foot" with a travel pace). */
export function fmtDistance(scale, dist) {
  const base = `${fmtNum(dist)} ${unitName(scale, dist)}`;
  if (!scale.pace?.on || !(scale.pace.per > 0)) return base;
  return `${base} · ≈ ${fmtNum(dist / scale.pace.per)} ${scale.pace.label}`;
}

/**
 * A scale bar of round length for a view: unitsPerScreenPx = perPx / (screen px per image px).
 * -> {value, px, segments} with px <= targetPx (and > targetPx / 2.5), or null when no scale is set.
 */
export function niceScale(unitsPerScreenPx, targetPx = 150) {
  if (!(unitsPerScreenPx > 0) || !Number.isFinite(unitsPerScreenPx)) return null;
  const raw = unitsPerScreenPx * targetPx;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const nice = m >= 5 ? 5 : m >= 2 ? 2 : 1;
  const value = nice * p;
  return { value, px: value / unitsPerScreenPx, segments: nice === 5 ? 5 : 4 };
}

/** Length of a path [{x, y}…] in image px. */
export function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return d;
}

// ---------- compass SVG ----------

const f = (n) => Math.round(n * 100) / 100;

/** Two halves of one point of a compass rose, aimed at `angle` degrees (0 = north): ink right, paper left. */
function point(R, w, angle, ink, paper, sw = 1) {
  return `<g transform="rotate(${angle})"><path d="M0 0L${-f(w)} ${-f(w)}L0 ${-f(R)}Z" fill="${paper}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`
    + `<path d="M0 0L${f(w)} ${-f(w)}L0 ${-f(R)}Z" fill="${ink}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/></g>`;
}
const letter = (t, x, y, size, ink, anchor = 'middle', weight = 700) => `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="${weight}" fill="${ink}">${t}</text>`;
const letters = (R, size, ink) => letter('N', 0, -(R + 5), size + 2, ink)
  + letter('E', R + 5, size * 0.36, size, ink, 'start', 600)
  + letter('S', 0, R + 5 + size * 0.75, size, ink, 'middle', 600)
  + letter('W', -(R + 5), size * 0.36, size, ink, 'end', 600);

/**
 * The SVG markup of a compass (viewBox -64 -64 128 128; rotation in degrees, colors as #hex). Letters are drawn as
 * text in a serif font, so they turn with the compass like on an old map.
 */
export function compassSvg(type = 'rose', { color = INK, paper = PAPER, rotation = 0, title = 'Compass' } = {}) {
  const ink = hexColor(color, INK);
  const pap = hexColor(paper, PAPER);
  let g = '';
  if (type === 'star') {
    for (let i = 0; i < 8; i++) g += point(20, 4, 22.5 + i * 45, ink, pap, 0.8);
    for (const a of [45, 135, 225, 315]) g += point(31, 6, a, ink, pap, 0.9);
    for (const a of [0, 90, 180, 270]) g += point(46, 7.5, a, ink, pap);
    g += `<circle r="5" fill="${pap}" stroke="${ink}" stroke-width="1.2"/>${letter('N', 0, -50, 13, ink)}`;
  } else if (type === 'ornate') {
    let ticks = '';
    for (let a = 0; a < 360; a += 10) {
      const long = a % 30 === 0;
      const r0 = 44;
      const r1 = long ? 50 : 47;
      const t = (a * Math.PI) / 180;
      ticks += `<line x1="${f(Math.sin(t) * r0)}" y1="${f(-Math.cos(t) * r0)}" x2="${f(Math.sin(t) * r1)}" y2="${f(-Math.cos(t) * r1)}" stroke="${ink}" stroke-width="${long ? 1.4 : 0.8}"/>`;
    }
    g += `<circle r="50" fill="${pap}" fill-opacity="0.55" stroke="${ink}" stroke-width="1.6"/><circle r="44" fill="none" stroke="${ink}" stroke-width="1"/>${ticks}`;
    for (const a of [45, 135, 225, 315]) g += point(27, 6, a, ink, pap, 0.9);
    for (const a of [0, 90, 180, 270]) g += point(41, 8, a, ink, pap);
    g += `<circle r="4.5" fill="${pap}" stroke="${ink}" stroke-width="1.2"/>${letter('N', 0, -54, 12, ink)}`;
  } else if (type === 'arrow') {
    g += `<path d="M0 -34L-13 34L0 22Z" fill="${pap}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>`
      + `<path d="M0 -34L13 34L0 22Z" fill="${ink}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>${letter('N', 0, -40, 18, ink)}`;
  } else if (type === 'minimal') {
    g += `<circle r="30" fill="${pap}" fill-opacity="0.6" stroke="${ink}" stroke-width="2"/><path d="M0 -46L7 -31L-7 -31Z" fill="${ink}"/>`
      + `${letter('N', 0, -8, 18, ink)}<circle r="2.4" cy="6" fill="${ink}"/>`;
  } else { // rose
    g += `<circle r="17" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
    for (const a of [45, 135, 225, 315]) g += point(27, 6, a, ink, pap, 0.9);
    for (const a of [0, 90, 180, 270]) g += point(42, 8, a, ink, pap);
    g += letters(42, 11, ink);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" role="img" aria-label="${title}"><g transform="rotate(${Math.round(rotation)})">${g}</g></svg>`;
}

// ---------- border SVG ----------
//
// The frame is one SVG over the image's rectangle grown by the gap and the band (layers.js resizes it with the map, so
// it stays crisp at any zoom; the browser redraws it every zoom frame, so it must stay cheap to draw). It is built once
// per change: rules are rectangles, a repeating motif is one path per side orientation (a whole number of tiles
// between the corners, see strip()), corners are small ornaments, and the hand-made styles are a few seeded noisy
// paths (the same on every device and every redraw). Keep every style under ~3 ms to draw on the main map.

const f1 = (n) => Math.round(n * 10) / 10;
const rectStroke = (x, y, w, hh, color, sw) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(hh)}" fill="none" stroke="${color}" stroke-width="${f(sw)}"/>`;
const diamond = (cx, cy, r, fill) => `<path d="M${f(cx)} ${f(cy - r)}L${f(cx + r)} ${f(cy)}L${f(cx)} ${f(cy + r)}L${f(cx - r)} ${f(cy)}Z" fill="${fill}"/>`;

/** Band thickness B and gap P (mat between the image and the frame) in image px. */
function bandSize(border, rect) {
  const s = Math.min(rect.w, rect.h);
  return { B: Math.max(1, ((num(border?.width) || 1.6) / 100) * s), P: Math.max(0, (num(border?.pad) / 100) * s) };
}

/** How far the frame reaches out from the shown rectangle (band + gap), in image px; 0 when it is not shown. */
export const borderPad = (border, rect) => {
  if (!border?.show) return 0;
  const { B, P } = bandSize(border, rect);
  return B + P;
};

/** The corners a border draws: 'auto' resolves to the style's own. */
export function borderCorners(border) {
  const type = oneOf(border?.type, BORDER_IDS, 'double');
  const k = oneOf(border?.corners, BORDER_CORNER_IDS, 'auto');
  return k === 'auto' ? OWN_CORNERS[type] || 'none' : k;
}

/** What the second color paints for this border ('' = nothing: the picker can be left out). */
export function borderAccentUse(border) {
  const t = BORDER_TYPES.find((x) => x.id === border?.type);
  if (t?.accent) return t.accent;
  return ['square', 'rosette', 'knot', 'star'].includes(borderCorners(border)) ? 'corners' : '';
}

// seeded noise: the hand-made styles look the same everywhere and on every redraw
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(text) {
  let hsh = 2166136261;
  for (let i = 0; i < text.length; i++) hsh = Math.imul(hsh ^ text.charCodeAt(i), 16777619);
  return hsh >>> 0;
}
/** Smooth noise over [0, len), periodic (the end meets the start): -> fn(s) in [-1, 1]. */
function noise(rand, len, wave) {
  const n = Math.max(3, Math.round(len / Math.max(1e-6, wave)));
  const v = Array.from({ length: n }, () => rand() * 2 - 1);
  return (s) => {
    const t = ((((s / len) * n) % n) + n) % n;
    const i = Math.floor(t);
    const k = (1 - Math.cos((t - i) * Math.PI)) / 2;
    return v[i % n] * (1 - k) + v[(i + 1) % n] * k;
  };
}

/** Points along a rounded rectangle (clockwise from the top left) with outward normals and arc length s. */
function ringPoints(r, R, step) {
  const rad = Math.max(0, Math.min(R, r.w / 2, r.h / 2));
  const raw = [];
  const straight = (ax, ay, bx, by, nx, ny) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i < n; i++) raw.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, nx, ny]);
  };
  const arc = (cx, cy, a0) => {
    const n = Math.max(2, Math.round(((Math.PI / 2) * rad) / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      raw.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, Math.cos(a), Math.sin(a)]);
    }
  };
  const { x, y, w } = r;
  const hh = r.h;
  straight(x + rad, y, x + w - rad, y, 0, -1);
  arc(x + w - rad, y + rad, -Math.PI / 2);
  straight(x + w, y + rad, x + w, y + hh - rad, 1, 0);
  arc(x + w - rad, y + hh - rad, 0);
  straight(x + w - rad, y + hh, x + rad, y + hh, 0, 1);
  arc(x + rad, y + hh - rad, Math.PI / 2);
  straight(x, y + hh - rad, x, y + rad, -1, 0);
  arc(x + rad, y + rad, Math.PI);
  let s = 0;
  const pts = raw.map((p, i) => {
    if (i) s += Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]);
    return { x: p[0], y: p[1], nx: p[2], ny: p[3], s };
  });
  const last = raw[raw.length - 1];
  return { pts, len: s + Math.hypot(raw[0][0] - last[0], raw[0][1] - last[1]) };
}
/** A closed path through the ring's points moved inward by depth(point) (relative steps: about half the text). */
function inset(ring, depth) {
  let px = 0;
  let py = 0;
  return `${ring.pts.map((p, i) => {
    const d = depth(p);
    const qx = f1(p.x - p.nx * d);
    const qy = f1(p.y - p.ny * d);
    const s = i ? `l${f1(qx - px)} ${f1(qy - py)}` : `M${qx} ${qy}`;
    px = qx;
    py = qy;
    return s;
  }).join('')}Z`;
}
/** #rrggbb between colors p (t = 0) and q (t = 1). */
function mix(p, q, t) {
  const rgb = (v) => { const s = v.length === 4 ? v.replace(/[0-9a-f]/gi, '$&$&').slice(1) : v.slice(1); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
  const a = rgb(p);
  const b = rgb(q);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const rectPath = (r) => `M${f(r.x)} ${f(r.y)}h${f(r.w)}v${f(r.h)}h${f(-r.w)}Z`;
const holePath = (r) => `M${f(r.x)} ${f(r.y)}v${f(r.h)}h${f(r.w)}v${f(-r.h)}Z`;

/** A brush stroke from a to b (normal n): wobbling, its width swelling and thinning, tapered ends. */
function brushStroke(a, b, n, wid, B, rand) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / L;
  const dy = (b[1] - a[1]) / L;
  const steps = Math.max(6, Math.round(L / (B * 0.3)));
  const wob = noise(rand, L, B * 6);
  const wob2 = noise(rand, L, B * 1.3);
  const thick = noise(rand, L, B * 2.2);
  const d0 = (rand() - 0.5) * B * 0.18;
  const d1 = (rand() - 0.5) * B * 0.18;
  const top = [];
  const bot = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * L;
    const off = d0 + ((d1 - d0) * i) / steps + wob(u) * B * 0.085 + wob2(u) * B * 0.022;
    const end = Math.min(1, u / (B * 0.8), (L - u) / (B * 0.8));
    const ww = (wid * (0.75 + 0.35 * thick(u)) * (0.3 + 0.7 * Math.sqrt(Math.max(0, end)))) / 2;
    const cx = a[0] + dx * u + n[0] * off;
    const cy = a[1] + dy * u + n[1] * off;
    top.push([f1(cx + n[0] * ww), f1(cy + n[1] * ww)]);
    bot.push([f1(cx - n[0] * ww), f1(cy - n[1] * ww)]);
  }
  const pts = [...top, ...bot.reverse()];
  return `M${pts[0][0]} ${pts[0][1]}${pts.slice(1).map((p, i) => `l${f1(p[0] - pts[i][0])} ${f1(p[1] - pts[i][1])}`).join('')}Z`;
}

/** A corner ornament centred on 0 0, s across. c = ink, a = second color, g = its ground. */
function ornament(kind, s, B, c, a, g) {
  if (kind === 'square') {
    return `<rect x="${f(-s / 2)}" y="${f(-s / 2)}" width="${f(s)}" height="${f(s)}" fill="${g}" stroke="${c}" stroke-width="${f(B * 0.1)}"/>${diamond(0, 0, s * 0.34, a)}`;
  }
  if (kind === 'jewel') return diamond(0, 0, s * 0.15, a);
  if (kind === 'rosette') {
    let petals = '';
    for (let i = 0; i < 8; i++) {
      const t = (i * Math.PI) / 4;
      const P = (along, side) => `${f(along * Math.sin(t) + side * Math.cos(t))} ${f(-along * Math.cos(t) + side * Math.sin(t))}`;
      petals += `M${P(s * 0.08, 0)}Q${P(s * 0.24, s * 0.12)} ${P(s * 0.4, 0)}Q${P(s * 0.24, -s * 0.12)} ${P(s * 0.08, 0)}Z`;
    }
    return `<circle r="${f(s * 0.47)}" fill="${g}" stroke="${c}" stroke-width="${f(s * 0.06)}"/><path d="${petals}" fill="${a}" stroke="${c}" stroke-width="${f(s * 0.02)}"/><circle r="${f(s * 0.085)}" fill="${c}"/>`;
  }
  if (kind === 'star') {
    let out = `<circle r="${f(s * 0.3)}" fill="${g}" stroke="${c}" stroke-width="${f(s * 0.045)}"/>`;
    for (const ang of [45, 135, 225, 315]) out += point(s * 0.36, s * 0.085, ang, c, g, s * 0.025);
    for (const ang of [0, 90, 180, 270]) out += point(s * 0.52, s * 0.12, ang, a, g, s * 0.025);
    return `${out}<circle r="${f(s * 0.065)}" fill="${g}" stroke="${c}" stroke-width="${f(s * 0.03)}"/>`;
  }
  if (kind === 'knot') { // two interlaced loops, over and under in turn
    const A = s * 0.46;
    const b = s * 0.19;
    const ribbon = (d) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f(s * 0.13)}"/><path d="${d}" fill="none" stroke="${g}" stroke-width="${f(s * 0.05)}"/>`;
    const ell = (rx, ry) => `M${f(-rx)} 0A${f(rx)} ${f(ry)} 0 1 0 ${f(rx)} 0A${f(rx)} ${f(ry)} 0 1 0 ${f(-rx)} 0Z`;
    const t0 = Math.atan2(A, b); // where the loops cross, on the diagonals
    const arc = (tc) => `M${f(A * Math.cos(tc - 0.42))} ${f(b * Math.sin(tc - 0.42))}A${f(A)} ${f(b)} 0 0 1 ${f(A * Math.cos(tc + 0.42))} ${f(b * Math.sin(tc + 0.42))}`;
    return `<circle r="${f(s * 0.24)}" fill="${g}"/>${ribbon(ell(A, b))}${ribbon(ell(b, A))}${ribbon(arc(t0) + arc(t0 + Math.PI))}<circle r="${f(s * 0.05)}" fill="${a}"/>`;
  }
  return '';
}

/**
 * The parts of a frame around rect {x, y, w, h} (image px), outside it: -> {defs, body, box} where box is the
 * rectangle it covers (rect grown by the gap and the band). id prefixes the pattern ids (unique in the page).
 */
function borderParts(border, rect, id) {
  const type = oneOf(border?.type, BORDER_IDS, 'double');
  const meta = BORDER_TYPES.find((t) => t.id === type);
  const c = hexColor(border?.color, INK);
  const acc = hexColor(border?.accent, '');
  const a = acc || meta.tint || c; // the second color: the style's own is the ink unless it has a tint
  const matKind = oneOf(border?.mat, MAT_IDS, type === 'line' ? 'none' : 'paper');
  let mat = matKind === 'none' ? '' : matKind === 'color' ? hexColor(border?.matColor, PAPER) : PAPER;
  if (meta.paper && !mat) mat = PAPER; // torn and burnt parchment are paper
  const ground = mat || PAPER; // behind ornaments and rope strands
  const corners = borderCorners(border);
  const { B, P } = bandSize(border, rect);
  const T = B + P;
  const { x, y, w } = rect;
  const hh = rect.h;
  const box = { x: x - T, y: y - T, w: w + 2 * T, h: hh + 2 * T };
  const seed = rng(seedOf(`${type}|${Math.round(w)}|${Math.round(hh)}`));

  // o = position across the band: 0 = its inner edge (P from the image), 1 = its outer edge
  const at = (o) => { const d = P + B * o; return [x - d, y - d, w + 2 * d, hh + 2 * d]; };
  const rule = (o, wf, color = c) => rectStroke(...at(o), color, B * wf);
  const ring = mat && !meta.paper ? `<path d="${rectPath(box)}${holePath(rect)}" fill="${mat}" fill-rule="evenodd"/>` : '';
  // each side's own frame: u along it (clockwise), v across the band from the outer edge (0) to the inner (B)
  const sides = [
    [`translate(${f(box.x)} ${f(box.y)})`, box.w, 'h'],
    [`translate(${f(box.x + box.w)} ${f(box.y)}) rotate(90)`, box.h, 'v'],
    [`translate(${f(box.x + box.w)} ${f(box.y + box.h)}) rotate(180)`, box.w, 'h'],
    [`translate(${f(box.x)} ${f(box.y + box.h)}) rotate(270)`, box.h, 'v'],
  ];
  let defs = '';
  /**
   * A motif repeated along each side between the corner squares, a whole number of tiles per side. tile(X, pw) gives
   * one tile's path data per style ({style: d}; X(u) = the x of u in the tile, v runs across the band, 0 to B); a tile
   * may spill into its neighbours (`lead` extra tiles before, one after; each side is clipped to its strip). All tiles
   * of a style make ONE path per side orientation, drawn on both opposite sides with <use>: a dozen elements in all.
   * (Hundreds of elements, or an SVG pattern, made every zoom frame several times slower to draw.)
   */
  const strip = (period, styles, tile, lead = 1) => {
    let out = '';
    for (const [k, len] of [['h', box.w], ['v', box.h]]) {
      const L = Math.max(B, len - 2 * B);
      const n = Math.max(1, Math.round(L / period));
      const pw = L / n;
      const d = {};
      for (let i = -lead; i <= n; i++) {
        const ox = B + i * pw;
        const parts = tile((u) => f(ox + u), pw);
        for (const key of Object.keys(parts)) d[key] = (d[key] || '') + parts[key];
      }
      defs += `<g id="${id}${k}">${Object.keys(styles).map((key) => (d[key] ? `<path d="${d[key]}" ${styles[key]}/>` : '')).join('')}</g>`
        + `<clipPath id="${id}${k}c"><rect x="${f(B)}" y="0" width="${f(L)}" height="${f(B)}"/></clipPath>`;
    }
    for (const [tf, , k] of sides) out += `<use href="#${id}${k}" transform="${tf}" clip-path="url(#${id}${k}c)"/>`;
    return out;
  };
  const ellipse = (X, cx, cy, rx, ry) => `M${X(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
  /** Short lines across the band where each strip ends (they box the corner squares in). */
  const caps = (v0, v1, wf) => sides.map(([tf, len]) => `<path transform="${tf}" d="M${f(B)} ${f(v0)}V${f(v1)}M${f(len - B)} ${f(v0)}V${f(v1)}" stroke="${c}" stroke-width="${f(B * wf)}"/>`).join('');
  /** Corner ornaments, centred cv from the outer edges (both ways), s across. */
  const cornerSvg = (cv = B * 0.5, s = B * 0.96) => {
    if (!ORNAMENTS.has(corners)) return '';
    const inner = ornament(corners, s, B, c, a, ground);
    return sides.map(([tf]) => `<g transform="${tf} translate(${f(cv)} ${f(cv)})">${inner}</g>`).join('');
  };

  let body = '';
  if (type === 'line') {
    body = ring + rule(0.55, 0.42) + cornerSvg();
  } else if (type === 'double') {
    body = ring + rule(0.82, 0.26) + rule(0.32, 0.1, a) + cornerSvg();
  } else if (type === 'checker') {
    const t = B * 0.62; // band of blocks between o = 0.18 and 0.8
    const o0 = 0.18;
    const xi = x - P;
    const yi = y - P;
    const wi = w + 2 * P;
    const hi = hh + 2 * P;
    let blocks = '';
    const side = (len, put) => {
      const n = Math.max(6, Math.round(len / (t * 2.4)));
      const step = len / n;
      for (let i = 0; i < n; i += 2) blocks += put(i * step, step);
    };
    side(wi, (s, st) => `<rect x="${f(xi + s)}" y="${f(yi - B * 0.8)}" width="${f(st)}" height="${f(t)}" fill="${c}"/><rect x="${f(xi + wi - s - st)}" y="${f(yi + hi + B * o0)}" width="${f(st)}" height="${f(t)}" fill="${c}"/>`);
    side(hi, (s, st) => `<rect x="${f(xi - B * 0.8)}" y="${f(yi + hi - s - st)}" width="${f(t)}" height="${f(st)}" fill="${c}"/><rect x="${f(xi + wi + B * o0)}" y="${f(yi + s)}" width="${f(t)}" height="${f(st)}" fill="${c}"/>`);
    if (corners === 'blocks') {
      for (const [cx, cy] of [[xi - B * 0.8, yi - B * 0.8], [xi + wi + B * o0, yi - B * 0.8], [xi - B * 0.8, yi + hi + B * o0], [xi + wi + B * o0, yi + hi + B * o0]]) {
        blocks += `<rect x="${f(cx)}" y="${f(cy)}" width="${f(t)}" height="${f(t)}" fill="${c}"/>`;
      }
    }
    body = ring + (acc ? rule(0.49, 0.62, acc) : '') + blocks + rule(o0, 0.07) + rule(0.8, 0.07) + rule(0.97, 0.06) + cornerSvg();
  } else if (type === 'ornate') {
    const m = P + B * 0.55;
    body = ring + rule(0.86, 0.2) + rule(0.3, 0.09)
      + diamond(x + w / 2, y - m, B * 0.36, a) + diamond(x + w / 2, y + hh + m, B * 0.36, a)
      + diamond(x - m, y + hh / 2, B * 0.36, a) + diamond(x + w + m, y + hh / 2, B * 0.36, a)
      + cornerSvg(B * 0.45, B * 0.92);
  } else if (type === 'ruler') { // degree ticks hanging from the inner rule
    const v1 = B * 0.88;
    body = ring + strip(B * 2.6, { maj: `fill="none" stroke="${a}" stroke-width="${f(B * 0.05)}"`, min: `fill="none" stroke="${a}" stroke-width="${f(B * 0.035)}"` }, (X, pw) => {
      let maj = '';
      let min = '';
      for (let i = 0; i < 10; i++) {
        const tick = `M${X(((i + 0.5) * pw) / 10)} ${f(v1)}V${f(B * (i === 0 ? 0.1 : i === 5 ? 0.46 : 0.66))}`;
        if (i === 0 || i === 5) maj += tick;
        else min += tick;
      }
      return { maj, min };
    }) + rule(0.92, 0.1) + rule(0.12, 0.05) + caps(B * 0.08, v1, 0.05) + cornerSvg();
  } else if (type === 'rope') { // twisted strands: S-shaped divisions, a bump at each strand's ends
    const y0 = B * 0.13;
    const y1 = B * 0.87;
    const hr = y1 - y0;
    const q = hr * 0.72; // how far a division leans
    const pitch = hr * 0.6;
    const bump = hr * 0.09;
    const sw = f(hr * 0.07);
    body = ring + strip(pitch, {
      fill: `fill="${acc || ground}"`,
      line: `fill="none" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round"`,
    }, (X, pw) => {
      // a division bows like a strand's edge (one quadratic: cheap to draw, there are hundreds)
      const div = `q${f(q * 0.15)} ${f(-hr * 0.62)} ${f(q)} ${f(-hr)}`;
      return {
        fill: `M${X(0)} ${f(y1)}${div}q${f(pw / 2)} ${f(-bump)} ${f(pw)} 0q${f(-q * 0.85)} ${f(hr * 0.38)} ${f(-q)} ${f(hr)}q${f(-pw / 2)} ${f(bump)} ${f(-pw)} 0Z`,
        line: `M${X(0)} ${f(y1)}${div}q${f(pw / 2)} ${f(-bump)} ${f(pw)} 0M${X(0)} ${f(y1)}q${f(pw / 2)} ${f(bump)} ${f(pw)} 0`,
      };
    }, Math.ceil(q / pitch) + 1) + cornerSvg();
  } else if (type === 'meander') { // a Greek key: hooks on a base line, two turns each
    const v0 = B * 0.17;
    const ku = (B * 0.66) / 7;
    const Y = (j) => f(v0 + j * ku);
    body = ring + (acc ? rule(0.5, 0.88, acc) : '') + strip(ku * 8, { key: `fill="none" stroke="${c}" stroke-width="${f(ku)}" stroke-linecap="square"` }, (X, pw) => {
      const kx = pw / 8;
      return { key: `M${X(0)} ${Y(6.5)}H${X(pw)}M${X(0.5 * kx)} ${Y(6.5)}V${Y(0.5)}H${X(6.5 * kx)}V${Y(4.5)}H${X(2.5 * kx)}V${Y(2.5)}H${X(4.5 * kx)}` };
    }) + rule(0.94, 0.07) + rule(0.06, 0.05) + caps(B * 0.06, B * 0.94, 0.05) + cornerSvg();
  } else if (type === 'vine') { // a winding stem with a leaf at every bend
    const mid = B * 0.5;
    const k = B * 0.22;
    const crest = mid - k * 0.75;
    const trough = mid + k * 0.75;
    body = ring + strip(B * 2.4, {
      stem: `fill="none" stroke="${c}" stroke-width="${f(B * 0.05)}" stroke-linecap="round"`,
      leaf: `fill="${a}" stroke="${c}" stroke-width="${f(B * 0.018)}"`,
      berry: `fill="${c}"`,
    }, (X, pw) => {
      const leaf = (bu, bv, ang, L, W) => {
        const ux = Math.cos(ang) * L;
        const uy = Math.sin(ang) * L;
        const wx = (-Math.sin(ang) * W) / 2;
        const wy = (Math.cos(ang) * W) / 2;
        return `M${X(bu)} ${f(bv)}q${f(ux / 2 + wx)} ${f(uy / 2 + wy)} ${f(ux)} ${f(uy)}q${f(-ux / 2 - wx)} ${f(-uy / 2 - wy)} ${f(-ux)} ${f(-uy)}Z`;
      };
      return {
        stem: `M${X(0)} ${f(mid)}c${f(pw * 0.18)} ${f(-k)} ${f(pw * 0.32)} ${f(-k)} ${f(pw * 0.5)} 0s${f(pw * 0.32)} ${f(k)} ${f(pw * 0.5)} 0`,
        leaf: leaf(pw * 0.25, crest, -0.85, B * 0.37, B * 0.3) + leaf(pw * 0.75, trough, 0.85, B * 0.37, B * 0.3)
          + leaf(pw * 0.28, crest, 2.45, B * 0.24, B * 0.2) + leaf(pw * 0.78, trough, -2.45, B * 0.24, B * 0.2),
        berry: [[0.5, -0.17], [0.55, -0.24], [0.45, -0.23]].map(([u, v]) => ellipse(X, pw * u, mid + B * v, B * 0.04, B * 0.04)).join(''),
      };
    }) + rule(0.96, 0.04) + rule(0.04, 0.04) + cornerSvg();
  } else if (type === 'beads') { // bead and reel
    const mid = B * 0.5;
    body = ring + strip(B * 0.95, { bead: `fill="${a}"`, reel: `fill="${c}"` }, (X, pw) => ({
      bead: ellipse(X, pw * 0.36, mid, pw * 0.27, B * 0.19),
      reel: ellipse(X, pw * 0.775, mid, pw * 0.045, B * 0.12) + ellipse(X, pw * 0.915, mid, pw * 0.045, B * 0.12),
    })) + rule(0.9, 0.06) + rule(0.1, 0.06) + caps(B * 0.1, B * 0.9, 0.05) + cornerSvg();
  } else if (type === 'scallop') { // festoons hanging from the outer rule, a drop in each
    const top = B * 0.12;
    const r = B * 0.075;
    body = ring + strip(B * 1.15, { arc: `fill="none" stroke="${c}" stroke-width="${f(B * 0.06)}"`, dot: `fill="${c}"`, drop: `fill="${a}"` }, (X, pw) => ({
      arc: `M${X(0)} ${f(top)}c${f(pw * 0.02)} ${f(B * 0.86 - top)} ${f(pw * 0.98)} ${f(B * 0.86 - top)} ${f(pw)} 0`,
      dot: ellipse(X, 0, top, r, r),
      drop: `M${X(pw / 2)} ${f(B * 0.22)}q${f(B * 0.1)} ${f(B * 0.18)} 0 ${f(B * 0.24)}q${f(-B * 0.1)} ${f(-B * 0.06)} 0 ${f(-B * 0.24)}Z`,
    })) + rule(0.9, 0.06) + rule(0.06, 0.04) + cornerSvg();
  } else if (type === 'deco') { // three rules, the inner two stepped in at the corners
    const notched = (o, k) => {
      const d = P + B * o;
      const K = B * k;
      const x0 = x - d;
      const y0 = y - d;
      const x1 = x + w + d;
      const y1 = y + hh + d;
      return `M${f(x0 + K)} ${f(y0)}H${f(x1 - K)}V${f(y0 + K)}H${f(x1)}V${f(y1 - K)}H${f(x1 - K)}V${f(y1)}H${f(x0 + K)}V${f(y1 - K)}H${f(x0)}V${f(y0 + K)}H${f(x0 + K)}Z`;
    };
    body = ring + rule(0.9, 0.14) + `<path d="${notched(0.62, 0.38)}${notched(0.34, 0.24)}" fill="none" stroke="${a}" stroke-width="${f(B * 0.045)}"/>` + cornerSvg(B * 0.465, B * 0.9);
  } else if (type === 'inked') { // two brush lines drawn by hand: they wobble, swell and cross at the corners
    const line = (o, wf, color) => {
      const d = P + B * o;
      const ov = () => B * (0.18 + 0.3 * seed());
      const x0 = x - d;
      const y0 = y - d;
      const x1 = x + w + d;
      const y1 = y + hh + d;
      return `<path d="${brushStroke([x0 - ov(), y0], [x1 + ov(), y0], [0, -1], B * wf, B, seed)}${brushStroke([x1, y0 - ov()], [x1, y1 + ov()], [1, 0], B * wf, B, seed)}`
        + `${brushStroke([x1 + ov(), y1], [x0 - ov(), y1], [0, 1], B * wf, B, seed)}${brushStroke([x0, y1 + ov()], [x0, y0 - ov()], [-1, 0], B * wf, B, seed)}" fill="${color}"/>`;
    };
    body = ring + line(0.72, 0.2, c) + line(0.26, 0.08, a) + cornerSvg();
  } else if (type === 'deckle' || type === 'burnt') { // a sheet with a torn edge, aged or burnt along it
    // Opaque bands, each a torn outline moved inward (blended colors, no transparency): from the edge in, an inked
    // or charred rim, the stain or scorch, then the clean sheet. Every band stays outside the image.
    const burnt = type === 'burnt';
    const edge = ringPoints(box, B * (burnt ? 1.3 : 0.85), B * 0.2);
    const big = noise(seed, edge.len, B * 2.6);
    const small = noise(seed, edge.len, B * 0.7);
    const fine = noise(seed, edge.len, B * 0.45);
    const deep = noise(seed, edge.len, B * 1.6);
    const bite = noise(seed, edge.len, B * 1.1); // now and then a deeper tear or burn
    const tear = edge.pts.map((p) => B * clamp((burnt ? 0.24 : 0.19) + 0.12 * big(p.s) + 0.07 * small(p.s) + (burnt ? 0.045 : 0.06) * fine(p.s)
      + (burnt ? 0.3 : 0.18) * Math.max(0, bite(p.s) - 0.35) ** 2 * 4 + (seed() - 0.5) * (burnt ? 0.06 : 0.08), 0.02, burnt ? 0.66 : 0.52));
    const band = (extra, color) => { let i = 0; return `<path d="${inset(edge, (p) => Math.min(T * 0.97, tear[i++] + extra(p)))}${holePath(rect)}" fill="${color}" fill-rule="evenodd"/>`; };
    body = burnt
      ? band(() => 0, c) + band((p) => B * (0.05 + 0.03 * small(p.s * 1.7)), mix(c, a, 0.55))
        + band((p) => B * (0.13 + 0.06 * deep(p.s + B)), mix(a, mat, 0.3)) + band((p) => B * (0.27 + 0.12 * deep(p.s)), mix(a, mat, 0.68))
        + band((p) => B * (0.42 + 0.14 * deep(p.s + 2 * B)), mat)
      : band(() => 0, mix(a, mat, 0.5)) + band((p) => B * (0.022 + 0.01 * small(p.s * 2)), mix(a, mat, 0.85))
        + band((p) => B * (0.2 + 0.09 * deep(p.s)), mat) + rule(-P / B + 0.04, 0.04);
    body += cornerSvg();
  } else if (type === 'wash') { // thin layers of ink wash with ragged edges, darkest outside, bleeding onto the map
    // The sheet (the mat, if any) and every layer share a soft wavy outer edge (coarse points: it only undulates;
    // repeating it is cheaper to draw than a clip path, which made each frame about 3 ms slower).
    const rim = ringPoints(box, B * 0.6, B * 0.45);
    const r1 = noise(seed, rim.len, B * 2.2);
    const r2 = noise(seed, rim.len, B * 0.9);
    const sheet = inset(rim, (p) => B * (0.08 + 0.06 * r1(p.s) + 0.025 * r2(p.s)));
    const N = 5;
    const reach = T + B * 0.9; // the deepest layer bleeds this far in from the outer edge
    const R = T * 1.3 + B * 1.3; // round enough that the deepest edge never loops
    const edge = ringPoints(box, R, B * 0.3);
    let layers = '';
    for (let i = 0; i < N; i++) {
      const big = noise(seed, edge.len, B * (1.4 + i * 0.45));
      const mid = noise(seed, edge.len, B * 0.6);
      const depth = B * 0.12 + (reach - B * 0.12) * (i / (N - 1)) ** 0.85;
      const inner = inset(edge, (p) => Math.max(B * 0.05, depth + B * (0.2 * big(p.s) + 0.07 * mid(p.s) + (seed() - 0.5) * 0.03)));
      layers += `<path d="${sheet}${inner}" fill="${a}" fill-opacity="0.1" fill-rule="evenodd"/>`
        + (i === 2 || i === 4 ? `<path d="${inner}" fill="none" stroke="${a}" stroke-opacity="0.16" stroke-width="${f(B * 0.02)}" stroke-linejoin="round"/>` : '');
    }
    body = (mat ? `<path d="${sheet}${holePath(rect)}" fill="${mat}" fill-rule="evenodd"/>` : '') + layers + cornerSvg();
  } else {
    body = ring + rule(0.82, 0.26) + rule(0.32, 0.1, a);
  }
  return { defs, body, box };
}

/**
 * A frame drawn around rect {x, y, w, h} (image px), outside it: -> {svg, box: {x, y, w, h}} where box is the
 * rectangle the SVG covers (rect grown by the gap and the band). id prefixes the ids of its patterns.
 */
export function borderSvg(border, rect, { id = 'mb' } = {}) {
  const { defs, body, box } = borderParts(border, rect, id);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)}" preserveAspectRatio="none" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`,
    box,
  };
}

/**
 * A small picture of a frame style for the Design tab (the top-left corner of a little map, in this border's colors):
 * zoom 'side' shows a corner and the start of two sides, 'corner' just the corner (for the corner picker).
 */
export function borderPreviewSvg(type, border = {}, { id = `bp${type}`, corners = null, zoom = 'side' } = {}) {
  const rect = { x: 0, y: 0, w: 300, h: 200 };
  const B = zoom === 'corner' ? 22 : 15;
  const ratio = Math.max(0, num(border.pad)) / (num(border.width) || 1.6);
  const P = Math.min(B * 0.8, B * ratio);
  const b = { ...border, type, show: true, width: (B / 200) * 100, pad: (P / 200) * 100 };
  if (corners) b.corners = corners;
  const { defs, body, box } = borderParts(b, rect, id);
  const view = zoom === 'corner' ? [box.x - 1, box.y - 1, B * 1.2 + 2, B * 1.2 + 2] : [box.x - 4, box.y - 4, 108, 72];
  const land = '<rect width="300" height="200" fill="#a9bab6"/><path d="M34 0C28 14 44 22 38 34S54 50 74 46S98 58 126 52L126 0Z" fill="#d9cba8"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.map(f).join(' ')}" aria-hidden="true" focusable="false">${defs ? `<defs>${defs}</defs>` : ''}`
    + `<rect x="${f(view[0])}" y="${f(view[1])}" width="${f(view[2])}" height="${f(view[3])}" fill="#d6cfbf"/>${land}${body}</svg>`;
}
