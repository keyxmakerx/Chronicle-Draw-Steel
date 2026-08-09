#!/usr/bin/env node
/**
 * Contract tests for the two widgets that displayed NOTHING against a real
 * Chronicle instance. Both were tiny contract breaks, not deep defects — the
 * code ran fine, it just spoke a shape Chronicle does not emit.
 *
 * These tests DRIVE the widgets (mount via init / call _loadEntity) against
 * payloads shaped exactly like the ones Chronicle's handlers return, and assert
 * on what actually rendered.
 *
 *   bestiary-browser.js campaign mode — three breaks in _fetchCreatures:
 *     1. `?preset=drawsteel-creature`. ListEntities
 *        (internal/plugins/syncapi/api_handler.go) reads type_id / page /
 *        per_page / q only; an unknown param is ignored, so nothing was
 *        filtered and the wrong entity type could come back.
 *     2. The envelope. The handler returns
 *        {"data":[…],"total":N,"page":P,"per_page":PP}; the widget read
 *        `data.entities || data.results || []` — neither key exists, so the
 *        list was ALWAYS empty. This is the zero.
 *     3. No pagination. per_page defaults to 20 and is capped at 100, so even a
 *        correct unwrap showed at most 20 of N.
 *     (plus: entity custom fields arrive as `fields_data`, never
 *      `custom_fields`, so every stat fell back to its default.)
 *
 *   statblock-renderer.js — `if (!entity.custom_fields) return;`. Chronicle's
 *     Entity (internal/plugins/entities/model.go) has no `custom_fields` key at
 *     all; it emits `fields_data`. The guard early-returned on every real
 *     response and the widget rendered its empty state forever.
 *
 * Each test names the OLD assumption it would fail under.
 *
 * Run: `node --test tools/test-widget-chronicle-contract.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle, makeEl, FakeRef } from './_xss-harness.mjs';

installDom();
// bestiary-browser's init binds a document-level Escape handler; the shared
// shim only needs createElement, so top it up here rather than widen it for
// every other suite.
if (!globalThis.document.addEventListener) globalThis.document.addEventListener = function () {};
if (!globalThis.document.removeEventListener) globalThis.document.removeEventListener = function () {};
if (!globalThis.window) globalThis.window = { location: { href: '' } };
globalThis.DrawSteelRefRenderer = FakeRef;

const Chronicle = makeChronicle();
globalThis.Chronicle = Chronicle;

const require = createRequire(import.meta.url);
require('../widgets/bestiary-browser.js');
require('../widgets/statblock-renderer.js');

const browser = Chronicle.registry['bestiary-browser'];
const statblock = Chronicle.registry['statblock-renderer'];

// ── Fake Chronicle server ────────────────────────────────────────────────
// Serves the REAL response shapes. Every request URL is recorded so the tests
// can assert on the query the widget actually sent.

const CAMPAIGN = 'camp-1';

// GET /api/v1/campaigns/:id/entity-types -> envelope. The preset slug
// (drawsteel-creature) is NOT stored on the type: the applier
// (internal/app/preset_applier.go) records the preset's `category` as
// `preset_category` and derives the slug from the name.
const ENTITY_TYPES = {
  data: [
    { id: 1, campaign_id: CAMPAIGN, slug: 'hero', name: 'Hero', name_plural: 'Heroes', preset_category: 'character', fields: [] },
    { id: 7, campaign_id: CAMPAIGN, slug: 'creature', name: 'Creature', name_plural: 'Creatures', preset_category: 'creature', fields: [] },
    { id: 9, campaign_id: CAMPAIGN, slug: 'location', name: 'Location', name_plural: 'Locations', fields: [] }
  ],
  total: 3
};

// One Chronicle Entity as ListEntities serialises it: custom fields live in
// `fields_data`, the type is joined on as type_slug/type_name.
function makeEntity(i, over) {
  return Object.assign({
    id: 'ent-' + i,
    campaign_id: CAMPAIGN,
    entity_type_id: 7,
    name: 'Goblin ' + i,
    slug: 'goblin-' + i,
    is_private: false,
    visibility: 'public',
    is_template: false,
    fields_data: {
      level: 2, organization: 'horde', role: 'harrier', ev: 6, size: '1S',
      keywords: 'Goblin, Humanoid', faction: 'Bloodfang',
      stamina: 20, winded: 10, speed: 7, stability: 0,
      might: 1, agility: 2, reason: -1, intuition: 0, presence: -1,
      immunities: 'poison 2', free_strike: '3 damage',
      traits: JSON.stringify([{ name: 'Sneaky', description: 'Hides well.' }]),
      abilities_json: JSON.stringify([{ name: 'Shortbow', type: 'signature' }]),
      villain_actions_json: '[]'
    },
    type_name: 'Creature',
    type_slug: 'creature',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }, over || {});
}

function installFakeServer(opts) {
  const total = opts.total;
  const calls = [];
  Chronicle.apiFetch = function (url) {
    calls.push(url);
    const [path, qs] = String(url).split('?');
    const q = new URLSearchParams(qs || '');

    if (path.endsWith('/entity-types')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(ENTITY_TYPES) });
    }
    if (path.endsWith('/entities')) {
      // Mirror the server: per_page defaults to 20, caps at 100. type_id
      // filters; anything else in the query is ignored (as `preset` was).
      let perPage = Number(q.get('per_page')) || 20;
      if (perPage < 1 || perPage > 100) perPage = 20;
      const page = Number(q.get('page')) || 1;
      const typeID = Number(q.get('type_id')) || 0;

      let all = [];
      for (let i = 1; i <= total; i++) all.push(makeEntity(i));
      // A non-creature entity the widget must not show when filtering works.
      all.push(makeEntity(999, { entity_type_id: 1, name: 'Aria the Hero', type_slug: 'hero', type_name: 'Hero' }));
      if (typeID) all = all.filter((e) => e.entity_type_id === typeID);

      const slice = all.slice((page - 1) * perPage, page * perPage);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: slice, total: all.length, page, per_page: perPage })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  return calls;
}

// Mount the widget and wait for its load chain to settle.
function mountBrowser(config) {
  const el = makeEl();
  const inst = Object.create(browser);
  inst.init(el, config);
  // init's Promise.all chain is 3 ticks deep at most for our page counts;
  // drain the microtask queue generously.
  return new Promise((resolve) => setTimeout(() => resolve({ el, inst }), 30));
}

// What the grid actually shows, as text.
function gridText(inst) {
  const grid = inst._gridEl;
  if (!grid) return '';
  return grid.innerHTML + grid.children.map((c) => c.innerHTML || '').join('\n');
}

// ── bestiary-browser ─────────────────────────────────────────────────────

test('bestiary-browser: campaign mode renders creatures from the {data,total} envelope', async () => {
  installFakeServer({ total: 3 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'campaign' });

  // OLD assumption (`data.entities || data.results`) yields [] here, so this
  // is 0 and the grid shows the "No creatures loaded" empty state.
  assert.equal(inst.state.creatures.length, 3, 'all three creatures must load');
  assert.equal(inst.state.filtered.length, 3);

  const text = gridText(inst);
  assert.ok(!/No creatures loaded/.test(text), 'the empty state must not render');
  assert.ok(/Goblin 1/.test(text) && /Goblin 3/.test(text), 'creature names must render in the grid');
  assert.equal(inst._gridEl.children.length, 3, 'three cards must be appended');
});

test('bestiary-browser: the envelope this test serves genuinely lacks the old keys', async () => {
  // Guards the guard: if Chronicle ever grew an `entities`/`results` key the
  // test above would pass for the wrong reason.
  const calls = installFakeServer({ total: 1 });
  const body = await Chronicle.apiFetch('/api/v1/campaigns/' + CAMPAIGN + '/entities?page=1').then((r) => r.json());
  assert.equal(body.entities, undefined, 'no `entities` key on the wire');
  assert.equal(body.results, undefined, 'no `results` key on the wire');
  assert.ok(Array.isArray(body.data), '`data` is the list key');
  assert.equal(typeof body.total, 'number');
  assert.ok(calls.length >= 1);
});

test('bestiary-browser: _unwrapList accepts a bare array as well as the envelope', () => {
  const inst = Object.create(browser);
  assert.equal(inst._unwrapList([{ id: 'a' }]).length, 1, 'bare array');
  assert.equal(inst._unwrapList({ data: [{ id: 'a' }, { id: 'b' }], total: 2 }).length, 2, 'envelope');
  assert.equal(inst._unwrapList(null).length, 0);
  assert.equal(inst._unwrapList({}).length, 0);
});

test('bestiary-browser: sends type_id resolved from preset_category, never ?preset=', async () => {
  const calls = installFakeServer({ total: 2 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'campaign' });

  const entityCalls = calls.filter((u) => u.includes('/entities?'));
  assert.ok(entityCalls.length >= 1, 'the entity list must be requested');
  for (const u of entityCalls) {
    assert.ok(!/[?&]preset=/.test(u), 'must not send ?preset= — Chronicle does not read it: ' + u);
    assert.ok(/[?&]type_id=7(&|$)/.test(u), 'must filter by the resolved Creature type id (7): ' + u);
  }
  assert.equal(inst._creatureTypeId, 7);
  // The hero entity the server also holds must not be in the browser.
  assert.ok(!inst.state.creatures.some((c) => c.name === 'Aria the Hero'), 'a non-creature type must not leak in');
});

test('bestiary-browser: pages past the server per_page cap of 100', async () => {
  installFakeServer({ total: 137 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'campaign' });

  // OLD code sent no page/per_page at all, so at best (with a correct unwrap)
  // it would have seen the server's default 20.
  assert.equal(inst.state.creatures.length, 137, 'every creature must load, not just the first page');
});

test('bestiary-browser: stats come from fields_data, not the absent custom_fields', async () => {
  installFakeServer({ total: 1 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'campaign' });

  const cr = inst.state.creatures[0];
  // Under the OLD `entity.custom_fields || entity` read, `f` fell through to
  // the entity itself and every one of these took its default (level 1,
  // size 'M', ev 0, empty role) — a full grid of identical blank creatures.
  assert.equal(cr.level, 2, 'level must come from fields_data');
  assert.equal(cr.organization, 'horde');
  assert.equal(cr.role, 'harrier');
  assert.equal(cr.ev, 6);
  assert.equal(cr.size, '1S');
  assert.equal(cr.stamina, 20);
  assert.deepEqual(cr.keywords, ['Goblin', 'Humanoid']);
  assert.equal(cr.traits.length, 1);
  assert.equal(cr.abilities[0].name, 'Shortbow');

  const text = gridText(inst);
  assert.ok(/Harrier/.test(text), 'the role must reach the card, not an empty string');
});

test('bestiary-browser: import posts entity_type_id + fields_data, not preset/custom_fields', () => {
  const inst = Object.create(browser);
  inst.config = { campaignId: CAMPAIGN };
  inst._creatureTypeId = 7;
  const fd = inst._toFieldsData({
    name: 'Goblin', level: 2, organization: 'horde', role: 'harrier', ev: 6, size: '1S',
    keywords: ['Goblin'], immunities: [], traits: [{ name: 'Sneaky' }], abilities: [], villain_actions: []
  });
  // CreateEntity binds {name, entity_type_id, fields_data} and rejects a zero
  // entity_type_id with 400; `preset` and `custom_fields` are not bound at all.
  assert.equal(fd.level, 2);
  assert.equal(fd.keywords, 'Goblin');
  assert.equal(typeof fd.traits, 'string', 'traits round-trip as a JSON string');
  assert.deepEqual(JSON.parse(fd.traits), [{ name: 'Sneaky' }]);
  assert.equal(fd.abilities_json, '[]');
});

// ── statblock-renderer ───────────────────────────────────────────────────

// GetEntity returns the entity BARE (c.JSON(http.StatusOK, entity)) — no
// envelope — with its custom fields under fields_data.
function serveEntity(entity) {
  Chronicle.apiFetch = function () {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(entity) });
  };
}

test('statblock-renderer: loads a creature from fields_data and renders it', async () => {
  serveEntity(makeEntity(1, { name: 'Goblin Cutter' }));

  const inst = Object.create(statblock);
  inst.config = { campaignId: CAMPAIGN, entityId: 'ent-1' };
  await inst._loadEntity();

  // OLD guard: `if (!entity.custom_fields) return;` -> creature stayed null and
  // the widget rendered its "no creature" placeholder against every real
  // Chronicle response.
  assert.ok(inst.creature, 'the creature must be populated from fields_data');
  assert.equal(inst.creature.name, 'Goblin Cutter');
  assert.equal(inst.creature.level, 2);
  assert.equal(inst.creature.role, 'harrier');
  assert.equal(inst.creature.stamina, 20);
  assert.equal(inst.creature.abilities[0].name, 'Shortbow');

  const el = makeEl();
  inst.el = el;
  inst._ref = new FakeRef();
  statblock._render.call(inst);
  const html = el.innerHTML + el.children.map((c) => c.innerHTML || '').join('\n');
  assert.ok(/Goblin Cutter/.test(html), 'the name must render');
  assert.ok(/Level 2/.test(html), 'the level must render');
});

test('statblock-renderer: a bestiary-shaped custom_fields payload still loads', async () => {
  serveEntity({ id: 'pub-1', name: 'Bestiary Ogre', custom_fields: { level: 4, role: 'brute', size: '2' } });

  const inst = Object.create(statblock);
  inst.config = { campaignId: CAMPAIGN, entityId: 'pub-1' };
  await inst._loadEntity();

  assert.ok(inst.creature, 'custom_fields must remain a supported fallback');
  assert.equal(inst.creature.level, 4);
  assert.equal(inst.creature.role, 'brute');
});

test('statblock-renderer: an entity with neither key leaves the creature unset', async () => {
  serveEntity({ id: 'ent-x', name: 'Fieldless' });

  const inst = Object.create(statblock);
  inst.config = { campaignId: CAMPAIGN, entityId: 'ent-x' };
  await inst._loadEntity();

  assert.equal(inst.creature, undefined, 'no fields means no statblock, not a fabricated one');
});
