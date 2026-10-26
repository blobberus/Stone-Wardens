// Shared UI primitives: icons, toasts, modals, dialogs, pickers, form controls, markdown editor.
import { h, clear } from './dom.js';
import { suggestLinks } from './links.js';
import { renderInto } from './markdown.js';

// `body > #overlays`: rendered headings get slug ids, so a heading "Overlays" must not capture modals.
const overlays = () => document.querySelector('body > #overlays') || document.body;

export function icon(name, size) {
  const svg = h('svg', { class: 'icon', 'aria-hidden': 'true', ...(size ? { width: size, height: size } : {}) });
  // UI icons are `i-<name>`; map-marker glyphs are `mk-<name>` and are passed through as-is.
  const id = name.startsWith('mk-') || name.startsWith('i-') ? name : `i-${name}`;
  svg.append(h('use', { href: `assets/img/icons.svg#${id}` }));
  return svg;
}

// ---------- toasts ----------

let toastBox = null;
export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  if (!toastBox || !toastBox.isConnected) toastBox = overlays().appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${type}` }, message);
  toastBox.append(t);
  const close = () => t.remove();
  if (timeout) setTimeout(close, type === 'error' ? timeout * 2 : timeout);
  t.addEventListener('click', close);
  return close;
}

// ---------- modal ----------

const modalStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) { e.preventDefault(); modalStack[modalStack.length - 1].dismiss(); }
});

/**
 * openModal({title, body, actions:[{label, kind:'primary'|'ghost'|'danger', onClick}], wide, onClose})
 * An action's onClick returning false (or a promise of false) keeps the modal open.
 */
export function openModal({ title, body, actions = [], wide = false, onClose, beforeClose, className = '' } = {}) {
  const box = h('div', { class: ['modal', wide && 'modal-wide', className], role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    modalStack.splice(modalStack.indexOf(api), 1);
    onClose?.();
  };
  // Dismissals (Esc, X, backdrop) may be vetoed by beforeClose returning false, e.g. to guard unsaved forms.
  const dismiss = async () => {
    if (beforeClose && (await beforeClose()) === false) return;
    close();
  };
  const api = { close, el: box, dismiss };
  const head = h('header', { class: 'modal-head' },
    h('h2', null, title || ''),
    h('button', { class: 'btn-icon modal-close', type: 'button', 'aria-label': 'Close', onclick: dismiss }, icon('close')));
  const content = h('div', { class: 'modal-body' }, body);
  box.append(head, content);
  if (actions.length) {
    box.append(h('footer', { class: 'modal-foot' }, actions.map((a) => h('button', {
      class: ['btn', a.kind ? `btn-${a.kind}` : ''],
      type: 'button',
      onclick: async () => { const r = await a.onClick?.(api); if (r !== false) close(); },
    }, a.label))));
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  overlays().append(backdrop);
  modalStack.push(api);
  queueMicrotask(() => (box.querySelector('[autofocus], input, textarea, select') || box.querySelector('.modal-foot .btn-primary'))?.focus());
  return api;
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      body: h('p', null, message),
      actions: [
        { label: cancelLabel, kind: 'ghost' },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Three-way choice dialog. choices: [{label, value, kind}] -> resolves value (or null on dismiss). */
export function choiceDialog(message, choices, { title = 'Choose' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title,
      body: typeof message === 'string' ? h('p', null, message) : message,
      actions: choices.map((c) => ({ label: c.label, kind: c.kind, onClick: () => { result = c.value; } })),
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', okLabel = 'OK', multiline = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const control = multiline
      ? h('textarea', { class: 'textarea', rows: 6, value, placeholder })
      : h('input', { class: 'input', value, placeholder, autofocus: true });
    const m = openModal({
      title,
      body: field(label, control),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: okLabel, kind: 'primary', onClick: () => { result = control.value; } },
      ],
      onClose: () => resolve(result),
    });
    if (!multiline) control.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = control.value; m.close(); } });
  });
}

/**
 * pickFromList({title, items, render(item) -> Node|string, search(item) -> string, multi, selected, empty})
 * Resolves the chosen item (or array when multi), or null when dismissed.
 */
export function pickFromList({ title = 'Choose', items = [], render = (x) => x.name, search = (x) => x.name, multi = false, selected = [], empty = 'Nothing matches.', extra = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const chosen = new Set(selected);
    const q = h('input', { class: 'input picker-search', type: 'search', placeholder: 'Search…', autofocus: true });
    const list = h('ul', { class: 'picker-list', role: 'listbox' });
    let active = 0;
    let shown = [];
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      shown = items.filter((it) => !term || String(search(it) || '').toLowerCase().includes(term)).slice(0, 300);
      active = Math.min(active, Math.max(0, shown.length - 1));
      clear(list);
      if (!shown.length) list.append(h('li', { class: 'picker-empty muted' }, empty));
      shown.forEach((it, i) => {
        const li = h('li', {
          class: ['picker-item', chosen.has(it) && 'is-selected', i === active && 'is-active'],
          role: 'option',
          onclick: () => pick(it),
        }, multi ? h('span', { class: 'picker-check' }, chosen.has(it) ? '✓' : '') : null, render(it));
        list.append(li);
      });
    };
    const m = openModal({
      title,
      wide: true,
      className: 'modal-picker',
      body: h('div', { class: 'picker' }, q, extra, list),
      actions: multi ? [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Done', kind: 'primary', onClick: () => { result = items.filter((x) => chosen.has(x)); } },
      ] : [],
      onClose: () => resolve(result),
    });
    function pick(it) {
      if (multi) { chosen.has(it) ? chosen.delete(it) : chosen.add(it); draw(); return; }
      result = it;
      m.close();
    }
    q.addEventListener('input', () => { active = 0; draw(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && shown[active]) { pick(shown[active]); e.preventDefault(); }
      list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    });
    draw();
  });
}

// ---------- form controls ----------

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    label ? h('span', { class: 'field-label' }, label) : null,
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export const input = (props = {}) => h('input', { class: 'input', type: 'text', ...props });
export const textarea = (props = {}) => h('textarea', { class: 'textarea', rows: 4, ...props });

/** options: array of strings or {value, label}. */
export function select(options, value, onchange, props = {}) {
  const el = h('select', { class: 'select', ...props, onchange: (e) => onchange?.(e.target.value, e) },
    options.map((o) => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return h('option', { value: opt.value, selected: String(opt.value) === String(value), disabled: opt.disabled }, opt.label ?? opt.value);
    }));
  return el;
}

export function checkbox(checked, onchange, label) {
  const box = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange?.(e.target.checked, e) });
  return label ? h('label', { class: 'checkbox' }, box, h('span', null, label)) : box;
}

export function numberInput(value, onchange, props = {}) {
  return h('input', {
    class: 'input input-number', type: 'number', inputmode: 'numeric', value: value ?? '', ...props,
    onchange: (e) => onchange?.(e.target.value === '' ? null : Number(e.target.value), e),
  });
}

// ---------- markdown editor with [[link]] autocomplete ----------

const CARET_STYLE = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
  'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize', 'wordBreak'];

/** Viewport position of a textarea's caret, measured with an off-screen copy of its text: { left, top, height }. */
function caretRect(ta) {
  const cs = getComputedStyle(ta);
  const copy = document.createElement('div');
  for (const p of CARET_STYLE) copy.style[p] = cs[p];
  Object.assign(copy.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden' });
  copy.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '​';
  copy.append(mark);
  document.body.append(copy);
  const r = ta.getBoundingClientRect();
  const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  const out = { left: r.left + mark.offsetLeft - ta.scrollLeft, top: r.top + mark.offsetTop - ta.scrollTop, height };
  copy.remove();
  return out;
}

/**
 * markdownEditor({value, onInput(value), rows, placeholder, preview:false, autosize:true})
 * Returns an element with .value getter/setter, .focus(), .textarea, .setPreview(bool).
 */
export function markdownEditor({ value = '', onInput, rows = 8, placeholder = 'Write in Markdown. [[ links to notes, map:places, char:characters…', preview = false } = {}) {
  const ta = h('textarea', { class: 'textarea md-input', rows, placeholder, value, spellcheck: true });
  const pv = h('div', { class: 'md-preview prose', hidden: true });
  const suggest = h('ul', { class: 'md-suggest', hidden: true, role: 'listbox' });
  const toggle = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setPreview(pv.hidden) }, 'Preview');
  const wrap = (before, after = before) => () => {
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = ta.value.slice(s, e);
    ta.setRangeText(before + sel + after, s, e, 'end');
    if (!sel) ta.selectionStart = ta.selectionEnd = s + before.length;
    ta.focus({ preventScroll: true });
    fire();
  };
  // A press keeps the focus in the text: focusing it again would scroll the whole box into view.
  const tool = (label, title, fn) => h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title, onclick: fn, onmousedown: (e) => e.preventDefault() }, label);
  const toolbar = h('div', { class: 'md-toolbar' },
    tool(h('b', null, 'B'), 'Bold', wrap('**')),
    tool(h('i', null, 'I'), 'Italic', wrap('*')),
    tool(h('mark', null, 'H'), 'Highlight', wrap('==')),
    tool('[[ ]]', 'Link', wrap('[[', ']]')),
    tool('☐', 'Task', wrap('- [ ] ', '')),
    tool('❝', 'Callout', wrap('> [!note] ', '')),
    h('span', { class: 'md-toolbar-spacer' }),
    toggle);
  const el = h('div', { class: 'md-editor' }, toolbar, ta, pv);

  function fire() { onInput?.(ta.value); autosize(); revealSoon(); }
  // Fit the box to its text. It is shrunk to be measured, which (in Safari and Firefox) clamps the scroll of the page
  // or modal around it and would throw the line being typed out of sight, so their scroll is put back.
  function autosize() {
    const kept = [];
    for (let p = ta.parentElement; p; p = p.parentElement) if (p.scrollTop) kept.push([p, p.scrollTop]);
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight + 2, rows * 22)}px`;
    for (const [p, top] of kept) p.scrollTop = top;
  }
  // After an edit (and the browser's own scroll to the caret, which ignores the sticky toolbar), scroll the boxes
  // around the text just enough to bring the caret's line into sight if it is out of it: clear of their edges, the
  // toolbar and an on-screen keyboard. A caret already in sight stays where it is.
  let revealing = 0;
  function revealSoon() { revealing ||= requestAnimationFrame(() => { revealing = 0; revealCaret(); }); }
  function revealCaret() {
    if (document.activeElement !== ta || ta.hidden) return;
    const vv = window.visualViewport;
    const winTop = vv ? vv.offsetTop : 0;
    const winBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    let caret = null;
    for (let p = ta.parentElement; p; p = p.parentElement) {
      const root = p === document.scrollingElement;
      if (p.scrollHeight <= p.clientHeight || (!root && !/auto|scroll/.test(getComputedStyle(p).overflowY))) continue;
      const edge = root ? 0 : p.getBoundingClientRect().top + p.clientTop;
      const box = ta.getBoundingClientRect();
      const top = Math.max(edge, winTop);
      const bottom = Math.min(edge + p.clientHeight, winBottom);
      if (box.top >= top && box.bottom <= bottom) continue; // the whole box is in sight here
      caret ??= caretRect(ta);
      const pad = caret.height / 2;
      const lo = Math.max(top + pad, toolbar.getBoundingClientRect().bottom + 6);
      const hi = bottom - pad;
      if (hi - lo < caret.height) continue;
      const by = caret.top < lo ? caret.top - lo : caret.top + caret.height > hi ? caret.top + caret.height - hi : 0;
      if (!by) continue;
      const before = p.scrollTop;
      p.scrollTop = before + by;
      caret = { ...caret, top: caret.top - (p.scrollTop - before) };
    }
  }
  function setPreview(on) {
    if (on) hideSuggest();
    pv.hidden = !on;
    ta.hidden = on;
    toggle.textContent = on ? 'Edit' : 'Preview';
    toggle.classList.toggle('is-active', on);
    if (on) renderInto(pv, ta.value);
  }

  // [[ autocomplete: a small list just under the line being typed (above it when there is no room below). It lives
  // in the overlay layer while open, so a modal's scrolling body can't clip it and it never covers the text.
  let items = [];
  let active = 0;
  function context() {
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = /\[\[([^\]\n|]*)$/.exec(upto);
    return m ? { query: m[1], start: ta.selectionStart - m[1].length } : null;
  }
  function updateSuggest() {
    const c = context();
    if (!c) { hideSuggest(); return; }
    items = suggestLinks(c.query);
    active = 0;
    drawSuggest();
  }
  function drawSuggest() {
    clear(suggest);
    if (!items.length) { hideSuggest(); return; }
    items.forEach((it, i) => suggest.append(h('li', {
      class: ['md-suggest-item', i === active && 'is-active'],
      onmousedown: (e) => { e.preventDefault(); apply(it); },
    }, h('span', null, it.label), h('span', { class: 'muted' }, it.kind))));
    if (suggest.hidden) {
      suggest.hidden = false;
      overlays().append(suggest);
      window.addEventListener('scroll', placeSuggest, true);
      window.addEventListener('resize', placeSuggest);
      document.addEventListener('pointerdown', outside, true);
    }
    placeSuggest();
    suggest.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function hideSuggest() {
    if (suggest.hidden) return;
    suggest.hidden = true;
    suggest.remove();
    window.removeEventListener('scroll', placeSuggest, true);
    window.removeEventListener('resize', placeSuggest);
    document.removeEventListener('pointerdown', outside, true);
  }
  // A press anywhere but the list or the textarea closes it (blur does too; this also covers a removed editor).
  function outside(e) { if (!suggest.contains(e.target) && e.target !== ta) hideSuggest(); }
  function placeSuggest() {
    if (suggest.hidden) return;
    if (!ta.isConnected) { hideSuggest(); return; }
    const caret = caretRect(ta);
    const box = ta.getBoundingClientRect();
    // The caret scrolled out of its box (long note, scrolled modal): hide until it is back.
    if (caret.top + caret.height < box.top || caret.top > box.bottom) { suggest.style.visibility = 'hidden'; return; }
    suggest.style.visibility = '';
    const gap = 4;
    const below = window.innerHeight - (caret.top + caret.height) - gap - 8;
    const above = caret.top - gap - 8;
    const down = below >= 120 || below >= above;
    suggest.style.maxHeight = `${Math.max(64, Math.min(208, down ? below : above))}px`;
    const w = suggest.offsetWidth;
    suggest.style.left = `${Math.max(8, Math.min(caret.left - 6, window.innerWidth - w - 8))}px`;
    suggest.style.top = `${down ? caret.top + caret.height + gap : caret.top - gap - suggest.offsetHeight}px`;
  }
  function apply(it) {
    const c = context();
    if (!c) return;
    const after = ta.value.slice(ta.selectionStart);
    const closing = after.startsWith(']]') ? '' : ']]';
    ta.setRangeText(it.insert + (it.partial ? '' : closing), c.start, ta.selectionStart, 'end');
    if (!it.partial && !closing) ta.selectionStart = ta.selectionEnd = ta.selectionStart + 2;
    hideSuggest();
    fire();
    if (it.partial) updateSuggest();
  }
  ta.addEventListener('input', () => { fire(); updateSuggest(); });
  ta.addEventListener('keydown', (e) => {
    if (!suggest.hidden && items.length) {
      if (e.key === 'ArrowDown') { active = (active + 1) % items.length; drawSuggest(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; drawSuggest(); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { apply(items[active]); e.preventDefault(); return; }
      if (e.key === 'Escape') { hideSuggest(); e.stopPropagation(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**')(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*')(); }
  });
  ta.addEventListener('click', () => { if (!suggest.hidden) updateSuggest(); });
  ta.addEventListener('blur', () => setTimeout(hideSuggest, 150));

  Object.defineProperty(el, 'value', { get: () => ta.value, set: (v) => { ta.value = v; autosize(); if (!pv.hidden) renderInto(pv, v); } });
  el.textarea = ta;
  el.focus = () => ta.focus();
  el.setPreview = setPreview;
  requestAnimationFrame(autosize);
  if (preview) setPreview(true);
  return el;
}
