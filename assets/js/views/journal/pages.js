// Journal spreads other than a single note: the contents spread (title page + table of contents | quick links,
// recent notes, tags), chapter title pages, search / tag results, and the "missing page" spread.
import { h, clear } from '../../core/dom.js';
import { icon, toast, confirmDialog } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { store } from '../../core/store.js';
import { href } from '../../core/router.js';
import { byName, baseName, stripExt } from '../../core/util.js';
import * as J from './data.js';
import { plural, relTime, plainText, snippet } from './text.js';
import {
  add, leader, block, tagList, metaLine, emptyState, btn, iconBtn, highlighted, fleuron, notesList, wireDrag, grip, upDown, chapterName,
} from './parts.js';
import { chapterDialog, confirmDeleteChapter } from './dialogs.js';

/** View-local UI state that survives refreshes of the same page. */
export const state = { arrange: false };

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

const dropHandlers = (ctx) => ({
  onNote: (path, chapter, at) => { J.placeNote(path, chapter, at); ctx.refresh(); },
  onChapter: (slug, at) => { J.placeChapter(slug, at); ctx.refresh(); },
});

const shiftNote = (ctx) => (n, d) => { J.shiftNote(n, d); ctx.refresh(); };

function arrangeToggle(ctx) {
  const on = state.arrange;
  return btn(on ? 'Done' : 'Arrange', () => { state.arrange = !on; ctx.refresh(); },
    { ic: on ? 'check' : 'sort', kind: 'ghost', pressed: on, title: on ? 'Finish arranging' : 'Reorder chapters and notes' });
}

/** Keep the first blocks of rendered prose up to ~max characters (a preview, not the whole page). */
function trimPreview(prose, max = 1100) {
  let total = 0;
  let cut = false;
  for (const el of [...prose.children]) {
    if (cut) { el.remove(); continue; }
    total += (el.textContent || '').length;
    if (total > max && el !== prose.firstElementChild) { el.remove(); cut = true; }
    else if (total > max) cut = true;
  }
  return cut;
}

function preview(note, { kicker = null } = {}) {
  const prose = h('div', { class: 'jr-preview-body' });
  let more = false;
  if (note.body.trim()) {
    J.withNote(note, () => renderInto(prose, note.body));
    prose.querySelectorAll('input[type="checkbox"]').forEach((b) => { b.disabled = true; });
    more = trimPreview(prose);
  } else prose.append(h('p', { class: 'jr-hint' }, 'This page is blank so far.'));
  return h('article', { class: 'jr-preview' },
    kicker ? h('p', { class: 'jr-kicker' }, kicker) : null,
    h('h2', { class: 'jr-preview-title' }, h('a', { href: note.href }, note.title)),
    metaLine(note),
    prose,
    h('a', { class: 'btn btn-sm jr-continue', href: note.href }, h('span', null, more ? 'Continue reading' : 'Open this page'), icon('chevron-right')));
}

// ---------- contents spread ----------

export function renderContents(pages, ctx) {
  const ix = J.index();
  const { verso, recto } = pages;
  verso.setHead('The Stone Wardens');
  verso.body.append(
    h('header', { class: 'jr-titleblock' },
      h('p', { class: 'jr-kicker' }, 'Being the collected notes of the Stone Wardens'),
      h('h1', { class: 'jr-booktitle' }, J.BOOK_TITLE),
      h('p', { class: 'jr-subtitle' }, J.BOOK_SUBTITLE),
      fleuron()),
    contentsBlock(ix, ctx));
  verso.setFoot({ folio: 'i' });

  recto.setHead('Quick links & index');
  add(recto.body, quickLinks(), recentBlock(), tagsBlock(), unwrittenBlock());
  const first = ix.notes[0];
  recto.setFoot({ folio: 'ii', next: first ? { href: first.href, title: first.title, kicker: 'Begin reading' } : null });
}

