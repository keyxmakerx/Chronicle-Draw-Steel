#!/usr/bin/env node
// build-render-fields.mjs — regenerate everything that exists so Chronicle's
// reference browser can actually display this package.
//
//   node tools/build-render-fields.mjs          # rewrite data/*.json + manifest.json
//   node tools/build-render-fields.mjs --check  # exit 1 if anything is stale
//
// Four transformations, all idempotent, all driven by CATEGORIES in
// tools/_render-fields.mjs, and all pinned by tools/test-render-contract.mjs:
//
//   1. properties.source -> root source. ReferenceItem has a dedicated root
//      Source field and the item-detail header renders THAT
//      (system_pages.templ: `if item.Source != ""`). Provenance parked in
//      properties never reached the page. creatures.json, organization-
//      templates.json and role-templates.json already put it at the root; this
//      brings the rest of the tree into line rather than teaching Chronicle a
//      second place to look.
//   2. A derived one-line `summary`, which the list table prints for every row
//      and which only creatures.json had authored.
//   3. A scalar `<key>_display` twin beside every nested property that a
//      category declares as a column, because propString formats an object as
//      `map[…]`. Plus the two aggregate columns, `details_display` and
//      `provenance_display`.
//   4. manifest.json's `categories` array, regenerated from CATEGORIES with
//      every field key resolved against the real data. The manifest naming a
//      key the data does not carry is the defect this whole file exists to
//      make impossible; generating it means the two cannot disagree.
//
// Structured values are never removed: widgets and the Foundry sync read them.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  renderValue,
  displayKeyFor,
  columnsNeedingFlattening,
  flattenRefs,
  foldEntries,
  deriveSummary,
  isScalar,
  AUTHORED_SUFFIX,
  CATEGORIES,
  CATEGORY_BY_FILE,
  WIDGET_ONLY,
  PROVENANCE_KEYS,
  DERIVED_SUFFIX,
  DETAILS_KEY,
  PROVENANCE_KEY,
} from './_render-fields.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const MANIFEST = path.join(ROOT, 'manifest.json');

// Root key order Chronicle's ReferenceItem reads, so a rewritten file stays
// diff-stable no matter which keys an entry happens to gain.
const ROOT_ORDER = ['slug', 'id', 'name', 'summary', 'description', 'properties', 'tags', 'source'];

function orderRoot(item) {
  const out = {};
  for (const k of ROOT_ORDER) if (k in item) out[k] = item[k];
  for (const k of Object.keys(item)) if (!(k in out)) out[k] = item[k];
  return out;
}

/** Every key the builder owns and therefore rebuilds from scratch each run. */
const isDerived = (k) => k.endsWith(DERIVED_SUFFIX);

/**
 * rebuildProperties strips the keys the builder owns, then re-derives them, so
 * `--check` is an exact drift test: a structured value edited without rerunning
 * the generator yields a different file, never a merged one. Authored `_text`
 * fields and every structured value are left untouched.
 */
