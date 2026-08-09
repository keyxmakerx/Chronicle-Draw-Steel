#!/usr/bin/env node
/**
 * Unit tests for the PURE logic in `widgets/monster-party.js` and
 * `widgets/monster-engine.js` — the party-profile derivation and the grounded
 * EV budget math that drive the party-aware monster builder (redo Phases 0+1).
 *
 * Both modules are browser globals off which the widget reads; off-browser they
 * export their pure API via module.exports (no Chronicle / window side effects),
 * so importing them here is inert beyond exposing the functions.
 *
 * Run: `node --test tools/test-monster-party-engine.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Party = require('../widgets/monster-party.js');
const Engine = require('../widgets/monster-engine.js');

// The real shipped org templates — the budget math must ground in THESE values.
const ORGS = JSON.parse(
  readFileSync(new URL('../data/organization-templates.json', import.meta.url), 'utf8')
);

const hero = (f) => ({ fields_data: f });

// ── Engine: hero-ratio parsing ────────────────────────────────────────────
test('heroesPerCreature parses "creatures:heroes"', () => {
  assert.equal(Engine.heroesPerCreature('1:1'), 1);
  assert.equal(Engine.heroesPerCreature('1:6'), 6);       // solo: 1 creature per 6 heroes
  assert.equal(Engine.heroesPerCreature('8:1'), 1 / 8);   // minion: 8 creatures per hero
  assert.equal(Engine.heroesPerCreature('2:1'), 1 / 2);
  assert.equal(Engine.heroesPerCreature('bad'), null);
  assert.equal(Engine.heroesPerCreature(''), null);
});

// ── Engine: standard EV-per-hero-level derived from the org data (== 4) ─────
test('standardEvPerHeroLevel derives 4 from the shipped org templates', () => {
  // ev_multiplier / heroesPerCreature is 4 for every org except Minion (8, the
  // squad outlier); the median across all 7 is 4.
  assert.equal(Engine.standardEvPerHeroLevel(ORGS), 4);
});

test('standardEvPerHeroLevel is unskewed by the Minion outlier (median, not mean)', () => {
  const twoOnly = ORGS.filter((o) => o.slug === 'minion' || o.slug === 'platoon');
  // ratios [8 (minion), 4 (platoon)] → median 6, but the full set stays 4.
  assert.equal(Engine.standardEvPerHeroLevel(twoOnly), 6);
  assert.equal(Engine.standardEvPerHeroLevel(ORGS), 4);
});

// ── Engine: encounter budget = the PUBLISHED party encounter strength ───────
// This replaced `partySize × partyLevel × 4`, which ran 1.67x the published
// strength at level 10 and was labelled a balanced budget in the UI. The
// published formula is 4 + (2 × hero level) per hero (DS-MB-HONESTY).
test('encounterBudget = the published party encounter strength, summed per hero', () => {
  assert.equal(Engine.encounterBudget(4, 5, ORGS), 56);   // 4 × (4 + 2×5)
  assert.equal(Engine.encounterBudget(3, 7, ORGS), 54);   // 3 × (4 + 2×7)
  assert.equal(Engine.encounterBudget(1, 1, ORGS), 6);    // 1 × (4 + 2×1)
  assert.equal(Engine.encounterBudget(4, 10, ORGS), 96);  // the old widget said 160
});

test('encounterBudget degrades to 0 on bad inputs', () => {
  assert.equal(Engine.encounterBudget(0, 5, ORGS), 0);
  assert.equal(Engine.encounterBudget(4, 0, ORGS), 0);
  // The org templates are no longer an input — the published formula depends
  // only on the party — so an empty template list no longer zeroes the budget.
  assert.equal(Engine.encounterBudget(4, 5, []), 56);
});

test('encounterBands returns the published difficulty ladder for the party', () => {
  const b = Engine.encounterBands(4, 10);
  assert.equal(b.partyEs, 96);
  assert.equal(b.perHeroEs, 24);
  assert.deepEqual(b.bands.standard, { lower: 96, upper: 120, upper_inclusive: true });
  assert.equal(Engine.encounterBands(0, 5), null);
});

// ── Engine: a single creature's EV is the PUBLISHED formula ─────────────────
test('creatureEV = ceil(((2 × level) + 4) × organization modifier)', () => {
  const L = 5;
  // ((2×5)+4) = 14, times the published organization modifier.
  const expected = { minion: 7, horde: 7, platoon: 14, elite: 28, leader: 28, solo: 84 };
  for (const org of ORGS) {
    if (org.organization_modifier === null) continue;
    assert.equal(Engine.creatureEV(L, org), expected[org.slug], org.slug);
  }
  // Swarm is original to this package and has no published modifier, so it
  // cannot be priced — 0 means "unpriceable", not "free".
  assert.equal(Engine.creatureEV(L, ORGS.find((o) => o.slug === 'swarm')), 0);
});

// ── Engine: villain-action requirement is data-driven (kills 'leader'/'solo') ─
test('villainActionCount comes from the org template, not a string literal', () => {
  const bySlug = Object.fromEntries(ORGS.map((o) => [o.slug, o]));
  assert.equal(Engine.villainActionCount(bySlug.leader), 3);
  assert.equal(Engine.villainActionCount(bySlug.solo), 3);
  assert.equal(Engine.villainActionCount(bySlug.platoon), 0);
  assert.equal(Engine.villainActionCount(bySlug.minion), 0);
  assert.equal(Engine.villainActionCount(bySlug.swarm), 0);
  assert.equal(Engine.villainActionCount(null), 0);
});

// ── Engine: the live "spent / budget" meter ─────────────────────────────────
// `copies` is arithmetic — how many of this creature spend the party's
// encounter strength — and nothing more. It is NOT a balance verdict: the
// published spending limits (creatures per hero, six stat blocks, minions in
// fours, star-of-the-show) are not checked here or by the caller.
test('evMeter reports spend, budget, and how many copies spend it', () => {
  const m = Engine.evMeter(14, 56);   // one platoon at L5 (EV 14) vs a 56 ES
  assert.equal(m.spent, 14);
  assert.equal(m.budget, 56);
  assert.equal(m.copies, 4);
  const solo = Engine.evMeter(84, 56);
  assert.equal(solo.copies, 1);       // never below 1
});

// ── Party: full party → PartyProfile ───────────────────────────────────────
const FULL = [
  hero({ level: 3, might: 2, agility: 0, reason: 1, intuition: 1, presence: 2, stamina_max: 20, speed: 5, immunities: 'Fire 5', weaknesses: 'Cold 3' }),
  hero({ level: 4, might: 3, agility: 1, reason: 0, intuition: 2, presence: 1, stamina_max: 24, speed: 6 }),
  hero({ level: 5, might: 1, agility: 0, reason: 2, intuition: 1, presence: 0, stamina_max: 30, speed: 5, weaknesses: 'Cold 2, Psychic' }),
  hero({ level: 4, might: 2, agility: 1, reason: 1, intuition: 0, presence: 2, stamina_max: 22, speed: 5, immunities: 'Fire' }),
  hero({ level: 4, might: 2, agility: 0, reason: 1, intuition: 1, presence: 1, stamina_max: 24, speed: 7 }),
];

test('deriveParty summarizes size, level, stamina, and full coverage', () => {
  const p = Party.deriveParty(FULL);
  assert.equal(p.size, 5);
  assert.equal(p.levelAvg, 4);
  assert.deepEqual(p.levelSpread, [3, 5]);
  assert.equal(p.staminaAvg, 24);
  assert.deepEqual(p.speedRange, [5, 7]);
  assert.equal(p.coverage.stamina_max, '5 of 5');
  assert.equal(p.coverage.might, '5 of 5');
});

test('deriveParty picks the lowest party average as the weakest defense', () => {
  const p = Party.deriveParty(FULL);
  // agility avg 0.4 is the lowest of the five characteristics.
  assert.equal(p.weakestDefense, 'agility');
  assert.equal(Math.round(p.weakestDefenseValue * 10) / 10, 0.4);
});

test('deriveParty unions immunities (avoid) and weaknesses (exploit)', () => {
  const p = Party.deriveParty(FULL);
  assert.deepEqual(p.immunities, ['Fire']);            // "Fire 5" + "Fire" → one
  assert.deepEqual(p.weaknesses, ['Cold', 'Psychic']); // magnitudes stripped, deduped
});

// ── Party: partial-stat honesty (redo Q4 — never average nulls as zeros) ────
test('deriveParty skips missing stats PER-STAT and reports honest coverage', () => {
  const partial = [
    hero({ level: 2, might: 1, agility: 1, reason: 1, intuition: 1, presence: 1, stamina_max: 18 }),
    hero({ level: 4, might: 2, agility: 0, reason: 1, intuition: 1, presence: 1 }),           // no stamina_max
    hero({ level: 6, might: 2, reason: 2, intuition: 1, presence: 2, stamina_max: 30 }),       // no agility
  ];
  const p = Party.deriveParty(partial);
  assert.equal(p.staminaAvg, 24);              // mean(18,30) — NOT (18+0+30)/3 = 16
  assert.equal(p.coverage.stamina_max, '2 of 3');
  assert.equal(p.coverage.agility, '2 of 3');
  assert.equal(p.size, 3);
});

// ── Party: empty + single-hero (post-#517 player shape, no gm_notes) ────────
test('deriveParty returns null for an empty/absent party (manual mode)', () => {
  assert.equal(Party.deriveParty([]), null);
  assert.equal(Party.deriveParty(null), null);
});

test('deriveParty parses a hero whose fields_data has no gm_notes (post-#517)', () => {
  const p = Party.deriveParty([
    hero({ level: 5, might: 3, agility: 2, reason: 1, intuition: 1, presence: 2, stamina_max: 40, speed: 5 }),
  ]);
  assert.equal(p.size, 1);
  assert.equal(p.weakestDefense, 'reason');    // reason 1 is the lowest (ties resolve first-seen)
  assert.equal(p.staminaAvg, 40);
});

test('deriveParty coerces string-encoded numeric fields', () => {
  const p = Party.deriveParty([hero({ level: '5', might: '2', agility: '0', stamina_max: '30' })]);
  assert.equal(p.levelAvg, 5);
  assert.equal(p.staminaAvg, 30);
  assert.equal(p.weakestDefense, 'agility');
});

// ── Party: damage-list parser ───────────────────────────────────────────────
test('parseDamageList strips magnitudes and de-dupes case-insensitively', () => {
  assert.deepEqual(Party.parseDamageList('Fire 5, Cold; Psychic/Acid'), ['Fire', 'Cold', 'Psychic', 'Acid']);
  assert.deepEqual(Party.parseDamageList('fire, Fire 2'), ['fire']);
  assert.deepEqual(Party.parseDamageList(''), []);
  assert.deepEqual(Party.parseDamageList(null), []);
});
