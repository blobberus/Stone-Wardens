// Journal UI state kept on this device (localStorage): pane layout and sort order (prefs), and per-vault state that
// refers to paths: expanded folders and tags, recently opened notes.
import { store } from '../../core/store.js';

const PREFS_KEY = 'sw:journal:prefs';
const vaultKey = () => `sw:journal:vault:${store.scope || 'default'}`;

const PREF_DEFAULTS = {
  left: 'files', // files | search | tags
  leftOpen: true,
  rightOpen: true,
  sort: 'name-asc',
  tagSort: 'name', // name | count
  sections: { props: true, outline: true, backlinks: true, unlinked: false, outgoing: true },
  leftW: 280,
  rightW: 300,
};

function read(key, defaults) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return { ...defaults, ...v, ...(defaults.sections ? { sections: { ...defaults.sections, ...(v.sections || {}) } } : {}) };
  } catch { return { ...defaults }; }
}
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const prefs = read(PREFS_KEY, PREF_DEFAULTS);
export const savePrefs = () => write(PREFS_KEY, prefs);

let vaultState = null;
function vault() {
  if (!vaultState) {
    const v = read(vaultKey(), { open: [], tagsOpen: [], recent: [] });
    vaultState = { open: new Set(v.open), tagsOpen: new Set(v.tagsOpen), recent: v.recent.filter((p) => typeof p === 'string') };
  }
  return vaultState;
}
const saveVault = () => {
  const v = vault();
  write(vaultKey(), { open: [...v.open], tagsOpen: [...v.tagsOpen], recent: v.recent });
};

// ---------- expanded folders (lower-case folder paths) ----------

export const isOpen = (path) => vault().open.has(String(path).toLowerCase());
export function setOpen(path, on) {
  const k = String(path).toLowerCase();
  const v = vault();
  if (on === v.open.has(k)) return;
  if (on) v.open.add(k); else v.open.delete(k);
  saveVault();
}
export function collapseAll() { vault().open.clear(); saveVault(); }
/** Expand every ancestor of a folder path (to reveal an item). Returns true if anything changed. */
export function reveal(folderPath) {
  const segs = String(folderPath || '').split('/').filter(Boolean);
  let changed = false;
  for (let i = 1; i <= segs.length; i++) {
    const k = segs.slice(0, i).join('/').toLowerCase();
    if (!vault().open.has(k)) { vault().open.add(k); changed = true; }
  }
  if (changed) saveVault();
  return changed;
}

// ---------- expanded tags ----------

export const isTagOpen = (key) => vault().tagsOpen.has(key);
export function setTagOpen(key, on) {
  const v = vault();
  if (on) v.tagsOpen.add(key); else v.tagsOpen.delete(key);
  saveVault();
}

// ---------- recently opened ----------

export const recent = () => vault().recent;
export function remember(path) {
  const v = vault();
  v.recent = [path, ...v.recent.filter((p) => p !== path)].slice(0, 20);
  saveVault();
}

/** Paths changed (rename / move): Map old note path -> new, plus folder path changes [oldFolder, newFolder]. */
export function renamed(notes = new Map(), folders = []) {
  const v = vault();
  v.recent = v.recent.map((p) => notes.get(p) || p);
  for (const [from, to] of folders) {
    const f = from.toLowerCase();
    const next = new Set();
    for (const k of v.open) next.add(k === f || k.startsWith(`${f}/`) ? to.toLowerCase() + k.slice(f.length) : k);
    v.open = next;
  }
  saveVault();
}

export function forget(path) {
  const v = vault();
  v.recent = v.recent.filter((p) => p !== path);
  saveVault();
}
