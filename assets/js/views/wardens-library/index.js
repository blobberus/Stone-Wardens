// Warden's Library: campaign documents from wardens-library/ (PDF, Word, Markdown, text, images) on shelves,
// with an in-browser reader. #/wardens-library = shelves, #/wardens-library/<path segments> = reader.
import { h, clear } from '../../core/dom.js';
import { icon, toast, confirmDialog, select } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate, href } from '../../core/router.js';
import { registerLinkType, matchNames } from '../../core/links.js';
import { renderInto, parseFrontmatter } from '../../core/markdown.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { nameKey, baseName } from '../../core/util.js';
import {
  VIEW, ROOT, README, TYPES, listDocs, readmeFile, docAt, docHref, shelfLabel, prettify, findDoc, linkTarget,
  shelfSiblings, fmtSize, LARGE_BYTES,
} from './files.js';
import { renderDocument, canInlinePdf, opensInBrowser, errorText, pdfPage, scrollToAnchor } from './reader.js';
import { openUploadDialog } from './upload.js';

const TITLE = "Warden's Library"; // view/tab title (contract)
const DISPLAY = 'Warden’s Library'; // typographic form for headings

const SORTS = {
  name: { label: 'Name', fn: (a, b) => cmp(a.name, b.name) || cmp(a.file, b.file) },
  type: { label: 'Type', fn: (a, b) => a.type.order - b.type.order || cmp(a.name, b.name) },
  size: { label: 'Size', fn: (a, b) => b.size - a.size || cmp(a.name, b.name) },
};
const cmp = (x, y) => String(x ?? '').localeCompare(String(y ?? ''), undefined, { sensitivity: 'base', numeric: true });

const state = {
  q: '',
  type: 'all',
  sort: SORTS[getSetting('wlSort')] ? getSetting('wlSort') : 'name',
  layout: getSetting('wlLayout') === 'list' ? 'list' : 'cards',
};

let root = null;
let shelfEl = null;
let readerEl = null;
const els = {};
let mode = 'shelf';
let reader = null; // {path, qkey, query, seq, url, failed}
let seq = 0;
let savedScroll = null;
let introKey = null;
let thumbs = null;

// ---------- small helpers ----------

const stagedBadge = () => h('span', {
  class: 'badge badge-warn wl-staged',
  title: 'Added on this device. Press Save to commit it to the repository.',
}, 'Unsaved');

const typeBadge = (type) => h('span', { class: 'badge wl-type' }, icon(type.icon), type.label);

function shelfCrumbs(shelf) {
  if (!shelf) return h('span', { class: 'wl-crumb' }, 'General');
  const parts = shelf.split('/');
  return parts.map((p, i) => [
    i ? h('span', { class: 'wl-crumb-sep', 'aria-hidden': 'true' }, '›') : null,
    h('span', { class: ['wl-crumb', i < parts.length - 1 && 'is-parent'] }, prettify(p)),
  ]);
}

/** The element that scrolls this view (the shell's .view section). */
const scrollParent = () => root?.closest('.view') || document.scrollingElement || document.documentElement;

const isVisible = () => !!root && root.isConnected && !root.closest('[hidden]');

const setTitle = (doc) => { document.title = `${doc.name} · ${TITLE} · The Stone Wardens`; };

