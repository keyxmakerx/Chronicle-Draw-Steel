// test-abilities-data.mjs — integrity checks for data/abilities.json and the
// ability-keyword vocabulary it depends on.
//
// Run: node --test tools/test-abilities-data.mjs
//
// abilities.json is machine-converted from the Steel Compendium markdown (see
// data/NOTICE.md), so the failure mode to guard against is a silent structural
// drift: a duplicate slug, a tier line with no power roll to hang off, a keyword
// that no longer resolves, or an {@reference} pointing at a glossary term that
// was renamed. Each of those renders fine and is simply wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ABILITIES = load('abilities.json');
const KEYWORDS = load('ability-keywords.json');
const GLOSSARY = load('rules-glossary.json');

// Every text-bearing string in an entry, so the reference scan can't miss one.
function strings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, acc));
  return acc;
}

test('abilities.json is a non-empty array of ReferenceItems', () => {
  assert.ok(Array.isArray(ABILITIES), 'abilities.json must be a JSON array');
  assert.ok(ABILITIES.length > 0, 'abilities.json must not be empty');
  ABILITIES.forEach((a, i) => {
    assert.equal(typeof a.slug, 'string', `entry ${i} needs a string slug`);
    assert.match(a.slug, /^[a-z0-9-]+$/, `slug "${a.slug}" must be lowercase and hyphenated`);
    assert.equal(typeof a.name, 'string', `${a.slug} needs a string name`);
    assert.ok(a.name.length > 0, `${a.slug} needs a non-empty name`);
    assert.equal(typeof a.properties, 'object', `${a.slug} needs a properties object`);
  });
});

test('slugs are unique', () => {
  const seen = new Set();
  for (const a of ABILITIES) {
    assert.ok(!seen.has(a.slug), `duplicate slug: ${a.slug}`);
    seen.add(a.slug);
  }
});

test('domain fields live under properties, never at the root', () => {
  const allowedRoot = new Set(['slug', 'name', 'description', 'properties']);
  for (const a of ABILITIES) {
    for (const k of Object.keys(a)) {
      assert.ok(allowedRoot.has(k), `${a.slug} has root-level field "${k}"; it belongs in properties`);
    }
  }
});

test('every entry records its category, type and provenance', () => {
  const categories = new Set(['class', 'kit', 'common']);
  for (const a of ABILITIES) {
    const p = a.properties;
    assert.ok(categories.has(p.category), `${a.slug} has unknown category "${p.category}"`);
    assert.equal(typeof p.type, 'string', `${a.slug} needs a type`);
    assert.equal(typeof p.source, 'string', `${a.slug} needs a source`);
    assert.ok(p.source.length > 0, `${a.slug} needs a non-empty source`);
    if (p.category === 'class') assert.ok(p.class, `${a.slug} is a class ability but names no class`);
    if (p.category === 'kit') assert.ok(p.kit, `${a.slug} is a kit ability but names no kit`);
  }
});

test('a heroic ability states its cost, and only heroic abilities carry one', () => {
  for (const a of ABILITIES) {
    const p = a.properties;
    if (p.type === 'heroic') {
      assert.equal(typeof p.cost, 'string', `${a.slug} is heroic but has no cost`);
      assert.equal(typeof p.cost_amount, 'number', `${a.slug} has a non-numeric cost_amount`);
      assert.ok(Number.isFinite(p.cost_amount) && p.cost_amount > 0, `${a.slug} has a bad cost_amount`);
      assert.equal(typeof p.cost_resource, 'string', `${a.slug} has no cost_resource`);
      assert.ok(p.cost.startsWith(String(p.cost_amount)), `${a.slug}: cost "${p.cost}" disagrees with cost_amount`);
      assert.ok(p.cost.endsWith(p.cost_resource), `${a.slug}: cost "${p.cost}" disagrees with cost_resource`);
    } else {
      assert.equal(p.cost, undefined, `${a.slug} is not heroic but carries a cost`);
    }
  }
});

