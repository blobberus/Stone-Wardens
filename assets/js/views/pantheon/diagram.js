// The pantheon diagram (docs/pantheon-model.md "Diagram"): one SVG drawn from model.js geometry.
//   Original shapes (default): a magic circle. The Material square, Mental hexagon and Temporal square are carved
//     bands inscribed in runes, inside a great circle through the Material corners, a gilt star at the heart; each of
//     the 14 aspects is a medallion with its rune (Futhark for Temporal and Mental, the alchemists' signs for
//     Material). The selection shows in gold as a radiant ring (Absolute God), a line (Major), a triangle (Minor) or a
//     closed outline (Lesser, Angel), every other aspect still in sight. "Major lines" adds the 24 Temporal-Mental
//     lines, assigned ones solid.
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
const R = { material: 18, mental: 16, temporal: 15 }; // aspect medallion radius

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
  const lines = [].concat(o.caption || []).filter(Boolean);
  if (o.view === 'sigil') drawSigil(svg, sel, c, o, P, size);
  else drawOriginal(lines.length ? svg.appendChild(s('g', { transform: 'translate(50 8) scale(0.9)' })) : svg, sel, c, o, P, size); // the great circle clear of a caption
  lines.forEach((t, i) => {
    svg.append(s('text', { x: W / 2, y: W - 30 - (lines.length - 1 - i) * 36, 'text-anchor': 'middle', style: css({ fill: i ? P.muted : P.ink, 'font-size': '26px', 'font-weight': i ? 400 : 700 }) }, t));
  });
  return svg;
}

