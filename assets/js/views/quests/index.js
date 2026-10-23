// Quests tab: a video-game style quest log in two panes.
//   Quest log (left): Main quests, then Minor quests (grouped under the main quest they lead to), then Side quests,
//   each with its symbol; Active / Finished / All and a search. A quest completed, failed or reopened slides out of
//   the list it left a moment later (leaveSoon).
//   Open quest (right): type and status, image (only here), relevant characters, objectives, description, rewards and,
//   for a main quest, its minor quests; edited in place (Edit -> #/quests/<id>/edit).
// Model and ordering: model.js (pure, tools/test_quests.mjs); docs/quests-model.md. [[quest:Title]] links here.
import { h, mount, clear } from '../../core/dom.js';
import { icon, toast, openModal, confirmDialog, field, input, select, markdownEditor, pickFromList } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate, href } from '../../core/router.js';
import { registerLinkType, matchNames } from '../../core/links.js';
import { renderInto } from '../../core/markdown.js';
import { getSetting } from '../../core/settings.js';
import { saveSoon, majorSaveOn } from '../../core/saving.js';
import { uid, slugify, debounce, fmtDate, stripExt, extOf, baseName } from '../../core/util.js';
import { prepareImage, openViewer } from '../journal/gallery.js';
import { registerHideable, isHidden, onDmMode } from '../../core/dm.js';
import { visibilityToggle, hiddenChoice, hiddenMark } from '../../core/dm-ui.js';
import { characterChip, characterSuggestions, attachSuggest, wikiSuggest, newEntries } from './people.js';
import {
  QUEST_DIR, MEDIA_DIR, TYPES, STATUSES, VIEWS, typeOf, statusOf, normalizeQuest, newQuest, progress, questLog, stepsOf,
  viewCounts, findQuest, cleanTags, questPasses,
} from './model.js';

const VIEW = 'quests';
const UI_KEY = 'sw:quests:ui'; // per device: {view, folded: [branch]}
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const LEAVE_AFTER_MS = 1200; // a quest whose status changed shows its new state this long in its old list,
const LEAVE_ANIM_MS = 450; //  then slides out (quests.css .is-leaving)

const S = {
  root: null, logEl: null, listEl: null, paneEl: null, countsEl: null, searchEl: null,
  id: null, editing: false, draft: null, q: '', ui: loadUi(), queued: false,
  leaving: null, gone: null, leaveTimer: 0, bump: null, // leaveSoon
};

function loadUi() {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    return { view: VIEWS.some((x) => x.id === v.view) ? v.view : 'active', folded: Array.isArray(v.folded) ? v.folded.filter((t) => typeof t === 'string') : [] };
  } catch { return { view: 'active', folded: [] }; }
}
function setUi(patch) {
  S.ui = { ...S.ui, ...patch };
  try { localStorage.setItem(UI_KEY, JSON.stringify(S.ui)); } catch { /* private mode */ }
}

// ---------- data ----------

const pathOf = (id) => `${QUEST_DIR}/${id}.json`;
const idOf = (path) => baseName(path).replace(/\.json$/i, '');
const allQuests = () => store.list(QUEST_DIR).filter((d) => d.path.endsWith('.json')).map((d) => normalizeQuest(d.data, idOf(d.path)));
const questById = (id) => { const d = id ? store.get(pathOf(id)) : null; return d ? normalizeQuest(d, id) : null; };
const typeIcon = (type, extra = '') => h('span', { class: ['qs-sym', `qs-sym-${type}`, extra], 'aria-hidden': 'true' }, icon(typeOf(type).icon));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Write a quest (opts.hidden: create it hidden from the players, DM mode; a hidden quest stays hidden). */
function putQuest(q, { hidden = null } = {}) {
  const doc = { ...q, title: String(q.title || '').trim() || 'Untitled quest', characters: cleanTags(q.characters), updated: new Date().toISOString() };
  store.put(pathOf(q.id), doc, { hidden });
}
// Typing in the editor: one draft write a moment after the last key (the commit itself follows the auto-save timer)
const putDraftSoon = debounce(() => { if (S.draft) putQuest(S.draft); }, 400);

/** Our own uploads under MEDIA_DIR, once no quest uses them any more. */
function dropImageIfUnused(src, exceptId) {
  if (!src || !src.startsWith(`${MEDIA_DIR}/`)) return;
  if (allQuests().some((x) => x.id !== exceptId && x.image === src)) return;
  store.remove(src);
}

