// Map image management (per map): replace with an uploaded image, reset to the placeholder, rename.
// Uploads are staged as binary drafts (store.putBinary) and committed right away (saving.js saveSoon; with the
// global Save when that setting is off). Main map image: content/map/<file>; sub-map images: content/maps/<mapId>/<file>.
import { h } from '../../core/dom.js';
import { toast, choiceDialog, promptDialog, confirmDialog } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { slugify, stripExt, extOf } from '../../core/util.js';
import { saveSoon, saveHint as hintFor, majorSaveOn } from '../../core/saving.js';
import * as data from './data.js';

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const OK_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
const ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';
const WARN_BYTES = 15 * 1024 * 1024;
const MAX_BYTES = 90 * 1024 * 1024; // GitHub's blob API tops out around 100 MB

const mb = (n) => (n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1);
const fmtSize = (s) => `${Math.round(s.width)} × ${Math.round(s.height)} px`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const saveHint = () => hintFor('Press Save to upload it for everyone.');

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

/**
 * Ask for an image file and check it. Must be called straight from a click (user gesture).
 * Resolves {file, ext, size} or null.
 */
export async function chooseImage() {
  const file = await pickFile(ACCEPT);
  if (!file) return null;
  let ext = extOf(file.name);
  if (!OK_EXT.has(ext)) ext = EXT_BY_MIME[file.type] || '';
  if (!OK_EXT.has(ext)) { toast('Choose a PNG, JPG, WebP or SVG image.', { type: 'error' }); return null; }
  if (ext === 'jpeg') ext = 'jpg';
  if (file.size > MAX_BYTES) {
    toast(`That image is ${mb(file.size)} MB, too large for the repository (limit ${mb(MAX_BYTES)} MB). Export a smaller JPG or WebP.`, { type: 'error' });
    return null;
  }
  if (file.size > WARN_BYTES && !(await confirmDialog(
    `This image is ${mb(file.size)} MB. Everyone downloads it to see the map, so it may load slowly. A JPG or WebP export is usually much smaller. Use it anyway?`,
    { title: 'Large image', okLabel: 'Use it' },
  ))) return null;
  const size = await imageSize(file, ext);
  if (!size) { toast('Could not read that image.', { type: 'error' }); return null; }
  return { file, ext, size };
}

/** Stage a chosen image as the map's image (removes the previous upload). Returns true on success. */
export async function stageImage(mapId, { file, ext, size }) {
  const cfg = data.readMapConfig(mapId);
  const path = `${data.mapImageDir(mapId)}/${slugify(stripExt(file.name)) || 'map'}.${ext}`;
  try {
    await store.putBinary(path, file, { hidden: data.mapHidden(mapId) ? true : null }); // a hidden map's image stays hidden
  } catch (e) {
    console.error(e);
    toast(`Could not stage the image: ${e.message}`, { type: 'error' });
    return false;
  }
  data.writeMapConfig(mapId, { image: path, width: size.width, height: size.height });
  const old = cfg.image;
  if (old && old !== path && old.startsWith(`${data.mapImageDir(mapId)}/`) && !old.endsWith('.json')) store.remove(old);
  return true;
}

function sizeDiffers(a, b) {
  return !!(a.width && a.height && b.width && b.height)
    && (Math.round(a.width) !== Math.round(b.width) || Math.round(a.height) !== Math.round(b.height));
}

/** Pins, pictures, fog, crop and scale follow the new size. */
function rescalePins(mapId, from, to) {
  data.rescaleMapContent(mapId, to.width / from.width, to.height / from.height);
}

/** What on this map is placed in image pixels: pins, and pictures, fog, a crop or a scale ("" when nothing). */
function placedThings(mapId) {
  const d = data.readMapConfig(mapId).design || {};
  const parts = [];
  const n = data.locationsOn(mapId).length;
  if (n) parts.push(plural(n, 'existing pin'));
  const p = data.picturesOn(mapId).length;
  if (p) parts.push(plural(p, 'picture'));
  if (data.fogOf(mapId).ops.length) parts.push('the fog');
  if (d.crop) parts.push('the crop');
  if (Number(d.scale?.perPx) > 0) parts.push('the scale');
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}

/** Ask what to do with what is placed on the map when its size changes. Resolves 'rescale' | 'keep' | null (cancel). */
async function askRescale(mapId, from, to, verb) {
  const what = placedThings(mapId);
  if (!what || !sizeDiffers(from, to)) return 'keep';
  return choiceDialog(
    h('div', { class: 'stack' },
      h('p', null, `The new image is ${fmtSize(to)}; the current map is ${fmtSize(from)}.`),
      h('p', null, `Pins, pictures and fog are stored in image pixels. Rescale ${what} so everything keeps its relative place, or keep the pixel coordinates? (Edit map → Offset / scale can fine-tune pins later.)`)),
    [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: `${verb}, keep coordinates`, value: 'keep', kind: 'ghost' },
      { label: `${verb} and rescale`, value: 'rescale', kind: 'primary' },
    ],
    { title: 'The map size is changing' },
  );
}

/** info: the map's effective config {id, image, width, height, name, isPlaceholder}. */
export async function replaceImage(info) {
  const picked = await chooseImage(); // must run before any await so the click counts as a user gesture
  if (!picked) return false;
  const choice = await askRescale(info.id, info, picked.size, 'Replace');
  if (!choice) return false;
  if (!(await stageImage(info.id, picked))) return false;
  if (choice === 'rescale') rescalePins(info.id, info, picked.size);
  const hint = saveHint();
  toast(`New image for “${info.name}” ${hint ? 'staged' : 'added'} (${mb(picked.file.size)} MB, ${fmtSize(picked.size)}). ${hint}`.trim(), { type: 'success', timeout: hint ? 6000 : 4000 });
  saveSoon(`map: new image for “${info.name}”`);
  return true;
}

export async function resetImage(info) {
  const cfg = data.readMapConfig(info.id);
  if (data.isPlaceholderImage(cfg.image)) { toast('This map already uses the placeholder.'); return false; }
  const ph = await data.placeholderSize();
  const asked = !!placedThings(info.id) && sizeDiffers(info, ph);
  const choice = asked
    ? await askRescale(info.id, info, ph, 'Reset')
    : ((await confirmDialog(
      `Go back to the blank placeholder map? The uploaded image is removed ${majorSaveOn() ? 'from the repository' : 'when you save'} (it stays in the repository history).`,
      { title: 'Reset the map image', okLabel: 'Reset' },
    )) ? 'keep' : null);
  if (!choice) return false;
  if (choice === 'rescale') rescalePins(info.id, info, ph);
  data.writeMapConfig(info.id, { image: data.PLACEHOLDER_IMAGE, width: ph.width, height: ph.height });
  if (cfg.image?.startsWith(`${data.mapImageDir(info.id)}/`) && !cfg.image.endsWith('.json')) store.remove(cfg.image);
  toast(`“${info.name}” is back to the blank placeholder.`);
  saveSoon(`map: reset “${info.name}” to the placeholder`);
  return true;
}

export async function renameMap(info) {
  const name = await promptDialog('Rename the map', { label: 'Map name', value: info.name, okLabel: 'Rename' });
  const n = name?.trim();
  if (!n || n === info.name) return false;
  const cfg = data.readMapConfig(info.id);
  data.writeMapConfig(info.id, {
    image: cfg.image || (info.isPlaceholder ? '' : info.image),
    width: cfg.width || info.width,
    height: cfg.height || info.height,
    name: n,
  });
  return true;
}