function contentsBlock(ix, ctx) {
  if (!ix.chapters.length && !ix.notes.length) {
    return emptyState({
      iconName: 'scroll',
      title: 'The pages are blank',
      text: 'Every legend starts with a single line. Write the first entry, or open a chapter to gather the sessions of an arc.',
      actions: [
        btn('Begin the chronicle', () => ctx.newNote(), { ic: 'edit', small: false }),
        btn('Start Chapter I', () => ctx.newChapter(), { ic: 'book-open', small: false }),
      ],
    });
  }
  const arrange = state.arrange;
  const toc = h('ol', { class: 'jr-toc', role: 'list', 'data-drop': 'chapter' },
    ix.chapters.map((c, i) => chapterEntry(c, i, ix.chapters.length, arrange, ctx)));
  const showLoose = ix.loose.notes.length > 0 || (arrange && ix.chapters.length > 0);
  const loose = showLoose ? h('div', { class: 'jr-toc-chapter jr-toc-loose', 'data-loose': '' },
    h('div', { class: 'jr-toc-chead' },
      h('a', { class: 'jr-toc-clink', href: ix.loose.href, draggable: arrange ? 'false' : null },
        h('span', { class: 'jr-toc-cnum' }, 'Unbound'),
        leader({ text: 'Loose Leaves', folio: ix.loose.notes[0]?.folio ?? '', className: 'jr-toc-cline' }))),
    notesList(ix.loose, { arrange, onShift: shiftNote(ctx) })) : null;
  const nav = h('nav', { class: ['jr-contents', arrange && 'is-arranging'], 'aria-label': 'Table of contents' },
    h('header', { class: 'jr-block-head' },
      h('h2', { class: 'jr-block-title' }, 'Contents'),
      h('div', { class: 'jr-block-tools' }, arrangeToggle(ctx))),
    arrange ? h('p', { class: 'jr-hint' }, 'Drag chapters and notes to reorder them, or drop a note into another chapter. The arrows do the same from the keyboard.') : null,
    ix.chapters.length ? toc : null,
    loose);
  if (arrange) wireDrag(nav, dropHandlers(ctx));
  return nav;
}

function chapterEntry(c, i, len, arrange, ctx) {
  return h('li', { class: 'jr-toc-chapter', 'data-chapter-item': c.slug, draggable: arrange ? 'true' : null },
    h('div', { class: 'jr-toc-chead' },
      arrange ? grip() : null,
      h('a', { class: 'jr-toc-clink', href: c.href, draggable: arrange ? 'false' : null },
        h('span', { class: 'jr-toc-cnum' }, c.label),
        leader({ text: c.title, folio: c.notes[0]?.folio ?? '', className: 'jr-toc-cline' })),
      arrange ? upDown(i, len, (d) => { J.shiftChapter(c, d); ctx.refresh(); }, c.title) : null),
    c.description && !arrange ? h('p', { class: 'jr-toc-cdesc' }, clip(plainText(c.description), 150)) : null,
    c.notes.length || arrange ? notesList(c, { arrange, onShift: shiftNote(ctx) }) : h('p', { class: 'jr-toc-none' }, 'No notes yet'));
}

function quickLinks() {
  const chars = store.list('content/characters')
    .map(({ path, data }) => ({ id: data?.id || stripExt(baseName(path)), name: String(data?.name || '').trim() || 'Unnamed warden' }))
    .sort(byName);
  const places = store.list('content/locations').length;
  const row = (to, ic, title, note) => h('li', null, leader({ href: to, text: [icon(ic), h('span', null, title)], folio: note, className: 'jr-quick' }));
  return block('Quick links', h('ul', { class: 'jr-leaders', role: 'list' },
    row('#/map', 'map', 'The Map', places ? plural(places, 'marked place') : 'the known world'),
    row('#/characters', 'characters', 'Characters', chars.length ? plural(chars.length, 'warden') : 'the party'),
    chars.length ? h('li', { class: 'jr-party-row' }, h('ul', { class: 'jr-party', role: 'list', 'aria-label': 'Character sheets' },
      chars.map((c) => h('li', null, h('a', { href: href('characters', c.id) }, icon('user'), h('span', null, c.name)))))) : null,
    row('#/compendium', 'compendium', 'Compendium', 'rules, spells & gear'),
    row('#/wardens-library', 'library', 'Warden’s Library', 'campaign documents')));
}

function recentBlock() {
  const recent = J.recentNotes(6);
  if (!recent.length) return null;
  return block('Recently written', h('ul', { class: 'jr-leaders', role: 'list' }, recent.map((n) => h('li', null,
    leader({ href: n.href, text: n.title, folio: relTime(n.updated || n.created), title: `${chapterName(n.chapterRef)}${n.author ? ` · by ${n.author}` : ''}` })))));
}

function tagsBlock() {
  const tags = J.allTags();
  return block('Tags', tags.length
    ? tagList(tags.slice(0, 80), { counts: true })
    : h('p', { class: 'jr-hint' }, 'Write #tags in any note, like #npc or #quest/open, and they gather here.'));
}

function unwrittenBlock() {
  const list = J.unwritten(8);
  if (!list.length) return null;
  return block('Pages yet to be written', h('ul', { class: 'jr-leaders', role: 'list' }, list.map((u) => h('li', null,
    leader({
      href: `${href('journal', 'new')}?title=${encodeURIComponent(u.title)}`, text: u.title, className: 'is-unwritten',
      folio: u.from.length > 1 ? `${u.from.length} mentions` : 'mentioned', title: `Linked from ${u.from.map((n) => n.title).join(', ')}`,
    })))), { hint: 'Links to notes nobody has written yet. Open one to start it.' });
}

