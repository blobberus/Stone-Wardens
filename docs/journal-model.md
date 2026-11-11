# Journal: vault model, routes and links

The Journal tab is an Obsidian-style vault: a folder tree of markdown notes under `content/journal/`. Code:
`assets/js/views/journal/` (`data.js` model + link types, `query.js` search, `tree.js` Files pane, `search.js` Search and
Tags panes, `side.js` right pane, `note.js` the open note, `pages.js` home / folder / missing pages, `dialogs.js`,
`menu.js`, `state.js` per-device UI state, `text.js` helpers, `trash.js` Recently deleted). Styles: `assets/css/journal.css` (`.jr-`).
Family trees and timelines (note kinds): [below](#family-trees-and-timelines).

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
  Reading view shows them as a slideshow at the top of the page (on a family tree or timeline: under the board and
  its introduction; previous / next, arrow keys, swipe, thumbnails);
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

## Family trees and timelines
**New note** (the Files pane, the journal home, a folder page and its right pane) opens a menu of three kinds:
**Regular note**, **Family tree**, **Timeline**; a folder's ⋯ menu has "New … here" for each, and the new-note
dialog of an unwritten link asks which. Code: `kinds.js` (the kinds, board data, indexing), `calendar.js` (ages,
months, dates), `board.js` (item dialogs' controls, the hover card), `ages.js` (the Ages menu), `timeline.js`,
`family.js`, `symbols.js`, `board-md.js` (embeds); styles `assets/css/journal-boards.css` (`.jr-tl-`, `.jr-ft-`).

- **Files.** Both are ordinary notes (`.md` in the vault; trash, moves, renames, search, DM hiding all as before).
  `kind: timeline` / `kind: family-tree` in the frontmatter, the items under `timeline:` / `family:`, the body is
  the introduction shown under the board (written, linked and #tagged like any note). A note without `kind` is a
  regular note: every note made before this, untouched.
  ```yaml
  kind: timeline
  timeline:
    view: horizontal            # or vertical: the view choice, saved with the note
    ages: [bcc]                 # ages shown even without items in them (the "Age" tool / "On this timeline")
    events:
      - {id: e1, title: Siege of Greywater, year: 100, month: 3, age: aff, symbol: war, text: "…", tags: [war]}
    spans:                      # sub-timelines: a reign, a war, a time of something
      - {id: s1, title: Reign of Aldis, color: murrey, from: {year: 104, age: aff}, to: {year: 162, age: aff}, text: "…", tags: []}
    markers:
      - {id: m1, label: Party arrives, year: 5, age: bcc, color: rubric}
  ```
  ```yaml
  kind: family-tree
  family:
    people:
      - {id: c, name: Aldis Vael, title: Queen of Vael, born: {year: 80, age: aff}, died: {year: 162, age: aff}, color: murrey, text: "…", tags: []}
    unions:                     # partners (at most two) and their children; status married (default) | partners | separated
      - {id: u2, partners: [c, d], children: [f, g]}
      - {id: u4, partners: [], children: [j, k]}   # siblings whose parents aren't known
  ```
  Colours are the map's pin inks (`rubric vermilion ochre gold green verdigris lapis slate murrey umber`).
- **The words of the items count for the note**: searched, their tags in the Tags pane and `tag:` searches, their
  `[[links]]` in backlinks and outgoing links. Renaming a note rewrites links inside the items through the parsed
  YAML (then writes the note again), never as raw text. `[[` suggests events, sub-timelines and people
  (`[[Kings of Vael#Siege of Greywater]]`); such a link opens the board at the item with its card open (`?h=`).
  `![[Kings of Vael]]` embeds the introduction and the items in order; `![[Kings of Vael#Reign of Aldis]]` one item.
  The ages a timeline shows (listed, or holding its dates) count as its items too, though they live in
  content/calendar.json: an age's tags find those timelines and `[[Kings of Vael#After the Fallen Firmament]]`
  opens its band; editing the ages re-indexes the timelines. The right pane's Properties names the type
  ("Timeline · 7 events, 3 sub-timelines"); its Outline lists the items after the introduction's headings (events
  and sub-timelines by date, people by generation; a click goes to the item). The Properties editor leaves the
  board keys alone.
- **The page.** Under the title, the toolbar and the board first, then the introduction (a text box while editing,
  a couple of paragraphs tall), then the reference images (slideshow / panel), then the tags at the bottom, in both
  modes. The board is the page's biggest box: it takes the sheet's whole width (past the text's margins, up to the
  binding) and the window's height under the title and toolbar, so all of it is in sight when the page opens (half
  the window on a phone; 280–680px), its tree or timeline in the
  middle of the frame (an empty board keeps a small frame; a vertical timeline is as tall as its items). Reading,
  the tags list all the note's tags (its own, its text's and its items'); editing, a Tags box holds the note's own
  `tags:`. The toolbar is the
  board's header (one frame) and stays in sight while a long board scrolls; on a board under 560px wide (a phone,
  or both side panes open) the add buttons fold into one **Add** menu (**Relative** on a family tree). Both boards
  keep their place (scroll, zoom) across edits and Read / Edit, bring the item just added or edited into view with
  a gold ring that fades, and give it the focus; an empty board says so inside its frame, with a button to add the
  first item.
