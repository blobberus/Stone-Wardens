# DM mode

The DM logs in with a separate **DM password** (Settings → **DM mode** → "Log in as the DM"). While DM mode is on, the DM can
create and edit things **hidden from the players**, see them in place (with a gold lock), and **release** them when the
story gets there. Players get a notification in their **Inbox** for each release.

## Why it is encrypted

The repository is public and every player's browser holds the same GitHub token, so anything written in the clear is
readable by anyone who looks. Hidden items are therefore **encrypted** (AES-256-GCM) with a key that only the DM
password unlocks. Players' browsers only ever see ciphertext; so does anyone reading the repo on GitHub.

- The password is never stored or sent anywhere. PBKDF2-SHA256 (600 000 iterations, random salt) turns it into a key
  that unwraps a random 256-bit **data key** (`content/dm/vault.json`); the data key encrypts every hidden item.
  Changing the password re-wraps the same data key.
- The hidden items are only as safe as the password: anyone can copy the vault and try to guess it offline. Use a long
  passphrase of several words, not one word.
- The password can't be recovered. Without it, hidden items can't be opened (they are not lost from the repo, just
  unreadable).
- Hiding an item that was already public deletes its plain file, but **earlier versions stay in the git history** on
  GitHub. Only things created hidden were never public.
- In DM mode commit messages say only "update (N files)", since reasons like "new quest “The Traitor”" would leak.

## Files

| Path | What |
|---|---|
| `content/dm/vault.json` | the wrapped data key (created the first time someone sets up DM mode) |
| `content/dm/hidden/<random>.json` | one sealed envelope per hidden item: `{path, text or bin, size, mime, sha, hiddenAt, by, with?}` (`with`: the companions hidden along with it) |
| `content/dm/hidden/<random>.bin` | a hidden binary (library document, image): 12-byte IV + ciphertext |
| `content/dm/released.json` | the released log `{items: [{path, title, label, href, at, by}]}` (plain: those items are public) |
| `content/inbox/<stamp>.json` | one notification per release `{id, at, title, label, href, path, by}`; pruned after 30 days |
| `content/dm/party.json` | the party view's notes and who it leaves out, sealed `{v, iv, data}` (never listed or released; docs/dm-party.md) |

Envelope file names are random, so they say nothing about the item; its real path is inside the envelope.

## How it works (`core/dm.js`, `core/dm-crypto.js`, `core/dm-ui.js`, `views/dm`)

- **Layer.** While DM mode is unlocked, `store.layer` shows every hidden item at its own path: `store.get / has / list
  / files / text / fileBlob / fileUrl` include it, so each tab lists it where it was made. `store.put / remove /
  putBinary` on a hidden path go to the layer, which re-encrypts the envelope a moment later instead of writing the
  plain file. Players (or the DM with DM mode locked) never see the layer.
- **Creating hidden.** Tabs pass `{hidden: true}` to `store.put` / `store.putBinary` (`compendium.saveCustom(kind,
  obj, {hidden})`). Create forms show `hiddenChoice(state)` ("Hidden from players" / "Visible to players"), which
  starts at the DM's default (`dmNewHidden()`, switch "New: hidden" under the DM button and on the DM Screen). A new
  copy of a hidden item (a move or rename: same text, or same bytes) stays hidden automatically.
- **Per item.** `visibilityToggle(path)` is the noticeable switch on an item's page or editor: hiding seals it at
  once (`hideItem`), making it visible releases it (`releaseItem`) after a confirmation. `hiddenMark(path)` is the
  small gold lock in lists.
- **Release** writes the plain file back to its path, plus the hidden files it names (a quest's image, a note's
  photos), removes the envelope, adds it to the released log and posts a notification. **Hide again** (DM Screen,
  Released) or "Hide an existing item…" seals a public item; its uploaded images go with it unless another visible
  document names them.
- **Tabs** register what they can hide: `registerHideable({prefix, label, icon, order, accept(path), describe(path,
  data) -> {title, href}, companions?(path), releaseBlock?(path, data), releaseAs?(path, data), afterHide?(path),
  afterRelease?(path)})` (quests, compendium library items, journal notes, Warden's Library documents, map places, the
  main map, sub-maps, map pictures; `content/media/` images ride along with their item). `companions(path)` lists items
  hidden together with it (a map: its image and background image, fog, pictures, places and sub-maps); they are
  recorded in the envelope (`with`) and released with it, while anything that was already hidden on its own stays
  hidden. Companions added hidden later (a place made on a hidden map, its fog) are released with it too
  (hidden after it). Hiding is all or nothing: if one companion fails, the others go back and the DM sees the error;
  an item being hidden or released can't be switched again until that finishes (`dmBusy`). `releaseBlock` returns why an item can't be released alone (a place on
  a hidden map would show up on the main map), and Release says so. `releaseAs` returns `{title, question, okLabel,
  data}` when an item can only be released in another form (a map inside a hidden map: as a map of its own, `parent:
  null`): `releasePlan(path)` tells the UI, which asks that question instead of the usual one, and `releaseItem(path,
  {as: true})` writes `data` as the public document. `afterHide` / `afterRelease` run once it is done (the main map's
  public marker). Both the switch and the DM Screen's Release go through `askRelease(path)` (dm-ui.js). `accept` also limits the safety net: journal folder metadata
  (`_chapter.json`) and library READMEs are never hidden. Tabs redraw their switches and marks on `onDmMode(fn)`
  (DM mode turned on or off).
