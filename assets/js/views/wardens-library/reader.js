// Warden's Library reader: renders one document's body by type (PDF, Word, Markdown, text, image, media).
import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { store } from '../../core/store.js';
import { slugify } from '../../core/util.js';
import DOMPurify from '../../../../vendor/dompurify/purify.es.mjs';
import { ROOT, docAt, findDoc, docHref, fmtSize } from './files.js';

// ---------- device capabilities ----------

const UA = navigator.userAgent || '';
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(UA);

/** Can this browser show a PDF inside the page? (Mobile browsers mostly can't, or only show page one.) */
export const canInlinePdf = () => !IS_IOS && !IS_ANDROID && navigator.pdfViewerEnabled !== false;

/** Types the browser can display by itself in a new tab (others would just download). */
export function opensInBrowser(doc) {
  return ['pdf', 'image', 'audio', 'video'].includes(doc.type.key) || ['txt', 'log', 'json'].includes(doc.ext);
}

/** "?at=12" / "?at=page=12" / "?page=12" -> 12 */
export function pdfPage(query = {}) {
  const raw = String(query.page || query.at || '');
  const m = /^(?:p(?:age)?\s*=?\s*)?(\d+)$/i.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

/** Turn a failure into a sentence a player can act on. */
export function errorText(e) {
  if (!e) return 'Something went wrong.';
  if (e.code === 'missing') return 'The contents of this file are not available on this device. If it was uploaded here and never saved, add it again.';
  if (e.status === 404) return 'GitHub could not find this file. It may have been moved or deleted; try again once the library refreshes.';
  if (e.status === 403 && /large|size/i.test(e.message || '')) return 'This file is too large for the GitHub API to send (the limit is 100 MB). Download it from GitHub instead.';
  if (e.name === 'TypeError' && /fetch|network|load/i.test(e.message || '')) return 'Could not reach GitHub. Check your connection and try again.';
  return e.message || String(e);
}

// ---------- shared pieces ----------

/** A centered notice card used for fallbacks (can't preview, legacy .doc, mobile PDF). */
function notice({ iconName = 'file', title, text, actions = [] }) {
  return h('div', { class: 'wl-state wl-notice' },
    h('span', { class: 'wl-state-icon' }, icon(iconName, 40)),
    h('h2', { class: 'wl-state-title' }, title),
    text ? h('p', { class: 'wl-state-text' }, text) : null,
    actions.length ? h('div', { class: 'wl-state-actions' }, actions) : null);
}

async function fetchFrom(url, as) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read the file (${res.status}).`);
  return as === 'text' ? res.text() : res.arrayBuffer();
}

/** In-document anchors (#heading, Word bookmarks and footnotes) scroll inside the page instead of routing. */
function wireAnchors(page) {
  page.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || !page.contains(a)) return;
    const raw = a.getAttribute('href');
    if (raw.startsWith('#/')) return; // a site route (wikilink)
    e.preventDefault();
    let id = raw.slice(1);
    try { id = decodeURIComponent(id); } catch { /* keep raw */ }
    if (!id) return;
    findAnchor(page, id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function findAnchor(page, at) {
  const esc = window.CSS?.escape ? CSS.escape : (s) => s.replace(/["\\]/g, '\\$&');
  const byId = page.querySelector(`[id="${esc(at)}"], a[name="${esc(at)}"]`);
  if (byId) return byId;
  const slug = slugify(at);
  return page.querySelector(`[id="${esc(slug)}"]`)
    || [...page.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((x) => slugify(x.textContent) === slug)
    || null;
}

/** Scroll to ?at=Heading once the document is rendered. */
export function scrollToAnchor(node, query = {}) {
  const at = query.at;
  if (!at || pdfPage(query)) return;
  const target = findAnchor(node, String(at));
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}

function resolveRelative(base, rel) {
  const parts = (rel.startsWith('/') ? ROOT + rel.slice(1) : base + rel).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

/** Plain markdown links/images to sibling files ("./map.png", "rules.pdf") point into the library. */
function fixRelativeRefs(page, doc) {
  const base = doc.shelf ? `${ROOT}${doc.shelf}/` : ROOT;
  const isRelative = (v) => v && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(v);
  const target = (v) => {
    let p = v.split('#')[0].split('?')[0];
    try { p = decodeURI(p); } catch { /* keep raw */ }
    return resolveRelative(base, p);
  };
  page.querySelectorAll('a[href]').forEach((a) => {
    const v = a.getAttribute('href');
    if (!isRelative(v)) return;
    const d = docAt(target(v)) || findDoc(target(v));
    if (d) a.setAttribute('href', docHref(d.path));
  });
  page.querySelectorAll('img[src]').forEach(async (img) => {
    const v = img.getAttribute('src');
    if (!isRelative(v)) return;
    const path = target(v);
    img.removeAttribute('src');
    const url = await store.fileUrl(path).catch(() => null);
    if (url) img.src = url;
    else img.alt = `Missing image: ${v}`;
  });
}

// ---------- renderers ----------

function renderPdf(doc, ctx, force = false) {
  const wrap = h('div', { class: 'wl-pdf-wrap' });
  const page = pdfPage(ctx.query);
  const showFrame = () => {
    clear(wrap).append(
      h('iframe', { class: 'wl-pdf', src: ctx.url + (page ? `#page=${page}` : ''), title: doc.name }),
      h('p', { class: 'wl-pdf-hint' },
        'PDF not showing? ', ctx.openLink('Open it in a new tab'), ' or ', ctx.downloadLink('download it'), '.'),
    );
  };
  if (force || canInlinePdf()) showFrame();
  else {
    wrap.append(notice({
      iconName: 'file-pdf',
      title: 'Open this PDF to read it',
      text: 'This device can’t show PDFs inside the page. Open it in your browser’s PDF viewer or download it.',
      actions: [
        ctx.openLink([icon('external'), h('span', null, 'Open PDF')], 'btn btn-primary'),
        ctx.downloadLink([icon('download'), h('span', null, `Download (${fmtSize(doc.size)})`)], 'btn'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: showFrame }, 'Try showing it here'),
      ],
    }));
  }
  return wrap;
}

