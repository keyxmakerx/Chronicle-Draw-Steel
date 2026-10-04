#!/usr/bin/env node
/**
 * Unit tests for the PURE state machine of widgets/rulebook-fold-engine.js.
 *
 * Covers only the headless, DOM-free surface (createState / reduce /
 * escapePriority / wingSide / clampWingWidth / isMobileWidth / motionAllowed /
 * tileMatches / blockMatches). The DOM controller `mount()` needs a browser and
 * is not exercised here.
 *
 * The reducer's single-open invariant is the core contract: opening any one of
 * the three folds (wing / flap / reader) closes the other two, and the returned
 * `effects` list names the closes so the DOM controller can run them.
 *
 * Run: `node --test tools/test-rulebook-fold-engine.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../widgets/rulebook-fold-engine.js');

// ── FOLD vocabulary & createState ──────────────────────────────────────────
test('FOLD exposes the frozen fold-kind vocabulary', () => {
  assert.deepEqual(E.FOLD, { WING: 'wing', FLAP: 'flap', READER: 'reader' });
});

test('createState returns a fresh all-closed state', () => {
  assert.deepEqual(E.createState(), { wing: null, flap: null, reader: false });
  // Fresh object each call (no shared singleton).
  assert.notEqual(E.createState(), E.createState());
});

// ── Opening from a clean state ─────────────────────────────────────────────
test('OPEN_WING from empty: just open-wing, no closes', () => {
  const r = E.reduce(E.createState(), { type: 'OPEN_WING', id: 'w1' });
  assert.deepEqual(r.state, { wing: 'w1', flap: null, reader: false });
  assert.deepEqual(r.effects, ['open-wing']);
});

test('OPEN_FLAP from empty: just open-flap', () => {
  const r = E.reduce(E.createState(), { type: 'OPEN_FLAP', id: 'f1' });
  assert.deepEqual(r.state, { wing: null, flap: 'f1', reader: false });
  assert.deepEqual(r.effects, ['open-flap']);
});

test('OPEN_READER from empty: just open-reader', () => {
  const r = E.reduce(E.createState(), { type: 'OPEN_READER' });
  assert.deepEqual(r.state, { wing: null, flap: null, reader: true });
  assert.deepEqual(r.effects, ['open-reader']);
});

// ── SINGLE-OPEN INVARIANT: every cross-transition ──────────────────────────
test('single-open invariant: wing -> flap closes the wing', () => {
  const prev = { wing: 'w1', flap: null, reader: false };
  const r = E.reduce(prev, { type: 'OPEN_FLAP', id: 'f1' });
  assert.deepEqual(r.state, { wing: null, flap: 'f1', reader: false });
  assert.ok(r.effects.includes('close-wing'));
  assert.ok(r.effects.includes('open-flap'));
});

test('single-open invariant: wing -> reader closes the wing', () => {
  const prev = { wing: 'w1', flap: null, reader: false };
  const r = E.reduce(prev, { type: 'OPEN_READER' });
  assert.deepEqual(r.state, { wing: null, flap: null, reader: true });
  assert.ok(r.effects.includes('close-wing'));
  assert.ok(r.effects.includes('open-reader'));
});

test('single-open invariant: flap -> wing closes the flap', () => {
  const prev = { wing: null, flap: 'f1', reader: false };
  const r = E.reduce(prev, { type: 'OPEN_WING', id: 'w1' });
  assert.deepEqual(r.state, { wing: 'w1', flap: null, reader: false });
  assert.ok(r.effects.includes('close-flap'));
  assert.ok(r.effects.includes('open-wing'));
});

test('single-open invariant: flap -> reader closes the flap', () => {
  const prev = { wing: null, flap: 'f1', reader: false };
  const r = E.reduce(prev, { type: 'OPEN_READER' });
  assert.deepEqual(r.state, { wing: null, flap: null, reader: true });
  assert.ok(r.effects.includes('close-flap'));
  assert.ok(r.effects.includes('open-reader'));
});

test('single-open invariant: reader -> wing closes the reader', () => {
  const prev = { wing: null, flap: null, reader: true };
  const r = E.reduce(prev, { type: 'OPEN_WING', id: 'w1' });
  assert.deepEqual(r.state, { wing: 'w1', flap: null, reader: false });
  assert.ok(r.effects.includes('close-reader'));
  assert.ok(r.effects.includes('open-wing'));
});

test('single-open invariant: reader -> flap closes the reader', () => {
  const prev = { wing: null, flap: null, reader: true };
  const r = E.reduce(prev, { type: 'OPEN_FLAP', id: 'f1' });
  assert.deepEqual(r.state, { wing: null, flap: 'f1', reader: false });
  assert.ok(r.effects.includes('close-reader'));
  assert.ok(r.effects.includes('open-flap'));
});

// ── Switching / re-opening the same fold ───────────────────────────────────
test('switching wings emits close-wing then open-wing and lands on the new id', () => {
  const prev = { wing: 'A', flap: null, reader: false };
  const r = E.reduce(prev, { type: 'OPEN_WING', id: 'B' });
  assert.deepEqual(r.state, { wing: 'B', flap: null, reader: false });
  assert.deepEqual(r.effects, ['close-wing', 'open-wing']);
});

test('re-opening the SAME wing id does NOT emit close-wing', () => {
  const prev = { wing: 'A', flap: null, reader: false };
  const r = E.reduce(prev, { type: 'OPEN_WING', id: 'A' });
  assert.deepEqual(r.state, { wing: 'A', flap: null, reader: false });
  assert.deepEqual(r.effects, ['open-wing']);
  assert.ok(!r.effects.includes('close-wing'));
});

test('switching flaps emits close-flap then open-flap; same flap id does not', () => {
  const switched = E.reduce({ wing: null, flap: 'A', reader: false }, { type: 'OPEN_FLAP', id: 'B' });
  assert.deepEqual(switched.effects, ['close-flap', 'open-flap']);
  const same = E.reduce({ wing: null, flap: 'A', reader: false }, { type: 'OPEN_FLAP', id: 'A' });
  assert.deepEqual(same.effects, ['open-flap']);
});

// ── Explicit close actions ─────────────────────────────────────────────────
test('CLOSE_WING emits close-wing when a wing is open, else nothing; preserves flap/reader', () => {
  const open = E.reduce({ wing: 'w1', flap: null, reader: true }, { type: 'CLOSE_WING' });
  assert.deepEqual(open.effects, ['close-wing']);
  assert.deepEqual(open.state, { wing: null, flap: null, reader: true });
  const noop = E.reduce({ wing: null, flap: 'f1', reader: false }, { type: 'CLOSE_WING' });
  assert.deepEqual(noop.effects, []);
  assert.deepEqual(noop.state, { wing: null, flap: 'f1', reader: false });
});

test('CLOSE_FLAP emits close-flap when a flap is open, else nothing; preserves wing/reader', () => {
  const open = E.reduce({ wing: 'w1', flap: 'f1', reader: false }, { type: 'CLOSE_FLAP' });
  assert.deepEqual(open.effects, ['close-flap']);
  assert.deepEqual(open.state, { wing: 'w1', flap: null, reader: false });
  const noop = E.reduce({ wing: null, flap: null, reader: true }, { type: 'CLOSE_FLAP' });
  assert.deepEqual(noop.effects, []);
  assert.deepEqual(noop.state, { wing: null, flap: null, reader: true });
});

test('CLOSE_READER emits close-reader when the reader is open, else nothing; preserves wing/flap', () => {
  const open = E.reduce({ wing: null, flap: 'f1', reader: true }, { type: 'CLOSE_READER' });
  assert.deepEqual(open.effects, ['close-reader']);
  assert.deepEqual(open.state, { wing: null, flap: 'f1', reader: false });
  const noop = E.reduce({ wing: 'w1', flap: null, reader: false }, { type: 'CLOSE_READER' });
  assert.deepEqual(noop.effects, []);
  assert.deepEqual(noop.state, { wing: 'w1', flap: null, reader: false });
});

// ── Unknown / no-op actions ────────────────────────────────────────────────
test('unknown action is a no-op with empty effects and unchanged state', () => {
  const prev = { wing: 'w1', flap: null, reader: false };
  const r = E.reduce(prev, { type: 'NONSENSE' });
  assert.deepEqual(r.effects, []);
  assert.deepEqual(r.state, prev);
});

test('reduce tolerates a null/undefined state by defaulting to createState()', () => {
  const r = E.reduce(null, { type: 'OPEN_WING', id: 'w1' });
  assert.deepEqual(r.state, { wing: 'w1', flap: null, reader: false });
  assert.deepEqual(r.effects, ['open-wing']);
});

// ── ESCAPE priority (flap > wing > reader) ─────────────────────────────────
test('ESCAPE dismisses the flap first when a flap is present', () => {
  // flap + reader both "open" — flap wins.
  const r = E.reduce({ wing: null, flap: 'f1', reader: true }, { type: 'ESCAPE' });
  assert.equal(r.target, 'flap');
  assert.deepEqual(r.effects, ['close-flap']);
  assert.deepEqual(r.state, { wing: null, flap: null, reader: true });
});

test('ESCAPE dismisses the wing when only a wing is open', () => {
  const r = E.reduce({ wing: 'w1', flap: null, reader: false }, { type: 'ESCAPE' });
  assert.equal(r.target, 'wing');
  assert.deepEqual(r.effects, ['close-wing']);
  assert.deepEqual(r.state, { wing: null, flap: null, reader: false });
});

test('ESCAPE dismisses the reader when only the reader is open', () => {
  const r = E.reduce({ wing: null, flap: null, reader: true }, { type: 'ESCAPE' });
  assert.equal(r.target, 'reader');
  assert.deepEqual(r.effects, ['close-reader']);
  assert.deepEqual(r.state, { wing: null, flap: null, reader: false });
});

test('ESCAPE on an empty state is a no-op with target null', () => {
  const prev = { wing: null, flap: null, reader: false };
  const r = E.reduce(prev, { type: 'ESCAPE' });
  assert.equal(r.target, null);
  assert.deepEqual(r.effects, []);
  assert.deepEqual(r.state, prev);
});

// ── escapePriority (the predicate ESCAPE consults) ─────────────────────────
test('escapePriority ranks flap > wing > reader, null when empty', () => {
  assert.equal(E.escapePriority({ wing: 'w', flap: 'f', reader: true }), 'flap');
  assert.equal(E.escapePriority({ wing: 'w', flap: null, reader: true }), 'wing');
  assert.equal(E.escapePriority({ wing: null, flap: null, reader: true }), 'reader');
  assert.equal(E.escapePriority({ wing: null, flap: null, reader: false }), null);
  assert.equal(E.escapePriority(null), null);
});

// ── Purity: reduce must not mutate its input ───────────────────────────────
test('reduce does not mutate its input state (frozen input survives)', () => {
  const frozen = Object.freeze({ wing: 'w1', flap: null, reader: false });
  const r = E.reduce(frozen, { type: 'OPEN_FLAP', id: 'f1' });
  // Original untouched...
  assert.deepEqual(frozen, { wing: 'w1', flap: null, reader: false });
  // ...and the returned state is a distinct object.
  assert.notEqual(r.state, frozen);
  assert.deepEqual(r.state, { wing: null, flap: 'f1', reader: false });
});

// ── wingSide ───────────────────────────────────────────────────────────────
test('wingSide: the Lair always wings left', () => {
  assert.equal(E.wingSide({ isLair: true }), 'left');
  assert.equal(E.wingSide({ isLair: true, columns: 3, column: 0 }), 'left');
});

test('wingSide: in a 2-col grid col0 wings right, the rightmost col wings left', () => {
  assert.equal(E.wingSide({ columns: 2, column: 0 }), 'right');
  assert.equal(E.wingSide({ columns: 2, column: 1 }), 'left');
});

test('wingSide: a single-column layout wings right', () => {
  assert.equal(E.wingSide({ columns: 1, column: 0 }), 'right');
  assert.equal(E.wingSide({}), 'right');
});

// ── clampWingWidth ─────────────────────────────────────────────────────────
test('clampWingWidth: a right wing with abundant space clamps to max (340)', () => {
  // avail = 1200 - 800 - 16 = 384 -> clamp to 340.
  assert.equal(E.clampWingWidth({ side: 'right', viewportWidth: 1200, cardRight: 800 }), 340);
});

test('clampWingWidth: a right wing in a tight space clamps to min (270)', () => {
  // avail = 600 - 560 - 16 = 24 -> clamp to 270.
  assert.equal(E.clampWingWidth({ side: 'right', viewportWidth: 600, cardRight: 560 }), 270);
});

test('clampWingWidth: a mid value passes through untouched', () => {
  // avail = 1000 - 684 - 16 = 300 -> within [270,340].
  assert.equal(E.clampWingWidth({ side: 'right', viewportWidth: 1000, cardRight: 684 }), 300);
});

test('clampWingWidth: a left wing measures the space to the card left (cardLeft - gutter)', () => {
  // avail = 700 - 16 = 684 -> clamp to 340.
  assert.equal(E.clampWingWidth({ side: 'left', cardLeft: 700 }), 340);
  // A narrow left space clamps to min.
  assert.equal(E.clampWingWidth({ side: 'left', cardLeft: 100 }), 270);
});

test('clampWingWidth: custom min/max/gutter override the defaults', () => {
  // avail = 500 - 200 - 10 = 290 -> clamp to [100, 200] -> 200.
  assert.equal(E.clampWingWidth({
    side: 'right', viewportWidth: 500, cardRight: 200, min: 100, max: 200, gutter: 10
  }), 200);
});

// ── isMobileWidth ──────────────────────────────────────────────────────────
test('isMobileWidth: default breakpoint 640 is exclusive', () => {
  assert.equal(E.isMobileWidth(639), true);
  assert.equal(E.isMobileWidth(640), false);
  assert.equal(E.isMobileWidth(641), false);
});

test('isMobileWidth: a custom breakpoint is honoured', () => {
  assert.equal(E.isMobileWidth(799, 800), true);
  assert.equal(E.isMobileWidth(800, 800), false);
});

// mobileWingWidth: mobile wings are full-block-width.
test('mobileWingWidth: derives full block width from viewport minus 2× page padding', () => {
  // 390px phone: 390 − 2×18 = 354 (the .rb-wrap content width).
  assert.equal(E.mobileWingWidth({ viewportWidth: 390 }), 354);
  assert.equal(E.mobileWingWidth({ viewportWidth: 390, pagePadding: 18 }), 354);
  // A different page padding is honoured.
  assert.equal(E.mobileWingWidth({ viewportWidth: 360, pagePadding: 12 }), 336);
});

test('mobileWingWidth: a measured block width wins over the viewport calc', () => {
  // When the controller can measure the block it passes blockWidth verbatim.
  assert.equal(E.mobileWingWidth({ blockWidth: 354, viewportWidth: 999 }), 354);
  assert.equal(E.mobileWingWidth({ blockWidth: 0 }), 0);
  // Floored at 0, never negative.
  assert.equal(E.mobileWingWidth({ viewportWidth: 20, pagePadding: 18 }), 0);
});

test('mobileWingWidth: the mobile wing is wider than the desktop clamp ceiling', () => {
  // This is the whole point of the r28 fix: at 390px the full-block wing (354)
  // exceeds the desktop clamp's hard ceiling (WING_MAX 340), so text flows across
  // the block instead of one cramped word per line inside a single card column.
  const mobile = E.mobileWingWidth({ viewportWidth: 390 });
  // The desktop clamp never returns more than WING_MAX, however much room exists.
  const desktopCeiling = E.clampWingWidth({ side: 'right', viewportWidth: 4000, cardRight: 500 });
  assert.equal(desktopCeiling, 340);
  assert.ok(mobile > desktopCeiling, 'mobile full-block width must exceed the desktop ceiling');
});

// ── motionAllowed ──────────────────────────────────────────────────────────
test('motionAllowed is the negation of prefers-reduced-motion', () => {
  assert.equal(E.motionAllowed(false), true);
  assert.equal(E.motionAllowed(true), false);
});

// ── termCategoryColor (the glossary hover-card chip accent) ─────────────────
test('termCategoryColor maps each glossary category to its accent token', () => {
  assert.equal(E.termCategoryColor('condition'), 'var(--rb-cond)');
  assert.equal(E.termCategoryColor('movement'), 'var(--rb-move)');
  assert.equal(E.termCategoryColor('combat'), 'var(--rb-combat)');
  assert.equal(E.termCategoryColor('COMBAT'), 'var(--rb-combat)');   // case-insensitive
});

test('termCategoryColor falls back to muted for an unknown/empty category', () => {
  assert.equal(E.termCategoryColor('nonsense'), 'var(--rb-mut)');
  assert.equal(E.termCategoryColor(''), 'var(--rb-mut)');
  assert.equal(E.termCategoryColor(null), 'var(--rb-mut)');
});

// ── clampCardPosition (the hover card's placement rule) ─────────────────────
test('clampCardPosition: centres the card under a roomy term', () => {
  // term centre 500, card 270 wide -> left 365; sits 8px below the term bottom.
  const pos = E.clampCardPosition({
    rect: { left: 450, right: 550, top: 200, bottom: 216, width: 100 },
    viewportWidth: 1000, viewportHeight: 800, cardWidth: 270, cardHeight: 140
  });
  assert.equal(pos.x, 365);
  assert.equal(pos.y, 224);
});

test('clampCardPosition: keeps the card inside the viewport at the right edge', () => {
  const pos = E.clampCardPosition({
    rect: { left: 960, right: 1000, top: 100, bottom: 116, width: 40 },
    viewportWidth: 1000, viewportHeight: 800, cardWidth: 270, cardHeight: 140, margin: 10
  });
  assert.equal(pos.x, 1000 - 270 - 10);   // clamped so it never overflows right
});

test('clampCardPosition: flips ABOVE the term when it would overflow the bottom', () => {
  // term near the bottom: below would be 790+8+140 > 800, so flip above.
  const pos = E.clampCardPosition({
    rect: { left: 100, right: 180, top: 782, bottom: 790, width: 80 },
    viewportWidth: 1000, viewportHeight: 800, cardWidth: 270, cardHeight: 140
  });
  assert.equal(pos.y, 782 - 8 - 140);
});

// ── tileMatches ────────────────────────────────────────────────────────────
test('tileMatches: an empty query matches everything', () => {
  assert.equal(E.tileMatches({ name: 'Goblin', tags: 'humanoid' }, ''), true);
  assert.equal(E.tileMatches({ name: 'Goblin', tags: 'humanoid' }, undefined), true);
});

test('tileMatches: matches on the name, case-insensitively', () => {
  assert.equal(E.tileMatches({ name: 'Ancient Dragon', tags: '' }, 'dragon'), true);
  assert.equal(E.tileMatches({ name: 'Ancient Dragon', tags: '' }, 'DRAGON'), true);
});

test('tileMatches: matches on a string tag', () => {
  assert.equal(E.tileMatches({ name: 'Goblin', tags: 'humanoid small' }, 'small'), true);
});

test('tileMatches: matches on an array of tags', () => {
  assert.equal(E.tileMatches({ name: 'Goblin', tags: ['humanoid', 'small'] }, 'small'), true);
});

test('tileMatches: no name or tag hit returns false', () => {
  assert.equal(E.tileMatches({ name: 'Goblin', tags: ['humanoid'] }, 'undead'), false);
});

// ── blockMatches ───────────────────────────────────────────────────────────
test('blockMatches: an empty query matches; a hit is case-insensitive; a miss is false', () => {
  assert.equal(E.blockMatches('The wizard casts a spell', ''), true);
  assert.equal(E.blockMatches('The wizard casts a spell', 'WIZARD'), true);
  assert.equal(E.blockMatches('The wizard casts a spell', 'necromancer'), false);
});

// ── the sheet's board: layout per width, and the token's travel ─────────────
test('sheetMode: one column everywhere; only a phone-width screen changes how it is framed', () => {
  assert.equal(E.sheetMode(1440), 'wide');
  assert.equal(E.sheetMode(900), 'wide');
  assert.equal(E.sheetMode(390), 'phone');
  assert.equal(E.sheetMode(E.SHEET.PHONE_MAX), 'phone');
  assert.equal(E.sheetMode(E.SHEET.PHONE_MAX + 1), 'wide');
});

test('sheetLayout (wide): the board is one centred column, no wider than the content width', () => {
  const S = E.SHEET;
  const L = E.sheetLayout({ viewportWidth: 1440, viewportHeight: 900 });
  assert.deepEqual(Object.keys(L).sort(), ['board', 'mode'], 'a board and nothing beside it');
  assert.equal(L.mode, 'wide');
  assert.equal(L.board.width, S.CONTENT_W);
  assert.equal(L.board.left + L.board.width / 2, 720, 'centred horizontally');
  assert.ok(L.board.height <= S.MAX_H && L.board.height <= 900 * S.H_FRAC);
  assert.ok(L.board.top >= S.MARGIN && L.board.top + L.board.height <= 900 - S.MARGIN);
  const mid = E.sheetLayout({ viewportWidth: 700, viewportHeight: 900 });
  assert.equal(mid.board.width, 700 - 2 * S.MARGIN, 'a narrower screen narrows the column inside its margins');
  assert.equal(mid.board.left, S.MARGIN);
});

test('sheetLayout (phone): the board fills the screen inside an inset', () => {
  const ph = E.sheetLayout({ viewportWidth: 390, viewportHeight: 844 });
  assert.equal(ph.mode, 'phone');
  assert.deepEqual(ph.board, { left: 8, top: 8, width: 374, height: 828 });
});

test('sheetTravel: the token lands exactly on its twin (top-left origin)', () => {
  const from = { left: 900, top: 500, width: 350, height: 180 };
  const to = { left: 400, top: 120, width: 700, height: 360 };
  const t = E.sheetTravel(from, to, { left: 340, top: 100, width: 760, height: 640 });
  assert.equal(t.k, 2);
  assert.equal(from.left + t.dx, to.left);
  assert.equal(from.top + t.dy, to.top);
  assert.equal(from.height * t.k, to.height, 'the same shape, so one scale fits both sides');
  assert.equal(t.fade, false);
  assert.equal(t.transform, 'translate(-500px,-380px) scale(2)');
});

test('sheetTravel: with no twin on the board the token heads for its middle and fades', () => {
  const from = { left: 0, top: 0, width: 200, height: 100 };
  const board = { left: 100, top: 50, width: 600, height: 400 };
  for (const to of [null, { left: 0, top: 0, width: 0, height: 0 }]) {
    const t = E.sheetTravel(from, to, board);
    assert.equal(t.k, 1);
    assert.equal(t.fade, true);
    assert.equal(from.left + from.width / 2 + t.dx, board.left + board.width / 2);
    assert.equal(from.top + from.height / 2 + t.dy, board.top + board.height / 2);
  }
});

test('the folded-map geometry is gone', () => {
  assert.equal(E.sheetFoldGeometry, undefined);
  assert.equal(E.SHEET.RADIUS, undefined);
});
