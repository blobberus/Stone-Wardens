# Map model (Map tab)

Code: `assets/js/views/map/` — `index.js` (view, routes, markers, hierarchy panes), `data.js` (documents, maps
registry, `map:` link type), `maptree.js` (which map sits inside which; pure, `node tools/test_maptree.mjs`),
`raster.js` (image tiles), `zoom.js` (smooth zoom), `ranks.js`, `edit.js` (edit mode),
`submaps.js` (create / move / delete dialogs), `drawer.js`, `controls.js` (search, filter, ⋯ menu, breadcrumb, popover helper),
`collection.js` (the "Maps" button and the map collection), `image.js`, `pins.js`, `typeform.js`. Styles: `assets/css/map.css`.
Design (background, crop, compass, scale and ruler, border), pictures on maps, fog of war and duplicating maps:
`docs/map-design.md` (`design.js`, `decor.js`, `pictures.js`, `fog.js`, `fogdraw.js`, `fogview.js`, `designpanel.js`, `layers.js`).

## Documents

| What | Path | Notes |
|---|---|---|
| Main map | `content/map/config.json` | `{image, width, height, name, rankBands?, design?}` — unchanged from before sub-maps |
| Main map image | `content/map/<file>.<ext>` | |
| Main map hidden | `content/map/hidden.json` | `{hidden: true}`, public, only while the DM hides the main map (see below) |
| Sub-map | `content/maps/<mapId>.json` | `{id, name, parent, image, width, height, createdBy, created, updated, rankBands?, design?, copiedFrom?}` |
| Sub-map image | `content/maps/<mapId>/<file>.<ext>` | |
| Place | `content/locations/<id>.json` | every place on every map; `same` + `sharedAt` when linked (below) |
| Picture | `content/map-pictures/<id>.json` | an image laid on a map (`docs/map-design.md`); the file in `content/media/map-pictures/` |
| Fog | `content/fog/<mapId>.json` | the map's fog of war (`docs/map-design.md`) |

- The main map's id is the reserved word `main`; sub-map ids are `uid(name)` (`duskhold-k3x9`), filename = id.
- `parent`: the map it sits inside (`main` or another sub-map id). Absent, empty, unknown, self or cyclic parents are
  treated as `main` (so old documents keep working; a loop breaks at its first map by id). Sub-maps nest to any depth;
  the breadcrumb follows `parent`.
- `parent: null` (written out) = **a map of its own**: not linked to the main map. It is listed at the top level of
  the Maps collection, after the main map and its tree ("Map of its own"), its breadcrumb starts with itself, and it
  stays visible when the DM hides the main map. Its own sub-maps nest under it as usual. The new-map and duplicate
  dialogs' "Inside" select offers "No parent (a map of its own)"; ⋯ → **Move into another map…** (DM only) moves a
  sub-map, with everything on it, into another map or out to a map of its own (`data.moveMap`; never into itself or
  one of its own sub-maps; into a hidden map it is hidden too). Deleting a map of its own turns its sub-maps into maps
  of their own and moves its places to the main map (or deletes them).
- **The main map hidden (DM mode, docs/dm-mode.md).** `content/map/config.json` is sealed with everything on and in
  it, and the public marker `content/map/hidden.json` says so. For a viewer who can't read it (players, the DM with DM
  mode locked: `data.mainUnrevealed()`), the main map is not in `maps()` / `mapById()` / links / search;
  `homeMapId()` is the first map of their own, which `#/map` shows (the hash becomes `#/map/m/<id>`), or, when there is
  none, "The DM hasn't revealed the map yet." over drifting clouds that hide the whole map (clouds.js), without the
  tools; the clouds part (fade out) when the map arrives. A map whose parent would be
  the main map then shows as a map of its own. Without the marker, a missing config.json is still the placeholder
  "The Uncharted Realm", as on a fresh site. Players who have the map open move over when the change arrives
  (index.js `runSync`).
