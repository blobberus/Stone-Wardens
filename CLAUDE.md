# Stone Wardens — campaign site (CLAUDE.md)

Password-gated D&D 5e (**2024 rules / SRD 5.2**) campaign site on GitHub Pages for repo
`blobberus/Stone-Wardens`. The original brief is `The Stone Wardens - A Fallen Firmament Campaign(1).md`.
Tabs: **Map**, **Characters**, **Journal**, **Compendium** (SRD + custom library), **Warden's Library**
(renders PDFs/DOCX from `wardens-library/`), **Settings**.

## Hard rules
- **No build step.** Plain HTML/CSS + native ES modules. No npm deps at runtime; libs are vendored in `vendor/`
  (leaflet 1.9.4, marked 18, dompurify 3, js-yaml 5 [`load`/`dump`], mammoth 1.13 browser build = global `mammoth`).
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
assets/img/           icons.svg (sprite, <symbol id="i-NAME">), placeholder-map.svg
assets/js/main.js     boot: gate -> store.load -> register views -> router.start
assets/js/core/       shared infrastructure (see contracts below) — views must not reimplement these
assets/js/views/<v>/  one folder per tab: map, characters, journal, compendium, wardens-library, settings
srd/                  generated SRD 5.2 JSON (tools/build_srd.py) + srd/stubs/*.json; read-only at runtime
content/              ALL user data, written by the site through the GitHub API
  characters/<id>.json  characters/recently-deleted/<id>.json (trash, `trashed:{at,by}`)
  locations/<id>.json (optional `map` sub-map id, `submap` it opens, `rank` 1-4)  map/config.json (+ map image)
  maps/<mapId>.json + maps/<mapId>/<image>   sub-maps {id,name,parent,image,width,height}; docs/map-model.md
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
- Every edit is saved immediately as a local draft (localStorage) -> survives reloads. "Save" (Ctrl+S) commits
  all dirty docs. `beforeunload` warns when uncommitted. Optional auto-commit (Settings). Auto-pull on focus/2 min.
  `main.js` `wireSaving` auto-saves `autoSaveMinutes` (default 5, 0 = off) after the first unsaved change; with that
  and auto-commit off it shows a "Save now" toast after `saveReminder` minutes instead. Views call `saveNow()` from
  `core/saving.js` for a Save button that behaves like the sidebar one.
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
  `markdownEditor({value, onInput, rows})` (textarea + [[link]] autocomplete + preview toggle).
  NEVER use window.alert/confirm/prompt.
- `store.js` (singleton `store`): `load()`, `list(dir, {recursive})` -> `[{path, data}]`, `get(path)`,
  `put(path, data)` (object -> JSON; string -> text), `remove(path)`, `putBinary(path, blob)`,
  `fileUrl(path) -> Promise<objectURL>`, `fileBlob(path)`, `files(prefix)` -> `[{path,size,sha}]` (any type),
  `on(fn) -> unsubscribe` (events `{type:'put'|'remove'|'load'|'saved'|'pulled', path?}`),
  `isDirty(path?)`, `dirtyPaths()`, `save(message?)`, `pull()`, `mode` ('github'|'sandbox').
- `router.js`: hash routes `#/<view>/<...parts>?query`. `registerView({id, title, icon, order, mount(el),
  show(route), hide?()})` — mount once (lazy), views stay mounted (map is never re-created).
  `navigate(href)`, `href(view, ...parts)`, `current()` -> `{view, parts, query}`.
- `links.js`: `registerLinkType(prefix, {label, resolve(target, anchor) -> {href,title,exists}|null,
  suggest(q) -> [{label, value}]})`. `resolveLink(raw)`; un-prefixed `[[X]]` -> journal note, else first exact
  name match across types, else unresolved (click offers to create note).
  Prefixes: `map:` locations and sub-maps (place id > map id > place name > map name; `[[map:Map#Place]]`), `char:` characters (`[[char:Name#hp]]` anchors a sheet section/stat),
  `note:` journal, `folder:` journal folder (legacy `chapter:`), `doc:` warden's library, compendium kinds: `weapon: armor: gear: item: spell: feat:
  ability: species: class: subclass: background:`.
- `markdown.js`: Obsidian-flavoured: `[[wikilinks|alias]]`, `[[x#heading]]`, `![[embed]]` (notes/images),
  `> [!type]± title` callouts, `==highlight==`, `%%comment%%`, `#tags`, task lists, tables, GFM autolinks,
  YAML frontmatter. `renderMarkdown(src) -> safe HTML`, `renderInto(el, src)` (wires links/embeds/folds),
  `parseFrontmatter(text) -> {data, body}`, `stringifyFrontmatter(data, body)`, `extractLinks(src)`.
  Use it for every user description (pins, custom items, abilities) so links are hyperlinked by default.
- `compendium.js`: merged SRD + stubs + custom: `KINDS`, `entries(kind)` -> Promise<array>, `cached(kind)` (sync,
  after `preloadAll()`), `entry(kind, id)`, `findByName(kind, name)`, `saveCustom(kind, obj)`, `removeCustom`,
  `srd(name)` raw loader (`srd('rules')`, `srd('features')`). Every entry has `kind` and
  `origin: 'srd'|'stub'|'custom'` (`source` = book name for stubs). Custom overrides same id.
- `settings.js`: `getSetting(k)`, `setSetting(k,v)` (playerName, autoSaveMinutes, autoCommit, autoCommitDelay, saveReminder, theme, sidebarCollapsed, sheet fold keys).
  localStorage `sw:settings` holds only values that differ from DEFAULTS (`_v: 2`), so changing a default reaches
  everyone who never picked one; v1 blobs (every key) are migrated once on read.

## Views
- `assets/js/views/<id>/index.js` default-exports `{id, title, icon, mount(el), show(route), hide?()}`; `main.js`
  imports the ids in `VIEW_IDS` (a failed import shows an error tab instead of breaking the app). Views register
  their link types at import time and re-render from `store.on` events.
- Routes: `#/map[/loc/<id>]`, `#/map/m/<mapId>[/loc/<id>]` (sub-maps), `#/characters[/<id>[/<section>]]`, `#/journal[/_|/<folder…>[/<note>]][?h=|q=|tag=|folder]`,
  `#/journal/new?title=`, `#/compendium[/<kind>[/<id>]]`, `#/wardens-library[/<path…>]`, `#/settings`.

## Journal tab
- Obsidian-style vault (docs/journal-model.md): left pane Files (tree, drag-move, context menu) | Search (`tag:`
  `path:` `file:` `"phrase"` `-word`) | Tags (nested); main pane = one journal-shaped page, Read/Edit (Ctrl+E),
  quick switcher (Ctrl+O/K); right pane Properties, Outline, Backlinks (+ unlinked), Outgoing links.
- Per-device UI state in localStorage `sw:journal:*`. Other views link notes with `href('journal', first || '_', rest)`.

## Characters tab
- Engine (pure, Node-testable): `engine.js` facade + `engine-{rules,choices,derive,adjust,items,known,spells,actions,prof,tags,xp,util}.js`
  (prof = "proficient / not proficient" labels for pickers and entry modals; tags = Smart features view tags).
  Contract and doc shape: `docs/character-model.md`. `derive()` -> Sheet incl. `adjust[key] = {base, value, reasons}`
  (debuffs already applied to the shown numbers; UI renders them with widgets.js `adjustedValue(sheet, key, text)`).
- Doc fields beyond the basics: `overrides.proficiency` (final say on skill/save prof), `style.accent` (highlight
  colour, default `#7a1f1f`), `xpLog`, `levelOrder`, `abilities[].tags` (manual Smart tags). Deleting moves a sheet to `recently-deleted/` (trash.js).
- Sheet order: header row (portrait, name, XP meter, action buttons | HP, folded, with the "Hide / Show trackers"
  button under it | Death saves | AC · Initiative · Speed · Prof, one line when wide, 2 × 2 when tighter, the
  combat boxes on their own line under the identity when narrow) ->
  abilities row | one-line "Hit dice & conditions" panel (hit dice, inspiration star, exhaustion, conditions;
  shown by default, setting `chTrackersShown`; beside the abilities, below them when narrow; while hidden, active
  conditions show as chips in the HP widget) -> narrow column skills, senses, proficiencies (foldable) | wide column actions window (tabs
  Attacks / Spells / Bonus actions),
  resources, inventory, currency -> features (All | Smart tag view) -> details, notes. Tuned for the collapsed sidebar (container queries).
- Favourites: doc field `favorites {items: [inventory uid], skills: [skill id], features: ['<sourceType>:<id>']}`
  (pure helpers in `engine-favs.js`, normalized in data.js `normalize`). A gold-star "Favourite" toggle sits in each
  entry's own menu (item edit + info modals, skill modal from the skill name, expanded feature row, feature modal);
  starred entries show a star in their row, sort first in their list, and fill a "Favourites" tab placed first in the
  actions window (shown only when something starred exists; star-only label on phones).

## Testing
- Local: `python -m http.server 8000` in repo root, open `http://localhost:8000/?sandbox` (IndexedDB backend).
- Rules engine: `node tools/test_engine.mjs` and `node tools/test_spells.mjs` (spell numbers, XP; both must stay
  green; add cases when changing engine*.js). `node tools/audit_spells.mjs` lists spells whose text implies numbers
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
