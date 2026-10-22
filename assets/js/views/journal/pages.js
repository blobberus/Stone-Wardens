// Main-pane pages other than a note: the vault home (recent notes, folders, unwritten pages, tags), a folder page
// (its description, subfolders and notes; what [[folder:…]] / [[chapter:…]] links open) and the missing page.
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { href } from '../../core/router.js';
import * as J from './data.js';
import * as S from './state.js';
import { plural, relTime, fuzzy, plainText } from './text.js';
import { add, btn, tagList, emptyState, iconBtn } from './parts.js';

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

function block(title, body, { count = null, tools = null } = {}) {
  return h('section', { class: 'jr-block' },
    h('header', { class: 'jr-block-head' },
      h('h2', { class: 'jr-block-title' }, title, count != null ? h('span', { class: 'jr-count' }, String(count)) : null),
      tools ? h('div', { class: 'jr-block-tools' }, tools) : null),
    body);
}

/** A dense list row: icon, name, muted detail, right-aligned meta. */
function row({ to, ic = null, name, detail = null, meta = null, title = null, className = null }) {
  return h('li', null, h('a', { class: ['jr-lrow', className], href: to, title },
    ic ? icon(ic) : null,
    h('span', { class: 'jr-lrow-main' }, h('span', { class: 'jr-lrow-name' }, name), detail ? h('span', { class: 'jr-lrow-detail' }, detail) : null),
    meta ? h('span', { class: 'jr-lrow-meta' }, meta) : null));
}

const where = (n) => (n.folderRef && !n.folderRef.isRoot ? J.folderLabel(n.folderRef) : null);

// ---------- home ----------

export function renderHome(host, ctx) {
  const ix = J.index();
  const latest = J.recentNotes(1)[0];
  const opened = S.recent().map((p) => J.noteByPath(p, ix)).filter(Boolean).slice(0, 8);
  const edited = J.recentNotes(8);
  const folders = J.sortFolders(ix.root.folders, 'name-asc');
  const unwritten = J.unwritten(8);
  const tags = J.allTags().slice(0, 30);
  const actions = h('div', { class: 'row jr-page-actions' },
    btn('New note', () => ctx.newNote({ folder: ix.root }), { ic: 'file-plus', kind: 'primary', small: false }),
    btn('New folder', () => ctx.newFolder({ parent: ix.root }), { ic: 'folder-plus', small: false }),
    btn('Jump to…', () => ctx.switcher(), { ic: 'compass', kind: 'ghost', small: false, title: 'Quick switcher (Ctrl+O or Ctrl+K)' }));

  const sheet = h('article', { class: 'jr-sheet jr-index' },
    h('header', { class: 'jr-sheet-head' },
      h('h1', { class: 'jr-page-title' }, J.VAULT_TITLE),
      h('p', { class: 'jr-meta' },
        `${plural(ix.notes.length, 'note')} in ${plural(ix.folderList.length - 1, 'folder')}`,
        latest ? [h('span', { class: 'jr-meta-sep', 'aria-hidden': 'true' }, '·'), `last edited ${relTime(latest.updated || latest.created)}`] : null),
      actions));
  if (!ix.notes.length && !folders.length) {
    sheet.append(emptyState({
      iconName: 'scroll', title: 'The vault is empty',
      text: 'Every legend starts with a single line. Write the first note, or make a folder for sessions, people or places.',
    }));
    host.replaceChildren(sheet);
    return;
  }
  const grid = h('div', { class: 'jr-index-grid' });
  add(grid,
    opened.length ? block('Recently opened', h('ul', { class: 'jr-lrows', role: 'list' }, opened.map((n) => row({
      to: n.href, ic: 'file', name: n.title, detail: where(n), meta: relTime(n.updated || n.created),
    })))) : null,
    edited.length ? block('Recently edited', h('ul', { class: 'jr-lrows', role: 'list' }, edited.map((n) => row({
      to: n.href, ic: 'file', name: n.title, detail: [where(n), n.author ? `by ${n.author}` : null].filter(Boolean).join(' · ') || null,
      meta: relTime(n.updated || n.created),
    })))) : null,
    folders.length ? block('Folders', h('ul', { class: 'jr-lrows', role: 'list' }, folders.map((f) => row({
      to: f.href, ic: 'folder', name: f.title, detail: f.description ? clip(plainText(f.description), 90) : null, meta: plural(f.count, 'note'),
    }))), { count: folders.length }) : null,
    unwritten.length ? block('Not written yet', h('ul', { class: 'jr-lrows', role: 'list' }, unwritten.map((u) => row({
      to: `${href('journal', 'new')}?title=${encodeURIComponent(u.title)}`, ic: 'plus', name: u.title, className: 'is-unwritten',
      detail: `linked from ${u.from.slice(0, 3).map((n) => n.title).join(', ')}${u.from.length > 3 ? '…' : ''}`,
      title: `Create “${u.title}”`,
    })))) : null,
    tags.length ? block('Tags', tagList(tags, { counts: true }), { tools: btn('All tags', () => ctx.showLeft('tags'), { kind: 'ghost' }) }) : null);
  sheet.append(grid);
  host.replaceChildren(sheet);
}