test('power-roll tiers never appear without a power roll', () => {
  for (const a of ABILITIES) {
    const p = a.properties;
    const tiers = ['tier1', 'tier2', 'tier3'].filter((t) => p[t] !== undefined);
    if (tiers.length) assert.ok(p.power_roll, `${a.slug} has ${tiers.join('/')} but no power_roll`);
    for (const extra of p.additional_power_rolls || []) {
      assert.ok(extra.power_roll, `${a.slug} has an additional roll with no power_roll`);
    }
  }
});

test('every keyword resolves in ability-keywords.json', () => {
  const known = new Set(KEYWORDS.map((k) => k.name));
  for (const a of ABILITIES) {
    for (const k of a.properties.keywords || []) {
      assert.ok(known.has(k), `${a.slug} uses keyword "${k}", which ability-keywords.json does not define`);
    }
  }
});

test('ability-keywords.json is itself a well-formed, unique ReferenceItem list', () => {
  const seen = new Set();
  for (const k of KEYWORDS) {
    assert.equal(typeof k.slug, 'string', 'keyword needs a slug');
    assert.equal(typeof k.name, 'string', `keyword ${k.slug} needs a name`);
    assert.ok(!seen.has(k.slug), `duplicate keyword slug: ${k.slug}`);
    seen.add(k.slug);
    assert.equal(typeof k.properties?.source, 'string', `keyword ${k.slug} must record a source`);
  }
});

test('every {@category term} reference resolves to a glossary entry of that category', () => {
  const bySlug = new Map(GLOSSARY.map((g) => [g.slug, g.properties?.category]));
  const re = /\{@([a-z-]+) ([a-z0-9-]+)(\|[^}]*)?\}/g;
  let checked = 0;
  for (const a of ABILITIES) {
    for (const s of strings(a)) {
      for (const m of s.matchAll(re)) {
        checked++;
        const [, category, slug] = m;
        assert.ok(bySlug.has(slug), `${a.slug}: ${m[0]} names no entry in rules-glossary.json`);
        assert.equal(bySlug.get(slug), category, `${a.slug}: ${m[0]} — glossary files "${slug}" under "${bySlug.get(slug)}"`);
      }
    }
  }
  assert.ok(checked > 0, 'expected abilities.json to carry @references');
});

// The 21 kit signature abilities are published in both files, converted from the
// same source. If one file is regenerated and the other isn't, they drift apart
// silently — a GM reading the kit page and a GM reading the ability page would
// see different numbers.
test('kit signature abilities agree with kits.json', () => {
  const KITS = load('kits.json');
  const byName = new Map(
    ABILITIES.filter((a) => a.properties.category === 'kit').map((a) => [a.name, a])
  );
  // Compare on meaning, not markup: an {@ref} in one file and plain text in the
  // other are the same rule.
  const plain = (s) =>
    (s || '')
      .replace(/\{@[a-z-]+ ([a-z0-9-]+)(\|([^}]*))?\}/g, (_m, slug, _p, display) => display || slug)
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();

  assert.equal(byName.size, KITS.length, 'every kit should contribute exactly one signature ability');
  for (const kit of KITS) {
    const sig = kit.properties.signature_ability;
    assert.ok(sig, `${kit.slug} has no signature_ability`);
    const ability = byName.get(sig.name);
    assert.ok(ability, `${kit.slug}'s "${sig.name}" is missing from abilities.json`);
    assert.equal(ability.properties.kit, kit.name, `"${sig.name}" is filed under the wrong kit`);
    assert.deepEqual(ability.properties.keywords, sig.keywords, `"${sig.name}" keywords disagree`);
    for (const f of ['distance', 'target', 'power_roll', 'tier1', 'tier2', 'tier3', 'effect']) {
      assert.equal(plain(ability.properties[f]), plain(sig[f]), `"${sig.name}" ${f} disagrees with kits.json`);
    }
  }
});

test('no stray markdown survived the conversion', () => {
  for (const a of ABILITIES) {
    for (const s of strings(a)) {
      assert.ok(!s.includes('**'), `${a.slug} still contains markdown bold: ${s.slice(0, 80)}`);
      assert.ok(!/\]\(#page-/.test(s), `${a.slug} still contains a page-anchor link: ${s.slice(0, 80)}`);
      assert.ok(!s.includes('📏') && !s.includes('🎯'), `${a.slug} still contains stat-block table glyphs`);
    }
  }
});
