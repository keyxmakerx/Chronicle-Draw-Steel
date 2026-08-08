# Attribution — reference data (`data/*.json`)

## What is reproduced, and from where

The rules text in the following files is **DRAW STEEL** game content, reproduced
from the published Draw Steel 1.0 ruleset (the *Heroes Book*):

| File | Content | Source location |
|------|---------|-----------------|
| `rules-glossary.json` | Conditions, keywords, movement, actions, and other glossary terms | *Heroes Book* ch. 1 (The Basics), ch. 5 (Classes), ch. 10 (Combat) |
| `skills.json` | Skill names and their uses | *Heroes Book* ch. 9 (Tests) |
| `ancestries.json` | The twelve ancestries: signature traits, purchased traits, point costs, and granted abilities | *Heroes Book* ch. 3 (Ancestries) |
| `kits.json` | The twenty-one kits: equipment, armor and weapon categories, Stamina/speed/stability/damage/distance/disengage bonuses, and signature abilities | *Heroes Book* ch. 6 (Kits) |
| `abilities.json` | 519 abilities: the nine classes' signature/heroic/other abilities with their Heroic Resource costs, the twenty-one kit signature abilities, and the common main actions, maneuvers and move actions — each with keywords, type, distance, target, power-roll tiers and effect text | *Heroes Book* ch. 5 (Classes), ch. 6 (Kits), ch. 10 (Combat) |
| `ability-keywords.json` | The ability keywords, the four elemental specializations, and the talent traditions | *Heroes Book* ch. 5 (Classes) |
| `ancestry-point-buy.json` | The ancestry-points budget rule, signature vs. purchased traits, the starting size/speed/stability baseline, the per-ancestry budget table, and the revenant's Previous Life case | *Heroes Book* ch. 3 (Ancestries) |
| `monster-building.json` | The monster-making formulas: role/damage and organization modifier tables, the EV, Stamina, and damage-tier equations, characteristics and potency, target-count adjustment, Instant Solo Creature, reskinning, and the animal-trait point budget | *Monsters Book* ch. 1 (Monster Basics), ch. 2 (Monsters — Animals) |
| `encounter-building.json` | The six-step encounter-building procedure: the five difficulty tiers with their budget bands and Victory awards, encounter strength and its table, budget spending rules, creature level and count limits, initiative groups, and Quick Encounter Building | *Monsters Book* ch. 1 (Monster Basics) |
| `animal-traits.json` | The thirty-five animal traits with their point costs, upgrades, and optional lines | *Monsters Book* ch. 2 (Monsters — Animals) |

