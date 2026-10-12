#!/usr/bin/env node
/**
 * The creature editor's generator (Generate one).
 *
 * It picks abilities made for the creature's kind and role from
 * data/creature-abilities.json and leaves every number to the published
 * formulas, so these tests pin both halves: what it picks, and that it
 * invents no figures.
 *
 * Run: `node --test tools/test-monster-generator.mjs`
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
const LIB = data('creature-abilities.json');
const KINDS = ['minion', 'horde', 'platoon', 'elite', 'leader', 'solo'];
const noRole = (o) => o === 'leader' || o === 'solo';

function make(opts, seed = 0) {
  const st = Ed.newState('', null, REFS);
  const why = Ed.generate(st, Object.assign({ level: 3 }, opts), LIB, seed);
  return { st, why };
}
function all(st) { return st.c.abilities.concat(st.c.villain_actions, st.c.traits); }
function byName(n) { return LIB.find((t) => t.name === n); }

test('every generated ability is made for the creature’s kind and role', () => {
  for (const kind of KINDS) {
    for (const role of noRole(kind) ? [''] : Ed.ROLES) {
      for (let seed = 0; seed < 4; seed++) {
        const { st } = make({ kind, role }, seed);
        for (const a of all(st)) {
          const t = byName(a.name);
          assert.ok(t, `${a.name} comes from the library`);
          assert.ok(Ed.fits(t, kind, st.c.role), `${a.name} fits a ${kind} ${role}`);
        }
      }
    }
  }
});

test('every creature gets a signature ability that deals damage', () => {
  for (const kind of KINDS) {
    const { st } = make({ kind, role: noRole(kind) ? '' : 'brute' });
    const sig = st.c.abilities.filter((a) => a.type === 'signature');
    assert.equal(sig.length, 1, kind);
    assert.match(sig[0].tier1, /^\d+(\s+[a-z]+)?\s+damage/i, kind);
  }
});

test('a minion stays simple: its signature and at most one thing more', () => {
  for (const role of Ed.ROLES) {
    const { st } = make({ kind: 'minion', role });
    assert.ok(all(st).length <= 2, `${role} minion has ${all(st).length}`);
  }
});

test('leaders and solos take no role and get three villain actions, none twice', () => {
  for (const kind of ['leader', 'solo']) {
    const { st } = make({ kind, role: 'brute' });
    assert.equal(st.c.role, '');
    assert.equal(st.c.villain_actions.length, 3);
    assert.deepEqual(st.c.villain_actions.map((v) => v.order), ['opener', 'crowd-control', 'ultimate']);
    assert.equal(new Set(st.c.villain_actions.map((v) => v.name)).size, 3);
    assert.ok(Ed.checks(st).every((r) => r.severity !== 'miss'), kind + ' passes the completeness checks');
  }
});

test('nothing is added twice', () => {
  for (const kind of KINDS) {
    for (let seed = 0; seed < 6; seed++) {
      const names = all(make({ kind, role: noRole(kind) ? '' : 'defender', what: 'giant dragon' }, seed).st).map((a) => a.name);
      assert.equal(new Set(names).size, names.length, names.join(', '));
    }
  }
});

test('every figure is the published formula’s, none the director’s', () => {
  const F = Engine.Formulas;
  for (const kind of KINDS) {
    const { st } = make({ kind, role: noRole(kind) ? '' : 'harrier', level: 5 });
    const org = REFS.orgs.find((o) => o.slug === kind);
    const role = REFS.roles.find((r) => r.slug === st.c.role) || null;
    assert.deepEqual(st.own, {});
    assert.equal(st.c.ev, F.encounterValue(5, org).value);
    assert.equal(st.c.stamina, F.stamina(5, org, role).value);
    const top = Math.max(...['might', 'agility', 'reason', 'intuition', 'presence'].map((k) => st.c[k] ?? -99));
    assert.equal(top, F.highestCharacteristic(5, org).value, kind + ' highest characteristic');
  }
});

test('formula damage keeps the template’s damage type', () => {
  const { st } = make({ kind: 'solo', what: 'red dragon' });
  const breath = st.c.abilities.find((a) => a.name === 'Breath Weapon');
  assert.ok(breath, 'a dragon gets its breath weapon');
  assert.match(breath.tier1, /^\d+ fire damage$/);
  assert.equal(Ed.autoTier('2 psychic damage; slowed', 7), '7 psychic damage; slowed');
  assert.equal(Ed.autoTier('4 damage per target', 9), '9 damage per target');
});

test('Try other abilities picks again', () => {
  const sets = new Set();
  for (let seed = 0; seed < 4; seed++) sets.add(all(make({ kind: 'platoon', role: 'defender' }, seed).st).map((a) => a.name).join('|'));
  assert.ok(sets.size > 1);
});

test('fitting my party uses the engine’s organization and role, and says why', () => {
  const profile = { size: 4, levelAvg: 3, defenses: { might: 1, agility: 1, reason: 0, intuition: 1, presence: 0 }, weakestDefense: 'reason', weakestDefenseValue: 0, immunities: [], weaknesses: [] };
  const s = Engine.suggest(profile, 'standard', { orgTemplates: REFS.orgs, roleTemplates: REFS.roles });
  const { st, why } = make({ kind: 'party', profile });
  assert.equal(st.c.organization, s.organization);
  if (!noRole(s.organization)) assert.equal(st.c.role, s.role);
  assert.ok(why.includes(s.rationale.organization));
});

test('the reasons never call the creature balanced', () => {
  for (const kind of KINDS) {
    const { why } = make({ kind });
    assert.ok(why.length >= 3);
    assert.ok(why.every((w) => !/balanced|validated/i.test(w)), why.join(' '));
  }
});

test('no library ability carries the unpublished Attack keyword', () => {
  for (const t of LIB) {
    assert.ok(!(t.properties.keywords || []).includes('Attack'), t.slug);
  }
});
