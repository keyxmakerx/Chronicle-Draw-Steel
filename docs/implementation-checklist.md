# Monster Builder & Community Bestiary — Implementation Checklist

> **Status:** Draft
> **Last Updated:** 2026-03-24
> **Branches:** `claude/fix-unifi-timeout-YxMXa` on all repos

This is the sprint-by-sprint implementation guide. If work is interrupted, pick up from the first unchecked item in the current phase. Each item is atomic and can be committed independently.

---

## Phase 1: Foundation — Draw Steel Package (Monster Builder MVP)

**Goal:** Expanded creature preset, reference data files, basic builder widget.
**Repo:** `Chronicle-Draw-Steel`
**Depends on:** Nothing (pure package changes)

### 1.1 Manifest & Data Expansion

- [ ] **1.1.1** Update `drawsteel-creature` entity preset in `manifest.json`
  - Add fields: organization, keywords, faction, size, winded, immunities, free_strike, traits, abilities_json, villain_actions_json
  - Add `foundry_actor_type: "npc"`
  - Add `foundry_path` annotations for all flat fields
  - **File:** `manifest.json` lines 88–107
  - **Test:** Run manifest validation (if available) or manually verify JSON

- [ ] **1.1.2** Add `creature-abilities` reference category to manifest
  - Fields: type, keywords, distance, target, power_roll, tier results, effect, vp_cost, trigger, villain_action_order
  - **File:** `manifest.json` categories array

- [ ] **1.1.3** Create `data/organization-templates.json`
  - 7 organization entries (minion, horde, platoon, elite, leader, solo, swarm)
  - Each with: ev_multiplier, stamina_base, stamina_per_level, default_speed, default_stability, villain_action_count, hero_ratio description
  - **File:** `data/organization-templates.json` (new)

- [ ] **1.1.4** Create `data/role-templates.json`
  - 5 role entries (brute, controller, defender, harrier, hexer)
  - Each with: characteristic suggestions, primary_stat, description
  - **File:** `data/role-templates.json` (new)

- [ ] **1.1.5** Create `data/creature-keywords.json`
  - All creature keywords from §2.3 of monster-builder.md
  - Each with: name, description, special_rules (if any)
  - **File:** `data/creature-keywords.json` (new)

- [ ] **1.1.6** Create `data/ability-keywords.json`
  - Ability keywords: Attack, Magic, Psionic, Ranged, Area, Melee, Weapon, etc.
  - Each with: name, description
  - **File:** `data/ability-keywords.json` (new)

- [ ] **1.1.7** Create `data/damage-baselines.json`
  - Damage multipliers per tier per organization (from monster-builder.md §4.6)
  - **File:** `data/damage-baselines.json` (new)

- [ ] **1.1.8** Populate `data/creature-abilities.json` with example abilities
  - At least 5 template abilities (one per role archetype)
  - Signature abilities, a maneuver, a triggered action
  - **File:** `data/creature-abilities.json` (currently empty)

### 1.2 Builder Widget

- [ ] **1.2.1** Create `widgets/monster-builder.js` — scaffold and registration
  - Chronicle.register() boilerplate
  - Widget container HTML structure
  - Step navigation (7 steps)
  - **File:** `widgets/monster-builder.js` (new)

- [ ] **1.2.2** Implement Step 1: Identity
  - Name input, level number input (1–20), size enum dropdown, faction text input
  - Keyword multi-select from creature-keywords reference data
  - **Depends on:** 1.1.5

- [ ] **1.2.3** Implement Step 2: Organization & Role
  - Radio card selectors for organization (7 options) and role (5 options)
  - Description text and hero ratio shown per selection
  - Auto-calculate EV on selection change
  - Load templates from organization-templates.json
  - **Depends on:** 1.1.3, 1.1.4

- [ ] **1.2.4** Implement Step 3: Statistics
  - Auto-fill stamina, speed, stability from organization template
  - Auto-fill characteristics from role template
  - Winded auto-calculated from stamina
  - Deviation warnings (stamina ±30% from baseline)
  - Editable — user can override all auto-filled values
  - Immunities multi-entry (type + value pairs)

