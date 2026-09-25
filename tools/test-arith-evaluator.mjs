#!/usr/bin/env node
/**
 * Pin tests for the character sheet's arithmetic evaluator (`safeEvalArith`),
 * a hand-written ES5 recursive-descent parser (not `Function()`/`eval`, to
 * avoid evaluating arbitrary JS from authored data). Two narrow divergences
 * from naive JS semantics are pinned separately below: out-of-grammar JS
 * quirks that now reject, and adjacent-sign inputs (e.g. `3--2`) that are
 * valid unary chains under this grammar. A try/catch crash guard around the
 * parse is pinned by the pathological-input tests at the end of this file.
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

// Out-of-grammar inputs the old Function()-based evaluator happened to accept
// (JS-engine quirks) now reject cleanly: the parser implements only the
// documented grammar (+ - * / parens unary). No authored damage formula uses
// these; the caller degrades to the raw substituted string on null.
test('out-of-grammar JS quirks now reject (post-L-3 narrowing)', () => {
  assert.equal(ev('2**3'), null);   // old Function() → 8 (exponentiation)
  assert.equal(ev('08'), null);     // old Function() → strict-mode octal SyntaxError → null (unchanged)
});

// Intentional divergence from the old Function()-based evaluator: the new
// grammar has only a stacking unary +/-, no increment/decrement operators, so
// adjacent signs are valid unary chains: `3--2` = 3 - (-2) = 5,
// `2+++3` = 2 + (+3) = 5, `--5` = -(-5) = 5. Reachable from real data via
// `N-@chr` with a negative characteristic (legal in Draw Steel).
test('adjacent-sign inputs are valid unary chains (old Function() impl: null via SyntaxError)', () => {
  assert.equal(ev('3--2'), 5);
  assert.equal(ev('2+++3'), 5);
  assert.equal(ev('--5'), 5);
});

// Crash guard: pathological nesting/chains that pass the character gate could
// overflow the call stack (parseFactor recurses once per '(' and once per
// unary sign, no depth limit). safeEvalArith wraps the parse in a try/catch
// and degrades to null instead of throwing an uncaught RangeError.
test('pathological paren nesting degrades to null, does not throw', () => {
  var deep = '('.repeat(4000) + '1' + ')'.repeat(4000);
  assert.doesNotThrow(function () { ev(deep); });
  assert.equal(ev(deep), null);
});

test('pathological unary-sign chain degrades to null, does not throw', () => {
  // parseFactor recurses once per sign (~1 frame/char); 50,000 gives headroom
  // above the stack-overflow boundary across Node versions/platforms.
  var chain = '-'.repeat(50000) + '5';
  assert.doesNotThrow(function () { ev(chain); });
  assert.equal(ev(chain), null);
});
