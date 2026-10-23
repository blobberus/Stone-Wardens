// Node test for the DM's party view (no deps): node tools/test_party.mjs
// party-model.js (cards on sheets derived by the real engine, grid fitting, the sealed party doc's shape) and the live
// channel's message format (core/live.js: gzip + AES-GCM round trip, keys, versions).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
// core/live.js imports the store and settings, which look for browser storage when used (not when loaded)
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage ??= globalThis.localStorage;
const E = await mod('assets/js/views/characters/engine.js');
const M = await mod('assets/js/views/dm/party-model.js');
const L = await mod('assets/js/core/live.js');
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'srd', `${name}.json`), 'utf8'));
const rules = E.buildRules({
  classes: load('classes'), features: load('features'), subclasses: load('subclasses'), species: load('species'),
  backgrounds: load('backgrounds'), feats: load('feats'), spells: load('spells'), weapons: load('weapons'), armor: load('armor'),
  gear: load('gear'), magicItems: load('magic-items'), rules: load('rules'),
  stubs: { subclasses: load('stubs/subclasses'), species: load('stubs/species'), backgrounds: load('stubs/backgrounds'), feats: load('stubs/feats') },
  custom: {},
});

let passed = 0;
const failures = [];
const check = (name, cond, detail) => { if (cond) passed += 1; else failures.push(`${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`); };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });
const section = (t) => console.log(`- ${t}`);

const ABILITIES = [
  { id: 'str', name: 'STR', full: 'Strength' }, { id: 'dex', name: 'DEX', full: 'Dexterity' }, { id: 'con', name: 'CON', full: 'Constitution' },
  { id: 'int', name: 'INT', full: 'Intelligence' }, { id: 'wis', name: 'WIS', full: 'Wisdom' }, { id: 'cha', name: 'CHA', full: 'Charisma' },
];
const conditions = rules.core?.conditions || load('rules').conditions || [];
const inv = (uid, kind, ref, extra = {}) => ({ uid, kind, ref, qty: 1, equipped: false, attuned: false, notes: '', custom: null, ...extra });
const fighter = {
  ...E.newCharacter({ name: 'Brakka Stonefist', player: 'Mira' }), id: 'brakka-ab12',
  species: { id: 'dwarf', subspecies: null, size: null }, background: { id: 'soldier', abilityBonuses: { str: 2, con: 1 } },
  classes: [{ id: 'fighter', level: 3, subclass: 'champion', hp: [10, 6, 7] }],
  baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  inventory: [inv('a1', 'armor', 'chain-mail', { equipped: true }), inv('a2', 'armor', 'shield', { equipped: true })],
  hp: { current: 20, temp: 4 }, conditions: ['poisoned', 'exhaustion'], exhaustion: 2, heroicInspiration: true,
  style: { accent: '#225577' }, updated: '2026-10-23T10:00:00.000Z',
};
const card = (c) => M.partyCard(c, E.derive(c, rules), { conditions, abilities: ABILITIES });

