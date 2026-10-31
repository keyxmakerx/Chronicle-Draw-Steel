// test-villain-action-order.mjs — one set of villain action slot names.
//
// Run: node --test tools/test-villain-action-order.mjs
//
// The Monsters book's villain actions are Opener, Crowd Control and Ultimate.
// The builder (VA_SLOTS) and stat block (VA_ORDER) key their slot labels and
// ordering on those names, so a data file using any other word renders a
// villain action with no slot label.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDERS = ['opener', 'crowd-control', 'ultimate'];

function read(rel) { return readFileSync(path.join(root, rel), 'utf8'); }

test('builder slots and stat block labels use the canonical names', () => {
  const slots = read('widgets/monster-builder.js').match(/var VA_SLOTS = (\[[^\]]*\])/);
  assert.ok(slots, 'VA_SLOTS found');
  assert.deepEqual(JSON.parse(slots[1].replace(/'/g, '"')), ORDERS);
  const labels = read('widgets/statblock-renderer.js').match(/var VA_ORDER = \{([^}]*)\}/);
  assert.ok(labels, 'VA_ORDER found');
  const keys = [...labels[1].matchAll(/'?([a-z-]+)'?\s*:/g)].map((m) => m[1]);
  assert.deepEqual(keys, ORDERS);
});

test('every shipped villain action order is a canonical name', () => {
  const files = readdirSync(path.join(root, 'data')).filter((f) => f.endsWith('.json'));
  let seen = 0;
  for (const f of files) {
    const items = JSON.parse(read('data/' + f));
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const p = it.properties || {};
      if (p.villain_action_order !== undefined) {
        seen++;
        assert.ok(ORDERS.includes(p.villain_action_order), f + ' ' + it.slug + ': ' + p.villain_action_order);
      }
      if (typeof p.villain_actions_json === 'string' && p.villain_actions_json.trim()) {
        for (const v of JSON.parse(p.villain_actions_json)) {
          seen++;
          assert.ok(ORDERS.includes(v.order), f + ' ' + it.slug + ' ' + v.name + ': ' + v.order);
        }
      }
    }
  }
  assert.ok(seen > 0, 'found villain actions to check');
});
