// Roster: grid of character cards (essential stats) that open into the full sheet.
import { h, mount } from '../../core/dom.js';
import { icon, select } from '../../core/ui.js';
import { href } from '../../core/router.js';
import { store } from '../../core/store.js';
import { nameKey } from '../../core/util.js';
import { VIEW, ABILITIES, listCharacters, listTrash, pathOf, totalLevel } from './data.js';
import { derive, entryName, pendingChoices } from './bridge.js';
import { portrait, hpBar, fmt } from './widgets.js';
import { TRASH_ROUTE } from './trash.js';
import { levelsDue } from './xp.js';

const state = { q: '', sort: 'name' };

const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'player', label: 'Player' },
  { value: 'level', label: 'Level' },
  { value: 'updated', label: 'Recently updated' },
];

function sorted(list) {
  const by = {
    name: (a, b) => a.char.name.localeCompare(b.char.name, undefined, { sensitivity: 'base' }),
    player: (a, b) => (a.char.player || '~').localeCompare(b.char.player || '~', undefined, { sensitivity: 'base' }) || by.name(a, b),
    level: (a, b) => b.sheet.totalLevel - a.sheet.totalLevel || by.name(a, b),
    updated: (a, b) => String(b.char.updated || '').localeCompare(String(a.char.updated || '')),
  };
  return [...list].sort(by[state.sort] || by.name);
}

export function renderRoster(root) {
  const all = listCharacters().map((char) => ({ char, sheet: derive(char) }));
  const trashed = listTrash().length;
  const term = nameKey(state.q);
  const shown = sorted(all.filter(({ char }) => !term || nameKey(`${char.name} ${char.player}`).includes(term)));
  const search = h('label', { class: 'search' }, icon('search'),
    h('input', {
      class: 'input', type: 'search', placeholder: 'Filter by name or player', value: state.q, 'aria-label': 'Filter characters', 'data-fk': 'roster-q',
      oninput: (e) => { state.q = e.target.value; const pos = e.target.selectionStart; renderRoster(root); const el = root.querySelector('[data-fk="roster-q"]'); el?.focus(); el?.setSelectionRange(pos, pos); },
    }));
  mount(root,
    h('header', { class: 'view-head ch-roster-head' },
      h('h1', { class: 'view-title' }, 'Characters'),
      h('p', { class: 'view-sub' }, all.length ? `${all.length} sheet${all.length === 1 ? '' : 's'} in the party ledger. Open one to play, level up or edit.` : 'The party ledger is empty.'),
      h('div', { class: 'view-actions' },
        h('a', { class: 'btn btn-ghost', href: href(VIEW, TRASH_ROUTE), title: 'Deleted sheets wait here until the folder is emptied' },
          icon('trash'), 'Recently deleted', trashed ? h('span', { class: 'badge' }, String(trashed)) : null),
        h('a', { class: 'btn btn-primary', href: href(VIEW, 'new') }, icon('plus'), 'New character'))),
    all.length ? h('div', { class: 'toolbar ch-roster-tools' },
      search,
      h('label', { class: 'row row-nowrap ch-sort' }, h('span', { class: 'muted ui text-sm' }, 'Sort'),
        select(SORTS, state.sort, (v) => { state.sort = v; renderRoster(root); }, { 'aria-label': 'Sort characters' }))) : null,
    all.length
      ? h('div', { class: 'grid ch-grid' }, shown.length ? shown.map(card) : h('div', { class: 'empty-state' }, h('p', null, `No character matches “${state.q}”.`)))
      : h('div', { class: 'empty-state ch-empty' },
        icon('characters'),
        h('h3', null, 'No characters yet'),
        h('p', null, 'Create a sheet at any level: pick a class, species and background, assign scores and choose features. Everything stays editable afterwards.'),
        h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: href(VIEW, 'new') }, icon('plus'), 'Create the first character'))));
}

function card({ char, sheet }) {
  const max = sheet.hpMax;
  const cur = char.hp.current == null ? max : Number(char.hp.current);
  const temp = Number(char.hp.temp) || 0;
  const line = [char.species.id ? entryName('species', char.species.id) : null, sheet.classLine || 'No class yet'].filter(Boolean).join(' · ');
  let pending = 0;
  try { pending = pendingChoices(char, sheet).length; } catch { pending = 0; }
  let due = 0;
  try { due = levelsDue(char); } catch { due = 0; }
  const dirty = store.isDirty(pathOf(char.id));
  return h('a', { class: 'card ch-card', href: href(VIEW, char.id), 'aria-label': `${char.name || 'Unnamed'}, ${line}` },
    h('div', { class: 'ch-card-top' },
      portrait(char, { size: 'sm' }),
      h('div', { class: 'ch-card-id' },
        h('h3', { class: 'card-title ch-card-name' }, char.name || 'Unnamed'),
        h('p', { class: 'card-sub' }, [char.player ? `Played by ${char.player}` : 'No player', totalLevel(char) ? `Level ${sheet.totalLevel}` : null].filter(Boolean).join(' · ')),
        h('p', { class: 'ch-card-line' }, line))),
    h('div', { class: 'ch-card-hp' },
      h('div', { class: 'row row-between ui text-sm' },
        h('span', { class: 'ch-card-hp-label' }, icon('heart'), 'HP'),
        h('span', { class: 'num' }, h('strong', null, String(cur)), ` / ${max}`, temp ? h('span', { class: 'ch-temp' }, ` +${temp} temp`) : null)),
      hpBar(cur, max, temp)),
    h('dl', { class: 'ch-card-stats' },
      stat('AC', sheet.ac.value), stat('Init', fmt(sheet.initiative)), stat('Speed', `${sheet.speed.walk ?? 30}`), stat('Passive', sheet.passive.perception)),
    h('div', { class: 'ch-card-abil', 'aria-label': 'Ability modifiers' }, ABILITIES.map((a) => h('span', { class: 'ch-card-ab', title: `${a.full} ${sheet.abilities[a.id].score}` },
      h('span', { class: 'ch-card-ab-name' }, a.name), h('span', { class: 'num' }, fmt(sheet.abilities[a.id].mod))))),
    pending || due || dirty || char.conditions.length ? h('div', { class: 'ch-card-foot row' },
      due ? h('span', { class: 'badge badge-ok', title: 'Enough XP for a new level' }, due > 1 ? `Level up · ${due} due` : 'Level up due') : null,
      pending ? h('span', { class: 'badge badge-warn' }, `${pending} choice${pending === 1 ? '' : 's'} pending`) : null,
      char.conditions.length ? h('span', { class: 'badge badge-danger' }, char.conditions.map((c) => entryName('condition', c)).join(', ')) : null,
      dirty ? h('span', { class: 'badge', title: 'Edited on this device; press Save to share' }, 'Unsaved') : null) : null);
}

function stat(label, value) {
  return h('div', { class: 'ch-card-stat' }, h('dt', null, label), h('dd', { class: 'num' }, String(value)));
}
