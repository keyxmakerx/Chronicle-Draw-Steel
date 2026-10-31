# Widget Guide

Ten widgets are registered in `manifest.json`. Placement:

| Placed by | Widgets |
|---|---|
| Handbook chapters (`book/chapters/*.yaml`) | Class Fights, Negotiation Audience, Handbook Credits, Rulebook Front Page (Lich's Lair) |
| Chronicle (`entity_panels`) | Statblock Renderer, Negotiation Tracker |
| Chronicle (encounter builder event) | Encounter Budget |
| The layout customizer | Monster Builder, Bestiary Browser |
| Documented in `docs/CHARACTER-SHEET-DESIGN.md` | Character Sheet |

Shared utility modules are at the end.

To place one: open an entity page or campaign dashboard, click the layout
customizer, drag a widget from **Extensions > Draw Steel** into the layout,
and set it in the widget settings panel.

## Monster Builder

**Slug:** `monster-builder`

The one-page creature editor: identity, figures, characteristics, traits,
abilities and villain actions on the left; the party, the encounter budget and
the completeness checks on the right.

- **Generate one** builds a creature from the ability library and the published formulas.
- **Build with an AI** copies a guide for any AI chat and reads the answer
  back, keeping its words and replacing its numbers with the formulas'. The
  guide offers up to 50 Monsters-book abilities, picked with filters, for the
  AI to choose by id.
- **or from a creature…** copies one from the community bestiary or this
  campaign, recomputed for its level.

Most directors reach it through **Edit stat block** on a Creature or NPC page
rather than placing it.

**What the numbers are.** Encounter value, Stamina, free strike, formula
ability damage and the highest characteristic come from
`data/monster-building.json`; the encounter readout uses the bands in
`data/encounter-building.json`. Where the published rules do not cover an
input (the Swarm organization is this package's own; the Stamina formula needs
a role) the box is left for the director and says so. A number the director
types is never overwritten. The panel checks that a stat block is complete; it
does not certify balance and does not check the published spending limits
(creatures per hero, the six-stat-block cap, minions in fours,
star-of-the-show). Details: `docs/monster-builder.md`.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `entity_id` | string | — | Creature page to edit (auto-set on an entity page) |
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Usage
On a Creature page whose stat block panel is showing, the placed widget steps
aside and points at **Edit stat block**. Placed elsewhere (or with no
`entity_id`), it builds a new creature, and Save creates its page.

---

## Bestiary Browser

**Slug:** `bestiary-browser` (shown as **Bestiary**)

The creature viewer: this campaign's Creature pages and the Monsters book's
stat blocks (`data/monsters.json`) in one list. A row opens its stat block in
place; organizations, roles, abilities and rules terms show hover cards; each
power roll has a roll button.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `layout` | string | `"full"` | `"full"` for a Bestiary page, `"compact"` for a block on any page |
| `source` | string | `"all"` | Starting source: `"all"`, `"campaign"` or `"book"` |
| `creatures` | string | `""` | Only these creatures, by page name or book id, comma separated |
| `title` | string | `"Creatures here"` | Heading of a compact block |

Chronicle sets the campaign, and `editable` for Scribes and above.

### Features
- **Search** by name, keyword, book chapter or ability name
- **Filters**: level range, organization, role and source; picking an
  organization or role explains it from the package's templates, and **What
  do these mean?** explains them all
- **Sort** by name, level or EV, either way
- **Rows that open in place** with the full stat block; a minion's EV says it
  buys four
- **Roll buttons**: 2d10 plus the bonus, the tier picked by the power-roll
  rule (a natural 19 or 20 is always tier 3), shown in a toast and the last
  five in the tray's log
- **Hover cards** for creatures, abilities, organizations, roles and rules
  terms; click a term to pin its card, and **Pin card** keeps up to eight in
  the tray
- **Add to campaign** (Scribes and above, full layout) makes a Creature page
  from a book stat block with every field filled, and remembers the book entry
  for Compare with the book; **+ New creature** opens
  the editor

### Usage
The full layout belongs on a dedicated "Bestiary" page. The compact layout is
for a session or location page: set `creatures` to the ones that appear there.
It has no filters, no tray and no Add, only each creature's page link.

---

## Statblock Renderer

**Slug:** `statblock-renderer`

The creature stat block, mounted by Chronicle under the title of Creature and
NPC pages (`entity_panels` in `manifest.json`). It shows header and EV, the Size / Speed
/ Stamina / Stability / Free strike strip, characteristics, immunities and
weaknesses, traits, abilities with tier odds, and villain actions. EV, Stamina
and free strike carry a tick when they match the published formula and a pen
when the director changed them. The director also gets **Edit stat block** and
**Publish** (to the Community Bestiary); the editor grows out of the stat block
into a full-screen sheet on the page. On a page with no stat block yet, a
player sees nothing and the director sees one quiet **Build its stat block**
line.

On a page copied from the Monsters book, the director sees "Copied from the
Draw Steel book" with **Compare with the book**. It folds open a table of each
field that differs from the book entry (figures, keywords, movement, and each
trait, ability and villain action by position). **Use the book's** saves that
one field at once, **Use the book's for all** resets every difference, and
**Undo** puts back the last change. The entry is the page's `book_source`
field: director-only, and never sent to Foundry.

The stat block leads with the creature's picture: its art (the page's own
picture), else its token, else a generic monster token. The editor's
**Pictures** box sets both; they save with the stat block. The token is the
`token_image` field, a Chronicle media id like the page picture. Where
Chronicle has its token maker, the token slot also has **Make token…**, which
frames the art (or another picture) as a token; the new token is kept like an
upload until the stat block is saved.

