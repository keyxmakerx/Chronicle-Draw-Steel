// test-monster-formulas.mjs — pins widgets/monster-formulas.js against the
// PUBLISHED formulas that ship in data/monster-building.json and
// data/encounter-building.json.
//
// The point of this file is that the module is not allowed to drift from the
// data. Every constant it hard-codes (tier modifiers, the leader/solo/elite rows
// of the role-and-damage table, the difficulty bands) is re-read from the
// shipped JSON here and compared, so a change to either side fails CI.
//
// Run: node --test tools/test-monster-formulas.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const F = require('../widgets/monster-formulas.js');

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ORGS = load('organization-templates.json');
const ROLES = load('role-templates.json');
const MONSTER_BUILD = load('monster-building.json');
const ENCOUNTER_BUILD = load('encounter-building.json');

const org = (s) => ORGS.find((o) => o.slug === s);
const role = (s) => ROLES.find((r) => r.slug === s);
const entry = (list, s) => list.find((e) => e.slug === s);

// ── The module must agree with the published tables, not a memory of them ────

test('tier modifiers match the published damage formula entry', () => {
  const dmg = entry(MONSTER_BUILD, 'damage-and-power-roll-tiers');
  assert.deepEqual(F.TIER_MODIFIER, dmg.properties.tier_modifiers);
});

test('leader/solo/elite role+damage rows match the published table', () => {
  const rows = entry(MONSTER_BUILD, 'role-and-damage-modifier-table').properties.rows;
  const row = (s) => rows.find((r) => r.slug === s);
  // Leader and solo appear in the role table "in place of" a role.
  assert.equal(F.roleModifier('leader', null).value, row('leader').role_modifier);
  assert.equal(F.roleModifier('solo', null).value, row('solo').role_modifier);
  assert.equal(F.damageModifier('leader', null).value, row('leader').damage_modifier);
  assert.equal(F.damageModifier('solo', null).value, row('solo').damage_modifier);
  // Elite is an organization; its damage modifier STACKS with the role's.
  assert.equal(F.damageModifier('elite', role('brute')).value,
    row('elite').damage_modifier + role('brute').damage_modifier);
  assert.equal(F.damageModifier('elite', role('defender')).value,
    row('elite').damage_modifier + role('defender').damage_modifier);
  // Elite does not replace the role's role modifier.
  assert.equal(F.roleModifier('elite', role('brute')).value, role('brute').role_modifier);
});

test('every published role template carries the modifiers the formulas need', () => {
  const rows = entry(MONSTER_BUILD, 'role-and-damage-modifier-table').properties.rows;
  for (const r of ROLES) {
    const published = rows.find((x) => x.slug === r.slug);
    assert.ok(published, `${r.slug} must appear in the published role table`);
    assert.equal(r.role_modifier, published.role_modifier, `${r.slug} role modifier`);
    assert.equal(r.damage_modifier, published.damage_modifier, `${r.slug} damage modifier`);
  }
});

// ── Encounter value ─────────────────────────────────────────────────────────

test('encounter value evaluates ((2 x level) + 4) x organization modifier, rounded up', () => {
  for (const lvl of [1, 3, 5, 8, 10, 20]) {
    for (const o of ORGS) {
      const got = F.encounterValue(lvl, o);
      if (o.organization_modifier === null) {
        assert.equal(got.value, null, `${o.slug} has no published modifier`);
        assert.equal(got.sourced, false);
        continue;
      }
      assert.equal(got.value, Math.ceil(((2 * lvl) + 4) * o.organization_modifier),
        `${o.slug} @ L${lvl}`);
      assert.equal(got.sourced, true);
    }
  }
});

test('the minion EV result says it stands for four minions', () => {
  const got = F.encounterValue(5, org('minion'));
  assert.ok(got.notes.some((n) => /four minions/i.test(n)));
});

test('swarm is never certified as sourced — it is this package’s own organization', () => {
  assert.equal(org('swarm').source, 'custom');
  assert.equal(F.encounterValue(5, org('swarm')).sourced, false);
  assert.equal(F.stamina(5, org('swarm'), role('brute')).sourced, false);
  assert.equal(F.encounterValue(5, org('swarm')).value, null);
  assert.equal(F.stamina(5, org('swarm'), role('brute')).value, null);
});

