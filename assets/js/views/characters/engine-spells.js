// Spell combat numbers and spell-list compatibility. Pure ES module: no DOM; Node-testable (tools/test_spells.mjs).
//
// spellStats(record, {charLevel, caster}) reads the structured SRD fields (attack, save, damage {dice,type},
// higherLevel) and, only where the record has no structured damage, a few reliable description patterns
// ("1d4 + 1 Force damage", "Force damage equal to 1d8 plus your spellcasting ability modifier", "regains Hit Points
// equal to 2d8 plus your spellcasting ability modifier"). Cantrip dice scale with CHARACTER level (5/11/17).
// spellIssues / addSpellIssues explain why a spell doesn't fit a class's casting (never used to block anything).

const DAMAGE_TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const DICE = '(\\d+d\\d+)(?:\\s*\\+\\s*(\\d+))?';
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// Spells whose structured damage is a mishap / side effect, not what the spell is cast for.
const INCIDENTAL_DAMAGE = new Set(['dimension-door', 'teleport', 'meld-into-stone', 'wish']);
export const CANTRIP_LEVELS = [5, 11, 17];

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

/** "2d10 + 3" -> {count:2, sides:10, bonus:3}; null if it isn't dice. */
export function parseDice(expr) {
  const m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(expr ?? ''));
  if (!m) return null;
  return { count: m[1] === '' ? 1 : Number(m[1]), sides: Number(m[2]), bonus: m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0 };
}

/** Cantrip damage multiplier at a character level: 1 (1–4), 2 (5–10), 3 (11–16), 4 (17+). */
export const cantripTier = (charLevel) => 1 + CANTRIP_LEVELS.filter((l) => num(charLevel, 1) >= l).length;

/** {dice:'2d8', bonus:3} -> "2d8 + 3" (bonus 0 omitted; negative as "− 1"). */
export function diceText({ dice, bonus = 0 } = {}) {
  const b = num(bonus);
  if (!dice) return b ? String(b) : '';
  return b ? `${dice} ${b < 0 ? '−' : '+'} ${Math.abs(b)}` : String(dice);
}

/** Roll "2d10 + 3" (or {dice, bonus}). rand() in [0,1). -> {total, rolls:[n], bonus, dice} | null */
export function rollDice(expr, rand = Math.random) {
  const d = typeof expr === 'string' ? parseDice(expr) : (() => { const p = parseDice(expr?.dice); return p ? { ...p, bonus: p.bonus + num(expr?.bonus) } : null; })();
  if (!d) return null;
  const rolls = Array.from({ length: Math.min(100, d.count) }, () => 1 + Math.floor(rand() * d.sides));
  return { total: rolls.reduce((a, b) => a + b, 0) + d.bonus, rolls, bonus: d.bonus, dice: `${d.count}d${d.sides}` };
}

function cantripScaling(record, base) {
  const hl = String(record.higherLevel || '');
  const m = /levels? 5 \((\d*d\d+)\),? 11 \((\d*d\d+)\),? and 17 \((\d*d\d+)\)/i.exec(hl);
  if (m && /damage/i.test(hl)) return [base, m[1], m[2], m[3]];
  if (base && /damage increases by \d+d\d+ when you reach level/i.test(hl)) {
    const p = parseDice(base);
    if (p) return [1, 2, 3, 4].map((k) => `${p.count * k}d${p.sides}`);
  }
  return null;
}

function beamScaling(record) {
  const m = /(\w+) beams at level 5, (\w+) beams at level 11, and (\w+) beams at level 17/i.exec(String(record.higherLevel || ''));
  if (!m) return null;
  const w = [m[1], m[2], m[3]].map((x) => NUMBER_WORDS[x.toLowerCase()] ?? num(x, NaN));
  return w.some((x) => !Number.isFinite(x)) ? null : [1, ...w];
}

