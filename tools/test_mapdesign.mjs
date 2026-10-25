// Node test for the map design and fog models (assets/js/views/map/design.js, fog.js).
// node tools/test_mapdesign.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/map/design.js')).href);
const F = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/map/fog.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`- ${t}`);

section('normDesign');
{
  const d = D.normDesign(null);
  eq('defaults: nothing shown', [d.compass.show, d.scale.show, d.border.show, d.background.kind, d.crop], [false, false, false, 'theme', null]);
  eq('default compass', [d.compass.type, d.compass.anchor, d.compass.corner, d.compass.size, d.compass.color], ['rose', 'screen', 'bl', 112, '#1f1a14']);
  eq('default scale', [d.scale.unit, d.scale.perPx, d.scale.style, d.scale.ruler, d.scale.pace.per, d.scale.pace.label], ['miles', 0, 'checkered', true, 24, 'days on foot']);
  const x = D.normDesign({
    background: { kind: 'image', image: 'https://evil.example/x.png' },
    compass: { show: true, type: 'nope', size: 9999, rotation: -90, color: 'red', anchor: 'map', x: 2, y: -1 },
    scale: { show: true, unit: 'parsecs', perPx: -3, custom: '  a  very   long unit name that goes on and on  ' },
    border: { show: 1, type: 'checker', width: 99, color: '#ABC' },
    extra: 'dropped',
  });
  eq('image background needs a repo image', x.background.kind, 'theme');
  eq('repo image kept', D.normDesign({ background: { kind: 'image', image: 'content/maps/a/bg.webp' } }).background, { kind: 'image', color: '#c9b98f', image: 'content/maps/a/bg.webp', fit: 'tile' });
  eq('path escape refused', D.normDesign({ background: { kind: 'image', image: 'content/../dm/vault.png' } }).background.kind, 'theme');
  eq('compass clamped', [x.compass.type, x.compass.size, x.compass.rotation, x.compass.color, x.compass.anchor, x.compass.x, x.compass.y], ['rose', 260, 270, '#1f1a14', 'map', 1, 0]);
  eq('scale sanitized', [x.scale.unit, x.scale.perPx, x.scale.custom], ['miles', 0, 'a very long unit name th']);
  eq('border sanitized', [x.border.show, x.border.type, x.border.width, x.border.color], [false, 'checker', 6, '#abc']);
  check('unknown fields dropped', !('extra' in x));
}

section('normCrop');
{
  eq('no crop', D.normCrop(null, 100, 100), null);
  eq('whole image = no crop', D.normCrop({ x: 0, y: 0, w: 100, h: 80 }, 100, 80), null);
  eq('clamped to the image', D.normCrop({ x: -10, y: 20, w: 500, h: 10 }, 100, 80), { x: 0, y: 20, w: 100, h: 16 });
  eq('kept while the size is unknown', D.normCrop({ x: 5, y: 6, w: 7, h: 8 }, 0, 0), { x: 5, y: 6, w: 7, h: 8 });
  eq('design crop uses the size', D.normDesign({ crop: { x: 10, y: 10, w: 50, h: 50 } }, { width: 200, height: 100 }).crop, { x: 10, y: 10, w: 50, h: 50 });
}

section('distances');
{
  const s = D.normDesign({ scale: { perPx: 0.1, unit: 'miles' } }).scale;
  eq('unit names', [D.unitName(s, 1), D.unitName(s, 2)], ['mile', 'miles']);
  eq('custom unit', D.unitName({ unit: 'custom', custom: 'hexes' }, 3), 'hexes');
  eq('fmtNum', [0.125, 1.5, 12.5, 250, 12500].map(D.fmtNum), ['0.125', '1.5', '12.5', '250', '12,500']);
  eq('fmtNum rounds', [D.fmtNum(3.14159), D.fmtNum(31.4159), D.fmtNum(314.159)], ['3.14', '31.4', '314']);
  eq('distance', D.fmtDistance(s, 12.5), '12.5 miles');
  eq('distance with pace', D.fmtDistance({ ...s, pace: { on: true, per: 24, label: 'days on foot' } }, 48), '48 miles · ≈ 2 days on foot');
  eq('path length', D.pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]), 11);
}

