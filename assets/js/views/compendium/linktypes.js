// [[weapon:Longsword]], [[item:Bag of Holding]], [[spell:Fire Bolt]] … link types for every compendium kind.
// Registered at import; compendium.preloadAll() makes cached(kind) available for sync resolution.
import { registerLinkType, matchNames } from '../../core/links.js';
import { cached, preloadAll } from '../../core/compendium.js';
import { href } from '../../core/router.js';
import { nameKey } from '../../core/util.js';
import { LINK_KINDS, linkPrefix, kindOne, statLine } from './meta.js';
import { embedMarkdown } from './render.js';

preloadAll().catch((e) => console.warn('[compendium] preload failed', e));

// Per-kind lookup index, rebuilt whenever compendium re-merges a kind (cached() returns a new array).
const indexes = new WeakMap();
function lookup(kind) {
  const list = cached(kind);
  let ix = indexes.get(list);
  if (!ix) {
    ix = { byId: new Map(), byName: new Map() };
    for (const e of list) {
      ix.byId.set(String(e.id).toLowerCase(), e);
      const k = nameKey(e.name);
      if (k && !ix.byName.has(k)) ix.byName.set(k, e);
    }
    indexes.set(list, ix);
  }
  return ix;
}

/** Find an entry by id or (case/diacritic-insensitive) name. */
export function findEntry(kind, target) {
  const t = String(target ?? '').trim();
  if (!t) return null;
  const ix = lookup(kind);
  return ix.byId.get(t.toLowerCase()) || ix.byName.get(nameKey(t)) || null;
}

const ORDER = { weapon: 50, armor: 51, gear: 52, 'magic-item': 53, spell: 54, feat: 55, ability: 56, species: 57, class: 58, subclass: 59, background: 60 };

for (const kind of LINK_KINDS) {
  registerLinkType(linkPrefix(kind), {
    label: kindOne(kind),
    order: ORDER[kind] || 70,
    resolve(target) {
      const e = findEntry(kind, target);
      if (!e) return null;
      const line = statLine(e);
      return { href: href('compendium', kind, e.id), title: `${e.name} · ${line || kindOne(kind)}`, exists: true };
    },
    suggest(q) {
      return matchNames(cached(kind), q, (e) => e.name, 8).map((e) => ({
        label: e.name,
        value: /[[\]|#]/.test(e.name) ? `${e.id}|${e.name.replace(/[[\]|#]/g, '')}` : e.name,
      }));
    },
    embed(target) {
      const e = findEntry(kind, target);
      return e ? { markdown: embedMarkdown(e) } : null;
    },
  });
}
