# Pantheon (Pantheon tab, `#/pantheon`)

The campaign's gods, built from the three-polygon pantheon in
`References/pantheon-diagram-and-custom-gods-guide.md` (the guide). Code: `assets/js/views/pantheon/`
(`model.js` pure, `diagram.js` drawing, `index.js` the tab), `assets/css/pantheon.css`; tests `node tools/test_pantheon.mjs`.

## Aspects and ranks
- Three polygons share a centre, outermost first: **Material** square (Metal, Water, Fire, Air; radius 0.43 W, first
  point at −45°), **Mental** hexagon (Strength, Dexterity, Constitution, Wisdom, Intelligence, Charisma; 0.255 W, −60°),
  **Temporal** square (Decay, Growth, Stasis, Equilibrium; 0.13 W, −45°). Points go clockwise in that order, so Metal and
  Decay sit upper right and Strength at the hexagon's upper right. Stable ids `group:name` (`temporal:equilibrium`).
  "Equilibrium" replaces the old "Stabilization" everywhere (`temporal:stabilization` is read as Equilibrium).
- A being has exactly one Temporal aspect; its Mental and Material count set the rank (`model.js RANKS`):
  Absolute God 1-0-0 (dot) · Major God 1-1-0 (line) · Minor God 1-2-0 (triangle) · Lesser God 1-2-1 (rectangle) ·
  Angel 1-2-2 (pentagon). Nothing else is a being (`classify` explains why: Material before two Mental, two Temporal…).
  4 + 24 + 60 + 240 + 360 = **688** possible combinations (`catalog()`), most of them unassigned at any time.
- A combination's id is its aspect ids sorted and joined with `|` (the guide's), so pick order never matters.
  The chain (`constituents`): every lower combination whose aspects all belong to a being; `containers` the higher ones.

## Files
- One being per file: `content/pantheon/<slug>-<id4>.json` (`util.uid(title)`; the file keeps its name when the
  aspects change). `{id, aspects, rank, title, domains: [..], description, worship, by, created, updated}`: the guide's
  six characteristics + combination id, rank and id always recomputed from the aspects on read and write
  (`normalizeBeing`, `beingDoc`). Description and Worship are Markdown (rendered with `[[links]]`), Domains a list.
- One being per combination: the editor refuses a taken one (it explains and offers to open the being there). Two
  files with the same aspects can still arrive (two devices at once, or one hidden by the DM): both are listed, the
  later flagged (`roster` `twin`), and the earliest made holds the combination (`occupants`).
- Anyone can add, edit and delete beings. DM mode: a new being can be made hidden (`hiddenChoice`), an existing one
  hidden / released with `visibilityToggle` (`registerHideable` prefix `content/pantheon/`); hidden ones show a lock.
- Links: `[[pantheon:Title]]` (or the title alone, or aspect names joined with `+`) opens a being (`findBeing`).

## The tab
- Roster (left): beings by rank with `saved / possible` per rank, "N custom entries saved · 688 possible
  combinations", search by title, domain or aspect. Empty: "Start with the guide's five examples" (Section 7, one per
  rank; ordinary beings to edit or delete).
- Diagram (middle, `diagram.js drawDiagram`): **Original shapes** (default) keeps all three polygons and 14 points in
  sight; the picked points show as a ring (Absolute), line (Major), triangle (Minor) or closed outline (Lesser, Angel:
  points sorted by angle round their centroid, `outline`), dashed when not a valid being. Clicking points builds a
  combination (`pick`: a second Temporal replaces the first, a third Mental / Material the earliest one; clicking one
  again drops it); keyboard: Tab to a point, Enter / Space. **Esc** (not while typing) lets go of the open being and
  the picked points (as Clear does); in the editor it is Cancel (asked first when there are changes). **Major lines**
  draws the 24 Temporal–Mental lines, assigned ones solid (clickable). **Individual sigil** draws the picked being alone
  in tiers, the inner polygons' points higher (`sigilPoints`): Temporal on top, Mental under it, Material lowest; a dot
  (Absolute God, a sun of rays round it), a vertical line (Major), an equilateral triangle (Minor), a diamond (Lesser:
  the Mental pair across, Material at the bottom) or a pyramid (Angel: the Minor triangle with the Mental pair halfway
  down its sides and the Material pair as its base), tips on a dashed circle, gilt edges. Each aspect is a medallion
  in its group's color with three letters in Cinzel Decorative (`Str`, `Equ`: its ornamented capital, then plain
  ones; loaded in index.html for this alone). Round it a seal: beaded rim, double rings, ticks, a lozenge at each
  side, the rank on the top arc and the being's title (or, unassigned, its aspects) on the bottom one, squeezed when
  long. Under it: the picked aspects as chips and the rank they make. Label size follows the drawing's width (about
  13 px on screen). Per device: `sw:pantheon:ui` {view, majorLines}.
- Panel (right): the open being (rank badge, title, aspects, Temporal meaning, domains, description, worship, "In the
  chain": what it is made of, each with its being or "Unassigned" + Create, and the saved beings it is part of); an
  unassigned combination ("Create this Major God"); why picked points are not a being yet; or the rank table.
  `#/pantheon/<file>` opens a being; picking points that make a saved being opens it (the address follows).
- Editor (Add custom being, Edit, Create): Rank to build (a guide for which selectors show: Temporal, Mental 1–2,
  Material 1–2; the paired selector's choice is disabled), the rank the chosen points make (read-only; the rank always
  follows the aspects), Title (required), Domains (one per line), Description, Worship. Points clicked on the diagram
  change the editor's aspects. Save entry checks the combination and the title; a taken combination is never
  overwritten. Leaving with unsaved changes (roster, links, another Create) asks Save / Discard / Keep editing.
  Unsaved changes are kept on the device (`sw:pantheon:draft`) and come back after a reload.

## Import and export (⋯)
- Export pantheon JSON: the guide's version 4 document `{version: 4, groups, nodes, gods: [{id, aspects, rank, title,
  domains, description, worship}], viewState}` (`exportDoc`).
- Import pantheon JSON (`parseImport`): reads version 4, version 3 (`powers` → aspects, `name` → title, `domain` →
  one domain, `charge` → description, worship empty) and a bare list; the whole file is checked first. Invalid
  aspects, a missing title or two records with the same aspects: nothing is imported, each problem listed. Otherwise a
  summary: add the new ones (beings here keep their combinations) or replace the whole pantheon.
- Export roster Markdown: the guide's template per being, grouped by rank (`rosterMarkdown`).
- Export diagram (or sigil) SVG / PNG: the current view and selection in the light theme's colors, with a heading
  ("The Pantheon" or "Sigil of …") and a two-line caption (rank and title, aspects); PNG 2000 × 2000. The fonts go
  inside the file (`withFonts`: Google Fonts subsets of just the letters used, as data URLs), since an SVG opened
  elsewhere or drawn into the PNG can't load the page's; offline the file only names them.
