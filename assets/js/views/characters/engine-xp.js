// Experience points (2024 rules / SRD 5.2 "Character Advancement" table). Pure ES module: no DOM; Node-testable.
// Accepts either built rules ({core: rules.json}) or the raw rules.json ({xpByLevel}); falls back to the SRD table.
//
// Stored on the character doc (docs/character-model.md):
//   xp        number (>= 0)
//   xpLog     [{at: ISO, delta: n, total: n, note?: string, set?: true}]  newest LAST, capped at XP_LOG_MAX entries
//   levelOrder [classId]  one entry per character level gained through applyLevelUp (most recent last); may be shorter
//                          than the total level for characters built directly at a higher level.

export const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
  195000, 225000, 265000, 305000, 355000];
export const XP_LOG_MAX = 30;

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The 20 thresholds: xpTable(rules)[L-1] = minimum XP for character level L. */
export function xpTable(rules) {
  const t = rules?.core?.xpByLevel || rules?.xpByLevel;
  return Array.isArray(t) && t.length >= 20 && t.every((n) => Number.isFinite(Number(n))) ? t.map(Number) : XP_TABLE;
}

/** Minimum XP for a character level (1 -> 0, 2 -> 300 … 20 -> 355000). */
export function xpForLevel(level, rules) {
  const L = Math.max(1, Math.min(20, Math.floor(num(level, 1))));
  return xpTable(rules)[L - 1];
}

/** Highest character level the XP qualifies for (1..20). */
export function levelForXp(xp, rules) {
  const t = xpTable(rules);
  const x = Math.max(0, num(xp));
  let L = 1;
  for (let i = 1; i < t.length; i++) if (x >= t[i]) L = i + 1;
  return L;
}

/** Total character level of a stored doc. */
export const charLevel = (char) => (Array.isArray(char?.classes) ? char.classes : []).reduce((n, c) => n + Math.max(0, Math.floor(num(c?.level))), 0);

/**
 * XP state of a doc: {xp, level, xpLevel, due, floor, next, toNext, pct, atMax, levelForNext}
 *   level    = current total level; xpLevel = level the XP qualifies for
 *   due      = levels the XP has earned but not yet taken (0 for level-0 docs: pick a class first)
 *   floor    = minimum XP of the current level; next = XP for level+1 (null at 20); pct = progress 0..100 between them
 */
export function xpStatus(char, rules) {
  const xp = Math.max(0, num(char?.xp));
  const level = Math.min(20, charLevel(char));
  const xpLevel = levelForXp(xp, rules);
  const atMax = level >= 20;
  const t = xpTable(rules);
  const floor = level >= 1 ? t[level - 1] : 0;
  const next = atMax ? null : t[Math.max(1, level + 1) - 1];
  const due = level >= 1 && !atMax ? Math.max(0, xpLevel - level) : 0;
  const span = next == null ? 0 : next - floor;
  const pct = next == null ? 100 : span > 0 ? Math.max(0, Math.min(100, Math.round(((xp - floor) / span) * 100))) : 100;
  return { xp, level, xpLevel, due, floor, next, toNext: next == null ? 0 : Math.max(0, next - xp), pct, atMax, levelForNext: atMax ? null : level + 1 };
}

/**
 * Levels that became due because XP moved from `before` to `after` at total level `level`: > 0 only when the new XP
 * crosses a threshold above the current level that the old XP had not crossed (so re-opening a sheet with XP already
 * past a threshold never re-triggers, but adding enough XP for another level does).
 */
export function xpLevelsCrossed(before, after, level, rules) {
  const L = Math.floor(num(level));
  if (L < 1 || L >= 20) return 0;
  const a = levelForXp(after, rules);
  const b = levelForXp(before, rules);
  if (a <= b || a <= L) return 0;
  return a - Math.max(L, b);
}

function logEntry(prev, total, { note, at, set } = {}) {
  const e = { at: at || new Date().toISOString(), delta: total - prev, total };
  const n = String(note ?? '').trim();
  if (n) e.note = n.slice(0, 140);
  if (set) e.set = true;
  return e;
}

/** New doc with XP set to `value` (>= 0, whole number) and a log entry. opts: {note, at, log:false to skip the log} */
export function setXp(char, value, opts = {}) {
  const c = isObj(char) ? char : {};
  const prev = Math.max(0, Math.round(num(c.xp)));
  const total = Math.max(0, Math.round(num(value, prev)));
  const next = { ...c, xp: total };
  if (opts.log !== false && total !== prev) {
    const log = Array.isArray(c.xpLog) ? c.xpLog.filter(isObj) : [];
    next.xpLog = [...log, logEntry(prev, total, { ...opts, set: opts.set ?? true })].slice(-XP_LOG_MAX);
  }
  return next;
}

/** New doc with `delta` XP added (negative subtracts; never below 0) and a log entry. opts: {note, at} */
export function addXp(char, delta, opts = {}) {
  const prev = Math.max(0, Math.round(num(char?.xp)));
  return setXp(char, prev + Math.round(num(delta)), { ...opts, set: false });
}

/**
 * XP to store after a manual level change so the auto level-up doesn't immediately re-fire / the bar stays sensible:
 *   'up'   (milestone level-up to newLevel): raise XP to newLevel's minimum if below it
 *   'down' (to newLevel): if XP still qualifies for a higher level, reset it to newLevel's minimum
 * Returns {xp, changed, reason}.
 */
export function xpAfterLevelChange(xp, newLevel, direction, rules) {
  const x = Math.max(0, Math.round(num(xp)));
  const L = Math.max(1, Math.min(20, Math.floor(num(newLevel, 1))));
  const min = xpForLevel(L, rules);
  if (direction === 'up' && x < min) return { xp: min, changed: true, reason: `raised to the level ${L} minimum` };
  if (direction === 'down' && levelForXp(x, rules) > L) return { xp: min, changed: true, reason: `reset to the level ${L} minimum` };
  return { xp: x, changed: false, reason: '' };
}

/** The class most recently leveled (from levelOrder), else the last class in `classes`. null for level 0. */
export function lastLeveledClass(char) {
  const classes = (Array.isArray(char?.classes) ? char.classes : []).filter((c) => c && c.id && num(c.level) > 0);
  if (!classes.length) return null;
  const ids = new Set(classes.map((c) => c.id));
  const order = Array.isArray(char?.levelOrder) ? char.levelOrder : [];
  for (let i = order.length - 1; i >= 0; i--) if (ids.has(order[i])) return order[i];
  return classes[classes.length - 1].id;
}
