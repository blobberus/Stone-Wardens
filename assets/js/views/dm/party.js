// The party at a glance (DM Screen → Party, #/dm/party; docs/dm-party.md): up to six characters on one screen, each
// with hit points, AC and passive Perception, the six abilities, conditions and other effects, and a private note.
// Made to sit in a pane of the DM Screen website (blobberus/DMscreen) as well as in a tab: the cards scale to fill
// the space (party-model.js fitGrid) and scroll only when they would get too small. A card opens the sheet.
// Live: players' sheets publish every change (core/live.js; characters/data.js reads the newer copy), and GitHub is
// checked every few seconds as a fallback (a 304 costs nothing). Notes are sealed for the DM (content/dm/party.json).
import { h, clear } from '../../core/dom.js';
import { icon, toast, pickFromList } from '../../core/ui.js';
import { store } from '../../core/store.js';
import { href, navigate } from '../../core/router.js';
import { byName } from '../../core/util.js';
import { watchLive, liveStatus, onLiveStatus } from '../../core/live.js';
import { isDm, onDm, readSealed, writeSealed, DM_PARTY } from '../../core/dm.js';
import { listCharacters, ABILITIES, isSheetPath } from '../characters/data.js';
import { derive, conditionList, ready, onReady } from '../characters/bridge.js';
import { portrait, hpBar, fmt } from '../characters/widgets.js';
import { partyCard, fitGrid, normalizeParty, GAP } from './party-model.js';

const POLL_FAST = 5000; // live channel down: ask GitHub this often (unchanged = a free 304)
const POLL_LIVE = 20000; // live channel up: GitHub is only the backup
const PULL_GAP = 12000; // at most one full pull per this long (each costs ~3 requests of the shared token)
const FX_SHOWN = 4; // effect chips on a card before "+N"

const P = {
  root: null, bar: null, grid: null, status: null, pick: null, empty: null,
  cards: new Map(), // id -> {el, slots, sigs, note}
  open: new Set(), // ids whose note is open (this visit)
  party: normalizeParty(null), envText: null, timers: new Map(), saving: Promise.resolve(),
  active: false, unwatch: null, offStatus: null, ro: null, poll: 0, lastCheck: 0, lastPull: 0, polling: false, backoff: 0,
  queued: false,
};

// ---------- the page ----------