async function downloadDoc(doc) {
  const close = doc.size > 2 * 1024 * 1024 ? toast(`Preparing ${doc.file}…`, { timeout: 0 }) : null;
  try {
    const url = await store.fileUrl(doc.path);
    if (!url) throw Object.assign(new Error('missing'), { code: 'missing' });
    const a = h('a', { href: url, download: doc.file, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) {
    console.error('[wardens-library] download failed', e);
    toast(`Could not download ${doc.file}: ${errorText(e)}`, { type: 'error' });
  } finally { close?.(); }
}

async function removeDoc(doc) {
  const inRepo = store.remote?.has?.(doc.path);
  const ok = await confirmDialog(
    inRepo
      ? `Remove “${doc.name}” (${doc.file}) from the library? It is deleted from the repository when you press Save.`
      : `Discard “${doc.name}”? It was added on this device and never saved, so it will simply be dropped.`,
    { title: 'Remove document?', okLabel: inRepo ? 'Remove' : 'Discard', danger: true },
  );
  if (!ok) return;
  if (mode === 'reader' && reader?.path === doc.path) navigate(href(VIEW));
  store.remove(doc.path);
  toast(inRepo ? `Removed “${doc.name}”. Press Save to delete it from the repository.` : `Discarded “${doc.name}”.`);
}

function openUpload(opts = {}) {
  const shelf = opts.shelf ?? (mode === 'reader' && reader ? (docAt(reader.path)?.shelf || '') : '');
  openUploadDialog({
    files: opts.files || [],
    shelf,
    onDone: (paths) => {
      if (paths.length === 1) navigate(docHref(paths[0]));
      else if (mode !== 'shelf') navigate(href(VIEW));
    },
  });
}

// ---------- shelf view ----------

function buildShelf() {
  els.search = h('input', {
    class: 'input wl-search-input', type: 'search', placeholder: 'Search the library…', 'aria-label': 'Search documents',
    value: state.q,
    oninput: (e) => { state.q = e.target.value; renderResults(); },
    onkeydown: (e) => { if (e.key === 'Escape' && state.q) { e.stopPropagation(); clearFilters(); } },
  });
  els.count = h('p', { class: 'view-sub wl-count' });
  els.intro = h('div', { class: 'wl-intro', hidden: true });
  els.chips = h('div', { class: 'wl-chips', role: 'group', 'aria-label': 'Filter by type' });
  els.sort = select(Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label })), state.sort, (v) => {
    state.sort = v;
    setSetting('wlSort', v);
    renderResults();
  }, { class: 'select wl-sort-select', 'aria-label': 'Sort documents' });
  els.layout = h('div', { class: 'wl-layout', role: 'group', 'aria-label': 'Layout' },
    ['cards', 'list'].map((v) => h('button', {
      class: 'btn btn-sm wl-layout-btn', type: 'button', 'data-layout': v,
      onclick: () => { state.layout = v; setSetting('wlLayout', v); renderResults(); },
    }, v === 'cards' ? 'Shelves' : 'Table')));
  els.toolbar = h('div', { class: 'toolbar wl-toolbar' },
    h('label', { class: 'search wl-search' }, icon('search'), els.search),
    els.chips,
    h('div', { class: 'wl-toolbar-end' },
      h('label', { class: 'wl-sort' }, h('span', { class: 'wl-sort-label' }, 'Sort'), els.sort),
      els.layout));
  els.status = h('p', { class: 'wl-showing', 'aria-live': 'polite' });
  els.results = h('div', { class: 'wl-results' });

  shelfEl.append(
    h('header', { class: 'view-head wl-head' },
      h('h1', { class: 'view-title wl-title' }, DISPLAY),
      els.actions = h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openUpload({ shelf: '' }) },
          icon('upload'), h('span', null, 'Add documents'))),
      els.count),
    els.intro,
    els.toolbar,
    els.status,
    els.results);
}

function clearFilters() {
  state.q = '';
  state.type = 'all';
  els.search.value = '';
  renderResults();
}

function renderShelf() {
  updateIntro();
  renderResults();
}

/** The owner's README (minus its title) is shown as a short intro once there are documents to introduce. */
let introHasBody = false;
const syncIntro = () => { els.intro.hidden = !introHasBody || !listDocs().length; };

