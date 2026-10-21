# Stone Wardens: design system

**Concept.** The app is a warden's codex: vellum pages in iron-gall ink, titles cut in inscriptional capitals like the
wardens' stones, and oxblood rubrics marking where each entry begins. Lapis marks cross-references, and gold leaf appears
only where a star has fallen (the emblem, highlights, the selected pin). The night theme turns the vellum to basalt.

**Files.** Load `vendor/leaflet/leaflet.css`, `tokens.css`, `base.css`, `shell.css`, then `<view>.css`. Use tokens only, never
raw hex. Theme: `<html data-theme="dark">` (light is the default). `docs/preview.html` shows every component (serve over http).

## Palette (tokens.css; every text pair passes WCAG AA in both themes)
- Ground `--bg` (vellum, also the sidebar). Lifted page `--surface` (cards, panels, inputs, modals). `--surface-2` for hover,
  zebra rows, code and toolbars; `--surface-3` for pressed/active. `--bg-sunk` for wells and tracks.
- Ink `--ink` for all running text. `--ink-muted` for labels and meta. `--ink-faint` for placeholders only.
- Lines: `--border` (card edges), `--border-strong` (control edges, 3:1), `--rule` (row rules inside a surface).
- `--accent` (rubric) has exactly three jobs: **the one primary action per screen**, **prose headings h1–h3**, and
  **"you are here"** (active nav icon, active tab underline, selected row edge). `--accent-soft` is the selected-row wash.
- `--link` (lapis) for links, wikilinks and tags. `--focus` for rings. `--gold` for ornament only (never text). `--gold-soft` = `mark`.
- Status: `--ok --warn --danger --info`, each with a `-soft` pale pair for pills and toasts (dark text of the same hue).
- Callout pigments `--c-note … --c-quote`. Map pins (location-type swatches): `--pin-ink -rubric -vermilion -lapis -verdigris
  -green -ochre -gold -murrey -slate -umber`, glyph `--pin-glyph`. Default pin `--pin-ink`; selected pin gets a 2px `--gold` ring.

## Type
Google Fonts: Cinzel 500–700, Alegreya 400/500/700 + italics, Alegreya Sans 400/500/700 + italic.
- `--font-display` **Cinzel**: view titles (h1), modal/drawer titles, prose h1/h2, the gate. Only at 20px and up, never body.
- `--font-body` **Alegreya**: reading, prose, card titles (700), table cells. `--font-ui` **Alegreya Sans**: controls, nav,
  labels, badges, toasts, dense lists. `--font-mono`: real code only (system stack).
- Sizes: `--text-xs` 14 (meta, badges), `--text-sm` 16 (UI, tables), `--text-md` 17 (body), `--text-lg` 20 (card/modal
  titles, prose h3), `--text-xl` 24 (view h1, prose h2), `--text-2xl` 30 (note title / prose h1). Nothing below 14px.
- `.num` (tabular figures) on every number in a column, stat block or counter; right-align numeric columns (`td.num`).

## Space and shape
`--space-1..8` = 4 8 12 16 24 32 48 64. Card padding 16, gaps 16, section gaps 32. Controls 36 (`--control-h`) / 30
(`--control-h-sm`); 40–48 on phones (base.css does it). Radii: `--radius` 6 (cards, inputs), `--radius-sm` 4 (buttons,
badges), `--radius-lg` 8 (modals), `--radius-pill` (tags, chips). Use a 1px border **or** a shadow, never both;
`--shadow`/`--shadow-lg` only on things that float (menus, popovers, toasts, modals, drawers, map controls).

## Components (base.css)
- Buttons: `.btn` (secondary), `.btn-primary` (one per screen), `.btn-ghost` (tertiary/toolbar), `.btn-danger` (pale red,
  solid on hover), `.btn-sm`, `.btn-icon` (needs `aria-label` + `title`), `.is-loading`. Icons: `<svg class="icon">`.
