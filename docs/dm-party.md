# The party view (DM Screen → Party)

`#/dm/party`, the second tab of the DM Screen (DM mode only). Every character on one screen, made to sit in a pane of
the DM Screen website (blobberus/DMscreen) as well as in a browser tab:

- **Hit points** (bar, current / max, temporary), or at 0 the death saves (Down / Stable / Dead).
- **AC** (with a shield) and **passive Perception**; a number a debuff changed is red and says why on hover.
- The **six abilities**: modifier and score.
- **Conditions and effects**: each condition (its rules text on hover), Exhaustion level, Heroic Inspiration. Up to
  four chips, then "+N".
- A **private note** per character: one line shows its first line ("Add a note" when empty); click to open it over
  the card's lower half, Escape or the arrow closes it.
- **Clicking a card** opens the character's sheet. The menu's DM Screen link then leads back to the party.
- **Characters** (top right) chooses who is shown (new characters show up by themselves). **Copy link** copies the
  address of this view, to paste into a DM Screen pane.

## Fitting the space (`views/dm/party-model.js` `fitGrid`)

A card is designed at 300 × 236 px (tall: stats stacked) or 560 × 150 px (wide: abilities beside the hit points).
For n cards and the view's size, every column count is tried with both shapes; the one whose cards come out
largest wins (fewer empty cells on a tie), and everything inside the card scales with it (`--pc-s`, em units,
0.78 to 1.7). Six cards fit 3 × 2 in a quarter of a 1080p screen (about 930 × 470) and 2 × 3 in a tall pane; a row
of five or six fits a short, wide strip. When they would get smaller than 0.78 (phones, very many characters), the
cards scroll at full size instead.

## Live updates (`core/live.js`)

Players' sheets are committed at most every 15 s while someone edits (every player shares one GitHub token, good for
a few hundred commits an hour), so the repo alone can't be fast. On top of it:

1. **Live channel.** Every local write of a character sheet is also published at once (120 ms after the last write;
   the sheet already waits 300 ms after typing) through the public MQTT brokers Combat Ring uses
   (`wss://broker.hivemq.com:8884/mqtt`, `wss://broker.emqx.io:8084/mqtt`), as a retained message per sheet:
   `sw1/<room>/o/<encoded path>`. The room id and AES-GCM key come from the GitHub token (HKDF-SHA256, salt
   `stone-wardens/v1`), so only people with the site password can read a message and nobody else can forge one; the
   payload is gzip'd (`[1 | 0 flag] + JSON {k, t: [ms, clientId], by, d: {path, updated, data}}`, then sealed).
   Every client publishes (only while a DM is set up); only a watching screen (the party view, from its first
   visit until DM mode is locked) subscribes, and gets each sheet's latest copy at once from the retained messages.
2. **The newer copy wins.** `characters/data.js` (`listCharacters`, `getCharacter`) shows a live copy instead of the
   stored doc when its `updated` stamp is newer, so the party view, the sheets and the roster in the DM's browser
   all follow it. A live copy is a hint, never written to the repo: when the commit arrives its doc is the same
   (same `updated`), and a live copy of a deleted sheet is ignored. Own messages are dropped (the store has them).
3. **GitHub as the fallback.** While the party view shows, it asks GitHub whether the branch moved
   (`store.pullIfChanged` → `GitHubBackend.headChanged`: a conditional GET of the ref with `If-None-Match`; GitHub's
   304 "not modified" answer doesn't count against the rate limit) every 5 s, or every 20 s while the live channel is
   up, and pulls at most every 12 s.

The status beside the Characters button: **Live** (a change shows within about a second; measured 155 ms between two
tabs), **Connecting…**, or **Live updates off** (the brokers can't be reached: changes show once a sheet is saved,
about 15 s). Sandbox mode (`?sandbox`) uses a BroadcastChannel between tabs instead of the brokers.

## Notes (`content/dm/party.json`)

`{v: 1, notes: {charId: text}, omit: [charId]}` (`omit`: characters left out of the view), sealed with the DM data
key (`dm.js` `writeSealed` / `readSealed`, the same AES-GCM as hidden items) at a fixed path under `content/dm/`,
outside the hidden layer: it is never listed on the DM Screen and never released. Typing saves 0.6 s after the last
key; it commits like any small edit. Another device of the DM picks it up on its next pull.

## In a DM Screen pane

The DM Screen website and this site are both on `blobberus.github.io`, so a pane shares this browser's login and DM
mode ("Keep DM mode on this device" keeps it across restarts). Paste the copied link
(`https://blobberus.github.io/Stone-Wardens/#/dm/party`) into the Stone Wardens pane's address bar, or set it as
that pane's address in the DM Screen's Settings → Campaign sites.

Tests: `node tools/test_party.mjs` (cards on engine-derived sheets, grid fitting, the notes doc, the live message
format and its crypto).
