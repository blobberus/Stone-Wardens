// Small shared UI pieces for the Characters tab: pips, steppers, stat boxes, sections,
// portraits, markdown blocks, focus-preserving re-render and the modifiers editor.
import { h, clear } from '../../core/dom.js';
import { icon, openModal, numberInput, input, select, toast } from '../../core/ui.js';
import { renderInto, renderInline } from '../../core/markdown.js';
import { store } from '../../core/store.js';
import { fmtMod, clone, slugify } from '../../core/util.js';
import { ABILITIES, PORTRAIT_DIR, initials, shortId } from './data.js';
import { renderEntry, skillList, damageTypes } from './bridge.js';

export const fmt = (n) => fmtMod(Number(n) || 0);
export const rollDie = (sides) => 1 + Math.floor(Math.random() * Math.max(1, Number(sides) || 1));

/**
 * Re-render `root` with `build()` while keeping scroll position and the focused control
 * (controls carry data-fk="stable-key").
 */
export function rerender(root, build) {
  const scroller = root.closest('.view');
  const top = scroller ? scroller.scrollTop : null;
  const a = document.activeElement;
  const fk = a && root.contains(a) ? a.dataset?.fk : null;
  let sel = null;
  if (fk && typeof a.selectionStart === 'number') { try { sel = [a.selectionStart, a.selectionEnd]; } catch { sel = null; } }
  build();
  if (scroller && top != null) scroller.scrollTop = top;
  if (fk) {
    const el = root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs */ } }
    }
  }
}

/** Row of toggleable pips. Clicking pip i sets used to i (if it was used) or i+1. */
export function pips({ max, used = 0, onChange, label = '', kind = 'used', fk }) {
  const n = Math.max(0, Number(max) || 0);
  const u = Math.min(n, Math.max(0, Number(used) || 0));
  const wrap = h('span', { class: ['ch-pips', `ch-pips-${kind}`], role: 'group', 'aria-label': `${label} ${u} of ${n} ${kind === 'used' ? 'used' : 'marked'}` });
  for (let i = 0; i < n; i++) {
    const on = i < u;
    wrap.append(h('button', {
      type: 'button', class: ['ch-pip', on && 'is-on'], 'aria-pressed': on ? 'true' : 'false',
      'data-fk': fk ? `${fk}:${i}` : null,
      title: `${label} ${i + 1}`.trim(),
      onclick: () => onChange?.(on ? i : i + 1),
    }));
  }
  return wrap;
}

/** Number with −/+ buttons. */
export function stepper(value, onChange, { min = -Infinity, max = Infinity, step = 1, fk, label = '', width } = {}) {
  const v = Number(value) || 0;
  const set = (n) => onChange?.(Math.min(max, Math.max(min, n)));
  const box = numberInput(v, (n) => set(n ?? 0), { class: 'input input-sm ch-step-input', min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null, step, 'data-fk': fk, 'aria-label': label, style: width ? { width } : null });
  return h('span', { class: 'ch-stepper' },
    h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Decrease ${label}`, disabled: v <= min, onclick: () => set(v - step), 'data-fk': fk ? `${fk}:-` : null }, icon('minus')),
    box,
    h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Increase ${label}`, disabled: v >= max, onclick: () => set(v + step), 'data-fk': fk ? `${fk}:+` : null }, icon('plus')));
}

/** Big stat box (AC, Initiative…). */
export function statBox({ label, value, sub, stat, title, onClick, className }) {
  const tag = onClick ? 'button' : 'div';
  return h(tag, {
    class: ['ch-stat', onClick && 'is-interactive', className], 'data-stat': stat || null, title: title || null,
    type: onClick ? 'button' : null, onclick: onClick || null,
  },
  h('span', { class: 'ch-stat-label' }, label),
  h('span', { class: 'ch-stat-value num' }, value),
  sub ? h('span', { class: 'ch-stat-sub' }, sub) : null);
}

/** Section panel with a heading row. */
export function section(id, title, { iconName, actions = [], className, sub } = {}, ...body) {
  return h('section', { class: ['panel', 'ch-sec', className], 'data-sec': id, id: `ch-sec-${id}`, 'aria-labelledby': `ch-h-${id}` },
    h('header', { class: 'panel-head ch-sec-head' },
      iconName ? icon(iconName) : null,
      h('h2', { class: 'ch-sec-title', id: `ch-h-${id}` }, title),
      sub ? h('span', { class: 'ch-sec-sub muted' }, sub) : null,
      h('span', { class: 'spacer' }),
      actions),
    h('div', { class: 'panel-body ch-sec-body' }, body));
}

