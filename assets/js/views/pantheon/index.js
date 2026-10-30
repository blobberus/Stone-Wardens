// Pantheon tab (#/pantheon[/<file>]; docs/pantheon-model.md): the gods of the campaign drawn from three polygons.
//   Roster (left): saved beings by rank (Absolute God → Angel), saved / possible counts, search.
//   Diagram (middle): the Material square, Mental hexagon and Temporal square (diagram.js). Clicking points builds a
//     combination; its rank is worked out from the points (model.js classify) and the panel shows the being that holds
//     it, "Unassigned" with a Create button, or why it isn't a being yet. Original shapes | Individual sigil, and the
//     24 possible Major God lines on request.
//   Panel (right): the open being (aspects, rank, title, domains, description, worship, the chain it is made of), or
//     the editor (rank guide, aspect selectors, the four writing fields; Save entry). One being per combination: a
//     taken combination is explained, never overwritten. Unsaved editor changes are asked about before leaving them
//     and kept on this device (localStorage) until saved or discarded.
// Each being is content/pantheon/<file>.json (anyone may add and edit; DM mode can hide one). [[pantheon:Title]]
// links here. ⋯ exports the pantheon (JSON v4), the roster (Markdown) and the diagram (SVG / PNG), and imports JSON.
import { h, mount } from '../../core/dom.js';
import { icon, toast, openModal, confirmDialog, choiceDialog, field, input, textarea, markdownEditor } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { navigate, href, current } from '../../core/router.js';
import { registerLinkType, matchNames } from '../../core/links.js';
import { renderInto } from '../../core/markdown.js';
import { getSetting } from '../../core/settings.js';
import { saveSoon, saveHint } from '../../core/saving.js';
import { uid, debounce, fmtDate } from '../../core/util.js';
import { registerHideable, onDmMode } from '../../core/dm.js';
import { visibilityToggle, hiddenChoice, hiddenMark } from '../../core/dm-ui.js';
import { openMenu } from '../journal/menu.js';
import * as M from './model.js';
import { drawDiagram, rankGlyph, svgText, pngBlob, SCREEN, W } from './diagram.js';

const VIEW = 'pantheon';
const UI_KEY = 'sw:pantheon:ui'; // per device: {view: 'original' | 'sigil', majorLines}
const DRAFT_KEY = 'sw:pantheon:draft'; // the open editor, until it is saved or discarded

const S = {
  root: null, rosterEl: null, searchEl: null, countEl: null, diagramEl: null, toolsEl: null, pickedEl: null, panelEl: null,
  sel: [], // aspects picked on the diagram, in the order they were picked
  file: null, // the open being
  q: '',
  ui: loadUi(),
  ed: null, // the editor (openEditor)
  restored: false, // an editor draft came back from localStorage: the first show opens it
  labelSize: 24, queued: false, visible: false,
};

function loadUi() {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    return { view: v.view === 'sigil' ? 'sigil' : 'original', majorLines: !!v.majorLines };
  } catch { return { view: 'original', majorLines: false }; }
}
function setUi(patch) {
  S.ui = { ...S.ui, ...patch };
  try { localStorage.setItem(UI_KEY, JSON.stringify(S.ui)); } catch { /* private mode */ }
}

// ---------- data ----------

const pathOf = (file) => `${M.PANTHEON_DIR}/${file}.json`;
const fileOf = (path) => path.slice(M.PANTHEON_DIR.length + 1).replace(/\.json$/i, '');
const isBeingPath = (p) => p.startsWith(`${M.PANTHEON_DIR}/`) && p.endsWith('.json') && !p.slice(M.PANTHEON_DIR.length + 1).includes('/');
const allBeings = () => store.list(M.PANTHEON_DIR).filter((d) => isBeingPath(d.path)).map((d) => M.normalizeBeing(d.data, fileOf(d.path)));
const rankLabel = (rank) => M.rankOf(rank)?.label || 'Not a valid being';
const aRank = (rank) => `${/^[AEIOU]/.test(rankLabel(rank)) ? 'an' : 'a'} ${rankLabel(rank)}`; // "an Angel"
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const playerName = () => getSetting('playerName') || '';

registerHideable({
  prefix: `${M.PANTHEON_DIR}/`, label: 'Being', icon: 'pantheon', order: 40, accept: isBeingPath,
  describe: (path, data) => ({ title: M.normalizeBeing(data, fileOf(path)).title || 'Untitled being', href: href(VIEW, fileOf(path)) }),
});

registerLinkType('pantheon', {
  label: 'Pantheon',
  order: 47,
  resolve(target) {
    const b = M.findBeing(allBeings(), target);
    return b ? { href: href(VIEW, b.file), title: `${rankLabel(b.rank)}: ${b.title}`, exists: true } : null;
  },
  suggest(term) {
    return matchNames(allBeings().filter((b) => b.title), term, (b) => b.title, 8).map((b) => ({ label: `${b.title} · ${rankLabel(b.rank)}`, value: b.title }));
  },
});

// ---------- layout ----------

