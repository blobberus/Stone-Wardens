// Warden's Library model: which files are documents, their types, display names, shelves and lookups.
import { store } from '../../core/store.js';
import { href } from '../../core/router.js';
import { extOf, baseName, stripExt, nameKey, sortBy } from '../../core/util.js';

export const VIEW = 'wardens-library';
export const ROOT = 'wardens-library/';
export const README = `${ROOT}README.md`;

export const TYPES = {
  pdf: { key: 'pdf', label: 'PDF', icon: 'file-pdf', order: 1 },
  word: { key: 'word', label: 'Word', icon: 'file-doc', order: 2 },
  markdown: { key: 'markdown', label: 'Markdown', icon: 'book-open', order: 3 },
  text: { key: 'text', label: 'Text', icon: 'file', order: 4 },
  image: { key: 'image', label: 'Image', icon: 'image', order: 5 },
  audio: { key: 'audio', label: 'Audio', icon: 'file', order: 6 },
  video: { key: 'video', label: 'Video', icon: 'file', order: 7 },
  other: { key: 'other', label: 'Other', icon: 'file', order: 8 },
};

const EXT_TYPE = {
  pdf: 'pdf',
  docx: 'word', doc: 'word',
  md: 'markdown', markdown: 'markdown',
  txt: 'text', csv: 'text', tsv: 'text', log: 'text', json: 'text', yml: 'text', yaml: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  mp3: 'audio', ogg: 'audio', oga: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', m4v: 'video', mov: 'video', ogv: 'video',
};

export const typeOf = (path) => TYPES[EXT_TYPE[extOf(path)] || 'other'];

/** Accept list for the upload picker. */
export const ACCEPT = '.pdf,.docx,.doc,.md,.txt,.png,.jpg,.jpeg,.webp,.gif';

// Files above this aren't cached offline by the store and are slow to push through the API.
export const LARGE_BYTES = 25 * 1024 * 1024;
// GitHub rejects blobs above 100 MB.
export const MAX_BYTES = 100 * 1024 * 1024;

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'at', 'by', 'vs', 'with']);

/** "the-fallen_firmament" -> "The Fallen Firmament" (only re-cased when the name is all lower case). */
export function prettify(s) {
  let out = String(s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (out && out === out.toLowerCase()) {
    out = out.split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }
  return out;
}

export const displayName = (file) => prettify(stripExt(file)) || file;

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const hidden = (rel) => rel.split('/').some((seg) => seg.startsWith('.'));

function toDoc(f) {
  const rel = f.path.slice(ROOT.length);
  const file = baseName(rel);
  const shelf = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  return {
    path: f.path,
    rel,
    file,
    ext: extOf(file),
    name: displayName(file),
    shelf,
    shelfParts: shelf ? shelf.split('/') : [],
    type: typeOf(file),
    size: f.size || 0,
    sha: f.sha || null,
    staged: !!f.staged,
  };
}

// Memoised listing. store.remote is replaced on every pull/save; any store event can change drafts.
let cache = null;
store.on(() => { cache = null; });

function snapshot() {
  if (!cache || cache.remote !== store.remote) {
    const all = store.files(ROOT);
    const docs = sortBy(
      all.filter((f) => f.path !== README && !hidden(f.path.slice(ROOT.length))).map(toDoc),
      (d) => d.path.toLowerCase(),
    );
    const folders = new Set();
    for (const f of all) {
      const parts = f.path.slice(ROOT.length).split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        if (!hidden(p)) folders.add(p);
      }
    }
    cache = { remote: store.remote, docs, folders: sortBy([...folders], (x) => x.toLowerCase()), readme: all.find((f) => f.path === README) || null };
  }
  return cache;
}

/** Every document in the library (README and dotfiles excluded), sorted by path. */
export const listDocs = () => snapshot().docs;
/** Every folder (shelf) path relative to the library root, including empty ones kept alive by .gitkeep. */
export const listFolders = () => snapshot().folders;
/** The owner's README entry ({path, sha, size}) or null. */
export const readmeFile = () => snapshot().readme;

export const docByPath = (path) => listDocs().find((d) => d.path === path) || null;

/** Like docByPath, but also opens files that are not listed (README, dotfiles) when they exist. */
export function docAt(path) {
  const d = docByPath(path);
  if (d || !String(path).startsWith(ROOT)) return d;
  const f = store.files(ROOT).find((x) => x.path === path);
  return f ? toDoc(f) : null;
}

export const docHref = (path) => href(VIEW, ...String(path).slice(ROOT.length).split('/'));
export const shelfLabel = (shelf) => (shelf ? shelf.split('/').map(prettify).join(' › ') : 'General');

/**
 * Find a document from a link target: full path, path inside the library, file name (with or without
 * extension) or display name. Case- and accent-insensitive.
 */
export function findDoc(target) {
  const raw = String(target || '').trim().replace(/^\.?\/+/, '');
  if (!raw) return null;
  const k = nameKey(raw);
  const rel = k.startsWith(ROOT) ? k.slice(ROOT.length) : k;
  const docs = listDocs();
  return docs.find((d) => nameKey(d.rel) === rel)
    || docs.find((d) => nameKey(stripExt(d.rel)) === rel)
    || docs.find((d) => nameKey(d.file) === k)
    || docs.find((d) => nameKey(stripExt(d.file)) === k)
    || docs.find((d) => nameKey(d.name) === k)
    || null;
}

/** Shortest link target that still resolves to this document. */
export function linkTarget(doc) {
  const docs = listDocs();
  const unique = (fn) => docs.filter((d) => fn(d) === fn(doc)).length === 1;
  if (unique((d) => nameKey(d.name))) return doc.name;
  if (unique((d) => nameKey(d.file))) return doc.file;
  return doc.rel;
}

/** Documents on the same shelf as doc, in name order (for prev/next). */
export function shelfSiblings(doc) {
  return sortBy(listDocs().filter((d) => d.shelf === doc.shelf), (d) => d.name);
}

// ---------- names for uploads ----------

export function safeSegment(s, fallback = '') {
  const out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return out || fallback;
}

/** "Session 1: The Mill (draft).PDF" -> "Session-1-The-Mill-draft.pdf" */
export function safeFileName(name) {
  const ext = extOf(name);
  const base = ext ? String(name).slice(0, -(ext.length + 1)) : String(name);
  const b = safeSegment(base, 'document');
  return ext ? `${b}.${ext}` : b;
}

/** "Lore / Old Gods" -> "Lore/Old-Gods" */
export const safeFolder = (path) => String(path || '').split('/').map((s) => safeSegment(s.trim())).filter(Boolean).join('/');

/** First free variant of a path: name.pdf, name-2.pdf, name-3.pdf… */
export function freePath(path, taken) {
  if (!taken.has(path)) return path;
  const ext = extOf(path);
  const stem = ext ? path.slice(0, -(ext.length + 1)) : path;
  for (let i = 2; ; i++) {
    const p = `${stem}-${i}${ext ? `.${ext}` : ''}`;
    if (!taken.has(p)) return p;
  }
}