/** Rendered markdown block (links become hyperlinks). */
export function md(src, { empty = '', className } = {}) {
  const el = h('div', { class: ['prose', 'ch-md', className] });
  if (String(src || '').trim()) renderInto(el, src);
  else if (empty) el.append(h('p', { class: 'muted ch-empty-line' }, empty));
  return el;
}

/** Inline markdown in a span (short fields such as Location may contain [[links]]). */
export function mdInline(src, { empty = '—' } = {}) {
  const el = h('span', { class: 'ch-md-inline' });
  if (String(src || '').trim()) el.innerHTML = renderInline(src);
  else el.append(h('span', { class: 'faint' }, empty));
  return el;
}

/** Portrait image (repo path or URL) or a crest with initials. */
export function portrait(char, { size = 'md' } = {}) {
  const box = h('div', { class: ['ch-portrait', `ch-portrait-${size}`], 'aria-hidden': 'true' },
    h('span', { class: 'ch-crest' }, initials(char?.name)));
  const src = char?.portrait;
  if (src) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', onerror: () => img.remove() });
    if (/^(https?:|data:)/.test(src)) { img.src = src; box.append(img); }
    else store.fileUrl(src).then((url) => { if (url) { img.src = url; box.append(img); } }).catch(() => {});
  }
  return box;
}

/** Portrait picker: URL or upload (stored in the repo under content/characters/portraits/). */
export function portraitField(char, onChange) {
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast('That image is over 3 MB; please use a smaller one.', { type: 'error' }); return; }
    const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${PORTRAIT_DIR}/${slugify(char.name || 'portrait')}-${shortId()}.${ext}`;
    try { await store.putBinary(path, f); onChange(path); toast('Portrait added. It is uploaded with your next Save.'); } catch (e) { toast(`Could not store the image: ${e.message}`, { type: 'error' }); }
  });
  const isUrl = /^https?:/.test(char.portrait || '');
  return h('div', { class: 'ch-portrait-field' },
    portrait(char, { size: 'lg' }),
    h('div', { class: 'stack stack-sm' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Portrait'),
        input({ value: isUrl ? char.portrait : '', placeholder: 'Paste an image URL (https://…)', 'data-fk': 'portrait-url', onchange: (e) => onChange(e.target.value.trim() || null) })),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => file.click() }, icon('upload'), 'Upload image'),
        char.portrait ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => onChange(null) }, icon('trash'), 'Remove') : null,
        char.portrait && !isUrl ? h('span', { class: 'muted ui text-xs' }, char.portrait.split('/').pop()) : null),
      file));
}

/** Modal showing a compendium entry. */
export function entryModal(entry, { title, actions = [] } = {}) {
  if (!entry) return null;
  return openModal({ title: title || entry.name, wide: true, body: renderEntry(entry), actions: [...actions, { label: 'Close', kind: 'ghost' }] });
}

export function chip(label, { onRemove, title, active, onClick, className } = {}) {
  const tag = onClick ? 'button' : 'span';
  return h(tag, { class: ['chip', active && 'is-active', className], type: onClick ? 'button' : null, title: title || null, onclick: onClick || null, 'aria-pressed': onClick ? String(!!active) : null },
    label,
    onRemove ? h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${label}`, onclick: (e) => { e.stopPropagation(); onRemove(); } }, icon('close')) : null);
}

