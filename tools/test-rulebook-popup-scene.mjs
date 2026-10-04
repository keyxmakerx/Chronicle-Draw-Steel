#!/usr/bin/env node
/**
 * Unit tests for the Lair board's pop-up scenes in
 * widgets/rulebook-example-player.js: scene data validation against each
 * script, the beat -> motion-class mapping, the roll facts read back out of a
 * script, and the paper cards — whose rules wording must come from the
 * package's data files, never from the widget. The DOM side (book opening,
 * card stacking, focus) is checked in a browser.
 *
 * Run: `node --test tools/test-rulebook-popup-scene.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../widgets/rulebook-example-player.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const data = (f) => JSON.parse(readFileSync(join(HERE, '..', 'data', f), 'utf8'));
const SRC = readFileSync(join(HERE, '..', 'widgets', 'rulebook-example-player.js'), 'utf8');

const EXAMPLES = data('rulebook-examples.json');
const SOURCES = {
  glossary: data('rules-glossary.json'), creatures: data('creatures.json'),
  roles: data('role-templates.json'), frontpage: data('rulebook-frontpage.json'),
};
const REFS = P.buildRefs(SOURCES);
const linesOf = (ex) => ex.properties.lines;

// ── validateScene ───────────────────────────────────────────────────────────
test('every shipped script has a scene that validates with no errors', () => {
  assert.equal(EXAMPLES.length, 7);
  for (const ex of EXAMPLES) {
    const v = P.validateScene(ex.properties.scene, linesOf(ex));
    assert.deepEqual(v.errors, [], `${ex.slug}: ${v.errors.join('; ')}`);
    assert.ok(v.scene, `${ex.slug} has a drawable scene`);
    assert.ok(v.scene.pieces.some((p) => p.card), `${ex.slug} has at least one piece to tap`);
  }
});

test('every shipped scene walks its whole script, in order', () => {
  for (const ex of EXAMPLES) {
    const { scene } = P.validateScene(ex.properties.scene, linesOf(ex));
    const seen = new Set(scene.beats.map((b) => b.line));
    for (let i = 0; i < linesOf(ex).length; i++) assert.ok(seen.has(i), `${ex.slug}: line ${i} has no beat`);
  }
});

test('validateScene: no scene, an unknown backdrop, or no pieces falls back to the flat stage', () => {
  const lines = [{ speaker: 'D', kind: 'dir', text: 'a' }];
  assert.equal(P.validateScene(null, lines).scene, null);
  assert.equal(P.validateScene({ backdrop: 'moon', pieces: [{ id: 'a', kit: 'knight', x: 1, y: 1 }] }, lines).scene, null);
  assert.equal(P.validateScene({ backdrop: 'hall', pieces: [] }, lines).scene, null);
  const ok = P.validateScene({ backdrop: 'hall', pieces: [{ id: 'a', kit: 'knight', x: 1, y: 1 }] }, lines);
  assert.ok(ok.scene, 'with no beats listed there is one beat per line');
  assert.deepEqual(ok.scene.beats, [{ line: 0, tier: false, cues: [] }]);
});

test('validateScene: malformed parts are dropped and reported, the rest still draws', () => {
  const lines = [{ speaker: 'D', kind: 'dir', text: 'a' }, { speaker: 'D', kind: 'dir', text: 'b' }];
  const v = P.validateScene({
    backdrop: 'gate',
    pieces: [
      { id: 'a', kit: 'knight', x: 10, y: 150, card: 'a', label: 'A' },
      { id: 'a', kit: 'knight', x: 10, y: 150 },             // duplicate id
      { id: 'b', kit: 'dragon', x: 10, y: 150 },             // unknown kit
      { id: 'c', kit: 'door', x: 'x', y: 150 },              // bad x
      { id: 'd', kit: 'door', x: 9999, y: 150, card: 'nope', label: 'D' },
      { id: 'e', kit: 'flag', x: 1, y: 1, card: 'a' },       // card but no label
    ],
    beats: [
      { line: 1, cues: [{ who: 'a', do: 'lunge' }, { who: 'zz', do: 'step' }, { who: 'a', do: 'moonwalk' }] },
      { line: 0, cues: [] },                                  // steps back
      { line: 7, cues: [] },                                  // no such line
    ],
    cards: { a: { kicker: 'K', says: [0, 9], links: ['glossary:push', 'web:evil'], stats: [['ok', '1'], ['bad']], from: 'disk:x' } },
  }, lines);
  assert.ok(v.scene);
  assert.deepEqual(v.scene.pieces.map((p) => p.id), ['a', 'd', 'e']);
  assert.equal(v.scene.pieces[1].x, 700, 'x is clamped to the spread');
  assert.equal(v.scene.pieces[1].card, null);
  assert.deepEqual(v.scene.beats, [{ line: 1, tier: false, cues: [{ who: 'a', motion: 'lunge', hold: false }] }]);
  assert.deepEqual(v.scene.cards.a.says, [0]);
  assert.deepEqual(v.scene.cards.a.links, ['glossary:push']);
  assert.deepEqual(v.scene.cards.a.stats, [['ok', '1']]);
  assert.equal(v.scene.cards.a.from, null);
  for (const frag of ['unique id', 'unknown kit', 'numeric x', 'which the scene lacks', 'no label', 'unknown piece',
    'unknown motion', 'steps back', 'which the script lacks', 'unknown source', 'not a [label, value] pair'])
    assert.ok(v.errors.some((e) => e.includes(frag)), `reports: ${frag}`);
});

test('validateScene: every kit and motion the shipped scenes use is in the shared kit', () => {
  for (const ex of EXAMPLES) {
    for (const p of ex.properties.scene.pieces) assert.ok(P.KIT[p.kit], `${ex.slug}: kit ${p.kit}`);
    for (const b of ex.properties.scene.beats || []) for (const c of b.cues) assert.ok(P.MOTIONS.includes(c.do), `${ex.slug}: ${c.do}`);
    assert.ok(P.BACKDROPS.includes(ex.properties.scene.backdrop));
  }
});

// ── beatState / showTierFor ─────────────────────────────────────────────────
const MINI = P.validateScene({
  backdrop: 'hall',
  pieces: [
    { id: 'hero', kit: 'knight', x: 150, y: 150 },
    { id: 'foe', kit: 'bugbear', x: 350, y: 140, face: -1 },
    { id: 'dice', kit: 'dice', x: 265, y: 172, show: [1, 1] },
    { id: 'flag', kit: 'flag', x: 384, y: 190, show: [2], text: 'x' },
  ],
  beats: [
    { line: 0, cues: [{ who: 'foe', do: 'step' }] },
    { line: 1, cues: [{ who: 'hero', do: 'wind' }] },
    { line: 1, tier: true, cues: [{ who: 'hero', do: 'lunge' }, { who: 'foe', do: 'knock', hold: true }] },
    { line: 2, cues: [{ who: 'hero', do: 'cheer' }] },
  ],
}, [{ kind: 'dir', text: 'a' }, { kind: 'roll', dice: [1, 2], steps: [] }, { kind: 'dir', text: 'c' }]).scene;

test('beatState: before the first beat only the always-standing pieces are up, and nothing moves', () => {
  const s = P.beatState(MINI, -1);
  assert.deepEqual(s.up, { hero: true, foe: true, dice: false, flag: false });
  assert.deepEqual(s.motions, { hero: [], foe: [], dice: [], flag: [] });
});

test('beatState: a beat plays its own cues; earlier cues end unless held', () => {
  assert.deepEqual(P.beatState(MINI, 0).motions.foe, ['step']);
  assert.deepEqual(P.beatState(MINI, 1).motions, { hero: ['wind'], foe: [], dice: [], flag: [] });
  assert.deepEqual(P.beatState(MINI, 1).up.dice, true, 'the dice stand on their beat');
  assert.deepEqual(P.beatState(MINI, 2).up.dice, false, '...and fold away before the hit');
  assert.deepEqual(P.beatState(MINI, 3).motions, { hero: ['cheer'], foe: ['knock'], dice: [], flag: [] }, 'a held knock stays');
  assert.equal(P.beatState(MINI, 3).up.flag, true, 'an open-ended show range stays up');
});

test('beatState: stepping back is a fresh recompute, not an undo', () => {
  const forward = P.beatState(MINI, 1);
  P.beatState(MINI, 3);
  assert.deepEqual(P.beatState(MINI, 1), forward);
});

test('showTierFor: a roll split into dice and tier beats stamps the tier only on the tier beat', () => {
  assert.equal(P.showTierFor(MINI.beats, 1), false);
  assert.equal(P.showTierFor(MINI.beats, 2), true);
  assert.equal(P.showTierFor(MINI.beats, 0), true, 'a line with no tier beat shows its own');
  assert.equal(P.showTierFor(MINI.beats, 9), false);
});

// ── rollFacts ───────────────────────────────────────────────────────────────
test('rollFacts reads every shipped roll line back exactly: dice, sum, modifiers, total, tier', () => {
  const swing = EXAMPLES.find((e) => e.slug === 'kaelen-swings');
  const f = P.rollFacts(linesOf(swing)[2]);
  assert.deepEqual(f.dice, [8, 8]);
  assert.equal(f.sum, 16);
  assert.deepEqual(f.mods, [{ name: 'Might', value: '+2' }]);
  assert.equal(f.total, 18);
  assert.equal(f.tierNo, 3);
  for (const ex of EXAMPLES) {
    const roll = linesOf(ex).find((l) => l.kind === 'roll');
    const r = P.rollFacts(roll);
    assert.equal(r.sum, roll.dice.reduce((a, b) => a + b, 0), `${ex.slug}: the dice add up to the scripted sum`);
    assert.equal(r.total, r.sum + r.mods.reduce((a, m) => a + Number(m.value), 0), `${ex.slug}: the total follows`);
  }
});

// ── cards: the text comes from the data ─────────────────────────────────────
function cardsOf(ex) {
  const { scene } = P.validateScene(ex.properties.scene, linesOf(ex));
  return Object.entries(scene.cards).map(([key, def]) => ({ key, def, model: P.resolveCard(def, { refs: REFS, lines: linesOf(ex) }) }));
}

test('every shipped card resolves, and quotes its source entry word for word', () => {
  const lookup = { glossary: 'glossary', creature: 'creature', role: 'role', frontpage: 'frontpage', tier: 'frontpage' };
  for (const ex of EXAMPLES) {
    for (const { key, def, model } of cardsOf(ex)) {
      assert.ok(model, `${ex.slug}/${key} resolves`);
      const ref = P.parseRef(def.from);
      if (!ref) continue;
      const entry = REFS[lookup[ref.kind]][ref.slug];
      assert.ok(entry, `${ex.slug}/${key}: ${def.from} exists in the data`);
      const text = entry.description || entry.summary;
      assert.equal(model.body[0], P.termHtml(text, REFS), `${ex.slug}/${key}: body is the entry's own text`);
    }
  }
});

test('a card says the script\'s own lines, and marks the script\'s numbers SAMPLE', () => {
  const swing = EXAMPLES.find((e) => e.slug === 'kaelen-swings');
  const cards = Object.fromEntries(cardsOf(swing).map((c) => [c.key, c.model]));
  assert.equal(cards.kaelen.sample, true);
  assert.deepEqual(cards.kaelen.stats.slice(0, 2).map((s) => [s.k, s.v]), [['Might', '+2'], ['This swing', 'Brutal Slam']]);
  assert.equal(cards.roll.sample, true, 'the dice are the script\'s');
  assert.deepEqual(cards.roll.stats.map((s) => s.v), ['8 + 8 = 16', '+2', '18']);
  assert.equal(cards.tier.title, 'Tier 3 — the strong', 'the matched band\'s own note');
  assert.equal(cards.tier.tiers.on, 2);
  assert.equal(cards.skeleton.sample, false, 'a creature\'s numbers are its data, not a sample');
  assert.ok(cards.bugbear.body.some((b) => b.includes('The bugbear rounds on you')), 'no bugbear entry: it shows what the script says');
  assert.ok(cards.bugbear.stats.some((s) => s.kw === 'role:brute'), '...plus its role card');
});

test('a piece with no data entry shows only what the script says', () => {
  const grapple = EXAMPLES.find((e) => e.slug === 'the-grapple');
  const c = cardsOf(grapple).find((x) => x.key === 'cultist');
  assert.equal(c.def.from, null);
  for (const b of c.model.body) assert.match(b, /^<span class="rbs-say">/);
});

test('the widget hard-codes no rules text: no data description appears in its source', () => {
  const used = new Set();
  for (const ex of EXAMPLES) for (const { def } of cardsOf(ex)) {
    for (const r of [def.from, ...def.links, def.role && 'role:' + def.role, def.tiers && 'frontpage:' + def.tiers]) if (r) used.add(r);
  }
  used.add('creature:skeleton-archer'); used.add('creature:cultist-acolyte');
  const lookup = { glossary: 'glossary', creature: 'creature', role: 'role', frontpage: 'frontpage', tier: 'frontpage' };
  for (const r of used) {
    const ref = P.parseRef(r);
    const e = REFS[lookup[ref.kind]][ref.slug];
    for (const t of [e.description, e.summary, e.properties && e.properties.traits_display]) {
      if (!t || t.length < 24) continue;
      const probe = t.replace(/\{@[a-z]+ ([^}|]+)(?:\|([^}]+))?\}/g, (m, a, b) => b || a).slice(0, 40);
      assert.ok(!SRC.includes(probe), `${r}: the widget repeats its text ("${probe}")`);
    }
  }
});

// ── keyword cards nest ──────────────────────────────────────────────────────
const KW_RE = /data-rbs-kw="([^"]+)"/g;
const kwRefs = (html) => [...html.matchAll(KW_RE)].map((m) => m[1]);

test('every keyword button on every card opens a card of its own (no dead buttons)', () => {
  const seen = new Set();
  const queue = [];
  for (const ex of EXAMPLES) for (const { model } of cardsOf(ex)) queue.push(...kwRefs(P.buildCardHtml(model, 'paper')));
  while (queue.length) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);
    const k = P.resolveKeyword(ref, REFS);
    assert.ok(k, `${ref} resolves to a keyword card`);
    queue.push(...kwRefs(P.buildCardHtml(k, 'seal')));
  }
  assert.ok(seen.size >= 8, `the shipped cards reach a web of keyword cards (${seen.size})`);
});

test('keywords nest: a paper card opens a seal card, which offers the next keyword its own text names', () => {
  const swing = EXAMPLES.find((e) => e.slug === 'kaelen-swings');
  const what = cardsOf(swing).find((c) => c.key === 'what').model;
  const first = kwRefs(P.buildCardHtml(what, 'paper'));
  assert.deepEqual(first, ['glossary:push', 'glossary:forced-movement']);
  const push = P.resolveKeyword('glossary:push', REFS);
  const html = P.buildCardHtml(push, 'seal');
  assert.match(html, /^<div class="rbs-kcard" role="dialog"/);
  assert.equal(push.title, 'Push');
  assert.deepEqual(push.body, [P.termHtml(SOURCES.glossary.find((g) => g.slug === 'push').description, REFS)]);
  assert.ok(kwRefs(html).includes('glossary:forced-movement'), 'the push card names forced movement, so it links it');
  assert.ok(!kwRefs(html).includes('glossary:push'), 'never itself');
  const fm = P.resolveKeyword('glossary:forced-movement', REFS);
  assert.ok(fm.links.some((l) => l.ref === 'glossary:slide'), 'and that card links on again, to slide');
  const montage = P.resolveKeyword('glossary:montage-test', REFS);
  assert.ok(!montage.links.some((l) => l.ref === 'glossary:pull'), '"pull it off" is not the Pull rule');
});

test('termHtml: a glossary slug becomes a keyword button; an unknown one stays plain text', () => {
  assert.match(P.termHtml('{@movement push|pushed}', REFS), /<button type="button" class="rbs-kw" data-rbs-kw="glossary:push">pushed<\/button>/);
  assert.equal(P.termHtml('{@movement nowhere|plain}', REFS), 'plain');
  assert.equal(P.resolveKeyword('glossary:nowhere', REFS), null);
  assert.equal(P.resolveKeyword('web:x', REFS), null);
});

// ── the board view markup ───────────────────────────────────────────────────
test('buildBoardViewHtml: scene, caption, controls with one dot per beat, and a card layer', () => {
  const swing = EXAMPLES.find((e) => e.slug === 'kaelen-swings');
  const { scene } = P.validateScene(swing.properties.scene, linesOf(swing));
  const html = P.buildBoardViewHtml(scene, { lines: linesOf(swing), cover: "The Lich's Lair" });
  assert.match(html, /class="rbs-scene rbs-closed"/, 'the book starts shut');
  assert.equal((html.match(/<i><\/i>/g) || []).length, scene.beats.length);
  for (const a of ['data-rbs-back', 'data-rbs-pause', 'data-rbs-fwd', 'data-rbs-cards', 'data-rbs-tx'])
    assert.ok(html.includes(a), a);
  assert.match(html, /data-rbs-card="kaelen" aria-label="Kaelen"/);
  assert.match(html, /role="button" tabindex="-1"/, 'a piece is not tabbable until the book opens');
  assert.ok(html.includes('The Lich&#39;s Lair') || html.includes("The Lich's Lair"), 'the cover carries the scene title');
  assert.match(html, /<span class="rbs-die"[^>]*>8<\/span>/, 'the dice show the script\'s dice');
  assert.match(html, /TIER 3 · 18/, 'the ribbon shows the script\'s tier and total');
});
