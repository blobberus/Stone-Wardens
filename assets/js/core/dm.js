// DM mode: content only the DM sees until it is released (docs/dm-mode.md).
//
// The repo is public and every player holds the same GitHub token, so "hidden" means encrypted (dm-crypto.js).
//   content/dm/vault.json          the data key, wrapped by the DM password (set up once from the DM button)
//   content/dm/hidden/<rid>.json   one sealed envelope per hidden item: {path, text | bin, size, mime, sha, hiddenAt, by}
//   content/dm/hidden/<rid>.bin    a hidden binary (library file, image): IV + ciphertext
//   content/dm/released.json       what the DM released (plain: released items are public anyway)
//   content/inbox/<stamp>.json     one notification per release, shown in everyone's Inbox
// While DM mode is unlocked, store.layer shows each hidden item at its own path, so every tab lists it where it was
// made; edits to it are re-encrypted (a moment later) instead of written in the clear. New items are hidden when the
// tab that creates them passes {hidden: true} (dmNewHidden() is the default for the toggles), and a copy of a hidden
// item (a move or rename) stays hidden. Release writes the plain file back to its path (and the hidden files it
// names, e.g. a quest's image), removes the envelope, logs it and posts a notification.
import { store, isTextPath, mimeOf } from './store.js';
import { b64encode, b64decode, extOf } from './util.js';
import { getSetting } from './settings.js';
import { createDmVault, rewrapDmVault, openDmVault, importDataKey, sealJson, openJson, sealBytes, openBytes, sha256Hex, randomId } from './dm-crypto.js';

export const DM_DIR = 'content/dm';
export const DM_VAULT = `${DM_DIR}/vault.json`;
export const HIDDEN_DIR = `${DM_DIR}/hidden`;
export const RELEASED_PATH = `${DM_DIR}/released.json`;
export const INBOX_DIR = 'content/inbox';
const KEY_STORE = 'sw:dm';
const PREFS = 'sw:dm:prefs';
const INBOX_KEEP_DAYS = 30;
const RELEASED_KEEP = 300;

const S = { key: null, raw: null, items: new Map(), listeners: new Set(), recent: [], loading: null };
const kinds = []; // {prefix, label, icon, describe(path, data) -> {title, href}}

// ---------- what can be hidden ----------

/**
 * Tabs describe their hideable items (DM Screen lists, released log, notifications):
 * registerHideable({prefix: 'content/quests/', label: 'Quest', icon: 'quests', describe(path, data) -> {title, href}})
 */
export function registerHideable(def) {
  const i = kinds.findIndex((k) => k.prefix === def.prefix);
  if (i >= 0) kinds.splice(i, 1, def); else kinds.push(def);
  kinds.sort((a, b) => b.prefix.length - a.prefix.length);
}
const kindOf = (path) => kinds.find((k) => path.startsWith(k.prefix)) || null;
// Uploaded images travel with the item that names them (released with it); not offered on their own in "Hide".
registerHideable({ prefix: 'content/media/', label: 'Image', icon: 'image', order: 90, pickable: false });
export const hideableKinds = () => [...kinds].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
/** Can this path be hidden? (A registered area whose accept() takes it: notes yes, folder metadata or a README no.) */
export function isHideablePath(path) {
  const k = kindOf(path);
  return !!k && (!k.accept || k.accept(path)) && !path.startsWith(`${DM_DIR}/`) && !path.startsWith(`${INBOX_DIR}/`);
}

/** {kind, label, icon, title, href} of a path (hidden or not). */
export function describe(path, data = undefined) {
  const k = kindOf(path);
  const d = data === undefined ? store.get(path) : data;
  let info = null;
  try { info = k?.describe?.(path, d) || null; } catch (e) { console.warn('[dm] describe failed', e); }
  const file = path.split('/').pop();
  return { kind: k?.prefix || '', label: k?.label || 'File', icon: k?.icon || 'file', title: info?.title || file.replace(/\.[^.]+$/, ''), href: info?.href || null };
}

