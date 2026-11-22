// test-item-preset.mjs — pins the Item preset: the treasure fields a Director
// switches a campaign's Items to, and how a carried item becomes a Draw Steel
// treasure in Foundry.
//
// The Foundry paths and CONFIG keys below were read from the Draw Steel
// Foundry system's source (MetaMorphic-Digital/draw-steel:
// src/module/data/item/treasure.mjs, base-item.mjs and config.mjs). They are
// copied, not fetched, because this package ships separately; when the system
// changes its model, re-read the source and update this file, never the other
// way round.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const treasures = JSON.parse(readFileSync(join(root, 'data', 'treasures.json'), 'utf8'));

const item = (manifest.entity_presets || []).find((p) => p.slug === 'drawsteel-item');
const byKey = item ? Object.fromEntries(item.fields.map((f) => [f.key, f])) : {};

// Persisted paths on a Draw Steel `treasure` item the preset may target.
const TREASURE_PATHS = new Set([
  'system.category',
  'system.kind',
  'system.echelon',
  'system.keywords',
  'system.description.value',
  'system.project.prerequisites',
  'system.project.source',
  'system.project.rollCharacteristic',
  'system.project.goal',
]);

// Keys of CONFIG.DRAW_STEEL.equipment.categories and .kinds, and of .echelons.
const FOUNDRY_CATEGORIES = ['consumable', 'trinket', 'leveled', 'artifact'];
const FOUNDRY_KINDS = ['other', 'armor', 'implement', 'weapon'];
const FOUNDRY_ECHELONS = [1, 2, 3, 4];

// The value conversions the Foundry module's treasure mapping understands.
const FORMATS = new Set(['set', 'integer', 'treasure_keywords', 'html_section']);
const CHOICES = new Set([
  'DRAW_STEEL.equipment.categories',
  'DRAW_STEEL.equipment.kinds',
  'DRAW_STEEL.equipment',
  'DRAW_STEEL.characteristics',
]);

test('the item preset is the campaign\'s Items, taken on the Director\'s yes', () => {
  assert.ok(item, 'drawsteel-item preset missing');
  assert.equal(item.category, 'item');
  assert.equal(item.name, 'Item');
  assert.equal(item.name_plural, 'Items');
  // Signed on Draw Steel #271, option C: a one-time switch the Director
  // accepts takes rarity and attunement off; Type is kept and reused.
  assert.deepEqual(item.switch, {
    label: 'treasure fields',
    summary: 'Type, Kind, Echelon, Keywords, Effect, the three levels and how to make it',
    set_aside: ['rarity', 'attunement'],
    reuse: ['type'],
  });
  assert.equal(item.foundry_item_type, 'treasure');
});

test('the item fields are the signed treasure fields, in order', () => {
  assert.deepEqual(item.fields.map((f) => f.key), [
    'type', 'kind', 'echelon', 'keywords',
    'effect', 'level_1', 'level_5', 'level_9',
    'item_prerequisite', 'project_source', 'project_roll_characteristic', 'project_goal',
    'book_source',
  ]);
  assert.equal(byKey.book_source.gm_only, true, 'where a page was copied from is the Director\'s');
  for (const f of item.fields) {
    if (f.key !== 'book_source') assert.ok(!f.gm_only, f.key + ' is a player-visible field');
  }
});

test('every item field but book_source is a key the treasures carry', () => {
  // The values a Director copies from the reference pages land in the same
  // keys, so nothing has to be renamed on the way.
  const carried = new Set(treasures.flatMap((t) => Object.keys(t.properties || {})));
  for (const f of item.fields) {
    if (f.key === 'book_source') continue;
    assert.ok(carried.has(f.key), `${f.key} is not a treasures.json property`);
  }
});

test('the pick lists are exactly the values the book uses', () => {
  const values = (k) => [...new Set(treasures.map((t) => t.properties[k]).filter(Boolean))].sort();
  assert.deepEqual([...byKey.type.options].sort(), values('type'));
  assert.deepEqual([...byKey.kind.options].sort(), values('kind'));
  assert.deepEqual([...byKey.echelon.options].sort(), values('echelon'));
  for (const k of ['type', 'kind', 'echelon']) assert.equal(byKey[k].type, 'enum', k + ' is a pick list');
});

test('every item foundry_path exists on a Draw Steel treasure', () => {
  for (const f of item.fields) {
    if (!f.foundry_path) continue;
    assert.ok(TREASURE_PATHS.has(f.foundry_path), `${f.key} -> ${f.foundry_path} is not a treasure path`);
  }
});

test('only the words share a Foundry path, and they add sections to it', () => {
  const seen = new Map();
  for (const f of item.fields) {
    if (!f.foundry_path) continue;
    if (f.foundry_path === 'system.description.value') {
      assert.equal(f.foundry_format, 'html_section', `${f.key} shares the description, so it is a section`);
      continue;
    }
    assert.ok(!seen.has(f.foundry_path), `${f.key} and ${seen.get(f.foundry_path)} share ${f.foundry_path}`);
    seen.set(f.foundry_path, f.key);
  }
  assert.deepEqual(item.fields.filter((f) => f.foundry_format === 'html_section').map((f) => f.key),
    ['effect', 'level_1', 'level_5', 'level_9']);
});

test('formats and choices are ones the module understands', () => {
  for (const f of item.fields) {
    if (f.foundry_format !== undefined) assert.ok(FORMATS.has(f.foundry_format), `${f.key}: unknown format ${f.foundry_format}`);
    if (f.foundry_choices !== undefined) assert.ok(CHOICES.has(f.foundry_choices), `${f.key}: unknown choices ${f.foundry_choices}`);
    if (f.foundry_format || f.foundry_choices) assert.ok(f.foundry_path, `${f.key}: a format needs a path`);
  }
  assert.equal(byKey.book_source.foundry_path, undefined, 'the Director\'s note never goes to Foundry');
});

test('every type, kind and echelon the book uses has a Foundry key', () => {
  for (const t of byKey.type.options) assert.ok(FOUNDRY_CATEGORIES.includes(t.toLowerCase()), t);
  for (const k of byKey.kind.options) assert.ok(FOUNDRY_KINDS.includes(k.toLowerCase()), k);
  // Echelon converts as the leading number ("2nd" -> 2).
  for (const e of byKey.echelon.options) assert.ok(FOUNDRY_ECHELONS.includes(parseInt(e, 10)), e);
});