// DM mode: quests can be hidden from the players until released (core/dm.js)
registerHideable({
  prefix: `${QUEST_DIR}/`, label: 'Quest', icon: 'quests', order: 10, accept: (p) => p.endsWith('.json'),
  describe: (path, data) => ({ title: normalizeQuest(data, idOf(path)).title, href: href(VIEW, idOf(path)) }),
});

// ---------- link type: [[quest:Title]] ----------

registerLinkType('quest', {
  label: 'Quest',
  order: 45,
  resolve(target) {
    const q = findQuest(allQuests(), target);
    return q ? { href: href(VIEW, q.id), title: `${typeOf(q.type).label}: ${q.title}${q.status !== 'active' ? ` (${statusOf(q.status).label.toLowerCase()})` : ''}`, exists: true } : null;
  },
  suggest(term) {
    return matchNames(allQuests(), term, (x) => x.title, 8).map((x) => ({ label: `${x.title} · ${typeOf(x.type).label}`, value: x.title }));
  },
});

// ---------- layout ----------

function build(el) {
  S.searchEl = h('input', {
    class: 'input', type: 'search', placeholder: 'Search quests', 'aria-label': 'Search quests', value: S.q,
    oninput: (e) => { S.q = e.target.value; renderLog(); },
  });
  S.countsEl = h('div', { class: 'qs-views', role: 'group', 'aria-label': 'Show' });
  S.listEl = h('div', { class: 'qs-branches' });
  S.logEl = h('aside', { class: 'panel qs-log', 'aria-label': 'Quest log' },
    h('header', { class: 'qs-log-head' },
      h('h2', { class: 'qs-log-title' }, icon('quests'), 'Quest log'),
      S.countsEl,
      h('label', { class: 'search qs-search' }, icon('search'), S.searchEl)),
    S.listEl,
    h('p', { class: 'qs-legend', 'aria-label': 'Quest symbols' },
      TYPES.map((t) => h('span', { class: 'qs-legend-item' }, typeIcon(t.id), t.label))));
  S.paneEl = h('section', { class: 'panel qs-pane', 'aria-live': 'polite' });
  S.root = h('div', { class: 'qs' },
    h('header', { class: 'view-head qs-head' },
      h('h1', { class: 'view-title' }, 'Quests'),
      h('p', { class: 'view-sub' }, 'The party’s quest log: the main story first, then the minor quests that lead to it, then side quests.'),
      h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newQuestDialog() }, icon('plus'), 'New quest'))),
    h('div', { class: 'qs-body' }, S.logEl, S.paneEl));
  el.append(S.root);
}

function render() {
  if (!S.root) return;
  S.root.classList.toggle('has-open', !!S.id);
  renderLog();
  renderPane();
}

// ---------- quest log (left) ----------

function renderLog() {
  const all = allQuests();
  const counts = viewCounts(all);
  clear(S.countsEl);
  S.countsEl.append(...VIEWS.map((v) => h('button', {
    class: ['chip', 'qs-view-chip', S.bump === v.id && 'is-bump'], type: 'button', 'aria-pressed': String(S.ui.view === v.id),
    onclick: () => { setUi({ view: v.id }); renderLog(); },
  }, v.label, h('span', { class: 'qs-n num' }, String(counts[v.id])))));
  S.bump = null;
  const log = questLog(all, { view: S.ui.view, q: S.q, keep: S.gone === S.id ? null : S.id });
  const shown = log.reduce((n, b) => n + b.quests.length, 0);
  if (!all.length) {
    mount(S.listEl, h('div', { class: 'qs-log-empty' },
      h('p', null, 'No quests yet.'),
      h('ul', { class: 'qs-branch-help', role: 'list' }, TYPES.map((t) => h('li', null, typeIcon(t.id), h('span', null, h('strong', null, t.plural), ` · ${t.hint}`)))),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => newQuestDialog() }, icon('plus'), 'Add the first quest')));
    return;
  }
  mount(S.listEl, log.map((b) => branch(b, all)),
    !shown ? h('p', { class: 'muted ui text-sm qs-none' }, S.q.trim() ? `No quest matches “${S.q.trim()}”.` : S.ui.view === 'active' ? 'No active quests. Everything is finished.' : 'No finished quests yet.') : null);
}