- `image: ""` (or the placeholder path) = the blank parchment placeholder; `width/height` are the image's pixel
  size and define the coordinate space (pins are stored in image pixels, origin top-left).
- `rankBands` (optional): `[[from,to] × 4]` in percent of the map's zoom range (see Hierarchy). Absent = defaults.
- `name`: shown in the name plate; renamed from ⋯ → Rename map… or by clicking the name in Edit map's header. The main
  map's default is "The Uncharted Realm" (this campaign: "Caspernos and Surrounding Lands").
- Uploads (`image.js chooseImage`): a PNG or JPG of 3 MB or more is re-encoded in the browser as a WebP of the same pixel
  size (quality 0.9, transparency kept) when that is at least 20% smaller; everyone downloads the map, and a 28 MB PNG
  export is ~2.4 MB as WebP. The main map's image is `content/map/map-of-caspernos-and-surrounding-lands.webp`.

Place fields (new ones are optional, so old documents keep working):

```json
{ "id": "bone-gallery-g0pq", "name": "Bone Gallery", "type": "landmark",
  "rank": 2, "map": "barrow-deeps-2pdw", "submap": "ossuary-x1y2",
  "x": 1876.7, "y": 1500, "description": "", "tags": [], "createdBy": "", "created": "…", "updated": "…" }
```

- `map`: the sub-map the place is on. **Absent (or `"main"`) = the main map**, so every existing location doc is a
  main-map place. A place whose `map` no longer exists is shown on the main map (drawer warns) instead of vanishing.
- `submap`: a map this place opens ("Open map: X" in its panel, a small seal on its pin). Any map except its own.
- `rank`: 1–4 (see below). Absent = "Auto": the location type's default rank.

Location types (`content/library/location-type/<id>.json`, compendium kind `location-type`) carry `rank` (1–4,
the default for places of that type) and `major` (= rank 1, kept for the compendium editor; a contradicting
`major` flag wins over a stale `rank`). Built-in defaults: city 1; town, castle, port, forest, mountain 2;
village, temple, landmark, danger, dungeon, ruins, cave, portal, battle, quest, other 3; camp, tavern, shop 4.

## Who may change what

Places are everyone's: add, name, describe, type, rank, move and link them (to an existing map), in the place panel
or Edit map → Places. Everything map-wide is the DM's (`data.canDesign()`: the DM in DM mode, or anyone while no DM is
set up): new maps (⋯ → Add a sub-map, the Maps list, "New sub-map…" in a place's "Opens a map", `#/map?new=1`), the
image (replace, reset), the name, Duplicate, Delete, the zoom bands, Offset / scale of every pin, and the Design,
Pictures and Fog tabs (background, crop, compass, the scale / distance settings, border, pictures, fog). For a player
those controls are simply not shown; a stray call says "Only the DM can …".

## Routes

- `#/map` — main map. `#/map/loc/<id>` — a place on the main map (still accepted for sub-map places; the view
  switches maps and rewrites the hash to the long form).
- `#/map/m/<mapId>` — a sub-map. `#/map/m/<mapId>/loc/<id>` — a place on that sub-map.
- Switching maps goes through the router (pushState), so Back returns to the previous map. Selecting places on the
  current map uses replaceState, as before. Each map remembers its own last view per device.

## Map collection

- The **Maps** button sits on the search's right (icon only when the map is 640px wide or less). It opens the
  collection under the map's name plate: every map, the main
  map first and sub-maps indented under their parent, then the maps of their own (each with its sub-maps), each with a thumbnail, its parent, its number of places and
  its `[[map:…]]` link with a copy button (same text and toast as "Copy link to this map"). The shown map is marked.
- Entries are links to `#/map/m/<id>`, so opening one is the same route as any other sub-map navigation (Back
  returns, each map restores its own view). A filter field (name or parent name) appears from 7 maps.
- Keyboard: arrows / Home / End move between maps, Esc clears the filter, then closes and returns focus to the
  button. Also opened from ⋯ → Map collection… (hidden in edit mode, where the left-hand controls are hidden).
- Thumbnails load when an entry scrolls into view. Raster images are shrunk once per image version (to 240px wide,
  one at a time); SVGs are used as they are.
- Under the search, a name plate shows the current map ("⁂ The Uncharted Realm"); on a sub-map its parents come
  first as links ("The Uncharted Realm › Starfall Vale"); a map of its own starts the chain itself. It replaced the bottom-left cartouche and the old ▾ switcher.
  In DM mode a lock follows a hidden map's name (the main map's too) and the hide / release switch sits under the plate.
