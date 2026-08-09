# Chronicle - Draw Steel System Pack

A game system content pack for [Chronicle](https://github.com/keyxmakerx) providing full **Draw Steel RPG** (by MCDM Productions) support — creatures, abilities, entity presets, interactive widgets, and rules cross-references.

## What's Included

### Reference Data (35 creatures, 23 abilities, 25 rules)
- **35 creatures** across 7 organization types (Minion, Horde, Platoon, Elite, Leader, Solo, Swarm), levels 1-10
- **23 template abilities** — signature, action, maneuver, triggered, and villain-action types
- **9 role templates** — Ambusher, Artillery, Brute, Controller, Defender, Harrier, Hexer, Mount, Support
- **7 organization templates** — the published organization and Stamina modifiers, plus default speed/stability (Swarm is this package's own, and carries no published modifiers)
- **25 rules glossary entries** — conditions, movement, durations, resources, combat terms
- **23 creature keywords** — Dragon, Undead, Humanoid, Elemental, etc.

### Entity Presets
- **Hero** — full Foundry VTT sync with `foundry_path` annotations (class, ancestry, level, all 5 characteristics, stamina, recoveries, speed, stability)
- **Creature** — complete stat block with Foundry NPC actor sync (organization, role, EV, abilities, villain actions, traits)

### Interactive Widgets
- **Monster Builder** — 7-step creature authoring with stats auto-filled from the published formulas, completeness checks, damage hints, an encounter-strength calculator, and full preview. It does not certify balance: figures the published rules do not cover are labelled unsourced on screen. See `docs/WIDGET-GUIDE.md`.
- **Bestiary Browser** — filterable/searchable creature catalog with card grid, modal statblocks, and campaign import
- **Statblock Renderer** — read-only formatted creature statblock display for entity pages

### @Reference Cross-Links
Ability text uses `{@category term}` syntax (like D&D Beyond) that renders as styled tooltips on hover:
- `{@condition frightened}` — shows the Frightened rule definition
- `{@movement shift}` — shows what Shift means
- `{@duration save-ends}` — shows how Save Ends works

The `reference-renderer.js` utility handles parsing and rendering. All 35 creatures and 23 abilities use @references.

### Relation Types
- Ally, Enemy, Patron/Agent, Mentor/Student, Has Item (with quantity/equipped metadata)

## Installation

### Via Package Manager (Recommended)
1. Go to **Admin > Packages**
2. Add this repository URL
3. Install the latest release
4. Go to **Campaign Settings > General > Game System** and select "Draw Steel"

### Via Manual Upload
1. Download the latest release ZIP from GitHub Releases
2. Go to **Campaign Settings > Content Packs > Upload System**
3. Upload the ZIP and verify the validation report

## Adding Widgets to Your Campaign

After enabling the Draw Steel system:
1. Open any entity page (or create a new Creature entity)
2. Click the layout customizer
3. Under **Extensions**, find Monster Builder, Bestiary Browser, or Statblock Renderer
4. Drag the widget into your layout

## Data Format

All files in `data/` follow Chronicle's **ReferenceItem** format:

```json
{
  "slug": "goblin-sniper",
  "name": "Goblin Sniper",
  "description": "A small, cunning goblin that pelts enemies with arrows from cover.",
  "properties": {
    "level": 1,
    "organization": "Minion",
    "role": "Artillery",
    "stamina": 7,
    "might": -2,
    "agility": 1
  }
}
```

Every `data/*.json` file is a JSON array of these objects. Required fields: `slug` (unique ID), `name` (display name). Optional: `description`, `properties` (arbitrary key-value metadata).

## Contributing

### Adding a Creature
1. Add an entry to `data/creatures.json` following the schema in `docs/DATA-SCHEMA.md`
2. Calculate stats using the formulas in `data/organization-templates.json` and `data/role-templates.json`
3. Use `{@category term}` syntax for rule references in ability text
4. Validate: `python3 -c "import json; json.load(open('data/creatures.json'))"`

### Adding an Ability
1. Add to `data/creature-abilities.json` with a unique `slug`
2. Include `type`, `keywords`, `distance`, `target`, and power roll tiers in `properties`
3. Use @references for conditions and effects

### Adding a Rules Glossary Entry
1. Add to `data/rules-glossary.json` with `slug`, `name`, `description`, and `properties.category`
2. Categories: `condition`, `movement`, `duration`, `resource`, `action`, `combat`

### Code Style (Widgets)
- ES5 JavaScript (`var`, no `let`/`const`, no arrow functions)
- All widgets use `Chronicle.register('slug', { init, destroy })`
- XSS safety via `Chronicle.escapeHtml()`
- Styles injected as `<style>` tags (no separate CSS files)

### Releases
Releases are cut on demand from `main` via the **Release** workflow
(`.github/workflows/release.yml`). There is no version in `manifest.json` — the
Git tag **is** the version, and Chronicle's package manager installs the latest
non-prerelease tag.

To publish: **Actions → Release → Run workflow**, enter the version (e.g.
`0.13.7`, no leading `v`). The workflow creates the tag and GitHub Release from
`main` HEAD with auto-generated "What's Changed" notes.

## Project Structure

```
manifest.json              Package manifest (categories, presets, widgets, text_renderers)
data/
  creatures.json           35 example creatures (see the rewrite dispatch below)
  creature-abilities.json  23 template abilities
  rules-glossary.json      60 rules definitions for @references
  organization-templates.json  7 org types (stamina/EV formulas)
  role-templates.json      9 roles (characteristic baselines)
  damage-baselines.json    Damage scaling by tier and organization
  creature-keywords.json   23 creature type keywords
  ability-keywords.json    9 ability type keywords
  abilities.json           519 hero abilities
  ancestries.json          12 ancestries
  kits.json                21 kits
widgets/
  monster-builder.js       7-step creature authoring wizard
  bestiary-browser.js      Filterable creature catalog
  statblock-renderer.js    Formatted statblock display
  reference-renderer.js    Shared @reference parsing utility
docs/
  DATA-SCHEMA.md           Data file schemas and validation
  WIDGET-GUIDE.md          Widget configuration guide
  PROJECT-HANDOFF.md       Architecture and status overview
  monster-builder.md       Monster Builder design document
  foundry-creature-sync.md Foundry VTT sync specification
  implementation-checklist.md  Implementation roadmap (STALE — see below)
```

## Planned: the bestiary + monster-builder rewrite

The community bestiary browser, the monster builder, and the Foundry creature-sync
leg are booked for a rewrite. The plan of record is the coordinator dispatch
**`C-BESTIARY-REWRITE`** (`Cordinator/dispatches/chronicle/C-BESTIARY-REWRITE.md`).
It is **unsigned** — ten blocks `[BR-1]`…`[BR-10]` await a coordinator ruling, and
none of them is an executor's to open.

Read it before planning any work on `widgets/bestiary-browser.js`,
`widgets/monster-builder.js`, `data/creatures.json`, or the creature preset's
`foundry_path` annotations. Four things it settles that are easy to get wrong here:

- **Chronicle's `internal/plugins/bestiary` is shipped and working** (3,252 lines of
  Go, JSON-only, sanitised on write *and* read, multi-system). The rewrite is this
  package's **widgets**, not that plugin. `docs/implementation-checklist.md` marks
  that plugin — and the "Publish to Bestiary" button that shipped in
  `widgets/monster-builder.js` — as *not done*; it is wrong on both counts.
- **`widgets/monster-formulas.js` stays the only place published formulas are
  evaluated**, and every rendered figure keeps its `sourced` provenance flag. See
  CLAUDE.md → "The builder's math must carry its own provenance".
- **`data/creatures.json` is 35 example fixtures, not a seed corpus.** Nothing loads
  it, every `source` is `"custom"`, its abilities are bare names, and against the
  published formulas in `data/monster-building.json` only 2 of 30 EV values and
  **0 of 30** Stamina values agree (the other 5 entries are `Swarm`, which has no
  published organization modifier at all). `[BR-6]` rules its fate.
- **The Foundry creature leg does not exist yet in either repo**, and three documents
  (`docs/foundry-creature-sync.md` §4.1, `manifest.json`'s creature preset, and the
  Foundry module's `API-CONTRACT.md`) give three different, unverified `foundry_path`
  maps. `docs/FOUNDRY-SYNC-MAP.md` is the *hero* map and is the only one verified
  against the Draw Steel system source. `[BR-7]`/`[BR-8]` rule direction, conflict
  resolution, and where the paths get verified.

## License

This package carries **two** licensing positions, because it contains two kinds of
material. See [LICENSE](LICENSE) for the full statement and
[data/NOTICE.md](data/NOTICE.md) for the file-by-file attribution.

**The Draw Steel rules text in `data/`** — glossary, skills, ancestries, kits,
abilities, ability keywords, the ancestry point-buy, the monster-making and
encounter-building formulas, and the animal traits — is reproduced under MCDM's
**DRAW STEEL Creator License**. It is *not* Creative Commons material: MCDM has not
released Draw Steel under any CC licence, and there is no Draw Steel SRD.

> This package is an independent product published under the DRAW STEEL Creator
> License and is not affiliated with MCDM Productions, LLC.
> **DRAW STEEL © 2024 MCDM Productions, LLC.**

No MCDM trademarks, logos, art, or setting material are reproduced here — only rules
text and its mechanical numbers. MCDM endorsement is not implied. This package cannot
sublicense that text; anyone redistributing it relies on the same Creator License and
must carry the same attribution.

**This package's own work** — `widgets/*.js`, `tools/*.mjs`, `docs/*`, `manifest.json`,
and the data entries flagged `"source": "custom"` (including the 35 example creatures in
`creatures.json`) — is licensed **CC-BY-4.0**, © the Chronicle Draw Steel contributors.

**A limitation worth knowing about:** the Creator License text itself could not be read
from the environment this position was written in (`mcdmproductions.com` is unreachable
there). The statements above rest on this repository's established position and on the
community Steel Compendium's reliance on the same licence for the same material — not on
a reading of the licence. A human should read it once and confirm. See the closing
section of [LICENSE](LICENSE).