function build(el) {
  S.searchEl = h('input', {
    class: 'input', type: 'search', placeholder: 'Search the roster', 'aria-label': 'Search the roster',
    oninput: (e) => { S.q = e.target.value; renderRoster(); },
  });
  S.countEl = h('p', { class: 'pt-count' });
  S.rosterEl = h('div', { class: 'pt-ranks' });
  S.toolsEl = h('div', { class: 'pt-tools' });
  S.diagramEl = h('div', { class: 'pt-diagram' });
  S.pickedEl = h('div', { class: 'pt-picked', 'aria-live': 'polite' });
  S.panelEl = h('section', { class: 'panel pt-panel', 'aria-label': 'Being' });
  const more = h('button', {
    class: 'btn btn-icon', type: 'button', title: 'Import and export', 'aria-label': 'Import and export', 'aria-haspopup': 'menu',
    onclick: (e) => openMenu({ anchor: e.currentTarget, align: 'end', label: 'Import and export', items: [
      { label: 'Import pantheon JSON…', icon: 'upload', onClick: importJson },
      { sep: true },
      { label: 'Export pantheon JSON', icon: 'download', onClick: exportJson },
      { label: 'Export roster Markdown', icon: 'download', onClick: exportMarkdown },
      { label: `Export ${S.ui.view === 'sigil' ? 'sigil' : 'diagram'} SVG`, icon: 'image', onClick: () => exportPicture('svg') },
      { label: `Export ${S.ui.view === 'sigil' ? 'sigil' : 'diagram'} PNG`, icon: 'image', onClick: () => exportPicture('png') },
    ] }),
  }, icon('more'));
  S.root = h('div', { class: 'pt' },
    h('header', { class: 'view-head pt-head' },
      h('h1', { class: 'view-title' }, 'Pantheon'),
      h('p', { class: 'view-sub' }, 'Every god is a combination of aspects: one Temporal, up to two Mental and up to two Material. The combination sets its rank.'),
      h('div', { class: 'view-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addBeing() }, icon('plus'), 'Add custom being'),
        more)),
    h('div', { class: 'pt-body' },
      h('aside', { class: 'panel pt-roster', 'aria-label': 'Roster' },
        h('header', { class: 'pt-roster-head' },
          h('h2', { class: 'pt-roster-title' }, icon('pantheon'), 'Roster'),
          S.countEl,
          h('label', { class: 'search pt-search' }, icon('search'), S.searchEl)),
        S.rosterEl),
      h('section', { class: 'pt-stage', 'aria-label': 'Diagram' },
        S.toolsEl, S.diagramEl, S.pickedEl,
        h('p', { class: 'pt-legend', 'aria-label': 'The three polygons' },
          ...M.GROUPS.map((g) => h('span', { class: `pt-legend-item pt-${g.id}` }, h('span', { class: 'pt-swatch', 'aria-hidden': 'true' }), h('strong', null, g.label), ` ${g.id === 'mental' ? 'hexagon' : g.id === 'material' ? 'outer square' : 'inner square'}`)))),
      S.panelEl));
  el.append(S.root);
  // points and Major lines (event delegation: the drawing is replaced on every change)
  S.diagramEl.addEventListener('click', (e) => {
    const p = e.target.closest('[data-aspect]');
    if (p && S.ui.view === 'original') { onPoint(p.dataset.aspect); return; }
    const l = e.target.closest('[data-combo]');
    if (l) onCombo(l.dataset.combo);
  });
  S.diagramEl.addEventListener('keydown', (e) => {
    const p = e.target.closest('[data-aspect]');
    if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPoint(p.dataset.aspect); }
  });
  // labels stay readable on small screens: bigger in the drawing's units as it shrinks
  new ResizeObserver(() => {
    const w = S.diagramEl.clientWidth;
    if (!w) return;
    const size = Math.round(Math.min(40, Math.max(22, (13 * W) / w))); // about 13 px on screen
    if (size !== S.labelSize) { S.labelSize = size; drawStage(); }
  }).observe(S.diagramEl);
}

function render() {
  if (!S.root) return;
  renderRoster();
  drawStage();
  renderPanel();
}

/** The aspects on the diagram: the editor's while it is open, else the ones picked. */
const shownAspects = () => (S.ed ? M.slotAspects(S.ed.slots, S.ed.guide) : S.sel);

// ---------- roster (left) ----------

function renderRoster() {
  const all = allBeings();
  const groups = M.roster(all);
  const q = S.q.trim().toLowerCase();
  const passes = (b) => !q || b.title.toLowerCase().includes(q) || b.domains.some((d) => d.toLowerCase().includes(q)) || M.aspectNames(b.aspects).toLowerCase().includes(q);
  const saved = all.filter((b) => !b.invalid).length;
  S.countEl.textContent = `${plural(saved, 'custom entry', 'custom entries')} saved · ${M.POSSIBLE} possible combinations`;
  if (!all.length) {
    mount(S.rosterEl, h('div', { class: 'pt-roster-empty' },
      h('p', null, 'No beings yet.'),
      h('p', { class: 'muted ui text-sm' }, 'Pick points on the diagram to explore the combinations, or add a being of any rank.'),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => addBeing() }, icon('plus'), 'Add custom being'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => loadExamples() }, 'Start with the guide’s five examples')));
    return;
  }
  let shown = 0;
  const sections = groups.map((g) => {
    const list = g.beings.filter(passes);
    shown += list.length;
    if (q && !list.length) return null;
    const key = g.rank?.id || 'invalid';
    return h('section', { class: ['pt-rank', `pt-rank-${key}`] },
      h('h3', { class: 'pt-rank-head' },
        h('span', { class: 'pt-rank-sym' }, rankGlyph(g.rank?.id || null)),
        h('span', null, g.rank ? g.rank.plural : 'Need new aspects'),
        g.rank ? h('span', { class: 'pt-n num', title: `${g.beings.length} saved of ${g.rank.possible} possible` }, `${g.beings.length} / ${g.rank.possible}`) : null),
      list.length ? h('ul', { class: 'pt-items', role: 'list' }, list.map((b) => h('li', null, h('a', {
        class: ['pt-item', b.file === S.file && 'is-current'], href: href(VIEW, b.file), 'aria-current': b.file === S.file ? 'page' : null,
      },
      h('span', { class: 'pt-item-title' }, b.title || 'Untitled being'),
      hiddenMark(pathOf(b.file)),
      b.twin ? h('span', { class: 'pt-item-warn', title: 'Another being has the same aspects' }, icon('warning')) : null,
      h('span', { class: 'pt-item-asp' }, M.aspectAbbrs(b.aspects) || '—'))))) : h('p', { class: 'pt-rank-empty' }, 'None yet.'));
  });
  mount(S.rosterEl, sections, q && !shown ? h('p', { class: 'muted ui text-sm pt-none' }, `Nothing matches “${S.q.trim()}”.`) : null);
}

// ---------- diagram (middle) ----------

