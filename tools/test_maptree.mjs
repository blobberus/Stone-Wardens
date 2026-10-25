// Node test for the map hierarchy (assets/js/views/map/maptree.js): parents, maps of their own, loops, moves.
// node tools/test_maptree.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/map/maptree.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`- ${t}`);
const obj = (m) => Object.fromEntries([...m].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
const byName = (a, b) => a.name.localeCompare(b.name);

section('wantedParent');
{
  eq('null = a map of its own', T.wantedParent(null), null);
  eq('absent = main', T.wantedParent(undefined), 'main');
  eq('empty = main', T.wantedParent('  '), 'main');
  eq('a number is not an id', T.wantedParent(7), 'main');
  eq('an id', T.wantedParent(' duskhold-a1 '), 'duskhold-a1');
}

section('resolveParents');
{
  const subs = [
    { id: 'a', parent: 'main' },
    { id: 'b', parent: 'a' },
    { id: 'c' }, // old document: no parent
    { id: 'd', parent: null }, // a map of its own
    { id: 'e', parent: 'd' },
    { id: 'f', parent: 'gone-zz' }, // unknown parent
    { id: 'g', parent: 'g' }, // itself
    { id: 'h', parent: '' },
  ];
  eq('parents', obj(T.resolveParents(subs)), { a: 'main', b: 'a', c: 'main', d: null, e: 'd', f: 'main', g: 'main', h: 'main' });
  const loop = T.resolveParents([{ id: 'y', parent: 'x' }, { id: 'x', parent: 'z' }, { id: 'z', parent: 'y' }, { id: 'w', parent: 'x' }]);
  eq('a loop breaks at its first map by id', obj(loop), { w: 'x', x: 'main', y: 'x', z: 'y' });
  const two = T.resolveParents([{ id: 'p', parent: 'q' }, { id: 'q', parent: 'p' }]);
  eq('two maps inside each other', obj(two), { p: 'main', q: 'p' });
  const loopOwn = T.resolveParents([{ id: 'p', parent: 'q' }, { id: 'q', parent: 'p' }, { id: 'r', parent: null }, { id: 's', parent: 'r' }]);
  eq('a loop next to maps of their own', obj(loopOwn), { p: 'main', q: 'p', r: null, s: 'r' });
  const sameEitherWay = obj(T.resolveParents([{ id: 'x', parent: 'z' }, { id: 'z', parent: 'y' }, { id: 'y', parent: 'x' }]));
  eq('order of the documents does not matter', sameEitherWay, obj(T.resolveParents([{ id: 'y', parent: 'x' }, { id: 'z', parent: 'y' }, { id: 'x', parent: 'z' }])));
  const hidden = T.resolveParents(subs, { mainShown: false });
  eq('main hidden from this viewer: what would sit in it stands alone', obj(hidden), { a: null, b: 'a', c: null, d: null, e: 'd', f: null, g: null, h: null });
}

section('mapTree');
{
  const subs = [
    { id: 'starfall', name: 'Starfall Vale', parent: 'main' },
    { id: 'duskhold', name: 'Duskhold', parent: 'starfall' },
    { id: 'abbey', name: 'Abbey', parent: 'main' },
    { id: 'isles', name: 'The Shattered Isles', parent: null },
    { id: 'reef', name: 'Reef', parent: 'isles' },
    { id: 'astral', name: 'Astral Sea', parent: null },
  ];
  const t = T.mapTree(subs, { compare: byName });
  eq('order: main and its tree, then maps of their own by name', t.order, [
    { id: 'main', depth: 0 }, { id: 'abbey', depth: 1 }, { id: 'starfall', depth: 1 }, { id: 'duskhold', depth: 2 },
    { id: 'astral', depth: 0 }, { id: 'isles', depth: 0 }, { id: 'reef', depth: 1 },
  ]);
  eq('kids of main', (t.kids.get('main') || []).map((m) => m.id), ['abbey', 'starfall']);
  eq('maps of their own (null key)', (t.kids.get(null) || []).map((m) => m.id), ['astral', 'isles']);
  const h = T.mapTree(subs, { compare: byName, mainShown: false });
  check('main hidden: not listed', !h.order.some((x) => x.id === 'main'));
  eq('main hidden: its maps would be top level for this viewer', h.order.map((x) => `${x.id}:${x.depth}`), ['abbey:0', 'astral:0', 'starfall:0', 'duskhold:1', 'isles:0', 'reef:1']);
  // what a player sees while the DM hides the main map: its maps are sealed too, so only the maps of their own are there
  const players = T.mapTree(subs.filter((m) => ['isles', 'reef', 'astral'].includes(m.id)), { compare: byName, mainShown: false });
  eq('players: only the maps of their own', players.order.map((x) => x.id), ['astral', 'isles', 'reef']);
  const empty = T.mapTree([], {});
  eq('no sub-maps: just the main map', empty.order, [{ id: 'main', depth: 0 }]);
  eq('nothing at all while hidden', T.mapTree([], { mainShown: false }).order, []);
}

section('moves');
{
  const p = T.resolveParents([
    { id: 'a', parent: 'main' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'b' }, { id: 'd', parent: null }, { id: 'e', parent: 'd' },
  ]);
  eq('descendants of a', [...T.descendantsOf(p, 'a')].sort(), ['b', 'c']);
  eq('descendants of main', [...T.descendantsOf(p, 'main')].sort(), ['a', 'b', 'c']);
  eq('descendants of a map of its own', [...T.descendantsOf(p, 'd')], ['e']);
  check('a into itself: no', !T.canMoveInto(p, 'a', 'a'));
  check('a into its sub-map: no', !T.canMoveInto(p, 'a', 'b') && !T.canMoveInto(p, 'a', 'c'));
  check('c into a (up): yes', T.canMoveInto(p, 'c', 'a'));
  check('a out to a map of its own: yes', T.canMoveInto(p, 'a', null));
  check('d into main: yes', T.canMoveInto(p, 'd', 'main'));
  check('d into a: yes', T.canMoveInto(p, 'd', 'a'));
  check('e into its parent d again: yes', T.canMoveInto(p, 'e', 'd'));
  check('d into e (its own sub-map): no', !T.canMoveInto(p, 'd', 'e'));
  check('into an unknown map: no', !T.canMoveInto(p, 'a', 'nope'));
  check('the main map moves nowhere', !T.canMoveInto(p, 'main', null) && !T.canMoveInto(p, 'main', 'd'));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
