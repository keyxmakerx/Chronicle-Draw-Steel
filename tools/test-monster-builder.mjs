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