- Forms: `<label class="field"><span>Label</span><input class="input"></label>`, `.field-hint`, `.field-error`,
  `.field-grid` (multi-column), `.select`, `.textarea`, `.search` (input with leading icon), `.checkbox`.
- Containers: `.card` (object tile; `a.card` interactive, `.is-selected`), `.panel` + `.panel-head/-body/-foot` (a region),
  `.grid` (`--grid-min` = tile width), `.stack`, `.row`, `.spacer`, `.divider`.
- `.badge` (+ `-accent -ok -warn -danger -info`) sits beside a value, never above a heading. `.chip` for filters (`.is-active`).
- `.table` in `.table-wrap`: wiki-style small-caps headers (write them in sentence case), zebra rows, `.cell-name` (identity
  column), `tr.is-clickable`, `tr.is-selected`, `.table-dense`, `.table-sticky`.
- `.tabs > .tab.is-active` (underline). `.toolbar`: search left, filters, `.spacer`, count/actions right.
- `.empty-state`: keep the frame, write one sentence in the game's words, and add the first action.
- Overlays (built by `ui.js`): `.modal(-wide)` with `-head -body -foot -close`, `.drawer` (`.is-left`, `.is-inline`),
  `.toasts > .toast-info|-success|-error`, `.picker`. Editor: `.md-editor .md-toolbar .md-input .md-preview .md-suggest`.
- `.prose` for **all** rendered markdown (the preview is `class="md-preview prose"`). It styles wikilinks (`.is-unresolved`
  dashed), `a.tag`, `a.external`, task lists, `mark`, `.embed`/`.embed-title`, `hr` (an asterism) and callouts. Callout
  icons are drawn by CSS, so don't insert one. `.prose.has-initial` gives an illuminated first letter (chapter openers only).

## Shell (shell.css)
- Desktop: the toggle sets `.is-collapsed` (60px icon rail; give every `.sb-tab` a `title`). Below 760px the sidebar is a
  52px top bar and the toggle sets **`.is-open`** instead (full-screen sheet; close it on navigation).
- `.sb-status[data-state=clean|dirty|saving|error|sandbox]`. Map view: `padding:0; overflow:hidden`; other views scroll.
- View header: `<header class="view-head"><h1 class="view-title">Journal</h1><div class="view-actions">…</div>
  <p class="view-sub">one line about the data</p></header>`. The title is a noun, never a greeting.
- List + detail: `<section class="view split">` with `.split-list` + `.split-main`; `.nav-list > .nav-item`, `.nav-group`.
  Below 900px one pane shows at a time; `.is-detail` shows the main pane.
- Emblem: `<svg viewBox="0 0 48 48"><use href="assets/img/icons.svg#i-emblem"/></svg>`. It takes `color` and
  `--emblem-star` (both set inside `.gate-mark` and `.sb-mark`).

## Icons
`assets/img/icons.svg`: `i-*` are 24px outline icons (16–20px in use, currentColor); `mk-*` are filled marker glyphs drawn
for 16px inside a 28–32px pin. One plain icon where it helps a label. Never put icons in tinted squares or circles.

## Do / Don't
- Do show real campaign data at its real size (names, levels, HP, dates). Print zeros as zeros and missing values as "—".
- Do use one primary action per view, where the job is done. Keep colour on meaning (status, selection, rubric).
- Do keep visible focus on everything and a hover state on every row and control. Motion is feedback only.
- Don't use gradients, glows, glass/blur, text shadows, shadows on resting cards, emoji, lorem, or `alert/confirm/prompt`.
- Don't put icons in tinted circles or give categories rainbow colours (use the pin pigments). Don't put accent on every
  button or on headings outside prose. No Cinzel below 20px, no tracked uppercase labels, no decorative 01/02 numbering.

## View CSS
Each view owns `assets/css/<view>.css` and prefixes every class: `.map-` `.ch-` `.jr-` `.cp-` `.wl-` (settings: `.st-`).
Don't restyle shared classes globally; scope tweaks (`.ch-sheet .card {…}`). Shared needs go in base.css; tell the lead.
