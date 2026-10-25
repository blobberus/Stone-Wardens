# Map design, pictures and fog (Map tab)

The DM (in DM mode; anyone while no DM is set up) styles each map in **Edit map**, which gains three tabs beside
**Places**: **Design**, **Pictures** and **Fog** (⋯ → **Design map…** opens it on Design). Changes are drafts that are
committed when you press **Done**, like the rest of Edit map. Players see the result; they can measure distances with
the ruler and hide the decorations on their own device (⋯ → Hide compass, scale and border).

Code: `assets/js/views/map/` — `design.js` (model, round scale numbers, compass and border SVG; pure),
`fog.js` (fog model; pure), `fogdraw.js` (paints fog into a canvas), `fogview.js` (fog on the map, its painting tools,
the gradual reveal), `decor.js` (background, border, compass, scale bar, ruler, crop handles), `pictures.js` (pictures on
the map and their handles), `designpanel.js` (the three tabs), `layers.js` (a Leaflet layer that keeps any element
over a rectangle of the image). Styles at the end of `assets/css/map.css`. Tests: `node tools/test_mapdesign.mjs`.

## Design (`design` field of the map document)

The main map's `content/map/config.json` or a sub-map's `content/maps/<id>.json` holds:

```json
"design": {
  "background": { "kind": "theme|parchment|sea|night|color|image", "color": "#c9b98f", "image": "content/maps/<id>/background-….png", "fit": "tile|cover" },
  "crop": { "x": 120, "y": 80, "w": 2800, "h": 2100 },
  "compass": { "show": true, "type": "rose|star|ornate|arrow|minimal", "anchor": "screen|map", "corner": "bl|br|tl|tr",
               "size": 112, "x": 0.1, "y": 0.82, "mapSize": 0.12, "rotation": 0, "color": "#1f1a14" },
  "scale": { "show": true, "ruler": true, "unit": "miles|km|leagues|feet|m|days|custom", "custom": "", "perPx": 0.05,
             "style": "checkered|line|ticks", "corner": "bl", "pace": { "on": true, "per": 24, "label": "days on foot" } },
  "border": { "show": true, "type": "double", "color": "#1f1a14", "accent": "", "width": 1.6, "pad": 0,
              "corners": "auto|none|square|rosette|knot|star", "mat": "paper|color|none", "matColor": "#efe5cc" }
}
```

Border `type`: `line`, `double`, `inked` (hand-inked), `checker`, `ruler` (graduated), `ornate`, `rope`, `meander`
(Greek key), `vine`, `beads` (bead and reel), `scallop`, `deco` (art deco), `deckle` (torn edge: torn parchment),
`burnt` (burnt edge), `wash` (ink wash).

- **Background**: what shows around the image (where it is cropped, or zoomed out). Presets, a color, or an uploaded
  image (tiled or cover), stored in the map's folder.
- **Crop** (image px; `null` = the whole image): only that part of the image is drawn (the tiles are clipped), "Show
  the whole map" fits it, and the fog is clipped to it. Places keep their coordinates. Adjust it with handles on the map.
- **Compass**: five styles; in a screen corner (size in px) or drawn on the map at a spot (`x`, `y` = fractions of the
  image, `mapSize` = fraction of its width; drag it in the Design tab); `rotation` = where north points.
- **Scale**: `perPx` = distance units per image pixel. Set it by typing how far the shown map is across, or with
  "Measure two points…" (click two points, type their distance). The bar picks a round length for each zoom.
  `ruler` lets everyone use the **Ruler** tool (toolbar, or right-click → Measure from here): click points, double-click
  or Enter ends the path; it shows the length and, with a travel pace, the time ("48 miles · ≈ 2 days on foot").
- **Border**: a frame drawn around the shown (cropped) image, outside it. The Design tab shows every style as a
  little picture in the border's own colors; picking one adds the border (and moves an untouched thickness to that
  style's own, `BORDER_TYPES[].width`). Fifteen styles: tidy cartographic ones (single / double line, checkered band,
  graduated degree ticks, ornate, rope, Greek key, vine, bead and reel, scalloped, art deco) and hand-made ones
  (hand-inked double line that wobbles and crosses at the corners, torn parchment, burnt edge, ink wash that bleeds a
  little onto the map). Options: `width` (the band) and `pad` (space between map and frame), both percent of the
  image's short side; `color`; `accent`, a second color for what the style names (inner line, leaves, ground,
  scorch…; `''` = the style's own); `corners` (`auto` = the style's own: rope a knot, vine a rosette, ornate a
  square…); `mat` = what is behind the frame (parchment, a `matColor`, or none = see-through; torn and burnt parchment
  are always paper). Older designs keep their look (`mat` missing: none for the single line, parchment otherwise).
  Built once per change as one SVG (design.js `borderSvg`): rules are rectangles, a motif is ONE path per side
  orientation (a whole number of tiles between the corners, `<use>`d on both opposite sides and clipped), the
  hand-made edges are seeded noise (the same on every device). Per-element or pattern-based repeats made each zoom
  frame several times slower; every style rasterises in under 3 ms per frame on the main map.
- "Hide compass, scale and border" (Design tab) turns all three off for everyone and back on; each also has its own
  switch. A replacement image of another size rescales the crop and scale with the pins (and pictures and fog).

## Pictures (`content/map-pictures/<id>.json`)