function drawStage() {
  if (!S.diagramEl) return;
  const aspects = shownAspects();
  const all = allBeings();
  const occ = M.occupants(all);
  const original = S.ui.view === 'original';
  const focused = S.diagramEl.contains(document.activeElement) ? document.activeElement.closest?.('[data-aspect]')?.dataset.aspect : null;
  mount(S.diagramEl, drawDiagram({
    view: S.ui.view, selection: aspects, occupants: occ, majorLines: original && S.ui.majorLines, palette: SCREEN,
    labelSize: S.labelSize, interactive: original,
  }));
  if (focused) S.diagramEl.querySelector(`[data-aspect="${focused}"]`)?.focus();
  // tools: view, Major lines, clear
  const seg = (id, label) => h('button', {
    class: ['pt-seg-btn', S.ui.view === id && 'is-on'], type: 'button', role: 'radio', 'aria-checked': String(S.ui.view === id),
    onclick: () => { setUi({ view: id }); drawStage(); },
  }, label);
  const majors = M.catalog().filter((c) => c.rank === 'major');
  const assigned = majors.filter((c) => occ.has(c.id)).length;
  mount(S.toolsEl,
    h('div', { class: 'pt-seg', role: 'radiogroup', 'aria-label': 'Diagram view' }, seg('original', 'Original shapes'), seg('sigil', 'Individual sigil')),
    h('button', {
      class: ['btn', 'btn-sm', 'pt-majors-btn', S.ui.majorLines && 'is-active'], type: 'button', 'aria-pressed': String(S.ui.majorLines), disabled: !original,
      title: 'Show all 24 possible Major God lines (Temporal to Mental); assigned ones are solid',
      onclick: () => { setUi({ majorLines: !S.ui.majorLines }); drawStage(); },
    }, rankGlyph('major'), `Major lines · ${assigned} of 24 assigned`),
    h('button', {
      class: 'btn btn-sm btn-ghost', type: 'button', disabled: !!S.ed || !S.sel.length, title: 'Clear the picked points (Esc)',
      onclick: deselect,
    }, icon('close'), 'Clear'));
  // what is picked: chips (a click drops one) and the rank they make
  const c = M.classify(aspects);
  const o = c.ok ? occ.get(c.id) : null;
  mount(S.pickedEl, aspects.length
    ? [h('span', { class: 'pt-picked-label' }, S.ed ? 'Editing:' : 'Picked:'),
      ...M.ordered(aspects).map((id) => h('button', {
        class: `chip pt-chip pt-${M.node(id).group}`, type: 'button', title: `Remove ${M.node(id).name}`, disabled: S.ui.view !== 'original',
        onclick: () => onPoint(id),
      }, M.node(id).name, h('span', { class: 'chip-x', 'aria-hidden': 'true' }, icon('close')))),
      h('span', { class: ['pt-picked-rank', !c.ok && 'is-invalid'] }, '→ ', c.ok ? [rankGlyph(c.rank), ` ${rankLabel(c.rank)}${o ? ` · ${o.title}` : ' · unassigned'}`] : 'not a being yet')]
    : h('span', { class: 'muted' }, S.ui.view === 'original' ? 'Click a Temporal point (the inner square) to begin, then Mental and Material ones.' : 'Open a being, or pick its points in Original shapes, to see its sigil.'));
}

/** A point clicked (or Enter on it): the editor's aspects while editing, else the explored combination. */
function onPoint(id) {
  if (S.ed) {
    const next = M.pick(M.slotAspects(S.ed.slots, S.ed.guide), id);
    S.ed.slots = M.slotsOf(next);
    const c = M.classify(next);
    S.ed.guide = c.ok ? c.rank : M.stageFor(S.ed.slots);
    edChanged({ aspects: true });
    return;
  }
  S.sel = M.pick(S.sel, id);
  followSelection();
}
/** A Major line clicked: that Temporal + Mental pair. */
function onCombo(id) {
  const aspects = M.aspectsOf(id);
  if (S.ed) {
    S.ed.slots = M.slotsOf(aspects);
    S.ed.guide = 'major';
    edChanged({ aspects: true });
    return;
  }
  S.sel = M.ordered(aspects);
  followSelection();
}
/** The picked points changed: open the being that holds them, if any (the address follows). */
function followSelection() {
  const c = M.classify(S.sel);
  const o = c.ok ? M.occupants(allBeings()).get(c.id) : null;
  setFile(o ? o.file : null);
  render();
}
/** Let go of the open being and the picked points (Clear, Esc). */
function deselect() {
  S.sel = [];
  setFile(null);
  render();
}
function setFile(file) {
  S.file = file;
  const want = file ? href(VIEW, file) : href(VIEW);
  const now = current();
  if (now.view === VIEW && (now.parts[0] || null) === file) return;
  navigate(want, { replace: true });
}

// ---------- panel (right) ----------

function renderPanel() {
  if (!S.panelEl) return;
  if (S.ed) { if (!S.ed.el?.isConnected) mount(S.panelEl, editorView()); return; }
  const all = allBeings();
  const occ = M.occupants(all);
  let b = S.file ? all.find((x) => x.file === S.file) : null;
  if (S.file && !b) S.file = null; // deleted elsewhere
  if (!b && S.sel.length) {
    const c = M.classify(S.sel);
    if (!c.ok) { mount(S.panelEl, invalidView(c)); return; }
    b = occ.get(c.id) || null;
    if (!b) { mount(S.panelEl, comboView(c, all, occ)); return; }
    setFile(b.file); // made elsewhere meanwhile: the address follows
  }
  if (!b) { mount(S.panelEl, introView(all)); return; }
  mount(S.panelEl, beingView(b, all, occ));
  document.title = `${b.title || 'Untitled being'} · Pantheon · The Stone Wardens`;
}

