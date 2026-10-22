// Location hierarchy: four ranks, each visible over a band of the map's zoom range.
// Zoom positions are fractions of the map's own range: 0 = fully zoomed out, 1 = fully zoomed in.
// A rank fades in over FADE before its `from` and fades out over FADE after its `to`, so bands overlap.

export const RANKS = [
  { rank: 1, name: 'Major', hint: 'Realms and capitals. Shown when zoomed out.' },
  { rank: 2, name: 'Notable', hint: 'Cities, regions, great landmarks.' },
  { rank: 3, name: 'Local', hint: 'Towns, villages, dungeons and sites.' },
  { rank: 4, name: 'Minor', hint: 'Shops, camps and small details. Shown up close.' },
];
export const RANK_IDS = [1, 2, 3, 4];
export const rankName = (r) => RANKS[r - 1]?.name || 'Local';

/** [from, to] per rank, in percent of the zoom range. Stored per map as config.rankBands. */
export const DEFAULT_BANDS = [[0, 62], [26, 82], [45, 100], [64, 100]];
export const FADE = 0.08;

export const validRank = (r) => {
  const n = Number(r);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
};

/** Sanitised bands from a config value (falls back to the defaults per rank). */
export function normBands(raw) {
  return DEFAULT_BANDS.map((def, i) => {
    const b = Array.isArray(raw) ? raw[i] : null;
    if (!Array.isArray(b) || b.length !== 2) return [...def];
    let [a, z] = b.map((v) => Math.min(100, Math.max(0, Math.round(Number(v)))));
    if (!Number.isFinite(a) || !Number.isFinite(z)) return [...def];
    if (i === 0) a = 0; // the top rank always shows fully zoomed out
    if (i === 3) z = 100; // and the bottom rank fully zoomed in
    if (z < a + 5) z = Math.min(100, a + 5);
    return [a, z];
  });
}

export const sameBands = (a, b) => JSON.stringify(normBands(a)) === JSON.stringify(normBands(b));

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Opacity (0..1) of a rank at zoom position u (0..1). */
export function rankOpacity(rank, u, bands) {
  const [a, z] = bands[rank - 1].map((v) => v / 100);
  let o = 1;
  if (a > 0) o = Math.min(o, smooth((u - (a - FADE)) / FADE));
  if (z < 1) o = Math.min(o, 1 - smooth((u - z) / FADE));
  return o;
}

/** 'now' | 'in' (zoom in to see it) | 'out' (zoom out to see it) */
export function rankWhere(rank, u, bands) {
  if (rankOpacity(rank, u, bands) > 0.05) return 'now';
  return u < bands[rank - 1][0] / 100 ? 'in' : 'out';
}
