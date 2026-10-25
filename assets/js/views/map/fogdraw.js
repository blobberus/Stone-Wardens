// Paints a map's fog (fog.js) into one canvas the shape of the map image, at most ~2048 px on its long side (the map
// stretches it; fog is soft, so that is plenty): a faded wash in one color (the map's background color, so the land
// fades into what surrounds the map). The areas make a mask (each area filled inside its own outline, its clearings
// erased), the mask is blurred by the fog's softness and doubled, so the soft edge lies outside the true outline and the
// blur never uncovers anything the DM hid; then it is colored. ~20-40 ms for a full-size fog, run only when it changes.

let canFilter = null;

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

function path(g, p, k) {
  g.moveTo(p[0] * k, p[1] * k);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * k, p[i + 1] * k);
  g.closePath();
}

/** Fill each area inside its own outline and erase its clearings there, oldest first (k = canvas px per image px). */
function drawMask(g, areas, k) {
  g.fillStyle = '#fff';
  for (const a of areas) {
    g.save();
    g.beginPath();
    path(g, a.pts, k);
    g.clip();
    g.fill();
    if (a.holes.length) {
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      for (const hl of a.holes) { path(g, hl, k); g.fill(); g.beginPath(); }
    }
    g.restore();
  }
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

/** '#rrggbb' or 'rgb(r, g, b)' (a computed style) -> [r, g, b]. */
export function parseColor(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [1, 2, 3].map((i) => Math.round(Number(m[i])));
  return [201, 185, 143];
}

/**
 * paintFog(fog, width, height, {color, dm, maxSide}) -> canvas covering the whole image (width × height image px),
 * or null when nothing is fogged. color: the wash (the map's background color). dm: the DM's see-through view (the
 * same color, about half as strong, and crisper edges, so the fog's extent is clear while the map shows through).
 */
export function paintFog(fog, width, height, { color = '#c9b98f', dm = false, maxSide = matchMedia('(pointer: coarse)').matches ? 1400 : 2048 } = {}) {
  const areas = fog.areas.filter((a) => a.on);
  if (!areas.length) return null;
  const k = Math.min(1, maxSide / Math.max(width, height, 1));
  const cw = Math.max(1, Math.round(width * k));
  const ch = Math.max(1, Math.round(height * k));
  const mask = canvas(cw, ch);
  drawMask(mask.getContext('2d'), areas, k);
  const long = Math.max(cw, ch);
  const radius = dm ? long * 0.0015 : long * (0.0015 + fog.softness * 0.012);
  const mg = blurred(mask, radius);
  const m = mg.getImageData(0, 0, cw, ch).data;
  const out = canvas(cw, ch);
  const og = out.getContext('2d');
  const img = og.createImageData(cw, ch);
  const d = img.data;
  const [r, g, b] = parseColor(color);
  const op = dm ? Math.min(0.62, 0.3 + fog.opacity * 0.3) : fog.opacity;
  for (let i = 0; i < d.length; i += 4) {
    const a = m[i + 3];
    if (!a) continue;
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    d[i + 3] = Math.min(255, a * 2) * op; // doubled: the true outline is fully covered, the soft edge lies outside it
  }
  og.putImageData(img, 0, 0);
  return out;
}

/** A small copy of a painted fog (a data URL), remembered to fade a player's old fog into a newer one. */
export function snapshot(cnv, side = 384) {
  try {
    const k = Math.min(1, side / Math.max(cnv.width, cnv.height));
    const c = canvas(cnv.width * k, cnv.height * k);
    c.getContext('2d').drawImage(cnv, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/webp', 0.6);
    return url.startsWith('data:image/webp') ? url : c.toDataURL('image/png');
  } catch { return ''; }
}
