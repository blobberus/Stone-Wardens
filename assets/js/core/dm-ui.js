// DM mode controls shared by the shell and the tabs (docs/dm-mode.md):
//   wireDmShell()        the "New: hidden" switch above Save (DM mode only), the Inbox item above Settings
//   dmLogin()            the DM password dialog (log in, or set up the first time); Settings → DM mode opens it
//   visibilityToggle()   the noticeable "Hidden from players" / "Visible to players" switch on an item (DM mode only)
//   hiddenChoice()       the same switch inside a "create" form, before the item exists
//   hiddenMark()         a small lock beside a hidden item in a list (DM mode only)
// Inbox: notifications of released items (content/inbox/), shown for 14 days; read and cleared state is per device.
import { h, $, mount } from './dom.js';
import { icon, toast, openModal, confirmDialog } from './ui.js';
import { store } from './store.js';
import { saveNow, saveSoon } from './saving.js';
import {
  isDm, isHidden, onDm, dmConfigured, setupDm, unlockDm, dmNewHidden, setDmNewHidden, hideItem, releaseItem, describe,
  isHideablePath, INBOX_DIR, dmBusy, releasePlan, releaseChoices,
} from './dm.js';

const INBOX_KEY = 'sw:inbox'; // {seen: ISO time everything before is read, read: [id], cleared: ISO time everything before is off the list}
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
  try {
    const v = JSON.parse(localStorage.getItem(INBOX_KEY) || '{}');
    return { seen: v.seen || '', read: Array.isArray(v.read) ? v.read : [], cleared: v.cleared || '' };
  } catch { return { seen: '', read: [], cleared: '' }; }
}
function setInboxState(v) { try { localStorage.setItem(INBOX_KEY, JSON.stringify(v)); } catch { /* private mode */ } }

/** Notifications of the last INBOX_DAYS days not cleared on this device, newest first, with unread flags. */
export function notifications() {
  const cutoff = Date.now() - INBOX_DAYS * 864e5;
  const st = inboxState();
  const read = new Set(st.read);
  return store.list(INBOX_DIR).map((x) => x.data).filter((n) => n && n.id && Date.parse(n.at) >= cutoff)
    .filter((n) => !(st.cleared && n.at <= st.cleared))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((n) => ({ ...n, unread: !(st.seen && n.at <= st.seen) && !read.has(n.id) }));
}

