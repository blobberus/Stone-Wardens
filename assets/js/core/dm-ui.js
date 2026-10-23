// DM mode controls shared by the shell and the tabs (docs/dm-mode.md):
//   wireDmShell()        the "New: hidden" switch above Save (DM mode only), the Inbox item above Settings
//   dmLogin()            the DM password dialog (log in, or set up the first time); Settings → DM mode opens it
//   visibilityToggle()   the noticeable "Hidden from players" / "Visible to players" switch on an item (DM mode only)
//   hiddenChoice()       the same switch inside a "create" form, before the item exists
//   hiddenMark()         a small lock beside a hidden item in a list (DM mode only)
// Inbox: notifications of released items (content/inbox/), shown for 14 days; read state is per device.
import { h, $, mount } from './dom.js';
import { icon, toast, openModal, confirmDialog } from './ui.js';
import { store } from './store.js';
import { saveNow, saveSoon } from './saving.js';
import {
  isDm, isHidden, onDm, dmConfigured, setupDm, unlockDm, dmNewHidden, setDmNewHidden, hideItem, releaseItem, describe,
  isHideablePath, INBOX_DIR, dmBusy,
} from './dm.js';

const INBOX_KEY = 'sw:inbox'; // {seen: ISO time everything before is read, read: [id]}
const INBOX_DAYS = 14;

// ---------- log in / set up ----------

/** Ask for the DM password (or choose one the first time). Resolves true when DM mode is on. */
export function dmLogin() {
  if (isDm()) return Promise.resolve(true);
  return dmConfigured() ? unlockDialog() : setupDialog();
}

function passwordField(label, autocomplete) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label),
    h('input', { class: 'input', type: 'password', autocomplete, spellcheck: false, 'data-dm-pass': '' }));
}

function unlockDialog() {
  return new Promise((resolve) => {
    let ok = false;
    const err = h('p', { class: 'dm-error', role: 'alert', hidden: true });
    const pass = passwordField('DM password', 'current-password');
    const remember = h('label', { class: 'checkbox' }, h('input', { type: 'checkbox' }), h('span', null, 'Keep DM mode on this device'));
    const submit = async (m) => {
      const input = pass.querySelector('input');
      if (!input.value) return false;
      err.hidden = true;
      m.el.classList.add('is-busy');
      try {
        await unlockDm(input.value, { remember: remember.querySelector('input').checked });
        input.value = '';
        ok = true;
        toast('DM mode is on. Hidden items show with a lock; only you can see them.', { type: 'success', timeout: 5000 });
        return true;
      } catch (e) {
        err.textContent = e.message === 'bad-password' ? 'That is not the DM password.' : `Could not unlock: ${e.message || e}`;
        err.hidden = false;
        input.select();
        return false;
      } finally { m.el.classList.remove('is-busy'); }
    };
    const m = openModal({
      title: 'DM mode',
      body: h('form', { class: 'stack dm-login', onsubmit: (e) => { e.preventDefault(); submit(m).then((r) => r && m.close()); } },
        h('p', { class: 'muted ui text-sm' }, 'The DM sees and edits hidden quests, library items, notes and documents, and decides when players get them.'),
        pass, remember, err, h('button', { type: 'submit', hidden: true })),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Unlock', kind: 'primary', onClick: submit }],
      onClose: () => resolve(ok),
    });
  });
}

function setupDialog() {
  return new Promise((resolve) => {
    let ok = false;
    const err = h('p', { class: 'dm-error', role: 'alert', hidden: true });
    const a = passwordField('Choose the DM password', 'new-password');
    const b = passwordField('Type it again', 'new-password');
    const submit = async (m) => {
      const [p1, p2] = [a, b].map((x) => x.querySelector('input').value);
      const fail = (msg) => { err.textContent = msg; err.hidden = false; return false; };
      if (!p1) return fail('Choose a password.');
      if (p1 !== p2) return fail('The two passwords are not the same.');
      m.el.classList.add('is-busy');
      try {
        await setupDm(p1);
        a.querySelector('input').value = '';
        b.querySelector('input').value = '';
        ok = true;
        await saveNow({ message: 'Set up DM mode' }); // other devices need the vault to unlock
        toast('DM mode is set up and on.', { type: 'success' });
        return true;
      } catch (e) {
        return fail(`Could not set up DM mode: ${e.message || e}`);
      } finally { m.el.classList.remove('is-busy'); }
    };
    const m = openModal({
      title: 'Set up DM mode',
      body: h('form', { class: 'stack dm-login', onsubmit: (e) => { e.preventDefault(); submit(m).then((r) => r && m.close()); } },
        h('p', { class: 'ui text-sm' }, 'Choose the password that unlocks the DM view. Hidden items are encrypted with it, so they stay secret even though the site’s files are public.'),
        h('ul', { class: 'ui text-sm dm-notes' },
          h('li', null, 'Only you should know it. It is never stored, and it can’t be recovered: without it, hidden items can’t be opened.'),
          h('li', null, 'A long passphrase (several words) is much safer than one word: anyone who copies the site’s files could try to guess it.')),
        a, b, err, h('button', { type: 'submit', hidden: true })),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Set up and unlock', kind: 'primary', onClick: submit }],
      onClose: () => resolve(ok),
    });
  });
}

