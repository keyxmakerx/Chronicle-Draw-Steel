/**
 * Draw Steel Rulebook Fold Engine — the reusable fold interaction module.
 *
 * Ports the SIGNED rulebook design contract (cordinator mockups/
 * rulebook-v10-table.html, v10.1) into a reusable, content-agnostic module.
 * It knows NOTHING about characteristics, conditions, or the Power Roll — it
 * only knows three physical fold moves and how they coordinate:
 *
 *   1. WING  — a panel hinged to a card's edge that folds out OVER its
 *              neighbours (rotateY spring). Left-column cards wing right,
 *              right-column cards wing left; the caller declares the side.
 *   2. FLAP  — a list row unfolds a panel DOWN over the rows beneath (rotateX).
 *   3. READER — a block unfolds into a centred reading sheet (FLIP takeover
 *              with a veil behind).
 *
 * Only ONE fold is open at a time. Opening any fold closes the others; Esc
 * (and the veil / outside taps) fold back with the priority flap -> wing ->
 * reader. Under the mobile breakpoint wings open DOWNWARD full-width
 * (flap-style) instead of sideways, with the same crease + dismissal.
 *
 * SPLIT ON PURPOSE:
 *   - a PURE state machine (createState / reduce / escapePriority / wingSide /
 *     clampWingWidth / isMobileWidth / tileMatches / blockMatches / motionAllowed)
 *     with no DOM access, so it is unit-tested headless
 *     (tools/test-rulebook-fold-engine.mjs, `node --test`); and
 *   - a DOM controller `mount(root, options)` that wires events onto a DOM the
 *     CALLER builds using the data-attribute contract below, and drives it
 *     through the pure reducer.
 *
 * DOM CONTRACT (all queried within `root`; every hook optional):
 *   [data-rb-wing]            a card that hosts a wing. Child `.rb-wing` is the
 *                             panel. Optional data-rb-side="left|right" (default
 *                             right), data-rb-dim="<selector>" for a block to dim
 *                             while open, data-rb-wing-max="<px>" width cap.
 *   [data-rb-flap]            a list row that hosts a flap. Child `.rb-flap` is
 *                             the panel; the clickable trigger is `.rb-flap-trigger`
 *                             (falls back to the row itself). Rows sharing a
 *                             [data-rb-flap-group] ancestor dim their siblings.
 *   [data-rb-reader]          the trigger block that unfolds into the reader.
 *   [data-rb-reader-sheet]    the reader sheet element (position:fixed).
 *   [data-rb-veil]            the veil element behind reader/lair folds.
 *   [data-rb-close-wing|flap|reader]   dismiss buttons (crease ✕, rope, rx).
 *   [data-rb-search]          the search <input> (face-down fold + block dim).
 *   [data-rb-tile]            a searchable card; data-rb-tags="space joined".
 *   [data-rb-block]           a searchable block (dims when it has no match).
 *   [data-rb-goto-reader]     cross-hop: close current fold, open the reader.
 *   [data-rb-goto-card="id"]  cross-hop: open the wing on the card with that id.
 *   [data-rb-goto-flap="id"]  cross-hop: open the flap on the row with that id.
 *
 * Loading: in the browser this attaches the `RulebookFoldEngine` global, served
 * via the manifest `text_renderers` section which loads BEFORE widget scripts
 * (the same seam DrawSteelRefRenderer / MonsterEngine use). In Node it exports
 * the same object so the state machine is unit-tested off-DOM.
 */
