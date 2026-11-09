// A Family tree note's board: a toolbar (add a Person; with someone selected, their Parent, Partner, Child or
// Sibling; zoom and fit) over the tree. People are cards (name, title, born – died, a house colour), laid out
// generation by generation: partners side by side joined by a line (double: married, single: partners, dashed:
// separated), their children below on a shared bar. Hover a card (or tap it) for the person's description, tags and
// links; click to select, double click to edit. Data (kinds.js boardData): people [{id, name, title, born, died,
// color, text, tags}] and unions [{id, partners: [ids, at most 2], children: [ids], status}].
import { h } from '../../core/dom.js';
import { icon, field, input, select, confirmDialog } from '../../core/ui.js';
import { calendar, normDate, colorVar } from './calendar.js';
import { boardData, itemAnchor } from './kinds.js';
import {
  dateFields, tagsInput, colorPicker, textField, itemDialog, notBefore,
  hoverable, hideCard, cardBody, cardBtn, copyItemLink, itemId,
} from './board.js';
import { W, PG, VG, STATUS, clean, normalize, compact, lifeLine, layoutFamily } from './family-layout.js';

// ---------- the board ----------

export class FamilyBoard {
  constructor(view) {
    this.view = view;
    this.zoom = 1;
    this.selected = null;
    this.el = h('section', { class: 'jr-board jr-ft', 'aria-label': 'Family tree' });
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
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    hideCard(true);
  }

  // ---------- toolbar ----------

  toolbar() {
    const d = this.d;
    const sel = d.people.find((p) => p.id === this.selected) || null;
    const who = sel ? sel.name || 'them' : null;
    const tool = (label, ic, onClick, title, disabled = false) => h('button', { type: 'button', class: 'btn btn-sm jr-tool', title, disabled, onclick: onClick }, icon(ic), h('span', null, label));
    const rel = (label, kind) => tool(label, 'plus', () => this.addRelative(sel, kind),
      sel ? `Add ${kind === 'child' ? 'a child' : `a ${kind}`} of ${who}` : 'Select a person first (click their card)', !sel);
    return h('div', { class: 'jr-tools', role: 'toolbar', 'aria-label': 'Family tree tools' },
      h('div', { class: 'jr-tools-group', role: 'group', 'aria-label': 'Add' },
        h('span', { class: 'jr-tools-cap' }, 'Add'),
        tool('Person', 'user', () => this.editPerson(null), 'Add someone to the tree')),
      h('div', { class: 'jr-tools-group', role: 'group', 'aria-label': sel ? `Relatives of ${who}` : 'Relatives of the selected person' },
        h('span', { class: 'jr-tools-cap' }, sel ? `For ${who.length > 18 ? `${who.slice(0, 17)}…` : who}` : 'Select someone'),
        rel('Parent', 'parent'), rel('Partner', 'partner'), rel('Child', 'child'), rel('Sibling', 'sibling')),
      h('div', { class: 'jr-tools-group jr-tools-end' },
        h('span', { class: 'jr-tools-cap' }, 'Zoom'),
        h('div', { class: 'jr-seg', role: 'group', 'aria-label': 'Zoom' },
          h('button', { type: 'button', class: 'jr-seg-btn', title: 'Zoom out', 'aria-label': 'Zoom out', disabled: this.zoom <= 0.4, onclick: () => this.setZoom(this.zoom / 1.25) }, icon('minus')),
          h('button', { type: 'button', class: 'jr-seg-btn', title: 'Fit the whole tree', onclick: () => this.fit() }, h('span', null, `${Math.round(this.zoom * 100)}%`)),
          h('button', { type: 'button', class: 'jr-seg-btn', title: 'Zoom in', 'aria-label': 'Zoom in', disabled: this.zoom >= 1.6, onclick: () => this.setZoom(this.zoom * 1.25) }, icon('plus')))));
  }

  setZoom(z) {
    this.zoom = Math.max(0.4, Math.min(1.6, Math.round(z * 100) / 100));
    this.render();
  }

  fit() {
    if (!this.geo) return;
    const avail = this.scroll.clientWidth - 4;
    this.setZoom(Math.min(1, avail / this.geo.width));
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.el.querySelectorAll('.jr-ft-person').forEach((c) => c.classList.toggle('is-selected', c.dataset.id === id));
    this.bar.replaceWith(this.bar = this.toolbar());
  }

  // ---------- rendering ----------

