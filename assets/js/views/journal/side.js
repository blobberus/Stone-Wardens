// Right pane: everything about the open note. Properties (frontmatter + tags), Outline (headings; click to jump,
// the heading in view is marked), Backlinks (linked mentions with context, unlinked mentions) and Outgoing links
// (resolved and not yet written). For a folder page it shows the folder's details.
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { renderInline } from '../../core/markdown.js';
import * as J from './data.js';
import * as S from './state.js';
import { headingsOf, fmtDay, relTime, plural } from './text.js';
import { section, tagList, highlighted, KIND_ICON, KIND_LABEL, btn, iconBtn } from './parts.js';

const HIDDEN_PROPS = new Set(['title', 'order']);

const onToggle = (key, on) => { S.prefs.sections[key] = on; S.savePrefs(); };
const sec = (key, title, body, opts = {}) => section({ key, title, body, open: S.prefs.sections[key] !== false, onToggle, ...opts });

function inline(text) {
  const span = h('span', { class: 'jr-prop-text' });
  span.innerHTML = renderInline(String(text));
  return span;
}

function propValue(key, v) {
  if (v == null || v === '') return h('span', { class: 'muted' }, '—');
  if (key === 'created' || key === 'updated') {
    const iso = v instanceof Date ? v.toISOString() : String(v);
    const rel = key === 'updated' ? relTime(iso) : '';
    return h('time', { datetime: iso, title: iso }, `${fmtDay(iso)}${rel && rel !== fmtDay(iso) ? ` (${rel})` : ''}`);
  }
  if (Array.isArray(v)) return h('ul', { class: 'jr-prop-list', role: 'list' }, v.map((x) => h('li', null, typeof x === 'object' ? JSON.stringify(x) : inline(x))));
  if (typeof v === 'object') return h('code', null, JSON.stringify(v));
  if (typeof v === 'boolean') return h('span', null, v ? 'Yes' : 'No');
  return inline(v);
}

export class SidePane {
  constructor(ctx) {
    this.ctx = ctx;
    this.title = h('h2', { class: 'jr-side-title' }, 'About this note');
    this.body = h('div', { class: 'jr-pane-scroll jr-side-scroll' });
    this.el = h('div', { class: 'jr-side' },
      h('header', { class: 'jr-side-bar' }, this.title, iconBtn('close', 'Close this pane', () => ctx.closeRight(), { className: 'jr-side-close' })),
      this.body);
    this.outlineEl = null;
  }

  /** target: {kind:'note', note, view} | {kind:'folder', folder} | {kind:'home'|'missing'} */
  render(target) {
    const keep = this.body.scrollTop;
    this.target = target;
    this.outlineEl = null;
    if (target?.kind === 'note') {
      const view = target.view;
      const note = view?.current || target.note;
      this.title.textContent = 'About this note';
      this.body.replaceChildren(
        this.propsSection(note, view),
        this.outlineSection(note, view?.body ?? note.body),
        this.backlinksSection(note),
        this.outgoingSection(note, view?.body ?? note.body));
    } else if (target?.kind === 'folder') {
      this.title.textContent = 'About this folder';
      this.body.replaceChildren(this.folderSection(target.folder));
    } else {
      this.title.textContent = 'Note details';
      this.body.replaceChildren(h('p', { class: 'jr-pane-empty' }, 'Open a note to see its properties, outline, backlinks and outgoing links here.'));
    }
    this.body.scrollTop = keep;
  }

  /** While typing: refresh what depends on the unsaved text (outline, outgoing links, tags). */
  live(view) {
    if (this.target?.kind !== 'note' || this.target.view !== view) return;
    const note = view.current;
    const swap = (key, el) => { const old = this.body.querySelector(`.jr-sec[data-sec="${key}"]`); if (old) old.replaceWith(el); };
    swap('outline', this.outlineSection(note, view.body));
    swap('outgoing', this.outgoingSection(note, view.body));
    swap('props', this.propsSection(note, view));
  }

  propsSection(note, view) {
    const fm = view ? view.fm : note.fm;
    const rows = [];
    const tags = note.tags;
    for (const [k, v] of Object.entries(fm)) {
      if (HIDDEN_PROPS.has(k) || k === 'tags' || k === 'tag') continue;
      rows.push(h('dt', null, k), h('dd', null, propValue(k, v)));
    }
    if (tags.length) rows.push(h('dt', null, 'tags'), h('dd', null, tagList(tags)));
    const body = rows.length
      ? h('dl', { class: 'jr-props' }, rows)
      : h('p', { class: 'jr-hint' }, 'No properties yet.');
    return sec('props', 'Properties', body, {
      count: null,
      tools: iconBtn('edit', 'Edit properties', () => this.ctx.editProperties(note)),
    });
  }