const rankBadge = (rank) => h('span', { class: ['badge', 'pt-rank-badge', rank ? `is-${rank}` : 'is-invalid'] }, rankGlyph(rank), rankLabel(rank));
const aspectChips = (aspects) => h('ul', { class: 'pt-asp-list', role: 'list', 'aria-label': 'Aspects' },
  M.ordered(aspects).map((id) => h('li', { class: `pt-asp pt-${M.node(id).group}` }, h('span', { class: 'pt-swatch', 'aria-hidden': 'true' }), h('span', null, M.node(id).name), h('span', { class: 'pt-asp-group' }, M.groupOf(id).label))));
const meaningOf = (aspects) => {
  const t = aspects.find((id) => M.node(id)?.group === 'temporal');
  return t && M.MEANINGS[t] ? h('p', { class: 'pt-meaning' }, h('strong', null, `${M.node(t).name}: `), M.MEANINGS[t]) : null;
};
function prose(src, empty) {
  if (!String(src || '').trim()) return h('p', { class: 'muted pt-empty-field' }, empty);
  const el = h('div', { class: 'prose pt-prose' });
  renderInto(el, src);
  return el;
}

function introView(all) {
  const occ = M.occupants(all);
  const counts = new Map(M.RANKS.map((r) => [r.id, [...occ.values()].filter((b) => b.rank === r.id).length]));
  const recipe = (r) => [`1 Temporal`, r.need.mental && `${r.need.mental} Mental`, r.need.material && `${r.need.material} Material`].filter(Boolean).join(' + ');
  return h('div', { class: 'pt-intro' },
    h('h2', { class: 'pt-panel-title' }, 'The god chain'),
    h('p', null, 'A being’s aspects are points on the diagram. Exactly one is Temporal; the number of Mental and Material points sets its rank, from Absolute God down to Angel. Pick points to explore, or add a being at any rank.'),
    h('table', { class: 'table pt-ranks-table' },
      h('thead', null, h('tr', null, h('th', null, 'Rank'), h('th', null, 'Aspects'), h('th', { class: 'num' }, 'Saved'))),
      h('tbody', null, M.RANKS.map((r) => h('tr', null,
        h('td', null, h('span', { class: 'pt-rank-cell' }, rankGlyph(r.id), r.label)),
        h('td', null, recipe(r)),
        h('td', { class: 'num' }, `${counts.get(r.id)} / ${r.possible}`)))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, 'Possible beings'), h('td', { class: 'num' }, `${occ.size} / ${M.POSSIBLE}`)))),
    h('div', { class: 'row pt-intro-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addBeing() }, icon('plus'), 'Add custom being'),
      !all.length ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => loadExamples() }, 'Start with the guide’s five examples') : null));
}

function invalidView(c) {
  return h('div', { class: 'pt-combo is-invalid' },
    rankBadge(null),
    h('h2', { class: 'pt-panel-title' }, 'Not a being yet'),
    aspectChips(S.sel),
    h('p', { class: 'pt-reason' }, c.reason),
    h('p', { class: 'muted ui text-sm' }, 'Absolute God: 1 Temporal · Major: + 1 Mental · Minor: + 2 Mental · Lesser: + 1 Material · Angel: + 2 Material. Click a picked point again to drop it.'),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: deselect }, icon('close'), 'Clear')));
}

function comboView(c, all, occ) {
  return h('div', { class: 'pt-combo' },
    rankBadge(c.rank),
    h('h2', { class: 'pt-panel-title' }, 'Unassigned'),
    h('p', { class: 'muted' }, `A possible ${rankLabel(c.rank)} with no entry yet.`),
    aspectChips(c.aspects),
    meaningOf(c.aspects),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addBeing(c.aspects) }, icon('plus'), `Create this ${rankLabel(c.rank)}`)),
    chainView(c.aspects, all, occ));
}