/** Build the page into root (the DM Screen's container); tabs = the DM Screen's page tabs. */
export function renderParty(root, tabs) {
  P.status = h('span', { class: 'dm-live', role: 'status' });
  P.pick = h('button', { class: 'btn btn-sm', type: 'button', onclick: chooseCharacters, title: 'Choose who is shown here' }, icon('users'), h('span', { class: 'dm-party-pick-label' }, 'Characters'));
  P.bar = h('div', { class: 'dm-party-bar' },
    tabs,
    h('h1', { class: 'sr-only' }, 'Party'),
    h('div', { class: 'dm-party-tools' },
      P.status,
      P.pick,
      h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Copy the link to this view (to open it in a DM Screen pane)', 'aria-label': 'Copy the link to this view', onclick: copyLink }, icon('link'))));
  P.grid = h('div', { class: 'dm-party-grid' });
  P.empty = h('div', { class: 'empty-state dm-party-empty', hidden: true });
  P.root = root;
  P.cards.clear();
  clear(root);
  root.append(P.bar, P.empty, P.grid);
  drawStatus();
  update();
}

/** The page is showing: watch live copies, check GitHub, keep the grid fitted. */
export function startParty() {
  P.active = true;
  if (!P.unwatch) P.unwatch = watchLive(() => schedule());
  if (!P.offStatus) P.offStatus = onLiveStatus(drawStatus);
  clearInterval(P.poll);
  P.poll = setInterval(tick, 1000);
  P.lastCheck = 0;
  const view = P.root?.closest('.view');
  if (view && !P.ro) { P.ro = new ResizeObserver(() => layout()); P.ro.observe(view); }
  ready().then(() => schedule());
  loadParty();
}

/** Left the page: stop checking GitHub and fitting (the live watch stays on while DM mode is, so sheets opened from
 *  here keep updating). */
export function stopParty() {
  P.active = false;
  clearInterval(P.poll);
  P.ro?.disconnect();
  P.ro = null;
  flushNotes();
}

onReady(() => schedule());
onDm(() => {
  if (isDm()) return;
  P.unwatch?.(); P.unwatch = null;
  P.offStatus?.(); P.offStatus = null;
  P.party = normalizeParty(null); P.envText = null;
});

/** A store event while the page shows (index.js forwards them). */
export function partyEvent(ev) {
  const paths = ev.path ? [ev.path] : ev.paths || [];
  if (paths.includes(DM_PARTY) || ev.type === 'load') loadParty();
  if (ev.type === 'load' || paths.some(isSheetPath)) schedule();
}

function schedule() {
  if (P.queued || !P.active) return;
  P.queued = true;
  requestAnimationFrame(() => { P.queued = false; update(); });
}

// ---------- cards ----------

function update() {
  if (!P.root?.isConnected || !P.grid) return;
  const all = listCharacters().sort(byName);
  const shown = all.filter((c) => !P.party.omit.includes(c.id));
  const conditions = conditionList();
  const order = [];
  for (const char of shown) {
    let card = P.cards.get(char.id);
    if (!card) { card = createCard(char.id); P.cards.set(char.id, card); }
    let model;
    try { model = partyCard(char, derive(char), { conditions, abilities: ABILITIES }); } catch (e) { console.error('[party] card failed', e); continue; }
    fillCard(card, model, char);
    order.push(card.el);
  }
  for (const [id, card] of P.cards) if (!order.includes(card.el)) { card.el.remove(); P.cards.delete(id); }
  // Move only the cards out of place (moving one would drop the focus from its note).
  let ref = P.grid.firstChild;
  for (const el of order) { if (el === ref) { ref = ref.nextSibling; continue; } P.grid.insertBefore(el, ref); }

  P.pick.querySelector('.dm-party-pick-label').textContent = shown.length < all.length ? `Characters ${shown.length}/${all.length}` : 'Characters';
  P.empty.hidden = !!shown.length;
  if (!shown.length) {
    clear(P.empty);
    P.empty.append(icon('users'), all.length
      ? h('p', null, 'Everyone is left out of this view. ', h('button', { class: 'btn btn-sm', type: 'button', onclick: chooseCharacters }, 'Choose characters'))
      : h('p', null, 'No characters yet. Sheets made in the Characters tab show up here.'));
  }
  layout();
}

function createCard(id) {
  const slots = {
    pic: h('div', { class: 'dm-pc-pic' }),
    id: h('div', { class: 'dm-pc-id' }),
    def: h('div', { class: 'dm-pc-def' }),
    hp: h('div', { class: 'dm-pc-hp' }),
    abil: h('dl', { class: 'dm-pc-abil' }),
    fx: h('ul', { class: 'dm-pc-fx', role: 'list' }),
  };
  const note = createNote(id);
  const el = h('article', {
    class: 'dm-pc', 'data-char': id,
    onclick: (e) => {
      if (e.defaultPrevented || e.target.closest('a, button, input, textarea, select, .dm-pc-note')) return;
      if (window.getSelection()?.toString()) return; // selecting text, not opening
      navigate(href('characters', id));
    },
  },
  h('header', { class: 'dm-pc-head' }, slots.pic, slots.id, slots.def), slots.hp, slots.abil, slots.fx, note.el);
  return { el, slots, sigs: {}, note, filled: false };
}

function fillCard(card, m, char) {
  card.el.style.setProperty('--pc-accent', /^#[0-9a-f]{6}$/i.test(m.accent || '') ? m.accent : '');
  card.el.setAttribute('aria-label', `${m.name}, ${m.hp.cur} of ${m.hp.max} hit points, AC ${m.ac.value}`);
  card.el.title = m.updated ? `Sheet last changed ${new Date(m.updated).toLocaleString()}` : '';
  card.el.dataset.hp = m.hp.state;
  const parts = {
    pic: [[char.portrait || '', m.name], () => portrait(char, { size: 'sm' })],
    id: [[m.name, m.player, m.line, m.level], () => [
      h('h2', { class: 'dm-pc-name' }, h('a', { href: href('characters', m.id), title: `Open ${m.name}’s sheet` }, m.name)),
      h('p', { class: 'dm-pc-line' }, [m.player, m.line].filter(Boolean).join(' · '))]],
    def: [[m.ac, m.passive], () => [
      stat('dm-pc-ac', m.ac, 'AC', 'Armor Class', icon('shield')),
      stat('dm-pc-pp', m.passive, 'PP', 'Passive Perception')]],
    hp: [m.hp, () => hpPart(m.hp)],
    abil: [m.abilities, () => m.abilities.map((a) => h('div', {
      class: ['dm-pc-ab', a.base != null && 'is-adjusted'],
      title: `${a.full}: score ${a.value}, modifier ${fmt(a.mod)}${a.base != null ? ` (normally ${a.base}: ${a.why})` : ''}`,
    }, h('dt', null, a.label), h('dd', { class: 'dm-pc-ab-mod num' }, fmt(a.mod)), h('dd', { class: 'dm-pc-ab-score num' }, String(a.value))))],
    fx: [m.effects, () => fxPart(m.effects)],
  };
  for (const [key, [data, build]] of Object.entries(parts)) {
    const sig = JSON.stringify(data);
    if (card.sigs[key] === sig) continue;
    card.sigs[key] = sig;
    const slot = card.slots[key];
    clear(slot);
    slot.append(...[].concat(build()).filter(Boolean));
    if (card.filled && key !== 'pic') flash(slot);
  }
  card.filled = true;
  fillNote(card.note);
}

function stat(cls, v, label, full, art = null) {
  const adj = v.base != null;
  return h('div', { class: ['dm-pc-stat', cls, adj && 'is-adjusted'], title: `${full} ${v.value}${adj ? ` (normally ${v.base}: ${v.why})` : ''}` },
    art, h('b', { class: 'num' }, String(v.value)), h('span', { class: 'dm-pc-stat-label' }, label));
}

function hpPart(hp) {
  const down = hp.state === 'dying' || hp.state === 'stable' || hp.state === 'dead';
  const num = h('span', { class: 'dm-pc-hp-num num' },
    h('strong', null, String(hp.cur)), h('span', { class: 'dm-pc-hp-max' }, ` / ${hp.max}`),
    hp.temp ? h('span', { class: 'dm-pc-temp', title: `${hp.temp} temporary hit points` }, ` +${hp.temp}`) : null);
  if (!down) return [h('span', { class: 'dm-pc-hp-label' }, icon('heart'), 'HP'), hpBar(hp.cur, hp.max, hp.temp), num];
  const word = { dying: 'Down', stable: 'Stable', dead: 'Dead' }[hp.state];
  const pips = (n, kind) => Array.from({ length: 3 }, (_, i) => h('span', { class: ['dm-pc-pip', `is-${kind}`, i < n && 'is-on'] }));
  return [
    h('span', { class: 'dm-pc-hp-label' }, icon('heart'), word),
    h('span', { class: 'dm-pc-saves', title: `Death saves: ${hp.deathSaves.success} succeeded, ${hp.deathSaves.fail} failed` },
      h('span', { class: 'dm-pc-saves-row' }, pips(hp.deathSaves.success, 'ok')), h('span', { class: 'dm-pc-saves-row' }, pips(hp.deathSaves.fail, 'fail'))),
    num];
}

function fxPart(list) {
  if (!list.length) return h('li', { class: 'dm-pc-fx-none' }, 'No conditions');
  const chip = (x) => h('li', { class: ['dm-pc-fx-chip', `is-${x.kind}`], title: x.title || null }, x.kind === 'inspiration' ? icon('star') : null, x.label);
  if (list.length <= FX_SHOWN) return list.map(chip);
  const rest = list.slice(FX_SHOWN - 1);
  return [...list.slice(0, FX_SHOWN - 1).map(chip),
    h('li', { class: 'dm-pc-fx-chip is-more', title: rest.map((x) => x.label).join(', ') }, `+${rest.length}`)];
}

function flash(el) {
  el.classList.remove('is-fresh');
  void el.offsetWidth;
  el.classList.add('is-fresh');
  el.addEventListener('animationend', () => el.classList.remove('is-fresh'), { once: true });
}

// ---------- layout: as many cards as there are, as large as they fit ----------

function layout() {
  if (!P.grid?.isConnected) return;
  const view = P.root.closest('.view');
  const n = P.cards.size;
  if (!view || !n) return;
  const cs = getComputedStyle(view);
  const width = P.grid.clientWidth;
  const height = view.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - P.bar.offsetHeight - parseFloat(getComputedStyle(P.root).rowGap || '0');
  const g = fitGrid(n, width, height, { gap: GAP });
  P.grid.classList.toggle('is-fit', g.fit);
  P.grid.classList.toggle('is-scroll', !g.fit);
  P.root.classList.toggle('is-scroll', !g.fit);
  view.classList.toggle('is-party-scroll', !g.fit);
  P.grid.dataset.shape = g.shape;
  P.grid.style.setProperty('--pc-cols', String(g.cols));
  P.grid.style.setProperty('--pc-rows', String(g.rows));
  P.grid.style.setProperty('--pc-s', g.scale.toFixed(3));
}

// ---------- notes (sealed for the DM) ----------

function createNote(id) {
  const peek = h('span', { class: 'dm-pc-note-peek' });
  const text = h('textarea', {
    class: 'textarea dm-pc-note-text', rows: 3, spellcheck: true, 'aria-label': 'Private note',
    placeholder: 'A note about this character, for your eyes only',
    oninput: () => noteInput(id, text.value),
    onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); toggle.focus(); } },
  });
  const toggle = h('button', { class: 'dm-pc-note-toggle', type: 'button', 'aria-expanded': 'false', onclick: () => setOpen(!P.open.has(id)) },
    icon('edit'), peek, h('span', { class: 'dm-pc-note-chev' }, icon('chevron-up')));
  const body = h('div', { class: 'dm-pc-note-body', hidden: true }, text);
  const el = h('div', { class: 'dm-pc-note' }, toggle, body);
  const note = { id, el, peek, text, toggle, body };
  function setOpen(on) {
    if (on) P.open.add(id); else P.open.delete(id);
    fillNote(note);
    if (on) { text.focus(); text.setSelectionRange(text.value.length, text.value.length); }
  }
  return note;
}

