#!/usr/bin/env node
/**
 * What the campaign's AI is told about a hero's sheet fields.
 *
 * Chronicle's AI Import shows each preset field's `format` note and refuses a
 * `json_list` field whose text does not parse as a JSON list. A hero's list
 * fields are read by widgets/character-sheet.js as JSON, and a value that is
 * not a list draws as empty, so each one is flagged and its note names the
 * shape the sheet reads. The figures Foundry reports say never to invent one.
 *
 * Run: `node --test tools/test-hero-ai-fields.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preset = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
  .entity_presets.find((p) => p.slug === 'drawsteel-character');
const field = (k) => preset.fields.find((f) => f.key === k) || {};
const sheet = readFileSync(new URL('../widgets/character-sheet.js', import.meta.url), 'utf8');

// Keys the sheet parses as a JSON array and the AI is expected to write as one.
const LISTS = ['skills_json', 'languages_json', 'perks_json', 'features_json', 'titles_json',
  'treasures_json', 'conditions_json', 'kit_details_json', 'abilities_json'];

test('every hero list field the sheet parses is a json_list with a shape note', () => {
  for (const k of LISTS) {
    assert.ok(new RegExp("'" + k + "'").test(sheet), k + ' is read by the character sheet');
    assert.equal(field(k).json_list, true, k);
    assert.match(field(k).format || '', /^A JSON list as text/, k);
  }
});

test('the shape notes name the keys the sheet reads', () => {
  assert.match(field('skills_json').format, /skill ids/);
  assert.match(field('skills_json').format, /handleAnimals/);
  assert.match(field('languages_json').format, /language names/);
  for (const k of ['name', 'description']) assert.match(field('perks_json').format, new RegExp('`' + k + '`'));
  assert.match(field('features_json').format, /`level`/);
  assert.match(field('treasures_json').format, /leveled, trinket, consumable or artifact/);
  assert.match(field('abilities_json').format, /`powerRollChars`/);
  assert.match(field('abilities_json').format, /Leave `tiers` out/);
  assert.match(field('kit_details_json').format, /`meleeDamageT1`/);
});

test('the shapes the notes promise are ones the sheet draws', () => {
  // A skill id the sheet groups, and a language list it reads from a JSON array.
  assert.match(sheet, /'alchemy'.*'handleAnimals'.*'pickLock'/s);
  assert.match(sheet, /function featureOf\(ft\)[\s\S]*typeof ft !== 'string'/, 'a bare name is a valid perk, feature or title');
});

test('figures Foundry reports tell the AI not to invent them', () => {
  for (const k of ['speed', 'stability', 'disengage', 'movement_hover', 'save_threshold', 'potency_weak', 'potency_average', 'potency_strong']) {
    assert.equal(field(k).foundry_writable, false, k + ' is one Foundry reports');
    assert.match(field(k).format || '', /never invent/, k);
  }
});

test('no number or formula is restated in a note', () => {
  for (const k of ['speed', 'stability', 'disengage', 'save_threshold']) assert.doesNotMatch(field(k).format, /\d/, k);
});
