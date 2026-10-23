# Quests model

The Quests tab (`assets/js/views/quests/`) is a video-game style quest log: the **quest log** on the left, the
**open quest** on the right (one pane at a time below 760px of width).

## Files

- `content/quests/<id>.json` — one quest per file (id = `util.uid(title)`).
- `content/media/quests/<file>` — uploaded quest images (scaled down like journal photos, `journal/gallery.js`
  `prepareImage`). A quest may also use any image already in `content/` or an https URL.

```json
{
  "id": "the-fallen-firmament-k3x9",
  "title": "The Fallen Firmament",
  "type": "main",               // main | minor | side
  "status": "active",           // active | completed | failed
  "parent": null,               // minor quests: id of the main quest they lead to
  "characters": ["char:Brakka Stonehelm", "note:Archmage Velin", "Old Grim"],   // link bodies or plain names (below)
  "objectives": [{ "id": "o1", "text": "Find the crater", "done": false }],
  "description": "Markdown, [[links]] work.",
  "rewards": "Markdown",
  "image": "content/media/quests/the-fallen-firmament-k3x9-vale-ab12.jpg",   // shown only when the quest is open
  "order": null,                // optional manual order inside its branch (lower first)
  "created": "…", "updated": "…", "createdBy": "Player name"
}
```

`model.js` `normalizeQuest` fills defaults and sanitises on read (unknown type -> side, unknown status -> active,
`parent` only on minor quests, tags trimmed and de-duplicated, objectives get ids, images only from `content/` or
https). Unknown fields are kept.

## The log

- Branches in this order: **Main quests** (crown, gold), **Minor quests** (waypoint diamond, lapis) grouped under the
  main quest they lead to ("leads to …"; unlinked ones last), **Side quests** (reward chest, verdigris).
- Inside a branch: active before finished, then `order`, then oldest first (story order).
- Active / Finished (completed or failed) / All, and a search over title, characters, objectives, description and
  rewards. The open quest always stays listed. Branches fold; the filter and folds are remembered per device
  (`sw:quests:ui`).

## The open quest

Type and status, Complete / Failed / Reopen, Edit; the image (click for full size); relevant characters; objectives
with a progress bar (tick them off right there); description; rewards; for a main quest, its minor quests and "Add a
minor quest". Edit (`#/quests/<id>/edit`) changes everything in place.

## Links (views/quests/people.js)

- **Relevant characters** are chips that open what they name. An entry is either a link body picked from the
  suggestions (`char:Mira` a party member's sheet, `note:Old Grim` a journal note, `map:Old Mill`, `doc:…`, `quest:…`,
  compendium kinds) or a plain name, which opens a party member's sheet of that name, else any page of that exact name
  (an NPC note first), else "start a note" for it (dashed chip), like an unresolved `[[link]]`.
- **NPC notes** are journal notes tagged `#npc` (or `#npc/…`) or kept in a folder whose name has npc, people, cast or
  characters in it. They get a person icon and come right after the party members in the suggestions.
- **Suggestions** while typing a character: party members, NPC notes, other notes, then any other page; `map:`,
  `doc:`, `quest:`… narrow to one kind. Enter or a click picks the highlighted one; Enter with no suggestion (or a
  comma) keeps the typed name.
- **Objectives, description, rewards** are markdown: `[[links]]` work, with the `[[` autocomplete in all three.

Saving: creating, deleting, completing / failing / reopening and image changes commit right away (`saveSoon`);
typing and ticking objectives follow the auto-save timer. Links: `[[quest:Title]]` (id or title).
