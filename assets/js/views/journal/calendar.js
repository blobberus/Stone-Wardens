// The world's calendar, shared by every timeline and family tree in the journal: the ages (eras) in their order and
// the month names. content/calendar.json = {ages: [{id, abbr, name, color, start, end, countdown, text, tags}],
// months: [names], defaultAge: id}. Without the file there is one age, AFF (After the Fallen Firmament).
// A date is {year (integer), month (1-based or null), age (an age id)}; dates sort by the age's place in the list
// first, then the year (backwards in an age whose years count down, like BC), then the month (none first).
// docs/journal-model.md "Family trees and timelines".
import { store } from '../../core/store.js';
import { slugify } from '../../core/util.js';

export const CAL_PATH = 'content/calendar.json';
export const DEFAULT_AGE = Object.freeze({ id: 'aff', abbr: 'AFF', name: 'After the Fallen Firmament', color: 'gold' });
export const DEFAULT_MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']);

/** The colours items can take: the map's pin inks (tokens.css --pin-*), so they suit every skin and the dark theme. */
export const COLORS = Object.freeze([
  { id: 'rubric', label: 'Oxblood' }, { id: 'vermilion', label: 'Vermilion' }, { id: 'ochre', label: 'Ochre' },
  { id: 'gold', label: 'Gold' }, { id: 'green', label: 'Green' }, { id: 'verdigris', label: 'Verdigris' },
  { id: 'lapis', label: 'Lapis' }, { id: 'slate', label: 'Slate' }, { id: 'murrey', label: 'Murrey' },
  { id: 'umber', label: 'Umber' },
]);
const COLOR_IDS = new Set(COLORS.map((c) => c.id));
export const colorId = (c, fallback = 'slate') => (COLOR_IDS.has(c) ? c : fallback);
export const colorVar = (c, fallback) => `var(--pin-${colorId(c, fallback)})`;

const int = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
  .map((x) => String(x).trim()).filter(Boolean);

function normAge(a, i) {
  const abbr = String(a.abbr || a.name || `Age ${i + 1}`).trim().slice(0, 12);
  return {
    id: String(a.id || slugify(abbr) || `age-${i + 1}`),
    abbr,
    name: String(a.name || abbr).trim(),
    color: colorId(a.color, COLORS[i % COLORS.length].id),
    start: int(a.start),
    end: int(a.end),
    countdown: !!a.countdown,
    text: String(a.text || ''),
    tags: strList(a.tags),
  };
}

let cache = null;
store.on((e) => {
  if (e.type === 'load' || e.path === CAL_PATH || (Array.isArray(e.paths) && e.paths.includes(CAL_PATH))) cache = null;
});

/** The calendar of the site: makeCalendar(content/calendar.json), cached until the file changes. */
export function calendar() {
  return cache || (cache = makeCalendar(store.get(CAL_PATH)));
}

/** A calendar from the file's data: -> {ages, months, byId: Map(id -> age with .index), defaultAge: id} */
export function makeCalendar(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const seen = new Set();
  let ages = (Array.isArray(d.ages) ? d.ages : []).filter((a) => a && typeof a === 'object').map(normAge)
    .filter((a) => !seen.has(a.id) && seen.add(a.id));
  if (!ages.length) ages = [normAge(DEFAULT_AGE, 0)];
  const months = strList(d.months).length ? strList(d.months) : [...DEFAULT_MONTHS];
  const byId = new Map(ages.map((a, i) => [a.id, { ...a, index: i }]));
  const defaultAge = byId.has(d.defaultAge) ? d.defaultAge : byId.has(DEFAULT_AGE.id) ? DEFAULT_AGE.id : ages[0].id;
  return { ages, months, byId, defaultAge };
}

export const ageOf = (id, cal = calendar()) => cal.byId.get(id) || null;
export const defaultAge = () => calendar().defaultAge;

