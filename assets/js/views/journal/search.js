// Search pane (full-text search with tag:/path:/file: operators, results grouped by note with the matching lines)
// and Tags pane (every tag with counts, nested tags as a tree; a click searches for the tag).
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { debounce } from '../../core/util.js';
import * as J from './data.js';
import * as S from './state.js';
import { searchVault, parseQuery, highlightTerms } from './query.js';
import { highlighted, iconBtn, emptyState } from './parts.js';
import { openMenu } from './menu.js';
import { plural } from './text.js';

const PAGE = 40;

/** Keep long lines readable: a window of ~max chars around the first highlighted range. */
function clipAround(text, ranges, max = 170) {
  if (text.length <= max) return { text, ranges };
  const first = ranges[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(max / 3));
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp > 0 && sp < first) start = sp + 1; }
  let end = Math.min(text.length, start + max);
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > start + max / 2) end = sp; }
  const pre = start > 0 ? 1 : 0;
  return {
    text: `${pre ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
    ranges: ranges.filter(([a, b]) => a >= start && b <= end).map(([a, b]) => [a - start + pre, b - start + pre]),
  };
}

const EXAMPLES = [
  ['tag:npc', 'notes tagged #npc, or a tag below it like #npc/ally'],
  ['path:sessions', 'notes inside a folder (its name or path)'],
  ['file:mira', 'notes whose name contains a word'],
  ['"old mill"', 'an exact phrase'],
  ['-goblin', 'leave out notes that mention a word'],
];

export class SearchPane {
  constructor(ctx) {
    this.ctx = ctx;
    this.shown = PAGE;
    this.collapsed = false;
    this.last = null;
    this.input = h('input', {
      class: 'input', type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search notes', autocomplete: 'off', spellcheck: false,
    });
    this.soon = debounce(() => this.run(), 220);
    this.input.addEventListener('input', () => { this.shown = PAGE; this.soon(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.soon.cancel(); this.run(); this.results.querySelector('a')?.focus(); }
      else if (e.key === 'Escape' && this.input.value) { e.preventDefault(); e.stopPropagation(); this.setQuery(''); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.results.querySelector('a')?.focus(); }
    });
    this.collapseBtn = iconBtn('collapse', 'Hide matching lines', () => this.toggleCollapsed(), { pressed: false });
    this.summary = h('div', { class: 'jr-search-summary', hidden: true });
    this.results = h('div', { class: 'jr-results' });
    this.results.addEventListener('keydown', (e) => this.onKey(e));
    this.scroller = h('div', { class: 'jr-pane-scroll jr-search-scroll' }, this.summary, this.results);
    this.el = h('div', { class: 'jr-pane jr-search' },
      h('div', { class: 'jr-pane-bar jr-search-bar' }, h('label', { class: 'search jr-search-box' }, icon('search'), this.input)),
      this.scroller);
    this.renderHelp();
  }

  get query() { return this.input.value.trim(); }

  setQuery(q, { run = true } = {}) {
    this.input.value = q;
    this.shown = PAGE;
    if (run) { this.soon.cancel(); this.run(); }
  }

  focus() { this.input.focus(); this.input.select(); }

  /** Re-run after the vault changed (keeps scroll). */
  refresh() {
    if (!this.query) return;
    const keep = this.scroller.scrollTop;
    this.run();
    this.scroller.scrollTop = keep;
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    this.collapseBtn.setAttribute('aria-pressed', String(this.collapsed));
    this.collapseBtn.title = this.collapsed ? 'Show matching lines' : 'Hide matching lines';
    this.collapseBtn.setAttribute('aria-label', this.collapseBtn.title);
    this.results.classList.toggle('is-collapsed', this.collapsed);
  }

  run() {
    const q = this.query;
    if (!q) { this.last = null; this.renderHelp(); return; }
    const parsed = parseQuery(q);
    if (parsed.empty) { this.renderHelp(); return; }
    const hits = searchVault(parsed);
    this.last = { q, parsed, hits };
    const lines = hits.reduce((s, x) => s + x.total, 0);
    this.summary.hidden = false;
    this.summary.replaceChildren(h('span', { class: 'jr-search-count', role: 'status' }, hits.length
      ? `${plural(hits.length, 'note')}${lines ? ` · ${plural(lines, 'matching line')}` : ''}`
      : 'No notes match'));
    if (hits.length && lines) this.summary.append(this.collapseBtn);
    if (!hits.length) {
      this.results.replaceChildren(emptyState({
        iconName: 'search', title: 'Nothing found',
        text: parsed.tags.length && !parsed.words.length ? 'No note carries that tag yet.' : 'Try fewer words, or check the spelling.',
        actions: parsed.words.length && !parsed.tags.length && !parsed.paths.length
          ? [h('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.ctx.newNote({ title: q.replace(/["-]/g, '').trim(), folder: this.ctx.targetFolder() }) }, icon('plus'), h('span', null, `Create “${q.length > 30 ? `${q.slice(0, 29)}…` : q}”`))]
          : [],
      }));
      return;
    }
    const terms = highlightTerms(parsed);
    this.results.replaceChildren(...hits.slice(0, this.shown).map((r) => this.hit(r, terms)));
    if (hits.length > this.shown) {
      this.results.append(h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm jr-more',
        onclick: () => { this.shown += PAGE * 2; this.refresh(); },
      }, `Show ${Math.min(PAGE * 2, hits.length - this.shown)} more notes`));
    }
    this.results.classList.toggle('is-collapsed', this.collapsed);
    this.markActive();
  }

  hit(r, terms) {
    const n = r.note;
    const open = (e, line = null) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // let the browser open a new tab
      e.preventDefault();
      this.ctx.openFound(n, { terms, line });
    };
    const folder = n.folderRef && !n.folderRef.isRoot ? J.folderLabel(n.folderRef) : null;
    return h('article', { class: 'jr-hit', 'data-path': n.path },
      h('a', { class: 'jr-hit-title', href: n.href, onclick: (e) => open(e) },
        h('span', { class: 'jr-hit-name' }, highlighted(n.title, r.titleRanges)),
        folder ? h('span', { class: 'jr-hit-path' }, folder) : null,
        r.total ? h('span', { class: 'jr-count', title: plural(r.total, 'matching line') }, String(r.total)) : null),
      r.lines.length ? h('ul', { class: 'jr-hit-lines', role: 'list' }, r.lines.map((l) => {
        const c = clipAround(l.text, l.ranges);
        return h('li', null, h('a', { class: 'jr-hit-line', href: n.href, onclick: (e) => open(e, l) }, highlighted(c.text, c.ranges)));
      }), r.total > r.lines.length ? h('li', { class: 'jr-hit-more' }, `${r.total - r.lines.length} more in this note`) : null) : null);
  }

  /** Mark the result for the open note. */
  markActive(path = this.ctx.currentNote()?.path) {
    this.results.querySelectorAll('.jr-hit.is-active').forEach((x) => x.classList.remove('is-active'));
    if (path) this.results.querySelector(`.jr-hit[data-path="${window.CSS?.escape ? CSS.escape(path) : path}"]`)?.classList.add('is-active');
  }

  onKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...this.results.querySelectorAll('a')].filter((a) => a.offsetParent);
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) { this.input.focus(); return; }
    links[Math.max(0, Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }

  renderHelp() {
    this.summary.hidden = true;
    this.results.classList.remove('is-collapsed');
    this.results.replaceChildren(h('div', { class: 'jr-search-help' },
      h('p', null, 'Search every note. Combine words with filters:'),
      h('dl', null, EXAMPLES.map(([code, what]) => [
        h('dt', null, h('button', {
          type: 'button', class: 'jr-chipcode', title: `Search for ${code}`,
          onclick: () => { this.setQuery(`${this.query ? `${this.query} ` : ''}${code}`); this.input.focus(); },
        }, code)),
        h('dd', null, what),
      ]))));
  }
}

// ---------- tags ----------

export class TagsPane {
  constructor(ctx) {
    this.ctx = ctx;
    this.count = h('span', { class: 'jr-pane-title' });
    this.sortBtn = iconBtn('sort', 'Sort tags', () => this.sortMenu());
    this.list = h('ul', { class: 'jr-tagtree', role: 'tree', 'aria-label': 'Tags' });
    this.scroller = h('div', { class: 'jr-pane-scroll' }, this.list);
    this.el = h('div', { class: 'jr-pane jr-tagpane' }, h('div', { class: 'jr-pane-bar' }, this.count, this.sortBtn), this.scroller);
    this.list.addEventListener('click', (e) => {
      const tw = e.target.closest('.jr-twisty');
      const row = e.target.closest('.jr-tagrow');
      if (!row) return;
      if (tw && row.dataset.kids) { this.toggle(row.dataset.key); return; }
      this.ctx.searchTag(row.dataset.tag);
    });
  }

  sortMenu() {
    openMenu({
      anchor: this.sortBtn, label: 'Sort tags',
      items: [['name', 'Tag name (A to Z)'], ['count', 'Most used first']].map(([id, label]) => ({
        label, checked: S.prefs.tagSort === id, onClick: () => { S.prefs.tagSort = id; S.savePrefs(); this.render(); },
      })),
    });
  }

  toggle(key) {
    S.setTagOpen(key, !S.isTagOpen(key));
    this.render();
  }

  render() {
    const tree = J.tagTree();
    const total = J.allTags().length;
    this.count.textContent = plural(total, 'tag');
    const sort = (list) => [...list].sort(S.prefs.tagSort === 'count'
      ? (a, b) => b.count - a.count || J.cmpText(a.name, b.name)
      : (a, b) => J.cmpText(a.name, b.name));
    const active = this.ctx.activeTag?.() || null;
    const rows = [];
    const walk = (nodes, depth) => {
      for (const t of sort(nodes)) {
        const open = S.isTagOpen(t.key);
        const kids = t.children.length;
        rows.push(h('li', { role: 'none' }, h('button', {
          type: 'button', class: ['jr-tagrow', active && active.toLowerCase() === t.key && 'is-active'], role: 'treeitem',
          'aria-level': String(depth + 1), 'aria-expanded': kids ? String(open) : null,
          'data-tag': t.tag, 'data-key': t.key, 'data-kids': kids ? '1' : null, style: `--depth:${depth}`,
          title: `#${t.tag}: ${plural(t.count, 'note')}`,
        },
        h('span', { class: ['jr-twisty', !kids && 'is-blank'], 'aria-hidden': 'true' }, kids ? icon('chevron-right') : null),
        h('span', { class: 'jr-tagrow-name' }, depth ? t.name : `#${t.name}`),
        h('span', { class: 'jr-row-count' }, String(t.count)))));
        if (kids && open) walk(t.children, depth + 1);
      }
    };
    walk(tree, 0);
    if (!rows.length) {
      this.list.replaceChildren(h('li', { class: 'jr-pane-empty' }, 'No tags yet. Write #tags in a note, like #npc or #quest/open, or list them under tags in its properties.'));
      return;
    }
    this.list.replaceChildren(...rows);
  }
}
