// Content store: every user document lives in the repo under content/ and is mirrored here.
// Edits become local drafts immediately (localStorage); save() commits all drafts in one commit.
import { kv, safe } from './idb.js';
import { utf8, extOf, clone } from './util.js';
import { getSetting } from './settings.js';

const blobCache = safe(kv('sw-cache', 'blobs')); // sha -> Uint8Array (content-addressed, never stale)
const binDrafts = safe(kv('sw-drafts', 'bin')); // `${scope}:${path}` -> Uint8Array

const TEXT_EXT = new Set(['json', 'md', 'markdown', 'txt', 'csv', 'yml', 'yaml']);
export const isTextPath = (p) => TEXT_EXT.has(extOf(p));
const PRELOAD = 'content/';
const MAX_CACHE_BYTES = 25 * 1024 * 1024;

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
      if (!next.has(p) && !this.drafts[p] && this.docs.delete(p)) changed.push(p);
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

  // ---------- reading ----------

  has(path) { const d = this.docs.get(path); return !!d && !d.deleted; }

  get(path) {
    const d = this.docs.get(path);
    return d && !d.deleted ? clone(d.data) : null;
  }

  /** Documents directly inside dir (or below it with {recursive:true}). */
  list(dir, { recursive = false } = {}) {
    const pre = dir.endsWith('/') ? dir : `${dir}/`;
    const out = [];
    for (const [p, d] of this.docs) {
      if (d.deleted || d.data == null || !p.startsWith(pre)) continue;
      if (!recursive && p.slice(pre.length).includes('/')) continue;
      out.push({ path: p, data: clone(d.data) });
    }
    return out;
  }

  /** Every file (any type) under prefix, including staged uploads. */
  files(prefix = '') {
    const out = new Map();
    for (const f of this.remote.values()) if (f.path.startsWith(prefix)) out.set(f.path, { ...f, staged: false });
    for (const [p, d] of Object.entries(this.drafts)) {
      if (!p.startsWith(prefix)) continue;
      if (d.text === null && !d.bin) out.delete(p);
      else out.set(p, { path: p, size: d.size ?? d.text?.length ?? 0, sha: null, staged: true });
    }
    return [...out.values()];
  }

  async fileBlob(path) {
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
    const key = d ? `draft:${path}:${d.ts}` : this.remote.get(path)?.sha;
    if (!key) return null;
    if (!this.urls.has(key)) {
      const blob = await this.fileBlob(path);
      if (!blob) return null;
      this.urls.set(key, URL.createObjectURL(blob));
    }
    return this.urls.get(key);
  }

  async text(path) {
    const d = this.docs.get(path);
    if (d && !d.deleted && d.text != null) return d.text;
    const b = await this.fileBlob(path);
    return b ? b.text() : null;
  }

  // ---------- writing ----------

  put(path, data) {
    const text = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`;
    let doc = this.docs.get(path);
    if (!doc) { doc = { baseText: null, baseSha: this.remote.get(path)?.sha ?? null }; this.docs.set(path, doc); }
    Object.assign(doc, { text, data: typeof data === 'string' ? data : clone(data), deleted: false });
    if (text === doc.baseText) delete this.drafts[path];
    else this.drafts[path] = { text, baseSha: this.drafts[path]?.baseSha ?? doc.baseSha, ts: Date.now() };
    this.changed(path, 'put');
  }

  remove(path) {
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

  async putBinary(path, blob) {
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

  isDirty(path) { return path ? !!this.drafts[path] : Object.keys(this.drafts).length > 0; }
  dirtyPaths() { return Object.keys(this.drafts); }

  scheduleAutoCommit() {
    clearTimeout(this.autoTimer);
    if (!getSetting('autoCommit') || !this.isDirty()) return;
    const ms = Math.max(15, Number(getSetting('autoCommitDelay')) || 60) * 1000;
    this.autoTimer = setTimeout(() => this.save().catch((e) => this.emit({ type: 'error', error: e })), ms);
  }

  // ---------- saving ----------

  save(message) {
    if (this.saving) return this.savePromise;
    if (!this.isDirty()) return Promise.resolve({ saved: 0 });
    clearTimeout(this.autoTimer);
    this.saving = true;
    this.emit({ type: 'saving' });
    this.savePromise = this.doSave(message).finally(() => { this.saving = false; this.emit({ type: 'idle' }); });
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
      ? await this.backend.commit(changes, message || defaultMessage(changes))
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

function defaultMessage(changes) {
  const who = getSetting('playerName') || 'A Warden';
  const names = changes.map((c) => c.path.replace(/^content\//, '').replace(/\.(json|md)$/, ''));
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
  return `${who}: update ${shown}`;
}

export const store = new Store();