var RulebookFoldEngine = (function () {
  'use strict';

  // Fold kinds. Shared vocabulary between the reducer and the controller.
  var FOLD = { WING: 'wing', FLAP: 'flap', READER: 'reader' };

  var MOBILE_BREAKPOINT = 640; // px; below this, wings open downward full-width
  var WING_MIN = 270, WING_MAX = 340, WING_GUTTER = 16; // clamp defaults (mockup)

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

  // motionAllowed centralises the reduced-motion gate for JS-driven timing
  // (the CSS handles declarative transitions via a media query).
  function motionAllowed(prefersReducedMotion) {
    return !prefersReducedMotion;
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
    function _domOpenWing(host) {
      if (!host) return;
      _openWingEl = host;
      host.classList.add('is-open');
      host.setAttribute('aria-expanded', 'true');
      var wing = host.querySelector('.rb-wing');
      var side = host.getAttribute('data-rb-side') === 'left' ? 'left' : 'right';
      if (wing) {
        if (isMobileWidth(win.innerWidth, breakpoint)) {
          wing.classList.add('rb-wing--down');   // downward full-width (flap-style)
          wing.style.width = '';
        } else {
          wing.classList.remove('rb-wing--down');
          var rect = host.getBoundingClientRect();
          var maxAttr = parseInt(host.getAttribute('data-rb-wing-max'), 10);
          var w = clampWingWidth({
            side: side, viewportWidth: win.innerWidth,
            cardLeft: rect.left, cardRight: rect.right,
            max: isNaN(maxAttr) ? WING_MAX : maxAttr
          });
          wing.style.width = w + 'px';
        }
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
      host.classList.remove('is-open');
      host.setAttribute('aria-expanded', 'false');
      var wing = host.querySelector('.rb-wing');
      if (wing) { wing.style.width = ''; wing.classList.remove('rb-wing--down'); }
      // only wings set rb-dimmed (search uses rb-nomatch), so clearing is safe
      var dimmed = root.querySelectorAll('.rb-dimmed');
      for (var i = 0; i < dimmed.length; i++) dimmed[i].classList.remove('rb-dimmed');
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
      var w = Math.min(940, win.innerWidth - 36);
      var h = Math.min(win.innerHeight * 0.86, 700);
      var to = { left: Math.max(18, (win.innerWidth - w) / 2), top: Math.max(14, (win.innerHeight - h) / 2), width: w, height: h };
      if (prefersReduced()) {                       // no FLIP; jump to final rect
        _setSheetRect(to); root.classList.add('rb-reading');
      } else {
        readerSheet.style.transition = 'none';
        _setSheetRect(from);
        void readerSheet.offsetWidth;               // force reflow so `from` sticks
        readerSheet.style.transition = '';
        root.classList.add('rb-reading');
        _setSheetRect(to);
      }
      // Move focus into the dialog and remember where to send it back.
      var d = root.ownerDocument;
      _readerReturnFocus = (d && d.activeElement) || readerTrigger;
      var firstBtn = readerSheet.querySelector('[data-rb-close-reader], button, [tabindex], a[href]');
      if (firstBtn && firstBtn.focus) firstBtn.focus();
      else if (readerSheet.focus) {
        if (readerSheet.getAttribute('tabindex') == null) readerSheet.setAttribute('tabindex', '-1');
        readerSheet.focus();
      }
      onOpen(FOLD.READER, '');
    }
    function _domCloseReader() {
      if (!_reading) return;
      _reading = false;
      if (readerTrigger) readerTrigger.setAttribute('aria-expanded', 'false');
      if (readerSheet && readerTrigger) _setSheetRect(readerTrigger.getBoundingClientRect());
      root.classList.remove('rb-reading');
      // Return focus to wherever it was before the dialog opened.
      if (_readerReturnFocus && _readerReturnFocus.focus) _readerReturnFocus.focus();
      else if (readerTrigger && readerTrigger.focus) readerTrigger.focus();
      _readerReturnFocus = null;
      onClose(FOLD.READER);
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
    function _closeAll() {
      if (state.wing) dispatch({ type: 'CLOSE_WING' });
      if (state.flap) dispatch({ type: 'CLOSE_FLAP' });
      if (state.reader) dispatch({ type: 'CLOSE_READER' });
    }
    function _applyWingGeometry(host) {
      var wing = host && host.querySelector('.rb-wing');
      if (!wing) return;
      if (isMobileWidth(win.innerWidth, breakpoint)) { wing.classList.add('rb-wing--down'); wing.style.width = ''; return; }
      wing.classList.remove('rb-wing--down');
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

    // dismiss buttons (crease ✕, rope, rx, veil-as-close-reader)
    each(root.querySelectorAll('[data-rb-close-wing]'), function (b) { on(b, 'click', function (e) { e.stopPropagation(); dispatch({ type: 'CLOSE_WING' }); }); });
    each(root.querySelectorAll('[data-rb-close-flap]'), function (b) { on(b, 'click', function (e) { e.stopPropagation(); dispatch({ type: 'CLOSE_FLAP' }); }); });
    each(root.querySelectorAll('[data-rb-close-reader]'), function (b) { on(b, 'click', function (e) { e.stopPropagation(); dispatch({ type: 'CLOSE_READER' }); }); });

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
      on(doc, 'keydown', function (e) {
        if (e.key === 'Escape') { dispatch({ type: 'ESCAPE' }); return; }
        if (_reading && e.key === 'Tab') { _trapReaderTab(e); return; }
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
      if (_openWingEl) _applyWingGeometry(_openWingEl);
      if (_reading && readerSheet) {
        var w = Math.min(940, win.innerWidth - 36), h = Math.min(win.innerHeight * 0.86, 700);
        _setSheetRect({ left: Math.max(18, (win.innerWidth - w) / 2), top: Math.max(14, (win.innerHeight - h) / 2), width: w, height: h });
      }
    });

    function destroy() {
      _destroyed = true;
      if (_hopTimer) { win.clearTimeout(_hopTimer); _hopTimer = null; }
      for (var i = 0; i < listeners.length; i++) {
        var L = listeners[i];
        try { L.t.removeEventListener(L.type, L.fn, L.o); } catch (e) {}
      }
      listeners = [];
      _domCloseWing(); _domCloseFlap(); _domCloseReader();
      state = createState();
    }

    return { destroy: destroy };
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
    motionAllowed: motionAllowed,
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
