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

test('fetchLayers: a refusal or failure is no layers and no drawer, never an error', async () => {
  const saved = globalThis.window.Chronicle.apiFetch;
  const none = { layers: [], canEdit: false };
  globalThis.window.Chronicle.apiFetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  assert.deepEqual(await cs.fetchLayers('c', 'e'), none);
  globalThis.window.Chronicle.apiFetch = () => Promise.reject(new Error('down'));
  assert.deepEqual(await cs.fetchLayers('c', 'e'), none);
  globalThis.window.Chronicle.apiFetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve({ layers: [{ name: url }], canEdit: true }) });
  assert.deepEqual(await cs.fetchLayers('c 1', 'e'), { layers: [{ name: '/campaigns/c%201/pages/e/layers' }], canEdit: true });
  assert.deepEqual(await cs.fetchLayers('', 'e'), none);
  globalThis.window.Chronicle.apiFetch = saved;
});

// ── The Changes drawer ──────────────────────────────────────────────────

const ANCESTRIES = load('ancestries.json');
const pick = (slug, over) => Object.assign(cs.tfState(), { add: slug, pick: cs.quickPicks(preset(slug)) }, over || {});
const sheet = (over) => cs.withLayers(Object.assign({ name: 'Mirela Voss', entityId: 'e1', campaignId: 'c1', fields: mirela(), isGm: true,
  tf: { canEdit: true, layers: [], presets: PRESETS, ancestries: ANCESTRIES } }, over || {}), (over && over.tf ? over.tf.layers : []));
const names = (changes, op) => changes.filter((c) => c.field === 'features_json' && c.op === op).map((c) => (op === 'remove' ? c.value : c.value.name));

