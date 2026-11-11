// Node test for the journal's family trees and timelines: the calendar (ages in order, dates), note kinds and what
// they index, and the family tree's layout (generations, no two cards meeting, cycles, random families).
// node tools/test_boards.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const C = await load('assets/js/views/journal/calendar.js');
const K = await load('assets/js/views/journal/kinds.js');
const F = await load('assets/js/views/journal/family-layout.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`- ${t}`);

section('calendar: the default and the ages in order');
{
  const def = C.makeCalendar(null);
  eq('no file: one age, AFF, the default', [def.ages.map((a) => a.abbr), def.defaultAge, def.ages[0].name], [['AFF'], 'aff', 'After the Fallen Firmament']);
  eq('no file: twelve Gregorian months', [def.months.length, def.months[0], def.months[11]], [12, 'January', 'December']);
  const cal = C.makeCalendar({
    ages: [
      { id: 'bff', abbr: 'BFF', name: 'Before the Fallen Firmament', countdown: true },
      { id: 'aff', abbr: 'AFF', name: 'After the Fallen Firmament', start: 1, end: 1032 },
      { id: 'bcc', abbr: 'BCC', name: 'Blood Crown Century' },
      { id: 'bcc', abbr: 'XX', name: 'a duplicate id' },
    ],
    months: ['Thaw', 'Bloom', 'High Sun'],
    defaultAge: 'nope',
  });
  eq('duplicate ids dropped', cal.ages.map((a) => a.id), ['bff', 'aff', 'bcc']);
  eq('an unknown default falls back to AFF', cal.defaultAge, 'aff');
  eq('own months', cal.months, ['Thaw', 'Bloom', 'High Sun']);
  const k = (d) => C.dateKey(d, cal);
  const before = (a, b) => C.cmpKey(k(a), k(b)) < 0;
  check('100 AFF before 1 BCC (AFF is above BCC)', before({ year: 100, age: 'aff' }, { year: 1, age: 'bcc' }));
  check('900 BFF before 1 AFF', before({ year: 900, age: 'bff' }, { year: 1, age: 'aff' }));
  check('a countdown age runs backwards: 300 BFF before 1 BFF', before({ year: 300, age: 'bff' }, { year: 1, age: 'bff' }));
  check('no month comes before the first month', before({ year: 5, age: 'aff' }, { year: 5, month: 1, age: 'aff' }));
  check('months in order', before({ year: 5, month: 2, age: 'aff' }, { year: 5, month: 3, age: 'aff' }));
  check('an unknown age sorts after every known one', before({ year: 1e6, age: 'bcc' }, { year: 1, age: 'zzz' }));
  const swapped = C.makeCalendar({ ages: [{ id: 'bcc', abbr: 'BCC' }, { id: 'aff', abbr: 'AFF' }] });
  check('reordering the ages reorders dates: 1 BCC before 100 AFF', C.cmpKey(C.dateKey({ year: 1, age: 'bcc' }, swapped), C.dateKey({ year: 100, age: 'aff' }, swapped)) < 0);
  eq('fmtDate with and without a month', [C.fmtDate({ year: 100, month: 3, age: 'aff' }, { cal }), C.fmtDate({ year: 100, age: 'aff' }, { cal })], ['High Sun 100 AFF', '100 AFF']);
  eq('fmtDate: a month past the list', C.fmtDate({ year: 1, month: 7, age: 'aff' }, { cal }), 'Month 7 1 AFF');
  eq('fmtRange in one age', C.fmtRange({ year: 104, age: 'aff' }, { year: 162, age: 'aff' }, { cal }), '104 – 162 AFF');
  eq('fmtRange across ages', C.fmtRange({ year: 998, age: 'aff' }, { year: 3, age: 'bcc' }, { cal }), '998 AFF – 3 BCC');
  eq('fmtRange open end', C.fmtRange({ year: 104, age: 'aff' }, null, { cal }), '104 AFF –');
  eq('yearsBetween', [C.yearsBetween({ year: 104, age: 'aff' }, { year: 162, age: 'aff' }, cal), C.yearsBetween({ year: 300, age: 'bff' }, { year: 100, age: 'bff' }, cal), C.yearsBetween({ year: 1, age: 'aff' }, { year: 1, age: 'bcc' }, cal)], [58, 200, null]);
  eq('normDate: a blank year is no date', [C.normDate({ year: '' }, cal), C.normDate({ year: '12', month: '0', age: 'bcc' }, cal)], [null, { year: 12, month: null, age: 'bcc' }]);
  eq('normDate: a date without an age is in the default age', C.normDate({ year: 7 }, cal).age, 'aff');
  eq('dateValue drops an empty month', C.dateValue({ year: 3, month: null, age: 'aff' }), { year: 3, age: 'aff' });
  eq('newAgeId avoids taken ids', C.newAgeId('AFF', cal.ages), 'aff-2');
  eq('colours: unknown -> fallback', [C.colorId('gold'), C.colorId('pink'), C.colorVar('lapis')], ['gold', 'slate', 'var(--pin-lapis)']);
}

section('note kinds');
{
  eq('kindOf', [K.kindOf({}), K.kindOf({ kind: 'Timeline' }), K.kindOf({ kind: 'family-tree' }), K.kindOf({ kind: 'recipe' })], ['note', 'timeline', 'family-tree', 'note']);
  eq('a regular note has no board', K.boardData({ title: 'x' }), null);
  eq('an empty timeline', K.boardData({ kind: 'timeline' }), { view: 'horizontal', ages: [], events: [], spans: [], markers: [] });
  eq('an empty family tree', K.boardData({ kind: 'family-tree' }), { people: [], unions: [] });
  eq('newBoard', [K.newBoard('timeline'), K.newBoard('family-tree'), K.newBoard('note')], [{ kind: 'timeline', timeline: { view: 'horizontal' } }, { kind: 'family-tree', family: { people: [] } }, {}]);
  eq('cleanTag', ['#War', ' great war ', 'a/b', 'x!y', '--'].map(K.cleanTag), ['War', 'great-war', 'a/b', 'xy', '']);
  const fm = { kind: 'timeline', timeline: { events: [{ id: 'e1', title: 'Siege', text: 'See [[Mira]].', tags: ['war', 'grey water'], year: 1 }], spans: [{ title: 'Reign', tags: 'royal' }], markers: [{ label: 'Here' }] } };
  const text = K.boardText(fm);
  check('boardText has titles, text, tags as #tags', text.includes('Siege') && text.includes('[[Mira]]') && text.includes('#war') && text.includes('#grey-water') && text.includes('#royal') && text.includes('Here'), text);
  eq('boardItems types: the items, then the ages shown', K.boardItems(fm).map((i) => i.type), ['event', 'span', 'marker', 'age']);
  const mapped = K.mapBoardStrings(fm.timeline, (s) => s.replace('[[Mira]]', '[[Mira Vael]]'));
  eq('mapBoardStrings rewrites strings, keeps numbers', [mapped.events[0].text, mapped.events[0].year, fm.timeline.events[0].text], ['See [[Mira Vael]].', 1, 'See [[Mira]].']);
  eq('itemAnchor', K.itemAnchor('Siege of Greywater!'), 'siege-of-greywater');
}

section('family tree: normalize and compact');
{
  const n = F.normalize({
    people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { name: 'no id' }],
    unions: [
      { id: 'u1', partners: ['a', 'b', 'c'], children: ['c', 'ghost'] }, // three partners, a dangling child, a partner as child
      { id: 'u2', partners: ['c'], children: [] }, // a partnership of one with no children
      { id: 'u3', partners: ['b'], children: ['c'] }, // c already has parents
      { id: 'u4', partners: [], children: ['p4'] }, // the person without an id got p4
    ],
  });
  eq('ids filled', n.people.map((p) => p.id), ['a', 'b', 'c', 'p4']);
  eq('at most two partners; a partner is never their own child', n.unions[0].partners, ['a', 'b']);
  eq('dangling and second-parent children dropped', n.unions.map((u) => [u.id, u.children]), [['u1', ['c']], ['u3', []], ['u4', ['p4']]].filter((x) => x[0] !== 'u3'));
  eq('childOf', n.childOf.get('c').id, 'u1');
  const out = F.compact(n.people, [...n.unions, { id: 'u9', partners: ['a'], children: [], status: 'married' }, { id: 'u8', partners: ['a', 'b'], children: [], status: 'separated' }]);
  eq('compact: a lone partner without children is dropped; married is the default', out.unions.map((u) => [u.id, u.status ?? 'married']), [['u1', 'married'], ['u4', 'married'], ['u8', 'separated']]);
  eq('lifeLine', [
    F.lifeLine({ born: { year: 80, age: 'aff' }, died: { year: 162, age: 'aff' } }, C.makeCalendar(null)),
    F.lifeLine({ born: { year: 80, age: 'aff' } }, C.makeCalendar(null)),
    F.lifeLine({ died: { year: 9, age: 'aff' } }, C.makeCalendar(null)),
    F.lifeLine({}, C.makeCalendar(null)),
  ], ['80 – 162 AFF', 'b. 80 AFF', 'd. 9 AFF', '']);
}