- **Saving** seals pending edits first (`store.save` waits for `layer.flush()`), and `store.isDirty()` counts them, so
  the unsaved-changes warning covers them too.

## Where the switch is

| Tab | Create (starts at the DM's default) | On the item | Lock mark |
|---|---|---|---|
| Quests | New quest dialog | quest page and editor | quest log |
| Compendium | new entry / custom copy editor | entry page actions (Status: "Hidden from the players") | lists, search, recent |
| Journal | New note dialog (quick "+" notes follow the default) | under the note's title | file tree |
| Warden's Library | Add documents dialog | reader actions | shelf cards and table |
| Map | New location panel, Add a sub-map (DM Screen: New map), Duplicate this map (map pictures follow "New: hidden") | place panel, under the badges; any map under its name plate, the main map too (with everything on it); a picture in Edit map → Pictures | pin with a dashed gold edge; lock beside a map's name (plate, Maps list, the main map too); dashed gold outline on a picture |

The DM Screen's Create buttons open those forms (`#/quests?new=1`, `#/map?new=1` = the new-map dialog over the main
map, `#/compendium?new=1`, `#/journal/new`, `#/wardens-library?upload=1`). A new hidden map is released with the
switch under its name plate or from Hidden from players (its places, pictures, fog and sub-maps come along).

**Hiding the main map.** The switch under the main map's name plate (or "Hide an existing item…", or Hide again in
Released) asks first, then hides it with its image, fog, pictures, places and every map inside it, each with what is
on it; maps of their own (`parent: null`, docs/map-model.md) stay visible. A public marker `content/map/hidden.json`
(`{hidden: true}`, nothing else) is written with it and removed on release, so players' devices know the main map is
hidden: their Map tab opens the first visible map of its own, or says "The DM hasn't revealed the map yet." when there
is none (a fresh site without the marker still shows the placeholder map). Releasing the main map brings back what was
hidden with it (and what was added to it while hidden), not what the DM had hidden on its own before. A map inside a
still-hidden map (the main map or any other) can be released first: Release asks "Release it as a map of its own, not
linked to that map?" and the players get it with `parent: null`, with its places, pictures, fog and sub-maps. A place,
picture or fog of a hidden map still can't be released alone.

Visibility follows the item: a hidden quest's or note's uploaded photos are hidden too (a visible one's are visible),
and renaming or moving a note, a folder of notes or a library document keeps each file hidden or visible as it was.
Whatever is added to a hidden map (a place, a picture, its fog, a new image, a sub-map) starts hidden, and a place
moved onto a hidden map is hidden; a copy of a hidden map starts hidden unless the DM switches it to visible.

## DM Screen, Inbox, staying logged in

- **DM Screen** (sidebar, below the Inbox; the tab exists only in DM mode) has two pages under its tabs: **Hidden &
  released** (`#/dm`) and **Party** (`#/dm/party`: every character's hit points, AC, passive Perception, abilities,
  conditions and a private note, live; docs/dm-party.md). The menu's DM Screen link goes back to the page last shown.
  Hidden & released: Create shortcuts; **Hidden from players**
  (grouped by category, Release); **Released** (newest first, Hide again, × = off this list only). A released item is
  public again, so it is only in Released; hiding it again moves it back. × (`forgetReleased(path, {inbox})`) takes the
  entry out of `released.json` and leaves the item where it is, public; ticked (the default, shown when there is one)
  its Inbox notification goes too (`notificationsOf(path)`). An item deleted since can only be taken off the list. Both lists have category chips (All, Quests, Compendium entries,
  Journal notes, Library documents, Map places, Images, with counts) to show one kind at a time.
- **Inbox** (navigation): notifications of the last 14 days, unread badge; read state per device (`sw:inbox`), "Mark
  all read".
- DM mode stays on in the browser tab (sessionStorage) or, with "Keep DM mode on this device", on the device
  (localStorage) until **Lock DM mode** (DM Screen) or "Lock the site on this device" (Settings).
