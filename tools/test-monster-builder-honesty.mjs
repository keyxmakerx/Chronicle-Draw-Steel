// test-monster-builder-honesty.mjs — the monster builder must not present
// unsourced arithmetic as validated Draw Steel math.
//
// Where a published formula (data/monster-building.json,
// data/encounter-building.json) covers a figure the builder uses it; where none
// does, the builder says the director sets it instead of inventing a number
// (see CLAUDE.md -> "The builder's math must carry its own provenance").
//
// Run: node --test tools/test-monster-builder-honesty.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
const F = Engine.Formulas;
globalThis.DrawSteelFormulas = F;
globalThis.MonsterEngine = Engine;
globalThis.MonsterParty = require('../widgets/monster-party.js');
globalThis.DrawSteelStatblock = require('../widgets/statblock-renderer.js');
const S = globalThis.DrawSteelStatblock;
const Ed = require('../widgets/monster-builder.js');

const load = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const REFS = { orgs: load('organization-templates.json'), roles: load('role-templates.json') };
const org = (s) => REFS.orgs.find((o) => o.slug === s);
const BUILDER_SRC = readFileSync(new URL('../widgets/monster-builder.js', import.meta.url), 'utf8');

const state = (fields, name) => Ed.newState(name || 'Test', Object.assign({ level: 1 }, fields), REFS);
const ui = (extra) => Object.assign({ ref: null }, extra || {});

// ── Figures follow the published formulas ───────────────────────────────────

test('creature EV is the published ((2 x level) + 4) x organization modifier', () => {
  const st = state({ level: 5, organization: 'elite', role: 'brute' });
  assert.equal(st.c.ev, F.encounterValue(5, org('elite')).value);
  assert.equal(st.c.ev, 28);
});

test('Stamina is the published formula, with the role’s modifier', () => {
  const st = state({ level: 8, organization: 'solo', role: 'brute' });
  // A level 8 solo gets 550 Stamina, not 240.
  assert.equal(st.c.stamina, 550);
  assert.equal(st.c.winded, 275);
});

test('free strike is the published tier 1 damage result', () => {
  const st = state({ level: 5, organization: 'leader' });
  assert.equal(st.c.free_strike, F.damageTiers(5, org('leader'), null).value.tier1 + ' damage');
});

test('a figure follows the formula when the level changes, until the director sets it', () => {
  const st = state({ level: 2, organization: 'platoon', role: 'brute' });
  st.c.level = 6; Ed.derive(st);
  assert.equal(st.c.ev, F.encounterValue(6, org('platoon')).value);
  Ed.setFigure(st, 'ev', '99');
  st.c.level = 7; Ed.derive(st);
  assert.equal(st.c.ev, 99, 'a number the director typed is never overwritten');
  Ed.useFormula(st, 'ev');
  assert.equal(st.c.ev, F.encounterValue(7, org('platoon')).value);
});

test('opening a stored creature never rewrites a figure the director set', () => {
  const st = state({ level: 3, organization: 'leader', ev: 30, stamina: 77 });
  assert.equal(st.c.ev, 30);
  assert.equal(st.c.stamina, 77);
  assert.ok(st.own.ev && st.own.stamina);
});

test('formula damage on a strike adds the published highest characteristic', () => {
  const st = state({ level: 5, organization: 'leader' });
  st.c.abilities.push(Ed.newAbility(st));
  Ed.derive(st);
  const d = F.damageTiers(5, org('leader'), null).value;
  const hc = F.highestCharacteristic(5, org('leader')).value;
  const a = st.c.abilities[0];
  assert.equal(a.tier1, (d.tier1 + hc) + ' damage');
  assert.equal(a.power_roll, '2d10 + ' + hc);
});

test('formula damage keeps the director’s words after the number', () => {
  assert.equal(Ed.autoTier('9 damage; push 2', 14), '14 damage; push 2');
  assert.equal(Ed.autoTier('', 6), '6 damage');
  assert.equal(Ed.autoTier('slowed (EoT)', 6), '6 damage; slowed (EoT)');
});

// ── Where no formula covers the creature ────────────────────────────────────

