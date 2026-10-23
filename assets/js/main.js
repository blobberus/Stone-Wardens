// Boot: password gate -> load repo content -> mount the tabbed shell.
import { store } from './core/store.js';
import { GitHubBackend } from './core/github.js';
import { SandboxBackend } from './core/sandbox.js';
import { fetchVault, openVault, saveAuth, loadAuth, clearAuth } from './core/vault.js';
import { registerView, start, allViews, onRoute } from './core/router.js';
import { applyTheme, getSetting, setSetting } from './core/settings.js';
import { h, $, clear } from './core/dom.js';
import { icon, toast, choiceDialog } from './core/ui.js';
import { preloadAll } from './core/compendium.js';
import { setSaveHandler } from './core/saving.js';
import { restoreDm } from './core/dm.js';
import { wireDmShell } from './core/dm-ui.js';

const VIEW_IDS = ['map', 'characters', 'journal', 'quests', 'compendium', 'wardens-library', 'dm', 'settings'];
const isLocalhost = ['localhost', '127.0.0.1', ''].includes(location.hostname);

applyTheme();
boot();

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('sandbox')) return enter(new SandboxBackend(), 'sandbox');
  const saved = loadAuth();
  if (saved?.token) {
    try { return await enter(new GitHubBackend(saved), `${saved.owner}/${saved.repo}`); }
    catch (e) {
      console.error(e);
      if (e.status === 401) clearAuth();
      return showGate(e.message);
    }
  }
  return showGate();
}

// ---------- gate ----------

async function showGate(error) {
  const gate = $('#gate');
  const form = $('#gate-form');
  const pass = $('#gate-pass');
  const err = $('.gate-error', gate);
  const note = $('.gate-note', gate);
  const btn = $('.gate-enter', gate);
  gate.hidden = false;
  $('#app').hidden = true;
  const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
  showError(error || '');

  const vault = await fetchVault();
  if (!vault) {
    pass.disabled = true;
    btn.disabled = true;
    clear(note).append(
      'This site has not been set up yet. The repo owner needs to open ',
      h('a', { href: 'setup.html' }, 'setup'),
      ' to create the password.',
      isLocalhost ? h('span', null, ' Or try the ', h('a', { href: '?sandbox' }, 'local sandbox'), '.') : null,
    );
    return;
  }
  pass.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!pass.value) return;
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    showError('');
    try {
      const secret = await openVault(vault, pass.value);
      const auth = { branch: 'main', ...vault.repo, ...secret };
      saveAuth(auth, $('#gate-remember').checked);
      pass.value = '';
      await enter(new GitHubBackend(auth), `${auth.owner}/${auth.repo}`);
    } catch (ex) {
      if (ex.message !== 'bad-password') console.error(ex);
      if (ex.status === 401) clearAuth();
      showError(ex.message === 'bad-password' ? 'That is not the password. The wardens keep their counsel.' : ex.message);
      pass.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enter';
    }
  };
}

// ---------- app ----------

async function enter(backend, scope) {
  store.use(backend, scope);
  $('#gate').hidden = true;
  const app = $('#app');
  app.hidden = false;
  const viewsEl = $('#views');
  const loading = h('div', { class: 'app-loading' }, h('p', null, 'Unrolling the maps…'));
  viewsEl.append(loading);
  try {
    await store.load();
  } catch (e) {
    loading.remove();
    app.hidden = true;
    $('#gate').hidden = false; // back to the gate so the error is visible
    throw e;
  }
  loading.remove();
  preloadAll().catch((e) => console.warn(e));
  await loadViews();
  buildSidebar();
  wireSaving();
  wireDmShell();
  await restoreDm(); // DM mode stays on in this tab (or on this device) until locked
  start(viewsEl, { defaultView: 'map' });
  if (store.mode === 'sandbox') toast('Sandbox mode: changes stay in this browser only.', { timeout: 6000 });
}

async function loadViews() {
  const home = loadHome();
  await Promise.all(VIEW_IDS.map(async (id, i) => {
    try {
      const mod = await import(`./views/${id}/index.js`);
      registerView({ order: i * 10, ...mod.default });
    } catch (e) {
      console.error(`[main] view ${id} failed to load`, e);
      registerView({
        id, order: i * 10, title: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), icon: 'warning',
        mount: (el) => el.append(h('div', { class: 'empty-state' }, h('h2', null, 'This tab failed to load'), h('p', { class: 'muted' }, String(e.message || e)))),
      });
    }
  }));
  await home;
}

