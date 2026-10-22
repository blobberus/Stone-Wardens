// Journal: the party's notes as an Obsidian-style vault (see docs/journal-model.md).
// Left pane: Files (folder tree) | Search | Tags. Main pane: breadcrumb, Read/Edit toggle, the note on a journal page.
// Right pane: properties, outline, backlinks, outgoing links. Below 1100px the right pane is a drawer; on phones both are.
// Routes:
//   #/journal                    vault home (recent notes, folders, unwritten pages, tags)
//   #/journal?q=…  ?tag=…        open the Search pane with that query (the open note stays)
//   #/journal/new?title=…        "New note" dialog (unresolved [[links]] point here)
//   #/journal/_                  vault root folder page; #/journal/_/<note> a note in the root
//   #/journal/<folder…>          folder page (also what [[folder:X]] / [[chapter:X]] open)
//   #/journal/<folder…>/<note>   a note; ?h=<heading-slug> scrolls to a heading
// Keys: Ctrl+O / Ctrl+K quick switcher, Ctrl+E read/edit, Ctrl+Shift+F search, F2 rename.
import { h } from '../../core/dom.js';
import { icon, toast, confirmDialog } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate, onRoute } from '../../core/router.js';
import { saveSoon, majorSaveOn } from '../../core/saving.js';
import * as J from './data.js';
import * as S from './state.js';
import { FileTree } from './tree.js';
import { SearchPane, TagsPane } from './search.js';
import { SidePane } from './side.js';
import { NoteView } from './note.js';
import { renderHome, renderFolder, renderMissing } from './pages.js';
import { newNoteDialog, pickFolder, confirmDeleteFolder, propertiesDialog, descriptionDialog, openSwitcher } from './dialogs.js';
import { openMenu, closeMenu } from './menu.js';
import { iconBtn } from './parts.js';
import { plural } from './text.js';

let root = null;
let left = null;
let right = null;
let scrim = null;
let desk = null;
let crumbs = null;
let tabs = {};
let files = null;
let search = null;
let tags = null;
let side = null;
let btns = {};
let route = null; // last journal route that decided the main pane
let target = null; // what the main pane shows: {kind:'home'|'note'|'folder'|'missing', note?, folder?, view?}
let noteView = null;
let visible = false;
let stale = false;
let tagsStale = true;
let searchStale = false;
let lastHash = null; // previous route anywhere in the app (where "cancel" on #/journal/new returns to)
let pending = null; // {path, edit, focusTitle, find}: how to open a note we are about to navigate to
let newOpen = false;
let size = 'wide'; // wide (both panes inline) | mid (left inline, right drawer) | narrow (both drawers)
let drawer = null; // 'left' | 'right' | null
let refreshTimer = null;
let scrollRaf = 0;
const changed = new Set();

const currentNote = () => (noteView && !noteView.destroyed ? noteView.current : null);
function targetFolder() {
  const ix = J.index();
  const n = currentNote();
  if (n) return J.folderOf(n, ix);
  if (target?.kind === 'folder') return J.folderAt(target.folder.path, ix) || ix.root;
  return ix.root;
}

const ctx = {
  refresh: () => refreshAll(),
  chrome: () => renderChrome(),
  sideLive: (view) => { side.live(view); if (S.prefs.left === 'tags' && isLeftShown()) tags.render(); else tagsStale = true; },
  titleDraft: (t) => renderChrome(t),
  currentNote,
  targetFolder,
  newNote: (o) => newNote(o),
  newFolder: (o) => newFolder(o),
  renameNote: (n, t) => renameNote(n, t),
  renameFolder: (f, t) => renameFolder(f, t),
  moveItem: (d, dest) => moveItem(d, dest),
  deleteItem: (d) => deleteItem(d),
  itemMenu: (d, pos) => itemMenu(d, pos),
  openFound: (n, o) => openFound(n, o),
  jumpToHeading: (x) => { noteView?.jumpTo(x); if (size !== 'wide') closeDrawers(); },
  editProperties: (n) => editProperties(n),
  editDescription: (f) => editDescription(f),
  openRight: (sec) => openRight(sec),
  closeRight: () => closeRight(),
  showLeft: (tab) => showLeft(tab),
  switcher: () => switcher(),
  sorted: () => { files.render(); if (target?.kind === 'folder') refreshMain(); },
  searchTag: (tag) => { showLeft('search'); search.setQuery(`tag:#${tag}`); tags.render(); },
  activeTag: () => /^tag:#?(\S+)$/.exec(search?.query || '')?.[1] || null,
  opened: () => {},
};

