// The party view's pure parts (no DOM; node tools/test_party.mjs): one card's numbers from a character and its derived
// sheet, the grid that fits N cards into a box, and the shape of the DM's sealed party doc (content/dm/party.json).

/** A card's design size at scale 1 (tall: stats stacked; wide: abilities beside the hit points), and its gap. */
export const CARD = { w: 300, h: 236 };
export const WIDE = { w: 560, h: 150 };
export const GAP = 10;
export const MIN_SCALE = 0.72; // smaller than this and the cards scroll instead of fitting
export const MAX_SCALE = 1.7;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** {v, notes: {charId: text}, omit: [charId]} (characters left out of the view); anything else is dropped. */
export function normalizeParty(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const notes = {};
  if (d.notes && typeof d.notes === 'object') for (const [k, v] of Object.entries(d.notes)) if (typeof v === 'string' && v.trim()) notes[k] = v;
  const omit = Array.isArray(d.omit) ? [...new Set(d.omit.filter((x) => typeof x === 'string' && x))] : [];
  return { v: 1, notes, omit };
}

/**
 * Hit point state: 'ok' | 'mid' (≤ 50%) | 'low' (≤ 25%) | 'dying' (0, saves running) | 'stable' (0, three successes)
 * | 'dead' (three failures).
 */
export function hpState(cur, max, deathSaves = {}) {
  if (cur <= 0 && max > 0) {
    if (num(deathSaves.fail) >= 3) return 'dead';
    if (num(deathSaves.success) >= 3) return 'stable';
    return 'dying';
  }
  const pct = max > 0 ? (cur / max) * 100 : 100;
  return pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
}

/** A stat's shown value, and when a debuff changed it its base and why (sheet.adjust, engine-adjust.js). */
function adjusted(sheet, key, value) {
  const a = sheet.adjust?.[key];
  if (!a || a.value === a.base) return { value, base: null, why: '' };
  return { value, base: a.base, why: (a.reasons || []).map((r) => (r.amount != null ? `${r.label} ${r.amount > 0 ? '+' : '−'}${Math.abs(r.amount)}` : r.label)).join(', ') };
}

const EXHAUSTION_NOTE = (n) => `Exhaustion ${n}: −${2 * n} to every D20 Test, Speed −${5 * n} ft. A Long Rest removes a level; level 6 is death.`;

/**
 * Everything one card shows. opts.conditions: rules conditions [{id, name, description}] for names and tooltips.
 * -> {id, name, player, line, level, accent, updated, hp, ac, passive, abilities, effects}
 */
export function partyCard(char, sheet, { conditions = [], abilities = [] } = {}) {
  const max = Math.max(0, num(sheet.hpMax));
  const cur = char.hp?.current == null ? max : Math.max(0, num(char.hp.current));
  const temp = Math.max(0, num(char.hp?.temp));
  const saves = { success: Math.min(3, Math.max(0, num(char.deathSaves?.success))), fail: Math.min(3, Math.max(0, num(char.deathSaves?.fail))) };
  const byId = new Map(conditions.map((c) => [c.id, c]));
  const effects = [];
  for (const id of char.conditions || []) {
    if (id === 'exhaustion') continue; // tracked as a level below
    const c = byId.get(id);
    effects.push({ kind: 'condition', id, label: c?.name || pretty(id), title: c?.description ? clip(c.description, 320) : '' });
  }
  const ex = Math.min(6, Math.max(0, Math.round(num(char.exhaustion))));
  if (ex) effects.push({ kind: 'exhaustion', id: 'exhaustion', label: `Exhaustion ${ex}`, title: EXHAUSTION_NOTE(ex) });
  if (char.heroicInspiration) effects.push({ kind: 'inspiration', id: 'inspiration', label: 'Heroic Inspiration', title: 'Can reroll one die (2024 rules); spent when used.' });
  return {
    id: char.id,
    name: char.name || 'Unnamed',
    player: char.player || '',
    line: sheet.classLine || 'No class yet',
    level: num(sheet.totalLevel),
    accent: char.style?.accent || null,
    updated: char.updated || null,
    hp: { cur, max, temp, pct: max ? Math.round((Math.min(cur, max) / max) * 100) : 0, state: hpState(cur, max, saves), deathSaves: saves },
    ac: adjusted(sheet, 'ac', num(sheet.ac?.value, 10)),
    passive: adjusted(sheet, 'passive:perception', num(sheet.passive?.perception, 10)),
    abilities: abilities.map((a) => {
      const x = sheet.abilities?.[a.id] || {};
      return { id: a.id, label: a.name, full: a.full, mod: num(x.mod), ...adjusted(sheet, `score:${a.id}`, num(x.score, 10)) };
    }),
    effects,
  };
}

function pretty(id) { return String(id).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()); }
function clip(s, n) { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; }

/**
 * How to lay n cards into a box of width × height: the column count (and card shape) whose cards come out largest.
 * -> {cols, rows, shape: 'tall'|'wide', scale, fit} — fit false: they can't all fit at MIN_SCALE, so they scroll
 * (cols then fill the width at scale 1, shape tall).
 */
export function fitGrid(n, width, height, { gap = GAP } = {}) {
  if (!n) return { cols: 1, rows: 0, shape: 'tall', scale: 1, fit: true };
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (width - gap * (cols - 1)) / cols;
    const h = (height - gap * (rows - 1)) / rows;
    if (w <= 0 || h <= 0) continue;
    for (const [shape, size] of [['tall', CARD], ['wide', WIDE]]) {
      const scale = Math.min(w / size.w, h / size.h);
      const holes = cols * rows - n;
      if (!best || scale > best.scale + 0.001 || (Math.abs(scale - best.scale) <= 0.001 && holes < best.holes)) best = { cols, rows, shape, scale, holes };
    }
  }
  if (best && best.scale >= MIN_SCALE) return { cols: best.cols, rows: best.rows, shape: best.shape, scale: Math.min(MAX_SCALE, best.scale), fit: true };
  const cols = Math.max(1, Math.min(n, Math.floor((width + gap) / (CARD.w * 0.9 + gap))));
  return { cols, rows: Math.ceil(n / cols), shape: 'tall', scale: 1, fit: false };
}
