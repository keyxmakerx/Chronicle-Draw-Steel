// test-monster-builder-honesty.mjs — the monster builder must not present
// unsourced arithmetic as validated Draw Steel math (DS-MB-HONESTY).
//
// Background: the builder shipped four numbers of its own invention — a
// per-organization Stamina table, `ev_multiplier * level` for encounter value,
// `partySize * partyLevel * 4` for the encounter budget, and the level-1 damage
// table in data/damage-baselines.json (whose own `source` is the literal string
// "custom"). They disagree with the published formulas now shipped in
// data/monster-building.json and data/encounter-building.json by as much as
// 2.3x (Stamina) and 2.4x (damage tiers), and the widget wrapped them in a
// "Validation" panel and told the director the result was "balanced".
//
// This file pins the fix: where the published formula can be evaluated the
// widget uses it, and where it cannot the widget says so instead of certifying.
// The full builder rewrite is separate work (DS-MONSTER-BUILDER-REWORK-R1).
//
// Run: node --test tools/test-monster-builder-honesty.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const F = require('../widgets/monster-engine.js').Formulas;
globalThis.DrawSteelFormulas = F;
globalThis.MonsterEngine = require('../widgets/monster-engine.js');
globalThis.MonsterParty = require('../widgets/monster-party.js');
require('../widgets/monster-builder.js');
const def = globalThis.Chronicle.registry['monster-builder'];
const Engine = globalThis.MonsterEngine;

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ORGS = load('organization-templates.json');
const ROLES = load('role-templates.json');
const BASELINES = load('damage-baselines.json')[0].properties.baselines;
const org = (s) => ORGS.find((o) => o.slug === s);
const role = (s) => ROLES.find((r) => r.slug === s);

const BUILDER_SRC = readFileSync(new URL('../widgets/monster-builder.js', import.meta.url), 'utf8');

function builder(creature, overrides) {
  return Object.assign(Object.create(def), {
    orgTemplates: ORGS,
    roleTemplates: ROLES,
    damageBaselines: BASELINES,
    _provenance: {},
    _encounterState: { partySize: 4, partyLevel: 10 },
    _partyProfile: null,
    creature: Object.assign({
      name: 'Test', level: 1, organization: '', role: '', abilities: [],
      villain_actions: [], traits: [], keywords: [], immunities: [],
      ev: 0, stamina: 0, winded: 0, speed: 0, stability: 0,
      might: 0, agility: 0, reason: 0, intuition: 0, presence: 0,
      free_strike: '1 damage', free_strike_damage: 1
    }, creature || {})
  }, overrides || {});
}

// ── The engine's own numbers ────────────────────────────────────────────────

test('the encounter budget is the published party encounter strength, not size x level x 4', () => {
  // 4 heroes at level 10: published ES = 4 x (4 + 2x10) = 96. The old widget
  // number was 160 — 1.67x too generous.
  assert.equal(Engine.encounterBudget(4, 10, ORGS), 96);
  assert.equal(Engine.encounterBudget(4, 10, ORGS), F.partyEncounterStrength(4, 10).value);
  assert.notEqual(Engine.encounterBudget(4, 10, ORGS), 4 * 10 * 4);
  assert.equal(Engine.encounterBudget(4, 5, ORGS), 56);
});

test('creature EV is the published ((2 x level) + 4) x organization modifier', () => {
  assert.equal(Engine.creatureEV(10, org('solo')), 144);      // was 240
  assert.equal(Engine.creatureEV(10, org('platoon')), 24);    // was 40
  assert.equal(Engine.creatureEV(1, org('leader')), 12);      // was 8
  for (const o of ORGS) {
    if (o.organization_modifier === null) continue;
    assert.equal(Engine.creatureEV(7, o), F.encounterValue(7, o).value, o.slug);
  }
});

test('an organization with no published modifier is never auto-suggested', () => {
  // Swarm is original to this package; the engine must not pick it as if the
  // published EV formula covered it.
  assert.equal(Engine.creatureEV(5, org('swarm')), 0);
});

test('suggested ability tiers are the published baseline, and the strike add-on is separate', () => {
  const hero = (f) => ({ fields_data: f });
  const party = MonsterParty.deriveParty([
    hero({ level: 5, might: 3, agility: 0, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 3, agility: 1, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 2, agility: 0, reason: 1, intuition: 1, presence: 1 }),
    hero({ level: 5, might: 2, agility: 1, reason: 1, intuition: 1, presence: 1 }),
  ]);
  const s = Engine.suggest(party, 'standard', { orgTemplates: ORGS, roleTemplates: ROLES, baselines: BASELINES });
  const expected = F.damageTiers(s.level, org(s.organization), role(s.role)).value;
  assert.deepEqual(s.tiers, expected, 'tiers must be the published baseline');
  // The suggested ability is authored as a melee strike, so the published
  // "add the highest characteristic" adjustment applies and is exposed apart
  // from the baseline rather than folded in silently.
  const hc = F.highestCharacteristic(s.level, org(s.organization)).value;
  assert.deepEqual(s.strikeTiers, {
    tier1: expected.tier1 + hc, tier2: expected.tier2 + hc, tier3: expected.tier3 + hc
  });
  assert.match(s.rationale.tiers, /published/i);
});

