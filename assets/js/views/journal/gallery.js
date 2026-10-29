// Reference images of a journal note: photos kept with the note and shown as a slideshow at the top of the page;
// "Expand" (or a tap on the photo) opens a full-screen viewer to scroll through all of them.
// Model (docs/journal-model.md "Reference images"): frontmatter `images:` = a list of repo paths or https URLs, each a
// string or {src, caption}. Uploads are staged with store.putBinary under content/media/journal/ (committed right away
// by saving.js saveSoon, like map and library uploads); images already in the repo (uploaded through GitHub, the Warden's
// Library, a map) can be picked too. Large photos are scaled down before upload (MAX_SIDE, JPEG).
import { h } from '../../core/dom.js';
import { icon, toast, pickFromList } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { slugify, stripExt, extOf, baseName } from '../../core/util.js';
import { saveSoon, saveHint as hintFor } from '../../core/saving.js';

export const MEDIA_DIR = 'content/media/journal';
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg';
const MAX_SIDE = 2400;            // longest side of an uploaded photo, px
const KEEP_BYTES = 1.5 * 1024 * 1024; // smaller files are uploaded as they are
const MAX_IN = 40 * 1024 * 1024;  // refuse larger originals
const MAX_OUT = 20 * 1024 * 1024; // refuse anything still larger after scaling
const JPEG_Q = 0.86;

const isUrl = (s) => /^https?:\/\//i.test(String(s || ''));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortId = () => Math.random().toString(36).slice(2, 6);
const saveHint = () => hintFor('They upload for everyone with your next Save.', 'They are committed automatically.');

/** A note's reference images from its frontmatter: [{src, caption}] (junk entries dropped). */
export function noteImages(fm) {
  const raw = fm && fm.images;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const it of list) {
    const src = typeof it === 'string' ? it : it && typeof it === 'object' ? (it.src || it.path || it.url) : null;
    if (!src || typeof src !== 'string') continue;
    out.push({ src: src.trim(), caption: typeof it === 'object' && it.caption ? String(it.caption) : '' });
  }
  return out;
}

/** Frontmatter value for a list: plain strings, {src, caption} only where a caption exists; undefined when empty. */
export function imagesValue(list) {
  const out = (list || []).filter((x) => x && x.src).map((x) => (x.caption ? { src: x.src, caption: x.caption } : x.src));
  return out.length ? out : undefined;
}

