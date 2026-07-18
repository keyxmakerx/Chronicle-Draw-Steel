# Widget Configuration Guide

This package provides three interactive widgets that can be added to entity page layouts via Chronicle's customizer.

## Adding Widgets

1. Open any entity page (or campaign dashboard)
2. Click the **layout customizer** button
3. Under **Extensions > Draw Steel**, you'll see the available widgets
4. Drag a widget into your desired layout position
5. Configure it via the widget settings panel

## Monster Builder

**Slug:** `monster-builder`

A 7-step guided creature authoring wizard with auto-calculated stats, validation, encounter balancing, and full statblock preview.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `entity_id` | string | — | Entity to edit (if editing existing creature) |
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |
| `editable` | boolean | `true` | Whether the form is interactive. Set to `false` for read-only display. |

### Steps
1. **Identity** — Name, level, size, faction, keywords
2. **Organization & Role** — Select org type and combat role (auto-calculates stats)
3. **Statistics** — Review/override auto-calculated stats
4. **Abilities** — Add abilities from templates or create custom ones
5. **Free Strike** — Configure free strike damage
6. **Villain Actions** — Add 3 villain actions (Leaders/Solos only)
7. **Traits** — Add passive traits and immunities

### Usage
Best placed on a creature entity page. When `entity_id` is set, it loads existing creature data for editing. When empty, it creates a new creature.

---

## Bestiary Browser

**Slug:** `bestiary-browser`

A searchable, filterable creature catalog with card grid display and popup statblock modals.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |
| `source` | string | `"campaign"` | Data source: `"campaign"` (campaign entities) or `"bestiary"` (community bestiary) |
| `per_page` | number | `20` | Number of creatures per page |

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

A read-only formatted statblock display for a single creature entity.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `entity_id` | string | — | The creature entity to display |
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Features
- Full formatted statblock (header, stats, characteristics, abilities, villain actions, traits)
- @reference tooltips on rule terms
- Responsive layout

### Usage
Place on a creature entity page alongside or instead of the raw field editor. Provides a clean read-only view of the creature's complete stat block.

---

## Rulebook Front Page

**Slug:** `rulebook-frontpage`

The dynamic rulebook's editorial "front page of the book" — a single-screen spread
that folds open in three matched ways (the SIGNED `rulebook-v10` design):

- **Hero Power Roll block** → unfolds into a centred **reading sheet** (FLIP takeover, veil behind).
- **Five characteristic cards** → each folds a **hinged wing** out of its edge, over its
  neighbours (left-column cards wing right, right-column cards wing left).
- **Condition rows** → each unfolds a **flap** down over the rows beneath.
- **The Lich's Lair** worked-scene → wings left over the whole Conditions block.

Plus: cards deal in on load, `/` focuses search, non-matching cards fold face-down,
related chips hop across fold types, and `✕ / Esc / tap-outside` always folds back
(priority flap → wing → reader). Everything is tap-first; under 640px wings open
**downward full-width** (flap-style) instead of sideways. Honours `prefers-reduced-motion`.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `campaign_id` | string | — | Campaign context (auto-set by Chronicle) |

### Content Source

- **Hero / characteristics / worked-scene** copy comes from `data/rulebook-frontpage.json`
  (ReferenceItem array; `properties.kind` = `hero` \| `characteristic` \| `conditions` \| `worked-scene`).
- **Condition flap text** comes from `data/rules-glossary.json` (entries with
  `properties.category === "condition"`), looked up by slug — a single source of truth
  shared with the @reference tooltip system.

### Placement / Cutover

This widget is **additive** — it introduces a NEW rules surface and demolishes nothing.
There is no pre-existing rules-browser widget; the only prior rules surface is the
`reference-renderer.js` tooltip utility + the glossary data, both of which this widget
reuses. Place it via the layout customizer on a **campaign dashboard** or a dedicated
**"Rules" page** as the entry point. Later slices (staged example player, glossary
hover-cards, long-form chapters, Lair transcripts, deep glossary search) extend this
surface; the widget leaves clean seams for each.

---

## Rulebook Fold Engine (Shared Utility)

**File:** `widgets/rulebook-fold-engine.js` · **Global:** `RulebookFoldEngine`

Not a standalone widget — a reusable, **content-agnostic** interaction module loaded as a
global (via the manifest `text_renderers` seam, before widget scripts). It knows nothing
about characteristics or conditions; it only knows three physical fold moves (wing / flap /
reader) and how they coordinate. `rulebook-frontpage` builds a DOM using the fold data-attribute
contract (documented in the file head) and calls `RulebookFoldEngine.mount(root, options)`.

The module splits a **pure state machine** (`createState` / `reduce` / `escapePriority` /
`wingSide` / `clampWingWidth` / `isMobileWidth` / `tileMatches` / `blockMatches`) from the DOM
controller, so the fold logic is unit-tested headless (`tools/test-rulebook-fold-engine.mjs`,
`node --test`).

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

### Asset Base Path
All widgets construct the asset path from `config.campaignId`:
```javascript
var base = config.campaignId
  ? '/api/v1/campaigns/' + config.campaignId + '/extensions/drawsteel/assets/'
  : '/extensions/drawsteel/assets/';
```

### API Calls
Widgets use `Chronicle.apiFetch(url, options)` for authenticated API requests. This handles auth tokens automatically.

### XSS Safety
All user-facing text is escaped via `Chronicle.escapeHtml()` before DOM insertion. The @reference renderer runs after escaping (safe because `{@...}` characters aren't HTML-special).