```json
{ "id": "treasure-mark-k3x9", "map": "starfall-vale-p94a", "name": "Treasure mark",
  "src": "content/media/map-pictures/treasure-mark-ab12.png", "x": 900, "y": 700, "w": 600, "h": 450,
  "rotation": 15, "opacity": 0.9, "order": 1 }
```

`x, y, w, h` are the unturned rectangle in image px; it turns about its center. They sit above the map image and below
the fog and the pins (higher `order` on top). Add one in the Pictures tab; on the map, drag it to move, a corner to
resize (it keeps its shape), the knob to turn (Shift: 15° steps); the row has name, opacity, turn, front / back, delete
and, in DM mode, the hidden / visible switch. Big rasters are scaled to 4096 px (WebP keeps transparency).

## Fog of war (`content/fog/<mapId>.json`)

Modelled on the Combat Ring's fog (one layer of areas, Fog / Clearing, Select mode), with this site's own look: the
map fades into its background color.

```json
{ "map": "main", "v": 2, "on": true, "opacity": 1, "softness": 0.5,
  "areas": [ { "id": "fmh3k2a01", "pts": [0, 0, 4961, 0, 4961, 3508, 0, 3508], "holes": [[x0, y0, x1, y1, …]], "on": true, "z": 1 } ] }
```

- `on`: fog of war on this map (off = the players see the whole map; the DM still sees and edits the areas).
- An **area** is one patch of fog: `pts` its outline (a closed shape, image px), `holes` the clearings cut into it,
  `on` true = hidden from the players, false = revealed (the DM keeps a dotted outline, so it can be hidden again), `z`
  the drawing order. **One layer**: a new area, or a clearing, is cut out of every area it touches (added as a hole;
  an area wholly inside it is deleted), so areas never overlap. Clearings are simplified so an area stays under 40 kB;
  at most 400 areas per map.
- **Players** see a wash of the map's background color (Design → Background; the default follows the light or dark
  theme) over every hidden area, `opacity` strong (100% = the land is gone, lower = glimpsed), its edge softened by
  `softness`. The mask is blurred and doubled, so the soft edge lies outside the true outline: the blur never shows
  anything the DM hid. Places under it are hidden from them: no pin, not in search, not in Edit map's list, not counted
  in the filter or the Maps list (a link to one still opens it).
- **The DM** sees through it (the same color, lighter and crisp); in the Fog tab each area also has a dashed gold
  outline (revealed: dotted; under the pointer: thicker; selected: solid with a gold wash). Pins under the fog are
  faded with an italic name. **DM view / Player view** (Shift+P) shows the real look.
- **Gradual reveal**: when the fog changes while someone is looking, the old fog fades into the new one. A device also
  remembers a small picture of the fog it last showed a player (`localStorage['sw:map:fogseen2']`, 4 maps); if the fog
  changed since, that picture is laid over the new fog and clears over a few seconds.
- **Fog tab** (Edit map, like the Combat Ring's fog controls): DM view / Player view; "Fog of war on this map"; Draw:
  **Fog | Clearing** (what a drawing makes; Alt flips it while drawing), tools **Move map** (M), **Lasso** (L),
  **Polygon** (P: click corners; the first corner again, a double-click or Enter closes it; Backspace takes one back;
  Esc cancels), **Rectangle** (R), **Click to reveal / hide** (T), **Select** (V: click, Shift-click, or drag a box;
  then Reveal / Hide / Delete, Del key); a click without dragging with Lasso or Rectangle also reveals / hides the area
  under it; Space held moves the map with any tool; Undo / Redo (Ctrl+Z, Ctrl+Shift+Z). Players see: the color chip,
  Strength, Soft edges. All the fog: Cover the whole map, Reveal all fog, Hide it all again, Delete all fog.
- First-version documents (`ops`: add / cut × all / rect / poly / brush, `style` clouds / mist / solid, `color`) are
  read into areas (`areasFromOps`; a brush stroke becomes its outline) and written in the new form at the next change.
- The fog only covers the picture: the map image and place files are still in the public repository. For a true
  secret, also hide the place (DM mode).

## Duplicating a map

⋯ → **Duplicate this map…**: name, where it goes, and whether its places, pictures and fog come along (the image and
the design always do; the image is copied into the new map's folder). Copied places get new ids; old `[[map:Name]]`
links keep opening the original (the older place wins a shared name). The main map's copy becomes a sub-map.
In DM mode the copy can start hidden; a copy of a hidden map starts hidden.

## Hiding a map (DM mode)

On any map, the main map too, the switch under its name plate hides it from the players **with everything on it**:
its image and background image, fog, pictures, places and sub-maps (core/dm.js `companions`; for the main map every
map inside it, each with what is on it, after a confirmation that says what goes and what stays). Maps of their own
(`parent: null`, docs/map-model.md) stay visible. Release brings them all back, except what was hidden on its own
before. A place, picture or fog of a hidden map can't be released alone, but a map inside a hidden map can: it is
released as a map of its own (not linked to the hidden map, after the DM agrees), with everything on it. Hidden maps
show a lock beside their name in the name plate and the Maps list. While the main map is hidden, players' Map tab
opens the first visible map of its own, or "The DM hasn't revealed the map yet." (the public marker
`content/map/hidden.json` tells their devices; see docs/dm-mode.md).