// layout checks shared by the fixed and the random families
function layoutProblems(people, unions) {
  const n = F.normalize({ people, unions });
  const geo = F.layoutFamily(n.people, n.unions, n.childOf, () => 60);
  const bad = [];
  for (const p of n.people) if (!geo.x.has(p.id) || !Number.isFinite(geo.x.get(p.id))) bad.push(`unplaced ${p.id}`);
  const rows = new Map();
  for (const p of n.people) { const g = geo.gen.get(p.id); if (!rows.has(g)) rows.set(g, []); rows.get(g).push(p.id); }
  for (const [g, ids] of rows) {
    const xs = ids.map((id) => [geo.x.get(id), id]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < xs.length; i++) if (xs[i][0] < xs[i - 1][0] + F.W - 0.5) bad.push(`overlap in row ${g}: ${xs[i - 1][1]} ${xs[i][1]}`);
  }
  for (const u of n.unions) {
    if (u.partners.length === 2 && geo.gen.get(u.partners[0]) !== geo.gen.get(u.partners[1])) bad.push(`partners apart ${u.partners}`);
    for (const c of u.children) for (const p of u.partners) if (geo.gen.get(c) <= geo.gen.get(p)) bad.push(`child ${c} not below ${p}`);
  }
  if (Math.min(...[...geo.x.values()]) < F.PAD - 0.5) bad.push('off the left edge');
  return { bad, geo, n };
}