const urlCache = new Map();
/** Object URL (repo file) or the URL itself; null when the file is missing. */
async function srcUrl(src) {
  if (isUrl(src) || /^data:image\//.test(src)) return src;
  try { return await store.fileUrl(src); } catch { return null; }
}

function setImg(img, src, onMissing) {
  const want = src;
  img.dataset.src = want;
  if (urlCache.has(want)) { img.src = urlCache.get(want); return; }
  srcUrl(want).then((url) => {
    if (img.dataset.src !== want) return;
    if (!url) { onMissing?.(); return; }
    if (!/^blob:/.test(url)) urlCache.set(want, url);
    img.src = url;
  });
}

const altOf = (it, i, n) => it.caption || `Reference image ${i + 1} of ${n}: ${baseName(it.src)}`;

// ---------- slideshow (top of the note, collapsed) ----------

/**
 * The slideshow shown at the top of a note while it is not expanded: one photo at a time, previous / next, a counter,
 * the caption and a thumbnail strip. Arrow keys, a swipe or the thumbnails move; a tap on the photo or "Expand" opens
 * the viewer at that photo.
 * @param {Array<{src, caption}>} list
 * @param {{start?:number, onIndex?:(i)=>void, label?:string}} [o]
 * @returns {HTMLElement}
 */
export function slideshow(list, o = {}) {
  const n = list.length;
  let i = Math.max(0, Math.min(n - 1, o.start || 0));
  const img = h('img', { class: 'jr-gal-img', alt: '', decoding: 'async', draggable: 'false' });
  const missing = h('p', { class: 'jr-gal-missing', hidden: true });
  const frame = h('button', { type: 'button', class: 'jr-gal-frame', title: 'Open the photos (full screen)' }, img, missing);
  const count = h('span', { class: 'jr-gal-count', 'aria-live': 'polite' });
  const cap = h('p', { class: 'jr-gal-cap' });
  const prev = h('button', { type: 'button', class: 'btn btn-icon jr-gal-nav jr-gal-prev', 'aria-label': 'Previous photo' }, icon('chevron-left'));
  const next = h('button', { type: 'button', class: 'btn btn-icon jr-gal-nav jr-gal-next', 'aria-label': 'Next photo' }, icon('chevron-right'));
  const expand = h('button', { type: 'button', class: 'btn btn-ghost btn-sm jr-gal-expand' }, icon('eye'), h('span', null, 'Expand'));
  const thumbs = n > 1 ? h('div', { class: 'jr-gal-thumbs', role: 'tablist', 'aria-label': 'Photos' }) : null;
  const thumbBtns = [];
  if (thumbs) {
    list.forEach((it, k) => {
      const t = h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
      setImg(t, it.src);
      const b = h('button', { type: 'button', class: 'jr-gal-thumb', role: 'tab', 'aria-label': `Photo ${k + 1}${it.caption ? `: ${it.caption}` : ''}`, onclick: () => show(k) }, t);
      thumbBtns.push(b);
      thumbs.append(b);
    });
  }
  const root = h('section', { class: ['jr-gallery', n === 1 && 'is-single'], 'aria-label': o.label || `Reference images (${n})`, tabindex: '0' },
    h('div', { class: 'jr-gal-stage' }, frame, n > 1 ? prev : null, n > 1 ? next : null),
    h('div', { class: 'jr-gal-bar' }, n > 1 ? count : h('span', { class: 'jr-gal-count' }, 'Reference image'), cap, expand),
    thumbs);

  function show(k) {
    i = (k + n) % n;
    const it = list[i];
    missing.hidden = true;
    img.hidden = false;
    img.alt = altOf(it, i, n);
    img.removeAttribute('src');
    setImg(img, it.src, () => { img.hidden = true; missing.hidden = false; missing.textContent = `Missing image: ${baseName(it.src)}`; });
    count.textContent = `${i + 1} / ${n}`;
    cap.textContent = it.caption || '';
    cap.hidden = !it.caption;
    thumbBtns.forEach((b, q) => { b.classList.toggle('is-active', q === i); b.setAttribute('aria-selected', String(q === i)); });
    thumbBtns[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (n > 1) setImg(new Image(), list[(i + 1) % n].src); // warm the next one
    o.onIndex?.(i);
  }
  prev.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => show(i + 1));
  frame.addEventListener('click', () => openViewer(list, i, { back: frame }));
  expand.addEventListener('click', () => openViewer(list, i, { back: expand }));
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft' && n > 1) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'ArrowRight' && n > 1) { e.preventDefault(); show(i + 1); }
  });
  // swipe on touch screens
  let x0 = null;
  frame.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
  frame.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40 && n > 1) { e.preventDefault(); show(dx < 0 ? i + 1 : i - 1); frame.dataset.swiped = '1'; }
  });
  frame.addEventListener('click', (e) => { if (frame.dataset.swiped) { delete frame.dataset.swiped; e.stopImmediatePropagation(); } }, true);
  show(i);
  root.show = show;
  return root;
}

// ---------- viewer (expanded) ----------

/**
 * Full-screen viewer: every photo, large, one under the other, to scroll through; opens at `start`. Esc or the close
 * button closes it; arrow keys / Page keys jump photo by photo. Focus stays inside and returns to `back`.
 */
