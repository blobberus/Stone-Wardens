# Stone Wardens — campaign site (CLAUDE.md)

Password-gated D&D 5e (**2024 rules / SRD 5.2**) campaign site on GitHub Pages for repo
`blobberus/Stone-Wardens`. The original brief is `The Stone Wardens - A Fallen Firmament Campaign(1).md`.
Sidebar, in order: **Combat Ring** (crossed swords; opens the sister battle-table site `../Combat-Ring/` in a new tab,
main.js `combatRingLink`), then the tabs (main.js `VIEW_IDS`): **Map**, **Quests**, **Characters**, **Journal**, **Pantheon**, **Warden's Library** (renders
PDFs/DOCX from `wardens-library/`), **Compendium** (SRD + custom library), **DM Screen** (DM mode only); at the
bottom **Inbox** and **Settings** (DM login lives in Settings → DM mode). The sidebar title opens the landing page.

## Hard rules
- **No build step.** Plain HTML/CSS + native ES modules. No npm deps at runtime; libs are vendored in `vendor/`
  (leaflet 1.9.4, marked 18, dompurify 3, js-yaml 5 [`load`/`dump`], mammoth 1.13 browser build = global `mammoth`,
  jspdf 4.2.1 UMD = global `jspdf`, loaded on first print by characters/print.js).
- All paths relative (site is served from `/Stone-Wardens/`). Never use absolute `/` URLs.
- Windows box: Git Bash cannot write inside `Documents` (Controlled Folder Access). Use the Write/Edit tools or
  PowerShell for writes in the repo; scratch work goes to the session scratchpad.
- Commit from PowerShell with `git commit -F <msgfile>` (PowerShell 5.1 mangles quotes in `-m` here-strings).
- Local tools: Python 3.11 (`python -I`). No global Node; a portable Node may exist in the session scratchpad
  for `node --check file.js`.
- Copyright: only SRD 5.2 (CC-BY-4.0) text verbatim. Non-SRD content = **stubs**: names, levels, mechanics
  and short summaries in our own words (`srd/stubs/`). Keep the attribution in `srd/LICENSE-SRD.md`.
- Commit/push as you go with clear messages. Pages deploy workflow ignores `content/**` and `wardens-library/**`.

## Layout
```
index.html            app shell (gate + sidebar + view containers); loads assets/js/main.js
setup.html            owner tool: encrypts a GitHub token with the site password -> vault.json
vault.json            {v,kdf,cipher,data,repo} AES-GCM ciphertext of {token}; password never stored
assets/css/           tokens.css (design tokens) base.css (components) shell.css + one css per view
assets/img/           icons.svg (sprite, <symbol id="i-NAME">), placeholder-map.svg, stone-wardens-poster-{960,1600,2560}.webp
                      + -backdrop.webp (landing page; made from References/StoneWardensPoster1.png, keep that original)
assets/js/main.js     boot: gate -> store.load -> register views -> router.start
assets/js/core/       shared infrastructure (see contracts below) — views must not reimplement these
assets/js/views/<v>/  one folder per tab: map, characters, journal, quests, pantheon, compendium, wardens-library, settings;
                      home = landing page (no tab)
srd/                  generated SRD 5.2 JSON (tools/build_srd.py) + srd/stubs/*.json; read-only at runtime
content/              ALL user data, written by the site through the GitHub API
  characters/<id>.json  characters/recently-deleted/<id>.json (trash, `trashed:{at,by}`)
  locations/<id>.json (optional `map` sub-map id, `submap` it opens, `rank` 1-4)  map/config.json (+ map image)
  map/hidden.json                public marker {hidden:true} while the DM hides the main map
  maps/<mapId>.json + maps/<mapId>/<image>   sub-maps {id,name,parent,image,width,height,design?}; parent null = a map
                                of its own (not linked to the main map); docs/map-model.md
  map-pictures/<id>.json (+ media/map-pictures/)  fog/<mapId>.json   pictures on maps, fog of war; docs/map-design.md
                                (sample: starfall-vale-p94a "Starfall Vale" + 2 places, safe to delete)
  quests/<id>.json  media/quests/<file>   quest log (docs/quests-model.md)
  pantheon/<id>.json            the pantheon's gods and angels, one being each (docs/pantheon-model.md)
  dm/vault.json  dm/hidden/<rid>.json|.bin  dm/released.json  inbox/<stamp>.json   DM mode (docs/dm-mode.md)
  dm/party.json                 the DM's party view notes (sealed, never released; docs/dm-party.md)
  journal/<folder…>/<note>.md   nested folders; optional _chapter.json in any folder = folder metadata
                                {title, description, order} (also keeps empty folders in git); root notes journal/*.md
                                frontmatter `images:` = reference photos (slideshow; docs/journal-model.md)
  media/journal/<file>          uploaded reference photos of journal notes (journal/gallery.js)
  library/<kind>/<id>.json   kinds: weapon armor gear magic-item spell feat ability species class subclass
                             background location-type
wardens-library/      campaign documents (pdf/docx/md/txt/images) shown read-only in Warden's Library
tools/build_srd.py    converts 5e-bits/5e-database src/2024/en -> srd/
```

