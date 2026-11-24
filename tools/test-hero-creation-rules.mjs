// Pins the hero-creation rules the package hands Chronicle's hero creator:
// which classes use a kit and how many, that subclasses hang off their class,
// that a culture pick is a whole culture, and that the manifest's creator
// blocks name steps and properties that exist. The kit counts are the
// Heroes book's 1st-level class features (chapter 5) and the Kits chapter's
// opening line; the Beastheart and Summoner come from their own books.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const classes = load('data/classes.json');
const cultures = load('data/cultures.json');
const aspects = load('data/culture-aspects.json');
const skills = load('data/skills.json').map((s) => s.name.toLowerCase());
const manifest = load('manifest.json');
const hero = manifest.entity_presets.find((p) => p.slug === 'drawsteel-character');
const field = (k) => hero.fields.find((f) => f.key === k);
const byName = Object.fromEntries(classes.map((c) => [c.name, c.properties]));

test('each class says how many kits it uses at 1st level', () => {
  const want = {
    Censor: 1, Shadow: 1, Troubadour: 1, Fury: 1, Beastheart: 1, Tactician: 2,
    Conduit: 0, Elementalist: 0, Null: 0, Talent: 0, Summoner: 0,
  };
  assert.deepEqual(Object.fromEntries(classes.map((c) => [c.name, c.properties.kits])), want);
  for (const c of classes) {
    if (c.properties.kits !== 1) assert.ok(c.properties.kit_note, c.name + ' explains its kit rule');
  }
});

test('a stormwight fury uses no ordinary kit, and says why', () => {
  const storm = byName.Fury.subclasses.find((s) => s.name === 'Stormwight');
  assert.equal(storm.kits, 0);
  assert.match(storm.kit_note, /stormwight kit/);
  for (const s of byName.Fury.subclasses.filter((x) => x.name !== 'Stormwight')) assert.equal(s.kits, undefined);
});

test('subclasses are named objects under their class, with a text twin', () => {
  for (const c of classes) {
    const subs = c.properties.subclasses;
    if (c.name === 'Beastheart') { assert.equal(subs, undefined); continue; }
    assert.ok(Array.isArray(subs) && subs.length >= 3, c.name);
    for (const s of subs) assert.equal(typeof s.name, 'string');
    assert.equal(c.properties.subclasses_text, subs.map((s) => s.name).join(', '));
  }
  assert.equal(byName.Conduit.subclasses.length, 12, 'the twelve domains');
});

test('every sourced subclass has a summary and a description for the creator card', () => {
  // Summoner's circles have no source text in the package yet, so they stay name-only.
  const unsourced = new Set(['Summoner']);
  for (const c of classes) {
    for (const s of c.properties.subclasses || []) {
      if (unsourced.has(c.name)) continue;
      for (const k of ['summary', 'description']) {
        assert.ok(typeof s[k] === 'string' && s[k].trim().length > 0, c.name + ' ' + s.name + ' ' + k);
        assert.ok(!/\{@/.test(s[k]), c.name + ' ' + s.name + ' ' + k + ' stays plain text');
      }
    }
  }
});

test('a culture pick is a whole culture with three skill options and a language', () => {
  assert.equal(cultures.length, 27);
  for (const c of cultures) {
    const p = c.properties;
    assert.notEqual(p.kind, 'culture aspect', c.name);
    for (const k of ['environment', 'organization', 'upbringing']) assert.ok(p[k], c.name + ' ' + k);
    assert.match(p.skill_options, /^One skill from each aspect\./);
    const quick = p.skill_options_quick_build.split(', ');
    assert.equal(quick.length, 3, c.name);
    for (const q of quick) assert.ok(skills.includes(q.toLowerCase()), c.name + ': ' + q);
    assert.match(p.languages, /^Caelian/);
  }
});

test('the thirteen aspects live in their own file', () => {
  assert.equal(aspects.length, 13);
  const kinds = aspects.map((a) => a.properties.aspect);
  assert.deepEqual([...new Set(kinds)].sort(), ['environment', 'organization', 'upbringing']);
  assert.deepEqual(kinds.filter((k) => k === 'organization').length, 2);
});

test('the creator follows the book: order, needed steps, subclass from class, kits from class', () => {
  assert.deepEqual(hero.creator_order, ['ancestry', 'culture', 'career', 'class', 'subclass', 'kit', 'complication']);
  for (const k of hero.creator_order) assert.ok(field(k), k + ' is a preset field');
  for (const k of ['ancestry', 'culture', 'career', 'class', 'subclass']) assert.equal(field(k).creator?.needed, true, k);
  assert.equal(field('complication').creator, undefined, 'the complication stays optional');
  assert.deepEqual(field('subclass').creator.from, { step: 'class', property: 'subclasses' });
  const counts = field('kit').creator.count_from;
  assert.deepEqual(counts.map((c) => c.step), ['class', 'subclass']);
  for (const c of counts) {
    assert.ok(field(c.step), c.step);
    assert.equal(c.property, 'kits');
    assert.equal(c.note, 'kit_note');
  }
});

test('a conduit picks two domains and a tactician two kits, and Foundry syncs every one', () => {
  assert.equal(byName.Conduit.subclass_count, 2, 'Domains (pick two)');
  assert.equal(byName.Tactician.kits, 2);
  for (const k of ['subclass', 'kit']) {
    assert.equal(field(k).creator.multi, true, k + ' takes several picks');
    assert.equal(field(k).foundry_item_join, true, k + ' syncs every Foundry item');
  }
  assert.deepEqual(field('subclass').creator.count_from, [{ step: 'class', property: 'subclass_count' }]);
  for (const c of classes) {
    if (c.name !== 'Conduit') assert.equal(c.properties.subclass_count, undefined, c.name + ' keeps one subclass');
  }
  assert.ok(!/keeps one kit/.test(byName.Tactician.kit_note));
});