export function openViewer(list, start = 0, { back = document.activeElement } = {}) {
  const n = list.length;
  if (!n) return null;
  const count = h('span', { class: 'jr-view-count' }, `${start + 1} / ${n}`);
  const close = h('button', { type: 'button', class: 'btn btn-icon jr-view-close', 'aria-label': 'Close the photos' }, icon('close'));
  const figs = list.map((it, k) => {
    const img = h('img', { class: 'jr-view-img', alt: altOf(it, k, n), decoding: 'async', loading: Math.abs(k - start) > 1 ? 'lazy' : 'eager', draggable: 'false' });
    const miss = h('p', { class: 'jr-gal-missing', hidden: true }, `Missing image: ${baseName(it.src)}`);
    setImg(img, it.src, () => { img.hidden = true; miss.hidden = false; });
    return h('figure', { class: 'jr-view-fig', 'data-i': k }, img, miss,
      h('figcaption', { class: 'jr-view-cap' }, h('span', { class: 'jr-view-num' }, `${k + 1} / ${n}`), it.caption ? h('span', null, it.caption) : null));
  });
  const scroller = h('div', { class: 'jr-view-scroll', tabindex: '0' }, figs);
  const el = h('div', { class: 'jr-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Reference images, ${plural(n, 'photo')}` },
    h('header', { class: 'jr-view-bar' }, h('span', { class: 'jr-view-title' }, icon('image'), h('span', null, 'Reference images')), count, close),
    scroller);
  (document.querySelector('body > #overlays') || document.body).append(el);
  document.documentElement.classList.add('jr-viewer-open');
  let cur = start;
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { cur = Number(e.target.dataset.i); count.textContent = `${cur + 1} / ${n}`; }
  }, { root: scroller, threshold: 0.55 });
  figs.forEach((f) => seen.observe(f));
  const go = (k, smooth = true) => {
    cur = Math.max(0, Math.min(n - 1, k));
    figs[cur].scrollIntoView({ block: 'start', behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  };
  const done = () => {
    seen.disconnect();
    el.remove();
    document.documentElement.classList.remove('jr-viewer-open');
    document.removeEventListener('keydown', onKey, true);
    if (back && back.isConnected) back.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
    else if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(n - 1); }
    else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === close ? scroller : close).focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  close.addEventListener('click', done);
  el.addEventListener('click', (e) => { if (e.target === scroller || e.target === el) done(); });
  requestAnimationFrame(() => { go(start, false); close.focus({ preventScroll: true }); });
  return { close: done, el };
}

// ---------- uploads ----------

function pickFiles() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: ACCEPT, multiple: true, style: 'position:fixed;left:-9999px;top:0' });
    let fin = false;
    const finish = (files) => { if (fin) return; fin = true; inp.remove(); resolve(files); };
    inp.addEventListener('change', () => finish([...(inp.files || [])]));
    inp.addEventListener('cancel', () => finish([]));
    document.body.append(inp);
    inp.click();
  });
}

const extFor = (file) => {
  let ext = extOf(file.name);
  if (!IMAGE_EXT.has(ext)) ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' }[file.type] || '';
  return ext === 'jpeg' ? 'jpg' : ext;
};

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Make a photo fit for the repository: GIF / SVG and small files as they are; otherwise scaled to MAX_SIDE on its long
 * side and saved as JPEG (kept as is when that is not smaller). -> {blob, ext} or throws an Error with a reason.
 */
export async function prepareImage(file) {
  const ext = extFor(file);
  if (!IMAGE_EXT.has(ext)) throw new Error(`${file.name}: not an image (PNG, JPG, WebP, GIF, AVIF or SVG)`);
  if (file.size > MAX_IN) throw new Error(`${file.name} is ${Math.round(file.size / 1048576)} MB, too large`);
  if (ext === 'gif' || ext === 'svg' || file.size <= KEEP_BYTES) return { blob: file, ext };
  const src = await decode(file);
  const w = src.width || src.naturalWidth, hgt = src.height || src.naturalHeight;
  if (!w || !hgt) throw new Error(`${file.name}: could not read the image`);
  const k = Math.min(1, MAX_SIDE / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(hgt * k);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // JPEG has no transparency
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q));
  if (!blob) return { blob: file, ext };
  const out = blob.size < file.size ? { blob, ext: 'jpg' } : { blob: file, ext };
  if (out.blob.size > MAX_OUT) throw new Error(`${file.name} is still ${Math.round(out.blob.size / 1048576)} MB after scaling`);
  return out;
}

