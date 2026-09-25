# Claude Code Guidelines for Chronicle-Draw-Steel

## Large File Strategy

When creating new files expected to be **over ~200 lines**, do NOT write the entire file in a single Write call. This causes timeouts and stalls. Instead:

1. **Write a skeleton first** (~100-200 lines) with the full structure but placeholder method bodies (`/* placeholder */`)
2. **Fill in methods incrementally** using Edit, one method or small group at a time
3. **Each Edit should be under ~100 lines of new content** to stay within comfortable output limits
4. **Validate syntax** after all edits with `node -c <file>` (JS) or equivalent

This applies to any file: widgets, modules, large configs, etc.

## Project Structure

- `widgets/` - Chronicle widget JS files using `Chronicle.register()` pattern (ES5, `var` not `let/const`, no arrow functions)
- `data/` - Reference JSON data (creature keywords, org templates, role templates, etc.)
- `manifest.json` - Package manifest with categories, entity presets, and widget registrations

## Licensing — two positions, never flattened into one

This package is **not** one licence. Do not write "CC-BY-4.0" as though it
covered the whole thing; that misstatement shipped for months.

- **Draw Steel rules text in `data/`** is reproduced under MCDM's **DRAW STEEL
  Creator License**. Draw Steel has never been released under Creative Commons
  and there is no SRD. Attribution: `DRAW STEEL © 2024 MCDM Productions, LLC`.
  This package cannot sublicense it.
- **This package's own work** — `widgets/*.js`, `tools/*.mjs`, `docs/*`,
  `manifest.json`, and every entry flagged `"source": "custom"` — is CC-BY-4.0.

`LICENSE` states both; `data/NOTICE.md` is the file-by-file attribution and the
authoritative position. `tools/test-licence-claims.mjs` fails CI on an unscoped
Creative Commons mention anywhere in the tree, so a new doc or widget header
cannot quietly reintroduce the incorrect claim.

**Nobody working on this package has read the Creator License** —
`mcdmproductions.com` is unreachable from the authoring environment. The
position is reasoned from this repo's history and the Steel Compendium's
reliance, not verified. **Never invent or paraphrase licence terms**, and leave
the limitation sections in `LICENSE` / `data/NOTICE.md` in place until a human
has read the licence and confirmed.

## Widget Patterns

- All widgets use `Chronicle.register('slug', { init, destroy, ... })`
- Use `Chronicle.apiFetch()` for API calls
- Use `Chronicle.escapeHtml()` for XSS safety
- Reference data is fetched from `/campaigns/:id/systems/drawsteel/data/<file>.json`
  (Chronicle's `SystemDataAPI` — the ONLY route that serves these files; the old
  "extension asset path" bases never had a route behind them and are forbidden by
  `tools/test-widget-data-routes.mjs`). No campaign id → degrade honestly, don't fetch
- Styles injected as `<style>` tag (no separate CSS files for widgets)
- Use CSS custom properties with fallbacks for dark mode: `var(--bg-primary, #fff)`

## Data Format

- All `data/*.json` files MUST be JSON arrays of ReferenceItem objects
- Required fields: `slug` (string, unique), `name` (string), `source` (string — provenance, or the exact string `"custom"`)
- Optional fields: `description` (string), `summary` (string), `properties` (object), `tags` (array)
- Domain-specific fields go inside `properties`, not at root level. The root
  carries only the keys Chronicle's ReferenceItem reads there — `slug`, `name`,
  `summary`, `description`, `properties`, `tags`, `source`. `summary` and
  `source` are root fields because the renderer reads them there and never
  looks in `properties`.
- See `docs/DATA-SCHEMA.md` for full schemas

## Rendering: data has to be shaped for the consumer

Chronicle's reference browser (`internal/systems`) renders a property through
`propString` = `fmt.Sprintf("%v", props[key])`, which returns `""` for an absent
key and Go-syntax garbage (`map[…]`, `[…]`, `<nil>`) for anything that is not a
scalar. It only shows categories declared in `manifest.json`. So:

