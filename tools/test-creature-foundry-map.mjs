// test-creature-foundry-map.mjs — pins the Creature preset's Foundry field map
// to the Draw Steel Foundry system's NPC data model, so a creature can become a
// Foundry NPC actor without writing to paths that don't exist.
//
// The path and key lists below were read from that system's source
// (MetaMorphic-Digital/draw-steel: src/module/data/actor/npc.mjs, creature.mjs,
// base-actor.mjs, data/models/size.mjs and config.mjs). They are copied, not
// fetched, because this package ships separately; when the system changes its
// model, re-read the source and update this file, never the other way round.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const builder = readFileSync(join(root, 'widgets', 'monster-builder.js'), 'utf8');

// Persisted paths on a Draw Steel `npc` actor that the preset may target.
// `statuses` is Foundry core's own status set on every actor.
const NPC_PATHS = new Set([
  'system.monster.level',
  'system.monster.organization',
  'system.monster.role',
  'system.monster.keywords',
  'system.monster.freeStrike',
  'system.ev',
  'system.stamina.value',
  'system.stamina.max',
  'system.movement.value',
  'system.combat.stability',
  'system.combat.size',
  'system.characteristics.might.value',
  'system.characteristics.agility.value',
  'system.characteristics.reason.value',
  'system.characteristics.intuition.value',
  'system.characteristics.presence.value',
  'statuses',
]);

// Keys of CONFIG.DRAW_STEEL.monsters.organizations and .roles.
const FOUNDRY_ORGS = ['minion', 'horde', 'platoon', 'elite', 'leader', 'solo'];
const FOUNDRY_ROLES = ['ambusher', 'artillery', 'brute', 'controller', 'defender', 'harrier', 'hexer', 'mount', 'support'];

// The value conversions the module understands (Foundry module #203).
const FORMATS = new Set(['set', 'integer', 'size']);
const CHOICES = new Set([
  'DRAW_STEEL.monsters.organizations',
  'DRAW_STEEL.monsters.roles',
  'DRAW_STEEL.monsters.keywords',
]);

function preset(slug) {
  return (manifest.entity_presets || []).find((p) => p.slug === slug);
}
function builderList(name) {
  const m = new RegExp('var ' + name + ' = \\[([^\\]]*)\\]').exec(builder);
  assert.ok(m, name + ' not found in monster-builder.js');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

const creature = preset('drawsteel-creature');

test('the creature preset becomes a Foundry npc actor', () => {
  assert.ok(creature, 'drawsteel-creature preset missing');
  assert.equal(creature.foundry_actor_type, 'npc');
});

test('every creature foundry_path exists on a Draw Steel npc', () => {
  for (const f of creature.fields) {
    if (!f.foundry_path) continue;
    assert.ok(NPC_PATHS.has(f.foundry_path), `${f.key} -> ${f.foundry_path} is not an npc path`);
  }
});

test('no two creature fields write the same Foundry path', () => {
  const seen = new Map();
  for (const f of creature.fields) {
    if (!f.foundry_path) continue;
    assert.ok(!seen.has(f.foundry_path), `${f.key} and ${seen.get(f.foundry_path)} share ${f.foundry_path}`);
    seen.set(f.foundry_path, f.key);
  }
});

test('derived or Chronicle-only fields have no Foundry path', () => {
  // Winded is computed by Foundry and never stored on the actor.
  for (const key of ['winded', 'faction', 'immunities', 'traits', 'abilities_json', 'villain_actions_json', 'book_source', 'token_image']) {
    const f = creature.fields.find((x) => x.key === key);
    assert.ok(f, key + ' missing');
    assert.equal(f.foundry_path, undefined, key + ' must not map to Foundry yet');
  }
});

test('formats and choices are ones the module understands', () => {
  for (const f of creature.fields) {
    if (f.foundry_format !== undefined) assert.ok(FORMATS.has(f.foundry_format), `${f.key}: unknown format ${f.foundry_format}`);
    if (f.foundry_choices !== undefined) assert.ok(CHOICES.has(f.foundry_choices), `${f.key}: unknown choices ${f.foundry_choices}`);
    if (f.foundry_format || f.foundry_choices) assert.ok(f.foundry_path, `${f.key}: a format needs a path`);
  }
  const byKey = Object.fromEntries(creature.fields.map((f) => [f.key, f]));
  assert.equal(byKey.size.foundry_format, 'size');
  assert.equal(byKey.free_strike.foundry_format, 'integer');
  assert.equal(byKey.keywords.foundry_format, 'set');
});

test('Foundry sends back only Stamina and conditions', () => {
  // Signed on Draw Steel #54: Chronicle owns the stat block.
  assert.deepEqual(creature.foundry_pull_fields, ['stamina_current', 'conditions_json']);
  for (const key of creature.foundry_pull_fields) {
    const f = creature.fields.find((x) => x.key === key);
    assert.ok(f && f.foundry_path, key + ' must exist with a foundry_path');
  }
});

test("the builder's organizations and roles are Foundry keys", () => {
  // Swarm is a creature keyword in Draw Steel, not an organization, so a swarm's
  // organization has no Foundry value and the module leaves it unset.
  for (const org of builderList('ORGS')) {
    if (org === 'swarm') continue;
    assert.ok(FOUNDRY_ORGS.includes(org), org + ' is not a Foundry organization');
  }
  assert.deepEqual(builderList('ROLES'), FOUNDRY_ROLES);
});
