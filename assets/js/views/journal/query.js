// Vault search, Obsidian style: free words (all must match), "exact phrases", -exclusions and the operators
// tag:npc (nested tags match too), path:sessions (folder path or title), file:mira (note title / file name).
// Results are grouped by note with the matching lines: [{note, score, titleRanges, lines:[{line, text, ranges}], total}].
import * as J from './data.js';
import { fold, rangesOf } from './text.js';

const TOKEN = /(-?)(?:(tag|path|file):)?(?:"([^"]*)"?|(\S+))/gi;

/** "tag:#npc -goblin \"old mill\"" -> {words, not, tags, notTags, paths, notPaths, files, empty} (all folded). */
export function parseQuery(q) {
  const out = { words: [], not: [], tags: [], notTags: [], paths: [], notPaths: [], files: [], notFiles: [], empty: true, raw: String(q || '') };
  for (const m of out.raw.matchAll(TOKEN)) {
    const neg = !!m[1];
    const op = (m[2] || '').toLowerCase();
    const val = fold(m[3] ?? m[4] ?? '').trim();
    if (!val || val === '-' || /^-?(tag|path|file):$/.test(val)) continue; // still typing
    if (op === 'tag') (neg ? out.notTags : out.tags).push(val.replace(/^#/, ''));
    else if (op === 'path') (neg ? out.notPaths : out.paths).push(val);
    else if (op === 'file') (neg ? out.notFiles : out.files).push(val);
    else (neg ? out.not : out.words).push(val);
    out.empty = false;
  }
  return out;
}

const pathText = (n) => fold(`${n.rel}\n${J.folderLabel(n.folderRef)} › ${n.title}`);

function passes(n, q) {
  if (q.tags.some((t) => !n.tags.some((x) => J.tagMatches(t, fold(x))))) return false;
  if (q.notTags.some((t) => n.tags.some((x) => J.tagMatches(t, fold(x))))) return false;
  if (q.paths.length || q.notPaths.length) {
    const p = pathText(n);
    if (q.paths.some((x) => !p.includes(x)) || q.notPaths.some((x) => p.includes(x))) return false;
  }
  if (q.files.length || q.notFiles.length) {
    const f = fold(`${n.title}\n${n.slug}`);
    if (q.files.some((x) => !f.includes(x)) || q.notFiles.some((x) => f.includes(x))) return false;
  }
  const hay = n.folded;
  if (q.words.some((w) => !hay.includes(w) && !n.tags.some((t) => fold(t).includes(w)))) return false;
  if (q.not.some((w) => hay.includes(w))) return false;
  return true;
}

/** Run a query over the vault. `limitLines` caps lines kept per note (the total is still counted). */
export function searchVault(query, { limitLines = 6 } = {}) {
  const q = typeof query === 'string' ? parseQuery(query) : query;
  if (q.empty) return [];
  const terms = q.words;
  const tagTerms = q.tags.map((t) => `#${t}`);
  const out = [];
  for (const n of J.index().notes) {
    if (!passes(n, q)) continue;
    const lines = [];
    let total = 0;
    const lineTerms = terms.length ? terms : tagTerms;
    if (lineTerms.length) {
      for (const l of n.lines) {
        const low = fold(l.text);
        if (!lineTerms.some((t) => low.includes(t))) continue;
        total += 1;
        if (lines.length < limitLines) lines.push({ line: l.line, text: l.text, ranges: rangesOf(l.text, lineTerms) });
      }
    }
    const title = fold(n.title);
    const inTitle = terms.filter((t) => title.includes(t)).length;
    out.push({
      note: n,
      score: inTitle * 10 + (terms.length && inTitle === terms.length ? 20 : 0) + Math.min(total, 10),
      titleRanges: rangesOf(n.title, [...terms, ...q.files]),
      lines,
      total,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime || J.cmpText(a.note.title, b.note.title));
}

/** Terms worth highlighting on the opened note. */
export const highlightTerms = (query) => {
  const q = typeof query === 'string' ? parseQuery(query) : query;
  return q.words.length ? q.words : q.tags.map((t) => `#${t}`);
};
