#!/usr/bin/env node
/**
 * Unit tests for the pure logic of widgets/rulebook-example-player.js: the
 * headless, DOM-free surface — staged-example sequencing (line order, roll-step
 * order, the reduced-motion path), the safe text-markup promoter, and the
 * script HTML builder. The DOM controller mount() needs a browser and is not
 * exercised here.
 *
 * Run: `node --test tools/test-rulebook-example-player.mjs`
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

// A little three-line scene with one roll in the middle (mirrors the seed data).
const SCRIPT = {
  name: 'Bursting the door',
  properties: {
    icon: '🚪', title: 'Bursting the door',
    stage: { pc: { fig: '🛡', label: 'ORDEN' }, foe: { fig: '🚪', label: 'THE DOOR' } },
    lines: [
      { speaker: 'DIRECTOR', kind: 'dir', text: 'The door is barred.' },
      { speaker: 'ORDEN', kind: 'pc', text: 'Might test!' },
      {
        speaker: 'ROLL', kind: 'roll', dice: [7, 5], tier: 'TIER 2',
        steps: [
          { text: '= **12**' }, { text: '+2 **Might**' },
          { text: "(it's a Might test)", why: true }, { text: '→ **14**' }
        ]
      },
      { speaker: 'DIRECTOR', kind: 'dir', text: "You're through, but ~~the noise carries~~." }
    ]
  }
};

// ── tokenForLine: who glows ─────────────────────────────────────────────────
test('tokenForLine: the player line glows the PC token, the director line the FOE', () => {
  assert.equal(P.tokenForLine({ kind: 'pc' }), 'pc');
  assert.equal(P.tokenForLine({ kind: 'dir' }), 'foe');
});

test('tokenForLine: a roll (or anything else) glows nothing — the dice are the focus', () => {
  assert.equal(P.tokenForLine({ kind: 'roll' }), null);
  assert.equal(P.tokenForLine({ kind: 'weird' }), null);
  assert.equal(P.tokenForLine(null), null);
});

// ── isRoll ──────────────────────────────────────────────────────────────────
test('isRoll is true only for kind:roll', () => {
  assert.equal(P.isRoll({ kind: 'roll' }), true);
  assert.equal(P.isRoll({ kind: 'pc' }), false);
  assert.equal(P.isRoll(null), false);
});

// ── rollRevealOrder: the math steps out, the tier stamps LAST ────────────────
test('rollRevealOrder: steps come out in authored order, then the tier stamp last', () => {
  const line = SCRIPT.properties.lines[2];
  const order = P.rollRevealOrder(line);
  assert.deepEqual(order.map((o) => o.type), ['step', 'step', 'step', 'step', 'tier']);
  assert.deepEqual(order.map((o) => o.text), ['= **12**', '+2 **Might**', "(it's a Might test)", '→ **14**', 'TIER 2']);
  // the "why" beat is flagged; the plain steps are not.
  assert.deepEqual(order.filter((o) => o.type === 'step').map((o) => o.why), [false, false, true, false]);
});

test('rollRevealOrder: no tier -> no trailing stamp; no steps -> empty', () => {
  assert.deepEqual(P.rollRevealOrder({ steps: [{ text: 'a' }] }).map((o) => o.type), ['step']);
  assert.deepEqual(P.rollRevealOrder({}), []);
  assert.deepEqual(P.rollRevealOrder(null), []);
});

// ── planScript: the ordered, timed beat list ────────────────────────────────
test('planScript: one beat per line, tokens assigned, roll beat carries dice + reveals', () => {
  const plan = P.planScript(SCRIPT.properties);
  assert.equal(plan.reduced, false);
  assert.equal(plan.stageIn, true);
  assert.equal(plan.beats.length, 4);
  assert.deepEqual(plan.beats.map((b) => b.token), ['foe', 'pc', null, 'foe']);
  assert.deepEqual(plan.beats.map((b) => b.roll), [false, false, true, false]);

  const roll = plan.beats[2];
  assert.deepEqual(roll.dice, [7, 5]);
  assert.equal(roll.reveals.length, 5);          // 4 steps + tier
  assert.equal(roll.diceTicks, P.DICE_TICKS);
  assert.equal(roll.stepDelay, P.STEP_MS);
  assert.equal(roll.afterDelay, P.ROLL_AFTER_MS);
  assert.equal(plan.beats[0].afterDelay, P.LINE_MS);   // a normal line dwells LINE_MS
});

test('planScript reduced-motion: everything collapses to zero delay, stage does not slide', () => {
  const plan = P.planScript(SCRIPT.properties, { reducedMotion: true });
  assert.equal(plan.reduced, true);
  assert.equal(plan.stageIn, false);
  for (const b of plan.beats) {
    assert.equal(b.afterDelay, 0);
    if (b.roll) { assert.equal(b.diceTicks, 0); assert.equal(b.stepDelay, 0); }
  }
});

test('planScript: an empty / missing script yields no beats', () => {
  assert.deepEqual(P.planScript({}).beats, []);
  assert.deepEqual(P.planScript(null).beats, []);
});

// ── richText: escape first, then promote the two authored markers ───────────
test('richText: promotes **bold** and ~~dmg~~ after escaping', () => {
  assert.equal(P.richText('= **12**'), '= <b>12</b>');
  assert.equal(P.richText('~~prone~~ at your boots'), '<span class="rbx-dmg">prone</span> at your boots');
  assert.equal(P.richText('a **b** and ~~c~~'), 'a <b>b</b> and <span class="rbx-dmg">c</span>');
});

test('richText: escapes HTML so authored data cannot inject markup (XSS)', () => {
  const out = P.richText('<img src=x onerror=alert(1)> **safe**');
  assert.ok(!/<img/i.test(out), 'raw <img must not survive');
  assert.ok(/&lt;img/.test(out), 'the tag must be escaped');
  assert.ok(/<b>safe<\/b>/.test(out), 'the bold marker still promotes');
});

// ── buildScriptHtml: structural DOM string ──────────────────────────────────
test('buildScriptHtml: renders the banner, stage tokens, and every line', () => {
  const html = P.buildScriptHtml(SCRIPT);
  assert.ok(html.indexOf('BURSTING THE DOOR') >= 0, 'the banner title is uppercased');
  assert.ok(html.indexOf('data-rbx-replay') >= 0, 'a replay button is present');
  assert.ok(html.indexOf('ORDEN') >= 0 && html.indexOf('THE DOOR') >= 0, 'both stage tokens render');
  assert.equal((html.match(/class="rbx-line/g) || []).length, 4, 'one node per line');
});

test('buildScriptHtml: the roll line carries its scripted dice, cells, and tier stamp', () => {
  const html = P.buildScriptHtml(SCRIPT);
  assert.ok(html.indexOf('data-rbx-dice="7,5"') >= 0, 'the settle values ride on the line');
  assert.equal((html.match(/class="rbx-die"/g) || []).length, 2, 'one die cell per scripted die');
  assert.ok(/rbx-tstamp">TIER 2</.test(html), 'the tier stamp renders last');
  assert.ok(/rbx-mstep rbx-why">/.test(html), 'the why step is flagged');
});

test('buildScriptHtml: data text is escaped (no raw injection)', () => {
  const html = P.buildScriptHtml({ name: 'x', properties: { stage: {}, lines: [{ speaker: '<b>D</b>', kind: 'dir', text: '<script>x</script>' }] } });
  assert.ok(!/<script>x<\/script>/.test(html), 'raw <script> must not survive');
  assert.ok(html.indexOf('&lt;script&gt;') >= 0, 'text is escaped');
});

// ── the seed data is well-formed against the shape the player consumes ───────
test('seed data/rulebook-examples.json: 7 scripts, each a valid stage + lines scene', () => {
  const raw = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rulebook-examples.json'), 'utf8'));
  assert.ok(Array.isArray(raw) && raw.length === 7, 'seven seeded scripts (v10.4 adds the Lair parts 2-4)');
  const slugs = raw.map((r) => r.slug).sort();
  assert.deepEqual(slugs, [
    'aftermath', 'bursting-the-door', 'into-the-lair', 'kaelen-swings',
    'minion-skirmish', 'the-grapple', 'the-lich-fight',
  ]);
  for (const item of raw) {
    assert.ok(item.slug && item.name, 'ReferenceItem slug + name');
    const p = item.properties || {};
    assert.ok(p.stage && p.stage.pc && p.stage.foe, `${item.slug} has a two-sided stage`);
    assert.ok(Array.isArray(p.lines) && p.lines.length >= 3, `${item.slug} has lines`);
    const roll = p.lines.filter((l) => l.kind === 'roll');
    assert.equal(roll.length, 1, `${item.slug} has exactly one roll line`);
    assert.ok(Array.isArray(roll[0].dice) && roll[0].dice.length === 2, `${item.slug} roll has 2 dice`);
    assert.ok(roll[0].tier, `${item.slug} roll stamps a tier`);
    // Every roll plans to reveal its steps then the tier last.
    const order = P.rollRevealOrder(roll[0]);
    assert.equal(order[order.length - 1].type, 'tier', `${item.slug} reveals the tier last`);
  }
});

test('the-lich-fight seeds startMalice, a new v10.4 field', () => {
  const raw = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rulebook-examples.json'), 'utf8'));
  const lich = raw.find((r) => r.slug === 'the-lich-fight');
  assert.equal(typeof lich.properties.startMalice, 'number');
});

// ── computeTableState: the Lair table/lesson state, replayed from _effects ──
const EFFECT_LINES = [
  { _effects: [{ type: 'squad', count: 4 }, { type: 'captain', up: true }] },
  { _effects: [{ type: 'minion', fallen: 2 }] },
  { _effects: [{ type: 'stamina', target: 'kaelen', pct: 82 }] },
  { _effects: [{ type: 'minion', fallen: 2 }, { type: 'captain', up: false }] },
];

test('computeTableState: -1 is the rest state (nothing applied yet)', () => {
  const st = P.computeTableState(EFFECT_LINES, -1);
  assert.deepEqual(st.stamina, {});
  assert.equal(st.squadCount, null);
  assert.equal(st.squadFallen, 0);
  assert.equal(st.captainUp, null);
});

test('computeTableState: folds every effect up to and including uptoIndex', () => {
  const mid = P.computeTableState(EFFECT_LINES, 1);
  assert.equal(mid.squadCount, 4);
  assert.equal(mid.squadFallen, 2);
  assert.equal(mid.captainUp, true);   // not yet set false (that's beat 3)

  const end = P.computeTableState(EFFECT_LINES, 3);
  assert.equal(end.squadFallen, 4);    // 2 + 2, cumulative across beats
  assert.equal(end.captainUp, false);
  assert.equal(end.stamina.kaelen, 82);
});

test('computeTableState: stepping "back" (a smaller uptoIndex) recomputes rather than undoing', () => {
  const forward = P.computeTableState(EFFECT_LINES, 3);
  const back = P.computeTableState(EFFECT_LINES, 1);
  assert.notDeepEqual(forward, back);
  // Recomputing at the SAME index twice is always identical (pure function) —
  // the property that makes "back" safe to call repeatedly.
  assert.deepEqual(back, P.computeTableState(EFFECT_LINES, 1));
});

test('computeTableState: malice/tally are absolute (last write), victories accumulate', () => {
  const lines = [
    { _effects: [{ type: 'malice', value: 4 }] },
    { _effects: [{ type: 'malice', value: 1 }] },
    { _effects: [{ type: 'victories', value: 1 }] },
    { _effects: [{ type: 'victories', value: 1 }] },
    { _effects: [{ type: 'tally', success: 1, failure: 0 }] },
  ];
  assert.equal(P.computeTableState(lines, 1).malice, 1);
  assert.equal(P.computeTableState(lines, 3).victories, 2);
  assert.deepEqual(P.computeTableState(lines, 4).tally, { success: 1, failure: 0 });
});

test('computeTableState: a line with no _effects is skipped, not an error', () => {
  assert.doesNotThrow(() => P.computeTableState([{ text: 'no effects here' }], 0));
  assert.doesNotThrow(() => P.computeTableState(null, 5));
});

// ── startMalice: the rest value a solo boss's Malice counter must show ──────
test('startMaliceOf: reads properties.startMalice, defaulting to 0 when absent', () => {
  assert.equal(P.startMaliceOf({ properties: { startMalice: 4 } }), 4);
  assert.equal(P.startMaliceOf({ properties: {} }), 0);
  assert.equal(P.startMaliceOf({}), 0);
  assert.equal(P.startMaliceOf(null), 0);
  // Flat shape (mirrors linesOf's own contract).
  assert.equal(P.startMaliceOf({ startMalice: 2 }), 2);
});

test('computeTableState: rest (-1) starts Malice at the script\'s startMalice, not 0', () => {
  const lines = [{ _effects: [{ type: 'malice', value: 4 }] }];
  assert.equal(P.computeTableState(lines, -1, 4).malice, 4);
  // No startMalice passed (most scripts have none) -> the old default, 0.
  assert.equal(P.computeTableState(lines, -1).malice, 0);
});

test('computeTableState: stepping all the way back returns Malice to startMalice, not 0', () => {
  const lines = [
    { _effects: [{ type: 'malice', value: 4 }] },
    { _effects: [{ type: 'malice', value: 1 }] },
  ];
  const forward = P.computeTableState(lines, 1, 4);
  assert.equal(forward.malice, 1);
  const backToRest = P.computeTableState(lines, -1, 4);
  assert.equal(backToRest.malice, 4);
});

test('buildLesson: a solo lesson\'s Malice counter starts at startMalice, not a hardcoded 0', () => {
  const lesson = { kind: 'solo', title: 'The lich\'s card', lede: 'x', malice: { spends: [] } };
  const rest = P.buildLesson(lesson, 4);
  assert.match(rest, /<b data-rbx-malice>4<\/b>/);
  // No startMalice (most lessons aren't a solo boss) -> unchanged default of 0.
  const noStart = P.buildLesson(lesson);
  assert.match(noStart, /<b data-rbx-malice>0<\/b>/);
});

test('buildLairExtras: threads startMalice through to the solo lesson it renders', () => {
  const lair = { table: { heroes: [] }, lessons: { p3: { kind: 'solo', title: 'x', lede: 'y', malice: { spends: [] } } } };
  const html = P.buildLairExtras('p3', lair, 4);
  assert.match(html, /<b data-rbx-malice>4<\/b>/);
});

test('the-lich-fight seed data: its startMalice actually reaches the rendered Malice counter', () => {
  const raw = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rulebook-examples.json'), 'utf8'));
  const lich = raw.find((r) => r.slug === 'the-lich-fight');
  const frontpage = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rulebook-frontpage.json'), 'utf8'));
  const scene = frontpage.find((i) => i.properties && i.properties.kind === 'worked-scene');
  const lair = { lessons: scene.properties.lessons, table: {}, rulesInPlay: {} };
  const html = P.buildLairExtras('p3', lair, P.startMaliceOf(lich));
  assert.match(html, new RegExp('<b data-rbx-malice>' + lich.properties.startMalice + '</b>'));
});

// ── richTerm: glossary-term promotion for the Lair's teaching-panel prose ────
test('richTerm: promotes {@cat slug} into the shared .rb-hl hover term', () => {
  const out = P.richTerm('a {@combat minion|minion} squad');
  assert.match(out, /class="rb-hl" data-rb-term="minion"/);
  assert.ok(out.includes('>minion<'), 'the display label defaults to the term');
});

test('richTerm: escapes HTML first, so authored data cannot inject markup', () => {
  const out = P.richTerm('<img src=x onerror=alert(1)> {@combat malice}');
  assert.ok(!/<img/i.test(out));
  assert.ok(/&lt;img/.test(out));
});

// ── buildLairExtras / buildLesson: the table + rules-in-play + teaching panel ─
test('buildLairExtras: renders the hero roster, rules-in-play chips, and the lesson', () => {
  const lair = {
    table: { heroes: [{ slug: 'kaelen', fig: '🪓', name: 'Kaelen' }] },
    rulesInPlay: { p2: [{ key: 'minions', label: 'Minions', term: 'minion' }] },
    lessons: { p2: { kind: 'squad', title: 'The minion squad', lede: 'lede text', squad: { fig: '🥷', count: 2 }, captain: { fig: '🥋', name: 'Adept', note: 'note' } } },
  };
  const html = P.buildLairExtras('p2', lair);
  assert.ok(html.includes('data-rbx-hero="kaelen"'), 'the hero bar carries its slug');
  assert.ok(html.includes('data-rb-term="minion"'), 'the rules-in-play chip is a glossary term');
  assert.equal((html.match(/data-rbx-minion="/g) || []).length, 2, 'one minion icon per squad.count');
  assert.ok(/rbx-tagsample/.test(html), 'the lesson is labelled a sample');
});

test('buildLairExtras: a script with no matching Lair part renders nothing extra', () => {
  assert.equal(P.buildLairExtras('p9', { table: { heroes: [] } }), '');
});
