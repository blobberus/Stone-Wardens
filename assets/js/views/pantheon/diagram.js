// The pantheon diagram (docs/pantheon-model.md "Diagram"): one SVG drawn from model.js geometry.
//   Original shapes (default): the Material square, Mental hexagon and Temporal square with all 14 aspects; the
//     selection shows as a ring (Absolute God), a line (Major), a triangle (Minor) or a closed outline (Lesser, Angel),
//     every other aspect still in sight. "Major lines" adds the 24 Temporal-Mental lines, assigned ones solid.
//   Individual sigil (optional): the selection alone, in tiers (Temporal on top, then Mental, then Material): a dot,
//     a line, a triangle, a diamond (Lesser God) or a pyramid (Angel), inside a seal: beaded rim, the rank on the top
//     arc, the being's title (or its aspects) on the bottom one, each aspect a medallion with its three letters.
// The same builder draws the screen (colors from CSS custom properties) and the SVG / PNG export (plain colors).
import { GROUPS, NODES, MEANINGS, node, positions, outline, sigilPoints, rankOf, aspectNames, comboId, classify, ordered } from './model.js';

const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
export const W = 1000;

/** Colors on screen (custom properties from pantheon.css / tokens.css). */
export const SCREEN = {
  bg: null, ink: 'var(--ink)', muted: 'var(--ink-muted)', faint: 'var(--border-strong)', halo: 'var(--surface)',
  material: 'var(--pt-material)', mental: 'var(--pt-mental)', temporal: 'var(--pt-temporal)', select: 'var(--pt-select)',
  font: 'var(--font-ui)', display: 'var(--font-display)', sigil: 'var(--pt-sigil-font)',
};
/** Colors in an exported file (the light theme's). */
export const PAPER = {
  bg: '#f6f2e9', ink: '#1f1a14', muted: '#554c40', faint: '#8f826b', halo: '#f6f2e9',
  material: '#925510', mental: '#2c5a8a', temporal: '#72405f', select: '#9c7419',
  font: '"Alegreya Sans", "Segoe UI", system-ui, sans-serif', display: 'Cinzel, "Times New Roman", serif',
  sigil: '"Cinzel Decorative", Cinzel, "Times New Roman", serif',
};

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'xlink:href') el.setAttributeNS(XLINK, k, String(v)); // older SVG readers want it beside href
    else el.setAttribute(k, v === true ? '' : String(v));
  }
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
  if (o.view === 'sigil') drawSigil(svg, sel, c, o, P, size);
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