// ---------- chapter title page ----------

export function renderChapter(pages, ch, ctx) {
  const ix = J.index();
  const { verso, recto } = pages;
  const arrange = state.arrange;
  verso.setHead(ch.loose ? 'Loose Leaves' : ch.label);
  let desc = null;
  if (ch.description) {
    desc = h('div', { class: 'jr-chapter-desc' });
    J.withNote(null, () => renderInto(desc, ch.description));
  } else if (ch.loose) desc = h('p', { class: 'jr-chapter-desc jr-hint' }, 'Notes not yet bound into a chapter.');
  const tools = ch.loose ? null : h('div', { class: 'jr-chapter-tools' },
    btn('Edit chapter', () => editChapter(ch, ctx), { ic: 'edit', kind: 'ghost' }),
    iconBtn('chevron-up', 'Move chapter earlier', () => { J.shiftChapter(ch, -1); ctx.refresh(); }, { disabled: ch.num === 1 }),
    iconBtn('chevron-down', 'Move chapter later', () => { J.shiftChapter(ch, 1); ctx.refresh(); }, { disabled: ch.num === ix.chapters.length }),
    btn('Delete chapter', () => removeChapter(ch, ctx), { ic: 'trash', kind: 'ghost', className: 'jr-danger' }));

  const list = ch.notes.length
    ? notesList(ch, { arrange, onShift: shiftNote(ctx) })
    : emptyState({
      iconName: 'edit',
      title: 'No pages yet',
      text: ch.loose ? 'Notes without a chapter collect here.' : 'This chapter is waiting for its first page.',
      actions: [btn('Write the first page', () => ctx.newNote({ chapter: ch.slug }), { ic: 'edit', small: false })],
    });
  const contents = block('In this chapter', list, {
    count: ch.notes.length || null,
    tools: [ch.notes.length > 1 ? arrangeToggle(ctx) : null, btn('New note', () => ctx.newNote({ chapter: ch.slug }), { ic: 'plus', kind: 'ghost' })],
  });
  if (arrange) wireDrag(contents, dropHandlers(ctx));

  verso.body.append(
    h('header', { class: 'jr-chapter-title' },
      h('p', { class: 'jr-kicker' }, ch.loose ? 'Unbound pages' : ch.label),
      h('h1', { class: 'jr-chapter-name' }, ch.title),
      fleuron(),
      desc,
      tools),
    contents);

  const order = [...ix.chapters, ...(ix.loose.notes.length ? [ix.loose] : [])];
  const pos = order.findIndex((c) => c.slug === ch.slug);
  const prevCh = pos > 0 ? order[pos - 1] : null;
  verso.setFoot({ prev: prevCh ? { href: prevCh.href, title: prevCh.title, kicker: prevCh.loose ? 'Loose Leaves' : prevCh.label } : { href: '#/journal', title: 'Contents', kicker: 'Back to' } });

  const first = ch.notes[0];
  if (first) {
    recto.setHead(first.title);
    recto.body.append(preview(first, { kicker: 'The first page' }));
    recto.setFoot({ next: { href: first.href, title: first.title, kicker: 'Turn the page' } });
  } else {
    const nextCh = pos >= 0 ? order[pos + 1] : null;
    recto.setHead('');
    recto.body.append(h('div', { class: 'jr-blank-page' }, h('p', null, 'This page intentionally left blank.')));
    recto.setFoot({ next: nextCh ? { href: nextCh.href, title: nextCh.title, kicker: nextCh.loose ? 'Loose Leaves' : nextCh.label } : null });
  }
}

async function editChapter(ch, ctx) {
  const res = await chapterDialog({ title: ch.title, description: ch.description, heading: `Edit ${ch.label}`, okLabel: 'Save chapter' });
  if (!res) return;
  const before = J.index();
  J.updateChapter(ch, { title: res.title, description: res.description });
  if (res.title !== ch.title) {
    const plan = J.chapterLinkPlan(before, ch.slug, res.title);
    if (plan.count && await confirmDialog(
      `${plural(plan.count, 'link')} in ${plural(plan.notes.length, 'note')} point to “${ch.title}”. Update ${plan.count === 1 ? 'it' : 'them'} to “${res.title}”?`,
      { title: 'Update links?', okLabel: 'Update links', cancelLabel: 'Leave them' },
    )) {
      const n = plan.apply();
      toast(`Updated ${plural(n, 'link')}.`, { type: 'success' });
    }
  }
  ctx.refresh();
}

async function removeChapter(ch, ctx) {
  const choice = await confirmDeleteChapter(ch);
  if (!choice) return;
  const count = ch.notes.length;
  J.deleteChapter(ch, choice);
  toast(choice === 'loose' && count
    ? `${ch.label} removed; ${plural(count, 'note')} moved to Loose Leaves.`
    : `${ch.label} deleted.`, { type: 'success' });
  ctx.go('#/journal', { replace: true });
}

