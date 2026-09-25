# Draw Steel Character Sheet — Design Decisions & Roadmap

> The single source of truth for the hero character-sheet widget
> (`widgets/character-sheet.js`). Read this before redesigning anything so we
> don't relitigate settled decisions. Updated as decisions are made.

## 🧪 Testing (no live client needed)

The widget's pure logic — the "For \<hero>" odds (`tierOdds`), damage-formula
resolution (`substituteFormula`/`tierFragments`), ability grouping (`groupOf`), the
feature-origin classifier (`classifyFeature`), skill grouping, and the label
humanizers — is unit-tested in `tools/test-character-sheet.mjs`
(`node --test tools/test-character-sheet.mjs`). The widget is a browser IIFE that
exports these helpers via `module.exports` off-browser (the `Chronicle.register`
side-effects are guarded on a null `Chronicle`), so Node can import and test them
with zero change to runtime behavior. Visuals are checked by rendering the **real**
widget headlessly against mock data (see the scratch `ability-harness`).

## 📸 Reference renders

Headless renders of the **real widget** (not mockups) against mock Phase-C data —
update these when the design changes.

| | |
|---|---|
| Full sheet (all sections) | `docs/images/character-sheet-full.png` |
| Ability card — expanded ("For \<hero>" odds) | `docs/images/ability-card-expanded.png` |
| Ability rail — long list (filter + collapsed Maneuvers) | `docs/images/ability-rail-long-list.png` |

![Full character sheet](images/character-sheet-full.png)

---

## 🎯 AGREED ABILITY-SECTION DESIGN (the model we settled on)

**FINAL LOCKED SHAPE — do NOT redesign:**

1. **Bare master–detail ("Option D"), monochrome.** A grouped list (master) + a detail
   pane. The aesthetic is **minimal/restrained**: dark grayscale with a SINGLE violet
   accent only (SIG badge, selected-row edge, glossary links). **No color-coded tier
   bands, no action glyphs, no gradient chrome** in the resting/default views.
   - **List** — plain rows: name + cost, grouped (Signature / Heroic / Maneuvers). The
     selected row gets a subtle accent left-edge; maneuvers/free-strikes are dimmed.
   - **Resting** (nothing selected) — the pane shows a quiet **"Select an ability"** prompt.
2. **Two zoom levels in the detail pane — and NO expand button:**
   - **Default = an even-smaller BARE card.** Click a list row → the pane fills with a
     small card: header line (name · `Sig` · cost) + three **plain** tier lines
     (≤11 / 12–16 / 17+), glossary `{@terms}` in accent. That's it — no color bands,
     no footer note, no button.
   - **Hover the card → it lifts + glows** (a transform/shadow animation) to signal it's
     clickable, with a faint "click to expand" hint. The **whole card is the click target.**
   - **Click → it grows into the bigger card via animation** (the two-section card below).
3. **The grown (big) card has TWO sections:**
   - **(1) General info** — the rules, identical for everyone (keywords, distance,
     target, power-roll characteristics, the tier ladder text).
   - **(2) Character-specific ("For \<hero>")** — computed for *this* hero. Power roll
     = `2d10 + characteristic` (the ability's
     named one, or the higher when it says "X or Y"); tiers ≤11 / 12–16 / 17+ compared to
     the final total; **nat 19–20 = auto Tier 3**. Show these four STATIC, ship-now values:
     1. **Roll expression** — `2d10 + N (Characteristic)` using the hero's best applicable.
     2. **Resolved per-tier damage** — substitute the hero's characteristic into each tier's
        `base + C`, plus the **kit** bonus per tier (melee bonus if Melee+Weapon, ranged if
        Ranged+Weapon). *Headline value.* (Kit/keywords need Phase C; ship the `+C` part now.)
     3. **Average → tier** — `11 + mod` → band (e.g. +2 → 13 → Tier 2).
     4. **Tier odds** — `T1 % / T2 % / T3 %` from a precomputed `mod → distribution` lookup,
        with the nat-19/20 auto-Tier-3 floor folded in.
     - **Affordability** (`cost vs current resource`) is gated — current resource is live
       combat state, not static sheet data → render only when present.
     - **Do NOT compute**: hit/miss vs defenses (no AC in DS), target state, edges/banes
       (situational). These make the card wrong more often than right.
4. **Grouping** — the character's class/signature abilities up top; the universal
   maneuvers / free strikes / basic actions in a **collapsed/dimmed** group below
   (Foundry hands over ~21 ability items including universal ones).
