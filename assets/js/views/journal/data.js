// Journal data: chapters are folders under content/journal/ (described by _chapter.json), notes are markdown
// files with YAML frontmatter {title, order, author, created, updated, tags}. Notes directly in content/journal/
// are "Loose Leaves" (route segment "_"). Also registers the `note:` and `chapter:` link types.
import { store } from '../../core/store.js';
import { slugify, nameKey, stripExt } from '../../core/util.js';
import { parseFrontmatter, stringifyFrontmatter, extractLinks, extractTags } from '../../core/markdown.js';
import { registerLinkType, parseLink, resolveLink, matchNames } from '../../core/links.js';
import { href } from '../../core/router.js';
import { getSetting } from '../../core/settings.js';
import { roman, plainText, sectionOf, escapeRe, snippet } from './text.js';

export const ROOT = 'content/journal';
export const LOOSE = '_';
export const BOOK_TITLE = 'The Wardens’ Chronicle';
export const BOOK_SUBTITLE = 'A Fallen Firmament Campaign';
const PRE = `${ROOT}/`;
const META = '_chapter.json';
const RESERVED = new Set(['new', LOOSE]);
const FM_ORDER = ['title', 'aliases', 'order', 'author', 'created', 'updated', 'tags'];

// ---------- writes (tracked so the view can ignore its own echoes) ----------

let selfDepth = 0;
export const isSelfWrite = () => selfDepth > 0;
function quietly(fn) { selfDepth += 1; try { return fn(); } finally { selfDepth -= 1; } }
export const put = (path, data) => quietly(() => store.put(path, data));
export const remove = (path) => quietly(() => store.remove(path));

// ---------- index ----------

let cache = null;
const parsed = new Map(); // path -> note (reused while the text is unchanged)

export const touchesJournal = (e) => e.type === 'load'
  || String(e.path || '').startsWith(PRE)
  || (Array.isArray(e.paths) && e.paths.some((p) => String(p).startsWith(PRE)));

store.on((e) => { if (touchesJournal(e)) cache = null; });

export function index() { return cache || (cache = build()); }

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const isoOf = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : '');
const listOf = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean)
  : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });

function cmpOrder(a, b) {
  return (a.order ?? Infinity) - (b.order ?? Infinity)
    || cmpText(a.created, b.created)
    || cmpText(a.title, b.title)
    || cmpText(a.path || a.slug, b.path || b.slug);
}

