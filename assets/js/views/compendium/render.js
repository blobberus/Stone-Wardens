// renderEntry(entry) -> Node: a reference-wiki stat block per kind, with the Markdown description
// rendered through renderInto (so [[links]] in custom text are live). Also the embed markdown.
import { h } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { renderInto } from '../../core/markdown.js';
import { srd, cached } from '../../core/compendium.js';
import { store } from '../../core/store.js';
import { href } from '../../core/router.js';
import { fmtDate } from '../../core/util.js';
import {
  RULES, prettify, abilityName, abilityAbbr, skillName, damageName, propertyName, masteryName, className, entryName,
  ruleDesc, fmtCost, fmtWeight, fmtDamage, weaponProps, weaponKind, armorAC, spellSubtitle, spellDuration,
  spellComponents, castingTime, itemSubtitle, featSubtitle, usesText, modifiersSummary, speciesSize, speciesSpeed,
  primaryAbility, statLine, kindOne, GEAR_CATS, ARMOR_CATS, CASTER_KINDS, locationSwatch, linkPrefix,
} from './meta.js';

export { statLine };

// ---------- small builders ----------

const stat = (label, value) => {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
  return h('div', { class: 'cp-stat' }, h('dt', null, label), h('dd', null, value));
};
const stats = (...rows) => {
  const kids = rows.flat().filter(Boolean);
  return kids.length ? h('dl', { class: 'cp-stats' }, kids) : null;
};
const section = (title, ...kids) => h('section', { class: 'cp-sec' }, h('h3', { class: 'cp-sec-title' }, title), ...kids);
const md = (src, cls = '') => {
  if (!src || !String(src).trim()) return null;
  const el = h('div', { class: ['cp-md', cls] });
  renderInto(el, String(src));
  return el;
};
const joinNodes = (nodes, sep = ', ') => nodes.flatMap((n, i) => (i ? [sep, n] : [n]));

/** Link to another compendium entry; plain text when it is not in the library. */
export function entryLink(kind, id, label) {
  const hit = cached(kind).find((e) => e.id === id);
  const text = label || hit?.name || prettify(id);
  if (!hit) return h('span', { class: 'cp-unresolved', title: 'Not in the compendium' }, text);
  return h('a', { class: 'cp-link', href: href('compendium', kind, id) }, text);
}
/** An equipment id may be gear, a weapon or armor. */
function equipLink(id, label) {
  for (const k of ['gear', 'weapon', 'armor', 'magic-item']) if (cached(k).some((e) => e.id === id)) return entryLink(k, id, label);
  return h('span', null, label || prettify(id));
}

export function originBadges(e) {
  const out = [];
  if (e.origin === 'srd') out.push(h('span', { class: 'badge badge-ok', title: 'System Reference Document 5.2 (CC-BY-4.0)' }, 'SRD 5.2'));
  if (e.origin === 'stub') out.push(h('span', { class: 'badge badge-warn', title: 'Short summary written for this site' }, 'Stub'));
  if (e.origin === 'builtin') out.push(h('span', { class: 'badge' }, 'Built-in'));
  if (e.origin === 'custom') {
    out.push(h('span', { class: 'badge badge-accent', title: 'In the party’s shared library' }, 'Custom'));
    if (e.path && store.isDirty(e.path)) out.push(h('span', { class: 'badge badge-warn', title: 'Saved on this device only. Press Save to publish it to the repository.' }, 'Unsaved'));
  }
  if (e.source) out.push(h('span', { class: 'badge', title: 'Source book' }, e.source));
  if (e.legacy) out.push(h('span', { class: 'badge', title: '2014-era content, usable with 2024 rules' }, 'Legacy (2014)'));
  if (e.verify) out.push(h('span', { class: 'badge badge-danger', title: 'Not yet checked against the book' }, 'Unverified'));
  return out;
}

