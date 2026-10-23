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
  "border": { "show": true, "type": "line|double|checker|ornate", "color": "#1f1a14", "width": 1.6 }
}
```

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
- **Border**: a frame drawn around the shown image, outside it (`width` = percent of its short side), on a paper mat
  except for the single line.
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

```json
{ "map": "main", "on": true, "style": "clouds|mist|solid", "color": "#3a3f47", "opacity": 1, "softness": 0.5,
  "ops": [ { "t": "add", "k": "all" }, { "t": "cut", "k": "brush", "p": [x0, y0, x1, y1, …], "r": 40 } ] }
```

- `ops` run in order: `add` paints fog, `cut` reveals; kinds `all`, `rect` `[x, y, w, h]`, `poly` (a closed shape) and
  `brush` (a stroke of radius `r`). Strokes are simplified before they are saved.
- **Players** see it as painted (clouds: soft billows with ragged edges; mist: a thin veil; faded color: any color at
  any opacity, so the land can show through). Places under it are hidden from them: no pin, not in search, not in
  Edit map's list, not counted in the filter or the Maps list (a link to one still opens it).
- **The DM** sees through it (a slate tint) and pins under it are faded with an italic name; "Preview as the players
  see it" shows the real look.
- **Gradual reveal**: when the fog changes while someone is looking, the old fog fades into the new one. A device also
  remembers the fog it last showed (`localStorage['sw:map:fogseen']`, a fingerprint of the ops); if the new ops start
  with the same ones (the DM revealed more), the old fog is painted first and clears over a few seconds.
- Tools: Move map / Brush / Rectangle / Lasso (keys M, B, R, L), each adding fog or revealing; brush size; Cover all
  (starts a fresh layer), Reveal all, Undo / Redo (Ctrl+Z, Ctrl+Shift+Z). At most 4000 ops per map.
- The fog only covers the picture: the map image and place files are still in the public repository. For a true
  secret, also hide the place (DM mode).

## Duplicating a map

⋯ → **Duplicate this map…**: name, where it goes, and whether its places, pictures and fog come along (the image and
the design always do; the image is copied into the new map's folder). Copied places get new ids; old `[[map:Name]]`
links keep opening the original (the older place wins a shared name). The main map's copy becomes a sub-map.
In DM mode the copy can start hidden; a copy of a hidden map starts hidden.

## Hiding a map (DM mode)

On a sub-map, the switch under its name plate hides it from the players **with everything on it**: its image and
background image, fog, pictures, places and sub-maps (core/dm.js `companions`). Release brings them all back, except
what was hidden on its own before. A place, picture or fog of a hidden map can't be released alone. Hidden maps show
a lock beside their name in the name plate and the Maps list. The main map can't be hidden.
