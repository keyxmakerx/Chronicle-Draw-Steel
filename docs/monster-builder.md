# Draw Steel Monster Builder — Design Document

> **Status:** Draft
> **Author:** Chronicle Team
> **Last Updated:** 2026-03-24
> **Related:** [Community Bestiary](../../Chronicle/docs/bestiary/design.md) | [API & Security](../../Chronicle/docs/bestiary/api-security.md) | [Foundry Sync](./foundry-creature-sync.md)

---

## 1. Overview

The Monster Builder is a fully automated creature authoring tool built into the Draw Steel system package. It provides guided creation of mechanically valid Draw Steel creatures with auto-calculated stats, ability validation, and full Foundry VTT sync as NPC actors compatible with the existing Draw Steel monster sheets.

**Inspiration:** D&D Beyond's Homebrew Monster Creator — stepped form, real-time validation, auto-calculated fields, preview-as-you-build.

### Goals

- Full mechanical intelligence: auto-calculate EV, suggest stamina/speed/stability from organization + level
- Validate creature structure (signature ability required, 3 villain actions for leaders, etc.)
- Support all 7 organization types: Minion, Horde, Platoon, Elite, Leader, Solo, Swarm
- Support all 5 roles: Brute, Controller, Defender, Harrier, Hexer
- Full Foundry VTT sync as NPC actors (see [Foundry Sync spec](./foundry-creature-sync.md))
- Publish to Community Bestiary (see [Bestiary design](../../Chronicle/docs/bestiary/design.md))

### Non-Goals (for now)

- Encounter builder (add creatures to budget) — future feature
- Automated loot/treasure tables
- AI-generated creature descriptions

---

## 2. Draw Steel Creature Mechanics Reference

### 2.1 Organizations

Organizations define a creature's power tier and how many heroes it can face.

| Organization | Hero Ratio | EV Multiplier | Villain Actions | Key Mechanic |
|---|---|---|---|---|
| **Minion** | 8:1 (squad) | level × 1 | 0 | Act in squads; squad attacks require all minions |
| **Horde** | 2:1 | level × 2 | 0 | Fragile, outnumber heroes |
| **Platoon** | 1:1 | level × 4 | 0 | Standard, well-rounded |
| **Elite** | 1:2 | level × 8 | 0 | Hardy, stands up to 2 heroes |
| **Leader** | 1:2+ | level × 8 | 3 | Buffs allies, grants actions, uses villain actions |
| **Solo** | 1:6 | level × 24 | 3 | Incredibly powerful, faces full party alone |
| **Swarm** | 1:1 | level × 4 | 0 | Multiple creatures acting as one unit |

### 2.2 Roles (Archetypes)

Roles define a creature's combat style and primary function.

| Role | Primary Function | Typical Primary Stat |
|---|---|---|
| **Brute** | High stamina, high damage, forces engagement | Might |
| **Controller** | Repositions foes, alters terrain, area control | Reason |
| **Defender** | Absorbs damage, forces enemies to target them | Might / Presence |
| **Harrier** | Mobile hit-and-run, positional advantage | Agility |
| **Hexer** | Debuffs with conditions, generally squishy | Reason / Presence |

### 2.3 Creature Keywords

Keywords define a creature's nature and may trigger special rules:

- **Accursed** — Supernaturally cursed (medusas, werewolves)
- **Undead** — Reanimated flesh/spirits (ghosts, zombies)
- **Animal** — Natural creature, animal-level sapience (bears, wolves)
- **Beast** — Animal-level sapience with supernatural abilities
- **Abyssal** — From the Abyssal Wasteland (demons, gnolls)
- **Construct** — Artificially created (golems, animated objects)
- **Dragon** — Conceptual creatures (thorn dragons, crucible dragons)
- **Elemental** — Embodiment of elemental force
- **Fey** — From the Feywild
- **Fiend** — Devils and infernal creatures
- **Giant** — Large humanoid creatures
- **Humanoid** — Human-like creatures
- **Plant** — Animate plant life

### 2.4 Statblock Components

Every Draw Steel creature has:

