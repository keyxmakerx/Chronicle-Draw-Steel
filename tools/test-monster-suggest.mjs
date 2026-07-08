// test-monster-suggest.mjs — off-DOM tests for the Phase 2 suggestion engine
// (DS-MB-REDO-P02). Exercises MonsterEngine.suggest against fixture parties
// built through the real deriveParty pipeline and the shipped reference data.
//
// Run: node --test tools/test-monster-suggest.mjs
//
// Covers (per the dispatch acceptance + rulings): weakestDefense->role
// targeting, the R3.5 fallback chain (incl. an intuition-weak party with NO
// matching role), immunity avoidance, weakness preference, tier auto-fill via
// tierN + per_level*(level-1), budget/org-only degradation, and that every
// filled field carries a rationale (Q2). Potency + intent-scaling are descoped
// (R3.1/R3.2) — the intent selector must NOT change any number.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
const Party = require('../widgets/monster-party.js');

// Real shipped reference data — the suggestion math must ground in THESE values.
const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ORGS = load('organization-templates.json');
const ROLES = load('role-templates.json');
const BASELINES = load('damage-baselines.json')[0].properties.baselines;
const DATA = { orgTemplates: ORGS, roleTemplates: ROLES, baselines: BASELINES };

const hero = (f) => ({ fields_data: f });
const suggestFor = (heroes, intent) => Engine.suggest(Party.deriveParty(heroes), intent || 'standard', DATA);

// Every filled field's rationale must be a non-empty string (Q2 mandatory chip).
function assertRationales(s, keys) {
  keys.forEach((k) => {
    assert.equal(typeof s.rationale[k], 'string', `rationale.${k} should be a string`);
    assert.ok(s.rationale[k].length > 0, `rationale.${k} should be non-empty`);
  });
}

// ── Role targeting: primary_stat === weakest defense (direct match) ──────────
test('role targets the party’s weakest defense (agility → ambusher)', () => {
  // Agility is strictly the lowest average defense.
  const s = suggestFor([
    hero({ level: 5, might: 3, agility: 0, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 3, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 0, reason: 1, intuition: 1, presence: 1 }),
    hero({ level: 5, might: 2, agility: 1, reason: 1, intuition: 1, presence: 1 }),
  ]);
  assert.equal(s.role, 'ambusher');             // first role whose primary_stat === 'agility'
  assert.equal(s.powerRollTarget, 'agility');   // power-roll targets the true weakest
  assert.equal(s.powerRollAttack, 'agility');   // ambusher's primary_stat
  assert.match(s.rationale.role, /weakest defense/i);
  assertRationales(s, ['level', 'organization', 'role', 'target', 'tiers', 'intent']);
});

// ── R3.5 fallback: weakest defense has NO matching role (intuition) ──────────
test('R3.5: intuition-weak party falls back to next-weakest defense for the role, target stays intuition', () => {
  // No monster role has primary_stat 'intuition'; reason is the next-weakest.
  const s = suggestFor([
    hero({ level: 6, might: 3, agility: 3, reason: 1, intuition: 0, presence: 3 }),
    hero({ level: 6, might: 3, agility: 3, reason: 1, intuition: 0, presence: 3 }),
  ]);
  assert.equal(s.powerRollTarget, 'intuition');            // TARGET is the true weakest
  assert.equal(s.role, 'artillery');                       // substituted role targets reason
  assert.equal(s.powerRollAttack, 'reason');               // artillery's primary_stat
  assert.match(s.rationale.role, /substitut/i);            // the chip names the substitution
  assert.ok(s.notes.some((n) => /substitution/i.test(n)), 'a substitution note is recorded');
});

test('no role ever has primary_stat intuition (data guard behind R3.5)', () => {
  assert.ok(!ROLES.some((r) => r.primary_stat === 'intuition'));
});

// ── Damage: prefer weaknesses, never an immunity ─────────────────────────────
test('damage prefers the party weakness and never a resisted type', () => {
  const s = suggestFor([
    hero({ level: 4, might: 2, agility: 2, reason: 2, intuition: 2, presence: 2, weaknesses: 'Cold 5, Fire 3', immunities: 'Fire' }),
    hero({ level: 4, might: 2, agility: 2, reason: 2, intuition: 2, presence: 2, weaknesses: 'Cold' }),
  ]);
  assert.deepEqual(s.damageTypes, ['Cold']);   // Fire is a weakness AND an immunity → excluded
  assert.ok(!s.damageTypes.map((t) => t.toLowerCase()).includes('fire'));
  assert.deepEqual(s.immunities, ['Fire']);     // surfaced for the wiring's warning
  assert.match(s.rationale.damage, /Cold/);
});

