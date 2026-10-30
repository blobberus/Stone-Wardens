// The pantheon's model (pure, Node-testable: tools/test_pantheon.mjs; docs/pantheon-model.md).
// Three source polygons hold 14 aspects: the outer Material square, the Mental hexagon and the inner Temporal
// square. A being is a valid combination of aspects, and the combination fixes its rank:
//   Absolute God = 1 Temporal · Major God = + 1 Mental · Minor God = + 2 Mental · Lesser God = + 1 Material ·
//   Angel = + 2 Material (4 + 24 + 60 + 240 + 360 = 688 possible beings).
// A combination's id is its aspect ids sorted and joined with "|", so the order they were picked in never matters.
// Saved beings are one file each under content/pantheon/ (the file name is not the combination: a being keeps its
// file when its aspects change). Export / import use the guide's version 4 document; version 3 files are migrated.

export const PANTHEON_DIR = 'content/pantheon';
export const VERSION = 4;

/** The three polygons, outermost first. radius: share of the drawing width; rotation: angle of the first point. */
export const GROUPS = [
  { id: 'material', label: 'Material', shape: 'square', radius: 0.43, rotation: -45, points: ['metal', 'water', 'fire', 'air'] },
  { id: 'mental', label: 'Mental', shape: 'hexagon', radius: 0.255, rotation: -60, points: ['strength', 'dexterity', 'constitution', 'wisdom', 'intelligence', 'charisma'] },
  { id: 'temporal', label: 'Temporal', shape: 'square', radius: 0.13, rotation: -45, points: ['decay', 'growth', 'stasis', 'equilibrium'] },
];
const NAMES = {
  metal: 'Metal', water: 'Water', fire: 'Fire', air: 'Air',
  strength: 'Strength', dexterity: 'Dexterity', constitution: 'Constitution', wisdom: 'Wisdom', intelligence: 'Intelligence', charisma: 'Charisma',
  decay: 'Decay', growth: 'Growth', stasis: 'Stasis', equilibrium: 'Equilibrium',
};
const ABBR = {
  metal: 'Met', water: 'Wat', fire: 'Fir', air: 'Air',
  strength: 'STR', dexterity: 'DEX', constitution: 'CON', wisdom: 'WIS', intelligence: 'INT', charisma: 'CHA',
  decay: 'Dec', growth: 'Gro', stasis: 'Sta', equilibrium: 'Equ',
};
/** What the Temporal aspects mean (the guide's wording). */
export const MEANINGS = {
  'temporal:decay': 'Diminishment, erosion, dissolution and release.',
  'temporal:growth': 'Increasing capacity, development, expansion and renewal.',
  'temporal:stasis': 'Holding a condition unchanged, or suspending change.',
  'temporal:equilibrium': 'Actively correcting change to restore or maintain balance.',
};

/** The 14 aspects: {id: 'mental:wisdom', group, name, abbr, index (clockwise on its polygon)}. */
export const NODES = GROUPS.flatMap((g) => g.points.map((p, index) => ({ id: `${g.id}:${p}`, group: g.id, name: NAMES[p], abbr: ABBR[p], index })));
const NODE = new Map(NODES.map((n) => [n.id, n]));
export const node = (id) => NODE.get(id) || null;
export const groupOf = (id) => GROUPS.find((g) => g.id === node(id)?.group) || null;
const GROUP_ORDER = { temporal: 0, mental: 1, material: 2 };

