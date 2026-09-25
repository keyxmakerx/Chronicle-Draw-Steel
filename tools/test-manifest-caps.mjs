// test-manifest-caps.mjs — pins this package's manifest against the platform
// limits Chronicle enforces at LOAD time (internal/systems/manifest.go,
// `ValidateManifest`). Exceeding a cap does not truncate or warn — it errors,
// and the whole package fails to load: no categories, no widgets, no
// reference data, no tooltips.
//
// These numbers mirror the consts in Chronicle's manifest.go and are
// duplicated deliberately: this package ships and versions separately, so it
// cannot import them. If Chronicle raises a cap, relax this file to match —
// but never relax it to make a red test green without checking the host
// constant first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

// Mirrors internal/systems/manifest.go.
const CAPS = {
  categories: 20,
  fields_per_category: 100,
  entity_presets: 10,
  relation_presets: 20,
  widgets: 10,
  text_renderers: 5,
};

const count = (key) => (Array.isArray(manifest[key]) ? manifest[key].length : 0);

test('text_renderers is within the cap Chronicle enforces', () => {
  const n = count('text_renderers');
  assert.ok(
    n <= CAPS.text_renderers,
    `manifest declares ${n} text_renderers, Chronicle's ValidateManifest allows ` +
      `${CAPS.text_renderers}. Over the cap the ENTIRE package fails to load — ` +
      `not the extra renderer, the whole thing. Merge a module into another ` +
      `served file rather than adding a slot.`,
  );
});

test('every other declared collection is within its cap', () => {
  const over = [];
  for (const key of ['categories', 'entity_presets', 'relation_presets', 'widgets']) {
    const n = count(key);
    if (n > CAPS[key]) over.push(`${key}: ${n} > ${CAPS[key]}`);
  }
  for (const cat of manifest.categories || []) {
    const n = Array.isArray(cat.fields) ? cat.fields.length : 0;
    if (n > CAPS.fields_per_category) {
      over.push(`category ${cat.slug || cat.id}: ${n} fields > ${CAPS.fields_per_category}`);
    }
  }
  assert.deepEqual(over, [], `manifest exceeds Chronicle's load-time limits: ${over.join('; ')}`);
});

test('every text_renderer and widget points at a file that exists', () => {
  // A renderer or widget naming a file that was merged away or renamed is a
  // 404 at mount time — the same unloadable-package failure as an over-cap
  // manifest.
  const missing = [];
  for (const r of manifest.text_renderers || []) {
    const f = r.file;
    if (!f) { missing.push(`text_renderer ${r.slug}: no file`); continue; }
    try { readFileSync(join(root, f)); } catch { missing.push(`text_renderer ${r.slug} -> ${f}`); }
  }
  for (const w of manifest.widgets || []) {
    const f = w.script_file || w.file;
    if (!f) { missing.push(`widget ${w.slug}: no script_file`); continue; }
    try { readFileSync(join(root, f)); } catch { missing.push(`widget ${w.slug} -> ${f}`); }
  }
  assert.deepEqual(missing, [], `manifest points at files that do not exist: ${missing.join('; ')}`);
});
