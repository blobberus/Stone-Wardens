// Journal dialogs: new note, chapter details, delete chapter, move note, and the quick switcher
// (Ctrl+K / Ctrl+O): fuzzy jump to any note or chapter, plus everything else in the link registry.
import { h, clear } from '../../core/dom.js';
import { icon, toast, openModal, field, input, select, textarea, choiceDialog, confirmDialog, pickFromList } from '../../core/ui.js';
import { suggestLinks, resolveLink, linkTypes } from '../../core/links.js';
import { navigate } from '../../core/router.js';
import { nameKey } from '../../core/util.js';
import * as J from './data.js';
import { fuzzy, plural } from './text.js';
import { hitsMarked, chapterName } from './parts.js';

const NEW_CHAPTER = '__new__';

function submitOnEnter(el, submit, modal) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (submit()) modal.close(); }
  });
}

/** Resolves {title, chapter, newChapter} or null. */
export function newNoteDialog({ title = '', chapter = J.LOOSE } = {}) {
  return new Promise((resolve) => {
    const ix = J.index();
    let result = null;
    const titleEl = input({ value: title, placeholder: 'e.g. The Siege of Greywater', maxlength: 120, autofocus: true });
    const chapterTitle = input({ placeholder: 'Title of the new chapter', maxlength: 120 });
    const newField = field('New chapter', chapterTitle);
    newField.hidden = true;
    const options = [
      ...ix.chapters.map((c) => ({ value: c.slug, label: `${c.label} · ${c.title}` })),
      { value: J.LOOSE, label: 'Loose Leaves (no chapter)' },
      { value: NEW_CHAPTER, label: 'New chapter…' },
    ];
    const initial = J.chapterAt(chapter, ix) ? chapter : J.LOOSE;
    const sel = select(options, initial, (v) => {
      newField.hidden = v !== NEW_CHAPTER;
      if (v === NEW_CHAPTER) chapterTitle.focus();
    });
    const dupe = h('p', { class: 'field-hint jr-dupe', hidden: true });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const checkDupe = () => {
      const n = J.findNote(titleEl.value.trim());
      dupe.hidden = !n;
      if (n) dupe.textContent = `“${n.title}” already exists in ${chapterName(n.chapterRef)}. Links to this title open the first one.`;
    };
    const fail = (msg, el) => { err.textContent = msg; err.hidden = false; el.focus(); return false; };
    const submit = () => {
      const t = titleEl.value.trim();
      if (!t) return fail('Give the note a title.', titleEl);
      const isNew = sel.value === NEW_CHAPTER;
      const ct = chapterTitle.value.trim();
      if (isNew && !ct) return fail('Name the new chapter.', chapterTitle);
      result = { title: t, chapter: isNew ? null : sel.value, newChapter: isNew ? ct : null };
      return true;
    };
    titleEl.addEventListener('input', () => { err.hidden = true; checkDupe(); });
    const m = openModal({
      title: 'New note',
      body: h('div', { class: 'stack jr-dialog' }, field('Title', titleEl), dupe, field('Chapter', sel), newField, err),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create note', kind: 'primary', onClick: submit }],
      onClose: () => resolve(result),
    });
    submitOnEnter(titleEl, submit, m);
    submitOnEnter(chapterTitle, submit, m);
    checkDupe();
    requestAnimationFrame(() => { titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); });
  });
}

/** Resolves {title, description} or null. */
export function chapterDialog({ title = '', description = '', heading = 'New chapter', okLabel = 'Create chapter' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const t = input({ value: title, placeholder: 'e.g. The Road to Greywater', maxlength: 120, autofocus: true });
    const d = textarea({ value: description, rows: 4, placeholder: 'A line or two about this part of the story. Markdown and [[links]] work here.' });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = () => {
      const v = t.value.trim();
      if (!v) { err.textContent = 'Give the chapter a title.'; err.hidden = false; t.focus(); return false; }
      result = { title: v, description: d.value.trim() };
      return true;
    };
    const m = openModal({
      title: heading,
      body: h('div', { class: 'stack jr-dialog' }, field('Title', t), field('Description', d, 'Shown on the chapter’s title page.'), err),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: okLabel, kind: 'primary', onClick: submit }],
      onClose: () => resolve(result),
    });
    submitOnEnter(t, submit, m);
  });
}

