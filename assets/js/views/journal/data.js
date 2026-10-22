// Journal data: an Obsidian-style vault under content/journal/ (see docs/journal-model.md).
// Folders are directories, nested to any depth; a folder may carry optional metadata in `_chapter.json`
// ({title, description, order}; it is also what keeps an empty folder in git). Notes are markdown files with
// YAML frontmatter {title, aliases, author, created, updated, tags, …}.
// Routes: #/journal/_/<note> (vault root), #/journal/<folder…>/<note>, #/journal/<folder…> (folder page),
// #/journal/_ (root folder page). Registers the `note:`, `folder:` and legacy `chapter:` link types.
import { store } from '../../core/store.js';
import { slugify, nameKey, stripExt } from '../../core/util.js';
import { parseFrontmatter, stringifyFrontmatter, extractLinks, extractTags } from '../../core/markdown.js';
import { registerLinkType, parseLink, resolveLink, matchNames } from '../../core/links.js';
import { href } from '../../core/router.js';
import { getSetting } from '../../core/settings.js';
import { plainText, plainLines, sectionOf, escapeRe, snippet, fold } from './text.js';

export const ROOT = 'content/journal';
export const ROOT_SEG = '_'; // route segment of the vault root ("Loose Leaves" in the old book)
export const META = '_chapter.json'; // folder metadata (name kept from the chapter days; see docs/journal-model.md)
export const VAULT_TITLE = 'Journal';
const PRE = `${ROOT}/`;
const RESERVED = new Set(['new', ROOT_SEG]); // top-level names the router uses
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

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const isoOf = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : '');
const listOf = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean)
  : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
export const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
const timeOf = (iso) => Date.parse(iso || '') || 0;

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

export const noteHrefFor = (folder, slug) => (folder ? href('journal', ...folder.split('/'), slug) : href('journal', ROOT_SEG, slug));

function makeNote(path, folder, slug, text) {
  const hit = parsed.get(path);
  if (hit && hit.text === text && hit.folder === folder) return hit;
  const { data: fm, body } = parseFrontmatter(text);
  const note = {
    path, folder, slug, text, fm, body,
    rel: folder ? `${folder}/${slug}` : slug,
    title: String(fm.title ?? '').trim() || titleFromSlug(slug),
    order: num(fm.order),
    author: fm.author ? String(fm.author) : '',
    created: isoOf(fm.created),
    updated: isoOf(fm.updated),
    aliases: listOf(fm.aliases ?? fm.alias),
    href: noteHrefFor(folder, slug),
  };
  note.ctime = timeOf(note.created);
  note.mtime = timeOf(note.updated) || note.ctime;
  let tags; let links; let plain; let lines; let folded;
  Object.defineProperties(note, {
    tags: { get: () => tags || (tags = collectTags(fm, body)) },
    links: { get: () => links || (links = extractLinks(body)) },
    plain: { get: () => plain ?? (plain = plainText(body)) },
    lines: { get: () => lines || (lines = plainLines(body)) },
    folded: { get: () => folded ?? (folded = fold(`${note.title}\n${plainText(body)}`)) },
  });
  parsed.set(path, note);
  return note;
}

