# Journal: vault model, routes and links

The Journal tab is an Obsidian-style vault: a folder tree of markdown notes under `content/journal/`. Code:
`assets/js/views/journal/` (`data.js` model + link types, `query.js` search, `tree.js` Files pane, `search.js` Search and
Tags panes, `side.js` right pane, `note.js` the open note, `pages.js` home / folder / missing pages, `dialogs.js`,
`menu.js`, `state.js` per-device UI state, `text.js` helpers, `trash.js` Recently deleted). Styles: `assets/css/journal.css` (`.jr-`).

## Files on disk
```
content/journal/
  <note>.md                      a note at the vault root
  <folder>/_chapter.json         optional folder metadata
  <folder>/<note>.md
  <folder>/<sub>/<note>.md       folders nest to any depth
content/journal-trash/          Recently deleted (see below)
  <id>/_deleted.json             what was deleted, from where, when, by whom
  <id>/<folder…>/<note>.md       the deleted note or folder, at its own path in the vault
```
- **Folders are directories.** A folder exists if it holds a note, a subfolder, or a `_chapter.json`.
- **`_chapter.json`** = folder metadata `{title?, description?, order?}` (all optional; `order` is kept but no longer used
  for sorting). The name dates from the book layout and is kept so existing chapters work unchanged: every former
  chapter is simply a top-level folder. Git cannot store an empty directory, so this file is also what keeps an empty
  folder: "New folder" writes `{title}`, and when the last note leaves a folder without metadata the view writes one so
  the folder stays (as in Obsidian). Without metadata the title is the directory name prettified (`arc-one` -> "Arc one").
- **Names.** File and directory names are slugs of the title (`slugify`, max 60 chars), unique within their folder;
  notes and subfolders share that namespace. Top-level folders cannot be called `new`, `_` or `recently-deleted` (router words).
  Renaming a note or folder renames the file / directory; moving moves the files as-is (content and `updated` untouched).
- **Note frontmatter** (YAML, all optional): `title`, `aliases`, `author`, `created`, `updated` (ISO), `tags`, plus any
  custom keys (shown under Properties; editable as YAML from the right pane). `order` from the book days is preserved.
  Without `title` the file name is prettified. Tags = `tags:` plus inline `#tags` (nested with `/`).
- **Reference images** (`images:`, optional): photos kept with the note (`gallery.js`). A list of repo paths or https
  URLs, each a string or `{src, caption}`, in display order:
  ```yaml
  images:
    - content/media/journal/old-mill-sketch-k3f9.jpg
    - src: wardens-library/handouts/map-of-vael.png
      caption: The map Mira found
  ```
  Reading view shows them as a slideshow at the top of the page (previous / next, arrow keys, swipe, thumbnails);
  "Expand" or a tap on the photo opens a full-screen viewer to scroll through all of them (Esc closes). Editing view has
  a **Reference images** panel: Upload photos (or drop files on it), From site files (any image already in the repo,
  e.g. uploaded through GitHub), captions, reorder (drag a photo: a mouse at once, a finger after holding it for a
  moment, so a swipe still scrolls; or the arrow buttons), remove. The note menu has "Upload reference photos…" and "Add
  images from site files…" in reading view too. Uploads go to `content/media/journal/<note>-<name>-<id>.<ext>`, staged
  with `store.putBinary` and committed right away (`saveSoon`; with Save when that setting is off); photos over 1.5 MB are scaled to 2400 px on the long side (JPEG).
  Removing an uploaded photo deletes its file once no note lists it; renaming or moving a note keeps its images.

## Editing view
- The note's markdown is edited as plain text in `core/live-text.js` (markdownEditor `live: true`): one block per
  source line, so a line starting `# ` … `###### ` shows at its title size and colour as you type (the `#`s stay,
  faded; `#tag` without a space is a tag, and lines in fenced code are never titles). What is saved is exactly the
  text typed. The toolbar, `[[` suggestions, Ctrl+B / Ctrl+I, Ctrl+Z / Ctrl+Y (its own history) and paste (plain
  text) work as in the other editors; "Formatting help" lists the syntax.
- Typing `[[` closes the link at once (`[[|]]`, as in Obsidian; not when a word follows the caret), so the name is
  typed inside it; `]` steps over the closing brackets, Backspace in an empty `[[]]` removes the `]]` with the `[`,
  and `[` with text selected wraps it (twice makes it a link). The same holds in every markdown editor.