function rebuildProperties(properties, category, flattened = new Set()) {
  const authored = Object.fromEntries(
    Object.entries(properties)
      .filter(([k]) => !isDerived(k))
      // A JSON null is indistinguishable from an absent key for every consumer
      // in this package, and propString renders it as the literal "<nil>" — so
      // `"melee_damage_bonus": null` would print "<nil>" in the Melee Damage
      // column of 3 of 21 kits. Dropping the key makes those cells correctly
      // empty and lets the column be declared at all.
      .filter(([, v]) => v !== null),
  );

  const columnKeys = new Set((category?.columns || []).map(([k]) => k));

  // A `_display` twin for a column value Chronicle cannot print as it stands:
  // a nested value (propString would emit "map[…]"), or ANY value in a column
  // that carries reference markup somewhere in the file (propString would emit
  // "{@combat dying}" verbatim). Everything else either is already a printable
  // scalar or belongs in the folded Details column, and a twin for it would put
  // the same sentence on the page twice.
  const out = {};
  for (const [k, v] of Object.entries(authored)) {
    out[k] = v;
    if (!columnKeys.has(k)) continue;
    if (isScalar(v) && !flattened.has(k)) continue;
    const twin = displayKeyFor(authored, k, flattened);
    if (twin !== k + DERIVED_SUFFIX) continue; // authored `_text` wins
    // When an entry authors its own prose for this key, flatten THAT rather
    // than the generic rendering — the authored words are better, and the only
    // reason the twin has to take over is the markup inside them.
    const src = typeof authored[k + AUTHORED_SUFFIX] === 'string' ? authored[k + AUTHORED_SUFFIX] : v;
    const rendered = flattenRefs(renderValue(src));
    if (rendered !== '') out[twin] = rendered;
  }

  // Aggregate columns.
  const provenance = foldEntries(authored, PROVENANCE_KEYS);
  if (provenance) out[PROVENANCE_KEY] = provenance;

  if (category?.fold) {
    const exclude = new Set(category.foldExclude || []);
    const rest = Object.keys(authored).filter(
      (k) =>
        !columnKeys.has(k) &&
        !exclude.has(k) &&
        !PROVENANCE_KEYS.includes(k) &&
        !k.endsWith('_text'),
    );
    const details = foldEntries(authored, rest);
    if (details) out[DETAILS_KEY] = details;
  }

  return out;
}

export function transformItem(item, category, flattened = new Set()) {
  const next = { ...item };

  if (next.properties && typeof next.properties === 'object') {
    const props = { ...next.properties };
    if (typeof props.source === 'string' && props.source !== '') {
      if (!next.source) next.source = props.source;
      delete props.source;
    }
    next.properties = rebuildProperties(props, category, flattened);
  }

  // `summary` is flattened outright, unlike the `description` it comes from.
  // The description is the authored source the widgets resolve into tooltips;
  // the summary exists only for the list table, which prints item.Summary
  // verbatim, and nothing in this package reads it structurally.
  const flatDescription = flattenRefs(next.description);
  if (typeof next.summary === 'string' && next.summary !== '') {
    const flat = flattenRefs(next.summary);
    // A summary truncated mid-marker leaves an unmatchable `{@…` fragment that
    // no flattener can resolve; re-derive it from the flattened description
    // instead, where the truncation lands on real words.
    next.summary = flat.includes('{@') ? deriveSummary(flatDescription) : flat;
  }
  if (!next.summary) {
    const s = deriveSummary(flatDescription);
    if (s) next.summary = s;
  }

  return orderRoot(next);
}

// --- data files -------------------------------------------------------------

const dataFiles = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !WIDGET_ONLY.has(f))
  .sort();

const pending = [];
// The transformed items, kept in memory so the manifest is generated from the
// data this run produces rather than from what is still on disk — otherwise a
// run that changes both leaves the manifest one generation behind.
const transformed = new Map();
// Per file, the column keys that carry reference markup. Decided once over the
// whole file (see displayKeyFor) and reused by buildCategories, so the twin the
// data grows and the key the manifest declares cannot disagree.
const flattenedColumns = new Map();

for (const file of dataFiles) {
  const p = path.join(DATA_DIR, file);
  const before = readFileSync(p, 'utf8');
  const data = JSON.parse(before);
  if (!Array.isArray(data)) continue;
  const category = CATEGORY_BY_FILE.get(file);
  const flattened = columnsNeedingFlattening(data, category);
  flattenedColumns.set(file, flattened);
  const items = data.map((it) => transformItem(it, category, flattened));
  transformed.set(file, items);
  const after = JSON.stringify(items, null, 2) + '\n';
  if (after !== before) pending.push({ path: p, label: `data/${file}`, after });
}

// --- manifest ---------------------------------------------------------------

