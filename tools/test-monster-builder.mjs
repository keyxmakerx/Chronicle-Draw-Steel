#!/usr/bin/env node
/**
 * XSS regression tests for widgets/monster-builder.js (DS-SEC-FIXES-R1).
 *
 * The monster-builder loads OTHER users' creatures via _loadExistingEntity
 * (config.entityId -> fields_data), so its editor/preview render paths are a
 * stored-XSS surface (Scribe author -> Scribe/GM editor), not just self-XSS.
 *
 * Covers audit findings:
 *   H-5 (monster-builder.js:862 etc.) — value="" inputs escaped with escapeHtml
 *       (keeps quotes) -> attribute breakout. Now escapeAttr.
 *   H-5 (monster-builder.js:892) — spend_vp emitted via `|| 0` (no coercion) into
 *       a value attribute -> tag injection. Now Number()-coerced.
 *   H-5 (monster-builder.js:1397) — preview cr.size raw. Now escaped.
 *
 * Run: `node --test tools/test-monster-builder.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, makeEl, FakeRef, assertNoInjection, assertNoAttrBreakout } from './_xss-harness.mjs';

installDom();
const Chronicle = makeChronicle();
globalThis.Chronicle = Chronicle;

const require = createRequire(import.meta.url);
require('../widgets/monster-builder.js');
const def = Chronicle.registry['monster-builder'];

const XSS = '<img src=x onerror=alert(document.cookie)>';
const VP_INJECT = '1"><img src=x onerror=alert(document.cookie)>';
const BREAKOUT = 'x" onfocus="alert(document.cookie)';

function abilitiesInst(abilities) {
  return Object.assign(Object.create(def), {
    creature: { abilities: abilities }, abilityKeywords: [],
    _refreshAbilityValidation() {}, _refreshInlineValidation() {}, _getDamageHints() { return ''; }
  });
}

test('H-5: spend_vp cannot inject a tag via the VP Cost input', () => {
  const container = makeEl();
  def._renderAbilitiesList.call(
    abilitiesInst([{ name: 'Bite', type: 'signature', distance: '', target: '', spend_vp: VP_INJECT }]),
    container
  );
  const html = container.children[0].innerHTML;
  assertNoInjection(assert, html, 'H-5 spend_vp');
  assert.ok(/mb-ab-vp" value="0"/.test(html), 'a non-numeric spend_vp must coerce to 0');
});

test('H-5: an ability name cannot break out of its value attribute', () => {
  const container = makeEl();
  def._renderAbilitiesList.call(
    abilitiesInst([{ name: BREAKOUT, type: 'signature', distance: '', target: '' }]),
    container
  );
  const html = container.children[0].innerHTML;
  assertNoAttrBreakout(assert, html, 'H-5 ability name');
  assert.ok(/&quot;/.test(html), 'the payload quote must be escaped to &quot;');
});

test('H-5: preview escapes a malicious size', () => {
  const inst = Object.assign(Object.create(def), { _ref: new FakeRef() });
  const html = def._buildPreviewHtml.call(inst, {
    name: 'Goblin', level: 1, size: XSS, organization: '', role: '',
    keywords: [], abilities: [], villain_actions: [], traits: []
  });
  assertNoInjection(assert, html, 'H-5 preview size');
  assert.ok(/&lt;img/.test(html), 'size must be HTML-escaped in the preview');
});

test('H-5: a benign ability renders its fields unchanged', () => {
  const container = makeEl();
  def._renderAbilitiesList.call(
    abilitiesInst([{ name: 'Claw', type: 'signature', distance: 'Melee 1', target: '1 creature', spend_vp: 3 }]),
    container
  );
  const html = container.children[0].innerHTML;
  assert.ok(/value="Claw"/.test(html), 'benign name renders');
  assert.ok(/mb-ab-vp" value="3"/.test(html), 'numeric spend_vp renders');
});
