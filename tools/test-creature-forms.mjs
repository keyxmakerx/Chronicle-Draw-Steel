#!/usr/bin/env node
/**
 * A creature's other forms: what a stored form may hold, how it lays over the
 * first form, what the editor saves for one, and who reads which half. A
 * player must only ever read the public halves, and a form reaches them only
 * after the director shows it.
 *
 * Run: `node --test tools/test-creature-forms.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, assertNoInjection } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
globalThis.MonsterEngine = Engine;
globalThis.MonsterParty = require('../widgets/monster-party.js');
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;
const Ed = require('../widgets/monster-builder.js');
globalThis.DrawSteelCreatureEditor = Ed;
const F = S.Forms;

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const XSS = '<img src=x onerror=alert(1)>';
const ART = '0b8a3f1e-1111-4222-8333-444455556666';
const TOKEN = '0b8a3f1e-1111-4222-8333-777788889999';

const BASE = {
  level: 6, organization: 'solo', ev: 72, stamina: 300, speed: 6, stability: 2, size: '1M',
  might: 3, agility: 2, reason: 1, intuition: 2, presence: 4, free_strike: '7 damage', keywords: 'Fey, Humanoid',
  traits: JSON.stringify([{ name: 'Glamour', description: 'Hard to look at.' }]),
  abilities_json: JSON.stringify([
    { name: 'Thorn Lash', type: 'signature', tier1: '7 damage', tier2: '10 damage', tier3: '13 damage' },
    { name: 'Court Command', type: 'maneuver', effect: 'An ally shifts 2.' },
  ]),
  villain_actions_json: '[]',
};

test('clean keeps only what a form may hold', () => {
  assert.equal(F.clean(null), null);
  assert.equal(F.clean({ id: 'Bad Id' }), null);
  assert.equal(F.clean({ id: '../x' }), null);
  const f = F.clean({
    id: 'abc123', name: 'x'.repeat(200), stamina: 'weird', art: 'not-a-media-id', token: TOKEN,
    changes: { speed: 8, stamina: { evil: 1 }, image_path: 'x', book_source: 'x', level: '7' },
    lists: { abilities_json: { drop: ['Thorn Lash'], add: [{ name: 'Swarm' }, null, 3] }, other: { drop: ['x'] } },
  });
  assert.equal(f.name.length, F.NAME_MAX);
  assert.equal(f.stamina, 'carry');
  assert.equal(f.art, '');
  assert.equal(f.token, TOKEN);
  assert.deepEqual(f.changes, { speed: 8, level: '7' });
  assert.deepEqual(Object.keys(f.lists), ['abilities_json']);
  assert.deepEqual(f.lists.abilities_json.add, [{ name: 'Swarm' }]);
  assert.equal(F.clean({ id: 'a', stamina: 'fresh' }).stamina, 'fresh');
  assert.equal(F.clean({ id: 'a' }).name, 'Unnamed form');
});

test('a form lays its changes over the first form and says where each comes from', () => {
  const form = F.clean({
    id: 'unmasked', name: 'Unmasked', changes: { speed: 8, stamina: 120 },
    lists: { abilities_json: { drop: ['Thorn Lash', 'Court Command'], add: [{ name: 'Thorn Lash', type: 'signature', tier1: '9 damage' }, { name: 'Shriek' }] } },
  });
  const v = F.view(BASE, { art: ART, token: TOKEN }, form);
  assert.equal(v.fields.speed, 8);
  assert.equal(v.fields.stamina, 120);
  assert.equal(v.fields.might, 3, 'unchanged figures are borrowed');
  assert.deepEqual(v.changed, { speed: true, stamina: true });
  const abs = JSON.parse(v.fields.abilities_json);
  assert.deepEqual(abs.map((a) => a.name), ['Thorn Lash', 'Shriek'], 'a changed ability keeps its place');
  assert.deepEqual(v.states.a, ['changed', 'new']);
  assert.deepEqual(v.gone.a.map((a) => a.name), ['Court Command']);
  assert.deepEqual(v.states.t, ['base']);
  assert.equal(v.fields.traits, BASE.traits, 'an untouched list stays exactly as stored');
  assert.equal(BASE.speed, 6, 'the first form is never changed');
});

test('a form borrows the first form’s pictures until it has its own', () => {
  const pic = { art: ART, token: TOKEN };
  let v = F.view(BASE, pic, F.clean({ id: 'a' }));
  assert.equal(v.art, ART); assert.equal(v.token, TOKEN);
  v = F.view(BASE, pic, F.clean({ id: 'a', art: TOKEN }));
  assert.equal(v.art, TOKEN);
  assert.equal(v.token, '', 'own art and no token: Foundry crops the art, as a page does');
  v = F.view(BASE, pic, F.clean({ id: 'a', token: ART }));
  assert.equal(v.art, ART); assert.equal(v.token, ART);
});

test('diff saves only what differs, and view gives it back', () => {
  const edited = { ...BASE, speed: 9, keywords: 'Fey, Swarm',
    abilities_json: JSON.stringify([{ name: 'Court Command', effect: 'An ally shifts 2.', type: 'maneuver' }, { name: 'Bite', from_ai: true }]) };
  const d = F.diff(BASE, edited);
  assert.deepEqual(d.changes, { speed: 9, keywords: 'Fey, Swarm' });
  assert.deepEqual(d.lists.abilities_json, { drop: ['Thorn Lash'], add: [{ name: 'Bite', from_ai: true }] }, 'key order and review marks are not a change');
  assert.equal(d.lists.traits, undefined);
  const v = F.view(BASE, {}, F.clean({ id: 'x', changes: d.changes, lists: d.lists }));
  assert.deepEqual(JSON.parse(v.fields.abilities_json).map((a) => a.name), ['Court Command', 'Bite']);
  assert.equal(v.fields.speed, 9);
});

test('an editor opened on a form and saved untouched records no changes', () => {
  const refs = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
  for (const c of load('creatures.json').slice(0, 12)) {
    const base = c.properties;
    const v = F.view(base, {}, F.clean({ id: 'f' }));
    const out = Ed.toSave(Ed.newState('Form 2', v.fields, refs)).fields;
    const d = F.diff(Ed.roundTrip(c.name, base, refs), out);
    assert.deepEqual(d, { changes: {}, lists: {} }, c.slug);
  }
});

test('index reads the order and what players were shown, and nothing else', () => {
  const i = F.index({ gm: { order: ['a', 'b', 'a', 'Bad', 3] }, public: { shown: ['b', '../x'], current: 'b' } });
  assert.deepEqual(i.order, ['a', 'b']);
  assert.deepEqual(i.shown, ['b']);
  assert.equal(i.current, 'b');
  const p = F.index({ public: { shown: ['b'], current: 'zz!' } });
  assert.equal(p.order, null, 'a player has no order');
  assert.equal(p.current, '');
  assert.equal(F.index(null).shown.length, 0);
});

test('summary says what a form changes', () => {
  assert.equal(F.summary(F.clean({ id: 'a' })), 'nothing yet');
  assert.equal(F.summary(F.clean({ id: 'a', changes: { speed: 1 } })), '1 figure');
  assert.equal(F.summary(F.clean({ id: 'a', changes: { speed: 1, size: '2' }, art: ART, lists: { abilities_json: { drop: ['x'] } } })), '2 figures, its art and its abilities');
});

// A panel over a fake server holding system-state documents by key.
function fakePanel(isGm, store) {
  const calls = [];
  const docs = store;
  globalThis.Chronicle.apiFetch = (url, opts) => {
    calls.push({ url, opts });
    const key = /system-state\/drawsteel\/([a-z0-9-]+)$/.exec(url);
    if (key) {
      const d = docs[key[1]] || { gm: {}, public: {} };
      if (opts && opts.method === 'PUT') {
        const body = JSON.parse(opts.body);
        docs[key[1]] = { gm: body.gm !== undefined ? body.gm : d.gm, public: body.public !== undefined ? body.public : d.public };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(docs[key[1]]) });
      }
      const out = isGm ? d : { public: d.public };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(out))) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  const el = { innerHTML: '', hidden: false, className: '', ownerDocument: globalThis.document, addEventListener() {}, querySelector() { return null; } };
  const p = new S.Panel(el, { campaignId: 'c1', entityId: 'e1', isGm });
  p.entity = { name: 'The Hollow Queen', fields_data: BASE };
  return { p, el, calls, docs };
}

const SECRET = { id: 'swarm', name: 'The Swarm', changes: { stamina: 120 }, lists: {} };
const SHOWN = { id: 'unmasked', name: 'Unmasked', changes: { speed: 8 }, lists: {} };
const storeWith = () => ({
  forms: { gm: { v: 1, order: ['unmasked', 'swarm'] }, public: { v: 1, shown: ['unmasked'], current: 'unmasked' } },
  'form-unmasked': { gm: SHOWN, public: SHOWN },
  'form-swarm': { gm: SECRET, public: {} },
});

test('a player reads only public halves and sees only the forms shown to them', async () => {
  const { p, el, calls } = fakePanel(false, storeWith());
  await p.loadForms();
  assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['forms', 'form-unmasked']);
  assert.deepEqual(p.forms.list.map((f) => f.id), ['unmasked']);
  assert.equal(p.forms.tab, 'unmasked', 'a player opens on the current form');
  assert.ok(el.innerHTML.includes('Unmasked'));
  assert.ok(!el.innerHTML.includes('The Swarm'));
  assert.ok(!el.innerHTML.includes('Show to players'), 'no director controls');
  assert.ok(!el.innerHTML.includes('Add a form'));
});

test('the director sees every form, with what players have not seen marked', async () => {
  const { p, el } = fakePanel(true, storeWith());
  await p.loadForms();
  assert.deepEqual(p.forms.list.map((f) => f.id), ['unmasked', 'swarm']);
  assert.equal(p.forms.tab, '', 'the director opens on the first form');
  assert.ok(el.innerHTML.includes('Add a form'));
  assert.equal((el.innerHTML.match(/not shown to players/g) || []).length, 1);
  p.pickForm('swarm');
  assert.ok(el.innerHTML.includes('Show to players'));
  assert.ok(el.innerHTML.includes('Changed in this form'));
  assert.ok(el.innerHTML.includes('From The Hollow Queen'));
  assert.ok(el.innerHTML.includes('Edit form'));
  assert.ok(!el.innerHTML.includes('Publish'), 'publishing is for the whole creature, on its first form');
});

test('showing a form writes its public copy before the index lists it, and keeps the current form', async () => {
  const { p, calls, docs } = fakePanel(true, storeWith());
  await p.loadForms();
  p.pickForm('swarm');
  calls.length = 0;
  await new Promise((r) => { p.toggleShown(); setTimeout(r, 20); });
  const puts = calls.filter((c) => c.opts && c.opts.method === 'PUT').map((c) => c.url.split('/').pop());
  assert.deepEqual(puts, ['form-swarm', 'forms']);
  assert.equal(docs['form-swarm'].public.name, 'The Swarm');
  assert.deepEqual(docs.forms.public.shown, ['unmasked', 'swarm']);
  assert.equal(docs.forms.public.current, 'unmasked');
  calls.length = 0;
  await new Promise((r) => { p.toggleShown(); setTimeout(r, 20); });
  const back = calls.filter((c) => c.opts && c.opts.method === 'PUT').map((c) => c.url.split('/').pop());
  assert.deepEqual(back, ['forms', 'form-swarm'], 'hiding takes it off the index first');
  assert.deepEqual(docs['form-swarm'].public, {});
  assert.deepEqual(docs.forms.public.shown, ['unmasked']);
});

test('removing a form takes it off the index and clears both halves', async () => {
  const { p, docs } = fakePanel(true, storeWith());
  await p.loadForms();
  p.pickForm('unmasked');
  await new Promise((r) => { p.removeForm(); setTimeout(r, 20); });
  assert.deepEqual(docs.forms.gm.order, ['swarm']);
  assert.deepEqual(docs.forms.public.shown, []);
  assert.equal(docs.forms.public.current, '', 'a removed current form is no longer current');
  assert.deepEqual(docs['form-unmasked'], { gm: {}, public: {} });
  assert.equal(p.forms.tab, '');
});

test('"Use the first form’s" drops one change and keeps a shown form’s copy in step', async () => {
  const { p, docs } = fakePanel(true, storeWith());
  await p.loadForms();
  p.pickForm('unmasked');
  await p.resetFigure('speed');
  assert.deepEqual(docs['form-unmasked'].gm.changes, {});
  assert.deepEqual(docs['form-unmasked'].public.changes, {});
});

test('a form too big for the page’s state is refused with a reason', async () => {
  const { p } = fakePanel(true, {});
  const big = F.clean({ id: 'big', lists: { abilities_json: { add: Array.from({ length: 50 }, (_, i) => ({ name: 'A' + i, effect: 'x'.repeat(300) })) } } });
  await assert.rejects(p.writeForm(big, false), (e) => e.user === true && /too big/.test(e.message));
});

test('form names and changes are escaped everywhere they are drawn', async () => {
  const bad = { id: 'bad', name: XSS, changes: { keywords: XSS, speed: XSS }, lists: { abilities_json: { add: [{ name: XSS, effect: XSS }] } } };
  for (const isGm of [true, false]) {
    const { p, el } = fakePanel(isGm, {
      forms: { gm: { order: ['bad'] }, public: { shown: ['bad'] } },
      'form-bad': { gm: bad, public: bad },
    });
    await p.loadForms();
    p.pickForm('bad');
    // The generic token is the package's own drawing, not the form's text.
    assertNoInjection(assert, el.innerHTML.split(S.GENERIC_TOKEN).join(''), isGm ? 'director' : 'player');
    assert.ok(el.innerHTML.includes('&lt;img'), 'the name is drawn, escaped');
  }
});