/**
 * buildCategories resolves every declared column against the real data:
 *   - the scalar key to print (itself / `_text` / `_display`),
 *   - dropping any column no entry in the file populates, because an
 *     unpopulated column is a blank table column and a manifest field key that
 *     points at nothing.
 * Then it appends the two aggregate columns when the data produced them.
 */
function buildCategories() {
  return CATEGORIES.map((cat) => {
    const items = transformed.get(cat.file);
    if (!items) throw new Error(`CATEGORIES names ${cat.file}, which is not a data file`);
    const populated = (key) => items.some((it) => (it.properties || {})[key] !== undefined);

    const fields = [];
    for (const [dataKey, label, type] of cat.columns) {
      // Resolve against the first entry that actually carries the key, so the
      // suffix is decided by a real value rather than by a guess.
      const carrier = items.find((it) => (it.properties || {})[dataKey] !== undefined);
      if (!carrier) continue;
      const key = displayKeyFor(carrier.properties, dataKey, flattenedColumns.get(cat.file));
      if (!key || !populated(key)) continue;
      fields.push({ key, label, type });
    }
    if (populated(DETAILS_KEY)) fields.push({ key: DETAILS_KEY, label: 'Details', type: 'string' });
    if (populated(PROVENANCE_KEY)) {
      fields.push({ key: PROVENANCE_KEY, label: 'Provenance Notes', type: 'string' });
    }

    const out = { slug: cat.slug, name: cat.name };
    if (cat.icon) out.icon = cat.icon;
    if (fields.length) out.fields = fields;
    return out;
  });
}

/**
 * renderCategoriesBlock emits the `categories` array in manifest.json's
 * existing hand-formatting — one line per field object. Spliced into the file
 * as text rather than round-tripped through JSON.stringify, which would
 * reformat the other 200 lines of the manifest into an unreviewable diff.
 */
function renderCategoriesBlock(cats) {
  const j = JSON.stringify;
  const blocks = cats.map((c) => {
    const lines = [`      "slug": ${j(c.slug)}`, `      "name": ${j(c.name)}`];
    if (c.icon) lines.push(`      "icon": ${j(c.icon)}`);
    if (c.fields) {
      const fs = c.fields.map(
        (f) => `        { "key": ${j(f.key)}, "label": ${j(f.label)}, "type": ${j(f.type)} }`,
      );
      lines.push(`      "fields": [\n${fs.join(',\n')}\n      ]`);
    }
    return `    {\n${lines.join(',\n')}\n    }`;
  });
  return `  "categories": [\n${blocks.join(',\n')}\n  ],`;
}

{
  const before = readFileSync(MANIFEST, 'utf8');
  const lines = before.split('\n');
  const start = lines.findIndex((l) => l === '  "categories": [');
  if (start < 0) throw new Error('manifest.json: could not find the "categories" array');
  const end = lines.indexOf('  ],', start);
  if (end < 0) throw new Error('manifest.json: could not find the end of the "categories" array');

  const after = [
    ...lines.slice(0, start),
    ...renderCategoriesBlock(buildCategories()).split('\n'),
    ...lines.slice(end + 1),
  ].join('\n');

  JSON.parse(after); // never write a manifest that does not parse
  if (after !== before) pending.push({ path: MANIFEST, label: 'manifest.json', after });
}

// --- write / check ----------------------------------------------------------

if (process.argv.includes('--check')) {
  if (pending.length) {
    console.error('stale generated content in:\n  ' + pending.map((p) => p.label).join('\n  '));
    console.error('run: node tools/build-render-fields.mjs');
    process.exit(1);
  }
  console.log(`up to date (${dataFiles.length} data files + manifest.json)`);
} else {
  for (const p of pending) writeFileSync(p.path, p.after);
  console.log(
    pending.length
      ? `rewrote ${pending.length}:\n  ${pending.map((p) => p.label).join('\n  ')}`
      : `no changes (${dataFiles.length} data files + manifest.json)`,
  );
}
