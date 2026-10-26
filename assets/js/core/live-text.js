// Plain-text markdown editing that shows headings at their size as you type: a contenteditable box with one block per
// source line (the "#" marks stay, faded). To the code around it, it is a <textarea>: value, selectionStart/End,
// setSelectionRange, setRangeText, focus(), and an 'input' event after each change. Typing within a line is left to
// the browser (so spelling, autocorrect and IMEs work as usual) and read back. Edits that split or join lines (Enter,
// Backspace at a line start, typing over several lines, paste, cut, drop) are applied here. It keeps its own undo
// history, because redrawing lines would confuse the browser's.

const HEADING = /^ {0,3}#{1,6}[ \t]+/;
const FENCE = /^[ \t]*(```|~~~)/;
const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;
const GROUP_MS = 1000; // typing within this long of the last keystroke, where it left off, is one undo step
const HISTORY = 300;

/** Heading level (1-6) of each line, 0 for the rest. Nothing inside fenced code is a heading. */
export function lineLevels(lines) {
  let fence = null;
  return lines.map((line) => {
    const f = FENCE.exec(line);
    if (fence) { if (f && f[1] === fence) fence = null; return 0; }
    if (f) { fence = f[1]; return 0; }
    const m = HEADING.exec(line);
    return m ? m[0].split('#').length - 1 : 0;
  });
}

// A <br> that only holds its block open (nothing after it in the block) does not start a line.
function trailing(br, root) {
  for (let n = br; n && n !== root; n = n.parentNode) {
    for (let s = n.nextSibling; s; s = s.nextSibling) {
      if (s.nodeType === 1 && BLOCK.test(s.nodeName)) return true;
      if (s.nodeType === 3 ? s.data : s.nodeType === 1 && (s.nodeName === 'BR' || s.textContent || s.querySelector('br'))) return false;
    }
    if (n.parentNode === root || BLOCK.test(n.parentNode.nodeName)) return true;
  }
  return true;
}

/**
 * The text under `root` as the browser shows it (a line per block or <br>), and the text offsets of `points`
 * ([node, offset] pairs; null for a point not under root).
 */
export function readLines(root, points = []) {
  const lines = [];
  const at = points.map(() => null);
  let cur = null; // the line being read (null between blocks)
  let done = 0; // length of the lines read so far, each with its newline
  const here = () => done + (cur ? cur.length : 0);
  const hit = (node, i) => points.forEach((p, k) => { if (at[k] === null && p[0] === node && p[1] === i) at[k] = here(); });
  const open = () => { if (cur === null) cur = ''; };
  const close = () => { if (cur !== null) { lines.push(cur); done += cur.length + 1; cur = null; } };
  const walk = (node) => {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      hit(node, i);
      const n = kids[i];
      if (n.nodeType === 3) {
        points.forEach((p, k) => { if (at[k] === null && p[0] === n) at[k] = here() + Math.min(p[1], n.data.length); });
        n.data.split('\n').forEach((part, j) => {
          if (j) { open(); close(); }
          if (part || j) { open(); cur += part; }
        });
      } else if (n.nodeName === 'BR') {
        open();
        if (!trailing(n, root)) close();
      } else if (n.nodeType === 1 && !BLOCK.test(n.nodeName)) {
        walk(n);
      } else if (n.nodeType === 1) {
        close();
        const before = lines.length;
        walk(n);
        if (cur === null && lines.length === before) open(); // an empty block is an empty line
        close();
      }
    }
    hit(node, kids.length);
  };
  walk(root);
  close();
  if (!lines.length) lines.push('');
  const total = lines.reduce((sum, l) => sum + l.length + 1, -1);
  return { lines, at: at.map((x) => (x === null ? null : Math.min(x, total))) };
}

const lineClass = (level) => (level ? `md-line md-h${level}` : 'md-line');

/** Draw one line into its block: the text, a faded mark for a heading's "#"s, or a <br> holding an empty line open. */
function fill(div, text, level) {
  const m = level ? HEADING.exec(text) : null;
  div.className = lineClass(level);
  if (!text) div.replaceChildren(document.createElement('br'));
  else if (!m) div.replaceChildren(text);
  else {
    const mark = document.createElement('span');
    mark.className = 'md-mark';
    mark.textContent = m[0];
    div.replaceChildren(mark, ...(text.length > m[0].length ? [text.slice(m[0].length)] : []));
  }
  div.mdLevel = level;
  return div;
}

/** Whether a block the browser typed into is still what fill() would make of its text. */
function tidy(div, text, level) {
  if (div.nodeName !== 'DIV' || div.className !== lineClass(level)) return false;
  const k = div.childNodes;
  if (!text) return k.length === 1 && k[0].nodeName === 'BR';
  const m = level ? HEADING.exec(text) : null;
  if (!m) return k.length === 1 && k[0].nodeType === 3;
  const mark = k[0];
  return mark.nodeName === 'SPAN' && mark.className === 'md-mark' && mark.childNodes.length === 1 && mark.textContent === m[0]
    && (text.length > m[0].length ? k.length === 2 && k[1].nodeType === 3 : k.length === 1);
}

/** liveText({value, placeholder, className}) -> the editing element (see the top of this file). */
export function liveText({ value = '', placeholder = '', className = '' } = {}) {
  const el = document.createElement('div');
  el.className = className;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; // older Firefox: formatting and paste are caught below
  el.spellcheck = true;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');
  if (placeholder) { el.dataset.placeholder = placeholder; el.setAttribute('aria-placeholder', placeholder); }

  let lines = []; // the text, one entry per block on screen
  let text = '';
  let sel = { start: 0, end: 0, back: false }; // kept while blurred, like a textarea's
  let composing = false;
  let stale = false; // the blocks need redrawing once the IME is done
  let emitting = false;
  let pre = null; // text and selection just before the browser's own edit
  const undos = [];
  const redos = [];
  let group = null; // the run of typing the last undo step covers: { kind, time, at (where it left off) }

  const setLines = (next) => { lines = next; text = next.join('\n'); el.classList.toggle('is-empty', !text); };
  const startOf = (i) => { let n = 0; for (let k = 0; k < i; k++) n += lines[k].length + 1; return n; };
  const clamp = (n) => Math.max(0, Math.min(Number(n) || 0, text.length));
  const blockOf = (node) => { let d = node; while (d && d.parentNode !== el) d = d.parentNode; return d; };

  // ---------- drawing ----------

  /** Show `next`, redrawing only the lines that changed (and any whose heading level a fence changed). */
  function draw(next) {
    const levels = lineLevels(next);
    const kids = el.children;
    const max = Math.min(lines.length, next.length);
    let a = 0;
    while (a < max && lines[a] === next[a]) a++;
    let b = 0;
    while (b < max - a && lines[lines.length - 1 - b] === next[next.length - 1 - b]) b++;
    for (let k = lines.length - b - 1; k >= a; k--) kids[k].remove();
    const frag = document.createDocumentFragment();
    for (let k = a; k < next.length - b; k++) frag.append(fill(document.createElement('div'), next[k], levels[k]));
    el.insertBefore(frag, kids[a] || null);
    for (let k = 0; k < next.length; k++) if (kids[k].mdLevel !== levels[k]) fill(kids[k], next[k], levels[k]);
    setLines(next);
  }

  function redrawAll(next) {
    lines = [];
    el.replaceChildren();
    draw(next);
  }

  // ---------- selection: text offsets <-> places in the blocks ----------

  function point(pos) {
    let i = 0;
    while (i < lines.length - 1 && pos > lines[i].length) { pos -= lines[i].length + 1; i++; }
    const div = el.children[i];
    if (!div) return [el, 0];
    const texts = [];
    for (const n of div.childNodes) {
      if (n.nodeType === 3) texts.push(n);
      else if (n.firstChild?.nodeType === 3) texts.push(n.firstChild);
    }
    let left = Math.max(0, Math.min(pos, lines[i].length));
    for (let k = 0; k < texts.length; k++) {
      // at the end of a heading's mark, the caret goes to the start of the title after it
      if (left < texts[k].data.length || k === texts.length - 1) return [texts[k], Math.min(left, texts[k].data.length)];
      left -= texts[k].data.length;
    }
    return [div, 0];
  }

  function offset(node, off) {
    if (node === el) return off >= lines.length ? text.length : startOf(off);
    const div = blockOf(node);
    const i = div ? Array.prototype.indexOf.call(el.children, div) : -1;
    if (i < 0) return null;
    const r = document.createRange();
    r.setStart(div, 0);
    r.setEnd(node, off);
    return startOf(i) + Math.min(r.toString().length, lines[i].length);
  }

  function readSel() {
    const s = document.getSelection();
    if (document.activeElement === el && s?.rangeCount && el.contains(s.anchorNode) && el.contains(s.focusNode)) {
      const a = offset(s.anchorNode, s.anchorOffset);
      const f = offset(s.focusNode, s.focusOffset);
      if (a !== null && f !== null) sel = { start: Math.min(a, f), end: Math.max(a, f), back: f < a };
    }
    return sel;
  }

  function showSel() {
    if (document.activeElement !== el) return;
    const [an, ao] = point(sel.back ? sel.end : sel.start);
    const [fn, fo] = point(sel.back ? sel.start : sel.end);
    document.getSelection().setBaseAndExtent(an, ao, fn, fo);
  }

  const onSelChange = () => {
    if (!el.isConnected) document.removeEventListener('selectionchange', onSelChange); // removed while focused
    else if (!composing) readSel();
  };
  el.addEventListener('focus', () => document.addEventListener('selectionchange', onSelChange));
  el.addEventListener('blur', () => document.removeEventListener('selectionchange', onSelChange));

  // ---------- edits ----------

  function emit() {
    emitting = true;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } finally { emitting = false; }
  }

  /**
   * Keep `before` (the text and selection before a change) for undo, unless it continues the last run of typing (or
   * of deleting) from where that left off. kind: 'insert' / 'delete' for typing, anything else is a step of its own.
   */
  function remember(kind, before) {
    const now = Date.now();
    const typing = kind === 'insert' || kind === 'delete';
    const more = typing && group?.kind === kind && now - group.time < GROUP_MS && group.at === before.start && before.start === before.end;
    if (!more) {
      undos.push(before);
      if (undos.length > HISTORY) undos.shift();
    }
    group = typing ? { kind, time: now, at: null } : null;
    redos.length = 0;
  }

  /** Replace text[start, end) with `insert`; select per setRangeText's modes ('end' puts the caret after it). */
  function change(start, end, insert, { mode = 'end', fire = true } = {}) {
    const before = { text, start: sel.start, end: sel.end };
    remember('edit', before);
    draw((text.slice(0, start) + insert + text.slice(end)).split('\n'));
    const stop = start + insert.length;
    const delta = insert.length - (end - start);
    if (mode === 'select') sel = { start, end: stop, back: false };
    else if (mode === 'start') sel = { start, end: start, back: false };
    else if (mode === 'preserve') {
      const s = before.start > end ? before.start + delta : before.start > start ? start : before.start;
      const e = before.end > end ? before.end + delta : before.end > start ? stop : before.end;
      sel = { start: s, end: e, back: false };
    } else sel = { start: stop, end: stop, back: false };
    showSel();
    if (fire) emit();
  }

  function restore(state) {
    draw(state.text.split('\n'));
    sel = { start: state.start, end: state.end, back: false };
    group = null;
    showSel();
    emit();
  }
  function undo() {
    while (undos.length && undos[undos.length - 1].text === text) undos.pop(); // typing that ended where it began
    if (!undos.length) return;
    readSel();
    redos.push({ text, start: sel.start, end: sel.end });
    restore(undos.pop());
  }
  function redo() {
    if (!redos.length) return;
    readSel();
    undos.push({ text, start: sel.start, end: sel.end });
    restore(redos.pop());
  }

  /**
   * Read back what the browser typed. Usually that is one line; anything else is read whole. The blocks are then
   * tidied to what draw() makes, except while an IME is composing (changing them then would break it).
   */
  function pull(settle) {
    const s = document.getSelection();
    const pts = s?.rangeCount ? [[s.anchorNode, s.anchorOffset], [s.focusNode, s.focusOffset]] : [];
    const div = blockOf(s?.focusNode);
    const i = div ? Array.prototype.indexOf.call(el.childNodes, div) : -1;
    let at;
    let only = -1;
    if (i >= 0 && el.childNodes.length === lines.length) {
      const r = readLines(div, pts);
      if (r.lines.length === 1) {
        const next = lines.slice();
        next[i] = r.lines[0];
        setLines(next);
        const base = startOf(i);
        at = r.at.map((x) => (x === null ? null : base + x));
        only = i;
      }
    }
    if (only < 0) {
      const r = readLines(el, pts);
      setLines(r.lines);
      at = r.at;
      stale = true;
    }
    const a = at[0] ?? at[1];
    const f = at[1] ?? at[0];
    if (a != null) sel = { start: Math.min(a, f), end: Math.max(a, f), back: f < a };
    if (!settle) return;
    const levels = lineLevels(lines);
    let moved = false;
    if (stale) {
      redrawAll(lines);
      stale = false;
      moved = true;
    } else {
      for (let k = 0; k < lines.length; k++) {
        const d = el.children[k];
        if (k === only ? !tidy(d, lines[k], levels[k]) : d.mdLevel !== levels[k]) {
          fill(d, lines[k], levels[k]);
          if (k === only) moved = true;
        }
      }
    }
    if (moved) showSel();
  }

  el.addEventListener('beforeinput', (e) => {
    const type = e.inputType || '';
    readSel();
    pre = { text, start: sel.start, end: sel.end };
    if (composing || e.isComposing || type === 'insertCompositionText' || !e.cancelable) return;
    if (type === 'historyUndo' || type === 'historyRedo') {
      e.preventDefault();
      if (type === 'historyUndo') undo(); else redo();
      return;
    }
    if (type.startsWith('format')) { e.preventDefault(); return; }
    const insert = type === 'insertParagraph' || type === 'insertLineBreak' ? '\n'
      : type.startsWith('insert') ? (e.data ?? e.dataTransfer?.getData('text/plain') ?? '')
        : type.startsWith('delete') ? '' : null;
    if (insert === null) return;
    const r = e.getTargetRanges?.()[0];
    let a = r ? offset(r.startContainer, r.startOffset) : null;
    let b = r ? offset(r.endContainer, r.endOffset) : null;
    if (a === null || b === null) { a = sel.start; b = sel.end; }
    if (a > b) [a, b] = [b, a];
    const clean = insert.replace(/\r\n?/g, '\n');
    if (!clean.includes('\n') && !text.slice(a, b).includes('\n')) return; // within a line: the browser does it
    e.preventDefault();
    pre = null;
    change(a, b, clean);
  });

  el.addEventListener('input', (e) => {
    if (emitting) return;
    const before = pre || { text, start: sel.start, end: sel.end };
    pre = null;
    const was = text;
    pull(!composing && !e.isComposing);
    if (text === was) return;
    remember((e.inputType || '').startsWith('delete') ? 'delete' : 'insert', before);
    group.at = sel.start;
  });

  el.addEventListener('compositionstart', () => { composing = true; });
  el.addEventListener('compositionend', () => {
    composing = false;
    setTimeout(() => {
      if (!el.isConnected || composing) return;
      const was = text;
      pull(true);
      if (text !== was) emit();
    });
  });

  el.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y' && !e.shiftKey) { e.preventDefault(); redo(); }
  });

  // The clipboard carries plain text, exactly as written.
  el.addEventListener('copy', (e) => {
    readSel();
    if (sel.start === sel.end || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text.slice(sel.start, sel.end));
  });
  el.addEventListener('cut', (e) => {
    readSel();
    if (sel.start === sel.end || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text.slice(sel.start, sel.end));
    change(sel.start, sel.end, '');
  });
  el.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    readSel();
    const t = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (t || sel.start !== sel.end) change(sel.start, sel.end, t);
  });
  el.addEventListener('dragstart', (e) => e.preventDefault()); // text is moved with cut and paste
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const t = e.dataTransfer?.getData('text/plain');
    if (!t) return;
    const p = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const r = p ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const at = p ? offset(p.offsetNode, p.offset) : r ? offset(r.startContainer, r.startOffset) : null;
    el.focus({ preventScroll: true });
    const pos = at ?? sel.start;
    sel = { start: pos, end: pos, back: false };
    change(pos, pos, t.replace(/\r\n?/g, '\n'));
  });

  // ---------- the textarea interface ----------

  Object.defineProperty(el, 'value', {
    get: () => text,
    set: (v) => {
      redrawAll(String(v ?? '').replace(/\r\n?/g, '\n').split('\n'));
      undos.length = 0;
      redos.length = 0;
      group = null;
      sel = { start: text.length, end: text.length, back: false };
      showSel();
    },
  });
  el.setSelectionRange = (start, end = start, dir = 'none') => {
    const e = clamp(end);
    sel = { start: Math.min(clamp(start), e), end: e, back: dir === 'backward' };
    showSel();
  };
  Object.defineProperty(el, 'selectionStart', {
    get: () => readSel().start,
    set: (v) => { readSel(); el.setSelectionRange(v, Math.max(clamp(v), sel.end)); },
  });
  Object.defineProperty(el, 'selectionEnd', {
    get: () => readSel().end,
    set: (v) => { readSel(); el.setSelectionRange(Math.min(sel.start, clamp(v)), v); },
  });
  el.setRangeText = (insert, start, end, mode = 'preserve') => {
    readSel();
    const a = start === undefined ? sel.start : clamp(start);
    const b = start === undefined ? sel.end : clamp(end);
    change(Math.min(a, b), Math.max(a, b), String(insert).replace(/\r\n?/g, '\n'), { mode, fire: false });
  };
  const focusEl = HTMLElement.prototype.focus;
  el.focus = (opts) => {
    const keep = sel;
    focusEl.call(el, opts);
    sel = keep;
    showSel();
  };
  /** Viewport position of the caret (the selection's start): { left, top, height }. */
  el.caretRect = () => {
    const [n, o] = point(readSel().start);
    const line = (n.nodeType === 1 ? n : n.parentElement).closest('.md-line') || el;
    const cs = getComputedStyle(line);
    const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const r = document.createRange();
    r.setStart(n, o);
    const box = r.getClientRects()[0];
    if (box) return { left: box.left, top: box.top, height: box.height || height };
    const lr = line.getBoundingClientRect();
    return { left: lr.left + (parseFloat(cs.paddingLeft) || 0), top: lr.top, height };
  };
  /** Viewport top of source line i. */
  el.lineTop = (i) => (el.children[Math.max(0, Math.min(i, el.children.length - 1))] || el).getBoundingClientRect().top;

  el.value = value;
  return el;
}
