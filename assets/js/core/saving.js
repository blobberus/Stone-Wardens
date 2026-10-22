// Shared "Save now" entry point. main.js registers the real handler (status, toasts, error state),
// so any view can offer a Save button that behaves exactly like the sidebar one.
let handler = null;

export const setSaveHandler = (fn) => { handler = fn; };

/** Commit all unsaved changes. Resolves true when saved (or nothing to save), false when cancelled or failed. */
export const saveNow = () => (handler ? handler() : Promise.resolve(false));
