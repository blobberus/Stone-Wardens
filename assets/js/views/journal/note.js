// The open note: one journal page. Reading view (rendered markdown, tickable tasks) or editing view (source with
// [[ autocomplete, autosave) toggled with Ctrl+E. The title is editable in place in both modes (rename on Enter/blur,
// with an offer to update links). Handles outside changes (conflict / removed banners) and in-page jumps
// (headings, search hits with highlighted terms).
import { h } from '../../core/dom.js';
import { icon, markdownEditor } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { debounce } from '../../core/util.js';
import * as J from './data.js';
import { toggleTaskAt, plural, fold, headingsOf } from './text.js';
import { tagList, metaLine, btn, emptyState } from './parts.js';
import { noteImages, imagesValue, slideshow, imagesPanel, dropIfUnused, chooseAndUpload, pickExisting } from './gallery.js';
import { isHidden } from '../../core/dm.js';
import { visibilityToggle } from '../../core/dm-ui.js';

const SAVE_MS = 400;
const HL = 'jr-find';

const SYNTAX = [
  ['[[Note]]', 'link to a note (or any page on the site with the same name)'],
  ['[[Note#Heading|shown text]]', 'link to a heading, with your own label'],
  ['[[Folder/Note]]', 'a note by its folder path, when two share a name'],
  ['[[map:Old Mill]]', 'a map location'],
  ['[[char:Mira#hp]]', 'a character sheet, or a spot on it'],
  ['[[spell:Fireball]]', 'compendium entries: weapon: armor: gear: item: spell: feat: species: class: background:'],
  ['[[doc:Handout]]', 'a document in the Warden’s Library'],
  ['[[folder:Sessions]]', 'a folder page (old [[chapter:…]] links still work)'],
  ['![[Note]]', 'embed another note (or ![[image.png]])'],
  ['#tag', 'tag the note; #quest/open nests'],
  ['==highlight==', 'highlight text'],
  ['%%secret%%', 'a comment only visible while editing'],
  ['- [ ] task', 'a checklist item, tickable while reading'],
  ['> [!warning] Title', 'a callout; add - after ] to fold it shut'],
];

const syntaxHelp = () => h('dl', { class: 'jr-syntax-list' }, SYNTAX.map(([code, what]) => [h('dt', null, h('code', null, code)), h('dd', null, what)]));

function autosize(ta) {
  const desk = ta.closest('.jr-desk');
  const keep = desk?.scrollTop; // shrinking the box to measure it would clamp the desk's scroll
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
  if (desk) desk.scrollTop = keep;
}

export class NoteView {
  constructor(host, note, ctx, { edit = false, focusTitle = false, anchor = null, find = null } = {}) {
    this.host = host; // the scrolling desk
    this.ctx = ctx;
    this.path = note.path;
    this.editing = false;
    this.destroyed = false;
    this.deleted = false;
    this.load(note);
    this.saver = debounce(() => this.writeNow(), SAVE_MS);
    this.liveSoon = debounce(() => { if (!this.destroyed) ctx.sideLive(this); }, SAVE_MS + 150); // after the autosave
    this.render();
    if (edit) this.setEditing(true, { focusTitle });
    else if (find) requestAnimationFrame(() => this.find(find));
    else if (anchor) requestAnimationFrame(() => this.scrollTo(anchor, false));
  }

  load(note) {
    this.note = note;
    this.fm = { ...note.fm };
    this.body = note.body;
    this.title = note.title;
    this.lastText = note.text;
    this.dirty = false;
  }

  /** Latest indexed version of this note (falls back to what we loaded). */
  get current() { return J.noteByPath(this.path) || this.note; }

  // ---------- saving ----------

  queueSave() { this.dirty = true; this.saver(); }

  writeNow() {
    this.saver.cancel();
    if (!this.dirty || this.deleted) return;
    this.dirty = false;
    this.fm = { ...this.fm, title: this.title };
    this.lastText = J.writeNote(this.path, this.fm, this.body);
  }

