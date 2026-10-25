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
| Place | `content/locations/<id>.json` | every place on every map |
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
  none, the blank parchment under "The DM hasn't revealed the map yet." without the tools. A map whose parent would be
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

## Rendering and performance

- The map image is decoded (raster) or rasterised (SVG) once into a pyramid (full, ½, ¼ … ≥ 512 px; full level capped at
  64 MP desktop / 16 MP on phones and tablets, decoded straight to that size) and drawn as 257 px CPU canvas tiles by an `L.GridLayer` (1 px overlap hides
  seams). SVG maps draw tiles straight from the vector when zoomed past the raster level, so they stay sharp.
- Zoom is continuous and eased for wheel/trackpad/buttons/keys/double-click (`zoom.js`, Leaflet `zoomAnimation`
  off, `zoomSnap: 0`); pinch uses Leaflet's touch zoom. Frames only move tiles and pins.
- Pins: stable z-index (image y), one Leaflet pane per rank whose opacity follows the zoom (4 style writes per
  frame), off-screen pins culled (`display:none`, no transform writes), no pin transitions or hit-testing while a
  zoom runs.
