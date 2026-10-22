// Shared journal DOM pieces: buttons, tag chips, meta lines, empty states, highlighted text, link-kind icons.
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { fmtDay, relTime } from './text.js';

export const tagHref = (t) => `#/journal?tag=${encodeURIComponent(t)}`;

/** Append children, skipping null/false (native append would insert the text "null"). */
export function add(el, ...nodes) {
  el.append(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
  return el;
}

export function btn(label, onClick, { kind = '', ic = null, title = null, small = true, pressed = null, className = null, disabled = false, attrs = null } = {}) {
  return h('button', {
    type: 'button', class: ['btn', kind && `btn-${kind}`, small && 'btn-sm', className], title, disabled,
    'aria-pressed': pressed == null ? null : String(!!pressed), onclick: onClick, ...(attrs || {}),
  }, ic ? icon(ic) : null, label ? h('span', null, label) : null);
}

export function iconBtn(ic, label, onClick, { className = null, disabled = false, pressed = null, attrs = null } = {}) {
  return h('button', {
    type: 'button', class: ['btn-icon', 'btn-sm', className], title: label, 'aria-label': label, disabled,
    'aria-pressed': pressed == null ? null : String(!!pressed), onclick: onClick, ...(attrs || {}),
  }, icon(ic));
}

export function tagList(tags, { counts = false, className = null } = {}) {
  return h('ul', { class: ['jr-tags', className], role: 'list' }, tags.map((t) => {
    const name = typeof t === 'string' ? t : t.tag;
    return h('li', null, h('a', { class: 'tag', href: tagHref(name) },
      `#${name}`, counts && t.count != null ? h('span', { class: 'jr-tag-count' }, String(t.count)) : null));
  }));
}

export function metaLine(note) {
  const bits = [];
  if (note.author) bits.push(h('span', null, 'by ', h('span', { class: 'jr-author' }, note.author)));
  if (note.created) bits.push(h('time', { datetime: note.created, title: `Written ${fmtDay(note.created)}` }, fmtDay(note.created)));
  if (note.mtime && note.mtime - note.ctime > 120000) bits.push(h('span', { title: fmtDay(note.updated) }, `revised ${relTime(note.updated)}`));
  if (!bits.length) return null;
  return h('p', { class: 'jr-meta' }, bits.flatMap((b, i) => (i ? [h('span', { class: 'jr-meta-sep', 'aria-hidden': 'true' }, '·'), b] : [b])));
}

export function emptyState({ iconName = 'scroll', title, text = null, actions = [], className = null }) {
  return h('div', { class: ['empty-state', 'jr-empty', className] },
    icon(iconName), h('h3', null, title), text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

/** Text with [start, end) ranges wrapped in <mark>. */
export function highlighted(text, ranges = []) {
  const out = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at) continue;
    if (a > at) out.push(text.slice(at, a));
    out.push(h('mark', null, text.slice(a, b)));
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Fuzzy-hit indices -> highlighted text. */
export function hitsMarked(text, hits = []) {
  const ranges = [];
  for (const i of hits) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return highlighted(String(text), ranges);
}

/** Icon for a link kind (note, folder, map, char, doc, compendium kinds). */
export const KIND_ICON = {
  note: 'file', folder: 'folder', chapter: 'folder', map: 'pin', char: 'user', doc: 'file-doc', spell: 'sparkle', weapon: 'sword',
  armor: 'shield', gear: 'backpack', item: 'star', 'magic-item': 'star', feat: 'level-up', ability: 'level-up',
  species: 'users', class: 'shield', subclass: 'shield', background: 'scroll',
};
export const KIND_LABEL = { note: 'Note', folder: 'Folder', chapter: 'Folder', map: 'Place', char: 'Character', doc: 'Document' };

/** A collapsible pane section with a remembered open state. */
export function section({ key, title, count = null, open = true, onToggle, tools = null, body }) {
  const bodyEl = h('div', { class: 'jr-sec-body', hidden: !open });
  const head = h('button', {
    type: 'button', class: 'jr-sec-head', 'aria-expanded': String(open),
    onclick: () => {
      const on = bodyEl.hidden;
      bodyEl.hidden = !on;
      head.setAttribute('aria-expanded', String(on));
      onToggle?.(key, on);
    },
  }, icon('chevron-down'), h('span', { class: 'jr-sec-title' }, title), count != null ? h('span', { class: 'jr-count' }, String(count)) : null);
  add(bodyEl, body);
  return h('section', { class: 'jr-sec', 'data-sec': key }, h('header', { class: 'jr-sec-bar' }, head, tools ? h('div', { class: 'jr-sec-tools' }, tools) : null), bodyEl);
}