// ---------- layout ----------

function tabBtn(id, ic, label) {
  return h('button', {
    type: 'button', class: 'jr-ltab', role: 'tab', id: `jr-tab-${id}`, 'aria-controls': `jr-pane-${id}`, title: label,
    onclick: () => setTab(id, { focus: true }),
  }, icon(ic), h('span', null, label));
}

function resizer(sideName) {
  const el = h('div', { class: 'jr-resizer', 'data-side': sideName, role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize, double-click to reset' });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const pane = sideName === 'left' ? left : right;
    const box = pane.getBoundingClientRect();
    const move = (ev) => {
      const w = Math.round(Math.max(200, Math.min(520, sideName === 'left' ? ev.clientX - box.left : box.right - ev.clientX)));
      S.prefs[sideName === 'left' ? 'leftW' : 'rightW'] = w;
      root.style.setProperty(`--jr-${sideName}-w`, `${w}px`);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); S.savePrefs(); root.classList.remove('is-resizing'); };
    root.classList.add('is-resizing');
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => {
    S.prefs[sideName === 'left' ? 'leftW' : 'rightW'] = sideName === 'left' ? 280 : 300;
    S.savePrefs();
    layout();
  });
  return el;
}

function mount(el) {
  files = new FileTree(ctx);
  search = new SearchPane(ctx);
  tags = new TagsPane(ctx);
  side = new SidePane(ctx);
  tabs = { files: tabBtn('files', 'folder', 'Files'), search: tabBtn('search', 'search', 'Search'), tags: tabBtn('tags', 'tag', 'Tags') };
  const panes = { files: files.el, search: search.el, tags: tags.el };
  for (const [id, p] of Object.entries(panes)) Object.assign(p, { id: `jr-pane-${id}` }).setAttribute('role', 'tabpanel');
  left = h('aside', { class: 'jr-left', 'aria-label': 'Files, search and tags' },
    h('div', { class: 'jr-ltabs', role: 'tablist', 'aria-label': 'Side panel' }, tabs.files, tabs.search, tabs.tags,
      iconBtn('close', 'Close the panel', () => closeDrawers(), { className: 'jr-drawer-close' })),
    files.el, search.el, tags.el, resizer('left'));

  btns.left = iconBtn('sidebar-left', 'Files, search and tags', () => toggleLeft(), { className: 'jr-bar-left' });
  btns.read = h('button', { type: 'button', class: 'jr-mode', title: 'Reading view (Ctrl+E)', onclick: () => noteView?.setEditing(false) }, icon('book-open'), h('span', null, 'Read'));
  btns.edit = h('button', { type: 'button', class: 'jr-mode', title: 'Editing view (Ctrl+E)', onclick: () => noteView?.setEditing(true) }, icon('edit'), h('span', null, 'Edit'));
  btns.modes = h('div', { class: 'jr-modes', role: 'group', 'aria-label': 'View mode' }, btns.read, btns.edit);
  btns.jump = iconBtn('compass', 'Jump to a note (Ctrl+O)', () => switcher());
  btns.more = iconBtn('more', 'More actions', () => moreMenu());
  btns.right = iconBtn('sidebar-right', 'Outline, backlinks and properties', () => toggleRight(), { className: 'jr-bar-right' });
  crumbs = h('nav', { class: 'jr-crumbs', 'aria-label': 'Breadcrumb' });
  desk = h('div', { class: 'jr-desk', tabindex: '-1' });
  const main = h('div', { class: 'jr-main' },
    h('header', { class: 'jr-bar' }, btns.left, crumbs, h('div', { class: 'jr-bar-tools' }, btns.modes, btns.jump, btns.more, btns.right)),
    desk);
  right = h('aside', { class: 'jr-right', 'aria-label': 'Note details' }, side.el, resizer('right'));
  scrim = h('div', { class: 'jr-scrim', hidden: true, onclick: () => closeDrawers() });
  root = h('div', { class: 'jr-root' }, left, main, right, scrim);
  el.append(root);
  setTab(S.prefs.left);

  store.on(onStore);
  onRoute((r) => { lastHash = `#/${r.hash}`; });
  document.addEventListener('keydown', onKey);
  const flush = () => noteView?.writeNow();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  new ResizeObserver(() => layout()).observe(root);
  desk.addEventListener('scroll', () => {
    if (scrollRaf || !noteView) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; if (noteView) side.markHeading(noteView.headingInView()); });
  }, { passive: true });
  layout();
}

