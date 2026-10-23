// Print: the small Print button under the portrait (sheet.js header) opens a popover with the two printouts, Major
// points and the Detailed sheet, each as a PDF or a grayscale PDF that downloads at once. Everything happens in the
// browser: jsPDF (vendor/jspdf, global `jspdf`) loads on first use; content print-model.js, layout print-pdf.js.
import { h } from '../../core/dom.js';
import { icon, toast } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { clone } from '../../core/util.js';
import { ABILITIES, CURRENCY, DETAIL_FIELDS, VIEW, prettify } from './data.js';
import { derive, findEntry, entryName, skillList, profName, conditionList, masteryInfo, propertyInfo, R, ready } from './bridge.js';
import { accentOf, hoverTip } from './widgets.js';
import { printModel, PRINT_KINDS } from './print-model.js';
import { renderSheet } from './print-pdf.js';

const LIB = {
  entryName, findEntry, skillList, profName,
  conditionName: (id) => conditionList().find((x) => x.id === id)?.name || prettify(id),
  masteryName: (id) => masteryInfo(id)?.name || prettify(id),
  propertyName: (p) => propertyInfo(p)?.name || prettify(String(p).split(/[ (]/)[0]),
  alignmentName: (id) => (R().alignments || []).find((a) => a.id === id)?.name || id,
  detailFields: DETAIL_FIELDS, abilities: ABILITIES, currency: CURRENCY,
};

let loading = null;
function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jspdf/jspdf.umd.min.js';
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('The PDF maker did not load.')));
    s.onerror = () => { loading = null; s.remove(); reject(new Error('Could not load the PDF maker. Check your connection and try again.')); };
    document.head.append(s);
  });
  return loading;
}

/** The portrait as a square JPEG data URL (cover crop, white behind transparency; gray: grayscale), or null. */
async function portraitJpeg(src, gray) {
  if (!src) return null;
  let url = null;
  try {
    const blob = /^https?:/i.test(src) ? await (await fetch(src, { mode: 'cors' })).blob()
      : /^data:/i.test(src) ? await (await fetch(src)).blob() : await store.fileBlob(src);
    if (!blob) return null;
    url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 360;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    const iw = img.naturalWidth || size;
    const ih = img.naturalHeight || size;
    const k = Math.max(size / iw, size / ih);
    ctx.drawImage(img, (size - iw * k) / 2, (size - ih * k) / 2, iw * k, ih * k);
    if (gray) {
      const d = ctx.getImageData(0, 0, size, size);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) { const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]; p[i] = l; p[i + 1] = l; p[i + 2] = l; }
      ctx.putImageData(d, 0, 0);
    }
    return cv.toDataURL('image/jpeg', 0.9);
  } catch (e) {
    console.warn('[print] portrait left out', e); // a URL without CORS, an unreadable file: the crest stands in
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

const fileSafe = (s) => String(s || 'Character').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Character';
const sheetLink = (id) => `${location.origin}${location.pathname}#/${VIEW}/${encodeURIComponent(id)}`;

/** Build one printout and download it. kind 'major' | 'full'. Resolves the file name. */
export async function downloadSheet(char, kind, { gray = false } = {}) {
  const [JsPDF] = await Promise.all([loadJsPdf(), ready()]);
  // Major points are for a sheet kept for weeks: derived without passing states (conditions, Exhaustion)
  const sheet = kind === 'full' ? derive(char) : derive({ ...clone(char), conditions: [], exhaustion: 0 });
  const model = printModel(char, sheet, LIB, { kind, link: char.id ? sheetLink(char.id) : '' });
  const doc = renderSheet(JsPDF, model, { portrait: await portraitJpeg(char.portrait, gray), accent: accentOf(char), gray });
  const file = `${fileSafe(char.name)} - ${model.file}${gray ? ' (grayscale)' : ''}.pdf`;
  doc.save(file);
  return file;
}

// ---------- the button and its popover ----------

let pop = null; // {el, close}

/** The Print button under the portrait; getChar() gives the character at click time. */
export function printButton(getChar) {
  const btn = h('button', {
    class: 'btn btn-sm ch-pic-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-fk': 'print',
    onclick: (e) => (pop && pop.anchor === e.currentTarget ? pop.close() : openPrintMenu(e.currentTarget, getChar)),
  }, icon('printer'), h('span', { class: 'ch-pic-lbl' }, 'Print'));
  return hoverTip(btn, 'Download a PDF of this sheet: Major points (the stats that rarely change, to use with the Paper Companion) or the Detailed sheet (everything, inventory included). In color or grayscale.');
}

function openPrintMenu(anchor, getChar) {
  pop?.close();
  const back = document.activeElement;
  const buttons = [];
  const run = async (b, kind, gray) => {
    const char = getChar();
    if (!char) return;
    buttons.forEach((x) => { x.disabled = true; });
    const label = b.textContent;
    b.textContent = 'Making…';
    try {
      const file = await downloadSheet(char, kind, { gray });
      close(true);
      toast(`Downloaded “${file}”.`, { type: 'success' });
    } catch (e) {
      console.error('[print]', e);
      toast(`Could not make the PDF: ${e.message || e}`, { type: 'error', timeout: 7000 });
      b.textContent = label;
      buttons.forEach((x) => { x.disabled = false; });
    }
  };
  const el = h('div', { class: 'ch-print-pop', role: 'dialog', 'aria-label': 'Print this sheet' },
    h('p', { class: 'ch-print-head' }, icon('printer'), 'Download a PDF'),
    PRINT_KINDS.map((k) => {
      const color = h('button', { class: 'btn btn-sm btn-primary', type: 'button', 'data-print': `${k.id}` }, icon('download'), 'PDF');
      const gray = h('button', { class: 'btn btn-sm', type: 'button', 'data-print': `${k.id}-gray`, title: 'Black and gray only, portrait included' }, 'Grayscale');
      color.addEventListener('click', () => run(color, k.id, false));
      gray.addEventListener('click', () => run(gray, k.id, true));
      buttons.push(color, gray);
      return h('div', { class: 'ch-print-opt' },
        h('div', { class: 'ch-print-opt-text' }, h('strong', null, k.label), h('span', null, k.hint)),
        h('div', { class: 'ch-print-opt-btns' }, color, gray));
    }));
  (document.querySelector('body > #overlays') || document.body).append(el);
  anchor.setAttribute('aria-expanded', 'true');
  anchor.closest('.ch-tip-wrap')?.classList.add('is-menu-open');
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let top = a.bottom + 6;
    if (top + r.height > innerHeight - 8) top = Math.max(8, a.top - r.height - 6);
    el.style.left = `${Math.round(Math.max(8, Math.min(a.left, innerWidth - r.width - 8)))}px`;
    el.style.top = `${Math.round(top)}px`;
  };
  place();
  buttons[0]?.focus();
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { // keep Tab inside the popover
      const list = buttons.filter((b) => !b.disabled);
      const i = list.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0]?.focus(); }
    }
  };
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onScroll = (e) => { if (!el.contains(e.target)) close(); };
  el.addEventListener('keydown', onKey);
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
  }, 0);
  let closed = false;
  function close(restore = false) {
    if (closed) return;
    closed = true;
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', place);
    anchor.setAttribute('aria-expanded', 'false');
    anchor.closest('.ch-tip-wrap')?.classList.remove('is-menu-open');
    if (pop?.el === el) pop = null;
    if (restore) (anchor.isConnected ? anchor : back)?.focus?.();
  }
  pop = { el, anchor, close };
}
