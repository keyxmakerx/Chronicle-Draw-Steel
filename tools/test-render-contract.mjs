// test-render-contract.mjs — does this package actually RENDER in Chronicle?
//
// Run: node --test tools/test-render-contract.mjs
//
// Every other test in tools/ checks that the data is CORRECT. This one checks
// that it is VISIBLE, which is a different property and was the one that failed.
// 632 entries of sourced, cross-referenced, verified rules data shipped with a
// manifest that named `traits` on a file carrying `signature_traits` and
// `purchased_traits`, so the Traits column and the Traits row were empty for 12
// of 12 ancestries. Nothing errored. Every existing test passed.
//
// The renderer is Chronicle's internal/systems package:
//
//   handler.go   Index()  iterates manifest.Categories ONLY, so a data file
//                         with no category is not in the browser at all.
//   handler.go   CategoryList()/ItemDetail() look the category up by slug and
//                         load data/<slug>.json through the JSON provider.
//   system_pages.templ    prints propString(item.Properties, field.Key) for
//                         every field the category declares, in the list table
//                         AND the detail card, and prints the ROOT item.Source
//                         in the detail header.
//   template_helpers.go   propString = fmt.Sprintf("%v", props[key]), or "" if
//                         the key is absent.
//
// So the failure modes this file exists to catch are:
//   1. a declared field key the data does not carry     -> silent blank
//   2. a declared field key whose value is not a scalar -> "map[…]" / "<nil>"
//   3. a data file with no category                     -> invisible entirely
//   4. provenance in properties.source                  -> blank Source line
//   5. a derived field stale against its structured source

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isScalar, WIDGET_ONLY, SOURCE_PENDING } from './_render-fields.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');

const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const DATA_FILES = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();

const load = (f) => JSON.parse(readFileSync(path.join(DATA_DIR, f), 'utf8'));

/** The set of files that are arrays of ReferenceItems (all of data/, today). */
const itemFiles = DATA_FILES.filter((f) => Array.isArray(load(f)));

// ---------------------------------------------------------------------------
// 1. The defect: a manifest field key that the data does not carry.
// ---------------------------------------------------------------------------

