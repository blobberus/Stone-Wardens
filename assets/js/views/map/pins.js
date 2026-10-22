// Marker visuals: Leaflet divIcon pins (built as strings — cheap for hundreds of markers),
// plus small DOM swatches/badges for the legend, picker and drawer.
import { h } from '../../core/dom.js';

const SPRITE = 'assets/img/icons.svg';
export const PIN_SIZE = [32, 46];
export const PIN_ANCHOR = [16, 43];
// Teardrop: head circle r=13 at (16,16), tip at (16,43).
const PIN_PATH = 'M16 43C13.6 35.6 3 28.6 3 16a13 13 0 0 1 26 0c0 12.6-10.6 19.6-13 27z';

// Marker glyph symbols are `mk-*` in the current sprite; accept `i-mk-*` too in case it is renamed.
let glyphPrefix = '';
export const glyphsReady = fetch(SPRITE)
  .then((r) => (r.ok ? r.text() : ''))
  .then((t) => { if (!/id="mk-/.test(t) && /id="i-mk-/.test(t)) glyphPrefix = 'i-'; })
  .catch(() => {});
const glyphHref = (name) => `${SPRITE}#${glyphPrefix}${name}`;

/** <svg> for a marker glyph (mk-*), coloured by currentColor. */
export function glyph(name, cls = '') {
  const svg = h('svg', { class: `icon map-glyph ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  svg.append(h('use', { href: glyphHref(name) }));
  return svg;
}

const SHAPE = '<svg class="map-pin-shape" viewBox="0 0 32 46" aria-hidden="true" focusable="false">'
  + '<ellipse class="map-pin-shadow" cx="16" cy="43.5" rx="6.5" ry="2.2"/>'
  + `<path class="map-pin-body" d="${PIN_PATH}"/>`
  + '<circle class="map-pin-ring" cx="16" cy="16" r="10.6"/>'
  + '</svg>';

// type.css is a sanitized colour or var(--pin-*); type.icon is restricted to the mk-* set (see data.js).
function pinInner(type) {
  return `<span class="map-pin${type.light ? ' is-light' : ''}" style="--pin:${type.css || type.color}">${SHAPE}`
    + `<svg class="icon map-glyph map-pin-glyph" aria-hidden="true" focusable="false"><use href="${glyphHref(type.icon)}"/></svg></span>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** L.divIcon for a location. loc needs {name}; type is a normalized type. */
export function pinIcon(loc, type, { selected = false, ghost = false } = {}) {
  const cls = ['map-marker', `rank-${type.rank || 3}`];
  if (type.rank === 1) cls.push('is-major');
  if (selected) cls.push('is-selected');
  if (ghost) cls.push('is-ghost');
  return window.L.divIcon({
    className: cls.join(' '),
    html: `${pinInner(type)}<span class="map-pin-label">${esc(loc.name)}</span>`,
    iconSize: PIN_SIZE,
    iconAnchor: PIN_ANCHOR,
  });
}

/** A standalone pin (DOM) for previews. type: {icon, color, css?, light?, rank?} */
export function pinPreview(type) {
  const el = h('span', { class: 'map-pin-preview' });
  el.innerHTML = pinInner(type);
  return el;
}

/** Round coloured disc with the type glyph. */
export function swatch(type) {
  return h('span', { class: ['map-swatch', type.light && 'is-light'], style: `--pin:${type.css || type.color}`, 'aria-hidden': 'true' }, glyph(type.icon));
}

export function typeBadge(type) {
  return h('span', { class: ['map-type-badge', type.light && 'is-light'], style: `--pin:${type.css || type.color}` }, glyph(type.icon), h('span', null, type.name));
}
