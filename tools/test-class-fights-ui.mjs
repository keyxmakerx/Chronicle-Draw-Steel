// test-class-fights-ui.mjs — the class pop-up books register under the slug
// the Classes chapter names, read their rules over the systems route, draw
// a tile for every class in the data, and say so plainly when they cannot.
//
// Run: node --test tools/test-class-fights-ui.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl } from './_xss-harness.mjs';

installDom();
globalThis.window = globalThis;
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
require('../widgets/class-fights.js');
const def = globalThis.Chronicle.registry['class-fights'];
const DATA = JSON.parse(readFileSync(new URL('../data/class-fights.json', import.meta.url), 'utf8'));
const settle = () => new Promise((r) => setTimeout(r, 0));
const serve = (data) => { const urls = []; globalThis.Chronicle.apiFetch = (u) => { urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(data) }); }; return urls; };

test('the widget registers under the slug the Classes chapter names', () => {
  assert.ok(def && typeof def.init === 'function' && typeof def.destroy === 'function');
  const chapter = readFileSync(new URL('../book/chapters/classes.yaml', import.meta.url), 'utf8');
  assert.match(chapter, /type: widget\n\s+widget: class-fights/);
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const w = manifest.widgets.find((x) => x.slug === 'class-fights');
  assert.ok(w && w.script_file === 'widgets/class-fights.js');
  assert.deepEqual(w.config.map((c) => c.key), ['campaign_id']);
});

test('without a campaign it fetches nothing and says why', () => {
  const urls = serve([]);
  const el = makeEl();
  def.init(el, {});
  assert.equal(urls.length, 0);
  assert.match(el.innerHTML, /need a campaign/);
  def.destroy(el);
});

test('with a campaign it reads class-fights.json over the systems route and draws every class', async () => {
  const urls = serve(DATA);
  const el = makeEl();
  def.init(el, { campaign_id: 'c 1' });
  await settle();
  assert.deepEqual(urls, ['/campaigns/c%201/systems/drawsteel/data/class-fights.json']);
  const classes = DATA.filter((e) => e.properties.kind === 'class-resource');
  const tiles = el.innerHTML.match(/data-clf-pick="[a-z]+"/g) || [];
  assert.deepEqual(tiles, classes.map((e) => 'data-clf-pick="' + e.properties.class + '"'), 'a class in the data has no drawing');
  const first = classes[0].properties;
  assert.ok(el.innerHTML.includes(globalThis.Chronicle.escapeHtml(first.gain_text)));
  assert.match(el.innerHTML, /data-clf-open="censor"/);
  def.destroy(el);
  assert.equal(el.__clf, null);
  assert.equal(el.innerHTML, '');
});

test('data from the server is escaped on the page', async () => {
  const evil = JSON.parse(JSON.stringify(DATA));
  evil.find((e) => e.slug === 'class-resource-censor').properties.quote = '<img src=x onerror=alert(1)>';
  serve(evil);
  const el = makeEl();
  def.init(el, { campaign_id: 'c' });
  await settle();
  assert.ok(!el.innerHTML.includes('<img'), 'a quote from the data reached the page unescaped');
  def.destroy(el);
});

test('rules that fail to load, or come back incomplete, leave the books shut with a plain message', async () => {
  globalThis.Chronicle.apiFetch = () => Promise.resolve({ ok: false, status: 500 });
  let el = makeEl();
  def.init(el, { campaignId: 'c' });
  await settle(); await settle();
  assert.match(el.innerHTML, /could not load the class rules/);
  def.destroy(el);
  serve(DATA.filter((e) => e.slug !== 'power-roll'));
  el = makeEl();
  def.init(el, { campaign_id: 'c' });
  await settle(); await settle();
  assert.match(el.innerHTML, /could not load the class rules/);
  def.destroy(el);
});
