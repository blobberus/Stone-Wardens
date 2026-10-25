// The cover over the Map tab while the DM hides the main map from the players and they have no map of their own
// (index.js syncUnrevealed): clouds, as if fog of war lay over the whole map, instead of the blank placeholder map.
// Two seamless tiles of fractal noise in tones of the background color, painted once per color (~30 ms), drift slowly
// at two speeds in one small canvas (a third of the screen's CSS size, stretched: the clouds are soft) redrawn ~15
// times a second: a few hundred KB and well under a millisecond a frame, so it costs next to nothing, even on an iPad.

import { h } from '../../core/dom.js';
import { parseColor } from './fogdraw.js';

const N = 256; // a tile's side as painted, px
const SCALE = 1 / 3; // canvas px per CSS px
const LAYERS = { back: { tile: 1600, speed: 3 }, front: { tile: 1152, speed: 7 } }; // CSS px per tile, CSS px a second
const FRAME = 66; // ms between frames (~15 a second; the drift is a few px a second)

/** A seeded random number generator (Park–Miller), [0, 1). */
function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (lo, hi, v) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * cloudField(n, {seed, cells, octaves, gain}) -> Float32Array of n × n values stretched to [0, 1]: fractal value noise
 * that tiles seamlessly (every octave's lattice wraps around), `cells` lattice cells across at the coarsest octave, each
 * octave twice as fine and `gain` times as strong, each shifted by a random offset so no lattice lines line up. Pure.
 */
export function cloudField(n, { seed = 1, cells = 4, octaves = 5, gain = 0.5 } = {}) {
  const out = new Float32Array(n * n);
  const rnd = rng(seed);
  let amp = 1;
  for (let o = 0; o < octaves && (cells << o) <= n; o++) {
    const p = cells << o;
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const ox = rnd() * p, oy = rnd() * p;
    const xi0 = new Int32Array(n), xi1 = new Int32Array(n), xt = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const f = (x / n) * p + ox, i = Math.floor(f);
      xi0[x] = i % p; xi1[x] = (i + 1) % p; xt[x] = fade(f - i);
    }
    for (let y = 0; y < n; y++) {
      const f = (y / n) * p + oy, i = Math.floor(f), ty = fade(f - i);
      const r0 = (i % p) * p, r1 = ((i + 1) % p) * p;
      for (let x = 0; x < n; x++) {
        const a = mix(lat[r0 + xi0[x]], lat[r0 + xi1[x]], xt[x]);
        const b = mix(lat[r1 + xi0[x]], lat[r1 + xi1[x]], xt[x]);
        out[y * n + x] += mix(a, b, ty) * amp;
      }
    }
    amp *= gain;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k;
  return out;
}

/**
 * cloudTones([r, g, b]) -> {base, light, shade}: the background color, the clouds' lit tops and their shadows. A light
 * ground gets near-white clouds with warm grey shadows, a dark ground pale grey clouds sunk in deeper shadow. Pure.
 */
export function cloudTones(rgb) {
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const toward = (to, k) => rgb.map((v, i) => Math.round(mix(v, to[i], k)));
  return lum > 0.45
    ? { base: [...rgb], light: toward([255, 255, 255], 0.85), shade: toward([96, 84, 70], 0.28) }
    : { base: [...rgb], light: toward([226, 222, 212], 0.34), shade: toward([0, 0, 0], 0.55) };
}

/** One tile: 'back' an opaque bank of cloud, 'front' loose wisps over it (transparent between them). */
function paintTile(tones, layer) {
  const back = layer === 'back';
  const v = cloudField(N, back ? { seed: 11, cells: 3, octaves: 6, gain: 0.5 } : { seed: 29, cells: 3, octaves: 5, gain: 0.5 });
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const px = img.data;
  const { base, light, shade } = tones;
  const d = 3; // light from the top left: brighter where the field falls away towards the bottom right
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const lit = Math.min(1, Math.max(0, 0.5 + (v[i] - v[((y + d) % N) * N + ((x + d) % N)]) * 7));
      let r, gg, b, a;
      if (back) { // a hazy bank: mostly pale, a little deeper in its hollows
        const t = 0.3 + 0.55 * smooth(0.2, 0.9, v[i]) * (0.6 + 0.4 * lit);
        const hollow = 0.3 * (1 - smooth(0, 0.3, v[i]));
        r = mix(mix(base[0], light[0], t), shade[0], hollow);
        gg = mix(mix(base[1], light[1], t), shade[1], hollow);
        b = mix(mix(base[2], light[2], t), shade[2], hollow);
        a = 255;
      } else { // puffs with bright tops and greyer undersides
        const dense = smooth(0.48, 0.72, v[i]);
        const t = 0.45 + 0.55 * lit;
        r = mix(shade[0], light[0], t);
        gg = mix(shade[1], light[1], t);
        b = mix(shade[2], light[2], t);
        a = 245 * dense;
      }
      const o = i * 4;
      px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** The tile at the size it is drawn (its CSS size × SCALE canvas px), as a repeating pattern. */
function pattern(g, tones, layer) {
  const src = paintTile(tones, layer);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(LAYERS[layer].tile * SCALE);
  const cg = c.getContext('2d');
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(src, 0, 0, c.width, c.height);
  return g.createPattern(c, 'repeat');
}

/**
 * createClouds() -> {el, show(color), stop()}: el (a canvas) fills its box. show paints the tiles in tones of color (a
 * CSS color, once per color) and lets them drift; the frames stop while el is out of sight (another tab, the card
 * hidden) and after stop(); under prefers-reduced-motion they stand still.
 */
export function createClouds() {
  const el = h('canvas', { class: 'map-clouds', 'aria-hidden': 'true' });
  const g = el.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let pats = null, painted = '', running = false, raf = 0, last = 0, seen = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { seen = e.isIntersecting; tick(); }).observe(el);

  function draw(t) {
    const w = Math.max(1, Math.round(el.clientWidth * SCALE)), ht = Math.max(1, Math.round(el.clientHeight * SCALE));
    if (el.width !== w || el.height !== ht) { el.width = w; el.height = ht; }
    for (const k of ['back', 'front']) { // the back is opaque: no clearing needed
      const off = (t * LAYERS[k].speed * SCALE) % (LAYERS[k].tile * SCALE);
      g.setTransform(1, 0, 0, 1, off, 0);
      g.fillStyle = pats[k];
      g.fillRect(-off, 0, w, ht);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function frame(now) {
    raf = 0;
    if (!running || !seen) return;
    if (now - last >= FRAME) { last = now; draw(now / 1000); }
    if (!still.matches) raf = requestAnimationFrame(frame);
  }
  function tick() { if (running && seen && !raf) raf = requestAnimationFrame(frame); }
  function show(color) {
    const key = String(color || '');
    if (key !== painted) {
      painted = key;
      const tones = cloudTones(parseColor(color));
      pats = { back: pattern(g, tones, 'back'), front: pattern(g, tones, 'front') };
      last = 0;
    }
    running = true;
    tick();
  }
  function stop() { running = false; cancelAnimationFrame(raf); raf = 0; }
  return { el, show, stop };
}
