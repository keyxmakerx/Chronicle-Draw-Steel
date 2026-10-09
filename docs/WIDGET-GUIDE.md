# Widget Configuration Guide

This package provides five interactive widgets — Monster Builder, Bestiary Browser,
Statblock Renderer, Rulebook Front Page, and Negotiation Tracker — plus three shared utility modules
(below), addable to entity page layouts via Chronicle's customizer. The Character
Sheet widget (`widgets/character-sheet.js`) is documented separately, in
`docs/CHARACTER-SHEET-DESIGN.md`.

## Adding Widgets

1. Open any entity page (or campaign dashboard)
2. Click the **layout customizer** button
3. Under **Extensions > Draw Steel**, you'll see the available widgets
4. Drag a widget into your desired layout position
5. Configure it via the widget settings panel

## Monster Builder

**Slug:** `monster-builder`

The one-page creature editor: identity, figures, characteristics, traits,
abilities and villain actions on the left; the party, the encounter budget and
the completeness checks on the right. **Start from…** copies a creature from
the community bestiary or this campaign, recomputed for its level. Most
directors reach it through **Edit stat block** on a Creature page (see
Statblock Renderer below) rather than placing it.

**What the numbers are.** Encounter value, Stamina, free strike, formula
ability damage and the highest characteristic come from the published formulas
in `data/monster-building.json`; the encounter readout uses the published
encounter strength and difficulty bands from `data/encounter-building.json`.
Where the published rules do not cover an input — the Swarm organization is
this package's own, and the Stamina formula needs a role — the box is left for
the director and says so. A number the director types is never overwritten.
**The panel checks that a stat block is complete. It does not certify that a
creature or an encounter is balanced**, and it does not check the published
spending limits (creatures per hero, the six-stat-block cap, buying minions in
fours, star-of-the-show). Details: `docs/monster-builder.md`.

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

**Slug:** `bestiary-browser`

A searchable, filterable creature catalog with card grid display and popup statblock modals.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |
| `source` | string | `"bestiary"` | Data source: `"campaign"` (campaign entities) or `"bestiary"` (community bestiary) |
| `per_page` | number | `20` | Number of creatures per page |
| `editable` | boolean | `true` | Whether Import/Export/Create/Edit/Delete actions are shown |

### Features
- **Search** — Full-text search by creature name
- **Filters** — Organization, role, level range, keywords
- **Sort** — Level, name, EV
- **Card Grid** — Visual cards with org-colored borders showing key stats
- **Modal Statblock** — Click a card to see the full formatted statblock
- **Import** — "Import to Campaign" creates the creature as an entity in your campaign
- **Export** — Download creature data as JSON

### Usage
Best placed on a campaign dashboard or dedicated "Bestiary" page. In `"campaign"` source mode, it shows creatures already in your campaign. In `"bestiary"` mode, it shows the community bestiary for importing.

---

## Statblock Renderer

**Slug:** `statblock-renderer`

The creature stat block, mounted by Chronicle under the title of Creature pages
(`entity_panels` in `manifest.json`). It shows header and EV, the Size / Speed
/ Stamina / Stability / Free strike strip, characteristics, immunities and
weaknesses, traits, abilities with tier odds, and villain actions. EV, Stamina
and free strike carry a tick when they match the published formula and a pen
when the director changed them. The director also gets **Edit stat block** and
**Publish** (to the Community Bestiary); a player sees nothing on a creature
with no stat block yet.

In page-layout mode the panel appears only where the layout has the **Game
System Panels** block.

### Config Keys (set by Chronicle)

| Key | Type | Description |
|-----|------|-------------|
| `entity_id` | string | The page |
| `campaign_id` | string | Campaign context |
| `is_gm` | boolean | Shows the director's buttons |

Its global `DrawSteelStatblock` is the one stat block drawing the editor,
the bestiary modal and hover cards (compact mode) share.

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

## Rulebook Front Page

**Slug:** `rulebook-frontpage`

The dynamic rulebook's editorial "front page of the book" — a single-screen spread
that folds open in three matched ways (the SIGNED `rulebook-v10` design):

- **Hero Power Roll block** → unfolds into a centred **reading sheet** (FLIP takeover, veil behind).
- **Five characteristic cards** → each folds a **hinged wing** out of its edge, over its
  neighbours (left-column cards wing right, right-column cards wing left).