test('no shared weakness → damage left untyped (never invents one)', () => {
  const s = suggestFor([
    hero({ level: 3, might: 1, agility: 2, reason: 1, intuition: 1, presence: 1, immunities: 'Poison' }),
  ]);
  assert.deepEqual(s.damageTypes, []);
  assert.match(s.rationale.damage, /untyped/i);
});

// ── Tier auto-fill: tierN + per_level*(level-1), Math.round ──────────────────
test('ability tiers auto-fill from the org baseline at the chosen level (leader @ L5 = 18/22/26)', () => {
  // 4×L5 → budget 80; elite/leader (EV 40) fit, tie broken toward leader (villain actions).
  const s = suggestFor([
    hero({ level: 5, might: 3, agility: 0, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 3, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 0, reason: 1, intuition: 1, presence: 1 }),
    hero({ level: 5, might: 2, agility: 1, reason: 1, intuition: 1, presence: 1 }),
  ]);
  assert.equal(s.organization, 'leader');
  // leader baseline: t1 6, t2 10, t3 14, per_level 3 → +3*(5-1)=+12.
  assert.deepEqual(s.tiers, { tier1: 18, tier2: 22, tier3: 26 });
  assert.match(s.rationale.tiers, /base \+ per-level/i);
});

test('a right-sized party lands on Solo (6×L5 → Solo, exactly fills the budget)', () => {
  const six = [];
  for (let i = 0; i < 6; i++) six.push(hero({ level: 5, might: 3, agility: 1, reason: 2, intuition: 2, presence: 2 }));
  const s = suggestFor(six);
  assert.equal(s.organization, 'solo');     // solo EV 120 == budget 120
  assert.equal(s.budget, 120);
  assert.equal(s.copies, 1);
  // solo baseline: t1 8, t2 14, t3 20, per_level 4 → +4*(5-1)=+16.
  assert.deepEqual(s.tiers, { tier1: 24, tier2: 30, tier3: 36 });
});

// ── Level band = round(levelAvg), UNSCALED by intent (R3.2) ──────────────────
test('level band is round(levelAvg) and intent never changes any number (R3.2)', () => {
  const party = [
    hero({ level: 4, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }), // avg 4.5 → round 5... force 4
    hero({ level: 3, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }), // avg (4+5+3)/3 = 4
  ];
  const trivial = Engine.suggest(Party.deriveParty(party), 'trivial', DATA);
  const boss = Engine.suggest(Party.deriveParty(party), 'boss', DATA);
  assert.equal(trivial.level, 4);                       // round(4.0)
  assert.equal(trivial.level, boss.level);              // intent does NOT scale the level
  assert.equal(trivial.organization, boss.organization);
  assert.deepEqual(trivial.tiers, boss.tiers);
  assert.equal(trivial.budget, boss.budget);
  assert.match(boss.rationale.intent, /pending sourced rules/i);  // display-only, stated
  assert.equal(boss.intent, 'boss');                    // but the choice IS recorded
});

test('an unknown/blank intent is recorded as standard', () => {
  const party = [hero({ level: 2, might: 1, agility: 1, reason: 1, intuition: 1, presence: 1 })];
  assert.equal(Engine.suggest(Party.deriveParty(party), 'nonsense', DATA).intent, 'standard');
  assert.equal(Engine.suggest(Party.deriveParty(party), undefined, DATA).intent, 'standard');
});

// ── Degradation: no readable defenses → budget/org-only, never guess ─────────
test('no hero characteristics → degrade to budget/org-only with a visible note (stop-and-flag path)', () => {
  // Heroes carry only level + stamina — every defense is missing for the whole party.
  const s = suggestFor([hero({ level: 3, stamina_max: 20 }), hero({ level: 5, stamina_max: 24 })]);
  assert.equal(s.role, null);                 // no role guessed
  assert.equal(s.powerRollTarget, null);      // no target guessed
  assert.equal(s.level, 4);                   // but level/org/tiers still suggested
  assert.ok(s.organization);
  assert.ok(s.tiers);
  assert.ok(s.notes.some((n) => /defenses unknown/i.test(n)), 'a visible degradation note is present');
});

test('null party profile degrades cleanly (manual build)', () => {
  const s = Engine.suggest(null, 'hard', DATA);
  assert.equal(s.organization, null);
  assert.equal(s.role, null);
  assert.equal(s.intent, 'hard');
  assert.ok(s.notes.length > 0);
});

// ── Budget grounding sanity: matches encounterBudget(size, level) ────────────
test('the suggestion budget equals the grounded encounterBudget', () => {
  const party = [
    hero({ level: 5, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 1, reason: 2, intuition: 2, presence: 2 }),
  ];
  const s = suggestFor(party);
  assert.equal(s.budget, Engine.encounterBudget(4, 5, ORGS)); // 4 × 5 × 4 = 80
  assert.equal(s.budget, 80);
});
