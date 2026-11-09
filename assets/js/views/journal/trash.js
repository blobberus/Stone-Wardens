// Recently deleted (#/journal/recently-deleted): notes and folders deleted from the journal wait here
// (content/journal-trash/, data.js "recently deleted") until someone empties the folder. Each one can be looked at,
// put back where it was, or deleted for good; the Files pane links here from its foot. Hidden notes (DM mode) stay
// hidden from the players while they wait.
import { h } from '../../core/dom.js';
import { icon, openModal, confirmDialog, toast } from '../../core/ui.js';
import { renderInto, parseFrontmatter } from '../../core/markdown.js';
import { isBoard } from './kinds.js';
import { boardMarkdown } from './board-md.js';
import { navigate } from '../../core/router.js';
import { saveSoon } from '../../core/saving.js';
import { registerHideable } from '../../core/dm.js';
import { hiddenMark } from '../../core/dm-ui.js';
import * as J from './data.js';
import { plural, relTime, fmtDay, plainText } from './text.js';
import { btn, iconBtn, emptyState } from './parts.js';
import { noteImages, dropIfUnused } from './gallery.js';

// A hidden note waiting here shows on the DM Screen as such; it comes back by being restored, not released.
registerHideable({
  prefix: `${J.TRASH}/`, label: 'Deleted journal note', icon: 'trash', order: 31, pickable: false, accept: (p) => /\.md$/i.test(p),
  describe: (path, data) => ({ title: typeof data === 'string' ? parseFrontmatter(data).data?.title : null, href: J.TRASH_HREF }),
  releaseBlock: () => 'This note is in the journal’s Recently deleted. Restore it there first, then release it.',
});

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const fromText = (e) => { const w = J.trashFrom(e); return w === J.VAULT_TITLE ? 'the journal' : `“${w}”`; };
const deleted = (e) => [e.at ? `Deleted ${relTime(e.at)}` : 'Deleted', e.by ? `by ${e.by}` : null].filter(Boolean).join(' ');
const lookup = (x) => (typeof x === 'string' ? J.trashEntry(x) : x && J.trashEntry(x.id));

// ---------- actions ----------

/** Put an entry (or trash id) back where it was. open: go to it afterwards. Returns J.restoreEntry's result or null. */
export function restore(x, ctx, { open = false } = {}) {
  const e = lookup(x);
  if (!e) { toast('That is no longer in Recently deleted.'); ctx.refresh(); return null; }
  const res = J.restoreEntry(e);
  toast(h('span', null, `“${e.title}” is back in ${fromText(e)}.`,
    res.merged ? ' A folder of that name was there already, so they are one folder now.'
      : res.renamed ? ' A note there already had its name, so both are kept.' : '',
    open ? null : [' ', h('a', { href: res.href }, 'Open')]), { type: 'success', timeout: 6000 });
  saveSoon(`journal: restore “${e.title}”`);
  if (open) navigate(res.href);
  else ctx.refresh();
  return res;
}

/** The toast after a delete, with Undo (restores it; reopen: open it again, it was open). */
export function deletedToast(text, id, ctx, { reopen = false } = {}) {
  let close = null;
  const undo = h('button', { type: 'button', class: 'btn btn-sm jr-toast-btn', onclick: (ev) => { ev.stopPropagation(); close?.(); restore(id, ctx, { open: reopen }); } }, icon('undo'), 'Undo');
  close = toast(h('span', { class: 'jr-toast-undo' }, h('span', null, text), undo), { timeout: 8000 });
}

const photosOf = (entries) => [...new Set(entries.flatMap((e) => e.notes.flatMap((n) => noteImages(n.fm).map((x) => x.src))))];
/** Uploaded reference photos of notes deleted for good go too, once no note (in the vault or still here) lists them. */
function dropPhotos(srcs) {
  if (!srcs.length) return;
  const users = [...J.index().notes, ...J.trashedNotes()];
  for (const src of srcs) dropIfUnused(src, users);
}

async function purge(x, ctx) {
  const e = lookup(x);
  if (!e) return;
  const inside = e.type === 'folder' && e.notes.length ? ` and the ${plural(e.notes.length, 'note')} in it` : '';
  const ok = await confirmDialog(`Delete “${e.title}”${inside} forever? This can’t be undone from the site.`,
    { title: 'Delete forever?', okLabel: 'Delete forever', danger: true });
  const cur = ok && lookup(e.id);
  if (!cur) return;
  const photos = photosOf([cur]);
  J.purgeEntry(cur);
  dropPhotos(photos);
  toast(`“${cur.title}” is deleted for good.`);
  saveSoon(`journal: delete “${cur.title}” for good`);
  ctx.refresh();
}

async function emptyAll(ctx) {
  const n = J.trashCount();
  if (!n) return;
  const ok = await confirmDialog(`Delete the ${plural(n, 'item')} in Recently deleted forever? This can’t be undone from the site.`,
    { title: 'Empty Recently deleted?', okLabel: n === 1 ? 'Delete it forever' : `Delete all ${n} forever`, danger: true });
  if (!ok) return;
  const photos = photosOf(J.trashEntries());
  J.emptyTrash();
  dropPhotos(photos);
  toast(`Emptied Recently deleted (${plural(n, 'item')}).`);
  saveSoon(`journal: empty Recently deleted (${plural(n, 'item')})`);
  ctx.refresh();
}