/** Resolves 'loose' (move notes to Loose Leaves), 'delete' (delete notes too) or null. */
export async function confirmDeleteChapter(ch) {
  if (!ch.notes.length) {
    const ok = await confirmDialog(`Delete the empty chapter “${ch.title}”?`, { title: `Delete ${ch.label}`, okLabel: 'Delete chapter', danger: true });
    return ok ? 'delete' : null;
  }
  const n = ch.notes.length;
  return choiceDialog(
    h('div', { class: 'stack' },
      h('p', null, `“${ch.title}” holds ${plural(n, 'note')}. What should become of ${n === 1 ? 'it' : 'them'}?`),
      h('p', { class: 'muted' }, 'Moving keeps every note, and every link to it, under Loose Leaves.')),
    [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: `Delete chapter and ${plural(n, 'note')}`, value: 'delete', kind: 'danger' },
      { label: 'Move notes to Loose Leaves', value: 'loose', kind: 'primary' },
    ],
    { title: `Delete ${ch.label}` },
  );
}

/** Resolves the destination chapter (or the Loose Leaves pseudo-chapter) or null. */
export function moveNoteDialog(note) {
  const ix = J.index();
  const items = [...ix.chapters, ix.loose].filter((c) => c.slug !== note.chapter);
  if (!items.length) {
    toast('There is no other chapter yet. Start one with “New chapter”.');
    return Promise.resolve(null);
  }
  return pickFromList({
    title: `Move “${note.title}” to…`,
    items,
    render: (c) => h('span', { class: 'picker-item-main' },
      h('span', { class: 'picker-item-title' }, chapterName(c)),
      h('small', { class: 'muted' }, plural(c.notes.length, 'note'))),
    search: (c) => `${c.label} ${c.title}`,
    empty: 'No chapter matches.',
  });
}

// ---------- quick switcher ----------

const PREFIX_ICON = {
  note: 'file', chapter: 'book-open', map: 'pin', char: 'user', doc: 'file-doc', spell: 'sparkle', weapon: 'sword',
  armor: 'shield', gear: 'backpack', item: 'star', 'magic-item': 'star', feat: 'level-up', ability: 'level-up',
  species: 'users', class: 'shield', subclass: 'shield', background: 'scroll',
};

const noteItem = (n) => ({ icon: 'file', label: n.title, detail: chapterName(n.chapterRef), kind: 'Note', href: n.href, hits: [] });
const chapterItem = (c) => ({ icon: 'book-open', label: c.title, detail: c.label, kind: 'Chapter', href: c.href, hits: [] });