function branch(b, all) {
  const t = typeOf(b.type);
  const folded = S.ui.folded.includes(b.type);
  const bodyId = `qs-branch-${b.type}`;
  const item = (q) => {
    const p = progress(q);
    return h('li', { class: S.leaving === q.id ? 'is-leaving' : null }, h('a', {
      class: ['qs-item', q.id === S.id && 'is-current', q.status !== 'active' && `is-${q.status}`], href: href(VIEW, q.id),
      'aria-current': q.id === S.id ? 'page' : null, 'data-quest': q.id,
    },
    typeIcon(q.type),
    h('span', { class: 'qs-item-title' }, q.title),
    hiddenMark(pathOf(q.id)),
    q.status !== 'active' ? h('span', { class: ['qs-item-state', `is-${q.status}`], title: statusOf(q.status).label }, icon(q.status === 'completed' ? 'check' : 'close'))
      : p.total ? h('span', { class: 'qs-item-prog num', title: `${p.done} of ${p.total} objectives done` }, `${p.done}/${p.total}`) : null));
  };
  const list = (quests) => h('ul', { class: 'qs-items', role: 'list' }, quests.map(item));
  let body;
  if (b.type === 'minor') {
    body = b.groups.map((g) => h('div', { class: 'qs-group' },
      h('p', { class: 'qs-group-head' }, g.parent ? [h('span', { class: 'qs-group-arrow', 'aria-hidden': 'true' }, '↳'), ' leads to ', h('a', { href: href(VIEW, g.parent.id) }, g.parent.title)] : 'Not tied to a main quest'),
      list(g.quests)));
  } else body = list(b.quests);
  return h('section', { class: ['qs-branch', `qs-branch-${b.type}`, folded && 'is-folded'] },
    h('h3', { class: 'qs-branch-head' }, h('button', {
      class: 'qs-branch-btn', type: 'button', 'aria-expanded': String(!folded), 'aria-controls': bodyId,
      onclick: () => { setUi({ folded: folded ? S.ui.folded.filter((x) => x !== b.type) : [...S.ui.folded, b.type] }); renderLog(); },
    }, icon(folded ? 'chevron-right' : 'chevron-down'), typeIcon(b.type), h('span', null, t.plural), h('span', { class: 'qs-n num' }, String(b.quests.length)))),
    h('div', { class: 'qs-branch-body', id: bodyId, hidden: folded },
      b.quests.length ? body : h('p', { class: 'qs-branch-empty' }, emptyLine(b.type, all))));
}

/**
 * After a status change: the open quest stays in the list for a moment with its new state (a check, or a cross), then
 * slides out of the list it no longer belongs to (Active -> Finished, or back on Reopen) and that list's chip lights up.
 * Until then the open quest is kept listed whatever the filter (questLog keep).
 */
function leaveSoon(id) {
  clearTimeout(S.leaveTimer);
  S.leaving = null;
  S.gone = null;
  S.leaveTimer = setTimeout(() => {
    const q = questById(id);
    if (!q || S.id !== id || questPasses(q, { view: S.ui.view })) return; // reopened meanwhile, or the All list
    S.leaving = id;
    renderLog();
    S.leaveTimer = setTimeout(() => {
      S.leaving = null;
      S.gone = id;
      S.bump = q.status === 'active' ? 'active' : 'done';
      renderLog();
    }, LEAVE_ANIM_MS);
  }, LEAVE_AFTER_MS);
}

function emptyLine(type, all) {
  if (S.q.trim()) return 'No match here.';
  if (S.ui.view === 'done') return 'None finished yet.';
  return all.some((x) => x.type === type) ? 'None active.' : { main: 'No main quest yet.', minor: 'No minor quests yet.', side: 'No side quests yet.' }[type];
}

// ---------- open quest (right) ----------