export function titleFromSlug(slug) {
  const s = String(slug || '');
  if (!/^[a-z0-9-]+$/.test(s)) return s || 'Untitled';
  const t = s.replace(/-+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled';
}

function collectTags(fm, body) {
  const seen = new Map();
  for (const t of [...listOf(fm.tags ?? fm.tag).map((x) => x.replace(/^#/, '')), ...extractTags(body)]) {
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()];
}

function makeNote(path, chapter, slug, text) {
  const hit = parsed.get(path);
  if (hit && hit.text === text) return hit;
  const { data: fm, body } = parseFrontmatter(text);
  const note = {
    path, chapter, slug, text, fm, body,
    title: String(fm.title ?? '').trim() || titleFromSlug(slug),
    order: num(fm.order),
    author: fm.author ? String(fm.author) : '',
    created: isoOf(fm.created),
    updated: isoOf(fm.updated),
    aliases: listOf(fm.aliases ?? fm.alias),
    href: href('journal', chapter, slug),
  };
  let tags; let links; let plain;
  Object.defineProperties(note, {
    tags: { get: () => tags || (tags = collectTags(fm, body)) },
    links: { get: () => links || (links = extractLinks(body)) },
    plain: { get: () => plain ?? (plain = plainText(body)) },
  });
  parsed.set(path, note);
  return note;
}

function build() {
  const dirs = new Map();
  const notes = [];
  const ensure = (slug) => {
    if (!dirs.has(slug)) dirs.set(slug, { slug, meta: null, notes: [] });
    return dirs.get(slug);
  };
  const seen = new Set();
  for (const { path, data } of store.list(ROOT, { recursive: true })) {
    const segs = path.slice(PRE.length).split('/');
    if (segs.length === 2 && segs[1] === META) {
      ensure(segs[0]).meta = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      continue;
    }
    if (segs.length > 2 || !/\.md$/i.test(path) || typeof data !== 'string') continue;
    const chapter = segs.length === 2 ? segs[0] : LOOSE;
    if (chapter !== LOOSE) ensure(chapter);
    seen.add(path);
    notes.push(makeNote(path, chapter, stripExt(segs[segs.length - 1]), data));
  }
  for (const p of parsed.keys()) if (!seen.has(p)) parsed.delete(p);

  const chapters = [...dirs.values()].map((c) => {
    const m = c.meta || {};
    return Object.assign(c, {
      title: String(m.title || '').trim() || titleFromSlug(c.slug),
      order: num(m.order),
      description: String(m.description || ''),
      metaPath: `${PRE}${c.slug}/${META}`,
      href: href('journal', c.slug),
      loose: false,
    });
  }).sort(cmpOrder);
  chapters.forEach((c, i) => { c.num = i + 1; c.roman = roman(i + 1); c.label = `Chapter ${c.roman}`; });
  const loose = {
    slug: LOOSE, title: 'Loose Leaves', label: 'Loose Leaves', roman: '', loose: true, notes: [],
    description: '', meta: null, href: href('journal', LOOSE),
  };
  const bySlug = new Map(chapters.map((c) => [c.slug, c]));
  for (const n of notes) (n.chapter === LOOSE ? loose : bySlug.get(n.chapter)).notes.push(n);

  const book = [];
  for (const c of [...chapters, loose]) {
    c.notes.sort(cmpOrder);
    for (const n of c.notes) { n.index = book.length; n.folio = book.length + 1; n.chapterRef = c; book.push(n); }
  }
  const byTitle = new Map(); const byAlias = new Map(); const byNoteSlug = new Map(); const byPath = new Map(); const byFile = new Map();
  const first = (map, k, v) => { if (k && !map.has(k)) map.set(k, v); };
  for (const n of book) {
    first(byTitle, nameKey(n.title), n);
    n.aliases.forEach((a) => first(byAlias, nameKey(a), n));
    first(byNoteSlug, n.slug.toLowerCase(), n);
    byPath.set(`${n.chapter}/${n.slug}`.toLowerCase(), n);
    byFile.set(n.path, n);
  }
  return { chapters, loose, notes: book, bySlug, byTitle, byAlias, byNoteSlug, byPath, byFile };
}

// ---------- lookups ----------

export const noteByPath = (path, ix = index()) => ix.byFile.get(path) || null;
export const noteAt = (chapter, slug, ix = index()) => ix.byPath.get(`${chapter}/${slug}`.toLowerCase()) || null;

export function chapterAt(seg, ix = index()) {
  if (seg === LOOSE) return ix.loose;
  return ix.bySlug.get(seg) || ix.bySlug.get(String(seg || '').toLowerCase()) || null;
}

export const chapterOf = (note, ix = index()) => chapterAt(note.chapter, ix) || ix.loose;

/** Find a note by title, alias, file name / slug, or "Chapter/Note" path (case-insensitive). */
export function findNote(target, ix = index()) {
  const t = String(target || '').trim().replace(/\.md$/i, '');
  if (!t) return null;
  const k = nameKey(t);
  const direct = ix.byTitle.get(k) || ix.byAlias.get(k) || ix.byNoteSlug.get(t.toLowerCase()) || ix.byNoteSlug.get(slugify(t));
  if (direct) return direct;
  if (!t.includes('/')) return null;
  const rel = t.replace(/^content\/journal\//i, '').replace(/^\/+/, '');
  const cut = rel.lastIndexOf('/');
  const chapSeg = rel.slice(0, cut);
  const name = rel.slice(cut + 1);
  const ch = chapSeg === LOOSE ? ix.loose : findChapter(chapSeg, ix);
  if (!ch) return null;
  return ix.byPath.get(`${ch.slug}/${name}`.toLowerCase())
    || ch.notes.find((n) => nameKey(n.title) === nameKey(name) || n.slug === slugify(name)) || null;
}

export function findChapter(target, ix = index()) {
  const t = String(target || '').trim();
  if (!t) return null;
  if (t === LOOSE || nameKey(t) === 'loose leaves') return ix.loose;
  const k = nameKey(t);
  const s = slugify(t);
  return ix.bySlug.get(t) || ix.chapters.find((c) => nameKey(c.title) === k)
    || ix.chapters.find((c) => c.slug === s || nameKey(c.label) === k || c.roman.toLowerCase() === k) || null;
}

export function noteHref(note, anchor) {
  return note.href + (anchor ? `?h=${encodeURIComponent(slugify(anchor))}` : '');
}

export function hrefForPath(path) {
  const segs = path.slice(PRE.length).split('/');
  return href('journal', segs.length === 2 ? segs[0] : LOOSE, stripExt(segs[segs.length - 1]));
}

export function prevNext(note, ix = index()) {
  const i = ix.notes.findIndex((n) => n.path === note.path);
  return { prev: i > 0 ? ix.notes[i - 1] : null, next: i >= 0 && i < ix.notes.length - 1 ? ix.notes[i + 1] : null };
}

// ---------- composing ----------

export function composeNote(fm, body) {
  const out = {};
  for (const k of FM_ORDER) if (fm[k] !== undefined) out[k] = fm[k];
  for (const [k, v] of Object.entries(fm)) if (!(k in out)) out[k] = v;
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (Array.isArray(v) && !v.length) delete out[k];
  }
  return stringifyFrontmatter(out, body || '');
}

const now = () => new Date().toISOString();
const notePath = (chapter, slug) => (chapter === LOOSE ? `${PRE}${slug}.md` : `${PRE}${chapter}/${slug}.md`);

function uniqueSlug(base, taken) {
  const b = base || 'untitled';
  let s = b;
  let i = 2;
  while (taken.has(s.toLowerCase()) || RESERVED.has(s)) { s = `${b}-${i}`; i += 1; }
  return s;
}

const takenIn = (ch, except) => new Set(ch.notes.filter((n) => n.path !== except).map((n) => n.slug.toLowerCase()));
const nextOrder = (items) => items.reduce((m, x) => Math.max(m, x.order ?? 0), items.length) + 1;

// ---------- note operations ----------

export function createNote({ title, chapter = LOOSE, body = '' }) {
  const ix = index();
  const ch = chapterAt(chapter, ix) || ix.loose;
  const slug = uniqueSlug(slugify(title), takenIn(ch));
  const stamp = now();
  const fm = { title, order: nextOrder(ch.notes), author: getSetting('playerName') || undefined, created: stamp, updated: stamp };
  const path = notePath(ch.slug, slug);
  put(path, composeNote(fm, body));
  return path;
}

/** Write a note's frontmatter + body at its path (marks it updated unless touch:false). */
export function writeNote(path, fm, body, { touch = true } = {}) {
  const next = { ...fm };
  if (touch) next.updated = now();
  const text = composeNote(next, body);
  put(path, text);
  return text;
}

/** Move a note into another chapter. Returns the new path. */
export function moveNote(note, toChapter, { order } = {}) {
  const ix = index();
  const dest = chapterAt(toChapter, ix);
  if (!dest || dest.slug === note.chapter) return note.path;
  const slug = uniqueSlug(note.slug, takenIn(dest));
  const path = notePath(dest.slug, slug);
  put(path, composeNote({ ...note.fm, title: note.title, order: order ?? nextOrder(dest.notes) }, note.body));
  remove(note.path);
  return path;
}

/** Retitle a note; its file is renamed when the slug changes. Returns the (possibly new) path. */
export function renameNote(note, title, body = note.body) {
  const fm = { ...note.fm, title, updated: now() };
  const want = slugify(title);
  if (want === note.slug || want === slugify(note.slug)) {
    put(note.path, composeNote(fm, body));
    return note.path;
  }
  const ch = chapterOf(note);
  const path = notePath(ch.slug, uniqueSlug(want, takenIn(ch, note.path)));
  put(path, composeNote(fm, body));
  remove(note.path);
  return path;
}

export const deleteNote = (note) => remove(note.path);

export function reorderNotes(chapter, paths) {
  const ch = chapterAt(chapter);
  if (!ch) return;
  paths.forEach((p, i) => {
    const n = ch.notes.find((x) => x.path === p);
    if (n && n.order !== i + 1) put(n.path, composeNote({ ...n.fm, title: n.title, order: i + 1 }, n.body));
  });
}

export function shiftNote(note, delta) {
  const ch = chapterOf(note);
  const list = ch.notes.map((n) => n.path);
  const i = list.indexOf(note.path);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  reorderNotes(ch.slug, list);
  return true;
}

/** Drag-and-drop placement: move into `chapter` (if needed) at position `at`. Returns the note's path. */
export function placeNote(path, chapter, at) {
  const n = noteByPath(path);
  if (!n) return path;
  const p = n.chapter === chapter ? path : moveNote(n, chapter);
  const ch = chapterAt(chapter);
  if (!ch) return p;
  const list = ch.notes.map((x) => x.path).filter((x) => x !== p);
  list.splice(Math.max(0, Math.min(at, list.length)), 0, p);
  reorderNotes(chapter, list);
  return p;
}

// ---------- chapter operations ----------

export function createChapter({ title, description = '' }) {
  const ix = index();
  const slug = uniqueSlug(slugify(title), new Set(ix.chapters.map((c) => c.slug.toLowerCase())));
  put(`${PRE}${slug}/${META}`, { title, order: nextOrder(ix.chapters), description });
  return slug;
}

export function updateChapter(ch, patch) {
  if (ch.loose) return;
  put(ch.metaPath, { ...(ch.meta || {}), title: ch.title, order: ch.order ?? ch.num, description: ch.description, ...patch });
}

export function reorderChapters(slugs) {
  const ix = index();
  slugs.forEach((s, i) => {
    const c = ix.bySlug.get(s);
    if (c && (c.order !== i + 1 || !c.meta)) put(c.metaPath, { ...(c.meta || {}), title: c.title, order: i + 1, description: c.description });
  });
}

export function shiftChapter(ch, delta) {
  const list = index().chapters.map((c) => c.slug);
  const i = list.indexOf(ch.slug);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  reorderChapters(list);
  return true;
}

export function placeChapter(slug, at) {
  const list = index().chapters.map((c) => c.slug).filter((s) => s !== slug);
  list.splice(Math.max(0, Math.min(at, list.length)), 0, slug);
  reorderChapters(list);
}

/** Delete a chapter. mode 'loose' moves its notes to Loose Leaves, 'delete' removes them too. */
export function deleteChapter(ch, mode = 'loose') {
  if (ch.loose) return;
  const ix = index();
  if (mode === 'loose') {
    const taken = takenIn(ix.loose);
    let order = nextOrder(ix.loose.notes) - 1;
    for (const n of ch.notes) {
      const slug = uniqueSlug(n.slug, taken);
      taken.add(slug.toLowerCase());
      order += 1;
      put(notePath(LOOSE, slug), composeNote({ ...n.fm, title: n.title, order }, n.body));
      remove(n.path);
    }
  } else {
    ch.notes.forEach((n) => remove(n.path));
  }
  if (store.has(ch.metaPath)) remove(ch.metaPath);
}

// ---------- link rewriting (renames) ----------

const LINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;
const CODE_SPLIT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

export function rewriteLinks(src, test, replace) {
  let count = 0;
  const text = String(src || '').split(CODE_SPLIT).map((part, i) => (i % 2 ? part : part.replace(LINK_RE, (all, bang, body) => {
    const p = parseLink(body);
    if (!test(p)) return all;
    count += 1;
    return `${bang}[[${replace(p)}]]`;
  }))).join('');
  return { text, count };
}

const safeTarget = (s) => String(s).replace(/[|\]#]/g, ' ').replace(/\s+/g, ' ').trim();
const rebuild = (prefix, target, p) => `${prefix}${target}${p.anchor ? `#${p.anchor}` : ''}${p.alias ? `|${p.alias}` : ''}`;

/**
 * Plan for retargeting links after a note rename. `oldIx` must be the index from before the rename
 * so ambiguous titles keep pointing where they did. Returns {count, notes, apply()}.
 */
export function noteLinkPlan(oldIx, oldPath, newTitle, { exclude = [] } = {}) {
  const test = (p) => (!p.prefix || p.prefix === 'note') && !!p.target && findNote(p.target, oldIx)?.path === oldPath;
  const replace = (p) => rebuild(p.prefix ? 'note:' : '', safeTarget(newTitle), p);
  return linkPlan(test, replace, exclude);
}

export function chapterLinkPlan(oldIx, slug, newTitle) {
  const test = (p) => p.prefix === 'chapter' && !!p.target && findChapter(p.target, oldIx)?.slug === slug;
  return linkPlan(test, (p) => rebuild('chapter:', safeTarget(newTitle), p), []);
}

function linkPlan(test, replace, exclude) {
  const hits = [];
  for (const n of index().notes) {
    if (exclude.includes(n.path)) continue;
    const r = rewriteLinks(n.text, test, replace);
    if (r.count) hits.push({ path: n.path, title: n.title, count: r.count });
  }
  return {
    count: hits.reduce((s, x) => s + x.count, 0),
    notes: hits,
    apply() {
      let total = 0;
      for (const { path } of hits) {
        const n = noteByPath(path);
        if (!n) continue;
        const r = rewriteLinks(n.text, test, replace);
        if (r.count) { put(path, r.text); total += r.count; }
      }
      return total;
    },
  };
}

// ---------- queries ----------

const linksTo = (l, note, ix) => (!l.prefix || l.prefix === 'note') && !!l.target && findNote(l.target, ix) === note;

function contextOf(body, raws) {
  const lines = String(body || '').split('\n');
  const out = [];
  for (const raw of raws) {
    const line = lines.find((l) => l.includes(`[[${raw}]]`));
    const text = line ? plainText(line).slice(0, 220) : '';
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= 2) break;
  }
  return out;
}

/** Other notes linking to `note`: [{note, count, context:[line]}]. */
export function backlinks(note) {
  const ix = index();
  const out = [];
  for (const n of ix.notes) {
    if (n === note) continue;
    const hits = n.links.filter((l) => linksTo(l, note, ix));
    if (hits.length) out.push({ note: n, count: hits.length, context: contextOf(n.body, hits.map((l) => l.raw)) });
  }
  return out;
}

/** Notes that mention the title (or an alias) in plain text without linking to it. */
export function unlinkedMentions(note, linked = backlinks(note)) {
  const names = [note.title, ...note.aliases].filter((s) => s && s.length >= 3);
  if (!names.length) return [];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${names.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
  const skip = new Set(linked.map((b) => b.note));
  const out = [];
  for (const n of index().notes) {
    if (n === note || skip.has(n)) continue;
    const m = re.exec(n.plain);
    if (!m) continue;
    out.push({ note: n, ...snippet(n.plain, [m[2]], { radius: 60, max: 160 }) });
  }
  return out;
}

export function search(query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const keyTerms = terms.map((t) => nameKey(t));
  const out = [];
  for (const n of index().notes) {
    const title = nameKey(n.title);
    const body = nameKey(n.plain);
    const tags = n.tags.join(' ').toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of keyTerms) {
      const inTitle = title.includes(t);
      const inTags = tags.includes(t);
      const inBody = body.includes(t);
      if (!inTitle && !inTags && !inBody) { ok = false; break; }
      score += (inTitle ? 10 : 0) + (inTags ? 4 : 0) + (inBody ? 1 : 0);
    }
    if (ok) out.push({ note: n, score, ...snippet(n.plain, terms) });
  }
  return out.sort((a, b) => b.score - a.score || a.note.index - b.note.index);
}

export function tagMatches(tag, t) {
  const want = String(tag || '').toLowerCase().replace(/^#/, '');
  const l = String(t).toLowerCase();
  return l === want || l.startsWith(`${want}/`);
}

export const notesWithTag = (tag) => index().notes.filter((n) => n.tags.some((t) => tagMatches(tag, t)));

/** [{tag, count}] across all notes, most used first. */
export function allTags() {
  const map = new Map();
  for (const n of index().notes) {
    for (const t of n.tags) {
      const k = t.toLowerCase();
      if (!map.has(k)) map.set(k, { tag: t, count: 0 });
      map.get(k).count += 1;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || cmpText(a.tag, b.tag));
}

export function recentNotes(limit = 6) {
  const t = (n) => Date.parse(n.updated || n.created || '') || 0;
  return [...index().notes].sort((a, b) => t(b) - t(a)).slice(0, limit);
}

/** Un-prefixed [[links]] that resolve nowhere: pages yet to be written. [{title, from:[note]}] */
export function unwritten(limit = 8) {
  const map = new Map();
  for (const n of index().notes) {
    for (const l of n.links) {
      // skip files, and prefix-looking targets whose type is not registered (e.g. a view failed to load)
      if (l.prefix || !l.target || l.embed || /\.[a-z0-9]{2,4}$/i.test(l.target) || /^[a-z][a-z-]*:/i.test(l.target)) continue;
      const k = nameKey(l.target);
      if (map.has(k)) { const e = map.get(k); if (e && !e.from.includes(n)) e.from.push(n); continue; }
      const r = resolveLink(l.target);
      map.set(k, r.exists ? null : { title: l.target, from: [n] });
    }
  }
  return [...map.values()].filter(Boolean).sort((a, b) => b.from.length - a.from.length || cmpText(a.title, b.title)).slice(0, limit);
}

// ---------- link types ----------

let contextNote = null;
/** Run fn with `note` as the target of same-note links like [[#Heading]]. */
export function withNote(note, fn) {
  const prev = contextNote;
  contextNote = note;
  try { return fn(); } finally { contextNote = prev; }
}

const linkSafe = (s) => String(s).replace(/[|\]]/g, ' ');

registerLinkType('note', {
  label: 'Note',
  order: 0,
  resolve(target, anchor) {
    const n = target ? findNote(target) : contextNote;
    if (!n) return null;
    return { href: noteHref(n, anchor), title: anchor ? `${n.title} › ${anchor}` : n.title, exists: true };
  },
  suggest(q) {
    return matchNames(index().notes, q, (n) => n.title, 8).map((n) => ({ label: n.title, value: n.title }));
  },
  embed(target, anchor) {
    const n = target ? findNote(target) : contextNote;
    if (!n) return null;
    if (!anchor) return { markdown: n.body.trim() ? n.body : '*This page is blank.*' };
    return { markdown: sectionOf(n.body, anchor) ?? `*No section “${anchor}” on this page.*` };
  },
});

registerLinkType('chapter', {
  label: 'Chapter',
  order: 150, // after map/char/compendium so an un-prefixed [[X]] prefers those names
  resolve(target) {
    const c = findChapter(target);
    return c ? { href: c.href, title: c.loose ? c.title : `${c.label}: ${c.title}`, exists: true } : null;
  },
  suggest(q) {
    const ix = index();
    const list = ix.loose.notes.length ? [...ix.chapters, ix.loose] : ix.chapters;
    return matchNames(list, q, (c) => c.title, 6).map((c) => ({ label: c.title, value: c.title }));
  },
  embed(target) {
    const c = findChapter(target);
    if (!c) return null;
    const list = c.notes.map((n) => `- [[note:${n.chapter}/${n.slug}|${linkSafe(n.title)}]]`).join('\n');
    return { markdown: [c.description, list].filter(Boolean).join('\n\n') || '*No pages yet.*' };
  },
});
