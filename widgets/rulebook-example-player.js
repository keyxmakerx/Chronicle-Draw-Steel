/**
 * Draw Steel Rulebook Example Player — the staged "at the table" player.
 *
 * Design contract: Cordinator mockups/rulebook-v10-table.html. A reusable,
 * CONTENT-AGNOSTIC ES5 module: it knows nothing about Might, the Power Roll,
 * or the Lich's Lair — only how to render + play a "script": tokens slide in
 * and glow on their line, lines light one by one, the ROLL line ticks dice
 * to scripted values and steps its math out with its why, and the tier
 * stamps on. ↻ replay is always available; under prefers-reduced-motion
 * everything reveals instantly.
 *
 * Scripts are DATA (data/rulebook-examples.json, ReferenceItem[]). The
 * consuming widget hands the player a { slug: scriptData } map and mounts it
 * on a root built with the data-attribute contract below; scripts render
 * lazily on first play.
 *
 * SPLIT ON PURPOSE (mirrors rulebook-fold-engine.js): PURE, DOM-free logic
 * unit-tested headless (tools/test-rulebook-example-player.mjs), and a DOM
 * controller mount(root, options) that wires triggers and animation timers.
 *
 * DOM CONTRACT (all queried within `root`; every hook optional):
 *   [data-rbx-play="slug"]     plays script `slug` into the nearest
 *                              [data-rbx-script="slug"]; optional
 *                              data-rbx-show/hide = element id to reveal/hide
 *                              first (the Lair drill-in).
 *   [data-rbx-script="slug"]   the container the script renders into; gains
 *                              `rbx-on` while shown.
 *   [data-rbx-replay]          replays a rendered script.
 *   [data-rbx-back]            reverses a play button's show/hide.
 *   [data-rbx-lair-table]      optional panel for the Lair's table (roster +
 *                              Stamina); absent, it renders with each part.
 *   [data-rbx-lair-rules]      optional panel for the playing part's rules
 *                              in play; absent, they render with each part.
 *
 * Loading: attaches the `RulebookExamplePlayer` global via the manifest
 * `text_renderers` section, loaded BEFORE widget scripts (same seam as
 * RulebookFoldEngine / MonsterEngine); exports the same object in Node.
 *
 * Text markup (authored, trusted repo data — escaped first, then promoted):
 *   **bold**  -> <b>            (numbers, ability names)
 *   ~~dmg~~   -> combat accent  (damage, prone, …)
 */