function upcastRule(record) {
  if (!num(record.level)) return null;
  const hl = String(record.higherLevel || '');
  let m = /\b(damage|healing)\b[^.]*?\bincreases? by (\d+d\d+|\d+) for (?:each|every) (?:spell )?slot level above (\d)/i.exec(hl);
  if (m) return { what: m[1].toLowerCase(), dice: m[2], above: Number(m[3]), text: `+${m[2]} per slot level above ${m[3]}` };
  // Extra darts / rays / bolts (extra targets such as "one additional creature" stay in the tooltip text)
  m = /\bone (?:more|additional) (dart|ray|bolt|beam)s?\b[^.]*?for each spell slot level above (\d)/i.exec(hl);
  if (m) return { what: 'count', count: 1, unit: m[1].toLowerCase(), above: Number(m[2]), text: `+1 ${m[1].toLowerCase()} per slot level above ${m[2]}` };
  return null;
}

function parseDamage(record) {
  const id = record.id;
  const desc = String(record.description || '');
  const DMG = new RegExp(`${DICE}\\s+(${DAMAGE_TYPES})\\s+damage`, 'gi');
  const all = [...desc.matchAll(DMG)].map((m) => ({ dice: m[1], bonus: num(m[2]), type: m[3].toLowerCase(), index: m.index }));
  const withMod = new RegExp(`(${DAMAGE_TYPES})\\s+damage equal to ${DICE} plus your spellcasting ability modifier`, 'i').exec(desc);
  let base = record.damage?.dice && !INCIDENTAL_DAMAGE.has(id) ? { dice: String(record.damage.dice), type: String(record.damage.type || '').toLowerCase() || null } : null;
  if (base) {
    const sents = sentences(desc);
    const ownIdx = sents.findIndex((s) => new RegExp(`${base.dice}(?:\\s*\\+\\s*\\d+)?\\s+${base.type}\\s+damage`, 'i').test(s));
    // The same dice with other types in OTHER sentences (Prismatic Spray's rays): the type varies.
    const elsewhere = sents.some((s, i) => i !== ownIdx && [...s.matchAll(DMG)].some((m) => m[1] === base.dice && m[3].toLowerCase() !== base.type));
    if (elsewhere) return { list: [{ dice: base.dice, bonus: 0, type: 'varies', mod: false }], parsed: false };
    const own = sents[ownIdx];
    const list = [];
    if (own) {
      let prevEnd = null;
      for (const m of own.matchAll(DMG)) {
        const t = m[3].toLowerCase();
        const between = prevEnd == null ? '' : own.slice(prevEnd, m.index);
        prevEnd = m.index + m[0].length;
        if (list.some((x) => x.type === t) || (t === base.type && m[1] !== base.dice)) continue;
        // "2d8 Fire damage from a warm shield or 2d8 Cold damage…" -> alternatives, not a sum
        list.push({ dice: m[1], bonus: num(m[2]), type: t, mod: false, alt: list.length > 0 && /\bor\b/i.test(between) });
      }
      if (list.length && list[0].type !== base.type) list.sort((a, b) => (a.type === base.type ? -1 : b.type === base.type ? 1 : 0));
      if (list[0]) list[0].alt = false;
    }
    if (!list.length) list.push({ dice: base.dice, bonus: 0, type: base.type, mod: false });
    if (withMod && withMod[2] === base.dice) list[0].mod = true;
    return { list, parsed: false };
  }
  if (INCIDENTAL_DAMAGE.has(id)) return { list: [], parsed: false };
  if (withMod) return { list: [{ dice: withMod[2], bonus: num(withMod[3]), type: withMod[1].toLowerCase(), mod: true }], parsed: true };
  const chosen = new RegExp(`${DICE} damage of (?:the|a) (?:chosen type|type you choose)`, 'i').exec(desc);
  if (chosen) return { list: [{ dice: chosen[1], bonus: num(chosen[2]), type: 'chosen', mod: false }], parsed: true };
  if (all.length && (record.attack || record.save || /\bdeals?\b/i.test(sentences(desc).find((s) => s.includes(all[0].dice)) || ''))) {
    const first = all[0];
    return { list: [{ dice: first.dice, bonus: first.bonus, type: first.type, mod: false }], parsed: true };
  }
  return { list: [], parsed: false };
}

