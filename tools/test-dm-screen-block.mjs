// test-dm-screen-block.mjs — pins the manifest's `dm_screen` block, which
// tells Chronicle's DM Screen what to show for each hero and where the
// conditions live. Chronicle validates the block at load time
// (internal/systems/manifest_dm_screen.go) and a bad block fails the whole
// package, so the rules are mirrored here. The block must also point at
// fields the character preset really has and at a category the data really
// fills, or the screen silently shows nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const block = manifest.dm_screen;

// Mirrors Chronicle's validateDMScreen.
const MAX_METERS = 6;
const FIELD_KEY = /^[a-z0-9_]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const characterPreset = (manifest.entity_presets || []).find((p) => p.category === 'character');
const sheetFields = new Set((characterPreset?.fields || []).map((f) => f.key));

test('dm_screen block is present', () => {
  assert.ok(block && typeof block === 'object', 'manifest.dm_screen is missing');
});

test('party meters pass Chronicle validation and name real sheet fields', () => {
  assert.ok(Array.isArray(block.party) && block.party.length > 0, 'no party meters');
  assert.ok(block.party.length <= MAX_METERS, `more than ${MAX_METERS} meters`);
  for (const m of block.party) {
    assert.ok(m.label || m.label_field, `meter ${JSON.stringify(m)} has no label or label_field`);
    for (const key of ['current', 'max', 'label_field']) {
      if (m[key] === undefined) continue;
      assert.match(m[key], FIELD_KEY, `${key} "${m[key]}" is not a field key`);
      assert.ok(sheetFields.has(m[key]), `${key} "${m[key]}" is not a field of the character preset`);
    }
    assert.ok(m.current, `meter ${JSON.stringify(m)} has no current field`);
    if (m.warn_below !== undefined) {
      assert.ok(m.warn_below >= 0 && m.warn_below <= 1, `warn_below ${m.warn_below} is outside 0..1`);
    }
  }
});

test('hero subtitle and conditions name real sheet fields', () => {
  for (const key of ['hero_subtitle', 'hero_conditions']) {
    if (block[key] === undefined) continue;
    assert.match(block[key], FIELD_KEY, `${key} "${block[key]}" is not a field key`);
    assert.ok(sheetFields.has(block[key]), `${key} "${block[key]}" is not a field of the character preset`);
  }
});

test('conditions point at a declared category whose data has conditions', () => {
  const c = block.conditions;
  assert.match(c.category, SLUG);
  assert.equal(Boolean(c.property), Boolean(c.value), 'property and value must be set together');
  assert.ok(manifest.categories.some((cat) => cat.slug === c.category), `category "${c.category}" is not declared`);
  const items = JSON.parse(readFileSync(join(root, 'data', `${c.category}.json`), 'utf8'));
  const matches = items.filter((i) => !c.property || i.properties?.[c.property] === c.value);
  assert.ok(matches.length > 0, 'no data entry matches the conditions filter');
});
