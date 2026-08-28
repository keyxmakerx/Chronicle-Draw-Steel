#!/usr/bin/env node
/**
 * Every control the rulebook renders must either DO something or SAY it cannot.
 *
 * The rulebook front page renders zero listeners of its own: it emits a frozen
 * DOM whose interactivity comes entirely from two globals loaded before it,
 * RulebookFoldEngine and RulebookExamplePlayer, which bind by attribute
 * selector. A button that carries none of those attributes is inert, and
 * nothing in the page says so.
 *
 * Three such buttons shipped. The worst was "📖 Full chapter", appended to
 * EVERY characteristic tile with no data attribute, no id, and no handler
 * anywhere in the repo — and, unlike the others, no comment declaring it a
 * placeholder. Four example buttons were inert too; a source comment called
 * them a seam, which tells the developer and not the reader. Meanwhile the
 * Lair parts in the same file already did this correctly: disabled,
 * aria-disabled, and a visible "soon" badge.
 *
 * The wired-attribute list below is DERIVED from what the engine and player
 * actually query, not hard-coded, so deleting a binding moves this guard with
 * it rather than leaving a stale allowlist behind.
 *
 * Run: `node --test tools/test-rulebook-affordance-honesty.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const W = (f) => join(HERE, '..', 'widgets', f);

const frontpage = readFileSync(W('rulebook-frontpage.js'), 'utf8');
const engine = readFileSync(W('rulebook-fold-engine.js'), 'utf8');
const player = readFileSync(W('rulebook-example-player.js'), 'utf8');

// Attributes the engine or player genuinely bind a listener to.
function boundAttributes() {
  const found = new Set();
  // NOTE the (?:All)? — `querySelectorAll?` applies the ? to the final 'l',
  // so it misses plain querySelector(...) and reported data-rb-search, which
  // IS bound, as an undocumented binding.
  const re = /querySelector(?:All)?\('\[(data-rb[a-z-]*)\]'\)/g;
  for (const src of [engine, player]) {
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  // The flap trigger is queried relative to its row rather than from the root.
  if (/data-rb-flap-trigger/.test(engine)) found.add('data-rb-flap-trigger');
  return found;
}

test('the engine and player still bind attributes at all', () => {
  const bound = boundAttributes();
  assert.ok(bound.size >= 8,
    `only ${bound.size} bound attributes found — the extraction regex has drifted, ` +
    `and a guard that derives an empty allowlist passes everything`);
  assert.ok(bound.has('data-rbx-play'), 'the player no longer binds data-rbx-play');
  assert.ok(bound.has('data-rb-goto-reader'), 'the engine no longer binds data-rb-goto-reader');
});

test('no button is rendered live-looking but inert', () => {
  const bound = boundAttributes();
  const offenders = [];

  // Each rendered button, from its tag open to the matching close. The source
  // builds them by string concatenation, so this reads the emitted markup as
  // it appears in the source rather than parsing JavaScript.
  const parts = frontpage.split('<button');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</button>');
    const markup = end === -1 ? parts[i].slice(0, 400) : parts[i].slice(0, end);

    const wired = [...bound].some((a) => markup.includes(a));
    const declaredDead = /\bdisabled\b/.test(markup);
    // A button whose attribute is interpolated (' + attr + ') cannot be judged
    // statically; the relChips test below judges its builder instead.
    const computed = /\+ attr \+/.test(markup);
    if (wired || declaredDead || computed) continue;

    const line = frontpage.slice(0, frontpage.indexOf(parts[i])).split('\n').length;
    offenders.push(`line ~${line}: ${markup.replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  assert.deepEqual(offenders, [],
    'these buttons carry no attribute the engine or player binds, and are not ' +
    'marked disabled — they look live and do nothing:\n  ' + offenders.join('\n  '));
});

test('a control marked pending is marked for the reader, not just the source', () => {
  // disabled alone is invisible without the styling and the badge, which is
  // how the Lair parts already do it.
  const soonButtons = (frontpage.split('<button').slice(1))
    .map((c) => { const e = c.indexOf('</button>'); return e === -1 ? c.slice(0, 400) : c.slice(0, e); })
    .filter((b) => /\bdisabled\b/.test(b));
  assert.ok(soonButtons.length > 0, 'expected at least one pending control');
  for (const b of soonButtons) {
    assert.ok(/rb-soon|aria-disabled/.test(b),
      'a disabled control must also be announced (aria-disabled) and badged ' +
      '(rb-soon), or the reader cannot tell it apart from a live one:\n' + b.slice(0, 160));
  }
});

test('the example player returns one shape, mounted or not', () => {
  const P = require('../widgets/rulebook-example-player.js');
  const nullRoot = Object.keys(P.mount(null, {})).sort();
  // The real mount's shape, read from the source's single return site.
  const m = player.match(/return \{\s*destroy:[^}]*\}/g) || [];
  assert.ok(m.length >= 1, 'could not find the mount return shape');

  assert.deepEqual(nullRoot, ['collapseAll', 'destroy', 'play', 'stopAll'],
    'the null-root mount must return the same keys as a real one; it used to ' +
    'omit collapseAll, so calling it threw a TypeError instead of no-opping — ' +
    "and rulebook-frontpage's onClose('wing') hook is exactly such a caller");
});

test('the fold engine documents only bindings it has, or says which it lacks', () => {
  // [data-rb-veil] is listed in the contract header but never queried. That is
  // allowed only because the header now says so explicitly.
  const header = engine.slice(0, engine.indexOf('*/'));
  const bound = boundAttributes();
  const documented = [...header.matchAll(/\[(data-rb[a-z-]*)\]/g)].map((m) => m[1]);
  assert.ok(documented.length > 0, 'the contract header lists no attributes');

  for (const attr of new Set(documented)) {
    if (bound.has(attr)) continue;
    const idx = header.indexOf('[' + attr + ']');
    const nearby = header.slice(idx, idx + 500);
    assert.match(nearby, /MARKER ONLY|never queries/,
      `the header documents [${attr}] as part of the contract, but nothing binds ` +
      `it. Either wire it or say plainly that it is a marker the caller must ` +
      `pair with a real binding.`);
  }
});

test('relChips cannot emit a chip that is bound to nothing', () => {
  const bound = boundAttributes();
  const body = frontpage.slice(frontpage.indexOf('function relChips'));
  const fn = body.slice(0, body.indexOf('\n  }') + 4);

  assert.ok(/if \(!attr\)/.test(fn),
    'relChips no longer guards the case where no goto branch matched. An ' +
    'unrecognised r.goto emits attr = \'\', producing a chip styled and ' +
    'labelled like its live siblings and bound by nothing — one typo in the ' +
    'authored data, one silently dead control.');

  const fallback = fn.slice(fn.indexOf('if (!attr)'));
  assert.match(fallback.slice(0, fallback.indexOf('continue')), /\bdisabled\b/,
    'the no-goto fallback must render a disabled chip, not a live-looking one');

  for (const attr of ['data-rb-goto-reader', 'data-rb-goto-flap', 'data-rb-goto-card']) {
    assert.ok(fn.includes(attr), `relChips no longer emits ${attr}`);
    assert.ok(bound.has(attr), `${attr} is emitted but the engine no longer binds it`);
  }
});