test('every manifest field key exists in the data file it points at', () => {
  const failures = [];
  for (const cat of MANIFEST.categories) {
    const file = `${cat.slug}.json`;
    const items = load(file);
    for (const field of cat.fields || []) {
      const carriers = items.filter((it) => (it.properties || {})[field.key] !== undefined);
      if (carriers.length === 0) {
        failures.push(
          `category "${cat.slug}" declares field "${field.key}" (label "${field.label}"), ` +
            `but 0 of ${items.length} entries in data/${file} carry properties.${field.key} — ` +
            `propString returns "" for every one, so that column and that detail row are blank`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
});

// ---------------------------------------------------------------------------
// 2. propString only formats scalars.
// ---------------------------------------------------------------------------

test('every declared field value is a scalar Chronicle can print', () => {
  // fmt.Sprintf("%v", …) turns an object into "map[cost:1 name:Beast Legs]",
  // an array of objects into "[map[…] map[…]]", an array of strings into
  // "[Attack Melee]", and a JSON null into "<nil>". Each of those is garbage
  // on the page, and none of them errors.
  const failures = [];
  for (const cat of MANIFEST.categories) {
    const items = load(`${cat.slug}.json`);
    for (const field of cat.fields || []) {
      for (const it of items) {
        const v = (it.properties || {})[field.key];
        if (v === undefined) continue;
        if (isScalar(v)) continue;
        const shape = v === null ? 'null (renders as "<nil>")' : Array.isArray(v) ? 'an array' : 'an object';
        failures.push(
          `${cat.slug}/${it.slug}: field "${field.key}" is ${shape}; declare its ` +
            `_display twin instead (see tools/_render-fields.mjs)`,
        );
      }
    }
  }
  assert.deepEqual(failures.slice(0, 20), [], `\n  ${failures.slice(0, 20).join('\n  ')}\n`);
});

test('no entry carries a null property at all', () => {
  // Even an undeclared null is a trap: the day someone adds the column, every
  // null-valued entry prints "<nil>".
  const failures = [];
  for (const file of itemFiles) {
    if (WIDGET_ONLY.has(file)) continue; // legacy root-field shape, not browsed
    for (const it of load(file)) {
      for (const [k, v] of Object.entries(it.properties || {})) {
        if (v === null) failures.push(`data/${file}: ${it.slug}.properties.${k} is null`);
      }
    }
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
});

// ---------------------------------------------------------------------------
// 3. A data file with no category is invisible in the browser.
// ---------------------------------------------------------------------------

test('every manifest category resolves to a data file, and every data file is accounted for', () => {
  const declared = new Set(MANIFEST.categories.map((c) => c.slug));

  for (const slug of declared) {
    assert.ok(
      DATA_FILES.includes(`${slug}.json`),
      `manifest declares category "${slug}" but there is no data/${slug}.json — ` +
        `the category card renders with a count of 0`,
    );
  }

  const orphans = itemFiles.filter((f) => !declared.has(f.replace(/\.json$/, '')) && !WIDGET_ONLY.has(f));
  assert.deepEqual(
    orphans,
    [],
    `these data files have no manifest category, so handler.Index() never lists them and ` +
      `nothing in the product can reach them: ${orphans.join(', ')}. Add a category in ` +
      `tools/_render-fields.mjs CATEGORIES, or add the file to WIDGET_ONLY if it is widget data.`,
  );
});

test('the manifest stays inside Chronicle ValidateManifest limits', () => {
  // internal/systems/manifest.go: maxCategories 20, maxFieldsPerCategory 100,
  // and a slug pattern. A manifest that trips these fails to LOAD — the whole
  // package disappears, not just one column.
  assert.ok(MANIFEST.categories.length <= 20, `too many categories (${MANIFEST.categories.length}, max 20)`);
  for (const cat of MANIFEST.categories) {
    assert.match(cat.slug, /^[a-z0-9][a-z0-9_-]*$/, `category slug "${cat.slug}" is not a valid slug`);
    assert.ok(cat.name, `category "${cat.slug}" needs a name`);
    assert.ok((cat.fields || []).length <= 100, `category "${cat.slug}" has too many fields`);
    for (const f of cat.fields || []) {
      assert.ok(f.key && f.label && f.type, `category "${cat.slug}" has an incomplete field: ${JSON.stringify(f)}`);
      assert.ok(
        ['string', 'number', 'boolean', 'list', 'markdown', 'enum', 'url'].includes(f.type),
        `category "${cat.slug}" field "${f.key}" has type "${f.type}", which ValidateManifest rejects`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Provenance has to be where the renderer looks for it.
// ---------------------------------------------------------------------------

test('provenance lives at the root, where the detail header renders it', () => {
  // system_pages.templ prints `item.Source` — the ROOT field of Chronicle's
  // ReferenceItem struct. A source inside properties never reaches the page.
  const strays = [];
  for (const file of itemFiles) {
    for (const it of load(file)) {
      if ((it.properties || {}).source !== undefined) strays.push(`data/${file}: ${it.slug}`);
    }
  }
  assert.deepEqual(
    strays.slice(0, 20),
    [],
    `these entries put provenance in properties.source, which the item-detail header ` +
      `never reads: ${strays.slice(0, 20).join(', ')}`,
  );
});

test('the provenance contract holds everywhere it claims to, and the exception list is exact', () => {
  // docs/DATA-SCHEMA.md states the rule and names SOURCE_PENDING as its exact
  // extent. Pinned in BOTH directions so the list can only shrink: a file that
  // has been sourced must be removed from it, and a new file can never join it.
  const unsourced = new Map();
  for (const file of itemFiles) {
    const missing = load(file).filter((it) => typeof it.source !== 'string' || it.source === '');
    if (missing.length) unsourced.set(file, missing.length);
  }

  for (const [file, n] of unsourced) {
    assert.ok(
      SOURCE_PENDING.has(file),
      `data/${file} has ${n} entries with no root "source". Every data file must declare ` +
        `provenance per entry (docs/DATA-SCHEMA.md). If this is genuinely deferred, it has to ` +
        `be added to SOURCE_PENDING in tools/_render-fields.mjs and listed in DATA-SCHEMA.md — ` +
        `silently unsourced is not an option.`,
    );
  }

  for (const file of SOURCE_PENDING) {
    assert.ok(
      itemFiles.includes(file),
      `SOURCE_PENDING names data/${file}, which does not exist — remove it`,
    );
    assert.ok(
      unsourced.has(file),
      `data/${file} is now fully sourced. Remove it from SOURCE_PENDING in ` +
        `tools/_render-fields.mjs and from the pending list in docs/DATA-SCHEMA.md.`,
    );
  }
});

test('a published source names Draw Steel, and a custom one says so exactly', () => {
  for (const file of itemFiles) {
    for (const it of load(file)) {
      if (typeof it.source !== 'string' || it.source === '') continue;
      if (it.source === 'custom') continue;
      assert.match(
        it.source,
        /Draw Steel/,
        `data/${file}: ${it.slug} claims a published source that does not name Draw Steel: "${it.source}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Derived content cannot drift from what it was derived from.
// ---------------------------------------------------------------------------

test('every derived field and the manifest are up to date', () => {
  // The one check that covers the _display twins, the derived summaries, the
  // root-source move AND the generated manifest at once: rerun the generator
  // and require that it changes nothing.
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-render-fields.mjs'), '--check'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    assert.fail(
      `generated content is stale — a structured value was edited without rerunning the ` +
        `generator, so the rendered text on the page disagrees with the data:\n${err.stderr || err.message}`,
    );
  }
});

test('every list row has a summary to show', () => {
  // The list table always prints item.Summary. Before the derived summary, that
  // column was empty for every category except creatures.
  const failures = [];
  for (const cat of MANIFEST.categories) {
    for (const it of load(`${cat.slug}.json`)) {
      if (typeof it.summary !== 'string' || it.summary.trim() === '') {
        failures.push(`${cat.slug}/${it.slug}`);
      }
    }
  }
  assert.deepEqual(failures, [], `entries with a blank Summary column: ${failures.join(', ')}`);
});