- [ ] **1.2.5** Implement Step 4: Abilities
  - Add/edit/remove ability sub-form
  - Fields: name, type (dropdown), keywords (multi-select), distance, target
  - Power roll field: characteristic vs. characteristic
  - Three tier result textareas (T1 ≤11, T2 12–16, T3 17+)
  - Effect textarea
  - Trigger field (shown only for triggered type)
  - VP cost field (optional)
  - Damage baseline hints shown per tier
  - **Depends on:** 1.1.6, 1.1.7

- [ ] **1.2.6** Implement Step 5: Free Strike
  - Auto-calculated default: level + primary stat modifier
  - Editable override text field
  - **Depends on:** 1.2.3 (needs organization + role context)

- [ ] **1.2.7** Implement Step 6: Villain Actions (conditional)
  - Only shown when organization is "leader" or "solo"
  - Three fixed slots: Opener, Crowd Control, Ultimate
  - Each slot: name, description textarea, optional power roll + tiers
  - **Depends on:** 1.2.3

- [ ] **1.2.8** Implement Step 7: Traits
  - Dynamic list of name + description pairs
  - Add/remove trait buttons
  - Markdown support in description

- [ ] **1.2.9** Implement validation panel
  - Real-time validation against all E-rules and W-rules from monster-builder.md §5
  - Error/warning/info icons with messages
  - Block save on E-rule violations

- [ ] **1.2.10** Implement save/load
  - Save creature data to entity custom fields via Chronicle entity API
  - Serialize abilities to `abilities_json` string field
  - Serialize villain actions to `villain_actions_json` string field
  - Load existing creature data when editing

- [ ] **1.2.11** Register widget in manifest.json
  - Add monster-builder to widgets array
  - **File:** `manifest.json`

### 1.3 Statblock Renderer Widget

- [ ] **1.3.1** Create `widgets/statblock-renderer.js`
  - Read-only statblock display widget
  - Reads from entity custom fields
  - Renders formatted statblock card (see monster-builder.md §6.4)
  - **File:** `widgets/statblock-renderer.js` (new)

- [ ] **1.3.2** Register statblock-renderer widget in manifest.json
  - **File:** `manifest.json`

### Phase 1 Commit Checkpoint
- [ ] **1.C** Commit all Phase 1 changes, push to `claude/fix-unifi-timeout-YxMXa`

---

## Phase 2: Validation & Automation Polish

**Goal:** Complete mechanical intelligence, example creatures.
**Repo:** `Chronicle-Draw-Steel`
**Depends on:** Phase 1

- [ ] **2.1** Implement full auto-calculation engine in builder widget
  - EV calculation with all organization formulas
  - Stamina suggestion with level scaling
  - Characteristic scaling by level (+1 at levels 4,8,12,16,20 primary; 6,12,18 secondary)
  - Free strike damage calculation
  - Ability damage baseline suggestions per tier
  - Winded auto-calculation

- [ ] **2.2** Implement ability template library
  - "Use Template" button in ability editor
  - Browse ability templates from creature-abilities reference data
  - Copy template into ability, user can modify
  - **Depends on:** 1.1.8

- [ ] **2.3** Implement statblock preview mode
  - Toggle between builder form and formatted statblock preview
  - Preview updates live as user edits
  - Copy-to-clipboard for statblock text

- [ ] **2.4** Add encounter budget calculator panel
  - Shows EV of current creature
  - "How many of these vs. X heroes at level Y?" calculator
  - Uses EV formulas from organization-templates

- [ ] **2.5** Populate `data/creatures.json` with official example creatures
  - At least 7 examples (one per organization type)
  - Sourced from CC-BY-4.0 Draw Steel content only
  - **File:** `data/creatures.json`

### Phase 2 Commit Checkpoint
- [ ] **2.C** Commit all Phase 2 changes, push

---

## Phase 3: Foundry VTT Creature Sync

