// The note spread. Right page: the note in reading view, or source mode (Ctrl+E) with autosave.
// Left page: the chapter's contents, the note's outline, linked/unlinked mentions and tags,
// or, in split view while editing, a live preview. Rename (with link updates), move, delete.
import { h, clear } from '../../core/dom.js';
import { icon, toast, confirmDialog, markdownEditor } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { debounce } from '../../core/util.js';
import * as J from './data.js';
import { headingsOf, toggleTaskAt, plural } from './text.js';
import { add, block, tagList, metaLine, notesList, btn, iconBtn, emptyState, highlighted, chapterName } from './parts.js';
import { moveNoteDialog } from './dialogs.js';

const SAVE_MS = 400;

const SYNTAX = [
  ['[[Note]]', 'link to a note (or any page on the site with the same name)'],
  ['[[Note#Heading|shown text]]', 'link to a heading, with your own label'],
  ['[[map:Old Mill]]', 'a map location'],
  ['[[char:Mira#hp]]', 'a character sheet, or a spot on it'],
  ['[[spell:Fireball]]', 'compendium entries: weapon: armor: gear: item: spell: feat: species: class: background:'],
  ['[[doc:Handout]]', 'a document in the Warden’s Library'],
  ['[[chapter:Title]]', 'a chapter’s title page'],
  ['![[Note]]', 'embed another note (or ![[image.png]])'],
  ['#tag', 'tag the note; #quest/open nests'],
  ['==highlight==', 'highlight text'],
  ['%%secret%%', 'a comment only visible while editing'],
  ['- [ ] task', 'a checklist item, tickable while reading'],
  ['> [!warning] Title', 'a callout; add - after ] to fold it shut'],
];

function syntaxHelp() {
  return h('dl', { class: 'jr-syntax-list' }, SYNTAX.map(([code, what]) => [h('dt', null, h('code', null, code)), h('dd', null, what)]));
}