// ---------- shell: the "New: hidden" switch above Save, inbox above Settings ----------
// Logging in as the DM is in Settings → DM mode; once on, the DM Screen tab shows in the menu.

export function wireDmShell() {
  const sb = $('#sidebar');
  const foot = $('.sb-footer', sb);
  const block = h('div', { class: 'sb-dm' });
  foot.prepend(block);
  const dmTab = $('.sb-tab[data-view="dm"]', sb)?.closest('li');
  const draw = () => {
    const on = isDm();
    document.body.classList.toggle('is-dm', on);
    if (dmTab) dmTab.hidden = !on; // the DM Screen tab exists only for the DM (dm.css hides it too)
    block.hidden = !on;
    mount(block,
      on ? h('button', {
        class: ['btn', 'btn-sm', 'sb-dm-new', dmNewHidden() && 'is-hidden'], type: 'button', 'aria-pressed': String(dmNewHidden()),
        title: dmNewHidden() ? 'What you create now starts hidden from players (click to change)' : 'What you create now is visible to players at once (click to change)',
        onclick: () => setDmNewHidden(!dmNewHidden()),
      }, icon(dmNewHidden() ? 'eye-off' : 'eye'), h('span', { class: 'sb-label' }, dmNewHidden() ? 'New: hidden' : 'New: visible')) : null);
  };
  onDm(draw);
  draw();
  wireInbox(sb);
}

// ---------- inbox ----------

function inboxState() {
  try { const v = JSON.parse(localStorage.getItem(INBOX_KEY) || '{}'); return { seen: v.seen || '', read: Array.isArray(v.read) ? v.read : [] }; } catch { return { seen: '', read: [] }; }
}
function setInboxState(v) { try { localStorage.setItem(INBOX_KEY, JSON.stringify(v)); } catch { /* private mode */ } }

/** Notifications of the last INBOX_DAYS days, newest first, with unread flags. */
export function notifications() {
  const cutoff = Date.now() - INBOX_DAYS * 864e5;
  const st = inboxState();
  const read = new Set(st.read);
  return store.list(INBOX_DIR).map((x) => x.data).filter((n) => n && n.id && Date.parse(n.at) >= cutoff)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((n) => ({ ...n, unread: !(st.seen && n.at <= st.seen) && !read.has(n.id) }));
}

function markRead(id) {
  const st = inboxState();
  if (!st.read.includes(id)) setInboxState({ ...st, read: [...st.read, id].slice(-200) });
}
function markAllRead() { setInboxState({ seen: new Date().toISOString(), read: [] }); }

function wireInbox(sb) {
  const tabs = $('.sb-tabs-bottom', sb);
  const badge = h('span', { class: 'sb-badge', hidden: true });
  const btn = h('button', { class: 'sb-tab sb-inbox', type: 'button', title: 'Inbox: what the DM has released', onclick: () => openInbox(refresh) },
    icon('inbox'), h('span', { class: 'sb-label' }, 'Inbox'), badge);
  // at the bottom of the menu, right above Settings
  tabs.insertBefore(h('li', { class: 'sb-inbox-li' }, btn), $('.sb-tab[data-view="settings"]', tabs)?.closest('li') || null);
  const refresh = () => {
    const n = notifications().filter((x) => x.unread).length;
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `Inbox, ${n} unread` : 'Inbox');
  };
  store.on((ev) => {
    const paths = ev.path ? [ev.path] : ev.paths || [];
    if (ev.type === 'load' || paths.some((p) => p.startsWith(`${INBOX_DIR}/`))) refresh();
  });
  refresh();
}