function fillNote(note) {
  const value = P.party.notes[note.id] || '';
  if (document.activeElement !== note.text && note.text.value !== value) note.text.value = value;
  const open = P.open.has(note.id);
  note.el.classList.toggle('is-open', open);
  note.body.hidden = !open;
  note.toggle.setAttribute('aria-expanded', String(open));
  note.toggle.title = open ? 'Close the note' : value ? 'Open the note' : 'Add a private note';
  const first = value.split('\n').find((l) => l.trim()) || '';
  note.peek.textContent = open ? 'Private note' : first || 'Add a note';
  note.peek.classList.toggle('is-empty', !first && !open);
}

function noteInput(id, value) {
  if (value.trim()) P.party.notes[id] = value; else delete P.party.notes[id];
  const card = P.cards.get(id);
  if (card) fillNote(card.note);
  clearTimeout(P.timers.get(id));
  P.timers.set(id, setTimeout(() => { P.timers.delete(id); saveParty(); }, 600));
}

function flushNotes() {
  if (!P.timers.size) return;
  for (const t of P.timers.values()) clearTimeout(t);
  P.timers.clear();
  saveParty();
}

function saveParty() {
  const doc = normalizeParty(P.party);
  P.saving = P.saving.then(async () => {
    if (!isDm()) return;
    await writeSealed(DM_PARTY, doc);
    P.envText = JSON.stringify(store.get(DM_PARTY));
  }).catch((e) => toast(`Could not keep the note: ${e.message || e}`, { type: 'error' }));
  return P.saving;
}