section('niceScale');
{
  eq('no scale', D.niceScale(0), null);
  const a = D.niceScale(0.1, 150); // 15 units in 150 px -> 10 units, 100 px
  eq('round value', [a.value, a.px, a.segments], [10, 100, 4]);
  const b = D.niceScale(0.4, 150); // 60 -> 50
  eq('fives', [b.value, b.px, b.segments], [50, 125, 5]);
  const c = D.niceScale(0.0021, 150); // 0.315 -> 0.2
  check('small values', Math.abs(c.value - 0.2) < 1e-12 && c.px <= 150 && c.px > 60, c);
  let ok = true;
  for (let u = 1e-4; u < 1e4; u *= 1.37) { const n = D.niceScale(u, 150); if (!(n.px <= 150 + 1e-9 && n.px > 150 / 2.5 - 1e-9)) ok = false; }
  check('bar always between 60 and 150 px', ok);
}

section('compass and border SVG');
{
  for (const t of D.COMPASS_TYPES) {
    const svg = D.compassSvg(t.id, { color: '#123456', rotation: 30 });
    check(`compass ${t.id}`, svg.startsWith('<svg') && svg.includes('rotate(30)') && svg.includes('#123456') && svg.includes('>N</text>'));
  }
  check('bad color falls back', D.compassSvg('rose', { color: 'url(javascript:x)' }).includes(D.INK) && !D.compassSvg('rose', { color: 'url(javascript:x)' }).includes('javascript'));
  const rect = { x: 100, y: 50, w: 1000, h: 500 };
  eq('border pad', D.borderPad({ show: true, width: 2 }, rect), 10);
  eq('no pad when hidden', D.borderPad({ show: false, width: 2 }, rect), 0);
  for (const t of D.BORDER_TYPES) {
    const { svg, box } = D.borderSvg({ type: t.id, width: 2, color: '#000000' }, rect);
    check(`border ${t.id}`, svg.startsWith('<svg') && svg.includes('viewBox="90 40 1020 520"'), svg.slice(0, 120));
    eq(`border ${t.id} box`, box, { x: 90, y: 40, w: 1020, h: 520 });
  }
}

