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
- Publish to the Community Bestiary, and add a Monsters book creature to the
  campaign from the Bestiary widget.

### Non-Goals (for now)

- Balance checking beyond the published encounter bands.
- Automated loot/treasure tables.
- An AI running inside Chronicle (Build with an AI works through the
  director's own AI chat).

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

## 3. Entity Preset

The `drawsteel-creature` preset in `manifest.json` is the source of truth for a
creature's fields. Its Foundry paths, and how each value converts, are in
[FOUNDRY-SYNC-MAP.md §8](./FOUNDRY-SYNC-MAP.md#8-creatures-npc-actors).

- `abilities_json`, `villain_actions_json` and `traits` store structured JSON as
  strings, which the builder and stat block parse. They don't reach Foundry yet.
- `stamina_current` and `conditions_json` are the only fields Foundry may send back
  (`foundry_pull_fields`).

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
in `manifest.json` → `entity_panels` twice, with `applies_to: "creature"` and
`applies_to: "npc"`, so Chronicle mounts it under the title of Creature pages
without the owner listing Creature as an NPC type, and of NPC pages too (once
on a page that is both). It shows itself only on the campaign's Creature pages
(the type whose preset category is `creature`), or on any page that already
has a stat block. A player sees nothing on a creature with no stat block; the
director sees **Build its stat block**.

`applies_to: "creature"` needs a Chronicle that knows that audience; an older
one rejects the whole manifest, so release this package only once the
Chronicle it installs into has it.

In page-layout mode Chronicle draws entity panels only where the layout places
the **Game System Panels** block. Chronicle starts new creature types with it
and placed it once in existing NPC and creature types.

The panel's global `DrawSteelStatblock` is the one stat block drawing used by
the panel, the editor's preview, the Bestiary widget's open rows and,
in compact mode (header, figures and the signature ability's name), a hover card. It reads both a page's `fields_data` and a
bestiary `statblock_json` (`normalize`), and writes either shape back
(`toFields`, `toStatblock`). Styles go into `<head>` once.

### 6.2 Editor

`widgets/monster-builder.js` defines `DrawSteelCreatureEditor`. The panel's
**Edit stat block** mounts it in place; Save writes the page's fields and
redraws the stat block. Cancel asks before dropping changes.

Every ability opens in a small form. A signature strike is added first, with
**Damage follows the published formula** on: its tiers' leading number tracks
the formula, and any words after it ("; push 2") are kept.

The row under the bar offers three ways to begin. **Generate one** folds open
a panel: what the creature is (free text, which becomes the name; words like
spider, dragon or ghost pick keywords and fitting abilities), what kind of
creature (fit my party, or an organization), its level, and its role (hidden
for leaders and solos). It takes abilities only from `data/creature-abilities.json`
entries whose `organizations` and `roles` fit the creature: a signature that
deals damage, then one ability made only for that organization and, except for
a minion, one for its role or theme; a leader or solo also gets three villain
actions. Characteristics are the role's published spread with its main one at
the published highest characteristic. Every figure, damage included, is the
published formula's. The panel lists why it chose each thing, and **Try other
abilities** picks again. **Blank** clears the stat block, asking first if
anything changed.

**Build with an AI** folds open in the Generate panel's place; only one is
open at a time. No AI runs inside Chronicle. The director describes the
creature and presses **Copy the guide**, which copies a prompt for any AI chat:
the description, the party read from the hero pages, the exact JSON shape to
answer in, and every option it may pick, read from the package's own files
(organizations, roles, sizes, creature keywords, ability keywords other than
helper tags, damage types, and the condition, duration and movement terms).
When the browser refuses the copy, the guide is shown selected to copy by hand.
The answer pasted back is read as it arrives, up to its last complete value, so
the editor fills in while it is pasted. The AI supplies words and picks only:
level, organization, role and size must be ones Draw Steel has, characteristics
are the role's published spread, and every figure, damage included, is the
published formula's in the AI's damage type. Its own numbers, a role on a
leader or solo, villain actions on anything else and reference terms the
glossary doesn't know are dropped, and the panel lists each change. The name,
traits and abilities it wrote carry a **From the AI** chip until the director
saves; the chip is never saved to the page. **Try an example answer** shows the
reading on a typical reply.

The guide also offers a shortlist of the Monsters book's abilities, since all
1,555 would not fit in a chat. Filters narrow it: kind, who it was made for
(**This creature**, the default, uses the same `usable` rule as Add abilities),
chapter of the book, ability keyword, the condition it inflicts, and a search.
Each choice shows how many abilities picking it would leave. The guide carries
at most 10, 25 or 50 (50 by default) of what is left, ranked by the words of
the description and search they match, then by how closely they were made for
this creature's organization and role; the director can untick any of them.
The AI answers with the ids it picked in `book_abilities`, and the editor adds
those as the drawer does, with formula damage, nothing twice and villain
actions only for leaders and solos. A pick made for another organization, or an
id the library doesn't hold, is left off with a note. Picked abilities carry a
**From the book** chip, naming the chapter, until the director saves.

**Add abilities** slides a drawer down over the dimmed page with the same
library. By default it lists only what this creature can use (`fits` for its
organization and role; with no organization yet, anything but a villain
action), best matches first; **Show all** lists every ability, marking the ones
made for other organizations. Filters cover kind, keyword and organization,
plus a search. Each card shows its damage worked out for this creature's level
and kind, and can take a damage type and one Draw Steel condition on the tiers
the published creatures usually put it. Drag a card onto the creature's list, or
press **Add**. Nothing is added twice, a second signature joins as a main
action, villain actions go only to leaders and solos (three at most), and every
add or removal can be undone. **Write your own** adds a blank ability as before.
In the editor, drag an ability or trait card onto another to reorder them, or
use its ↑ and ↓ buttons.

**or from a creature…** offers the community bestiary (every Draw Steel creature
published there) and this campaign's creatures. The copy is named "X (copy)",
keeps its level, and is recomputed: stale figures are replaced, and abilities
whose tiers look like formula damage are switched to follow it.

Motion follows Chronicle's setting: opening the editor slides its bar down
and the panels rise in turn, the Generate and AI panels fold open and shut,
the example answer arrives a little at a time, and a
figure that changes flashes briefly; the Add abilities drawer slides down and
an added ability eases into the creature's list. Calm keeps only fades; Off and reduced
motion turn it all off. On wide screens the bar with Save stays pinned.

The widget also registers `monster-builder` for placement on a page; on a page
that already has the stat block panel it steps aside.

### 6.3 Forms

A creature can have more than one form: a boss's second phase, a disguise and
what is under it. The page's own fields are the first form. Each other form
stores only what it changes, so a later change to the first form still reaches
every form that didn't change that figure. The forms are tabs above the stat
block; each figure says **Changed in this form** or **From** the first form,
each ability **Changed in this form**, **Only in this form** or **From** the
first form, and the director sees what the form drops under **Not in this
form**. **Edit form** opens the editor on the form; saving it keeps only the
difference (`DrawSteelForms.diff`, compared against `roundTrip`, what the
editor would save unchanged, so its own tidying is never a change). A list
item is matched by name: a changed ability keeps its place, a new one comes
last.

Forms live in the page's system state, not in its fields, so a player never
receives a form the director hasn't shown:

| Key | `gm` half | `public` half |
|-----|-----------|---------------|
| `forms` | `{v, order: [ids]}` | `{v, shown: [ids], current: id}` |
| `form-<id>` | the form | the same form once shown, else `{}` |

A form is `{id, name, stamina, changes, lists, art, token}`. `changes` holds
scalar figures by field key; `lists` holds `{drop: [names], add: [items]}` for
`traits`, `abilities_json` and `villain_actions_json`; `art` and `token` are
media ids, empty to borrow the first form's (a form with art and no token lets
Foundry crop the art). `stamina` is `carry` (damage carries over) or `fresh`
(the form starts at full Stamina), for changing form at the table. Showing a
form writes its public copy before the index lists it; hiding does the
reverse. Each half is at most 16 KiB, so a form that changes very many
abilities is refused with a reason. `current` is written by whatever changes
the creature's form at the table.

### 6.4 Variants

A campaign makes its own variant rules as homebrew; none ships in this
package. Directors only: players never read a recipe or a variant's link.

**A recipe** is made from a creature's page with **New recipe from this
creature**: the director names it (a recipe, or an add-on to one such as
Strong) and changes that creature in the editor the way the recipe should.
Nothing is saved to that creature. What changed becomes steps
(`DrawSteelVariants.stepsFrom`): a number moves by the same amount, an
organization or size by the same steps (organizations ranked minion, horde,
platoon, elite, solo, with leader as elite), keywords, immunities,
weaknesses and movement add and drop the same words, anything else is set,
and traits, abilities and villain actions change by name as forms do. EV,
Stamina, winded and free strike are never steps. The recipe lives on its
own private Creature page, which lists its steps; each relative step can be
fixed to the sample's value and back, or removed, and **Change it on**
reopens the editor on the sample.

**A variant** is made with **Make a variant**: pick a recipe and any of its
add-ons, which stack in order. It is a new Creature page, as private as its
original, named "Recipe of Original". Its stat block is the original's with
the steps applied and the formulas worked out again; a figure the director
typed on the original stays typed. The variant follows its original: the
page keeps the stat block as last worked out (`base`), so whatever differs
from it on the page is the director's own change, from any source, and
survives. Opening a variant brings it up to date, and saving the original in
the editor updates its variants; a change from Foundry or the AI page
reaches a variant when one of those happens next. **Where each figure comes
from** lists each figure as from the original, the recipe (with the
original's value), the published formula or the director.

All of it is one system-state key, `variant`, gm half only:

| Page | `gm` |
|------|------|
| recipe | `{v, recipe: {name, part: base\|addon, label, sample, steps: {changes, lists}}}` |
| variant | `{v, follow: {of, parts: [recipe page ids], base}}` |
| original | `{v, children: [variant page ids]}` |

Recipes are found through Chronicle's director-only listing,
`GET /campaigns/:id/system-state/drawsteel/variant`.

### 6.5 Publishing

**Publish** posts the creature to the Community Bestiary
(`POST /bestiary`, private or public) with the page as its source.
The Bestiary widget's **Add to campaign** creates a Creature page from a
Monsters book stat block with every field filled. The Bestiary widget lists
the campaign and the book; it does not read the Community Bestiary.

---

## 7. Reference Data Files

| File | Purpose |
|---|---|
| `data/organization-templates.json` | Published organization modifiers, speed/stability defaults |
| `data/role-templates.json` | Published role modifiers, characteristic suggestions |
| `data/monster-building.json` | Published monster formulas |
| `data/encounter-building.json` | Published encounter strength and budget bands |
| `data/creature-keywords.json` | Keyword definitions and special rules |
| `data/creature-abilities.json` | The ability library: the Monsters book's creature abilities, plus this package's own templates |
| `data/creatures.json` | 35 example creatures, figures per the published formulas (`tools/test-creature-examples.mjs`) |
| `data/ability-keywords.json` | Ability keyword definitions |

Data format: `docs/DATA-SCHEMA.md`.

---

## 8. Open Questions

Not yet synced to Foundry: abilities, villain actions, traits, immunities and
weaknesses (see FOUNDRY-SYNC-MAP.md §8).

---

## 9. Dependencies

| Dependency | In | Notes |
|---|---|---|
| `entity_panels` in the manifest | Chronicle Core | Mounts the stat block under Creature and NPC page titles |
| Widget JS API | Chronicle Core | `Chronicle.register()` |
| Entity custom fields API | Chronicle Core | Reads and writes `fields_data` |
| Community Bestiary addon | Chronicle Core | `internal/plugins/bestiary`: search, stat block, publish |
| Creature fields route (`GET /systems/:systemId/creature-fields`) | Chronicle Core | The Chronicle Sync module reads the preset's Foundry paths from it |