// Landing page (views/home, #/home): no sidebar tab, the sidebar title opens it. On this device's first visit a URL
// without a route is sent there before the router starts (routeFirstVisit); deep links still go where they point.
async function loadHome() {
  try {
    const mod = await import('./views/home/index.js');
    registerView(mod.default);
    mod.routeFirstVisit();
  } catch (e) { console.error('[main] landing page failed to load', e); }
}

function buildSidebar() {
  const sb = $('#sidebar');
  const top = $('.sb-tabs:not(.sb-tabs-bottom)', sb);
  const bottom = $('.sb-tabs-bottom', sb);
  clear(top); clear(bottom);
  for (const v of allViews()) {
    if (v.menu === false) continue; // e.g. the landing page, opened from the sidebar title
    const a = h('a', { class: 'sb-tab', href: `#/${v.id}`, 'data-view': v.id, title: v.title }, icon(v.icon || 'file'), h('span', { class: 'sb-label' }, v.title));
    (v.id === 'settings' ? bottom : top).append(h('li', null, a));
  }
  const collapsed = getSetting('sidebarCollapsed');
  sb.classList.toggle('is-collapsed', !!collapsed);
  const toggle = $('.sb-toggle', sb);
  const brand = $('.sb-title', sb); // links to the landing page (#/home)
  brand.onclick = () => sb.classList.remove('is-open'); // closes the phone sheet, also when already there
  const narrow = () => matchMedia('(max-width: 760px)').matches;
  const setCollapsed = (c) => {
    sb.classList.toggle('is-collapsed', c);
    setSetting('sidebarCollapsed', c);
    window.dispatchEvent(new Event('resize')); // lets the map re-measure
  };
  toggle.onclick = () => {
    if (narrow()) { sb.classList.toggle('is-open'); return; }
    setCollapsed(!sb.classList.contains('is-collapsed'));
    hideHint();
  };

  // Character sheets are laid out for the collapsed rail: suggest it (once per session) when the menu is open.
  const HINT_KEY = 'sw:hint:sheet-menu';
  sb.querySelector('.sb-hint')?.remove();
  let hintTimer = 0;
  const hint = h('div', { class: 'sb-hint', role: 'status', hidden: true },
    h('p', null, 'Character sheets have more room with the menu collapsed.'),
    h('div', { class: 'sb-hint-actions' },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { setCollapsed(true); hideHint(); } }, 'Collapse menu'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { sessionStorage.setItem(HINT_KEY, '1'); hideHint(); } }, 'Not now')));
  $('.sb-brand', sb).after(hint);
  function hideHint() { clearTimeout(hintTimer); hint.hidden = true; }
  const maybeHint = (r) => {
    const onSheet = r.view === 'characters' && r.parts?.[0] && !['new', 'recently-deleted'].includes(r.parts[0]);
    if (!onSheet || narrow() || sb.classList.contains('is-collapsed') || sessionStorage.getItem(HINT_KEY)) { hideHint(); return; }
    toggle.classList.remove('is-hinting');
    void toggle.offsetWidth;
    toggle.classList.add('is-hinting');
    toggle.addEventListener('animationend', () => toggle.classList.remove('is-hinting'), { once: true });
    if (hint.hidden) { hint.hidden = false; hintTimer = setTimeout(hideHint, 15000); }
  };

  onRoute((r) => {
    sb.querySelectorAll('.sb-tab').forEach((a) => a.classList.toggle('is-active', a.dataset.view === r.view));
    if (r.view === 'home') brand.setAttribute('aria-current', 'page'); else brand.removeAttribute('aria-current');
    sb.classList.remove('is-open');
    maybeHint(r);
  });
}

// ---------- saving ----------

