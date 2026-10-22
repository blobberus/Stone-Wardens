// Per-device preferences (not synced to the repo).

const KEY = 'sw:settings';
const VERSION = 2; // v1 stored every key, defaults included; v2 stores only values that differ from DEFAULTS
const DEFAULTS = {
  playerName: '',
  autoSaveMinutes: 5, // commit unsaved changes at most this many minutes after the first one (0 = off)
  autoCommit: false, // also commit shortly after each edit
  autoCommitDelay: 60, // seconds of inactivity before that commit
  saveReminder: 10, // minutes of uncommitted changes before a "save now" nudge (only when both auto-saves are off)
  theme: 'light',
  sidebarCollapsed: false,
  chSkillsFolded: false, // character sheet: show proficient skills only
  chProfsOpen: false, // character sheet: Proficiencies & languages unfolded
  chHpOpen: false, // character sheet: HP inputs (Current / Temp / Damage, Damage / Heal) shown
  chTrackersShown: true, // character sheet: hit dice & conditions panel shown (replaces chTrackersOpen, which defaulted to hidden)
};

let cache = null;
const listeners = new Set();

function read() {
  if (!cache) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
    if (!(saved._v >= VERSION)) {
      // v1 wrote the old 10-minute auto-save default into every browser; let the new default (5) apply.
      if (saved.autoSaveMinutes === 10) delete saved.autoSaveMinutes;
      delete saved.chTrackersOpen; // replaced by chTrackersShown
      cache = { ...DEFAULTS, ...saved };
      write();
    } else {
      cache = { ...DEFAULTS, ...saved };
    }
  }
  return cache;
}

// Store only what differs from the defaults, so a changed default reaches everyone who never picked a value.
function write() {
  const out = { _v: VERSION };
  for (const [k, v] of Object.entries(cache)) if (k !== '_v' && v !== DEFAULTS[k]) out[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage full or blocked: keep the in-memory value */ }
}

export function getSetting(k) { return read()[k]; }

export function setSetting(k, v) {
  read()[k] = v;
  write();
  listeners.forEach((fn) => fn(k, v));
}

export function onSetting(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applyTheme(theme = getSetting('theme')) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
