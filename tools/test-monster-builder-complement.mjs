// test-monster-builder-complement.mjs — wiring tests for the Phase 2
// "Build to complement the party" controls in widgets/monster-builder.js
// (DS-MB-REDO-P02). Off-DOM, minimal-instance style (same as
// test-monster-builder.mjs): call the widget methods on an Object.create(def)
// instance with just enough state, no full init().
//
// Run: node --test tools/test-monster-builder-complement.mjs
//
// Covers: the button is reachable BEFORE an org is selected (R3.6), manual
// mode hides it gracefully, applying a suggestion writes level/org/role + a
// signature ability carrying the baseline tiers (Q2 auto-fill, nothing locked),
// the rationale-chip panel renders per-field, and the immune-damage warning is
// non-blocking (Q3).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, makeEl } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
// The builder references MonsterEngine / MonsterParty as browser globals.
globalThis.MonsterEngine = require('../widgets/monster-engine.js');
globalThis.MonsterParty = require('../widgets/monster-party.js');
require('../widgets/monster-builder.js');
const def = globalThis.Chronicle.registry['monster-builder'];

const { readFileSync } = await import('node:fs');
const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ORGS = load('organization-templates.json');
const ROLES = load('role-templates.json');
const BASELINES = load('damage-baselines.json')[0].properties.baselines;

const hero = (f) => ({ fields_data: f });
const AGILITY_WEAK = MonsterParty.deriveParty([
  hero({ level: 5, might: 3, agility: 0, reason: 2, intuition: 2, presence: 2, weaknesses: 'Cold', immunities: 'Fire' }),
  hero({ level: 5, might: 3, agility: 1, reason: 2, intuition: 2, presence: 2 }),
  hero({ level: 5, might: 2, agility: 0, reason: 1, intuition: 1, presence: 1 }),
  hero({ level: 5, might: 2, agility: 1, reason: 1, intuition: 1, presence: 1 }),
]);

// A minimal builder instance carrying the Phase-2 state + reference data, with
// the render/save cascade stubbed so tests isolate the suggestion wiring.
function inst(overrides) {
  return Object.assign(Object.create(def), {
    _partyProfile: AGILITY_WEAK,
    _intent: 'standard',
    _suggestion: null,
    _suggestionDamage: '',
    orgTemplates: ORGS,
    roleTemplates: ROLES,
    damageBaselines: BASELINES,
    creature: { level: 1, organization: '', role: '', abilities: [] },
    _recalcAuto() {},
    _setSaveStatus() {},
    _renderCurrentStep() {},
  }, overrides || {});
}

// ── R3.6: the button is reachable BEFORE an org is picked ────────────────────
test('the complement button renders with NO organization selected (R3.6)', () => {
  const html = def._complementSectionHtml.call(inst());
  assert.match(html, /id="mb-complement-btn"/);       // the button exists…
  assert.match(html, /id="mb-complement-intent"/);    // …with the intent selector…
  // …and it is NOT gated on an org: the instance's creature.organization is ''.
});

test('manual mode (no party) hides the button and shows a note', () => {
  const html = def._complementSectionHtml.call(inst({ _partyProfile: null }));
  assert.ok(!/mb-complement-btn/.test(html), 'no build button without a party');
  assert.match(html, /build manually/i);
});

// ── Applying the suggestion fills the model (Q2 auto-fill, nothing locked) ────
test('applying the suggestion writes level/org/role + a signature ability with baseline tiers', () => {
  const it = inst();
  def._applyPartySuggestion.call(it);

  assert.equal(it.creature.level, 5);
  assert.equal(it.creature.organization, 'leader');   // biggest org that fits the budget (VA tie-break)
  assert.equal(it.creature.role, 'ambusher');         // primary_stat agility === weakest defense
  assert.ok(it._suggestion, 'the suggestion is stored for the rationale panel');

  const sig = it.creature.abilities.filter((a) => a._suggested);
  assert.equal(sig.length, 1, 'exactly one suggested signature ability');
  assert.equal(sig[0].type, 'signature');
  assert.match(sig[0].power_roll, /Agility vs\. Agility/);   // attack-stat vs. target-defense
  assert.match(sig[0].tier1, /^18\b/);                        // leader @ L5 baseline (6 + 3*4)
  assert.match(sig[0].tier2, /^22\b/);
  assert.match(sig[0].tier3, /^26\b/);
  assert.match(sig[0].tier1, /cold damage/);                 // suggested (non-immune) damage type
});

test('re-running the suggestion replaces the signature ability, never stacks', () => {
  const it = inst();
  def._applyPartySuggestion.call(it);
  def._applyPartySuggestion.call(it);
  assert.equal(it.creature.abilities.filter((a) => a._suggested).length, 1);
});

test('a pre-existing hand-authored ability is preserved when a suggestion is applied', () => {
  const it = inst({ creature: { level: 1, organization: '', role: '', abilities: [{ name: 'Bite', type: 'action' }] } });
  def._applyPartySuggestion.call(it);
  assert.ok(it.creature.abilities.some((a) => a.name === 'Bite'), 'the hand-authored ability survives');
  assert.equal(it.creature.abilities.filter((a) => a._suggested).length, 1);
});

// ── Q2: per-field rationale chips are visible ────────────────────────────────
test('the rationale panel renders a chip for every filled field', () => {
  const it = inst();
  def._applyPartySuggestion.call(it);
  const html = def._suggestionPanelHtml.call(it);
  assert.match(html, /Level/);
  assert.match(html, /Organization/);
  assert.match(html, /Role/);
  assert.match(html, /Power-roll target/);
  assert.match(html, /Ability tiers/);
  assert.match(html, /Intent/);
  assert.match(html, /immune to: Fire/i);              // party immunity surfaced as a caution
  assert.match(html, /id="mb-complement-damage"/);      // editable damage field for the Q3 warning
});

// ── Q3: immune-damage warning is non-blocking ────────────────────────────────
test('typing a party-immune damage type shows a non-blocking warning; a safe type clears it', () => {
  const warn = makeEl();
  const it = inst({ _contentEl: { querySelector: () => warn } });

  def._checkImmuneDamage.call(it, 'Fire');             // Fire is in the party's immunity union
  assert.equal(warn.style.display, 'block');
  assert.match(warn.textContent, /immune/i);
  assert.match(warn.textContent, /still save/i);        // never blocks the save

  def._checkImmuneDamage.call(it, 'Cold');             // a safe type
  assert.equal(warn.style.display, 'none');
  assert.equal(warn.textContent, '');
});

test('editing the damage type rewrites the suggested ability tiers, keeping them coherent', () => {
  const it = inst();
  def._applyPartySuggestion.call(it);
  def._applyDamageTypeToSuggestedAbility.call(it, 'Psychic');
  const sig = it.creature.abilities.find((a) => a._suggested);
  assert.match(sig.tier1, /psychic damage/);
  assert.match(sig.tier1, /^18\b/);                    // the number is unchanged, only the type
});