5. **Glossary lookup card** (the small `{@term}` definition popover) — inside ANY card,
   rule terms like `{@condition slowed}` / `{@move shift}` render as dashed-underlined,
   **category-color-coded** links (Condition = amber, Movement = blue, Resource = purple,
   Duration/Action/Combat = their own tints). Hover (desktop) / tap (mobile) → a SMALL
   floating definition card: the term **name** + a **category chip** + its **definition**
   + a "Draw Steel · \<category>" source line. Pulled from `data/rules-glossary.json` via
   `widgets/reference-renderer.js`. Self-contained (never reflows the sheet); the same
   lookup works everywhere `{@…}` appears (ability text, features, lore). This is a
   distinct, smaller popover from the ability card — it explains *what a word means*.
6. **Sizing — keep the cards NARROW.** The detail cards (small AND grown) are
   **width-constrained** (≈ max-width 520–560px), left-aligned in the detail pane — they
   do NOT stretch to fill the whole pane/column. ("Too wide" was the note; a tight card
   reads better and matches the bare aesthetic.)
7. **Responsive** — desktop = split (list + detail); mobile = the list, and tapping
   opens the small→grown card as a **bottom drawer**.
8. **Long lists ("tons in the list").** A hero carries their whole kit *plus* every
   universal maneuver (~21 rows), so the rail must not sprawl. Three measures, all in
   the bare aesthetic:
   - **Capped scroll** — the rail is a fixed-max-height (~460px) scroll area, so the
     list scrolls *inside itself* and never shoves the detail pane down, no matter the
     count.
   - **Collapsible groups** — each group header is a toggle (caret + a count badge);
     on a **long list (≥10)** the dim **Maneuvers** group starts **collapsed** (its ~16
     universal actions folded away), Signature/Heroic stay open. Click any header to
     fold/unfold.
   - **Filter box** — a sticky "Filter abilities…" input appears on long lists; typing
     narrows rows live, hides emptied groups, and force-opens collapsed groups so a
     match inside Maneuvers still surfaces.

---

## 🧩 THE OTHER SECTIONS (each UI fit to its data — NOT a cloned ability card)

Phase C syncs far more than abilities; every field gets a renderer shaped to its
content. The principle: *vary the UI by what the data is.*

- **Skills** (own box) — trained skills as compact chips **grouped by the five Draw
  Steel skill groups** (Crafting / Exploration / Interpersonal / Intrigue / Lore),
  mirroring the official sheet; ids humanized (`handleAnimals` → "Handle Animals"). An
  unknown id lands in an "Other" bucket rather than vanishing. (Hardcoded group map in
  the widget; a `data/skills.json` catalog is the eventual home if it needs to drift.)
- **Kit** (own box) — a **stat box**: the melee/ranged damage-tier mini-ladder
  (≤11 / 12–16 / 17+) + flat bonus chips (stability / speed / stamina / disengage). Kit
  is reference stats, so it is NOT a clickable card.
- **Origin** — Culture + Career fold into the header subtitle line
  (ancestry · culture · career · class (subclass) · kit).
- **Vitals** — Surges as a statline alongside the heroic-resource pips.
- **Combat** — Size + Disengage chips, plus a compact **Potency strip** (weak / avg /
  strong thresholds); conditions render Title-cased from the `actor.statuses` ids.
- **Damage / Progression** — existing chip layouts (immunities/weaknesses;
  xp/victories/renown/wealth) now actually fed by Phase C paths.

- **Features** (own box) — built as a **defensive framework**, because Foundry stores
  class/ancestry/kit/culture/career features all as generic `feature` items and a feature
  does **not** record which item granted it (`system.source` is the publication book).
  So instead of trusting one field: `features_json` projects every feature
  (name / description / level / `_dsid` / source book), and the renderer **classifies**
  each by matching its `_dsid`/name against the hero's KNOWN origin names (class, ancestry,
  kit, culture, career — already synced), bucketing into those groups. Anything it can't
  place lands in a generic **Features** group; if *nothing* classifies, it renders ONE flat
  list rather than fake headers. Each feature is a native `<details>` accordion (name +
  level → description on expand), so a long list collapses with zero JS. The classifier is
  a heuristic — it tightens once live data shows which signal truly carries the origin, but
  it already works (ungrouped at worst). Legacy `*_features_json` kept as a fallback.

---

## 🧭 2026-06-28 decisions