// ---------- state ----------

export const dmConfigured = () => store.has(DM_VAULT);
export const isDm = () => !!S.key;
export const isHidden = (path) => !!path && S.items.has(path);
export const onDm = (fn) => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const notify = () => { for (const fn of S.listeners) { try { fn(); } catch (e) { console.error(e); } } };
const modeListeners = new Set();
/** fn(on) when DM mode turns on or off on this device (tabs redraw their switches and lock marks). */
export const onDmMode = (fn) => { modeListeners.add(fn); return () => modeListeners.delete(fn); };
const notifyMode = () => { for (const fn of modeListeners) { try { fn(isDm()); } catch (e) { console.error(e); } } };

function prefs() { try { return { newHidden: true, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { newHidden: true }; } }
/** The default of the "hidden from players" toggle when the DM creates something (DM Screen setting). */
export const dmNewHidden = () => isDm() && prefs().newHidden !== false;
export function setDmNewHidden(on) {
  try { localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), newHidden: !!on })); } catch { /* private mode */ }
  notify();
}

const parseText = (path, text) => {
  if (extOf(path) !== 'json') return text;
  try { return JSON.parse(text); } catch { return null; }
};
const byWho = () => getSetting('playerName') || 'The DM';

// ---------- unlocking ----------

/** First time: choose the DM password. Writes content/dm/vault.json (commit it right away) and unlocks. */
export async function setupDm(password, { remember = false } = {}) {
  if (dmConfigured()) throw new Error('already-set-up');
  const { vault, raw } = await createDmVault(password);
  store.put(DM_VAULT, vault);
  await unlockWith(raw, remember);
}

/** Unlock with the DM password; throws Error('bad-password'). */
export async function unlockDm(password, { remember = false } = {}) {
  const vault = store.get(DM_VAULT);
  if (!vault) throw new Error('not-set-up');
  const raw = await openDmVault(vault, password);
  await unlockWith(raw, remember);
}

/** New DM password for the same key (DM mode must be on). */
export async function changeDmPassword(password) {
  if (!S.raw) throw new Error('locked');
  store.put(DM_VAULT, await rewrapDmVault(S.raw, password));
}

/** After boot: DM mode stays on in this tab (or on this device, when remembered). */
export async function restoreDm() {
  const s = sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE);
  if (!s || !dmConfigured()) return false;
  try { await unlockWith(b64decode(s), !!localStorage.getItem(KEY_STORE)); return true; } catch (e) { console.warn('[dm] could not restore DM mode', e); lockDm(); return false; }
}

async function unlockWith(raw, remember) {
  S.key = await importDataKey(raw);
  S.raw = raw;
  const s = b64encode(raw);
  sessionStorage.setItem(KEY_STORE, s);
  if (remember) localStorage.setItem(KEY_STORE, s); else localStorage.removeItem(KEY_STORE);
  await reloadHidden();
  store.layer = layer;
  document.body.classList.add('is-dm');
  store.emit({ type: 'pulled', paths: [...S.items.keys()] });
  notify();
  notifyMode();
}

/** Leave DM mode on this device: hidden items disappear from view (pending edits are sealed first). */
export async function lockDm() {
  await flushAll();
  const paths = [...S.items.keys()];
  S.key = null;
  S.raw = null;
  S.items.clear();
  store.layer = null;
  sessionStorage.removeItem(KEY_STORE);
  localStorage.removeItem(KEY_STORE);
  document.body.classList.remove('is-dm');
  if (paths.length) store.emit({ type: 'pulled', paths });
  notify();
  notifyMode();
}