  /** The note was renamed or moved by the view (path and title already written). */
  renamed(path, title = this.title) {
    this.path = path;
    this.title = title;
    this.fm = { ...this.fm, title };
    const n = J.noteByPath(path);
    if (n) { this.lastText = n.text; this.note = n; }
    if (this.titleEl && document.activeElement !== this.titleEl) { this.titleEl.value = title; autosize(this.titleEl); }
  }

  // ---------- rendering ----------

  render() {
    const note = this.current;
    this.clearFind();
    this.banner = h('div', { class: 'jr-banner', role: 'status', hidden: true });
    this.titleEl = h('textarea', {
      class: 'jr-title', rows: 1, value: this.title, 'aria-label': 'Note title', placeholder: 'Untitled', maxlength: 160, spellcheck: true,
      title: 'Click to rename',
    });
    this.titleEl.addEventListener('input', () => {
      this.titleEl.value = this.titleEl.value.replace(/\n/g, ' ');
      autosize(this.titleEl);
      this.ctx.titleDraft(this.titleEl.value.trim() || 'Untitled');
    });
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.editing) this.editor?.focus(); else this.titleEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.titleEl.value = this.title;
        autosize(this.titleEl);
        this.ctx.titleDraft(this.title);
        this.titleEl.blur();
      }
    });
    this.titleEl.addEventListener('change', () => this.commitTitle());
    this.titleEl.addEventListener('blur', () => this.commitTitle());

    const head = h('header', { class: 'jr-sheet-head' },
      this.titleEl,
      metaLine(note),
      visibilityToggle(this.path, { label: 'this note', before: () => this.writeNow() }), // DM mode only
      note.tags.length ? tagList(note.tags, { className: 'jr-sheet-tags' }) : null);
    this.bodyEl = h('div', { class: 'jr-sheet-body' });
    if (this.editing) this.buildEditor(this.bodyEl);
    else this.buildReader(this.bodyEl, note);

    const refs = J.backlinks(note).length;
    const foot = h('footer', { class: 'jr-sheet-foot' },
      h('span', { class: 'jr-fleuron', 'aria-hidden': 'true' }),
      refs ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm jr-refs', onclick: () => this.ctx.openRight('backlinks') },
        icon('link'), h('span', null, `Linked from ${plural(refs, 'note')}`)) : null);

    this.sheet = h('article', { class: 'jr-sheet jr-note', 'data-mode': this.editing ? 'editing' : 'reading', 'aria-label': this.title },
      this.banner, head, this.bodyEl, foot);
    this.host.replaceChildren(this.sheet);
    // The title grows with its text: refit when the page width changes or the display font arrives.
    const fit = () => { if (this.titleEl?.isConnected) autosize(this.titleEl); };
    this.ro?.disconnect();
    let lastW = 0;
    this.ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width || 0);
      if (w !== lastW) { lastW = w; requestAnimationFrame(fit); }
    });
    this.ro.observe(head);
    document.fonts?.ready.then(fit);
    requestAnimationFrame(fit);
  }

  buildReader(el, note) {
    // reference images: a slideshow at the top of the page; "Expand" / a tap opens the full-screen viewer
    const imgs = noteImages(this.fm);
    if (imgs.length) el.append(slideshow(imgs, { start: Math.min(this.galIndex || 0, imgs.length - 1), onIndex: (i) => { this.galIndex = i; } }));
    if (this.body.trim()) {
      const prose = h('div', { class: 'jr-prose' });
      J.withNote(note, () => renderInto(prose, this.body, { onTaskToggle: () => {} }));
      // A leading "# Title" that repeats the page title would show the name twice.
      const first = prose.firstElementChild;
      const same = (a) => String(a || '').trim().toLowerCase();
      if (first?.tagName === 'H1' && same(first.textContent) === same(this.title)) first.classList.add('jr-dup-title');
      this.wireTasks(prose);
      el.append(prose);
    } else {
      el.append(emptyState({
        iconName: 'edit', title: 'A blank page', text: 'Nothing has been written here yet.',
        actions: [btn('Start writing', () => this.setEditing(true), { ic: 'edit', small: false })],
      }));
    }
  }

  /** Task checkboxes: index among this note's own boxes (not embedded ones) -> toggle in source. */
  wireTasks(prose) {
    const own = () => [...prose.querySelectorAll('li input[type="checkbox"]')].filter((b) => !b.closest('.embed'));
    prose.querySelectorAll('.embed input[type="checkbox"]').forEach((b) => { b.disabled = true; });
    own().forEach((b) => {
      b.disabled = false;
      const li = b.closest('li');
      li?.classList.add('task-list-item');
      li?.classList.toggle('is-checked', b.checked);
    });
    prose.addEventListener('change', (e) => {
      const box = e.target;
      if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox' || box.closest('.embed')) return;
      const i = own().indexOf(box);
      if (i < 0) return;
      box.closest('li')?.classList.toggle('is-checked', box.checked);
      const next = toggleTaskAt(this.body, i, box.checked);
      if (next === this.body) return;
      this.body = next;
      this.dirty = true;
      this.writeNow();
    });
  }

  buildEditor(el) {
    this.editor = markdownEditor({
      value: this.body,
      rows: 16,
      placeholder: 'Write in Markdown. Type [[ to link a note, map:place, char:character…',
      onInput: (v) => { this.body = v; this.queueSave(); this.liveSoon(); },
    });
    this.editor.classList.add('jr-editor');
    el.append(imagesPanel({ list: noteImages(this.fm), slug: this.current.slug || 'note', hidden: () => isHidden(this.path), onChange: (list, removed) => this.setImages(list, removed) }),
      this.editor,
      h('p', { class: 'jr-hint jr-edit-hint' }, 'Kept on this device as you type. Press Save (Ctrl+S) to share it with the party. Ctrl+E goes back to reading.'),
      h('details', { class: 'jr-syntax' }, h('summary', null, 'Formatting help'), syntaxHelp()));
  }

  // ---------- reference images ----------

  /** Replace the note's reference images (frontmatter `images:`); files no note lists any more are dropped. */
  setImages(list, removed = []) {
    if (this.deleted) return;
    const value = imagesValue(list);
    this.fm = { ...this.fm };
    if (value) this.fm.images = value; else delete this.fm.images;
    this.dirty = true;
    this.writeNow();
    const others = J.index().notes.filter((n) => n.path !== this.path);
    for (const src of removed) if (!list.some((x) => x.src === src)) dropIfUnused(src, others);
    if (this.galIndex >= list.length) this.galIndex = Math.max(0, list.length - 1);
    this.ctx.sideLive?.(this);
  }

  /** From the note menu (any mode): upload photos, or pick images already in the repository. */
  async addImages(from = 'upload') {
    const added = from === 'repo' ? await pickExisting(noteImages(this.fm).map((x) => x.src)) : await chooseAndUpload(this.current.slug || 'note', { hidden: isHidden(this.path) });
    if (!added.length || this.destroyed) return;
    const list = [...noteImages(this.fm), ...added];
    if (!this.editing) this.galIndex = list.length - added.length;
    this.setImages(list);
    this.render();
  }

  // ---------- modes ----------

  setEditing(on, { focusTitle = false } = {}) {
    if (on === this.editing || this.destroyed) return;
    if (this.titleEl && this.titleEl.value.replace(/\s+/g, ' ').trim() !== this.title) this.commitTitle(); // renames synchronously
    const desk = this.host;
    const ratio = desk.scrollHeight > desk.clientHeight ? desk.scrollTop / (desk.scrollHeight - desk.clientHeight) : 0;
    if (on) {
      const latest = J.noteByPath(this.path);
      if (latest && !this.dirty) this.load(latest);
      this.editing = true;
    } else {
      this.writeNow();
      this.editing = false;
      this.editor = null;
    }
    this.render();
    this.ctx.chrome();
    this.ctx.sideLive(this);
    requestAnimationFrame(() => {
      if (desk.scrollHeight > desk.clientHeight) desk.scrollTop = ratio * (desk.scrollHeight - desk.clientHeight);
      if (!on) return;
      if (focusTitle) { this.titleEl.focus(); this.titleEl.select(); }
      else if (this.editor) { const ta = this.editor.textarea; ta.focus({ preventScroll: true }); if (ratio === 0) ta.setSelectionRange(0, 0); }
    });
  }

  // ---------- title ----------

  async commitTitle() {
    if (this.destroyed || this.deleted || !this.titleEl) return;
    const title = this.titleEl.value.replace(/\s+/g, ' ').trim();
    if (!title) { this.titleEl.value = this.title; autosize(this.titleEl); this.ctx.titleDraft(this.title); return; }
    if (title === this.title || this.committing) return;
    this.committing = true;
    try {
      this.writeNow();
      await this.ctx.renameNote(this.current, title);
    } finally {
      this.committing = false;
    }
  }

  focusTitle() {
    this.titleEl?.focus();
    this.titleEl?.select();
  }

  // ---------- navigation within the page ----------

  /** Scroll the desk so `el` sits near the top. */
  reveal(el, smooth = true) {
    const desk = this.host;
    const top = el.getBoundingClientRect().top - desk.getBoundingClientRect().top + desk.scrollTop - 24;
    desk.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  /** In editing mode: caret to a source line and scroll it into view. */
  caretToLine(line, smooth = true) {
    const ta = this.editor?.textarea;
    if (!ta || line == null) return;
    const lines = this.body.split('\n');
    const pos = lines.slice(0, line).join('\n').length + (line ? 1 : 0);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, pos + (lines[line] || '').length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 27;
    const desk = this.host;
    const top = ta.getBoundingClientRect().top - desk.getBoundingClientRect().top + desk.scrollTop + line * lh - 80;
    desk.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  headingEl(id) {
    return [...this.sheet.querySelectorAll('.jr-prose :is(h1, h2, h3, h4, h5, h6)')].find((x) => x.id === id && !x.closest('.embed')) || null;
  }

  /** Jump to a heading (outline entry {id, line} or a slug). */
  jumpTo(x, smooth = true) {
    const id = typeof x === 'string' ? x : x.id;
    if (this.editing) {
      const line = typeof x === 'object' ? x.line : headingsOf(this.body).find((hd) => hd.id === id)?.line;
      this.caretToLine(line, smooth);
      return;
    }
    this.scrollTo(id, smooth);
  }

  scrollTo(id, smooth = true) {
    if (this.editing) { this.jumpTo(id, smooth); return; }
    const target = this.headingEl(id);
    if (!target) return;
    this.reveal(target, smooth);
    this.flash(target);
    history.replaceState(null, '', `${this.current.href}?h=${encodeURIComponent(id)}`);
  }

  flash(el) {
    el.classList.remove('jr-flash');
    void el.offsetWidth;
    el.classList.add('jr-flash');
  }

  /** Opened from search or a backlink: highlight the terms and scroll to the matching line. */
  find({ terms = [], line = null } = {}) {
    if (this.destroyed) return;
    if (this.editing) { if (line) this.caretToLine(line.line, false); return; }
    const prose = this.sheet.querySelector('.jr-prose');
    if (!prose) return;
    const want = (terms || []).map((t) => fold(t)).filter(Boolean);
    const ranges = [];
    if (want.length) {
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const low = fold(n.data);
        for (const t of want) {
          let i = low.indexOf(t);
          while (i >= 0) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + t.length);
            ranges.push(r);
            i = low.indexOf(t, i + t.length);
          }
        }
      }
      if (ranges.length && window.CSS?.highlights && window.Highlight) CSS.highlights.set(HL, new Highlight(...ranges));
    }
    let target = null;
    if (line?.text) {
      const probe = fold(line.text).slice(0, 48).trim();
      const blocks = [...prose.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, pre, .callout-title, blockquote')].filter((b) => !b.closest('.embed'));
      target = blocks.reverse().find((b) => fold(b.textContent.replace(/\s+/g, ' ')).includes(probe)) || null;
    }
    if (!target && ranges.length) target = ranges[0].startContainer.parentElement;
    if (target) { this.reveal(target, false); this.flash(target); }
  }

  clearFind() { if (window.CSS?.highlights) CSS.highlights.delete(HL); }

  /** The heading at the top of the reading view (for the outline). */
  headingInView() {
    if (this.editing || !this.sheet) return null;
    const deskTop = this.host.getBoundingClientRect().top;
    let id = null;
    for (const el of this.sheet.querySelectorAll('.jr-prose :is(h1, h2, h3, h4, h5, h6)')) {
      if (el.closest('.embed')) continue;
      if (el.getBoundingClientRect().top - deskTop > 96) break;
      id = el.id;
    }
    return id;
  }

  /** Same note, new route (e.g. ?h= changed). */
  update(route) {
    if (route.query.h) requestAnimationFrame(() => this.scrollTo(route.query.h, true));
  }

  // ---------- outside changes ----------

  /** Journal files changed (elsewhere, or by the view's own folder operations). paths: changed paths or null. */
  external(paths) {
    if (this.destroyed) return;
    const latest = J.noteByPath(this.path);
    const mine = !paths || paths.includes(this.path);
    if (this.editing) {
      if (mine && (!latest || latest.text !== this.lastText)) this.showConflict(latest);
      return;
    }
    if (!latest) { this.showGone(); return; }
    if (latest.text !== this.lastText) this.load(latest);
    const desk = this.host;
    const keep = desk.scrollTop;
    const hadFocus = document.activeElement === this.titleEl;
    if (hadFocus) return; // don't yank the title out from under the cursor
    this.render();
    desk.scrollTop = keep;
  }

  showConflict(latest) {
    const b = this.banner;
    if (!b) return;
    b.replaceChildren(
      icon('warning'),
      h('span', { class: 'jr-banner-text' }, latest
        ? 'Another Warden changed this note while you were writing.'
        : 'This note was removed elsewhere while you were writing.'),
      latest ? btn('Load their version', () => {
        this.load(latest);
        if (this.editor) this.editor.value = this.body;
        if (this.titleEl) { this.titleEl.value = this.title; autosize(this.titleEl); }
        b.hidden = true;
        this.ctx.chrome();
        this.liveSoon();
      }, { kind: 'ghost' }) : null,
      btn(latest ? 'Keep mine' : 'Keep my copy', () => { this.dirty = true; this.writeNow(); b.hidden = true; this.ctx.refresh(); }, { kind: 'ghost' }));
    b.hidden = false;
  }

  showGone() {
    const b = this.banner;
    if (!b) return;
    const f = J.folderAt(this.note.folder) || J.index().root;
    b.replaceChildren(
      icon('warning'),
      h('span', { class: 'jr-banner-text' }, 'This note was removed by another Warden.'),
      btn('Restore it', () => { J.put(this.path, this.lastText); b.hidden = true; this.ctx.refresh(); }, { kind: 'ghost' }),
      h('a', { class: 'btn btn-sm btn-ghost', href: f.href }, `Back to ${f.title}`));
    b.hidden = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.liveSoon.cancel();
    this.ro?.disconnect();
    this.clearFind();
    if (!this.deleted) {
      this.writeNow();
      const draft = this.titleEl?.value.replace(/\s+/g, ' ').trim();
      if (draft && draft !== this.title && !this.committing) this.ctx.renameNote(this.current, draft);
    }
  }
}
