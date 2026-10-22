// Spell numbers audit: what each spell's text implies (attack roll, saving throw, damage dice, healing, damage types)
// vs what spellStats() shows on the sheet.   node tools/audit_spells.mjs [-v (multi-component spells)] [-a (every spell)]
// Expected gaps (by design): mishap / side damage (Dimension Door, Teleport, Meld into Stone, Wish, Enlarge/Reduce),
// penalties (Ray of Enfeeblement, Resistance), "can't regain" / maximised healing (Chill Touch, Beacon of Hope,
// Simulacrum) and the wall's own immunities in Wall of Ice.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/characters/engine-spells.js')).href);
const spells = JSON.parse(fs.readFileSync(path.join(ROOT, 'srd/spells.json'), 'utf8'));
const TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const caster = { attack: 5, dc: 13, mod: 3 };
const verbose = process.argv.includes('-v');
const all = process.argv.includes('-a');
const DICE_RE = new RegExp(String.raw`(\d+d\d+)(?:\s*\+\s*\d+)?\s+(?:(` + TYPES + String.raw`)\s+)?damage`, 'gi');
const DICE_ONE = new RegExp(DICE_RE.source, 'i');
const TYPE_RE = new RegExp(String.raw`\b(` + TYPES + String.raw`)\b(?=[^.]{0,40}\bdamage)`, 'gi');
let withNumbers = 0;
const gaps = [];
const multi = [];
for (const r of spells) {
  const d = String(r.description || '');
  const implied = {
    attack: /\b(melee|ranged) spell attack|\bspell attack\b/i.test(d),
    save: /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.test(d),
    dice: [...[...d.matchAll(DICE_RE)].map((m) => `${m[1]} ${m[2] || '?'}`.toLowerCase()),
      ...d.split(/(?<=[.!?])\s+|\n+/).filter((s) => /damage/i.test(s) && !/Hit Point/i.test(s) && /\d+d\d+/.test(s) && !DICE_ONE.test(s)).map((s) => `${s.match(/\d+d\d+/)[0]} (in "${s.slice(0, 60)}…")`),
      ...(r.level === 0 && /damage/i.test(r.higherLevel || '') ? ['cantrip-scaling'] : [])],
    types: [...new Set([...d.matchAll(TYPE_RE)].map((m) => m[1].toLowerCase()))],
    heal: /\b(regains?|restor\w*)\b[^.]*Hit Points?/i.test(d),
  };
  const st = S.spellStats(r, { charLevel: 5, caster });
  const shownTypes = new Set(st.damage.flatMap((x) => x.types || [x.type]).filter(Boolean));
  const shows = { attack: !!st.attack, save: !!st.save, damage: st.damage.length > 0, heal: !!st.heal };
  if (shows.attack || shows.save || shows.damage || shows.heal) withNumbers++;
  const miss = [];
  if (implied.attack && !shows.attack) miss.push('attack');
  if (implied.save && !shows.save) miss.push('save');
  if (implied.dice.length && !shows.damage) miss.push(`damage(${implied.dice.join(', ')})`);
  const missingTypes = implied.types.filter((t) => !shownTypes.has(t));
  if (shows.damage && missingTypes.length) miss.push(`types(${missingTypes.join(',')})`);
  if (implied.heal && !shows.heal) miss.push('heal');
  if (miss.length) gaps.push(`${r.level} ${r.id}: ${miss.join(' ')}  || shown: ${st.damageText || '-'}${st.heal ? ` heal ${st.heal.text}` : ''}`);
  if (verbose && (st.damageGroups.length > 1 || st.damage.length > 1)) multi.push(`${r.id}: ${st.damageText}`);
  if (all) console.log(`${r.level} ${r.id}: ${[st.attack && `hit ${st.toHit}`, st.save && `DC ${st.dc} ${st.save}`, st.damageText, st.heal && `heal ${st.heal.text}`, st.count && `x${st.count.count} ${st.count.unit}`, st.upcast?.text, st.scaling && `scale ${st.scaling.tiers.map((t) => t.dice || t.count).join('/')}`].filter(Boolean).join(' | ')}`);
}
console.log(`${spells.length} spells; ${withNumbers} show numbers; ${gaps.length} flagged (see the header for the expected ones)`);
for (const g of gaps) console.log('  GAP', g);
for (const m of multi) console.log('  MULTI', m);