function build() {
  const folders = new Map(); // lower-case folder path -> folder
  const mk = (path) => {
    const k = path.toLowerCase();
    if (folders.has(k)) return folders.get(k);
    const cut = path.lastIndexOf('/');
    const parent = path ? mk(cut < 0 ? '' : path.slice(0, cut)) : null;
    const f = {
      path, slug: path.slice(cut + 1), parent, meta: null, folders: [], notes: [],
      depth: parent ? parent.depth + 1 : -1, isRoot: !path,
    };
    folders.set(k, f);
    if (parent) parent.folders.push(f);
    return f;
  };
  const root = mk('');
  const notes = [];
  const seen = new Set();
  for (const { path, data } of store.list(ROOT, { recursive: true })) {
    const segs = path.slice(PRE.length).split('/');
    const name = segs.pop();
    if (segs.some((s) => !s)) continue;
    const dir = segs.join('/');
    if (name === META) { if (dir) mk(dir).meta = isObj(data) ? data : {}; continue; }
    if (!/\.md$/i.test(name) || typeof data !== 'string') continue;
    const f = mk(dir);
    const note = makeNote(path, f.path, stripExt(name), data);
    f.notes.push(note);
    notes.push(note);
    seen.add(path);
  }
  for (const p of parsed.keys()) if (!seen.has(p)) parsed.delete(p);

  const finish = (f) => {
    const m = f.meta || {};
    f.title = f.isRoot ? VAULT_TITLE : String(m.title || '').trim() || titleFromSlug(f.slug);
    f.order = num(m.order);
    f.description = String(m.description || '');
    f.metaPath = f.isRoot ? null : `${PRE}${f.path}/${META}`;
    f.href = folderHref(f.path);
    f.folders.forEach(finish);
    f.folders.sort((a, b) => cmpText(a.title, b.title));
    f.notes.sort((a, b) => cmpText(a.title, b.title) || cmpText(a.path, b.path));
    for (const n of f.notes) n.folderRef = f;
    f.count = f.notes.length + f.folders.reduce((s, c) => s + c.count, 0);
  };
  finish(root);
  const folderList = [];
  const walk = (f) => { folderList.push(f); f.folders.forEach(walk); };
  walk(root);

  // Shallow notes win ambiguous names (like Obsidian's shortest-path rule), then path order.
  const ordered = [...notes].sort((a, b) => a.rel.split('/').length - b.rel.split('/').length || cmpText(a.path, b.path));
  const byTitle = new Map(); const byAlias = new Map(); const byNoteSlug = new Map(); const byRel = new Map(); const byFile = new Map();
  const first = (map, k, v) => { if (k && !map.has(k)) map.set(k, v); };
  for (const n of ordered) {
    first(byTitle, nameKey(n.title), n);
    n.aliases.forEach((a) => first(byAlias, nameKey(a), n));
    first(byNoteSlug, n.slug.toLowerCase(), n);
    first(byRel, n.rel.toLowerCase(), n);
    byFile.set(n.path, n);
  }
  // A folder sharing its path with a note ("a/b" and "a/b.md") needs ?folder in its route.
  for (const f of folderList) if (!f.isRoot && byRel.has(f.path.toLowerCase())) f.href += '?folder=1';
  return { root, folders, folderList, notes: ordered, byTitle, byAlias, byNoteSlug, byRel, byFile };
}

// ---------- lookups ----------

export const noteByPath = (path, ix = index()) => ix.byFile.get(path) || null;
export const noteAtRel = (rel, ix = index()) => ix.byRel.get(String(rel || '').toLowerCase()) || null;
export const folderAt = (path, ix = index()) => ix.folders.get(String(path ?? '').toLowerCase()) || null;
export const folderOf = (note, ix = index()) => folderAt(note.folder, ix) || ix.root;
export const isUnder = (path, folderPath) => !folderPath || path === folderPath || path.startsWith(`${folderPath}/`);

/** Ancestors of a folder, root excluded, outermost first (the folder itself last). */
export function trail(folder) {
  const out = [];
  for (let f = folder; f && !f.isRoot; f = f.parent) out.unshift(f);
  return out;
}
export const folderLabel = (f) => (!f || f.isRoot ? VAULT_TITLE : trail(f).map((x) => x.title).join(' › '));

/**
 * Route parts -> {kind:'home'} | {kind:'note', note} | {kind:'folder', folder} | {kind:'missing', folder, slug, segs}.
 * Accepts #/journal/_/<note>, #/journal/<a>/<b>/<note> and the encoded form other views build
 * (href('journal', 'a', 'b/note') -> parts ['a', 'b/note']).
 */
