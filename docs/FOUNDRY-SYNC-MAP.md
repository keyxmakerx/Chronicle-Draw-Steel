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
| Epic resource, current (`epic_resource_current`) | `system.hero.epic.value` | two-way |
| Age (`age`) | `system.biography.age` | two-way |
| Height, Weight (`height`, `weight`) and their units (`height_units`, `weight_units`) | `system.biography.height.value` / `.units`, `system.biography.weight.value` / `.units` | two-way |
| Size letter (`size_letter`) | `system.combat.size.letter` | pull-only |
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

Chronicle-only fields with no Foundry path: `pronouns`, `gender`, `appearance` (Draw Steel's biography has no field for them), `faction`, `initiative`, `in_combat`,
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

A campaign's own kit has no Foundry item to copy, so sync makes one. The kit
field's `foundry_entry_fields` fills that item from the entry's properties, along
the same paths as above:

| Entry property | Path within the made kit item |
|---|---|
| `stamina_bonus`, `speed_bonus`, `stability_bonus`, `disengage_bonus` | `system.bonuses.stamina` / `speed` / `stability` / `disengage` |
| `melee_damage_bonus` / `ranged_damage_bonus` (`"+2/+2/+4"`) | `system.bonuses.melee.damage.tier1`–`tier3` / `system.bonuses.ranged.damage.tier1`–`tier3` |
| `melee_distance_bonus` / `ranged_distance_bonus` | `system.bonuses.melee.distance` / `system.bonuses.ranged.distance` |

A campaign's own career is made the same way, its numbers written on the item:

| Entry property | Path within the made career item |
|---|---|
| `project_points` | `system.projectPoints` |
| `renown`, `wealth` | `system.renown` / `system.wealth`, only when the item is made (`once`) |

The system adds a career's renown and wealth to the hero when the item is
created and subtracts the item's amounts when it is deleted, so those two are
never rewritten when the entry changes later; a hero keeps what the career gave.

A campaign's own ancestry is made the same way, and its numbers change the
hero rather than the item: the ancestry field's `foundry_entry_effects` puts them
on one Active Effect the made ancestry item carries, as the system's own
ancestries carry theirs, so the hero loses them when the ancestry goes:

| Entry property | Change to the hero |
|---|---|
| `speed` | `system.movement.value`, raised to at least this (upgrade) |
| `size` (`"1S"`, `"2"`) | `system.combat.size.value`, and `.letter` for size 1 (override) |
| `stability` | `system.combat.stability`, added |

A size that doesn't read as one ("As your previous ancestry") is left out.

Its signature traits become `ancestryTrait` items on the hero
(`foundry_entry_items`), one per trait with its description and no point cost,
which is how the system marks a signature trait and the type a printed
ancestry's advancement grants; they follow the entry and go when the ancestry
goes.

The single-item fields above (class, subclass, ancestry, career, culture, kit
name, level, heroic resource name) are `foundry_item_single: true`: the adapter
collapses the matching items to one record, using the first projection field in
insertion order (see Gotchas).

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
| `effects` | `system.effects` (Draw Steel 1.1+: a **collection** of rules-text entries, each with `description`, `before` and `type`; serialized to an array. The sheet folds it into `effectBefore` / `effectAfter`) |
| `effectBefore` / `effectAfter` | `system.effect.before` / `system.effect.after` (before Draw Steel 1.1; empty on later versions) |
| `story` | `system.story` |
| `damageDisplay` | `system.damageDisplay` |

Other item collections are projected the same way:

| Chronicle field (key) | Item type | Projected keys (path within the item) |
|---|---|---|
| Features (`features_json`) | `feature` | `name`, `description` (`system.description.value`), `level` (`system.prerequisites.level`), `dsid` (`system._dsid`), `sourceBook` (`system.source.book`) |
| Perks (`perks_json`) | `perk` | `name`, `perkType` (`system.perkType`), `description`, `dsid` |
| Titles (`titles_json`) | `title` | `name`, `echelon` (`system.echelon`), `description`, `story` (`system.story`), `dsid` |
| Projects (`projects_json`) | `project` | `name`, `type`, `goal`, `points`, `rollCharacteristic`, `projectSource`, `prerequisites`, `description` |
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

- `level`, the class name and the heroic-resource name live on the class item
  (`system.level` / `system.primary`); `system.details.level` and
  `system.hero.resource.name` do not exist.
- Hero Tokens and Malice are world settings (§6), not on the actor.
- Potency and the other pull-only fields in §2 carry `foundry_writable: false`.
  Stamina max and winded are derived by Foundry but not marked read-only, so a
  pushed value is overwritten on Foundry's next recompute.
- The `foundry_item_single` collapse picks its representative record by the
  first projection field in insertion order (§3); order `foundry_item_fields`
  deliberately.
- Abilities need the explicit projection in §4, or they sync as names only.
- Sets (skills, keywords, statuses, power-roll characteristics) and the tier
  collection serialize to `{}` unless the Foundry adapter converts them to JSON
  arrays (`normalizeFoundryValue`); the `*_json` fields and projected Set keys
  rely on that.

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

The same box says which monster in Foundry the page is. Chronicle matches each
creature page to the monster of the same name that Foundry reported (a world
actor, or an entry of a compendium such as the Draw Steel monsters), and the
director chooses under "In play, use" whose numbers play: Foundry's (the page
keeps the lore; Foundry places its own actor, and nothing on the page is sent
to Foundry, so the send-back toggle is not shown) or this page's (for a
house-ruled copy; creature sync makes the actor as for a homebrew monster). A
name that only looks alike shows Match and Not the same; "Match another"
searches Foundry's monsters. The box reads and writes Chronicle's
`/api/v1/campaigns/:id/entities/:eid/foundry-match` (an older Chronicle answers
404 and the box shows no match).