function beingView(b, all, occ) {
  const path = pathOf(b.file);
  const twins = all.filter((x) => x.file !== b.file && !x.invalid && !b.invalid && x.id === b.id);
  const copyLink = async () => {
    const text = `[[pantheon:${b.title}]]`;
    try { await navigator.clipboard.writeText(text); toast(`Copied ${text}`); } catch { toast(text, { timeout: 8000 }); }
  };
  return h('article', { class: 'pt-being' },
    h('div', { class: 'pt-being-top' }, rankBadge(b.rank), hiddenMark(path)),
    h('h2', { class: 'pt-being-title' }, b.title || 'Untitled being'),
    aspectChips(b.aspects),
    h('div', { class: 'row pt-being-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditor(b) }, icon('edit'), 'Edit'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: `Copy a link to paste in a note: [[pantheon:${b.title}]]`, onclick: copyLink }, icon('link'), 'Copy link'),
      visibilityToggle(path, { label: 'this being' }),
      h('button', { class: 'btn btn-sm btn-ghost btn-danger pt-delete', type: 'button', onclick: () => deleteBeing(b) }, icon('trash'), 'Delete')),
    b.invalid ? h('p', { class: 'pt-reason' }, `These aspects don’t make a being: ${b.invalid} Edit it to choose valid ones.`) : null,
    twins.length ? h('p', { class: 'pt-reason' }, 'Another being has the same aspects: ',
      twins.map((t, i) => [i ? ', ' : '', h('a', { href: href(VIEW, t.file) }, t.title || 'Untitled being')]),
      '. Each combination holds one being: change the aspects of one of them, or delete one.') : null,
    meaningOf(b.aspects),
    h('h3', { class: 'pt-h' }, 'Domains'),
    b.domains.length ? h('ul', { class: 'pt-domains', role: 'list' }, b.domains.map((d) => h('li', { class: 'chip pt-domain' }, d))) : h('p', { class: 'muted pt-empty-field' }, 'No domains yet.'),
    h('h3', { class: 'pt-h' }, 'Description'),
    prose(b.description, 'No description yet: who they are, how they appear, their history and purpose.'),
    h('h3', { class: 'pt-h' }, 'Worship'),
    prose(b.worship, 'Nothing about worship yet: followers, practices, offerings, holy days, temples, taboos, rites.'),
    b.invalid ? null : chainView(b.aspects, all, occ),
    h('p', { class: 'pt-meta muted ui text-xs' }, [b.by ? `Added by ${b.by}` : null, b.updated ? `changed ${fmtDate(b.updated)}` : null].filter(Boolean).join(' · ')));
}

/** The beings this combination is made of (lower ranks) and the saved ones it is part of (higher ranks). */
function chainView(aspects, all, occ) {
  const parts = M.constituents(aspects);
  const up = M.containers(aspects);
  const holders = up.map((c) => occ.get(c.id)).filter(Boolean);
  const row = (c) => {
    const o = occ.get(c.id);
    return h('li', { class: 'pt-chain-row' },
      h('span', { class: 'pt-chain-sym', title: rankLabel(c.rank) }, rankGlyph(c.rank)),
      o ? h('a', { class: 'pt-chain-name', href: href(VIEW, o.file) }, o.title || 'Untitled being') : h('span', { class: 'pt-chain-name is-open' }, 'Unassigned'),
      h('span', { class: 'pt-chain-asp' }, M.aspectNames(c.aspects)),
      o ? null : h('button', { class: 'btn btn-sm btn-ghost pt-chain-add', type: 'button', title: `Create this ${rankLabel(c.rank)}`, onclick: () => addBeing(c.aspects) }, icon('plus'), 'Create'));
  };
  const byRank = M.RANKS.map((r) => ({ r, list: parts.filter((c) => c.rank === r.id) })).filter((x) => x.list.length);
  if (!byRank.length && !up.length) return null;
  return h('section', { class: 'pt-chain', 'aria-label': 'In the chain' },
    h('h3', { class: 'pt-h' }, 'In the chain'),
    byRank.length ? [h('p', { class: 'pt-chain-lead' }, 'Made of these lower combinations:'),
      byRank.map(({ r, list }) => h('div', { class: 'pt-chain-group' }, h('h4', { class: 'pt-chain-head' }, r.plural), h('ul', { class: 'pt-chain-list', role: 'list' }, list.map(row))))] : null,
    up.length ? h('p', { class: 'pt-chain-lead' }, `Part of ${up.length} higher combinations${holders.length ? `; ${plural(holders.length, 'has', 'have')} an entry:` : ', none with an entry yet.'}`) : null,
    holders.length ? h('ul', { class: 'pt-chain-list', role: 'list' }, holders.map((o) => h('li', { class: 'pt-chain-row' },
      h('span', { class: 'pt-chain-sym', title: rankLabel(o.rank) }, rankGlyph(o.rank)),
      h('a', { class: 'pt-chain-name', href: href(VIEW, o.file) }, o.title || 'Untitled being'),
      h('span', { class: 'pt-chain-asp' }, M.aspectNames(o.aspects))))) : null);
}

// ---------- the editor ----------

const snap = (ed) => JSON.stringify([M.slotAspects(ed.slots, ed.guide).sort(), ed.title.trim(), M.parseDomains(ed.domains), ed.description, ed.worship]);
const isDirty = () => !!S.ed && snap(S.ed) !== S.ed.base;
// only an editor with unsaved changes is kept (an untouched one has nothing to bring back)
const keepDraft = debounce(() => {
  if (!S.ed) return;
  const { el, statusEl, aspectsEl, titleEl, ...rest } = S.ed;
  try {
    if (isDirty()) localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...rest, at: Date.now() }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* full or private */ }
}, 300);
const dropDraft = () => { keepDraft.cancel?.(); try { localStorage.removeItem(DRAFT_KEY); } catch { /* private */ } };

/** Open the editor: a saved being, or a new one (preset: aspects to start from). */
function openEditor(being = null, preset = []) {
  const aspects = being ? being.aspects : M.ordered(preset);
  const slots = M.slotsOf(aspects);
  const c = M.classify(aspects);
  S.ed = {
    file: being?.file || null, guide: c.ok ? c.rank : aspects.length ? M.stageFor(slots) : 'absolute', slots,
    title: being?.title || '', domains: (being?.domains || []).join('\n'), description: being?.description || '', worship: being?.worship || '',
    vis: { hidden: null },
  };
  S.ed.base = snap(S.ed);
  if (being) S.file = being.file;
  render();
  requestAnimationFrame(() => S.ed?.titleEl?.focus({ preventScroll: true }));
  S.panelEl.scrollIntoView?.({ block: 'nearest' });
}

/** Add a being: the editor, empty or starting from these aspects (asks first if another edit is unsaved). */
async function addBeing(preset = null) {
  if (S.ed && !(await leaveEditor())) return;
  let start = preset;
  if (!start) {
    const c = M.classify(S.sel);
    start = c.ok && !M.occupants(allBeings()).has(c.id) ? c.aspects : [];
  }
  if (S.file) setFile(null);
  openEditor(null, start);
}

function closeEditor() {
  const file = S.ed?.file;
  S.ed = null;
  dropDraft();
  const b = file ? allBeings().find((x) => x.file === file) : null;
  if (b) S.sel = b.aspects;
  render();
}

/** Unsaved changes: Save, Discard or Keep editing. Resolves true when the editor may close (it is then closed). */
async function leaveEditor() {
  if (!S.ed) return true;
  if (!isDirty()) { closeEditor(); return true; }
  const name = S.ed.title.trim() || (S.ed.file ? 'This being' : 'The new being');
  const choice = await choiceDialog(`${name.startsWith('The new') || name === 'This being' ? name : `“${name}”`} has changes that are not saved.`, [
    { label: 'Keep editing', value: null, kind: 'ghost' },
    { label: 'Discard changes', value: 'discard', kind: 'danger' },
    { label: 'Save', value: 'save', kind: 'primary' },
  ], { title: 'Unsaved changes' });
  if (choice === 'discard') { closeEditor(); return true; }
  if (choice === 'save') return saveEditor();
  return false;
}

/** Something in the editor changed: keep the draft, refresh the status (and the aspects box and diagram). */
function edChanged({ aspects = false } = {}) {
  if (!S.ed) return;
  keepDraft();
  if (aspects) { drawAspects(); drawStage(); }
  if (S.ed.statusEl) S.ed.statusEl.textContent = isDirty() ? 'Unsaved changes' : S.ed.file ? 'No changes' : '';
}

