// Paper Companion (sheet.js shows it instead of the sheet body while the device setting chCompanion is on): the sheet for
// the table, beside a printed "Major points" sheet (print.js). Only what changes in play, on one screen, under the usual
// header (hit points with their controls open, death saves, AC…): conditions & hit dice, coins and features & traits
// (search by name; All by source | Smart by what they do; each opens to its rules text) | spell slots (each level opens
// to its spells and prepared ticks) and feature uses (each opens to its rules text) | the inventory (each item opens to
// its stats, attunement, notes and actions). Rows stay open while the sheet repaints (api.isOpen/setOpen).
// Cards reuse the sheet's own sections and controls through `api` (sheet.js companionApi).
import { h } from '../../core/dom.js';
import { icon, numberInput } from '../../core/ui.js';
import { nameKey } from '../../core/util.js';
import { TAGS } from './engine-tags.js';
import { featureFavKey } from './engine-favs.js';
import { section, md, mdInline, pips, fmt } from './widgets.js';
import { prettify } from './data.js';
import { findEntry, masteryInfo, propertyInfo } from './bridge.js';
import { itemSummary, ordinal } from './print-model.js';

const NAMES = {
  masteryName: (id) => masteryInfo(id)?.name || prettify(id),
  propertyName: (p) => propertyInfo(p)?.name || prettify(String(p).split(/[ (]/)[0]),
};

export function companionBody(c, s, api) {
  const cols = [
    [api.trackers(c, s), api.currency(c)],
    [slotsCard(c, s, api), usesCard(c, s, api)].filter(Boolean),
    [inventoryCard(c, s, api)],
  ];
  // Features & traits goes under the shortest column (estimated from its rows), so the companion stays on one screen;
  // its list then takes the height left there (fitFeatures)
  const feats = featuresCard(c, s, api);
  if (feats) {
    const rows = (el) => el.querySelectorAll('.ch-pc-row').length;
    const est = [317, cols[1].reduce((n, el) => n + 68 + 35 * rows(el), 0), 90 + 35 * Math.max(1, rows(cols[2][0]))];
    cols[est.indexOf(Math.min(...est))].push(feats);
  }
  const shown = cols.filter((x) => x.length);
  return h('div', { class: 'ch-pc' }, h('div', { class: 'ch-pc-grid', 'data-cols': String(shown.length) },
    shown.map((list, i) => h('div', { class: ['ch-pc-col', i === shown.length - 1 && 'ch-pc-col-last'] }, list))));
}

/** Side by side (a wide companion), the features list takes the view's height left under it: at least ~6 rows. */
function fitFeatures(box) {
  const view = box.closest('.view');
  const pc = box.closest('.ch-pc');
  if (!view || !pc) return;
  box.style.maxHeight = '';
  const grid = pc.querySelector('.ch-pc-grid');
  if (getComputedStyle(grid).gridTemplateColumns.split(' ').length < 2) return; // one column (phones): the CSS height
  const vr = view.getBoundingClientRect();
  const top = box.getBoundingClientRect().top - vr.top + view.scrollTop;
  const room = view.clientHeight - top - parseFloat(getComputedStyle(view).paddingBottom || '0') - 16;
  box.style.maxHeight = `${Math.round(Math.min(26 * 16, Math.max(200, room)))}px`;
}
let fitBox = null;
window.addEventListener('resize', () => { if (fitBox?.isConnected) fitFeatures(fitBox); });

/**
 * One row that opens: lead (a checkbox before it), the toggle with `head`, controls after it (`extra`, outside the
 * toggle so they never open it), and the panel built on first open by body(). body null: a plain row.
 */
function row(api, key, { lead = null, head, extra = null, body = null, className = null, stat = null }) {
  const id = `ch-pc-${key.replace(/[^a-z0-9-]/gi, '-')}`;
  if (!body) return h('li', { class: ['ch-pc-row', className], 'data-stat': stat }, h('div', { class: 'ch-pc-line' }, lead, h('span', { class: 'ch-pc-head is-static' }, head), extra));
  let open = api.isOpen(key);
  const panel = h('div', { class: 'ch-pc-more', id, hidden: !open });
  const fillPanel = () => { if (!panel.childNodes.length) panel.append(...[].concat(body()).filter(Boolean)); };
  if (open) fillPanel();
  const li = h('li', { class: ['ch-pc-row', open && 'is-open', className], 'data-stat': stat });
  const btn = h('button', {
    class: 'ch-pc-head', type: 'button', 'aria-expanded': String(open), 'aria-controls': id, 'data-fk': `pc-${key}`,
    onclick: () => {
      open = !open;
      api.setOpen(key, open);
      if (open) fillPanel();
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      li.classList.toggle('is-open', open);
    },
  }, icon('chevron-right'), head);
  li.append(h('div', { class: 'ch-pc-line' }, lead, btn, extra), panel);
  return li;
}

// ---------- spell slots, each level opening to its spells ----------

function slotsCard(c, s, api) {
  const rows = api.spellRows(c, s);
  const slotMax = (lvl) => Number(s.slots?.[lvl - 1]) || 0;
  if (!s.spellcasting.length && !rows.length && !(s.slots || []).some(Boolean) && !s.pact) return null;
  const levels = [...new Set([...rows.map((r) => r.level), ...(s.slots || []).map((n, i) => (n ? i + 1 : null)).filter(Boolean)])].sort((a, b) => a - b);
  const spellLine = (r) => {
    const st = r.stats;
    const hit = !st ? '' : st.attack ? (st.toHit != null ? `${fmt(st.toHit)} to hit` : '') : st.save && st.dc != null ? `DC ${st.dc} ${String(st.save).toUpperCase()}` : '';
    const fx = !st ? '' : [...(st.damageGroups || []).map((g) => g.text), st.heal ? `heals ${st.heal.text}` : ''].filter(Boolean).join(' + ');
    const meta = [r.entry?.castingTime ? api.shortTime(r.entry.castingTime) : '', r.entry?.range ? api.shortRange(r.entry.range) : '', hit, fx].filter(Boolean).join(' · ');
    return h('li', { class: ['ch-pc-spell', r.ready ? 'is-prepared' : 'is-unprepared'], 'data-stat': r.id },
      r.always ? h('span', { class: 'ch-spell-lock', title: 'Always prepared', role: 'img', 'aria-label': 'Always prepared' }, icon('lock'))
        : r.level > 0 ? h('input', { type: 'checkbox', class: 'checkbox', checked: !!r.prepared, title: 'Prepared', 'aria-label': `Prepare ${r.name}`, 'data-fk': `pc-prep-${r.class}-${r.id}`, onchange: (e) => api.togglePrepared(r, e.target.checked) })
          : h('span', { class: 'ch-spell-dot', title: 'Cantrip: always ready', 'aria-hidden': 'true' }),
      h('span', { class: 'ch-pc-spell-text' },
        h('button', { class: 'ch-link-btn ch-pc-spell-name', type: 'button', onclick: () => api.spellInfo(r) }, r.name),
        r.entry?.concentration ? h('span', { class: 'badge', title: 'Concentration' }, 'C') : null,
        r.entry?.ritual ? h('span', { class: 'badge', title: 'Ritual' }, 'R') : null,
        meta ? h('span', { class: 'ch-pc-spell-meta' }, meta) : null));
  };
  const list = levels.map((lvl) => {
    const here = rows.filter((r) => r.level === lvl).sort((a, b) => (b.ready - a.ready) || a.name.localeCompare(b.name));
    const max = slotMax(lvl);
    const used = Math.min(max, Number(c.slotsUsed?.[lvl - 1]) || 0);
    const ready = here.filter((r) => r.ready).length;
    return row(api, `lvl${lvl}`, {
      stat: lvl ? `slots-${lvl}` : 'cantrips',
      head: [h('span', { class: 'ch-pc-name' }, lvl === 0 ? 'Cantrips' : `${ordinal(lvl)} level`),
        h('span', { class: 'ch-pc-sub' }, here.length ? (lvl === 0 ? `${here.length}` : `${ready}/${here.length} ready`) : 'no spells')],
      extra: lvl === 0 ? h('span', { class: 'ch-pc-note' }, 'at will')
        : max ? h('span', { class: 'ch-pc-slots' }, pips({ max, used, label: `Level ${lvl} slots`, fk: `pc-slot${lvl - 1}`, onChange: (u) => api.mutate((y) => { y.slotsUsed[lvl - 1] = u; }) }),
          h('span', { class: 'ch-pc-count num' }, `${max - used}/${max}`)) : h('span', { class: 'ch-pc-note' }, api.slotText(lvl)),
      body: here.length ? () => h('ul', { class: 'ch-pc-spells', role: 'list' }, here.map(spellLine)) : null,
    });
  });
  if (s.pact) {
    const pmax = Number(s.pact.slots) || 0;
    const pused = Math.min(pmax, Number(c.pactUsed) || 0);
    list.push(row(api, 'pact', {
      stat: 'pact', className: 'ch-pc-pact',
      head: [h('span', { class: 'ch-pc-name' }, `Pact slots`), h('span', { class: 'ch-pc-sub' }, `${ordinal(s.pact.level ?? s.pact.slotLevel ?? 1)} level · short rest`)],
      extra: h('span', { class: 'ch-pc-slots' }, pips({ max: pmax, used: pused, label: 'Pact Magic slots', fk: 'pc-pact', onChange: (u) => api.mutate((y) => { y.pactUsed = u; }) }),
        h('span', { class: 'ch-pc-count num' }, `${pmax - pused}/${pmax}`)),
    }));
  }
  const casters = s.spellcasting.map((sc) => `${api.className(sc.class)} DC ${sc.dc} · ${fmt(sc.attack)}`).join(' · ');
  return section('spells', 'Spell slots', { iconName: 'sparkle', className: 'ch-pc-card', sub: casters || null },
    h('ul', { class: 'ch-pc-rows', role: 'list' }, list));
}

// ---------- feature uses, each opening to the feature's rules text ----------

function usesCard(c, s, api) {
  const list = (s.resources || []).filter((r) => Number(r.max));
  if (!list.length) return null;
  const featuresOf = (r) => s.features.filter((f) => (f.uses && typeof f.uses === 'object' && f.uses.key === r.key) || f.uses === r.key || (f.id && f.id === r.key));
  return section('resources', 'Feature uses', { iconName: 'layers', className: 'ch-pc-card' },
    h('ul', { class: 'ch-pc-rows', role: 'list' }, list.map((r) => {
      const feats = featuresOf(r);
      return row(api, `res:${r.key}`, {
        stat: r.key,
        head: [h('span', { class: 'ch-pc-name' }, r.label, r.die ? ` (${r.die})` : ''),
          r.recharge ? h('span', { class: 'ch-pc-sub' }, r.recharge === 'short' ? 'short rest' : r.recharge === 'long' ? 'long rest' : prettify(r.recharge)) : null],
        extra: h('span', { class: 'ch-pc-slots' }, api.resourcePips(r, false, '-pc')),
        body: () => (feats.length ? feats.map((f) => h('div', { class: 'ch-pc-feat' },
          h('button', { class: 'ch-link-btn ch-pc-feat-name', type: 'button', onclick: () => api.featureModal(f) }, f.name),
          f.source ? h('span', { class: 'badge' }, f.source) : null,
          md(f.description, { empty: 'No description.' })))
          : h('p', { class: 'muted ui text-sm' }, r.source ? `From ${r.source}.` : 'No rules text on the sheet.')),
      });
    })));
}

// ---------- features & traits: search by name, All (by source) | Smart (by what they do), each opening to its text ----------

function featuresCard(c, s, api) {
  if (!s.features.length) return null;
  const v = api.featView(); // the full sheet's choice (per device), so both views stay in step
  const tagging = api.featureTagging(c, s);
  const tagsOf = new Map(tagging.tagged.map((x) => [x.feature, x.tags]));
  const favs = api.favs('features');
  const isFav = (f) => favs.has(featureFavKey(f));
  const resByKey = new Map(s.resources.map((r) => [r.key, r]));
  const resOf = (f) => (f.uses && typeof f.uses === 'object' && f.uses.key && resByKey.get(f.uses.key)) || (typeof f.uses === 'string' && resByKey.get(f.uses)) || resByKey.get(f.id) || null;
  const smart = v.view === 'smart';

  // Smart: chips for the tags this character's features have (with counts), and the numbers that go with the chosen tag
  let list = s.features;
  let tagBar = null;
  let aspects = null;
  if (smart) {
    const untagged = tagging.tagged.filter((x) => !x.tags.length).map((x) => x.feature);
    const tags = [...TAGS.filter((t) => tagging.counts[t.id]), ...(untagged.length ? [{ id: 'other', label: 'Other', hint: 'No smart tag' }] : [])];
    const cur = tags.some((t) => t.id === v.tag) ? v.tag : tags[0]?.id;
    list = cur === 'other' ? untagged : (tagging.byTag[cur] || []).map((x) => x.feature);
    tagBar = h('div', { class: 'ch-smart-tags ch-pc-tags', role: 'tablist', 'aria-label': 'Smart tags' }, tags.map((t) => h('button', {
      class: ['chip', 'ch-smart-tag', t.id === cur && 'is-active'], type: 'button', role: 'tab', 'aria-selected': String(t.id === cur), title: t.hint, 'data-fk': `pc-smart-${t.id}`,
      onclick: () => api.setFeatView({ view: 'smart', tag: t.id }),
    }, t.label, h('span', { class: 'ch-smart-n num' }, String(t.id === 'other' ? untagged.length : tagging.counts[t.id] || 0)))));
    aspects = cur && cur !== 'other' ? api.tagAspects(cur, c, s) : null;
  }

  const seen = new Map();
  const featRow = (f) => {
    const base = featureFavKey(f);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const res = resOf(f);
    const picks = api.featurePicks(f);
    const lv = f.levels?.length > 1 ? `Lv ${f.levels.join(', ')}` : f.level ? `Lv ${f.level}` : '';
    const tags = tagsOf.get(f) || [];
    const group = api.featureGroup(f)[1];
    const li = row(api, `feat:${base}${n > 1 ? `#${n}` : ''}`, {
      stat: f.id || f.name, className: 'ch-pc-featrow',
      head: [isFav(f) ? api.favMark() : null, h('span', { class: 'ch-pc-name' }, f.name),
        picks || f.via ? h('span', { class: 'ch-pc-sub ch-pc-picks' }, picks || `via ${f.via}`) : null,
        lv ? h('span', { class: 'ch-pc-sub' }, lv) : null],
      extra: res ? h('span', { class: 'ch-pc-slots' }, api.resourcePips(res, true, '-pcf')) : null,
      body: () => [
        h('p', { class: 'ch-pc-item-kind ui text-xs muted' }, [group, f.source && f.source !== group ? f.source : ''].filter(Boolean).join(' · ')),
        md(f.description, { empty: 'No description.' }),
        f.modifiers ? h('p', { class: 'muted ui text-sm' }, api.describeModifiers(f.modifiers)) : null,
        tags.length ? h('p', { class: 'ch-feat-tags ui text-xs' }, tags.map((t) => h('button', {
          class: 'ch-feat-tag', type: 'button', title: 'Show everything with this tag (Smart)', onclick: () => api.setFeatView({ view: 'smart', tag: t }),
        }, TAGS.find((x) => x.id === t)?.label || t))) : null,
        h('div', { class: 'row ch-pc-item-acts' }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => api.featureModal(f) }, icon('info'), 'Open')),
      ],
    });
    li.dataset.q = nameKey([f.name, picks, f.via, f.source].filter(Boolean).join(' '));
    return li;
  };

  // All: grouped by where they come from (class, subclass, species, background, feats, special abilities)
  const rows = [];
  if (smart) rows.push(...api.favoritesFirst(list, isFav).map(featRow));
  else {
    const groups = new Map();
    for (const f of list) {
      const [k, label] = api.featureGroup(f);
      if (!groups.has(k)) groups.set(k, { label, list: [] });
      groups.get(k).list.push(f);
    }
    for (const [k, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push(h('li', { class: 'ch-pc-group', 'data-group': k }, g.label, h('span', { class: 'ch-feat-count' }, String(g.list.length))));
      rows.push(...api.favoritesFirst(g.list, isFav).map((f) => { const li = featRow(f); li.dataset.inGroup = k; return li; }));
    }
  }

  const ul = h('ul', { class: 'ch-pc-rows ch-pc-featlist', role: 'list' }, rows);
  const none = h('p', { class: 'muted ui text-sm ch-pc-feat-none', hidden: true });
  const count = h('span', { class: 'ch-pc-feat-count ui text-xs muted', 'aria-live': 'polite' });
  // Typing filters the rows in place (no repaint), so the field keeps its focus and open rows stay open
  const filter = (q) => {
    const term = nameKey(q);
    let shown = 0;
    for (const li of ul.querySelectorAll('.ch-pc-featrow')) { const hit = !term || li.dataset.q.includes(term); li.hidden = !hit; if (hit) shown += 1; }
    for (const g of ul.querySelectorAll('.ch-pc-group')) g.hidden = !ul.querySelector(`.ch-pc-featrow[data-in-group="${CSS.escape(g.dataset.group)}"]:not([hidden])`);
    const total = ul.querySelectorAll('.ch-pc-featrow').length;
    count.textContent = term ? `${shown} of ${total}` : String(total);
    none.hidden = !!shown || !total;
    none.textContent = `No feature here matches “${q.trim()}”.`;
  };
  const search = h('input', {
    class: 'input input-sm ch-pc-feat-q', type: 'search', value: api.featQuery(), placeholder: 'Search by name', 'aria-label': 'Search features and traits by name', 'data-fk': 'pc-feat-q',
    oninput: (e) => { api.setFeatQuery(e.target.value); filter(e.target.value); },
    onkeydown: (e) => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; api.setFeatQuery(''); filter(''); } },
  });
  filter(api.featQuery());
  const box = h('div', { class: 'ch-pc-featbox', onscroll: (e) => api.setFeatScroll(e.currentTarget.scrollTop) },
    list.length ? ul : h('p', { class: 'muted ui text-sm' }, 'No features with this tag.'), none);
  fitBox = box;
  requestAnimationFrame(() => { if (!box.isConnected) return; fitFeatures(box); box.scrollTop = api.featScroll(); });

  const seg = h('div', { class: 'ch-seg ch-feat-views', role: 'group', 'aria-label': 'Features view' },
    [['all', 'All'], ['smart', 'Smart']].map(([id, label]) => h('button', {
      class: ['ch-seg-btn', v.view === id && 'is-active'], type: 'button', 'aria-pressed': String(v.view === id), 'data-fk': `pc-feat-view-${id}`,
      title: id === 'smart' ? 'Group by what features do: magic, attack, defense…' : 'Group by where features come from',
      onclick: () => { api.setFeatScroll(0); api.setFeatView({ view: id }); },
    }, label)));
  return section('features', 'Features & traits', { iconName: 'scroll', className: 'ch-pc-card ch-pc-feats', actions: [seg] },
    h('div', { class: 'ch-pc-feat-tools' }, h('label', { class: 'search ch-pc-feat-search' }, icon('search'), search), count),
    tagBar, aspects ? h('div', { class: 'ch-aspects ch-pc-aspects', 'aria-label': 'On your sheet' }, aspects) : null,
    box);
}

