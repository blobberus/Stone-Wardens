// Content store: every user document lives in the repo under content/ and is mirrored here.
// Edits become local drafts immediately (localStorage); save() commits all drafts in one commit.
import { kv, safe } from './idb.js';
import { utf8, extOf, clone } from './util.js';
import { getSetting } from './settings.js';

const blobCache = safe(kv('sw-cache', 'blobs')); // sha -> Uint8Array (content-addressed, never stale)
// Staged uploads: `${scope}:${path}` -> Uint8Array. Kept in memory as well, so an unavailable
// IndexedDB (private browsing) only loses them across reloads instead of silently dropping them.
const binIdb = safe(kv('sw-drafts', 'bin'));
const binMem = new Map();
const binDrafts = {
  get: async (k) => binMem.get(k) ?? binIdb.get(k),
  set: async (k, v) => { binMem.set(k, v); await binIdb.set(k, v); },
  del: async (k) => { binMem.delete(k); await binIdb.del(k); },
};

const TEXT_EXT = new Set(['json', 'md', 'markdown', 'txt', 'csv', 'yml', 'yaml']);
export const isTextPath = (p) => TEXT_EXT.has(extOf(p));
const PRELOAD = 'content/';
const MAX_CACHE_BYTES = 25 * 1024 * 1024;
const AUTO_GAP_MS = 15000; // auto-commits from one device at least this far apart (GitHub write limits)
const AUTO_PAUSE_MS = 120000; // no auto-commits for this long after GitHub answers "rate limit"

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', md: 'text/markdown', txt: 'text/plain',
  json: 'application/json', csv: 'text/csv', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
};
export const mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';

