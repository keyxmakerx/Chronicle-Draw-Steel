# Draw Steel Monster Builder

> **Related:** [Community Bestiary](https://github.com/keyxmakerx/Chronicle/blob/dfc73c78/docs/bestiary/design.md) | [API & Security](https://github.com/keyxmakerx/Chronicle/blob/dfc73c78/docs/bestiary/api-security.md) | [Foundry Sync](./foundry-creature-sync.md)

---

## 1. Overview

A Draw Steel creature lives on a Creature page in Chronicle. The package gives
that page two things:

- **The stat block** (`widgets/statblock-renderer.js`), mounted under the
  page title as a game-system panel. Everyone who can see the page sees the
  stat block; the director also gets **Edit stat block** and **Publish**.
- **The editor** (`widgets/monster-builder.js`), one page that opens in place
  of the stat block: the creature's boxes on the left, and a side panel with
  the party, the encounter budget and the completeness checks on the right.

EV, Stamina, free strike and formula damage follow the published formulas as
the director changes level, organization or role, and each figure says where
it came from. A number the director types is never overwritten.

### Goals

- Every figure a published formula covers is that formula's, and says so.
- Where no formula covers a figure (Swarm, or Stamina without a role), the
  director sets it, and the page says so instead of guessing.
- Start a creature from the community bestiary or from this campaign's
  creatures; the copy is recomputed for the level kept.
- Publish to the Community Bestiary, and add a bestiary creature to the
  campaign from the Draw Steel browser.

### Non-Goals (for now)

- Balance checking beyond the published encounter bands.
- Automated loot/treasure tables.
- AI-generated creature descriptions.

---

## 2. Draw Steel Creature Mechanics Reference

### 2.1 Organizations

Organizations define a creature's power tier and how many heroes it can face.

> **The "EV Multiplier" column is not Draw Steel's.** The published encounter
> value is `((2 × level) + 4) × organization modifier` (minion and horde 0.5,
> platoon 1, elite and leader 2, solo 6) — see `data/monster-building.json`,
> `encounter-value-formula`. The multipliers below are this package's own and run
> up to 1.67× the published value; they are kept here only because they still
> appear in `organization-templates.json` as `ev_multiplier`. **Swarm** is not a
> published organization at all — it is a creature keyword — so it has no
> published modifier: the director sets a swarm's EV and Stamina, and the page
> says so.

| Organization | Hero Ratio | EV Multiplier (unsourced — see above) | Villain Actions | Key Mechanic |
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

| Role | Primary Function | Primary Stat |
|---|---|---|
| **Ambusher** | Strikes from concealment with devastating opening attacks; high burst | Agility |
| **Artillery** | Deals heavy damage at range but vulnerable in melee; stays behind the line | Reason |
| **Brute** | High damage, tough, but slow or predictable; frontline powerhouse | Might |
| **Controller** | Manipulates the battlefield with conditions and forced movement | Reason |
| **Defender** | Tanky front-liner that protects allies and controls space | Might |
| **Harrier** | Fast, mobile striker that darts in and out of combat | Agility |
| **Hexer** | Debuffer and condition specialist, often ranged or magical | Reason |
| **Mount** | Carries a rider, granting enhanced mobility and synergy bonuses | Might |
| **Support** | Heals, buffs, or repositions allies rather than dealing direct damage | Presence |

_Generated from `data/role-templates.json` (`description` + `primary_stat`); the data file is authoritative._

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
| **type** | enum | yes | signature, action, maneuver, triggered |
| **keywords** | list | no | Melee, Ranged, Strike, Area, Magic, Psionic, etc. |
| **distance** | string | no | "Melee 1", "Ranged 10", "3 burst", etc. |
| **target** | string | no | "One creature", "Each enemy in the area", etc. |
| **power_roll** | string | no | "2d10 + 3"; a numeric bonus shows the tier odds |
| **tier1** | markdown | no | Result on 11 or lower |
| **tier2** | markdown | no | Result on 12–16 |
| **tier3** | markdown | no | Result on 17+ |
| **effect** | markdown | no | Non-roll effect text |
| **trigger** | string | conditional | For triggered actions |
| **spend_vp** | number | no | Malice the director spends for the extra effect |
| **auto_damage** | boolean | no | The tiers' leading damage follows the published formula |

Villain actions are stored separately (`villain_actions_json`) as
`{ order, name, effect }`, with `order` one of opener, crowd-control, ultimate.

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

## 4. The Published Formulas

The builder and the stat block evaluate the published Draw Steel formulas only
through `DrawSteelFormulas` in `widgets/monster-engine.js`, reading
`data/organization-templates.json`, `data/role-templates.json`,
`data/monster-building.json` and `data/encounter-building.json`:

| Figure | Published formula |
|---|---|
| Encounter value | `ceil(((2 × level) + 4) × organization modifier)` |
| Stamina | `ceil(((10 × level) + role modifier) × Stamina organization modifier)` |
| Ability damage | `ceil((4 + level + damage modifier) × tier modifier)`, halved for horde and minion |
| Free strike | the tier 1 ability damage |
| Highest characteristic | `1 + echelon`, +1 for leaders and solos, at most +5 |
| Party encounter strength | `4 + (2 × hero level)` per hero, summed |

A strike adds the creature's highest characteristic to its damage, and its
power roll is `2d10 +` that characteristic. Winded is half Stamina, rounded down.

Where a formula cannot be evaluated — **Swarm** has no published modifiers, and
the Stamina formula needs a role (leaders and solos take theirs from the table)
— the figure is left empty for the director to set, and the editor says
"No published … for this creature. Set it yourself." Nothing is estimated.
See CLAUDE.md → "The builder's math must carry its own provenance".

### 4.1 Where each figure came from

The stat block marks EV, Stamina and free strike:

| Mark | Meaning |
|---|---|
| Tick | The figure is the published formula's. |
| Pen | The director changed it; the explanation names the formula's number. |
| None | No formula covers it, or the formula data did not load (no mark may imply a check that never ran). |

In the editor the same facts sit under each box: "Published formula",
"Changed by you (the formula gives N) · Use the formula", or "No published …
Set it yourself." Clearing a box hands the figure back to the formula.

### 4.2 Default Speed/Stability by Organization

| Organization | Default Speed | Default Stability |
|---|---|---|
| Minion | 5 | 0 |
| Horde | 5 | 0 |
| Platoon | 5 | 1 |
| Elite | 5 | 2 |
| Leader | 5 | 2 |
| Solo | 6 | 3 |
| Swarm | 5 | 0 |

### 4.3 Characteristic Suggestions by Role

These are starting-point suggestions, not requirements. Users can freely adjust.

| Role | MGT | AGI | RSN | INT | PRS | Primary |
|---|---|---|---|---|---|---|
| Ambusher | +1 | +3 | +0 | +1 | -2 | Agility |
| Artillery | -2 | +1 | +3 | +0 | +1 | Reason |
| Brute | +3 | +0 | -1 | +0 | +1 | Might |
| Controller | -1 | +0 | +3 | +1 | +0 | Reason |
| Defender | +2 | -1 | +0 | +0 | +2 | Might |
| Harrier | +0 | +3 | +0 | +1 | -1 | Agility |
| Hexer | -1 | +0 | +2 | +0 | +2 | Reason |
| Mount | +2 | +1 | -2 | +1 | -1 | Might |
| Support | -1 | +0 | +1 | +1 | +3 | Presence |

_Generated from `data/role-templates.json` (`characteristics` + `primary_stat`); the data file is authoritative._

---

## 5. Completeness Checks

The side panel is titled **Completeness checks** and always carries the line
"These check the stat block is filled in. They don't judge whether the fight
is balanced." Its rows:

| Severity | When |
|---|---|
| ok / miss | One row per thing the stat block needs, ticked or flagged: a name, an organization, a role (except leaders and solos), a signature ability, a leader's or solo's villain actions, EV, Stamina, a free strike. |
| warn | EV or Stamina differs from the published formula (citing its number), or the highest characteristic differs from the published one. Never raised against a figure no formula covers. |
| provenance | A figure no formula covers, named, or the formula module did not load. |

The **encounter budget** reads the campaign's heroes, shows the published
party encounter strength and its bands (Monsters Book ch. 8), and places this
creature's EV on the meter. Creature counts and the rest of the fight are not
checked. **Suggest a level, organization and role for this party** applies
`MonsterEngine.suggest` and shows its reasons; the formulas fill the rest.

---

## 6. The Widgets

### 6.1 Stat block panel

`widgets/statblock-renderer.js` registers `statblock-renderer` and is declared
in `manifest.json` → `entity_panels` with `applies_to: "npc"`, so Chronicle
mounts it under the title of NPC-family pages. It shows itself only on the
campaign's Creature pages (the type whose preset category is `creature`), or
on any page that already has a stat block. A player sees nothing on a creature
with no stat block; the director sees **Build its stat block**.

In page-layout mode Chronicle draws entity panels only where the layout places
the **Game System Panels** block. Chronicle placed that block once in existing
NPC-family types; a creature type created later must have it added in the
layout editor.

The panel's global `DrawSteelStatblock` is the one stat block drawing used by
the panel, the editor's preview, the Draw Steel browser's bestiary modal and,
in compact mode, a hover card. It reads both a page's `fields_data` and a
bestiary `statblock_json` (`normalize`), and writes either shape back
(`toFields`, `toStatblock`). Styles go into `<head>` once.

### 6.2 Editor

`widgets/monster-builder.js` defines `DrawSteelCreatureEditor`. The panel's
**Edit stat block** mounts it in place; Save writes the page's fields and
redraws the stat block. Cancel asks before dropping changes.

Every ability opens in a small form. A signature strike is added first, with
**Damage follows the published formula** on: its tiers' leading number tracks
the formula, and any words after it ("; push 2") are kept.

**Start from…** offers the community bestiary (every Draw Steel creature
published there) and this campaign's creatures. The copy is named "X (copy)",
keeps its level, and is recomputed: stale figures are replaced, and abilities
whose tiers look like formula damage are switched to follow it.

The widget also registers `monster-builder` for placement on a page; on a page
that already has the stat block panel it steps aside.

### 6.3 Publishing

**Publish** posts the creature to the Community Bestiary
(`POST /bestiary`, private or public) with the page as its source.
In the Draw Steel browser's bestiary tab, **Add to this campaign** creates a
Creature page with every stat block field filled.

---

## 7. Reference Data Files

| File | Purpose |
|---|---|
| `data/organization-templates.json` | Published organization modifiers, speed/stability defaults |
| `data/role-templates.json` | Published role modifiers, characteristic suggestions |
| `data/monster-building.json` | Published monster formulas |
| `data/encounter-building.json` | Published encounter strength and budget bands |
| `data/creature-keywords.json` | Keyword definitions and special rules |
| `data/creature-abilities.json` | Example/template abilities for reference |
| `data/creatures.json` | 35 example creatures, figures per the published formulas (`tools/test-creature-examples.mjs`) |
| `data/ability-keywords.json` | Ability keyword definitions |

Data format: `docs/DATA-SCHEMA.md`.

---

## 8. Open Questions

Open work: #54.

---

## 9. Dependencies

| Dependency | In | Notes |
|---|---|---|
| `entity_panels` in the manifest | Chronicle Core | Mounts the stat block under NPC-family page titles |
| Widget JS API | Chronicle Core | `Chronicle.register()` |
| Entity custom fields API | Chronicle Core | Reads and writes `fields_data` |
| Community Bestiary addon | Chronicle Core | `internal/plugins/bestiary`: search, stat block, publish |
| Structured creature sync | Chronicle Core | Needed for Foundry abilities and villain actions |
