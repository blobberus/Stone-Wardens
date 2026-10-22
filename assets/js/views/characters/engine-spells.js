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
// (Enlarge/Reduce only changes weapon damage by 1d4 either way.)
const INCIDENTAL_DAMAGE = new Set(['dimension-door', 'teleport', 'meld-into-stone', 'wish', 'enlarge-reduce']);
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

// Type lists the description garbles (the SRD table of Prismatic rays): the five damage rays, in table order.
const TYPE_OVERRIDES = { 'prismatic-spray': ['fire', 'acid', 'lightning', 'poison', 'cold'], 'prismatic-wall': ['fire', 'acid', 'lightning', 'poison', 'cold'] };

/** Damage types offered by a "choose Acid, Cold, Fire, …" / "This damage is Acid, Cold, … (your choice)" sentence. */
function chosenTypes(sents) {
  const TYPE_WORD = new RegExp(`\\b(${DAMAGE_TYPES.split('|').map(cap).join('|')})\\b`, 'g');
  for (const s of sents) {
    if (!/\bchoose\b|\bchoice\b|\bchosen\b/i.test(s)) continue;
    const found = [...new Set([...s.matchAll(TYPE_WORD)].map((m) => m[1].toLowerCase()))];
    if (found.length >= 2) return found;
  }
  return null;
}

/**
 * Every damage component the description deals, in text order, as {dice, bonus, type, types?, mod, extra?, join,
 * sent, note}: join 'new' starts a new effect (another sentence: Ice Knife's burst, Tsunami's later rounds),
 * 'and' adds (Flame Strike), 'or' is an alternative (Spirit Guardians), 'then' is later damage of the same type
 * (Acid Arrow). The record's own `damage` is always the first component.
 */
function parseDamage(record) {
  const id = record.id;
  if (INCIDENTAL_DAMAGE.has(id)) return { list: [], parsed: false };
  const desc = String(record.description || '');
  const sents = sentences(desc);
  const options = chosenTypes(sents);
  const DMG = new RegExp(`${DICE}\\s+(${DAMAGE_TYPES})\\s+damage`, 'gi');
  const WITH_MOD = new RegExp(`(${DAMAGE_TYPES})\\s+damage (?:to the target )?equal to ${DICE} plus your spellcasting ability modifier`, 'gi');
  const CHOSEN = new RegExp(`${DICE} damage of (?:the|a) (?:chosen type|type you choose|spirit's type)`, 'gi');
  const EXTRA = new RegExp(`\\bextra ${DICE} damage\\b`, 'gi');
  const comps = [];
  sents.forEach((s, si) => {
    const found = [];
    for (const m of s.matchAll(DMG)) found.push({ dice: m[1], bonus: num(m[2]), type: m[3].toLowerCase(), index: m.index, end: m.index + m[0].length });
    for (const m of s.matchAll(WITH_MOD)) found.push({ dice: m[2], bonus: num(m[3]), type: m[1].toLowerCase(), mod: true, index: m.index, end: m.index + m[0].length });
    for (const m of s.matchAll(CHOSEN)) found.push({ dice: m[1], bonus: num(m[2]), type: 'chosen', types: options, index: m.index, end: m.index + m[0].length });
    for (const m of s.matchAll(EXTRA)) found.push({ dice: m[1], bonus: num(m[2]), type: options ? 'chosen' : null, types: options, extra: true, index: m.index, end: m.index + m[0].length });
    found.sort((a, b) => a.index - b.index);
    let prev = null;
    for (const f of found) {
      const between = prev ? s.slice(prev.end, f.index) : '';
      const join = !prev ? 'new' : /\bor\b/i.test(between) ? 'or' : f.type && f.type === prev.type && f.dice !== prev.dice ? 'then' : 'and';
      comps.push({ ...f, join, sent: si, note: s.trim().slice(0, 220) });
      prev = f;
    }
  });
  const same = (a, b) => a.dice === b.dice && a.bonus === b.bonus && a.type === b.type;
  let list = [];
  for (const c of comps) if (!list.some((x) => same(x, c))) list.push(c); // Searing Smite, Wall of Fire repeat theirs
  const rec = record.damage?.dice ? { dice: String(record.damage.dice), type: String(record.damage.type || '').toLowerCase() || null } : null;
  let parsed = false;
  if (rec) {
    let i = list.findIndex((x) => x.dice === rec.dice && (x.type === rec.type || x.type === 'chosen'));
    if (i < 0) { list.unshift({ dice: rec.dice, bonus: 0, type: rec.type, join: 'new', sent: -1, note: '' }); i = 0; }
    if (i > 0) {
      // the record's effect leads: move its sentence group to the front
      const sent = list[i].sent;
      list = [...list.filter((x) => x.sent === sent), ...list.filter((x) => x.sent !== sent)];
    }
  } else {
    // no structured damage: trust the text only for attack / save spells or ones that say they deal it
    if (!list.length || !(record.attack || record.save || list.some((x) => /\bdeals?\b|\btakes?\b|\btaking\b/i.test(x.note)))) return { list: [], parsed: false };
    parsed = true;
  }
  // Prismatic rays: the table text is garbled, so the five ray types come from TYPE_OVERRIDES (one component)
  let out = list.map((c) => ({ ...c }));
  if (TYPE_OVERRIDES[id] && out[0]) out = [{ ...out[0], type: 'varies', types: TYPE_OVERRIDES[id] }];
  out.forEach((c, i) => { if (i === 0) c.join = 'new'; delete c.index; delete c.end; });
  return { list: out, parsed };
}