async function updateIntro() {
  const f = readmeFile();
  const key = f ? `${f.sha || 'staged'}:${f.size}` : '';
  if (key === introKey) { syncIntro(); return; }
  introKey = key;
  introHasBody = false;
  syncIntro();
  if (!f) return;
  try {
    const text = await store.text(README);
    if (introKey !== key) return;
    const body = parseFrontmatter(text || '').body.replace(/^\s*#\s[^\n]*\n?/, '').trim();
    introHasBody = !!body;
    if (body) renderInto(els.intro, body);
    syncIntro();
  } catch (e) {
    console.warn('[wardens-library] could not read README', e);
    introKey = null;
  }
}

function matches(doc, terms) {
  if (state.type !== 'all' && doc.type.key !== state.type) return false;
  if (!terms.length) return true;
  const hay = nameKey(`${doc.name} ${doc.file} ${doc.shelf.replace(/[-_/]/g, ' ')} ${doc.type.label}`);
  return terms.every((t) => hay.includes(t));
}

function renderResults() {
  const docs = listDocs();
  const shelves = new Set(docs.map((d) => d.shelf));
  const present = Object.values(TYPES).filter((t) => docs.some((d) => d.type.key === t.key));
  if (state.type !== 'all' && !present.some((t) => t.key === state.type)) state.type = 'all';

  els.count.textContent = docs.length
    ? `${docs.length} document${docs.length === 1 ? '' : 's'}${shelves.size > 1 ? ` on ${shelves.size} shelves` : ''}`
    : 'Campaign documents for the whole party';
  els.toolbar.hidden = !docs.length;
  els.actions.hidden = !docs.length; // when empty, the empty state carries the one primary action

  clear(els.chips);
  els.chips.hidden = present.length < 2;
  const chip = (key, label, n) => h('button', {
    class: ['chip', 'wl-chip', state.type === key && 'is-active'], type: 'button', 'aria-pressed': String(state.type === key),
    onclick: () => { state.type = key; renderResults(); },
  }, label, h('span', { class: 'wl-chip-n' }, String(n)));
  els.chips.append(chip('all', 'All', docs.length), ...present.map((t) => chip(t.key, t.label, docs.filter((d) => d.type.key === t.key).length)));
  els.layout.querySelectorAll('[data-layout]').forEach((b) => {
    const on = b.dataset.layout === state.layout;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  thumbs?.disconnect();
  thumbs = null;
  clear(els.results);
  els.status.textContent = '';
  els.status.hidden = true;
  if (!docs.length) { els.results.append(emptyState()); return; }

  const terms = nameKey(state.q).split(/\s+/).filter(Boolean);
  const shown = docs.filter((d) => matches(d, terms)).sort(SORTS[state.sort].fn);
  if (!shown.length) {
    els.results.append(h('div', { class: 'empty-state wl-empty wl-nomatch' },
      h('p', null, state.q.trim() ? `Nothing on the shelves matches “${state.q.trim()}”.` : 'No documents of this type.'),
      h('button', { class: 'btn', type: 'button', onclick: clearFilters }, 'Show everything')));
    return;
  }
  if (shown.length < docs.length) {
    els.status.textContent = `Showing ${shown.length} of ${docs.length}`;
    els.status.hidden = false;
  }
  if (state.layout === 'list') els.results.append(renderTable(shown));
  else els.results.append(renderShelves(shown, shelves.size > 1 || [...shelves][0] !== ''));
}

function emptyState() {
  return h('div', { class: 'empty-state wl-empty' },
    icon('library'),
    h('h2', null, 'The shelves are bare'),
    h('p', null, 'PDFs, Word documents, notes and images kept in the repository’s ', h('code', null, 'wardens-library/'),
      ' folder are shelved here for the whole party to read.'),
    h('ol', { class: 'wl-empty-steps' },
      h('li', null, h('strong', null, 'On GitHub: '), 'open the ', h('code', null, 'wardens-library'),
        ' folder, choose ', h('em', null, 'Add file → Upload files'), ' and commit. Sub-folders become shelves.'),
      h('li', null, h('strong', null, 'From this site: '), 'press ', h('em', null, 'Add documents'),
        ' (or drop files onto this page), then ', h('em', null, 'Save'), '.')),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openUpload({ shelf: '' }) },
      icon('upload'), h('span', null, 'Add documents')));
}

function renderShelves(docs, withHeadings) {
  const groups = new Map();
  for (const d of docs) {
    if (!groups.has(d.shelf)) groups.set(d.shelf, []);
    groups.get(d.shelf).push(d);
  }
  const order = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : cmp(a, b)));
  return h('div', { class: 'wl-shelves' }, order.map((shelf) => {
    const list = groups.get(shelf);
    return h('section', { class: 'wl-group', 'aria-label': shelfLabel(shelf) },
      withHeadings ? h('h2', { class: 'wl-group-title' },
        icon('folder'),
        h('span', { class: 'wl-group-name' }, shelfCrumbs(shelf)),
        h('span', { class: 'wl-group-count' }, String(list.length))) : null,
      h('div', { class: 'wl-grid' }, list.map(card)));
  }));
}