- Maps carry no tags of their own: link them with `[[map:Name]]` (place tags stay as they were).
- Sample content: the sub-map `starfall-vale-p94a` "Starfall Vale" (an original SVG region map) with two places,
  Brinewick and The Warden Stones. To remove it: open it, ⋯ → Delete this map… → delete the places too.

## Moving a place

- On its map: **Move** in the place panel (drag the pin or click the map, then Save position), Edit map (drag pins,
  arrow keys), or the Edit location form's **Where → Move pin**: drag the pin or click the map, **Done** (or Put back);
  the new spot is saved with the form and Cancel puts the pin back. On a narrow screen the form's sheet steps aside
  while moving.
- To another map: the Edit form's **Where** select lists every map this viewer can see. Saved there, the place lands
  beside the place on that map that opens the map it came from (moving up from a sub-map), else in the middle of the
  map (of its crop) (`data.landingSpot`); the view opens it there ready to drag ("Leave it here" / Save position), and
  the move is committed at once (`saveSoon`). It keeps its links, type, rank and the map it opens (cleared if that is
  the map it moved to). DM mode: moved onto a hidden map it is hidden too (the form says so); a hidden place moved onto
  a visible map stays hidden, and is no longer released with the map it left (docs/dm-mode.md).

## Linked places (the same place on several maps)

A city on the main map can be the same city on a region map: **linked places** (`twins.js`, pure, `node
tools/test_twins.mjs`). Each keeps its own map, position, rank and the map it opens; **name, type, description and
tags are shared**, so editing any of them on one changes all of them.

