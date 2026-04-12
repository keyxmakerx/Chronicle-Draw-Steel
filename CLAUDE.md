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

## Widget Patterns

- All widgets use `Chronicle.register('slug', { init, destroy, ... })`
- Use `Chronicle.apiFetch()` for API calls
- Use `Chronicle.escapeHtml()` for XSS safety
- Reference data loaded via `fetch(base + 'data/...')` where base is the extension asset path
- Styles injected as `<style>` tag (no separate CSS files for widgets)
- Use CSS custom properties with fallbacks for dark mode: `var(--bg-primary, #fff)`

## Data Format

- All `data/*.json` files MUST be JSON arrays of ReferenceItem objects
- Required fields: `slug` (string, unique), `name` (string)
- Optional fields: `description` (string), `properties` (object)
- Domain-specific fields go inside `properties`, not at root level
- See `docs/DATA-SCHEMA.md` for full schemas

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
