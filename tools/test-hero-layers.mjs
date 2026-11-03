#!/usr/bin/env node
/**
 * Transformation layers on the hero sheet: the layer section of
 * widgets/character-sheet.js applies a hero's layers over their own fields
 * without changing them, and the paper sheet strikes through what a layer
 * changed. The ready-made presets in data/transformations.json must carry
 * the rules text of the entries they come from, word for word.
 *
 * Run: `node --test tools/test-hero-layers.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');
const L = cs.Layers;

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const PRESETS = load('transformations.json');
const preset = (slug) => PRESETS.find((p) => p.slug === slug);
const asLayer = (slug) => ({ name: preset(slug).name, changes: preset(slug).properties.changes });

// A level 4 human Tactician as the Foundry sync leaves her.
const mirela = () => ({
  ancestry: 'Human', class: 'Tactician', level: 4, recoveries: 12, recoveries_max: 12, speed: 5, stability: 1,
  immunities: { all: 0, fire: 0 }, weaknesses: '',
  features_json: [{ name: 'Detect the Supernatural', dsid: 'human-detect-the-supernatural' }, { name: 'Staying Power', dsid: 'human-staying-power' }]
});

test('apply never changes the hero\'s own fields', () => {
  const own = mirela();
  const before = JSON.stringify(own);
  L.apply(own, [asLayer('revenant'), asLayer('vampire-scion')]);
  assert.equal(JSON.stringify(own), before);
});

test('each op', () => {
  for (const [name, change, key, want] of [
    ['set replaces text', { field: 'ancestry', op: 'set', value: 'Revenant' }, 'ancestry', 'Revenant'],
    ['set with an object keeps the other keys', { field: 'immunities', op: 'set', value: { cold: 3 } }, 'immunities', { all: 0, fire: 0, cold: 3 }],
    ['set with an object onto an empty field', { field: 'weaknesses', op: 'set', value: { fire: 5 } }, 'weaknesses', { fire: 5 }],
    ['@level reads the field now', { field: 'immunities', op: 'set', value: { poison: '@level' } }, 'immunities', { all: 0, fire: 0, poison: 4 }],
    ['add', { field: 'recoveries_max', op: 'add', value: -2 }, 'recoveries_max', 10],
    ['remove by name, any case', { field: 'features_json', op: 'remove', value: 'staying power' }, 'features_json', [{ name: 'Detect the Supernatural', dsid: 'human-detect-the-supernatural' }]],
  ]) {
    const got = L.apply(mirela(), [{ name: 'X', changes: [change] }]);
    assert.deepEqual(got.fields[key], want, name);
    assert.ok(L.changed(got.diff, key), name + ' is marked changed');
  }
});

test('the diff keeps the value from before any layer, and who changed it', () => {
  const got = L.apply(mirela(), [
    { name: 'A', changes: [{ field: 'recoveries_max', op: 'add', value: -2 }] },
    { name: 'B', changes: [{ field: 'recoveries_max', op: 'add', value: 1 }] },
  ]);
  assert.equal(got.fields.recoveries_max, 11);
  assert.equal(got.diff.recoveries_max.was, 12);
  assert.deepEqual(got.diff.recoveries_max.by, ['A', 'B']);
});

test('a change that changes nothing is not marked, and bad changes are skipped', () => {
  const got = L.apply(mirela(), [{ name: 'X', changes: [
    { field: 'speed', op: 'set', value: 5 },
    { field: 'features_json', op: 'remove', value: 'Not There' },
    { field: '__proto__', op: 'set', value: 'x' },
    { field: 'speed', op: 'explode', value: 1 },
    null,
  ] }]);
  assert.equal(L.changed(got.diff, 'speed'), false);
  assert.equal(got.diff.features_json, undefined);
  assert.equal(got.fields.speed, 5);
});

test('no layers: the sheet is the hero\'s own', () => {
  const own = mirela();
  const got = L.apply(own, []);
  assert.deepEqual(got.fields, own);
  assert.deepEqual(got.diff, {});
});

test('the Revenant preset over a human', () => {
  const got = L.apply(mirela(), [asLayer('revenant')]);
  assert.equal(got.fields.ancestry, 'Revenant');
  assert.deepEqual(got.fields.immunities, { all: 0, fire: 0, cold: 4, corruption: 4, lightning: 4, poison: 4 });
  assert.deepEqual(got.fields.weaknesses, { fire: 5 });
  assert.deepEqual(got.fields.features_json.map((f) => f.name),
    ['Detect the Supernatural', 'Staying Power', 'Former Life', 'Tough But Withered']);
});

test('the presets quote their source entries word for word', () => {
  const plain = (s) => s.replace(/\{@\w+ ([^}|]+)(?:\|([^}]+))?\}/g, (_, a, b) => b || a);
  const rev = load('ancestries.json').find((e) => e.slug === 'revenant');
  const scion = load('complications.json').find((e) => e.slug === 'vampire-scion');
  const feat = (slug, name) => preset(slug).properties.changes.find((c) => c.op === 'append' && c.value.name === name).value.description;
  for (const t of rev.properties.signature_traits) assert.equal(feat('revenant', t.name), plain(t.description), t.name);
  assert.equal(feat('vampire-scion', 'Vampire Scion'),
    'Benefit: ' + scion.properties.benefit + ' Drawback: ' + scion.properties.drawback);
  const pts = preset('revenant').properties.choices.find((c) => c.key === 'ancestry_points');
  assert.equal(pts.budget, rev.properties.ancestry_points);
  assert.deepEqual(pts.traits.map((t) => [t.name, t.cost]), rev.properties.purchased_traits.map((t) => [t.name, t.cost]));
  assert.equal(preset('revenant').source, rev.source);
  assert.equal(preset('vampire-scion').source, scion.source);
});

test('every preset change is one Chronicle will store', () => {
  for (const p of PRESETS) {
    assert.ok(p.slug && p.name && p.source, p.slug);
    const changes = p.properties.changes;
    assert.ok(changes.length > 0 && changes.length <= 40, p.slug + ' change count');
    for (const c of changes) {
      assert.match(c.field, /^[a-z][a-z0-9_]{0,63}$/, p.slug + ' field');
      assert.ok(['set', 'add', 'append', 'remove'].includes(c.op), p.slug + ' op');
      assert.ok(JSON.stringify(c.value).length <= 4096, p.slug + ' value size');
    }
  }
});

test('the paper sheet strikes through what a layer changed', () => {
  const data = cs.withLayers({ name: 'Mirela', fields: mirela() }, [asLayer('revenant')]);
  const html = cs.paperSheetHtml(data);
  assert.match(html, /<s class="sh-was"[^>]*><span class="sh-sr">Was <\/span>Human<\/s> Revenant/, 'ancestry');
  assert.match(html, /class="sh-layer"[^>]*>Revenant</, 'the layer is named by the title');
  assert.match(html, /<s class="sh-was"[^>]*><span class="sh-sr">Was <\/span>None<\/s> /, 'weaknesses were none');
  assert.ok(!/<s class="sh-was"[^>]*>(<span[^>]*>Was <\/span>)?Tactician/.test(html), 'unchanged fields are not struck');
  const panel = cs.pFeaturesPanel(data);
  assert.match(panel, /Former Life <span class="sh-layer sh-layer-sm">Revenant<\/span>/, 'added trait is tagged');
});

test('set-aside traits are listed struck through', () => {
  const layer = { name: 'Revenant', changes: [{ field: 'features_json', op: 'remove', value: 'Staying Power' }] };
  const panel = cs.pFeaturesPanel(cs.withLayers({ name: 'Mirela', fields: mirela() }, [layer]));
  assert.match(panel, /Set aside by a transformation/);
  assert.match(panel, /<s class="sh-was">Staying Power<\/s>/);
});

test('layer names and notes are escaped', () => {
  const data = cs.withLayers({ name: 'Mirela', fields: mirela() },
    [{ name: '<img src=x onerror=alert(1)>', note: '"><script>', changes: [{ field: 'ancestry', op: 'set', value: '<b>x</b>' }] }]);
  const html = cs.paperSheetHtml(data);
  assert.ok(!/<img src=x/.test(html) && !/<script>/.test(html) && !/<b>x<\/b>/.test(html));
});

test('fetchLayers: a refusal or failure is no layers, never an error', async () => {
  const saved = globalThis.window.Chronicle.apiFetch;
  globalThis.window.Chronicle.apiFetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  assert.deepEqual(await cs.fetchLayers('c', 'e'), []);
  globalThis.window.Chronicle.apiFetch = () => Promise.reject(new Error('down'));
  assert.deepEqual(await cs.fetchLayers('c', 'e'), []);
  globalThis.window.Chronicle.apiFetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve({ layers: [{ name: url }] }) });
  assert.deepEqual(await cs.fetchLayers('c 1', 'e'), [{ name: '/campaigns/c%201/pages/e/layers' }]);
  assert.deepEqual(await cs.fetchLayers('', 'e'), []);
  globalThis.window.Chronicle.apiFetch = saved;
});