// ---------- folder page ----------

export function renderFolder(host, f, ctx) {
  const sort = S.prefs.sort;
  const subs = J.sortFolders(f.folders, sort);
  const notes = J.sortNotes(f.notes, sort);
  let title;
  if (f.isRoot) title = h('h1', { class: 'jr-page-title' }, J.VAULT_TITLE);
  else {
    title = h('input', {
      class: 'jr-title jr-folder-title', value: f.title, 'aria-label': 'Folder name', maxlength: 120, spellcheck: true, title: 'Click to rename',
    });
    const commit = () => {
      const t = title.value.replace(/\s+/g, ' ').trim();
      if (!t) { title.value = f.title; return; }
      if (t !== f.title) ctx.renameFolder(J.folderAt(f.path) || f, t);
    };
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); title.value = f.title; title.blur(); }
    });
    title.addEventListener('change', commit);
  }
  let desc = null;
  if (f.description) {
    desc = h('div', { class: 'jr-folder-desc' });
    J.withNote(null, () => renderInto(desc, f.description));
  }
  const tools = h('div', { class: 'row jr-page-actions' },
    btn('New note here', () => ctx.newNote({ folder: f }), { ic: 'file-plus', kind: 'primary' }),
    btn('New folder', () => ctx.newFolder({ parent: f }), { ic: 'folder-plus' }),
    f.isRoot ? null : btn(f.description ? 'Edit description' : 'Add a description', () => ctx.editDescription(f), { ic: 'edit', kind: 'ghost' }),
    h('span', { class: 'spacer' }),
    f.isRoot ? null : iconBtn('more', 'More folder actions', (e) => ctx.itemMenu({ type: 'folder', path: f.path }, { anchor: e.currentTarget, align: 'end' })));

  const list = subs.length || notes.length ? h('ul', { class: 'jr-lrows jr-folder-list', role: 'list' },
    subs.map((c) => row({ to: c.href, ic: 'folder', name: c.title, detail: c.description ? clip(plainText(c.description), 90) : null, meta: plural(c.count, 'note') })),
    notes.map((n) => row({
      to: n.href, ic: 'file', name: n.title, detail: clip(n.plain, 110) || null,
      meta: relTime(n.updated || n.created), title: n.author ? `by ${n.author}` : null,
    })))
    : emptyState({
      iconName: 'folder', title: 'An empty folder', text: 'Nothing has been filed here yet.',
      actions: [btn('Write the first note', () => ctx.newNote({ folder: f }), { ic: 'edit', small: false })],
    });

  const parent = f.parent && !f.parent.isRoot ? f.parent : null;
  const sheet = h('article', { class: 'jr-sheet jr-index jr-folder' },
    h('header', { class: 'jr-sheet-head' },
      h('p', { class: 'jr-kicker' }, icon('folder'), parent ? h('a', { href: parent.href }, J.folderLabel(parent)) : f.isRoot ? 'Everything in the vault root' : 'Folder'),
      title,
      h('p', { class: 'jr-meta' }, [
        f.folders.length ? plural(f.folders.length, 'folder') : null,
        plural(f.notes.length, 'note'),
        f.count > f.notes.length ? `${f.count} in all` : null,
      ].filter(Boolean).join(' · ')),
      desc,
      tools),
    list);
  host.replaceChildren(sheet);
}

// ---------- missing ----------

export function renderMissing(host, target, ctx) {
  const ix = J.index();
  const slug = target.slug || '';
  const guess = J.titleFromSlug(slug);
  const folder = target.folder;
  const place = folder && !folder.isRoot ? `“${J.folderLabel(folder)}”` : 'the vault';
  const guesses = ix.notes.map((n) => ({ n, f: fuzzy(guess, n.title) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score).slice(0, 6);
  const sheet = h('article', { class: 'jr-sheet jr-index' },
    emptyState({
      iconName: 'warning',
      title: target.maybeFolder ? 'No such note or folder' : 'This page is missing',
      text: `There is no note “${guess}” in ${place}. It may have been renamed, moved or deleted.`,
      actions: [
        btn('Write it now', () => ctx.newNote({ title: guess, folder: folder || ix.root }), { ic: 'edit', small: false, kind: 'primary' }),
        h('a', { class: 'btn', href: '#/journal' }, 'Back to the journal'),
      ],
    }),
    guesses.length ? block('Perhaps you meant', h('ul', { class: 'jr-lrows', role: 'list' }, guesses.map(({ n }) => row({
      to: n.href, ic: 'file', name: n.title, detail: J.folderLabel(n.folderRef),
    })))) : null);
  host.replaceChildren(sheet);
}
