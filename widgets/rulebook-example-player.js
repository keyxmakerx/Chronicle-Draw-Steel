/**
 * Draw Steel Rulebook Example Player — the staged "at the table" player.
 *
 * Ports the SIGNED design contract's staged example (Cordinator mockups/
 * rulebook-v10-table.html, v10.1 — renders/rb9-example.gif) into a reusable,
 * CONTENT-AGNOSTIC ES5 module. It knows nothing about Might, the Power Roll, or
 * the Lich's Lair — only how to render + play a "script": a little scene where
 *
 *   1. character tokens SLIDE IN and the acting token GLOWS on its line,
 *   2. lines light one by one (director gold / player purple / roll amber),
 *   3. the ROLL line ticks its dice through faces, settles on the scripted
 *      values, steps the math out piece by piece WITH its why
 *      ("= 12 · +2 Might · (it's a Might test) · → 14") and the tier STAMPS on,
 *   4. ↻ replay is always available, and
 *   5. under prefers-reduced-motion everything reveals INSTANTLY, fully readable.
 *
 * Scripts are DATA (data/rulebook-examples.json, ReferenceItem[]). The consuming
 * widget hands the player a { slug: scriptData } map and mounts it on a root the
 * widget built with the data-attribute contract below; the player renders each
 * script lazily on first play.
 *
 * SPLIT ON PURPOSE (mirrors rulebook-fold-engine.js):
 *   - PURE, DOM-free logic (tokenForLine / isRoll / rollRevealOrder / planScript /
 *     richText / buildScriptHtml) unit-tested headless
 *     (tools/test-rulebook-example-player.mjs, `node --test`); and
 *   - a DOM controller mount(root, options) that wires the triggers and drives
 *     the animation timers.
 *
 * DOM CONTRACT (all queried within `root`; every hook optional):
 *   [data-rbx-play="slug"]     a button that renders (once) + plays the script
 *                              `slug` into the nearest [data-rbx-script="slug"].
 *                              Optional data-rbx-show / data-rbx-hide = an element
 *                              id to reveal / hide first (the Lair drill-in).
 *   [data-rbx-script="slug"]   the (initially empty) container the script renders
 *                              into; gains `rbx-on` while shown.
 *   [data-rbx-replay]          a button inside a rendered script that replays it.
 *   [data-rbx-back]            reverses a play button's show/hide (Lair overview).
 *
 * Loading: attaches the `RulebookExamplePlayer` global, served via the manifest
 * `text_renderers` section so it loads BEFORE widget scripts (same seam as
 * RulebookFoldEngine / MonsterEngine). In Node it exports the same object so the
 * pure logic is unit-tested off-DOM.
 *
 * Text markup (authored, trusted repo data — still escaped first, then promoted):
 *   **bold**  -> <b>            (ink emphasis: numbers, ability names)
 *   ~~dmg~~   -> combat accent   (the "what happened" beat: damage, prone, …)
 */
