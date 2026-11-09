// A Timeline note's board: a toolbar (add an Event, an Age, a Sub-timeline or a Marker; the Ages menu; the view:
// horizontal or vertical; spacing) over the timeline. Everything is placed by its date (year + optional month + age;
// calendar.js orders the ages). Spacing between dates grows with the years between them, and stretches wherever a
// title needs the room, so every event shows its title and year. Ages are bands on the axis, sub-timelines are
// coloured bars (and a wash over their stretch of the timeline), markers are diamonds on the axis. Hovering an item
// (or tapping it) shows its expanded view: description, tags, links. Data: kinds.js boardData; saved through the
// note view's setBoard.
import { h } from '../../core/dom.js';
import { icon, field, input, confirmDialog } from '../../core/ui.js';
import { calendar, normDate, dateKey, cmpKey, fmtDate, fmtRange, colorVar, yearsBetween } from './calendar.js';
import { boardData, itemAnchor } from './kinds.js';
import { symbolIcon, symbolLabel } from './symbols.js';
import {
  dateFields, tagsInput, colorPicker, symbolPicker, textField, itemDialog, notBefore,
  hoverable, showCard, hideCard, cardBody, cardBtn, copyItemLink, itemId,
} from './board.js';
import { agesDialog } from './ages.js';
import { plural } from './text.js';

const BIG = 1e12; // the open end of an age without a set range
const ORDER = { 'age-start': 0, 'span-from': 1, event: 2, marker: 3, 'span-to': 4, 'age-end': 5 };

// horizontal geometry (px)
const H = { padX: 58, top: 10, laneGap: 10, lanes: 4, stem: 16, axisH: 30, markRow: 20, spanH: 22, spanGap: 6, bottom: 14, gapX: 12, maxCard: 280 };
// vertical geometry
const V = { dateW: 128, axisH: 26, spanW: 22, spanGap: 6, padTop: 52, cardGap: 10, maxCard: 460 };
const MIN_GAP = 18;
const SCALE = 22;
const AGE_GAP = 76;
const EDGE_GAP = 26;
const EMPTY_AGE = 150;

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const same = (a, b) => a === b || (!!a?.id && a.id === b?.id);

/** The timeline as it is saved (no empty lists). */
function compact(d) {
  return clean({ view: d.view, ages: d.ages, events: d.events, spans: d.spans, markers: d.markers });
}

export class TimelineBoard {
  /** view: the NoteView (fm, current, setBoard, editing). */
  constructor(view) {
    this.view = view;
    this.zoom = 1;
    this.lastAge = null;
    this.el = h('section', { class: 'jr-board jr-tl', 'aria-label': 'Timeline' });
    // the vertical view fits its cards to the width: lay out again when the width (not the height) changes
    this.ro = new ResizeObserver(() => {
      if (this.d?.view === 'vertical' && this.el.isConnected && Math.abs(this.scroll.clientWidth - (this.lastWidth || 0)) > 1) this.layoutSoon();
    });
    this.render();
    document.fonts?.ready.then(() => { if (!this.destroyed) this.layout(); });
  }

  get note() { return this.view.current; }
  get data() { return boardData(this.view.fm); }

  save(d) {
    this.view.setBoard(compact(d));
    this.render();
  }

  destroy() {
    this.destroyed = true;
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    hideCard(true);
  }

  // ---------- toolbar ----------

  toolbar(d) {
    const tool = (label, ic, onClick, title) => h('button', { type: 'button', class: 'btn btn-sm jr-tool', title, onclick: onClick }, icon(ic), h('span', null, label));
    const seg = (label, ic, on, onClick) => h('button', { type: 'button', class: 'jr-seg-btn', 'aria-pressed': String(on), onclick: onClick, title: `${label} view`, 'aria-label': `${label} view` }, icon(ic), h('span', { class: 'jr-seg-label' }, label));
    const setView = (v) => { if (this.data.view === v) return; const nd = this.data; nd.view = v; this.save(nd); };
    return h('div', { class: 'jr-tools', role: 'toolbar', 'aria-label': 'Timeline tools' },
      h('div', { class: 'jr-tools-group', role: 'group', 'aria-label': 'Add to the timeline, and the ages' },
        h('span', { class: 'jr-tools-cap' }, 'Add'),
        tool('Event', 'star', () => this.editEvent(null), 'Add an event: a title, its date and age, a symbol, a description and tags'),
        tool('Age', 'layers', () => this.addAge(), 'Add an age to the master list (its description and range) and show it here'),
        tool('Sub-timeline', 'ruler', () => this.editSpan(null), 'Highlight a stretch of the timeline in a colour: a reign, a war, a time of something'),
        tool('Marker', 'sym-marker', () => this.editMarker(null), 'Place a simple marker at a year'),
        h('span', { class: 'jr-tools-sep', 'aria-hidden': 'true' }),
        tool('Ages', 'clock', () => this.openAges(), 'The master list of ages: their order, descriptions and ranges')),
      h('div', { class: 'jr-tools-group jr-tools-end' },
        h('span', { class: 'jr-tools-cap' }, 'View'),
        h('div', { class: 'jr-seg', role: 'group', 'aria-label': 'View' },
          seg('Horizontal', 'timeline', d.view !== 'vertical', () => setView('horizontal')),
          seg('Vertical', 'sort', d.view === 'vertical', () => setView('vertical'))),
        h('span', { class: 'jr-tools-cap' }, 'Spacing'),
        h('div', { class: 'jr-seg', role: 'group', 'aria-label': 'Spacing' },
          h('button', { type: 'button', class: 'jr-seg-btn', title: 'Closer together', 'aria-label': 'Closer together', disabled: this.zoom <= 0.4, onclick: () => this.setZoom(this.zoom / 1.5) }, icon('minus')),
          h('button', { type: 'button', class: 'jr-seg-btn', title: 'Further apart', 'aria-label': 'Further apart', disabled: this.zoom >= 4, onclick: () => this.setZoom(this.zoom * 1.5) }, icon('plus')))));
  }

