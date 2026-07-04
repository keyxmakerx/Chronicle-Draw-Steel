#!/usr/bin/env node
/**
 * XSS regression tests for widgets/bestiary-browser.js (DS-SEC-FIXES-R1).
 *
 * Covers audit findings:
 *   C-1 client half (bestiary-browser.js:546-547) — creature.organization/role
 *       were injected raw into card.innerHTML via _capitalize (no escaping).
 *       Any authenticated user could publish a creature whose organization field
 *       carries HTML and hit every user browsing the community bestiary on load.
 *   H-4 (bestiary-browser.js:918/922) — cr.size raw in the statblock modal.
 *
 * Run: `node --test tools/test-bestiary-browser.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, makeEl, FakeRef, assertNoInjection } from './_xss-harness.mjs';

installDom();
const Chronicle = makeChronicle();
globalThis.Chronicle = Chronicle;

const require = createRequire(import.meta.url);
require('../widgets/bestiary-browser.js');
const def = Chronicle.registry['bestiary-browser'];

// Minimal instance: _renderCard/_buildStatblockHtml use this._capitalize,
// this._getOrgColor, this._ref — all present on the registered def.
function inst() {
  return Object.assign(Object.create(def), { config: {}, state: {}, _ref: new FakeRef() });
}

const XSS = '<img src=x onerror=alert(document.cookie)>';

function baseCreature(extra) {
  return Object.assign({
    id: '1', name: 'Goblin', level: 1, organization: '', role: '', ev: 0, size: 'M',
    keywords: [], faction: '', stamina: 1, winded: 0, speed: 5, stability: 0,
    might: 0, agility: 0, reason: 0, intuition: 0, presence: 0,
    immunities: [], free_strike: '', traits: [], abilities: [], villain_actions: []
  }, extra || {});
}

test('C-1: malicious organization is escaped in the grid card', () => {
  const card = def._renderCard.call(inst(), baseCreature({ organization: XSS }), 0);
  assertNoInjection(assert, card.innerHTML, 'C-1 organization');
  assert.ok(/&lt;img/.test(card.innerHTML), 'organization must be HTML-escaped');
});

test('C-1: malicious role is escaped in the grid card', () => {
  const card = def._renderCard.call(inst(), baseCreature({ role: XSS }), 0);
  assertNoInjection(assert, card.innerHTML, 'C-1 role');
});

test('C-1: a benign org/role still renders capitalized text', () => {
  const card = def._renderCard.call(inst(), baseCreature({ organization: 'horde', role: 'brute' }), 0);
  assert.ok(/Horde/.test(card.innerHTML) && /Brute/.test(card.innerHTML), 'benign org/role render unchanged');
});

test('C-1: a string numeric field cannot inject via the card', () => {
  const card = def._renderCard.call(inst(), baseCreature({ level: '9<img src=x onerror=alert(1)>', stamina: XSS }), 0);
  assertNoInjection(assert, card.innerHTML, 'C-1 numeric coercion');
});

test('H-4: malicious size is escaped in the statblock modal', () => {
  const html = def._buildStatblockHtml.call(inst(), baseCreature({ size: XSS }));
  assertNoInjection(assert, html, 'H-4 size');
  assert.ok(/&lt;img/.test(html), 'size must be HTML-escaped');
});