function parse(path, text) {
  if (extOf(path) !== 'json') return text;
  try { return JSON.parse(text); } catch (e) { console.warn(`[store] bad JSON in ${path}`, e); return null; }
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

class Store {
  constructor() {
    this.backend = null;
    this.scope = '';
    this.remote = new Map(); // path -> {path, sha, size}
    this.docs = new Map(); // path -> {text, data, baseText, baseSha, deleted}
    this.drafts = {}; // path -> {text|null, baseSha, ts, bin?, size?}
    this.listeners = new Set();
    this.saving = false;
    this.loaded = false;
    this.urls = new Map();
    this.conflictResolver = null; // async (paths) => 'overwrite' | 'theirs' | 'cancel'
    this.autoTimer = null;
    this.lastAutoCommit = 0; // when the last auto-commit started (spacing, see scheduleAutoCommit)
    this.autoPausedUntil = 0; // GitHub said "rate limit": no auto-commits until then
    // DM mode (core/dm.js) while unlocked: hidden items shown at their own paths, written sealed. null otherwise.
    this.layer = null;
  }

  /** Does the DM layer handle this path? (Never its own files under content/dm/ or the inbox.) */
  layered(path) { return !!this.layer && !path.startsWith('content/dm/') && !path.startsWith('content/inbox/'); }

  /** A path the repo or this device already has (a doc, a file, a staged upload or deletion). */
  exists(path) { return this.has(path) || this.remote.has(path) || !!this.drafts[path]; }

  /** Some visible doc has exactly this text (a new path with it is a copy or move of a public doc). */
  isPublicCopy(text) {
    for (const [p, d] of this.docs) if (!d.deleted && d.text === text && !this.layer?.has(p)) return true;
    return false;
  }

  /**
   * DM mode: should a write to `path` go to the hidden layer? Yes when asked (hidden: true), when the path is hidden,
   * for a new copy of a hidden item, and (safety net) for anything new in a hideable area while "New: hidden" is on,
   * unless it is a copy of a visible doc or the caller says hidden: false.
   */
  toLayer(path, hidden, text) {
    if (!this.layered(path) || hidden === false) return false;
    if (hidden || this.layer.has(path)) return true;
    if (this.exists(path)) return false;
    if (this.layer.isCopy(text)) return true;
    return this.layer.autoHide(path) && !this.isPublicCopy(text);
  }

  /** toLayer for a binary (a copy = the same bytes as a hidden file). */
  async binaryToLayer(path, hidden, blob) {
    if (!this.layered(path) || hidden === false) return false;
    if (hidden || this.layer.has(path)) return true;
    if (this.exists(path)) return false;
    if (await this.layer.isCopyBytes(blob)) return true;
    return this.layer.autoHide(path);
  }

  get mode() { return this.backend?.mode || 'none'; }

  use(backend, scope) {
    this.backend = backend;
    this.scope = scope;
    try { this.drafts = JSON.parse(localStorage.getItem(this.draftKey) || '{}'); } catch { this.drafts = {}; }
  }

  get draftKey() { return `sw:drafts:${this.scope}`; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(ev) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.error('[store] listener failed', e); }
    }
  }

  // ---------- loading ----------

  async load() {
    const { files } = await this.backend.tree();
    await this.applyRemote(files, new Set(), false);
    for (const [p, d] of Object.entries(this.drafts)) {
      if (d.bin) continue;
      let doc = this.docs.get(p);
      if (!doc) { doc = { baseText: null, baseSha: this.remote.get(p)?.sha ?? null }; this.docs.set(p, doc); }
      if (d.text === null) Object.assign(doc, { text: null, data: null, deleted: true });
      else Object.assign(doc, { text: d.text, data: parse(p, d.text), deleted: false });
    }
    this.loaded = true;
    this.emit({ type: 'load' });
  }

  async readBlob(sha, size = 0) {
    const hit = await blobCache.get(sha);
    if (hit) return hit;
    const bytes = await this.backend.readBytes(sha);
    if (size < MAX_CACHE_BYTES) blobCache.set(sha, bytes);
    return bytes;
  }

  async loadDoc(path, sha) {
    const text = utf8.decode(await this.readBlob(sha));
    const doc = this.docs.get(path) || {};
    Object.assign(doc, { baseText: text, baseSha: sha });
    if (!this.drafts[path]) Object.assign(doc, { text, data: parse(path, text), deleted: false });
    this.docs.set(path, doc);
  }

  /** Bring local mirror up to date with a remote listing; drafts are never overwritten. */
  async applyRemote(files, force = new Set(), notify = true) {
    const next = new Map(files.map((f) => [f.path, f]));
    const changed = [];
    for (const p of this.remote.keys()) {
      if (next.has(p) || this.drafts[p]) continue;
      this.docs.delete(p);
      changed.push(p);
    }
    // Files not mirrored as docs (binaries, wardens-library/…) also count when added or replaced.
    for (const f of files) {
      if (!(f.path.startsWith(PRELOAD) && isTextPath(f.path)) && this.remote.get(f.path)?.sha !== f.sha) changed.push(f.path);
    }
    const toLoad = files.filter((f) => {
      if (!f.path.startsWith(PRELOAD) || !isTextPath(f.path) || this.drafts[f.path]) return false;
      const doc = this.docs.get(f.path);
      return !doc || doc.baseSha !== f.sha || force.has(f.path);
    });
    this.remote = next;
    await pool(toLoad, 8, (f) => this.loadDoc(f.path, f.sha));
    changed.push(...toLoad.map((f) => f.path));
    if (notify && changed.length) this.emit({ type: 'pulled', paths: changed });
    return changed;
  }

  async pull() {
    if (this.saving || !this.backend) return [];
    const { files } = await this.backend.tree();
    return this.applyRemote(files);
  }

  /**
   * pull(), but only after the backend says the branch moved (a cheap check, free while nothing changed).
   * -> the changed paths, or null when it didn't pull.
   */
  async pullIfChanged() {
    if (this.saving || !this.backend) return null;
    if (this.backend.headChanged && !(await this.backend.headChanged())) return null;
    return this.pull();
  }

  // ---------- reading ----------

  has(path) {
    if (this.layer?.has(path)) return true;
    const d = this.docs.get(path);
    return !!d && !d.deleted;
  }

  get(path) {
    const l = this.layer?.doc(path);
    if (l) return clone(l.data);
    const d = this.docs.get(path);
    return d && !d.deleted ? clone(d.data) : null;
  }

  /** Documents directly inside dir (or below it with {recursive:true}). */
  list(dir, { recursive = false } = {}) {
    const pre = dir.endsWith('/') ? dir : `${dir}/`;
    const out = [];
    for (const [p, d] of this.docs) {
      if (d.deleted || d.data == null || !p.startsWith(pre) || this.layer?.has(p)) continue;
      if (!recursive && p.slice(pre.length).includes('/')) continue;
      out.push({ path: p, data: clone(d.data) });
    }
    if (this.layer) out.push(...this.layer.docsIn(pre, recursive));
    return out;
  }

  /** Every file (any type) under prefix, including staged uploads (and hidden ones in DM mode, with hidden: true). */
  files(prefix = '') {
    const out = new Map();
    for (const f of this.remote.values()) if (f.path.startsWith(prefix)) out.set(f.path, { ...f, staged: false });
    for (const [p, d] of Object.entries(this.drafts)) {
      if (!p.startsWith(prefix)) continue;
      if (d.text === null && !d.bin) out.delete(p);
      else out.set(p, { path: p, size: d.size ?? d.text?.length ?? 0, sha: null, staged: true });
    }
    if (this.layer) for (const f of this.layer.filesIn(prefix)) out.set(f.path, f);
    return [...out.values()];
  }

  async fileBlob(path) {
    if (this.layer?.has(path)) return this.layer.blob(path);
    const d = this.drafts[path];
    let bytes;
    if (d?.bin) bytes = await binDrafts.get(`${this.scope}:${path}`);
    else if (d && d.text != null) bytes = utf8.encode(d.text);
    else {
      const r = this.remote.get(path);
      if (!r) return null;
      bytes = await this.readBlob(r.sha, r.size);
    }
    return bytes ? new Blob([bytes], { type: mimeOf(path) }) : null;
  }

  async fileUrl(path) {
    const d = this.drafts[path];
    const key = this.layer?.has(path) ? `dm:${path}:${this.layer.version(path)}` : d ? `draft:${path}:${d.ts}` : this.remote.get(path)?.sha;
    if (!key) return null;
    if (!this.urls.has(key)) {
      const blob = await this.fileBlob(path);
      if (!blob) return null;
      this.urls.set(key, URL.createObjectURL(blob));
    }
    return this.urls.get(key);
  }

  async text(path) {
    if (this.layer?.has(path)) return this.layer.text(path) ?? (await this.layer.blob(path))?.text() ?? null;
    const d = this.docs.get(path);
    if (d && !d.deleted && d.text != null) return d.text;
    const b = await this.fileBlob(path);
    return b ? b.text() : null;
  }

  // ---------- writing ----------

  /**
   * Write a document (object -> pretty JSON, string -> text). DM mode (see toLayer): opts.hidden = true makes a new
   * one hidden, hidden: false forces it plain; a hidden one stays hidden (sealed by the layer).
   */
  put(path, data, { hidden = null } = {}) {
    const text = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`;
    if (this.toLayer(path, hidden, text)) {
      this.layer.put(path, text, typeof data === 'string' ? data : clone(data));
      this.emit({ type: 'put', path });
      return;
    }
    let doc = this.docs.get(path);
    if (!doc) { doc = { baseText: null, baseSha: this.remote.get(path)?.sha ?? null }; this.docs.set(path, doc); }
    Object.assign(doc, { text, data: typeof data === 'string' ? data : clone(data), deleted: false });
    if (text === doc.baseText) delete this.drafts[path];
    else this.drafts[path] = { text, baseSha: this.drafts[path]?.baseSha ?? doc.baseSha, ts: Date.now() };
    this.changed(path, 'put');
  }

  remove(path) {
    if (this.layered(path) && this.layer.has(path)) {
      this.layer.remove(path);
      this.emit({ type: 'remove', path });
      return;
    }
    const r = this.remote.get(path);
    if (!r) {
      this.docs.delete(path);
      delete this.drafts[path];
      binDrafts.del(`${this.scope}:${path}`);
    } else {
      const doc = this.docs.get(path) || { baseText: null, baseSha: r.sha };
      Object.assign(doc, { text: null, data: null, deleted: true });
      this.docs.set(path, doc);
      this.drafts[path] = { text: null, baseSha: this.drafts[path]?.baseSha ?? r.sha, ts: Date.now() };
    }
    this.changed(path, 'remove');
  }

  async putBinary(path, blob, { hidden = null } = {}) {
    if (await this.binaryToLayer(path, hidden, blob)) {
      await this.layer.putBinary(path, blob);
      this.emit({ type: 'put', path });
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await binDrafts.set(`${this.scope}:${path}`, bytes);
    this.drafts[path] = { bin: true, size: bytes.length, baseSha: this.drafts[path]?.baseSha ?? this.remote.get(path)?.sha ?? null, ts: Date.now() };
    this.changed(path, 'put');
  }

  /** Throw away local changes for a path (or all) and return to the repo version. */
  async discard(path) {
    const paths = path ? [path] : Object.keys(this.drafts);
    for (const p of paths) {
      const d = this.drafts[p];
      if (!d) continue;
      delete this.drafts[p];
      if (d.bin) binDrafts.del(`${this.scope}:${p}`);
      const doc = this.docs.get(p);
      if (doc && doc.baseText != null) Object.assign(doc, { text: doc.baseText, data: parse(p, doc.baseText), deleted: false });
      else this.docs.delete(p);
    }
    this.persistDrafts();
    this.emit({ type: 'pulled', paths });
  }

  changed(path, type) {
    this.persistDrafts();
    this.emit({ type, path });
    this.scheduleAutoCommit();
  }

  persistDrafts() {
    try { localStorage.setItem(this.draftKey, JSON.stringify(this.drafts)); }
    catch (e) { console.warn('[store] could not persist drafts', e); }
  }

  isDirty(path) {
    if (path && this.layer?.has(path)) return this.layer.isDirty(path);
    return path ? !!this.drafts[path] : Object.keys(this.drafts).length > 0 || !!this.layer?.pending();
  }
  dirtyPaths() { return Object.keys(this.drafts); }

  /**
   * Auto-commit `autoCommitDelay` seconds (default 2) after the last edit. Every player commits with the owner's one
   * token, and GitHub allows that token only about 500 writes an hour (3 per commit), so while someone keeps editing
   * a device commits at most every AUTO_GAP_MS (the edits in between join the next commit), and a rate-limit error
   * pauses auto-commits for AUTO_PAUSE_MS. Drafts are on the device already, so nothing is lost meanwhile.
   */
  scheduleAutoCommit() {
    clearTimeout(this.autoTimer);
    if (!getSetting('autoCommit') || !this.isDirty()) return;
    const delay = Math.max(2, Number(getSetting('autoCommitDelay')) || 2) * 1000;
    const now = Date.now();
    const ms = Math.max(delay, this.lastAutoCommit + AUTO_GAP_MS - now, this.autoPausedUntil - now);
    this.autoTimer = setTimeout(() => {
      if (this.saving) return; // the running save reschedules when it ends
      this.lastAutoCommit = Date.now();
      this.save().catch((e) => {
        if ((e.status === 403 || e.status === 429) && /rate limit/i.test(e.message || '')) this.autoPausedUntil = Date.now() + AUTO_PAUSE_MS;
        this.emit({ type: 'error', error: e });
      });
    }, ms);
  }

  // ---------- saving ----------

  save(message) {
    if (this.saving) return this.savePromise;
    if (this.layer?.pending()) return this.layer.flush().then(() => this.save(message)); // DM edits not sealed yet
    if (!this.isDirty()) return Promise.resolve({ saved: 0 });
    clearTimeout(this.autoTimer);
    this.saving = true;
    this.emit({ type: 'saving' });
    this.savePromise = this.doSave(message).finally(() => { this.saving = false; this.emit({ type: 'idle' }); });
    // Edits made while it was saving: commit them on the usual timer (not after a failed or canceled save)
    this.savePromise.then((r) => { if (!r?.cancelled) this.scheduleAutoCommit(); }, () => {});
    return this.savePromise;
  }

  async doSave(message) {
    const { files } = await this.backend.tree();
    const latest = new Map(files.map((f) => [f.path, f.sha]));
    const conflicts = this.dirtyPaths().filter((p) => (latest.get(p) ?? null) !== (this.drafts[p].baseSha ?? null));
    const keepTheirs = new Set();
    if (conflicts.length) {
      const choice = this.conflictResolver ? await this.conflictResolver(conflicts) : 'overwrite';
      if (choice === 'cancel') return { saved: 0, cancelled: true };
      if (choice === 'theirs') {
        for (const p of conflicts) {
          const d = this.drafts[p];
          delete this.drafts[p];
          if (d.bin) binDrafts.del(`${this.scope}:${p}`);
          keepTheirs.add(p);
        }
      }
    }
    const snapshot = { ...this.drafts };
    const changes = [];
    for (const [p, d] of Object.entries(snapshot)) {
      if (d.bin) {
        const bytes = await binDrafts.get(`${this.scope}:${p}`);
        if (bytes) changes.push({ path: p, bytes });
      } else if (d.text === null) changes.push({ path: p, delete: true });
      else changes.push({ path: p, text: d.text });
    }
    const result = changes.length
      ? await this.backend.commit(changes, message || defaultMessage(changes, !!this.layer))
      : await this.backend.tree();
    const shaOf = new Map(result.files.map((f) => [f.path, f.sha]));
    for (const [p, d] of Object.entries(snapshot)) {
      const doc = this.docs.get(p);
      const sha = shaOf.get(p) ?? null;
      if (doc && !d.bin) {
        if (d.text === null) { doc.baseText = null; doc.baseSha = null; }
        else { doc.baseText = d.text; doc.baseSha = sha; }
      }
      if (this.drafts[p] === d) {
        delete this.drafts[p];
        if (d.bin) binDrafts.del(`${this.scope}:${p}`);
        if (d.text === null && !d.bin) this.docs.delete(p);
      } else if (this.drafts[p]) this.drafts[p].baseSha = sha; // edited again while saving
    }
    this.persistDrafts();
    await this.applyRemote(result.files, keepTheirs);
    this.emit({ type: 'saved', paths: Object.keys(snapshot) });
    return { saved: changes.length };
  }
}

function defaultMessage(changes, dm = false) {
  const who = getSetting('playerName') || 'A Warden';
  if (dm) return `${who}: update (${changes.length} file${changes.length === 1 ? '' : 's'})`; // names could hint at hidden items
  const names = changes.map((c) => c.path.replace(/^content\//, '').replace(/\.(json|md)$/, ''));
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
  return `${who}: update ${shown}`;
}

export const store = new Store();
