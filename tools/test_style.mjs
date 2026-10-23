// Sheet style (characters/skin.js): sanitising, presets, readable ink, CSS output. Run: node tools/test_style.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = await import(pathToFileURL(path.join(ROOT, 'assets/js/views/characters/skin.js')).href);

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- normalizeStyle ----------
const empty = K.normalizeStyle({});
check('empty style = all null', Object.values(empty).every((v) => v === null) && eq(Object.keys(empty).sort(), Object.keys(K.STYLE_DEFAULTS).sort()), empty);
check('non-object style', eq(K.normalizeStyle(null), empty) && eq(K.normalizeStyle([1]), empty) && eq(K.normalizeStyle('x'), empty));
check('hex lower-cased', K.normalizeStyle({ page: '#ABCDEF' }).page === '#abcdef');
for (const bad of ['red', '#12345', '#1234567', 'url(x)', '#000000; background: red', 'var(--bg)', 12, null]) {
  check(`bad color rejected: ${bad}`, K.normalizeStyle({ page: bad, panel: bad, border: bad, accent: bad }).page === null
    && K.normalizeStyle({ panel: bad }).panel === null && K.normalizeStyle({ border: bad }).border === null && K.normalizeStyle({ accent: bad }).accent === null);
}
check('default accent stored as null', K.normalizeStyle({ accent: '#7A1F1F' }).accent === null);
check('other accent kept', K.normalizeStyle({ accent: '#22507C' }).accent === '#22507c');
check('border style whitelist', K.normalizeStyle({ borderStyle: 'double' }).borderStyle === 'double'
  && K.normalizeStyle({ borderStyle: 'groove' }).borderStyle === null && K.normalizeStyle({ borderStyle: 'solid' }).borderStyle === null);
check('border width 2/3 kept, 1 and junk null', K.normalizeStyle({ borderWidth: '2' }).borderWidth === 2 && K.normalizeStyle({ borderWidth: 3 }).borderWidth === 3
  && K.normalizeStyle({ borderWidth: 1 }).borderWidth === null && K.normalizeStyle({ borderWidth: 9 }).borderWidth === null && K.normalizeStyle({ borderWidth: 'x' }).borderWidth === null);
check('corners whitelist', K.normalizeStyle({ corners: 'round' }).corners === 'round' && K.normalizeStyle({ corners: 'soft' }).corners === null && K.normalizeStyle({ corners: '50%' }).corners === null);
check('fonts whitelist, defaults null', K.normalizeStyle({ headingFont: 'hand', textFont: 'georgia' }).headingFont === 'hand'
  && K.normalizeStyle({ headingFont: 'cinzel' }).headingFont === null && K.normalizeStyle({ textFont: 'alegreya' }).textFont === null
  && K.normalizeStyle({ headingFont: 'Comic Sans; } body { x' }).headingFont === null);
check('unknown keys dropped', !('evil' in K.normalizeStyle({ evil: 'x' })));

// ---------- ground / ink ----------
check('dark color -> dark ground', K.groundOf('#15132a') === 'dark' && K.groundOf('#251515') === 'dark' && K.groundOf('#000000') === 'dark');
check('light color -> light ground', K.groundOf('#eeece7') === 'light' && K.groundOf('#ffffff') === 'light' && K.groundOf('#f6f2e9') === 'light');

function lum(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const INK = { light: '#1f1a14', dark: '#ebe3d3' };
// Whatever color is picked, ink, muted and faint ink read on it (AA 4.5:1), as box fill or as page behind boxes
let worst = 99;
let worstPage = 99;
const others = ['#ffffff', '#f6f2e9', '#1e1b16', '#000000', '#808080'];
for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
  const hx = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const v = K.skinCss({ panel: hx }).vars;
  worst = Math.min(worst, ratio(hx, v['--ink']), ratio(hx, v['--ink-muted']), ratio(hx, v['--ink-faint']));
  for (const panel of others) {
    const pv = K.skinCss({ page: hx, panel }).vars;
    const ink = pv['--ch-page-ink'] || pv['--ink'];
    const muted = pv['--ch-page-muted'] || pv['--ink-muted'];
    worstPage = Math.min(worstPage, ratio(hx, ink), ratio(hx, muted));
  }
}
check('box text contrast >= 4.5 on every color', worst >= 4.5, worst.toFixed(2));
check('page text contrast >= 4.5 on every page color', worstPage >= 4.5, worstPage.toFixed(2));
check('theme ink kept where it reads', K.inkOn('#f6f2e9').ink === INK.light && K.inkOn('#1e1b16').ink === INK.dark);
check('mid tone gets black or white', ['#000000', '#ffffff'].includes(K.inkOn('#777777').ink));

