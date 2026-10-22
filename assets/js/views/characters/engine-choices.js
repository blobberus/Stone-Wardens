// The "walk": collects every granted feature/trait/feat/option (grants) and every Choice that applies to a
// character at its current levels, with the stored value. Key scheme: see the header of engine.js.
import {
  ABILITIES, ABILITY_NAMES, asArray, byLevelTable, clone, increaseMap, isObj, pickedIds, prettify, sumPoints, toNum,
} from './engine-util.js';
import { KNOWN } from './engine-known.js';

// ----- stored values -------------------------------------------------------------------------

const CLASS_SKILLS_RE = /^class-skills@([^:/>]+):1$/;
const SUBCLASS_RE = /^[^/>]*subclass@([^:/>]+):\d+$/;

const isEmptyValue = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);

/** Stored value of a choice key (reads the mirrored doc fields for subclass/subspecies/size/background/skills). */
export function getChoiceValue(char, key) {
  const c = isObj(char) ? char : {};
  const choices = isObj(c.choices) ? c.choices : {};
  const stored = choices[key];
  if (key === 'species:subspecies' || key === 'species:size') {
    const field = key === 'species:size' ? 'size' : 'subspecies';
    if (isObj(c.species) && c.species[field] !== undefined) return c.species[field] ?? undefined;
    return stored;
  }
  if (key === 'background:abilities') {
    if (!isEmptyValue(stored)) return stored;
    const ab = c.background?.abilityBonuses;
    return isObj(ab) && Object.keys(ab).length ? ab : undefined;
  }
  let m = CLASS_SKILLS_RE.exec(key);
  if (m) {
    if (stored !== undefined) return stored;
    const first = asArray(c.classes).find((x) => x?.id);
    return first?.id === m[1] && Array.isArray(c.skills) && c.skills.length ? c.skills : undefined;
  }
  m = SUBCLASS_RE.exec(key);
  if (m) {
    const row = asArray(c.classes).find((x) => x?.id === m[1]);
    if (row && row.subclass !== undefined && row.subclass !== null) return row.subclass;
    return row && row.subclass === null ? undefined : stored;
  }
  return stored;
}

/** Returns a new doc with the choice stored (null/empty removes it). Mirrors into the doc fields listed above. */
export function setChoice(char, key, value) {
  const next = { ...(isObj(char) ? char : {}) };
  const empty = isEmptyValue(value);
  const choices = { ...(isObj(next.choices) ? next.choices : {}) };
  if (empty) delete choices[key]; else choices[key] = clone(value);
  next.choices = choices;
  if (key === 'species:subspecies') next.species = { ...(next.species || {}), subspecies: empty ? null : value };
  else if (key === 'species:size') next.species = { ...(next.species || {}), size: empty ? null : value };
  else if (key === 'background:abilities') next.background = { ...(next.background || {}), abilityBonuses: empty ? {} : clone(value) };
  else {
    let m = CLASS_SKILLS_RE.exec(key);
    if (m && asArray(next.classes).find((x) => x?.id)?.id === m[1]) next.skills = empty ? [] : pickedIds(value);
    m = SUBCLASS_RE.exec(key);
    if (m) next.classes = asArray(next.classes).map((row) => (row?.id === m[1] ? { ...row, subclass: empty ? null : pickedIds(value)[0] ?? null } : row));
  }
  return next;
}

// ----- context -------------------------------------------------------------------------------

export function makeContext(char, rules, warnings) {
  const c = isObj(char) ? char : {};
  const ctx = {
    char: c, rules, warnings, classes: [], totalLevel: 0, grants: [], choices: [], featCount: {}, featsTaken: [],
    species: null, subspecies: null, background: null,
  };
  const choiceSub = (clsId) => {
    const k = Object.keys(isObj(c.choices) ? c.choices : {}).find((x) => SUBCLASS_RE.test(x) && SUBCLASS_RE.exec(x)[1] === clsId);
    return k ? pickedIds(c.choices[k])[0] : null;
  };
  for (const ce of asArray(c.classes)) {
    if (!ce?.id) continue;
    const cls = rules.classById[ce.id];
    if (!cls) { warnings.push(`Unknown class "${ce.id}" skipped.`); continue; }
    if (ctx.classes.some((x) => x.id === cls.id)) { warnings.push(`${cls.name} is listed twice; the second entry is ignored.`); continue; }
    const level = Math.max(1, Math.min(20, Math.floor(toNum(ce.level, 1))));
    const subId = ce.subclass || (ce.subclass === undefined ? choiceSub(cls.id) : null);
    let sub = subId ? rules.subclassById[subId] || null : null;
    if (subId && !sub) warnings.push(`Unknown subclass "${subId}" for ${cls.name}.`);
    if (sub && sub.class && sub.class !== cls.id) { warnings.push(`${sub.name} is not a ${cls.name} subclass.`); sub = null; }
    ctx.classes.push({ entry: ce, cls, id: cls.id, level, sub, isFirst: !ctx.classes.length, counters: cls.levels?.[level - 1]?.counters || {} });
    ctx.totalLevel += level;
  }
  ctx.totalLevel = Math.min(20, ctx.totalLevel);
  const pbTable = asArray(rules.core?.profBonusByLevel);
  const ov = c.overrides?.profBonus;
  ctx.pb = ov != null && ov !== '' && Number.isFinite(Number(ov)) ? Number(ov) : toNum(pbTable[Math.max(1, ctx.totalLevel) - 1], 2 + Math.floor((Math.max(1, ctx.totalLevel) - 1) / 4));
  return ctx;
}

