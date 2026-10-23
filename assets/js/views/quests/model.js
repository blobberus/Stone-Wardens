// Quest model: pure (no DOM, no store), Node-testable (tools/test_quests.mjs). docs/quests-model.md.
//
// A quest is one JSON doc, content/quests/<id>.json:
//   {id, title, type: 'main'|'minor'|'side', status: 'active'|'completed'|'failed', parent (minor: the main quest it
//    leads to), characters: [name or link body, e.g. "note:Old Grim" (people.js)], objectives: [{id, text, done}], description (markdown), rewards (markdown),
//    image (repo path or https URL, shown only when the quest is open), order, created, updated, createdBy}
// The log lists main quests first, then minor quests (grouped under the main quest they lead to), then side quests.

export const QUEST_DIR = 'content/quests';
export const MEDIA_DIR = 'content/media/quests';

export const TYPES = [
  { id: 'main', label: 'Main quest', plural: 'Main quests', icon: 'quest-main', hint: 'The heart of the campaign’s story.' },
  { id: 'minor', label: 'Minor quest', plural: 'Minor quests', icon: 'quest-minor', hint: 'A step of the story on the way to a main quest.' },
  { id: 'side', label: 'Side quest', plural: 'Side quests', icon: 'quest-side', hint: 'Away from the main story, for its own rewards.' },
];
export const STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];
/** List filters: the open quests, the finished ones (completed or failed), or everything. */
export const VIEWS = [
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Finished' },
  { id: 'all', label: 'All' },
];

const TYPE_IDS = new Set(TYPES.map((t) => t.id));
const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
export const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[2];
export const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const fold = (s) => str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const objectiveId = (i) => `o${i + 1}`;

/** A quest's image may be a repo path under content/ or an https URL; anything else is dropped. */
export function cleanImage(v) {
  const s = str(v).trim();
  if (/^https:\/\/\S+$/i.test(s)) return s;
  if (/^content\/[^\s]+\.(png|jpe?g|webp|gif|avif|svg)$/i.test(s) && !s.includes('..')) return s;
  return null;
}

/** Tags of the relevant characters: trimmed, no duplicates (case-insensitive), no empty ones. */
export function cleanTags(list) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : []) {
    const s = str(t).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

/** Fill in and sanitise a quest doc read from the repo (unknown fields are kept). */
export function normalizeQuest(raw, id = null) {
  const q = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const type = TYPE_IDS.has(q.type) ? q.type : 'side';
  const used = new Set();
  const objectives = (Array.isArray(q.objectives) ? q.objectives : []).map((o, i) => {
    const x = typeof o === 'string' ? { text: o } : o && typeof o === 'object' ? o : {};
    let oid = str(x.id).trim() || objectiveId(i);
    while (used.has(oid)) oid = `${oid}-${i}`;
    used.add(oid);
    return { ...x, id: oid, text: str(x.text), done: !!x.done };
  });
  return {
    ...q,
    id: str(q.id).trim() || id || '',
    title: str(q.title).trim() || 'Untitled quest',
    type,
    status: STATUS_IDS.has(q.status) ? q.status : 'active',
    parent: type === 'minor' && str(q.parent).trim() ? str(q.parent).trim() : null,
    characters: cleanTags(q.characters),
    objectives,
    description: str(q.description),
    rewards: str(q.rewards),
    image: cleanImage(q.image),
    order: Number.isFinite(Number(q.order)) && q.order !== null && q.order !== '' ? Number(q.order) : null,
  };
}

/** A new quest doc. */
export function newQuest({ id, title = '', type = 'side', parent = null, by = '', now = new Date().toISOString() } = {}) {
  return normalizeQuest({
    id, title: str(title).trim() || 'Untitled quest', type, status: 'active', parent, characters: [], objectives: [],
    description: '', rewards: '', image: null, created: now, updated: now, createdBy: by || '',
  }, id);
}

/** Objectives done / total. */
export function progress(q) {
  const list = q?.objectives || [];
  return { done: list.filter((o) => o.done).length, total: list.length };
}

/** Does a quest pass the list filter? view: 'active' | 'done' | 'all'; q: words matched in any text of the quest. */
export function questPasses(quest, { view = 'active', q = '' } = {}) {
  if (view === 'active' && quest.status !== 'active') return false;
  if (view === 'done' && quest.status === 'active') return false;
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fold([quest.title, ...(quest.characters || []), ...(quest.objectives || []).map((o) => o.text), quest.description, quest.rewards].join(' '));
  return words.every((w) => hay.includes(w));
}

/** Story order inside a branch: manual order first (lower first), then oldest first, then title. */
export function byStory(a, b) {
  const oa = a.order ?? Infinity;
  const ob = b.order ?? Infinity;
  if (oa !== ob) return oa - ob;
  const ca = str(a.created);
  const cb = str(b.created);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return str(a.title).localeCompare(str(b.title), undefined, { sensitivity: 'base', numeric: true });
}

/**
 * The quest log: [{type, quests}] for main and side, and {type: 'minor', groups: [{parent, quests}]} where parent is
 * the main quest the minor quests lead to (null: not tied to a main quest, listed last). Branches without a quest
 * passing the filter are still returned, with empty lists. Active quests come before finished ones in each list.
 * filter.keep: the id of a quest listed whatever the filter (the open one).
 */
export function questLog(all, filter = {}) {
  const quests = (all || []).filter((x) => (filter.keep && x.id === filter.keep) || questPasses(x, filter));
  const order = (a, b) => ((b.status === 'active') - (a.status === 'active')) || byStory(a, b);
  const of = (type) => quests.filter((x) => x.type === type).sort(order);
  const mains = (all || []).filter((x) => x.type === 'main').sort(order);
  const mainIds = new Set(mains.map((m) => m.id));
  const groups = new Map();
  for (const m of of('minor')) {
    const key = m.parent && mainIds.has(m.parent) ? m.parent : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const minor = [...mains.filter((m) => groups.has(m.id)).map((m) => ({ parent: m, quests: groups.get(m.id) })),
    ...(groups.has('') ? [{ parent: null, quests: groups.get('') }] : [])];
  return [
    { type: 'main', quests: of('main') },
    { type: 'minor', groups: minor, quests: minor.flatMap((g) => g.quests) },
    { type: 'side', quests: of('side') },
  ];
}

/** The minor quests that lead to a main quest, in story order. */
export const stepsOf = (all, mainId) => (all || []).filter((x) => x.type === 'minor' && x.parent === mainId).sort(byStory);

/** Count per list filter, for the Active / Finished / All switch. */
export function viewCounts(all) {
  const list = all || [];
  return { active: list.filter((x) => x.status === 'active').length, done: list.filter((x) => x.status !== 'active').length, all: list.length };
}

/** Find a quest by id or title (case- and accent-insensitive), for [[quest:…]] links. */
export function findQuest(all, target) {
  const t = fold(target);
  if (!t) return null;
  return (all || []).find((x) => x.id === target) || (all || []).find((x) => fold(x.title) === t) || null;
}