function layout() {
  if (!root) return;
  const w = root.clientWidth || window.innerWidth;
  const next = w >= 1100 ? 'wide' : w >= 700 ? 'mid' : 'narrow';
  if (next !== size) { size = next; drawer = null; }
  const leftInline = size !== 'narrow' && S.prefs.leftOpen;
  const rightInline = size === 'wide' && S.prefs.rightOpen;
  root.dataset.size = size;
  root.classList.toggle('has-left', leftInline);
  root.classList.toggle('has-right', rightInline);
  root.classList.toggle('is-left-drawer', drawer === 'left');
  root.classList.toggle('is-right-drawer', drawer === 'right');
  root.style.setProperty('--jr-left-w', `${S.prefs.leftW}px`);
  root.style.setProperty('--jr-right-w', `${S.prefs.rightW}px`);
  scrim.hidden = !drawer;
  btns.left.setAttribute('aria-pressed', String(leftInline || drawer === 'left'));
  btns.right.setAttribute('aria-pressed', String(rightInline || drawer === 'right'));
  btns.left.setAttribute('aria-expanded', String(leftInline || drawer === 'left'));
  btns.right.setAttribute('aria-expanded', String(rightInline || drawer === 'right'));
}

const isLeftShown = () => (size === 'narrow' ? drawer === 'left' : S.prefs.leftOpen);
const isRightShown = () => (size === 'wide' ? S.prefs.rightOpen : drawer === 'right');

function toggleLeft() {
  if (size === 'narrow') drawer = drawer === 'left' ? null : 'left';
  else { S.prefs.leftOpen = !S.prefs.leftOpen; S.savePrefs(); }
  layout();
  if (isLeftShown()) freshenLeft();
}

function toggleRight() {
  if (size === 'wide') { S.prefs.rightOpen = !S.prefs.rightOpen; S.savePrefs(); }
  else drawer = drawer === 'right' ? null : 'right';
  layout();
}

function showLeft(tab = S.prefs.left) {
  setTab(tab);
  if (size === 'narrow') drawer = 'left';
  else if (!S.prefs.leftOpen) { S.prefs.leftOpen = true; S.savePrefs(); }
  layout();
}

