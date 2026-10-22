// Public Compendium API, shared with other views (Characters, Map, Journal).
// Contract (docs/character-model.md, "Compendium API"):
//   openPicker(kinds, {title, filter, multi}) -> Promise<entry|entry[]|null>
//   openEntryEditor(kind, entry?)             -> Promise<savedEntry|null>
//   renderEntry(entry)                        -> Node
// Importing this module also registers the compendium [[link]] types and preloads every kind.
import './linktypes.js';

export { openPicker } from './picker.js';
export { openEntryEditor } from './editor.js';
export { renderEntry, statLine, embedMarkdown } from './render.js';
export {
  kindLabel, kindOne, kindIcon, entryHref, linkText, linkPrefix, kindForPrefix, rulesReady, modifiersSummary,
} from './meta.js';
