/**
 * Draw Steel monster builder.
 *
 * DrawSteelCreatureEditor edits a creature's stat block in place: the same card
 * the page shows (DrawSteelStatblock in statblock-renderer.js), turned into
 * fields, with the director's party, the encounter budget and the completeness
 * checks beside it. The creature page's panel opens it from "Edit stat block";
 * the 'monster-builder' widget below opens it wherever a layout places it,
 * including on a page with no creature yet, where saving creates one.
 *
 * Every figure the published rules cover (encounter value, Stamina, free strike,
 * ability damage) is evaluated only by DrawSteelFormulas in monster-engine.js.
 * A figure follows its formula until the director types another number, and
 * each one says which it is. Where no formula covers the creature (Swarm, or no
 * role yet) the director sets it, and the editor says so instead of guessing.
 */
var DrawSteelCreatureEditor = (function () {
  'use strict';

  var ORGS = ['minion', 'horde', 'platoon', 'elite', 'leader', 'solo', 'swarm'];
  var ROLES = ['ambusher', 'artillery', 'brute', 'controller', 'defender', 'harrier', 'hexer', 'mount', 'support'];
  var SIZES = [['1T', '1T Tiny'], ['1S', '1S Small'], ['1M', '1M Medium'], ['1L', '1L Large'], ['2', '2 Huge'], ['3', '3 Gargantuan']];
  var ABILITY_TYPES = ['signature', 'action', 'maneuver', 'triggered'];
  var FIGURES = ['ev', 'stamina', 'winded', 'free_strike'];
  var STANDING_LINE = 'These check the stat block is filled in. They don’t judge whether the fight is balanced.';

  function SB() { return (typeof DrawSteelStatblock !== 'undefined') ? DrawSteelStatblock : null; }
  function F() { return (typeof DrawSteelFormulas !== 'undefined' && DrawSteelFormulas) ? DrawSteelFormulas : null; }
  function Engine() { return (typeof MonsterEngine !== 'undefined') ? MonsterEngine : null; }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ── The editor's state ────────────────────────────────────────────────────

  // newState builds an editor state from a creature in either stored shape. A
  // stored figure that differs from its formula, or that no formula covers, is
  // the director's own and stays put: opening the editor never rewrites it.
  function newState(name, src, refs, book) {
    var S = SB();
    var c = S.normalize(src || {});
    c.level = c.level === null ? 1 : clampLevel(c.level);
    var st = { name: name || c.name || '', aiName: false, c: c, own: {}, fromBook: {}, spread: {}, origin: null, editAb: null, refs: refs || { orgs: [], roles: [] }, base: {} };
    // Chronicle replaces a page's fields wholesale on save, so fields this
    // editor doesn't own are carried through untouched.
    if (src && typeof src === 'object' && !Array.isArray(src)) Object.keys(src).forEach(function (k) { st.base[k] = src[k]; });
    var pr = S.provenance(c, st.refs, book || null);
    ['ev', 'stamina', 'free_strike'].forEach(function (k) {
      var stored = k === 'free_strike' ? S.freeStrikeNumber(c.free_strike) : c[k];
      if (stored !== null && pr[k] && pr[k].state !== 'formula') st.own[k] = true;
      // A book creature's printed figure is the book's, not the director's.
      if (pr[k] && pr[k].state === 'book') st.fromBook[k] = true;
    });
    if (c.winded !== null && c.stamina !== null && c.winded !== Math.floor(c.stamina / 2)) st.own.winded = true;
    derive(st);
    followSpread(st);
    return st;
  }

  // The editor's levels run 1 to 20, whole numbers.
  function clampLevel(v) {
    var n = Math.round(Number(v));
    return isFinite(n) ? Math.max(1, Math.min(20, n)) : 1;
  }

  // autoTier rewrites the leading "N damage" (or "N fire damage") of a tier's
  // text and keeps the rest ("; push 2"), so the formula owns the number and
  // the director the words.
  function autoTier(textIn, n) {
    var t = String(textIn || '');
    if (/^\s*\d+(?:\s+[a-z]+)?\s+damage/i.test(t)) return t.replace(/^\s*\d+((?:\s+[a-z]+)?\s+damage)/i, n + '$1');
    return n + ' damage' + (t ? '; ' + t.replace(/^\s*;\s*/, '') : '');
  }

  function isStrike(a) {
    var S = SB();
    return S.parseList(a.keywords).some(function (k) { return String(k).toLowerCase() === 'strike'; });
  }

  var DAMAGE_OPENS = /^\s*\d+(?:\s+[a-z]+)?\s+damage/i;

  // applyDamage writes the formula's damage into the tiers that deal damage (or
  // are empty); a tier written as something else ("Push 2", "No effect.") stays
  // as it was, since the formula has nothing to say about it.
  function applyDamage(a, d, add) {
    ['tier1', 'tier2', 'tier3'].forEach(function (k) {
      var t = String(a[k] || '');
      if (t.trim() === '' || DAMAGE_OPENS.test(t)) a[k] = autoTier(t, d[k] + add);
    });
  }

  // topCharacteristic is the creature's own highest characteristic, which a
  // strike adds to its damage and every power roll is built on; with none set
  // it is the published highest for the level.
  function topCharacteristic(st) {
    var vals = SB().CHARS.map(function (k) { return st.c[k]; }).filter(function (v) { return v !== null && v !== undefined; });
    if (vals.length) return Math.max.apply(null, vals);
    return st.pr && st.pr.hc ? st.pr.hc.value : null;
  }

  // spreadOf is the role's published spread for the level, with the main
  // characteristic at the published highest and none above it. Without a role
  // spread only Might is set. Null when the level has no published highest.
  function spreadOf(pr) {
    var S = SB(), hc = pr.hc ? pr.hc.value : null, rt = pr.role, out = {};
    if (hc === null || hc === undefined) return null;
    if (rt && rt.characteristics) {
      S.CHARS.forEach(function (k) { var v = Number(rt.characteristics[k]) || 0; out[k] = k === rt.primary_stat ? hc : Math.min(v, hc - 1); });
    } else out.might = hc;
    return out;
  }

  // followSpread marks each characteristic that still equals the spread as
  // the spread's, so a level, organization or role change moves it; one the
  // director set to anything else stays theirs.
  function followSpread(st) {
    var sp = spreadOf(st.pr);
    st.spread = {};
    if (!sp) return;
    Object.keys(sp).forEach(function (k) { if (st.c[k] === sp[k]) st.spread[k] = true; });
  }

  // refreshRolls works every power roll the editor wrote out again from the
  // creature's highest characteristic. A roll the director typed is theirs.
  function refreshRolls(st) {
    var hc = topCharacteristic(st);
    if (hc === null || hc === undefined) return;
    st.c.abilities.concat(st.c.villain_actions).forEach(function (a) {
      if (a.auto_roll === false) return;
      if (a.auto_roll === true || a.auto_damage) a.power_roll = '2d10 + ' + hc;
    });
  }

  // derive recomputes every figure the director has not set by hand, and the
  // damage of every ability that follows the formula. It records the formula
  // results on st.pr for the chips and the checks.
  function derive(st) {
    var S = SB(), Fm = F(), c = st.c;
    var org = S.findBySlug(st.refs.orgs, c.organization);
    var role = S.findBySlug(st.refs.roles, c.role);
    var none = function (why) { return { value: null, sourced: false, source: null, notes: [why] }; };
    var why = Fm ? 'Pick an organization to use the published formulas.' : 'The published formulas did not load.';
    var pr = {
      org: org, role: role,
      ev: (Fm && org) ? Fm.encounterValue(c.level, org) : none(why),
      stamina: (Fm && org) ? Fm.stamina(c.level, org, role) : none(why),
      free_strike: (Fm && org) ? Fm.freeStrike(c.level, org, role) : none(why),
      damage: (Fm && org) ? Fm.damageTiers(c.level, org, role) : none(why),
      hc: Fm ? Fm.highestCharacteristic(c.level, org) : none(why),
      formulasLoaded: !!Fm
    };
    // A figure that followed its formula empties when the formulas stop
    // covering the creature (made a swarm, say), rather than keep a number
    // that would then read as the director's.
    if (!st.own.ev && (pr.ev.value !== null || Fm)) c.ev = pr.ev.value;
    if (!st.own.stamina && (pr.stamina.value !== null || Fm)) c.stamina = pr.stamina.value;
    if (!st.own.free_strike && pr.free_strike.value !== null) c.free_strike = freeStrikeText(c.free_strike, pr.free_strike.value);
    else if (!st.own.free_strike && Fm) c.free_strike = null;
    if (!st.own.winded) c.winded = c.stamina === null ? null : Math.floor(c.stamina / 2);
    st.pr = pr;
    var sp = st.spread && spreadOf(pr);
    if (sp) Object.keys(st.spread).forEach(function (k) { if (st.spread[k] && sp[k] !== undefined) c[k] = sp[k]; });
    var hc = topCharacteristic(st);
    var d = pr.damage.value;
    c.abilities.concat(c.villain_actions).forEach(function (a) {
      if (!a.auto_damage || !d) return;
      applyDamage(a, d, (isStrike(a) && hc !== null) ? hc : 0);
    });
    refreshRolls(st);
    var E = Engine();
    pr.vaCount = (E && org) ? E.villainActionCount(org) : (org ? Number(org.villain_action_count) || 0 : 0);
    st.pr = pr;
    return st;
  }

  // freeStrikeText puts the formula's number into a stored free strike and
  // keeps its words ("4 fire damage", "4 damage; push 1").
  function freeStrikeText(text, n) {
    var t = String(text || '');
    if (/-?\d+/.test(t)) return t.replace(/-?\d+/, String(n));
    return n + ' damage';
  }

  // setFigure records a figure the director typed. An empty box hands it back
  // to the formula, or leaves it empty when no formula covers it; text that
  // is not a number is refused and changes nothing.
  function setFigure(st, key, raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (v === '') {
      delete st.own[key]; delete st.fromBook[key];
      derive(st);
      var r = st.pr[key];
      if (key !== 'winded' && r && r.value === null) { st.c[key] = key === 'free_strike' ? '' : null; derive(st); }
      return st;
    }
    if (key === 'free_strike') {
      if (!/\d/.test(v)) return st;
      st.c.free_strike = /^-?\d+$/.test(v) ? v + ' damage' : v;
    } else {
      if (!isFinite(Number(v))) return st;
      st.c[key] = Number(v);
    }
    st.own[key] = true;
    delete st.fromBook[key];
    return derive(st);
  }

  function useFormula(st, key) { delete st.own[key]; delete st.fromBook[key]; return derive(st); }

  // startFrom copies another creature's stat block into this one, level
  // included (only a source with no level takes this one's). Figures and
  // formula-shaped damage are worked out again for that level, so a copy never
  // carries numbers that don't fit it.
  function startFrom(st, srcName, src, origin) {
    var S = SB();
    var c = S.normalize(src || {});
    c.level = c.level === null ? (st.c.level || 1) : clampLevel(c.level);
    c.abilities.forEach(function (a) {
      if ([a.tier1, a.tier2, a.tier3].every(function (t) { return !t || /^\s*\d+\s+damage/i.test(String(t)); }) && (a.tier1 || a.tier2 || a.tier3)) a.auto_damage = true;
    });
    st.c = c;
    st.own = {};
    st.fromBook = {};
    st.spread = {};
    st.origin = origin || null;
    // A page that already has a name keeps it; the copy's name is only for one that has none.
    if (srcName && (!String(st.name || '').trim() || st.autoName)) { st.name = srcName + ' (copy)'; st.autoName = true; }
    st.aiName = false;
    st.editAb = null;
    derive(st);
    followSpread(st);
    return st;
  }

  // checks lists what the stat block still needs. Severity 'ok' and 'miss' are
  // completeness; 'warn' is a figure that differs from a formula the published
  // rules actually define; 'provenance' says what the editor cannot vouch for.
  function checks(st) {
    var c = st.c, pr = st.pr || {}, rows = [];
    function row(ok, msg) { rows.push({ severity: ok ? 'ok' : 'miss', message: msg }); }
    row(!!String(st.name || '').trim(), 'Has a name');
    row(!!c.organization, 'Has an organization');
    if (c.organization !== 'leader' && c.organization !== 'solo') row(!!c.role, 'Has a role');
    row(c.abilities.some(function (a) { return a.type === 'signature'; }), 'Has a signature ability');
    if (pr.vaCount) {
      var vnamed = c.villain_actions.filter(function (v) { return v.name && String(v.name).trim(); });
      var orders = vnamed.map(function (v) { return v.order; });
      row(vnamed.length === pr.vaCount && VA_SLOTS.slice(0, pr.vaCount).every(function (o) { return orders.indexOf(o) >= 0; }), 'Has ' + pr.vaCount + ' villain actions, one of each order');
    }
    row(c.ev !== null, 'Has an encounter value');
    row(c.stamina !== null, 'Has Stamina');
    row(!!String(c.free_strike || '').trim(), 'Has a free strike');
    var blankChars = SB().CHARS.filter(function (k) { return c[k] === null || c[k] === undefined; });
    row(!blankChars.length, blankChars.length ? 'Has all five characteristics (' + blankChars.map(cap).join(', ') + ' still blank; no published figure covers them)' : 'Has all five characteristics');
    ['ev', 'stamina'].forEach(function (k) {
      var r = pr[k];
      if (st.own[k] && !st.fromBook[k] && r && r.sourced && r.value !== null && c[k] !== r.value) {
        rows.push({ severity: 'warn', message: (k === 'ev' ? 'Encounter value' : 'Stamina') + ' is ' + c[k] + '; the published formula gives ' + r.value + '.' });
      }
    });
    var hc = pr.hc && pr.hc.value;
    if (hc !== null && hc !== undefined) {
      var top = Math.max.apply(null, SB().CHARS.map(function (k) { return c[k] === null ? -99 : c[k]; }));
      if (top > -99 && top !== hc) rows.push({ severity: 'warn', message: 'Highest characteristic is ' + SB().signed(top) + '; the published value at this level is ' + SB().signed(hc) + '.' });
    }
    if (!pr.formulasLoaded) {
      rows.push({ severity: 'provenance', message: 'The published formulas did not load, so no figure here could be checked against Draw Steel’s rules.' });
    } else {
      ['ev', 'stamina', 'free_strike'].forEach(function (k) {
        var r = pr[k];
        if (c.organization && r && !r.sourced) rows.push({ severity: 'provenance', message: (r.notes && r.notes[0]) || 'No published formula covers this figure.' });
      });
    }
    return rows;
  }

  // budget is the published encounter budget for the party, and where this
  // creature's EV sits in it. Null when the party can't be read.
  function budget(profile, levels, ev) {
    var Fm = F();
    if (!Fm || !profile || !levels || !levels.length || profile.levelAvg === null) return null;
    var pes = Fm.partyEncounterStrength(levels).value;
    var one = Fm.heroEncounterStrength(Math.round(profile.levelAvg)).value;
    if (pes === null || one === null) return null;
    var bands = Fm.budgetBands(pes, one).value;
    var max = bands.extreme.lower + one * 2;
    var e = Number(ev);
    return {
      bands: bands, max: max, partyEs: pes, oneEs: one,
      ev: isFinite(e) ? e : null,
      difficulty: isFinite(e) && ev !== null ? Fm.difficultyOf(e, pes, one).value : null
    };
  }

  // applySuggestion takes the engine's level, organization and role for the
  // party and lets the formulas fill the rest. Returns the engine's reasons,
  // which the party card shows; the engine never calls the result balanced.
  function applySuggestion(st, profile) {
    var E = Engine();
    if (!E || !profile) return '';
    var s = E.suggest(profile, 'standard', { orgTemplates: st.refs.orgs, roleTemplates: st.refs.roles });
    if (s.level) st.c.level = s.level;
    if (s.organization) st.c.organization = s.organization;
    if (s.role) st.c.role = s.role;
    derive(st);
    return [s.rationale.level, s.rationale.organization, s.rationale.role].filter(Boolean).join(' ');
  }

  // ── Generate one ──────────────────────────────────────────────────────────

  // The generator needs no AI: the party engine (or the director) picks the
  // kind of creature, the package's ability library supplies abilities made
  // for that kind and role, and derive() sets every number from the formulas.
  var KINDS = ['party', 'minion', 'horde', 'platoon', 'elite', 'leader', 'solo'];
  // Words in "What is it?" that pick creature keywords and the library
  // abilities that suit them.
  var THEMES = [
    [/spider|web|insect|beetle|wasp/i, 'Insect', ['web-shot', 'venom-bite']],
    [/dragon|drake|wyrm|wyvern/i, 'Dragon', ['breath-weapon', 'sweeping-tail']],
    [/fire|flame|ember|elemental|storm/i, 'Elemental', ['breath-weapon', 'death-burst']],
    [/ghost|skeleton|zombie|undead|wraith|lich|ghoul/i, 'Undead', ['psychic-scream', 'death-burst']],
    [/wolf|bear|boar|beast|hound|cat/i, 'Beast', ['venom-bite', 'pack-bite']],
    [/snake|serpent|viper/i, 'Animal', ['venom-bite']],
    [/giant|ogre|troll/i, 'Giant', ['crushing-blow', 'thrash']],
    [/goblin/i, 'Goblin', []],
    [/mind|psion|witch|cult/i, 'Humanoid', ['mind-lash', 'psychic-scream']]
  ];
  var VA_SLOTS = ['opener', 'crowd-control', 'ultimate'];
  // renumberVillains gives each villain action the order its position holds,
  // so a removal or a move never leaves two of one order. Every path that
  // changes the list calls it.
  function renumberVillains(list) {
    list.forEach(function (v, i) { v.order = VA_SLOTS[i] || v.order; });
  }
  var DAMAGE_TIER = /^\s*\d+(?:\s+[a-z]+)?\s+damage/i;

  function noRole(org) { return org === 'leader' || org === 'solo'; }
  function props(t) { return (t && t.properties) || {}; }
  function listProp(v) { return Array.isArray(v) ? v : SB().parseList(v); }

  // fits says whether a library ability is made for this organization and
  // role. Leaders and solos have no role, so the organization alone decides.
  function fits(t, org, role) {
    var p = props(t), orgs = listProp(p.organizations), roles = listProp(p.roles);
    if (orgs.indexOf(org) < 0) return false;
    return noRole(org) || !roles.length || !role || roles.indexOf(role) >= 0;
  }

  // fromLibrary turns a library entry into the editor's ability shape. Damage
  // that opens with a number follows the formula; anything else is the
  // template's own words.
  function fromLibrary(t, type) {
    var p = props(t);
    var a = { name: t.name, type: type || p.type || 'action', keywords: listProp(p.keywords).slice(), distance: p.distance || '', target: p.target || '',
      power_roll: '', tier1: p.tier1 || '', tier2: p.tier2 || '', tier3: p.tier3 || '', trigger: p.trigger || '', effect: p.effect || '' };
    a.auto_damage = [a.tier1, a.tier2, a.tier3].some(function (t) { return DAMAGE_TIER.test(t); });
    return a;
  }

  function pick(list, seed) { return list.length ? list[seed % list.length] : null; }
  // themePick takes the ability whose words best match the creature's theme
  // words (a ghost's own haunting before a frog plague); with no match at all
  // it falls back to the plain pick. `seed` steps through the matches.
  function themePick(list, seed, words) {
    var scored = list.map(function (t, i) {
      var h = haystack(t), sc = 0;
      words.forEach(function (w) { if (h.indexOf(w) >= 0) sc++; });
      return { t: t, i: i, sc: sc };
    }).filter(function (r) { return r.sc > 0; }).sort(function (a, b) { return b.sc - a.sc || a.i - b.i; });
    return scored.length ? scored[seed % scored.length].t : pick(list, seed);
  }
  function bySlug(lib, s) { for (var i = 0; i < lib.length; i++) if (lib[i].slug === s) return lib[i]; return null; }
  // Abilities made only for some organizations come first: they are what
  // makes a minion read as a minion and a solo as a solo.
  function specific(t) { return listProp(props(t).organizations).length < 6; }

  // setCharacteristics gives the creature its role's published spread, with
  // the main one at the published highest characteristic and none above it.
  // Returns the reason to show, or '' when the level has no published value.
  function setCharacteristics(st) {
    var S = SB(), c = st.c, hc = st.pr.hc.value, rt = st.pr.role, sp = spreadOf(st.pr);
    if (hc === null) return '';
    st.spread = {};
    Object.keys(sp).forEach(function (k) { c[k] = sp[k]; st.spread[k] = true; });
    if (rt && rt.characteristics) {
      return 'Characteristics: the published ' + c.role + ' spread, with ' + cap(rt.primary_stat) + ' at ' + S.signed(hc) + ', the published highest for this level.';
    }
    return 'Characteristics: Might at ' + S.signed(hc) + ', the published highest for this level. Agility, Reason, Intuition and Presence are blank: no published spread covers a ' + (c.organization || 'creature without a role') + ', so set them yourself.';
  }

  // generate fills the editor with a new creature. opts: { what, kind, role,
  // level, profile }; seed moves "Try other abilities" through the choices.
  // Returns the reasons the page shows, one line per choice.
  function generate(st, opts, lib, seed) {
    var o = opts || {}, why = [], E = Engine(), S = SB();
    var n = Math.abs(Number(seed) || 0);
    var level = Math.max(1, Math.min(20, Number(o.level) || 1));
    var org = o.kind && o.kind !== 'party' ? o.kind : '';
    var role = noRole(org) ? '' : (o.role || '');
    var s = (E && o.profile && (!org || !role)) ? E.suggest(o.profile, 'standard', { orgTemplates: st.refs.orgs, roleTemplates: st.refs.roles }) : null;
    if (!org) { org = (s && s.organization) || 'platoon'; why.push(s && s.rationale.organization ? s.rationale.organization : 'Organization: platoon, the published default for a standard fight.'); }
    else why.push('Organization: ' + org + ', your choice.');
    if (noRole(org)) role = '';
    else if (role) why.push('Role: ' + role + ', your choice.');
    else { role = (s && s.role) || 'brute'; why.push(s && s.rationale.role ? s.rationale.role : 'Role: brute, since no party was read to fit one to.'); }

    var what = String(o.what || '').trim().slice(0, 200);
    var themes = THEMES.filter(function (t) { return t[0].test(what); });
    var c = S.normalize({});
    c.level = level; c.organization = org; c.role = role;
    c.keywords = themes.length ? themes.map(function (t) { return t[1]; }).filter(function (k, i, a) { return a.indexOf(k) === i; }) : ['Humanoid'];
    st.c = c; st.own = {}; st.fromBook = {}; st.spread = {}; st.editAb = null; st.origin = null; st.aiName = false;
    // The page's own name stays: the words only pick the theme. A creature the
    // director has not named (or that a tool named and they have not touched)
    // takes the words up to the first comma.
    if (!String(st.name || '').trim() || st.autoName) {
      var head = what.split(',')[0].trim();
      st.name = head ? head.replace(/\b\w/g, function (x) { return x.toUpperCase(); }) : (noRole(org) ? (org === 'leader' ? 'Warband Captain' : 'Lone Terror') : cap(role) + ' ' + cap(org));
      st.autoName = true;
    }
    // Speed and stability are the organization's published defaults.
    var orgT = S.findBySlug(st.refs.orgs, org), sp = orgT ? Number(orgT.default_speed) : NaN, sb = orgT ? Number(orgT.default_stability) : NaN;
    if (isFinite(sp) && isFinite(sb) && orgT.default_speed != null && orgT.default_stability != null) {
      c.speed = sp; c.stability = sb;
      why.push('Speed ' + sp + ' and stability ' + sb + ': the published defaults for a ' + org + '.');
    } else why.push('No published speed or stability covers a ' + org + ', so set them yourself.');
    derive(st);

    var chWhy = setCharacteristics(st);
    if (chWhy) why.push(chWhy);

    var usable = (lib || []).filter(function (t) { return fits(t, org, role); });
    var themeWords = shortWords(what).concat(themes.map(function (t) { return stem(t[1]); }));
    var themed = [];
    themes.forEach(function (t) { t[2].forEach(function (x) { var a = bySlug(usable, x); if (a && themed.indexOf(a) < 0) themed.push(a); }); });
    var isType = function (types) { return function (t) { return types.indexOf(props(t).type) >= 0; }; };
    var dealsDamage = function (t) { return DAMAGE_TIER.test(props(t).tier1 || ''); };
    var sigs = usable.filter(isType(['signature'])).filter(dealsDamage);
    var sigPool = sigs.filter(specific).concat(themed.filter(isType(['signature'])).filter(dealsDamage), sigs.filter(function (t) { return !specific(t); }))
      .filter(function (t, i, a) { return a.indexOf(t) === i; });
    var sig = themePick(sigPool, n, themeWords);
    var chosen = [];
    if (sig) { c.abilities.push(fromLibrary(sig, 'signature')); chosen.push(sig); }
    var extras = isType(['action', 'maneuver', 'triggered', 'trait']);
    var add = function (t) {
      if (!t || chosen.indexOf(t) >= 0) return;
      chosen.push(t);
      if (props(t).type === 'trait') c.traits.push({ name: t.name, description: props(t).effect || t.description || '' });
      else c.abilities.push(fromLibrary(t));
    };
    // A minion stays simple: its signature and at most one thing of its own.
    add(themePick(usable.filter(extras).filter(specific), n, themeWords));
    if (org !== 'minion') {
      // Abilities any role can take (a breath weapon) come only from the theme.
      var forRole = function (t) { return !specific(t) && listProp(props(t).roles).length < ROLES.length; };
      var more = themed.filter(extras).concat(usable.filter(extras).filter(forRole))
        .filter(function (t) { return chosen.indexOf(t) < 0; });
      add(themePick(more, n, themeWords));
    }
    if (noRole(org)) {
      // The narrowest first: a solo's own villain actions before shared ones.
      var vas = usable.filter(isType(['villain-action'])).sort(function (a, b) { return listProp(props(a).organizations).length - listProp(props(b).organizations).length; });
      VA_SLOTS.forEach(function (slot, k) {
        var left = vas.filter(function (t) { return chosen.indexOf(t) < 0; });
        var v = themePick(left, n + k, themeWords);
        if (!v) return;
        chosen.push(v);
        var a = fromLibrary(v);
        a.order = slot;
        delete a.type;
        c.villain_actions.push(a);
      });
    }
    // Every power roll is 2d10 plus the highest characteristic, and every
    // damage tier the formula covers follows the level, villain actions too.
    c.abilities.concat(c.villain_actions).forEach(function (a) { if (a.tier1 || a.tier2 || a.tier3) a.auto_roll = true; });
    derive(st);
    if (chosen.length) {
      var names = chosen.map(function (t) { return t.name; }).join(', ');
      why.push('Abilities: ' + names + (/[.!?]$/.test(names) ? '' : '.') + ' Each is made for ' + org + 's' +
        (noRole(org) ? '' : ' and the ' + role + ' role') + (themed.length && chosen.some(function (t) { return themed.indexOf(t) >= 0; }) ? ', and some fit a creature like this one' : '') + '.');
    } else {
      why.push('No ability in the library is made for this kind of creature yet. Add your own.');
    }
    why.push('Every number comes from the published formulas, the same as building by hand.');
    return why;
  }

  // ── Build with an AI ──────────────────────────────────────────────────────

  // No AI runs inside Chronicle. The director copies a guide into any AI chat
  // and pastes the answer back. The AI supplies words and picks; every number
  // a published formula covers is worked out here, and the AI's own figure is
  // dropped with a note saying what it said and what the formula gives.

  // vocabulary is every option the AI may pick from, read from the package's
  // own data files so the guide never drifts from them.
  var MOVE_WORDS = ['push', 'pull', 'slide', 'shift', 'teleport', 'fly', 'jump', 'burrow', 'climb-or-swim', 'crawl', 'hover', 'walk'];
  function vocabulary(refs, files) {
    var f = files || {};
    var names = function (list, keep) { return (list || []).filter(keep || function () { return true; }).map(function (x) { return x.name; }).filter(Boolean); };
    var terms = function (cat) { return (f.glossary || []).filter(function (g) { return props(g).category === cat; }).map(function (g) { return g.slug; }); };
    return {
      orgs: refs && refs.orgs && refs.orgs.length ? refs.orgs.map(function (o) { return o.slug; }).filter(function (o) { return o !== 'swarm'; }) : ORGS.filter(function (o) { return o !== 'swarm'; }),
      roles: refs && refs.roles && refs.roles.length ? refs.roles.map(function (r) { return r.slug; }) : ROLES.slice(),
      sizes: SIZES.map(function (z) { return z[0]; }),
      creatureKeywords: names(f.creatureKeywords),
      // Helper tags such as "Attack" are not published keywords.
      abilityKeywords: names(f.abilityKeywords, function (k) { return props(k).group !== 'Helper'; }),
      conditions: terms('condition'),
      durations: terms('duration'),
      // The glossary's movement topics include rules sections ("when a creature
      // moves"); the guide offers only the words that name a movement.
      movement: terms('movement').filter(function (t) { return MOVE_WORDS.indexOf(t) >= 0; }),
      movementAny: terms('movement'),
      damageTypes: DTYPES.slice()
    };
  }

  function quoted(list) { return list.map(function (x) { return '"' + x + '"'; }).join(', '); }

  // guideFor is the text the director copies into an AI chat: the creature,
  // the party, the exact answer shape, every option it can pick from and the
  // book abilities the director shortlisted for it.
  function guideFor(desc, party, v, book) {
    var lines = [
      'Write one Draw Steel creature for my campaign. Reply with only a JSON object, no other text.',
      '',
      'The creature: ' + (String(desc || '').trim() || '(your choice)'),
      'The party: ' + (party || 'not known'),
      '',
      'Use exactly these keys:',
      '{',
      '  "name": "…",',
      '  "level": 1 to 10,',
      '  "organization": one of ' + quoted(v.orgs) + ',',
      '  "role": one of ' + quoted(v.roles) + ' (leave it out for a leader or solo),',
      '  "keywords": creature keywords from the list below,',
      '  "size": one of ' + quoted(v.sizes) + ',',
      '  "speed": a number, "stability": a number,',
      '  "traits": [{ "name": "…", "effect": "…" }],',
      '  "signature": { "name": "…", "keywords": ability keywords from the list below, "distance": "Melee 1" or "Ranged 10" and so on, "target": "…", "damage_type": "" or a damage type, "tier_effects": ["what else happens on tier 1, or empty", "tier 2", "tier 3"] },',
      '  "abilities": [{ "name": "…", "type": "action" | "maneuver" | "triggered", "keywords": [], "distance": "…", "target": "…", "trigger": "for a triggered action", "deals_damage": true or false, "damage_type": "", "tier_effects": ["", "", ""], "effect": "…" }],',
      '  "villain_actions": [{ "name": "…", "distance": "…", "target": "…", "effect": "…" }] (exactly three, for a leader or solo only)' + (book && book.length ? ',' : '')
    ];
    if (book && book.length) lines.push('  "book_abilities": ["id", …] (ids from the book abilities below that suit this creature; leave it out to write all your own)');
    lines.push('}',
      '',
      'Do not give encounter value, Stamina, free strike, characteristics or damage numbers. Chronicle works those out from the published Monster Basics formulas.');
    if (v.creatureKeywords.length) lines.push('', 'Creature keywords: ' + v.creatureKeywords.join(', '));
    if (v.abilityKeywords.length) lines.push('Ability keywords: ' + v.abilityKeywords.join(', '));
    lines.push('Damage types: ' + v.damageTypes.join(', '));
    if (v.conditions.length) lines.push('', 'Mark conditions as {@condition name}, one of: ' + v.conditions.join(', '));
    if (v.durations.length) lines.push('Mark durations as {@duration name}, one of: ' + v.durations.join(', '));
    if (v.movement.length) lines.push('Mark forced movement as {@movement name}, one of: ' + v.movement.join(', '));
    if (book && book.length) {
      lines.push('', 'Book abilities you may use (' + book.length + '). Pick them by id in "book_abilities" and do not copy them into "abilities"; Chronicle adds them with damage from the published formulas. Choose the organization first: an ability marked "only for" some organizations can be used only if you chose one of them, and the rest suit any:');
      book.forEach(function (t) { lines.push(bookLine(t)); });
    }
    return lines.join('\n');
  }

  // ── The book shortlist ────────────────────────────────────────────────────

  // The guide can't carry all of the book's abilities, so the director narrows
  // them with filters and the guide offers at most BOOK_LIMITS' largest.
  var BOOK_LIMITS = [10, 25, 50];
  function newBookFilter() { return { kind: '', fit: 'this', group: '', kw: '', cond: '', q: '', lim: 50, off: {} }; }
  var SHORT_STOP = ['a', 'an', 'the', 'who', 'and', 'that', 'with', 'into', 'onto', 'from', 'their', 'them', 'they', 'this', 'his', 'her', 'its', 'for', 'of', 'to', 'on', 'in', 'at', 'by', 'or', 'as', 'is', 'are', 'be', 'leads', 'down', 'over', 'away', 'back', 'near', 'while', 'which', 'than', 'more', 'most', 'some', 'also', 'then', 'when', 'each', 'have', 'will', 'what', 'your'];

  // bookGroup is the Monsters book chapter an ability came from, read from its
  // source line; '' for the package's own.
  function bookGroup(t) { var m = /Monsters — ([^)]+)\)/.exec(String((t && t.source) || '')); return m ? m[1] : ''; }

  // inflicts lists the conditions an ability's text marks up.
  function inflicts(t) {
    var p = props(t), out = [], re = /\{@condition ([a-z-]+)/g, m, txt = [p.effect, p.tier1, p.tier2, p.tier3, p.trigger].join(' ');
    while ((m = re.exec(txt))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }

  // stem lowers a word to a form that "drags", "dragged" and "dragging" share.
  // Words are compared whole by their stems, so "drag" never matches "dragon".
  function stem(w) {
    w = String(w).toLowerCase().replace(/ies$/, 'y');
    if (w.length > 5) w = w.replace(/(?:ing|ed)$/, '').replace(/([^aeiou])\1$/, '$1');
    return w.replace(/s$/, '');
  }
  function shortWords(text) {
    return String(text || '').toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 3 && SHORT_STOP.indexOf(w) < 0; }).map(stem);
  }
  // haystack is the ability's words as stems, to match whole words against.
  function haystack(t) {
    var p = props(t);
    return shortWords([t.name, p.effect, p.tier1, p.tier3, p.trigger, listProp(p.keywords).join(' '), bookGroup(t)].join(' '));
  }
  function rawHaystack(t) {
    var p = props(t);
    return [t.name, p.effect, p.tier1, p.tier3, p.trigger, listProp(p.keywords).join(' '), bookGroup(t)].join(' ').toLowerCase().split(/[^a-z0-9]+/);
  }

  // shortPass applies every filter but `skip`, so a chip's count says what
  // picking it would leave. `fit` is 'this' (what this creature can take),
  // 'any', or an organization.
  function shortPass(t, c, f, skip) {
    var p = props(t);
    if (skip !== 'kind' && f.kind && p.type !== f.kind) return false;
    if (skip !== 'fit') {
      if ((f.fit || 'this') === 'this' && !usable(t, c)) return false;
      if (f.fit && f.fit !== 'this' && f.fit !== 'any' && listProp(p.organizations).indexOf(f.fit) < 0) return false;
    }
    if (skip !== 'group' && f.group && bookGroup(t) !== f.group) return false;
    if (skip !== 'kw' && f.kw && listProp(p.keywords).indexOf(f.kw) < 0) return false;
    if (skip !== 'cond' && f.cond && inflicts(t).indexOf(f.cond) < 0) return false;
    if (f.q) {
      // Typed search matches the start of a word, so a half-typed word still finds things.
      var h = rawHaystack(t);
      if (!String(f.q).toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return h.some(function (x) { return x.indexOf(w) === 0; }); })) return false;
    }
    return true;
  }

  // shortlist is every book ability the filters leave, best first: words of
  // the description and search it matches, then how closely it was made for
  // this creature's organization and role. Ties keep library order.
  function shortlist(st, lib, f, desc) {
    var c = st.c, ws = shortWords((f.q || '') + ' ' + (desc || ''));
    return (lib || []).map(function (t, i) { return { t: t, i: i }; }).filter(function (r) { return bookGroup(r.t) && shortPass(r.t, c, f); }).map(function (r) {
      var h = haystack(r.t), p = props(r.t), hits = [];
      ws.forEach(function (w) { if (h.indexOf(w) >= 0 && hits.indexOf(w) < 0) hits.push(w); });
      var score = hits.length * 3 + (c.role && listProp(p.roles).indexOf(c.role) >= 0 && listProp(p.roles).length < ROLES.length ? 2 : 0) +
        (c.organization && specific(r.t) && listProp(p.organizations).indexOf(c.organization) >= 0 ? 1 : 0);
      return { t: r.t, i: r.i, hits: hits, score: score };
    }).sort(function (x, y) { return y.score - x.score || x.i - y.i; });
  }

  // shortCounts tallies what each choice of one filter would leave.
  function shortCounts(st, lib, f, key, get) {
    var m = {};
    (lib || []).forEach(function (t) { if (bookGroup(t) && shortPass(t, st.c, f, key)) get(t).forEach(function (v) { m[v] = (m[v] || 0) + 1; }); });
    return m;
  }

  // bookLine is one shortlisted ability as the guide lists it.
  function bookLine(t) {
    var p = props(t), text = plainRefs(p.trigger ? 'Trigger: ' + p.trigger + '. ' + (p.effect || p.tier3 || '') : (p.effect || p.tier3 || p.tier1 || ''));
    var orgs = listProp(p.organizations), only = specific(t) && orgs.length ? 'only for ' + orgs.join('/') : '';
    return '- ' + [t.slug, t.name, p.type, only, listProp(p.keywords).join(', '), p.distance, text.slice(0, 160)].filter(Boolean).join(' | ');
  }

  // scanObject reads one { … } block starting at text[start], mending what
  // chat apps do to JSON: curly quotes used as quotes, trailing commas and
  // // or /* */ comments, all only outside strings. Returns the mended text,
  // whether the block closed, and where the last comma sits (for a block
  // still arriving).
  var CURLY = { '“': 1, '”': 1 };
  function scanObject(s, start) {
    var out = '', stack = [], inS = false, open = '', bs = false, cut = -1, snap = null;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (inS) {
        if (bs) { bs = false; out += ch; continue; }
        if (ch === '\\') { bs = true; out += ch; continue; }
        if (ch === '"' || (open === 'curly' && CURLY[ch])) { inS = false; out += '"'; continue; }
        out += ch; continue;
      }
      if (ch === '"' || CURLY[ch]) { inS = true; open = ch === '"' ? 'straight' : 'curly'; out += '"'; continue; }
      if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
      if (ch === '/' && s[i + 1] === '*') { var e = s.indexOf('*/', i + 2); if (e < 0) { i = s.length; break; } i = e + 1; continue; }
      if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue; }
      if (ch === '}' || ch === ']') {
        out = out.replace(/,(\s*)$/, '$1');
        stack.pop(); out += ch;
        if (!stack.length) return { text: out, closed: true, end: i + 1 };
        continue;
      }
      if (ch === ',' && stack.length) { cut = out.length; snap = stack.slice(); }
      out += ch;
    }
    return { text: out, closed: false, cut: cut, snap: snap, inString: inS };
  }

  var CUT_OFF = 'The answer stops before its closing brace, so it looks cut off. Ask the AI to continue or send it again, then paste all of it.';

  // parseProblem says in plain words where a block that will not read goes
  // wrong; the position comes from the parser's own message when it has one.
  function parseProblem(mended, e) {
    var m = /position (\d+)/.exec(String(e && e.message)), near = '';
    if (m) near = mended.slice(Math.max(0, Number(m[1]) - 20), Number(m[1]) + 20).replace(/\s+/g, ' ').trim();
    return 'The answer has a mistake the editor can’t mend' + (near ? ' near “' + near + '”' : '') + '. Ask the AI to fix its JSON, or to send it again as plain JSON.';
  }

  // readAnswer finds the JSON in a pasted answer: the first { that opens a
  // block that reads as JSON, so braces in the AI's chat around it do not
  // matter. An answer still being pasted is read up to its last complete
  // value, so the editor fills in as it arrives. Returns { obj, done } or
  // { err, wait }; `wait` means more may still arrive.
  function readAnswer(text) {
    var s = String(text || ''), from = s.indexOf('{');
    if (from < 0) return { err: 'No creature in it yet. The answer should hold a { … } block.' };
    var bad = '', partial = null;
    while (from >= 0) {
      var r = scanObject(s, from);
      if (r.closed) {
        try { return { obj: JSON.parse(r.text), done: true }; }
        catch (e) {
          if (!bad) bad = parseProblem(r.text, e);
          // Skip the block that failed whole, so its inner braces are not mistaken for the answer.
          from = s.indexOf('{', r.end);
          continue;
        }
      }
      if (!partial) partial = r;
      break;
    }
    if (partial) {
      if (partial.cut < 0) return { err: 'Reading…', wait: true };
      try { return { obj: JSON.parse(partial.text.slice(0, partial.cut) + partial.snap.reverse().map(function (x) { return x === '{' ? '}' : ']'; }).join('')), done: false }; }
      catch (e) { return { err: 'That isn’t a creature the editor can read. Ask the AI for only the JSON, then paste it again.' }; }
    }
    return { err: bad || 'That isn’t a creature the editor can read. Ask the AI for only the JSON, then paste it again.' };
  }

  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max || 2000) : ''; }
  function strList(v) { return Array.isArray(v) ? v.map(function (x) { return str(x, 60); }).filter(Boolean) : (str(v) ? SB().parseList(str(v)) : []); }

  // keepKnownRefs turns reference markup the glossary doesn't know into its
  // plain words, so a made-up term never becomes a broken hover card.
  function keepKnownRefs(text, v) {
    var known = { condition: v.conditions, duration: v.durations, movement: v.movementAny || v.movement };
    return String(text || '').replace(/\{@(\w+) ([^}|]+)(\|[^}]+)?\}/g, function (m, cat, term, shown) {
      var list = known[cat], t = String(term).trim().toLowerCase().replace(/\s+/g, '-');
      // The guide offers only conditions, durations and movement, so any other marker is plain words.
      if (!(cat in known)) return shown ? shown.slice(1) : term;
      if (!list || !list.length) return m;
      if (list.indexOf(t) >= 0) return '{@' + cat + ' ' + t + (shown || '') + '}';
      return shown ? shown.slice(1) : term;
    });
  }

  // withoutDamage takes the tier's own damage number out of its text ("6 damage",
  // "Deals 9 damage and", "5 + 2 fire damage", "2d10 damage"), leaving potency,
  // forced movement and conditions as written. The formula's figure goes in front.
  // Damage that happens later ("takes 2 damage at the start of each of its
  // turns") is a separate effect no formula covers, so its words stay whole.
  var DAMAGE_NUM = /(?:\b(?:deals?|takes?|taking|suffers?)\s+)?(?:\d+d\d+|\d+)(?:\s*[+\-]\s*(?:\d+d\d+|\d+))*\s+(?:[a-z]+\s+)?damage\b(?:\s+of\s+[a-z]+)?/gi;
  var LATER_DAMAGE = /^\s*(?:at the (?:start|end)|each|every|for each|whenever|when|while|until|per|if)\b/i;
  function withoutDamage(text) {
    var t = String(text || ''), hit = false;
    var out = t.replace(DAMAGE_NUM, function (m, at) {
      if (LATER_DAMAGE.test(t.slice(at + m.length))) return m;
      hit = true;
      return ' ';
    });
    if (!hit) return t;
    return out.replace(/\s+/g, ' ')
      .replace(/([,;])\s*(?:[,;]\s*)+/g, '$1 ')
      .replace(/^[\s,;.]*(?:(?:and|plus)\s+)?/i, '').replace(/[\s,;]*(?:\b(?:and|plus|deals?|takes?)\b[\s,;]*)?$/i, '').trim();
  }

  // fromAI fills the editor from the AI's answer and returns the notes on
  // what was dropped or changed. Words it wrote carry from_ai until saved;
  // book abilities it picked by id come from `lib` and carry from_book.
  function fromAI(st, o, v, lib) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return ['That answer holds no creature.'];
    var notes = [], c;
    var keep = st.base, fresh = newState('', null, st.refs);
    Object.keys(fresh).forEach(function (k) { st[k] = fresh[k]; });
    st.base = keep;
    c = st.c;
    if (str(o.name)) { st.name = str(o.name, 200); st.aiName = true; }
    if (o.level != null) {
      var l = Math.round(Number(o.level));
      if (l >= 1 && l <= 10) c.level = l; else notes.push('Level “' + o.level + '” is outside 1 to 10, so it stays at ' + c.level + '.');
    }
    c.organization = 'platoon';
    if (o.organization != null) {
      var og = String(o.organization).trim().toLowerCase();
      if (v.orgs.indexOf(og) >= 0) c.organization = og; else notes.push('“' + o.organization + '” is not a Draw Steel organization, so it is a platoon.');
    }
    if (str(o.role)) {
      var rl = str(o.role).toLowerCase();
      if (noRole(c.organization)) notes.push('The AI gave a ' + c.organization + ' the role “' + o.role + '”. ' + cap(c.organization) + 's have no role in the published tables, so it was left off.');
      else if (v.roles.indexOf(rl) >= 0) c.role = rl; else notes.push('“' + o.role + '” is not a Draw Steel role, so it has none yet.');
    }
    // Keywords the guide's lists don't hold are dropped and named, as the other unknowns are.
    function known(list, allowed, what) {
      if (!allowed || !allowed.length) return list;
      var lc = {}, out = [], bad = [];
      allowed.forEach(function (k) { lc[String(k).toLowerCase()] = k; });
      list.forEach(function (k) { var h = lc[String(k).toLowerCase()]; if (h) { if (out.indexOf(h) < 0) out.push(h); } else if (bad.length < 5) bad.push(k); });
      if (bad.length) notes.push(what + ' keywords that are not in the lists were left off: ' + bad.join(', ') + '.');
      return out;
    }
    var kws = known(strList(o.keywords), v.creatureKeywords, 'Creature');
    if (kws.length) c.keywords = kws;
    if (o.size != null) { if (v.sizes.indexOf(String(o.size)) >= 0) c.size = String(o.size); else notes.push('Size “' + o.size + '” is not one Draw Steel uses, so it stays ' + c.size + '.'); }
    if (o.speed != null && isFinite(Number(o.speed))) c.speed = Math.max(0, Math.min(20, Math.round(Number(o.speed))));
    if (o.stability != null && isFinite(Number(o.stability))) c.stability = Math.max(0, Math.min(10, Math.round(Number(o.stability))));
    if (Array.isArray(o.traits)) c.traits = o.traits.filter(function (t) { return t && str(t.name); }).slice(0, 20).map(function (t) { return { name: str(t.name, 200), description: keepKnownRefs(str(t.effect || t.description), v), from_ai: true }; });
    derive(st);
    var chWhy = setCharacteristics(st);
    if (chWhy) notes.push(chWhy);
    derive(st);

    var d = st.pr.damage.value, hc = st.pr.hc.value, droppedDamage = [];
    // An ability's tiers: the formula's damage (in the AI's damage type) and
    // whatever else the AI said happens on that tier, minus any number of its own.
    function tiers(a, src, dealsDamage) {
      var te = Array.isArray(src.tier_effects) ? src.tier_effects : [];
      var dtype = str(src.damage_type).toLowerCase();
      if (dtype && DTYPES.indexOf(dtype) < 0) { notes.push('“' + src.damage_type + '” is not a Draw Steel damage type, so ' + a.name + ' deals untyped damage.'); dtype = ''; }
      ['tier1', 'tier2', 'tier3'].forEach(function (k, i) {
        var extra = keepKnownRefs(str(te[i], 500), v);
        var bare = withoutDamage(extra);
        if (bare !== extra) { droppedDamage.push(a.name + ' tier ' + (i + 1)); extra = bare; }
        if (dealsDamage && d) {
          var add = (isStrike(a) && hc !== null) ? hc : 0;
          a[k] = (d[k] + add) + (dtype ? ' ' + dtype : '') + ' damage' + (extra ? '; ' + extra : '');
        } else a[k] = extra;
      });
      a.auto_damage = !!(dealsDamage && d);
      if (a.tier1 || a.tier2 || a.tier3) a.auto_roll = true;
    }
    var sg = o.signature;
    if (sg && typeof sg === 'object' && str(sg.name)) {
      var ranged = /ranged/i.test(str(sg.distance) + ' ' + str(sg.kind));
      var a = { name: str(sg.name, 200), type: 'signature', keywords: known(strList(sg.keywords), v.abilityKeywords, str(sg.name, 60) + '’s ability'), distance: str(sg.distance, 80) || (ranged ? 'Ranged 10' : 'Melee 1'), target: str(sg.target, 120) || 'One creature or object', trigger: '', effect: keepKnownRefs(str(sg.effect), v), from_ai: true };
      if (!a.keywords.length) a.keywords = ranged ? ['Ranged', 'Strike', 'Weapon'] : ['Melee', 'Strike', 'Weapon'];
      tiers(a, sg, true);
      c.abilities.push(a);
    }
    if (Array.isArray(o.abilities)) {
      o.abilities.filter(function (x) { return x && str(x.name); }).slice(0, 20).forEach(function (x) {
        var t = /trigger/i.test(str(x.type)) ? 'triggered' : /maneuver/i.test(str(x.type)) ? 'maneuver' : 'action';
        var a = { name: str(x.name, 200), type: t, keywords: known(strList(x.keywords), v.abilityKeywords, str(x.name, 60) + '’s ability'), distance: str(x.distance, 80), target: str(x.target, 120), trigger: keepKnownRefs(str(x.trigger), v), effect: keepKnownRefs(str(x.effect), v), from_ai: true };
        tiers(a, x, x.deals_damage === true || /^true$/i.test(String(x.deals_damage).trim()));
        c.abilities.push(a);
      });
    }
    if (Array.isArray(o.villain_actions) && o.villain_actions.length) {
      if (noRole(c.organization)) {
        o.villain_actions.filter(function (x) { return x && str(x.name); }).slice(0, 3).forEach(function (x, k) {
          c.villain_actions.push({ order: VA_SLOTS[k], name: str(x.name, 200), distance: str(x.distance, 80), target: str(x.target, 120), effect: keepKnownRefs(str(x.effect), v), from_ai: true });
        });
      } else notes.push('Only leaders and solos take villain actions, so the AI’s ' + o.villain_actions.length + ' were left off.');
    }
    derive(st);
    bookPicks(st, o.book_abilities, lib, notes);
    if (droppedDamage.length) notes.push('The AI put damage numbers in its abilities. They were dropped from ' + droppedDamage.slice(0, 8).join(', ') + (droppedDamage.length > 8 ? ' and ' + (droppedDamage.length - 8) + ' more' : '') + '; the damage comes from the published formula.');
    // Numbers the formulas own: say what the AI said and what is used instead.
    [['ev', 'Encounter value', ['ev', 'encounter_value']], ['stamina', 'Stamina', ['stamina']], ['free_strike', 'Free strike', ['free_strike']]].forEach(function (f) {
      var said = null;
      f[2].forEach(function (k) { if (o[k] != null) said = o[k]; });
      if (said === null) return;
      var r = st.pr[f[0]];
      notes.push(f[1] + ': the AI said ' + String(said).slice(0, 40) + '; ' + (r && r.sourced && r.value !== null ? 'the published formula gives ' + r.value + ', which is used.' : 'no published formula covers it, so set it yourself.'));
    });
    if (o.characteristics != null) notes.push('The AI’s characteristics were dropped; they come from the published tables above.');
    derive(st);
    st.origin = 'From the AI: its name, keywords, traits and abilities are marked until you save' + (Array.isArray(o.book_abilities) && o.book_abilities.length ? ', and the book abilities it picked say so' : '') + '. Check them first, distances and push or shift amounts included. Encounter value, Stamina, free strike, characteristics and damage are the published formulas.';
    return notes;
  }

  // bookPicks adds the book abilities the AI chose, as the Add abilities
  // drawer would: damage from the formulas, nothing twice, villain actions
  // only for a leader or solo. An id the library doesn't hold is named.
  function bookPicks(st, ids, lib, notes) {
    if (!Array.isArray(ids) || !ids.length) return;
    if (!lib || !lib.length) { notes.push('The ability library could not be read, so the ' + ids.length + ' book abilities the AI picked were left off.'); return; }
    var unknown = [], c = st.c;
    ids.slice(0, 20).forEach(function (id) {
      var t = typeof id === 'string' ? bySlug(lib || [], id.trim()) : null;
      if (!t) { if (unknown.length < 5) unknown.push(String(id).slice(0, 60)); return; }
      if (!usable(t, c)) { notes.push(refusal(t, c)); return; }
      var lists = [c.abilities, c.traits, c.villain_actions], before = lists.map(function (l) { return l.length; });
      var res = addFromLibrary(st, t, {});
      if (!res.undo) { notes.push(res.message); return; }
      lists.forEach(function (l, k) { if (l.length > before[k]) l[l.length - 1].from_book = bookGroup(t) || 'book'; });
    });
    if (unknown.length) notes.push('The AI named book abilities that aren’t in the library, so they were left off: ' + unknown.join(', ') + '.');
  }

  // clearAIMarks drops the "From the AI" marks once the director has saved.
  function clearAIMarks(st) {
    var had = !!st.aiName;
    st.aiName = false;
    st.c.abilities.concat(st.c.traits, st.c.villain_actions).forEach(function (a) { if (a.from_ai || a.from_book) had = true; delete a.from_ai; delete a.from_book; });
    if (had) st.origin = null;
    return had;
  }

  // partyLine tells the AI who the creature will face.
  function partyLine(party) {
    var p = party && party.profile;
    if (!p) return '';
    return party.heroes.length + ' heroes' + (p.levelAvg !== null && p.levelAvg !== undefined ? ', average level ' + Math.round(p.levelAvg) : '');
  }

  // The example answer shows what the reading does with a typical reply: a
  // role on a leader, its own Stamina and EV, and a damage number, all dropped.
  var AI_EXAMPLE = JSON.stringify({
    name: 'Skrix the Webmother', level: 4, organization: 'leader', role: 'controller', keywords: ['Goblin', 'Humanoid'], size: '1M', speed: 6, stability: 1,
    stamina: 999, ev: 50,
    traits: [{ name: 'Web Walker', effect: 'Skrix ignores difficult terrain made of webs and can climb at full speed.' }],
    signature: { name: 'Lashing Web', keywords: ['Ranged', 'Strike', 'Weapon'], distance: 'Ranged 10', target: 'Two creatures or objects', damage_type: 'poison', tier_effects: ['8 damage', '{@condition slowed} ({@duration eot})', '{@condition restrained} ({@duration save-ends})'] },
    abilities: [{ name: 'Skitter Back', type: 'maneuver', keywords: [], distance: 'Self', target: 'Self', deals_damage: false, effect: 'Skrix can {@movement shift} 3.' }],
    villain_actions: [
      { name: 'Brood, To Me!', distance: 'Self', target: 'Each ally within 10', effect: 'Each goblin ally within 10 can {@movement shift} 3 toward Skrix.' },
      { name: 'Web the Hall', distance: '5 cube within 10', target: 'Each enemy in the area', effect: 'The area fills with webs; each enemy there is {@condition restrained} ({@duration save-ends}).' },
      { name: 'Mother of Spiders', distance: 'Self', target: 'Self and each ally', effect: 'Until the end of the encounter, Skrix and each ally gain an edge on strikes against restrained creatures.' }
    ]
  }, null, 2);

  // aiHtml is the Build with an AI panel. It is drawn once and kept across
  // redraws, so what the director typed and pasted stays put.
  function aiHtml() {
    return '<div class="sbe-gen"><p class="sbe-hint">Works with any AI chat. Nothing runs inside Chronicle.</p>' +
      '<ol class="sbe-steps"><li><label class="sbe-f"><span class="sbe-lbl">1 · Describe it</span>' +
      '<textarea class="input" rows="2" id="sbe-ai-desc" data-sbe-ai="desc" maxlength="1000" placeholder="A goblin spider rider who leads a raiding band and webs heroes to the walls"></textarea></label>' +
      '<section class="sbe-bk" aria-labelledby="sbe-ai-bk-t"><p class="sbe-lbl" id="sbe-ai-bk-t">Book abilities the AI may pick</p>' +
      '<p class="sbe-hint">The AI picks these by id, and the editor adds them with damage from the formulas, as Add abilities does.</p>' +
      '<input class="input" type="search" id="sbe-ai-bkq" data-sbe-bkq placeholder="Words to match, as well as your description" aria-label="Search the book’s abilities" autocomplete="off">' +
      '<div class="sbe-chips" id="sbe-ai-bkf"></div>' +
      '<div class="sbe-bk-row"><p class="sbe-small" id="sbe-ai-bkn" role="status" aria-live="polite">Reading the ability library…</p><span class="sbe-sp"></span>' +
      '<span class="sbe-small sbe-dim">Up to</span><span class="sbe-bk-lim" role="group" aria-label="How many go in the guide">' +
      BOOK_LIMITS.map(function (n) { return '<button type="button" class="sbe-fchip" data-sbe-bkl="' + n + '" aria-pressed="' + (n === 50) + '">' + chipWord(n) + '</button>'; }).join('') + '</span>' +
      '<button type="button" class="sbe-word" data-sbe-bkx>Clear filters</button></div>' +
      '<div class="sbe-bk-list" id="sbe-ai-bkl" aria-label="The shortlist"></div></section>' +
      '<div class="sbe-gen-go"><button type="button" class="btn-secondary btn-sm" id="sbe-ai-copy" data-sbe-act="ai-copy" disabled>Reading the option lists…</button>' +
      '<span class="sbe-small sbe-dim" id="sbe-ai-copied" role="status">Paste it into ChatGPT, Claude or any AI chat.</span></div>' +
      '<details class="sbe-peek"><summary class="sbe-word">See what the guide says</summary><textarea class="input" rows="9" id="sbe-ai-guide" readonly aria-label="The guide for the AI"></textarea></details></li>' +
      '<li><label class="sbe-f"><span class="sbe-lbl">2 · Paste the AI’s answer</span>' +
      '<textarea class="input" rows="5" id="sbe-ai-ans" data-sbe-ai="ans" placeholder="Paste the whole answer. The editor fills in as it is read."></textarea></label>' +
      '<div class="sbe-gen-go"><button type="button" class="sbe-word" id="sbe-ai-ex" data-sbe-act="ai-example">Try an example answer</button>' +
      '<span class="sbe-small" id="sbe-ai-status" role="status" aria-live="polite"></span><span class="sbe-sp"></span>' +
      '<button type="button" class="sbe-word" data-sbe-act="ai">Close</button></div></li></ol>' +
      '<div id="sbe-ai-notes"></div></div>';
  }

  // chipWord is a chip's word with room kept for its chosen, heavier weight,
  // so choosing a chip never moves the chips beside it.
  function chipWord(text) {
    var t = esc(String(text));
    return '<span class="sbe-cw" data-w="' + t + '">' + t + '</span>';
  }

  // bookFiltersHtml draws the shortlist's filters; each choice shows how
  // many abilities picking it would leave.
  function bookFiltersHtml(st, lib, f) {
    function row(label, key, list) {
      return '<div class="sbe-chip-row" role="group" aria-label="' + label + '"><span class="sbe-bk-k">' + label + '</span><span class="sbe-chip-set">' + list.map(function (x) {
        return '<button type="button" class="sbe-fchip" data-sbe-bkf="' + key + '" data-sbe-bkv="' + esc(x[0]) + '" aria-pressed="' + ((f[key] || (key === 'fit' ? 'this' : '')) === x[0]) + '">' + chipWord(x[1]) +
          (x[2] != null ? ' <span class="sbe-dim">' + x[2] + '</span>' : '') + '</button>';
      }).join('') + '</span></div>';
    }
    var c = st.c, kc = shortCounts(st, lib, f, 'kind', function (t) { return [props(t).type]; });
    var wc = shortCounts(st, lib, f, 'kw', function (t) { return listProp(props(t).keywords); });
    var cc = shortCounts(st, lib, f, 'cond', inflicts);
    var gc = shortCounts(st, lib, f, 'group', function (t) { return [bookGroup(t)]; });
    var me = 'This creature' + (c.organization ? ' (' + c.organization + (c.role && !noRole(c.organization) ? ' ' + c.role : '') + ')' : ' (organization not chosen yet)');
    return row('Kind', 'kind', [['', 'Any']].concat(LIB_KINDS.map(function (k) { return [k[0], k[1], kc[k[0]] || 0]; }))) +
      row('Made for', 'fit', [['this', me], ['any', 'Any creature']].concat(ORGS.filter(function (o) { return o !== 'swarm'; }).map(function (o) { return [o, 'For ' + plural(o)]; }))) +
      '<div class="sbe-chip-row"><label class="sbe-bk-k" for="sbe-ai-bkg">Chapter</label><select class="input sbe-bk-sel" id="sbe-ai-bkg" data-sbe-bkg><option value="">Every chapter</option>' +
        Object.keys(gc).sort().map(function (g) { return '<option value="' + esc(g) + '"' + (f.group === g ? ' selected' : '') + '>' + esc(g) + ' (' + gc[g] + ')</option>'; }).join('') + '</select></div>' +
      row('Keyword', 'kw', [['', 'Any']].concat(Object.keys(wc).sort().map(function (k) { return [k, k, wc[k]]; }))) +
      row('Inflicts', 'cond', [['', 'Anything']].concat(Object.keys(cc).sort().map(function (k) { return [k, cap(k), cc[k]]; })));
  }

  // bookListHtml draws the shortlist, each row with a box to keep it out.
  function bookListHtml(rows, f) {
    if (!rows.length) return '<p class="sbe-small sbe-dim">The shortlist is empty.</p>';
    return rows.map(function (r) {
      var t = r.t, p = props(t), off = !!(f.off && f.off[t.slug]);
      var kind = (LIB_KINDS.filter(function (k) { return k[0] === p.type; })[0] || [0, cap(p.type || '')])[1];
      var text = plainRefs(p.trigger ? 'Trigger: ' + p.trigger + ' ' + (p.effect || '') : (p.effect || p.tier3 || p.tier1 || ''));
      return '<label class="sbe-bk-it' + (off ? ' is-off' : '') + '"><input type="checkbox" data-sbe-bko="' + esc(t.slug) + '"' + (off ? '' : ' checked') + ' aria-label="Offer ' + esc(t.name) + '">' +
        '<span class="sbe-bk-b"><b>' + esc(t.name) + '</b> <span class="sbe-tag">' + esc(kind) + '</span>' +
        (r.hits.length ? ' <span class="sbe-small sbe-ok">matches ' + esc(r.hits.slice(0, 3).join(', ')) + '</span>' : '') +
        '<span class="sbe-small sbe-dim sbe-bk-x">' + esc(text) + '</span></span><span class="sbe-tag">' + esc(bookGroup(t)) + '</span></label>';
    }).join('');
  }

  // bookCountText says how many fit and how many the guide carries.
  function bookCountText(n, f, kept, shown) {
    if (!n) return 'Nothing fits these filters, so the AI writes every ability itself. Clear a filter to offer some.';
    var t = n + ' fit these filters. ' + (n > f.lim ? 'The guide carries the best ' + f.lim + ', ranked by your description and this creature.' : 'All of them go in the guide.');
    if (kept < shown) t += ' ' + (shown - kept) + ' left out by you.';
    return t;
  }

  // aiNotesHtml lists what the reading changed from the AI's answer.
  function aiNotesHtml(notes) {
    if (!notes || !notes.length) return '';
    return '<p class="sbe-lbl">What changed from the AI’s answer</p><ul class="sbe-why">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
  }

  // ── Add abilities ─────────────────────────────────────────────────────────

  var LIB_KINDS = [['signature', 'Signature'], ['action', 'Main action'], ['maneuver', 'Maneuver'], ['triggered', 'Triggered action'], ['villain-action', 'Villain action'], ['trait', 'Trait']];
  var DTYPES = ['acid', 'cold', 'corruption', 'fire', 'holy', 'lightning', 'poison', 'psychic', 'sonic'];
  // One Draw Steel condition an added ability can carry, on the tiers the
  // published creatures usually put it.
  var RIDERS = [
    ['', 'Nothing extra'],
    ['slowed23', '{@condition slowed} ({@duration eot})', ['tier2', 'tier3'], 'Slowed (EoT) on tiers 2 and 3'],
    ['taunted23', '{@condition taunted} ({@duration eot})', ['tier2', 'tier3'], 'Taunted (EoT) on tiers 2 and 3'],
    ['weakened3', '{@condition weakened} ({@duration eot})', ['tier3'], 'Weakened (EoT) on tier 3'],
    ['dazed3', '{@condition dazed} ({@duration save-ends})', ['tier3'], 'Dazed (save ends) on tier 3'],
    ['restrained3', '{@condition restrained} ({@duration save-ends})', ['tier3'], 'Restrained (save ends) on tier 3']
  ];

  function plural(o) { return o + 's'; }
  // refusal names what the ability is made for and what this creature is. A
  // role mismatch lists roles, an organization mismatch lists organizations.
  function refusal(t, c) {
    var made, is;
    if (!c.organization) return t.name + ' is a villain action, which only a leader or solo takes, so it was left off.';
    if (c.organization !== 'swarm' && fits(t, c.organization, null)) { made = listProp(props(t).roles); is = c.role; }
    else { made = listProp(props(t).organizations).map(plural); is = c.organization; }
    return t.name + ' is made for ' + made.join(', ') + ', not ' + article(is) + ' ' + is + ', so it was left off.';
  }
  function article(w) { return /^[aeiou]/i.test(w) ? 'an' : 'a'; }

  // usable says whether this creature can take a library ability. With no
  // organization chosen yet, anything but a villain action is open to it.
  function usable(t, c) {
    if (!c.organization) return props(t).type !== 'villain-action';
    if (c.organization === 'swarm') return props(t).type !== 'villain-action';
    return fits(t, c.organization, c.role);
  }

  // whyFits names what makes an ability a good match, for its chip.
  function whyFits(t, c) {
    var p = props(t), why = [];
    if (c.organization && specific(t) && listProp(p.organizations).indexOf(c.organization) >= 0) why.push('made for ' + plural(c.organization));
    if (c.role && !noRole(c.organization) && listProp(p.roles).length < ROLES.length && listProp(p.roles).indexOf(c.role) >= 0) why.push('suits a ' + c.role);
    THEMES.forEach(function (th) {
      if (th[2].indexOf(t.slug) >= 0 && c.keywords.some(function (k) { return String(k).toLowerCase() === th[1].toLowerCase(); })) why.push('fits ' + th[1].toLowerCase() + 's');
    });
    return why;
  }

  // libraryRows filters and orders the library for the drawer: by default
  // only what this creature can use, best matches first.
  function libraryRows(st, lib, f) {
    var c = st.c, q = String(f.q || '').toLowerCase();
    var rows = (lib || []).map(function (t, i) { return { t: t, i: i, ok: usable(t, c), why: whyFits(t, c) }; }).filter(function (r) {
      var p = props(r.t);
      if (!f.all && !r.ok) return false;
      if (f.type && p.type !== f.type) return false;
      if (f.kw && listProp(p.keywords).indexOf(f.kw) < 0) return false;
      if (f.org && listProp(p.organizations).indexOf(f.org) < 0) return false;
      if (q && [r.t.name, p.effect, p.tier1, listProp(p.keywords).join(' ')].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (x, y) { return ((y.ok ? 8 : 0) + y.why.length) - ((x.ok ? 8 : 0) + x.why.length) || x.i - y.i; });
    return rows;
  }

  // shapeAbility is a library ability as it would be on this creature: damage
  // from the published formula for its level and kind, then the chosen damage
  // type and condition.
  function shapeAbility(st, t, opt) {
    var o = opt || {}, a = fromLibrary(t), pr = st.pr, d = pr.damage.value, hc = topCharacteristic(st);
    if (a.auto_damage && d) applyDamage(a, d, (isStrike(a) && hc !== null) ? hc : 0);
    if (a.tier1 || a.tier2 || a.tier3) a.auto_roll = true;
    if (o.dtype && DTYPES.indexOf(o.dtype) >= 0 && a.auto_damage) {
      ['tier1', 'tier2', 'tier3'].forEach(function (k) { if (a[k]) a[k] = String(a[k]).replace(/^(\s*\d+)(?:\s+[a-z]+)?(\s+damage)/i, '$1 ' + o.dtype + '$2'); });
    }
    var r = RIDERS.filter(function (x) { return x[0] && x[0] === o.rider; })[0];
    // A condition the tier already inflicts is not added a second time.
    if (r && a.tier1) r[2].forEach(function (k) {
      var cm = /\{@condition ([\w-]+)/.exec(r[1]);
      if (a[k] && cm && new RegExp('\\b' + cm[1] + '\\b', 'i').test(String(a[k]))) return;
      a[k] = a[k] ? a[k] + '; ' + r[1] : r[1];
    });
    return a;
  }

  function hasAbility(st, name) {
    var n = String(name || '').trim().toLowerCase();
    return st.c.abilities.concat(st.c.traits, st.c.villain_actions).some(function (a) { return String(a.name || '').trim().toLowerCase() === n; });
  }

  // addFromLibrary puts a library ability on the creature and returns what
  // the drawer says about it; `undo` is the lists as they were, or null when
  // nothing changed. Nothing is added twice.
  function addFromLibrary(st, t, opt) {
    var c = st.c, p = props(t);
    if (hasAbility(st, t.name)) return { message: 'It already has ' + t.name + '.', undo: null };
    if (p.type === 'villain-action' && !noRole(c.organization)) return { message: 'Only leaders and solos take villain actions.', undo: null };
    if (p.type === 'villain-action' && c.villain_actions.length >= 3) return { message: 'All three villain actions are filled. Remove one first.', undo: null };
    var undo = clone({ abilities: c.abilities, traits: c.traits, villain_actions: c.villain_actions });
    var a = shapeAbility(st, t, opt), msg;
    if (p.type === 'trait') {
      c.traits.push({ name: t.name, description: p.effect || t.description || '' });
      msg = 'Added the trait ' + t.name + '.';
    } else if (p.type === 'villain-action') {
      delete a.type;
      c.villain_actions.push(a);
      renumberVillains(c.villain_actions);
      msg = t.name + ' is villain action ' + c.villain_actions.length + '.';
    } else if (a.type === 'signature' && c.abilities.some(function (x) { return x.type === 'signature'; })) {
      a.type = 'action';
      c.abilities.push(a);
      msg = 'Added ' + t.name + ' as a main action, since it already has a signature ability.';
    } else {
      c.abilities.push(a);
      msg = a.type === 'signature' ? t.name + ' is now the signature ability.' : 'Added ' + t.name + '.';
    }
    derive(st);
    return { message: msg, undo: undo };
  }

  function restore(st, undo) {
    st.c.abilities = undo.abilities;
    st.c.traits = undo.traits;
    st.c.villain_actions = undo.villain_actions;
    st.editAb = null;
    return derive(st);
  }

  // moveItem reorders an ability or trait; out-of-range moves do nothing.
  function moveItem(st, kind, from, to) {
    var list = kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits;
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return false;
    list.splice(to, 0, list.splice(from, 1)[0]);
    if (kind === 'v') renumberVillains(list);
    st.editAb = null;
    return true;
  }

  // Fields Foundry sends back to the page (the creature preset's
  // foundry_pull_fields); the editor never writes them.
  var FOUNDRY_OWNED = ['stamina_current', 'conditions_json'];

  // toSave is what saving writes: the entity's fields and the name.
  function toSave(st) {
    var S = SB();
    var c = clone(st.c);
    c.abilities = c.abilities.slice(0, 50);
    c.traits = (c.traits || []).filter(function (t) { return t.name || t.description; });
    c.level = clampLevel(c.level);
    // "From the AI" marks the editor's own review state, never the page.
    c.abilities.concat(c.traits, c.villain_actions || []).forEach(function (a) { delete a.from_ai; delete a.from_book; });
    var fields = {}, own = S.toFields(c);
    // Foundry's fields are the page's to keep: the copy read when the editor
    // opened may be older than what Foundry sent since.
    Object.keys(st.base || {}).forEach(function (k) { if (FOUNDRY_OWNED.indexOf(k) < 0) fields[k] = st.base[k]; });
    Object.keys(own).forEach(function (k) { fields[k] = own[k]; });
    return { name: String(st.name || '').trim().slice(0, 200), fields: fields };
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function esc(s) { return SB().esc(s); }
  function cap(s) { return SB().cap(s); }

  // A stored value outside the list stays selected as its own option, so
  // opening and saving a creature never rewrites it to the first entry.
  function optionsKeeping(list, v) {
    var cur = String(v == null ? '' : v), known = list.some(function (x) { return String(x[0]).toLowerCase() === cur.toLowerCase(); });
    return options(list, v) + (cur && !known ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (as stored)</option>' : '');
  }

  function options(list, v, label) {
    var cur = String(v == null ? '' : v).toLowerCase();
    return list.map(function (x) {
      var val = Array.isArray(x) ? x[0] : x, text = Array.isArray(x) ? x[1] : (label ? label(x) : cap(x));
      return '<option value="' + esc(val) + '"' + (String(val).toLowerCase() === cur ? ' selected' : '') + '>' + esc(text) + '</option>';
    }).join('');
  }

  // chip says where a figure came from, under its box.
  function chip(st, key, r, what) {
    if (st.own[key] && st.fromBook[key]) {
      var bk = (r && r.sourced && r.value !== null && r.value !== r.book) ? ' (the formula gives ' + r.value + ')' : '';
      return '<span class="sbe-chip is-pub" data-sbe-chip="' + key + '"><i class="fa-solid fa-book" aria-hidden="true"></i> From the Monsters book' + esc(bk) + ' · <button type="button" class="sbe-link" data-sbe-reset="' + key + '">Use the formula</button></span>';
    }
    if (st.own[key]) {
      var also = (r && r.sourced && r.value !== null) ? ' (the formula gives ' + r.value + ')' : '';
      return '<span class="sbe-chip is-own" data-sbe-chip="' + key + '">Changed by you' + esc(also) + ' · <button type="button" class="sbe-link" data-sbe-reset="' + key + '">Use the formula</button></span>';
    }
    if (r && r.sourced && r.value !== null) {
      return '<span class="sbe-chip is-pub" data-sbe-chip="' + key + '" title="' + esc(r.source || '') + '"><i class="fa-solid fa-check" aria-hidden="true"></i> Published formula</span>';
    }
    var c = st.c, ask = !c.organization ? 'an organization'
      : (!noRole(c.organization) && !c.role && (key === 'stamina' || key === 'winded')) ? 'a role' : '';
    if (ask) return '<span class="sbe-chip is-wait" data-sbe-chip="' + key + '">Pick ' + ask + ' and the formula fills this in.</span>';
    return '<span class="sbe-chip is-none" data-sbe-chip="' + key + '"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i> No published ' + esc(what) + ' for this creature. Set it yourself.</span>';
  }

  function figureBox(st, key, label, r, what) {
    var v = key === 'free_strike' ? SB().freeStrikeNumber(st.c.free_strike) : st.c[key];
    if (key === 'free_strike' && v === null) v = st.c.free_strike;
    return '<label class="sbe-f"><span class="sbe-lbl">' + label + '</span>' +
      '<span class="sbe-box"><input class="input sbe-num" id="sbe-fig-' + key + '" data-sbe-fig="' + key + '" inputmode="numeric" value="' + esc(v == null ? '' : v) + '" placeholder="—"></span>' +
      chip(st, key, r, what) + '</label>';
  }

  function field(id, label, value, attrs, wide) {
    return '<label class="sbe-f' + (wide ? ' sbe-wide' : '') + '"><span class="sbe-lbl">' + label + '</span>' +
      '<input class="input" id="' + id + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '></label>';
  }

  function area(id, label, value, attrs) {
    return '<label class="sbe-f sbe-full"><span class="sbe-lbl">' + label + '</span>' +
      '<textarea class="input" rows="2" id="' + id + '" ' + (attrs || '') + '>' + esc(value == null ? '' : value) + '</textarea></label>';
  }

  // abilityForm edits one ability, trait or villain action in place. `kind` is
  // 'a', 'v' or 't'; the data-sbe-ab attribute names the property it writes.
  function abilityForm(st, kind, i) {
    var list = kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits;
    var a = list[i] || {};
    var kw = SB().parseList(a.keywords).join(', ');
    var f = function (k, label, wide) { return field('sbe-ab-' + k, label, a[k], 'data-sbe-ab="' + k + '"', wide); };
    var h = '<div class="sbe-ab sbe-ab-edit"><div class="sbe-grid sbe-g4">' + f('name', 'Name', true);
    if (kind === 't') {
      h += '</div>' + area('sbe-ab-description', 'What it does', a.description, 'data-sbe-ab="description"');
    } else {
      if (kind === 'a') h += '<label class="sbe-f"><span class="sbe-lbl">Type</span><select class="input" id="sbe-ab-type" data-sbe-ab="type">' + options(ABILITY_TYPES, a.type || 'action') + '</select></label>';
      h += field('sbe-ab-keywords', 'Keywords', kw, 'data-sbe-ab="keywords" placeholder="Melee, Strike, Weapon"', true) +
        f('distance', 'Distance') + f('target', 'Target', true) + f('power_roll', 'Power roll') + '</div>';
      if (kind === 'a') {
        h += '<label class="sbe-check"><input type="checkbox" id="sbe-ab-auto" data-sbe-ab="auto_damage"' + (a.auto_damage ? ' checked' : '') + '> ' +
          'Damage follows the published formula' + (isStrike(a) ? ' (a strike adds the highest characteristic)' : '') + '</label>';
      }
      h += '<div class="sbe-grid sbe-g3">' + f('tier1', '≤ 11') + f('tier2', '12–16') + f('tier3', '17 +') + '</div>' +
        area('sbe-ab-trigger', 'Trigger', a.trigger, 'data-sbe-ab="trigger"') +
        area('sbe-ab-effect', 'Effect', a.effect || a.description, 'data-sbe-ab="effect"');
    }
    return h + '<div class="sbe-ab-foot"><span></span><button type="button" class="btn-secondary btn-sm" data-sbe-done>Done</button></div></div>';
  }

  function abilityCard(st, kind, i, ui) {
    var a = (kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits)[i];
    var shown = kind === 't' ? { name: a.name, type: 'trait', label: 'Trait', description: a.description }
      : kind === 'v' ? { name: a.name, type: 'villain', label: String(i + 1), keywords: a.keywords, distance: a.distance, target: a.target, power_roll: a.power_roll, tier1: a.tier1, tier2: a.tier2, tier3: a.tier3, trigger: a.trigger, effect: a.effect || a.description }
      : a;
    var note = '';
    if (kind === 'a' && a.auto_damage) {
      note = st.pr.damage.sourced
        ? '<span class="sbe-chip is-pub"><i class="fa-solid fa-check" aria-hidden="true"></i> Damage from the published formula</span>'
        : '<span class="sbe-chip is-none"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i> No published damage for this creature yet</span>';
    }
    if (a.from_ai) note = '<span class="sbe-chip is-ai"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> From the AI</span>' + note;
    if (a.from_book) note = '<span class="sbe-chip is-pub"><i class="fa-solid fa-book" aria-hidden="true"></i> From the book' + (a.from_book !== 'book' ? ' · ' + esc(a.from_book) : '') + '</span>' + note;
    var n = (kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits).length, nm = esc(a.name || 'this');
    // Drag the card to reorder; the arrows do the same for keyboards and phones.
    return '<div class="sbe-ab" draggable="true" data-sbe-item="' + kind + i + '">' + SB().abilityHtml(shown, { ref: ui.ref }) + '<div class="sbe-ab-foot">' + note +
      '<span class="sbe-ab-acts"><span class="sbe-grip" aria-hidden="true" title="Drag to reorder">⠿</span>' +
      '<button type="button" class="sbe-icon" data-sbe-mv="' + kind + i + ':-1" aria-label="Move ' + nm + ' up"' + (i ? '' : ' disabled') + '>↑</button>' +
      '<button type="button" class="sbe-icon" data-sbe-mv="' + kind + i + ':1" aria-label="Move ' + nm + ' down"' + (i < n - 1 ? '' : ' disabled') + '>↓</button>' +
      '<button type="button" class="sbe-link" data-sbe-edit="' + kind + i + '">Edit</button>' +
      '<button type="button" class="sbe-link" data-sbe-del="' + kind + i + '">Remove</button></span></div></div>';
  }

  function listHtml(st, kind, ui) {
    var list = kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits;
    return list.map(function (x, i) {
      return st.editAb === kind + i ? abilityForm(st, kind, i) : abilityCard(st, kind, i, ui);
    }).join('');
  }

  // The editor is a bar, the row of ways to start, the panel hanging under
  // the open way, and the form. mount draws each into its own place, because
  // the With an AI panel is kept across redraws (see aiHtml).
  function editorHtml(st, ui) {
    return barHtml(st, ui) + waysHtml(ui) +
      '<div class="sbe-hang' + (openWay(ui) ? ' is-open' : '') + '">' + panelHtml('gen', ui, genHtml(st, ui)) + panelHtml('from', ui, '') + panelHtml('blank', ui, blankHtml()) + '</div>' +
      '<div class="sbe-part sbe-form">' + editorBody(st, ui) + '</div>';
  }

  function barHtml(st, ui) {
    return '<div class="sbe-bar"><span class="sbe-bar-t">' + esc(ui.heading || (ui.isNew ? 'New stat block' : 'Editing stat block')) + '</span>' +
      '<span class="sbe-sp"></span>' +
      (ui.onClose ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="cancel">Cancel</button>' : '') +
      '<button type="button" class="btn-primary btn-sm" data-sbe-act="save"' + (ui.saving ? ' disabled' : '') + '>' + (ui.saving ? 'Saving…' : 'Save') + '</button></div>';
  }

  // The ways to start: panel name, the tab's words, its id, and the action
  // its click sends. Blank is last because it clears.
  var WAYS = [['gen', 'Generate', 'sbe-gen-open', 'gen'], ['ai', 'With an AI', 'sbe-ai-open', 'ai'], ['from', 'From a creature', 'sbe-from-open', 'start'], ['blank', 'Blank', 'sbe-blank-open', 'blank-open']];
  function wayOf(key, col) { for (var i = 0; i < WAYS.length; i++) if (WAYS[i][col] === key) return WAYS[i]; return null; }
  function openWay(ui) {
    for (var i = 0; i < WAYS.length; i++) if (ui[WAYS[i][0]] && ui[WAYS[i][0]].open) return WAYS[i][0];
    return '';
  }

  // waysHtml is the tab row. Tab reaches the open tab, or the first when none
  // is open; the arrow keys reach the rest.
  function waysHtml(ui) {
    var open = openWay(ui);
    return '<div class="sbe-ways" role="tablist" aria-label="Ways to start">' + WAYS.map(function (w, i) {
      var on = w[0] === open;
      return '<button type="button" role="tab" class="sbe-way" id="' + w[2] + '" data-sbe-act="' + w[3] + '" aria-selected="' + on + '" aria-controls="sbe-' + w[0] + '" tabindex="' + (on || (!open && !i) ? '0' : '-1') + '">' + w[1] + '</button>';
    }).join('') + '<span class="sbe-ind" aria-hidden="true"><i class="sbe-ind-s"></i><i class="sbe-ind-u"></i></span></div>';
  }

  function panelHtml(name, ui, inner) {
    var on = !!(ui[name] && ui[name].open);
    return '<div class="sbe-pan" id="sbe-' + name + '" role="tabpanel" aria-labelledby="' + wayOf(name, 0)[2] + '"' + (on ? '' : ' hidden inert') + '>' + inner + '</div>';
  }

  function blankHtml() {
    return '<div class="sbe-gen"><p class="sbe-hint">Clears the name, figures, traits and abilities below. Pictures stay. Nothing is saved until you press Save.</p>' +
      '<div class="sbe-gen-go"><button type="button" class="btn-secondary btn-sm" id="sbe-blank-go" data-sbe-act="blank">Start blank</button><span class="sbe-sp"></span>' +
      '<button type="button" class="sbe-word" data-sbe-act="blank-open">Close</button></div></div>';
  }

  function editorBody(st, ui) {
    var c = st.c, pr = st.pr;
    var noRole = c.organization === 'leader' || c.organization === 'solo';
    var h = '<p class="sbe-msg' + (ui.msgKind ? ' is-' + ui.msgKind : '') + '">' + esc(ui.msg || '') + '</p>';
    if (st.origin) h += '<p class="sbe-origin"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(st.origin) + '</p>';
    h += '<div class="sbe-grid sbe-g4">' +
      (st.aiName
        ? '<label class="sbe-f sbe-wide"><span class="sbe-lbl">' + esc(ui.nameLabel || 'Name') + '</span><input class="input" id="sbe-name" value="' + esc(st.name || '') + '" data-sbe-k="name" maxlength="200">' + '<span class="sbe-chip is-ai"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> From the AI</span>' + '</label>'
        : field('sbe-name', ui.nameLabel || 'Name', st.name, 'data-sbe-k="name" maxlength="200"', true)) +
      '<label class="sbe-f"><span class="sbe-lbl">Level</span><input class="input sbe-num" id="sbe-level" data-sbe-k="level" type="number" min="1" max="20" value="' + esc(c.level) + '"></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Size</span><select class="input" id="sbe-size" data-sbe-k="size">' + optionsKeeping(SIZES, c.size) + '</select></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Organization</span><select class="input" id="sbe-org" data-sbe-k="organization"><option value="">Choose…</option>' + options(ORGS, c.organization) + '</select></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Role</span><select class="input" id="sbe-role" data-sbe-k="role"' + (noRole ? ' disabled' : '') + '><option value="">Choose…</option>' + options(ROLES, c.role) + '</select>' +
      (noRole ? '<span class="sbe-hint">' + esc(cap(c.organization)) + 's have no role. Their own row in the published table stands in for one.</span>' : '') + '</label>' +
      field('sbe-keywords', 'Keywords', c.keywords.join(', '), 'data-sbe-k="keywords" placeholder="Humanoid, Goblin"', true) +
      field('sbe-faction', 'Faction', c.faction, 'data-sbe-k="faction"', true) +
      field('sbe-immunities', 'Immunities', c.immunities.join(', '), 'data-sbe-k="immunities" placeholder="Fire 5, poison"', true) + '</div>';
    if (ui.pics) h += picsHtml(ui.pics);
    h += '<h4 class="sbe-h">Figures</h4><div class="sbe-grid sbe-g4">' +
      figureBox(st, 'ev', 'Encounter value', pr.ev, 'encounter value') +
      figureBox(st, 'stamina', 'Stamina', pr.stamina, 'Stamina') +
      figureBox(st, 'winded', 'Winded', { sourced: c.stamina !== null, value: c.stamina === null ? null : Math.floor(c.stamina / 2), source: 'Half Stamina, rounded down' }, 'winded value') +
      figureBox(st, 'free_strike', 'Free strike', pr.free_strike, 'free strike') + '</div>';
    h += '<h4 class="sbe-h">Characteristics</h4><div class="sbe-grid sbe-g7">' + SB().CHARS.map(function (k) {
      return '<label class="sbe-f"><span class="sbe-lbl">' + cap(k) + '</span><input class="input sbe-num" id="sbe-c-' + k + '" data-sbe-k="' + k + '" type="number" min="-5" max="6" value="' + esc(c[k] == null ? '' : c[k]) + '"></label>';
    }).join('') +
      '<label class="sbe-f"><span class="sbe-lbl">Speed</span><input class="input sbe-num" id="sbe-speed" data-sbe-k="speed" type="number" min="0" value="' + esc(c.speed == null ? '' : c.speed) + '"></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Stability</span><input class="input sbe-num" id="sbe-stability" data-sbe-k="stability" type="number" min="0" value="' + esc(c.stability == null ? '' : c.stability) + '"></label></div>';
    h += '<p class="sbe-hint">' + (pr.hc.sourced && pr.hc.value !== null
      ? 'At level ' + esc(c.level) + (c.organization ? ', ' + (/^[aeiou]/i.test(c.organization) ? 'an ' : 'a ') + esc(c.organization) : ', this creature') + '’s highest characteristic is ' + SB().signed(pr.hc.value) + ' (published). Strikes add it to every tier, and so does its power roll.'
      : 'Set a level to see the published highest characteristic.') + '</p>';
    var blank = SB().CHARS.filter(function (k) { return c[k] === null || c[k] === undefined; });
    if (blank.length) h += '<p class="sbe-hint sbe-miss">' + esc(blank.map(cap).join(', ')) + ' ' + (blank.length > 1 ? 'are' : 'is') + ' blank. ' + (/^(leader|solo)$/.test(c.organization || '') ? 'Leaders and solos have no role, so no published spread covers them: set ' + (blank.length > 1 ? 'these' : 'this') + ' yourself.' : 'Pick a role for its published spread, or set ' + (blank.length > 1 ? 'these' : 'this') + ' yourself.') + '</p>';
    h += '<h4 class="sbe-h">Traits <button type="button" class="btn-ghost btn-sm" data-sbe-act="add-trait">Add trait</button></h4>' +
      '<div class="sbe-abs">' + listHtml(st, 't', ui) + '</div>';
    h += '<h4 class="sbe-h">Abilities <span class="sbe-h-acts"><button type="button" class="btn-secondary btn-sm" id="sbe-add-abs" data-sbe-act="drawer">Add abilities</button>' +
      '<button type="button" class="btn-ghost btn-sm" data-sbe-act="add-ab">Write your own</button></span></h4>' +
      '<div class="sbe-abs">' + (c.abilities.length ? listHtml(st, 'a', ui) : '<p class="sbe-hint">No abilities yet. Every creature needs a signature ability.</p>') + '</div>';
    if (pr.vaCount || c.villain_actions.length) {
      h += '<h4 class="sbe-h">Villain actions <span class="sbe-hint">' + (pr.vaCount ? esc(cap(c.organization)) + 's get ' + pr.vaCount + ', used once each, in order' : 'This organization has no villain actions') + '</span>' +
        (c.villain_actions.length < 3 ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="add-va">Add villain action</button>' : '') + '</h4>' +
        '<div class="sbe-abs">' + listHtml(st, 'v', ui) + '</div>';
    }
    return h;
  }

  // genHtml is the Generate panel. Its choices live on ui.gen so a redraw
  // keeps them.
  function genHtml(st, ui) {
    var g = ui.gen || {}, prof = ui.party && ui.party.profile;
    var kind = g.kind || 'party';
    var org = kind === 'party' ? null : SB().findBySlug(st.refs.orgs, kind);
    var hint = kind === 'party'
      ? (prof ? 'Picks the organization and role that suit your ' + ui.party.heroes.length + ' heroes.' : ui.partyLoading ? 'Reading your heroes…' : 'No hero pages were read, so this makes a platoon brute unless you pick a role.')
      : ((org && org.description) || '') + (org && Number(org.villain_action_count) ? ' Gets ' + Number(org.villain_action_count) + ' villain actions.' : '');
    var h = '<div class="sbe-gen"><p class="sbe-hint">No AI needed: the package’s ability library and the published formulas.</p>' +
      '<label class="sbe-f"><span class="sbe-lbl">What is it? (optional)</span><input class="input" id="sbe-g-what" data-sbe-g="what" maxlength="200" autocomplete="off" placeholder="Goblin spider rider" value="' + esc(g.what || '') + '">' +
      '<span class="sbe-hint">Picks the theme: words like spider, dragon, ghost or wolf choose keywords and fitting abilities. It names the creature only if it has no name yet.</span></label>' +
      '<div class="sbe-f"><span class="sbe-lbl" id="sbe-g-kind-l">What kind of creature</span><div class="sbe-seg" role="radiogroup" aria-labelledby="sbe-g-kind-l">' +
      KINDS.map(function (k) {
        return '<label><input type="radio" name="sbe-g-kind" id="sbe-g-kind-' + k + '" data-sbe-g="kind" value="' + k + '"' + (k === kind ? ' checked' : '') + '><span>' + chipWord(k === 'party' ? 'Fit my party' : cap(k)) + '</span></label>';
      }).join('') + '</div><span class="sbe-hint">' + esc(hint) + '</span></div>' +
      '<div class="sbe-gen-row"><label class="sbe-f"><span class="sbe-lbl">Level</span><select class="input" id="sbe-g-level" data-sbe-g="level">' +
      options([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (l) { return [String(l), String(l)]; }), g.level || 1) + '</select></label>';
    if (!noRole(kind)) {
      h += '<label class="sbe-f"><span class="sbe-lbl">Role</span><select class="input" id="sbe-g-role" data-sbe-g="role"><option value="">' + (prof ? 'Best for my party' : 'Pick one for me') + '</option>' + options(ROLES, g.role) + '</select></label>';
    }
    h += '</div><div class="sbe-gen-go"><button type="button" class="btn-secondary btn-sm" id="sbe-g-go" data-sbe-act="gen-go"' + (g.loading ? ' disabled' : '') + '>' + (g.loading ? 'Reading the ability library…' : 'Generate') + '</button>' +
      (g.why ? '<button type="button" class="btn-secondary btn-sm" id="sbe-g-again" data-sbe-act="gen-again">Try other abilities</button>' : '') +
      '<span class="sbe-small sbe-dim">It fills the editor below. Change anything, then Save.</span><span class="sbe-sp"></span>' +
      '<button type="button" class="sbe-word" data-sbe-act="gen">Close</button></div>';
    if (g.why) h += '<ul class="sbe-why">' + g.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    return h + '</div>';
  }

  function partyHtml(ui) {
    var p = ui.party;
    if (!p || !p.profile) {
      return '<section class="sbe-side-card"><h4 class="sbe-side-h">Your party</h4><p class="sbe-small sbe-dim">' +
        (ui.partyLoading ? 'Reading your heroes…' : 'No hero pages found in this campaign, so there is no party to build against.') + '</p></section>';
    }
    var prof = p.profile;
    var h = '<section class="sbe-side-card"><h4 class="sbe-side-h">Your party</h4><ul class="sbe-heroes">' + p.heroes.slice(0, 8).map(function (x) {
      var f = x.fields_data || {};
      var sub = [f['class'] ? cap(f['class']) : '', f.level !== undefined && f.level !== '' ? 'level ' + f.level : ''].filter(Boolean).join(' · ');
      return '<li><span class="sbe-av" aria-hidden="true">' + esc(String(x.name || '?').charAt(0)) + '</span><span>' + esc(x.name || 'Unnamed hero') + (sub ? '<br><span class="sbe-dim sbe-small">' + esc(sub) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul>';
    if (p.heroes.length > 8) h += '<p class="sbe-small sbe-dim">And ' + (p.heroes.length - 8) + ' more.</p>';
    h += '<p class="sbe-small sbe-dim">Levels read from ' + esc(prof.coverage.level) + ' hero pages.</p>';
    if (prof.weakestDefense) {
      h += '<p class="sbe-small"><b>Weakest defense:</b> ' + esc(cap(prof.weakestDefense)) + ' (average ' + Number(prof.weakestDefenseValue).toFixed(1) + '). Abilities that target it hit this party hardest.</p>';
    }
    if (Engine()) h += '<p class="sbe-small"><button type="button" class="sbe-link" data-sbe-act="suggest">Suggest a level, organization and role for this party</button></p>';
    if (ui.suggestNote) h += '<p class="sbe-small sbe-dim">' + esc(ui.suggestNote) + '</p>';
    return h + '</section>';
  }

  function budgetHtml(st, ui) {
    var p = ui.party;
    var b = p && p.profile ? budget(p.profile, p.levels, st.c.ev) : null;
    var h = '<section class="sbe-side-card"><h4 class="sbe-side-h">Encounter budget</h4>';
    if (!b) return h + '<p class="sbe-small sbe-dim">The budget appears once the party’s hero levels can be read.</p></section>';
    var bd = b.bands, pct = function (x) { return Math.max(0, Math.min(100, x / b.max * 100)); };
    h += '<p class="sbe-small">A standard fight for this party is <b>' + bd.standard.lower + '–' + bd.standard.upper + ' EV</b>.</p>' +
      '<div class="sbe-meter" role="img" aria-label="' + esc(st.name || 'This creature') + ' uses ' + (b.ev === null ? 'no' : b.ev) + ' EV of a ' + bd.standard.lower + ' to ' + bd.standard.upper + ' EV standard budget">' +
      '<span class="sbe-band is-easy" style="left:' + pct(bd.easy.lower) + '%;width:' + (pct(bd.standard.lower) - pct(bd.easy.lower)) + '%"></span>' +
      '<span class="sbe-band is-std" style="left:' + pct(bd.standard.lower) + '%;width:' + (pct(bd.standard.upper) - pct(bd.standard.lower)) + '%"></span>' +
      '<span class="sbe-band is-hard" style="left:' + pct(bd.hard.lower) + '%;width:' + (pct(bd.hard.upper) - pct(bd.hard.lower)) + '%"></span>' +
      '<span class="sbe-fill" style="width:' + pct(b.ev || 0) + '%"></span></div>' +
      '<div class="sbe-meter-k sbe-small sbe-dim" aria-hidden="true"><span>0</span><span>Easy</span><span>Standard</span><span>Hard</span><span>' + b.max + '</span></div>';
    if (b.ev !== null) {
      h += '<p class="sbe-small">' + esc(st.name || 'This creature') + ' is <b>' + b.ev + ' EV</b>' +
        (b.ev < bd.standard.lower ? '. Add ' + (bd.standard.lower - b.ev) + '–' + (bd.standard.upper - b.ev) + ' EV of other creatures for a standard fight.'
          : ', a ' + esc(b.difficulty) + ' fight on its own by the published bands.') + '</p>';
    } else {
      h += '<p class="sbe-small">This creature has no encounter value yet.</p>';
    }
    return h + '<p class="sbe-small sbe-dim">Published encounter rules, Monsters Book ch. 8. Creature counts and the rest of the fight are not checked here.</p></section>';
  }

  function checksHtml(st) {
    var icon = { ok: 'fa-circle-check', miss: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation', provenance: 'fa-circle-info' };
    return '<section class="sbe-side-card"><h4 class="sbe-side-h">Completeness checks</h4>' +
      '<p class="sbe-small sbe-dim">' + esc(STANDING_LINE) + '</p><ul class="sbe-checks">' +
      checks(st).map(function (r) {
        return '<li class="is-' + r.severity + '"><i class="fa-solid ' + icon[r.severity] + '" aria-hidden="true"></i><span>' + esc(r.message) + '</span></li>';
      }).join('') + '</ul></section>';
  }

  function sideHtml(st, ui) { return partyHtml(ui) + budgetHtml(st, ui) + checksHtml(st); }

  // ── Behaviour ─────────────────────────────────────────────────────────────

  function listOf(st, kind) { return kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits; }

  // applyField writes one identity or characteristic box into the state.
  function applyField(st, k, v) {
    var S = SB();
    if (k === 'name') { st.name = v; st.autoName = false; return; }
    if (k === 'keywords' || k === 'immunities') { st.c[k] = S.parseList(v); return; }
    if (k === 'faction' || k === 'size') { st.c[k] = v; return; }
    if (k === 'organization' || k === 'role') { st.c[k] = String(v || '').toLowerCase(); return; }
    var n = String(v).trim() === '' ? null : Number(v);
    st.c[k] = (n === null || !isFinite(n)) ? null : n;
    if (k === 'level') st.c.level = clampLevel(st.c.level === null ? 1 : st.c.level);
    // A characteristic the director sets is theirs, not the role spread's.
    if (SB().CHARS.indexOf(k) >= 0 && st.spread) delete st.spread[k];
  }

  // applyAbility writes one box of the ability being edited.
  function applyAbility(st, k, v) {
    var key = st.editAb;
    if (!key) return;
    var a = listOf(st, key.charAt(0))[Number(key.slice(1))];
    if (!a) return;
    var note = '';
    if (k === 'keywords') a.keywords = SB().parseList(v);
    else if (k === 'auto_damage') a.auto_damage = !!v;
    else {
      // A number the director types is never rewritten: typing into a tier
      // takes that ability off the formula, typing a power roll stops it
      // following the highest characteristic.
      if (a[k] !== v && (k === 'tier1' || k === 'tier2' || k === 'tier3') && a.auto_damage) {
        a.auto_damage = false;
        if (a.auto_roll === undefined) a.auto_roll = true;
        note = 'Damage no longer follows the published formula for ' + (a.name || 'this ability') + ', since you typed in it. Tick the box to hand it back.';
      }
      if (a[k] !== v && k === 'power_roll' && (a.auto_roll === true || (a.auto_damage && a.auto_roll !== false))) {
        a.auto_roll = false;
        note = 'The power roll of ' + (a.name || 'this ability') + ' is yours now. It no longer follows the highest characteristic.';
      }
      a[k] = v;
    }
    return note;
  }

  // removeItem takes one ability, trait or villain action off the creature.
  function removeItem(st, kind, i) {
    listOf(st, kind).splice(i, 1);
    if (kind === 'v') renumberVillains(st.c.villain_actions);
    st.editAb = null;
    return derive(st);
  }

  // addVillain appends a blank villain action in the next free order and opens
  // it for editing.
  function addVillain(st) {
    st.c.villain_actions.push({ order: '', name: 'Villain action ' + (st.c.villain_actions.length + 1), effect: '' });
    renumberVillains(st.c.villain_actions);
    st.editAb = 'v' + (st.c.villain_actions.length - 1);
  }

  // newAbility is a signature strike when the creature has none yet, so the
  // first Add gives a usable attack whose damage follows the formula.
  function newAbility(st) {
    var first = !st.c.abilities.some(function (a) { return a.type === 'signature'; });
    return { name: first ? 'Signature strike' : 'New ability', type: first ? 'signature' : 'action', keywords: ['Melee', 'Strike', 'Weapon'],
      distance: 'Melee 1', target: (st.c.organization === 'elite' || st.c.organization === 'leader' || st.c.organization === 'solo') ? 'Two creatures or objects' : 'One creature or object',
      tier1: '', tier2: '', tier3: '', effect: '', auto_damage: true };
  }

  function apiCall(url, opts) { return SB().apiFetch(url, opts); }

  // ── Pictures ──────────────────────────────────────────────────────────────

  // The art is the page picture and the token a field; both are media ids
  // (see DrawSteelStatblock.pictures). They change only when the director saves.
  var PIC_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  var PIC_MAX = 10 * 1024 * 1024;

  function picProblem(file) {
    if (!file) return 'Choose a picture.';
    if (PIC_TYPES.indexOf(String(file.type || '').toLowerCase()) === -1) return 'Use a PNG, JPEG, WebP or GIF picture.';
    if (file.size > PIC_MAX) return 'That picture is over 10 MB. Use a smaller one.';
    return '';
  }

  function newPics(entity) {
    var p = SB().pictures(entity);
    return { art: p.art, token: p.token, art0: p.art, busy: '', msg: '', msgKind: '' };
  }

  // Chronicle's token maker frames a picture into a token; older Chronicle
  // versions have none, and the token slot then offers only an upload.
  function canMakeToken() {
    return typeof Chronicle !== 'undefined' && !!Chronicle.tokenMaker && typeof Chronicle.tokenMaker.open === 'function';
  }

  // busy: this slot is uploading; anyBusy: either is, which also holds the
  // token maker, since its token would land in the middle of an upload.
  function picSlot(k, label, id, round, busy, hint, anyBusy) {
    var S = SB();
    var prev = busy ? '<span class="sbe-pic-none">Uploading…</span>'
      : id ? '<img src="' + esc(S.mediaSrc(id)) + '" alt="' + esc(label) + '">'
      : (round ? S.GENERIC_TOKEN : '<span class="sbe-pic-none">No art</span>');
    return '<div class="sbe-pic-slot"><span class="sbe-lbl">' + esc(label) + '</span>' +
      '<span class="sbe-pic-prev' + (round ? ' is-round' : '') + (round && !id && !busy ? ' is-generic' : '') + '">' + prev + '</span>' +
      '<span class="sbe-pic-acts"><label class="btn-secondary btn-sm sbe-pic-up">' + (id ? 'Change…' : 'Upload…') +
      '<input type="file" class="sbe-sr" accept="' + PIC_TYPES.join(',') + '" data-sbe-pic="' + k + '" aria-label="' + esc(id ? 'Change the ' + label.toLowerCase() : 'Upload ' + label.toLowerCase()) + '"' + (busy ? ' disabled' : '') + '></label>' +
      (k === 'token' && canMakeToken() ? '<button type="button" class="btn-secondary btn-sm" id="sbe-pic-make" data-sbe-act="pic-make"' + (anyBusy ? ' disabled' : '') + '>Make token…</button>' : '') +
      (id ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="pic-clear" data-sbe-pic-k="' + k + '"' + (busy ? ' disabled' : '') + '>Remove</button>' : '') + '</span>' +
      '<span class="sbe-hint">' + hint + '</span></div>';
  }

  // picsHtml is the Pictures box: art and token side by side, each saying
  // what stands in when it is empty.
  function picsHtml(p) {
    var tokHint = p.token ? 'Used for the Foundry token and the map.'
      : p.art ? 'Empty: Foundry’s token uses <b>the art</b>, cropped to a circle.'
      : 'Empty: Foundry’s token uses <b>the generic monster token</b>.';
    return '<h4 class="sbe-h">Pictures <span class="sbe-hint">Both optional</span></h4><div class="sbe-pics">' +
      picSlot('art', 'Art', p.art, false, p.busy === 'art', 'The page’s own picture, at the top of the page and the stat block.') +
      picSlot('token', 'Token', p.token, true, p.busy === 'token', tokHint, !!p.busy) + '</div>' +
      (p.msg ? '<p class="sbe-msg' + (p.msgKind ? ' is-' + p.msgKind : '') + '" role="status">' + esc(p.msg) + '</p>' : '');
  }

  // keepOtherFields lays the editor's fields over the page's current ones, so a
  // key the editor never writes survives the save.
  function keepOtherFields(current, fields) {
    var out = {}, k;
    for (k in current) if (Object.prototype.hasOwnProperty.call(current, k)) out[k] = current[k];
    for (k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) out[k] = fields[k];
    return out;
  }

  // save writes the stat block to the entity, or creates the creature when this
  // editor has none. Only a fixed message is ever shown for a server failure.
  function save(st, ctx) {
    var out = toSave(st);
    if (!out.name) return Promise.reject(new Error('Give the creature a name first.'));
    var base = '/api/v1/campaigns/' + encodeURIComponent(ctx.campaignId);
    var body = { name: out.name, fields_data: out.fields };
    var req;
    if (ctx.entityId) {
      // A save replaces the page's fields, so fields the editor doesn't own
      // (Stamina and conditions sent back from Foundry) are read fresh and kept.
      var url = base + '/entities/' + encodeURIComponent(ctx.entityId);
      req = apiCall(url).then(function (res) {
        if (!res.ok) { var e = new Error('Could not save this stat block. Try again.'); e.status = res.status; throw e; }
        return res.json();
      }).then(function (current) {
        body.fields_data = keepOtherFields((current && current.fields_data) || {}, out.fields);
        return apiCall(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      });
    } else {
      req = SB().creatureType(ctx.campaignId).then(function (type) {
        if (!type) throw new Error('This campaign has no Creature type. Enable the Draw Steel package, then try again.');
        body.entity_type_id = type.id;
        return apiCall(base + '/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      });
    }
    return req.then(function (res) {
      if (!res.ok) { var e = new Error('Could not save this stat block. Try again.'); e.status = res.status; throw e; }
      return res.json().catch(function () { return null; });
    }).then(function (entity) {
      var saved = entity && entity.id ? entity : { id: ctx.entityId, name: out.name, fields_data: body.fields_data };
      if (!saved.fields_data) saved.fields_data = body.fields_data;
      return saved;
    });
  }

  // roundTrip is what the editor would save for fields it opened and nobody
  // changed, so a form compares like with like: the editor tidies lists and
  // fills formula figures, and that tidying is not the director's change.
  function roundTrip(name, fields, refs) {
    return toSave(newState(name, fields || {}, refs)).fields;
  }

  // ── Motion ────────────────────────────────────────────────────────────────

  // motion is how much may move: 'off' (Off, a device asking for reduced
  // motion, or no Web Animations), 'calm' (fades only) or 'full'.
  function motion(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.documentElement) return 'off';
    var html = d.documentElement, w = d.defaultView;
    if (html.getAttribute('data-motion') === 'off' || !html.animate) return 'off';
    if (w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
    if (html.getAttribute('data-motion') === 'calm' || html.hasAttribute('data-cz-reduce')) return 'calm';
    try { if (typeof Chronicle !== 'undefined' && Chronicle.reducedMotion && Chronicle.reducedMotion()) return 'calm'; } catch (e) { /* optional */ }
    return 'full';
  }

  // Script-driven moves read Chronicle's motion tokens, so the owner's Motion
  // speed retimes them with the rest of the site.
  function token(doc, name, fallback) {
    try {
      var v = doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) { return fallback; }
  }
  function tokenMs(doc, name, fallback) {
    var raw = token(doc, name, ''), ms = /ms$/.test(raw) ? parseFloat(raw) : parseFloat(raw) * 1000;
    return isFinite(ms) && ms > 0 ? ms : fallback;
  }

  // The standard's Glow: an accent ring that fades over about 1.2 seconds.
  var GLOW_MS = 1200;

  function figureValues(st) {
    var out = {};
    FIGURES.forEach(function (k) { out[k] = k === 'free_strike' ? String(st.c.free_strike || '') : st.c[k]; });
    return out;
  }

  // clock is the time a move is measured from, so a redraw part way through
  // one can carry it on from where it was instead of starting it again.
  function clock(doc) {
    var w = doc.defaultView, p = w && w.performance;
    return p && p.now ? p.now() : Date.now();
  }

  // flashChanged rings the figure boxes whose value just changed, so a level
  // or organization change shows what it moved. The ring only fades, so Calm
  // keeps it. `rings` remembers when each began: a redraw makes new boxes, and
  // a ring still fading is picked up on its new box at the same point.
  function flashChanged(doc, edEl, before, now, rings) {
    if (motion(doc) === 'off') return;
    var t = clock(doc);
    FIGURES.forEach(function (k) {
      if (before[k] !== now[k]) rings[k] = t;
      var age = rings[k] === undefined ? GLOW_MS : t - rings[k];
      if (age >= GLOW_MS) return;
      var input = edEl.querySelector('#sbe-fig-' + k);
      var f = input && input.closest ? input.closest('.sbe-f') : null, box = input ? input.parentNode : null;
      if (!f || !box || !box.animate) return;
      f.classList.add('is-flash');
      var done = function () { f.classList.remove('is-flash'); };
      try {
        var a = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: GLOW_MS, easing: token(doc, '--ease-out', 'cubic-bezier(.16,1,.3,1)'), pseudoElement: '::after' });
        a.currentTime = age;
        a.onfinish = done; a.oncancel = done;
      } catch (e) { done(); }
    });
  }

  // mount opens the editor in `host`. opts: { campaignId, entityId, entity,
  // refs, ref, onClose(savedEntity|null) }. Returns { state, isDirty, discard,
  // destroy }. A creature's other form opens with opts.form ({ heading,
  // nameLabel, dirtyKey }) and opts.saveAs(out, pictures), which saves it in
  // place of the page.
  function mount(host, opts) {
    var o = opts || {};
    var doc = host.ownerDocument || document;
    injectStyles(doc);
    SB().injectStyles(doc);
    var entity = o.entity || null;
    var st = newState(entity ? entity.name : '', entity ? (entity.fields_data || entity.custom_fields) : null, o.refs, o.book);
    var ui = { ref: o.ref || null, onClose: o.onClose || null, isNew: !o.entityId, party: null, partyLoading: true, msg: '', msgKind: '', saving: false,
      gen: { open: false, what: '', kind: 'party', role: '', level: Math.min(10, st.c.level || 1), seed: 0, why: null, loading: false },
      ai: { open: false, vocab: null, vocabP: null, timer: null, stream: null, lib: null, book: newBookFilter() },
      from: { open: false, ctl: null }, blank: { open: false },
      pics: newPics(entity), heading: o.form ? o.form.heading : '', nameLabel: o.form ? o.form.nameLabel : '', saveAs: o.saveAs || null };
    var ctx = { campaignId: String(o.campaignId || ''), entityId: o.entityId ? String(o.entityId) : '' };
    var dirtyKey = (o.form && o.form.dirtyKey) || 'monster-builder:' + (ctx.entityId || 'new');
    var root = doc.createElement('div');
    root.className = 'sbe-wrap' + (motion(doc) === 'off' ? '' : ' sbe-entering');
    root.innerHTML = '<div class="sbe card"></div><aside class="sbe-side" aria-label="Party, budget and checks"></aside>';
    host.innerHTML = '';
    host.appendChild(root);
    var edEl = root.firstChild, sideEl = root.lastChild;
    // Only the bar, the Generate panel and the form are redrawn; the tab row
    // and the other panels stay, so their focus and typed text survive.
    edEl.innerHTML = '<div class="sbe-part"></div>' + waysHtml(ui) +
      '<div class="sbe-hang">' + panelHtml('gen', ui, '') + panelHtml('ai', ui, aiHtml()) + panelHtml('from', ui, '') + panelHtml('blank', ui, blankHtml()) + '</div>' +
      '<p class="sbe-sr" role="status" aria-live="polite"></p><div class="sbe-part sbe-form"></div>';
    var headEl = edEl.firstChild, waysEl = edEl.childNodes[1], hangEl = edEl.childNodes[2], bodyEl = edEl.lastChild;
    function panEl(name) { return hangEl.querySelector('#sbe-' + name); }
    var genEl = panEl('gen'), aiEl = panEl('ai'), fromEl = panEl('from');
    function aiBox(id) { return aiEl.querySelector('#sbe-ai-' + id); }
    if (motion(doc) !== 'off') setTimeout(function () { root.classList.remove('sbe-entering'); }, 700);

    function dirty() { try { if (typeof Chronicle !== 'undefined' && Chronicle.markDirty) Chronicle.markDirty(dirtyKey); } catch (e) { /* optional */ } ui.dirty = true; }
    function clean() { try { if (typeof Chronicle !== 'undefined' && Chronicle.markClean) Chronicle.markClean(dirtyKey); } catch (e) { /* optional */ } ui.dirty = false; }

    // Check rows that were not there at the last draw arrive one after
    // another; rows that stay are left alone, so typing never replays them.
    // A redraw while they are still arriving carries each on from where it was.
    var seenChecks = null, rings = {}, chipAt = {};
    function drawSide() {
      sideEl.innerHTML = sideHtml(st, ui);
      var now = {}, n = 0, was = seenChecks, full = motion(doc) === 'full', t = clock(doc), dur = tokenMs(doc, '--dur-standard', 200);
      [].forEach.call(sideEl.querySelectorAll('.sbe-checks li'), function (li) {
        var k = li.className + '|' + li.textContent;
        var born = !was ? null : was[k] || { t: t, wait: Math.min(n++, 4) * 30 };
        now[k] = born || { t: 0, wait: 0 };
        if (!born || !full || t - born.t >= born.wait + dur) return;
        li.style.animationDelay = (born.wait - (t - born.t)) + 'ms';
        li.classList.add('is-new');
      });
      seenChecks = now;
    }

    // A provenance chip whose words changed fades in, so the eye finds it.
    function chipMarks() {
      var out = {};
      [].forEach.call(bodyEl.querySelectorAll('[data-sbe-chip]'), function (c) { out[c.getAttribute('data-sbe-chip')] = c.className + '|' + c.textContent; });
      return out;
    }
    function fadeChips(was) {
      if (motion(doc) === 'off') return;
      var t = clock(doc), dur = tokenMs(doc, '--dur-standard', 200);
      [].forEach.call(bodyEl.querySelectorAll('[data-sbe-chip]'), function (c) {
        var k = c.getAttribute('data-sbe-chip'), old = was[k];
        if (old !== undefined && old !== c.className + '|' + c.textContent) chipAt[k] = t;
        var age = chipAt[k] === undefined ? dur : t - chipAt[k];
        if (age >= dur) return;
        c.style.animationDelay = -age + 'ms';
        c.classList.add('is-new');
        c.addEventListener('animationend', function () { c.classList.remove('is-new'); c.style.animationDelay = ''; });
      });
    }

    // A redraw that changes the open panel's height slides the form to its
    // new place instead of jumping it.
    function draw(focusId) {
      if (openWay(ui) && !closed) moveForm(function () { drawNow(focusId); });
      else drawNow(focusId);
    }
    // The form's message and the "Generated…" or "Started from…" line are
    // redrawn with the form, and a screen reader only speaks a region that
    // was already there, so one lasting region repeats them when they change.
    var sayEl = edEl.querySelector('.sbe-sr[role="status"]'), said = '';
    function say() {
      var text = [ui.msg || '', st.origin || ''].join(' ').trim();
      if (text !== said) { said = text; sayEl.textContent = text; }
    }
    function drawNow(focusId) {
      pending = false;
      // The AI and From a creature panels are never redrawn, so focus inside them stays where it is.
      var active = doc.activeElement, id = focusId || (active && edEl.contains(active) && !aiEl.contains(active) && !fromEl.contains(active) ? active.id : null), pos = null;
      try { if (active && active.selectionStart !== undefined) pos = active.selectionStart; } catch (e) { pos = null; }
      var figs = figureValues(st), before = ui.figs, chips = chipMarks();
      ui.figs = figs;
      headEl.innerHTML = barHtml(st, ui);
      genEl.innerHTML = genHtml(st, ui);
      bodyEl.innerHTML = editorBody(st, ui);
      drawSide();
      say();
      if (before) { flashChanged(doc, edEl, before, figs, rings); fadeChips(chips); }
      var back = id ? doc.getElementById(id) : null;
      if (back) { back.focus(); try { if (pos !== null && back.setSelectionRange) back.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ } }
    }

    // settle brings freshly generated parts in one after another. Pressed
    // again before they have landed, the new parts carry on from the same
    // point instead of starting over.
    var settleAt = -1e9;
    function settle(els) {
      if (motion(doc) !== 'full') return;
      var n = 0, t = clock(doc), age = t - settleAt;
      if (age >= tokenMs(doc, '--dur-large', 280) + 150) { settleAt = t; age = 0; }
      [].forEach.call(els, function (el) {
        if (el.offsetParent === null) return;
        el.style.animationDelay = (Math.min(n++, 5) * 30 - age) + 'ms';
        el.classList.add('is-settle');
        el.addEventListener('animationend', function done(e) {
          if (e.target !== el) return;
          el.classList.remove('is-settle');
          el.style.animationDelay = '';
          el.removeEventListener('animationend', done);
        });
      });
    }

    // A box commits on change, which fires as the pointer goes down on a
    // button elsewhere; redrawing then would replace that button before its
    // click lands, so Save or Add right after typing would do nothing. While
    // the pointer is down the redraw waits for it to come up.
    var held = false, pending = false;
    function redraw(id) { if (held) pending = true; else draw(id); }
    function onPointerDown() { held = true; }
    function onPointerUp() {
      if (!held) return;
      held = false;
      setTimeout(function () { if (pending && !closed) { pending = false; draw(); } }, 0);
    }

    function onInput(e) {
      var t = e.target;
      if (t.hasAttribute('data-sbe-g')) { if (t.getAttribute('data-sbe-g') === 'what') ui.gen.what = t.value; return; }
      if (t.hasAttribute('data-sbe-bkq')) {
        clearTimeout(ui.ai.bkTimer);
        ui.ai.bkTimer = setTimeout(function () { ui.ai.book.q = t.value.trim(); ui.ai.book.off = {}; paintBook(); }, 150);
        return;
      }
      if (t.hasAttribute('data-sbe-ai')) {
        if (t.getAttribute('data-sbe-ai') === 'desc') { clearTimeout(ui.ai.bkTimer); ui.ai.bkTimer = setTimeout(function () { paintBook(false); }, 150); aiBox('guide').value = guide(); }
        else { stopStream(); clearTimeout(ui.ai.timer); ui.ai.timer = setTimeout(readAI, 150); }
        return;
      }
      if (t.hasAttribute('data-sbe-k')) {
        applyField(st, t.getAttribute('data-sbe-k'), t.value);
        dirty();
        if (t.getAttribute('data-sbe-k') === 'name') drawSide();
        return;
      }
      if (t.hasAttribute('data-sbe-ab') && t.type !== 'checkbox') {
        var abNote = applyAbility(st, t.getAttribute('data-sbe-ab'), t.value);
        if (abNote) {
          var auto = edEl.querySelector('#sbe-ab-auto'), msgEl = edEl.querySelector('.sbe-msg');
          if (auto && /^Damage/.test(abNote)) auto.checked = false;
          ui.msg = abNote; ui.msgKind = '';
          if (msgEl) msgEl.textContent = abNote;
        }
        dirty();
      }
    }
    function onChange(e) {
      var t = e.target;
      if (t.hasAttribute('data-sbe-pic')) { uploadPic(t.getAttribute('data-sbe-pic'), t.files && t.files[0]); return; }
      if (t.hasAttribute('data-sbe-bko')) {
        var slug = t.getAttribute('data-sbe-bko');
        if (t.checked) delete ui.ai.book.off[slug]; else ui.ai.book.off[slug] = true;
        paintBook(false);
        return;
      }
      if (t.hasAttribute('data-sbe-bkg')) { ui.ai.book.group = t.value; ui.ai.book.off = {}; paintBook(); return; }
      if (t.hasAttribute('data-sbe-ai')) return;
      if (t.hasAttribute('data-sbe-g')) {
        var gk = t.getAttribute('data-sbe-g');
        ui.gen[gk] = gk === 'level' ? Number(t.value) || 1 : t.value;
        if (gk === 'kind') redraw(t.id);
        return;
      }
      if (t.hasAttribute('data-sbe-k')) {
        applyField(st, t.getAttribute('data-sbe-k'), t.value);
        derive(st); dirty(); redraw(t.id);
        // "This creature" in the shortlist follows the organization and role.
        if (ui.ai.open) paintBook();
        return;
      }
      if (t.hasAttribute('data-sbe-fig')) { setFigure(st, t.getAttribute('data-sbe-fig'), t.value); dirty(); redraw(t.id); return; }
      if (t.hasAttribute('data-sbe-ab')) {
        applyAbility(st, t.getAttribute('data-sbe-ab'), t.type === 'checkbox' ? t.checked : t.value);
        if (t.type === 'checkbox' || t.getAttribute('data-sbe-ab') === 'keywords') { derive(st); redraw(t.id); }
        dirty();
      }
    }
    function onClick(e) {
      var el = e.target.closest ? e.target.closest('button') : null;
      if (!el || !root.contains(el)) return;
      var bk = el.getAttribute('data-sbe-bkf');
      if (bk) {
        var bv = el.getAttribute('data-sbe-bkv'), f = ui.ai.book;
        f[bk] = bk === 'fit' ? bv : (f[bk] === bv ? '' : bv);
        f.off = {};
        paintBook();
        var again = aiEl.querySelector('[data-sbe-bkf="' + bk + '"][data-sbe-bkv="' + bv.replace(/"/g, '\\"') + '"]');
        if (again) again.focus();
        return;
      }
      if (el.hasAttribute('data-sbe-bkl')) { ui.ai.book.lim = Number(el.getAttribute('data-sbe-bkl')) || 50; paintBook(false); return; }
      if (el.hasAttribute('data-sbe-bkx')) {
        var lim = ui.ai.book.lim;
        ui.ai.book = newBookFilter(); ui.ai.book.lim = lim; aiBox('bkq').value = '';
        paintBook();
        return;
      }
      var reset = el.getAttribute('data-sbe-reset');
      if (reset) { useFormula(st, reset); dirty(); draw(); return; }
      var ed = el.getAttribute('data-sbe-edit');
      if (ed) { st.editAb = ed; draw('sbe-ab-name'); return; }
      if (el.hasAttribute('data-sbe-done')) { st.editAb = null; derive(st); draw(); return; }
      var mv = el.getAttribute('data-sbe-mv');
      if (mv) {
        var m = /^([avt])(\d+):(-?1)$/.exec(mv);
        if (m && moveItem(st, m[1], Number(m[2]), Number(m[2]) + Number(m[3]))) {
          derive(st); dirty(); draw();
          // Keep the keyboard on the item that moved.
          var to = edEl.querySelector('[data-sbe-mv="' + m[1] + (Number(m[2]) + Number(m[3])) + ':' + m[3] + '"]:not([disabled])') ||
            edEl.querySelector('[data-sbe-item="' + m[1] + (Number(m[2]) + Number(m[3])) + '"] [data-sbe-edit]');
          if (to) to.focus();
        }
        return;
      }
      var del = el.getAttribute('data-sbe-del');
      if (del) { removeItem(st, del.charAt(0), Number(del.slice(1))); dirty(); draw(); return; }
      var act = el.getAttribute('data-sbe-act');
      if (act === 'add-ab') { st.c.abilities.push(newAbility(st)); st.editAb = 'a' + (st.c.abilities.length - 1); derive(st); dirty(); draw('sbe-ab-name'); }
      else if (act === 'add-trait') { st.c.traits.push({ name: '', description: '' }); st.editAb = 't' + (st.c.traits.length - 1); dirty(); draw('sbe-ab-name'); }
      else if (act === 'add-va') {
        addVillain(st);
        dirty(); draw('sbe-ab-name');
      }
      else if (act === 'save') doSave();
      else if (act === 'pic-make') makeToken(el);
      else if (act === 'pic-clear') {
        var pk = el.getAttribute('data-sbe-pic-k');
        if (pk === 'art' || pk === 'token') { ui.pics[pk] = ''; ui.pics.msg = 'Save to remove the ' + (pk === 'art' ? 'art' : 'token') + '.'; ui.pics.msgKind = ''; dirty(); draw(); }
      }
      else if (act === 'cancel') askDiscard();
      else if (act && wayOf(act, 3)) toggleFold(wayOf(act, 3)[0], e.detail === 0);
      else if (act === 'ai-copy') copyGuide();
      else if (act === 'ai-example') example();
      else if (act === 'drawer') {
        // Close any open edit form first, so the drawer's adds land in a clean list.
        st.editAb = null; draw('sbe-add-abs');
        ui.drawer = openAbilityDrawer(doc, { st: st, loadLib: loadLib, changed: function () { dirty(); draw(); }, returnTo: 'sbe-add-abs' });
      }
      else if (act === 'gen-go') { ui.gen.seed = 0; runGenerate(); }
      else if (act === 'gen-again') { ui.gen.seed++; runGenerate(); }
      else if (act === 'blank') {
        // The Blank panel already said what this clears, so it asks nothing more.
        var keep = st.base;
        var fresh = newState('', null, st.refs);
        Object.keys(fresh).forEach(function (k) { st[k] = fresh[k]; });
        st.base = keep; ui.gen.why = null; ui.msg = ''; stopStream(); dirty();
        setFold('', e.detail === 0); draw('sbe-name');
      }
      else if (act === 'suggest') suggestForParty();
    }

    // Cancel with unsaved work asks on the fold-out sheet when there is one,
    // the same question Escape asks there.
    function askDiscard() {
      function go() { clean(); close(null); }
      if (!ui.dirty) { go(); return; }
      var sheet = root.closest ? root.closest('.sbx-fold-p') : null;
      var C = (typeof Chronicle !== 'undefined') ? Chronicle : null;
      if (sheet && C && C.askSlip) {
        C.askSlip(sheet, { ask: 'Discard your changes to this stat block?', detail: '', discard: 'Discard changes', onDiscard: go });
        return;
      }
      if (typeof confirm === 'function' && !confirm('Discard your changes to this stat block?')) return;
      go();
    }

    // ── The ways to start ──

    // One panel hangs under its tab at a time. The form is an opaque sheet
    // below the panel's place: opening slides the form down off the panel and
    // closing slides it back over, so the panel itself never moves.
    var formAnim = null, lateHide = null;
    function formTop() { return bodyEl.getBoundingClientRect().top; }
    function showPanel(name) {
      WAYS.forEach(function (w) {
        var el = panEl(w[0]), on = w[0] === name;
        if (on) { el.removeAttribute('hidden'); el.removeAttribute('inert'); }
        else { el.setAttribute('hidden', ''); el.setAttribute('inert', ''); }
      });
      hangEl.classList.toggle('is-open', !!name);
    }
    // tail lengthens the form's sheet for a move that lifts it `up` pixels
    // above its resting place, by as much of the panel as the form is too
    // short to cover. 0 takes it away.
    function tail(up) {
      var need = up ? Math.ceil(up - bodyEl.offsetHeight) : 0;
      if (need > 0) bodyEl.style.setProperty('--sbe-tail', need + 'px'); else bodyEl.style.removeProperty('--sbe-tail');
      edEl.classList.toggle('is-moving', need > 0);
    }
    // dropAnim ends a move where it stands; a close still waiting to hide its
    // panel hides it now.
    function dropAnim() {
      if (formAnim) { formAnim.onfinish = null; formAnim.cancel(); formAnim = null; }
      tail(0);
      if (lateHide) { var hide = lateHide; lateHide = null; hide(); }
    }
    // moveForm runs `change` and slides the form from where it was to where
    // the change put it. The top is measured live, so a move that interrupts
    // another carries on from the form's place on screen.
    function moveForm(change, jump) {
      var first = formTop();
      dropAnim();
      change();
      if (jump || closed || motion(doc) !== 'full') return;
      var by = first - formTop();
      if (Math.abs(by) < 1) return;
      tail(-by);
      formAnim = bodyEl.animate([{ transform: 'translateY(' + by + 'px)' }, { transform: 'none' }],
        { duration: tokenMs(doc, '--dur-standard', 200), easing: token(doc, '--ease-out', 'cubic-bezier(.16,1,.3,1)') });
      formAnim.onfinish = function () { formAnim = null; tail(0); };
    }
    // closeForm slides the form over the open panel, then hides the panel.
    function closeForm(name) {
      var first = formTop();
      dropAnim();
      var rest = formTop();
      showPanel('');
      var end = formTop();
      showPanel(name);
      panEl(name).setAttribute('inert', '');
      lateHide = function () { showPanel(openWay(ui)); };
      tail(rest - end);
      formAnim = bodyEl.animate([{ transform: 'translateY(' + (first - rest) + 'px)' }, { transform: 'translateY(' + (end - rest) + 'px)' }],
        { duration: tokenMs(doc, '--dur-micro', 120) + 40, easing: token(doc, '--ease-in', 'cubic-bezier(.4,0,1,1)'), fill: 'forwards' });
      formAnim.onfinish = dropAnim;
    }

    // placeInd puts the mark (a hairline under the open tab and up its left
    // side) on the selected tab, by transform only. With no tab open it fades out.
    function placeInd(animate) {
      var ind = waysEl.querySelector('.sbe-ind'), tab = waysEl.querySelector('.sbe-way[aria-selected="true"]');
      if (!ind) return;
      var wasOn = ind.classList.contains('is-on');
      ind.classList.toggle('is-still', !animate);
      if (tab) {
        // Arriving from no tab, the mark is placed first and then fades in.
        ind.classList.toggle('is-jump', !animate || !wasOn);
        var x = tab.offsetLeft, y = tab.offsetTop, w = tab.offsetWidth, h = tab.offsetHeight;
        waysEl.style.setProperty('--sbe-way-h', h + 'px');
        ind.firstChild.style.transform = 'translate(' + x + 'px,' + (y + 9) + 'px)';
        ind.lastChild.style.transform = 'translate(' + x + 'px,' + (y + h) + 'px) scaleX(' + Math.max(1, w - 4) + ')';
        void ind.offsetWidth;
      }
      ind.classList.toggle('is-on', !!tab);
      if (!animate) void ind.offsetWidth;
      ind.classList.remove('is-still', 'is-jump');
      waysEl.classList.add('has-ind');
    }

    // setFold opens the named panel, or closes them all with ''. `instant`
    // is a change made from the keyboard, which never animates.
    function setFold(name, instant) {
      var was = openWay(ui), lvl = instant ? 'off' : motion(doc);
      if (was === name) return;
      WAYS.forEach(function (w) { ui[w[0]].open = w[0] === name; });
      [].forEach.call(waysEl.querySelectorAll('.sbe-way'), function (b, i) {
        var on = b.getAttribute('aria-controls') === 'sbe-' + name;
        b.setAttribute('aria-selected', String(on));
        b.setAttribute('tabindex', on || (!name && !i) ? '0' : '-1');
      });
      placeInd(lvl !== 'off');
      if (!name && lvl === 'full') { closeForm(was); return; }
      moveForm(function () { showPanel(name); }, lvl !== 'full');
      // A panel taking another's place fades in; under Calm so does one opening.
      var el = name ? panEl(name) : null;
      if (el && el.animate && (lvl === 'calm' || (lvl === 'full' && was))) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs(doc, '--dur-page', 90), easing: token(doc, '--ease-out', 'cubic-bezier(.16,1,.3,1)') });
      }
    }
    // inView is whether the whole of `el` is on screen.
    function inView(el) {
      var r = el.getBoundingClientRect(), w = doc.defaultView;
      return r.top >= 0 && r.bottom <= (w.innerHeight || doc.documentElement.clientHeight);
    }
    // backTo returns focus to a tab. A tab scrolled out of view (Close at the
    // foot of a long panel) is brought back, so focus is never off screen.
    function backTo(tab) {
      if (!tab) return;
      if (!inView(tab)) { tab.focus(); return; }
      try { tab.focus({ preventScroll: true }); } catch (e) { tab.focus(); }
    }
    function toggleFold(name, instant) {
      var on = openWay(ui) !== name, tab = doc.getElementById(wayOf(name, 0)[2]);
      // With its tab out of view there is nothing for the form to slide back to, so the panel closes at once.
      setFold(on ? name : '', instant || (!on && tab && !inView(tab)));
      if (on && name === 'ai') { aiBox('guide').value = guide(); loadVocab(); loadBook(); }
      if (on && name === 'from') {
        if (!ui.from.ctl) {
          ui.from.ctl = openStartFrom(doc, ctx, function (srcName, src, origin) {
            startFrom(st, srcName, src, origin); dirty(); setFold('', false); draw('sbe-level');
          }, { el: fromEl, move: moveForm });
        } else ui.from.ctl.refresh();
      }
      if (!on) { backTo(tab); return; }
      var to = name === 'gen' ? doc.getElementById('sbe-g-what') : name === 'ai' ? aiBox('desc')
        : name === 'from' ? fromEl.querySelector('#sbe-sf-q') : doc.getElementById('sbe-blank-go');
      if (to) { try { to.focus({ preventScroll: true }); } catch (e) { to.focus(); } }
    }

    // The tab row's keys: arrows, Home and End move focus only, because
    // opening a tab loads data and Blank clears. Escape in the row or in the
    // open panel closes the panel and stops there, so the question about
    // leaving is only asked by the next Escape.
    function onKeyDown(e) {
      var t = e.target, k = e.key;
      if (t && t.classList && t.classList.contains('sbe-way') && /^(ArrowLeft|ArrowRight|Home|End)$/.test(k)) {
        var tabs = [].slice.call(waysEl.querySelectorAll('.sbe-way')), i = tabs.indexOf(t);
        var to = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : (i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        e.preventDefault();
        tabs[to].focus();
        return;
      }
      var open = openWay(ui);
      if (k !== 'Escape' || e.defaultPrevented || !open || (t && t.tagName === 'SELECT')) return;
      if (!waysEl.contains(t) && !hangEl.contains(t)) return;
      e.preventDefault(); e.stopPropagation();
      setFold('', true);
      backTo(doc.getElementById(wayOf(open, 0)[2]));
    }

    // ── Build with an AI ──
    function guide() { return guideFor(aiBox('desc').value, partyLine(ui.party), ui.ai.vocab || vocabulary(st.refs, {}), bookKept()); }

    // The shortlist as the guide carries it: the best `lim` of what the
    // filters leave, minus any the director unticked.
    function bookRows() { return ui.ai.lib ? shortlist(st, ui.ai.lib, ui.ai.book, aiBox('desc').value).slice(0, ui.ai.book.lim) : []; }
    function bookKept() { var off = ui.ai.book.off; return bookRows().filter(function (r) { return !off[r.t.slug]; }).map(function (r) { return r.t; }); }

    // paintBook redraws the shortlist and the guide. The filters' own row is
    // redrawn only when `filters` is set, so typing in the search keeps focus.
    function paintBook(filters) {
      if (closed || !ui.ai.lib) return;
      var f = ui.ai.book, all = shortlist(st, ui.ai.lib, f, aiBox('desc').value), rows = all.slice(0, f.lim);
      var kept = rows.filter(function (r) { return !f.off[r.t.slug]; }).length;
      if (filters !== false) aiBox('bkf').innerHTML = bookFiltersHtml(st, ui.ai.lib, f);
      aiBox('bkn').textContent = bookCountText(all.length, f, kept, rows.length);
      aiBox('bkl').innerHTML = bookListHtml(rows, f);
      aiEl.querySelectorAll('[data-sbe-bkl]').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-sbe-bkl')) === f.lim)); });
      aiBox('guide').value = guide();
    }
    function loadBook() {
      loadLib().then(function (lib) {
        if (closed) return;
        ui.ai.lib = lib;
        if (!lib.length) { aiBox('bkn').textContent = 'The ability library could not be read, so the AI writes every ability itself.'; return; }
        // The list arriving makes the panel taller; later repaints, from typing and chips, do not animate.
        if (ui.ai.shown) paintBook(); else { ui.ai.shown = true; moveForm(function () { paintBook(); }); }
      });
    }

    // loadVocab reads the option lists the guide offers from the package's
    // own files, once. Lists that fail to load are left out of the guide.
    function loadVocab() {
      if (ui.ai.vocabP) return ui.ai.vocabP;
      var base = '/campaigns/' + encodeURIComponent(ctx.campaignId) + '/systems/drawsteel/data/';
      function one(f) { return SB().getJSON(base + f).then(function (d) { return Array.isArray(d) ? d : SB().unwrap(d); }, function () { return []; }); }
      ui.ai.vocabP = (ctx.campaignId ? Promise.all([one('creature-keywords.json'), one('ability-keywords.json'), one('rules-glossary.json')]) : Promise.resolve([[], [], []]))
        .then(function (r) {
          if (closed) return;
          ui.ai.vocab = vocabulary(st.refs, { creatureKeywords: r[0], abilityKeywords: r[1], glossary: r[2] });
          aiBox('guide').value = guide();
          var b = aiBox('copy');
          b.disabled = false; b.textContent = 'Copy the guide';
          if (!r[0].length || !r[1].length || !r[2].length) aiBox('copied').textContent = 'Some of the package’s keyword and condition lists could not be read, so the guide leaves them out.';
        });
      return ui.ai.vocabP;
    }

    // Copying needs the page's permission; without it the guide is selected
    // for the director to copy by hand.
    function copyGuide() {
      var g = guide(), msg = aiBox('copied'), box = aiBox('guide');
      box.value = g;
      function manual() {
        if (closed) return;
        box.parentNode.open = true; box.focus(); box.select();
        msg.textContent = 'Selected. Press Ctrl+C (⌘C on a Mac) to copy it.';
      }
      var nav = doc.defaultView && doc.defaultView.navigator;
      try {
        if (!nav || !nav.clipboard) { manual(); return; }
        nav.clipboard.writeText(g).then(function () { if (!closed) msg.textContent = 'Copied. Paste it into ChatGPT, Claude or any AI chat, then paste its answer below.'; }, manual);
      } catch (e) { manual(); }
    }

    // readAI fills the editor from the pasted answer, as far as it has
    // arrived. Nothing is saved until the director presses Save.
    function readAI() {
      if (closed) return;
      var text = aiBox('ans').value, stEl = aiBox('status'), notesEl = aiBox('notes');
      if (!text.trim()) { stEl.textContent = ''; stEl.className = 'sbe-small'; notesEl.innerHTML = ''; return; }
      var r = readAnswer(text);
      clearTimeout(ui.ai.settle);
      // An answer that stops changing yet never closes is cut off, not still arriving.
      if (r.wait || (r.obj && !r.done)) ui.ai.settle = setTimeout(function () { if (!closed && aiBox('ans').value === text) { stEl.className = 'sbe-small sbe-ai-err'; stEl.textContent = CUT_OFF + (r.obj ? ' What was read so far is filled in.' : ''); } }, 1500);
      if (r.err) { stEl.textContent = r.err; stEl.className = 'sbe-small' + (r.wait ? '' : ' sbe-ai-err'); return; }
      var notes;
      try { notes = fromAI(st, r.obj, ui.ai.vocab || vocabulary(st.refs, {}), ui.ai.lib || []); }
      catch (e) { stEl.className = 'sbe-small sbe-ai-err'; stEl.textContent = 'The editor could not use that answer. Ask the AI to send it again as plain JSON.'; return; }
      ui.gen.why = null; ui.msg = '';
      dirty(); draw();
      stEl.className = 'sbe-small' + (r.done ? ' sbe-ai-ok' : '');
      stEl.textContent = r.done ? 'Read in: ' + (st.name || 'a creature') + ', level ' + st.c.level + ' ' + st.c.organization + '. Check it, change anything, then Save.' : 'Reading the answer…';
      moveForm(function () { notesEl.innerHTML = aiNotesHtml(notes); });
    }

    function stopStream() { if (ui.ai.stream) { clearInterval(ui.ai.stream); ui.ai.stream = null; } }

    // The example arrives a little at a time, the way a pasted answer would
    // be read, unless motion is calm or off.
    function example() {
      stopStream();
      var box = aiBox('ans');
      if (motion(doc) !== 'full') { box.value = AI_EXAMPLE; readAI(); return; }
      var n = 0;
      box.value = '';
      ui.ai.stream = setInterval(function () {
        if (closed) { stopStream(); return; }
        n = Math.min(AI_EXAMPLE.length, n + 24);
        box.value = AI_EXAMPLE.slice(0, n); box.scrollTop = box.scrollHeight;
        readAI();
        if (n >= AI_EXAMPLE.length) stopStream();
      }, 45);
    }

    // runGenerate reads the ability library once, then fills the editor. A
    // library that fails to load still gives a creature, with no abilities,
    // and the reasons say so.
    function runGenerate() {
      var g = ui.gen;
      function go(lib, failed) {
        g.loading = false;
        var why = generate(st, { what: g.what, kind: g.kind, role: g.role, level: g.level, profile: ui.party && ui.party.profile }, lib, g.seed);
        if (failed) why.splice(why.length - 1, 0, 'The ability library could not be read, so add abilities yourself.');
        g.why = why;
        st.origin = 'Generated. Nothing is saved until you press Save' + (ui.isNew ? '; the first save makes the Creature page.' : '.');
        dirty(); draw(g.seed ? 'sbe-g-again' : 'sbe-g-go');
        settle(g.seed ? bodyEl.querySelectorAll('.sbe-abs') : bodyEl.children);
      }
      g.loading = true; draw();
      loadLib().then(function (lib) { if (!closed) go(lib, !lib.length); });
    }

    // loadLib reads the package's ability library once; [] when it can't.
    var libP = null;
    function loadLib() {
      if (!libP) {
        libP = !ctx.campaignId ? Promise.resolve([])
          : SB().getJSON('/campaigns/' + encodeURIComponent(ctx.campaignId) + '/systems/drawsteel/data/creature-abilities.json')
            .then(function (d) { return Array.isArray(d) ? d : SB().unwrap(d); }, function () { libP = null; return []; });
      }
      return libP;
    }

    // Drag a card onto another of its own kind to reorder the list. A drag
    // that starts inside a box is text selection, not a move.
    var dragging = null;
    function itemOf(t) { return t && t.closest ? t.closest('[data-sbe-item]') : null; }
    function onDragStart(e) {
      var it = itemOf(e.target);
      if (!it || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
      dragging = it.getAttribute('data-sbe-item');
      e.dataTransfer.setData('text/plain', 'sbe-mv:' + dragging);
      e.dataTransfer.effectAllowed = 'move';
      it.classList.add('is-dragging');
    }
    function onDragOver(e) {
      var it = itemOf(e.target);
      if (dragging && it && it.getAttribute('data-sbe-item').charAt(0) === dragging.charAt(0)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    }
    function onDrop(e) {
      var it = itemOf(e.target);
      if (!dragging || !it) return;
      var to = it.getAttribute('data-sbe-item');
      e.preventDefault();
      if (to.charAt(0) === dragging.charAt(0) && moveItem(st, to.charAt(0), Number(dragging.slice(1)), Number(to.slice(1)))) { derive(st); dirty(); draw(); }
      dragging = null;
    }
    function onDragEnd() {
      dragging = null;
      [].forEach.call(edEl.querySelectorAll('.is-dragging'), function (x) { x.classList.remove('is-dragging'); });
    }

    function suggestForParty() {
      var p = ui.party;
      if (!p || !p.profile) return;
      ui.suggestNote = applySuggestion(st, p.profile);
      dirty(); draw();
    }

    // makeToken opens Chronicle's token maker on the art, or on a picture the
    // director picks there. The token it saves becomes this editor's token,
    // kept like an upload until the director saves the stat block.
    function makeToken(from) {
      var p = ui.pics;
      if (!canMakeToken() || p.busy) return;
      Chronicle.tokenMaker.open({
        campaignId: ctx.campaignId, entityId: ctx.entityId, name: st.name || '',
        art: p.art ? SB().mediaSrc(p.art) : '', from: from,
        save: function (id) {
          var mid = SB().mediaId(id);
          if (!mid) throw new Error('The token came back without an id. Try again.');
          p.token = mid; p.msg = 'Save to keep the new token.'; p.msgKind = '';
          dirty(); draw();
        },
        // The redraw replaced the button that opened the maker.
        onClose: function () { var b = doc.getElementById('sbe-pic-make'); if (b) b.focus(); }
      });
    }

    function uploadPic(k, file) {
      var p = ui.pics, bad = picProblem(file);
      if (bad) { p.msg = bad; p.msgKind = 'error'; draw(); return; }
      p.busy = k; p.msg = ''; draw();
      var fd = new FormData();
      fd.append('file', file);
      fd.append('usage_type', 'entity_image');
      fd.append('campaign_id', ctx.campaignId);
      apiCall('/media/upload', { method: 'POST', body: fd }).then(function (res) {
        if (!res.ok) throw new Error('upload ' + res.status);
        return res.json();
      }).then(function (d) {
        var id = SB().mediaId(d && d.id);
        if (!id) throw new Error('upload returned no id');
        p[k] = id; p.busy = ''; p.msg = 'Save to keep the new ' + (k === 'art' ? 'art' : 'token') + '.'; p.msgKind = '';
        dirty(); draw();
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('Monster builder: picture upload failed', err);
        p.busy = ''; p.msg = 'Could not upload that picture. Try again.'; p.msgKind = 'error'; draw();
      });
    }

    // saveArt sets the page picture. Chronicle announces the stat block's save
    // to Foundry but not a picture change, so on an existing page the art goes
    // first and the save carries it; a new creature gets its art once it has
    // an id, and Foundry sees it with the page's next change.
    function saveArt(id, after) {
      var p = ui.pics;
      if (!id || p.art === p.art0) return Promise.resolve();
      var url = '/campaigns/' + encodeURIComponent(ctx.campaignId) + '/entities/' + encodeURIComponent(id) + '/image';
      return apiCall(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_path: p.art }) }).then(function (res) {
        if (!res.ok) {
          var e = new Error(after ? 'The stat block saved, but the art could not be set. Try again.' : 'The art could not be set, so nothing was saved. Try again.');
          e.artOnly = after; throw e;
        }
        p.art0 = p.art;
      });
    }

    function doSave() {
      var problem = !String(st.name || '').trim() ? (ui.saveAs ? 'Give the form a name first.' : 'Give the creature a name first.') : (!ctx.campaignId ? 'This editor has no campaign, so it cannot save.' : '');
      if (problem) { ui.msg = problem; ui.msgKind = 'error'; draw('sbe-name'); return; }
      ui.saving = true; ui.msg = ''; draw();
      st.base[SB().TOKEN_KEY] = ui.pics.token || '';
      if (ui.saveAs) { saveForm(); return; }
      saveArt(ctx.entityId, false).then(function () {
        return save(st, ctx);
      }).then(function (saved) {
        if (saved && saved.id) ctx.entityId = String(saved.id);
        return saveArt(saved && saved.id, true).then(function () {
          if (saved) saved.image_path = ui.pics.art;
          return saved;
        });
      }).then(function (saved) {
        ui.saving = false; clean();
        clearAIMarks(st);
        if (saved && saved.id) ctx.entityId = String(saved.id);
        if (ui.onClose) { close(saved); return; }
        ui.isNew = false; ui.msg = 'Saved.'; ui.msgKind = 'ok'; draw();
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('Monster builder: save failed', err);
        ui.saving = false;
        if (err && err.artOnly) { ui.isNew = false; clean(); }
        ui.msg = (err && !err.status && err.message) ? err.message : 'Could not save this stat block. Try again.';
        ui.msgKind = 'error'; draw();
      });
    }

    // saveForm hands a form to its owner; a failure keeps the editor open.
    function saveForm() {
      Promise.resolve().then(function () {
        return ui.saveAs(toSave(st), { art: ui.pics.art || '', token: ui.pics.token || '' });
      }).then(function (saved) {
        ui.saving = false; clean();
        clearAIMarks(st);
        if (ui.onClose) { close(saved || null); return; }
        ui.msg = 'Saved.'; ui.msgKind = 'ok'; draw();
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('Monster builder: form save failed', err);
        ui.saving = false;
        ui.msg = (err && err.user) ? err.message : 'Could not save this form. Try again.'; ui.msgKind = 'error'; draw();
      });
    }

    var closed = false;
    function unbind() {
      closed = true;
      stopStream(); clearTimeout(ui.ai.timer); clearTimeout(ui.ai.settle);
      dropAnim();
      if (indWatch) indWatch.disconnect();
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('click', onClick);
      root.removeEventListener('dragstart', onDragStart);
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('drop', onDrop);
      root.removeEventListener('dragend', onDragEnd);
      root.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
      doc.removeEventListener('pointercancel', onPointerUp, true);
    }
    function close(saved) {
      if (closed) return;
      unbind();
      if (ui.onClose) ui.onClose(saved);
    }

    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', onDragEnd);
    root.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerUp, true);
    root.addEventListener('keydown', onKeyDown);
    draw();
    // The mark follows its tab when the row's width changes or it wraps.
    placeInd(false);
    var RO = doc.defaultView && doc.defaultView.ResizeObserver, indWatch = RO ? new RO(function () { if (!closed) placeInd(false); }) : null;
    if (indWatch) indWatch.observe(waysEl);

    // The party never blocks the editor: it fills in when it arrives, and any
    // failure leaves "no party" in its place.
    var P = (typeof MonsterParty !== 'undefined') ? MonsterParty : null;
    if (P && ctx.campaignId) {
      P.fetchParty(ctx.campaignId).then(function (heroes) {
        var profile = heroes && heroes.length ? P.deriveParty(heroes) : null;
        var levels = (heroes || []).map(function (x) { return Number((x.fields_data || {}).level); }).filter(function (n) { return isFinite(n) && n >= 1; });
        ui.party = profile ? { heroes: heroes, profile: profile, levels: levels.length === heroes.length ? levels : [] } : null;
        if (profile && profile.levelAvg !== null && !ui.dirty) ui.gen.level = Math.max(1, Math.min(10, Math.round(profile.levelAvg)));
      }).catch(function () { ui.party = null; }).then(function () {
        ui.partyLoading = false;
        // The Generate panel's party hint and role list depend on the party.
        if (!closed) redraw();
      });
    } else {
      ui.partyLoading = false;
      drawSide();
    }

    return {
      state: st,
      isDirty: function () { return !!ui.dirty; },
      // discard drops unsaved work and closes like Cancel, leaving the editor
      // drawn so a closing animation still has something to show.
      discard: function () { if (ui.drawer) ui.drawer.close(); clean(); close(null); },
      destroy: function () { if (ui.drawer) ui.drawer.close(); clean(); unbind(); host.innerHTML = ''; }
    };
  }

  // ── Start from… ───────────────────────────────────────────────────────────

  // bestiaryRows walks the community bestiary's Draw Steel creatures page by
  // page. Search (not Browse) because only Search filters by system.
  function bestiaryRows() {
    var acc = [];
    function page(n) {
      return SB().getJSON('/bestiary/search?system_id=drawsteel&per_page=50&page=' + n).then(function (b) {
        var rows = (b && b.results) || [];
        acc = acc.concat(rows);
        var total = (b && typeof b.total === 'number') ? b.total : acc.length;
        if (rows.length && acc.length < total && n < 40) return page(n + 1);
        acc.unloaded = Math.max(0, total - acc.length);
        return acc;
      });
    }
    return page(1);
  }

  function campaignRows(cid) {
    return SB().creatureType(cid).then(function (type) {
      if (!type) return [];
      var acc = [];
      function page(n) {
        return SB().getJSON('/api/v1/campaigns/' + encodeURIComponent(cid) + '/entities?type_id=' + encodeURIComponent(type.id) + '&per_page=100&page=' + n).then(function (b) {
          var rows = SB().unwrap(b);
          acc = acc.concat(rows);
          var total = (b && typeof b.total === 'number') ? b.total : acc.length;
          if (rows.length && acc.length < total && n < 40) return page(n + 1);
          acc.unloaded = Math.max(0, total - acc.length);
          return acc;
        });
      }
      return page(1);
    });
  }

  // openStartFrom lists creatures from the community bestiary and this
  // campaign in the From a creature panel; picking one hands its full stat
  // block to `pick(name, statblock, origin)`. `into` is { el, move }: the
  // panel, and the editor's way of sliding the form when the list's height
  // changes. Returns { refresh }, or null without a panel to draw in.
  function openStartFrom(doc, ctx, pick, into) {
    var host = (into && into.el) || doc.getElementById('sbe-from');
    if (!host) return null;
    var move = (into && into.move) || function (fn) { fn(); };
    var tab = 'bestiary', cache = {}, loaded = {};
    host.innerHTML = '<div class="sbe-gen"><p class="sbe-hint">Copies its stat block into this one, level included. Encounter value, Stamina and formula damage are worked out again for that level, and again if you change it.</p>' +
      '<div class="sbe-tabs" role="tablist" aria-label="Where to look"><button type="button" role="tab" data-sf-tab="bestiary" aria-selected="true">Community bestiary</button><button type="button" role="tab" data-sf-tab="campaign" aria-selected="false">This campaign</button></div>' +
      '<input class="input" type="search" id="sbe-sf-q" placeholder="Search creatures" autocomplete="off" aria-label="Search creatures"><ul class="sbe-sf-list" id="sbe-sf-list"></ul>' +
      '<div class="sbe-gen-go"><span class="sbe-sp"></span><button type="button" class="sbe-word" data-sbe-act="start">Close</button></div></div>';
    var list = host.querySelector('#sbe-sf-list'), q = host.querySelector('#sbe-sf-q');
    function rowsFor(t) {
      if (!cache[t]) cache[t] = (t === 'bestiary' ? bestiaryRows() : campaignRows(ctx.campaignId).then(function (rows) {
        // The page being edited is not a creature to copy from.
        var rest = rows.filter(function (r) { return !ctx.entityId || String(r.id) !== String(ctx.entityId); });
        rest.unloaded = rows.unloaded;
        return rest;
      })).catch(function () { return null; });
      return cache[t];
    }
    // Typing repaints at once; a list arriving slides the form to make room.
    function paint(typed) {
      var t = tab;
      if (!loaded[t]) list.innerHTML = '<li class="sbe-sf-note">Loading…</li>';
      rowsFor(t).then(function (rows) {
        if (t !== tab) return;
        loaded[t] = true;
        move(function () {
          if (rows === null) { list.innerHTML = '<li class="sbe-sf-note">Could not load these creatures. Try again.</li>'; return; }
          var term = q.value.trim().toLowerCase();
          var all = rows.filter(function (r) { return !term || String(r.name || '').toLowerCase().indexOf(term) >= 0; });
          var hits = all.slice(0, 100);
          // Never cut the list silently: say what isn't shown.
          var more = (all.length - hits.length) + (rows.unloaded || 0);
          list.innerHTML = hits.map(function (r, i) {
            var f = t === 'bestiary' ? r : (r.fields_data || {});
            var org = SB().cap(f.organization || ''), noRole = /^(leader|solo)$/i.test(f.organization || '');
            var sub = (f.level !== undefined && f.level !== null && f.level !== '' ? 'Level ' + f.level + ' ' : '') + org + (noRole || !f.role ? '' : ' ' + SB().cap(f.role));
            return '<li><button type="button" data-sf-pick="' + i + '"><span><b>' + esc(r.name || 'Unnamed') + '</b><br><span class="sbe-dim sbe-small">' + esc(sub.trim()) + '</span></span>' +
              (t === 'bestiary' ? '<span class="sbe-dim sbe-small">' + esc(r.downloads || 0) + ' added</span>' : '') + '</button></li>';
          }).join('') || '<li class="sbe-sf-note">No creatures match.</li>';
          if (more) list.innerHTML += '<li class="sbe-sf-note">' + more + ' more not shown.' + (all.length > hits.length ? ' Type a name to narrow the list.' : '') + '</li>';
          list._rows = hits;
        }, typed === true);
      });
    }
    host.addEventListener('input', function () { paint(true); });
    host.addEventListener('click', function (e) {
      var tb = e.target.closest && e.target.closest('[data-sf-tab]');
      if (tb) {
        tab = tb.getAttribute('data-sf-tab');
        host.querySelectorAll('[data-sf-tab]').forEach(function (b) { b.setAttribute('aria-selected', b === tb ? 'true' : 'false'); });
        paint(); return;
      }
      var pk = e.target.closest && e.target.closest('[data-sf-pick]');
      if (!pk || !list._rows) return;
      var r = list._rows[Number(pk.getAttribute('data-sf-pick'))];
      if (!r) return;
      if (tab === 'campaign') { pick(r.name, r.fields_data || {}, 'Started from ' + r.name + ' in this campaign.'); return; }
      pk.disabled = true;
      SB().getJSON('/bestiary/' + encodeURIComponent(r.slug) + '/statblock').then(function (sb) {
        pk.disabled = false;
        pick(r.name, sb, 'Started from ' + r.name + ' in the community bestiary.');
      }).catch(function () {
        pk.disabled = false;
        list.insertAdjacentHTML('afterbegin', '<li class="sbe-sf-note">Could not load that stat block. Try again.</li>');
      });
    });
    paint();
    // Opened again, the lists are read afresh: a creature saved since belongs in them.
    return { refresh: function () { cache = {}; paint(); } };
  }

  // ── The Add abilities drawer ──────────────────────────────────────────────

  // plainRefs shows reference markup as its words, for the drawer's compact
  // cards; the ability keeps its markup when added.
  var PLAIN_TERMS = { eot: 'EoT', 'save-ends': 'save ends' };
  function plainRefs(t) { return String(t || '').replace(/\{@\w+ ([^}|]+)(?:\|([^}]+))?\}/g, function (_, term, shown) { return shown || PLAIN_TERMS[term] || term; }); }

  function drawerCard(st, r, opt, lib) {
    var t = r.t, p = props(t), o = opt[r.i] || {}, a = shapeAbility(st, t, o), c = st.c;
    var blocked = p.type === 'villain-action' && !noRole(c.organization) ? 'Only leaders and solos take villain actions.' : '';
    var on = hasAbility(st, t.name);
    var kind = (LIB_KINDS.filter(function (k) { return k[0] === p.type; })[0] || [0, cap(p.type)])[1];
    var h = '<article class="sbe-abc' + (blocked ? ' is-off' : '') + '"' + (blocked || on ? '' : ' draggable="true"') + ' data-dr-i="' + r.i + '">' +
      '<header><b>' + esc(t.name) + '</b><span class="sbe-tag' + (p.type === 'signature' ? ' is-sig' : '') + '">' + esc(kind) + '</span></header>';
    var meta = [listProp(p.keywords).join(', '), p.distance, p.target].filter(Boolean).join(' · ');
    if (meta) h += '<p class="sbe-small sbe-dim">' + esc(meta) + '</p>';
    if (a.tier1) {
      h += '<div class="sbe-abc-t">' + [['≤ 11', a.tier1], ['12–16', a.tier2], ['17 +', a.tier3]].map(function (x) {
        return '<span class="sbe-abc-k">' + x[0] + '</span><span>' + esc(plainRefs(x[1])) + '</span>';
      }).join('') + '</div>';
    }
    if (p.effect) h += '<p class="sbe-small">' + esc(plainRefs(p.effect)) + '</p>';
    if (a.auto_damage && st.pr.damage.sourced) h += '<p class="sbe-small sbe-ok">Damage worked out for this level ' + esc(c.level) + ' ' + esc(c.organization) + '.</p>';
    if (a.tier1 && !blocked && !on) {
      h += '<div class="sbe-abc-o">' + (a.auto_damage
        ? '<label><span class="sbe-lbl">Damage type</span><select class="input" data-dr-opt="dtype" data-dr-oi="' + r.i + '"><option value="">As written</option>' + options(DTYPES, o.dtype) + '</select></label>' : '') +
        '<label><span class="sbe-lbl">Adds</span><select class="input" data-dr-opt="rider" data-dr-oi="' + r.i + '">' +
        RIDERS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === (o.rider || '') ? ' selected' : '') + '>' + esc(x[3] || x[1]) + '</option>'; }).join('') + '</select></label></div>';
    }
    var orgs = listProp(p.organizations);
    var tag = r.why.length ? '<span class="sbe-chip is-pub">' + esc(cap(r.why.join(', '))) + '</span>'
      : (!r.ok && orgs.length < 6 ? '<span class="sbe-chip is-none">For ' + esc(orgs.map(plural).join(' and ')) + '</span>' : '');
    h += '<footer>' + tag + '<span class="sbe-sp"></span>' + (blocked ? '<span class="sbe-small sbe-dim">' + esc(blocked) + '</span>'
      : on ? '<span class="sbe-small sbe-dim"><i class="fa-solid fa-check" aria-hidden="true"></i> On this creature</span>'
        : '<button type="button" class="btn-secondary btn-sm" data-dr-add="' + r.i + '" aria-label="Add ' + esc(t.name) + '">Add</button>') + '</footer></article>';
    return h;
  }

  function drawerMine(st, fresh) {
    var c = st.c;
    function item(kind, i, name, extra) {
      return '<li class="sbe-mine-i' + extra + (fresh === kind + i ? ' is-new' : '') + '"><span>' + esc(name || 'Unnamed') + '</span>' +
        '<button type="button" data-dr-rm="' + kind + i + '" aria-label="Remove ' + esc(name || 'this') + '">×</button></li>';
    }
    var sig = [], other = [];
    c.abilities.forEach(function (a, i) { (a.type === 'signature' ? sig : other).push(item('a', i, a.name, a.type === 'signature' ? ' is-sig' : '')); });
    var h = '<p class="sbe-lbl">Signature</p><ul>' + (sig.join('') || '<li class="sbe-mine-i is-empty">None yet</li>') + '</ul>';
    if (c.traits.length) h += '<p class="sbe-lbl">Traits</p><ul>' + c.traits.map(function (t, i) { return item('t', i, t.name, ''); }).join('') + '</ul>';
    h += '<p class="sbe-lbl">Other abilities</p><ul>' + (other.join('') || '<li class="sbe-mine-i is-empty">None yet</li>') + '</ul>';
    if (noRole(c.organization)) {
      h += '<p class="sbe-lbl">Villain actions</p><ul>' + [0, 1, 2].map(function (k) {
        var v = c.villain_actions[k];
        return v ? item('v', k, v.name, '') : '<li class="sbe-mine-i is-empty">' + (k + 1) + ': empty</li>';
      }).join('') + '</ul>';
    }
    return h;
  }

  // openAbilityDrawer slides the library down over the page. ctx carries the
  // editor state, loadLib (a promise of the library, [] when it can't be
  // read) and changed (redraws the editor). Every add can be undone.
  function openAbilityDrawer(doc, ctx) {
    var st = ctx.st, lib = null, f = { q: '', type: '', kw: '', org: '', all: false }, opt = {}, last = null, fresh = null, gone = false;
    // The library holds the whole bestiary, so cards are drawn a page at a
    // time; a new filter or search starts again at the first page.
    var PAGE = 60, limit = PAGE, shownFor = '';
    var scrim = doc.createElement('div');
    scrim.className = 'sbe-scrim';
    var dr = doc.createElement('div');
    dr.className = 'sbe-drawer';
    dr.setAttribute('role', 'dialog');
    dr.setAttribute('aria-modal', 'true');
    dr.setAttribute('aria-labelledby', 'sbe-dr-t');
    dr.innerHTML = '<div class="sbe-dr-h"><h2 id="sbe-dr-t">Add abilities</h2><span class="sbe-small sbe-dim" id="sbe-dr-for"></span><span class="sbe-sp"></span>' +
      '<button type="button" class="sbe-word" id="sbe-dr-all" aria-pressed="false">Show all</button>' +
      '<button type="button" class="btn-primary btn-sm" data-dr-close>Done</button></div>' +
      '<div class="sbe-dr-f"><input class="input" type="search" id="sbe-dr-q" placeholder="Search abilities" aria-label="Search abilities" autocomplete="off">' +
      '<div class="sbe-chips" id="sbe-dr-chips"></div></div>' +
      '<div class="sbe-dr-b"><div class="sbe-dr-lib" id="sbe-dr-lib"><p class="sbe-small sbe-dim">Reading the ability library…</p></div>' +
      '<aside class="sbe-dr-drop" id="sbe-dr-drop" aria-label="This creature"><p class="sbe-small sbe-dim">Drag an ability here, or press Add.</p><div id="sbe-dr-mine"></div></aside></div>' +
      '<p class="sbe-dr-status" id="sbe-dr-status" role="status" aria-live="polite"></p>';
    doc.body.appendChild(scrim);
    doc.body.appendChild(dr);
    var bodyOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    var $ = function (id) { return dr.querySelector('#' + id); };

    function chips() {
      var kws = [];
      (lib || []).forEach(function (t) { listProp(props(t).keywords).forEach(function (k) { if (kws.indexOf(k) < 0) kws.push(k); }); });
      kws.sort();
      function group(label, key, list) {
        return '<div class="sbe-chip-row" role="group" aria-label="' + label + '">' + list.map(function (x) {
          return '<button type="button" class="sbe-fchip" data-dr-f="' + key + '" data-dr-v="' + esc(x[0]) + '" aria-pressed="' + (f[key] === x[0]) + '">' + chipWord(x[1]) + '</button>';
        }).join('') + '</div>';
      }
      $('sbe-dr-chips').innerHTML = group('Kind', 'type', LIB_KINDS) +
        group('Keyword', 'kw', kws.map(function (k) { return [k, k]; })) +
        group('Made for', 'org', ORGS.filter(function (o) { return o !== 'swarm'; }).map(function (o) { return [o, 'For ' + plural(o)]; }));
    }
    function paint() {
      var c = st.c;
      $('sbe-dr-for').textContent = 'For this level ' + c.level + ' ' + (c.organization || 'creature') + (c.role && !noRole(c.organization) ? ' ' + c.role : '');
      $('sbe-dr-mine').innerHTML = drawerMine(st, fresh);
      if (!lib) return;
      var rows = libraryRows(st, lib, f), key = [f.all, f.type, f.kw, f.org, f.q].join('|');
      if (key !== shownFor) { shownFor = key; limit = PAGE; }
      var left = rows.length - limit;
      $('sbe-dr-lib').innerHTML = rows.length ? rows.slice(0, limit).map(function (r) { return drawerCard(st, r, opt, lib); }).join('') +
        (left > 0 ? '<p class="sbe-dr-more"><button type="button" class="sbe-word" data-dr-more>Show ' + Math.min(PAGE, left) + ' more (' + left + ' left)</button></p>' : '')
        : '<p class="sbe-small sbe-dim">No abilities match. Clear a filter or the search' + (f.all ? '' : ', or press Show all') + '.</p>';
      $('sbe-dr-all').textContent = f.all ? 'Showing all ' + lib.length : 'Show all';
    }
    function say(msg, undoable) {
      var el = $('sbe-dr-status');
      el.innerHTML = esc(msg) + (undoable ? ' <button type="button" class="sbe-link" data-dr-undo>Undo</button>' : '');
    }
    function add(i) {
      var t = lib && lib[i];
      if (!t) return;
      var res = addFromLibrary(st, t, opt[i]);
      if (res.undo) {
        last = res.undo;
        var p = props(t);
        fresh = p.type === 'trait' ? 't' + (st.c.traits.length - 1) : p.type === 'villain-action' ? 'v' + (st.c.villain_actions.length - 1) : 'a' + (st.c.abilities.length - 1);
        ctx.changed();
      }
      say(res.message, !!res.undo);
      paint();
      fresh = null;
    }
    function close() {
      if (gone) return;
      gone = true;
      doc.removeEventListener('keydown', onKey, true);
      dr.classList.remove('is-open');
      scrim.classList.remove('is-open');
      doc.body.style.overflow = bodyOverflow;
      setTimeout(function () { dr.remove(); scrim.remove(); }, motion(doc) === 'off' ? 0 : tokenMs(doc, '--dur-standard', 200) + 40);
      // The editor redraws behind the drawer, so its opener is found again by id.
      var back = ctx.returnTo ? doc.getElementById(ctx.returnTo) : null;
      if (back) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
    }
    // Esc closes; Tab stays inside the drawer while it is open.
    function onKey(e) {
      // Esc in an open dropdown closes the dropdown, not the drawer.
      if (e.key === 'Escape' && e.target && e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var els = [].filter.call(dr.querySelectorAll('button,input,select,[tabindex]'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!els.length) return;
      var first = els[0], lastEl = els[els.length - 1];
      if (!dr.contains(doc.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && doc.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    }
    doc.addEventListener('keydown', onKey, true);
    scrim.addEventListener('click', close);
    dr.addEventListener('input', function (e) { if (e.target.id === 'sbe-dr-q') { f.q = e.target.value; paint(); } });
    dr.addEventListener('change', function (e) {
      var s = e.target;
      if (!s.hasAttribute('data-dr-opt')) return;
      var i = Number(s.getAttribute('data-dr-oi'));
      opt[i] = opt[i] || {};
      opt[i][s.getAttribute('data-dr-opt')] = s.value;
      paint();
      var back = dr.querySelector('[data-dr-opt="' + s.getAttribute('data-dr-opt') + '"][data-dr-oi="' + i + '"]');
      if (back) back.focus();
    });
    dr.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !dr.contains(b)) return;
      if (b.hasAttribute('data-dr-close')) { close(); return; }
      if (b.id === 'sbe-dr-all') { f.all = !f.all; b.setAttribute('aria-pressed', String(f.all)); paint(); return; }
      if (b.hasAttribute('data-dr-f')) {
        var k = b.getAttribute('data-dr-f'), v = b.getAttribute('data-dr-v');
        f[k] = f[k] === v ? '' : v;
        chips(); paint();
        [].forEach.call(dr.querySelectorAll('[data-dr-f="' + k + '"]'), function (x) { if (x.getAttribute('data-dr-v') === v) x.focus(); });
        return;
      }
      if (b.hasAttribute('data-dr-more')) {
        var from = limit;
        limit += PAGE; paint();
        var next = dr.querySelectorAll('.sbe-abc')[from];
        var go = next && (next.querySelector('[data-dr-add]') || next.querySelector('button, select'));
        if (go) go.focus();
        return;
      }
      if (b.hasAttribute('data-dr-add')) {
        var ai = b.getAttribute('data-dr-add');
        add(Number(ai));
        var stay = dr.querySelector('[data-dr-add="' + ai + '"]') || $('sbe-dr-q');
        if (stay) stay.focus();
        return;
      }
      if (b.hasAttribute('data-dr-undo') && last) {
        restore(st, last); last = null; ctx.changed(); say('Undone.', false); paint(); $('sbe-dr-q').focus(); return;
      }
      var rm = b.getAttribute('data-dr-rm');
      if (rm) {
        var kind = rm.charAt(0), idx = Number(rm.slice(1));
        var list = kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits;
        if (!list[idx]) return;
        last = clone({ abilities: st.c.abilities, traits: st.c.traits, villain_actions: st.c.villain_actions });
        var name = list[idx].name;
        list.splice(idx, 1);
        if (kind === 'v') renumberVillains(list);
        st.editAb = null; derive(st); ctx.changed();
        say('Removed ' + (name || 'it') + '.', true); paint(); $('sbe-dr-q').focus();
      }
    });
    // Drag a card from the library onto the creature.
    var drop = $('sbe-dr-drop');
    dr.addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.sbe-abc[draggable="true"]') : null;
      if (!card) return;
      e.dataTransfer.setData('text/plain', 'sbe-ab:' + card.getAttribute('data-dr-i'));
      e.dataTransfer.effectAllowed = 'copy';
      card.classList.add('is-dragging'); drop.classList.add('is-ready');
    });
    dr.addEventListener('dragend', function (e) {
      var card = e.target.closest ? e.target.closest('.sbe-abc') : null;
      if (card) card.classList.remove('is-dragging');
      drop.classList.remove('is-ready', 'is-over');
    });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', function (e) { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('is-over', 'is-ready');
      var m = /^sbe-ab:(\d+)$/.exec(e.dataTransfer.getData('text/plain'));
      if (m) add(Number(m[1]));
    });

    paint();
    void dr.offsetWidth;
    dr.classList.add('is-open');
    scrim.classList.add('is-open');
    $('sbe-dr-q').focus({ preventScroll: true });
    ctx.loadLib().then(function (l) {
      if (gone) return;
      lib = l || [];
      if (!lib.length) { $('sbe-dr-lib').innerHTML = '<p class="sbe-small sbe-dim">The ability library could not be read. Close this and use Write your own.</p>'; return; }
      chips(); paint();
    });
    return { close: close };
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  // Every colour, corner, duration and easing is one of Chronicle's tokens,
  // which carry light and dark; the two state colours (matches the formula,
  // set by the director) switch under Chronicle's .dark root class. Injected
  // into <head>, never the mount element, so a redraw cannot wipe them.
  var CSS = [
    '.sbe-wrap{--sbe-ok:#15803d;--sbe-ok-soft:rgba(22,163,74,.12);--sbe-own:#b45309;--sbe-own-soft:rgba(217,119,6,.14);display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;align-items:start;margin-top:12px}',
    '.sbe-drawer{--sbe-ok:#15803d;--sbe-ok-soft:rgba(22,163,74,.12);--sbe-own:#b45309;--sbe-own-soft:rgba(217,119,6,.14)}',
    '.dark .sbe-wrap,.dark .sbe-drawer{--sbe-ok:#4ade80;--sbe-ok-soft:rgba(74,222,128,.14);--sbe-own:#fbbf24;--sbe-own-soft:rgba(251,191,36,.14)}',
    '.sbe{padding:16px 18px;display:flex;flex-direction:column;gap:12px;color:var(--color-text-body,#374151);font-size:14px;min-width:0}',
    '.sbe-part{display:contents}',
    '.sbe-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.sbe-bar-t{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-secondary,#4b5563);margin-right:4px}',
    '.sbe-sp{flex:1}',
    '.sbe-msg{margin:0;font-size:14px}.sbe-msg:empty{display:none}.sbe-msg.is-ok{color:var(--sbe-ok)}.sbe-msg.is-error{color:#b91c1c}.dark .sbe-msg.is-error{color:#f87171}',
    '.sbe-origin{margin:0;font-size:14px;padding:8px 12px;border-radius:var(--shape-r-ctl,8px);background:var(--color-bg-tertiary,#f3f4f6);display:flex;gap:8px;align-items:baseline}',
    '.sbe-origin i{color:var(--color-text-muted,#646b78)}',
    '.sbe-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    // The ways to start: index tabs, the open one marked by a hairline under it and up its left side.
    '.sbe-ways{position:relative;display:flex;flex-wrap:wrap;align-items:flex-end;gap:0 4px;border-bottom:var(--shape-rule,1px) solid var(--color-border,#e5e7eb);min-width:0}',
    '.sbe-way{position:relative;font:inherit;font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;color:var(--color-text-secondary,#4b5563);background:none;border:0;padding:13px 10px 10px 12px;min-height:36px;cursor:pointer;scroll-margin-top:72px;transition:color var(--dur-micro,120ms)}',
    '.sbe-way:hover,.sbe-way[aria-selected="true"]{color:var(--color-text-primary,#111827)}',
    '.sbe-way:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:-2px;border-radius:var(--shape-r-small,6px)}',
    '.sbe-ind{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;opacity:0;transition:opacity var(--dur-micro,120ms)}',
    '.sbe-ind.is-on{opacity:.55}',
    '.sbe-ind i{position:absolute;left:0;top:0;width:1px;background:var(--color-text-primary,#111827);transform-origin:0 0;transition:transform var(--dur-micro,120ms) var(--ease-in-out,cubic-bezier(.4,0,.2,1))}',
    '.sbe-ind-s{height:calc(var(--sbe-way-h,36px) - 8px)}.sbe-ind-u{height:1px}',
    '.sbe-ind.is-still,.sbe-ind.is-still i,.sbe-ind.is-jump i{transition:none}',
    // Before the script has placed the mark, the open tab draws the same shape itself.
    '.sbe-ways:not(.has-ind) .sbe-way[aria-selected="true"]::before{content:"";position:absolute;left:0;top:9px;bottom:-1px;width:1px;background:var(--color-text-primary,#111827);opacity:.55}',
    '.sbe-ways:not(.has-ind) .sbe-way[aria-selected="true"]::after{content:"";position:absolute;left:0;right:4px;bottom:-1px;height:1px;background:var(--color-text-primary,#111827);opacity:.55}',
    // The open panel hangs from the tab row with no frame of its own; the form below is an opaque sheet that slides off it.
    '.sbe-hang{display:none;margin-top:-12px;padding:12px 0 14px;border-bottom:var(--shape-rule,1px) solid var(--color-border,#e5e7eb);min-width:0}',
    '.sbe-hang.is-open{display:block}',
    '.sbe-pan[hidden]{display:none}',
    '.sbe-form{display:flex;flex-direction:column;gap:12px;position:relative;z-index:1;min-width:0;background:var(--color-card-bg,#fff)}',
    // A form shorter than the open panel carries a tail of the same sheet while it slides, so the panel's foot never shows below it; the card clips the tail at its own edge.
    '.sbe-form::after{content:"";position:absolute;left:0;right:0;top:100%;height:var(--sbe-tail,0px);background:inherit;pointer-events:none}',
    '.sbe.is-moving{overflow:clip}',
    '.sbe-gen{display:flex;flex-direction:column;gap:12px}',
    '.sbe-gen-row{display:flex;flex-wrap:wrap;gap:12px 16px}.sbe-gen-row>.sbe-f{flex:0 1 180px}',
    '.sbe-gen-go{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}',
    '.sbe-sp+.sbe-word{margin-left:auto}',
    '.sbe-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px}.sbe-steps>li{display:flex;flex-direction:column;gap:8px}',
    '.sbe-why{margin:0;padding-left:18px;list-style:disc;font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:2px}',
    // A quiet word: the lightest control, for showing more and for closing.
    '.sbe-word{font:inherit;font-size:14px;font-weight:500;display:inline-flex;align-items:center;min-height:32px;padding:0;border:0;background:none;cursor:pointer;white-space:nowrap;color:var(--color-accent-link,var(--color-accent,#6366f1));text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px;transition:text-decoration-color var(--dur-micro,120ms)}',
    '.sbe-word:hover,.sbe-word:focus-visible{text-decoration-color:currentColor;outline:none}',
    '.sbe-word:disabled{opacity:.5;cursor:default}',
    '.sbe-peek summary{list-style:none;width:fit-content}.sbe-peek summary::-webkit-details-marker{display:none}',
    '.sbe-peek textarea{width:100%;margin-top:6px;font-size:12.5px}',
    '.sbe-ai-ok{color:var(--sbe-ok)}.sbe-ai-err{color:var(--sbe-own)}',
    // Chips to pick from. The chosen one takes the accent as an edge and as text, never as a fill.
    '.sbe-seg{display:flex;flex-wrap:wrap;gap:6px}',
    '.sbe-seg label{position:relative;display:inline-flex}',
    '.sbe-seg input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}',
    '.sbe-seg label>span,.sbe-fchip{font:inherit;font-size:12.5px;line-height:1.2;display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:0 12px;border:1px solid var(--color-border,#e5e7eb);border-radius:999px;background:var(--color-card-bg,#fff);color:var(--color-text-body,#374151);white-space:nowrap;cursor:pointer;transition:background-color var(--dur-micro,120ms),border-color var(--dur-micro,120ms),color var(--dur-micro,120ms)}',
    '.sbe-seg label:hover>span,.sbe-fchip:hover{background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbe-seg input:checked+span,.sbe-fchip[aria-pressed="true"]{border-color:var(--color-accent,#6366f1);box-shadow:inset 0 0 0 1px var(--color-accent,#6366f1);color:var(--color-accent-link,var(--color-accent,#6366f1));font-weight:600}',
    '.sbe-seg input:focus-visible+span,.sbe-fchip:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:2px}',
    '.sbe-cw{display:inline-flex;flex-direction:column;align-items:center}',
    '.sbe-cw::after{content:attr(data-w);height:0;overflow:hidden;visibility:hidden;font-weight:600;pointer-events:none;user-select:none}',
    '.sbe-fchip .sbe-dim{font-weight:400;color:var(--color-text-muted,#646b78)}',
    '.sbe-chips{display:flex;flex-direction:column;gap:8px}',
    '.sbe-chip-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.sbe-chip-set{display:flex;flex-wrap:wrap;gap:6px;min-width:0;flex:1 1 0}',
    // The book shortlist inside With an AI: rows under hairlines, no box of its own.
    '.sbe-bk{display:flex;flex-direction:column;gap:10px}',
    '.sbe-pan,.sbe-gen,.sbe-steps,.sbe-steps>li,.sbe-bk,.sbe-bk>*,.sbe-bk .sbe-chips,.sbe-bk .sbe-chip-row{min-width:0;max-width:100%}',
    '.sbe-bk .sbe-chip-row{align-items:flex-start;flex-wrap:nowrap}',
    '.sbe-bk-k{flex:none;width:80px;padding-top:7px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-muted,#646b78)}',
    '.sbe-bk-sel{width:auto;max-width:260px}',
    '.sbe-bk-row{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}',
    '.sbe-bk-lim{display:inline-flex;gap:6px}',
    '.sbe-bk-list{display:flex;flex-direction:column;max-height:360px;overflow:auto;overscroll-behavior:contain}',
    '.sbe-bk-it{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px 4px;border-top:var(--shape-rule,1px) solid var(--color-border,#e5e7eb);cursor:pointer;transition:background-color var(--dur-micro,120ms)}',
    '.sbe-bk-it:hover{background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbe-bk-it.is-off{opacity:.5}',
    '.sbe-bk-it input{margin-top:3px}',
    '.sbe-bk-it b{color:var(--color-text-primary,#111827);font-weight:600}',
    '.sbe-bk-x{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    // From a creature: where to look, a search and the list.
    '.sbe-tabs{display:flex;gap:4px;border-bottom:1px solid var(--color-border,#e5e7eb)}',
    '.sbe-tabs button{font:inherit;font-size:14px;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:6px 10px;color:var(--color-text-secondary,#4b5563);cursor:pointer;transition:color var(--dur-micro,120ms)}',
    '.sbe-tabs button[aria-selected="true"]{color:var(--color-accent-link,var(--color-accent,#6366f1));border-bottom-color:var(--color-accent,#6366f1)}',
    '.sbe-tabs button:hover{color:var(--color-text-primary,#111827)}',
    '.sbe-tabs button:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:-2px;border-radius:var(--shape-r-small,6px)}',
    '.sbe-sf-list{list-style:none;margin:0;padding:0;max-height:320px;overflow-y:auto;overscroll-behavior:contain}',
    '.sbe-sf-list li+li{border-top:var(--shape-rule,1px) solid var(--color-border,#e5e7eb)}',
    '.sbe-sf-list button{font:inherit;width:100%;text-align:left;background:none;border:0;padding:8px 4px;min-height:44px;display:flex;justify-content:space-between;gap:12px;align-items:center;cursor:pointer;color:var(--color-text-body,#374151);transition:background-color var(--dur-micro,120ms)}',
    '.sbe-sf-list button:hover,.sbe-sf-list button:focus-visible{background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbe-sf-list button:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:-2px}',
    '.sbe-sf-list b{color:var(--color-text-primary,#111827);font-weight:600}',
    '.sbe-sf-note{padding:12px 4px;font-size:12.5px;color:var(--color-text-secondary,#4b5563)}',
    // The form.
    '.sbe-pics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
    '.sbe-pic-slot{display:grid;gap:6px;justify-items:start;align-content:start;min-width:0;padding:10px 12px;border:1px solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-ctl,8px)}',
    '.sbe-pic-prev{width:88px;height:88px;border-radius:var(--shape-r-ctl,8px);overflow:hidden;display:grid;place-items:center;background:var(--color-bg-tertiary,#f3f4f6);box-shadow:0 0 0 1px var(--color-border,#e5e7eb)}',
    '.sbe-pic-prev.is-round{border-radius:50%}',
    '.sbe-pic-prev.is-generic{opacity:.6;box-shadow:none;background:none}',
    '.sbe-pic-prev img,.sbe-pic-prev svg{width:100%;height:100%;object-fit:cover;display:block}',
    '.sbe-pic-none{font-size:12.5px;color:var(--color-text-secondary,#4b5563);text-align:center;padding:4px}',
    '.sbe-pic-acts{display:flex;gap:4px;flex-wrap:wrap}',
    '.sbe-pic-up{position:relative;cursor:pointer}',
    '.sbe-pic-up:focus-within{outline:2px solid var(--color-accent,#6366f1);outline-offset:2px}',
    '.sbe-h{margin:8px 0 0;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-secondary,#4b5563);display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between}',
    '.sbe-h .sbe-hint{text-transform:none;letter-spacing:0;font-weight:400;margin-right:auto}',
    '.sbe-h button{text-transform:none;letter-spacing:0}',
    '.sbe-h-acts{display:inline-flex;gap:8px;flex-wrap:wrap}',
    '.sbe-grid{display:grid;gap:12px}',
    '.sbe-g3{grid-template-columns:repeat(3,minmax(0,1fr))}.sbe-g4{grid-template-columns:repeat(4,minmax(0,1fr))}.sbe-g7{grid-template-columns:repeat(7,minmax(0,1fr))}',
    '.sbe-f{display:flex;flex-direction:column;gap:4px;min-width:0}.sbe-wide{grid-column:span 2}.sbe-full{grid-column:1/-1}',
    '.sbe-lbl{font-size:12.5px;font-weight:600;color:var(--color-text-secondary,#4b5563);margin:0}',
    '.sbe-num{font-variant-numeric:tabular-nums}',
    '.sbe .input{width:100%;font-size:14px}',
    '.sbe-hint{font-size:12.5px;line-height:1.45;color:var(--color-text-secondary,#4b5563);margin:0}',
    '.sbe-check{display:flex;gap:8px;align-items:center;font-size:14px}',
    '.sbe-chip{font-size:11.5px;line-height:1.3;border-radius:var(--shape-r-tag,4px);padding:3px 6px;display:inline-flex;gap:4px;align-items:baseline;flex-wrap:wrap;align-self:flex-start}',
    '.sbe-chip.is-pub{background:var(--sbe-ok-soft);color:var(--sbe-ok)}',
    '.sbe-chip.is-own,.sbe-chip.is-none{background:var(--sbe-own-soft);color:var(--sbe-own)}',
    // The provenance chip's light-mode amber is a deeper shade so its small text holds 4.5:1 on the tint.
    '.sbe-chip.is-none{color:#92400e}.dark .sbe-chip.is-none{color:var(--sbe-own)}',
    '.sbe-chip.is-wait{background:transparent;color:var(--color-text-secondary,#4b5563);padding-left:0}',
    '.sbe-chip.is-ai{background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-secondary,#4b5563)}',
    '.sbe-link{font:inherit;background:none;border:0;padding:0;color:var(--color-accent-link,var(--color-accent,#6366f1));text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
    // A figure that just changed is ringed in the accent, and the ring fades.
    '.sbe-box{position:relative;display:block}',
    '.sbe-f.is-flash .sbe-box::after{content:"";position:absolute;inset:-2px;border-radius:calc(var(--shape-r-ctl,8px) + 2px);box-shadow:0 0 0 2px rgb(var(--color-accent-rgb, 99 102 241) / .45);pointer-events:none;opacity:0}',
    '.sbe-abs{display:flex;flex-direction:column;gap:8px}',
    '.sbe-ab{border:1px solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-ctl,8px);padding:0 12px 10px}',
    '.sbe-ab .sbx-ab{border-top:0}',
    '.sbe-ab-edit{padding-top:12px;display:flex;flex-direction:column;gap:10px;background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbe-ab-foot{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;font-size:14px}',
    '.sbe-ab-acts{display:inline-flex;gap:12px;margin-left:auto;align-items:center}',
    '.sbe-icon{font:inherit;font-size:13px;line-height:1;width:28px;height:28px;border-radius:var(--shape-r-small,6px);border:0;background:none;color:var(--color-text-secondary,#4b5563);cursor:pointer;transition:background-color var(--dur-micro,120ms),color var(--dur-micro,120ms)}',
    '.sbe-icon:hover:not(:disabled){background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-primary,#111827)}',
    '.sbe-icon:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:1px}',
    '.sbe-icon:disabled{opacity:.35;cursor:default}',
    '.sbe-grip{color:var(--color-text-muted,#646b78);cursor:grab;user-select:none}',
    '.sbe-ab[draggable="true"]{cursor:grab}.sbe-ab.is-dragging{opacity:.45}',
    // Beside the form: the party, the budget and the checks.
    '.sbe-side{display:flex;flex-direction:column;gap:12px;position:sticky;top:12px;min-width:0}',
    '.sbe-side-card{background:var(--color-card-bg,#fff);border:1px solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-panel,12px);padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}',
    '.sbe-side-h{margin:0;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-secondary,#4b5563)}',
    '.sbe-small{font-size:12.5px;line-height:1.5;margin:0}.sbe-dim{color:var(--color-text-secondary,#4b5563)}',
    '.sbe-small b{color:var(--color-text-primary,#111827);font-weight:600}',
    '.sbe-heroes{list-style:none;margin:0;padding:0;display:grid;gap:8px}',
    '.sbe-heroes li{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--color-text-primary,#111827)}',
    '.sbe-av{width:28px;height:28px;border-radius:50%;background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-secondary,#4b5563);display:grid;place-items:center;font-weight:600;font-size:12.5px;flex-shrink:0}',
    '.sbe-meter{position:relative;height:12px;border-radius:6px;background:var(--color-bg-tertiary,#f3f4f6);overflow:hidden}',
    '.sbe-band{position:absolute;top:0;bottom:0}.sbe-band.is-easy{background:rgb(var(--color-ok-rgb, 22 163 74) / .12)}.sbe-band.is-std{background:rgb(var(--color-ok-rgb, 22 163 74) / .32)}.sbe-band.is-hard{background:rgb(var(--color-warn-rgb, 217 119 6) / .28)}',
    '.sbe-fill{position:absolute;left:0;top:4px;bottom:4px;background:var(--color-accent,#6366f1);border-radius:2px}',
    '.sbe-meter-k{display:flex;justify-content:space-between}',
    '.sbe-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:14px}',
    '.sbe-checks li{display:flex;gap:8px;align-items:baseline;color:var(--color-text-primary,#111827)}',
    '.sbe-checks .is-ok i{color:var(--sbe-ok)}.sbe-checks .is-miss i,.sbe-checks .is-warn i{color:var(--sbe-own)}.sbe-checks .is-provenance i{color:var(--color-text-muted,#646b78)}',
    // Motion. Arrivals fade (and rise a few pixels where a list fills in); nothing overshoots.
    '@keyframes sbe-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes sbe-row{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
    '@keyframes sbe-settle{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '@keyframes sbe-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
    '.sbe-entering{animation:sbe-fade var(--dur-standard,200ms) var(--ease-out,cubic-bezier(.16,1,.3,1)) both}',
    '.sbe-chip.is-new{animation:sbe-fade var(--dur-standard,200ms) var(--ease-out,cubic-bezier(.16,1,.3,1)) both}',
    '.sbe-checks li.is-new{animation:sbe-row var(--dur-standard,200ms) var(--ease-out,cubic-bezier(.16,1,.3,1)) both}',
    '.sbe-form>.is-settle,.sbe-abs.is-settle{animation:sbe-settle var(--dur-large,280ms) var(--ease-out,cubic-bezier(.16,1,.3,1)) both}',
    // Add abilities: the drawer slides down from the top and the page dims; leaving is quicker.
    '.sbe-scrim{position:fixed;inset:0;z-index:80;background:rgba(8,10,20,.55);opacity:0;transition:opacity var(--dur-standard,200ms) var(--ease-in,cubic-bezier(.4,0,1,1))}',
    '.sbe-scrim.is-open{opacity:1;transition:opacity var(--dur-large,280ms) var(--ease-out,cubic-bezier(.16,1,.3,1))}',
    '.sbe-drawer{position:fixed;z-index:81;top:calc(12px + env(safe-area-inset-top,0px));left:50%;width:min(1180px,calc(100vw - 32px));max-height:calc(100% - 24px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;background:var(--color-card-bg,#fff);color:var(--color-text-body,#374151);border:1px solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-panel,12px);box-shadow:var(--elev-dragged,0 16px 36px -8px rgb(0 0 0 / .22));overflow:hidden;font-size:14px;transform:translate(-50%,calc(-100% - 24px));transition:transform var(--dur-standard,200ms) var(--ease-in,cubic-bezier(.4,0,1,1))}',
    '.sbe-drawer.is-open{transform:translate(-50%,0);transition:transform var(--dur-large,280ms) var(--ease-out,cubic-bezier(.16,1,.3,1))}',
    '.sbe-dr-h{display:flex;gap:4px 12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--color-border,#e5e7eb)}',
    '.sbe-dr-h h2{margin:0;font-size:16px;font-weight:600;color:var(--color-text-primary,#111827)}',
    '.sbe-dr-f{display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-bottom:1px solid var(--color-border,#e5e7eb)}',
    '.sbe-dr-f input{width:100%;font-size:14px}',
    '.sbe-dr-b{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;padding:16px;overflow:auto;min-height:0;flex:1}',
    '.sbe-dr-more{grid-column:1/-1;margin:4px 0 0;text-align:center}',
    '.sbe-dr-lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;align-content:start;min-width:0}',
    '.sbe-abc{display:flex;flex-direction:column;gap:6px;border:1px solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-ctl,8px);padding:10px 12px;background:var(--color-card-bg,#fff);font-size:12.5px;min-width:0;transition:border-color var(--dur-micro,120ms)}',
    '.sbe-abc[draggable="true"]{cursor:grab}.sbe-abc[draggable="true"]:hover{border-color:var(--color-input-border,#d1d5db)}',
    '.sbe-abc.is-dragging{opacity:.45}.sbe-abc.is-off{opacity:.6}',
    '.sbe-abc header,.sbe-abc footer{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.sbe-abc header b{color:var(--color-text-primary,#111827);font-size:14px;font-weight:600}',
    '.sbe-abc p{margin:0}',
    '.sbe-tag{font-size:11px;border-radius:var(--shape-r-tag,4px);padding:1px 6px;background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-secondary,#4b5563);white-space:nowrap}',
    '.sbe-tag.is-sig{color:var(--color-text-primary,#111827);font-weight:600}',
    '.sbe-abc-t{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 8px;font-size:12.5px}',
    '.sbe-abc-k{font-variant-numeric:tabular-nums;font-size:11px;color:var(--color-text-secondary,#4b5563)}',
    '.sbe-ok{color:var(--sbe-ok,#15803d)}',
    '.sbe-abc-o{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px}',
    '.sbe-abc-o label{display:flex;flex-direction:column;gap:2px;min-width:0}.sbe-abc-o select{width:100%;font-size:12.5px}',
    // A dashed edge is a place to put something: the drop target, and an empty slot in the creature's list.
    '.sbe-dr-drop{position:sticky;top:0;align-self:start;display:flex;flex-direction:column;gap:6px;border:1px dashed var(--color-border,#e5e7eb);border-radius:var(--shape-r-panel,12px);padding:12px;transition:border-color var(--dur-micro,120ms),background-color var(--dur-micro,120ms)}',
    '.sbe-dr-drop.is-ready{border-color:var(--color-accent,#6366f1)}',
    '.sbe-dr-drop.is-over{border-color:var(--color-accent,#6366f1);background:rgb(var(--color-accent-rgb, 99 102 241) / .12)}',
    '.sbe-dr-drop p{margin:0}.sbe-dr-drop .sbe-lbl{margin-top:6px}',
    '.sbe-dr-drop ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}',
    '.sbe-mine-i{display:flex;gap:6px;align-items:center;justify-content:space-between;border:1px solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-ctl,8px);padding:5px 8px;font-size:12.5px;color:var(--color-text-primary,#111827)}',
    '.sbe-mine-i.is-sig{font-weight:600}',
    '.sbe-mine-i.is-empty{color:var(--color-text-secondary,#4b5563);border-style:dashed}',
    '.sbe-mine-i button{font:inherit;border:0;background:none;color:var(--color-text-secondary,#4b5563);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}',
    '.sbe-mine-i.is-new{animation:sbe-in var(--dur-standard,200ms) var(--ease-out,cubic-bezier(.16,1,.3,1))}',
    '.sbe-dr-status{margin:0;padding:8px 16px;border-top:1px solid var(--color-border,#e5e7eb);font-size:14px}.sbe-dr-status:empty{display:none}',
    // Calm keeps fades and drops travel; Off and a device asking for reduced motion show the end state.
    'html[data-motion="calm"] .sbe-drawer,html[data-cz-reduce] .sbe-drawer{transform:translate(-50%,0);opacity:0;transition:opacity var(--dur-standard,200ms) linear}',
    'html[data-motion="calm"] .sbe-drawer.is-open,html[data-cz-reduce] .sbe-drawer.is-open{opacity:1}',
    'html[data-motion="calm"] .sbe-ind i,html[data-cz-reduce] .sbe-ind i{transition:none}',
    'html[data-motion="calm"] :is(.sbe-checks li.is-new,.sbe-form>.is-settle,.sbe-abs.is-settle,.sbe-mine-i.is-new),html[data-cz-reduce] :is(.sbe-checks li.is-new,.sbe-form>.is-settle,.sbe-abs.is-settle,.sbe-mine-i.is-new){animation:none}',
    'html[data-motion="off"] .sbe-drawer{transform:translate(-50%,0);transition:none}',
    'html[data-motion="off"] :is(.sbe-wrap,.sbe-wrap *,.sbe-drawer *,.sbe-scrim){animation:none;transition:none}',
    '@media (prefers-reduced-motion:reduce){.sbe-drawer{transform:translate(-50%,0);transition:none}.sbe-wrap,.sbe-wrap *,.sbe-drawer *,.sbe-scrim{animation:none;transition:none}}',
    // Touch: a tab, a quiet word and a chip are tall enough for a thumb.
    '@media (pointer:coarse){.sbe-way,.sbe-word{min-height:44px}.sbe-seg label>span,.sbe-fchip{min-height:36px}.sbe-seg,.sbe-chip-row,.sbe-chip-set,.sbe-bk-lim{gap:8px}.sbe-icon{width:44px;height:44px}}',
    // On a phone the creature's list sits above the library, and the drawer's filters scroll sideways. The panels never do: their chips wrap, each label above its own.
    '@media (max-width:760px){.sbe-dr-b{grid-template-columns:minmax(0,1fr)}.sbe-dr-drop{order:-1;position:static}.sbe-dr-lib{grid-template-columns:minmax(0,1fr)}.sbe-drawer .sbe-chip-row{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px}.sbe-drawer .sbe-fchip{flex:none}.sbe-dr-drop ul{flex-direction:row;flex-wrap:wrap}}',
    // On wide screens the bar with Save stays in view while the form scrolls.
    '@media (min-width:901px){.sbe-bar{position:sticky;top:0;z-index:5;margin:-16px -18px 0;padding:12px 18px;background:var(--color-card-bg,#fff);border-bottom:var(--shape-rule,1px) solid var(--color-border,#e5e7eb);border-radius:var(--shape-r-panel,12px) var(--shape-r-panel,12px) 0 0}}',
    '@media (max-width:900px){.sbe-wrap{grid-template-columns:minmax(0,1fr)}.sbe-side{position:static}}',
    '@media (max-width:640px){.sbe{padding:14px 16px}.sbe-g4,.sbe-g3{grid-template-columns:repeat(2,minmax(0,1fr))}.sbe-g7{grid-template-columns:repeat(4,minmax(0,1fr))}.sbe-pics{grid-template-columns:1fr}.sbe-seg label>span,.sbe-fchip{min-height:36px}.sbe-seg,.sbe-chip-row,.sbe-chip-set,.sbe-bk-lim{gap:8px}.sbe-bk .sbe-chip-row{flex-direction:column;align-items:stretch;gap:4px}.sbe-bk-k{width:auto;padding-top:0}.sbe-bk-row>p{flex:1 1 100%}.sbe-bk-row>.sbe-sp{display:none}.sbe-bk-it{grid-template-columns:20px minmax(0,1fr)}.sbe-bk-it>.sbe-tag:last-child{display:none}}'
  ].join('\n');

  function injectStyles(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.head || d.querySelector('style[data-ds-builder]')) return;
    var s = d.createElement('style');
    s.setAttribute('data-ds-builder', 'true');
    s.textContent = CSS;
    d.head.appendChild(s);
  }

  var api = {
    ORGS: ORGS, ROLES: ROLES, SIZES: SIZES, ABILITY_TYPES: ABILITY_TYPES, FIGURES: FIGURES,
    STANDING_LINE: STANDING_LINE,
    newState: newState, derive: derive, setFigure: setFigure, useFormula: useFormula,
    startFrom: startFrom, checks: checks, budget: budget, toSave: toSave, roundTrip: roundTrip, autoTier: autoTier, isStrike: isStrike,
    editorHtml: editorHtml, sideHtml: sideHtml, applyField: applyField, newAbility: newAbility, save: save,
    applySuggestion: applySuggestion, withoutDamage: withoutDamage, generate: generate, fits: fits, fromLibrary: fromLibrary, KINDS: KINDS, mount: mount,
    usable: usable, libraryRows: libraryRows, shapeAbility: shapeAbility, addFromLibrary: addFromLibrary, restore: restore, moveItem: moveItem, removeItem: removeItem, addVillain: addVillain, applyAbility: applyAbility,
    openAbilityDrawer: openAbilityDrawer, drawerCard: drawerCard, drawerMine: drawerMine, DTYPES: DTYPES, RIDERS: RIDERS, openStartFrom: openStartFrom, injectStyles: injectStyles, CSS: CSS,
    vocabulary: vocabulary, guideFor: guideFor, readAnswer: readAnswer, fromAI: fromAI, keepKnownRefs: keepKnownRefs, clearAIMarks: clearAIMarks,
    setCharacteristics: setCharacteristics, partyLine: partyLine, aiHtml: aiHtml, aiNotesHtml: aiNotesHtml, AI_EXAMPLE: AI_EXAMPLE,
    BOOK_LIMITS: BOOK_LIMITS, newBookFilter: newBookFilter, bookGroup: bookGroup, inflicts: inflicts, shortlist: shortlist, shortCounts: shortCounts, bookLine: bookLine,
    bookPicks: bookPicks, bookFiltersHtml: bookFiltersHtml, bookListHtml: bookListHtml, bookCountText: bookCountText,
    picProblem: picProblem, newPics: newPics, picsHtml: picsHtml
  };
  return api;
})();

// The placeable widget: the same editor wherever a layout puts it. On a
// Creature page whose panel already shows the stat block it steps aside, so the
// page never carries two editors for one creature; with no page it builds a
// new creature, which saving creates.
if (typeof Chronicle !== 'undefined' && Chronicle && Chronicle.register) {
  Chronicle.register('monster-builder', {
    init: function (el, config) {
      var cfg = config || {};
      var cid = cfg.campaignId ? String(cfg.campaignId) : '';
      var eid = cfg.entityId ? String(cfg.entityId) : '';
      var S = (typeof DrawSteelStatblock !== 'undefined') ? DrawSteelStatblock : null;
      if (!S) { el.textContent = 'The Draw Steel stat block did not load. Reload the page to try again.'; return; }
      if (eid && el.ownerDocument.querySelector('[data-ds-statblock-entity="' + eid.replace(/"/g, '') + '"]')) {
        el.innerHTML = '<p class="sbe-hint">This creature’s stat block is at the top of the page. Use Edit stat block there.</p>';
        return;
      }
      var load = eid && cid
        ? S.getJSON('/api/v1/campaigns/' + encodeURIComponent(cid) + '/entities/' + encodeURIComponent(eid))
        : Promise.resolve(null);
      var ref = (typeof DrawSteelRefRenderer !== 'undefined' && cid) ? new DrawSteelRefRenderer('', cid) : null;
      var glossary = ref ? ref.load().catch(function () { return null; }) : null;
      el._dsGone = false;
      Promise.all([load, S.loadRefs(cid), glossary]).then(function (r) {
        if (el._dsGone) return;
        if (ref && ref.injectStyles) ref.injectStyles();
        el._dsEditor = DrawSteelCreatureEditor.mount(el, {
          campaignId: cid, entityId: eid, entity: r[0], refs: r[1], ref: ref
        });
      }, function () {
        // An existing creature that didn't load is never opened as a new one:
        // saving that would create a second copy.
        if (!el._dsGone) el.textContent = 'This creature could not be loaded. Reload the page to try again.';
      });
    },
    destroy: function (el) {
      el._dsGone = true;
      if (el._dsEditor) el._dsEditor.destroy();
      el._dsEditor = null;
      el.innerHTML = '';
    }
  });
}

// Test seam: inert in a browser (no CommonJS module).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrawSteelCreatureEditor;
}
