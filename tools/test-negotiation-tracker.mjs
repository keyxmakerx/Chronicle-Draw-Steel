// test-negotiation-tracker.mjs — the negotiation tracker's rules come from
// data/negotiation.json, the public half never leaks what the GM has not
// shown, and the widget degrades quietly on an older Chronicle.
//
// Run: node --test tools/test-negotiation-tracker.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
const L = require('../widgets/negotiation-tracker.js');
const def = globalThis.Chronicle.registry['negotiation-tracker'];

const load = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const DATA = load('data/negotiation.json');
const rules = L.buildRules(DATA);
const bySlug = (s) => DATA.find((e) => e.slug === s).properties;
const NOW = '2026-01-01T00:00:00.000Z';

const base = (over) => L.normalizeGm(rules, Object.assign({
  attitude: 'neutral', interest: 3, patience: 3,
  motivations: ['greed', 'justice'], pitfalls: ['power'],
}, over));

test('rules are read from negotiation.json', () => {
  assert.ok(rules);
  assert.equal(rules.motivations.length, 12);
  assert.equal(rules.attitudes.length, 6);
  for (const a of rules.attitudes) {
    const p = bySlug('attitude-' + a.slug);
    assert.equal(a.interest, p.interest);
    assert.equal(a.patience, p.patience);
  }
  for (let i = 0; i <= 5; i++) assert.equal(rules.offers[i].response, bySlug('offer-interest-' + i).response);
  assert.equal(L.buildRules([]), null, 'missing data yields no rules rather than invented ones');
});

test('startFromAttitude resets meters to the data values and logs it', () => {
  for (const a of rules.attitudes) {
    const g = L.startFromAttitude(rules, base({ interest: 5, patience: 0, over: true, used: ['greed'] }), a.slug, NOW);
    assert.equal(g.attitude, a.slug);
    assert.equal(g.interest, a.interest);
    assert.equal(g.patience, a.patience);
    assert.equal(g.over, false);
    assert.deepEqual(g.used, []);
    assert.match(g.log[g.log.length - 1].text, /Starting attitude/);
  }
});

test('appeal and no-motivation deltas equal the data tiers', () => {
  const cases = [['appeal', 'argument-appeal-to-motivation'], ['none', 'argument-no-motivation']];
  for (const [type, slug] of cases) {
    for (const t of [1, 2, 3]) {
      const d = bySlug(slug).tiers['t' + t];
      const g = L.applyArgument(rules, base(), { type, slug: 'greed', tier: t }, NOW);
      assert.equal(g.interest, 3 + d.interest, `${slug} t${t} interest`);
      assert.equal(g.patience, 3 + d.patience, `${slug} t${t} patience`);
    }
  }
});

test('flat outcomes (pitfall, lie, reused) equal the data', () => {
  let g = L.applyArgument(rules, base(), { type: 'pitfall', slug: 'power' }, NOW);
  assert.equal(g.interest, 3 + bySlug('argument-pitfall-used').interest);
  assert.equal(g.patience, 3 + bySlug('argument-pitfall-used').patience);
  assert.deepEqual(g.found.pitfalls, ['power']);
  g = L.applyArgument(rules, base(), { type: 'lie' }, NOW);
  assert.equal(g.interest, 3 + bySlug('argument-caught-in-lie').interest);
  assert.equal(g.patience, 3);
  g = L.applyArgument(rules, base({ used: ['greed'] }), { type: 'appeal', slug: 'greed', tier: 3 }, NOW);
  assert.equal(g.interest, 3 + bySlug('argument-motivation-reused').interest);
  assert.equal(g.patience, 3 + bySlug('argument-motivation-reused').patience);
});

test('a successful appeal marks the motivation used and found; a failed one does not', () => {
  let g = L.applyArgument(rules, base(), { type: 'appeal', slug: 'greed', tier: 2 }, NOW);
  assert.deepEqual(g.used, ['greed']);
  assert.deepEqual(g.found.motivations, ['greed']);
  g = L.applyArgument(rules, base(), { type: 'appeal', slug: 'greed', tier: 1 }, NOW);
  assert.deepEqual(g.used, []);
  assert.deepEqual(g.found.motivations, []);
});