function subtitle(e) {
  switch (e.kind) {
    case 'weapon': return `${prettify(e.category)} ${prettify(weaponKind(e))} Weapon`;
    case 'armor': return e.category === 'shield' ? 'Shield' : `${ARMOR_CATS[e.category] || prettify(e.category)} Armor`;
    case 'gear': return `${GEAR_CATS[e.category] || prettify(e.category) || 'Gear'}${e.tool && !/tool/i.test(GEAR_CATS[e.category] || '') ? ' (Tool)' : ''}`;
    case 'magic-item': return itemSubtitle(e);
    case 'spell': return spellSubtitle(e);
    case 'feat': return featSubtitle(e);
    case 'ability': return 'Ability';
    case 'species': return 'Species';
    case 'class': return 'Class';
    case 'subclass': return `${className(e.class)} Subclass${e.summary ? `: ${e.summary}` : ''}`;
    case 'background': return 'Background';
    case 'location-type': return 'Location type';
    default: return kindOne(e.kind);
  }
}
export const entrySubtitle = subtitle;

// ---------- per-kind bodies ----------

const BODY = {
  weapon(e) {
    const props = (e.properties || []).map((p, i) => h('span', { class: 'cp-term', title: ruleDesc('weaponProperties', p).slice(0, 300) || null }, weaponProps(e)[i]));
    const rules = [
      ...(e.properties || []).map((p) => ruleDesc('weaponProperties', p) && `**${propertyName(p)}.** ${ruleDesc('weaponProperties', p)}`),
      e.mastery && ruleDesc('weaponMasteries', e.mastery) && `**Mastery: ${masteryName(e.mastery)}.** ${ruleDesc('weaponMasteries', e.mastery)}`,
    ].filter(Boolean).join('\n\n');
    return [
      stats(
        stat('Damage', fmtDamage(e)),
        stat('Properties', props.length ? joinNodes(props) : '—'),
        stat('Mastery', masteryName(e.mastery) || '—'),
        e.ammunition ? stat('Ammunition', equipLink(e.ammunition)) : null,
        stat('Weight', fmtWeight(e.weight)),
        stat('Cost', fmtCost(e.cost)),
        e.notes ? stat('Notes', e.notes) : null),
      md(e.description, 'cp-desc'),
      rules ? h('details', { class: 'cp-rules', open: true }, h('summary', null, 'Properties and mastery'), md(rules)) : null,
    ];
  },
  armor(e) {
    return [
      stats(
        stat('Armor Class', armorAC(e)),
        stat('Strength', e.strMin ? `Str ${e.strMin}` : '—'),
        stat('Stealth', e.stealthDisadvantage ? 'Disadvantage' : '—'),
        stat('Weight', fmtWeight(e.weight)),
        stat('Cost', fmtCost(e.cost)),
        e.don || e.doff ? stat('Don / Doff', `${e.don || '—'} / ${e.doff || '—'}`) : null),
      md(e.description, 'cp-desc'),
    ];
  },
  gear(e) {
    let desc = e.description || '';
    if (e.tool && (e.ability || e.utilize || e.craft)) {
      // The SRD text repeats Ability/Utilize/Craft, which the stat rows below show (with links).
      desc = desc.split(/\n{2,}/).filter((p) => !/^\*\*(Ability|Utilize|Craft):\*\*/.test(p.trim())).join('\n\n');
    }
    return [
      stats(
        stat('Cost', fmtCost(e.cost)),
        stat('Weight', fmtWeight(e.weight)),
        e.ability ? stat('Ability', abilityName(e.ability)) : null,
        e.utilize?.length ? stat('Utilize', e.utilize.map((u) => `${u.name}${u.dc ? ` (DC ${u.dc})` : ''}`).join('; ')) : null,
        e.craft?.length ? stat('Craft', joinNodes(e.craft.map((id) => equipLink(id)))) : null,
        e.contents?.length ? stat('Contents', joinNodes(e.contents.map((c) => h('span', null, c.qty > 1 ? `${c.qty} × ` : '', equipLink(c.id))))) : null,
        e.quantity ? stat('Bundle', `${e.quantity}${e.storage ? `, stored in ${entryName('gear', e.storage)}` : ''}`) : null),
      md(desc, 'cp-desc'),
    ];
  },
  'magic-item'(e) {
    const mods = modifiersSummary(e.modifiers);
    return [
      stats(
        e.base?.id ? stat('Base item', entryLink(e.base.kind || 'weapon', e.base.id)) : null,
        e.variantOf ? stat('Variant of', entryLink('magic-item', e.variantOf)) : null,
        e.variants?.length ? stat('Variants', joinNodes(e.variants.map((id) => entryLink('magic-item', id)))) : null,
        mods.length ? stat('Modifiers', mods.join(', ')) : null),
      md(e.description, 'cp-desc'),
    ];
  },
  spell(e) {
    const effect = [
      e.attack ? `${prettify(e.attack)} spell attack` : null,
      e.save ? `${abilityName(e.save)} saving throw` : null,
    ].filter(Boolean).join('; ');
    const time = e.castingTrigger ? `${castingTime(e)}, ${e.castingTrigger}` : castingTime(e);
    return [
      stats(
        stat('Casting Time', time),
        stat('Range', e.range || '—'),
        stat('Components', spellComponents(e)),
        stat('Duration', spellDuration(e)),
        effect ? stat('Attack / Save', effect) : null,
        e.damage?.dice ? stat('Damage', `${e.damage.dice}${e.damage.type ? ` ${damageName(e.damage.type)}` : ''}`) : null),
      md(e.description, 'cp-desc'),
      e.higherLevel ? md(`**${Number(e.level) === 0 ? 'Cantrip Upgrade' : 'Using a Higher-Level Spell Slot'}.** ${e.higherLevel}`, 'cp-desc cp-higher') : null,
      e.statBlock ? h('div', { class: 'cp-statblock' }, md(e.statBlock)) : null,
    ];
  },
  feat(e) {
    const mods = modifiersSummary(e.modifiers);
    const asi = abilityIncreaseText(e.choice);
    return [
      stats( // the prerequisite is already in the subtitle line
        stat('Repeatable', e.repeatable ? (e.repeatableNote || 'Yes') : 'No'),
        asi ? stat('Ability Score Increase', asi) : null,
        mods.length ? stat('Modifiers', mods.join(', ')) : null),
      md(e.description, 'cp-desc'),
    ];
  },
  ability(e) {
    const mods = modifiersSummary(e.modifiers);
    return [
      stats(stat('Uses', usesText(e)), stat('Modifiers', mods.length ? mods.join(', ') : '—')),
      md(e.description, 'cp-desc'),
    ];
  },
  species(e) {
    const traitBlock = (t) => h('div', { class: 'cp-feature' },
      h('h4', { class: 'cp-feature-title' }, t.name, t.level > 1 ? h('span', { class: 'cp-feature-level' }, ` (character level ${t.level})`) : null),
      md(t.description));
    return [
      stats(
        stat('Creature Type', e.type || 'Humanoid'),
        stat('Size', speciesSize(e)),
        stat('Speed', speciesSpeed(e)),
        stat('Darkvision', e.darkvision ? `${e.darkvision} ft.` : '—')),
      e.notes ? h('p', { class: 'cp-note muted' }, e.notes) : null,
      md(e.description, 'cp-desc'),
      e.traits?.length ? section(`${e.name} Traits`, e.traits.map(traitBlock)) : null,
      e.subspecies?.length ? section(e.subspeciesLabel || 'Lineages', e.subspecies.map((s) => h('details', { class: 'cp-sub' },
        h('summary', null, s.name, s.damageType ? h('span', { class: 'muted' }, ` · ${damageName(s.damageType)}`) : null,
          s.darkvision ? h('span', { class: 'muted' }, ` · Darkvision ${s.darkvision} ft.`) : null),
        (s.traits || []).map(traitBlock)))) : null,
    ];
  },
  class(e) {
    const p = e.proficiencies || {};
    const subs = cached('subclass').filter((s) => s.class === e.id);
    const skills = e.skillChoices ? `Choose ${e.skillChoices.choose}: ${(e.skillChoices.from || []).map(skillName).join(', ')}` : null;
    const weapons = (p.weapons || []).map((w) => (w === 'simple' || w === 'martial' ? `${prettify(w)} weapons` : entryName('weapon', w)));
    const armor = (p.armor || []).map((a) => (a === 'shields' ? 'Shields' : `${prettify(a)} armor`));
    const caster = e.spellcasting
      ? `${CASTER_KINDS[e.spellcasting.kind] || 'Spellcaster'} (${abilityName(e.spellcasting.ability)})${e.spellcasting.focus ? `; focus: ${e.spellcasting.focus}` : ''}`
      : null;
    const featuresBox = h('div', { class: 'cp-features' });
    const table = h('div', { class: 'table-wrap cp-level-table' });
    fillClassLevels(e, table, featuresBox);
    return [
      stats(
        stat('Hit Point Die', e.hitDie ? `d${e.hitDie} per ${e.name} level` : '—'),
        stat('Primary Ability', primaryAbility(e)),
        stat('Saving Throws', (e.saves || []).map(abilityName).join(', ') || '—'),
        skills ? stat('Skill Proficiencies', skills) : null,
        stat('Weapon Proficiencies', [...weapons, p.weaponsNote].filter(Boolean).join(', ') || '—'),
        stat('Armor Training', armor.join(', ') || 'None'),
        (p.tools?.length || e.toolChoices) ? stat('Tool Proficiencies', e.toolChoices?.text || p.tools.map((t) => entryName('gear', t)).join(', ')) : null,
        caster ? stat('Spellcasting', caster) : null,
        e.startingEquipment?.text ? stat('Starting Equipment', e.startingEquipment.text) : null,
        subs.length ? stat('Subclasses', joinNodes(subs.map((s) => entryLink('subclass', s.id)))) : null),
      md(e.description, 'cp-desc'),
      section(`${e.name} Features`, table, featuresBox),
    ];
  },
  subclass(e) {
    const sc = e.spellcasting;
    return [
      stats(
        stat('Class', entryLink('class', e.class)),
        sc ? stat('Spellcasting', `${CASTER_KINDS[sc.kind] || 'Spellcaster'} (${abilityName(sc.ability)})${sc.list ? `, ${className(sc.list)} spell list` : ''}`) : null),
      md(e.description, 'cp-desc'),
      e.features?.length ? section('Features', [...e.features].sort((a, b) => (a.level || 0) - (b.level || 0)).map((f) => h('div', { class: 'cp-feature' },
        h('h4', { class: 'cp-feature-title' }, h('span', { class: 'cp-feature-level' }, `Level ${f.level || '—'}: `), f.name,
          f.verify ? h('span', { class: 'badge badge-danger cp-inline-badge', title: 'Not yet checked against the book' }, 'Unverified') : null),
        md(f.description)))) : null,
    ];
  },
  background(e) {
    const tool = e.tool ? (e.tool.id ? equipLink(e.tool.id, e.tool.name) : e.tool.name || prettify(e.tool.category)) : null;
    return [
      stats(
        stat('Ability Scores', (e.abilityScores || []).map(abilityName).join(', ') || '—'),
        e.feat?.id ? stat('Feat', h('span', null, entryLink('feat', e.feat.id), e.feat.note ? ` (${e.feat.note})` : '')) : null,
        stat('Skill Proficiencies', (e.skills || []).map(skillName).join(', ') || '—'),
        tool ? stat('Tool Proficiency', tool) : null,
        e.equipment?.text ? stat('Equipment', e.equipment.text) : null),
      md(e.description, 'cp-desc'),
    ];
  },
  'location-type'(e) {
    return [
      h('div', { class: 'cp-loc-preview' }, locationSwatch(e, 44), h('span', null, e.name)),
      stats(
        stat('Icon', prettify(String(e.icon || 'mk-custom').replace(/^mk-/, ''))),
        stat('Colour', h('span', { class: 'cp-color' }, h('span', { class: 'cp-color-dot', style: { '--cp-pin': e.color || 'var(--pin-slate)' } }), String(e.color || '—'))),
        stat('Major place', e.major ? 'Yes — label stays visible when zoomed out' : 'No')),
      md(e.description, 'cp-desc'),
    ];
  },
};