section('family tree: layout');
{
  const people = 'orin sera aldis corwin brannoc ilsa tamsin edric rook wren sparrow'.split(' ').map((id) => ({ id, name: id }));
  const unions = [
    { id: 'u1', partners: ['orin', 'sera'], children: ['aldis', 'brannoc'] },
    { id: 'u2', partners: ['aldis', 'corwin'], children: ['ilsa', 'tamsin'] },
    { id: 'u3', partners: ['aldis', 'edric'], children: ['rook'], status: 'separated' },
    { id: 'u4', partners: [], children: ['wren', 'sparrow'] },
  ];
  const { bad, geo } = layoutProblems(people, unions);
  eq('three generations, no problems', bad, []);
  eq('rows', ['orin', 'aldis', 'corwin', 'edric', 'ilsa', 'rook', 'wren'].map((id) => geo.gen.get(id)), [0, 1, 1, 1, 2, 2, 0]);
  const mid = (a, b) => (geo.x.get(a) + geo.x.get(b)) / 2;
  check('parents centred over their children', Math.abs(mid('orin', 'sera') - mid('aldis', 'brannoc')) < 1, [mid('orin', 'sera'), mid('aldis', 'brannoc')]);
  check('someone with two partners sits between them', geo.x.get('edric') < geo.x.get('aldis') && geo.x.get('aldis') < geo.x.get('corwin'));
  check('the first family added stays at the left', geo.x.get('orin') < geo.x.get('wren') || geo.x.get('edric') < geo.x.get('wren'));
  check('the board opens on the main family\'s oldest couple', Math.abs(geo.focus.x - mid('orin', 'sera') - F.W / 2) < 1 && geo.focus.y === geo.rowTop[0] && geo.focus.ids.join() === 'orin,sera', geo.focus);
  // a small family added first and a big one after it: the big one is the main family
  const two = layoutProblems([{ id: 'x' }, { id: 'y' }, { id: 'm' }, { id: 'n' }, { id: 'k1' }, { id: 'k2' }, { id: 'k3' }],
    [{ partners: ['x', 'y'], children: [] }, { partners: ['m', 'n'], children: ['k1', 'k2', 'k3'] }]);
  eq('the main family is the widest', two.geo.focus.ids, ['m', 'n']);
  const n0 = F.normalize({ people, unions });
  const roomy = F.layoutFamily(n0.people, n0.unions, n0.childOf, () => 60, { vg: F.VG_TOUCH });
  eq('vg: the room between generations (touch)', [roomy.vg, roomy.rowTop[1] - roomy.rowTop[0] - roomy.rowH[0], geo.vg, geo.rowTop[1] - geo.rowTop[0] - geo.rowH[0]], [F.VG_TOUCH, F.VG_TOUCH, F.VG, F.VG]);
  eq('no one in the tree: the focus is the corner', F.layoutFamily([], [], new Map(), () => 60).focus, { x: F.PAD, y: F.PAD, ids: [] });
  // a parent with no parents of their own sits right above their child
  const late = layoutProblems([{ id: 'g' }, { id: 'p' }, { id: 'c' }, { id: 'in' }, { id: 'k' }],
    [{ partners: ['g'], children: ['p'] }, { partners: ['p'], children: ['c'] }, { partners: ['c', 'in'], children: ['k'] }]);
  eq('married-in partner shares the row', [late.bad, late.geo.gen.get('in'), late.geo.gen.get('c')], [[], 2, 2]);
  // a cycle (someone their own ancestor) doesn't hang the layout
  const cyc = F.normalize({ people: [{ id: 'a' }, { id: 'b' }], unions: [{ partners: ['a'], children: ['b'] }, { partners: ['b'], children: ['a'] }] });
  const t0 = Date.now();
  const cg = F.layoutFamily(cyc.people, cyc.unions, cyc.childOf, () => 60);
  check('a cycle ends', Date.now() - t0 < 500 && cg.x.size === 2);
  // an empty tree
  const e = F.layoutFamily([], [], new Map(), () => 60);
  check('an empty tree', e.x.size === 0 && Number.isFinite(e.width) && Number.isFinite(e.height));
}

