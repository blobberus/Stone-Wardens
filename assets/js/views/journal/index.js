// Journal: the party's notes as an open book, written in Obsidian-flavoured markdown.
// Routes:
//   #/journal                    contents spread (title page + table of contents | quick links, recent, tags)
//   #/journal?q=…  ?tag=…        search / tag results
//   #/journal/new?title=…        "New note" dialog (unresolved [[links]] point here)
//   #/journal/<chapter>          chapter title page ("_" = Loose Leaves)
//   #/journal/<chapter>/<note>   note spread; ?h=<heading-slug> scrolls to a heading
// Keys: Ctrl+K / Ctrl+O quick switcher, Ctrl+E edit/read, ←/→ turn pages while reading.
import { h } from '../../core/dom.js';
import { icon, toast } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate, href, onRoute } from '../../core/router.js';
import { debounce } from '../../core/util.js';
import * as J from './data.js';
import { pageShell, chapterName } from './parts.js';
import { renderContents, renderChapter, renderResults, renderMissing, state as pageState } from './pages.js';
import { NoteView } from './note.js';
import { newNoteDialog, chapterDialog, openSwitcher } from './dialogs.js';

let root = null;
let crumbs = null;
let searchInput = null;
let stage = null;
let book = null;
let spreadEl = null;
let ribbons = null;
let pages = null;
let route = null; // the journal route currently on screen
let routeKey = '';
let noteView = null;
let visible = false;
let stale = false;
let lastHash = null; // previous route anywhere in the app (where "cancel" on #/journal/new returns to)
let lastChapter = null; // chapter of the last chapter/note page shown (default for new notes)
let pendingEdit = null; // path of a just-created note to open in edit mode
let newOpen = false;
let refreshTimer = null;
const changed = new Set();

const ctx = {
  refresh: () => refresh(),
  go: (to, opts) => navigate(to, opts),
  replaceRoute: (to) => navigate(to, { replace: true }),
  newNote: (opts) => newNote(opts),
  newChapter: () => newChapter(),
  chrome: () => renderChrome(),
};

// ---------- layout ----------

