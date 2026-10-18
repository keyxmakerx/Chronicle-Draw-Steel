// test-director-data.mjs — the Monsters book is the Director's book's
// content, and the book hides that chapter from players. Chronicle keeps a
// category marked `"director": true` to Directors (its pages, search,
// tooltips and raw data file), so every browsable dataset reproducing the
// Monsters book, and the example creatures beside it, must carry the mark.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
