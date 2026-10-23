// Paper Companion (sheet.js shows it instead of the sheet body while the device setting chCompanion is on): the sheet for
// the table, beside a printed "Major points" sheet (print.js). Only what changes in play, on one screen, under the usual
// header (hit points with their controls open, death saves, AC…): conditions & hit dice and coins | spell slots (each
// level opens to its spells and prepared ticks) and feature uses (each opens to its rules text) | the inventory (each
// item opens to its stats, attunement, notes and actions). Rows stay open while the sheet repaints (api.isOpen/setOpen).
// Cards reuse the sheet's own sections and controls through `api` (sheet.js companionApi).
import { h } from '../../core/dom.js';
import { icon, numberInput } from '../../core/ui.js';
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
  ].filter((x) => x.length);
  return h('div', { class: 'ch-pc' }, h('div', { class: 'ch-pc-grid', 'data-cols': String(cols.length) },
    cols.map((list, i) => h('div', { class: ['ch-pc-col', i === cols.length - 1 && 'ch-pc-col-last'] }, list))));
}

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