let mammothLoading = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  mammothLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/mammoth/mammoth.browser.min.js';
    s.onload = () => (window.mammoth ? resolve(window.mammoth) : reject(new Error('The Word converter did not load.')));
    s.onerror = () => { mammothLoading = null; reject(new Error('Could not load the Word converter. Check your connection and try again.')); };
    document.head.append(s);
  });
  return mammothLoading;
}

const STYLE_MAP = [
  "p[style-name='Title'] => h1.wl-doc-title:fresh",
  "p[style-name='Subtitle'] => p.wl-doc-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
];
const BROWSER_IMAGES = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/i;

async function renderWord(doc, ctx) {
  if (doc.ext !== 'docx') {
    return notice({
      iconName: 'file-doc',
      title: 'Old Word format (.doc)',
      text: 'Browsers can only display modern Word files (.docx). Download this one to open it in Word, Google Docs or LibreOffice. Re-saving it as .docx (or PDF) lets it display here.',
      actions: [ctx.downloadLink([icon('download'), h('span', null, `Download ${doc.file}`)], 'btn btn-primary')],
    });
  }
  const [mammoth, arrayBuffer] = await Promise.all([loadMammoth(), fetchFrom(ctx.url, 'buffer')]);
  let unsupportedImages = 0;
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap: STYLE_MAP,
    convertImage: mammoth.images.imgElement((img) => img.read('base64').then((data) => {
      if (!BROWSER_IMAGES.test(img.contentType || '')) unsupportedImages += 1;
      return { src: `data:${img.contentType};base64,${data}` };
    })),
  });
  const page = h('article', { class: 'prose wl-page wl-page-word' });
  page.innerHTML = DOMPurify.sanitize(result.value);
  page.querySelectorAll('a[href]').forEach((a) => {
    if (/^(https?:|mailto:)/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.classList.add('external'); }
  });
  page.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((x) => { if (!x.id) x.id = slugify(x.textContent); });
  page.querySelectorAll('table').forEach((t) => {
    const scroller = h('div', { class: 'wl-table-scroll' });
    t.replaceWith(scroller);
    scroller.append(t);
  });
  if (!page.textContent.trim() && !page.querySelector('img')) page.append(h('p', { class: 'muted' }, 'This document appears to be empty.'));
  wireAnchors(page);

  const notes = result.messages.filter((m) => m.type === 'warning' || m.type === 'error').map((m) => m.message);
  if (unsupportedImages) notes.unshift(`${unsupportedImages} image(s) use a Windows-only format (EMF/WMF) that browsers cannot display.`);
  const unique = [...new Set(notes)];
  return h('div', { class: 'wl-page-wrap' },
    page,
    unique.length ? h('details', { class: 'wl-notes' },
      h('summary', null, `${unique.length} formatting note${unique.length === 1 ? '' : 's'} from the converter`),
      h('p', { class: 'muted' }, 'Some Word formatting has no web equivalent, so the original may look slightly different. Download it for the exact layout.'),
      h('ul', null, unique.slice(0, 50).map((m) => h('li', null, m)))) : null);
}

