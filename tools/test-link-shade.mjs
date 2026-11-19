#!/usr/bin/env node
/**
 * Text in the stat block editor and renderer takes Chronicle's readable link
 * shade (--color-accent-link, the campaign colour shaded to 4.5:1 on its page),
 * never the raw accent, which fails contrast on dark cards. Borders and fills
 * stay on the raw accent. The editor's provenance chip uses a deeper amber for
 * its text in light mode.
 *
 * Run: `node --test tools/test-link-shade.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'widgets', f), 'utf8');

for (const f of ['monster-builder.js', 'statblock-renderer.js']) {
  test(`${f}: no text colour is the raw accent`, () => {
    // "color:" as a property (not border-color, background-color, accent-color).
    const raw = read(f).match(/(^|[^-\w])color:var\(--color-accent,/g) || [];
    assert.deepEqual(raw, []);
  });
}

test('the link and tab text rules read the link shade first', () => {
  const mb = read('monster-builder.js');
  assert.match(mb, /\.sbe-link\{[^}]*color:var\(--color-accent-link,var\(--color-accent,#6366f1\)\)/);
  assert.match(mb, /\.sbe-tabs button\[aria-selected="true"\]\{color:var\(--color-accent-link,/);
  const sb = read('statblock-renderer.js');
  assert.match(sb, /\.sbx-link\{[^}]*color:var\(--color-accent-link,/);
});

test('the provenance chip is a deeper amber in light mode and keeps the dark-mode token', () => {
  const mb = read('monster-builder.js');
  assert.match(mb, /\.sbe-chip\.is-none\{color:#92400e\}\.dark \.sbe-chip\.is-none\{color:var\(--sbe-own\)\}/);
});