## Data flow
- Auth: `vault.json` decrypted with password (PBKDF2-SHA256 600k -> AES-256-GCM) gives a fine-grained PAT
  (Contents R/W on this repo only). Kept in sessionStorage (localStorage if "remember device").
- Reads: GitHub git-trees API (one recursive call) + blobs by sha, cached in IndexedDB by sha.
- Writes: Git Data API batch commit (tree with base_tree -> commit -> update ref; retry on non-fast-forward).
  Conflict check: if remote sha != the sha we loaded, user chooses overwrite/keep theirs.
  `store.pullIfChanged()` pulls only after `backend.headChanged(store.headCommit)` (conditional GET of the ref; a 304
  is free).
- Live (`core/live.js` + `core/mqtt.js`, a copy of Combat Ring's): every local write of a character sheet is also
  published at once over public MQTT brokers, gzip'd and AES-GCM sealed with a key from the token (HKDF), retained per
  sheet; only the DM's party view subscribes. `characters/data.js` shows a live copy while its `updated` is newer than
  the stored doc. Never written to the repo. Sandbox: BroadcastChannel. docs/dm-party.md.
- Every edit is saved immediately as a local draft (localStorage) -> survives reloads. "Save" (Ctrl+S) commits
  all dirty docs. `beforeunload` warns when uncommitted. Auto-commit (`autoCommit`, default on) 2 s (`autoCommitDelay`)
  after the last edit (`store.scheduleAutoCommit`): at most one per 15 s per device while editing, paused 2 min after a
  GitHub rate-limit error (every player shares the owner's token: ~500 writes/h, 3 per commit); edits made during a
  save are committed after it. Following others' changes (main.js `followBranch`): after each commit a screen
  announces it over the live channel (live.js `followCommits`, topic `sw1/<room>/c`, flagged when made in DM mode);
  every open screen checks at once for the DM's (a release, a notification, a fog reveal shows in ~1-3 s), else asks
  GitHub every 10 s while shown (304 = free); pulls (3 requests on the shared token) at most every 4 s for the DM's
  changes and every 30 s for players'; again on focus / tab shown; an announced commit not visible yet is retried.
  `main.js` `wireSaving` auto-saves `autoSaveMinutes` (default 5, 0 = off) after the first unsaved change; with that
  and auto-commit off it shows a "Save now" toast after `saveReminder` minutes instead. Views call `saveNow()` from
  `core/saving.js` for a Save button that behaves like the sidebar one. Big changes call `saveSoon(reason)` right
  after the edit (setting `saveMajorNow`, default on): uploads (library, map image, journal photos, portraits of saved
  sheets), library document renames, new/deleted/moved places, sub-maps, Done in map edit mode, custom library entries (inside
  `compendium.saveCustom/removeCustom`), new/deleted/restored characters, journal note/folder delete and move. Calls
  within 1.5 s make one commit (message `<player>: <reasons>`), one batch at a time; it waits for a running save and
  skips when that save failed or was canceled at a conflict (drafts stay). `majorSaveOn()` / `saveHint()` pick toast
  wording. Small edits (typing, place descriptions, map / note / folder renames) keep the timer.
- Sandbox mode (`?sandbox`, or no vault on localhost): same API backed by IndexedDB only.
- JSON docs are pretty-printed (2 spaces). Ids: `slug-xxxx` (`util.uid(name)`), filename = id.

## Core contracts (`assets/js/core/`)
- `dom.js`: `h(tag, attrs, ...children)` (attrs: class, style obj/str, onX handlers, data-*, value/checked props;
  children: string|Node|array|null), `$`, `$$`, `clear(el)`.
- `util.js`: `uid(name)`, `slugify`, `debounce`, `escapeHtml`, `fmtMod(n)` (+2/−1), `clone`, `sortBy`, `byName`.
- `ui.js`: `toast(msg,{type})`, `openModal({title, body, actions:[{label,kind,onClick}], wide}) -> {close, el}`
  (onClick returning false keeps it open; `beforeClose()` returning false vetoes Esc/X/backdrop), `confirmDialog(msg,{okLabel,danger}) -> Promise<bool>`,
  `promptDialog(title,{label,value}) -> Promise<string|null>`, `choiceDialog(msg, [{label,value,kind}]) -> value|null`, `pickFromList({title, items, render, search,
  multi}) -> Promise<item|item[]|null>`, `icon(name, size?)`, form helpers `field(label, control, hint?)`,
  `input(props)`, `textarea(props)`, `select(options, value, onchange)`, `checkbox(checked, onchange, label)`,
  `markdownEditor({value, onInput, rows, live})` (textarea + [[link]] autocomplete + preview toggle; it grows with its
  text and keeps the scroll around it, and after an edit scrolls only when the caret is out of sight, clear of the
  toolbar). Brackets as in Obsidian: typing `[[` adds the closing `]]` (not before a word), `]` steps over them,
  Backspace in an empty `[[]]` takes both, `[` wraps a selection (a textarea's edits go through execCommand so its
  own undo keeps them). `live: true` (the journal) edits in `core/live-text.js` instead: a contenteditable box, one block per
  source line, headings drawn at their size as you type ("#"s faded), with the textarea's value / selection /
  setRangeText interface. Typing within a line is the browser's (spelling, autocorrect, IMEs) and read back; Enter,
  joins, paste, cut and typing over lines are applied by it; own undo (Ctrl+Z / Ctrl+Y). `node tools/test_livetext.mjs`.
  NEVER use window.alert/confirm/prompt.
- `store.js` (singleton `store`): `load()`, `list(dir, {recursive})` -> `[{path, data}]`, `get(path)`,
  `put(path, data)` (object -> JSON; string -> text), `remove(path)`, `putBinary(path, blob)`,
  `fileUrl(path) -> Promise<objectURL>`, `fileBlob(path)`, `files(prefix)` -> `[{path,size,sha}]` (any type),
  `on(fn) -> unsubscribe` (events `{type:'put'|'remove'|'load'|'saved'|'pulled', path?}`),
  `isDirty(path?)`, `dirtyPaths()`, `save(message?)`, `pull()`, `mode` ('github'|'sandbox').
- `router.js`: hash routes `#/<view>/<...parts>?query`. `registerView({id, title, icon, order, mount(el),
  show(route), hide?(), menu?})` — mount once (lazy), views stay mounted (map is never re-created); `menu: false` =
  a route without a sidebar tab (main.js `buildSidebar` skips it).
  `navigate(href)`, `href(view, ...parts)`, `current()` -> `{view, parts, query}`.
- `links.js`: `registerLinkType(prefix, {label, resolve(target, anchor) -> {href,title,exists}|null,
  suggest(q) -> [{label, value}]})`. `resolveLink(raw)`; un-prefixed `[[X]]` -> journal note, else first exact
  name match across types, else unresolved (click offers to create note).
  Prefixes: `map:` locations and sub-maps (place id > map id > place name > map name; `[[map:Map#Place]]`), `char:` characters (`[[char:Name#hp]]` anchors a sheet section/stat),
  `note:` journal, `folder:` journal folder (legacy `chapter:`), `doc:` warden's library, `quest:` quests, `pantheon:` beings, compendium kinds: `weapon: armor: gear: item: spell: feat:
  ability: species: class: subclass: background:`.
- `markdown.js`: Obsidian-flavored: `[[wikilinks|alias]]`, `[[x#heading]]`, `![[embed]]` (notes/images),
  `> [!type]± title` callouts, `==highlight==`, `%%comment%%`, `#tags`, task lists, tables, GFM autolinks,
  YAML frontmatter. `renderMarkdown(src) -> safe HTML`, `renderInto(el, src)` (wires links/embeds/folds),
  `parseFrontmatter(text) -> {data, body}`, `stringifyFrontmatter(data, body)`, `extractLinks(src)`.
  Use it for every user description (pins, custom items, abilities) so links are hyperlinked by default.
- `compendium.js`: merged SRD + stubs + custom: `KINDS`, `entries(kind)` -> Promise<array>, `cached(kind)` (sync,
  after `preloadAll()`), `entry(kind, id)`, `findByName(kind, name)`, `saveCustom(kind, obj)`, `removeCustom`,
  `srd(name)` raw loader (`srd('rules')`, `srd('features')`). Every entry has `kind` and
  `origin: 'srd'|'stub'|'custom'` (`source` = book name for stubs). Custom overrides same id.
- `settings.js`: `getSetting(k)`, `setSetting(k,v)` (playerName, autoSaveMinutes, saveMajorNow, autoCommit, autoCommitDelay, saveReminder, theme, sidebarCollapsed, sheet fold keys, `wl*` library keys).
  localStorage `sw:settings` holds only values that differ from DEFAULTS (`_v: 2`), so changing a default reaches
  everyone who never picked one; v1 blobs (every key) are migrated once on read.

## Views
- `assets/js/views/<id>/index.js` default-exports `{id, title, icon, mount(el), show(route), hide?()}`; `main.js`
  imports the ids in `VIEW_IDS` (a failed import shows an error tab instead of breaking the app). Views register
  their link types at import time and re-render from `store.on` events.
- Routes: `#/map[/loc/<id>]`, `#/map/m/<mapId>[/loc/<id>]` (sub-maps), `#/characters[/<id>[/<section>]]`, `#/journal[/_|/<folder…>[/<note>]][?h=|q=|tag=|folder]`,
  `#/journal/new?title=`, `#/quests[/<id>[/edit]]`, `#/pantheon[/<file>]`, `#/compendium[/<kind>[/<id>]]`, `#/wardens-library[/<path…>]`, `#/settings`,
  `#/dm` (DM Screen), `#/dm/party` (its Party page). `#/quests?new=1`, `#/map?new=1`, `#/compendium?new=1`, `#/wardens-library?upload=1` open the create forms.

## Map tab
- Places are inked map marks (`pins.js`, map.css "Pins"): parchment roundel + type glyph in sepia ink, size by rank, a 32px
  hit box (44px on touch), names lettered under them (Labels on by default); docs/map-model.md "Pins and names".
- Model, routes, ranks and links: `docs/map-model.md`. Controls float over the map: search (top left) with the
  **Maps** button on its right (`collection.js`: every map nested by parent, then the maps of their own, with
  thumbnail, parent, place count and a copy-able `[[map:Name]]` link), the current map's name under them
  (`createCrumbs`: parents as links on sub-maps; DM mode: any map's hide / release switch under it, the main map's
  too); right toolbar Add location, Filter, Labels, Ruler (once a scale is set), ⋯ (Design map…, Rename map… (also the
  name in Edit map's header), Duplicate this map…, Move into another map…, Hide compass, scale and border on this
  device). Big PNG/JPG uploads become same-size WebP (image.js `asWebp`). Places are everyone's to add and edit;
  everything map-wide (new maps, image, name, duplicate, move, delete, zoom bands, offset / scale, design, pictures,
  fog) is the DM's (`data.canDesign()`; anyone while no DM is set up; docs/map-model.md). Parents (`maptree.js`, pure,
  `node tools/test_maptree.mjs`): absent / unknown / looping = the main map, `parent: null` = a map of its own.
  Moving a place (docs/map-model.md "Moving a place"): the panel's Move, Edit map, or the Edit form's Where (Move pin:
  drag / click, kept when the form is saved; or another map: it lands by `data.landingSpot`, then opens there to drag;
  a hidden place moved off a hidden map stays hidden, dm.js releases only current `companions` with a map).
  Linked places (`twins.js`, `node tools/test_twins.mjs`; form "Same place as…"): the same place on several maps shares
  name, type, description and tags (each member holds them plus `same` group id + `sharedAt`; the latest wins on read;
  `saveLocation` writes changes to all members; own map, position, rank, submap); docs/map-model.md "Linked places".
  While the DM hides the main map, players get the first map of its own or "The DM hasn't revealed the map yet." over
  drifting clouds that hide the whole map (`clouds.js`: seamless noise tiles in the background's tones, one small
  canvas at 1/3 scale, ~15 fps, paused out of sight; they part when the map arrives) (`data.mainUnrevealed()`,
  `homeMapId()`; marker `content/map/hidden.json`).
- Design per map (`design` in the map doc: background, crop, compass, scale bar + ruler + travel time, border: 15
  styles picked from pictures, incl. hand-made inked / torn / burnt / ink wash, with corners, second color, mat, gap),
  pictures (`content/map-pictures/`) and fog of war (`content/fog/<mapId>.json` v2: one layer of `areas` {pts, holes,
  on} like the Combat Ring's, Fog / Clearing, lasso / polygon / rectangle / click to reveal / select; players see the map
  fade into its background color and no places under it, the DM sees through it; changes fade in) are edited in Edit map's Design /
  Pictures / Fog tabs (`designpanel.js`; `data.canDesign()` = DM mode, or anyone while no DM is set up).
  docs/map-design.md; `node tools/test_mapdesign.mjs`. Overlays use `layers.js boundsLayer` in their own panes
  (pictures 410, fog 450, border 455, map compass 460, tools 650; pins 601-640).

## DM mode (docs/dm-mode.md)
- Settings → DM mode ("Log in as the DM") -> DM password (set up once from there; `content/dm/vault.json` wraps a random
  data key, PBKDF2 600k). Hidden items are AES-GCM envelopes in `content/dm/hidden/` (random names); while unlocked
  `store.layer` (core/dm.js) shows them at their own paths and seals writes to them. Create hidden with
  `store.put(path, data, {hidden:true})` / `putBinary(…, {hidden})` / `saveCustom(kind, obj, {hidden})`; UI helpers in
  core/dm-ui.js (`hiddenChoice`, `visibilityToggle`, `hiddenMark`); tabs `registerHideable({prefix, label, icon,
  accept, describe})` (accept also bounds the safety net) and redraw on `onDmMode(fn)`. Every create form (quest,
  compendium entry, journal note, library upload, map place) has the switch; each item page has `visibilityToggle`;
  lists show `hiddenMark`. Writes that copy an item (note rename/move, folder move, photos of a note or quest) pass
  `{hidden: isHidden(source)}` so visibility follows the item. `registerHideable` may add `companions(path)` (hidden and
  released together, recorded as `with` in the envelope: a map takes its places, image, pictures, fog, sub-maps; the
  main map every map inside it, not the maps of their own), `releaseBlock(path, data)` (a place of a hidden map can't
  be released alone), `releaseAs(path, data)` (released in another form after a question: a map inside a hidden map
  becomes a map of its own; `releasePlan`, dm-ui `askRelease`, `releaseItem(p, {as: true})`), `afterHide` /
  `afterRelease` (the main map's public marker) and `releaseChoices(path, data)` + `choiceNoun` (a map's hidden places:
  a checklist in the release question, `pickToRelease`; `releaseItem(p, {also, keep})`, one notification for all;
  ⋯ → Reveal hidden places… on a visible map: `releaseTogether`); anything added to a hidden map is hidden. DM Screen tab (views/dm, menu only in DM mode): hidden
  list + Release, released log + Hide again + × (`forgetReleased`: off the list only, the item stays public; optionally
  its Inbox notification too), hide an existing item, Create buttons (New quest, New god, New map…), New-items-hidden default; a second tab **Party**
  (`#/dm/party`, views/dm/party.js + pure party-model.js, docs/dm-party.md): every character on one screen (cards scale
  to fit the view, up to six at a glance in a DM Screen pane) with HP, AC, passive Perception, abilities, conditions
  and a private note each (sealed in `content/dm/party.json`, `dm.js readSealed/writeSealed`), live (core/live.js) with
  GitHub checked every 5-20 s as a fallback; a card opens the sheet. Release posts
  `content/inbox/<stamp>.json`; Inbox in the navigation. In DM mode commit messages carry no names. Crypto tests:
  `node tools/test_dm.mjs`.

## Quests tab
- Quest log (left: Main, then Minor grouped under the main quest they lead to, then Side; symbols crown / diamond /
  chest; Active / Finished / All; search; a quest completed / failed / reopened slides out of the list it left after
  ~1.2 s, `leaveSoon` in index.js; a quest opened from a link, e.g. the Inbox, switches the log to its list, Finished
  or Active, `showInLog`) | open quest (right: image only here, characters, objectives, description,
  rewards, a main quest's minor quests; edited in place). Pure model `views/quests/model.js`
  (`node tools/test_quests.mjs`); docs/quests-model.md. Links (`people.js`): relevant characters are link bodies
  (`char:` sheet, `note:` NPC note = tagged #npc or in an npc/people folder, any other prefix) or plain names, shown as
  chips that open their page; the editor suggests party members, NPCs, notes, other pages; objectives get `[[`
  autocomplete (`wikiSuggest`).

## Pantheon tab
- The gods from `References/pantheon-diagram-and-custom-gods-guide.md` (docs/pantheon-model.md): 14 aspects on three
  nested polygons (Material square, Mental hexagon, Temporal square); a being = one Temporal + 0–2 Mental + 0–2 Material,
  and that recipe is its rank (Absolute God, Major, Minor, Lesser, Angel; 688 possible). Pure model `model.js`
  (`classify`, `catalog`, `pick`, `constituents`, `parseImport` v4 / v3, `rosterMarkdown`; `node tools/test_pantheon.mjs`),
  SVG `diagram.js` (Original shapes / Individual sigil, Major lines, export in plain colors), tab `index.js`: roster by
  rank | diagram (click points to build a combination) | panel (the being, Unassigned + Create, or why not a being) or
  the editor (rank guide, aspect selectors, Title, Domains, Description, Worship; one being per combination, a taken
  one is explained, never overwritten; unsaved changes asked about and kept in `sw:pantheon:draft`). DM mode: a hidden
  being may wait on a shown one's combination; revealing it asks "Reveal and replace?", then deletes the shown one
  (`releaseAs` / `afterRelease`). A being's page lists what links to it (Linked from). Esc lets go of the open being
  (Cancel in the editor). The sigil: tiers (Temporal on top), a mandorla in a glory for a Major God, a radiant
  triangle for a Minor, a diamond for a Lesser God, a pyramid for an Angel, medallions with three letters in Cinzel
  Decorative, inside a seal with the rank and title on its arcs.
  ⋯ imports JSON, exports JSON / Markdown / SVG / PNG (fonts embedded). Sidebar icon `i-pantheon`: the square,
  hexagon and square nested.

## Journal tab
- Obsidian-style vault (docs/journal-model.md): left pane Files (tree, drag-move, context menu) | Search (`tag:`
  `path:` `file:` `"phrase"` `-word`) | Tags (nested); main pane = one journal-shaped page, Read/Edit (Ctrl+E),
  quick switcher (Ctrl+O/K); right pane Properties, Outline, Backlinks (+ unlinked), Outgoing links. The editing view
  is a live-text editor: `#` … `######` lines show at their title sizes while writing (as in reading view).
- Per-device UI state in localStorage `sw:journal:*`. Other views link notes with `href('journal', first || '_', rest)`.

## Warden's Library tab
- `views/wardens-library/`: `files.js` (model: types, display names from file names, shelves = folders, `findDoc`),
  `reader.js` (renders one document by type), `upload.js` (stage files with `putBinary`), `index.js` (shelves +
  reader routing, `[[doc:…]]` link type). Per-device settings `wlSort`, `wlLayout`, `wlInfoCollapsed`.
- Reader head: breadcrumb + "Hide details" toggle, title, meta line (type, size, file), actions (shelf steps,
  Download, Open in new tab, Rename, Remove). Folded (`wlInfoCollapsed`, `.wl-reader.is-folded`) it is one slim bar:
  back arrow, title, the reading actions (incl. Rename) as icons, "Show details". PDF iframe, image stage and video
  fill the rest of the view (flex; the image/video stage is a `container-type: size` box), so folding gives them the height.
- Rename (`renameDoc(doc)` in index.js; reader head, table row, card tools): the user edits the display name only;
  extension and shelf stay, the name goes through `safeFileName`; empty/unchanged/clashing (case-insensitive) names are
  refused with a toast. Copies the blob to the new path (`putBinary`), `store.remove`s the old one (an unsaved upload
  is simply dropped), and an open document follows with `navigate(…, {replace:true})`; then `saveSoon` commits it.
  Known gap: `[[doc:Old name]]` links are not rewritten (same as map renames).

## Landing page (`#/home`)
- `views/home` + `home.css`: the campaign poster, "Open the map" and links to the other tabs. No tab (`menu: false`,
  loaded by main.js `loadHome`); the sidebar title (`a.sb-title`) opens it. First visit: `routeFirstVisit()` (before
  `start`) sends a URL without a route to `#/home` while localStorage `sw:home:seen` is unset; showing the page sets
  it; deep links are left alone. The poster's lettering is painted in, so home.css never distorts it or crops into it
  (container-query sizing: at most 5% off top/bottom, 3% off each side); leftover bands show the backdrop image (the
  poster's edges extended and blurred) at the poster's scale. Links sit under the painted subtitle on large views, on
  the grass below the poster on small ones.

## Characters tab
- Engine (pure, Node-testable): `engine.js` facade + `engine-{rules,choices,derive,adjust,items,known,spells,actions,prof,tags,xp,util}.js`
  (prof = "proficient / not proficient" labels for pickers and entry modals; tags = Smart features view tags).
  Contract and doc shape: `docs/character-model.md`. `derive()` -> Sheet incl. `adjust[key] = {base, value, reasons}`
  (debuffs already applied to the shown numbers; UI renders them with widgets.js `adjustedValue(sheet, key, text)`).
- Doc fields beyond the basics: `overrides.proficiency` (final say on skill/save prof), `style.accent` (highlight
  color, default `#7a1f1f`), `xpLog`, `levelOrder`, `abilities[].tags` (manual Smart tags). Deleting moves a sheet to `recently-deleted/` (trash.js).
- Sheet style (`skin.js`, pure + Node-tested): `style.{page, panel, border}` colors, `borderStyle`, `borderWidth`,
  `corners`, `headingFont`, `textFont` (whitelisted ids / #rrggbb, null = default; `normalizeStyle` on read),
  presets `SKIN_PRESETS`, edited in Edit all → Sheet style (live preview). `applySkin(el, style)` sets custom
  properties + `data-ground` / `data-sk-*` on the characters `.view` while a sheet shows (index.js `clearSkin`
  on every other route). `data-ground="light|dark"` switches the whole token set (tokens.css) for that subtree;
  ink is computed per color (>= 4.5:1). Only colors, edges, corners and fonts change, never the layout.
- Print and Paper Companion (docs/character-model.md "Printouts & Paper Companion"): two small buttons under the portrait,
  each describing itself on hover. Print -> popover: Major points (stats that rarely change) or Detailed sheet (as it
  stands, inventory included), each PDF or Grayscale, downloaded at once (jsPDF in the browser; content `print-model.js`,
  pure; layout `print-pdf.js`; `node tools/test_print.mjs`). Companion -> the Paper Companion view (`companion.js`,
  device setting `chCompanion`, off by default): only what changes in play on one screen (HP, conditions & hit dice,
  coins, slots with their spells, feature uses, inventory; rows open for details), plus Features & traits to look up
  (search by name, All | Smart tags as on the sheet; placed under the shortest column, list fitted to the screen). Vision "Normal (2 mi)" in the header.
- Sheet order: header row (portrait with Print / Companion under it, name, XP meter, action buttons | HP, folded, with the "Hide / Show trackers"
  button under it | Death saves | AC · Initiative · Speed · Prof, one line when wide, 2 × 2 when tighter, the
  combat boxes on their own line under the identity when narrow; slim Vision / Darkvision cells under the stat boxes
  (under Speed and Prof in the 2 × 2 grid, each under two boxes in one row of four) in room the header already has,
  inside the Speed and Prof boxes on phones, so the header never grows for them) ->
  abilities row | one-line "Hit dice & conditions" panel (hit dice, inspiration star, exhaustion, conditions;
  shown by default, setting `chTrackersShown`; beside the abilities, below them when narrow; while hidden, active
  conditions show as chips in the HP widget) -> narrow column skills, senses, proficiencies (foldable) | wide column actions window (tabs
  Attacks / Spells / Bonus actions),
  resources, inventory, currency, features (All | Smart tag view; compact rows, groups flow through two columns)
  -> details, notes. Tuned for the collapsed sidebar (container queries).
- Pips (widgets.js `pips`): slots, hit dice and feature uses are solid while left, spent from the right (a click on a
  solid pip spends one, on a hollow one gets one back); exhaustion marks fill from the left, clicked to a level.
- Spells tab: casters line, one-line slot pips, then one spell per row in columns (prepare | name | time | range |
  hit/DC | effect | remove; the level headings label the columns; two lines below 640px of list width). Filter bar
  (4+ spells): level chips, Prepared, Favorites (while a listed spell is starred), name search, effect chips (Damage,
  Healing, each damage type present, Concentration, Ritual, Bonus action, Reaction); one choice per group, all combined. Pure helpers in engine-spells.js
  (`spellFxKeys`, `spellPasses`, `spellFilterOptions`, `shortCastingTime`, `shortRange`); the sheet only toggles
  `hidden` on rows (state per character for the session), so typing never repaints the sheet.
- Add spells picker (sheet.js `addSpells`): a limits box on top (`spellLimitsBox`, picker option `head`) shows the
  caster line's Cantrips / Prepared / Spellbook counts including the ticked spells; going over is allowed (red count +
  note, no notice dialog for a shown limit); a spellbook caster's spells past the prepared limit go in unprepared
  unless "Prepare past the limit" is ticked. Off-list / too-high spells still get the "Not a usual pick" notice.
- Favorites: doc field `favorites {items: [inventory uid], skills: [skill id], features: ['<sourceType>:<id>'],
  spells: ['<source group>:<spell id>']}` (spell key per sheet row, `spellFavKey`: `class:wizard:fire-bolt`,
  `feat:magic-initiate:fire-bolt`; pure helpers in `engine-favs.js`, normalized in data.js `normalize`; removing a
  stored spell calls `dropSpellFavorite`). A gold-star "Favorite" toggle sits in each entry's own menu (item edit +
  info modals, skill modal from the skill name, expanded feature row, feature modal, spell modal from the spell name;
  spell rows also get a small star toggle on mouse hover, laid over the name cell); starred entries show a star in
  their row, sort first in their list (spells: in their level), and fill a "Favorites" tab placed first in the
  actions window (shown only when something starred exists; star-only label on phones; spells there use the Spells
  tab row, so their chips roll).

## Testing
- Local: `python -m http.server 8000` in repo root, open `http://localhost:8000/?sandbox` (IndexedDB backend).
- Rules engine: `node tools/test_engine.mjs` and `node tools/test_spells.mjs` (spell numbers, XP, spell filters; both must stay
  green; add cases when changing engine*.js). Sheet style: `node tools/test_style.mjs` (sanitising, presets, contrast). Quests: `node tools/test_quests.mjs`. Map design and fog: `node tools/test_mapdesign.mjs`. Map parents / maps of their own: `node tools/test_maptree.mjs`. Linked places: `node tools/test_twins.mjs`. Pantheon model: `node tools/test_pantheon.mjs`. Live editor text model: `node tools/test_livetext.mjs`. Character printouts: `node tools/test_print.mjs`. Party view and live messages: `node tools/test_party.mjs`. DM crypto: `node tools/test_dm.mjs`. `node tools/audit_spells.mjs` lists spells whose text implies numbers
  the sheet doesn't show (11 known, intentional gaps).
- Syntax: portable `node --check`. Markdown renderer can be exercised in Node by stubbing `DOMPurify.sanitize`.

## Status (2026-10-21)
All tabs built and browser-QA'd (headless Chrome via CDP; Chrome extension was not connected). Pages live at
https://blobberus.github.io/Stone-Wardens/. **Pending owner action:** create the fine-grained token and run
`setup.html` (no `vault.json` yet). Known gaps: stub subclass/species mechanics beyond `engine-known.js` are prose
only; feat prerequisites flagged not enforced; no two-weapon attacks; map pin rename doesn't rewrite old links;
no PDF thumbnails (no pdf.js); stub entries marked `verify:true` need checking against the books.

## UI / CSS conventions
- Use tokens from `tokens.css` only (`--bg --surface --surface-2 --ink --ink-muted --accent --accent-ink
  --danger --ok --border --font-display --font-body --font-mono --radius --shadow --space-1..6`).
- Icons: `icon(name)` -> sprite `assets/img/icons.svg#i-<name>`; map-marker glyphs are `mk-<name>` (pass `'mk-city'`).
- Shared classes (base.css): `.btn .btn-primary .btn-ghost .btn-danger .btn-sm .btn-icon`, `.input .select
  .textarea .field`, `.card .panel .badge .chip .table .toolbar .tabs .tab .muted .stack .row .grid
  .empty-state .prose` (rendered markdown) `.callout`.
- Each view owns `assets/css/<view>.css`, classes prefixed by view (`.map-`, `.ch-`, `.jr-`, `.cp-`, `.wl-`).
- Design direction: medieval manuscript but highly readable (D&D wiki clarity). See `docs/design.md`.