  outlineSection(note, body) {
    const heads = headingsOf(body);
    let el;
    if (!heads.length) el = h('p', { class: 'jr-hint' }, 'No headings. Start a line with # to add one.');
    else {
      const min = Math.min(...heads.map((x) => x.level));
      el = h('ol', { class: 'jr-outline', role: 'list' }, heads.map((x) => h('li', null, h('a', {
        href: J.noteHref(note, x.raw), 'data-id': x.id, style: `--depth:${x.level - min}`,
        onclick: (e) => { e.preventDefault(); this.ctx.jumpToHeading(x); },
      }, x.text))));
      this.outlineEl = el;
    }
    return sec('outline', 'Outline', el, { count: heads.length || null });
  }

  /** Mark the outline entry for the heading currently at the top of the page. */
  markHeading(id) {
    if (!this.outlineEl) return;
    this.outlineEl.querySelectorAll('a.is-current').forEach((a) => a.classList.remove('is-current'));
    if (id) this.outlineEl.querySelector(`a[data-id="${window.CSS?.escape ? CSS.escape(id) : id}"]`)?.classList.add('is-current');
  }

  backlinksSection(note) {
    const links = J.backlinks(note);
    const unlinked = J.unlinkedMentions(note, links);
    const linked = links.length
      ? h('ul', { class: 'jr-mentions', role: 'list' }, links.map((b) => h('li', null,
        h('a', { class: 'jr-mention-title', href: b.note.href },
          h('span', null, b.note.title),
          b.count > 1 ? h('span', { class: 'jr-count', title: plural(b.count, 'link') }, `×${b.count}`) : null),
        b.note.folderRef && !b.note.folderRef.isRoot ? h('span', { class: 'jr-mention-path' }, J.folderLabel(b.note.folderRef)) : null,
        b.context.map((c) => h('a', {
          class: 'jr-mention-context', href: b.note.href,
          onclick: (e) => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); this.ctx.openFound(b.note, { line: c, terms: [] }); },
        }, c.text)))))
      : h('p', { class: 'jr-hint' }, 'No other note links here yet. Link to it with ', h('code', null, `[[${note.title}]]`), '.');
    const loose = sec('unlinked', 'Unlinked mentions', unlinked.length
      ? h('ul', { class: 'jr-mentions', role: 'list' }, unlinked.map((u) => h('li', null,
        h('a', { class: 'jr-mention-title', href: u.note.href }, u.note.title),
        h('p', { class: 'jr-mention-context is-plain' }, highlighted(u.text, u.ranges)))))
      : h('p', { class: 'jr-hint' }, 'No note mentions this title without linking it.'), { count: unlinked.length });
    loose.classList.add('jr-sec-sub');
    return sec('backlinks', 'Backlinks', [linked, loose], { count: links.length });
  }

  outgoingSection(note, body) {
    const rows = J.outgoing(note, body);
    const el = rows.length
      ? h('ul', { class: 'jr-outgoing', role: 'list' }, rows.map((r) => h('li', null, h('a', {
        class: ['jr-out', !r.exists && 'is-unresolved'], href: r.href || '#',
        title: r.exists ? r.title : `Not written yet. Click to create “${r.target}”.`,
      },
      icon(r.exists ? (KIND_ICON[r.kind] || 'compendium') : 'plus'),
      h('span', { class: 'jr-out-label' }, r.label),
      h('span', { class: 'jr-out-kind' }, r.exists ? `${KIND_LABEL[r.kind] || r.kind}${r.embed ? ' · embed' : ''}` : 'unwritten')))))
      : h('p', { class: 'jr-hint' }, 'This note does not link anywhere yet.');
    return sec('outgoing', 'Outgoing links', el, { count: rows.length || null });
  }

  folderSection(f) {
    const notes = J.notesUnder(f);
    const latest = notes.reduce((m, n) => (n.mtime > (m?.mtime || 0) ? n : m), null);
    const rows = [
      h('dt', null, 'Path'), h('dd', null, f.isRoot ? 'Vault root' : J.folderLabel(f)),
      h('dt', null, 'Notes'), h('dd', null, `${f.notes.length} here, ${f.count} in all`),
      h('dt', null, 'Folders'), h('dd', null, String(f.folders.length)),
      latest ? [h('dt', null, 'Last edit'), h('dd', null, h('a', { href: latest.href }, latest.title), ` · ${relTime(latest.updated || latest.created)}`)] : null,
    ];
    return sec('props', 'Folder', [
      h('dl', { class: 'jr-props' }, rows),
      f.isRoot ? null : h('div', { class: 'row jr-side-actions' },
        btn('New note here', () => this.ctx.newNote({ folder: f }), { ic: 'file-plus', kind: 'ghost' }),
        btn('Edit description', () => this.ctx.editDescription(f), { ic: 'edit', kind: 'ghost' })),
    ]);
  }
}
