#!/usr/bin/env node
/**
 * The shared creature stat block (widgets/statblock-renderer.js): escaping,
 * the two stored shapes it reads, the provenance marks, the tier odds, and the
 * style injection that used to wipe itself.
 *
 * Run: `node --test tools/test-statblock-renderer.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl, FakeRef, assertNoInjection } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
const S = require('../widgets/statblock-renderer.js');
globalThis.window = { Chronicle: makeChronicle() };
const CS = require('../widgets/character-sheet.js');

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const REFS = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
const XSS = '<img src=x onerror=alert(document.cookie)>';

const goblin = (extra) => Object.assign({
  level: 2, organization: 'horde', role: 'harrier', ev: 4, size: '1S', stamina: 10, winded: 5, speed: 6,
  stability: 0, might: 0, agility: 2, reason: 0, intuition: 0, presence: -1, free_strike: '2 damage',
  keywords: 'Goblin, Humanoid', faction: 'Bloodfang', immunities: '', traits: '', villain_actions_json: '',
  abilities_json: JSON.stringify([{ name: 'Spear', type: 'signature', keywords: ['Melee', 'Strike'], distance: 'Melee 1',
    target: 'One creature', power_roll: '2d10 + 2', tier1: '3 damage', tier2: '5 damage', tier3: '7 damage', effect: 'It shifts 1.' }])
}, extra || {});

test('every user-authored field is escaped', () => {
  const html = S.html(XSS, goblin({
    size: XSS, keywords: XSS, faction: XSS, immunities: XSS, free_strike: XSS, organization: XSS, role: XSS,
    traits: JSON.stringify([{ name: XSS, description: XSS }]),
    abilities_json: JSON.stringify([{ name: XSS, type: XSS, keywords: [XSS], distance: XSS, target: XSS, power_roll: XSS, tier1: XSS, trigger: XSS, effect: XSS, spend_vp: '1' }]),
    villain_actions_json: JSON.stringify([{ name: XSS, order: XSS, effect: XSS }])
  }), { ref: new FakeRef(), refs: REFS });
  assertNoInjection(assert, html, 'stat block');
  assert.match(html, /&lt;img/);
});

test('a non-numeric spend_vp draws no Malice line', () => {
  const html = S.html('G', goblin({ abilities_json: JSON.stringify([{ name: 'Bite', spend_vp: '1"><img src=x onerror=alert(1)>' }]) }));
  assertNoInjection(assert, html, 'spend_vp');
  assert.ok(!/Malice/.test(html));
});

test('it reads an entity’s fields and a bestiary stat block the same way', () => {
  const a = S.normalize(goblin());
  const b = S.normalize({ level: 2, organization: 'Horde', role: 'Harrier', keywords: ['Goblin', 'Humanoid'],
    abilities: [{ name: 'Spear' }], traits: [{ name: 'Sneaky', description: 'x' }], villain_actions: [] });
  assert.deepEqual(a.keywords, b.keywords);
  assert.equal(b.organization, 'horde');
  assert.equal(a.abilities[0].name, b.abilities[0].name);
  assert.equal(b.traits[0].name, 'Sneaky');
});

test('empty strings read as empty lists, and an unset figure stays unset', () => {
  const c = S.normalize({ level: 1, immunities: '', keywords: '', ev: '', stamina: null });
  assert.deepEqual(c.immunities, []);
  assert.deepEqual(c.keywords, []);
  assert.equal(c.ev, null);
  assert.match(S.html('X', c), /EV —/);
});

test('plain-text traits read as one named trait', () => {
  assert.deepEqual(S.normalize({ traits: 'Undead: Immune to poison.' }).traits, [{ name: 'Undead', description: 'Immune to poison.' }]);
  assert.deepEqual(S.normalize({ traits: 'Just prose here' }).traits, [{ name: '', description: 'Just prose here' }]);
});

test('legacy one-letter sizes read in the multi-hex notation', () => {
  assert.equal(S.normalize({ size: 'L' }).size, '1L');
  assert.equal(S.normalize({ size: 'H' }).size, '2');
});

test('a figure matching its published formula gets a tick', () => {
  // Level 2 horde: EV ((2 x 2) + 4) x 0.5 = 4.
  const html = S.html('G', goblin(), { refs: REFS });
  assert.match(html, /EV 4<span class="sbx-mark is-formula"/);
});

test('a figure the director changed gets a pen that names the formula’s number', () => {
  const pr = S.provenance(S.normalize(goblin({ ev: 9 })), REFS);
  assert.equal(pr.ev.state, 'changed');
  assert.match(S.html('G', goblin({ ev: 9 }), { refs: REFS }), /The published formula gives 4/);
});

test('a figure no published formula covers is the director’s own', () => {
  const pr = S.provenance(S.normalize({ level: 1, organization: 'swarm', role: 'harrier', ev: 4, stamina: 26 }), REFS);
  assert.equal(pr.ev.state, 'own');
  assert.equal(pr.stamina.state, 'own');
});

test('without templates there is nothing to measure against, so no marks', () => {
  const html = S.html('G', goblin());
  assert.ok(!/sbx-mark/.test(html), 'no tick or pen may imply a check that never ran');
});

test('tier odds match the character sheet’s for every bonus', () => {
  for (let m = -3; m <= 7; m++) assert.deepEqual(S.tierOdds(m), CS.tierOdds(m), 'bonus ' + m);
});

test('a power roll’s bonus is read when it is a number, and only then', () => {
  assert.equal(S.rollBonus('2d10 + 3'), 3);
  assert.equal(S.rollBonus('+2'), 2);
  assert.equal(S.rollBonus('2d10 − 1'), -1);
  assert.equal(S.rollBonus('Might vs. Agility'), null);
  assert.match(S.html('G', goblin()), /T1 \d+% · T2 \d+% · T3 \d+%/);
});

test('ability keywords carry their glossary definition', () => {
  const ref = new FakeRef();
  ref.getEntry = (k) => (k === 'Strike' ? { description: 'A strike "hits".' } : null);
  const html = S.html('G', goblin(), { ref });
  assert.match(html, /data-ref-tip="A strike &quot;hits&quot;\."/);
});

test('compact mode stops after the figures, for a hover card', () => {
  const html = S.html('G', goblin(), { compact: true });
  assert.match(html, /sbx--compact/);
  assert.ok(!/Spear/.test(html));
});

test('styles go into <head> once, never into the mount element', () => {
  const head = makeEl();
  let n = 0;
  const doc = { head, querySelector: () => (n ? {} : null), createElement: () => { n++; return makeEl(); } };
  const el = makeEl();
  S.injectStyles(doc);
  S.injectStyles(doc);
  assert.equal(head.children.length, 1, 'injected exactly once');
  assert.equal(el.children.length, 0, 'the mount element holds no style a redraw could wipe');
  assert.match(head.children[0].textContent, /\.sbx\{/);
});

test('the widget source never inserts its style into the element it redraws', () => {
  const src = readFileSync(new URL('../widgets/statblock-renderer.js', import.meta.url), 'utf8');
  assert.ok(!/this\.el\.insertBefore\(style/.test(src));
});

test('marked-up tier text gets one tooltip per term and no broken markup', () => {
  const Ref = require('../widgets/reference-renderer.js');
  const ref = new Ref('', 'c1');
  ref._glossary = {};
  load('rules-glossary.json').forEach((e) => { ref._glossary[e.slug] = e; });
  ref._loaded = true;
  const html = S.html('G', goblin({ abilities_json: JSON.stringify([{ name: 'Shot', tier3: '7 damage; {@condition bleeding} (EoT)' }]) }), { ref });
  const tier = html.slice(html.indexOf('7 damage'), html.indexOf('(EoT)') + 5);
  assert.equal((tier.match(/class="ds-ref/g) || []).length, 1, tier);
  assert.ok(!/data-ref-tip="[^"]*<span/.test(html), 'no tooltip span inside another tooltip’s attribute');
  const plain = S.html('G', goblin({ abilities_json: JSON.stringify([{ name: 'Shot', tier3: '7 damage; bleeding (EoT)' }]) }), { ref });
  assert.match(plain, /class="ds-ref ds-ref--condition"[^>]*>bleeding<\/span>/, 'plain text still lights bare condition names');
});

test('saved fields keep keywords as comma text and read back the same', () => {
  const f = S.toFields(S.normalize(goblin()));
  assert.equal(f.keywords, 'Goblin, Humanoid');
  assert.deepEqual(S.normalize(f).keywords, ['Goblin', 'Humanoid']);
  assert.equal(S.normalize(f).abilities[0].name, 'Spear');
});

test('an empty figure gets no mark: the director never set it', () => {
  const pr = S.provenance(S.normalize(goblin({ ev: '' })), REFS);
  assert.equal(pr.ev.state, null);
  assert.ok(!/EV —<span class="sbx-mark/.test(S.html('G', goblin({ ev: '' }), { refs: REFS })));
});