**Goal:** Creatures sync as NPC actors to Foundry.
**Repos:** `Chronicle` (core), `Chronicle-Foundry-Module`, `Chronicle-Draw-Steel`
**Depends on:** Phase 1

### 3.1 Chronicle Core — Structured Sync Endpoint

- [ ] **3.1.1** Create `internal/plugins/syncapi/creature_routes.go`
  - `GET /sync/creatures/:entityId/statblock` handler
  - `POST /sync/creatures/:entityId/statblock` handler
  - Register routes in syncapi plugin
  - **Repo:** `Chronicle`

- [ ] **3.1.2** Create `internal/plugins/syncapi/creature_statblock.go`
  - Statblock assembly: entity fields → structured JSON
  - Statblock disassembly: structured JSON → entity fields
  - Power roll string parsing ("Might vs. Agility" → `{characteristic, against}`)
  - Villain action order mapping (string ↔ integer)
  - **Repo:** `Chronicle`

- [ ] **3.1.3** Add permission check for creature sync
  - Reuse existing sync API key + campaign validation
  - Add category check: entity must be creature type
  - **Repo:** `Chronicle`

- [ ] **3.1.4** Write unit tests for statblock assembly/disassembly
  - Round-trip test: assemble → disassemble → compare
  - Edge cases: empty abilities, no villain actions, missing fields
  - **Repo:** `Chronicle`

### 3.2 Foundry Module — Creature Sync Handler

- [ ] **3.2.1** Add creature detection logic
  - Check entity type slug or category to determine creature vs character
  - **Repo:** `Chronicle-Foundry-Module`

- [ ] **3.2.2** Add `syncCreature()` function
  - Call structured creature endpoint
  - Create/update NPC actor with full system data
  - **Repo:** `Chronicle-Foundry-Module`

- [ ] **3.2.3** Add reverse sync hook for NPC actors
  - `Hooks.on('updateActor')` for NPC type actors
  - Reconstruct statblock from actor data
  - POST to Chronicle's creature sync endpoint
  - **Repo:** `Chronicle-Foundry-Module`

- [ ] **3.2.4** Manual integration test with live Foundry + Draw Steel system
  - Create creature → sync → verify NPC sheet
  - Modify in Foundry → verify Chronicle updated

### Phase 3 Commit Checkpoints
- [ ] **3.C1** Commit Chronicle core changes, push
- [ ] **3.C2** Commit Foundry module changes, push

---

## Phase 4: Community Bestiary (Local Sharing)

**Goal:** Users can publish, browse, rate, import, and moderate creatures.
**Repo:** `Chronicle`
**Depends on:** Phase 1

### 4.1 Database

- [ ] **4.1.1** Create migration: `XXXXXX_add_bestiary.up.sql`
  - Tables: bestiary_publications, bestiary_ratings, bestiary_favorites, bestiary_imports, bestiary_moderation_log
  - Indexes and constraints per design.md §3
  - **File:** `db/migrations/XXXXXX_add_bestiary.up.sql` (new)

- [ ] **4.1.2** Create down migration: `XXXXXX_add_bestiary.down.sql`
  - Drop tables in reverse order
  - **File:** `db/migrations/XXXXXX_add_bestiary.down.sql` (new)

### 4.2 Service Layer

- [ ] **4.2.1** Create `internal/plugins/bestiary/model.go`
  - Struct definitions: BestiaryPublication, BestiaryRating, BestiaryFavorite, BestiaryImport, ModerationLogEntry
  - Visibility enum, moderation action enum
  - **File:** new

- [ ] **4.2.2** Create `internal/plugins/bestiary/store.go`
  - Database access layer (CRUD operations)
  - Parameterized queries for all operations
  - Full-text search with sanitized input
  - Pagination with cursor support
  - **File:** new

- [ ] **4.2.3** Create `internal/plugins/bestiary/service.go`
  - Business logic layer
  - Publish flow with validation
  - Import flow with entity creation
  - Rating aggregation (atomic updates)
  - Auto-flag at 3 flags
  - Slug generation with collision handling
  - **File:** new

