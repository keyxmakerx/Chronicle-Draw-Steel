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
    // The null-root mount must return the SAME shape as a real one, or a
    // caller that mounts without a root gets a TypeError instead of a no-op.
    if (!root) return { destroy: noop, play: noop, stopAll: noop, collapseAll: noop };
    var opts = options || {};
    var win = (typeof window !== 'undefined') ? window : null;
    var examples = opts.examples || {};
    // lair carries the worked-scene's table/rulesInPlay/lessons + which part
    // each script slug belongs to, plus the fold engine's bindTerms (shared
    // glossary hover card) — all optional; a script with no matching part
    // renders with no table/lesson extras, same as before v10.4.
    var lair = opts.lair || {};
    var lairParts = lair.partsBySlug || {};
    // onPart(partKey | null) tells the page which Lair part is on screen
    // (null: back to the overview), so it can bring out that part's panels.
    var onPart = typeof lair.onPart === 'function' ? lair.onPart : null;
    // The page may give the table and the rules in play panels of their own
    // ([data-rbx-lair-table] / [data-rbx-lair-rules]); without them both
    // render with each part's script, as before.
    var tableSlot = root.querySelector('[data-rbx-lair-table]');
    var rulesSlot = root.querySelector('[data-rbx-lair-rules]');
    var activeLair = null;   // the Lair part's script container now driving the table
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
      function paintBars(scope) {
        each(scope.querySelectorAll('[data-rbx-hero]'), function (bar) {
          var slug = bar.getAttribute('data-rbx-hero');
          var pct = st.stamina[slug];
          bar.style.width = (pct == null ? 100 : Math.max(0, Math.min(100, pct))) + '%';
        });
      }
      paintBars(container);
      if (tableSlot && container === activeLair) paintBars(tableSlot);
      if (st.squadCount != null) {
        each(container.querySelectorAll('[data-rbx-minion]'), function (m, i) { _toggle(m, 'rbx-down', i < st.squadFallen); });
      }
      var capEl = container.querySelector('[data-rbx-captain]');
      if (capEl && st.captainUp != null) _toggle(capEl, 'rbx-down', !st.captainUp);
      var maliceEl = container.querySelector('[data-rbx-malice]');
      if (maliceEl && st.malice != null) maliceEl.textContent = String(st.malice);
      var vicEl = container.querySelector('[data-rbx-victories]');
      if (vicEl) vicEl.textContent = String(st.victories);
      if (st.tally) {
        _renderPips(container.querySelector('[data-rbx-tally-success]'), st.tally.success);
        _renderPips(container.querySelector('[data-rbx-tally-failure]'), st.tally.failure);
      }
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
      container.innerHTML = buildScriptHtml(data);
      var partKey = lairParts[slug];
      if (partKey) container.insertAdjacentHTML('beforeend',
        buildLairExtras(partKey, lair, startMaliceOf(data), { table: !!tableSlot, rules: !!rulesSlot }));
      container.setAttribute('data-rbx-rendered', '1');
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
    function playContainer(container, slug) {
      if (!container) return;
      ensureRendered(container, slug);
      bumpRun(container);
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
      var container = containerFor(slug);
      if (!container) return;
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
      if (partKey && onPart) onPart(partKey);
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
        groups += '<div class="rbx-hidden" data-rbx-rules-part="' + escAttr(pk) + '">' + buildLairRules(lair, pk) + '</div>';
      }
      rulesSlot.innerHTML = groups;
      if (typeof lair.bindTerms === 'function') lair.bindTerms(rulesSlot.querySelectorAll('[data-rb-term]'));
    }

    each(root.querySelectorAll('[data-rbx-play]'), function (btn) { on(btn, 'click', function (e) { e.stopPropagation(); handlePlay(btn); }); });
    each(root.querySelectorAll('[data-rbx-back]'), function (btn) {
      on(btn, 'click', function (e) { e.stopPropagation(); applyShowHide(btn); if (onPart) onPart(null); });
    });

    function stopAll() {
      if (win) { for (var i = 0; i < timeouts.length; i++) win.clearTimeout(timeouts[i]); for (var j = 0; j < intervals.length; j++) win.clearInterval(intervals[j]); }
      timeouts = []; intervals = [];
      each(root.querySelectorAll('[data-rbx-script]'), function (c) { c.__rbx = null; bumpRun(c); });
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
    function play(slug) { if (!examples[slug]) return; var c = containerFor(slug); if (c) { c.classList.add('rbx-on'); playContainer(c, slug); } }

    return { destroy: destroy, play: play, stopAll: stopAll, collapseAll: collapseAll };
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
    mount: mount
  };
})();

// Test seam: expose the module for Node unit tests. Inert in a browser (no
// CommonJS `module`); in the browser the `RulebookExamplePlayer` global is what
// widget scripts consume.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RulebookExamplePlayer;
}