export function resolveRoute(parts, query = {}) {
  let segs = parts.flatMap((p) => String(p).split('/')).filter(Boolean);
  const ix = index();
  if (!segs.length) return { kind: 'home' };
  const atRoot = segs[0] === ROOT_SEG;
  if (atRoot) segs = segs.slice(1);
  if (!segs.length) return { kind: 'folder', folder: ix.root };
  const rel = segs.join('/');
  const asFolder = 'folder' in query;
  const missing = () => ({ kind: 'missing', folder: folderAt(segs.slice(0, -1).join('/'), ix), slug: segs[segs.length - 1], segs });
  if (segs.length === 1 && !atRoot) {
    // #/journal/<x>: a top-level folder (the old chapter route), else a vault-root note.
    const f = folderAt(rel, ix);
    if (f) return { kind: 'folder', folder: f };
    const n = noteAtRel(rel, ix);
    return n ? { kind: 'note', note: n } : { kind: 'missing', folder: ix.root, slug: segs[0], segs, maybeFolder: true };
  }
  const n = !asFolder && noteAtRel(rel, ix);
  if (n) return { kind: 'note', note: n };
  const f = folderAt(rel, ix);
  if (f) return { kind: 'folder', folder: f };
  return missing();
}

/** Find a note by title, alias, file name / slug, or folder path ("Folder/Sub/Note", by slug or title). */
export function findNote(target, ix = index()) {
  const t = String(target || '').trim().replace(/\.md$/i, '');
  if (!t) return null;
  const k = nameKey(t);
  const direct = ix.byTitle.get(k) || ix.byAlias.get(k) || ix.byNoteSlug.get(t.toLowerCase()) || ix.byNoteSlug.get(slugify(t));
  if (direct) return direct;
  if (!t.includes('/')) return null;
  let rel = t.replace(/^content\/journal\//i, '').replace(/^\/+/, '');
  if (rel.startsWith(`${ROOT_SEG}/`)) rel = rel.slice(ROOT_SEG.length + 1);
  const exact = ix.byRel.get(rel.toLowerCase());
  if (exact) return exact;
  const cut = rel.lastIndexOf('/');
  const f = cut > 0 ? findFolder(rel.slice(0, cut), ix) : ix.root;
  const name = rel.slice(cut + 1);
  if (!f) return null;
  return f.notes.find((n) => nameKey(n.title) === nameKey(name) || n.slug === name.toLowerCase() || n.slug === slugify(name)) || null;
}

/** Find a folder by path, title or slug ("Sessions/Arc One" walks titles or slugs). "_" is the vault root. */
export function findFolder(target, ix = index()) {
  const t = String(target ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!t) return null;
  const k = nameKey(t);
  if (t === ROOT_SEG || k === 'loose leaves') return ix.root;
  const exact = folderAt(t, ix);
  if (exact) return exact;
  const match = (list, seg) => {
    const sk = nameKey(seg);
    const ss = slugify(seg);
    return list.find((f) => nameKey(f.title) === sk) || list.find((f) => f.slug.toLowerCase() === seg.toLowerCase() || f.slug === ss) || null;
  };
  if (t.includes('/')) {
    let f = ix.root;
    for (const seg of t.split('/').filter(Boolean)) { f = match(f.folders, seg); if (!f) return null; }
    return f;
  }
  return match(ix.folderList.filter((f) => !f.isRoot), t);
}

export function noteHref(note, anchor) {
  return note.href + (anchor ? `?h=${encodeURIComponent(slugify(anchor))}` : '');
}

export function folderHref(path) {
  return path ? href('journal', ...path.split('/')) : href('journal', ROOT_SEG);
}

export function hrefForPath(path) {
  const segs = path.slice(PRE.length).split('/');
  const slug = stripExt(segs.pop());
  return noteHrefFor(segs.join('/'), slug);
}

// ---------- sorting (file tree, folder pages) ----------

export const SORTS = [
  { id: 'name-asc', label: 'File name (A to Z)' },
  { id: 'name-desc', label: 'File name (Z to A)' },
  { id: 'mtime-desc', label: 'Modified time (new to old)' },
  { id: 'mtime-asc', label: 'Modified time (old to new)' },
  { id: 'ctime-desc', label: 'Created time (new to old)' },
  { id: 'ctime-asc', label: 'Created time (old to new)' },
];

export function sortNotes(list, sort = 'name-asc') {
  const byName = (a, b) => cmpText(a.title, b.title) || cmpText(a.path, b.path);
  const cmp = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    'mtime-desc': (a, b) => b.mtime - a.mtime || byName(a, b),
    'mtime-asc': (a, b) => a.mtime - b.mtime || byName(a, b),
    'ctime-desc': (a, b) => b.ctime - a.ctime || byName(a, b),
    'ctime-asc': (a, b) => a.ctime - b.ctime || byName(a, b),
  }[sort] || byName;
  return [...list].sort(cmp);
}

