// Settings: per-device preferences, saving behavior, session.
import { h, mount } from '../../core/dom.js';
import { input, select, numberInput, icon, toast, confirmDialog } from '../../core/ui.js';
import { getSetting, setSetting, applyTheme } from '../../core/settings.js';
import { store } from '../../core/store.js';
import { clearAuth } from '../../core/vault.js';
import { lockDm } from '../../core/dm.js';

let root;

// A panel: icon + title in the head, then lines separated by rules.
const section = (iconName, title, ...lines) => h('section', { class: 'panel set-section' },
  h('header', { class: 'panel-head' }, icon(iconName), h('h2', { class: 'panel-title' }, title)),
  h('div', { class: 'set-body' }, lines));

// One setting per line: label and hint on the left, the control on the right (stacked on phones).
const line = (label, control, hint, { check = false } = {}) => h('label', { class: ['set-row', check && 'set-row-check'] },
  h('span', { class: 'set-row-text' }, h('span', { class: 'set-row-label' }, label), hint ? h('span', { class: 'field-hint' }, hint) : null),
  h('span', { class: 'set-row-ctl' }, control));

const withUnit = (control, unit) => h('span', { class: 'set-num' }, control, h('span', { class: 'set-unit' }, unit));
const toggle = (checked, onchange) => h('input', { type: 'checkbox', class: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) });

function render() {
  const dirty = store.dirtyPaths();
  const auto = Number(getSetting('autoSaveMinutes')) > 0;
  mount(root,
    h('header', { class: 'set-head' }, h('h1', null, 'Settings'), h('p', { class: 'muted' }, 'These preferences are stored on this device only.')),
    section('user', 'You',
      line('Your name', input({ value: getSetting('playerName'), placeholder: 'e.g. Mira', onchange: (e) => { setSetting('playerName', e.target.value.trim()); toast('Name saved.'); } }),
        'Shown as the author of journal notes and in commit messages.'),
      line('Theme', select([{ value: 'light', label: 'Vellum (light)' }, { value: 'dark', label: 'Night (dark)' }], getSetting('theme'), (v) => { setSetting('theme', v); applyTheme(v); }))),
    section('save', 'Saving',
      h('p', { class: 'set-intro' }, 'Every edit is kept on this device as you type. Saving commits your changes to the repository so the whole party sees them.'),
      line('Save automatically every', withUnit(numberInput(getSetting('autoSaveMinutes'), (v) => { setSetting('autoSaveMinutes', Math.max(0, v ?? 0)); render(); }, { min: 0, step: 5 }), 'minutes'),
        'Unsaved changes are committed at most this long after you make them. 0 saves only when you press Save.'),
      line('Save uploads and big changes right away', toggle(getSetting('saveMajorNow'), (v) => setSetting('saveMajorNow', v)),
        'Uploaded files and portraits, new or deleted places, maps, characters and library entries, and finished map edits are committed a moment later. Small edits, like typing a description, still follow the timer above.',
        { check: true }),
      line('Also save shortly after each edit', toggle(getSetting('autoCommit'), (v) => { setSetting('autoCommit', v); store.scheduleAutoCommit(); render(); }), null, { check: true }),
      getSetting('autoCommit')
        ? line('Wait after the last edit', withUnit(numberInput(getSetting('autoCommitDelay'), (v) => setSetting('autoCommitDelay', Math.max(15, v || 60)), { min: 15, step: 5 }), 'seconds'))
        : null,
      !getSetting('autoCommit') && !auto
        ? line('Remind me to save after', withUnit(numberInput(getSetting('saveReminder'), (v) => setSetting('saveReminder', Math.max(0, v ?? 0)), { min: 0, step: 5 }), 'minutes'), '0 turns reminders off.')
        : null,
      h('div', { class: 'set-actions' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { const p = await store.pull(); toast(p.length ? `Fetched ${p.length} updated file(s).` : 'Already up to date.'); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('refresh'), 'Fetch latest now'),
        h('button', {
          class: 'btn btn-danger', type: 'button', disabled: !dirty.length,
          onclick: async () => {
            if (await confirmDialog(`Throw away ${dirty.length} unsaved change(s) on this device?`, { okLabel: 'Discard', danger: true })) {
              await store.discard(); toast('Local changes discarded.'); render();
            }
          },
        }, icon('undo'), 'Discard unsaved changes')),
      dirty.length ? h('details', { class: 'set-dirty' }, h('summary', null, `${dirty.length} unsaved file(s)`), h('ul', null, dirty.map((p) => h('li', null, h('code', null, p))))) : null),
    section('lock', 'Session',
      h('div', { class: 'set-split' },
        h('p', null, store.mode === 'sandbox' ? 'Sandbox mode: nothing leaves this browser.' : `Connected to ${store.scope} on GitHub.`,
          ' Locking forgets the login on this device (and DM mode), so the site asks for the password again. Unsaved changes stay here as drafts.'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            if (store.isDirty() && !(await confirmDialog('You have unsaved changes. They stay on this device as drafts. Lock anyway?', { okLabel: 'Lock' }))) return;
            await lockDm(); // a remembered DM login goes too, or the next person to enter would be the DM
            clearAuth(); location.href = location.pathname;
          },
        }, icon('lock'), 'Lock the site on this device'))),
    section('info', 'About',
      h('div', { class: 'set-text' },
        h('p', null, 'Rules content: System Reference Document 5.2 by Wizards of the Coast, CC-BY-4.0. ',
          h('a', { href: 'srd/LICENSE-SRD.md', target: '_blank', rel: 'noopener' }, 'Attribution')),
        h('p', { class: 'muted' }, 'Non-SRD entries marked “stub” are short summaries written for this site; consult your own books for full text.'))),
  );
}

export default {
  id: 'settings',
  title: 'Settings',
  icon: 'settings',
  mount(el) { root = h('div', { class: 'set-page' }); el.append(root); store.on((e) => { if (!root.isConnected || root.closest('[hidden]')) return; if (['saved', 'pulled', 'put', 'remove'].includes(e.type)) render(); }); },
  show() { render(); },
};
