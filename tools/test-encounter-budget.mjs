#!/usr/bin/env node
/**
 * Unit tests for widgets/encounter-budget.js: the pure maths and glue behind
 * the Draw Steel panel in Chronicle's encounter builder. Every figure must
 * come from DrawSteelFormulas or the shipped data; a figure they cannot cover
 * is reported missing and kept out of the total.
 *
 * Run: `node --test tools/test-encounter-budget.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const EB = require('../widgets/encounter-budget.js');
const { Formulas: Fm } = require('../widgets/monster-engine.js');

const read = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const ORGS = read('organization-templates.json');
const RULES = EB.rulesFrom(read('encounter-building.json'));

const ok = (fields) => ({ status: 'ok', entity: { fields_data: fields } });
const hero = (id, level) => ({ id, name: id, entry: level === undefined ? ok({}) : ok({ level }) });
let n = 0;
const row = (name, entityId, count, group, entry) =>
  ({ row: { id: 'r' + (n++), name, entityId, count, group: group || 'A', start: 'seen' }, entry });
const compute = (heroes, creatures) => EB.compute({ heroes, creatures, orgs: ORGS, rules: RULES });
const four = [hero('a', 3), hero('b', 3), hero('c', 3), hero('d', 3)];

test('rules come from the shipped data, not from this file', () => {
  assert.equal(RULES.maxAbove, 2);
  assert.equal(RULES.maxAboveSolo, 1);
  assert.equal(RULES.maxPerHero, 8);
  assert.equal(RULES.maxKinds, 6);
  assert.equal(RULES.minionSet, 4);
  assert.equal(RULES.minionMinSets, 2);
  assert.deepEqual(RULES.victories, { trivial: '0', easy: '1', standard: '1', hard: '2', extreme: '2 or more' });
  assert.equal(EB.rulesFrom([]).maxAbove, null);
});

test('party strength and bands are the published formulas', () => {
  const m = compute(four, []);
  assert.equal(m.party.es, 40);
  assert.equal(m.party.one, 10);
  assert.equal(m.party.count, 4);
  assert.deepEqual(m.bands, Fm.budgetBands(40, 10).value);
  assert.equal(m.max, 70 + 20, "the bar runs two heroes past where extreme starts");
});

// ── Victories and the director's adjustment ─────────────────────────────────

const vhero = (id, level, victories) => ({ id, name: id, entry: ok(victories === undefined ? { level } : { level, victories }) });
const seasoned = (v) => [vhero('a', 3, v), vhero('b', 3, v), vhero('c', 3, v), vhero('d', 3, v)];
const ev54 = () => [row('Pack', 'p', 1, 'A', ok({ level: 3, organization: 'platoon', ev: 54 }))];
const computeN = (heroes, creatures, nudge) => EB.compute({ heroes, creatures, orgs: ORGS, rules: RULES, nudge });

test('the wider level limit and its Victories come from the shipped data', () => {
  assert.equal(RULES.maxAboveVictories, 3);
  assert.equal(RULES.widerLimitVictories, 6);
});

test('every 2 average Victories count as one more hero of the party level', () => {
  const m = compute(seasoned(3), ev54());
  assert.equal(m.party.victoryHeroes, 1);
  assert.equal(m.party.rulesEs, 50);
  assert.equal(m.party.es, 50);
  assert.equal(m.difficulty, 'standard', 'the mockup: 54 EV against four 3rd-level heroes with 3 Victories');
  assert.equal(EB.partyText(m.party), '4 heroes + 1 for Victories');
  assert.equal(EB.changedText(m.party), '');
  assert.equal(compute(seasoned(6), []).party.es, 40 + 30, 'the published example: 6 Victories each gain 30');
  assert.equal(compute(four, ev54()).difficulty, 'hard', 'no Victories on the pages: levels only, as before');
});

test('Victories are averaged across the heroes; a part-way average adds no hero', () => {
  const m = compute([vhero('a', 3, 2), vhero('b', 3, 1)], []);
  assert.equal(m.party.avgVictories, 1.5);
  assert.equal(m.party.victoryHeroes, 0);
  assert.equal(EB.partyText(m.party), '2 heroes (averaging 1.5 Victories; the rules add a hero per 2)');
  assert.equal(EB.partyText(compute([vhero('a', 3, 1)], []).party), '1 hero (averaging 1 Victory; the rules add a hero per 2)');
});

test('a hero page with no Victories counts as 0 and is named', () => {
  const m = compute([vhero('Ana', 3, 4), vhero('Bo', 3, 4), vhero('Cy', 3)], []);
  assert.equal(m.party.avgVictories, 2.7);
  assert.equal(m.party.victoryHeroes, 1);
  assert.ok(m.checks.some((k) => !k.ok && /^Cy: no Victories on that hero page, so counted as 0/.test(k.text)));
  // When no page has Victories the party simply has none; nothing to flag.
  assert.ok(!compute(four, []).checks.some((k) => /no Victories/.test(k.text)));
  // A negative or non-numeric value is treated as no value.
  assert.equal(EB.readHero({ id: 'x' }, ok({ level: 3, victories: -2 })).victories, null);
  assert.equal(EB.readHero({ id: 'x' }, ok({ level: 3, victories: 'lots' })).victories, null);
});

test('the director\'s adjustment moves Strength by whole heroes and is marked as theirs', () => {
  const m = computeN(seasoned(3), ev54(), 1);
  assert.equal(m.party.es, 60);
  assert.equal(m.party.rulesEs, 50);
  assert.equal(m.difficulty, 'easy', 'the mockup for B: Strength 60, Easy');
  assert.equal(EB.changedText(m.party), 'Changed by you (the rules give 50).');
  assert.deepEqual(m.bands, Fm.budgetBands(60, 10).value);
  assert.equal(computeN(seasoned(3), [], -2).party.es, 30);
  assert.equal(EB.nudgeText(0), 'the rules say');
  assert.equal(EB.nudgeText(1), '+1 hero');
  assert.equal(EB.nudgeText(-2), '−2 heroes');
});

test('the adjustment stays within two heroes and never leaves the party weaker than one', () => {
  assert.equal(EB.clampNudge(5), EB.MAX_NUDGE);
  assert.equal(EB.clampNudge(-5), -EB.MAX_NUDGE);
  assert.equal(EB.clampNudge(1.5), 0);
  assert.equal(EB.clampNudge('x'), 0);
  assert.equal(EB.clampNudge(null), 0);
  assert.equal(EB.nudgeFrom({ gm: { extraHeroes: 2 } }), 2);
  assert.equal(EB.nudgeFrom({ gm: {} }), 0);
  assert.equal(EB.nudgeFrom({ public: { extraHeroes: 2 } }), 0, 'only the director half is read');
  assert.equal(EB.nudgeFrom(null), 0);
  const solo = computeN([vhero('a', 3, 0)], [], -2);
  assert.equal(solo.party.es, 10, 'one hero at level 3, however far it is nudged down');
  assert.equal(EB.draftOf({ encounter: {} }, {}, [], RULES, 9).nudge, 2);
});

test('6 or more average Victories widen the level limit to 3; solos keep theirs', () => {
  const lvl6 = (org) => [row('Big', 'b', 1, 'A', ok({ level: 6, organization: org, ev: 20 }))];
  const plain = compute(four, lvl6('platoon'));
  assert.ok(plain.checks.some((k) => !k.ok && /level limit for heroes of level 3: Big/.test(k.text)));
  const vets = compute(seasoned(6), lvl6('platoon'));
  assert.ok(!vets.checks.some((k) => /level limit/.test(k.text)));
  assert.ok(vets.checks.some((k) => k.ok && /more than 3 levels above the heroes, who have 6 or more Victories \(solos 1\)/.test(k.text)));
  const tooHigh = compute(seasoned(6), [row('Huge', 'h', 1, 'A', ok({ level: 7, organization: 'platoon', ev: 20 }))]);
  assert.ok(tooHigh.checks.some((k) => !k.ok && /level 3 with 6 or more Victories: Huge/.test(k.text)));
  const solo = compute(seasoned(6), [row('Dragon', 'd', 1, 'A', ok({ level: 5, organization: 'solo', ev: 60 }))]);
  assert.ok(solo.checks.some((k) => !k.ok && /Dragon \(level 5, solo\)/.test(k.text)));
  // Without the data's numbers the wider limit is never applied.
  const bare = Object.assign({}, RULES, { maxAboveVictories: null });
  const m = EB.compute({ heroes: seasoned(6), creatures: lvl6('platoon'), orgs: ORGS, rules: bare });
  assert.ok(m.checks.some((k) => !k.ok && /level limit/.test(k.text)));
});

test('mixed levels sum per hero; one hero is the rounded average level', () => {
  const m = compute([hero('a', 3), hero('b', 2), hero('c', 4)], []);
  assert.equal(m.party.es, 10 + 8 + 12);
  assert.equal(m.party.avgLevel, 3);
  assert.equal(m.party.one, 10);
});

test('difficulty bands: edges follow the published inclusive rules', () => {
  const at = (ev) => {
    const m = compute(four, [row('X', 'x', 1, 'A', ok({ level: 3, organization: 'platoon', ev }))]);
    return m.difficulty;
  };
  assert.equal(at(29), 'trivial');
  assert.equal(at(30), 'easy');
  assert.equal(at(39), 'easy');
  assert.equal(at(40), 'standard');
  assert.equal(at(50), 'standard');
  assert.equal(at(51), 'hard');
  assert.equal(at(70), 'hard');
  assert.equal(at(71), 'extreme');
});

test('victories line follows the data for the difficulty', () => {
  const m = compute(four, [row('X', 'x', 1, 'A', ok({ level: 3, organization: 'platoon', ev: 75 }))]);
  assert.equal(m.difficulty, 'extreme');
  assert.equal(m.victories, 'Worth 2 or more Victories');
  assert.equal(EB.victoriesText('0'), 'Worth no Victories');
  assert.equal(EB.victoriesText('1'), 'Worth 1 Victory');
});

test('a page EV is used as set; counts multiply it', () => {
  const m = compute(four, [row('Hobgoblin', 'h', 2, 'B', ok({ level: 3, organization: 'platoon', ev: 10 }))]);
  assert.equal(m.creatures[0].cost, 20);
  assert.equal(m.total, 20);
  assert.equal(m.creatures[0].evFrom, 'page');
});

test('a page EV that differs from the formula is kept and noted', () => {
  const m = compute(four, [row('Odd', 'o', 1, 'A', ok({ level: 3, organization: 'platoon', ev: 12 }))]);
  assert.equal(m.total, 12);
  assert.match(m.creatures[0].note, /formula gives 10/);
});

test('no EV on the page: the published formula fills in when level and organization exist', () => {
  const m = compute(four, [row('Chief', 'c', 1, 'A', ok({ level: 3, organization: 'leader' }))]);
  assert.equal(m.creatures[0].evFrom, 'formula');
  assert.equal(m.creatures[0].unitEv, Fm.encounterValue(3, ORGS.find((o) => o.slug === 'leader')).value);
  assert.equal(m.total, 20);
});

test('minions are bought in fours: five minions cost two sets', () => {
  const page = ok({ level: 2, organization: 'minion', ev: 4 });
  const c = (count) => compute(four, [row('Archer', 'm', count, 'C', page)]);
  assert.equal(c(1).total, 4);
  assert.equal(c(4).total, 4);
  assert.equal(c(5).total, 8);
  assert.equal(c(8).total, 8);
  assert.equal(c(9).total, 12);
  assert.ok(c(5).checks.some((k) => !k.ok && /bought 4 at a time/.test(k.text) && /2 sets/.test(k.text)));
  assert.ok(c(8).checks.some((k) => k.ok && /Minions come in fours/.test(k.text)));
});

test('a single set of minions draws the published advice for at least two', () => {
  const page = ok({ level: 2, organization: 'minion', ev: 4 });
  const one = compute(four, [row('Archer', 'm', 4, 'C', page)]);
  const two = compute(four, [row('Archer', 'm', 8, 'C', page)]);
  assert.ok(one.checks.some((k) => /at least 2 sets/.test(k.text)));
  assert.ok(!two.checks.some((k) => /at least 2 sets/.test(k.text)));
});

test('missing data is named and left out of the total, never guessed', () => {
  const m = compute(four, [
    row('Typed by hand', '', 2, 'A', null),
    row('Blank page', 'b', 1, 'A', ok({ level: 3, organization: 'swarm' })),
    row('No stats', 'n', 1, 'B', ok({})),
    row('Gone', 'g', 1, 'B', { status: 'failed' }),
    row('Real', 'r', 1, 'B', ok({ level: 3, organization: 'platoon', ev: 10 }))
  ]);
  assert.equal(m.total, 10);
  assert.equal(m.unpriced, 5);
  const byName = Object.fromEntries(m.creatures.map((c) => [c.name, c]));
  assert.match(byName['Typed by hand'].reason, /No page, so no EV/);
  assert.match(byName['Blank page'].reason, /No EV on this page yet/);
  assert.match(byName['No stats'].reason, /No EV on this page yet/);
  assert.match(byName['Gone'].reason, /could not be read/);
  for (const k of ['Typed by hand', 'Blank page', 'No stats', 'Gone']) {
    assert.equal(byName[k].cost, null);
    assert.ok(m.checks.some((c) => !c.ok && c.text.indexOf(k + ':') === 0), k);
  }
});

test('creatures still loading are not called missing', () => {
  const m = compute(four, [row('Slow', 's', 1, 'A', null)]);
  assert.equal(m.creatures[0].state, 'loading');
  assert.ok(!m.checks.some((c) => /Slow/.test(c.text)));
});

test('a hero with no level is left out of Strength and named', () => {
  const m = compute([hero('a', 3), hero('b', undefined), hero('c', 3)], []);
  assert.equal(m.party.es, 20);
  assert.equal(m.party.count, 2);
  assert.ok(m.checks.some((c) => !c.ok && /b: no level on its page/.test(c.text)));
});

test('no hero levels at all: no party, no difficulty, and the creatures still list', () => {
  const m = compute([hero('a', undefined)], [row('X', 'x', 1, 'A', ok({ level: 1, organization: 'platoon', ev: 6 }))]);
  assert.equal(m.party, null);
  assert.equal(m.difficulty, null);
  assert.equal(m.total, 6);
});

test('initiative groups: EV per group against one hero to two heroes', () => {
  const plat = ok({ level: 3, organization: 'platoon', ev: 10 });
  const m = compute(four, [
    row('A1', 'a1', 3, 'A', plat),
    row('B1', 'b1', 1, 'B', plat),
    row('B2', 'b2', 1, 'B', ok({ level: 3, organization: 'leader', ev: 20 })),
    row('C1', 'c1', 1, 'C', ok({ level: 3, organization: 'solo', ev: 60 }))
  ]);
  const g = Object.fromEntries(m.groups.map((x) => [x.group, x]));
  assert.equal(g.A.ev, 30); assert.equal(g.A.off, true);
  assert.equal(g.B.ev, 30); assert.equal(g.B.off, true);
  assert.deepEqual(g.A.band, [10, 20]);
  assert.equal(g.C.ev, 60); assert.equal(g.C.off, false, 'a single creature may exceed the band');
  const fit = compute(four, [row('F', 'f', 2, 'A', plat)]);
  assert.equal(fit.groups[0].ev, 20);
  assert.equal(fit.groups[0].off, false);
  const low = compute(four, [row('Low', 'l', 2, 'A', ok({ level: 1, organization: 'platoon', ev: 3 }))]);
  assert.equal(low.groups[0].off, true);
});

test('a group with unpriced members is only flagged when already over', () => {
  const plat = ok({ level: 3, organization: 'platoon', ev: 4 });
  const m = compute(four, [row('P', 'p', 1, 'A', plat), row('Typed', '', 1, 'A', null)]);
  assert.equal(m.groups[0].ev, 4);
  assert.equal(m.groups[0].unpriced, 1);
  assert.equal(m.groups[0].off, false, 'under the band, but a creature is missing');
});

test('level limit check: 2 above for most, 1 above for a solo', () => {
  const m = compute(four, [
    row('Tall', 't', 1, 'A', ok({ level: 6, organization: 'platoon', ev: 10 })),
    row('Boss', 'b', 1, 'B', ok({ level: 5, organization: 'solo', ev: 60 })),
    row('Fine', 'f', 1, 'C', ok({ level: 5, organization: 'platoon', ev: 10 }))
  ]);
  const w = m.checks.find((c) => !c.ok && /level limit/.test(c.text));
  assert.ok(w && /Tall \(level 6\)/.test(w.text) && /Boss \(level 5, solo\)/.test(w.text) && !/Fine/.test(w.text));
  const clean = compute(four, [row('Fine', 'f', 1, 'C', ok({ level: 5, organization: 'platoon', ev: 10 }))]);
  assert.ok(clean.checks.some((c) => c.ok && /No creature is more than 2 levels/.test(c.text)));
});

test('creature count and stat block limits', () => {
  const plat = ok({ level: 3, organization: 'platoon', ev: 1 });
  const m = compute([hero('a', 3)], [row('Many', 'm', 9, 'A', plat)]);
  assert.ok(m.checks.some((c) => !c.ok && /9 creatures, over 8 per hero/.test(c.text)));
  assert.ok(m.checks.some((c) => !c.ok && /at least half should be minions/.test(c.text)));
  const kinds = [];
  for (let i = 0; i < 7; i++) kinds.push(row('K' + i, 'k' + i, 1, 'A', plat));
  assert.ok(compute(four, kinds).checks.some((c) => !c.ok && /7 different stat blocks/.test(c.text)));
});

test('draftOf maps the event to cached pages and tolerates a bare detail', () => {
  const cache = { h1: ok({ level: 2 }), c1: ok({ level: 2, organization: 'horde', ev: 4 }) };
  const d = EB.draftOf({ encounter: { heroes: [{ id: 'h1', name: 'H' }], creatures: [
    { id: 'r1', entityId: 'c1', name: 'W', count: 4, group: 'A' }, { id: 'r2', entityId: '', name: 'Typed', count: 1, group: 'A' }] } }, cache, ORGS, RULES);
  assert.equal(d.heroes[0].entry, cache.h1);
  assert.equal(d.creatures[0].entry, cache.c1);
  assert.equal(d.creatures[1].entry, null);
  assert.deepEqual(EB.draftOf({}, {}, null, null).heroes, []);
});

// A bare-bones DOM, enough to run draw() and check user text stays text.
function fakeDom() {
  const mk = (tag) => ({
    tag, className: '', children: [], style: {}, attrs: {}, _t: '',
    set textContent(v) { this._t = String(v); if (v === '') this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); },
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
  });
  globalThis.document = {
    createElement: mk, createTextNode: (t) => ({ textContent: t }),
    head: mk('head'), querySelector: () => null,
  };
}

test('the slot is filled with text, and a hostile name never becomes markup', () => {
  fakeDom();
  const slot = globalThis.document.createElement('div');
  const hostile = '<img src=x onerror=alert(1)>';
  const m = compute(four, [row(hostile, '', 1, 'A', null)]);
  // draw is internal; reach it through the listener with a stubbed Chronicle.
  globalThis.Chronicle = { apiFetch: () => new Promise(() => {}) };
  const listeners = {};
  globalThis.document.addEventListener = (t, f) => { listeners[t] = f; };
  delete require.cache[require.resolve('../widgets/encounter-budget.js')];
  const Fresh = require('../widgets/encounter-budget.js');
  Fresh.onDraft({ detail: { campaignId: 'c1', slot, encounter: { id: 'e', name: 'E', heroes: [{ id: 'h', name: 'H' }],
    creatures: [{ id: 'r', entityId: '', name: hostile, count: 1, group: 'A', start: 'seen' }] } } });
  assert.ok(slot.children.length === 1);
  assert.ok(slot.textContent.indexOf(hostile) >= 0);
  const walk = (el) => [el].concat((el.children || []).flatMap(walk));
  assert.ok(walk(slot).every((e) => e.innerHTML === undefined), 'no element took innerHTML');
  assert.ok(m.creatures[0].state === 'missing');
  delete globalThis.Chronicle;
});

test('the builder’s stages learn each creature’s forms from the gm half, in order', async () => {
  const docs = {
    '/campaigns/c1/entities/q/system-state/drawsteel/forms': { gm: { order: ['un', 'Bad!', 'sw'] }, public: {} },
    '/campaigns/c1/entities/q/system-state/drawsteel/form-un': { gm: { id: 'un', name: 'Unmasked' } },
    '/campaigns/c1/entities/q/system-state/drawsteel/form-sw': { gm: { id: 'other', name: 'Mismatched' } },
  };
  globalThis.Chronicle = {
    apiFetch: (url) => Promise.resolve(docs[url]
      ? { ok: true, json: () => Promise.resolve(docs[url]) }
      : { ok: true, json: () => Promise.resolve({ gm: {}, public: {} }) }),
  };
  try {
    const got = await new Promise((resolve) => EB.onForms({ detail: { campaignId: 'c1', entityIds: ['q', 'none'], reply: resolve } }));
    assert.deepEqual(got, { q: [{ id: 'un', name: 'Unmasked' }], none: [] });
  } finally {
    delete globalThis.Chronicle;
  }
});
