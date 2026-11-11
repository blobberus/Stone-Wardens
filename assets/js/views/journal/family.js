// A Family tree note's board: a toolbar (add a Person; with someone selected, their Parent, Partner, Child or
// Sibling; zoom and fit) over the tree. People are cards (name, title, born – died, a house colour), laid out
// generation by generation: partners side by side joined by a line (double: married, single: partners, dashed:
// separated), their children below on a shared bar. Hover a card (or tap it) for the person's description, tags and
// links; click to select (their + Parent / Partner / Child / Sibling bar shows under the card; their own lines stand
// out), double click to edit. Arrow keys go to relatives, Ctrl / Cmd + wheel or two fingers zoom. An empty tree says
// so inside the frame; a key under the board names the kinds of line drawn. Data (kinds.js boardData): people
// [{id, name, title, born, died,
// color, text, tags}] and unions [{id, partners: [ids, at most 2], children: [ids], status}].
import { h } from '../../core/dom.js';
import { icon, field, input, select, confirmDialog, isTouch } from '../../core/ui.js';
import { calendar, normDate, colorVar } from './calendar.js';
import { boardData, itemAnchor } from './kinds.js';
import {
  dateFields, tagsInput, colorPicker, textField, itemDialog, notBefore,
  hoverable, showCard, hideCard, cardBody, cardBtn, copyItemLink, itemId, toolGroup,
} from './board.js';
import { W, PG, VG, VG_TOUCH, PAD, STATUS, clean, normalize, compact, lifeLine, layoutFamily } from './family-layout.js';

