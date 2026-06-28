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
   - **(2) Character-specific** — computed for *this* hero: their power-roll math
     (`2d10 + best characteristic`), average → tier, the tier they'll most likely hit,
     and any class-ability specifics. ⚠️ **Pending a rules audit** (below) to confirm
     how useful/feasible this is given Draw Steel mechanics.
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
- **Rules audit** — research Draw Steel mechanics to confirm the per-character
  computed section (#3.2) is genuinely useful: power-roll = `2d10 + characteristic`,
  tier bands (≤11 / 12–16 / 17+), edges/banes, surges, etc. Decide what's worth
  computing vs. noise.
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