function renderPane() {
  if (!S.id) {
    const all = allQuests();
    const c = viewCounts(all);
    mount(S.paneEl, h('div', { class: 'empty-state qs-pick' },
      icon('quests'),
      h('h2', null, all.length ? 'Open a quest from the log' : 'The quest log is empty'),
      h('p', null, all.length ? `${plural(c.active, 'active quest')}${c.done ? `, ${c.done} finished` : ''}.` : 'Start with the main quest of the campaign, then add the minor quests that lead to it and any side quests.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newQuestDialog() }, icon('plus'), 'New quest')));
    return;
  }
  const q = questById(S.id);
  if (!q) {
    mount(S.paneEl, h('div', { class: 'empty-state qs-pick' }, icon('warning'), h('h2', null, 'Quest not found'),
      h('p', null, 'It may have been deleted or renamed.'), h('a', { class: 'btn', href: href(VIEW) }, icon('chevron-left'), 'Quest log')));
    return;
  }
  if (S.editing) { renderEditor(q); return; }
  S.draft = null;
  mount(S.paneEl, questView(q));
}

function backLink() {
  return h('a', { class: 'btn btn-ghost btn-sm qs-back', href: href(VIEW) }, icon('chevron-left'), 'Quest log');
}

function questView(q) {
  const t = typeOf(q.type);
  const all = allQuests();
  const parent = q.type === 'minor' && q.parent ? all.find((x) => x.id === q.parent && x.type === 'main') : null;
  const steps = q.type === 'main' ? stepsOf(all, q.id) : [];
  const p = progress(q);
  const setStatus = (status) => {
    putQuest({ ...q, status });
    leaveSoon(q.id);
    saveSoon(`quests: ${status === 'active' ? 'reopen' : status === 'completed' ? 'complete' : 'fail'} “${q.title}”`);
    toast(status === 'completed' ? `Quest complete: ${q.title}. It moves to Finished.` : status === 'failed' ? `Quest failed: ${q.title}. It moves to Finished.` : `Reopened: ${q.title}. It is back under Active.`, { type: status === 'failed' ? 'info' : 'success' });
  };
  return h('article', { class: ['qs-quest', `qs-quest-${q.type}`, `is-${q.status}`] },
    h('div', { class: 'qs-quest-bar' },
      backLink(),
      h('span', { class: 'qs-quest-kind' }, typeIcon(q.type), t.label),
      q.status !== 'active' ? h('span', { class: ['badge', q.status === 'completed' ? 'badge-ok' : 'badge-danger'] }, statusOf(q.status).label) : null,
      h('span', { class: 'spacer' }),
      q.status === 'active'
        ? [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setStatus('completed'), title: 'Mark the quest as completed' }, icon('check'), 'Complete'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setStatus('failed'), title: 'Mark the quest as failed' }, icon('close'), 'Failed')]
        : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setStatus('active') }, icon('undo'), 'Reopen'),
      h('a', { class: 'btn btn-sm', href: href(VIEW, q.id, 'edit') }, icon('edit'), 'Edit')),
    visibilityToggle(pathOf(q.id), { label: 'this quest' }),
    h('h2', { class: 'qs-quest-title' }, q.title),
    parent ? h('p', { class: 'qs-quest-parent' }, 'A step towards ', typeIcon('main'), h('a', { href: href(VIEW, parent.id) }, parent.title)) : null,
    q.image ? questImage(q) : null,
    q.characters.length ? h('div', { class: 'qs-chars' }, h('span', { class: 'qs-label' }, 'Characters'), h('span', { class: 'qs-chips' }, q.characters.map((c) => characterChip(c)))) : null,
    h('section', { class: 'qs-sec' },
      h('h3', { class: 'qs-sec-title' }, 'Objectives', p.total ? h('span', { class: 'qs-n num' }, `${p.done}/${p.total}`) : null),
      p.total ? h('div', { class: 'qs-prog', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.done, 'aria-label': 'Objectives done' },
        h('span', { style: { width: `${Math.round((p.done / p.total) * 100)}%` } })) : null,
      p.total ? h('ul', { class: 'qs-objs', role: 'list' }, q.objectives.map((o) => h('li', { class: ['qs-obj', o.done && 'is-done'] },
        h('label', null,
          h('input', { type: 'checkbox', class: 'checkbox', checked: o.done, onchange: (e) => toggleObjective(q, o.id, e.target.checked) }),
          inlineMd(o.text || 'Untitled objective')))))
        : h('p', { class: 'muted ui text-sm' }, 'No objectives yet. ', h('a', { href: href(VIEW, q.id, 'edit') }, 'Add some'), '.')),
    q.description.trim() ? h('section', { class: 'qs-sec' }, h('h3', { class: 'qs-sec-title' }, 'Description'), md(q.description)) : null,
    q.rewards.trim() ? h('section', { class: 'qs-sec qs-rewards' }, h('h3', { class: 'qs-sec-title' }, icon('coins'), 'Rewards'), md(q.rewards)) : null,
    q.type === 'main' ? h('section', { class: 'qs-sec' },
      h('h3', { class: 'qs-sec-title' }, typeIcon('minor'), 'Minor quests on the way', h('span', { class: 'qs-n num' }, String(steps.length))),
      steps.length ? h('ul', { class: 'qs-steps', role: 'list' }, steps.map((x) => {
        const sp = progress(x);
        return h('li', null, h('a', { class: ['qs-item', x.status !== 'active' && `is-${x.status}`], href: href(VIEW, x.id) },
          typeIcon('minor'), h('span', { class: 'qs-item-title' }, x.title),
          x.status !== 'active' ? h('span', { class: ['qs-item-state', `is-${x.status}`], title: statusOf(x.status).label }, icon(x.status === 'completed' ? 'check' : 'close'))
            : sp.total ? h('span', { class: 'qs-item-prog num' }, `${sp.done}/${sp.total}`) : null));
      })) : null,
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => newQuestDialog({ type: 'minor', parent: q.id }) }, icon('plus'), 'Add a minor quest')) : null,
    h('p', { class: 'qs-meta muted ui text-xs' },
      [q.createdBy ? `Added by ${q.createdBy}` : null, q.created ? fmtDate(q.created) : null, q.updated && q.updated !== q.created ? `updated ${fmtDate(q.updated)}` : null].filter(Boolean).join(' · '),
      ' · ', h('button', { class: 'ch-link-btn', type: 'button', onclick: () => copyLink(q) }, 'Copy link')));
}

