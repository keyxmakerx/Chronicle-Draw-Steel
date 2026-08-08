# Data Schema Reference

All files in `data/` must be JSON arrays of **ReferenceItem** objects. Chronicle's system loader parses them on package install.

## ReferenceItem Base Format

```json
{
  "slug": "unique-identifier",
  "name": "Display Name",
  "summary": "One line for the list table.",
  "description": "Optional description text.",
  "properties": {},
  "source": "Draw Steel Heroes Book, ch. 3 (mcdm.heroes.v1), via Steel Compendium"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | Yes | Unique identifier (lowercase, hyphenated) |
| `name` | string | Yes | Display name |
| `summary` | string | Derived | One line; the list table's Summary column. Generated from `description` — see "Generated fields" |
| `description` | string | No | Tooltip/detail text |
| `properties` | object | No | Arbitrary key-value metadata |
| `tags` | array | No | Searchable labels |
| `source` | string | Yes | Provenance — see "Provenance" |

**Domain-specific fields go inside `properties`. The root carries only the keys
Chronicle's `ReferenceItem` reads off the root** (`internal/systems/system.go`):
`slug`, `name`, `summary`, `description`, `properties`, `tags`, `source`. A
*domain* field written at the root is invisible to every consumer, because every
consumer reads `properties` — but `summary` and `source` are root fields
*because that is where the renderer looks for them*:
`internal/systems/system_pages.templ` prints `item.Summary` in the list table and
`item.Source` in the detail header, and neither ever looks inside `properties`.
(`organization-templates.json` and `role-templates.json` are the two legacy
exceptions that put *domain* fields at the root — they are read straight off the
root by `monster-engine.js` and `monster-builder.js`, and are documented as-is
below. Do not copy that shape into a new file.)

## How a data file becomes a page (the rendering contract)

Correct data that nobody can see is not shipped. Chronicle renders this package
through `internal/systems`, and its rules are narrow enough that data has to be
shaped for them:

1. **`handler.go` → `Index()` iterates `manifest.Categories` only.** A file in
   `data/` with no category in `manifest.json` is not in the reference browser at
   all — no card, no route, nothing.
2. **A category's `fields[].key` is looked up in `properties`.** If the key is
   absent, `propString` returns `""` — a blank table column and a silently
   omitted detail row. Nothing errors. This is how twelve ancestries shipped with
   an empty Traits column: the manifest said `traits`, the data had
   `signature_traits` / `purchased_traits`.
3. **`propString` is `fmt.Sprintf("%v", value)`, so it only formats scalars.** An
   object prints as `map[cost:1 name:Beast Legs]`, an array of objects as
   `[map[…] map[…]]`, an array of strings as `[Attack Melee]`, and a JSON `null`
   as `<nil>`.
4. **Every declared field is a list column *and* a detail row** — the template
   has no detail-only slot. The list table is `w-full` inside an
   `overflow-hidden` wrapper, so columns do not scroll; each one added squeezes
   the rest.

### Generated fields

Because of (3), a `properties` value that is an object or an array cannot be a
manifest field. `tools/build-render-fields.mjs` derives a scalar twin beside it:

| Key | What it is |
|-----|-----------|
| `<key>_display` | Machine-derived one-line rendering of the structured `<key>`. The manifest points at this; widgets keep reading `<key>`. |
| `<key>_text` | **Authored** prose rendering of a structured value, where a generic render would be worse (`encounter-building.json`'s `budget_band_text`). Never overwritten by the generator. |
| `details_display` | For the heterogeneous rules files, everything without its own column, folded into one string — `monster-building.json`'s twelve entries use twenty-eight distinct keys between them. |
| `provenance_display` | `custom_fields` / `derived_from` / `omissions`, folded. |
| `summary` (root) | First sentence of `description`, so the list table's Summary column is never blank. An authored `summary` is kept as-is. |

**After editing any `data/*.json` by hand, run the generator:**

```bash
node tools/build-render-fields.mjs          # rewrite data/*.json + manifest.json
node tools/build-render-fields.mjs --check  # CI mode: fail if anything is stale
```

It also **generates `manifest.json`'s `categories` array** from the single
`CATEGORIES` declaration in `tools/_render-fields.mjs`, resolving each declared
column against the real data. That is what makes failure (2) structurally
impossible rather than merely discouraged. `tools/test-render-contract.mjs`
re-checks all of it against the committed manifest, so a hand-edit to
`manifest.json` is caught too.

## Provenance — root `source`, and `properties.custom_fields`

Every entry in `data/` must declare where it came from, in the root `source`
field — not `properties.source`, which the item-detail header never reads.
This is a contract, not a convention: `data/NOTICE.md` is the package's licensing
position, and it can only be true if published rules text and this package's own
content can be told apart mechanically.

**The contract is enforced, and its exceptions are enumerated.**
`tools/test-render-contract.mjs` fails if any entry in any `data/*.json` lacks a
root `source`, *unless* its file is in the `SOURCE_PENDING` list in
`tools/_render-fields.mjs`. That list is pinned in both directions: a file on it
that becomes fully sourced must be removed, and a file not on it can never be
added — so it can only shrink, and no new dataset can join it.

Five files predate the rule and are still pending:

| File | Entries | Why still pending |
|------|---------|-------------------|
| `rules-glossary.json` | 60 | Sourcing each term means citing a book and chapter per condition, read off the published text |
| `skills.json` | 57 | As above |
| `creature-abilities.json` | 23 | Template abilities; whether each is reproduced or authored has to be checked, not guessed |
| `creature-keywords.json` | 23 | As above |
| `rulebook-frontpage.json` | 8 | Mostly authored UI prose, but some entries carry tier/modifier tables that may reproduce published numbers |

A citation is only worth having if it is true, so these say nothing rather than
guessing a chapter. Everything else in `data/` — all 632 entries added for the
ancestry, kit, ability and build-your-own datasets, plus `creatures.json`,
`ability-keywords.json`, `organization-templates.json`, `role-templates.json`,
`damage-baselines.json` and `rulebook-examples.json` — carries a real root
`source`.

**A citation also has to be true about the *licence*.** Until the licensing
correction, every entry in `creatures.json` carried
`"source": "Draw Steel CC-BY-4.0, MCDM Productions"`, and Chronicle printed that
string on all 35 creature pages. Both halves were wrong: Draw Steel is not
CC-BY-4.0 (see `LICENSE` and `data/NOTICE.md`), and those 35 creatures are not
reproduced Draw Steel monsters — they are example stat blocks written for this
package's monster-builder and bestiary widgets. They now carry
`"source": "custom"`. The evidence and the trademark caveat are recorded in
`data/NOTICE.md` → "creatures.json is example content".

| Field | Type | Meaning |
|-------|------|---------|
| `source` (root) | string | Provenance. Either a real citation — e.g. `"Draw Steel Heroes Book, ch. 3 (mcdm.heroes.v1), via Steel Compendium"` — or the exact string `"custom"`. |
| `properties.custom_fields` | array | Present on an otherwise-published entry whose *specific listed fields* were written for this package rather than reproduced. E.g. every `ancestries.json` entry carries `["description"]`, because the published ancestry descriptions are setting fiction that is deliberately not reproduced. |
| `properties.derived_from` | string | On a `"custom"` entry that was computed from other data in this package, the file it was computed from — so the derivation can be re-checked. |
| `properties.omissions` | array | Published content deliberately not reproduced, and why. |

**Operator-authored content — new ancestries, new creatures, new kits — sets
the root `"source": "custom"`.** Anything shipped in this package that is a worked
example, a derived table, or a helper entry does the same. Published entries
carry their real citation instead. `tools/test-build-your-own-data.mjs` enforces
this for the build-your-own files, and `tools/test-abilities-data.mjs` for
`abilities.json`.

## creatures.json

Each creature represents a full Draw Steel stat block.

```json
{
  "slug": "goblin-sniper",
  "name": "Goblin Sniper",
  "summary": "L1 Artillery Minion",
  "description": "A small, cunning goblin that pelts enemies with arrows...",
  "properties": {
    "level": 1,
    "organization": "Minion",
    "role": "Artillery",
    "ev": 1,
    "size": "1S",
    "keywords": ["Goblin", "Humanoid"],
    "stamina": 7,
    "winded": 3,
    "speed": 6,
    "stability": 0,
    "might": -2,
    "agility": 1,
    "reason": 3,
    "intuition": 0,
    "presence": 1,
    "free_strike": "2 damage",
    "traits": "Crafty: The goblin sniper can {@movement shift} 1 after making a ranged attack.",
    "abilities_json": "[{\"name\":\"Shortbow\",\"type\":\"signature\",...}]",
    "villain_actions_json": "[]"
  },
  "tags": ["creature", "minion", "artillery", "goblin", "level-1"],
  "source": "custom"
}
```

All 35 shipped creatures are `"source": "custom"` — they are example stat blocks
written for this package, not reproduced Draw Steel monsters. An operator adding
a creature reproduced from a published book should replace that with a real
citation naming the book and chapter (the shape used elsewhere in `data/` is
`"Draw Steel Monsters Book, ch. 2 (mcdm.monsters.v1), via Steel Compendium"`).

### Properties Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `level` | number | Yes | Creature level (1-10) |
| `organization` | string | Yes | Minion, Horde, Platoon, Elite, Leader, Solo, or Swarm |
| `role` | string | Yes | Ambusher, Artillery, Brute, Controller, Defender, Harrier, Hexer, Mount, or Support |
| `ev` | number | Yes | Encounter Value (from org formula) |
| `size` | string | Yes | Size notation (1S, 1M, 1L, 2, 3, etc.) |
| `keywords` | array | Yes | Array of creature keyword strings |
| `stamina` | number | Yes | Hit points (from org formula) |
| `winded` | number | Yes | Half stamina (stamina // 2) |
| `speed` | number | Yes | Movement in squares |
| `stability` | number | Yes | Forced movement reduction |
| `might` | number | Yes | Might characteristic |
| `agility` | number | Yes | Agility characteristic |
| `reason` | number | Yes | Reason characteristic |
| `intuition` | number | Yes | Intuition characteristic |
| `presence` | number | Yes | Presence characteristic |
| `free_strike` | string | Yes | Free strike damage text |
| `traits` | string | No | Trait text (supports @references) |
| `abilities_json` | string | Yes | JSON-encoded array of ability objects |
| `villain_actions_json` | string | No | JSON-encoded array of villain action objects (Leaders/Solos: 3 required) |
| `faction` | string | No | Faction affiliation |
| `immunities` | string | No | Damage/condition immunities |

### Stat Calculation Formulas

Stats are derived from `organization-templates.json` and `role-templates.json`:

- **Stamina** = `org.stamina_base + (org.stamina_per_level * level)`
- **Winded** = `stamina // 2`
- **EV** = `org.ev_multiplier * level`
- **Speed** = `org.default_speed`
- **Stability** = `org.default_stability`
- **Characteristics** = `role.characteristics[stat]`, with +1 to primary stat per 3 levels above 1

## creature-abilities.json

Template abilities that creatures reference.

```json
{
  "slug": "crushing-blow",
  "name": "Crushing Blow",
  "description": "A powerful melee strike. Good signature ability for Brute creatures.",
  "properties": {
    "type": "signature",
    "keywords": ["Attack", "Melee", "Weapon"],
    "distance": "Melee 1",
    "target": "1 creature",
    "power_roll": "Might vs. Agility",
    "tier1": "3 damage",
    "tier2": "6 damage",
    "tier3": "9 damage; {@movement push} 2"
  }
}
```

### Ability Properties

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `signature`, `action`, `maneuver`, `triggered`, `villain-action` |
| `keywords` | array | Ability keywords (Attack, Melee, Ranged, Area, Magic, Weapon, Psionic, etc.) |
| `distance` | string | Range notation (Melee 1, Ranged 10, Aura 5, 3 cube within 1, etc.) |
| `target` | string | Target description |
| `power_roll` | string | Roll formula (e.g., "Might vs. Agility") |
| `tier1` | string | Result for roll 11 or lower |
| `tier2` | string | Result for roll 12-16 |
| `tier3` | string | Result for roll 17+ |
| `effect` | string | Non-roll effect text |
| `trigger` | string | Trigger condition (for triggered abilities) |
| `villain_action_order` | string | `opener`, `escalation`, or `closer` |

## abilities.json

Hero-facing abilities: the nine classes' abilities, the kit signature abilities,
and the common actions every creature has. (Monster abilities live in
`creature-abilities.json`, which uses a deliberately similar but smaller shape.)

```json
{
  "slug": "talent-slow-5-clarity",
  "name": "Slow (5 Clarity)",
  "description": "Perhaps they wonder why everyone else is moving so quickly?",
  "properties": {
    "category": "class",
    "type": "heroic",
    "class": "Talent",
    "subclass": "Chronopathy",
    "level": 2,
    "action_type": "Maneuver",
    "cost": "5 Clarity",
    "cost_amount": 5,
    "cost_resource": "Clarity",
    "keywords": ["Chronopathy", "Psionic", "Ranged"],
    "distance": "Ranged 10",
    "target": "Three creatures or objects",
    "power_roll": "Presence",
    "tier1": "The target's speed is halved ({@duration save-ends|save ends})...",
    "tier2": "The target is {@condition slowed} ({@duration save-ends|save ends})...",
    "tier3": "The target is {@condition slowed} ({@duration save-ends|save ends})...",
    "effect": "A target can't use triggered actions while their speed is reduced this way.",
    "strained": "The {@combat potency} of this ability increases by 1...",
    "keywords_display": "Chronopathy, Psionic, Ranged"
  },
  "source": "Draw Steel Heroes Book, ch. 5 (mcdm.heroes.v1), via Steel Compendium"
}
```

Slugs are namespaced by owner — `<class>-<ability>`, `kit-<ability>`,
`common-<ability>` — because ability names repeat across classes.

### Properties Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | Yes | `class`, `kit`, or `common` — who grants the ability |
| `type` | string | Yes | `signature`, `heroic` (has a Heroic Resource cost), `free-strike`, `common-ability`, or `ability` |
| `class` | string | class only | Censor, Conduit, Elementalist, Fury, Null, Shadow, Tactician, Talent, or Troubadour |
| `kit` | string | kit only | Granting kit's name |
| `subclass` | string | No | Subclass/tradition/specialization that grants it |
| `level` | number | class only | Level at which it is offered (lowest, if several) |
| `levels` | array | No | Present only when the ability is offered at more than one level |
| `action_category` | string | common only | `main action`, `maneuver`, or `move action` |
| `action_type` | string | No | Main action, Maneuver, Triggered, Free triggered, Free maneuver, Move, or No action |
| `cost` | string | heroic only | e.g. `"5 Clarity"` |
| `cost_amount` | number | heroic only | Numeric half of `cost` |
| `cost_resource` | string | heroic only | Heroic Resource spent |
| `keywords` | array | No | Ability keyword strings; every one must exist in `ability-keywords.json` |
| `distance` | string | No | Melee 1, Ranged 10, 1 aura, 3 cube within 1, Self, … |
| `target` | string | No | Target description |
| `power_roll` | string | No | Characteristic(s) added, e.g. `"Might or Agility"` |
| `tier1`/`tier2`/`tier3` | string | No | Results for ≤11 / 12–16 / 17+; never present without `power_roll` |
| `additional_power_rolls` | array | No | Further rolls in the same ability: `{intro?, power_roll, tier1..3}` |
| `effect` | string | No | Effect text |
| `rules_text` | string | No | Rules prose printed after the Effect entry |
| `trigger` | string | No | Trigger condition, for triggered abilities |
| `strained` | string | No | Strained entry (talent) |
| `special` | string | No | Special entry |
| `mark_benefit` | string | No | Mark Benefit entry (tactician) |
| `spend` | array | No | Optional Heroic Resource spends: `{label, text}` |
| `persistent` | array | No | Persistent entries: `{label, text}` |
| `notes` | array | No | Any other labelled entry: `{label, text}` |
| `omissions` | array | No | Source content deliberately not reproduced, and why |

Provenance is the **root** `source` (see "Provenance"), not a property. The
`*_display` keys beside `keywords`, `spend`, `persistent`, `levels` and
`additional_power_rolls` are generated — see "Generated fields".

`tools/test-abilities-data.mjs` enforces the invariants above in CI.

## ability-keywords.json

Keyword definitions for the tooltip system: the core ability keywords, the
elementalist's elemental specializations, and the talent traditions. Base
ReferenceItem shape, with `properties.group` (`Core`, `Elemental specialization`,
`Talent tradition`, or `Helper`) and a root `source`. Entries that are not
published Draw Steel keywords carry `"source": "custom"` and a `note` explaining
why they exist.

## rules-glossary.json

Rule definitions for the @reference tooltip system.

```json
{
  "slug": "frightened",
  "name": "Frightened",
  "description": "A frightened creature takes a bane on all power rolls against the source of their fear...",
  "properties": {
    "category": "condition"
  }
}
```

### Categories

| Category | Examples |
|----------|----------|
| `condition` | frightened, dazed, slowed, restrained, weakened, bleeding, burning, taunted, prone, charmed, poisoned, grabbed, hidden |
| `movement` | shift, push, pull |
| `duration` | eot (End of Turn), save-ends |
| `resource` | temporary-stamina, damage-resistance |
| `action` | free-strike |
| `combat` | forced-movement, power-roll, stability, winded |

## organization-templates.json

Defines stat formulas per organization type. **Legacy root-field shape** — the
fields sit at the root, not in `properties`, because `monster-engine.js` and
`monster-builder.js` read them there.

```json
{
  "slug": "platoon",
  "name": "Platoon",
  "description": "Standard enemies, one-for-one against heroes. 1:1 hero ratio.",
  "ev_multiplier": 4,
  "stamina_base": 20,
  "stamina_per_level": 6,
  "default_speed": 5,
  "default_stability": 1,
  "villain_action_count": 0,
  "hero_ratio": "1:1",
  "organization_modifier": 1,
  "stamina_organization_modifier": 1,
  "hero_slots_filled": 1,
  "custom_fields": ["description", "ev_multiplier", "stamina_base", "stamina_per_level",
                    "default_speed", "default_stability"],
  "source": "Draw Steel Monsters Book, ch. 1 (Monster Basics) (mcdm.monsters.v1), via Steel Compendium"
}
```

| Field | Provenance | Description |
|-------|-----------|-------------|
| `organization_modifier` | published | Multiplier in the EV and Stamina formulas (see `monster-building.json`). `null` on an organization Draw Steel does not publish. |
| `stamina_organization_modifier` | published | The Stamina-only multiplier; differs from `organization_modifier` for minion (0.125) and solo (5). |
| `hero_slots_filled` | published | Hero slots one creature of this organization fills in Quick Encounter Building. Equals `heroes / creatures` from `hero_ratio`. |
| `hero_ratio` | published | `"creatures:heroes"`. Read by `MonsterEngine.heroesPerCreature`. |
| `villain_action_count` | published | 3 for leaders and solos, 0 otherwise. |
| `ev_multiplier`, `stamina_base`, `stamina_per_level`, `default_speed`, `default_stability` | **custom** | This package's own linear approximations, listed in `custom_fields`. The published formulas are in `monster-building.json` and disagree with them; the widgets still consume these, so they are left in place rather than silently rewritten. |

`swarm` carries `"source": "custom"` and null modifiers: Swarm is a published
creature *keyword*, not a published creature *organization*, so the Monsters book
prints no modifier row, EV formula, or hero-slot rate for it.

## role-templates.json

Defines characteristic baselines per role. Same legacy root-field shape.

```json
{
  "slug": "brute",
  "name": "Brute",
  "description": "High damage, tough, but slow or predictable.",
  "primary_stat": "might",
  "characteristics": {
    "might": 3,
    "agility": 0,
    "reason": -1,
    "intuition": 0,
    "presence": 1
  },
  "role_modifier": 30,
  "damage_modifier": 1,
  "custom_fields": ["description", "primary_stat", "characteristics"],
  "source": "Draw Steel Monsters Book, ch. 1 (Monster Basics) (mcdm.monsters.v1), via Steel Compendium"
}
```

`role_modifier` feeds the published Stamina formula and `damage_modifier` the
published damage formula. `primary_stat` and `characteristics` are this package's
own — Draw Steel publishes no per-role characteristic array.

## ancestry-point-buy.json

The published ancestry-points rules, plus the two derived aids an operator needs
to invent an ancestry. Eight entries, all with `properties.category` set to
`"ancestry-point-buy"` and `properties.rule_type` naming the kind of entry
(`budget`, `trait-class`, `baseline`, `table`, `special-case`, `benchmark`,
`checklist`).

Six entries are published rules. The two that are not —
`custom-ancestry-costing-benchmark` (what 1-point and 2-point traits actually do,
tabulated from the 69 published purchased traits, so an invented trait can be
priced by analogy) and `custom-ancestry-checklist` — carry `"source": "custom"`
and `properties.derived_from`. **Draw Steel publishes no costing table for
inventing ancestry traits; those two entries are this package's own and must never
be presented as rules.**

`ancestry-point-budgets` is derived from `ancestries.json` and pinned against it
by `tools/test-build-your-own-data.mjs`, so editing an ancestry's budget or trait
list without updating the table fails CI.

## monster-building.json

The published monster-making formulas — the ones the Monsters book prints for
approximating a monster you create yourself, alongside the caveat that published
stat blocks are not meant to be modified.

| Slug | What it carries |
|------|-----------------|
| `monster-building-caveat` | Why published stat blocks should be reskinned rather than rebuilt. |
| `reskinning-monsters` | The changes that do not alter a creature's level or challenge. |
| `role-and-damage-modifier-table` | `properties.rows`: `role_modifier` + `damage_modifier` per role, and per organization for elite/leader/solo. |
| `organization-modifier-table` | `properties.rows`: `organization_modifier` + `stamina_organization_modifier`. |
| `encounter-value-formula` | `((2 * level) + 4) * organization_modifier`, rounded up. |
| `stamina-formula` | `((10 * level) + role_modifier) * stamina_organization_modifier`, rounded up. |
| `damage-and-power-roll-tiers` | `(4 + level + damage_modifier) * tier_modifier`, tier modifiers 0.6 / 1.1 / 1.4, halved for horde and minion. |
| `target-count-damage-adjustment` | ×0.8 / ×0.5 / ×1.2 for target counts off the expected. |
| `monster-characteristics-and-potency` | Highest characteristic = `1 + echelon`; potency per tier; leader/solo bonuses; free strike = tier 1. |
| `instant-solo-creature` | Converting a leader or elite into a solo. |
| `animal-trait-point-buy` | 4 free trait points, +2 EV per point beyond. |
| `animal-notation` | The `"Predator B: Swiftness, Pack, Hunter"` shorthand. |

Formula entries state the **equation**, never a table of pre-computed numbers for
one level: `properties.formula` is a string, `properties.rounding` is `"up"`, and
`properties.inputs` names the variables. `damage-baselines.json` is the
counter-example — it bakes one level's output into a table and its numbers do not
follow from the published equations.

## encounter-building.json

The published six-step encounter-building procedure — the creature-side point-buy.
Seventeen entries, `properties.category` = `"encounter-building"`, with
`properties.rule_type` one of `procedure`, `difficulty`, `formula`, `adjustment`,
`constraint`, `guideline`.

The five `difficulty` entries (`difficulty-trivial` … `difficulty-extreme`) each
carry `budget_band` — `{lower, upper, upper_inclusive}` as expressions over
`party_es` and `one_hero_es` — plus `budget_band_text` and `victories`.
`encounter-strength` carries the `4 + (2 * hero_level)` formula and the full
published table for 1–8 heroes at levels 1–10. `quick-encounter-building` carries
`fill_rates` (how many creatures of each organization fill one hero slot) and
`difficulty_adjustments`.

## animal-traits.json

The published animal-trait menu — 35 traits an operator buys to build a custom
animal. This is the one per-creature point-buy Draw Steel actually publishes.

```json
{
  "slug": "swiftness",
  "name": "Swiftness",
  "description": "The animal has a +2 bonus to speed, and they ignore {@combat difficult-terrain|difficult terrain}.",
  "properties": {
    "group": "Mobility",
    "cost": 1,
    "repeatable": 2
  },
  "source": "Draw Steel Monsters Book, ch. 2 (Monsters — Animals) (mcdm.monsters.v1), via Steel Compendium"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `group` | string | Yes | `Mobility`, `Defensive`, `Offensive`, or `Supernatural` |
| `cost` | number | Yes | Point cost (positive integer) |
| `repeatable` | number | No | How many times the trait may be selected; absent means once |
| `upgrade` | object | No | `{cost, text}` — the trait's published "+N Point" upgrade |
| `optional` | string | No | The trait's published "Optional:" line |
| `granted_ability` | object | No | A full ability the trait grants (Web) |

The budget rule lives in `monster-building.json` → `animal-trait-point-buy`, not
here, so this file stays homogeneous: every entry is a trait with a cost.

## @Reference Syntax

Use `{@category term}` in any text field to create a cross-reference:

```
"tier3": "9 damage; {@condition frightened} ({@duration save-ends})"
```

- The renderer (`widgets/reference-renderer.js`) parses these after HTML escaping
- Each term must match a `slug` in `data/rules-glossary.json`
- Display override: `{@condition taunted|taunts}` renders as "taunts" but links to the "taunted" definition

## Validation

Verify all data files:

```bash
# JSON validity
python3 -c "import json, glob; [json.load(open(f)) for f in glob.glob('data/*.json')]"

# All arrays with slug+name
python3 -c "
import json, glob
for f in sorted(glob.glob('data/*.json')):
    d = json.load(open(f))
    if d and isinstance(d, list) and len(d) > 0:
        assert 'slug' in d[0] and 'name' in d[0], f'{f} missing slug/name'
print('All valid')
"

# Creature formula validation
python3 -c "
import json
orgs = {o['slug']: o for o in json.load(open('data/organization-templates.json'))}
for c in json.load(open('data/creatures.json')):
    p = c['properties']
    org = orgs[p['organization'].lower()]
    assert p['stamina'] == org['stamina_base'] + org['stamina_per_level'] * p['level']
    assert p['ev'] == org['ev_multiplier'] * p['level']
    assert p['winded'] == p['stamina'] // 2
print('All 35 creatures pass formula validation')
"

# Build-your-own data: provenance flags, @references, and the derived tables
node --test tools/test-build-your-own-data.mjs

# Does it RENDER? Manifest field keys vs the data, scalar-only values, every
# file reachable, provenance where the header reads it, derived fields fresh.
node --test tools/test-render-contract.mjs

# Everything
node --test tools/test-*.mjs
```