export function sortFolders(list, sort = 'name-asc') {
  const s = [...list].sort((a, b) => cmpText(a.title, b.title));
  return sort === 'name-desc' ? s.reverse() : s;
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
const notePath = (folder, slug) => `${PRE}${folder ? `${folder}/` : ''}${slug}.md`;
const metaPathOf = (folder) => `${PRE}${folder}/${META}`;
const childPath = (parent, slug) => (parent.isRoot ? slug : `${parent.path}/${slug}`);

function uniqueSlug(base, taken, reserved = null) {
  const b = base || 'untitled';
  let s = b;
  let i = 2;
  while (taken.has(s.toLowerCase()) || reserved?.has(s)) { s = `${b}-${i}`; i += 1; }
  return s;
}

/** Names in use inside a folder (notes and subfolders share a namespace, as their routes do). */
function takenIn(f, { exceptNote = null, exceptFolder = null } = {}) {
  const s = new Set();
  for (const n of f.notes) if (n.path !== exceptNote) s.add(n.slug.toLowerCase());
  for (const c of f.folders) if (c !== exceptFolder) s.add(c.slug.toLowerCase());
  return s;
}

/** Give a folder without metadata a _chapter.json before its last item leaves, so it stays (as in Obsidian). */
function keepFolder(f, leaving = 1) {
  if (!f || f.isRoot || f.meta || f.notes.length + f.folders.length > leaving) return;
  put(metaPathOf(f.path), { title: f.title });
}

// ---------- note operations ----------

export function createNote({ title, folder = '', body = '' }) {
  const ix = index();
  const f = (typeof folder === 'string' ? folderAt(folder, ix) : folder) || ix.root;
  const slug = uniqueSlug(slugify(title), takenIn(f));
  const stamp = now();
  const fm = { title, author: getSetting('playerName') || undefined, created: stamp, updated: stamp };
  const path = notePath(f.path, slug);
  put(path, composeNote(fm, body));
  return path;
}

/** A fresh title like "Untitled", "Untitled 2" … not used by any note in the folder. */
export function freshTitle(folder, base = 'Untitled') {
  const f = (typeof folder === 'string' ? folderAt(folder) : folder) || index().root;
  const names = new Set([...f.notes.map((n) => nameKey(n.title)), ...f.notes.map((n) => n.slug), ...f.folders.map((c) => nameKey(c.title))]);
  let t = base;
  for (let i = 2; names.has(nameKey(t)) || names.has(slugify(t)); i++) t = `${base} ${i}`;
  return t;
}

/** Write a note's frontmatter + body at its path (marks it updated unless touch:false). */
export function writeNote(path, fm, body, { touch = true } = {}) {
  const next = { ...fm };
  if (touch) next.updated = now();
  const text = composeNote(next, body);
  put(path, text);
  return text;
}

/** Move a note into another folder (the file is moved as-is). Returns the new path. */
export function moveNote(note, toFolder) {
  const ix = index();
  const dest = typeof toFolder === 'string' ? folderAt(toFolder, ix) : toFolder;
  if (!dest || dest.path.toLowerCase() === note.folder.toLowerCase()) return note.path;
  keepFolder(folderOf(note, ix));
  const path = notePath(dest.path, uniqueSlug(note.slug, takenIn(dest)));
  put(path, note.text);
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
  const f = folderOf(note);
  const path = notePath(f.path, uniqueSlug(want, takenIn(f, { exceptNote: note.path })));
  put(path, composeNote(fm, body));
  remove(note.path);
  return path;
}

export function deleteNote(note) {
  keepFolder(folderOf(note));
  remove(note.path);
}

/** Replace a note's frontmatter (title kept), body untouched. */
export function setProperties(note, fm) {
  const next = { ...fm, title: note.title };
  if (note.fm.created && !next.created) next.created = note.fm.created;
  return writeNote(note.path, next, note.body);
}

// ---------- folder operations ----------

export function createFolder({ title, parent = '', description = '' }) {
  const ix = index();
  const p = (typeof parent === 'string' ? folderAt(parent, ix) : parent) || ix.root;
  const slug = uniqueSlug(slugify(title), takenIn(p), p.isRoot ? RESERVED : null);
  const path = childPath(p, slug);
  put(metaPathOf(path), description ? { title, description } : { title });
  return path;
}

export function updateFolder(f, patch) {
  if (f.isRoot) return;
  put(f.metaPath, { ...(f.meta || {}), title: f.title, ...patch });
}

/**
 * Move every file under folder `f` to `newPath` (notes, nested metadata, attachments). The folder's own metadata
 * is rewritten with `patch`. Returns a Map of old -> new note paths.
 */
function relocate(f, newPath, patch = {}) {
  const from = `${PRE}${f.path}/`;
  const to = `${PRE}${newPath}/`;
  const moved = new Map();
  const docs = new Set();
  for (const { path, data } of store.list(`${ROOT}/${f.path}`, { recursive: true })) {
    docs.add(path);
    const dest = to + path.slice(from.length);
    if (path === f.metaPath) continue;
    put(dest, data);
    remove(path);
    if (/\.md$/i.test(path)) moved.set(path, dest);
  }
  put(metaPathOf(newPath), { ...(f.meta || {}), title: f.title, ...patch });
  if (store.has(f.metaPath)) remove(f.metaPath);
  // Binary attachments (images) are not mirrored as docs: copy their bytes, then drop the old file.
  for (const file of store.files(from)) {
    if (docs.has(file.path) || file.path === f.metaPath) continue;
    const dest = to + file.path.slice(from.length);
    store.fileBlob(file.path).then((blob) => (blob ? store.putBinary(dest, blob).then(() => store.remove(file.path)) : null))
      .catch((e) => console.warn('[journal] could not move', file.path, e));
  }
  return moved;
}

/** Rename a folder: new title, and its directory follows the title's slug. Returns {path, moved}. */
export function renameFolder(f, title) {
  if (f.isRoot) return { path: '', moved: new Map() };
  const want = slugify(title);
  if (want === f.slug.toLowerCase() || want === slugify(f.slug)) {
    updateFolder(f, { title });
    return { path: f.path, moved: new Map() };
  }
  const slug = uniqueSlug(want, takenIn(f.parent, { exceptFolder: f }), f.parent.isRoot ? RESERVED : null);
  const path = childPath(f.parent, slug);
  return { path, moved: relocate(f, path, { title }) };
}

export const canMoveFolder = (f, dest) => !!dest && !f.isRoot && dest !== f.parent && !isUnder(dest.path, f.path);

/** Move a folder (with everything in it) under `dest`. Returns {path, moved} or null when not allowed. */
export function moveFolder(f, dest) {
  if (!canMoveFolder(f, dest)) return null;
  keepFolder(f.parent);
  const path = childPath(dest, uniqueSlug(f.slug, takenIn(dest), dest.isRoot ? RESERVED : null));
  return { path, moved: relocate(f, path) };
}

/** Every note under a folder (recursive). */
export function notesUnder(f) {
  const out = [...f.notes];
  f.folders.forEach((c) => out.push(...notesUnder(c)));
  return out;
}

/**
 * Delete a folder. mode 'delete' removes everything in it; 'keep' moves its notes and subfolders up into the
 * parent folder first. Returns a Map of old -> new note paths for kept notes.
 */
export function deleteFolder(f, mode = 'delete') {
  if (f.isRoot) return new Map();
  const moved = new Map();
  if (mode === 'keep') {
    const parent = f.parent;
    const taken = takenIn(parent, { exceptFolder: f });
    for (const c of f.folders) {
      const slug = uniqueSlug(c.slug, taken, parent.isRoot ? RESERVED : null);
      taken.add(slug.toLowerCase());
      relocate(c, childPath(parent, slug)).forEach((v, k) => moved.set(k, v));
    }
    for (const n of f.notes) {
      const slug = uniqueSlug(n.slug, taken);
      taken.add(slug.toLowerCase());
      const dest = notePath(parent.path, slug);
      put(dest, n.text);
      remove(n.path);
      moved.set(n.path, dest);
    }
    keepFolder(parent, 1);
  } else {
    keepFolder(f.parent);
    for (const { path } of store.list(`${ROOT}/${f.path}`, { recursive: true })) remove(path);
    for (const file of store.files(`${PRE}${f.path}/`)) remove(file.path); // attachments
  }
  if (store.has(f.metaPath)) remove(f.metaPath);
  return moved;
}

// ---------- link rewriting (renames and moves) ----------

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
const relOfPath = (path) => stripExt(path.slice(PRE.length));

/**
 * Plan for retargeting links after a note rename. `oldIx` must be the index from before the rename
 * so ambiguous titles keep pointing where they did. Returns {count, notes, apply()}.
 */
export function noteLinkPlan(oldIx, oldPath, newTitle, { exclude = [], newPath = null } = {}) {
  const test = (p) => (!p.prefix || p.prefix === 'note') && !!p.target && findNote(p.target, oldIx)?.path === oldPath;
  const replace = (p) => rebuild(p.prefix ? 'note:' : '', p.target.includes('/') && newPath ? relOfPath(newPath) : safeTarget(newTitle), p);
  return linkPlan(test, replace, exclude);
}

/** Path-style links ([[folder/note]]) to notes that moved: Map old path -> new path. */
export function pathLinkPlan(oldIx, moved, { exclude = [] } = {}) {
  const test = (p) => (!p.prefix || p.prefix === 'note') && !!p.target && p.target.includes('/') && moved.has(findNote(p.target, oldIx)?.path);
  const replace = (p) => rebuild(p.prefix ? 'note:' : '', relOfPath(moved.get(findNote(p.target, oldIx).path)), p);
  return linkPlan(test, replace, exclude);
}

/** [[folder:…]] / [[chapter:…]] links to a renamed folder. */
export function folderLinkPlan(oldIx, folderPath, newTitle, { exclude = [] } = {}) {
  const test = (p) => (p.prefix === 'chapter' || p.prefix === 'folder') && !!p.target && findFolder(p.target, oldIx)?.path === folderPath;
  return linkPlan(test, (p) => rebuild(`${p.prefix}:`, safeTarget(newTitle), p), exclude);
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
    const i = lines.findIndex((l) => l.includes(`[[${raw}]]`));
    const text = i >= 0 ? plainText(lines[i]).slice(0, 220) : '';
    if (text && !out.some((o) => o.text === text)) out.push({ text, line: i });
    if (out.length >= 3) break;
  }
  return out;
}

