// Sheet style ("skin") per character: `char.style` page / panel / border colours, border style and width, corners,
// heading and text fonts (plus the existing highlight `accent`, handled in widgets.js). Pure (Node-testable) apart
// from applySkin / clearSkin, which only touch the element they are given.
// Values are whitelisted: colours must be #rrggbb, everything else an id from the tables below, so a doc can never
// put arbitrary CSS into the page. null always means "the theme's default".

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null);

/** Sheet highlight colour default (oxblood); `style.accent` null = this. Re-exported by data.js. */
export const DEFAULT_ACCENT = '#7a1f1f';

/** Fonts: the site's own (already loaded by index.html) and system stacks; no extra font downloads. */
export const FONTS = [
  { id: 'cinzel', name: 'Cinzel (carved capitals)', stack: '"Cinzel", "Trajan Pro", "Times New Roman", serif' },
  { id: 'alegreya', name: 'Alegreya (book serif)', stack: '"Alegreya", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  { id: 'alegreya-sans', name: 'Alegreya Sans', stack: '"Alegreya Sans", "Segoe UI", system-ui, sans-serif' },
  { id: 'georgia', name: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'palatino', name: 'Palatino', stack: '"Palatino Linotype", "Book Antiqua", Palatino, "URW Palladio L", serif' },
  { id: 'garamond', name: 'Garamond', stack: 'Garamond, "EB Garamond", "Adobe Garamond Pro", "Times New Roman", serif' },
  { id: 'system', name: 'Plain sans (system)', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'hand', name: 'Handwritten', stack: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive' },
  { id: 'typewriter', name: 'Typewriter', stack: '"Courier New", Courier, ui-monospace, monospace' },
];
export const DEFAULT_HEADING_FONT = 'cinzel';
export const DEFAULT_TEXT_FONT = 'alegreya';

export const BORDER_STYLES = [
  { id: 'solid', name: 'Solid' }, { id: 'double', name: 'Double' }, { id: 'ridge', name: 'Carved' },
  { id: 'dashed', name: 'Dashed' }, { id: 'dotted', name: 'Dotted' }, { id: 'none', name: 'None' },
];
export const BORDER_WIDTHS = [{ id: 1, name: 'Thin' }, { id: 2, name: 'Medium' }, { id: 3, name: 'Thick' }];
export const CORNERS = [
  { id: 'square', name: 'Square', radius: ['0px', '0px', '0px'] },
  { id: 'soft', name: 'Soft', radius: null }, // the tokens (6 / 4 / 8 px)
  { id: 'round', name: 'Round', radius: ['12px', '8px', '14px'] },
];

/** Every style field with its default (null = theme default). */
export const STYLE_DEFAULTS = {
  accent: null, page: null, panel: null, border: null,
  borderStyle: null, borderWidth: null, corners: null, headingFont: null, textFont: null,
};

const ids = (list) => new Set(list.map((x) => x.id));
const FONT_IDS = ids(FONTS);
const STYLE_IDS = ids(BORDER_STYLES);
const WIDTH_IDS = ids(BORDER_WIDTHS);
const CORNER_IDS = ids(CORNERS);

/** Sanitize `char.style`: unknown keys dropped, bad values and explicit defaults become null. */
export function normalizeStyle(style) {
  const s = style && typeof style === 'object' && !Array.isArray(style) ? style : {};
  const pick = (v, set, dflt) => (set.has(v) && v !== dflt ? v : null);
  const accent = hex(s.accent);
  return {
    accent: accent === DEFAULT_ACCENT ? null : accent,
    page: hex(s.page),
    panel: hex(s.panel),
    border: hex(s.border),
    borderStyle: pick(s.borderStyle, STYLE_IDS, 'solid'),
    borderWidth: pick(Number(s.borderWidth) || null, WIDTH_IDS, 1),
    corners: pick(s.corners, CORNER_IDS, 'soft'),
    headingFont: pick(s.headingFont, FONT_IDS, DEFAULT_HEADING_FONT),
    textFont: pick(s.textFont, FONT_IDS, DEFAULT_TEXT_FONT),
  };
}

/** True when anything besides the highlight colour differs from the default look. */
export const isCustomSkin = (style) => {
  const s = normalizeStyle(style);
  return Object.keys(STYLE_DEFAULTS).some((k) => k !== 'accent' && s[k] != null);
};

/** One-click looks. Parchment = the default (every field null). Each preset sets every field. */
export const SKIN_PRESETS = [
  { id: 'parchment', name: 'Parchment', style: {} },
  { id: 'stone', name: 'Stone', style: { accent: '#465266', page: '#d6d3cc', panel: '#eeece7', border: '#9a958a', borderStyle: 'ridge', borderWidth: 2, corners: 'square' } },
  { id: 'forest', name: 'Forest', style: { accent: '#3b6b2a', page: '#dde4d0', panel: '#f3f6ec', border: '#93a57e', borderWidth: 2, headingFont: 'garamond', textFont: 'palatino' } },
  { id: 'notebook', name: 'Notebook', style: { accent: '#22507c', page: '#efeadb', panel: '#fffdf6', border: '#a9b8cf', borderStyle: 'dashed', corners: 'round', headingFont: 'hand', textFont: 'georgia' } },
  { id: 'arcane', name: 'Arcane', style: { accent: '#4a3a8c', page: '#15132a', panel: '#211e3a', border: '#4b4378', corners: 'round', textFont: 'alegreya-sans' } },
  { id: 'blood', name: 'Blood oath', style: { accent: '#8e1b1b', page: '#190e0e', panel: '#251515', border: '#5c2b2b', borderStyle: 'double', borderWidth: 3, corners: 'square' } },
].map((p) => ({ ...p, style: { ...STYLE_DEFAULTS, ...normalizeStyle(p.style) } }));

/** The preset whose fields all match `style`, or null. */
export function presetOf(style) {
  const s = normalizeStyle(style);
  return SKIN_PRESETS.find((p) => Object.keys(STYLE_DEFAULTS).every((k) => p.style[k] === s[k])) || null;
}

// ---------- colour helpers ----------

function luminance(h) {
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const ratio = (x, y) => contrast(luminance(x), luminance(y));
// Ink and page ground of each theme (mirror --ink / --bg in tokens.css)
const INK = { light: '#1f1a14', dark: '#ebe3d3' };
const GROUND_BG = { light: '#e9e2d3', dark: '#15130f' };
const AA = 4.5;

function mix(a, b, t) { // t of a, (1 - t) of b, in sRGB
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}

/** 'light' | 'dark': which theme's ink reads better on this colour. */
export function groundOf(color) {
  const c = hex(color) || '#f6f2e9';
  return ratio(c, INK.light) >= ratio(c, INK.dark) ? 'light' : 'dark';
}

/** Ink for text on a colour: the theme's ink, or black / white on mid tones; muted and faint only while still AA. */
export function inkOn(color) {
  const c = hex(color) || '#f6f2e9';
  let ground = groundOf(c);
  let ink = INK[ground];
  if (ratio(c, ink) < AA) { // mid tone: whichever of black / white reads better, and the token set that goes with it
    ground = ratio(c, '#000000') >= ratio(c, '#ffffff') ? 'light' : 'dark';
    ink = ground === 'light' ? '#000000' : '#ffffff';
  }
  const tone = (t) => { const m = mix(ink, c, t); return ratio(c, m) >= AA ? m : ink; };
  return { ground, ink, muted: tone(0.76), faint: tone(0.64) };
}

/**
 * The CSS for a style: `vars` (custom properties, all from whitelisted values) and `data` attributes.
 * - `data-ground` (light|dark) switches the whole token set (tokens.css) to the theme whose ink suits the box fill
 *   (or the page colour when no fill is set), so links and pigments keep their contrast in either theme; --ink,
 *   --ink-muted and --ink-faint are then worked out for that colour (always >= 4.5:1).
 * - When that ink doesn't read on the page colour, `data-sk-pageink` + --ch-page-ink fix the few texts drawn
 *   directly on the page (name, class line, back arrow…).
 */
export function skinCss(style) {
  const s = normalizeStyle(style);
  const vars = {};
  const data = {};
  const base = s.panel || s.page;
  if (base) {
    const ink = inkOn(base);
    data.ground = ink.ground;
    vars['--ink'] = ink.ink;
    vars['--ink-muted'] = ink.muted;
    vars['--ink-faint'] = ink.faint;
    const page = s.page || GROUND_BG[ink.ground];
    if (ratio(page, ink.ink) < AA || ratio(page, ink.muted) < AA) {
      const p = inkOn(page);
      data.skPageink = '';
      vars['--ch-page-ink'] = p.ink;
      vars['--ch-page-muted'] = p.muted;
    }
  }
  if (s.page) { vars['--bg'] = s.page; data.skPage = ''; }
  if (s.panel) { vars['--surface'] = s.panel; data.skPanel = ''; }
  if (s.border) { vars['--border'] = s.border; data.skBorderColor = ''; }
  if (s.borderStyle || s.borderWidth) {
    const st = s.borderStyle || 'solid';
    let w = s.borderWidth || 1;
    if (st === 'double') w = 3; // a double line needs 3px to show two lines
    else if (st === 'ridge') w = Math.max(2, w);
    vars['--ch-bstyle'] = st;
    vars['--ch-bwidth'] = `${w}px`;
    data.skBorder = st;
  }
  const corners = CORNERS.find((c) => c.id === s.corners);
  if (corners?.radius) [vars['--radius'], vars['--radius-sm'], vars['--radius-lg']] = corners.radius;
  if (s.headingFont) { vars['--font-display'] = FONTS.find((f) => f.id === s.headingFont).stack; data.skHeading = s.headingFont; }
  if (s.textFont) {
    const stack = FONTS.find((f) => f.id === s.textFont).stack;
    vars['--font-body'] = stack;
    vars['--font-ui'] = stack;
    data.skText = s.textFont;
  }
  return { vars, data };
}

const DATA_KEYS = ['ground', 'skPage', 'skPageink', 'skPanel', 'skBorderColor', 'skBorder', 'skHeading', 'skText'];
const VAR_KEYS = ['--bg', '--surface', '--border', '--ink', '--ink-muted', '--ink-faint', '--ch-page-ink', '--ch-page-muted', '--ch-bstyle', '--ch-bwidth',
  '--radius', '--radius-sm', '--radius-lg', '--font-display', '--font-body', '--font-ui'];

/** Remove a skin from an element (the characters view when it leaves a sheet). */
export function clearSkin(el) {
  if (!el) return;
  el.classList.remove('ch-skin');
  for (const k of DATA_KEYS) delete el.dataset[k];
  for (const k of VAR_KEYS) el.style.removeProperty(k);
}

/** Put a character's skin on an element (custom properties + data attributes); a default style leaves it clean. */
export function applySkin(el, style) {
  if (!el) return;
  clearSkin(el);
  const { vars, data } = skinCss(style);
  if (!Object.keys(vars).length && !Object.keys(data).length) return;
  el.classList.add('ch-skin');
  for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}