| Component | Type | Notes |
|---|---|---|
| **Name** | string | Creature name |
| **Level** | number | 1–20 |
| **Organization** | enum | See §2.1 |
| **Role** | enum | See §2.2 |
| **EV** | number | Encounter Value, auto-calculated |
| **Keywords** | list | See §2.3 |
| **Stamina** | number | Health pool |
| **Winded** | number | = floor(stamina / 2) |
| **Speed** | number | Movement in squares (default 5) |
| **Stability** | number | Reduces forced movement |
| **Size** | enum | T, S, M, L, H, G |
| **Characteristics** | 5 numbers | Might, Agility, Reason, Intuition, Presence (-5 to +5) |
| **Immunities** | list | e.g., "Magic 2, Psionic 3" |
| **Free Strike** | markdown | Default attack when triggered |
| **Traits** | list | Passive features |
| **Abilities** | list | Signature, actions, maneuvers, triggered actions |
| **Villain Actions** | list (0 or 3) | Leaders/Solos only: opener, crowd-control, ultimate |

### 2.5 Abilities

Each ability has:

| Field | Type | Required | Notes |
|---|---|---|---|
| **name** | string | yes | |
| **type** | enum | yes | signature, action, maneuver, triggered, villain-action |
| **keywords** | list | no | Attack, Magic, Psionic, Ranged, Area, etc. |
| **distance** | string | no | "Melee", "Ranged 10", "Area 3 within 10", etc. |
| **target** | string | no | "1 creature", "All enemies in area", etc. |
| **power_roll** | string | no | "Might vs. Agility", "Reason vs. Intuition", etc. |
| **tier1_result** | markdown | no | Result on 11 or lower |
| **tier2_result** | markdown | no | Result on 12–16 |
| **tier3_result** | markdown | no | Result on 17+ |
| **effect** | markdown | no | Non-roll effect text |
| **trigger** | string | conditional | Required for triggered actions |
| **vp_cost** | number | no | Villain Power cost to activate |
| **villain_action_order** | enum | conditional | opener, crowd-control, ultimate (required for villain actions) |

### 2.6 Villain Power (VP) System

- Director generates VP each round = 2 × number of heroes
- Monster factions award bonus VP for faction-synergistic actions
- Some abilities cost VP to activate (noted as "VP Cost: X")
- Villain Actions are separate from VP — they're free, once-per-encounter abilities

---

## 3. Entity Preset Expansion

The current `drawsteel-creature` preset is minimal. Here's the expanded version:

### 3.1 Updated Creature Entity Preset

```json
{
  "slug": "drawsteel-creature",
  "name": "Creature",
  "name_plural": "Creatures",
  "icon": "fa-paw",
  "color": "#DC2626",
  "category": "creature",
  "foundry_actor_type": "npc",
  "fields": [
    { "key": "level", "label": "Level", "type": "number", "foundry_path": "system.details.level" },
    { "key": "organization", "label": "Organization", "type": "enum", "foundry_path": "system.details.organization" },
    { "key": "role", "label": "Role", "type": "enum", "foundry_path": "system.details.role" },
    { "key": "ev", "label": "EV", "type": "number", "foundry_path": "system.details.ev" },
    { "key": "keywords", "label": "Keywords", "type": "list", "foundry_path": "system.details.keywords" },
    { "key": "faction", "label": "Faction", "type": "string" },
    { "key": "size", "label": "Size", "type": "enum", "foundry_path": "system.details.size" },
    { "key": "stamina", "label": "Stamina", "type": "number", "foundry_path": "system.stamina.max" },
    { "key": "winded", "label": "Winded Value", "type": "number", "foundry_path": "system.stamina.winded" },
    { "key": "speed", "label": "Speed", "type": "number", "foundry_path": "system.movement.speed" },
    { "key": "stability", "label": "Stability", "type": "number", "foundry_path": "system.stability.value" },
    { "key": "might", "label": "Might", "type": "number", "foundry_path": "system.characteristics.might" },
    { "key": "agility", "label": "Agility", "type": "number", "foundry_path": "system.characteristics.agility" },
    { "key": "reason", "label": "Reason", "type": "number", "foundry_path": "system.characteristics.reason" },
    { "key": "intuition", "label": "Intuition", "type": "number", "foundry_path": "system.characteristics.intuition" },
    { "key": "presence", "label": "Presence", "type": "number", "foundry_path": "system.characteristics.presence" },
    { "key": "immunities", "label": "Immunities", "type": "list" },
    { "key": "free_strike", "label": "Free Strike", "type": "markdown" },
    { "key": "traits", "label": "Traits", "type": "markdown" },
    { "key": "abilities_json", "label": "Abilities", "type": "string" },
    { "key": "villain_actions_json", "label": "Villain Actions", "type": "string" }
  ]
}
```

