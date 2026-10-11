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
  assert.ok(/data-ds-tab="maneuver"[^>]*>Maneuver <em>2<\/em>/.test(html));
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
  assert.deepEqual(secs.slice().sort(), panelIds(html).slice().sort());
  for (const id of secs) assert.ok(html.includes('data-sheet-open="' + id + '"'), 'open button ' + id);
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

test('paper identity keeps the origin picker hooks and no Change chip without permission', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const rw = cs.pIdentity(PAPER);
  for (const k of ['ancestry', 'culture', 'career', 'kit']) assert.ok(rw.includes('data-cs-pick="' + k + '"'), k);
  assert.ok(/data-cs-pick-fold/.test(rw) && /data-cs-change-image/.test(rw));
  const ro = cs.pIdentity(Object.assign({}, PAPER, { canEditIdentity: false, canChangeImage: false }));
  assert.ok(!/data-cs-pick=/.test(ro) && !/data-cs-change-image/.test(ro));
  assert.ok(/data-v="origin-ancestry"/.test(ro), 'value is still a changing number');
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
  const band = cs.paperSheetHtml(data);
  assert.ok(/Blessed Light, Drain/.test(band), 'the band names every signature ability');
});

test('paper abilities panel escapes ability names', () => {
  const data = { name: 'X', fields: { abilities_json: JSON.stringify([{ name: '<img src=x onerror=1>"', category: 'signature' }]) } };
  const html = cs.paperPanels(data).find((p) => p.id === 'abilities').html;
  assert.ok(!/<img src=x/.test(html) && !/data-ds-name="<img/.test(html));
});
