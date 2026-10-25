// Node test for linked places (assets/js/views/map/twins.js).
// node tools/test_twins.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/map/twins.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

const place = (id, more = {}) => ({ id, name: id, type: 'town', description: '', tags: [], map: 'main', x: 1, y: 2, rank: null, ...more });

{
  const a = place('a', { same: 'g1', name: 'Ravenhold', description: 'old', sharedAt: '2026-01-01T00:00:00Z', rank: 1 });
  const b = place('b', { same: 'g1', name: 'Ravenhold', description: 'new text', tags: ['port'], type: 'city', sharedAt: '2026-02-01T00:00:00Z', map: 'isle', x: 9 });
  const c = place('c');
  const lone = place('lone', { same: 'g2' });
  const groups = T.linkTwins([a, b, c, lone]);
  eq('one group of two', [...groups.keys()], ['g1']);
  eq('the last changed wins', [a.description, a.type, a.tags], ['new text', 'city', ['port']]);
  eq('own fields stay', [a.map, a.x, a.rank, b.map, b.x], ['main', 1, 1, 'isle', 9]);
  eq('twins', [a.twins, b.twins, c.twins, lone.twins], [['b'], ['a'], [], []]);
  a.tags.push('x');
  check('tags not shared by reference', b.tags.length === 1);
}
{
  const a = place('a', { same: 'g', description: 'A', updated: '2026-03-01' });
  const b = place('b', { same: 'g', description: 'B', created: '2026-01-01' });
  T.linkTwins([a, b]);
  eq('no sharedAt: updated / created decide', [a.description, b.description], ['A', 'A']);
  const x = place('x', { same: 'g', description: 'X', sharedAt: '2026-05-05' });
  const y = place('y', { same: 'g', description: 'Y', sharedAt: '2026-05-05' });
  T.linkTwins([x, y]);
  eq('a tie keeps the first', y.description, 'X');
}
{
  eq('sharedOf', T.sharedOf(place('p', { tags: ['a'], x: 5 })), { name: 'p', type: 'town', description: '', tags: ['a'] });
  check('sharedDiffer: description', T.sharedDiffer(place('p'), place('p', { description: 'd' })));
  check('sharedDiffer: position is not shared', !T.sharedDiffer(place('p'), place('p', { x: 99, rank: 2, map: 'm' })));
  check('sharedDiffer: tags', T.sharedDiffer(place('p', { tags: ['a'] }), place('p', { tags: ['a', 'b'] })));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