/**
 * Stage files as reference images of a note (slug = the note's file name). -> [{src, caption:''}] added.
 * opts.hidden (DM mode): true for a hidden note's photos, false for a visible note's.
 */
export async function uploadImages(files, slug = 'note', { hidden = null } = {}) {
  const added = [];
  const failed = [];
  for (const f of files) {
    try {
      const { blob, ext } = await prepareImage(f);
      const name = slugify(stripExt(f.name)).slice(0, 40) || 'image';
      const path = `${MEDIA_DIR}/${slugify(slug).slice(0, 40) || 'note'}-${name}-${shortId()}.${ext}`;
      await store.putBinary(path, blob, { hidden });
      added.push({ src: path, caption: '' });
    } catch (e) {
      failed.push(e.message || String(e));
    }
  }
  if (failed.length) toast(`Could not add ${plural(failed.length, 'image')}: ${failed.join('; ')}`, { type: 'error', timeout: 7000 });
  if (added.length) {
    toast(`Added ${plural(added.length, 'reference image')}. ${saveHint()}`.trim());
    // The caller lists them in the note's frontmatter right away, so that edit joins this commit.
    saveSoon(`journal: add ${plural(added.length, 'reference image')} to ${slug}`);
  }
  return added;
}

/** Ask for photos (from a click) and stage them. */
export async function chooseAndUpload(slug, opts) {
  const files = await pickFiles();
  return files.length ? uploadImages(files, slug, opts) : [];
}

/** Pick images already in the repository (uploaded through GitHub, the Warden's Library, a map...). */
export async function pickExisting(exclude = []) {
  const skip = new Set(exclude);
  const items = store.files('').filter((f) => IMAGE_EXT.has(extOf(f.path)) && !skip.has(f.path) && !f.path.startsWith('assets/') && !f.path.startsWith('vendor/'))
    .sort((a, b) => a.path.localeCompare(b.path));
  const chosen = await pickFromList({
    title: 'Add images from the site files', items, multi: true, empty: 'No images in the repository yet. Upload one instead.',
    render: (f) => h('span', { class: 'jr-gal-pick' }, icon('image'), h('span', null, baseName(f.path)), h('span', { class: 'muted' }, f.path.split('/').slice(0, -1).join('/'))),
    search: (f) => f.path,
  });
  return (chosen || []).map((f) => ({ src: f.path, caption: '' }));
}

/** Delete an uploaded file once no note lists it any more (only our own uploads under MEDIA_DIR). */
export function dropIfUnused(src, notes) {
  if (!src.startsWith(`${MEDIA_DIR}/`)) return;
  const used = (notes || []).some((n) => noteImages(n.fm).some((x) => x.src === src));
  if (!used && store.files(src).some((f) => f.path === src)) store.remove(src);
}

// ---------- editing panel ----------

const HOLD_MS = 350; // a finger holds a photo this long before it can be dragged (a quicker swipe scrolls)
const SLOP = 6;      // px a press moves before it is a drag
const EDGE = 48;     // px from the top or bottom of the scrolling box where a drag scrolls it

/**
 * Drag the items of `grid` (its <li>s, picked up by `handleSel`) into a new order: the photo follows the pointer, the
 * others make room, and onDrop(from, to) gets its old and new index (Esc, or a cancelled touch, puts it back).
 * A mouse or pen drags at once; a finger holds the photo first. The click that ends a drag is swallowed.
 */