function card(doc) {
  const cover = h('div', { class: 'wl-card-cover', 'aria-hidden': 'true' },
    h('span', { class: 'wl-card-glyph' }, icon(doc.type.icon)),
    doc.type.key === 'image' && doc.size <= 8 * 1024 * 1024 ? thumb(doc) : null,
    h('span', { class: 'wl-card-ext' }, (doc.ext || 'file').toUpperCase()));
  return h('article', { class: ['wl-card', doc.staged && 'is-staged'], 'data-type': doc.type.key },
    cover,
    h('div', { class: 'wl-card-body' },
      h('a', { class: 'wl-card-link', href: docHref(doc.path), title: doc.file }, doc.name),
      h('div', { class: 'wl-card-meta' },
        h('span', null, doc.type.label),
        h('span', { class: 'wl-dot', 'aria-hidden': 'true' }, '·'),
        h('span', null, fmtSize(doc.size)),
        doc.staged ? stagedBadge() : null)),
    h('button', {
      class: 'btn-icon btn-sm wl-card-del', type: 'button', title: `Remove ${doc.name}`, 'aria-label': `Remove ${doc.name}`,
      onclick: () => removeDoc(doc),
    }, icon('trash')));
}

function thumb(doc) {
  const img = h('img', {
    class: 'wl-thumb', alt: '', decoding: 'async',
    onload: () => img.classList.add('is-loaded'),
    onerror: () => img.remove(),
  });
  img.dataset.path = doc.path;
  if (!('IntersectionObserver' in window)) {
    store.fileUrl(doc.path).then((u) => { if (u) img.src = u; }).catch(() => img.remove());
    return img;
  }
  thumbs ||= new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      obs.unobserve(e.target);
      const el = e.target;
      store.fileUrl(el.dataset.path).then((u) => { if (u) el.src = u; else el.remove(); }).catch(() => el.remove());
    }
  }, { rootMargin: '300px' });
  thumbs.observe(img);
  return img;
}