section('family tree: 300 random families');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let worst = [];
  for (let t = 0; t < 300; t++) {
    const n = 2 + Math.floor(rnd() * 26);
    const people = Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
    const unions = [];
    const hasParents = new Set();
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.45) continue;
      const a = `p${i}`;
      const b = rnd() < 0.7 ? `p${Math.floor(rnd() * n)}` : null;
      const kids = [];
      for (let j = i + 1; j < n; j++) if (!hasParents.has(`p${j}`) && rnd() < 0.18) { kids.push(`p${j}`); hasParents.add(`p${j}`); }
      unions.push({ partners: b && b !== a ? [a, b] : [a], children: kids });
    }
    if (rnd() < 0.2) unions.push({ partners: [], children: [`p${n - 1}`, `p${Math.floor(rnd() * n)}`] });
    const { bad } = layoutProblems(people, unions);
    // random data may hold contradictions (a partner who is also a descendant); only overlaps and gaps count here
    const hard = bad.filter((x) => x.startsWith('overlap') || x.startsWith('unplaced') || x.startsWith('off'));
    if (hard.length && !worst.length) worst = [t, hard.slice(0, 3)];
  }
  eq('no overlaps, everyone placed, none off the edge', worst, []);
}

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => `  FAIL ${f}`).join('\n')); process.exit(1); }