## Routes (`#/journal…`)
| Route | Shows |
| --- | --- |
| `#/journal` | vault home: recently opened (this device), recently edited, folders, unwritten links, tags |
| `#/journal/_` | the vault root as a folder page |
| `#/journal/_/<note>` | a note at the root (the old "Loose Leaves" URL) |
| `#/journal/<folder…>` | a folder page (also what `[[folder:X]]` / `[[chapter:X]]` open); `?folder` forces the folder when a note has the same path |
| `#/journal/<folder…>/<note>` | a note; `?h=<heading-slug>` scrolls to a heading |
| `#/journal?q=…` / `?tag=…` | opens the Search pane with that query (`?tag=npc` = `tag:#npc`); the open note stays |
| `#/journal/recently-deleted` | Recently deleted: deleted notes and folders, to look inside, restore, or delete for good |
| `#/journal/new?title=…` | "New note" dialog (unresolved `[[links]]` point here; for players, outside their own notes, they say the page hasn't been revealed yet: docs/dm-mode.md) |

Resolution (`data.resolveRoute`): segments are joined with `/` (so the encoded form other views build,
`href('journal', 'a', 'b/note')` -> `#/journal/a/b%2Fnote`, works too); a single segment is a top-level folder first,
else a root note; two or more segments are a note first, else a folder. Other views can keep building note links as
`href('journal', firstSegment || '_', restOfPath)` from a note's path (map "Mentioned in", compendium mentions).

## Links
- `[[Title]]`, `[[alias]]`, `[[file-name]]`, `[[Folder/Sub/Note]]` (path by slugs or titles) -> note. Ambiguous names
  resolve to the shallowest note. `[[#Heading]]` = same note. `note:` prefix is optional.
- `[[folder:Sessions]]`, `[[folder:sessions/arc-1]]` -> folder page; `![[folder:X]]` embeds its listing.
  `[[chapter:X]]` is the legacy alias of `folder:` (old chapter links keep working).
- Renaming a note offers to update `[[Old title]]` links; renaming a folder offers to update `[[folder:…]]`/`[[chapter:…]]`
  links. Path-style links (`[[folder/note]]`) to moved notes are updated automatically.

## Recently deleted
Deleting a note or a folder (the ⋯ menu, the Delete key in Files, or dropping it on **Recently deleted** at the foot of
the Files pane) moves it to `content/journal-trash/<id>/`, under its own vault path (`<id>/sessions/old-mill.md`; a
folder with everything in it, subfolders and attachments too). Outside `content/journal/`, the vault, links, search and
other tabs never see it: links to a deleted note offer to start a new one, as before. The toast after a delete has
**Undo**. `<id>/_deleted.json` = `{type: 'note'|'folder', title, path, parents: [{path, title}], at, by}` (`path` vault-relative,
the note's file with `.md`). "Keep the notes" in a folder's delete question still moves its notes up and deletes only the
folder (nothing goes to the trash).
- **The page** (`#/journal/recently-deleted`, `trash.js`): newest first, each item with where it came from, when and by
  whom; click one to look inside (a note rendered; a folder's notes listed), **Restore**, or delete it forever; **Empty
  folder** deletes everything. Nothing is deleted on its own: items wait until someone empties the folder.
- **Restore** puts an item back where it was: its folder is made again (with its old name, from `parents`) if it is gone
  since. A note whose name is taken there now comes back as `name-2` (both kept); a folder whose name is taken there now
  joins that folder (its notes keep their names unless one there already has it; that folder's metadata stays).
- **Reference photos** stay in `content/media/journal/` while their note waits here (and count as used: removing one from
  another note keeps the file); deleting the note forever deletes its uploads once no note lists them.
- **DM mode**: a hidden note stays sealed in the trash (moved with `{hidden: true}`), so players never see it there; its
  `_deleted.json` is only `{type, at}` (its name and place come from the sealed file, which only the DM can open). A
  folder holding only hidden notes gets the same bare record. In a folder with both, the visible notes and the folder are
  the players' to see and restore; the hidden ones stay behind when a player restores it, and the DM finds them on the
  page (worked out from their paths: one note = a note, several = their folder), each restored still hidden. On the DM
  Screen a hidden note waiting here is a "Deleted journal note" that can't be released before it is restored.

## UI state (localStorage, per device)
`sw:journal:prefs` (pane tab and visibility, widths, sort, tag sort, right-pane sections) and
`sw:journal:vault:<store scope>` (expanded folders, expanded tags, recently opened note paths).