/** The five ranks, highest first. need: how many points of each group; symbol: the rank's ceremonial shape. */
export const RANKS = [
  { id: 'absolute', label: 'Absolute God', plural: 'Absolute Gods', symbol: 'dot', need: { temporal: 1, mental: 0, material: 0 }, possible: 4 },
  { id: 'major', label: 'Major God', plural: 'Major Gods', symbol: 'line', need: { temporal: 1, mental: 1, material: 0 }, possible: 24 },
  { id: 'minor', label: 'Minor God', plural: 'Minor Gods', symbol: 'triangle', need: { temporal: 1, mental: 2, material: 0 }, possible: 60 },
  { id: 'lesser', label: 'Lesser God', plural: 'Lesser Gods', symbol: 'rectangle', need: { temporal: 1, mental: 2, material: 1 }, possible: 240 },
  { id: 'angel', label: 'Angel', plural: 'Angels', symbol: 'pentagon', need: { temporal: 1, mental: 2, material: 2 }, possible: 360 },
];
export const rankOf = (id) => RANKS.find((r) => r.id === id) || null;
export const rankIndex = (id) => RANKS.findIndex((r) => r.id === id);
export const POSSIBLE = RANKS.reduce((n, r) => n + r.possible, 0); // 688

/** Aspects in reading order: Temporal, then Mental, then Material, each clockwise. Unknown ids are dropped. */
export function ordered(aspects) {
  return [...new Set(aspects || [])].filter((id) => NODE.has(id))
    .sort((a, b) => GROUP_ORDER[node(a).group] - GROUP_ORDER[node(b).group] || node(a).index - node(b).index);
}
export const comboId = (aspects) => [...aspects].sort().join('|');
export const aspectsOf = (id) => String(id || '').split('|').filter(Boolean);

/**
 * Classify a set of aspect ids: {ok: true, id, rank, aspects (reading order)} or {ok: false, reason}. The reason is
 * written for the person picking the points.
 */
export function classify(aspects) {
  const list = Array.isArray(aspects) ? aspects.map(String) : [];
  if (!list.length) return { ok: false, reason: 'Choose a Temporal aspect to begin: Decay, Growth, Stasis or Equilibrium.' };
  if (new Set(list).size !== list.length) return { ok: false, reason: 'Each aspect can be chosen only once.' };
  const unknown = list.find((id) => !NODE.has(id));
  if (unknown) return { ok: false, reason: `“${unknown}” is not one of the 14 aspects.` };
  const n = { temporal: 0, mental: 0, material: 0 };
  for (const id of list) n[node(id).group] += 1;
  if (n.temporal === 0) return { ok: false, reason: 'Every being has exactly one Temporal aspect: Decay, Growth, Stasis or Equilibrium.' };
  if (n.temporal > 1) return { ok: false, reason: 'A being has only one Temporal aspect.' };
  if (n.mental > 2) return { ok: false, reason: 'A being has at most two Mental aspects.' };
  if (n.material > 2) return { ok: false, reason: 'A being has at most two Material aspects.' };
  if (n.material && n.mental < 2) {
    return { ok: false, reason: `Material aspects come only after two Mental ones: a Lesser God is one Temporal, two Mental and one Material aspect.${n.mental ? ' Choose one more Mental aspect.' : ''}` };
  }
  const rank = RANKS.find((r) => r.need.temporal === n.temporal && r.need.mental === n.mental && r.need.material === n.material);
  return { ok: true, id: comboId(list), rank: rank.id, aspects: ordered(list) };
}

/** All 688 possible combinations, highest rank first: [{id, rank, aspects}]. */
export function catalog() {
  const by = (g) => GROUPS.find((x) => x.id === g).points.map((p) => `${g}:${p}`);
  const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b]));
  const T = by('temporal'), M = by('mental'), A = by('material');
  const out = [];
  const add = (rank, aspects) => out.push({ id: comboId(aspects), rank, aspects: ordered(aspects) });
  for (const t of T) add('absolute', [t]);
  for (const t of T) for (const m of M) add('major', [t, m]);
  for (const t of T) for (const mm of pairs(M)) add('minor', [t, ...mm]);
  for (const t of T) for (const mm of pairs(M)) for (const a of A) add('lesser', [t, ...mm, a]);
  for (const t of T) for (const mm of pairs(M)) for (const aa of pairs(A)) add('angel', [t, ...mm, ...aa]);
  return out;
}
let CATALOG = null;
const allCombos = () => (CATALOG ||= catalog());

