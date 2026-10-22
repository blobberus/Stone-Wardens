// Map image management: replace with an uploaded image, reset to the placeholder, rename the map.
// Uploads are staged as binary drafts (store.putBinary) and committed with the global Save.
import { h } from '../../core/dom.js';
import { toast, choiceDialog, promptDialog, confirmDialog } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { slugify, stripExt, extOf } from '../../core/util.js';
import { getSetting } from '../../core/settings.js';
import * as data from './data.js';

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const OK_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
const ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';
const WARN_BYTES = 15 * 1024 * 1024;
const MAX_BYTES = 90 * 1024 * 1024; // GitHub's blob API tops out around 100 MB

const mb = (n) => (n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1);
const fmtSize = (s) => `${Math.round(s.width)} × ${Math.round(s.height)} px`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const saveHint = () => (getSetting('autoCommit') ? 'It will be committed automatically.' : 'Press Save to upload it for everyone.');

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: 'position:fixed;left:-9999px;top:0' });
    let done = false;
    const finish = (f) => { if (done) return; done = true; inp.remove(); resolve(f); };
    inp.addEventListener('change', () => finish(inp.files?.[0] || null));
    inp.addEventListener('cancel', () => finish(null));
    document.body.append(inp);
    inp.click();
  });
}

/** Natural size of an image file. SVGs use their viewBox when present. */
export async function imageSize(file, ext = extOf(file.name)) {
  if (ext === 'svg') {
    try {
      const s = data.svgSize(await file.text());
      if (s) return s;
    } catch { /* fall through to Image() */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    if (img.naturalWidth > 0 && img.naturalHeight > 0) return { width: img.naturalWidth, height: img.naturalHeight };
  } catch { /* unreadable */ } finally {
    URL.revokeObjectURL(url);
  }
  return ext === 'svg' ? { ...data.DEFAULT_SIZE } : null;
}

function sizeDiffers(a, b) {
  return !!(a.width && a.height && b.width && b.height)
    && (Math.round(a.width) !== Math.round(b.width) || Math.round(a.height) !== Math.round(b.height));
}

function rescalePins(from, to) {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  for (const loc of data.locations()) data.saveLocation({ ...loc, x: loc.x * sx, y: loc.y * sy });
}

/** Ask what to do with existing pins when the map size changes. Resolves 'rescale' | 'keep' | null (cancel). */
async function askRescale(from, to, verb) {
  const n = data.locations().length;
  if (!n || !sizeDiffers(from, to)) return 'keep';
  return choiceDialog(
    h('div', { class: 'stack' },
      h('p', null, `The new image is ${fmtSize(to)}; the current map is ${fmtSize(from)}.`),
      h('p', null, `Rescale the ${plural(n, 'existing pin')} so each keeps its relative place, or keep their pixel coordinates?`)),
    [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: `${verb}, keep coordinates`, value: 'keep', kind: 'ghost' },
      { label: `${verb} and rescale pins`, value: 'rescale', kind: 'primary' },
    ],
    { title: 'The map size is changing' },
  );
}

/** info: the current effective config {image, width, height, name, isPlaceholder}. */
export async function replaceImage(info) {
  const file = await pickFile(ACCEPT); // must run before any await so the click counts as a user gesture
  if (!file) return false;
  let ext = extOf(file.name);
  if (!OK_EXT.has(ext)) ext = EXT_BY_MIME[file.type] || '';
  if (!OK_EXT.has(ext)) { toast('Choose a PNG, JPG, WebP or SVG image.', { type: 'error' }); return false; }
  if (ext === 'jpeg') ext = 'jpg';
  if (file.size > MAX_BYTES) {
    toast(`That image is ${mb(file.size)} MB, too large for the repository (limit ${mb(MAX_BYTES)} MB). Export a smaller JPG or WebP.`, { type: 'error' });
    return false;
  }
  if (file.size > WARN_BYTES && !(await confirmDialog(
    `This image is ${mb(file.size)} MB. Everyone downloads it to see the map, so it may load slowly. A JPG or WebP export is usually much smaller. Use it anyway?`,
    { title: 'Large image', okLabel: 'Use it' },
  ))) return false;

  const size = await imageSize(file, ext);
  if (!size) { toast('Could not read that image.', { type: 'error' }); return false; }
  const choice = await askRescale(info, size, 'Replace');
  if (!choice) return false;

  const cfg = data.readConfig();
  const path = `${data.MAP_DIR}/${slugify(stripExt(file.name)) || 'map'}.${ext}`;
  try {
    await store.putBinary(path, file);
  } catch (e) {
    console.error(e);
    toast(`Could not stage the image: ${e.message}`, { type: 'error' });
    return false;
  }
  if (choice === 'rescale') rescalePins(info, size);
  data.writeConfig({ image: path, width: size.width, height: size.height, name: cfg.name || info.name });
  const old = cfg.image;
  if (old && old !== path && old.startsWith(`${data.MAP_DIR}/`) && old !== data.CONFIG_PATH) store.remove(old);
  toast(`New map image staged (${mb(file.size)} MB, ${fmtSize(size)}). ${saveHint()}`, { type: 'success', timeout: 6000 });
  return true;
}

export async function resetImage(info) {
  const cfg = data.readConfig();
  if (data.isPlaceholderImage(cfg.image)) { toast('The map already uses the placeholder.'); return false; }
  const ph = await data.placeholderSize();
  const asked = data.locations().length > 0 && sizeDiffers(info, ph);
  const choice = asked
    ? await askRescale(info, ph, 'Reset')
    : ((await confirmDialog(
      'Go back to the blank placeholder map? The uploaded image is removed when you save (it stays in the repository history).',
      { title: 'Reset the map image', okLabel: 'Reset' },
    )) ? 'keep' : null);
  if (!choice) return false;
  if (choice === 'rescale') rescalePins(info, ph);
  data.writeConfig({ image: data.PLACEHOLDER_IMAGE, width: ph.width, height: ph.height, name: cfg.name || info.name });
  if (cfg.image?.startsWith(`${data.MAP_DIR}/`) && cfg.image !== data.CONFIG_PATH) store.remove(cfg.image);
  toast('The map is back to the blank placeholder.');
  return true;
}

export async function renameMap(info) {
  const name = await promptDialog('Rename the map', { label: 'Map name', value: info.name, okLabel: 'Rename' });
  const n = name?.trim();
  if (!n || n === info.name) return false;
  const cfg = data.readConfig();
  data.writeConfig({
    image: cfg.image || info.image,
    width: cfg.width || info.width,
    height: cfg.height || info.height,
    name: n,
  });
  return true;
}