In page-layout mode the panel appears only where the layout has the **Game
System Panels** block.

### Config Keys (set by Chronicle)

| Key | Type | Description |
|-----|------|-------------|
| `entity_id` | string | The page |
| `campaign_id` | string | Campaign context |
| `is_gm` | boolean | Shows the director's buttons |

Its global `DrawSteelStatblock` is the one stat block drawing the editor,
the bestiary's open rows and hover cards share.

## Negotiation Tracker

**Slug:** `negotiation-tracker` · **File:** `widgets/negotiation-tracker.js`

Runs a negotiation on an NPC page. Chronicle mounts it below the title of NPC
pages when this system is enabled (manifest `entity_panels`), so there is
nothing to place by hand.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `entity_id` | string | — | The NPC page (auto-set by Chronicle) |
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Features
- GM: starting attitude, Interest and Patience pips (click to set), Impression, motivations and pitfalls (mark found), the offer for the current interest, arguments applied with the published outcomes, a log, show/hide for players, Start over
- Players: a read-only card with the meters (only once the GM shows them) and the motivations and pitfalls the party has found
- All numbers come from `data/negotiation.json`
- State is saved on the NPC through Chronicle's system-state route (`.../system-state/drawsteel/negotiation`): a `gm` half and a `public` half. The widget re-derives `public` from `gm` on every save, and players only ever read `public`. An older Chronicle without that route shows players nothing and the GM one line.

---

## Class Fights

**Slug:** `class-fights` · **File:** `widgets/class-fights.js`

The Handbook's Classes chapter places it (`book/chapters/classes.yaml`, a
`type: widget` block). The page shows a tile per class and the chosen class's
Heroic Resource; each class opens a pop-up book with a practice fight whose
cut-paper pieces are buttons.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle); without it the widget says so and fetches nothing |

### Content Source
- `data/class-fights.json` (widget-only, not a reference category). The `power-roll`, `winded-and-dying` and `class-resource-<class>` entries are the published rules the fights follow: start and per-turn gains, triggers with their rate (`round`, `fight`, `each`) and amount, ability costs, the conduit's prayer, the shadow's edge discount, the talent's strain and the troubadour's death and return.
- The `example-fight-<class>` entries are `"source": "custom"`: the scene layout, foes, Stamina, damage and lines. Acts and pieces name triggers by `id` and pieces by `tag`; a class whose scene names something its rules lack is dropped, not played wrong.
- The drawings (`PIECE`, `HERO`, `FX`, `EMBLEM`) are in the widget. A class in the data with no drawing gets no tile.
- The pure rules (`ChronicleDrawSteelClassFights`) are tested by `tools/test-class-fights.mjs`; the mount and data route by `tools/test-class-fights-ui.mjs`.

