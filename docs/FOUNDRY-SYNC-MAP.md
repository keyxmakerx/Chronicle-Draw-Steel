# Foundry ↔ Chronicle Sync Map (Draw Steel hero)

> Reference for the Draw Steel system package. Maps the Draw Steel Foundry VTT actor
> data model (`MetaMorphic-Digital/draw-steel`, actor type `hero`) onto Chronicle
> character entity fields.

## 1. Overview

Chronicle's character sync is **manifest-driven**: the generic adapter reads
`foundry_path`, `foundry_collection`, and `foundry_item_fields` annotations on each
Chronicle field and walks the Foundry document accordingly. There are **zero hardcoded
mappings** in the adapter — everything is declared in the manifest. The Foundry actor
type is **`hero`**. A key consequence of Draw Steel's design is that many "identity"
concepts a worldbuilder thinks of as character attributes (class, level, ancestry,
career, kit, heroic-resource name) are **embedded Items on the actor**, not actor-level
scalars. Those require `foundry_collection` + `foundry_item_fields` projections rather
than a simple `foundry_path`.

---

## 2. Confirmed scalar paths

Direct `foundry_path` reads off the `system` object of the `hero` actor.

| Chronicle field | `foundry_path` | Notes |
|---|---|---|
| Might | `system.characteristics.might.value` | ✅ |
| Agility | `system.characteristics.agility.value` | ✅ |
| Reason | `system.characteristics.reason.value` | ✅ |
| Intuition | `system.characteristics.intuition.value` | ✅ |
| Presence | `system.characteristics.presence.value` | ✅ |
| Stamina (current) | `system.stamina.value` | ✅ |
| Stamina (temporary) | `system.stamina.temporary` | ✅ |
| Stamina (max) | `system.stamina.max` | ⚠️ **DERIVED / read-only** — pull only, never push |
| Winded | *(derived from stamina)* | ⚠️ **DERIVED / read-only** — pull only |
| Recoveries (current) | `system.recoveries.value` | ✅ |
| Recoveries (max) | `system.recoveries.max` | ✅ |
| Heroic resource (current) | `system.hero.primary.value` | ✅ Current value of the primary heroic resource |
| Surges | `system.hero.surges` | ✅ |
| Speed | `system.movement.value` | ✅ |
| Disengage | `system.movement.disengage` | ✅ |
| Stability | `system.combat.stability` | ✅ |
| Size | `system.combat.size.value` | ✅ |
| Potency (weak) | `system.potency.weak` | ⚠️ **DERIVED / read-only** — pull only |
| Potency (average) | `system.potency.average` | ⚠️ **DERIVED / read-only** — pull only |
| Potency (strong) | `system.potency.strong` | ⚠️ **DERIVED / read-only** — pull only |
| Victories | `system.hero.victories` | ✅ |
| Wealth | `system.hero.wealth` | ✅ |
| Renown | `system.hero.renown` | ✅ |
| XP | `system.hero.xp` | ✅ |
| Biography / backstory | `system.biography.value` | ✅ |
| GM / Director notes | `system.biography.director` | ✅ **GM-only** — gate visibility |
| Languages | `system.biography.languages` | ⚠️ **inferred** path |
| Damage immunities (all) | `system.damage.immunities.all` | ✅ |
| Damage weaknesses (all) | `system.damage.weaknesses.all` | ✅ |

---

## 3. Embedded-Item paths

These are **NOT actor scalars**. Read them from the actor's embedded items collection
(`foundry_collection: items`) filtered by item `type`, projecting sub-fields with
`foundry_item_fields`. For the display name, read the item's top-level `name`.

