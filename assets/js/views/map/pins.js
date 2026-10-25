// Marker visuals: Leaflet divIcon pins (built as strings — cheap for hundreds of markers),
// plus small DOM swatches/badges for the legend, picker and drawer.
// A pin is an inked map mark: a small parchment roundel with the type's glyph, centered on the place,
// its name lettered under it (map.css). The 32 px box is the hit area; the mark inside is smaller.
import { h } from '../../core/dom.js';

const SPRITE = 'assets/img/icons.svg';
export const PIN_SIZE = [32, 32];
export const PIN_ANCHOR = [16, 16];

// Marker glyph symbols are `mk-*` in the current sprite; accept `i-mk-*` too in case it is renamed.
let glyphPrefix = '';
export const glyphsReady = fetch(SPRITE)
  .then((r) => (r.ok ? r.text() : ''))
  .then((t) => { if (!/id="mk-/.test(t) && /id="i-mk-/.test(t)) glyphPrefix = 'i-'; })
  .catch(() => {});
const glyphHref = (name) => `${SPRITE}#${glyphPrefix}${name}`;

/** <svg> for a marker glyph (mk-*), colored by currentColor. */
export function glyph(name, cls = '') {
  const svg = h('svg', { class: `icon map-glyph ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  svg.append(h('use', { href: glyphHref(name) }));
  return svg;
}

// A small "this place has its own map" seal on the mark's shoulder.
const SUB = `<span class="map-pin-sub" aria-hidden="true"><svg class="icon"><use href="${SPRITE}#i-layers"/></svg></span>`;

// type.css is a sanitized color or var(--pin-*); type.icon is restricted to the mk-* set (see data.js).
// The pigment only tints the mark (a wash and the glyph's ink); the ring and the lettering are sepia ink.
function pinInner(type, sub = false) {
  return `<span class="map-pin${type.light ? ' is-light' : ''}" style="--pin:${type.css || type.color}">`
    + `<svg class="icon map-glyph map-pin-glyph" aria-hidden="true" focusable="false"><use href="${glyphHref(type.icon)}"/></svg>${sub ? SUB : ''}</span>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** L.divIcon for a location. loc needs {name}; type is a normalized type; rank is the effective rank. */
export function pinIcon(loc, type, { selected = false, ghost = false, rank = type.rank || 3, sub = false } = {}) {
  const cls = ['map-marker', `rank-${rank}`];
  if (rank === 1) cls.push('is-major');
  if (sub) cls.push('has-sub');
  if (selected) cls.push('is-selected');
  if (ghost) cls.push('is-ghost');
  return window.L.divIcon({
    className: cls.join(' '),
    html: `${pinInner(type, sub)}<span class="map-pin-label">${esc(loc.name)}</span>`,
    iconSize: PIN_SIZE,
    iconAnchor: PIN_ANCHOR,
  });
}

let PinClass = null;
/**
 * L.Marker whose z-index depends only on its image y (lower pins in front), not on the zoom-dependent
 * layer point. Leaflet rewrites every marker's z-index on every zoom frame, which forces Chrome to
 * re-layerise all pins each frame; with a stable value the per-frame work is a transform per pin.
 */
export function PinMarker() {
  if (!PinClass) {
    const L = window.L;
    PinClass = L.Marker.extend({
      _setPos(pos) {
        // Culled pins (display:none, see index.js cull) only remember where they are.
        if (this._icon && this._culled) this._icon._leaflet_pos = pos;
        else if (this._icon) L.DomUtil.setPosition(this._icon, pos);
        const z = Math.round(-this._latlng.lat) + this.options.zIndexOffset;
        if (z !== this._zIndex) { this._zIndex = z; this._resetZIndex(); }
      },
    });
  }
  return PinClass;
}

/** A standalone pin (DOM) for previews, at its rank's size. type: {icon, color, css?, light?, rank?} */
export function pinPreview(type) {
  const el = h('span', { class: ['map-pin-preview', `rank-${type.rank || 3}`] });
  el.innerHTML = pinInner(type);
  return el;
}

/** The map mark in miniature (parchment disc, tinted, with the type glyph): legend, picker, search. */
export function swatch(type) {
  return h('span', { class: ['map-swatch', type.light && 'is-light'], style: `--pin:${type.css || type.color}`, 'aria-hidden': 'true' }, glyph(type.icon));
}

export function typeBadge(type) {
  return h('span', { class: ['map-type-badge', type.light && 'is-light'], style: `--pin:${type.css || type.color}` }, glyph(type.icon), h('span', null, type.name));
}

/** "Rank 2 · Notable" pill; inherited ranks say so. */
export function rankBadge(rank, name, inherited = false) {
  return h('span', { class: ['map-rank-badge', `rank-${rank}`], title: inherited ? 'Rank taken from the location type' : null },
    h('span', { class: 'map-rank-pips', 'aria-hidden': 'true' }, [1, 2, 3, 4].map((i) => h('i', { class: i >= rank ? 'on' : null }))),
    h('span', null, `Rank ${rank} · ${name}`), inherited ? h('small', null, ' (type default)') : null);
}
