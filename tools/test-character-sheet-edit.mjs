#!/usr/bin/env node
/**
 * The sheet's inline editors: backstory, bought ancestry traits, skills,
 * languages and perks. Pins the stored formats (JSON arrays of strings), the
 * budget rule shared with Chronicle's hero creator, who sees which control,
 * and that Foundry keeps ownership of the lists when a world is linked.
 *
 * Run: `node --test tools/test-character-sheet-edit.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');
const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));

const REFS = {
  'ancestries.json': load('ancestries.json'), 'skills.json': load('skills.json'), 'perks.json': load('perks.json'),
  'careers.json': load('careers.json'), 'cultures.json': load('cultures.json'), 'kits.json': load('kits.json')
};
const HERO = (fields, extra) => Object.assign({
  name: 'Bren', campaignId: 'c1', entityId: 'e1', canEditIdentity: true, isOwner: true, foundryLinked: false, fields
}, extra || {});

// A form stand-in: collectEditor only asks for checked options and two inputs.
const form = (opts) => ({
  querySelectorAll: (sel) => {
    const kind = (sel.match(/data-cs-opt="(\w+)"/) || [])[1];
    return (opts.boxes || []).filter((b) => b.kind === kind).map((b) => ({ value: b.value, checked: b.checked !== false }));
  },
  querySelector: (sel) => {
    if (/data-cs-ed-ta/.test(sel)) return { value: opts.text || '' };
    if (/data-cs-ed-lang/.test(sel)) return { value: opts.lang || '' };
    const about = (sel.match(/data-cs-ed-about="(\w+)"/) || [])[1];
    if (about) return opts.about && about in opts.about ? { value: opts.about[about] } : { value: '' };
    return null;
  }
});

test.beforeEach(() => cs.setEditRefs(REFS, null));

test('ancestryPurchase follows the hero creator: the first *_points budget and the first {name,cost} list', () => {
  const human = cs.ancestryPurchase(REFS['ancestries.json'].find((a) => a.name === 'Human'));
  assert.equal(human.budget, 3);
  assert.ok(human.traits.length > 0 && human.traits.every((t) => typeof t.cost === 'number'));
  assert.equal(cs.ancestryPurchase({ properties: { size: '1M' } }), null, 'no budget, nothing to buy');
  assert.equal(cs.ancestryPurchase({ properties: { ancestry_points: 2, signature_traits: [{ name: 'A' }] } }), null, 'a list without costs is not a purchase list');
  const mixed = cs.ancestryPurchase({ properties: { b_points: 4, a_list: [{ name: 'A', cost: 1 }, { name: 'B' }], c_list: [{ name: 'C', cost: 2 }] } });
  assert.deepEqual(mixed.traits.map((t) => t.name), ['C'], 'a list is used only when every item has a cost');
});

test('traits: shown only to an editor, under the ancestry, with the running total', () => {
  const hero = HERO({ ancestry: 'Human', ancestry_choices_json: JSON.stringify(['Perseverance']) });
  const html = cs.pTraits(hero);
  assert.ok(/data-cs-ed-open="traits"/.test(html) && /Change traits/.test(html) && /Perseverance/.test(html));
  assert.match(cs.pTraits(HERO({ ancestry: 'Human' })), /Choose traits/);
  assert.equal(cs.pTraits(HERO({ ancestry: 'Human' }, { canEditIdentity: false })), '');
  assert.equal(cs.pTraits(HERO({ ancestry: 'Nobody' })), '', 'no list, nothing shown');
  assert.equal(cs.pTraits(HERO({})), '');
  const ed = cs.edTraitsHtml(HERO({ ancestry: 'Human' }));
  assert.match(ed, /0 of 3 points/);
  assert.match(cs.pIdentityInner(hero), /Ancestry traits/);
});

test('traits: saves a JSON array of names and refuses to go over budget', () => {
  const hero = HERO({ ancestry: 'Human' });
  const buy = cs.ancestryPurchase(REFS['ancestries.json'].find((a) => a.name === 'Human'));
  const cheap = buy.traits[0];
  const ok = cs.collectEditor('traits', form({ boxes: [{ kind: 'traits', value: cheap.name }] }), hero);
  assert.deepEqual(JSON.parse(ok.patch.ancestry_choices_json), [cheap.name]);
  const all = buy.traits.map((t) => ({ kind: 'traits', value: t.name }));
  const over = cs.collectEditor('traits', form({ boxes: all }), HERO({ ancestry: 'Human' }));
  const total = buy.traits.reduce((n, t) => n + t.cost, 0);
  if (total > buy.budget) assert.ok(over.problem && /over budget/.test(over.problem) && !over.patch);
});

test('backstory: a quiet control for an editor, plain text saved as `backstory`', () => {
  const none = cs.pNotesPanel(HERO({}));
  assert.match(none, /data-cs-ed-open="backstory"/);
  assert.match(none, /Write your backstory/);
  assert.match(cs.pNotesPanel(HERO({ backstory: 'A veteran.' })), />Edit</);
  assert.ok(!/data-cs-ed-open/.test(cs.pNotesPanel(HERO({ backstory: 'x' }, { canEditIdentity: false }))));
  const ed = cs.edBackstoryHtml(HERO({ backstory: 'Born <b>here</b> & raised' }));
  assert.ok(/<textarea[^>]*maxlength="20000"/.test(ed));
  assert.ok(!/<b>here/.test(ed), 'prefill never injects markup');
  assert.deepEqual(cs.collectEditor('backstory', form({ text: 'New story' }), HERO({})).patch, { backstory: 'New story' });
  assert.ok(cs.collectEditor('backstory', form({ text: 'x'.repeat(20001) }), HERO({})).problem);
});

test('about: pronouns, gender and looks are optional, shown in the Story panel, and editable any time', () => {
  const none = cs.pNotesPanel(HERO({}));
  assert.match(none, /data-cs-ed-open="about"/);
  assert.match(none, /Add pronouns, gender and looks/);
  const some = cs.pNotesPanel(HERO({ pronouns: 'she/her', gender: '', appearance: 'Tall <b>braid</b>' }));
  assert.match(some, /she\/her/);
  assert.ok(!/ · /.test(some.split('About')[1].split('</p>')[0]), 'an empty gender adds no separator');
  assert.ok(!/<b>braid/.test(some), 'looks are shown as text, never markup');
  assert.match(some, />Edit</);
  const body = cs.pAbout(HERO({ age: '31', height: 5.9, height_units: 'feet', weight: 185, weight_units: 'pounds' }, { canEditIdentity: false }));
  assert.match(body, /Age 31 · 5\.9 ft · 185 lbs/, 'age, height and weight synced from Foundry show in About');
  assert.ok(!/<script/.test(cs.pAbout(HERO({ age: '<script>' }, { canEditIdentity: false }))), 'age is escaped');
  assert.equal(cs.pAbout(HERO({}, { canEditIdentity: false })), '', 'nothing to show and nothing to edit: no group');
  assert.ok(!/data-cs-ed-open="about"/.test(cs.pAbout(HERO({ pronouns: 'they/them' }, { canEditIdentity: false }))));
  const ed = cs.edAboutHtml(HERO({ pronouns: 'he/him', gender: '"x"' }));
  assert.ok(/value="he\/him"/.test(ed) && /value="&quot;x&quot;"/.test(ed));
  assert.deepEqual(cs.collectEditor('about', form({ about: { pronouns: ' they/them ', gender: '', appearance: 'Short.' } }), HERO({})).patch,
    { pronouns: 'they/them', gender: '', appearance: 'Short.' });
  assert.ok(cs.collectEditor('about', form({ about: { pronouns: 'x'.repeat(61) } }), HERO({})).problem);
});

test('skills and languages: stored as JSON arrays of strings, skills by id', () => {
  const hero = HERO({ skills_json: JSON.stringify(['endurance']), languages_json: JSON.stringify(['Common']) });
  const ed = cs.edSkillsHtml(hero);
  assert.ok(/value="endurance" checked/.test(ed) && /value="handleAnimals"/.test(ed) && /value="Common, ?"|value="Common"/.test(ed));
  const got = cs.collectEditor('skills', form({ boxes: [{ kind: 'skills', value: 'lie' }, { kind: 'skills', value: 'sneak' }], lang: 'Common, Anvilic,common' }), hero);
  assert.equal(got.patch.skills_json, '["lie","sneak"]');
  assert.equal(got.patch.languages_json, '["Common","Anvilic"]', 'duplicates dropped case-insensitively');
  const many = Array.from({ length: 41 }, (_, i) => ({ kind: 'skills', value: 's' + i }));
  assert.ok(cs.collectEditor('skills', form({ boxes: many }), hero).problem);
  assert.ok(cs.collectEditor('skills', form({ lang: 'x'.repeat(65) }), hero).problem);
});

test('skills, languages and perks are read-only while a Foundry world is linked', () => {
  const linked = HERO({}, { foundryLinked: true });
  assert.ok(!/data-cs-ed-open/.test(cs.pSkillsPanel(linked)) && !/data-cs-ed-open/.test(cs.pFeaturesPanel(linked)));
  const free = HERO({});
  assert.match(cs.pSkillsPanel(free), /data-cs-ed-open="skills"/);
  assert.match(cs.pFeaturesPanel(free), /data-cs-ed-open="perks"/);
  assert.ok(!cs.canEditLists(HERO({}, { canEditIdentity: false })));
  assert.ok(!/data-cs-ed-open="(skills|perks)"/.test(cs.pSkillsPanel(HERO({}, { canEditIdentity: false })) + cs.pFeaturesPanel(HERO({}, { canEditIdentity: false }))));
});

test('grants: a career, culture and kit show their own text and suggested picks', () => {
  const hero = HERO({ career: 'Agent', culture: 'Pirate crew', kit: 'Arcane Archer' });
  const rows = cs.grantRows(hero, 'skills');
  assert.deepEqual(rows.map((r) => r.label), ['Culture', 'Career']);
  assert.deepEqual(rows.find((r) => r.label === 'Culture').quick, ['Navigate', 'Jump', 'Sneak']);
  const career = rows.find((r) => r.label === 'Career');
  assert.deepEqual(career.quick, ['Disguise', 'Lie', 'Sneak']);
  assert.match(cs.edSkillsHtml(hero), /Use the suggested picks/);
  assert.deepEqual(cs.grantRows(hero, 'perks').map((r) => r.quick[0]), ['Forgettable Face']);
  assert.match(cs.edPerksHtml(hero), /Forgettable Face/);
  assert.deepEqual(cs.grantRows(hero, 'languages').map((r) => r.text), ['Caelian, plus one language that fits the culture', 'Two languages']);
});

test('every suggested skill and perk in the data names something the editors can tick', () => {
  const skills = REFS['skills.json'], perks = REFS['perks.json'].map((p) => p.name.toLowerCase());
  const miss = [];
  for (const file of ['careers.json', 'cultures.json']) {
    for (const e of REFS[file]) {
      const g = cs.grantsFor(e);
      g.skills.quick.forEach((n) => { if (!cs.skillSlug(n, skills)) miss.push(e.name + ': skill ' + n); });
      g.perks.quick.forEach((n) => { if (!perks.includes(n.toLowerCase())) miss.push(e.name + ': perk ' + n); });
    }
  }
  assert.deepEqual(miss, []);
});

test('a perk stored as a bare name shows its rules from the perk list', () => {
  cs.setEditRefs(REFS, Object.fromEntries(REFS['perks.json'].map((p) => [p.name.toLowerCase(), p])));
  const ft = cs.featureOf('Arcane Trick');
  assert.equal(ft.name, 'Arcane Trick');
  assert.ok(ft.description.length > 20);
  const panel = cs.pFeaturesPanel(HERO({ perks_json: JSON.stringify(['Arcane Trick', 'Homebrew Perk']) }));
  assert.ok(/Arcane Trick/.test(panel) && /Homebrew Perk/.test(panel) && /<details/.test(panel));
  assert.deepEqual(cs.featureOf({ name: 'Obj' }), { name: 'Obj' }, 'Foundry objects pass through');
});

test('the editors escape everything they print', () => {
  const X = '"><img src=x onerror=alert(1)>';
  const hero = HERO({ ancestry: 'Human', career: X, perks_json: JSON.stringify([X]), skills_json: JSON.stringify([X]), languages_json: JSON.stringify([X]), backstory: X });
  const html = cs.edSkillsHtml(hero) + cs.edPerksHtml(hero) + cs.edBackstoryHtml(hero) + cs.pTraits(hero) + cs.pNotesPanel(hero);
  assert.ok(!/<img src=x/.test(html));
});

test('rule lines: a kept pick the rules dropped and a waiting request show under the identity, escaped', () => {
  const breaks = [{ fieldKey: 'class', value: 'Fury', kind: 'not_offered', reason: 'No <b>rage</b>' }, { fieldKey: 'culture', value: 'Nomad', kind: 'off_list' }];
  const waiting = [{ id: 3, fieldKey: 'kit', entryName: 'Battlemind' }];
  const hero = HERO({ ancestry: 'Human', class: 'Fury' }, { choiceBreaks: breaks, choiceWaiting: waiting });
  const html = cs.choiceNotesHtml(hero);
  assert.match(html, /Fury isn’t offered any more\. You keep it; a new pick must be on the list\. Your Director says: “No &lt;b&gt;rage&lt;\/b&gt;”/);
  assert.match(html, /Nomad isn’t on the culture list any more\./);
  assert.match(html, /Battlemind is waiting for your Director, for kit\./);
  assert.ok(cs.pIdentityInner(hero).includes('sh-rules'), 'the paper identity carries them');
  assert.equal(cs.choiceNotesHtml(HERO({})), '', 'nothing to say, nothing drawn');
  const evil = cs.choiceNotesHtml(HERO({}, { choiceWaiting: [{ fieldKey: 'class', entryName: '<img src=x onerror=1>' }] }));
  assert.ok(!/<img/.test(evil));
});

test('fetchChoiceRules reads the fields route and never errors the sheet', async () => {
  const calls = [];
  const was = globalThis.window.Chronicle.apiFetch;
  const ok = (body) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  globalThis.window.Chronicle.apiFetch = (u) => { calls.push(u); return ok({ choice_breaks: [{ fieldKey: 'class', value: 'Fury' }], choice_waiting: [{ fieldKey: 'kit', entryName: 'X' }] })(); };
  try {
    const got = await cs.fetchChoiceRules('c1', 'e1');
    assert.equal(calls[0], '/campaigns/c1/entities/e1/fields');
    assert.equal(got.breaks.length, 1);
    assert.equal(got.waiting.length, 1);
    globalThis.window.Chronicle.apiFetch = () => Promise.resolve({ ok: false });
    assert.deepEqual(await cs.fetchChoiceRules('c1', 'e1'), { breaks: [], waiting: [] });
    globalThis.window.Chronicle.apiFetch = () => Promise.reject(new Error('down'));
    assert.deepEqual(await cs.fetchChoiceRules('c1', 'e1'), { breaks: [], waiting: [] });
  } finally { globalThis.window.Chronicle.apiFetch = was; }
});