function parseHealing(record) {
  const desc = String(record.description || '');
  const note = (m) => (sentences(desc).find((s) => s.includes(m[0])) || '').trim().slice(0, 220);
  let m = /regains? (?:a number of )?Hit Points equal to (\d+d\d+)(?:\s*\+\s*(\d+))?( plus your spellcasting ability modifier)?/i.exec(desc);
  if (m) return { dice: m[1], bonus: num(m[2]), mod: !!m[3], note: note(m) };
  m = /\bregains? Hit Points equal to half the amount of (?:\w+ )?damage dealt/i.exec(desc);
  if (m) return { dice: null, bonus: 0, mod: false, half: true, note: note(m) };
  m = /\bregains? (\d+d\d+|\d+)(?:\s*\+\s*(\d+))? Hit Points?\b/i.exec(desc);
  if (m) return /d/.test(m[1]) ? { dice: m[1], bonus: num(m[2]), mod: false, note: note(m) } : { dice: null, bonus: Number(m[1]) + num(m[2]), mod: false, note: note(m) };
  m = /\brestor(?:es|ing|e) (up to )?(\d+d\d+|\d+) Hit Points?\b/i.exec(desc);
  if (m) return /d/.test(m[2]) ? { dice: m[2], bonus: 0, mod: false, upTo: !!m[1], note: note(m) } : { dice: null, bonus: Number(m[2]), mod: false, upTo: !!m[1], note: note(m) };
  m = /\bregains? all (?:of )?(?:its|their|your) Hit Points\b/i.exec(desc);
  if (m) return { dice: null, bonus: 0, mod: false, all: true, note: note(m) };
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
  const typeName = (d) => {
    const ts = Array.isArray(d.types) && d.types.length ? d.types : null;
    if (ts) return ts.map(cap).join('/');
    return d.type === 'varies' ? '(type varies)' : d.type === 'chosen' ? '(chosen type)' : d.type ? cap(d.type) : d.extra ? 'extra' : '';
  };
  const damage = list.map((d) => {
    const bonus = d.bonus + (d.mod && caster ? mod : 0);
    const dice = diceText({ dice: d.dice, bonus });
    return { ...d, alt: d.join === 'or', bonus, typeName: typeName(d), text: `${dice}${d.mod && !caster ? ' + mod' : ''} ${typeName(d)}`.trim() };
  });
  // groups = one effect each (a sentence of the text): "5d6 Fire + 5d6 Radiant", "3d8 Radiant or Necrotic", "4d4 Acid, then 2d4 Acid"
  const damageGroups = [];
  damage.forEach((d, i) => {
    d.group = d.join === 'new' || !damageGroups.length ? damageGroups.length : damageGroups.length - 1;
    if (d.group === damageGroups.length) damageGroups.push({ parts: [], note: d.note || '', primary: i === 0 });
    damageGroups[d.group].parts.push(d);
  });
  for (const g of damageGroups) {
    g.text = g.parts.map((d, i) => {
      if (!i) return d.text;
      const prev = g.parts[i - 1];
      if (d.join === 'or') return d.dice === prev.dice && d.bonus === prev.bonus && !d.mod ? ` or ${d.typeName}` : ` or ${d.text}`;
      return d.join === 'then' ? `, then ${d.text}` : ` + ${d.text}`;
    }).join('');
  }
  let heal = parseHealing(r);
  if (heal) {
    const bonus = heal.bonus + (heal.mod && caster ? mod : 0);
    heal = {
      ...heal, bonus,
      text: heal.all ? 'all Hit Points' : heal.half ? 'half the damage dealt' : `${heal.upTo ? 'up to ' : ''}${diceText({ dice: heal.dice, bonus })}${heal.mod && !caster ? ' + mod' : ''}`,
    };
  }
  return {
    level, attack: r.attack || null, toHit: r.attack && caster ? num(caster.attack) : null,
    save: r.save || null, dc: r.save && caster ? num(caster.dc) : null,
    damage, damageGroups, damageText: damageGroups.map((g) => g.text).join(' · '),
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