  render() {
    hideCard(true);
    this.d = this.data;
    if (this.selected && !this.d.people.some((p) => p.id === this.selected)) this.selected = null;
    this.bar = this.toolbar();
    this.stage = h('div', { class: 'jr-ft-stage' });
    this.sizer = h('div', { class: 'jr-ft-sizer' }, this.stage);
    this.scroll = h('div', { class: 'jr-ft-scroll', tabindex: '0', 'aria-label': 'Family tree, scroll to see more' }, this.sizer);
    this.wirePan(this.scroll);
    this.el.replaceChildren(...[this.bar, this.scroll,
      !this.d.people.length ? h('p', { class: 'jr-hint jr-tl-empty' }, 'No one in this family tree yet. Add the first person with the Person button, then select them to add their parents, partners and children.') : null].filter(Boolean));
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
    stage.replaceChildren();
    const cards = new Map();
    const measure = h('div', { class: 'jr-tl-measure' });
    stage.append(measure);
    for (const p of people) { const c = this.personCard(p, cal); c.style.width = `${W}px`; cards.set(p.id, c); measure.append(c); }
    const hs = new Map([...cards].map(([id, c]) => [id, Math.ceil(c.getBoundingClientRect().height)]));
    measure.remove();
    const geo = layoutFamily(people, unions, childOf, (id) => hs.get(id));
    this.geo = geo;
    const wpx = Math.max(geo.width, 200);
    const hpx = Math.max(geo.height, 120);
    stage.style.width = `${wpx}px`;
    stage.style.height = `${hpx}px`;
    stage.style.transform = this.zoom === 1 ? '' : `scale(${this.zoom})`;
    this.sizer.style.width = `${Math.ceil(wpx * this.zoom)}px`;
    this.sizer.style.height = `${Math.ceil(hpx * this.zoom)}px`;

    // lines first (under the cards)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'jr-ft-lines');
    svg.setAttribute('width', String(wpx));
    svg.setAttribute('height', String(hpx));
    svg.setAttribute('aria-hidden', 'true');
    const path = (d, cls) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('class', cls); svg.append(p); };
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
          if (u.status === 'married') { path(`M${xa} ${ya - 2.5}H${xb}`, cls); path(`M${xa} ${ya + 2.5}H${xb}`, cls); }
          else path(`M${xa} ${ya}H${xb}`, cls);
        } else {
          // partners with someone between them: the line goes over the cards
          const yTop = top(a) - 12;
          path(`M${geo.x.get(a) + W / 2} ${top(a)}V${yTop}H${geo.x.get(b) + W / 2}V${top(b)}`, cls);
        }
        ux = adjacent ? (xa + xb) / 2 : (geo.x.get(a) + W / 2 + geo.x.get(b) + W / 2) / 2;
        uy = adjacent ? ya + (u.status === 'married' ? 2.5 : 0) : top(a) - 12;
      } else if (u.partners.length === 1) {
        const a = u.partners[0];
        ux = geo.x.get(a) + W / 2;
        uy = top(a) + geo.rowH[geo.gen.get(a)];
      }
      if (!u.children.length) continue;
      const kidRow = geo.gen.get(u.children[0]);
      const n = busCount.get(kidRow) || 0;
      busCount.set(kidRow, n + 1);
      const busY = geo.rowTop[kidRow] - VG / 2 + ((n % 3) - 1) * 7;
      const cxs = u.children.map((c) => geo.x.get(c) + W / 2);
      if (ux == null) { // unknown parents: a short stub with a question mark over the siblings' bar
        ux = (Math.min(...cxs) + Math.max(...cxs)) / 2;
        uy = busY - 16;
        const q = document.createElementNS(NS, 'text');
        q.setAttribute('x', String(ux));
        q.setAttribute('y', String(uy - 3));
        q.setAttribute('class', 'jr-ft-unknown');
        q.textContent = '?';
        svg.append(q);
      }
      path(`M${ux} ${uy}V${busY}`, 'jr-ft-line');
      path(`M${Math.min(ux, ...cxs)} ${busY}H${Math.max(ux, ...cxs)}`, 'jr-ft-line');
      for (const c of u.children) path(`M${geo.x.get(c) + W / 2} ${busY}V${top(c)}`, 'jr-ft-line');
    }
    stage.append(svg);
    for (const p of people) {
      const c = cards.get(p.id);
      c.style.left = `${Math.round(geo.x.get(p.id))}px`;
      c.style.top = `${Math.round(top(p.id))}px`;
      stage.append(c);
    }
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
    el.addEventListener('click', () => this.select(p.id));
    hoverable(el, () => this.personBody(p), { open: () => this.editPerson(p) });
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
        cardBtn('Parent', 'plus', () => this.addRelative(p, 'parent')),
        cardBtn('Partner', 'plus', () => this.addRelative(p, 'partner')),
        cardBtn('Child', 'plus', () => this.addRelative(p, 'child')),
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
    requestAnimationFrame(() => el.click());
    return true;
  }

  // ---------- drag to scroll (mouse) ----------

  wirePan(box) {
    let start = null;
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button, a')) return;
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
    const end = () => { if (start?.moved) box.classList.remove('is-panning'); start = null; };
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
    if (!rows.length) rows.push(h('p', { class: 'jr-hint' }, 'No relatives yet. Use Parent, Partner, Child or Sibling on the toolbar (with this person selected) to add them.'));
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

  flash(id) {
    const el = this.stage.querySelector(`.jr-ft-person[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
