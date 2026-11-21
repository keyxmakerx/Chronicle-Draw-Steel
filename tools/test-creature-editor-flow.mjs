#!/usr/bin/env node
/**
 * Start blank in the creature editor clears the With an AI panel along with the form.
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

test('Start blank clears the AI panel notes and status', () => {
  const blank = src.slice(src.indexOf("else if (act === 'blank') {"), src.indexOf("else if (act === 'suggest')"));
  assert.match(blank, /aiBox\('notes'\)\.innerHTML = ''/);
  assert.match(blank, /aiBox\('status'\)\.textContent = ''/);
});
