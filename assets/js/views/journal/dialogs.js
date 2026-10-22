// Journal dialogs: new note (from an unresolved link), folder picker (Move to…), delete folder, note properties,
// folder description, and the quick switcher (Ctrl+O / Ctrl+K): fuzzy jump to any note or folder, plus everything
// else in the link registry.
import { h, clear } from '../../core/dom.js';
import { icon, openModal, field, input, select, textarea, choiceDialog, confirmDialog, pickFromList } from '../../core/ui.js';
import { suggestLinks, resolveLink, linkTypes } from '../../core/links.js';
import { navigate } from '../../core/router.js';
import { nameKey } from '../../core/util.js';
import { load as yamlLoad, dump as yamlDump } from '../../../../vendor/js-yaml/js-yaml.mjs';
import * as J from './data.js';
import * as S from './state.js';
import { fuzzy, plural } from './text.js';
import { hitsMarked, KIND_ICON } from './parts.js';

function submitOnEnter(el, submit, modal) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (submit()) modal.close(); }
  });
}

const folderOptions = (ix) => ix.folderList.map((f) => ({
  value: f.path, label: f.isRoot ? `${J.VAULT_TITLE} (vault root)` : `${' '.repeat(f.depth)}${f.title}`,
}));

/** Resolves {title, folder} or null. */
export function newNoteDialog({ title = '', folder = '' } = {}) {
  return new Promise((resolve) => {
    const ix = J.index();
    let result = null;
    const titleEl = input({ value: title, placeholder: 'e.g. The Siege of Greywater', maxlength: 160 });
    const sel = select(folderOptions(ix), J.folderAt(folder, ix) ? J.folderAt(folder, ix).path : '');
    const dupe = h('p', { class: 'field-hint jr-dupe', hidden: true });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const checkDupe = () => {
      const n = J.findNote(titleEl.value.trim());
      dupe.hidden = !n;
      if (n) dupe.textContent = `“${n.title}” already exists in ${J.folderLabel(n.folderRef)}. Links to this title open that one.`;
    };
    const submit = () => {
      const t = titleEl.value.trim();
      if (!t) { err.textContent = 'Give the note a title.'; err.hidden = false; titleEl.focus(); return false; }
      result = { title: t, folder: sel.value };
      return true;
    };
    titleEl.addEventListener('input', () => { err.hidden = true; checkDupe(); });
    const m = openModal({
      title: 'New note',
      body: h('div', { class: 'stack jr-dialog' }, field('Title', titleEl), dupe, field('Folder', sel), err),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create note', kind: 'primary', onClick: submit }],
      onClose: () => resolve(result),
    });
    submitOnEnter(titleEl, submit, m);
    checkDupe();
    requestAnimationFrame(() => { titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); });
  });
}

/** Pick a destination folder. `allow(folder)` filters the choices. Resolves a folder or null. */
export function pickFolder({ title = 'Move to…', allow = () => true } = {}) {
  const ix = J.index();
  const items = ix.folderList.filter(allow);
  return pickFromList({
    title,
    items,
    render: (f) => h('span', { class: 'picker-item-main jr-pick-folder', style: `--depth:${Math.max(0, f.depth)}` },
      h('span', { class: 'picker-item-title' }, icon('folder'), f.isRoot ? `${J.VAULT_TITLE} (vault root)` : f.title),
      h('small', { class: 'muted' }, f.isRoot ? plural(f.notes.length, 'note') : `${J.folderLabel(f)} · ${plural(f.count, 'note')}`)),
    search: (f) => `${J.folderLabel(f)} ${f.slug}`,
    empty: 'No folder matches.',
  });
}

/** Resolves 'keep' (move contents up), 'delete' (everything) or null. */
export async function confirmDeleteFolder(f) {
  const where = f.parent && !f.parent.isRoot ? `“${f.parent.title}”` : 'the vault root';
  if (!f.count && !f.folders.length) {
    const ok = await confirmDialog(`Delete the empty folder “${f.title}”?`, { title: 'Delete folder', okLabel: 'Delete folder', danger: true });
    return ok ? 'delete' : null;
  }
  const subs = J.index().folderList.filter((x) => x !== f && J.isUnder(x.path, f.path)).length;
  return choiceDialog(
    h('div', { class: 'stack' },
      h('p', null, `“${f.title}” holds ${plural(f.count, 'note')}${subs ? ` in ${plural(subs + 1, 'folder')}` : ''}.`),
      h('p', { class: 'muted' }, `Keep the notes to move everything up into ${where} and delete only the folder. Deleting everything removes the notes for the whole party once you save.`)),
    [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: `Delete folder and ${plural(f.count, 'note')}`, value: 'delete', kind: 'danger' },
      { label: 'Keep the notes', value: 'keep', kind: 'primary' },
    ],
    { title: `Delete “${f.title}”` },
  );
}

