// Journal data: an Obsidian-style vault under content/journal/ (see docs/journal-model.md).
// Folders are directories, nested to any depth; a folder may carry optional metadata in `_chapter.json`
// ({title, description, order}; it is also what keeps an empty folder in git). Notes are markdown files with
// YAML frontmatter {title, aliases, author, created, updated, tags, …}.
// Routes: #/journal/_/<note> (vault root), #/journal/<folder…>/<note>, #/journal/<folder…> (folder page),
// #/journal/_ (root folder page). Registers the `note:`, `folder:` and legacy `chapter:` link types.
import { store } from '../../core/store.js';
import { slugify, nameKey, stripExt, uid } from '../../core/util.js';
import { parseFrontmatter, stringifyFrontmatter, extractLinks, extractTags } from '../../core/markdown.js';
import { registerLinkType, parseLink, resolveLink, matchNames, linkClosed } from '../../core/links.js';
import { href } from '../../core/router.js';
import { getSetting } from '../../core/settings.js';
import { isHidden, isReleased } from '../../core/dm.js';
import { plainText, plainLines, sectionOf, escapeRe, snippet, fold } from './text.js';

export const ROOT = 'content/journal';
export const ROOT_SEG = '_'; // route segment of the vault root ("Loose Leaves" in the old book)
export const META = '_chapter.json'; // folder metadata (name kept from the chapter days; see docs/journal-model.md)
export const VAULT_TITLE = 'Journal';
export const TRASH = 'content/journal-trash'; // Recently deleted (outside the vault: see "recently deleted" below)
export const TRASH_SEG = 'recently-deleted'; // #/journal/recently-deleted
export const TRASH_TITLE = 'Recently deleted';
const PRE = `${ROOT}/`;
const RESERVED = new Set(['new', ROOT_SEG, TRASH_SEG]); // top-level names the router uses
const FM_ORDER = ['title', 'aliases', 'order', 'author', 'created', 'updated', 'tags'];

// ---------- writes (tracked so the view can ignore its own echoes) ----------

let selfDepth = 0;
export const isSelfWrite = () => selfDepth > 0;
function quietly(fn) { selfDepth += 1; try { return fn(); } finally { selfDepth -= 1; } }
export const put = (path, data, opts) => quietly(() => store.put(path, data, opts)); // opts.hidden: DM mode (core/dm.js)
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
  if (segs.length === 1 && segs[0] === TRASH_SEG) return { kind: 'trash' };
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

