// Paints a map's fog (fog.js) into one canvas the shape of the map image, at most ~2048 px on its long side (the map
// stretches it; fog is soft, so that is plenty). The ops make a mask (shapes filled, cuts erased, in order), the mask
// is blurred by the fog's softness, then colored per style: clouds = billows of tileable value noise with ragged soft
// edges, mist = a thin veil, solid = one faded color. ~20-40 ms for a full-size fog, run only when the fog changes.

const NOISE = 256; // noise tile side (a power of two: coordinates wrap with & 255)
let noise = null;
let canFilter = null;

/** Tileable fractal value noise, NOISE² values in 0..1 (fixed seed: everyone sees the same clouds). */
function makeNoise() {
  const out = new Float32Array(NOISE * NOISE);
  let seed = 1337;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let amp = 1;
  let total = 0;
  for (const period of [4, 8, 16, 32, 64]) {
    const lat = new Float32Array(period * period);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    const cell = NOISE / period;
    for (let y = 0; y < NOISE; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % period) * period;
      const r1 = ((y0 + 1) % period) * period;
      for (let x = 0; x < NOISE; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % period;
        const c1 = (x0 + 1) % period;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * NOISE + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < out.length; i++) { out[i] /= total; if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
  return out;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function filterWorks() {
  if (canFilter === null) {
    const g = canvas(1, 1).getContext('2d');
    g.filter = 'blur(2px)';
    canFilter = g.filter === 'blur(2px)';
  }
  return canFilter;
}

/** Fill / erase every op's shape, in order, into g (k = canvas px per image px). */
function drawMask(g, ops, k, cw, ch) {
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const op of ops) {
    g.globalCompositeOperation = op.t === 'cut' ? 'destination-out' : 'source-over';
    const p = op.p;
    if (op.k === 'all') g.fillRect(0, 0, cw, ch);
    else if (op.k === 'rect') g.fillRect(p[0] * k, p[1] * k, p[2] * k, p[3] * k);
    else if (op.k === 'poly') {
      g.beginPath();
      g.moveTo(p[0] * k, p[1] * k);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * k, p[i + 1] * k);
      g.closePath();
      g.fill();
    } else if (p.length === 2) {
      g.beginPath();
      g.arc(p[0] * k, p[1] * k, op.r * k, 0, Math.PI * 2);
      g.fill();
    } else {
      g.lineWidth = op.r * 2 * k;
      g.beginPath();
      g.moveTo(p[0] * k, p[1] * k);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * k, p[i + 1] * k);
      g.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
}

/** The mask blurred by radius px (canvas filter, or a shrink-and-grow where filters are missing). */
function blurred(mask, radius) {
  const out = canvas(mask.width, mask.height);
  const g = out.getContext('2d', { willReadFrequently: true });
  if (radius < 0.5) { g.drawImage(mask, 0, 0); return g; }
  if (filterWorks()) {
    g.filter = `blur(${radius.toFixed(1)}px)`;
    g.drawImage(mask, 0, 0);
    g.filter = 'none';
    return g;
  }
  const f = Math.max(1, radius / 2);
  const small = canvas(mask.width / f, mask.height / f);
  const sg = small.getContext('2d');
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(mask, 0, 0, small.width, small.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, out.width, out.height);
  return g;
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);

/**
 * paintFog(fog, width, height, {ops, maxSide, dm}) -> canvas covering the whole image (width × height image px).
 * ops: paint this list instead of fog.ops (an earlier state, for the reveal animation). dm: the DM's see-through view,
 * one slate tint whatever the style (shown at reduced opacity), so the fog's extent is clear on any map.
 */
export function paintFog(fog, width, height, { ops = fog.ops, maxSide = matchMedia('(pointer: coarse)').matches ? 1400 : 2048, dm = false } = {}) {
  const k = Math.min(1, maxSide / Math.max(width, height, 1));
  const cw = Math.max(1, Math.round(width * k));
  const ch = Math.max(1, Math.round(height * k));
  const mask = canvas(cw, ch);
  drawMask(mask.getContext('2d'), ops, k, cw, ch);
  const long = Math.max(cw, ch);
  const soft = fog.softness;
  const radius = fog.style === 'clouds' ? long * (0.004 + soft * 0.018) : long * (0.001 + soft * 0.02);
  const mg = blurred(mask, radius);
  const m = mg.getImageData(0, 0, cw, ch).data;
  const out = canvas(cw, ch);
  const og = out.getContext('2d');
  const img = og.createImageData(cw, ch);
  const d = img.data;
  const op = dm ? 1 : fog.opacity;
  if (fog.style === 'solid' || dm) {
    const [r, g, b] = dm ? [52, 74, 112] : hexRgb(fog.color);
    for (let i = 0; i < d.length; i += 4) {
      const a = m[i + 3];
      if (!a) continue;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a * op;
    }
  } else {
    if (!noise) noise = makeNoise();
    const N = noise;
    const s1 = (NOISE * 2.6) / long; // one noise tile spans ~40% of the map's long side
    const s2 = s1 * 3.3;
    const clouds = fog.style === 'clouds';
    for (let y = 0, i = 0; y < ch; y++) {
      const ny1 = ((y * s1) & 255) * NOISE;
      const ny2 = (((y * s2) + 31) & 255) * NOISE;
      for (let x = 0; x < cw; x++, i += 4) {
        const mv = m[i + 3];
        if (!mv) continue;
        const n = 0.62 * N[ny1 + ((x * s1) & 255)] + 0.38 * N[ny2 + (((x * s2) + 97) & 255)];
        let a;
        let shade;
        if (clouds) {
          const e = mv / 255 + (n - 0.5) * 0.95;
          const t = Math.min(1, Math.max(0, (e - 0.36) / 0.26));
          a = t * t * (3 - 2 * t);
          shade = 0.5 + 0.5 * n;
          d[i] = 148 + 104 * shade; d[i + 1] = 156 + 97 * shade; d[i + 2] = 170 + 86 * shade;
        } else {
          a = (mv / 255) * (0.72 + 0.28 * n);
          shade = 0.9 + 0.1 * n;
          d[i] = 234 * shade; d[i + 1] = 231 * shade; d[i + 2] = 224 * shade;
        }
        d[i + 3] = 255 * a * op;
      }
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}