const within = (small, big) => small.every((x) => big.includes(x));
/** The lower-rank combinations whose aspects all belong to this one, highest rank first (the being's chain). */
export const constituents = (aspects) => allCombos().filter((c) => c.aspects.length < aspects.length && within(c.aspects, aspects));
/** The higher-rank combinations that contain this one (how many there are, or the list). */
export const containers = (aspects) => allCombos().filter((c) => c.aspects.length > aspects.length && within(aspects, c.aspects));

/** "Equilibrium + Constitution + Intelligence" / "Equ · CON · INT" */
export const aspectNames = (aspects, sep = ' + ') => ordered(aspects).map((id) => node(id).name).join(sep);
export const aspectAbbrs = (aspects) => ordered(aspects).map((id) => node(id).abbr).join(' · ');
/** "Temporal — Equilibrium; Mental — Constitution, Intelligence; Material — Metal" (the guide's template line). */
export function aspectLine(aspects) {
  const list = ordered(aspects);
  return GROUPS.slice().reverse().map((g) => {
    const names = list.filter((id) => node(id).group === g.id).map((id) => node(id).name);
    return names.length ? `${g.label} — ${names.join(', ')}` : null;
  }).filter(Boolean).join('; ');
}

// ---------- picking points ----------

/**
 * A point clicked on the diagram: picked again = dropped; a second Temporal replaces the first; a third Mental (or
 * Material) replaces the earliest of the two picked. The list keeps the order the points were picked in.
 */
export function pick(selection, id) {
  if (!NODE.has(id)) return selection.slice();
  if (selection.includes(id)) return selection.filter((x) => x !== id);
  const group = node(id).group;
  const max = group === 'temporal' ? 1 : 2;
  let next = selection.slice();
  const same = next.filter((x) => node(x)?.group === group);
  if (same.length >= max) next = next.filter((x) => x !== same[0]);
  return [...next, id];
}

/** The editor's slots for a set of aspects: {t, m1, m2, a1, a2} ('' when empty), in reading order. */
export function slotsOf(aspects) {
  const list = ordered(aspects);
  const of = (g) => list.filter((id) => node(id).group === g);
  const [m1 = '', m2 = ''] = of('mental');
  const [a1 = '', a2 = ''] = of('material');
  return { t: of('temporal')[0] || '', m1, m2, a1, a2 };
}
/** The selectors a rank shows (Absolute: Temporal; Major: + Mental 1; … Angel: + Material 2). */
export const SLOTS = [
  { key: 't', group: 'temporal', label: 'Temporal' },
  { key: 'm1', group: 'mental', label: 'Mental 1', pair: 'm2' },
  { key: 'm2', group: 'mental', label: 'Mental 2', pair: 'm1' },
  { key: 'a1', group: 'material', label: 'Material 1', pair: 'a2' },
  { key: 'a2', group: 'material', label: 'Material 2', pair: 'a1' },
];
export const slotsFor = (rank) => SLOTS.slice(0, Math.max(0, rankIndex(rank)) + 1);
/** The aspects the shown selectors hold. */
export const slotAspects = (slots, rank) => slotsFor(rank).map((s) => slots[s.key]).filter(Boolean);
/** The smallest rank whose selectors show every filled slot. */
export function stageFor(slots) {
  const last = SLOTS.map((s, i) => (slots[s.key] ? i : -1)).reduce((a, b) => Math.max(a, b), 0);
  return RANKS[last].id;
}

// ---------- saved beings ----------

const str = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
/** Domains from the editor's text (one per line) or a saved list: trimmed, empty ones dropped, order kept. */
export function parseDomains(v) {
  const list = Array.isArray(v) ? v.map(str) : str(v).split(/\r?\n/);
  return list.map((d) => d.trim()).filter(Boolean);
}

