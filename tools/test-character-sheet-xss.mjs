#!/usr/bin/env node
/**
 * XSS regression tests for widgets/character-sheet.js (DS-SEC-FIXES-R1).
 *
 * Covers audit findings:
 *   H-1 (character-sheet.js:187) — portrait_url/name in src=""/alt="" via esc()
 *       (escapeHtml keeps quotes) -> attribute-breakout XSS. Now escAttr + URL
 *       scheme validation.
 *   H-2 (character-sheet.js:498/509/521) — fmt() emitted kit_details_json values
 *       raw for non-numeric input. Now escaped.
 *   L-1/L-2/M-4/M-5 — the escAttr helper that backs the aria-label / href /
 *       data-tip attribute sinks.
 *
 * Run: `node --test tools/test-character-sheet-xss.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeChronicle, assertNoInjection, assertNoAttrBreakout } from './_xss-harness.mjs';

// character-sheet reads window.Chronicle at module load; provide it first so the
// esc/escAttr helpers resolve (and the widget registers against the mock).
globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');

const XSS = '<img src=x onerror=alert(document.cookie)>';
const BREAKOUT = 'x" onerror="alert(document.cookie)';

// ── escAttr helper (backs H-1/L-1/L-2/M-4/M-5) ────────────────────────────
test('escAttr escapes double quotes (breakout prevention)', () => {
  assert.ok(!/"\s+on\w+=/i.test('x="' + cs.escAttr(BREAKOUT) + '"'), 'quote must be neutralized');
  assert.ok(cs.escAttr(BREAKOUT).indexOf('"') === -1, 'no raw double-quote survives');
});

// ── safeImgUrl (H-1 scheme validation) ────────────────────────────────────
test('safeImgUrl allows http(s)/relative and rejects dangerous schemes', () => {
  assert.equal(cs.safeImgUrl('https://cdn.example/p.png'), 'https://cdn.example/p.png');
  assert.equal(cs.safeImgUrl('/media/p.png'), '/media/p.png');
  assert.equal(cs.safeImgUrl('p.png'), 'p.png');
  assert.equal(cs.safeImgUrl('javascript:alert(1)'), '');
  assert.equal(cs.safeImgUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(cs.safeImgUrl('vbscript:msgbox(1)'), '');
});

// ── H-1: portrait header ──────────────────────────────────────────────────
test('H-1: a quote-breakout portrait_url cannot inject an event handler', () => {
  const html = cs.rHeader({}, { name: 'Hero', fields: { portrait_url: BREAKOUT } });
  assertNoAttrBreakout(assert, html, 'H-1 portrait breakout');   // legit <img> present; check breakout only
  assert.ok(/&quot;/.test(html), 'the payload quote must be escaped to &quot;');
  // (alt="" uses the identical escAttr call; escAttr's quote-escaping is unit-tested above.)
});

test('H-1: a javascript: portrait_url falls back to the placeholder (no <img>)', () => {
  const html = cs.rHeader({}, { name: 'Hero', fields: { portrait_url: 'javascript:alert(1)' } });
  assert.ok(!/<img/.test(html), 'no <img> for a rejected scheme');
  assert.ok(/cs-portrait-placeholder/.test(html), 'placeholder shown instead');
});

test('H-1: a benign portrait URL still renders an <img>', () => {
  const html = cs.rHeader({}, { name: 'Hero', fields: { portrait_url: '/media/hero.png' } });
  assert.ok(/<img class="cs-portrait" src="\/media\/hero.png"/.test(html), 'benign portrait renders');
});

// ── H-2: kit fmt() ─────────────────────────────────────────────────────────
test('H-2: malicious kit_details values are escaped by fmt()', () => {
  const data = { name: 'Hero', fields: {
    kit_details_json: JSON.stringify([{ name: 'Kit', stability: XSS, meleeDamageT1: '<svg onload=alert(1)>' }])
  } };
  const html = cs.rKit({}, data);
  assertNoInjection(assert, html, 'H-2 kit');
  assert.ok(/&lt;img/.test(html), 'kit value must be HTML-escaped');
});

test('H-2: a numeric kit bonus still renders with its sign', () => {
  const data = { name: 'Hero', fields: {
    kit_details_json: JSON.stringify([{ name: 'Kit', stability: 2, speed: -1 }])
  } };
  const html = cs.rKit({}, data);
  assert.ok(/\+2/.test(html), '+2 stability renders');
  assert.ok(/-1/.test(html), '-1 speed renders');
});