function mount(el) {
  searchInput = h('input', {
    class: 'input', type: 'search', placeholder: 'Search the chronicle…', 'aria-label': 'Search notes', autocomplete: 'off',
    oninput: () => searchSoon(),
    onkeydown: onSearchKey,
  });
  crumbs = h('nav', { class: 'jr-crumbs', 'aria-label': 'Breadcrumb' });
  const bar = h('header', { class: 'jr-bar' },
    crumbs,
    h('div', { class: 'jr-bar-tools' },
      h('label', { class: 'search jr-search' }, icon('search'), searchInput),
      h('button', { class: 'btn btn-ghost jr-switch-btn', type: 'button', title: 'Quick switcher (Ctrl+K or Ctrl+O)', onclick: () => switcher() },
        icon('compass'), h('span', { class: 'jr-bar-label' }, 'Jump to'), h('kbd', { class: 'jr-kbd' }, 'Ctrl K')),
      h('button', { class: 'btn jr-newchapter-btn', type: 'button', title: 'Start a new chapter', onclick: () => newChapter() },
        icon('book-open'), h('span', { class: 'jr-bar-label' }, 'New chapter')),
      h('button', { class: 'btn btn-primary', type: 'button', title: 'Write a new note', onclick: () => newNote() },
        icon('plus'), h('span', null, 'New note'))));
  ribbons = h('nav', { class: 'jr-ribbons', 'aria-label': 'Chapters' });
  spreadEl = h('div', { class: 'jr-spread' });
  book = h('div', { class: 'jr-book' }, spreadEl, ribbons);
  stage = h('div', { class: 'jr-stage' }, book);
  root = h('div', { class: 'jr-root' }, bar, stage);
  el.append(root);

  store.on(onStore);
  onRoute((r) => { lastHash = `#/${r.hash}`; });
  document.addEventListener('keydown', onKey);
  const flush = () => noteView?.writeNow();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

function freshSpread() {
  const verso = pageShell('verso', 'Left page');
  const recto = pageShell('recto', 'Right page');
  spreadEl.replaceChildren(verso.el, recto.el);
  return { verso, recto };
}

// ---------- routing ----------

const routeKeyOf = (r) => `${r.parts.join('/')}?${r.query.q || ''}#${r.query.tag || ''}`;

function show(r) {
  visible = true;
  const wasStale = stale;
  stale = false;
  const [a, b] = r.parts;
  if (a === 'new' && !b) {
    // Keep whatever page is open behind the dialog (or the contents on a cold start).
    if (!pages || wasStale) renderRoute(route || { parts: [], query: {}, hash: 'journal' });
    openNewFromRoute(r);
    return;
  }
  route = r;
  syncSearch(r);
  if (noteView && b) {
    const note = J.noteAt(a, b);
    if (note && note.path === noteView.path) {
      if (wasStale) noteView.external(null);
      noteView.update(r);
      renderChrome();
      return;
    }
  }
  renderRoute(r);
}

function hide() {
  visible = false;
  noteView?.writeNow();
}

function renderRoute(r) {
  noteView?.destroy();
  noteView = null;
  const [a, b] = r.parts;
  const key = routeKeyOf(r);
  if (key !== routeKey) pageState.arrange = false;
  routeKey = key;
  route = r;
  pages = freshSpread();
  let mode = 'contents';
  if (b) {
    const note = J.noteAt(a, b);
    if (note) {
      mode = 'note';
      lastChapter = note.chapter;
      const edit = pendingEdit === note.path;
      pendingEdit = null;
      noteView = new NoteView(pages, note, ctx, { edit, anchor: r.query.h || null });
    } else {
      mode = 'missing';
      renderMissing(pages, { chapter: a, slug: b }, ctx);
    }
  } else if (a) {
    const ch = J.chapterAt(a);
    if (ch) { mode = 'chapter'; lastChapter = ch.slug; renderChapter(pages, ch, ctx); }
    else { mode = 'missing'; renderMissing(pages, { chapter: a }, ctx); }
  } else if (r.query.q || r.query.tag) {
    mode = 'results';
    lastChapter = null;
    renderResults(pages, { q: r.query.q || '', tag: r.query.tag || '' }, ctx);
  } else {
    lastChapter = null;
    renderContents(pages, ctx);
  }
  book.dataset.mode = mode;
  renderChrome();
}

/** Re-render the current page in place (after our own edits, or outside changes), keeping scroll. */
function refresh() {
  if (!visible || !route) { stale = true; return; }
  if (noteView) { noteView.external(null); renderChrome(); return; }
  const keep = [pages?.verso.body.scrollTop || 0, pages?.recto.body.scrollTop || 0, stage.scrollTop];
  renderRoute(route);
  pages.verso.body.scrollTop = keep[0];
  pages.recto.body.scrollTop = keep[1];
  stage.scrollTop = keep[2];
}

const OTHER_RE = /^content\/(characters|locations)\//;

function onStore(e) {
  const paths = Array.isArray(e.paths) ? e.paths : e.path ? [e.path] : [];
  const journal = J.touchesJournal(e);
  const other = !journal && paths.some((p) => OTHER_RE.test(p));
  if (!journal && !other) return;
  if (J.isSelfWrite() || e.type === 'saved' || e.type === 'load') return;
  if (!visible) { stale = true; return; }
  if (other && book.dataset.mode !== 'contents') return; // characters/places only appear on the contents page
  paths.forEach((p) => changed.add(p));
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const list = [...changed];
    changed.clear();
    if (!visible) { stale = true; return; }
    if (noteView) { noteView.external(list.length ? list : null); renderChrome(); return; }
    refresh();
  }, 80);
}

// ---------- chrome: ribbons, breadcrumb, title ----------

function renderChrome() {
  if (!root) return;
  renderRibbons();
  renderCrumbs();
}

function renderRibbons() {
  const ix = J.index();
  const r = route || { parts: [], query: {} };
  const [a] = r.parts;
  const active = a && a !== 'new' ? a : (!a && !r.query.q && !r.query.tag ? '#contents' : null);
  const rib = (to, mark, label, on, cls) => h('a', {
    class: ['jr-ribbon', on && 'is-active', cls], href: to, 'aria-current': on ? 'page' : null, title: label,
  }, h('span', { class: 'jr-ribbon-mark' }, mark), h('span', { class: 'jr-ribbon-label' }, label));
  ribbons.replaceChildren(...[
    rib('#/journal', icon('book-open'), 'Contents', active === '#contents', 'jr-ribbon-contents'),
    ...ix.chapters.map((c) => rib(c.href, c.roman, `${c.label}: ${c.title}`, active === c.slug)),
    ix.loose.notes.length ? rib(ix.loose.href, icon('file'), 'Loose Leaves', active === J.LOOSE, 'jr-ribbon-loose') : null,
    h('button', { class: 'jr-ribbon jr-ribbon-add', type: 'button', title: 'New chapter', 'aria-label': 'New chapter', onclick: () => newChapter() },
      h('span', { class: 'jr-ribbon-mark' }, icon('plus')), h('span', { class: 'jr-ribbon-label' }, 'New chapter')),
  ].filter(Boolean));
}