/**
 * A saved being as the view uses it. The rank and combination id are always worked out from the aspects;
 * a doc whose aspects make no valid being keeps them and gets `invalid` (the reason).
 */
export function normalizeBeing(doc, file) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const raw = Array.isArray(d.aspects) ? d.aspects.map(str).map((x) => (x === 'temporal:stabilization' ? 'temporal:equilibrium' : x)) : [];
  const c = classify(raw);
  return {
    file,
    id: c.ok ? c.id : comboId(raw),
    aspects: c.ok ? c.aspects : raw,
    rank: c.ok ? c.rank : null,
    invalid: c.ok ? null : c.reason,
    title: str(d.title).trim(),
    domains: parseDomains(d.domains),
    description: str(d.description),
    worship: str(d.worship),
    by: str(d.by), created: str(d.created), updated: str(d.updated),
  };
}
/** What is written to content/pantheon/<file>.json (the guide's record plus who and when). */
export function beingDoc(b, { by = '', now = new Date().toISOString() } = {}) {
  const c = classify(b.aspects);
  return {
    id: c.ok ? c.id : comboId(b.aspects),
    aspects: c.ok ? c.aspects : b.aspects,
    rank: c.ok ? c.rank : null,
    title: str(b.title).trim(),
    domains: parseDomains(b.domains),
    description: str(b.description),
    worship: str(b.worship),
    by: b.by || by || undefined,
    created: b.created || now,
    updated: now,
  };
}

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.file.localeCompare(b.file);
/**
 * Beings grouped by rank: [{rank, beings}] in rank order (the invalid ones last, rank null). Two beings with the same
 * aspects (made at the same time on two devices, or one hidden by the DM) both show, flagged `twin` (the other's file).
 */
export function roster(beings) {
  const first = new Map();
  for (const b of [...beings].sort((a, b) => (a.created || '').localeCompare(b.created || '') || a.file.localeCompare(b.file))) {
    if (!b.invalid && !first.has(b.id)) first.set(b.id, b.file);
  }
  const marked = beings.map((b) => ({ ...b, twin: !b.invalid && first.get(b.id) !== b.file ? first.get(b.id) : null }));
  const groups = RANKS.map((r) => ({ rank: r, beings: marked.filter((b) => b.rank === r.id).sort(byTitle) }));
  const bad = marked.filter((b) => b.invalid).sort(byTitle);
  if (bad.length) groups.push({ rank: null, beings: bad });
  return groups;
}
/** combination id -> the being that holds it (the earliest made, when two do). */
export function occupants(beings) {
  const out = new Map();
  for (const b of [...beings].sort((a, b) => (a.created || '').localeCompare(b.created || '') || a.file.localeCompare(b.file))) {
    if (!b.invalid && !out.has(b.id)) out.set(b.id, b);
  }
  return out;
}
/** A being by title (case-insensitive), for [[pantheon:Title]] links; an exact combination of aspect names works too. */
export function findBeing(beings, target) {
  const t = str(target).trim().toLowerCase();
  if (!t) return null;
  const hit = beings.find((b) => b.title.toLowerCase() === t);
  if (hit) return hit;
  const names = t.split(/\s*\+\s*/);
  const ids = names.map((n) => NODES.find((x) => x.name.toLowerCase() === n)?.id);
  if (ids.every(Boolean)) {
    const c = classify(ids);
    if (c.ok) return beings.find((b) => b.id === c.id) || null;
  }
  return null;
}

// ---------- geometry ----------