// ── Stamina ─────────────────────────────────────────────────────────────────

test('stamina evaluates ((10 x level) + role modifier) x Stamina organization modifier', () => {
  for (const lvl of [1, 4, 8, 10]) {
    for (const o of ORGS) {
      if (o.stamina_organization_modifier === null) continue;
      for (const r of ROLES) {
        const expectedRoleMod = (o.slug === 'leader' || o.slug === 'solo') ? 30 : r.role_modifier;
        assert.equal(F.stamina(lvl, o, r).value,
          Math.ceil(((10 * lvl) + expectedRoleMod) * o.stamina_organization_modifier),
          `${o.slug}/${r.slug} @ L${lvl}`);
      }
    }
  }
});

test('the worked case from the audit: a level 8 solo brute has 550 Stamina, not 240', () => {
  assert.equal(F.stamina(8, org('solo'), role('brute')).value, 550);
  // The number the widget's own table produced, for the record.
  assert.equal(org('solo').stamina_base + org('solo').stamina_per_level * 8, 240);
});

test('stamina refuses to guess when no role is chosen and the org does not replace one', () => {
  const got = F.stamina(5, org('platoon'), null);
  assert.equal(got.value, null);
  assert.equal(got.sourced, false);
  assert.ok(got.notes.some((n) => /role/i.test(n)));
  // Leader and solo supply their own, so they CAN be computed with no role.
  assert.equal(F.stamina(5, org('leader'), null).value, Math.ceil(((10 * 5) + 30) * 2));
  assert.equal(F.stamina(5, org('solo'), null).value, Math.ceil(((10 * 5) + 30) * 5));
});

test('the optional Stamina bonus is (3 x level) + 3 and excludes minions', () => {
  assert.equal(F.staminaOptionalBonus(5, org('platoon')).value, 18);
  assert.equal(F.staminaOptionalBonus(5, org('minion')).value, null);
  const published = entry(MONSTER_BUILD, 'stamina-formula').properties.optional_bonus;
  assert.equal(published.formula, '(3 * level) + 3');
});

// ── Damage tiers ────────────────────────────────────────────────────────────

test('damage tiers evaluate (4 + level + damage modifier) x tier modifier, rounded up', () => {
  const t = F.damageTiers(5, org('platoon'), role('brute'));
  const base = 4 + 5 + 1;
  assert.deepEqual(t.value, {
    tier1: Math.ceil(base * 0.6),
    tier2: Math.ceil(base * 1.1),
    tier3: Math.ceil(base * 1.4)
  });
  assert.equal(t.sourced, true);
});

test('horde and minion damage is halved, per the published adjustment', () => {
  const full = F.damageTiers(5, org('platoon'), role('brute')).value;
  const horde = F.damageTiers(5, org('horde'), role('brute')).value;
  assert.equal(horde.tier3, Math.ceil(full.tier3 / 2));
  assert.ok(F.damageTiers(5, org('minion'), role('brute')).notes.some((n) => /halved/i.test(n)));
});

test('the worked case from the audit: a level 8 solo tier-3 baseline is 20, not 48', () => {
  assert.equal(F.damageTiers(8, org('solo'), role('brute')).value.tier3, 20);
  const bl = load('damage-baselines.json')[0].properties.baselines.solo;
  assert.equal(Math.round(bl.tier3 + bl.per_level * (8 - 1)), 48);
});

test('the damage result always names the adjustments it has NOT applied', () => {
  const notes = F.damageTiers(5, org('platoon'), role('brute')).notes.join(' ');
  assert.match(notes, /strike/i, 'the strike characteristic add-on must be disclosed');
  assert.match(notes, /target count/i, 'the target-count multipliers must be disclosed');
});

// ── Characteristics ─────────────────────────────────────────────────────────