function abilityIncreaseText(choice) {
  if (!choice) return null;
  const parts = choice.type === 'multi' ? choice.parts || [] : [choice];
  const asi = parts.find((p) => p?.type === 'ability-increase');
  if (!asi) return null;
  const from = (asi.from || []).map(abilityAbbr);
  const pts = Number(asi.points) || 1;
  const where = from.length ? (from.length === 1 ? from[0] : `one of ${from.join(', ')}`) : 'one ability';
  return `+${pts} to ${where}${pts > 1 && asi.maxPerAbility ? ` (max +${asi.maxPerAbility} each)` : ''}, to a maximum of ${asi.max || 20}`;
}

/** Level table + feature texts for a class (SRD features are in features.json; custom classes carry their own). */
function fillClassLevels(e, table, box) {
  const draw = (features) => {
    const levels = Array.isArray(e.levels) && e.levels.length ? e.levels : null;
    const inline = Array.isArray(e.features) ? e.features : [];
    const fname = (id) => {
      if (id === `${e.id}-subclass-feature`) return 'Subclass feature';
      return features?.[id]?.name || inline.find((f) => f.id === id)?.name || prettify(String(id).replace(`${e.id}-`, ''));
    };
    // Rows
    const rows = levels || Array.from({ length: 20 }, (_, i) => ({
      level: i + 1, prof: RULES.profBonusByLevel?.[i] ?? Math.ceil((i + 1) / 4) + 1, features: inline.filter((f) => Number(f.level) === i + 1).map((f) => f.id), counters: {},
    }));
    const counterKeys = [...new Set(rows.flatMap((r) => Object.keys(r.counters || {})))];
    const hasCantrips = rows.some((r) => r.cantrips);
    const hasPrepared = rows.some((r) => r.preparedSpells);
    const slotCols = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => rows.some((r) => r.slots?.[i]));
    const hasPact = rows.some((r) => r.pact);
    const th = (t, cls) => h('th', { class: cls || null, scope: 'col' }, t);
    const counterLabel = (k) => prettify(k.replace(/_count$/, 's').replace(/_/g, ' '));
    const fmtCounter = (v) => (v === true ? 'Yes' : v === false ? '—' : v ?? '—');
    table.replaceChildren(h('table', { class: 'table table-dense' },
      h('thead', null, h('tr', null,
        th('Level', 'num'), th('PB', 'num'), th('Features'),
        counterKeys.map((k) => th(counterLabel(k), 'num')),
        hasCantrips ? th('Cantrips', 'num') : null, hasPrepared ? th('Prepared', 'num') : null,
        hasPact ? [th('Slots', 'num'), th('Slot level', 'num')] : null,
        slotCols.map((i) => th(['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'][i], 'num')))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { class: 'num' }, r.level), h('td', { class: 'num' }, `+${r.prof}`),
        h('td', null, (r.features || []).map(fname).join(', ') || '—'),
        counterKeys.map((k) => h('td', { class: 'num' }, fmtCounter(r.counters?.[k]))),
        hasCantrips ? h('td', { class: 'num' }, r.cantrips ?? '—') : null,
        hasPrepared ? h('td', { class: 'num' }, r.preparedSpells ?? '—') : null,
        hasPact ? [h('td', { class: 'num' }, r.pact?.slots ?? '—'), h('td', { class: 'num' }, r.pact?.slotLevel ?? '—')] : null,
        slotCols.map((i) => h('td', { class: 'num' }, r.slots?.[i] || '—')))))));

    // Feature texts, once each, in level order.
    const seen = new Set();
    const list = [];
    for (const r of rows) {
      for (const id of r.features || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const f = features?.[id] || inline.find((x) => x.id === id);
        if (!f) continue;
        const lv = f.levels?.length > 1 ? `Levels ${f.levels.join(', ')}` : `Level ${f.level || r.level}`;
        list.push(h('div', { class: 'cp-feature' },
          h('h4', { class: 'cp-feature-title' }, h('span', { class: 'cp-feature-level' }, `${lv}: `), f.name),
          md(f.description)));
      }
    }
    box.replaceChildren(...list);
  };
  if (e.origin === 'custom' && !e.levels) draw(null);
  else {
    draw(null);
    srd('features').then((f) => draw(f)).catch(() => {});
  }
}