function markRead(id) {
  const st = inboxState();
  if (!st.read.includes(id)) setInboxState({ ...st, read: [...st.read, id].slice(-200) });
}
function markAllRead() { setInboxState({ ...inboxState(), seen: new Date().toISOString(), read: [] }); }
// Clear the list on this device: up to the newest one shown (its time is the DM's clock, as later ones will be).
// The shared files stay, for the other players. Returns the state before, for Undo.
function clearAll(shown) {
  const st = inboxState();
  if (shown.length) setInboxState({ ...st, cleared: shown[0].at });
  return st;
}

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
  let before = null; // the state before Clear all, while Undo is offered
  const draw = () => {
    const all = notifications();
    const [clearBtn, readBtn] = m.el.querySelectorAll('.modal-foot .btn');
    clearBtn.disabled = !all.length;
    readBtn.disabled = !all.some((n) => n.unread);
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
      : before ? h('p', { class: 'muted ui text-sm dm-inbox-cleared' },
        'Cleared on this device. The items stay on the site, and new releases will show up here. ',
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { setInboxState(before); before = null; refresh(); draw(); } }, 'Undo'))
      : h('p', { class: 'muted ui text-sm' }, 'Nothing new. When the DM releases a quest, a document or anything else, it shows up here with a link to it.'));
  };
  const m = openModal({
    title: 'Inbox',
    body: list,
    className: 'dm-inbox-modal',
    actions: [
      { label: 'Clear all', kind: 'ghost', onClick: () => { before = clearAll(notifications()); refresh(); draw(); return false; } },
      { label: 'Mark all read', kind: 'ghost', onClick: () => { markAllRead(); refresh(); draw(); return false; } },
      { label: 'Close', kind: 'primary' },
    ],
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
 * Ask the DM before releasing a hidden item (the switch and the DM Screen's Release). Resolves the options for
 * releaseItem, or null: canceled, or it can't be released on its own (a toast says why). An item that can only be
 * released in another form (a map inside a hidden map: as a map of its own) asks that question instead. An item with
 * choices (releaseChoices: a map's hidden places) asks with a checklist: those that would come along are ticked,
 * those hidden on their own not; all the ticked ones go out with it under one notification ({also, keep, extra}).
 */
export async function askRelease(path, name = describe(path).title) {
  const plan = releasePlan(path);
  if (plan.blocked) { toast(plan.blocked, { type: 'error', timeout: 7000 }); return null; }
  const title = (plan.question && plan.title) || 'Release to the players?';
  const okLabel = (plan.question && plan.okLabel) || 'Release';
  const as = plan.question ? { as: true } : {};
  const ask = plan.question || `Release “${name}”?`;
  const { items, one, many } = releaseChoices(path);
  if (!items.length) {
    return (await confirmDialog(`${ask} Every player will see it and get a notification in their Inbox.`, { title, okLabel })) ? as : null;
  }
  const count = (k) => `${k} ${k === 1 ? one : many}`;
  const picked = await pickToRelease({
    title,
    intro: `${ask} Every player will see it, with the ${many} you tick below, and get one notification in their Inbox for all of it.`,
    heading: `Hidden ${many} on it`,
    items: items.map((x) => ({ path: x.path, title: x.title, checked: x.along, note: x.along ? '' : 'hidden on its own' })),
    okLabel: (k) => (k ? `${okLabel} with ${count(k)}` : okLabel),
    footnote: `Unticked ${many} stay hidden; you can release them later.`,
  });
  if (!picked) return null;
  return {
    ...as,
    also: items.filter((x) => !x.along && picked.has(x.path)).map((x) => x.path),
    keep: items.filter((x) => x.along && !picked.has(x.path)).map((x) => x.path),
    extra: picked.size ? count(picked.size) : '',
  };
}

/** The toast after a release (askRelease's answer says what went with it). */
export const releasedText = (name, how) => `Released “${name}”${how?.extra ? ` with ${how.extra}` : ''}. The players have been notified.`;

/**
 * A checklist of hidden items to release together (a map's release: its places; the map's ⋯ → Reveal hidden places).
 * items: [{path, title, checked, note}]; okLabel(n) names the button for n ticked. A filter shows for long lists.
 * -> Promise<Set of the ticked paths, or null when canceled>.
 */
export function pickToRelease({ title, intro, heading, items, okLabel, footnote = '' }) {
  return new Promise((resolve) => {
    const picked = new Set(items.filter((x) => x.checked).map((x) => x.path));
    let result = null;
    let m = null;
    const count = h('span', { class: 'dm-rel-count muted ui text-xs', 'aria-live': 'polite' });
    const sync = () => {
      count.textContent = `${picked.size} of ${items.length} ticked`;
      const btn = m?.el.querySelector('.modal-foot .btn-primary');
      if (btn) btn.textContent = okLabel(picked.size);
    };
    const rows = items.map((x) => {
      const box = h('input', {
        type: 'checkbox', checked: picked.has(x.path),
        onchange: (e) => { if (e.target.checked) picked.add(x.path); else picked.delete(x.path); sync(); },
      });
      return { x, box, row: h('li', null, h('label', { class: 'checkbox dm-rel-item' }, box,
        h('span', null, x.title, x.note ? h('small', { class: 'muted' }, ` · ${x.note}`) : null))) };
    });
    const setAll = (on) => {
      for (const r of rows) {
        if (r.row.hidden) continue; // only what the filter shows
        r.box.checked = on;
        if (on) picked.add(r.x.path); else picked.delete(r.x.path);
      }
      sync();
    };
    const filter = items.length > 8 ? h('input', {
      class: 'input dm-rel-filter', type: 'search', placeholder: 'Find…', 'aria-label': 'Find in the list',
      oninput: (e) => { const q = e.target.value.trim().toLowerCase(); for (const r of rows) r.row.hidden = !!q && !r.x.title.toLowerCase().includes(q); },
    }) : null;
    m = openModal({
      title,
      className: 'dm-rel-modal',
      body: h('div', { class: 'stack dm-rel' },
        h('p', null, intro),
        h('div', { class: 'dm-rel-head' },
          h('strong', { class: 'ui text-sm' }, heading), count,
          h('span', { class: 'dm-rel-all' },
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setAll(true) }, 'Tick all'),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setAll(false) }, 'Untick all'))),
        filter,
        h('ul', { class: 'dm-rel-list', role: 'list' }, rows.map((r) => r.row)),
        footnote ? h('p', { class: 'muted ui text-xs' }, footnote) : null),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: okLabel(picked.size), kind: 'primary', onClick: () => { result = picked; } }],
      onClose: () => resolve(result),
    });
    sync();
  });
}

/**
 * The noticeable hidden / visible switch of an item, for its page or editor; null outside DM mode or for items that
 * can't be hidden. path: the item's path (or a function returning it). Hiding seals it at once (opts.confirmHide() ->
 * a question asks first, for big ones like the main map); making it visible releases it (players get a notification),
 * after a confirmation. The switch redraws itself after a change (views that re-render anyway simply drop it).
 * opts.small: false = full button size, for a row of full-size buttons.
 */
export function visibilityToggle(path, opts = {}) {
  const { label = 'this', onChange, before, small = true, confirmHide } = opts;
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
          const how = await askRelease(p, name);
          if (!how) return;
          await releaseItem(p, how);
          saveSoon('DM release');
          toast(releasedText(name, how), { type: 'success' });
        } else {
          const ask = confirmHide?.();
          if (ask && !(await confirmDialog(ask, { title: 'Hide from the players?', okLabel: 'Hide' }))) return;
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
