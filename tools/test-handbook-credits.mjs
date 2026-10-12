// test-handbook-credits.mjs — the Credits chapter shows the MCDM team as
// printed, the licence notice word for word, rule counts that match the data
// files, and a roll that opens over the page and closes cleanly.
//
// Run: node --test tools/test-handbook-credits.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl } from './_xss-harness.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);

const DATA = json('data/credits.json');
const NOTICE = 'Chronicle Draw Steel is an independent product published under the DRAW STEEL Creator License ' +
  'and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2026 MCDM Productions, LLC.';

installDom();
globalThis.window = globalThis;
globalThis.Chronicle = makeChronicle();
const Credits = require('../widgets/handbook-credits.js');
const def = globalThis.Chronicle.registry['handbook-credits'];
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the team is the ten names and roles as MCDM print them, in order', () => {
  assert.deepEqual(Credits.teamFrom(DATA), [
    { name: 'Willy Abeel', role: 'Design' },
    { name: 'Lars Bakke', role: 'Development and Production' },
    { name: 'Jerod M. Bennett', role: 'Technology' },
    { name: 'Grace Cheung', role: 'Art' },
    { name: 'Matt Colville', role: 'Writing & Design' },
    { name: 'Robert Djordjevich', role: 'Design' },
    { name: 'Nick De Spain', role: 'Art' },
    { name: 'Josh Gertz', role: 'Production' },
    { name: 'Jason Hasenauer', role: 'Art & Art Direction' },
    { name: 'James Introcaso', role: 'Lead Game Design' },
  ]);
  for (const it of DATA.filter((d) => d.properties.group === 'mcdm-team')) {
    assert.match(it.source, /Encounters/, `${it.slug} names where the name was copied from`);
  }
});

test('the rule counts match the data files they count', () => {
  const t = Credits.tallyFrom(DATA);
  assert.deepEqual(t, {
    abilities: json('data/abilities.json').length,
    ancestries: json('data/ancestries.json').length,
    kits: json('data/kits.json').length,
    animalTraits: json('data/animal-traits.json').length,
  });
});

test('the notice is the licence wording, word for word, everywhere it is shown', () => {
  assert.equal(Credits.NOTICE, NOTICE);
  // The cover carries it too, drawn as paths, so its title says what it is.
  assert.match(read('book/art/cover.svg'), /<title>Draw Steel Handbook<\/title>/);
});

test('bad data gives no team and no counts rather than a guess', () => {
  assert.deepEqual(Credits.teamFrom(null), []);
  assert.deepEqual(Credits.teamFrom([{ name: 'X', properties: { group: 'other', role: 'Y' } }]), []);
  assert.equal(Credits.tallyFrom([{ slug: 'rules-tally', properties: { abilities: 'many' } }]), null);
});

test('the widget registers under the slug the Credits chapter names', () => {
  assert.ok(def && typeof def.init === 'function' && typeof def.destroy === 'function');
  assert.match(read('book/chapters/credits.yaml'), /widget: handbook-credits/);
  assert.match(read('book/book.yaml'), /- credits\n/);
  const manifest = json('manifest.json');
  assert.ok(manifest.widgets.some((w) => w.slug === 'handbook-credits' && w.script_file === 'widgets/handbook-credits.js'));
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

test('with a campaign it reads credits.json over the systems route and lists every name', async () => {
  const urls = [];
  globalThis.Chronicle.apiFetch = (u) => { urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(DATA) }); };
  const el = makeEl();
  def.init(el, { campaign_id: 'c 1' });
  await settle();
  assert.deepEqual(urls, ['/campaigns/c%201/systems/drawsteel/data/credits.json']);
  for (const p of Credits.teamFrom(DATA)) assert.ok(el.innerHTML.includes(p.name), p.name);
  assert.ok(el.innerHTML.includes(Credits.SHOP));
  def.destroy(el);
  assert.equal(el.__hbc, null);
});

test('names that fail to load still show the licence notice', async () => {
  globalThis.Chronicle.apiFetch = () => Promise.resolve({ ok: false, status: 500 });
  const el = makeEl();
  def.init(el, { campaignId: 'c' });
  await settle(); await settle();
  assert.match(el.innerHTML, /could not load the names/);
  assert.ok(el.innerHTML.includes('not affiliated with MCDM Productions, LLC'));
  def.destroy(el);
});

test('no MCDM art: the widget and cover draw only our own shapes', () => {
  const src = read('widgets/handbook-credits.js') + read('book/art/cover.svg');
  assert.doesNotMatch(src, /<image\b|xlink:href="http|href="https?:[^"]*\.(png|jpe?g|webp|svg)"/i);
});
