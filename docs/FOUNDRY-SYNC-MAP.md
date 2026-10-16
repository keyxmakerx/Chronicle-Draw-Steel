# Foundry ↔ Chronicle Sync Map (Draw Steel hero and creature)

> Reference for the Draw Steel system package. Maps the Draw Steel Foundry VTT actor
> data model (`MetaMorphic-Digital/draw-steel`, actor type `hero`) onto Chronicle
> character entity fields. The source of truth for every path below is the
> `drawsteel-character` entity preset in `manifest.json`.

## 1. Overview

Chronicle's character sync is **manifest-driven**: the generic adapter reads
`foundry_path`, `foundry_collection`, `foundry_item_type` and `foundry_item_fields`
annotations on each Chronicle field and walks the Foundry document accordingly. There
are **zero hardcoded mappings** in the adapter — everything is declared in the manifest.
The preset's `foundry_actor_type` is **`hero`** and the package's `foundry_system_id` is
`draw-steel`. A key consequence of Draw Steel's design is that many "identity" concepts
a worldbuilder thinks of as character attributes (class, level, ancestry, career, kit,
heroic-resource name) are **embedded Items on the actor**, not actor-level scalars.
Those use `foundry_collection` + `foundry_item_fields` projections rather than a
simple `foundry_path`.

**Direction.** A field is two-way unless the manifest sets `foundry_writable: false`,
which makes it pull-only (Chronicle never writes it back). Fields marked
`owner_only` or `gm_only` in the manifest are withheld from other viewers by Chronicle.

---

## 2. Scalar paths

Direct `foundry_path` reads off the `hero` actor. The key is the Chronicle field key.

