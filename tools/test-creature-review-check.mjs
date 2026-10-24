#!/usr/bin/env node
/**
 * The AI Import review's creature check (DrawSteelStatblock.reviewCheck and
 * Chronicle.sheetChecks.creature): each figure the AI wrote that a published
 * formula covers, beside the formula's figure, and the patch that takes the
 * formula's figure for the ones the director picks. Expected figures come
 * from DrawSteelFormulas, the one evaluation site.
 *
 * Run: `node --test tools/test-creature-review-check.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
const Chronicle = makeChronicle();
globalThis.Chronicle = Chronicle;

const require = createRequire(import.meta.url);
const F = require('../widgets/monster-engine.js').Formulas;
globalThis.DrawSteelFormulas = F;
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const REFS = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
const org = (s) => REFS.orgs.find((o) => o.slug === s);
const role = (s) => REFS.roles.find((r) => r.slug === s);

const SPEAR = { name: 'Hooked Spear', type: 'signature', keywords: ['Melee', 'Strike', 'Weapon'], distance: 'Melee 1', target: 'One creature',
  tier1: '4 damage', tier2: '6 damage; pull 1', tier3: '8 fire damage; pull 2', effect: 'It shifts 1.' };
const HOWL = { name: 'Howl', type: 'maneuver', keywords: ['Area'], distance: '2 burst', target: 'Each enemy', tier1: '1 damage', tier2: '2 damage', tier3: '3 damage' };
const TAUNT = { name: 'Taunt', type: 'action', keywords: ['Ranged'], tier1: 'Pull 1', tier2: 'Pull 2', tier3: 'Pull 3' };

const raider = (extra) => Object.assign({
  level: 1, organization: 'Platoon', role: 'Harrier', ev: F.encounterValue(1, org('platoon')).value,
  stamina: 20, winded: 10, free_strike: '2 damage', speed: 6, abilities_json: JSON.stringify([SPEAR, HOWL, TAUNT])
}, extra || {});
const ALL = ['level', 'organization', 'role', 'ev', 'stamina', 'winded', 'free_strike', 'speed', 'abilities_json'];

const stamina = F.stamina(1, org('platoon'), role('harrier')).value;
const d = F.damageTiers(1, org('platoon'), role('harrier')).value;
const hc = F.highestCharacteristic(1, org('platoon')).value;
const tiers = (add) => [d.tier1 + add, d.tier2 + add, d.tier3 + add].join(' / ');

test('each covered figure the AI wrote sits beside the published formula', () => {
  const r = S.reviewCheck(raider(), REFS, ALL);
  assert.equal(r.note, 'Level 1 Platoon Harrier');
  assert.deepEqual(r.items, [
    { id: 'ev', label: 'Encounter value', ai: String(raider().ev), formula: String(raider().ev), matches: true },
    { id: 'stamina', label: 'Stamina', ai: '20', formula: String(stamina), matches: stamina === 20 },
    { id: 'winded', label: 'Winded', ai: '10', formula: String(Math.floor(stamina / 2)), matches: Math.floor(stamina / 2) === 10 },
    { id: 'free_strike', label: 'Free strike', ai: '2', formula: String(d.tier1), matches: d.tier1 === 2 },
    // A strike adds the highest characteristic; an area ability doesn't.
    { id: 'ability-0', label: 'Hooked Spear', ai: '4 / 6 / 8', formula: tiers(hc), matches: tiers(hc) === '4 / 6 / 8' },
    { id: 'ability-1', label: 'Howl', ai: '1 / 2 / 3', formula: tiers(0), matches: tiers(0) === '1 / 2 / 3' },
  ], 'speed has no formula, and Taunt deals no damage, so neither is checked');
  assert.notEqual(stamina, 20, 'the fixture must differ from the formula to test anything');
});

test('the patch takes the formula only for what the director picked, keeping the AI’s words', () => {
  const r = S.reviewCheck(raider({ free_strike: '2 damage, or 4 against a prone target' }), REFS, ALL);
  assert.deepEqual(r.patch([]), {});
  const p = r.patch(['stamina', 'winded', 'free_strike', 'ability-0']);
  assert.equal(p.stamina, stamina);
  assert.equal(p.winded, Math.floor(stamina / 2));
  assert.equal(p.free_strike, d.tier1 + ' damage, or 4 against a prone target');
  assert.ok(!('ev' in p));
  const list = JSON.parse(p.abilities_json);
  assert.deepEqual(list[0], Object.assign({}, SPEAR, {
    tier1: (d.tier1 + hc) + ' damage', tier2: (d.tier2 + hc) + ' damage; pull 1', tier3: (d.tier3 + hc) + ' fire damage; pull 2' }));
  assert.deepEqual(list.slice(1), [HOWL, TAUNT], 'abilities not picked are left as the AI wrote them');
  assert.equal(S.reviewCheck(raider({ free_strike: '2' }), REFS, ALL).patch(['free_strike']).free_strike, d.tier1 + ' damage');
});

test('only figures the AI wrote are checked', () => {
  const r = S.reviewCheck(raider(), REFS, ['stamina']);
  assert.deepEqual(r.items.map((i) => i.id), ['stamina']);
  assert.deepEqual(Object.keys(r.patch(['stamina', 'ev', 'ability-0'])), ['stamina']);
});

test('no check where the published formulas don’t cover the creature, or didn’t load', () => {
  assert.equal(S.reviewCheck(raider({ organization: 'Mob' }), REFS, ALL), null, 'unknown organization');
  assert.equal(S.reviewCheck(raider({ level: '' }), REFS, ALL), null, 'no level');
  assert.equal(S.reviewCheck(raider(), { orgs: [], roles: [] }, ALL), null, 'templates missing');
  const swarm = S.reviewCheck(raider({ organization: 'Swarm' }), REFS, ALL);
  assert.ok(!swarm || !swarm.items.some((i) => i.id === 'ev' || i.id === 'stamina' || i.id === 'winded'), 'a swarm’s EV and Stamina are the director’s');
  globalThis.DrawSteelFormulas = undefined;
  try {
    assert.equal(S.reviewCheck(raider(), REFS, ALL), null);
  } finally {
    globalThis.DrawSteelFormulas = F;
  }
});

test('Chronicle.sheetChecks.creature loads the campaign’s templates and checks', async () => {
  const asked = [];
  Chronicle.apiFetch = (url) => {
    asked.push(url);
    const f = url.endsWith('organization-templates.json') ? REFS.orgs : REFS.roles;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(f) });
  };
  const r = await Chronicle.sheetChecks.creature.check(raider(), { campaignId: 'camp-9', written: ['stamina'] });
  assert.deepEqual(asked, ['/campaigns/camp-9/systems/drawsteel/data/organization-templates.json', '/campaigns/camp-9/systems/drawsteel/data/role-templates.json']);
  assert.deepEqual(r.items.map((i) => [i.id, i.formula]), [['stamina', String(stamina)]]);
});