function openRight(sec = null) {
  if (size === 'wide') { if (!S.prefs.rightOpen) { S.prefs.rightOpen = true; S.savePrefs(); } } else drawer = 'right';
  layout();
  if (sec) {
    const el = side.body.querySelector(`.jr-sec[data-sec="${sec}"]`);
    const head = el?.querySelector('.jr-sec-head');
    if (head?.getAttribute('aria-expanded') === 'false') head.click();
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function closeRight() {
  if (size === 'wide') { S.prefs.rightOpen = false; S.savePrefs(); } else if (drawer === 'right') drawer = null;
  layout();
}

function closeDrawers() {
  if (!drawer) return;
  drawer = null;
  layout();
}

function setTab(id, { focus = false } = {}) {
  if (!tabs[id]) id = 'files';
  S.prefs.left = id;
  S.savePrefs();
  for (const [k, b] of Object.entries(tabs)) {
    b.classList.toggle('is-active', k === id);
    b.setAttribute('aria-selected', String(k === id));
    b.tabIndex = k === id ? 0 : -1;
  }
  files.el.hidden = id !== 'files';
  search.el.hidden = id !== 'search';
  tags.el.hidden = id !== 'tags';
  freshenLeft();
  if (focus && id === 'search') search.focus();
}

function freshenLeft() {
  if (S.prefs.left === 'tags' && tagsStale) { tagsStale = false; tags.render(); }
  if (S.prefs.left === 'search' && searchStale) { searchStale = false; search.refresh(); }
}

// ---------- routing ----------

function show(r) {
  visible = true;
  const wasStale = stale;
  stale = false;
  if (wasStale) { files.render(); tagsStale = true; searchStale = true; freshenLeft(); }
  const [a, b] = r.parts;
  if (a === 'new' && !b) {
    if (!target || wasStale) renderTarget(J.resolveRoute(route?.parts || [], route?.query || {}), route || { parts: [], query: {} });
    openNewFromRoute(r);
    return;
  }
  if (!r.parts.length && (r.query.q != null || r.query.tag != null)) {
    const q = r.query.tag != null ? `tag:#${r.query.tag.replace(/^#/, '')}` : r.query.q;
    showLeft('search');
    if (search.query !== q) search.setQuery(q);
    tags.render();
    if (!target || wasStale) renderTarget(J.resolveRoute(route?.parts || [], route?.query || {}), route || { parts: [], query: {} });
    else renderChrome();
    return;
  }
  route = r;
  if (drawer) { drawer = null; layout(); }
  const t = J.resolveRoute(r.parts, r.query);
  if (t.kind === 'note' && noteView && !noteView.destroyed && t.note.path === noteView.path) {
    if (wasStale) noteView.external(null);
    const p = pending && pending.path === t.note.path ? pending : null;
    pending = null;
    if (p?.find) noteView.find(p.find);
    else noteView.update(r);
    syncPanes();
    renderChrome();
    return;
  }
  renderTarget(t, r);
}

function hide() {
  visible = false;
  noteView?.writeNow();
  closeMenu();
  if (drawer) { drawer = null; layout(); }
}

function renderTarget(t, r) {
  noteView?.destroy();
  noteView = null;
  target = t;
  desk.scrollTop = 0;
  if (t.kind === 'note') {
    const p = pending && pending.path === t.note.path ? pending : null;
    pending = null;
    noteView = new NoteView(desk, t.note, ctx, { edit: !!p?.edit, focusTitle: !!p?.focusTitle, anchor: r.query.h || null, find: p?.find || null });
    t.view = noteView;
    S.remember(t.note.path);
  } else if (t.kind === 'folder') renderFolder(desk, t.folder, ctx);
  else if (t.kind === 'missing') renderMissing(desk, t, ctx);
  else renderHome(desk, ctx);
  root.dataset.mode = t.kind;
  syncPanes();
  renderChrome();
}

/** Re-render a non-note main page in place (keeps scroll). */
function refreshMain() {
  if (!route || noteView) return;
  const keep = desk.scrollTop;
  renderTarget(J.resolveRoute(route.parts, route.query), route);
  desk.scrollTop = keep;
}

function syncPanes() {
  files.sync();
  files.setTarget(targetFolder());
  files.setActive({ note: target?.kind === 'note' ? currentNote() : null, folder: target?.kind === 'folder' ? target.folder : null });
  search.markActive();
  side.render(target?.kind === 'note' ? { kind: 'note', note: currentNote() || target.note, view: noteView } : target);
}

/** Re-render everything after vault changes (our own operations, or outside changes with their paths). */
function refreshAll(paths = null) {
  if (!visible) { stale = true; return; }
  files.render();
  tagsStale = true;
  searchStale = true;
  if (isLeftShown()) freshenLeft();
  if (noteView) {
    noteView.external(paths);
    const n = currentNote();
    if (n) target.note = n;
    syncPanes();
    renderChrome();
  } else refreshMain();
}

function onStore(e) {
  if (!J.touchesJournal(e) || J.isSelfWrite() || e.type === 'saved' || e.type === 'load') return;
  const paths = Array.isArray(e.paths) ? e.paths : e.path ? [e.path] : [];
  if (!visible) { stale = true; return; }
  paths.forEach((p) => changed.add(p));
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const list = [...changed];
    changed.clear();
    if (!visible) { stale = true; return; }
    refreshAll(list.length ? list : null);
  }, 80);
}

// ---------- chrome: breadcrumb, mode buttons, title ----------