**Purpose of the sheet (sets priorities):** it is primarily a **DM reference** — so a
director can look up a player's abilities/stats/defenses while **building monsters**
(the monster builder) or writing notes. ⇒ favor **data completeness** over
interactivity. Rolls etc. are a someday-thing.

**Decisions (locked with the user):**
- **Action buttons** (Roll / Level Up / Share / Roll Might) — stay as visible
  "construction tape"; clicking shows a transient *"coming later"* toast. No rolling
  for the foreseeable future (no roll endpoint in the read-only contract anyway).
- **Combat-tracker fields** (initiative / in-combat / round) — **dropped from the
  sheet.** Draw Steel uses **alternating activation** (no initiative roll); turn order
  belongs on the **Character viewer page**, not the reference sheet.
- **Treasures** — **yes, surface them.** DS Treasures are the magic-item system (one
  Foundry `treasure` item type, `category` = consumable | trinket | leveled | artifact;
  + kind / echelon / keywords / quantity). They change what a hero can DO in a fight, so
  they're high DM-reference value. Render grouped by category.
- **Write-back (Chronicle → Foundry)** — a **careful FUTURE epic**, not now. Scope:
  notes/backstory first; **items only when fully synced**; on a sync failure, notify the
  **player** lightly ("this item isn't synced") and the **owner** with detail, and emit
  an **error dump into the AI diagnostics workspace** (the operator batch tooling). Until
  built, the contract is **one-way read-only mirror** (Foundry is source of truth).
- **Glossary + skills source** — build from **steelcompendium.io** (GitHub org
  `SteelCompendium/data-md`): current DS **1.0** ruleset, machine-extractable Markdown+
  YAML, **no scraping**. Licensed under MCDM's **Draw Steel Creator License** — quoting
  rules text in our open-source `data/*.json` is permitted **provided** we include the
  verbatim DSCL attribution `NOTICE` and don't imply MCDM endorsement. (That is this
  project's position, not a checked reading of the licence: see the caveat in
  `data/NOTICE.md` and #53.) Pin a commit SHA.
  Conditions (9) + skills (~55, grouped, with descriptions) come out cleanly; ability
  **keywords** (Magic/Melee/Ranged/Weapon/Strike/Area/Charge…) are NOT discrete files →
  curate ~10–15 by hand once.

**DM-reference completeness, priority order for a DM building a monster (all
shipped):** movement modes (`system.movement.types`, `.hover`), defenses/save
(`system.combat.save.threshold` + `.bonus`), damage immunity/weakness values
per type (`system.damage.{immunities,weaknesses}`, not just the blanket
`all`), status/condition immunities (`system.statuses.immunities`), Treasures
(grouped by category), Perks and Titles (in Features), Languages (in Skills),
and triggered reactions/reach as a top-line stat.

`data/skills.json` (57 skills) and the ability-keyword entries in
`data/rules-glossary.json` come from the Steel Compendium under the DSCL
(`data/NOTICE.md`). Skill chips and keyword badges show definition tooltips;
`reference-renderer.scanText()` + `refSynced()` wrap bare condition names in
synced prose so the glossary fires on real heroes.

Open work: mobile bottom drawer for abilities (#51), glossary keyboard/touch
accessibility — tooltips are hover/focus only today (#52), auto-linking
movement terms in synced prose — only conditions are auto-scanned today by
design (#56), live-checking non-damage ability tier text against a re-synced
hero (#55), and the character write-back epic, Chronicle edits flowing to
Foundry (Chronicle-Foundry-Module#96).

---

## 🚫 DO NOT WANT (explicitly rejected — don't re-propose)

- **Hover-to-open** the main ability card — there are too many abilities; the main card
  opens on **click**, not hover. (Hover is reserved for the small glossary tooltips.)
- **Inline accordion dropdowns** for ability detail (the old v3 behavior) — replaced by
  the detail pane / expand card. "Actions shouldn't be dropdowns."
- **The full C statblock as the default detail** — too heavy. C is **opt-in** via the
  expand action only; the default detail stays compact/at-a-glance.
- **A big always-expanded ability wall** (every ability fully rendered at once).
- **Actions rendered as dropdown menus.**

---

## ❓ OPEN QUESTIONS (decide before/at build time)

- **Empty state** of the detail pane: a "Select an ability" prompt, **or** auto-open the
  first/most-used ability so it's never blank? (Leaning: auto-open.)
- **Generic maneuvers** — collapse/dim them (current plan) vs. hide them entirely?
