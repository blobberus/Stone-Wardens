# Journal: vault model, routes and links

The Journal tab is an Obsidian-style vault: a folder tree of markdown notes under `content/journal/`. Code:
`assets/js/views/journal/` (`data.js` model + link types, `query.js` search, `tree.js` Files pane, `search.js` Search and
Tags panes, `side.js` right pane, `note.js` the open note, `pages.js` home / folder / missing pages, `dialogs.js`,
`menu.js`, `state.js` per-device UI state, `text.js` helpers). Styles: `assets/css/journal.css` (`.jr-`).

## Files on disk
```
content/journal/
  <note>.md                      a note at the vault root
  <folder>/_chapter.json         optional folder metadata
  <folder>/<note>.md
  <folder>/<sub>/<note>.md       folders nest to any depth
```
- **Folders are directories.** A folder exists if it holds a note, a subfolder, or a `_chapter.json`.
- **`_chapter.json`** = folder metadata `{title?, description?, order?}` (all optional; `order` is kept but no longer used
  for sorting). The name dates from the book layout and is kept so existing chapters work unchanged: every former
  chapter is simply a top-level folder. Git cannot store an empty directory, so this file is also what keeps an empty
  folder: "New folder" writes `{title}`, and when the last note leaves a folder without metadata the view writes one so
  the folder stays (as in Obsidian). Without metadata the title is the directory name prettified (`arc-one` -> "Arc one").
- **Names.** File and directory names are slugs of the title (`slugify`, max 60 chars), unique within their folder;
  notes and subfolders share that namespace. Top-level folders cannot be called `new` or `_` (router words).
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
  e.g. uploaded through GitHub), captions, reorder, remove. The note menu has "Upload reference photos…" and "Add
  images from site files…" in reading view too. Uploads go to `content/media/journal/<note>-<name>-<id>.<ext>`, staged
  with `store.putBinary` and committed right away (`saveSoon`; with Save when that setting is off); photos over 1.5 MB are scaled to 2400 px on the long side (JPEG).
  Removing an uploaded photo deletes its file once no note lists it; renaming or moving a note keeps its images.

## Routes (`#/journal…`)
| Route | Shows |
| --- | --- |
| `#/journal` | vault home: recently opened (this device), recently edited, folders, unwritten links, tags |
| `#/journal/_` | the vault root as a folder page |
| `#/journal/_/<note>` | a note at the root (the old "Loose Leaves" URL) |
| `#/journal/<folder…>` | a folder page (also what `[[folder:X]]` / `[[chapter:X]]` open); `?folder` forces the folder when a note has the same path |
| `#/journal/<folder…>/<note>` | a note; `?h=<heading-slug>` scrolls to a heading |
| `#/journal?q=…` / `?tag=…` | opens the Search pane with that query (`?tag=npc` = `tag:#npc`); the open note stays |
| `#/journal/new?title=…` | "New note" dialog (unresolved `[[links]]` point here) |

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

## UI state (localStorage, per device)
`sw:journal:prefs` (pane tab and visibility, widths, sort, tag sort, right-pane sections) and
`sw:journal:vault:<store scope>` (expanded folders, expanded tags, recently opened note paths).