function renderTable(docs) {
  const iconBtn = (name, label, onclick) => h('button', { class: 'btn-icon btn-sm', type: 'button', title: label, 'aria-label': label, onclick }, icon(name));
  return h('div', { class: 'table-wrap wl-table-wrap' },
    h('table', { class: 'table wl-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Name'),
        h('th', { scope: 'col' }, 'Type'),
        h('th', { scope: 'col', class: 'num' }, 'Size'),
        h('th', { scope: 'col', class: 'wl-shelf-cell' }, 'Shelf'),
        h('th', { scope: 'col', class: 'cell-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', null, docs.map((d) => h('tr', {
        class: ['is-clickable', d.staged && 'is-staged'],
        'data-type': d.type.key,
        // The whole row opens the document; its own links and buttons keep their behaviour.
        onclick: (e) => { if (!e.target.closest('a, button')) navigate(docHref(d.path)); },
      },
        h('td', { class: 'cell-name wl-name-cell' },
          h('a', { class: 'wl-row-link', href: docHref(d.path), title: d.file },
            h('span', { class: 'wl-row-icon' }, icon(d.type.icon)),
            h('span', { class: 'wl-row-name' }, d.name)),
          d.staged ? stagedBadge() : null),
        h('td', null, d.ext === 'doc' ? 'Word (.doc)' : d.type.label),
        h('td', { class: 'num' }, fmtSize(d.size)),
        h('td', { class: 'cell-muted wl-shelf-cell' }, d.shelf ? shelfLabel(d.shelf) : '—'),
        h('td', { class: 'cell-actions' },
          iconBtn('download', `Download ${d.file}`, () => downloadDoc(d)),
          iconBtn('trash', `Remove ${d.name}`, () => removeDoc(d))))))));
}

// ---------- reader ----------

function neighbours(doc) {
  const sibs = shelfSiblings(doc);
  const i = sibs.findIndex((d) => d.path === doc.path);
  if (i < 0) return { prev: null, next: null, index: -1, total: sibs.length };
  return { prev: sibs[i - 1] || null, next: sibs[i + 1] || null, index: i, total: sibs.length };
}

function linkFactory(kind) {
  return (children, cls = '') => {
    const a = h('a', {
      class: ['wl-file-link', cls],
      ...(kind === 'download' ? { download: reader?.file || '' } : { target: '_blank', rel: 'noopener' }),
    }, children);
    if (reader?.url) a.href = reader.url;
    else a.setAttribute('aria-disabled', 'true');
    return a;
  };
}

function renderReaderHead(doc) {
  const { prev, next, index, total } = neighbours(doc);
  const nav = (d, dir) => {
    const glyph = icon(dir === 'prev' ? 'chevron-left' : 'chevron-right');
    const word = dir === 'prev' ? 'Previous' : 'Next';
    return d
      ? h('a', { class: 'btn-icon btn-sm wl-step', href: docHref(d.path), title: `${word}: ${d.name}`, 'aria-label': `${word} document: ${d.name}` }, glyph)
      : h('span', { class: 'btn-icon btn-sm wl-step is-disabled', 'aria-hidden': 'true' }, glyph);
  };
  const download = linkFactory('download')([icon('download'), h('span', null, 'Download')], 'btn btn-sm');
  const open = opensInBrowser(doc) ? linkFactory('open')([icon('external'), h('span', { class: 'wl-btn-label' }, 'Open in new tab')], 'btn btn-sm btn-ghost') : null;
  return h('header', { class: 'wl-reader-head' },
    h('nav', { class: 'wl-crumbs', 'aria-label': 'Breadcrumb' },
      h('a', { class: 'wl-back', href: href(VIEW) }, h('span', { 'aria-hidden': 'true' }, '←'), h('span', null, DISPLAY)),
      doc.shelfParts.map((p) => [h('span', { class: 'wl-crumb-sep', 'aria-hidden': 'true' }, '›'), h('span', { class: 'wl-crumb' }, prettify(p))])),
    h('div', { class: 'wl-reader-bar' },
      h('div', { class: 'wl-reader-titles' },
        h('h1', { class: 'wl-reader-title' }, doc.name),
        h('p', { class: 'wl-reader-meta' },
          typeBadge(doc.type),
          h('span', { class: 'num' }, fmtSize(doc.size)),
          h('span', { class: 'wl-reader-file', title: doc.path }, doc.file),
          doc.staged ? stagedBadge() : null)),
      h('div', { class: 'wl-reader-actions' },
        total > 1 && index >= 0 ? h('div', { class: 'wl-steps', role: 'group', 'aria-label': 'Shelf navigation' },
          nav(prev, 'prev'), h('span', { class: 'wl-step-pos' }, `${index + 1} / ${total}`), nav(next, 'next')) : null,
        download,
        open,
        h('button', { class: 'btn btn-sm btn-ghost wl-del', type: 'button', title: `Remove ${doc.name}`, onclick: () => removeDoc(doc) },
          icon('trash'), h('span', { class: 'wl-btn-label' }, 'Remove')))));
}

function renderReaderFoot(doc) {
  if (doc.type.key === 'pdf') return null;
  const { prev, next } = neighbours(doc);
  if (!prev && !next) return null;
  const link = (d, dir) => (d
    ? h('a', { class: `wl-pager-link is-${dir}`, href: docHref(d.path) },
      h('span', { class: 'wl-pager-dir' },
        dir === 'prev' ? icon('chevron-left') : null,
        dir === 'prev' ? 'Previous' : 'Next',
        dir === 'next' ? icon('chevron-right') : null),
      h('span', { class: 'wl-pager-name' }, d.name))
    : h('span', { class: 'wl-pager-gap' }));
  return h('nav', { class: 'wl-pager', 'aria-label': 'More on this shelf' }, link(prev, 'prev'), link(next, 'next'));
}

function loadingState(doc) {
  return h('div', { class: 'wl-state wl-loading', role: 'status' },
    h('span', { class: 'spinner wl-spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'wl-state-title' }, `Opening “${doc.name}”…`),
    doc.size > LARGE_BYTES / 5 ? h('p', { class: 'wl-state-text' }, `${fmtSize(doc.size)}. Large files can take a moment.`) : null);
}

function errorState(doc, e) {
  return h('div', { class: 'wl-state wl-error', role: 'alert' },
    h('span', { class: 'wl-state-icon' }, icon('warning', 40)),
    h('h2', { class: 'wl-state-title' }, 'This document could not be opened'),
    h('p', { class: 'wl-state-text' }, errorText(e)),
    h('div', { class: 'wl-state-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openReader(doc.path, reader?.query || {}) }, 'Try again'),
      h('button', { class: 'btn', type: 'button', onclick: () => downloadDoc(doc) }, icon('download'), h('span', null, 'Download instead')),
      h('a', { class: 'btn btn-ghost', href: href(VIEW) }, 'Back to the library')));
}

function renderMissing(path, removed = false) {
  readerEl.className = 'wl-reader';
  readerEl.replaceChildren(
    h('header', { class: 'wl-reader-head' },
      h('nav', { class: 'wl-crumbs', 'aria-label': 'Breadcrumb' },
        h('a', { class: 'wl-back', href: href(VIEW) }, h('span', { 'aria-hidden': 'true' }, '←'), h('span', null, DISPLAY)))),
    h('div', { class: 'wl-reader-body' },
      h('div', { class: 'wl-state wl-notice' },
        h('span', { class: 'wl-state-icon' }, icon('search', 40)),
        h('h2', { class: 'wl-state-title' }, removed ? 'This document was removed' : 'Document not found'),
        h('p', { class: 'wl-state-text' }, removed
          ? 'It is no longer in the library.'
          : `There is nothing called “${baseName(path)}” in the library. It may have been renamed, moved or deleted.`),
        h('div', { class: 'wl-state-actions' },
          h('a', { class: 'btn btn-primary', href: `${href(VIEW)}?q=${encodeURIComponent(prettify(baseName(path).replace(/\.[^.]+$/, '')))}` }, 'Search the library'),
          h('a', { class: 'btn btn-ghost', href: href(VIEW) }, 'All documents')))));
}

async function openReader(path, query = {}) {
  const my = ++seq;
  const doc = docAt(path);
  readerEl.querySelectorAll('audio, video').forEach((m) => m.pause());
  reader = { path, query, qkey: JSON.stringify(query), seq: my, url: null, failed: false, file: doc?.file || baseName(path) };
  const sc = scrollParent();
  if (sc) sc.scrollTop = 0;
  if (!doc) { renderMissing(path); return; }
  setTitle(doc);

  const body = h('div', { class: 'wl-reader-body' }, loadingState(doc));
  readerEl.className = `wl-reader wl-r-${doc.type.key}`;
  readerEl.replaceChildren(renderReaderHead(doc), body);
  try {
    const url = await store.fileUrl(path);
    if (my !== seq) return;
    if (!url) throw Object.assign(new Error('missing'), { code: 'missing' });
    reader.url = url;
    // Download / Open links were drawn before the URL existed: arm them in place (keeps focus).
    readerEl.querySelectorAll('a.wl-file-link').forEach((a) => { a.href = url; a.removeAttribute('aria-disabled'); });
    const node = await renderDocument(doc, {
      url,
      query,
      downloadLink: linkFactory('download'),
      openLink: linkFactory('open'),
    });
    if (my !== seq) return;
    body.replaceChildren(node);
    const foot = renderReaderFoot(doc);
    if (foot) readerEl.append(foot);
    scrollToAnchor(node, query);
  } catch (e) {
    if (my !== seq) return;
    console.error(`[wardens-library] could not open ${path}`, e);
    reader.failed = true;
    body.replaceChildren(errorState(doc, e));
  }
}

/** Store changed while reading: reload only when this file's contents changed, otherwise refresh the chrome. */
function refreshReader(ev) {
  if (!reader) return;
  const doc = docAt(reader.path);
  if (!doc) { renderMissing(reader.path, true); reader = null; return; }
  const replaced = (ev.type === 'put' && ev.path === reader.path)
    || (!store.saving && ev.type === 'pulled' && (ev.paths || []).includes(reader.path));
  if (replaced) { openReader(reader.path, reader.query); return; }
  if (reader.seq !== seq || readerEl.querySelector('.wl-loading')) return; // still loading; it will render fresh data
  readerEl.querySelector('.wl-reader-head')?.replaceWith(renderReaderHead(doc));
  readerEl.querySelector('.wl-pager')?.remove();
  if (!reader.failed) {
    const foot = renderReaderFoot(doc);
    if (foot) readerEl.append(foot);
  }
}

// ---------- routing ----------

function showShelf(query = {}) {
  if (mode === 'reader') {
    readerEl.querySelectorAll('audio, video').forEach((m) => m.pause());
    readerEl.replaceChildren();
    reader = null;
    seq += 1;
  }
  mode = 'shelf';
  readerEl.hidden = true;
  shelfEl.hidden = false;
  if (query.q != null && query.q !== state.q) {
    state.q = query.q;
    state.type = 'all';
    els.search.value = query.q;
  }
  renderShelf();
  const restore = savedScroll;
  savedScroll = null;
  if (restore) requestAnimationFrame(() => { restore.el.scrollTop = restore.top; });
}

function showReader(path, query) {
  if (mode === 'shelf' && !shelfEl.hidden) {
    const el = scrollParent();
    savedScroll = el ? { el, top: el.scrollTop } : null;
  }
  mode = 'reader';
  shelfEl.hidden = true;
  readerEl.hidden = false;
  const qkey = JSON.stringify(query);
  if (reader && reader.path === path && reader.qkey === qkey && !reader.failed) {
    const doc = docAt(path);
    if (doc) setTitle(doc);
    refreshReader({ type: 'show' });
    return;
  }
  openReader(path, query);
}

function onStoreEvent(ev) {
  if (!['put', 'remove', 'pulled', 'load', 'saved'].includes(ev.type)) return;
  const touches = ev.type === 'load'
    || (ev.path && ev.path.startsWith(ROOT))
    || (ev.paths || []).some((p) => p.startsWith(ROOT));
  if (!touches || !isVisible()) return;
  if (mode === 'shelf') renderShelf();
  else refreshReader(ev);
}

function wireDrop() {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const off = () => { depth = 0; root.classList.remove('is-dragover'); };
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    root.classList.add('is-dragover');
  });
  root.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) off(); });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    off();
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) openUpload({ files });
  });
}

