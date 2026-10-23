// Node test for the character printouts (no deps): node tools/test_print.mjs
// print-model.js on sheets derived by the real engine, pdfText, and both PDFs rendered with the vendored jsPDF.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const E = await mod('assets/js/views/characters/engine.js');
const P = await mod('assets/js/views/characters/print-model.js');
const PDF = await mod('assets/js/views/characters/print-pdf.js');
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

const MAPS = { spell: 'spellById', class: 'classById', subclass: 'subclassById', species: 'speciesById', background: 'backgroundById',
  weapon: 'weaponById', armor: 'armorById', gear: 'gearById', 'magic-item': 'magicItemById' };
const findEntry = (kind, id) => (id && MAPS[kind] ? rules[MAPS[kind]]?.[id] || null : null);
const lib = {
  findEntry, entryName: (kind, id) => findEntry(kind, id)?.name || id,
  skillList: () => rules.core?.skills || [],
  conditionName: (id) => (rules.core?.conditions || []).find((x) => x.id === id)?.name || id,
  detailFields: [{ key: 'alignment', label: 'Alignment' }, { key: 'age', label: 'Age' }, { key: 'backstory', label: 'Backstory', long: true }],
};
const inv = (uid, kind, ref, extra = {}) => ({ uid, kind, ref, qty: 1, equipped: false, attuned: false, notes: '', custom: null, ...extra });

const fighter = {
  ...E.newCharacter({ name: 'Brakka Stonefist', player: 'Mira' }),
  species: { id: 'dwarf', subspecies: null, size: null }, background: { id: 'soldier', abilityBonuses: { str: 2, con: 1 } },
  classes: [{ id: 'fighter', level: 3, subclass: 'champion', hp: [10, 6, 7] }],
  baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  inventory: [inv('w1', 'weapon', 'longsword', { equipped: true }), inv('a1', 'armor', 'chain-mail', { equipped: true }), inv('a2', 'armor', 'shield', { equipped: true }),
    inv('g1', 'gear', 'rope-hempen-50-feet', { qty: 2, notes: 'For the **cliffs** near [[map:Brinewick|the harbor]]' })],
  currency: { cp: 5, sp: 10, ep: 0, gp: 42, pp: 1 },
  hp: { current: 20, temp: 4 }, conditions: ['poisoned'], exhaustion: 1, heroicInspiration: true, xp: 1000,
  details: { alignment: 'lawful-good', age: '120', backstory: 'A long story that never prints.' },
};
const wizard = {
  ...E.newCharacter({ name: 'Ilsa Vey', player: 'Tom' }),
  species: { id: 'human', subspecies: null, size: null }, background: { id: 'sage', abilityBonuses: { int: 2, wis: 1 } },
  classes: [{ id: 'wizard', level: 3, subclass: null, hp: [6, 4, 4] }],
  baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  spells: [{ id: 'fire-bolt', class: 'wizard', prepared: true }, { id: 'magic-missile', class: 'wizard', prepared: true }, { id: 'shield', class: 'wizard', prepared: false },
    { id: 'detect-magic', class: 'wizard', prepared: true }],
  slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
};

// ------------------------------------------------------------------------------------------------
section('vision words');
eq('no senses: Normal, no darkvision', P.visionOf({ sensesList: [] }), { dark: null, vision: 'Normal' });
eq('darkvision from the list', P.visionOf({ sensesList: ['Darkvision 60 ft.'] }), { dark: 60, vision: 'Normal' });
eq('other senses named', P.visionOf({ sensesList: ['Darkvision 120 ft.', 'Blindsight 10 ft.'], darkvision: 60 }), { dark: 120, vision: 'Blindsight 10 ft' });
check('normal sight distance is a short label', P.NORMAL_SIGHT === '2 mi');

section('plain text');
eq('links and emphasis', P.plain('See [[map:Old Mill]] and [[note:Ana|Ana B]], **bold** and ==hi==.'), 'See Old Mill and Ana B, bold and hi.');
eq('cut on a word', P.plain('one two three four five', 12), 'one two…');

