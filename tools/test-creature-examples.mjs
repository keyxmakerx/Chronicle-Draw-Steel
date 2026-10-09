// test-creature-examples.mjs — the bundled example creatures agree with the
// published formulas, and the formulas are evaluated in one place only.
//
// data/creatures.json is this package's own work (`source: "custom"`), but the
// figures on it are shown with a tick on every Creature page, so each must be
// what DrawSteelFormulas gives. Swarm is not a published organization: its EV
// and Stamina are the director's, and are exempt.
//
// Run: node --test tools/test-creature-examples.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const F = require('../widgets/monster-engine.js').Formulas;
const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ORGS = load('organization-templates.json');
const ROLES = load('role-templates.json');
const CREATURES = load('creatures.json');
const CHARS = ['might', 'agility', 'reason', 'intuition', 'presence'];

const tpl = (p) => ({
  org: ORGS.find((o) => o.slug === String(p.organization).toLowerCase()),
  role: ROLES.find((r) => r.slug === String(p.role).toLowerCase()),
});

test('there are 35 example creatures, every one with a known organization and role', () => {
  assert.equal(CREATURES.length, 35);
  CREATURES.forEach((c) => {
    const t = tpl(c.properties);
    assert.ok(t.org, c.name + ': organization');
    assert.ok(t.role, c.name + ': role');
  });
});

for (const c of CREATURES) {
  const p = c.properties;
  const { org, role } = tpl(p);
  const swarm = org && org.slug === 'swarm';

  test(c.name + ': figures match the published formulas', () => {
    if (!swarm) {
      assert.equal(p.ev, F.encounterValue(p.level, org).value, 'EV');
      assert.equal(p.stamina, F.stamina(p.level, org, role).value, 'Stamina');
      assert.equal(p.free_strike, F.freeStrike(p.level, org, role).value + ' damage', 'free strike');
    } else {
      assert.equal(F.encounterValue(p.level, org).value, null, 'swarm has no published EV, so it stays the director’s');
      assert.ok(Number.isFinite(p.ev) && Number.isFinite(p.stamina), 'a swarm example still has figures');
    }
    assert.equal(p.winded, Math.floor(p.stamina / 2), 'winded is half Stamina');
    const hc = F.highestCharacteristic(p.level, org).value;
    assert.equal(Math.max(...CHARS.map((k) => p[k])), hc, 'highest characteristic');
  });

  test(c.name + ': abilities are whole, and formula damage is the formula’s', () => {
    const abilities = JSON.parse(p.abilities_json);
    assert.ok(abilities.length >= 1);
    assert.equal(abilities[0].type, 'signature', 'the first ability is the signature');
    const d = F.damageTiers(p.level, org, role).value;
    const hc = F.highestCharacteristic(p.level, org).value;
    abilities.forEach((a) => {
      assert.ok(a.distance && a.target, a.name + ' has distance and target');
      if (!a.auto_damage) return;
      const add = a.keywords.includes('Strike') ? hc : 0;
      ['tier1', 'tier2', 'tier3'].forEach((k) => {
        assert.equal(parseInt(a[k], 10), d[k] + add, a.name + ' ' + k);
      });
    });
  });
}

// The published formulas have one evaluation site: DrawSteelFormulas in
// monster-engine.js. A second copy is how the old builder's numbers drifted up
// to 2.4x from the published ones.
test('no other creature widget evaluates the published formulas itself', () => {
  const dir = new URL('../widgets/', import.meta.url);
  const creatureWidgets = ['monster-builder.js', 'statblock-renderer.js', 'bestiary-browser.js', 'monster-party.js'];
  const tells = [
    /organization_modifier\s*\*/, /\*\s*\w*\.?organization_modifier/,
    /stamina_organization_modifier\s*\*/, /role_modifier\s*\)/,
    /\(\s*4\s*\+\s*\w*level/, /\(\s*2\s*\*\s*\w*level\s*\)\s*\+\s*4/, /\(\s*10\s*\*\s*\w*level/,
    /\*\s*0\.6\b/, /\*\s*1\.1\b/, /\*\s*1\.4\b/,
  ];
  for (const f of readdirSync(dir).filter((x) => creatureWidgets.includes(x))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    tells.forEach((re) => assert.ok(!re.test(src), f + ' evaluates a published formula itself (' + re + '); call DrawSteelFormulas'));
  }
});
