// Node test for the quest model (assets/js/views/quests/model.js).
// node tools/test_quests.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/quests/model.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`- ${t}`);

section('normalizeQuest');
{
  const q = Q.normalizeQuest({ title: '  The Shard  ', type: 'nope', status: 'weird', characters: 'Brakka, brakka , Lyra,', objectives: ['Find it', { text: 'Bring it back', done: 1 }, { id: 'o1', text: 'dup id' }], image: 'javascript:alert(1)' }, 'shard-ab12');
  eq('defaults', [q.id, q.title, q.type, q.status, q.parent], ['shard-ab12', 'The Shard', 'side', 'active', null]);
  eq('tags trimmed, deduplicated', q.characters, ['Brakka', 'Lyra']);
  eq('objectives get ids and booleans', q.objectives.map((o) => [o.id, o.text, o.done]), [['o1', 'Find it', false], ['o2', 'Bring it back', true], ['o1-2', 'dup id', false]]);
  eq('bad image dropped', q.image, null);
  eq('repo image kept', Q.normalizeQuest({ image: 'content/media/quests/a.jpg' }).image, 'content/media/quests/a.jpg');
  eq('https image kept', Q.normalizeQuest({ image: 'https://example.org/x.png' }).image, 'https://example.org/x.png');
  eq('path escape refused', Q.normalizeQuest({ image: 'content/../vault.json.png' }).image, null);
  eq('parent only for minor quests', [Q.normalizeQuest({ type: 'main', parent: 'x' }).parent, Q.normalizeQuest({ type: 'minor', parent: 'x' }).parent], [null, 'x']);
  eq('empty title', Q.normalizeQuest({ title: '   ' }).title, 'Untitled quest');
  eq('unknown fields kept', Q.normalizeQuest({ giver: 'Mira' }).giver, 'Mira');
  eq('order', [Q.normalizeQuest({ order: '2' }).order, Q.normalizeQuest({ order: null }).order, Q.normalizeQuest({}).order], [2, null, null]);
  const n = Q.newQuest({ id: 'x-1', title: 'New', type: 'minor', parent: 'm', by: 'QA', now: '2026-01-01T00:00:00Z' });
  eq('newQuest', [n.id, n.type, n.parent, n.createdBy, n.created, n.status], ['x-1', 'minor', 'm', 'QA', '2026-01-01T00:00:00Z', 'active']);
}

section('progress and filters');
{
  const q = Q.normalizeQuest({ title: 'Ember Road', characters: ['Sister Seraphine'], objectives: [{ text: 'Cross the Ashen Ford', done: true }, { text: 'Light the beacon' }], description: 'Óld road', rewards: '50 gp' });
  eq('progress', Q.progress(q), { done: 1, total: 2 });
  check('search in objectives', Q.questPasses(q, { q: 'beacon' }));
  check('search in characters', Q.questPasses(q, { q: 'seraphine' }));
  check('search folds accents', Q.questPasses(q, { q: 'old road' }));
  check('search in rewards', Q.questPasses(q, { q: '50 GP' }));
  check('all words must match', !Q.questPasses(q, { q: 'beacon dragon' }));
  check('active view hides finished', !Q.questPasses({ ...q, status: 'completed' }, { view: 'active' }));
  check('finished view shows failed', Q.questPasses({ ...q, status: 'failed' }, { view: 'done' }));
  check('finished view hides active', !Q.questPasses(q, { view: 'done' }));
}

section('questLog');
{
  const mk = (id, type, extra = {}) => Q.normalizeQuest({ id, title: id, type, created: `2026-01-0${extra.day || 1}`, ...extra });
  const all = [
    mk('side-b', 'side', { day: 2 }), mk('side-a', 'side', { day: 1 }), mk('side-done', 'side', { status: 'completed' }),
    mk('main-2', 'main', { day: 3 }), mk('main-1', 'main', { day: 1 }),
    mk('step-2a', 'minor', { parent: 'main-2' }), mk('step-1b', 'minor', { parent: 'main-1', day: 2 }), mk('step-1a', 'minor', { parent: 'main-1', day: 1 }),
    mk('loose', 'minor', { parent: 'gone' }), mk('to-side', 'minor', { parent: 'side-a' }),
  ];
  const log = Q.questLog(all, { view: 'active' });
  eq('branch order', log.map((b) => b.type), ['main', 'minor', 'side']);
  eq('main quests in story order', log[0].quests.map((x) => x.id), ['main-1', 'main-2']);
  eq('minor quests grouped under their main quest, unlinked last', log[1].groups.map((g) => [g.parent?.id || null, g.quests.map((x) => x.id)]),
    [['main-1', ['step-1a', 'step-1b']], ['main-2', ['step-2a']], [null, ['loose', 'to-side']]]);
  eq('active view hides the finished side quest', log[2].quests.map((x) => x.id), ['side-a', 'side-b']);
  const every = Q.questLog(all, { view: 'all' });
  eq('all view: active before finished', every[2].quests.map((x) => x.id), ['side-a', 'side-b', 'side-done']);
  eq('manual order wins', Q.questLog([mk('a', 'side'), mk('b', 'side', { order: 1 })], { view: 'all' })[2].quests.map((x) => x.id), ['b', 'a']);
  eq('empty branches kept', Q.questLog([], {}).map((b) => b.quests.length), [0, 0, 0]);
  eq('the open quest stays listed', Q.questLog(all, { view: 'active', keep: 'side-done' })[2].quests.map((x) => x.id), ['side-a', 'side-b', 'side-done']);
  eq('steps of a main quest', Q.stepsOf(all, 'main-1').map((x) => x.id), ['step-1a', 'step-1b']);
  eq('view counts', Q.viewCounts(all), { active: 9, done: 1, all: 10 });
  eq('find by id / title', [Q.findQuest(all, 'main-2')?.id, Q.findQuest(all, 'MAIN-1')?.id, Q.findQuest(all, 'nope'), Q.findQuest(all, '')], ['main-2', 'main-1', null, null]);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