/** hidden (DM mode): create it hidden from the players (null = the DM's default). */
export function createNote({ title, folder = '', body = '', hidden = null }) {
  const ix = index();
  const f = (typeof folder === 'string' ? folderAt(folder, ix) : folder) || ix.root;
  const slug = uniqueSlug(slugify(title), takenIn(f));
  const stamp = now();
  const fm = { title, author: getSetting('playerName') || undefined, created: stamp, updated: stamp };
  const path = notePath(f.path, slug);
  put(path, composeNote(fm, body), { hidden });
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
  put(path, note.text, { hidden: isHidden(note.path) }); // a hidden note stays hidden, a visible one visible
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
  put(path, composeNote(fm, body), { hidden: isHidden(note.path) }); // the renamed file keeps its visibility
  remove(note.path);
  return path;
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
    put(dest, data, { hidden: isHidden(path) });
    remove(path);
    if (/\.md$/i.test(path)) moved.set(path, dest);
  }
  put(metaPathOf(newPath), { ...(f.meta || {}), title: f.title, ...patch });
  if (store.has(f.metaPath)) remove(f.metaPath);
  // Binary attachments (images) are not mirrored as docs: copy their bytes, then drop the old file.
  for (const file of store.files(from)) {
    if (docs.has(file.path) || file.path === f.metaPath) continue;
    const dest = to + file.path.slice(from.length);
    const hidden = isHidden(file.path);
    store.fileBlob(file.path).then((blob) => (blob ? store.putBinary(dest, blob, { hidden }).then(() => store.remove(file.path)) : null))
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

// ---------- recently deleted (content/journal-trash/<id>/…, restorable until emptied) ----------
// A deleted note or folder moves to content/journal-trash/<id>/ under its own vault path
// (…/<id>/sessions/old-mill.md; a folder with everything in it), so restoring puts it back where it was. Outside
// content/journal/, the vault, links and search never see it. <id>/_deleted.json records {type, title, path,
// parents: [{path, title}], at, by}. Hidden notes (DM mode) stay sealed in the trash, and the record of a hidden note
// keeps only {type, at}: its name and place are worked out from its file, which only the DM can open.

const TPRE = `${TRASH}/`;
const TMETA = '_deleted.json';
export const isTrashPath = (p) => String(p || '').startsWith(TPRE);
export const touchesTrash = (e) => e.type === 'load' || isTrashPath(e.path) || (Array.isArray(e.paths) && e.paths.some(isTrashPath));
export const TRASH_HREF = href('journal', TRASH_SEG);

/** Documents under a prefix ([{path, data}]) and the other files there (attachments, paths only). */
function filesUnder(pre) {
  const docs = store.list(pre, { recursive: true });
  const seen = new Set(docs.map((d) => d.path));
  return { docs, bins: store.files(pre).map((f) => f.path).filter((p) => !seen.has(p)) };
}

/** Move a binary file (bytes copied, same visibility, then the original removed). */
function moveBinary(from, dest) {
  const hidden = isHidden(from);
  return store.fileBlob(from).then((blob) => (blob ? store.putBinary(dest, blob, { hidden }).then(() => store.remove(from)) : null))
    .catch((e) => console.warn('[journal] could not move', from, e));
}

function deletionRecord(type, title, path, parent) {
  return { type, title, path, parents: trail(parent).map((x) => ({ path: x.path, title: x.title })), at: now(), by: getSetting('playerName') || '' };
}

/** Move a note to Recently deleted. Returns its trash id. */
export function trashNote(note) {
  const f = folderOf(note);
  const id = uid(note.title);
  const rel = note.path.slice(PRE.length);
  const hidden = isHidden(note.path);
  keepFolder(f);
  put(`${TPRE}${id}/${rel}`, note.text, { hidden });
  put(`${TPRE}${id}/${TMETA}`, hidden ? { type: 'note', at: now() } : deletionRecord('note', note.title, rel, f), { hidden: false });
  remove(note.path);
  return id;
}

/** Move a folder and everything in it to Recently deleted. Returns its trash id (null for the vault root). */
export function trashFolder(f) {
  if (f.isRoot) return null;
  const id = uid(f.title);
  const base = `${TPRE}${id}/`;
  const { docs, bins } = filesUnder(`${PRE}${f.path}/`);
  // A folder holding only hidden notes (and no metadata) is one the players never saw: its record names nothing either.
  const secret = !f.meta && [...docs.map((d) => d.path), ...bins].every((p) => isHidden(p));
  keepFolder(f.parent);
  put(`${base}${TMETA}`, secret ? { type: 'folder', at: now() } : deletionRecord('folder', f.title, f.path, f.parent), { hidden: false });
  if (!f.meta && !secret) put(`${base}${f.path}/${META}`, { title: f.title }, { hidden: false }); // keeps its name if it comes back empty
  for (const { path, data } of docs) {
    put(base + path.slice(PRE.length), data, { hidden: isHidden(path) });
    remove(path);
  }
  for (const p of bins) moveBinary(p, base + p.slice(PRE.length));
  return id;
}

const dirOf = (rel) => rel.split('/').slice(0, -1).join('/');
function commonDir(rels) {
  let segs = dirOf(rels[0]).split('/').filter(Boolean);
  for (const r of rels.slice(1)) {
    const s = r.split('/').slice(0, -1);
    let i = 0;
    while (i < segs.length && i < s.length && segs[i] === s[i]) i += 1;
    segs = segs.slice(0, i);
  }
  return segs.join('/');
}

function trashedNote(path, rel, text) {
  const { data: fm, body } = parseFrontmatter(text);
  const slug = stripExt(rel.split('/').pop());
  return { path, rel, slug, text, fm, body, title: String(fm.title ?? '').trim() || titleFromSlug(slug) };
}

function entryOf(id, docs, bins, meta) {
  const base = `${TPRE}${id}/`;
  const rels = [...docs.map((d) => d.path), ...bins].map((p) => p.slice(base.length));
  if (!rels.length) return null; // only a record left (its files restored, or a hidden note the DM can open)
  const notes = docs.filter((d) => /\.md$/i.test(d.path) && typeof d.data === 'string')
    .map((d) => trashedNote(d.path, d.path.slice(base.length), d.data)).sort((a, b) => cmpText(a.rel, b.rel));
  const m = meta || {};
  let type = m.type === 'note' || m.type === 'folder' ? m.type : null;
  let path = typeof m.path === 'string' && m.path ? m.path : null;
  if (type === 'note' && !path && notes.length === 1) path = notes[0].rel; // a hidden note: its record names nothing
  if (!type || !path) { // no full record (hidden files left behind when someone restored the rest): read the files
    if (notes.length === 1 && rels.length === 1) { type = 'note'; path = notes[0].rel; }
    else { type = 'folder'; path = commonDir(rels); }
  }
  const folderMeta = type === 'folder' ? docs.find((d) => d.path === `${base}${path}/${META}`)?.data : null;
  const title = String(m.title || '').trim()
    || (type === 'note' ? notes.find((n) => n.rel === path)?.title : String(folderMeta?.title || '').trim())
    || titleFromSlug(stripExt(path.split('/').pop() || '')) || 'Untitled';
  const paths = [...docs.map((d) => d.path), ...bins];
  return {
    id, type, title, path, parent: dirOf(path), parents: Array.isArray(m.parents) ? m.parents.filter((p) => p && typeof p.path === 'string') : [],
    at: m.at ? String(m.at) : '', by: m.by ? String(m.by) : '', notes, docs, bins,
    metaPath: meta ? `${base}${TMETA}` : null, hidden: paths.every((p) => isHidden(p)),
  };
}

/** Recently deleted, newest first: [{id, type: 'note'|'folder', title, path, parent, parents, at, by, notes, docs, bins, metaPath, hidden}]. */
export function trashEntries() {
  const groups = new Map();
  const group = (p) => {
    const rest = p.slice(TPRE.length);
    const cut = rest.indexOf('/');
    if (cut <= 0) return null;
    const id = rest.slice(0, cut);
    if (!groups.has(id)) groups.set(id, { id, docs: [], bins: [], meta: null });
    return { g: groups.get(id), name: rest.slice(cut + 1) };
  };
  const { docs, bins } = filesUnder(TPRE);
  for (const d of docs) {
    const x = group(d.path);
    if (!x) continue;
    if (x.name === TMETA) x.g.meta = isObj(d.data) ? d.data : {};
    else x.g.docs.push(d);
  }
  for (const p of bins) group(p)?.g.bins.push(p);
  return [...groups.values()].map((g) => entryOf(g.id, g.docs, g.bins, g.meta)).filter(Boolean)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || cmpText(a.title, b.title));
}