- In the New location form, **Same place as…** picks the place (any map, search by name, map or tag): the form fills
  with its name, type, description and tags, a box says what it is linked with, and **Unlink** undoes it before
  saving. The Edit form shows the same box: Unlink keeps the place separate (with the text it has now), and an
  unlinked place can be linked the same way (it takes the other place's text). The details panel says "Also on
  <map>", each a link to that pin.
- Documents: every member holds the shared fields itself plus `same` (the group's random id, `same-xxxx`, never
  derived from a name, so a hidden member's name can't show through a visible one) and `sharedAt` (when the shared
  fields last changed). The index (`linkTwins`) gives every member the fields of the member changed last that this
  viewer can read, and `twins` (the other members' ids; `data.twinsOf(loc)`). `saveLocation` writes a change of the
  shared fields to every member it can read (moving or re-ranking one doesn't touch the others), `{linkTo: id}` joins
  that place's group (written into it first if it had none). A member that couldn't be written (hidden from whoever
  edited) catches up when read, and a visible member reads right for players while another is hidden by the DM;
  each member is hidden and released on its own.
- Deleting or unlinking leaves the others as they are; a group left with one place loses its link fields. Duplicating
  a map makes plain copies (not linked). Links by name open the oldest member; "Mentioned in" counts links to any
  member.

## `[[map:…]]` links

Precedence for `[[map:X]]`: **place id → map id → place name → map name** (names are case/diacritic-insensitive).
So `[[map:Duskhold]]` opens the *place* Duskhold when a place and a map share that name (old links keep working),
and the place's panel offers "Open map". `[[map:Map name#Place]]` finds a place on that map (for names used on
several maps). Autocomplete and "Copy link" insert `[[map:<id>|Name]]` whenever a name is ambiguous, and list
sub-maps as "Name (map)". `![[map:Sub-map]]` embeds a short summary of the map.

## Hierarchy (ranks 1–4)

- 1 Major (realms, capitals) · 2 Notable · 3 Local · 4 Minor (details). Effective rank = `rank` or the type default.
- Zoom position `u` = (zoom − minZoom) / (maxZoom − minZoom) of the current map (0 = fully zoomed out). Each band
  `[from, to]` shows a rank fully between those percentages and fades over 8% outside them (overlapping bands,
  smoothstep). Defaults: rank 1 `[0, 62]`, 2 `[26, 82]`, 3 `[45, 100]`, 4 `[64, 100]` — so at the whole-map view
  only rank 1 shows; zooming in brings 2, 3 and 4 while 1, then 2, fade out.
- Bands are **relative to the highest rank present** on the map after filters: on a city map whose most important
  places are rank 3, rank 3 uses band 1 (shown fully zoomed out) and rank 4 band 2. Hiding rank 1 with the filter
  likewise promotes rank 2.
- Always visible regardless of zoom and filters: the selected place, search matches, the pin being moved/placed.
- Edit mode shows every place (open "Zoom bands" in the edit panel to preview and tune the bands per map).
- Filter (toolbar "Filter", or ⋯ → Filter places…): ranks and location types (each with "only"), plus
  "Show every rank at every zoom". Stored per device in `localStorage['sw:map:prefs']`
  (`hidden`, `hiddenRanks`, `allZoom`, `labels`, `views{mapId}`, `lastType`).

## Pins and names

- A place is drawn as an inked map mark (`pins.js` `pinIcon`, map.css "Pins"): a small parchment roundel ringed in sepia
  ink, centered on the place, with its type's `mk-*` glyph. The type's pigment only tints it (a wash, the glyph's ink).
  Size by rank (26 / 22 / 20 / 18 px; rank 1 gets a second ring, like a capital on an old map). The marker box is a 32px
  hit area (`PIN_SIZE`, anchored at its center); on touch screens (`pointer: coarse`) it reaches 44px.
- States: selected = lifted, in a gold ring; search non-matches faded; hover lifts it; keyboard focus = blue ring; edit
  picks = blue ring; placing / moving = dashed gold edge, bobbing. DM mode: a hidden place has a dashed gold edge (dm.css),
  a place under the fog is faded with an italic name. A place that opens a sub-map has a small seal on its shoulder.
- Names are lettered under the mark like the map's own: serif, sepia ink with a parchment text halo, no plate; rank 1
  in Cinzel capitals, rank 2 a little larger than 3–4. They are part of the hit area. The **Labels** toggle is on by
  default (`prefs.labels !== false`); a rank's names show once its pane is mostly faded in (`has-labels`, ≥ 0.7), so
  zoomed out only the top ranks are named. Hover, focus and the selection show a name anyway.
- Marks and names sit on the map image, which is the same in both themes, so they use the fixed `--pin-*` tokens;
  only the gold and focus rings follow the theme. The legend / picker swatches are the same mark in miniature.

## Rendering and performance

- The map image is decoded (raster) or rasterised (SVG) once into a pyramid (full, ½, ¼ … ≥ 512 px; full level capped at
  64 MP desktop / 16 MP on phones and tablets, decoded straight to that size) and drawn as 257 px CPU canvas tiles by an `L.GridLayer` (1 px overlap hides
  seams). SVG maps draw tiles straight from the vector when zoomed past the raster level, so they stay sharp.
- Zoom is continuous and eased for wheel/trackpad/buttons/keys/double-click (`zoom.js`, Leaflet `zoomAnimation`
  off, `zoomSnap: 0`); pinch uses Leaflet's touch zoom. Frames only move tiles and pins.
- Pins: stable z-index (image y), one Leaflet pane per rank whose opacity follows the zoom (4 style writes per
  frame), off-screen pins culled (`display:none`, no transform writes), the marks' color constants on `.map-root`
  rather than on each pin (a moving pin's style is recomputed every frame), no pin transitions or hit-testing while a
  zoom runs.
