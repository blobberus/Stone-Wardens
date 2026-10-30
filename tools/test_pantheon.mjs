// Node test for the pantheon model (assets/js/views/pantheon/model.js; docs/pantheon-model.md).
// node tools/test_pantheon.mjs   (no deps)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/pantheon/model.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const near = (a, b) => Math.abs(a - b) < 1e-6;

// the 14 aspects and their places
{
  eq('14 aspects', P.NODES.length, 14);
  eq('Equilibrium, not Stabilization', P.NODES.filter((n) => n.group === 'temporal').map((n) => n.name), ['Decay', 'Growth', 'Stasis', 'Equilibrium']);
  const pos = P.positions(1000);
  const at = (id) => pos.get(id);
  check('Metal upper right', at('material:metal').x > 500 && at('material:metal').y < 500, at('material:metal'));
  check('Water lower right', at('material:water').x > 500 && at('material:water').y > 500);
  check('Fire lower left', at('material:fire').x < 500 && at('material:fire').y > 500);
  check('Air upper left', at('material:air').x < 500 && at('material:air').y < 500);
  check('Decay upper right, Equilibrium upper left', at('temporal:decay').x > 500 && at('temporal:decay').y < 500 && at('temporal:equilibrium').x < 500 && at('temporal:equilibrium').y < 500);
  check('Strength at the hexagon upper right (-60°)', near(at('mental:strength').x, 500 + 255 * Math.cos(-Math.PI / 3)) && near(at('mental:strength').y, 500 + 255 * Math.sin(-Math.PI / 3)));
  check('Dexterity at 0°', near(at('mental:dexterity').x, 755) && near(at('mental:dexterity').y, 500));
  check('Material radius 0.43 W', near(Math.hypot(at('material:air').x - 500, at('material:air').y - 500), 430));
  check('Temporal radius 0.13 W', near(Math.hypot(at('temporal:stasis').x - 500, at('temporal:stasis').y - 500), 130));
}

// ranks
{
  const c = (...a) => P.classify(a);
  eq('absolute', c('temporal:decay').rank, 'absolute');
  eq('major', c('temporal:decay', 'mental:wisdom').rank, 'major');
  eq('minor', c('mental:strength', 'temporal:growth', 'mental:intelligence').rank, 'minor');
  eq('lesser', c('temporal:equilibrium', 'mental:constitution', 'mental:intelligence', 'material:metal').rank, 'lesser');
  eq('angel', c('temporal:equilibrium', 'mental:constitution', 'mental:intelligence', 'material:metal', 'material:water').rank, 'angel');
  eq('order does not matter', c('mental:intelligence', 'mental:strength', 'temporal:stasis').id, c('temporal:stasis', 'mental:strength', 'mental:intelligence').id);
  eq('the guide\'s id', c('temporal:equilibrium', 'material:metal', 'mental:intelligence', 'mental:constitution').id, 'material:metal|mental:constitution|mental:intelligence|temporal:equilibrium');
  eq('reading order', c('material:metal', 'mental:intelligence', 'temporal:equilibrium', 'mental:constitution').aspects, ['temporal:equilibrium', 'mental:constitution', 'mental:intelligence', 'material:metal']);
  for (const [name, a] of [
    ['nothing', []], ['Material + Temporal is not a Major God', ['temporal:decay', 'material:fire']],
    ['one Mental alone', ['mental:wisdom']], ['one Material alone', ['material:air']],
    ['two Temporal', ['temporal:decay', 'temporal:growth']], ['three Mental', ['temporal:decay', 'mental:strength', 'mental:wisdom', 'mental:charisma']],
    ['Material with one Mental', ['temporal:decay', 'mental:strength', 'material:air']], ['three Material', ['temporal:decay', 'mental:strength', 'mental:wisdom', 'material:air', 'material:fire', 'material:water']],
    ['a duplicate', ['temporal:decay', 'temporal:decay']], ['unknown', ['temporal:stabilization']],
  ]) {
    const r = P.classify(a);
    check(`invalid: ${name}`, !r.ok && typeof r.reason === 'string' && r.reason.length > 10, r);
  }
}

// the catalog
{
  const all = P.catalog();
  const n = (rank) => all.filter((x) => x.rank === rank).length;
  eq('counts', [n('absolute'), n('major'), n('minor'), n('lesser'), n('angel')], [4, 24, 60, 240, 360]);
  eq('688 in all', all.length, 688);
  eq('POSSIBLE', P.POSSIBLE, 688);
  eq('ids unique', new Set(all.map((x) => x.id)).size, 688);
  check('every catalog entry classifies to itself', all.every((x) => { const r = P.classify(x.aspects); return r.ok && r.id === x.id && r.rank === x.rank; }));
  eq('possible per rank', P.RANKS.map((r) => r.possible), [4, 24, 60, 240, 360]);
}

