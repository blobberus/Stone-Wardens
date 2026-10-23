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
//   border: {show, type, color, width (percent of the image's short side)},
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
export const BORDER_TYPES = [
  { id: 'line', label: 'Single line' },
  { id: 'double', label: 'Double line' },
  { id: 'checker', label: 'Checkered band' },
  { id: 'ornate', label: 'Ornate corners' },
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
      type: oneOf(r.type, BORDER_IDS, 'double'),
      color: hexColor(r.color, INK),
      width: Math.round(clamp(num(r.width, 1.6), 0.3, 6) * 10) / 10,
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

const rectStroke = (x, y, w, hh, color, sw) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(hh)}" fill="none" stroke="${color}" stroke-width="${f(sw)}"/>`;

/** Thickness of the border band in image px for the visible rectangle. */
export const borderPad = (border, rect) => (border?.show ? Math.max(1, ((border.width || 1.6) / 100) * Math.min(rect.w, rect.h)) : 0);

/**
 * A frame drawn around rect {x, y, w, h} (image px), outside it: -> {svg, box: {x, y, w, h}} where box is the
 * rectangle the SVG covers (rect grown by the band on every side). The band behind the lines is paper (a mat),
 * except for the single line.
 */
export function borderSvg(border, rect) {
  const B = borderPad({ ...border, show: true }, rect);
  const c = hexColor(border.color, INK);
  const { x, y, w } = rect;
  const hh = rect.h;
  const box = { x: x - B, y: y - B, w: w + 2 * B, h: hh + 2 * B };
  // offset o (0 = the image edge, 1 = the outer edge) -> the rectangle at that distance
  const at = (o) => [x - B * o, y - B * o, w + 2 * B * o, hh + 2 * B * o];
  const mat = `<path d="M${f(box.x)} ${f(box.y)}h${f(box.w)}v${f(box.h)}h${f(-box.w)}Z M${f(x)} ${f(y)}v${f(hh)}h${f(w)}v${f(-hh)}Z" fill="${PAPER}" fill-rule="evenodd"/>`;
  let g = '';
  if (border.type === 'line') {
    g = rectStroke(...at(0.55), c, B * 0.42);
  } else if (border.type === 'checker') {
    const t = B * 0.62; // band of blocks between offsets 0.18 and 0.8
    const o0 = 0.18;
    let blocks = '';
    const side = (len, put) => {
      const n = Math.max(6, Math.round(len / (t * 2.4)));
      const step = len / n;
      for (let i = 0; i < n; i += 2) blocks += put(i * step, step);
    };
    side(w, (s, st) => `<rect x="${f(x + s)}" y="${f(y - B * 0.8)}" width="${f(st)}" height="${f(t)}" fill="${c}"/><rect x="${f(x + w - s - st)}" y="${f(y + hh + B * o0)}" width="${f(st)}" height="${f(t)}" fill="${c}"/>`);
    side(hh, (s, st) => `<rect x="${f(x - B * 0.8)}" y="${f(y + hh - s - st)}" width="${f(t)}" height="${f(st)}" fill="${c}"/><rect x="${f(x + w + B * o0)}" y="${f(y + s)}" width="${f(t)}" height="${f(st)}" fill="${c}"/>`);
    for (const [cx, cy] of [[x - B * 0.8, y - B * 0.8], [x + w + B * o0, y - B * 0.8], [x - B * 0.8, y + hh + B * o0], [x + w + B * o0, y + hh + B * o0]]) {
      blocks += `<rect x="${f(cx)}" y="${f(cy)}" width="${f(t)}" height="${f(t)}" fill="${c}"/>`;
    }
    g = mat + blocks + rectStroke(...at(o0), c, B * 0.07) + rectStroke(...at(0.8), c, B * 0.07) + rectStroke(...at(0.97), c, B * 0.06);
  } else if (border.type === 'ornate') {
    g = mat + rectStroke(...at(0.86), c, B * 0.2) + rectStroke(...at(0.3), c, B * 0.09);
    const s = B * 0.92; // corner squares fill the band
    const corner = (cx, cy) => `<rect x="${f(cx - s / 2)}" y="${f(cy - s / 2)}" width="${f(s)}" height="${f(s)}" fill="${PAPER}" stroke="${c}" stroke-width="${f(B * 0.1)}"/>`
      + `<path d="M${f(cx)} ${f(cy - s * 0.34)}L${f(cx + s * 0.34)} ${f(cy)}L${f(cx)} ${f(cy + s * 0.34)}L${f(cx - s * 0.34)} ${f(cy)}Z" fill="${c}"/>`;
    const dia = (cx, cy) => `<path d="M${f(cx)} ${f(cy - B * 0.36)}L${f(cx + B * 0.36)} ${f(cy)}L${f(cx)} ${f(cy + B * 0.36)}L${f(cx - B * 0.36)} ${f(cy)}Z" fill="${c}"/>`;
    const m = B * 0.55;
    g += corner(x - m, y - m) + corner(x + w + m, y - m) + corner(x - m, y + hh + m) + corner(x + w + m, y + hh + m)
      + dia(x + w / 2, y - m) + dia(x + w / 2, y + hh + m) + dia(x - m, y + hh / 2) + dia(x + w + m, y + hh / 2);
  } else { // double
    g = mat + rectStroke(...at(0.82), c, B * 0.26) + rectStroke(...at(0.32), c, B * 0.1);
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)}" preserveAspectRatio="none" aria-hidden="true">${g}</svg>`,
    box,
  };
}