function openInbox(refresh) {
  const list = h('div', { class: 'dm-inbox' });
  const draw = () => {
    const all = notifications();
    mount(list, all.length ? h('ul', { class: 'dm-inbox-list', role: 'list' }, all.map((n) => h('li', { class: ['dm-note', n.unread && 'is-unread'] },
      h(n.href ? 'a' : 'div', {
        class: 'dm-note-link', href: n.href || null,
        onclick: () => { markRead(n.id); refresh(); m.close(); },
      },
      h('span', { class: 'dm-note-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'dm-note-text' },
        h('strong', null, n.title || 'Something new'),
        h('span', { class: 'muted' }, ` · new ${String(n.label || 'entry').toLowerCase()}`),
        h('span', { class: 'dm-note-when muted' }, when(n.at))),
      n.unread ? h('span', { class: 'sr-only' }, ' (unread)') : null))))
      : h('p', { class: 'muted ui text-sm' }, 'Nothing new. When the DM releases a quest, a document or anything else, it shows up here with a link to it.'));
  };
  const m = openModal({
    title: 'Inbox',
    body: list,
    actions: [{ label: 'Mark all read', kind: 'ghost', onClick: () => { markAllRead(); refresh(); draw(); return false; } }, { label: 'Close', kind: 'primary' }],
  });
  draw();
}

function when(at) {
  const t = Date.parse(at);
  if (!t) return '';
  const days = Math.floor((Date.now() - t) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

// ---------- per item ----------

/**
 * The noticeable hidden / visible switch of an item, for its page or editor; null outside DM mode or for items that
 * can't be hidden. path: the item's path (or a function returning it). Hiding seals it at once; making it visible
 * releases it (players get a notification), after a confirmation. The switch redraws itself after a change (views
 * that re-render anyway simply drop it). opts.small: false = full button size, for a row of full-size buttons.
 */
export function visibilityToggle(path, opts = {}) {
  const { label = 'this', onChange, before, small = true } = opts;
  const p = typeof path === 'function' ? path() : path;
  if (!isDm() || !p || !isHideablePath(p)) return null;
  const hidden = isHidden(p);
  const self = h('button', {
    class: ['btn', small && 'btn-sm', 'dm-vis', hidden ? 'is-hidden' : 'is-visible'], type: 'button', 'aria-pressed': String(hidden), disabled: dmBusy(p), // redrawn mid-change: wait
    title: hidden ? `Only you can see ${label}. Click to release it to the players.` : `Players can see ${label}. Click to hide it.`,
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      let done = false;
      try {
        await before?.(); // e.g. an editor writes its pending draft first
        if (hidden) {
          const name = describe(p).title;
          if (!(await confirmDialog(`Release “${name}”? Every player will see it and get a notification in their Inbox.`, { title: 'Release to the players?', okLabel: 'Release' }))) return;
          await releaseItem(p);
          saveSoon('DM release');
          toast(`Released “${name}”. The players have been notified.`, { type: 'success' });
        } else {
          await hideItem(p);
          saveSoon('DM hide');
          toast('Hidden from the players. Earlier versions stay in the site’s history on GitHub.', { timeout: 6000 });
        }
        if (self.isConnected) self.replaceWith(visibilityToggle(path, opts) || '');
        done = true;
        onChange?.(!hidden);
      } catch (err) {
        toast(`Could not change it: ${err.message || err}`, { type: 'error' });
      } finally {
        btn.disabled = false;
        if (!done && !self.isConnected) onChange?.(hidden); // the view redrew this switch meanwhile (disabled): draw it again
      }
    },
  }, icon(hidden ? 'eye-off' : 'eye'), hidden ? 'Hidden from players' : 'Visible to players');
  return self;
}

/**
 * The same switch inside a form that creates an item (DM mode only, else null). state = {hidden}; it starts at the
 * DM's default (DM Screen setting) and the form reads state.hidden when it creates the item.
 */
export function hiddenChoice(state) {
  if (!isDm()) return null;
  if (state.hidden == null) state.hidden = dmNewHidden();
  const btn = h('button', { type: 'button', class: 'btn btn-sm dm-vis', onclick: () => { state.hidden = !state.hidden; draw(); } });
  const draw = () => {
    btn.className = `btn btn-sm dm-vis ${state.hidden ? 'is-hidden' : 'is-visible'}`;
    btn.setAttribute('aria-pressed', String(state.hidden));
    mount(btn, icon(state.hidden ? 'eye-off' : 'eye'), state.hidden ? 'Hidden from players' : 'Visible to players');
    btn.title = state.hidden ? 'Only you will see it until you release it from the DM Screen' : 'Players see it at once';
  };
  draw();
  return h('div', { class: 'dm-choice' }, btn, h('span', { class: 'muted ui text-xs' }, 'DM mode'));
}

/** A small lock for a hidden item in a list (DM mode only). */
export const hiddenMark = (path) => (isDm() && isHidden(path)
  ? h('span', { class: 'dm-mark', title: 'Hidden from players', role: 'img', 'aria-label': 'Hidden from players' }, icon('eye-off'))
  : null);
