// Cross-site link registry. Views register a resolver per prefix so [[map:Old Mill]],
// [[char:Thorin#hp]], [[weapon:Longsword]] etc. become real hyperlinks anywhere markdown is rendered.
import { href } from './router.js';
import { isDm, isHidden, dmConfigured } from './dm.js';

const types = new Map(); // prefix -> {label, resolve, suggest, order}

/**
 * registerLinkType('map', {
 *   label: 'Map location',
 *   resolve(target, anchor) -> {href, title, exists, path?} | null,   // path: the item's file, so a hidden one is known
 *   suggest(query) -> [{label, value}],  // value is the text after the prefix
 *   canHide: false,                      // the DM can't hide this kind (char:), so a link that fails is just missing
 * })
 */
export function registerLinkType(prefix, def) {
  types.set(prefix.toLowerCase(), { order: 100, ...def, prefix: prefix.toLowerCase() });
}

export const linkTypes = () => [...types.values()].sort((a, b) => a.order - b.order);

/** Split "prefix:Target#anchor|Alias" into parts. */
export function parseLink(raw) {
  let s = String(raw).trim();
  let alias = null;
  const bar = s.indexOf('|');
  if (bar >= 0) { alias = s.slice(bar + 1).trim(); s = s.slice(0, bar).trim(); }
  let prefix = null;
  const m = s.match(/^([a-z][a-z-]*):(.*)$/i);
  if (m && types.has(m[1].toLowerCase())) { prefix = m[1].toLowerCase(); s = m[2].trim(); }
  let anchor = null;
  const hash = s.indexOf('#');
  if (hash >= 0) { anchor = s.slice(hash + 1).trim(); s = s.slice(0, hash).trim(); }
  return { prefix, target: s, anchor, alias };
}

/**
 * Resolve a wikilink body. Returns {href, title, exists, kind, label, prefixed, hidden}.
 * Un-prefixed links: journal note first, then an exact name match in any other type.
 * hidden: it opens an item hidden from the players (only known in DM mode).
 */
export function resolveLink(raw) {
  const p = parseLink(raw);
  const label = p.alias || (p.anchor && !p.target ? p.anchor : p.target + (p.anchor ? ` › ${p.anchor}` : ''));
  const prefixed = !!p.prefix;
  const attempt = (type) => {
    try { return type.resolve(p.target, p.anchor); } catch (e) { console.error(e); return null; }
  };
  const found = (r, kind) => ({ ...r, kind, label, prefixed, hidden: !!r.exists && isHidden(r.path) });
  if (p.prefix) {
    const r = attempt(types.get(p.prefix));
    if (r) return found(r, p.prefix);
    return { href: null, title: `${p.prefix}: ${p.target}`, exists: false, kind: p.prefix, label, prefixed, parsed: p };
  }
  const note = types.get('note');
  const r = note && attempt(note);
  if (r?.exists) return found(r, 'note');
  for (const t of linkTypes()) {
    if (t.prefix === 'note') continue;
    const x = attempt(t);
    if (x?.exists) return found(x, t.prefix);
  }
  // Unresolved: behaves like Obsidian (clicking offers to create the note).
  return { href: href('journal', 'new') + `?title=${encodeURIComponent(p.target)}`, title: `Create note “${p.target}”`, exists: false, kind: 'note', label, prefixed, parsed: p };
}

/**
 * Why a resolved link can't be opened, or null when it can. -> null | {why, unrevealed?, start?}
 * Players can't tell a hidden page from a missing one (hidden items are sealed, docs/dm-mode.md), so while a DM is set
 * up and DM mode is off, a link that leads nowhere they can see "hasn't been revealed yet". An un-prefixed one still
 * starts a note where opts.startNotes (a player's own journal note); elsewhere it says so too, with start (the
 * new-note route) to start one anyway. Otherwise a prefixed link that leads nowhere is missing.
 */
export function linkClosed(r, { startNotes = false } = {}) {
  if (!r || r.exists) return null;
  const secret = dmConfigured() && !isDm() && types.get(r.kind)?.canHide !== false;
  if (secret && (r.prefixed || !startNotes)) {
    return { why: `“${r.label}” hasn't been revealed yet.`, unrevealed: true, start: r.prefixed ? null : r.href };
  }
  if (r.href) return null; // starts the note; doc: searches the library
  return { why: `There's nothing called “${r.label}” to open.` };
}

/** Suggestions for the [[ autocomplete. Returns [{label, insert, kind}]. */
export function suggestLinks(query, limit = 12) {
  const q = String(query || '');
  const m = q.match(/^([a-z-]+):(.*)$/i);
  const out = [];
  const scoped = m && types.has(m[1].toLowerCase()) ? [types.get(m[1].toLowerCase())] : linkTypes();
  const term = m && types.has(m[1].toLowerCase()) ? m[2] : q;
  for (const t of scoped) {
    let list = [];
    try { list = t.suggest?.(term) || []; } catch (e) { console.error(e); }
    for (const s of list) {
      out.push({ label: s.label, kind: t.label || t.prefix, insert: t.prefix === 'note' ? s.value : `${t.prefix}:${s.value}` });
    }
  }
  // Show prefix hints when the user has only typed a partial prefix.
  if (!m) {
    for (const t of linkTypes()) {
      if (t.prefix.startsWith(q.toLowerCase()) && q) out.unshift({ label: `${t.prefix}:`, kind: t.label, insert: `${t.prefix}:`, partial: true });
    }
  }
  return out.slice(0, limit);
}

/** Helper for views: simple case-insensitive name search over a list. */
export function matchNames(items, query, getName = (x) => x.name, limit = 8) {
  const q = String(query || '').toLowerCase().trim();
  const scored = [];
  for (const it of items) {
    const n = String(getName(it) || '');
    const l = n.toLowerCase();
    const i = q ? l.indexOf(q) : 0;
    if (i >= 0) scored.push([i === 0 ? 0 : 1, n.length, it]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((s) => s[2]);
}
