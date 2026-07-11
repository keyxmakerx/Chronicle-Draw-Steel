#!/usr/bin/env node
/**
 * Pin tests for the character sheet's arithmetic evaluator (`safeEvalArith`).
 *
 * Written to LOCK current behavior BEFORE the L-3 hardening swap (DS-BETA-
 * HARDENING item 1) of the `Function()`-based evaluator for a hand-written ES5
 * recursive-descent parser, and to guard it forever after. Every assertion in
 * the main suite holds for BOTH the old `Function()` impl and the new parser —
 * the swap must be behavior-preserving on every real input.
 *
 * Real inputs are authored tier-damage formulas after `@chr` substitution
 * (`"2 + @chr"` → `"2 + 3"`); see `substituteFormula` and the tier `value`
 * fields in the creature data. The evaluator is gated to digits, the four
 * operators, parentheses, dot, and space before evaluating.
 *
 * Run: node --test tools/test-arith-evaluator.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');
const ev = cs.safeEvalArith;

test('basic binary ops', () => {
  assert.equal(ev('2 + 3'), 5);
  assert.equal(ev('10 - 4'), 6);
  assert.equal(ev('3 * 4'), 12);
  assert.equal(ev('12 / 4'), 3);
});

test('the real call shape: number + substituted characteristic', () => {
  assert.equal(ev('2 + 3'), 5);     // "2 + @chr", @chr=3
  assert.equal(ev('5 + 0'), 5);     // @chr=0
  assert.equal(ev('7 + -2'), 5);    // @chr=-2 (a negative characteristic)
  assert.equal(ev('4 - 1'), 3);
});

test('operator precedence (* / before + -)', () => {
  assert.equal(ev('2 + 3 * 4'), 14);
  assert.equal(ev('20 - 12 / 4'), 17);
  assert.equal(ev('2 * 3 + 4'), 10);
});

test('parentheses override precedence', () => {
  assert.equal(ev('(2 + 3) * 4'), 20);
  assert.equal(ev('2 * (3 + 4)'), 14);
  assert.equal(ev('((1 + 2))'), 3);
});

test('unary minus and plus', () => {
  assert.equal(ev('-5'), -5);
  assert.equal(ev('+5'), 5);
  assert.equal(ev('2 + -3'), -1);
  assert.equal(ev('2 - -3'), 5);
  assert.equal(ev('-(2 + 3)'), -5);
});

test('decimals', () => {
  assert.equal(ev('1.5 + 2'), 3.5);
  assert.equal(ev('.5 + .5'), 1);
  assert.equal(ev('10 / 4'), 2.5);
});

test('left-to-right within a precedence level', () => {
  assert.equal(ev('10 - 3 - 2'), 5);
  assert.equal(ev('16 / 4 / 2'), 2);
});

test('whitespace is insignificant', () => {
  assert.equal(ev('  2+3  '), 5);
  assert.equal(ev('2   *   3'), 6);
});

test('division by zero → null (non-finite, matches the old fallback)', () => {
  assert.equal(ev('1 / 0'), null);
  assert.equal(ev('0 / 0'), null);
  assert.equal(ev('5 / (2 - 2)'), null);
});

test('empty / blank / nullish → null', () => {
  assert.equal(ev(''), null);
  assert.equal(ev('   '), null);
  assert.equal(ev(null), null);
  assert.equal(ev(undefined), null);
});

test('the character gate rejects non-arithmetic → null', () => {
  assert.equal(ev('2 + x'), null);        // identifier
  assert.equal(ev('alert(1)'), null);     // call + identifier
  assert.equal(ev('1e3'), null);          // 'e' blocked by the gate
  assert.equal(ev('0x10'), null);         // 'x' blocked by the gate
});

test('malformed arithmetic (passes the gate) → null', () => {
  assert.equal(ev('2 +'), null);          // dangling operator
  assert.equal(ev('* 3'), null);          // leading binary operator
  assert.equal(ev('2 3'), null);          // two numbers, no operator
  assert.equal(ev('()'), null);           // empty parens
  assert.equal(ev('(2 + 3'), null);       // unbalanced open
  assert.equal(ev('2 + 3)'), null);       // unbalanced close
  assert.equal(ev('2..3'), null);         // malformed number
});

test('non-string input is coerced via String()', () => {
  assert.equal(ev(42), 42);
});

// ── Post-L-3-swap: out-of-grammar inputs the old Function() happened to accept
// (JS-engine quirks) now reject cleanly. The parser implements only the
// documented grammar (+ - * / parens unary); this is a deliberate, safer
// narrowing — no authored damage formula uses these, and the caller degrades to
// the raw substituted string when the evaluator returns null. See the
// DS-BETA-HARDENING report §1.
test('out-of-grammar JS quirks now reject (post-L-3 narrowing)', () => {
  assert.equal(ev('2**3'), null);   // old Function() → 8 (exponentiation)
  assert.equal(ev('08'), null);     // old Function() → strict-mode octal SyntaxError → null (unchanged)
});