/** Where each aspect sits on a W × W drawing: Map id -> {x, y, angle (degrees)}. */
export function positions(W = 1000) {
  const out = new Map();
  for (const g of GROUPS) {
    const n = g.points.length;
    g.points.forEach((p, i) => {
      const angle = g.rotation + (i * 360) / n;
      const a = (angle * Math.PI) / 180;
      out.set(`${g.id}:${p}`, { x: W / 2 + g.radius * W * Math.cos(a), y: W / 2 + g.radius * W * Math.sin(a), angle });
    });
  }
  return out;
}
/** Points [{id, x, y}] sorted by their angle around their centroid (ties by id): a consistent outline for any set. */
export function outline(points) {
  if (points.length < 3) return points.slice();
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const ang = (p) => Math.round(Math.atan2(p.y - cy, p.x - cx) * 1e6) / 1e6;
  return points.slice().sort((a, b) => ang(a) - ang(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/**
 * The individual sigil: the same aspects as an exact dot, line, equilateral triangle, rectangle or regular pentagon,
 * Temporal first from the top, clockwise. [{id, x, y}] on a W × W drawing.
 */
export function sigilPoints(aspects, W = 1000) {
  const list = ordered(aspects);
  const c = W / 2;
  const n = list.length;
  if (n === 1) return [{ id: list[0], x: c, y: c }];
  if (n === 2) return [{ id: list[0], x: c - 0.26 * W, y: c }, { id: list[1], x: c + 0.26 * W, y: c }];
  if (n === 4) {
    const w = 0.26 * W, hh = 0.17 * W;
    return [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([dx, dy], i) => ({ id: list[i], x: c + dx, y: c + dy }));
  }
  const r = (n === 3 ? 0.29 : 0.26) * W;
  const dy = n === 3 ? 0.05 * W : 0.02 * W; // centre the shape's height in the box
  return list.map((id, i) => {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
    return { id, x: c + r * Math.cos(a), y: c + dy + r * Math.sin(a) };
  });
}

// ---------- export / import ----------

/** The version 4 document: geometry, every being (the six characteristics + id) and optional view preferences. */
export function exportDoc(beings, viewState = {}) {
  return {
    version: VERSION,
    groups: GROUPS.map((g) => ({ id: g.id, label: g.label, shape: g.shape, radius: g.radius, rotation: g.rotation, points: g.points.map((p) => `${g.id}:${p}`) })),
    nodes: NODES.map((n) => ({ id: n.id, group: n.group, name: n.name, abbr: n.abbr })),
    gods: beings.filter((b) => !b.invalid).sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank) || byTitle(a, b)).map((b) => ({
      id: b.id, aspects: b.aspects, rank: b.rank, title: b.title, domains: b.domains, description: b.description, worship: b.worship,
    })),
    viewState,
  };
}

/**
 * Check a whole import file before anything changes: {ok, beings: [{aspects, title, domains, description, worship}],
 * errors: [text], notes: [text], version}. Version 4 records, version 3 records (powers / name / domain / charge) and a
 * bare list are read; "temporal:stabilization" becomes Equilibrium. Invalid aspects, a missing title and two
 * records with the same aspects are errors: then nothing is imported.
 */
export function parseImport(doc) {
  const errors = [];
  const notes = [];
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.gods) ? doc.gods : Array.isArray(doc?.beings) ? doc.beings : null;
  if (!list) return { ok: false, beings: [], errors: ['This file has no list of gods (a pantheon export has a “gods” list).'], notes, version: null };
  const version = Array.isArray(doc) ? null : Number(doc.version) || null;
  if (version && version > VERSION) notes.push(`The file says version ${version}; it was read as version ${VERSION}.`);
  const seen = new Map();
  const beings = [];
  let migrated = 0;
  list.forEach((r, i) => {
    const name = str(r?.title ?? r?.name).trim();
    const label = `Entry ${i + 1}${name ? ` (“${name}”)` : ''}`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(`${label} is not a record.`); return; }
    const old = !('aspects' in r) && ('powers' in r || 'name' in r || 'charge' in r || 'domain' in r);
    if (old) migrated += 1;
    const raw = Array.isArray(r.aspects) ? r.aspects : Array.isArray(r.powers) ? r.powers : null;
    if (!raw) { errors.push(`${label} has no aspects.`); return; }
    const aspects = raw.map(str).map((x) => (x === 'temporal:stabilization' ? 'temporal:equilibrium' : x));
    const c = classify(aspects);
    if (!c.ok) { errors.push(`${label}: ${c.reason}`); return; }
    if (!name) { errors.push(`${label} has no title.`); return; }
    if (r.rank && str(r.rank) !== c.rank) notes.push(`${label} said “${str(r.rank)}”; its aspects make it a ${rankOf(c.rank).label}.`);
    if (seen.has(c.id)) { errors.push(`${label} has the same aspects as entry ${seen.get(c.id) + 1} (${aspectNames(c.aspects)}). Each combination holds one being.`); return; }
    seen.set(c.id, i);
    const domains = Array.isArray(r.domains) ? parseDomains(r.domains) : r.domains != null ? parseDomains([str(r.domains)]) : r.domain != null ? parseDomains([str(r.domain)]) : [];
    beings.push({ aspects: c.aspects, rank: c.rank, id: c.id, title: name, domains, description: str(r.description ?? r.charge), worship: str(r.worship) });
  });
  if (migrated) notes.push(`${migrated === list.length ? 'All' : migrated} ${migrated === 1 ? 'entry was' : 'entries were'} in the older version 3 form (name, domain, charge) and ${migrated === 1 ? 'was' : 'were'} converted.`);
  return { ok: !errors.length && beings.length > 0, beings, errors: beings.length || errors.length ? errors : ['The list of gods is empty.'], notes, version };
}