/** Decrypt every envelope (again); returns the item paths that changed. */
async function reloadHidden() {
  if (!S.key) return [];
  const envs = store.list(HIDDEN_DIR).filter((x) => x.path.endsWith('.json'));
  const seen = new Set();
  const changed = [];
  for (const { path: env, data } of envs) {
    seen.add(env);
    const text = JSON.stringify(data);
    const known = [...S.items.values()].find((it) => it.env === env);
    if (known && (known.envText === text || known.pending)) continue;
    try {
      const meta = await openJson(S.key, data);
      if (!meta?.path) continue;
      if (known && known.path !== meta.path) S.items.delete(known.path);
      S.items.set(meta.path, {
        ...meta, env, envText: text, data: meta.text != null ? parseText(meta.path, meta.text) : null,
        ver: (S.items.get(meta.path)?.ver || 0) + 1, pending: false,
      });
      changed.push(meta.path);
    } catch (e) {
      console.warn(`[dm] could not open ${env}`, e);
    }
  }
  for (const [p, it] of S.items) if (!seen.has(it.env) && !it.pending && !store.isDirty(it.env)) { it.dead = true; S.items.delete(p); changed.push(p); }
  return changed;
}

// Envelopes changed on another device (pull) or by a save: refresh what the tabs show.
store.on(async (ev) => {
  if (!S.key || !['pulled', 'load', 'saved'].includes(ev.type)) return;
  const paths = ev.path ? [ev.path] : ev.paths || [];
  if (ev.type !== 'load' && !paths.some((p) => p.startsWith(`${HIDDEN_DIR}/`))) return;
  const changed = await reloadHidden();
  if (changed.length) { store.emit({ type: 'pulled', paths: changed }); notify(); }
});

// ---------- sealing ----------

function newItem(path) {
  return { path, env: `${HIDDEN_DIR}/${randomId()}.json`, hiddenAt: new Date().toISOString(), by: byWho(), ver: 0, pending: false };
}

// it.dead: released or deleted. A seal still encrypting at that moment must not write the envelope back, or the item
// would be hidden again (and listed both as hidden and as released).
async function seal(it) {
  const meta = { v: 1, path: it.path, size: it.size || 0, mime: it.mime || mimeOf(it.path), sha: it.sha || null, hiddenAt: it.hiddenAt, by: it.by };
  if (it.bin) meta.bin = it.bin; else meta.text = it.text ?? '';
  it.sealing = (async () => {
    const env = await sealJson(S.key, meta);
    if (it.dead) return;
    store.put(it.env, env);
    it.envText = JSON.stringify(env);
  })();
  try { await it.sealing; } finally { it.sealing = null; }
}

function schedule(it) {
  it.pending = true;
  clearTimeout(it.timer);
  it.timer = setTimeout(() => flush(it).catch((e) => console.error('[dm] seal failed', e)), 250);
}
async function flush(it) {
  clearTimeout(it.timer);
  if (it.sealing) await it.sealing; // one already encrypting: let it land first
  if (!it.pending || !S.key) return;
  it.pending = false;
  await seal(it);
}
async function flushAll() { await Promise.all([...S.items.values()].map((it) => flush(it))); }

/** Decrypted bytes of a hidden binary (or the text of a hidden doc). */
async function plainBytes(it) {
  if (!it.bin) return new TextEncoder().encode(it.text ?? '');
  const blob = await store.fileBlob(it.bin);
  if (!blob) return null;
  return openBytes(S.key, new Uint8Array(await blob.arrayBuffer()));
}

// ---------- the store layer (used by store.js while DM mode is on) ----------