function renderChrome(draft = null) {
  if (!root) return;
  const t = target || { kind: 'home' };
  const items = [];
  const here = (text) => h('span', { class: 'jr-crumb', 'aria-current': 'page' }, text);
  const link = (to, text) => h('a', { class: 'jr-crumb', href: to }, text);
  items.push(t.kind === 'home' ? here(J.VAULT_TITLE)
    : h('a', { class: 'jr-crumb jr-crumb-home', href: '#/journal', title: 'Journal home', 'aria-label': 'Journal home' }, icon('journal')));
  let title = J.VAULT_TITLE;
  if (t.kind === 'note') {
    const n = currentNote() || t.note;
    J.trail(J.folderOf(n)).forEach((f) => items.push(link(f.href, f.title)));
    title = draft || noteView?.title || n.title;
    items.push(here(title));
  } else if (t.kind === 'folder') {
    const f = J.folderAt(t.folder.path) || t.folder;
    if (f.isRoot) items.push(here('Vault root'));
    const tr = J.trail(f);
    tr.forEach((x, i) => items.push(i === tr.length - 1 ? here(x.title) : link(x.href, x.title)));
    title = f.isRoot ? 'Vault root' : f.title;
  } else if (t.kind === 'missing') {
    if (t.folder) J.trail(t.folder).forEach((f) => items.push(link(f.href, f.title)));
    items.push(here('Missing page'));
    title = 'Missing page';
  }
  crumbs.replaceChildren(...items.flatMap((x, i) => (i ? [h('span', { class: 'jr-crumb-sep', 'aria-hidden': 'true' }, '/'), x] : [x])));
  const isNote = t.kind === 'note' && !!noteView;
  btns.modes.hidden = !isNote;
  if (isNote) {
    btns.read.setAttribute('aria-pressed', String(!noteView.editing));
    btns.edit.setAttribute('aria-pressed', String(noteView.editing));
  }
  btns.more.hidden = !(isNote || (t.kind === 'folder' && !t.folder.isRoot));
  root.dataset.editing = isNote && noteView.editing ? 'true' : 'false';
  if (visible) document.title = `${title === J.VAULT_TITLE ? '' : `${title} · `}Journal · The Stone Wardens`;
}

// ---------- creating ----------

function newNote({ folder = targetFolder(), title = null } = {}) {
  const f = typeof folder === 'string' ? J.folderAt(folder) || J.index().root : folder || J.index().root;
  const t = title || J.freshTitle(f);
  const path = J.createNote({ title: t, folder: f });
  S.reveal(f.path);
  pending = { path, edit: true, focusTitle: !title };
  navigate(J.hrefForPath(path));
}

function newFolder({ parent = targetFolder() } = {}) {
  const p = typeof parent === 'string' ? J.folderAt(parent) || J.index().root : parent || J.index().root;
  const path = J.createFolder({ title: J.freshTitle(p, 'New folder'), parent: p });
  S.reveal(p.path);
  showLeft('files');
  files.render();
  files.startRename('folder', path);
}

function openNewFromRoute(r) {
  if (newOpen) return;
  newOpen = true;
  const back = lastHash && !/^#\/journal\/new(?:[/?]|$)/.test(lastHash) ? lastHash : '#/journal';
  newNoteDialog({ title: r.query.title || '', folder: targetFolder().path }).then((res) => {
    if (!res) { navigate(back, { replace: true }); return; }
    const path = J.createNote({ title: res.title, folder: res.folder });
    S.reveal(J.folderAt(res.folder)?.path || '');
    pending = { path, edit: true };
    navigate(J.hrefForPath(path), { replace: true });
  }).finally(() => { newOpen = false; });
}

function switcher() {
  openSwitcher({ onCreate: (title) => newNote({ title }) });
}

// ---------- renaming, moving, deleting ----------

const editingExclude = () => (noteView?.editing ? [noteView.path] : []);

async function offerLinkUpdate(plan, oldName, newName) {
  if (!plan.count) return;
  const ok = await confirmDialog(
    `${plural(plan.count, 'link')} in ${plural(plan.notes.length, 'other note')} still point${plan.count === 1 ? 's' : ''} to “${oldName}”. Update ${plan.count === 1 ? 'it' : 'them'} to “${newName}”?`,
    { title: 'Update links?', okLabel: 'Update links', cancelLabel: 'Leave them' },
  );
  if (ok) { toast(`Updated ${plural(plan.apply(), 'link')}.`, { type: 'success' }); refreshAll(); }
}