function drawSigil(svg, sel, c, o, P, size) {
  if (!c.ok) {
    svg.append(s('text', { x: W / 2, y: W / 2, 'text-anchor': 'middle', style: css({ fill: P.muted, 'font-size': '30px' }) },
      sel.length ? 'Not a being yet: see the panel for what it needs.' : 'Choose a being, or pick its points, to draw its sigil.'));
    return;
  }
  const C = W / 2;
  const gold = P.select;
  const fs = Math.round(Math.max(26, size * 1.1)); // the aspects' letters, bigger in the drawing's units as it shrinks
  const mr = Math.round(fs * 1.65); // their medallions
  const lfs = Math.round(Math.max(24, size * 0.95)); // the legends on the ring
  const r = Math.min(262, SEAL.in - 12 - mr); // the circle the tips lie on, medallions clear of the ring
  const ps = sigilPoints(sel, W, r);
  const n = ps.length;
  const who = o.occupants?.get(c.id);
  const ring = (rad, width) => s('circle', { cx: C, cy: C, r: rad, style: css({ fill: 'none', stroke: gold, 'stroke-width': width }) });
  // legend arcs: over the top left to right (letters stand outwards), under the bottom left to right (inwards)
  const arc = (rad, top) => `M ${C - rad} ${C} A ${rad} ${rad} 0 0 ${top ? 1 : 0} ${C + rad} ${C}`;
  const topR = SEAL.band - lfs * 0.35, bottomR = SEAL.band + lfs * 0.35;
  svg.append(s('defs', {},
    s('radialGradient', { id: 'pt-sigil-glow' },
      s('stop', { offset: '0%', style: css({ 'stop-color': gold, 'stop-opacity': 0.24 }) }),
      s('stop', { offset: '65%', style: css({ 'stop-color': gold, 'stop-opacity': 0.07 }) }),
      s('stop', { offset: '100%', style: css({ 'stop-color': gold, 'stop-opacity': 0 }) })),
    s('path', { id: 'pt-sigil-top', d: arc(topR, true) }),
    s('path', { id: 'pt-sigil-bottom', d: arc(bottomR, false) })));
  // the seal: a beaded rim, the legend band between two double rings, a lozenge at each side, ticks inside
  const seal = s('g', { class: 'pt-seal' },
    s('circle', { cx: C, cy: C, r: SEAL.in, style: css({ fill: 'url(#pt-sigil-glow)' }) }),
    ring(SEAL.out, 3), ring(SEAL.out - 6, 1.2), ring(SEAL.in + 6, 1.2), ring(SEAL.in, 3));
  for (let i = 0; i < 90; i++) {
    const a = (i * 4 * Math.PI) / 180;
    seal.append(s('circle', { cx: (C + SEAL.beads * Math.cos(a)).toFixed(1), cy: (C + SEAL.beads * Math.sin(a)).toFixed(1), r: 2.6, style: css({ fill: gold }) }));
  }
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const r0 = SEAL.in - (i % 3 ? 7 : 12);
    seal.append(s('line', {
      x1: (C + r0 * Math.cos(a)).toFixed(1), y1: (C + r0 * Math.sin(a)).toFixed(1),
      x2: (C + (SEAL.in - 2) * Math.cos(a)).toFixed(1), y2: (C + (SEAL.in - 2) * Math.sin(a)).toFixed(1),
      style: css({ stroke: gold, 'stroke-width': i % 3 ? 1 : 1.8, 'stroke-opacity': 0.75 }),
    }));
  }
  for (const x of [C - SEAL.band, C + SEAL.band]) {
    seal.append(s('polygon', { points: `${x},${C - 15} ${x + 7},${C} ${x},${C + 15} ${x - 7},${C}`, style: css({ fill: gold }) }),
      s('circle', { cx: x, cy: C - 25, r: 3, style: css({ fill: gold }) }), s('circle', { cx: x, cy: C + 25, r: 3, style: css({ fill: gold }) }));
  }
  svg.append(seal,
    legend('pt-sigil-top', rankOf(c.rank).label, topR, lfs, P),
    legend('pt-sigil-bottom', who?.title || aspectNames(c.aspects, ' · '), bottomR, lfs, P));
  // the shape: gilt edges with a fine line inlaid, on the circle of the tips. An Absolute God is a sun; a Major God's
  // line runs through a mandorla in a glory of rays, a Minor God's triangle sheds rays from its sides, each with a
  // star at its heart; the Mental tier crosses a diamond or a pyramid (the Minor God's triangle stands on it).
  const art = s('g', { class: `pt-sigil is-${c.rank}` });
  const big = Math.round(mr * 1.6); // an Absolute God's one medallion
  const at = (rad, a) => `${(C + rad * Math.cos(a)).toFixed(1)},${(C + rad * Math.sin(a)).toFixed(1)}`;
  const join = { 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  /** Tapering rays round the centre, from just outside base(angle) out to `long`; every other one shorter, fainter. */
  const rays = (count, base, long, wide, narrow) => {
    for (let i = 0; i < count; i++) {
      const a = (((i * 360) / count - 90) * Math.PI) / 180;
      const b = base(a) + 3;
      const tip = i % 2 ? b + (long - b) * 0.62 : long;
      if (tip - b < 16) continue; // behind a medallion
      const half = (i % 2 ? narrow : wide) / b;
      art.append(s('polygon', { points: [at(b, a - half), at(tip, a), at(b, a + half)].join(' '), style: css({ fill: gold, 'fill-opacity': i % 2 ? 0.45 : 0.8 }) }));
    }
  };
  /** A compass star (four long points, four short) in a gilt roundel at the centre. */
  const star = (R) => {
    const p = [];
    for (let i = 0; i < 16; i++) p.push(at(i % 2 ? R * 0.36 : i % 4 ? R * 0.66 : R, ((i * 22.5 - 90) * Math.PI) / 180));
    art.append(s('circle', { cx: C, cy: C, r: R * 1.4, style: css({ fill: P.halo, stroke: gold, 'stroke-width': 2.5 }) }),
      s('circle', { cx: C, cy: C, r: R * 1.4 - 5, style: css({ fill: gold, 'fill-opacity': 0.12, stroke: gold, 'stroke-width': 1, 'stroke-opacity': 0.7 }) }),
      s('polygon', { points: p.join(' '), style: css({ fill: gold, stroke: P.halo, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }) }));
  };
  if (n === 1) rays(24, () => big + 7, SEAL.in - 14, 6.5, 4);
  else {
    art.append(s('circle', { cx: C, cy: C, r, style: css({ fill: 'none', stroke: gold, 'stroke-width': 1.5, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round', 'stroke-opacity': 0.8 }) }));
    if (n === 2) {
      // the mandorla: two arcs from tip to tip, w either side of the line at its middle (circles of radius R, d off centre)
      const w = 0.46 * r;
      const R = (r * r + w * w) / (2 * w), d = R - w;
      const mandorla = (half) => {
        const q = ((r * r + half * half) / (2 * half)).toFixed(1);
        return `M ${C} ${C - r} A ${q} ${q} 0 0 1 ${C} ${C + r} A ${q} ${q} 0 0 1 ${C} ${C - r} Z`;
      };
      rays(40, (a) => Math.sqrt(R * R - d * d * Math.sin(a) ** 2) - d * Math.abs(Math.cos(a)), 0.97 * r, 5.5, 3.5);
      art.append(s('path', { d: mandorla(w), style: css({ fill: P.halo }) }),
        s('path', { d: mandorla(w), style: css({ fill: gold, 'fill-opacity': 0.14, stroke: gold, 'stroke-width': 5, ...join }) }),
        s('path', { d: mandorla(0.32 * r), style: css({ fill: 'none', stroke: gold, 'stroke-width': 1.5, 'stroke-opacity': 0.8 }) }));
    }
    if (n === 3) {
      // the triangle's sides are r / 2 from the centre, facing down, upper left and upper right
      const normals = [90, -30, 210].map((x) => (x * Math.PI) / 180);
      rays(36, (a) => r / 2 / Math.max(...normals.map((m) => Math.cos(a - m))), 0.97 * r, 6, 4);
      art.append(s('polygon', { points: pts(ps), style: css({ fill: P.halo }) }));
    }
    const [tag, line] = n === 2 ? ['line', { x1: ps[0].x, y1: ps[0].y, x2: ps[1].x, y2: ps[1].y }] : ['polygon', { points: pts(outline(ps)) }];
    art.append(s(tag, { ...line, style: css({ fill: n > 2 ? gold : null, 'fill-opacity': n > 2 ? 0.12 : null, stroke: gold, 'stroke-width': 11, ...join }) }),
      s(tag, { ...line, style: css({ fill: 'none', stroke: P.halo, 'stroke-width': 3, ...join }) }));
    if (n === 3) art.append(s('polygon', { points: pts(ps.map((p) => ({ x: C + (p.x - C) * 0.56, y: C + (p.y - C) * 0.56 }))), style: css({ fill: 'none', stroke: gold, 'stroke-width': 1.6, 'stroke-opacity': 0.85, ...join }) }));
    if (n <= 3) star(0.13 * r);
    if (n >= 4) art.append(s('line', { x1: ps[1].x, y1: ps[1].y, x2: ps[2].x, y2: ps[2].y, style: css({ stroke: gold, 'stroke-width': 4, 'stroke-linecap': 'round' }) }));
  }
  svg.append(art);
  // each aspect a medallion with its three letters
  for (const p of ps) {
    const nd = node(p.id);
    const col = P[nd.group];
    const rad = n === 1 ? big : mr;
    const f = n === 1 ? Math.round(fs * 1.55) : fs;
    svg.append(s('g', { class: `pt-node pt-${nd.group} is-on`, 'data-aspect': p.id },
      s('title', {}, `${nd.name} · ${GROUPS.find((x) => x.id === nd.group).label}`),
      s('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rad + 7, style: css({ fill: P.halo, stroke: gold, 'stroke-width': 1.5 }) }),
      s('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rad, style: css({ fill: col, 'fill-opacity': 0.1, stroke: col, 'stroke-width': 4.5 }) }),
      s('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rad - 7, style: css({ fill: 'none', stroke: col, 'stroke-width': 1.2, 'stroke-opacity': 0.6 }) }),
      s('text', { x: p.x.toFixed(1), y: (p.y + f * 0.35).toFixed(1), 'text-anchor': 'middle', style: css({ fill: col, 'font-family': P.sigil, 'font-size': `${f}px`, 'font-weight': 700 }) }, abbr3(nd))));
  }
}

// The seal round a sigil (radii on the drawing, from its centre): beads, the outer double ring, the legend band's
// middle, the inner double ring.
const SEAL = { beads: 386, out: 374, band: 346, in: 318 };
/** Three letters in Cinzel Decorative: its capital is the ornamented one, its small letters plain capitals ("Str"). */
const abbr3 = (n) => n.abbr[0] + n.abbr.slice(1).toLowerCase();

/** A legend in capitals along one of the seal's arcs, squeezed when it would run past the side lozenges. */
function legend(id, text, rad, fs, P) {
  let t = String(text).toUpperCase();
  if (t.length > 60) t = `${t.slice(0, 58).trim()}…`;
  const room = rad * 2.2; // about 126° of the arc
  const tight = t.length * fs * 0.86 > room; // Cinzel's capitals with the letter spacing, about 0.86 em each
  return s('text', { 'text-anchor': 'middle', style: css({ fill: P.ink, 'font-family': P.display, 'font-size': `${fs}px`, 'font-weight': 700, 'letter-spacing': '0.12em' }) },
    s('textPath', { href: `#${id}`, 'xlink:href': `#${id}`, startOffset: '50%', ...(tight ? { textLength: Math.round(room), lengthAdjust: 'spacingAndGlyphs' } : {}) }, t));
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

/** An exported file's text: the diagram (or sigil) in plain colors, with a heading, a caption and its fonts. */
export async function svgText(o) {
  const svg = drawDiagram({ ...o, palette: PAPER, interactive: false, labelSize: 24 });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${await withFonts(new XMLSerializer().serializeToString(svg), svg.textContent)}\n`;
}

// The page's web fonts, put inside an exported file (an SVG opened elsewhere, or drawn into the PNG, can't load
// them): only the letters it uses, from Google Fonts as on the page. Without a connection the file just names them.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@400;500;700&family=Cinzel:wght@400;700&family=Cinzel+Decorative:wght@700';
async function withFonts(text, letters) {
  try {
    const opts = { signal: AbortSignal.timeout?.(10000) };
    const used = [...new Set(`${letters} `.replace(/\s+/g, ' '))].join('');
    const res = await fetch(`${FONT_CSS}&text=${encodeURIComponent(used)}`, opts);
    if (!res.ok) return text;
    let sheet = await res.text();
    for (const url of new Set(sheet.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])) {
      const blob = await (await fetch(url, opts)).blob();
      const data = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      sheet = sheet.split(url).join(data);
    }
    return text.replace(/^<svg\b[^>]*>/, (open) => `${open}<style><![CDATA[\n${sheet}]]></style>`);
  } catch {
    return text;
  }
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