| Chronicle field | Item `type` | Field within item | Notes |
|---|---|---|---|
| Class (name) | `class` | `name` | ✅ |
| **Level** | `class` | `system.class.system.level` | ✅ **CRITICAL** — level lives on the class item, not the actor |
| **Heroic resource name** | `class` | `system.class.system.primary` | ✅ **CRITICAL** — HR name lives on the class item |
| Subclass (name) | `subclass` | `name` | ✅ |
| Ancestry (name) | `ancestry` | `name` | ✅ |
| Career (name) | `career` | `name` | ✅ |
| Culture (name) | `culture` | `name` | ✅ |
| Kit (name) | `kit` | `name` | ✅ |
| Kit — melee damage tier 1 | `kit` | `system.bonuses.melee.damage.tier1` | ✅ |
| Kit — melee damage tier 2 | `kit` | `system.bonuses.melee.damage.tier2` | ✅ |
| Kit — melee damage tier 3 | `kit` | `system.bonuses.melee.damage.tier3` | ✅ |
| Kit — ranged damage tier 1 | `kit` | `system.bonuses.ranged.damage.tier1` | ✅ |
| Kit — ranged damage tier 2 | `kit` | `system.bonuses.ranged.damage.tier2` | ✅ |
| Kit — ranged damage tier 3 | `kit` | `system.bonuses.ranged.damage.tier3` | ✅ |
| Kit — melee distance | `kit` | `system.bonuses.melee.distance` | ✅ |
| Kit — ranged distance | `kit` | `system.bonuses.ranged.distance` | ✅ |
| Kit — stability bonus | `kit` | `system.bonuses.stability` | ✅ |
| Kit — speed bonus | `kit` | `system.bonuses.speed` | ✅ |
| Kit — stamina bonus | `kit` | `system.bonuses.stamina` | ✅ |
| Kit — disengage bonus | `kit` | `system.bonuses.disengage` | ✅ |

> Note on `foundry_item_single` collapse: when a class/ancestry/etc. is expected to be a
> single item, the adapter collapses the matching items to one record. The collapse uses
> the **first projection field by insertion order** — declare your projection fields
> intentionally (see Gotchas).

---

## 4. Ability items

Abilities are embedded items of `type: ability` (`foundry_collection: items`, filter
`type == ability`). Without an explicit `foundry_item_fields` projection, abilities sync
as **names only**. To capture mechanics, project these sub-fields:

| Sub-field | Path within ability item | Notes |
|---|---|---|
| Name | `name` | ✅ |
| Keywords | `system.keywords` | ⚠️ **Set** — serialize to array |
| Action type | `system.type` | ✅ (e.g. action / maneuver / triggered) |
| Category | `system.category` | ✅ |
| Resource cost | `system.resource` | ✅ Heroic-resource cost to use |
| Distance — type | `system.distance.type` | ✅ |
| Distance — primary | `system.distance.primary` | ✅ |
| Distance — secondary | `system.distance.secondary` | ✅ |
| Distance — tertiary | `system.distance.tertiary` | ✅ |
| Target — type | `system.target.type` | ✅ |
| Target — value | `system.target.value` | ✅ |
| Target — custom | `system.target.custom` | ✅ |
| Power roll formula | `system.power.roll.formula` | ✅ |
| Power roll characteristics | `system.power.roll.characteristics` | ✅ Which characteristic(s) the roll uses |
| Tier effects | `system.power.effects` | ⚠️ **collection**, not `tier1/2/3` scalars — more involved than the kit-bonus tiers; iterate the collection |

---

## 5. Conditions / statuses

There is **no single scalar** for conditions. Read from two core sources:

- **`actor.statuses`** — a core `Set` of active status ids.
- **`effects`** — the Active Effects collection on the actor.

The nine Draw Steel sheet conditions: bleeding, dazed, frightened, grabbed, prone,
restrained, slowed, taunted, weakened.

> Sync approach: read `actor.statuses` as the source of truth for which of these are
> active; cross-reference `effects` for duration/source metadata if needed. This is
> **pull-oriented** — derived combat state, not a worldbuilding field to push.

---

## 6. Skills

| Chronicle field | `foundry_path` | Notes |
|---|---|---|
| Skills | `system.skills.value` | ⚠️ **Set** of skill ids — serialize to array |

---

## 7. NOT syncable from the actor

These are **not** on the character document:

| Concept | Where it actually lives | Implication |
|---|---|---|
| Hero Tokens | World setting: `game.settings.get("draw-steel", "heroTokens")` | Party/world-scoped, **not** per-character. Cannot be read from the actor. |
| Malice | World setting: `game.settings.get("draw-steel", "malice")` | Encounter/world-scoped, **not** per-character. |
| Potency (weak/average/strong) | `system.potency.*` | **Derived / read-only** — pull only, never push |
| Winded | derived from stamina | **Derived / read-only** — pull only |
| Stamina max | `system.stamina.max` | **Derived / read-only** — pull only |

