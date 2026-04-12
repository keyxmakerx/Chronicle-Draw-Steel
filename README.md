# Chronicle - Draw Steel System Pack

A game system content pack for [Chronicle](https://github.com/keyxmakerx) providing full **Draw Steel RPG** (by MCDM Productions) support — creatures, abilities, entity presets, interactive widgets, and rules cross-references.

## What's Included

### Reference Data (35 creatures, 23 abilities, 25 rules)
- **35 creatures** across 7 organization types (Minion, Horde, Platoon, Elite, Leader, Solo, Swarm), levels 1-10
- **23 template abilities** — signature, action, maneuver, triggered, and villain-action types
- **9 role templates** — Ambusher, Artillery, Brute, Controller, Defender, Harrier, Hexer, Mount, Support
- **7 organization templates** — stamina/EV/speed formulas for encounter balancing
- **25 rules glossary entries** — conditions, movement, durations, resources, combat terms
- **23 creature keywords** — Dragon, Undead, Humanoid, Elemental, etc.

### Entity Presets
- **Hero** — full Foundry VTT sync with `foundry_path` annotations (class, ancestry, level, all 5 characteristics, stamina, recoveries, speed, stability)
- **Creature** — complete stat block with Foundry NPC actor sync (organization, role, EV, abilities, villain actions, traits)

### Interactive Widgets
- **Monster Builder** — 7-step creature authoring with auto-calculated stats, validation, damage hints, encounter calculator, and full preview
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

## Project Structure

```
manifest.json              Package manifest (categories, presets, widgets, text_renderers)
data/
  creatures.json           35 creatures with full stat blocks
  creature-abilities.json  23 template abilities
  rules-glossary.json      25 rules definitions for @references
  organization-templates.json  7 org types (stamina/EV formulas)
  role-templates.json      9 roles (characteristic baselines)
  damage-baselines.json    Damage scaling by tier and organization
  creature-keywords.json   23 creature type keywords
  ability-keywords.json    9 ability type keywords
  abilities.json           Stub (future: hero abilities)
  ancestries.json          Stub (future: ancestry data)
  kits.json                Stub (future: kit data)
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
  implementation-checklist.md  Implementation roadmap
```

## License

Content is licensed under **CC-BY-4.0**. Draw Steel is a product of MCDM Productions.
See [LICENSE](LICENSE) for details.
