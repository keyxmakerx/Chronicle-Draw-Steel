/**
 * Draw Steel Negotiation Audience Widget
 *
 * A pop-up book for the Handbook's Negotiation chapter: a card on the page
 * opens a cut-paper throne room where the reader talks a king round, picking
 * who speaks and what they say, and rolling for it.
 *
 * Every number the scene moves comes from data/negotiation.json (the neutral
 * attitude, the argument and uncovering tables, the offers); the king, his
 * court, the heroes and their lines are an example written for this package.
 * The pure rules live in `Audience` below and are exported for
 * tools/test-negotiation-audience.mjs.
 */
(function () {
  'use strict';

  var METER_MAX = 5;

  // ── The scene: our own example, not rules text ──────────────

  var HEROES = [
    { id: 'orden', name: 'Orden', st: { Presence: 2, Reason: 1, Intuition: 0 } },
    { id: 'sera', name: 'Sera', st: { Presence: 0, Reason: 2, Intuition: 1 } },
    { id: 'mira', name: 'Mira', st: { Presence: 1, Reason: 0, Intuition: 2 } }
  ];
  // What moves King Aldric. The table finds these by asking, reading or trying.
  var MOT = [
    { k: 'legacy', name: 'Legacy', kind: 'm' },
    { k: 'protection', name: 'Protection', kind: 'm' },
    { k: 'greed', name: 'Greed', kind: 'p' }
  ];
  var LINES = [
    { id: 'legacy1', k: 'legacy', ch: 'Presence', text: 'Hold the Gate, Majesty, and the bards will sing of King Aldric for a thousand years.' },
    { id: 'prot1', k: 'protection', ch: 'Reason', text: 'If the Gate falls, the host reaches Kestrel by midsummer. Your people first.' },
    { id: 'greed1', k: 'greed', ch: 'Presence', text: 'We’ll pay. Three chests of demon-gold from the last battle are yours.' },
    { id: 'just1', k: 'justice', ch: 'Intuition', text: 'They burned Harrowfield to the ground. Those people deserve justice.' },
    { id: 'lie1', k: 'power', lie: true, ch: 'Presence', text: 'Duke Morrow has already sent his knights. You’d hardly want to be outdone.' },
    { id: 'legacy2', k: 'legacy', ch: 'Reason', text: 'Your grandfather built the Marrow Gate. Let your name be the next one carved on it.' },
    { id: 'peace1', k: 'peace', ch: 'Reason', text: 'Break the host at the Gate and the March sleeps quiet for a generation.' },
    { id: 'greed2', k: 'greed', ch: 'Reason', text: 'Once the pass is safe, the tolls alone would fill your vault.' },
    { id: 'prot2', k: 'protection', ch: 'Intuition', text: 'You fear for your people. So do we. Let us stand between them and the host.' },
    { id: 'auth1', k: 'authority', ch: 'Presence', text: 'The old oaths bind the March to the Crown. The Queen would expect this of you.' }
  ];
  // What Aldric gives at each interest; the response word comes from the data.
  var OFFER_TEXT = {
    5: 'Two hundred knights, and I ride at their head.',
    4: 'Two hundred knights. Send word when the Gate holds.',
    3: 'Two hundred knights, once you clear the brigands off the King’s Road.',
    2: 'I can’t spare knights. Take fifty archers, no more.',
    1: 'My knights stay home.',
    0: 'Get out. And don’t expect my roads open to you again.'
  };
  var HINTS = {
    legacy: 'My grandfather raised that Gate. I’ll not have it fall in my reign.',
    protection: 'My people sleep under these walls. Keep them safe and we’ll talk.'
  };
  var SAY = {
    up: ['That’s an excellent point.', 'You’ve given me much to consider.', 'Fair enough.', 'Makes sense to me.'],
    down: ['I don’t buy that.', 'Poppycock!', 'I hear you, but I disagree.', 'That’s not going to sway me.'],
    flat: ['I’ve heard that before.', 'Are you going to offer me anything real?', 'This debate is tiresome.']
  };
  var ASK_TEXT = 'What would you want from this, Majesty?';

  // ── Pure rules (no DOM) ─────────────────────────────────────

  function clamp(n) { return Math.max(0, Math.min(METER_MAX, n)); }
  function num(v) { v = Number(v); return isNaN(v) ? 0 : v; }
  function delta(d) { return { interest: num(d && d.interest), patience: num(d && d.patience) }; }
  function tiers(t) {
    if (!t || !t.t1 || !t.t2 || !t.t3) return null;
    return { 1: delta(t.t1), 2: delta(t.t2), 3: delta(t.t3) };
  }

  // rulesFrom reads the tables the scene needs from negotiation.json, or
  // returns null when one is missing, so the page says so instead of guessing.
  function rulesFrom(entries) {
    var by = {};
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (e && typeof e.slug === 'string') by[e.slug] = (e.properties && typeof e.properties === 'object') ? e.properties : {};
    });
    var p = function (s) { return by[s] || null; };
    var R = {
      appeal: tiers((p('argument-appeal-to-motivation') || {}).tiers),
      none: tiers((p('argument-no-motivation') || {}).tiers),
      uncover: tiers((p('uncovering-motivations') || {}).tiers),
      reused: p('argument-motivation-reused') && delta(p('argument-motivation-reused')),
      pitfall: p('argument-pitfall-used') && delta(p('argument-pitfall-used')),
      lie: p('argument-caught-in-lie') && delta(p('argument-caught-in-lie')),
      start: p('attitude-neutral'),
      offers: {}
    };
    for (var i = 0; i <= METER_MAX; i++) {
      var o = p('offer-interest-' + i);
      if (!o || typeof o.response !== 'string') return null;
      R.offers[i] = o.response;
    }
    if (!R.appeal || !R.none || !R.uncover || !R.reused || !R.pitfall || !R.lie || !R.start) return null;
    R.start = { interest: clamp(num(R.start.interest)), patience: clamp(num(R.start.patience)) };
    return R;
  }

  // newGame starts the audience from a neutral attitude. Sera speaks the
  // king's own tongue, which "Language and Patience" rewards with +1 patience.
  function newGame(R) {
    return {
      interest: R.start.interest, patience: clamp(R.start.patience + 1), basePatience: R.start.patience,
      who: HEROES[0].id, said: {}, used: {}, shown: {},
      canRead: true, asked: false, over: false, round: 1
    };
  }

  // A power roll is 2d10 plus a characteristic: 11 or less is tier 1, 12 to
  // 16 tier 2, 17 or more tier 3.
  function tierOf(total) { return total <= 11 ? 1 : total <= 16 ? 2 : 3; }
  function rollWith(dice, bonus) {
    var t = dice[0] + dice[1] + bonus;
    return { a: dice[0], b: dice[1], bonus: bonus, total: t, tier: tierOf(t), nat: dice[0] + dice[1] };
  }
  function motive(k) {
    for (var i = 0; i < MOT.length; i++) if (MOT[i].k === k) return MOT[i];
    return null;
  }
  function hero(id) {
    for (var i = 0; i < HEROES.length; i++) if (HEROES[i].id === id) return HEROES[i];
    return HEROES[0];
  }
  function apply(G, d) {
    G.interest = clamp(G.interest + d.interest);
    G.patience = clamp(G.patience + d.patience);
  }

  // argue resolves one line by the published argument rules. dice is the
  // pair to use when the line needs a roll. Any try at a motivation counts
  // as appealing to it, so a second try is the "already appealed to" case.
  function argue(R, G, line, dice) {
    var h = hero(G.who), m = motive(line.k), out = { line: line, hero: h, roll: null, d: { interest: 0, patience: 0 } };
    G.said[line.id] = true;
    G.canRead = true;
    G.round++;
    if (m && m.kind === 'p') {
      G.shown[m.k] = true;
      out.kind = 'pitfall'; out.d = delta(R.pitfall);
    } else if (m && G.used[m.k]) {
      out.kind = 'reused'; out.d = delta(R.reused);
    } else if (m) {
      G.shown[m.k] = true; G.used[m.k] = true;
      out.kind = 'appeal'; out.roll = rollWith(dice, h.st[line.ch]);
      out.d = delta(R.appeal[out.roll.tier]);
    } else {
      out.kind = 'none'; out.roll = rollWith(dice, h.st[line.ch]);
      out.d = delta(R.none[out.roll.tier]);
      // "No Motivation or Pitfall": a natural 19 or 20 keeps their patience.
      if (out.roll.nat >= 19) { out.d.patience = 0; out.keptPatience = true; }
    }
    // A lie that fails to raise interest can be caught.
    if (line.lie && out.d.interest <= 0) {
      out.caught = true;
      out.d.interest += R.lie.interest;
      out.d.patience += R.lie.patience;
    }
    apply(G, out.d);
    return out;
  }

  // read is the uncovering test. On tier 3 the hero picks what to learn; the
  // scene picks a pitfall first, since asking can only reveal motivations.
  function read(R, G, dice) {
    var h = hero(G.who), r = rollWith(dice, h.st.Intuition), out = { hero: h, roll: r, d: delta(R.uncover[r.tier]), learned: null };
    G.canRead = false;
    if (r.tier === 3) {
      var pick = null;
      for (var i = 0; i < MOT.length && !pick; i++) if (MOT[i].kind === 'p' && !G.shown[MOT[i].k]) pick = MOT[i];
      for (var j = 0; j < MOT.length && !pick; j++) if (!G.shown[MOT[j].k]) pick = MOT[j];
      if (pick) { G.shown[pick.k] = true; out.learned = pick; }
    }
    apply(G, out.d);
    return out;
  }

  // ask is "What do you want out of this deal?": the NPC hints at a motivation.
  function ask(G) {
    G.asked = true;
    for (var i = 0; i < MOT.length; i++) {
      if (MOT[i].kind === 'm' && !G.shown[MOT[i].k]) { G.shown[MOT[i].k] = true; return MOT[i]; }
    }
    return null;
  }

  // ending is "Keep Going or Stop": interest 0 ends it with no deal; after an
  // argument, interest 5 or patience 0 is a final offer, otherwise an offer
  // the heroes may take while they keep talking.
  function ending(G, argued) {
    if (G.interest <= 0) return 'refused';
    if (G.patience <= 0 || (argued && G.interest >= METER_MAX)) return 'final';
    return argued ? 'offer' : null;
  }

  // The three lines on offer: unsaid lines in order, never two on one subject.
  function linesNow(G) {
    var seen = {}, show = [];
    LINES.forEach(function (l) {
      if (!G.said[l.id] && show.length < 3 && !seen[l.k]) { seen[l.k] = 1; show.push(l); }
    });
    return show;
  }

  var Audience = {
    HEROES: HEROES, MOT: MOT, LINES: LINES, OFFER_TEXT: OFFER_TEXT,
    rulesFrom: rulesFrom, newGame: newGame, tierOf: tierOf, argue: argue, read: read, ask: ask,
    ending: ending, linesNow: linesNow
  };
  if (typeof window !== 'undefined') window.ChronicleDrawSteelAudience = Audience;
  if (typeof module !== 'undefined' && module.exports) module.exports = Audience;

  // ── UI ──────────────────────────────────────────────────────

  if (typeof Chronicle === 'undefined' || !Chronicle || typeof Chronicle.register !== 'function') return;

  var STYLE_ID = 'nga-style';
  var SHUT_MS = 650;

  // The board is a dark cut-paper stage in either theme, like the Lair's, so
  // its colours are its own; the card on the page takes the book's fonts.
  function css() {
    var D = 'var(--nga-display,"Big Shoulders Display","Oswald","Arial Narrow",Impact,sans-serif)';
    var U = 'var(--nga-ui,"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif)';
    var B = 'var(--nga-body,"Source Serif 4",Georgia,serif)';
    return [
      '.nga-card{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:84px 1fr;gap:14px;align-items:center;width:100%;margin:10px 0;padding:14px;' +
        'background:#232833;color:#f4f1ea;border-radius:4px;transition:transform .2s}',
      '.nga-card:hover{transform:translateY(-2px) rotate(-.4deg)}',
      '.nga-card:focus-visible{outline:3px solid #e1a32c;outline-offset:3px}',
      '.nga-card small{font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:#e1a32c}',
      '.nga-card b{display:block;font:900 24px/.95 ' + D + ';text-transform:uppercase;margin:4px 0 6px;color:#f4f1ea}',
      '.nga-card span{font-size:14px;color:#cfd3dc}',
      '.nga-card i{display:block;margin-top:8px;font:700 12px/1 ' + U + ';letter-spacing:.12em;text-transform:uppercase;color:#e1a32c;font-style:normal}',
      '.nga-mini{width:84px;aspect-ratio:3/4;border-radius:2px 5px 5px 2px;background:linear-gradient(135deg,#8e1f2b,#5c1220);' +
        'box-shadow:inset 5px 0 0 #3d0b15,0 6px 10px rgba(0,0,0,.4);display:grid;place-items:center;position:relative}',
      '.nga-mini::after{content:"";position:absolute;inset:6px 6px 6px 10px;border:1.5px solid #e9b84a;border-radius:2px}',
      '.nga-mini svg{width:54%}',
      '.nga-fly{position:fixed;z-index:10001;margin:0;pointer-events:none;transform-origin:0 0}',
      '.nga-problem{padding:10px 12px;border-radius:4px;background:var(--bg-secondary,#f3efe6);color:var(--text-primary,#2b2433);font-size:14px}',
      // the board over the page
      '.nga-veil{position:fixed;inset:0;z-index:9998;background:rgba(8,10,14,.62);opacity:0;transition:opacity .35s}',
      '.nga-veil.nga-on{opacity:1}',
      '.nga-board{position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);width:min(980px,calc(100vw - 24px));max-height:calc(100vh - 24px);' +
        'overflow-y:auto;background:#232833;color:#f4f1ea;border-radius:6px;box-shadow:0 30px 70px rgba(0,0,0,.5);opacity:0;transition:opacity .3s;font:16px/1.5 ' + B + ';text-align:left}',
      '.nga-board.nga-on{opacity:1}',
      '.nga-board *,.nga-board *::before,.nga-board *::after{box-sizing:border-box}',
      '.nga-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:3px solid #c22f39;position:sticky;top:0;background:#232833;z-index:3}',
      '.nga-head h2{font:900 22px/1 ' + D + ';text-transform:uppercase;letter-spacing:.02em;flex:1;min-width:0;margin:0;color:inherit}',
      '.nga-head small{display:block;font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:#e1a32c;margin-bottom:4px}',
      '.nga-ib{all:unset;cursor:pointer;width:34px;height:34px;display:grid;place-items:center;border-radius:3px;font:700 16px/1 ' + U + ';color:#f4f1ea;background:rgba(255,255,255,.08)}',
      '.nga-ib:hover,.nga-ib:focus-visible{background:rgba(255,255,255,.18)}',
      // the 3D stage: a 700x520 scene scaled to fit, tall enough that the
      // book's near edge and the swinging cover never clip
      '.nga-scene{position:relative;height:calc(520px * var(--nga-s,1));overflow:hidden;' +
        'background:radial-gradient(80% 70% at 50% 110%,rgba(225,163,44,.35),transparent 70%),radial-gradient(130% 100% at 50% 0%,#3a1c2a 0%,#140c14 75%)}',
      '.nga-fit{position:absolute;left:50%;top:0;width:700px;height:520px;margin-left:-350px;transform:scale(var(--nga-s,1));transform-origin:50% 0}',
      '.nga-pbook{position:absolute;left:0;right:0;top:48px;height:360px;perspective:1200px;perspective-origin:50% 0%}',
      '.nga-spread{position:absolute;left:50px;top:150px;width:600px;height:250px;transform-style:preserve-3d;transform:rotateX(58deg)}',
      '.nga-page{position:absolute;top:0;width:300px;height:250px;background:#efe9dc;transform-style:preserve-3d}',
      '.nga-pl{left:0;border-radius:6px 0 0 6px;box-shadow:inset -26px 0 30px -18px rgba(40,20,20,.5);transform-origin:100% 50%;transition:transform 1100ms cubic-bezier(.6,.05,.25,1)}',
      '.nga-pr{left:300px;border-radius:0 6px 6px 0;box-shadow:inset 26px 0 30px -18px rgba(40,20,20,.5)}',
      '.nga-page::after{content:"";position:absolute;inset:10px;border:1.5px solid rgba(120,30,40,.35);border-radius:3px}',
      '.nga-closed .nga-pl{transform:rotateY(180deg) translateZ(-2px)}',
      '.nga-shutting .nga-pl{transition-duration:' + SHUT_MS + 'ms;transition-timing-function:cubic-bezier(.5,0,.4,1)}',
      '.nga-cover{position:absolute;inset:0;border-radius:6px;transform:rotateY(180deg) translateZ(1px);backface-visibility:hidden;background:linear-gradient(135deg,#8e1f2b,#4e0f1b);' +
        'box-shadow:inset 0 0 0 7px #3d0b15,inset 0 0 0 9px #e9b84a;display:grid;place-items:center;text-align:center;font:900 30px/.9 ' + D + ';color:#f6dfa4;text-transform:uppercase;padding:0 30px}',
      '.nga-runner{position:absolute;left:380px;top:96px;width:90px;height:154px;background:#8e1f2b;transform:translateZ(1px);border-left:3px solid #e9b84a;border-right:3px solid #e9b84a}',
      // a standing piece is hinged on its bottom edge: face-down when folded
      '.nga-pop{position:absolute;transform-origin:50% 100%;transform-style:preserve-3d;transform:rotateX(-180deg);transition:transform 380ms ease-in}',
      '.nga-pop.nga-up{transform:rotateX(-90deg);transition:transform 700ms cubic-bezier(.3,1.6,.5,1)}',
      '.nga-opening .nga-pop.nga-up{transition-delay:calc(800ms + var(--i,0) * 110ms)}',
      '.nga-closed .nga-pop.nga-up{transform:rotateX(-180deg);transition:transform 380ms ease-in}',
      '.nga-pop>.nga-pc{position:absolute;inset:0;transform-origin:50% 100%;backface-visibility:hidden;transition:transform 460ms cubic-bezier(.4,1.4,.5,1),filter .3s,opacity .4s}',
      '.nga-art{display:block;width:100%;height:100%;overflow:visible;filter:url(#nga-cut)}',
      '.nga-shade{position:absolute;transform:translateZ(.5px);background:radial-gradient(closest-side,rgba(60,20,10,.45),transparent)}',
      '.nga-closed .nga-shade{opacity:0}',
      '.nga-lean>.nga-pc{transform:translateX(-14px) rotate(-4deg)}',
      '.nga-recoil>.nga-pc{transform:translateX(12px) rotate(5deg)}',
      '.nga-stepin>.nga-pc{transform:translateX(26px) rotate(3deg)}',
      '.nga-glow>.nga-pc{filter:drop-shadow(0 0 10px rgba(255,200,90,.9))}',
      '.nga-arm{transform-box:fill-box;transform-origin:20% 90%;transition:transform 380ms cubic-bezier(.4,1.5,.5,1)}',
      '.nga-gesture .nga-arm{transform:rotate(-38deg)}',
      '.nga-spear{transform-box:fill-box;transform-origin:50% 100%;transition:transform .45s cubic-bezier(.4,1.5,.5,1)}',
      '.nga-cross .nga-spear{transform:rotate(var(--cr,18deg))}',
      '.nga-shy>.nga-pc{opacity:0}.nga-shy.nga-up>.nga-pc{opacity:1}',
      '.nga-flame{transform-box:fill-box;transform-origin:50% 100%;animation:nga-flick 1s ease-in-out infinite alternate}',
      '@keyframes nga-flick{50%{transform:scale(.9,1.1) skewX(-4deg)}100%{transform:scale(1.05,.94) skewX(3deg)}}',
      // speech bubbles float over the scene, outside the 3D
      '.nga-bub{position:absolute;z-index:2;max-width:240px;background:#fffaf0;color:#1c1418;font:600 15px/1.3 ' + B + ';padding:9px 12px;border-radius:14px;' +
        'border:2.5px solid #1c1418;box-shadow:3px 3px 0 #1c1418;transform-origin:var(--ox,20%) 120%;transform:scale(.2);opacity:0;transition:transform .35s cubic-bezier(.3,1.7,.5,1),opacity .2s}',
      '.nga-bub.nga-on{transform:scale(1);opacity:1}',
      '.nga-bub::after{content:"";position:absolute;bottom:-13px;left:var(--tx,26px);width:18px;height:14px;background:#fffaf0;border:2.5px solid #1c1418;border-top:0;border-left:0;transform:skewX(var(--sk,30deg))}',
      '.nga-bub small{display:block;font:700 10px/1 ' + U + ';letter-spacing:.16em;text-transform:uppercase;color:#8e1f2b;margin-bottom:3px}',
      '.nga-king{right:6%;top:6%;--ox:80%;--sk:-30deg}.nga-king::after{left:auto;right:34px}',
      '.nga-hero{left:4%;top:30%}',
      '.nga-bub.nga-up-m{border-color:#1d6b3a;box-shadow:3px 3px 0 #1d6b3a}',
      '.nga-bub.nga-down-m{border-color:#8e1f2b;box-shadow:3px 3px 0 #8e1f2b}',
      // the table under the scene
      '.nga-table{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}',
      '.nga-col{padding:14px;min-width:0}.nga-col+.nga-col{border-left:1px solid rgba(255,255,255,.1)}',
      '.nga-lab{font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:#e1a32c;margin:0 0 8px;display:flex;justify-content:space-between;gap:8px}',
      '.nga-lab em{font-style:normal;color:#aab1be;letter-spacing:.08em}',
      '.nga-who{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}',
      '.nga-who button{all:unset;cursor:pointer;padding:6px 9px;border-radius:3px;background:rgba(255,255,255,.07);font:600 13px/1.2 ' + U + ';border:1.5px solid transparent}',
      '.nga-who button small{display:block;font:500 11px/1 ' + U + ';color:#aab1be;letter-spacing:.04em;margin-top:2px}',
      '.nga-who button[aria-pressed="true"]{border-color:#e1a32c;background:rgba(225,163,44,.14)}',
      '.nga-who button:focus-visible{outline:3px solid #e1a32c;outline-offset:2px}',
      '.nga-lines{display:grid;gap:6px}',
      '.nga-line{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:start;padding:10px 12px;border-radius:4px;' +
        'background:#fffaf0;color:#1c1418;border:2px solid #1c1418;box-shadow:3px 3px 0 rgba(0,0,0,.55);transition:transform .12s,box-shadow .12s}',
      '.nga-line:hover,.nga-line:focus-visible{transform:translate(-1px,-1px);box-shadow:5px 5px 0 rgba(0,0,0,.55)}',
      '.nga-line:focus-visible{outline:3px solid #e1a32c;outline-offset:2px}',
      '.nga-line q{font:600 15px/1.35 ' + B + ';quotes:"\\201C" "\\201D"}',
      '.nga-line span{font:700 11px/1 ' + U + ';letter-spacing:.1em;text-transform:uppercase;background:#232833;color:#f4f1ea;padding:5px 6px;border-radius:2px;white-space:nowrap}',
      '.nga-line small{grid-column:1/-1;font:500 12px/1.2 ' + U + ';color:#5d4a50;letter-spacing:.03em}',
      '.nga-act{background:#2c3340;color:#f4f1ea;border-color:#0d0f13}.nga-act small{color:#b9c0cc}.nga-act span{background:#e1a32c;color:#1c1418}',
      '.nga-line[disabled]{opacity:.45;cursor:default;transform:none}',
      '.nga-end{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
      '.nga-btn{all:unset;cursor:pointer;font:700 13px/1 ' + U + ';letter-spacing:.1em;text-transform:uppercase;padding:10px 14px;border-radius:3px;background:#c22f39;color:#fff}',
      '.nga-btn.nga-ghost{background:transparent;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.4)}',
      '.nga-btn:focus-visible{outline:3px solid #e1a32c;outline-offset:2px}',
      '.nga-track{margin-bottom:12px}.nga-pips{display:flex;gap:5px}',
      '.nga-pip{flex:1;height:28px;border-radius:3px;background:rgba(255,255,255,.07);display:grid;place-items:center;font:700 12px/1 ' + U + ';color:#7e8796;transition:background .3s}',
      '.nga-pip.nga-on{background:var(--pc);color:#1c1418}.nga-pip.nga-bump{animation:nga-bump .5s}',
      '@keyframes nga-bump{40%{transform:scale(1.25)}}',
      '.nga-ti{--pc:#e1a32c}.nga-tp{--pc:#8fb4e8}',
      '.nga-offer{font:600 14px/1.3 ' + B + ';margin:6px 0 0;color:#e8dccb}.nga-offer b{color:#e1a32c;font-family:' + U + ';letter-spacing:.06em}',
      '.nga-roll{display:grid;grid-template-columns:auto 1fr;gap:10px 14px;align-items:center;background:rgba(0,0,0,.25);border-radius:4px;padding:10px 12px;margin-bottom:12px}',
      '.nga-dice{display:flex;gap:6px}',
      '.nga-die{width:38px;height:42px;display:grid;place-items:center;background:#f4f1ea;color:#1c1418;font:900 22px/1 ' + D + ';' +
        'clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%);font-variant-numeric:tabular-nums}',
      '.nga-die.nga-spin{animation:nga-tumble .55s cubic-bezier(.3,1.4,.5,1)}',
      '@keyframes nga-tumble{0%{transform:translateY(-16px) rotate(-200deg) scale(.6)}100%{transform:none}}',
      '.nga-rtx{font-size:14px;line-height:1.4;min-width:0}.nga-rtx b{color:#e1a32c}',
      '.nga-band{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:4px}',
      '.nga-band span{font:700 11px/1 ' + U + ';letter-spacing:.08em;text-transform:uppercase;text-align:center;padding:6px 2px;border-radius:2px;background:rgba(255,255,255,.06);color:#8b93a1;transition:background .3s,color .3s}',
      '.nga-band span.nga-on:nth-child(1){background:#5d6f8c;color:#fff}.nga-band span.nga-on:nth-child(2){background:#cf8218;color:#1c1418}.nga-band span.nga-on:nth-child(3){background:#c22f39;color:#fff}',
      '.nga-mots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}',
      '.nga-mot{perspective:600px;height:74px}',
      '.nga-mot>div{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .6s cubic-bezier(.4,1.4,.5,1)}',
      '.nga-mot.nga-shown>div{transform:rotateY(180deg)}',
      '.nga-fd,.nga-fu{position:absolute;inset:0;backface-visibility:hidden;border-radius:4px;padding:7px;display:grid;align-content:center;text-align:center}',
      '.nga-fd{background:repeating-linear-gradient(45deg,#2c3340 0 6px,#262c38 6px 12px);color:#8b93a1;font:700 11px/1.2 ' + U + ';letter-spacing:.12em;text-transform:uppercase}',
      '.nga-fd b{font:900 24px/1 ' + D + ';color:#5d6676}',
      '.nga-fu{transform:rotateY(180deg);background:#fffaf0;color:#1c1418}.nga-mot.nga-p .nga-fu{background:#3a1018;color:#fbe3e5}',
      '.nga-fu small{font:700 10px/1 ' + U + ';letter-spacing:.16em;text-transform:uppercase;color:#8e1f2b}.nga-mot.nga-p .nga-fu small{color:#ff9aa2}',
      '.nga-fu b{font:900 18px/1 ' + D + ';text-transform:uppercase;margin-top:3px}',
      '.nga-mot.nga-used .nga-fu{box-shadow:inset 0 0 0 3px #e1a32c}',
      '.nga-log{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px;line-height:1.4;color:#cfd3dc;max-height:150px;overflow-y:auto}',
      '.nga-log li{padding-left:10px;border-left:2px solid rgba(255,255,255,.18)}.nga-log li b{color:#f4f1ea}',
      '.nga-final{margin-top:10px;padding:12px 14px;border-radius:4px;background:#fffaf0;color:#1c1418;border:2.5px solid #1c1418;box-shadow:4px 4px 0 #e1a32c}',
      '.nga-final small{font:700 11px/1 ' + U + ';letter-spacing:.16em;text-transform:uppercase;color:#8e1f2b}',
      '.nga-final b{display:block;font:900 28px/1 ' + D + ';text-transform:uppercase;margin:4px 0}.nga-final p{margin:0 0 8px;font-size:14px}',
      '.nga-foot{padding:10px 14px 14px;margin:0;font:500 12px/1.4 ' + U + ';color:#8b93a1;letter-spacing:.02em;border-top:1px solid rgba(255,255,255,.08)}',
      '@media (max-width:760px){.nga-table{grid-template-columns:1fr}.nga-col+.nga-col{border-left:0;border-top:1px solid rgba(255,255,255,.1)}' +
        '.nga-scene{height:auto;padding-top:calc(520px * var(--nga-s,1));display:grid;gap:8px}' +
        '.nga-scene .nga-bub{position:static;max-width:none;margin:0 12px;font-size:14px;transform:none;box-shadow:2px 2px 0 #1c1418}' +
        '.nga-scene .nga-bub:not(.nga-on){display:none}.nga-scene .nga-bub:last-child{margin-bottom:12px}.nga-bub::after{display:none}' +
        '.nga-hero{order:1}.nga-king{order:2}}',
      '@media (prefers-reduced-motion:reduce){.nga-board *,.nga-board *::before,.nga-board *::after,.nga-veil,.nga-board,.nga-card{animation-duration:1ms!important;' +
        'animation-iteration-count:1!important;transition-duration:1ms!important;transition-delay:0ms!important}}'
    ].join('\n');
  }

  // ── The cut-paper pieces, drawn for this package ────────────

  var INK = '#1c1418', S = ' stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"';
  // One shared set of SVG defs: a die-cut white edge and the wall's stone.
  var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false" id="nga-defs"><defs>' +
    '<filter id="nga-cut" x="-10%" y="-10%" width="120%" height="125%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="d"/>' +
    '<feFlood flood-color="#fffaf0"/><feComposite in2="d" operator="in" result="w"/><feOffset in="w" dy="2" result="w2"/>' +
    '<feMerge><feMergeNode in="w2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<pattern id="nga-stone" width="40" height="22" patternUnits="userSpaceOnUse"><rect width="40" height="22" fill="#6d5866"/>' +
    '<path d="M0 11h40M20 0v11M0 22V11M40 22V11" stroke="#4d3a47" stroke-width="2"/></pattern></defs></svg>';
  function svg(vb, inner) {
    return '<svg class="nga-art" viewBox="' + vb + '" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  function arm(d, w, col) {
    return '<g class="nga-arm"><path d="' + d + '" stroke="' + INK + '" stroke-width="' + w + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" stroke="' + col + '" stroke-width="' + (w - 4) + '" stroke-linecap="round"/></g>';
  }
  function staff(d) {
    return '<path d="' + d + '" stroke="' + INK + '" stroke-width="5" stroke-linecap="round" fill="none"/><path d="' + d + '" stroke="#8a6a4a" stroke-width="2.5" fill="none"/>';
  }
  var ART = {
    wall: svg('0 0 540 190',
      '<path d="M0 190V36l20-8V6h40v18h40V6h40v18h40V6h40v18h40V6h40v18h40V6h40v18h40V6h40v22l20 8v154z" fill="url(#nga-stone)"' + S + '/>' +
      '<path d="M120 170V80a30 30 0 0 1 60 0v90zM360 170V80a30 30 0 0 1 60 0v90z" fill="#f08a3a"' + S + '/>' +
      '<path d="M150 170V58M390 170V58M360 120h60M120 120h60" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M232 40h76v104l-38-18-38 18z" fill="#8e1f2b"' + S + '/><path d="M252 70l6 18 12-14 12 14 6-18v26h-36z" fill="#e9b84a"' + S + '/>' +
      '<path d="M30 46h52v86l-26-14-26 14z" fill="#8e1f2b"' + S + '/><path d="M458 46h52v86l-26-14-26 14z" fill="#8e1f2b"' + S + '/>'),
    king: svg('0 0 170 170',
      '<path d="M30 168V40l18-30 18 20 19-28 19 28 18-20 18 30v128z" fill="#8e1f2b"' + S + '/>' +
      '<path d="M44 160V50h82v110" fill="none" stroke="#e9b84a" stroke-width="4"/>' +
      '<path d="M18 168v-46h28v46zM124 168v-46h28v46z" fill="#e9b84a"' + S + '/>' +
      '<path d="M52 168c0-40 10-74 33-74s33 34 33 74z" fill="#5a3a98"' + S + '/>' +
      '<path d="M76 98h18l-9 46z" fill="#f4f1ea"' + S + '/>' +
      '<circle cx="85" cy="74" r="17" fill="#e8b48f"' + S + '/>' +
      '<path d="M70 80c4 22 26 22 30 0-4 6-26 6-30 0z" fill="#d9d4cc"' + S + '/>' +
      '<path d="M68 60l6-16 6 10 5-14 5 14 6-10 6 16z" fill="#e9b84a"' + S + '/>' +
      '<g class="nga-arm"><path d="M114 118l20-44" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M114 118l20-44" stroke="#e9b84a" stroke-width="3" stroke-linecap="round"/><circle cx="135" cy="70" r="7" fill="#e9b84a"' + S + '/></g>'),
    guard: svg('0 0 70 160',
      '<g class="nga-spear"><path d="M54 158V12" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/><path d="M54 158V12" stroke="#8a6a4a" stroke-width="3"/>' +
      '<path d="M54 0l7 16H47z" fill="#c9cfd8"' + S + '/></g>' +
      '<path d="M16 158l4-56h32l4 56z" fill="#4b5f86"' + S + '/>' +
      '<path d="M14 106c0-26 8-42 22-42s22 16 22 42z" fill="#a9b2bf"' + S + '/>' +
      '<path d="M22 50c0-14 6-22 14-22s14 8 14 22v12H22z" fill="#a9b2bf"' + S + '/><path d="M26 48h20" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M2 82h22v40l-11 10-11-10z" fill="#8e1f2b"' + S + '/>'),
    orden: svg('0 0 90 120',
      '<path d="M22 118l4-40h34l4 40z" fill="#4b5f86"' + S + '/>' +
      '<path d="M20 82c0-24 10-36 24-36s24 12 24 36z" fill="#a9b2bf"' + S + '/>' +
      '<circle cx="44" cy="34" r="14" fill="#c9895f"' + S + '/><path d="M30 30c4-14 24-14 28 0" fill="#3a2a22"' + S + '/>' +
      '<path d="M2 64h30v38l-15 14-15-14z" fill="#1d7f80"' + S + '/><path d="M17 72v32M8 84h18" stroke="#e9b84a" stroke-width="3"/>' +
      arm('M62 70l18-22', 9, '#a9b2bf')),
    sera: svg('0 0 80 110',
      '<path d="M16 108c2-34 10-56 24-56s22 22 24 56z" fill="#5a3a98"' + S + '/>' +
      '<circle cx="40" cy="36" r="13" fill="#e8b48f"' + S + '/><path d="M26 38c0-18 28-18 28 0-4-6-24-6-28 0z" fill="#c23f2f"' + S + '/>' +
      staff('M10 108V30') + '<circle cx="10" cy="26" r="7" fill="#7fe0e0"' + S + '/>' +
      arm('M58 72l14-18', 8, '#5a3a98')),
    mira: svg('0 0 80 115',
      '<path d="M14 112c2-36 10-60 26-60s24 24 26 60z" fill="#2f7a45"' + S + '/>' +
      '<path d="M22 50c0-24 36-24 36 0l-6 4H28z" fill="#2f7a45"' + S + '/><circle cx="40" cy="44" r="10" fill="#c9895f"' + S + '/>' +
      staff('M8 92C0 64 6 40 20 26') + arm('M58 76l14-16', 8, '#2f7a45')),
    brazier: svg('0 0 40 70',
      '<path d="M8 70l6-28h12l6 28z" fill="#4d3a47"' + S + '/><path d="M2 40h36l-6 8H8z" fill="#e9b84a"' + S + '/>' +
      '<path class="nga-flame" d="M20 40C6 30 12 14 20 2c2 10 12 14 10 26 4-2 4-8 4-12 6 10 2 20-14 24z" fill="#f08a3a"' + S + '/>'),
    banner: svg('0 0 120 140',
      '<path d="M58 140V6" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/><path d="M58 140V6" stroke="#8a6a4a" stroke-width="3"/>' +
      '<path d="M62 10h54v70l-27-12-27 12z" fill="#8e1f2b"' + S + '/><path d="M74 30l6 14 9-10 9 10 6-14v20H74z" fill="#e9b84a"' + S + '/>' +
      '<path d="M54 10H4v58l25-10 25 10z" fill="#1d7f80"' + S + '/>')
  };
  // Where each piece stands on the 600x250 spread:
  // [art, left, bottom edge y, width, height, extra classes]
  var PIECES = [
    ['wall', 30, 24, 540, 190], ['brazier', 70, 70, 40, 70], ['brazier', 490, 70, 40, 70],
    ['guard', 268, 80, 70, 160, 'nga-gl'], ['king', 340, 96, 170, 170], ['guard', 512, 80, 70, 160, 'nga-gr'],
    ['banner', 220, 140, 120, 140, 'nga-shy nga-win'],
    ['mira', 40, 236, 80, 115, 'nga-h-mira'], ['orden', 92, 206, 90, 120, 'nga-h-orden'], ['sera', 168, 232, 80, 110, 'nga-h-sera']
  ];
  var CROWN = '<svg viewBox="0 0 40 30" aria-hidden="true" focusable="false"><path d="M3 27L6 9l8 9 6-14 6 14 8-9 3 18z" fill="#e9b84a" stroke="#3d0b15" stroke-width="1.5"/></svg>';

  function sceneHTML() {
    var h = '<div class="nga-page nga-pr"></div><div class="nga-page nga-pl"><div class="nga-cover">Audience with the King</div></div><div class="nga-runner"></div>';
    PIECES.forEach(function (p, i) {
      h += '<div class="nga-shade" style="left:' + (p[1] - 6) + 'px;top:' + (p[2] - 10) + 'px;width:' + (p[3] + 12) + 'px;height:22px"></div>' +
        '<div class="nga-pop nga-up ' + (p[5] || '') + '" data-k="' + p[0] + '" style="--i:' + i + ';left:' + p[1] + 'px;top:' + (p[2] - p[4]) +
        'px;width:' + p[3] + 'px;height:' + p[4] + 'px' + (p[5] === 'nga-gr' ? ';--cr:-18deg' : '') + '"><div class="nga-pc">' + ART[p[0]] + '</div></div>';
    });
    return h;
  }

  function esc(s) {
    return (typeof Chronicle.escapeHtml === 'function') ? Chronicle.escapeHtml(s == null ? '' : String(s))
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }
  function sg(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }
  function calm() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function d10() { return 1 + Math.floor(Math.random() * 10); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css();
    document.head.appendChild(st);
    var holder = document.createElement('div');
    holder.innerHTML = DEFS;
    document.body.appendChild(holder.firstChild);
  }

  function boardHTML() {
    return '<div class="nga-head"><h2 data-n="title"><small>Pop-up book · Negotiation</small>An audience with the King</h2>' +
      '<button class="nga-ib" type="button" data-a="again" aria-label="Start the audience again">↻</button>' +
      '<button class="nga-ib" type="button" data-a="shut" aria-label="Close the pop-up book">✕</button></div>' +
      '<div class="nga-scene" data-n="scene"><div class="nga-fit"><div class="nga-pbook"><div class="nga-spread nga-closed" data-n="spread">' + sceneHTML() + '</div></div></div>' +
      '<div class="nga-bub nga-king" data-n="kBub" aria-live="polite"></div><div class="nga-bub nga-hero" data-n="hBub"></div></div>' +
      '<div class="nga-table"><div class="nga-col">' +
        '<p class="nga-lab">Who speaks <em>everyone can make an argument</em></p><div class="nga-who" data-n="who" role="group" aria-label="Who speaks"></div>' +
        '<p class="nga-lab">What do you say? <em data-n="round"></em></p><div class="nga-lines" data-n="lines"></div><div data-n="endArea"></div></div>' +
      '<div class="nga-col">' +
        '<div class="nga-track nga-ti"><p class="nga-lab">Interest <em data-n="iNow"></em></p><div class="nga-pips" data-n="pI"></div><p class="nga-offer" data-n="offerNow"></p></div>' +
        '<div class="nga-track nga-tp"><p class="nga-lab">Patience <em data-n="pNow"></em></p><div class="nga-pips" data-n="pP"></div></div>' +
        '<div class="nga-roll"><div class="nga-dice"><span class="nga-die" data-n="d1">?</span><span class="nga-die" data-n="d2">?</span></div>' +
        '<div class="nga-rtx" data-n="rtx" aria-live="polite"></div>' +
        '<div class="nga-band" data-n="band"><span>≤11 · Tier 1</span><span>12–16 · Tier 2</span><span>17+ · Tier 3</span></div></div>' +
        '<p class="nga-lab">What moves him <em>found by asking, reading him or trying</em></p><div class="nga-mots" data-n="mots"></div>' +
        '<p class="nga-lab">The talk so far</p><ol class="nga-log" data-n="log"></ol></div></div>' +
      '<p class="nga-foot">Interest, patience, the tests, lies and the offers follow Draw Steel’s Negotiation rules. ' +
        'King Aldric, his court and the lines you can say are an example scene written for this book.</p>';
  }

  // One View per mounted element: boot.js calls init/destroy on the shared
  // registration object, so per-mount state lives here.
  function View(el, campaignId) {
    this.el = el;
    this.cid = campaignId;
    this.R = null;
    this.G = null;
    this.board = null;
    this.timers = [];
  }

  View.prototype.later = function (fn, ms) {
    var self = this, t = window.setTimeout(function () {
      self.timers = self.timers.filter(function (x) { return x !== t; });
      fn();
    }, calm() ? 0 : ms);
    this.timers.push(t);
  };

  View.prototype.mount = function () {
    var self = this;
    injectStyles();
    if (!this.cid) {
      this.el.innerHTML = '<p class="nga-problem">The pop-up book needs a campaign to read the negotiation rules from.</p>';
      return;
    }
    this.el.innerHTML = '<button class="nga-card" type="button" aria-haspopup="dialog" disabled>' +
      '<span class="nga-mini" aria-hidden="true">' + CROWN + '</span>' +
      '<span><small>Pop-up book</small><b>An audience with the King</b>' +
      '<span>Pick what your heroes say, roll, and watch King Aldric decide.</span><i>Open the book →</i></span></button>';
    this.card = this.el.querySelector('.nga-card');
    this.card.addEventListener('click', function () { self.open(); });
    var url = '/campaigns/' + encodeURIComponent(this.cid) + '/systems/drawsteel/data/negotiation.json';
    var fetchFn = (typeof Chronicle.apiFetch === 'function') ? Chronicle.apiFetch : window.fetch.bind(window);
    fetchFn(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      self.R = rulesFrom(data);
      if (!self.R) throw new Error('incomplete rules');
      if (self.card) self.card.disabled = false;
    }).catch(function () {
      if (!self.el) return;
      self.el.innerHTML = '<p class="nga-problem">The pop-up book could not load the negotiation rules, so it stays shut.</p>';
      self.card = null;
    });
  };

  View.prototype.n = function (name) { return this.board.querySelector('[data-n="' + name + '"]'); };
  View.prototype.piece = function (sel) { return this.n('spread').querySelector(sel); };

  View.prototype.note = function (html) {
    var li = document.createElement('li'), log = this.n('log');
    li.innerHTML = html;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  };

  View.prototype.bubble = function (which, who, text, mood) {
    var b = this.n(which);
    b.classList.remove('nga-on', 'nga-up-m', 'nga-down-m');
    if (!text) return;
    b.innerHTML = '<small>' + esc(who) + '</small>' + esc(text);
    void b.offsetWidth;
    b.classList.add('nga-on');
    if (mood === 'up' || mood === 'down') b.classList.add('nga-' + mood + '-m');
  };

  View.prototype.band = function (t) {
    [].forEach.call(this.n('band').children, function (s, i) { s.classList.toggle('nga-on', i + 1 === t); });
  };

  View.prototype.pips = function (el, v, prev) {
    var h = '';
    for (var i = 0; i <= METER_MAX; i++) {
      h += '<span class="nga-pip' + (i > 0 && i <= v ? ' nga-on' : '') +
        (prev !== undefined && prev !== v && i === Math.max(v, prev) ? ' nga-bump' : '') + '">' + i + '</span>';
    }
    el.innerHTML = h;
  };

  View.prototype.motion = function (sel, cls, ms) {
    var p = this.piece(sel);
    if (!p) return;
    p.classList.add(cls);
    this.later(function () { p.classList.remove(cls); }, ms);
  };

  View.prototype.reset = function () {
    var R = this.R, G = this.G = newGame(R), self = this;
    this.busy = false;
    this.n('log').innerHTML = '';
    this.n('endArea').innerHTML = '';
    this.n('d1').textContent = '?';
    this.n('d2').textContent = '?';
    this.n('rtx').innerHTML = 'Pick a line. Arguments are a power roll with the speaker’s characteristic.';
    this.band(0);
    this.bubble('hBub', '', '');
    this.bubble('kBub', '', '');
    [].forEach.call(this.n('spread').querySelectorAll('.nga-pop'), function (p) {
      p.classList.remove('nga-lean', 'nga-recoil', 'nga-stepin', 'nga-glow', 'nga-gesture', 'nga-cross');
    });
    this.piece('.nga-win').classList.remove('nga-up');
    this.note('The audience opens. Aldric is <b>neutral</b>: interest ' + G.interest + ', patience ' + G.basePatience +
      '. Sera greets him in Vaslorian, his own tongue, so his <b>patience starts at ' + G.patience + '</b>.');
    this.later(function () { self.bubble('kBub', 'King Aldric', 'Speak, then. What does the March owe you?', ''); }, 1500);
    this.draw();
  };

  View.prototype.draw = function (pI, pP) {
    var G = this.G, R = this.R, h = hero(G.who), off = this.busy || G.over;
    this.pips(this.n('pI'), G.interest, pI);
    this.pips(this.n('pP'), G.patience, pP);
    this.n('iNow').textContent = G.interest + ' of ' + METER_MAX;
    this.n('pNow').textContent = G.patience + ' left';
    this.n('offerNow').innerHTML = 'His offer right now: <b>' + esc(R.offers[G.interest]) + '</b> ' + esc(OFFER_TEXT[G.interest]);
    this.n('who').innerHTML = HEROES.map(function (x) {
      return '<button type="button" data-who="' + x.id + '" aria-pressed="' + (G.who === x.id) + '"' + (G.over ? ' disabled' : '') + '>' + esc(x.name) +
        '<small>Pre ' + sg(x.st.Presence) + ' · Rea ' + sg(x.st.Reason) + ' · Int ' + sg(x.st.Intuition) + '</small></button>';
    }).join('');
    this.n('mots').innerHTML = MOT.map(function (m) {
      return '<div class="nga-mot' + (m.kind === 'p' ? ' nga-p' : '') + (G.shown[m.k] ? ' nga-shown' : '') + (G.used[m.k] ? ' nga-used' : '') + '"><div>' +
        '<div class="nga-fd"><b>?</b>Not found</div><div class="nga-fu"><small>' + (m.kind === 'm' ? 'Motivation' : 'Pitfall') + '</small><b>' + esc(m.name) + '</b></div></div></div>';
    }).join('');
    this.n('round').textContent = G.over ? 'the audience is over' : 'argument ' + G.round;
    var html = linesNow(G).map(function (l) {
      return '<button type="button" class="nga-line" data-l="' + l.id + '"' + (off ? ' disabled' : '') + '><q>' + esc(l.text) + '</q><span>' + esc(l.ch) + ' ' + sg(h.st[l.ch]) + '</span>' +
        (l.lie ? '<small>A bluff. If it doesn’t raise his interest, he may catch it.</small>' : '') + '</button>';
    }).join('');
    html += '<button type="button" class="nga-line nga-act" data-act="ask"' + (G.asked || off ? ' disabled' : '') + '><q>' + esc(ASK_TEXT) + '</q><span>No roll</span>' +
      '<small>He may hint at what he wants. Once per audience.</small></button>';
    html += '<button type="button" class="nga-line nga-act" data-act="read"' + (!G.canRead || off ? ' disabled' : '') + '><q>' + esc(h.name) + ' studies him while he talks.</q>' +
      '<span>Intuition ' + sg(h.st.Intuition) + '</span><small>' + (G.canRead ? 'A test to learn one motivation or pitfall.' : 'Make an argument before reading him again.') + '</small></button>';
    this.n('lines').innerHTML = html;
  };

  View.prototype.showRoll = function (r) {
    var self = this;
    this.n('d1').textContent = r.a;
    this.n('d2').textContent = r.b;
    ['d1', 'd2'].forEach(function (k) { var d = self.n(k); d.classList.remove('nga-spin'); void d.offsetWidth; d.classList.add('nga-spin'); });
    this.band(r.tier);
    return r.a + ' + ' + r.b + (r.bonus < 0 ? ' − ' : ' + ') + Math.abs(r.bonus) + ' = <b>' + r.total + '</b>, tier ' + r.tier + '.';
  };

  View.prototype.noRoll = function () {
    this.n('d1').textContent = '–';
    this.n('d2').textContent = '–';
    this.band(0);
  };

  function moves(d) {
    var out = [];
    if (d.interest) out.push('interest ' + sg(d.interest));
    out.push(d.patience ? 'patience ' + sg(d.patience) : 'patience holds');
    return '<b>' + out.join(', ') + '</b>';
  }

  // say plays the speaker's beat, then resolves the line by the rules.
  View.prototype.say = function (line) {
    var G = this.G, self = this, h = hero(G.who);
    if (this.busy || G.over) return;
    this.busy = true;
    this.n('endArea').innerHTML = '';
    this.draw();
    this.bubble('kBub', '', '');
    this.bubble('hBub', h.name, line === 'ask' ? ASK_TEXT : line === 'read' ? '' : line.text);
    var sp = this.piece('.nga-h-' + h.id);
    sp.classList.add('nga-stepin', 'nga-gesture', 'nga-glow');
    this.later(function () {
      sp.classList.remove('nga-stepin', 'nga-gesture', 'nga-glow');
      self.resolve(line);
    }, 1300);
  };

  View.prototype.resolve = function (line) {
    var R = this.R, G = this.G, h = hero(G.who), pI = G.interest, pP = G.patience, reply = '', eff, mood = 'flat', argued = typeof line === 'object';
    if (line === 'ask') {
      var hint = ask(G);
      this.noRoll();
      reply = hint ? HINTS[hint.k] : 'I believe you already know.';
      eff = hint ? 'No roll. Asking costs nothing. He hints at <b>' + hint.name + '</b>, one of his motivations.' : 'No roll. You already know what he wants.';
    } else if (line === 'read') {
      var rd = read(R, G, [d10(), d10()]);
      eff = h.name + ' rolls Intuition: ' + this.showRoll(rd.roll) + ' ' +
        (rd.roll.tier === 1 ? 'He notices ' + h.name + ' sizing him up: ' + moves(rd.d) + '.'
          : rd.learned ? h.name + ' reads him. <b>' + rd.learned.name + '</b> is one of his ' + (rd.learned.kind === 'm' ? 'motivations' : 'pitfalls') + '.'
          : rd.roll.tier === 3 ? 'You already know all that moves him.' : h.name + ' learns nothing this time.');
      reply = rd.roll.tier === 1 ? 'Stop staring and speak.' : 'Well?';
    } else {
      var o = argue(R, G, line, [d10(), d10()]), m = motive(line.k);
      if (o.kind === 'pitfall') {
        this.noRoll();
        eff = '<b>' + m.name + '</b> is his pitfall. The argument fails without a roll: ' + moves(o.d) + '.';
        reply = 'Do you take me for a merchant? Keep your gold, and mind your tongue.';
      } else if (o.kind === 'reused') {
        this.noRoll();
        eff = 'You already appealed to his ' + m.name.toLowerCase() + '. Trying it again: ' + moves(o.d) + '.';
      } else {
        eff = h.name + ' rolls ' + line.ch + ': ' + this.showRoll(o.roll) + ' ' +
          (o.kind === 'appeal' ? 'It appeals to his <b>' + m.name.toLowerCase() + '</b>. Tier ' + o.roll.tier + ': '
            : 'He doesn’t care about that, so it’s the harder test. Tier ' + o.roll.tier + ': ') + moves(o.d) + '.' +
          (o.keptPatience ? ' A natural ' + o.roll.nat + ' keeps his patience.' : '');
      }
      if (o.caught) eff += ' He knows Morrow sent nobody. <b>Caught in a lie.</b>';
      mood = o.d.interest > 0 ? 'up' : o.d.interest < 0 ? 'down' : 'flat';
      reply = (reply ? reply + ' ' : pick(SAY[mood]) + ' ');
      this.motion('[data-k="king"]', mood === 'up' ? 'nga-lean' : mood === 'down' ? 'nga-recoil' : 'nga-gesture', 1400);
    }
    this.n('rtx').innerHTML = eff;
    this.note('<b>' + esc(h.name) + ':</b> ' + esc(line === 'ask' ? ASK_TEXT : line === 'read' ? '(studies the king)' : line.text) + '<br>' + eff);
    this.busy = false;
    this.finish(argued, reply, mood, pI, pP);
  };

  View.prototype.finish = function (argued, reply, mood, pI, pP) {
    var G = this.G, how = ending(G, argued), offer = OFFER_TEXT[G.interest], m = mood === 'flat' ? '' : mood;
    if (how === 'refused') return this.end('refused', reply + 'Enough. ' + offer);
    if (how === 'final') {
      this.bubble('kBub', 'King Aldric', argued ? reply + 'My final offer: ' + offer : 'I’ve heard enough. ' + offer + ' That is my final offer.', argued ? m : 'down');
      G.over = true;
      this.offerButtons();
    } else if (how === 'offer') {
      this.bubble('kBub', 'King Aldric', reply + offer + ' Is there anything else?', m);
      this.offerButtons();
    } else {
      this.bubble('kBub', 'King Aldric', reply, '');
    }
    this.draw(pI, pP);
  };

  View.prototype.offerButtons = function () {
    this.n('endArea').innerHTML = '<div class="nga-end"><button type="button" class="nga-btn" data-end="take">Take it: “' + esc(this.R.offers[this.G.interest]) + '”</button>' +
      '<button type="button" class="nga-btn nga-ghost" data-end="walk">Walk away</button></div>';
  };

  View.prototype.end = function (how, text) {
    var G = this.G, R = this.R, head, body;
    G.over = true;
    if (how === 'refused') {
      this.bubble('kBub', 'King Aldric', text, 'down');
      this.piece('.nga-gl').classList.add('nga-cross');
      this.piece('.nga-gr').classList.add('nga-cross');
      head = '<small>The audience is over</small><b>' + esc(R.offers[0]) + '</b>';
      body = 'Interest hit 0. Aldric throws you out and works against you from here on. Guards cross their spears at the door.';
    } else if (how === 'take') {
      var good = G.interest >= 3;
      if (good) { this.piece('.nga-win').classList.add('nga-up'); this.motion('[data-k="king"]', 'nga-glow', 2400); }
      this.bubble('kBub', 'King Aldric', good ? 'Then it’s settled. The March rides for the Gate.' : 'Take what I give and go.', good ? 'up' : '');
      head = '<small>You take the deal</small><b>' + esc(R.offers[G.interest]) + '</b>';
      body = OFFER_TEXT[G.interest];
    } else {
      this.bubble('kBub', 'King Aldric', 'Then go, and good luck at the Gate.', '');
      head = '<small>You walk away</small><b>No deal</b>';
      body = 'The heroes can always leave a negotiation without taking an offer.';
    }
    this.n('endArea').innerHTML = '<div class="nga-final">' + head + '<p>' + esc(body) + '</p><button type="button" class="nga-btn" data-end="again">Try the audience again</button></div>';
    this.draw();
  };

  // ── Opening and closing the pop-up book ─────────────────────

  View.prototype.build = function () {
    var self = this, b = this.board = document.createElement('div');
    b.className = 'nga-board';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'true');
    b.setAttribute('aria-label', 'An audience with the King');
    b.hidden = true;
    b.innerHTML = boardHTML();
    this.veil = document.createElement('div');
    this.veil.className = 'nga-veil';
    this.veil.hidden = true;
    document.body.appendChild(this.veil);
    document.body.appendChild(b);
    this.veil.addEventListener('click', function () { self.close(); });
    b.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null;
      if (!t || t.disabled) return;
      var a = t.getAttribute('data-a'), who = t.getAttribute('data-who'), act = t.getAttribute('data-act'), l = t.getAttribute('data-l'), end = t.getAttribute('data-end');
      if (a === 'shut') self.close();
      else if (a === 'again' || end === 'again') self.reset();
      else if (who && !self.busy) { self.G.who = who; self.draw(); }
      else if (act) self.say(act);
      else if (l) self.say(LINES.filter(function (x) { return x.id === l; })[0]);
      else if (end) self.end(end, '');
    });
    // Escape belongs to the open book first, so the Handbook underneath keeps its place.
    this.onKey = function (e) {
      if (e.key !== 'Escape' || !self.board || self.board.hidden) return;
      e.stopPropagation();
      e.preventDefault();
      self.close();
    };
    document.addEventListener('keydown', this.onKey, true);
    this.onResize = function () { if (self.board && !self.board.hidden) self.fit(); };
    window.addEventListener('resize', this.onResize);
  };

  View.prototype.fit = function () {
    var sc = this.n('scene');
    sc.style.setProperty('--nga-s', Math.min(1, sc.clientWidth / 700).toFixed(3));
  };

  // The little book lifts off the card and lands where the scene's book
  // lies; from and to are viewport rects, and back flies it home instead.
  function fly(mini, from, to, back, done) {
    var f = mini.cloneNode(true), w = Math.min(150, to.width * 0.22);
    var x = to.left + to.width / 2 - w / 2 - from.left, y = to.top + to.height * 0.45 - from.top, s = w / from.width;
    f.classList.add('nga-fly');
    f.style.cssText = 'left:' + from.left + 'px;top:' + from.top + 'px;width:' + from.width + 'px;height:' + from.height + 'px';
    document.body.appendChild(f);
    var start = 'translate(0,0) rotate(0) scale(1)', end = 'translate(' + x + 'px,' + y + 'px) rotate(0) scale(' + s + ')';
    var frames = back ? [
      { transform: end },
      { transform: 'translate(' + x * 0.5 + 'px,' + (y * 0.5 - 70) + 'px) rotate(6deg) scale(1.2)', offset: 0.45 },
      { transform: start }
    ] : [
      { transform: start },
      { transform: 'translate(' + x * 0.5 + 'px,' + (y * 0.5 - 80) + 'px) rotate(-8deg) scale(1.25)', offset: 0.55 },
      { transform: end }
    ];
    var anim = f.animate(frames, { duration: back ? SHUT_MS : 720, easing: 'cubic-bezier(.4,0,.2,1)' });
    anim.onfinish = function () { f.remove(); done(); };
  }

  View.prototype.open = function () {
    if (!this.R || (this.board && !this.board.hidden)) return;
    if (!this.board) this.build();
    var self = this, sp = this.n('spread'), mini = this.card.querySelector('.nga-mini');
    this.lastFocus = document.activeElement;
    sp.classList.add('nga-closed');
    sp.classList.remove('nga-opening', 'nga-shutting');
    this.veil.hidden = false;
    this.board.hidden = false;
    this.fit();
    this.reset();
    window.requestAnimationFrame(function () { self.veil.classList.add('nga-on'); });
    function land() {
      self.board.classList.add('nga-on');
      sp.classList.add('nga-opening');
      window.requestAnimationFrame(function () { sp.classList.remove('nga-closed'); });
      self.board.querySelector('[data-a="shut"]').focus();
    }
    if (calm() || typeof mini.animate !== 'function') return land();
    fly(mini, mini.getBoundingClientRect(), this.n('scene').getBoundingClientRect(), false, land);
  };

  // close folds the pieces, shuts the book, and flies it back onto its card.
  View.prototype.close = function () {
    if (!this.board || this.board.hidden || this.shutting) return;
    var self = this, sp = this.n('spread');
    this.bubble('kBub', '', '');
    this.bubble('hBub', '', '');
    function done() {
      self.shutting = false;
      sp.classList.remove('nga-shutting');
      self.board.hidden = true;
      self.veil.hidden = true;
      var back = self.lastFocus && document.contains(self.lastFocus) ? self.lastFocus : self.card;
      if (back && typeof back.focus === 'function') back.focus();
    }
    sp.classList.remove('nga-opening');
    sp.classList.add('nga-shutting', 'nga-closed');
    var mini = this.card && document.contains(this.card) ? this.card.querySelector('.nga-mini') : null;
    if (calm() || !mini || typeof mini.animate !== 'function') {
      this.board.classList.remove('nga-on');
      this.veil.classList.remove('nga-on');
      return done();
    }
    this.shutting = true;
    this.later(function () {
      var from = self.n('scene').getBoundingClientRect();
      self.board.classList.remove('nga-on');
      self.veil.classList.remove('nga-on');
      fly(mini, mini.getBoundingClientRect(), from, true, done);
    }, SHUT_MS + 110);
  };

  View.prototype.destroy = function () {
    this.timers.forEach(function (t) { window.clearTimeout(t); });
    this.timers = [];
    if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.board) this.board.remove();
    if (this.veil) this.veil.remove();
    this.board = this.veil = this.card = null;
    if (this.el) this.el.innerHTML = '';
    this.el = null;
  };

  Chronicle.register('negotiation-audience', {
    init: function (el, config) {
      var ds = el.dataset || {};
      config = config || {};
      if (el.__nga) el.__nga.destroy();
      el.__nga = new View(el, config.campaign_id || config.campaignId || ds.campaignId || '');
      el.__nga.mount();
    },
    destroy: function (el) {
      if (el && el.__nga) { el.__nga.destroy(); el.__nga = null; }
    }
  });
})();
