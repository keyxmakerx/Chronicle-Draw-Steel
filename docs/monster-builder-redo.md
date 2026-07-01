# Monster Builder Redo — Party-Aware Design

> Status: **DRAFT for review.** This is a design proposal, not shipped code.
> It captures the target architecture for a complete rebuild of the Draw Steel
> monster builder, centered on integrating the campaign **party** (the player
> heroes) so a director can build monsters that *complement* them.
>
> Nothing here requires a new Chronicle backend endpoint — the party is already
> reachable through the existing syncapi, and the encounter-value data we need is
> already shipped in `data/` (currently loaded but unused). The work is almost
> entirely client-side.

---

## 1. Why redo it

The current builder (`widgets/monster-builder.js`, ~1750 lines) is a competent
7-step stat-entry wizard, but it is **party-blind**: the only "party" it knows is
two hand-typed numbers in an encounter calculator (`partySize`, `partyLevel`),
and its budget math is a crude `partySize * partyLevel` that just suggests copies
of one creature. It never reads a single real hero.

Meanwhile we *just* built the character sheets, so every campaign now has
first-class hero entities (`drawsteel-character`) with level, characteristics,
stamina, defenses, immunities/weaknesses, size, and speed — exactly the data a
director reasons about when statting an encounter. The redo's thesis:

> **The party is the design input.** A monster's level band, EV budget,
> organization tier, role, attack profile, and damage types should all be
> *suggested from the live party* and then hand-tunable — not typed from scratch.

### Current weaknesses (concrete, from the audit)
- **No party awareness.** `_encounterState = {partySize:4, partyLevel:level}` is
  hand-typed (`monster-builder.js:64`, `1225–1269`); budget is `partySize*partyLevel`.
- **Org logic hardcoded to string literals** `'leader'`/`'solo'` (`:434,499,513,1291`)
  instead of the data-driven `villain_action_count`; the `hero_ratio` field in the
  org templates is loaded but **never used**.
- **Abilities are fully manual.** `damage-baselines.json` only prints hint strings;
  it never fills ability tiers. **Potency** (a core DS mechanic) is computed nowhere.
- **`data/creatures.json`** (35 authored statblocks) is shipped but never loaded —
  there is no "start from an existing creature" path.
- Full-DOM re-render churn; save blocks on the first validation error via `alert()`.

---

## 2. What already exists (reuse, don't rebuild)

### Data (all in `data/`, already shipped)
| File | Provides | Party-relevance |
|------|----------|-----------------|
| `organization-templates.json` | 7 orgs w/ `ev_multiplier`, `stamina_base`, `stamina_per_level`, `default_speed/stability`, `villain_action_count`, **`hero_ratio`** | `hero_ratio` (minion 8:1 … solo 1:6) is the canonical "how many heroes is this worth" knob |
| `role-templates.json` | 9 roles w/ `primary_stat` + 5-value characteristic spread | role choice vs party defenses |
| `damage-baselines.json` | per-org per-tier damage (`tier1/2/3` + `per_level`) | fills ability tiers at the party's level band |
| `creature-keywords.json`, `ability-keywords.json` | keyword multiselects | unchanged |
| `creatures.json` | 35 authored statblocks | "start from existing" seed |

### The persisted model
`drawsteel-creature` preset (`manifest.json`) — unchanged target for saving.

### The party is reachable *today* (no new endpoints)
Widgets authenticate as the logged-in director via `Chronicle.apiFetch`
(session cookie, same-origin). The **syncapi** returns full entities with
`fields_data` inline:

1. **Resolve the hero type id:**
   `GET /api/v1/campaigns/:cid/entity-types` → find the type whose
   `slug === 'drawsteel-character'` (or `preset_category === 'character'`), read its
   numeric `id`.
