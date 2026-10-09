#!/usr/bin/env node
/**
 * Defense-in-depth hardening tests for widgets/monster-builder.js,
 * widgets/statblock-renderer.js, widgets/bestiary-browser.js and
 * widgets/character-sheet.js.
 *
 * campaignId/entityId come from Chronicle's own widget config and server
 * data rather than free user input, but every id still goes straight into a
 * fetch URL by string concatenation. Percent-encoding it means a stray "/"
 * or "?" can never reshape the request path. Stored ability JSON, creature
 * field sizes, and error text shown to the user get the same treatment:
 * fail closed to a safe default rather than trust the stored/remote shape.
 *
 * Run: `node --test tools/test-widget-input-hardening.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, makeEl, FakeRef } from './_xss-harness.mjs';

installDom();

// A Chronicle.apiFetch mock that records every URL it was called with and
// resolves however the test configures it.
function fetchMock(handler) {
  var calls = [];
  var fn = function (url, opts) {
    calls.push(url);
    return Promise.resolve(handler(url, opts));
  };
  fn.calls = calls;
  return fn;
}

function okJson(body) {
  return { ok: true, json: function () { return Promise.resolve(body); } };
}
function errJson(status, message) {
  return {
    ok: false, status: status || 400,
    json: function () { return Promise.resolve({ message: message }); }
  };
}

const require = createRequire(import.meta.url);

// Both monster-builder.js and bestiary-browser.js read the bare global
// `Chronicle` at call time (they are not wrapped in an IIFE that captures a
// local reference), so they must share one mock object for the whole file —
// reassigning globalThis.Chronicle to a second object would leave code
// already `require`d against the first object silently reading stale/wrong
// mocks the moment a later test mutates the second.
const Chronicle = makeChronicle();
Chronicle.markClean = function () {};
Chronicle.markDirty = function () {};
globalThis.Chronicle = Chronicle;

// ── monster-builder.js / statblock-renderer.js ─────────────────────────

// The builder reads the shared stat block and the published formulas as
// globals, as it does in a browser.
const SB = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = SB;
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
globalThis.MonsterEngine = Engine;
const Ed = require('../widgets/monster-builder.js');
const REFS = { orgs: [], roles: [] };

test('monster-builder: a save percent-encodes campaignId and entityId', () => {
  Chronicle.apiFetch = fetchMock(function () { return okJson({ id: 'e', fields_data: {} }); });
  const st = Ed.newState('Goblin', { level: 1, organization: 'horde' }, REFS);
  return Ed.save(st, { campaignId: 'a/b', entityId: 'c?d' }).then(function () {
    const url = Chronicle.apiFetch.calls[0];
    assert.ok(url.indexOf('/campaigns/a%2Fb/') !== -1, url);
    assert.ok(url.indexOf('/entities/c%3Fd') !== -1, url);
  });
});

test('monster-builder: creating a creature percent-encodes campaignId on both requests', () => {
  Chronicle.apiFetch = fetchMock(function (url) {
    if (/entity-types/.test(url)) return okJson({ data: [{ id: 7, preset_category: 'creature' }] });
    return okJson({ id: 'new', fields_data: {} });
  });
  const st = Ed.newState('Goblin', { level: 1, organization: 'horde' }, REFS);
  return Ed.save(st, { campaignId: 'a/b', entityId: '' }).then(function () {
    const calls = Chronicle.apiFetch.calls;
    assert.equal(calls.length, 2);
    calls.forEach(function (u) { assert.ok(u.indexOf('/campaigns/a%2Fb/') !== -1, u); });
  });
});

test('monster-builder: a malformed abilities_json shape becomes an empty list', () => {
  [JSON.stringify('oops'), '42', '{"a":1}', 'not json'].forEach(function (raw) {
    const st = Ed.newState('X', { level: 1, abilities_json: raw }, REFS);
    assert.ok(Array.isArray(st.c.abilities), raw);
    assert.equal(st.c.abilities.length, 0, raw);
  });
});

test('monster-builder: abilities_json keeps well-formed entries and drops junk entries', () => {
  const raw = JSON.stringify([{ name: 'Bite' }, null, 7, 'x', { name: 'Claw' }]);
  const st = Ed.newState('X', { level: 1, abilities_json: raw }, REFS);
  assert.deepEqual(st.c.abilities.map(function (a) { return a.name; }), ['Bite', 'Claw']);
});

test('monster-builder: a malformed traits shape does not become a non-array', () => {
  const st = Ed.newState('X', { level: 1, traits: JSON.stringify({ name: 'x' }) }, REFS);
  assert.ok(Array.isArray(st.c.traits));
});

test('monster-builder: legacy plain-text (non-JSON) traits still read as a single trait', () => {
  const st = Ed.newState('X', { level: 1, traits: 'Undead: Immune to poison.' }, REFS);
  assert.deepEqual(st.c.traits, [{ name: 'Undead', description: 'Immune to poison.' }]);
});

test('monster-builder: an empty immunities or keywords string loads as an empty list', () => {
  // The old wizard kept '' as a string and its Statistics step threw on
  // immunities.forEach.
  const st = Ed.newState('X', { level: 1, immunities: '', keywords: '' }, REFS);
  assert.deepEqual(st.c.immunities, []);
  assert.deepEqual(st.c.keywords, []);
  assert.doesNotThrow(function () { Ed.editorHtml(st, {}); });
});

test('monster-builder: what a save writes clamps level, truncates name, caps list length', () => {
  const many = [];
  for (let i = 0; i < 80; i++) many.push({ name: 'A' + i });
  const st = Ed.newState('n'.repeat(500), { level: 99, abilities_json: JSON.stringify(many) }, REFS);
  const out = Ed.toSave(st);
  assert.equal(out.name.length, 200);
  assert.equal(out.fields.level, 20);
  assert.equal(JSON.parse(out.fields.abilities_json).length, 50);
});

test('monster-builder: a failed save carries a fixed message, never the raw server message', () => {
  Chronicle.apiFetch = fetchMock(function () {
    return errJson(500, 'SECRET: constraint fk_entities_campaign_id violated at row 42');
  });
  const st = Ed.newState('Goblin', { level: 1, organization: 'horde' }, REFS);
  return Ed.save(st, { campaignId: '1', entityId: '5' }).then(function () {
    assert.fail('the save should have failed');
  }, function (err) {
    assert.ok(err.message.indexOf('SECRET') === -1, err.message);
    assert.ok(err.message.indexOf('constraint') === -1, err.message);
    assert.equal(err.status, 500, 'a server failure is marked so the editor shows its own text');
  });
});

// ── bestiary-browser.js ─────────────────────────────────────────────────

require('../widgets/bestiary-browser.js');
const bb = Chronicle.registry['bestiary-browser'];

function bbInst(overrides) {
  return Object.assign(Object.create(bb), Object.assign({ config: {}, state: {}, _ref: new FakeRef() }, overrides || {}));
}

test('bestiary-browser: _entityUrl percent-encodes campaignId and entityId', () => {
  assert.equal(bb._entityUrl('1', undefined), '/api/v1/campaigns/1/entities');
  assert.equal(bb._entityUrl('a/b', 'c?d'), '/api/v1/campaigns/a%2Fb/entities/c%3Fd');
});

test('bestiary-browser: _resolveCreatureTypeId percent-encodes campaignId', () => {
  Chronicle.apiFetch = fetchMock(function () { return okJson({ data: [] }); });
  const inst = bbInst({ config: { campaignId: 'a b' } });
  return bb._resolveCreatureTypeId.call(inst).then(function () {
    assert.ok(Chronicle.apiFetch.calls[0].indexOf('a%20b') !== -1, Chronicle.apiFetch.calls[0]);
  });
});

test('bestiary-browser: _fetchEntityPages percent-encodes campaignId via _entityUrl', () => {
  Chronicle.apiFetch = fetchMock(function () { return okJson({ data: [], total: 0 }); });
  const inst = bbInst({ config: { campaignId: 'a/b' } });
  return bb._fetchEntityPages.call(inst, 0).then(function () {
    assert.ok(Chronicle.apiFetch.calls[0].indexOf('a%2Fb') !== -1, Chronicle.apiFetch.calls[0]);
  });
});

test('bestiary-browser: _boundCreatureFields clamps level, truncates name, caps ability count', () => {
  const abilities = [];
  for (let i = 0; i < 80; i++) abilities.push({ name: 'A' + i });
  const cr = { name: 'y'.repeat(400), level: 0, abilities: abilities, traits: [] };
  const bounded = bb._boundCreatureFields(cr);
  assert.equal(bounded.name.length, 200);
  assert.equal(bounded.level, 1);
  assert.equal(bounded.abilities.length, 50);
  assert.equal(cr.abilities.length, 80, 'must not mutate the source creature');
});

test('bestiary-browser: _parseJSON falls back on a valid-JSON-but-non-array value', () => {
  // JSON.parse('"oops not an array"') succeeds and yields a string, which
  // has .length but not .filter/.forEach — must fall back, not pass through.
  assert.deepEqual(bb._parseJSON(JSON.stringify('oops not an array'), []), []);
  assert.deepEqual(bb._parseJSON('42', []), []);
  assert.deepEqual(bb._parseJSON('{"a":1}', []), []);
});

test('bestiary-browser: _parseJSON keeps well-formed array entries and drops junk entries', () => {
  const raw = JSON.stringify([{ name: 'Bite' }, null, 'junk', 42, { name: 'Claw' }]);
  const parsed = bb._parseJSON(raw, []);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Bite');
  assert.equal(parsed[1].name, 'Claw');
});

test('bestiary-browser: _normalizeEntity never yields a villain_actions that throws on .filter', () => {
  const entity = { id: '1', name: 'X', fields_data: { villain_actions_json: JSON.stringify('oops not an array') } };
  const cr = bb._normalizeEntity.call(bb, entity);
  assert.ok(Array.isArray(cr.villain_actions));
  assert.doesNotThrow(function () { cr.villain_actions.filter(function (v) { return v.name; }); });
});

// ── statblock-renderer.js ───────────────────────────────────────────────

test('statblock-renderer: a valid-JSON-but-non-array list falls back to empty', () => {
  const c = SB.normalize({ villain_actions_json: JSON.stringify('oops not an array'), abilities_json: '{"a":1}' });
  assert.deepEqual(c.villain_actions, []);
  assert.deepEqual(c.abilities, []);
  assert.doesNotThrow(function () { c.villain_actions.filter(function (v) { return v.name; }); });
});

function panelEl() {
  const el = makeEl();
  el.ownerDocument = { querySelectorAll: function () { return []; }, querySelector: function () { return null; }, head: makeEl(), createElement: makeEl };
  el.querySelector = function (sel) { return sel === '.sbx-msg' ? (el._msg = el._msg || makeEl()) : null; };
  return el;
}

test('statblock-renderer: the panel percent-encodes campaignId and entityId', () => {
  Chronicle.apiFetch = fetchMock(function () { return okJson({ data: [] }); });
  const p = new SB.Panel(panelEl(), { campaignId: 'a/b', entityId: 'c?d', isGm: true });
  return p.start().then(function () {
    const url = Chronicle.apiFetch.calls.filter(function (u) { return /\/entities\//.test(u); })[0];
    assert.ok(url.indexOf('/campaigns/a%2Fb/') !== -1, url);
    assert.ok(url.indexOf('/entities/c%3Fd') !== -1, url);
  });
});

test('statblock-renderer: a failed publish shows a fixed message, never the raw server message', () => {
  Chronicle.apiFetch = fetchMock(function () { return errJson(500, 'SECRET internal detail'); });
  const el = panelEl();
  const p = new SB.Panel(el, { campaignId: '1', entityId: '2', isGm: true });
  p.entity = { id: '2', name: 'Goblin', fields_data: { level: 1, organization: 'horde' } };
  p.publish('published');
  return new Promise(function (resolve) {
    setTimeout(function () {
      assert.ok(el._msg.textContent.length > 0, 'a message is shown');
      assert.ok(el._msg.textContent.indexOf('SECRET') === -1, 'raw server message leaked: ' + el._msg.textContent);
      resolve();
    }, 10);
  });
});

// ── character-sheet.js ──────────────────────────────────────────────────

globalThis.window = { Chronicle: makeChronicle() };
const cs = require('../widgets/character-sheet.js');

test('character-sheet: fetchEntity percent-encodes campaignId and entityId', () => {
  globalThis.window.Chronicle.apiFetch = fetchMock(function () { return okJson({}); });
  return cs.fetchEntity('a/b', 'c?d').then(function () {
    const url = globalThis.window.Chronicle.apiFetch.calls[0];
    assert.ok(url.indexOf('/campaigns/a%2Fb/') !== -1, url);
    assert.ok(url.indexOf('/entities/c%3Fd') !== -1, url);
  });
});