/** Edit a note's properties (frontmatter other than the title) as YAML. Resolves the new frontmatter or null. */
export function propertiesDialog(note) {
  return new Promise((resolve) => {
    let result = null;
    const { title, ...rest } = note.fm;
    const ta = textarea({
      value: Object.keys(rest).length ? yamlDump(rest, { lineWidth: 100 }) : '', rows: 10, spellcheck: false,
      placeholder: 'aliases: [Mira the Bold]\ntags: [npc, npc/ally]\nlocation: "[[map:Greywater]]"',
      class: 'textarea jr-yaml',
    });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = () => {
      let data;
      try { data = ta.value.trim() ? yamlLoad(ta.value) : {}; } catch (e) {
        err.textContent = `That is not valid YAML: ${String(e.reason || e.message).split('\n')[0]}`;
        err.hidden = false;
        return false;
      }
      if (data == null) data = {};
      if (typeof data !== 'object' || Array.isArray(data)) { err.textContent = 'Write one “key: value” per line.'; err.hidden = false; return false; }
      result = data;
      return true;
    };
    ta.addEventListener('input', () => { err.hidden = true; });
    openModal({
      title: `Properties of “${note.title}”`,
      body: h('div', { class: 'stack jr-dialog' },
        field('Properties (YAML)', ta, 'One “key: value” per line. aliases let [[links]] find this note by other names; tags work like #tags.'),
        err),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save properties', kind: 'primary', onClick: submit }],
      onClose: () => resolve(result),
    });
    requestAnimationFrame(() => ta.focus());
  });
}

/** Resolves the new description (possibly '') or null. */
export function descriptionDialog(f) {
  return new Promise((resolve) => {
    let result = null;
    const d = textarea({ value: f.description, rows: 5, placeholder: 'A line or two about what is filed here. Markdown and [[links]] work.' });
    openModal({
      title: `About “${f.title}”`,
      body: h('div', { class: 'stack jr-dialog' }, field('Description', d, 'Shown at the top of the folder page.')),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: () => { result = d.value.trim(); } }],
      onClose: () => resolve(result),
    });
    requestAnimationFrame(() => d.focus());
  });
}

// ---------- quick switcher ----------

const noteItem = (n) => ({ icon: 'file', label: n.title, detail: J.folderLabel(n.folderRef), kind: 'Note', href: n.href, hits: [] });
const folderItem = (f) => ({ icon: 'folder', label: f.title, detail: f.parent && !f.parent.isRoot ? J.folderLabel(f.parent) : null, kind: 'Folder', href: f.href, hits: [] });

function switcherItems(query) {
  const raw = String(query || '').trim();
  const ix = J.index();
  if (!raw) {
    const opened = S.recent().map((p) => J.noteByPath(p, ix)).filter(Boolean);
    const seen = new Set(opened.map((n) => n.path));
    const edited = J.recentNotes(12).filter((n) => !seen.has(n.path));
    return [...opened.slice(0, 10).map((n) => ({ ...noteItem(n), kind: 'Opened' })), ...edited.slice(0, 10).map((n) => ({ ...noteItem(n), kind: 'Edited' }))].slice(0, 16);
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
      if (!best && raw.includes('/')) {
        const fp = fuzzy(raw, `${J.folderLabel(n.folderRef)}/${n.title}`);
        if (fp) best = { score: fp.score - 10, hits: [], alias: null };
      }
      if (best) {
        const it = noteItem(n);
        scored.push({ ...it, score: best.score, hits: best.hits, detail: best.alias ? `alias “${best.alias}” · ${it.detail}` : it.detail });
      }
    }
    for (const f of ix.folderList) {
      if (f.isRoot) continue;
      const fz = fuzzy(raw, f.title);
      if (fz) scored.push({ ...folderItem(f), score: fz.score - 2, hits: fz.hits });
    }
    scored.sort((a, b) => b.score - a.score);
    out.push(...scored.slice(0, 20));
  }
  const seen = new Set(out.map((o) => o.href));
  for (const s of suggestLinks(raw, 40)) {
    if (s.partial) continue;
    const prefix = (/^([a-z][a-z-]*):/i.exec(s.insert)?.[1] || 'note').toLowerCase();
    if (!prefixed && (prefix === 'note' || prefix === 'chapter' || prefix === 'folder')) continue;
    let r = null;
    try { r = resolveLink(s.insert); } catch (e) { console.warn(e); }
    if (!r?.href || !r.exists || seen.has(r.href)) continue;
    seen.add(r.href);
    out.push({ icon: KIND_ICON[prefix] || 'compendium', label: s.label, detail: null, kind: s.kind, href: r.href, hits: fuzzy(term, s.label)?.hits || [] });
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
    class: 'input jr-sw-input', type: 'search', autocomplete: 'off', spellcheck: false,
    placeholder: 'Jump to a note, folder, place, character, spell…', 'aria-label': 'Jump to',
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
    if (!items.length) { list.append(h('li', { class: 'jr-sw-empty' }, String(q.value).trim() ? 'Nothing matches.' : 'No notes yet.')); return; }
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
