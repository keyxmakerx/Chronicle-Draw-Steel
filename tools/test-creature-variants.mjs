#!/usr/bin/env node
/**
 * Variants: a campaign's own homebrew recipes read off a sample
 * creature, applied to any creature as a linked page that follows its
 * original. No variant rule ships in this package; every recipe here is the
 * director's. Players never read the `variant` document.
 *
 * Run: `node --test tools/test-creature-variants.mjs`
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
const V = S.Variants;

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const refs = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
const XSS = '<img src=x onerror=alert(1)>';

const HOUND = Ed.roundTrip('Ashen Hound', {
  level: 3, organization: 'elite', role: 'harrier', might: 1, agility: 3, reason: 2, intuition: 1, presence: 0,
  speed: 7, size: '1M', keywords: 'Animal, Fey',
  traits: JSON.stringify([{ name: 'Pack Hunter', description: 'Edge when an ally is adjacent.' }]),
  abilities_json: JSON.stringify([{ name: 'Bite', type: 'signature', tier1: '5 damage', tier2: '8 damage', tier3: '11 damage' }]),
}, refs);
const formula = (fields) => S.provenance(S.normalize(fields), refs);

// The Remnant the campaign AI described: one organization step down, Reason
// down 3, an Echo trait. Read off the hound, as a director would make it.
const REMNANT = V.stepsFrom(HOUND, Ed.roundTrip('x', Object.assign({}, HOUND, {
  organization: 'platoon', reason: -1, keywords: 'Animal, Fey, Undead',
  traits: JSON.stringify([{ name: 'Pack Hunter', description: 'Edge when an ally is adjacent.' }, { name: 'Echo', description: 'Something of the original lingers.' }]),
}), refs));
const STRONG = V.stepsFrom(HOUND, Ed.roundTrip('x', Object.assign({}, HOUND, { might: 3 }), refs));

test('a recipe is read off what the director changed on the sample', () => {
  assert.deepEqual(REMNANT.changes.organization, { mode: 'step', by: -1, to: 'platoon' });
  assert.deepEqual(REMNANT.changes.reason, { mode: 'by', by: -3, to: -1 });
  assert.deepEqual(REMNANT.changes.keywords, { mode: 'words', add: ['Undead'], drop: [] });
  assert.deepEqual(REMNANT.lists.traits.add.map((t) => t.name), ['Echo']);
  for (const k of V.FORMULA) assert.ok(!(k in REMNANT.changes), k + ' is the formula’s, never a step');
  assert.deepEqual(V.describe(REMNANT).map((r) => r.what + ' ' + r.text), [
    'Organization 1 step down', 'Keywords adds Undead', 'Reason down 3', 'Trait adds Echo',
  ]);
});

test('steps work on any creature, and a ladder never runs off its end', () => {
  const solo = V.apply({ organization: 'solo', reason: 4, size: '1T' }, V.cleanSteps({ changes: {
    organization: { mode: 'step', by: -1 }, reason: { mode: 'by', by: -3 }, size: { mode: 'step', by: -2 } } }));
  assert.equal(solo.organization, 'elite');
  assert.equal(solo.reason, 1);
  assert.equal(solo.size, '1T', 'already the smallest');
  assert.equal(V.apply({ organization: 'leader' }, REMNANT).organization, 'platoon', 'a leader ranks with elite');
  assert.equal(V.apply({ organization: 'swarm' }, REMNANT).organization, 'swarm', 'off the ladder: left alone');
  assert.equal(V.apply({ reason: '' }, REMNANT).reason, '', 'nothing to move: left alone');
  assert.equal(V.apply({ keywords: 'undead, Animal' }, REMNANT).keywords, 'undead, Animal', 'no word twice');
});

test('a relative step can be fixed to the sample’s value and freed again', () => {
  const fixed = V.fixed(REMNANT.changes.organization);
  assert.equal(fixed.mode, 'set');
  assert.equal(fixed.to, 'platoon');
  const kept = V.cleanSteps({ changes: { organization: fixed } });
  assert.deepEqual(kept.changes.organization.was, { mode: 'step', by: -1, to: 'platoon' });
  assert.equal(V.fixed(REMNANT.changes.keywords), null, 'words have nothing to fix');
});

test('stored recipes and links are read defensively', () => {
  const r = V.read({
    recipe: { name: XSS, part: 'addon', label: '', sample: '../x', steps: { changes: {
      ev: { mode: 'set', to: 99 }, reason: { mode: 'by', by: 'x' }, speed: { mode: 'by', by: 2 }, role: { mode: 'eval', to: 1 },
      organization: { mode: 'set', to: { evil: 1 } }, level: { mode: 'by', by: 0 } } } },
    follow: { of: 'e1', parts: ['p1', 'p1', '../p', 7], base: 'nope' },
    children: ['k1', 'k1', '<x>'],
  });
  assert.equal(r.recipe.part, 'base', 'an add-on with no name is no add-on');
  assert.equal(r.recipe.sample, '');
  assert.deepEqual(r.recipe.steps.changes, { speed: { mode: 'by', by: 2, to: null } });
  assert.deepEqual(r.follow.parts, ['p1']);
  assert.deepEqual(r.follow.base, {});
  assert.deepEqual(r.children, ['k1']);
  assert.equal(V.read(null).recipe, null);
  assert.equal(V.read({ follow: { of: 'a b' } }).follow, null);
});

test('a variant’s figures follow the published formulas for what the recipe made it', () => {
  const m = V.materialize(Ed, HOUND, [{ steps: REMNANT }], {}, null, refs);
  assert.equal(m.fields.organization, 'platoon');
  assert.equal(m.fields.reason, -1);
  const pr = formula(m.fields);
  for (const k of ['ev', 'stamina']) assert.equal(pr[k].state, 'formula', k + ' is the platoon’s formula, not the elite’s');
  assert.notEqual(m.fields.ev, HOUND.ev);
  const both = V.materialize(Ed, HOUND, [{ steps: REMNANT }, { steps: STRONG }], {}, null, refs);
  assert.equal(both.fields.might, 3, 'add-ons stack on the recipe');
  assert.equal(both.fields.reason, -1);
});

test('the original’s later edits reach a variant, and the director’s own changes survive', () => {
  const first = V.materialize(Ed, HOUND, [{ steps: REMNANT }], {}, null, refs);
  const page = Object.assign({}, first.fields, { speed: 10, token_image: 'mine', stamina_current: 4 });
  const grown = Ed.roundTrip('Ashen Hound', Object.assign({}, HOUND, { level: 5, agility: 4 }), refs);
  const next = V.materialize(Ed, grown, [{ steps: REMNANT }], page, first.base, refs);
  assert.equal(next.fields.level, 5, 'from the original');
  assert.equal(next.fields.agility, 4, 'from the original');
  assert.equal(next.fields.speed, 10, 'the director’s own');
  assert.equal(next.fields.ev, formula(next.fields).ev.value, 'EV followed the new level');
  assert.ok(!('token_image' in next.fields) && !('stamina_current' in next.fields), 'the page’s own keys are never touched');
  assert.deepEqual(Object.keys(next.mine.changes), ['speed']);
  assert.ok(!V.stale(Object.assign({}, page, next.fields), next.fields));
});

test('a level the director changes on the variant keeps its formula figures following', () => {
  const first = V.materialize(Ed, HOUND, [{ steps: REMNANT }], {}, null, refs);
  const edited = Ed.roundTrip('x', Object.assign({}, first.fields, { level: 6 }), refs);
  const next = V.materialize(Ed, HOUND, [{ steps: REMNANT }], edited, first.base, refs);
  assert.equal(next.fields.level, 6);
  assert.ok(!('ev' in next.mine.changes) && !('stamina' in next.mine.changes));
  assert.equal(next.fields.stamina, formula(next.fields).stamina.value);
});

test('where each figure comes from', () => {
  const m = V.materialize(Ed, HOUND, [{ steps: REMNANT }], {}, null, refs);
  const page = Object.assign({}, m.fields, { speed: 9 });
  const src = Object.fromEntries(V.sources(HOUND, m.base, page, [{ steps: REMNANT }]).map((r) => [r.key, r]));
  assert.equal(src.organization.src, 'recipe');
  assert.equal(src.organization.was, 'elite');
  assert.equal(src.might.src, 'original');
  assert.equal(src.ev.src, 'formula');
  assert.equal(src.speed.src, 'yours');
});

// ── The page ──

function server(isGm, entities, states) {
  const calls = [];
  let n = 0;
  globalThis.Chronicle.apiFetch = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    calls.push({ url, method, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const ok = (v) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(v))) });
    let m = /\/entities\/([^/]+)\/system-state\/drawsteel\/variant$/.exec(url);
    if (m) {
      if (method === 'PUT') { states[m[1]] = { gm: calls[calls.length - 1].body.gm, public: {} }; return ok(states[m[1]]); }
      const d = states[m[1]] || { gm: {}, public: {} };
      return ok(isGm ? d : { public: d.public });
    }
    if (/\/system-state\/drawsteel\/variant$/.test(url)) {
      if (!isGm) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return ok({ items: Object.keys(states).filter((id) => states[id].gm && states[id].gm.recipe)
        .map((id) => ({ entityId: id, entityName: entities[id].name, gm: states[id].gm, public: {} })), truncated: false });
    }
    m = /\/api\/v1\/campaigns\/c1\/entities\/([^/]+)$/.exec(url);
    if (m) {
      if (method === 'PUT') { entities[m[1]] = Object.assign({}, entities[m[1]], calls[calls.length - 1].body); return ok(entities[m[1]]); }
      return ok(entities[m[1]]);
    }
    if (/\/api\/v1\/campaigns\/c1\/entities$/.test(url) && method === 'POST') {
      const id = 'new' + (++n);
      entities[id] = Object.assign({ id }, calls[calls.length - 1].body);
      return ok(entities[id]);
    }
    return ok({});
  };
  return calls;
}

function panel(isGm, eid, entities) {
  const el = { innerHTML: '', hidden: false, className: '', ownerDocument: globalThis.document, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const p = new S.Panel(el, { campaignId: 'c1', entityId: eid, isGm });
  p.entity = entities[eid];
  p.refs = refs;
  return { p, el };
}

const world = () => ({
  entities: {
    hound: { id: 'hound', name: 'Ashen Hound', entity_type_id: 7, is_private: false, fields_data: HOUND },
    rem: { id: 'rem', name: 'Remnant (recipe)', entity_type_id: 7, is_private: true, fields_data: {} },
    str: { id: 'str', name: 'Remnant: Strong (recipe)', entity_type_id: 7, is_private: true, fields_data: {} },
  },
  states: {
    rem: { gm: { v: 1, recipe: { name: 'Remnant', part: 'base', sample: 'hound', steps: REMNANT } }, public: {} },
    str: { gm: { v: 1, recipe: { name: 'Remnant', part: 'addon', label: 'Strong', sample: 'hound', steps: STRONG } }, public: {} },
  },
});

test('making a variant makes a linked page with the recipe and its add-ons applied', async () => {
  const w = world();
  const calls = server(true, w.entities, w.states);
  const { p, el } = panel(true, 'hound', w.entities);
  await p.loadVariant();
  await p.loadRecipes();
  p.vr.pick = 'remnant';
  p.vr.open = 'make';
  p.render();
  assert.ok(el.innerHTML.includes('Remnant of Ashen Hound'));
  assert.ok(el.innerHTML.includes('Strong'));
  p.el.querySelectorAll = (sel) => sel === '[data-sbx-var-addon]' ? [{ checked: true, value: 'str' }] : [];
  p.makeVariant();
  await new Promise((r) => setTimeout(r, 30));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.name, 'Remnant of Ashen Hound');
  assert.equal(post.body.entity_type_id, 7);
  assert.equal(post.body.is_private, false, 'as private as its original');
  assert.equal(post.body.fields_data.organization, 'platoon');
  assert.equal(post.body.fields_data.might, 3);
  assert.deepEqual(w.states.new1.gm.follow.parts, ['rem', 'str']);
  assert.equal(w.states.new1.gm.follow.of, 'hound');
  assert.deepEqual(w.states.hound.gm.children, ['new1']);
  assert.ok(el.innerHTML.includes('Made <a href="/campaigns/c1/entities/new1">'));
});

test('opening a variant brings it up to date with its original, once', async () => {
  const w = world();
  server(true, w.entities, w.states);
  const made = V.materialize(Ed, HOUND, [{ steps: REMNANT }], {}, null, refs);
  w.entities.v1 = { id: 'v1', name: 'Remnant of Ashen Hound', entity_type_id: 7, fields_data: Object.assign({ token_image: 't' }, made.fields, { speed: 11 }) };
  w.states.v1 = { gm: { v: 1, follow: { of: 'hound', parts: ['rem'], base: made.base } }, public: {} };
  w.entities.hound.fields_data = Ed.roundTrip('Ashen Hound', Object.assign({}, HOUND, { presence: 2 }), refs);
  const calls = server(true, w.entities, w.states);
  const { p, el } = panel(true, 'v1', w.entities);
  await p.loadVariant();
  assert.equal(w.entities.v1.fields_data.presence, 2);
  assert.equal(w.entities.v1.fields_data.speed, 11);
  assert.equal(w.entities.v1.fields_data.token_image, 't');
  assert.equal(w.states.v1.gm.follow.base.presence, 2);
  assert.ok(el.innerHTML.includes('Follows <a href="/campaigns/c1/entities/hound">Ashen Hound</a>'));
  calls.length = 0;
  p.entity = w.entities.v1;
  await p.loadVariant();
  assert.ok(!calls.some((c) => c.method === 'PUT'), 'nothing to save the second time');
});

test('saving the original passes the edit on to its variants', async () => {
  const w = world();
  server(true, w.entities, w.states);
  const made = V.materialize(Ed, HOUND, [{ steps: REMNANT }], {}, null, refs);
  w.entities.v1 = { id: 'v1', name: 'Remnant of Ashen Hound', fields_data: made.fields };
  w.states.v1 = { gm: { v: 1, follow: { of: 'hound', parts: ['rem'], base: made.base } }, public: {} };
  w.states.hound = { gm: { v: 1, children: ['v1'] }, public: {} };
  const { p } = panel(true, 'hound', w.entities);
  await p.loadVariant();
  w.entities.hound.fields_data = Ed.roundTrip('Ashen Hound', Object.assign({}, HOUND, { level: 4 }), refs);
  await p.refreshKids();
  assert.equal(w.entities.v1.fields_data.level, 4);
  assert.equal(w.entities.v1.fields_data.organization, 'platoon');
});

test('players never read variant documents or see the director’s controls', async () => {
  const w = world();
  const calls = server(false, w.entities, w.states);
  const { p, el } = panel(false, 'hound', w.entities);
  p.render();
  assert.ok(!el.innerHTML.includes('Make a variant'));
  assert.ok(!calls.some((c) => /variant/.test(c.url)));
  const r = panel(false, 'rem', w.entities);
  r.p.render();
  assert.ok(!r.el.innerHTML.includes('Remnant'), 'a recipe page shows a player nothing');
});

test('the recipe page lists its steps and can fix, free and remove one', async () => {
  const w = world();
  server(true, w.entities, w.states);
  const { p, el } = panel(true, 'rem', w.entities);
  await p.loadVariant();
  assert.ok(el.innerHTML.includes('Variant recipe'));
  assert.ok(el.innerHTML.includes('1 step down'));
  assert.ok(el.innerHTML.includes('always Platoon instead'));
  assert.ok(el.innerHTML.includes('Change it on Ashen Hound'));
  p.editStep('fix', 'organization');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.states.rem.gm.recipe.steps.changes.organization.mode, 'set');
  assert.ok(el.innerHTML.includes('move by steps instead'));
  p.editStep('free', 'organization');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.states.rem.gm.recipe.steps.changes.organization.mode, 'step');
  p.editStep('drop', 'reason');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!('reason' in w.states.rem.gm.recipe.steps.changes));
});

test('names the director typed are escaped everywhere they are drawn', async () => {
  const w = world();
  w.states.rem.gm.recipe.name = XSS;
  w.states.rem.gm.recipe.steps = V.cleanSteps({ changes: { role: { mode: 'set', to: XSS } }, lists: { traits: { drop: [], add: [{ name: XSS }] } } });
  w.entities.hound.name = XSS;
  server(true, w.entities, w.states);
  const r = panel(true, 'rem', w.entities);
  await r.p.loadVariant();
  assertNoInjection(assert, r.el.innerHTML, 'recipe page');
  const h = panel(true, 'hound', w.entities);
  await h.p.loadVariant();
  await h.p.loadRecipes();
  h.p.vr.pick = XSS.toLowerCase();
  h.p.vr.open = 'make';
  h.p.render();
  // The stat block above draws its own icons; only the variants section is under test here.
  const section = () => h.el.innerHTML.slice(h.el.innerHTML.indexOf('<section class="sbx-var"'));
  assert.ok(section().includes('&lt;img'));
  assertNoInjection(assert, section(), 'make a variant');
  h.p.vr.open = 'new';
  h.p.render();
  assertNoInjection(assert, section(), 'new recipe');
});

test('the variants section takes its look from the theme tokens, so a style kit restyles it', () => {
  const css = S.CSS || '';
  const rules = css.split('\n').filter((l) => l.startsWith('.sbx-var') || l.includes('.sbx-quiet') || l.includes('.sbx-var-row'));
  assert.ok(rules.length > 5);
  for (const r of rules) {
    assert.ok(!/border-radius|box-shadow/.test(r), 'no fixed corners or shadows: ' + r);
    const bare = r.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '');
    assert.ok(!/#[0-9a-f]{3,6}\b|rgb\(/i.test(bare), 'no colour outside a theme token: ' + r);
  }
});

test('a long stat block is kept compactly, and a changed ability is still told from an untouched one', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ name: 'Ability ' + i, type: 'main', effect: 'x'.repeat(300) }));
  const big = Ed.roundTrip('Big', Object.assign({}, HOUND, { abilities_json: JSON.stringify(many) }), refs);
  const m = V.materialize(Ed, big, [{ steps: REMNANT }], {}, null, refs);
  assert.ok(JSON.stringify({ follow: { of: 'x', parts: ['p'], base: m.base } }).length < V.MAX_BYTES);
  const edited = JSON.parse(m.fields.abilities_json);
  edited[3] = Object.assign({}, edited[3], { effect: 'Changed by the director.' });
  const page = Object.assign({}, m.fields, { abilities_json: JSON.stringify(edited) });
  const next = V.materialize(Ed, big, [{ steps: REMNANT }], page, m.base, refs);
  assert.deepEqual(next.mine.lists.abilities_json.drop, ['Ability 3']);
  assert.equal(JSON.parse(next.fields.abilities_json)[3].effect, 'Changed by the director.');
  assert.equal(JSON.parse(next.fields.abilities_json).length, 50);
});

test('a failed read never turns into a write that drops a page’s other links', async () => {
  const w = world();
  w.states.hound = { gm: { v: 1, children: ['k1'], follow: { of: 'other', parts: [], base: {} } }, public: {} };
  const calls = server(true, w.entities, w.states);
  const real = globalThis.Chronicle.apiFetch;
  globalThis.Chronicle.apiFetch = (url, opts) => (!opts || !opts.method) && /hound\/system-state/.test(url)
    ? Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) }) : real(url, opts);
  const { p } = panel(true, 'hound', w.entities);
  await assert.rejects(p.writeVariant('hound', (gm) => { gm.children = ['k2']; }));
  assert.ok(!calls.some((c) => c.method === 'PUT'));
  assert.deepEqual(w.states.hound.gm.children, ['k1']);
});

test('a player’s panel never asks for variant documents when it starts', async () => {
  const w = world();
  const calls = server(false, w.entities, w.states);
  globalThis.Chronicle.apiFetch = ((real) => (url, opts) => /creature|entity-types/.test(url)
    ? Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 7 }) }) : real(url, opts))(globalThis.Chronicle.apiFetch);
  const { p } = panel(false, 'hound', w.entities);
  p.el.setAttribute = () => {};
  p.el.ownerDocument = { querySelectorAll: () => [], head: null, createElement: () => ({}) };
  await p.start();
  assert.ok(calls.some((c) => /entities\/hound$/.test(c.url)), 'the page itself was read');
  assert.ok(!calls.some((c) => /\/variant$/.test(c.url)));
});

// ── Rising as a variant from a Workshop rule ──

// workshop serves a Workshop recipe with one creature mark over server().
function workshop(w, mark, opts) {
  const o = opts || {};
  const calls = server(true, w.entities, w.states);
  const inner = globalThis.Chronicle.apiFetch;
  const recipe = { id: 'r1', name: 'Remnant on death', version: 3, doc: { parts: [{ key: 'remnant', kind: 'creature-mark', label: 'Remnant', see: 'director', data: mark }], rules: [] } };
  let conflicts = o.conflicts || 0;
  globalThis.Chronicle.apiFetch = (url, op) => {
    const method = (op && op.method) || 'GET';
    const ok = (v) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(v))) });
    if (/\/systems\/drawsteel\/data\/organization-templates\.json$/.test(url)) return ok(refs.orgs);
    if (/\/systems\/drawsteel\/data\/role-templates\.json$/.test(url)) return ok(refs.roles);
    if (/\/campaigns\/c1\/homebrew\/recipes\/r1$/.test(url)) {
      calls.push({ url, method, body: op && op.body ? JSON.parse(op.body) : null });
      if (method === 'PUT') {
        if (conflicts > 0) { conflicts--; recipe.version++; return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) }); }
        const b = calls[calls.length - 1].body;
        if (b.version !== recipe.version) return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) });
        recipe.doc = b.doc; recipe.version++;
        return ok(recipe);
      }
      return ok(recipe);
    }
    return inner(url, op);
  };
  return { calls, recipe };
}

const died = (scope) => ({ campaignId: 'c1', run: { id: 'run1', recipeId: 'r1', scope }, step: { action: 'rise-as-variant', part: 'remnant', browser: true } });

test('the rise action is registered for the Homebrew drawer', () => {
  assert.equal(globalThis.Chronicle.homebrewActions['rise-as-variant'], S.Rise.run);
});

test('a marked creature that dies rises as its linked variant, noted on the mark', async () => {
  const w = world();
  const { recipe } = workshop(w, { recipe: 'rem', addons: ['str'], marked: ['hound'] });
  const line = await S.Rise.run(died('hound'));
  assert.equal(line, 'Ashen Hound rose as Remnant of Ashen Hound.');
  const made = Object.keys(w.entities).find((id) => id.startsWith('new'));
  assert.equal(w.entities[made].name, 'Remnant of Ashen Hound');
  assert.equal(w.entities[made].fields_data.organization, 'platoon');
  assert.equal(w.entities[made].fields_data.might, 3, 'the add-on applies too');
  assert.deepEqual(w.states[made].gm.follow.parts, ['rem', 'str']);
  assert.equal(w.states[made].gm.follow.of, 'hound');
  assert.deepEqual(w.states.hound.gm.children, [made]);
  assert.deepEqual(recipe.doc.parts[0].data.variants, { hound: made });
});

test('a creature rises once, and only if it is marked', async () => {
  const w = world();
  workshop(w, { recipe: 'rem', marked: ['hound'], variants: { hound: 'old' } });
  assert.equal(await S.Rise.run(died('hound')), 'Ashen Hound has already risen.');
  workshop(w, { recipe: 'rem', marked: [] });
  assert.equal(await S.Rise.run(died('hound')), 'Ashen Hound is not marked, so nothing rose.');
  assert.ok(!Object.keys(w.entities).some((id) => id.startsWith('new')), 'no page was made');
});

test('noting the variant retries once when someone saved the recipe in between', async () => {
  const w = world();
  const { recipe } = workshop(w, { recipe: 'rem', marked: ['hound'] }, { conflicts: 1 });
  await S.Rise.run(died('hound'));
  assert.ok(recipe.doc.parts[0].data.variants.hound);
});

test('a rise that cannot run says why in plain words', async () => {
  const w = world();
  workshop(w, { recipe: 'rem', marked: ['hound'] });
  await assert.rejects(S.Rise.run({ campaignId: 'c1', run: { recipeId: 'r1' }, step: { part: 'remnant' } }), /does not say which creature died/);
  await assert.rejects(S.Rise.run(Object.assign(died('hound'), { step: { part: 'gone' } })), /its mark is gone from the recipe/);
  workshop(w, { recipe: 'str', marked: ['hound'] });
  await assert.rejects(S.Rise.run(died('hound')), /no longer a recipe/);
  workshop(w, { recipe: 'rem', marked: ['hound'] }, { conflicts: 5 });
  await assert.rejects(S.Rise.run(died('hound')), (e) => /^made Remnant of Ashen Hound, but could not note the variant on the mark\.$/.test(e.message));
});