---

## Negotiation Audience

**Slug:** `negotiation-audience` · **File:** `widgets/negotiation-audience.js`

The Handbook's Negotiation chapter places it (`book/chapters/negotiation.yaml`,
a `type: widget` block). A card on the page opens a cut-paper throne room where
the reader talks a king round: pick who speaks and what they say, roll, and
watch his interest and patience move.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Content Source
- Every number the scene moves (the neutral attitude, the argument and uncovering tables, the offers) is read from `data/negotiation.json`.
- The king, his court, the heroes and their lines are an example written for this package.
- The pure rules (`Audience`) are tested by `tools/test-negotiation-audience.mjs`; the mount by `tools/test-negotiation-audience-ui.mjs`.

---

## Handbook Credits

**Slug:** `handbook-credits` · **File:** `widgets/handbook-credits.js`

The Handbook's last chapter (`book/chapters/credits.yaml`). A cut-paper stage
where the nine classes, in plain white masks, take a bow; the MCDM team by
role; where to buy the books; the Creator License notice word for word; where
the rules come from; and who made this package. **Roll the credits** plays it
as film end titles over the whole window, with pause and fast forward.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Content Source
- Names and rule counts come from `data/credits.json` (the `mcdm-team` entries and the `rules-tally` entry). All art is drawn for this package; no MCDM art or logo appears.
- The pure helpers (`ChronicleDrawSteelCredits`) are tested by `tools/test-handbook-credits.mjs`.

---

## Encounter Budget

**Slug:** `encounter-budget` · **File:** `widgets/encounter-budget.js`

Chronicle loads it itself; there is nothing to place and it has no config.
Chronicle's encounter builder fires `chronicle:encounter-draft` after every
change, and the widget fills the slot that event carries with the party's
strength, the EV spent against the published difficulty bands, the guideline
checks and each initiative group's EV.

- Strength is the heroes' levels plus the published Victories adjustment: every 2 Victories the heroes average count as one more hero of the party's level. A hero page with no Victories counts as 0, and the panel names it when other heroes do have Victories. With 6 or more average Victories the level-limit check allows creatures 3 levels above the heroes (solos stay at 1).
- The director can count the party as up to two heroes stronger or weaker than the rules say. The adjustment is saved for the whole campaign in Chronicle's campaign-wide system state (`drawsteel/party`, director half, `{"extraHeroes": N}`), and a moved Strength always reads "Changed by you (the rules give N)". A Chronicle without that store answers 404, and the panel then follows the rules and says so.
- Every figure comes from `DrawSteelFormulas` (`widgets/monster-engine.js`) or `data/encounter-building.json`. A figure they cannot cover (a creature typed by name, a page with no EV, a hero with no level) is said to be missing and left out of the total.
- Like the monster builder's checks, it reports what the published guidelines say. It is not a balance check.
- Tested by `tools/test-encounter-budget.mjs`.

---

## Rulebook Front Page

**Slug:** `rulebook-frontpage`

The rulebook's single-screen "front page", which folds open three ways:

- **Hero Power Roll block** unfolds into a centred reading sheet (FLIP takeover, veil behind).
- **Five characteristic cards** each fold a hinged wing out over their neighbours (left-column cards wing right, right-column cards wing left).
- **Condition rows** each unfold a flap down over the rows beneath.
- **The Lich's Lair** card shows the scene's closed pop-up book. Opening it
  lifts the book onto the board's own closed book and shows a centred
  one-column board: a header (part title, replay, close), a chip per part, the
  part's pop-up book with caption and controls, and two drawers, **THE TABLE**
  (heroes + Stamina) and **RULES IN THIS PART**. Then the cover opens on the
  part named by the worked-scene's `openOn`. Closing reverses it. The column
  is the same at every width; at 560px and under it sits in a small inset.

Inside a Handbook page (How to Play, "Watch a game") the widget is only the
Lich's Lair as a closed pop-up book.

