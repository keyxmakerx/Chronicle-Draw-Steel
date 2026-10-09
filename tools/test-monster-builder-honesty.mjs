// test-monster-builder-honesty.mjs — the monster builder must not present
// unsourced arithmetic as validated Draw Steel math.
//
// Where a published formula (data/monster-building.json,
// data/encounter-building.json) covers a figure the builder uses it; where none
// does, the builder says the director sets it instead of inventing a number
// (see CLAUDE.md -> "The builder's math must carry its own provenance").
//
// Run: node --test tools/test-monster-builder-honesty.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
const F = Engine.Formulas;
globalThis.DrawSteelFormulas = F;
globalThis.MonsterEngine = Engine;
globalThis.MonsterParty = require('../widgets/monster-party.js');
globalThis.DrawSteelStatblock = require('../widgets/statblock-renderer.js');
const Ed = require('../widgets/monster-builder.js');

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const REFS = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
const org = (s) => REFS.orgs.find((o) => o.slug === s);
const BUILDER_SRC = readFileSync(new URL('../widgets/monster-builder.js', import.meta.url), 'utf8');

const state = (fields, name) => Ed.newState(name || 'Test', Object.assign({ level: 1 }, fields), REFS);
const ui = (extra) => Object.assign({ ref: null }, extra || {});

// ── Figures follow the published formulas ───────────────────────────────────

test('creature EV is the published ((2 x level) + 4) x organization modifier', () => {
  const st = state({ level: 5, organization: 'elite', role: 'brute' });
  assert.equal(st.c.ev, F.encounterValue(5, org('elite')).value);
  assert.equal(st.c.ev, 28);
});

test('Stamina is the published formula, with the role’s modifier', () => {
  const st = state({ level: 8, organization: 'solo', role: 'brute' });
  // The audit’s worked case: a level 8 solo gets 550 Stamina, not 240.
  assert.equal(st.c.stamina, 550);
  assert.equal(st.c.winded, 275);
});

test('free strike is the published tier 1 damage result', () => {
  const st = state({ level: 5, organization: 'leader' });
  assert.equal(st.c.free_strike, F.damageTiers(5, org('leader'), null).value.tier1 + ' damage');
});

test('a figure follows the formula when the level changes, until the director sets it', () => {
  const st = state({ level: 2, organization: 'platoon', role: 'brute' });
  st.c.level = 6; Ed.derive(st);
  assert.equal(st.c.ev, F.encounterValue(6, org('platoon')).value);
  Ed.setFigure(st, 'ev', '99');
  st.c.level = 7; Ed.derive(st);
  assert.equal(st.c.ev, 99, 'a number the director typed is never overwritten');
  Ed.useFormula(st, 'ev');
  assert.equal(st.c.ev, F.encounterValue(7, org('platoon')).value);
});

test('opening a stored creature never rewrites a figure the director set', () => {
  const st = state({ level: 3, organization: 'leader', ev: 30, stamina: 77 });
  assert.equal(st.c.ev, 30);
  assert.equal(st.c.stamina, 77);
  assert.ok(st.own.ev && st.own.stamina);
});

test('formula damage on a strike adds the published highest characteristic', () => {
  const st = state({ level: 5, organization: 'leader' });
  st.c.abilities.push(Ed.newAbility(st));
  Ed.derive(st);
  const d = F.damageTiers(5, org('leader'), null).value;
  const hc = F.highestCharacteristic(5, org('leader')).value;
  const a = st.c.abilities[0];
  assert.equal(a.tier1, (d.tier1 + hc) + ' damage');
  assert.equal(a.power_roll, '2d10 + ' + hc);
});

test('formula damage keeps the director’s words after the number', () => {
  assert.equal(Ed.autoTier('9 damage; push 2', 14), '14 damage; push 2');
  assert.equal(Ed.autoTier('', 6), '6 damage');
  assert.equal(Ed.autoTier('slowed (EoT)', 6), '6 damage; slowed (EoT)');
});

// ── Where no formula covers the creature ────────────────────────────────────

test('swarm leaves EV and Stamina to the director and says so', () => {
  const st = state({ level: 2, organization: 'swarm', role: 'harrier' });
  assert.equal(st.c.ev, null, 'no number is invented');
  assert.equal(st.c.stamina, null);
  const html = Ed.editorHtml(st, ui());
  assert.match(html, /No published encounter value for this creature\. Set it yourself\./);
  assert.match(html, /No published Stamina for this creature\. Set it yourself\./);
});

test('with no role chosen, Stamina is the director’s (published roles span 10–30)', () => {
  const st = state({ level: 3, organization: 'platoon' });
  assert.equal(st.c.stamina, null);
  assert.equal(F.stamina(3, org('platoon'), null).value, null);
});

test('leaders and solos take no role: the published table supplies theirs', () => {
  const st = state({ level: 4, organization: 'solo' });
  assert.equal(st.c.stamina, F.stamina(4, org('solo'), null).value);
  assert.match(Ed.editorHtml(st, ui()), /Solos have no role/);
});

