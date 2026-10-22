// Per-device preferences (not synced to the repo).

const KEY = 'sw:settings';
const DEFAULTS = {
  playerName: '',
  autoCommit: false,
  autoCommitDelay: 60, // seconds of inactivity before an automatic commit
  saveReminder: 10, // minutes of uncommitted changes before a "save now" nudge (0 = off; unused with autoCommit)
  theme: 'light',
  sidebarCollapsed: false,
};

let cache = null;
const listeners = new Set();

function read() {
  if (!cache) {
    try { cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}

export function getSetting(k) { return read()[k]; }

export function setSetting(k, v) {
  read()[k] = v;
  localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((fn) => fn(k, v));
}

export function onSetting(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applyTheme(theme = getSetting('theme')) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
