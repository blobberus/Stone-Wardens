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

section('fog ops');
{
  eq('rect normalized', F.normOp({ t: 'add', k: 'rect', p: [10, 10, -5, 20] }), { t: 'add', k: 'rect', p: [5, 10, 5, 20] });
  eq('bad ops dropped', [F.normOp({ k: 'rect', p: [1, 2] }), F.normOp({ k: 'poly', p: [1, 2, 3, 4] }), F.normOp({ k: 'brush', p: [1, 2] }), F.normOp({ k: 'x' }), F.normOp({ k: 'brush', p: [1, 'a'], r: 2 })], [null, null, null, null, null]);
  eq('t defaults to add', F.normOp({ k: 'all' }), { t: 'add', k: 'all' });
  const fog = F.normFog({ style: 'weird', opacity: 5, softness: -1, ops: [{ k: 'all' }, { t: 'cut', k: 'rect', p: [0, 0, 100, 100] }, { t: 'add', k: 'brush', p: [50, 50], r: 10 }, null] }, 'main');
  eq('normFog', [fog.map, fog.on, fog.style, fog.opacity, fog.softness, fog.ops.length], ['main', true, 'clouds', 1, 0, 3]);
  check('covered outside the cut', F.fogCovers(fog, 500, 500));
  check('revealed inside the cut', !F.fogCovers(fog, 20, 20));
  check('brush re-covers', F.fogCovers(fog, 55, 52));
  check('off = nothing covered', !F.fogCovers({ ...fog, on: false }, 500, 500));
  check('active', F.fogActive(fog) && !F.fogActive(F.normFog({ ops: [{ t: 'cut', k: 'all' }] })));
  const poly = F.normFog({ ops: [{ k: 'poly', p: [0, 0, 100, 0, 100, 100, 0, 100] }, { t: 'cut', k: 'brush', p: [0, 50, 100, 50], r: 5 }] });
  check('inside polygon', F.fogCovers(poly, 50, 20));
  check('outside polygon', !F.fogCovers(poly, 150, 20));
  check('brush stroke cuts a line', !F.fogCovers(poly, 50, 53) && F.fogCovers(poly, 50, 60));
  eq('simplify keeps the shape', F.simplify([0, 0, 1, 0.01, 2, 0, 3, 5, 4, 10], 0.1), [0, 0, 2, 0, 4, 10]);
  check('hash of a prefix', F.opsHash(fog.ops, 2) === F.opsHash(fog.ops.slice(0, 2)) && F.opsHash(fog.ops, 2) !== F.opsHash(fog.ops, 3));
  const sc = F.scaleOps([{ t: 'add', k: 'rect', p: [10, 20, 30, 40] }, { t: 'add', k: 'brush', p: [1, 2], r: 4 }], 2, 2);
  eq('scaled ops', sc, [{ t: 'add', k: 'rect', p: [20, 40, 60, 80] }, { t: 'add', k: 'brush', p: [2, 4], r: 8 }]);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
