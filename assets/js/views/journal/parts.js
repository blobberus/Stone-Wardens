// Shared journal DOM pieces: page shells, dotted-leader links, blocks, tag chips, page-turn corners,
// arrange controls and drag-and-drop ordering for contents lists.
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { fmtDay, relTime } from './text.js';

export const tagHref = (t) => `#/journal?tag=${encodeURIComponent(t)}`;

/** Append children, skipping null/false (native append would insert the text "null"). */
export function add(el, ...nodes) {
  el.append(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
  return el;
}
export const chapterName = (ch) => (ch.loose ? 'Loose Leaves' : `${ch.label} · ${ch.title}`);

/** One page of the open book: running head, scrolling body, foot with folio and page-turn corners. */
export function pageShell(side, label) {
  const head = h('header', { class: 'jr-runhead' });
  const body = h('div', { class: 'jr-page-body' });
  const foot = h('footer', { class: 'jr-page-foot' });
  const el = h('section', { class: ['jr-page', `jr-${side}`], 'aria-label': label }, head, body, foot);
  return {
    el, head, body, foot,
    setHead(...nodes) { head.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false && n !== '')); },
    setFoot({ prev = null, folio = '', next = null } = {}) {
      foot.replaceChildren(
        prev ? corner('prev', prev) : h('span', { class: 'jr-corner-spacer' }),
        h('span', { class: 'jr-folio' }, folio == null ? '' : String(folio)),
        next ? corner('next', next) : h('span', { class: 'jr-corner-spacer' }));
    },
  };
}

/** Page-turn link at a page corner. target: {href, title, kicker?} */
export function corner(dir, target) {
  const prev = dir === 'prev';
  const kicker = target.kicker || (prev ? 'Previous' : 'Next');
  return h('a', {
    class: ['jr-corner', `jr-corner-${dir}`], href: target.href, rel: prev ? 'prev' : 'next',
    'aria-label': `${kicker}: ${target.title}`, title: `${kicker}: ${target.title}`,
  },
  prev ? icon('chevron-left') : null,
  h('span', { class: 'jr-corner-text' }, h('span', { class: 'jr-corner-kicker' }, kicker), h('span', { class: 'jr-corner-title' }, target.title)),
  prev ? null : icon('chevron-right'));
}

/** Contents line: text, dotted leader, folio. Renders an <a> when href is given, otherwise a <span>. */
export function leader({ href: to = null, text, folio = null, current = false, className = null, title = null, attrs = null, tag = null }) {
  return h(tag || (to ? 'a' : 'span'), {
    class: ['jr-leader', current && 'is-current', className], href: to, title,
    'aria-current': current ? 'page' : null, ...(attrs || {}),
  },
  h('span', { class: 'jr-leader-text' }, text),
  h('span', { class: 'jr-leader-dots', 'aria-hidden': 'true' }),
  folio != null && folio !== '' ? h('span', { class: 'jr-leader-folio' }, String(folio)) : null);
}

export function block(title, body, { count = null, tools = null, className = null, hint = null } = {}) {
  return h('section', { class: ['jr-block', className] },
    h('header', { class: 'jr-block-head' },
      h('h2', { class: 'jr-block-title' }, title, count != null ? h('span', { class: 'jr-count' }, String(count)) : null),
      tools ? h('div', { class: 'jr-block-tools' }, tools) : null),
    hint ? h('p', { class: 'jr-hint' }, hint) : null,
    body);
}

export function fleuron() { return h('div', { class: 'jr-fleuron', 'aria-hidden': 'true' }); }

export function tagList(tags, { counts = false, active = null } = {}) {
  return h('ul', { class: 'jr-tags', role: 'list' }, tags.map((t) => {
    const name = typeof t === 'string' ? t : t.tag;
    const on = active && active.toLowerCase() === name.toLowerCase();
    return h('li', null, h('a', { class: ['tag', 'jr-tag', on && 'is-active'], href: tagHref(name), 'aria-current': on ? 'page' : null },
      `#${name}`, counts && t.count != null ? h('span', { class: 'jr-tag-count' }, String(t.count)) : null));
  }));
}

export function metaLine(note) {
  const bits = [];
  if (note.author) bits.push(h('span', null, 'by ', h('span', { class: 'jr-author' }, note.author)));
  if (note.created) bits.push(h('time', { datetime: note.created }, fmtDay(note.created)));
  const created = Date.parse(note.created || '') || 0;
  const updated = Date.parse(note.updated || '') || 0;
  if (updated && updated - created > 120000) bits.push(h('span', null, `revised ${relTime(note.updated)}`));
  if (!bits.length) return null;
  return h('p', { class: 'jr-meta' }, bits.flatMap((b, i) => (i ? [h('span', { class: 'jr-meta-sep', 'aria-hidden': 'true' }, '·'), b] : [b])));
}