export class NoteView {
  constructor(pages, note, ctx, { edit = false, anchor = null } = {}) {
    this.pages = pages;
    this.ctx = ctx;
    this.path = note.path;
    this.editing = false;
    this.split = false;
    this.destroyed = false;
    this.deleted = false;
    this.committing = false;
    this.load(note);
    this.saver = debounce(() => this.writeNow(), SAVE_MS);
    this.sideSoon = debounce(() => { if (!this.destroyed) this.renderVerso(); }, SAVE_MS + 150); // after the autosave, so tags are fresh
    this.previewSoon = debounce(() => this.updatePreview(), 150);
    this.render();
    if (edit) this.setEditing(true);
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

  // ---------- rendering ----------

  render() { this.renderVerso(); this.renderRecto(); }

  renderVerso() {
    const v = this.pages.verso;
    const note = this.current;
    const ch = J.chapterOf(note);
    v.setHead(h('a', { href: ch.href }, chapterName(ch)));
    if (this.editing && this.split) {
      clear(v.body);
      this.previewEl = h('div', { class: 'jr-live' });
      v.body.append(h('p', { class: 'jr-kicker jr-live-label' }, 'Live preview'), this.previewEl);
      this.updatePreview();
    } else {
      const keep = v.body.scrollTop;
      this.previewEl = null;
      clear(v.body);
      add(v.body,
        block(ch.loose ? 'Loose Leaves' : 'In this chapter', notesList(ch, { current: note }), { count: ch.notes.length }),
        this.outlineBlock(),
        this.mentionsBlock(note),
        note.tags.length ? block('Tags', tagList(note.tags)) : null);
      v.body.scrollTop = keep;
    }
    const { prev } = J.prevNext(note);
    v.setFoot({ prev: prev ? { href: prev.href, title: prev.title } : { href: '#/journal', title: 'Contents', kicker: 'Back to' } });
  }

  outlineBlock() {
    const heads = headingsOf(this.body);
    if (!heads.length) return null;
    const min = Math.min(...heads.map((x) => x.level));
    return block('Outline', h('ol', { class: 'jr-outline', role: 'list' }, heads.map((x) => h('li', { style: `--depth:${x.level - min}` },
      h('a', {
        href: J.noteHref(this.current, x.raw),
        onclick: (e) => { e.preventDefault(); this.scrollTo(x.id, true, x.line); },
      }, x.text)))));
  }

  mentionsBlock(note) {
    const links = J.backlinks(note);
    const unlinked = J.unlinkedMentions(note, links);
    const linked = links.length
      ? h('ul', { class: 'jr-mentions', role: 'list' }, links.map((b) => h('li', null,
        h('a', { class: 'jr-mention-title', href: b.note.href }, b.note.title,
          b.count > 1 ? h('span', { class: 'jr-count' }, `×${b.count}`) : null),
        b.context.map((c) => h('p', { class: 'jr-mention-context' }, c)))))
      : h('p', { class: 'jr-hint' }, 'No other note links here yet. Link to this one with ', h('code', null, `[[${note.title}]]`), '.');
    const loose = unlinked.length ? h('details', { class: 'jr-unlinked' },
      h('summary', null, `Unlinked mentions (${unlinked.length})`),
      h('ul', { class: 'jr-mentions', role: 'list' }, unlinked.map((u) => h('li', null,
        h('a', { class: 'jr-mention-title', href: u.note.href }, u.note.title),
        h('p', { class: 'jr-mention-context' }, highlighted(u.text, u.ranges)))))) : null;
    return block('Linked mentions', [linked, loose], { count: links.length });
  }

  renderRecto() {
    const r = this.pages.recto;
    this.renderHead();
    clear(r.body);
    this.banner = h('div', { class: 'jr-banner', role: 'status', hidden: true });
    r.body.append(this.banner);
    if (this.editing) this.buildEditor(r.body);
    else this.buildReader(r.body);
    this.renderFoot();
  }

  renderHead() {
    const editing = this.editing;
    this.runTitle = h('span', { class: 'jr-runhead-title' }, this.title);
    this.pages.recto.setHead(this.runTitle, h('div', { class: 'jr-tools' },
      editing ? btn(this.split ? 'One page' : 'Split view', () => this.setSplit(!this.split), {
        ic: 'layers', kind: 'ghost', pressed: this.split, className: 'jr-split-btn', title: 'Show a live preview on the facing page',
      }) : null,
      iconBtn('copy', 'Copy a link to this note', () => this.copyLink()),
      iconBtn('folder', 'Move to another chapter', () => this.move()),
      iconBtn('trash', 'Delete this note', () => this.remove(), { className: 'jr-danger' }),
      btn(editing ? 'Done' : 'Edit', () => this.setEditing(!editing), {
        ic: editing ? 'check' : 'edit', title: `${editing ? 'Back to reading' : 'Edit this note'} (Ctrl+E)`,
      })));
  }

  renderFoot() {
    const note = this.current;
    const { next } = J.prevNext(note);
    this.pages.recto.setFoot({ folio: note.folio || '', next: next ? { href: next.href, title: next.title } : null });
  }

  buildReader(el) {
    const note = this.current;
    const prose = h('div', { class: 'jr-note-body' });
    if (this.body.trim()) {
      J.withNote(note, () => renderInto(prose, this.body, { onTaskToggle: () => {} }));
      this.wireTasks(prose);
    } else {
      prose.append(emptyState({
        iconName: 'edit', title: 'A blank page', text: 'Nothing has been written here yet.',
        actions: [btn('Start writing', () => this.setEditing(true), { ic: 'edit', small: false })],
      }));
    }
    el.append(h('article', { class: 'jr-note' },
      h('header', { class: 'jr-note-head' },
        h('h1', { class: 'jr-note-title', title: 'Double-click to rename', ondblclick: () => this.setEditing(true, { focusTitle: true }) }, this.title),
        metaLine(note)),
      prose));
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
    const note = this.current;
    this.titleInput = h('input', {
      class: 'jr-title-input', value: this.title, placeholder: 'Untitled', 'aria-label': 'Note title', maxlength: 120, spellcheck: true,
      oninput: () => {
        this.title = this.titleInput.value.trim() || 'Untitled';
        if (this.runTitle) this.runTitle.textContent = this.title;
        this.queueSave();
      },
      onchange: () => this.commitTitle(),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.editor?.focus(); } },
    });
    this.editor = markdownEditor({
      value: this.body,
      rows: 18,
      onInput: (v) => { this.body = v; this.queueSave(); this.onTyping(); },
    });
    this.editor.classList.add('jr-editor');
    el.append(h('div', { class: 'jr-edit' },
      h('header', { class: 'jr-note-head' },
        this.titleInput,
        metaLine(note),
        h('p', { class: 'jr-hint' }, 'Kept on this device as you type. Press Save (Ctrl+S) to share it with the party.')),
      this.editor,
      h('details', { class: 'jr-syntax' }, h('summary', null, 'Formatting help'), syntaxHelp())));
  }

  onTyping() {
    if (this.split) this.previewSoon();
    else this.sideSoon();
  }

  updatePreview() {
    if (!this.previewEl || this.destroyed) return;
    J.withNote(this.current, () => renderInto(this.previewEl, this.body.trim() ? this.body : '*Nothing written yet.*'));
  }

  // ---------- modes ----------

  async setEditing(on, { focusTitle = false } = {}) {
    if (on === this.editing || this.destroyed) return;
    if (on) {
      const latest = J.noteByPath(this.path);
      if (latest && !this.dirty) this.load(latest);
      this.ixAtOpen = J.index();
      this.titleAtOpen = this.title;
      this.pathAtOpen = this.path;
      this.editing = true;
    } else {
      this.writeNow();
      await this.commitTitle();
      if (this.destroyed) return;
      this.editing = false;
      this.split = false;
      this.editor = null;
      this.titleInput = null;
    }
    this.render();
    this.ctx.chrome();
    if (on) {
      requestAnimationFrame(() => {
        if (focusTitle) this.titleInput?.select();
        else if (this.editor) { this.editor.focus(); const ta = this.editor.textarea; ta.setSelectionRange(ta.value.length, ta.value.length); }
      });
    }
  }

  setSplit(on) {
    this.split = !!on;
    this.renderHead();
    this.renderVerso();
    this.pages.verso.el.closest('.jr-book')?.classList.toggle('is-split', this.split);
  }

  // ---------- rename / move / delete ----------

  async commitTitle() {
    if (this.committing || this.deleted || !this.editing || this.titleAtOpen == null) return;
    const title = this.title;
    const old = this.titleAtOpen;
    if (title === old) return;
    this.committing = true;
    try {
      this.writeNow();
      const note = J.noteByPath(this.path);
      if (!note) return;
      const path = J.renameNote(note, title, this.body);
      this.lastText = J.noteByPath(path)?.text ?? this.lastText;
      if (path !== this.path) {
        this.path = path;
        if (!this.destroyed) this.ctx.replaceRoute(J.hrefForPath(path));
      }
      const plan = J.noteLinkPlan(this.ixAtOpen, this.pathAtOpen, title, { exclude: [this.path] });
      this.titleAtOpen = title;
      if (plan.count) {
        const ok = await confirmDialog(
          `${plural(plan.count, 'link')} in ${plural(plan.notes.length, 'other note')} still point${plan.count === 1 ? 's' : ''} to “${old}”. Update ${plan.count === 1 ? 'it' : 'them'} to “${title}”?`,
          { title: 'Update links?', okLabel: 'Update links', cancelLabel: 'Leave them' },
        );
        if (ok) toast(`Updated ${plural(plan.apply(), 'link')}.`, { type: 'success' });
      }
      this.ixAtOpen = J.index();
      this.pathAtOpen = this.path;
      if (!this.destroyed) {
        this.ctx.chrome();
        if (!this.split) this.renderVerso();
        this.renderFoot();
      }
    } finally {
      this.committing = false;
    }
  }

  async move() {
    this.writeNow();
    const note = this.current;
    const dest = await moveNoteDialog(note);
    if (!dest || this.destroyed) return;
    const path = J.moveNote(note, dest.slug);
    this.path = path;
    this.lastText = J.noteByPath(path)?.text ?? this.lastText;
    toast(`Moved to ${chapterName(dest)}.`, { type: 'success' });
    this.ctx.replaceRoute(J.hrefForPath(path));
    if (this.editing) { this.renderVerso(); this.renderFoot(); } else this.render();
    this.ctx.chrome();
  }

  async remove() {
    const note = this.current;
    const refs = J.backlinks(note).length;
    const ok = await confirmDialog(
      `Delete “${note.title}”?${refs ? ` ${plural(refs, 'other note')} link${refs === 1 ? 's' : ''} here; those links will offer to recreate it.` : ''}`,
      { title: 'Delete note', okLabel: 'Delete note', danger: true },
    );
    if (!ok || this.destroyed) return;
    this.saver.cancel();
    this.dirty = false;
    this.deleted = true;
    const ch = J.chapterOf(note);
    J.deleteNote(note);
    toast(`Deleted “${note.title}”.`);
    this.ctx.go(ch.href, { replace: true });
  }

  async copyLink() {
    const text = `[[${this.title}]]`;
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${text}. Paste it into any note to link here.`, { type: 'success' });
    } catch {
      toast(`Link: ${text}`, { timeout: 8000 });
    }
  }

  // ---------- navigation within the page ----------

  scrollTo(id, smooth = true, line = null) {
    const body = this.pages.recto.body;
    if (this.editing) {
      const ta = this.editor?.textarea;
      if (!ta || line == null) return;
      const pos = this.body.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, pos);
      // The textarea grows with its content, so scroll whichever ancestor actually scrolls (page or stage).
      let box = body;
      while (box && box !== document.body && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement;
      if (!box || box === document.body) return;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 27;
      const top = ta.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + line * lh - 48;
      box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    const target = [...body.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((x) => x.id === id && !x.closest('.embed'));
    if (!target) return;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    target.classList.remove('jr-flash');
    void target.offsetWidth;
    target.classList.add('jr-flash');
    history.replaceState(null, '', `${this.current.href}?h=${encodeURIComponent(id)}`);
  }

  /** Same note, new route (e.g. ?h= changed). */
  update(route) {
    if (route.query.h) requestAnimationFrame(() => this.scrollTo(route.query.h, true));
  }

  // ---------- outside changes ----------

  /** Journal files changed elsewhere (another player, a pull, a discard). */
  external(paths) {
    if (this.destroyed) return;
    const latest = J.noteByPath(this.path);
    const mine = !paths || paths.includes(this.path);
    if (this.editing) {
      if (mine && (!latest || latest.text !== this.lastText)) this.showConflict(latest);
      if (!this.split) this.renderVerso();
      this.renderFoot();
      return;
    }
    if (!latest) { this.showGone(); return; }
    if (latest.text !== this.lastText) this.load(latest);
    const r = this.pages.recto.body;
    const keep = r.scrollTop;
    this.render();
    r.scrollTop = keep;
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
        if (this.titleInput) this.titleInput.value = this.title;
        if (this.runTitle) this.runTitle.textContent = this.title;
        this.titleAtOpen = this.title;
        b.hidden = true;
        this.onTyping();
      }, { kind: 'ghost' }) : null,
      btn(latest ? 'Keep mine' : 'Keep my copy', () => { this.dirty = true; this.writeNow(); b.hidden = true; }, { kind: 'ghost' }));
    b.hidden = false;
  }

  showGone() {
    const b = this.banner;
    if (!b) return;
    const ch = J.chapterOf(this.note);
    b.replaceChildren(
      icon('warning'),
      h('span', { class: 'jr-banner-text' }, 'This note was removed by another Warden.'),
      btn('Restore it', () => { J.put(this.path, this.lastText); b.hidden = true; this.render(); this.ctx.chrome(); }, { kind: 'ghost' }),
      h('a', { class: 'btn btn-sm btn-ghost', href: ch.href }, `Back to ${ch.loose ? 'Loose Leaves' : ch.label}`));
    b.hidden = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; // set first: a title commit below must not navigate back here
    this.sideSoon.cancel();
    this.previewSoon.cancel();
    if (!this.deleted) {
      this.writeNow();
      if (this.editing) this.commitTitle();
    }
    this.pages.verso.el.closest('.jr-book')?.classList.remove('is-split');
  }
}
