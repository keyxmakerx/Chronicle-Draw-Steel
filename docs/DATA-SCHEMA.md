# Data Schema Reference

All files in `data/` must be JSON arrays of **ReferenceItem** objects. Chronicle's system loader parses them on package install.

## ReferenceItem Base Format

```json
{
  "slug": "unique-identifier",
  "name": "Display Name",
  "description": "Optional description text.",
  "properties": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | Yes | Unique identifier (lowercase, hyphenated) |
| `name` | string | Yes | Display name |
| `description` | string | No | Tooltip/detail text |
| `properties` | object | No | Arbitrary key-value metadata |

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
  "source": "Draw Steel CC-BY-4.0, MCDM Productions"
}
```

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
    "source": "Draw Steel Heroes Book, ch. 5 (mcdm.heroes.v1), via Steel Compendium"
  }
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
| `source` | string | Yes | Provenance (see `data/NOTICE.md`) |

`tools/test-abilities-data.mjs` enforces the invariants above in CI.

## ability-keywords.json

Keyword definitions for the tooltip system: the core ability keywords, the
elementalist's elemental specializations, and the talent traditions. Base
ReferenceItem shape, with `properties.group` (`Core`, `Elemental specialization`,
`Talent tradition`, or `Helper`) and `properties.source`. Entries that are not
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

Defines stat formulas per organization type.

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
  "hero_ratio": "1:1"
}
```

## role-templates.json

Defines characteristic baselines per role.

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
  }
}
```

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
python3 -c "import json; [json.load(open(f'data/{f}')) for f in ['creatures.json','creature-abilities.json','rules-glossary.json','organization-templates.json','role-templates.json','damage-baselines.json','creature-keywords.json','ability-keywords.json']]"

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
```