test('the suggestion names the published difficulty band, and never calls a number balanced', () => {
  const hero = (f) => ({ fields_data: f });
  const party = MonsterParty.deriveParty([
    hero({ level: 5, might: 3, agility: 0, reason: 2, intuition: 2, presence: 2 }),
    hero({ level: 5, might: 3, agility: 1, reason: 2, intuition: 2, presence: 2 }),
  ]);
  const s = Engine.suggest(party, 'standard', { orgTemplates: ORGS, roleTemplates: ROLES, baselines: BASELINES });
  const all = JSON.stringify(s.rationale) + JSON.stringify(s.notes);
  assert.ok(!/balanced/i.test(all), 'no rationale may claim the result is balanced');
  assert.match(s.rationale.organization, /encounter strength|standard|difficulty/i);
});

// ── The builder's auto-filled statistics ────────────────────────────────────

test('auto-fill uses the published Stamina and EV formulas', () => {
  const it = builder({ level: 10, organization: 'platoon', role: 'brute' });
  def._recalcAuto.call(it);
  assert.equal(it.creature.stamina, 130);   // ((10x10) + 30) x 1 ; the old table gave 80
  assert.equal(it.creature.ev, 24);         // ((2x10) + 4) x 1   ; the old formula gave 40
  assert.equal(it._provenance.stamina.sourced, true);
  assert.equal(it._provenance.ev.sourced, true);
});

test('the audit’s worked case: a level 8 solo brute gets 550 Stamina, not 240', () => {
  const it = builder({ level: 8, organization: 'solo', role: 'brute' });
  def._recalcAuto.call(it);
  assert.equal(it.creature.stamina, 550);
  assert.equal(it.creature.winded, 275);
});

test('swarm keeps the widget’s own numbers but is recorded as UNSOURCED', () => {
  const it = builder({ level: 5, organization: 'swarm', role: 'brute' });
  def._recalcAuto.call(it);
  // Swarm is this package's invention; the published formulas do not cover it,
  // so the legacy figures stand — but flagged, never certified.
  assert.equal(it._provenance.ev.sourced, false);
  assert.equal(it._provenance.stamina.sourced, false);
  assert.ok(it._provenance.ev.note && /published/i.test(it._provenance.ev.note));
});

test('with no role chosen the Stamina figure is flagged unsourced (published roles span 10–30)', () => {
  const it = builder({ level: 5, organization: 'platoon', role: '' });
  def._recalcAuto.call(it);
  assert.equal(it._provenance.stamina.sourced, false);
  assert.equal(it._provenance.ev.sourced, true, 'EV does not depend on the role');
});

test('the suggested-stats hint reports whether the figure is published', () => {
  const sourced = def._getSuggestedStats.call(builder({ level: 10, organization: 'platoon', role: 'brute' }));
  assert.equal(sourced.stamina, 130);
  assert.equal(sourced.staminaSourced, true);
  const unsourced = def._getSuggestedStats.call(builder({ level: 10, organization: 'swarm', role: 'brute' }));
  assert.equal(unsourced.staminaSourced, false);
});

// ── Damage hints ────────────────────────────────────────────────────────────

test('damage hints use the published damage formula and disclose the adjustments', () => {
  const it = builder({ level: 8, organization: 'solo', role: 'brute' });
  const html = def._getDamageHints.call(it);
  assert.match(html, /\b20\b/, 'the published tier-3 baseline is 20');
  assert.ok(!/\b48\b/.test(html), 'the old unsourced 48 must be gone');
  assert.match(html, /strike/i, 'the strike add-on must be disclosed');
  assert.match(html, /target/i, 'the target-count adjustment must be disclosed');
});

test('damage hints for an unpublished organization say so', () => {
  const it = builder({ level: 8, organization: 'swarm', role: 'brute' });
  const html = def._getDamageHints.call(it);
  assert.match(html, /not published|unsourced|widget/i);
});

// ── The checks panel must not certify ───────────────────────────────────────

test('the checks panel never claims a creature is balanced or validated as Draw Steel math', () => {
  const it = builder({
    level: 10, organization: 'platoon', role: 'brute',
    abilities: [{ type: 'signature', name: 'Slam' }]
  });
  def._recalcAuto.call(it);
  const messages = def._validate.call(it).map((r) => r.message).join(' | ');
  assert.ok(!/balanced/i.test(messages), 'no check may assert balance');
  assert.ok(!/\bvalid Draw Steel\b/i.test(messages));
});