**Notes:**
- `abilities_json` and `villain_actions_json` store structured JSON as strings. The builder widget parses/renders these. This avoids needing new Chronicle field types.
- `foundry_path` annotations enable the generic Foundry adapter for flat fields. Structured fields (abilities, villain actions) require the dedicated creature sync endpoint (see [Foundry Sync spec](./foundry-creature-sync.md)).
- `organization` and `role` use the `enum` field type. Enum values are defined in the reference data, not the preset itself.

### 3.2 New Reference Category: Creature Abilities

```json
{
  "slug": "creature-abilities",
  "name": "Creature Abilities",
  "icon": "fa-burst",
  "fields": [
    { "key": "type", "label": "Type", "type": "enum" },
    { "key": "keywords", "label": "Keywords", "type": "list" },
    { "key": "distance", "label": "Distance", "type": "string" },
    { "key": "target", "label": "Target", "type": "string" },
    { "key": "power_roll", "label": "Power Roll", "type": "string" },
    { "key": "tier1_result", "label": "Tier 1 (≤11)", "type": "markdown" },
    { "key": "tier2_result", "label": "Tier 2 (12–16)", "type": "markdown" },
    { "key": "tier3_result", "label": "Tier 3 (17+)", "type": "markdown" },
    { "key": "effect", "label": "Effect", "type": "markdown" },
    { "key": "vp_cost", "label": "VP Cost", "type": "number" },
    { "key": "trigger", "label": "Trigger", "type": "string" },
    { "key": "villain_action_order", "label": "VA Order", "type": "enum" }
  ]
}
```

This category holds example/template abilities that users can browse and use as starting points in the builder.

---

## 4. Organization Templates (Auto-Fill Data)

File: `data/organization-templates.json`

These provide the auto-calculation baselines for the builder. When a user selects an organization and level, stats are pre-filled from these formulas.

### 4.1 EV Formulas

| Organization | EV Formula |
|---|---|
| Minion | level × 1 |
| Horde | level × 2 |
| Platoon | level × 4 |
| Elite | level × 8 |
| Leader | level × 8 |
| Solo | level × 24 |
| Swarm | level × 4 |

### 4.2 Stamina Baselines

Formula: `base + (level × multiplier)`

| Organization | Base | Per-Level Multiplier | Example L5 |
|---|---|---|---|
| Minion | 5 | 2 | 15 |
| Horde | 8 | 3 | 23 |
| Platoon | 20 | 6 | 50 |
| Elite | 40 | 10 | 90 |
| Leader | 40 | 10 | 90 |
| Solo | 80 | 20 | 180 |
| Swarm | 20 | 6 | 50 |

### 4.3 Default Speed/Stability by Organization

| Organization | Default Speed | Default Stability |
|---|---|---|
| Minion | 5 | 0 |
| Horde | 5 | 0 |
| Platoon | 5 | 1 |
| Elite | 5 | 2 |
| Leader | 5 | 2 |
| Solo | 6 | 3 |
| Swarm | 5 | 0 |

### 4.4 Characteristic Suggestions by Role

These are starting-point suggestions, not requirements. Users can freely adjust.

| Role | MGT | AGI | RSN | INT | PRS | Notes |
|---|---|---|---|---|---|---|
| Brute | +3 | +0 | -1 | +0 | +1 | High might, tanky |
| Controller | -1 | +0 | +3 | +1 | +0 | Battlefield manipulation |
| Defender | +2 | -1 | +0 | +0 | +2 | Taunts, absorbs hits |
| Harrier | +0 | +3 | +0 | +1 | -1 | Mobile, positional |
| Hexer | -1 | +0 | +2 | +0 | +2 | Debuffs, conditions |

**Level scaling for characteristics:** Add +1 to primary stat at levels 4, 8, 12, 16, 20. Add +1 to secondary stat at levels 6, 12, 18.

### 4.5 Free Strike Defaults

Formula: `level + primary_characteristic_modifier` damage, melee range 1.

Example: Level 5 Brute (Might +4) → Free Strike: 9 damage.