- [ ] **4.2.4** Create `internal/plugins/bestiary/validation.go`
  - Statblock JSON schema validation
  - Text field sanitization
  - Size limit checks
  - Enum validation
  - **File:** new

### 4.3 API Routes

- [ ] **4.3.1** Create `internal/plugins/bestiary/routes.go`
  - All public browsing routes (GET)
  - All authenticated action routes (POST/PUT/DELETE/PATCH)
  - All admin routes
  - **File:** new

- [ ] **4.3.2** Create `internal/plugins/bestiary/handlers.go`
  - Handler functions for all routes
  - Request parsing and response formatting
  - **File:** new

- [ ] **4.3.3** Create `internal/plugins/bestiary/middleware.go`
  - Rate limiting per endpoint per user
  - IDOR checks (publication creator, campaign role)
  - Self-rating prevention
  - **File:** new

### 4.4 Addon Registration

- [ ] **4.4.1** Register bestiary as Chronicle addon
  - Addon slug: `bestiary`
  - Add to addon seeds
  - Per-campaign enable/disable
  - **File:** `internal/plugins/addons/` (modify existing)

- [ ] **4.4.2** Wire bestiary plugin into app startup
  - Register routes, run migrations
  - **File:** `internal/app/` or equivalent plugin registry

### 4.5 Frontend (Templates/JS)

- [ ] **4.5.1** Create bestiary browse page
  - Card grid layout with creature summary cards
  - Search bar + filter dropdowns (level, organization, role, tags)
  - Sort tabs (trending, newest, top rated, most imported)
  - Pagination
  - **Files:** templates + static JS

- [ ] **4.5.2** Create publication detail page
  - Statblock preview
  - Creator info + link to profile
  - Rating display + rate action
  - Import to campaign button with campaign picker
  - Fork & Edit button
  - Flag button
  - Reviews section
  - **Files:** templates + static JS

- [ ] **4.5.3** Create "My Creations" page
  - List of user's publications (all states)
  - Edit/delete/change visibility actions
  - Stats (downloads, rating, favorites)
  - **Files:** templates + static JS

- [ ] **4.5.4** Create creator profile page
  - Display name, avatar, join date
  - Publication count, total downloads, average rating
  - Paginated publication list
  - **Files:** templates + static JS

- [ ] **4.5.5** Create admin moderation page
  - Flagged publications queue
  - Approve/archive/unflag actions with reason input
  - Moderation log viewer
  - **Files:** templates + static JS

- [ ] **4.5.6** Add "Publish to Bestiary" button to Monster Builder widget
  - Opens publish dialog with description, tags, visibility
  - Calls POST /bestiary with statblock from current entity
  - **File:** `widgets/monster-builder.js` (modify)
  - **Depends on:** Phase 1, 4.3.1

### 4.6 Tests

- [ ] **4.6.1** Unit tests for validation.go
  - Schema validation, sanitization, edge cases

- [ ] **4.6.2** Unit tests for service.go
  - Publish flow, import flow, rating aggregation, slug generation

- [ ] **4.6.3** Integration tests for API routes
  - Happy path for all endpoints
  - Permission denied cases
  - Rate limiting
  - IDOR checks

### Phase 4 Commit Checkpoints
- [ ] **4.C1** Commit DB migration, push
- [ ] **4.C2** Commit service + store + validation, push
- [ ] **4.C3** Commit routes + handlers + middleware, push
- [ ] **4.C4** Commit frontend templates, push
- [ ] **4.C5** Commit tests, push

---

## Phase 5: Federation Hub (Future — Separate Project)

**Goal:** Central hub for cross-instance sharing. Potential SaaS.
**Repo:** New repo (`Chronicle-Hub` or similar)
**Depends on:** Phase 4

> This phase is a separate project. Documenting here for continuity.

