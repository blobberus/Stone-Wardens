// Linked places: the same place on two or more maps (a city on the main map and again on a region map). Each keeps
// its own map, position, rank and the map it opens; name, type, description and tags are shared. Every member's
// document holds the shared fields itself, plus `same` (the group's random id, never derived from a name: a hidden
// member must not leak through a visible one) and `sharedAt` (when the shared fields last changed). Readers take them
// from the member changed last that they can read, so one that couldn't be written (hidden from whoever edited)
// catches up, and a visible member still reads right for players while another is hidden. Pure (node
// tools/test_twins.mjs); data.js does the reading (index) and writing (saveLocation).

export const SHARED = ['name', 'type', 'description', 'tags'];

/** The shared fields of a place (tags copied). */
export const sharedOf = (l) => ({ name: l?.name, type: l?.type, description: l?.description, tags: [...(l?.tags || [])] });

/** Do a and b differ in a shared field? */
export const sharedDiffer = (a, b) => SHARED.some((k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null));

const stamp = (l) => String(l.sharedAt || l.updated || l.created || '');

/**
 * linkTwins(list) -> Map(group -> [members]) of the groups with two or more members. Each member gets the shared
 * fields of the one changed last (sharedAt, else updated, else created; a tie keeps the first in the list) and
 * `twins` (the other members' ids); every other place gets twins []. Mutates the objects in list.
 */
export function linkTwins(list) {
  const groups = new Map();
  for (const l of list) {
    l.twins = [];
    if (!l.same) continue;
    if (!groups.has(l.same)) groups.set(l.same, []);
    groups.get(l.same).push(l);
  }
  for (const [g, members] of groups) {
    if (members.length < 2) { groups.delete(g); continue; }
    const src = members.reduce((a, b) => (stamp(b) > stamp(a) ? b : a));
    const shared = sharedOf(src);
    for (const m of members) {
      Object.assign(m, shared, { tags: [...shared.tags] });
      m.twins = members.filter((o) => o !== m).map((o) => o.id);
    }
  }
  return groups;
}