Also: cards deal in on load, `/` focuses search, non-matching cards fold
face-down, related chips hop across fold types, and close / `Esc` / tap-outside
folds back in priority order (flap, wing, reader). Under 640px wings open
downward across the full width of their block. `prefers-reduced-motion` is
honoured, and the breathing marks stop on Chronicle's `MotionRest` clock when
the viewer steps away (without `MotionRest` they keep looping).

**Staged examples:** the Might card's two example buttons, the reader's "Watch
the table play it" seam and the Lair's seven parts play worked scenes through
`RulebookExamplePlayer`. **Glossary hover cards:** dotted `.rb-hl` terms in
prose (authored as `{@category slug}`) show a quick card from
`rules-glossary.json` on hover, focus or tap, via the fold engine's `terms`
map.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Content Source

- **Hero / characteristics / worked-scene** copy: `data/rulebook-frontpage.json`
  (`properties.kind` = `hero` | `characteristic` | `conditions` | `worked-scene`).
  The worked-scene's `parts[]` (each `slug` + `play` script) are the board's
  chips in order; `openOn` is the part slug the board opens on (the first when absent).
- **Pop-up cards** quote `rules-glossary.json`, `creatures.json`,
  `role-templates.json` and the front page's own blocks; the last three are
  optional (a card then shows only what its script says).
- **Condition flap text** comes from `rules-glossary.json` entries with
  `properties.category === "condition"`, looked up by slug.

### Placement