// the chain (the guide's example Angel)
{
  const angel = ['temporal:equilibrium', 'mental:constitution', 'mental:intelligence', 'material:metal', 'material:water'];
  const parts = P.constituents(angel);
  const names = (rank) => parts.filter((x) => x.rank === rank).map((x) => P.aspectNames(x.aspects));
  eq('two Lesser', names('lesser'), ['Equilibrium + Constitution + Intelligence + Metal', 'Equilibrium + Constitution + Intelligence + Water']);
  eq('one Minor', names('minor'), ['Equilibrium + Constitution + Intelligence']);
  eq('two Major', names('major'), ['Equilibrium + Constitution', 'Equilibrium + Intelligence']);
  eq('one Absolute', names('absolute'), ['Equilibrium']);
  eq('an Absolute God is in 1 + 6 + 15 + 60 + 90 higher combinations', P.containers(['temporal:decay']).length, 6 + 15 + 60 + 90);
  eq('aspect line', P.aspectLine(['material:metal', 'mental:intelligence', 'temporal:equilibrium', 'mental:constitution']), 'Temporal — Equilibrium; Mental — Constitution, Intelligence; Material — Metal');
}

// picking points
{
  let s = [];
  s = P.pick(s, 'temporal:decay');
  s = P.pick(s, 'temporal:growth');
  eq('a second Temporal replaces the first', s, ['temporal:growth']);
  s = P.pick(s, 'mental:strength'); s = P.pick(s, 'mental:wisdom'); s = P.pick(s, 'mental:charisma');
  eq('a third Mental replaces the earliest', s, ['temporal:growth', 'mental:wisdom', 'mental:charisma']);
  s = P.pick(s, 'mental:wisdom');
  eq('picked again = dropped', s, ['temporal:growth', 'mental:charisma']);
  eq('slots', P.slotsOf(['material:air', 'mental:charisma', 'temporal:growth', 'mental:strength']), { t: 'temporal:growth', m1: 'mental:strength', m2: 'mental:charisma', a1: 'material:air', a2: '' });
  eq('slots for Minor', P.slotsFor('minor').map((x) => x.key), ['t', 'm1', 'm2']);
  eq('slot aspects follow the shown selectors', P.slotAspects({ t: 'temporal:decay', m1: 'mental:strength', m2: '', a1: 'material:air', a2: '' }, 'major'), ['temporal:decay', 'mental:strength']);
  eq('stage for a filled Material 1', P.stageFor({ t: '', m1: '', m2: '', a1: 'material:air', a2: '' }), 'lesser');
  eq('stage for nothing', P.stageFor({ t: '', m1: '', m2: '', a1: '', a2: '' }), 'absolute');
}

// saved beings
{
  const b = P.normalizeBeing({ aspects: ['mental:constitution', 'temporal:stabilization'], title: '  Pulse ', domains: 'Recovery', rank: 'angel' }, 'pulse-a1b2');
  eq('old name migrated, rank recomputed', [b.aspects, b.rank, b.title, b.domains, b.worship], [['temporal:equilibrium', 'mental:constitution'], 'major', 'Pulse', ['Recovery'], '']);
  const bad = P.normalizeBeing({ aspects: ['material:fire'], title: 'Odd' }, 'odd');
  check('an invalid being is flagged', bad.invalid && bad.rank === null);
  const doc = P.beingDoc({ aspects: ['temporal:decay'], title: 'Rot', domains: 'Ruin\n\n  Release ', description: 'One.\n\nTwo.', worship: '' }, { by: 'Kim', now: 'T' });
  eq('doc keeps all six', [doc.aspects, doc.rank, doc.title, doc.domains, doc.description, doc.worship, doc.by, doc.created, doc.updated], [['temporal:decay'], 'absolute', 'Rot', ['Ruin', 'Release'], 'One.\n\nTwo.', '', 'Kim', 'T', 'T']);
  const beings = [
    P.normalizeBeing({ aspects: ['temporal:decay'], title: 'Zeta', created: '2' }, 'z'),
    P.normalizeBeing({ aspects: ['temporal:decay'], title: 'Alpha', created: '3' }, 'a'),
    P.normalizeBeing({ aspects: ['temporal:decay', 'mental:wisdom'], title: 'Moss', created: '1' }, 'm'),
    bad,
  ];
  const r = P.roster(beings);
  eq('roster by rank, then title', r.map((g) => [g.rank?.id ?? null, g.beings.map((x) => x.title)]), [['absolute', ['Alpha', 'Zeta']], ['major', ['Moss']], ['minor', []], ['lesser', []], ['angel', []], [null, ['Odd']]]);
  eq('the later twin is flagged', r[0].beings.map((x) => x.twin), ['z', null]);
  eq('occupant = the earliest', P.occupants(beings).get('temporal:decay').title, 'Zeta');
  eq('find by title', P.findBeing(beings, 'moss')?.file, 'm');
  eq('find by aspect names', P.findBeing(beings, 'Wisdom + Decay')?.file, 'm');
}

