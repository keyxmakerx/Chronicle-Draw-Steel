#!/usr/bin/env node
/**
 * XSS regression tests for widgets/character-sheet.js.
 *
 * Any value interpolated into an HTML attribute (portrait_url/name in
 * src=""/alt="", aria-label, href, data-tip) must go through escAttr, not
 * escapeHtml — escapeHtml keeps quotes, allowing attribute breakout — and
 * portrait_url must additionally pass URL scheme validation. fmt() must
 * escape kit_details_json values for non-numeric input rather than emitting
 * them raw.
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
  const html = cs.rIdentity({}, { name: 'Hero', fields: { portrait_url: BREAKOUT } });
  assertNoAttrBreakout(assert, html, 'H-1 portrait breakout');   // legit <img> present; check breakout only
  assert.ok(/&quot;/.test(html), 'the payload quote must be escaped to &quot;');
  // (alt="" uses the identical escAttr call; escAttr's quote-escaping is unit-tested above.)
});

test('H-1: a javascript: portrait_url falls back to the placeholder (no <img>)', () => {
  const html = cs.rIdentity({}, { name: 'Hero', fields: { portrait_url: 'javascript:alert(1)' } });
  assert.ok(!/<img/.test(html), 'no <img> for a rejected scheme');
  assert.ok(/cs-portrait-placeholder/.test(html), 'placeholder shown instead');
});

test('H-1: a benign portrait URL still renders an <img>', () => {
  const html = cs.rIdentity({}, { name: 'Hero', fields: { portrait_url: '/media/hero.png' } });
  assert.ok(/<img class="cs-portrait" data-cs-portrait src="\/media\/hero.png"/.test(html), 'benign portrait renders');
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

// ── Paper layout: every user-authored value in the new markup is escaped ──
const PX = (fields, extra) => Object.assign({ name: XSS, isGm: true, isOwner: true, canEditIdentity: true, canChangeImage: true, fields }, extra || {});

test('paper: hostile name, origin values and class cannot inject', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const f = { ancestry: XSS, culture: XSS, career: XSS, kit: XSS, class: XSS, subclass: XSS, faction: XSS };
  const html = cs.paperSheetHtml(PX(f));
  assertNoInjection(assert, html, 'paper identity');
  assert.ok(/&lt;img/.test(html));
});

test('paper: portrait_url breakout and javascript: scheme', () => {
  const bad = cs.pIdentity(PX({ portrait_url: BREAKOUT }, { name: 'Hero' }));
  assertNoAttrBreakout(assert, bad, 'paper portrait breakout');
  assert.ok(/&quot;/.test(bad));
  const js = cs.pIdentity(PX({ portrait_url: 'javascript:alert(1)' }));
  assert.ok(!/<img/.test(js) && /sh-port-ph/.test(js));
  assert.ok(/<img src="\/media\/h.png"/.test(cs.pIdentity(PX({ portrait_url: '/media/h.png' }))));
});

test('paper: panel title and kind attributes cannot break out', () => {
  const html = cs.paperSheetHtml(PX({}, { name: BREAKOUT }));
  const tags = html.match(/<template\b[^>]*>/g) || [];
  assert.ok(tags.every((t) => /^<template data-sheet-panel="[^"]*" data-title="[^"]*" data-kind="[^"]*">$/.test(t)), 'no template tag gains an extra attribute');
  const attrs = [...html.matchAll(/<template data-sheet-panel="[^"]*" data-title="([^"]*)" data-kind="([^"]*)">/g)];
  assert.ok(attrs.length >= 5, 'panel templates carry both attributes');
  assert.ok(attrs.some((m) => /&quot;/.test(m[1] + m[2])), 'the hero name reaches an attribute escaped');
});

test('paper: kit, features, skills, items, notes, damage and conditions are escaped', () => {
  const f = {
    kit_details_json: JSON.stringify([{ name: XSS, stability: XSS, meleeDamageT1: '<svg onload=alert(1)>' }]),
    features_json: JSON.stringify([{ name: XSS, description: XSS }]),
    perks_json: JSON.stringify([{ name: XSS, description: XSS }]),
    skills_json: JSON.stringify([XSS]),
    languages_json: JSON.stringify([XSS]),
    treasures_json: JSON.stringify([{ name: XSS, category: XSS, keywords: [XSS], description: XSS, quantity: XSS }]),
    conditions_json: JSON.stringify([{ name: XSS, severity: XSS }]),
    immunities: JSON.stringify([{ type: XSS, value: XSS }]), weaknesses: XSS, status_immunities: JSON.stringify([XSS]),
    heroic_resource_name: XSS, backstory: XSS, notes: XSS, gm_notes: XSS, victories: XSS, xp: XSS, renown: XSS, wealth: XSS, size: XSS, speed: XSS
  };
  const d = PX(f, { name: 'Hero' });
  const html = cs.paperSheetHtml(d);
  assertNoInjection(assert, html, 'paper sheet');
  for (const p of cs.paperPanels(d)) assertNoInjection(assert, p.html, 'paper panel ' + p.id);
});

test('paper: the story pin and children items escape their text', () => {
  const pin = cs.storyPinHtml(PX({ backstory: XSS }));
  assertNoInjection(assert, pin, 'paper story pin');
  const items = cs.pItemsPanel(PX({}, { campaignId: XSS, children: [
    { relation: { slug: 'has-item' }, entity: { id: XSS, name: XSS }, metadata: { quantity: 1 } }
  ] }));
  assertNoInjection(assert, items, 'paper items');
});
