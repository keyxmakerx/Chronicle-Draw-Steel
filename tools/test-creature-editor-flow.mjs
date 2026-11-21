#!/usr/bin/env node
/**
 * Two small flows in the creature editor: Tab after a changed box moves on to
 * the next box, and Start blank clears the With an AI panel along with the form.
 *
 * Run: `node --test tools/test-creature-editor-flow.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
globalThis.DrawSteelFormulas = require('../widgets/monster-engine.js').Formulas;
const Ed = require('../widgets/monster-builder.js');
const src = readFileSync(new URL('../widgets/monster-builder.js', import.meta.url), 'utf8');

const box = (id, extra) => Object.assign({ id, disabled: false, type: 'text', offsetParent: {}, getAttribute: () => null }, extra);

test('tabTarget picks the next box, or the previous with Shift, skipping disabled and off-screen ones', () => {
  const a = box('a'), b = box('b', { disabled: true }), c = box('c', { offsetParent: null }), d = box('d'), e = box('e', { getAttribute: (k) => (k === 'tabindex' ? '-1' : null) });
  const scope = { querySelectorAll: () => [a, b, c, d, e] };
  assert.equal(Ed.tabTarget(scope, a, false), d);
  assert.equal(Ed.tabTarget(scope, d, true), a);
  assert.equal(Ed.tabTarget(scope, a, true), null);
  assert.equal(Ed.tabTarget(scope, box('gone'), false), null);
});

test('a change that Tab commits moves focus on instead of back to the same box', () => {
  assert.match(src, /k === 'Tab' && !e\.defaultPrevented[^\n]*tabbed = \{ id: t\.id, back: !!e\.shiftKey \}/);
  assert.match(src, /tabbed && tabbed\.id === id\) \{ var nx = tabTarget\(edEl, back, tabbed\.back\)/);
});

test('Start blank clears the AI panel notes and status', () => {
  const blank = src.slice(src.indexOf("else if (act === 'blank') {"), src.indexOf("else if (act === 'suggest')"));
  assert.match(blank, /aiBox\('notes'\)\.innerHTML = ''/);
  assert.match(blank, /aiBox\('status'\)\.textContent = ''/);
});
