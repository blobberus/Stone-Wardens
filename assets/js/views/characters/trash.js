// Recently deleted: sheets removed from the roster wait here. Restore one, delete one for good, or empty the folder.
// Route: #/characters/recently-deleted
import { h, mount } from '../../core/dom.js';
import { icon, openModal, confirmDialog, toast } from '../../core/ui.js';
import { href } from '../../core/router.js';
import { VIEW, listTrash, trashCharacter, restoreCharacter, purgeCharacter, totalLevel } from './data.js';
import { derive } from './bridge.js';
import { portrait } from './widgets.js';

export const TRASH_ROUTE = 'recently-deleted';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ago(iso) {
  const t = Date.parse(iso || '');
  if (!t) return 'some time ago';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${plural(hr, 'hour')} ago`;
  const d = Math.round(hr / 24);
  return d < 30 ? `${plural(d, 'day')} ago` : `on ${new Date(t).toLocaleDateString()}`;
}

function summary(c) {
  let line = '';
  try { line = derive(c).classLine; } catch { line = ''; }
  const lvl = totalLevel(c);
  return [lvl ? `Level ${lvl}` : null, line || null, c.player ? `played by ${c.player}` : null].filter(Boolean).join(' · ');
}

/** Warn, then move the sheet to Recently deleted. Resolves true if it was deleted. */
export function deleteWithWarning(c) {
  return new Promise((resolve) => {
    let ok = false;
    openModal({
      title: 'Delete this character?',
      body: h('div', { class: 'stack' },
        h('div', { class: 'callout', 'data-callout': 'warning' },
          h('div', { class: 'callout-title' }, `You are about to delete ${c.name || 'this character'}`),
          h('div', { class: 'callout-content' }, h('p', null, summary(c) || 'An unfinished sheet.'))),
        h('p', null, 'The sheet leaves the party roster and goes to ', h('strong', null, 'Recently deleted'),
          ' on the Characters page. It can be restored from there until someone empties that folder.'),
        h('p', { class: 'muted' }, 'While it is deleted, journal links to it show as unresolved.')),
      actions: [
        { label: 'Keep it', kind: 'ghost' },
        { label: 'Delete character', kind: 'danger', onClick: () => { ok = true; } },
      ],
      onClose: () => { if (ok) ok = trashCharacter(c.id); resolve(ok); },
    });
  });
}

async function purgeOne(c) {
  const ok = await confirmDialog(`Delete ${c.name || 'this character'} forever? This can't be undone from the site.`,
    { title: 'Delete forever?', okLabel: 'Delete forever', danger: true });
  if (!ok) return;
  purgeCharacter(c.id);
  toast(`${c.name || 'Character'} deleted for good.`);
}

async function emptyFolder(items) {
  const ok = await confirmDialog(`Permanently delete ${plural(items.length, 'character sheet')}? This can't be undone from the site.`,
    { title: 'Empty Recently deleted?', okLabel: `Delete ${items.length} forever`, danger: true });
  if (!ok) return;
  for (const { char } of items) purgeCharacter(char.id);
  toast(`Emptied Recently deleted (${plural(items.length, 'sheet')}).`);
}

function row({ char, trashed }) {
  return h('li', { class: 'card ch-trash-row', 'data-id': char.id },
    portrait(char, { size: 'sm' }),
    h('div', { class: 'ch-trash-id' },
      h('h3', { class: 'card-title' }, char.name || 'Unnamed'),
      h('p', { class: 'card-sub' }, summary(char) || 'No class yet'),
      h('p', { class: 'muted ui text-sm' }, `Deleted ${ago(trashed.at)}${trashed.by ? ` by ${trashed.by}` : ''}`)),
    h('div', { class: 'row ch-trash-actions' },
      h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { if (restoreCharacter(char.id)) toast(`${char.name || 'Character'} is back in the roster.`, { type: 'success' }); },
      }, icon('undo'), 'Restore'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => purgeOne(char) }, icon('trash'), 'Delete forever')));
}

export function renderTrash(root) {
  const items = listTrash();
  mount(root,
    h('a', { class: 'btn btn-ghost btn-sm ch-trash-back', href: href(VIEW) }, icon('chevron-left'), 'All characters'),
    h('header', { class: 'view-head ch-roster-head' },
      h('h1', { class: 'view-title' }, 'Recently deleted'),
      h('p', { class: 'view-sub' }, items.length
        ? `${plural(items.length, 'deleted sheet')}. Restore one to put it back in the roster, or empty the folder to delete them for good.`
        : 'Deleted character sheets wait here until the folder is emptied.'),
      items.length ? h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => emptyFolder(items) }, icon('trash'), 'Empty folder')) : null),
    items.length
      ? h('ul', { class: 'ch-trash', role: 'list' }, items.map(row))
      : h('div', { class: 'empty-state' }, icon('folder'), h('h3', null, 'The folder is empty'),
        h('p', null, 'Nothing has been deleted. Deleting a character from Edit all moves it here first.')));
}
