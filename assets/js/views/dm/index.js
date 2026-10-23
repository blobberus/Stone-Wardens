// DM Screen (shown in the menu only in DM mode), two pages under its tabs:
// - #/dm: everything hidden from the players, release it (players get an Inbox notification), the released log with
//   "Hide again", hide an existing item, create something hidden, DM settings. The layer itself: core/dm.js; shared
//   controls: core/dm-ui.js; docs/dm-mode.md.
// - #/dm/party: the party at a glance, live (party.js; docs/dm-party.md).
import { h, mount } from '../../core/dom.js';
import { icon, toast, confirmDialog, pickFromList, openModal } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate } from '../../core/router.js';
import { saveSoon, saveNow } from '../../core/saving.js';
import { fmtDate } from '../../core/util.js';
import {
  isDm, onDm, dmNewHidden, setDmNewHidden, hiddenItems, releasedItems, releaseItem, hideItem, lockDm, changeDmPassword,
  hideableKinds, isHidden, describe, DM_DIR, INBOX_DIR,
} from '../../core/dm.js';
import { dmLogin } from '../../core/dm-ui.js';
import { renderParty, startParty, stopParty, partyEvent } from './party.js';

const VIEW = 'dm';
let root = null;
let queued = false;
let page = 'main'; // 'main' | 'party' (#/dm/party)
const filters = { hidden: '', released: '' }; // category shown in each list ('' = all), for this visit

const pluralOf = (label) => (/y$/.test(label) ? `${label.slice(0, -1)}ies` : `${label}s`);
const iconOf = (label) => hideableKinds().find((k) => k.label === label)?.icon || 'file';

/** Category chips over a list (All, then each category in it, with counts); clears a filter whose category emptied. */
function filterBar(list, key) {
  const counts = new Map();
  for (const x of list) counts.set(x.label, (counts.get(x.label) || 0) + 1);
  if (filters[key] && !counts.has(filters[key])) filters[key] = '';
  const rank = (label) => { const i = hideableKinds().findIndex((k) => k.label === label); return i < 0 ? 99 : i; };
  const chip = (value, text, n, ic) => h('button', {
    type: 'button', class: 'chip dm-filter', 'aria-pressed': String(filters[key] === value),
    onclick: () => { filters[key] = value; render(); },
  }, ic ? icon(ic) : null, text, h('span', { class: 'dm-n' }, String(n)));
  return h('div', { class: 'dm-filters', role: 'group', 'aria-label': key === 'hidden' ? 'Show hidden' : 'Show released' },
    chip('', 'All', list.length),
    [...counts.keys()].sort((a, b) => rank(a) - rank(b)).map((label) => chip(label, pluralOf(label), counts.get(label), iconOf(label))));
}
const pick = (list, key) => (filters[key] ? list.filter((x) => x.label === filters[key]) : list);

/** The DM Screen's pages. */
function dmTabs() {
  const tab = (id, to, ic, text) => h('a', { class: ['tab', page === id && 'is-active'], href: to, 'aria-current': page === id ? 'page' : null }, icon(ic), text);
  return h('nav', { class: 'tabs dm-tabs', 'aria-label': 'DM Screen pages' },
    tab('main', '#/dm', 'eye-off', 'Hidden & released'),
    tab('party', '#/dm/party', 'users', 'Party'));
}

const visible = () => !!root?.isConnected && !root.closest('[hidden]');

/** The party page fills the view (party.js fits the cards to it). */
function partyChrome(on) {
  root.classList.toggle('is-party', on);
  const view = root.closest('.view');
  view?.classList.toggle('is-party', on);
  if (!on) view?.classList.remove('is-party-scroll');
}

