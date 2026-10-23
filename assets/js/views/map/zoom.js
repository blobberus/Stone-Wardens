// Smooth, continuous zoom for the mouse wheel, trackpads, the zoom buttons, +/- keys and double-click.
// Leaflet's own wheel zoom jumps in steps and ignores input while its 250 ms CSS animation runs; here
// every input just moves a target zoom and each frame eases the real zoom towards it with fractional
// levels. Frames go through map._move(…, {pinch: true}) like Leaflet's pinch zoom: tile levels are only
// scaled/translated (no redraw) and markers are re-positioned; the image level is settled at the end.

const WHEEL_PX_PER_LEVEL = 200; // a 100 px mouse-wheel notch = half a zoom level
const PINCH_PX_PER_LEVEL = 70; // ctrl+wheel (trackpad pinch) deltas are small and frequent
const DONE = 0.004;

export function createZoomer(map, { tau = 70 } = {}) {
  const L = window.L;
  let raf = 0;
  let z = 0;
  let target = 0;
  let pt = null; // container point that stays put while zooming
  let ll = null; // the latlng under pt
  let last = 0;
  let speed = tau;

  const limit = (v) => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), v));

  function centerFor(zoom) {
    const offset = pt.subtract(map.getSize().divideBy(2));
    let c = map.unproject(map.project(ll, zoom).subtract(offset), zoom);
    if (map.options.maxBounds) c = map._limitCenter(c, zoom, map.options.maxBounds);
    return c;
  }

  function setAnchor(point) {
    const size = map.getSize();
    pt = point ? L.point(point) : size.divideBy(2);
    ll = map.containerPointToLatLng(pt);
  }

  function step(now) {
    raf = 0;
    const dt = Math.min(48, Math.max(1, now - last));
    last = now;
    z += (target - z) * (1 - Math.exp(-dt / speed));
    const done = Math.abs(target - z) < DONE;
    if (done) z = target;
    const c = centerFor(z);
    map._move(c, z, { pinch: true, round: false });
    if (done) finish();
    else raf = requestAnimationFrame(step);
  }

  function finish() {
    // A plain (non-pinch) zoom event lets grid layers settle on the right tile level.
    map.fire('zoom');
    map._moveEnd(true);
  }

  function run(nextTarget, point, ms) {
    if (!map._loaded) return;
    const fresh = !raf;
    if (fresh) {
      map._stop();
      z = map.getZoom();
      target = z;
    }
    if (point !== undefined || fresh) setAnchor(point);
    target = limit(nextTarget(target));
    speed = ms || tau;
    if (Math.abs(target - z) < DONE && fresh) return;
    if (fresh) {
      map._moveStart(true, false);
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  return {
    get active() { return !!raf; },
    /** Zoom by dz levels around a container point (default: the center). */
    zoomBy(dz, point, ms) { run((t) => t + dz, point, ms); },
    zoomTo(zoom, point, ms) { run(() => zoom, point, ms); },
    /** Stop where we are (e.g. when the user starts dragging). */
    cancel() {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      finish();
    },
    /** Wheel / trackpad handler. */
    onWheel(e) {
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 33;
      else if (e.deltaMode === 2) dy *= map.getSize().y;
      if (!dy) return;
      const dz = Math.max(-1.5, Math.min(1.5, -dy / (e.ctrlKey ? PINCH_PX_PER_LEVEL : WHEEL_PX_PER_LEVEL)));
      run((t) => t + dz, map.mouseEventToContainerPoint(e), e.ctrlKey ? 45 : tau);
    },
  };
}