- **The world's calendar**, `content/calendar.json`, shared by every timeline and family tree:
  `{ages: [{id, abbr, name, color, start, end, countdown, text, tags}], months: [names], defaultAge}`. Without the
  file there is one age, AFF (After the Fallen Firmament), the default for new dates, and the Gregorian months.
  A date is an integer year, an optional month and an age (a dropdown). Dates sort by the age's place in the list
  first (with AFF above BCC, 100 AFF comes before 1 BCC), then the year (backwards in an age whose years count
  down, like BC), then the month (none first). **Ages** (the toolbar's Edit ages, or Age to add one): the list in order
  (earlier / later), each age's abbreviation, name, range of years, "counts down", colour, a paragraph and tags,
  which age new dates start in, the month names, and (from a timeline) which ages it shows; nothing is written
  until Save. Deleting an age that dates use asks first; those dates keep their years and sort last.
- **Timeline.** Add an **Event** (title, date, a symbol: crossed swords for war, a white flag for peace, a crown…,
  description, tags), an **Age**, a **Sub-timeline** (title, highlight colour, from – to, the end optional while
  it goes on, description, tags) or a **Marker** (a label, a date, a colour). Horizontal: event cards stand on
  stems above the axis in up to four lanes; the room between dates grows with the years between them (log scale,
  − / + spacing) and stretches wherever a card needs it, so every title and year shows (a long title wraps);
  ages are bands hanging under the axis with their name kept in sight while scrolling; sub-timelines are bars in
  lanes under it plus a wash of their colour over their stretch; markers are diamonds on the axis, labels under
  it. Each row of cards above the axis is only as tall as its own cards. Vertical: dates left of the axis, cards
  right of it (on a narrow page the date goes in the card). Drag to scroll with a mouse. When a horizontal board is
  wider than its box, an **overview** strip under it shows the whole timeline (ages as tinted segments, events as
  ticks, a window on the part in sight): click or tap to centre there, drag the window, or focus it and use Left /
  Right / Home / End. Tab and the arrow keys go from item to item by date (Home / End: the first / last), each
  brought into sight with its card open; an open card follows its item when the board is laid out again (a pane
  opened or closed).
- **Family tree.** Add a **Person**; select someone (click their card) and a bar under the card ("+ Parent",
  "+ Partner", "+ Child", "+ Sibling"; the toolbar has the same) adds their **Parent** (at most two),
  **Partner** (married / partners / separated), **Child** (with which partner, or of them alone) or **Sibling**,
  someone new or someone already in the tree; the person added is selected, so the next relative is one click.
  Esc or a click on empty board lets go. The person hovered or focused (else the selected one) has their own lines
  drawn in their colour while the rest of the tree fades; arrow keys go to relatives (Up a parent, Down a child,
  Left / Right along the row). It opens fitted to the board's width (never below 60%, then centred on the oldest
  generation), or centred when it is narrower. Rows are generations (partners share one, children sit below their
  parents); each family claims its children's families and gets a stretch as wide as its descendants, so no cards
  meet and parents sit centred over their children; a family two families could claim goes to the first, the
  other draws a longer line. Lines: double = married, single = partners, dashed = separated; siblings with unknown
  parents share a bar under a question mark. A person's dialog lists their relations to unlink one or change a
  partnership. A key under the board names the kinds of line this tree draws. Zoom − / % (fit the whole tree) / +,
  Ctrl / Cmd + wheel or two fingers (around the pointer); drag to scroll.
- **Hover card** (both boards): mouse over an item, or focus it, for its expanded view: what it is, its date or
  range, the description (markdown, links work), tags (each opens the tag search), Edit and Copy link (a
  `[[Note#Item]]`). A click or a tap keeps it open; a double click or Enter edits; Esc or a click elsewhere closes it.

## UI state (localStorage, per device)
`sw:journal:prefs` (pane tab and visibility, widths, sort, tag sort, right-pane sections) and
`sw:journal:vault:<store scope>` (expanded folders, expanded tags, recently opened note paths).