2. **List the party with stats:**
   `GET /api/v1/campaigns/:cid/entities?type_id=<id>&per_page=100` → each entity
   carries `fields_data` keyed by field slug (`level`, `might`, `agility`, `reason`,
   `intuition`, `presence`, `stamina_max`, `stability`, `speed`, `size`,
   `save_threshold`, `immunities`, `weaknesses`, …).

> **Two gotchas to bake in:** (a) `?preset=…` is a **dead query param** — the server
> filters only on numeric `type_id`, so we must resolve the id first; (b) the
> *entities-plugin* web list (`/campaigns/:id/entities`) returns a trimmed item map
> **without** `fields_data` — only the **syncapi** list carries stats. Use syncapi.

Save path is unchanged: `PUT/POST /api/v1/campaigns/:cid/entities` with the
`drawsteel-creature` `fields_data`; optional publish to the community bestiary via
`POST /bestiary`.

---

## 3. The "complement the party" engine (the new core)

A pure module — `deriveParty(heroes)` → `PartyProfile`, then
`suggest(partyProfile, intent)` → `MonsterSuggestion`. Pure functions, unit-testable
off-DOM (same CommonJS test seam the character sheet uses).

### 3.1 PartyProfile (derived from `fields_data`)
```
size            = heroes.length
levelAvg        = mean(level)              // → monster level band + EV budget
levelSpread     = [min, max] level
defenses        = per-characteristic party averages (might…presence)
weakestDefense  = the characteristic the party is lowest in   // attack this
staminaAvg      = mean(stamina_max)        // pacing / burst sizing
immunities      = union of hero damage immunities  // AVOID these damage types
weaknesses      = union of hero damage weaknesses  // LEAN INTO these
speedRange      = [min,max] speed          // mobility gap to exploit or respect
sizeSpread      = tokens the party fields  // area-effect sizing
```

### 3.2 Suggestion logic (all data-driven, no hardcoded org names)
- **Level band** ← `round(levelAvg)`, clamped to the encounter intent.
- **EV budget** ← Draw Steel encounter math: budget scales with party size and
  level; each monster's contribution is `ev_multiplier × level`, and the org's
  `hero_ratio` tells us how many of that org tier equal one hero. This *replaces*
  `partySize*partyLevel` with a grounded budget and a "you've spent X / Y EV" meter.
- **Organization** ← pick tiers that fit the remaining budget (e.g. a swarm of
  minions vs one solo), using `hero_ratio` + `villain_action_count` (not string
  matches) so a solo/leader correctly unlocks villain actions.
- **Role** ← choose a role whose `primary_stat` power-roll targets the party's
  **weakestDefense** (an artillery/hexer that hits the party's dump stat is
  "complementary" — it punishes their gap).
- **Damage types** ← prefer types the party is **weak** to; **never** default a
  monster's damage to a type the whole party is **immune** to (surface a warning
  if the director picks one anyway).
- **Ability tiers** ← auto-fill from `damage-baselines.json` at the chosen level
  band (the tier1/2/3 numbers), then let the director tune. Compute **potency**
  from the monster's characteristic vs the target defense.