function parseHealing(record) {
  const desc = String(record.description || '');
  let m = /regains? (?:a number of )?Hit Points equal to (\d+d\d+)(?:\s*\+\s*(\d+))?( plus your spellcasting ability modifier)?/i.exec(desc);
  if (m) return { dice: m[1], bonus: num(m[2]), mod: !!m[3] };
  // Fixed amounts only when they're the spell's point (Heal's 70, Mass Heal's 700), not a 1-HP side effect.
  m = /\bregains? (\d+d\d+|\d+)(?:\s*\+\s*(\d+))? Hit Points?\b/i.exec(desc);
  if (m && /d/.test(m[1])) return { dice: m[1], bonus: num(m[2]), mod: false };
  if (m && Number(m[1]) >= 10) return { dice: null, bonus: Number(m[1]) + num(m[2]), mod: false };
  m = /\brestor(?:es|ing|e) (up to )?(\d+d\d+|\d+) Hit Points?\b/i.exec(desc);
  if (m && /d/.test(m[2])) return { dice: m[2], bonus: 0, mod: false, upTo: !!m[1] };
  if (m && Number(m[2]) >= 10) return { dice: null, bonus: Number(m[2]), mod: false, upTo: !!m[1] };
  if (/\bregains? all (?:of )?(?:its|their|your) Hit Points\b/i.test(desc)) return { dice: null, bonus: 0, mod: false, all: true };
  return null;
}

function countOf(record) {
  if (record.save) return null;
  const m = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(darts|rays|beams|bolts|motes)\b/i.exec(String(record.description || ''));
  return m ? { count: NUMBER_WORDS[m[1].toLowerCase()], unit: m[2].toLowerCase().replace(/s$/, '') } : null;
}

/**
 * Combat numbers of a spell record for a caster.
 *   opts.charLevel  character level (cantrip scaling)
 *   opts.caster     {attack, dc, mod} of the casting class / innate group (null: no numbers)
 * -> {attack:'ranged'|'melee'|null, toHit, save, dc, damage:[{dice, bonus, type, mod, text}], heal:{…, text}|null,
 *     count:{count, unit}|null, scaling:{tiers:[{level, dice|count}], current, next}|null, upcast:{…, text}|null,
 *     parsed (damage came from the description), higherLevel}
 */
export function spellStats(record, { charLevel = 1, caster = null } = {}) {
  const r = record && typeof record === 'object' ? record : {};
  const level = num(r.level);
  const tier = cantripTier(charLevel);
  const mod = caster ? num(caster.mod) : 0;
  const { list, parsed } = parseDamage(r);
  let scaling = null;
  let count = countOf(r);
  if (level === 0 && list.length) {
    const tiers = cantripScaling(r, list[0].dice);
    if (tiers) {
      list[0].dice = tiers[tier - 1];
      scaling = { kind: 'dice', tiers: tiers.map((d, i) => ({ level: [1, ...CANTRIP_LEVELS][i], dice: d })), current: tiers[tier - 1] };
    }
    const beams = beamScaling(r);
    if (beams) {
      count = { count: beams[tier - 1], unit: 'beam' };
      scaling = { kind: 'count', tiers: beams.map((n, i) => ({ level: [1, ...CANTRIP_LEVELS][i], count: n })), current: beams[tier - 1] };
    }
  }
  if (scaling) {
    const nextIdx = CANTRIP_LEVELS.findIndex((l) => num(charLevel, 1) < l);
    scaling.next = nextIdx >= 0 ? scaling.tiers[nextIdx + 1] : null;
  }
  const typeName = (t) => (t === 'varies' ? '(type varies)' : t === 'chosen' ? '(chosen type)' : t ? cap(t) : '');
  const damage = list.map((d) => {
    const bonus = d.bonus + (d.mod && caster ? mod : 0);
    const dice = diceText({ dice: d.dice, bonus });
    return { ...d, alt: !!d.alt, bonus, typeName: typeName(d.type), text: `${dice}${d.mod && !caster ? ' + mod' : ''} ${typeName(d.type)}`.trim() };
  });
  let heal = parseHealing(r);
  if (heal) {
    const bonus = heal.bonus + (heal.mod && caster ? mod : 0);
    heal = {
      ...heal, bonus,
      text: heal.all ? 'all Hit Points' : `${heal.upTo ? 'up to ' : ''}${diceText({ dice: heal.dice, bonus })}${heal.mod && !caster ? ' + mod' : ''}`,
    };
  }
  return {
    level, attack: r.attack || null, toHit: r.attack && caster ? num(caster.attack) : null,
    save: r.save || null, dc: r.save && caster ? num(caster.dc) : null,
    damage, damageText: damage.map((d, i) => (i ? `${d.alt ? ' or ' : ' + '}${d.text}` : d.text)).join(''),
    heal, count, scaling, upcast: upcastRule(r), parsed, higherLevel: r.higherLevel || null,
  };
}

