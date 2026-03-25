# Chronicle-Draw-Steel — Project Handoff Document

> **Date:** 2026-03-25
> **Repo:** `keyxmakerx/Chronicle-Draw-Steel`
> **Branch:** `claude/consolidate-repos-AVzyM` (all work is here, up to date with remote)
> **GitHub:** `keyxmakerx/chronicle-draw-steel`

---

## 1. What Is This Project?

A **Game System Content Pack** for the [Chronicle](https://github.com/keyxmakerx) platform, providing **Draw Steel RPG** (by MCDM Productions) support. It includes:

- Entity presets for heroes and creatures
- Reference data (organizations, roles, keywords, damage baselines)
- Three interactive widgets for creature management
- Design docs and a 5-phase implementation roadmap

Draw Steel is a tabletop RPG. This package lets Chronicle users create, browse, and manage creatures with full mechanical intelligence (auto-calculated stats, validation, etc.) and eventually sync them to Foundry VTT.

---

## 2. Project Status

### Phases Complete

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ Complete | Foundation — manifest, data files, monster builder, statblock renderer |
| **Phase 2** | ✅ Complete | Polish — level scaling, damage hints, preview, encounter calc, example creatures |
| **Bestiary Browser** | ✅ Complete | Added as bonus widget (not in original checklist) |

### Phases Remaining (require OTHER repos)

| Phase | Status | Repo Needed | Description |
|-------|--------|-------------|-------------|
| **Phase 3** | ❌ Not started | `Chronicle` (Go backend) + `Chronicle-Foundry-Module` (JS) | Foundry VTT creature sync — bidirectional NPC actor sync |
| **Phase 4** | ❌ Not started | `Chronicle` (Go backend) | Community Bestiary — publish/browse/rate/import creatures, DB migrations, API routes, moderation |
| **Phase 5** | ❌ Not started | New repo (`Chronicle-Hub`) | Federation hub for cross-instance sharing (future/SaaS) |

**Important:** Phases 3-5 cannot be done in this repo. They require changes to the Chronicle Go backend and Foundry module. See `docs/implementation-checklist.md` for the full breakdown of what each phase needs.

---

## 3. File Inventory

### Root
| File | Purpose |
|------|---------|
| `manifest.json` (195 lines) | Package manifest — categories, entity presets, relation presets, widget registrations |
| `CLAUDE.md` | AI coding guidelines (large file strategy, widget patterns) |
| `README.md` | User-facing package overview |
| `LICENSE` | CC-BY-4.0 |

### `widgets/` — Interactive Widgets (all ES5 JavaScript)
| File | Lines | Purpose |
|------|-------|---------|
| `monster-builder.js` | 1190 | 7-step creature authoring form with auto-calculation, validation, preview, encounter calculator |
| `bestiary-browser.js` | 867 | D&D Beyond-style browsable creature catalog with filtering, search, card grid, modal statblocks |
| `statblock-renderer.js` | 216 | Read-only formatted creature statblock display |

### `data/` — Reference JSON Data
| File | Lines | Purpose |
|------|-------|---------|
| `organization-templates.json` | 88 | 7 organization types (minion, horde, platoon, elite, leader, solo, swarm) with EV/stamina/speed formulas |
| `role-templates.json` | 67 | 5 roles (brute, controller, defender, harrier, hexer) with characteristic baselines |
| `creature-keywords.json` | 25 | 23 creature keywords (Undead, Dragon, Humanoid, etc.) |
| `ability-keywords.json` | 11 | 9 ability keywords (Attack, Melee, Ranged, Magic, etc.) |
| `damage-baselines.json` | 12 | Damage per tier per organization for ability suggestions |
| `creature-abilities.json` | 82 | 7 template abilities (signature, maneuver, triggered, villain-action) |
| `creatures.json` | 187 | 7 example creatures (one per organization type) |
| `abilities.json` | 1 | Stub (empty array) |
| `ancestries.json` | 1 | Stub (empty array) |
| `kits.json` | 1 | Stub (empty array) |

### `docs/` — Design Documents
| File | Purpose |
|------|---------|
| `monster-builder.md` | Full Monster Builder design doc — mechanics reference, formulas, validation rules |
| `foundry-creature-sync.md` | Foundry VTT sync specification — field mappings, statblock assembly |
| `implementation-checklist.md` | 5-phase implementation roadmap with atomic tasks (Phase 1-2 checked off) |

---

## 4. Architecture & Patterns

### Widget Pattern
All widgets follow the same pattern:
```javascript
Chronicle.register('widget-slug', {
  init: function (el, config) {
    // el = DOM element to render into
    // config = { campaignId, entityId, source, ... } from manifest config
    this.el = el;
    this.config = config;
    // Load data, then render
  },
  destroy: function (el) {
    el.innerHTML = '';
  },
  // Private methods prefixed with _
  _render: function () { ... },
  _loadData: function () { ... }
});
```

### Key APIs
- `Chronicle.apiFetch(url, options)` — Authenticated fetch wrapper
- `Chronicle.escapeHtml(string)` — XSS-safe HTML escaping
- `fetch(base + 'data/filename.json')` — Load extension asset data

### Extension Asset Base Path
```javascript
var base = this.config.campaignId
  ? '/api/v1/campaigns/' + this.config.campaignId + '/extensions/drawsteel/assets/'
  : '/extensions/drawsteel/assets/';
```

### Code Style
- **ES5 only** — `var` not `let/const`, `function` not arrow functions
- **No build step** — Raw JS files loaded directly by Chronicle
- **No framework** — Pure DOM manipulation
- **CSS** — Injected as `<style>` tag in widget (bestiary-browser) or inline styles (monster-builder)
- **XSS safety** — Always use `Chronicle.escapeHtml()` when inserting user data into HTML

---

## 5. Monster Builder — Key Mechanics

### Auto-Calculation Engine (`_recalcAuto()` in monster-builder.js)
When organization, role, or level changes, the following are auto-calculated:
- **EV** = `organization.ev_multiplier × level`
- **Stamina** = `organization.stamina_base + (stamina_per_level × level)`
- **Winded** = `floor(stamina / 2)`
- **Speed** = `organization.default_speed`
- **Stability** = `organization.default_stability`
- **Characteristics** = role base values + level scaling:
  - Primary stat: +1 at levels 4, 8, 12, 16, 20
  - Secondary stat (2nd highest in role): +1 at levels 6, 12, 18
- **Free Strike** = `level + primary_characteristic_modifier` damage

### Validation Rules
- **E-rules (block save):** Name required, level 1-20, org/role required, stamina positive, signature ability required, leaders/solos need 3 villain actions
- **W-rules (warnings):** EV/stamina deviation from formula, missing free strike, no abilities, swarms should have area abilities
- See `docs/monster-builder.md` §5 for full rule table

### Data Flow
1. User fills form → creature object updated in memory
2. `_recalcAuto()` fires on org/role/level change
3. `_renderValidation()` checks rules on every step render
4. Save serializes to Chronicle entity API: `PUT /api/v1/campaigns/{id}/entities/{id}`
5. Abilities stored as `abilities_json` (JSON string), villain actions as `villain_actions_json`

---

## 6. Bestiary Browser — Key Architecture

### Two Data Sources
1. **Campaign mode** (`source: "campaign"`): Loads entities from `GET /api/v1/campaigns/{id}/entities?preset=drawsteel-creature`, filters client-side
2. **Bestiary mode** (`source: "bestiary"`): Calls `GET /bestiary?limit=500` — **this API does not exist yet** (Phase 4). Falls back gracefully with "not available" message.

### Filtering
All client-side after initial load:
- Text search (name, faction, keywords — case-insensitive substring)
- Organization (single-select, exact match on slug)
- Role (single-select, exact match on slug)
- Level range (min/max, 1-20)
- Keywords (multi-select, OR within dimension, AND across dimensions)
- Sort: level-asc, level-desc, name-az, name-za, ev-desc
- Pagination: configurable per_page, default 20

### CSS Classes
All prefixed `bb-` (bestiary browser). Card left-border color-coded by organization.

---

## 7. Entity Preset Schema

The `drawsteel-creature` preset has these custom fields (defined in manifest.json):

| Field | Type | Foundry Path |
|-------|------|-------------|
| level | number | system.details.level |
| organization | string | system.details.organization |
| role | string | system.details.role |
| ev | number | system.details.ev |
| size | string | system.details.size |
| keywords | string | system.details.keywords |
| faction | string | — |
| stamina | number | system.stamina.max |
| winded | number | system.stamina.winded |
| speed | number | system.movement.speed |
| stability | number | system.stability.value |
| might | number | system.characteristics.might |
| agility | number | system.characteristics.agility |
| reason | number | system.characteristics.reason |
| intuition | number | system.characteristics.intuition |
| presence | number | system.characteristics.presence |
| immunities | string | — |
| free_strike | string | system.combat.freeStrike |
| traits | string | — |
| abilities_json | string | — |
| villain_actions_json | string | — |

Fields with `foundry_path` map to Foundry VTT actor data for Phase 3 sync. Fields without a path are Chronicle-only or need the structured sync endpoint.

---

## 8. Organization Templates Quick Reference

| Slug | Name | EV Formula | Stamina Formula | Speed | Stability | Hero Ratio |
|------|------|-----------|----------------|-------|-----------|------------|
| minion | Minion | level × 1 | 5 + 2/level | 5 | 0 | 8:1 |
| horde | Horde | level × 2 | 8 + 3/level | 5 | 0 | 2:1 |
| platoon | Platoon | level × 4 | 10 + 5/level | 5 | 0 | 1:1 |
| elite | Elite | level × 8 | 14 + 7/level | 5 | 2 | 1:2 |
| leader | Leader | level × 12 | 16 + 8/level | 5 | 2 | 1:4 |
| solo | Solo | level × 12 | 20 + 10/level | 6 | 3 | 1:4 |
| swarm | Swarm | level × 4 | 10 + 5/level | 5 | 0 | 1:1 |

---

## 9. Role Templates Quick Reference

| Slug | Primary Stat | MGT | AGI | RSN | INT | PRS |
|------|-------------|-----|-----|-----|-----|-----|
| brute | might | +3 | 0 | -1 | 0 | +1 |
| controller | reason | -1 | 0 | +3 | +1 | 0 |
| defender | might | +2 | -1 | 0 | 0 | +2 |
| harrier | agility | 0 | +3 | 0 | +1 | -1 |
| hexer | reason | -1 | 0 | +2 | 0 | +2 |

Level scaling: Primary gets +1 at levels 4, 8, 12, 16, 20. Secondary (2nd highest) gets +1 at levels 6, 12, 18.

---

## 10. Git History

```
fc8432b Complete Phase 2: auto-calculation polish, preview, encounter calc, example creatures
cc2fcac Add CLAUDE.md with large file strategy and project conventions
d9ece3f Add bestiary browser widget with filtering, search, and statblock modals
92c131a Complete monster builder widget and add statblock renderer
977366c Merge pull request #1 from keyxmakerx/claude/update-base-fix-css-aJyt8
58d03ee Phase 1.2: Complete Monster Builder - Steps 5-7, validation, save
4e34176 Phase 1.2: Monster Builder widget - core scaffold + steps 1-4
746cac0 Phase 1.1: Expand creature preset, add reference data files
7b0b1ff Add design docs for Monster Builder, Foundry creature sync, and implementation checklist
49c1dab Add Draw Steel system package with manifest, stub data, and Foundry annotations
```

All work is on branch `claude/consolidate-repos-AVzyM`, pushed and up to date with remote.

---

## 11. What's Next (For the Next AI/Developer)

### If staying in this repo:
- **Nothing major left.** Phases 1-2 are complete. The stub data files (`abilities.json`, `ancestries.json`, `kits.json`) could be populated if Draw Steel CC-BY-4.0 content is available for those categories, but that's optional.
- Could add more example creatures to `data/creatures.json`
- Could add a "support" role template (mentioned in some Draw Steel discussions but not in the current 5-role set)

### If working on Phase 3 (Foundry Sync):
- **Repo:** Chronicle (Go backend) + Chronicle-Foundry-Module (JS)
- **Spec:** `docs/foundry-creature-sync.md`
- **Checklist:** `docs/implementation-checklist.md` items 3.1.1 through 3.2.4
- Need to create: `creature_routes.go`, `creature_statblock.go` in Chronicle's syncapi plugin
- Need to create: `syncCreature()` function in Foundry module
- Field mappings are already defined in manifest.json `foundry_path` annotations

### If working on Phase 4 (Community Bestiary):
- **Repo:** Chronicle (Go backend)
- **Checklist:** `docs/implementation-checklist.md` items 4.1.1 through 4.6.3
- Requires: DB migrations, Go service layer, API routes, frontend templates
- The bestiary browser widget is already wired to call `GET /bestiary` — once the backend exists, it works
- Need to add "Publish to Bestiary" button in monster-builder.js (item 4.5.6)

---

## 12. Known Gotchas

1. **Large file writes break AI assistants.** Files over ~200 lines should be written as skeleton first, then filled in with incremental edits. See `CLAUDE.md`.

2. **ES5 only.** No `let`, `const`, arrow functions, template literals, destructuring, etc. The widgets must work in Chronicle's runtime which may not support modern JS.

3. **No build step.** Files are loaded as-is. No bundler, no transpiler, no minifier.

4. **`abilities_json` and `villain_actions_json` are JSON strings**, not objects. They must be `JSON.parse()`'d when reading and `JSON.stringify()`'d when writing. This is because Chronicle's entity custom fields don't support nested objects natively.

5. **The bestiary API (`GET /bestiary`) does not exist yet.** The bestiary-browser widget handles this gracefully by catching the error and showing a message. Campaign mode works fine.

6. **Organization "leader" and "solo" share the same EV multiplier (×12).** They're mechanically distinguished by villain actions (both get 3) and different stamina/speed/stability values.

7. **The `damage-baselines.json` format** is base values at level 1 + a `per_level` multiplier, NOT the simple `level × N` multipliers shown in the design doc. The actual formula used in code: `baseline.tierN + (baseline.per_level × (level - 1))`.

---

## 13. Testing Checklist

Since there's no test framework, validation is manual:

- [ ] `node -c widgets/monster-builder.js` — syntax check
- [ ] `node -c widgets/bestiary-browser.js` — syntax check
- [ ] `node -c widgets/statblock-renderer.js` — syntax check
- [ ] `python3 -m json.tool manifest.json` — JSON validation
- [ ] `python3 -m json.tool data/creatures.json` — JSON validation
- [ ] Load monster builder widget in Chronicle → all 7 steps render
- [ ] Change org/role/level → stats auto-recalculate with level scaling
- [ ] Step 4: damage baseline hints appear below tier inputs
- [ ] Step 4: "Use Template" shows template picker, selecting copies to form
- [ ] Click "Preview Statblock" → formatted statblock renders
- [ ] Encounter calculator shows correct creature counts
- [ ] Save creature → entity updated via API
- [ ] Load bestiary browser with `source: "campaign"` → cards render
- [ ] Filter by org, role, level range, keywords → grid updates
- [ ] Search → debounced filtering works
- [ ] Click card → modal opens with full statblock
- [ ] Escape key / click backdrop → modal closes
- [ ] Pagination works with >20 results
