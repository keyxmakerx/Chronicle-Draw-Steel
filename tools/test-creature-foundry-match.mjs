#!/usr/bin/env node
/**
 * The "In Foundry" box's match: which monster in Foundry this creature page
 * is (Chronicle matches each creature page to Foundry's monster of the same
 * name) and whose numbers play. Each state reads as the director needs it,
 * every name is escaped, and each button sends Chronicle the one change it
 * names.
 *
 * Run: `node --test tools/test-creature-foundry-match.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
globalThis.MonsterEngine = Engine;
globalThis.MonsterParty = require('../widgets/monster-party.js');
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;

const XSS = '<img src=x onerror=alert(1)>';
const stalker = { name: 'Stalker', pack: 'Monsters', level: '3', role: 'Harrier', ev: '5' };

test('each state reads as the director needs it', async (t) => {
  const cases = [
    ['no list yet', { state: 'not_reported' }, ['hasn&rsquo;t sent its monster list yet'], ['In play, use']],
    ['nothing alike', { state: 'none' }, ['No monster in Foundry has this name', 'data-sbx-match="search"'], ['In play, use']],
    ['a look-alike waits', { state: 'suggested', monster: stalker }, ['Looks like Foundry&rsquo;s Stalker', 'Monsters compendium · Level 3 · Harrier · EV 5', 'data-sbx-match="confirm"', '>Not the same<'], ['In play, use']],
    ['matched, Foundry plays', { state: 'matched', monster: stalker, use: 'foundry' }, ['Matched to Foundry&rsquo;s Stalker', 'value="foundry" data-sbx-match-use checked', 'house-ruled Stalker', 'Not the same monster', 'Match another']],
    ['matched, in play by default', { state: 'matched', monster: stalker, use: 'page', inPlay: true }, ['value="page" data-sbx-match-use checked', 'keep playing until you switch']],
    ['chosen, no reminder', { state: 'matched', monster: stalker, use: 'page', inPlay: true, useChosen: true }, ['value="page" data-sbx-match-use checked'], ['keep playing until you switch']],
    ['gone from Foundry', { state: 'missing', monster: stalker, use: 'foundry' }, ['Foundry no longer has Stalker', 'plays with its own numbers']],
  ];
  for (const [name, data, wants, notWants = []] of cases) {
    await t.test(name, () => {
      const html = S.matchHtml({ data });
      for (const w of wants) assert.ok(html.includes(w), `${w} in ${html}`);
      for (const w of notWants) assert.ok(!html.includes(w), `${w} not in ${html}`);
    });
  }
  assert.equal(S.matchHtml({ data: null }), '', 'no match shows nothing');
  assert.ok(!S.matchHtml({ data: { state: 'matched', monster: { name: XSS, pack: XSS }, use: 'page' } }).includes('<img'), 'names are escaped');
  const search = S.matchHtml({ data: { state: 'none' }, search: { open: true, q: XSS, results: [{ name: XSS, pack: XSS }] } });
  assert.ok(!search.includes('<img') && search.includes('data-sbx-match="pick" data-sbx-i="0"'), 'search hits are escaped');
});

test('playing Foundry\'s numbers leaves out the send-back toggle', () => {
  const html = S.foundryHtml({ stamina: 140 }, { sendBack: false, match: { data: { state: 'matched', monster: stalker, use: 'foundry' } } });
  assert.ok(html.includes('Foundry places its own Stalker') && !html.includes('data-sbx-fvtt="sendback"'));
  const own = S.foundryHtml({ stamina: 140 }, { sendBack: false, match: { data: { state: 'matched', monster: stalker, use: 'page' } } });
  assert.ok(own.includes('data-sbx-fvtt="sendback"') && own.includes('Matched to Foundry&rsquo;s Stalker'));
});

function fakePanel(respond) {
  const calls = [];
  globalThis.Chronicle.apiFetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve(respond(url, opts));
  };
  const box = { innerHTML: '' };
  const el = { querySelector: (sel) => (sel === '[data-sbx-fvtt-box]' ? box : null) };
  const p = new S.Panel(el, { campaignId: 'c1', entityId: 'e1', isGm: true });
  p.entity = { name: 'Stalker', fields_data: { stamina: 30 } };
  return { p, box, calls };
}

const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

test('loading reads the page\'s match; an older Chronicle shows none', async () => {
  let { p, calls } = fakePanel(() => ok({ match: { state: 'matched', monster: stalker, use: 'foundry' } }));
  await p.loadMatch();
  assert.equal(calls[0].url, '/api/v1/campaigns/c1/entities/e1/foundry-match');
  assert.equal(p.fvtt.match.data.state, 'matched');
  ({ p } = fakePanel(() => ({ ok: false, status: 404 })));
  await p.loadMatch();
  assert.equal(p.fvtt.match.data, null);
  assert.equal(p.fvtt.match.error, '');
});

test('each button sends the change it names', async (t) => {
  const cases = [
    ['confirm a look-alike', { state: 'suggested', monster: stalker }, 'confirm', null, { action: 'match', name: 'Stalker', pack: 'Monsters' }],
    ['not the same', { state: 'matched', monster: stalker, use: 'foundry' }, 'notsame', null, { action: 'not_same', name: 'Stalker' }],
  ];
  for (const [name, data, which, i, want] of cases) {
    await t.test(name, async () => {
      const { p, calls } = fakePanel(() => ok({ match: { state: 'matched', monster: stalker, use: 'foundry' } }));
      p.fvtt.match.data = data;
      await p.matchAct(which, i);
      assert.equal(calls[0].opts.method, 'PUT');
      assert.deepEqual(JSON.parse(calls[0].opts.body), want);
    });
  }
  await t.test('pick from a search', async () => {
    const { p, calls } = fakePanel((url) => (url.includes('foundry-monsters') ? ok({ data: [{ name: 'Stalker Brute', pack: 'Monsters' }] }) : ok({ match: { state: 'matched' } })));
    p.fvtt.match.data = { state: 'none' };
    p.matchAct('search');
    await p.searchMatch('brute');
    assert.ok(calls.some((c) => c.url === '/api/v1/campaigns/c1/foundry-monsters?q=brute'));
    await p.matchAct('pick', '0');
    const put = calls.find((c) => c.opts && c.opts.method === 'PUT');
    assert.deepEqual(JSON.parse(put.opts.body), { action: 'match', name: 'Stalker Brute', pack: 'Monsters' });
    assert.equal(p.fvtt.match.search, null, 'the search closes once matched');
  });
});

test('a refused change says Chronicle\'s reason and keeps the match', async () => {
  const { p, box } = fakePanel(() => ({ ok: false, status: 400, json: () => Promise.resolve({ message: 'this page is not matched to a monster in Foundry' }) }));
  p.fvtt.match.data = { state: 'matched', monster: stalker, use: 'foundry' };
  await p.changeMatch({ action: 'use', use: 'page' });
  assert.equal(p.fvtt.match.data.use, 'foundry');
  assert.ok(box.innerHTML.includes('not matched to a monster in Foundry'));
  const { p: p2, box: box2 } = fakePanel(() => ({ ok: false, status: 500, json: () => Promise.resolve({ message: 'internal detail' }) }));
  p2.fvtt.match.data = { state: 'matched', monster: stalker, use: 'foundry' };
  await p2.changeMatch({ action: 'use', use: 'page' });
  assert.ok(box2.innerHTML.includes('Could not save that') && !box2.innerHTML.includes('internal detail'));
});