  setZoom(z) {
    this.zoom = Math.max(0.4, Math.min(4, Math.round(z * 100) / 100));
    const box = this.scroll;
    const ratio = box && box.scrollWidth > box.clientWidth ? (box.scrollLeft + box.clientWidth / 2) / box.scrollWidth : 0;
    this.render();
    if (ratio && this.scroll) this.scroll.scrollLeft = ratio * this.scroll.scrollWidth - this.scroll.clientWidth / 2;
  }

  // ---------- rendering ----------

  render() {
    hideCard(true);
    const d = this.data;
    this.d = d;
    this.el.dataset.view = d.view;
    this.stage = h('div', { class: 'jr-tl-stage' });
    this.scroll = h('div', { class: 'jr-tl-scroll', tabindex: '0', 'aria-label': 'Timeline, scroll to see more' }, this.stage);
    this.wirePan(this.scroll);
    const empty = !d.events.length && !d.spans.length && !d.markers.length;
    this.el.replaceChildren(...[this.toolbar(d), this.scroll,
      empty ? h('p', { class: 'jr-hint jr-tl-empty' }, 'Nothing on this timeline yet. Add an event, an age, a sub-timeline or a marker with the buttons above; each falls into place by its year and age.') : null].filter(Boolean));
    this.ro.disconnect();
    this.ro.observe(this.scroll);
    this.layout();
  }