- **A manifest field key must exist in the data and hold a scalar.** A key that
  doesn't renders as a blank column and a missing detail row, silently — this is
  the defect that shipped 632 correct entries with an empty Traits column.
- **A data file with no manifest category is invisible entirely.**
- Nested values get a generated scalar `<key>_display` twin; the manifest points
  at the twin, widgets keep reading the structured value.
- **`{@category term}` markup is not a renderer contract Chronicle knows.** Only
  `widgets/reference-renderer.js` resolves it; `propString` prints it verbatim,
  so 435 of 519 abilities printed `{@combat dying}` mid-sentence — right data,
  wrong renderer, every test green. A key carrying markup anywhere in its file
  gets a `_display` twin **even when it is already a scalar**, and the manifest
  points at the twin. Only the twins (plus the derived `summary`) are flattened:
  the structured value and the root `description` keep their markers, because
  stripping them at source would delete the tooltips to fix the flat text. The
  decision is per file, not per entry — a per-entry verdict would declare the
  bare key whenever the first carrier happened to be marker-free.

**After editing `data/*.json` by hand, run `node tools/build-render-fields.mjs`.**
It regenerates the derived fields AND `manifest.json`'s `categories` from the
single `CATEGORIES` declaration in `tools/_render-fields.mjs`.
`tools/test-render-contract.mjs` fails CI on any of the above.

## The builder's math must carry its own provenance

The monster builder computed four figures with numbers this package invented —
`ev_multiplier × level` for encounter value, `stamina_base + stamina_per_level ×
level` for Stamina, `partySize × partyLevel × 4` for the encounter budget, and
`data/damage-baselines.json` (whose own `source` is the literal string
`"custom"`) for ability damage. They ran up to **1.67×** the published encounter
value, **2.3×** on Stamina and **2.4×** on damage — and a panel headed
"Validation" presented them to a director as balanced. Wrong numbers wearing a
green tick are worse than no numbers.

- **`widgets/monster-formulas.js` (`DrawSteelFormulas`) is the only place the
  published formulas are evaluated.** Every return is
  `{ value, sourced, source, notes }`. `sourced: false` means the published data
  does not cover this input and `value` is `null` — the module never returns a
  plausible-looking guess.
- **A caller that renders an unsourced figure MUST say so in the UI.** That is
  what the flag is for. `_recalcAuto` records per-figure provenance on
  `this._provenance`, the checks panel emits it as `severity: 'provenance'`
  rows, and Step 3 labels the Stamina hint either "published formula:" or
  "unsourced estimate:".
- **The panel is titled "Completeness checks", never "Validation".** It carries
  a standing, unconditional line saying it is not a balance check — an empty
  panel used to read as a clean bill of health. A deviation warning is raised
  only against a figure the published formulas can actually produce.
- **Swarm is not a published organization** (it is a creature keyword); its
  `organization_modifier` and `stamina_organization_modifier` are `null`, and it
  is the reason the legacy tables still exist at all — as a labelled fallback,
  never a silent default.
- Pinned by `tools/test-monster-formulas.mjs` (the module against the shipped
  `monster-building.json` / `encounter-building.json`) and
  `tools/test-monster-builder-honesty.mjs` (the widget's claims). A full rebuild
  of the builder is separate work — do not treat this as the rework.

## @Reference Syntax

- Use `{@category term}` in text fields for rule cross-references
- Categories: `condition`, `movement`, `duration`, `resource`, `action`, `combat`
- Every term must have a matching entry in `data/rules-glossary.json`
- Display override: `{@condition taunted|taunts}` renders as "taunts"
- The shared utility `widgets/reference-renderer.js` handles parsing/rendering

## Manifest

- No `"version"` field — version comes from GitHub release tags
- `"api_version": "1"` is the API compatibility version (separate concept)
- Widget entries use `"script_file"` (not `"file"`) for JS paths
- `"text_renderers"` section is forward-compatible (Chronicle platform support pending)