// ---------- public ----------

/**
 * renderEntry(entry, {compact}) -> <article> stat block.
 * compact: smaller title (picker preview / embeds), no author footer.
 */
export function renderEntry(entry, { compact = false } = {}) {
  if (!entry) return h('div', { class: 'empty-state cp-empty' }, h('p', null, 'Nothing selected.'));
  const e = entry;
  const T = compact ? 'h2' : 'h1';
  const art = h('article', { class: ['cp-entry', `cp-k-${e.kind}`, compact && 'is-compact'], 'data-kind': e.kind, 'data-id': e.id });
  art.append(
    h('header', { class: 'cp-entry-head' },
      h(T, { class: 'cp-entry-title' }, e.name || 'Untitled'),
      h('p', { class: 'cp-entry-sub' }, subtitle(e)),
      h('div', { class: 'cp-badges' }, originBadges(e))));
  if (e.origin === 'stub') {
    art.append(h('div', { class: 'callout cp-stub-note', 'data-callout': 'info' },
      h('div', { class: 'callout-title' }, h('span', null, `Summary only — see ${e.source || 'the source book'} for full text.`))));
  }
  let body = [];
  try { body = (BODY[e.kind] || ((x) => [md(x.description, 'cp-desc')]))(e); } catch (err) {
    console.error('[compendium] render failed', err);
    body = [h('p', { class: 'muted' }, 'This entry could not be displayed completely.'), md(e.description, 'cp-desc')];
  }
  art.append(...body.flat().filter(Boolean));
  if (e.origin === 'custom' && !compact) {
    const based = e.basedOn?.id ? h('span', null, ' · based on ', entryLink(e.basedOn.kind || e.kind, e.basedOn.id)) : null;
    art.append(h('footer', { class: 'cp-entry-foot muted' },
      icon('user', 16), ` Added by ${e.createdBy || 'a Warden'}`, e.updated ? ` · ${fmtDate(e.updated)}` : '', based));
  }
  return art;
}