/** (Re)read the sealed doc when it changed (another device of the DM, or the first visit). */
async function loadParty() {
  if (!isDm()) return;
  const env = store.get(DM_PARTY);
  const envText = env ? JSON.stringify(env) : '';
  if (envText === P.envText) return;
  P.envText = envText;
  const doc = normalizeParty(await readSealed(DM_PARTY));
  for (const id of P.timers.keys()) { if (P.party.notes[id]) doc.notes[id] = P.party.notes[id]; else delete doc.notes[id]; } // still typing here
  P.party = doc;
  schedule();
  if (!P.active) update();
}

async function chooseCharacters() {
  const all = listCharacters().sort(byName);
  if (!all.length) { toast('There are no characters yet.'); return; }
  const picked = await pickFromList({
    title: 'Characters in the party view', items: all, multi: true,
    selected: all.filter((c) => !P.party.omit.includes(c.id)),
    render: (c) => h('span', { class: 'dm-pick' }, h('span', null, c.name || 'Unnamed'), h('span', { class: 'muted' }, [c.player, derive(c).classLine].filter(Boolean).join(' · '))),
    search: (c) => `${c.name} ${c.player}`,
  });
  if (!picked) return;
  const keep = new Set(picked.map((c) => c.id));
  P.party.omit = all.filter((c) => !keep.has(c.id)).map((c) => c.id);
  update();
  await saveParty();
}