export const trashEntry = (id) => trashEntries().find((e) => e.id === id) || null;
/** How many items Recently deleted holds (the Files pane's count; ids with a file this device can see). */
export function trashCount() {
  const ids = new Set();
  const { docs, bins } = filesUnder(TPRE);
  for (const p of [...docs.map((d) => d.path), ...bins]) {
    const rest = p.slice(TPRE.length);
    const cut = rest.indexOf('/');
    if (cut > 0 && rest.slice(cut + 1) !== TMETA) ids.add(rest.slice(0, cut));
  }
  return ids.size;
}
/** Every note waiting in Recently deleted (their reference photos are kept until they are deleted for good). */
export const trashedNotes = () => trashEntries().flatMap((e) => e.notes);

/** Where an entry came from, for people: "Sessions › Arc one", or the journal itself. */
export function trashFrom(e) {
  if (!e.parent) return VAULT_TITLE;
  const known = new Map(e.parents.map((p) => [p.path.toLowerCase(), p.title]));
  const segs = e.parent.split('/');
  return segs.map((s, i) => {
    const p = segs.slice(0, i + 1).join('/');
    return known.get(p.toLowerCase()) || folderAt(p)?.title || titleFromSlug(s);
  }).join(' › ');
}

const fileExists = (p) => store.has(p) || store.files(p).some((f) => f.path === p);