  layoutSoon() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.layout());
  }

  /** Measure, place and draw everything (needs the board in the page; retries until it is). */
  layout() {
    cancelAnimationFrame(this.raf);
    if (this.destroyed) return;
    if (!this.el.isConnected) { this.layoutSoon(); return; }
    const cal = calendar();
    this.cal = cal;
    const pts = this.points(this.d, cal);
    this.stage.replaceChildren();
    if (this.d.view === 'vertical') this.layoutV(pts, cal); else this.layoutH(pts, cal);
    this.lastWidth = this.scroll.clientWidth;
  }

  /** Every dated thing as a point on the axis, in order. */
  points(d, cal) {
    const pts = [];
    const shown = new Set(d.ages.filter((id) => cal.byId.has(id)));
    const push = (type, date, item) => {
      const n = normDate(date);
      if (!n) return;
      pts.push({ type, key: dateKey(n, cal), item, date: n });
      if (cal.byId.has(n.age)) shown.add(n.age);
    };
    d.events.forEach((e) => push('event', e, e));
    d.markers.forEach((m) => push('marker', m, m));
    d.spans.forEach((s) => { push('span-from', s.from, s); push('span-to', s.to, s); });
    if (!shown.size && cal.ages.length) shown.add(cal.defaultAge); // an empty timeline shows the default age
    const ages = [...shown].sort((x, y) => cal.byId.get(x).index - cal.byId.get(y).index); // in order, for the tab order too
    for (const id of ages) {
      const a = cal.byId.get(id);
      const sign = a.countdown ? -1 : 1;
      let lo = -BIG;
      let hi = BIG;
      if (a.start != null && a.end != null) { lo = Math.min(a.start * sign, a.end * sign); hi = Math.max(a.start * sign, a.end * sign); }
      else if (a.start != null) lo = a.start * sign;
      else if (a.end != null) hi = a.end * sign;
      pts.push({ type: 'age-start', key: [a.index, lo, 0], age: a });
      pts.push({ type: 'age-end', key: [a.index, hi, 99], age: a });
    }
    pts.sort((p, q) => cmpKey(p.key, q.key) || ORDER[p.type] - ORDER[q.type]);
    this.shown = ages;
    return pts;
  }

  /** Room between two dates: more years, more room (log scale), a fixed step between ages. */
  gap(k1, k2, prevType, type) {
    if (cmpKey(k1, k2) === 0) return 0;
    if (k1[0] !== k2[0]) return AGE_GAP;
    if (prevType === 'age-start' && type === 'age-end' && k1[1] <= -BIG && k2[1] >= BIG) return EMPTY_AGE;
    if (Math.abs(k1[1]) >= BIG || Math.abs(k2[1]) >= BIG) return EDGE_GAP;
    const months = this.cal.months.length || 12;
    const m1 = Math.min(k1[2], months);
    const m2 = Math.min(k2[2], months);
    const dy = Math.max(0, k2[1] - k1[1] + (m2 - m1) / months);
    return Math.min(320 * this.zoom, MIN_GAP + SCALE * this.zoom * Math.log2(1 + dy));
  }

  groups(pts) {
    const out = [];
    for (const p of pts) {
      const g = out[out.length - 1];
      if (g && cmpKey(g.key, p.key) === 0) g.pts.push(p);
      else out.push({ key: p.key, pts: [p] });
    }
    return out;
  }

  // ---------- items ----------

  eventCard(p) {
    const e = p.item;
    const sym = symbolIcon(e.symbol);
    const age = this.cal.byId.get(p.date.age);
    p.color = colorVar(age?.color, 'slate');
    const el = h('button', {
      type: 'button', class: 'jr-tl-event', 'data-anchor': itemAnchor(e.title || ''), style: `--item:${p.color}`,
      'aria-label': `${e.title || 'Untitled event'}, ${fmtDate(p.date, { cal: this.cal })}`,
    },
    sym ? h('span', { class: 'jr-tl-sym', title: symbolLabel(e.symbol) }, icon(sym)) : null,
    h('span', { class: 'jr-tl-ev-text' },
      h('span', { class: 'jr-tl-ev-title' }, e.title || 'Untitled event'),
      h('span', { class: 'jr-tl-ev-date' }, fmtDate(p.date, { cal: this.cal }))));
    hoverable(el, () => this.eventBody(p), { open: () => this.editEvent(e) });
    return el;
  }

  eventBody(p) {
    const e = p.item;
    const age = this.cal.byId.get(p.date.age);
    return cardBody({
      glyph: symbolIcon(e.symbol), color: age?.color,
      kicker: [e.symbol ? symbolLabel(e.symbol) : 'Event', age?.name].filter(Boolean).join(' · '),
      title: e.title || 'Untitled event', when: fmtDate(p.date, { cal: this.cal }), text: e.text, tags: e.tags, note: this.note,
      actions: [cardBtn('Edit', 'edit', () => this.editEvent(e)), e.title ? cardBtn('Copy link', 'link', () => copyItemLink(this.note, e.title)) : null].filter(Boolean),
    });
  }

  spanBody(s) {
    const yrs = yearsBetween(s.from, s.to, this.cal);
    const len = yrs != null && yrs >= 1 ? ` (${plural(Math.round(yrs), 'year')})` : '';
    return cardBody({
      color: s.color || 'lapis', kicker: 'Sub-timeline', title: s.title || 'Untitled', when: `${fmtRange(s.from, s.to, { cal: this.cal })}${normDate(s.to) ? '' : ' ongoing'}${len}`,
      text: s.text, tags: s.tags, note: this.note,
      actions: [cardBtn('Edit', 'edit', () => this.editSpan(s)), s.title ? cardBtn('Copy link', 'link', () => copyItemLink(this.note, s.title)) : null].filter(Boolean),
    });
  }

  ageBody(a) {
    const range = a.start != null || a.end != null ? `${a.start ?? '…'} – ${a.end ?? 'ongoing'} ${a.abbr}` : null;
    const listed = this.d.ages.includes(a.id);
    const usedHere = this.usedAges().has(a.id);
    return cardBody({
      color: a.color, kicker: 'Age', title: `${a.name} (${a.abbr})`, when: [range, a.countdown ? 'years count down' : null].filter(Boolean).join(' · ') || null,
      text: a.text, tags: a.tags,
      actions: [
        cardBtn('Edit ages', 'clock', () => this.openAges()),
        cardBtn('Copy link', 'link', () => copyItemLink(this.note, a.name)),
        listed && !usedHere ? cardBtn('Remove from this timeline', 'eye-off', () => { const nd = this.data; nd.ages = nd.ages.filter((x) => x !== a.id); this.save(nd); }) : null,
      ].filter(Boolean),
    });
  }

  markerBody(p) {
    const m = p.item;
    return cardBody({
      color: m.color || 'rubric', kicker: 'Marker', title: m.label || fmtDate(p.date, { cal: this.cal }), when: m.label ? fmtDate(p.date, { cal: this.cal }) : null,
      actions: [cardBtn('Edit', 'edit', () => this.editMarker(m))],
    });
  }

  markerEl(p) {
    const m = p.item;
    const el = h('button', {
      type: 'button', class: 'jr-tl-marker', style: `--item:${colorVar(m.color, 'rubric')}`,
      'aria-label': `Marker${m.label ? ` ${m.label}` : ''}, ${fmtDate(p.date, { cal: this.cal })}`,
    }, h('span', { class: 'jr-tl-diamond', 'aria-hidden': 'true' }));
    hoverable(el, () => this.markerBody(p), { open: () => this.editMarker(m) });
    return el;
  }

  ageEl(a, horizontal) {
    const el = h('button', {
      type: 'button', class: 'jr-tl-age', style: `--item:${colorVar(a.color)}`, 'aria-label': `Age: ${a.name} (${a.abbr})`, 'data-anchor': itemAnchor(a.name),
    }, h('span', { class: 'jr-tl-age-name' }, h('strong', null, a.abbr), horizontal ? h('span', null, a.name) : null));
    hoverable(el, () => this.ageBody(a), { open: () => this.openAges() });
    return el;
  }

  spanEl(s) {
    const el = h('button', {
      type: 'button', class: ['jr-tl-span', !normDate(s.to) && 'is-open'], style: `--item:${colorVar(s.color, 'lapis')}`, 'data-anchor': itemAnchor(s.title || ''),
      'aria-label': `Sub-timeline ${s.title || 'Untitled'}, ${fmtRange(s.from, s.to, { cal: this.cal })}`,
    }, h('span', { class: 'jr-tl-span-name' }, s.title || 'Untitled'));
    hoverable(el, () => this.spanBody(s), { open: () => this.editSpan(s) });
    return el;
  }

  /** A sub-timeline's colour on the axis (for the mouse; its labelled bar is what keyboards and screen readers use). */
  highlightEl(s) {
    const el = h('button', { type: 'button', class: 'jr-tl-hl', tabindex: '-1', 'aria-hidden': 'true', style: `--item:${colorVar(s.color, 'lapis')}` });
    hoverable(el, () => this.spanBody(s), { open: () => this.editSpan(s) });
    el.addEventListener('pointerenter', () => this.washOn(s, true));
    el.addEventListener('pointerleave', () => this.washOn(s, false));
    return el;
  }

  usedAges() {
    const used = new Set();
    const d = this.data;
    for (const x of [...d.events, ...d.markers, ...d.spans.flatMap((s) => [s.from, s.to])]) { const n = normDate(x); if (n) used.add(n.age); }
    return used;
  }

  // ---------- horizontal ----------

  layoutH(pts, cal) {
    const stage = this.stage;
    const measure = h('div', { class: 'jr-tl-measure' });
    stage.append(measure);
    const evs = pts.filter((p) => p.type === 'event');
    for (const p of evs) { p.el = this.eventCard(p); measure.append(p.el); }
    // a card is as wide as its title; a longer title wraps onto a second line rather than being cut
    for (const p of evs) p.w = Math.ceil(p.el.getBoundingClientRect().width) + 2;
    for (const p of evs) if (p.w > H.maxCard) { p.w = H.maxCard; p.el.classList.add('is-wrapped'); p.el.style.width = `${H.maxCard}px`; }
    for (const p of evs) p.hh = Math.ceil(p.el.getBoundingClientRect().height);
    measure.remove();
    const cardH = evs.reduce((m, p) => Math.max(m, p.hh), 46);

    // x: dates in order, the room between them from the years; events take the lowest free lane above the axis, and
    // push everything after them along when no lane is free, so no title is ever covered or cut.
    const laneRight = Array(H.lanes).fill(-Infinity);
    let x = H.padX;
    let prev = null;
    let maxRight = H.padX;
    let lanes = 0;
    for (const g of this.groups(pts)) {
      if (prev) x += this.gap(prev.key, g.key, prev.pts[prev.pts.length - 1].type, g.pts[0].type);
      const ge = g.pts.filter((p) => p.type === 'event');
      let gx = null;
      for (let i = 0; i < ge.length; i += H.lanes) {
        const chunk = ge.slice(i, i + H.lanes);
        const rights = [...laneRight].sort((a, b) => a - b);
        x = Math.max(x, rights[chunk.length - 1] + H.gapX);
        const free = laneRight.map((r, l) => ({ r, l })).filter((o) => o.r + H.gapX <= x).map((o) => o.l);
        chunk.forEach((p, j) => {
          p.lane = free[j];
          p.x = x;
          laneRight[p.lane] = x + p.w;
          lanes = Math.max(lanes, p.lane + 1);
          maxRight = Math.max(maxRight, x + p.w);
        });
        gx ??= x;
      }
      g.pts.forEach((p) => { if (p.type !== 'event') p.x = gx ?? x; });
      maxRight = Math.max(maxRight, x);
      prev = g;
    }
    const width = Math.max(maxRight + H.padX, this.scroll.clientWidth - 2);

    // y: event lanes, the axis, marker labels, sub-timeline lanes
    const step = cardH + H.laneGap;
    const axisY = H.top + Math.max(lanes, 1) * step + H.stem;
    // the axis runs along the top edge of the age bands, so event dots and markers never sit on an age's name
    const axisMid = axisY;
    const marks = pts.filter((p) => p.type === 'marker');
    const markRows = marks.some((p) => p.item.label) ? 2 : 0;
    const spanTop = axisY + H.axisH + 8 + markRows * H.markRow;
    const spans = this.spanGeom(pts, width - H.padX / 2);
    const spanLanes = spans.reduce((m, s) => Math.max(m, s.lane + 1), 0);
    const height = spanTop + spanLanes * (H.spanH + H.spanGap) + H.bottom;
    stage.style.width = `${Math.ceil(width)}px`;
    stage.style.height = `${Math.ceil(height)}px`;

    const put = (el, x0, y0, w, hh) => {
      el.style.left = `${Math.round(x0)}px`;
      el.style.top = `${Math.round(y0)}px`;
      if (w != null) el.style.width = `${Math.round(w)}px`;
      if (hh != null) el.style.height = `${Math.round(hh)}px`;
      stage.append(el);
      return el;
    };

    // sub-timelines: a wash over their stretch, behind everything
    for (const s of spans) put(h('div', { class: 'jr-tl-wash', style: `--item:${colorVar(s.item.color, 'lapis')}`, 'data-span': s.item.id || '' }), s.x1, 0, Math.max(4, s.x2 - s.x1), height);
    put(h('div', { class: 'jr-tl-axis', 'aria-hidden': 'true' }), 0, axisMid - 1, width, 2);
    for (const a of this.ageGeom(pts)) put(this.ageEl(a.age, true), a.x1, axisY, a.x2 - a.x1, H.axisH);
    // each sub-timeline also colours the axis itself over its stretch (thin strips stacked above the line)
    for (const s of spans) put(this.highlightEl(s.item), s.x1, axisY - 5 - Math.min(s.lane, 3) * 5, Math.max(4, s.x2 - s.x1), 5);
    for (const p of evs) {
      const bottom = axisY - H.stem + 6 - p.lane * step;
      put(h('div', { class: 'jr-tl-stem', 'aria-hidden': 'true' }), p.x, bottom, 2, axisMid - bottom);
      put(h('div', { class: 'jr-tl-dot', 'aria-hidden': 'true', style: `--item:${p.color}` }), p.x - 5, axisMid - 5);
      put(p.el, p.x, bottom - p.hh, p.w, p.hh);
    }
    // markers: diamonds on the axis; labels in two rows under it (a label that would overlap both rows waits for
    // the hover card)
    const rowRight = [-Infinity, -Infinity];
    for (const p of marks) {
      const el = put(this.markerEl(p), p.x - 9, axisMid - 9);
      if (!p.item.label) continue;
      const lab = h('span', { class: 'jr-tl-mark-label', style: `--item:${colorVar(p.item.color, 'rubric')}` }, p.item.label);
      stage.append(lab);
      const w = lab.getBoundingClientRect().width;
      const row = rowRight.findIndex((r) => r + 8 <= p.x - w / 2);
      if (row < 0) { lab.remove(); continue; }
      rowRight[row] = p.x + w / 2;
      lab.style.left = `${Math.round(p.x - w / 2)}px`;
      lab.style.top = `${Math.round(axisY + H.axisH + 3 + row * H.markRow)}px`;
    }
    for (const s of spans) {
      const el = put(this.spanEl(s.item), s.x1, spanTop + s.lane * (H.spanH + H.spanGap), Math.max(14, s.x2 - s.x1), H.spanH);
      el.addEventListener('pointerenter', () => this.washOn(s.item, true));
      el.addEventListener('pointerleave', () => this.washOn(s.item, false));
    }
  }

  washOn(s, on) {
    this.stage.querySelectorAll('.jr-tl-wash').forEach((w) => { if (w.dataset.span === (s.id || '')) w.classList.toggle('is-lit', on); });
  }

  /** Bands of the ages shown: from the first to the last point in each (its range included). */
  ageGeom(pts) {
    const out = [];
    for (const id of this.shown) {
      const a = this.cal.byId.get(id);
      const xs = pts.filter((p) => p.key[0] === a.index).map((p) => p.x ?? p.y);
      if (!xs.length) continue;
      const x1 = Math.min(...xs) - 44; // room for the abbreviation before the first date
      out.push({ age: a, x1, x2: Math.max(Math.max(...xs) + 14, x1 + 70) });
    }
    return out;
  }

  /** Sub-timelines as [x1, x2] in lanes (an open one runs to `end`). */
  spanGeom(pts, end) {
    const list = [];
    for (const p of pts) {
      if (p.type !== 'span-from') continue;
      const to = pts.find((q) => q.type === 'span-to' && q.item === p.item);
      const x1 = p.x ?? p.y;
      list.push({ item: p.item, x1, x2: to ? (to.x ?? to.y) : end });
    }
    list.sort((a, b) => a.x1 - b.x1 || b.x2 - a.x2);
    const lanes = [];
    for (const s of list) {
      let l = lanes.findIndex((r) => r + 4 <= s.x1);
      if (l < 0) { l = lanes.length; lanes.push(0); }
      lanes[l] = Math.max(s.x2, s.x1 + 14);
      s.lane = l;
    }
    return list;
  }

  // ---------- vertical ----------

  layoutV(pts, cal) {
    const stage = this.stage;
    const width = Math.max(260, this.scroll.clientWidth - 16);
    const narrow = width < 520;
    this.el.classList.toggle('is-narrow', narrow);
    const evs = pts.filter((p) => p.type === 'event');
    // the dates left of the axis, as wide as the longest; a narrow page shows each date in its card instead
    let dateW = 0;
    if (!narrow) {
      const m = h('div', { class: 'jr-tl-measure' });
      stage.replaceChildren(m);
      const labels = [...evs.map((p) => fmtDate(p.date, { cal })), ...pts.filter((p) => p.type === 'marker').map((p) => p.item.label || '')];
      for (const t of labels) if (t) m.append(h('span', { class: 'jr-tl-vdate' }, t));
      dateW = Math.min(180, Math.max(64, ...[...m.children].map((x) => Math.ceil(x.getBoundingClientRect().width) + 4)));
      m.remove();
    }
    const axisX = dateW + (narrow ? 4 : 10);
    const spanW = narrow ? 18 : V.spanW;

    // sub-timeline lanes need the points' y first; place with a provisional lane count and redo once if needed
    const spanCount = (n) => n * (spanW + V.spanGap);
    let spanLanes = 0;
    let geo = null;
    for (let pass = 0; pass < 2; pass++) {
      const cardX = axisX + V.axisH + 10 + spanCount(spanLanes) + 8;
      const cardW = Math.min(V.maxCard, width - cardX - 8);
      const measure = h('div', { class: 'jr-tl-measure is-vertical' });
      stage.replaceChildren(measure);
      for (const p of evs) { p.el = this.eventCard(p); p.el.style.width = `${cardW}px`; measure.append(p.el); }
      for (const p of evs) p.hh = Math.ceil(p.el.getBoundingClientRect().height);
      measure.remove();
      let y = V.padTop;
      let prev = null;
      let lastBottom = -Infinity;
      for (const g of this.groups(pts)) {
        if (prev) y += this.gap(prev.key, g.key, prev.pts[prev.pts.length - 1].type, g.pts[0].type) * 0.8;
        const ge = g.pts.filter((p) => p.type === 'event');
        let gy = null;
        for (const p of ge) {
          const top = y - 14;
          if (top < lastBottom + V.cardGap) y += lastBottom + V.cardGap - top;
          p.y = y;
          lastBottom = y - 14 + p.hh;
          gy ??= y;
        }
        g.pts.forEach((p) => { if (p.type !== 'event') p.y = gy ?? y; });
        prev = g;
      }
      const end = Math.max(y, lastBottom) + 16;
      const spans = this.spanGeom(pts, end);
      const need = spans.reduce((m, s) => Math.max(m, s.lane + 1), 0);
      geo = { cardX, cardW, end, spans };
      if (need === spanLanes) break;
      spanLanes = need;
    }
    const height = geo.end + 14;
    stage.style.width = '100%';
    stage.style.height = `${Math.ceil(height)}px`;
    const put = (el, x0, y0, w, hh) => {
      el.style.left = `${Math.round(x0)}px`;
      el.style.top = `${Math.round(y0)}px`;
      if (w != null) el.style.width = `${Math.round(w)}px`;
      if (hh != null) el.style.height = `${Math.round(hh)}px`;
      stage.append(el);
      return el;
    };
    const axisMid = axisX + V.axisH / 2;
    for (const s of geo.spans) put(h('div', { class: 'jr-tl-wash', style: `--item:${colorVar(s.item.color, 'lapis')}`, 'data-span': s.item.id || '' }), 0, s.y1 ?? s.x1, width, Math.max(4, s.x2 - s.x1));
    put(h('div', { class: 'jr-tl-axis is-vertical', 'aria-hidden': 'true' }), axisMid - 1, 0, 2, height);
    for (const a of this.ageGeom(pts)) put(this.ageEl(a.age, false), axisX, a.x1, V.axisH, a.x2 - a.x1);
    for (const s of geo.spans) put(this.highlightEl(s.item), axisX - 5 - Math.min(s.lane, 3) * 5, s.x1, 5, Math.max(4, s.x2 - s.x1));
    for (const p of evs) {
      put(h('div', { class: 'jr-tl-stem is-vertical', 'aria-hidden': 'true' }), axisMid, p.y, geo.cardX - axisMid, 2);
      put(h('div', { class: 'jr-tl-dot', 'aria-hidden': 'true', style: `--item:${p.color}` }), axisMid - 5, p.y - 4);
      if (!narrow) put(h('span', { class: 'jr-tl-vdate' }, fmtDate(p.date, { cal })), 0, p.y - 10, dateW);
      put(p.el, geo.cardX, p.y - 14, geo.cardW);
    }
    const dated = new Set(evs.map((p) => Math.round(p.y)));
    for (const p of pts.filter((q) => q.type === 'marker')) {
      const el = put(this.markerEl(p), axisMid - 9, p.y - 9);
      if (!narrow && p.item.label && !dated.has(Math.round(p.y))) put(h('span', { class: 'jr-tl-vdate is-marker', style: `--item:${colorVar(p.item.color, 'rubric')}` }, p.item.label), 0, p.y - 10, dateW);
    }
    for (const s of geo.spans) {
      const el = put(this.spanEl(s.item), axisX + V.axisH + 10 + s.lane * (spanW + V.spanGap), s.x1, spanW, Math.max(14, s.x2 - s.x1));
      el.classList.add('is-vertical');
      el.addEventListener('pointerenter', () => this.washOn(s.item, true));
      el.addEventListener('pointerleave', () => this.washOn(s.item, false));
    }
  }

  // ---------- jumping to an item (?h=, [[Note#Item]]) ----------

  /** Scroll an item into view, flash it and open its card. -> true when found */
  reveal(anchor) {
    const el = [...this.stage.querySelectorAll('[data-anchor]')].find((x) => x.dataset.anchor === anchor);
    if (!el) return false;
    const box = this.scroll;
    if (this.d.view !== 'vertical') {
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      box.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
    }
    const desk = this.view.host;
    const top = el.getBoundingClientRect().top - desk.getBoundingClientRect().top + desk.scrollTop - desk.clientHeight / 3;
    desk.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    el.classList.remove('jr-flash');
    void el.offsetWidth;
    el.classList.add('jr-flash');
    requestAnimationFrame(() => el.click());
    return true;
  }

  // ---------- drag to scroll (mouse) ----------

  wirePan(box) {
    let start = null;
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, a') || this.d.view === 'vertical') return;
      start = { x: e.clientX, left: box.scrollLeft, id: e.pointerId, moved: false };
    });
    box.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      if (!start.moved && Math.abs(dx) < 4) return;
      if (!start.moved) { start.moved = true; box.setPointerCapture(e.pointerId); box.classList.add('is-panning'); }
      box.scrollLeft = start.left - dx;
    });
    const end = () => { if (start?.moved) box.classList.remove('is-panning'); start = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }

  // ---------- editing ----------

  confirmRemove(what) {
    return confirmDialog(`Delete ${what}? You can't undo this.`, { title: 'Delete', okLabel: 'Delete', danger: true });
  }

  replace(list, old, next) {
    if (!old) return [...list, next];
    return next ? list.map((x) => (same(x, old) ? next : x)) : list.filter((x) => !same(x, old));
  }

  async editEvent(ev) {
    const isNew = !ev;
    const e = ev || {};
    const title = input({ value: e.title || '', maxlength: 140, placeholder: 'e.g. The Siege of Greywater', autofocus: true });
    const when = dateFields({ value: isNew ? null : e, ageFallback: this.lastAge, hint: 'The year and age place the event on the timeline; the month is optional.' });
    const sym = symbolPicker(e.symbol);
    const text = textField(e.text);
    const tags = tagsInput(e.tags);
    let next = null;
    const r = await itemDialog({
      title: isNew ? 'New event' : 'Edit event',
      saveLabel: isNew ? 'Add event' : 'Save',
      wide: true,
      fields: [field('Title', title), when.el, sym.el, text.el, tags.el],
      remove: isNew ? null : () => this.confirmRemove(`the event “${e.title || 'Untitled'}”`),
      save: (fail) => {
        const t = title.value.trim();
        if (!t) { title.focus(); return fail('Give the event a title.'); }
        const er = when.error();
        if (er) { when.focus(); return fail(er); }
        const date = when.get();
        this.lastAge = date.age;
        next = clean({ id: e.id || itemId('e'), title: t, year: date.year, month: date.month, age: date.age, symbol: sym.get(), text: text.get(), tags: tags.get() });
        return true;
      },
    });
    if (!r) return;
    const d = this.data;
    d.events = this.replace(d.events, ev, r === 'removed' ? null : next);
    this.save(d);
    if (r === 'saved' && next.title) requestAnimationFrame(() => this.flashItem(itemAnchor(next.title)));
  }

  async editSpan(sp) {
    const isNew = !sp;
    const s = sp || {};
    const title = input({ value: s.title || '', maxlength: 140, placeholder: 'e.g. The reign of Queen Aldis', autofocus: true });
    const color = colorPicker(s.color || 'lapis', { label: 'Highlight colour' });
    const from = dateFields({ value: s.from, legend: 'From', ageFallback: this.lastAge });
    const to = dateFields({ value: s.to, legend: 'To', optional: true, ageFallback: normDate(s.from)?.age || this.lastAge, hint: 'Leave the year blank while it goes on.' });
    const text = textField(s.text);
    const tags = tagsInput(s.tags);
    let next = null;
    const r = await itemDialog({
      title: isNew ? 'New sub-timeline' : 'Edit sub-timeline',
      saveLabel: isNew ? 'Add sub-timeline' : 'Save',
      wide: true,
      fields: [field('Title', title, 'A reign, a war, a time of plague or of plenty…'), color.el, from.el, to.el, text.el, tags.el],
      remove: isNew ? null : () => this.confirmRemove(`the sub-timeline “${s.title || 'Untitled'}”`),
      save: (fail) => {
        const t = title.value.trim();
        if (!t) { title.focus(); return fail('Give the sub-timeline a title.'); }
        const er = from.error() || to.error();
        if (er) return fail(er);
        const a = from.get();
        const b = to.get();
        if (!notBefore(a, b)) return fail('It has to end on or after the date it starts.');
        this.lastAge = a.age;
        next = clean({ id: s.id || itemId('s'), title: t, color: color.get(), from: a, to: b, text: text.get(), tags: tags.get() });
        return true;
      },
    });
    if (!r) return;
    const d = this.data;
    d.spans = this.replace(d.spans, sp, r === 'removed' ? null : next);
    this.save(d);
  }

  async editMarker(mk) {
    const isNew = !mk;
    const m = mk || {};
    const label = input({ value: m.label || '', maxlength: 60, placeholder: 'Optional, e.g. The party arrives', autofocus: true });
    const when = dateFields({ value: isNew ? null : m, ageFallback: this.lastAge });
    const color = colorPicker(m.color || 'rubric');
    let next = null;
    const r = await itemDialog({
      title: isNew ? 'New marker' : 'Edit marker',
      saveLabel: isNew ? 'Add marker' : 'Save',
      fields: [field('Label', label, 'A word or two, shown under the marker.'), when.el, color.el],
      remove: isNew ? null : () => this.confirmRemove('this marker'),
      save: (fail) => {
        const er = when.error();
        if (er) { when.focus(); return fail(er); }
        const date = when.get();
        this.lastAge = date.age;
        next = clean({ id: m.id || itemId('m'), label: label.value.trim(), year: date.year, month: date.month, age: date.age, color: color.get() });
        return true;
      },
    });
    if (!r) return;
    const d = this.data;
    d.markers = this.replace(d.markers, mk, r === 'removed' ? null : next);
    this.save(d);
  }

  async openAges({ startNew = false } = {}) {
    const d = this.data;
    const res = await agesDialog({ shown: d.ages, used: this.usedAges(), startNew });
    if (!res?.saved) { this.render(); return; }
    const nd = this.data;
    nd.ages = [...res.shown];
    this.save(nd);
  }

  addAge() { return this.openAges({ startNew: true }); }

  flashItem(anchor) {
    const el = [...this.stage.querySelectorAll('[data-anchor]')].find((x) => x.dataset.anchor === anchor);
    if (!el) return;
    if (this.d.view !== 'vertical') {
      const r = el.getBoundingClientRect();
      const b = this.scroll.getBoundingClientRect();
      if (r.left < b.left || r.right > b.right) this.scroll.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
    }
    el.classList.remove('jr-flash');
    void el.offsetWidth;
    el.classList.add('jr-flash');
  }
}
