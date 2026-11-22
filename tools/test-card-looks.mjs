// test-card-looks.mjs — the border and colour each ancestry's card wears in
// Chronicle's hero creator.
//
// Run: node --test tools/test-card-looks.mjs
//
// Chronicle draws a card's border only when `card_border` names a border in
// its library and `card_colour` is six hex digits; anything else is a plain
// card, with no error to notice. So a typo here ships silently. The two
// properties are also not rules text: they must never reach a column or the
// folded Details the reference browser shows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARD_LOOK_KEYS, DERIVED_SUFFIX } from './_render-fields.mjs';

const read = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));

const ANCESTRIES = read('data/ancestries.json');
const MANIFEST = read('manifest.json');

// The keys of Chronicle's border library.
const BORDERS = new Set([
  'carved-stone', 'earth', 'fire', 'ice', 'storm',
  'glass', 'glass-smoke', 'glass-sea', 'glass-rose', 'glass-midnight',
  'rune-metal', 'great-rune', 'thorn-glass', 'scales', 'vine',
]);

test('the two property names are the ones Chronicle reads', () => {
  assert.deepEqual(CARD_LOOK_KEYS, ['card_border', 'card_colour']);
});

test('every ancestry names a border from the library and a six-digit colour', () => {
  assert.ok(ANCESTRIES.length > 0);
  for (const a of ANCESTRIES) {
    const p = a.properties || {};
    assert.ok(BORDERS.has(p.card_border),
      `${a.slug}: card_border "${p.card_border}" is not a border in Chronicle's library`);
    assert.match(String(p.card_colour), /^#[0-9a-f]{6}$/,
      `${a.slug}: card_colour "${p.card_colour}" must be # and six lower-case hex digits`);
  }
});

test('a card look never shows as rules text', () => {
  for (const a of ANCESTRIES) {
    for (const [k, v] of Object.entries(a.properties || {})) {
      if (!k.endsWith(DERIVED_SUFFIX)) continue;
      assert.doesNotMatch(String(v), /card[ _](border|colour)/i,
        `${a.slug}: ${k} mentions the card look`);
    }
    assert.doesNotMatch(String(a.summary || ''), /card[ _](border|colour)/i,
      `${a.slug}: summary mentions the card look`);
  }
  const manifest = JSON.stringify(MANIFEST);
  for (const k of CARD_LOOK_KEYS) {
    assert.ok(!manifest.includes(`"${k}"`), `manifest.json must not declare ${k}`);
  }
});