// ---------- [[doc:…]] links ----------

registerLinkType('doc', {
  label: 'Document',
  resolve(target, anchor) {
    const d = findDoc(target);
    if (!d) {
      return { href: `${href(VIEW)}?q=${encodeURIComponent(target || '')}`, title: `Not in the Warden’s Library: ${target}`, exists: false };
    }
    return {
      href: docHref(d.path) + (anchor ? `?at=${encodeURIComponent(anchor)}` : ''),
      title: `${d.name} (${d.type.label}${d.shelf ? `, ${shelfLabel(d.shelf)}` : ''})`,
      exists: true,
    };
  },
  suggest(q) {
    return matchNames(listDocs(), q, (d) => d.name, 10).map((d) => ({ label: `${d.name} · ${d.type.label}`, value: linkTarget(d) }));
  },
  /** ![[doc:Name]] shows images, PDFs and media inline; other documents as a link card. */
  embed(target, anchor) {
    const d = findDoc(target);
    if (!d) return null;
    const box = h('div', { class: 'wl-embed', 'data-type': d.type.key });
    const inline = d.type.key === 'image' || d.type.key === 'audio' || d.type.key === 'video' || (d.type.key === 'pdf' && canInlinePdf());
    if (inline) {
      store.fileUrl(d.path).then((url) => {
        if (!url) return;
        const page = pdfPage({ at: anchor });
        const el = {
          image: () => h('img', { class: 'wl-embed-img', src: url, alt: d.name }),
          pdf: () => h('iframe', { class: 'wl-embed-pdf', src: url + (page ? `#page=${page}` : ''), title: d.name }),
          audio: () => h('audio', { src: url, controls: true, preload: 'metadata' }),
          video: () => h('video', { class: 'wl-embed-video', src: url, controls: true, preload: 'metadata', playsinline: true }),
        }[d.type.key]();
        box.append(el);
      }).catch((e) => console.warn('[wardens-library] embed failed', e));
    } else {
      box.append(h('a', { class: 'wl-embed-card', href: docHref(d.path) },
        h('span', { class: 'wl-embed-icon' }, icon(d.type.icon)),
        h('span', { class: 'wl-embed-name' }, d.name),
        h('span', { class: 'wl-embed-meta' }, `${d.type.label} · ${fmtSize(d.size)}`)));
    }
    return box;
  },
});

// ---------- view ----------

export default {
  id: VIEW,
  title: TITLE,
  icon: 'library',
  mount(el) {
    root = h('div', { class: 'wl' });
    shelfEl = h('div', { class: 'wl-shelf' });
    readerEl = h('div', { class: 'wl-reader', hidden: true });
    root.append(shelfEl, readerEl);
    el.append(root);
    buildShelf();
    wireDrop();
    store.on(onStoreEvent);
  },
  show(route) {
    const parts = route?.parts || [];
    if (!parts.length) showShelf(route?.query || {});
    else showReader(ROOT + parts.join('/'), route?.query || {});
  },
  hide() {
    readerEl?.querySelectorAll('audio, video').forEach((m) => m.pause());
    root?.classList.remove('is-dragover');
  },
};