// ----- grants & choices ----------------------------------------------------------------------

function addGrant(ctx, rec, meta = {}) {
  const g = {
    id: rec.id, name: rec.name || prettify(rec.id), description: rec.description || rec.summary || '', record: rec,
    sourceType: meta.sourceType || 'other', source: meta.source || '', classId: meta.classId ?? null,
    classLevel: meta.classLevel ?? null, subclassId: meta.subclassId ?? null, charLevel: meta.charLevel ?? null,
    choiceKey: meta.choiceKey, featureId: meta.featureId ?? null, parentKey: meta.parentKey ?? null,
    via: meta.via ?? null, grantedBy: meta.grantedBy ?? null, featKey: meta.featKey ?? null,
  };
  ctx.grants.push(g);
  return g;
}

const PASS_KEYS = ['from', 'category', 'points', 'max', 'maxPerAbility', 'list', 'listFrom', 'level', 'levelByClassLevel', 'school',
  'ritual', 'castingTime', 'alwaysPrepared', 'addToSpellbook', 'known', 'changeable', 'note', 'alternatives', 'countKey',
  'countByLevel', 'countFrom', 'orAnyFeat', 'default', 'patterns'];

function choiceCount(ctx, def, meta) {
  if (def.countFrom === 'proficiency-bonus') return ctx.pb;
  const ce = meta.classEntry;
  if (def.countKey && ce) {
    const v = ce.cls.levels?.[ce.level - 1]?.counters?.[def.countKey];
    if (v != null && Number.isFinite(Number(v))) return Math.max(0, Number(v));
  }
  if (def.countByLevel) {
    const v = byLevelTable(def.countByLevel, ce ? ce.level : ctx.totalLevel);
    if (v != null) return Math.max(0, toNum(v, 1));
  }
  if (def.count != null) return Math.max(1, toNum(def.count, 1));
  return 1;
}

const PART_LABELS = {
  skills: 'Skills', expertise: 'Expertise', tools: 'Tools', 'skills-or-tools': 'Skills or tools', languages: 'Languages',
  spells: 'Spells', ability: 'Ability', 'ability-increase': 'Ability scores', 'damage-type': 'Damage type',
  subspecies: 'Lineage', size: 'Size', options: 'Option', feat: 'Feat', 'weapon-mastery': 'Weapon mastery',
};

function partLabel(def) {
  if (def.type === 'ability' && def.key === 'spellcasting-ability') return 'Spellcasting ability';
  if (def.type === 'options' && def.key) return prettify(def.key);
  if (def.type === 'spells') {
    const n = toNum(def.count, 1);
    return def.level === 0 ? (n > 1 ? `${n} cantrips` : 'Cantrip') : n > 1 ? `${n} spells` : 'Spell';
  }
  return PART_LABELS[def.type] || prettify(def.type);
}

/** Ability-increase spec of a feat (direct or inside a multi). */
export function featAsiSpec(feat) {
  const c = feat?.choice;
  if (!c) return null;
  if (c.type === 'ability-increase') return c;
  if (c.type === 'multi') return asArray(c.parts).find((p) => p?.type === 'ability-increase') || null;
  return null;
}

export function isComplete(ch) {
  const v = ch.value;
  switch (ch.type) {
    case 'ability-increase': return sumPoints(increaseMap(v)) >= toNum(ch.points, 1);
    case 'asi-or-feat': {
      if (!isObj(v)) return false;
      if (v.feat && v.feat !== 'ability-score-improvement') return ch.featAsiPoints ? sumPoints(increaseMap(v.asi)) >= ch.featAsiPoints : true;
      return sumPoints(increaseMap(v.asi)) >= 2;
    }
    default:
      if (ch.count === 0) return true;
      return pickedIds(v).length >= Math.max(1, toNum(ch.count, 1));
  }
}