export function emptyState({ iconName = 'scroll', title, text = null, actions = [] }) {
  return h('div', { class: 'empty-state jr-empty' },
    icon(iconName), h('h3', null, title), text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

export function btn(label, onClick, { kind = '', ic = null, title = null, small = true, pressed = null, className = null, disabled = false } = {}) {
  return h('button', {
    type: 'button', class: ['btn', kind && `btn-${kind}`, small && 'btn-sm', className], title, disabled,
    'aria-pressed': pressed == null ? null : String(!!pressed), onclick: onClick,
  }, ic ? icon(ic) : null, label ? h('span', null, label) : null);
}

export function iconBtn(ic, label, onClick, { className = null, disabled = false } = {}) {
  return h('button', { type: 'button', class: ['btn-icon', 'btn-sm', className], title: label, 'aria-label': label, disabled, onclick: onClick }, icon(ic));
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

// ---------- arranging ----------

export const grip = () => h('span', { class: 'jr-grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, icon('grip'));

export function upDown(i, len, fn, name) {
  return h('span', { class: 'jr-arrange' },
    iconBtn('chevron-up', `Move “${name}” up`, () => fn(-1), { disabled: i === 0 }),
    iconBtn('chevron-down', `Move “${name}” down`, () => fn(1), { disabled: i === len - 1 }));
}

/** A chapter's notes as contents lines. With arrange, rows get drag handles and up/down buttons. */
export function notesList(ch, { current = null, arrange = false, onShift = null } = {}) {
  const ol = h('ol', { class: ['jr-toc-notes', arrange && 'is-arranging'], role: 'list', 'data-drop': 'note', 'data-chapter': ch.slug });
  ch.notes.forEach((n, i) => {
    const isCurrent = !!current && current.path === n.path;
    ol.append(h('li', { class: ['jr-toc-note', isCurrent && 'is-current'], 'data-path': n.path, draggable: arrange ? 'true' : null },
      arrange ? grip() : null,
      leader({ href: n.href, text: n.title, folio: n.folio, current: isCurrent, attrs: arrange ? { draggable: 'false' } : null }),
      arrange ? upDown(i, ch.notes.length, (d) => onShift?.(n, d), n.title) : null));
  });
  if (!ch.notes.length && arrange) ol.append(h('li', { class: 'jr-toc-drop' }, 'Drop notes here'));
  return ol;
}

/**
 * HTML5 drag-and-drop ordering inside `root`. Draggable rows carry data-path (notes) or data-chapter-item
 * (chapters); lists carry data-drop="note" (+ data-chapter) or data-drop="chapter".
 */
export function wireDrag(root, { onNote = null, onChapter = null } = {}) {
  let drag = null;
  const marker = h('li', { class: 'jr-drop-marker', 'aria-hidden': 'true' });
  const itemSel = (type) => (type === 'note' ? '[data-path]' : '[data-chapter-item]');
  const cleanup = () => {
    marker.remove();
    drag?.el.classList.remove('is-dragging');
    root.classList.remove('is-dragging');
    drag = null;
  };
  root.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-path][draggable="true"], [data-chapter-item][draggable="true"]');
    if (!el || !root.contains(el)) return;
    drag = el.dataset.path ? { type: 'note', key: el.dataset.path, el } : { type: 'chapter', key: el.dataset.chapterItem, el };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', drag.key); } catch { /* some browsers refuse custom data */ }
    requestAnimationFrame(() => { el.classList.add('is-dragging'); root.classList.add('is-dragging'); });
    e.stopPropagation();
  });
  root.addEventListener('dragover', (e) => {
    if (!drag) return;
    let list = e.target.closest?.(`[data-drop="${drag.type}"]`);
    if (!list && drag.type === 'note') list = e.target.closest?.('[data-chapter-item], [data-loose]')?.querySelector('[data-drop="note"]');
    if (!list || !root.contains(list)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const items = [...list.children].filter((c) => c !== marker && c !== drag.el && c.matches(itemSel(drag.type)));
    const before = items.find((it) => { const r = it.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; }) || null;
    if (marker.parentNode !== list || marker.nextElementSibling !== before) list.insertBefore(marker, before);
  });
  root.addEventListener('drop', (e) => {
    if (!drag || !marker.parentNode) return;
    e.preventDefault();
    const list = marker.parentNode;
    const items = [...list.children].filter((c) => c === marker || (c !== drag.el && c.matches(itemSel(drag.type))));
    const at = items.indexOf(marker);
    const d = drag;
    cleanup();
    if (d.type === 'note') onNote?.(d.key, list.dataset.chapter, at);
    else onChapter?.(d.key, at);
  });
  root.addEventListener('dragend', cleanup);
}