function wireSaving() {
  const status = $('.sb-status');
  const text = $('.sb-status-text');
  const btn = $('.sb-save');
  let lastError = null;

  const update = () => {
    const n = store.dirtyPaths().length;
    let state = n ? 'dirty' : 'clean';
    let label = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'All changes saved';
    if (store.saving) { state = 'saving'; label = 'Saving…'; }
    else if (lastError && n) { state = 'error'; label = 'Save failed — retry'; }
    if (store.mode === 'sandbox') label += ' (sandbox)';
    status.dataset.state = state;
    text.textContent = label;
    status.title = n ? store.dirtyPaths().map((p) => p.replace(/^content\//, '')).join('\n') : '';
    btn.disabled = !n || store.saving;
  };

  const save = async ({ auto = false, message } = {}) => {
    if (store.saving) return false;
    if (!store.isDirty()) return true;
    try {
      lastError = null;
      const r = await store.save(message);
      if (r.cancelled) return false;
      toast(`${auto ? 'Auto-saved' : 'Saved'} ${store.mode === 'sandbox' ? 'locally' : 'to the repository'}.`, { type: 'success' });
      return true;
    } catch (e) {
      console.error(e);
      lastError = e;
      toast(`Could not ${auto ? 'auto-save' : 'save'}: ${e.message}`, { type: 'error' });
      return false;
    } finally { update(); }
  };
  setSaveHandler(({ message } = {}) => save({ message })); // saveNow() / saveSoon() in core/saving.js

  store.conflictResolver = (paths) => choiceDialog(
    h('div', { class: 'stack' },
      h('p', null, 'Another Warden changed these since you opened them:'),
      h('ul', null, paths.map((p) => h('li', null, h('code', null, p.replace(/^content\//, ''))))),
      h('p', { class: 'muted' }, 'Overwrite replaces their version with yours. Keep theirs discards your edits to these files.')),
    [
      { label: 'Cancel', value: 'cancel', kind: 'ghost' },
      { label: 'Keep theirs', value: 'theirs', kind: 'ghost' },
      { label: 'Overwrite with mine', value: 'overwrite', kind: 'primary' },
    ],
    { title: 'Changes collided' },
  ).then((v) => v || 'cancel');

  store.on((ev) => {
    if (ev.type === 'error') { lastError = ev.error; toast(`Auto-save failed: ${ev.error.message}`, { type: 'error' }); }
    update();
  });
  btn.onclick = () => save();
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (store.isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Pick up other players' changes.
  let lastPull = Date.now();
  const pull = async () => {
    if (store.saving || document.visibilityState !== 'visible') return;
    lastPull = Date.now();
    try { await store.pull(); } catch (e) { console.warn('[pull]', e); }
  };
  setInterval(pull, 120000);
  window.addEventListener('focus', () => { if (Date.now() - lastPull > 30000) pull(); });

  // Timed auto-save: commit at most `autoSaveMinutes` after the first unsaved change (retrying a failed or
  // canceled save one interval later). With it off, remind players who leave changes uncommitted instead.
  let dirtySince = store.isDirty() ? Date.now() : 0;
  let lastAuto = 0;
  let lastNudge = 0;
  let closeNudge = null;
  const autoEvery = () => Math.max(0, Number(getSetting('autoSaveMinutes')) || 0) * 60000;
  const remindersOn = () => !getSetting('autoCommit') && !autoEvery() && Number(getSetting('saveReminder')) > 0;
  setInterval(() => {
    if (!dirtySince || !autoEvery() || store.saving) return;
    if (Date.now() < Math.max(dirtySince, lastAuto) + autoEvery()) return;
    lastAuto = Date.now();
    save({ auto: true });
  }, 15000);
  const nudge = (earlier, force = false) => {
    if (!(force || remindersOn()) || !store.isDirty() || store.saving) return;
    lastNudge = Date.now();
    closeNudge?.();
    const n = store.dirtyPaths().length;
    const what = `${n} unsaved change${n === 1 ? '' : 's'}`;
    const where = store.mode === 'sandbox' ? '' : ` Save so the party can see ${n === 1 ? 'it' : 'them'}.`;
    closeNudge = toast([
      h('span', null, earlier ? `Restored ${what} from your last visit.${where}` : `${what} kept on this device only.${where}`),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => save() }, 'Save now'),
    ], { timeout: 20000 });
    btn.classList.add('is-nudge');
    btn.addEventListener('animationend', () => btn.classList.remove('is-nudge'), { once: true });
  };
  store.on(() => {
    if (store.isDirty()) { dirtySince ||= Date.now(); return; }
    dirtySince = 0; lastAuto = 0; lastNudge = 0;
    closeNudge?.(); closeNudge = null;
  });
  setInterval(() => {
    if (!dirtySince || !remindersOn() || document.visibilityState !== 'visible') return;
    const every = Number(getSetting('saveReminder')) * 60000;
    if (Date.now() >= Math.max(dirtySince, lastNudge) + every) nudge(false);
  }, 30000);
  if (dirtySince) setTimeout(() => nudge(true, true), 1500);
  update();
}