### 4.6 Ability Damage Baselines

Power roll tier damage scales by level and organization:

| Organization | T1 (≤11) | T2 (12–16) | T3 (17+) |
|---|---|---|---|
| Minion | level × 1 | level × 1 | level × 2 |
| Horde | level × 1 | level × 2 | level × 3 |
| Platoon | level × 2 | level × 3 | level × 4 |
| Elite | level × 2 | level × 4 | level × 6 |
| Leader | level × 2 | level × 4 | level × 6 |
| Solo | level × 3 | level × 5 | level × 8 |
| Swarm | level × 2 | level × 3 | level × 4 |

---

## 5. Validation Rules

The builder enforces these rules in real-time as the user builds:

### 5.1 Errors (Block Save)

| Rule ID | Rule | Condition |
|---|---|---|
| E001 | Signature ability required | `abilities.filter(a => a.type === 'signature').length === 0` |
| E002 | Leaders must have 3 villain actions | `org === 'leader' && villain_actions.length !== 3` |
| E003 | Solos must have 3 villain actions | `org === 'solo' && villain_actions.length !== 3` |
| E004 | VA order must be unique | Duplicate opener/crowd-control/ultimate |
| E005 | VA order must be complete | Missing any of opener/crowd-control/ultimate |
| E006 | Name is required | `name.trim() === ''` |
| E007 | Level must be 1–20 | `level < 1 \|\| level > 20` |
| E008 | Organization is required | `organization === ''` |
| E009 | Role is required | `role === ''` |
| E010 | Stamina must be positive | `stamina <= 0` |

### 5.2 Warnings (Allow Save, Show Advisory)

| Rule ID | Rule | Condition |
|---|---|---|
| W001 | Non-leaders/solos shouldn't have VAs | `org not in ['leader', 'solo'] && villain_actions.length > 0` |
| W002 | EV deviates from formula | `abs(ev - calculated_ev) / calculated_ev > 0.1` |
| W003 | Stamina deviates from baseline | `abs(stamina - baseline) / baseline > 0.3` |
| W004 | Free strike missing | `free_strike.trim() === ''` |
| W005 | Swarm should have area abilities | `org === 'swarm' && !abilities.some(a => a.keywords.includes('Area'))` |
| W006 | No abilities defined | `abilities.length === 0` |

### 5.3 Info (Suggestions Only)

| Rule ID | Rule | Condition |
|---|---|---|
| I001 | Characteristic sum advisory | Total modifier sum outside expected range for organization |
| I002 | Minion squad size suggestion | Show recommended squad size for level |
| I003 | Damage baseline hint | Show expected damage ranges per tier for this level/org |

---

## 6. Builder Widget

### 6.1 Widget Registration

File: `widgets/monster-builder.js`

The widget registers via `Chronicle.register()` and uses the existing Chronicle widget API to:
- Read/write entity custom fields via the entity API
- Fetch reference data (organization templates, keywords, ability templates)
- Present a stepped form UI

### 6.2 UI Flow

The builder uses a stepped form with 7 sections:

1. **Identity** — Name, level, size, faction, keywords
2. **Organization & Role** — Radio select with description cards, auto-sets EV
3. **Statistics** — Auto-filled stamina/speed/stability/characteristics with deviation warnings
4. **Abilities** — Add/edit/remove abilities with structured sub-form (power roll tiers, effects)
5. **Free Strike** — Auto-generated default, editable
6. **Villain Actions** — (Conditional: only shown for Leader/Solo) — Three-slot editor with order labels
7. **Traits** — Free-form list of passive features

### 6.3 Auto-Calculation Engine

The widget's JS implements these calculations client-side:

```
calculateEV(level, organization):
  return level * EV_MULTIPLIERS[organization]

calculateStamina(level, organization):
  return STAMINA_BASE[organization] + (level * STAMINA_PER_LEVEL[organization])

calculateWinded(stamina):
  return Math.floor(stamina / 2)

suggestCharacteristics(role, level):
  base = ROLE_CHARACTERISTICS[role]
  // Add +1 to primary at levels 4, 8, 12, 16, 20
  // Add +1 to secondary at levels 6, 12, 18
  return scaledCharacteristics

calculateFreeStrike(level, characteristics, role):
  primaryStat = ROLE_PRIMARY_STAT[role]
  return level + characteristics[primaryStat]

suggestAbilityDamage(level, organization, tier):
  return level * DAMAGE_MULTIPLIERS[organization][tier]
```