/** Markdown for ![[weapon:Longsword]] embeds: a short stat line + the description. */
export function embedMarkdown(e) {
  if (!e) return null;
  const line = `*${subtitle(e)}*${statLine(e) && e.kind !== 'spell' && e.kind !== 'magic-item' ? ` — ${statLine(e)}` : ''}`;
  const parts = [line];
  if (e.kind === 'spell') parts.push(`**Casting Time:** ${castingTime(e)} · **Range:** ${e.range || '—'} · **Components:** ${spellComponents(e)} · **Duration:** ${spellDuration(e)}`);
  if (e.kind === 'weapon' && weaponProps(e).length) parts.push(`**Properties:** ${weaponProps(e).join(', ')}`);
  if (e.description) parts.push(String(e.description));
  else if (e.kind === 'species' && e.traits?.length) parts.push(e.traits.map((t) => `- **${t.name}.** ${t.description || ''}`).join('\n'));
  else if (e.kind === 'subclass' && e.features?.length) parts.push(e.features.map((f) => `- **Level ${f.level}: ${f.name}**`).join('\n'));
  if (e.kind === 'spell' && e.higherLevel) parts.push(`**${Number(e.level) === 0 ? 'Cantrip Upgrade' : 'Using a Higher-Level Spell Slot'}.** ${e.higherLevel}`);
  if (e.origin === 'stub') parts.push(`*Summary only — see ${e.source || 'the source book'} for full text.*`);
  if (linkPrefix(e.kind) == null && !e.description) parts.push('*No description.*');
  return parts.join('\n\n');
}
