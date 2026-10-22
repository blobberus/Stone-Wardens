// Right-hand drawer over the map: location details, the editor, and per-location actions.
import { h, mount } from '../../core/dom.js';
import { icon, toast, confirmDialog, input, markdownEditor } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { fmtDate, nameKey } from '../../core/util.js';
import * as data from './data.js';
import { typeBadge, rankBadge } from './pins.js';
import { typePicker } from './typeform.js';
import { RANKS, rankName } from './ranks.js';
import { mapOptions } from './submaps.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none' });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Rank chooser: "Auto" (the type's default) or 1-4. Returns an element with .update(typeRank).
 * value: 1-4 or null (auto).
 */
export function rankPicker({ value, typeRank, onChange, compact = false }) {
  const el = h('div', { class: ['map-rankpick', compact && 'is-compact'], role: 'radiogroup', 'aria-label': 'Rank' });
  const hint = h('span', { class: 'field-hint map-rank-hint' });
  let cur = value;
  let auto = typeRank;
  function draw() {
    const eff = cur || auto;
    const opt = (r, label, sub) => h('button', {
      type: 'button', role: 'radio', class: ['map-rankpick-opt', (cur || null) === r && 'is-active'], 'aria-checked': String((cur || null) === r),
      title: r ? RANKS[r - 1].hint : `Use the location type's default (rank ${auto})`,
      onclick: () => { cur = r; onChange?.(r); draw(); },
    }, h('span', { class: 'map-rankpick-n' }, label), h('span', { class: 'map-rankpick-name' }, sub));
    mount(el,
      opt(null, 'Auto', rankName(auto)),
      RANKS.map((r) => opt(r.rank, String(r.rank), r.name)));
    hint.textContent = `${RANKS[eff - 1].hint}${cur ? '' : ' (from the type)'}`;
  }
  el.update = (nextTypeRank) => { auto = nextTypeRank; draw(); };
  el.hint = hint;
  draw();
  return el;
}

/**
 * ctx: {typeOf, types, close({force}), startMove(id), finishMove(save), isMoving(), saved(loc, isNew),
 *       preview(form), resetPreview(), newType() -> Promise<type|null>, search(q), setLastType(id),
 *       mapId(), newSubmap({name, loc}) -> Promise<mapId|null>}
 */
export function createDrawer(ctx) {
  const el = h('aside', { class: 'map-drawer', 'aria-label': 'Location details' });
  const st = { mode: null, id: null, form: null, initial: '', moving: false, sig: '', setPos: null, body: null };

  const sigOf = (loc, type) => JSON.stringify([loc, type.name, type.color, type.icon, type.rank, loc.submap && data.mapById(loc.submap)?.name]);
  const closeBtn = () => h('button', { class: 'btn-icon map-drawer-close', type: 'button', 'aria-label': 'Close panel', title: 'Close (Esc)', onclick: () => ctx.close() }, icon('close'));
  const show = () => el.classList.add('is-open');

  // ---------- details ----------

  function renderView(loc) {
    const type = ctx.typeOf(loc.type);
    st.sig = sigOf(loc, type);
    const desc = h('div', { class: 'map-desc' });
    if (loc.description.trim()) renderInto(desc, loc.description);
    else {
      desc.append(h('p', { class: 'muted map-desc-empty' }, 'Nothing has been written about this place yet. ',
        h('button', { type: 'button', class: 'map-linkbtn', onclick: () => api.openEdit(loc.id) }, 'Add a description')));
    }
    const mentions = data.backlinks(loc);
    const rank = data.rankOf(loc);
    const sub = loc.submap && data.mapById(loc.submap);
    const title = h('h2', { class: 'map-drawer-title', tabindex: '-1' }, loc.name);
    st.body = h('div', { class: 'map-drawer-body' },
      sub ? h('a', { class: 'map-submap-link', href: data.mapHref(sub.id), title: `Open the map of ${sub.name}` },
        h('span', { class: 'map-submap-icon', 'aria-hidden': 'true' }, icon('layers')),
        h('span', { class: 'map-submap-text' },
          h('small', null, 'Open map'),
          h('strong', null, sub.name),
          h('span', null, plural(data.locationsOn(sub.id).length, 'place'))),
        icon('chevron-right')) : null,
      h('div', { class: 'map-drawer-badges' }, typeBadge(type), rankBadge(rank, rankName(rank), !loc.rank)),
      loc.lostMap ? h('p', { class: 'map-lost' }, icon('warning'), `This place belonged to a map that no longer exists (${loc.lostMap}), so it is shown here.`) : null,
      desc,
      loc.tags.length ? h('ul', { class: 'map-tags', 'aria-label': 'Tags' }, loc.tags.map((t) => h('li', null,
        h('button', { type: 'button', class: 'chip map-tag', title: `Find places tagged #${t}`, onclick: () => ctx.search(`#${t}`) }, `#${t}`)))) : null,
      h('section', { class: 'map-mentions', 'aria-label': 'Mentioned in' },
        h('h3', { class: 'map-section-title' }, 'Mentioned in', mentions.length ? h('span', { class: 'map-count' }, String(mentions.length)) : null),
        mentions.length
          ? h('ul', { class: 'map-mentions-list' }, mentions.map((m) => h('li', null,
            h('a', { href: m.href, class: 'map-mention' },
              h('span', { class: 'map-mention-title' }, m.title),
              h('span', { class: 'map-mention-ctx' }, m.context)),
            m.snippet ? h('p', { class: 'map-mention-snippet' }, m.snippet) : null)))
          : h('p', { class: 'muted map-mentions-empty' }, 'No journal notes link here yet. Write ', h('code', null, data.linkText(loc)), ' in a note to connect it.')),
      h('dl', { class: 'map-meta' },
        h('dt', null, 'Added by'), h('dd', null, loc.createdBy || '—'),
        loc.created ? [h('dt', null, 'Added'), h('dd', null, fmtDate(loc.created))] : null,
        loc.updated && loc.updated !== loc.created ? [h('dt', null, 'Last edited'), h('dd', null, fmtDate(loc.updated))] : null));

    const foot = st.moving
      ? h('footer', { class: 'map-drawer-foot' },
        h('span', { class: 'map-move-hint' }, 'Drag the pin, or click the map.'),
        h('span', { class: 'map-spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.finishMove(false) }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ctx.finishMove(true) }, 'Save position'))
      : h('footer', { class: 'map-drawer-foot' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => api.openEdit(loc.id) }, icon('edit'), h('span', null, 'Edit')),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Drag the pin to a new place', onclick: () => ctx.startMove(loc.id) }, icon('pin'), h('span', null, 'Move')),
        h('button', { class: 'btn btn-sm', type: 'button', title: `Copy ${data.linkText(loc)}`, onclick: () => copyLink(loc) }, icon('link'), h('span', null, 'Copy link')),
        h('span', { class: 'map-spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm map-del', type: 'button', 'aria-label': `Delete ${loc.name}`, title: 'Delete location', onclick: () => remove(loc) }, icon('trash'), h('span', { class: 'map-del-label' }, 'Delete')));

    mount(el,
      h('header', { class: 'map-drawer-head' }, title, closeBtn()),
      st.body,
      foot);
    el.setAttribute('aria-label', `${loc.name} — location details`);
    return title;
  }

  async function copyLink(loc) {
    const text = data.linkText(loc);
    if (await copyText(text)) toast(`Copied ${text} — paste it into any note.`, { type: 'success' });
    else toast(`Could not copy. The link is ${text}`, { type: 'error' });
  }

  async function remove(loc) {
    const n = data.backlinks(loc).length;
    const msg = `“${loc.name}” will be removed from the map for everyone once you save.`
      + (n ? ` ${n} ${n === 1 ? 'note links' : 'notes link'} here; ${n === 1 ? 'that link' : 'those links'} will stop working.` : '')
      + (loc.submap && data.mapById(loc.submap) ? ` Its map “${data.mapById(loc.submap).name}” is kept (open it from the map menu).` : '');
    if (!(await confirmDialog(msg, { title: 'Delete this location?', okLabel: 'Delete', danger: true }))) return;
    if (ctx.isMoving()) ctx.finishMove(false);
    data.deleteLocation(loc);
    ctx.close({ force: true });
    toast(`Deleted “${loc.name}”. Press Save to send the change.`);
  }

  // ---------- editor ----------

  function renderEditor({ loc, isNew }) {
    const f = {
      name: loc.name || '', type: loc.type || 'other', rank: loc.rank || null, submap: loc.submap || '',
      description: loc.description || '', tags: (loc.tags || []).join(', '), x: loc.x, y: loc.y,
    };
    st.form = f;
    st.initial = JSON.stringify(f);
    const onMap = loc.map || ctx.mapId();

    const err = h('span', { class: 'map-field-error', role: 'alert', hidden: true }, 'Give the place a name.');
    const dupe = h('span', { class: 'field-hint map-dupe', hidden: true });
    const checkDupe = () => {
      const other = f.name.trim() && data.findLocation(f.name.trim());
      const clash = other && other.id !== st.id && nameKey(other.name) === nameKey(f.name);
      dupe.hidden = !clash;
      dupe.textContent = clash ? `Another place is already called “${other.name}”${other.map !== onMap ? ` (on ${data.mapById(other.map)?.name || 'another map'})` : ''}. Copy link will use its id so links stay exact.` : '';
    };
    const nameIn = input({
      value: f.name, placeholder: 'e.g. The Drowned Bell', maxlength: 120, 'aria-required': 'true', id: 'map-f-name',
      oninput: (e) => { f.name = e.target.value; err.hidden = true; checkDupe(); ctx.preview(f); },
    });
    const ranks = rankPicker({ value: f.rank, typeRank: ctx.typeOf(f.type).rank, onChange: (r) => { f.rank = r; ctx.preview(f); } });
    const picker = typePicker({
      value: f.type, types: ctx.types(), open: isNew,
      onChange: (id) => { f.type = id; ranks.update(ctx.typeOf(id).rank); ctx.preview(f); },
      onNew: async () => {
        const t = await ctx.newType();
        if (t?.id && !t.deleted) { f.type = t.id; picker.update(ctx.types(), t.id); ranks.update(t.rank); ctx.preview(f); } else picker.update(ctx.types());
      },
    });
    const subSel = h('select', { class: 'select', id: 'map-f-submap' });
    const drawSub = () => mount(subSel,
      mapOptions(f.submap, { exclude: onMap, none: 'No map' }),
      h('option', { value: '__new' }, 'New sub-map…'));
    subSel.addEventListener('change', async () => {
      if (subSel.value !== '__new') { f.submap = subSel.value; ctx.preview(f); return; }
      const id = await ctx.newSubmap({ name: f.name.trim(), parent: onMap });
      if (id) f.submap = id;
      drawSub();
      ctx.preview(f);
    });
    drawSub();
    const editor = markdownEditor({
      value: f.description, rows: 7,
      placeholder: 'What is here? Who rules it, what was found, what lurks… Use [[links]] to notes, characters and other places.',
      onInput: (v) => { f.description = v; },
    });
    const tagsIn = input({ value: f.tags, placeholder: 'e.g. haunted, act-one, river', id: 'map-f-tags', oninput: (e) => { f.tags = e.target.value; } });
    const pos = h('span', { class: 'map-pos' });
    const drawPos = () => {
      pos.textContent = `Position ${Math.round(f.x)}, ${Math.round(f.y)}${isNew ? ' · drag the pin or click the map to adjust' : ''}`;
    };
    st.setPos = ({ x, y }) => { f.x = x; f.y = y; drawPos(); };
    drawPos();
    checkDupe();

    const save = () => {
      const name = f.name.trim();
      if (!name) { err.hidden = false; nameIn.focus(); return false; }
      const tags = [...new Set(f.tags.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean))];
      const base = isNew ? { map: onMap } : (data.locationById(st.id) || loc);
      const saved = data.saveLocation({ ...base, name, type: f.type, rank: f.rank, submap: f.submap || null, description: f.description, tags, x: f.x, y: f.y });
      st.form = null;
      ctx.setLastType(f.type);
      ctx.saved(saved, isNew);
      return true;
    };
    const cancel = async () => {
      if (isNew) { ctx.close(); return; }
      if (!(await api.confirmLeave())) return;
      ctx.resetPreview();
      api.showLocation(st.id);
    };

    const form = h('form', { class: 'map-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      h('header', { class: 'map-drawer-head' },
        h('h2', { class: 'map-drawer-heading' }, isNew ? 'New location' : 'Edit location'),
        h('span', { class: 'map-spacer' }),
        closeBtn()),
      h('div', { class: 'map-drawer-body stack' },
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'map-f-name' }, 'Name'), nameIn, err, dupe),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), picker),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rank'), ranks, ranks.hint),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), editor),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'map-f-submap' }, 'Opens a map'), subSel,
          h('span', { class: 'field-hint' }, 'A detailed map of this place (a city, a dungeon…). Its pin gets a seal and the panel an “Open map” link.')),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'map-f-tags' }, 'Tags'), tagsIn, h('span', { class: 'field-hint' }, 'Separate with commas.')),
        pos),
      h('footer', { class: 'map-drawer-foot' },
        h('span', { class: 'map-foot-hint' }, 'Ctrl+Enter to save'),
        h('span', { class: 'map-spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: cancel }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, isNew ? 'Add to map' : 'Save')));
    form.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'enter') { e.preventDefault(); save(); }
      // Ctrl+S: store the form first, then let the global handler commit everything.
      if ((e.ctrlKey || e.metaKey) && k === 's' && f.name.trim()) save();
    });
    mount(el, form);
    el.setAttribute('aria-label', isNew ? 'New location' : `Edit ${loc.name}`);
    st.body = form.querySelector('.map-drawer-body');
    return nameIn;
  }

  // ---------- api ----------

  const focusSoon = (node) => requestAnimationFrame(() => node?.focus({ preventScroll: true }));

  const api = {
    el,
    get mode() { return st.mode; },
    get id() { return st.id; },
    get isOpen() { return !!st.mode; },
    get form() { return st.form; },

    showLocation(id) {
      const loc = data.locationById(id);
      if (!loc) return false;
      Object.assign(st, { mode: 'view', id: loc.id, form: null, setPos: null });
      const title = renderView(loc);
      show();
      st.body.scrollTop = 0;
      focusSoon(title);
      return true;
    },

    openNew({ x, y, type }) {
      Object.assign(st, { mode: 'new', id: null, moving: false });
      focusSoon(renderEditor({ loc: { x, y, type, name: '', description: '', tags: [], map: ctx.mapId() }, isNew: true }));
      show();
    },

    openEdit(id) {
      const loc = data.locationById(id);
      if (!loc) return;
      if (ctx.isMoving()) ctx.finishMove(false);
      Object.assign(st, { mode: 'edit', id: loc.id, moving: false });
      focusSoon(renderEditor({ loc, isNew: false }));
      show();
    },

    setPosition(p) { st.setPos?.(p); },

    setMoving(on) {
      st.moving = !!on;
      if (st.mode === 'view') { const loc = data.locationById(st.id); if (loc) renderView(loc); }
    },

    /** Re-render the details if the location (or its type) changed, or when forced (journal changed). */
    refresh({ force = false } = {}) {
      if (st.mode !== 'view') return;
      const loc = data.locationById(st.id);
      if (!loc) return;
      if (!force && sigOf(loc, ctx.typeOf(loc.type)) === st.sig) return;
      const scroll = st.body?.scrollTop || 0;
      renderView(loc);
      st.body.scrollTop = scroll;
    },

    close() {
      Object.assign(st, { mode: null, id: null, form: null, moving: false, setPos: null });
      el.classList.remove('is-open');
    },

    isDirty() { return !!st.form && JSON.stringify(st.form) !== st.initial; },

    async confirmLeave() {
      if (!api.isDirty()) return true;
      const ok = await confirmDialog(
        st.mode === 'new' ? 'This new location has not been added yet. Discard it?' : 'Discard your unsaved changes to this location?',
        { title: 'Unsaved edits', okLabel: 'Discard', danger: true },
      );
      if (ok) st.form = null;
      return ok;
    },
  };
  return api;
}