const layer = {
  has: (p) => S.items.has(p),
  doc(p) { const it = S.items.get(p); return it && !it.bin ? it : null; },
  docsIn(pre, recursive) {
    const out = [];
    for (const it of S.items.values()) {
      if (it.bin || it.data == null || !it.path.startsWith(pre)) continue;
      if (!recursive && it.path.slice(pre.length).includes('/')) continue;
      out.push({ path: it.path, data: structuredClone(it.data) });
    }
    return out;
  },
  filesIn(prefix) {
    return [...S.items.values()].filter((it) => it.path.startsWith(prefix))
      .map((it) => ({ path: it.path, size: it.size || (it.text ? it.text.length : 0), sha: null, staged: layer.isDirty(it.path), hidden: true }));
  },
  text(p) { return S.items.get(p)?.text ?? null; },
  version(p) { return S.items.get(p)?.ver ?? 0; },
  async blob(p) {
    const it = S.items.get(p);
    if (!it) return null;
    const bytes = await plainBytes(it);
    return bytes ? new Blob([bytes], { type: it.mime || mimeOf(p) }) : null;
  },
  put(p, text, data) {
    let it = S.items.get(p);
    if (!it) { it = newItem(p); S.items.set(p, it); }
    Object.assign(it, { text, data, size: text.length, bin: undefined, sha: null, ver: it.ver + 1 });
    schedule(it);
    notify();
  },
  async putBinary(p, blob) {
    let it = S.items.get(p);
    if (!it) { it = newItem(p); S.items.set(p, it); }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    it.bin = it.bin || it.env.replace(/\.json$/, '.bin');
    Object.assign(it, { text: undefined, data: null, size: bytes.length, mime: blob.type || mimeOf(p), sha: await sha256Hex(bytes), ver: it.ver + 1 });
    await store.putBinary(it.bin, new Blob([await sealBytes(S.key, bytes)], { type: 'application/octet-stream' }));
    it.pending = true;
    await flush(it);
    notify();
  },
  remove(p) {
    const it = S.items.get(p);
    if (!it) return;
    clearTimeout(it.timer);
    it.dead = true;
    S.items.delete(p);
    S.recent = [...S.recent.filter((r) => Date.now() - r.at < 5000), { at: Date.now(), text: it.text, sha: it.sha, size: it.size }];
    store.remove(it.env);
    if (it.bin) store.remove(it.bin);
    notify();
  },
  isDirty(p) { const it = S.items.get(p); return !!it && (it.pending || store.isDirty(it.env) || (!!it.bin && store.isDirty(it.bin))); },
  /** Edits still waiting for their envelope? store.save seals them (flush) before it commits. */
  pending: () => [...S.items.values()].some((it) => it.pending),
  flush: () => flushAll(),
  /** Safety net: something new in a hideable area while "New: hidden" is on (tabs normally say so themselves). */
  autoHide: (p) => dmNewHidden() && isHideablePath(p),
  /** A new text file identical to a hidden one (or one just removed): a move or a copy, so it stays hidden. */
  isCopy(text) {
    if (text == null) return false;
    return [...S.items.values()].some((it) => !it.bin && it.text === text) || S.recent.some((r) => r.text === text && Date.now() - r.at < 5000);
  },
  async isCopyBytes(blob) {
    const size = blob.size;
    const cands = [...S.items.values(), ...S.recent].filter((x) => x.sha && x.size === size);
    if (!cands.length) return false;
    const sha = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    return cands.some((x) => x.sha === sha);
  },
};

// ---------- hide / release ----------

/** Hidden items for the DM Screen: [{path, hiddenAt, by, …describe()}] newest first. */
export function hiddenItems() {
  return [...S.items.values()].map((it) => ({ path: it.path, hiddenAt: it.hiddenAt, by: it.by, dirty: layer.isDirty(it.path), ...describe(it.path, it.data) }))
    .sort((a, b) => String(b.hiddenAt).localeCompare(String(a.hiddenAt)));
}

