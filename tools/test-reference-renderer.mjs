#!/usr/bin/env node
/**
 * XSS regression tests for widgets/reference-renderer.js (DS-SEC-FIXES-R1).
 *
 * Covers audit findings:
 *   H-6 (reference-renderer.js:117) — the resolved glossary label (entry.name)
 *       was inserted into HTML element content UNESCAPED. A malicious package /
 *       systems-data glossary entry could inject script into every renderer that
 *       resolves a {@category term} token (statblock, character sheet, bestiary).
 *   L-5 (reference-renderer.js:93-94) — scanText used the glossary description as
 *       a String.replace *replacement* string, so a `$1`/`$&` in the description
 *       was interpreted as a replacement pattern (data-integrity bug).
 *
 * Run: `node --test tools/test-reference-renderer.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RefRenderer = require('../widgets/reference-renderer.js');

// Build a renderer with an injected glossary (bypasses the async load()).
function makeRenderer(glossary) {
  const r = new RefRenderer('', '');
  r._glossary = glossary;
  r._loaded = true;
  return r;
}

const XSS = '<img src=x onerror=alert(document.cookie)>';

// ── H-6: unescaped glossary label ─────────────────────────────────────────
test('H-6: renderText escapes a malicious glossary label (entry.name)', () => {
  const r = makeRenderer({ foo: { slug: 'foo', name: XSS, description: 'a benign tip' } });
  const out = r.renderText('{@condition foo}');
  assert.ok(!/<img/i.test(out), 'raw <img must not survive into the rendered label');
  assert.ok(/&lt;img/.test(out), 'the label must be HTML-escaped');
});

test('H-6: a display override (already-escaped caller text) still renders verbatim', () => {
  // Benign-content invariant: {@cat term|Label} shows "Label" unchanged.
  const r = makeRenderer({ taunted: { slug: 'taunted', name: 'Taunted', description: 'd' } });
  const out = r.renderText('{@condition taunted|taunts}');
  assert.ok(/>taunts</.test(out), 'display override text must render unchanged');
});

test('H-6: a benign glossary name renders unchanged (no double-escaping)', () => {
  const r = makeRenderer({ prone: { slug: 'prone', name: 'Prone', description: 'd' } });
  const out = r.renderText('{@condition prone}');
  assert.ok(/>Prone</.test(out), 'benign label must render exactly');
});

// ── L-5: scanText $-replacement quirk ─────────────────────────────────────
test('L-5: scanText treats a $-sequence in the description literally', () => {
  const r = makeRenderer({
    slowed: { slug: 'slowed', name: 'Slowed', category: 'condition', description: 'Costs $1 extra' }
  });
  const out = r.scanText('The target is Slowed now');
  assert.ok(/data-ref-tip="Costs \$1 extra"/.test(out),
    'the $1 in the description must be preserved literally, not treated as a capture-group ref');
});