- [ ] **5.1** Design hub service architecture (separate Go service or Chronicle "hub mode")
- [ ] **5.2** Implement instance registration + API key exchange
- [ ] **5.3** Implement publish-to-hub flow with HMAC content signing
- [ ] **5.4** Implement hub search/browse with aggregated ratings
- [ ] **5.5** Implement import-from-hub flow
- [ ] **5.6** Implement creator profiles + analytics dashboard
- [ ] **5.7** Implement monetization tiers (free/creator/instance)
- [ ] **5.8** Implement moderation at scale (report, review, takedown)
- [ ] **5.9** Deploy hub service
- [ ] **5.10** Add hub integration to Chronicle core (settings, sync, UI)

---

## Quick Reference: File Inventory

### New Files — Chronicle-Draw-Steel

| File | Phase | Description |
|---|---|---|
| `docs/monster-builder.md` | Pre | Monster Builder design doc |
| `docs/foundry-creature-sync.md` | Pre | Foundry sync spec |
| `docs/implementation-checklist.md` | Pre | This file |
| `data/organization-templates.json` | 1.1.3 | Organization auto-fill data |
| `data/role-templates.json` | 1.1.4 | Role characteristic suggestions |
| `data/creature-keywords.json` | 1.1.5 | Creature keyword definitions |
| `data/ability-keywords.json` | 1.1.6 | Ability keyword definitions |
| `data/damage-baselines.json` | 1.1.7 | Damage per tier per org |
| `widgets/monster-builder.js` | 1.2.1 | Builder widget |
| `widgets/statblock-renderer.js` | 1.3.1 | Statblock display widget |

### New Files — Chronicle

| File | Phase | Description |
|---|---|---|
| `docs/bestiary/design.md` | Pre | Bestiary design doc |
| `docs/bestiary/api-security.md` | Pre | API & security spec |
| `db/migrations/XXXXXX_add_bestiary.up.sql` | 4.1.1 | Bestiary DB tables |
| `db/migrations/XXXXXX_add_bestiary.down.sql` | 4.1.2 | Bestiary rollback |
| `internal/plugins/bestiary/model.go` | 4.2.1 | Data models |
| `internal/plugins/bestiary/store.go` | 4.2.2 | Database access |
| `internal/plugins/bestiary/service.go` | 4.2.3 | Business logic |
| `internal/plugins/bestiary/validation.go` | 4.2.4 | Input validation |
| `internal/plugins/bestiary/routes.go` | 4.3.1 | Route definitions |
| `internal/plugins/bestiary/handlers.go` | 4.3.2 | Request handlers |
| `internal/plugins/bestiary/middleware.go` | 4.3.3 | Rate limiting, auth |
| `internal/plugins/syncapi/creature_routes.go` | 3.1.1 | Creature sync routes |
| `internal/plugins/syncapi/creature_statblock.go` | 3.1.2 | Statblock transform |

### Modified Files — Chronicle-Draw-Steel

| File | Phase | Description |
|---|---|---|
| `manifest.json` | 1.1.1, 1.1.2, 1.2.11, 1.3.2 | Expanded preset + categories + widgets |
| `data/creature-abilities.json` | 1.1.8 | Populated with examples |
| `data/creatures.json` | 2.5 | Populated with examples |

### Modified Files — Chronicle-Foundry-Module

| File | Phase | Description |
|---|---|---|
| (sync handler file) | 3.2.1–3.2.3 | Creature sync logic |

---

## Sprint Pickup Guide

**If you're resuming work after an interruption:**

1. Check which branch you're on: `git branch` (should be `claude/fix-unifi-timeout-YxMXa`)
2. Check git status: `git status` and `git log --oneline -5`
3. Find the first unchecked `[ ]` item in this checklist
4. Read the referenced design doc section for context
5. Implement the item
6. Commit at the checkpoint marker (`X.C`)
7. Continue to next unchecked item

**Key design docs to re-read:**
- Monster Builder mechanics: `docs/monster-builder.md` §2–4
- Bestiary data model: `Chronicle/docs/bestiary/design.md` §3
- API security: `Chronicle/docs/bestiary/api-security.md` §3
- Foundry sync mapping: `docs/foundry-creature-sync.md` §4