/** Other notes linking to `note`: [{note, count, context:[{text, line}]}]. */
export function backlinks(note) {
  const ix = index();
  const out = [];
  for (const n of ix.notes) {
    if (n === note) continue;
    const hits = n.links.filter((l) => linksTo(l, note, ix));
    if (hits.length) out.push({ note: n, count: hits.length, context: contextOf(n.body, hits.map((l) => l.raw)) });
  }
  return out.sort((a, b) => cmpText(a.note.title, b.note.title));
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
  return out.sort((a, b) => cmpText(a.note.title, b.note.title));
}

/** Links going out of a note, one row per target: [{raw, label, href, exists, kind, embed, count}]. */
export function outgoing(note, body = note.body) {
  const list = body === note.body ? note.links : extractLinks(body);
  const rows = new Map();
  withNote(note, () => {
    for (const l of list) {
      if (!l.target) continue; // [[#Heading]] on the same page
      let r;
      try { r = resolveLink(l.raw); } catch { continue; }
      const key = r.exists ? r.href.replace(/\?h=.*$/, '') : `?${nameKey(l.target)}`;
      const row = rows.get(key);
      if (row) { row.count += 1; continue; }
      rows.set(key, {
        raw: l.raw, label: l.alias || l.target, target: l.target, href: r.href, exists: !!r.exists,
        kind: r.kind || l.prefix || 'note', embed: l.embed, count: 1, title: r.title,
      });
    }
  });
  return [...rows.values()];
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

/**
 * Nested tags as a tree: [{name, tag, key, count, own, children}] where `count` = notes carrying the tag or any
 * tag below it, `own` = notes carrying exactly this tag.
 */
export function tagTree() {
  const root = { children: new Map() };
  const node = (parent, name, tag) => {
    const k = name.toLowerCase();
    if (!parent.children.has(k)) parent.children.set(k, { name, tag, key: tag.toLowerCase(), notes: new Set(), own: 0, children: new Map() });
    return parent.children.get(k);
  };
  for (const n of index().notes) {
    for (const t of n.tags) {
      const parts = t.split('/').filter(Boolean);
      let at = root;
      parts.forEach((p, i) => {
        at = node(at, p, parts.slice(0, i + 1).join('/'));
        at.notes.add(n);
        if (i === parts.length - 1) at.own += 1;
      });
    }
  }
  const finish = (m) => [...m.values()].map((x) => ({ name: x.name, tag: x.tag, key: x.key, count: x.notes.size, own: x.own, children: finish(x.children) }));
  return finish(root.children);
}

export function recentNotes(limit = 6) {
  return [...index().notes].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
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

const folderLinkType = (legacy) => ({
  label: 'Folder',
  order: 150, // after map/char/compendium so an un-prefixed [[X]] prefers those names
  resolve(target) {
    const f = findFolder(target);
    return f ? { href: f.href, title: f.isRoot ? VAULT_TITLE : `${folderLabel(f)} (folder)`, exists: true } : null;
  },
  suggest: legacy ? undefined : (q) => matchNames(index().folderList.filter((f) => !f.isRoot), q, (f) => f.title, 6)
    .map((f) => ({ label: f.title, value: f.title })),
  embed(target) {
    const f = findFolder(target);
    if (!f) return null;
    const list = [
      ...f.folders.map((c) => `- [[folder:${c.path}|${linkSafe(c.title)}]] (folder)`),
      ...f.notes.map((n) => `- [[note:${n.rel}|${linkSafe(n.title)}]]`),
    ].join('\n');
    return { markdown: [f.description, list].filter(Boolean).join('\n\n') || '*Nothing in this folder yet.*' };
  },
});
registerLinkType('folder', folderLinkType(false));
registerLinkType('chapter', folderLinkType(true)); // [[chapter:X]] from the book days still resolves to the folder
