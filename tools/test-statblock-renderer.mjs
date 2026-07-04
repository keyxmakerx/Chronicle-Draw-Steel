#!/usr/bin/env node
/**
 * XSS regression tests for widgets/statblock-renderer.js (DS-SEC-FIXES-R1).
 *
 * Covers audit findings:
 *   H-3 (statblock-renderer.js:156) — cr.size (user-authored custom field) was
 *       inserted into element content unescaped -> stored XSS in every viewer.
 *   L-4 (statblock-renderer.js:236) — spend_vp emitted without Number() coercion
 *       (gated only by `> 0`); now coerced.
 *
 * Run: `node --test tools/test-statblock-renderer.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, makeEl, FakeRef, assertNoInjection } from './_xss-harness.mjs';

installDom();
const Chronicle = makeChronicle();
globalThis.Chronicle = Chronicle;

const require = createRequire(import.meta.url);
require('../widgets/statblock-renderer.js');
const def = Chronicle.registry['statblock-renderer'];

function render(creature) {
  const el = makeEl();
  const inst = {
    el, creature, config: {}, _ref: new FakeRef(),
    _injectStyles: def._injectStyles
  };
  def._render.call(inst);
  return el.innerHTML;
}

const XSS = '<img src=x onerror=alert(document.cookie)>';

test('H-3: malicious creature size is escaped in the statblock', () => {
  const html = render({
    name: 'Goblin', level: 1, size: XSS, organization: '', role: '', ev: 0,
    keywords: [], immunities: [], abilities: [], villain_actions: [], traits: [],
    might: 0, agility: 0, reason: 0, intuition: 0, presence: 0,
    stamina: 1, winded: 0, speed: 5, stability: 0
  });
  assertNoInjection(assert, html, 'H-3 size');
  assert.ok(/&lt;img/.test(html), 'size must be HTML-escaped');
});

test('H-3: a benign size (M) still renders as text', () => {
  const html = render({
    name: 'Goblin', level: 1, size: 'M', organization: '', role: '', ev: 0,
    keywords: [], immunities: [], abilities: [], villain_actions: [], traits: [],
    might: 0, agility: 0, reason: 0, intuition: 0, presence: 0,
    stamina: 1, winded: 0, speed: 5, stability: 0
  });
  assert.ok(/Level 1 M/.test(html), 'benign size must render unchanged');
});

test('L-4: a string spend_vp cannot inject and non-numeric is dropped', () => {
  const html = render({
    name: 'Goblin', level: 1, size: 'M', organization: '', role: '', ev: 0,
    keywords: [], immunities: [], villain_actions: [], traits: [],
    might: 0, agility: 0, reason: 0, intuition: 0, presence: 0,
    stamina: 1, winded: 0, speed: 5, stability: 0,
    abilities: [{ name: 'Bite', type: 'signature', spend_vp: '1"><img src=x onerror=alert(1)>' }]
  });
  assertNoInjection(assert, html, 'L-4 spend_vp');
  assert.ok(!/Spend/.test(html), 'a non-numeric spend_vp must not render a VP line');
});