### 6.4 Statblock Preview

The builder includes a "Preview Statblock" mode that renders the creature as a formatted Draw Steel statblock, matching the official formatting:

```
┌─────────────────────────────────────────────┐
│ CREATURE NAME                               │
│ Level X [Organization] [Role]               │
│ EV X • [Keyword, Keyword]                   │
├─────────────────────────────────────────────┤
│ STM: XX  │  SPD: X  │  STAB: X  │  Size: M │
│ MGT: +X  AGI: +X  RSN: +X  INT: +X  PRS: +X│
│ Immunities: Magic X, Psionic X              │
├─────────────────────────────────────────────┤
│ ★ SIGNATURE ABILITY NAME                    │
│   [Keywords] • Distance • Target            │
│   Power Roll + X vs. [Characteristic]       │
│   ≤11: [result] │ 12–16: [result]           │
│   17+: [result]                             │
│   Effect: [text]                            │
│                                             │
│ ABILITY NAME                                │
│   [Keywords] • Distance • Target            │
│   ...                                       │
├─────────────────────────────────────────────┤
│ VILLAIN ACTIONS                             │
│ ① Opener: [Name]                            │
│   [description]                             │
│ ② Crowd Control: [Name]                     │
│   [description]                             │
│ ③ Ultimate: [Name]                          │
│   [description]                             │
├─────────────────────────────────────────────┤
│ TRAITS                                      │
│ • [Trait]: [description]                    │
│ • [Trait]: [description]                    │
├─────────────────────────────────────────────┤
│ FREE STRIKE: X damage                       │
└─────────────────────────────────────────────┘
```

### 6.5 Statblock Renderer Widget

File: `widgets/statblock-renderer.js`

A separate, read-only widget that renders any creature entity as a formatted statblock. Can be placed on entity pages via the template editor. Reads from entity custom fields and renders the statblock card.

---

## 7. Reference Data Files

### 7.1 File Inventory

| File | Purpose |
|---|---|
| `data/organization-templates.json` | EV formulas, stamina baselines, speed/stability defaults |
| `data/role-templates.json` | Characteristic suggestions per role |
| `data/creature-keywords.json` | Keyword definitions and special rules |
| `data/creature-abilities.json` | Example/template abilities for reference |
| `data/creatures.json` | Official Draw Steel creatures (populated over time) |
| `data/ability-keywords.json` | Ability keyword definitions (Attack, Magic, Psionic, Ranged, Area, etc.) |
| `data/damage-baselines.json` | Expected damage per tier by level and organization |

### 7.2 Data Format

All reference data files follow Chronicle's standard format:

```json
[
  {
    "id": "unique-slug",
    "name": "Display Name",
    "description": "Description text with **markdown** support.",
    "properties": {
      "key": "value"
    }
  }
]
```

---

## 8. Open Questions

1. **Minion squad mechanics:** Should the builder support defining squad attack abilities (where all minions contribute)? Or just individual minion statblocks?

2. **Swarm damage scaling:** Swarms in Draw Steel deal more damage at higher stamina. Should the builder auto-generate "while above winded" / "while below winded" damage variants?

3. **Creature art:** Should the builder integrate with Chronicle's media system for creature artwork, or just a URL field?

4. **Ability templates library:** How many pre-built ability templates should we ship? Should abilities be fork-able from the reference data?

5. **Version compatibility:** If the Draw Steel Foundry system updates its NPC data model, how do we handle backwards compatibility in the sync adapter?

---

## 9. Dependencies

| Dependency | In | Notes |
|---|---|---|
| `enum` field type in manifest | Chronicle Core | Currently supported per ValidFieldTypes |
| `list` field type in manifest | Chronicle Core | Currently supported |
| `markdown` field type in manifest | Chronicle Core | Currently supported |
| Widget JS API | Chronicle Core | Existing Chronicle.register() system |
| Entity custom fields API | Chronicle Core | Existing sync API |
| Structured creature sync | Chronicle Core | **NEW** — needed for Foundry abilities/VAs |
| Community Bestiary addon | Chronicle Core | **NEW** — needed for publishing |