function addChoice(ctx, def, key, meta = {}) {
  if (!isObj(def) || !def.type) return null;
  if (def.perUse || def.type === 'spellcasting') return null;
  if (def.minLevel && ctx.totalLevel < def.minLevel) return null;
  if (def.type === 'multi') {
    asArray(def.parts).forEach((p, i) => {
      if (meta.skipAsi && p?.type === 'ability-increase') return;
      addChoice(ctx, p, `${key}/${p?.key ?? i}`, { ...meta, parentKey: key, label: `${meta.label || ''}: ${partLabel(p || {})}`.replace(/^: /, '') });
    });
    return null;
  }
  if (meta.skipAsi && def.type === 'ability-increase') return null;
  if (def.type === 'subspecies') key = 'species:subspecies';
  if (def.type === 'size') key = 'species:size';
  if (ctx.choices.some((c) => c.key === key)) return null;

  const ch = {
    key, featureId: meta.featureId ?? null, label: meta.label || prettify(meta.featureId || def.type), type: def.type,
    count: choiceCount(ctx, def, meta), value: undefined, options: [],
    source: meta.source || '', sourceType: meta.sourceType || 'other', classId: meta.classId ?? null,
    classLevel: meta.classLevel ?? null, subclassId: meta.subclassId ?? null, parentKey: meta.parentKey ?? null,
    featKey: meta.featKey ?? null, def,
  };
  for (const k of PASS_KEYS) if (def[k] !== undefined) ch[k] = def[k];
  if (def.key) ch.partKey = def.key;
  if (meta.spellClass) ch.spellClass = meta.spellClass;
  if (def.type === 'subclass') ch.class = ch.classId;
  if (def.type === 'subspecies') ch.species = ctx.species?.id ?? null;
  if (def.type === 'ability-increase') ch.points = toNum(def.points, 1);

  let value = getChoiceValue(ctx.char, key);
  if (value === undefined) {
    let dflt = meta.defaultValue;
    if (dflt === undefined && def.type === 'options' && def.key === 'spell-list' && meta.featNote) {
      const id = String(meta.featNote).trim().toLowerCase();
      if (asArray(def.options).some((o) => o.id === id)) dflt = id;
    }
    if (dflt === undefined && def.default != null) dflt = def.type === 'spells' ? asArray(def.default) : def.default;
    if (dflt !== undefined) { value = dflt; ch.defaulted = true; }
  }
  ch.value = value;
  ctx.choices.push(ch);

  if (def.type === 'feat' || def.type === 'asi-or-feat') followFeat(ctx, ch, def, meta);
  else if (def.type === 'options') followOptions(ctx, ch, def, meta);
  ch.complete = isComplete(ch);
  return ch;
}

function followFeat(ctx, ch, def, meta) {
  const v = ch.value;
  const featId = typeof v === 'string' ? v : Array.isArray(v) ? v[0] : isObj(v) ? v.feat : null;
  const R = ctx.rules;
  const baseMeta = { classId: meta.classId, classLevel: meta.classLevel, classEntry: meta.classEntry, charLevel: meta.charLevel };
  if (def.type === 'asi-or-feat') {
    ch.points = 2; ch.maxPerAbility = 2; ch.max = 20; ch.from = ABILITIES;
    if (!featId || featId === 'ability-score-improvement') {
      if (isObj(v) && sumPoints(increaseMap(v.asi)) > 0) {
        const rec = R.featById['ability-score-improvement'] || { id: 'ability-score-improvement', name: 'Ability Score Improvement', description: '' };
        addGrant(ctx, rec, { ...baseMeta, sourceType: 'feat', source: 'Feat', via: meta.source, grantedBy: ch.key, featureId: ch.featureId });
      }
      return;
    }
  }
  if (!featId) return;
  const alt = asArray(def.alternatives).find((a) => a?.id === featId);
  if (alt) {
    addGrant(ctx, alt, { ...baseMeta, sourceType: meta.sourceType, source: meta.source, grantedBy: ch.key, featureId: ch.featureId });
    const kn = KNOWN[alt.id];
    if (kn?.choice) addChoice(ctx, kn.choice, `${ch.key}>${alt.id}`, { ...meta, label: alt.name, parentKey: ch.key, spellClass: kn.cantripClass });
    return;
  }
  const feat = R.featById[featId];
  if (!feat) { ctx.warnings.push(`Unknown feat "${featId}" (${ch.label}).`); return; }
  if (def.type === 'asi-or-feat') {
    const spec = featAsiSpec(feat);
    if (spec) { ch.featAsiPoints = toNum(spec.points, 1); ch.points = ch.featAsiPoints; ch.from = asArray(spec.from).length ? spec.from : ABILITIES; ch.max = toNum(spec.max, 20); ch.maxPerAbility = spec.maxPerAbility ?? ch.featAsiPoints; }
  }
  grantFeat(ctx, feat, { ...baseMeta, via: meta.source, grantedBy: ch.key, skipAsi: def.type === 'asi-or-feat' });
}