| Chronicle field (key) | `foundry_path` | Direction |
|---|---|---|
| Might / Agility / Reason / Intuition / Presence (`might`, `agility`, `reason`, `intuition`, `presence`) | `system.characteristics.<name>.value` | two-way |
| Stamina, current (`stamina_current`) | `system.stamina.value` | two-way |
| Stamina, temporary (`stamina_temporary`) | `system.stamina.temporary` | two-way |
| Stamina, max (`stamina_max`) | `system.stamina.max` | two-way in the manifest; Foundry derives it |
| Winded (`winded`) | `system.stamina.winded` | two-way in the manifest; Foundry derives it |
| Recoveries (`recoveries`, `recoveries_max`) | `system.recoveries.value` / `.max` | two-way |
| Heroic resource, current (`heroic_resource_current`) | `system.hero.primary.value` | two-way |
| Surges (`surges`) | `system.hero.surges` | two-way |
| Victories, Renown, XP, Wealth (`victories`, `renown`, `xp`, `wealth`) | `system.hero.<name>` | two-way |
| Speed (`speed`) | `system.movement.value` | pull-only |
| Disengage (`disengage`) | `system.movement.disengage` | pull-only |
| Movement modes (`movement_types`) | `system.movement.types` | pull-only |
| Hover (`movement_hover`) | `system.movement.hover` | pull-only |
| Stability (`stability`) | `system.combat.stability` | pull-only |
| Size (`size`) | `system.combat.size.value` | pull-only |
| Save threshold / bonus (`save_threshold`, `save_bonus`) | `system.combat.save.threshold` / `.bonus` | pull-only |
| Potency (`potency_weak`, `potency_average`, `potency_strong`) | `system.potency.weak` / `.average` / `.strong` | pull-only |
| Damage immunities (`immunities`) | `system.damage.immunities` | pull-only |
| Damage weaknesses (`weaknesses`) | `system.damage.weaknesses` | pull-only |
| Status immunities (`status_immunities`) | `system.statuses.immunities` | pull-only |
| Skills (`skills_json`) | `system.skills.value` (a Set of skill ids, serialized to an array) | pull-only |
| Languages (`languages_json`) | `system.biography.languages` | pull-only |
| Conditions (`conditions_json`) | `statuses` (the actor's core status Set, serialized to an array) | pull-only |
| Portrait (`portrait_url`) | `prototypeToken.texture.src` | two-way |
| Biography / backstory (`backstory`) | `system.biography.value` | two-way, `owner_only` |
| GM / Director notes (`gm_notes`) | `system.biography.director` | two-way, `gm_only` |

Chronicle-only fields with no Foundry path: `faction`, `initiative`, `in_combat`,
`combat_round`. The sheet widget does not show the three combat-state fields; Draw
Steel uses alternating activation, so there is no initiative to display.

---

## 3. Embedded-Item paths

These are **not** actor scalars. They are read from the actor's embedded items
(`foundry_collection: items`) filtered by `foundry_item_type`, projecting sub-fields
with `foundry_item_fields`. A name is the item's top-level `name`.

| Chronicle field (key) | Item type | Field within the item |
|---|---|---|
| Class (`class`) | `class` | `name` |
| **Level** (`level`) | `class` | `system.level` |
| **Heroic resource name** (`heroic_resource_name`) | `class` | `system.primary` |
| Subclass (`subclass`) | `subclass` | `name` |
| Ancestry (`ancestry`) | `ancestry` | `name` |
| Career (`career`) | `career` | `name` |
| Culture (`culture`) | `culture` | `name` |
| Kit (`kit`) | `kit` | `name` |

Kit details arrive as one projection, `kit_details_json`, from the `kit` item:

| Projected key | Path within the kit item |
|---|---|
| `name` | `name` |
| `meleeDamageT1` / `T2` / `T3` | `system.bonuses.melee.damage.tier1` / `tier2` / `tier3` |
| `rangedDamageT1` / `T2` / `T3` | `system.bonuses.ranged.damage.tier1` / `tier2` / `tier3` |
| `meleeDistance` / `rangedDistance` | `system.bonuses.melee.distance` / `system.bonuses.ranged.distance` |
| `stability`, `speed`, `stamina`, `disengage` | `system.bonuses.<name>` |

> Note on `foundry_item_single` collapse: the single-item fields above (class,
> subclass, ancestry, career, culture, kit name, level, heroic resource name) are
> declared `foundry_item_single: true`, so the adapter collapses the matching items to
> one record. The collapse uses the **first projection field by insertion order** —
> declare projection fields intentionally (see Gotchas).

---

## 4. Ability items

Abilities are embedded items of type `ability` projected into `abilities_json`.
Without a `foundry_item_fields` projection, abilities would sync as **names only**;
the manifest projects these keys:

| Projected key | Path within the ability item |
|---|---|
| `name` | `name` |
| `type` | `system.type` (action / maneuver / triggered …) |
| `category` | `system.category` |
| `cost` | `system.resource` (heroic-resource cost to use) |
| `keywords` | `system.keywords` (a Set, serialized to an array) |
| `distanceType` | `system.distance.type` |
| `distance` | `system.distance.primary` |
| `distanceSecondary` | `system.distance.secondary` |
| `targetType` | `system.target.type` |
| `target` | `system.target.value` |
| `targetCustom` | `system.target.custom` |
| `powerRollFormula` | `system.power.roll.formula` |
| `powerRollChars` | `system.power.roll.characteristics` (a Set, serialized to an array) |
| `tiers` | `system.power.effects` (a **collection**, not `tier1/2/3` scalars; serialized to an array) |
| `trigger` | `system.trigger` |
| `effectBefore` / `effectAfter` | `system.effect.before` / `system.effect.after` |
| `story` | `system.story` |
| `damageDisplay` | `system.damageDisplay` |

Other item collections are projected the same way:

| Chronicle field (key) | Item type | Projected keys (path within the item) |
|---|---|---|
| Features (`features_json`) | `feature` | `name`, `description` (`system.description.value`), `level` (`system.prerequisites.level`), `dsid` (`system._dsid`), `sourceBook` (`system.source.book`) |
| Perks (`perks_json`) | `perk` | `name`, `perkType` (`system.perkType`), `description`, `dsid` |
| Titles (`titles_json`) | `title` | `name`, `echelon` (`system.echelon`), `description`, `story` (`system.story`), `dsid` |
| Treasures (`treasures_json`) | `treasure` | `name`, `category` (`system.category`), `kind` (`system.kind`), `echelon`, `keywords`, `quantity` (`system.quantity`), `description` |

---

## 5. Conditions / statuses

There is **no single scalar** for conditions. Active conditions come from the actor's
core `statuses` Set, mapped to `conditions_json` and pull-only: derived combat state,
not a worldbuilding field to push. The sheet shows each status id Title-cased. A player's play edit of
`conditions_json` is still written to Foundry (`play.to_foundry` in the manifest).

---

## 6. NOT syncable from the actor

These are **not** on the character document:

| Concept | Where it actually lives | Implication |
|---|---|---|
| Hero Tokens | World setting: `game.settings.get("draw-steel", "heroTokens")` | Party/world-scoped, **not** per-character. Cannot be read from the actor. |
| Malice | World setting: `game.settings.get("draw-steel", "malice")` | Encounter/world-scoped, **not** per-character. |
| Heroic resource maximum | — | No actor field: heroic resources have no fixed maximum (they accumulate), so the manifest has no max field and the sheet shows a bare count of `heroic_resource_current`. |

---

## 7. Gotchas

- **(a)** `level`, the **class name**, and the **heroic-resource name** live on the
  **class item** (`system.level` / `system.primary`), not on the actor. A read of
  `system.details.level` or `system.hero.resource.name` finds nothing.
- **(b)** **Hero Tokens** and **Malice** are **world settings** (`game.settings` under
  `"draw-steel"`), not character data — do not expect them on the actor document.
- **(c)** **Potency** and the rest of the pull-only fields in §2 carry
  `foundry_writable: false`, so Chronicle never writes them back. **Stamina max** and
  **winded** are derived by Foundry but the manifest does not mark them read-only, so a
  pushed value would be overwritten on Foundry's next recompute.
- **(d)** The `foundry_item_single` collapse uses the **FIRST projection field by
  insertion order** to pick the representative record — order `foundry_item_fields`
  deliberately so the right field drives the collapse.
- **(e)** **Abilities need an explicit `foundry_item_fields` projection.** Without one,
  they sync as **names only** and all the mechanical sub-fields (keywords, distance,
  power roll, tier effects) are lost.
- **(f)** Sets (skills, keywords, statuses, power-roll characteristics) and the tier
  collection serialize to `{}` unless the Foundry adapter converts them to JSON arrays
  (`normalizeFoundryValue`); the `*_json` fields and projected Set keys rely on that.

---

## 8. Creatures (`npc` actors)

The `drawsteel-creature` preset maps a Creature page onto a Draw Steel `npc` actor.
Chronicle owns the stat block: it writes every mapped field, and Foundry sends back
only the fields in the preset's `foundry_pull_fields` (current Stamina and
conditions), and only when the director turns that on. `tools/test-creature-foundry-map.mjs`
pins every path below to the system's NPC data model.