export function hpBar(current, max, temp = 0) {
  const m = Math.max(1, Number(max) || 0);
  const c = Math.max(0, Math.min(m, Number(current) || 0));
  const pct = Math.round((c / m) * 100);
  const tpct = Math.min(100 - pct, Math.round(((Number(temp) || 0) / m) * 100));
  const state = pct <= 25 ? 'is-low' : pct <= 50 ? 'is-mid' : '';
  return h('div', { class: ['ch-hpbar', state], role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': m, 'aria-valuenow': c, 'aria-label': 'Hit points' },
    h('span', { class: 'ch-hpbar-fill', style: { width: `${pct}%` } }),
    tpct > 0 ? h('span', { class: 'ch-hpbar-temp', style: { width: `${tpct}%` } }) : null);
}

export function loading(text = 'Consulting the rules…') {
  return h('div', { class: 'ch-loading' }, h('span', { class: 'spinner' }), h('span', null, text));
}

// ---------- modifiers editor (custom abilities / overrides) ----------

const MOD_FIELDS = [
  ['ac', 'AC'], ['speed', 'Speed (ft)'], ['initiative', 'Initiative'], ['hpPerLevel', 'HP per level'], ['hpMax', 'HP max'],
  ['profBonus', 'Proficiency bonus'], ['attack', 'Attack rolls'], ['damage', 'Weapon damage'], ['spellDc', 'Spell save DC'], ['spellAttack', 'Spell attack'],
];

export function cleanModifiers(m) {
  const out = {};
  for (const [k] of MOD_FIELDS) if (Number(m?.[k])) out[k] = Number(m[k]);
  for (const k of ['abilities', 'saves', 'skills']) {
    const o = Object.fromEntries(Object.entries(m?.[k] || {}).filter(([, v]) => Number(v)).map(([a, v]) => [a, Number(v)]));
    if (Object.keys(o).length) out[k] = o;
  }
  if (m?.resistances?.length) out.resistances = [...new Set(m.resistances)];
  if (String(m?.senses || '').trim()) out.senses = String(m.senses).trim();
  return out;
}

/** Additive modifiers form: {ac, speed, …, abilities:{str}, saves:{all|str}, skills:{all|stealth}, resistances:[], senses} */
export function modifiersEditor(mods, onChange) {
  const m = clone(mods) || {};
  m.abilities = m.abilities || {}; m.saves = m.saves || {}; m.skills = m.skills || {}; m.resistances = m.resistances || [];
  const fire = () => onChange?.(cleanModifiers(m));
  const num = (obj, key, label) => h('label', { class: 'field ch-mod-field' }, h('span', { class: 'field-label' }, label),
    numberInput(obj[key] ?? '', (v) => { if (v == null || v === 0) delete obj[key]; else obj[key] = v; fire(); }, { class: 'input input-sm', placeholder: '0', step: 1 }));
  const skillsBox = h('div', { class: 'stack stack-sm' });
  const drawSkills = () => {
    clear(skillsBox);
    const rows = Object.entries(m.skills);
    rows.forEach(([sk, v]) => skillsBox.append(h('div', { class: 'row row-nowrap' },
      select([{ value: 'all', label: 'All skills' }, ...skillList().map((s) => ({ value: s.id, label: s.name }))], sk, (nv) => {
        const val = m.skills[sk]; delete m.skills[sk]; m.skills[nv] = val; drawSkills(); fire();
      }, { class: 'select input-sm' }),
      numberInput(v, (n) => { m.skills[sk] = n || 0; fire(); }, { class: 'input input-sm ch-w-num', step: 1 }),
      h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': 'Remove', onclick: () => { delete m.skills[sk]; drawSkills(); fire(); } }, icon('trash')))));
    skillsBox.append(h('button', {
      class: 'btn btn-sm btn-ghost', type: 'button',
      onclick: () => { const free = skillList().find((s) => !(s.id in m.skills)); m.skills[free ? free.id : 'all'] = 1; drawSkills(); fire(); },
    }, icon('plus'), 'Skill bonus'));
  };
  drawSkills();
  const resist = h('div', { class: 'row ch-chip-row' }, damageTypes().map((d) => {
    const b = h('button', {
      class: ['chip', m.resistances.includes(d.id) && 'is-active'], type: 'button', 'aria-pressed': String(m.resistances.includes(d.id)),
      onclick: () => {
        const on = m.resistances.includes(d.id);
        m.resistances = on ? m.resistances.filter((x) => x !== d.id) : [...m.resistances, d.id];
        b.classList.toggle('is-active', !on); b.setAttribute('aria-pressed', String(!on)); fire();
      },
    }, d.name);
    return b;
  }));
  return h('div', { class: 'ch-mods stack' },
    h('div', { class: 'ch-mod-grid' }, MOD_FIELDS.map(([k, l]) => num(m, k, l))),
    h('div', null, h('h4', { class: 'ch-mini-head' }, 'Ability scores'), h('div', { class: 'ch-mod-grid ch-mod-grid-6' }, ABILITIES.map((a) => num(m.abilities, a.id, a.name)))),
    h('div', null, h('h4', { class: 'ch-mini-head' }, 'Saving throws'), h('div', { class: 'ch-mod-grid ch-mod-grid-7' }, [num(m.saves, 'all', 'All'), ...ABILITIES.map((a) => num(m.saves, a.id, a.name))])),
    h('div', null, h('h4', { class: 'ch-mini-head' }, 'Skills'), skillsBox),
    damageTypes().length ? h('div', null, h('h4', { class: 'ch-mini-head' }, 'Resistances'), resist) : null,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Senses'), input({ value: m.senses || '', placeholder: 'e.g. Darkvision 60 ft.', onchange: (e) => { m.senses = e.target.value; fire(); } })));
}
