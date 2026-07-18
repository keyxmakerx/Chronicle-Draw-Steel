#!/usr/bin/env node
/**
 * Unit tests for the PURE logic of widgets/rulebook-example-player.js.
 *
 * Covers the headless, DOM-free surface — the staged-example sequencing that the
 * dispatch pins (line sequencing, roll-step ordering, the reduced-motion path),
 * plus the safe text-markup promoter and the script HTML builder. The DOM
 * controller mount() needs a browser and is not exercised here.
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
test('seed data/rulebook-examples.json: 4 scripts, each a valid stage + lines scene', () => {
  const raw = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rulebook-examples.json'), 'utf8'));
  assert.ok(Array.isArray(raw) && raw.length === 4, 'four seeded scripts');
  const slugs = raw.map((r) => r.slug).sort();
  assert.deepEqual(slugs, ['bursting-the-door', 'into-the-lair', 'kaelen-swings', 'the-grapple']);
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