// geometry helpers
{
  const pts = [{ id: 'b', x: 0, y: 0 }, { id: 'a', x: 10, y: 10 }, { id: 'c', x: 10, y: 0 }, { id: 'd', x: 0, y: 10 }];
  eq('outline: by angle round the centroid', P.outline(pts).map((p) => p.id), ['b', 'c', 'a', 'd']);
  eq('outline: the same for any order', P.outline(pts.slice().reverse()).map((p) => p.id), ['b', 'c', 'a', 'd']);
  const five = P.sigilPoints(['material:water', 'temporal:growth', 'mental:wisdom', 'material:air', 'mental:strength'], 1000);
  eq('sigil: Temporal first', five.map((p) => p.id), ['temporal:growth', 'mental:strength', 'mental:wisdom', 'material:water', 'material:air']);
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  check('sigil: a regular pentagon', [0, 1, 2, 3, 4].every((i) => near(d(five[i], five[(i + 1) % 5]), d(five[0], five[1]))));
  const tri = P.sigilPoints(['temporal:decay', 'mental:strength', 'mental:wisdom']);
  check('sigil: an equilateral triangle', near(d(tri[0], tri[1]), d(tri[1], tri[2])) && near(d(tri[1], tri[2]), d(tri[2], tri[0])));
  const rect = P.sigilPoints(['temporal:decay', 'mental:strength', 'mental:wisdom', 'material:fire']);
  check('sigil: a rectangle', near(rect[0].y, rect[1].y) && near(rect[1].x, rect[2].x) && near(rect[2].y, rect[3].y) && near(rect[3].x, rect[0].x) && !near(d(rect[0], rect[1]), d(rect[1], rect[2])));
}

// export / import
{
  const beings = P.EXAMPLES.map((x, i) => P.normalizeBeing(x, `ex-${i}`));
  eq('the examples: one per rank', beings.map((b) => b.rank), ['absolute', 'major', 'minor', 'lesser', 'angel']);
  const doc = P.exportDoc(beings, { view: 'original' });
  eq('v4 doc', [doc.version, doc.groups.length, doc.nodes.length, doc.gods.length, doc.viewState.view], [4, 3, 14, 5, 'original']);
  const back = P.parseImport(JSON.parse(JSON.stringify(doc)));
  check('round trip ok', back.ok, back.errors);
  eq('round trip keeps every field', back.beings.map((b) => [b.id, b.title, b.domains, b.description, b.worship]), doc.gods.map((g) => [g.id, g.title, g.domains, g.description, g.worship]));
  const v3 = P.parseImport({ version: 3, gods: [
    { id: 'x', powers: ['temporal:stabilization', 'mental:wisdom'], rank: 'major', name: 'Old Keeper', domain: 'Sleep, dreams', charge: 'Keeps.' },
  ] });
  check('v3 ok', v3.ok, v3.errors);
  eq('v3 migrated', v3.beings[0], { aspects: ['temporal:equilibrium', 'mental:wisdom'], rank: 'major', id: 'mental:wisdom|temporal:equilibrium', title: 'Old Keeper', domains: ['Sleep, dreams'], description: 'Keeps.', worship: '' });
  check('v3 noted', v3.notes.some((n) => /version 3/.test(n)), v3.notes);
  const dup = P.parseImport({ version: 4, gods: [
    { aspects: ['temporal:decay', 'mental:wisdom'], title: 'A' }, { aspects: ['mental:wisdom', 'temporal:decay'], title: 'B' },
  ] });
  check('duplicates refused', !dup.ok && dup.errors.some((e) => /same aspects/.test(e)), dup.errors);
  const bad = P.parseImport({ version: 4, gods: [{ aspects: ['temporal:decay', 'material:fire'], title: 'C' }, { aspects: ['temporal:decay'] }] });
  check('invalid and untitled refused', !bad.ok && bad.errors.length === 2, bad.errors);
  const wrong = P.parseImport({ version: 4, gods: [{ aspects: ['temporal:decay'], title: 'D', rank: 'angel' }] });
  check('a contradicting rank is recomputed', wrong.ok && wrong.beings[0].rank === 'absolute' && wrong.notes.length === 1, wrong);
  check('no list', !P.parseImport({ hello: 1 }).ok);
  check('empty list', !P.parseImport({ gods: [] }).ok);
  const md = P.rosterMarkdown(beings);
  check('markdown: rank headings', /# Absolute Gods[\s\S]*# Major Gods[\s\S]*# Angels/.test(md));
  check('markdown: template lines', md.includes('- **Aspects:** Temporal — Equilibrium; Mental — Constitution, Intelligence; Material — Metal\n- **Rank:** Lesser God\n- **Title:** The Tempered Mind\n- **Domains:** Mental stamina; Resilient craft; Disciplined invention'));
  const para = P.rosterMarkdown([P.normalizeBeing({ aspects: ['temporal:decay'], title: 'P', description: 'One.\n\nTwo.' }, 'p')]);
  check('markdown: paragraphs kept', para.includes('### Description\nOne.\n\nTwo.'), para);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