function render() {
  if (!root) return;
  const party = page === 'party' && isDm();
  partyChrome(party);
  if (party) {
    renderParty(root, dmTabs());
    if (visible()) startParty();
    return;
  }
  stopParty();
  if (!isDm()) {
    mount(root,
      h('header', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'DM Screen')),
      h('div', { class: 'empty-state dm-locked' }, icon('lock'),
        h('h2', null, 'For the DM’s eyes only'),
        h('p', null, 'Log in with the DM password to see and release hidden quests, library items, notes and documents.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dmLogin() }, icon('lock'), 'DM login')));
    return;
  }
  // Released items are public again, so they are only in Released (a hidden copy of a released path wins: it was hidden again)
  const hidden = hiddenItems();
  const released = releasedItems().filter((x) => !isHidden(x.path));
  const hiddenBar = hidden.length ? filterBar(hidden, 'hidden') : null;
  const releasedBar = released.length ? filterBar(released, 'released') : null;
  const hiddenShown = pick(hidden, 'hidden');
  const releasedShown = pick(released, 'released');
  mount(root,
    h('header', { class: 'view-head' },
      h('h1', { class: 'view-title' }, 'DM Screen'),
      h('p', { class: 'view-sub' }, 'Hidden items stay where you made them, visible only to you (with a lock), until you release them here or with their “Hidden from players” switch.'),
      h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: changePassword }, icon('edit'), 'Change DM password'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await lockDm(); toast('DM mode is off on this device.'); } }, icon('lock'), 'Lock DM mode'))),
    dmTabs(),
    h('section', { class: 'panel dm-panel dm-create' },
      h('header', { class: 'panel-head' }, icon('plus'), h('h2', null, 'Create')),
      h('div', { class: 'panel-body stack' },
        h('div', { class: 'dm-new-row' },
          h('button', {
            class: ['btn', 'dm-vis', dmNewHidden() ? 'is-hidden' : 'is-visible'], type: 'button', 'aria-pressed': String(dmNewHidden()),
            onclick: () => setDmNewHidden(!dmNewHidden()),
          }, icon(dmNewHidden() ? 'eye-off' : 'eye'), dmNewHidden() ? 'New items start hidden' : 'New items start visible'),
          h('span', { class: 'muted ui text-sm' }, 'The default of the switch in every “create” form while DM mode is on (also in the menu, under the DM button).')),
        h('div', { class: 'dm-create-btns' },
          h('a', { class: 'btn', href: '#/quests?new=1' }, icon('quests'), 'New quest'),
          h('a', { class: 'btn', href: '#/compendium?new=1' }, icon('compendium'), 'New compendium entry'),
          h('a', { class: 'btn', href: '#/journal/new' }, icon('journal'), 'New journal note'),
          h('a', { class: 'btn', href: '#/wardens-library?upload=1' }, icon('library'), 'Add documents')))),
    h('section', { class: 'panel dm-panel' },
      h('header', { class: 'panel-head' }, icon('eye-off'), h('h2', null, 'Hidden from players'), h('span', { class: 'badge' }, String(hidden.length)),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: hideExisting }, icon('eye-off'), 'Hide an existing item…')),
      h('div', { class: 'panel-body' }, hidden.length
        ? [hiddenBar, filters.hidden ? h('ul', { class: 'dm-list', role: 'list' }, hiddenShown.map(hiddenRow)) : groups(hiddenShown, hiddenRow)]
        : h('p', { class: 'muted ui text-sm' }, 'Nothing hidden. Create something with “Hidden from players” on, or hide an existing item.'))),
    h('section', { class: 'panel dm-panel' },
      h('header', { class: 'panel-head' }, icon('eye'), h('h2', null, 'Released'), h('span', { class: 'badge' }, String(released.length))),
      h('div', { class: 'panel-body' }, released.length ? [releasedBar, h('ul', { class: 'dm-list', role: 'list' }, releasedShown.map(releasedRow))]
        : h('p', { class: 'muted ui text-sm' }, 'Nothing released yet. Released items show here; “Hide again” takes one back.'))));
}

function groups(list, row) {
  const by = new Map();
  for (const x of list) { if (!by.has(x.label)) by.set(x.label, []); by.get(x.label).push(x); }
  return [...by.entries()].map(([label, items]) => h('div', { class: 'dm-group' },
    h('h3', { class: 'dm-group-title' }, label, h('span', { class: 'dm-n' }, String(items.length))),
    h('ul', { class: 'dm-list', role: 'list' }, items.map(row))));
}

function hiddenRow(x) {
  return h('li', { class: 'dm-row' },
    icon(x.icon),
    h('span', { class: 'dm-row-main' },
      x.href ? h('a', { class: 'dm-row-title', href: x.href }, x.title) : h('span', { class: 'dm-row-title' }, x.title),
      h('span', { class: 'dm-row-meta muted' }, [x.hiddenAt ? `hidden ${fmtDate(x.hiddenAt)}` : '', x.dirty ? 'not saved yet' : ''].filter(Boolean).join(' · '))),
    h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => release(x) }, icon('eye'), 'Release'));
}

function releasedRow(x) {
  const gone = !store.has(x.path) && !isHidden(x.path) && !store.files(x.path).some((f) => f.path === x.path);
  return h('li', { class: 'dm-row' },
    icon(iconOf(x.label)),
    h('span', { class: 'dm-row-main' },
      x.href && !gone ? h('a', { class: 'dm-row-title', href: x.href }, x.title) : h('span', { class: 'dm-row-title' }, x.title),
      h('span', { class: 'dm-row-meta muted' }, [x.label, x.at ? `released ${fmtDate(x.at)}` : '', gone ? 'deleted since' : ''].filter(Boolean).join(' · '))),
    gone ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => hideAgain(x) }, icon('eye-off'), 'Hide again'));
}

