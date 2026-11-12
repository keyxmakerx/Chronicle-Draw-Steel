#!/usr/bin/env node
/**
 * Layout contract for widgets/character-sheet.js: the identity band, the
 * schema order (which is also the phone order), the removed stub buttons and
 * the ability tabs.
 *
 * Run: `node --test tools/test-character-sheet-layout.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');

const ids = (schema) => schema.rows.map((r) => r.columns.map((c) => c.boxes.map((b) => b.id)));

test('rIdentity: origin values are buttons only when the host allows editing', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const data = { name: 'Bren', fields: { ancestry: 'Human', class: 'Fury', level: 3 } };
  const ro = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: false }));
  assert.ok(!/data-cs-pick=/.test(ro) && !/data-cs-change-image/.test(ro), 'read-only: no pickers, no Change chip');
  assert.ok(/set in Foundry/.test(ro) && /Fury/.test(ro), 'class shown read-only with the hint');
  const rw = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: true }));
  for (const k of ['ancestry', 'culture', 'career', 'kit']) assert.ok(rw.includes('data-cs-pick="' + k + '"'), k);
  assert.ok(!/data-cs-change-image/.test(rw), 'identity editing alone gives no Change chip');
  const gm = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: true, canChangeImage: true }));
  assert.ok(/data-cs-change-image/.test(gm), 'Change chip when the picture may be replaced');
  assert.ok(!/>Bren</.test(rw), "the name is Chronicle's header job");
});

test('rIdentity: without Chronicle.pickChoice the values stay plain text', () => {
  const saved = globalThis.window.Chronicle.pickChoice;
  delete globalThis.window.Chronicle.pickChoice;
  const html = cs.rIdentity({}, { name: 'Bren', canEditIdentity: true, fields: { ancestry: 'Human' } });
  assert.ok(!/data-cs-pick=/.test(html) && /Human/.test(html));
  globalThis.window.Chronicle.pickChoice = saved;
});

test('no stub buttons (Roll, Level Up, Share, Roll Might) remain', () => {
  const data = { name: 'Bren', fields: { stamina_max: 30, stamina_current: 30 } };
  const html = cs.rIdentity({}, data) + cs.rVitals({}, data);
  assert.ok(!/data-cs-act|Roll Might|Level Up|Share|coming later/i.test(html));
});

test('buildSchema: identity, vitals, characteristics, then main | side columns', () => {
  const rows = ids(cs.buildSchema({ isGm: false, isOwner: false, armoryItems: false }));
  assert.deepEqual(rows[0], [['ds-identity']]);
  assert.deepEqual(rows[1], [['ds-vitals']]);
  assert.deepEqual(rows[2], [['ds-characteristics']]);
  assert.deepEqual(rows[3][0], ['ds-abilities', 'ds-features', 'ds-skills']);
  assert.deepEqual(rows[3][1], ['ds-combat', 'ds-kit', 'ds-damage', 'ds-inventory', 'ds-progression']);
  assert.equal(rows.length, 4, 'no Background or GM lore for a plain viewer');
});

test('buildSchema: armory-items drops the in-sheet Inventory; Background and GM lore are gated', () => {
  const flat = (d) => ids(cs.buildSchema(d)).flat(2);
  assert.ok(!flat({ armoryItems: true }).includes('ds-inventory'));
  assert.ok(flat({ isOwner: true }).includes('ds-notes') && !flat({ isOwner: true }).includes('ds-gmlore'));
  assert.ok(flat({ isGm: true }).includes('ds-notes') && flat({ isGm: true }).includes('ds-gmlore'));
});

test('rAbilities: a tablist with counts, signature open first', () => {
  const abilities = [
    { name: 'Hit', category: 'signature' }, { name: 'Smash', category: 'heroic', cost: 3 },
    { name: 'Aid' }, { name: 'Run' }
  ];
  const html = cs.rAbilities({}, { fields: { abilities_json: JSON.stringify(abilities) } });
  assert.ok(/role="tablist"/.test(html));
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.ok(/data-ds-tab="maneuver"[^>]*>Other <em>2<\/em>/.test(html), 'not signature or heroic: named Other, not Maneuver');
  assert.ok(/id="ds-tab-signature"[^>]*aria-selected="true"/.test(html));
});

// ── Paper layout (Chronicle.sheetMotion present) ──────────────────────────
const PAPER = {
  name: 'Bren', isGm: true, isOwner: true, canEditIdentity: true, canChangeImage: true,
  fields: {
    ancestry: 'Human', class: 'Tactician', level: 2, stamina_current: 19, stamina_max: 42, winded: 21,
    recoveries: 7, recoveries_max: 10, heroic_resource_current: 2, surges: 1, might: 2, presence: -1,
    victories: 3, xp: 9, backstory: 'A veteran.', gm_notes: 'secret',
    skills_json: JSON.stringify(['endurance']),
    features_json: JSON.stringify([{ name: 'Mark', level: 1, description: 'Mark a foe' }]),
    treasures_json: JSON.stringify([{ name: 'Torch', quantity: 3 }]),
    kit_details_json: JSON.stringify([{ name: 'Armor', meleeDamageT1: 2, stamina: 12 }]),
    abilities_json: JSON.stringify([{ name: 'Hit', category: 'signature' }, { name: 'Aid' }])
  }
};
const panelIds = (html) => [...html.matchAll(/<template data-sheet-panel="([^"]*)"/g)].map((m) => m[1]);
const sectionIds = (html) => [...html.matchAll(/data-sheet-section="([^"]*)"/g)].map((m) => m[1]);

test('paperAvailable follows Chronicle.sheetMotion.mount', () => {
  const C = globalThis.window.Chronicle;
  assert.equal(cs.paperAvailable(), false, 'older Chronicle: box render');
  C.sheetMotion = { mount() {}, land() {} };
  assert.equal(cs.paperAvailable(), true);
  delete C.sheetMotion;
  assert.equal(cs.paperAvailable(), false);
});

test('paperSheetHtml: contract root, folio, paper stack, changing numbers', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(/^<div class="sh-root" data-sheet>/.test(html), 'data-sheet root');
  assert.ok(/data-sheet-folio/.test(html));
  assert.ok(/<div class="paper-stack[^"]*"><article class="paper[ "]/.test(html), '.paper-stack > .paper');
  for (const v of ['stamina', 'hr', 'surges', 'rec']) assert.ok(html.includes('data-v="' + v + '"'), 'data-v ' + v);
  for (const v of ['victories', 'xp']) assert.ok(html.includes('data-pv="' + v + '"'), 'data-pv ' + v);
});

test('paperSheetHtml: every section has an open button and a matching template panel', () => {
  const html = cs.paperSheetHtml(PAPER);
  const secs = sectionIds(html);
  const panels = panelIds(html);
  for (const id of secs) assert.ok(panels.includes(id), 'panel ' + id);
  for (const id of panels) assert.ok(html.includes('data-sheet-open="' + id + '"'), 'open button ' + id);
  for (const id of secs) assert.ok(html.includes('data-sheet-open="' + id + '"'), 'open button ' + id);
  assert.ok(secs.includes('kit') && !/data-sheet-section="abilities"/.test(html), 'kit is a ledger line; abilities open from their own link');
  assert.ok(/<template data-sheet-panel="abilities" data-title="[^"]+" data-kind="[^"]+">/.test(html));
  assert.ok(!/<template[^>]*>\s*<template/.test(html));
});

test('paperPanels: items, notes and GM lore follow the same gates as the box schema', () => {
  const ids2 = (d) => cs.paperPanels(d).map((p) => p.id);
  assert.ok(ids2({ fields: {} }).includes('items'));
  assert.ok(!ids2({ armoryItems: true, fields: {} }).includes('items'));
  assert.ok(!ids2({ fields: {} }).includes('notes'), 'plain viewer: no notes');
  assert.ok(ids2({ isOwner: true, fields: {} }).includes('notes'));
  const lore = (d) => cs.paperPanels(d).find((p) => p.id === 'notes').html.includes('secret');
  assert.equal(lore({ isOwner: true, fields: { gm_notes: 'secret' } }), false, 'owner never sees GM lore');
  assert.equal(lore({ isGm: true, fields: { gm_notes: 'secret' } }), true);
  const html = cs.paperSheetHtml({ fields: {} });
  assert.ok(!/data-sheet-section="notes"/.test(html) && !/data-sheet-section="items"[^]*armory/.test(html));
});

test('paper folds use the contract: details > .fold-body > .fold-in[data-move=fold]', () => {
  const html = cs.paperPanels(PAPER).map((p) => p.html).join('');
  assert.ok(/<details[^>]*data-sheet-fold/.test(html), 'a fold is present');
  assert.ok(/<div class="fold-body"><div class="fold-in" data-move="fold">/.test(html));
});

test('paper identity is one line and keeps the origin picker hooks', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const rw = cs.pIdentity(PAPER);
  for (const k of ['ancestry', 'culture', 'career', 'kit']) assert.ok(rw.includes('data-cs-pick="' + k + '"'), k);
  assert.ok(/data-cs-pick-fold/.test(rw) && /data-cs-change-image/.test(rw));
  const line = rw.match(/<p class="sh-idline">([^]*?)<\/p>/)[1];
  assert.ok(/Human/.test(line) && /Tactician 2/.test(line) && /data-cs-pick="kit"/.test(line), 'ancestry, class and level, kit on the line');
  assert.ok(!/data-cs-pick="(culture|career)"/.test(line), 'culture and career are one fold away');
  const ro = cs.pIdentity(Object.assign({}, PAPER, { canEditIdentity: false, canChangeImage: false }));
  assert.ok(!/data-cs-pick=/.test(ro) && !/data-cs-change-image/.test(ro));
  assert.ok(/data-v="origin-ancestry"/.test(ro), 'value is still a changing number');
  assert.ok(!/<img/.test(rw), 'the page header owns the picture');
});

test('paper sheet prints the hero name once, in the page header', () => {
  const html = cs.paperSheetHtml(Object.assign({}, PAPER, { name: 'Zorblax' }));
  assert.ok(!/<h2/.test(html) && !/>Zorblax</.test(html));
  assert.ok(/Hero · Draw Steel/.test(html));
});

test('one word per look on the parts: no Rules, Details or Sources labels', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(!/class="sh-pull">(Rules|Details|Sources)</.test(html));
  assert.equal((html.match(/class="sh-pull"><span class="only-paper">Pull out<\/span><span class="only-modern">Open<\/span>/g) || []).length, (html.match(/class="sh-pull"/g) || []).length);
});

test('phone: the sheet parts fill the column and the recoveries dots wrap', () => {
  const src = readFileSync(new URL('../widgets/character-sheet.js', import.meta.url), 'utf8');
  assert.ok(/\.sh-body \{ display:flex;flex-direction:column;align-items:stretch;/.test(src), 'a part is as wide as the sheet');
  assert.ok(/\.sh-pips \{ display:block;max-width:100%;[^']*word-break:break-all/.test(src), 'twelve dots wrap inside their column');
});

test('mountSheet: without sheetMotion the box render runs (no paper markup)', () => {
  const el = { innerHTML: '', querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {} };
  assert.equal(cs.paperAvailable(), false);
  const html = cs.buildSchema({}) && cs.rIdentity({}, PAPER);
  assert.ok(!/data-sheet/.test(html), 'box identity carries no paper contract');
  assert.equal(el.innerHTML, '');
});

test('paper abilities panel lists every ability of a group as its own fold', () => {
  const abilities = [
    { name: 'Blessed Light', category: 'signature' }, { name: 'Drain', category: 'signature' },
    { name: 'Judgment', category: 'heroic', cost: 7 }, { name: 'Command', category: 'heroic', cost: 3 },
    { name: 'Shove', type: 'maneuver' }
  ];
  const data = { name: 'Tyne', fields: { abilities_json: JSON.stringify(abilities) } };
  const html = cs.paperPanels(data).find((p) => p.id === 'abilities').html;
  for (const a of abilities) assert.ok(html.includes('data-ds-name="' + a.name + '"'), a.name);
  assert.equal((html.match(/<details class="ft ab-fold/g) || []).length, abilities.length, 'one fold each');
  assert.equal((html.match(/ab-fold is-in/g) || []).length, 1, 'only the first of the open group starts open');
  assert.ok(html.indexOf('Command') < html.indexOf('Judgment'), 'cheapest first within a group');
  assert.ok(!/data-ds-pane/.test(html), 'no single-ability detail pane on paper');
})

test('paper abilities panel escapes ability names', () => {
  const data = { name: 'X', fields: { abilities_json: JSON.stringify([{ name: '<img src=x onerror=1>"', category: 'signature' }]) } };
  const html = cs.paperPanels(data).find((p) => p.id === 'abilities').html;
  assert.ok(!/<img src=x/.test(html) && !/data-ds-name="<img/.test(html));
});

// ── Abilities on the face ─────────────────────────────────────────────────
const dmg = (a, b, c, types) => [{ damage: { tier1: { value: a, types: types || [] }, tier2: { value: b, types: types || [] }, tier3: { value: c, types: types || [] } } }];
const FACE = [
  { name: 'Halt', category: 'signature', type: 'action', distanceType: 'melee', distance: 1, powerRollChars: ['might'], tiers: dmg('2 + @chr', '5 + @chr', '7 + @chr', ['holy']), effectAfter: 'The target is slowed. Save ends.' },
  { name: 'Arrest', category: 'heroic', type: 'action', cost: 5, powerRollChars: ['might'], tiers: dmg('6 + @chr', '9 + @chr', '13 + @chr') },
  { name: 'Driving', category: 'heroic', type: 'action', cost: 3, powerRollChars: ['might'], tiers: dmg('3 + @chr', '6 + @chr', '9 + @chr') },
  { name: 'Judgment', type: 'maneuver', distanceType: 'ranged', distance: 10, effectAfter: 'Judge one creature.' },
  { name: 'Wrath', type: 'triggered', trigger: 'A judged creature hurts an ally' },
  { name: 'Strike', category: 'freeStrike', type: 'none', powerRollChars: ['might'], tiers: dmg('2 + @chr', '2 + @chr', '2 + @chr') }
];
const faceData = (abs, extra) => ({ name: 'Tyne', fields: Object.assign({ might: 2, heroic_resource_name: 'Wrath', heroic_resource_current: 4, abilities_json: JSON.stringify(abs) }, extra || {}) });

test('actionKind groups by when an ability is used, from the type Foundry sends', () => {
  const k = (a) => cs.actionKind(a);
  assert.equal(k({ type: 'action' }), 'main');
  for (const t of ['maneuver', 'move', 'free']) assert.equal(k({ type: t }), 'maneuver', t);
  for (const t of ['triggered', 'freeTriggered']) assert.equal(k({ type: t }), 'triggered', t);
  assert.equal(k({ type: 'none', category: 'freeStrike' }), 'free');
  assert.equal(k({ category: 'signature' }), 'main', 'unknown type: signature is a main action');
  assert.equal(k({ cost: 3 }), 'main');
  assert.equal(k({ name: 'Plain' }), 'maneuver');
});

test('face: four headings in order, each ability once, empty headings left out', () => {
  const html = cs.pAbilities(faceData(FACE));
  const heads = [...html.matchAll(/<span class="paper-kind">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Main action', 'Maneuver', 'Triggered', 'Free strike']);
  assert.equal((html.match(/<details class="ft sx-line/g) || []).length, FACE.length);
  const only = cs.pAbilities(faceData([FACE[0]]));
  const h2 = [...only.matchAll(/<span class="paper-kind">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(h2, ['Main action', 'Free strike'], 'no Maneuver or Triggered heading with nothing under it');
});

test('face: the hero\'s own tier results, the star, the cost tag and the unaffordable reason', () => {
  const html = cs.pAbilities(faceData(FACE));
  assert.ok(html.includes('4 · 7 · 9 holy'), 'Might 2 worked into the three tiers');
  assert.ok(/role="img" aria-label="Signature">★/.test(html), 'signature star has a spoken label');
  assert.ok(html.includes('3 Wrath</span>') && !html.includes('3 Wrath, you have'), 'affordable: plain cost tag');
  assert.ok(html.includes('5 Wrath, you have 4'), 'unaffordable: the tag gives the reason');
  assert.equal((html.match(/sx-line sx-no/g) || []).length, 1, 'only Arrest is greyed');
  assert.ok(html.indexOf('Driving') < html.indexOf('Arrest'), 'cheaper first');
  assert.ok(html.indexOf('Halt') < html.indexOf('Driving'), 'signature first');
  assert.ok(html.includes('Ranged 10'), 'no power roll: the distance stands in');
  assert.ok(/data-sheet-fold/.test(html) && /data-move="fold"/.test(html), 'unfolds with the Fold move');
  assert.ok(/data-sheet-open="abilities"/.test(html), 'the full card stays reachable');
});

test('face: a free strike is always listed, worked out from the kit when none is synced', () => {
  const kit = JSON.stringify([{ name: 'Armor', meleeDamageT1: 2, meleeDamageT2: 2, meleeDamageT3: 2 }]);
  const html = cs.pAbilities(faceData([], { kit_details_json: kit }));
  assert.ok(/Free strike/.test(html) && /kit \+2 · \+2 · \+2/.test(html));
  assert.ok(/No abilities yet/.test(html));
  assert.ok(/Free strike/.test(cs.pAbilities(faceData([]))), 'listed even with no kit');
});

test('face: ability text is escaped', () => {
  const html = cs.pAbilities(faceData([{ name: '<img src=x onerror=1>', type: 'action', cost: 1, effectAfter: '<b>x</b>', trigger: '<i>t</i>' }]));
  assert.ok(!/<img src=x|<b>x|<i>t/.test(html));
});

test('kit is a quiet ledger line, not a part', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(/data-sheet-section="kit"/.test(html) && /<span class="sh-nm">Kit<\/span>/.test(html));
  assert.ok(!/aria-label="Kit"/.test(html), 'no Kit part in the side column');
});