// ------------------------------------------------------------------------------------------------
section('partyCard: who, hit points, AC, passive Perception, abilities');
{
  const s = E.derive(fighter, rules);
  const m = card(fighter);
  eq('id / name / player', [m.id, m.name, m.player], ['brakka-ab12', 'Brakka Stonefist', 'Mira']);
  eq('line is the class line', m.line, s.classLine);
  eq('level', m.level, 3);
  eq('accent', m.accent, '#225577');
  eq('updated', m.updated, '2026-10-23T10:00:00.000Z');
  eq('hp current / max / temp', [m.hp.cur, m.hp.max, m.hp.temp], [20, s.hpMax, 4]);
  eq('hp pct', m.hp.pct, Math.round((20 / s.hpMax) * 100));
  check('hp state ok or mid', ['ok', 'mid'].includes(m.hp.state), m.hp.state);
  eq('AC = sheet AC (chain mail + shield = 18)', m.ac.value, 18);
  eq('AC not adjusted', m.ac.base, null);
  eq('passive = sheet passive', m.passive.value, s.passive.perception);
  check('passive adjusted (Poisoned, Exhaustion)', m.passive.base != null && m.passive.base > m.passive.value, m.passive);
  check('passive says why', /Exhaustion|Poisoned/.test(m.passive.why), m.passive.why);
  eq('six abilities in order', m.abilities.map((a) => a.label), ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
  eq('STR score / mod (15 + 2)', [m.abilities[0].value, m.abilities[0].mod], [17, 3]);
  eq('CON score (14 + 1)', m.abilities[2].value, 15);
  eq('ability full name', m.abilities[4].full, 'Wisdom');
}

section('partyCard: conditions and effects');
{
  const m = card(fighter);
  eq('effects: condition, exhaustion level, inspiration (exhaustion condition id folded in)', m.effects.map((x) => [x.kind, x.label]),
    [['condition', 'Poisoned'], ['exhaustion', 'Exhaustion 2'], ['inspiration', 'Heroic Inspiration']]);
  check('condition tooltip from the rules text', m.effects[0].title.length > 20 && m.effects[0].title.length <= 320, m.effects[0].title);
  check('exhaustion tooltip has the penalties', /−4 to every D20 Test, Speed −10 ft/.test(m.effects[1].title), m.effects[1].title);
  const none = card({ ...fighter, conditions: [], exhaustion: 0, heroicInspiration: false });
  eq('no effects', none.effects, []);
  const odd = card({ ...fighter, conditions: ['made-up-thing'], exhaustion: 9, heroicInspiration: false });
  eq('unknown condition id prettified, exhaustion capped at 6', odd.effects.map((x) => x.label), ['Made up thing', 'Exhaustion 6']);
}

section('partyCard: hit point states');
{
  const max = card(fighter).hp.max;
  eq('null current = full', card({ ...fighter, hp: { current: null, temp: 0 } }).hp.cur, max);
  eq('low', card({ ...fighter, hp: { current: Math.floor(max / 5), temp: 0 } }).hp.state, 'low');
  eq('dying at 0', card({ ...fighter, hp: { current: 0, temp: 0 }, deathSaves: { success: 1, fail: 1 } }).hp.state, 'dying');
  eq('stable with three successes', card({ ...fighter, hp: { current: 0, temp: 0 }, deathSaves: { success: 3, fail: 1 } }).hp.state, 'stable');
  eq('dead with three failures', card({ ...fighter, hp: { current: 0, temp: 0 }, deathSaves: { success: 0, fail: 3 } }).hp.state, 'dead');
  eq('death saves clamped', card({ ...fighter, hp: { current: 0, temp: 0 }, deathSaves: { success: 7, fail: -2 } }).hp.deathSaves, { success: 3, fail: 0 });
  eq('negative current shows 0', card({ ...fighter, hp: { current: -5, temp: 0 } }).hp.cur, 0);
  eq('hpState thresholds', [M.hpState(30, 30), M.hpState(15, 30), M.hpState(7, 30), M.hpState(0, 30)], ['ok', 'mid', 'low', 'dying']);
  eq('no max: ok', M.hpState(0, 0), 'ok');
  const blank = E.newCharacter({ name: '' });
  const b = M.partyCard({ ...blank, id: 'x' }, E.derive(blank, rules), { conditions, abilities: ABILITIES });
  eq('a blank sheet: Unnamed, No class yet', [b.name, b.line], ['Unnamed', 'No class yet']);
}

section('normalizeParty');
{
  eq('nothing', M.normalizeParty(null), { v: 1, notes: {}, omit: [] });
  eq('keeps notes and omit', M.normalizeParty({ notes: { a: 'Owes 50 gp', b: '' , c: '   ', d: 5 }, omit: ['x', 'x', 3, '', 'y'], extra: 1 }),
    { v: 1, notes: { a: 'Owes 50 gp' }, omit: ['x', 'y'] });
  eq('bad shapes', M.normalizeParty({ notes: 'no', omit: 'no' }), { v: 1, notes: {}, omit: [] });
}

section('fitGrid');
{
  const g6 = M.fitGrid(6, 1100, 700);
  eq('6 in a laptop view: 3 × 2, tall, fit', [g6.cols, g6.rows, g6.shape, g6.fit], [3, 2, 'tall', true]);
  check('6 in a laptop view: scale over 1', g6.scale > 1, g6.scale);
  const pane = M.fitGrid(6, 930, 470);
  eq('6 in a DM Screen quarter pane: 3 × 2', [pane.cols, pane.rows, pane.fit], [3, 2, true]);
  check('quarter pane scale ~0.85-1', pane.scale >= 0.85 && pane.scale <= 1.05, pane.scale);
  const tallPane = M.fitGrid(6, 640, 1000);
  check('6 in a tall pane: 2 × 3 tall or a column of wide cards, at full size', tallPane.fit && tallPane.scale >= 1
    && ((tallPane.cols === 2 && tallPane.shape === 'tall') || (tallPane.cols === 1 && tallPane.shape === 'wide')), tallPane);
  const narrowPane = M.fitGrid(6, 640, 760);
  eq('6 in a squarish pane: 2 × 3 tall', [narrowPane.cols, narrowPane.rows, narrowPane.shape, narrowPane.fit], [2, 3, 'tall', true]);
  const wide = M.fitGrid(2, 1200, 200);
  eq('2 in a short wide strip: side by side, wide cards', [wide.cols, wide.rows, wide.shape, wide.fit], [2, 1, 'wide', true]);
  const strip = M.fitGrid(4, 1800, 260);
  eq('4 in a long strip: one row', [strip.cols, strip.rows], [4, 1]);
  const phone = M.fitGrid(6, 370, 700);
  eq('6 on a phone: scroll, one column, scale 1', [phone.cols, phone.fit, phone.scale, phone.shape], [1, false, 1, 'tall']);
  const roomy = M.fitGrid(12, 1000, 600);
  eq('12 in a laptop view still fit, 4 × 3', [roomy.cols, roomy.rows, roomy.fit], [4, 3, true]);
  const many = M.fitGrid(12, 900, 500);
  eq('12 in a smaller view: scroll', many.fit, false);
  check('12: several columns', many.cols >= 3, many.cols);
  eq('one card in a huge view: capped scale', M.fitGrid(1, 3000, 2000).scale, M.MAX_SCALE);
  eq('none', M.fitGrid(0, 800, 600), { cols: 1, rows: 0, shape: 'tall', scale: 1, fit: true });
  const five = M.fitGrid(5, 1100, 700);
  eq('5 in a laptop view: 3 × 2 (one hole)', [five.cols, five.rows], [3, 2]);
  check('every fit is at least MIN_SCALE', [g6, pane, tallPane, narrowPane, wide, strip, five, roomy].every((g) => g.scale >= M.MIN_SCALE));
}

section('live channel: sealed, gzip\'d messages');
{
  const room = await L.roomKeys('github_pat_example_not_a_real_token');
  const again = await L.roomKeys('github_pat_example_not_a_real_token');
  const other = await L.roomKeys('another-token');
  eq('room id: 32 hex chars', /^[0-9a-f]{32}$/.test(room.id), true);
  eq('same secret, same room', room.id, again.id);
  check('other secret, other room', room.id !== other.id);
  check('room id is not the secret', !room.id.includes('github'));
  L._test.S.room = room;
  const env = { k: L._test.keyOf('content/characters/brakka-ab12.json'), t: [1790000000000, 'abc'], by: 'Mira', d: { path: 'content/characters/brakka-ab12.json', updated: fighter.updated, data: fighter } };
  const bytes = await L._test.pack(env);
  check('sealed bytes do not contain the text', !Buffer.from(bytes).toString('latin1').includes('Brakka'));
  check('compressed (smaller than the JSON)', bytes.length < JSON.stringify(env).length, [bytes.length, JSON.stringify(env).length]);
  eq('round trip', await L._test.unpack(bytes), env);
  L._test.S.room = other;
  let failed = false;
  try { await L._test.unpack(bytes); } catch { failed = true; }
  eq('another room cannot open it', failed, true);
  L._test.S.room = room;
  const tampered = bytes.slice(); tampered[tampered.length - 3] ^= 1;
  failed = false;
  try { await L._test.unpack(tampered); } catch { failed = true; }
  eq('tampered bytes are refused', failed, true);
  eq('key: one topic level', /[/#+]/.test(L._test.keyOf('content/characters/a+b#c.json')), false);
  eq('newer: later ms wins', L._test.newer([2, 'a'], [1, 'z']), true);
  eq('newer: tie broken by client id', [L._test.newer([1, 'b'], [1, 'a']), L._test.newer([1, 'a'], [1, 'b'])], [true, false]);
  eq('newer: anything beats nothing', L._test.newer([1, 'a'], undefined), true);
  L._test.S.room = null;
}

// ------------------------------------------------------------------------------------------------
if (failures.length) {
  console.log(`\n${failures.length} FAILED, ${passed} passed:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nAll ${passed} party view tests passed.`);
