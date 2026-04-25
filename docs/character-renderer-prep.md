# Draw Steel Character Renderer — Prep Artifacts

> **Status:** Pre-CH4 design input. Not authoritative until Chronicle's
> renderer-block-registration interface (CH4) lands.
> **Audience:** Chronicle dev (during CH4 plan-mode session) and Draw
> Steel dev (during DS-CH1 implementation).

This document captures two pieces of preparation work that don't depend
on CH4's exact shape:

1. [Entity-preset gap audit](#1-entity-preset-gap-audit) — what fields
   the `drawsteel-character` preset is missing for a complete character
   render.
2. [Default character layout proposal](#2-default-character-layout-proposal)
   — what blocks the character page should have, in what order, with
   what config.

Both are data artifacts. Whatever interface CH4 settles on, the field
list and layout shape transfer.

---

## 1. Entity-preset gap audit

### Existing fields (`manifest.json` `drawsteel-character`)

15 fields, all good and all retained:

```
class, ancestry, level, kit,
might, agility, reason, intuition, presence,
stamina_max, stamina_current, recoveries, speed, stability, wealth
```

### Gap categories

Fields are sorted by priority. **Must-have** is what the V1 character
page needs to render correctly. **Nice-to-have** are common enough to
include but not blocking. **Session-state** is data that mutates
mid-encounter and may belong somewhere other than the entity row (e.g.
an encounter-tracker table) — flagged for chronicle-dev decision.

#### Must-have (V1 character page can't render correctly without these)

| Field | Type | Foundry path (Draw Steel system) | Notes |
|---|---|---|---|
| `subclass` | string | `system.details.subclass` | Class often gates abilities by subclass |
| `portrait_url` | string | `prototypeToken.texture.src` (or `img`) | URL or asset path |
| `faction` | string | `system.details.faction` | Mirrors creature preset |
| `winded` | number | `system.stamina.winded` | Cached (= `floor(stamina_max / 2)`); used heavily |
| `recoveries_max` | number | `system.recoveries.max` | Current-only is in preset; need max for the bar |
| `heroic_resource_name` | string | `system.hero.resource.name` | Per-class label (drama / focus / fury / heroism …) |
| `heroic_resource_current` | number | `system.hero.resource.value` | Resets per encounter |
| `heroic_resource_max` | number | `system.hero.resource.max` | Often dynamic; snapshot for display |
| `immunities` | string (JSON) | `system.damage.immunities` | Mirror creature pattern: `[{type, value}]` |
| `weaknesses` | string (JSON) | `system.damage.weaknesses` | Mirror creature pattern: `[{type, value}]` |
| `abilities_json` | string (JSON) | `items` filtered to ability type | Same shape as creature `abilities_json` |
| `class_features_json` | string (JSON) | `items` filtered to feature/class | Array of `{name, level, description, source}` |
| `ancestry_features_json` | string (JSON) | `items` filtered to feature/ancestry | Same shape |
| `kit_features_json` | string (JSON) | `items` filtered to kit | Same shape; one entry usually |

#### Nice-to-have

| Field | Type | Notes |
|---|---|---|
| `surges` | number | Per-encounter surge pool current value |
| `surges_max` | number | Often class-defined |
| `temporary_stamina` | number | Buff state, transient but commonly displayed |
| `victories` | number | Campaign-track for hero progression |
| `xp` | number | Standard progression number |
| `renown` | number | Negotiation-with-orgs currency |
| `project_points` | number | Project system currency |
| `skills_json` | string (JSON) | Trained skills as slug array, optionally with bonuses |
| `languages` | string (JSON) | Array of language slugs |
| `notes` | string | Long-text markdown, backstory + GM-shared notes |

#### Session-state (chronicle-dev decision)

These mutate mid-encounter. Carrying them on the entity row is the
simplest path but couples encounter state to entity state. Flagging
for the chronicle dev to decide whether they belong here, on a sibling
encounter-state row, or on a new "session" entity altogether.

| Field | Belongs on entity? |
|---|---|
| `conditions` (JSON: `[slug, …]`) | Likely no — should be encounter-scoped |
| Active hero-resource value during combat | Likely no |
| Temporary stamina | Maybe — same lifetime as conditions |

Recommendation: ship the must-have list on the entity preset and defer
session-state to a follow-up. The page can render those as "—" if
absent.

### Foundry sync impact

For each new field with a `foundry_path`, the existing sync mechanism
(`scripts/sync-manager.mjs` mapping by `foundry_system_id` and
`foundry_path`) carries them automatically once added to the preset.
No new sync code required — just preset edits.

Fields without a Foundry path (`heroic_resource_*` if not in a fixed
location, `notes`, `victories`, `xp`, `renown`, `project_points`) are
chronicle-native. The Foundry module won't try to sync them.

### Migration to add fields

`entity_presets` lives in `manifest.json` and is interpreted at package
install / upgrade time by chronicle's package loader. Adding fields is
a manifest edit, not a DB migration; the chronicle host adopts the new
preset on the next package reload.

Existing entity rows store `custom_fields` as a JSON blob keyed by
field slug, so new field keys just appear as `undefined` on old rows
and render as defaults — no data backfill needed.

---

## 2. Default character layout proposal

### Layout philosophy

- **Cards stack top-to-bottom.** Mobile reflow is the default; on
  wide viewports we go two-column for the upper third (header
  alongside vitals).
- **Each block has one job.** No mega-cards.
- **Reuse the bestiary visual language.** Same `--color-accent`
  consumption, `--font-campaign` headings, `mb-card` containers. A
  player who knows the bestiary should feel at home here.
- **Optional blocks degrade silently.** If `surges` is absent the
  surges chip is hidden; the block stays.

### Proposed block list

Reading order from top:

1. **header** — portrait, name, level, ancestry, class, kit, faction
2. **vitals** — stamina bar (current / max / winded), recoveries,
   surges, temp stamina
3. **characteristics** — 5 stats in a row, each with prominent number
4. **heroic_resource** — current / max with the class-specific name
5. **movement** — speed, stability, immunities, weaknesses
6. **abilities** — grid grouped by type (signature first, then
   action, maneuver, triggered, free-strike, trait); chips for
   keywords; expanded effect on click
7. **features** — three-tab carousel: class features / ancestry
   features / kit features (or three separate stacked cards on
   mobile)
8. **progression** — xp, victories, renown, project points (small
   chips, single line)
9. **inventory** — list rendered from `has-item` relations to other
   entities (chronicle plumbs this)
10. **notes** — long-text markdown render

### Layout JSON shape (proposed)

The exact key names depend on CH4. This is a strawman that the
chronicle dev can rewrite during the CH4 plan session. Keys that need
chronicle-dev confirmation are flagged with `// TBD`.

```json
{
  "version": 1,
  "preset": "drawsteel-character",
  "blocks": [
    {
      "type": "blockDrawSteelHeader",
      "config": {
        "name_field": "name",
        "level_field": "level",
        "ancestry_field": "ancestry",
        "class_field": "class",
        "subclass_field": "subclass",
        "kit_field": "kit",
        "faction_field": "faction",
        "portrait_field": "portrait_url"
      }
    },
    {
      "type": "blockResourceBar",
      "config": {
        "label": "Stamina",
        "current_field": "stamina_current",
        "max_field": "stamina_max",
        "threshold_field": "winded",
        "threshold_label": "Winded",
        "temp_field": "temporary_stamina"
      }
    },
    {
      "type": "blockResourceChips",
      "config": {
        "chips": [
          { "label": "Recoveries", "current_field": "recoveries", "max_field": "recoveries_max" },
          { "label": "Surges", "current_field": "surges", "max_field": "surges_max" }
        ]
      }
    },
    {
      "type": "blockDrawSteelCharacteristics",
      "config": {
        "fields": ["might", "agility", "reason", "intuition", "presence"]
      }
    },
    {
      "type": "blockResourceBar",
      "config": {
        "label_field": "heroic_resource_name",
        "label_fallback": "Heroic Resource",
        "current_field": "heroic_resource_current",
        "max_field": "heroic_resource_max"
      }
    },
    {
      "type": "blockDrawSteelMovement",
      "config": {
        "speed_field": "speed",
        "stability_field": "stability",
        "immunities_field": "immunities",
        "weaknesses_field": "weaknesses"
      }
    },
    {
      "type": "blockDrawSteelAbilities",
      "config": {
        "abilities_field": "abilities_json",
        "group_by": "type",
        "type_order": ["signature", "action", "maneuver", "triggered", "free-strike", "trait"]
      }
    },
    {
      "type": "blockDrawSteelFeatureTabs",
      "config": {
        "tabs": [
          { "label": "Class", "field": "class_features_json" },
          { "label": "Ancestry", "field": "ancestry_features_json" },
          { "label": "Kit", "field": "kit_features_json" }
        ]
      }
    },
    {
      "type": "blockChipRow",
      "config": {
        "chips": [
          { "label": "XP", "field": "xp" },
          { "label": "Victories", "field": "victories" },
          { "label": "Renown", "field": "renown" },
          { "label": "Project Points", "field": "project_points" },
          { "label": "Wealth", "field": "wealth" }
        ]
      }
    },
    {
      "type": "blockInventoryRelations",
      "config": {
        "relation_slug": "has-item"
      }
    },
    {
      "type": "blockMarkdown",
      "config": {
        "field": "notes",
        "label": "Notes"
      }
    }
  ]
}
```

### Block-type taxonomy (input to CH4)

The block types above split into two buckets:

**Generic** — chronicle ships these as defaults, any system package can
configure them:

- `blockResourceBar` — labeled bar with current/max + optional
  threshold marker + optional temp overlay. Drives stamina, heroic
  resource, anything bar-shaped.
- `blockResourceChips` — row of small `(label, current, max)` chips.
- `blockChipRow` — row of `(label, value)` chips.
- `blockInventoryRelations` — list rendered from a relation slug.
- `blockMarkdown` — markdown render of a string field.

**System-specific** — Draw Steel ships these via CH4's registration
interface:

- `blockDrawSteelHeader` — portrait + identity strip (could be
  generic if `blockHeader` accepts enough config; system-specific
  feels safer for typography choices).
- `blockDrawSteelCharacteristics` — 5-stat row with edges/banes
  affordance.
- `blockDrawSteelMovement` — speed + stability + damage table.
- `blockDrawSteelAbilities` — abilities grid grouped by Draw Steel
  ability types.
- `blockDrawSteelFeatureTabs` — tabbed class/ancestry/kit features.

### CH4 design constraints (input from Draw Steel)

These are the constraints the registration interface must support to
make the above buildable:

1. **Block configs are JSON.** No code in the layout. A field map per
   block lets one block type render many entity types.
2. **Blocks read from `custom_fields` keys by slug.** Same shape we use
   today.
3. **Blocks can read multiple fields.** Some need `current`, `max`,
   and `threshold`.
4. **Blocks can read related entities.** `blockInventoryRelations`
   needs to enumerate entities related via a relation slug.
5. **A package can register a block-type implementation.** Draw Steel
   needs to ship `blockDrawSteelStatBlock` and friends; the
   registration must scope per-package and not clash with other system
   packages.
6. **Layouts are per-preset and per-package.** Draw Steel ships the
   layout above as the default for `drawsteel-character`; chronicle
   ships an even simpler default (`blockChipRow`-only) for
   `drawsteel-character`-less environments.
7. **Layout overrides are user-editable.** A campaign owner should be
   able to swap blocks or reorder them. (Lower priority for V1; a
   chronicle-side question, not Draw Steel's.)

### Out of scope for V1

- Edit-in-place on the character page. (Players still hit the existing
  entity edit form to update fields.)
- Power-roll buttons on abilities. (Phase 2; needs a dice integration.)
- Encounter-state tracking (active conditions, current heroic-resource
  during play, temporary stamina). Flagged in the audit's
  session-state section.
- Per-character custom layouts. V1 is one layout per preset.

---

## What this unlocks

For the **Chronicle dev** during CH4 plan-mode:
- Concrete block-type list to drive the registration-interface design.
- Confirmed need for both generic and system-specific blocks.
- A field-map config pattern (`{current_field, max_field}`) that
  handles every block above.

For the **Draw Steel dev** during DS-CH1:
- Field list to add to the preset before / alongside the renderer
  work.
- Layout shape to register against once CH4 lands.
- Block-type taxonomy split between "use chronicle's generic" and
  "implement system-specific".

For the **user**:
- Visibility into the proposed character page before any code is
  written.
- Audit trail — every preset gap traced to a render need.

Iterate freely on this doc; nothing is locked in. The Draw Steel dev
will revisit it during DS-CH1 once the chronicle dev's CH4 lands.
