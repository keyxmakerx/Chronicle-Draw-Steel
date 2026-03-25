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