// ---------- looking inside ----------

function peek(e, ctx) {
  const body = h('div', { class: 'stack jr-trash-peek' },
    h('p', { class: 'jr-meta' }, `${deleted(e)} · from ${J.trashFrom(e)}`));
  if (e.type === 'note') {
    const n = e.notes[0];
    const prose = h('div', { class: 'jr-trash-prose' });
    if (n && isBoard(n.kind)) J.withNote(null, () => renderInto(prose, boardMarkdown(n))); // a family tree's or timeline's items too
    else if (n?.body.trim()) J.withNote(null, () => renderInto(prose, n.body));
    else prose.append(h('p', { class: 'muted' }, 'This note is empty.'));
    body.append(prose);
  } else if (e.notes.length) {
    const within = (n) => n.rel.slice(e.path.length + 1).split('/').slice(0, -1).map(J.titleFromSlug).join(' › ');
    body.append(h('ul', { class: 'jr-lrows', role: 'list' }, e.notes.map((n) => h('li', null,
      h('div', { class: 'jr-lrow is-static' }, icon('file'),
        h('span', { class: 'jr-lrow-main' },
          h('span', { class: 'jr-lrow-name' }, n.title, hiddenMark(n.path)),
          h('span', { class: 'jr-lrow-detail' }, [within(n), clip(plainText(n.body), 110)].filter(Boolean).join(' · ') || 'Empty note')))))));
  } else body.append(h('p', { class: 'muted' }, 'This folder is empty.'));
  const m = openModal({
    title: e.title, wide: e.type === 'note', className: 'jr-trash-modal', body,
    actions: [
      { label: 'Close', kind: 'ghost' },
      { label: 'Delete forever', kind: 'danger', onClick: () => { purge(e, ctx); } },
      { label: 'Restore', kind: 'primary', onClick: () => { restore(e, ctx); } },
    ],
  });
  body.addEventListener('click', (ev) => { if (ev.target.closest('a[href]')) m.close(); }); // a link in the note leaves the page
}

// ---------- the page ----------

function row(e, ctx) {
  const folder = e.type === 'folder';
  const detail = [folder ? `Folder · ${plural(e.notes.length, 'note')}` : null, `from ${J.trashFrom(e)}`, e.by ? `by ${e.by}` : null].filter(Boolean).join(' · ');
  return h('li', { class: 'jr-trow', 'data-trash': e.id },
    h('button', { type: 'button', class: 'jr-lrow jr-trow-open', title: `Look inside “${e.title}”`, onclick: () => peek(e, ctx) },
      icon(folder ? 'folder' : 'file'),
      h('span', { class: 'jr-lrow-main' },
        h('span', { class: 'jr-lrow-name' }, e.title, e.hidden ? hiddenMark(e.docs[0]?.path || e.bins[0]) : null),
        h('span', { class: 'jr-lrow-detail' }, detail)),
      h('span', { class: 'jr-lrow-meta', title: e.at ? `Deleted ${fmtDay(e.at)}` : null }, e.at ? relTime(e.at) : '')),
    h('div', { class: 'jr-trow-actions' },
      btn('Restore', () => restore(e, ctx), { ic: 'undo', title: `Put “${e.title}” back in ${fromText(e)}` }),
      iconBtn('trash', `Delete “${e.title}” forever`, () => purge(e, ctx), { className: 'jr-trow-purge' })));
}

export function renderTrash(host, ctx) {
  const entries = J.trashEntries();
  const notes = entries.reduce((s, e) => s + e.notes.length, 0);
  const sheet = h('article', { class: 'jr-sheet jr-index jr-trash' },
    h('header', { class: 'jr-sheet-head' },
      h('p', { class: 'jr-kicker' }, icon('trash'), h('a', { href: '#/journal' }, J.VAULT_TITLE)),
      h('h1', { class: 'jr-page-title' }, J.TRASH_TITLE),
      h('p', { class: 'jr-meta' }, entries.length
        ? [plural(entries.length, 'item'), notes !== entries.length ? plural(notes, 'note') : null].filter(Boolean).join(' · ')
        : 'Nothing waiting'),
      h('p', { class: 'jr-trash-about' }, 'Deleted notes and folders wait here, for the whole party, until someone empties the folder. Restore one to put it back where it was.'),
      entries.length ? h('div', { class: 'row jr-page-actions' },
        btn('Empty folder', () => emptyAll(ctx), { ic: 'trash', kind: 'danger', title: 'Delete everything here forever' })) : null),
    entries.length
      ? h('ul', { class: 'jr-lrows jr-trash-list', role: 'list' }, entries.map((e) => row(e, ctx)))
      : emptyState({ iconName: 'trash', title: 'Nothing here', text: 'Notes and folders you delete come here first, so they can be restored.' }));
  host.replaceChildren(sheet);
}