function drawOriginal(svg, sel, c, o, P, size) {
  const pos = positions(W);
  const center = { x: W / 2, y: W / 2 };
  const C = W / 2;
  const gold = P.select;
  const round = { 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  const d = decoration();
  // the magic circle, lighter than any selection: a glow from the heart, the circles the inner shapes stand in, the
  // stave at the heart, the great circle (beads, double ring, inscription, a lozenge at each quarter)
  svg.append(s('defs', {},
    s('radialGradient', { id: 'pt-circle-glow' },
      s('stop', { offset: '0%', style: css({ 'stop-color': gold, 'stop-opacity': 0.2 }) }),
      s('stop', { offset: '55%', style: css({ 'stop-color': gold, 'stop-opacity': 0.06 }) }),
      s('stop', { offset: '100%', style: css({ 'stop-color': gold, 'stop-opacity': 0 }) }))));
  const deco = s('g', { class: 'pt-deco' },
    s('circle', { cx: C, cy: C, r: GREAT, style: css({ fill: 'url(#pt-circle-glow)' }) }),
    ...GROUPS.slice(1).map((g) => s('circle', { cx: C, cy: C, r: g.radius * W, style: css({ fill: 'none', stroke: gold, 'stroke-width': 1.4, 'stroke-dasharray': '1.5 6', 'stroke-opacity': 0.6, ...round }) })),
    s('path', { d: d.stave, style: css({ fill: 'none', stroke: gold, 'stroke-width': 2.4, 'stroke-opacity': 0.85, ...round }) }),
    s('circle', { cx: C, cy: C, r: 24, style: css({ fill: P.halo, stroke: gold, 'stroke-width': 2.2 }) }),
    s('circle', { cx: C, cy: C, r: 19, style: css({ fill: gold, 'fill-opacity': 0.1, stroke: gold, 'stroke-width': 1, 'stroke-opacity': 0.7 }) }),
    s('path', { d: d.spark, style: css({ fill: gold }) }),
    s('path', { d: d.beads, style: css({ fill: 'none', stroke: gold, 'stroke-width': 3.2, 'stroke-opacity': 0.7, ...round }) }),
    ...[GREAT - 9, GREAT + 9].map((r, i) => s('circle', { cx: C, cy: C, r, style: css({ fill: 'none', stroke: gold, 'stroke-width': i ? 2.2 : 1.3, 'stroke-opacity': 0.8 }) })),
    s('path', { d: d.great, style: css({ fill: 'none', stroke: gold, 'stroke-width': 1.2, 'stroke-opacity': 0.75, ...round }) }),
    s('path', { d: d.lozenges, style: css({ fill: gold, 'fill-opacity': 0.85 }) }));
  svg.append(deco);
  // the three shapes: carved bands, two lines with runes between, the aspects' medallions at the corners
  for (const g of GROUPS) {
    const b = d.bands[g.id];
    svg.append(s('g', { class: `pt-shape pt-shape-${g.id}` },
      s('path', { d: `M${pts(b.outer)}Z M${pts(b.inner)}Z`, 'fill-rule': 'evenodd', style: css({ fill: P[g.id], 'fill-opacity': 0.07, stroke: 'none' }) }),
      s('polygon', { points: pts(b.outer), style: css({ fill: 'none', stroke: P[g.id], 'stroke-width': 2.4, 'stroke-opacity': 0.7, 'stroke-linejoin': 'round' }) }),
      s('polygon', { points: pts(b.inner), style: css({ fill: 'none', stroke: P[g.id], 'stroke-width': 1.2, 'stroke-opacity': 0.6, 'stroke-linejoin': 'round' }) }),
      s('path', { d: b.runes, style: css({ fill: 'none', stroke: P[g.id], 'stroke-width': b.h * 0.12, 'stroke-opacity': 0.75, ...round }) }),
      s('path', { d: b.marks, style: css({ fill: P.halo, stroke: P[g.id], 'stroke-width': 1.6, 'stroke-linejoin': 'round' }) })));
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
  // the selection's connections: gilt (a glow, the gold, a fine line inlaid), dashed grey when not a being
  if (sel.length) {
    const ps = sel.map((id) => ({ id, ...pos.get(id) }));
    const stroke = c.ok ? gold : P.muted;
    const dash = c.ok ? null : '10 8';
    const shape = s('g', { class: ['pt-sel', c.ok ? `is-${c.rank}` : 'is-invalid'].join(' ') });
    const gilt = (tag, at, fill) => [
      c.ok ? s(tag, { ...at, style: css({ fill: 'none', stroke: gold, 'stroke-width': 18, 'stroke-opacity': 0.18, ...round }) }) : null,
      s(tag, { ...at, style: css({ fill: fill ? gold : 'none', 'fill-opacity': c.ok ? 0.13 : 0.05, stroke, 'stroke-width': 7, 'stroke-dasharray': dash, ...round }) }),
      c.ok ? s(tag, { ...at, style: css({ fill: 'none', stroke: P.halo, 'stroke-width': 1.8, ...round }) }) : null,
    ];
    if (ps.length === 1) {
      const { x, y } = ps[0];
      shape.append(...gilt('circle', { cx: x, cy: y, r: 36 }, true));
      if (c.ok) shape.append(s('path', { d: d.rays(x, y), style: css({ fill: 'none', stroke: gold, 'stroke-width': 3, ...round }) }));
    } else if (ps.length === 2) {
      shape.append(...gilt('line', { x1: ps[0].x, y1: ps[0].y, x2: ps[1].x, y2: ps[1].y }));
    } else {
      shape.append(...gilt('polygon', { points: pts(outline(ps)) }, true));
    }
    svg.append(shape);
  }
  // the 14 aspects: medallions with their runes, labelled; a picked one turns to its pigment in a gold ring
  for (const n of NODES) {
    const p = pos.get(n.id);
    const on = sel.includes(n.id);
    const r = R[n.group];
    const col = P[n.group];
    const lab = labelAt(p, center, size, r + (on ? 16 : 11));
    const g = s('g', {
      class: ['pt-node', `pt-${n.group}`, on && 'is-on'].filter(Boolean).join(' '), 'data-aspect': n.id,
      ...(o.interactive ? { role: 'button', tabindex: 0, 'aria-pressed': String(on), 'aria-label': `${n.name}, ${GROUPS.find((x) => x.id === n.group).label} aspect` } : {}),
    },
    s('title', {}, `${n.name} · ${GROUPS.find((x) => x.id === n.group).label}${MEANINGS[n.id] ? `: ${MEANINGS[n.id]}` : ''}`),
    o.interactive ? s('circle', { class: 'pt-hit', cx: p.x, cy: p.y, r: 32, style: css({ fill: 'transparent' }) }) : null,
    on ? s('circle', { cx: p.x, cy: p.y, r: r + 8, style: css({ fill: P.halo, stroke: c.ok ? gold : P.muted, 'stroke-width': 4 }) })
      : s('circle', { cx: p.x, cy: p.y, r: r + 5, style: css({ fill: P.halo, stroke: col, 'stroke-width': 1.2, 'stroke-opacity': 0.6 }) }),
    s('circle', { class: 'pt-dot', cx: p.x, cy: p.y, r, style: css({ fill: on ? col : P.halo, stroke: col, 'stroke-width': 3 }) }),
    s('path', { class: 'pt-rune', d: runePath(ASPECT_RUNES[n.id], p.x, p.y, r * 1.08), style: css({ fill: 'none', stroke: on ? P.halo : col, 'stroke-width': 2.6, ...round }) }),
    s('text', {
      class: 'pt-label', x: lab.x.toFixed(1), y: lab.y.toFixed(1), 'text-anchor': lab.anchor,
      style: css({ fill: P[n.group], 'font-size': `${size}px`, 'font-weight': on ? 700 : 500, stroke: P.halo, 'stroke-width': `${Math.max(4, size / 4)}px`, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }),
    }, n.name));
    svg.append(g);
  }
}

// ---------- the magic circle ----------

const GREAT = GROUPS[0].radius * W; // the great circle, through the Material corners

// Runes drawn as strokes, so an export needs no font: a cell one unit high (y from -0.5, the top, to 0.5). The
// Temporal and Mental aspects carry Elder Futhark runes for what they mean (Hagalaz the hail for Decay, Berkano the
// birch for Growth, Isa the ice for Stasis, Dagaz the day for Equilibrium; Uruz the aurochs for Strength, Raidho the
// ride for Dexterity, Eihwaz the yew for Constitution, Ansuz the god for Wisdom, Sowilo the sun for Intelligence,
// Wunjo joy for Charisma), the Material ones the alchemists' signs (Fire and Air rise, Water and Metal (earth's
// sign) fall). The bands are inscribed in the Futhark, English spelled letter by letter (runesOf).
const FUTHARK = {
  f: [[[-0.2, 0.5], [-0.2, -0.5]], [[-0.2, -0.18], [0.2, -0.5]], [[-0.2, 0.12], [0.2, -0.2]]],
  u: [[[-0.22, 0.5], [-0.22, -0.5], [0.22, -0.15], [0.22, 0.5]]],
  'þ': [[[-0.2, -0.5], [-0.2, 0.5]], [[-0.2, -0.25], [0.18, 0], [-0.2, 0.25]]],
  a: [[[-0.2, 0.5], [-0.2, -0.5]], [[-0.2, -0.5], [0.2, -0.2]], [[-0.2, -0.2], [0.2, 0.1]]],
  r: [[[-0.22, 0.5], [-0.22, -0.5], [0.2, -0.25], [-0.22, 0], [0.22, 0.5]]],
  k: [[[0.2, -0.45], [-0.2, 0], [0.2, 0.45]]],
  g: [[[-0.25, -0.5], [0.25, 0.5]], [[0.25, -0.5], [-0.25, 0.5]]],
  w: [[[-0.2, 0.5], [-0.2, -0.5], [0.2, -0.25], [-0.2, 0]]],
  h: [[[-0.22, -0.5], [-0.22, 0.5]], [[0.22, -0.5], [0.22, 0.5]], [[-0.22, -0.15], [0.22, 0.15]]],
  n: [[[0, -0.5], [0, 0.5]], [[-0.2, -0.15], [0.2, 0.15]]],
  i: [[[0, -0.5], [0, 0.5]]],
  j: [[[-0.02, -0.45], [-0.24, -0.2], [-0.02, 0.05]], [[0.02, -0.05], [0.24, 0.2], [0.02, 0.45]]],
  'ï': [[[0, -0.5], [0, 0.5]], [[0, -0.5], [0.2, -0.3]], [[0, 0.5], [-0.2, 0.3]]],
  p: [[[-0.2, -0.5], [-0.2, 0.5]], [[-0.2, -0.5], [0.12, -0.22], [0.24, -0.45]], [[-0.2, 0.5], [0.12, 0.22], [0.24, 0.45]]],
  z: [[[0, -0.5], [0, 0.5]], [[-0.24, -0.5], [0, -0.15], [0.24, -0.5]]],
  s: [[[0.2, -0.5], [-0.2, -0.1], [0.2, 0.1], [-0.2, 0.5]]],
  t: [[[0, -0.5], [0, 0.5]], [[-0.24, -0.25], [0, -0.5], [0.24, -0.25]]],
  b: [[[-0.22, -0.5], [-0.22, 0.5]], [[-0.22, -0.5], [0.18, -0.25], [-0.22, 0], [0.18, 0.25], [-0.22, 0.5]]],
  e: [[[-0.22, 0.5], [-0.22, -0.5], [0, -0.2], [0.22, -0.5], [0.22, 0.5]]],
  m: [[[-0.22, 0.5], [-0.22, -0.5], [0.22, -0.1]], [[0.22, 0.5], [0.22, -0.5], [-0.22, -0.1]]],
  l: [[[-0.15, 0.5], [-0.15, -0.5], [0.2, -0.2]]],
  'ŋ': [[[0, -0.3], [0.22, 0], [0, 0.3], [-0.22, 0], [0, -0.3]]],
  o: [[[-0.25, 0.5], [0.2, -0.05], [0, -0.45], [-0.2, -0.05], [0.25, 0.5]]],
  d: [[[-0.24, -0.45], [-0.24, 0.45], [0.24, -0.45], [0.24, 0.45], [-0.24, -0.45]]],
};
const RISE = [[0, -0.48], [0.42, 0.26], [-0.42, 0.26], [0, -0.48]];
const FALL = RISE.map(([x, y]) => [x, -y]);
const ASPECT_RUNES = {
  'temporal:decay': FUTHARK.h, 'temporal:growth': FUTHARK.b, 'temporal:stasis': FUTHARK.i, 'temporal:equilibrium': FUTHARK.d,
  'mental:strength': FUTHARK.u, 'mental:dexterity': FUTHARK.r, 'mental:constitution': FUTHARK['ï'],
  'mental:wisdom': FUTHARK.a, 'mental:intelligence': FUTHARK.s, 'mental:charisma': FUTHARK.w,
  'material:fire': [RISE], 'material:air': [RISE, [[-0.34, -0.04], [0.34, -0.04]]],
  'material:water': [FALL], 'material:metal': [FALL, [[-0.34, 0.04], [0.34, 0.04]]],
};
const MARK = (y) => [[0, y - 0.07], [0.07, y], [0, y + 0.07], [-0.07, y], [0, y - 0.07]];
const SPACE = { strokes: [MARK(0)], adv: 0.45 }; // between words
const STOP = { strokes: [MARK(-0.22), MARK(0.22)], adv: 0.5 }; // between phrases
const INSCRIPTIONS = {
  great: 'the stone wardens·the pantheon of the fallen firmament·',
  material: 'metal water fire air·the material forces of nature·',
  mental: 'strength dexterity constitution wisdom intelligence charisma·the forces of the mind·',
  temporal: 'decay growth stasis equilibrium·the divine forces of time·',
};

/** The strokes of a rune at (x, y), h high, as path data; t: the way its line runs, n: its top (unit vectors). */
function runePath(strokes, x, y, h, t = { x: 1, y: 0 }, n = { x: 0, y: -1 }) {
  return strokes.map((line) => line.map(([gx, gy], i) => `${i ? 'L' : 'M'}${(x + h * (gx * t.x - gy * n.x)).toFixed(1)} ${(y + h * (gx * t.y - gy * n.y)).toFixed(1)}`).join('')).join('');
}

/** English in the Futhark: [{strokes, adv (width in heights)}]. th = þ, ng = ŋ, c / q = k, v = w, x = ks, y = j. */
function runesOf(text) {
  const t = text.toLowerCase().replace(/th/g, 'þ').replace(/ng/g, 'ŋ').replace(/[cq]/g, 'k').replace(/v/g, 'w').replace(/x/g, 'ks').replace(/y/g, 'j');
  return [...t].map((ch) => (FUTHARK[ch] ? { strokes: FUTHARK[ch], adv: ch === 'i' ? 0.3 : 0.6 } : ch === '·' ? STOP : ch === ' ' ? SPACE : null)).filter(Boolean);
}

/**
 * Glyphs written along tracks [{len, at(distance) -> {x, y, t, n}}], h high, the text running on from one track to
 * the next and round again; each track's run centred on it. One path.
 */
function inscribe(tracks, glyphs, h) {
  const step = (g) => (g.adv + 0.22) * h;
  let k = 0, out = '';
  for (const tr of tracks) {
    let used = 0, j = k;
    while (used + step(glyphs[j % glyphs.length]) <= tr.len) used += step(glyphs[j++ % glyphs.length]);
    let pos = (tr.len - used) / 2;
    for (; k < j; k++) {
      const g = glyphs[k % glyphs.length];
      const p = tr.at(pos + step(g) / 2);
      out += runePath(g.strokes, p.x, p.y, h, p.t, p.n);
      pos += step(g);
    }
  }
  return out;
}

let DECO = null;
/** The magic circle's fixed strokes as path data, worked out once: the bands and their runes, beads, star, lozenges. */
function decoration() {
  if (DECO) return DECO;
  const C = W / 2;
  const rad = (deg) => (deg * Math.PI) / 180;
  const at = (r, a) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
  const xy = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const lineTrack = (a, b, skipA, skipB) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { len: len - skipA - skipB, at: (d) => ({ x: a.x + t.x * (skipA + d), y: a.y + t.y * (skipA + d), t, n: { x: t.y, y: -t.x } }) };
  };
  /** A lozenge across a band at p (t: along the band), `across` from its middle to a tip. */
  const lozenge = (p, t, across, along) => {
    const q = (u, v) => xy({ x: p.x + t.x * u + t.y * v, y: p.y + t.y * u - t.x * v });
    return `M${q(0, across)}L${q(along, 0)}L${q(0, -across)}L${q(-along, 0)}Z`;
  };
  const arcTrack = (r, a0, a1) => ({
    len: r * (a1 - a0),
    at: (d) => { const a = a0 + d / r; return { ...at(r, a), t: { x: -Math.sin(a), y: Math.cos(a) }, n: { x: Math.cos(a), y: Math.sin(a) } }; },
  });
  // the shapes' bands straddle their outlines, a lozenge at the middle of each side; the runes stop short of the
  // medallions and the lozenges
  const HALF = { material: 9, mental: 8, temporal: 7 };
  const bands = {};
  for (const g of GROUPS) {
    const n = g.points.length, R0 = g.radius * W, k = HALF[g.id] / Math.cos(Math.PI / n);
    const ring = (r) => g.points.map((_, i) => at(r, rad(g.rotation + (i * 360) / n)));
    const mid = ring(R0);
    const h = HALF[g.id] * 1.15;
    const tracks = [];
    let marks = '';
    mid.forEach((a, i) => {
      const b = mid[(i + 1) % n], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      tracks.push(lineTrack(a, m, R[g.id] + 9, 10), lineTrack(m, b, 10, R[g.id] + 9));
      marks += lozenge(m, tracks.at(-1).at(0).t, HALF[g.id] + 6, 5.5);
    });
    bands[g.id] = { outer: ring(R0 + k), inner: ring(R0 - k), h, marks, runes: inscribe(tracks, runesOf(INSCRIPTIONS[g.id]), h) };
  }
  // the great circle's inscription, broken by the Material medallions on its corners and a lozenge at each quarter
  const spans = [];
  for (let i = 0; i < 8; i++) {
    const half = (j) => (j % 2 ? R.material + 12 : 13) / GREAT;
    spans.push(arcTrack(GREAT, rad(-90 + i * 45) + half(i), rad(-45 + i * 45) - half(i + 1)));
  }
  const great = inscribe(spans, runesOf(INSCRIPTIONS.great), HALF.material * 1.15);
  let beads = '';
  for (let deg = 0; deg < 360; deg += 3) {
    const off = (deg + 45) % 90; // 0 at the corners, where the medallions are
    if (Math.min(off, 90 - off) > 6) beads += `M${xy(at(GREAT + 21, rad(deg)))}h0.01`;
  }
  let lozenges = '';
  for (let i = 0; i < 4; i++) {
    const a = rad(-90 + i * 90), side = { x: -Math.sin(a) * 6.5, y: Math.cos(a) * 6.5 }, mid = at(GREAT, a);
    lozenges += `M${xy(at(GREAT - 16, a))}L${xy({ x: mid.x + side.x, y: mid.y + side.y })}L${xy(at(GREAT + 16, a))}L${xy({ x: mid.x - side.x, y: mid.y - side.y })}Z`;
  }
  // the heart: a stave of eight arms as on a helm of awe (tridents to the quarters, forks to the Temporal corners)
  // round a compass star
  const ARMS = {
    quarter: [[[24, 0], [70, 0]], [[38, -6], [38, 6]], [[49, -6], [49, 6]], [[70, -10], [59, -10], [59, 10], [70, 10]]],
    corner: [[[24, 0], [56, 0]], [[42, -6], [42, 6]], [[68, -9], [56, 0], [68, 9]]],
  };
  let stave = '';
  for (let i = 0; i < 8; i++) {
    const a = rad(-90 + i * 45), cos = Math.cos(a), sin = Math.sin(a);
    for (const line of ARMS[i % 2 ? 'corner' : 'quarter']) stave += line.map(([u, v], j) => `${j ? 'L' : 'M'}${xy({ x: C + u * cos - v * sin, y: C + u * sin + v * cos })}`).join('');
  }
  const spark = `M${Array.from({ length: 16 }, (_, i) => xy(at(i % 2 ? 4 : i % 4 ? 8.5 : 14, rad(i * 22.5 - 90)))).join('L')}Z`;
  /** An Absolute God's ring of rays round (x, y). */
  const rays = (x, y) => Array.from({ length: 12 }, (_, i) => {
    const a = rad(i * 30 - 90), r1 = i % 2 ? 50 : 56;
    return `M${(x + 44 * Math.cos(a)).toFixed(1)} ${(y + 44 * Math.sin(a)).toFixed(1)}L${(x + r1 * Math.cos(a)).toFixed(1)} ${(y + r1 * Math.sin(a)).toFixed(1)}`;
  }).join('');
  DECO = { bands, great, beads, lozenges, stave, spark, rays };
  return DECO;
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