var RulebookExamplePlayer = (function () {
  'use strict';

  // Animation cadence (ms). v10.4 slows the mockup's original timings for a
  // calmer default pace (#732's six fixes) — back/pause/forward let a reader
  // set their own speed, so autoplay no longer needs to hurry.
  var TICK_MS = 90;         // dice-face tick interval
  var DICE_TICKS = 8;       // ticks before the dice settle on their scripted values
  var STEP_MS = 520;        // gap between math-step reveals
  var ROLL_AFTER_MS = 1100; // pause after a roll line before the next line
  var LINE_MS = 1450;       // dwell on a non-roll line before the next
  var STAGE_IN_MS = 60;     // delay before the stage tokens slide in

  // TERM_RE matches this repo's {@category term|label} cross-reference markup
  // (identical to reference-renderer.js / rulebook-frontpage.js's TERM_RE) —
  // used ONLY for the Lair's teaching-panel prose, since a played script's own
  // lines are worked examples, not rules prose, and stay plain richText.
  var TERM_RE = /\{@(\w+)\s+([^|}]+)(?:\|([^}]+))?\}/g;

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

  // richTerm is richText() plus glossary-term promotion, for the Lair's
  // teaching-panel prose only (lessons[].lede/after) — turns {@cat slug|disp}
  // into the SAME dotted .rb-hl term the fold engine's shared hover card
  // already binds (via bindTerms), so a rule word inside the teaching text
  // gets a hover/tap card exactly like one inside the front page.
  function richTerm(s) {
    return richText(s).replace(TERM_RE, function (m, cat, term, disp) {
      var slug = String(term).trim().replace(/[^a-z0-9-]/gi, '');
      var label = String(disp != null ? disp : term).trim();
      return '<span class="rb-hl" data-rb-term="' + escAttr(slug) + '" tabindex="0" ' +
        'aria-describedby="rb-hcard" aria-label="' + label.replace(/"/g, '&quot;') + ', glossary term">' + label + '</span>';
    });
  }

  // linesOf accepts a ReferenceItem or flat shape (mirrors buildScriptHtml).
  function linesOf(data) {
    var p = (data && (data.properties || data)) || {};
    return isArr(p.lines) ? p.lines : [];
  }

  // startMaliceOf reads a script's own starting Malice: the rest value shown
  // before anything plays, and what stepping all the way back returns to. 0
  // when the script has no Malice concept (most scripts aren't a solo boss).
  function startMaliceOf(data) {
    var p = (data && (data.properties || data)) || {};
    return typeof p.startMalice === 'number' ? p.startMalice : 0;
  }

  // startStaminaOf reads where a script's Stamina bars begin: { heroSlug:
  // percent }, e.g. a later part opening on the wounds an earlier one left.
  // Only finite numbers survive, clamped to 0-100; a hero it doesn't name
  // starts full. {} when the script has none.
  function startStaminaOf(data) {
    var p = (data && (data.properties || data)) || {};
    var src = p.startStamina, out = {};
    if (!src || typeof src !== 'object' || isArr(src)) return out;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k];
      if (typeof v === 'number' && isFinite(v)) out[k] = Math.max(0, Math.min(100, v));
    }
    return out;
  }

  // computeTableState folds every lines[]._effects from beat 0 through
  // uptoIndex (inclusive) into the Lair table/lesson state. Pure and
  // deterministic, so "stepping back puts the table back as it was" (#732) is
  // always a fresh, correct recompute rather than an incremental undo that can
  // drift. uptoIndex -1 means "nothing played yet" (every field at its rest
  // value) — malice rests at the script's own startMalice (0 when it has
  // none), not an unset null, since a solo boss's Malice pool exists before
  // its first spend; Stamina rests at the script's startStamina (full for
  // any hero it doesn't name).
  function computeTableState(lines, uptoIndex, startMalice, startStamina) {
    var stamina = {};
    if (startStamina && typeof startStamina === 'object') {
      for (var k in startStamina) if (Object.prototype.hasOwnProperty.call(startStamina, k)) stamina[k] = startStamina[k];
    }
    var st = {
      stamina: stamina, squadCount: null, squadFallen: 0, captainUp: null,
      malice: (typeof startMalice === 'number' ? startMalice : 0),
      victories: 0, tally: null
    };
    var list = lines || [];
    for (var i = 0; i <= uptoIndex && i < list.length; i++) {
      var fx = list[i] && list[i]._effects;
      if (!isArr(fx)) continue;
      for (var j = 0; j < fx.length; j++) {
        var e = fx[j] || {};
        if (e.type === 'stamina' && e.target) st.stamina[e.target] = e.pct;
        else if (e.type === 'squad') st.squadCount = e.count;
        else if (e.type === 'minion') st.squadFallen += (e.fallen || 0);
        else if (e.type === 'captain') st.captainUp = !!e.up;
        else if (e.type === 'malice') st.malice = e.value;
        else if (e.type === 'victories') st.victories += (e.value || 0);
        else if (e.type === 'tally') st.tally = { success: e.success || 0, failure: e.failure || 0 };
      }
    }
    return st;
  }

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
      '<div class="rbx-ctl">' +
        '<button class="rbx-cb" type="button" data-rbx-step-back aria-label="Back one beat">◀</button>' +
        '<button class="rbx-cb rbx-play" type="button" data-rbx-step-pause aria-label="Pause">⏸</button>' +
        '<button class="rbx-cb" type="button" data-rbx-step-fwd aria-label="Forward one beat">▶</button>' +
      '</div>' +
      '<button class="rbx-rep" type="button" data-rbx-replay aria-label="Replay this example">↻ replay</button></div>';

    var stageHtml = '<div class="rbx-stage">' +
      '<div class="rbx-tok rbx-pc"><span class="rbx-fig">' + esc(pc.fig) + '</span>' + esc(pc.label) + '</div>' +
      '<span class="rbx-vs">vs</span>' +
      '<div class="rbx-tok rbx-foe"><span class="rbx-fig">' + esc(foe.fig) + '</span>' + esc(foe.label) + '</div></div>';

    var body = '';
    for (var i = 0; i < lines.length; i++) body += buildLineHtml(lines[i]);

    return banner + stageHtml + body;
  }

  // buildLesson renders the teaching panel under a Lair part's script, shaped
  // by lesson.kind. Every field is SAMPLE text authored for this widget, not
  // Draw Steel rules text (CLAUDE.md) — the visible "sample" tag says so too.
  // The live counters (data-rbx-*) start at their rest value; playContainer
  // fills them in as the script plays. startMalice is the played script's own
  // rest value for the Malice counter (0 when it has none).
  function buildLesson(lesson, startMalice) {
    var l = lesson || {};
    var maliceRest = typeof startMalice === 'number' ? startMalice : 0;
    var body = '<p>' + richTerm(l.lede) + '</p>';
    if (l.kind === 'montage') {
      body += '<div class="rbx-tallyrow"><span class="rbx-tlbl">SUCCESSES</span>' +
        '<span class="rbx-pips" data-rbx-tally-success><span class="rbx-pipnone">none yet</span></span></div>' +
        '<div class="rbx-tallyrow"><span class="rbx-tlbl">FAILURES</span>' +
        '<span class="rbx-pips" data-rbx-tally-failure><span class="rbx-pipnone">none yet</span></span></div>';
      if (l.after) body += '<p>' + richTerm(l.after) + '</p>';
    } else if (l.kind === 'squad') {
      var sq = l.squad || {}; var cnt = sq.count || 0; var minions = '';
      for (var i = 0; i < cnt; i++) minions += '<span class="rbx-mn" data-rbx-minion="' + i + '">' + esc(sq.fig) + '</span>';
      body += '<div class="rbx-squadrow">' + minions + '</div>';
      var cap = l.captain || {};
      body += '<div class="rbx-captain" data-rbx-captain><span class="rbx-cfig">' + esc(cap.fig) + '</span>' +
        '<b>' + esc(cap.name) + '</b><span>' + richTerm(cap.note) + '</span></div>';
    } else if (l.kind === 'solo') {
      var spends = isArr(l.malice && l.malice.spends) ? l.malice.spends : [];
      body += '<div class="rbx-malicerow"><span class="rbx-tlbl">MALICE</span><b data-rbx-malice>' +
        esc(String(maliceRest)) + '</b></div>';
      var ledger = '';
      for (var j = 0; j < spends.length; j++) {
        var sp = spends[j] || {};
        ledger += '<div class="rbx-spend"><span class="rbx-cost">' + esc(sp.cost) + '</span> ' + esc(sp.buys) + '</div>';
      }
      body += '<div class="rbx-ledger">' + ledger + '</div>';
    } else if (l.kind === 'aftermath') {
      body += '<div class="rbx-vicrow"><span class="rbx-tlbl">VICTORIES</span><b data-rbx-victories>0</b></div>';
      if (l.after) body += '<p>' + richTerm(l.after) + '</p>';
    }
    return '<div class="rbx-lesson"><div class="rbx-lh">' + esc(l.title) +
      '<span class="rbx-tagsample">sample</span></div>' + body + '</div>';
  }

  // lairHeroes / lairRules read the worked scene's roster and one part's
  // rules-in-play chips, tolerating either being absent.
  function lairHeroes(lair) {
    var cfg = lair || {};
    return isArr(cfg.table && cfg.table.heroes) ? cfg.table.heroes : [];
  }
  function lairRules(lair, partKey) {
    var cfg = lair || {};
    return isArr(cfg.rulesInPlay && cfg.rulesInPlay[partKey]) ? cfg.rulesInPlay[partKey] : [];
  }

  // buildLairTable renders the table: the hero roster with a Stamina bar
  // each. The bars start full; playing a part paints its own state on them.
  function buildLairTable(lair) {
    var heroes = lairHeroes(lair);
    if (!heroes.length) return '';
    var heroRows = '';
    for (var i = 0; i < heroes.length; i++) {
      var h = heroes[i] || {};
      heroRows += '<div class="rbx-hero"><span class="rbx-hfig">' + esc(h.fig) + '</span>' +
        '<span class="rbx-hnm">' + esc(h.name) + '</span>' +
        '<span class="rbx-bar"><i data-rbx-hero="' + escAttr(h.slug) + '" style="width:100%"></i></span></div>';
    }
    return '<div class="rbx-table"><div class="rbx-tlbl">THE TABLE<span class="rbx-tagsample">sample</span></div>' +
      '<div class="rbx-heroes">' + heroRows + '</div></div>';
  }

  // buildLairRules renders one part's rules-in-play chips, each a glossary
  // term with a hover card. '' when the part names none.
  function buildLairRules(lair, partKey) {
    var rip = lairRules(lair, partKey);
    var chips = '';
    for (var c = 0; c < rip.length; c++) {
      var r = rip[c] || {};
      chips += '<span class="rb-chip" data-rb-term="' + escAttr(r.term) + '" tabindex="0" ' +
        'aria-describedby="rb-hcard">' + esc(r.label) + '</span>';
    }
    return chips ? '<div class="rbx-rip"><div class="rbx-tlbl">RULES IN PLAY</div>' +
      '<div class="rbx-chiprow">' + chips + '</div></div>' : '';
  }

  // buildLairExtras renders what sits with a Lair part's script: the table,
  // the rules-in-play chips and its teaching lesson. `lair` is { table,
  // rulesInPlay, lessons } from the worked-scene's ReferenceItem; `partKey`
  // is the part's own slug ("p1".."p4"). startMalice is the PLAYED SCRIPT's
  // own rest value (a different JSON file than `lair`), passed through so the
  // lesson's Malice counter starts right, not at 0. `omit` leaves out the
  // table and/or rules when the page gives them panels of their own.
  function buildLairExtras(partKey, lair, startMalice, omit) {
    var cfg = lair || {}, o = omit || {};
    var lesson = (cfg.lessons && cfg.lessons[partKey]) || null;
    return (o.table ? '' : buildLairTable(cfg)) +
      (o.rules ? '' : buildLairRules(cfg, partKey)) +
      (lesson ? buildLesson(lesson, startMalice) : '');
  }

  // ── pop-up scene: data shape and pure logic ───────────────────────────────
  // A script inside the Lair board may carry properties.scene: a paper
  // pop-up book built from the shared kit below. The scene is data only; the
  // widget never knows which part it is drawing. validateScene normalises it
  // (and reports what it had to drop), beatState says which pieces stand and
  // which motions they play at a beat, and resolveCard builds a card's text
  // from the package's own data files.

  var BEAT_MS = 2700;          // dwell on one beat before auto-advance
  var BOOK_DELAY_MS = 600;     // the closed book rests before it opens
  var FIRST_BEAT_MS = 2100;    // the book opens and its pieces stand up
  var CARD_OUT_MS = 300;       // a card slides or folds away
  var SHUT_MS = 640;           // the cover turns back when the board closes
  var SPREAD_W = 600, SPREAD_H = 250;   // the open book's page spread, in scene px

  // The motions a beat can cue on a piece; each is a class the stylesheet draws.
  var MOTIONS = ['step', 'wind', 'lunge', 'knock', 'fall', 'prone', 'cast', 'stagger', 'rise',
    'burst', 'trip', 'cheer', 'flare', 'fade', 'drop', 'glow', 'flee', 'shake'];
  // The wall at the back of the spread comes in these variants.
  var BACKDROPS = ['hall', 'gate', 'mouth', 'throne'];
  // Where a card's text may come from: one data file each, looked up by slug.
  var SOURCES = ['glossary', 'creature', 'role', 'frontpage', 'tier'];

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function clampN(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function isInt(n) { return isNum(n) && Math.floor(n) === n; }

  // parseRef splits a "source:slug" reference; null when it is not one.
  function parseRef(ref) {
    var m = /^([a-z]+):([a-z0-9-]+)$/.exec(String(ref == null ? '' : ref));
    if (!m || SOURCES.indexOf(m[1]) < 0) return null;
    return { kind: m[1], slug: m[2] };
  }

  // rollLineIndex is the first roll line of a script, -1 when it has none.
  function rollLineIndex(lines) {
    for (var i = 0; i < (lines || []).length; i++) if (isRoll(lines[i])) return i;
    return -1;
  }

  // rollFacts reads a roll line's numbers back out of the script itself:
  // the dice, their sum ("= **16**"), each modifier ("+2 **Might**"), the
  // why, the total ("→ **18**") and the tier. Nothing here is invented; a
  // step it cannot read is simply left out.
  function rollFacts(line) {
    var l = line || {}, steps = isArr(l.steps) ? l.steps : [];
    var dice = [], out = { dice: dice, sum: null, mods: [], why: '', total: null, tier: l.tier || '', tierNo: null };
    var d = isArr(l.dice) ? l.dice : [];
    for (var i = 0; i < d.length; i++) if (isNum(d[i])) dice.push(d[i]);
    for (var j = 0; j < steps.length; j++) {
      var t = String((steps[j] && steps[j].text) || '');
      var m;
      if (steps[j] && steps[j].why) { out.why = t; continue; }
      if ((m = /^=\s*\*\*(-?\d+)\*\*$/.exec(t))) out.sum = Number(m[1]);
      else if ((m = /^→\s*\*\*(-?\d+)\*\*$/.exec(t))) out.total = Number(m[1]);
      else if ((m = /^([+\-−]\s*\d+)\s+\*\*([^*]+)\*\*$/.exec(t))) out.mods.push({ name: m[2], value: m[1].replace(/\s+/g, '') });
    }
    var tm = /(\d+)/.exec(out.tier);
    if (tm) out.tierNo = Number(tm[1]);
    return out;
  }

  // KIT is the shared box of paper pieces every scene is built from: a
  // default size in scene px and a kind. 'fig' is a standing figure (it gets
  // a shadow at its hinge), 'prop' a standing prop, 'flat' lies on the page,
  // 'paper' is a paper tag drawn in HTML (dice, ribbon, flag).
  var KIT = {
    knight: { w: 110, h: 150, kind: 'fig' }, shield: { w: 110, h: 150, kind: 'fig' },
    mage: { w: 100, h: 150, kind: 'fig' }, archer: { w: 100, h: 146, kind: 'fig' },
    bugbear: { w: 130, h: 168, kind: 'fig' }, cultist: { w: 72, h: 124, kind: 'fig' },
    adept: { w: 86, h: 146, kind: 'fig' }, lich: { w: 116, h: 178, kind: 'fig' },
    'skeleton-archer': { w: 60, h: 110, kind: 'fig' }, door: { w: 124, h: 168, kind: 'prop' },
    brazier: { w: 70, h: 90, kind: 'prop' }, crown: { w: 54, h: 36, kind: 'prop' },
    stone: { w: 42, h: 26, kind: 'prop' }, glyphs: { w: 150, h: 126, kind: 'prop' },
    slash: { w: 100, h: 120, kind: 'prop' }, bolt: { w: 100, h: 120, kind: 'prop' },
    curse: { w: 110, h: 110, kind: 'prop' }, rubble: { w: 540, h: 40, kind: 'prop' },
    ledge: { w: 540, h: 40, kind: 'prop' }, rune: { w: 220, h: 150, kind: 'flat' },
    dice: { w: 80, h: 46, kind: 'paper' }, ribbon: { w: 190, h: 46, kind: 'paper' },
    flag: { w: 128, h: 44, kind: 'paper' }
  };

  // showRange normalises a piece's `show` ([from] or [from, to], beat
  // indexes, inclusive); null means the piece always stands.
  function showRange(show) {
    if (!isArr(show) || !show.length || !isInt(show[0]) || show[0] < 0) return null;
    var to = show.length > 1 && isInt(show[1]) ? show[1] : Infinity;
    return to < show[0] ? null : [show[0], to];
  }
  function isShown(range, index) {
    if (!range) return true;
    return index >= range[0] && index <= range[1];
  }

  // validateCardDef keeps the fields resolveCard reads, dropping (and
  // reporting) anything malformed.
  function validateCardDef(key, def, nLines, errors) {
    if (!def || typeof def !== 'object' || isArr(def)) { errors.push('card "' + key + '" is not an object'); return null; }
    var out = { kicker: typeof def.kicker === 'string' ? def.kicker : '', title: typeof def.title === 'string' ? def.title : '',
      sample: !!def.sample, roll: !!def.roll, stats: [], says: [], links: [], from: null, role: null, tiers: null };
    if (def.from != null) { if (parseRef(def.from)) out.from = def.from; else errors.push('card "' + key + '" has an unknown source "' + def.from + '"'); }
    if (def.role != null) { if (/^[a-z0-9-]+$/.test(String(def.role))) out.role = String(def.role); else errors.push('card "' + key + '" has a bad role'); }
    if (def.tiers != null) { if (/^[a-z0-9-]+$/.test(String(def.tiers))) out.tiers = String(def.tiers); else errors.push('card "' + key + '" has a bad tiers slug'); }
    var st = isArr(def.stats) ? def.stats : [];
    for (var i = 0; i < st.length; i++) {
      if (isArr(st[i]) && st[i].length === 2 && typeof st[i][0] === 'string' && typeof st[i][1] === 'string') out.stats.push([st[i][0], st[i][1]]);
      else errors.push('card "' + key + '" stat ' + i + ' is not a [label, value] pair');
    }
    var sy = isArr(def.says) ? def.says : [];
    for (var j = 0; j < sy.length; j++) {
      if (isInt(sy[j]) && sy[j] >= 0 && sy[j] < nLines) out.says.push(sy[j]);
      else errors.push('card "' + key + '" quotes line ' + sy[j] + ', which the script lacks');
    }
    var lk = isArr(def.links) ? def.links : [];
    for (var k = 0; k < lk.length; k++) {
      if (parseRef(lk[k])) out.links.push(lk[k]);
      else errors.push('card "' + key + '" links an unknown source "' + lk[k] + '"');
    }
    return out;
  }

  // validateScene normalises a script's scene against its own lines. It
  // returns { scene, errors }: scene is null when nothing drawable is left
  // (no known backdrop, no pieces or no beats), and the board then falls back
  // to the flat stage. Anything else malformed is dropped and reported.
  function validateScene(raw, lines) {
    var errors = [];
    if (!raw || typeof raw !== 'object' || isArr(raw)) return { scene: null, errors: ['no scene'] };
    var nLines = isArr(lines) ? lines.length : 0;
    var backdrop = BACKDROPS.indexOf(raw.backdrop) >= 0 ? raw.backdrop : null;
    if (!backdrop) errors.push('unknown backdrop "' + raw.backdrop + '"');

    var cards = {}, rawCards = (raw.cards && typeof raw.cards === 'object' && !isArr(raw.cards)) ? raw.cards : {};
    for (var ck in rawCards) {
      if (!Object.prototype.hasOwnProperty.call(rawCards, ck)) continue;
      var cd = validateCardDef(ck, rawCards[ck], nLines, errors);
      if (cd) cards[ck] = cd;
    }

    var pieces = [], ids = {}, list = isArr(raw.pieces) ? raw.pieces : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var id = String(p.id == null ? '' : p.id);
      if (!/^[a-z0-9-]+$/.test(id) || ids[id]) { errors.push('piece ' + i + ' needs a unique id'); continue; }
      var kit = KIT[p.kit];
      if (!kit) { errors.push('piece "' + id + '" uses an unknown kit "' + p.kit + '"'); continue; }
      if (!isNum(p.x) || !isNum(p.y)) { errors.push('piece "' + id + '" needs numeric x and y'); continue; }
      var piece = {
        id: id, kit: p.kit, kind: kit.kind,
        x: clampN(p.x, -100, SPREAD_W + 100), y: clampN(p.y, -200, SPREAD_H + 10),
        w: isNum(p.w) ? clampN(p.w, 10, SPREAD_W) : kit.w, h: isNum(p.h) ? clampN(p.h, 10, 400) : kit.h,
        face: p.face === -1 ? -1 : 1, flip: !!p.flip, show: showRange(p.show),
        text: typeof p.text === 'string' ? p.text : '', label: typeof p.label === 'string' ? p.label : '', card: null
      };
      if (p.show != null && !piece.show) errors.push('piece "' + id + '" has a malformed show range');
      if (p.card != null) {
        if (cards[p.card]) piece.card = String(p.card);
        else errors.push('piece "' + id + '" opens card "' + p.card + '", which the scene lacks');
      }
      if (piece.card && !piece.label) errors.push('piece "' + id + '" opens a card but has no label');
      ids[id] = true;
      pieces.push(piece);
    }

    var beats = [], rawBeats = raw.beats;
    if (rawBeats == null) {
      for (var b0 = 0; b0 < nLines; b0++) beats.push({ line: b0, tier: false, cues: [] });
    } else if (!isArr(rawBeats)) {
      errors.push('beats is not a list');
    } else {
      var last = -1;
      for (var b = 0; b < rawBeats.length; b++) {
        var rb = rawBeats[b] || {};
        if (!isInt(rb.line) || rb.line < 0 || rb.line >= nLines) { errors.push('beat ' + b + ' names line ' + rb.line + ', which the script lacks'); continue; }
        if (rb.line < last) { errors.push('beat ' + b + ' steps back to an earlier line'); continue; }
        last = rb.line;
        var cues = [], rc = isArr(rb.cues) ? rb.cues : [];
        for (var c = 0; c < rc.length; c++) {
          var cue = rc[c] || {};
          if (!ids[cue.who]) { errors.push('beat ' + b + ' cues an unknown piece "' + cue.who + '"'); continue; }
          if (MOTIONS.indexOf(cue['do']) < 0) { errors.push('beat ' + b + ' cues an unknown motion "' + cue['do'] + '"'); continue; }
          cues.push({ who: cue.who, motion: cue['do'], hold: !!cue.hold });
        }
        beats.push({ line: rb.line, tier: !!rb.tier, cues: cues });
      }
    }
    if (!pieces.length) errors.push('no pieces');
    if (!beats.length) errors.push('no beats');
    var ok = !!backdrop && pieces.length > 0 && beats.length > 0;
    return { scene: ok ? { backdrop: backdrop, pieces: pieces, beats: beats, cards: cards } : null, errors: errors };
  }

  // beatState says, for beat `index` (-1 before the first), which pieces
  // stand and which motion classes each plays: every held cue from the beats
  // before, plus every cue of this beat. Pure, so stepping back is always a
  // fresh recompute rather than an undo.
  function beatState(scene, index) {
    var up = {}, motions = {}, s = scene || {}, pieces = s.pieces || [], beats = s.beats || [];
    for (var i = 0; i < pieces.length; i++) { up[pieces[i].id] = isShown(pieces[i].show, index); motions[pieces[i].id] = []; }
    for (var b = 0; b <= index && b < beats.length; b++) {
      var cues = beats[b].cues || [];
      for (var c = 0; c < cues.length; c++) {
        var cue = cues[c], m = motions[cue.who];
        if (!m || (b < index && !cue.hold)) continue;
        if (m.indexOf(cue.motion) < 0) m.push(cue.motion);
      }
    }
    return { up: up, motions: motions };
  }

  // showTierFor: a roll line's tier stamp shows on its own beat, unless a
  // later beat of the same line is the one that pops the tier.
  function showTierFor(beats, index) {
    var b = beats && beats[index];
    if (!b) return false;
    if (b.tier) return true;
    for (var i = 0; i < beats.length; i++) if (beats[i].line === b.line && beats[i].tier) return false;
    return true;
  }

  // ── pop-up scene: card text, all of it from the package's data ──────────

  // buildRefs indexes the data files a card may quote, by slug: the
  // glossary, creatures, role templates and the front page's own blocks.
  function buildRefs(src) {
    var s = src || {}, out = { glossary: {}, creature: {}, role: {}, frontpage: {} };
    function index(list, into) {
      var l = isArr(list) ? list : [];
      for (var i = 0; i < l.length; i++) if (l[i] && l[i].slug) into[l[i].slug] = l[i];
    }
    index(s.glossary, out.glossary); index(s.creatures, out.creature);
    index(s.roles, out.role); index(s.frontpage, out.frontpage);
    return out;
  }

  function kwButton(ref, labelHtml) {
    return '<button type="button" class="rbs-kw" data-rbs-kw="' + escAttr(ref) + '">' + labelHtml + '</button>';
  }

  // termHtml is richText() plus {@cat slug|label} turned into a keyword
  // button when the glossary has that slug, plain text when it does not.
  function termHtml(s, refs) {
    var g = (refs && refs.glossary) || {};
    return richText(s).replace(TERM_RE, function (m, cat, term, disp) {
      var slug = String(term).trim();
      var label = String(disp != null ? disp : term).trim();
      return g[slug] ? kwButton('glossary:' + slug, label) : label;
    });
  }

  // A seal glyph per kind of keyword card (decorative; aria-hidden).
  var SEALS = { movement: '➡', combat: '⚔', condition: '✺', resource: '◈', action: '⚄', duration: '⧗', keyword: '✧' };

  // mentions lists the glossary entries a text names outright (a whole-word
  // match on the entry's own name), so a keyword card can open the next one
  // from the data alone. At most four, never the entry itself. Names under
  // five letters are skipped: "pull it off" is not the Pull rule.
  function mentions(text, R, self) {
    var g = (R && R.glossary) || {}, out = [], t = ' ' + String(text || '').toLowerCase() + ' ';
    for (var slug in g) {
      if (!Object.prototype.hasOwnProperty.call(g, slug) || slug === self || out.length >= 4) continue;
      var name = String(g[slug].name || '').toLowerCase();
      if (name.length < 5) continue;
      var at = t.indexOf(name);
      while (at >= 0) {
        if (!/[a-z0-9]/.test(t.charAt(at - 1)) && !/[a-z0-9]/.test(t.charAt(at + name.length))) { out.push({ ref: 'glossary:' + slug, label: g[slug].name }); break; }
        at = t.indexOf(name, at + 1);
      }
    }
    return out;
  }

  // resolveKeyword builds the second, dark card a keyword button opens.
  // null when the data has no such entry, so the button stays inert-free:
  // keyword buttons are only rendered for refs that resolve.
  function resolveKeyword(ref, refs) {
    var r = parseRef(ref), R = refs || {};
    if (!r) return null;
    if (r.kind === 'glossary') {
      var g = (R.glossary || {})[r.slug];
      if (!g) return null;
      var cat = String((g.properties && g.properties.category) || 'keyword');
      var gt = g.description || g.summary || '';
      return { kicker: cat.toUpperCase(), seal: SEALS[cat] || '✧', title: g.name, body: [termHtml(gt, R)], links: mentions(gt, R, r.slug) };
    }
    if (r.kind === 'role') {
      var ro = (R.role || {})[r.slug];
      if (!ro) return null;
      return { kicker: 'ROLE', seal: '✊', title: ro.name, body: [termHtml(ro.description || ro.summary || '', R)], links: mentions(ro.description, R, null) };
    }
    if (r.kind === 'creature') {
      var c = (R.creature || {})[r.slug], tr = c && c.properties && c.properties.traits_display;
      if (!tr) return null;
      return { kicker: 'TRAIT', seal: '☠', title: String(c.properties.keywords || c.name), body: [termHtml(tr, R)], links: mentions(tr, R, null) };
    }
    if (r.kind === 'frontpage') {
      var f = (R.frontpage || {})[r.slug];
      if (!f) return null;
      return { kicker: 'RULE', seal: '✧', title: f.name, body: [termHtml(f.description || '', R)], links: mentions(f.description, R, null) };
    }
    return null;
  }

  // creatureStats lists a creature entry's own numbers, each role,
  // organization or keyword linking its card when the data has one.
  function creatureStats(c, R) {
    var p = c.properties || {}, out = [];
    function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
    if (p.level != null) out.push({ k: 'Level', v: String(p.level) });
    if (p.role) out.push({ k: 'Role', v: String(p.role), kw: (R.role || {})[lower(p.role)] ? 'role:' + lower(p.role) : null });
    if (p.organization) out.push({ k: 'Organization', v: String(p.organization), kw: (R.glossary || {})[lower(p.organization)] ? 'glossary:' + lower(p.organization) : null });
    if (p.keywords) out.push({ k: 'Keywords', v: String(p.keywords), kw: p.traits_display ? 'creature:' + c.slug : null });
    if (p.stamina != null) out.push({ k: 'Stamina', v: String(p.stamina) });
    if (p.speed != null) out.push({ k: 'Speed', v: String(p.speed) });
    return out;
  }

  // heroTiers reads a front-page hero block's tier bands, marking the one a
  // roll landed in.
  function heroTiers(R, slug, tierNo) {
    var h = (R.frontpage || {})[slug], t = h && h.properties && isArr(h.properties.tiers) ? h.properties.tiers : null;
    if (!t || !t.length) return null;
    return { list: t, on: isNum(tierNo) ? tierNo - 1 : -1 };
  }

  // resolveCard builds a piece's paper card. Rules wording comes only from
  // the data files (def.from); the script supplies its own lines (def.says)
  // and roll numbers (def.roll); def.stats are the script's sample numbers
  // and mark the card SAMPLE. Returns null when nothing is left to show.
  function resolveCard(def, ctx) {
    if (!def) return null;
    var c = ctx || {}, R = c.refs || {}, lines = c.lines || [];
    var ri = rollLineIndex(lines), facts = ri >= 0 ? rollFacts(lines[ri]) : null;
    var m = { kicker: def.kicker || '', title: '', sample: !!def.sample, stats: [], body: [], tiers: null, links: [] };
    var i;
    for (i = 0; i < (def.stats || []).length; i++) { m.stats.push({ k: def.stats[i][0], v: def.stats[i][1] }); m.sample = true; }
    var src = parseRef(def.from);
    if (src && src.kind === 'glossary' && R.glossary && R.glossary[src.slug]) {
      var g = R.glossary[src.slug];
      m.title = g.name; m.body.push(termHtml(g.description || g.summary || '', R));
    } else if (src && src.kind === 'creature' && R.creature && R.creature[src.slug]) {
      var cr = R.creature[src.slug];
      m.title = cr.name; m.stats = m.stats.concat(creatureStats(cr, R)); m.body.push(termHtml(cr.description || '', R));
    } else if (src && src.kind === 'role' && R.role && R.role[src.slug]) {
      var ro = R.role[src.slug];
      m.title = ro.name; m.body.push(termHtml(ro.description || '', R));
    } else if (src && src.kind === 'frontpage' && R.frontpage && R.frontpage[src.slug]) {
      var f = R.frontpage[src.slug];
      m.title = f.name; m.body.push(termHtml(f.description || '', R));
    } else if (src && src.kind === 'tier' && R.frontpage && R.frontpage[src.slug]) {
      var hero = R.frontpage[src.slug];
      m.tiers = heroTiers(R, src.slug, facts && facts.tierNo);
      var band = m.tiers && m.tiers.on >= 0 ? m.tiers.list[m.tiers.on] : null;
      m.title = band ? String(band.note || '') : hero.name;
      m.body.push(termHtml(hero.description || '', R));
    }
    if (def.roll && facts) {
      m.sample = true;
      var dice = facts.dice.join(' + ') + (facts.sum != null ? ' = ' + facts.sum : '');
      if (dice) m.stats.push({ k: 'Dice', v: dice });
      for (i = 0; i < facts.mods.length; i++) m.stats.push({ k: facts.mods[i].name, v: facts.mods[i].value });
      if (facts.total != null) m.stats.push({ k: 'Total', v: String(facts.total) });
    }
    if (def.tiers && !m.tiers) m.tiers = heroTiers(R, def.tiers, facts && facts.tierNo);
    if (def.role) {
      var rr = (R.role || {})[def.role];
      m.stats.push({ k: 'Role', v: rr ? rr.name : def.role, kw: rr ? 'role:' + def.role : null });
    }
    for (i = 0; i < (def.says || []).length; i++) {
      var ln = lines[def.says[i]] || {};
      m.body.push('<span class="rbs-say"><b>' + esc(ln.speaker) + '</b> ' + termHtml(isRoll(ln) ? '' : ln.text, R) + '</span>');
    }
    for (i = 0; i < (def.links || []).length; i++) {
      var k = resolveKeyword(def.links[i], R);
      if (k) m.links.push({ ref: def.links[i], label: k.title });
    }
    if (def.title) m.title = def.title;
    if (!m.title && !m.body.length) return null;
    return m;
  }

  // buildCardHtml renders a card model: 'paper' is the bone-white card a
  // piece slides up, 'seal' the dark keyword card that folds out of it.
  function buildCardHtml(model, kind) {
    var m = model || {}, seal = kind === 'seal';
    var stats = '';
    for (var i = 0; i < (m.stats || []).length; i++) {
      var s = m.stats[i];
      stats += '<dt>' + esc(String(s.k).toUpperCase()) + '</dt><dd>' + (s.kw ? kwButton(s.kw, esc(s.v)) : esc(s.v)) + '</dd>';
    }
    var tiers = '';
    if (m.tiers) {
      for (var t = 0; t < m.tiers.list.length; t++) {
        var band = m.tiers.list[t] || {};
        tiers += '<span' + (t === m.tiers.on ? ' class="rbs-on"' : '') + '>' + esc(band.label) + ' · Tier ' + (t + 1) + '</span>';
      }
      tiers = '<div class="rbs-tiers">' + tiers + '</div>';
    }
    var links = '';
    for (var l = 0; l < (m.links || []).length; l++) links += kwButton(m.links[l].ref, esc(m.links[l].label));
    var body = '';
    for (var b = 0; b < (m.body || []).length; b++) body += '<p>' + m.body[b] + '</p>';
    return '<div class="' + (seal ? 'rbs-kcard' : 'rbs-pcard') + '" role="dialog" aria-label="' + escAttr(m.title) + '">' +
      (seal ? '<span class="rbs-seal" aria-hidden="true">' + esc(m.seal) + '</span>' : '') +
      '<div class="rbs-kick">' + esc(m.kicker) + (m.sample ? '<span class="rbs-sample">SAMPLE</span>' : '') + '</div>' +
      '<h3 class="rbs-ctitle">' + esc(m.title) + '</h3>' +
      (stats ? '<dl class="rbs-stats">' + stats + '</dl>' : '') + tiers +
      '<div class="rbs-cbody">' + body + '</div>' +
      (links ? '<div class="rbs-links"><span class="rbs-ll">RULES</span>' + links + '</div>' : '') +
      '<button class="rbs-cx" type="button" aria-label="Close ' + escAttr(m.title) + '">✕</button></div>';
  }

  // captionHtml renders one beat's caption: a line's text, or a roll's dice
  // and steps (and its tier stamp when this beat shows it).
  function captionHtml(line, showTier, refs) {
    var l = line || {};
    if (!isRoll(l)) return termHtml(l.text, refs);
    var dice = isArr(l.dice) ? l.dice : [], parts = [];
    if (dice.length) parts.push('<b>' + esc(dice.join(' + ')) + '</b>');
    var steps = isArr(l.steps) ? l.steps : [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i] || {};
      parts.push(s.why ? '<span class="rbs-why">' + richText(s.text) + '</span>' : richText(s.text));
    }
    if (showTier && l.tier) parts.push('<span class="rbs-tstamp">' + esc(l.tier) + '</span>');
    return parts.join(' ');
  }

  // ── pop-up scene: the paper kit's art ───────────────────────────────────
  // Every piece is inline SVG in one visual language: flat paper colours, a
  // dark ink line, bone and grey-green stone, ghost-fire green, and the
  // shared die-cut white edge (#rbs-cut, defined once per page by the board).
  var INK = '#1a1420';
  function svgArt(vb, inner, extra) {
    return '<svg class="rbs-art" viewBox="' + vb + '"' + (extra || '') + ' aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  // A small bone skull, centred on (x, y) at scale k; eyes glow when `eyes`.
  function skull(x, y, k, eyes) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')" fill="#e9e4d4" stroke="' + INK + '" stroke-width="1.6">' +
      '<path d="M-10 0a10 10 0 0 1 20 0v6l-4 3v5h-12v-5l-4-3z"/>' +
      (eyes ? '<circle cx="-4" cy="2" r="2.6" fill="#3fd68a" stroke="none"/><circle cx="4" cy="2" r="2.6" fill="#3fd68a" stroke="none"/>' : '') + '</g>';
  }
  function torch(x) {
    return '<g><rect x="' + (x - 3.5) + '" y="62" width="7" height="24" fill="#3a3440" stroke="' + INK + '" stroke-width="2"/>' +
      '<path class="rbs-torch" d="M' + x + ' 64c-9-8-4-18 0-27 4 9 9 19 0 27z" fill="#5ef0a0" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<path class="rbs-torch" d="M' + x + ' 63c-4-4-2-9 0-13 2 4 4 9 0 13z" fill="#d7ffe8"/></g>';
  }

  // artWall is the stone wall at the back of the spread: three arches,
  // pillars, a skull banner, skull niches, chains and two ghost-fire torches.
  // `hall` and `throne` glow green inside their arches; `gate` and `mouth`
  // are dark, the centre arch left for a door or a ward to stand in.
  function artWall(variant) {
    var side = (variant === 'gate' || variant === 'mouth') ? 'url(#rbs-dark)' : 'url(#rbs-glow)';
    var extra = '';
    if (variant === 'throne') {
      extra = '<path d="M232 210v-74l8-30h40l8 30v74z" fill="#2c2240" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<path d="M224 210v-36h72v36" fill="#3a2d52" stroke="' + INK + '" stroke-width="2.5"/>' + skull(260, 122, 0.9, true);
    } else if (variant === 'mouth') {
      extra = '<g fill="none" stroke="#3fd68a" stroke-width="2" opacity=".85"><circle cx="214" cy="104" r="5"/><circle cx="306" cy="104" r="5"/>' +
        '<path d="M222 70l6 8-6 8M298 70l-6 8 6 8M252 50h16M260 44v12"/></g>';
    }
    return svgArt('0 0 520 210',
      '<path d="M0 210V44L22 34V8L60 0H460L498 8V34L520 44V210Z" fill="url(#rbs-stone)" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<path d="M40 20l14 10-6 14M470 30l-10 12 4 10M140 18l-8 12" stroke="#4f5952" stroke-width="1.6" fill="none"/>' +
      '<g stroke="' + INK + '" stroke-width="2.5"><path d="M66 210V122A46 46 0 0 1 158 122V210Z" fill="' + side + '"/>' +
        '<path d="M202 210V98A58 58 0 0 1 318 98V210Z" fill="' + side + '"/>' +
        '<path d="M362 210V122A46 46 0 0 1 454 122V210Z" fill="' + side + '"/></g>' + extra +
      '<g fill="#c9cdbf" stroke="' + INK + '" stroke-width="2.2"><rect x="168" y="36" width="26" height="174"/><rect x="326" y="36" width="26" height="174"/>' +
        '<rect x="161" y="27" width="40" height="12"/><rect x="319" y="27" width="40" height="12"/><rect x="161" y="198" width="40" height="12"/><rect x="319" y="198" width="40" height="12"/></g>' +
      '<g stroke="#8a907f" stroke-width="1.2"><path d="M174 50v140M188 50v140M332 50v140M346 50v140"/></g>' +
      '<path d="M238 14h44v70l-22-12-22 12Z" fill="#4b2a6b" stroke="' + INK + '" stroke-width="2.5"/>' + skull(260, 38, 1, true) +
      skull(112, 90, 0.6, false) + skull(408, 90, 0.6, false) +
      '<g stroke="#3a3440" stroke-width="2.4" fill="none" stroke-dasharray="5 3"><path d="M30 46q10 40 0 80M490 46q-10 40 0 80"/></g>' +
      torch(89.5) + torch(430.5), ' preserveAspectRatio="none"');
  }

  // The heroes. Each figure's swinging limb is a .rbs-arm group, which the
  // wind / lunge / cast motions turn.
  var S = ' stroke="' + INK + '" stroke-width="2.5"';
  var ART = {
    knight: function () {
      return svgArt('0 0 110 150',
        '<path d="M30 60q-12 40-4 86h22l2-40z" fill="#7a2230"' + S + '/><path d="M30 80q-4 30 0 60" stroke="#5a1822" stroke-width="2" fill="none"/>' +
        '<path d="M38 148l6-46h22l6 46h-12l-5-30-5 30z" fill="#4f4a44"' + S + '/><path d="M38 148h12M60 148h12" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M30 104l6-48c2-8 34-8 38 0l6 48z" fill="#a3abb4"' + S + '/>' +
        '<path d="M36 70h38M35 82h40M34 94h42" stroke="#6f7782" stroke-width="1.6"/><path d="M55 58v46" stroke="#6f7782" stroke-width="1.4"/>' +
        '<path d="M33 102h44" stroke="#5a3e2a" stroke-width="5"/><rect x="51" y="99" width="8" height="6" fill="#c9a24a" stroke="' + INK + '" stroke-width="1"/>' +
        '<path d="M40 56c-2-22 32-22 30 0z" fill="#c3cad1"' + S + '/><path d="M44 44h22" stroke="' + INK + '" stroke-width="3"/><path d="M55 30v12" stroke="#8a929b" stroke-width="2"/>' +
        '<path d="M55 22c-6-8 0-14 8-12" stroke="#7a2230" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<path d="M16 64h28v34c0 11-28 11-28 0z" fill="#7a2230"' + S + '/><path d="M30 68v30M20 80h20" stroke="#c9a24a" stroke-width="3"/>' +
        '<g class="rbs-arm"><path d="M70 66l22-30" stroke="' + INK + '" stroke-width="10" stroke-linecap="round"/><path d="M70 66l22-30" stroke="#a3abb4" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="M88 44l16-40" stroke="#4a3322" stroke-width="5" stroke-linecap="round"/><path d="M92 34l3-8M96 24l3-8" stroke="#c9a24a" stroke-width="2"/>' +
          '<path d="M92 2l22 7-7 21-22-7z" fill="#8a929b"' + S + '/><path d="M96 8l12 4" stroke="#c3cad1" stroke-width="2"/></g>');
    },
    shield: function () {
      return svgArt('0 0 110 150',
        '<path d="M40 148l5-44h20l5 44h-12l-3-28-4 28z" fill="#3e4a5a"' + S + '/><path d="M40 148h12M58 148h12" stroke="' + INK + '" stroke-width="4"/>' +
        '<path d="M30 106l6-50c3-9 36-9 40 0l6 50z" fill="#6f7f95"' + S + '/><path d="M36 72h40M35 86h42" stroke="#4f5c70" stroke-width="1.6"/>' +
        '<path d="M32 104h46" stroke="#5a3e2a" stroke-width="5"/>' +
        '<path d="M38 58c-2-26 38-26 36 0z" fill="#8a96a8"' + S + '/><path d="M44 46h24" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M56 32c4-10 14-12 18-6" stroke="#c9a24a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<g class="rbs-arm"><path d="M72 66l18-26" stroke="' + INK + '" stroke-width="10" stroke-linecap="round"/><path d="M72 66l18-26" stroke="#6f7f95" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="M88 42l8-22" stroke="#4a3322" stroke-width="5" stroke-linecap="round"/><circle cx="98" cy="14" r="9" fill="#8a929b"' + S + '/>' +
          '<path d="M98 1v-4M110 14h4M86 14h-4M98 27v3" stroke="' + INK + '" stroke-width="3"/></g>' +
        '<path d="M6 60h44v52c0 18-22 32-22 32S6 130 6 112z" fill="#2d4a7a"' + S + '/>' +
        '<path d="M28 64v74M10 86h36" stroke="#c9a24a" stroke-width="3"/><circle cx="28" cy="86" r="6" fill="#c9a24a" stroke="' + INK + '" stroke-width="2"/>');
    },
    mage: function () {
      return svgArt('0 0 100 150',
        '<path d="M22 148l12-82c4-12 30-12 34 0l12 82z" fill="#2f6f73"' + S + '/><path d="M51 70v76" stroke="#24585b" stroke-width="2"/>' +
        '<path d="M32 98h38" stroke="#c9a24a" stroke-width="4"/><path d="M28 146h46" stroke="#24585b" stroke-width="3"/>' +
        '<path d="M34 64c-6-30 40-34 34 0l-2 10h-30z" fill="#5a3e2a"' + S + '/>' +
        '<path d="M41 56c0-14 22-14 22 0 0 8-5 12-11 12s-11-4-11-12z" fill="#e8c9a8" stroke="' + INK + '" stroke-width="2"/>' +
        '<path d="M46 56h3M56 56h3" stroke="' + INK + '" stroke-width="2.4"/>' +
        '<path d="M18 92l14-14 6 8-14 14z" fill="#c9b27a" stroke="' + INK + '" stroke-width="2"/>' +
        '<g class="rbs-arm"><path d="M66 76l14-16" stroke="' + INK + '" stroke-width="9" stroke-linecap="round"/><path d="M66 76l14-16" stroke="#2f6f73" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M80 74l6-66" stroke="#5a3e2a" stroke-width="4" stroke-linecap="round"/><circle cx="86" cy="8" r="7" fill="#3fd68a" stroke="' + INK + '" stroke-width="2"/>' +
          '<circle cx="84" cy="6" r="2.4" fill="#d7ffe8"/></g>');
    },
    archer: function () {
      return svgArt('0 0 100 146',
        '<path d="M38 144l4-40h16l4 40h-10l-3-26-3 26z" fill="#4a3a2a"' + S + '/>' +
        '<path d="M26 108l8-48c4-10 30-10 34 0l8 48z" fill="#3d6b3f"' + S + '/><path d="M30 98h42" stroke="#5a3e2a" stroke-width="4"/>' +
        '<path d="M22 70l8-12 6 44z" fill="#2e5530" stroke="' + INK + '" stroke-width="2"/><path d="M24 64l-6-22M28 62l-2-24" stroke="#c9a24a" stroke-width="2.4"/>' +
        '<path d="M34 62c-6-28 38-32 32 0l-4 6h-24z" fill="#2e5530"' + S + '/>' +
        '<path d="M41 56c0-12 18-12 18 0 0 7-4 10-9 10s-9-3-9-10z" fill="#d9b48f" stroke="' + INK + '" stroke-width="2"/>' +
        '<g class="rbs-arm"><path d="M64 72l18-8" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/><path d="M64 72l18-8" stroke="#3d6b3f" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M84 26q18 38 0 78" stroke="#5a3e2a" stroke-width="4" fill="none"/><path d="M84 26v78" stroke="#c9cdbf" stroke-width="1"/></g>');
    },
    // The foes: a bugbear, hooded cultists, their adept, skeleton archers and the lich.
    bugbear: function () {
      return svgArt('0 0 130 168',
        '<path d="M40 166l4-44h16l2 44zM70 166l2-44h16l4 44z" fill="#4a3424"' + S + '/>' +
        '<path d="M26 126c-6-46 8-80 40-82 34 2 46 36 40 82z" fill="#6b4a32"' + S + '/>' +
        '<path d="M38 70l4 8M50 64l2 9M80 64l-2 9M92 70l-4 8M34 100l5 6M96 100l-5 6M60 92l2 8M72 92l-2 8" stroke="#3e2a1c" stroke-width="2"/>' +
        '<path d="M28 118h76" stroke="#2a1d14" stroke-width="7"/>' + skull(66, 118, 0.6, false) +
        '<path d="M44 48c-4-30 46-30 42 0-4 12-38 12-42 0z" fill="#7d5638"' + S + '/>' +
        '<path d="M42 30l-12-16 18 6zM88 30l12-16-18 6z" fill="#7d5638" stroke="' + INK + '" stroke-width="2"/>' +
        '<path d="M52 34l8 3M78 34l-8 3" stroke="' + INK + '" stroke-width="2.4"/>' +
        '<circle cx="57" cy="39" r="3" fill="#f0e05a"/><circle cx="73" cy="39" r="3" fill="#f0e05a"/>' +
        '<path d="M54 51l4-5 4 5 4-5 4 5 4-5" stroke="#e9e4d4" stroke-width="2" fill="none"/>' +
        '<g><path d="M30 86l-22 20" stroke="' + INK + '" stroke-width="12" stroke-linecap="round"/><path d="M30 86l-22 20" stroke="#6b4a32" stroke-width="8" stroke-linecap="round"/>' +
          '<path d="M8 108l-6 50" stroke="#3e2a1c" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M-6 152c-6-12 6-26 16-18 7 7-2 25-16 18z" fill="#3e2a1c" stroke="' + INK + '" stroke-width="2"/>' +
          '<path d="M-4 140l-6-3M8 136l5-5M-6 150l-7 2M6 152l5 5" stroke="#8a929b" stroke-width="2.4"/></g>');
    },
    cultist: function () {
      return svgArt('0 0 72 124',
        '<path d="M8 122l12-72c4-14 30-14 34 0l12 72z" fill="#5a1f2e"' + S + '/><path d="M37 56v64" stroke="#43151f" stroke-width="2"/>' +
        '<path d="M18 86h38" stroke="#c9a24a" stroke-width="3"/><circle cx="37" cy="70" r="5" fill="none" stroke="#c9a24a" stroke-width="2"/>' +
        '<path d="M18 50c-4-34 42-38 38 0l-4 8h-30z" fill="#4a1826"' + S + '/>' +
        '<path d="M27 44c0-12 20-12 20 0v8h-20z" fill="' + INK + '"/><circle cx="32" cy="46" r="2" fill="#c9a0ff"/><circle cx="42" cy="46" r="2" fill="#c9a0ff"/>' +
        '<g class="rbs-arm"><path d="M54 62l12 14" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/><path d="M54 62l12 14" stroke="#5a1f2e" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M64 76l6-16" stroke="#c3cad1" stroke-width="3.4" stroke-linecap="round"/></g>');
    },
    adept: function () {
      return svgArt('0 0 86 146',
        '<path d="M10 144l14-80c4-14 34-14 38 0l14 80z" fill="#3a2152"' + S + '/><path d="M43 70v72" stroke="#3fd68a" stroke-width="2.4"/>' +
        '<path d="M14 140h58" stroke="#3fd68a" stroke-width="2.4"/><path d="M24 98h38" stroke="#c9a24a" stroke-width="3"/>' +
        '<path d="M20 66L43 6l23 60-6 8H26z" fill="#2c1840"' + S + '/>' +
        '<path d="M33 56c0-12 20-12 20 0v8H33z" fill="' + INK + '"/><circle cx="38" cy="58" r="2.2" fill="#3fd68a"/><circle cx="48" cy="58" r="2.2" fill="#3fd68a"/>' +
        '<g class="rbs-arm"><path d="M64 80l12-12" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/><path d="M64 80l12-12" stroke="#3a2152" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M78 84l4-70" stroke="#5a3e2a" stroke-width="4" stroke-linecap="round"/></g>' + skull(82, 12, 0.6, true));
    },
    lich: function () {
      return svgArt('0 0 116 178',
        '<ellipse cx="58" cy="96" rx="54" ry="80" fill="#3fd68a" opacity=".16"/>' +
        '<path d="M14 176l18-104c6-18 46-18 52 0l18 104z" fill="#2c2240"' + S + '/>' +
        '<path d="M58 80v94M22 172h72" stroke="#3fd68a" stroke-width="2.4"/><path d="M30 120h56" stroke="#4b2a6b" stroke-width="5"/>' +
        '<path d="M26 82l-14 26M90 82l14 22" stroke="#e9e4d4" stroke-width="3"/>' +
        '<path d="M28 72c-4-16 60-16 60 0l-8 8H36z" fill="#4b2a6b"' + S + '/>' +
        '<path d="M42 52c0-24 32-24 32 0v8l-5 4v7H47v-7l-5-4z" fill="#e9e4d4"' + S + '/>' +
        '<circle cx="51" cy="52" r="4" fill="#3fd68a"/><circle cx="65" cy="52" r="4" fill="#3fd68a"/><path d="M52 66v4M58 66v4M64 66v4" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<path d="M40 30l6-14 6 10 6-14 6 14 6-10 6 14z" fill="#c9a24a" stroke="' + INK + '" stroke-width="2"/><circle cx="58" cy="22" r="2.4" fill="#3fd68a"/>' +
        '<g class="rbs-arm"><path d="M86 86l14-12" stroke="#e9e4d4" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M102 100l4-92" stroke="#3a3440" stroke-width="5" stroke-linecap="round"/><circle cx="106" cy="10" r="8" fill="#3fd68a" stroke="' + INK + '" stroke-width="2"/></g>');
    },
    'skeleton-archer': function () {
      return svgArt('0 0 60 110',
        '<g fill="#e9e4d4" stroke="' + INK + '" stroke-width="2"><path d="M22 18a8 9 0 1 1 16 0v6l-3 3H25l-3-3z"/><path d="M27 30v26M33 30v26"/>' +
          '<path d="M22 34h16M22 40h16M23 46h14" fill="none"/><path d="M24 58h12l-2 8h-8z"/><path d="M26 66l-4 40M34 66l4 40" fill="none"/>' +
          '<path d="M22 36l-12 18M38 36l10 14" fill="none"/></g>' +
        '<circle cx="26" cy="18" r="2.4" fill="#3fd68a"/><circle cx="34" cy="18" r="2.4" fill="#3fd68a"/>' +
        '<path d="M50 18q14 30 0 66" fill="none" stroke="#5a3e2a" stroke-width="3"/><path d="M50 18v66" stroke="#c9cdbf" stroke-width="1"/>');
    },
    // Props.
    door: function () {
      return svgArt('0 0 124 168',
        '<path d="M8 168V62a54 54 0 0 1 108 0v106z" fill="#4a4652"' + S + '/>' +
        '<path d="M35 22v146M62 10v158M89 22v146" stroke="#36323d" stroke-width="2"/>' +
        '<g fill="#6c6878" stroke="' + INK + '" stroke-width="2"><rect x="8" y="60" width="108" height="8"/><rect x="8" y="138" width="108" height="8"/></g>' +
        '<g fill="#9a96a4"><circle cx="20" cy="64" r="2.4"/><circle cx="104" cy="64" r="2.4"/><circle cx="20" cy="142" r="2.4"/><circle cx="104" cy="142" r="2.4"/></g>' +
        skull(62, 44, 0.8, true) +
        '<g class="rbs-bar"><rect x="-6" y="96" width="136" height="14" fill="#6b4a32"' + S + '/><path d="M10 103h104" stroke="#4a3424" stroke-width="2"/></g>');
    },
    brazier: function () {
      return svgArt('0 0 70 90',
        '<path d="M14 88l12-40M56 88l-12-40M35 88V50" stroke="#2a2630" stroke-width="4" fill="none"/>' +
        '<path d="M6 40h58l-8 14H14z" fill="#4a4652"' + S + '/><path d="M12 46h46" stroke="#6c6878" stroke-width="1.5"/>' +
        skull(19, 40, 0.5, false) +
        '<path class="rbs-flame" d="M35 42c-18-10-12-28-2-40 2 10 10 12 12 22 2-6 0-10 0-14 8 8 10 24-10 32z" fill="#3fd68a" stroke="' + INK + '" stroke-width="2"/>' +
        '<path class="rbs-flame rbs-f2" d="M35 42c-8-6-6-14 0-22 5 8 8 14 0 22z" fill="#d7ffe8"/>');
    },
    crown: function () {
      return svgArt('0 0 54 36',
        '<path d="M4 34L2 8l12 10 13-16 13 16 12-10-2 26z" fill="#c9a24a"' + S + '/>' +
        '<path d="M5 28h44" stroke="#8a6a2a" stroke-width="2"/><circle cx="27" cy="22" r="4" fill="#3fd68a" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<circle cx="14" cy="24" r="2.4" fill="#a3271f"/><circle cx="40" cy="24" r="2.4" fill="#a3271f"/>');
    },
    stone: function () {
      return svgArt('0 0 42 26', '<path d="M3 24l4-14 12-8 14 3 7 12-4 7z" fill="#8f978c"' + S + '/><path d="M14 10l6 6 10-2" stroke="#6b756d" stroke-width="1.6" fill="none"/>');
    },
    glyphs: function () {
      return svgArt('0 0 150 126',
        '<path d="M8 124V40a67 34 0 0 1 134 0v84z" fill="#14301f" opacity=".55" stroke="#3fd68a" stroke-width="2" stroke-dasharray="6 4"/>' +
        '<g fill="none" stroke="#5ef0a0" stroke-width="2.6" class="rbs-ward">' +
          '<circle cx="75" cy="58" r="20"/><path d="M75 38l17 30H58z"/><circle cx="34" cy="78" r="9"/><circle cx="116" cy="78" r="9"/>' +
          '<path d="M30 100l8 10 8-10M104 100l8 10 8-10M66 96h18M75 88v18M28 56l6-8 6 8M110 56l6-8 6 8"/></g>');
    },
    rubble: function () {
      return svgArt('0 0 540 40',
        '<path d="M0 40V26l18-8 14 6 20-12 16 10 22-6 10 8 30-14 18 10 24-4 16 8h60l14-10 20 6 18-12 22 10 16-4 20 10 26-8 18 10 22-6 14 8 28-12 20 8 18-6 22 10 14-4 20 8V40z" fill="#8f978c"' + S + '/>' +
        '<g fill="#e9e4d4" stroke="' + INK + '" stroke-width="1.6"><path d="M90 24a7 7 0 0 1 14 0v3l-2 2v3h-10v-3l-2-2z"/><path d="M420 22a6 6 0 0 1 12 0v3l-2 2v3h-8v-3l-2-2z"/>' +
          '<path d="M150 32l30-8M154 28l-3 6M176 22l4 4"/><path d="M300 30l26 4M300 30l-3-4M326 34l4-3"/><path d="M480 30l20-10"/></g>', ' preserveAspectRatio="none"');
    },
    ledge: function () {
      return svgArt('0 0 540 40',
        '<path d="M0 40V12l40-2 20 4h120l14-5h110l18 6h90l20-4h108V40z" fill="#7d8579"' + S + '/>' +
        '<path d="M60 14v26M180 14v26M330 15v25M440 12v28M0 26h540" stroke="#5a625a" stroke-width="1.6"/>' +
        '<path d="M250 10l8 12-6 8 4 10" stroke="' + INK + '" stroke-width="2" fill="none"/>', ' preserveAspectRatio="none"');
    },
    rune: function () {
      return svgArt('0 0 200 200',
        '<g fill="none" stroke="#3fd68a" stroke-width="2"><circle cx="100" cy="100" r="92"/><circle cx="100" cy="100" r="76" stroke-dasharray="4 7"/>' +
        '<path d="M100 14L176 144H24Z"/><path d="M100 186L24 56H176Z" opacity=".6"/></g>' +
        '<g fill="#3fd68a"><circle cx="100" cy="8" r="4"/><circle cx="180" cy="146" r="4"/><circle cx="20" cy="146" r="4"/></g>', ' preserveAspectRatio="none"');
    }
  };

  // A burst is the paper star of a hit: a slash (bone and blood), a bolt
  // (ghost-fire) or a curse (violet).
  var BURSTS = { slash: ['#fbf3dc', '#a3271f'], bolt: ['#d7ffe8', '#2f8f63'], curse: ['#c9b6ff', '#4b2a6b'] };
  function artBurst(kind) {
    var c = BURSTS[kind];
    return svgArt('0 0 90 90',
      '<g class="rbs-burst"><path d="M45 2l8 28 30-12-20 24 26 14-30 2 6 30-20-22-20 22 4-30L0 58l26-14L6 18l30 12z" fill="' + c[0] + '"' + S + '/>' +
      '<path d="M30 60L62 24" stroke="' + c[1] + '" stroke-width="5" stroke-linecap="round"/></g>');
  }

  // artPaper draws the paper tags: the scripted dice, the tier ribbon and a
  // flag on a pin. Their text comes from the script.
  function artPaper(piece, facts) {
    var f = facts || {};
    if (piece.kit === 'dice') {
      var d = '';
      for (var i = 0; i < (f.dice || []).length; i++) d += '<span class="rbs-die" style="left:' + (i * 42) + 'px">' + esc(f.dice[i]) + '</span>';
      return d;
    }
    if (piece.kit === 'ribbon') {
      return '<div class="rbs-ribbon">' + esc(f.tier || '') + (f.total != null ? ' · ' + esc(f.total) : '') + '</div>';
    }
    return '<div class="rbs-flag">' + esc(piece.text) + '</div>';
  }

  // pieceArt is a piece's drawing, whatever kit it comes from.
  function pieceArt(piece, facts) {
    if (KIT[piece.kit] && KIT[piece.kit].kind === 'paper') return artPaper(piece, facts);
    if (BURSTS[piece.kit]) return artBurst(piece.kit);
    return ART[piece.kit] ? ART[piece.kit]() : '';
  }

  // sceneDefs is the one hidden <svg> holding what every piece shares: the
  // die-cut white edge with its drop shadow, the wall's stone and the glow
  // inside its arches. The board renders it once.
  function sceneDefs() {
    return '<svg class="rbs-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
      '<filter id="rbs-cut" x="-10%" y="-10%" width="120%" height="125%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="d"/>' +
        '<feFlood flood-color="#f4efe0"/><feComposite in2="d" operator="in" result="edge"/><feOffset in="d" dy="3" result="o"/>' +
        '<feFlood flood-color="#0c0812" flood-opacity=".45"/><feComposite in2="o" operator="in" result="sh"/>' +
        '<feMerge><feMergeNode in="sh"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<pattern id="rbs-stone" width="44" height="24" patternUnits="userSpaceOnUse"><rect width="44" height="24" fill="#9aa39a"/>' +
        '<path d="M0 23.5H44M22 0V12M0 12H44M0 12V24" stroke="#6b756d" stroke-width="1.4" fill="none"/><path d="M6 4l5 3M30 16l4-2" stroke="#7d887f" stroke-width="1"/></pattern>' +
      '<radialGradient id="rbs-glow" cx="50%" cy="80%" r="70%"><stop offset="0" stop-color="#2f8f63" stop-opacity=".75"/><stop offset=".55" stop-color="#1c1428"/><stop offset="1" stop-color="#120d1a"/></radialGradient>' +
      '<radialGradient id="rbs-dark" cx="50%" cy="80%" r="70%"><stop offset="0" stop-color="#241a31"/><stop offset="1" stop-color="#0c0812"/></radialGradient>' +
      '</defs></svg>';
  }

  // pieceHtml places one piece on the spread. x is its left edge and y the
  // line it is hinged on (0 the back of the spread, 250 the front), so the
  // paper stands up from y. A piece with a card is a button once it stands.
  function pieceHtml(p, idx, facts) {
    var style = 'left:' + p.x + 'px;top:' + (p.y - p.h) + 'px;width:' + p.w + 'px;height:' + p.h + 'px;--i:' + idx + ';--dir:' + p.face;
    var attrs = ' data-rbs-piece="' + escAttr(p.id) + '"';
    if (p.card) attrs += ' role="button" tabindex="-1" data-rbs-card="' + escAttr(p.card) + '" aria-label="' + escAttr(p.label) + '"';
    var art = pieceArt(p, facts);
    if (p.flip) art = '<div class="rbs-flip">' + art + '</div>';
    var cls = (p.kind === 'flat' ? 'rbs-flat' : 'rbs-pop') + ' rbs-k-' + p.kit + (p.show ? ' rbs-shy' : '');
    return '<div class="' + cls + '"' + attrs + ' style="' + style + '"><div class="rbs-card">' + art + '</div></div>';
  }

  // buildSceneHtml renders the closed pop-up book: its two pages (the left
  // one doubling as the cover), the wall, every piece and their shadows.
  function buildSceneHtml(scene, ctx) {
    var c = ctx || {}, lines = c.lines || [], ri = rollLineIndex(lines);
    var facts = ri >= 0 ? rollFacts(lines[ri]) : {};
    var shades = '', flats = '', pops = '', ps = (scene && scene.pieces) || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.kind === 'flat') { flats += pieceHtml(p, i + 1, facts); continue; }
      if (p.kind === 'fig' && !p.show) {
        shades += '<div class="rbs-shade" style="left:' + (p.x - 8) + 'px;top:' + (p.y - 14) + 'px;width:' + (p.w + 16) + 'px;height:24px"></div>';
      }
      pops += pieceHtml(p, i + 1, facts);
    }
    return '<div class="rbs-scene rbs-closed" role="group" aria-label="Pop-up scene. Pick a figure or a paper tag to read its card.">' +
      '<span class="rbs-hint" aria-hidden="true">Tap anything on the page</span>' +
      '<div class="rbs-fit"><div class="rbs-book"><div class="rbs-spread">' +
        '<div class="rbs-page rbs-pl"><div class="rbs-cover"><span>' + esc(c.cover) + '</span></div></div><div class="rbs-page rbs-pr"></div>' +
        shades + flats +
        '<div class="rbs-pop rbs-wall rbs-up" style="--i:0"><div class="rbs-card">' + artWall(scene.backdrop) + '</div></div>' +
        pops +
      '</div></div></div></div>';
  }

  // buildBoardViewHtml is one part on the board: the scene, its caption
  // line, the beat controls and dots, and the layer its cards slide into.
  function buildBoardViewHtml(scene, ctx) {
    var dots = '';
    for (var i = 0; i < scene.beats.length; i++) dots += '<i></i>';
    return '<div class="rbs" data-rbs>' + buildSceneHtml(scene, ctx) +
      '<div class="rbs-cap"><span class="rbs-who rbs-dir" data-rbs-who></span><div class="rbs-tx" data-rbs-tx aria-live="polite"></div></div>' +
      '<div class="rbs-ctl"><button class="rbs-ib" type="button" data-rbs-back aria-label="Back one beat">◀</button>' +
        '<button class="rbs-ib" type="button" data-rbs-pause aria-label="Pause">⏸</button>' +
        '<button class="rbs-ib" type="button" data-rbs-fwd aria-label="Forward one beat">▶</button><span class="rbs-grow"></span>' +
        '<span class="rbs-dots" aria-hidden="true">' + dots + '</span></div>' +
      '<div class="rbs-cards" data-rbs-cards></div></div>';
  }

  // ── stylesheet ────────────────────────────────────────────────────────────

  // sceneCss is the pop-up book's stylesheet: the 3D book, its standing
  // pieces, every motion a beat can cue, the caption and controls, and the
  // paper and seal cards. Board chrome tokens fall back to literals.
  function sceneCss() {
    var C = 'var(--rb-combat,#f0a12e)', PUR = 'var(--rb-pur,#a78bfa)', GOLD = 'var(--rb-gold,#fbbf24)';
    var EDGE = 'var(--rb-edge,#262c3d)', EDGE2 = 'var(--rb-edge2,#1f2534)', BOX2 = 'var(--rb-box2,#1a2030)', BOX3 = 'var(--rb-box3,#222a3d)';
    var INKC = 'var(--rb-ink,#f2f4fa)', INK2 = 'var(--rb-ink2,#c9d0e0)', MUT = 'var(--rb-mut,#8a93a8)';
    var PAPER = '#ebe5d3', LICH = '#3fd68a', SERIF = 'Spectral,Georgia,serif';
    var D = 'var(--dir,1)';
    return [
      // the book: a 700x360 stage scaled to fit, a spread tilted back in 3D
      '.rbs{position:relative}',
      // a script playing as a pop-up book fills the board edge to edge
      '.rbx-script.rbs-host.rbx-on{border:0;border-radius:0;padding:0;margin:0;background:none}',
      '.rbs-defs{position:absolute;width:0;height:0;overflow:hidden}',
      '.rbs-scene{position:relative;height:calc(360px * var(--rbs-s,1));overflow:hidden;' +
        'background:radial-gradient(90% 60% at 50% 105%,rgba(63,214,138,.22),transparent 70%),radial-gradient(120% 90% at 50% 0%,#2a1d3a 0%,#110c18 72%)}',
      '.rbs-fit{position:absolute;left:50%;top:0;width:700px;height:360px;margin-left:-350px;transform:scale(var(--rbs-s,1));transform-origin:50% 0}',
      '.rbs-book{position:absolute;left:0;top:0;right:0;bottom:0;perspective:1200px;perspective-origin:50% 0%}',
      '.rbs-spread{position:absolute;left:50px;top:150px;width:600px;height:250px;transform-style:preserve-3d;transform:rotateX(58deg)}',
      '.rbs-page{position:absolute;top:0;width:300px;height:250px;background:' + PAPER + ';transform-style:preserve-3d;' +
        'background-image:radial-gradient(circle at 30% 20%,rgba(255,255,255,.35),transparent 60%),repeating-linear-gradient(0deg,rgba(80,60,30,.04) 0 2px,transparent 2px 5px)}',
      '.rbs-page::after{content:"";position:absolute;left:10px;top:10px;right:10px;bottom:10px;border:1.5px solid rgba(60,50,80,.35);border-radius:4px}',
      '.rbs-pl{left:0;border-radius:6px 0 0 6px;box-shadow:inset -26px 0 30px -18px rgba(40,30,55,.5);transform-origin:100% 50%;' +
        'transition:transform 1100ms cubic-bezier(.6,.05,.25,1)}',
      '.rbs-pr{left:300px;border-radius:0 6px 6px 0;box-shadow:inset 26px 0 30px -18px rgba(40,30,55,.5)}',
      '.rbs-closed .rbs-pl{transform:rotateY(180deg) translateZ(-2px)}',
      // closing the board turns the cover back quicker than it opened
      '.rbs-shutting .rbs-pl{transition-duration:' + SHUT_MS + 'ms;transition-timing-function:cubic-bezier(.5,0,.4,1)}',
      // the cover is the left page's back: dark violet, a skull, green lettering
      '.rbs-cover{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:6px;transform:rotateY(180deg) translateZ(1px);backface-visibility:hidden;' +
        'background:radial-gradient(circle at 50% 40%,#2c2240,#140e1d 75%);box-shadow:inset 0 0 0 6px #1d1528,inset 0 0 0 7px ' + LICH + ',0 0 0 3px #2a2236}',
      '.rbs-cover span{position:absolute;left:0;top:0;right:0;bottom:0;display:grid;place-items:center;align-content:center;gap:6px;padding:0 18px;text-align:center;' +
        'font:600 26px/1.15 ' + SERIF + ';color:#bff5d8;text-shadow:0 0 12px rgba(63,214,138,.6)}',
      '.rbs-cover span::before{content:"☠";font-size:30px;color:#e9e4d4}',
      // a standing piece is hinged on its bottom edge: face-down when folded
      '.rbs-pop{position:absolute;transform-origin:50% 100%;transform-style:preserve-3d;transform:rotateX(-180deg);' +
        'transition:transform 380ms ease-in;pointer-events:none}',
      '.rbs-pop.rbs-up{transform:rotateX(-90deg);transition:transform 700ms cubic-bezier(.3,1.6,.5,1)}',
      '.rbs-opening .rbs-pop.rbs-up{transition-delay:calc(770ms + var(--i,0) * 120ms)}',
      '.rbs-opening .rbs-pop.rbs-up.rbs-shy{transition-delay:0ms}',
      '.rbs-closed .rbs-pop,.rbs-scene.rbs-closed .rbs-pop.rbs-up{transform:rotateX(-180deg);transition:transform 380ms ease-in}',
      '.rbs-pop>.rbs-card{position:absolute;left:0;top:0;right:0;bottom:0;transform-origin:50% 100%;backface-visibility:hidden;' +
        'transition:transform 440ms cubic-bezier(.4,1.4,.5,1),opacity .4s,filter .3s}',
      '.rbs-art{display:block;width:100%;height:100%;overflow:visible}',
      '.rbs-pop .rbs-art{filter:url(#rbs-cut)}',
      '.rbs-flip{width:100%;height:100%;transform:scaleX(-1)}',
      '.rbs-wall{left:40px;top:-158px;width:520px;height:180px}',
      '.rbs-pop.rbs-up[role=button]{pointer-events:auto;cursor:pointer}',
      '.rbs-closed .rbs-pop.rbs-up[role=button]{pointer-events:none}',
      '.rbs-pop[role=button]:focus{outline:none}',
      '.rbs-pop[role=button]:hover .rbs-art,.rbs-pop[role=button]:focus-visible .rbs-art{filter:url(#rbs-cut) drop-shadow(0 0 6px rgba(63,214,138,.9))}',
      '.rbs-pop[role=button]:hover .rbs-die,.rbs-pop[role=button]:hover .rbs-ribbon,.rbs-pop[role=button]:hover .rbs-flag,' +
        '.rbs-pop[role=button]:focus-visible .rbs-die,.rbs-pop[role=button]:focus-visible .rbs-ribbon,.rbs-pop[role=button]:focus-visible .rbs-flag' +
        '{box-shadow:0 0 0 3px rgba(63,214,138,.9),0 3px 0 rgba(20,10,30,.4)}',
      // a piece that only stands on its beats is invisible while folded away
      '.rbs-shy>.rbs-card{transition:transform 440ms cubic-bezier(.4,1.4,.5,1),opacity 200ms}',
      '.rbs-shy:not(.rbs-up)>.rbs-card,.rbs-closed .rbs-shy>.rbs-card{opacity:0}',
      '.rbs-shade{position:absolute;transform:translateZ(.5px);background:radial-gradient(closest-side,rgba(60,35,10,.45),transparent);transition:opacity 400ms}',
      '.rbs-closed .rbs-shade{opacity:0}',
      '.rbs-flat{position:absolute;opacity:.75;transition:opacity .4s}',
      '.rbs-closed .rbs-flat{opacity:0}',
      '.rbs-flat>.rbs-card{position:absolute;left:0;top:0;right:0;bottom:0;animation:rbs-pulse 2.6s ease-in-out infinite alternate}',
      '@keyframes rbs-pulse{from{opacity:.45}to{opacity:1}}',
      '.rbs-ward{animation:rbs-pulse 1.8s ease-in-out infinite alternate}',
      // ghost-fire: torches and brazier flames flicker without end (MotionRest rests them)
      '.rbs-torch,.rbs-flame{transform-box:fill-box;transform-origin:50% 100%;animation:rbs-flick 1100ms ease-in-out infinite alternate}',
      '.rbs-flame{animation-duration:900ms}.rbs-f2{animation-duration:700ms;animation-delay:-300ms}',
      '@keyframes rbs-flick{0%{transform:scale(1,1) skewX(0)}50%{transform:scale(.92,1.08) skewX(-4deg)}100%{transform:scale(1.05,.94) skewX(3deg)}}'
    ].join('\n') + '\n' + sceneMotionCss(D) + '\n' + sceneCardCss(C, PUR, GOLD, EDGE, EDGE2, BOX2, BOX3, INKC, INK2, MUT, PAPER, LICH, SERIF);
  }

  // sceneMotionCss draws each motion a beat can cue. `D` is the piece's
  // facing (--dir: 1 faces right, -1 left), so one rule serves both sides.
  function sceneMotionCss(D) {
    function tx(px) { return 'translateX(calc(' + D + ' * ' + px + 'px))'; }
    function rz(deg) { return 'rotate(calc(' + D + ' * ' + deg + 'deg))'; }
    return [
      '.rbs-arm{transform-box:fill-box;transform-origin:20% 85%;transition:transform 380ms cubic-bezier(.4,1.5,.5,1)}',
      '.rbs-m-step>.rbs-card{transform:' + tx(26) + ' ' + rz(3) + '}',
      '.rbs-m-wind>.rbs-card{transform:' + rz(-6) + ' ' + tx(-8) + '}',
      '.rbs-m-wind .rbs-arm{transform:rotate(-58deg)}',
      '.rbs-m-lunge>.rbs-card{transform:' + tx(70) + ' ' + rz(4) + '}',
      '.rbs-m-lunge .rbs-arm{transform:rotate(48deg);transition-duration:170ms}',
      '.rbs-pop.rbs-m-knock>.rbs-card{transform:' + tx(-62) + ' ' + rz(-14) + ';transition:transform 520ms cubic-bezier(.2,.9,.3,1.2) 120ms}',
      '.rbs-m-cast .rbs-arm{transform:rotate(-40deg)}',
      '.rbs-m-cast>.rbs-card,.rbs-m-glow>.rbs-card{filter:drop-shadow(0 0 10px rgba(63,214,138,.85))}',
      '.rbs-pop.rbs-m-prone>.rbs-card{transform:translateY(6%) ' + rz(-78) + ';transition:transform 620ms cubic-bezier(.5,0,.7,1.4) 100ms}',
      '.rbs-m-flee>.rbs-card{transform:' + tx(-44) + ' scale(.9);opacity:.8}',
      '.rbs-m-fade>.rbs-card{opacity:.14;transform:scaleX(.7);transition:opacity .8s,transform .8s}',
      // a burst only rocks a piece back; a fallen one (declared after, so
      // it wins) topples forward onto its face, the paper's back to the reader
      '.rbs-pop.rbs-up.rbs-m-burst{transform:rotateX(-24deg);transition:transform 520ms cubic-bezier(.55,0,.8,.5) 80ms}',
      '.rbs-pop.rbs-up.rbs-m-fall{transform:rotateX(-172deg);transition:transform 650ms cubic-bezier(.55,0,.8,.5) 120ms}',
      '.rbs-pop.rbs-up.rbs-m-fall,.rbs-pop.rbs-up.rbs-m-fall[role=button]{pointer-events:none}',
      '.rbs-bar{transform-box:fill-box;transform-origin:50% 50%;transition:transform .4s,opacity .4s}',
      '.rbs-m-burst .rbs-bar{transform:translateY(-30px) rotate(-24deg);opacity:0}',
      // one-shot motions
      '.rbs-m-stagger>.rbs-card{animation:rbs-stagger 700ms ease-out both}',
      '@keyframes rbs-stagger{0%{transform:none}20%{transform:' + tx(-16) + ' ' + rz(-8) + '}45%{transform:' + tx(-6) + '}' +
        '70%{transform:' + tx(-14) + ' ' + rz(-5) + '}100%{transform:' + tx(-12) + ' ' + rz(-6) + '}}',
      '.rbs-m-rise>.rbs-card{animation:rbs-rise 1000ms cubic-bezier(.3,1.2,.5,1) both}',
      '@keyframes rbs-rise{from{transform:translateY(30%) scale(.8);opacity:.3}to{transform:none;opacity:1}}',
      '.rbs-m-trip>.rbs-card{animation:rbs-trip 800ms ease-in-out both}',
      '@keyframes rbs-trip{0%,100%{transform:none}25%{transform:' + rz(12) + ' ' + tx(6) + '}55%{transform:' + rz(-6) + '}80%{transform:' + rz(3) + '}}',
      '.rbs-m-cheer>.rbs-card{animation:rbs-cheer 520ms ease-out 2}',
      '@keyframes rbs-cheer{0%,100%{transform:none}40%{transform:translateY(-16px)}}',
      '.rbs-m-flare>.rbs-card{animation:rbs-flare 700ms ease-out 1}',
      '@keyframes rbs-flare{30%{transform:scale(1.25,1.35)}100%{transform:none}}',
      '.rbs-m-drop>.rbs-card{animation:rbs-drop 900ms cubic-bezier(.4,0,.6,1) both}',
      '@keyframes rbs-drop{0%{transform:translateY(-140px) rotate(-40deg);opacity:0}55%{transform:none;opacity:1}72%{transform:translateY(-12px) rotate(-6deg)}86%,100%{transform:none}}',
      '.rbs-m-shake>.rbs-card{animation:rbs-shake 460ms ease-in-out 2}',
      '@keyframes rbs-shake{0%,100%{transform:none}25%{transform:translateX(-4px) rotate(-1.5deg)}75%{transform:translateX(4px) rotate(1.5deg)}}',
      // a burst (slash, bolt, curse) flashes in on its beat, then fades
      '.rbs-burst{transform-box:fill-box;transform-origin:50% 50%}',
      '.rbs-up .rbs-burst{animation:rbs-burst 1500ms cubic-bezier(.3,1.8,.5,1) both}',
      '@keyframes rbs-burst{0%{opacity:0;transform:scale(.4) rotate(-20deg)}30%{opacity:1;transform:scale(1.1)}100%{opacity:1;transform:none}}',
      // the paper tags: scripted dice tumble in, the ribbon, the flag on its pin
      '.rbs-die{position:absolute;top:4px;width:36px;height:36px;background:#f6f1e2;border:2px solid ' + INK + ';border-radius:6px;display:grid;place-items:center;' +
        'font:700 18px Spectral,Georgia,serif;color:' + INK + ';box-shadow:0 3px 0 rgba(40,25,10,.4)}',
      '.rbs-up .rbs-die{animation:rbs-tumble 700ms cubic-bezier(.3,1.4,.5,1) both}',
      '.rbs-up .rbs-die+.rbs-die{animation-delay:90ms}',
      '@keyframes rbs-tumble{0%{transform:translateY(-40px) rotate(-200deg)}100%{transform:none}}',
      '.rbs-ribbon{position:absolute;left:0;top:0;right:0;bottom:0;background:#4b2a6b;color:#d7ffe8;display:grid;place-items:center;' +
        'font:700 15px Spectral,Georgia,serif;letter-spacing:.06em;clip-path:polygon(0 0,100% 0,94% 50%,100% 100%,0 100%,6% 50%);box-shadow:inset 0 -3px 0 rgba(0,0,0,.25)}',
      '.rbs-flag{position:absolute;left:0;top:0;right:0;bottom:10px;background:#f6f1e2;border:2px solid ' + INK + ';border-radius:4px;display:grid;place-items:center;' +
        'padding:0 6px;text-align:center;font:700 13px/1.1 Spectral,Georgia,serif;color:#a3271f}',
      '.rbs-flag::after{content:"";position:absolute;left:50%;bottom:-12px;width:2px;height:10px;background:' + INK + '}'
    ].join('\n');
  }

  // sceneCardCss styles the caption, the controls, the hint tag and the two
  // kinds of card. Buttons are prefixed with .rbs so they outrank the
  // rulebook's own button reset.
  function sceneCardCss(C, PUR, GOLD, EDGE, EDGE2, BOX2, BOX3, INKC, INK2, MUT, PAPER, LICH, SERIF) {
    return [
      '.rbs-hint{position:absolute;right:12px;top:10px;z-index:2;background:' + PAPER + ';color:#241c2c;font:500 12px/1.3 system-ui,sans-serif;' +
        'padding:5px 9px;border-radius:4px;transform:rotate(2deg);box-shadow:0 4px 10px rgba(0,0,0,.4);transition:opacity 400ms;pointer-events:none}',
      '.rbs-hinted .rbs-hint{opacity:0}',
      '.rbs-cap{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-top:1px solid ' + EDGE2 + ';min-height:64px}',
      '.rbs-who{flex:none;font:700 11px/1.5 system-ui,sans-serif;letter-spacing:.08em;padding:3px 8px;border-radius:6px;margin-top:2px}',
      '.rbs-who:empty{display:none}',
      '.rbs-who.rbs-dir{background:rgba(167,139,250,.16);color:' + PUR + '}',
      '.rbs-who.rbs-pc{background:rgba(251,191,36,.16);color:' + GOLD + '}',
      '.rbs-who.rbs-roll{background:rgba(240,161,46,.16);color:' + C + '}',
      '.rbs-tx{flex:1;min-width:0;font:500 15px/1.5 inherit;color:' + INKC + '}',
      '.rbs-tx b{font-weight:700}',
      '.rbs-tx .rbx-dmg{color:' + C + ';font-weight:650}',
      '.rbs-why{color:' + MUT + ';font-style:italic}',
      '.rbs-tstamp{display:inline-block;font:800 11px/1 system-ui,sans-serif;letter-spacing:.06em;color:' + C + ';border:1.5px solid ' + C + ';' +
        'padding:4px 7px;border-radius:7px;margin-left:2px;vertical-align:2px}',
      '.rbs-ctl{display:flex;gap:6px;align-items:center;padding:0 14px 12px}',
      '.rbs .rbs-ib{border:1px solid ' + EDGE + ';background:' + BOX2 + ';color:' + INK2 + ';border-radius:8px;min-width:32px;height:32px;' +
        'font-size:13px;display:grid;place-items:center;text-align:center}',
      '.rbs .rbs-ib:hover{background:' + BOX3 + '}',
      '.rbs .rbs-ib[aria-disabled="true"]{opacity:.4}',
      '.rbs .rbs-ib:focus-visible,.rbs .rbs-kw:focus-visible,.rbs .rbs-cx:focus-visible{outline:2px solid ' + LICH + ';outline-offset:2px}',
      '.rbs-grow{flex:1}',
      '.rbs-dots{display:flex;gap:5px}.rbs-dots i{width:7px;height:7px;border-radius:50%;background:' + BOX3 + ';transition:background .3s}',
      '.rbs-dots i.rbs-on{background:' + C + '}',
      // the cards: a layer over the scene; only the cards themselves take clicks
      '.rbs-cards{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:5}',
      '.rbs-pcard,.rbs-kcard{position:absolute;pointer-events:auto;width:min(330px,calc(100% - 32px));border-radius:6px;' +
        'font:400 13.5px/1.45 system-ui,sans-serif;text-align:left}',
      '.rbs-pcard{left:16px;top:14px;background:' + PAPER + ';color:#241c2c;padding:14px 16px;transform:rotate(-1deg);' +
        'box-shadow:0 1px 0 #fff inset,0 14px 34px rgba(0,0,0,.45),0 2px 0 #b9b29c;animation:rbs-slide-up 520ms cubic-bezier(.3,1.25,.5,1) both;' +
        'background-image:repeating-linear-gradient(0deg,rgba(60,50,80,.05) 0 1px,transparent 1px 22px)}',
      '.rbs-pcard::before{content:"";position:absolute;left:0;right:0;top:-6px;height:6px;' +
        'background:radial-gradient(circle at 6px 6px,transparent 4px,' + PAPER + ' 4.5px) -6px 0/12px 6px repeat-x}',
      '.rbs-pcard.rbs-out{animation:rbs-slide-down 280ms ease-in both}',
      '@keyframes rbs-slide-up{from{transform:translateY(70px) rotate(-7deg);opacity:0}60%{transform:translateY(-6px) rotate(.5deg);opacity:1}to{transform:rotate(-1deg)}}',
      '@keyframes rbs-slide-down{to{transform:translateY(80px) rotate(-6deg);opacity:0}}',
      '.rbs-kcard{left:min(64px,8%);top:70px;background:#241a31;color:#e7e0f0;padding:14px 16px;border:1.5px solid ' + LICH + ';' +
        'box-shadow:0 0 0 4px #241a31,0 0 0 5px rgba(63,214,138,.4),0 18px 40px rgba(0,0,0,.55);transform-origin:0 50%;' +
        'animation:rbs-fold-out 640ms cubic-bezier(.3,1.2,.5,1) both}',
      '.rbs-kcard::after{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;background:linear-gradient(transparent,rgba(63,214,138,.7),transparent);' +
        'animation:rbs-crease 900ms ease-out both;pointer-events:none}',
      '.rbs-kcard.rbs-out{animation:rbs-fold-in 300ms ease-in both}',
      '@keyframes rbs-fold-out{0%{transform:perspective(800px) rotateY(-88deg) scaleX(.5);opacity:.2}55%{transform:perspective(800px) rotateY(10deg)}100%{transform:perspective(800px) rotateY(0)}}',
      '@keyframes rbs-fold-in{to{transform:perspective(800px) rotateY(-88deg) scaleX(.5);opacity:0}}',
      '@keyframes rbs-crease{0%,40%{opacity:1}100%{opacity:0}}',
      '.rbs-seal{position:absolute;right:12px;top:-14px;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#5ef0a0,#1f8a5a);' +
        'color:#0c1a12;display:grid;place-items:center;font-size:16px;box-shadow:0 2px 0 rgba(0,0,0,.4)}',
      '.rbs-kick{font:700 10.5px/1.4 system-ui,sans-serif;letter-spacing:.12em;opacity:.7;margin-bottom:2px}',
      '.rbs-ctitle{font:600 21px/1.15 ' + SERIF + ';margin:0 30px 8px 0;color:inherit}',
      '.rbs .rbs-cx{position:absolute;right:8px;top:8px;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:inherit;' +
        'font-size:14px;text-align:center;opacity:.7}',
      '.rbs-kcard .rbs-cx{top:22px}',
      '.rbs .rbs-cx:hover{opacity:1;background:rgba(127,127,127,.18)}',
      '.rbs-stats{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0 0 8px;padding:7px 10px;border-radius:5px;background:rgba(60,50,80,.08)}',
      '.rbs-kcard .rbs-stats{background:rgba(63,214,138,.08)}',
      '.rbs-stats dt{font-weight:700;font-size:11px;letter-spacing:.06em;opacity:.7;align-self:center}',
      '.rbs-stats dd{margin:0}',
      '.rbs-cbody p{margin:0 0 6px}',
      // a host page's own paragraph and bold colours never reach the paper
      '.rbs .rbs-pcard p,.rbs .rbs-kcard p{margin:0 0 6px;font:inherit;color:inherit}',
      '.rbs .rbs-pcard b,.rbs .rbs-kcard b{color:inherit}',
      '.rbs-say{display:block;font-style:italic}.rbs-say b{font:700 10px/1 system-ui,sans-serif;letter-spacing:.08em;font-style:normal;margin-right:4px;opacity:.7}',
      '.rbs-tiers{display:flex;gap:4px;margin:6px 0 8px}',
      '.rbs-tiers span{flex:1;text-align:center;padding:4px 2px;border-radius:4px;border:1.5px solid #4b2a6b;font-size:12px;opacity:.55}',
      '.rbs-tiers span.rbs-on{opacity:1;background:#4b2a6b;color:#d7ffe8;font-weight:700}',
      '.rbs-links{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin-top:4px}',
      '.rbs-ll{font:700 10px/1 system-ui,sans-serif;letter-spacing:.1em;opacity:.6}',
      '.rbs .rbs-kw{font:inherit;color:inherit;background:none;border:0;padding:0;border-bottom:1.5px dotted #2f8f63;font-weight:600;display:inline}',
      '.rbs .rbs-kw::after{content:" ⤢";font-size:.8em;color:#2f8f63}',
      '.rbs-kcard .rbs-kw,.rbs-tx .rbs-kw{border-color:' + LICH + '}.rbs-kcard .rbs-kw::after,.rbs-tx .rbs-kw::after{color:' + LICH + '}',
      '.rbs-sample{display:inline-block;margin-left:6px;font:700 9.5px/1.4 system-ui,sans-serif;letter-spacing:.1em;padding:1px 5px;border-radius:3px;' +
        'background:rgba(240,161,46,.2);color:#9a5a00;vertical-align:middle}',
      '@media (max-width:600px){.rbs-pcard{left:12px;width:calc(100% - 24px)}.rbs-kcard{left:20px;width:calc(100% - 40px);top:56px}' +
        '.rbs-cap{flex-direction:column;gap:4px}}',
      '@media (prefers-reduced-motion:reduce){.rbs *,.rbs *::before,.rbs *::after{transition-duration:1ms!important;transition-delay:0ms!important;animation:none!important}}'
    ].join('\n');
  }

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
      '.rbx-rep{font:750 9.5px/1 inherit;color:' + C + ';cursor:pointer;' +
        'background:none;border:1px solid color-mix(in srgb,' + C + ' 35%,transparent);padding:4px 7px;border-radius:99px}',
      '.rbx-rep:focus-visible{outline:2px solid ' + C + ';outline-offset:2px}',
      // Back / pause-resume / forward — the reader sets their own pace (#732).
      '.rbx-ctl{display:flex;align-items:center;gap:4px;margin-left:auto}',
      '.rbx-cb{width:26px;height:24px;border-radius:7px;display:grid;place-items:center;font:800 10px/1 inherit;' +
        'color:' + C + ';border:1px solid color-mix(in srgb,' + C + ' 35%,transparent);' +
        'background:color-mix(in srgb,' + C + ' 7%,transparent);cursor:pointer}',
      '.rbx-cb:hover{border-color:' + C + '}',
      '.rbx-cb:focus-visible{outline:2px solid ' + C + ';outline-offset:2px}',
      '.rbx-cb[aria-disabled="true"]{opacity:.32;cursor:default}',
      '.rbx-play{width:30px}',
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
      // The table + rules-in-play + teaching panel under a Lair part's script.
      // Sample content, always labelled — CLAUDE.md: "Sample scripts stay
      // labelled as samples."
      '.rbx-tagsample{font:800 8px/1 inherit;letter-spacing:.06em;color:' + PUR + ';' +
        'border:1px solid color-mix(in srgb,' + PUR + ' 45%,transparent);padding:2px 5px;border-radius:99px;margin-left:5px}',
      '.rbx-tlbl{font:800 9px/1 inherit;letter-spacing:.09em;color:var(--rb-mut,#8a93a8)}',
      '.rbx-table{margin-top:12px;padding-top:10px;border-top:1px dashed ' + EDGE + '}',
      '.rbx-heroes{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
      '.rbx-hero{display:flex;align-items:center;gap:8px}',
      '.rbx-hfig{font-size:14px;width:18px;text-align:center;flex:none}',
      '.rbx-hnm{font:750 10.5px/1.2 inherit;width:52px;flex:none}',
      '.rbx-bar{flex:1;height:7px;border-radius:5px;background:' + BOX3 + ';overflow:hidden;border:1px solid ' + EDGE + '}',
      '.rbx-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--rb-grn,#34d399),' + GOLD + ');' +
        'transition:width .5s ' + SPRING + '}',
      '.rbx-rip{margin-top:10px;padding-top:10px;border-top:1px dashed ' + EDGE + '}',
      '.rbx-chiprow{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}',
      '.rbx-lesson{margin-top:12px;border:1px solid ' + EDGE + ';border-radius:10px;background:' + BOX2 + ';padding:10px 12px}',
      '.rbx-lh{font:800 9.5px/1.2 inherit;letter-spacing:.09em;color:var(--rb-grn,#34d399);display:flex;align-items:center}',
      '.rbx-lesson p{margin:7px 0 0;font:500 11.5px/1.5 inherit;color:' + INK2 + '}',
      '.rbx-tallyrow{display:flex;align-items:center;gap:8px;margin:6px 0}',
      '.rbx-pips{display:inline-flex;gap:5px;min-height:13px}',
      '.rbx-pip{width:12px;height:12px;border-radius:50%;background:' + C + '}',
      '.rbx-pipnone{font:600 10px/1 inherit;color:' + MUT2 + '}',
      '.rbx-squadrow{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0}',
      '.rbx-mn{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-size:14px;' +
        'background:' + BOX3 + ';border:1px solid ' + EDGE + ';transition:opacity .35s,filter .35s,transform .35s ' + SPRING + '}',
      '.rbx-mn.rbx-down{opacity:.28;filter:grayscale(1);transform:rotate(-12deg) scale(.88)}',
      '.rbx-captain{display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 9px;border-radius:9px;' +
        'border:1px solid color-mix(in srgb,' + GOLD + ' 30%,' + EDGE + ');background:' + BOX3 + ';transition:opacity .35s}',
      '.rbx-captain.rbx-down{opacity:.4}',
      '.rbx-cfig{font-size:15px}',
      '.rbx-captain span{font:600 10px/1.3 inherit;color:var(--rb-mut,#8a93a8)}',
      '.rbx-malicerow,.rbx-vicrow{display:flex;align-items:center;gap:8px;margin-top:6px;font:800 10.5px/1 inherit}',
      '.rbx-malicerow b,.rbx-vicrow b{font:900 15px/1 inherit;color:' + GOLD + '}',
      '.rbx-ledger{margin-top:8px;border:1px dashed ' + EDGE + ';border-radius:8px;background:var(--rb-box,#131722);padding:6px 9px}',
      '.rbx-spend{display:flex;gap:8px;align-items:baseline;font:500 11px/1.5 inherit;color:' + INK2 + ';padding:2px 0}',
      '.rbx-cost{flex:none;font:800 9.5px/1 inherit;color:' + GOLD + ';border:1px solid color-mix(in srgb,' + GOLD + ' 40%,transparent);' +
        'padding:3px 6px;border-radius:99px}',
      // Reduced motion: no ticking or sliding — reveal everything, fully readable.
      '@media (prefers-reduced-motion:reduce){.rbx-tok,.rbx-line,.rbx-mstep,.rbx-tstamp,.rbx-die,.rbx-bar i,.rbx-mn{' +
        'transition:none!important;opacity:1!important;transform:none!important}}'
    ];
    return s.join('\n') + '\n' + sceneCss();
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
  // { destroy, play, stopAll, collapseAll, shut }. Everything DOM/timer-touching lives
  // here so the
  // module body stays DOM-free and require()-able in Node.
  function mount(root, options) {
    var noop = function () {};
    var none = function () { return 0; };
    // The null-root mount must return the SAME shape as a real one, or a
    // caller that mounts without a root gets a TypeError instead of a no-op.
    if (!root) return { destroy: noop, play: noop, stopAll: noop, collapseAll: noop, shut: none };
    var opts = options || {};
    var win = (typeof window !== 'undefined') ? window : null;
    var examples = opts.examples || {};
    // lair carries the worked-scene's table/rulesInPlay/lessons + which part
    // each script slug belongs to, plus the fold engine's bindTerms (shared
    // glossary hover card) — all optional; a script with no matching part
    // renders with no table/lesson extras, same as before v10.4.
    var lair = opts.lair || {};
    var lairParts = lair.partsBySlug || {};
    // The page may give the table and the rules in play panels of their own
    // ([data-rbx-lair-table] / [data-rbx-lair-rules]); without them both
    // render with each part's script, as before.
    var tableSlot = root.querySelector('[data-rbx-lair-table]');
    var rulesSlot = root.querySelector('[data-rbx-lair-rules]');
    var activeLair = null;   // the Lair part's script container now driving the table
    // [data-rbx-board] is the Lair board: a script container inside it plays
    // as a pop-up book when its script has a scene. Its header carries the
    // part's title and a replay button. `refs` are the data files a card
    // quotes (glossary, creatures, roles, front page).
    var board = root.querySelector('[data-rbx-board]');
    var boardTitle = board && board.querySelector('[data-rbx-board-title]');
    var boardReplay = board && board.querySelector('[data-rbx-board-replay]');
    var refs = buildRefs(opts.refs);
    var activeBoard = null;  // the board's script container on screen
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

    function _toggle(el, cls, add) { if (!el) return; if (add) el.classList.add(cls); else el.classList.remove(cls); }

    // _renderPips fills a tally pip row (montage successes/failures): n filled
    // dots, or the "none yet" placeholder at 0 — mirrors the mockup's .pips.
    function _renderPips(el, n) {
      if (!el) return;
      if (!n) { el.innerHTML = '<span class="rbx-pipnone">none yet</span>'; return; }
      var html = '';
      for (var i = 0; i < n; i++) html += '<span class="rbx-pip"></span>';
      el.innerHTML = html;
    }

    // _applyTableState paints a computeTableState() result onto whichever
    // table/lesson DOM hooks the container actually has (a script with no Lair
    // part has none, and every lookup here tolerates that).
    function _applyTableState(container, st) {
      // The active Lair part also paints the table panel and its own group
      // (rules and lesson) in the rules panel.
      var scopes = [container];
      if (container === activeLair) {
        if (tableSlot) scopes.push(tableSlot);
        var g = rulesSlot && rulesSlot.querySelector('[data-rbx-rules-part="' + String(lairParts[container.getAttribute('data-rbx-script')] || '').replace(/["\\]/g, '') + '"]');
        if (g) scopes.push(g);
      }
      each(scopes, function (scope) {
        each(scope.querySelectorAll('[data-rbx-hero]'), function (bar) {
          var pct = st.stamina[bar.getAttribute('data-rbx-hero')];
          bar.style.width = (pct == null ? 100 : Math.max(0, Math.min(100, pct))) + '%';
        });
        if (st.squadCount != null) {
          each(scope.querySelectorAll('[data-rbx-minion]'), function (m, i) { _toggle(m, 'rbx-down', i < st.squadFallen); });
        }
        var capEl = scope.querySelector('[data-rbx-captain]');
        if (capEl && st.captainUp != null) _toggle(capEl, 'rbx-down', !st.captainUp);
        var maliceEl = scope.querySelector('[data-rbx-malice]');
        if (maliceEl && st.malice != null) maliceEl.textContent = String(st.malice);
        var vicEl = scope.querySelector('[data-rbx-victories]');
        if (vicEl) vicEl.textContent = String(st.victories);
        if (st.tally) {
          _renderPips(scope.querySelector('[data-rbx-tally-success]'), st.tally.success);
          _renderPips(scope.querySelector('[data-rbx-tally-failure]'), st.tally.failure);
        }
      });
    }

    // _updateCtl reflects playback position on the step controls: back/forward
    // announce as disabled at either end, and the pause button shows which
    // action it currently performs.
    function _updateCtl(container, slug) {
      var st = container.__rbx || { index: -1, paused: false };
      var lines = linesOf(examples[slug]);
      var back = container.querySelector('[data-rbx-step-back]');
      var pause = container.querySelector('[data-rbx-step-pause]');
      var fwd = container.querySelector('[data-rbx-step-fwd]');
      if (back) back.setAttribute('aria-disabled', st.index <= -1 ? 'true' : 'false');
      if (fwd) fwd.setAttribute('aria-disabled', st.index >= lines.length - 1 ? 'true' : 'false');
      if (pause) { pause.textContent = st.paused ? '▶' : '⏸'; pause.setAttribute('aria-label', st.paused ? 'Resume' : 'Pause'); }
    }

    // ensureRendered fills a container from its script data once (plus the
    // Lair table/rules-in-play/lesson extras when this slug belongs to a Lair
    // part), then wires its own replay + step controls.
    function ensureRendered(container, slug) {
      if (!container || container.getAttribute('data-rbx-rendered') === '1') return;
      var data = examples[slug];
      if (!data) return;
      container.setAttribute('data-rbx-rendered', '1');
      // On the board, a script with a valid scene plays as a pop-up book;
      // one without falls back to the flat stage below.
      var scene = _inBoard(container) ? validateScene((data.properties || data).scene, linesOf(data)).scene : null;
      if (scene) {
        container.__rbsScene = scene;
        container.classList.add('rbs-host');
        container.innerHTML = buildBoardViewHtml(scene, { lines: linesOf(data), cover: lair.title || '' });
        _wireBoardView(container, slug);
        return;
      }
      container.innerHTML = buildScriptHtml(data);
      // The board shows a part's table and rules in its own drawers.
      var partKey = lairParts[slug];
      if (partKey && !board) container.insertAdjacentHTML('beforeend',
        buildLairExtras(partKey, lair, startMaliceOf(data), { table: !!tableSlot, rules: !!rulesSlot }));
      if (typeof lair.bindTerms === 'function') lair.bindTerms(container.querySelectorAll('[data-rb-term]'));
      var rep = container.querySelector('[data-rbx-replay]');
      if (rep) on(rep, 'click', function (e) { e.stopPropagation(); container.classList.add('rbx-on'); playContainer(container, slug); });
      var back = container.querySelector('[data-rbx-step-back]');
      var pause = container.querySelector('[data-rbx-step-pause]');
      var fwd = container.querySelector('[data-rbx-step-fwd]');
      if (back) on(back, 'click', function (e) { e.stopPropagation(); _stepBack(container, slug); });
      if (pause) on(pause, 'click', function (e) { e.stopPropagation(); _togglePause(container, slug); });
      if (fwd) on(fwd, 'click', function (e) { e.stopPropagation(); _stepForward(container, slug); });
    }

    // ── the board's pop-up book ────────────────────────────────────────────
    function _inBoard(el) { return !!(board && el && board.contains(el)); }
    // _up is an ES5-safe closest(), stopping at `stop`.
    function _up(el, sel, stop) {
      for (var n = el; n && n.nodeType === 1 && n !== stop; n = n.parentNode) {
        var m = n.matches || n.msMatchesSelector || n.webkitMatchesSelector;
        if (m && m.call(n, sel)) return n;
      }
      return null;
    }
    function _q(c, sel) { return c.querySelector(sel); }
    function _beats(c) { return (c.__rbsScene && c.__rbsScene.beats) || []; }
    function _scriptOf(c) { return c.getAttribute('data-rbx-script'); }

    // _bvFit scales the 700px stage down to the board's width.
    function _bvFit(c) {
      var sc = _q(c, '.rbs-scene');
      if (sc && sc.clientWidth) sc.style.setProperty('--rbs-s', Math.min(1, sc.clientWidth / 700).toFixed(3));
    }

    // _bvApply stands, folds and moves every piece for beat n. A piece that
    // is folded, fallen or still in the closed book takes no clicks and no
    // focus.
    function _bvApply(c, n) {
      var s = beatState(c.__rbsScene, n), st = c.__rbx || {};
      each(c.querySelectorAll('[data-rbs-piece]'), function (el) {
        var id = el.getAttribute('data-rbs-piece'), want = s.motions[id] || [];
        _toggle(el, 'rbs-up', !!s.up[id]);
        var cls = el.className.split(/\s+/), keep = [];
        for (var i = 0; i < cls.length; i++) {
          if (cls[i].indexOf('rbs-m-') !== 0 || want.indexOf(cls[i].slice(6)) >= 0) keep.push(cls[i]);
        }
        for (var j = 0; j < want.length; j++) if (keep.indexOf('rbs-m-' + want[j]) < 0) keep.push('rbs-m-' + want[j]);
        el.className = keep.join(' ');
        if (el.hasAttribute('data-rbs-card')) {
          var live = !!(st.open && s.up[id] && want.indexOf('fall') < 0);
          el.setAttribute('tabindex', live ? '0' : '-1');
          el.setAttribute('aria-hidden', live ? 'false' : 'true');
        }
      });
    }

    // _bvCtl reflects the position on ◀ ⏸ ▶ and the beat dots.
    function _bvCtl(c) {
      var st = c.__rbx || { index: -1 }, n = _beats(c).length;
      var back = _q(c, '[data-rbs-back]'), fwd = _q(c, '[data-rbs-fwd]'), pause = _q(c, '[data-rbs-pause]');
      var ended = st.index >= n - 1;
      if (back) back.setAttribute('aria-disabled', st.index <= 0 ? 'true' : 'false');
      if (fwd) fwd.setAttribute('aria-disabled', ended ? 'true' : 'false');
      if (pause) {
        var idle = st.paused || ended;
        pause.textContent = idle ? '▶' : '⏸';
        pause.setAttribute('aria-label', ended ? 'Play again' : (st.paused ? 'Play' : 'Pause'));
      }
      each(c.querySelectorAll('.rbs-dots i'), function (d, j) { _toggle(d, 'rbs-on', j <= st.index); });
    }

    // _bvShow puts the book on beat n: the pieces, the caption line, the
    // dots and the table, all recomputed from the script.
    function _bvShow(c, slug, n) {
      var st = c.__rbx, beats = _beats(c);
      if (!st || !beats.length) return;
      n = Math.max(0, Math.min(n, beats.length - 1));
      st.index = n;
      _bvApply(c, n);
      var lines = linesOf(examples[slug]), line = lines[beats[n].line] || {};
      var who = _q(c, '[data-rbs-who]'), tx = _q(c, '[data-rbs-tx]');
      if (who) { who.className = 'rbs-who ' + (line.kind === 'pc' ? 'rbs-pc' : (line.kind === 'roll' ? 'rbs-roll' : 'rbs-dir')); who.textContent = line.speaker || ''; }
      if (tx) tx.innerHTML = captionHtml(line, showTierFor(beats, n), refs);
      _applyTableState(c, computeTableState(lines, beats[n].line, startMaliceOf(examples[slug]), startStaminaOf(examples[slug])));
      _bvCtl(c);
    }

    // _bvSchedule auto-advances one beat later, unless paused, still held
    // closed, at the end, or a card is open (closing it resumes).
    function _bvSchedule(c, slug) {
      var st = c.__rbx;
      if (!st || !st.board) return;
      if (st.timer) { win.clearTimeout(st.timer); st.timer = null; }
      if (st.paused || st.hold || !st.open || _liveCards(c).length || st.index >= _beats(c).length - 1) { _bvCtl(c); return; }
      st.timer = _timeout(function () {
        if (c.__rbx !== st) return;
        st.timer = null;
        _bvShow(c, slug, st.index + 1);
        _bvSchedule(c, slug);
      }, BEAT_MS);
    }

    // _bvPlay closes the book (its pieces fold face-down) and, unless told
    // to hold it shut until the board has landed, opens it again.
    function _bvPlay(c, slug, o) {
      _cardsClear(c);
      var st = c.__rbx = { index: -1, paused: false, timer: null, hold: !!(o && o.hold), open: false, board: true };
      _bvFit(c);
      var sc = _q(c, '.rbs-scene');
      sc.classList.add('rbs-closed');
      sc.classList.remove('rbs-opening', 'rbs-shutting');
      _bvApply(c, -1);
      var who = _q(c, '[data-rbs-who]'), tx = _q(c, '[data-rbs-tx]');
      if (who) { who.className = 'rbs-who rbs-dir'; who.textContent = ''; }
      if (tx) tx.innerHTML = '<span class="rbs-why">The book opens…</span>';
      var data = examples[slug];
      _applyTableState(c, computeTableState(linesOf(data), -1, startMaliceOf(data), startStaminaOf(data)));
      _bvCtl(c);
      if (!st.hold) _bvRelease(c, slug);
    }

    // _bvRelease opens a closed book: the cover turns, the pieces stand up
    // in a stagger, then the first beat plays. Reduced motion: it is open.
    function _bvRelease(c, slug) {
      var st = c.__rbx;
      if (!st || !st.board) return;
      st.hold = false;
      var reduced = prefersReduced();
      _timeout(function () {
        if (c.__rbx !== st || st.open) return;
        var sc = _q(c, '.rbs-scene');
        _bvFit(c);
        if (!reduced) sc.classList.add('rbs-opening');
        sc.classList.remove('rbs-closed', 'rbs-shutting');
        st.open = true;
        _bvApply(c, -1);
        _timeout(function () {
          if (c.__rbx !== st) return;
          sc.classList.remove('rbs-opening');
          if (st.index < 0) { _bvShow(c, slug, 0); _bvSchedule(c, slug); }
        }, reduced ? 0 : FIRST_BEAT_MS);
      }, reduced ? 0 : BOOK_DELAY_MS);
    }

    // _bvStep moves one beat back or forward; stepping forward while the
    // book is still opening opens it at once.
    function _bvStep(c, slug, d) {
      var st = c.__rbx;
      if (!st) return;
      var n = st.index + d;
      if (n < 0 || n >= _beats(c).length) return;
      if (!st.open) {
        st.open = true; st.hold = false;
        var sc = _q(c, '.rbs-scene');
        sc.classList.remove('rbs-closed', 'rbs-opening', 'rbs-shutting');
      }
      _bvShow(c, slug, n);
      _bvSchedule(c, slug);
    }
    // shut closes the board's open book where it is (its cards go, its
    // pieces fold, the cover turns back) so the closed book can leave the
    // board. Returns how long that takes: 0 when no book is open or under
    // reduced motion.
    function shut() {
      var c = activeBoard, st = c && c.__rbx;
      if (!st || !st.board) return 0;
      var sc = _q(c, '.rbs-scene'), was = st.open;
      if (st.timer && win) win.clearTimeout(st.timer);
      _cardsClear(c);
      // A fresh state object: a pending open or beat sees it is stale and stops.
      c.__rbx = { index: st.index, paused: true, timer: null, hold: true, open: false, board: true };
      if (!sc || !was) return 0;
      var quick = !prefersReduced();
      sc.classList.remove('rbs-opening');
      if (quick) sc.classList.add('rbs-shutting');
      sc.classList.add('rbs-closed');
      _bvApply(c, -1);
      return quick ? SHUT_MS : 0;
    }
    function _bvTogglePause(c, slug) {
      var st = c.__rbx;
      if (!st) return;
      if (st.index >= _beats(c).length - 1 && st.open) { _bvPlay(c, slug); return; }
      st.paused = !st.paused;
      _bvSchedule(c, slug);
    }

    // ── the board's cards ──────────────────────────────────────────────────
    // One layer per part. A paper card is the base; seal cards fold out of
    // it (or out of a keyword in the caption), and a seal card's own keyword
    // stacks another on top. Esc closes the top card, ✕ closes that card,
    // outside closes them all; focus moves in and returns to the opener.
    function _layer(c) { return _q(c, '[data-rbs-cards]'); }
    function _liveCards(c) {
      var l = _layer(c), out = [];
      if (l) each(l.children, function (k) { if (!k.__rbsOut) out.push(k); });
      return out;
    }
    function _cardsClear(c) { var l = _layer(c); if (l) l.innerHTML = ''; }
    function _shut(el) {
      if (!el || el.__rbsOut) return;
      el.__rbsOut = true;
      el.classList.add('rbs-out');
      function gone() { if (el.parentNode) el.parentNode.removeChild(el); }
      if (prefersReduced() || !win) gone(); else _timeout(gone, CARD_OUT_MS);
    }
    // _focusBack returns focus to an opener still on screen, else to the
    // top card left open.
    function _focusBack(c, from) {
      var live = _liveCards(c);
      var ok = from && from.isConnected !== false && root.contains(from) && from.getClientRects().length &&
        from.getAttribute('aria-hidden') !== 'true';
      var target = ok ? from : (live.length ? _q(live[live.length - 1], '.rbs-cx') : null);
      if (target && target.focus) { try { target.focus({ preventScroll: true }); } catch (e) {} }
    }
    function _addCard(c, html, from, depth) {
      var l = _layer(c), doc = root.ownerDocument;
      if (!l || !doc) return null;
      var tmp = doc.createElement('div');
      tmp.innerHTML = html;
      var el = tmp.firstChild;
      el.__rbsFrom = from;
      el.setAttribute('data-rbs-depth', String(depth || 0));
      if (depth) { el.style.top = (70 + depth * 26) + 'px'; el.style.marginLeft = (depth * 18) + 'px'; }
      l.appendChild(el);
      var x = _q(el, '.rbs-cx');
      if (x) { try { x.focus({ preventScroll: true }); } catch (e) {} }
      return el;
    }
    function _cardOpened(c) {
      if (board) board.classList.add('rbs-hinted');
      var st = c.__rbx;
      if (st && st.timer) { win.clearTimeout(st.timer); st.timer = null; }
    }
    function _openCard(c, slug, key, from) {
      var def = c.__rbsScene && c.__rbsScene.cards[key];
      var model = resolveCard(def, { refs: refs, lines: linesOf(examples[slug]) });
      if (!model) return;
      _cardOpened(c);
      _cardsClear(c);
      _addCard(c, buildCardHtml(model, 'paper'), from, 0);
    }
    function _openKw(c, slug, ref, from) {
      var model = resolveKeyword(ref, refs);
      if (!model) return;
      _cardOpened(c);
      var host = _up(from, '.rbs-kcard', _layer(c)), depth = 0;
      if (host) {
        depth = Math.min(4, (parseInt(host.getAttribute('data-rbs-depth'), 10) || 0) + 1);
        // a card already stacked on this one gives way to the new one
        var live = _liveCards(c), at = live.indexOf(host);
        for (var i = at + 1; at >= 0 && i < live.length; i++) _shut(live[i]);
      } else each(_liveCards(c), function (k) { if (k.classList.contains('rbs-kcard')) _shut(k); });
      _addCard(c, buildCardHtml(model, 'seal'), from, depth);
    }
    // _closeFrom closes card `el` and every card stacked above it.
    function _closeFrom(c, slug, el) {
      var live = _liveCards(c), at = live.indexOf(el);
      if (at < 0) return;
      if (at === 0) { _closeAll(c, slug); return; }
      for (var i = at; i < live.length; i++) _shut(live[i]);
      _focusBack(c, el.__rbsFrom);
    }
    function _closeAll(c, slug) {
      var live = _liveCards(c);
      if (!live.length) return;
      var from = live[0].__rbsFrom;
      each(live, function (k) { _shut(k); });
      _timeout(function () {
        if (_liveCards(c).length) return;      // a new card opened meanwhile
        _focusBack(c, from);
        _bvSchedule(c, slug);
      }, prefersReduced() ? 0 : CARD_OUT_MS + 10);
    }

    // _wireBoardView binds one part's scene, caption, controls and cards.
    function _wireBoardView(c, slug) {
      on(_q(c, '[data-rbs-back]'), 'click', function (e) { e.stopPropagation(); _bvStep(c, slug, -1); });
      on(_q(c, '[data-rbs-fwd]'), 'click', function (e) { e.stopPropagation(); _bvStep(c, slug, 1); });
      on(_q(c, '[data-rbs-pause]'), 'click', function (e) { e.stopPropagation(); _bvTogglePause(c, slug); });
      on(c, 'click', function (e) {
        var kw = _up(e.target, '.rbs-kw', c);
        if (kw) { _openKw(c, slug, kw.getAttribute('data-rbs-kw'), kw); return; }
        var cx = _up(e.target, '.rbs-cx', c);
        if (cx) { _closeFrom(c, slug, _up(cx, '.rbs-pcard,.rbs-kcard', c)); return; }
        var piece = _up(e.target, '[data-rbs-card]', c);
        if (piece && piece.getAttribute('tabindex') === '0') _openCard(c, slug, piece.getAttribute('data-rbs-card'), piece);
      });
      on(c, 'keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var piece = _up(e.target, '[data-rbs-card]', c);
        if (!piece || piece !== e.target) return;
        e.preventDefault();
        _openCard(c, slug, piece.getAttribute('data-rbs-card'), piece);
      });
    }

    // _boardChrome names the part in the board's header and marks its chip.
    function _boardChrome(slug) {
      var data = examples[slug] || {}, p = data.properties || {};
      if (boardTitle) boardTitle.textContent = (p.icon ? p.icon + ' ' : '') + (data.name || p.title || '');
      each(board.querySelectorAll('[data-rbx-play]'), function (b) {
        if (b.getAttribute('data-rbx-play') !== slug) { b.removeAttribute('aria-current'); return; }
        b.setAttribute('aria-current', 'true');
        // bring the chip into its scrolling row by hand: scrollIntoView
        // could scroll the page under the fixed board as well
        var row = b.parentNode;
        if (row && row.scrollWidth > row.clientWidth) {
          var l = b.offsetLeft - row.offsetLeft, r = l + b.offsetWidth;
          if (l < row.scrollLeft) row.scrollLeft = Math.max(0, l - 14);
          else if (r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth + 14;
        }
      });
    }

    // _boardShow puts one part on the board. With o.hold its book stays
    // closed (the board is still unfolding); showing the same part again
    // without hold opens it.
    function _boardShow(c, slug, o) {
      var hold = !!(o && o.hold);
      if (!hold && c === activeBoard && c.__rbx && c.__rbx.hold && c.classList.contains('rbx-on')) { _bvRelease(c, slug); return; }
      // A held show arriving after the book already opened (the board
      // settled first) must not shut it again.
      if (hold && c === activeBoard && c.__rbx && !c.__rbx.hold && c.classList.contains('rbx-on')) return;
      if (activeBoard && activeBoard !== c) _cardsClear(activeBoard);
      var parent = c.parentNode;
      if (parent) each(parent.querySelectorAll('[data-rbx-script].rbx-on'), function (sib) { if (sib !== c) { sib.classList.remove('rbx-on'); sib.__rbx = null; bumpRun(sib); } });
      c.classList.add('rbx-on');
      activeBoard = c;
      activeLair = lairParts[slug] ? c : null;
      _showRules(lairParts[slug]);
      _boardChrome(slug);
      playContainer(c, slug, o);
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

    // _jumpTo instantly (no ticking, no stagger) sets a container to "beats
    // 0..index fully revealed" and recomputes the table/lesson state fresh
    // from lines[]._effects — the single code path back AND forward both use,
    // so "stepping back puts the table back as it was" is always a correct
    // recompute, never an incremental (and driftable) undo.
    function _jumpTo(container, slug, index) {
      var st = container.__rbx;
      if (!st) return;
      var lines = linesOf(examples[slug]);
      index = Math.max(-1, Math.min(index, lines.length - 1));
      var lineEls = container.querySelectorAll('.rbx-line');
      var stage = container.querySelector('.rbx-stage');
      if (stage && index >= 0) stage.classList.add('rbx-in');
      each(lineEls, function (l, k) {
        l.classList.remove('rbx-now');
        var shown = k <= index;
        _toggle(l, 'rbx-shown', shown);
        if (l.className.indexOf('rbx-rl') >= 0) {
          var dvals = (l.getAttribute('data-rbx-dice') || '').split(',');
          if (shown) {
            each(l.querySelectorAll('.rbx-die'), function (d, kk) { if (dvals[kk] != null && dvals[kk] !== '') d.textContent = dvals[kk]; });
            each(l.querySelectorAll('.rbx-mstep,.rbx-tstamp'), function (m) { m.classList.add('rbx-show'); });
          } else {
            each(l.querySelectorAll('.rbx-die'), function (d) { d.textContent = '?'; });
            each(l.querySelectorAll('.rbx-mstep,.rbx-tstamp'), function (m) { m.classList.remove('rbx-show'); });
          }
        }
      });
      if (index >= 0 && lineEls[index]) { lineEls[index].classList.add('rbx-now'); setTok(stage, lineEls[index].getAttribute('data-rbx-kind')); }
      else setTok(stage, null);
      st.index = index;
      _applyTableState(container, computeTableState(lines, index, startMaliceOf(examples[slug]), startStaminaOf(examples[slug])));
      _updateCtl(container, slug);
    }

    // _advanceAnimated reveals ONE beat with the mockup's dice-tick/step
    // animation (autoplay only — back/forward are instant via _jumpTo), then
    // schedules the beat after it. container.__rbx acting as its own identity
    // token means a NEW playContainer() (replay, or a sibling switching on)
    // automatically invalidates any in-flight timer from a previous run.
    function _advanceAnimated(container, slug) {
      var st = container.__rbx;
      if (!st || st.paused) return;
      var lines = linesOf(examples[slug]);
      var next = st.index + 1;
      var stage = container.querySelector('.rbx-stage');
      if (next >= lines.length) { setTok(stage, null); _updateCtl(container, slug); return; }
      var lineEls = container.querySelectorAll('.rbx-line');
      var l = lineEls[next];
      if (!l) return;
      if (next > 0 && lineEls[next - 1]) lineEls[next - 1].classList.remove('rbx-now');
      l.classList.add('rbx-shown', 'rbx-now');
      setTok(stage, l.getAttribute('data-rbx-kind'));
      st.index = next;
      _applyTableState(container, computeTableState(lines, next, startMaliceOf(examples[slug]), startStaminaOf(examples[slug])));
      _updateCtl(container, slug);
      function current() { return !destroyed && container.__rbx === st && !st.paused; }
      if (l.className.indexOf('rbx-rl') >= 0) {
        rollSeq(l, current, function () {
          if (!current()) return;
          st.timer = _timeout(function () { if (current()) _advanceAnimated(container, slug); }, ROLL_AFTER_MS);
        });
      } else {
        st.timer = _timeout(function () { if (current()) _advanceAnimated(container, slug); }, LINE_MS);
      }
    }

    function _stepBack(container, slug) {
      var st = container.__rbx; if (!st) return;
      if (st.timer) { win.clearTimeout(st.timer); st.timer = null; }
      st.paused = true;
      _jumpTo(container, slug, st.index - 1);
    }
    function _stepForward(container, slug) {
      var st = container.__rbx; if (!st) return;
      if (st.timer) { win.clearTimeout(st.timer); st.timer = null; }
      st.paused = true;
      _jumpTo(container, slug, st.index + 1);
    }
    function _togglePause(container, slug) {
      var st = container.__rbx; if (!st) return;
      st.paused = !st.paused;
      _updateCtl(container, slug);
      if (!st.paused) _advanceAnimated(container, slug);
      else if (st.timer) { win.clearTimeout(st.timer); st.timer = null; }
    }

    // playContainer resets a container to its rest state then starts it
    // playing — scripts "start playing when opened" (#732): nothing here
    // waits for a separate play action once the script is on screen. A fresh
    // __rbx identity object per call means a replay (or a sibling switching
    // this container off) cleanly supersedes any previous run.
    function playContainer(container, slug, o) {
      if (!container) return;
      ensureRendered(container, slug);
      bumpRun(container);
      if (container.__rbsScene) { _bvPlay(container, slug, o); return; }
      resetScript(container);
      var lines = linesOf(examples[slug]);
      container.__rbx = { index: -1, paused: false, timer: null };
      _applyTableState(container, computeTableState(lines, -1, startMaliceOf(examples[slug]), startStaminaOf(examples[slug])));
      _updateCtl(container, slug);
      var stage = container.querySelector('.rbx-stage');

      if (prefersReduced()) {                       // instant, fully-readable reveal
        _jumpTo(container, slug, lines.length - 1);
        container.__rbx.paused = true;
        return;
      }
      var st = container.__rbx;
      if (stage && win) { void stage.offsetWidth; _timeout(function () { if (container.__rbx === st) stage.classList.add('rbx-in'); }, STAGE_IN_MS); }
      _timeout(function () { if (container.__rbx === st) _advanceAnimated(container, slug); }, STAGE_IN_MS + 40);
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
          // :not([data-rb-term]) excludes a glossary hover term: the Lair
          // overview's "this scene teaches" chips are focusable but landing
          // there focuses (and so opens) its hover card instead of a genuine
          // control — found by the v10.4 Playwright harness, where it also
          // ate the NEXT Escape press (Esc dismisses the hover card first).
          var f = sh.querySelector('button:not([disabled]):not([data-rb-term]),a[href]:not([data-rb-term]),' +
            '[tabindex]:not([tabindex="-1"]):not([data-rb-term])');
          if (f && f.focus) { try { f.focus(); } catch (e) {} }
        }
      }
    }
    function handlePlay(btn) {
      var slug = btn.getAttribute('data-rbx-play');
      if (!examples[slug]) return;      // no script data -> stay inert (no empty box / half drill-in)
      applyShowHide(btn);
      var container = _scopedContainer(btn, slug);
      if (!container) return;
      if (_inBoard(container)) { _boardShow(container, slug); return; }
      var parent = container.parentNode;                 // switch sibling scripts off
      // A superseded sibling's __rbx identity is cleared, not just bumped: any
      // in-flight _advanceAnimated/rollSeq closure compares container.__rbx
      // against the `st` object it captured and stops the moment they differ.
      if (parent) each(parent.querySelectorAll('[data-rbx-script].rbx-on'), function (sib) { if (sib !== container) { sib.classList.remove('rbx-on'); sib.__rbx = null; bumpRun(sib); } });
      container.classList.add('rbx-on');
      var partKey = lairParts[slug];
      if (partKey) {
        activeLair = container;
        _showRules(partKey);
      }
      playContainer(container, slug);
    }

    // _scopedContainer finds the script container nearest a play button: the
    // same script may play in more than one place (a card's wing, the
    // reader, the Lair board), each with its own container.
    function _scopedContainer(btn, slug) {
      var sel = '[data-rbx-script="' + String(slug == null ? '' : slug).replace(/["\\]/g, '') + '"]';
      for (var n = btn.parentNode; n && n.nodeType === 1; n = n.parentNode) {
        var hit = n.querySelector(sel);
        if (hit) return hit;
        if (n === root) break;
      }
      return containerFor(slug);
    }

    // _showRules shows one part's chips in the rules panel (each part's
    // group is rendered once, at mount, so its hover cards bind once).
    function _showRules(partKey) {
      if (!rulesSlot) return;
      each(rulesSlot.querySelectorAll('[data-rbx-rules-part]'), function (g) {
        _toggle(g, 'rbx-hidden', g.getAttribute('data-rbx-rules-part') !== partKey);
      });
    }

    // The table and the rules in play get their own panels when the page
    // provides them: filled once here, then repainted as each part plays.
    if (tableSlot) tableSlot.innerHTML = buildLairTable(lair);
    if (rulesSlot) {
      var groups = '', seen = {};
      for (var ps in lairParts) {
        if (!Object.prototype.hasOwnProperty.call(lairParts, ps)) continue;
        var pk = lairParts[ps];
        if (seen[pk]) continue;
        seen[pk] = true;
        var lesson = (lair.lessons && lair.lessons[pk]) || null;
        groups += '<div class="rbx-hidden" data-rbx-rules-part="' + escAttr(pk) + '">' + buildLairRules(lair, pk) +
          (board && lesson ? buildLesson(lesson, startMaliceOf(examples[ps])) : '') + '</div>';
      }
      rulesSlot.innerHTML = groups;
      if (typeof lair.bindTerms === 'function') lair.bindTerms(rulesSlot.querySelectorAll('[data-rb-term]'));
    }

    each(root.querySelectorAll('[data-rbx-play]'), function (btn) { on(btn, 'click', function (e) { e.stopPropagation(); handlePlay(btn); }); });
    each(root.querySelectorAll('[data-rbx-back]'), function (btn) {
      on(btn, 'click', function (e) { e.stopPropagation(); applyShowHide(btn); });
    });

    // The board: its replay button, Esc for the top card, outside-click
    // closing every card, and the stage refitting to a new width.
    if (boardReplay) on(boardReplay, 'click', function (e) {
      e.stopPropagation();
      if (activeBoard) { _cardsClear(activeBoard); playContainer(activeBoard, _scriptOf(activeBoard)); }
    });
    if (board) {
      on(board, 'keydown', function (e) {
        if (e.key !== 'Escape' || !activeBoard) return;
        var live = _liveCards(activeBoard);
        if (!live.length) return;
        e.preventDefault();
        e.stopPropagation();
        _closeFrom(activeBoard, _scriptOf(activeBoard), live[live.length - 1]);
      });
      on(root.ownerDocument, 'pointerdown', function (e) {
        if (!activeBoard || !_liveCards(activeBoard).length) return;
        if (_up(e.target, '.rbs-pcard,.rbs-kcard,[data-rbs-card],.rbs-kw', null)) return;
        _closeAll(activeBoard, _scriptOf(activeBoard));
      });
      on(win, 'resize', function () { if (activeBoard && activeBoard.__rbsScene) _bvFit(activeBoard); });
      board.insertAdjacentHTML('afterbegin', sceneDefs());
    }

    function stopAll() {
      if (win) { for (var i = 0; i < timeouts.length; i++) win.clearTimeout(timeouts[i]); for (var j = 0; j < intervals.length; j++) win.clearInterval(intervals[j]); }
      timeouts = []; intervals = [];
      each(root.querySelectorAll('[data-rbx-script]'), function (c) { c.__rbx = null; bumpRun(c); _cardsClear(c); });
    }
    // _collapseNow removes the shown/played state from every script so a reopened
    // fold shows its clean default (mirrors the mockup's .script.on cleanup).
    function _collapseNow() {
      each(root.querySelectorAll('[data-rbx-script].rbx-on'), function (c) { c.classList.remove('rbx-on'); c.__rbx = null; bumpRun(c); });
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
    // play(slug, { hold }) shows a script: on the board when the board has
    // it (hold keeps its book shut until a second play without hold),
    // else in its first container.
    function play(slug, o) {
      if (!examples[slug]) return;
      var bc = board && board.querySelector('[data-rbx-script="' + String(slug).replace(/["\\]/g, '') + '"]');
      if (bc) { _boardShow(bc, slug, o); return; }
      var c = containerFor(slug);
      if (c) { c.classList.add('rbx-on'); playContainer(c, slug); }
    }

    return { destroy: destroy, play: play, stopAll: stopAll, collapseAll: collapseAll, shut: shut };
  }

  return {
    TICK_MS: TICK_MS, DICE_TICKS: DICE_TICKS, STEP_MS: STEP_MS,
    ROLL_AFTER_MS: ROLL_AFTER_MS, LINE_MS: LINE_MS,
    esc: esc, richText: richText, richTerm: richTerm,
    isRoll: isRoll, tokenForLine: tokenForLine, rollRevealOrder: rollRevealOrder,
    linesOf: linesOf, computeTableState: computeTableState, startMaliceOf: startMaliceOf,
    startStaminaOf: startStaminaOf, buildLairTable: buildLairTable, buildLairRules: buildLairRules,
    planScript: planScript, buildScriptHtml: buildScriptHtml,
    buildLesson: buildLesson, buildLairExtras: buildLairExtras,
    BEAT_MS: BEAT_MS, MOTIONS: MOTIONS, BACKDROPS: BACKDROPS, KIT: KIT,
    parseRef: parseRef, rollFacts: rollFacts, validateScene: validateScene, beatState: beatState,
    showTierFor: showTierFor, buildRefs: buildRefs, termHtml: termHtml, resolveKeyword: resolveKeyword,
    resolveCard: resolveCard, buildCardHtml: buildCardHtml, captionHtml: captionHtml,
    buildSceneHtml: buildSceneHtml, buildBoardViewHtml: buildBoardViewHtml, sceneCss: sceneCss,
    mount: mount
  };
})();

// Test seam: expose the module for Node unit tests. Inert in a browser (no
// CommonJS `module`); in the browser the `RulebookExamplePlayer` global is what
// widget scripts consume.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RulebookExamplePlayer;
}
