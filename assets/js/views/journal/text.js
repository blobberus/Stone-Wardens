// Journal text helpers: numerals, plain-text extraction, headings/sections, fuzzy matching, snippets,
// dates and a code/comment/callout-aware task toggle that matches the rendered checkbox order.
import { slugify } from '../../core/util.js';

// ---------- numerals ----------

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function roman(n) {
  let x = Math.max(0, Math.floor(Number(n) || 0));
  let s = '';
  for (const [v, r] of ROMAN) while (x >= v) { s += r; x -= v; }
  return s;
}

// ---------- plain text ----------

/** Inline markdown -> readable plain text (wikilinks become their label). */
export function plainInline(s) {
  return String(s || '')
    .replace(/!?\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]\n]+)\]\]/g, (_, t) => t.replace(/^[a-z][a-z-]*:/i, '').replace(/#/, ' › ').trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~)/g, '')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '');
}

/** Whole note body -> plain text for search and snippets. */
export function plainText(md) {
  const blocks = String(md || '')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/^[ \t]*(```|~~~)[^\n]*$/gm, ' ')
    .replace(/^[ \t]*>[ \t]*\[![\w-]+\][+-]?[ \t]*/gm, '')
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*\|?[ \t:-]+\|[ \t|:-]*$/gm, ' ');
  return plainInline(blocks) // links first, so [[a|b]] keeps its label before table pipes are dropped
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \n]+/g, '\n')
    .trim();
}

// ---------- headings and sections ----------

const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/** ATX headings outside code fences: [{level, raw, text, id, line}] (id matches markdown.js heading ids). */
export function headingsOf(body) {
  const out = [];
  let fence = null;
  String(body || '').split('\n').forEach((line, i) => {
    const f = FENCE.exec(line);
    if (fence) { if (f && f[1] === fence) fence = null; return; }
    if (f) { fence = f[1]; return; }
    const m = HEADING.exec(line);
    if (m) out.push({ level: m[1].length, raw: m[2], text: plainInline(m[2]).trim() || m[2], id: slugify(m[2]), line: i });
  });
  return out;
}

/** Markdown of the section under the heading `anchor` (until the next heading of the same or higher level). */
export function sectionOf(body, anchor) {
  const want = slugify(anchor);
  const lines = String(body || '').split('\n');
  const heads = headingsOf(body);
  const i = heads.findIndex((x) => x.id === want);
  if (i < 0) return null;
  const start = heads[i];
  const end = heads.slice(i + 1).find((x) => x.level <= start.level);
  return lines.slice(start.line, end ? end.line : lines.length).join('\n');
}

// ---------- tasks ----------

// Matches what marked renders as a task item: list marker, [ ] / [x], then some text. Allows blockquote/callout prefixes.
const TASK = /^([ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\](?=[ \t]+\S))/;

/** Toggle the index-th task (in rendered order: skips fenced code and %%comments%%). */
export function toggleTaskAt(src, index, checked) {
  const lines = String(src || '').split('\n');
  let n = -1;
  let fence = null;
  let inComment = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const f = FENCE.exec(line.replace(/^[ \t]*(?:>[ \t]?)+/, ''));
    if (fence) { if (f && f[1] === fence) fence = null; continue; }
    const commentAtStart = inComment;
    if (((line.match(/%%/g) || []).length) % 2) inComment = !inComment;
    if (commentAtStart) continue;
    if (f) { fence = f[1]; continue; }
    if (TASK.test(line)) {
      n += 1;
      if (n === index) {
        lines[k] = line.replace(TASK, (_, a, _x, b) => `${a}${checked ? 'x' : ' '}${b}`);
        return lines.join('\n');
      }
    }
  }
  return src;
}

// ---------- fuzzy matching ----------

const WORD_START = /[\s\-_/.(:'’"]/;

/** Subsequence fuzzy match. Returns {score, hits:[indices]} or null. Higher score = better. */
export function fuzzy(query, text) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const t = String(text || '');
  const tl = t.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const sub = tl.indexOf(q);
  if (sub >= 0) {
    const hits = Array.from({ length: q.length }, (_, i) => sub + i);
    const start = sub === 0 || WORD_START.test(tl[sub - 1]);
    return { score: 100 + (sub === 0 ? 40 : 0) + (start ? 20 : 0) - tl.length * 0.1, hits };
  }
  const chars = q.replace(/ /g, '');
  let qi = 0;
  let last = -2;
  let score = 0;
  const hits = [];
  for (let i = 0; i < tl.length && qi < chars.length; i++) {
    if (tl[i] !== chars[qi]) continue;
    let s = 1;
    if (i === last + 1) s += 4;
    if (i === 0 || WORD_START.test(tl[i - 1])) s += 6;
    score += s;
    hits.push(i);
    last = i;
    qi += 1;
  }
  if (qi < chars.length) return null;
  const spread = hits[hits.length - 1] - hits[0];
  return { score: score - spread * 0.3 - tl.length * 0.05, hits };
}

// ---------- snippets ----------

/** A window of plain text around the first term, with ranges to highlight. */
export function snippet(text, terms, { radius = 70, max = 200 } = {}) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  const low = src.toLowerCase();
  const ts = terms.map((t) => String(t).toLowerCase()).filter(Boolean);
  let first = -1;
  for (const t of ts) {
    const i = low.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  let start = first < 0 ? 0 : Math.max(0, first - radius);
  if (start > 0) {
    const sp = src.indexOf(' ', start);
    if (sp > 0 && sp < first) start = sp + 1;
  }
  let end = Math.min(src.length, start + max);
  if (end < src.length) {
    const sp = src.lastIndexOf(' ', end);
    if (sp > start + max / 2) end = sp;
  }
  const piece = src.slice(start, end);
  const ranges = [];
  const pl = piece.toLowerCase();
  for (const t of ts) {
    let i = pl.indexOf(t);
    while (i >= 0) { ranges.push([i, i + t.length]); i = pl.indexOf(t, i + t.length); }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([...r]);
  }
  return { text: (start > 0 ? '…' : '') + piece + (end < src.length ? '…' : ''), ranges: merged.map(([a, b]) => [a + (start > 0 ? 1 : 0), b + (start > 0 ? 1 : 0)]) };
}

// ---------- dates ----------

const validDate = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

export function fmtDay(iso) {
  const d = validDate(iso);
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export function relTime(iso) {
  const d = validDate(iso);
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 604800) return `${Math.round(s / 86400)} days ago`;
  return fmtDay(iso);
}

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
