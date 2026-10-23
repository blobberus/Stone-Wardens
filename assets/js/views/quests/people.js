// Links in the quest editor and on the quest page (docs/quests-model.md).
// An entry of quest.characters is a name ("Old Grim") or a link body picked from the suggestions ("char:Mira",
// "note:Old Grim", "map:Old Mill"). Either way it opens the page it names: a party member's sheet, an NPC's journal
// note, any other page on the site; a name with no page yet offers to start a journal note (like an unresolved
// [[link]]). NPC notes are journal notes tagged #npc (or #npc/…) or kept in a folder named like npc / people / cast.
import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { parseLink, resolveLink, suggestLinks, linkTypes, matchNames } from '../../core/links.js';
import { index as journalIndex, findNote } from '../journal/data.js';

const NPC_TAG = /^npcs?(\/|$)/i;
const NPC_FOLDER = /(^|\/)[^/]*(npc|people|cast|characters)[^/]*$/i;
const KINDS = { char: ['user', 'Party member'], note: ['journal', 'Journal note'], folder: ['folder', 'Journal folder'], map: ['pin', 'Map'], quest: ['quests', 'Quest'], doc: ['library', 'Warden’s Library'] };
const overlays = () => document.querySelector('body > #overlays') || document.body;

export const isNpcNote = (n) => !!n && (n.tags.some((t) => NPC_TAG.test(String(t))) || NPC_FOLDER.test(n.folder || ''));

function kindInfo(kind, npc) {
  if (npc) return { icon: 'user', label: 'NPC' };
  if (KINDS[kind]) return { icon: KINDS[kind][0], label: KINDS[kind][1] };
  return { icon: 'compendium', label: linkTypes().find((t) => t.prefix === kind)?.label || 'Page' };
}

/** What a character entry opens: resolveLink's {href, title, exists, kind} plus {label, npc, info:{icon, label}}. */
export function resolveCharacter(entry) {
  const p = parseLink(entry);
  let r;
  if (p.prefix) r = resolveLink(entry);
  else {
    const pc = resolveLink(`char:${entry}`); // a party member's sheet first, then a page of that name
    r = pc.exists ? pc : resolveLink(entry);
  }
  const npc = r.exists && r.kind === 'note' && isNpcNote(findNote(p.target));
  return { ...r, label: p.alias || p.target, npc, info: kindInfo(r.kind, npc) };
}

/** Pages the entries already open (hrefs), so "Old Grim" and "note:Old Grim" count as the same character. */
export const takenPages = (entries) => new Set(entries.map(resolveCharacter).filter((r) => r.exists).map((r) => r.href));

/** Entries to add: trimmed, and not a page that `current` already opens. */
export function newEntries(current, vals) {
  const pages = takenPages(current);
  const out = [];
  for (const v of vals.map((x) => String(x).trim()).filter(Boolean)) {
    const r = resolveCharacter(v);
    if (r.exists && pages.has(r.href)) continue;
    if (r.exists) pages.add(r.href);
    out.push(v);
  }
  return out;
}