// ---------- inventory: equip, quantity; each item opens to its stats, attunement, notes and actions ----------

function inventoryCard(c, s, api) {
  const favs = api.favs('items');
  const items = new Map((s.items || []).map((x) => [x.uid, x]));
  const attuned = c.inventory.filter((i) => i.attuned).length;
  const enc = s.encumbrance || {};
  const carried = Number(enc.carried ?? c.inventory.reduce((n, i) => n + api.itemWeight(i), 0)) || 0;
  const cap = Number(enc.capacity) || 0;
  const over = cap && carried > cap;
  const sorted = api.favoritesFirst(c.inventory, (it) => favs.has(it.uid));
  const set = (uid, fn) => api.mutate((y) => { const t = y.inventory.find((x) => x.uid === uid); if (t) fn(t); });
  return section('inventory', 'Inventory', {
    iconName: 'backpack', className: 'ch-pc-card ch-pc-inv',
    actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => api.addItems() }, icon('plus'), 'Add item')],
  },
  h('div', { class: 'ch-inv-meta row ui text-sm' },
    h('span', { class: over ? 'danger-text' : 'muted' }, `Carried ${api.round(carried)} lb`, cap ? ` of ${cap} lb` : ''),
    cap ? h('span', { class: ['ch-weightbar', over && 'is-over'] }, h('span', { style: { width: `${Math.min(100, Math.round((carried / cap) * 100))}%` } })) : null,
    h('span', { class: attuned > 3 ? 'danger-text' : 'muted' }, `Attuned ${attuned}/3`)),
  c.inventory.length ? h('ul', { class: 'ch-pc-rows ch-pc-items', role: 'list' }, sorted.map((it) => {
    const e = findEntry(it.kind, it.ref);
    const r = items.get(it.uid) || {};
    const canEquip = ['weapon', 'armor', 'magic-item'].includes(it.kind) || !!it.equipped;
    const canAttune = !!(r.requiresAttunement || e?.attunement || it.custom?.attunement || it.attuned);
    const w = api.itemWeight(it);
    const name = it.name || e?.name || prettify(it.ref);
    return row(api, `item:${it.uid}`, {
      stat: it.uid, className: it.equipped ? 'is-equipped' : null,
      lead: canEquip ? h('input', { type: 'checkbox', class: 'checkbox', checked: !!it.equipped, title: 'Equipped', 'aria-label': `Equip ${name}`, 'data-fk': `pc-eq-${it.uid}`, onchange: (ev) => set(it.uid, (t) => { t.equipped = ev.target.checked; }) })
        : h('span', { class: 'ch-pc-lead', 'aria-hidden': 'true' }),
      head: [favs.has(it.uid) ? h('span', { class: 'ch-fav-mark', 'aria-label': 'Favorite', role: 'img' }, icon('star')) : null,
        h('span', { class: 'ch-pc-name' }, name),
        it.attuned ? h('span', { class: 'badge badge-accent', title: 'Attuned' }, 'A') : null],
      extra: [h('span', { class: 'ch-pc-weight num' }, w ? `${api.round(w)} lb` : ''),
        numberInput(it.qty, (v) => set(it.uid, (t) => { t.qty = Math.max(0, v ?? 0); }), { class: 'input input-sm ch-w-num ch-pc-qty', min: 0, title: 'Quantity', 'aria-label': `Quantity of ${name}`, 'data-fk': `pc-qty-${it.uid}` })],
      body: () => {
        const stats = itemSummary(r, NAMES);
        return [
          h('p', { class: 'ch-pc-item-kind ui text-xs muted' }, [api.kindLabel(e, it), w ? `${api.round(w)} lb` : ''].filter(Boolean).join(' · ')),
          stats ? h('p', { class: 'ch-pc-item-stats ui text-sm' }, stats) : null,
          canAttune ? h('label', { class: 'checkbox ch-pc-attune' }, h('input', { type: 'checkbox', checked: !!it.attuned, 'data-fk': `pc-at-${it.uid}`, onchange: (ev) => set(it.uid, (t) => { t.attuned = ev.target.checked; }) }), h('span', null, 'Attuned')) : null,
          it.notes ? h('div', { class: 'ch-inv-notes' }, mdInline(it.notes)) : null,
          h('div', { class: 'row ch-pc-item-acts' },
            e ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => api.entryInfo(e, { item: it }) }, icon('info'), 'Details') : null,
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => api.editItem(it) }, icon('edit'), 'Edit'),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => api.removeItem(it) }, icon('trash'), 'Remove')),
        ];
      },
    });
  })) : h('p', { class: 'muted ui text-sm' }, 'The pack is empty. Add weapons, armor, gear or magic items from the library.'));
}