- **Condition rows** → each unfolds a **flap** down over the rows beneath.
- **The Lich's Lair** worked-scene → the card's face is the **closed pop-up book** (the scene's
  own cover, drawn in the same 3D book, tilted on the card with its page edges showing) beside
  the title and description. Opening it lifts the book off the card; it travels onto the board's
  own closed book, easing into its tilt, and the centred one-column board appears round it: a
  header (the part's title, ↻ replay, ✕ close), a chip per part, the part's **pop-up book** with
  its caption line and ◀ ⏸ ▶ controls, and two drawers, **THE TABLE** (heroes + Stamina) and
  **RULES IN THIS PART**. Then the cover opens, on the part the worked-scene's `openOn` names.
  Closing shuts the book, the board fades away round it, and the book flies back onto its card.
  The same column is used at every width; a phone (560px and under) frames it inside a small
  inset.

Plus: cards deal in on load, `/` focuses search, non-matching cards fold face-down,
related chips hop across fold types, and `✕ / Esc / tap-outside` always folds back
(priority flap → wing → reader). Everything is tap-first; under 640px wings open
**downward, spanning the full width of their block** (viewport minus page padding —
not the cramped card column). Honours `prefers-reduced-motion`, and the breathing ⤢/⤵ marks
slow to a standstill on Chronicle's `MotionRest` clock when the viewer steps away (without
`MotionRest` they keep looping).

**Staged examples:** the Might card's two example buttons, the reader's
"▶ Watch the table play it" seam, and the Lich's Lair's seven parts play the worked scenes
via the `RulebookExamplePlayer` module (see below). **Glossary hover cards:** dotted
`.rb-hl` terms in the prose (authored with `{@category slug}` markup) show a quick card
(term · category chip · body) sourced from `rules-glossary.json`, on hover/focus/tap,
dismissed by `Esc` / outside-tap / scroll — driven by the fold engine's `terms` map.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Content Source

- **Hero / characteristics / worked-scene** copy comes from `data/rulebook-frontpage.json`
  (ReferenceItem array; `properties.kind` = `hero` \| `characteristic` \| `conditions` \| `worked-scene`).
  The worked-scene's `parts[]` (each `slug` + `play` script) are the board's chips in order, and
  `openOn` is the part slug the board opens on (the first part when absent).
- **Pop-up cards** quote `rules-glossary.json`, `creatures.json`, `role-templates.json` and the
  front page's own blocks; the last three are optional (a card then shows only what its script says).
- **Condition flap text** comes from `data/rules-glossary.json` (entries with
  `properties.category === "condition"`), looked up by slug — a single source of truth
  shared with the @reference tooltip system.

### Placement

There is no other rules-browser widget; the prior rules surface was the
`reference-renderer.js` tooltip utility plus the glossary data, both of which this
widget reuses. Place it via the layout customizer on a **campaign dashboard** or a
dedicated **"Rules" page** as the entry point. Long-form chapters, Lair transcripts,
and deep glossary search are not yet built; the widget leaves clean seams for them.
Open work: #48.

---

## Rulebook Fold Engine (Shared Utility)

**File:** `widgets/rulebook-fold-engine.js` · **Global:** `RulebookFoldEngine`

Not a standalone widget — a reusable, **content-agnostic** interaction module loaded as a
global (via the manifest `text_renderers` seam, before widget scripts). It knows nothing
about characteristics or conditions; it only knows three physical fold moves (wing / flap /
reader) and how they coordinate. `rulebook-frontpage` builds a DOM using the fold data-attribute
contract (documented in the file head) and calls `RulebookFoldEngine.mount(root, options)`.

The module splits a **pure state machine** (`createState` / `reduce` / `escapePriority` /
`wingSide` / `clampWingWidth` / `isMobileWidth` / `mobileWingWidth` / `tileMatches` /
`blockMatches` / `termCategoryColor` / `clampCardPosition`) from the DOM controller, so the fold
logic is unit-tested headless (`tools/test-rulebook-fold-engine.mjs`, `node --test`).

