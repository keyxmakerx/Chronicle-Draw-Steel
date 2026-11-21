#!/usr/bin/env node
/**
 * What the campaign's AI is told about a creature's figures, and the editor
 * behaviour that makes it true.
 *
 * Chronicle's AI Import shows the AI each preset field's `format` note. For
 * EV, Stamina, winded and free strike the notes say to leave the figure out
 * and never estimate it, because the stat block editor fills a missing figure
 * from DrawSteelFormulas when the director opens it. These tests pin the notes
 * (no figure or formula restated, so the formulas keep one evaluation site;
 * options exactly the data's) and the promise: a creature as the AI leaves it
 * opens with every covered figure the formula's, a number already on the page
 * stays, and a figure no formula covers stays empty.
 *
 * Run: `node --test tools/test-creature-ai-figures.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
const F = Engine.Formulas;
globalThis.DrawSteelFormulas = F;
globalThis.MonsterEngine = Engine;
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;
const Ed = require('../widgets/monster-builder.js');

const load = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const REFS = { orgs: load('data/organization-templates.json'), roles: load('data/role-templates.json') };
const org = (s) => REFS.orgs.find((o) => o.slug === s);
const role = (s) => REFS.roles.find((r) => r.slug === s);
const preset = load('manifest.json').entity_presets.find((p) => p.slug === 'drawsteel-creature');
const note = (k) => (preset.fields.find((f) => f.key === k) || {}).format || '';

// listed reads the options a note names ("One of a, b or c.").
function listed(text) {
  const m = /One of ([^.]+)\./.exec(text);
  assert.ok(m, 'the note names its options: ' + text);
  return m[1].split(/,\s*|\s+or\s+/).map((s) => s.trim()).filter(Boolean).sort();
}

const STRIKE = { name: 'Crushing Blow', type: 'signature', keywords: 'Melee, Strike, Weapon', distance: 'Melee 1', target: 'One creature',
  tier1: '3 damage', tier2: '5 damage; push 1', tier3: '7 fire damage; push 2', auto_damage: true };
const SHOVE = { name: 'Shove', type: 'maneuver', keywords: 'Melee', tier1: 'Push 1', tier2: 'Push 2', tier3: 'Push 3' };

// asLeft is a creature as the notes ask the AI to write it: words, picks and
// abilities, with no figures.
const asLeft = (extra) => Object.assign({ level: 3, organization: 'Elite', role: 'Brute', abilities_json: JSON.stringify([STRIKE, SHOVE]) }, extra || {});
const opened = (fields) => { const st = Ed.newState('Ogre', fields, REFS); return { st, out: Ed.toSave(st).fields }; };

test('the figure notes tell the AI to leave them out and restate no figure or formula', () => {
  for (const k of ['ev', 'stamina', 'winded', 'free_strike']) {
    const t = note(k);
    assert.match(t, /^Leave it out/, k);
    assert.doesNotMatch(t, /\d/, k + ' carries no number, so the formulas are evaluated in one place only');
  }
  for (const k of ['ev', 'stamina', 'free_strike']) {
    assert.match(note(k), /published formulas/, k);
    assert.match(note(k), /Never estimate it/, k);
    assert.match(note(k), /Edit stat block/, k);
  }
});

test('the organization and role notes offer exactly the published options', () => {
  const orgs = REFS.orgs.map((o) => o.slug).filter((s) => s !== 'swarm').sort();
  assert.deepEqual(listed(note('organization')), orgs, 'swarm is a keyword with no published modifier, so it is not offered');
  assert.deepEqual(listed(note('role')), REFS.roles.map((r) => r.slug).sort());
  assert.match(note('role'), /Leave it out for a leader or solo/);
});

test('the ability notes name auto_damage, which the editor reads', () => {
  assert.match(note('abilities_json'), /`auto_damage: true`/);
  assert.match(note('villain_actions_json'), /`auto_damage`/);
});

test('a creature the AI left without figures opens with each one the published formula’s', () => {
  const { st, out } = opened(asLeft());
  const o = org('elite'), r = role('brute');
  const ev = F.encounterValue(3, o), sta = F.stamina(3, o, r), fs = F.freeStrike(3, o, r);
  assert.ok(ev.sourced && sta.sourced && fs.sourced, 'the formulas cover a level 3 elite brute');
  assert.equal(out.ev, ev.value);
  assert.equal(out.stamina, sta.value);
  assert.equal(out.winded, Math.floor(sta.value / 2));
  assert.equal(S.freeStrikeNumber(out.free_strike), fs.value);
  assert.deepEqual(st.own, {}, 'no figure reads as the director’s');
  const pr = S.provenance(S.normalize(out), REFS);
  for (const k of ['ev', 'stamina', 'free_strike']) assert.equal(pr[k].state, 'formula', k + ' carries the formula’s tick once saved');
});

test('an auto_damage ability takes the formula’s damage and keeps its words', () => {
  const { out } = opened(asLeft());
  const o = org('elite'), r = role('brute');
  const d = F.damageTiers(3, o, r).value, hc = F.highestCharacteristic(3, o).value;
  const [strike, shove] = JSON.parse(out.abilities_json);
  assert.equal(strike.tier1, (d.tier1 + hc) + ' damage');
  assert.equal(strike.tier2, (d.tier2 + hc) + ' damage; push 1');
  assert.equal(strike.tier3, (d.tier3 + hc) + ' fire damage; push 2');
  assert.equal(strike.power_roll, '2d10 + ' + hc);
  assert.deepEqual([shove.tier1, shove.tier2, shove.tier3], ['Push 1', 'Push 2', 'Push 3'], 'an ability without auto_damage is untouched');
});

test('a number already on the page stays, so the director’s own figure is never overwritten', () => {
  const { st, out } = opened(asLeft({ stamina: 99, winded: 49 }));
  assert.equal(out.stamina, 99);
  assert.equal(out.winded, 49);
  assert.ok(st.own.stamina);
  assert.equal(out.ev, F.encounterValue(3, org('elite')).value, 'the figures left out still follow the formula');
});

test('a figure no published formula covers stays empty for the director', () => {
  const swarm = opened(asLeft({ organization: 'swarm', role: 'harrier' })).out;
  assert.equal(F.encounterValue(3, org('swarm')).sourced, false);
  assert.equal(swarm.ev, null);
  assert.equal(swarm.stamina, null);
  const noRole = opened(asLeft({ role: '' })).out;
  assert.equal(F.stamina(3, org('elite'), null).sourced, false);
  assert.equal(noRole.stamina, null, 'an elite with no role has no published Stamina');
  const leader = opened(asLeft({ organization: 'leader', role: '' })).out;
  const want = F.stamina(3, org('leader'), null);
  assert.equal(leader.stamina, want.sourced ? want.value : null, 'a leader takes the published table’s role modifier');
});

test('the AI Import review takes the formula for a figure the AI left out, and offers nothing to overwrite', () => {
  const res = S.reviewCheck(asLeft(), REFS, ['level', 'organization', 'role', 'abilities_json'], {});
  const left = res.items.filter((i) => ['ev', 'stamina', 'winded', 'free_strike'].includes(i.id));
  assert.deepEqual(left.map((i) => i.id), ['ev', 'stamina', 'winded', 'free_strike']);
  assert.ok(left.every((i) => i.start === 'used' && i.blank === true), 'blank figures start taken');
});
