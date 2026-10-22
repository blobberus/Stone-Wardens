// Characters tab: roster grid -> sheet; creation builder; edit-all menu; level up.
// Routes: #/characters · #/characters/new · #/characters/<id>[/<section>] · #/characters/<id>/edit[?s=section]
import { h } from '../../core/dom.js';
import { registerLinkType, matchNames } from '../../core/links.js';
import { href } from '../../core/router.js';
import { store } from '../../core/store.js';
import { fmtMod } from '../../core/util.js';
import {
  VIEW, DIR, ABILITIES, listCharacters, findCharacter, normalizeAnchor, isSelfWrite, idFromPath, flushPersist, totalLevel, mdSafe,
} from './data.js';
import { ready, isReady, derive, entryName } from './bridge.js';
import { renderRoster } from './roster.js';
import { showSheet, hideSheet, sheetExternalChange } from './sheet.js';
import { showBuilder } from './builder.js';
import { showEditor, hideEditor, editorExternalChange } from './editor.js';

let root = null;
let host = null;
let mode = null; // 'roster' | 'new' | 'sheet' | 'edit'
let currentId = null;

function isVisible() { return !!host && !host.hidden && host.isConnected; }

function show(route) {
  const [id, sub] = route.parts || [];
  const prevMode = mode;
  const prevId = currentId;
  if (prevMode === 'sheet' && (id !== prevId || sub === 'edit')) hideSheet();
  if (prevMode === 'edit' && (id !== prevId || sub !== 'edit')) hideEditor();
  if (!id) {
    mode = 'roster'; currentId = null;
    root.dataset.mode = mode;
    renderRoster(root);
    if (!isReady()) ready().then(() => { if (mode === 'roster' && isVisible()) renderRoster(root); });
  } else if (id === 'new') {
    mode = 'new'; currentId = null;
    root.dataset.mode = mode;
    showBuilder(root);
  } else if (sub === 'edit') {
    const fresh = prevMode !== 'edit' || prevId !== id;
    mode = 'edit'; currentId = id;
    root.dataset.mode = mode;
    showEditor(root, id, route.query?.s, { reload: fresh });
  } else {
    const fresh = prevMode !== 'sheet' || prevId !== id;
    mode = 'sheet'; currentId = id;
    root.dataset.mode = mode;
    showSheet(root, id, sub, { reload: fresh });
  }
  if (mode !== prevMode || id !== prevId) host?.scrollTo?.({ top: 0 });
}

// ---------- store events: re-render roster; refresh an open sheet changed elsewhere ----------

store.on((ev) => {
  if (!root) return;
  if (ev.type === 'load') { if (isVisible() && mode === 'roster') renderRoster(root); return; }
  const paths = (ev.path ? [ev.path] : ev.paths || []).filter((p) => p.startsWith(`${DIR}/`) && p.endsWith('.json') && !p.slice(DIR.length + 1).includes('/'));
  if (!paths.length) return;
  if (ev.type === 'put' && paths.every(isSelfWrite)) return; // our own debounced write
  if (!isVisible()) return; // show() re-renders on the next visit
  if (mode === 'roster') { renderRoster(root); return; }
  if (ev.type === 'saved') return;
  for (const p of paths) {
    const id = idFromPath(p);
    if (mode === 'sheet' && id === currentId) sheetExternalChange(id);
    if (mode === 'edit' && id === currentId) editorExternalChange(id);
  }
});

window.addEventListener('beforeunload', () => flushPersist());

// ---------- [[char:Name#section]] links ----------

function summaryMarkdown(c) {
  const s = derive(c);
  const max = s.hpMax;
  const cur = c.hp.current == null ? max : Number(c.hp.current);
  const temp = Number(c.hp.temp) || 0;
  const lvl = totalLevel(c);
  const line = [lvl ? `Level ${lvl}` : '', c.species.id ? entryName('species', c.species.id) : '', s.classLine, c.background.id ? entryName('background', c.background.id) : '']
    .filter(Boolean).join(' · ');
  return [
    `**${mdSafe(c.name || 'Unnamed')}**${line ? ` — ${mdSafe(line)}` : ''}${c.player ? ` · played by ${mdSafe(c.player)}` : ''}`,
    '',
    '| AC | HP | Initiative | Speed | Passive Perception |',
    '| --- | --- | --- | --- | --- |',
    `| ${s.ac.value} | ${cur} / ${max}${temp ? ` (+${temp} temp)` : ''} | ${fmtMod(s.initiative)} | ${s.speed.walk ?? 30} ft | ${s.passive.perception} |`,
    '',
    ABILITIES.map((a) => `${a.name} ${s.abilities[a.id].score} (${fmtMod(s.abilities[a.id].mod)})`).join(' · '),
    c.conditions.length ? `\n*Conditions:* ${c.conditions.join(', ')}` : '',
  ].join('\n');
}

registerLinkType('char', {
  label: 'Character',
  order: 30,
  resolve(target, anchor) {
    const c = findCharacter(target);
    if (!c) return null;
    const a = anchor ? normalizeAnchor(anchor) : '';
    const sheetLine = derive(c).classLine;
    return { href: href(VIEW, c.id, a || null), title: `${c.name || c.id}${sheetLine ? ` · ${sheetLine}` : ''}${a ? ` › ${anchor}` : ''}`, exists: true };
  },
  suggest(q) {
    return matchNames(listCharacters(), q, (c) => c.name || c.id, 8).map((c) => ({ label: c.name || c.id, value: c.name || c.id }));
  },
  embed(target) {
    const c = findCharacter(target);
    return c ? { markdown: summaryMarkdown(c) } : null;
  },
});

// Warm the rules a little after boot so character embeds in notes show derived stats.
setTimeout(() => { ready().catch(() => {}); }, 2500);

export default {
  id: VIEW,
  title: 'Characters',
  icon: 'characters',
  mount(el) {
    host = el;
    root = h('div', { class: 'ch-page' });
    el.append(root);
    ready().catch(() => {});
  },
  show,
  hide() {
    if (mode === 'sheet') hideSheet();
    if (mode === 'edit') hideEditor();
    flushPersist();
    mode = null; // the next show() reloads from the store (it may have changed while hidden)
  },
};
