// test-build-your-own-data.mjs — integrity checks for the build-your-own
// reference data: ancestry-point-buy.json, monster-building.json,
// encounter-building.json, and animal-traits.json.
//
// Run: node --test tools/test-build-your-own-data.mjs
//
// These four files exist so an operator can invent an ancestry or a creature and
// know the result is legal. Two failure modes are silent and both are fatal to
// that purpose. The first is provenance drift: an entry that was derived for this
// package losing its "source": "custom" flag and reading as published Draw Steel
// rules (data/NOTICE.md is the contract). The second is derivation drift: the
// tables that were computed from other files in data/ — the ancestry point
// budgets, the role and organization modifiers — quietly disagreeing with the
// files they were computed from. Both render fine and are simply wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));

const ANCESTRY_PB = load('ancestry-point-buy.json');
const MONSTER_BUILD = load('monster-building.json');
const ENCOUNTER = load('encounter-building.json');
const ANIMAL_TRAITS = load('animal-traits.json');
const ANCESTRIES = load('ancestries.json');
const ROLES = load('role-templates.json');
const ORGS = load('organization-templates.json');
const GLOSSARY = load('rules-glossary.json');

const FILES = {
  'ancestry-point-buy.json': ANCESTRY_PB,
  'monster-building.json': MONSTER_BUILD,
  'encounter-building.json': ENCOUNTER,
  'animal-traits.json': ANIMAL_TRAITS,
};

// Every text-bearing string in a value, so the reference scan can't miss one.
function strings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, acc));
  return acc;
}

test('every file is an array of ReferenceItems with unique slugs', () => {
  for (const [file, data] of Object.entries(FILES)) {
    assert.ok(Array.isArray(data), `${file} must be a JSON array`);
    assert.ok(data.length > 0, `${file} must not be empty`);
    const seen = new Set();
    data.forEach((e, i) => {
      assert.equal(typeof e.slug, 'string', `${file} entry ${i} needs a string slug`);
      assert.match(e.slug, /^[a-z0-9-]+$/, `${file}: slug "${e.slug}" must be lowercase-hyphenated`);
      assert.ok(!seen.has(e.slug), `${file}: duplicate slug "${e.slug}"`);
      seen.add(e.slug);
      assert.equal(typeof e.name, 'string', `${file}: ${e.slug} needs a string name`);
      assert.ok(e.name.length > 0, `${file}: ${e.slug} needs a non-empty name`);
      assert.equal(typeof e.description, 'string', `${file}: ${e.slug} needs a description`);
      assert.ok(e.properties && typeof e.properties === 'object',
        `${file}: ${e.slug} needs a properties object`);
    });
  }
});

test('domain-specific fields live inside properties, never at the root', () => {
  // CLAUDE.md "Data Format" and docs/DATA-SCHEMA.md: the root carries only the
  // ReferenceItem keys Chronicle reads off the root, and every DOMAIN field goes
  // in properties. `summary` and `source` are root keys because that is where the
  // renderer looks: system_pages.templ prints item.Summary in the list table and
  // item.Source in the detail header, never properties.summary/source.
  const allowed = new Set(['slug', 'name', 'summary', 'description', 'properties', 'tags', 'source']);
  for (const [file, data] of Object.entries(FILES)) {
    for (const e of data) {
      for (const key of Object.keys(e)) {
        assert.ok(allowed.has(key), `${file}: ${e.slug} has root-level field "${key}"`);
      }
    }
  }
});

test('every entry declares its provenance in the root source', () => {
  for (const [file, data] of Object.entries(FILES)) {
    for (const e of data) {
      const src = e.source;
      assert.equal(typeof src, 'string', `${file}: ${e.slug} needs a root source`);
      assert.ok(src.length > 0, `${file}: ${e.slug} has an empty root source`);
      if (src !== 'custom') {
        assert.match(src, /Draw Steel/,
          `${file}: ${e.slug} claims a published source that doesn't name Draw Steel`);
      }
    }
  }
});