/** The released log: [{path, title, label, href, at, by}] newest first. */
export function releasedItems() {
  const log = store.get(RELEASED_PATH);
  return (Array.isArray(log?.items) ? log.items : []).filter((x) => x && x.path).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function setReleased(list) {
  store.put(RELEASED_PATH, { items: list.slice(0, RELEASED_KEEP) });
}

/**
 * Hide an existing (public) item: seal it, then delete the plain file (earlier versions stay in the git history).
 * Uploaded images it names (content/media/…) go with it, unless another visible document names them too.
 */
export async function hideItem(path, { withAttachments = true } = {}) {
  if (!S.key) throw new Error('locked');
  if (S.items.has(path)) return;
  if (withAttachments && isTextPath(path)) {
    const text = (await store.text(path)) || '';
    const others = store.list('content', { recursive: true })
      .filter((d) => d.path !== path && !S.items.has(d.path) && !d.path.startsWith(`${DM_DIR}/`) && !d.path.startsWith(`${INBOX_DIR}/`))
      .map((d) => JSON.stringify(d.data));
    for (const f of store.files('content/media/')) {
      if (f.hidden || !text.includes(f.path) || others.some((t) => t.includes(f.path))) continue;
      await hideItem(f.path, { withAttachments: false });
    }
  }
  const it = newItem(path);
  if (isTextPath(path)) {
    const text = await store.text(path);
    if (text == null) throw new Error('missing');
    Object.assign(it, { text, data: parseText(path, text), size: text.length });
  } else {
    const blob = await store.fileBlob(path);
    if (!blob) throw new Error('missing');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    it.bin = it.env.replace(/\.json$/, '.bin');
    Object.assign(it, { size: bytes.length, mime: blob.type || mimeOf(path), sha: await sha256Hex(bytes) });
    await store.putBinary(it.bin, new Blob([await sealBytes(S.key, bytes)], { type: 'application/octet-stream' }));
  }
  await seal(it);
  store.remove(path); // the plain file (still a normal path: the layer doesn't hold it yet)
  S.items.set(path, it);
  setReleased(releasedItems().filter((x) => x.path !== path));
  store.emit({ type: 'put', path });
  notify();
}

/**
 * Release a hidden item: the plain file goes back to its path (with any hidden files whose path it names, e.g. its
 * image), the envelope goes, it joins the released log and everyone gets a notification.
 */
export async function releaseItem(path, { announce = true, attachment = false } = {}) {
  const it = S.items.get(path);
  if (!it || !S.key) return null;
  await flush(it);
  const info = describe(path, it.data);
  const bytes = it.bin ? await plainBytes(it) : null;
  if (it.bin && !bytes) throw new Error('missing');
  it.dead = true; // a late seal must not bring the envelope back
  S.items.delete(path); // from here on the store writes the plain file
  if (it.bin) await store.putBinary(path, new Blob([bytes], { type: it.mime || mimeOf(path) }), { hidden: false });
  else store.put(path, extOf(path) === 'json' && it.data != null ? it.data : it.text ?? '', { hidden: false });
  store.remove(it.env);
  if (it.bin) store.remove(it.bin);
  // attachments: hidden files this one names (a quest's image, a note's photos)
  if (it.text) for (const other of [...S.items.keys()]) if (it.text.includes(other)) await releaseItem(other, { announce: false, attachment: true });
  if (attachment) { notify(); return info; }
  const now = new Date().toISOString();
  setReleased([{ path, title: info.title, label: info.label, href: info.href, at: now, by: byWho() }, ...releasedItems().filter((x) => x.path !== path)]);
  if (announce) postNotification({ title: info.title, label: info.label, href: info.href, path });
  notify();
  return info;
}

// ---------- inbox ----------

/** One notification for everyone's Inbox (old ones are pruned here, 30 days). */
export function postNotification({ title, label = '', href = null, path = null }) {
  const at = new Date().toISOString();
  const id = `${at.replace(/[^0-9]/g, '').slice(0, 14)}-${randomId(3)}`;
  store.put(`${INBOX_DIR}/${id}.json`, { id, at, title, label, href, path, by: byWho() });
  const cutoff = Date.now() - INBOX_KEEP_DAYS * 864e5;
  for (const n of store.list(INBOX_DIR)) if (Date.parse(n.data?.at) < cutoff) store.remove(n.path);
}

export const _test = { layer, items: S.items };
