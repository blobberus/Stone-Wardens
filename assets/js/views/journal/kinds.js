// Journal note kinds. A regular note is markdown; a Family tree and a Timeline are markdown notes too, whose body is
// the introduction above the board (written, linked and #tagged like any note) and whose items live in the note's
// frontmatter: `kind: family-tree` + `family: {people, unions}`, `kind: timeline` + `timeline: {view, ages, events,
// spans, markers}`. Notes without `kind` are regular notes, as every note before this was.
// docs/journal-model.md "Family trees and timelines".
import { slugify } from '../../core/util.js';
import { calendar, normDate } from './calendar.js';

export const KINDS = Object.freeze({
  note: { id: 'note', label: 'Regular note', noun: 'note', icon: 'file', hint: 'Writing, with titles, [[links]] and #tags' },
  'family-tree': { id: 'family-tree', label: 'Family tree', noun: 'family tree', icon: 'family-tree', key: 'family', hint: 'People, partners and children, generation by generation' },
  timeline: { id: 'timeline', label: 'Timeline', noun: 'timeline', icon: 'timeline', key: 'timeline', hint: 'Events, ages, eras of rule and markers, in order' },
});
export const KIND_LIST = Object.freeze([KINDS.note, KINDS['family-tree'], KINDS.timeline]);
/** Frontmatter keys that belong to the boards (kept out of the Properties editor). */
export const BOARD_KEYS = Object.freeze(['kind', 'family', 'timeline']);

export const kindOf = (fm) => KINDS[String(fm?.kind ?? '').trim().toLowerCase()]?.id || 'note';
export const isBoard = (kind) => kind === 'family-tree' || kind === 'timeline';
export const kindIcon = (kind) => KINDS[kind]?.icon || 'file';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
export const tagsOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
  .map((t) => cleanTag(t)).filter(Boolean);

/** A tag as the journal writes it: no #, no spaces (they become -), letters, digits, _ / - only. */
export function cleanTag(t) {
  return String(t ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/^[-/]+|[-/]+$/g, '').slice(0, 60);
}

/** The board data of a note's frontmatter (an empty board when it has none yet). */
export function boardData(fm) {
  const kind = kindOf(fm);
  if (!isBoard(kind)) return null;
  const d = isObj(fm[KINDS[kind].key]) ? fm[KINDS[kind].key] : {};
  if (kind === 'timeline') {
    return {
      view: d.view === 'vertical' ? 'vertical' : 'horizontal',
      ages: Array.isArray(d.ages) ? d.ages.map(String) : [],
      events: list(d.events), spans: list(d.spans), markers: list(d.markers),
    };
  }
  return { people: list(d.people), unions: list(d.unions) };
}

/** What a new note of a kind starts with in its frontmatter. */
export function newBoard(kind) {
  if (kind === 'timeline') return { kind, timeline: { view: 'horizontal' } };
  if (kind === 'family-tree') return { kind, family: { people: [] } };
  return {};
}

/**
 * The items of a board that carry words: [{type, id, title, text, tags}] (events, eras of rule, markers; people).
 * Their titles are what [[Note#Item]] links reach.
 */
export function boardItems(fm) {
  const kind = kindOf(fm);
  const d = boardData(fm);
  if (!d) return [];
  const out = [];
  const add = (type, it, title) => {
    const t = String(title ?? '').trim();
    if (!t && !it.text) return;
    out.push({ type, id: String(it.id || ''), title: t, text: String(it.text || ''), tags: tagsOf(it.tags) });
  };
  if (kind === 'timeline') {
    d.events.forEach((e) => add('event', e, e.title));
    d.spans.forEach((s) => add('span', s, s.title));
    d.markers.forEach((m) => add('marker', m, m.label));
    // the ages it shows (listed, or holding its dates; the default one when empty) count as its items too: their
    // tags find it, [[Note#Age name]] reaches the band (the ages themselves live in content/calendar.json)
    const cal = calendar();
    const ids = new Set(d.ages);
    for (const x of [...d.events, ...d.markers, ...d.spans.flatMap((s) => [s.from, s.to])]) { const n = normDate(x, cal); if (n) ids.add(n.age); }
    if (!ids.size) ids.add(cal.defaultAge);
    for (const id of ids) { const a = cal.byId.get(id); if (a) add('age', a, a.name); }
  } else d.people.forEach((p) => add('person', p, p.name));
  return out;
}

/** The anchor ([[Note#…]], ?h=) of an item title: the same slug a heading gets. */
export const itemAnchor = (title) => slugify(title);

/**
 * A board's words as markdown, indexed with the note so search, #tags and [[links]] in its items count for it.
 * Item tags become #tags.
 */
export function boardText(fm) {
  return boardItems(fm).map((it) => [it.title, it.text, it.tags.map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n')).join('\n\n');
}

/** Copy of a board's data with fn applied to every string in it (link rewriting after renames). */
export function mapBoardStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapBoardStrings(v, fn));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapBoardStrings(v, fn)]));
  return value;
}
