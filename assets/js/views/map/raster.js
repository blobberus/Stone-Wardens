// Map image rendering. The image is decoded (raster) or rasterised (SVG) ONCE into a bitmap pyramid
// (full size, 1/2, 1/4 … down to ~512 px) and drawn as 256 px canvas tiles by an L.GridLayer.
// Zooming then only moves and scales tiles that are already drawn (pure compositor work), instead of
// resizing one huge <img> every frame, which made Chrome re-decode big exports and re-render the SVG
// placeholder's patterns at every new size. After a zoom, only the ~40 visible tiles of the new level
// are drawn (≈0.1 ms each, spread over frames) from the pyramid level that matches their scale.
// Tile canvases are CPU-backed on purpose: drawing a big bitmap into GPU canvases costs ~90x more.

const TILE = 256;
const MIN_LEVEL = 512; // smallest pyramid level (long side)
const MIN_SVG_SIDE = 3000; // small SVGs are rasterised larger so they stay sharp when zoomed in
const FRAME_BUDGET = 6; // ms of tile drawing per animation frame

const lowMemory = () => matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory || 8) <= 4;
const maxPixels = () => (lowMemory() ? 16e6 : 64e6); // cap on the full-resolution level
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The map image could not be read.'));
    img.src = url;
  });
}

async function downscale(src, w, h) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(src, { resizeWidth: Math.round(w), resizeHeight: Math.round(h), resizeQuality: 'medium' }); } catch { /* canvas fallback */ }
  }
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function decodeRaster(url) {
  const cap = maxPixels();
  if (typeof createImageBitmap === 'function') {
    try {
      const blob = await (await fetch(url)).blob();
      let bmp = await createImageBitmap(blob); // decodes off the main thread
      if (bmp.width * bmp.height > cap) {
        const f = Math.sqrt(cap / (bmp.width * bmp.height));
        const small = await downscale(bmp, bmp.width * f, bmp.height * f);
        bmp.close();
        bmp = small;
      }
      return bmp;
    } catch (e) { console.warn('[map] createImageBitmap failed, using <img>', e); }
  }
  const img = await loadImg(url);
  const n = img.naturalWidth * img.naturalHeight;
  if (n <= cap) return img;
  const f = Math.sqrt(cap / n);
  return downscale(img, img.naturalWidth * f, img.naturalHeight * f);
}

