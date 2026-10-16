// test-manifest-play.mjs — the hero's `play` blocks must pass the checks
// Chronicle applies at load (docs/system-plugin-marketplace.md, "Play
// Controls"), because Chronicle drops an invalid block and the field then
// silently stays read-only.
//
// Run: node --test tools/test-manifest-play.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const hero = manifest.entity_presets.find((p) => p.slug === 'drawsteel-character');
const field = (k) => hero.fields.find((f) => f.key === k);

const EDIT = ['owner', 'gm', 'none'];
const KIND = ['counter', 'resource', 'conditions', 'choice', 'text'];

test('every play block on the hero is valid by Chronicle’s load rules', () => {
  const played = hero.fields.filter((f) => f.play);
  assert.ok(played.length >= 10);
  for (const f of played) {
    const p = f.play;
    assert.ok(EDIT.includes(p.edit), f.key + ' edit');
    assert.ok(KIND.includes(p.kind), f.key + ' kind');
    if (p.max_field) {
      const t = field(p.max_field);
      assert.ok(t && t.type === 'number' && t.key !== f.key, f.key + ' max_field must be another number field');
    }
    if (p.kind === 'conditions' || p.kind === 'choice') {
      assert.ok(Array.isArray(p.options) && p.options.length > 0 && p.options.length <= 50, f.key + ' options');
      for (const o of p.options) assert.ok(typeof o === 'string' && o.length >= 1 && o.length <= 64, f.key + ' option ' + o);
    }
    if (p.min != null && p.max != null) assert.ok(p.min <= p.max, f.key + ' min/max');
    if (p.step != null) assert.ok(p.step >= 0, f.key + ' step');
    if (p.max_length != null) assert.ok(p.max_length >= 0, f.key + ' max_length');
    assert.ok(!(f.gm_only && p.edit === 'owner'), f.key + ' is gm_only');
  }
});

test('the play fields the hero declares are the ones the rules let a player change', () => {
  for (const k of ['stamina_current', 'stamina_temporary', 'recoveries', 'heroic_resource_current', 'surges', 'conditions_json', 'ancestry', 'culture', 'career', 'kit']) {
    assert.equal(field(k).play.edit, 'owner', k);
  }
  assert.equal(field('stamina_current').play.max_field, 'stamina_max');
  assert.equal(field('recoveries').play.max_field, 'recoveries_max');
  assert.equal(field('surges').play.max, undefined, 'no surge cap is published');
  assert.equal(field('conditions_json').play.to_foundry, true);
});

test('choice options come from the shipped data', () => {
  const names = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8')).map((x) => x.name);
  assert.deepEqual(field('ancestry').play.options, names('ancestries.json'));
  assert.deepEqual(field('kit').play.options, names('kits.json'));
  const conds = JSON.parse(readFileSync(new URL('../data/rules-glossary.json', import.meta.url), 'utf8'))
    .filter((x) => x.properties && x.properties.category === 'condition').map((x) => x.slug);
  assert.deepEqual(field('conditions_json').play.options, conds);
});