section('Major points: the stats that rarely change');
{
  const calm = E.derive({ ...fighter, conditions: [], exhaustion: 0 }, rules);
  const m = P.printModel(fighter, calm, lib, { kind: 'major', date: new Date('2026-10-23T12:00:00Z'), link: 'https://example.test/#/characters/x' });
  eq('title', m.title, 'Major points');
  check('line has level, species, class, background', /Level 3/.test(m.line) && /Dwarf/.test(m.line) && /Fighter 3/.test(m.line) && /Soldier/.test(m.line), m.line);
  eq('meta: player and alignment', m.meta, 'Player: Mira · Lawful Good');
  eq('eight core boxes', m.core.map((x) => x.label), ['Armor Class', 'Initiative', 'Speed', 'Proficiency', 'Hit Point Max', 'Hit Dice', 'Passive Perception', 'Darkvision']);
  eq('AC with chain mail and shield', m.core[0].value, '18');
  check('AC sub names the armor', /Chain Mail/.test(m.core[0].sub) && /Shield/.test(m.core[0].sub), m.core[0].sub);
  eq('HP max only', m.core[4].value, String(calm.hpMax));
  eq('hit dice', m.core[5].value, '3d10');
  eq('darkvision 120 (2024 dwarf)', m.core[7].value, '120 ft');
  eq('speed without exhaustion', m.core[2].value, '30 ft');
  eq('six abilities', m.abilities.map((a) => a.name), ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
  check('STR save proficient (fighter)', m.abilities[0].saveProf && m.abilities[0].save === '+5', m.abilities[0]);
  eq('18 skills', m.skills.length, 18);
  check('athletics proficient (soldier)', m.skills.find((x) => x.id === 'athletics')?.level === 'proficient');
  check('perception passive in the core boxes', m.core[6].value === String(calm.passive.perception));
  check('proficiencies list armor', m.profs[0][0] === 'Armor' && /Heavy/.test(m.profs[0][1]), m.profs[0]);
  check('longsword attack', m.attacks.some((a) => a.name === 'Longsword' && /Slashing/.test(a.damage)), m.attacks);
  check('features grouped, class first', m.features[0].title === 'Fighter features' && m.features[0].items.some((f) => f.name === 'Second Wind'), m.features.map((g) => g.title));
  check('Second Wind uses as a max', m.features[0].items.find((f) => f.name === 'Second Wind')?.note.includes('/ Short Rest') || m.features[0].items.find((f) => f.name === 'Second Wind')?.note.includes('/ Long Rest'), m.features[0].items.find((f) => f.name === 'Second Wind'));
  check('no inventory, coins or state', !m.inventory && !m.coins && !m.state && !m.resources);
  check('no spellcasting for a champion', m.casting === null);
  eq('footer', m.footer, 'Brakka Stonefist · Major points · printed 23 Oct 2026');
}

section('Detailed sheet: how things stand now');
{
  const now = E.derive(fighter, rules);
  const m = P.printModel(fighter, now, lib, { kind: 'full' });
  eq('title', m.title, 'Detailed sheet');
  eq('current HP box', m.core[4], { label: 'Hit Points', value: `20 / ${now.hpMax}`, sub: '+4 temporary' });
  eq('speed with exhaustion 1', m.core[2].value, '25 ft');
  eq('state: conditions', m.state.conditions, ['Poisoned']);
  check('state: exhaustion, inspiration, xp', m.state.exhaustion === 1 && m.state.inspiration && m.state.xp.now === 1000, m.state);
  eq('inventory rows', m.inventory.rows.map((x) => x.name), ['Longsword', 'Chain Mail', 'Shield', 'Rope, Hempen (50 feet)'].map((n, i) => m.inventory.rows[i]?.name || n));
  const sword = m.inventory.rows[0];
  check('longsword stats', /1d8 Slashing/.test(sword.stats) && /two-handed 1d10/.test(sword.stats) && sword.equipped === true && sword.attuned === null, sword);
  check('chain mail AC', /AC 16/.test(m.inventory.rows[1].stats) && /Str 13/.test(m.inventory.rows[1].stats), m.inventory.rows[1].stats);
  check('shield AC +2', /AC \+2/.test(m.inventory.rows[2].stats), m.inventory.rows[2].stats);
  check('rope: qty 2, no equip box, plain notes', m.inventory.rows[3].qty === 2 && m.inventory.rows[3].equipped === null && m.inventory.rows[3].notes === 'For the cliffs near the harbor', m.inventory.rows[3]);
  check('carried weight', m.inventory.carried > 0, m.inventory.carried);
  eq('coins', m.coins.map((x) => `${x.id} ${x.value}`), ['CP 5', 'SP 10', 'EP 0', 'GP 42', 'PP 1']);
  eq('coins in gp', m.coinsGp, 53.05);
  check('resources with uses left', m.resources.some((r) => /Second Wind/.test(r.label) && /of/.test(`${r.left} of ${r.max}`)), m.resources);
  eq('details: short fields only', m.details, [['Species', 'Dwarf'], ['Background', 'Soldier'], ['Alignment', 'Lawful Good'], ['Age', '120']]);
}

section('spellcasting');
{
  const s = E.derive(wizard, rules);
  const major = P.printModel(wizard, s, lib, { kind: 'major' });
  const full = P.printModel(wizard, s, lib, { kind: 'full' });
  check('caster line', major.casting.casters[0]?.name === 'Wizard' && major.casting.casters[0].ability === 'INT' && major.casting.casters[0].dc === s.spellcasting[0].dc, major.casting.casters);
  eq('slot maxima (level 3 wizard)', major.casting.slots.map((x) => [x.level, x.max]), [[1, 4], [2, 2]]);
  eq('slots left on the detailed sheet', full.casting.slots.map((x) => x.left), [3, 2]);
  check('spell names by level', major.casting.lines[0].label === 'Cantrips' && /Fire Bolt/.test(major.casting.lines[0].names), major.casting.lines);
  check('ritual marked', major.casting.lines.some((l) => /Detect Magic \(C\) \(R\)/.test(l.names)), major.casting.lines);
  const bolt = full.casting.spells.find((x) => x.id === 'fire-bolt');
  check('fire bolt row: action, 120 ft, to hit, 1d10 fire', bolt.time === 'Action' && /120/.test(bolt.range) && /hit/.test(bolt.hit) && /1d10 Fire/.test(bolt.effect), bolt);
  const shield = full.casting.spells.find((x) => x.id === 'shield');
  check('unprepared spellbook spell', shield && shield.ready === false, shield);
  check('magic missile 3 darts', /3 ×/.test(full.casting.spells.find((x) => x.id === 'magic-missile')?.effect || ''), full.casting.spells.find((x) => x.id === 'magic-missile'));
}

section('pdfText (WinAnsi)');
eq('typography kept', PDF.pdfText('It’s “here” – now… • ok'), 'It’s “here” – now… • ok');
eq('minus and approx swapped', PDF.pdfText('−2 ≈ 3 → x'), '-2 ~ 3 -> x');
eq('accents kept, others dropped or stripped', PDF.pdfText('Élan Ŵyn 龍'), 'Élan Wyn ');

section('PDF rendering (vendored jsPDF)');
{
  const require = createRequire(import.meta.url);
  let jsPDF = null;
  try { jsPDF = require(path.join(ROOT, 'vendor/jspdf/jspdf.umd.min.js')).jsPDF; } catch (e) { failures.push(`jsPDF loads in Node -> ${e.message}`); }
  if (jsPDF) {
    for (const [label, char, kind] of [['fighter major', fighter, 'major'], ['fighter full', fighter, 'full'], ['wizard full', wizard, 'full'], ['blank major', E.newCharacter({ name: '' }), 'major']]) {
      const sheet = E.derive(char, rules);
      const m = P.printModel(char, sheet, lib, { kind, link: 'https://example.test/#/characters/x' });
      for (const gray of [false, true]) {
        try {
          const doc = PDF.renderSheet(jsPDF, m, { accent: '#22507c', gray });
          const out = doc.output('arraybuffer');
          check(`${label}${gray ? ' gray' : ''}: a PDF`, out.byteLength > 2000 && new TextDecoder().decode(out.slice(0, 5)) === '%PDF-', out.byteLength);
          check(`${label}${gray ? ' gray' : ''}: pages`, doc.getNumberOfPages() >= 1 && doc.getNumberOfPages() <= 3, doc.getNumberOfPages());
        } catch (e) {
          failures.push(`${label}${gray ? ' gray' : ''} renders -> ${e.stack || e.message}`);
        }
      }
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`FAIL ${f}`); process.exit(1); }