// ---------- the board ----------

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
const READ_ZOOM = 0.6; // opening a wide tree: fitted to the board, but never smaller than this
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const ACT_ROOM = () => (isTouch() ? 62 : 48); // under the bottom row: room for the selected person's actions
const RELATIVES = [['parent', 'Parent', 'a parent'], ['partner', 'Partner', 'a partner'], ['child', 'Child', 'a child'], ['sibling', 'Sibling', 'a sibling']];
const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export class FamilyBoard {
  constructor(view) {
    this.view = view;
    // switching Read / Edit makes the board again: it comes back where it was
    const kept = view.ftKept || null;
    view.ftKept = null;
    this.kept = kept;
    this.zoom = kept?.zoom ?? 1;
    this.selected = kept?.selected ?? null;
    this.framed = false;
    this.el = h('section', { class: 'jr-board jr-ft', 'aria-label': 'Family tree' });
    // the scroll box is made once, so a change to the tree keeps the place it shows
    this.stage = h('div', { class: 'jr-ft-stage' });
    this.sizer = h('div', { class: 'jr-ft-sizer' }, this.stage);
    this.scroll = h('div', { class: 'jr-ft-scroll', tabindex: '0', 'aria-label': 'Family tree, scroll to see more' }, this.sizer);
    this.wirePan(this.scroll);
    this.wireZoom(this.scroll);
    // a click on the board's empty space, or Esc, lets go of the selected person
    this.scroll.addEventListener('click', (e) => {
      if (this.panned) { this.panned = false; return; }
      if (!e.target.closest('.jr-ft-person, .jr-ft-acts')) this.select(null);
    });
    this.onKey = (e) => {
      if (e.key !== 'Escape' || !this.selected || e.defaultPrevented || !this.el.isConnected || typing(e.target)) return;
      if (document.querySelector('.modal-backdrop, .jr-menu')) return;
      e.preventDefault();
      this.select(null);
    };
    document.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => { if (!this.framed && this.geo) this.frame(); });
    this.ro.observe(this.scroll);
    this.render();
    document.fonts?.ready.then(() => { if (!this.destroyed) this.layout(); });
  }

  get note() { return this.view.current; }
  get data() { return normalize(boardData(this.view.fm)); }

  save(people, unions) {
    this.view.setBoard(compact(people, unions));
    this.render();
  }

  destroy() {
    if (this.framed && this.scroll.isConnected) {
      this.view.ftKept = { zoom: this.zoom, selected: this.selected, left: this.scroll.scrollLeft, top: this.scroll.scrollTop };
    }
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('keydown', this.onKey);
    hideCard(true);
  }

  // ---------- toolbar ----------

  toolbar() {
    const d = this.d;
    const sel = d.people.find((p) => p.id === this.selected) || null;
    const who = sel ? sel.name || 'them' : null;
    const short = who && who.length > 18 ? `${who.slice(0, 17)}…` : who;
    // nobody selected: say how to start instead of a row of buttons that do nothing yet
    const relatives = sel ? toolGroup({
      caption: `For ${short}`, label: `Relatives of ${who}`,
      fold: { label: 'Relative', title: `Add a relative of ${who}`, menuLabel: `Add a relative of ${who}` },
      tools: RELATIVES.map(([kind, label, a]) => ({ label, icon: 'plus', onClick: () => this.addRelative(sel, kind), title: `Add ${a} of ${who}` })),
    }) : d.people.length ? h('p', { class: 'jr-ft-tip' }, 'Select a person to add their relatives') : null;
    return h('div', { class: 'jr-tools', role: 'toolbar', 'aria-label': 'Family tree tools' },
      toolGroup({ caption: 'Add', label: 'Add', tools: [{ label: 'Person', icon: 'user', onClick: () => this.editPerson(null), title: 'Add someone to the tree' }] }),
      relatives,
      !d.people.length ? null : h('div', { class: 'jr-tools-group jr-tools-end' },
        h('span', { class: 'jr-tools-cap' }, 'Zoom'),
        h('div', { class: 'jr-seg', role: 'group', 'aria-label': 'Zoom' },
          this.zoomOut = h('button', { type: 'button', class: 'jr-seg-btn', title: 'Zoom out', 'aria-label': 'Zoom out', disabled: this.zoom <= MIN_ZOOM + 0.001, onclick: () => this.setZoom(this.zoom / 1.25) }, icon('minus')),
          h('button', { type: 'button', class: 'jr-seg-btn', title: 'Fit the whole tree', onclick: () => this.fit() }, this.zoomLabel = h('span', null, `${Math.round(this.zoom * 100)}%`)),
          this.zoomIn = h('button', { type: 'button', class: 'jr-seg-btn', title: 'Zoom in', 'aria-label': 'Zoom in', disabled: this.zoom >= MAX_ZOOM - 0.001, onclick: () => this.setZoom(this.zoom * 1.25) }, icon('plus')))));
  }

  /** Zoom to z, keeping the point `at` ({x, y} in the board's box, its middle by default) where it is. */
  setZoom(z, at = null) {
    const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const box = this.scroll;
    if (!this.geo || nz === this.zoom) { this.zoom = nz; this.applyZoom(); return; }
    const ax = at ? at.x : box.clientWidth / 2;
    const ay = at ? at.y : box.clientHeight / 2;
    const tx = (box.scrollLeft + ax - this.sizer.offsetLeft) / this.zoom;
    const ty = (box.scrollTop + ay - this.sizer.offsetTop) / this.zoom;
    this.zoom = nz;
    this.applyZoom();
    box.scrollLeft = tx * nz + this.sizer.offsetLeft - ax;
    box.scrollTop = ty * nz + this.sizer.offsetTop - ay;
    this.positionActs();
  }

  /** The zoom on the page: the stage's scale, the scroll box's room, the toolbar's % (no new layout). */
  applyZoom() {
    const z = this.zoom;
    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${Math.round(z * 100)}%`;
      this.zoomOut.disabled = z <= MIN_ZOOM + 0.001;
      this.zoomIn.disabled = z >= MAX_ZOOM - 0.001;
    }
    if (!this.geo) return;
    this.stage.style.transform = z === 1 ? '' : `scale(${z})`;
    this.sizer.style.width = `${Math.ceil(this.wpx * z)}px`;
    // room under the bottom row for the selected person's actions, so selecting someone never moves the page
    this.sizer.style.height = `${Math.ceil(this.hpx * z + Math.max(0, ACT_ROOM() - PAD * z))}px`;
    this.positionActs();
  }

  fit() {
    if (!this.geo) return;
    const avail = this.scroll.clientWidth - 16;
    this.setZoom(Math.min(1, avail / this.geo.width));
    this.scroll.scrollLeft = 0;
    this.positionActs();
  }

  /**
   * The first look: a tree narrower than the board sits in its middle; a wider one is fitted to the width, or, if
   * that would make it too small to read, shown at READ_ZOOM from its main family's oldest people. Switching Read /
   * Edit comes back to where it was instead.
   */
  frame() {
    const box = this.scroll;
    const cw = box.clientWidth;
    if (!this.geo || !cw || !this.d.people.length || !this.el.isConnected) return;
    this.framed = true;
    const k = this.kept;
    this.kept = null;
    if (k) {
      this.applyZoom();
      box.scrollLeft = k.left;
      box.scrollTop = k.top;
      this.positionActs();
      return;
    }
    const fit = (cw - 16) / this.geo.width;
    this.zoom = fit >= 1 ? 1 : Math.max(READ_ZOOM, Math.floor(fit * 100) / 100);
    this.applyZoom();
    box.scrollTop = 0;
    box.scrollLeft = fit >= READ_ZOOM ? 0 : this.geo.focus.x * this.zoom + this.sizer.offsetLeft - cw / 2;
    this.positionActs();
  }

  select(id) {
    if (this.selected === id) return;
    const had = this.acts?.contains(document.activeElement);
    this.selected = id;
    this.el.querySelectorAll('.jr-ft-person').forEach((c) => c.classList.toggle('is-selected', c.dataset.id === id));
    this.bar.replaceWith(this.bar = this.toolbar());
    this.placeActs();
    this.lightLines();
    if (had) this.cardEl(id)?.focus({ preventScroll: true });
  }

  /**
   * A person's own lines (to their parents, partners and children) drawn again on top in ink, or their house
   * colour, while the rest fade a little: the person under the mouse, else the selected one.
   */
  lightLines(id = this.hovered || this.selected) {
    const L = this.lines;
    if (!L) return;
    L.lit.replaceChildren();
    const p = id ? this.d.people.find((x) => x.id === id) : null;
    L.svg.classList.toggle('is-lit', !!p);
    if (!p) return;
    const own = new Set(this.d.unions.filter((u) => u.partners.includes(id)).map((u) => u.id));
    const pu = this.d.childOf.get(id);
    for (const el of L.base.children) {
      const u = el.dataset.u;
      if (own.has(u) || (pu && u === pu.id && (el.dataset.role !== 'kid' || el.dataset.c === id))) L.lit.append(el.cloneNode(true));
    }
    L.svg.style.setProperty('--lit', p.color ? colorVar(p.color) : 'var(--ink)');
  }

  cardEl(id) { return id ? this.stage.querySelector(`.jr-ft-person[data-id="${CSS.escape(id)}"]`) : null; }

  // ---------- the selected person's actions: a small bar under their card ----------

  /** The bar of "+ Parent", "+ Partner", "+ Child", "+ Sibling", right after the selected card (next in Tab order). */
  placeActs() {
    this.acts?.remove();
    this.acts = null;
    const p = this.d.people.find((x) => x.id === this.selected);
    const card = p && this.cardEl(p.id);
    if (!card) return;
    const who = p.name || 'them';
    this.acts = h('div', { class: 'jr-ft-acts', role: 'group', 'aria-label': `Add a relative of ${who}` },
      RELATIVES.map(([kind, label, a]) => h('button', {
        type: 'button', class: 'jr-ft-act', title: `Add ${a} of ${who}`, onclick: () => this.addRelative(p, kind),
      }, icon('plus'), h('span', null, label))));
    card.after(this.acts);
    this.positionActs();
  }

  /**
   * The bar keeps its size at any zoom (scaled back by 1/zoom inside the stage), centred under the card (above it
   * if the bottom row's room is too small), kept inside the board; a notch points at the card.
   */
  positionActs(view = null) {
    const acts = this.acts;
    if (!acts || !acts.isConnected || !this.geo) return;
    const card = acts.previousElementSibling;
    const z = this.zoom;
    acts.style.maxWidth = `${Math.max(150, this.scroll.clientWidth - 12)}px`;
    const bw = acts.offsetWidth;
    const bh = acts.offsetHeight;
    const sw = this.sizer.offsetWidth;
    const sh = this.sizer.offsetHeight;
    const gap = 6;
    const cx = (card.offsetLeft + card.offsetWidth / 2) * z;
    let top = (card.offsetTop + card.offsetHeight) * z + gap;
    const above = top + bh > sh && card.offsetTop * z - gap - bh >= 0;
    if (above) top = card.offsetTop * z - gap - bh;
    // inside the tree and the part of it in view (view.left: where the box is about to scroll to)
    const box = this.scroll;
    const vl = (view ? view.left : box.scrollLeft) - this.sizer.offsetLeft;
    const vr = vl + box.clientWidth;
    let lo = Math.max(2, vl + 4);
    let hi = Math.min(sw - 2, vr - 4) - bw;
    if (hi < lo) { lo = vl + 4; hi = vr - 4 - bw; }
    const left = hi >= lo ? Math.max(lo, Math.min(cx - bw / 2, hi)) : vl + (box.clientWidth - bw) / 2;
    acts.classList.toggle('is-above', above);
    acts.style.setProperty('--notch', `${Math.round(Math.max(14, Math.min(bw - 14, cx - left)))}px`);
    acts.style.left = `${left / z}px`;
    acts.style.top = `${top / z}px`;
    acts.style.transform = z === 1 ? '' : `scale(${1 / z})`;
  }

  /** A quiet key under the board to the kinds of line this tree draws (none: no key). */
  lineKey() {
    const NS = 'http://www.w3.org/2000/svg';
    const sample = (paths, text = null) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 10');
      svg.setAttribute('aria-hidden', 'true');
      for (const [d, cls] of paths) { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); e.setAttribute('class', cls); svg.append(e); }
      if (text) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', '12'); t.setAttribute('y', '9'); t.setAttribute('class', 'jr-ft-unknown'); t.textContent = text; svg.append(t); }
      return svg;
    };
    const { unions } = this.d;
    const has = (st) => unions.some((u) => u.partners.length === 2 && u.status === st);
    const items = [
      has('married') && [sample([['M0 2.5H24', 'jr-ft-wed is-married'], ['M0 7.5H24', 'jr-ft-wed is-married']]), 'Married'],
      has('partners') && [sample([['M0 5H24', 'jr-ft-wed is-partners']]), 'Partners'],
      has('separated') && [sample([['M0 5H24', 'jr-ft-wed is-separated']]), 'Separated'],
      unions.some((u) => !u.partners.length) && [sample([], '?'), 'Parents unknown'],
    ].filter(Boolean);
    if (!items.length) return null;
    return h('div', { class: 'jr-ft-key', role: 'note', 'aria-label': 'Key to the lines' },
      items.map(([svg, label]) => h('span', { class: 'jr-ft-key-item' }, svg, h('span', null, label))));
  }

  /** The card and its bar together: the hover card keeps clear of both. */
  aroundOf(el) {
    const r = el.getBoundingClientRect();
    if (!this.acts || this.acts.previousElementSibling !== el) return r;
    const a = this.acts.getBoundingClientRect();
    const l = Math.min(r.left, a.left);
    const t = Math.min(r.top, a.top);
    return new DOMRect(l, t, Math.max(r.right, a.right) - l, Math.max(r.bottom, a.bottom) - t);
  }

  /**
   * A click selects the person (their actions show under the card). With a mouse their details show on hover, so
   * the click hides them; a tap shows them too (and keeps them open); with the keyboard (Space) they move clear.
   */
  pick(p, el, how) {
    this.select(p.id);
    const build = () => this.personBody(p);
    const around = () => this.aroundOf(el);
    const touch = how === 'touch' || how === 'pen';
    // a card half out of view comes in, with its actions (at once on touch, so the details open where it ends up)
    const to = this.bringIntoView(p.id, touch ? 'auto' : smooth());
    if (to) this.positionActs(to);
    // after any scrolling it caused (the board's or the page's), which would close it again
    const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
    if (touch) { hideCard(true); later(() => { if (el.isConnected && this.selected === p.id) showCard(el, build, { pinned: true, around }); }); }
    else if (how === 'key') { if (el.classList.contains('is-carded')) { hideCard(true); later(() => showCard(el, build, { around })); } }
    else hideCard(true);
  }

  /** Who an arrow key goes to from `id`: the nearest parent (up), child (down), or neighbour in the row. */
  neighbour(id, dir) {
    const { geo, d } = this;
    if (!geo?.x.has(id)) return null;
    const x0 = geo.x.get(id);
    const nearest = (ids) => ids.filter((i) => geo.x.has(i)).sort((a, b) => Math.abs(geo.x.get(a) - x0) - Math.abs(geo.x.get(b) - x0))[0] || null;
    if (dir === 'up') return nearest(d.childOf.get(id)?.partners || []);
    if (dir === 'down') return nearest(d.unions.filter((u) => u.partners.includes(id)).flatMap((u) => u.children));
    const row = d.people.map((x) => x.id).filter((i) => i !== id && geo.gen.get(i) === geo.gen.get(id));
    return nearest(row.filter((i) => (dir === 'left' ? geo.x.get(i) < x0 : geo.x.get(i) > x0)));
  }

  /** Keyboard: select someone, focus their card and bring it into view (at once, as focus moves do). */
  goTo(id) {
    const el = this.cardEl(id);
    if (!el) return;
    this.select(id);
    const to = this.bringIntoView(id, 'auto');
    if (to) this.positionActs(to);
    el.focus({ preventScroll: true });
    // the scroll closes the details that focus opened: open them again where the card ended up
    if (to) {
      const p = this.d.people.find((x) => x.id === id);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (document.activeElement === el && el.matches(':focus-visible') && !el.classList.contains('is-carded')) {
          showCard(el, () => this.personBody(p), { around: () => this.aroundOf(el) });
        }
      }));
    }
  }

  // ---------- rendering ----------

  render() {
    hideCard(true);
    this.d = this.data;
    if (this.selected && !this.d.people.some((p) => p.id === this.selected)) this.selected = null;
    const bar = this.toolbar();
    if (this.bar?.parentNode === this.el) this.bar.replaceWith(bar);
    this.bar = bar;
    // never take the scroll box out of the page: it would forget how far it was scrolled
    if (this.scroll.parentNode !== this.el) this.el.replaceChildren(this.bar, this.scroll);
    else if (this.el.firstChild !== this.bar) this.el.prepend(this.bar);
    this.key?.remove();
    this.key = this.lineKey();
    if (this.key) this.scroll.after(this.key);
    this.el.classList.toggle('has-key', !!this.key);
    this.layout();
  }

  layoutSoon() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.layout());
  }

  layout() {
    cancelAnimationFrame(this.raf);
    if (this.destroyed) return;
    if (!this.el.isConnected) { this.layoutSoon(); return; }
    const { people, unions, childOf } = this.d;
    const cal = calendar();
    const stage = this.stage;
    const ae = document.activeElement;
    const focusId = ae && stage.contains(ae) ? ae.closest('.jr-ft-person')?.dataset.id || this.selected : null;
    this.hovered = null;
    stage.replaceChildren();
    // nobody yet: one sentence and the button to start, inside the frame
    this.scroll.classList.toggle('is-empty', !people.length);
    if (!people.length) {
      this.geo = null;
      this.lines = null;
      this.acts = null;
      this.empty ||= h('div', { class: 'jr-ft-empty' },
        h('p', null, 'No one in this family tree yet.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.editPerson(null) }, icon('user'), h('span', null, 'Add the first person')));
      this.scroll.replaceChildren(this.empty);
      return;
    }
    if (this.sizer.parentNode !== this.scroll) this.scroll.replaceChildren(this.sizer);
    const cards = new Map();
    // measured outside the (zoomed) stage: the layout wants their own heights
    const measure = h('div', { class: 'jr-tl-measure' });
    this.el.append(measure);
    for (const p of people) { const c = this.personCard(p, cal); c.style.width = `${W}px`; cards.set(p.id, c); measure.append(c); }
    const hs = new Map([...cards].map(([id, c]) => [id, Math.ceil(c.getBoundingClientRect().height)]));
    measure.remove();
    const geo = layoutFamily(people, unions, childOf, (id) => hs.get(id), { vg: isTouch() ? VG_TOUCH : VG });
    this.geo = geo;
    const wpx = Math.max(geo.width, 200);
    const hpx = Math.max(geo.height, 120);
    this.wpx = wpx;
    this.hpx = hpx;
    stage.style.width = `${wpx}px`;
    stage.style.height = `${hpx}px`;
    this.applyZoom();

    // lines first (under the cards)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'jr-ft-lines');
    svg.setAttribute('width', String(wpx));
    svg.setAttribute('height', String(hpx));
    svg.setAttribute('aria-hidden', 'true');
    // every line knows its family (u), what it is (wed: the partners', stub: down from them, kid: to one child c),
    // so a person's own lines can be drawn again on top (lightLines)
    const base = document.createElementNS(NS, 'g');
    base.setAttribute('class', 'jr-ft-base');
    const lit = document.createElementNS(NS, 'g');
    lit.setAttribute('class', 'jr-ft-lit');
    svg.append(base, lit);
    const path = (d, cls, u, role, c = null) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      p.dataset.u = u.id;
      p.dataset.role = role;
      if (c) p.dataset.c = c;
      base.append(p);
    };
    const top = (id) => geo.rowTop[geo.gen.get(id)];
    const busCount = new Map();
    for (const u of unions) {
      let ux;
      let uy;
      if (u.partners.length === 2) {
        const [a, b] = [...u.partners].sort((m, n) => geo.x.get(m) - geo.x.get(n));
        const ya = top(a) + 28;
        const xa = geo.x.get(a) + W;
        const xb = geo.x.get(b);
        const adjacent = Math.abs(xb - xa - PG) < 2;
        const cls = `jr-ft-wed is-${u.status}`;
        if (adjacent) {
          if (u.status === 'married') { path(`M${xa} ${ya - 2.5}H${xb}`, cls, u, 'wed'); path(`M${xa} ${ya + 2.5}H${xb}`, cls, u, 'wed'); }
          else path(`M${xa} ${ya}H${xb}`, cls, u, 'wed');
        } else {
          // partners with someone between them: the line goes over the cards
          const yTop = top(a) - 12;
          path(`M${geo.x.get(a) + W / 2} ${top(a)}V${yTop}H${geo.x.get(b) + W / 2}V${top(b)}`, cls, u, 'wed');
        }
        ux = adjacent ? (xa + xb) / 2 : (geo.x.get(a) + W / 2 + geo.x.get(b) + W / 2) / 2;
        uy = adjacent ? ya + (u.status === 'married' ? 2.5 : 0) : top(a) - 12;
      } else if (u.partners.length === 1) {
        const a = u.partners[0];
        ux = geo.x.get(a) + W / 2;
        uy = top(a) + hs.get(a); // from their own card, not the row's tallest
      }
      if (!u.children.length) continue;
      const kidRow = geo.gen.get(u.children[0]);
      const n = busCount.get(kidRow) || 0;
      busCount.set(kidRow, n + 1);
      const busY = geo.rowTop[kidRow] - geo.vg / 2 + ((n % 3) - 1) * 7;
      const cxs = u.children.map((c) => geo.x.get(c) + W / 2);
      if (ux == null) { // unknown parents: a short stub with a question mark over the siblings' bar
        ux = (Math.min(...cxs) + Math.max(...cxs)) / 2;
        uy = busY - 16;
        const q = document.createElementNS(NS, 'text');
        q.setAttribute('x', String(ux));
        q.setAttribute('y', String(uy - 3));
        q.setAttribute('class', 'jr-ft-unknown');
        q.dataset.u = u.id;
        q.dataset.role = 'stub';
        q.textContent = '?';
        base.append(q);
      }
      path(`M${ux} ${uy}V${busY}`, 'jr-ft-line', u, 'stub');
      // the bar to the children: a stretch per child, so one child's own line can stand out
      for (const c of u.children) path(`M${ux} ${busY}H${geo.x.get(c) + W / 2}V${top(c)}`, 'jr-ft-line', u, 'kid', c);
    }
    stage.append(svg);
    this.lines = { svg, base, lit };
    for (const p of people) {
      const c = cards.get(p.id);
      c.style.left = `${Math.round(geo.x.get(p.id))}px`;
      c.style.top = `${Math.round(top(p.id))}px`;
      stage.append(c);
    }
    this.placeActs();
    this.lightLines();
    if (!this.framed) this.frame();
    if (focusId) this.cardEl(focusId)?.focus({ preventScroll: true });
  }

  /**
   * Scroll the board (and the page, if need be) just enough to show someone's card, with room under it.
   * -> the board's scroll target {left, top}, or null when it needn't move.
   */
  bringIntoView(id, behavior = smooth()) {
    const el = this.cardEl(id);
    if (!el) return null;
    const box = this.scroll;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const m = 16;
    const under = 56; // their actions sit under the card
    const inL = b.left + box.clientLeft + m;
    const inR = b.left + box.clientLeft + box.clientWidth - m;
    const inT = b.top + box.clientTop + m;
    const inB = b.top + box.clientTop + box.clientHeight - m;
    let dx = 0;
    let dy = 0;
    if (r.width > inR - inL || r.left < inL) dx = r.left - inL; else if (r.right > inR) dx = r.right - inR;
    if (r.top < inT) dy = r.top - inT; else if (r.bottom + under > inB) dy = Math.min(r.top - inT, r.bottom + under - inB);
    const to = dx || dy ? {
      left: Math.max(0, Math.min(box.scrollLeft + dx, box.scrollWidth - box.clientWidth)),
      top: Math.max(0, Math.min(box.scrollTop + dy, box.scrollHeight - box.clientHeight)),
    } : null;
    if (to) box.scrollTo({ ...to, behavior });
    // the page: the card where it will be, clear of the sticky toolbar
    const desk = this.view.host;
    const d = desk.getBoundingClientRect();
    const top = r.top - dy;
    const bottom = r.bottom - dy + under;
    const clear = d.top + this.bar.offsetHeight + m;
    if (top < clear) desk.scrollBy({ top: top - clear, behavior });
    else if (bottom > d.bottom - m) desk.scrollBy({ top: Math.min(top - clear, bottom - d.bottom + m), behavior });
    return to;
  }

  personCard(p, cal) {
    const life = lifeLine(p, cal);
    const el = h('button', {
      type: 'button', class: ['jr-ft-person', p.id === this.selected && 'is-selected', normDate(p.died) && 'is-dead'], 'data-id': p.id, 'data-anchor': itemAnchor(p.name || ''),
      style: p.color ? `--item:${colorVar(p.color)}` : null, 'aria-label': [p.name || 'Unnamed', p.title, life].filter(Boolean).join(', '),
    },
    h('span', { class: 'jr-ft-name' }, p.name || 'Unnamed'),
    p.title ? h('span', { class: 'jr-ft-title' }, p.title) : null,
    life ? h('span', { class: 'jr-ft-life' }, life) : null);
    // before hoverable's own click (which would pin the hover card): see pick()
    el.addEventListener('pointerdown', (e) => { this.pointer = e.pointerType; });
    const light = (on) => { this.hovered = on ? p.id : null; this.lightLines(); };
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') light(true); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && this.hovered === p.id) light(false); });
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) light(true); });
    el.addEventListener('blur', () => { if (this.hovered === p.id) light(false); });
    // arrow keys: Up to a parent, Down to a child, Left / Right along the row (Enter edits, Esc lets go)
    el.addEventListener('keydown', (e) => {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
      if (!dir || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      const to = this.neighbour(p.id, dir);
      if (to) this.goTo(to);
    });
    el.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      const how = e.detail === 0 ? 'key' : this.pointer || 'mouse';
      this.pointer = null;
      this.pick(p, el, how);
    });
    hoverable(el, () => this.personBody(p), { open: () => this.editPerson(p), around: () => this.aroundOf(el) });
    return el;
  }

  relations(p) {
    const { people, unions, childOf } = this.d;
    const name = (id) => people.find((x) => x.id === id)?.name || 'Unnamed';
    const pu = childOf.get(p.id);
    const parents = pu ? pu.partners.map(name) : [];
    const siblings = pu ? pu.children.filter((c) => c !== p.id).map(name) : [];
    const partners = unions.filter((u) => u.partners.includes(p.id)).flatMap((u) => u.partners.filter((x) => x !== p.id).map((x) => `${name(x)}${u.status === 'married' ? '' : ` (${u.status})`}`));
    const children = unions.filter((u) => u.partners.includes(p.id)).flatMap((u) => u.children.map(name));
    return { parents, siblings, partners, children };
  }

  personBody(p) {
    const r = this.relations(p);
    const line = (label, list) => (list.length ? `**${label}:** ${list.join(', ')}` : '');
    const fam = [line('Parents', r.parents), line('Partners', r.partners), line('Children', r.children), line('Siblings', r.siblings)].filter(Boolean).join('  \n');
    return cardBody({
      color: p.color, kicker: p.title || 'Person', title: p.name || 'Unnamed', when: lifeLine(p) || null,
      text: [p.text, fam].filter(Boolean).join('\n\n'), tags: p.tags, note: this.note,
      actions: [
        cardBtn('Edit', 'edit', () => this.editPerson(p)),
        p.name ? cardBtn('Copy link', 'link', () => copyItemLink(this.note, p.name)) : null,
      ].filter(Boolean),
    });
  }

  // ---------- jumping to someone (?h=, [[Note#Name]]) ----------

  reveal(anchor) {
    const el = [...this.stage.querySelectorAll('[data-anchor]')].find((x) => x.dataset.anchor === anchor);
    if (!el) return false;
    const box = this.scroll;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
    box.scrollTop += r.top - b.top - (b.height - r.height) / 2;
    const desk = this.view.host;
    const top = box.getBoundingClientRect().top - desk.getBoundingClientRect().top + desk.scrollTop - 80;
    desk.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    el.classList.remove('jr-flash');
    void el.offsetWidth;
    el.classList.add('jr-flash');
    // selected, with their details open (clear of their actions)
    requestAnimationFrame(() => {
      const p = this.d.people.find((x) => x.id === el.dataset.id);
      if (!p || !el.isConnected) return;
      this.select(p.id);
      hideCard(true);
      showCard(el, () => this.personBody(p), { pinned: true, around: () => this.aroundOf(el) });
    });
    return true;
  }

  // ---------- zoom with Ctrl / Cmd + wheel (and a trackpad's pinch), or two fingers ----------

  wireZoom(box) {
    const at = (x, y) => { const r = box.getBoundingClientRect(); return { x: x - r.left - box.clientLeft, y: y - r.top - box.clientTop }; };
    box.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !this.geo) return;
      e.preventDefault(); // not the page's own zoom
      hideCard(true);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      this.setZoom(this.zoom * Math.exp(-dy * 0.0025), at(e.clientX, e.clientY));
    }, { passive: false });
    // two fingers: the point between them stays under them while they spread, pinch or move
    let pinch = null;
    const two = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) });
    box.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2 || !this.geo) { pinch = null; return; }
      const m = two(e.touches);
      const a = at(m.x, m.y);
      pinch = { d: Math.max(1, m.d), z: this.zoom, tx: (box.scrollLeft + a.x - this.sizer.offsetLeft) / this.zoom, ty: (box.scrollTop + a.y - this.sizer.offsetTop) / this.zoom };
      hideCard(true);
    }, { passive: true });
    box.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const m = two(e.touches);
      const a = at(m.x, m.y);
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (pinch.z * m.d) / pinch.d));
      this.applyZoom();
      box.scrollLeft = pinch.tx * this.zoom + this.sizer.offsetLeft - a.x;
      box.scrollTop = pinch.ty * this.zoom + this.sizer.offsetTop - a.y;
      this.positionActs();
    }, { passive: false });
    const end = (e) => { if (e.touches.length < 2) pinch = null; };
    box.addEventListener('touchend', end);
    box.addEventListener('touchcancel', end);
    box.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS Safari: not the page's zoom
  }

  // ---------- drag to scroll (mouse) ----------

  wirePan(box) {
    let start = null;
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, a')) return;
      this.panned = false;
      start = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop, id: e.pointerId, moved: false };
    });
    box.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      if (!start.moved) { start.moved = true; box.setPointerCapture(e.pointerId); box.classList.add('is-panning'); }
      box.scrollLeft = start.left - dx;
      box.scrollTop = start.top - dy;
    });
    const end = () => { if (start?.moved) { box.classList.remove('is-panning'); this.panned = true; } start = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }

  // ---------- editing ----------

  /** The person form. Resolves the saved person, 'removed', or null. */
  async personForm(p, { title, saveLabel, extra = [] } = {}) {
    const isNew = !p?.id;
    const q = p || {};
    const name = input({ value: q.name || '', maxlength: 120, placeholder: 'e.g. Aldis Vael', autofocus: true });
    const role = input({ value: q.title || '', maxlength: 120, placeholder: 'Optional, e.g. Queen of Vael' });
    const born = dateFields({ value: q.born, legend: 'Born', optional: true, hint: 'Optional. Leave the year blank if it isn’t known.' });
    const died = dateFields({ value: q.died, legend: 'Died', optional: true, ageFallback: normDate(q.born)?.age, hint: 'Leave the year blank while they live.' });
    const color = colorPicker(q.color, { label: 'House colour', none: true });
    const text = textField(q.text);
    const tags = tagsInput(q.tags);
    let out = null;
    const r = await itemDialog({
      title: title || (isNew ? 'New person' : `Edit ${q.name || 'person'}`),
      saveLabel: saveLabel || (isNew ? 'Add person' : 'Save'),
      wide: true,
      fields: [...extra, h('div', { class: 'jr-form-row' }, field('Name', name), field('Title or role', role)), born.el, died.el, color.el, text.el, tags.el, ...(isNew ? [] : [this.familyPanel(q)])],
      remove: isNew ? null : () => confirmDialog(`Remove ${q.name || 'this person'} from the tree? Their partners and children stay.`, { title: 'Remove person', okLabel: 'Remove', danger: true }),
      removeLabel: 'Remove from tree',
      save: (fail) => {
        const n = name.value.trim();
        if (!n) { name.focus(); return fail('Give the person a name.'); }
        const er = born.error() || died.error();
        if (er) return fail(er);
        const b = born.get();
        const dd = died.get();
        if (!notBefore(b, dd)) return fail('They can’t die before they are born.');
        out = clean({ ...q, id: q.id || itemId('p'), name: n, title: role.value.trim(), born: b, died: dd, color: color.get(), text: text.get(), tags: tags.get() });
        return true;
      },
    });
    if (r === 'removed') return 'removed';
    return r === 'saved' ? out : null;
  }

  /** In a person's dialog: their relations, each with a way to unlink it (and a partnership's status). */
  familyPanel(p) {
    const box = h('fieldset', { class: 'field jr-ft-family' }, h('legend', { class: 'field-label' }, 'Family'));
    const d = this.d;
    const name = (id) => d.people.find((x) => x.id === id)?.name || 'Unnamed';
    const rows = [];
    const pu = d.childOf.get(p.id);
    const unlinkBtn = (label, fn) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => { fn(); e.currentTarget.closest('.jr-ft-rel').remove(); } }, label);
    this.pending = [];
    if (pu) {
      rows.push(h('div', { class: 'jr-ft-rel' }, h('span', null, pu.partners.length ? `Child of ${pu.partners.map(name).join(' and ')}` : 'Has siblings (parents unknown)'),
        unlinkBtn('Unlink from parents', () => this.pending.push((un) => { const u = un.find((x) => x.id === pu.id); if (u) u.children = u.children.filter((c) => c !== p.id); }))));
    }
    for (const u of d.unions.filter((x) => x.partners.includes(p.id))) {
      const other = u.partners.find((x) => x !== p.id);
      const kids = u.children.length ? ` · ${u.children.length === 1 ? '1 child' : `${u.children.length} children`}` : '';
      const st = select(STATUS, u.status, (v) => this.pending.push((un) => { const x = un.find((y) => y.id === u.id); if (x) x.status = v; }), { 'aria-label': `With ${other ? name(other) : 'no partner'}: status` });
      rows.push(h('div', { class: 'jr-ft-rel' },
        h('span', null, other ? `With ${name(other)}${kids}` : `Children on their own${kids}`),
        other ? st : null,
        other ? unlinkBtn('Unlink', () => this.pending.push((un) => { const x = un.find((y) => y.id === u.id); if (x) x.partners = x.partners.filter((y) => y !== p.id); })) : null));
    }
    if (!rows.length) rows.push(h('p', { class: 'jr-hint' }, 'No relatives yet. Select their card on the tree to add a parent, partner, child or sibling.'));
    box.append(...rows);
    return box;
  }

  async editPerson(p) {
    const res = await this.personForm(p);
    const pending = this.pending || [];
    this.pending = [];
    if (!res) return;
    const { people, unions } = this.data;
    if (res === 'removed') {
      const left = people.filter((x) => x.id !== p.id);
      const un = unions.map((u) => ({ ...u, partners: u.partners.filter((x) => x !== p.id), children: u.children.filter((x) => x !== p.id) }));
      if (this.selected === p.id) this.selected = null;
      this.save(left, un);
      return;
    }
    const un = unions.map((u) => ({ ...u, partners: [...u.partners], children: [...u.children] }));
    pending.forEach((fn) => fn(un));
    const next = p ? people.map((x) => (x.id === p.id ? res : x)) : [...people, res];
    if (!p) this.selected = res.id;
    this.save(next, un);
    requestAnimationFrame(() => this.flash(res.id));
  }

  /** Someone just added or edited: bring them into view and flash their card. */
  flash(id) {
    const el = this.cardEl(id);
    if (!el) return;
    const to = this.bringIntoView(id);
    if (to) this.positionActs(to);
    // the dialog's opener went with the old toolbar or card: the keyboard goes on from this card (its actions next)
    const ae = document.activeElement;
    if (!ae || ae === document.body || !ae.isConnected) el.focus({ preventScroll: true });
    el.classList.remove('jr-flash');
    void el.offsetWidth;
    el.classList.add('jr-flash');
  }

  /** Add a parent, partner, child or sibling of `p`: someone new or someone already in the tree. */
  async addRelative(p, kind) {
    if (!p) return;
    const { people, unions, childOf } = this.data;
    const pu = childOf.get(p.id);
    if (kind === 'parent' && pu && pu.partners.length >= 2) {
      await confirmDialog(`${p.name || 'They'} already has two parents in the tree. Unlink one in their dialog first.`, { title: 'Two parents already', okLabel: 'OK' });
      return;
    }
    const noun = { parent: 'parent', partner: 'partner', child: 'child', sibling: 'sibling' }[kind];
    // who may be picked from the tree
    const taken = new Set([p.id]);
    if (kind === 'parent') { pu?.partners.forEach((x) => taken.add(x)); pu?.children.forEach((x) => taken.add(x)); }
    if (kind === 'partner') unions.filter((u) => u.partners.includes(p.id)).forEach((u) => u.partners.forEach((x) => taken.add(x)));
    if (kind === 'child' || kind === 'sibling') people.forEach((x) => { if (childOf.has(x.id)) taken.add(x.id); });
    const others = people.filter((x) => !taken.has(x.id));
    const extra = [];
    let pickSel = null;
    if (others.length) {
      pickSel = select([{ value: '', label: `Someone new (fill in below)` }, ...others.map((x) => ({ value: x.id, label: x.name || 'Unnamed' }))], '', (v) => {
        pickSel.closest('.jr-item-form').classList.toggle('is-existing', !!v);
      });
      extra.push(field('Who', pickSel, `Pick someone already in the tree, or add someone new.`));
    }
    let withSel = null;
    const own = unions.filter((u) => u.partners.includes(p.id));
    if (kind === 'child') {
      const opts = [...own.filter((u) => u.partners.length === 2).map((u) => ({ value: u.id, label: `With ${people.find((x) => x.id === u.partners.find((y) => y !== p.id))?.name || 'their partner'}` })), { value: '', label: 'Their parent alone (other parent unknown)' }];
      withSel = select(opts, opts[0].value);
      extra.push(field('Other parent', withSel));
    }
    let statusSel = null;
    if (kind === 'partner') { statusSel = select(STATUS, 'married'); extra.push(field('Together as', statusSel)); }
    const res = await this.personFormOrPick({ title: `Add a ${noun} of ${p.name || 'this person'}`, saveLabel: `Add ${noun}`, extra, pickSel });
    if (!res) return;
    const ppl = res.isNew ? [...people, res.person] : people;
    const un = unions.map((u) => ({ ...u, partners: [...u.partners], children: [...u.children] }));
    const q = res.person.id;
    const nid = () => itemId('u');
    if (kind === 'parent') {
      const u = pu && un.find((x) => x.id === pu.id);
      if (u) u.partners.push(q); else un.push({ id: nid(), partners: [q], children: [p.id], status: 'married' });
    } else if (kind === 'partner') {
      un.push({ id: nid(), partners: [p.id, q], children: [], status: statusSel.value });
    } else if (kind === 'child') {
      let u = withSel.value ? un.find((x) => x.id === withSel.value) : un.find((x) => x.partners.length === 1 && x.partners[0] === p.id);
      if (!u) { u = { id: nid(), partners: [p.id], children: [], status: 'married' }; un.push(u); }
      u.children.push(q);
    } else if (kind === 'sibling') {
      let u = pu && un.find((x) => x.id === pu.id);
      if (!u) { u = { id: nid(), partners: [], children: [p.id], status: 'married' }; un.push(u); }
      u.children.push(q);
    }
    this.selected = q;
    this.save(ppl, un);
    requestAnimationFrame(() => this.flash(q));
  }

  /** The person form with an optional "Who" picker in front: an existing person needs no form. */
  async personFormOrPick({ title, saveLabel, extra, pickSel }) {
    let picked = null;
    if (pickSel) pickSel.addEventListener('change', () => { picked = pickSel.value || null; });
    const res = await this.personFormMaybe({ title, saveLabel, extra, isPicked: () => picked });
    if (!res) return null;
    if (picked) return { isNew: false, person: this.d.people.find((x) => x.id === picked) };
    return { isNew: true, person: res };
  }

  personFormMaybe({ title, saveLabel, extra, isPicked }) {
    // same form as a new person; when someone is picked, its own fields don't need filling
    const name = input({ value: '', maxlength: 120, placeholder: 'e.g. Aldis Vael', autofocus: true });
    const role = input({ value: '', maxlength: 120, placeholder: 'Optional, e.g. Queen of Vael' });
    const born = dateFields({ legend: 'Born', optional: true });
    const died = dateFields({ legend: 'Died', optional: true });
    const color = colorPicker(null, { label: 'House colour', none: true });
    let out = null;
    return itemDialog({
      title, saveLabel, wide: true,
      fields: [...extra, h('div', { class: 'jr-ft-newbits' }, h('div', { class: 'jr-form-row' }, field('Name', name), field('Title or role', role)), born.el, died.el, color.el,
        h('p', { class: 'jr-hint' }, 'Add a description and tags later: double click their card, or Edit on it.'))],
      save: (fail) => {
        if (isPicked()) { out = true; return true; }
        const n = name.value.trim();
        if (!n) { name.focus(); return fail('Give the person a name, or pick someone already in the tree.'); }
        const er = born.error() || died.error();
        if (er) return fail(er);
        if (!notBefore(born.get(), died.get())) return fail('They can’t die before they are born.');
        out = clean({ id: itemId('p'), name: n, title: role.value.trim(), born: born.get(), died: died.get(), color: color.get() });
        return true;
      },
    }).then((r) => (r === 'saved' ? out : null));
  }
}
