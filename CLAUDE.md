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
- Reference data loaded via `fetch(base + 'data/...')` where base is the extension asset path
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