test('swarm leaves EV and Stamina to the director and says so', () => {
  const st = state({ level: 2, organization: 'swarm', role: 'harrier' });
  assert.equal(st.c.ev, null, 'no number is invented');
  assert.equal(st.c.stamina, null);
  const html = Ed.editorHtml(st, ui());
  assert.match(html, /No published encounter value for this creature\. Set it yourself\./);
  assert.match(html, /No published Stamina for this creature\. Set it yourself\./);
});

test('with no role chosen, Stamina is the director’s (published roles span 10–30)', () => {
  const st = state({ level: 3, organization: 'platoon' });
  assert.equal(st.c.stamina, null);
  assert.equal(F.stamina(3, org('platoon'), null).value, null);
});

test('leaders and solos take no role: the published table supplies theirs', () => {
  const st = state({ level: 4, organization: 'solo' });
  assert.equal(st.c.stamina, F.stamina(4, org('solo'), null).value);
  assert.match(Ed.editorHtml(st, ui()), /Solos have no role/);
});

test('the made-up damage table is gone, and nothing reads it', () => {
  assert.equal(existsSync(new URL('../data/damage-baselines.json', import.meta.url)), false);
  assert.ok(!/damage-baselines/.test(BUILDER_SRC));
  assert.ok(!/damage-baselines|baselines\[/.test(readFileSync(new URL('../widgets/monster-engine.js', import.meta.url), 'utf8')));
});

// ── The chips and the checks ────────────────────────────────────────────────

test('every figure says where it came from', () => {
  const st = state({ level: 3, organization: 'elite', role: 'brute' });
  Ed.setFigure(st, 'stamina', '100');
  const html = Ed.editorHtml(st, ui());
  assert.match(html, /Published formula/);
  assert.match(html, /Changed by you \(the formula gives \d+\)/);
  assert.match(html, /Use the formula/);
});

test('the checks panel is titled Completeness checks and carries its standing line', () => {
  const html = Ed.sideHtml(state({ level: 1, organization: 'horde', role: 'brute' }), ui());
  assert.match(html, /Completeness checks/);
  assert.ok(!/>\s*Validation/.test(html));
  assert.match(html, /They don’t judge whether the fight is balanced/);
});

test('the checks never claim a creature is balanced or validated', () => {
  const html = Ed.sideHtml(state({ level: 1, organization: 'horde', role: 'brute' }), ui())
    .replace(Ed.STANDING_LINE, '');
  assert.ok(!/balanced|validated/i.test(html));
});

test('a provenance row names every figure no formula covers', () => {
  const rows = Ed.checks(state({ level: 1, organization: 'swarm', role: 'harrier' }));
  const prov = rows.filter((r) => r.severity === 'provenance').map((r) => r.message).join(' ');
  assert.match(prov, /encounter value/i);
  assert.match(prov, /Stamina/);
});

test('a deviation warning cites the published figure, and only when one exists', () => {
  const st = state({ level: 3, organization: 'elite', role: 'brute' });
  Ed.setFigure(st, 'ev', '40');
  assert.ok(Ed.checks(st).some((r) => r.severity === 'warn' && /published formula gives 20/.test(r.message)));
  const sw = state({ level: 1, organization: 'swarm', role: 'harrier', ev: 5, stamina: 20 });
  assert.ok(!Ed.checks(sw).some((r) => r.severity === 'warn' && /Encounter value|Stamina/.test(r.message)),
    'no deviation is claimed against a figure the rules do not define');
});

test('if the published-formula module is missing, the panel says so instead of checking silently', () => {
  const saved = globalThis.DrawSteelFormulas;
  globalThis.DrawSteelFormulas = undefined;
  try {
    const st = state({ level: 3, organization: 'elite', role: 'brute' });
    assert.equal(st.c.ev, null);
    assert.ok(Ed.checks(st).some((r) => r.severity === 'provenance' && /did not load/.test(r.message)));
  } finally {
    globalThis.DrawSteelFormulas = saved;
  }
});

// ── The encounter budget ────────────────────────────────────────────────────

const party = (n, level) => {
  const heroes = [];
  for (let i = 0; i < n; i++) heroes.push({ name: 'H' + i, fields_data: { level, might: 2, agility: 1, reason: 0, intuition: 1, presence: 0 } });
  return { heroes, profile: globalThis.MonsterParty.deriveParty(heroes), levels: heroes.map(() => level) };
};

test('the budget is the published party encounter strength, not size x level x 4', () => {
  const b = Ed.budget(party(4, 10).profile, [10, 10, 10, 10], 20);
  assert.equal(b.partyEs, F.partyEncounterStrength([10, 10, 10, 10]).value);
  assert.equal(b.partyEs, 96);
  assert.equal(b.bands.standard.lower, 96);
});

test('the meter names the published band and what it does not check', () => {
  const st = state({ level: 10, organization: 'solo' });
  const html = Ed.sideHtml(st, ui({ party: party(4, 10) }));
  assert.match(html, /A standard fight for this party is <b>96–/);
  assert.match(html, /not checked here/);
  assert.ok(!/balanced/i.test(html.replace(/whether the fight is balanced/, '')));
});

test('the phrase "balanced encounter" is gone from the builder source', () => {
  assert.ok(!/balanced encounter/i.test(BUILDER_SRC));
});

test('a party suggestion applies level, organization and role, then the formulas fill the rest', () => {
  const st = state({ level: 1 });
  const note = Ed.applySuggestion(st, party(4, 5).profile);
  assert.equal(st.c.level, 5);
  assert.ok(st.c.organization, 'an organization was chosen');
  assert.equal(st.c.ev, F.encounterValue(5, org(st.c.organization)).value);
  assert.ok(note.length > 0, 'the reasons are shown');
  assert.ok(!/balanced/i.test(note));
});

// ── Wording: what is missing, and notes that read right ─────────────────────

const bodyOf = (st) => Ed.editorHtml(st, ui({ party: null }));

test('a blank creature asks for an organization instead of saying no formula covers it', () => {
  const html = bodyOf(state({}));
  assert.ok(!/No published (encounter value|Stamina|free strike)/.test(html));
  assert.equal((html.match(/Pick an organization and the formula fills this in\./g) || []).length, 4);
});

test('a creature with an organization but no role asks for a role on Stamina and Winded only', () => {
  const html = bodyOf(state({ organization: 'elite' }));
  assert.equal((html.match(/Pick a role and the formula fills this in\./g) || []).length, 2);
  assert.ok(!/Pick an organization/.test(html));
});

test('a swarm still says no published figure covers it', () => {
  const html = bodyOf(state({ organization: 'swarm' }));
  assert.match(html, /No published encounter value/);
});

test('a refused book ability says "an elite", and a role refusal names roles', () => {
  const lib = [
    { slug: 'h', name: 'Chilling Gravetouch', properties: { type: 'action', organizations: ['horde'], roles: [] } },
    { slug: 'm', name: 'Mind Lash', properties: { type: 'action', organizations: ['minion', 'horde', 'platoon', 'elite'], roles: ['controller', 'artillery'] } },
  ];
  const a = state({ level: 3, organization: 'elite', role: 'brute' });
  const notes = [];
  Ed.bookPicks(a, ['h', 'm'], lib, notes);
  assert.ok(notes.some((n) => /^Chilling Gravetouch is made for hordes, not an elite, so it was left off\.$/.test(n)), notes.join('|'));
  assert.ok(notes.some((n) => /^Mind Lash is made for controller, artillery, not a brute, so it was left off\.$/.test(n)), notes.join('|'));
  assert.ok(!notes.some((n) => /elites?, .*not a (platoon|elite)/.test(n)));
});

test('the From the AI note ends cleanly', () => {
  const st = state({});
  Ed.fromAI(st, { name: 'X', level: 2, organization: 'horde', role: 'brute' }, Ed.vocabulary(REFS, { creatureKeywords: [], abilityKeywords: [], glossary: [] }), []);
  assert.ok(!/formulas’/.test(st.origin || ''), st.origin);
  assert.match(st.origin || '', /are the published formulas\.$/);
});

// ── Second audit pass: levels, typed numbers, villain actions, book marks ───

const LIBRARY = load('creature-abilities.json');
const highest = (st) => Math.max(...['might', 'agility', 'reason', 'intuition', 'presence'].map((k) => st.c[k]));
const rollOf = (a) => Number(/\+\s*(-?\d+)/.exec(a.power_roll)[1]);

test('a level change moves the role’s spread, and every power roll follows the highest characteristic', () => {
  const st = state({}, 'x');
  Ed.generate(st, { kind: 'elite', role: 'harrier', level: 3 }, LIBRARY, 0);
  const hc3 = F.highestCharacteristic(3, org('elite')).value;
  assert.equal(st.c.agility, hc3, 'harrier’s main characteristic is the published highest');
  // A non-strike ability written with a roll when it was added.
  Ed.addFromLibrary(st, LIBRARY.find((t) => t.properties.type === 'action' && !/strike/i.test(String(t.properties.keywords)) && t.properties.organizations.includes('elite') && /^\d+ damage/.test(t.properties.tier1)), {});
  st.c.level = 7; Ed.derive(st);
  const hc7 = F.highestCharacteristic(7, org('elite')).value;
  assert.ok(hc7 > hc3);
  assert.equal(st.c.agility, hc7);
  assert.equal(highest(st), hc7);
  st.c.abilities.forEach((a) => { if (a.power_roll) assert.equal(rollOf(a), hc7, a.name); });
});

test('a characteristic the director typed stays put on a level change', () => {
  const st = state({}, 'x');
  Ed.generate(st, { kind: 'elite', role: 'harrier', level: 3 }, LIBRARY, 0);
  Ed.applyField(st, 'reason', '4');
  st.c.level = 8; Ed.derive(st);
  assert.equal(st.c.reason, 4);
  assert.equal(st.c.agility, F.highestCharacteristic(8, org('elite')).value);
});

test('opening a creature whose characteristics are the spread keeps them following', () => {
  const sp = state({ level: 3, organization: 'elite', role: 'harrier', agility: 2, might: 0, reason: 0, intuition: 0, presence: 0 });
  const before = Object.keys(sp.spread);
  assert.ok(before.length > 0);
  sp.c.level = 7; Ed.derive(sp);
  assert.equal(sp.c.agility, F.highestCharacteristic(7, org('elite')).value);
  const typed = state({ level: 3, organization: 'elite', role: 'harrier', agility: 1, might: 0, reason: 0, intuition: 0, presence: 0 });
  typed.c.level = 7; Ed.derive(typed);
  assert.equal(typed.c.agility, 1, 'a value that differs from the spread is the director’s');
});

test('the highest-characteristic line says “an elite”', () => {
  const html = Ed.editorHtml(state({ level: 3, organization: 'elite', role: 'brute' }), {});
  assert.match(html, /an elite’s highest characteristic/);
  assert.doesNotMatch(html, /a elite/);
});

test('Add abilities puts formula damage only on tiers that deal damage (#205)', () => {
  const st = state({ level: 5, organization: 'platoon', role: 'brute' });
  const quake = LIBRARY.find((t) => t.name === 'Hill Quake');
  Ed.addFromLibrary(st, quake, {});
  const a = st.c.abilities.find((x) => x.name === 'Hill Quake');
  assert.match(a.tier1, /^\d+ damage; /);
  assert.match(a.tier2, /^\d+ damage; /);
  assert.equal(a.tier3, 'Push 2', 'a tier with no damage stays as written');
  Ed.derive(st); st.c.level = 9; Ed.derive(st);
  assert.equal(a.tier3, 'Push 2', 'and a later level change leaves it alone');
});

test('abilities with damage-free tiers keep them: the six named entries', () => {
  const slugs = ['steam-powered-snare-3-malice', 'hill-quake', 'glare-of-the-old-judgments-5-malice', 'final-warning-fissure', 'kings-fissure', 'and-the-sun-forsook-her-children'];
  const entries = slugs.map((s) => LIBRARY.find((t) => t.slug === s));
  entries.forEach((t) => assert.ok(t, 'library has it'));
  entries.forEach((t) => {
    const st = state({ level: 5, organization: 'solo' });
    const a = Ed.shapeAbility(st, t, {});
    ['tier1', 'tier2', 'tier3'].forEach((k) => {
      const written = t.properties[k] || '';
      if (!/^\s*\d+(?:\s+[a-z]+)?\s+damage/i.test(written) && written) assert.equal(a[k], written, t.name + ' ' + k);
    });
  });
});

test('a typed tier or power roll is never rewritten (#206)', () => {
  const st = state({ level: 5, organization: 'platoon', role: 'brute' });
  Ed.generate(st, { kind: 'platoon', role: 'brute', level: 5 }, LIBRARY, 0);
  st.editAb = 'a0';
  const a = st.c.abilities[0];
  assert.equal(a.auto_damage, true);
  const note = Ed.applyAbility(st, 'tier1', '20 damage');
  assert.match(note, /no longer follows the published formula/);
  assert.equal(a.auto_damage, false);
  Ed.applyAbility(st, 'power_roll', '2d10 + 9 edge');
  st.c.level = 7; Ed.derive(st);
  assert.equal(a.tier1, '20 damage');
  assert.equal(a.power_roll, '2d10 + 9 edge');
  // A non-strike ability's typed roll is kept too.
  const b = { name: 'Howl', type: 'action', keywords: ['Area'], tier1: '', tier2: '', tier3: '', auto_roll: true, power_roll: '2d10 + 2' };
  st.c.abilities.push(b); st.editAb = 'a' + (st.c.abilities.length - 1);
  Ed.derive(st);
  assert.equal(b.power_roll, '2d10 + ' + highest(st), 'a written roll follows');
  Ed.applyAbility(st, 'power_roll', '2d10 + 1');
  Ed.derive(st);
  assert.equal(b.power_roll, '2d10 + 1');
});

test('a free strike keeps its words when its number is the formula’s (#206)', () => {
  const n = F.freeStrike(3, org('elite'), REFS.roles.find((r) => r.slug === 'brute')).value;
  ['damage; push 1', 'fire damage'].forEach((w) => {
    const st = state({ level: 3, organization: 'elite', role: 'brute', free_strike: n + ' ' + w });
    assert.equal(st.c.free_strike, n + ' ' + w);
    Ed.derive(st);
    assert.equal(st.c.free_strike, n + ' ' + w);
  });
  const st = state({ level: 3, organization: 'elite', role: 'brute', free_strike: 'Free strike: ' + n });
  Ed.derive(st);
  assert.equal(st.c.free_strike, 'Free strike: ' + n);
  st.c.level = 6; Ed.derive(st);
  assert.equal(st.c.free_strike, 'Free strike: ' + F.freeStrike(6, org('elite'), REFS.roles.find((r) => r.slug === 'brute')).value);
});

test('clearing a figure no formula covers empties it, and text that is not a number is refused (#206)', () => {
  const st = state({ level: 3, organization: 'elite', stamina: 80 });
  assert.equal(st.pr.stamina.value, null, 'an elite with no role has no published Stamina');
  Ed.setFigure(st, 'stamina', '');
  assert.equal(st.c.stamina, null);
  assert.equal(st.c.winded, null);
  Ed.setFigure(st, 'stamina', '90');
  Ed.setFigure(st, 'stamina', 'abc');
  assert.equal(st.c.stamina, 90);
  assert.equal(st.own.stamina, true);
  const fresh = state({ level: 3, organization: 'elite', role: 'brute' });
  Ed.setFigure(fresh, 'ev', 'abc');
  assert.ok(!fresh.own.ev, 'a refused entry marks nothing as the director’s');
});

test('removing a villain action renumbers the orders, from every path (#207)', () => {
  const st = state({ level: 5, organization: 'solo' });
  for (let i = 0; i < 3; i++) Ed.addVillain(st);
  Ed.removeItem(st, 'v', 0);
  assert.deepEqual(st.c.villain_actions.map((v) => v.order), ['opener', 'crowd-control']);
  Ed.addVillain(st);
  assert.deepEqual(st.c.villain_actions.map((v) => v.order), ['opener', 'crowd-control', 'ultimate']);
  st.c.villain_actions.forEach((v, i) => { v.name = 'V' + i; });
  assert.ok(Ed.checks(st).find((r) => /villain actions/.test(r.message)).severity === 'ok');
  st.c.villain_actions[2].order = 'ultimate'; st.c.villain_actions[1].order = 'ultimate';
  assert.equal(Ed.checks(st).find((r) => /villain actions/.test(r.message)).severity, 'miss', 'two ultimates do not pass');
  Ed.moveItem(st, 'v', 2, 0);
  assert.deepEqual(st.c.villain_actions.map((v) => v.order), ['opener', 'crowd-control', 'ultimate']);
});

test('a villain action’s damage follows the level (#207)', () => {
  const st = state({ level: 3, organization: 'solo' });
  const t = LIBRARY.find((x) => x.properties.type === 'villain-action' && /^\d+ damage/.test(x.properties.tier1) && x.properties.organizations.includes('solo'));
  assert.ok(t);
  Ed.addFromLibrary(st, t, {});
  const v = st.c.villain_actions[0];
  const at3 = parseInt(v.tier1, 10);
  st.c.level = 9; Ed.derive(st);
  assert.ok(parseInt(v.tier1, 10) > at3);
});

test('swarm damage is not sourced, and its abilities say so (#208)', () => {
  const r = F.damageTiers(3, org('swarm'), REFS.roles.find((x) => x.slug === 'brute'));
  assert.equal(r.sourced, false);
  assert.equal(r.value, null);
  const st = state({ level: 3, organization: 'swarm', role: 'brute' });
  Ed.addFromLibrary(st, LIBRARY.find((t) => t.properties.type === 'signature'), {});
  const html = Ed.editorHtml(st, {});
  assert.match(html, /No published damage for this creature yet/);
  assert.doesNotMatch(html, /Damage from the published formula/);
});

test('a book creature’s printed figure is the book’s, not “Changed by you” (#208)', () => {
  const book = load('monsters.json').find((m) => m.slug === 'angulotl-pollywog');
  const p = book.properties;
  const fields = Object.assign({}, p, { organization: String(p.organization).toLowerCase(), role: String(p.role).toLowerCase() });
  const noBook = Ed.newState('Pollywog', fields, REFS);
  const withBook = Ed.newState('Pollywog', fields, REFS, p);
  const f = F.freeStrike(p.level, org(fields.organization), REFS.roles.find((r) => r.slug === fields.role)).value;
  assert.notEqual(f, Number(/\d+/.exec(p.free_strike)[0]), 'the book’s free strike differs from the formula');
  assert.match(Ed.editorHtml(noBook, {}), /Changed by you/);
  const html = Ed.editorHtml(withBook, {});
  assert.match(html, /From the Monsters book/);
  assert.equal(withBook.c.free_strike, p.free_strike, 'opening never rewrites it');
  const sb = S.provenance(S.normalize(fields), REFS, p);
  assert.equal(sb.free_strike.state, 'book');
  assert.match(S.html('Pollywog', fields, { refs: REFS, book: p }), /Monsters book/);
  assert.doesNotMatch(S.html('Pollywog', fields, { refs: REFS, book: p }), /was set by the director/);
  assert.equal(S.provenance(S.normalize(Object.assign({}, fields, { free_strike: '9 damage' })), REFS, p).free_strike.state, 'changed');
});

test('a minion copied from the book carries its EV note (#208)', () => {
  const m = load('monsters.json').find((x) => x.properties.ev_note);
  const c = S.normalize(m.properties);
  assert.equal(c.ev_note, 'for four minions');
  assert.equal(S.toFields(c).ev_note, 'for four minions');
  // Made a platoon, the minion group count no longer applies.
  const p = S.normalize(Object.assign({}, m.properties, { organization: 'platoon' }));
  assert.equal(S.toFields(p).ev_note, undefined);
  assert.doesNotMatch(S.html('X', Object.assign({}, m.properties, { organization: 'platoon' }), {}), /for four/);
});

test('saving keeps what Foundry sent while the editor was open (#203)', async () => {
  const st = Ed.newState('Ogre', { level: 3, organization: 'elite', role: 'brute', stamina_current: 10, conditions_json: '[]', notes_gm: 'keep' }, REFS);
  const out = Ed.toSave(st);
  assert.ok(!('stamina_current' in out.fields) && !('conditions_json' in out.fields), 'the editor sends only keys it owns');
  assert.equal(out.fields.notes_gm, 'keep');
  const calls = [];
  const saved = globalThis.DrawSteelStatblock.apiFetch;
  globalThis.DrawSteelStatblock.apiFetch = (url, opts) => {
    calls.push({ url, opts });
    if (!opts) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'e1', fields_data: { stamina_current: 3, conditions_json: '["dazed"]', notes_gm: 'keep' } }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'e1' }) });
  };
  try {
    await Ed.save(st, { campaignId: 'c1', entityId: 'e1' });
  } finally { globalThis.DrawSteelStatblock.apiFetch = saved; }
  const body = JSON.parse(calls.find((c) => c.opts && c.opts.method === 'PUT').opts.body);
  assert.equal(body.fields_data.stamina_current, 3);
  assert.equal(body.fields_data.conditions_json, '["dazed"]');
});