The Handbook places it in `book/chapters/how-to-play.yaml` (Lich's Lair only).
Elsewhere, place it on a campaign dashboard or a dedicated Rules page for the
full spread.

---

## Rulebook Fold Engine (Shared Utility)

**File:** `widgets/rulebook-fold-engine.js` · **Global:** `RulebookFoldEngine`

A content-agnostic interaction module loaded as a global (manifest
`text_renderers`, before widget scripts), with no UI of its own. It knows three
fold moves (wing, flap, reader) and how they coordinate. `rulebook-frontpage`
builds a DOM using the data-attribute contract documented in the file head and
calls `RulebookFoldEngine.mount(root, options)`.

A pure state machine (`createState`, `reduce`, `escapePriority`, `wingSide`,
`clampWingWidth`, `isMobileWidth`, `mobileWingWidth`, `tileMatches`,
`blockMatches`, `termCategoryColor`, `clampCardPosition`) is separate from the
DOM controller and tested headless (`tools/test-rulebook-fold-engine.mjs`).

- **Sheet** (`data-rb-wing-mode="sheet"`, the Lich's Lair): `sheetMode`
  (`wide` | `phone`) and `sheetLayout` place the one-column board.
  `sheetTravel` moves the card's token (`[data-rb-sheet-token]`) onto its twin
  on the board (host selector `data-rb-sheet-land`, tilting into
  `data-rb-sheet-land-tilt`), and `sheetLandClip` trims it to the twin's
  clipping frame (`data-rb-sheet-land-clip`) so the hand-over shows no hidden
  edge. These are pure and unit-tested; the open/close film is driven over a
  fake DOM in `tools/test-rulebook-lair-book.mjs`.
  `mount(root, { onSettle, onShut })`: `onSettle(kind, id)` fires once the board
  has landed; `onShut(kind, id)` returns the ms the board needs to shut its
  book before the film runs back. Focus moves into the board on open and back
  to the card when the book is home; Tab cycles the board's visible controls;
  the page never scrolls. Under reduced motion the board fades and the book
  stays on its card.
- **Mobile wings** (`mobileWingWidth`): under 640px a wing folds downward and
  spans the full width of its `[data-rb-block]` ancestor.
- **Glossary hover cards**: `mount(root, { terms })` takes a map
  `slug -> { name, category, body }` and attaches a card to every
  `[data-rb-term]` (hover/focus/tap shows it via `clampCardPosition`; `Esc`,
  outside tap or scroll dismisses it, before any fold). Content is set with
  `textContent`, so glossary text stays inert. The caller renders the
  `[data-rb-hcard]` shell. `mount` also accepts `onClose(kind)`.

---

## Rulebook Example Player (Shared Utility)

**File:** `widgets/rulebook-example-player.js` · **Global:** `RulebookExamplePlayer`

A content-agnostic module (global via `text_renderers`) that renders and plays
a "script", a short at-the-table scene: tokens slide in and the acting token
glows, lines light one by one (director gold, player purple, roll amber), the
roll ticks its dice, settles on the scripted values, steps the math out with
its why, and the tier stamps on. Replay is always available;
`prefers-reduced-motion` reveals everything instantly.

Scripts are data (`data/rulebook-examples.json`): `properties.stage` and
`properties.lines[]` with `speaker`, `kind` (`dir` | `pc` | `roll`), `text`,
`dice`, `steps`, `tier`, and optional `_effects` that move the Lair's table. A
Lair script may set `properties.startMalice` (initial Malice counter) and
`properties.startStamina` (`{ heroSlug: percent }`; an unnamed hero starts
full). Text markup: `**bold**`, `~~dmg~~` (combat accent).

The consumer builds the DOM (`[data-rbx-play="slug"]` buttons,
`[data-rbx-script="slug"]` containers; optional `data-rbx-show` /
`data-rbx-hide` for a drill-in and `data-rbx-back` to reverse it) and calls
`RulebookExamplePlayer.mount(root, { examples, lair, refs })`. If the page has
`[data-rbx-lair-table]` / `[data-rbx-lair-rules]` panels, the player fills them
instead of rendering the table and rules with each script. `play(slug, { hold:
true })` puts a part on the board with its book shut; `play(slug)` opens it;
`shut()` closes the open book and returns how long that takes (0 when none is
open or motion is reduced). Pure logic (`planScript`, `rollRevealOrder`,
`tokenForLine`, `isRoll`, `richText`, `buildScriptHtml`, the scene functions)
is tested headless (`tools/test-rulebook-example-player.mjs`,
`tools/test-rulebook-popup-scene.mjs`).

### Pop-up scenes (the Lair board)

Inside `[data-rbx-board]`, a script with a valid `properties.scene` plays as a
paper pop-up book: the cover is the left page, pieces stand up on hinges as it
opens, and each beat moves pieces. A script with no scene, or one
`validateScene` cannot draw, falls back to the flat stage. The widget has no
part-specific code; every scene is data over one shared kit:

```json
"scene": {
  "backdrop": "hall",
  "pieces": [
    { "id": "kaelen", "kit": "knight", "x": 150, "y": 150, "card": "kaelen", "label": "Kaelen" },
    { "id": "bugbear", "kit": "bugbear", "x": 350, "y": 140, "face": -1, "card": "bugbear", "label": "The bugbear" },
    { "id": "dice", "kit": "dice", "x": 265, "y": 172, "show": [2, 2], "card": "roll", "label": "The dice" },
    { "id": "flag", "kit": "flag", "x": 384, "y": 190, "show": [4], "text": "7 damage", "card": "what", "label": "What happened" }
  ],
  "beats": [
    { "line": 0, "cues": [{ "who": "bugbear", "do": "step" }] },
    { "line": 2, "cues": [] },
    { "line": 2, "tier": true, "cues": [] },
    { "line": 3, "cues": [{ "who": "bugbear", "do": "knock", "hold": true }] }
  ],
  "cards": {
    "kaelen": { "kicker": "HERO", "title": "Kaelen", "stats": [["Might", "+2"]], "from": "frontpage:characteristic-might" },
    "bugbear": { "kicker": "MONSTER", "title": "Bugbear", "role": "brute", "says": [0, 3] },
    "roll": { "kicker": "RULE", "from": "glossary:power-roll", "roll": true, "tiers": "hero-power-roll" },
    "what": { "kicker": "WHAT HAPPENED", "says": [3], "links": ["glossary:push"] }
  }
}
```

- **`backdrop`**: the wall at the back: `hall`, `gate`, `mouth` or `throne`.
- **`pieces[]`**: `id` (unique), `kit` (a `KIT` name: figures `knight` `shield`
  `mage` `archer` `bugbear` `cultist` `adept` `lich` `skeleton-archer`; props
  `door` `brazier` `crown` `stone` `glyphs` `slash` `bolt` `curse` `rubble`
  `ledge`; the flat `rune`; paper tags `dice` `ribbon` `flag`), `x` (left edge),
  `y` (hinge line; 0 = back of the 600 x 250 spread, 250 = front), optional
  `w`/`h`, `face: -1` (faces left), `flip` (mirrors the art), `show` (`[from]`
  or `[from, to]` beat indexes, inclusive; absent = always stands), `text` (a
  flag's words), and `card` + `label` (the piece becomes a button opening that
  card). Dice and ribbon draw the script's own dice, tier and total.
- **`beats[]`**: each names a script `line` (never going back), an optional
  `tier: true` (this beat stamps the roll's tier, for a roll split into a dice
  beat and a tier beat), and `cues` of `{ who, do, hold }`. `do` is one of
  `MOTIONS` (`step` `wind` `lunge` `knock` `fall` `prone` `cast` `stagger`
  `rise` `burst` `trip` `cheer` `flare` `fade` `drop` `glow` `flee` `shake`). A
  cue lasts its beat; `hold` keeps it for the rest of the part. A fallen piece
  takes no clicks. Without `beats` there is one beat per line.
- **`cards{}`**: `kicker`, optional `title`, `from` (`glossary:` / `creature:`
  / `role:` / `frontpage:` + slug, or `tier:` + a front-page hero slug for the
  band the roll landed in), `role` (adds a role row), `tiers` (a hero block's
  tier bands), `roll` (the script's dice, modifiers and total), `stats`
  (`[label, value]` sample numbers), `says` (line indexes quoted) and `links`
  (keyword refs). Rules text comes only from the `from` entry, verbatim; any
  script number marks the card **SAMPLE**. A piece with no data entry shows
  only what its script says.

Keyword buttons in a card fold out a dark seal card (from the glossary, a role
template, a creature's traits or a front-page block); a seal card links any
glossary entry its text names, which stacks another card. `Esc` closes the top
card, the close button closes that card and those above it, an outside click
closes all; focus moves into each card and returns to its opener. Auto-advance
pauses while a card is open. Under reduced motion the book is simply open and
cards simply appear; the scene's loops rest on `MotionRest`.

---

## Reference Renderer (Shared Utility)

**File:** `widgets/reference-renderer.js` · **Global:** `DrawSteelRefRenderer`

Loaded as a global (`text_renderers`) before the widgets that resolve
`{@category term}` markup; no UI of its own.

1. `new DrawSteelRefRenderer(basePath)` then `.load()` fetches the glossary.
2. `ref.renderText(escapedHtml)` replaces `{@category term}` with styled tooltip spans.
3. `.injectStyles()` adds the tooltip CSS once per page.

Category colours: conditions red, movement blue, durations purple, resources
green, actions orange, combat indigo.

---

## Monster Engine and Monster Party (Shared Utilities)

**Files:** `widgets/monster-engine.js` (globals `MonsterEngine`,
`DrawSteelFormulas`), `widgets/monster-party.js` (global `MonsterParty`)

Loaded as globals (`text_renderers`) before the widget scripts, no UI.
`DrawSteelFormulas` is the only place the published formulas are evaluated
(Encounter Budget, Monster Builder and the stat block all use it).
`MonsterParty` reads the campaign's hero pages and derives the party profile
the builder uses, skipping a stat a hero lacks instead of counting it as zero.

---

## Common Patterns

- **Data route.** Reference data comes only from Chronicle's `SystemDataAPI`.
  With no campaign id, do not fetch; degrade honestly.
  ```javascript
  var url = '/campaigns/' + encodeURIComponent(campaignId) + '/systems/drawsteel/data/' + file;
  ```
- **API calls.** `Chronicle.apiFetch(url, options)` for authenticated requests.
- **XSS.** Escape all user-facing text with `Chronicle.escapeHtml()` before DOM
  insertion; the @reference renderer runs after escaping (`{@...}` is not
  HTML-special).