test('Revenant over a human, quick build: Bloodless, and the human traits set aside', () => {
  const got = cs.presetLayer(preset('revenant'), sheet(), pick('revenant'), ANCESTRIES);
  assert.deepEqual(got.problems, []);
  assert.equal(got.spent, 2);
  assert.equal(got.budget, 2);
  assert.equal(got.layer.source, 'drawsteel:revenant');
  assert.deepEqual(names(got.layer.changes, 'append'), ['Former Life', 'Tough But Withered', 'Bloodless']);
  assert.deepEqual(names(got.layer.changes, 'remove'), ['Detect the Supernatural', 'Staying Power']);
  const bloodless = got.layer.changes.find((c) => c.op === 'append' && c.value.name === 'Bloodless').value.description;
  assert.ok(!/\{@/.test(bloodless), 'rules markup is flattened');
});

test('Previous Life keeps a priced human trait and spends its points', () => {
  const st = pick('revenant', { pick: {}, keep: { 'Staying Power': true } });
  const got = cs.presetLayer(preset('revenant'), sheet(), st, ANCESTRIES);
  assert.deepEqual(got.problems, []);
  assert.equal(got.spent, 2);
  assert.deepEqual(names(got.layer.changes, 'remove'), ['Detect the Supernatural'], 'the signature trait still goes');
  assert.ok(names(got.layer.changes, 'append').includes('Previous Life: Staying Power'));
  assert.match(got.layer.note, /Previous Life: 2 Points keeps Staying Power/);
  // A signature trait has no price, so it cannot be kept.
  const sig = cs.oldAncestryTraits(sheet(), ANCESTRIES).find((t) => t.name === 'Detect the Supernatural');
  assert.equal(sig.cost, 0);
});

test('overspending holds Push back and says why', () => {
  const st = pick('revenant', { keep: { 'Staying Power': true } });
  const got = cs.presetLayer(preset('revenant'), sheet(), st, ANCESTRIES);
  assert.equal(got.spent, 4);
  assert.match(got.problems.join(' '), /4 of 2 ancestry points/);
  const data = sheet();
  data.tfState = Object.assign(st, { open: true });
  assert.match(cs.pChanges(data), /data-tf="push" disabled/);
});

test('numbers the Director corrects become add changes', () => {
  const st = pick('vampire-scion', { adjust: { recoveries_max: -2, speed: 0, stamina_max: 'x' } });
  const got = cs.presetLayer(preset('vampire-scion'), sheet(), st, ANCESTRIES);
  const adds = got.layer.changes.filter((c) => c.op === 'add');
  assert.deepEqual(adds.map((c) => [c.field, c.value]), [['recoveries_max', -2]]);
  assert.deepEqual(names(got.layer.changes, 'remove'), [], 'Vampire Scion sets nothing aside');
});

test('the drawer is only for a Director Chronicle lets change the hero', () => {
  assert.equal(cs.pChanges(sheet({ isGm: false })), '');
  assert.equal(cs.pChanges(sheet({ tf: { canEdit: false, layers: [], presets: PRESETS, ancestries: [] } })), '');
  assert.equal(cs.pChanges(sheet({ tf: null })), '');
  const closed = cs.pChanges(sheet());
  assert.match(closed, /data-tf="tab" aria-expanded="false"/);
  assert.ok(!/sh-tf-drawer/.test(closed));
  assert.match(cs.paperSheetHtml(sheet()), /<section class="sh-tf"/);
});

test('the open drawer lists the presets not already on, and the ones on as tick boxes', () => {
  const on = { id: 'l1', name: 'Vampire Scion', source: 'drawsteel:vampire-scion', changes: preset('vampire-scion').properties.changes };
  const data = sheet({ tf: { canEdit: true, layers: [on], presets: PRESETS, ancestries: ANCESTRIES } });
  data.tfState = Object.assign(cs.tfState(), { open: true });
  const html = cs.pChanges(data);
  assert.match(html, /Changes · 1/);
  assert.match(html, /data-tf-on="l1" checked/);
  assert.match(html, /data-tf-p="revenant"/);
  assert.ok(!/data-tf-p="vampire-scion"/.test(html), 'a preset already on is not offered again');
  assert.ok(!/data-tf="push"/.test(html), 'no Push without a preview');
});

test('previewing a preset strikes what it moves in the preview colour', () => {
  const data = sheet();
  const st = pick('revenant', { open: true });
  data.tfState = st;
  cs.withLayers(data, [], cs.tfPreview(data, st));
  const html = cs.paperSheetHtml(data);
  assert.match(html, /<s class="sh-was sh-was-pv"[^>]*><span class="sh-sr">Was <\/span>Human<\/s> Revenant/);
  assert.match(html, /sh-layer sh-layer-pv[^>]*><span class="sh-sr">Preview: <\/span>Revenant/);
  assert.match(html, /Previewing Mirela as Revenant\. Only you see this\./);
  assert.match(html, /data-tf="push"[^>]*>Push to Mirela</);
  assert.match(html, /Revenant asks · ancestry points <b class="">2 of 2<\/b>/);
  assert.equal(data.ownFields.ancestry, 'Human', 'the hero\'s own fields stay as they were');
  const panel = cs.pFeaturesPanel(data);
  assert.match(panel, /Bloodless <span class="sh-layer sh-layer-sm sh-layer-pv">/);
});

test('previewing taking a layer off shows what comes off with it', () => {
  const on = { id: 'l1', name: 'Revenant', source: 'drawsteel:revenant', changes: preset('revenant').properties.changes };
  const data = sheet({ tf: { canEdit: true, layers: [on], presets: PRESETS, ancestries: ANCESTRIES } });
  assert.equal(data.fields.ancestry, 'Revenant');
  const st = Object.assign(cs.tfState(), { open: true, remove: 'l1' });
  data.tfState = st;
  cs.withLayers(data, [on], cs.tfPreview(data, st));
  assert.equal(data.fields.ancestry, 'Human');
  const html = cs.paperSheetHtml(data);
  assert.match(html, /<s class="sh-was sh-was-pv"[^>]*><span class="sh-sr">Was <\/span>Revenant<\/s> Human/);
  assert.match(html, /data-tf-on="l1">/, 'the tick box is unticked');
  assert.match(html, />Take it off</);
  assert.match(cs.pFeaturesPanel(data), /Coming off with Revenant · preview[\s\S]*<s class="sh-was sh-was-pv">Former Life<\/s>/);
});

test('drawer text is escaped', () => {
  const bad = { slug: 'x', name: '<img src=x onerror=alert(1)>', summary: '"><script>', source: 's', properties: { changes: [] } };
  const on = { id: '"><b>', name: '<script>', source: '', changes: [] };
  const data = sheet({ name: '<b>Mirela</b>', tf: { canEdit: true, layers: [on], presets: [bad], ancestries: [] } });
  data.tfState = Object.assign(cs.tfState(), { open: true, add: 'x', err: '<i>no</i>' });
  const html = cs.pChanges(data);
  assert.ok(!/<img src=x|<script>|<b>Mirela|<i>no|data-tf-on="">/.test(html));
});

test('loadTransformData: missing files are empty lists, and no Workshop means no Save', async () => {
  const saved = globalThis.window.Chronicle.apiFetch;
  const seen = [];
  globalThis.window.Chronicle.apiFetch = (url) => { seen.push(url); return url.endsWith('transformations.json')
    ? Promise.resolve({ ok: true, json: () => Promise.resolve([{ slug: 'a' }]) }) : Promise.resolve({ ok: false }); };
  assert.deepEqual(await cs.loadTransformData('c1'), { presets: [{ slug: 'a' }], ancestries: [], canSave: false });
  assert.deepEqual(seen, ['/campaigns/c1/systems/drawsteel/data/transformations.json', '/campaigns/c1/systems/drawsteel/data/ancestries.json', '/campaigns/c1/homebrew/recipes']);
  globalThis.window.Chronicle.apiFetch = () => Promise.reject(new Error('down'));
  assert.deepEqual(await cs.loadTransformData('c1'), { presets: [], ancestries: [], canSave: false });
  globalThis.window.Chronicle.apiFetch = saved;
});

// ── The Director's own presets ──────────────────────────────────────────

const THRALL = { name: 'Thrall', source: 'homebrew', note: 'Bitten twice.', changes: [{ field: 'weaknesses', op: 'set', value: { holy: 3 } }] };
const recipe = (id, data) => ({ id, name: 'Thrall recipe', doc: { parts: [{ key: 'layer', kind: 'transformation', label: 'Thrall', see: 'director', data }], rules: [] } });

test('own presets are read from Workshop recipes with a transformation part', async () => {
  const saved = globalThis.window.Chronicle.apiFetch;
  const seen = [];
  globalThis.window.Chronicle.apiFetch = (url) => {
    seen.push(url);
    if (url === '/campaigns/c1/homebrew/recipes') return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [
      { id: 'r1', partKinds: ['transformation'] }, { id: 'r2', partKinds: ['tracker'] }, { id: 'r3', partKinds: ['clock', 'transformation'] }], total: 3 }) });
    if (url.endsWith('/r1')) return Promise.resolve({ ok: true, json: () => Promise.resolve(recipe('r1', THRALL)) });
    if (url.endsWith('/r3')) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: false });
  };
  const got = await cs.loadOwnPresets('c1');
  assert.equal(got.canSave, true);
  assert.deepEqual(got.presets.map((p) => [p.slug, p.name, p.own, p.recipeId]), [['own-r1', 'Thrall', true, 'r1']]);
  assert.ok(!seen.some((u) => u.endsWith('/r2')), 'a recipe with no transformation is not opened');
  globalThis.window.Chronicle.apiFetch = saved;
});