---

## 8. Gotchas

- **(a)** `level`, the **class name**, and the **heroic-resource name** live on the
  **class item** (`system.class.system.level` / `.primary`), not on the actor. A naive
  `system.details.level` read will miss them.
- **(b)** **Hero Tokens** and **Malice** are **world settings** (`game.settings` under
  `"draw-steel"`), not character data — do not expect them on the actor document.
- **(c)** **Potency**, **winded**, and **stamina max** are **derived** — sync them
  **pull-only** and never push (a push would be overwritten on next recompute).
- **(d)** The `foundry_item_single` collapse uses the **FIRST projection field by
  insertion order** to pick the representative record — order your `foundry_item_fields`
  deliberately so the right field drives the collapse.
- **(e)** **Abilities need an explicit `foundry_item_fields` projection.** Without one,
  they sync as **names only** and all the mechanical sub-fields (keywords, distance,
  power roll, tier effects) are lost.

---

## 9. Current coverage snapshot

State of the manifest **today**.

### ✅ Correct today

| Chronicle field | Foundry source |
|---|---|
| Characteristics (might/agility/reason/intuition/presence) | `system.characteristics.*.value` |
| Stamina (current/temporary) | `system.stamina.value` / `.temporary` |
| Recoveries | `system.recoveries.value` / `.max` |
| Speed | `system.movement.value` |
| Stability | `system.combat.stability` |
| Wealth | `system.hero.wealth` |
| Backstory | `system.biography.value` |
| Abilities (as names) | `items` filtered by `type == ability` |

### ✅ Fixed in Phase A — do NOT revert to the "old" paths

These were wrong and are now corrected in the manifest. Listed so a future editor
doesn't "fix" them backward.

| Chronicle field | OLD (wrong) path — do not use | CORRECT path (current) |
|---|---|---|
| Level | `system.details.level` | `class` item → `system.class.system.level` |
| Heroic resource name | `system.hero.resource.name` | `class` item → `system.class.system.primary` |
| Heroic resource max | *(nonexistent)* | **No actor field — REMOVED.** DS heroic resources have no fixed max (you accumulate); the sheet shows a bare count of `system.hero.primary.value`. |

### ✅ Declared in Phase C (manifest, branch `claude/chronicle-sheet-sync-j2m9s4`)

These require the Foundry adapter's `normalizeFoundryValue` (Set/Collection → JSON)
to land too — Sets serialize to `{}` without it.

| Concept | Manifest declaration |
|---|---|
| Skills | `skills_json` ← `system.skills.value` (Set → JSON array) |
| Kit details (damage tiers, distance, bonuses) | `kit_details_json` ← `kit` item projection of `system.bonuses.*` |
| Culture | `culture` ← `culture` item name (single) |
| Career | `career` ← `career` item name (single) |
| Conditions | `conditions_json` ← `actor.statuses` (Set → JSON array, pull-only) |
| Potency | `potency_{weak,average,strong}` ← `system.potency.*` (pull-only, derived) |
| Ability keywords | `abilities_json.keywords` ← `system.keywords` (Set → array) |
| Ability power-roll characteristics | `abilities_json.powerRollChars` ← `system.power.roll.characteristics` (Set → array) |
| Ability tier ladder | `abilities_json.tiers` ← `system.power.effects` (pseudo-doc collection → array) |
| Ability effect/trigger/story text | `abilities_json.{effectBefore,effectAfter,trigger,story}` |

### ✅ Declared in Phase A (already shipped)

Surges (`system.hero.surges`), Size (`system.combat.size.value`), Disengage
(`system.movement.disengage`), Victories/Renown/XP (`system.hero.*`),
Temporary stamina (`system.stamina.temporary`).

---

*Confidence markers: ✅ confirmed against draw-steel system source · ⚠️ inferred or
requires special handling (Set/collection/derived/GM-gated).*