test('the checks panel surfaces a provenance notice for every unsourced figure', () => {
  const it = builder({
    level: 5, organization: 'swarm', role: 'brute',
    abilities: [{ type: 'signature', name: 'Swarm Bite' }]
  });
  def._recalcAuto.call(it);
  const rules = def._validate.call(it);
  const provenance = rules.filter((r) => r.severity === 'provenance');
  assert.ok(provenance.length > 0, 'an unsourced figure must produce a provenance row');
  assert.match(provenance.map((r) => r.message).join(' '), /swarm/i);
});

test('the deviation warning cites the published formula when the figure is published', () => {
  const it = builder({
    level: 10, organization: 'platoon', role: 'brute', stamina: 10, ev: 999,
    abilities: [{ type: 'signature', name: 'Slam' }]
  });
  const messages = def._validate.call(it).map((r) => r.message).join(' | ');
  assert.match(messages, /published/i, 'the baseline must be attributed');
  assert.match(messages, /130/, 'the published Stamina is quoted');
  assert.match(messages, /\b24\b/, 'the published EV is quoted');
});

test('no deviation warning is raised against a figure the published rules do not cover', () => {
  const it = builder({
    level: 5, organization: 'swarm', role: 'brute', stamina: 1, ev: 1,
    abilities: [{ type: 'signature', name: 'Swarm Bite' }]
  });
  const warnings = def._validate.call(it).filter((r) => r.severity === 'warning').map((r) => r.message).join(' | ');
  assert.ok(!/deviates/i.test(warnings), 'the widget cannot certify a deviation it cannot source');
  assert.ok(!/does not match formula/i.test(warnings));
});

test('the panel carries a standing disclaimer that these are completeness checks', () => {
  const it = builder({ level: 10, organization: 'platoon', role: 'brute', abilities: [{ type: 'signature', name: 'Slam' }] });
  def._recalcAuto.call(it);
  const rules = def._validate.call(it);
  const notice = rules.filter((r) => r.severity === 'provenance').map((r) => r.message).join(' ');
  assert.match(notice, /not a balance check/i);
});

test('if the published-formula module fails to load, the panel says so instead of checking silently', () => {
  const it = builder({
    level: 10, organization: 'platoon', role: 'brute',
    abilities: [{ type: 'signature', name: 'Slam' }]
  }, { _formulas() { return null; } });
  const rules = def._validate.call(it);
  const provenance = rules.filter((r) => r.severity === 'provenance').map((r) => r.message).join(' ');
  assert.match(provenance, /did not load/i);
  // And no deviation warning is invented in its absence.
  assert.ok(!rules.some((r) => r.severity === 'warning' && /published/i.test(r.message)));
});

test('Step 3 labels the Stamina hint as published or as the widget’s own', () => {
  const sourced = builder({ level: 10, organization: 'platoon', role: 'brute' });
  sourced._contentEl = makeEl();
  sourced._renderImmunities = function () {};
  def._renderStep3Stats.call(sourced);
  assert.match(sourced._contentEl.innerHTML, /published formula: 130/);

  const unsourced = builder({ level: 10, organization: 'swarm', role: 'brute' });
  unsourced._contentEl = makeEl();
  unsourced._renderImmunities = function () {};
  def._renderStep3Stats.call(unsourced);
  assert.match(unsourced._contentEl.innerHTML, /unsourced estimate/i);
  assert.match(unsourced._contentEl.innerHTML, /not published Draw Steel math/i);
});

// ── The encounter meter ─────────────────────────────────────────────────────

test('the encounter meter reports the published difficulty band instead of asserting balance', () => {
  const it = builder({ level: 10, organization: 'platoon', role: 'brute' });
  def._recalcAuto.call(it);
  const html = def._encounterMeterHtml.call(it, it._encounterState);
  assert.ok(!/balanced/i.test(html), 'the meter must not call any spend balanced');
  assert.match(html, /96/, 'the published party encounter strength');
  assert.match(html, /standard/i, 'the published difficulty band is named');
  assert.match(html, /encounter strength/i);
});

test('the meter discloses what it does not check', () => {
  const it = builder({ level: 10, organization: 'platoon', role: 'brute' });
  def._recalcAuto.call(it);
  const html = def._encounterMeterHtml.call(it, it._encounterState);
  assert.match(html, /does not check|not checked/i);
});

// ── Source-level guard ──────────────────────────────────────────────────────

test('the phrase "balanced encounter" is gone from the builder source', () => {
  assert.ok(!/balanced encounter/i.test(BUILDER_SRC),
    'the widget must not tell a director an unchecked spend is a balanced encounter');
});

test('the unsourced damage-baselines table is still labelled custom in the data', () => {
  // If this ever flips to a published citation the fallback path must be
  // revisited — it exists precisely because these numbers are the package's own.
  assert.equal(load('damage-baselines.json')[0].source, 'custom');
});
