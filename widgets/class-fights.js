/**
 * Draw Steel Class Fights Widget
 *
 * The Handbook's Classes chapter as nine pop-up books: the page shows a tile
 * for each class and the chosen class's Heroic Resource, and each class opens
 * a cut-paper practice fight where the reader clicks the pieces and watches
 * the resource rise and fall by that class's rules.
 *
 * Every rule the fight follows (the power roll, winded, each resource's
 * start, per-turn gain, triggers and their rates, ability costs, prayer,
 * strain and drama) comes from data/class-fights.json; so do the example
 * scenes, which are flagged as this package's own. The drawings stay here.
 * The pure rules live in `Fights` below and are exported for
 * tools/test-class-fights.mjs.
 */
(function () {
  'use strict';

  var TAG = /^[a-z0-9-]+$/;
  var PERS = { round: 1, fight: 1, each: 1 };

  // ── Reading the data ────────────────────────────────────────

  function isAmount(n) { return n === 'd3' || (typeof n === 'number' && n >= 0); }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

  // classFrom checks one class's rules and its scene against each other;
  // a class whose scene names a trigger or piece it doesn't have is dropped
  // rather than played wrong.
  function classFrom(p, sc) {
    if (!p || !sc || typeof p.class !== 'string' || typeof p.resource !== 'string' || !isAmount(p.turn_gain)) return null;
    var trig = Array.isArray(p.triggers) ? p.triggers : [], ids = {};
    for (var i = 0; i < trig.length; i++) {
      var t = trig[i];
      if (!t || typeof t.id !== 'string' || typeof t.text !== 'string' || !isAmount(t.amount) || !PERS[t.per]) return null;
      ids[t.id] = i;
    }
    var hero = obj(sc.hero), foes = Array.isArray(sc.foes) ? sc.foes : [], acts = Array.isArray(sc.acts) ? sc.acts : [];
    var pieces = Array.isArray(sc.pieces) ? sc.pieces : [], foeIds = {};
    if (!hero || !foes.length || !acts.length || !pieces.length) return null;
    for (var f = 0; f < foes.length; f++) {
      if (!foes[f] || !TAG.test(foes[f].id || '') || !(foes[f].stamina > 0)) return null;
      foeIds[foes[f].id] = true;
    }
    var costs = Array.isArray(p.heroic_ability_costs) ? p.heroic_ability_costs : [];
    function trigOk(id) { return id === undefined || ids[id] !== undefined; }
    for (var a = 0; a < acts.length; a++) {
      var x = acts[a];
      if (!x || typeof x.b !== 'string') return null;
      if ((x.to && !foeIds[x.to]) || (x.from && !foeIds[x.from]) || (x.at && !TAG.test(x.at))) return null;
      if (x.cost !== undefined && costs.indexOf(x.cost) < 0) return null;
      if (x.roll && !(Array.isArray(x.dmg) && x.dmg.length === 3)) return null;
      if (!(x.trig || []).every(trigOk) || !trigOk(x.d20)) return null;
    }
    for (var q = 0; q < pieces.length; q++) {
      var pc = pieces[q];
      if (!pc || typeof pc.art !== 'string' || (pc.tag !== undefined && !TAG.test(pc.tag))) return null;
      if (pc.act !== undefined && pc.act !== 'turn' && !acts[pc.act]) return null;
    }
    if (!trigOk(sc.on_hurt) || !trigOk(sc.on_winded)) return null;
    if (p.strain && !(typeof p.strain.floor_base === 'number' && typeof p.strain.damage_per_point === 'number')) return null;
    if (p.death && !(p.death.gain >= 0 && p.death.rise_at >= 0 && p.death.rise_stamina > 0)) return null;
    if (p.prayer && !['1', '2', '3'].every(function (g) { return obj(p.prayer[g]); })) return null;
    return {
      id: p.class, name: p.class_name || p.class, res: p.resource,
      quote: p.quote || '', gain: p.gain_text || '', uniq: p.unique_text || '', ends: p.ends_text || '', outside: p.outside_text || '',
      turn: p.turn_gain, costs: costs, trig: trig, trigIndex: ids,
      prayer: obj(p.prayer), edgeDiscount: typeof p.edge_discount === 'number' ? p.edge_discount : 0,
      strain: obj(p.strain), death: obj(p.death), scene: sc
    };
  }

  // rulesFrom reads class-fights.json. Without the power roll or the winded
  // rule nothing can be played, so it returns null and the page says so.
  function rulesFrom(entries) {
    var kinds = { 'class-resource': {}, 'example-fight': {} }, order = [], roll = null, stam = null;
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      var p = e && obj(e.properties);
      if (!p) return;
      if (p.kind === 'power-roll') roll = p;
      else if (p.kind === 'stamina') stam = p;
      else if (kinds[p.kind] && typeof p.class === 'string') {
        if (p.kind === 'class-resource' && !kinds[p.kind][p.class]) order.push(p.class);
        kinds[p.kind][p.class] = p;
      }
    });
    if (!roll || !(roll.die > 0) || !(roll.dice > 0) || typeof roll.tier1_max !== 'number' || typeof roll.tier2_max !== 'number') return null;
    if (!stam || typeof stam.winded_fraction !== 'number' || typeof stam.dying_at !== 'number') return null;
    var classes = [];
    order.forEach(function (id) {
      var c = classFrom(kinds['class-resource'][id], kinds['example-fight'][id]);
      if (c) classes.push(c);
    });
    if (!classes.length) return null;
    return {
      roll: { dice: roll.dice, die: roll.die, t1: roll.tier1_max, t2: roll.tier2_max, edge: roll.edge_bonus || 0 },
      winded: stam.winded_fraction, dying: stam.dying_at, classes: classes
    };
  }

  // ── The fight (no DOM) ──────────────────────────────────────

  // Every move returns a list of effects for the stage to play in order:
  // log lines (with **bold**), speech, piece motions, bursts and the gain
  // floating up. rand(n) gives 1..n, so tests can load the dice.
  function newFight(R, c, rand) {
    var h = c.scene.hero;
    var S = {
      R: R, c: c, sc: c.scene, rand: rand || function (n) { return 1 + Math.floor(Math.random() * n); },
      r: 0, vic: h.victories || 0, reason: h.reason || 0, pray: false, edge: false,
      fight: false, used: {}, dead: false, hp: h.stamina, foe: {}, won: false
    };
    S.sc.foes.forEach(function (f) { S.foe[f.id] = f.stamina; });
    return S;
  }
  function res(S) { return S.c.res.toLowerCase(); }
  function amt(n) { return n === 'd3' ? '1d3' : String(n); }
  function tierOf(R, total) { return total <= R.roll.t1 ? 1 : total <= R.roll.t2 ? 2 : 3; }
  function floorOf(S) { return S.c.strain ? -(S.c.strain.floor_base + S.reason) : 0; }
  function costOf(S, a) {
    if (!a.cost) return 0;
    return S.c.edgeDiscount && S.edge ? Math.max(0, a.cost - S.c.edgeDiscount) : a.cost;
  }
  function alive(S, id) { return !id || S.foe[id] > 0; }
  function canAct(S, a) {
    if (!S.fight || !a) return false;
    if (a.cost && S.r - costOf(S, a) < floorOf(S)) return false;
    if (!alive(S, a.to) || !alive(S, a.from)) return false;
    return true;
  }
  function canRise(S) { return !!(S.fight && S.c.death && S.dead && S.r >= S.c.death.rise_at); }
  function powerRoll(S, edge) {
    var R = S.R, dice = [], t = 0;
    for (var i = 0; i < R.roll.dice; i++) { dice.push(S.rand(R.roll.die)); t += dice[i]; }
    var nat = t;
    t += (S.sc.hero.characteristic || 0) + (edge ? R.roll.edge : 0);
    return { dice: dice, t: t, nat: nat, tier: tierOf(R, t) };
  }

  function gain(S, n, why, E) { S.r += n; E.push({ t: 'log', text: '**+' + n + ' ' + res(S) + '**: ' + why }); }
  // fire pays a trigger at its rate: once a round, once a fight, or every time.
  function fire(S, id, E) {
    var i = S.c.trigIndex[id], t = S.c.trig[i];
    if (!t) return;
    if (t.per !== 'each' && S.used[i]) {
      E.push({ t: 'log', text: 'No ' + res(S) + ' for “' + t.text.toLowerCase() + '”: ' + (t.per === 'round' ? 'already paid this round' : 'already paid this fight') });
      return;
    }
    if (t.per !== 'each') S.used[i] = true;
    var n = t.amount === 'd3' ? S.rand(3) : t.amount;
    gain(S, n, t.text.toLowerCase() + (t.amount === 'd3' ? ' (rolled ' + n + ')' : ''), E);
  }
  function hurtMe(S, n, why, E) {
    var was = S.hp, max = S.sc.hero.stamina, wind = max * S.R.winded;
    S.hp -= n;
    E.push({ t: 'log', text: 'You take **' + n + '** damage' + (why ? ' ' + why : '') });
    E.push({ t: 'fx', kind: 'hit', at: 'me', text: '−' + n });
    if (S.sc.on_hurt) fire(S, S.sc.on_hurt, E);
    if (was > wind && S.hp <= wind && S.hp > S.R.dying) {
      E.push({ t: 'log', text: 'You are **winded**' });
      if (S.sc.on_winded) fire(S, S.sc.on_winded, E);
    }
    if (was > S.R.dying && S.hp <= S.R.dying) {
      if (S.c.death) {
        S.dead = true;
        E.push({ t: 'lift', tags: ['me'], up: false });
        E.push({ t: 'log', text: 'You fall' });
        gain(S, S.c.death.gain, 'you die, and the drama is enormous', E);
      } else {
        E.push({ t: 'log', text: 'You are **dying**' });
        if (S.sc.on_winded) fire(S, S.sc.on_winded, E);
      }
    }
  }
  function endFight(S, why, E) {
    S.fight = false;
    E.push({ t: 'log', text: (why ? '**' + why + '.** ' : '') + 'The fight ends: you lose your remaining ' + res(S) + (S.r > 0 ? ' (' + S.r + ')' : '') });
    S.r = 0; S.used = {}; S.edge = false;
  }
  function hitFoe(S, id, n, how, E) {
    var f = S.sc.foes.filter(function (g) { return g.id === id; })[0];
    if (!f) return;
    S.foe[id] = Math.max(0, S.foe[id] - n);
    E.push({ t: 'log', text: f.name + ' takes **' + n + '**' + (how ? ' ' + how : '') + ' damage' });
    if (S.foe[id] > 0) return;
    E.push({ t: 'lift', tags: [id], up: false });
    E.push({ t: 'log', text: '**' + f.name + ' falls.**' });
    if (S.sc.foes.every(function (g) { return S.foe[g.id] <= 0; })) {
      S.won = true;
      E.push({ t: 'say', say: S.sc.say && S.sc.say.win });
    }
  }

  function delta(S, before, E) {
    var d = S.r - before;
    if (d) E.push({ t: 'float', text: (d > 0 ? '+' : '−') + Math.abs(d) + ' ' + res(S) });
  }

  // act makes the scene's move number i: pay its cost, roll, hurt, heal,
  // and set off whatever triggers it names.
  function act(S, i, E) {
    var a = S.sc.acts[i];
    E = E || [];
    if (!canAct(S, a)) return E;
    var k = costOf(S, a), pr = null, n = 0, before = S.r, edged = false;
    if (a.cost) {
      S.r -= k;
      E.push({ t: 'log', text: '**−' + k + ' ' + res(S) + '**: ' + a.b.toLowerCase() + (k !== a.cost ? ' (' + (a.cost - k) + ' less for your edge)' : '') + (S.r < 0 ? '. You are strained' : '') });
    }
    if (a.say) E.push({ t: 'say', say: a.say });
    if (a.move) E.push({ t: 'move', move: a.move });
    if (a.edge) { S.edge = true; E.push({ t: 'log', text: 'You have an **edge** on your next power roll' }); }
    if (a.roll) {
      edged = !!(S.c.edgeDiscount && S.edge);
      pr = powerRoll(S, edged);
      n = a.dmg[pr.tier - 1];
      E.push({ t: 'log', text: 'Power roll ' + pr.dice.join(' + ') + ' + ' + (S.sc.hero.characteristic || 0) + (edged ? ' + ' + S.R.roll.edge + ' for the edge' : '') + ' = **' + pr.t + '**, tier ' + pr.tier });
      if (edged) S.edge = false;
    } else if (a.dmg) n = a.dmg;
    if (a.fx) E.push({ t: 'fx', kind: a.fx, at: a.at || a.to || 'me', text: a.dmg ? (pr ? 'T' + pr.tier + ' · ' : '') + n : '' });
    if (a.to && n) hitFoe(S, a.to, n, a.type, E);
    if (a.heal) {
      var hl = Math.max(0, Math.min(S.sc.hero.stamina - S.hp, a.heal));
      S.hp += hl;
      E.push({ t: 'log', text: 'You regain **' + hl + '** Stamina' });
    }
    if (a.hurt) hurtMe(S, a.hurt, a.hurtWhy, E);
    (a.trig || []).forEach(function (id) { fire(S, id, E); });
    if (a.d20) {
      var t = S.c.trig[S.c.trigIndex[a.d20]], x = S.rand(10), y = S.rand(10);
      E.push({ t: 'log', text: 'Someone in your line of effect rolls ' + x + ' + ' + y + ' = **' + (x + y) + '**' + (x + y >= t.natural_min ? ', a natural ' + (x + y) + '!' : '') });
      E.push({ t: 'fx', kind: 'dice', at: a.at, text: String(x + y) });
      if (x + y >= t.natural_min) fire(S, a.d20, E);
    }
    delta(S, before, E);
    // The last foe down wins the fight, once the move has played out.
    if (S.won && S.fight) { E.push({ t: 'victory' }); endFight(S, 'Victory', E); }
    return E;
  }

  // start gains the hero's Victories and stands every piece up.
  function start(S, E) {
    E = E || [];
    var sc = S.sc;
    S.fight = true; S.r = S.vic; S.used = {}; S.dead = false; S.edge = false; S.won = false; S.hp = sc.hero.stamina;
    sc.foes.forEach(function (f) { S.foe[f.id] = f.stamina; });
    E.push({ t: 'clear' });
    E.push({ t: 'lift', tags: ['me'].concat(sc.foes.map(function (f) { return f.id; })), up: true });
    if (sc.down) E.push({ t: 'lift', tags: sc.down, up: false });
    if (sc.rise) E.push({ t: 'lift', tags: sc.rise, up: true });
    E.push({ t: 'log', text: 'The fight starts: **' + S.vic + ' ' + res(S) + '** for your ' + S.vic + ' Victories' });
    if (sc.say) E.push({ t: 'say', say: sc.say.start });
    E.push({ t: 'float', text: '+' + S.vic + ' ' + res(S) });
    return E;
  }

  // turn opens a new round: per-round triggers pay again, and the class's
  // start-of-turn gain comes in, after a prayer if the conduit prays.
  function turn(S, E) {
    E = E || [];
    if (!S.fight) return E;
    var c = S.c, before = S.r, g = c.turn === 'd3' ? S.rand(3) : c.turn;
    c.trig.forEach(function (t, i) { if (t.per === 'round') delete S.used[i]; });
    if (S.sc.turn_flip) E.push({ t: 'flip', tag: S.sc.turn_flip });
    var o = c.prayer && S.pray ? obj(c.prayer[String(g)]) : null;
    if (o) {
      E.push({ t: 'fx', kind: 'holy', at: 'me', text: '' });
      gain(S, g + (o.extra || 0), 'you prayed and rolled a ' + g + ': ' + (o.extra || 0) + ' more' + (o.domain_effect ? ', and a domain effect' : '') + (o.damage_die ? ', but the gods are angry' : ''), E);
      if (o.damage_die) {
        hurtMe(S, S.rand(o.damage_die) + (o.damage_plus === 'level' ? S.sc.hero.level || 0 : 0),
          'from the angry gods (1d' + o.damage_die + (o.damage_plus === 'level' ? ' + your level' : '') + (o.unreducible ? ', can\'t be reduced' : '') + ')', E);
        if (S.sc.say && S.sc.say.angry) E.push({ t: 'say', say: S.sc.say.angry });
      } else if (o.domain_effect && S.sc.say && S.sc.say.answered) E.push({ t: 'say', say: S.sc.say.answered });
    } else gain(S, g, 'start of your turn' + (c.turn === 'd3' ? ' (rolled ' + g + ')' : ''), E);
    E.push({ t: 'float', text: '+' + (S.r - before) + ' ' + res(S) });
    return E;
  }

  // endTurn is the talent's strain: damage for every point below 0.
  function endTurn(S, E) {
    E = E || [];
    if (!S.fight) return E;
    if (S.r < 0 && S.c.strain) {
      E.push({ t: 'log', text: 'End of your turn: strain' });
      hurtMe(S, -S.r * S.c.strain.damage_per_point, 'from strain', E);
    } else E.push({ t: 'log', text: 'End of your turn: no strain, no damage' });
    return E;
  }

  // rise is the troubadour coming back from the dead on enough drama.
  function rise(S, E) {
    E = E || [];
    if (!canRise(S)) return E;
    var d = S.c.death;
    S.dead = false; S.hp = d.rise_stamina; S.r = d.resource_after_rising || 0;
    E.push({ t: 'lift', tags: ['me'], up: true });
    E.push({ t: 'fx', kind: 'holy', at: 'me', text: '' });
    E.push({ t: 'log', text: 'You come back to life with **' + d.rise_stamina + ' Stamina** and ' + S.r + ' ' + res(S) });
    if (S.sc.say && S.sc.say.rise) E.push({ t: 'say', say: S.sc.say.rise });
    return E;
  }

  function end(S, E) {
    E = E || [];
    if (!S.fight) return E;
    if (S.sc.say) E.push({ t: 'say', say: S.sc.say.end });
    endFight(S, '', E);
    return E;
  }

  var Fights = {
    rulesFrom: rulesFrom, newFight: newFight, tierOf: tierOf, floorOf: floorOf, costOf: costOf, canAct: canAct, canRise: canRise,
    start: start, turn: turn, act: act, endTurn: endTurn, rise: rise, end: end, amt: amt
  };
  if (typeof window !== 'undefined') window.ChronicleDrawSteelClassFights = Fights;
  if (typeof module !== 'undefined' && module.exports) module.exports = Fights;

  // ── UI ──────────────────────────────────────────────────────

  if (typeof Chronicle === 'undefined' || !Chronicle || typeof Chronicle.register !== 'function') return;

  var STYLE_ID = 'clf-style';
  var FOLD_MS = 300;   // the pieces lie down before the cover turns over them
  var SHUT_MS = 1060;  // folding plus the cover's swing, before the board fades

  var D = 'var(--clf-display,"Big Shoulders Display","Oswald","Arial Narrow",Impact,sans-serif)';
  var U = 'var(--clf-ui,"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif)';
  var B = 'var(--clf-body,"Source Serif 4",Georgia,serif)';
  var INKP = 'var(--color-text-primary,#15171d)', INK2 = 'var(--color-text-secondary,#4b5261)', RULE = 'var(--color-border,#cbd1da)';

  // The page part takes the book's colours; the board is a dark cut-paper
  // stage in either theme, so its colours are its own.
  function pageCss() {
    return [
      '.clf{container-type:inline-size;color:' + INKP + ';font:16px/1.55 ' + B + '}',
      '.clf *,.clf *::before,.clf *::after{box-sizing:border-box}',
      '.clf-wrap{display:grid;gap:18px}',
      '@container (min-width:760px){.clf-wrap{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);align-items:start}}',
      '.clf-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 4px}',
      '@container (max-width:420px){.clf-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.clf-facts div{grid-template-columns:1fr!important;gap:2px!important}}',
      '.clf-tile{all:unset;box-sizing:border-box;cursor:pointer;display:grid;gap:2px;padding:10px 10px 9px;border-radius:3px;min-width:0;' +
        'background:var(--color-card-bg,#fff);border:1.5px solid ' + RULE + ';border-top:5px solid var(--k);transition:transform .15s,border-color .15s;color:' + INKP + '}',
      '.clf-tile:hover{transform:translateY(-2px)}',
      '.clf-tile:focus-visible,.clf-open:focus-visible{outline:3px solid #e1a32c;outline-offset:2px}',
      '.clf-tile[aria-pressed="true"]{border-color:var(--k);box-shadow:3px 3px 0 var(--k)}',
      // the name shrinks with its tile, so a long one never breaks mid-word
      '.clf-tile{container-type:inline-size}.clf-tile b{font:900 min(19px,11.5cqi)/1 ' + D + ';text-transform:uppercase;letter-spacing:.02em;white-space:nowrap}',
      '.clf-tile span{font:600 12px/1.2 ' + U + ';letter-spacing:.1em;text-transform:uppercase;color:' + INK2 + '}',
      '.clf-tile svg{width:30px;height:30px;margin-bottom:4px}',
      '.clf-note{font-size:14px;color:' + INK2 + ';margin:8px 0 0}',
      '.clf-head{display:flex;gap:14px;align-items:center;margin:0 0 6px}',
      '.clf-head svg{width:64px;height:64px;flex:none}',
      '.clf-head small{display:block;font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:var(--k)}',
      '.clf-head b{display:block;font:900 40px/.9 ' + D + ';text-transform:uppercase}',
      '.clf-head i{display:block;font:600 15px/1.2 ' + U + ';font-style:normal;letter-spacing:.06em;color:' + INK2 + ';margin-top:3px}',
      '.clf-quote{margin:0 0 10px;font-style:italic;color:' + INK2 + ';border-left:3px solid var(--k);padding-left:10px}',
      '.clf-facts{display:grid;gap:6px;margin:8px 0}',
      '.clf-facts div{display:grid;grid-template-columns:120px 1fr;gap:10px;font-size:15px;padding:6px 0;border-bottom:1px dashed ' + RULE + '}',
      '.clf-facts b{font:700 12px/1.4 ' + U + ';letter-spacing:.12em;text-transform:uppercase;color:var(--k)}',
      '.clf-uniq{background:#232833;color:#f4f1ea;padding:12px 14px 12px 18px;border-radius:3px;position:relative;margin:10px 0;font-size:15px}',
      '.clf-uniq::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--k);border-radius:3px 0 0 3px}',
      '.clf-uniq small{display:block;font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:#e1a32c;margin-bottom:4px}',
      '.clf-open{all:unset;box-sizing:border-box;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;margin-top:6px;padding:12px 16px;' +
        'border-radius:3px;background:var(--k);color:#fff;font:700 14px/1.2 ' + U + ';letter-spacing:.14em;text-transform:uppercase;box-shadow:4px 4px 0 #232833}',
      '.clf-problem{padding:10px 12px;border-radius:4px;background:var(--color-bg-tertiary,#f3efe6);color:' + INKP + ';font-size:14px}'
    ];
  }

  function boardCss() {
    var CARD = '.clf-pop>.clf-pc';
    return [
      '.clf-veil{position:fixed;inset:0;z-index:9998;background:rgba(8,10,14,.62);opacity:0;transition:opacity .35s}',
      '.clf-veil.clf-on{opacity:1}',
      '.clf-board{position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);width:min(980px,calc(100vw - 24px));max-height:calc(100vh - 24px);' +
        'overflow-y:auto;background:#232833;color:#f4f1ea;border-radius:6px;box-shadow:0 30px 70px rgba(0,0,0,.5);opacity:0;transition:opacity .3s;font:16px/1.5 ' + B + ';text-align:left}',
      '.clf-board.clf-on{opacity:1}',
      '.clf-board *,.clf-board *::before,.clf-board *::after{box-sizing:border-box}',
      '.clf-bhead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:3px solid var(--k);position:sticky;top:0;background:#232833;z-index:4}',
      '.clf-bhead h2{font:900 22px/1 ' + D + ';text-transform:uppercase;letter-spacing:.02em;flex:1;min-width:0;margin:0;color:inherit}',
      '.clf-bhead small{display:block;font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:var(--k);filter:brightness(1.35);margin-bottom:4px}',
      '.clf-ib{all:unset;cursor:pointer;width:34px;height:34px;display:grid;place-items:center;border-radius:3px;font:700 16px/1 ' + U + ';color:#f4f1ea;background:rgba(255,255,255,.08)}',
      '.clf-ib:hover,.clf-ib:focus-visible{background:rgba(255,255,255,.18)}.clf-ib:focus-visible{outline:3px solid #e1a32c;outline-offset:2px}',
      // the 3D stage: a 700x520 scene scaled to fit, a spread tilted back
      '.clf-scene{position:relative;height:calc(520px * var(--clf-s,1));overflow:hidden;' +
        'background:radial-gradient(80% 70% at 50% 110%,rgba(225,163,44,.35),transparent 70%),radial-gradient(130% 100% at 50% 0%,#3a1c2a 0%,#140c14 75%)}',
      '.clf-fit{position:absolute;left:50%;top:0;width:700px;height:520px;margin-left:-350px;transform:scale(var(--clf-s,1));transform-origin:50% 0}',
      '.clf-pbook{position:absolute;left:0;right:0;top:48px;height:360px;perspective:1200px;perspective-origin:50% 0%}',
      '.clf-spread{position:absolute;left:50px;top:150px;width:600px;height:250px;transform-style:preserve-3d;transform:rotateX(58deg)}',
      '.clf-page{position:absolute;top:0;width:300px;height:250px;background:#efe9dc;transform-style:preserve-3d}',
      '.clf-pl{left:0;border-radius:6px 0 0 6px;box-shadow:inset -26px 0 30px -18px rgba(40,20,20,.5);transform-origin:100% 50%;transition:transform 1100ms cubic-bezier(.6,.05,.25,1)}',
      '.clf-pr{left:300px;border-radius:0 6px 6px 0;box-shadow:inset 26px 0 30px -18px rgba(40,20,20,.5)}',
      '.clf-page::after{content:"";position:absolute;inset:10px;border:1.5px solid rgba(120,30,40,.35);border-radius:3px}',
      '.clf-closed .clf-pl{transform:rotateY(180deg) translateZ(-2px)}',
      '.clf-shutting .clf-pl{transition-duration:650ms;transition-timing-function:cubic-bezier(.5,0,.4,1);transition-delay:' + FOLD_MS + 'ms}',
      '.clf-cover{position:absolute;inset:0;border-radius:6px;transform:rotateY(180deg) translateZ(1px);backface-visibility:hidden;background:linear-gradient(135deg,#8e1f2b,#4e0f1b);' +
        'background:linear-gradient(135deg,color-mix(in srgb,var(--k) 80%,#000),color-mix(in srgb,var(--k) 45%,#000));' +
        'box-shadow:inset 0 0 0 7px #3d0b15,inset 0 0 0 9px #e9b84a;display:grid;place-items:center;text-align:center;font:900 30px/.9 ' + D + ';color:#f6dfa4;text-transform:uppercase;padding:0 30px}',
      '.clf-runner{position:absolute;top:34px;width:52px;height:216px;background:#8e1f2b;transform:translateZ(1px)}',
      // a standing piece is hinged on its bottom edge: face-down when folded
      '.clf-pop{position:absolute;transform-origin:50% 100%;transform-style:preserve-3d;transform:rotateX(-180deg);transition:transform 380ms ease-in}',
      '.clf-pop.clf-up{transform:rotateX(-90deg);transition:transform 700ms cubic-bezier(.3,1.6,.5,1)}',
      '.clf-opening .clf-pop.clf-up{transition-delay:calc(800ms + var(--i,0) * 110ms)}',
      '.clf-closed .clf-pop.clf-up{transform:rotateX(-180deg);transition:transform 380ms ease-in}',
      CARD + '{position:absolute;inset:0;transform-origin:50% 100%;backface-visibility:hidden;transition:transform 460ms cubic-bezier(.4,1.4,.5,1),filter .3s,opacity .4s}',
      // a folded piece is hidden as well as flat, so no browser's 3D sorting
      // can show it through the cover; it appears only as it starts to rise
      '.clf-pop:not(.clf-up)>.clf-pc,.clf-closed .clf-pop>.clf-pc{opacity:0;visibility:hidden;' +
        'transition:transform 460ms cubic-bezier(.4,1.4,.5,1),filter .3s,opacity 200ms ease-in 100ms,visibility 0s ' + FOLD_MS + 'ms}',
      '.clf-opening .clf-pop.clf-up>.clf-pc{transition:transform 460ms cubic-bezier(.4,1.4,.5,1),filter .3s,' +
        'opacity 160ms ease-out calc(800ms + var(--i,0) * 110ms),visibility 0s calc(800ms + var(--i,0) * 110ms)}',
      '.clf-art{display:block;width:100%;height:100%;overflow:visible;filter:url(#clf-cut)}',
      '.clf-shade{position:absolute;transform:translateZ(.5px);background:radial-gradient(closest-side,rgba(60,20,10,.45),transparent)}',
      '.clf-closed .clf-shade{opacity:0}',
      '.clf-flame{transform-box:fill-box;transform-origin:50% 100%;animation:clf-flick 1s ease-in-out infinite alternate}',
      '@keyframes clf-flick{50%{transform:scale(.9,1.1) skewX(-4deg)}100%{transform:scale(1.05,.94) skewX(3deg)}}',
      '.clf-arm{transform-box:fill-box;transform-origin:20% 90%;transition:transform 380ms cubic-bezier(.4,1.5,.5,1)}',
      // a piece you can click lights up under the pointer, and greys while its move can't be made
      '.clf-pop.clf-hot{cursor:pointer}.clf-pop.clf-hot:focus-visible{outline:none}',
      '.clf-hot:hover>.clf-pc,.clf-hot:focus-visible>.clf-pc,.clf-m-glow>.clf-pc{filter:drop-shadow(0 0 9px rgba(255,214,120,.95))}',
      '.clf-hot.clf-off>.clf-pc{filter:grayscale(.7) brightness(.75)}.clf-hot.clf-off{cursor:default}',
      '.clf-m-lunge-l>.clf-pc{transform:translateX(-34px) rotate(-7deg)}.clf-m-lunge-r>.clf-pc{transform:translateX(34px) rotate(7deg)}',
      '.clf-m-reel-l>.clf-pc{transform:translateX(-16px) rotate(-9deg)}.clf-m-reel-r>.clf-pc{transform:translateX(16px) rotate(9deg)}',
      '.clf-m-hop>.clf-pc{transform:translateY(-14px)}',
      '.clf-glass>.clf-pc{transform-origin:50% 50%}.clf-flip>.clf-pc{transform:rotate(180deg)}',
      '.clf-m-strike .clf-arm{transform:rotate(var(--sw,-40deg))}',
      // speech bubbles, the floating gain and the bursts sit over the scene, outside the 3D
      '.clf-bub{position:absolute;z-index:2;max-width:240px;background:#fffaf0;color:#1c1418;font:600 15px/1.3 ' + B + ';padding:9px 12px;border-radius:14px;' +
        'border:2.5px solid #1c1418;box-shadow:3px 3px 0 #1c1418;transform-origin:var(--ox,20%) 120%;transform:scale(.2);opacity:0;transition:transform .35s cubic-bezier(.3,1.7,.5,1),opacity .2s}',
      '.clf-bub.clf-on{transform:scale(1);opacity:1}',
      '.clf-bub::after{content:"";position:absolute;bottom:-13px;left:26px;width:18px;height:14px;background:#fffaf0;border:2.5px solid #1c1418;border-top:0;border-left:0;transform:skewX(var(--sk,30deg))}',
      '.clf-bub small{display:block;font:700 10px/1 ' + U + ';letter-spacing:.16em;text-transform:uppercase;color:#8e1f2b;margin-bottom:3px}',
      '.clf-bf{right:6%;top:6%;--ox:80%;--sk:-30deg}.clf-bf::after{left:auto;right:34px}',
      '.clf-bh{left:4%;top:30%}',
      '.clf-float{position:absolute;z-index:3;left:50%;top:42%;transform:translate(-50%,0);font:900 34px/1 ' + D + ';color:#e1a32c;text-shadow:2px 2px 0 #1c1418,0 0 14px rgba(0,0,0,.6);pointer-events:none;opacity:0;white-space:nowrap}',
      '.clf-float.clf-go{animation:clf-float 1.1s ease-out forwards}',
      '.clf-float.clf-quiet{color:#f4f1ea;font-size:20px;letter-spacing:.04em}',
      '@keyframes clf-float{0%{opacity:0;transform:translate(-50%,10px) scale(.7)}20%{opacity:1;transform:translate(-50%,0) scale(1.1)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-46px) scale(1)}}',
      '.clf-fx{position:absolute;z-index:3;width:84px;height:84px;margin:-42px 0 0 -42px;pointer-events:none;display:grid;place-items:center;animation:clf-fx .95s ease-out forwards}',
      '.clf-fx svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}',
      '.clf-fx b{position:absolute;bottom:-8px;font:900 22px/1 ' + D + ';color:#fff;text-shadow:2px 2px 0 #1c1418;white-space:nowrap}',
      '@keyframes clf-fx{0%{transform:scale(.3) rotate(-12deg);opacity:0}25%{transform:scale(1.15) rotate(0);opacity:1}70%{opacity:1}100%{transform:scale(1) translateY(-14px);opacity:0}}',
      // the table under the scene
      '.clf-table{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}',
      '.clf-col{padding:14px;min-width:0}.clf-col+.clf-col{border-left:1px solid rgba(255,255,255,.1)}',
      '.clf-lab{font:700 11px/1 ' + U + ';letter-spacing:.2em;text-transform:uppercase;color:#e1a32c;margin:0 0 8px;display:flex;justify-content:space-between;gap:8px}',
      '.clf-lab em{font-style:normal;color:#aab1be;letter-spacing:.08em}',
      '.clf-hint{margin:0 0 10px;font-size:14px;color:#cfd3dc}.clf-hint b{color:#f4f1ea}',
      '.clf-meter{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;margin-bottom:12px}',
      '.clf-num{font:900 64px/.8 ' + D + ';font-variant-numeric:tabular-nums;min-width:72px;text-align:center;color:var(--k);filter:brightness(1.3);transition:transform .2s}',
      '.clf-num.clf-bump{transform:scale(1.18)}.clf-num.clf-neg{color:#e2545d}',
      '.clf-pips{display:flex;flex-wrap:wrap;gap:4px}',
      '.clf-pips i{width:14px;height:14px;border-radius:50%;background:var(--k);box-shadow:inset 0 -2px 0 rgba(0,0,0,.3),0 0 0 1.5px rgba(255,255,255,.25)}',
      '.clf-pips i.clf-n{background:#e2545d;border-radius:2px;transform:rotate(45deg) scale(.85)}',
      '.clf-name{font:700 12px/1.3 ' + U + ';letter-spacing:.14em;text-transform:uppercase;color:#aab1be;margin-top:4px}',
      '.clf-flag{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:2px;background:#c22f39;color:#fff;font:700 11px/1.3 ' + U + ';letter-spacing:.1em}',
      '.clf-flag.clf-ok{background:#2f7a45}',
      '.clf-bars{display:grid;gap:6px;margin-bottom:12px}',
      '.clf-bar{position:relative;display:flex;justify-content:space-between;gap:8px;padding:5px 9px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden;font:600 12px/1.2 ' + U + ';letter-spacing:.06em;color:#f4f1ea}',
      '.clf-bar i{position:absolute;left:0;top:0;bottom:0;background:rgba(194,47,57,.55);transition:width .4s;z-index:0}',
      '.clf-bar.clf-me i{background:rgba(63,191,106,.5)}.clf-bar.clf-wind i{background:rgba(225,163,44,.6)}.clf-bar.clf-down{opacity:.5;text-decoration:line-through}',
      '.clf-bar span,.clf-bar b{position:relative;z-index:1;font-variant-numeric:tabular-nums}',
      '.clf-hero{display:flex;flex-wrap:wrap;gap:8px 14px;font:600 13px/1 ' + U + ';letter-spacing:.06em;color:#cfd3dc;align-items:center;margin-bottom:12px}',
      '.clf-hero label,.clf-fld{display:inline-flex;gap:6px;align-items:center}',
      '.clf-step{display:inline-flex;border:1.5px solid rgba(255,255,255,.25);border-radius:3px}',
      '.clf-step button{all:unset;cursor:pointer;width:28px;text-align:center;font:700 15px/26px ' + U + ';color:#f4f1ea}',
      '.clf-step button:focus-visible{outline:3px solid #e1a32c}',
      '.clf-step output{min-width:24px;text-align:center;font:700 14px/26px ' + U + ';color:#f4f1ea;border-inline:1px solid rgba(255,255,255,.25)}',
      '.clf-btns{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px}',
      '.clf-btns button{font:600 13px/1.2 ' + U + ';text-align:left;padding:8px 10px;border-radius:3px;border:1.5px solid rgba(255,255,255,.28);background:rgba(255,255,255,.05);color:#f4f1ea;cursor:pointer}',
      '.clf-btns button:hover:not([disabled]){background:rgba(255,255,255,.12)}',
      '.clf-btns button.clf-main{background:#e1a32c;border-color:#e1a32c;color:#1a1420}',
      '.clf-btns button.clf-trig{border-color:var(--k);box-shadow:inset 4px 0 0 var(--k)}.clf-btns button.clf-spend{border-color:#e1a32c}',
      '.clf-btns button[disabled]{opacity:.38;cursor:default}',
      '.clf-btns button small{display:block;font-size:11px;opacity:.75;letter-spacing:.04em}',
      '.clf-btns button:focus-visible{outline:3px solid #e1a32c;outline-offset:2px}',
      '.clf-log{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px;line-height:1.4;color:#cfd3dc;max-height:150px;overflow-y:auto}',
      '.clf-log li{padding-left:10px;border-left:2px solid rgba(255,255,255,.18)}.clf-log li b{color:#f4f1ea}',
      '.clf-foot{padding:10px 14px 14px;margin:0;font:500 12px/1.4 ' + U + ';color:#8b93a1;letter-spacing:.02em;border-top:1px solid rgba(255,255,255,.08)}',
      '@media (max-width:760px){.clf-table{grid-template-columns:1fr}.clf-col+.clf-col{border-left:0;border-top:1px solid rgba(255,255,255,.1)}' +
        '.clf-scene{height:auto;padding-top:calc(520px * var(--clf-s,1));display:grid;gap:8px}' +
        '.clf-scene .clf-bub{position:static;max-width:none;margin:0 12px 12px;font-size:14px;transform:none;box-shadow:2px 2px 0 #1c1418}' +
        '.clf-scene .clf-bub:not(.clf-on){display:none}.clf-bub::after{display:none}.clf-bh{order:1}.clf-bf{order:2}' +
        '.clf-float{font-size:22px;top:30%}.clf-fx{width:56px;height:56px;margin:-28px 0 0 -28px}.clf-fx b{font-size:16px}}',
      '@media (prefers-reduced-motion:reduce){.clf-board *,.clf-board *::before,.clf-board *::after,.clf-veil,.clf-board,.clf *{animation-duration:1ms!important;' +
        'animation-iteration-count:1!important;transition-duration:1ms!important;transition-delay:0ms!important}}'
    ];
  }

  var INK = '#1c1418', K = ' stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round"';
  // One shared set of SVG defs: a die-cut white edge and a stone wall.
  var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false" id="clf-defs"><defs>' +
    '<filter id="clf-cut" x="-10%" y="-10%" width="120%" height="125%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="d"/>' +
    '<feFlood flood-color="#fffaf0"/><feComposite in2="d" operator="in" result="w"/><feOffset in="w" dy="2" result="w2"/>' +
    '<feMerge><feMergeNode in="w2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<pattern id="clf-stone" width="40" height="22" patternUnits="userSpaceOnUse"><rect width="40" height="22" fill="#6d5866"/>' +
    '<path d="M0 11h40M20 0v11M0 22V11M40 22V11" stroke="#4d3a47" stroke-width="2"/></pattern></defs></svg>';

  // Each class's colour on the page and the board.
  var COLOR = {censor: '#b8862a', conduit: '#d0a23a', elementalist: '#1d8f80', fury: '#c22f39', 'null': '#5d6f8c', shadow: '#4a3d6e', tactician: '#2f6fae', talent: '#7a4d8f', troubadour: '#cf6a1a'};
  var EMBLEM = {
    censor: '<circle cx="50" cy="50" r="30" fill="#f0bb4f"/><g fill="#f0bb4f"><path d="M50 6l5 14H45z"/><path d="M50 94l-5-14h10z"/><path d="M6 50l14-5v10z"/><path d="M94 50l-14 5V45z"/></g><path d="M28 50c8-12 36-12 44 0-8 12-36 12-44 0z" fill="#fff8e6"/><circle cx="50" cy="50" r="8" fill="#3d0b15"/>',
    conduit: '<path d="M50 8l8 28 28 8-28 8-8 28-8-28-28-8 28-8z" fill="#ffe27a"/><circle cx="50" cy="44" r="10" fill="#fff8e6"/><path d="M30 92c4-16 36-16 40 0z" fill="#d0a23a"/>',
    elementalist: '<path d="M50 8c14 18 26 30 26 50a26 26 0 0 1-52 0c0-10 6-18 12-24 0 10 4 16 10 18-4-16 0-30 4-44z" fill="#4fc0bf"/><path d="M50 46c8 10 12 16 12 24a12 12 0 0 1-24 0c0-8 6-14 12-24z" fill="#f6a23a"/>',
    fury: '<g fill="#e2545d"><path d="M22 12l14 4-6 74-10-4z"/><path d="M46 8l14 4-6 82-10-4z"/><path d="M70 12l12 6-10 70-8-4z"/></g>',
    null: '<circle cx="50" cy="50" r="38" fill="none" stroke="#a7b4cc" stroke-width="7"/><path d="M34 70V36c0-4 6-4 6 0v18-24c0-4 6-4 6 0v24-28c0-4 6-4 6 0v28-24c0-4 6-4 6 0v30c0 10-6 18-14 18-6 0-12-4-16-12z" fill="#e8ebf0"/>',
    shadow: '<path d="M64 14a34 34 0 1 0 22 54A28 28 0 1 1 64 14z" fill="#c9b8f0"/><path d="M30 82l34-46 4 4-34 46z" fill="#e8ebf0"/><path d="M26 86l6-10 6 4-6 10z" fill="#3a2a1e"/>',
    tactician: '<path d="M28 8h6v86h-6z" fill="#e8ebf0"/><path d="M34 12h46l-10 14 10 14H34z" fill="#2f6fae"/><path d="M34 12h46l-10 14 10 14H34z" fill="none" stroke="#f0bb4f" stroke-width="3"/><circle cx="56" cy="26" r="5" fill="#f0bb4f"/>',
    talent: '<circle cx="50" cy="52" r="16" fill="#e7d4ff"/><circle cx="50" cy="52" r="6" fill="#3a2350"/><g fill="none" stroke="#c9a8ef" stroke-width="4"><circle cx="50" cy="52" r="27"/><circle cx="50" cy="52" r="38" stroke-dasharray="6 7"/></g>',
    troubadour: '<path d="M20 22c18 6 40 6 58 0 0 30-8 52-29 58C28 74 20 52 20 22z" fill="#f4f1ea"/><path d="M34 40c4-4 10-4 12 0M54 40c4-4 10-4 12 0" stroke="#3d0b15" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M36 58c8 10 20 10 28 0" stroke="#3d0b15" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M78 22l10-8 2 12z" fill="#cf6a1a"/>'
  };
  // The cut-paper pieces, drawn for this package.
  function art(vb, inner) { return '<svg class="clf-art" viewBox="' + vb + '" aria-hidden="true" focusable="false">' + inner + '</svg>'; }
  function line(d, w, col) { return '<path d="' + d + '" stroke="' + INK + '" stroke-width="' + (w + 4) + '" stroke-linecap="round" fill="none"/><path d="' + d + '" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" fill="none"/>'; }
  var PIECE = {
    chapel: function () {
      return art('0 0 540 170',
        '<path d="M0 170V40l30-10 20 8 40-14 60 10 40-20 60 12 50-16 40 14 50-8 60 12 40-6 50 10v138z" fill="url(#clf-stone)"' + K + '/>' +
        '<path d="M224 156V78a46 46 0 0 1 92 0v78z" fill="#1d7f80"' + K + '/>' +
        '<path d="M224 110h92M270 32v124M236 60l68 68M304 60l-68 68" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="270" cy="94" r="17" fill="#e9b84a"' + K + '/><circle cx="270" cy="94" r="6" fill="#8e1f2b"' + K + '/>' +
        '<path d="M90 156V100a20 20 0 0 1 40 0v56zM410 156V100a20 20 0 0 1 40 0v56z" fill="#8e1f2b"' + K + '/>' +
        '<path d="M110 80v76M430 80v76" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<path d="M170 170V50h18v120zM352 170V50h18v120z" fill="#8a7480"' + K + '/>');
    },
    candles: function () {
      return art('0 0 60 60',
        '<path d="M8 60V30h10v30zM25 60V20h10v40zM42 60V34h10v26z" fill="#f4f1ea"' + K + '/>' +
        '<path class="clf-flame" d="M13 28c-5-5-2-10 0-14 2 4 6 8 0 14z" fill="#f08a3a"' + K + '/>' +
        '<path class="clf-flame" d="M30 18c-5-5-2-10 0-14 2 4 6 8 0 14z" fill="#f08a3a"' + K + '/>' +
        '<path class="clf-flame" d="M47 32c-5-5-2-10 0-14 2 4 6 8 0 14z" fill="#f08a3a"' + K + '/>');
    },
    censor: function () {
      return art('0 0 120 170',
        '<path d="M38 168l4-46h36l4 46z" fill="#6b7280"' + K + '/>' +
        '<path d="M30 128c0-42 12-64 30-64s30 22 30 64z" fill="#a9b2bf"' + K + '/>' +
        '<path d="M46 72h28v86l-14-9-14 9z" fill="#8e1f2b"' + K + '/>' +
        '<circle cx="60" cy="100" r="9" fill="#e9b84a"' + K + '/>' +
        '<path d="M44 54c0-18 8-28 16-28s16 10 16 28v10H44z" fill="#a9b2bf"' + K + '/><path d="M48 48h24" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M60 26c-4-12 4-20 14-22-4 8 0 12-6 22z" fill="#8e1f2b"' + K + '/>' +
        '<path d="M6 82h32v42l-16 14-16-14z" fill="#e9b84a"' + K + '/><path d="M22 90v36M10 102h24" stroke="#8e1f2b" stroke-width="4"/>' +
        '<g class="clf-arm">' + line('M84 92l22-36', 5, '#a9b2bf') + '<circle cx="108" cy="52" r="9" fill="#6b7280"' + K + '/></g>');
    },
    heretic: function () {
      return art('0 0 110 150',
        '<path d="M16 148c4-50 18-88 40-88s36 38 40 88z" fill="#3b2a4f"' + K + '/>' +
        '<path d="M30 72c0-34 12-54 26-54s26 20 26 54c-8-8-44-8-52 0z" fill="#3b2a4f"' + K + '/>' +
        '<path d="M40 62c4-16 28-16 32 0-4 10-28 10-32 0z" fill="#120c16"' + K + '/>' +
        '<circle cx="50" cy="61" r="3" fill="#7fe0e0"/><circle cx="62" cy="61" r="3" fill="#7fe0e0"/>' +
        '<path d="M36 102h40" stroke="#c23f2f" stroke-width="5"/>' +
        '<g class="clf-arm" style="transform-origin:90% 95%">' + line('M24 106L8 78', 4, '#3b2a4f') + '<path d="M8 78L2 52l12 22z" fill="#c9cfd8"' + K + '/></g>');
    },
    cultist: function () {
      return art('0 0 80 115',
        '<path d="M12 113c3-38 12-64 28-64s25 26 28 64z" fill="#4d3a5c"' + K + '/>' +
        '<path d="M24 58c0-26 8-40 16-40s16 14 16 40c-6-6-26-6-32 0z" fill="#4d3a5c"' + K + '/>' +
        '<path d="M31 50c3-10 15-10 18 0-3 7-15 7-18 0z" fill="#120c16"/>' +
        line('M64 86V30', 3, '#8a6a4a') + '<path class="clf-flame" d="M64 30c-10-8-4-18 0-26 3 8 10 14 0 26z" fill="#7fe0e0"' + K + '/>');
    },
    sigil: function () {
      return art('0 0 70 222',
        '<path d="M35 70v34" stroke="#f0bb4f" stroke-width="3" stroke-dasharray="4 5"/>' +
        '<svg x="0" y="0" width="70" height="70" viewBox="0 0 100 100">' + EMBLEM.censor + '</svg>');
    },
    hourglass: function () {
      return art('0 0 36 58',
        '<path d="M2 2h32v6H2zM2 50h32v6H2z" fill="#8a6a4a"' + K + '/>' +
        '<path d="M6 8h24c0 12-9 16-9 21s9 9 9 21H6c0-12 9-16 9-21S6 20 6 8z" fill="#cfe6ee"' + K + '/>' +
        '<path d="M10 12h16l-8 12zM8 48h20l-10-10z" fill="#e9b84a"/>');
    },
    // backdrops: one wall shape, dressed for each place
    crypt: function () {
      return art('0 0 540 170', TOP('#5a5560') +
        '<path d="M60 156V96a30 30 0 0 1 60 0v60zM420 156V96a30 30 0 0 1 60 0v60z" fill="#2a2630"' + K + '/>' +
        '<path d="M230 156V70h80v86z" fill="#3a3540"' + K + '/><path d="M270 82v40M254 96h32" stroke="#e9b84a" stroke-width="5"/>' +
        '<path d="M160 156v-34h30v34zM350 156v-30h30v30z" fill="#8a8494"' + K + '/>');
    },
    ruin: function () {
      return art('0 0 540 170', TOP('#6a4a3a') +
        '<path d="M120 170l30-70 20 30 24-60 18 100z" fill="#2a1a14"' + K + '/>' +
        '<path d="M140 170l14-40 12 18 16-40 10 62z" fill="#f08a3a"/>' +
        '<path d="M360 160h120v-60l-20-14-30 20-26-16-24 18-20-8z" fill="#3a2a24"' + K + '/>' +
        '<path d="M380 160v-40M420 160v-50M460 160v-36" stroke="#f0bb4f" stroke-width="3" stroke-dasharray="6 6"/>');
    },
    forest: function () {
      var t = function (x, h, c) { return '<path d="M' + x + ' 170v-' + (h * .3) + 'h12v' + (h * .3) + 'z" fill="#4a3424"' + K + '/><path d="M' + (x + 6) + ' ' + (170 - h) + 'l-34 ' + (h * .5) + 'h16l-24 ' + (h * .3) + 'h84l-24-' + (h * .3) + 'h16z" fill="' + c + '"' + K + '/>'; };
      return art('0 0 540 170', '<path d="M0 170V60c60-30 120-10 170-30s110 0 170-20 140 10 200 30v130z" fill="#2e4a3a"' + K + '/>' +
        t(30, 150, '#2f6a45') + t(120, 120, '#3a7a50') + t(400, 140, '#2f6a45') + t(490, 110, '#3a7a50') + t(250, 90, '#1f4a30'));
    },
    tower: function () {
      return art('0 0 540 170', TOP('#4a4a6a') +
        '<path d="M220 160V60a50 50 0 0 1 100 0v100z" fill="#1a1530"' + K + '/>' +
        '<circle cx="270" cy="70" r="18" fill="none" stroke="#7fe0e0" stroke-width="3"/><path d="M270 46v48M246 70h48" stroke="#7fe0e0" stroke-width="2"/>' +
        '<path d="M70 150l20-80h40l20 80zM390 150l20-80h40l20 80z" fill="#2a2a4a"' + K + '/>' +
        '<g fill="#7fe0e0"><circle cx="110" cy="96" r="4"/><circle cx="430" cy="96" r="4"/></g>');
    },
    alley: function () {
      var house = function (x, w, h, c) { return '<path d="M' + x + ' 170V' + (170 - h) + 'l' + (w / 2) + '-30 ' + (w / 2) + ' 30V170z" fill="' + c + '"' + K + '/><path d="M' + (x + w / 2 - 10) + ' ' + (190 - h) + 'h20v24h-20z" fill="#f0bb4f"' + K + '/>'; };
      return art('0 0 540 170', house(0, 130, 110, '#3a3348') + house(120, 110, 140, '#2e2a3c') + house(300, 120, 120, '#3a3348') + house(420, 120, 100, '#2e2a3c') +
        '<circle cx="250" cy="22" r="14" fill="#f4f1ea"' + K + '/>');
    },
    camp: function () {
      var stakes = ''; for (var x = 0; x < 540; x += 30) stakes += '<path d="M' + x + ' 170V' + (60 + (x % 60 ? 10 : 0)) + 'l15-14 15 14V170z" fill="#8a6a4a"' + K + '/>';
      return art('0 0 540 170', stakes + '<path d="M200 170l70-80 70 80z" fill="#c9a86a"' + K + '/><path d="M270 90v80" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<path d="M270 90V40" stroke="' + INK + '" stroke-width="3"/><path d="M270 40h40l-8 9 8 9h-40z" fill="#2f6fae"' + K + '/>');
    },
    rocks: function () {
      var rock = function (x, y, w) { return '<path d="M' + x + ' ' + y + 'l' + (w * .3) + '-' + (w * .25) + 'h' + (w * .4) + 'l' + (w * .3) + ' ' + (w * .25) + 'l-' + (w * .2) + ' ' + (w * .3) + 'h-' + (w * .6) + 'z" fill="#7a6a8a"' + K + '/>'; };
      return art('0 0 540 170', '<path d="M0 170V30c90 20 180-10 270 0s180-20 270 10v130z" fill="#2a2038"' + K + '/>' +
        rock(60, 70, 70) + rock(200, 40, 50) + rock(330, 60, 80) + rock(460, 50, 50) +
        '<g fill="none" stroke="#c9a8ef" stroke-width="2" stroke-dasharray="3 5"><path d="M95 100v20M225 70v18M370 100v22M485 76v16"/></g>');
    },
    theatre: function () {
      return art('0 0 540 170', '<path d="M0 170V0h540v170z" fill="#1a1428"' + K + '/>' +
        '<path d="M0 0h110c-14 60 6 120-20 170H0z" fill="#8e1f2b"' + K + '/><path d="M540 0H430c14 60-6 120 20 170h90z" fill="#8e1f2b"' + K + '/>' +
        '<path d="M0 0h540v24c-20 0-20 14-40 14s-20-14-40-14-20 14-40 14-20-14-40-14-20 14-40 14-20-14-40-14-20 14-40 14-20-14-40-14-20 14-40 14-20-14-40-14-20 14-40 14-20-14-40-14-20 14-40 14-20-14-40-14z" fill="#b22533"' + K + '/>' +
        '<path d="M170 50l100-40 100 40" fill="none" stroke="#f0bb4f" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>');
    },

    // the heroes: one figure, dressed by class
    hero: function (c) { return HERO[c.id](c); },

    // the foes
    skeleton: function () {
      return art('0 0 90 140',
        '<path d="M34 138l4-40h14l4 40" fill="none" stroke="#e8e2d6" stroke-width="6"/>' +
        '<path d="M28 96h34M30 82h30M32 70h26" stroke="#e8e2d6" stroke-width="6" stroke-linecap="round"/><path d="M45 60v40" stroke="#e8e2d6" stroke-width="5"/>' +
        '<path d="M32 40c0-18 26-18 26 0v10l-4 8H36l-4-8z" fill="#e8e2d6"' + K + '/><circle cx="40" cy="44" r="4" fill="' + INK + '"/><circle cx="50" cy="44" r="4" fill="' + INK + '"/>' +
        '<g class="clf-arm" style="transform-origin:10% 20%">' + line('M60 66l18 22', 4, '#e8e2d6') + '<path d="M78 88l8 18-14-10z" fill="#9aa3b3"' + K + '/></g>');
    },
    imp: function () {
      return art('0 0 90 110',
        '<path d="M14 40c-10-20 4-32 18-24l6 18zM76 40c10-20-4-32-18-24l-6 18z" fill="#8e1f2b"' + K + '/>' +
        '<path d="M30 108l6-30h18l6 30zM26 80c0-28 8-42 19-42s19 14 19 42z" fill="#c23f2f"' + K + '/>' +
        '<circle cx="45" cy="30" r="14" fill="#c23f2f"' + K + '/><path d="M34 20l-6-14 12 8zM56 20l6-14-12 8z" fill="#3a1a14"' + K + '/>' +
        '<circle cx="40" cy="30" r="3" fill="#f0bb4f"/><circle cx="50" cy="30" r="3" fill="#f0bb4f"/>' +
        '<path class="clf-flame" d="M78 70c-12-8-6-20 0-28 2 8 12 14 0 28z" fill="#f08a3a"' + K + '/>');
    },
    golem: function () {
      return art('0 0 140 170',
        '<path d="M40 168v-40h24v40zM76 168v-40h24v40z" fill="#7a6a5a"' + K + '/>' +
        '<path d="M20 130l10-80h80l10 80z" fill="#8a7a6a"' + K + '/><path d="M44 70l14 20-10 20M96 60l-12 24 14 18" stroke="#f08a3a" stroke-width="3" fill="none"/>' +
        '<path d="M50 50V22h40v28z" fill="#8a7a6a"' + K + '/><path d="M58 34h8M76 34h8" stroke="#f08a3a" stroke-width="4"/>' +
        '<g class="clf-arm" style="transform-origin:90% 10%">' + '<path d="M2 120l12-60h18l-6 64z" fill="#7a6a5a"' + K + '/></g>');
    },
    ogre: function () {
      return art('0 0 170 200',
        '<path d="M50 198v-40h28v40zM94 198v-40h28v40z" fill="#5a4a3a"' + K + '/>' +
        '<path d="M20 168c0-70 30-110 66-110s66 40 66 110z" fill="#8a9a6a"' + K + '/><path d="M40 150h92v20H40z" fill="#6a4a2a"' + K + '/>' +
        '<circle cx="86" cy="50" r="28" fill="#8a9a6a"' + K + '/><path d="M70 64l4-8 4 8M94 64l4-8 4 8" fill="#f4f1ea"' + K + '/>' +
        '<circle cx="76" cy="44" r="4" fill="' + INK + '"/><circle cx="96" cy="44" r="4" fill="' + INK + '"/>' +
        '<g class="clf-arm" style="transform-origin:85% 90%">' + line('M30 120L10 60', 8, '#8a9a6a') + '<path d="M0 64l4-50 22 4-8 48z" fill="#6a4a2a"' + K + '/></g>');
    },
    wolf: function () {
      return art('0 0 120 80',
        '<path d="M20 78l4-26h12l2 26zM78 78l2-26h12l4 26z" fill="#5a5560"' + K + '/>' +
        '<path d="M10 56c0-20 20-30 50-30s40 8 46 20l12-4-6 18-10 0c-10 8-30 10-50 10S10 70 10 56z" fill="#6a6570"' + K + '/>' +
        '<path d="M96 30l4-14 6 12z" fill="#6a6570"' + K + '/><circle cx="104" cy="40" r="2.5" fill="#f0bb4f"/>');
    },
    sorcerer: function () {
      return art('0 0 100 150',
        '<path d="M16 148c4-50 16-86 34-86s30 36 34 86z" fill="#2f4f8a"' + K + '/>' +
        '<path d="M30 70c0-30 8-60 20-66 12 6 20 36 20 66z" fill="#2f4f8a"' + K + '/><path d="M40 62c4-12 16-12 20 0-4 8-16 8-20 0z" fill="#120c16"/>' +
        '<circle cx="46" cy="60" r="2.5" fill="#7fe0e0"/><circle cx="54" cy="60" r="2.5" fill="#7fe0e0"/>' +
        '<g class="clf-arm" style="transform-origin:90% 95%">' + line('M22 100L8 40', 3, '#8a6a4a') + '<circle cx="8" cy="34" r="9" fill="#7fe0e0"' + K + '/></g>');
    },
    malice: function () {
      return art('0 0 50 80',
        '<path d="M25 2l18 30-18 46L7 32z" fill="#5a1a4a"' + K + '/><path d="M25 2v76M7 32h36" stroke="#c23f8f" stroke-width="2"/>' +
        '<circle cx="25" cy="34" r="6" fill="#ff7ad9"/>');
    },
    guard: function () {
      return art('0 0 90 150',
        '<path d="M28 148l4-50h26l4 50z" fill="#4b5f86"' + K + '/>' +
        '<path d="M22 102c0-26 8-40 23-40s23 14 23 40z" fill="#a9b2bf"' + K + '/>' +
        '<path d="M30 52c0-14 6-22 15-22s15 8 15 22v10H30z" fill="#a9b2bf"' + K + '/><path d="M34 50h22" stroke="' + INK + '" stroke-width="3"/>' +
        line('M70 96l10 10', 3, '#8a6a4a') + '<path d="M74 106h14v18H74z" fill="#f0bb4f"' + K + '/>' +
        '<g class="clf-arm" style="transform-origin:90% 90%">' + line('M24 90L8 50', 4, '#a9b2bf') + '<path d="M8 50L4 18l8 30z" fill="#c9cfd8"' + K + '/></g>');
    },
    crates: function () {
      return art('0 0 90 70',
        '<path d="M2 68V30h44v38zM40 68V40h40v28zM20 30V6h36v24z" fill="#6a4a2a"' + K + '/>' +
        '<path d="M2 30l44 38M46 30L2 68M40 40l40 28M80 40L40 68" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<ellipse cx="45" cy="64" rx="44" ry="8" fill="#120c16" opacity=".55"/>');
    },
    captain: function () {
      return art('0 0 110 160',
        '<path d="M34 158l4-46h34l4 46z" fill="#3a2a22"' + K + '/>' +
        '<path d="M24 118c0-40 12-60 31-60s31 20 31 60z" fill="#8e4a2a"' + K + '/><path d="M24 86h62" stroke="#3a2a22" stroke-width="6"/>' +
        '<circle cx="55" cy="44" r="15" fill="#c9895f"' + K + '/><path d="M38 40c2-18 32-18 34 0l6 2H32z" fill="#2a2a2a"' + K + '/>' +
        '<path d="M48 50h14" stroke="' + INK + '" stroke-width="2"/><path d="M40 40h30" stroke="#c22f39" stroke-width="3"/>' +
        '<g class="clf-arm" style="transform-origin:90% 90%">' + line('M26 96L8 64', 4, '#8e4a2a') + '<path d="M8 64L2 22l12 38z" fill="#c9cfd8"' + K + '/></g>');
    },
    bandit: function () {
      return art('0 0 80 115',
        '<path d="M24 113l3-34h26l3 34z" fill="#3a2a22"' + K + '/>' +
        '<path d="M18 84c0-28 9-42 22-42s22 14 22 42z" fill="#6a5a3a"' + K + '/>' +
        '<circle cx="40" cy="32" r="12" fill="#b07a52"' + K + '/><path d="M28 34h24v8H28z" fill="#3a3a3a"/>' +
        line('M18 70L6 40', 3, '#6a5a3a'));
    },
    ally: function () {
      return art('0 0 90 140',
        '<path d="M30 138l3-40h24l3 40z" fill="#4b5261"' + K + '/>' +
        '<path d="M22 100c0-28 9-44 23-44s23 16 23 44z" fill="#c9cfd8"' + K + '/><path d="M36 60h18v40l-9-6-9 6z" fill="#2f6fae"' + K + '/>' +
        '<path d="M32 42c0-14 6-20 13-20s13 6 13 20v8H32z" fill="#c9cfd8"' + K + '/><path d="M36 42h18" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M4 70h22v32l-11 10-11-10z" fill="#2f6fae"' + K + '/>' +
        '<g class="clf-arm">' + line('M66 84l14-30', 3, '#c9cfd8') + '<path d="M80 54l6-26-10 22z" fill="#e8ebf0"' + K + '/></g>');
    },
    mark: function () {
      return art('0 0 70 222',
        '<circle cx="35" cy="35" r="26" fill="none" stroke="#2f6fae" stroke-width="6"/><circle cx="35" cy="35" r="14" fill="none" stroke="#f0bb4f" stroke-width="4"/>' +
        '<path d="M35 2v66M2 35h66" stroke="#f4f1ea" stroke-width="2.5"/><path d="M35 70v30" stroke="#2f6fae" stroke-width="3" stroke-dasharray="4 5"/>');
    },
    brute: function () {
      return art('0 0 120 160',
        '<path d="M38 158v-36h18v36zM64 158v-36h18v36z" fill="#3a3326"' + K + '/>' +
        '<path d="M16 128c0-56 20-80 44-80s44 24 44 80z" fill="#7a3a3a"' + K + '/><path d="M30 92h60" stroke="#e9b84a" stroke-width="5"/>' +
        '<circle cx="60" cy="40" r="17" fill="#b07a52"' + K + '/><path d="M46 36c4-12 24-12 28 0" fill="#3a2a22"' + K + '/>' +
        '<circle cx="54" cy="42" r="2.5" fill="' + INK + '"/><circle cx="66" cy="42" r="2.5" fill="' + INK + '"/>' +
        '<g class="clf-arm" style="transform-origin:90% 90%">' + line('M22 100L6 66', 7, '#7a3a3a') + '<circle cx="6" cy="62" r="9" fill="#b07a52"' + K + '/></g>');
    },
    duke: function () {
      return art('0 0 100 160',
        '<path d="M30 158l3-44h34l3 44z" fill="#1a1a2a"' + K + '/>' +
        '<path d="M14 120c0-44 14-66 36-66s36 22 36 66z" fill="#5a1a3a"' + K + '/><path d="M14 120L4 150l16-10z M86 120l10 30-16-10z" fill="#5a1a3a"' + K + '/>' +
        '<circle cx="50" cy="40" r="15" fill="#e8c3a0"' + K + '/><path d="M36 30l4-14 10 8 10-8 4 14z" fill="#e9b84a"' + K + '/>' +
        '<path d="M42 48c4 4 12 4 16 0" stroke="' + INK + '" stroke-width="2" fill="none"/><path d="M40 52c4 6 16 6 20 0" fill="' + INK + '"/>' +
        '<g class="clf-arm" style="transform-origin:90% 90%">' + line('M20 96L6 70', 4, '#5a1a3a') + '<path d="M6 70L0 20l10 48z" fill="#e8ebf0"' + K + '/></g>');
    },
    trio: function () {
      var f = function (x, c) { return '<path d="M' + (x - 12) + ' 108l2-30h20l2 30z" fill="#3a3326"' + K + '/><path d="M' + (x - 16) + ' 82c0-22 7-34 16-34s16 12 16 34z" fill="' + c + '"' + K + '/><circle cx="' + x + '" cy="38" r="11" fill="#d9b48f"' + K + '/>'; };
      return art('0 0 140 110', f(24, '#2f6fae') + f(70, '#1d8f80') + f(116, '#b8862a') +
        '<path d="M34 50l10-26M80 50l10-26M126 50l10-26" stroke="#e8ebf0" stroke-width="3"/>');
    },
    dice: function () {
      return art('0 0 70 44',
        '<path d="M2 42V12h28v30zM38 42V8l28 6v28z" fill="#f4f1ea"' + K + '/>' +
        '<g fill="' + INK + '"><circle cx="10" cy="20" r="2.5"/><circle cx="22" cy="34" r="2.5"/><circle cx="16" cy="27" r="2.5"/><circle cx="46" cy="20" r="2.5"/><circle cx="58" cy="34" r="2.5"/></g>');
    }
  };
  // a wall with a broken top edge, the ground every backdrop stands on
  function TOP(fill) { return '<path d="M0 170V40l30-10 20 8 40-14 60 10 40-20 60 12 50-16 40 14 50-8 60 12 40-6 50 10v138z" fill="' + fill + '"' + K + '/>'; }

  // Each class's hero: legs, a coat in the class's colour with its emblem, a head, and what they carry.
  function figure(c, o) {
    return art('0 0 120 170',
      (o.back || '') +
      '<path d="M40 168l4-46h32l4 46z" fill="' + (o.legs || '#3a3326') + '"' + K + '/>' +
      '<path d="M30 128c0-42 12-64 30-64s30 22 30 64z" fill="' + (o.coat || c.k) + '"' + K + '/>' +
      '<path d="M48 72h24v84l-12-8-12 8z" fill="' + (o.trim || '#f4f1ea') + '"' + K + '/>' +
      '<svg x="47" y="84" width="26" height="26" viewBox="0 0 100 100">' + EMBLEM[c.id] + '</svg>' +
      (o.off || '') +
      '<circle cx="60" cy="48" r="15" fill="' + (o.skin || '#d9b48f') + '"' + K + '/>' + (o.head || '') +
      '<g class="clf-arm">' + (o.arm || line('M84 92l18-30', 5, o.coat || c.k)) + '</g>');
  }
  var HERO = {
    conduit: function (c) { return figure(c, { trim: '#f4f1ea', back: '<circle cx="60" cy="46" r="26" fill="none" stroke="#f0bb4f" stroke-width="4"/>',
      head: '<path d="M44 46c0-20 32-20 32 0l-4-6H48z" fill="#f4f1ea"' + K + '/>',
      arm: line('M84 92l14-24', 5, c.k) + line('M100 168V30', 3, '#8a6a4a') + '<circle cx="100" cy="26" r="9" fill="#ffe27a"' + K + '/>' }); },
    elementalist: function (c) { return figure(c, { skin: '#8d5a3b', trim: '#4fc0bf',
      head: '<path d="M44 46c0-22 32-22 32 0-6-8-26-8-32 0z" fill="#1a1a1a"' + K + '/><circle cx="60" cy="34" r="4" fill="#4fc0bf"' + K + '/>',
      arm: line('M84 92l20-26', 5, c.k) + '<path class="clf-flame" d="M106 62c-12-8-6-22 0-30 2 8 12 16 0 30z" fill="#f08a3a"' + K + '/>' }); },
    fury: function (c) { return figure(c, { coat: '#7a4a2a', trim: c.k, skin: '#c99a74',
      head: '<path d="M44 44c-4-22 36-22 32 0 6-14-4-26-16-26S38 30 44 44z" fill="#a83a1a"' + K + '/><path d="M50 50l6 2M64 52l6-2" stroke="#c22f39" stroke-width="3"/>',
      arm: line('M84 92l18-34', 5, '#c99a74') + '<path d="M96 48l20-14 2 26z" fill="#c9cfd8"' + K + '/>' + line('M102 60l-8 14', 3, '#6a4a2a') }); },
    null: function (c) { return figure(c, { coat: '#e8e2d6', trim: c.k, skin: '#b07a52',
      head: '<path d="M46 40c4-10 24-10 28 0" fill="none" stroke="#3c4a63" stroke-width="3"/>',
      arm: line('M84 92l18-22', 5, '#e8e2d6') + '<circle cx="104" cy="66" r="9" fill="#b07a52"' + K + '/>' }); },
    shadow: function (c) { return figure(c, { coat: '#2a2140', trim: c.k, legs: '#1a1428',
      head: '<path d="M42 50c-4-26 40-26 36 0l-4-12H46z" fill="#2a2140"' + K + '/><path d="M47 52h26v8H47z" fill="#1a1428"/>',
      arm: line('M84 92l20-26', 5, '#2a2140') + '<path d="M104 66l12-22-4 24z" fill="#e8ebf0"' + K + '/>',
      off: line('M36 96L18 120', 5, '#2a2140') + '<path d="M18 120l-8 16 12-10z" fill="#e8ebf0"' + K + '/>' }); },
    tactician: function (c) { return figure(c, { coat: '#c9cfd8', trim: c.k,
      head: '<path d="M44 46c0-20 32-20 32 0v6H44z" fill="#9aa3b3"' + K + '/><path d="M60 26V12l12 4z" fill="#2f6fae"' + K + '/>',
      arm: line('M84 92l18-38', 4, '#c9cfd8') + '<path d="M102 54l10-34-2 36z" fill="#e8ebf0"' + K + '/>',
      off: line('M24 168V44', 3, '#8a6a4a') + '<path d="M26 44h30l-6 10 6 10H26z" fill="#2f6fae"' + K + '/>' }); },
    talent: function (c) { return figure(c, { trim: '#e7d4ff', skin: '#e8c3a0',
      head: '<path d="M44 48c-2-24 34-24 32 0-4-10-28-10-32 0z" fill="#3a2350"' + K + '/>',
      back: '<g fill="#c9a8ef"><path d="M20 30l6-8 6 8-6 8z"/><path d="M96 20l6-8 6 8-6 8z"/><path d="M104 70l5-7 5 7-5 7z"/></g>',
      arm: line('M84 92l16-20', 5, c.k) + '<circle cx="104" cy="66" r="10" fill="#e7d4ff"' + K + '/><circle cx="104" cy="66" r="4" fill="#7a4d8f"/>' }); },
    troubadour: function (c) { return figure(c, { trim: '#f0bb4f', skin: '#c99a74',
      head: '<path d="M40 40h40l-6-10H46z" fill="#cf6a1a"' + K + '/><path d="M70 30c10-14 24-14 28-10-10 2-18 8-24 14z" fill="#f4f1ea"' + K + '/>',
      off: '<path d="M14 108c-8-14 4-26 18-20l18 10-10 16-16-2z" fill="#a86a2a"' + K + '/>' + line('M44 100l30-30', 2, '#6a4a2a'),
      arm: line('M84 92l14-20', 5, c.k) + '<path d="M96 70l14-30" stroke="#8a6a4a" stroke-width="2.5"/>' }); }
  };

  // effects that burst over a piece when it's hit, healed, shoved or blessed
  var FX = {
    slash: '<svg viewBox="-30 -30 60 60"><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M-22 -18c14 6 26 20 30 38"/><path d="M-12 -24c14 8 24 22 26 40"/><path d="M-26 -6c10 4 18 12 22 24"/></g></svg>',
    hit: '<svg viewBox="-30 -30 60 60"><path d="M0-26l6 16 16-8-8 16 16 6-16 6 8 16-16-8-6 16-6-16-16 8 8-16-16-6 16-6-8-16 16 8z" fill="#c22f39" stroke="#1c1418" stroke-width="2"/></svg>',
    holy: '<svg viewBox="-30 -30 60 60"><g stroke="#ffe27a" stroke-width="3" stroke-linecap="round"><path d="M0-28v12M0 16v12M-28 0h12M16 0h12M-20-20l8 8M12 12l8 8M20-20l-8 8M-12 12l-8 8"/></g><circle r="9" fill="#fff8e6"/></svg>',
    heal: '<svg viewBox="-30 -30 60 60"><path d="M-6-20h12v14h14v12H6v14H-6V6h-14V-6h14z" fill="#3fbf6a" stroke="#1c1418" stroke-width="2"/><g fill="#bff5cf"><circle cx="-20" cy="-18" r="3"/><circle cx="20" cy="16" r="3"/><circle cx="18" cy="-20" r="2"/></g></svg>',
    flame: '<svg viewBox="-30 -30 60 60"><path d="M0 26c-20 0-24-20-10-34 0 10 6 12 8 10-4-12 2-22 10-28 0 12 14 18 14 32 0 12-10 20-22 20z" fill="#f08a3a" stroke="#1c1418" stroke-width="2"/><path d="M0 20c-8 0-10-8-4-14 2 6 6 4 6 0 4 4 8 8 6 12-2 2-4 2-8 2z" fill="#ffe27a"/></svg>',
    frost: '<svg viewBox="-30 -30 60 60"><g stroke="#bfefff" stroke-width="4" stroke-linecap="round"><path d="M0-26v52M-22-13l44 26M-22 13l44-26"/></g><circle r="6" fill="#fff"/></svg>',
    bolt: '<svg viewBox="-30 -30 60 60"><path d="M6-28L-14 4h12L-8 28 16-6H4z" fill="#ffe27a" stroke="#1c1418" stroke-width="2"/></svg>',
    burst: '<svg viewBox="-30 -30 60 60"><path d="M0-26l7 17 19-2-14 12 10 17-17-8-5 18-5-18-17 8 10-17-14-12 19 2z" fill="var(--k)" stroke="#1c1418" stroke-width="2"/></svg>',
    shadow: '<svg viewBox="-30 -30 60 60"><g fill="#4a3d6e" stroke="#1c1418" stroke-width="2" opacity=".9"><circle cx="-10" cy="4" r="14"/><circle cx="10" cy="-4" r="12"/><circle cx="4" cy="12" r="10"/></g></svg>',
    push: '<svg viewBox="-30 -30 60 60"><g fill="#e7d4ff" stroke="#1c1418" stroke-width="2"><path d="M-26-10h20v-8l16 14-16 14v-8h-20z"/><path d="M-10 8h20v-8l16 14-16 14v-8h-20z"/></g></svg>',
    psychic: '<svg viewBox="-30 -30 60 60"><g fill="none" stroke="#c9a8ef" stroke-width="3"><circle r="8"/><circle r="16"/><circle r="25" stroke-dasharray="5 5"/></g></svg>',
    music: '<svg viewBox="-30 -30 60 60"><g fill="#f0bb4f" stroke="#1c1418" stroke-width="2"><path d="M-14 10a6 5 0 1 0 0.1 0V-20l18-6v26a6 5 0 1 0 0.1 0V-14l-18 6"/></g></svg>',
    dice: '<svg viewBox="-30 -30 60 60"><g fill="#f4f1ea" stroke="#1c1418" stroke-width="2"><rect x="-26" y="-14" width="22" height="22" rx="3"/><rect x="4" y="-6" width="22" height="22" rx="3"/></g></svg>'
  };

  // The censor's chapel has a runner across the gutter, half on each page.
  var FLOORS = {
    runner: ['<div class="clf-runner" style="left:248px;border-left:3px solid #e9b84a"></div>', '<div class="clf-runner" style="left:0;border-right:3px solid #e9b84a"></div>']
  };
  var MOTIONS = { glow: 1, strike: 1, 'lunge-l': 1, 'lunge-r': 1, 'reel-l': 1, 'reel-r': 1, hop: 1 };

  function esc(s) {
    s = s == null ? '' : String(s);
    return typeof Chronicle.escapeHtml === 'function' ? Chronicle.escapeHtml(s)
      : s.replace(/[&<>]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }
  function attr(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  // rich escapes text and then turns the data's **bold** into <b>.
  function rich(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
  function calm() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function emblem(id) { return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' + (EMBLEM[id] || '') + '</svg>'; }
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = pageCss().concat(boardCss()).join('\n') +
      '\n@media (prefers-reduced-motion:reduce){.clf-fx,.clf-float.clf-go{animation:none!important;opacity:1}}';
    document.head.appendChild(st);
    var holder = document.createElement('div');
    holder.innerHTML = DEFS;
    document.body.appendChild(holder.firstChild);
  }
  // playable keeps the classes this widget can draw: a class the data adds
  // without art here gets no tile rather than a broken stage.
  function playable(R) {
    return R.classes.filter(function (c) {
      return EMBLEM[c.id] && COLOR[c.id] && c.scene.pieces.every(function (p) {
        return typeof PIECE[p.art] === 'function' && (p.art !== 'hero' || typeof HERO[c.id] === 'function');
      });
    });
  }

  // One View per mounted element: boot.js calls init/destroy on the shared
  // registration object, so per-mount state lives here.
  function View(el, campaignId) {
    this.el = el;
    this.cid = campaignId;
    this.R = null;
    this.list = [];
    this.at = null;
    this.S = null;
    this.board = null;
    this.timers = [];
  }

  View.prototype.later = function (fn, ms) {
    var self = this, t = window.setTimeout(function () {
      self.timers = self.timers.filter(function (x) { return x !== t; });
      fn();
    }, ms);
    this.timers.push(t);
    return t;
  };

  View.prototype.mount = function () {
    var self = this;
    injectStyles();
    if (!this.cid) {
      this.el.innerHTML = '<p class="clf-problem">The class pop-up books need a campaign to read the class rules from.</p>';
      return;
    }
    this.el.innerHTML = '<div class="clf"><p class="clf-note">Opening the class pop-up books…</p></div>';
    this.onPage = function (e) {
      var t = e.target.closest ? e.target.closest('[data-clf-pick],[data-clf-open]') : null;
      if (!t || !self.R) return;
      if (t.getAttribute('data-clf-open')) return self.open(t.getAttribute('data-clf-open'), t);
      self.at = t.getAttribute('data-clf-pick');
      self.renderPage();
      var again = self.el.querySelector('[data-clf-pick="' + self.at + '"]');
      if (again) again.focus();
    };
    this.el.addEventListener('click', this.onPage);
    var url = '/campaigns/' + encodeURIComponent(this.cid) + '/systems/drawsteel/data/class-fights.json';
    var fetchFn = (typeof Chronicle.apiFetch === 'function') ? Chronicle.apiFetch : window.fetch.bind(window);
    fetchFn(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      var R = rulesFrom(data), list = R ? playable(R) : [];
      if (!list.length) throw new Error('incomplete rules');
      if (!self.el) return;
      self.R = R;
      self.list = list;
      self.at = list[0].id;
      self.renderPage();
    }).catch(function () {
      if (!self.el) return;
      self.el.innerHTML = '<p class="clf-problem">The class pop-up books could not load the class rules, so they stay shut.</p>';
    });
  };

  View.prototype.cls = function (id) {
    return this.list.filter(function (c) { return c.id === id; })[0] || null;
  };

  // renderPage draws the nine tiles and the chosen class's resource.
  View.prototype.renderPage = function () {
    var c = this.cls(this.at) || this.list[0], lc = c.name.toLowerCase();
    var tiles = this.list.map(function (x) {
      return '<button type="button" class="clf-tile" data-clf-pick="' + attr(x.id) + '" style="--k:' + COLOR[x.id] + '" aria-pressed="' + (x.id === c.id) + '">' +
        emblem(x.id) + '<b>' + esc(x.name) + '</b><span>' + esc(x.res) + '</span></button>';
    }).join('');
    this.el.innerHTML = '<div class="clf"><div class="clf-wrap"><div>' +
      '<div class="clf-grid" role="group" aria-label="Pick a class">' + tiles + '</div>' +
      '<p class="clf-note">Pick a class to read it. Each one opens a pop-up book with a fight to try its resource in.</p></div>' +
      '<div style="--k:' + COLOR[c.id] + '">' +
        '<div class="clf-head">' + emblem(c.id) + '<span><small>Heroic resource</small><b>' + esc(c.res) + '</b><i>The ' + esc(lc) + '</i></span></div>' +
        (c.quote ? '<p class="clf-quote">' + esc(c.quote) + '</p>' : '') +
        '<div class="clf-facts"><div><b>How you gain it</b><span>' + esc(c.gain) + '</span></div>' +
        '<div><b>When it ends</b><span>' + esc(c.ends) + '</span></div>' +
        '<div><b>Outside a fight</b><span>' + esc(c.outside) + '</span></div></div>' +
        '<div class="clf-uniq"><small>What makes the ' + esc(lc) + ' different</small>' + esc(c.uniq) + '</div>' +
        '<button type="button" class="clf-open" data-clf-open="' + attr(c.id) + '" aria-haspopup="dialog"><span>Open the ' + esc(lc) + '’s pop-up book</span><span aria-hidden="true">→</span></button>' +
      '</div></div></div>';
  };

  function boardHTML() {
    return '<div class="clf-bhead"><h2 data-n="title"><small data-n="kick"></small><span data-n="tname"></span></h2>' +
      '<button class="clf-ib" type="button" data-a="again" aria-label="Start again">↻</button>' +
      '<button class="clf-ib" type="button" data-a="shut" aria-label="Close the pop-up book">✕</button></div>' +
      '<div class="clf-scene" data-n="scene"><div class="clf-fit"><div class="clf-pbook"><div class="clf-spread clf-closed" data-n="spread"></div></div></div>' +
      '<div class="clf-bub clf-bf" data-n="bubF" aria-live="polite"></div><div class="clf-bub clf-bh" data-n="bubH" aria-live="polite"></div>' +
      '<div class="clf-float" data-n="float" aria-hidden="true"></div></div>' +
      '<div class="clf-table"><div class="clf-col">' +
        '<p class="clf-lab">The fight <em>click the scene, or use the buttons</em></p>' +
        '<p class="clf-hint" data-n="hint"></p><div class="clf-hero" data-n="hero"></div><div class="clf-btns" data-n="btns"></div></div>' +
      '<div class="clf-col">' +
        '<div class="clf-meter"><div class="clf-num" data-n="num" aria-live="polite">0</div><div><div class="clf-pips" data-n="pips"></div><div class="clf-name" data-n="name"></div></div></div>' +
        '<div class="clf-bars" data-n="bars"></div>' +
        '<p class="clf-lab">The fight so far</p><ol class="clf-log" data-n="log"></ol></div></div>' +
      '<p class="clf-foot" data-n="foot"></p>';
  }

  View.prototype.n = function (name) { return this.board.querySelector('[data-n="' + name + '"]'); };
  View.prototype.pieces = function (tag) {
    return [].slice.call(this.n('spread').querySelectorAll('[data-tag="' + tag + '"]'));
  };

  View.prototype.build = function () {
    var self = this, b = this.board = document.createElement('div');
    b.className = 'clf-board';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'true');
    b.hidden = true;
    b.innerHTML = boardHTML();
    b.setAttribute('aria-labelledby', 'clf-t-' + (++View.seq));
    this.n('title').id = 'clf-t-' + View.seq;
    this.veil = document.createElement('div');
    this.veil.className = 'clf-veil';
    this.veil.hidden = true;
    document.body.appendChild(this.veil);
    document.body.appendChild(b);
    this.veil.addEventListener('click', function () { self.close(); });
    b.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button,input') : null;
      if (t && !t.disabled && !t.closest('.clf-spread')) self.press(t);
    });
    var sp = this.n('spread');
    sp.addEventListener('click', function (e) {
      var p = e.target.closest ? e.target.closest('.clf-hot') : null;
      if (p) self.pieceClick(p);
    });
    sp.addEventListener('keydown', function (e) {
      var p = e.target.closest ? e.target.closest('.clf-hot') : null;
      if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); self.pieceClick(p); }
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
  View.seq = 0;

  View.prototype.fit = function () {
    var sc = this.n('scene');
    sc.style.setProperty('--clf-s', Math.min(1, sc.clientWidth / 700).toFixed(3));
  };

  // buildSpread lays the scene's pieces on the pop-up book's two pages. A
  // piece that makes a move is a button on the stage.
  View.prototype.buildSpread = function () {
    var S = this.S, sc = S.sc, c = { id: S.c.id, k: COLOR[S.c.id] }, fl = FLOORS[sc.floor] || ['', ''];
    var h = '<div class="clf-page clf-pr">' + fl[1] + '</div><div class="clf-page clf-pl">' + fl[0] + '<div class="clf-cover">The ' + esc(S.c.name) + '</div></div>';
    sc.pieces.forEach(function (p, i) {
      var hot = '', lab;
      if (p.act !== undefined) {
        lab = p.act === 'turn' ? 'Start your turn' : sc.acts[p.act].b;
        hot = ' clf-hot" data-do="' + attr(p.act) + '" role="button" tabindex="0" aria-label="' + attr(lab);
      }
      h += '<div class="clf-shade" style="left:' + (p.x - 6) + 'px;top:' + (p.y - 10) + 'px;width:' + (p.w + 12) + 'px;height:22px"></div>' +
        '<div class="clf-pop clf-up' + (p.tag === 'glass' ? ' clf-glass' : '') + hot + '"' + (p.tag ? ' data-tag="' + attr(p.tag) + '"' : '') +
        ' style="--i:' + i + ';left:' + p.x + 'px;top:' + (p.y - p.h) + 'px;width:' + p.w + 'px;height:' + p.h + 'px">' +
        '<div class="clf-pc">' + PIECE[p.art](c) + '</div></div>';
    });
    this.n('spread').innerHTML = h;
    this.lift(sc.down || [], false);
    var self = this;
    (sc.swing || []).forEach(function (tag) { self.pieces(tag).forEach(function (p) { p.style.setProperty('--sw', '40deg'); }); });
  };

  View.prototype.lift = function (tags, up) {
    var self = this;
    tags.forEach(function (tag) { self.pieces(tag).forEach(function (p) { p.classList.toggle('clf-up', up); }); });
  };

  function stepper(S, key, label) {
    // A span, not a label: a label would pass a click on its words to the minus button.
    var al = attr(label);
    return '<span class="clf-fld" role="group" aria-label="' + al + '">' + esc(label) + ' <span class="clf-step"><button type="button" data-st="' + key + '" data-d="-1" aria-label="Less ' + al + '">−</button>' +
      '<output aria-live="polite">' + S[key] + '</output><button type="button" data-st="' + key + '" data-d="1" aria-label="More ' + al + '">+</button></span></span>';
  }
  function bar(name, now, max, me, wind) {
    var pc = Math.max(0, Math.min(100, now / max * 100));
    return '<div class="clf-bar' + (me ? ' clf-me' : '') + (now <= 0 ? ' clf-down' : now <= max * wind ? ' clf-wind' : '') + '"><span>' + esc(name) + '</span>' +
      '<b>' + (me ? now : Math.max(now, 0)) + ' / ' + max + '</b><i style="width:' + pc + '%"></i></div>';
  }

  // draw redraws the meter, the bars and the buttons; a piece on the stage
  // greys out while the move it stands for can't be made.
  View.prototype.draw = function (bump) {
    var S = this.S, c = S.c, sc = S.sc, n = S.r, num = this.n('num'), on = S.fight, b = '', h, pips = '', i;
    num.textContent = n;
    num.classList.toggle('clf-neg', n < 0);
    if (bump && !calm()) {
      num.classList.remove('clf-bump'); void num.offsetWidth; num.classList.add('clf-bump');
      this.later(function () { num.classList.remove('clf-bump'); }, 200);
    }
    for (i = 0; i < Math.min(Math.abs(n), 30); i++) pips += '<i' + (n < 0 ? ' class="clf-n"' : '') + '></i>';
    this.n('pips').innerHTML = pips;
    this.n('name').innerHTML = esc(c.res) + (n < 0 ? '<span class="clf-flag">Strained</span>' : '') + (S.dead ? '<span class="clf-flag">Dead</span>' : '') +
      (S.edge && c.edgeDiscount ? '<span class="clf-flag clf-ok">Edge</span>' : '');
    h = bar('You', S.hp, sc.hero.stamina, true, S.R.winded);
    sc.foes.forEach(function (f) { h += bar(f.name, S.foe[f.id], f.stamina, false, S.R.winded); });
    this.n('bars').innerHTML = h;
    h = stepper(S, 'vic', 'Victories');
    if (c.prayer) h += '<label><input type="checkbox" data-opt="pray"' + (S.pray ? ' checked' : '') + '> Pray before your turn</label>';
    if (c.strain) h += stepper(S, 'reason', c.strain.characteristic || 'Reason');
    this.n('hero').innerHTML = h;
    b += '<button type="button" class="clf-main" data-a="start">' + (on ? 'Start a new fight' : 'Start the fight') + '<small>gain your Victories</small></button>';
    b += '<button type="button" class="clf-main" data-a="turn"' + (on ? '' : ' disabled') + '>Start your turn<small>+' + amt(c.turn) + (S.pray && c.prayer ? ', after a prayer' : '') + ', a new round</small></button>';
    sc.acts.forEach(function (a, j) {
      var k = costOf(S, a);
      b += '<button type="button" class="' + (a.cost ? 'clf-spend' : a.trig ? 'clf-trig' : '') + '" data-x="' + j + '"' + (canAct(S, a) ? '' : ' disabled') + '>' + esc(a.b) +
        '<small>' + esc(a.s || '') + (a.cost ? (a.s ? ' · ' : '') + 'costs ' + k + (k !== a.cost ? ' with your edge' : '') : '') + '</small></button>';
    });
    if (c.strain) b += '<button type="button" data-a="endturn"' + (on ? '' : ' disabled') + '>End your turn<small>' + c.strain.damage_per_point + ' damage per point below 0</small></button>';
    if (c.death) b += '<button type="button" data-a="rise"' + (canRise(S) ? '' : ' disabled') + '>Come back to life<small>needs ' + c.death.rise_at + ' ' + esc(c.res.toLowerCase()) + '</small></button>';
    b += '<button type="button" data-a="end"' + (on ? '' : ' disabled') + '>End the fight<small>lose what’s left</small></button>';
    this.n('btns').innerHTML = b;
    [].forEach.call(this.n('spread').querySelectorAll('.clf-hot'), function (p) {
      var x = p.getAttribute('data-do'), ok = x === 'turn' ? on : canAct(S, sc.acts[+x]);
      p.classList.toggle('clf-off', on && !ok);
      p.setAttribute('aria-disabled', on && !ok ? 'true' : 'false');
    });
  };

  // The stage answers each move: a line spoken, pieces moving, a burst over
  // whatever was hit, and the gain floating up.
  View.prototype.bub = function (say) {
    var on, off;
    if (!say) { this.n('bubF').classList.remove('clf-on'); this.n('bubH').classList.remove('clf-on'); return; }
    on = this.n(say[0] === 'f' ? 'bubF' : 'bubH');
    off = this.n(say[0] === 'f' ? 'bubH' : 'bubF');
    off.classList.remove('clf-on');
    on.innerHTML = '<small>' + esc(say[1]) + '</small>' + esc(say[2]);
    on.classList.remove('clf-on'); void on.offsetWidth; on.classList.add('clf-on');
    window.clearTimeout(this.bubT);
    this.bubT = this.later(function () { on.classList.remove('clf-on'); }, 2400);
  };
  View.prototype.flo = function (text, quiet) {
    var f = this.n('float');
    f.textContent = text;
    f.classList.toggle('clf-quiet', !!quiet);
    f.classList.remove('clf-go'); void f.offsetWidth; f.classList.add('clf-go');
    window.clearTimeout(this.floT);
    this.floT = this.later(function () { f.classList.remove('clf-go'); }, 1150);
  };
  View.prototype.fx = function (kind, tag, text) {
    var p = this.pieces(tag)[0], sc = this.n('scene');
    if (!p || !FX[kind]) return;
    var r = p.getBoundingClientRect(), s = sc.getBoundingClientRect(), e = document.createElement('div');
    e.className = 'clf-fx';
    e.style.left = (r.left - s.left + r.width / 2) + 'px';
    e.style.top = (r.top - s.top + r.height * 0.45) + 'px';
    e.innerHTML = FX[kind] + (text ? '<b>' + esc(text) + '</b>' : '');
    sc.appendChild(e);
    this.later(function () { e.remove(); }, calm() ? 600 : 1000);
  };
  View.prototype.moves = function (list) {
    var self = this;
    if (calm()) return;
    list.forEach(function (m) {
      var cl = String(m[1]).split(' ').filter(function (k) { return MOTIONS[k]; }).map(function (k) { return 'clf-m-' + k; });
      self.pieces(m[0]).forEach(function (p) {
        cl.forEach(function (k) { p.classList.add(k); });
        self.later(function () { cl.forEach(function (k) { p.classList.remove(k); }); }, 650);
      });
    });
  };
  View.prototype.log = function (text) {
    var l = this.n('log'), li = document.createElement('li');
    li.innerHTML = rich(text);
    l.insertBefore(li, l.firstChild);
    while (l.children.length > 8) l.removeChild(l.lastChild);
  };

  View.prototype.play = function (E) {
    var self = this;
    E.forEach(function (e) {
      if (e.t === 'log') self.log(e.text);
      else if (e.t === 'clear') self.n('log').innerHTML = '';
      else if (e.t === 'say') { if (e.say) self.bub(e.say); }
      else if (e.t === 'move') self.moves(e.move);
      else if (e.t === 'lift') self.lift(e.tags, e.up);
      else if (e.t === 'flip') self.pieces(e.tag).forEach(function (p) { p.classList.toggle('clf-flip'); });
      else if (e.t === 'fx') self.fx(e.kind, e.at, e.text);
      else if (e.t === 'float') self.flo(e.text, false);
      else if (e.t === 'victory') self.later(function () { self.flo('Victory!', false); }, calm() ? 0 : 700);
    });
  };

  // press keeps keyboard focus on the same control after the redraw
  // replaces it, or on the turn button when that control is now disabled.
  View.prototype.press = function (t) {
    var sel = null, had = document.activeElement === t, again;
    ['data-a', 'data-x', 'data-st', 'data-opt'].forEach(function (k) {
      if (!sel && t.hasAttribute(k)) sel = '[' + k + '="' + attr(t.getAttribute(k)) + '"]' + (k === 'data-st' ? '[data-d="' + attr(t.getAttribute('data-d')) + '"]' : '');
    });
    this.doPress(t);
    if (!had || !sel || !this.board || this.board.hidden || document.contains(t)) return;
    again = this.board.querySelector(sel);
    if (!again || again.disabled) again = this.board.querySelector('[data-a="turn"]:not([disabled])') || this.board.querySelector('[data-a="start"]');
    if (again) again.focus();
  };

  View.prototype.doPress = function (t) {
    var S = this.S, a = t.getAttribute('data-a'), st = t.getAttribute('data-st'), opt = t.getAttribute('data-opt'), x = t.getAttribute('data-x');
    var LIM = { vic: [0, 15], reason: [0, 5] };
    if (a === 'shut') return this.close();
    if (a === 'again') { this.fresh(); this.buildSpread(); return this.draw(); }
    if (st && LIM[st]) { S[st] = Math.max(LIM[st][0], Math.min(LIM[st][1], S[st] + Number(t.getAttribute('data-d')))); return this.draw(); }
    if (opt === 'pray') { S.pray = !!t.checked; return this.draw(); }
    var E = x !== null ? act(S, +x) : a === 'start' ? start(S) : a === 'turn' ? turn(S) : a === 'endturn' ? endTurn(S) : a === 'rise' ? rise(S) : a === 'end' ? end(S) : null;
    if (!E) return;
    this.play(E);
    this.draw(E.length > 0);
  };

  // pieceClick makes the move a piece stands for, or says why it can't yet.
  View.prototype.pieceClick = function (p) {
    var x = p.getAttribute('data-do'), bt = this.n('btns').querySelector(x === 'turn' ? '[data-a="turn"]' : '[data-x="' + x + '"]');
    if (!bt) return;
    if (bt.disabled) return this.flo(this.S.fight ? 'Not now' : 'Start the fight first', true);
    this.press(bt);
  };

  View.prototype.fresh = function () {
    this.S = newFight(this.R, this.S.c);
    this.n('log').innerHTML = '<li>Start the fight, then click the scene: every hit, spell and turn plays out by the ' + esc(this.S.c.name.toLowerCase()) + '’s rules.</li>';
    this.bub(null);
  };

  // ── Opening and closing the pop-up book ─────────────────────

  View.prototype.open = function (id, from) {
    var c = this.cls(id), self = this;
    if (!c || (this.board && !this.board.hidden) || this.shutting) return;
    if (!this.board) this.build();
    var sp = this.n('spread'), lc = c.name.toLowerCase();
    this.opener = from || document.activeElement;
    this.S = newFight(this.R, c);
    this.board.style.setProperty('--k', COLOR[c.id]);
    this.n('kick').textContent = 'Pop-up book · The ' + lc;
    this.n('tname').textContent = c.scene.title || c.name;
    this.n('hint').innerHTML = rich(c.scene.hint || '');
    this.n('foot').textContent = 'How ' + c.res.toLowerCase() + ' is gained and spent follows the ' + lc + '’s chapter of the Heroes Book, and every attack is a power roll ' +
      'read in three tiers. The scene, the foes, their lines and the damage numbers are an example written for this book.';
    this.fresh();
    this.buildSpread();
    sp.classList.add('clf-closed');
    sp.classList.remove('clf-opening', 'clf-shutting');
    this.draw();
    this.veil.hidden = false;
    this.board.hidden = false;
    this.board.scrollTop = 0;
    this.fit();
    window.requestAnimationFrame(function () {
      if (!self.board) return;
      self.veil.classList.add('clf-on');
      self.board.classList.add('clf-on');
      sp.classList.add('clf-opening');
      window.requestAnimationFrame(function () { sp.classList.remove('clf-closed'); });
    });
    this.board.querySelector('[data-a="shut"]').focus();
  };

  // close lays the pieces down, shuts the cover over them, then fades the
  // board, so nothing standing shows through the closing cover.
  View.prototype.close = function () {
    if (!this.board || this.board.hidden || this.shutting) return;
    var self = this, sp = this.n('spread');
    this.bub(null);
    this.n('float').classList.remove('clf-go');
    function done() {
      self.shutting = false;
      sp.classList.remove('clf-shutting');
      self.board.hidden = true;
      self.veil.hidden = true;
      var back = self.opener && document.contains(self.opener) ? self.opener : self.el && self.el.querySelector('[data-clf-open]');
      if (back && typeof back.focus === 'function') back.focus();
    }
    sp.classList.remove('clf-opening');
    sp.classList.add('clf-shutting', 'clf-closed');
    if (calm()) {
      this.board.classList.remove('clf-on');
      this.veil.classList.remove('clf-on');
      return done();
    }
    this.shutting = true;
    this.later(function () {
      self.board.classList.remove('clf-on');
      self.veil.classList.remove('clf-on');
      self.later(done, 320);
    }, SHUT_MS);
  };

  View.prototype.destroy = function () {
    this.timers.forEach(function (t) { window.clearTimeout(t); });
    this.timers = [];
    if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onPage && this.el) this.el.removeEventListener('click', this.onPage);
    if (this.board) this.board.remove();
    if (this.veil) this.veil.remove();
    this.board = this.veil = null;
    if (this.el) this.el.innerHTML = '';
    this.el = null;
  };

  Chronicle.register('class-fights', {
    init: function (el, config) {
      var ds = el.dataset || {};
      config = config || {};
      if (el.__clf) el.__clf.destroy();
      el.__clf = new View(el, config.campaign_id || config.campaignId || ds.campaignId || '');
      el.__clf.mount();
    },
    destroy: function (el) {
      if (el && el.__clf) { el.__clf.destroy(); el.__clf = null; }
    }
  });
})();