test('interest and patience clamp to 0..5', () => {
  let g = L.applyArgument(rules, base({ interest: 4, patience: 5 }), { type: 'appeal', slug: 'greed', tier: 3 }, NOW);
  assert.equal(g.interest, 5);
  assert.equal(g.patience, 5);
  g = L.setMeter(rules, base(), 'interest', 99, NOW);
  assert.equal(g.interest, 5);
  g = L.setMeter(rules, base(), 'patience', -4, NOW);
  assert.equal(g.patience, 0);
  assert.equal(L.normalizeGm(rules, { interest: 17, patience: -2 }).interest, 5);
});

test('ending rules: interest 5 or patience 0 is a final offer, interest 0 is no deal', () => {
  let g = L.applyArgument(rules, base({ interest: 4 }), { type: 'appeal', slug: 'greed', tier: 3 }, NOW);
  assert.equal(g.over, true);
  assert.match(g.log[g.log.length - 1].text, /Interest reached 5/);
  g = L.applyArgument(rules, base({ interest: 1 }), { type: 'pitfall', slug: 'power' }, NOW);
  assert.equal(g.over, true);
  assert.match(g.log[g.log.length - 1].text, /Interest dropped to 0/);
  g = L.applyArgument(rules, base({ patience: 1 }), { type: 'appeal', slug: 'greed', tier: 1 }, NOW);
  assert.equal(g.over, true);
  assert.match(g.log[g.log.length - 1].text, /Patience ran out/);
  const again = L.applyArgument(rules, g, { type: 'lie' }, NOW);
  assert.deepEqual(again, g, 'no argument applies once the negotiation is over');
  assert.equal(L.setMeter(rules, g, 'patience', 2, NOW).over, false, 'raising a meter by hand reopens it');
});

test('log keeps the newest 30', () => {
  let g = base({ interest: 2, patience: 5 });
  for (let i = 0; i < 40; i++) g = L.pushLog(g, 'x' + i, NOW) || g;
  assert.equal(g.log.length, 30);
  assert.equal(g.log[29].text, 'x39');
  assert.equal(g.log[0].text, 'x10');
  assert.equal(L.normalizeGm(rules, { log: Array.from({ length: 50 }, (_, i) => ({ at: '', text: 't' + i })) }).log.length, 30);
});

test('public is derived from gm: no unfound names, no meters unless shown', () => {
  const gm = base({
    shown: false, interest: 4, patience: 2,
    found: { motivations: ['greed'], pitfalls: [] },
  });
  let pub = L.derivePublic(rules, gm);
  assert.deepEqual(pub, { shown: false, motivationsFound: ['Greed'], pitfallsFound: [] });
  assert.ok(!('interest' in pub) && !('patience' in pub) && !('response' in pub));
  const text = JSON.stringify(pub);
  assert.ok(!/Justice|Power/.test(text), 'unfound motivations and pitfalls never appear');
  pub = L.derivePublic(rules, Object.assign({}, gm, { shown: true }));
  assert.equal(pub.interest, 4);
  assert.equal(pub.patience, 2);
  assert.equal(pub.response, bySlug('offer-interest-4').response);
  assert.ok(!('gm' in pub) && !('impression' in pub) && !('log' in pub));
});

test('startOver clears what was learned but keeps who the NPC is', () => {
  const g = L.startOver(rules, base({ shown: true, used: ['greed'], found: { motivations: ['greed'], pitfalls: [] } }), NOW);
  assert.equal(g.shown, false);
  assert.deepEqual(g.found, { motivations: [], pitfalls: [] });
  assert.deepEqual(g.motivations, ['greed', 'justice']);
  assert.equal(g.log.length, 1);
});

test('manifest registers the widget and the NPC panel', () => {
  const m = load('manifest.json');
  const w = m.widgets.find((x) => x.slug === 'negotiation-tracker');
  assert.equal(w.script_file, 'widgets/negotiation-tracker.js');
  assert.deepEqual(m.entity_panels, [{ widget: 'negotiation-tracker', applies_to: 'npc' }]);
});

// ── mounted behaviour ────────────────────────────────────────

