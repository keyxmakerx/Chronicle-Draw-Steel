#!/usr/bin/env node
/**
 * The hero sheet's update(el, fresh) hook: Chronicle refreshes a page in
 * place when someone saves it and hands each mounted widget its fresh mount.
 * An unchanged mount must leave the drawing alone; a changed one redraws
 * over the old drawing without blanking it, keeping the reader's dashboard
 * view and without replaying the sheet's entrance; an open editor holds the
 * redraw back; the reader's own save beats any older load; a failed request
 * during a refresh changes nothing; nothing leaks listeners or restarts
 * after destroy.
 *
 * Run: `node --test tools/test-character-sheet-refresh.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeChronicle } from './_xss-harness.mjs';

const C = makeChronicle();
globalThis.window = { Chronicle: C };
globalThis.document = {
  getElementById: () => ({}),
  createElement: () => ({ setAttribute() {}, style: {} }),
  addEventListener() {}, removeEventListener() {},
  head: { appendChild() {} }
};
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');
const reg = C.registry['character-sheet'];

// Paper render without the engine's DOM work: the sheet's own markup is
// what the assertions read.
C.sheetMotion = { mount() {}, rescan() {} };

// Answers by URL; `rules` is what the hero's choice rules say right now,
// `route` lets a test answer (or delay, or fail) a request itself.
let rules = { choice_breaks: [], choice_waiting: [] };
let layers = {};
let route = null;
let fetches = [];
const answer = (body, status) => ({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(body) });
const later = (ms, v) => new Promise((ok) => setTimeout(() => ok(v), ms));
C.apiFetch = (url) => {
  fetches.push(url);
  const own = route && route(url);
  if (own) return own;
  return Promise.resolve(answer(/\/fields$/.test(url) ? rules : /\/layers$/.test(url) ? layers : {}));
};

const camel = (n) => n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// A mount as Chronicle serves it: data-* attributes only.
function attrsFor(fields, extra) {
  return Object.assign({
    'data-widget': 'character-sheet', 'data-entity-id': 'e1', 'data-campaign-id': 'c1',
    'data-is-gm': 'false', 'data-is-owner': 'true', 'data-visibility': 'everyone',
    'data-fields-data': JSON.stringify({ id: 'e1', name: 'Bren', visibility: 'everyone', fields_data: fields })
  }, extra);
}

function makeNode(attrs) {
  const a = Object.assign({}, attrs);
  return {
    get attributes() { return Object.keys(a).map((name) => ({ name, value: a[name] })); },
    get dataset() { const d = {}; for (const k of Object.keys(a)) if (k.startsWith('data-')) d[camel(k)] = a[k]; return d; },
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
    removeAttribute: (k) => { delete a[k]; },
    hasAttribute: (k) => k in a
  };
}

// The live mount. `writes` logs every innerHTML assignment; `main` stands
// in for the dashboard's tab holder, which outlives a redraw here because
// the stub does not parse markup.
function makeMount(attrs) {
  const el = makeNode(attrs);
  let html = '';
  const main = { attrs: { 'data-dtab': 'story' }, sets: [],
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; this.sets.push([k, v]); },
    querySelector: (sel) => (/data-cs-dtab="story"/.test(sel) ? {} : null),
    querySelectorAll: () => [] };
  const held = []; // nodes [data-cs-ed-host] / [data-cs-pick-fold] currently report
  Object.assign(el, {
    writes: [], _fns: [], main, held, isConnected: true, offsetHeight: 900, style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {},
    contains: () => true,
    addEventListener(t, fn, cap) { el._fns = el._fns.concat([[t, fn, !!cap]]); },
    removeEventListener(t, fn, cap) { el._fns = el._fns.filter((f) => !(f[0] === t && f[1] === fn && f[2] === !!cap)); },
    querySelector: (sel) => (sel === '[data-cs-dmain]' && html ? main : null),
    nodes: {}, // selector -> nodes the stub hands back, for the entrance checks
    querySelectorAll: (sel) => (/data-cs-ed-host|data-cs-pick-fold/.test(sel) ? held : el.nodes[sel] || [])
  });
  Object.defineProperty(el, 'innerHTML', { get: () => html, set(v) { html = v; el.writes.push(v); } });
  return el;
}
const live = (el) => el._fns.length;
// The stamina the dashboard shows, read from the drawn markup.
const stamina = (el) => (el.innerHTML.match(/data-v="stamina">(-?\d+)</) || [])[1];
const settle = (ms) => new Promise((ok) => setTimeout(ok, ms || 30));

async function mounted(fields, extra) {
  const el = makeMount(attrsFor(fields, extra));
  reg.init(el, {});
  await settle();
  return el;
}

test('update with the same attributes leaves the drawing exactly as it is', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  assert.equal(el.writes.length, 1, 'drawn once on mount');
  assert.equal(stamina(el), '20');
  const before = { html: el.innerHTML, listeners: live(el), fns: el._fns.slice() };
  fetches = [];
  reg.update(el, makeNode(attrsFor({ stamina_current: 20, stamina_max: 30 })));
  await settle();
  assert.equal(el.writes.length, 1, 'no innerHTML write');
  assert.equal(el.innerHTML, before.html);
  assert.deepEqual(el._fns, before.fns, 'the same listeners, none added or taken off');
  assert.ok(fetches.some((u) => /\/layers$/.test(u)) && fetches.some((u) => /\/fields$/.test(u)), 'what the sheet fetched itself is checked again');
  assert.ok(!fetches.some((u) => /\/api\/v1\//.test(u)), 'a mount carrying the fields does not fetch the hero');
  reg.destroy(el);
});

test('update with the same attributes redraws only when its own data changed behind them', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  rules = { choice_breaks: [], choice_waiting: [{ fieldKey: 'culture', value: 'Nomadic' }] };
  try {
    reg.update(el, makeNode(attrsFor({ stamina_current: 20, stamina_max: 30 })));
    await settle(60);
    assert.equal(el.writes.length, 2, 'a choice the Director now waits on is drawn');
    assert.ok(el.writes.every((w) => w !== ''), 'never blanked');
    reg.update(el, makeNode(attrsFor({ stamina_current: 20, stamina_max: 30 })));
    await settle(60);
    assert.equal(el.writes.length, 2, 'checked again, still the same: no redraw');
  } finally { rules = { choice_breaks: [], choice_waiting: [] }; }
  reg.destroy(el);
});

test('update with changed fields redraws with the new value, never blank, and keeps the dashboard tab', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  const n = live(el);
  el.main.sets.length = 0;
  reg.update(el, makeNode(attrsFor({ stamina_current: 7, stamina_max: 30 })));
  assert.equal(el.writes.length, 1, 'the old drawing stays up while the new one loads');
  await settle();
  assert.equal(el.writes.length, 2, 'drawn once more');
  assert.ok(el.writes.every((w) => w !== ''), 'no blank write in between');
  assert.equal(stamina(el), '7', 'the new stamina is on the sheet');
  assert.ok(JSON.parse(el.getAttribute('data-fields-data')).fields_data.stamina_current === 7, 'the mount took the fresh attributes');
  assert.deepEqual(el.main.sets.filter((s) => s[0] === 'data-dtab'), [['data-dtab', 'story']], 'the open tab is put back');
  assert.equal(live(el), n, 'listeners replaced, not doubled');
  reg.destroy(el);
  assert.equal(live(el), 0, 'destroy takes every listener off');
});

test('a load still in flight cannot draw over a newer refresh', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  reg.update(el, makeNode(attrsFor({ stamina_current: 11, stamina_max: 30 })));
  reg.update(el, makeNode(attrsFor({ stamina_current: 5, stamina_max: 30 })));
  await settle();
  assert.equal(el.writes.length, 2, 'only the newest load draws');
  assert.equal(stamina(el), '5');
  reg.destroy(el);
});

test('an open editor holds the redraw until it is put away, then the sheet loads afresh', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  el.held.push({ firstChild: {} });
  reg.update(el, makeNode(attrsFor({ stamina_current: 3, stamina_max: 30 })));
  await settle(60);
  assert.equal(el.writes.length, 1, 'the editor and what was typed in it stay');
  el.held.length = 0;
  await settle(1150);
  assert.equal(el.writes.length, 2, 'drawn once the editor is shut');
  assert.equal(stamina(el), '3');
  reg.destroy(el);
});

test('destroy while a redraw waits stops it for good', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  el.held.push({ firstChild: {} });
  reg.update(el, makeNode(attrsFor({ stamina_current: 9, stamina_max: 30 })));
  await settle(60);
  reg.destroy(el);
  const writes = el.writes.length;
  el.held.length = 0;
  await settle(1150);
  assert.equal(el.writes.length, writes, 'nothing drawn after destroy');
  assert.equal(el._csWait, null, 'no timer left behind');
});

// A node whose class list records what was put on and taken off.
function classed(...names) {
  const set = new Set(names);
  return { style: {}, classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }, has: (c) => set.has(c) };
}

test('a refresh redraws without the entrance; the first drawing keeps it', async () => {
  const el = makeMount(attrsFor({ stamina_current: 20, stamina_max: 30 }));
  const first = classed('sh-settle', 'paper-settle');
  el.nodes['.paper-settle'] = [first];
  reg.init(el, {});
  await settle();
  assert.ok(first.has('paper-settle'), 'the first drawing settles in');
  const again = classed('sh-settle', 'paper-settle');
  el.nodes['.paper-settle'] = [again];
  reg.update(el, makeNode(attrsFor({ stamina_current: 8, stamina_max: 30 })));
  await settle();
  assert.equal(stamina(el), '8');
  assert.ok(!again.has('paper-settle') && again.has('sh-settle'), 'the refresh drawing has no settle to play');
  reg.destroy(el);
});

test('the older render plays its entrance only on the first drawing', async () => {
  const motion = C.sheetMotion;
  delete C.sheetMotion;
  const mounts = [];
  C.surface = { mount(node, schema) { mounts.push(schema); } };
  try {
    const el = makeMount(attrsFor({ stamina_current: 20, stamina_max: 30 }));
    const box1 = classed('cs-box');
    el.nodes['.cs-box'] = [box1];
    reg.init(el, {});
    await settle();
    assert.equal(mounts.length, 1);
    assert.ok(box1.has('ds-anim-in'), 'boxes rise in on the first drawing');
    const box2 = classed('cs-box');
    el.nodes['.cs-box'] = [box2];
    reg.update(el, makeNode(attrsFor({ stamina_current: 8, stamina_max: 30 })));
    await settle();
    assert.equal(mounts.length, 2, 'drawn again');
    assert.ok(!box2.has('ds-anim-in'), 'no entrance on the refresh');
    reg.destroy(el);
  } finally { C.sheetMotion = motion; delete C.surface; }
});

test('the reader\'s save makes a refresh load already under way lose, and loads again after it', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  // The refresh's load is slow; by the time the save lands Chronicle holds
  // the reader's figure, which the mount does not carry yet.
  route = (url) => (/\/layers$/.test(url) ? later(300, answer({})) : null);
  try {
    reg.update(el, makeNode(attrsFor({ stamina_current: 7, stamina_max: 30 })));
    await settle(20);
    route = (url) => (/\/api\/v1\/campaigns\/c1\/entities\/e1$/.test(url)
      ? Promise.resolve(answer({ id: 'e1', name: 'Bren', fields_data: { stamina_current: 12, stamina_max: 30 } })) : null);
    cs.wroteHere(reg, el);
    await settle(450);
    assert.equal(stamina(el), '12', 'the load after the save draws what Chronicle holds');
    assert.ok(!el.writes.some((w) => /data-v="stamina">7</.test(w)), 'the older load never drew');
    assert.ok(fetches.some((u) => /\/api\/v1\/campaigns\/c1\/entities\/e1$/.test(u)), 'the hero is read from Chronicle, not the mount');
  } finally { route = null; }
  reg.destroy(el);
});

test('a save with no refresh under way loads nothing', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  fetches = [];
  cs.wroteHere(reg, el);
  await settle();
  assert.deepEqual(fetches, []);
  assert.equal(el.writes.length, 1);
  reg.destroy(el);
});

test('every in-sheet write tells the sheet it saved', () => {
  const src = readFileSync(new URL('../widgets/character-sheet.js', import.meta.url), 'utf8');
  const after = (marker) => { const i = src.indexOf(marker); assert.ok(i > 0, marker); return src.slice(i, i + 400); };
  assert.match(after('saveFields(data, got.patch).then(function () {'), /wroteHere\(inst, el\)/, 'field editor');
  assert.match(src.slice(src.indexOf('if (!res || res.value == null)'), src.indexOf("if (key === 'ancestry' && res.value")), /wroteHere\(inst, el\)/, 'origin pick');
  assert.match(after('req().then(function (msg) {'), /wroteHere\(inst, el\)/, 'transformation push');
  assert.match(after('}).then(function (recipe) {'), /wroteHere\(inst, el\)/, 'preset save');
});

test('a failed layers or choice-rules request during a refresh changes nothing', async () => {
  layers = { layers: [], canEdit: true };
  try {
    const el = await mounted({ stamina_current: 20, stamina_max: 30 });
    const fail = [
      (url) => (/\/layers$/.test(url) ? Promise.resolve(answer({}, 500)) : null),
      (url) => (/\/layers$/.test(url) ? Promise.reject(new Error('offline')) : null),
      (url) => (/\/fields$/.test(url) ? Promise.resolve(answer({}, 502)) : null)
    ];
    for (const f of fail) {
      route = f;
      reg.update(el, makeNode(attrsFor({ stamina_current: 20, stamina_max: 30 })));
      await settle();
      assert.equal(el.writes.length, 1, 'an unchanged mount: the check failed, no redraw');
      reg.update(el, makeNode(attrsFor({ stamina_current: 4, stamina_max: 30 })));
      await settle();
      assert.equal(el.writes.length, 1, 'a changed mount: the load failed, the last drawing stays');
      assert.equal(stamina(el), '20');
      assert.equal(el._csLoading, null, 'nothing left marked as loading');
      // Put the mount back as drawn for the next case.
      route = null;
      reg.update(el, makeNode(attrsFor({ stamina_current: 20, stamina_max: 30 })));
      await settle();
      el.writes.length = 1;
    }
    // A 404 is Chronicle's answer (the add-on is off), not a failure.
    route = (url) => (/\/layers$/.test(url) ? Promise.resolve(answer({}, 404)) : null);
    reg.update(el, makeNode(attrsFor({ stamina_current: 20, stamina_max: 30 })));
    await settle(60);
    assert.equal(el.writes.length, 2, 'the layers really went away: drawn again');
    reg.destroy(el);
  } finally { route = null; layers = {}; }
});

test('nothing restarts the sheet after destroy', async () => {
  const el = await mounted({ stamina_current: 20, stamina_max: 30 });
  route = (url) => (/\/layers$/.test(url) ? later(100, answer({})) : null);
  try {
    reg.update(el, makeNode(attrsFor({ stamina_current: 6, stamina_max: 30 })));
    reg.destroy(el);
    fetches = [];
    const writes = el.writes.length;
    cs.wroteHere(reg, el);
    reg.update(el, makeNode(attrsFor({ stamina_current: 6, stamina_max: 30 })));
    await settle(200);
    assert.equal(el.writes.length, writes, 'no drawing after destroy');
    assert.ok(!fetches.some((u) => /\/layers$|\/fields$/.test(u)), 'a save or check resolving late starts no load');
  } finally { route = null; }
});
