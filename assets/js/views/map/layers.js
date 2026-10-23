// A Leaflet layer that keeps any element over a rectangle of the map image (image px, origin top-left), like
// L.ImageOverlay but for a canvas, an inline SVG or a picture with handles. It re-sizes on every 'zoom' frame
// (zoom.js drives zooms frame by frame), so keep the element cheap to scale: no filters, no huge layouts.

let Layer = null;

function make() {
  const L = window.L;
  return L.Layer.extend({
    options: { pane: 'overlayPane' },
    initialize(el, rect, options) {
      this._el = el;
      this._rect = { ...rect };
      L.setOptions(this, options);
    },
    onAdd() {
      this._el.classList.add('leaflet-zoom-hide'); // never part of a CSS zoom animation (there are none, but be safe)
      this.getPane().appendChild(this._el);
      this._reset();
    },
    onRemove() { this._el.remove(); },
    getEvents() { return { zoom: this._reset, viewreset: this._reset }; },
    getElement() { return this._el; },
    getRect() { return { ...this._rect }; },
    /** Move / resize to rect {x, y, w, h} (image px). */
    setRect(rect) {
      this._rect = { ...rect };
      if (this._map) this._reset();
      return this;
    },
    _reset() {
      const m = this._map;
      if (!m) return;
      const r = this._rect;
      const tl = m.latLngToLayerPoint([-r.y, r.x]);
      const br = m.latLngToLayerPoint([-(r.y + r.h), r.x + r.w]);
      L.DomUtil.setPosition(this._el, tl);
      this._el.style.width = `${Math.max(0, br.x - tl.x)}px`;
      this._el.style.height = `${Math.max(0, br.y - tl.y)}px`;
    },
  });
}

/** boundsLayer(el, {x, y, w, h}, {pane}) -> a layer to addTo(map). */
export function boundsLayer(el, rect, options = {}) {
  if (!Layer) Layer = make();
  return new Layer(el, rect, options);
}

/** Screen px per image px at the map's current zoom (CRS.Simple: 2^zoom). */
export const pxPerImagePx = (map) => 2 ** map.getZoom();

/** Image coordinates {x, y} of a pointer event over the map. */
export function eventXY(map, e) {
  const ll = map.containerPointToLatLng(map.mouseEventToContainerPoint(e));
  return { x: ll.lng, y: -ll.lat };
}