test('the made-up damage table is gone, and nothing reads it', () => {
  assert.equal(existsSync(new URL('../data/damage-baselines.json', import.meta.url)), false);
  assert.ok(!/damage-baselines/.test(BUILDER_SRC));
  assert.ok(!/damage-baselines|baselines\[/.test(readFileSync(new URL('../widgets/monster-engine.js', import.meta.url), 'utf8')));
});

// ── The chips and the checks ────────────────────────────────────────────────

test('every figure says where it came from', () => {
  const st = state({ level: 3, organization: 'elite', role: 'brute' });
  Ed.setFigure(st, 'stamina', '100');
  const html = Ed.editorHtml(st, ui());
  assert.match(html, /Published formula/);
  assert.match(html, /Changed by you \(the formula gives \d+\)/);
  assert.match(html, /Use the formula/);
});

test('the checks panel is titled Completeness checks and carries its standing line', () => {
  const html = Ed.sideHtml(state({ level: 1, organization: 'horde', role: 'brute' }), ui());
  assert.match(html, /Completeness checks/);
  assert.ok(!/>\s*Validation/.test(html));
  assert.match(html, /They don’t judge whether the fight is balanced/);
});

test('the checks never claim a creature is balanced or validated', () => {
  const html = Ed.sideHtml(state({ level: 1, organization: 'horde', role: 'brute' }), ui())
    .replace(Ed.STANDING_LINE, '');
  assert.ok(!/balanced|validated/i.test(html));
});

test('a provenance row names every figure no formula covers', () => {
  const rows = Ed.checks(state({ level: 1, organization: 'swarm', role: 'harrier' }));
  const prov = rows.filter((r) => r.severity === 'provenance').map((r) => r.message).join(' ');
  assert.match(prov, /encounter value/i);
  assert.match(prov, /Stamina/);
});

test('a deviation warning cites the published figure, and only when one exists', () => {
  const st = state({ level: 3, organization: 'elite', role: 'brute' });
  Ed.setFigure(st, 'ev', '40');
  assert.ok(Ed.checks(st).some((r) => r.severity === 'warn' && /published formula gives 20/.test(r.message)));
  const sw = state({ level: 1, organization: 'swarm', role: 'harrier', ev: 5, stamina: 20 });
  assert.ok(!Ed.checks(sw).some((r) => r.severity === 'warn' && /Encounter value|Stamina/.test(r.message)),
    'no deviation is claimed against a figure the rules do not define');
});

test('if the published-formula module is missing, the panel says so instead of checking silently', () => {
  const saved = globalThis.DrawSteelFormulas;
  globalThis.DrawSteelFormulas = undefined;
  try {
    const st = state({ level: 3, organization: 'elite', role: 'brute' });
    assert.equal(st.c.ev, null);
    assert.ok(Ed.checks(st).some((r) => r.severity === 'provenance' && /did not load/.test(r.message)));
  } finally {
    globalThis.DrawSteelFormulas = saved;
  }
});

// ── The encounter budget ────────────────────────────────────────────────────

const party = (n, level) => {
  const heroes = [];
  for (let i = 0; i < n; i++) heroes.push({ name: 'H' + i, fields_data: { level, might: 2, agility: 1, reason: 0, intuition: 1, presence: 0 } });
  return { heroes, profile: globalThis.MonsterParty.deriveParty(heroes), levels: heroes.map(() => level) };
};

test('the budget is the published party encounter strength, not size x level x 4', () => {
  const b = Ed.budget(party(4, 10).profile, [10, 10, 10, 10], 20);
  assert.equal(b.partyEs, F.partyEncounterStrength([10, 10, 10, 10]).value);
  assert.equal(b.partyEs, 96);
  assert.equal(b.bands.standard.lower, 96);
});

test('the meter names the published band and what it does not check', () => {
  const st = state({ level: 10, organization: 'solo' });
  const html = Ed.sideHtml(st, ui({ party: party(4, 10) }));
  assert.match(html, /A standard fight for this party is <b>96–/);
  assert.match(html, /not checked here/);
  assert.ok(!/balanced/i.test(html.replace(/whether the fight is balanced/, '')));
});

test('the phrase "balanced encounter" is gone from the builder source', () => {
  assert.ok(!/balanced encounter/i.test(BUILDER_SRC));
});

test('a party suggestion applies level, organization and role, then the formulas fill the rest', () => {
  const st = state({ level: 1 });
  const note = Ed.applySuggestion(st, party(4, 5).profile);
  assert.equal(st.c.level, 5);
  assert.ok(st.c.organization, 'an organization was chosen');
  assert.equal(st.c.ev, F.encounterValue(5, org(st.c.organization)).value);
  assert.ok(note.length > 0, 'the reasons are shown');
  assert.ok(!/balanced/i.test(note));
});
