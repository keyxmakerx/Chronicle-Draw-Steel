#!/usr/bin/env node
/**
 * The hero sheet's update(el, fresh) hook: Chronicle refreshes a page in
 * place when someone saves it and hands each mounted widget its fresh mount.
 * An unchanged mount must leave the drawing alone; a changed one redraws
 * over the old drawing without blanking it, keeping the reader's dashboard
 * view; an open editor holds the redraw back; nothing leaks listeners.
 *
 * Run: `node --test tools/test-character-sheet-refresh.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
require('../widgets/character-sheet.js');
const reg = C.registry['character-sheet'];

// Paper render without the engine's DOM work: the sheet's own markup is
// what the assertions read.
C.sheetMotion = { mount() {}, rescan() {} };

// Answers by URL; `rules` is what the hero's choice rules say right now.
let rules = { choice_breaks: [], choice_waiting: [] };
let fetches = [];
C.apiFetch = (url) => {
  fetches.push(url);
  const body = /\/fields$/.test(url) ? rules : {};
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
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
    querySelectorAll: (sel) => (/data-cs-ed-host|data-cs-pick-fold/.test(sel) ? held : [])
  });
  Object.defineProperty(el, 'innerHTML', { get: () => html, set(v) { html = v; el.writes.push(v); } });
  return el;
}
const live = (el) => el._fns.length;
// The stamina the dashboard shows, read from the drawn markup.
const stamina = (el) => (el.innerHTML.match(/data-v="stamina">(-?\d+)</) || [])[1];
const settle = (ms) => new Promise((ok) => setTimeout(ok, ms || 30));

async function mounted(fields) {
  const el = makeMount(attrsFor(fields));
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
