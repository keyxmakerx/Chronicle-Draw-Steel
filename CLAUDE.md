# Claude Code Guidelines for Chronicle-Draw-Steel

## Large File Strategy

For any new file expected over ~200 lines (widget, module, config), don't write it in one Write call — it times out. Write a skeleton first (~100-200 lines, placeholder method bodies), fill in methods incrementally with Edit (under ~100 new lines per edit), then validate with `node -c <file>`.

## Project Structure

`widgets/` - Chronicle widget JS (ES5, `var` not `let/const`, no arrow functions), via `Chronicle.register()`. `data/` - reference JSON (creature keywords, org templates, role templates, etc.). `manifest.json` - package manifest: categories, entity presets, widget registrations.

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
has read the licence and confirmed (#53).

## Widget Patterns

- Widgets use `Chronicle.register('slug', { init, destroy, ... })`, `Chronicle.apiFetch()` for API calls, `Chronicle.escapeHtml()` for XSS safety.
- Reference data comes only from `/campaigns/:id/systems/drawsteel/data/<file>.json` (Chronicle's `SystemDataAPI`; old "extension asset path" bases have no route and are forbidden by `tools/test-widget-data-routes.mjs`). No campaign id → degrade honestly, don't fetch.
- Styles are an injected `<style>` tag, no separate CSS files. Use CSS custom properties with dark-mode fallbacks: `var(--bg-primary, #fff)`.
- Comments say why, briefly, in a few lines: the rule the code obeys and why. No incident stories, task IDs, dates or `file:line` pointers (those go in the PR); deferred work is `TODO(#issue)`. Licence and formula-provenance comments keep their meaning.

## Data Format

- Every `data/*.json` file is a JSON array of ReferenceItem objects. Required: `slug` (unique string), `name` (string), `source` (provenance string, or the exact string `"custom"`). Optional: `description`, `summary`, `properties` (object), `tags` (array).
- Domain-specific fields go inside `properties`, not at root — the root carries only the keys ReferenceItem reads there (`slug`, `name`, `summary`, `description`, `properties`, `tags`, `source`). `summary`/`source` are root fields because the renderer reads them there, never inside `properties`.
- Full schemas: `docs/DATA-SCHEMA.md`.

## Rendering: data has to be shaped for the consumer

Chronicle's reference browser (`internal/systems`) renders a property via `propString` = `fmt.Sprintf("%v", props[key])`: `""` for an absent key, Go-syntax garbage (`map[…]`, `[…]`, `<nil>`) for anything not a scalar. It only shows categories declared in `manifest.json`. Rules:

- A manifest field key must exist in the data and hold a scalar, or it renders as a silent blank column and missing detail row.
- A data file with no manifest category is invisible entirely.
- Nested values get a generated scalar `<key>_display` twin; the manifest points at the twin, widgets keep reading the structured value.
- `{@category term}` markup (below) is not a contract `propString` knows — only `widgets/reference-renderer.js` resolves it; `propString` prints it verbatim. A key carrying markup anywhere in its file gets a `_display` twin **even if already scalar**, and the manifest points at the twin. Only the twins (plus derived `summary`) are flattened; the structured value and root `description` keep their markers for the tooltips. The decision is per file, not per entry.

After editing `data/*.json` by hand, run `node tools/build-render-fields.mjs`: it regenerates the derived fields and `manifest.json`'s `categories` from the single `CATEGORIES` declaration in `tools/_render-fields.mjs`. `tools/test-render-contract.mjs` enforces all of the above in CI.

## The builder's math must carry its own provenance

The monster builder derives four figures (encounter value, Stamina, encounter
budget, ability damage). Some inputs (e.g. `data/damage-baselines.json`, whose
own `source` is the literal string `"custom"`) are this package's own numbers,
not MCDM's — a figure built from them is an estimate, not a published result,
and must say so.

- `DrawSteelFormulas` in `widgets/monster-engine.js` is the only place published formulas are evaluated. Every return is `{ value, sourced, source, notes }`; `sourced: false` means published data doesn't cover this input and `value` is `null` — never a plausible-looking guess.
- A caller that renders an unsourced figure must say so in the UI: `_recalcAuto` records per-figure provenance on `this._provenance`, the checks panel emits it as `severity: 'provenance'` rows, and Step 3 labels the Stamina hint either "published formula:" or "unsourced estimate:".
- The panel is titled "Completeness checks", never "Validation", with a standing, unconditional line saying it is not a balance check. A deviation warning fires only against a figure the published formulas can actually produce.
- Swarm is not a published organization (it's a creature keyword); its `organization_modifier` and `stamina_organization_modifier` are `null` — the reason the legacy tables still exist, as a labelled fallback, never a silent default.
- Pinned by `tools/test-monster-formulas.mjs` (module vs. shipped `monster-building.json` / `encounter-building.json`) and `tools/test-monster-builder-honesty.mjs` (widget's claims). A full builder rebuild is separate work (#50).

## @Reference Syntax

`{@category term}` in text fields marks a rule cross-reference; categories are `condition`, `movement`, `duration`, `resource`, `action`, `combat`. Every term needs a matching entry in `data/rules-glossary.json`. Display override: `{@condition taunted|taunts}` renders as "taunts". `widgets/reference-renderer.js` handles parsing/rendering.

## Manifest

No `"version"` field (comes from GitHub release tags); `"api_version": "1"` is a separate API compatibility version. Widget entries use `"script_file"`, not `"file"`. `"text_renderers"` is forward-compatible (Chronicle platform support pending).

## Working with this project

These rules come from the old coordination repo (Cordinator), which is now a
frozen archive. The same block is in the CLAUDE.md of Chronicle, the Foundry
module and the Draw Steel package; change all three together. The binding
tenets the PR templates name (T-B1 security first, T-B2 plugin isolation, T-B3
production-grade UI, T-B4 docs for humans and AI alike) are defined in
Cordinator's `decisions/2026-05-21-core-tenets.md`.

**With the operator** (the maintainer, who reviews and deploys):
- Explain things in plain language, without code. Give each trade-off in one sentence.
- Give live checks as click-paths: the exact URL, what to click, and what working
  and broken look like. Docker, OS and network commands are fine; never ask the
  operator to read code or run a test suite.
- The operator checks things later, not while you wait. Put checks in an issue
  labelled `needs-operator`, and when work is blocked on them, name the exact action.
- Decide and recommend. Don't offer a menu of options for things you can judge;
  ask only about real product, visual or scheduling choices.
- Stop at natural stopping points rather than interrupting with status questions.
- UI work gets a mockup first, and a mockup the operator signed stays the contract
  until they sign a new one. A decision about motion is shown as playable clips,
  never stills.

**Safety**
- Chronicle runs in production. Verify, then fix; back up before deploys; put
  anything risky behind an operator step. Security wins every tie.
- A merged PR is not a deployed fix. Deploy settings and gates are separate steps
  with their own checks.

**Verify before you claim**
- Read the source in the same turn before naming files, lines, identifiers or wire
  values. Verify a wire contract from the code that consumes it.
- Check any claim about state (open, merged, shipped, deployed) against git or
  GitHub first. A claim measured against another repo is true only on the day it
  was measured.
- A root cause is a guess until the code confirms it; a bug-fix PR says why the bug
  existed. When the scope is unclear, start by reading, not changing.
- CI red with local green on the same commit means an environment difference until
  proven otherwise.
- If a rule can't be followed or the task is wrong, stop and say so instead of
  pressing on.

**Scope and reporting**
- The PR description is what gets reviewed: what and why, the load-bearing lines,
  honest deviations, the exact test commands and their pass counts.
- Stay inside the task. Open an issue for anything else; ship the smallest useful
  change and split the follow-ups.

**Sessions**
- Big agent fleets are welcome for work that splits cleanly, but run them on a
  lighter model. Never fan a large fleet out on the most expensive model; keep
  that for the few agents that need it. Usage is a real limit.
- One session per piece of work, ended when it ships. Don't sit in a loop polling
  for CI or PR events.
- Work only on the branch you were given. Never push to another branch without
  explicit permission.
- File the issue before handing work on, and never point anyone at something that
  hasn't landed.
