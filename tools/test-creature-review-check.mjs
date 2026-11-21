#!/usr/bin/env node
/**
 * The AI Import review's creature check (DrawSteelStatblock.reviewCheck and
 * Chronicle.sheetChecks.creature): each figure the AI wrote that a published
 * formula covers, beside the formula's figure, and the patch that takes the
 * formula's figure for the ones the director picks. Expected figures come
 * from DrawSteelFormulas, the one evaluation site.
 *
 * Run: `node --test tools/test-creature-review-check.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
const Chronicle = makeChronicle();
globalThis.Chronicle = Chronicle;

const require = createRequire(import.meta.url);
const F = require('../widgets/monster-engine.js').Formulas;
globalThis.DrawSteelFormulas = F;
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const REFS = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
const org = (s) => REFS.orgs.find((o) => o.slug === s);
const role = (s) => REFS.roles.find((r) => r.slug === s);

const SPEAR = { name: 'Hooked Spear', type: 'signature', keywords: ['Melee', 'Strike', 'Weapon'], distance: 'Melee 1', target: 'One creature',
  tier1: '4 damage', tier2: '6 damage; pull 1', tier3: '8 fire damage; pull 2', effect: 'It shifts 1.' };
const HOWL = { name: 'Howl', type: 'maneuver', keywords: ['Area'], distance: '2 burst', target: 'Each enemy', tier1: '1 damage', tier2: '2 damage', tier3: '3 damage' };
const TAUNT = { name: 'Taunt', type: 'action', keywords: ['Ranged'], tier1: 'Pull 1', tier2: 'Pull 2', tier3: 'Pull 3' };

const raider = (extra) => Object.assign({
  level: 1, organization: 'Platoon', role: 'Harrier', ev: F.encounterValue(1, org('platoon')).value,
  stamina: 20, winded: 10, free_strike: '2 damage', speed: 6, abilities_json: JSON.stringify([SPEAR, HOWL, TAUNT])
}, extra || {});
const ALL = ['level', 'organization', 'role', 'ev', 'stamina', 'winded', 'free_strike', 'speed', 'abilities_json'];

const stamina = F.stamina(1, org('platoon'), role('harrier')).value;
const d = F.damageTiers(1, org('platoon'), role('harrier')).value;
const hc = F.highestCharacteristic(1, org('platoon')).value;
const tiers = (add) => [d.tier1 + add, d.tier2 + add, d.tier3 + add].join(' / ');

test('each covered figure the AI wrote sits beside the published formula', () => {
  const r = S.reviewCheck(raider(), REFS, ALL);
  assert.equal(r.note, 'Level 1 Platoon Harrier');
  assert.deepEqual(r.items, [
    { id: 'ev', label: 'Encounter value', ai: String(raider().ev), formula: String(raider().ev), matches: true },
    { id: 'stamina', label: 'Stamina', ai: '20', formula: String(stamina), matches: stamina === 20 },
    { id: 'winded', label: 'Winded', ai: '10', formula: String(Math.floor(stamina / 2)), matches: Math.floor(stamina / 2) === 10 },
    { id: 'free_strike', label: 'Free strike', ai: '2', formula: String(d.tier1), matches: d.tier1 === 2 },
    // A strike adds the highest characteristic; an area ability doesn't.
    { id: 'ability-0', label: 'Hooked Spear', ai: '4 / 6 / 8', formula: tiers(hc), matches: tiers(hc) === '4 / 6 / 8' },
    { id: 'ability-1', label: 'Howl', ai: '1 / 2 / 3', formula: tiers(0), matches: tiers(0) === '1 / 2 / 3' },
  ], 'speed has no formula, and Taunt deals no damage, so neither is checked');
  assert.notEqual(stamina, 20, 'the fixture must differ from the formula to test anything');
});

test('the patch takes the formula only for what the director picked, keeping the AI’s ability words', () => {
  const r = S.reviewCheck(raider({ free_strike: '2 damage, or 4 against a prone target' }), REFS, ALL);
  assert.deepEqual(r.patch([]), {});
  const p = r.patch(['stamina', 'winded', 'free_strike', 'ability-0']);
  assert.equal(p.stamina, stamina);
  assert.equal(p.winded, Math.floor(stamina / 2));
  assert.equal(p.free_strike, d.tier1 + ' damage', 'wording that is not a bare number is replaced whole');
  assert.ok(!('ev' in p));
  const list = JSON.parse(p.abilities_json);
  assert.deepEqual(list[0], Object.assign({}, SPEAR, {
    tier1: (d.tier1 + hc) + ' damage', tier2: (d.tier2 + hc) + ' damage; pull 1', tier3: (d.tier3 + hc) + ' fire damage; pull 2' }));
  assert.deepEqual(list.slice(1), [HOWL, TAUNT], 'abilities not picked are left as the AI wrote them');
  assert.equal(S.reviewCheck(raider({ free_strike: '2' }), REFS, ALL).patch(['free_strike']).free_strike, d.tier1 + ' damage');
});

test('only figures the AI wrote are checked', () => {
  const r = S.reviewCheck(raider(), REFS, ['stamina']);
  assert.deepEqual(r.items.map((i) => i.id), ['stamina']);
  assert.deepEqual(Object.keys(r.patch(['stamina', 'ev', 'ability-0'])), ['stamina']);
});

test('no check where the published formulas don’t cover the creature, or didn’t load', () => {
  assert.equal(S.reviewCheck(raider({ organization: 'Mob' }), REFS, ALL), null, 'unknown organization');
  assert.equal(S.reviewCheck(raider({ level: '' }), REFS, ALL), null, 'no level');
  assert.equal(S.reviewCheck(raider(), { orgs: [], roles: [] }, ALL), null, 'templates missing');
  const swarm = S.reviewCheck(raider({ organization: 'Swarm' }), REFS, ALL);
  assert.ok(!swarm || !swarm.items.some((i) => i.id === 'ev' || i.id === 'stamina' || i.id === 'winded'), 'a swarm’s EV and Stamina are the director’s');
  globalThis.DrawSteelFormulas = undefined;
  try {
    assert.equal(S.reviewCheck(raider(), REFS, ALL), null);
  } finally {
    globalThis.DrawSteelFormulas = F;
  }
});

test('Chronicle.sheetChecks.creature loads the campaign’s templates and checks', async () => {
  const asked = [];
  Chronicle.apiFetch = (url) => {
    asked.push(url);
    const f = url.endsWith('organization-templates.json') ? REFS.orgs : REFS.roles;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(f) });
  };
  const r = await Chronicle.sheetChecks.creature.check(raider(), { campaignId: 'camp-9', written: ['stamina'] });
  assert.deepEqual(asked, ['/campaigns/camp-9/systems/drawsteel/data/organization-templates.json', '/campaigns/camp-9/systems/drawsteel/data/role-templates.json']);
  assert.deepEqual(r.items.map((i) => [i.id, i.formula]), [['stamina', String(stamina)]]);
});

test('a dice or worded free strike is not a match, and the fix replaces the whole value', () => {
  for (const fs of ['2d6', 'Free strike 3, or 5 vs prone', '2 + 1 damage']) {
    const r = S.reviewCheck(raider({ free_strike: fs }), REFS, ['free_strike']);
    const row = r.items.find((i) => i.id === 'free_strike');
    assert.equal(row.matches, false, fs);
    assert.equal(r.patch(['free_strike']).free_strike, d.tier1 + ' damage', fs);
  }
  assert.equal(S.reviewCheck(raider({ free_strike: d.tier1 + ' damage' }), REFS, ['free_strike']).items[0].matches, true);
  assert.equal(S.reviewCheck(raider({ free_strike: String(d.tier1) }), REFS, ['free_strike']).items[0].matches, true);
});

test('abilities whose damage is worded oddly are named in the note, not dropped silently', () => {
  const ODD = { name: 'Corrupt Bite', type: 'action', keywords: ['Melee', 'Strike'], tier1: '3 damage', tier2: '5 damage; push 1', tier3: '7 + 2 corruption damage' };
  const r = S.reviewCheck(raider({ abilities_json: JSON.stringify([ODD, TAUNT]) }), REFS, ALL);
  assert.ok(!r.items.some((i) => i.id.startsWith('ability')));
  assert.match(r.note, /Not checked.*Corrupt Bite/);
  assert.doesNotMatch(r.note, /Taunt/, 'an ability with no damage needs no check');
  const only = S.reviewCheck(raider({ abilities_json: JSON.stringify([ODD]) }), REFS, ['abilities_json']);
  assert.deepEqual(only.items, []);
  assert.match(only.note, /Corrupt Bite/);
});

test('a level outside 1 to 20, or a fraction, gets no check; 11 to 20 are checked like the editor', () => {
  for (const level of [21, 0, 3.5, -1]) assert.equal(S.reviewCheck(raider({ level }), REFS, ALL), null, String(level));
  assert.notEqual(S.reviewCheck(raider({ level: 12 }), REFS, ALL), null);
});

test('the review checks exactly the levels the editor accepts, and the docs and the published data say the same', () => {
  for (let level = 1; level <= 20; level++) {
    const r = S.reviewCheck(raider({ level }), REFS, ALL);
    assert.notEqual(r, null, 'level ' + level);
    assert.equal(F.stamina(level, org('platoon'), role('harrier')).sourced, true, 'the formula covers level ' + level);
  }
  const doc = readFileSync(new URL('../docs/monster-builder.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(doc, /a level outside 1 to 20 gets no check/);
  assert.doesNotMatch(doc, /outside 1 to 10 gets no check/);
  // Neither formula entry names a level range, so nothing narrower than the editor's is published.
  const published = JSON.parse(readFileSync(new URL('../data/monster-building.json', import.meta.url), 'utf8'));
  for (const slug of ['encounter-value-formula', 'stamina-formula']) {
    const e = published.find((x) => x.slug === slug);
    assert.ok(!/level (range|cap|maximum)|levels? \d+ (to|-|through) \d+/i.test(JSON.stringify(e)), slug);
    assert.deepEqual(Object.keys(e.properties).filter((k) => /^(min|max)_?level/.test(k)), [], slug);
  }
});

test('taking Stamina also takes Winded when the AI wrote one, so they cannot disagree', () => {
  const r = S.reviewCheck(raider(), REFS, ALL);
  const p = r.patch(['stamina']);
  assert.equal(p.stamina, stamina);
  assert.equal(p.winded, Math.floor(stamina / 2));
  assert.ok(!('winded' in S.reviewCheck(raider(), REFS, ['stamina']).patch(['stamina'])), 'no Winded written, none added');
});

// ── Figures the AI left out ──────────────────────────────────────────────
// A blank figure starts taken; on an update a figure that matched the formula
// under the old level moves with the new one; any other figure is the
// director's and stays unless they press. Every figure comes from
// DrawSteelFormulas.

const fig = (lvl, o, r) => ({
  ev: F.encounterValue(lvl, org(o)).value,
  stamina: F.stamina(lvl, org(o), role(r)).value,
  free_strike: F.freeStrike(lvl, org(o), role(r)).value,
});
const bare = (extra) => Object.assign({ level: 2, organization: 'Horde', role: 'Harrier', speed: 6 }, extra || {});
const BARE_WRITTEN = ['level', 'organization', 'role', 'speed'];
const byId = (r) => Object.fromEntries(r.items.map((i) => [i.id, i]));

test('a new creature with no figures starts with every figure taken', () => {
  const g = fig(2, 'horde', 'harrier');
  const r = S.reviewCheck(bare(), REFS, BARE_WRITTEN, {});
  const it = byId(r);
  assert.deepEqual(r.items.map((i) => i.id), ['ev', 'stamina', 'winded', 'free_strike']);
  for (const id of ['ev', 'stamina', 'winded', 'free_strike']) {
    assert.equal(it[id].start, 'used', id);
    assert.equal(it[id].blank, true, id);
    assert.equal(it[id].matches, undefined, id);
  }
  assert.equal(it.ev.formula, String(g.ev));
  assert.equal(it.stamina.formula, String(g.stamina));
  assert.equal(it.winded.formula, String(Math.floor(g.stamina / 2)));
  assert.equal(it.free_strike.formula, String(g.free_strike));
  assert.deepEqual(r.patch(['ev', 'stamina', 'winded', 'free_strike']), {
    ev: g.ev, stamina: g.stamina, winded: Math.floor(g.stamina / 2), free_strike: g.free_strike + ' damage' });
  assert.deepEqual(r.patch([]), {}, 'a figure left untaken is not written');
});

test('without the stored fields, a figure already on the page is not touched', () => {
  const r = S.reviewCheck(bare({ ev: 99, stamina: 77 }), REFS, BARE_WRITTEN);
  assert.deepEqual(r.items.map((i) => i.id), ['winded', 'free_strike']);
});

// A level 1 platoon ambusher, every figure the formula's, moved to level 3.
const stored1 = () => { const g = fig(1, 'platoon', 'ambusher'); return { level: 1, organization: 'Platoon', role: 'Ambusher', speed: 6,
  ev: g.ev, stamina: g.stamina, winded: Math.floor(g.stamina / 2), free_strike: g.free_strike + ' damage' }; };
const moved = (st, extra) => Object.assign({}, st, { level: 3 }, extra || {});

test('on an update, a figure that followed the old level moves with the new one', () => {
  const g1 = fig(1, 'platoon', 'ambusher'), g3 = fig(3, 'platoon', 'ambusher');
  assert.notEqual(g1.ev, g3.ev, 'the fixture must move');
  const st = stored1();
  const r = S.reviewCheck(moved(st), REFS, ['level'], st);
  const it = byId(r);
  for (const id of ['ev', 'stamina', 'winded', 'free_strike']) assert.equal(it[id].start, 'used', id);
  assert.equal(it.ev.ai, String(g1.ev));
  assert.equal(it.ev.formula, String(g3.ev));
  assert.equal(it.ev.taken, 'Follows the formula, as at level 1 (was ' + g1.ev + ')');
  assert.equal(it.winded.taken, 'Half the Stamina, as before (was ' + Math.floor(g1.stamina / 2) + ')');
  assert.equal(it.winded.formula, String(Math.floor(g3.stamina / 2)));
  assert.equal(r.patch(['ev']).ev, g3.ev);
});

test('on an update, a figure that did not match the old formula is the director’s and starts off', () => {
  const g3 = fig(3, 'platoon', 'ambusher');
  const st = stored1();
  st.free_strike = String(stored1().free_strike === '99 damage' ? 98 : 99) + ' damage';
  const r = S.reviewCheck(moved(st), REFS, ['level'], st);
  const fs = byId(r).free_strike;
  assert.equal(fs.start, undefined);
  assert.equal(fs.from, 'stored');
  assert.equal(fs.kept, 'Yours, kept. Formula gives ' + g3.free_strike);
  assert.equal(fs.ai, '99');
  assert.deepEqual(r.items.filter((i) => i.start === 'used').map((i) => i.id), ['ev', 'stamina', 'winded']);
});

test('a typed Stamina keeps its Winded too, and a figure already at the new formula is not offered', () => {
  const g3 = fig(3, 'platoon', 'ambusher');
  const st = stored1();
  st.stamina = 31; st.winded = 15; // not the formula's at level 1
  const r = S.reviewCheck(moved(st), REFS, ['level'], st);
  const it = byId(r);
  assert.equal(it.stamina.start, undefined);
  assert.equal(it.winded.start, undefined, 'Winded followed a Stamina nobody computed');
  const same = Object.assign(stored1(), { ev: g3.ev });
  assert.ok(!byId(S.reviewCheck(moved(same), REFS, ['level'], same)).ev, 'already what the formula gives');
});

test('a figure the AI did write is still its own tile and is not duplicated', () => {
  const st = stored1();
  const r = S.reviewCheck(moved(st, { stamina: 41 }), REFS, ['level', 'stamina'], st);
  assert.equal(r.items.filter((i) => i.id === 'stamina').length, 1);
  assert.equal(byId(r).stamina.start, undefined, 'the AI’s own number starts off');
  assert.equal(byId(r).stamina.ai, '41');
});

test('a creature a formula does not cover is left for the director, with a line saying so', () => {
  const swarm = S.reviewCheck(bare({ organization: 'Swarm' }), REFS, BARE_WRITTEN, {});
  assert.deepEqual(swarm.items.map((i) => i.id), ['uncovered']);
  assert.match(swarm.items[0].said, /No published formula covers this creature’s .*Stamina.*Edit stat block/);
  const noRole = S.reviewCheck(bare({ role: '' }), REFS, ['level', 'organization', 'speed'], {});
  const covered = F.stamina(2, org('horde'), null);
  assert.equal(covered.sourced, false, 'the fixture needs a role-less Stamina with no formula');
  assert.ok(byId(noRole).ev.start === 'used' && !byId(noRole).stamina, 'EV is taken; Stamina is not offered');
  assert.match(byId(noRole).uncovered.said, /Stamina/);
  const high = S.reviewCheck(bare({ level: 21 }), REFS, BARE_WRITTEN, {});
  assert.deepEqual(high.items.map((i) => i.id), ['uncovered']);
  assert.match(high.items[0].said, /stop at level 20/);
  assert.equal(S.reviewCheck(raider({ level: 21 }), REFS, ALL, {}), null, 'nothing blank, nothing to say');
});

test('the Chronicle entry passes the stored fields to the check', async () => {
  Chronicle.apiFetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(url.endsWith('organization-templates.json') ? REFS.orgs : REFS.roles) });
  const st = stored1();
  const r = await Chronicle.sheetChecks.creature.check(moved(st), { campaignId: 'camp-9', written: ['level'], stored: st });
  assert.equal(byId(r).ev.start, 'used');
});