/** A free vault-relative path for a note coming back: its own, or "name-2"… when its folder has that name now. */
function freeNotePath(rel) {
  const dir = dirOf(rel);
  const f = folderAt(dir); // fresh index: notes put back a moment ago count
  const name = rel.split('/').pop();
  const slug = stripExt(name);
  if (!f) return rel; // a folder that isn't there holds nothing to clash with
  const fresh = uniqueSlug(slug, takenIn(f));
  return fresh === slug ? rel : `${dir ? `${dir}/` : ''}${fresh}${name.slice(slug.length)}`;
}

/** A free full path for an attachment coming back ("photo-2.png" when the name is taken). */
function freeFilePath(p) {
  if (!fileExists(p)) return p;
  const dot = p.lastIndexOf('.');
  const stem = dot > p.lastIndexOf('/') ? p.slice(0, dot) : p;
  const ext = p.slice(stem.length);
  let i = 2;
  while (fileExists(`${stem}-${i}${ext}`)) i += 1;
  return `${stem}-${i}${ext}`;
}

/**
 * Put an entry back where it was: in its folder (made again, with its old name, if it is gone since), under its own
 * name. A note whose name is taken there now comes back as "name-2" (both kept); a folder whose name is taken there
 * now joins that folder (its notes keep their names unless one there already has it). Returns
 * {type, path (the note's file or the folder's path), href, renamed, merged}.
 */
export function restoreEntry(e) {
  const base = `${TPRE}${e.id}/`;
  for (const p of e.parents) if (!folderAt(p.path) && p.title) put(metaPathOf(p.path), { title: p.title }); // folders deleted since
  const isNote = e.type === 'note';
  const dest = isNote && e.path ? freeNotePath(e.path) : e.path;
  const merged = !isNote && !!e.path && !!folderAt(dest);
  const target = (rel) => (e.path && (rel === e.path || rel.startsWith(`${e.path}/`)) ? dest + rel.slice(e.path.length) : rel);
  for (const { path, data } of e.docs) {
    let to = target(path.slice(base.length));
    if (/\.md$/i.test(to)) to = freeNotePath(to);
    else if (fileExists(PRE + to)) { remove(path); continue; } // folder metadata already there (a merge): theirs stays
    put(PRE + to, data, { hidden: isHidden(path) });
    remove(path);
  }
  for (const p of e.bins) moveBinary(p, freeFilePath(PRE + target(p.slice(base.length))));
  if (e.metaPath && store.has(e.metaPath)) remove(e.metaPath);
  return {
    type: e.type, path: isNote ? PRE + dest : dest, renamed: dest !== e.path, merged,
    href: isNote ? hrefForPath(PRE + dest) : folderHref(dest),
  };
}

/** Delete an entry for good (its files; reference photos are the caller's: see trash.js). */
export function purgeEntry(e) {
  for (const { path } of e.docs) remove(path);
  for (const p of e.bins) store.remove(p);
  if (e.metaPath && store.has(e.metaPath)) remove(e.metaPath);
}

/** Empty Recently deleted (everything under it this device can see, stray records too). */
export function emptyTrash() {
  const { docs, bins } = filesUnder(TPRE);
  for (const { path } of docs) remove(path);
  for (const p of bins) store.remove(p);
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
/**
 * Does an un-prefixed link to nothing in this note start a note? Yes in the players' own notes; in a note the DM
 * released it says the page hasn't been revealed yet (links.js linkClosed), like links everywhere else.
 */
export const startsNotes = (note) => !note || !isReleased(note.path);

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
        kind: r.kind || l.prefix || 'note', embed: l.embed, count: 1, title: r.title, closed: linkClosed(r, { startNotes: startsNotes(note) }),
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
    return { href: noteHref(n, anchor), title: anchor ? `${n.title} › ${anchor}` : n.title, exists: true, path: n.path };
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