test('the Foundry-owned keys the editor leaves alone are the manifest’s foundry_pull_fields (#203)', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const creature = JSON.stringify(m).match(/"foundry_pull_fields":\s*(\[[^\]]*\])/);
  assert.ok(BUILDER_SRC.includes('FOUNDRY_OWNED = ' + creature[1].replace(/\s+/g, ' ').replace(/"/g, "'").replace('[ ', '[').replace(' ]', ']').replace(/,\s*/g, ', ')));
});

test('levels are whole numbers from 1 to 20, and the figures match the level saved (#209)', () => {
  const st = state({ level: 5, organization: 'platoon', role: 'brute' });
  Ed.applyField(st, 'level', '25'); Ed.derive(st);
  assert.equal(st.c.level, 20);
  assert.equal(st.c.ev, F.encounterValue(20, org('platoon')).value);
  assert.equal(Ed.toSave(st).fields.level, 20);
  Ed.applyField(st, 'level', '7.5'); Ed.derive(st);
  assert.equal(Number.isInteger(st.c.level), true);
  assert.equal(Ed.toSave(st).fields.ev, st.c.ev);
});

test('a copy keeps the source’s level and the dialog says so (#209)', () => {
  const st = state({ level: 7, organization: 'platoon', role: 'brute' });
  Ed.startFrom(st, 'Ogre', { level: 3, organization: 'platoon', role: 'brute' }, 'x');
  assert.equal(st.c.level, 3);
  assert.match(BUILDER_SRC, /Copies its stat block into this one, level included/);
});

test('a condition the tier already inflicts is not added twice (#209)', () => {
  const st = state({ level: 3, organization: 'platoon', role: 'brute' });
  const t = { slug: 'x', name: 'Scream', properties: { type: 'action', organizations: ['platoon'], tier1: '3 damage', tier2: '5 damage; dazed (save ends)', tier3: '7 damage; dazed (save ends)' } };
  const a = Ed.shapeAbility(st, t, { rider: 'dazed3' });
  assert.equal((a.tier3.match(/dazed/gi) || []).length, 1);
});

test('party suggestions name the band the spend actually lands in (#209)', () => {
  const s = Engine.suggest({ size: 7, levelAvg: 1, weaknesses: [], immunities: [], defenses: {} }, 'standard', { orgTemplates: REFS.orgs, roleTemplates: REFS.roles });
  const why = s.rationale.organization;
  const spent = Number(/spend (\d+)/.exec(why)[1]);
  const band = F.difficultyOf(spent, F.partyEncounterStrength(7, 1).value, F.heroEncounterStrength(1).value).value;
  assert.ok(why.indexOf(band + '-difficulty') >= 0, why);
});

test('toStatblock carries movement and “with captain” (#209)', () => {
  const c = S.normalize({ level: 2, organization: 'minion', movement: 'Fly, swim', with_captain: '+1 damage' });
  const sb = S.toStatblock('x', c);
  assert.deepEqual(sb.movement, ['Fly', 'swim']);
  assert.equal(sb.with_captain, '+1 damage');
});

test('a form is measured per copy in bytes (#209)', () => {
  const F2 = S.Forms;
  const multi = { id: 'a', name: 'x', changes: { faction: 'é'.repeat(8000) }, lists: {} };
  assert.ok(F2.tooBig(multi), 'multi-byte text counts its bytes');
  const plain = { id: 'a', name: 'x', changes: { faction: 'a'.repeat(9000) }, lists: {} };
  assert.ok(!F2.tooBig(plain), '9,000 characters is far under the 16 KiB per copy Chronicle allows');
});

test('a figure that followed its formula empties when the creature becomes a swarm', () => {
  const st = state({ level: 3, organization: 'minion', role: 'brute' });
  Ed.derive(st);
  assert.notEqual(st.c.ev, null);
  st.c.organization = 'swarm'; Ed.derive(st);
  assert.equal(st.c.ev, null);
  assert.equal(st.c.stamina, null);
  assert.equal(st.c.winded, null);
  assert.doesNotMatch(Ed.editorHtml(st, {}), /Changed by you/);
  // A number the director typed stays.
  const typed = state({ level: 3, organization: 'minion', role: 'brute' });
  Ed.setFigure(typed, 'stamina', '12');
  typed.c.organization = 'swarm'; Ed.derive(typed);
  assert.equal(typed.c.stamina, 12);
});
