#!/usr/bin/env node
/**
 * Defense-in-depth hardening tests for widgets/monster-builder.js,
 * widgets/bestiary-browser.js and widgets/character-sheet.js
 * (keyxmakerx/Cordinator#196 / keyxmakerx/Chronicle-Draw-Steel#47).
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
Chronicle.markClean = function () {}; // used by monster-builder's _onSaveSuccess
globalThis.Chronicle = Chronicle;

// ── monster-builder.js ──────────────────────────────────────────────────

require('../widgets/monster-builder.js');
const mb = Chronicle.registry['monster-builder'];

function mbInst(overrides) {
  return Object.assign(Object.create(mb), Object.assign({
    config: {}, creature: baseCreature(), _entityIsPrivate: false
  }, overrides || {}));
}

function baseCreature(extra) {
  return Object.assign({
    name: 'Test', level: 1, size: '1M', faction: '', keywords: [],
    organization: 'minion', role: 'ambusher', ev: 0, stamina: 0, winded: 0,
    speed: 5, stability: 0, might: 0, agility: 0, reason: 0, intuition: 0,
    presence: 0, immunities: [], free_strike: '', free_strike_damage: 0,
    abilities: [{ name: 'Bite', type: 'signature' }],
    villain_actions: [], traits: []
  }, extra || {});
}

test('monster-builder: _loadExistingEntity percent-encodes campaignId/entityId in the URL', () => {
  Chronicle.apiFetch = fetchMock(function () { return okJson(null); });
  const inst = mbInst({ config: { campaignId: 'a/b', entityId: 'c?d' } });
  return mb._loadExistingEntity.call(inst).then(function () {
    const url = Chronicle.apiFetch.calls[0];
    assert.equal(Chronicle.apiFetch.calls.length, 1);
    assert.ok(url.indexOf('/campaigns/a%2Fb/') !== -1, 'campaignId must be percent-encoded: ' + url);
    assert.ok(url.indexOf('/entities/c%3Fd') !== -1, 'entityId must be percent-encoded: ' + url);
  });
});

test('monster-builder: _updateEntity percent-encodes ids', () => {
  Chronicle.apiFetch = fetchMock(function () { return okJson({}); });
  const inst = mbInst({ config: { campaignId: 'x y', entityId: '1&2' } });
  return mb._updateEntity.call(inst, {}).then(function () {
    const url = Chronicle.apiFetch.calls[0];
    assert.ok(url.indexOf('x%20y') !== -1 || url.indexOf('x+y') !== -1, 'campaignId space must be encoded: ' + url);
    assert.ok(url.indexOf('1%262') !== -1, 'entityId "&" must be encoded: ' + url);
  });
});

test('monster-builder: _createEntity and _resolveEntityTypeId percent-encode campaignId', () => {
  Chronicle.apiFetch = fetchMock(function (url) {
    if (url.indexOf('/entity-types') !== -1) return okJson({ data: [{ slug: 'drawsteel-creature', id: 9 }] });
    return okJson({ id: 42 });
  });
  const inst = mbInst({ config: { campaignId: 'a/../b' } });
  return mb._createEntity.call(inst, {}).then(function () {
    Chronicle.apiFetch.calls.forEach(function (url) {
      assert.ok(url.indexOf('a%2F..%2Fb') !== -1, 'campaignId must be percent-encoded: ' + url);
    });
  });
});

test('monster-builder: a malformed abilities_json shape does not become a non-array', () => {
  Chronicle.apiFetch = fetchMock(function () {
    return okJson({ id: 5, fields_data: { abilities_json: '{"not":"an array"}' } });
  });
  const inst = mbInst({ config: { campaignId: '1', entityId: '5' } });
  return mb._loadExistingEntity.call(inst).then(function () {
    assert.ok(Array.isArray(inst.creature.abilities), 'abilities must normalize to an array');
    assert.equal(inst.creature.abilities.length, 0);
    // Must not throw when downstream code calls array methods on it.
    assert.doesNotThrow(function () { inst.creature.abilities.filter(function (a) { return a; }); });
  });
});

test('monster-builder: abilities_json keeps well-formed entries and drops junk entries', () => {
  Chronicle.apiFetch = fetchMock(function () {
    return okJson({
      id: 5,
      fields_data: { abilities_json: JSON.stringify([{ name: 'Bite', type: 'signature' }, null, 'junk', 42, { name: 'Claw' }]) }
    });
  });
  const inst = mbInst({ config: { campaignId: '1', entityId: '5' } });
  return mb._loadExistingEntity.call(inst).then(function () {
    assert.equal(inst.creature.abilities.length, 2);
    assert.equal(inst.creature.abilities[0].name, 'Bite');
    assert.equal(inst.creature.abilities[1].name, 'Claw');
  });
});

test('monster-builder: a malformed traits shape does not become a non-array', () => {
  Chronicle.apiFetch = fetchMock(function () {
    // Valid JSON, but a string rather than an array — must not survive as-is.
    return okJson({ id: 5, fields_data: { traits: JSON.stringify('oops not an array') } });
  });
  const inst = mbInst({ config: { campaignId: '1', entityId: '5' } });
  return mb._loadExistingEntity.call(inst).then(function () {
    assert.ok(Array.isArray(inst.creature.traits), 'traits must normalize to an array');
    assert.equal(inst.creature.traits.length, 0);
    assert.doesNotThrow(function () { inst.creature.traits.forEach(function () {}); });
  });
});

test('monster-builder: legacy plain-text (non-JSON) traits still wrap as a single trait', () => {
  Chronicle.apiFetch = fetchMock(function () {
    return okJson({ id: 5, fields_data: { traits: 'Keen Senses. Sees in the dark.' } });
  });
  const inst = mbInst({ config: { campaignId: '1', entityId: '5' } });
  return mb._loadExistingEntity.call(inst).then(function () {
    assert.equal(inst.creature.traits.length, 1);
    assert.equal(inst.creature.traits[0].description, 'Keen Senses. Sees in the dark.');
  });
});

test('monster-builder: _boundCreatureFields clamps level, truncates name, caps list length', () => {
  const abilities = [];
  for (let i = 0; i < 80; i++) abilities.push({ name: 'A' + i, type: 'melee' });
  const cr = baseCreature({ name: 'x'.repeat(500), level: 9999, abilities: abilities });
  const bounded = mb._boundCreatureFields(cr);
  assert.equal(bounded.name.length, 200);
  assert.equal(bounded.level, 20);
  assert.equal(bounded.abilities.length, 50);
  // Original object must be untouched (pure function).
  assert.equal(cr.name.length, 500);
  assert.equal(cr.level, 9999);
  assert.equal(cr.abilities.length, 80);

  const low = mb._boundCreatureFields(baseCreature({ level: -5 }));
  assert.equal(low.level, 1);
});

test('monster-builder: _save shows a fixed generic message, never the raw server message', () => {
  const alerts = [];
  globalThis.alert = function (msg) { alerts.push(msg); };
  Chronicle.apiFetch = fetchMock(function () {
    return errJson(500, 'SECRET: constraint fk_entities_campaign_id violated at row 42');
  });
  const inst = mbInst({ config: { campaignId: '1', entityId: '5' }, _validate: function () { return []; } });
  mb._save.call(inst);
  return new Promise(function (resolve) {
    setTimeout(function () {
      assert.equal(alerts.length, 1);
      assert.ok(alerts[0].indexOf('SECRET') === -1, 'raw server message must not reach the user: ' + alerts[0]);
      assert.ok(alerts[0].indexOf('constraint') === -1, alerts[0]);
      resolve();
    }, 0);
  });
});

test('monster-builder: _publishToBestiary shows a fixed generic message, never the raw server message', () => {
  Chronicle.apiFetch = fetchMock(function () { return errJson(500, 'SECRET internal detail'); });
  const inst = mbInst({
    config: { campaignId: '1' }, _canPublish: true,
    creature: baseCreature({ name: 'Goblin' }),
    _setPublishMsg: function (msg) { this._lastPublishMsg = msg; }
  });
  mb._publishToBestiary.call(inst);
  return new Promise(function (resolve) {
    setTimeout(function () {
      assert.ok(inst._lastPublishMsg.indexOf('SECRET') === -1, 'raw server message leaked: ' + inst._lastPublishMsg);
      resolve();
    }, 0);
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

require('../widgets/statblock-renderer.js');
const sr = Chronicle.registry['statblock-renderer'];

test('statblock-renderer: _parseJSON falls back on a valid-JSON-but-non-array value', () => {
  assert.deepEqual(sr._parseJSON(JSON.stringify('oops not an array'), []), []);
});

test('statblock-renderer: _loadEntity never yields a villain_actions that throws on .filter', () => {
  Chronicle.apiFetch = fetchMock(function () {
    return okJson({ id: '1', name: 'X', fields_data: { villain_actions_json: JSON.stringify('oops not an array') } });
  });
  const inst = Object.assign(Object.create(sr), { config: { campaignId: '1', entityId: '1' } });
  return sr._loadEntity.call(inst).then(function () {
    assert.ok(Array.isArray(inst.creature.villain_actions));
    assert.doesNotThrow(function () { inst.creature.villain_actions.filter(function (v) { return v.name; }); });
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
