/**
 * Draw Steel Rulebook Fold Engine — the reusable fold interaction module.
 *
 * Design contract: cordinator mockups/rulebook-v10-table.html. A reusable,
 * content-agnostic module: it knows nothing about characteristics,
 * conditions, or the Power Roll — only three physical fold moves:
 *
 *   1. WING   — a panel hinged to a card's edge, folds out OVER its
 *               neighbours (rotateY). Caller declares left/right side.
 *   2. FLAP   — a list row unfolds a panel DOWN over rows beneath (rotateX).
 *   3. READER — a block unfolds into a centred reading sheet (FLIP takeover
 *               with a veil behind).
 *
 * Only ONE fold is open at a time; opening any closes the others. Esc (and
 * the veil / outside taps) fold back with priority flap -> wing -> reader.
 * Below the mobile breakpoint, wings open DOWNWARD full-width (flap-style).
 *
 * SPLIT ON PURPOSE: a PURE state machine (createState / reduce / etc.) with
 * no DOM access, unit-tested headless (tools/test-rulebook-fold-engine.mjs);
 * and a DOM controller `mount(root, options)` that wires events onto DOM the
 * CALLER builds via the data-attribute contract below, driving it through
 * the pure reducer.
 *
 * DOM CONTRACT (all queried within `root`; every hook optional):
 *   [data-rb-wing]            hosts a wing; child `.rb-wing` is the panel.
 *                             data-rb-side="left|right" (default right),
 *                             data-rb-dim="<selector>", data-rb-wing-max="<px>".
 *                             data-rb-wing-mode="sheet" (the Lich's Lair):
 *                             the panel is a board laid out at final size,
 *                             centred; the card becomes a folded map, travels
 *                             there and opens panel by panel (transform,
 *                             clip-path and opacity only, so nothing reflows).
 *                             Inside a sheet host:
 *     [data-rb-sheet-side="left|right"]  side panels: beside the board on a
 *                             wide screen, in [data-rb-sheet-below] (inside
 *                             the board) on a narrower one, bottom sheets
 *                             behind [data-rb-sheet-tabs] on a phone (tab
 *                             label: data-rb-sheet-tab). Which ones the view
 *                             wants: mount().setSheetCompanions({left,right}).
 *     [data-rb-sheet-home]    the board's way back to its first view; the
 *                             phone tab bar's first tab presses it.
 *     [data-rb-sheet-surface|cover|shade|crease|foldshade|handle|body]
 *                             the board's clipped surface, the map's outside,
 *                             its fold shading, a side panel's crease shade,
 *                             a bottom sheet's close handle, and the board's
 *                             scrolling body.
 *   [data-rb-flap]            hosts a flap; child `.rb-flap` is the panel,
 *                             trigger is `.rb-flap-trigger` (else the row).
 *                             Rows sharing [data-rb-flap-group] dim siblings.
 *   [data-rb-reader]          trigger block that unfolds into the reader.
 *   [data-rb-reader-sheet]    the reader sheet element (position:fixed).
 *   [data-rb-veil]            marker only — engine never queries it; to
 *                             dismiss the reader the caller must also put
 *                             data-rb-close-reader on it.
 *   [data-rb-close-wing|flap|reader]   dismiss buttons.
 *   [data-rb-search]          search <input> (face-down fold + block dim).
 *   [data-rb-tile]            searchable card; data-rb-tags="space joined".
 *   [data-rb-block]           searchable block (dims on no match).
 *   [data-rb-goto-reader/card="id"/flap="id"]   cross-hops between folds.
 *   [data-rb-term]            a glossary term (name/category/body supplied by
 *                             the `terms` mount option); mount() wires every
 *                             one present at mount time. mount() also returns
 *                             `bindTerms(list)` so content rendered LATER
 *                             (e.g. a lazily-played example script) can wire
 *                             its own [data-rb-term] nodes to the SAME shared
 *                             hover card without a second implementation.
 *
 * Loading: attaches the `RulebookFoldEngine` global via the manifest
 * `text_renderers` section, loaded BEFORE widget scripts (same seam as
 * MonsterEngine); exports the same object in Node for headless testing.
 */