function editorView() {
  const ed = S.ed;
  const title = input({ value: ed.title, maxlength: 200, placeholder: 'The being’s name, epithet or full ceremonial title', 'aria-required': 'true' });
  title.addEventListener('input', () => { ed.title = title.value; edChanged(); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveEditor(); } });
  const domains = textarea({ rows: 3, value: ed.domains, placeholder: 'One per line, e.g.\nBalance\nCorrection' });
  domains.addEventListener('input', () => { ed.domains = domains.value; edChanged(); });
  const writing = (key, placeholder) => {
    const box = markdownEditor({ value: ed[key], rows: 5, placeholder, onInput: (v) => { ed[key] = v; edChanged(); } });
    return box;
  };
  ed.titleEl = title;
  ed.aspectsEl = h('div', { class: 'pt-ed-aspects' });
  ed.statusEl = h('span', { class: 'pt-ed-status muted ui text-sm', 'aria-live': 'polite' });
  const existing = ed.file ? allBeings().find((x) => x.file === ed.file) : null;
  const wfield = (label, control, hint) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  ed.el = h('form', { class: 'pt-editor', onsubmit: (e) => { e.preventDefault(); saveEditor(); } },
    h('header', { class: 'pt-ed-head' },
      h('h2', { class: 'pt-panel-title' }, ed.file ? `Edit “${existing?.title || ed.title || 'Untitled being'}”` : 'New being'),
      ed.file ? visibilityToggle(pathOf(ed.file), { label: 'this being' }) : hiddenChoice(ed.vis)),
    ed.aspectsEl,
    field('Title', title),
    field('Domains', domains, 'Your own portfolios (they need not be cleric domains). One per line, in the order you want them shown.'),
    wfield('Description', writing('description', 'Identity, appearance, personality, history, purpose, relationships…')),
    wfield('Worship', writing('worship', 'Followers, practices, offerings, holy days, temples, taboos, rituals… (an Angel may be invoked through a god instead)')),
    h('footer', { class: 'pt-ed-foot' },
      ed.statusEl,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => cancelEditor() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('save'), 'Save entry')));
  drawAspects();
  edChanged();
  return ed.el;
}

/** The rank guide, the aspect selectors it shows and the rank the chosen points make (read-only). */
function drawAspects() {
  const ed = S.ed;
  if (!ed?.aspectsEl) return;
  const shown = M.slotsFor(ed.guide);
  const aspects = M.slotAspects(ed.slots, ed.guide);
  const c = M.classify(aspects);
  const missing = shown.filter((s) => !ed.slots[s.key]).map((s) => s.label);
  const occ = c.ok ? M.occupants(allBeings()).get(c.id) : null;
  const taken = occ && occ.file !== ed.file ? occ : null;
  const guide = h('div', { class: 'pt-guide', role: 'radiogroup', 'aria-label': 'Rank to build' },
    M.RANKS.map((r) => h('button', {
      class: ['pt-guide-btn', ed.guide === r.id && 'is-on'], type: 'button', role: 'radio', 'aria-checked': String(ed.guide === r.id),
      onclick: () => { ed.guide = r.id; edChanged({ aspects: true }); },
    }, rankGlyph(r.id), h('span', null, r.label))));
  const selects = shown.map((s) => {
    const pair = s.pair ? ed.slots[s.pair] : '';
    const opts = M.NODES.filter((n) => n.group === s.group);
    const sel = h('select', {
      class: 'select', 'aria-label': s.label,
      onchange: (e) => { ed.slots = { ...ed.slots, [s.key]: e.target.value }; edChanged({ aspects: true }); },
    },
    h('option', { value: '', selected: !ed.slots[s.key] }, 'Choose…'),
    opts.map((n) => h('option', { value: n.id, selected: ed.slots[s.key] === n.id, disabled: shown.some((x) => x.key === s.pair) && pair === n.id }, n.name)));
    return h('label', { class: `field pt-slot pt-${s.group}` }, h('span', { class: 'field-label' }, h('span', { class: 'pt-swatch', 'aria-hidden': 'true' }), s.label), sel);
  });
  const outcome = c.ok
    ? h('div', { class: 'pt-outcome' }, h('span', { class: 'pt-outcome-label' }, 'Rank'), rankBadge(c.rank),
      c.rank !== ed.guide && missing.length ? h('span', { class: 'muted ui text-sm' }, `Choose ${missing.join(' and ')} for ${aRank(ed.guide)}.`) : null)
    : h('div', { class: 'pt-outcome is-invalid' }, h('span', { class: 'pt-outcome-label' }, 'Rank'),
      h('span', { class: 'pt-outcome-why' }, missing.length && aspects.length === 0 ? 'Choose a Temporal aspect first.' : c.reason));
  mount(ed.aspectsEl,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rank to build'), guide,
      h('span', { class: 'field-hint' }, 'A guide to which aspects to choose; the rank itself always follows the aspects. You can also click points on the diagram.')),
    h('div', { class: 'pt-slots' }, selects),
    outcome,
    taken ? h('p', { class: 'pt-reason' }, `${M.aspectNames(c.aspects)} is already “${taken.title}”. Choose other aspects, or open that being: Save will ask.`) : null,
    meaningOf(aspects));
}

async function cancelEditor() {
  if (isDirty() && !(await confirmDialog('Drop the changes made here?', { title: 'Discard changes?', okLabel: 'Discard', danger: true }))) return;
  const wasNew = !S.ed?.file;
  closeEditor();
  if (wasNew) followSelection();
}

