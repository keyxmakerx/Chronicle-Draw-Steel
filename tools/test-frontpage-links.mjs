#!/usr/bin/env node
/**
 * The front page's links into Chronicle open in the same tab and never carry
 * target="_blank": a second tab would be a second copy of the book. Every
 * characteristic card also names a chapter that exists in the book.
 *
 * Run: `node --test tools/test-frontpage-links.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

global.Chronicle = {
  register: function () {},
  escapeHtml: function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};
const F = require('../widgets/rulebook-frontpage.js');

const items = JSON.parse(readFileSync(join(ROOT, 'data', 'rulebook-frontpage.json'), 'utf8'));
const glossary = JSON.parse(readFileSync(join(ROOT, 'data', 'rules-glossary.json'), 'utf8'));
const chars = items.filter((i) => i.properties && i.properties.kind === 'characteristic');

// Chapter ids as the book lists them: indented "- id" lines under parts.
const bookChapters = new Set([...readFileSync(join(ROOT, 'book', 'book.yaml'), 'utf8').matchAll(/^ {6}- ([a-z0-9-]+)\s*$/gm)].map((m) => m[1]));

test('the front page has characteristic cards and the book lists its chapters', () => {
  assert.equal(chars.length, 5);
  assert.ok(bookChapters.has('basics'), [...bookChapters].join(','));
});

test('no link on the rendered front page opens a new tab onto a Chronicle route', () => {
  const html = F.buildContent(items, glossary, 'camp-1').html;
  const anchors = html.match(/<a\b[^>]*>/g) || [];
  assert.ok(anchors.length >= chars.length, 'the chapter links are rendered');
  for (const a of anchors) {
    if (/href="\/campaigns\//.test(a)) assert.ok(!/target=/.test(a), a);
  }
});

test('the widget never writes target="_blank" next to a Chronicle address', () => {
  const src = readFileSync(join(ROOT, 'widgets', 'rulebook-frontpage.js'), 'utf8');
  assert.ok(!/target="_blank"/.test(src));
});

for (const c of chars) {
  test(`${c.name}'s card names a chapter the book has`, () => {
    assert.ok(bookChapters.has(c.properties.chapter), `${c.slug}: ${c.properties.chapter}`);
    assert.ok(!/^full chapter$/i.test(c.properties.chapterLabel), 'the label says what the button does');
  });
}
