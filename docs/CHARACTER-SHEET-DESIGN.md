# Draw Steel Character Sheet — Design Decisions & Roadmap

> The single source of truth for the hero character-sheet widget
> (`widgets/character-sheet.js`). Read this before redesigning anything so we
> don't relitigate settled decisions. Updated as decisions are made.

---

## ✅ DONE (shipped / merged / on-branch)

- **Phase A data fixes** (manifest) — corrected wrong `foundry_path`s and added an
  ability projection. **Confirmed live**: a re-synced hero now shows `Level 1`,
  `Conduit (Life)` (class + subclass collapsed to names), the `PIETY` heroic-resource
  label, and the full ability list. See `FOUNDRY-SYNC-MAP.md`.
- **v3 sheet scaffold** — always-render sections, graceful placeholders, responsive.
- **v3.1 polish** — violet accent (overridable `--ds-accent`), composite Vitals box
  (stamina + recovery dots + HR pips + Roll), characteristics grid, Combat box, GM Lore.
- **v3.2 affordance** — collapsible boxes read as clickable (hover lift, caret).
- **Operator diagnostics workspace** + sync-map doc (debugging "where data dies").
- **Foundry dashboard** — reliable reopen + "Sync Everything Now" (journals +
  linked characters + maps).

---

## 🎯 AGREED ABILITY-SECTION DESIGN (the model we settled on)

The Abilities section is the focus of the next build. Settled shape:

1. **Master–detail ("D") is the default and the end-all.** A grouped list + a detail
   view. Not a wall of cards, not inline dropdowns.
2. **Three zoom levels:**
   - **List row** — one tidy line (name + cost), at a glance.
   - **Compact detail** — selecting a row shows a SMALL at-a-glance card: name, cost,
     one line of meta, and just the *likely result*. This is the everyday view.
   - **Expanded card (opt-in)** — clicking the *body* of the compact detail expands it
     to the full statblock ("C"), with a subtle **floating animation** to signal the
     expand. Closes back to the compact view.
3. **The expanded card has TWO sections:**
   - **(1) General info** — the rules, identical for everyone (keywords, distance,
     target, power-roll characteristics, the tier ladder text).
   - **(2) Character-specific ("For \<hero>")** — computed for *this* hero. The rules
     audit (✅ done) locked the spec. Power roll = `2d10 + characteristic` (the ability's
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
5. **Glossary `{@term}` hover-overs** — terms are dashed-underlined and **color-coded by
   rule category** (Condition = amber, Movement = blue, Resource = purple, …). Hover
   (desktop) / tap (mobile) → a small definition card (name + category chip + definition
   + source), pulled from `data/rules-glossary.json` via the reference-renderer.
6. **Responsive** — desktop = split (list + detail); mobile = the list, and tapping
   opens the compact/expanded card as a **bottom drawer**.

---

## 🛠️ WANT TO DO (planned, not yet built)

- **Build the ability section** per the model above in `character-sheet.js`
  (replaces the current inline-accordion ability rows).
- ~~Rules audit~~ — ✅ **DONE**; the locked "For \<hero>" spec is in the agreed-design
  section above (4 static computed values + affordability gated + an exclude list).
- **Phase C sync expansion** (manifest + Foundry adapter), needed to fully feed the
  cards:
  - Ability **keywords** (a Foundry `Set` → serialize to array) and the **tier ladder**
    text (lives in `system.power.effects`, a collection — more than scalar fields).
  - **Skills**, **kit details**, **culture/career**, **conditions** from active effects.
  - **Inventory** — a separate path (item entities + `has-item` relations via
    item-sync), NOT actor fields; won't appear from a character re-push.
- **"For Tyne" math** switches on once the power-roll characteristics sync (Phase C).
  Until then, ship the card *without* the character-specific strip.

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
- Outcome of the **rules audit** → final shape of the character-specific card section.

---

*Mocks that informed these decisions live in the working scratchpad
(`ability-options`, `ability-zoom`, `ability-hybrid-*`, `glossary-hover`).*