function followOptions(ctx, ch, def, meta) {
  const seen = {};
  for (const id of pickedIds(ch.value)) {
    const opt = asArray(def.options).find((o) => o?.id === id);
    if (!opt) { ctx.warnings.push(`Unknown option "${id}" for ${ch.label}.`); continue; }
    seen[id] = (seen[id] || 0) + 1;
    addGrant(ctx, opt, {
      sourceType: 'option', source: meta.source, classId: meta.classId, classLevel: meta.classLevel, subclassId: meta.subclassId,
      featureId: ch.featureId, parentKey: ch.key, charLevel: meta.charLevel, featKey: meta.featKey,
    });
    if (opt.choice) {
      const k = seen[id] === 1 ? `${ch.key}>${id}` : `${ch.key}>${id}@${seen[id]}`;
      addChoice(ctx, opt.choice, k, { ...meta, label: `${opt.name}: ${partLabel(opt.choice)}`, parentKey: ch.key });
    }
  }
}

/** Grant a feat (its inner choices use `feat:${id}`, then `feat:${id}@2`… for repeated instances). */
export function grantFeat(ctx, feat, meta = {}) {
  const n = (ctx.featCount[feat.id] = (ctx.featCount[feat.id] || 0) + 1);
  if (n > 1 && !feat.repeatable) ctx.warnings.push(`${feat.name} is taken more than once but isn't repeatable.`);
  const key = n === 1 ? `feat:${feat.id}` : `feat:${feat.id}@${n}`;
  const g = addGrant(ctx, feat, {
    sourceType: 'feat', source: 'Feat', via: meta.via, grantedBy: meta.grantedBy, featKey: key,
    choiceKey: feat.choice ? key : undefined, classId: meta.classId, classLevel: meta.classLevel, featureId: feat.id,
  });
  ctx.featsTaken.push({ id: feat.id, key, grantedBy: meta.grantedBy ?? null, grant: g });
  if (feat.choice) {
    addChoice(ctx, feat.choice, key, {
      sourceType: 'feat', source: `Feat: ${feat.name}`, featureId: feat.id, label: n > 1 ? `${feat.name} (${n})` : feat.name, featKey: key,
      featNote: meta.featNote, skipAsi: meta.skipAsi, classId: meta.classId, classLevel: meta.classLevel, classEntry: meta.classEntry,
    });
  }
  return g;
}

const containsType = (def, type) => isObj(def) && (def.type === type || asArray(def.parts).some((p) => containsType(p, type)));

// ----- walkers -------------------------------------------------------------------------------

function walkSpecies(ctx) {
  const sid = ctx.char.species?.id;
  if (!sid) return;
  const R = ctx.rules;
  const sp = R.speciesById[sid];
  if (!sp) { ctx.warnings.push(`Unknown species "${sid}".`); return; }
  ctx.species = sp;
  const lvl = Math.max(1, ctx.totalLevel);
  const meta = { sourceType: 'species', source: sp.name, featureId: null };
  if (asArray(sp.sizeOptions).length > 1) addChoice(ctx, { type: 'size', from: sp.sizeOptions }, 'species:size', { ...meta, featureId: 'size', label: `${sp.name}: size` });
  let hasSub = false;
  for (const t of asArray(sp.traits)) {
    if (!t?.id) continue;
    if (containsType(t.choice, 'subspecies')) hasSub = true;
    if (toNum(t.level, 1) > lvl) continue;
    const key = `species:${t.id}`;
    addGrant(ctx, t, { ...meta, charLevel: toNum(t.level, 1), featureId: t.id, choiceKey: t.choice ? key : undefined });
    if (t.choice) addChoice(ctx, t.choice, key, { ...meta, featureId: t.id, label: t.name, charLevel: toNum(t.level, 1) });
  }
  const subs = asArray(sp.subspecies);
  if (subs.length && !hasSub) addChoice(ctx, { type: 'subspecies' }, 'species:subspecies', { ...meta, featureId: 'subspecies', label: sp.subspeciesLabel || `${sp.name} lineage` });
  const subId = pickedIds(getChoiceValue(ctx.char, 'species:subspecies'))[0];
  if (!subId) return;
  const sub = subs.find((s) => s.id === subId);
  if (!sub) { ctx.warnings.push(`"${subId}" is not a ${sp.name} option.`); return; }
  ctx.subspecies = sub;
  const smeta = { sourceType: 'subspecies', source: `${sp.name} (${sub.name})` };
  for (const t of asArray(sub.traits)) {
    if (!t?.id || toNum(t.level, 1) > lvl) continue;
    const key = `species:${t.id}`;
    addGrant(ctx, t, { ...smeta, charLevel: toNum(t.level, 1), featureId: t.id, choiceKey: t.choice ? key : undefined });
    if (t.choice) addChoice(ctx, t.choice, key, { ...smeta, featureId: t.id, label: t.name, charLevel: toNum(t.level, 1) });
  }
}