test('custom entries are flagged as custom and say what they were derived from', () => {
  // The operator asked that anything not reproduced from published Draw Steel be
  // denoted as custom. Both derived entries in ancestry-point-buy.json are, and
  // each names the file it was computed from so the derivation can be re-checked.
  const custom = ANCESTRY_PB.filter((e) => e.source === 'custom');
  assert.deepEqual(
    custom.map((e) => e.slug).sort(),
    ['custom-ancestry-checklist', 'custom-ancestry-costing-benchmark'],
  );
  for (const e of custom) {
    assert.equal(typeof e.properties.derived_from, 'string',
      `${e.slug} must name what it was derived from`);
  }
  // The other three files reproduce published rules only.
  for (const file of ['monster-building.json', 'encounter-building.json', 'animal-traits.json']) {
    for (const e of FILES[file]) {
      assert.notEqual(e.source, 'custom',
        `${file}: ${e.slug} is flagged custom but this file is published rules only`);
    }
  }
});

test('every {@category term} reference resolves to a glossary slug', () => {
  const slugs = new Set(GLOSSARY.map((g) => g.slug));
  const REF = /\{@(\w+)\s+([^|}]+)(?:\|([^}]+))?\}/g;
  let checked = 0;
  for (const [file, data] of Object.entries(FILES)) {
    for (const e of data) {
      for (const s of strings(e)) {
        for (const m of s.matchAll(REF)) {
          const term = m[2].trim();
          assert.ok(slugs.has(term),
            `${file}: ${e.slug} references {@${m[1]} ${term}}, which is not a glossary slug`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 0, 'expected the build-your-own data to carry @references');
});

test('the ancestry point budget table matches ancestries.json', () => {
  // The table is DERIVED from data/ancestries.json. If someone edits an ancestry's
  // budget or trait list, this table has to move with it or the operator prices a
  // custom ancestry against numbers that no longer exist.
  const entry = ANCESTRY_PB.find((e) => e.slug === 'ancestry-point-budgets');
  assert.ok(entry, 'ancestry-point-budgets entry must exist');
  const rows = entry.properties.rows;
  assert.equal(rows.length, ANCESTRIES.length, 'one row per published ancestry');
  for (const row of rows) {
    const anc = ANCESTRIES.find((a) => a.slug === row.slug);
    assert.ok(anc, `row "${row.slug}" names no ancestry in ancestries.json`);
    const p = anc.properties;
    assert.equal(row.ancestry_points, p.ancestry_points, `${row.slug} point budget drifted`);
    assert.equal(row.signature_traits, p.signature_traits.length,
      `${row.slug} signature trait count drifted`);
    const ones = p.purchased_traits.filter((t) => t.cost === 1).length;
    const twos = p.purchased_traits.filter((t) => t.cost === 2).length;
    assert.equal(row.purchased_traits_1_point, ones, `${row.slug} 1-point trait count drifted`);
    assert.equal(row.purchased_traits_2_points, twos, `${row.slug} 2-point trait count drifted`);
  }
});

test('the costing benchmark sample size matches the traits it was derived from', () => {
  const bench = ANCESTRY_PB.find((e) => e.slug === 'custom-ancestry-costing-benchmark');
  const sample = bench.properties.sample_size;
  const all = ANCESTRIES.flatMap((a) => a.properties.purchased_traits);
  assert.equal(sample.one_point, all.filter((t) => t.cost === 1).length);
  assert.equal(sample.two_point, all.filter((t) => t.cost === 2).length);
  assert.equal(sample.traits, all.length);
  // Every cost tier the benchmark names must actually occur in the published data.
  const costs = new Set(all.map((t) => t.cost));
  for (const tier of bench.properties.tiers) {
    assert.ok(costs.has(tier.cost), `benchmark prices a tier at ${tier.cost}, unseen in the data`);
    assert.ok(tier.archetypes.length > 0, `benchmark tier ${tier.cost} has no archetypes`);
  }
});

test('the role modifier table agrees with role-templates.json', () => {
  const table = MONSTER_BUILD.find((e) => e.slug === 'role-and-damage-modifier-table');
  const byRole = new Map(table.properties.rows
    .filter((r) => r.kind === 'role').map((r) => [r.slug, r]));
  assert.equal(byRole.size, ROLES.length, 'one table row per role template');
  for (const role of ROLES) {
    const row = byRole.get(role.slug);
    assert.ok(row, `no modifier row for role "${role.slug}"`);
    assert.equal(role.role_modifier, row.role_modifier, `${role.slug} role_modifier disagrees`);
    assert.equal(role.damage_modifier, row.damage_modifier, `${role.slug} damage_modifier disagrees`);
  }
});

test('the organization modifier table agrees with organization-templates.json', () => {
  const table = MONSTER_BUILD.find((e) => e.slug === 'organization-modifier-table');
  const byOrg = new Map(table.properties.rows.map((r) => [r.slug, r]));
  for (const org of ORGS) {
    const row = byOrg.get(org.slug);
    if (!row) {
      // An organization with no published modifier row must say it is this
      // package's own — silently shipping it as published is the defect.
      assert.equal(org.source, 'custom',
        `organization "${org.slug}" has no published modifier row but isn't flagged custom`);
      assert.equal(org.organization_modifier, null,
        `organization "${org.slug}" has no published modifier row but carries a modifier`);
      continue;
    }
    assert.equal(org.organization_modifier, row.organization_modifier,
      `${org.slug} organization_modifier disagrees`);
    assert.equal(org.stamina_organization_modifier, row.stamina_organization_modifier,
      `${org.slug} stamina_organization_modifier disagrees`);
  }
});

test('organization templates flag their derived fields as custom', () => {
  // ev_multiplier / stamina_base / stamina_per_level are this package's own linear
  // approximations; the published formulas (monster-building.json) are quadratic in
  // organization and role. They may not pass themselves off as published numbers.
  for (const org of ORGS) {
    if (org.source === 'custom') continue;
    assert.ok(Array.isArray(org.custom_fields), `${org.slug} needs a custom_fields list`);
    for (const f of ['ev_multiplier', 'stamina_base', 'stamina_per_level']) {
      assert.ok(org.custom_fields.includes(f), `${org.slug} must flag "${f}" as custom`);
    }
  }
  for (const role of ROLES) {
    assert.ok(Array.isArray(role.custom_fields), `${role.slug} needs a custom_fields list`);
    assert.ok(role.custom_fields.includes('characteristics'),
      `${role.slug} must flag "characteristics" as custom`);
  }
});

test('the encounter strength table matches its own published formula', () => {
  const es = ENCOUNTER.find((e) => e.slug === 'encounter-strength');
  assert.equal(es.properties.per_hero_formula, '4 + (2 * hero_level)');
  assert.equal(es.properties.table.length, 10, 'levels 1 through 10');
  for (const row of es.properties.table) {
    assert.equal(row.per_hero, 4 + 2 * row.hero_level,
      `level ${row.hero_level} per-hero ES disagrees with the formula`);
    for (const [n, total] of Object.entries(row.party)) {
      assert.equal(total, row.per_hero * Number(n),
        `level ${row.hero_level}, ${n} heroes: party ES disagrees`);
    }
  }
});

test('every encounter difficulty is present, ordered, and carries a budget band', () => {
  const order = ['trivial', 'easy', 'standard', 'hard', 'extreme'];
  const diffs = ENCOUNTER.filter((e) => e.properties.rule_type === 'difficulty');
  assert.deepEqual(diffs.map((d) => d.properties.difficulty), order);
  for (const d of diffs) {
    assert.ok(d.properties.budget_band, `${d.slug} needs a budget_band`);
    assert.equal(typeof d.properties.budget_band_text, 'string');
    assert.equal(typeof d.properties.victories, 'string', `${d.slug} needs a victories value`);
  }
});

test('the quick-building fill rates agree with the organizations hero_ratio', () => {
  // hero_ratio is written "creatures:heroes"; hero_slots_filled is how many hero
  // slots ONE creature of that organization fills. They encode the same published
  // fact and monster-engine.js reads the first, so they must not diverge.
  const quick = ENCOUNTER.find((e) => e.slug === 'quick-encounter-building');
  for (const rate of quick.properties.fill_rates) {
    const org = ORGS.find((o) => o.slug === rate.organization);
    assert.ok(org, `fill rate names unknown organization "${rate.organization}"`);
    assert.equal(org.hero_slots_filled, rate.hero_slots / rate.creatures,
      `${rate.organization}: hero_slots_filled disagrees with the quick-build fill rate`);
    const [creatures, heroes] = org.hero_ratio.split(':').map(Number);
    assert.equal(heroes / creatures, org.hero_slots_filled,
      `${rate.organization}: hero_ratio disagrees with hero_slots_filled`);
  }
});

test('animal traits are costed, grouped, and priced within the published range', () => {
  const groups = new Set(['Mobility', 'Defensive', 'Offensive', 'Supernatural']);
  const seenGroups = new Set();
  for (const t of ANIMAL_TRAITS) {
    const p = t.properties;
    assert.ok(groups.has(p.group), `${t.slug} has group "${p.group}", not a published category`);
    seenGroups.add(p.group);
    assert.equal(typeof p.cost, 'number', `${t.slug} needs a numeric cost`);
    assert.ok(Number.isInteger(p.cost) && p.cost > 0, `${t.slug} cost must be a positive integer`);
    if (p.upgrade) {
      assert.equal(typeof p.upgrade.cost, 'number', `${t.slug} upgrade needs a cost`);
      assert.equal(typeof p.upgrade.text, 'string', `${t.slug} upgrade needs text`);
    }
    if (p.repeatable !== undefined) {
      assert.ok(Number.isInteger(p.repeatable) && p.repeatable > 1,
        `${t.slug} repeatable must be the number of times it may be selected`);
    }
  }
  assert.equal(seenGroups.size, 4, 'all four published trait categories must be represented');
});

test('the animal trait point buy is buyable with the free budget', () => {
  // 4 free points, +2 EV per point beyond. A trait that costs more than 4 can only
  // ever be bought by raising EV — true of exactly one published trait — so the
  // budget rule and the trait costs have to be stated together.
  const rule = MONSTER_BUILD.find((e) => e.slug === 'animal-trait-point-buy');
  assert.equal(rule.properties.free_points, 4);
  assert.equal(rule.properties.ev_per_extra_point, 2);
  assert.equal(rule.properties.data_file, 'animal-traits.json');
  const overBudget = ANIMAL_TRAITS.filter((t) => t.properties.cost > rule.properties.free_points);
  assert.deepEqual(overBudget.map((t) => t.slug), ['death-fumes'],
    'Death Fumes is the only published trait that cannot be bought inside the free budget');
});

test('monster formulas are stated as formulas, not as pre-computed numbers', () => {
  // The published guidance is a set of equations. Baking their output into a table
  // for a fixed level is how damage-baselines.json drifted from the published math;
  // these entries keep the equation itself so a consumer can evaluate it per level.
  for (const slug of ['encounter-value-formula', 'stamina-formula',
    'damage-and-power-roll-tiers']) {
    const e = MONSTER_BUILD.find((x) => x.slug === slug);
    assert.ok(e, `${slug} must exist`);
    assert.equal(typeof e.properties.formula, 'string', `${slug} needs a formula string`);
    assert.equal(e.properties.rounding, 'up', `${slug} rounds up, per the published text`);
  }
  const dmg = MONSTER_BUILD.find((x) => x.slug === 'damage-and-power-roll-tiers');
  assert.deepEqual(dmg.properties.tier_modifiers, { tier1: 0.6, tier2: 1.1, tier3: 1.4 });
});