Every suggestion is a **starting point with a one-click "why"** (e.g. "Artillery —
targets Agility, the party's weakest defense (avg 0)") and is fully overridable.

---

## 4. Proposed architecture

Keep it a Chronicle widget (`Chronicle.register('monster-builder', …)`), ES5, but
restructure around a small state store + pure engine + thin render, instead of the
current full-DOM re-render wizard.

```
widgets/
  monster-builder.js        # shell: register, state store, tab routing, save
  monster-party.js          # NEW pure module: fetchParty() + deriveParty() → PartyProfile
  monster-engine.js         # NEW pure module: suggest(partyProfile,intent) → MonsterSuggestion
                            #   + EV/potency/tier math (data-driven, unit-tested)
  statblock-renderer.js     # reuse (read-only statblock display)
```

- **`monster-party.js`** — one job: resolve the hero type id, fetch heroes via
  syncapi, and reduce `fields_data` to a `PartyProfile`. Degrades gracefully to
  "no party found → manual mode" (keeps today's hand-typed inputs as a fallback).
- **`monster-engine.js`** — all the math from §3, pure and testable. This is where
  the design value lives; it must be covered by the same off-browser harness we use
  for the character sheet.
- **`monster-builder.js`** — becomes a shell: a **Party panel** (shows the derived
  profile + "Build to complement" button), the existing stat tabs (now pre-filled
  from suggestions), a live **EV budget meter**, and the save/publish flow.

### New UX spine
1. **Party panel** (top): auto-loaded party, derived profile, intent selector
   (trivial / standard / hard / boss), and "Suggest a monster / encounter."
2. **Suggestion → editable statblock**: every field pre-filled with a rationale
   chip; nothing locked.
3. **EV meter**: live "spent / budget" as you add creatures to an encounter.
4. **Save** as `drawsteel-creature` entity (+ optional bestiary publish), non-blocking
   validation (inline warnings, not `alert()`).

---

## 5. Phased plan

- **Phase 0 — Party read (no UI change to stats):** build `monster-party.js`
  (`fetchParty` + `deriveParty`), add a read-only Party panel that displays the
  derived profile. Ships value immediately (director sees the party at a glance)
  and de-risks the data path. Unit-test `deriveParty` against sample `fields_data`.
- **Phase 1 — EV budget grounded in real data:** replace `partySize*partyLevel`
  with the `hero_ratio`/`ev_multiplier` budget; add the live EV meter. Kill the
  hardcoded `'leader'`/`'solo'` literals in favor of `villain_action_count`.
- **Phase 2 — Suggestion engine:** `monster-engine.js` → level band, org, role
  (vs weakest defense), damage types (vs immunities/weaknesses), auto-filled tiers
  + potency. "Build to complement the party" button.
- **Phase 3 — Polish:** "start from `creatures.json`" seed, statblock preview,
  encounter assembly (multiple creatures against one budget), non-blocking save.

Each phase is independently shippable and testable off-DOM.

---

## 6. Open design decisions (need your call)

1. **Monster vs Encounter scope.** Is the redo a *single-monster* builder that's
   party-aware, or a full *encounter* builder (a budgeted set of monsters for the
   party)? The engine supports both; the UI spine differs. (Recommendation: build
   the single-monster party-aware path first, then layer encounter assembly in
   Phase 3 — the EV meter is the bridge.)
2. **How opinionated should suggestions be?** Auto-fill everything and let the
   director tune (fast, "magic"), or suggest-on-demand per field (more control)?
   (Recommendation: auto-fill with visible rationale + one-click override.)
3. **"Complement" definition.** Confirm the intent: monsters that *punish the
   party's weaknesses* (attack lowest defense, exploit damage weaknesses, respect
   immunities)? Or monsters that *thematically pair* with the party's makeup? The
   mechanical reading is what the data supports today.
4. **Party source when heroes aren't claimed/synced.** If a campaign has no
   `drawsteel-character` entities yet, fall back to the manual `partySize/partyLevel`
   inputs (keep them), or block until a party exists? (Recommendation: graceful
   fallback to manual.)
5. **Bestiary reuse.** Should suggested monsters be seedable *from* the community
   bestiary (pull an existing statblock, re-scale to this party), in addition to
   `creatures.json`?

---

## 7. What this does NOT need
- **No new Chronicle Go endpoints.** Party read = existing syncapi
  (`entity-types` + `entities?type_id=`); save = existing entity write; EV data =
  already in `data/`. Any backend work would be optional niceties, not blockers.
- **No manifest schema change** for the creature model (the `drawsteel-creature`
  preset already holds everything we persist).

---

*Companion references: `docs/monster-builder.md` (current builder + DS formulas),
`docs/DATA-SCHEMA.md` (data file schemas), `widgets/character-sheet.js` (the party
data model + `fields_data` access pattern + off-DOM test harness to mirror).*