/** Save entry: a valid combination and a title, not taken by another being. Resolves true once saved. */
async function saveEditor() {
  const ed = S.ed;
  if (!ed) return true;
  const aspects = M.slotAspects(ed.slots, ed.guide);
  const c = M.classify(aspects);
  if (!c.ok) { toast(c.reason, { type: 'error', timeout: 6000 }); return false; }
  const title = ed.title.trim();
  if (!title) { toast('Give the being a title to save it.', { type: 'error' }); ed.titleEl?.focus(); return false; }
  const all = allBeings();
  const taken = all.find((b) => !b.invalid && b.id === c.id && b.file !== ed.file);
  if (taken) {
    const choice = await choiceDialog(h('div', { class: 'stack' },
      h('p', null, `${M.aspectNames(c.aspects)} is already “${taken.title}”, ${aRank(c.rank)}.`),
      h('p', { class: 'muted' }, 'Each combination holds one being, so nothing was overwritten. Choose other aspects, or open the being that is there (the changes made here are then dropped).')), [
      { label: 'Keep editing', value: null, kind: 'ghost' },
      { label: `Open “${taken.title}”`, value: 'open', kind: 'primary' },
    ], { title: 'That combination is taken' });
    if (choice === 'open') {
      S.ed = null;
      dropDraft();
      S.sel = taken.aspects;
      setFile(taken.file);
      render();
    }
    return false;
  }
  const isNew = !ed.file;
  const file = ed.file || uid(title);
  const prev = isNew ? null : store.get(pathOf(file));
  const doc = M.beingDoc({
    aspects: c.aspects, title, domains: ed.domains, description: ed.description, worship: ed.worship,
    by: prev?.by || playerName(), created: prev?.created,
  });
  try {
    store.put(pathOf(file), doc, { hidden: isNew ? ed.vis.hidden ?? null : null });
  } catch (err) {
    toast(`Could not save it: ${err.message || err}. Your writing is still in the editor.`, { type: 'error' });
    return false;
  }
  saveSoon(`pantheon: ${isNew ? 'new' : 'edit'} “${title}”`);
  S.ed = null;
  dropDraft();
  S.sel = c.aspects;
  setFile(file);
  render();
  toast(`Saved “${title}”, ${rankLabel(c.rank)}. ${saveHint()}`.trim(), { type: 'success' });
  return true;
}

async function deleteBeing(b) {
  const ok = await confirmDialog(`Delete “${b.title || 'Untitled being'}”? Its lore is removed and ${b.invalid ? 'the entry is gone' : `${M.aspectNames(b.aspects)} becomes unassigned again`}. The diagram and the possible combinations stay as they are.`,
    { title: 'Delete being?', okLabel: 'Delete', danger: true });
  if (!ok) return;
  store.remove(pathOf(b.file));
  saveSoon(`pantheon: delete “${b.title}”`);
  toast(`Deleted “${b.title || 'Untitled being'}”.`);
  S.sel = b.invalid ? [] : b.aspects;
  setFile(null);
  render();
}

// ---------- examples, import, export ----------

function writeBeings(list, { hidden = null } = {}) {
  for (const b of list) {
    store.put(pathOf(uid(b.title)), M.beingDoc({ ...b, by: playerName() }), { hidden });
  }
}