function copyLink() {
  const url = `${location.href.split('#')[0]}#/dm/party`;
  const done = () => toast('Link copied. Paste it into the address bar of a DM Screen pane (DM mode must be on in that browser).', { timeout: 6000 });
  navigator.clipboard?.writeText(url).then(done, () => toast(url, { timeout: 12000 })) ?? toast(url, { timeout: 12000 });
}

// ---------- live status and the GitHub fallback ----------

function drawStatus() {
  if (!P.status) return;
  const st = liveStatus();
  const state = st.state === 'online' ? 'online' : st.state === 'offline' ? 'offline' : 'connecting';
  const text = { online: 'Live', connecting: 'Connecting…', offline: 'Live updates off' }[state];
  P.status.className = `dm-live is-${state}`;
  P.status.title = {
    online: 'Changes on the players’ sheets show here within about a second.',
    connecting: 'Connecting to the live channel. Until then, changes show once a sheet is saved to GitHub (about 15 seconds).',
    offline: 'The live channel can’t be reached from here. Changes show once a sheet is saved to GitHub (checked every 5 seconds).',
  }[state];
  clear(P.status);
  P.status.append(h('span', { class: 'dm-live-dot', 'aria-hidden': 'true' }), text);
}

async function tick() {
  if (!P.active || P.polling || document.visibilityState !== 'visible' || store.saving) return;
  const now = Date.now();
  if (now < P.backoff) return;
  const every = liveStatus().state === 'online' ? POLL_LIVE : POLL_FAST;
  if (now - P.lastCheck < every || now - P.lastPull < PULL_GAP) return;
  P.lastCheck = now;
  P.polling = true;
  try {
    const pulled = await store.pullIfChanged();
    if (pulled) P.lastPull = Date.now();
  } catch (e) {
    console.warn('[party] could not check GitHub', e);
    P.backoff = Date.now() + 60000;
  } finally { P.polling = false; }
}

export const _test = { P, layout, update };