async function renameNote(note, title) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  const fresh = J.noteByPath(note.path) || note;
  if (!title || title === fresh.title) { if (noteView?.path === note.path) noteView.renamed(note.path, fresh.title); renderChrome(); return note.path; }
  const nv = noteView && !noteView.destroyed && noteView.path === note.path ? noteView : null;
  nv?.writeNow();
  const oldIx = J.index();
  const oldTitle = fresh.title;
  const path = J.renameNote(J.noteByPath(note.path) || fresh, title, nv ? nv.body : fresh.body);
  if (path !== note.path) S.renamed(new Map([[note.path, path]]));
  if (nv) {
    nv.renamed(path, title);
    if (path !== note.path) navigate(J.hrefForPath(path), { replace: true });
  }
  refreshAll();
  await offerLinkUpdate(J.noteLinkPlan(oldIx, note.path, title, { exclude: [path, ...editingExclude()], newPath: path }), oldTitle, title);
  return path;
}

/** After notes moved (Map old -> new path) and/or folders moved ([[old, new]]): fix state, links, the open page. */
function afterMove(oldIx, moved, folderMoves = []) {
  S.renamed(moved, folderMoves);
  const plan = J.pathLinkPlan(oldIx, moved, { exclude: editingExclude() });
  const fixed = plan.count ? plan.apply() : 0;
  if (noteView && moved.has(noteView.path)) {
    noteView.renamed(moved.get(noteView.path));
    navigate(J.hrefForPath(noteView.path), { replace: true });
  } else if (target?.kind === 'folder' && !target.folder.isRoot) {
    for (const [from, to] of folderMoves) {
      const p = target.folder.path;
      if (J.isUnder(p, from)) { navigate(J.folderHref(to + p.slice(from.length)), { replace: true }); break; }
    }
  }
  refreshAll();
  return fixed;
}

async function renameFolder(f, title) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  if (!title || f.isRoot || title === f.title) { refreshAll(); return; }
  const oldIx = J.index();
  const oldTitle = f.title;
  noteView?.writeNow();
  const { path, moved } = J.renameFolder(f, title);
  afterMove(oldIx, moved, path !== f.path ? [[f.path, path]] : []);
  await offerLinkUpdate(J.folderLinkPlan(oldIx, f.path, title, { exclude: editingExclude() }), oldTitle, title);
}

function moveNote(note, dest) {
  noteView?.writeNow();
  const fresh = J.noteByPath(note.path) || note;
  const oldIx = J.index();
  const path = J.moveNote(fresh, dest);
  if (path === note.path) return;
  S.reveal(dest.path);
  afterMove(oldIx, new Map([[note.path, path]]));
  toast(`Moved “${fresh.title}” to ${J.folderLabel(dest)}.`, { type: 'success' });
  saveSoon(`journal: move “${fresh.title}” to ${J.folderLabel(dest)}`);
}

function moveFolder(f, dest) {
  noteView?.writeNow();
  const oldIx = J.index();
  const res = J.moveFolder(f, dest);
  if (!res) return;
  S.reveal(dest.path);
  afterMove(oldIx, res.moved, [[f.path, res.path]]);
  toast(`Moved “${f.title}” to ${J.folderLabel(dest)}.`, { type: 'success' });
  saveSoon(`journal: move folder “${f.title}” to ${J.folderLabel(dest)}`);
}

function moveItem(d, dest) {
  const ix = J.index();
  if (d.type === 'note') { const n = J.noteByPath(d.path, ix); if (n && dest) moveNote(n, dest); }
  else { const f = J.folderAt(d.path, ix); if (f && dest) moveFolder(f, dest); }
}

async function moveDialog(d) {
  const ix = J.index();
  if (d.type === 'note') {
    const n = J.noteByPath(d.path, ix);
    if (!n) return;
    const dest = await pickFolder({ title: `Move “${n.title}” to…`, allow: (f) => f.path.toLowerCase() !== n.folder.toLowerCase() });
    if (dest) moveNote(J.noteByPath(d.path) || n, J.folderAt(dest.path) || dest);
  } else {
    const f = J.folderAt(d.path, ix);
    if (!f) return;
    const dest = await pickFolder({ title: `Move “${f.title}” to…`, allow: (x) => J.canMoveFolder(f, x) });
    const cur = J.folderAt(d.path);
    if (dest && cur) moveFolder(cur, J.folderAt(dest.path) || dest);
  }
}

