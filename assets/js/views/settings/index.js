// Settings: per-device preferences, saving behaviour, session.
import { h, mount } from '../../core/dom.js';
import { field, input, checkbox, select, numberInput, toast, confirmDialog } from '../../core/ui.js';
import { getSetting, setSetting, applyTheme } from '../../core/settings.js';
import { store } from '../../core/store.js';
import { clearAuth } from '../../core/vault.js';

let root;

function render() {
  const dirty = store.dirtyPaths();
  mount(root,
    h('header', { class: 'set-head' }, h('h1', null, 'Settings'), h('p', { class: 'muted' }, 'These preferences are stored on this device only.')),
    h('section', { class: 'panel stack set-section' },
      h('h2', null, 'You'),
      field('Your name', input({ value: getSetting('playerName'), placeholder: 'e.g. Mira', onchange: (e) => { setSetting('playerName', e.target.value.trim()); toast('Name saved.'); } }),
        'Shown as the author of journal notes and in commit messages.'),
      field('Theme', select([{ value: 'light', label: 'Vellum (light)' }, { value: 'dark', label: 'Night (dark)' }], getSetting('theme'), (v) => { setSetting('theme', v); applyTheme(v); })),
    ),
    h('section', { class: 'panel stack set-section' },
      h('h2', null, 'Saving'),
      h('p', { class: 'muted' }, 'Every edit is kept on this device as you type. Saving commits your changes to the repository so the whole party sees them.'),
      field('Save automatically every this many minutes', numberInput(getSetting('autoSaveMinutes'), (v) => { setSetting('autoSaveMinutes', Math.max(0, v ?? 0)); render(); }, { min: 0, step: 5 }),
        'Unsaved changes are committed at most this long after you make them. Set to 0 to save only when you press Save.'),
      checkbox(getSetting('autoCommit'), (v) => { setSetting('autoCommit', v); store.scheduleAutoCommit(); render(); }, 'Also save shortly after each edit'),
      getSetting('autoCommit')
        ? field('Wait this many seconds after the last edit', numberInput(getSetting('autoCommitDelay'), (v) => setSetting('autoCommitDelay', Math.max(15, v || 60)), { min: 15, step: 5 }))
        : null,
      !getSetting('autoCommit') && !(Number(getSetting('autoSaveMinutes')) > 0)
        ? field('Remind me to save after this many minutes', numberInput(getSetting('saveReminder'), (v) => setSetting('saveReminder', Math.max(0, v ?? 0)), { min: 0, step: 5 }), 'Set to 0 to turn reminders off.')
        : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { const p = await store.pull(); toast(p.length ? `Fetched ${p.length} updated file(s).` : 'Already up to date.'); } catch (e) { toast(e.message, { type: 'error' }); } } }, 'Fetch latest now'),
        h('button', {
          class: 'btn btn-danger', type: 'button', disabled: !dirty.length,
          onclick: async () => {
            if (await confirmDialog(`Throw away ${dirty.length} unsaved change(s) on this device?`, { okLabel: 'Discard', danger: true })) {
              await store.discard(); toast('Local changes discarded.'); render();
            }
          },
        }, 'Discard unsaved changes')),
      dirty.length ? h('details', null, h('summary', null, `${dirty.length} unsaved file(s)`), h('ul', null, dirty.map((p) => h('li', null, h('code', null, p))))) : null,
    ),
    h('section', { class: 'panel stack set-section' },
      h('h2', null, 'Session'),
      h('p', null, store.mode === 'sandbox'
        ? 'Sandbox mode: nothing leaves this browser.'
        : `Connected to ${store.scope} on GitHub.`),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            if (store.isDirty() && !(await confirmDialog('You have unsaved changes. They stay on this device as drafts. Lock anyway?', { okLabel: 'Lock' }))) return;
            clearAuth(); location.href = location.pathname;
          },
        }, 'Lock the site on this device')),
    ),
    h('section', { class: 'panel stack set-section' },
      h('h2', null, 'About'),
      h('p', null, 'Rules content: System Reference Document 5.2 by Wizards of the Coast, CC-BY-4.0. ',
        h('a', { href: 'srd/LICENSE-SRD.md', target: '_blank', rel: 'noopener' }, 'Attribution')),
      h('p', { class: 'muted' }, 'Non-SRD entries marked “stub” are short summaries written for this site; consult your own books for full text.'),
    ),
  );
}

export default {
  id: 'settings',
  title: 'Settings',
  icon: 'settings',
  mount(el) { root = h('div', { class: 'set-page' }); el.append(root); store.on((e) => { if (!root.isConnected || root.closest('[hidden]')) return; if (['saved', 'pulled', 'put', 'remove'].includes(e.type)) render(); }); },
  show() { render(); },
};