var RulebookExamplePlayer = (function () {
  'use strict';

  // Animation cadence (ms). Ported from the mockup's playScript/rollSeq timings.
  var TICK_MS = 80;        // dice-face tick interval
  var DICE_TICKS = 8;      // ticks before the dice settle on their scripted values
  var STEP_MS = 420;       // gap between math-step reveals
  var ROLL_AFTER_MS = 750; // pause after a roll line before the next line
  var LINE_MS = 1000;      // dwell on a non-roll line before the next
  var STAGE_IN_MS = 60;    // delay before the stage tokens slide in

  // ── escaping / text helpers ──────────────────────────────────────────────

  // esc HTML-escapes & < > via Chronicle's helper when present, else a local
  // fallback — the single choke point for text entering innerHTML.
  function esc(s) {
    if (typeof Chronicle !== 'undefined' && Chronicle && typeof Chronicle.escapeHtml === 'function') {
      return Chronicle.escapeHtml(s == null ? '' : String(s));
    }
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // escAttr additionally neutralises the attribute-value delimiter.
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

  // richText escapes FIRST, then promotes the two authored markers — safe
  // because the markup is only introduced after the source text is inert.
  //   **bold** -> <b>…</b>              (numbers, ability names)
  //   ~~dmg~~  -> <span class="rbx-dmg"> (the combat-accent "what happened" beat)
  function richText(s) {
    return esc(s)
      .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
      .replace(/~~([\s\S]+?)~~/g, '<span class="rbx-dmg">$1</span>');
  }

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  // ── PURE sequencing logic (headless-testable; no DOM) ─────────────────────

  // isRoll is the "this line ticks dice" predicate.
  function isRoll(line) { return !!(line && line.kind === 'roll'); }

  // tokenForLine answers which stage token GLOWS while a line is live: the
  // player's own line lights the PC token, the director's lights the FOE token,
  // and a roll (or anything else) glows nothing — the dice are the focus.
  function tokenForLine(line) {
    var kind = line && line.kind;
    if (kind === 'pc') return 'pc';
    if (kind === 'dir') return 'foe';
    return null;
  }

  // rollRevealOrder is the ordered list of pieces a ROLL line steps out: each
  // math step (carrying its optional `why` flag) in authored order, then the
  // tier stamp LAST. This is the "roll-step ordering" the tests pin.
  function rollRevealOrder(line) {
    var out = [];
    var steps = (line && line.steps) || [];
    for (var i = 0; i < steps.length; i++) {
      out.push({ type: 'step', text: steps[i].text, why: !!steps[i].why });
    }
    if (line && line.tier) out.push({ type: 'tier', text: line.tier });
    return out;
  }

  // planScript turns a script + options into an ordered list of timed BEATS —
  // one per line — plus whether the stage should slide in. Under reduced motion
  // every delay collapses to 0 and `reduced` is set, so the controller reveals
  // the whole scene at once (no ticking, no sliding), fully readable.
  function planScript(script, opts) {
    var o = opts || {};
    var reduced = !!o.reducedMotion;
    var lines = (script && script.lines) || [];
    var beats = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var beat = { index: i, kind: l && l.kind, token: tokenForLine(l), roll: isRoll(l) };
      if (beat.roll) {
        beat.dice = (l && l.dice) || [];
        beat.reveals = rollRevealOrder(l);
        beat.diceTicks = reduced ? 0 : DICE_TICKS;
        beat.stepDelay = reduced ? 0 : STEP_MS;
        beat.afterDelay = reduced ? 0 : ROLL_AFTER_MS;
      } else {
        beat.afterDelay = reduced ? 0 : LINE_MS;
      }
      beats.push(beat);
    }
    return { reduced: reduced, stageIn: !reduced, beats: beats };
  }

  // ── PURE DOM-string builder (headless-testable) ───────────────────────────

  // whoClass maps a line kind to its speaker-chip accent class.
  function whoClass(kind) {
    if (kind === 'pc') return 'rbx-pc';
    if (kind === 'roll') return 'rbx-roll';
    return 'rbx-dir';
  }

  // buildRollTx builds the ROLL line's inner text: the dice cells (rendered as
  // '?' until they settle) then the math steps and the tier stamp — all starting
  // hidden; the controller reveals them in order.
  function buildRollTx(line) {
    var dice = (line && line.dice) || [];
    var cells = '';
    for (var i = 0; i < dice.length; i++) cells += '<span class="rbx-die">?</span>';
    var order = rollRevealOrder(line);
    var pieces = '';
    for (var j = 0; j < order.length; j++) {
      var o = order[j];
      if (o.type === 'tier') {
        pieces += '<span class="rbx-tstamp">' + esc(o.text) + '</span>';
      } else {
        pieces += '<span class="rbx-mstep' + (o.why ? ' rbx-why' : '') + '">' + richText(o.text) + '</span>';
      }
    }
    // The dice cells are decorative animation (they tick through random faces);
    // aria-hidden keeps that churn out of the aria-live region — the settled
    // math ("= 12 · +2 Might · → 14 · TIER 2") carries the outcome for AT.
    return '<span class="rbx-dice" aria-hidden="true">' + cells + '</span>' + pieces;
  }

  // buildLineHtml renders one dialogue/roll line. Roll lines carry data-rbx-dice
  // (the scripted final faces) so the controller can settle them after ticking.
  function buildLineHtml(line) {
    var l = line || {};
    var kind = l.kind || 'dir';
    var rl = (kind === 'roll') ? ' rbx-rl' : '';
    var diceAttr = (kind === 'roll') ? ' data-rbx-dice="' + escAttr(((l.dice) || []).join(',')) + '"' : '';
    var tx = (kind === 'roll') ? buildRollTx(l) : richText(l.text);
    return '<div class="rbx-line' + rl + '" data-rbx-kind="' + escAttr(kind) + '"' + diceAttr + '>' +
      '<span class="rbx-who ' + whoClass(kind) + '">' + esc(l.speaker) + '</span>' +
      '<span class="rbx-tx">' + tx + '</span></div>';
  }

  // buildScriptHtml renders the whole script body (banner + stage + lines) that
  // fills a [data-rbx-script] container. All data text is escaped; only the
  // authored **bold** / ~~dmg~~ markers become markup.
  function buildScriptHtml(script) {
    var s = script || {};
    var p = s.properties || s;                 // accept ReferenceItem or flat shape
    var stage = p.stage || {};
    var pc = stage.pc || {}, foe = stage.foe || {};
    var lines = isArr(p.lines) ? p.lines : [];
    var title = String(p.title || s.name || '').toUpperCase();

    var banner = '<div class="rbx-st"><span class="rbx-sti">' + esc(p.icon) + '</span> ' +
      '<span class="rbx-sttx">' + esc(title) + '</span>' +
      '<button class="rbx-rep" type="button" data-rbx-replay aria-label="Replay this example">↻ replay</button></div>';

    var stageHtml = '<div class="rbx-stage">' +
      '<div class="rbx-tok rbx-pc"><span class="rbx-fig">' + esc(pc.fig) + '</span>' + esc(pc.label) + '</div>' +
      '<span class="rbx-vs">vs</span>' +
      '<div class="rbx-tok rbx-foe"><span class="rbx-fig">' + esc(foe.fig) + '</span>' + esc(foe.label) + '</div></div>';

    var body = '';
    for (var i = 0; i < lines.length; i++) body += buildLineHtml(lines[i]);

    return banner + stageHtml + body;
  }

  // ── stylesheet ────────────────────────────────────────────────────────────

  // css returns the scoped player stylesheet. It reuses the rulebook's dark
  // tokens (--rb-*) when mounted inside .rb-root, but every reference carries a
  // literal fallback so the player looks right dropped anywhere (CLAUDE.md).
  function css() {
    var C = 'var(--rb-combat,#f0a12e)';   // roll / stamp / accent
    var PUR = 'var(--rb-pur,#a78bfa)';     // player
    var GOLD = 'var(--rb-gold,#fbbf24)';   // director
    var EDGE = 'var(--rb-edge,#262c3d)';
    var BOX2 = 'var(--rb-box2,#1a2030)';
    var BOX3 = 'var(--rb-box3,#222a3d)';
    var INK = 'var(--rb-ink,#f2f4fa)';
    var INK2 = 'var(--rb-ink2,#c9d0e0)';
    var MUT2 = 'var(--rb-mut2,#5d6579)';
    var SPRING = 'var(--rb-spring,cubic-bezier(.34,1.3,.4,1))';
    var s = [
      // The script card — hidden until the controller reveals it (rbx-on).
      '.rbx-script{border:1px dashed color-mix(in srgb,' + C + ' 45%,' + EDGE + ');border-radius:12px;' +
        'padding:12px 14px;margin:12px 0 2px;background:color-mix(in srgb,' + C + ' 4%,transparent);display:none}',
      '.rbx-script.rbx-on{display:block}',
      '.rbx-st{font:800 10px/1 inherit;letter-spacing:.09em;color:' + C + ';margin-bottom:8px;' +
        'display:flex;align-items:center;gap:8px}',
      '.rbx-rep{margin-left:auto;font:750 9.5px/1 inherit;color:' + C + ';cursor:pointer;' +
        'background:none;border:1px solid color-mix(in srgb,' + C + ' 35%,transparent);padding:4px 7px;border-radius:99px}',
      '.rbx-rep:focus-visible{outline:2px solid ' + C + ';outline-offset:2px}',
      // The stage — tokens slide in from opposite sides; the actor glows.
      '.rbx-stage{display:flex;align-items:center;justify-content:center;gap:14px;padding:7px 0 9px;' +
        'border-bottom:1px dashed color-mix(in srgb,' + C + ' 25%,' + EDGE + ');margin-bottom:8px}',
      '.rbx-vs{color:' + MUT2 + ';font-size:10px}',
      '.rbx-tok{display:flex;align-items:center;gap:7px;font:800 10px/1 inherit;letter-spacing:.06em;' +
        'padding:6px 10px;border-radius:10px;border:1.5px solid ' + EDGE + ';background:' + BOX2 + ';' +
        'opacity:0;transform:translateX(var(--rbx-from,0));transition:all .5s ' + SPRING + '}',
      '.rbx-stage.rbx-in .rbx-tok{opacity:1;transform:none}',
      '.rbx-fig{font-size:15px}',
      '.rbx-tok.rbx-pc{--rbx-from:-40px;color:' + PUR + '}',
      '.rbx-tok.rbx-foe{--rbx-from:40px;color:' + GOLD + '}',
      '.rbx-tok.rbx-act{border-color:currentColor;box-shadow:0 0 14px color-mix(in srgb,currentColor 30%,transparent)}',
      // Lines light one by one; the active line is highlighted, its chip ringed.
      '.rbx-line{display:flex;gap:10px;margin:7px 0;align-items:baseline;opacity:.14;transition:opacity .35s,background .35s}',
      '.rbx-line.rbx-shown{opacity:1}',
      '.rbx-line.rbx-now{background:color-mix(in srgb,' + C + ' 9%,transparent);border-radius:8px;padding:4px 6px;margin-left:-6px}',
      '.rbx-who{flex:none;font:800 10px/1.6 inherit;letter-spacing:.06em;padding:2px 7px;border-radius:6px;transition:box-shadow .3s}',
      '.rbx-line.rbx-now .rbx-who{box-shadow:0 0 0 1.5px currentColor}',
      '.rbx-who.rbx-dir{color:' + GOLD + ';background:color-mix(in srgb,' + GOLD + ' 12%,transparent)}',
      '.rbx-who.rbx-pc{color:' + PUR + ';background:color-mix(in srgb,' + PUR + ' 12%,transparent)}',
      '.rbx-who.rbx-roll{color:' + C + ';background:color-mix(in srgb,' + C + ' 12%,transparent)}',
      '.rbx-tx{font:500 12.5px/1.55 inherit;color:' + INK2 + '}',
      '.rbx-dmg{color:' + C + ';font-weight:750}',
      // The dice tick, then the math steps out with its why, then the tier stamps.
      '.rbx-dice{display:inline-flex;gap:5px;vertical-align:middle;margin-right:6px}',
      '.rbx-die{width:27px;height:27px;border-radius:8px;display:grid;place-items:center;background:' + BOX3 + ';' +
        'border:1px solid ' + EDGE + ';font:800 13px/1 ui-monospace,monospace;color:' + INK + ';transition:all .15s}',
      '.rbx-die.rbx-hot{border-color:' + C + ';color:' + C + ';transform:scale(1.08)}',
      '.rbx-mstep{display:inline-block;font:750 12px/1 inherit;color:' + INK2 + ';margin:0 3px;' +
        'opacity:0;transform:translateY(6px);transition:all .3s ' + SPRING + '}',
      '.rbx-mstep b{color:' + INK + '}',
      '.rbx-mstep.rbx-why{font:600 10px/1.2 inherit;color:' + MUT2 + '}',
      '.rbx-mstep.rbx-show{opacity:1;transform:none}',
      '.rbx-tstamp{display:inline-block;font:900 11px/1 inherit;letter-spacing:.06em;color:' + C + ';' +
        'border:1.5px solid ' + C + ';padding:4px 8px;border-radius:8px;margin-left:6px;' +
        'opacity:0;transform:scale(1.6) rotate(-6deg);transition:all .35s ' + SPRING + '}',
      '.rbx-tstamp.rbx-show{opacity:1;transform:none}',
      // Lair drill-in helper: the play button reveals a companion, hides another.
      '.rbx-hidden{display:none!important}',
      '.rbx-lairback{display:inline-flex;font:700 10.5px/1 inherit;color:var(--rb-mut,#8a93a8);cursor:pointer;' +
        'padding:5px 9px;border:1px solid ' + EDGE + ';border-radius:8px;background:' + BOX2 + ';margin-bottom:6px}',
      // Reduced motion: no ticking or sliding — reveal everything, fully readable.
      '@media (prefers-reduced-motion:reduce){.rbx-tok,.rbx-line,.rbx-mstep,.rbx-tstamp,.rbx-die{' +
        'transition:none!important;opacity:1!important;transform:none!important}}'
    ];
    return s.join('\n');
  }

  // ── DOM controller (browser only) ─────────────────────────────────────────

  // _injectStyles adds the scoped player stylesheet into the mount root once
  // (class guard), so the player carries its own look wherever it mounts.
  function _injectStyles(root) {
    var doc = (root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    if (!doc || !root.querySelector || root.querySelector('style.rbx-styles')) return;
    var style = doc.createElement('style');
    style.className = 'rbx-styles';
    style.textContent = css();
    root.insertBefore(style, root.firstChild);
  }

  // mount wires the [data-rbx-*] triggers onto `root` and returns
  // { destroy, play, stopAll, collapseAll }. Everything DOM/timer-touching lives
  // here so the
  // module body stays DOM-free and require()-able in Node.
  function mount(root, options) {
    var noop = function () {};
    // The null-root mount must return the SAME shape as a real one. It used
    // to omit collapseAll, so a caller that mounted without a root and later
    // called it got a TypeError instead of a no-op — and rulebook-frontpage's
    // engine onClose('wing') hook is exactly such a caller.
    if (!root) return { destroy: noop, play: noop, stopAll: noop, collapseAll: noop };
    var opts = options || {};
    var win = (typeof window !== 'undefined') ? window : null;
    var examples = opts.examples || {};
    // reducedMotion may be forced (tests); else read the media query live.
    var forcedReduced = (opts.reducedMotion != null) ? !!opts.reducedMotion : null;

    var listeners = [];      // tracked for a clean destroy()
    var timeouts = [];       // outstanding setTimeout ids
    var intervals = [];      // outstanding setInterval ids
    var destroyed = false;

    _injectStyles(root);

    function prefersReduced() {
      if (forcedReduced != null) return forcedReduced;
      return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function on(target, type, fn, o) { if (!target) return; target.addEventListener(type, fn, o); listeners.push({ t: target, type: type, fn: fn, o: o }); }
    function each(list, fn) { if (!list) return; for (var i = 0; i < list.length; i++) fn(list[i], i); }
    function byId(id) { if (!id) return null; return root.querySelector('[id="' + String(id).replace(/["\\]/g, '') + '"]'); }
    function containerFor(slug) { return root.querySelector('[data-rbx-script="' + String(slug == null ? '' : slug).replace(/["\\]/g, '') + '"]'); }
    function _timeout(fn, ms) { if (!win) return null; var id = win.setTimeout(function () { if (!destroyed) fn(); }, ms); timeouts.push(id); return id; }
    function _interval(fn, ms) { if (!win) return null; var id = win.setInterval(fn, ms); intervals.push(id); return id; }
    // bumpRun invalidates any pending step callbacks for a container (used when a
    // sibling switches it off, or on stopAll) — the run-id guard makes stale
    // timers no-op instead of dispatching into a torn-down / switched scene.
    function bumpRun(c) { c.setAttribute('data-rbx-run', String((parseInt(c.getAttribute('data-rbx-run'), 10) || 0) + 1)); }

    // ensureRendered fills a container from its script data once, then wires its
    // own replay button.
    function ensureRendered(container, slug) {
      if (!container || container.getAttribute('data-rbx-rendered') === '1') return;
      var data = examples[slug];
      if (!data) return;
      container.innerHTML = buildScriptHtml(data);
      container.setAttribute('data-rbx-rendered', '1');
      var rep = container.querySelector('[data-rbx-replay]');
      if (rep) on(rep, 'click', function (e) { e.stopPropagation(); container.classList.add('rbx-on'); playContainer(container, slug); });
    }

    function setTok(stage, kind) {
      if (!stage) return;
      each(stage.querySelectorAll('.rbx-tok'), function (t) { t.classList.remove('rbx-act'); });
      var token = (kind === 'pc') ? 'pc' : (kind === 'dir' ? 'foe' : null);
      if (!token) return;
      var el = stage.querySelector('.rbx-tok.rbx-' + token);
      if (el) el.classList.add('rbx-act');
    }
    function resetScript(container) {
      each(container.querySelectorAll('.rbx-line'), function (l) { l.classList.remove('rbx-shown', 'rbx-now'); });
      each(container.querySelectorAll('.rbx-mstep,.rbx-tstamp'), function (m) { m.classList.remove('rbx-show'); });
      each(container.querySelectorAll('.rbx-die'), function (d) { d.textContent = '?'; d.classList.remove('rbx-hot'); });
      var stage = container.querySelector('.rbx-stage'); if (stage) stage.classList.remove('rbx-in');
    }

    // rollSeq ticks the dice through random faces, settles them on the scripted
    // values, then reveals the math steps + tier stamp one at a time.
    function rollSeq(lineEl, current, done) {
      var dice = lineEl.querySelectorAll('.rbx-die');
      var steps = lineEl.querySelectorAll('.rbx-mstep,.rbx-tstamp');
      var finals = (lineEl.getAttribute('data-rbx-dice') || '').split(',');
      each(dice, function (d) { d.classList.add('rbx-hot'); });
      var t = 0;
      var iv = _interval(function () {
        if (!current()) { win.clearInterval(iv); return; }
        each(dice, function (d) { d.textContent = 1 + Math.floor(Math.random() * 10); });
        if (++t >= DICE_TICKS) {
          win.clearInterval(iv);
          each(dice, function (d, k) { if (finals[k] != null && finals[k] !== '') d.textContent = finals[k]; });
          var s = 0;
          var iv2 = _interval(function () {
            if (!current()) { win.clearInterval(iv2); return; }
            if (s >= steps.length) { win.clearInterval(iv2); each(dice, function (d) { d.classList.remove('rbx-hot'); }); done(); return; }
            steps[s].classList.add('rbx-show'); s++;
          }, STEP_MS);
        }
      }, TICK_MS);
    }

    // playContainer resets then animates a rendered container. A fresh run-id per
    // play means a replay (or switch-away) cleanly supersedes the previous run.
    function playContainer(container, slug) {
      if (!container) return;
      ensureRendered(container, slug);
      var run = (parseInt(container.getAttribute('data-rbx-run'), 10) || 0) + 1;
      container.setAttribute('data-rbx-run', String(run));
      function current() { return !destroyed && parseInt(container.getAttribute('data-rbx-run'), 10) === run; }
      resetScript(container);
      var lines = container.querySelectorAll('.rbx-line');
      var stage = container.querySelector('.rbx-stage');

      if (prefersReduced()) {                       // instant, fully-readable reveal
        if (stage) stage.classList.add('rbx-in');
        each(lines, function (l) {
          l.classList.add('rbx-shown');
          var dvals = (l.getAttribute('data-rbx-dice') || '').split(',');
          each(l.querySelectorAll('.rbx-die'), function (d, k) { if (dvals[k] != null && dvals[k] !== '') d.textContent = dvals[k]; });
          each(l.querySelectorAll('.rbx-mstep,.rbx-tstamp'), function (m) { m.classList.add('rbx-show'); });
        });
        setTok(stage, null);
        return;
      }
      if (stage && win) { void stage.offsetWidth; _timeout(function () { if (current()) stage.classList.add('rbx-in'); }, STAGE_IN_MS); }
      var i = 0;
      (function step() {
        if (!current()) return;
        if (i > 0) lines[i - 1].classList.remove('rbx-now');
        if (i >= lines.length) { setTok(stage, null); return; }
        var l = lines[i];
        l.classList.add('rbx-shown', 'rbx-now');
        setTok(stage, l.getAttribute('data-rbx-kind'));
        i++;
        if (l.className.indexOf('rbx-rl') >= 0) rollSeq(l, current, function () { _timeout(function () { if (current()) step(); }, ROLL_AFTER_MS); });
        else _timeout(function () { if (current()) step(); }, LINE_MS);
      })();
    }

    // applyShowHide toggles a trigger's optional companion elements (Lair drill-in
    // reveals the part view + hides the overview; the back button reverses it).
    function applyShowHide(btn) {
      var hide = btn.getAttribute('data-rbx-hide'); if (hide) { var h = byId(hide); if (h) h.classList.add('rbx-hidden'); }
      var show = btn.getAttribute('data-rbx-show');
      if (show) {
        var sh = byId(show);
        if (sh) {
          sh.classList.remove('rbx-hidden');
          // The button just activated lived inside the now-hidden view, so its
          // removal would reset focus to <body>. Move focus into the shown view
          // (first focusable) to keep the keyboard user in place (a11y).
          var f = sh.querySelector('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');
          if (f && f.focus) { try { f.focus(); } catch (e) {} }
        }
      }
    }
    function handlePlay(btn) {
      var slug = btn.getAttribute('data-rbx-play');
      if (!examples[slug]) return;      // no script data -> stay inert (no empty box / half drill-in)
      applyShowHide(btn);
      var container = containerFor(slug);
      if (!container) return;
      var parent = container.parentNode;                 // switch sibling scripts off
      if (parent) each(parent.querySelectorAll('[data-rbx-script].rbx-on'), function (sib) { if (sib !== container) { sib.classList.remove('rbx-on'); bumpRun(sib); } });
      container.classList.add('rbx-on');
      playContainer(container, slug);
    }

    each(root.querySelectorAll('[data-rbx-play]'), function (btn) { on(btn, 'click', function (e) { e.stopPropagation(); handlePlay(btn); }); });
    each(root.querySelectorAll('[data-rbx-back]'), function (btn) { on(btn, 'click', function (e) { e.stopPropagation(); applyShowHide(btn); }); });

    function stopAll() {
      if (win) { for (var i = 0; i < timeouts.length; i++) win.clearTimeout(timeouts[i]); for (var j = 0; j < intervals.length; j++) win.clearInterval(intervals[j]); }
      timeouts = []; intervals = [];
      each(root.querySelectorAll('[data-rbx-script]'), function (c) { bumpRun(c); });
    }
    // _collapseNow removes the shown/played state from every script so a reopened
    // fold shows its clean default (mirrors the mockup's .script.on cleanup).
    function _collapseNow() {
      each(root.querySelectorAll('[data-rbx-script].rbx-on'), function (c) { c.classList.remove('rbx-on'); bumpRun(c); });
    }
    // collapseAll defers the collapse to after the fold-back (the mockup's 420ms)
    // so the panel doesn't blink away before the wing has folded shut.
    function collapseAll() {
      if (!win) { _collapseNow(); return; }
      var id = win.setTimeout(function () { if (!destroyed) _collapseNow(); }, 420);
      timeouts.push(id);
    }
    function destroy() {
      destroyed = true;
      stopAll();
      for (var i = 0; i < listeners.length; i++) { var L = listeners[i]; try { L.t.removeEventListener(L.type, L.fn, L.o); } catch (e) {} }
      listeners = [];
    }
    function play(slug) { if (!examples[slug]) return; var c = containerFor(slug); if (c) { c.classList.add('rbx-on'); playContainer(c, slug); } }

    return { destroy: destroy, play: play, stopAll: stopAll, collapseAll: collapseAll };
  }

  return {
    TICK_MS: TICK_MS, DICE_TICKS: DICE_TICKS, STEP_MS: STEP_MS,
    ROLL_AFTER_MS: ROLL_AFTER_MS, LINE_MS: LINE_MS,
    esc: esc, richText: richText,
    isRoll: isRoll, tokenForLine: tokenForLine, rollRevealOrder: rollRevealOrder,
    planScript: planScript, buildScriptHtml: buildScriptHtml,
    mount: mount
  };
})();

// Test seam: expose the module for Node unit tests. Inert in a browser (no
// CommonJS `module`); in the browser the `RulebookExamplePlayer` global is what
// widget scripts consume.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RulebookExamplePlayer;
}
