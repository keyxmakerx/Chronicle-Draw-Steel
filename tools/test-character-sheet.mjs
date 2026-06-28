#!/usr/bin/env node
/**
 * Unit tests for the PURE logic in `widgets/character-sheet.js` — the math and
 * classifiers that drive the sheet but can't be eyeballed reliably: the "For
 * <hero>" power-roll odds, damage-formula resolution, ability grouping, the
 * feature-origin classifier, skill grouping, and the label humanizers.
 *
 * The widget is a browser IIFE; off-browser it exports these helpers via
 * module.exports (the register/registerBoxes side-effects are guarded on a null
 * Chronicle), so importing it here is inert beyond exposing the functions.
 *
 * Run: `node --test tools/test-character-sheet.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');

// ── tierOdds: 2d10 + mod, natural 19/20 → auto Tier 3 ─────────────────────
test('tierOdds always sums to 100 (enumerates all 100 outcomes)', () => {
  for (const mod of [-5, -2, 0, 1, 2, 3, 5, 8]) {
    const o = cs.tierOdds(mod);
    assert.equal(o[0] + o[1] + o[2], 100, `mod ${mod}`);
  }
});

test('tierOdds folds in the natural-19/20 auto-Tier-3 floor', () => {
  // A hugely negative mod pushes every non-crit roll to Tier 1, leaving only the
  // 3/100 natural 19-20 rolls as Tier 3 (9+10, 10+9, 10+10).
  assert.deepEqual(cs.tierOdds(-100), [97, 0, 3]);
});

test('tierOdds with a huge positive mod is all Tier 3', () => {
  assert.deepEqual(cs.tierOdds(50), [0, 0, 100]);
});

test('tierOdds(2) matches the rendered "For Tyne" card (Reason +2)', () => {
  // The expanded ability card shows these for Tyne's Reason +2.
  assert.deepEqual(cs.tierOdds(2), [36, 43, 21]);
});

test('tierOdds shifts mass upward as the mod grows', () => {
  assert.ok(cs.tierOdds(0)[0] > cs.tierOdds(4)[0]); // fewer Tier 1s with a higher mod
  assert.ok(cs.tierOdds(4)[2] > cs.tierOdds(0)[2]); // more Tier 3s
});

// ── safeEvalArith / substituteFormula ─────────────────────────────────────
test('safeEvalArith evaluates pure arithmetic and rejects anything else', () => {
  assert.equal(cs.safeEvalArith('2 + 3'), 5);
  assert.equal(cs.safeEvalArith('10 - 4'), 6);
  assert.equal(cs.safeEvalArith('2 + x'), null);      // identifier → rejected
  assert.equal(cs.safeEvalArith('alert(1)'), null);   // no calls
  assert.equal(cs.safeEvalArith(''), null);
});

test('substituteFormula resolves @chr with a value, or shows the letter generically', () => {
  const a = { powerRollChars: ['might'] };
  assert.equal(cs.substituteFormula('2 + @chr', 2, a), '4');
  assert.equal(cs.substituteFormula('5', 3, a), '5');
  // generic (null subVal) → @chr becomes the characteristic initial(s)
  assert.equal(cs.substituteFormula('2 + @chr', null, { powerRollChars: ['reason', 'presence'] }), '2 + R/P');
});

// ── tierFragments (damage-effect tier text) ───────────────────────────────
test('tierFragments builds resolved damage for a hero, generic for the rules card', () => {
  const a = {
    powerRollChars: ['might'],
    tiers: [{ damage: {
      tier1: { value: '2 + @chr', types: ['fire'] },
      tier2: { value: '5 + @chr', types: ['fire'] },
      tier3: { value: '7 + @chr', types: [] },
    } }],
  };
  assert.equal(cs.tierFragments(a, 1, 2), '4 fire damage');   // resolved for +2
  assert.equal(cs.tierFragments(a, 3, 2), '9 damage');        // no types
  assert.equal(cs.tierFragments(a, 1, null), '2 + M fire damage'); // generic
  assert.equal(cs.tierFragments({ tiers: [] }, 1, 2), '');    // no effects → empty
});

// ── groupOf (ability list bucket) ─────────────────────────────────────────
test('groupOf buckets abilities by category then heroic cost', () => {
  assert.equal(cs.groupOf({ category: 'signature' }), 'signature');
  assert.equal(cs.groupOf({ category: 'heroic' }), 'heroic');
  assert.equal(cs.groupOf({ category: 'heroic', cost: 0 }), 'heroic');
  assert.equal(cs.groupOf({ cost: 5 }), 'heroic');         // costed → heroic
  assert.equal(cs.groupOf({ type: 'maneuver' }), 'maneuver');
  assert.equal(cs.groupOf({}), 'maneuver');                // unknown → dimmed bucket
});

// ── classifyFeature (the Features framework) ──────────────────────────────
test('classifyFeature matches a feature to a known origin by dsid/name', () => {
  const origins = [
    { key: 'class', slug: 'conduit', lname: 'conduit' },
    { key: 'ancestry', slug: 'human', lname: 'human' },
    { key: 'kit', slug: 'sword-and-board', lname: 'sword and board' },
  ];
  assert.equal(cs.classifyFeature({ dsid: 'conduit-domain' }, origins), 'class');
  assert.equal(cs.classifyFeature({ name: 'Human Determination' }, origins), 'ancestry');
  assert.equal(cs.classifyFeature({ dsid: 'kit-sword-and-board-bonus' }, origins), 'kit');
  assert.equal(cs.classifyFeature({ dsid: 'perk-quickstudy' }, origins), 'other'); // unplaceable
});

// ── labels / humanizers ───────────────────────────────────────────────────
test('slugify and humanizeId round-trip names and ids', () => {
  assert.equal(cs.slugify('Sword and Board'), 'sword-and-board');
  assert.equal(cs.humanizeId('handleAnimals'), 'Handle Animals');
  assert.equal(cs.humanizeId('criminalUnderworld'), 'Criminal Underworld');
  assert.equal(cs.humanizeId('slowed'), 'Slowed');
});

test('distanceLabel / targetLabel / powerRollLabel humanize the Foundry shapes', () => {
  assert.equal(cs.distanceLabel({ distanceType: 'ranged', distance: 10 }), 'Ranged 10');
  assert.equal(cs.distanceLabel({ distanceType: 'self' }), 'Self');
  assert.equal(cs.powerRollLabel({ powerRollChars: ['reason', 'presence'] }), 'Reason or Presence');
  assert.equal(cs.targetLabel({ targetType: 'enemy', target: 1 }), '1 Enemy');
});

test('costLabel reads the hero heroic-resource name from fields', () => {
  const data = { fields: { heroic_resource_name: 'Piety' } };
  assert.equal(cs.costLabel({ cost: 3 }, data), '3 Piety');
  assert.equal(cs.costLabel({ cost: 0 }, data), '');       // signature → no cost label
});

// ── Foundry enricher cleanup (raw [[...]] in synced text) ─────────────────
test('cleanFoundryText strips tags AND Foundry enrichers to a readable line', () => {
  assert.equal(cs.cleanFoundryText('<p>Regains 5 and you [[/surge 1]].</p>'), 'Regains 5 and you surge 1.');
  assert.equal(cs.cleanFoundryText('Gain [[/gain 1d3 hr]]{1d3 insight} now'), 'Gain 1d3 insight now');
  assert.equal(cs.cleanFoundryText('equal to [[lookup @hero.victories]]{your Victories}.'), 'equal to your Victories.');
  assert.equal(cs.cleanFoundryText('Wield @UUID[Item.abc]{Falchion} well'), 'Wield Falchion well');
  assert.equal(cs.cleanFoundryText(''), '');
});

test('cleanFoundryProse preserves paragraph breaks for the reading view', () => {
  const out = cs.cleanFoundryProse('<p>First line.</p><p>Second [[/surge 1]].</p>');
  assert.equal(out, 'First line.\n\nSecond surge 1.');
});

// ── skill grouping ────────────────────────────────────────────────────────
test('SKILL_TO_GROUP maps skill ids to the five Draw Steel groups', () => {
  assert.equal(cs.SKILL_TO_GROUP.heal, 'exploration');
  assert.equal(cs.SKILL_TO_GROUP.magic, 'lore');
  assert.equal(cs.SKILL_TO_GROUP.intimidate, 'interpersonal');
  assert.equal(cs.SKILL_TO_GROUP.alchemy, 'crafting');
  assert.equal(cs.SKILL_TO_GROUP.hide, 'intrigue');
  assert.equal(cs.SKILL_TO_GROUP.nonsense, undefined);     // unknown → caller's "Other"
});