/** Write the calendar (ages in their order, month names, the default age for new dates). */
export function saveCalendar({ ages, months, defaultAge: def }) {
  const list = ages.map(normAge);
  const out = {
    ages: list.map((a) => {
      const o = { id: a.id, abbr: a.abbr, name: a.name, color: a.color };
      if (a.start != null) o.start = a.start;
      if (a.end != null) o.end = a.end;
      if (a.countdown) o.countdown = true;
      if (a.text.trim()) o.text = a.text.trim();
      if (a.tags.length) o.tags = a.tags;
      return o;
    }),
    months: strList(months).length ? strList(months) : [...DEFAULT_MONTHS],
    defaultAge: list.some((a) => a.id === def) ? def : list[0]?.id,
  };
  store.put(CAL_PATH, out);
  cache = null;
  return out;
}

/** A fresh age id from its abbreviation, not used by another age. */
export function newAgeId(abbr, ages = calendar().ages) {
  const base = slugify(abbr) || 'age';
  const taken = new Set(ages.map((a) => a.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

// ---------- dates ----------

/** A stored date -> {year, month, age} or null (no year). A date without an age is in the default age. */
export function normDate(d, cal = null) {
  if (!d || typeof d !== 'object') return null;
  const year = int(d.year);
  if (year == null) return null;
  const m = int(d.month);
  return { year, month: m && m > 0 ? m : null, age: String(d.age || (cal || calendar()).defaultAge) };
}

/** What a date is saved as (no empty month). */
export function dateValue(d) {
  const n = normDate(d);
  if (!n) return undefined;
  const o = { year: n.year };
  if (n.month) o.month = n.month;
  o.age = n.age;
  return o;
}

/** Sort key [age place, year (negated in a countdown age), month]. Unknown ages sort after the known ones. */
export function dateKey(d, cal = calendar()) {
  const n = normDate(d, cal);
  if (!n) return [Infinity, 0, 0];
  const a = cal.byId.get(n.age);
  return [a ? a.index : cal.ages.length, a?.countdown ? -n.year : n.year, n.month || 0];
}

export function cmpKey(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export const cmpDate = (a, b, cal = calendar()) => cmpKey(dateKey(a, cal), dateKey(b, cal));
export const sameKey = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export const monthName = (m, cal = calendar()) => (m ? cal.months[m - 1] || `Month ${m}` : '');
export const ageAbbr = (id, cal = calendar()) => cal.byId.get(id)?.abbr || id || '?';

/** "March 100 AFF", "100 AFF" ({short}: no month name). */
export function fmtDate(d, { cal = calendar(), month = true } = {}) {
  const n = normDate(d, cal);
  if (!n) return '';
  return [month && n.month ? monthName(n.month, cal) : '', String(n.year), ageAbbr(n.age, cal)].filter(Boolean).join(' ');
}

/** "100 – 162 AFF", "998 AFF – 3 BCC", "100 AFF – " (no end), "– 162 AFF" (no start). */
export function fmtRange(a, b, { cal = calendar(), month = true } = {}) {
  const x = normDate(a, cal);
  const y = normDate(b, cal);
  if (x && y && x.age === y.age) {
    const left = [month && x.month ? monthName(x.month, cal) : '', String(x.year)].filter(Boolean).join(' ');
    return `${left} – ${fmtDate(y, { cal, month })}`;
  }
  if (x && y) return `${fmtDate(x, { cal, month })} – ${fmtDate(y, { cal, month })}`;
  if (x) return `${fmtDate(x, { cal, month })} –`;
  if (y) return `– ${fmtDate(y, { cal, month })}`;
  return '';
}

/** Years from a to b (fractional with months; across ages: null). */
export function yearsBetween(a, b, cal = calendar()) {
  const x = normDate(a, cal);
  const y = normDate(b, cal);
  if (!x || !y || x.age !== y.age) return null;
  const sign = cal.byId.get(x.age)?.countdown ? -1 : 1;
  const months = cal.months.length || 12;
  return sign * (y.year - x.year) + ((y.month || 0) - (x.month || 0)) / months;
}