var RulebookFoldEngine = (function () {
  'use strict';

  // Fold kinds. Shared vocabulary between the reducer and the controller.
  var FOLD = { WING: 'wing', FLAP: 'flap', READER: 'reader' };

  var MOBILE_BREAKPOINT = 640; // px; below this, wings open downward full-width
  var WING_MIN = 270, WING_MAX = 340, WING_GUTTER = 16; // clamp defaults (mockup)
  var PAGE_PADDING = 18; // .rb-wrap horizontal padding; a mobile down-wing spans
                         // the whole block (viewport − 2×page-padding), never the card

  // ── PURE STATE MACHINE (headless-testable; no DOM) ──────────────────────

  // createState returns a fresh fold state. At most one of wing/flap is a
  // truthy id and reader is a boolean; the reducer keeps that invariant.
  function createState() {
    return { wing: null, flap: null, reader: false };
  }

  // reduce is the single source of truth for fold coordination. Given the
  // current state and an action, it returns the NEXT state plus an `effects`
  // list (a set of DOM ops the controller should run, e.g. 'close-flap',
  // 'open-wing'). Actions: OPEN_WING / CLOSE_WING / OPEN_FLAP / CLOSE_FLAP /
  // OPEN_READER / CLOSE_READER / ESCAPE. `id` carries the wing/flap element id.
  // ESCAPE additionally sets `target` to the fold it dismissed (or null).
  function reduce(state, action) {
    var s = state || createState();
    var type = action && action.type;
    var id = action && action.id;
    var effects = [];
    var next;

    if (type === 'OPEN_WING') {
      if (s.flap) effects.push('close-flap');
      if (s.reader) effects.push('close-reader');
      if (s.wing && s.wing !== id) effects.push('close-wing');
      effects.push('open-wing');
      next = { wing: id, flap: null, reader: false };
      return { state: next, effects: effects };
    }
    if (type === 'CLOSE_WING') {
      if (s.wing) effects.push('close-wing');
      next = { wing: null, flap: s.flap, reader: s.reader };
      return { state: next, effects: effects };
    }
    if (type === 'OPEN_FLAP') {
      if (s.wing) effects.push('close-wing');
      if (s.reader) effects.push('close-reader');
      if (s.flap && s.flap !== id) effects.push('close-flap');
      effects.push('open-flap');
      next = { wing: null, flap: id, reader: false };
      return { state: next, effects: effects };
    }
    if (type === 'CLOSE_FLAP') {
      if (s.flap) effects.push('close-flap');
      next = { wing: s.wing, flap: null, reader: s.reader };
      return { state: next, effects: effects };
    }
    if (type === 'OPEN_READER') {
      if (s.wing) effects.push('close-wing');
      if (s.flap) effects.push('close-flap');
      effects.push('open-reader');
      next = { wing: null, flap: null, reader: true };
      return { state: next, effects: effects };
    }
    if (type === 'CLOSE_READER') {
      if (s.reader) effects.push('close-reader');
      next = { wing: s.wing, flap: s.flap, reader: false };
      return { state: next, effects: effects };
    }
    if (type === 'ESCAPE') {
      var target = escapePriority(s);
      if (target === FOLD.FLAP) { var rf = reduce(s, { type: 'CLOSE_FLAP' }); rf.target = target; return rf; }
      if (target === FOLD.WING) { var rw = reduce(s, { type: 'CLOSE_WING' }); rw.target = target; return rw; }
      if (target === FOLD.READER) { var rr = reduce(s, { type: 'CLOSE_READER' }); rr.target = target; return rr; }
      return { state: s, effects: [], target: null };
    }
    // Unknown action: no-op, state unchanged.
    return { state: s, effects: [] };
  }

  // escapePriority answers "what does Esc dismiss right now?" — flap first,
  // then wing, then reader (the mockup's Esc order). Returns null if nothing
  // is open.
  function escapePriority(state) {
    var s = state || createState();
    if (s.flap) return FOLD.FLAP;
    if (s.wing) return FOLD.WING;
    if (s.reader) return FOLD.READER;
    return null;
  }

  // wingSide decides which edge a card's wing hinges from. The Lair always
  // wings left (over the Conditions block); otherwise the rightmost column
  // wings left so the panel opens inward, and every other column wings right.
  function wingSide(opts) {
    var o = opts || {};
    if (o.isLair) return 'left';
    var columns = o.columns || 1;
    var column = o.column || 0;
    if (columns >= 2 && column === columns - 1) return 'left';
    return 'right';
  }

  // clampWingWidth sizes a wing so it never leaves the viewport. A right-hinged
  // wing may use the space to the card's right; a left-hinged wing the space to
  // its left. Result is clamped to [min, max].
  function clampWingWidth(opts) {
    var o = opts || {};
    var side = o.side === 'left' ? 'left' : 'right';
    var vw = o.viewportWidth || 0;
    var min = o.min != null ? o.min : WING_MIN;
    var max = o.max != null ? o.max : WING_MAX;
    var gutter = o.gutter != null ? o.gutter : WING_GUTTER;
    var avail = side === 'left'
      ? (o.cardLeft || 0) - gutter               // space to the card's left
      : vw - (o.cardRight || 0) - gutter;         // space to the card's right
    return _clamp(avail, min, max);
  }

  // isMobileWidth is the single breakpoint predicate — below it, wings fold
  // downward full-width instead of sideways.
  function isMobileWidth(width, breakpoint) {
    var bp = breakpoint != null ? breakpoint : MOBILE_BREAKPOINT;
    return Number(width) < bp;
  }

  // mobileWingWidth sizes a downward mobile wing to the FULL width of its block:
  // under the breakpoint the wing must span the block, not the cramped
  // card-column it hinges from. When the caller can measure the
  // block it passes `blockWidth` (the block is full-bleed on mobile, so this IS
  // "viewport minus the page's horizontal padding"); otherwise the rule is
  // derived from the viewport (`viewportWidth − 2×pagePadding`). Never clamped to
  // the desktop [min,max] — a mobile wing is deliberately wider than the desktop
  // card wing. Result floored at 0.
  function mobileWingWidth(opts) {
    var o = opts || {};
    if (o.blockWidth != null) return Math.max(0, Number(o.blockWidth) || 0);
    var vw = Number(o.viewportWidth) || 0;
    var pad = o.pagePadding != null ? Number(o.pagePadding) : PAGE_PADDING;
    return Math.max(0, vw - 2 * pad);
  }

  // motionAllowed centralises the reduced-motion gate for JS-driven timing
  // (the CSS handles declarative transitions via a media query).
  function motionAllowed(prefersReducedMotion) {
    return !prefersReducedMotion;
  }

  // ── sheet layout (the board a sheet-mode wing opens into) ───────────────
  // The board's own sizing budget: a 640px column, two 256px side panels
  // hinged on its edges with a 16px gap, and a 16px margin to the viewport.
  var SHEET = {
    CONTENT_W: 640, SIDE_W: 256, GAP: 16, MARGIN: 16,
    MAX_H: 700, H_FRAC: 0.86, PHONE_MAX: 880, PHONE_INSET: 8, RADIUS: 18
  };

  // sheetMode decides where a sheet's side panels go at a viewport width:
  // 'side' beside the board when both fit, 'below' inside the board under
  // its content when they don't, 'phone' as bottom sheets behind a tab bar
  // at the same width the front page's grid collapses to one column.
  function sheetMode(viewportWidth) {
    var vw = Number(viewportWidth) || 0;
    if (vw <= SHEET.PHONE_MAX) return 'phone';
    var need = 2 * SHEET.SIDE_W + 2 * SHEET.GAP + SHEET.CONTENT_W + 2 * SHEET.MARGIN;
    return vw >= need ? 'side' : 'below';
  }

  // sheetLayout is where the board and its side panels rest, centred in the
  // visible viewport. Side rects are null unless the mode puts them beside
  // the board; a side panel is as tall as its content, capped at the board.
  function sheetLayout(opts) {
    var o = opts || {};
    var vw = Math.max(0, Number(o.viewportWidth) || 0);
    var vh = Math.max(0, Number(o.viewportHeight) || 0);
    var mode = sheetMode(vw);
    var board;
    if (mode === 'phone') {
      var inset = SHEET.PHONE_INSET;
      board = { left: inset, top: inset, width: Math.max(0, vw - 2 * inset), height: Math.max(0, vh - 2 * inset) };
    } else {
      var w = Math.max(0, Math.min(SHEET.CONTENT_W, vw - 2 * SHEET.MARGIN));
      var h = Math.max(0, Math.min(vh * SHEET.H_FRAC, SHEET.MAX_H));
      board = { left: (vw - w) / 2, top: Math.max(SHEET.MARGIN, (vh - h) / 2), width: w, height: h };
    }
    var out = { mode: mode, board: board, left: null, right: null };
    if (mode === 'side') {
      out.left = { left: board.left - SHEET.GAP - SHEET.SIDE_W, top: board.top, width: SHEET.SIDE_W, maxHeight: board.height };
      out.right = { left: board.left + board.width + SHEET.GAP, top: board.top, width: SHEET.SIDE_W, maxHeight: board.height };
    }
    return out;
  }

  // sheetFoldGeometry describes the board as a folded map lying on its card:
  // the card-sized middle window of the board (clipped), the offset that puts
  // that window over the card, and the clip-paths of each unfolding stage —
  // middle panel, then the side panels, then top and bottom. Pure, so the
  // film's numbers are unit-tested headless.
  function sheetFoldGeometry(card, board, radius) {
    var c = card || {}, b = board || {};
    var bw = b.width || 0, bh = b.height || 0;
    var w0 = Math.min(c.width || 0, bw), h0 = Math.min(c.height || 0, bh);
    var ix = (bw - w0) / 2, iy = (bh - h0) / 2;
    var r = radius != null ? radius : SHEET.RADIUS;
    function inset(t, rt) { return 'inset(' + t + 'px ' + rt + 'px ' + t + 'px ' + rt + 'px round ' + r + 'px)'; }
    return {
      dx: ((c.left || 0) + (c.width || 0) / 2) - ((b.left || 0) + bw / 2),
      dy: ((c.top || 0) + (c.height || 0) / 2) - ((b.top || 0) + bh / 2),
      w: bw, h: bh, w0: w0, h0: h0, ix: ix, iy: iy,
      // the shadow band that rides each opening edge
      band: Math.max(24, Math.min(90, ix, iy)),
      clipWin: inset(iy, ix), clipAcross: inset(iy, 0), clipFull: inset(0, 0)
    };
  }

  // ── glossary hover-card logic (content-agnostic; data supplied at mount) ────

  // TERM_CAT_COLORS maps a glossary category to its accent token — the hover
  // card's category-chip colour. Unknown categories fall back to muted.
  var TERM_CAT_COLORS = {
    condition: 'var(--rb-cond)', movement: 'var(--rb-move)', combat: 'var(--rb-combat)',
    duration: 'var(--rb-pur)', resource: 'var(--rb-grn)', action: 'var(--rb-combat)',
    keyword: 'var(--rb-mut)'
  };
  function termCategoryColor(cat) {
    return TERM_CAT_COLORS[String(cat == null ? '' : cat).toLowerCase()] || 'var(--rb-mut)';
  }

  // clampCardPosition places a hover card near its term: horizontally centred on
  // the term but kept `margin` inside the viewport, and just BELOW it — unless it
  // would overflow the bottom, where it flips ABOVE instead (the mockup's rule).
  // Pure geometry so the placement is unit-tested headless.
  function clampCardPosition(opts) {
    var o = opts || {};
    var r = o.rect || {};
    var w = o.cardWidth != null ? o.cardWidth : 270;
    var h = o.cardHeight != null ? o.cardHeight : 140;
    var m = o.margin != null ? o.margin : 10;
    var vw = o.viewportWidth || 0, vh = o.viewportHeight || 0;
    var centred = (r.left || 0) + (r.width || 0) / 2 - w / 2;
    var x = Math.min(Math.max(m, centred), vw - w - m);
    var y = (r.bottom || 0) + 8;
    if (y + h > vh) y = (r.top || 0) - 8 - h;   // flip above when it would overflow
    return { x: x, y: y };
  }

  // tileMatches / blockMatches back the client-side search: a tile matches on
  // its name or its tag string; a block matches on any of its text.
  function tileMatches(tile, query) {
    var q = _norm(query);
    if (!q) return true;
    var t = tile || {};
    return _norm(t.name).indexOf(q) >= 0 || _norm(t.tags).indexOf(q) >= 0;
  }
  function blockMatches(text, query) {
    var q = _norm(query);
    if (!q) return true;
    return _norm(text).indexOf(q) >= 0;
  }

  // _norm lowercases/trims a possibly-undefined string (or joins an array).
  function _norm(v) {
    if (v == null) return '';
    if (Object.prototype.toString.call(v) === '[object Array]') v = v.join(' ');
    return String(v).toLowerCase().trim();
  }

  function _clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  // ── DOM CONTROLLER (browser only; never called at module-eval time) ──────

  // mount wires the fold interactions onto `root` and returns { destroy }.
  // Everything DOM-touching lives inside here so the module body stays
  // DOM-free and `require()`-able in Node.
  function mount(root, options) {
    if (!root) return { destroy: function () {} };
    var opts = options || {};
    var win = (typeof window !== 'undefined') ? window : { innerWidth: 1024, innerHeight: 768 };
    var breakpoint = opts.breakpoint != null ? opts.breakpoint : MOBILE_BREAKPOINT;
    var onOpen = typeof opts.onOpen === 'function' ? opts.onOpen : function () {};
    var onClose = typeof opts.onClose === 'function' ? opts.onClose : function () {};

    var state = createState();
    var listeners = [];              // tracked for a clean destroy()
    var _openWingEl = null, _openFlapEl = null, _reading = false;
    var _readerReturnFocus = null;   // element focus returns to when the reader closes
    var _hopTimer = null;            // cross-hop deferral (cancelled on destroy)
    var _destroyed = false;          // guards deferred callbacks after teardown

    var readerTrigger = root.querySelector('[data-rb-reader]');
    var readerSheet = root.querySelector('[data-rb-reader-sheet]');

    // Glossary hover cards: `terms` is a content-agnostic map slug -> {name,
    // category, body}; the caller supplies it and renders the [data-rb-hcard]
    // shell. The engine owns the card's content, placement, and dismissal so it
    // shares the single Esc pipeline + one outside-click handler with the folds.
    var terms = opts.terms || {};
    var hcardEl = root.querySelector('[data-rb-hcard]');
    var _hcardOpen = false;
    var _hcardRestTimer = null;   // "grows out of the word after the pointer RESTS" (mockup)
    var HCARD_REST_MS = 350;

    function prefersReduced() {
      return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function on(target, type, fn, o) {
      if (!target) return;
      target.addEventListener(type, fn, o);
      listeners.push({ t: target, type: type, fn: fn, o: o });
    }
    // byId scopes an id lookup to this widget's root (ids are widget-authored).
    function byId(id) {
      if (!id) return null;
      return root.querySelector('[id="' + String(id).replace(/["\\]/g, '') + '"]');
    }

    // ── wing DOM ops ─────────────────────────────────────────────────────
    // A wing host carrying data-rb-wing-mode="sheet" (the Lich's Lair) does not
    // hinge over its neighbours — it opens into a fixed, centred board laid out
    // at FINAL size (see the sheet's film below), so nothing inside it reflows.
    function _isSheet(host) { return !!(host && host.getAttribute('data-rb-wing-mode') === 'sheet'); }
    // _sheetFinalRect is the reading sheet's resting box.
    function _sheetFinalRect() {
      var w = Math.min(940, win.innerWidth - 36);
      var h = Math.min(win.innerHeight * 0.86, 700);
      return { left: Math.max(18, (win.innerWidth - w) / 2), top: Math.max(14, (win.innerHeight - h) / 2), width: w, height: h };
    }
    // _flipTransform returns the transform that makes an element laid out at
    // `actual` look like it sits at `look` instead (classic FLIP invert).
    function _flipTransform(look, actual) {
      var sx = actual.width ? look.width / actual.width : 1;
      var sy = actual.height ? look.height / actual.height : 1;
      var dx = (look.left + look.width / 2) - (actual.left + actual.width / 2);
      var dy = (look.top + look.height / 2) - (actual.top + actual.height / 2);
      return 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
    }
    // ── the sheet's film: the card is a folded map ──────────────────────
    // The board is laid out at its final place and size before anything
    // moves. The card turns into the folded map where it lies (the board,
    // clipped to a card-sized window under one continuous map texture), the
    // map travels to the middle of the screen, then opens panel by panel —
    // the side panels, then top and bottom — each lifting edge in shadow.
    // Only transform, clip-path and opacity animate, so nothing inside the
    // board reflows. A close is the same film backwards, and an interrupted
    // film turns round from wherever it is.
    var SHEET_MS = { xfade: 200, travel: 480, panel: 420, land: 380, wing: 460, fade: 180 };
    var EASE_UNFOLD = 'cubic-bezier(.45,.05,.25,1)', EASE_INOUT = 'cubic-bezier(.55,.05,.3,1)';
    var LIFT = ' translateY(-4px) scale(1.02)';

    // The visible viewport, without a classic scrollbar (which innerWidth includes).
    function _viewW() { var d = root.ownerDocument, e = d && (d.scrollingElement || d.documentElement); return (e && e.clientWidth) || win.innerWidth; }
    function _viewH() { var d = root.ownerDocument, e = d && (d.scrollingElement || d.documentElement); return (e && e.clientHeight) || win.innerHeight; }
    function _place(el, r) {
      el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
      el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
    }
    // _mk starts an animation already heading `dir` (a backwards one starts
    // from its end). No element or no Web Animations → null, which every
    // caller treats as "already finished", so the board still opens.
    function _mk(el, kf, o, dir) {
      if (!el || typeof el.animate !== 'function') return null;
      var opts = { fill: 'both' };
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) opts[k] = o[k];
      var a = el.animate(kf, opts);
      if (dir < 0) a.reverse();
      return a;
    }
    function _cancel(list) { each(list || [], function (a) { if (a) { a.onfinish = null; a.cancel(); } }); }
    function _whenDone(list, fn) {
      var live = [];
      each(list || [], function (a) { if (a) live.push(a); });
      var left = live.length;
      if (!left) { fn(); return; }
      each(live, function (a) { a.onfinish = function () { if (--left === 0) fn(); }; });
    }
    function _isRunning(a) { return !!a && (a.playState === 'running' || a.playState === 'pending'); }

    // _film runs `steps` in order; each step's make(dir) returns its
    // animations. play(-1) on a running film reverses the step in hand and
    // walks back through the earlier ones; a step passed backwards lets its
    // animations go so the earlier steps' held frames show again.
    function _film(steps, hooks) {
      var f = { anims: [], i: -1, dir: 0, gen: 0, running: false };
      function cleanup() { each(f.anims, function (l) { _cancel(l); }); f.anims = []; f.i = -1; }
      function end() { f.running = false; cleanup(); (f.dir > 0 ? hooks.opened : hooks.closed)(); }
      function wait() {
        var g = f.gen;
        _whenDone(f.anims[f.i], function () {
          if (f.gen !== g || _destroyed) return;
          var st = steps[f.i], next = f.i + f.dir;
          if (f.dir < 0) { _cancel(f.anims[f.i]); f.anims[f.i] = null; }
          if (st.exit) st.exit(f.dir);
          if (next < 0 || next >= steps.length) { end(); return; }
          f.i = next; run();
        });
      }
      function run() {
        var st = steps[f.i], list = f.anims[f.i];
        if (st.enter) st.enter(f.dir);
        if (list) each(list, function (a) { if (!a) return; if ((a.playbackRate > 0) !== (f.dir > 0)) a.reverse(); else a.play(); });
        else f.anims[f.i] = st.make(f.dir);
        wait();
      }
      f.play = function (dir) {
        if (f.running && f.dir === dir) return;
        f.gen++; f.dir = dir;
        if (f.running) {
          if (hooks.start) hooks.start(dir, false);
          var st = steps[f.i];
          if (st.enter) st.enter(dir);
          each(f.anims[f.i] || [], function (a) { if (a) a.reverse(); });
          wait();
          return;
        }
        if (hooks.start) hooks.start(dir, true);
        f.i = dir > 0 ? 0 : steps.length - 1; f.running = true; run();
      };
      // finish jumps a running film to where it was heading (a resize mid-film).
      f.finish = function () { if (!f.running) return; f.gen++; end(); };
      return f;
    }

    // _sheetFor collects one sheet host's parts once: the board (its .rb-wing),
    // the side panels ([data-rb-sheet-side]) and the phone tab bar.
    function _sheetFor(host) {
      if (host.__rbSheet) return host.__rbSheet;
      var panel = host.querySelector('.rb-wing');
      if (!panel) return null;
      // The surface is what the fold clips; the panel itself carries the
      // travel and the shadow, so the shadow is never clipped away.
      var s = { host: host, panel: panel, surf: panel.querySelector('[data-rb-sheet-surface]') || panel,
        sides: [], tabs: host.querySelector('[data-rb-sheet-tabs]'),
        film: null, geo: null, mode: null, want: null, landed: false, reduced: false, returnFocus: null };
      each(host.querySelectorAll('[data-rb-sheet-side]'), function (el) { s.sides.push(el); });
      host.__rbSheet = s;
      return s;
    }
    function _sideKey(side) { return side.getAttribute('data-rb-sheet-side') === 'left' ? 'left' : 'right'; }
    function _isSheetPart(s, el) {
      if (el === s.panel || el === s.tabs) return true;
      for (var i = 0; i < s.sides.length; i++) if (s.sides[i] === el) return true;
      return false;
    }
    // _faceOf is the card's own face: everything in the host but the board,
    // its side panels and its tab bar. It fades as the map covers it, so the
    // card is never drawn twice.
    function _faceOf(s) {
      var out = [];
      each(s.host.children, function (c) { if (!_isSheetPart(s, c)) out.push(c); });
      return out;
    }

    // _layoutSheet puts the board and its side panels where they rest for the
    // current viewport: beside the board ('side'), inside it under its content
    // ('below'), or as bottom sheets ('phone').
    function _layoutSheet(s) {
      var L = sheetLayout({ viewportWidth: _viewW(), viewportHeight: _viewH() });
      s.mode = L.mode;
      s.host.setAttribute('data-rb-sheet-mode', L.mode);
      _place(s.panel, L.board);
      s.panel.style.right = 'auto';
      var below = s.panel.querySelector('[data-rb-sheet-below]');
      each(s.sides, function (side) {
        var home = (L.mode === 'below' && below) ? below : s.host;
        if (side.parentNode !== home) home.appendChild(side);
        var r = L[_sideKey(side)];
        side.style.left = r ? r.left + 'px' : '';
        side.style.top = r ? r.top + 'px' : '';
        side.style.width = r ? r.width + 'px' : '';
        side.style.maxHeight = r ? r.maxHeight + 'px' : '';
      });
      return L;
    }

    // _sizeFx sizes the paper's shadow bands and creases to this fold.
    function _sizeFx(s) {
      var g = s.geo, p = s.panel;
      function set(sel, r) { var el = p.querySelector(sel); if (!el) return; for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) el.style[k] = r[k] + 'px'; }
      set('[data-rb-sheet-shade="l"]', { width: g.band, height: g.h0 });
      set('[data-rb-sheet-shade="r"]', { width: g.band, height: g.h0 });
      set('[data-rb-sheet-shade="t"]', { width: g.w, height: g.band });
      set('[data-rb-sheet-shade="b"]', { width: g.w, height: g.band });
      set('[data-rb-sheet-crease="v1"]', { left: g.ix - 1, top: 0, height: g.h });
      set('[data-rb-sheet-crease="v2"]', { left: g.w - g.ix - 1, top: 0, height: g.h });
      set('[data-rb-sheet-crease="h1"]', { top: g.iy - 1, left: 0, width: g.w });
      set('[data-rb-sheet-crease="h2"]', { top: g.h - g.iy - 1, left: 0, width: g.w });
    }

    function _sheetSteps(s) {
      var host = s.host, panel = s.panel, surf = s.surf;
      function q(sel) { return panel.querySelector(sel); }
      function T(extra) { return 'translate(' + s.geo.dx + 'px,' + s.geo.dy + 'px)' + (extra || ''); }
      function show(sel, o, dir) { return _mk(q(sel), [{ opacity: 1 }, { opacity: 1 }], o, dir); }
      if (s.reduced) {
        // Reduced motion: the board crossfades in place and the card stays put.
        return [{ name: 'fade',
          enter: function (dir) { _toggle(root, 'rb-lair-open', dir > 0); },
          make: function (dir) { return [_mk(panel, [{ opacity: 0 }, { opacity: 1 }], { duration: SHEET_MS.fade, easing: 'linear' }, dir)]; } }];
      }
      return [
        { name: 'fold',                              // the card becomes the folded map where it lies
          enter: function (dir) { if (dir < 0) host.classList.remove('rb-sheet-away'); },
          exit: function (dir) { if (dir > 0) host.classList.add('rb-sheet-away'); },
          make: function (dir) {
            var g = s.geo, o = { duration: SHEET_MS.xfade, easing: 'linear' };
            var list = [
              _mk(panel, [{ opacity: 0, transform: T() }, { opacity: 1, transform: T() }], o, dir),
              _mk(surf, [{ clipPath: g.clipWin }, { clipPath: g.clipWin }], o, dir),
              show('[data-rb-sheet-cover]', o, dir)];
            each(_faceOf(s), function (el) { list.push(_mk(el, [{ opacity: 1 }, { opacity: 0 }], o, dir)); });
            return list;
          } },
        { name: 'travel',                            // it lifts off the page and travels to the middle
          enter: function (dir) { _toggle(root, 'rb-lair-open', dir > 0); },
          make: function (dir) {
            var g = s.geo, o = { duration: SHEET_MS.travel, easing: EASE_INOUT };
            return [
              _mk(panel, [{ transform: T() }, { transform: T(LIFT), offset: 0.2 }, { transform: 'none' }], o, dir),
              _mk(surf, [{ clipPath: g.clipWin }, { clipPath: g.clipWin }], o, dir),
              show('[data-rb-sheet-cover]', o, dir)];
          } },
        { name: 'across',                            // the side panels open out of the middle one
          make: function (dir) {
            var g = s.geo, o = { duration: SHEET_MS.panel, easing: EASE_INOUT }, B = g.band;
            function band(x0, x1) {
              return [{ transform: 'translate(' + x0 + 'px,' + g.iy + 'px)', opacity: 1 }, { opacity: 1, offset: 0.55 },
                { transform: 'translate(' + x1 + 'px,' + g.iy + 'px)', opacity: 0 }];
            }
            return [
              _mk(surf, [{ clipPath: g.clipWin }, { clipPath: g.clipAcross }], o, dir),
              _mk(q('[data-rb-sheet-cover]'), [{ opacity: 1 }, { opacity: 0 }], o, dir),
              _mk(q('[data-rb-sheet-shade="l"]'), band(g.ix, 0), o, dir),
              _mk(q('[data-rb-sheet-shade="r"]'), band(g.w - g.ix - B, g.w - B), o, dir),
              _mk(q('[data-rb-sheet-crease="v1"]'), [{ opacity: 0 }, { opacity: 1 }], o, dir),
              _mk(q('[data-rb-sheet-crease="v2"]'), [{ opacity: 0 }, { opacity: 1 }], o, dir)];
          } },
        { name: 'down',                              // then the top and bottom panels
          make: function (dir) {
            var g = s.geo, o = { duration: SHEET_MS.panel, easing: EASE_INOUT }, B = g.band;
            function band(y0, y1) {
              return [{ transform: 'translate(0px,' + y0 + 'px)', opacity: 1 }, { opacity: 1, offset: 0.55 },
                { transform: 'translate(0px,' + y1 + 'px)', opacity: 0 }];
            }
            return [
              _mk(surf, [{ clipPath: g.clipAcross }, { clipPath: g.clipFull }], o, dir),
              _mk(q('[data-rb-sheet-shade="t"]'), band(g.iy, 0), o, dir),
              _mk(q('[data-rb-sheet-shade="b"]'), band(g.h - g.iy - B, g.h - B), o, dir),
              show('[data-rb-sheet-crease="v1"]', o, dir), show('[data-rb-sheet-crease="v2"]', o, dir),
              _mk(q('[data-rb-sheet-crease="h1"]'), [{ opacity: 0 }, { opacity: 1 }], o, dir),
              _mk(q('[data-rb-sheet-crease="h2"]'), [{ opacity: 0 }, { opacity: 1 }], o, dir)];
          } },
        { name: 'land',                              // flat: the creases fade
          make: function (dir) {
            var o = { duration: SHEET_MS.land, easing: 'ease-out' }, out = [];
            each(['v1', 'v2', 'h1', 'h2'], function (k) { out.push(_mk(q('[data-rb-sheet-crease="' + k + '"]'), [{ opacity: 1 }, { opacity: 0 }], o, dir)); });
            return out;
          } }
      ];
    }

    function _sheetHooks(s) {
      return {
        start: function (dir, fresh) {
          s.panel.style.pointerEvents = dir > 0 ? '' : 'none';
          if (fresh && !s.reduced) {
            var c = s.host.getBoundingClientRect();
            var b = { left: parseFloat(s.panel.style.left) || 0, top: parseFloat(s.panel.style.top) || 0,
              width: s.panel.offsetWidth, height: s.panel.offsetHeight };
            s.geo = sheetFoldGeometry({ left: c.left, top: c.top, width: c.width, height: c.height }, b, SHEET.RADIUS);
            _sizeFx(s);
          }
        },
        opened: function () {
          s.landed = true;
          _syncSides(s);
        },
        closed: function () {
          s.landed = false; s.want = null;
          s.host.classList.remove('is-open', 'rb-sheet-away');
          root.classList.remove('rb-lair-open');
          s.panel.style.pointerEvents = '';
          each(s.sides, function (side) { _cancel(side.__rbAnims); side.__rbAnims = null; side.__rbFolding = false; side.classList.remove('is-shown'); });
          _buildTabs(s);
          // Focus comes home once the card is back, never scrolling the page.
          var back = s.returnFocus; s.returnFocus = null;
          if (back && back.focus) back.focus({ preventScroll: true });
          else if (s.host.focus) s.host.focus({ preventScroll: true });
          onClose(FOLD.WING);
        }
      };
    }

    // _swingSide unfolds a side panel out of the board's edge (or folds it
    // back in): it is laid out beside the board first and turns flat from
    // ~88°, so its text never reflows. Interrupted, it turns round in place.
    function _swingSide(s, side, show) {
      var shown = side.classList.contains('is-shown');
      var running = side.__rbAnims && _isRunning(side.__rbAnims[0]);
      if (running) {
        if (side.__rbFolding !== !show) { side.__rbFolding = !show; each(side.__rbAnims, function (a) { if (a) a.reverse(); }); }
        return;
      }
      if (show === shown) return;
      if (s.reduced || typeof side.animate !== 'function') { _toggle(side, 'is-shown', show); return; }
      var fold = 'perspective(1300px) rotateY(' + (_sideKey(side) === 'left' ? -88 : 88) + 'deg)';
      var o = { duration: SHEET_MS.wing, easing: EASE_UNFOLD };
      side.classList.add('is-shown');
      side.__rbFolding = !show;
      var list = [
        _mk(side, [{ transform: fold }, { transform: 'perspective(1300px) rotateY(0deg)' }], o, show ? 1 : -1),
        _mk(side.querySelector('[data-rb-sheet-foldshade]'), [{ opacity: 1 }, { opacity: 0 }], o, show ? 1 : -1)];
      side.__rbAnims = list;
      _whenDone(list, function () {
        if (side.__rbAnims !== list) return;
        _cancel(list); side.__rbAnims = null;
        if (side.__rbFolding) side.classList.remove('is-shown');
        side.__rbFolding = false;
      });
    }

    // _syncSides shows the side panels the current view wants, the way the
    // current mode shows them. On a phone they wait behind the tab bar.
    function _syncSides(s) {
      each(s.sides, function (side) {
        var want = !!(s.landed && s.want && s.want[_sideKey(side)]);
        if (s.mode === 'side') _swingSide(s, side, want);
        else if (s.mode === 'below') _toggle(side, 'is-shown', want);
        else _toggle(side, 'is-shown', false);
      });
      _buildTabs(s);
    }

    // _buildTabs fills the phone tab bar: the board's home view (when it
    // marks one with [data-rb-sheet-home]) and one tab per wanted side panel.
    function _buildTabs(s) {
      var bar = s.tabs;
      if (!bar) return;
      bar.innerHTML = '';
      var any = s.want && (s.want.left || s.want.right);
      var on = s.landed && s.mode === 'phone' && any;
      _toggle(bar, 'is-shown', !!on);
      _toggle(s.panel, 'rb-sheet-tabbed', !!on);
      if (!on) return;
      var d = root.ownerDocument;
      function add(label, key) {
        var b = d.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('data-rb-sheet-tab-for', key);
        if (key !== 'home') b.setAttribute('aria-pressed', 'false');
        bar.appendChild(b);
      }
      var home = s.panel.querySelector('[data-rb-sheet-home]');
      if (home) add(home.getAttribute('data-rb-sheet-tab') || 'Back', 'home');
      each(s.sides, function (side) {
        if (s.want[_sideKey(side)]) add(side.getAttribute('data-rb-sheet-tab') || _sideKey(side), _sideKey(side));
      });
    }
    // _phoneSide opens one bottom sheet (closing the other), or closes it.
    function _phoneSide(s, key, open) {
      each(s.sides, function (side) { _toggle(side, 'is-shown', !!open && _sideKey(side) === key); });
      if (s.tabs) each(s.tabs.querySelectorAll('[data-rb-sheet-tab-for]'), function (b) {
        var k = b.getAttribute('data-rb-sheet-tab-for');
        if (k !== 'home') b.setAttribute('aria-pressed', (!!open && k === key) ? 'true' : 'false');
      });
    }

    function _openSheet(host) {
      var s = _sheetFor(host);
      if (!s) return;
      if (s.film && s.film.running && s.film.dir < 0) { s.film.play(1); return; }   // it unfolds again from where it is
      _layoutSheet(s);                                  // laid out at rest before anything moves
      var body = s.panel.querySelector('[data-rb-sheet-body]');
      if (body) body.scrollTop = 0;
      s.reduced = prefersReduced() || typeof s.panel.animate !== 'function';
      s.film = _film(_sheetSteps(s), _sheetHooks(s));
      s.film.play(1);
    }
    function _closeSheet(host) {
      var s = _sheetFor(host);
      if (!s) return;
      s.landed = false;
      _buildTabs(s);
      if (s.mode === 'side') each(s.sides, function (side) { _swingSide(s, side, false); });
      else if (s.mode === 'phone') _phoneSide(s, null, false);
      if (s.film && s.film.running) { s.film.play(-1); return; }
      s.reduced = prefersReduced() || typeof s.panel.animate !== 'function';
      s.film = _film(_sheetSteps(s), _sheetHooks(s));
      s.film.play(-1);
    }
    // _resizeSheet re-lays an open sheet for the new viewport; a film still
    // running jumps to where it was heading first.
    function _resizeSheet(host) {
      var s = _sheetFor(host);
      if (!s) return;
      if (s.film && s.film.running) s.film.finish();
      if (_openWingEl !== host) return;
      _layoutSheet(s);
      _syncSides(s);
    }
    // setSheetCompanions tells the open sheet which side panels its current
    // view has ({ left, right }; null for none). They come out once it lands.
    function setSheetCompanions(want) {
      var host = (_openWingEl && _isSheet(_openWingEl)) ? _openWingEl : null;
      if (!host) return;
      var s = _sheetFor(host);
      if (!s) return;
      s.want = want ? { left: !!want.left, right: !!want.right } : null;
      _syncSides(s);
    }
    // _sheetFocusables is what Tab cycles through while a sheet is open: the
    // board, any side panel that is showing, and the tab bar.
    function _sheetFocusables(s) {
      var out = [];
      var sel = 'a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])';
      var roots = [s.panel];
      each(s.sides, function (side) { if (side.classList.contains('is-shown') && !s.panel.contains(side)) roots.push(side); });
      if (s.tabs) roots.push(s.tabs);
      each(roots, function (r) {
        each(r.querySelectorAll(sel), function (el) {
          if (!el.getClientRects().length) return;
          var cs = win.getComputedStyle ? win.getComputedStyle(el) : null;
          if (cs && cs.visibility === 'hidden') return;
          out.push(el);
        });
      });
      return out;
    }
    function _domOpenWing(host) {
      if (!host) return;
      _openWingEl = host;
      host.classList.add('is-open');
      host.setAttribute('aria-expanded', 'true');
      if (_isSheet(host)) {
        _openSheet(host);
        // The sheet is a real dialog (role="dialog" in the caller's markup) —
        // same focus contract as the reader: remember where to send focus
        // back, then move it into the sheet so it isn't left behind on the
        // card, which hides once the map covers it.
        var wing = host.querySelector('.rb-wing');
        var d = root.ownerDocument;
        var sh = _sheetFor(host);
        // Re-opened mid-close: focus still goes home to the original opener.
        if (sh && !sh.returnFocus) sh.returnFocus = (d && d.activeElement && d.activeElement !== d.body) ? d.activeElement : host;
        var firstCtl = wing && wing.querySelector('[data-rb-close-wing], button, [tabindex], a[href]');
        // The sheet is fixed on screen, so focusing into it must never scroll
        // the page (the reader below follows the same rule).
        if (firstCtl && firstCtl.focus) firstCtl.focus({ preventScroll: true });
        else if (wing && wing.focus) {
          if (wing.getAttribute('tabindex') == null) wing.setAttribute('tabindex', '-1');
          wing.focus({ preventScroll: true });
        }
      } else {
        _applyWingGeometry(host);
      }
      var group = _closest(host, '[data-rb-wing-group]');
      if (group) group.classList.add('rb-dimmed');
      var dimSel = host.getAttribute('data-rb-dim');
      if (dimSel) { var dimEl = root.querySelector(dimSel); if (dimEl) dimEl.classList.add('rb-dimmed'); }
      onOpen(FOLD.WING, host.id || '');
    }
    function _domCloseWing() {
      if (!_openWingEl) return;
      var host = _openWingEl; _openWingEl = null;
      var wing = host.querySelector('.rb-wing');
      host.setAttribute('aria-expanded', 'false');
      // only wings set rb-dimmed (search uses rb-nomatch), so clearing is safe
      var dimmed = root.querySelectorAll('.rb-dimmed');
      for (var i = 0; i < dimmed.length; i++) dimmed[i].classList.remove('rb-dimmed');
      // A sheet folds back into its card first: is-open, focus and onClose
      // wait for the film's end (its closed hook), so its content never
      // changes while it is still on screen.
      if (_isSheet(host)) { _closeSheet(host); return; }
      host.classList.remove('is-open');
      // Clear every inline geometry the open path may have set (width always;
      // left/right only on the mobile down path) so the closed panel returns to
      // the stylesheet's defaults and a later desktop open is not mis-placed.
      if (wing) { wing.style.width = ''; wing.style.left = ''; wing.style.right = ''; wing.classList.remove('rb-wing--down'); }
      onClose(FOLD.WING);
    }

    // ── flap DOM ops ─────────────────────────────────────────────────────
    function _flapTrigger(crow) { return crow.querySelector('[data-rb-flap-trigger]') || crow; }
    function _domOpenFlap(crow) {
      if (!crow) return;
      _openFlapEl = crow;
      crow.classList.add('is-open');
      _flapTrigger(crow).setAttribute('aria-expanded', 'true');
      var group = _closest(crow, '[data-rb-flap-group]');
      if (group) group.classList.add('rb-flapopen');
      onOpen(FOLD.FLAP, crow.id || '');
    }
    function _domCloseFlap() {
      if (!_openFlapEl) return;
      var crow = _openFlapEl; _openFlapEl = null;
      crow.classList.remove('is-open');
      _flapTrigger(crow).setAttribute('aria-expanded', 'false');
      var groups = root.querySelectorAll('[data-rb-flap-group].rb-flapopen');
      for (var i = 0; i < groups.length; i++) groups[i].classList.remove('rb-flapopen');
      onClose(FOLD.FLAP);
    }

    // ── reader DOM ops (FLIP takeover) ───────────────────────────────────
    // left/top/width/height are set to their FINAL value up front — text is laid out at final
    // width from frame 1, so it never reflows — and only transform + opacity
    // animate the "grows out of the hero block" motion.
    function _setSheetRect(r) {
      if (!readerSheet || !r) return;
      readerSheet.style.left = r.left + 'px';
      readerSheet.style.top = r.top + 'px';
      readerSheet.style.width = r.width + 'px';
      readerSheet.style.height = r.height + 'px';
    }
    function _domOpenReader() {
      if (!readerSheet || !readerTrigger) return;
      _reading = true;
      readerTrigger.setAttribute('aria-expanded', 'true');
      var from = readerTrigger.getBoundingClientRect();
      var to = _sheetFinalRect();
      _setSheetRect(to);
      root.classList.add('rb-reading');
      if (prefersReduced()) {
        readerSheet.style.transform = 'none';
      } else {
        readerSheet.style.transition = 'none';
        readerSheet.style.transform = _flipTransform(from, to);
        void readerSheet.offsetWidth;               // force it to render before...
        readerSheet.style.transition = '';
        readerSheet.style.transform = '';            // ...animating to identity
      }
      // Move focus into the dialog and remember where to send it back.
      var d = root.ownerDocument;
      _readerReturnFocus = (d && d.activeElement) || readerTrigger;
      var firstBtn = readerSheet.querySelector('[data-rb-close-reader], button, [tabindex], a[href]');
      if (firstBtn && firstBtn.focus) firstBtn.focus({ preventScroll: true });
      else if (readerSheet.focus) {
        if (readerSheet.getAttribute('tabindex') == null) readerSheet.setAttribute('tabindex', '-1');
        readerSheet.focus({ preventScroll: true });
      }
      onOpen(FOLD.READER, '');
    }
    function _domCloseReader() {
      if (!_reading) return;
      _reading = false;
      if (readerTrigger) readerTrigger.setAttribute('aria-expanded', 'false');
      if (readerSheet && readerTrigger) {
        if (!prefersReduced()) {
          var backTo = readerSheet.getBoundingClientRect();   // current (final) box
          readerSheet.style.transform = _flipTransform(readerTrigger.getBoundingClientRect(), backTo);
        } else {
          readerSheet.style.transform = 'none';
        }
      }
      root.classList.remove('rb-reading');
      // Return focus to wherever it was before the dialog opened.
      if (_readerReturnFocus && _readerReturnFocus.focus) _readerReturnFocus.focus({ preventScroll: true });
      else if (readerTrigger && readerTrigger.focus) readerTrigger.focus({ preventScroll: true });
      _readerReturnFocus = null;
      onClose(FOLD.READER);
    }

    // ── glossary hover-card DOM ops ──────────────────────────────────────────
    function _hcardSub(sel) { return hcardEl ? hcardEl.querySelector(sel) : null; }
    function _showHcard(termEl) {
      if (!hcardEl || !termEl) return;
      var d = terms[termEl.getAttribute('data-rb-term')];
      if (!d) return;                                  // no definition -> no card
      var titleEl = _hcardSub('[data-rb-hcard-title]');
      var catEl = _hcardSub('[data-rb-hcard-cat]');
      var bodyEl = _hcardSub('[data-rb-hcard-body]');
      // textContent (never innerHTML) keeps untrusted glossary text inert (§T-B1).
      if (titleEl) titleEl.textContent = d.name || termEl.getAttribute('data-rb-term') || '';
      if (catEl) catEl.textContent = String(d.category || '').toUpperCase();
      if (bodyEl) bodyEl.textContent = d.body || '';
      hcardEl.style.setProperty('--rb-cc', termCategoryColor(d.category));
      var pos = clampCardPosition({
        rect: termEl.getBoundingClientRect(),
        viewportWidth: win.innerWidth, viewportHeight: win.innerHeight,
        cardWidth: hcardEl.offsetWidth || 270, cardHeight: hcardEl.offsetHeight || 140
      });
      hcardEl.style.left = pos.x + 'px';
      hcardEl.style.top = pos.y + 'px';
      hcardEl.classList.add('is-open');
      hcardEl.setAttribute('aria-hidden', 'false');
      _hcardOpen = true;
    }
    function _hideHcard() {
      if (!hcardEl || !_hcardOpen) return;
      hcardEl.classList.remove('is-open');
      hcardEl.setAttribute('aria-hidden', 'true');
      _hcardOpen = false;
    }
    function _clearHcardRestTimer() { if (_hcardRestTimer) { win.clearTimeout(_hcardRestTimer); _hcardRestTimer = null; } }
    // _bindTermHover wires one glossary term element to the shared hover card:
    // hover WAITS for the pointer to rest (HCARD_REST_MS) before growing the
    // card, and leaving the term vanishes it immediately; focus/click/keydown
    // show it right away (keyboard + touch never wait on a "rest" they can't
    // perform). Exported as bindTerms() below so content rendered AFTER mount
    // (e.g. a lazily-played example script) gets the identical behaviour
    // instead of a second, drifting implementation.
    function _bindTermHover(t) {
      on(t, 'mouseenter', function () {
        _clearHcardRestTimer();
        _hcardRestTimer = win.setTimeout(function () { _hcardRestTimer = null; _showHcard(t); }, HCARD_REST_MS);
      });
      on(t, 'mouseleave', function () { _clearHcardRestTimer(); _hideHcard(); });
      on(t, 'focus', function () { _clearHcardRestTimer(); _showHcard(t); });
      on(t, 'blur', function () { _clearHcardRestTimer(); _hideHcard(); });
      on(t, 'click', function (e) { e.stopPropagation(); _clearHcardRestTimer(); _showHcard(t); });
      on(t, 'keydown', function (e) { if (_isActivateKey(e)) { e.preventDefault(); _clearHcardRestTimer(); _showHcard(t); } });
    }
    function bindTerms(list) {
      if (!hcardEl || !list) return;
      each(list, function (t) { _bindTermHover(t); });
    }

    // dispatch runs an action through the PURE reducer, then applies each
    // effect to the DOM. At most one 'open-*' effect fires per action, so the
    // opened element is carried in `el`; closes use the tracked open refs.
    function dispatch(action, el) {
      var r = reduce(state, action);
      state = r.state;
      for (var i = 0; i < r.effects.length; i++) {
        var fx = r.effects[i];
        if (fx === 'close-wing') _domCloseWing();
        else if (fx === 'open-wing') _domOpenWing(el);
        else if (fx === 'close-flap') _domCloseFlap();
        else if (fx === 'open-flap') _domOpenFlap(el);
        else if (fx === 'close-reader') _domCloseReader();
        else if (fx === 'open-reader') _domOpenReader();
      }
      return r;
    }

    // small DOM utilities (ES5-safe; no NodeList.forEach / classList.toggle-arg)
    function each(list, fn) { if (!list) return; for (var i = 0; i < list.length; i++) fn(list[i], i); }
    function _toggle(el, cls, add) { if (add) el.classList.add(cls); else el.classList.remove(cls); }
    function _isActivateKey(e) { return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'; }
    // _activatable makes a non-button fold trigger keyboard-operable + announced
    // (the wing/reader hosts are <div>s in the mockup). Idempotent; never
    // overrides an author-set role/tabindex.
    function _activatable(el) {
      if (!el) return;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'a') return;
      if (!el.getAttribute('role')) el.setAttribute('role', 'button');
      if (el.getAttribute('tabindex') == null) el.setAttribute('tabindex', '0');
      if (el.getAttribute('aria-expanded') == null) el.setAttribute('aria-expanded', 'false');
    }
    function _scrollTo(el) { if (el && el.scrollIntoView) el.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'center' }); }
    // _hopThen defers the next fold's open so the previous one can fold back
    // first. `long` (reader-originated hops) waits for the reader's ~600ms
    // rect fold-back instead of the ~130ms wing/flap crease. Tracked so destroy
    // can cancel it, and guarded so it never dispatches into a torn-down widget.
    function _hopThen(fn, long) {
      if (_destroyed) return;
      if (prefersReduced()) { fn(); return; }
      _hopTimer = win.setTimeout(function () { _hopTimer = null; if (!_destroyed) fn(); }, long ? 600 : 130);
    }
    // _isEditableTarget is true when focus is in a control that should receive a
    // literal "/" (so the search shortcut doesn't hijack other page inputs).
    function _isEditableTarget(el) {
      if (!el) return false;
      if (el.isContentEditable) return true;
      var tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    }
    // _trapReaderTab keeps Tab focus inside the reader dialog while it is open.
    function _trapReaderTab(e) {
      if (!readerSheet) return;
      var f = readerSheet.querySelectorAll('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      var active = root.ownerDocument ? root.ownerDocument.activeElement : null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    // _trapWingTab is the same contract as _trapReaderTab, for the one wing
    // that is a full dialog (the sheet): Tab wraps round its board, its
    // showing side panels and its tab bar, and focus that has slipped out of
    // them is brought back in.
    function _trapWingTab(e) {
      var s = _openWingEl && _sheetFor(_openWingEl);
      if (!s) return;
      var f = _sheetFocusables(s);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      var active = root.ownerDocument ? root.ownerDocument.activeElement : null;
      var inside = false;
      for (var i = 0; i < f.length; i++) if (f[i] === active) { inside = true; break; }
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true }); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
    }
    function _closeAll() {
      if (state.wing) dispatch({ type: 'CLOSE_WING' });
      if (state.flap) dispatch({ type: 'CLOSE_FLAP' });
      if (state.reader) dispatch({ type: 'CLOSE_READER' });
    }
    function _applyWingGeometry(host) {
      var wing = host && host.querySelector('.rb-wing');
      if (!wing) return;
      if (isMobileWidth(win.innerWidth, breakpoint)) {
        // Mobile: the wing folds DOWNWARD and must span the
        // whole block (viewport minus page padding), not the cramped card column
        // it hinges from. Measure the block so the panel matches the real layout
        // whatever the page padding is; nudge its left edge to the block's left.
        wing.classList.add('rb-wing--down');
        var blk = _closest(host, '[data-rb-block]');
        var br = blk ? blk.getBoundingClientRect() : null;
        var hostRect = host.getBoundingClientRect();
        wing.style.width = mobileWingWidth({
          blockWidth: br ? br.width : null,
          viewportWidth: win.innerWidth, pagePadding: PAGE_PADDING
        }) + 'px';
        wing.style.left = br ? (br.left - hostRect.left) + 'px' : '';
        wing.style.right = 'auto';
        return;
      }
      // Desktop: sideways hinge — clear the mobile left/right nudge and clamp the
      // width to the space beside the card.
      wing.classList.remove('rb-wing--down');
      wing.style.left = ''; wing.style.right = '';
      var side = host.getAttribute('data-rb-side') === 'left' ? 'left' : 'right';
      var rect = host.getBoundingClientRect();
      var maxAttr = parseInt(host.getAttribute('data-rb-wing-max'), 10);
      wing.style.width = clampWingWidth({
        side: side, viewportWidth: win.innerWidth, cardLeft: rect.left, cardRight: rect.right,
        max: isNaN(maxAttr) ? WING_MAX : maxAttr
      }) + 'px';
    }

    // wings: tap a card to fold its panel out; tapping the open card is a no-op
    each(root.querySelectorAll('[data-rb-wing]'), function (host) {
      _activatable(host);
      on(host, 'click', function () { if (_openWingEl !== host) dispatch({ type: 'OPEN_WING', id: host.id || '' }, host); });
      on(host, 'keydown', function (e) {
        if (_isActivateKey(e) && _openWingEl !== host) { e.preventDefault(); dispatch({ type: 'OPEN_WING', id: host.id || '' }, host); }
      });
    });
    // sheets: the phone tab bar (Back + one tab per side panel) and each
    // bottom sheet's own close handle
    each(root.querySelectorAll('[data-rb-wing-mode="sheet"]'), function (host) {
      var s = _sheetFor(host);
      if (!s) return;
      if (s.tabs) on(s.tabs, 'click', function (e) {
        var b = _closest(e.target, '[data-rb-sheet-tab-for]');
        if (!b) return;
        var k = b.getAttribute('data-rb-sheet-tab-for');
        if (k === 'home') { var home = s.panel.querySelector('[data-rb-sheet-home]'); if (home) home.click(); return; }
        _phoneSide(s, k, b.getAttribute('aria-pressed') !== 'true');
      });
      each(host.querySelectorAll('[data-rb-sheet-handle]'), function (h) {
        on(h, 'click', function (e) { e.stopPropagation(); _phoneSide(s, null, false); });
      });
    });
    // flaps: tap a row to unfold; tap the open row again to fold back (toggle)
    each(root.querySelectorAll('[data-rb-flap]'), function (crow) {
      var trig = crow.querySelector('[data-rb-flap-trigger]') || crow;
      if (trig.getAttribute('aria-expanded') == null) trig.setAttribute('aria-expanded', 'false');
      on(trig, 'click', function (e) {
        e.stopPropagation();
        if (_openFlapEl === crow) dispatch({ type: 'CLOSE_FLAP' });
        else dispatch({ type: 'OPEN_FLAP', id: crow.id || '' }, crow);
      });
    });
    // reader: the lead-story block unfolds into the centred sheet
    if (readerTrigger) {
      _activatable(readerTrigger);
      on(readerTrigger, 'click', function () { if (!_reading) dispatch({ type: 'OPEN_READER' }); });
      on(readerTrigger, 'keydown', function (e) { if (_isActivateKey(e) && !_reading) { e.preventDefault(); dispatch({ type: 'OPEN_READER' }); } });
    }

    // glossary terms: hover/focus shows the quick card; tap shows it on touch;
    // Esc / outside / scroll dismiss (wired below, shared with the folds). The
    // terms are author-focusable (tabindex in the markup) so this is keyboard-
    // reachable; the card content is looked up in the `terms` map at mount.
    if (hcardEl) {
      each(root.querySelectorAll('[data-rb-term]'), function (t) { _bindTermHover(t); });
    }

    // dismiss buttons (crease ✕, rope, rx, veil-as-close-reader)
    each(root.querySelectorAll('[data-rb-close-wing]'), function (b) { on(b, 'click', function (e) { e.stopPropagation(); dispatch({ type: 'CLOSE_WING' }); }); });
    each(root.querySelectorAll('[data-rb-close-flap]'), function (b) { on(b, 'click', function (e) { e.stopPropagation(); dispatch({ type: 'CLOSE_FLAP' }); }); });
    // The veil carries data-rb-close-reader and stops the click, so the
    // outside-click below never sees it: a sheet open over the veil folds
    // back from here too.
    each(root.querySelectorAll('[data-rb-close-reader]'), function (b) {
      on(b, 'click', function (e) {
        e.stopPropagation();
        if (_openWingEl && _isSheet(_openWingEl) && !_openWingEl.contains(b)) dispatch({ type: 'CLOSE_WING' });
        dispatch({ type: 'CLOSE_READER' });
      });
    });

    // cross-mechanic hops: close whatever is open, then open the next fold
    each(root.querySelectorAll('[data-rb-goto-reader]'), function (b) {
      on(b, 'click', function (e) { e.stopPropagation(); _closeAll(); _hopThen(function () { dispatch({ type: 'OPEN_READER' }); }); });
    });
    each(root.querySelectorAll('[data-rb-goto-card]'), function (b) {
      on(b, 'click', function (e) {
        e.stopPropagation();
        var t = byId(b.getAttribute('data-rb-goto-card'));
        var wasReader = state.reader;
        _closeAll();
        _hopThen(function () { _scrollTo(t); if (t) dispatch({ type: 'OPEN_WING', id: t.id || '' }, t); }, wasReader);
      });
    });
    each(root.querySelectorAll('[data-rb-goto-flap]'), function (b) {
      on(b, 'click', function (e) {
        e.stopPropagation();
        var c = byId(b.getAttribute('data-rb-goto-flap'));
        var wasReader = state.reader;
        _closeAll();
        _hopThen(function () { if (c) { dispatch({ type: 'OPEN_FLAP', id: c.id || '' }, c); _scrollTo(c); } }, wasReader);
      });
    });

    // search: non-matching cards fold face-down, non-matching blocks dim
    var searchEl = root.querySelector('[data-rb-search]');
    if (searchEl) {
      on(searchEl, 'click', function (e) { e.stopPropagation(); });
      on(searchEl, 'input', function () {
        var q = searchEl.value;
        each(root.querySelectorAll('[data-rb-tile]'), function (tile) {
          var nameEl = tile.querySelector('.rb-tn');
          var hit = tileMatches({ name: nameEl ? nameEl.textContent : '', tags: tile.getAttribute('data-rb-tags') || '' }, q);
          _toggle(tile, 'rb-facedown', !!q && !hit);
        });
        each(root.querySelectorAll('[data-rb-block]'), function (blk) {
          _toggle(blk, 'rb-nomatch', !!q && !blockMatches(blk.textContent, q));
        });
      });
    }

    // deal-in stacking contexts on .rb-blk would trap fixed fold-overs under
    // the veil — drop each block's animation once it has played (mockup fix)
    each(root.querySelectorAll('.rb-blk'), function (blk) { on(blk, 'animationend', function () { blk.style.animation = 'none'; }); });

    // Esc priority (flap → wing → reader), "/" focuses search, tap-outside folds back
    var doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      on(doc, 'click', function (e) {
        if (_openWingEl && !_openWingEl.contains(e.target)) dispatch({ type: 'CLOSE_WING' });
        if (_openFlapEl && !_openFlapEl.contains(e.target)) dispatch({ type: 'CLOSE_FLAP' });
      });
      // Hover card: capture-phase so it runs before a term's own click re-opens
      // it — dismiss when a click lands outside both the card and any term.
      on(doc, 'click', function (e) {
        if (_hcardOpen && hcardEl && !hcardEl.contains(e.target) && !_closest(e.target, '[data-rb-term]')) _hideHcard();
      }, true);
      // Any scroll invalidates the card's fixed position — fold it away.
      on(doc, 'scroll', function () { if (_hcardOpen) _hideHcard(); }, true);
      on(doc, 'keydown', function (e) {
        // Esc closes the hover card first (it sits above the folds), then folds.
        if (e.key === 'Escape') { if (_hcardOpen) { _hideHcard(); return; } dispatch({ type: 'ESCAPE' }); return; }
        if (_reading && e.key === 'Tab') { _trapReaderTab(e); return; }
        if (_openWingEl && _isSheet(_openWingEl) && e.key === 'Tab') { _trapWingTab(e); return; }
        // "/" focuses search — but never when typing in another editable field
        // on the host page, and never with a modifier held.
        if (e.key === '/' && !_reading && !e.ctrlKey && !e.metaKey && !e.altKey && searchEl &&
            doc.activeElement !== searchEl && !_isEditableTarget(doc.activeElement)) {
          e.preventDefault(); searchEl.focus();
        }
      });
    }
    // keep an open fold correctly sized across resizes / orientation changes
    on(win, 'resize', function () {
      if (_hcardOpen) _hideHcard();   // its fixed position would be stale
      if (_openWingEl && !_isSheet(_openWingEl)) _applyWingGeometry(_openWingEl);
      // a sheet mid-film (opening or closing) jumps to its end; an open one re-lays
      each(root.querySelectorAll('[data-rb-wing-mode="sheet"]'), function (h) { if (h.__rbSheet) _resizeSheet(h); });
      if (_reading && readerSheet) _setSheetRect(_sheetFinalRect());
    });

    function destroy() {
      _destroyed = true;
      if (_hopTimer) { win.clearTimeout(_hopTimer); _hopTimer = null; }
      _clearHcardRestTimer();
      for (var i = 0; i < listeners.length; i++) {
        var L = listeners[i];
        try { L.t.removeEventListener(L.type, L.fn, L.o); } catch (e) {}
      }
      listeners = [];
      _domCloseWing(); _domCloseFlap(); _domCloseReader(); _hideHcard();
      // A sheet's close film cannot finish after teardown: drop it now.
      each(root.querySelectorAll('[data-rb-wing-mode="sheet"]'), function (h) {
        var s = h.__rbSheet;
        if (!s) return;
        if (s.film) { s.film.gen++; each(s.film.anims, function (l) { _cancel(l); }); s.film.running = false; }
        each(s.sides, function (side) { _cancel(side.__rbAnims); side.__rbAnims = null; });
        h.classList.remove('is-open', 'rb-sheet-away');
        root.classList.remove('rb-lair-open');
        h.__rbSheet = null;
      });
      state = createState();
    }

    return { destroy: destroy, bindTerms: bindTerms, setSheetCompanions: setSheetCompanions };
  }

  // _closest is an ES5-safe Element.closest (some embedded webviews lack it).
  function _closest(el, sel) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (_matches(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function _matches(el, sel) {
    var m = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
    return m ? m.call(el, sel) : false;
  }

  return {
    FOLD: FOLD,
    MOBILE_BREAKPOINT: MOBILE_BREAKPOINT,
    createState: createState,
    reduce: reduce,
    escapePriority: escapePriority,
    wingSide: wingSide,
    clampWingWidth: clampWingWidth,
    isMobileWidth: isMobileWidth,
    mobileWingWidth: mobileWingWidth,
    motionAllowed: motionAllowed,
    SHEET: SHEET,
    sheetMode: sheetMode,
    sheetLayout: sheetLayout,
    sheetFoldGeometry: sheetFoldGeometry,
    termCategoryColor: termCategoryColor,
    clampCardPosition: clampCardPosition,
    tileMatches: tileMatches,
    blockMatches: blockMatches,
    mount: mount
  };
})();

// Test seam: expose the module for Node unit tests. Inert in a browser (no
// CommonJS `module`). In the browser the `RulebookFoldEngine` global above is
// what widget scripts consume.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RulebookFoldEngine;
}