function renderCrumbs() {
  const r = route || { parts: [], query: {} };
  const [a, b] = r.parts;
  const items = [];
  const here = (text) => h('span', { class: 'jr-crumb', 'aria-current': 'page' }, text);
  const atRoot = !a && !r.query.q && !r.query.tag;
  items.push(atRoot ? here(J.BOOK_TITLE) : h('a', { class: 'jr-crumb', href: '#/journal' }, J.BOOK_TITLE));
  let title = 'Journal';
  if (a === 'new') items.push(here('New note'));
  else if (a) {
    const ch = J.chapterAt(a);
    const name = ch ? chapterName(ch) : a;
    items.push(b ? h('a', { class: 'jr-crumb', href: ch ? ch.href : href('journal', a) }, name) : here(name));
    title = ch ? ch.title : title;
    if (b) {
      const n = noteView ? noteView.current : J.noteAt(a, b);
      const t = noteView && n && n.path === noteView.path ? noteView.title : n?.title || J.titleFromSlug(b);
      items.push(here(t));
      title = t;
    }
  } else if (r.query.q) { items.push(here(`Search: “${r.query.q}”`)); title = `Search: ${r.query.q}`; }
  else if (r.query.tag) { items.push(here(`#${r.query.tag}`)); title = `#${r.query.tag}`; }
  crumbs.replaceChildren(...items.flatMap((x, i) => (i ? [h('span', { class: 'jr-crumb-sep', 'aria-hidden': 'true' }, '›'), x] : [x])));
  if (visible) document.title = `${title === 'Journal' ? '' : `${title} · `}Journal · The Stone Wardens`;
}

// ---------- search ----------

const searchSoon = debounce(() => runSearch(), 250);

function onSearchKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); searchSoon.cancel(); runSearch(); }
  else if (e.key === 'Escape') {
    e.preventDefault();
    searchSoon.cancel();
    searchInput.value = '';
    if (route && !route.parts.length && route.query.q) navigate('#/journal', { replace: true });
    searchInput.blur();
  }
}

function runSearch() {
  const q = searchInput.value.trim();
  const onSearch = !!route && !route.parts.length && !!route.query.q;
  if (!q) { if (onSearch) navigate('#/journal', { replace: true }); return; }
  if (onSearch && route.query.q === q) return;
  navigate(`#/journal?q=${encodeURIComponent(q)}`, { replace: onSearch });
}

function syncSearch(r) {
  if (document.activeElement === searchInput) return;
  searchInput.value = !r.parts.length && r.query.q ? r.query.q : '';
}

// ---------- creating ----------

function defaultChapter() {
  if (lastChapter && J.chapterAt(lastChapter)) return lastChapter;
  const ix = J.index();
  return ix.chapters.length ? ix.chapters[ix.chapters.length - 1].slug : J.LOOSE;
}

async function newNote({ title = '', chapter = null, replace = false, cancelTo = null } = {}) {
  const res = await newNoteDialog({ title, chapter: chapter ?? defaultChapter() });
  if (!res) {
    if (cancelTo) navigate(cancelTo, { replace: true });
    return;
  }
  let ch = res.chapter;
  if (res.newChapter) ch = J.createChapter({ title: res.newChapter });
  const path = J.createNote({ title: res.title, chapter: ch });
  pendingEdit = path;
  navigate(J.hrefForPath(path), { replace });
}

function openNewFromRoute(r) {
  if (newOpen) return;
  newOpen = true;
  const back = lastHash && !/^#\/journal\/new(?:[/?]|$)/.test(lastHash) ? lastHash : '#/journal';
  newNote({ title: r.query.title || '', replace: true, cancelTo: back }).finally(() => { newOpen = false; });
}

async function newChapter() {
  const res = await chapterDialog();
  if (!res) return;
  const slug = J.createChapter(res);
  const ch = J.chapterAt(slug);
  toast(`${ch ? ch.label : 'A new chapter'} begins: ${res.title}.`, { type: 'success' });
  navigate(href('journal', slug));
}

function switcher() {
  openSwitcher({ onCreate: (title) => newNote({ title }) });
}

// ---------- keyboard ----------

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const modalOpen = () => !!document.querySelector('.modal-backdrop');

function onKey(e) {
  if (!visible || !root?.isConnected || root.closest('[hidden]')) return;
  const mod = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
  const k = e.key.toLowerCase();
  if (mod && (k === 'k' || k === 'o')) {
    e.preventDefault();
    if (!modalOpen()) switcher();
    return;
  }
  if (modalOpen()) return;
  if (mod && k === 'e' && noteView) {
    e.preventDefault();
    noteView.setEditing(!noteView.editing);
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    && noteView && !noteView.editing && !isTyping(e.target)) {
    const { prev, next } = J.prevNext(noteView.current);
    const to = e.key === 'ArrowLeft' ? prev : next;
    if (to) { e.preventDefault(); navigate(to.href); }
  }
}

export default {
  id: 'journal',
  title: 'Journal',
  icon: 'journal',
  mount,
  show,
  hide,
};