test('highest characteristic is 1 + echelon, +1 for leader/solo, capped at 5', () => {
  assert.equal(F.echelon(1), 1);
  assert.equal(F.echelon(5), 2);
  assert.equal(F.highestCharacteristic(5, org('platoon')).value, 3);   // published worked example
  assert.equal(F.highestCharacteristic(5, org('solo')).value, 4);
  assert.equal(F.highestCharacteristic(20, org('solo')).value, 5);     // cap
  const published = entry(MONSTER_BUILD, 'monster-characteristics-and-potency').properties;
  assert.equal(published.highest_characteristic, '1 + echelon');
  assert.equal(published.highest_characteristic_max, 5);
});

// ── Encounter strength and the difficulty bands ─────────────────────────────

test('per-hero encounter strength matches the published formula AND its table', () => {
  const es = entry(ENCOUNTER_BUILD, 'encounter-strength').properties;
  assert.equal(es.per_hero_formula, '4 + (2 * hero_level)');
  for (const row of es.table) {
    assert.equal(F.heroEncounterStrength(row.hero_level).value, row.per_hero,
      `per-hero ES at level ${row.hero_level}`);
    for (const [size, total] of Object.entries(row.party)) {
      assert.equal(F.partyEncounterStrength(Number(size), row.hero_level).value, total,
        `party of ${size} at level ${row.hero_level}`);
    }
  }
});

test('a mixed-level party sums each hero’s encounter strength', () => {
  assert.equal(F.partyEncounterStrength([1, 2, 3]).value, 6 + 8 + 10);
});

test('difficulty bands match the published band expressions', () => {
  const bands = F.budgetBands(96, 24).value;   // 4 heroes at level 10
  assert.deepEqual(bands.standard, { lower: 96, upper: 120, upper_inclusive: true });
  assert.deepEqual(bands.hard, { lower: 120, upper: 96 + 72, upper_inclusive: true });
  assert.equal(bands.easy.lower, 72);
  assert.equal(bands.extreme.upper, null);
  // Cross-check every band against the expressions in the shipped data.
  for (const e of ENCOUNTER_BUILD.filter((x) => x.properties.rule_type === 'difficulty')) {
    const b = bands[e.properties.difficulty];
    assert.ok(b, `${e.properties.difficulty} must be a band the module returns`);
    assert.equal(!!b.upper_inclusive, !!e.properties.budget_band.upper_inclusive,
      `${e.properties.difficulty} inclusivity`);
  }
});

test('difficultyOf names the band a spend lands in', () => {
  // 4 heroes at level 10: ES 96, one hero 24.
  assert.equal(F.difficultyOf(60, 96, 24).value, 'trivial');
  assert.equal(F.difficultyOf(80, 96, 24).value, 'easy');
  assert.equal(F.difficultyOf(96, 96, 24).value, 'standard');
  assert.equal(F.difficultyOf(120, 96, 24).value, 'standard');
  assert.equal(F.difficultyOf(121, 96, 24).value, 'hard');
  assert.equal(F.difficultyOf(168, 96, 24).value, 'hard');
  assert.equal(F.difficultyOf(169, 96, 24).value, 'extreme');
});

test('the old widget budget of size x level x 4 is 1.67x the published strength at level 10', () => {
  const published = F.partyEncounterStrength(4, 10).value;
  assert.equal(published, 96);
  assert.equal(4 * 10 * 4, 160);
  assert.ok(Math.abs((160 / published) - 1.667) < 0.01);
});

// ── Provenance discipline ───────────────────────────────────────────────────

test('every sourced result carries a citation and every unsourced one carries none', () => {
  const sourced = [
    F.encounterValue(5, org('platoon')),
    F.stamina(5, org('platoon'), role('brute')),
    F.heroEncounterStrength(5),
    F.partyEncounterStrength(4, 5),
    F.budgetBands(56, 14)
  ];
  for (const r of sourced) {
    assert.equal(r.sourced, true);
    assert.equal(typeof r.source, 'string');
    assert.ok(r.source.length > 0);
  }
  const unsourced = [
    F.encounterValue(5, org('swarm')),
    F.stamina(5, org('platoon'), null),
    F.heroEncounterStrength(0)
  ];
  for (const r of unsourced) {
    assert.equal(r.sourced, false);
    assert.equal(r.source, null);
    assert.equal(r.value, null, 'an unsourced result must not carry a plausible number');
    assert.ok(r.notes.length > 0, 'an unsourced result must say why');
  }
});