async function loadExamples() {
  if (allBeings().length) return;
  writeBeings(M.EXAMPLES);
  saveSoon('pantheon: the guide’s five examples');
  toast('Added the guide’s five examples, one per rank. Edit or delete them as you like.', { type: 'success' });
  S.sel = M.EXAMPLES[3].aspects.slice();
  followSelection();
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function exportJson() {
  const doc = M.exportDoc(allBeings(), { view: S.ui.view, majorLines: S.ui.majorLines });
  download('pantheon.json', new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' }));
  toast(`Exported ${plural(doc.gods.length, 'being')} as pantheon.json.`);
}

function exportMarkdown() {
  const all = allBeings().filter((b) => !b.invalid);
  if (!all.length) { toast('The roster is empty: add a being first.'); return; }
  download('pantheon-roster.md', new Blob([M.rosterMarkdown(all)], { type: 'text/markdown' }));
  toast(`Exported ${plural(all.length, 'being')} as pantheon-roster.md.`);
}

async function exportPicture(kind) {
  const aspects = shownAspects();
  const c = M.classify(aspects);
  const sigil = S.ui.view === 'sigil';
  if (sigil && !c.ok) { toast('Open a being, or pick a valid combination, to export its sigil.'); return; }
  const o = c.ok ? M.occupants(allBeings()).get(c.id) : null;
  const caption = c.ok ? [`${rankLabel(c.rank)}${o ? ` · ${o.title}` : ' · unassigned'}`, M.aspectNames(c.aspects)] : [];
  const text = await svgText({
    view: S.ui.view, selection: aspects, occupants: M.occupants(allBeings()), majorLines: !sigil && S.ui.majorLines,
    heading: sigil ? `Sigil${o ? ` of ${o.title}` : ''}` : 'The Pantheon', caption,
  });
  const name = sigil ? 'pantheon-sigil' : 'pantheon-diagram';
  if (kind === 'svg') { download(`${name}.svg`, new Blob([text], { type: 'image/svg+xml' })); return; }
  try {
    download(`${name}.png`, await pngBlob(text, 2000));
  } catch (err) {
    toast(`Could not make the PNG: ${err.message || err}`, { type: 'error' });
  }
}

function importJson() {
  const pick = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  pick.addEventListener('change', async () => {
    const f = pick.files?.[0];
    pick.remove();
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast(`“${f.name}” is too large for a pantheon file.`, { type: 'error' }); return; }
    let doc;
    try { doc = JSON.parse(await f.text()); } catch { toast(`“${f.name}” is not a JSON file. Nothing was imported.`, { type: 'error' }); return; }
    const r = M.parseImport(doc);
    if (!r.ok) {
      const more = r.errors.length - 25;
      openModal({
        title: 'Nothing was imported',
        body: h('div', { class: 'stack' },
          h('p', null, `“${f.name}” can’t be imported as it is, so the pantheon was left unchanged:`),
          h('ul', { class: 'pt-import-list' }, r.errors.slice(0, 25).map((e) => h('li', null, e)), more > 0 ? h('li', null, `… and ${more} more.`) : null),
          r.notes.length ? h('ul', { class: 'pt-import-list muted' }, r.notes.map((n) => h('li', null, n))) : null),
        actions: [{ label: 'Close', kind: 'primary' }],
      });
      return;
    }
    confirmImport(f.name, r);
  });
  document.body.append(pick);
  pick.click();
}

function confirmImport(name, r) {
  const all = allBeings();
  const occ = M.occupants(all);
  const clash = r.beings.filter((b) => occ.has(b.id));
  const fresh = r.beings.filter((b) => !occ.has(b.id));
  const vis = { hidden: null };
  const byRank = M.RANKS.map((rk) => [rk, r.beings.filter((b) => b.rank === rk.id).length]).filter(([, n]) => n).map(([rk, n]) => `${n} ${n === 1 ? rk.label : rk.plural}`).join(', ');
  const done = (list, how) => {
    writeBeings(list, { hidden: vis.hidden ?? null });
    saveSoon(`pantheon: import ${plural(list.length, 'being')}`);
    toast(`${how} ${plural(list.length, 'being')} from “${name}”.`, { type: 'success' });
    S.sel = [];
    setFile(null);
    render();
  };
  const actions = [{ label: 'Cancel', kind: 'ghost' }];
  if (all.length) {
    actions.push({
      label: 'Replace the whole pantheon', kind: 'danger',
      onClick: async () => {
        const ok = await confirmDialog(`Delete the ${plural(all.length, 'being')} here and put the ${r.beings.length} from the file in their place?`, { title: 'Replace the pantheon?', okLabel: 'Replace', danger: true });
        if (!ok) return;
        for (const b of all) store.remove(pathOf(b.file));
        done(r.beings, 'Replaced the pantheon with');
      },
    });
  }
  if (fresh.length) actions.push({ label: clash.length ? `Add the ${fresh.length} new` : `Add ${plural(fresh.length, 'being')}`, kind: 'primary', onClick: () => done(fresh, 'Imported') });
  openModal({
    title: 'Import pantheon',
    body: h('div', { class: 'stack' },
      h('p', null, `“${name}” holds ${plural(r.beings.length, 'being')}: ${byRank}.`),
      clash.length ? h('p', null, `${plural(clash.length, 'of them has', 'of them have')} the same aspects as a being already here (${clash.slice(0, 3).map((b) => `“${b.title}” = “${occ.get(b.id).title}”`).join(', ')}${clash.length > 3 ? ', …' : ''}). Adding keeps the ones here; replacing deletes the whole current pantheon first.`) : null,
      r.notes.length ? h('ul', { class: 'pt-import-list muted' }, r.notes.map((n) => h('li', null, n))) : null,
      hiddenChoice(vis)),
    actions,
  });
}

// ---------- store events ----------

function onStoreEvent(ev) {
  const paths = ev.path ? [ev.path] : ev.paths || [];
  if (!(ev.type === 'load' || ev.type === 'pulled' || paths.some((p) => p.startsWith(`${M.PANTHEON_DIR}/`)))) return;
  if (S.queued) return;
  S.queued = true;
  queueMicrotask(() => {
    S.queued = false;
    if (!S.root?.isConnected) return;
    renderRoster();
    drawStage();
    if (S.ed) drawAspects(); else renderPanel();
  });
}

function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d || typeof d !== 'object' || !d.slots) return;
  const slots = Object.fromEntries(M.SLOTS.map((s) => [s.key, M.node(d.slots[s.key])?.group === s.group ? d.slots[s.key] : '']));
  if (d.file && !store.get(pathOf(d.file))) { dropDraft(); return; } // the being is gone
  S.ed = {
    file: d.file || null, guide: M.rankOf(d.guide) ? d.guide : 'absolute', slots,
    title: String(d.title || ''), domains: String(d.domains || ''), description: String(d.description || ''), worship: String(d.worship || ''),
    vis: { hidden: d.vis?.hidden ?? null }, base: String(d.base || ''),
  };
  if (!isDirty()) { S.ed = null; dropDraft(); return; }
  if (S.ed.file) S.file = S.ed.file;
  S.restored = true;
  toast(`Your unsaved ${S.ed.file ? 'changes to a being are' : 'new being is'} back in the editor.`, { timeout: 6000 });
}

// ---------- keys ----------

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
/** Esc (not while typing, a dialog or a menu takes it first): out of the editor (asked first when it has changes), else
 * the open being or picked points are let go. */
function onKey(e) {
  if (e.key !== 'Escape' || !S.visible || e.defaultPrevented || isTyping(e.target) || document.querySelector('.modal-backdrop')) return;
  if (S.ed) { e.preventDefault(); cancelEditor(); return; }
  if (!S.sel.length && !S.file) return;
  e.preventDefault();
  deselect();
}

// ---------- view ----------

export default {
  id: VIEW,
  title: 'Pantheon',
  icon: 'pantheon',
  mount(el) {
    build(el);
    store.on(onStoreEvent);
    onDmMode(() => onStoreEvent({ type: 'load' }));
    document.addEventListener('keydown', onKey);
    restoreDraft();
  },
  show(route) {
    S.visible = true;
    const [file = null] = route?.parts || [];
    if (S.restored) { // back after a reload with an unsaved editor: show it, wherever the address pointed
      S.restored = false;
      if (S.ed) { if (file !== S.file) setFile(S.file); render(); return; }
    }
    if (file !== S.file) {
      // another being (the roster, a link, back / forward) or the bare tab: an unsaved edit is asked about first
      if (S.ed && isDirty()) {
        const target = file ? href(VIEW, file) : href(VIEW);
        navigate(S.file ? href(VIEW, S.file) : href(VIEW), { replace: true });
        leaveEditor().then((ok) => { if (ok) navigate(target); });
        render();
        return;
      }
      if (S.ed) { S.ed = null; dropDraft(); }
      S.file = file;
      const b = file ? allBeings().find((x) => x.file === file) : null;
      S.sel = b ? b.aspects.slice() : [];
    }
    render();
    if (!S.file) document.title = 'Pantheon · The Stone Wardens';
  },
  hide() {
    S.visible = false;
    keepDraft.flush?.();
  },
};