// ---------- search and tag results ----------

export function renderResults(pages, { q = '', tag = '' }, ctx) {
  const { verso, recto } = pages;
  const isTag = !q && !!tag;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = isTag
    ? J.notesWithTag(tag).map((note) => ({ note, text: clip(note.plain, 180), ranges: [] }))
    : J.search(q);
  verso.setHead(isTag ? 'Tags' : 'Search');

  let shown = null;
  const showPreview = (note) => {
    if (shown === note) return;
    shown = note;
    clear(recto.body);
    recto.setHead(note.title);
    recto.body.append(preview(note, { kicker: chapterName(note.chapterRef) }));
    recto.setFoot({ next: { href: note.href, title: note.title, kicker: 'Open' } });
  };

  const list = h('ol', { class: 'jr-results', role: 'list' }, results.map((r) => {
    const title = isTag ? r.note.title : highlighted(r.note.title, snippet(r.note.title, terms, { max: 400 }).ranges);
    return h('li', null, h('a', {
      class: 'jr-result', href: r.note.href,
      onmouseenter: () => showPreview(r.note), onfocus: () => showPreview(r.note),
    },
    h('span', { class: 'jr-result-title' }, title),
    h('span', { class: 'jr-result-where' }, chapterName(r.note.chapterRef)),
    r.text ? h('span', { class: 'jr-result-snippet' }, highlighted(r.text, r.ranges)) : null));
  }));

  const nested = isTag ? J.allTags().filter((t) => t.tag.toLowerCase().startsWith(`${tag.toLowerCase()}/`)) : [];
  add(verso.body,
    h('header', { class: 'jr-results-head' },
      h('p', { class: 'jr-kicker' }, isTag ? 'Notes tagged' : 'Searching the chronicle for'),
      h('h1', { class: 'jr-results-title' }, isTag ? `#${tag}` : `“${q}”`),
      h('p', { class: 'jr-meta' }, plural(results.length, 'note'), h('span', { class: 'jr-meta-sep', 'aria-hidden': 'true' }, '·'), h('a', { href: '#/journal' }, 'Back to contents'))),
    nested.length ? block('Narrower tags', tagList(nested, { counts: true })) : null,
    results.length ? list : emptyState({
      iconName: 'search',
      title: 'Nothing found',
      text: isTag ? `No note carries #${tag} yet.` : `No note mentions “${q}”.`,
      actions: isTag ? [] : [btn(`Create “${clip(q, 40)}”`, () => ctx.newNote({ title: q }), { ic: 'plus', small: false })],
    }),
    isTag ? block('All tags', tagList(J.allTags(), { counts: true, active: tag }), { className: 'jr-alltags' }) : null);
  verso.setFoot({ prev: { href: '#/journal', title: 'Contents', kicker: 'Back to' } });

  if (results[0]) showPreview(results[0].note);
  else {
    recto.setHead('');
    recto.body.append(h('div', { class: 'jr-blank-page' }, h('p', null, isTag ? 'No pages to show.' : 'Try fewer words, or search for a name.')));
  }
}

// ---------- missing page ----------

export function renderMissing(pages, { chapter, slug = null }, ctx) {
  const { verso, recto } = pages;
  const ch = J.chapterAt(chapter);
  verso.setHead('A torn-out page');
  const guessTitle = slug ? J.titleFromSlug(slug) : J.titleFromSlug(chapter);
  verso.body.append(emptyState({
    iconName: 'warning',
    title: slug ? 'This page is missing' : 'No such chapter',
    text: slug
      ? `There is no note “${guessTitle}” in ${ch ? chapterName(ch) : 'this chapter'}. It may have been renamed, moved, or torn out.`
      : `There is no chapter called “${guessTitle}”.`,
    actions: [
      slug ? btn('Write it now', () => ctx.newNote({ title: guessTitle, chapter: ch ? ch.slug : J.LOOSE }), { ic: 'edit', small: false }) : null,
      h('a', { class: 'btn', href: '#/journal' }, 'Back to contents'),
    ].filter(Boolean),
  }));
  verso.setFoot({ prev: { href: '#/journal', title: 'Contents', kicker: 'Back to' } });
  const guesses = J.search(guessTitle).slice(0, 6);
  recto.setHead('');
  recto.body.append(guesses.length
    ? block('Perhaps you meant', h('ul', { class: 'jr-leaders', role: 'list' }, guesses.map((r) => h('li', null,
      leader({ href: r.note.href, text: r.note.title, folio: r.note.folio })))))
    : h('div', { class: 'jr-blank-page' }, h('p', null, 'Nothing similar in the chronicle.')));
}