function walkBackground(ctx) {
  const bid = ctx.char.background?.id;
  if (!bid) return;
  const R = ctx.rules;
  const bg = R.backgroundById[bid];
  if (!bg) { ctx.warnings.push(`Unknown background "${bid}".`); return; }
  ctx.background = bg;
  const meta = { sourceType: 'background', source: bg.name };
  const bai = R.core?.backgroundAbilityIncrease || {};
  if (asArray(bg.abilityScores).length) {
    addChoice(ctx, {
      type: 'ability-increase', points: 3, maxPerAbility: 2, max: toNum(bai.max, 20), from: bg.abilityScores,
      patterns: bai.options || [[2, 1], [1, 1, 1]], note: bai.note || 'Increase one of these abilities by 2 and another by 1, or all three by 1.',
    }, 'background:abilities', { ...meta, featureId: 'background-abilities', label: `${bg.name}: ability scores` });
  }
  if (bg.tool && !bg.tool.id && (bg.tool.from || bg.tool.category)) {
    addChoice(ctx, { type: 'tools', count: 1, from: bg.tool.from || bg.tool.category, note: bg.tool.name },
      'background:tool', { ...meta, featureId: 'background-tool', label: `${bg.name}: ${bg.tool.name || 'tool proficiency'}` });
  }
  if (bg.feat?.id) {
    const feat = R.featById[bg.feat.id];
    if (feat) grantFeat(ctx, feat, { via: bg.name, featNote: bg.feat.note });
    else ctx.warnings.push(`Unknown background feat "${bg.feat.id}".`);
  }
}

function walkOrigin(ctx) {
  const sl = ctx.rules.core?.startingLanguages || { known: ['common'], choose: 2 };
  const known = new Set(asArray(sl.known));
  const count = toNum(sl.choose, 2);
  const extra = asArray(ctx.char.extraProficiencies?.languages).filter((l) => l && !known.has(l));
  addChoice(ctx, { type: 'languages', count, from: sl.from || 'standard', note: sl.note },
    'origin:languages', {
      sourceType: 'origin', source: 'Origin', featureId: 'starting-languages', label: 'Starting languages',
      defaultValue: extra.length >= count ? extra.slice(0, count) : undefined,
    });
}

function walkClasses(ctx) {
  const R = ctx.rules;
  for (const ce of ctx.classes) {
    const { cls, level } = ce;
    const meta0 = { sourceType: 'class', classId: cls.id, classEntry: ce };
    const sk = ce.isFirst ? cls.skillChoices : cls.multiclass?.proficiencies?.skills;
    if (sk?.choose) {
      addChoice(ctx, { type: 'skills', count: sk.choose, from: sk.from }, `class-skills@${cls.id}:1`,
        { ...meta0, classLevel: 1, featureId: 'class-skills', source: `${cls.name} 1`, label: `${cls.name} skill proficiencies` });
    }
    const tc = ce.isFirst ? cls.toolChoices : cls.multiclass?.proficiencies?.toolChoices;
    if (tc?.choose) {
      addChoice(ctx, { type: 'tools', count: tc.choose, from: tc.from, note: tc.text }, `class-tools@${cls.id}:1`,
        { ...meta0, classLevel: 1, featureId: 'class-tools', source: `${cls.name} 1`, label: `${cls.name} tool proficiencies` });
    }
    const subLvl = toNum(cls.subclassLevel, 3);
    let subclassChoiceSeen = false;
    for (let L = 1; L <= level; L++) {
      const row = cls.levels?.[L - 1] || {};
      for (const fid of asArray(row.features)) {
        const f = R.featureById[fid];
        const isPlaceholder = /-subclass-feature$/.test(fid);
        if (isPlaceholder && ce.sub) continue; // replaced by the chosen subclass's features below
        const rec = f || { id: fid, name: prettify(String(fid).replace(`${cls.id}-`, '')), description: '' };
        const key = `${fid}@${cls.id}:${L}`;
        const meta = { ...meta0, classLevel: L, source: `${cls.name} ${L}`, featureId: fid, label: rec.name };
        const firstAt = (cls.levels || []).findIndex((r) => asArray(r?.features).includes(fid)) + 1;
        const ownsChoice = rec.choice && !(rec.choice.countKey && firstAt && firstAt !== L);
        addGrant(ctx, rec, { ...meta, choiceKey: ownsChoice ? key : undefined });
        if (!ownsChoice) continue;
        if (rec.choice.type === 'subclass') { subclassChoiceSeen = true; addChoice(ctx, rec.choice, key, { ...meta, label: `${cls.name} subclass` }); }
        else addChoice(ctx, rec.choice, key, meta);
      }
      if (L === subLvl && !subclassChoiceSeen && asArray(R.subclassesByClass[cls.id]).length) {
        subclassChoiceSeen = true;
        addChoice(ctx, { type: 'subclass' }, `${cls.id}-subclass@${cls.id}:${L}`, { ...meta0, classLevel: L, featureId: `${cls.id}-subclass`, source: `${cls.name} ${L}`, label: `${cls.name} subclass` });
      }
      if (ce.sub && L >= subLvl) {
        for (const sf of asArray(ce.sub.features)) {
          if (!sf?.id || Math.max(subLvl, toNum(sf.level, subLvl)) !== L) continue;
          const key = `${sf.id}@${cls.id}:${L}`;
          const meta = { ...meta0, sourceType: 'subclass', subclassId: ce.sub.id, classLevel: L, source: `${ce.sub.name} ${L}`, featureId: sf.id, label: sf.name };
          // Third-caster subclasses: cantrips/prepared spells follow subclass.spellcasting, not a separate choice.
          const thirdCasterSpells = ce.sub.spellcasting && /-spellcasting$/.test(sf.id) && sf.choice?.type === 'spells';
          addGrant(ctx, sf, { ...meta, choiceKey: sf.choice && !thirdCasterSpells ? key : undefined });
          if (sf.choice && !thirdCasterSpells) addChoice(ctx, sf.choice, key, meta);
        }
      }
    }
  }
}