async function rasteriseSvg(img, w, h) {
  const k = Math.min(Math.sqrt(maxPixels() / (w * h)), Math.max(1, MIN_SVG_SIDE / Math.max(w, h)));
  const c = canvas(w * k, h * k);
  ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const close = (src) => { try { src?.close?.(); } catch { /* not a bitmap */ } };

/**
 * Build (or reuse) the pyramid for an image. width/height are the map's coordinate size (image px).
 * Resolves {width, height, levels:[{src, w, h, sx, sy}], vector?}.
 */
async function build(url, width, height, svg) {
  let vector = null;
  let base;
  if (svg) {
    vector = await loadImg(url);
    base = await rasteriseSvg(vector, width, height);
  } else {
    base = await decodeRaster(url);
  }
  const bw = base.naturalWidth || base.width;
  const bh = base.naturalHeight || base.height;
  const levels = [{ src: base, w: bw, h: bh, sx: bw / width, sy: bh / height }];
  for (let l = levels[0]; Math.max(l.w, l.h) > MIN_LEVEL; l = levels[levels.length - 1]) {
    const w = Math.max(1, Math.round(l.w / 2));
    const h = Math.max(1, Math.round(l.h / 2));
    levels.push({ src: await downscale(l.src, w, h), w, h, sx: w / width, sy: h / height });
  }
  return { width, height, levels, vector };
}

const cache = new Map(); // key -> {promise, used}
const KEEP = 2; // pyramids kept in memory (e.g. a sub-map and its parent)

export function loadImageSource(url, { width, height, svg = false }) {
  const key = `${url}\u0000${width}x${height}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = { promise: build(url, width, height, svg), used: 0 };
    hit.promise.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  hit.used = performance.now();
  if (cache.size > KEEP) {
    const old = [...cache.entries()].filter(([k]) => k !== key).sort((a, b) => a[1].used - b[1].used);
    for (const [k, v] of old.slice(0, cache.size - KEEP)) {
      cache.delete(k);
      v.promise.then((s) => s.levels.forEach((l) => close(l.src))).catch(() => {});
    }
  }
  return hit.promise;
}

/** An L.GridLayer that draws the source as canvas tiles. */
export function createImageLayer(source) {
  const L = window.L;
  const { width: W, height: H, levels, vector } = source;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const top = levels[0];
  // Past the full-resolution level, tiles of that level are simply scaled (SVGs keep drawing vectors).
  const maxNativeZoom = vector ? 30 : Math.ceil(Math.log2(Math.max(top.sx, top.sy) / dpr));
  const queue = [];
  let raf = 0;

  function drawTile(c, coords) {
    const g = ctx2d(c);
    const span = TILE / 2 ** coords.z; // image px covered by this tile
    const x0 = coords.x * span;
    const y0 = coords.y * span;
    const k = c.width / span; // canvas px per image px
    let lv = top;
    for (const l of levels) if (l.sx >= k * 0.98) lv = l; // smallest level that is still sharp enough
    const useVector = vector && k > top.sx * 1.02;
    const mx = useVector ? 0 : 1 / lv.sx; // 1 source px of overlap hides seams between tiles
    const my = useVector ? 0 : 1 / lv.sy;
    const ix0 = Math.max(0, x0 - mx);
    const iy0 = Math.max(0, y0 - my);
    const ix1 = Math.min(W, x0 + span + mx);
    const iy1 = Math.min(H, y0 + span + my);
    if (ix1 <= ix0 || iy1 <= iy0) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'medium';
    const dx = (ix0 - x0) * k;
    const dy = (iy0 - y0) * k;
    const dw = (ix1 - ix0) * k;
    const dh = (iy1 - iy0) * k;
    if (useVector) {
      const vw = vector.naturalWidth || W;
      const vh = vector.naturalHeight || H;
      g.drawImage(vector, (ix0 * vw) / W, (iy0 * vh) / H, ((ix1 - ix0) * vw) / W, ((iy1 - iy0) * vh) / H, dx, dy, dw, dh);
    } else {
      g.drawImage(lv.src, ix0 * lv.sx, iy0 * lv.sy, (ix1 - ix0) * lv.sx, (iy1 - iy0) * lv.sy, dx, dy, dw, dh);
    }
  }

  function pump() {
    raf = 0;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < FRAME_BUDGET) {
      const job = queue.shift();
      if (!job.c.parentNode) continue; // pruned before it was drawn
      try { drawTile(job.c, job.coords); job.done(null, job.c); } catch (e) { job.done(e, job.c); }
    }
    if (queue.length) raf = requestAnimationFrame(pump);
  }

  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const c = canvas(TILE * dpr, TILE * dpr);
      queue.push({ c, coords, done });
      if (!raf) raf = requestAnimationFrame(pump);
      return c;
    },
    onRemove(map) {
      queue.length = 0;
      cancelAnimationFrame(raf);
      raf = 0;
      L.GridLayer.prototype.onRemove.call(this, map);
    },
    getEvents() {
      const ev = L.GridLayer.prototype.getEvents.call(this);
      // flyTo can end without a plain 'zoom' event; make sure the right level is used afterwards.
      ev.zoomend = function onZoomEnd() {
        const want = this._clampZoom(Math.round(this._map.getZoom()));
        if (want !== this._tileZoom) this._setView(this._map.getCenter(), this._map.getZoom());
      };
      return ev;
    },
  });
  return new Layer({
    tileSize: TILE,
    noWrap: true,
    minZoom: -30,
    maxZoom: 30,
    maxNativeZoom,
    updateWhenZooming: true,
    keepBuffer: 2,
    className: 'map-tiles',
    bounds: L.latLngBounds([[-H, 0], [0, W]]),
  });
}