function dragSort(grid, handleSel, onDrop) {
  let holding = false; // a finger held a photo: its moves drag rather than scroll
  let swallow = false;
  grid.addEventListener('touchmove', (e) => { if (holding) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest(handleSel)) e.preventDefault(); }); // long press
  grid.addEventListener('click', (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  grid.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest(handleSel);
    const li = handle?.closest('li');
    if (!li || e.button !== 0 || !e.isPrimary || grid.children.length < 2) return;
    const touch = e.pointerType === 'touch';
    const start = { x: e.clientX, y: e.clientY };
    let at = start, ready = !touch, ghost = null, from = -1, raf = 0;
    const hold = touch ? setTimeout(() => { ready = holding = true; li.classList.add('is-held'); }, HOLD_MS) : 0;
    const scroller = scrollBox(grid);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const begin = () => {
      const r = handle.getBoundingClientRect();
      ghost = handle.cloneNode(true);
      ghost.classList.add('jr-imgs-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      document.body.append(ghost);
      from = [...grid.children].indexOf(li);
      li.classList.replace('is-held', 'is-moving') || li.classList.add('is-moving');
      document.documentElement.classList.add('is-img-sorting');
      raf = requestAnimationFrame(edgeScroll);
    };
    // the item under the pointer by its layout box (not where an animation is drawing it), and the dragged one moves there
    const place = () => {
      ghost.style.transform = `translate(${at.x - start.x}px, ${at.y - start.y}px) scale(1.04)`;
      const g = grid.getBoundingClientRect();
      const x = at.x - g.left, y = at.y - g.top;
      const kids = [...grid.children];
      const over = kids.find((c) => c !== li && x >= c.offsetLeft && x < c.offsetLeft + c.offsetWidth && y >= c.offsetTop && y < c.offsetTop + c.offsetHeight);
      if (over) slide(kids, () => grid.insertBefore(li, kids.indexOf(li) > kids.indexOf(over) ? over : over.nextSibling));
    };
    const slide = (kids, apply) => {
      const was = new Map(kids.map((c) => [c, c.getBoundingClientRect()]));
      apply();
      if (reduce) return;
      for (const c of kids) {
        for (const a of c.getAnimations()) a.cancel();
        const a = was.get(c), b = c.getBoundingClientRect();
        if (a.left !== b.left || a.top !== b.top) c.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
      }
    };
    const edgeScroll = () => {
      const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      const bottom = scroller === document.scrollingElement ? innerHeight : scroller.getBoundingClientRect().bottom;
      const d = at.y < top + EDGE ? at.y - top - EDGE : at.y > bottom - EDGE ? at.y - bottom + EDGE : 0;
      if (d) {
        const before = scroller.scrollTop;
        scroller.scrollTop += Math.sign(d) * Math.ceil(Math.min(EDGE, Math.abs(d)) / 4);
        if (scroller.scrollTop !== before) place();
      }
      raf = requestAnimationFrame(edgeScroll);
    };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      at = { x: ev.clientX, y: ev.clientY };
      if (!ghost) {
        if (Math.hypot(at.x - start.x, at.y - start.y) <= SLOP) return;
        if (!ready) { end(); return; } // a finger moved before it held: that is a scroll
        begin();
      }
      place();
    };
    const end = (ev) => {
      clearTimeout(hold);
      holding = false;
      li.classList.remove('is-held');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('keydown', esc, true);
      if (!ghost) return;
      cancelAnimationFrame(raf);
      ghost.remove();
      li.classList.remove('is-moving');
      document.documentElement.classList.remove('is-img-sorting');
      swallow = true;
      setTimeout(() => { swallow = false; });
      const to = [...grid.children].indexOf(li);
      if (!ev) { li.remove(); grid.insertBefore(li, grid.children[from] || null); } // cancelled: back where it was
      else if (to !== from) onDrop(from, to);
    };
    const up = (ev) => { if (ev.pointerId === e.pointerId) end(ev); };
    const cancel = (ev) => { if (ev.pointerId === e.pointerId) end(); };
    const esc = (ev) => { if (ev.key === 'Escape' && ghost) { ev.preventDefault(); ev.stopPropagation(); end(); } };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
    addEventListener('keydown', esc, true);
  });
}

