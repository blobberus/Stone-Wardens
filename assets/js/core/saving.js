// Shared save entry points. main.js registers the real handler (status, toasts, error state),
// so any view can offer a Save button that behaves exactly like the sidebar one.
import { store } from './store.js';
import { getSetting } from './settings.js';

let handler = null;

export const setSaveHandler = (fn) => { handler = fn; };

/**
 * Commit all unsaved changes ({message} = commit message). Resolves true when saved (or nothing to save),
 * false when canceled or failed.
 */
export const saveNow = (opts) => (handler ? handler(opts) : Promise.resolve(false));

// ---------- big changes ----------
// Uploads and structural edits (new / deleted places and maps, library entries, finished map edits…) commit a
// moment after they happen instead of waiting for the auto-save timer (setting saveMajorNow). Calls within
// GATHER_MS of each other become one commit; small edits (typing) keep following the timer.

const GATHER_MS = 1500;
let reasons = [];
let waiters = [];
let timer = 0;
let busy = false; // a batch is being committed
let queued = false; // the pending batch had to wait for that one
let lastOk = true;

/** True when big changes commit by themselves (signed in, setting on); views use it to drop "press Save" hints. */
export const majorSaveOn = () => !!handler && !!getSetting('saveMajorNow');

/** Toast tail after a big change: nothing when it commits right away, else how it will reach the party. */
export const saveHint = (manual = 'Press Save to share it with the party.', auto = 'It will be committed automatically.') =>
  (majorSaveOn() ? '' : getSetting('autoCommit') ? auto : manual);

/**
 * Commit soon because of a big change. reason: short phrase for the commit message ("upload wardens-library/x.pdf").
 * Resolves like saveNow (false at once when the setting is off).
 */
export function saveSoon(reason) {
  if (!majorSaveOn()) return Promise.resolve(false);
  if (reason && !reasons.includes(reason)) reasons.push(reason);
  if (busy) queued = true;
  clearTimeout(timer);
  timer = setTimeout(flush, GATHER_MS);
  return new Promise((resolve) => waiters.push(resolve));
}

async function flush() {
  timer = 0;
  if (busy) { queued = true; timer = setTimeout(flush, GATHER_MS); return; } // one batch at a time; this one follows
  const batch = reasons;
  const done = waiters;
  const behind = queued;
  reasons = [];
  waiters = [];
  queued = false;
  busy = true;
  let ok = false;
  try {
    // Another save (Save button, timer, auto-commit) may be running: let it finish, then commit what it missed.
    // When that one (or the batch this one queued behind) failed or was canceled at a conflict, the player has
    // just seen the error / made the choice: don't repeat it. The drafts stay for the timer or the Save button.
    let prev = behind && !lastOk ? null : { saved: 0 };
    while (prev && !prev.cancelled && store.saving) prev = await store.savePromise.then((r) => r, () => null);
    if (prev && !prev.cancelled && majorSaveOn()) {
      ok = await saveNow({ message: commitMessage(batch) });
      lastOk = ok;
    }
  } catch (e) {
    console.error('[saving] save failed', e);
    lastOk = false;
  } finally {
    busy = false;
  }
  done.forEach((r) => r(ok));
}

function commitMessage(batch) {
  const who = getSetting('playerName') || 'A Warden';
  // Commit messages are public: in DM mode a reason may name a hidden item ("new quest “The Traitor”"), so none.
  const what = store.layer ? 'update' : batch.slice(0, 3).join('; ') + (batch.length > 3 ? `; +${batch.length - 3} more` : '');
  const n = store.dirtyPaths().length;
  return `${who}: ${what || 'update'}${n > 1 ? ` (${n} files)` : ''}`;
}