---

## 9. Items (`treasure` items)

The `drawsteel-item` preset holds the treasure fields a campaign's Items take
when the Director accepts the switch Chronicle offers on the Items list ("Use
Draw Steel's treasure fields for Items?"; the preset's `switch` block names the
fields it sets aside, `rarity` and `attunement`, and the one it reuses, `type`).
A campaign that turns Draw Steel on with no item pages yet gets them at once.
Until a campaign has switched, Chronicle's
`GET /api/v1/campaigns/:id/systems/:systemId/item-fields` answers an empty
`fields` list, so the module keeps sending plain named items.

After the switch, an item a hero carries reaches Foundry as a Draw Steel
`treasure` item (the preset's `foundry_item_type`) with these fields filled from
the Chronicle page. Chronicle stays the one place the words are written: Foundry
sends back only quantity and equipped, as for every carried item.
`tools/test-item-preset.mjs` pins every path below to the system's treasure
data model.

| Chronicle field (key) | `foundry_path` | Conversion |
|---|---|---|
| Type (`type`) | `system.category` | `foundry_choices`: a key of `CONFIG.DRAW_STEEL.equipment.categories` |
| Kind (`kind`) | `system.kind` | `foundry_choices`: a key of `...equipment.kinds` |
| Echelon (`echelon`) | `system.echelon` | `foundry_format: integer` ("2nd" is 2) |
| Keywords (`keywords`) | `system.keywords` | `foundry_format: treasure_keywords`: each word's key in the lists under `...equipment` ("Heavy Weapon" is the weapon list's `heavy`); a word no list has keeps its text |
| Effect, 1st/5th/9th level | `system.description.value` | `foundry_format: html_section`: each a headed section after the page's own words |
| Needs (`item_prerequisite`) | `system.project.prerequisites` | |
| Lore from (`project_source`) | `system.project.source` | |
| Project roll (`project_roll_characteristic`) | `system.project.rollCharacteristic` | `foundry_format: set` of `CONFIG.DRAW_STEEL.characteristics` keys ("Reason or Intuition") |
| Project goal (`project_goal`) | `system.project.goal` | `foundry_format: integer`, only when the goal is one number |

`book_source` is the Director's note of where a page was copied from; it is
GM-only and has no Foundry path.