// ---------- skinCss ----------
check('default style -> no CSS', eq(K.skinCss({}), { vars: {}, data: {} }));
check('accent alone -> no skin (accent is applied per box)', eq(K.skinCss({ accent: '#22507c' }), { vars: {}, data: {} }));
const dark = K.skinCss({ panel: '#211e3a' });
check('dark box fill -> dark ground + surface', dark.data.ground === 'dark' && dark.vars['--surface'] === '#211e3a' && 'skPanel' in dark.data, dark);
const mixed = K.skinCss({ page: '#15132a', panel: '#eeece7' });
check('dark page + light boxes -> light ground, page ink fixed', mixed.data.ground === 'light' && 'skPageink' in mixed.data && mixed.vars['--ch-page-ink'] === INK.dark, mixed);
check('box ink follows the box fill', mixed.vars['--ink'] === INK.light && dark.vars['--ink'] === INK.dark);
const same = K.skinCss({ page: '#d6d3cc', panel: '#eeece7' });
check('same-ground page needs no ink fix', same.data.ground === 'light' && !('skPageink' in same.data));
check('page alone sets the ground', K.skinCss({ page: '#190e0e' }).data.ground === 'dark');
check('double border is 3px', K.skinCss({ borderStyle: 'double' }).vars['--ch-bwidth'] === '3px' && K.skinCss({ borderStyle: 'double', borderWidth: 2 }).vars['--ch-bwidth'] === '3px');
check('carved border at least 2px', K.skinCss({ borderStyle: 'ridge' }).vars['--ch-bwidth'] === '2px' && K.skinCss({ borderStyle: 'ridge', borderWidth: 3 }).vars['--ch-bwidth'] === '3px');
check('width alone keeps solid', K.skinCss({ borderWidth: 2 }).vars['--ch-bstyle'] === 'solid' && K.skinCss({ borderWidth: 2 }).data.skBorder === 'solid');
check('square corners', K.skinCss({ corners: 'square' }).vars['--radius'] === '0px' && K.skinCss({ corners: 'square' }).vars['--radius-sm'] === '0px');
const tf = K.skinCss({ textFont: 'georgia' });
check('text font sets body + ui', tf.vars['--font-body'] === tf.vars['--font-ui'] && tf.vars['--font-body'].startsWith('Georgia'));
check('heading font', K.skinCss({ headingFont: 'hand' }).vars['--font-display'].includes('Segoe Print') && K.skinCss({ headingFont: 'hand' }).data.skHeading === 'hand');
// no doc value can reach the CSS: random junk never shows up in vars
const junk = ['};body{display:none', 'expression(alert(1))', '<script>', '#zzzzzz', 'red', '1;2', 'url(//x)'];
let leaked = false;
for (const j of junk) {
  const out = K.skinCss({ accent: j, page: j, panel: j, border: j, borderStyle: j, borderWidth: j, corners: j, headingFont: j, textFont: j });
  if (Object.keys(out.vars).length || Object.keys(out.data).length) leaked = true;
}
check('junk values produce no CSS', !leaked);
const allowed = new Set(K.FONTS.map((f) => f.stack));
for (const p of K.SKIN_PRESETS) {
  const css = K.skinCss(p.style);
  const ok = Object.entries(css.vars).every(([k, v]) => (k.startsWith('--font-') ? allowed.has(v) : /^(#[0-9a-f]{6}|\d+px|[a-z]+)$/.test(v)));
  check(`preset ${p.id}: vars are plain values`, ok, css.vars);
}

// ---------- presets ----------
check('presets: parchment first and default', K.SKIN_PRESETS[0].id === 'parchment' && Object.values(K.SKIN_PRESETS[0].style).every((v) => v === null));
check('preset ids unique', new Set(K.SKIN_PRESETS.map((p) => p.id)).size === K.SKIN_PRESETS.length);
for (const p of K.SKIN_PRESETS) {
  check(`preset ${p.id} round-trips`, K.presetOf(p.style)?.id === p.id);
  check(`preset ${p.id} is already normalized`, eq(K.normalizeStyle(p.style), p.style), p.style);
  if (p.style.panel) check(`preset ${p.id} box text readable`, ratio(p.style.panel, INK[K.groundOf(p.style.panel)]) >= 7);
  if (p.style.page) check(`preset ${p.id} page text readable`, ratio(p.style.page, INK[K.groundOf(p.style.page)]) >= 7);
}
check('presetOf({}) = parchment', K.presetOf({})?.id === 'parchment');
check('presetOf(custom) = null', K.presetOf({ page: '#123456' }) === null);
check('isCustomSkin', !K.isCustomSkin({}) && !K.isCustomSkin({ accent: '#22507c' }) && K.isCustomSkin({ corners: 'round' }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
