// Small shared helpers.

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

/** Stable-ish id for a new document: "thorin-oakenshield-k3x9". */
export function uid(name = '') {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slugify(name)}-${rand}`;
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Ability modifier from a score. */
export const abilityMod = (score) => Math.floor((Number(score || 10) - 10) / 2);

/** Format a modifier: +2, −1, +0 */
export const fmtMod = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export const clone = (v) => (v == null ? v : structuredClone(v));

export function sortBy(arr, key) {
  const f = typeof key === 'function' ? key : (x) => x?.[key];
  return [...arr].sort((a, b) => {
    const x = f(a), y = f(b);
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x ?? '').localeCompare(String(y ?? ''), undefined, { sensitivity: 'base', numeric: true });
  });
}

export const byName = (a, b) => String(a?.name ?? a?.title ?? '').localeCompare(String(b?.name ?? b?.title ?? ''), undefined, { sensitivity: 'base', numeric: true });

/** Case/diacritic-insensitive key for name matching. */
export const nameKey = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function b64encode(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function b64decode(str) {
  const bin = atob(str.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8 = {
  encode: (s) => new TextEncoder().encode(s),
  decode: (b) => new TextDecoder().decode(b),
};

/** Git blob sha1 of a byte array (matches GitHub's blob sha). */
export async function gitBlobSha(bytes) {
  const header = utf8.encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header); buf.set(bytes, header.length);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const extOf = (path) => (String(path).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
export const baseName = (path) => String(path).split('/').pop();
export const stripExt = (name) => String(name).replace(/\.[^.]+$/, '');