async function deleteItem(d) {
  const ix = J.index();
  if (d.type === 'note') {
    const n = J.noteByPath(d.path, ix);
    if (!n) return;
    const refs = J.backlinks(n).length;
    const ok = await confirmDialog(
      `Delete “${n.title}”? It is removed for the whole party${majorSaveOn() ? '' : ' when you save'}.${refs ? ` ${plural(refs, 'other note')} link${refs === 1 ? 's' : ''} here; those links will offer to recreate it.` : ''}`,
      { title: 'Delete note', okLabel: 'Delete note', danger: true },
    );
    if (!ok) return;
    const open = noteView && noteView.path === n.path;
    if (open) { noteView.saver.cancel(); noteView.dirty = false; noteView.deleted = true; }
    const f = J.folderOf(n);
    J.deleteNote(J.noteByPath(n.path) || n);
    S.forget(n.path);
    toast(`Deleted “${n.title}”.`);
    saveSoon(`journal: delete “${n.title}”`);
    if (open) navigate(f.isRoot ? '#/journal' : (J.folderAt(f.path)?.href || '#/journal'), { replace: true });
    else refreshAll();
    return;
  }
  const f = J.folderAt(d.path, ix);
  if (!f || f.isRoot) return;
  const mode = await confirmDeleteFolder(f);
  const cur = J.folderAt(d.path);
  if (!mode || !cur) return;
  noteView?.writeNow();
  const oldIx = J.index();
  const openPath = noteView?.path;
  const inside = (p) => J.isUnder(p, `${J.ROOT}/${cur.path}`);
  if (mode === 'delete' && openPath && inside(openPath)) { noteView.saver.cancel(); noteView.dirty = false; noteView.deleted = true; }
  const parent = cur.parent;
  const count = cur.count;
  const moved = J.deleteFolder(cur, mode);
  toast(mode === 'keep' ? `Deleted “${cur.title}”; ${plural(count, 'note')} moved to ${J.folderLabel(parent)}.` : `Deleted “${cur.title}” and ${plural(count, 'note')}.`);
  saveSoon(`journal: delete folder “${cur.title}”${mode === 'keep' ? '' : ` and ${plural(count, 'note')}`}`);
  const showsIt = target?.kind === 'folder' && J.isUnder(target.folder.path, cur.path);
  if ((mode === 'delete' && openPath && inside(openPath)) || showsIt) {
    S.renamed(moved);
    navigate(J.folderAt(parent.path)?.href || '#/journal', { replace: true });
    return;
  }
  afterMove(oldIx, moved);
}

// ---------- menus ----------

function itemMenu(d, pos = {}) {
  const ix = J.index();
  const fromTree = pos.from === 'tree';
  const rename = () => {
    if (fromTree) { files.startRename(d.type, d.path); return; }
    if (d.type === 'note' && noteView?.path === d.path) { noteView.focusTitle(); return; }
    showLeft('files');
    files.render();
    files.startRename(d.type, d.path);
  };
  let items;
  if (d.type === 'note') {
    const n = J.noteByPath(d.path, ix);
    if (!n) return;
    const open = noteView?.path === n.path;
    items = [
      !open ? { label: 'Open', icon: 'file', onClick: () => navigate(n.href) } : null,
      { label: open && noteView.editing ? 'Reading view' : 'Open in editing view', icon: open && noteView.editing ? 'book-open' : 'edit', hint: open ? 'Ctrl+E' : null, onClick: () => {
        if (open) noteView.setEditing(!noteView.editing);
        else { pending = { path: n.path, edit: true }; navigate(n.href); }
      } },
      { sep: true },
      { label: 'Rename', icon: 'edit', hint: 'F2', onClick: rename },
      { label: 'Move to…', icon: 'folder', onClick: () => moveDialog(d) },
      { label: 'Edit properties', icon: 'tag', onClick: () => editProperties(n) },
      open ? { label: 'Upload reference photos…', icon: 'image', onClick: () => noteView.addImages('upload') } : null,
      open ? { label: 'Add images from site files…', icon: 'upload', onClick: () => noteView.addImages('repo') } : null,
      { label: 'Copy link', icon: 'copy', onClick: () => copyLink(n) },
      !fromTree ? { label: 'Show in files', icon: 'sidebar-left', onClick: () => { showLeft('files'); files.setActive({ note: n }); files.rowFor('note', n.path)?.focus(); } } : null,
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteItem(d) },
    ];
  } else {
    const f = J.folderAt(d.path, ix);
    if (!f) return;
    items = [
      { label: 'New note here', icon: 'file-plus', onClick: () => newNote({ folder: f }) },
      { label: 'New folder here', icon: 'folder-plus', onClick: () => newFolder({ parent: f }) },
      target?.kind === 'folder' && target.folder.path === f.path ? null : { label: 'Open folder page', icon: 'book-open', onClick: () => navigate(f.href) },
      { sep: true },
      { label: 'Rename', icon: 'edit', hint: 'F2', onClick: rename },
      { label: 'Move to…', icon: 'folder', onClick: () => moveDialog(d) },
      { label: f.description ? 'Edit description' : 'Add a description', icon: 'edit', onClick: () => editDescription(f) },
      { sep: true },
      { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => deleteItem(d) },
    ];
  }
  openMenu({ ...pos, items, label: d.type === 'note' ? 'Note actions' : 'Folder actions' });
}