/** The roster as Markdown, one template per being, grouped by rank (paragraphs kept). */
export function rosterMarkdown(beings, { heading = 'The Pantheon' } = {}) {
  const out = [`# ${heading}`, ''];
  for (const g of roster(beings.filter((b) => !b.invalid))) {
    if (!g.rank || !g.beings.length) continue;
    out.push(`# ${g.rank.plural}`, '');
    for (const b of g.beings) {
      out.push(`## ${b.title}`, '',
        `- **Aspects:** ${aspectLine(b.aspects)}`,
        `- **Rank:** ${g.rank.label}`,
        `- **Title:** ${b.title}`,
        `- **Domains:** ${b.domains.join('; ')}`, '',
        '### Description', b.description.trim(), '',
        '### Worship', b.worship.trim(), '');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** The guide's worked example, one being per rank (Section 7): a starting point to edit or delete. */
export const EXAMPLES = [
  { aspects: ['temporal:equilibrium'], title: 'The Returning Balance', domains: ['Balance', 'Correction'] },
  { aspects: ['temporal:equilibrium', 'mental:constitution'], title: 'The Keeper of the Steady Pulse', domains: ['Recovery', 'Bodily balance'] },
  { aspects: ['temporal:equilibrium', 'mental:constitution', 'mental:intelligence'], title: 'The Unbroken Thought', domains: ['Mental stamina', 'Disciplined recovery'] },
  {
    aspects: ['temporal:equilibrium', 'mental:constitution', 'mental:intelligence', 'material:metal'], title: 'The Tempered Mind',
    domains: ['Mental stamina', 'Resilient craft', 'Disciplined invention'],
    description: 'A patient deity who teaches that strength of thought depends on the ability to recover, adapt, and return to balance. Their body resembles worked metal repaired with visible seams. Each seam records a failure understood and a skill rebuilt.',
    worship: 'Smiths, scholars, and craftspeople honor this god before difficult work. Devotees pause at regular intervals, repair a damaged tool, and record one lesson learned from a mistake. Rest is sacred; concealing a known defect in one’s work violates the faith’s central teaching.',
  },
  { aspects: ['temporal:equilibrium', 'mental:constitution', 'mental:intelligence', 'material:metal', 'material:water'], title: 'The Quenching Herald', domains: ['Restoration', 'Tempering', 'Measured renewal'] },
];
