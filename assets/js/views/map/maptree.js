// Which map each map sits inside (pure, no imports; node tools/test_maptree.mjs). docs/map-model.md.
// A sub-map document's `parent` is the id of the map it sits inside, or "main". Absent, empty, unknown, itself or part
// of a loop = the main map (so old documents keep working). `parent: null`, written out, = a map of its own: not
// linked to the main map, listed at the top level beside it, with no main-map link in its breadcrumb.
export const MAIN = 'main';

/** The parent a document asks for: null (a map of its own), 'main', or a map id. */
export function wantedParent(v) {
  if (v === null) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  return s || MAIN;
}

const byIdOrder = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Resolve every sub-map's parent. subs: [{id, parent (as written in its document)}]. mainShown: false while the main
 * map is hidden from this viewer (DM mode): a visible map that would sit inside it shows as a map of its own instead of
 * vanishing. -> Map(id -> 'main' | null | id), loop-free.
 */
export function resolveParents(subs, { mainShown = true } = {}) {
  const list = [...subs].sort(byIdOrder); // the same loop breaks the same way on every device
  const ids = new Set(list.map((m) => m.id));
  const parent = new Map();
  for (const m of list) {
    let p = wantedParent(m.parent);
    if (p !== null && p !== MAIN && (!ids.has(p) || p === m.id)) p = MAIN;
    parent.set(m.id, p);
  }
  for (const m of list) { // a loop: the first of its maps (by id) moves into the main map
    const seen = new Set();
    for (let p = parent.get(m.id); p && p !== MAIN; p = parent.get(p)) {
      if (p === m.id) { parent.set(m.id, MAIN); break; }
      if (seen.has(p)) break; // a loop further up, without this map: one of its own maps breaks it
      seen.add(p);
    }
  }
  if (!mainShown) for (const [id, p] of parent) if (p === MAIN) parent.set(id, null);
  return parent;
}

/**
 * The map hierarchy. subs: sub-map objects ({id, parent, name, …}; parent as written). compare sorts siblings (by
 * name). -> {parent: Map(id -> resolved parent), kids: Map(parent id | null -> [sub]), order: [{id, depth}]}: the
 * main map (unless hidden from this viewer) and its tree first, then the maps of their own, each followed by its tree.
 */
export function mapTree(subs, { mainShown = true, compare = byIdOrder } = {}) {
  const parent = resolveParents(subs, { mainShown });
  const kids = new Map();
  for (const m of subs) {
    const p = parent.get(m.id);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(m);
  }
  for (const l of kids.values()) l.sort(compare);
  const order = [];
  const walk = (id, depth) => { for (const c of kids.get(id) || []) { order.push({ id: c.id, depth }); walk(c.id, depth + 1); } };
  if (mainShown) { order.push({ id: MAIN, depth: 0 }); walk(MAIN, 1); }
  walk(null, 0);
  return { parent, kids, order };
}

/** Ids of every map below id (resolved parents), not including id. */
export function descendantsOf(parent, id) {
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [m, p] of parent) if (!out.has(m) && m !== id && (p === id || out.has(p))) { out.add(m); grew = true; }
  }
  return out;
}

/** Can map id move into target (a map id, 'main', or null = a map of its own) without making a loop? */
export function canMoveInto(parent, id, target) {
  if (id === MAIN) return false; // the main map sits inside nothing
  if (target === null || target === MAIN) return true;
  if (target === id || !parent.has(target)) return false;
  return !descendantsOf(parent, id).has(target);
}
