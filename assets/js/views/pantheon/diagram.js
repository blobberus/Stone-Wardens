// The pantheon diagram (docs/pantheon-model.md "Diagram"): one SVG drawn from model.js geometry.
//   Original shapes (default): the Material square, Mental hexagon and Temporal square with all 14 aspects; the
//     selection shows as a ring (Absolute God), a line (Major), a triangle (Minor) or a closed outline (Lesser, Angel),
//     every other aspect still in sight. "Major lines" adds the 24 Temporal-Mental lines, assigned ones solid.
//   Individual sigil (optional): the selection alone as an exact dot, line, triangle, rectangle or regular pentagon.
// The same builder draws the screen (colors from CSS custom properties) and the SVG / PNG export (plain colors).
import { GROUPS, NODES, MEANINGS, node, positions, outline, sigilPoints, rankOf, aspectNames, comboId, classify, ordered } from './model.js';

const NS = 'http://www.w3.org/2000/svg';
export const W = 1000;

/** Colors on screen (custom properties from pantheon.css / tokens.css). */
export const SCREEN = {
  bg: null, ink: 'var(--ink)', muted: 'var(--ink-muted)', faint: 'var(--border-strong)', halo: 'var(--surface)',
  material: 'var(--pt-material)', mental: 'var(--pt-mental)', temporal: 'var(--pt-temporal)', select: 'var(--pt-select)',
  font: 'var(--font-ui)', display: 'var(--font-display)',
};
/** Colors in an exported file (the light theme's). */
export const PAPER = {
  bg: '#f6f2e9', ink: '#1f1a14', muted: '#554c40', faint: '#8f826b', halo: '#f6f2e9',
  material: '#925510', mental: '#2c5a8a', temporal: '#72405f', select: '#9c7419',
  font: '"Alegreya Sans", "Segoe UI", system-ui, sans-serif', display: 'Cinzel, "Times New Roman", serif',
};

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const css = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}:${v}`).join(';');
const pts = (list) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const R = { material: 15, mental: 13, temporal: 12 }; // aspect dot radius

/** A label just outside its point, away from `from` (the centre). */
function labelAt(p, from, size, gap) {
  const dx = p.x - from.x, dy = p.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const anchor = ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
  const x = p.x + ux * gap;
  const y = p.y + uy * gap + (uy > 0.35 ? size * 0.75 : uy < -0.35 ? -size * 0.15 : size * 0.33);
  return { x, y, anchor };
}

/**
 * The diagram as an <svg>.
 * o: {view: 'original'|'sigil', selection: [aspect ids], occupants: Map combo id -> being, majorLines: bool,
 *     palette: SCREEN|PAPER, labelSize (viewBox units), caption: line or [lines] (bottom), heading: string, interactive: bool}
 * Points carry data-aspect (and role=button when interactive); Major lines carry data-combo.
 */
export function drawDiagram(o) {
  const P = o.palette || SCREEN;
  const sel = ordered(o.selection || []);
  const c = classify(sel);
  const size = o.labelSize || 24;
  const svg = s('svg', {
    xmlns: NS, viewBox: `0 0 ${W} ${W}`, class: 'pt-svg', role: o.interactive ? 'group' : 'img',
    'aria-label': o.view === 'sigil' ? `Sigil: ${sel.length ? aspectNames(sel) : 'nothing chosen'}` : 'The pantheon diagram: the Material square, the Mental hexagon and the Temporal square',
    'font-family': P.font,
  });
  if (P.bg) svg.append(s('rect', { x: 0, y: 0, width: W, height: W, fill: P.bg }));
  if (o.heading) svg.append(s('text', { x: 40, y: 64, style: css({ fill: P.ink, 'font-family': P.display, 'font-size': '34px', 'letter-spacing': '0.06em' }) }, o.heading));
  if (o.view === 'sigil') drawSigil(svg, sel, c, P, size);
  else drawOriginal(svg, sel, c, o, P, size);
  const lines = [].concat(o.caption || []).filter(Boolean);
  lines.forEach((t, i) => {
    svg.append(s('text', { x: W / 2, y: W - 30 - (lines.length - 1 - i) * 36, 'text-anchor': 'middle', style: css({ fill: i ? P.muted : P.ink, 'font-size': '26px', 'font-weight': i ? 400 : 700 }) }, t));
  });
  return svg;
}

function drawOriginal(svg, sel, c, o, P, size) {
  const pos = positions(W);
  const center = { x: W / 2, y: W / 2 };
  // the three source polygons, lighter than any selection
  for (const g of GROUPS) {
    const ring = g.points.map((p) => pos.get(`${g.id}:${p}`));
    svg.append(s('polygon', { class: `pt-shape pt-shape-${g.id}`, points: pts(ring), style: css({ fill: 'none', stroke: P[g.id], 'stroke-width': 3, 'stroke-opacity': 0.42, 'stroke-linejoin': 'round' }) }));
  }
  // every possible Major God: Temporal to Mental
  if (o.majorLines) {
    const lines = s('g', { class: 'pt-majors' });
    for (const t of NODES.filter((n) => n.group === 'temporal')) {
      for (const m of NODES.filter((n) => n.group === 'mental')) {
        const a = pos.get(t.id), b = pos.get(m.id);
        const id = comboId([t.id, m.id]);
        const who = o.occupants?.get(id);
        const line = s('g', { class: ['pt-major', who ? 'is-assigned' : 'is-open'].join(' '), 'data-combo': id },
          s('title', {}, `Major God: ${t.name} + ${m.name} · ${who ? who.title : 'possible, unassigned'}`),
          s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, style: css({ stroke: who ? P.mental : P.faint, 'stroke-width': who ? 3 : 2, 'stroke-dasharray': who ? null : '7 7', 'stroke-opacity': who ? 0.8 : 0.7 }) }),
          o.interactive ? s('line', { class: 'pt-hit', x1: a.x, y1: a.y, x2: b.x, y2: b.y, style: css({ stroke: 'transparent', 'stroke-width': 16 }) }) : null);
        lines.append(line);
      }
    }
    svg.append(lines);
  }
  // the selection's connections
  if (sel.length) {
    const ps = sel.map((id) => ({ id, ...pos.get(id) }));
    const stroke = c.ok ? P.select : P.muted;
    const dash = c.ok ? null : '10 8';
    const shape = s('g', { class: ['pt-sel', c.ok ? `is-${c.rank}` : 'is-invalid'].join(' ') });
    if (ps.length === 1) {
      shape.append(s('circle', { cx: ps[0].x, cy: ps[0].y, r: 34, style: css({ fill: P.select, 'fill-opacity': c.ok ? 0.16 : 0.06, stroke, 'stroke-width': 4, 'stroke-dasharray': dash }) }));
    } else if (ps.length === 2) {
      shape.append(s('line', { x1: ps[0].x, y1: ps[0].y, x2: ps[1].x, y2: ps[1].y, style: css({ stroke, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': dash }) }));
    } else {
      shape.append(s('polygon', { points: pts(outline(ps)), style: css({ fill: P.select, 'fill-opacity': c.ok ? 0.14 : 0.05, stroke, 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-dasharray': dash }) }));
    }
    svg.append(shape);
  }
  // the 14 aspects, labelled
  for (const n of NODES) {
    const p = pos.get(n.id);
    const on = sel.includes(n.id);
    const r = R[n.group];
    const lab = labelAt(p, center, size, r + (on ? 14 : 9));
    const g = s('g', {
      class: ['pt-node', `pt-${n.group}`, on && 'is-on'].filter(Boolean).join(' '), 'data-aspect': n.id,
      ...(o.interactive ? { role: 'button', tabindex: 0, 'aria-pressed': String(on), 'aria-label': `${n.name}, ${GROUPS.find((x) => x.id === n.group).label} aspect` } : {}),
    },
    s('title', {}, `${n.name} · ${GROUPS.find((x) => x.id === n.group).label}${MEANINGS[n.id] ? `: ${MEANINGS[n.id]}` : ''}`),
    o.interactive ? s('circle', { class: 'pt-hit', cx: p.x, cy: p.y, r: 32, style: css({ fill: 'transparent' }) }) : null,
    on ? s('circle', { cx: p.x, cy: p.y, r: r + 8, style: css({ fill: 'none', stroke: c.ok ? P.select : P.muted, 'stroke-width': 4 }) }) : null,
    s('circle', { class: 'pt-dot', cx: p.x, cy: p.y, r, style: css({ fill: P[n.group], stroke: P.halo, 'stroke-width': 3 }) }),
    s('text', {
      class: 'pt-label', x: lab.x.toFixed(1), y: lab.y.toFixed(1), 'text-anchor': lab.anchor,
      style: css({ fill: P[n.group], 'font-size': `${size}px`, 'font-weight': on ? 700 : 500, stroke: P.halo, 'stroke-width': `${Math.max(4, size / 4)}px`, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }),
    }, n.name));
    svg.append(g);
  }
}

function drawSigil(svg, sel, c, P, size) {
  if (!c.ok) {
    svg.append(s('text', { x: W / 2, y: W / 2, 'text-anchor': 'middle', style: css({ fill: P.muted, 'font-size': '30px' }) },
      sel.length ? 'Not a being yet: see the panel for what it needs.' : 'Choose a being, or pick its points, to draw its sigil.'));
    return;
  }
  const ps = sigilPoints(sel, W);
  const center = { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
  const shape = s('g', { class: `pt-sigil is-${c.rank}` });
  if (ps.length === 1) shape.append(s('circle', { cx: ps[0].x, cy: ps[0].y, r: 70, style: css({ fill: P.select, 'fill-opacity': 0.18, stroke: P.select, 'stroke-width': 6 }) }));
  else if (ps.length === 2) shape.append(s('line', { x1: ps[0].x, y1: ps[0].y, x2: ps[1].x, y2: ps[1].y, style: css({ stroke: P.select, 'stroke-width': 8, 'stroke-linecap': 'round' }) }));
  else shape.append(s('polygon', { points: pts(ps), style: css({ fill: P.select, 'fill-opacity': 0.14, stroke: P.select, 'stroke-width': 6, 'stroke-linejoin': 'round' }) }));
  svg.append(shape);
  const big = Math.round(size * 1.15);
  for (const p of ps) {
    const n = node(p.id);
    const from = ps.length === 1 ? { x: p.x, y: p.y + 1 } : ps.length === 2 ? { x: W / 2, y: p.y } : center;
    const lab = labelAt(p, from, big, ps.length === 1 ? 90 : 30);
    svg.append(s('g', { class: `pt-node pt-${n.group} is-on`, 'data-aspect': p.id },
      s('circle', { cx: p.x, cy: p.y, r: 18, style: css({ fill: P[n.group], stroke: P.halo, 'stroke-width': 4 }) }),
      s('text', { x: lab.x.toFixed(1), y: lab.y.toFixed(1), 'text-anchor': lab.anchor, style: css({ fill: P[n.group], 'font-size': `${big}px`, 'font-weight': 700, stroke: P.halo, 'stroke-width': `${big / 4}px`, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }) }, n.name)));
  }
  svg.append(s('text', { x: W / 2, y: 130, 'text-anchor': 'middle', style: css({ fill: P.ink, 'font-family': P.display, 'font-size': '36px', 'letter-spacing': '0.08em' }) }, rankOf(c.rank).label));
}

/** A small rank symbol (dot, line, triangle, rectangle, pentagon) in currentColor, for lists and badges. */
export function rankGlyph(rank, px = 16) {
  const shape = rankOf(rank)?.symbol;
  const st = 'fill:none;stroke:currentColor;stroke-width:1.75;stroke-linejoin:round;stroke-linecap:round';
  const dot = (x, y) => s('circle', { cx: x, cy: y, r: 1.7, style: 'fill:currentColor' });
  const svg = s('svg', { viewBox: '0 0 20 20', width: px, height: px, class: `pt-glyph pt-glyph-${rank || 'none'}`, 'aria-hidden': 'true' });
  if (shape === 'dot') svg.append(s('circle', { cx: 10, cy: 10, r: 3.6, style: 'fill:currentColor' }));
  else if (shape === 'line') svg.append(s('line', { x1: 4, y1: 15, x2: 16, y2: 5, style: st }), dot(4, 15), dot(16, 5));
  else if (shape === 'triangle') svg.append(s('polygon', { points: '10,3.5 16.5,15.5 3.5,15.5', style: st }));
  else if (shape === 'rectangle') svg.append(s('rect', { x: 2.5, y: 5.5, width: 15, height: 9, rx: 0.5, style: st }));
  else if (shape === 'pentagon') svg.append(s('polygon', { points: '10,2.8 17,7.9 14.3,16.2 5.7,16.2 3,7.9', style: st }));
  else svg.append(s('circle', { cx: 10, cy: 10, r: 6, style: `${st};stroke-dasharray:2 2` }));
  return svg;
}

/** An exported file's text: the diagram (or sigil) in plain colors, with a heading and a caption. */
export function svgText(o) {
  const svg = drawDiagram({ ...o, palette: PAPER, interactive: false, labelSize: 24 });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
}

/** The same drawing as a PNG (px × px). */
export function pngBlob(text, px = 2000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;
      cv.getContext('2d').drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not make the PNG.'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The browser could not draw the diagram.')); };
    img.src = url;
  });
}