It was compiled with reference to the community **Steel Compendium**
(<https://steelcompendium.io>, GitHub `SteelCompendium/data-md`), which publishes
this material under the same Creator License and carries the same attribution
disclaimer. The specific files consulted for `ancestries.json` were
`Rules/Ancestries/*.md` (the twelve per-ancestry files) and
`Rules/Chapters/Ancestries.md`; the glossary additions came from
`Rules/Chapters/Combat.md`, `Rules/Chapters/Classes.md`, and
`Rules/Chapters/The Basics.md`.

The files consulted for `kits.json` were `Rules/Kits/*.md` (the twenty-one
per-kit files), `Rules/Kits/Kits Table.md` (the summary table of every kit's
numeric bonuses, used to cross-check each entry), and `Rules/Chapters/Kits.md`
(the armor, weapon, bonus, and signature-ability rules that define what those
numbers mean). The `echelon` glossary entry added alongside them comes from
`Rules/Chapters/The Basics.md` ("Echelons of Play"), reduced to its level bands —
the surrounding passage names setting locations and characters and is excluded
(see below).

The files consulted for `abilities.json` were `Rules/Abilities/**/*.md` — all 545
of them: `Common/{Main Actions,Maneuvers,Move Actions}` (17 files), `Kits/<kit>/`
(21 files, one signature ability per kit), and the nine class folders
`{Censor, Conduit, Elementalist, Fury, Null, Shadow, Tactician, Talent,
Troubadour}/<N>-Level Features/` (507 files). Each file's YAML frontmatter
carries the ability's type, keywords, distance, target, level, cost and flavor
line, and its body carries the power-roll tiers and effect text; both were
converted mechanically, so every field traces back to a specific source file.
Twenty-one abilities are printed at more than one level; the per-level duplicates
are merged into one entry that lists every level it is offered at in
`properties.levels`. Five domain abilities (Blessing of Secrets, Faithful Friend,
Grave Speech, Guided to Your Side, Hands of the Maker) are printed for both the
censor and the conduit; those stay as two entries, one per class, because the
slugs are namespaced by class.

The **build-your-own** files draw on a second published source and a second Steel
Compendium repository. `ancestry-point-buy.json` reproduces the "Ancestry Traits"
and "Starting Size and Speed" sections of `Rules/Chapters/Ancestries.md` in
`SteelCompendium/data-md`, the same file already consulted for `ancestries.json`.
`monster-building.json`, `encounter-building.json`, and `animal-traits.json` come
from `SteelCompendium/data-bestiary-md`, the markdown of the *Draw Steel Monsters*
book (`source: mcdm.monsters.v1`), which carries the same DRAW STEEL Creator
License attribution as `data-md`. The specific files consulted were
`Monsters/Chapters/Monster Basics.md` — its "Monster Basics" (Encounter Value,
Creature Organization, Creature Roles, Villain Actions), "Malice",
"Step-by-Step Encounter Building", "Quick Encounter Building",
"Reskinning Monsters", and "Adjusting Monster Levels" sections — and
`Monsters/Chapters/Monsters.md`, whose "Animals" section carries the animal-trait
point budget, the four trait categories, and the Animal Notation shorthand.

Three glossary entries were added alongside them: `encounter-value` and
`encounter-strength` from "Monster Basics" and "Step 3: Determine Encounter
Strength", and `malice` from the "Malice" and "Earning Malice" sections. They
exist because the build-your-own text refers to all three constantly and the
tooltip system had definitions for neither.

The keyword definitions in `ability-keywords.json` come from
`Rules/Chapters/Classes.md` ("Ability Keywords") for the core keywords,
`Rules/Classes/Elementalist.md` for the elemental specializations,
`Rules/Classes/Talent.md` for the talent traditions, and
`Rules/Classes/Troubadour.md` ("Routines") for Performance.

## Licence

This package is an independent product published under the **DRAW STEEL Creator
License** and is not affiliated with MCDM Productions, LLC.
**DRAW STEEL © 2024 MCDM Productions, LLC.**

The Draw Steel Creator License (<https://www.mcdmproductions.com/draw-steel-creator-license>)
permits reproducing Draw Steel rules text in third-party products, including
free/open-source ones, provided the above attribution is included and MCDM
endorsement is not implied. No MCDM trademarks, logos, art, or proprietary setting
material are used here — only rules text (condition/keyword/skill/ancestry trait
definitions and their mechanical numbers).

### Setting material deliberately excluded

The published ancestry entries are mostly proprietary setting fiction — narrative
vignettes with named characters, named places, and named gods. **None of that is
reproduced here.** Only the "<Ancestry> Traits" rules sections carry over. Where a
trait's opening flavor sentence named a place or an in-world term, that sentence was
dropped and only the mechanics kept; the affected traits record this in
`properties.omissions` (memonek Keeper of Order / Nonstop / Useful Emotion, and the
dragon knight's Remember Your Oath, whose recited verse is omitted). The mechanics of
every such trait are complete.

The ability entries needed none of this treatment either. Ability names, flavor lines,
and effect text are mechanics and fighting-style description; nothing in the 545 source
files names a character, a place, or a god. One structural omission is recorded rather
than reproduced: the elementalist's Summon Source of Earth ability prints a full
stat block for the summoned elemental, which is a creature rather than part of the
ability, so it is left for `creatures.json` and the entry records the fact in
`properties.omissions`. Book-internal cross-references ("see Free Strikes below",
"see Conditions in Chapter 5") survive as plain text, because rewriting them would be
editorialising published rules; the page-number anchors they linked to are dropped, as
they address a PDF this package does not ship.

The build-your-own files needed one deliberate cut. Each published animal trait ends
with a **"Typically Used By"** line naming example creatures, and some of those are
invented Draw Steel creature names rather than real-world animals (mohlers,
quadrakangas, thrazzes, thunderjellies). Those lines are flavor, not mechanics, so
none of them are reproduced in `animal-traits.json`; every trait's cost, effect,
upgrade, and optional line is complete. `encounter-building.json` and
`monster-building.json` needed no cuts — the encounter-building and monster-making
sections name no character, place, or god. The Monsters book's bestiary itself
(`Monsters/Chapters/Monsters.md` outside the Animals section) is largely proprietary
setting fiction and named villains, and **none of it is reproduced here**; only the
Animals section's trait menu carries over.

The kit entries needed almost none of this treatment: the published kit text is rules
and fighting-style description, and names no character, place, or god. Each kit's
`description` is therefore the published introductory paragraph, reproduced as-is —
these are **not** custom text and carry no `custom_fields` flag. Two small omissions:
the Raider kit's signature-ability flavor line carries a parenthetical noting that
ability's former name, which is editorial rather than rules text and is dropped; and
the `echelon` glossary entry keeps only the four level bands, dropping the passage's
examples of what heroes do at each echelon because those name setting locations and
an in-world figure.

## Custom (non-published) content

Anything in `data/` that is **not** reproduced from published Draw Steel rules is
flagged on that entry, so it can be told apart from published content at a glance:

- **root `source: "custom"`** — marks an entry that is wholly original
  (operator-authored ancestries, creatures, worked examples, derived tables, helper
  entries). Published entries instead carry their real provenance in the same
  field, e.g. `"Draw Steel Heroes Book, ch. 3 (mcdm.heroes.v1), via Steel
  Compendium"`. It is a **root** field, not a property, because that is where
  Chronicle's item-detail header reads it from (`internal/systems/system_pages.templ`
  prints `item.Source`); provenance parked in `properties` displayed nowhere.
- **`properties.custom_fields`** — lists the fields on that entry that were written
  for this package rather than reproduced. In `ancestries.json`, every entry carries
  `"custom_fields": ["description"]`: because the published ancestry descriptions are
  setting fiction (see above), each `description` is an original, neutral mechanical
  summary written for this package. The `signature_traits` and `purchased_traits`
  on those same entries are published rules text.

Operators adding their own ancestries, kits, and creatures should set
`"source": "custom"` on those entries. This is a contract, not a habit, and it is
enforced with a named exception list rather than assumed: `docs/DATA-SCHEMA.md`
→ "Provenance" states the rule and enumerates the five pre-existing files still
pending a citation; `tools/test-render-contract.mjs` fails CI on any entry in any
other file that carries no root `source`, and on any attempt to grow that pending
list. `tools/test-build-your-own-data.mjs` additionally fails on a build-your-own
entry that claims a published source without naming Draw Steel.

**`ancestry-point-buy.json` contains two custom entries, and they exist because a
published rule does not.** Draw Steel ships no rules for building a custom
ancestry — no costing table for pricing an invented trait. Chapter 3 presents the
twelve pre-designed ancestries and nothing else.
`custom-ancestry-costing-benchmark` is therefore not a rule: it is a benchmark
computed from `data/ancestries.json` by tabulating what the 69 published purchased
traits actually do at 1 point and at 2 points, so an invented trait can be priced
by analogy against the closest published one. `custom-ancestry-checklist` is the
shape every published ancestry actually has, written down. Both carry
`"source": "custom"` and `properties.derived_from`, and both say in their own
`description` that they are not published rules. The other six entries in that
file are published rules text with their real provenance.

**`monster-building.json`, `encounter-building.json`, and `animal-traits.json`
contain no custom content.** Every entry is published rules text or a published
number. As with `kits.json`, the only non-published thing about them is the
*shape*: field names such as `stamina_organization_modifier`, `hero_slots_filled`,
and `budget_band`, the expression form the difficulty budget bands are written in
(`party_es + one_hero_es` rather than prose), and the `{@category term}`
cross-references woven into the text. Those encode published facts rather than
adding new ones, so they carry no flag.

**`organization-templates.json` and `role-templates.json` are mixed, and now say
so per field.** Their `hero_ratio`, `villain_action_count`, and the newly added
`organization_modifier` / `stamina_organization_modifier` / `hero_slots_filled` /
`role_modifier` / `damage_modifier` are published. Their `ev_multiplier`,
`stamina_base`, `stamina_per_level`, `default_speed`, `default_stability`,
`primary_stat`, and `characteristics` are this package's own approximations and
are listed in each entry's `properties`-equivalent `custom_fields` array. They do
not agree with the published formulas now in `monster-building.json` — the
published EV is `((2 × Level) + 4) × Organization Modifier`, not
`ev_multiplier × Level`, and published Stamina depends on the creature's *role*,
which the templates' organization-only model cannot express. The derived numbers
are left in place because `monster-engine.js`, `monster-builder.js`, and
`creatures.json` all consume them; they are flagged rather than silently
rewritten. `damage-baselines.json` is the same case and is likewise not published:
its per-organization tier table does not follow from the published damage
equation. Reconciling the widgets onto the published formulas is a code change,
not a data change, and is left for a later stage.

**The `swarm` organization is this package's own.** Swarm is a published creature
*keyword*, not a published creature *organization*: the Monsters book's
Organization Modifier table has rows for minion, horde, platoon, leader, elite,
and solo only. The `swarm` entry carries `"source": "custom"` and null modifiers.

**`abilities.json` contains no custom content.** Every one of the 519 entries is
published rules text and carries its real provenance in its root `source`
(ch. 5 for class abilities, ch. 6 for kit signature abilities, ch. 10 for the
common actions). As with `kits.json`, the only non-published thing about the file
is the *shape* of the data: field names such as `cost_resource` and
`additional_power_rolls`, the `class`/`kit`/`common` split in `properties.category`,
the `signature`/`heroic`/`free-strike`/`ability`/`common-ability` values in
`properties.type` (derived from whether the published ability names itself a
signature ability and whether it has a Heroic Resource cost), and the
`{@category term}` cross-references woven into the text. Those encode published
facts rather than adding new ones, so they carry no flag. The twenty-one kit
signature abilities appear here *and* in `kits.json`; both are generated from the
same source files, so the two must agree.

**`ability-keywords.json` contains two custom entries**, both pre-dating this
dataset and both kept: `attack` and `resistance` are not published Draw Steel
ability keywords, and no published ability in `abilities.json` uses either. They
are flagged `"source": "custom"` with a `note` saying so, and are retained only as
generic tags for operator-authored content. The other twenty-two entries are
published definitions and carry their real provenance. Two published elements —
Air and Water — are deliberately absent: Draw Steel 1.0 ships no elementalist
specialization for them, so no ability in this package carries those keywords.

**`kits.json` contains no custom content.** All twenty-one entries — description,
equipment line, every bonus, and every signature ability — are published rules text
or published numbers, and each carries
`"source": "Draw Steel Heroes Book, ch. 6 (mcdm.heroes.v1), via Steel Compendium"`.
The only non-published thing about the file is the *shape* of the data: field names
such as `melee_damage_bonus` and `stamina_bonus_scaling`, and the choice to record a
"—" in the published Kits table as `0` or `null`. That is an encoding of published
facts, not new content, so it carries no flag.

## Known inconsistency — to be corrected

`manifest.json`, `README.md`, `data/creatures.json`, `docs/DATA-SCHEMA.md`,
`docs/PROJECT-HANDOFF.md`, and `docs/implementation-checklist.md` currently describe
the Draw Steel content in this package as **CC-BY-4.0**. That is incorrect: MCDM has
not released Draw Steel under Creative Commons, and there is no Draw Steel SRD or
free Basic Rules tier. The Creator License described above is the only permission
this package relies on, and it is the position stated in this file. Those CC-BY
claims should be replaced with the Creator License attribution; they are left
untouched here only because correcting them spans files outside this dataset.
