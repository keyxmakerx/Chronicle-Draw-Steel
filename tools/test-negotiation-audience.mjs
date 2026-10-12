// test-negotiation-audience.mjs — the king's audience moves interest and
// patience exactly as data/negotiation.json says, and every line it offers
// is one it can resolve.
//
// Run: node --test tools/test-negotiation-audience.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const A = require('../widgets/negotiation-audience.js');
const DATA = JSON.parse(readFileSync(new URL('../data/negotiation.json', import.meta.url), 'utf8'));
const R = A.rulesFrom(DATA);
const prop = (s) => DATA.find((e) => e.slug === s).properties;
const line = (id) => A.LINES.find((l) => l.id === id);
// Dice that give a chosen total for a hero's characteristic bonus.
const diceFor = (total, bonus) => { const n = total - bonus; return [Math.ceil(n / 2), Math.floor(n / 2)]; };

test('the rules come from negotiation.json, and a missing table means no rules', () => {
  assert.ok(R);
  assert.deepEqual(R.appeal[2], prop('argument-appeal-to-motivation').tiers.t2);
  assert.deepEqual(R.uncover[1], prop('uncovering-motivations').tiers.t1);
  assert.equal(R.offers[3], prop('offer-interest-3').response);
  assert.equal(A.rulesFrom(DATA.filter((e) => e.slug !== 'argument-no-motivation')), null);
  assert.equal(A.rulesFrom(DATA.filter((e) => e.slug !== 'offer-interest-0')), null);
  assert.equal(A.rulesFrom(null), null);
});

test('the audience opens neutral, with one more patience for the king\'s own tongue', () => {
  const G = A.newGame(R);
  assert.equal(G.interest, prop('attitude-neutral').interest);
  assert.equal(G.patience, prop('attitude-neutral').patience + 1);
});

test('power roll tiers break at 11 and 16', () => {
  assert.deepEqual([11, 12, 16, 17].map(A.tierOf), [1, 2, 2, 3]);
});

test('an appeal to an unused motivation moves by the appeal table, tier by tier', () => {
  for (const tier of [1, 2, 3]) {
    const G = A.newGame(R), before = { i: G.interest, p: G.patience };
    const out = A.argue(R, G, line('legacy1'), diceFor([11, 14, 18][tier - 1], 2));
    const t = prop('argument-appeal-to-motivation').tiers['t' + tier];
    assert.equal(out.kind, 'appeal');
    assert.equal(out.roll.tier, tier);
    assert.equal(G.interest, before.i + t.interest);
    assert.equal(G.patience, before.p + t.patience);
    assert.ok(G.used.legacy && G.shown.legacy);
  }
});

test('a second try at the same motivation costs patience, even after a tier 1', () => {
  const G = A.newGame(R);
  A.argue(R, G, line('legacy1'), diceFor(5, 2));
  const p = G.patience, i = G.interest;
  const out = A.argue(R, G, line('legacy2'), diceFor(20, 1));
  assert.equal(out.kind, 'reused');
  assert.equal(out.roll, null);
  assert.equal(G.interest, i + prop('argument-motivation-reused').interest);
  assert.equal(G.patience, p + prop('argument-motivation-reused').patience);
});

test('a pitfall fails without a roll and shows itself', () => {
  const G = A.newGame(R), i = G.interest, p = G.patience;
  const out = A.argue(R, G, line('greed1'), [10, 10]);
  assert.equal(out.kind, 'pitfall');
  assert.equal(out.roll, null);
  assert.equal(G.interest, i + prop('argument-pitfall-used').interest);
  assert.equal(G.patience, p + prop('argument-pitfall-used').patience);
  assert.ok(G.shown.greed);
});

test('an argument with no motivation is the harder table, and a natural 19 or 20 keeps patience', () => {
  const G = A.newGame(R), p = G.patience, i = G.interest;
  const out = A.argue(R, G, line('just1'), diceFor(17, 0));
  assert.equal(out.kind, 'none');
  assert.equal(G.interest, i + prop('argument-no-motivation').tiers.t3.interest);
  assert.equal(G.patience, p + prop('argument-no-motivation').tiers.t3.patience);
  const H = A.newGame(R), hp = H.patience;
  const nat = A.argue(R, H, line('peace1'), [10, 9]);
  assert.ok(nat.keptPatience);
  assert.equal(H.patience, hp);
});

test('a lie that fails to raise interest is caught for one more interest', () => {
  const G = A.newGame(R), i = G.interest;
  const out = A.argue(R, G, line('lie1'), diceFor(13, 2));
  assert.ok(out.caught);
  assert.equal(G.interest, Math.max(0, i + prop('argument-no-motivation').tiers.t2.interest + prop('argument-caught-in-lie').interest));
  const H = A.newGame(R);
  assert.ok(!A.argue(R, H, line('lie1'), diceFor(18, 2)).caught);
});

test('reading the king uses the uncovering table, then waits for an argument', () => {
  const G = A.newGame(R), p = G.patience;
  G.who = 'orden';
  const low = A.read(R, G, diceFor(5, 0));
  assert.equal(G.patience, p + prop('uncovering-motivations').tiers.t1.patience);
  assert.equal(low.learned, null);
  assert.equal(G.canRead, false);
  A.argue(R, G, line('prot1'), diceFor(14, 1));
  assert.equal(G.canRead, true);
  const hi = A.read(R, G, diceFor(17, 0));
  assert.equal(hi.learned.kind, 'p', 'a hero who reads well learns the pitfall first');
});

test('asking hints at motivations only, once each', () => {
  const G = A.newGame(R);
  assert.equal(A.ask(G).k, 'legacy');
  assert.ok(G.asked);
  const H = A.newGame(R); H.shown = { legacy: true, protection: true };
  assert.equal(A.ask(H), null);
});

test('the talk ends by Keep Going or Stop', () => {
  assert.equal(A.ending({ interest: 0, patience: 3 }, true), 'refused');
  assert.equal(A.ending({ interest: 5, patience: 3 }, true), 'final');
  assert.equal(A.ending({ interest: 3, patience: 0 }, false), 'final');
  assert.equal(A.ending({ interest: 3, patience: 2 }, true), 'offer');
  assert.equal(A.ending({ interest: 3, patience: 2 }, false), null);
});

test('every line can be resolved, and a round never offers two on one subject', () => {
  for (const l of A.LINES) assert.ok(A.HEROES.every((h) => typeof h.st[l.ch] === 'number'), l.id);
  const G = A.newGame(R);
  for (let r = 0; r < 4; r++) {
    const show = A.linesNow(G);
    assert.equal(new Set(show.map((l) => l.k)).size, show.length);
    if (show[0]) A.argue(R, G, show[0], [5, 5]);
  }
  for (let i = 0; i <= 5; i++) assert.equal(typeof A.OFFER_TEXT[i], 'string');
});