function walkExtraFeats(ctx) {
  const R = ctx.rules;
  for (const fe of asArray(ctx.char.feats)) {
    const id = isObj(fe) ? fe.id : fe;
    if (!id) continue;
    const feat = R.featById[id];
    if (!feat) { ctx.warnings.push(`Unknown feat "${id}".`); continue; }
    const from = isObj(fe) ? fe.from : null;
    // Feats recorded "from background/species" that the walk already granted are not duplicated.
    if (from && from !== 'extra' && from !== 'custom' && ctx.featCount[id]) continue;
    grantFeat(ctx, feat, { via: from ? prettify(from) : 'Extra feat' });
  }
}

function walkCustomAbilities(ctx) {
  const R = ctx.rules;
  asArray(ctx.char.abilities).forEach((ab, i) => {
    if (!isObj(ab)) return;
    const refId = ab.ref ? String(ab.ref).replace(/^ability\//, '') : null;
    const base = refId ? R.abilityById[refId] : null;
    if (refId && !base) ctx.warnings.push(`Unknown custom ability "${refId}".`);
    const { ref: _r, ...inline } = ab;
    const rec = { ...(base || {}), ...inline };
    rec.id = rec.id || refId || `custom-${i}`;
    rec.name = rec.name || prettify(refId) || 'Custom ability';
    const key = `ability:${rec.id}`;
    addGrant(ctx, rec, { sourceType: 'custom', source: 'Custom', featureId: rec.id, choiceKey: rec.choice ? key : undefined });
    if (rec.choice) addChoice(ctx, rec.choice, key, { sourceType: 'custom', source: 'Custom', featureId: rec.id, label: rec.name });
  });
}

/** Run the full walk. */
export function walk(char, rules, warnings) {
  const ctx = makeContext(char, rules, warnings);
  walkBackground(ctx); // first, so the background's feat is instance 1 (`feat:${id}`)
  walkSpecies(ctx);
  walkOrigin(ctx);
  walkClasses(ctx);
  walkExtraFeats(ctx);
  walkCustomAbilities(ctx);
  for (const ch of ctx.choices) ch.complete = isComplete(ch);
  return ctx;
}

// ----- option lists (computed after the sheet exists: they depend on scores & proficiencies) -----

const ARMOR_PROF = { 'light-armor': 'light', 'medium-armor': 'medium', 'heavy-armor': 'heavy', shields: 'shields', shield: 'shields' };

export function featPrereqReason(feat, ctx, sheet) {
  const p = feat?.prereq;
  if (!isObj(p)) return null;
  const score = (a) => sheet?.abilities?.[a]?.score ?? 10;
  const fmt = (r) => `${String(r.ability).toUpperCase()} ${r.min}+`;
  if (p.level && ctx.totalLevel < p.level) return `Requires level ${p.level}`;
  const any = asArray(p.abilities?.any);
  if (any.length && !any.some((r) => score(r.ability) >= r.min)) return `Requires ${any.map(fmt).join(' or ')}`;
  const all = asArray(p.abilities?.all);
  if (all.length && !all.every((r) => score(r.ability) >= r.min)) return `Requires ${all.map(fmt).join(' and ')}`;
  if (p.feature) {
    const needle = String(p.feature).toLowerCase();
    if (!ctx.grants.some((g) => g.sourceType !== 'feat' && String(g.name).toLowerCase().includes(needle))) return `Requires the ${p.feature} feature`;
  }
  if (p.spellcasting && !(sheet?.spellcasting || []).length) return 'Requires Spellcasting or Pact Magic';
  if (p.proficiency) {
    const need = ARMOR_PROF[p.proficiency] || p.proficiency;
    if (!(sheet?.proficiencies?.armor || []).includes(need)) return `Requires ${prettify(p.proficiency)} training`;
  }
  return null;
}

function featOption(f, ch, ctx, sheet) {
  const reason = featPrereqReason(f, ctx, sheet);
  const takenElsewhere = !f.repeatable && ctx.featsTaken.some((t) => t.id === f.id && t.grantedBy !== ch.key);
  const bits = [`${prettify(f.category)} feat`];
  if (f.prerequisite) bits.push(f.prerequisite);
  if (f.origin === 'stub') bits.push(f.source || 'stub');
  if (f.origin === 'custom') bits.push('custom');
  return {
    id: f.id, name: f.name, description: f.description || '', meta: bits.join(' · '), category: f.category,
    disabled: !!(reason || takenElsewhere), reason: reason || (takenElsewhere ? 'Already taken' : null), entry: f,
  };
}

function maxSlotLevel(sheet) {
  let m = 0;
  asArray(sheet?.slots).forEach((n, i) => { if (n > 0) m = i + 1; });
  if (sheet?.pact?.level) m = Math.max(m, sheet.pact.level);
  for (const s of asArray(sheet?.spellcasting)) m = Math.max(m, toNum(s.maxSpellLevel));
  return m;
}

function spellLevelFilter(ch) {
  const lvl = ch.def?.levelByClassLevel ? byLevelTable(ch.def.levelByClassLevel, ch.classLevel ?? 20) : ch.def?.level;
  return lvl;
}

function spellOptions(ch, ctx, sheet) {
  const R = ctx.rules;
  const def = ch.def || {};
  let lists = def.list;
  if (def.listFrom) {
    const sib = ctx.choices.find((c) => c.key === `${ch.parentKey}/${def.listFrom}`);
    lists = sib ? pickedIds(sib.value) : [];
  }
  const mine = asArray(ctx.char.spells).filter(isObj);
  let pool;
  if (lists === 'spellbook') {
    const book = new Set(mine.filter((s) => s.class === 'wizard' || s.spellbook).map((s) => s.id));
    pool = R.spells.filter((s) => book.has(s.id));
  } else if (lists == null || lists === 'any') pool = R.spells;
  else {
    const ls = asArray(lists);
    pool = R.spells.filter((s) => asArray(s.classes).some((c) => ls.includes(c)));
  }
  if (def.known) {
    const known = new Set([...mine.map((s) => s.id), ...asArray(sheet?.spells).map((s) => s.id)]);
    pool = pool.filter((s) => known.has(s.id));
  }
  const lvl = spellLevelFilter(ch);
  ch.spellLevel = lvl ?? null;
  const max = maxSlotLevel(sheet) || 1;
  pool = pool.filter((s) => {
    const L = toNum(s.level);
    if (lvl == null) return true;
    if (typeof lvl === 'number') return L === lvl;
    if (Array.isArray(lvl)) return L >= toNum(lvl[0]) && L <= toNum(lvl[1], 9);
    if (lvl === 'slot') return L >= 1 && L <= max;
    if (lvl === 'cantrip-or-slot') return L <= max;
    return true;
  });
  if (def.school) { const sc = asArray(def.school); pool = pool.filter((s) => sc.includes(s.school)); }
  if (def.ritual) pool = pool.filter((s) => s.ritual);
  if (def.castingTime) pool = pool.filter((s) => String(s.castingTime || '').toLowerCase().startsWith(String(def.castingTime).toLowerCase()));
  return pool.map((s) => ({
    id: s.id, name: s.name, level: toNum(s.level), school: s.school,
    meta: toNum(s.level) ? `Level ${s.level} ${prettify(s.school)}` : `${prettify(s.school)} cantrip`,
    description: s.description || '', entry: s,
  }));
}

function toolOptions(from, R) {
  let tools = R.tools;
  if (typeof from === 'string' && from !== 'any') tools = tools.filter((t) => t.category === from || t.id === from);
  else if (Array.isArray(from) && from.length) tools = tools.filter((t) => from.includes(t.id) || from.includes(t.category));
  return tools.map((t) => ({ id: t.id, name: t.name, meta: prettify(t.category), category: t.category, entry: t }));
}

function skillOptions(from, ctx, sheet, ch) {
  const R = ctx.rules;
  const ids = Array.isArray(from) && from.length ? from : R.skills.map((s) => s.id);
  const mine = new Set(pickedIds(ch?.value));
  return ids.map((id) => {
    const prof = !!sheet?.skills?.[id]?.prof && !mine.has(id);
    return { id, name: R.skillById[id]?.name || prettify(id), ability: R.skillById[id]?.ability, meta: prof ? 'already proficient' : '', proficient: prof };
  });
}

/** Option list for a Choice (needs the derived sheet for prerequisites and proficiencies). */
export function computeOptions(ch, ctx, sheet) {
  const R = ctx.rules;
  const def = ch.def || {};
  switch (ch.type) {
    case 'subclass':
      return asArray(R.subclassesByClass[ch.classId]).map((s) => ({
        id: s.id, name: s.name, description: s.summary || '', origin: s.origin, legacy: !!s.legacy,
        meta: s.origin === 'stub' ? `${s.source || 'Stub'}${s.legacy ? ' · 2014' : ''}` : s.origin === 'custom' ? 'Custom' : 'SRD 5.2', entry: s,
      }));
    case 'asi-or-feat':
      return R.feats
        .filter((f) => f.category !== 'epic-boon' || ctx.totalLevel >= 19)
        .map((f) => featOption(f, ch, ctx, sheet));
    case 'feat': {
      let feats = R.feats;
      if (Array.isArray(def.from) && def.from.length) feats = feats.filter((f) => def.from.includes(f.id));
      else if (def.category && !def.orAnyFeat) feats = feats.filter((f) => asArray(def.category).includes(f.category));
      else if (def.orAnyFeat) feats = feats.filter((f) => asArray(def.category).includes(f.category) || f.category === 'general' || f.category === 'origin');
      const out = feats.map((f) => featOption(f, ch, ctx, sheet));
      for (const a of asArray(def.alternatives)) out.push({ id: a.id, name: a.name, description: a.description || '', meta: 'alternative', alternative: true });
      return out;
    }
    case 'weapon-mastery': {
      let ws = R.weapons.filter((w) => w.mastery && (w.category === 'simple' || w.category === 'martial'));
      if (ch.classId === 'barbarian') ws = ws.filter((w) => w.weaponKind === 'melee');
      return ws.map((w) => ({
        id: w.id, name: w.name, mastery: w.mastery, entry: w,
        meta: `${prettify(w.category)} · ${R.masteryById[w.mastery]?.name || prettify(w.mastery)}`,
        description: R.masteryById[w.mastery]?.description || '',
      }));
    }
    case 'expertise': {
      const pool = Array.isArray(def.from) && def.from.length ? def.from : R.skills.map((s) => s.id);
      const mine = new Set(pickedIds(ch.value));
      return pool.filter((id) => sheet?.skills?.[id]?.prof || mine.has(id)).map((id) => ({
        id, name: R.skillById[id]?.name || prettify(id),
        meta: sheet?.skills?.[id]?.expertise && !mine.has(id) ? 'already expert' : '',
        disabled: !!(sheet?.skills?.[id]?.expertise && !mine.has(id)),
      }));
    }
    case 'skills': return skillOptions(def.from === 'any' ? null : def.from, ctx, sheet, ch);
    case 'tools': return toolOptions(def.from, R);
    case 'skills-or-tools':
      return [
        ...skillOptions(null, ctx, sheet, ch).map((o) => ({ ...o, meta: `Skill${o.meta ? ` · ${o.meta}` : ''}`, group: 'skill' })),
        ...toolOptions(null, R).map((o) => ({ ...o, meta: `Tool · ${o.meta}`, group: 'tool' })),
      ];
    case 'languages': {
      const known = new Set(asArray(sheet?.languages));
      const mine = new Set(pickedIds(ch.value));
      return R.languages.map((l) => ({
        id: l.id, name: l.name, rare: !!l.rare,
        meta: [l.rare ? 'rare' : '', known.has(l.id) && !mine.has(l.id) ? 'known' : ''].filter(Boolean).join(' · '),
        disabled: known.has(l.id) && !mine.has(l.id),
      }));
    }
    case 'options': {
      const mine = pickedIds(ch.value);
      const classLevel = ch.classId ? ctx.classes.find((c) => c.id === ch.classId)?.level ?? 0 : ctx.totalLevel;
      return asArray(def.options).map((o) => {
        let reason = null;
        if (o.prereq?.level && classLevel < o.prereq.level) reason = o.prereq.text || `Requires level ${o.prereq.level}`;
        else if (o.prereq?.invocation && !mine.includes(o.prereq.invocation)) reason = o.prereq.text || `Requires ${prettify(o.prereq.invocation)}`;
        const on = mine.includes(o.id);
        return { ...o, description: o.description || '', disabled: !!reason && !on, reason: on ? null : reason };
      });
    }
    case 'spells': return spellOptions(ch, ctx, sheet);
    case 'ability':
    case 'ability-increase':
      return (asArray(def.from).length ? def.from : ABILITIES).map((a) => ({ id: a, name: ABILITY_NAMES[a] || prettify(a) }));
    case 'damage-type': {
      const ids = asArray(def.from).length ? def.from : R.damageTypes.map((d) => d.id);
      return ids.map((id) => ({ id, name: R.damageTypes.find((d) => d.id === id)?.name || prettify(id) }));
    }
    case 'subspecies':
      return asArray(ctx.species?.subspecies).map((s) => ({
        id: s.id, name: s.name, description: asArray(s.traits).map((t) => `**${t.name}.** ${t.description || ''}`).join('\n\n'),
      }));
    case 'size':
      return (asArray(def.from).length ? def.from : asArray(ctx.species?.sizeOptions).length ? ctx.species.sizeOptions : ['Small', 'Medium']).map((s) => ({ id: s, name: s }));
    default:
      return [];
  }
}

/** Public Choice objects (internal fields stripped, options attached). */
export function publicChoices(ctx, sheet) {
  return ctx.choices.map((ch) => {
    let options = [];
    try { options = computeOptions(ch, ctx, sheet); } catch (e) { ctx.warnings.push(`Options for ${ch.label}: ${e.message}`); }
    const { def, ...rest } = ch;
    return { ...rest, options, complete: isComplete(ch) };
  });
}