async function renderMarkdown(doc, ctx) {
  const text = await fetchFrom(ctx.url, 'text');
  const page = h('article', { class: 'prose wl-page wl-page-md' });
  renderInto(page, text || '');
  if (!page.textContent.trim() && !page.querySelector('img, .embed')) page.append(h('p', { class: 'muted' }, 'This note is empty.'));
  fixRelativeRefs(page, doc);
  wireAnchors(page);
  return h('div', { class: 'wl-page-wrap' }, page);
}

async function renderText(doc, ctx) {
  const text = await fetchFrom(ctx.url, 'text');
  return h('div', { class: 'wl-page-wrap' },
    h('pre', { class: 'wl-text' }, text || ''),
    !text ? h('p', { class: 'muted' }, 'This file is empty.') : null);
}

function renderImage(doc, ctx) {
  const stage = h('div', { class: 'wl-img-stage is-fit' });
  const dims = h('span', { class: 'wl-img-dims' });
  const toggle = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': 'false' }, 'Actual size');
  const flip = () => {
    const fit = !stage.classList.contains('is-fit');
    stage.classList.toggle('is-fit', fit);
    toggle.textContent = fit ? 'Actual size' : 'Fit to screen';
    toggle.setAttribute('aria-pressed', String(!fit));
  };
  const img = h('img', {
    class: 'wl-img', src: ctx.url, alt: doc.name, decoding: 'async',
    onclick: flip,
    onload: () => { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; },
    onerror: () => stage.replaceWith(notice({
      iconName: 'image', title: 'This image can’t be displayed',
      text: 'Your browser does not support this image format. Download it to view it.',
      actions: [ctx.downloadLink([icon('download'), h('span', null, 'Download')], 'btn btn-primary')],
    })),
  });
  toggle.addEventListener('click', flip);
  stage.append(img);
  return h('div', { class: 'wl-img-view' }, h('div', { class: 'wl-img-bar' }, toggle, dims), stage);
}

function renderMedia(doc, ctx) {
  const unsupported = () => notice({
    iconName: 'file', title: 'This file can’t be played here',
    text: 'Your browser does not support this format. Download it to play it.',
    actions: [ctx.downloadLink([icon('download'), h('span', null, 'Download')], 'btn btn-primary')],
  });
  const tag = doc.type.key === 'audio' ? 'audio' : 'video';
  const el = h(tag, { class: `wl-${tag}`, src: ctx.url, controls: true, preload: 'metadata', playsinline: tag === 'video' });
  const wrap = h('div', { class: `wl-media wl-media-${tag}` }, el);
  el.addEventListener('error', () => wrap.replaceChildren(unsupported()));
  return wrap;
}

function renderOther(doc, ctx) {
  return notice({
    iconName: doc.type.icon,
    title: 'No preview for this file type',
    text: `${doc.file} (${fmtSize(doc.size)}) can’t be shown in the browser, but you can download it.`,
    actions: [ctx.downloadLink([icon('download'), h('span', null, 'Download')], 'btn btn-primary')],
  });
}

const RENDERERS = {
  pdf: renderPdf, word: renderWord, markdown: renderMarkdown, text: renderText,
  image: renderImage, audio: renderMedia, video: renderMedia, other: renderOther,
};

/**
 * Render the body for doc. ctx: {url, query, downloadLink(children, cls), openLink(children, cls)}.
 * Resolves to a Node; throws on failure (the caller shows the error state).
 */
export async function renderDocument(doc, ctx) {
  const fn = RENDERERS[doc.type.key] || renderOther;
  return fn(doc, ctx);
}
