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
  function newState(name, src, refs) {
    var S = SB();
    var c = S.normalize(src || {});
    if (c.level === null) c.level = 1;
    var st = { name: name || c.name || '', aiName: false, c: c, own: {}, origin: null, editAb: null, refs: refs || { orgs: [], roles: [] }, base: {} };
    // Chronicle replaces a page's fields wholesale on save, so fields this
    // editor doesn't own are carried through untouched.
    if (src && typeof src === 'object' && !Array.isArray(src)) Object.keys(src).forEach(function (k) { st.base[k] = src[k]; });
    var pr = S.provenance(c, st.refs);
    ['ev', 'stamina', 'free_strike'].forEach(function (k) {
      var stored = k === 'free_strike' ? S.freeStrikeNumber(c.free_strike) : c[k];
      if (stored !== null && pr[k] && pr[k].state !== 'formula') st.own[k] = true;
    });
    if (c.winded !== null && c.stamina !== null && c.winded !== Math.floor(c.stamina / 2)) st.own.winded = true;
    derive(st);
    return st;
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
    if (!st.own.ev && pr.ev.value !== null) c.ev = pr.ev.value;
    if (!st.own.stamina && pr.stamina.value !== null) c.stamina = pr.stamina.value;
    if (!st.own.free_strike && pr.free_strike.value !== null) c.free_strike = pr.free_strike.value + ' damage';
    if (!st.own.winded) c.winded = c.stamina === null ? null : Math.floor(c.stamina / 2);
    var hc = pr.hc.value;
    var d = pr.damage.value;
    c.abilities.forEach(function (a) {
      if (!a.auto_damage || !d) return;
      var add = (isStrike(a) && hc !== null) ? hc : 0;
      if (hc !== null) a.power_roll = '2d10 + ' + hc;
      a.tier1 = autoTier(a.tier1, d.tier1 + add);
      a.tier2 = autoTier(a.tier2, d.tier2 + add);
      a.tier3 = autoTier(a.tier3, d.tier3 + add);
    });
    var E = Engine();
    pr.vaCount = (E && org) ? E.villainActionCount(org) : (org ? Number(org.villain_action_count) || 0 : 0);
    st.pr = pr;
    return st;
  }

  // setFigure records a figure the director typed. An empty box hands it back
  // to the formula.
  function setFigure(st, key, raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (v === '') { delete st.own[key]; return derive(st); }
    st.own[key] = true;
    if (key === 'free_strike') st.c.free_strike = /^-?\d+$/.test(v) ? v + ' damage' : v;
    else st.c[key] = isFinite(Number(v)) ? Number(v) : st.c[key];
    return derive(st);
  }

  function useFormula(st, key) { delete st.own[key]; return derive(st); }

  // startFrom copies another creature's stat block into this one. Figures and
  // formula-shaped damage are worked out again for the level kept here, so a
  // copy never carries the source's numbers at the wrong level.
  function startFrom(st, srcName, src, origin) {
    var S = SB();
    var c = S.normalize(src || {});
    if (c.level === null) c.level = st.c.level || 1;
    c.abilities.forEach(function (a) {
      if ([a.tier1, a.tier2, a.tier3].every(function (t) { return !t || /^\s*\d+\s+damage/i.test(String(t)); }) && (a.tier1 || a.tier2 || a.tier3)) a.auto_damage = true;
    });
    st.c = c;
    st.own = {};
    st.origin = origin || null;
    st.name = srcName ? srcName + ' (copy)' : st.name;
    st.aiName = false;
    st.editAb = null;
    return derive(st);
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
    if (pr.vaCount) row(c.villain_actions.filter(function (v) { return v.name && String(v.name).trim(); }).length === pr.vaCount, 'Has ' + pr.vaCount + ' villain actions');
    row(c.ev !== null, 'Has an encounter value');
    row(c.stamina !== null, 'Has Stamina');
    row(!!String(c.free_strike || '').trim(), 'Has a free strike');
    ['ev', 'stamina'].forEach(function (k) {
      var r = pr[k];
      if (st.own[k] && r && r.sourced && r.value !== null && c[k] !== r.value) {
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
    a.auto_damage = DAMAGE_TIER.test(a.tier1);
    return a;
  }

  function pick(list, seed) { return list.length ? list[seed % list.length] : null; }
  function bySlug(lib, s) { for (var i = 0; i < lib.length; i++) if (lib[i].slug === s) return lib[i]; return null; }
  // Abilities made only for some organizations come first: they are what
  // makes a minion read as a minion and a solo as a solo.
  function specific(t) { return listProp(props(t).organizations).length < 6; }

  // setCharacteristics gives the creature its role's published spread, with
  // the main one at the published highest characteristic and none above it.
  // Returns the reason to show, or '' when the level has no published value.
  function setCharacteristics(st) {
    var S = SB(), c = st.c, hc = st.pr.hc.value, rt = st.pr.role;
    if (hc === null) return '';
    if (rt && rt.characteristics) {
      S.CHARS.forEach(function (k) { var v = Number(rt.characteristics[k]) || 0; c[k] = k === rt.primary_stat ? hc : Math.min(v, hc - 1); });
      return 'Characteristics: the published ' + c.role + ' spread, with ' + cap(rt.primary_stat) + ' at ' + S.signed(hc) + ', the published highest for this level.';
    }
    c.might = hc;
    return 'Characteristics: Might at ' + S.signed(hc) + ', the published highest for this level. The rest are yours to set.';
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
    st.c = c; st.own = {}; st.editAb = null; st.origin = null; st.aiName = false;
    st.name = what ? what.replace(/\b\w/g, function (x) { return x.toUpperCase(); }) : (noRole(org) ? (org === 'leader' ? 'Warband Captain' : 'Lone Terror') : cap(role) + ' ' + cap(org));
    derive(st);

    var hc = st.pr.hc.value;
    var chWhy = setCharacteristics(st);
    if (chWhy) why.push(chWhy);

    var usable = (lib || []).filter(function (t) { return fits(t, org, role); });
    var themed = [];
    themes.forEach(function (t) { t[2].forEach(function (x) { var a = bySlug(usable, x); if (a && themed.indexOf(a) < 0) themed.push(a); }); });
    var isType = function (types) { return function (t) { return types.indexOf(props(t).type) >= 0; }; };
    var dealsDamage = function (t) { return DAMAGE_TIER.test(props(t).tier1 || ''); };
    var sigs = usable.filter(isType(['signature'])).filter(dealsDamage);
    var sigPool = sigs.filter(specific).concat(themed.filter(isType(['signature'])).filter(dealsDamage), sigs.filter(function (t) { return !specific(t); }))
      .filter(function (t, i, a) { return a.indexOf(t) === i; });
    var sig = pick(sigPool, n);
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
    add(pick(usable.filter(extras).filter(specific), n));
    if (org !== 'minion') {
      // Abilities any role can take (a breath weapon) come only from the theme.
      var forRole = function (t) { return !specific(t) && listProp(props(t).roles).length < ROLES.length; };
      var more = themed.filter(extras).concat(usable.filter(extras).filter(forRole))
        .filter(function (t) { return chosen.indexOf(t) < 0; });
      add(pick(more, n));
    }
    if (noRole(org)) {
      // The narrowest first: a solo's own villain actions before shared ones.
      var vas = usable.filter(isType(['villain-action'])).sort(function (a, b) { return listProp(props(a).organizations).length - listProp(props(b).organizations).length; });
      VA_SLOTS.forEach(function (slot, k) {
        var left = vas.filter(function (t) { return chosen.indexOf(t) < 0; });
        var v = pick(left, n + k);
        if (!v) return;
        chosen.push(v);
        var a = fromLibrary(v);
        a.order = slot;
        delete a.type;
        c.villain_actions.push(a);
      });
    }
    derive(st);
    // Every power roll is 2d10 plus the published highest characteristic, and
    // a villain action's damage is set once from the same formula as an
    // ability's; derive() rescales only abilities.
    var d = st.pr.damage.value;
    c.abilities.concat(c.villain_actions).forEach(function (a) { if ((a.tier1 || a.tier2 || a.tier3) && hc !== null) a.power_roll = '2d10 + ' + hc; });
    c.villain_actions.forEach(function (a) {
      if (a.auto_damage && d) ['tier1', 'tier2', 'tier3'].forEach(function (k) { a[k] = autoTier(a[k], d[k]); });
      delete a.auto_damage;
    });
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
      movement: terms('movement'),
      damageTypes: DTYPES.slice()
    };
  }

  function quoted(list) { return list.map(function (x) { return '"' + x + '"'; }).join(', '); }

  // guideFor is the text the director copies into an AI chat: the creature,
  // the party, the exact answer shape and every option it can pick from.
  function guideFor(desc, party, v) {
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
      '  "villain_actions": [{ "name": "…", "distance": "…", "target": "…", "effect": "…" }] (exactly three, for a leader or solo only)',
      '}',
      '',
      'Do not give encounter value, Stamina, free strike, characteristics or damage numbers. Chronicle works those out from the published Monster Basics formulas.'
    ];
    if (v.creatureKeywords.length) lines.push('', 'Creature keywords: ' + v.creatureKeywords.join(', '));
    if (v.abilityKeywords.length) lines.push('Ability keywords: ' + v.abilityKeywords.join(', '));
    lines.push('Damage types: ' + v.damageTypes.join(', '));
    if (v.conditions.length) lines.push('', 'Mark conditions as {@condition name}, one of: ' + v.conditions.join(', '));
    if (v.durations.length) lines.push('Mark durations as {@duration name}, one of: ' + v.durations.join(', '));
    if (v.movement.length) lines.push('Mark forced movement as {@movement name}, one of: ' + v.movement.join(', '));
    return lines.join('\n');
  }

  // readAnswer finds the JSON in a pasted answer. An answer still being
  // pasted is read up to its last complete value, so the editor fills in as
  // it arrives. Returns { obj, done } or { err, wait }.
  function readAnswer(text) {
    var s = String(text || '').replace(/```(?:json)?/gi, ''), a = s.indexOf('{');
    if (a < 0) return { err: 'No creature in it yet. The answer should hold a { … } block.' };
    s = s.slice(a);
    var b = s.lastIndexOf('}');
    if (b >= 0) { try { return { obj: JSON.parse(s.slice(0, b + 1)), done: true }; } catch (e) { /* still arriving, or broken */ } }
    var stack = [], inS = false, bs = false, cut = -1, snap = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inS) { if (bs) bs = false; else if (ch === '\\') bs = true; else if (ch === '"') inS = false; continue; }
      if (ch === '"') inS = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
      else if (ch === ',' && stack.length) { cut = i; snap = stack.slice(); }
    }
    if (cut < 0) return { err: 'Reading…', wait: true };
    try { return { obj: JSON.parse(s.slice(0, cut) + snap.reverse().map(function (x) { return x === '{' ? '}' : ']'; }).join('')), done: false }; }
    catch (e) { return { err: 'That isn’t a creature the editor can read. Ask the AI for only the JSON, then paste it again.' }; }
  }

  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max || 2000) : ''; }
  function strList(v) { return Array.isArray(v) ? v.map(function (x) { return str(x, 60); }).filter(Boolean) : (str(v) ? SB().parseList(str(v)) : []); }

  // keepKnownRefs turns reference markup the glossary doesn't know into its
  // plain words, so a made-up term never becomes a broken hover card.
  function keepKnownRefs(text, v) {
    var known = { condition: v.conditions, duration: v.durations, movement: v.movement };
    return String(text || '').replace(/\{@(\w+) ([^}|]+)(\|[^}]+)?\}/g, function (m, cat, term, shown) {
      var list = known[cat], t = String(term).trim().toLowerCase().replace(/\s+/g, '-');
      if (!list || !list.length) return m;
      if (list.indexOf(t) >= 0) return '{@' + cat + ' ' + t + (shown || '') + '}';
      return shown ? shown.slice(1) : term;
    });
  }

  // fromAI fills the editor from the AI's answer and returns the notes on
  // what was dropped or changed. Words it wrote carry from_ai until saved.
  function fromAI(st, o, v) {
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
    var kws = strList(o.keywords);
    if (kws.length) c.keywords = kws;
    if (o.size != null) { if (v.sizes.indexOf(String(o.size)) >= 0) c.size = String(o.size); else notes.push('Size “' + o.size + '” is not one Draw Steel uses, so it stays ' + c.size + '.'); }
    if (o.speed != null && isFinite(Number(o.speed))) c.speed = Math.max(0, Math.min(20, Math.round(Number(o.speed))));
    if (o.stability != null && isFinite(Number(o.stability))) c.stability = Math.max(0, Math.min(10, Math.round(Number(o.stability))));
    if (Array.isArray(o.traits)) c.traits = o.traits.filter(function (t) { return t && str(t.name); }).slice(0, 20).map(function (t) { return { name: str(t.name, 200), description: keepKnownRefs(str(t.effect || t.description), v), from_ai: true }; });
    derive(st);
    var chWhy = setCharacteristics(st);
    if (chWhy) notes.push(chWhy);
    derive(st);

    var d = st.pr.damage.value, hc = st.pr.hc.value, droppedDamage = false;
    // An ability's tiers: the formula's damage (in the AI's damage type) and
    // whatever else the AI said happens on that tier, minus any number of its own.
    function tiers(a, src, dealsDamage) {
      var te = Array.isArray(src.tier_effects) ? src.tier_effects : [];
      var dtype = str(src.damage_type).toLowerCase();
      if (dtype && DTYPES.indexOf(dtype) < 0) { notes.push('“' + src.damage_type + '” is not a Draw Steel damage type, so ' + a.name + ' deals untyped damage.'); dtype = ''; }
      ['tier1', 'tier2', 'tier3'].forEach(function (k, i) {
        var extra = keepKnownRefs(str(te[i], 500), v);
        if (/^\s*\d+(\s+[a-z]+)?\s+damage/i.test(extra)) { droppedDamage = true; extra = extra.replace(/^\s*\d+(\s+[a-z]+)?\s+damage\s*;?\s*/i, ''); }
        if (dealsDamage && d) {
          var add = (isStrike(a) && hc !== null) ? hc : 0;
          a[k] = (d[k] + add) + (dtype ? ' ' + dtype : '') + ' damage' + (extra ? '; ' + extra : '');
        } else a[k] = extra;
      });
      a.auto_damage = !!(dealsDamage && d);
      if ((a.tier1 || a.tier2 || a.tier3) && hc !== null) a.power_roll = '2d10 + ' + hc;
    }
    var sg = o.signature;
    if (sg && typeof sg === 'object' && str(sg.name)) {
      var ranged = /ranged/i.test(str(sg.distance) + ' ' + str(sg.kind));
      var a = { name: str(sg.name, 200), type: 'signature', keywords: strList(sg.keywords), distance: str(sg.distance, 80) || (ranged ? 'Ranged 10' : 'Melee 1'), target: str(sg.target, 120) || 'One creature or object', trigger: '', effect: keepKnownRefs(str(sg.effect), v), from_ai: true };
      if (!a.keywords.length) a.keywords = ranged ? ['Ranged', 'Strike', 'Weapon'] : ['Melee', 'Strike', 'Weapon'];
      tiers(a, sg, true);
      c.abilities.push(a);
    }
    if (Array.isArray(o.abilities)) {
      o.abilities.filter(function (x) { return x && str(x.name); }).slice(0, 20).forEach(function (x) {
        var t = /trigger/i.test(str(x.type)) ? 'triggered' : /maneuver/i.test(str(x.type)) ? 'maneuver' : 'action';
        var a = { name: str(x.name, 200), type: t, keywords: strList(x.keywords), distance: str(x.distance, 80), target: str(x.target, 120), trigger: keepKnownRefs(str(x.trigger), v), effect: keepKnownRefs(str(x.effect), v), from_ai: true };
        tiers(a, x, x.deals_damage === true);
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
    if (droppedDamage) notes.push('The AI put damage numbers in its abilities. They were dropped; the damage comes from the published formula.');
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
    st.origin = 'From the AI: its name, keywords, traits and abilities are marked until you save. Check them first. Every number is the published formula’s.';
    return notes;
  }

  // clearAIMarks drops the "From the AI" marks once the director has saved.
  function clearAIMarks(st) {
    var had = !!st.aiName;
    st.aiName = false;
    st.c.abilities.concat(st.c.traits, st.c.villain_actions).forEach(function (a) { if (a.from_ai) had = true; delete a.from_ai; });
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
    return '<div class="sbe-fold-in"><section class="sbe-gen" aria-labelledby="sbe-ai-t"><div class="sbe-gen-h"><h4 id="sbe-ai-t">Build with an AI</h4>' +
      '<span class="sbe-small sbe-dim">Works with any AI chat. Nothing runs inside Chronicle.</span><span class="sbe-sp"></span>' +
      '<button type="button" class="btn-ghost btn-sm" data-sbe-act="ai">Close</button></div>' +
      '<ol class="sbe-steps"><li><label class="sbe-f"><span class="sbe-lbl">1 · Describe it</span>' +
      '<textarea class="input" rows="2" id="sbe-ai-desc" data-sbe-ai="desc" maxlength="1000" placeholder="A goblin spider rider who leads a raiding band and webs heroes to the walls"></textarea></label>' +
      '<div class="sbe-gen-go"><button type="button" class="btn-primary btn-sm" id="sbe-ai-copy" data-sbe-act="ai-copy" disabled>Reading the option lists…</button>' +
      '<span class="sbe-small sbe-dim" id="sbe-ai-copied" role="status">Paste it into ChatGPT, Claude or any AI chat.</span></div>' +
      '<details class="sbe-peek"><summary>See what the guide says</summary><textarea class="input" rows="9" id="sbe-ai-guide" readonly aria-label="The guide for the AI"></textarea></details></li>' +
      '<li><label class="sbe-f"><span class="sbe-lbl">2 · Paste the AI’s answer</span>' +
      '<textarea class="input" rows="5" id="sbe-ai-ans" data-sbe-ai="ans" placeholder="Paste the whole answer. The editor fills in as it is read."></textarea></label>' +
      '<div class="sbe-gen-go"><button type="button" class="btn-secondary btn-sm" id="sbe-ai-ex" data-sbe-act="ai-example">Try an example answer</button>' +
      '<span class="sbe-small" id="sbe-ai-status" role="status" aria-live="polite"></span></div></li></ol>' +
      '<div id="sbe-ai-notes"></div></section></div>';
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
    var o = opt || {}, a = fromLibrary(t), pr = st.pr, d = pr.damage.value, hc = pr.hc.value;
    if (a.auto_damage && d) {
      var add = (isStrike(a) && hc !== null) ? hc : 0;
      ['tier1', 'tier2', 'tier3'].forEach(function (k) { a[k] = autoTier(a[k], d[k] + add); });
    }
    if ((a.tier1 || a.tier2 || a.tier3) && hc !== null) a.power_roll = '2d10 + ' + hc;
    if (o.dtype && DTYPES.indexOf(o.dtype) >= 0 && a.auto_damage) {
      ['tier1', 'tier2', 'tier3'].forEach(function (k) { if (a[k]) a[k] = String(a[k]).replace(/^(\s*\d+)(?:\s+[a-z]+)?(\s+damage)/i, '$1 ' + o.dtype + '$2'); });
    }
    var r = RIDERS.filter(function (x) { return x[0] && x[0] === o.rider; })[0];
    if (r && a.tier1) r[2].forEach(function (k) { a[k] = a[k] ? a[k] + '; ' + r[1] : r[1]; });
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
      a.order = VA_SLOTS[c.villain_actions.length];
      delete a.type;
      delete a.auto_damage;
      c.villain_actions.push(a);
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
    if (kind === 'v') list.forEach(function (v, i) { v.order = VA_SLOTS[i] || v.order; });
    st.editAb = null;
    return true;
  }

  // toSave is what saving writes: the entity's fields and the name.
  function toSave(st) {
    var S = SB();
    var c = clone(st.c);
    c.abilities = c.abilities.slice(0, 50);
    c.traits = (c.traits || []).filter(function (t) { return t.name || t.description; });
    c.level = Math.max(1, Math.min(20, Number(c.level) || 1));
    // "From the AI" marks the editor's own review state, never the page.
    c.abilities.concat(c.traits, c.villain_actions || []).forEach(function (a) { delete a.from_ai; });
    var fields = {}, own = S.toFields(c);
    Object.keys(st.base || {}).forEach(function (k) { fields[k] = st.base[k]; });
    Object.keys(own).forEach(function (k) { fields[k] = own[k]; });
    return { name: String(st.name || '').trim().slice(0, 200), fields: fields };
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function esc(s) { return SB().esc(s); }
  function cap(s) { return SB().cap(s); }

  function options(list, v, label) {
    var cur = String(v == null ? '' : v).toLowerCase();
    return list.map(function (x) {
      var val = Array.isArray(x) ? x[0] : x, text = Array.isArray(x) ? x[1] : (label ? label(x) : cap(x));
      return '<option value="' + esc(val) + '"' + (String(val).toLowerCase() === cur ? ' selected' : '') + '>' + esc(text) + '</option>';
    }).join('');
  }

  // chip says where a figure came from, under its box.
  function chip(st, key, r, what) {
    if (st.own[key]) {
      var also = (r && r.sourced && r.value !== null) ? ' (the formula gives ' + r.value + ')' : '';
      return '<span class="sbe-chip is-own">Changed by you' + esc(also) + ' · <button type="button" class="sbe-link" data-sbe-reset="' + key + '">Use the formula</button></span>';
    }
    if (r && r.sourced && r.value !== null) {
      return '<span class="sbe-chip is-pub" title="' + esc(r.source || '') + '"><i class="fa-solid fa-check" aria-hidden="true"></i> Published formula</span>';
    }
    return '<span class="sbe-chip is-none"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i> No published ' + esc(what) + ' for this creature. Set it yourself.</span>';
  }

  function figureBox(st, key, label, r, what) {
    var v = key === 'free_strike' ? SB().freeStrikeNumber(st.c.free_strike) : st.c[key];
    if (key === 'free_strike' && v === null) v = st.c.free_strike;
    return '<label class="sbe-f"><span class="sbe-lbl">' + label + '</span>' +
      '<input class="input sbe-num" id="sbe-fig-' + key + '" data-sbe-fig="' + key + '" inputmode="numeric" value="' + esc(v == null ? '' : v) + '" placeholder="—">' +
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

  // The editor draws in two parts around the Build with an AI panel, which
  // is kept across redraws (see aiHtml).
  function editorHtml(st, ui) { return editorHead(st, ui) + editorBody(st, ui); }

  function editorHead(st, ui) {
    return '<div class="sbe-bar"><span class="sbe-bar-t"><i class="fa-solid fa-pen" aria-hidden="true"></i> ' + (ui.isNew ? 'New stat block' : 'Editing stat block') + '</span>' +
      '<span class="sbe-sp"></span>' +
      (ui.onClose ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="cancel">Cancel</button>' : '') +
      '<button type="button" class="btn-primary btn-sm" data-sbe-act="save"' + (ui.saving ? ' disabled' : '') + '>' + (ui.saving ? 'Saving…' : 'Save') + '</button></div>' +
      startHtml(st, ui);
  }

  function editorBody(st, ui) {
    var c = st.c, pr = st.pr;
    var noRole = c.organization === 'leader' || c.organization === 'solo';
    var h = '<p class="sbe-msg' + (ui.msgKind ? ' is-' + ui.msgKind : '') + '" role="status" aria-live="polite">' + esc(ui.msg || '') + '</p>';
    if (st.origin) h += '<p class="sbe-origin"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(st.origin) + '</p>';
    h += '<div class="sbe-grid sbe-g4">' +
      (st.aiName
        ? '<label class="sbe-f sbe-wide"><span class="sbe-lbl">Name</span><input class="input" id="sbe-name" value="' + esc(st.name || '') + '" data-sbe-k="name" maxlength="200">' + '<span class="sbe-chip is-ai"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> From the AI</span>' + '</label>'
        : field('sbe-name', 'Name', st.name, 'data-sbe-k="name" maxlength="200"', true)) +
      '<label class="sbe-f"><span class="sbe-lbl">Level</span><input class="input sbe-num" id="sbe-level" data-sbe-k="level" type="number" min="1" max="20" value="' + esc(c.level) + '"></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Size</span><select class="input" id="sbe-size" data-sbe-k="size">' + options(SIZES, c.size) + '</select></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Organization</span><select class="input" id="sbe-org" data-sbe-k="organization"><option value="">Choose…</option>' + options(ORGS, c.organization) + '</select></label>' +
      '<label class="sbe-f"><span class="sbe-lbl">Role</span><select class="input" id="sbe-role" data-sbe-k="role"' + (noRole ? ' disabled' : '') + '><option value="">Choose…</option>' + options(ROLES, c.role) + '</select>' +
      (noRole ? '<span class="sbe-hint">' + esc(cap(c.organization)) + 's have no role. Their own row in the published table stands in for one.</span>' : '') + '</label>' +
      field('sbe-keywords', 'Keywords', c.keywords.join(', '), 'data-sbe-k="keywords" placeholder="Humanoid, Goblin"', true) +
      field('sbe-faction', 'Faction', c.faction, 'data-sbe-k="faction"', true) +
      field('sbe-immunities', 'Immunities', c.immunities.join(', '), 'data-sbe-k="immunities" placeholder="Fire 5, poison"', true) + '</div>';
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
      ? 'At level ' + esc(c.level) + (c.organization ? ', a ' + esc(c.organization) : ', this creature') + '’s highest characteristic is ' + SB().signed(pr.hc.value) + ' (published). Strikes add it to every tier, and so does its power roll.'
      : 'Set a level to see the published highest characteristic.') + '</p>';
    h += '<h4 class="sbe-h">Traits <button type="button" class="btn-ghost btn-sm" data-sbe-act="add-trait"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Add trait</button></h4>' +
      '<div class="sbe-abs">' + listHtml(st, 't', ui) + '</div>';
    h += '<h4 class="sbe-h">Abilities <span class="sbe-h-acts"><button type="button" class="btn-secondary btn-sm" id="sbe-add-abs" data-sbe-act="drawer"><i class="fa-solid fa-book-open mr-1" aria-hidden="true"></i> Add abilities</button>' +
      '<button type="button" class="btn-ghost btn-sm" data-sbe-act="add-ab"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Write your own</button></span></h4>' +
      '<div class="sbe-abs">' + (c.abilities.length ? listHtml(st, 'a', ui) : '<p class="sbe-hint">No abilities yet. Every creature needs a signature ability.</p>') + '</div>';
    if (pr.vaCount || c.villain_actions.length) {
      h += '<h4 class="sbe-h">Villain actions <span class="sbe-hint">' + (pr.vaCount ? esc(cap(c.organization)) + 's get ' + pr.vaCount + ', used once each, in order' : 'This organization has no villain actions') + '</span>' +
        (c.villain_actions.length < 3 ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="add-va"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Add villain action</button>' : '') + '</h4>' +
        '<div class="sbe-abs">' + listHtml(st, 'v', ui) + '</div>';
    }
    return h;
  }

  // startHtml is the row of ways to begin, and the Generate panel that folds
  // open under it. The panel's open state lives on ui.gen so a redraw keeps it.
  function startHtml(st, ui) {
    var g = ui.gen || {}, open = !!g.open;
    var h = '<div class="sbe-start"><button type="button" class="btn-primary btn-sm" data-sbe-act="gen" aria-expanded="' + open + '" aria-controls="sbe-gen">' +
      '<i class="fa-solid fa-wand-magic-sparkles mr-1" aria-hidden="true"></i> Generate one</button>' +
      '<button type="button" class="btn-secondary btn-sm" id="sbe-ai-open" data-sbe-act="ai" aria-expanded="' + !!(ui.ai && ui.ai.open) + '" aria-controls="sbe-ai">' +
      '<i class="fa-solid fa-comments mr-1" aria-hidden="true"></i> Build with an AI</button>' +
      '<button type="button" class="btn-secondary btn-sm" data-sbe-act="blank">Blank</button>' +
      '<button type="button" class="btn-secondary btn-sm" data-sbe-act="start"><i class="fa-solid fa-copy mr-1" aria-hidden="true"></i> or from a creature…</button></div>';
    return h + '<div class="sbe-fold' + (open ? ' is-open' : '') + '" id="sbe-gen"' + (open ? '' : ' inert') + '><div class="sbe-fold-in">' + genHtml(st, ui) + '</div></div>';
  }

  function genHtml(st, ui) {
    var g = ui.gen || {}, prof = ui.party && ui.party.profile;
    var kind = g.kind || 'party';
    var org = kind === 'party' ? null : SB().findBySlug(st.refs.orgs, kind);
    var hint = kind === 'party'
      ? (prof ? 'Picks the organization and role that suit your ' + ui.party.heroes.length + ' heroes.' : 'No hero pages were read, so this makes a platoon brute unless you pick a role.')
      : ((org && org.description) || '') + (org && Number(org.villain_action_count) ? ' Gets ' + Number(org.villain_action_count) + ' villain actions.' : '');
    var h = '<section class="sbe-gen" aria-labelledby="sbe-gen-t"><div class="sbe-gen-h"><h4 id="sbe-gen-t">Generate a creature</h4>' +
      '<span class="sbe-small sbe-dim">No AI needed: the package’s ability library and the published formulas.</span><span class="sbe-sp"></span>' +
      '<button type="button" class="btn-ghost btn-sm" data-sbe-act="gen">Close</button></div>' +
      '<label class="sbe-f"><span class="sbe-lbl">What is it? (optional)</span><input class="input" id="sbe-g-what" data-sbe-g="what" maxlength="200" autocomplete="off" placeholder="Goblin spider rider" value="' + esc(g.what || '') + '">' +
      '<span class="sbe-hint">Becomes the name. Words like spider, dragon, ghost or wolf also pick keywords and fitting abilities.</span></label>' +
      '<div class="sbe-f"><span class="sbe-lbl" id="sbe-g-kind-l">What kind of creature</span><div class="sbe-seg" role="radiogroup" aria-labelledby="sbe-g-kind-l">' +
      KINDS.map(function (k) {
        return '<label><input type="radio" name="sbe-g-kind" id="sbe-g-kind-' + k + '" data-sbe-g="kind" value="' + k + '"' + (k === kind ? ' checked' : '') + '><span>' + (k === 'party' ? 'Fit my party' : cap(k)) + '</span></label>';
      }).join('') + '</div><span class="sbe-hint">' + esc(hint) + '</span></div>' +
      '<div class="sbe-gen-row"><label class="sbe-f"><span class="sbe-lbl">Level</span><select class="input" id="sbe-g-level" data-sbe-g="level">' +
      options([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (l) { return [String(l), String(l)]; }), g.level || 1) + '</select></label>';
    if (!noRole(kind)) {
      h += '<label class="sbe-f"><span class="sbe-lbl">Role</span><select class="input" id="sbe-g-role" data-sbe-g="role"><option value="">' + (prof ? 'Best for my party' : 'Pick one for me') + '</option>' + options(ROLES, g.role) + '</select></label>';
    }
    h += '</div><div class="sbe-gen-go"><button type="button" class="btn-primary btn-sm" id="sbe-g-go" data-sbe-act="gen-go"' + (g.loading ? ' disabled' : '') + '>' + (g.loading ? 'Reading the ability library…' : 'Generate') + '</button>' +
      (g.why ? '<button type="button" class="btn-secondary btn-sm" id="sbe-g-again" data-sbe-act="gen-again">Try other abilities</button>' : '') +
      '<span class="sbe-small sbe-dim">It fills the editor below. Change anything, then Save.</span></div>';
    if (g.why) h += '<ul class="sbe-why">' + g.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    return h + '</section>';
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
    if (k === 'name') { st.name = v; return; }
    if (k === 'keywords' || k === 'immunities') { st.c[k] = S.parseList(v); return; }
    if (k === 'faction' || k === 'size') { st.c[k] = v; return; }
    if (k === 'organization' || k === 'role') { st.c[k] = String(v || '').toLowerCase(); return; }
    var n = String(v).trim() === '' ? null : Number(v);
    st.c[k] = (n === null || !isFinite(n)) ? null : n;
    if (k === 'level' && (st.c.level === null || st.c.level < 1)) st.c.level = 1;
  }

  // applyAbility writes one box of the ability being edited.
  function applyAbility(st, k, v) {
    var key = st.editAb;
    if (!key) return;
    var a = listOf(st, key.charAt(0))[Number(key.slice(1))];
    if (!a) return;
    if (k === 'keywords') a.keywords = SB().parseList(v);
    else if (k === 'auto_damage') a.auto_damage = !!v;
    else a[k] = v;
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

  // ── Motion ────────────────────────────────────────────────────────────────

  // Off and reduced motion skip every animation; Calm keeps fades only (CSS).
  function still(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.documentElement) return true;
    if (d.documentElement.getAttribute('data-motion') === 'off') return true;
    var w = d.defaultView;
    return !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function figureValues(st) {
    var out = {};
    FIGURES.forEach(function (k) { out[k] = k === 'free_strike' ? String(st.c.free_strike || '') : st.c[k]; });
    return out;
  }

  // flashChanged briefly marks the figure boxes whose value just changed, so
  // a level or organization change shows what it moved.
  function flashChanged(doc, edEl, before, now) {
    if (still(doc)) return;
    FIGURES.forEach(function (k) {
      if (before[k] === now[k]) return;
      var box = edEl.querySelector('#sbe-fig-' + k);
      var f = box && box.closest ? box.closest('.sbe-f') : null;
      if (!f) return;
      f.classList.add('is-flash');
      setTimeout(function () { f.classList.remove('is-flash'); }, 650);
    });
  }

  // mount opens the editor in `host`. opts: { campaignId, entityId, entity,
  // refs, ref, onClose(savedEntity|null) }. Returns { destroy }.
  function mount(host, opts) {
    var o = opts || {};
    var doc = host.ownerDocument || document;
    injectStyles(doc);
    SB().injectStyles(doc);
    var entity = o.entity || null;
    var st = newState(entity ? entity.name : '', entity ? (entity.fields_data || entity.custom_fields) : null, o.refs);
    var ui = { ref: o.ref || null, onClose: o.onClose || null, isNew: !o.entityId, party: null, partyLoading: true, msg: '', msgKind: '', saving: false,
      gen: { open: false, what: '', kind: 'party', role: '', level: Math.min(10, st.c.level || 1), seed: 0, why: null, loading: false },
      ai: { open: false, vocab: null, vocabP: null, timer: null, stream: null } };
    var ctx = { campaignId: String(o.campaignId || ''), entityId: o.entityId ? String(o.entityId) : '' };
    var dirtyKey = 'monster-builder:' + (ctx.entityId || 'new');
    var root = doc.createElement('div');
    root.className = 'sbe-wrap' + (still(doc) ? '' : ' sbe-entering');
    root.innerHTML = '<div class="sbe card"></div><aside class="sbe-side" aria-label="Party, budget and checks"></aside>';
    host.innerHTML = '';
    host.appendChild(root);
    var edEl = root.firstChild, sideEl = root.lastChild;
    edEl.innerHTML = '<div class="sbe-part"></div><div class="sbe-fold" id="sbe-ai" inert>' + aiHtml() + '</div><div class="sbe-part"></div>';
    var headEl = edEl.firstChild, aiEl = edEl.childNodes[1], bodyEl = edEl.lastChild;
    function aiBox(id) { return aiEl.querySelector('#sbe-ai-' + id); }
    if (!still(doc)) setTimeout(function () { root.classList.remove('sbe-entering'); }, 700);

    function dirty() { try { if (typeof Chronicle !== 'undefined' && Chronicle.markDirty) Chronicle.markDirty(dirtyKey); } catch (e) { /* optional */ } ui.dirty = true; }
    function clean() { try { if (typeof Chronicle !== 'undefined' && Chronicle.markClean) Chronicle.markClean(dirtyKey); } catch (e) { /* optional */ } ui.dirty = false; }

    function drawSide() { sideEl.innerHTML = sideHtml(st, ui); }
    function draw(focusId) {
      pending = false;
      // The AI panel is never redrawn, so focus inside it stays where it is.
      var active = doc.activeElement, id = focusId || (active && edEl.contains(active) && !aiEl.contains(active) ? active.id : null), pos = null;
      try { if (active && active.selectionStart !== undefined) pos = active.selectionStart; } catch (e) { pos = null; }
      var figs = figureValues(st), before = ui.figs;
      ui.figs = figs;
      headEl.innerHTML = editorHead(st, ui);
      bodyEl.innerHTML = editorBody(st, ui);
      drawSide();
      if (before) flashChanged(doc, edEl, before, figs);
      var back = id ? doc.getElementById(id) : null;
      if (back) { back.focus(); try { if (pos !== null && back.setSelectionRange) back.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ } }
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
      if (t.hasAttribute('data-sbe-ai')) {
        if (t.getAttribute('data-sbe-ai') === 'desc') aiBox('guide').value = guide();
        else { stopStream(); clearTimeout(ui.ai.timer); ui.ai.timer = setTimeout(readAI, 150); }
        return;
      }
      if (t.hasAttribute('data-sbe-k')) {
        applyField(st, t.getAttribute('data-sbe-k'), t.value);
        dirty();
        if (t.getAttribute('data-sbe-k') === 'name') drawSide();
        return;
      }
      if (t.hasAttribute('data-sbe-ab') && t.type !== 'checkbox') { applyAbility(st, t.getAttribute('data-sbe-ab'), t.value); dirty(); }
    }
    function onChange(e) {
      var t = e.target;
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
      if (del) { listOf(st, del.charAt(0)).splice(Number(del.slice(1)), 1); st.editAb = null; derive(st); dirty(); draw(); return; }
      var act = el.getAttribute('data-sbe-act');
      if (act === 'add-ab') { st.c.abilities.push(newAbility(st)); st.editAb = 'a' + (st.c.abilities.length - 1); derive(st); dirty(); draw('sbe-ab-name'); }
      else if (act === 'add-trait') { st.c.traits.push({ name: '', description: '' }); st.editAb = 't' + (st.c.traits.length - 1); dirty(); draw('sbe-ab-name'); }
      else if (act === 'add-va') {
        var order = ['opener', 'crowd-control', 'ultimate'][st.c.villain_actions.length] || '';
        st.c.villain_actions.push({ order: order, name: 'Villain action ' + (st.c.villain_actions.length + 1), effect: '' });
        st.editAb = 'v' + (st.c.villain_actions.length - 1); dirty(); draw('sbe-ab-name');
      }
      else if (act === 'save') doSave();
      else if (act === 'cancel') {
        if (ui.dirty && typeof confirm === 'function' && !confirm('Discard your changes to this stat block?')) return;
        clean(); close(null);
      }
      else if (act === 'gen' || act === 'ai') toggleFold(act);
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
        if (ui.dirty && typeof confirm === 'function' && !confirm('Clear this stat block and start blank?')) return;
        var keep = st.base;
        var fresh = newState('', null, st.refs);
        Object.keys(fresh).forEach(function (k) { st[k] = fresh[k]; });
        st.base = keep; ui.gen.why = null; ui.msg = ''; stopStream(); dirty(); draw('sbe-name');
      }
      else if (act === 'start') openStartFrom(doc, ctx, function (name, src, origin) { startFrom(st, name, src, origin); dirty(); draw('sbe-level'); });
      else if (act === 'suggest') suggestForParty();
    }

    // The Generate and AI panels fold open in place, one at a time: toggling
    // a class (not a redraw) is what lets the height animate.
    function toggleFold(name) {
      var on = !ui[name].open, other = name === 'gen' ? 'ai' : 'gen';
      if (on && ui[other].open) setFold(other, false);
      setFold(name, on);
      if (on && name === 'ai') { aiBox('guide').value = guide(); loadVocab(); }
      var to = on ? (name === 'gen' ? doc.getElementById('sbe-g-what') : aiBox('desc')) : doc.getElementById(name === 'gen' ? 'sbe-name' : 'sbe-ai-open');
      if (to) { try { to.focus({ preventScroll: true }); } catch (e) { to.focus(); } }
    }
    function setFold(name, on) {
      var el = doc.getElementById('sbe-' + name);
      ui[name].open = on;
      if (!el) { draw(); return; }
      el.classList.add('is-moving');
      el.classList.toggle('is-open', on);
      if (on) el.removeAttribute('inert'); else el.setAttribute('inert', '');
      edEl.querySelectorAll('[aria-controls="sbe-' + name + '"]').forEach(function (b) { b.setAttribute('aria-expanded', String(on)); });
      setTimeout(function () { el.classList.remove('is-moving'); }, still(doc) ? 0 : 340);
    }

    // ── Build with an AI ──
    function guide() { return guideFor(aiBox('desc').value, partyLine(ui.party), ui.ai.vocab || vocabulary(st.refs, {})); }

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
      if (r.err) { stEl.textContent = r.err; stEl.className = 'sbe-small' + (r.wait ? '' : ' sbe-ai-err'); return; }
      var notes = fromAI(st, r.obj, ui.ai.vocab || vocabulary(st.refs, {}));
      ui.gen.why = null; ui.msg = '';
      dirty(); draw();
      stEl.className = 'sbe-small' + (r.done ? ' sbe-ai-ok' : '');
      stEl.textContent = r.done ? 'Read in: ' + (st.name || 'a creature') + ', level ' + st.c.level + ' ' + st.c.organization + '. Check it, change anything, then Save.' : 'Reading the answer…';
      notesEl.innerHTML = aiNotesHtml(notes);
    }

    function stopStream() { if (ui.ai.stream) { clearInterval(ui.ai.stream); ui.ai.stream = null; } }

    // The example arrives a little at a time, the way a pasted answer would
    // be read, unless motion is calm or off.
    function example() {
      stopStream();
      var box = aiBox('ans');
      if (still(doc) || doc.documentElement.getAttribute('data-motion') === 'calm') { box.value = AI_EXAMPLE; readAI(); return; }
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

    function doSave() {
      var problem = !String(st.name || '').trim() ? 'Give the creature a name first.' : (!ctx.campaignId ? 'This editor has no campaign, so it cannot save.' : '');
      if (problem) { ui.msg = problem; ui.msgKind = 'error'; draw('sbe-name'); return; }
      ui.saving = true; ui.msg = ''; draw();
      save(st, ctx).then(function (saved) {
        ui.saving = false; clean();
        clearAIMarks(st);
        if (saved && saved.id) ctx.entityId = String(saved.id);
        if (ui.onClose) { close(saved); return; }
        ui.isNew = false; ui.msg = 'Saved.'; ui.msgKind = 'ok'; draw();
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('Monster builder: save failed', err);
        ui.saving = false;
        ui.msg = (err && !err.status && err.message) ? err.message : 'Could not save this stat block. Try again.';
        ui.msgKind = 'error'; draw();
      });
    }

    var closed = false;
    function unbind() {
      closed = true;
      stopStream(); clearTimeout(ui.ai.timer);
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
    draw();

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
        if (!closed) { if (ui.gen.open) redraw(); else drawSide(); }
      });
    } else {
      ui.partyLoading = false;
      drawSide();
    }

    return {
      state: st,
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

  // openStartFrom lists creatures from the community bestiary and this campaign;
  // picking one hands its full stat block to `pick(name, statblock, origin)`.
  function openStartFrom(doc, ctx, pick) {
    var tab = 'bestiary', cache = {}, prevFocus = doc.activeElement;
    var bg = doc.createElement('div');
    bg.className = 'sbe-modal-bg';
    bg.innerHTML = '<div class="sbe-modal card" role="dialog" aria-modal="true" aria-labelledby="sbe-sf-t">' +
      '<div class="sbe-modal-h"><h2 id="sbe-sf-t">Start from a creature</h2><button type="button" class="btn-ghost btn-sm" data-sf-close aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>' +
      '<p class="sbe-small sbe-dim">Copies its stat block into this one. Encounter value, Stamina and formula damage are worked out again for the level you set.</p>' +
      '<div class="sbe-tabs" role="tablist"><button type="button" role="tab" data-sf-tab="bestiary" aria-selected="true">Community bestiary</button><button type="button" role="tab" data-sf-tab="campaign" aria-selected="false">This campaign</button></div>' +
      '<input class="input" id="sbe-sf-q" placeholder="Search creatures" autocomplete="off" aria-label="Search creatures"><ul class="sbe-sf-list" id="sbe-sf-list"></ul></div>';
    doc.body.appendChild(bg);
    var list = bg.querySelector('#sbe-sf-list'), q = bg.querySelector('#sbe-sf-q');
    function close() { bg.remove(); doc.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    doc.addEventListener('keydown', onKey, true);
    function rowsFor(t) {
      if (!cache[t]) cache[t] = (t === 'bestiary' ? bestiaryRows() : campaignRows(ctx.campaignId)).catch(function () { return null; });
      return cache[t];
    }
    function paint() {
      var t = tab;
      list.innerHTML = '<li class="sbe-sf-note">Loading…</li>';
      rowsFor(t).then(function (rows) {
        if (t !== tab) return;
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
      });
    }
    bg.addEventListener('input', paint);
    bg.addEventListener('click', function (e) {
      if (e.target === bg || (e.target.closest && e.target.closest('[data-sf-close]'))) { close(); return; }
      var tb = e.target.closest && e.target.closest('[data-sf-tab]');
      if (tb) {
        tab = tb.getAttribute('data-sf-tab');
        bg.querySelectorAll('[data-sf-tab]').forEach(function (b) { b.setAttribute('aria-selected', b === tb ? 'true' : 'false'); });
        paint(); return;
      }
      var pk = e.target.closest && e.target.closest('[data-sf-pick]');
      if (!pk || !list._rows) return;
      var r = list._rows[Number(pk.getAttribute('data-sf-pick'))];
      if (!r) return;
      if (tab === 'campaign') { close(); pick(r.name, r.fields_data || {}, 'Started from ' + r.name + ' in this campaign.'); return; }
      pk.disabled = true;
      SB().getJSON('/bestiary/' + encodeURIComponent(r.slug) + '/statblock').then(function (sb) {
        close();
        pick(r.name, sb, 'Started from ' + r.name + ' in the community bestiary.');
      }).catch(function () {
        pk.disabled = false;
        list.insertAdjacentHTML('afterbegin', '<li class="sbe-sf-note">Could not load that stat block. Try again.</li>');
      });
    });
    paint();
    q.focus();
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
    var scrim = doc.createElement('div');
    scrim.className = 'sbe-scrim';
    var dr = doc.createElement('div');
    dr.className = 'sbe-drawer';
    dr.setAttribute('role', 'dialog');
    dr.setAttribute('aria-modal', 'true');
    dr.setAttribute('aria-labelledby', 'sbe-dr-t');
    dr.innerHTML = '<div class="sbe-dr-h"><h2 id="sbe-dr-t">Add abilities</h2><span class="sbe-small sbe-dim" id="sbe-dr-for"></span><span class="sbe-sp"></span>' +
      '<button type="button" class="sbe-switch" id="sbe-dr-all" aria-pressed="false">Show all</button>' +
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
          return '<button type="button" class="sbe-fchip" data-dr-f="' + key + '" data-dr-v="' + esc(x[0]) + '" aria-pressed="' + (f[key] === x[0]) + '">' + esc(x[1]) + '</button>';
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
      var rows = libraryRows(st, lib, f);
      $('sbe-dr-lib').innerHTML = rows.length ? rows.map(function (r) { return drawerCard(st, r, opt, lib); }).join('')
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
      setTimeout(function () { dr.remove(); scrim.remove(); }, still(doc) ? 0 : 320);
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
        if (kind === 'v') list.forEach(function (v, i) { v.order = VA_SLOTS[i] || v.order; });
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

  // Chronicle's colour tokens carry light and dark; the three status colours
  // switch under Chronicle's .dark root class. Injected into <head>, never the
  // mount element, so a redraw cannot wipe them.
  var CSS = [
    '.sbe-wrap{--sbe-accent:#DC2626;--sbe-ok:#15803d;--sbe-ok-soft:rgba(22,163,74,.12);--sbe-own:#b45309;--sbe-own-soft:rgba(217,119,6,.14);--sbe-ai:#6d28d9;--sbe-ai-soft:rgba(124,58,237,.12);display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;align-items:start;margin-top:12px}',
    '.sbe-drawer{--sbe-accent:#DC2626;--sbe-ok:#15803d;--sbe-ok-soft:rgba(22,163,74,.12);--sbe-own:#b45309;--sbe-own-soft:rgba(217,119,6,.14);--sbe-ai:#6d28d9;--sbe-ai-soft:rgba(124,58,237,.12)}',
    '.dark .sbe-wrap,.dark .sbe-drawer{--sbe-accent:#f87171;--sbe-ok:#4ade80;--sbe-ok-soft:rgba(74,222,128,.14);--sbe-own:#fbbf24;--sbe-own-soft:rgba(251,191,36,.14);--sbe-ai:#c4b5fd;--sbe-ai-soft:rgba(167,139,250,.16)}',
    '.sbe{padding:16px 18px;display:flex;flex-direction:column;gap:12px;border-top:3px solid var(--sbe-accent);color:var(--color-text-body,#374151);font-size:14px}',
    '.sbe-part{display:contents}',
    '.sbe-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.sbe-bar-t{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#6b7280);display:inline-flex;gap:6px;align-items:center;margin-right:4px}',
    '.sbe-bar-t i{color:var(--sbe-accent)}',
    '.sbe-sp{flex:1}',
    '.sbe-msg{margin:0;font-size:13px}.sbe-msg:empty{display:none}.sbe-msg.is-ok{color:var(--sbe-ok)}.sbe-msg.is-error{color:#b91c1c}.dark .sbe-msg.is-error{color:#f87171}',
    '.sbe-origin{margin:0;font-size:13px;padding:8px 10px;border-radius:8px;background:var(--color-bg-tertiary,#f3f4f6);display:flex;gap:8px;align-items:baseline}',
    '.sbe-h{margin:6px 0 0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#6b7280);display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between}',
    '.sbe-h .sbe-hint{text-transform:none;letter-spacing:0;font-weight:400;margin-right:auto}',
    '.sbe-grid{display:grid;gap:10px 12px}',
    '.sbe-g3{grid-template-columns:repeat(3,minmax(0,1fr))}.sbe-g4{grid-template-columns:repeat(4,minmax(0,1fr))}.sbe-g7{grid-template-columns:repeat(7,minmax(0,1fr))}',
    '.sbe-f{display:flex;flex-direction:column;gap:4px;min-width:0}.sbe-wide{grid-column:span 2}.sbe-full{grid-column:1/-1}',
    '.sbe-lbl{font-size:12px;font-weight:500}',
    '.sbe-num{font-variant-numeric:tabular-nums}',
    '.sbe .input{width:100%;font-size:14px}',
    '.sbe-hint{font-size:12px;color:var(--color-text-secondary,#6b7280);margin:0}',
    '.sbe-check{display:flex;gap:8px;align-items:center;font-size:13px}',
    '.sbe-chip{font-size:11.5px;line-height:1.3;border-radius:6px;padding:3px 6px;display:inline-flex;gap:4px;align-items:baseline;flex-wrap:wrap;align-self:flex-start}',
    '.sbe-chip.is-pub{background:var(--sbe-ok-soft);color:var(--sbe-ok)}',
    '.sbe-chip.is-own,.sbe-chip.is-none{background:var(--sbe-own-soft);color:var(--sbe-own)}',
    '.sbe-chip.is-ai{background:var(--sbe-ai-soft);color:var(--sbe-ai)}',
    '.sbe-link{font:inherit;background:none;border:0;padding:0;color:var(--color-accent,#6366f1);text-decoration:underline;cursor:pointer}',
    '.sbe-abs{display:flex;flex-direction:column;gap:8px}',
    '.sbe-ab{border:1px solid var(--color-border,#e5e7eb);border-radius:8px;padding:0 12px 10px}',
    '.sbe-ab .sbx-ab{border-top:0}',
    '.sbe-ab-edit{padding-top:12px;display:flex;flex-direction:column;gap:10px;background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbe-ab-foot{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;font-size:13px}',
    '.sbe-ab-acts{display:inline-flex;gap:12px;margin-left:auto}',
    '.sbe-side{display:flex;flex-direction:column;gap:12px;position:sticky;top:12px}',
    '.sbe-side-card{background:var(--color-card-bg,#fff);border:1px solid var(--color-border,#e5e7eb);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
    '.sbe-side-h{margin:0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#6b7280)}',
    '.sbe-small{font-size:13px;line-height:1.5;margin:0}.sbe-dim{color:var(--color-text-secondary,#6b7280)}',
    '.sbe-heroes{list-style:none;margin:0;padding:0;display:grid;gap:8px}',
    '.sbe-heroes li{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--color-text-primary,#111827)}',
    '.sbe-av{width:30px;height:30px;border-radius:50%;background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-secondary,#6b7280);display:grid;place-items:center;font-weight:600;font-size:13px;flex-shrink:0}',
    '.sbe-meter{position:relative;height:14px;border-radius:7px;background:var(--color-bg-tertiary,#f3f4f6);overflow:hidden}',
    '.sbe-band{position:absolute;top:0;bottom:0}.sbe-band.is-easy{background:rgba(99,102,241,.10)}.sbe-band.is-std{background:rgba(22,163,74,.28)}.sbe-band.is-hard{background:rgba(217,119,6,.22)}',
    '.sbe-fill{position:absolute;left:0;top:4px;bottom:4px;background:var(--sbe-accent);border-radius:3px}',
    '.sbe-meter-k{display:flex;justify-content:space-between}',
    '.sbe-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:14px}',
    '.sbe-checks li{display:flex;gap:8px;align-items:baseline}',
    '.sbe-checks .is-ok i{color:var(--sbe-ok)}.sbe-checks .is-miss i,.sbe-checks .is-warn i{color:var(--sbe-own)}.sbe-checks .is-provenance i{color:var(--color-text-secondary,#6b7280)}',
    '.sbe-modal-bg{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px}',
    '.sbe-modal{width:min(560px,100%);max-height:80vh;display:flex;flex-direction:column;gap:10px;padding:18px}',
    '.sbe-modal-h{display:flex;justify-content:space-between;align-items:center}',
    '.sbe-modal-h h2{margin:0;font-size:18px;font-weight:700;color:var(--color-text-primary,#111827)}',
    '.sbe-tabs{display:flex;gap:4px;border-bottom:1px solid var(--color-border,#e5e7eb)}',
    '.sbe-tabs button{font:inherit;font-size:14px;background:none;border:0;border-bottom:2px solid transparent;padding:6px 10px;color:var(--color-text-secondary,#6b7280);cursor:pointer}',
    '.sbe-tabs button[aria-selected="true"]{color:var(--color-accent,#6366f1);border-bottom-color:var(--color-accent,#6366f1)}',
    '.sbe-sf-list{list-style:none;margin:0;padding:0;overflow-y:auto;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;min-height:0}',
    '.sbe-sf-list li+li{border-top:1px solid var(--color-border-light,#f3f4f6)}',
    '.sbe-sf-list button{font:inherit;width:100%;text-align:left;background:none;border:0;padding:10px 12px;display:flex;justify-content:space-between;gap:12px;align-items:center;cursor:pointer;color:var(--color-text-body,#374151)}',
    '.sbe-sf-list button:hover,.sbe-sf-list button:focus-visible{background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbe-sf-list b{color:var(--color-text-primary,#111827)}',
    '.sbe-sf-note{padding:12px;font-size:13px;color:var(--color-text-secondary,#6b7280)}',
    '.sbe-start{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.sbe-fold{display:grid;grid-template-rows:0fr;opacity:0;margin-top:-12px;transition:grid-template-rows 320ms cubic-bezier(.2,.8,.2,1),opacity 200ms linear,margin-top 320ms cubic-bezier(.2,.8,.2,1)}',
    '.sbe-fold.is-open{grid-template-rows:1fr;opacity:1;margin-top:0}',
    '.sbe-fold-in{overflow:hidden;min-height:0}.sbe-fold.is-open>.sbe-fold-in{overflow:visible}.sbe-fold.is-open.is-moving>.sbe-fold-in{overflow:hidden}',
    '.sbe-gen{border:1px solid color-mix(in srgb,var(--sbe-accent) 40%,var(--color-border,#e5e7eb));border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--color-bg-tertiary,#f9fafb)}',
    '.sbe-gen-h{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}',
    '.sbe-gen-h h4{margin:0;font-size:15px;font-weight:600;color:var(--color-text-primary,#111827)}',
    '.sbe-seg{display:flex;flex-wrap:wrap;gap:6px}',
    '.sbe-seg label{position:relative;display:inline-flex}',
    '.sbe-seg input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}',
    '.sbe-seg span{padding:5px 12px;border:1px solid var(--color-border,#e5e7eb);border-radius:999px;font-size:13px;background:var(--color-card-bg,#fff);transition:background-color 160ms linear,border-color 160ms linear,color 160ms linear}',
    '.sbe-seg input:checked+span{background:var(--sbe-accent);border-color:var(--sbe-accent);color:#fff}',
    '.sbe-seg input:focus-visible+span{outline:2px solid var(--sbe-accent);outline-offset:2px}',
    '.sbe-gen-row{display:flex;flex-wrap:wrap;gap:12px 16px}.sbe-gen-row>.sbe-f{flex:0 1 180px}',
    '.sbe-gen-go{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.sbe-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px}.sbe-steps>li{display:flex;flex-direction:column;gap:8px}',
    '.sbe-peek summary{cursor:pointer;font-size:13px;color:var(--sbe-accent);width:fit-content}',
    '.sbe-peek textarea{width:100%;margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.sbe-ai-ok{color:var(--sbe-ok)}.sbe-ai-err{color:var(--sbe-own)}',
    '.sbe-why{margin:0;padding-left:18px;font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:2px}',
    '.sbe-f .sbe-num{transition:background-color 450ms linear}.sbe-f.is-flash .sbe-num{background:var(--sbe-ok-soft);transition:none}',
    // Opening the editor: the bar slides down, then the panels rise in turn.
    '@keyframes sbe-barin{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}',
    '@keyframes sbe-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
    '@keyframes sbe-fade{from{opacity:0}to{opacity:1}}',
    '.sbe-entering .sbe{animation:sbe-rise 320ms cubic-bezier(.2,.8,.2,1) both}',
    '.sbe-entering .sbe-bar{animation:sbe-barin 280ms cubic-bezier(.2,.8,.2,1) 80ms both}',
    '.sbe-entering .sbe-side{animation:sbe-rise 320ms cubic-bezier(.2,.8,.2,1) 160ms both}',
    'html[data-motion="calm"] .sbe-entering .sbe,html[data-motion="calm"] .sbe-entering .sbe-bar,html[data-motion="calm"] .sbe-entering .sbe-side{animation:sbe-fade 180ms linear both}',
    'html[data-motion="calm"] .sbe-fold{transition:opacity 180ms linear}',
    'html[data-motion="off"] .sbe-entering *,html[data-motion="off"] .sbe-entering{animation:none}',
    'html[data-motion="off"] .sbe-fold,html[data-motion="off"] .sbe-seg span,html[data-motion="off"] .sbe-f .sbe-num{transition:none}',
    '@media (prefers-reduced-motion:reduce){.sbe-entering,.sbe-entering *{animation:none}.sbe-fold,.sbe-seg span,.sbe-f .sbe-num{transition:none}}',
    '.sbe-h-acts{display:inline-flex;gap:6px;flex-wrap:wrap}',
    '.sbe-icon{font:inherit;font-size:13px;line-height:1;width:26px;height:26px;border-radius:6px;border:1px solid var(--color-border,#e5e7eb);background:var(--color-card-bg,#fff);color:var(--color-text-body,#374151);cursor:pointer}',
    '.sbe-icon:disabled{opacity:.35;cursor:default}',
    '.sbe-ab-acts{align-items:center}',
    '.sbe-grip{color:var(--color-text-secondary,#6b7280);cursor:grab;user-select:none}',
    '.sbe-ab[draggable="true"]{cursor:grab}.sbe-ab.is-dragging{opacity:.45}',
    // Add abilities: the drawer slides down from the top and the page dims.
    '.sbe-scrim{position:fixed;inset:0;z-index:80;background:rgba(8,10,20,.55);opacity:0;transition:opacity 260ms linear}',
    '.sbe-scrim.is-open{opacity:1}',
    '.sbe-drawer{position:fixed;z-index:81;top:calc(12px + env(safe-area-inset-top,0px));left:50%;width:min(1180px,calc(100vw - 32px));max-height:calc(100% - 24px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;background:var(--color-card-bg,#fff);color:var(--color-text-body,#374151);border:1px solid var(--color-border,#e5e7eb);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);overflow:hidden;font-size:14px;transform:translate(-50%,calc(-100% - 24px));transition:transform 320ms cubic-bezier(.2,.8,.2,1)}',
    '.sbe-drawer.is-open{transform:translate(-50%,0)}',
    '.sbe-dr-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--color-border,#e5e7eb)}',
    '.sbe-dr-h h2{margin:0;font-size:16px;font-weight:700;color:var(--color-text-primary,#111827)}',
    '.sbe-switch{font:inherit;font-size:13px;border:1px solid var(--color-border,#e5e7eb);border-radius:999px;padding:4px 12px;background:var(--color-card-bg,#fff);color:var(--color-text-body,#374151);cursor:pointer}',
    '.sbe-switch[aria-pressed="true"]{background:var(--sbe-accent,#DC2626);border-color:var(--sbe-accent,#DC2626);color:#fff}',
    '.sbe-dr-f{display:flex;flex-direction:column;gap:8px;padding:10px 16px;border-bottom:1px solid var(--color-border,#e5e7eb);background:var(--color-bg-tertiary,#f9fafb)}',
    '.sbe-dr-f input{width:100%;font-size:14px}',
    '.sbe-chips{display:flex;flex-direction:column;gap:6px}',
    '.sbe-chip-row{display:flex;flex-wrap:wrap;gap:6px}',
    '.sbe-fchip{font:inherit;font-size:12.5px;border:1px solid var(--color-border,#e5e7eb);border-radius:999px;padding:3px 10px;background:var(--color-card-bg,#fff);color:var(--color-text-body,#374151);cursor:pointer}',
    '.sbe-fchip[aria-pressed="true"]{background:var(--sbe-accent,#DC2626);border-color:var(--sbe-accent,#DC2626);color:#fff}',
    '.sbe-dr-b{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:14px;padding:14px 16px;overflow:auto;min-height:0;flex:1}',
    '.sbe-dr-lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;align-content:start;min-width:0}',
    '.sbe-abc{display:flex;flex-direction:column;gap:6px;border:1px solid var(--color-border,#e5e7eb);border-radius:10px;padding:10px 12px;background:var(--color-card-bg,#fff);font-size:13px;min-width:0}',
    '.sbe-abc[draggable="true"]{cursor:grab}.sbe-abc[draggable="true"]:hover{border-color:color-mix(in srgb,var(--sbe-accent,#DC2626) 50%,var(--color-border,#e5e7eb))}',
    '.sbe-abc.is-dragging{opacity:.45}.sbe-abc.is-off{opacity:.6}',
    '.sbe-abc header,.sbe-abc footer{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.sbe-abc header b{color:var(--color-text-primary,#111827);font-size:14px}',
    '.sbe-abc p{margin:0}',
    '.sbe-tag{font-size:11px;border-radius:999px;padding:1px 8px;background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-secondary,#6b7280)}',
    '.sbe-tag.is-sig{background:var(--sbe-accent,#DC2626);color:#fff}',
    '.sbe-abc-t{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 8px;font-size:12.5px}',
    '.sbe-abc-k{font-variant-numeric:tabular-nums;font-size:11px;color:var(--color-text-secondary,#6b7280)}',
    '.sbe-ok{color:var(--sbe-ok,#15803d)}',
    '.sbe-abc-o{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px}',
    '.sbe-abc-o label{display:flex;flex-direction:column;gap:2px;min-width:0}.sbe-abc-o select{width:100%;font-size:12.5px}',
    '.sbe-dr-drop{position:sticky;top:0;align-self:start;display:flex;flex-direction:column;gap:6px;border:2px dashed var(--color-border,#e5e7eb);border-radius:12px;padding:12px;transition:border-color 160ms linear,background-color 160ms linear}',
    '.sbe-dr-drop.is-ready{border-color:var(--sbe-accent,#DC2626)}',
    '.sbe-dr-drop.is-over{border-color:var(--sbe-accent,#DC2626);background:var(--sbe-ok-soft,rgba(22,163,74,.12))}',
    '.sbe-dr-drop p{margin:0}.sbe-dr-drop .sbe-lbl{margin-top:6px}',
    '.sbe-dr-drop ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}',
    '.sbe-mine-i{display:flex;gap:6px;align-items:center;justify-content:space-between;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;padding:5px 8px;font-size:13px;color:var(--color-text-primary,#111827)}',
    '.sbe-mine-i.is-sig{border-color:var(--sbe-accent,#DC2626)}',
    '.sbe-mine-i.is-empty{color:var(--color-text-secondary,#6b7280);border-style:dashed}',
    '.sbe-mine-i button{font:inherit;border:0;background:none;color:var(--color-text-secondary,#6b7280);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}',
    '@keyframes sbe-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
    '.sbe-mine-i.is-new{animation:sbe-in 260ms cubic-bezier(.2,.8,.2,1)}',
    '.sbe-dr-status{margin:0;padding:8px 16px;border-top:1px solid var(--color-border,#e5e7eb);font-size:13px}.sbe-dr-status:empty{display:none}',
    'html[data-motion="calm"] .sbe-drawer{transform:translate(-50%,0);opacity:0;transition:opacity 180ms linear}',
    'html[data-motion="calm"] .sbe-drawer.is-open{opacity:1}',
    'html[data-motion="calm"] .sbe-mine-i.is-new{animation:sbe-fade 180ms linear}',
    'html[data-motion="off"] .sbe-drawer{transform:translate(-50%,0);transition:none}',
    'html[data-motion="off"] .sbe-scrim,html[data-motion="off"] .sbe-dr-drop{transition:none}',
    'html[data-motion="off"] .sbe-mine-i.is-new{animation:none}',
    '@media (prefers-reduced-motion:reduce){.sbe-drawer{transform:translate(-50%,0);transition:none}.sbe-scrim,.sbe-dr-drop{transition:none}.sbe-mine-i.is-new{animation:none}}',
    // On a phone the creature's list sits above the library, and the filters scroll sideways.
    '@media (max-width:760px){.sbe-dr-b{grid-template-columns:minmax(0,1fr)}.sbe-dr-drop{order:-1;position:static}.sbe-dr-lib{grid-template-columns:minmax(0,1fr)}.sbe-chip-row{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px}.sbe-fchip{flex:none}.sbe-dr-drop ul{flex-direction:row;flex-wrap:wrap}}',
    // On wide screens the bar with Save stays in view while the form scrolls.
    '@media (min-width:901px){.sbe-bar{position:sticky;top:0;z-index:5;margin:-16px -18px 0;padding:12px 18px;background:var(--color-card-bg,#fff);border-bottom:1px solid var(--color-border-light,#f3f4f6)}}',
    '@media (max-width:900px){.sbe-wrap{grid-template-columns:minmax(0,1fr)}.sbe-side{position:static}}',
    '@media (max-width:640px){.sbe-g4,.sbe-g3{grid-template-columns:repeat(2,minmax(0,1fr))}.sbe-g7{grid-template-columns:repeat(4,minmax(0,1fr))}}'
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
    startFrom: startFrom, checks: checks, budget: budget, toSave: toSave, autoTier: autoTier, isStrike: isStrike,
    editorHtml: editorHtml, sideHtml: sideHtml, applyField: applyField, newAbility: newAbility, save: save,
    applySuggestion: applySuggestion, generate: generate, fits: fits, fromLibrary: fromLibrary, KINDS: KINDS, mount: mount,
    usable: usable, libraryRows: libraryRows, shapeAbility: shapeAbility, addFromLibrary: addFromLibrary, restore: restore, moveItem: moveItem,
    openAbilityDrawer: openAbilityDrawer, drawerCard: drawerCard, drawerMine: drawerMine, DTYPES: DTYPES, RIDERS: RIDERS, openStartFrom: openStartFrom, injectStyles: injectStyles, CSS: CSS,
    vocabulary: vocabulary, guideFor: guideFor, readAnswer: readAnswer, fromAI: fromAI, keepKnownRefs: keepKnownRefs, clearAIMarks: clearAIMarks,
    setCharacteristics: setCharacteristics, partyLine: partyLine, aiHtml: aiHtml, aiNotesHtml: aiNotesHtml, AI_EXAMPLE: AI_EXAMPLE
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
