// Files pane: the vault explorer. Nested folders (expand state remembered), notes sorted by the chosen order,
// the open note highlighted and revealed, inline rename, a context menu per row, keyboard navigation and
// drag-and-drop moves (drop a note or folder onto a folder, or onto empty space for the vault root; dropping a note
// into the editor inserts a [[link]]).
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import * as J from './data.js';
import * as S from './state.js';
import { iconBtn } from './parts.js';
import { openMenu } from './menu.js';
import { plural } from './text.js';
import { hiddenMark } from '../../core/dm-ui.js';

const esc = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

export class FileTree {
  constructor(ctx) {
    this.ctx = ctx;
    this.activeNote = null;
    this.activeFolder = null;
    this.renaming = null;
    this.drag = null;
    this.count = h('span', { class: 'jr-pane-title' });
    this.sortBtn = iconBtn('sort', 'Sort order', () => this.sortMenu());
    this.newNoteBtn = iconBtn('file-plus', 'New note', () => ctx.newNote({ folder: ctx.targetFolder() }));
    const bar = h('div', { class: 'jr-pane-bar' },
      this.count,
      this.newNoteBtn,
      iconBtn('folder-plus', 'New folder at the top level', () => ctx.newFolder({ parent: J.index().root })),
      this.sortBtn,
      iconBtn('collapse', 'Collapse all folders', () => { S.collapseAll(); this.render(); }));
    this.treeEl = h('div', { class: 'jr-tree', role: 'tree', 'aria-label': 'Notes and folders' });
    this.scroller = h('div', { class: 'jr-pane-scroll jr-tree-scroll' }, this.treeEl);
    this.el = h('div', { class: 'jr-pane jr-files' }, bar, this.scroller);
    this.wire();
  }

  // ---------- rendering ----------

  /** Where the New note button files a note (the open note's folder). */
  setTarget(folder) {
    const t = folder && !folder.isRoot ? `New note in “${folder.title}”` : 'New note at the top level';
    this.newNoteBtn.title = t;
    this.newNoteBtn.setAttribute('aria-label', t);
  }

  /** Re-render only if the vault changed since the last render. */
  sync() { if (this.builtFor !== J.index()) this.render(); }

  render() {
    const ix = J.index();
    this.builtFor = ix;
    const keep = this.scroller.scrollTop;
    const focusKey = this.treeEl.contains(document.activeElement) ? document.activeElement.closest('.jr-row')?.dataset : null;
    this.count.textContent = plural(ix.notes.length, 'note');
    this.treeEl.replaceChildren(...this.children(ix.root, 0));
    if (!ix.notes.length && !ix.root.folders.length) {
      this.treeEl.append(h('p', { class: 'jr-pane-empty' }, 'No notes yet. Start one with the New note button above.'));
    }
    this.markActive(false);
    this.scroller.scrollTop = keep;
    if (focusKey) this.rowFor(focusKey.path ? 'note' : 'folder', focusKey.path || focusKey.folder)?.focus({ preventScroll: true });
    this.roving();
  }

  children(folder, depth) {
    const sort = S.prefs.sort;
    return [
      ...J.sortFolders(folder.folders, sort).map((f) => this.folderItem(f, depth)),
      ...J.sortNotes(folder.notes, sort).map((n) => this.noteItem(n, depth)),
    ];
  }

  folderItem(f, depth) {
    const open = S.isOpen(f.path);
    const row = h('div', {
      class: 'jr-row is-folder', role: 'treeitem', tabindex: '-1', draggable: 'true', 'data-folder': f.path,
      'aria-level': String(depth + 1), 'aria-expanded': String(open), style: `--depth:${depth}`, title: f.description ? `${f.title}\n${f.description.slice(0, 200)}` : null,
    },
    h('span', { class: 'jr-twisty', 'aria-hidden': 'true' }, icon('chevron-right')),
    h('span', { class: 'jr-row-label' }, f.title),
    h('span', { class: 'jr-row-count', title: plural(f.count, 'note') }, String(f.count)));
    const item = h('div', { class: ['jr-item', 'is-folder', open && 'is-open'], role: 'none', 'data-folder-item': f.path },
      h('div', { class: 'jr-line' }, row, this.moreBtn()));
    if (open) item.append(this.group(f, depth));
    return item;
  }

  group(f, depth) {
    const kids = this.children(f, depth + 1);
    return h('div', { class: 'jr-children', role: 'group', style: `--depth:${depth}` },
      kids.length ? kids : h('p', { class: 'jr-tree-none', style: `--depth:${depth + 1}` }, 'Empty folder'));
  }

  noteItem(n, depth) {
    const row = h('a', {
      class: 'jr-row is-note', role: 'treeitem', href: n.href, tabindex: '-1', draggable: 'true', 'data-path': n.path,
      'aria-level': String(depth + 1), style: `--depth:${depth}`,
    }, h('span', { class: 'jr-row-label' }, n.title), hiddenMark(n.path));
    return h('div', { class: 'jr-item is-note', role: 'none' }, h('div', { class: 'jr-line' }, row, this.moreBtn()));
  }