function moreMenu() {
  if (target?.kind === 'note' && noteView) itemMenu({ type: 'note', path: noteView.path }, { anchor: btns.more, align: 'end' });
  else if (target?.kind === 'folder' && !target.folder.isRoot) itemMenu({ type: 'folder', path: target.folder.path }, { anchor: btns.more, align: 'end' });
}

async function copyLink(n) {
  const text = `[[${n.title}]]`;
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text}. Paste it into any note to link here.`, { type: 'success' });
  } catch {
    toast(`Link: ${text}`, { timeout: 8000 });
  }
}

async function editProperties(note) {
  const n = J.noteByPath(note.path) || note;
  const nv = noteView?.path === n.path ? noteView : null;
  nv?.writeNow();
  const fm = await propertiesDialog(J.noteByPath(n.path) || n);
  const cur = J.noteByPath(n.path);
  if (!fm || !cur) return;
  const text = J.setProperties(cur, fm);
  if (nv && !nv.destroyed && nv.path === cur.path) { nv.fm = { ...J.noteByPath(cur.path).fm }; nv.lastText = text; if (!nv.editing) nv.load(J.noteByPath(cur.path)); }
  toast('Properties saved.', { type: 'success' });
  refreshAll();
}

async function editDescription(f) {
  const d = await descriptionDialog(f);
  const cur = J.folderAt(f.path);
  if (d == null || !cur) return;
  J.updateFolder(cur, { description: d || undefined });
  refreshAll();
}

function openFound(note, find) {
  if (noteView && !noteView.destroyed && noteView.path === note.path) {
    if (size !== 'wide') closeDrawers();
    if (noteView.editing && find.line) noteView.caretToLine(find.line.line);
    else noteView.find(find);
    return;
  }
  pending = { path: note.path, find };
  navigate(note.href);
}

// ---------- keyboard ----------

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const modalOpen = () => !!document.querySelector('.modal-backdrop');

function onKey(e) {
  if (!visible || !root?.isConnected || root.closest('[hidden]')) return;
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  const k = e.key.toLowerCase();
  if (mod && !e.shiftKey && (k === 'k' || k === 'o')) {
    e.preventDefault();
    if (!modalOpen()) switcher();
    return;
  }
  if (modalOpen()) return;
  if (mod && !e.shiftKey && k === 'e' && noteView) { e.preventDefault(); noteView.setEditing(!noteView.editing); return; }
  if (mod && e.shiftKey && k === 'f') { e.preventDefault(); showLeft('search'); search.focus(); return; }
  if (e.key === 'F2' && noteView && !isTyping(e.target) && !left.contains(e.target)) { e.preventDefault(); noteView.focusTitle(); return; }
  if (e.key === 'Escape' && drawer && !isTyping(e.target)) { e.preventDefault(); closeDrawers(); }
}

export default {
  id: 'journal',
  title: 'Journal',
  icon: 'journal',
  mount,
  show,
  hide,
};
