// test-negotiation-audience-ui.mjs — the audience widget registers under the
// slug the Handbook names, reads its rules over the systems route, and says
// so plainly when it cannot.
//
// Run: node --test tools/test-negotiation-audience-ui.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl } from './_xss-harness.mjs';

installDom();
globalThis.window = globalThis;
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
require('../widgets/negotiation-audience.js');
const def = globalThis.Chronicle.registry['negotiation-audience'];
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the widget registers under the slug the Negotiation chapter names', () => {
  assert.ok(def && typeof def.init === 'function' && typeof def.destroy === 'function');
  const chapter = readFileSync(new URL('../book/chapters/negotiation.yaml', import.meta.url), 'utf8');
  assert.match(chapter, /widget: negotiation-audience/);
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.widgets.some((w) => w.slug === 'negotiation-audience' && w.script_file === 'widgets/negotiation-audience.js'));
});

test('without a campaign it fetches nothing and says why', () => {
  let calls = 0;
  globalThis.Chronicle.apiFetch = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); };
  const el = makeEl();
  def.init(el, {});
  assert.equal(calls, 0);
  assert.match(el.innerHTML, /needs a campaign/);
  def.destroy(el);
});

test('with a campaign it reads negotiation.json over the systems route', async () => {
  const urls = [];
  const data = JSON.parse(readFileSync(new URL('../data/negotiation.json', import.meta.url), 'utf8'));
  globalThis.Chronicle.apiFetch = (u) => { urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(data) }); };
  const el = makeEl();
  def.init(el, { campaign_id: 'c 1' });
  await settle();
  assert.deepEqual(urls, ['/campaigns/c%201/systems/drawsteel/data/negotiation.json']);
  assert.match(el.innerHTML, /An audience with the King/);
  def.destroy(el);
  assert.equal(el.__nga, null);
});

test('rules that fail to load leave the book shut with a plain message', async () => {
  globalThis.Chronicle.apiFetch = () => Promise.resolve({ ok: false, status: 500 });
  const el = makeEl();
  def.init(el, { campaignId: 'c' });
  await settle(); await settle();
  assert.match(el.innerHTML, /could not load the negotiation rules/);
  def.destroy(el);
});
