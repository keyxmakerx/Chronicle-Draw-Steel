#!/usr/bin/env node
/**
 * The creature editor's Build with an AI.
 *
 * The AI supplies words and picks; the published formulas set every number.
 * These tests pin both: the guide offers exactly the package's own options,
 * and reading an answer keeps the AI's words, drops its numbers and rule
 * breaks with a note, and never saves the "From the AI" marks.
 *
 * Run: `node --test tools/test-monster-ai.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const data = (f) => JSON.parse(readFileSync(join(HERE, '..', 'data', f), 'utf8'));
const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
globalThis.MonsterEngine = Engine;
globalThis.DrawSteelStatblock = require('../widgets/statblock-renderer.js');
const Ed = require('../widgets/monster-builder.js');

const REFS = { orgs: data('organization-templates.json'), roles: data('role-templates.json') };
const FILES = { creatureKeywords: data('creature-keywords.json'), abilityKeywords: data('ability-keywords.json'), glossary: data('rules-glossary.json') };
const V = Ed.vocabulary(REFS, FILES);

function read(answer) {
  const st = Ed.newState('', null, REFS);
  const notes = Ed.fromAI(st, answer, V);
  return { st, notes };
}

test('the guide offers every option from the package’s own files', () => {
  const g = Ed.guideFor('A goblin spider rider', '4 heroes, average level 3', V);
  for (const o of REFS.orgs) if (o.slug !== 'swarm') assert.ok(g.includes(`"${o.slug}"`), `organization ${o.slug}`);
  assert.ok(!g.includes('"swarm"'), 'swarm is a keyword, not an organization to pick');
  for (const r of REFS.roles) assert.ok(g.includes(`"${r.slug}"`), `role ${r.slug}`);
  for (const k of FILES.creatureKeywords) assert.ok(g.includes(k.name), `creature keyword ${k.name}`);
  for (const k of FILES.abilityKeywords) {
    if ((k.properties || {}).group === 'Helper') continue;
    assert.ok(g.includes(k.name), `ability keyword ${k.name}`);
  }
  for (const t of FILES.glossary) {
    if (['condition', 'duration', 'movement'].includes((t.properties || {}).category)) assert.ok(g.includes(t.slug), `term ${t.slug}`);
  }
  for (const d of Ed.DTYPES) assert.ok(g.includes(d), `damage type ${d}`);
  for (const [z] of Ed.SIZES) assert.ok(g.includes(`"${z}"`), `size ${z}`);
  assert.match(g, /A goblin spider rider/);
  assert.match(g, /4 heroes, average level 3/);
  assert.match(g, /Do not give encounter value, Stamina, free strike, characteristics or damage numbers/);
});

test('helper tags are not offered as ability keywords', () => {
  const helpers = FILES.abilityKeywords.filter((k) => (k.properties || {}).group === 'Helper').map((k) => k.name);
  for (const h of helpers) assert.ok(!V.abilityKeywords.includes(h), h);
});

test('an answer still being pasted is read up to its last complete value', () => {
  const full = Ed.AI_EXAMPLE;
  const done = Ed.readAnswer('Here you go:\n```json\n' + full + '\n```');
  assert.equal(done.done, true);
  assert.equal(done.obj.name, 'Skrix the Webmother');
  const half = Ed.readAnswer(full.slice(0, Math.floor(full.length / 2)));
  assert.equal(half.done, false);
  assert.equal(half.obj.name, 'Skrix the Webmother');
  assert.ok(Ed.readAnswer('{ "na').wait);
  assert.ok(Ed.readAnswer('no json at all').err);
  assert.ok(!Ed.readAnswer('no json at all').wait);
  // Every prefix reads without throwing.
  for (let i = 0; i <= full.length; i += 7) assert.doesNotThrow(() => Ed.readAnswer(full.slice(0, i)));
});

test('the example answer is read with its numbers and rule breaks dropped', () => {
  const { st, notes } = read(JSON.parse(Ed.AI_EXAMPLE));
  const all = notes.join('\n');
  assert.equal(st.name, 'Skrix the Webmother');
  assert.equal(st.aiName, true);
  assert.equal(st.c.organization, 'leader');
  assert.equal(st.c.role, '', 'a leader takes no role');
  assert.match(all, /Leaders have no role/);
  assert.match(all, /Stamina: the AI said 999/);
  assert.match(all, /Encounter value: the AI said 50/);
  assert.match(all, /damage numbers/);
  assert.notEqual(st.c.stamina, 999);
  assert.notEqual(st.c.ev, 50);
  assert.equal(st.c.ev, st.pr.ev.value, 'EV is the formula’s');
  assert.equal(st.c.stamina, st.pr.stamina.value, 'Stamina is the formula’s');
  assert.equal(st.c.villain_actions.length, 3);
  assert.deepEqual(st.c.villain_actions.map((v) => v.order), ['opener', 'crowd-control', 'ultimate']);
});

test('signature damage is the formula’s, in the AI’s damage type, with its extra text kept', () => {
  const { st } = read({ name: 'Ash Hound', level: 3, organization: 'platoon', role: 'brute',
    signature: { name: 'Burning Bite', distance: 'Melee 1', target: 'One creature', damage_type: 'fire', tier_effects: ['12 damage', '', '{@condition weakened} ({@duration eot})'] } });
  const sig = st.c.abilities[0];
  const d = st.pr.damage.value, hc = st.pr.hc.value;
  assert.ok(d && hc !== null, 'the formulas cover a level 3 platoon brute');
  assert.equal(sig.tier1, (d.tier1 + hc) + ' fire damage');
  assert.equal(sig.tier3, (d.tier3 + hc) + ' fire damage; {@condition weakened} ({@duration eot})');
  assert.equal(sig.power_roll, '2d10 + ' + hc);
  assert.equal(sig.from_ai, true);
});

test('unknown picks fall back with a note', () => {
  const { st, notes } = read({ name: 'X', level: 40, organization: 'warlord', role: 'tank', size: '9Q',
    signature: { name: 'Zap', damage_type: 'laser', tier_effects: ['', '', ''] } });
  const all = notes.join('\n');
  assert.equal(st.c.level, 1);
  assert.equal(st.c.organization, 'platoon');
  assert.equal(st.c.role, '');
  assert.match(all, /outside 1 to 10/);
  assert.match(all, /not a Draw Steel organization/);
  assert.match(all, /not a Draw Steel role/);
  assert.match(all, /not one Draw Steel uses/);
  assert.match(all, /not a Draw Steel damage type/);
  assert.ok(!/laser/.test(st.c.abilities[0].tier1));
});

test('villain actions on a creature that takes none are dropped', () => {
  const { st, notes } = read({ name: 'Grunt', level: 2, organization: 'platoon', role: 'brute', villain_actions: [{ name: 'Rally', effect: 'x' }] });
  assert.equal(st.c.villain_actions.length, 0);
  assert.match(notes.join('\n'), /Only leaders and solos take villain actions/);
});

test('characteristics the AI gives are dropped for the published spread', () => {
  const { st, notes } = read({ name: 'Y', level: 5, organization: 'elite', role: 'defender', characteristics: { might: 9 } });
  const top = Math.max(...['might', 'agility', 'reason', 'intuition', 'presence'].map((k) => st.c[k]));
  assert.equal(top, st.pr.hc.value);
  assert.match(notes.join('\n'), /characteristics were dropped/);
});

test('made-up reference markup becomes plain words', () => {
  assert.equal(Ed.keepKnownRefs('{@condition slowed} and {@condition befuddled}', V), '{@condition slowed} and befuddled');
  assert.equal(Ed.keepKnownRefs('{@condition Grabbed|grabs}', V), '{@condition grabbed|grabs}');
  assert.equal(Ed.keepKnownRefs('{@condition nope|is nope}', V), 'is nope');
});

test('the “From the AI” marks are never saved, and saving clears them', () => {
  const { st } = read(JSON.parse(Ed.AI_EXAMPLE));
  const out = Ed.toSave(st);
  for (const k of ['traits', 'abilities_json', 'villain_actions_json']) assert.ok(!out.fields[k].includes('from_ai'), k);
  assert.ok(st.c.abilities.some((a) => a.from_ai), 'the editor still shows the marks until the save lands');
  assert.equal(Ed.clearAIMarks(st), true);
  assert.equal(st.aiName, false);
  assert.ok(!st.c.abilities.concat(st.c.traits, st.c.villain_actions).some((a) => a.from_ai));
  assert.equal(st.origin, null);
});

test('an answer that is not an object leaves the editor alone', () => {
  const st = Ed.newState('Keep me', null, REFS);
  assert.deepEqual(Ed.fromAI(st, [1, 2], V), ['That answer holds no creature.']);
  assert.equal(st.name, 'Keep me');
});

test('the editor keeps fields it does not own when the AI fills it', () => {
  const st = Ed.newState('Old', { level: 2, conditions: 'dazed' }, REFS);
  Ed.fromAI(st, { name: 'New', level: 3 }, V);
  assert.equal(Ed.toSave(st).fields.conditions, 'dazed');
});