function md(src) {
  const el = h('div', { class: 'prose qs-md' });
  renderInto(el, src);
  return el;
}
function inlineMd(src) {
  const el = h('span', { class: 'qs-obj-text' });
  renderInto(el, src);
  // one line of markdown renders as a paragraph; keep it inline in the label
  const only = el.children.length === 1 && el.firstElementChild.tagName === 'P' ? el.firstElementChild : null;
  if (only) only.replaceWith(...only.childNodes);
  return el;
}

function questImage(q) {
  const img = h('img', { class: 'qs-img', alt: '', decoding: 'async' });
  const fig = h('figure', { class: 'qs-figure' }, h('button', {
    class: 'qs-img-btn', type: 'button', title: 'Show the image full size', 'aria-label': `Show the image of ${q.title} full size`,
    onclick: (e) => openViewer([{ src: q.image, caption: q.title }], 0, { back: e.currentTarget }),
  }, img));
  if (/^https:/i.test(q.image)) img.src = q.image;
  else store.fileUrl(q.image).then((url) => { if (url) img.src = url; else fig.remove(); }).catch(() => fig.remove());
  img.addEventListener('error', () => fig.remove());
  return fig;
}

function toggleObjective(q, oid, done) {
  const fresh = questById(q.id) || q;
  putQuest({ ...fresh, objectives: fresh.objectives.map((o) => (o.id === oid ? { ...o, done } : o)) });
  const p = progress({ objectives: fresh.objectives.map((o) => (o.id === oid ? { ...o, done } : o)) });
  if (done && p.total && p.done === p.total && fresh.status === 'active') toast(`Every objective of “${fresh.title}” is done. Mark the quest complete when the party has finished it.`, { timeout: 6000 });
}

async function copyLink(q) {
  const text = `[[quest:${q.title}]]`;
  try { await navigator.clipboard.writeText(text); toast(`Copied ${text} — paste it into any note.`, { type: 'success' }); } catch { toast(text); }
}

// ---------- editor (right pane, #/quests/<id>/edit) ----------