/** The box that scrolls `el` vertically (the page when nothing inside it does). */
function scrollBox(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

/**
 * Reference images while editing a note: thumbnails in order (drag one to move it, or move earlier / later; caption,
 * remove), "Upload photos" (also by dropping files on the panel) and "From site files".
 * @param {{list:Array<{src, caption}>, slug:string, hidden?:()=>boolean, onChange:(list, removed?:string[])=>void}} o
 */
export function imagesPanel({ list, slug, onChange, hidden = () => null }) {
  let items = list.map((x) => ({ ...x }));
  const grid = h('ol', { class: 'jr-imgs-grid' });
  const status = h('p', { class: 'jr-hint jr-imgs-hint' });
  const change = (removed = []) => { draw(); onChange(items.map((x) => ({ ...x })), removed); };
  const upload = async (files) => {
    const opts = { hidden: hidden() }; // DM mode: the photos of a hidden note are hidden too
    const added = files ? await uploadImages(files, slug, opts) : await chooseAndUpload(slug, opts);
    if (added.length) { items = [...items, ...added]; change(); }
  };
  const fromRepo = async () => {
    const added = await pickExisting(items.map((x) => x.src));
    if (added.length) { items = [...items, ...added]; change(); }
  };
  function draw() {
    grid.replaceChildren(...items.map((it, k) => {
      const t = h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
      setImg(t, it.src, () => t.replaceWith(h('span', { class: 'jr-imgs-missing' }, 'Missing')));
      const cap = h('input', { class: 'input input-sm jr-imgs-cap', type: 'text', value: it.caption, placeholder: 'Caption (optional)', 'aria-label': `Caption for photo ${k + 1}`, maxlength: 200 });
      cap.addEventListener('change', () => { items[k].caption = cap.value.trim(); change(); });
      const move = (d) => { const j = k + d; if (j < 0 || j >= items.length) return; [items[k], items[j]] = [items[j], items[k]]; change(); };
      return h('li', { class: 'jr-imgs-item' },
        h('button', { type: 'button', class: 'jr-imgs-thumb', title: 'View (drag to move)', onclick: () => openViewer(items, k) }, t),
        cap,
        h('div', { class: 'jr-imgs-tools' },
          h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': `Move photo ${k + 1} earlier`, disabled: k === 0, onclick: () => move(-1) }, icon('chevron-left')),
          h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': `Move photo ${k + 1} later`, disabled: k === items.length - 1, onclick: () => move(1) }, icon('chevron-right')),
          h('button', { type: 'button', class: 'btn btn-icon btn-sm btn-danger', 'aria-label': `Remove photo ${k + 1}`, onclick: () => { const [gone] = items.splice(k, 1); change([gone.src]); } }, icon('trash'))));
    }));
    status.textContent = items.length
      ? `${plural(items.length, 'photo')}, shown as a slideshow at the top of the note. Drag a photo to change the order; drop more photos here to add them.`
      : 'Add photos for this note (maps, handouts, sketches). They show as a slideshow at the top of the page. You can also drop them here.';
  }
  const panel = h('section', { class: 'jr-imgs', 'aria-label': 'Reference images' },
    h('header', { class: 'jr-imgs-head' }, h('h2', { class: 'jr-imgs-title' }, icon('image'), h('span', null, 'Reference images')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => upload() }, icon('upload'), h('span', null, 'Upload photos')),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => fromRepo() }, icon('folder'), h('span', null, 'From site files')))),
    grid, status);
  dragSort(grid, '.jr-imgs-thumb', (from, to) => { const [it] = items.splice(from, 1); items.splice(to, 0, it); change(); });
  panel.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); panel.classList.add('is-drop'); } });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('is-drop'); });
  panel.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    panel.classList.remove('is-drop');
    upload(files);
  });
  draw();
  return panel;
}