/** A relevant character as a chip: a link to its page (onRemove: an editor chip with a remove button instead). */
export function characterChip(entry, { onRemove } = {}) {
  const r = resolveCharacter(entry);
  const cls = ['chip', 'qs-char', r.kind === 'char' && r.exists && 'is-pc', r.npc && 'is-npc', !r.exists && 'is-missing'];
  const title = r.exists ? `${r.info.label}: ${r.title}` : r.href ? `No page for “${r.label}” yet. Click to start a journal note.` : `Not found: ${r.title}`;
  const glyph = icon(r.exists ? r.info.icon : 'tag');
  if (onRemove) {
    return h('span', { class: cls, title: r.exists ? `Opens ${r.info.label.toLowerCase()}: ${r.title}` : `“${r.label}” has no page yet` }, glyph, r.label,
      h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${r.label}`, title: 'Remove', onclick: onRemove }, icon('close')));
  }
  return r.href ? h('a', { class: cls, href: r.href, title }, glyph, r.label) : h('span', { class: cls, title }, glyph, r.label);
}

/**
 * Suggestions for the "Relevant characters" field: party members, then NPC notes, then other notes and any other
 * page. "map:", "doc:"… narrow to that kind. -> [{value (stored entry), label, kind, icon}]
 */
export function characterSuggestions(text, taken = []) {
  const term = String(text || '').trim();
  const seen = new Set(taken.map((t) => t.toLowerCase()));
  const pages = takenPages(taken);
  const out = [];
  const push = (value, label, kind, ic) => {
    if (seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    const r = resolveCharacter(value);
    if (r.exists && pages.has(r.href)) return; // already listed, under another name
    out.push({ value, label, kind, icon: ic });
  };
  const scoped = /^([a-z-]+):/i.exec(term);
  if (scoped && linkTypes().some((t) => t.prefix === scoped[1].toLowerCase())) {
    for (const s of suggestLinks(term, 12)) if (!s.partial) push(s.insert.includes(':') ? s.insert : `note:${s.insert}`, s.label, s.kind, 'link');
    return out;
  }
  for (const s of linkTypes().find((t) => t.prefix === 'char')?.suggest(term) || []) push(`char:${s.value}`, s.label, 'Party member', 'user');
  const notes = matchNames(journalIndex().notes, term, (n) => n.title, 60);
  for (const n of notes.filter(isNpcNote).slice(0, 8)) push(`note:${n.title}`, n.title, 'NPC', 'user');
  if (term) {
    for (const n of notes.filter((x) => !isNpcNote(x)).slice(0, 4)) push(`note:${n.title}`, n.title, 'Journal note', 'journal');
    for (const s of suggestLinks(term, 40)) {
      const prefix = s.insert.split(':')[0];
      if (s.partial || !s.insert.includes(':') || prefix === 'char' || prefix === 'note') continue;
      push(s.insert, s.label, s.kind, kindInfo(prefix, false).icon);
    }
  }
  return out.slice(0, 12);
}

/**
 * A suggestion list under a text input (the [[ list's look). context(input) -> {query, start} | null decides when it
 * shows; items(query) -> [{label, kind, icon?}]; apply(item, ctx) writes the choice. Up / Down / Enter / Tab / Esc.
 * Returns {hide()} ; `input.dataset.suggesting` is "1" while it is open (callers skip their own Enter then).
 */
export function attachSuggest(input, { context, items, apply }) {
  const list = h('ul', { class: 'md-suggest qs-suggest', role: 'listbox', hidden: true });
  let shown = [];
  let active = 0;
  const hide = () => {
    if (list.hidden) return;
    list.hidden = true;
    list.remove();
    delete input.dataset.suggesting;
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  };
  function place() {
    if (!input.isConnected) { hide(); return; }
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const down = below >= 120 || below >= r.top;
    list.style.maxHeight = `${Math.max(64, Math.min(240, down ? below : r.top - 12))}px`;
    list.style.minWidth = `${Math.min(Math.max(220, r.width), 320)}px`;
    list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8))}px`;
    list.style.top = `${down ? r.bottom + 4 : r.top - 4 - list.offsetHeight}px`;
  }
  function draw() {
    clear(list);
    if (!shown.length) { hide(); return; }
    shown.forEach((it, i) => list.append(h('li', {
      class: ['md-suggest-item', i === active && 'is-active'], role: 'option', 'aria-selected': String(i === active),
      onmousedown: (e) => { e.preventDefault(); choose(it); },
    }, it.icon ? icon(it.icon) : null, h('span', null, it.label), h('span', { class: 'md-suggest-kind' }, it.kind))));
    if (list.hidden) {
      list.hidden = false;
      input.dataset.suggesting = '1';
      overlays().append(list);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
    }
    place();
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function update() {
    const c = context(input);
    if (!c) { hide(); return; }
    shown = items(c.query);
    active = 0;
    draw();
  }
  function choose(it) {
    const c = context(input);
    hide();
    if (c) apply(it, c);
  }
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', () => setTimeout(hide, 0));
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !shown.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      choose(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  });
  return { hide };
}

/** [[ autocomplete for a one-line input (objectives): the same suggestions as the description's editor. */
export function wikiSuggest(input, onChange) {
  return attachSuggest(input, {
    context: (el) => {
      const upto = el.value.slice(0, el.selectionStart ?? el.value.length);
      const m = /\[\[([^\]\n|]*)$/.exec(upto);
      return m ? { query: m[1], start: upto.length - m[1].length } : null;
    },
    items: (q) => suggestLinks(q),
    apply: (it, c) => {
      const end = input.selectionStart ?? input.value.length;
      const closing = input.value.slice(end).startsWith(']]') ? '' : ']]';
      input.setRangeText(it.insert + (it.partial ? '' : closing), c.start, end, 'end');
      if (!it.partial && !closing) input.selectionStart = input.selectionEnd = input.selectionStart + 2;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      onChange?.();
    },
  });
}