function renderEditor(q) {
  if (!S.draft || S.draft.id !== q.id) S.draft = structuredClone(q);
  const d = S.draft;
  const change = () => putDraftSoon();
  const mains = allQuests().filter((x) => x.type === 'main' && x.id !== d.id);
  const typeRow = h('div', { class: 'qs-type-pick', role: 'radiogroup', 'aria-label': 'Quest type' }, TYPES.map((t) => h('button', {
    class: ['qs-type-btn', d.type === t.id && 'is-active'], type: 'button', role: 'radio', 'aria-checked': String(d.type === t.id), title: t.hint,
    onclick: () => { d.type = t.id; if (t.id !== 'minor') d.parent = null; putDraftSoon.flush(); renderPane(); },
  }, typeIcon(t.id), h('span', null, t.label))));
  const parentRow = d.type === 'minor' ? field('Leads to (main quest)', select(
    [{ value: '', label: mains.length ? '— not tied to a main quest —' : '— no main quest yet —' }, ...mains.map((m) => ({ value: m.id, label: m.title }))],
    d.parent || '', (v) => { d.parent = v || null; putDraftSoon.flush(); }), 'The minor quest is listed under that main quest and shown in its steps.') : null;
  const title = input({ value: d.title === 'Untitled quest' ? '' : d.title, placeholder: 'Quest title', 'aria-label': 'Title', oninput: (e) => { d.title = e.target.value; change(); } });
  const status = select(STATUSES.map((s) => ({ value: s.id, label: s.label })), d.status, (v) => { d.status = v; putDraftSoon.flush(); leaveSoon(d.id); saveSoon(`quests: ${v} “${d.title}”`); });
  const desc = markdownEditor({ value: d.description, rows: 7, onInput: (v) => { d.description = v; change(); }, placeholder: 'What the party knows: who asked, what is at stake. [[ links to notes, places, characters…' });
  const rewards = markdownEditor({ value: d.rewards, rows: 3, onInput: (v) => { d.rewards = v; change(); }, placeholder: d.type === 'side' ? 'Gold, items, favours… (side quests are done for their rewards)' : 'Rewards, if any' });
  mount(S.paneEl, h('form', { class: 'qs-quest qs-editor', onsubmit: (e) => { e.preventDefault(); finishEditing(); } },
    h('div', { class: 'qs-quest-bar' },
      backLink(),
      h('span', { class: 'qs-quest-kind' }, icon('edit'), 'Editing quest'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteQuest(d) }, icon('trash'), 'Delete'),
      h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, icon('check'), 'Done')),
    visibilityToggle(pathOf(d.id), { label: 'this quest', before: () => putDraftSoon.flush(), onChange: () => renderPane() }),
    field('Type', typeRow),
    parentRow,
    h('div', { class: 'qs-ed-row' }, field('Title', title), field('Status', status)),
    field('Relevant characters', tagEditor(d, change), 'Pick a party member, an NPC (a journal note tagged #npc) or any page; type map:, doc:, quest:… for other kinds. A name with no page yet links to a new note for it. Enter or comma adds one.'),
    field('Objectives', objectivesEditor(d, change), 'Type [[ to link a note, place, character or anything else on the site.'),
    field('Description', desc),
    field('Rewards', rewards),
    field('Image', imageEditor(d), 'Shown only when the quest is open, not in the log.')));
  if (d.title === 'Untitled quest') requestAnimationFrame(() => title.focus());
}

function finishEditing() {
  putDraftSoon.flush();
  const id = S.draft?.id;
  S.draft = null;
  navigate(href(VIEW, id));
}

// Relevant characters: chips that show what each entry opens (people.js), and a suggestion list (party members,
// NPC notes, other pages) that stores a link to the exact page picked. Plain typed names are kept as names.
function tagEditor(d, change) {
  const chips = h('span', { class: 'qs-chips' });
  const inp = h('input', { class: 'input qs-tag-input', type: 'text', autocomplete: 'off', placeholder: d.characters.length ? 'Add another…' : 'A party member, an NPC or any page', 'aria-label': 'Add a character' });
  const draw = () => {
    mount(chips, d.characters.map((tag) => characterChip(tag, {
      onRemove: () => { d.characters = d.characters.filter((x) => x !== tag); draw(); change(); inp.focus(); },
    })));
  };
  const addAll = (vals) => {
    const next = cleanTags([...d.characters, ...newEntries(d.characters, vals)]); // one chip per page
    inp.value = '';
    if (next.length !== d.characters.length) { d.characters = next; draw(); change(); }
  };
  attachSuggest(inp, {
    context: (el) => ({ query: el.value }),
    items: (q) => characterSuggestions(q, d.characters),
    apply: (it) => { addAll([it.value]); inp.focus(); },
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAll(inp.value.split(',')); }
    else if (e.key === 'Backspace' && !inp.value && d.characters.length) { d.characters = d.characters.slice(0, -1); draw(); change(); }
  });
  inp.addEventListener('blur', () => { if (inp.value.trim()) addAll(inp.value.split(',')); });
  draw();
  return h('div', { class: 'qs-tags' }, chips, inp);
}