function mount({ isGm, status = 200, state, rulesOk = true }) {
  const el = makeEl();
  el.dataset = { campaignId: 'c1', entityId: 'e1', isGm: String(isGm) };
  const urls = [];
  globalThis.Chronicle.apiFetch = (url) => {
    urls.push(url);
    if (/system-state/.test(url)) {
      return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(state) });
    }
    return Promise.resolve({ ok: rulesOk, status: 200, json: () => Promise.resolve(DATA) });
  };
  const inst = Object.create(def);
  inst.init(el, {});
  return new Promise((r) => setTimeout(() => r({ el, urls, inst }), 20));
}

test('404 from an older Chronicle: nothing for players, one quiet line for the GM', async () => {
  let r = await mount({ isGm: false, status: 404 });
  assert.equal(r.el.innerHTML, '');
  r = await mount({ isGm: true, status: 404 });
  assert.match(r.el.innerHTML, /This needs a newer Chronicle\./);
  assert.ok(!/Make the argument/.test(r.el.innerHTML));
});

test('player with nothing found and meters hidden sees nothing', async () => {
  const r = await mount({ isGm: false, state: { isGm: false, public: { shown: false, motivationsFound: [], pitfallsFound: [] } } });
  assert.equal(r.el.innerHTML, '');
  assert.ok(r.urls.every((u) => /system-state/.test(u)), 'players never fetch the rules');
});

test('player card shows only public data, escaped', async () => {
  const r = await mount({ isGm: false, state: { isGm: false, gm: { motivations: ['greed'] }, public: {
    shown: true, interest: 3, patience: 2, response: 'Yes, but...', motivationsFound: ['<img src=x onerror=alert(1)>'], pitfallsFound: [] } } });
  assert.match(r.el.innerHTML, /Yes, but\.\.\./);
  assert.ok(!/<img/.test(r.el.innerHTML));
  assert.ok(!/Make the argument/.test(r.el.innerHTML));
  const hidden = await mount({ isGm: false, state: { isGm: false, public: { shown: false, motivationsFound: ['Greed'], pitfallsFound: [] } } });
  assert.match(hidden.el.innerHTML, /hasn't shown the meters yet/);
});

test('GM view needs isGm and the gm half from the server, and escapes the log', async () => {
  const r = await mount({ isGm: true, state: { isGm: true, public: {}, gm: {
    attitude: 'open', motivations: ['greed'], pitfalls: ['power'],
    log: [{ at: NOW, text: '<script>alert(1)</script>' }] } } });
  assert.match(r.el.innerHTML, /Make the argument/);
  assert.match(r.el.innerHTML, /Show players the meters/);
  assert.match(r.el.innerHTML, /Start over/);
  assert.ok(!/<script>alert/.test(r.el.innerHTML));
  assert.ok(r.urls.some((u) => u === '/campaigns/c1/systems/drawsteel/data/negotiation.json'));
  // dataset says GM but the server says player: no GM controls.
  const p = await mount({ isGm: true, state: { isGm: false, public: { shown: true, interest: 2, patience: 2, response: 'No, but...', motivationsFound: [], pitfallsFound: [] } } });
  assert.ok(!/Make the argument/.test(p.el.innerHTML));
});

test('GM card starts as a closed bar showing the meters, and opening is remembered per page', async () => {
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  try {
    const r = await mount({ isGm: true, state: { isGm: true, public: {}, gm: { attitude: 'open', interest: 2, patience: 3 } } });
    assert.match(r.el.innerHTML, /class="dsn"/, 'closed by default');
    assert.match(r.el.innerHTML, /aria-expanded="false"/);
    assert.match(r.el.innerHTML, /Interest<\/span>.*<span>2<\/span>/s);
    assert.match(r.el.innerHTML, /Hidden from players/);
    assert.match(r.el.innerHTML, / inert>/, 'closed controls are out of the tab order');
    r.el.__negotiationTracker._toggle();
    assert.equal(store.get('dsn-open:e1'), '1');
    const again = await mount({ isGm: true, state: { isGm: true, public: {}, gm: { attitude: 'open' } } });
    assert.match(again.el.innerHTML, /class="dsn open"/, 'reopens where the GM left it');
    // Blocked storage falls back to closed rather than failing.
    globalThis.window = { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } };
    const blocked = await mount({ isGm: true, state: { isGm: true, public: {}, gm: { attitude: 'open' } } });
    assert.match(blocked.el.innerHTML, /class="dsn"/);
  } finally {
    delete globalThis.window;
  }
});
