# Chronicle - Draw Steel System Pack

A game system content pack for [Chronicle](https://github.com/keyxmakerx/Chronicle) providing full **Draw Steel RPG** (by MCDM Productions) support — creatures, abilities, entity presets, interactive widgets, and rules cross-references.

## What's Included

### Reference Data
- **35 creatures** across 7 organization types (Minion, Horde, Platoon, Elite, Leader, Solo, Swarm), levels 1-10 — example stat blocks (`"source": "custom"`), not reproduced Draw Steel monsters
- **23 template abilities** — signature, action, maneuver, triggered, and villain-action types
- **519 hero abilities, 12 ancestries, 21 kits** — the nine classes' abilities, kit signature abilities, and common actions
- **9 role templates** — Ambusher, Artillery, Brute, Controller, Defender, Harrier, Hexer, Mount, Support
- **7 organization templates** — the published organization and Stamina modifiers, plus default speed/stability (Swarm is this package's own, and carries no published modifiers)
- **65 rules glossary entries + 57 skills** — conditions, movement, durations, resources, combat terms, and the five Draw Steel skill groups
- **23 creature keywords** — Dragon, Undead, Humanoid, Elemental, etc.
- **54 negotiation entries** — the published negotiation rules: starting attitudes, motivations and pitfalls, argument outcomes, offers by Interest, and the procedure (Heroes Book ch. 11)

### Rulebook
The `book/` folder is a Rulebook book: Chronicle's Rules page opens it as a page-turning rulebook with a Player's book and a Director's book, including a Negotiation chapter. The format is in Chronicle's `docs/system-rulebook-book.md`.

### DM Screen
The manifest's `dm_screen` block tells Chronicle's DM Screen what to show for each hero: Stamina, Recoveries and the heroic resource as meters, the class under the hero's name, the hero's current conditions (from the sheet's `conditions_json`), and the condition entries of the rules glossary for rules lookup.

### Entity Presets
- **Hero** — full Foundry VTT sync with `foundry_path` annotations (class, ancestry, level, all 5 characteristics, stamina, recoveries, speed, stability). Wealth is a standing, not a purse: Chronicle's shop room refuses to spend it like coins
- **Creature** — complete stat block with Foundry NPC actor sync (organization, role, EV, abilities, villain actions, traits)

### Interactive Widgets
- **Monster Builder** — a one-page creature editor whose figures follow the published formulas and say where they came from; the director sets what no formula covers. It checks completeness, not balance. See `docs/WIDGET-GUIDE.md`.
- **Bestiary Browser** — filterable/searchable creature catalog with card grid, modal stat blocks, and Add to this campaign
- **Creature stat block** — the stat block under each Creature page's title, with Edit stat block and Publish for the director
- **Character Sheet** — read-only hero reference sheet synced from Foundry (abilities, skills, kit, features). See `docs/CHARACTER-SHEET-DESIGN.md`.
- **Rulebook Front Page** — an interactive rules page (power roll, characteristics, conditions). See `docs/WIDGET-GUIDE.md`.
- **Negotiation Tracker** — runs a negotiation on an NPC page; Chronicle mounts it below the title of NPC pages on its own. See `docs/WIDGET-GUIDE.md`.

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
4. In your campaign, open **Manage → Game & features** and pick "Draw Steel" in the **Game system** card

### Updating
Install the newer release from **Admin > Packages**. Chronicle adds the sheet fields the update introduces to the entity types of campaigns already using Draw Steel; it never restores a field a GM deleted, and it does not create entity types or change existing fields.

### Via Manual Upload
1. Download the latest release ZIP from GitHub Releases
2. Go to **Campaign Settings > Content Packs > Upload System**
3. Upload the ZIP and verify the validation report

## Adding Widgets to Your Campaign

After enabling the Draw Steel system:
1. Open any entity page (or create a new Creature entity)
2. Click the layout customizer
3. Under **Extensions**, find the Draw Steel widget you want
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

Every `data/*.json` file is a JSON array of these objects. Required fields: `slug` (unique ID), `name` (display name), `source` (where the entry comes from, or `"custom"`). Optional: `description`, `summary`, `properties` (domain fields), `tags`. Full schemas: `docs/DATA-SCHEMA.md`.

## Contributing

### Adding a Creature
1. Add an entry to `data/creatures.json` following the schema in `docs/DATA-SCHEMA.md`
2. Calculate stats with the `DrawSteelFormulas` section of `widgets/monster-engine.js` (published math; see `docs/DATA-SCHEMA.md` → "Stat Calculation") — not `data/organization-templates.json` / `data/role-templates.json`, which are this package's own legacy estimates
3. Use `{@category term}` syntax for rule references in ability text
4. Regenerate the derived fields with `node tools/build-render-fields.mjs`, then run `node --test tools/test-*.mjs`

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
manifest.json              Package manifest (categories, presets, widgets, text_renderers, dm_screen)
data/
  creatures.json           35 example creatures ("source": "custom", not published monsters)
  creature-abilities.json  23 template abilities
  rules-glossary.json      65 rules definitions for @references
  organization-templates.json  7 org types (legacy estimates, not the published formulas)
  role-templates.json      9 roles (characteristic baselines)
  creature-keywords.json   23 creature type keywords
  ability-keywords.json    24 ability/keyword definitions
  abilities.json           519 hero abilities
  ancestries.json          12 ancestries
  kits.json                21 kits
  skills.json              57 skills
  negotiation.json         54 negotiation rules entries
  monster-building.json    Published monster-making rules and formulas
  encounter-building.json  Published encounter-building rules
  ancestry-point-buy.json  Ancestry point-buy rules
  animal-traits.json       35 animal traits
  rulebook-*.json          Data for the Rulebook front page and worked examples
book/
  book.yaml                Rulebook cover, theme and chapter list
  chapters/                One YAML file per chapter
widgets/
  monster-builder.js       One-page creature editor
  monster-engine.js        Published Draw Steel formulas (the only place they're evaluated)
  monster-party.js         Party-aware suggestion data (fetch + derive)
  bestiary-browser.js      Filterable creature catalog
  statblock-renderer.js    Creature stat block panel
  character-sheet.js       Read-only hero reference sheet
  rulebook-frontpage.js    Interactive rules page
  rulebook-fold-engine.js  Shared fold/glossary-hover interaction module
  rulebook-example-player.js  Shared worked-example playback module
  negotiation-tracker.js   Negotiation on NPC pages
  reference-renderer.js    Shared @reference parsing utility
tools/
  build-render-fields.mjs  Regenerates derived display fields and manifest categories
  test-*.mjs               CI tests (`node --test tools/test-*.mjs`)
docs/
  DATA-SCHEMA.md           Data file schemas and validation
  WIDGET-GUIDE.md          Widget configuration guide
  CHARACTER-SHEET-DESIGN.md  Character sheet design decisions
  FOUNDRY-SYNC-MAP.md      Foundry ↔ Chronicle field map (hero)
  monster-builder.md       Monster Builder design document
  foundry-creature-sync.md Foundry VTT creature-sync specification
  implementation-checklist.md  Implementation roadmap
```

## Open work: creatures

The stat block, the one-page editor and the bestiary browser are rebuilt
(#49). Still open: the Foundry creature-sync leg (#54) and encounter assembly
(#50).

## License

This package carries **two** licensing positions, because it contains two kinds of
material. See [LICENSE](LICENSE) for the full statement and
[data/NOTICE.md](data/NOTICE.md) for the file-by-file attribution.

**The Draw Steel rules text in `data/`** — glossary, skills, ancestries, kits,
abilities, ability keywords, the ancestry point-buy, the monster-making and
encounter-building formulas, the animal traits, and the negotiation rules — is reproduced under MCDM's
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