function objectivesEditor(d, change) {
  const box = h('div', { class: 'qs-obj-ed' });
  const draw = (focusId = null) => {
    const rows = d.objectives.map((o, i) => {
      const text = h('input', { class: 'input', type: 'text', value: o.text, placeholder: 'What has to be done', 'aria-label': `Objective ${i + 1}`, 'data-oid': o.id, oninput: (e) => { o.text = e.target.value; change(); } });
      wikiSuggest(text); // [[ links, like the description (its Enter picks a suggestion first)
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAfter(i); } });
      const move = (k) => { const j = i + k; [d.objectives[i], d.objectives[j]] = [d.objectives[j], d.objectives[i]]; change(); draw(o.id); };
      return h('li', { class: 'qs-obj-row' },
        h('input', { type: 'checkbox', class: 'checkbox', checked: o.done, 'aria-label': `Objective ${i + 1} done`, onchange: (e) => { o.done = e.target.checked; change(); } }),
        text,
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: () => move(-1) }, icon('chevron-up')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': 'Move down', title: 'Move down', disabled: i === d.objectives.length - 1, onclick: () => move(1) }, icon('chevron-down')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove objective ${i + 1}`, title: 'Remove', onclick: () => { d.objectives.splice(i, 1); change(); draw(d.objectives[Math.min(i, d.objectives.length - 1)]?.id); } }, icon('close')));
    });
    mount(box, d.objectives.length ? h('ol', { class: 'qs-obj-rows' }, rows) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addAfter(d.objectives.length - 1) }, icon('plus'), 'Add objective'));
    if (focusId) box.querySelector(`[data-oid="${CSS.escape(focusId)}"]`)?.focus();
  };
  const addAfter = (i) => {
    let n = d.objectives.length + 1;
    while (d.objectives.some((o) => o.id === `o${n}`)) n += 1;
    const o = { id: `o${n}`, text: '', done: false };
    d.objectives.splice(i + 1, 0, o);
    change();
    draw(o.id);
  };
  draw();
  return box;
}

function imageEditor(d) {
  const box = h('div', { class: 'qs-img-ed' });
  const draw = () => {
    const thumb = d.image ? h('img', { class: 'qs-img-thumb', alt: '' }) : null;
    if (thumb) {
      if (/^https:/i.test(d.image)) thumb.src = d.image;
      else store.fileUrl(d.image).then((url) => { if (url) thumb.src = url; }).catch(() => {});
    }
    mount(box, thumb,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => uploadImage(d, draw) }, icon('upload'), d.image ? 'Replace' : 'Upload an image'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => chooseImage(d, draw) }, icon('image'), 'From the site files'),
        d.image ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setImage(d, null, draw) }, icon('trash'), 'Remove') : null));
  };
  draw();
  return box;
}

function pickFile() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*', style: 'position:fixed;left:-9999px;top:0' });
    let fin = false;
    const finish = (f) => { if (fin) return; fin = true; inp.remove(); resolve(f); };
    inp.addEventListener('change', () => finish(inp.files?.[0] || null));
    inp.addEventListener('cancel', () => finish(null));
    document.body.append(inp);
    inp.click();
  });
}

