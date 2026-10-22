// Per-device preferences (not synced to the repo).

const KEY = 'sw:settings';
const DEFAULTS = {
  playerName: '',
  autoSaveMinutes: 10, // commit unsaved changes at most this many minutes after the first one (0 = off)
  autoCommit: false, // also commit shortly after each edit
  autoCommitDelay: 60, // seconds of inactivity before that commit
  saveReminder: 10, // minutes of uncommitted changes before a "save now" nudge (only when both auto-saves are off)
  theme: 'light',
  sidebarCollapsed: false,
  chSkillsFolded: false, // character sheet: show proficient skills only
  chProfsOpen: false, // character sheet: Proficiencies & languages unfolded
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