**The sheet** (`data-rb-wing-mode="sheet"`, the Lich's Lair): `sheetMode` (`wide` \| `phone`) /
`sheetLayout` place the one-column board per viewport, and `sheetTravel` gives the card's token
(`[data-rb-sheet-token]`, the Lair's closed book) the move onto its twin on the board (the host's
`data-rb-sheet-land` selector, tilting into `data-rb-sheet-land-tilt`, and trimmed by
touchdown to the twin's clipping frame named by `data-rb-sheet-land-clip`, via the pure
`sheetLandClip`, so the hand-over shows no edge the frame hides); these are pure and
unit-tested, and the open/close film itself is driven over a fake DOM in
`tools/test-rulebook-lair-book.mjs`. `mount(root, { onSettle, onShut })` hears
`onSettle(kind, id)` once the board has landed (the front page opens its pop-up book then) and
asks `onShut(kind, id)` for how many ms the board needs to shut its book before the film runs
back (the player's `shut()` answers). Focus moves into the board on open and back to the card
once the book is home; Tab cycles the board's visible controls (drawer summaries included); the
page never scrolls, and the open card keeps no transform. Under reduced motion the board simply
fades in and out and the book stays on its card.

**Mobile wings** (`mobileWingWidth`): under 640px a wing folds downward and spans the **full
width of its block** (viewport minus page padding, measured from the `[data-rb-block]` ancestor),
never the card column it hinges from.

**Glossary hover cards**: a content-agnostic layer. Pass `mount(root, { terms })` a map
`slug → { name, category, body }`; the engine attaches a quick card to every `[data-rb-term]`
element (hover / focus / tap → show near the term via `clampCardPosition`; `Esc` / outside / scroll
→ dismiss). The card content is set with `textContent` (untrusted glossary text stays inert), and
the category chip is coloured by `termCategoryColor`. The caller renders the `[data-rb-hcard]`
shell; the engine owns content, placement, and dismissal (sharing the single `Esc` pipeline with
the folds — the card dismisses first). `mount` also accepts `onClose(kind)` (fired when a fold
closes) so the consumer can react (e.g. reset a drill-in).

---

## Rulebook Example Player (Shared Utility)

**File:** `widgets/rulebook-example-player.js` · **Global:** `RulebookExamplePlayer`

Not a standalone widget — a reusable, **content-agnostic** module (loaded as a global via the
manifest `text_renderers` seam) that renders + plays a "script": a little at-the-table scene where
character tokens slide in and the acting token glows, lines light one by one (director gold /
player purple / roll amber), the ROLL line ticks its dice, settles on the scripted values, steps
the math out piece by piece **with its why**, and the tier **stamps** on; `↻ replay` is always
available and `prefers-reduced-motion` reveals everything instantly.

Scripts are **data** (`data/rulebook-examples.json`, ReferenceItem array; `properties.stage` +
`properties.lines[]` with `speaker` / `kind` (`dir`|`pc`|`roll`) / `text` / `dice` / `steps` /
`tier`, and optional `_effects` that move the Lair's table). A Lair script may also set
`properties.startMalice` (where its Malice counter begins) and `properties.startStamina`
(`{ heroSlug: percent }`, where its Stamina bars begin; a hero it doesn't name starts full). Text markup: `**bold**` and `~~dmg~~` (combat accent). The consumer builds the DOM
(`[data-rbx-play="slug"]` buttons + `[data-rbx-script="slug"]` containers; optional
`data-rbx-show` / `data-rbx-hide` for a drill-in and `data-rbx-back` to reverse it) and calls
`RulebookExamplePlayer.mount(root, { examples, lair, refs })`. When the page has
`[data-rbx-lair-table]` / `[data-rbx-lair-rules]` panels, the player fills them instead of
rendering the table and rules with each script. `play(slug, { hold: true })` puts a part on the
board with its book shut; `play(slug)` opens it; `shut()` closes the board's open book and
returns how long that takes (0 when none is open or motion is reduced). The module splits **pure logic**
(`planScript` / `rollRevealOrder` / `tokenForLine` / `isRoll` / `richText` / `buildScriptHtml`,
and the scene functions below) from the DOM controller, unit-tested headless
(`tools/test-rulebook-example-player.mjs`, `tools/test-rulebook-popup-scene.mjs`).

### Pop-up scenes (the Lair board)

Inside `[data-rbx-board]`, a script with a valid `properties.scene` plays as a paper pop-up
book: the cover is the left page, the wall and paper pieces stand up on hinges as it opens, and
each beat moves pieces. A script with no scene, or one `validateScene` cannot draw, falls back to
the flat stage. The widget has no part-specific code; every scene is data drawn from one shared
kit:

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

- **`backdrop`**: the wall at the back of the spread — `hall`, `gate`, `mouth` or `throne`.
- **`pieces[]`**: `id` (unique), `kit` (a `KIT` name: figures `knight` `shield` `mage` `archer`
  `bugbear` `cultist` `adept` `lich` `skeleton-archer`; props `door` `brazier` `crown` `stone`
  `glyphs` `slash` `bolt` `curse` `rubble` `ledge`; the flat `rune`; paper tags `dice` `ribbon`
  `flag`), `x` (left edge) and `y` (the hinge line, 0 = back of the 600 × 250 spread, 250 =
  front), optional `w`/`h`, `face: -1` (faces left), `flip` (mirrors the art), `show` (`[from]` or
  `[from, to]`, beat indexes, inclusive; absent = always stands), `text` (a flag's words, from
  the script), and `card` + `label` (the piece becomes a button opening that card). The dice
  and ribbon draw the script's own dice, tier and total.
- **`beats[]`**: each names a script `line` (never going back), an optional `tier: true` (this
  beat stamps the roll's tier; a roll split into a dice beat and a tier beat), and `cues` of
  `{ who, do, hold }`. `do` is one of `MOTIONS` (`step` `wind` `lunge` `knock` `fall` `prone`
  `cast` `stagger` `rise` `burst` `trip` `cheer` `flare` `fade` `drop` `glow` `flee` `shake`). A cue
  lasts its own beat; `hold` keeps it for the rest of the part. A fallen piece takes no clicks.
  Without `beats` there is one beat per line.
- **`cards{}`**: `kicker`, optional `title`, `from` (`glossary:` / `creature:` / `role:` /
  `frontpage:` + slug, or `tier:` + a front-page hero slug for the band the roll landed in),
  `role` (adds a role row linking its card), `tiers` (shows a hero block's tier bands), `roll`
  (adds the script's dice, modifiers and total), `stats` (`[label, value]` pairs, the script's
  sample numbers), `says` (line indexes the card quotes) and `links` (keyword refs). Rules text
  comes only from the `from` entry, verbatim; any script number marks the card **SAMPLE**. A
  piece with no data entry shows only what its script says.

Keyword buttons in a card fold out a dark seal card (from the glossary, a role template, a
creature's traits or a front-page block); a seal card links any glossary entry its own text
names, and that stacks another card. Esc closes the top card, ✕ closes that card and those above
it, a click outside closes them all; focus moves into each card and returns to its opener.
Auto-advance pauses while a card is open. Under `prefers-reduced-motion` the book is simply open
and cards simply appear; the scene's loops rest on `MotionRest` with the rest of the page.

---

## Reference Renderer (Shared Utility)

**File:** `widgets/reference-renderer.js`

Not a standalone widget — this is a shared utility loaded by the other three widgets. It provides the @reference tooltip system.

### How It Works
1. Widget calls `new DrawSteelRefRenderer(basePath)` and `.load()` to fetch the glossary
2. After loading, `ref.renderText(escapedHtml)` replaces `{@category term}` with styled `<span>` tooltips
3. `.injectStyles()` adds the tooltip CSS once per page

### Tooltip Styling
- **Conditions** (red) — frightened, dazed, slowed, etc.
- **Movement** (blue) — shift, push, pull
- **Durations** (purple) — EoT, save ends
- **Resources** (green) — temporary stamina, damage resistance
- **Actions** (orange) — free strike
- **Combat** (indigo) — power roll, stability, winded

---

## Common Patterns

### Data Route
Widgets fetch reference data from Chronicle's `SystemDataAPI`, the only route
that serves `data/*.json` — there is no campaign id → no fetch (degrade honestly):
```javascript
var url = '/campaigns/' + encodeURIComponent(campaignId) + '/systems/drawsteel/data/' + file;
```

### API Calls
Widgets use `Chronicle.apiFetch(url, options)` for authenticated API requests. This handles auth tokens automatically.

### XSS Safety
All user-facing text is escaped via `Chronicle.escapeHtml()` before DOM insertion. The @reference renderer runs after escaping (safe because `{@...}` characters aren't HTML-special).