  moreBtn() {
    return h('button', { type: 'button', class: 'jr-row-more', tabindex: '-1', 'aria-label': 'More actions', title: 'More actions' }, icon('more'));
  }

  rowFor(type, path) {
    if (path == null) return null;
    return this.treeEl.querySelector(type === 'note' ? `.jr-row[data-path="${esc(path)}"]` : `.jr-row[data-folder="${esc(path)}"]`);
  }

  /** Highlight the open note (or folder page) and expand its folders so it is visible. */
  setActive({ note = null, folder = null } = {}) {
    this.activeNote = note ? note.path : null;
    this.activeFolder = folder && !folder.isRoot ? folder.path : null;
    const reveal = note ? note.folder : this.activeFolder ? this.activeFolder.split('/').slice(0, -1).join('/') : '';
    if (reveal && S.reveal(reveal)) this.render();
    else this.markActive(true);
  }

  markActive(scroll) {
    this.treeEl.querySelectorAll('.jr-row.is-active').forEach((r) => { r.classList.remove('is-active'); r.removeAttribute('aria-selected'); r.removeAttribute('aria-current'); });
    const row = this.activeNote ? this.rowFor('note', this.activeNote) : this.rowFor('folder', this.activeFolder);
    if (!row) return;
    row.classList.add('is-active');
    row.setAttribute('aria-selected', 'true');
    row.setAttribute('aria-current', 'page');
    if (scroll) row.scrollIntoView({ block: 'nearest' });
    this.roving();
  }

  roving() {
    const rows = [...this.treeEl.querySelectorAll('.jr-row')];
    const pick = rows.find((r) => r.tabIndex === 0 && r.isConnected) || rows.find((r) => r.classList.contains('is-active')) || rows[0];
    rows.forEach((r) => { r.tabIndex = r === pick ? 0 : -1; });
  }

  // ---------- folders ----------

  toggle(path, on = !S.isOpen(path)) {
    S.setOpen(path, on);
    const item = this.treeEl.querySelector(`[data-folder-item="${esc(path)}"]`);
    const f = J.folderAt(path);
    if (!item || !f) { this.render(); return; }
    item.classList.toggle('is-open', on);
    item.querySelector(':scope > .jr-line > .jr-row').setAttribute('aria-expanded', String(on));
    item.querySelector(':scope > .jr-children')?.remove();
    if (on) {
      item.append(this.group(f, f.depth));
      this.markActive(false);
    }
  }

  sortMenu() {
    openMenu({
      anchor: this.sortBtn, label: 'Sort order',
      items: J.SORTS.map((s) => ({
        label: s.label, checked: S.prefs.sort === s.id,
        onClick: () => { S.prefs.sort = s.id; S.savePrefs(); this.ctx.sorted(); },
      })),
    });
  }

  // ---------- inline rename ----------