// ----- compatibility ---------------------------------------------------------------------------

/** Is the spell on this caster's lists (class list, extra lists, expanded or always-prepared spells)? */
export function onCasterList(record, sc) {
  if (!record || !sc) return false;
  const lists = Array.isArray(sc.lists) && sc.lists.length ? sc.lists : [sc.list || sc.class].filter(Boolean);
  const classes = Array.isArray(record.classes) ? record.classes : [];
  return classes.some((c) => lists.includes(c)) || (sc.expanded || []).includes(record.id) || (sc.alwaysPrepared || []).includes(record.id);
}

/**
 * Why a spell doesn't fit the casting of a class (empty = it fits). sc = the sheet.spellcasting entry or null.
 * -> [{code:'no-caster'|'not-on-list'|'too-high', text}]
 */
export function spellIssues(record, sc, { className } = {}) {
  if (!record) return [];
  const name = className || sc?.name || 'this class';
  if (!sc) return [{ code: 'no-caster', text: className ? `${className} has no spellcasting.` : 'No spellcasting class casts it.' }];
  const out = [];
  if (!onCasterList(record, sc)) out.push({ code: 'not-on-list', text: `Not on the ${name} spell list.` });
  const lvl = num(record.level);
  if (lvl > 0 && lvl > num(sc.maxSpellLevel)) {
    out.push({ code: 'too-high', text: num(sc.maxSpellLevel) ? `Level ${lvl}: above the highest level ${name} can cast (${sc.maxSpellLevel}).` : `Level ${lvl}: ${name} has no spell slots yet.` });
  }
  return out;
}

/**
 * Adding several spells for one caster: per-spell issues incl. the cantrip / prepared limits, and whether each new
 * spell should start prepared (spellbook casters: only while there is room; others: always).
 * -> [{record, issues:[{code, text}], prepared}]
 */
export function addSpellIssues(records, sc, { className } = {}) {
  let cantrips = num(sc?.cantripCount);
  let prepared = num(sc?.preparedCount);
  const book = !!sc?.spellbook;
  return (records || []).filter(Boolean).map((record) => {
    const issues = spellIssues(record, sc, { className });
    const lvl = num(record.level);
    let prep = true;
    if (sc && !(sc.alwaysPrepared || []).includes(record.id)) {
      if (lvl === 0) {
        cantrips += 1;
        if (cantrips > num(sc.cantrips)) issues.push({ code: 'cantrip-limit', text: num(sc.cantrips) ? `Over the cantrip limit (${cantrips} of ${sc.cantrips}).` : `${className || sc.name || 'This class'} learns no cantrips.` });
      } else if (book) {
        prep = prepared < num(sc.prepared);
        if (prep) prepared += 1;
      } else {
        prepared += 1;
        if (prepared > num(sc.prepared)) issues.push({ code: 'prepared-limit', text: `Over the prepared-spell limit (${prepared} of ${num(sc.prepared)}).` });
      }
    }
    return { record, issues, prepared: prep };
  });
}