function switcherItems(query) {
  const raw = String(query || '').trim();
  const ix = J.index();
  if (!raw) {
    const recent = J.recentNotes(8).map(noteItem);
    return [...recent, ...ix.chapters.map(chapterItem)].slice(0, 30);
  }
  const pm = /^([a-z][a-z-]*):(.*)$/i.exec(raw);
  const prefixed = !!pm && linkTypes().some((t) => t.prefix === pm[1].toLowerCase());
  const term = prefixed ? pm[2].trim() : raw;
  const out = [];
  if (!prefixed) {
    const scored = [];
    for (const n of ix.notes) {
      const ft = fuzzy(raw, n.title);
      let best = ft ? { score: ft.score + 3, hits: ft.hits, alias: null } : null;
      for (const a of n.aliases) {
        const fa = fuzzy(raw, a);
        if (fa && (!best || fa.score > best.score)) best = { score: fa.score, hits: [], alias: a };
      }
      if (best) {
        const it = noteItem(n);
        scored.push({ ...it, score: best.score, hits: best.hits, detail: best.alias ? `alias “${best.alias}” · ${it.detail}` : it.detail });
      }
    }
    for (const c of ix.chapters) {
      const f = fuzzy(raw, c.title) || fuzzy(raw, c.label);
      if (f) scored.push({ ...chapterItem(c), score: f.score, hits: fuzzy(raw, c.title)?.hits || [] });
    }
    scored.sort((a, b) => b.score - a.score);
    out.push(...scored.slice(0, 20));
  }
  const seen = new Set(out.map((o) => o.href));
  for (const s of suggestLinks(raw, 40)) {
    if (s.partial) continue;
    const prefix = (/^([a-z][a-z-]*):/i.exec(s.insert)?.[1] || 'note').toLowerCase();
    if (!prefixed && (prefix === 'note' || prefix === 'chapter')) continue;
    let r = null;
    try { r = resolveLink(s.insert); } catch (e) { console.warn(e); }
    if (!r?.href || !r.exists || seen.has(r.href)) continue;
    seen.add(r.href);
    out.push({ icon: PREFIX_ICON[prefix] || 'compendium', label: s.label, detail: null, kind: s.kind, href: r.href, hits: fuzzy(term, s.label)?.hits || [] });
  }
  if (!prefixed && !ix.notes.some((n) => nameKey(n.title) === nameKey(raw))) {
    out.push({ icon: 'plus', label: `Create note “${raw}”`, detail: null, kind: 'New', create: raw, hits: [] });
  }
  return out.slice(0, 40);
}

let switcherOpen = false;

export function openSwitcher({ onCreate = null } = {}) {
  if (switcherOpen) return;
  switcherOpen = true;
  const q = h('input', {
    class: 'input jr-sw-input', type: 'search', autocomplete: 'off', spellcheck: false, autofocus: true,
    placeholder: 'Jump to a note, chapter, place, character, spell…', 'aria-label': 'Jump to',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'jr-sw-list',
  });
  const list = h('ul', { class: 'jr-sw-list', role: 'listbox', id: 'jr-sw-list' });
  const kbd = (k) => h('kbd', null, k);
  const hint = h('p', { class: 'jr-sw-hint' },
    kbd('↑'), kbd('↓'), ' move ', kbd('Enter'), ' open ', kbd('Esc'), ' close · narrow with ',
    h('code', null, 'map:'), ' ', h('code', null, 'char:'), ' ', h('code', null, 'spell:'), ' …');
  let items = [];
  let active = 0;
  const m = openModal({
    title: 'Jump to…',
    className: 'jr-switcher',
    body: h('div', { class: 'jr-sw' }, q, list, hint),
    onClose: () => { switcherOpen = false; },
  });
  const mark = () => {
    [...list.children].forEach((li, i) => {
      li.classList.toggle('is-active', i === active);
      if (li.getAttribute('role') === 'option') li.setAttribute('aria-selected', String(i === active));
    });
    list.children[active]?.scrollIntoView({ block: 'nearest' });
    if (items.length) q.setAttribute('aria-activedescendant', `jr-sw-${active}`);
    else q.removeAttribute('aria-activedescendant');
  };
  const go = (it) => {
    m.close();
    if (it.create) onCreate?.(it.create);
    else navigate(it.href);
  };
  const draw = () => {
    clear(list);
    if (!items.length) { list.append(h('li', { class: 'jr-sw-empty' }, 'Nothing matches.')); return; }
    items.forEach((it, i) => list.append(h('li', {
      class: ['jr-sw-item', it.create && 'is-create'], role: 'option', id: `jr-sw-${i}`,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => go(it),
      onmousemove: () => { if (active !== i) { active = i; mark(); } },
    },
    icon(it.icon || 'file'),
    h('span', { class: 'jr-sw-main' },
      h('span', { class: 'jr-sw-label' }, hitsMarked(it.label, it.hits)),
      it.detail ? h('span', { class: 'jr-sw-detail' }, it.detail) : null),
    it.kind ? h('span', { class: 'jr-sw-kind' }, it.kind) : null)));
    mark();
  };
  const compute = () => { items = switcherItems(q.value); active = 0; draw(); };
  q.addEventListener('input', compute);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; mark(); } }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (items[active]) go(items[active]); }
  });
  compute();
}