async function uploadImage(d, redraw) {
  const file = await pickFile();
  if (!file) return;
  try {
    const { blob, ext } = await prepareImage(file);
    const path = `${MEDIA_DIR}/${slugify(d.id).slice(0, 40)}-${slugify(stripExt(file.name)).slice(0, 30) || 'image'}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    await store.putBinary(path, blob, { hidden: isHidden(pathOf(d.id)) }); // a hidden quest's image is hidden too
    setImage(d, path, redraw, `quests: image for “${d.title}”`);
  } catch (e) {
    toast(`Could not add the image: ${e.message || e}`, { type: 'error', timeout: 7000 });
  }
}

async function chooseImage(d, redraw) {
  const items = store.files('content/').filter((f) => IMAGE_RE.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const f = await pickFromList({
    title: 'Use an image from the site files', items, empty: 'No images in the site files yet. Upload one instead.',
    render: (x) => h('span', { class: 'qs-pick-file' }, icon('image'), h('span', null, baseName(x.path)), h('span', { class: 'muted' }, x.path.split('/').slice(0, -1).join('/'))),
    search: (x) => x.path,
  });
  if (f?.path) setImage(d, f.path, redraw, `quests: image for “${d.title}”`);
}

function setImage(d, src, redraw, reason = `quests: remove the image of “${d.title}”`) {
  const old = d.image;
  d.image = src;
  putDraftSoon.flush();
  if (old && old !== src) dropImageIfUnused(old, d.id);
  saveSoon(reason);
  if (!majorSaveOn() && src) toast('Image added. Press Save to share it with the party.');
  redraw();
}

// ---------- create / delete ----------

function newQuestDialog(preset = {}) {
  let type = TYPES.some((t) => t.id === preset.type) ? preset.type : 'main';
  let parent = preset.parent || '';
  const mains = allQuests().filter((x) => x.type === 'main');
  const title = input({ placeholder: 'Quest title', 'aria-label': 'Quest title' });
  const vis = { hidden: preset.parent && isHidden(pathOf(preset.parent)) ? true : null }; // DM mode: hidden from players?
  const parentBox = h('div');
  const cards = h('div', { class: 'qs-type-cards', role: 'radiogroup', 'aria-label': 'Quest type' });
  const draw = () => {
    mount(cards, TYPES.map((t) => h('button', {
      class: ['qs-type-card', type === t.id && 'is-active'], type: 'button', role: 'radio', 'aria-checked': String(type === t.id),
      onclick: () => { type = t.id; draw(); },
    }, typeIcon(t.id), h('span', { class: 'qs-type-card-name' }, t.label), h('span', { class: 'qs-type-card-hint' }, t.hint))));
    mount(parentBox, type === 'minor' ? field('Leads to (main quest)', select(
      [{ value: '', label: mains.length ? '— not tied to a main quest —' : '— no main quest yet —' }, ...mains.map((m) => ({ value: m.id, label: m.title }))],
      parent, (v) => { parent = v; })) : null);
  };
  draw();
  const create = () => {
    const name = title.value.trim();
    const id = uid(name || `${type}-quest`);
    putQuest(newQuest({ id, title: name, type, parent: type === 'minor' ? parent || null : null, by: getSetting('playerName') || '' }), { hidden: vis.hidden ?? null });
    saveSoon(`quests: new ${type} quest “${name || 'Untitled quest'}”`);
    S.q = '';
    if (S.searchEl) S.searchEl.value = '';
    if (S.ui.view === 'done') setUi({ view: 'active' });
    navigate(href(VIEW, id, 'edit'));
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.close(); create(); } });
  const m = openModal({
    title: 'New quest',
    body: h('div', { class: 'stack' }, hiddenChoice(vis), field('Type', cards), field('Title', title), parentBox),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create quest', kind: 'primary', onClick: create }],
  });
  requestAnimationFrame(() => title.focus());
}

async function deleteQuest(d) {
  const steps = d.type === 'main' ? stepsOf(allQuests(), d.id) : [];
  const ok = await confirmDialog(`Delete “${d.title}”?${steps.length ? ` Its ${plural(steps.length, 'minor quest')} stay in the log, no longer tied to a main quest.` : ''}`,
    { title: 'Delete quest?', okLabel: 'Delete', danger: true });
  if (!ok) return;
  putDraftSoon.flush();
  const image = questById(d.id)?.image || d.image;
  store.remove(pathOf(d.id));
  if (image) dropImageIfUnused(image, d.id);
  saveSoon(`quests: delete “${d.title}”`);
  S.draft = null;
  toast(`Deleted “${d.title}”.`);
  navigate(href(VIEW));
}

// ---------- store events ----------

function onStoreEvent(ev) {
  const paths = ev.path ? [ev.path] : ev.paths || [];
  if (!(ev.type === 'load' || paths.some((p) => p.startsWith(`${QUEST_DIR}/`)))) return;
  if (S.queued) return;
  S.queued = true;
  queueMicrotask(() => {
    S.queued = false;
    if (!S.root || !S.root.isConnected) return;
    renderLog();
    if (!S.editing) renderPane();
  });
}

// ---------- view ----------

export default {
  id: VIEW,
  title: 'Quests',
  icon: 'quests',
  mount(el) {
    build(el);
    store.on(onStoreEvent);
    onDmMode(() => onStoreEvent({ type: 'load' })); // DM mode on / off: switches and lock marks
  },
  show(route) {
    const [id = null, sub = null] = route?.parts || [];
    if (!id && route?.query?.new) { navigate(href(VIEW), { replace: true }); queueMicrotask(() => newQuestDialog()); return; } // DM Screen "New quest"
    if (S.editing && S.draft && (S.draft.id !== id || sub !== 'edit')) putDraftSoon.flush();
    if (id !== S.id) { clearTimeout(S.leaveTimer); S.leaving = null; S.gone = null; } // the old open quest is no longer kept
    S.id = id;
    S.editing = !!id && sub === 'edit';
    if (!S.editing) S.draft = null;
    render();
    const q = id ? questById(id) : null;
    if (q) document.title = `${q.title} · Quests · The Stone Wardens`;
    S.root?.closest('.view')?.scrollTo?.({ top: 0 });
  },
  hide() {
    putDraftSoon.flush();
  },
};
