#!/usr/bin/env node
/**
 * XSS regression tests for widgets/monster-builder.js.
 *
 * The builder opens OTHER users' creatures (a page's fields_data, or a
 * community bestiary stat block through Start from…), so every value it puts
 * into an input's value attribute, a select, a textarea or the side panel is
 * a stored-XSS surface, not just self-XSS. Each must be escaped for its
 * context, quotes included.
 *
 * Run: `node --test tools/test-monster-builder.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, assertNoInjection, assertNoAttrBreakout } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
globalThis.MonsterEngine = Engine;
globalThis.MonsterParty = require('../widgets/monster-party.js');
globalThis.DrawSteelStatblock = require('../widgets/statblock-renderer.js');
const Ed = require('../widgets/monster-builder.js');

const XSS = '<img src=x onerror=alert(document.cookie)>';
const BREAKOUT = 'x" onfocus="alert(document.cookie)';
const REFS = { orgs: [], roles: [] };

function hostile(v) {
  return {
    level: 1, organization: v, role: v, size: v, keywords: v, faction: v, immunities: v, free_strike: v,
    traits: JSON.stringify([{ name: v, description: v }]),
    abilities_json: JSON.stringify([{ name: v, type: v, keywords: [v], distance: v, target: v, power_roll: v, tier1: v, tier2: v, tier3: v, trigger: v, effect: v }]),
    villain_actions_json: JSON.stringify([{ name: v, order: 'opener', effect: v }])
  };
}

test('a hostile creature cannot inject through the editor’s cards', () => {
  const st = Ed.newState(XSS, hostile(XSS), REFS);
  const html = Ed.editorHtml(st, {});
  assertNoInjection(assert, html, 'editor');
});

test('a hostile value cannot break out of an input’s value attribute', () => {
  const st = Ed.newState(BREAKOUT, hostile(BREAKOUT), REFS);
  assertNoAttrBreakout(assert, Ed.editorHtml(st, {}), 'identity boxes');
  ['a0', 'v0', 't0'].forEach((k) => {
    st.editAb = k;
    assertNoAttrBreakout(assert, Ed.editorHtml(st, {}), 'ability form ' + k);
  });
});

test('a hostile ability cannot inject through its open edit form', () => {
  const st = Ed.newState('X', hostile(XSS), REFS);
  st.editAb = 'a0';
  assertNoInjection(assert, Ed.editorHtml(st, {}), 'ability form');
});

test('the Generate panel escapes what was typed and the reasons it shows', () => {
  const st = Ed.newState('X', null, REFS);
  const gen = { open: true, what: BREAKOUT, kind: 'platoon', role: '', level: 1, why: [XSS] };
  assertNoAttrBreakout(assert, Ed.editorHtml(st, { gen }), 'what is it');
  assertNoInjection(assert, Ed.editorHtml(st, { gen: Object.assign({}, gen, { what: XSS }) }), 'reasons');
});

test('the Add abilities drawer escapes library text and the creature’s own names', () => {
  const t = { slug: 'x', name: XSS, properties: { type: 'action', keywords: [XSS], distance: XSS, target: XSS, tier1: '2 damage', tier2: XSS, tier3: XSS, effect: XSS, organizations: ['platoon'], roles: [] } };
  const st = Ed.newState('X', hostile(XSS), REFS);
  assertNoInjection(assert, Ed.drawerCard(st, { t, i: 0, ok: true, why: [] }, {}, [t]), 'drawer card');
  assertNoInjection(assert, Ed.drawerMine(st, null), 'drawer list');
  const b = Ed.newState('X', hostile(BREAKOUT), REFS);
  assertNoAttrBreakout(assert, Ed.drawerMine(b, null), 'drawer list');
  assertNoAttrBreakout(assert, Ed.drawerCard(b, { t: Object.assign({}, t, { name: BREAKOUT }), i: 0, ok: true, why: [] }, {}, [t]), 'drawer card');
});

test('Build with an AI escapes what the AI wrote, in the editor and in its notes', () => {
  const V = Ed.vocabulary(REFS, {});
  const answer = (v) => ({ name: v, level: 2, organization: v, role: v, size: v, keywords: [v],
    traits: [{ name: v, effect: v }], signature: { name: v, keywords: [v], distance: v, target: v, damage_type: v, tier_effects: [v, v, v], effect: v },
    abilities: [{ name: v, type: 'action', keywords: [v], distance: v, target: v, trigger: v, effect: v, tier_effects: [v, v, v] }],
    villain_actions: [{ name: v }], stamina: v, ev: v });
  const st = Ed.newState('', null, REFS);
  const notes = Ed.fromAI(st, answer(XSS), V);
  assertNoInjection(assert, Ed.editorHtml(st, {}), 'AI creature');
  assertNoInjection(assert, Ed.aiNotesHtml(notes), 'AI notes');
  const b = Ed.newState('', null, REFS);
  Ed.fromAI(b, answer(BREAKOUT), V);
  assertNoAttrBreakout(assert, Ed.editorHtml(b, {}), 'AI creature');
  b.editAb = 'a0';
  assertNoAttrBreakout(assert, Ed.editorHtml(b, {}), 'AI ability form');
});

test('the side panel escapes the creature and hero names', () => {
  const heroes = [{ name: XSS, fields_data: { level: 2, class: XSS, might: 1, agility: 1, reason: 1, intuition: 1, presence: 1 } }];
  const st = Ed.newState(XSS, { level: 2, organization: 'horde' }, REFS);
  const html = Ed.sideHtml(st, { party: { heroes, profile: globalThis.MonsterParty.deriveParty(heroes), levels: [2] } });
  assertNoInjection(assert, html, 'side panel');
});

test('a benign creature’s fields come back unchanged in the boxes', () => {
  const st = Ed.newState('Grak the Underboss', { level: 3, organization: 'leader', faction: 'Bloodfang', keywords: 'Goblin, Humanoid' }, REFS);
  const html = Ed.editorHtml(st, {});
  assert.match(html, /value="Grak the Underboss"/);
  assert.match(html, /value="Goblin, Humanoid"/);
  assert.match(html, /<option value="leader" selected>Leader<\/option>/);
});

test('a size outside the list stays selected instead of falling back to 1T', () => {
  for (const size of ['2L', '2M', '3L', '4H', '4G']) {
    const html = Ed.editorHtml(Ed.newState('Drake', { level: 3, size }, REFS), {});
    assert.match(html, new RegExp('<option value="' + size + '" selected>'));
    assert.doesNotMatch(html, /<option value="1T" selected>/);
  }
  const listed = Ed.editorHtml(Ed.newState('Drake', { level: 3, size: '1L' }, REFS), {});
  assert.match(listed, /<option value="1L" selected>/);
  assert.doesNotMatch(listed, /as stored/);
});

test('Start from… recomputes a copy for the level kept, and marks formula-shaped damage', () => {
  const refs = {
    orgs: JSON.parse(JSON.stringify(require('../data/organization-templates.json'))),
    roles: JSON.parse(JSON.stringify(require('../data/role-templates.json'))),
  };
  const st = Ed.newState('Mine', { level: 7, organization: 'platoon', role: 'brute' }, refs);
  Ed.startFrom(st, 'Ogre', { level: 7, organization: 'platoon', role: 'brute', ev: 3, stamina: 5,
    abilities: [{ name: 'Club', type: 'signature', keywords: ['Melee', 'Strike'], tier1: '2 damage', tier2: '4 damage', tier3: '6 damage; push 2' }] }, 'Started from Ogre.');
  assert.equal(st.name, 'Ogre (copy)');
  assert.equal(st.c.ev, Engine.Formulas.encounterValue(7, refs.orgs.find((o) => o.slug === 'platoon')).value, 'the copy’s stale EV is not kept');
  assert.equal(st.c.abilities[0].auto_damage, true);
  assert.match(st.c.abilities[0].tier3, /; push 2$/);
  assert.match(Ed.editorHtml(st, {}), /Started from Ogre\./);
});

test('saving keeps the page’s fields the editor does not own', () => {
  const st = Ed.newState('Ogre', { level: 3, organization: 'elite', role: 'brute', weaknesses: 'fire 5', notes_gm: 'keep me' }, REFS);
  const out = Ed.toSave(st);
  assert.equal(out.fields.notes_gm, 'keep me');
  assert.equal(out.fields.weaknesses, 'fire 5');
  assert.equal(out.fields.level, 3);
});