  /** Swap a row's label for an input. Resolves after commit/cancel. */
  startRename(type, path) {
    const row = this.rowFor(type, path);
    if (!row) return;
    const item = type === 'note' ? J.noteByPath(path) : J.folderAt(path);
    if (!item) return;
    this.finishRename?.(false);
    const label = row.querySelector('.jr-row-label');
    const inp = h('input', {
      class: 'jr-rename', value: item.title, 'aria-label': type === 'note' ? 'Note name' : 'Folder name', maxlength: 120, spellcheck: false,
    });
    label.replaceWith(inp);
    row.draggable = false;
    row.classList.add('is-renaming');
    this.renaming = { type, path };
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      this.renaming = null;
      this.finishRename = null;
      const title = inp.value.trim();
      inp.replaceWith(label);
      row.draggable = true;
      row.classList.remove('is-renaming');
      row.focus({ preventScroll: true });
      if (commit && title && title !== item.title) {
        label.textContent = title;
        if (type === 'note') this.ctx.renameNote(item, title);
        else this.ctx.renameFolder(item, title);
      }
    };
    this.finishRename = finish;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    requestAnimationFrame(() => { inp.focus(); inp.select(); });
  }

  // ---------- events ----------

  itemOf(row) {
    return row.dataset.path ? { type: 'note', path: row.dataset.path } : { type: 'folder', path: row.dataset.folder };
  }

  wire() {
    const t = this.treeEl;
    t.addEventListener('click', (e) => {
      const more = e.target.closest('.jr-row-more');
      if (more) {
        e.preventDefault();
        const row = more.parentElement.querySelector('.jr-row');
        this.ctx.itemMenu(this.itemOf(row), { anchor: more, from: 'tree' });
        return;
      }
      const row = e.target.closest('.jr-row');
      if (!row || row.classList.contains('is-renaming')) return;
      t.querySelectorAll('.jr-row').forEach((r) => { r.tabIndex = r === row ? 0 : -1; });
      if (row.dataset.folder != null) { e.preventDefault(); this.toggle(row.dataset.folder); }
      else this.ctx.opened?.();
    });
    t.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.jr-row');
      if (!row || row.classList.contains('is-renaming')) return;
      e.preventDefault();
      this.ctx.itemMenu(this.itemOf(row), { x: e.clientX, y: e.clientY, from: 'tree' });
    });
    t.addEventListener('keydown', (e) => this.onKey(e));
    this.wireDrag();
  }

  onKey(e) {
    const row = e.target.closest?.('.jr-row');
    if (!row || row.classList.contains('is-renaming')) return;
    const rows = [...this.treeEl.querySelectorAll('.jr-row')];
    const i = rows.indexOf(row);
    const go = (r) => { if (!r) return; rows.forEach((x) => { x.tabIndex = x === r ? 0 : -1; }); r.focus(); };
    const folder = row.dataset.folder;
    const parentRow = () => row.closest('.jr-children')?.parentElement?.querySelector(':scope > .jr-line > .jr-row');
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); go(rows[i + 1]); }
    else if (k === 'ArrowUp') { e.preventDefault(); go(rows[i - 1]); }
    else if (k === 'Home') { e.preventDefault(); go(rows[0]); }
    else if (k === 'End') { e.preventDefault(); go(rows[rows.length - 1]); }
    else if (k === 'ArrowRight' && folder != null) {
      e.preventDefault();
      if (!S.isOpen(folder)) this.toggle(folder, true);
      else go([...this.treeEl.querySelectorAll('.jr-row')][i + 1]);
    } else if (k === 'ArrowLeft') {
      e.preventDefault();
      if (folder != null && S.isOpen(folder)) this.toggle(folder, false);
      else go(parentRow());
    } else if ((k === 'Enter' || k === ' ') && folder != null) { e.preventDefault(); this.toggle(folder); }
    else if (k === ' ' && row.dataset.path) { e.preventDefault(); row.click(); }
    else if (k === 'F2') { e.preventDefault(); this.startRename(row.dataset.path ? 'note' : 'folder', row.dataset.path || folder); }
    else if (k === 'Delete') { e.preventDefault(); this.ctx.deleteItem(this.itemOf(row)); }
    else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      this.ctx.itemMenu(this.itemOf(row), { x: r.left + 24, y: r.bottom, from: 'tree' });
    }
  }

  // ---------- drag and drop ----------

  /** The folder a drop at `target` would land in (null = not a valid spot). */
  destAt(target) {
    const ix = J.index();
    const item = target.closest?.('.jr-item');
    if (!item || !this.treeEl.contains(item)) return this.scroller.contains(target) ? ix.root : null;
    if (item.classList.contains('is-folder')) return J.folderAt(item.dataset.folderItem, ix);
    const row = item.querySelector('.jr-row');
    const n = J.noteByPath(row?.dataset.path, ix);
    return n ? J.folderOf(n, ix) : null;
  }

  canDrop(dest) {
    const d = this.drag;
    if (!d || !dest) return false;
    const ix = J.index();
    if (d.type === 'note') { const n = J.noteByPath(d.path, ix); return !!n && n.folder.toLowerCase() !== dest.path.toLowerCase(); }
    const f = J.folderAt(d.path, ix);
    return !!f && J.canMoveFolder(f, dest);
  }

  highlight(dest) {
    const key = dest ? (dest.isRoot ? '' : dest.path) : null;
    if (this.dropKey === key) return;
    this.dropKey = key;
    this.el.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop'));
    clearTimeout(this.expandTimer);
    if (key == null) return;
    if (dest.isRoot) { this.scroller.classList.add('is-drop'); return; }
    const item = this.treeEl.querySelector(`[data-folder-item="${esc(dest.path)}"]`);
    item?.classList.add('is-drop');
    if (item && !S.isOpen(dest.path)) this.expandTimer = setTimeout(() => { if (this.drag) this.toggle(dest.path, true); }, 700);
  }

  wireDrag() {
    const s = this.scroller;
    const end = () => {
      clearTimeout(this.expandTimer);
      this.treeEl.querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging'));
      this.el.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop'));
      this.dropKey = undefined;
      this.drag = null;
    };
    s.addEventListener('dragstart', (e) => {
      const row = e.target.closest?.('.jr-row');
      if (!row || row.classList.contains('is-renaming')) return;
      this.drag = this.itemOf(row);
      const item = this.drag.type === 'note' ? J.noteByPath(this.drag.path) : J.folderAt(this.drag.path);
      e.dataTransfer.effectAllowed = 'copyMove';
      try {
        e.dataTransfer.setData('text/plain', this.drag.type === 'note' ? `[[${item?.title || ''}]]` : `[[folder:${item?.title || ''}]]`);
      } catch { /* ignore */ }
      requestAnimationFrame(() => row.classList.add('is-dragging'));
    });
    s.addEventListener('dragover', (e) => {
      if (!this.drag) return;
      const dest = this.destAt(e.target);
      if (!this.canDrop(dest)) { this.highlight(null); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this.highlight(dest);
    });
    s.addEventListener('dragleave', (e) => { if (!s.contains(e.relatedTarget)) this.highlight(null); });
    s.addEventListener('drop', (e) => {
      if (!this.drag) return;
      const dest = this.destAt(e.target);
      const d = this.drag;
      const ok = this.canDrop(dest);
      end();
      if (!ok) return;
      e.preventDefault();
      this.ctx.moveItem(d, dest);
    });
    document.addEventListener('dragend', end);
  }
}
