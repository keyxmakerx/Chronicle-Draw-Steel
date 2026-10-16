// test-lichs-lair-in-book.mjs — inside a Handbook page the front page widget
// is only the Lich's Lair pop-up book: How to Play names it, it reads the
// scene and its scripts over the systems route, draws the closed book with
// the scene's own name, builds a board the example player can play in, and
// says plainly when it cannot.
//
// Run: node --test tools/test-lichs-lair-in-book.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl, assertNoAttrBreakout } from './_xss-harness.mjs';

installDom();
globalThis.window = globalThis;
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
const F = require('../widgets/rulebook-frontpage.js');
const def = globalThis.Chronicle.registry['rulebook-frontpage'];
const read = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const FRONT = read('rulebook-frontpage.json');
const EXAMPLES = read('rulebook-examples.json');
const SCENE = FRONT.find((x) => x.slug === 'worked-scene-lichs-lair');
const settle = () => new Promise((r) => setTimeout(r, 0));
const inBook = () => { const el = makeEl(); el.closest = (sel) => (sel === '.rb-wslot' ? {} : null); return el; };
const serve = () => {
  const urls = [];
  globalThis.Chronicle.apiFetch = (u) => {
    urls.push(u);
    const body = u.endsWith('rulebook-frontpage.json') ? FRONT : u.endsWith('rulebook-examples.json') ? EXAMPLES : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  return urls;
};

test('How to Play mounts the Lair through the declared front page widget', () => {
  const chapter = readFileSync(new URL('../book/chapters/how-to-play.yaml', import.meta.url), 'utf8');
  assert.match(chapter, /title: Watch a game\n\s+blocks:[\s\S]*type: widget\n\s+widget: rulebook-frontpage/);
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.widgets.some((w) => w.slug === 'rulebook-frontpage'));
});

test('every part of the scene has a script to play', () => {
  const slugs = new Set(EXAMPLES.map((e) => e.slug));
  for (const p of SCENE.properties.parts) assert.ok(slugs.has(p.play), p.name + ' has no script');
});

test('without the example player the book stays shut and says why', () => {
  delete globalThis.RulebookExamplePlayer;
  const urls = serve();
  const el = inBook();
  def.init(el, { campaign_id: 'c1' });
  assert.equal(urls.length, 0);
  assert.match(el.innerHTML, /could not find its scene player/);
  def.destroy(el);
});

test('without a campaign it fetches nothing and says why', () => {
  globalThis.RulebookExamplePlayer = { mount() { return {}; } };
  const urls = serve();
  const el = inBook();
  def.init(el, {});
  assert.equal(urls.length, 0);
  assert.match(el.innerHTML, /needs a campaign/);
  def.destroy(el);
});

test('with a campaign it reads the scene over the systems route and draws the closed book', async () => {
  globalThis.RulebookExamplePlayer = { mount() { return {}; } };
  const urls = serve();
  const el = inBook();
  def.init(el, { campaign_id: 'c 1' });
  await settle(); await settle();
  assert.ok(urls.includes('/campaigns/c%201/systems/drawsteel/data/rulebook-frontpage.json'));
  assert.ok(urls.includes('/campaigns/c%201/systems/drawsteel/data/rulebook-examples.json'));
  assert.match(el.innerHTML, /data-ll-open/);
  assert.ok(el.innerHTML.includes(SCENE.name));
  def.destroy(el);
  assert.equal(el.__ll, null);
  assert.equal(el.innerHTML, '');
});

test('the board follows the example player contract: a chip and a script per part, both drawers', () => {
  const html = F.lairBoardHTML(SCENE, 'll-t-1');
  const plays = SCENE.properties.parts.map((p) => p.play);
  assert.deepEqual(html.match(/data-rbx-play="[^"]+"/g), plays.map((p) => 'data-rbx-play="' + p + '"'));
  assert.deepEqual(html.match(/data-rbx-script="[^"]+"/g), plays.map((p) => 'data-rbx-script="' + p + '"'));
  for (const hook of ['data-rbx-board-title', 'data-rbx-board-replay', 'data-rbx-lair-table', 'data-rbx-lair-rules', 'data-ll-shut']) {
    assert.ok(html.includes(hook), hook);
  }
});

test('scene text is escaped on the page and on the board', () => {
  const evil = JSON.parse(JSON.stringify(SCENE));
  evil.name = '<img src=x onerror=alert(1)>';
  evil.description = '"><script>x</script>';
  evil.properties.parts[0].name = '<b>x</b>';
  evil.properties.parts[0].play = '"><i>';
  evil.properties.parts[0].note = 'x" onmouseover="alert(1)';
  const html = F.lairTileHTML(evil) + F.lairBoardHTML(evil, 'id');
  // The closed book's own skull is an svg, so look for the payload's tags only.
  assert.ok(!/<img|<script|<b>x|"><i>/i.test(html));
  assertNoAttrBreakout(assert, html, 'lair');
});
