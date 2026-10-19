// test-director-data.mjs — the Monsters book is the Director's book's
// content, and the book hides that chapter from players. Chronicle keeps a
// category marked `"director": true` to Directors (its pages, search,
// tooltips and raw data file), so every browsable dataset reproducing the
// Monsters book, and the example creatures beside it, must carry the mark.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const data = (slug) => JSON.parse(readFileSync(join(root, 'data', slug + '.json'), 'utf8'));

const DIRECTOR = ['creatures', 'monsters', 'creature-abilities', 'animal-traits', 'monster-building', 'encounter-building'];

test('the monster datasets are Director-only', () => {
  const marked = manifest.categories.filter((c) => c.director === true).map((c) => c.slug).sort();
  assert.deepEqual(marked, DIRECTOR.slice().sort());
});

test('any category quoting the Monsters book is Director-only', () => {
  for (const cat of manifest.categories) {
    const fromBook = data(cat.slug).some((e) => /Monsters Book/.test(String(e.source || '')));
    if (fromBook) assert.equal(cat.director, true, cat.slug + ' quotes the Monsters book but players can read it');
  }
});

test('the director key is only ever true', () => {
  for (const cat of manifest.categories) {
    if ('director' in cat) assert.equal(cat.director, true, cat.slug);
  }
});

// Widget-only files reproducing the Monsters book have no category to mark,
// so the manifest lists them in `director_data` for SystemDataAPI.
const DIRECTOR_DATA = ['organization-templates.json', 'role-templates.json'];

test('the widget-only monster files are Director-only', () => {
  assert.deepEqual((manifest.director_data || []).slice().sort(), DIRECTOR_DATA);
  const slugs = new Set(manifest.categories.map((c) => c.slug));
  for (const f of DIRECTOR_DATA) {
    const slug = f.replace(/\.json$/, '');
    assert.ok(!slugs.has(slug), f + ' has a category; mark the category instead');
    assert.ok(Array.isArray(data(slug)), f + ' is missing');
  }
});

test('every data file quoting the Monsters book is Director-only', () => {
  const marked = new Set(manifest.categories.filter((c) => c.director === true).map((c) => c.slug + '.json'));
  for (const f of manifest.director_data || []) marked.add(f);
  for (const f of readdirSync(join(root, 'data')).filter((n) => n.endsWith('.json'))) {
    const fromBook = data(f.replace(/\.json$/, '')).some((e) => /Monsters Book/.test(String(e.source || '')));
    if (fromBook) assert.ok(marked.has(f), f + ' quotes the Monsters book but players can read it');
  }
});