test('Save as my preset stores the layer as previewed, as the Director\'s alone', () => {
  const built = cs.presetLayer(preset('revenant'), sheet(), pick('revenant'), ANCESTRIES).layer;
  const r = cs.presetRecipe('Revenant (yours)', built);
  assert.equal(r.name, 'Revenant (yours)');
  assert.deepEqual(r.doc.rules, []);
  assert.equal(r.doc.parts.length, 1);
  const part = r.doc.parts[0];
  assert.deepEqual([part.kind, part.see, part.key], ['transformation', 'director', 'layer']);
  assert.deepEqual(Object.keys(part.data).sort(), ['changes', 'name', 'note', 'source'], 'only the keys Chronicle checks');
  assert.equal(part.data.name, 'Revenant (yours)');
  assert.deepEqual(part.data.changes, built.changes);
  // Saved and read back, it is the same layer under the new name.
  const back = cs.ownPreset({ id: 'r9', name: 'Revenant (yours)', doc: r.doc });
  assert.equal(cs.presetLayer(back, sheet(), cs.tfState(), ANCESTRIES).layer.source, 'homebrew:r9');
  assert.deepEqual(cs.presetLayer(back, sheet(), cs.tfState(), ANCESTRIES).layer.changes, built.changes);
  assert.equal(cs.ownPreset({ id: 'x', doc: { parts: [{ kind: 'tracker', data: {} }] } }), null);
});