/** '' when the markup is balanced XML made only of tags with quoted attributes (no text), else what is wrong. */
function xmlProblem(svg) {
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g;
  const stack = [];
  let last = 0;
  let m;
  while ((m = re.exec(svg))) {
    if (svg.slice(last, m.index).trim()) return `stray text at ${last}: ${svg.slice(last, m.index).slice(0, 40)}`;
    last = re.lastIndex;
    if (m[1]) { if (stack.pop() !== m[2]) return `mismatched </${m[2]}>`; } else if (!m[4]) stack.push(m[2]);
  }
  if (svg.slice(last).trim()) return `stray text at the end: ${svg.slice(last, last + 40)}`;
  if (stack.length) return `unclosed ${stack.join(',')}`;
  if (/NaN|undefined|Infinity|null/.test(svg)) return 'a bad number';
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  if (new Set(ids).size !== ids.length) return 'duplicate ids';
  for (const ref of [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((x) => x[1] || x[2])) if (!ids.includes(ref)) return `missing #${ref}`;
  for (const d of svg.matchAll(/\sd="([^"]*)"/g)) if (!/^[MmLlHhVvCcSsQqAaZz0-9.\s-]*$/.test(d[1])) return `odd path data ${d[1].slice(0, 40)}`;
  return '';
}

section('border model');
{
  eq('border defaults', D.normDesign(null).border, { show: false, type: 'double', color: D.INK, accent: '', width: 1.6, pad: 0, corners: 'auto', mat: 'paper', matColor: D.PAPER });
  eq('old single line keeps no mat', D.normDesign({ border: { show: true, type: 'line', color: '#000000', width: 2 } }).border.mat, 'none');
  eq('old double line keeps its paper mat', D.normDesign({ border: { show: true, type: 'double', width: 2 } }).border.mat, 'paper');
  const x = D.normDesign({ border: { type: 'bogus', corners: 'spiral', mat: 'glass', accent: 'red', matColor: 'url(x)', pad: 99, width: 0.01 } }).border;
  eq('whitelisted and clamped', [x.type, x.corners, x.mat, x.accent, x.matColor, x.pad, x.width], ['double', 'auto', 'paper', '', D.PAPER, 5, 0.3]);
  const y = D.normDesign({ border: { type: 'rope', corners: 'knot', mat: 'color', accent: '#ABCDEF', matColor: '#123', pad: '1.25' } }).border;
  eq('kept and rounded', [y.type, y.corners, y.mat, y.accent, y.matColor, y.pad], ['rope', 'knot', 'color', '#abcdef', '#123', 1.3]);
  eq('no negative gap', D.normDesign({ border: { pad: -2 } }).border.pad, 0);
  eq('every style is known', D.BORDER_TYPES.map((t) => D.normDesign({ border: { type: t.id } }).border.type), D.BORDER_TYPES.map((t) => t.id));
  check('every style has a good width', D.BORDER_TYPES.every((t) => t.width >= 0.3 && t.width <= 6));
  eq('band + gap', D.borderPad({ show: true, width: 2, pad: 1 }, { x: 0, y: 0, w: 1000, h: 500 }), 15);
  eq('own corners', ['line', 'ornate', 'rope', 'vine', 'checker', 'deco'].map((t) => D.borderCorners({ type: t, corners: 'auto' })), ['none', 'square', 'knot', 'rosette', 'blocks', 'jewel']);
  eq('chosen corners', D.borderCorners({ type: 'ornate', corners: 'star' }), 'star');
  eq('second color use', [D.borderAccentUse({ type: 'line', corners: 'auto' }), D.borderAccentUse({ type: 'line', corners: 'rosette' }), D.borderAccentUse({ type: 'double' })], ['', 'corners', 'inner line']);
}

section('border SVG');
{
  check('the SVG checker catches problems', ['<svg><g></svg>', '<svg><path d="M0 NaN"/></svg>', '<svg><use href="#x"/></svg>', '<svg>text</svg>', '<svg><g id="a"/><g id="a"/></svg>'].every((s) => xmlProblem(s))
    && !xmlProblem('<svg viewBox="0 0 1 1"><defs><g id="a"/></defs><use href="#a"/></svg>'));
  const rect = { x: 100, y: 50, w: 1000, h: 500 };
  // the four older styles look as they did (same rules at the same places)
  const old = (type) => D.borderSvg(D.normDesign({ border: { show: true, type, width: 2, color: '#000000' } }).border, rect).svg;
  check('double: thick and thin rules', old('double').includes('<rect x="91.8" y="41.8" width="1016.4" height="516.4" fill="none" stroke="#000000" stroke-width="2.6"/>')
    && old('double').includes('<rect x="96.8" y="46.8" width="1006.4" height="506.4" fill="none" stroke="#000000" stroke-width="1"/>') && old('double').includes(`fill="${D.PAPER}"`));
  check('line: one rule, no mat', old('line').includes('stroke-width="4.2"') && !old('line').includes(D.PAPER));
  check('ornate: corner squares and diamonds', (old('ornate').match(/<rect x="[^"]+" y="[^"]+" width="9.2" height="9.2"/g) || []).length === 4);
  check('checker: corner blocks', (old('checker').match(/width="6.2" height="6.2"/g) || []).length === 4);
  const corners = D.BORDER_CORNERS.map((c) => c.id);
  let bad = '';
  let n = 0;
  for (const t of D.BORDER_TYPES) {
    for (const corner of corners) {
      for (const mat of ['paper', 'color', 'none']) {
        const b = D.normDesign({ border: { show: true, type: t.id, corners: corner, mat, matColor: '#334455', accent: corner === 'star' ? '#aa0000' : '', pad: mat === 'color' ? 1.5 : 0, width: t.width } }).border;
        const { svg, box } = D.borderSvg(b, rect, { id: `t${n++}` });
        const p = xmlProblem(svg);
        const B = (t.width / 100) * 500;
        const T = B + b.pad * 5;
        if (p) bad ||= `${t.id}/${corner}/${mat}: ${p}`;
        else if (!svg.startsWith('<svg ') || JSON.stringify(box) !== JSON.stringify({ x: 100 - T, y: 50 - T, w: 1000 + 2 * T, h: 500 + 2 * T })) bad ||= `${t.id}/${corner}/${mat}: box ${JSON.stringify(box)}`;
      }
    }
    const prev = D.borderPreviewSvg(t.id, D.normDesign({ border: { type: t.id } }).border);
    if (xmlProblem(prev)) bad ||= `preview ${t.id}: ${xmlProblem(prev)}`;
    for (const corner of corners) { const cp = D.borderPreviewSvg(t.id, {}, { id: `c${corner}`, corners: corner, zoom: 'corner' }); if (xmlProblem(cp)) bad ||= `corner preview ${t.id}/${corner}: ${xmlProblem(cp)}`; }
  }
  check(`every style × corner × mat is valid SVG (${n})`, !bad, bad);
  const evil = D.borderSvg({ type: 'vine', color: 'url(javascript:x)', accent: '"><script>', matColor: 'red;', mat: 'color', width: 2 }, rect).svg;
  check('colors are sanitized', !/javascript|script|red;/.test(evil) && !xmlProblem(evil));
  const big = { x: 0, y: 0, w: 4961, h: 3508 }; // the main map
  const sizes = D.BORDER_TYPES.map((t) => [t.id, D.borderSvg(D.normDesign({ border: { show: true, type: t.id, width: t.width } }).border, big).svg.length]);
  const heavy = sizes.filter(([, s]) => s > 160 * 1024);
  check('no frame is too heavy on the main map (< 160 KB)', !heavy.length, heavy);
  const ruggedA = D.borderSvg({ type: 'burnt', width: 2.6 }, big).svg;
  check('hand-made styles are the same every time', ruggedA === D.borderSvg({ type: 'burnt', width: 2.6 }, big).svg
    && D.borderSvg({ type: 'inked', width: 2 }, rect).svg === D.borderSvg({ type: 'inked', width: 2 }, rect).svg);
  const strip = D.borderSvg({ type: 'meander', width: 2 }, rect).svg;
  check('motif strips are clipped between the corners', strip.includes('<rect x="10" y="0" width="1000" height="10"/>') && strip.includes('<rect x="10" y="0" width="500" height="10"/>'));
}

section('fog areas');
{
  const sq = (x, y, s) => F.rectPts(x, y, s, s);
  const fog = (areas, extra = {}) => F.normFog({ areas, ...extra }, 'main');
  // normalising
  const n = F.normFog({ opacity: 5, softness: -1, areas: [{ id: 'a', pts: [0, 0, 10, 0, 10, 10] }, { pts: [1, 2] }, null, { id: 'b', pts: [0, 0, 5, 0, 5, 5, 0, 5], holes: [[1, 1, 2], [1, 1, 2, 1, 2, 2]], on: false, z: 3 }] }, 'main');
  eq('normFog', [n.map, n.v, n.on, n.opacity, n.softness, n.areas.length], ['main', 2, true, 1, 0, 2]);
  eq('bad holes dropped, on / z kept', [n.areas[1].holes.length, n.areas[1].on, n.areas[1].z], [1, false, 3]);
  check('active only with a hidden area', F.fogActive(n) && !F.fogActive(fog([{ pts: sq(0, 0, 9), on: false }])) && !F.fogActive({ ...n, on: false }));
  // covering, holes, revealed areas
  let areas = F.addArea([], F.rectPts(0, 0, 1000, 1000), { id: 'all', z: 1 });
  areas = F.cutFog(areas, sq(100, 100, 100));
  const f1 = fog(areas);
  check('covered outside a clearing', F.fogCovers(f1, 500, 500));
  check('clear inside the clearing', !F.fogCovers(f1, 150, 150));
  check('fog off = nothing covered', !F.fogCovers({ ...f1, on: false }, 500, 500));
  eq('areaAt finds the area', F.areaAt(f1, 500, 500)?.id, 'all');
  eq('areaAt misses the clearing', F.areaAt(f1, 150, 150), null);
  // one layer: a new area is cut out of the ones it touches; an area inside a cutter goes
  areas = F.addArea(areas, sq(400, 400, 100), { id: 'patch', z: 2 });
  eq('the old area got a hole for the new one', areas.find((a) => a.id === 'all').holes.length, 2);
  const f2 = fog(areas.map((a) => (a.id === 'patch' ? { ...a, on: false } : a)));
  check('a revealed patch shows its land', !F.fogCovers(f2, 450, 450));
  check('the rest stays covered', F.fogCovers(f2, 700, 700));
  eq('areaAt finds a revealed area (the DM can hide it again)', F.areaAt(f2, 450, 450)?.id, 'patch');
  const gone = F.cutFog(areas, sq(350, 350, 200));
  check('an area wholly inside a clearing is deleted', !gone.some((a) => a.id === 'patch'));
  eq('holes inside the new clearing are merged into it', gone.find((a) => a.id === 'all').holes.length, 2);
  const apart = F.cutFog([{ id: 'x', pts: sq(0, 0, 10), holes: [], on: true, z: 1 }], sq(50, 50, 10));
  eq('a clearing elsewhere leaves an area alone', apart[0].holes.length, 0);
  // geometry helpers
  check('polysMeet: crossing without corners inside', F.polysMeet(F.rectPts(0, 4, 20, 2), F.rectPts(8, 0, 2, 20)));
  check('polyInside', F.polyInside(sq(2, 2, 2), sq(0, 0, 10)) && !F.polyInside(sq(8, 8, 5), sq(0, 0, 10)));
  eq('areasIn: the Select box', F.areasIn(fog(areas), [380, 380, 420, 420]).map((a) => a.id).sort(), ['all', 'patch']);
  eq('rectPts flips negative sizes', F.rectPts(10, 10, -5, 20), [5, 10, 10, 10, 10, 30, 5, 30]);
  check('whole map', F.wholeMap({ w: 300, h: 200 }).join() === '0,0,300,0,300,200,0,200' && F.wholeMap(null)[0] < -1000);
  eq('simplify keeps the shape', F.simplify([0, 0, 1, 0.01, 2, 0, 3, 5, 4, 10], 0.1), [0, 0, 2, 0, 4, 10]);
  check('polyArea', Math.abs(F.polyArea(sq(0, 0, 10))) === 100);
  // size cap: many detailed clearings are simplified until the area fits
  let big = [{ id: 'b', pts: F.rectPts(0, 0, 10000, 10000), holes: [], on: true, z: 1 }];
  const wiggly = (cx, cy) => Array.from({ length: 400 }, (_, i) => { const t = (i / 400) * Math.PI * 2; const r = 40 + 3 * Math.sin(i * 1.7); return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }).flat();
  for (let i = 0; i < 12; i++) big = F.cutFog(big, wiggly(500 + i * 300, 500));
  check('area kept under AREA_BYTES', JSON.stringify(big[0]).length <= F.AREA_BYTES, JSON.stringify(big[0]).length);
  check('clearings still clear after simplifying', !F.fogCovers(fog(big), 500, 500) && F.fogCovers(fog(big), 5000, 5000));
  // fingerprint, scaling
  const h1 = F.fogHash(f1);
  check('hash changes with a reveal', h1 !== F.fogHash(fog(f1.areas.map((a) => ({ ...a, on: false })))) && h1 === F.fogHash(fog(f1.areas)));
  eq('scaled areas', F.scaleAreas([{ id: 's', pts: [10, 20, 30, 20, 30, 40], holes: [[12, 22, 14, 22, 14, 24]], on: true, z: 1 }], 2, 3)[0].pts, [20, 60, 60, 60, 60, 120]);
}

section('fog: first-version documents');
{
  const old = F.normFog({ on: true, style: 'clouds', ops: [{ k: 'all' }, { t: 'cut', k: 'rect', p: [0, 0, 100, 100] }, { t: 'add', k: 'brush', p: [50, 50], r: 10 }, { t: 'cut', k: 'poly', p: [600, 600, 700, 600, 700, 700, 600, 700] }, null] }, 'main', { w: 1000, h: 800 });
  check('converted to areas', old.areas.length >= 2 && !('ops' in old), old.areas.length);
  check('covered outside the cut', F.fogCovers(old, 500, 500));
  check('revealed inside the cut', !F.fogCovers(old, 20, 20));
  check('a brush dab re-covers', F.fogCovers(old, 55, 52));
  check('a cut polygon is clear', !F.fogCovers(old, 650, 650));
  check('"all" uses the map size', JSON.stringify(old.areas[0].pts) === JSON.stringify(F.wholeMap({ w: 1000, h: 800 })));
  const stroke = F.normFog({ ops: [{ k: 'poly', p: [0, 0, 100, 0, 100, 100, 0, 100] }, { t: 'cut', k: 'brush', p: [0, 50, 100, 50], r: 5 }] });
  check('a brush stroke cuts a line', !F.fogCovers(stroke, 50, 53) && F.fogCovers(stroke, 50, 60));
  eq('the repo\'s fog (cover all, switched off)', [F.normFog({ on: false, ops: [{ t: 'add', k: 'all' }] }).on, F.normFog({ on: false, ops: [{ t: 'add', k: 'all' }] }).areas.length], [false, 1]);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