async function release(x) {
  if (!(await confirmDialog(`Release “${x.title}”? Every player will see it and get a notification in their Inbox.`, { title: 'Release to the players?', okLabel: 'Release' }))) return;
  try {
    await releaseItem(x.path);
    saveSoon('DM release');
    toast(`Released “${x.title}”. The players have been notified.`, { type: 'success' });
  } catch (e) { toast(`Could not release it: ${e.message || e}`, { type: 'error' }); }
}

async function hideAgain(x) {
  try {
    await hideItem(x.path);
    saveSoon('DM hide');
    toast(`“${x.title}” is hidden again. Players who already opened it may remember it, and it stays in the site’s history on GitHub.`, { timeout: 7000 });
  } catch (e) { toast(`Could not hide it: ${e.message || e}`, { type: 'error' }); }
}

/** Pick any public item a tab registered as hideable (quests, library items, notes, documents, places…). */
async function hideExisting() {
  const items = [];
  for (const k of hideableKinds()) {
    if (k.pickable === false) continue;
    for (const f of store.files(k.prefix)) {
      if (f.hidden || isHidden(f.path) || f.path.startsWith(`${DM_DIR}/`) || f.path.startsWith(`${INBOX_DIR}/`)) continue;
      if (k.accept && !k.accept(f.path)) continue;
      items.push({ path: f.path, ...describe(f.path) });
    }
  }
  const pick = await pickFromList({
    title: 'Hide an existing item', items, multi: true,
    empty: 'Nothing to hide.',
    render: (x) => h('span', { class: 'dm-pick' }, icon(x.icon), h('span', null, x.title), h('span', { class: 'muted' }, x.label)),
    search: (x) => `${x.title} ${x.label} ${x.path}`,
  });
  const list = [].concat(pick || []).filter(Boolean);
  if (!list.length) return;
  let n = 0;
  for (const x of list) {
    try { await hideItem(x.path); n += 1; } catch (e) { toast(`Could not hide “${x.title}”: ${e.message || e}`, { type: 'error' }); }
  }
  if (n) {
    saveSoon('DM hide');
    toast(`${n} item${n === 1 ? '' : 's'} hidden from the players. Earlier versions stay in the site’s history on GitHub.`, { timeout: 7000 });
  }
}

function changePassword() {
  const a = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const b = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const err = h('p', { class: 'dm-error', role: 'alert', hidden: true });
  openModal({
    title: 'Change the DM password',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted ui text-sm' }, 'Hidden items keep their encryption; only the password that unlocks them changes. Other devices in DM mode stay unlocked until locked.'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'New DM password'), a),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type it again'), b), err),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Change password', kind: 'primary',
      onClick: async () => {
        const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
        if (!a.value) return fail('Choose a password.');
        if (a.value !== b.value) return fail('The two passwords are not the same.');
        await changeDmPassword(a.value);
        a.value = ''; b.value = '';
        await saveNow({ message: 'Change the DM password' });
        toast('DM password changed.', { type: 'success' });
        return true;
      },
    }],
  });
}

function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; if (visible()) render(); });
}

export default {
  id: VIEW,
  title: 'DM Screen',
  icon: 'dm',
  mount(el) {
    root = h('div', { class: 'dm-screen' });
    el.append(root);
    onDm(schedule);
    store.on((ev) => {
      if (page === 'party') { if (isDm() && visible()) partyEvent(ev); return; } // the party page updates its cards in place
      const paths = ev.path ? [ev.path] : ev.paths || [];
      if (ev.type === 'load' || ev.type === 'saved' || paths.some((p) => p.startsWith(`${DM_DIR}/`))) schedule();
    });
  },
  show(route) {
    page = route?.parts?.[0] === 'party' ? 'party' : 'main';
    // The menu's DM Screen link goes back to the page last shown (e.g. the party, after opening a sheet from it)
    document.querySelector('.sb-tab[data-view="dm"]')?.setAttribute('href', page === 'party' ? '#/dm/party' : '#/dm');
    render();
    if (!isDm()) dmLogin().then((ok) => { if (ok) render(); else navigate('#/map', { replace: true }); });
  },
  hide() {
    stopParty();
    root?.closest('.view')?.classList.remove('is-party', 'is-party-scroll');
  },
};
