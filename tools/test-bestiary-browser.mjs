#!/usr/bin/env node
/**
 * The bestiary viewer (widgets/bestiary-browser.js).
 *
 * A campaign's Creature pages are written by anyone who can edit them, so
 * every field the viewer draws, in a row, an open stat block, a hover card or
 * the tray, must be escaped for its context. These tests pin that, plus the
 * filtering, the roll rule and that the Monsters book's stat blocks all draw.
 *
 * Run: `node --test tools/test-bestiary-browser.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, FakeRef, assertNoInjection, assertNoAttrBreakout } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const SB = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = SB;
const B = require('../widgets/bestiary-browser.js');
const data = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const REFS = { orgs: data('organization-templates.json'), roles: data('role-templates.json') };

const XSS = '<img src=x onerror=alert(document.cookie)>';
const BREAKOUT = 'x" onfocus="alert(document.cookie)';

function hostile(v) {
  return B.fromEntity({
    id: '1" onclick="x', name: v,
    fields_data: {
      level: 2, organization: v, role: v, size: v, keywords: v, ev: v, movement: v, with_captain: v,
      traits: JSON.stringify([{ name: v, description: v }]),
      abilities_json: JSON.stringify([{ name: v, type: 'signature', keywords: [v], distance: v, target: v, power_roll: '2d10 + 2', tier1: v, tier2: v, tier3: v, trigger: v, effect: v }]),
      villain_actions_json: JSON.stringify([{ name: v, order: 'opener', effect: v }])
    }
  });
}

const CTX = (row) => ({ rows: { [row.key]: row }, ref: new FakeRef(), refs: REFS, inst: 'bb1', campaignId: '7', canAdd: true, added: {}, tray: true });

test('a hostile creature cannot inject through its row, open stat block or foot', () => {
  for (const v of [XSS, BREAKOUT]) {
    const row = hostile(v);
    const html = B.rowHtml(row, true, CTX(row));
    // An escaped tag inside an attribute value is inert, so each payload is
    // checked for what it attempts: a raw tag, or a quote breaking out.
    if (v === XSS) assertNoInjection(assert, html, 'row');
    else assertNoAttrBreakout(assert, html, 'row');
  }
});

test('a hostile creature cannot inject through its hover cards or pinned cards', () => {
  for (const v of [XSS, BREAKOUT]) {
    const row = hostile(v);
    const ctx = CTX(row);
    for (const key of ['cr|' + row.key, 'ab|' + row.key + '|a0', 'ab|' + row.key + '|t0', 'ab|' + row.key + '|v0']) {
      const card = B.cardFor(key, ctx);
      assert.ok(card, key);
      if (v === XSS) assertNoInjection(assert, card.body, key);
      else assertNoAttrBreakout(assert, card.body, key);
    }
    const tray = B.pinsHtml([{ key: 'cr|' + row.key }, { key: 'ab|' + row.key + '|a0' }], ctx);
    if (v === XSS) assertNoInjection(assert, tray, 'tray');
    else assertNoAttrBreakout(assert, tray, 'tray');
  }
});

test('a roll of a hostile ability cannot inject through the toast or the log', () => {
  const row = hostile(XSS);
  const r = B.rollAbility(row, 'a0', () => 0.5);
  assertNoInjection(assert, B.rollToastHtml(r, null), 'toast');
  assertNoInjection(assert, B.rollsHtml([r], null), 'log');
});

test('what was typed in the search box cannot break out of it', () => {
  const html = B.filterBarHtml({ q: BREAKOUT, src: 'all' }, [hostile('x')], { uid: 'bb1', book: true });
  assertNoAttrBreakout(assert, html, 'search');
});

test('the row key a page id makes is attribute-safe', () => {
  assert.match(hostile('x').key, /^c[A-Za-z0-9_-]+$/);
});

// ── Filtering ──

const ROWS = [
  B.fromEntity({ id: 1, name: 'Grak', fields_data: { level: 3, organization: 'leader', ev: 20, keywords: 'Goblin', abilities_json: JSON.stringify([{ name: 'Cleaver' }]) } }),
  B.fromBook({ slug: 'goblin-sniper', name: 'Goblin Sniper', properties: { level: 1, organization: 'Minion', role: 'Artillery', ev: 3, keywords: 'Goblin, Humanoid', group: 'Goblins' } }),
  B.fromBook({ slug: 'ogre-goon', name: 'Ogre Goon', properties: { level: 5, organization: 'Platoon', role: 'Brute', ev: 14, keywords: 'Giant, Ogre', group: 'Ogres' } })
];
const V = (o) => Object.assign({ q: '', org: '', role: '', src: 'all', lmin: 0, lmax: 0, sort: 'name', dir: 1, only: [] }, o);
const names = (v) => B.visible(ROWS, V(v)).map((r) => r.name);

test('the source, organization, role and level filters each narrow the list', () => {
  assert.deepEqual(names({}), ['Goblin Sniper', 'Grak', 'Ogre Goon']);
  assert.deepEqual(names({ src: 'campaign' }), ['Grak']);
  assert.deepEqual(names({ src: 'book' }), ['Goblin Sniper', 'Ogre Goon']);
  assert.deepEqual(names({ org: 'minion' }), ['Goblin Sniper']);
  assert.deepEqual(names({ role: 'brute' }), ['Ogre Goon']);
  assert.deepEqual(names({ lmin: 2, lmax: 4 }), ['Grak']);
});

test('search matches names, keywords, the book chapter and ability names', () => {
  assert.deepEqual(names({ q: 'goblin' }), ['Goblin Sniper', 'Grak']);
  assert.deepEqual(names({ q: 'ogres' }), ['Ogre Goon']);
  assert.deepEqual(names({ q: 'cleaver' }), ['Grak']);
});

test('sorting by level or EV goes both ways', () => {
  assert.deepEqual(names({ sort: 'level' }), ['Goblin Sniper', 'Grak', 'Ogre Goon']);
  assert.deepEqual(names({ sort: 'ev', dir: -1 }), ['Grak', 'Ogre Goon', 'Goblin Sniper']);
});

test('a compact block lists only the creatures it names, by name or book id', () => {
  assert.deepEqual(names({ only: ['grak', 'ogre-goon'] }), ['Grak', 'Ogre Goon']);
});

test('picking an organization or role explains it from the package’s templates', () => {
  const html = B.explainHtml(V({ org: 'minion', role: 'artillery' }), REFS, 4);
  assert.match(html, /EV is \(2 × level \+ 4\) × 0\.5, for four minions\./);
  assert.match(html, /Artillery/);
  assert.match(html, /4 matches/);
  assert.equal(B.explainHtml(V({}), REFS, 4), '');
  assert.match(B.orgLine('swarm', REFS), /Not a published organization/);
});

// ── Rolls ──

test('a power roll is 2d10 plus the bonus, and a natural 19 or 20 is always tier 3', () => {
  assert.equal(SB.rollTier(5, 5, 1), 1);
  assert.equal(SB.rollTier(6, 6, 0), 2);
  assert.equal(SB.rollTier(8, 8, 1), 3);
  assert.equal(SB.rollTier(10, 9, -8), 3, 'natural 19');
  assert.equal(SB.rollTier(9, 9, -8), 1, 'natural 18 is not');
  const row = B.fromBook({ slug: 'x', name: 'X', properties: { abilities_json: JSON.stringify([{ name: 'Bite', power_roll: '2d10 + 2', tier1: 'a', tier2: 'b', tier3: 'c' }]) } });
  const seq = [0.0, 0.0];
  const r = B.rollAbility(row, 'a0', () => seq.shift());
  assert.deepEqual([r.d1, r.d2, r.bonus, r.total, r.tier, r.result], [1, 1, 2, 4, 1, 'a']);
  assert.equal(B.rollAbility(row, 'a9'), null, 'an unknown ability does not roll');
});

test('a live stat block puts a roll button on each power roll, and only a live one', () => {
  const src = { level: 1, organization: 'minion', abilities_json: JSON.stringify([{ name: 'Bite', power_roll: '2d10 + 2', tier1: 'a' }, { name: 'Gaze', power_roll: 'Might vs. Agility', tier1: 'b' }]) };
  const live = SB.html('X', src, { live: true });
  assert.equal((live.match(/data-sbx-roll="/g) || []).length, 1, 'a roll with no flat bonus gets no button');
  assert.match(live, /data-sbx-roll="a0"/);
  assert.match(live, /data-sbx-ab="a0"/);
  assert.match(live, /data-sbx-org="minion"/);
  assert.ok(!/data-sbx-roll|data-sbx-ab/.test(SB.html('X', src, {})), 'a page’s stat block stays as it was');
});

test('a minion’s EV says it buys four', () => {
  assert.match(SB.html('X', { level: 1, organization: 'minion', ev: 3 }, {}), /EV 3 <span class="sbx-ev-n">for four<\/span>/);
});

// ── Hover cards ──

test('each hover target names its card', () => {
  const el = (attrs, cls, text) => ({ className: cls || '', textContent: text || '', getAttribute: (n) => attrs[n] || null, hasAttribute: (n) => n in attrs });
  assert.equal(B.termKey(el({ 'data-sbx-ab': 'a1' }), 'b1'), 'ab|b1|a1');
  assert.equal(B.termKey(el({ 'data-sbx-org': 'elite' })), 'o|elite');
  assert.equal(B.termKey(el({ 'data-bb-cr': 'cx' })), 'cr|cx');
  assert.equal(B.termKey(el({}, 'ds-ref ds-ref--condition', 'Slowed')), 'g|slowed');
  assert.equal(B.termKey(el({ 'data-ref-id': 'save-ends' }, 'ds-ref'), ''), 'g|save-ends');
  assert.equal(B.termKey(el({ 'data-bb-market': '' })), 'mk');
});

test('the compact block offers no Add and no Pin, only the page link', () => {
  const row = ROWS[1];
  const html = B.bodyHtml(row, { campaignId: '7', canAdd: false, tray: false, added: {}, refs: REFS });
  assert.ok(!/data-bb-add|data-bb-pin/.test(html));
  const page = B.bodyHtml(row, { campaignId: '7', canAdd: true, tray: true, added: {}, refs: REFS });
  assert.match(page, /data-bb-add/);
  assert.match(page, /data-bb-pin="cr\|bgoblin-sniper"/);
});

// ── The book ──

test('every book stat block draws as a live stat block without a gap', () => {
  const book = data('monsters.json').map(B.fromBook);
  assert.ok(book.length > 300);
  for (const row of book) {
    const html = B.rowHtml(row, true, CTX(row));
    assert.ok(!/undefined|NaN|\[object Object\]/.test(html), row.name);
    assert.ok(row.c.level !== null && row.c.ev !== null && row.c.stamina !== null, row.name);
  }
});