The Chronicle Sync module reads these paths from Chronicle's
`GET /api/v1/campaigns/:id/systems/:systemId/creature-fields` (the creature
preset's fields with their Foundry annotations, plus `foundry_pull_fields`; an
empty `fields` list when the system has no creature preset). A Chronicle without
that route gets no creature sync.

| Chronicle field (key) | `foundry_path` | Conversion |
|---|---|---|
| Level (`level`) | `system.monster.level` | |
| Organization (`organization`) | `system.monster.organization` | `foundry_choices`: a key of `CONFIG.DRAW_STEEL.monsters.organizations` |
| Role (`role`) | `system.monster.role` | `foundry_choices`: a key of `...monsters.roles` |
| Keywords (`keywords`) | `system.monster.keywords` | `foundry_format: set` of `...monsters.keywords` keys |
| EV (`ev`) | `system.ev` | |
| Free strike (`free_strike`) | `system.monster.freeStrike` | `foundry_format: integer` (the number in "5 damage") |
| Size (`size`) | `system.combat.size` | `foundry_format: size` ("1S" is value 1, letter S) |
| Stamina (`stamina`) / current (`stamina_current`) | `system.stamina.max` / `.value` | current is sent back |
| Speed (`speed`), Stability (`stability`) | `system.movement.value`, `system.combat.stability` | |
| Characteristics | `system.characteristics.<name>.value` | |
| Conditions (`conditions_json`) | `statuses` | sent back |

A value with no matching Foundry key (an organization of Swarm, a keyword the system
doesn't list) is left unset rather than guessed. Not mapped yet: winded (Foundry
derives it), immunities and weaknesses (Foundry stores a number per damage type)
and traits. Abilities and villain actions become Draw Steel ability items; the
module's `.ai.md` creature-sync row says how.
`book_source`, the Monsters book entry a page was copied from, is Chronicle-only
and has no Foundry path. Neither has the token picture (`token_image`, a media
id): a Chronicle media link needs signing, so the Chronicle Sync module fetches
the token and the page picture itself and sets the actor's token and portrait.

Sending back is off for every creature until the director turns it on in the
"In Foundry" box under the creature's stat block. The toggle is stored in the
page's `foundry` system state (`gm.sendBack`), which the Chronicle Sync module
reads before it sends current Stamina or conditions. Saving the stat block in
the editor keeps whatever Foundry already sent back.
