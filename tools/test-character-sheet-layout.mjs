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
  const data = { name: 'Bren', fields: { ancestry: 'Human', class: 'Fury', level: 3 } };
  const ro = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: false }));
  assert.ok(!/data-cs-pick=/.test(ro) && !/data-cs-change-image/.test(ro), 'read-only: no pickers, no Change chip');
  assert.ok(/set in Foundry/.test(ro) && /Fury/.test(ro), 'class shown read-only with the hint');
  const rw = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: true }));
  for (const k of ['ancestry', 'culture', 'career', 'kit']) assert.ok(rw.includes('data-cs-pick="' + k + '"'), k);
  assert.ok(/data-cs-change-image/.test(rw), 'Change chip when editable');
  assert.ok(!/>Bren</.test(rw), "the name is Chronicle's header job");
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
