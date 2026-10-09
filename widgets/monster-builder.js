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
    var st = { name: name || c.name || '', c: c, own: {}, origin: null, editAb: null, refs: refs || { orgs: [], roles: [] } };
    var pr = S.provenance(c, st.refs);
    ['ev', 'stamina', 'free_strike'].forEach(function (k) {
      var stored = k === 'free_strike' ? S.freeStrikeNumber(c.free_strike) : c[k];
      if (stored !== null && pr[k] && pr[k].state !== 'formula') st.own[k] = true;
    });
    if (c.winded !== null && c.stamina !== null && c.winded !== Math.floor(c.stamina / 2)) st.own.winded = true;
    derive(st);
    return st;
  }

  // autoTier rewrites the leading "N damage" of a tier's text and keeps the
  // rest ("; push 2"), so the formula owns the number and the director the words.
  function autoTier(textIn, n) {
    var t = String(textIn || '');
    if (/^\s*\d+\s+damage/i.test(t)) return t.replace(/^\s*\d+(\s+damage)/i, n + '$1');
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

  // toSave is what saving writes: the entity's fields and the name.
  function toSave(st) {
    var S = SB();
    var c = clone(st.c);
    c.abilities = c.abilities.slice(0, 50);
    c.traits = (c.traits || []).filter(function (t) { return t.name || t.description; });
    c.level = Math.max(1, Math.min(20, Number(c.level) || 1));
    return { name: String(st.name || '').trim().slice(0, 200), fields: S.toFields(c) };
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
    return '<div class="sbe-ab">' + SB().abilityHtml(shown, { ref: ui.ref }) + '<div class="sbe-ab-foot">' + note +
      '<span class="sbe-ab-acts"><button type="button" class="sbe-link" data-sbe-edit="' + kind + i + '">Edit</button>' +
      '<button type="button" class="sbe-link" data-sbe-del="' + kind + i + '">Remove</button></span></div></div>';
  }

  function listHtml(st, kind, ui) {
    var list = kind === 'a' ? st.c.abilities : kind === 'v' ? st.c.villain_actions : st.c.traits;
    return list.map(function (x, i) {
      return st.editAb === kind + i ? abilityForm(st, kind, i) : abilityCard(st, kind, i, ui);
    }).join('');
  }

  function editorHtml(st, ui) {
    var c = st.c, pr = st.pr;
    var noRole = c.organization === 'leader' || c.organization === 'solo';
    var h = '<div class="sbe-bar"><span class="sbe-bar-t"><i class="fa-solid fa-pen" aria-hidden="true"></i> ' + (ui.isNew ? 'New stat block' : 'Editing stat block') + '</span>' +
      '<button type="button" class="btn-secondary btn-sm" data-sbe-act="start"><i class="fa-solid fa-copy mr-1" aria-hidden="true"></i> Start from…</button>' +
      '<span class="sbe-sp"></span>' +
      (ui.onClose ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="cancel">Cancel</button>' : '') +
      '<button type="button" class="btn-primary btn-sm" data-sbe-act="save"' + (ui.saving ? ' disabled' : '') + '>' + (ui.saving ? 'Saving…' : 'Save') + '</button></div>';
    h += '<p class="sbe-msg' + (ui.msgKind ? ' is-' + ui.msgKind : '') + '" role="status" aria-live="polite">' + esc(ui.msg || '') + '</p>';
    if (st.origin) h += '<p class="sbe-origin"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' + esc(st.origin) + '</p>';
    h += '<div class="sbe-grid sbe-g4">' +
      field('sbe-name', 'Name', st.name, 'data-sbe-k="name" maxlength="200"', true) +
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
    h += '<h4 class="sbe-h">Abilities <button type="button" class="btn-ghost btn-sm" data-sbe-act="add-ab"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Add ability</button></h4>' +
      '<div class="sbe-abs">' + (c.abilities.length ? listHtml(st, 'a', ui) : '<p class="sbe-hint">No abilities yet. Every creature needs a signature ability.</p>') + '</div>';
    if (pr.vaCount || c.villain_actions.length) {
      h += '<h4 class="sbe-h">Villain actions <span class="sbe-hint">' + (pr.vaCount ? esc(cap(c.organization)) + 's get ' + pr.vaCount + ', used once each, in order' : 'This organization has no villain actions') + '</span>' +
        (c.villain_actions.length < 3 ? '<button type="button" class="btn-ghost btn-sm" data-sbe-act="add-va"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i> Add villain action</button>' : '') + '</h4>' +
        '<div class="sbe-abs">' + listHtml(st, 'v', ui) + '</div>';
    }
    return h;
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

  // save writes the stat block to the entity, or creates the creature when this
  // editor has none. Only a fixed message is ever shown for a server failure.
  function save(st, ctx) {
    var out = toSave(st);
    if (!out.name) return Promise.reject(new Error('Give the creature a name first.'));
    var base = '/api/v1/campaigns/' + encodeURIComponent(ctx.campaignId);
    var body = { name: out.name, fields_data: out.fields };
    var req;
    if (ctx.entityId) {
      req = apiCall(base + '/entities/' + encodeURIComponent(ctx.entityId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
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
      var saved = entity && entity.id ? entity : { id: ctx.entityId, name: out.name, fields_data: out.fields };
      if (!saved.fields_data) saved.fields_data = out.fields;
      return saved;
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
    var ui = { ref: o.ref || null, onClose: o.onClose || null, isNew: !o.entityId, party: null, partyLoading: true, msg: '', msgKind: '', saving: false };
    var ctx = { campaignId: String(o.campaignId || ''), entityId: o.entityId ? String(o.entityId) : '' };
    var dirtyKey = 'monster-builder:' + (ctx.entityId || 'new');
    var root = doc.createElement('div');
    root.className = 'sbe-wrap';
    root.innerHTML = '<div class="sbe card"></div><aside class="sbe-side" aria-label="Party, budget and checks"></aside>';
    host.innerHTML = '';
    host.appendChild(root);
    var edEl = root.firstChild, sideEl = root.lastChild;

    function dirty() { try { if (typeof Chronicle !== 'undefined' && Chronicle.markDirty) Chronicle.markDirty(dirtyKey); } catch (e) { /* optional */ } ui.dirty = true; }
    function clean() { try { if (typeof Chronicle !== 'undefined' && Chronicle.markClean) Chronicle.markClean(dirtyKey); } catch (e) { /* optional */ } ui.dirty = false; }

    function drawSide() { sideEl.innerHTML = sideHtml(st, ui); }
    function draw(focusId) {
      pending = false;
      var active = doc.activeElement, id = focusId || (active && edEl.contains(active) ? active.id : null), pos = null;
      try { if (active && active.selectionStart !== undefined) pos = active.selectionStart; } catch (e) { pos = null; }
      edEl.innerHTML = editorHtml(st, ui);
      drawSide();
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
      else if (act === 'start') openStartFrom(doc, ctx, function (name, src, origin) { startFrom(st, name, src, origin); dirty(); draw('sbe-level'); });
      else if (act === 'suggest') suggestForParty();
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
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('click', onClick);
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
      }).catch(function () { ui.party = null; }).then(function () {
        ui.partyLoading = false;
        if (!closed) drawSide();
      });
    } else {
      ui.partyLoading = false;
      drawSide();
    }

    return {
      state: st,
      destroy: function () { clean(); unbind(); host.innerHTML = ''; }
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
        var hits = rows.filter(function (r) { return !term || String(r.name || '').toLowerCase().indexOf(term) >= 0; }).slice(0, 100);
        list.innerHTML = hits.map(function (r, i) {
          var f = t === 'bestiary' ? r : (r.fields_data || {});
          var org = SB().cap(f.organization || ''), noRole = /^(leader|solo)$/i.test(f.organization || '');
          var sub = (f.level !== undefined && f.level !== null && f.level !== '' ? 'Level ' + f.level + ' ' : '') + org + (noRole || !f.role ? '' : ' ' + SB().cap(f.role));
          return '<li><button type="button" data-sf-pick="' + i + '"><span><b>' + esc(r.name || 'Unnamed') + '</b><br><span class="sbe-dim sbe-small">' + esc(sub.trim()) + '</span></span>' +
            (t === 'bestiary' ? '<span class="sbe-dim sbe-small">' + esc(r.downloads || 0) + ' added</span>' : '') + '</button></li>';
        }).join('') || '<li class="sbe-sf-note">No creatures match.</li>';
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

  // ── Styles ────────────────────────────────────────────────────────────────

  // Chronicle's colour tokens carry light and dark; the three status colours
  // switch under Chronicle's .dark root class. Injected into <head>, never the
  // mount element, so a redraw cannot wipe them.
  var CSS = [
    '.sbe-wrap{--sbe-accent:#DC2626;--sbe-ok:#15803d;--sbe-ok-soft:rgba(22,163,74,.12);--sbe-own:#b45309;--sbe-own-soft:rgba(217,119,6,.14);display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;align-items:start;margin-top:12px}',
    '.dark .sbe-wrap{--sbe-accent:#f87171;--sbe-ok:#4ade80;--sbe-ok-soft:rgba(74,222,128,.14);--sbe-own:#fbbf24;--sbe-own-soft:rgba(251,191,36,.14)}',
    '.sbe{padding:16px 18px;display:flex;flex-direction:column;gap:12px;border-top:3px solid var(--sbe-accent);color:var(--color-text-body,#374151);font-size:14px}',
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
    applySuggestion: applySuggestion, mount: mount, openStartFrom: openStartFrom, injectStyles: injectStyles, CSS: CSS
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
        ? S.getJSON('/api/v1/campaigns/' + encodeURIComponent(cid) + '/entities/' + encodeURIComponent(eid)).catch(function () { return null; })
        : Promise.resolve(null);
      var ref = (typeof DrawSteelRefRenderer !== 'undefined' && cid) ? new DrawSteelRefRenderer('', cid) : null;
      Promise.all([load, S.loadRefs(cid), ref ? ref.load() : null]).then(function (r) {
        if (ref && ref.injectStyles) ref.injectStyles();
        el._dsEditor = DrawSteelCreatureEditor.mount(el, {
          campaignId: cid, entityId: r[0] ? eid : '', entity: r[0], refs: r[1], ref: ref
        });
      });
    },
    destroy: function (el) {
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