test('the drawer groups canon and own presets, and offers Save only for a canon one', () => {
  const own = cs.ownPreset(recipe('r1', THRALL));
  const data = sheet({ tf: { canEdit: true, canSave: true, layers: [], presets: PRESETS.concat([own]), ancestries: ANCESTRIES } });
  data.tfState = pick('revenant', { open: true });
  cs.withLayers(data, [], cs.tfPreview(data, data.tfState));
  let html = cs.pChanges(data);
  assert.match(html, /From Draw Steel · ready to use[\s\S]*Your own · kept in the Homebrew Workshop[\s\S]*data-tf-p="own-r1"/);
  assert.match(html, /data-tf="save">Save as my preset</);
  data.tfState = Object.assign(cs.tfState(), { open: true, add: 'own-r1' });
  html = cs.pChanges(data);
  assert.ok(!/data-tf="save"/.test(html), 'an own preset is not saved again');
  data.tf.canSave = false;
  data.tfState = pick('revenant', { open: true });
  assert.ok(!/data-tf="save"/.test(cs.pChanges(data)), 'no Save when the Workshop did not answer');
  data.tf.canSave = true;
  data.tfState = pick('revenant', { open: true, saving: true, saveName: '"><img>' });
  html = cs.pChanges(data);
  assert.match(html, /data-tf-name value="&quot;&gt;&lt;img&gt;"/);
  assert.match(html, /data-tf="save-go"/);
});

test('?transform= opens the drawer on that preset, previewed', () => {
  const own = cs.ownPreset(recipe('r1', THRALL));
  const data = sheet({ tf: { canEdit: true, canSave: true, layers: [], presets: PRESETS.concat([own]), ancestries: ANCESTRIES } });
  const st = cs.tfFromAddress(data, '?transform=r1');
  assert.equal(st.open, true);
  assert.equal(st.add, 'own-r1');
  cs.withLayers(data, [], cs.tfPreview(data, st));
  assert.deepEqual(data.fields.weaknesses, { holy: 3 });
  assert.equal(data.ownFields.weaknesses, '', 'previewed, not stored');
  assert.equal(cs.tfFromAddress(data, ''), null);
  assert.match(cs.tfFromAddress(data, '?transform=gone').err, /not in the Homebrew Workshop/);
  const on = sheet({ tf: { canEdit: true, layers: [{ id: 'l1', name: 'Thrall', source: 'homebrew:r1', changes: THRALL.changes }], presets: [own], ancestries: [] } });
  const again = cs.tfFromAddress(on, '?transform=r1');
  assert.equal(again.add, null, 'a preset already on is not previewed twice');
  assert.match(again.msg, /already on Mirela/);
});

test('the Workshop action opens the hero it was set off on, and never pushes', () => {
  const saved = globalThis.window.location;
  let went = '';
  globalThis.window.location = { assign: (u) => { went = u; } };
  const line = cs.putOnFromRule({ campaignId: 'c 1', run: { recipeId: 'r1', scope: 'e/1' }, step: {} });
  assert.equal(went, '/campaigns/c%201/entities/e%2F1?transform=r1');
  assert.match(line, /press Push there/);
  went = '';
  assert.match(cs.putOnFromRule({ campaignId: 'c1', run: { recipeId: 'r1', scope: '' } }), /not set off from a hero/);
  assert.equal(went, '');
  globalThis.window.location = saved;
  assert.equal(globalThis.window.Chronicle.homebrewActions['put-on-transformation'], cs.putOnFromRule);
});
