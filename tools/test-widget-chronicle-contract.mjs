#!/usr/bin/env node
/**
 * Contract tests for bestiary-browser.js and statblock-renderer.js against
 * the shapes Chronicle's handlers actually emit. These tests DRIVE the
 * widgets (mount via init / call _loadEntity) against payloads shaped exactly
 * like Chronicle's real responses, and assert on what rendered.
 *
 *   ListEntities (internal/plugins/syncapi/api_handler.go) reads only
 *   type_id / page / per_page / q — an unknown query param is ignored — and
 *   returns the envelope {"data":[…],"total":N,"page":P,"per_page":PP}, with
 *   per_page defaulting to 20 and capped at 100.
 *
 *   Chronicle's Entity (internal/plugins/entities/model.go) has no
 *   `custom_fields` key; it emits `fields_data`.
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
const SB = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = SB;
require('../widgets/bestiary-browser.js');

const browser = Chronicle.registry['bestiary-browser'];

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

// ── bestiary-browser, community bestiary mode ────────────────────────────

// The bestiary plugin's real shapes (internal/plugins/bestiary): Search takes
// system_id and caps per_page at 50, and returns summaries in
// {results,total,page,per_page,total_pages} with no stat block; the full stat
// block is GET /bestiary/:slug/statblock, served as stored.
function installBestiary(opts) {
  const total = opts.total;
  const calls = [];
  const posts = [];
  Chronicle.apiFetch = function (url, init) {
    calls.push(url);
    if (init && init.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'new' }) });
    }
    const [path, qs] = String(url).split('?');
    const q = new URLSearchParams(qs || '');
    if (path.endsWith('/entity-types')) return Promise.resolve({ ok: true, json: () => Promise.resolve(ENTITY_TYPES) });
    if (path === '/bestiary/search') {
      let perPage = Number(q.get('per_page')) || 20;
      if (perPage > 50) perPage = 50;
      const page = Number(q.get('page')) || 1;
      let all = [];
      for (let i = 1; i <= total; i++) {
        all.push({ id: 'pub-' + i, creator_id: 'u1', system_id: 'drawsteel', name: 'Ogre ' + i, slug: 'ogre-' + i,
          organization: 'platoon', role: 'brute', level: 4, downloads: i, rating_average: 4.5, rating_count: 2 });
      }
      all.push({ id: 'pub-x', system_id: 'dnd5e', name: 'Owlbear', slug: 'owlbear', level: 3 });
      const sys = q.get('system_id');
      if (sys) all = all.filter((r) => r.system_id === sys);
      const slice = all.slice((page - 1) * perPage, page * perPage);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: slice, total: all.length, page, per_page: perPage, total_pages: Math.ceil(all.length / perPage) }) });
    }
    if (/^\/bestiary\/[^/]+\/statblock$/.test(path)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        name: 'Ogre 1', level: 4, organization: 'platoon', role: 'brute', ev: 12, stamina: 120, speed: 5, size: '1L',
        might: 3, agility: 0, reason: -1, intuition: 0, presence: 0, keywords: ['Giant'], free_strike: '7 damage',
        abilities: [{ name: 'Club', type: 'signature', tier1: '7 damage' }], villain_actions: [], traits: [{ name: 'Big', description: 'Very big.' }]
      }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
  return { calls, posts };
}

test('bestiary-browser: community mode lists only Draw Steel creatures, every page of them', async () => {
  const { calls } = installBestiary({ total: 73 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'bestiary' });
  const searches = calls.filter((u) => u.startsWith('/bestiary/search'));
  assert.ok(searches.length >= 2, 'it walks past the 50-per-page cap');
  searches.forEach((u) => assert.match(u, /[?&]system_id=drawsteel(&|$)/));
  assert.ok(!calls.some((u) => u.startsWith('/bestiary?')), 'Browse ignores the system, so it must not be used');
  assert.equal(inst.state.creatures.length, 73);
  assert.ok(!inst.state.creatures.some((c) => c.name === 'Owlbear'), 'another game’s creature must not show');
});

test('bestiary-browser: a community card shows its downloads, not a row of zeros', async () => {
  installBestiary({ total: 1 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'bestiary' });
  const card = inst._gridEl.children[0].innerHTML;
  assert.match(card, /1 added/);
  assert.ok(!/STM 0/.test(card), 'a summary has no Stamina to show');
});

test('bestiary-browser: opening a community creature fetches its stat block, and offers Add, never Edit or Delete', async () => {
  const { calls, posts } = installBestiary({ total: 1 });
  const { inst } = await mountBrowser({ campaignId: CAMPAIGN, source: 'bestiary', editable: true });
  const buttons = [];
  const realCreate = globalThis.document.createElement;
  globalThis.document.createElement = function () {
    const e = realCreate();
    e.addEventListener = function (type, fn) { if (type === 'click') this._click = fn; };
    buttons.push(e);
    return e;
  };
  inst._openModal(inst.state.creatures[0]);
  await new Promise((r) => setTimeout(r, 20));
  globalThis.document.createElement = realCreate;
  assert.ok(calls.includes('/bestiary/ogre-1/statblock'), 'the full stat block is fetched on open');
  const labels = buttons.map((b) => b.textContent).filter(Boolean);
  assert.ok(labels.includes('Add to this campaign'), labels.join(', '));
  assert.ok(!labels.includes('Edit') && !labels.includes('Delete'), 'a publication id is not a campaign page: ' + labels.join(', '));
  const body = buttons.find((b) => b.className === 'bb-modal-body');
  assert.match(body.innerHTML, /Club/, 'the modal draws the full stat block');

  // Add writes the full stat block as a typed Creature page, not the empty
  // summary the card was drawn from.
  buttons.find((b) => b.textContent === 'Add to this campaign')._click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/api\/v1\/campaigns\/camp-1\/entities$/);
  const sent = posts[0].body;
  assert.equal(sent.entity_type_id, 7);
  assert.equal(sent.fields_data.stamina, 120);
  assert.equal(sent.fields_data.ev, 12);
  assert.equal(JSON.parse(sent.fields_data.abilities_json)[0].name, 'Club');
  assert.equal(JSON.parse(sent.fields_data.traits)[0].name, 'Big');
});

// ── statblock-renderer (the Creature page panel) ─────────────────────────

// GetEntity returns the entity BARE, custom fields under fields_data.
function serveEntity(entity) {
  const calls = [];
  Chronicle.apiFetch = function (url) {
    calls.push(url);
    if (/\/entity-types$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(ENTITY_TYPES) });
    if (/systems\/drawsteel\/data\//.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(entity) });
  };
  return calls;
}

function panelEl() {
  const el = makeEl();
  el.ownerDocument = { querySelectorAll: () => [], querySelector: () => null, head: makeEl(), createElement: makeEl };
  el.setAttribute = function (k, v) { this['attr:' + k] = v; };
  return el;
}

async function mountPanel(config) {
  const el = panelEl();
  const p = new SB.Panel(el, config);
  await p.start();
  return { el, p };
}

test('statblock-renderer: a Creature page draws its stat block from fields_data', async () => {
  serveEntity(makeEntity(1, { name: 'Goblin Cutter' }));
  const { el } = await mountPanel({ campaignId: CAMPAIGN, entityId: 'ent-1', isGm: false });
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /Goblin Cutter/);
  assert.match(el.innerHTML, /Level 2 Horde Harrier/);
  assert.match(el.innerHTML, /Shortbow/);
  assert.ok(!/Edit stat block/.test(el.innerHTML), 'a player gets no edit control');
});

test('statblock-renderer: the director gets Edit stat block and Publish', async () => {
  serveEntity(makeEntity(1));
  const { el } = await mountPanel({ campaignId: CAMPAIGN, entityId: 'ent-1', isGm: true });
  assert.match(el.innerHTML, /Edit stat block/);
  assert.match(el.innerHTML, /Publish/);
});

test('statblock-renderer: a bestiary-shaped custom_fields payload still draws', async () => {
  serveEntity({ id: 'pub-1', entity_type_id: 7, name: 'Bestiary Ogre', custom_fields: { level: 4, organization: 'platoon', role: 'brute', size: '2' } });
  const { el } = await mountPanel({ campaignId: CAMPAIGN, entityId: 'pub-1' });
  assert.match(el.innerHTML, /Level 4 Platoon Brute/);
});

test('statblock-renderer: a page that is not a creature stays hidden and empty', async () => {
  serveEntity({ id: 'ent-x', entity_type_id: 1, name: 'Aria the Hero', fields_data: { level: 3 } });
  const { el } = await mountPanel({ campaignId: CAMPAIGN, entityId: 'ent-x', isGm: true });
  assert.equal(el.hidden, true);
  assert.equal(el.innerHTML, '');
});

test('statblock-renderer: a Creature page with no stat block offers the director a start, and shows a player nothing', async () => {
  serveEntity({ id: 'ent-n', entity_type_id: 7, name: 'Nameless Thing', fields_data: {} });
  const gm = await mountPanel({ campaignId: CAMPAIGN, entityId: 'ent-n', isGm: true });
  assert.match(gm.el.innerHTML, /Build its stat block/);
  serveEntity({ id: 'ent-n', entity_type_id: 7, name: 'Nameless Thing', fields_data: {} });
  const player = await mountPanel({ campaignId: CAMPAIGN, entityId: 'ent-n', isGm: false });
  assert.equal(player.el.hidden, true);
});

test('statblock-renderer: a second copy on the same page steps aside', async () => {
  serveEntity(makeEntity(1));
  const el = panelEl();
  el.ownerDocument.querySelectorAll = () => [{}];
  const calls = serveEntity(makeEntity(1));
  await new SB.Panel(el, { campaignId: CAMPAIGN, entityId: 'ent-1' }).start();
  assert.equal(calls.length, 0, 'it loads nothing');
  assert.equal(el.innerHTML, '');
});
