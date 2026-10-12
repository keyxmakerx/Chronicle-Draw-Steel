/**
 * Draw Steel creature stat block.
 *
 * Two things live here:
 *
 *   DrawSteelStatblock — the one stat block renderer. Pure functions that turn
 *   a creature (an entity's fields_data or a bestiary publication's statblock)
 *   into escaped HTML, plus the provenance of its figures against the published
 *   formulas. The page panel below, the monster builder and the bestiary
 *   browser all draw creatures with it, so a creature looks the same wherever
 *   it appears. Other widgets reach it as a global at use time, never at load,
 *   because widget scripts load in manifest order.
 *
 *   'statblock-renderer' — the panel Chronicle mounts under the title of every
 *   NPC-family page (manifest entity_panels). It draws only on a page whose type
 *   is a Creature, and for the director it carries Edit stat block and Publish.
 */
var DrawSteelStatblock = (function () {
  'use strict';

  var CHARS = ['might', 'agility', 'reason', 'intuition', 'presence'];
  var TIERS = [['tier1', '≤ 11'], ['tier2', '12–16'], ['tier3', '17 +']];
  var KIND = {
    signature: 'Signature', action: 'Main action', maneuver: 'Maneuver',
    triggered: 'Triggered action', villain: 'Villain action', free: 'Free action'
  };
  var VA_ORDER = { opener: 'Opener', 'crowd-control': 'Crowd control', ultimate: 'Ultimate' };
  // Legacy single-letter sizes saved by earlier builders, mapped to the
  // multi-hex notation docs/DATA-SCHEMA.md uses.
  var LEGACY_SIZE = { T: '1T', S: '1S', M: '1M', L: '1L', H: '2', G: '3' };
  var MAX_LIST = 50;

  // Escapes for element content AND attribute values, so one helper is safe in
  // both places and the module works without the Chronicle global (Node tests).
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function parseJSON(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    if (typeof v !== 'string') return v;
    try { var p = JSON.parse(v); return p === null ? fallback : p; } catch (e) { return fallback; }
  }

  // A stored list may be a real array, a JSON-encoded array, or comma text —
  // and an empty string must come back as [] (the old builder crashed on '').
  function parseList(v) {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    var p = parseJSON(v, null);
    if (Array.isArray(p)) return p.map(String).filter(Boolean);
    if (typeof v !== 'string') return [];
    return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Lists of objects: anything not an array, and any non-object entry, is
  // dropped so dotted access never meets a null; capped like the server does.
  function parseObjects(v) {
    var p = parseJSON(v, []);
    if (!Array.isArray(p)) return [];
    return p.filter(function (x) { return x !== null && typeof x === 'object'; }).slice(0, MAX_LIST);
  }

  // Traits are a JSON list when the builder wrote them, but plain prose
  // ("Undead: Immune to poison…") in the bundled examples and older pages; prose
  // becomes one trait, split at its first colon when that reads as a name.
  function parseTraits(v) {
    if (typeof v === 'string' && v.trim() && !/^\s*\[/.test(v)) {
      var m = /^([^:.]{1,60}):\s*([\s\S]+)$/.exec(v.trim());
      return [m ? { name: m[1].trim(), description: m[2].trim() } : { name: '', description: v.trim() }];
    }
    return parseObjects(v);
  }

  function slug(v) { return String(v || '').trim().toLowerCase(); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  // normalize reads either shape a creature arrives in: an entity's fields_data
  // (lists stored as JSON strings: abilities_json, villain_actions_json, traits)
  // or a bestiary statblock (real arrays: abilities, villain_actions, traits).
  // Figures stay null when absent so "not set" never renders as 0.
  function normalize(src) {
    var f = (src && typeof src === 'object') ? src : {};
    var size = String(f.size || '').trim();
    var c = {
      name: f.name ? String(f.name) : '',
      level: num(f.level),
      organization: slug(f.organization),
      role: slug(f.role),
      ev: num(f.ev),
      stamina: num(f.stamina),
      winded: num(f.winded),
      size: LEGACY_SIZE[size] || size || '1M',
      speed: num(f.speed),
      stability: num(f.stability),
      keywords: parseList(f.keywords),
      faction: f.faction ? String(f.faction) : '',
      immunities: parseList(f.immunities),
      weaknesses: parseList(f.weaknesses),
      movement: parseList(f.movement),
      with_captain: f.with_captain == null ? '' : String(f.with_captain),
      free_strike: f.free_strike == null ? '' : String(f.free_strike),
      traits: parseTraits(f.traits),
      abilities: parseObjects(f.abilities_json !== undefined ? f.abilities_json : f.abilities),
      villain_actions: parseObjects(f.villain_actions_json !== undefined ? f.villain_actions_json : f.villain_actions)
        .filter(function (v) { return v.name && String(v.name).trim() !== ''; })
    };
    CHARS.forEach(function (k) { c[k] = num(f[k]); });
    c._normalized = true;
    return c;
  }

  // isCreature says whether a page's fields hold a stat block at all, for pages
  // whose type alone can't tell (an NPC type that carries creature fields).
  function hasStatblock(fields) {
    var f = fields || {};
    return num(f.level) !== null && !!slug(f.organization);
  }

  function formulas() {
    if (typeof DrawSteelFormulas !== 'undefined' && DrawSteelFormulas) return DrawSteelFormulas;
    return null;
  }

  function findBySlug(list, s) {
    if (!Array.isArray(list) || !s) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].slug === s) return list[i];
    return null;
  }

  // freeStrikeNumber reads the number out of free_strike text ("5 damage").
  function freeStrikeNumber(text) {
    var m = /-?\d+/.exec(String(text || ''));
    return m ? Number(m[0]) : null;
  }

  // provenance measures each stored figure against the published formula.
  //   state 'formula' — the formula covers this creature and the figure matches.
  //   state 'changed' — the formula covers it, and the director set another number.
  //   state 'own'     — no published formula covers it (Swarm, no role), so the
  //                     director set it.
  // With no formula module or no templates there is nothing to measure against,
  // and every state is null: the stat block then shows no marks rather than
  // implying a check that never ran.
  function provenance(c, refs) {
    var F = formulas();
    var r = refs || {};
    var org = findBySlug(r.orgs, c.organization);
    var role = findBySlug(r.roles, c.role);
    var out = { org: org, role: role, ev: null, stamina: null, free_strike: null, damage: null, hc: null };
    if (!F || !org || c.level === null) return out;
    function measure(result, stored) {
      var st = !result.sourced || result.value === null ? 'own'
        : (stored === null || stored === undefined) ? null
        : (stored === result.value ? 'formula' : 'changed');
      return { state: st, value: result.value, sourced: result.sourced, source: result.source, notes: result.notes || [] };
    }
    out.ev = measure(F.encounterValue(c.level, org), c.ev);
    out.stamina = measure(F.stamina(c.level, org, role), c.stamina);
    out.free_strike = measure(F.freeStrike(c.level, org, role), freeStrikeNumber(c.free_strike));
    out.damage = F.damageTiers(c.level, org, role);
    out.hc = F.highestCharacteristic(c.level, org);
    return out;
  }

  // tierOdds returns [T1%, T2%, T3%] for a 2d10 + mod power roll, with a
  // natural 19-20 always tier 3. Same rule and enumeration as the character
  // sheet's; tools/test-statblock-renderer.mjs pins the two together.
  function tierOdds(mod) {
    var t = [0, 0, 0];
    for (var d1 = 1; d1 <= 10; d1++) {
      for (var d2 = 1; d2 <= 10; d2++) {
        var nat = d1 + d2, tot = nat + mod;
        var tier = nat >= 19 ? 3 : (tot <= 11 ? 1 : (tot <= 16 ? 2 : 3));
        t[tier - 1]++;
      }
    }
    return t;
  }

  // rollBonus reads the flat bonus from a power roll ("2d10 + 3", "+3", "3").
  // Text naming characteristics instead ("Might vs. Agility") has no number.
  function rollBonus(text) {
    var s = String(text == null ? '' : text).replace(/2d10/i, '').replace(/\s+/g, '');
    var m = /^([+\-−]?)(\d+)$/.exec(s);
    if (!m) return null;
    var n = Number(m[2]);
    return (m[1] === '-' || m[1] === '−') ? -n : n;
  }

  function signed(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  }

  // text renders authored prose: escape, resolve {@term} markup, then mark bare
  // condition names, the same order the character sheet uses for synced prose.
  function text(s, ref) {
    var e = esc(s);
    if (!ref) return e;
    // Marked-up text resolves its {@…} terms only: scanning it afterwards would
    // match a term inside a tooltip's attribute and break the markup. Plain
    // text (bestiary and hand-typed) gets bare condition names lit instead.
    if (/\{@/.test(String(s == null ? '' : s))) return ref.renderText ? ref.renderText(e) : e;
    return ref.scanText ? ref.scanText(e) : e;
  }

  // mark is the small sign beside a figure: a tick when it matches the
  // published formula, a pen when the director set it. Its title says which.
  function mark(p, what) {
    if (!p || !p.state) return '';
    if (p.state === 'formula') {
      return '<span class="sbx-mark is-formula" title="' + esc(what + ' matches the published formula') + '">' +
        '<i class="fa-solid fa-check" aria-hidden="true"></i><span class="sbx-sr">matches the published formula</span></span>';
    }
    var why = p.state === 'changed'
      ? what + ' was set by the director. The published formula gives ' + p.value + '.'
      : 'No published ' + what.toLowerCase() + ' covers this creature. The director set it.';
    return '<span class="sbx-mark is-own" title="' + esc(why) + '">' +
      '<i class="fa-solid fa-pen-nib" aria-hidden="true"></i><span class="sbx-sr">' + esc(why) + '</span></span>';
  }

  function cell(label, value, extra) {
    return '<div class="sbx-cell"><span class="sbx-v">' + value + '</span><span class="sbx-l">' + label + (extra || '') + '</span></div>';
  }

  function figure(v) { return v === null || v === undefined || v === '' ? '—' : esc(v); }

  // keywordHtml shows an ability keyword with its glossary definition on hover,
  // as the character sheet does, when the glossary knows the word.
  function keywordHtml(k, ref) {
    var en = (ref && ref.getEntry) ? ref.getEntry(k) : null;
    if (en && en.description) {
      return '<span class="ds-ref ds-ref--combat" tabindex="0" data-ref-tip="' + esc(en.description) + '">' + esc(k) + '</span>';
    }
    return esc(k);
  }

  // oddsHtml is the director's at-a-glance chance of each tier for this roll.
  function oddsHtml(bonus) {
    if (bonus === null) return '';
    var o = tierOdds(bonus);
    return '<span class="sbx-odds" title="Chance of each tier on 2d10 ' + esc(signed(bonus)) + ', with a natural 19 or 20 always tier 3">' +
      'T1 ' + o[0] + '% · T2 ' + o[1] + '% · T3 ' + o[2] + '%</span>';
  }

  // rollButtonHtml is the button a live stat block puts on a power roll; the
  // viewer finds the ability again by its key and rolls it.
  function rollButtonHtml(key, bonus, name) {
    var label = '2d10 ' + (bonus < 0 ? '− ' : '+ ') + Math.abs(bonus);
    return '<button type="button" class="sbx-rollb" data-sbx-roll="' + esc(key) + '" aria-label="' + esc('Roll ' + (name || 'this ability') + ', ' + label) + '">' + esc(label) + '</button>';
  }

  // abilityHtml draws one ability, trait or villain action. `a.label` overrides
  // the kind shown on the right (villain actions use their order). With
  // opts.live and a `key`, the name opens the ability's hover card and the power
  // roll gets a roll button.
  function abilityHtml(a, opts, key) {
    var o = opts || {};
    var ref = o.ref || null;
    var live = !!(o.live && key);
    var type = slug(a.type);
    var icon = type === 'signature' ? 'fa-star' : type === 'villain' ? 'fa-crown' : type === 'trait' ? 'fa-circle-info' : 'fa-bolt';
    var kind = a.label || KIND[type] || cap(type);
    var name = esc(a.name || 'Untitled');
    if (live) name = '<span class="sbx-term" tabindex="0" data-sbx-ab="' + esc(key) + '">' + name + '</span>';
    var h = '<section class="sbx-ab"' + (live ? ' data-sbx-key="' + esc(key) + '"' : '') + '><div class="sbx-ab-top"><h4 class="sbx-ab-name"><i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
      name + '</h4>' + (kind ? '<span class="sbx-kind">' + esc(kind) + '</span>' : '') + '</div>';
    var kws = parseList(a.keywords).filter(function (k) { return k !== 'Attack'; });
    if (kws.length || a.distance || a.target) {
      h += '<dl class="sbx-meta">' +
        (kws.length ? '<div><dt>Keywords</dt><dd>' + kws.map(function (k) { return keywordHtml(k, ref); }).join(', ') + '</dd></div>' : '') +
        (a.distance ? '<div><dt>Distance</dt><dd>' + esc(a.distance) + '</dd></div>' : '') +
        (a.target ? '<div><dt>Target</dt><dd>' + esc(a.target) + '</dd></div>' : '') + '</dl>';
    }
    if (a.trigger) h += '<p class="sbx-eff"><b>Trigger</b> ' + text(a.trigger, ref) + '</p>';
    if (a.tier1 || a.tier2 || a.tier3) {
      var bonus = rollBonus(a.power_roll);
      var roll = bonus !== null ? 'Power roll ' + signed(bonus) : (a.power_roll ? 'Power roll ' + String(a.power_roll) : 'Power roll');
      h += '<p class="sbx-roll"><span>' + esc(roll) + '</span>' + (live && bonus !== null ? rollButtonHtml(key, bonus, a.name) : '') + oddsHtml(bonus) + '</p><ul class="sbx-tiers">' +
        TIERS.map(function (t) {
          return a[t[0]] ? '<li><span class="sbx-t">' + t[1] + '</span><span>' + text(a[t[0]], ref) + '</span></li>' : '';
        }).join('') + '</ul>';
    }
    var eff = a.effect || a.description;
    if (eff) h += '<p class="sbx-eff">' + (type === 'trait' ? '' : '<b>Effect</b> ') + text(eff, ref) + '</p>';
    var vp = num(a.spend_vp);
    if (vp !== null && vp > 0) h += '<p class="sbx-eff"><b>Spend ' + vp + ' Malice</b> ' + text(a.spend_effect || 'Enhanced effect', ref) + '</p>';
    return h + '</section>';
  }

  // villainAbility is a villain action in the shape abilityHtml draws.
  function villainAbility(v, i) {
    return {
      name: v.name, type: 'villain', label: (i + 1) + (VA_ORDER[v.order] ? ' · ' + VA_ORDER[v.order] : ''),
      keywords: v.keywords, distance: v.distance, target: v.target,
      power_roll: v.power_roll, tier1: v.tier1, tier2: v.tier2, tier3: v.tier3, effect: v.effect || v.description
    };
  }

  // abilityByKey finds what a live block's key names: 'a3' an ability, 'v0' a
  // villain action, 't1' a trait, each in the shape abilityHtml draws.
  function abilityByKey(c, key) {
    var m = /^([atv])(\d+)$/.exec(String(key || ''));
    if (!m) return null;
    var i = Number(m[2]);
    if (m[1] === 'a') return c.abilities[i] || null;
    if (m[1] === 'v') return c.villain_actions[i] ? villainAbility(c.villain_actions[i], i) : null;
    var t = c.traits[i];
    return t ? { name: t.name, type: 'trait', label: 'Trait', description: t.description } : null;
  }

  // rollTier is the tier a power roll lands: a natural 19 or 20 is always tier
  // 3, otherwise 11 or less is tier 1, 12 to 16 tier 2, 17 or more tier 3.
  function rollTier(d1, d2, bonus) {
    var nat = d1 + d2, total = nat + (Number(bonus) || 0);
    return nat >= 19 ? 3 : total <= 11 ? 1 : total <= 16 ? 2 : 3;
  }

  // html draws the whole stat block. opts: { ref (glossary renderer), refs
  // ({orgs, roles} templates, for the provenance marks), compact (header, figures and the
  // signature ability's name, for a hover card), live (hover-card hooks and roll
  // buttons, for the bestiary viewer) }.
  function html(name, src, opts) {
    var o = opts || {};
    var c = (src && src._normalized) ? src : normalize(src);
    var title = name || c.name || 'Unnamed creature';
    var pr = provenance(c, o.refs);
    var noRole = c.organization === 'leader' || c.organization === 'solo';
    var live = !!o.live;
    // A live block's organization and role open their hover cards.
    function hook(attr, v) { return live ? '<span class="sbx-term" tabindex="0" ' + attr + '="' + esc(v) + '">' + esc(cap(v)) + '</span>' : esc(cap(v)); }
    var rank = (c.level !== null ? 'Level ' + esc(c.level) : '') +
      (c.organization ? ' ' + hook('data-sbx-org', c.organization) : '') + (c.role && !noRole ? ' ' + hook('data-sbx-role', c.role) : '');
    var h = '<article class="sbx' + (o.compact ? ' sbx--compact' : '') + '" aria-label="' + esc(title) + ' stat block">';
    h += '<header class="sbx-head"><div class="sbx-title"><h3 class="sbx-name">' + esc(title) + '</h3>';
    if (c.keywords.length || c.faction) {
      h += '<p class="sbx-kw">' + esc(c.keywords.join(', ')) + (c.keywords.length && c.faction ? ' <span class="sbx-dot">·</span> ' : '') + esc(c.faction) + '</p>';
    }
    // A minion's encounter value buys four of them, as the book prints it.
    h += '</div><div class="sbx-rank"><span class="sbx-lvl">' + rank.trim() + '</span>' +
      '<span class="sbx-ev">EV ' + figure(c.ev) + (c.organization === 'minion' && c.ev !== null ? ' <span class="sbx-ev-n">for four</span>' : '') +
      mark(pr.ev, 'Encounter value') + '</span></div></header>';
    h += '<div class="sbx-strip">' + cell('Size', esc(c.size)) + cell('Speed', figure(c.speed)) +
      cell('Stamina', figure(c.stamina), mark(pr.stamina, 'Stamina')) + cell('Stability', figure(c.stability)) +
      cell('Free strike', figure(freeStrikeNumber(c.free_strike) !== null ? freeStrikeNumber(c.free_strike) : c.free_strike), mark(pr.free_strike, 'Free strike')) + '</div>';
    h += '<div class="sbx-strip sbx-chars">' + CHARS.map(function (k) { return cell(cap(k), signed(c[k])); }).join('') + '</div>';
    if (o.compact) {
      // A hover card names the creature's signature ability; the shared card's
      // looks restyle .sbx-sig from outside, so it carries no colour here.
      var sig = c.abilities.filter(function (a) { return a.type === 'signature'; })[0] || c.abilities[0];
      if (sig && sig.name) h += '<p class="sbx-sig"><span class="sbx-sig-k">Signature</span> ' + esc(sig.name) + '</p>';
      return h + '</article>';
    }
    var lines = [];
    if (c.immunities.length) lines.push('<b>Immunities</b> ' + text(c.immunities.join(', '), o.ref));
    if (c.weaknesses.length) lines.push('<b>Weaknesses</b> ' + text(c.weaknesses.join(', '), o.ref));
    if (c.winded !== null) lines.push('<b>Winded</b> at ' + esc(c.winded) + ' Stamina');
    if (c.movement.length) lines.push('<b>Movement</b> ' + esc(c.movement.join(', ')));
    if (c.with_captain) lines.push('<b>With a captain</b> ' + text(c.with_captain, o.ref));
    if (lines.length) h += '<p class="sbx-line">' + lines.join(' <span class="sbx-dot">·</span> ') + '</p>';
    c.traits.forEach(function (t, i) {
      h += abilityHtml({ name: t.name, type: 'trait', label: 'Trait', description: t.description }, o, 't' + i);
    });
    c.abilities.forEach(function (a, i) { h += abilityHtml(a, o, 'a' + i); });
    if (c.villain_actions.length) {
      h += '<h4 class="sbx-sec">Villain actions</h4>';
      c.villain_actions.forEach(function (v, i) {
        h += abilityHtml(villainAbility(v, i), o, 'v' + i);
      });
    }
    if (!c.traits.length && !c.abilities.length) {
      h += '<p class="sbx-empty">No abilities yet.</p>';
    }
    return h + '</article>';
  }

  // foundryHtml is the director's "In Foundry" box: what Foundry sent back and
  // whether it may. Chronicle owns the stat block; Foundry owns only current
  // Stamina and conditions, and sends them only while the toggle is on (the
  // page's `foundry` system state, read by the Chronicle Sync module).
  // state.sendBack is true, false, or null while unknown (toggle disabled).
  function foundryHtml(f, state) {
    var st = state || {};
    var max = num(f.stamina);
    var cur = num(f.stamina_current);
    var conds = parseJSON(f.conditions_json, []);
    if (!Array.isArray(conds)) conds = [];
    conds = conds.filter(function (c) { return typeof c === 'string' && c; }).map(function (c) {
      return cap(c.replace(/[-_]+/g, ' '));
    });
    var stamina = cur === null ? 'Not sent from Foundry yet' : (cur + (max !== null ? ' / ' + max : ''));
    var on = st.sendBack === true;
    return '<section class="sbx-fvtt" aria-label="In Foundry">' +
      '<p class="sbx-sec">In Foundry</p>' +
      '<dl class="sbx-fvtt-rows">' +
        '<div><dt>Stamina at the table</dt><dd>' + esc(stamina) + '</dd></div>' +
        '<div><dt>Conditions</dt><dd>' + esc(conds.length ? conds.join(', ') : 'None') + '</dd></div>' +
      '</dl>' +
      '<label class="sbx-fvtt-toggle"><input type="checkbox" data-sbx-fvtt="sendback"' + (on ? ' checked' : '') +
        (st.sendBack === null || st.sendBack === undefined || st.saving ? ' disabled' : '') + '>' +
        '<span><b>Let Foundry send back Stamina and conditions</b>' +
        '<span class="sbx-fvtt-hint">Chronicle owns the stat block. Edits to abilities in Foundry are not sent back. Off until you turn it on.</span></span></label>' +
      '<p class="sbx-fvtt-hint">Foundry makes this creature an NPC actor in its &ldquo;Chronicle: Creatures&rdquo; folder when Sync Creatures is on in the Chronicle Sync module&rsquo;s settings.</p>' +
      (st.error ? '<p class="sbx-msg is-error" role="alert">' + esc(st.error) + '</p>' : '') +
    '</section>';
  }

  // ── Compare with the book ─────────────────────────────────────────────────

  // A page copied from the Monsters book keeps the entry's slug here. The field
  // is director-only and has no Foundry path, so it never leaves Chronicle.
  var SOURCE_KEY = 'book_source';
  var CMP_FIELDS = [['level', 'Level'], ['organization', 'Organization'], ['role', 'Role'], ['ev', 'EV'], ['size', 'Size'],
    ['keywords', 'Keywords'], ['stamina', 'Stamina'], ['winded', 'Winded'], ['speed', 'Speed'], ['movement', 'Movement'],
    ['stability', 'Stability'], ['might', 'Might'], ['agility', 'Agility'], ['reason', 'Reason'], ['intuition', 'Intuition'],
    ['presence', 'Presence'], ['free_strike', 'Free strike'], ['immunities', 'Immunities'], ['weaknesses', 'Weaknesses'],
    ['with_captain', 'With a captain']];
  // [normalized key, row label, saved field]
  var CMP_LISTS = [['traits', 'Trait', 'traits'], ['abilities', 'Ability', 'abilities_json'], ['villain_actions', 'Villain action', 'villain_actions_json']];

  function bookSource(fields) {
    var s = fields && fields[SOURCE_KEY];
    return typeof s === 'string' ? s.trim() : '';
  }

  function shown(v) {
    if (Array.isArray(v)) return v.join(', ');
    return v === null || v === undefined ? '' : String(v);
  }

  // canon makes two items comparable however they were saved: keys sorted,
  // empty values dropped, so the editor's key order or an empty effect never
  // reads as a change.
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).sort().forEach(function (k) {
        var x = v[k];
        if (x === '' || x === null || x === undefined || (Array.isArray(x) && !x.length)) return;
        out[k] = canon(x);
      });
      return out;
    }
    return v;
  }

  function itemText(a) {
    var bits = [];
    if (a.type && KIND[a.type]) bits.push(KIND[a.type]);
    if (a.distance) bits.push(String(a.distance));
    if (a.tier1 || a.tier2 || a.tier3) bits.push([a.tier1, a.tier2, a.tier3].map(shown).join(' / '));
    var words = a.effect || a.description || a.trigger || '';
    if (words) bits.push(String(words));
    return { name: String(a.name || ''), text: bits.join(' · ') };
  }

  // bookDiffs lists every field where the page and the book entry disagree.
  // List items pair by position, so a renamed ability reads as changed, not as
  // one removed and one added.
  function bookDiffs(fields, book) {
    var p = normalize(fields), b = normalize(book), out = [];
    CMP_FIELDS.forEach(function (f) {
      var x = shown(p[f[0]]), y = shown(b[f[0]]);
      if (x !== y) out.push({ id: f[0], label: f[1], mine: x, book: y });
    });
    CMP_LISTS.forEach(function (l) {
      var mine = p[l[0]] || [], theirs = b[l[0]] || [], n = Math.max(mine.length, theirs.length);
      for (var i = 0; i < n; i++) {
        var a = mine[i], c = theirs[i];
        if (a && c && JSON.stringify(canon(a)) === JSON.stringify(canon(c))) continue;
        out.push({ id: l[0] + ':' + i, label: l[1] + ' ' + (i + 1), mine: a ? itemText(a) : null, book: c ? itemText(c) : null, list: l[0], i: i });
      }
    });
    return out;
  }

  // takeBook is the saved-field patch that makes the page match the book for
  // the given differences. Taking a whole list's items replaces that list.
  function takeBook(fields, book, diffs) {
    var p = normalize(fields), b = normalize(book), bf = toFields(b), patch = {}, lists = {};
    diffs.forEach(function (d) {
      if (!d.list) { patch[d.id] = bf[d.id]; return; }
      (lists[d.list] = lists[d.list] || []).push(d.i);
    });
    CMP_LISTS.forEach(function (l) {
      var idx = lists[l[0]];
      if (!idx) return;
      var mine = (p[l[0]] || []).slice(), theirs = b[l[0]] || [];
      // Highest first, so removing one doesn't shift the next.
      idx.sort(function (x, y) { return y - x; }).forEach(function (i) {
        if (theirs[i]) mine[i] = theirs[i]; else mine.splice(i, 1);
      });
      patch[l[2]] = JSON.stringify(mine.filter(Boolean).slice(0, MAX_LIST));
    });
    return patch;
  }

  function cmpCell(v) {
    if (v === null || v === undefined || v === '') return '<span class="sbx-cmp-none">none</span>';
    if (typeof v === 'object') return '<b>' + esc(v.name) + '</b>' + (v.text ? '<br>' + esc(v.text) : '');
    return esc(v);
  }

  // compareHtml is the fold under the banner. state: {book, missing, error,
  // loading, saving, msg, undo}; msg is the widget's own words, never a server's.
  function compareHtml(fields, st) {
    if (st.loading) return '<p class="sbx-cmp-f">Reading the book…</p>';
    if (st.error) return '<p class="sbx-cmp-f is-error" role="alert">Could not read the Draw Steel book. Close this and try again.</p>';
    if (st.missing || !st.book) return '<p class="sbx-cmp-f">This creature is not in the Draw Steel package installed here, so there is nothing to compare.</p>';
    var ds = bookDiffs(fields, st.book.properties || {}), dis = st.saving ? ' disabled' : '';
    var group = st.book.properties && st.book.properties.group;
    var h = '<div class="sbx-cmp-h"><h4 tabindex="-1">' + (ds.length ? ds.length + ' difference' + (ds.length === 1 ? '' : 's') + ' from the book' : 'Same as the book') + '</h4>' +
      '<span class="sbx-cmp-src">' + esc(st.book.name || '') + ', Monsters book' + (group ? ' · ' + esc(group) : '') + '</span><span class="sbx-cmp-sp"></span>' +
      (ds.length > 1 ? '<button type="button" class="btn-secondary btn-sm" data-sbx-cmp="all"' + dis + '>Use the book’s for all</button>' : '') +
      '<button type="button" class="btn-ghost btn-sm" data-sbx-act="compare">Close</button></div>';
    if (ds.length) {
      h += '<div class="sbx-cmp-w"><table class="sbx-cmp-t"><thead><tr><th scope="col">Field</th><th scope="col">This page</th><th scope="col">The book</th><th scope="col"><span class="sbx-sr">Take</span></th></tr></thead><tbody>' +
        ds.map(function (d, n) {
          return '<tr><td class="sbx-cmp-k">' + esc(d.label) + '</td><td class="sbx-cmp-mine">' + cmpCell(d.mine) + '</td><td>' + cmpCell(d.book) + '</td>' +
            '<td class="sbx-cmp-act"><button type="button" class="btn-secondary btn-sm" data-sbx-cmp="' + n + '"' + dis + '>Use the book’s</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      h += '<p class="sbx-cmp-f">Every field matches the book entry.</p>';
    }
    return h + '<p class="sbx-cmp-f' + (st.msgKind === 'error' ? ' is-error' : '') + '" role="status" aria-live="polite">' +
      esc(st.msg || '“Use the book’s” saves that one field to this page straight away. Undo puts it back.') +
      (st.undo && !st.saving ? ' <button type="button" class="btn-ghost btn-sm" data-sbx-cmp="undo">Undo</button>' : '') + '</p>';
  }

  // CSS uses Chronicle's colour tokens, so light and dark follow the site, and
  // stays under .sbx so a hover-card style can restyle it from outside.
  var CSS = [
    '.sbx{--sbx-accent:#DC2626;--sbx-ok:#15803d;--sbx-own:#b45309;background:var(--color-card-bg,#fff);border:1px solid var(--color-border,#e5e7eb);border-top:3px solid var(--sbx-accent);border-radius:10px;padding:18px 20px;display:flex;flex-direction:column;gap:14px;color:var(--color-text-body,#374151);font-size:14px;line-height:1.5}',
    '.dark .sbx{--sbx-accent:#f87171;--sbx-ok:#4ade80;--sbx-own:#fbbf24}',
    '.sbx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.sbx-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;align-items:flex-start}',
    '.sbx-title{min-width:0}',
    '.sbx-name{margin:0;font-size:22px;font-weight:700;color:var(--color-text-primary,#111827);letter-spacing:-.01em;line-height:1.2}',
    '.sbx-kw{margin:2px 0 0;font-size:13px;color:var(--color-text-secondary,#6b7280);font-style:italic}',
    '.sbx-dot{font-style:normal}',
    '.sbx-rank{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}',
    '.sbx-lvl{font-weight:600;color:var(--color-text-primary,#111827)}',
    '.sbx-ev{font-size:13px;font-weight:600;color:var(--sbx-accent);font-variant-numeric:tabular-nums;display:inline-flex;gap:5px;align-items:center}',
    '.sbx-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid var(--color-border,#e5e7eb);border-radius:8px;overflow:hidden}',
    '.sbx-cell{display:flex;flex-direction:column;align-items:center;padding:8px 4px;border-left:1px solid var(--color-border,#e5e7eb);min-width:0}',
    '.sbx-cell:first-child{border-left:0}',
    '.sbx-v{font-size:17px;font-weight:700;color:var(--color-text-primary,#111827);font-variant-numeric:tabular-nums;text-align:center;overflow-wrap:anywhere}',
    '.sbx-l{font-size:11px;color:var(--color-text-secondary,#6b7280);text-transform:uppercase;letter-spacing:.05em;display:inline-flex;gap:4px;align-items:center;white-space:nowrap}',
    '.sbx-chars{background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbx-mark{font-size:10px;color:var(--sbx-ok);cursor:help}',
    '.sbx-mark.is-own{color:var(--sbx-own)}',
    '.sbx-line,.sbx-eff,.sbx-empty{margin:0}',
    '.sbx-empty{color:var(--color-text-secondary,#6b7280)}',
    '.sbx-sec{margin:4px 0 0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#6b7280);border-bottom:1px solid var(--color-border,#e5e7eb);padding-bottom:4px}',
    '.sbx-ab{display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:1px solid var(--color-border-light,#f3f4f6)}',
    '.sbx-ab-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}',
    '.sbx-ab-name{margin:0;font-size:15px;font-weight:700;color:var(--color-text-primary,#111827);display:inline-flex;gap:7px;align-items:baseline}',
    '.sbx-ab-name i{color:var(--sbx-accent);font-size:12px}',
    '.sbx-kind{font-size:12px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-meta{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:4px 16px;font-size:13px}',
    '.sbx-meta dt{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-meta dd{margin:0}',
    '.sbx-roll{margin:2px 0 0;font-weight:600;color:var(--color-text-primary,#111827);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}',
    '.sbx-odds{font-size:12px;font-weight:500;color:var(--color-text-secondary,#6b7280);font-variant-numeric:tabular-nums;cursor:help}',
    '.sbx-tiers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}',
    '.sbx-tiers li{display:grid;grid-template-columns:56px 1fr;gap:8px;align-items:baseline}',
    '.sbx-t{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-text-secondary,#6b7280);background:var(--color-bg-tertiary,#f3f4f6);border-radius:4px;text-align:center;padding:1px 0}',
    '.sbx--compact{padding:12px 14px;gap:10px}',
    '.sbx-ev-n{font-weight:500;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-term{text-decoration:underline dotted;text-underline-offset:3px;cursor:help;border-radius:3px}',
    '.sbx-term:hover,.sbx-term:focus-visible{background:rgba(var(--color-accent-rgb,99,102,241),.12)}',
    '.sbx-rollb{display:inline-flex;gap:4px;align-items:center;border:1px solid rgba(var(--color-accent-rgb,99,102,241),.4);background:rgba(var(--color-accent-rgb,99,102,241),.1);color:var(--color-accent,#6366f1);border-radius:6px;padding:1px 8px;font:600 12px/1.6 ui-monospace,Consolas,monospace;cursor:pointer}',
    '.sbx-rollb::before{content:"⚂";font-family:system-ui,sans-serif;font-size:13px}',
    '.sbx-rollb:hover{background:rgba(var(--color-accent-rgb,99,102,241),.2)}',
    '.sbx-rollb:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:2px}',
    '.ds-statblock-panel{margin-top:12px}',
    '.sbx-wrap{display:flex;flex-direction:column;gap:8px}',
    '.sbx-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:space-between}',
    '.sbx-bar-l{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#6b7280);display:inline-flex;gap:6px;align-items:center}',
    '.sbx-bar-l i{color:#DC2626}',
    '.sbx-bar-r,.sbx-pub-acts{display:inline-flex;gap:4px;flex-wrap:wrap;margin:0}',
    '.sbx-pub{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;background:var(--color-bg-tertiary,#f3f4f6);font-size:14px}',
    '.sbx-msg{font-size:13px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-msg:empty{display:none}',
    '.sbx-msg.is-ok{color:#15803d}.sbx-msg.is-error{color:#b91c1c}',
    '.dark .sbx-msg.is-ok{color:#4ade80}.dark .sbx-msg.is-error{color:#f87171}',
    '.sbx-start{gap:8px}',
    '.sbx--compact .sbx-name{font-size:17px}',
    '.sbx-sig{margin:0;font-size:13px;font-weight:600}',
    '.sbx-sig-k{font-weight:400;text-transform:uppercase;letter-spacing:.06em;font-size:11px;opacity:.75;margin-right:4px}',
    '.sbx-fvtt{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;background:var(--color-card-bg,#fff);font-size:14px;color:var(--color-text-body,#374151)}',
    '.sbx-fvtt .sbx-sec{margin:0}',
    '.sbx-fvtt-rows{margin:0;display:flex;flex-direction:column;gap:2px}',
    '.sbx-fvtt-rows div{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid var(--color-border-light,#f3f4f6)}',
    '.sbx-fvtt-rows dt{color:var(--color-text-secondary,#6b7280)}',
    '.sbx-fvtt-rows dd{margin:0;font-weight:600;color:var(--color-text-primary,#111827);font-variant-numeric:tabular-nums;text-align:right}',
    '.sbx-fvtt-toggle{display:flex;gap:10px;align-items:flex-start;cursor:pointer}',
    '.sbx-fvtt-toggle input{margin-top:3px;accent-color:var(--sbx-accent,#DC2626)}',
    '.sbx-fvtt-toggle b{color:var(--color-text-primary,#111827);font-weight:600;display:block}',
    '.sbx-fvtt-hint{display:block;margin:0;font-size:13px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-src{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;padding:8px 12px;border-radius:8px;background:rgba(var(--color-accent-rgb,99,102,241),.08);font-size:13px}',
    '.sbx-src-t{flex:1 1 240px;min-width:0}',
    '.sbx-cmp{border:1px solid var(--color-border,#e5e7eb);border-radius:8px;overflow:hidden;background:var(--color-card-bg,#fff);font-size:13px}',
    '.sbx-cmp-h{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:8px 12px;background:var(--color-bg-tertiary,#f3f4f6)}',
    '.sbx-cmp-h h4{margin:0;font-size:14px;font-weight:600;color:var(--color-text-primary,#111827)}',
    '.sbx-cmp-src{font-size:12px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-cmp-sp{flex:1}',
    '.sbx-cmp-w{overflow-x:auto}',
    '.sbx-cmp-t{width:100%;border-collapse:collapse}',
    '.sbx-cmp-t th,.sbx-cmp-t td{text-align:left;vertical-align:top;padding:6px 10px;border-top:1px solid var(--color-border,#e5e7eb)}',
    '.sbx-cmp-t th{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-cmp-k{font-weight:600;white-space:nowrap;color:var(--color-text-primary,#111827)}',
    '.sbx-cmp-mine{background:rgba(245,158,11,.10)}',
    '.sbx-cmp-act{text-align:right;white-space:nowrap}',
    '.sbx-cmp-none{font-style:italic;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-cmp-f{margin:0;padding:8px 12px;border-top:1px solid var(--color-border,#e5e7eb);font-size:12.5px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-cmp-f.is-error{color:#b91c1c}.dark .sbx-cmp-f.is-error{color:#f87171}',
    '@media (max-width:640px){.sbx-cmp-t thead{display:none}.sbx-cmp-t tr{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--color-border,#e5e7eb)}.sbx-cmp-t td{border-top:0}.sbx-cmp-k,.sbx-cmp-act{grid-column:1/-1}.sbx-cmp-act{text-align:left}.sbx-cmp-mine::before{content:"This page";display:block;font-size:11px;color:var(--color-text-secondary,#6b7280)}.sbx-cmp-t td:nth-child(3)::before{content:"The book";display:block;font-size:11px;color:var(--color-text-secondary,#6b7280)}}',
    '@media (max-width:640px){.sbx{padding:14px}.sbx-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.sbx-cell:nth-child(4){border-left:0}.sbx-cell:nth-child(n+4){border-top:1px solid var(--color-border,#e5e7eb)}.sbx-rank{align-items:flex-start;text-align:left}}'
  ].join('\n');

  // injectStyles puts the CSS in <head> once. It must never go inside a mount
  // element: a render that replaces the element's innerHTML would wipe it, which
  // is how the old renderer drew unstyled text.
  function injectStyles(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.head || d.querySelector('style[data-ds-statblock]')) return;
    var s = d.createElement('style');
    s.setAttribute('data-ds-statblock', 'true');
    s.textContent = CSS;
    d.head.appendChild(s);
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  function apiFetch(url, opts) {
    if (typeof Chronicle !== 'undefined' && Chronicle && Chronicle.apiFetch) return Chronicle.apiFetch(url, opts);
    return Promise.reject(new Error('Chronicle is not loaded'));
  }

  function getJSON(url) {
    return apiFetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.json();
    });
  }

  // Templates are package data, served only at /campaigns/:id/systems/drawsteel/
  // data/<file> (Chronicle's SystemDataAPI). Cached per campaign for the page.
  var refCache = {};
  function loadRefs(campaignId) {
    if (!campaignId) return Promise.resolve({ orgs: [], roles: [] });
    var key = String(campaignId);
    if (!refCache[key]) {
      var base = '/campaigns/' + encodeURIComponent(key) + '/systems/drawsteel/data/';
      var one = function (f) { return getJSON(base + f).then(function (d) { return Array.isArray(d) ? d : []; }, function () { return []; }); };
      refCache[key] = Promise.all([one('organization-templates.json'), one('role-templates.json')])
        .then(function (r) { return { orgs: r[0], roles: r[1] }; });
    }
    return refCache[key];
  }

  // Lists are a bare array or {data:[…]}; unwrap both.
  function unwrap(d) {
    if (Array.isArray(d)) return d;
    return (d && (d.data || d.results)) || [];
  }

  // creatureType finds this campaign's Creature entity type: the preset category
  // first (what Chronicle records for a system preset), then the package's slug.
  function creatureType(campaignId) {
    return getJSON('/api/v1/campaigns/' + encodeURIComponent(String(campaignId)) + '/entity-types').then(function (d) {
      var types = unwrap(d), i;
      for (i = 0; i < types.length; i++) if (types[i] && types[i].preset_category === 'creature') return types[i];
      for (i = 0; i < types.length; i++) if (types[i] && types[i].slug === 'drawsteel-creature') return types[i];
      return null;
    });
  }

  // toStatblock is the bestiary publication shape: real arrays, a top-level
  // name (the server rejects one without it), level/organization/role so the
  // bestiary can index it.
  function toStatblock(name, c) {
    var sb = { name: String(name || c.name || '').slice(0, 200) };
    ['level', 'organization', 'role', 'ev', 'size', 'faction', 'stamina', 'winded', 'speed', 'stability',
      'free_strike', 'keywords', 'immunities', 'weaknesses', 'traits', 'abilities', 'villain_actions'].forEach(function (k) { sb[k] = c[k]; });
    CHARS.forEach(function (k) { sb[k] = c[k]; });
    return sb;
  }

  // toFields is the entity shape: the creature preset's fields, so the
  // Attributes view, Foundry sync and older builders read it. Keywords,
  // immunities and movement are comma text, as the bundled creatures have them; traits,
  // abilities and villain actions are JSON text.
  function toFields(c) {
    var f = {
      level: c.level, organization: c.organization, role: c.role, ev: c.ev, size: c.size,
      keywords: (c.keywords || []).join(', '), faction: c.faction || '',
      stamina: c.stamina, winded: c.winded, speed: c.speed, stability: c.stability,
      immunities: (c.immunities || []).join(', '), free_strike: c.free_strike || '',
      weaknesses: (c.weaknesses || []).join(', '),
      movement: (c.movement || []).join(', '), with_captain: c.with_captain || '',
      traits: JSON.stringify((c.traits || []).slice(0, MAX_LIST)),
      abilities_json: JSON.stringify((c.abilities || []).slice(0, MAX_LIST)),
      villain_actions_json: JSON.stringify((c.villain_actions || []).slice(0, MAX_LIST))
    };
    CHARS.forEach(function (k) { f[k] = c[k]; });
    return f;
  }

  return {
    apiFetch: apiFetch,
    getJSON: getJSON,
    loadRefs: loadRefs,
    unwrap: unwrap,
    creatureType: creatureType,
    toStatblock: toStatblock,
    toFields: toFields,
    html: html,
    foundryHtml: foundryHtml,
    SOURCE_KEY: SOURCE_KEY,
    bookSource: bookSource,
    bookDiffs: bookDiffs,
    takeBook: takeBook,
    compareHtml: compareHtml,
    abilityHtml: abilityHtml,
    abilityByKey: abilityByKey,
    rollTier: rollTier,
    rollButtonHtml: rollButtonHtml,
    mark: mark,
    CSS: CSS,
    injectStyles: injectStyles,
    CHARS: CHARS,
    esc: esc,
    num: num,
    parseList: parseList,
    parseObjects: parseObjects,
    normalize: normalize,
    hasStatblock: hasStatblock,
    findBySlug: findBySlug,
    freeStrikeNumber: freeStrikeNumber,
    provenance: provenance,
    tierOdds: tierOdds,
    rollBonus: rollBonus,
    signed: signed,
    text: text,
    cap: cap,
    KIND: KIND,
    VA_ORDER: VA_ORDER,
    TIERS: TIERS
  };
})();

// ── The page panel ──────────────────────────────────────────────────────────

// StatblockPanel is one mounted panel. boot.js calls init with the registered
// object as `this` for every mount, so per-page state lives here, never on it.
function StatblockPanel(el, config) {
  this.el = el;
  this.config = config || {};
  this.cid = this.config.campaignId ? String(this.config.campaignId) : '';
  this.eid = this.config.entityId ? String(this.config.entityId) : '';
  this.isGM = this.config.isGm === true;
  this.entity = null;
  this.refs = { orgs: [], roles: [] };
  this.ref = null;
  this.editor = null;
  this.publishOpen = false;
  this.fvtt = { sendBack: null, gm: {}, saving: false, error: '' };
  this.cmp = { open: false, book: null, missing: false, error: false, loading: false, saving: false, msg: '', msgKind: '', undo: null };
}

StatblockPanel.prototype.start = function () {
  var self = this, S = DrawSteelStatblock;
  if (!this.cid || !this.eid) return Promise.resolve();
  // One stat block per page: a hand-placed copy defers to the host's panel.
  var doc = this.el.ownerDocument;
  var others = doc && doc.querySelectorAll ? doc.querySelectorAll('[data-ds-statblock-entity="' + this.eid.replace(/"/g, '') + '"]') : [];
  if (others && others.length) return Promise.resolve();
  this.el.setAttribute('data-ds-statblock-entity', this.eid);
  if (typeof DrawSteelRefRenderer !== 'undefined') this.ref = new DrawSteelRefRenderer('', this.cid);
  var entityUrl = '/api/v1/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(this.eid);
  return Promise.all([
    S.getJSON(entityUrl),
    S.creatureType(this.cid).catch(function () { return null; })
  ]).then(function (r) {
    var entity = r[0], type = r[1];
    var fields = (entity && (entity.fields_data || entity.custom_fields)) || {};
    var isCreature = !!(type && entity && entity.entity_type_id === type.id) || S.hasStatblock(fields);
    if (!entity || !isCreature) { self.el.hidden = true; return null; }
    self.entity = entity;
    return Promise.all([S.loadRefs(self.cid), self.ref ? self.ref.load() : null]).then(function (x) {
      self.refs = x[0];
      if (self.ref && self.ref.injectStyles) self.ref.injectStyles();
      self.render();
      if (self.isGM) self.loadFoundry();
    });
  }).catch(function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not load this creature', err);
    self.el.hidden = true;
  });
};

StatblockPanel.prototype.fields = function () {
  return (this.entity && (this.entity.fields_data || this.entity.custom_fields)) || {};
};

StatblockPanel.prototype.render = function () {
  var S = DrawSteelStatblock, esc = S.esc;
  S.injectStyles(this.el.ownerDocument);
  var f = this.fields();
  var name = (this.entity && this.entity.name) || '';
  this.el.hidden = false;
  this.el.className = 'ds-statblock-panel';
  if (!S.hasStatblock(f)) {
    // A Creature page with no stat block yet: the director gets a way to start
    // one; a player sees nothing rather than an empty card.
    if (!this.isGM) { this.el.hidden = true; return; }
    this.el.innerHTML = '<div class="sbx sbx-start"><p class="sbx-line"><b>' + esc(name) + '</b> has no stat block yet.</p>' +
      '<p class="sbx-line"><button type="button" class="btn-primary btn-sm" data-sbx-act="edit"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i> Build its stat block</button></p></div>';
    this.bind();
    return;
  }
  var bar = '<div class="sbx-bar"><span class="sbx-bar-l"><i class="fa-solid fa-paw" aria-hidden="true"></i> Stat block</span>';
  if (this.isGM) {
    bar += '<span class="sbx-bar-r"><button type="button" class="btn-secondary btn-sm" data-sbx-act="edit"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i> Edit stat block</button>' +
      '<button type="button" class="btn-ghost btn-sm" data-sbx-act="publish" aria-expanded="' + (this.publishOpen ? 'true' : 'false') + '"><i class="fa-solid fa-share-nodes mr-1" aria-hidden="true"></i> Publish</button></span>';
  }
  bar += '</div>';
  var pub = (this.isGM && this.publishOpen) ? this.publishHtml() : '';
  this.el.innerHTML = '<div class="sbx-wrap">' + bar + pub + this.sourceHtml() + '<div class="sbx-msg" role="status" aria-live="polite"></div>' +
    S.html(name, f, { ref: this.ref, refs: this.refs }) +
    (this.isGM ? '<div data-sbx-fvtt-box>' + S.foundryHtml(f, this.fvtt) + '</div>' : '') + '</div>';
  this.bind();
};

// sourceHtml is the director's banner on a page copied from the book, with
// the comparison folded open under it. Players never see either.
StatblockPanel.prototype.sourceHtml = function () {
  var S = DrawSteelStatblock, f = this.fields();
  if (!this.isGM || !S.bookSource(f)) return '';
  var c = this.cmp, group = c.book && c.book.properties && c.book.properties.group;
  return '<div class="sbx-src"><span class="sbx-src-t">Copied from the <b>Draw Steel book</b>' + (group ? ' (' + S.esc(group) + ')' : '') + '. Changes you make stay on this page.</span>' +
    '<button type="button" class="btn-secondary btn-sm" data-sbx-act="compare" aria-expanded="' + c.open + '" aria-controls="sbx-cmp-' + S.esc(this.eid) + '">Compare with the book</button></div>' +
    '<div class="sbx-cmp" id="sbx-cmp-' + S.esc(this.eid) + '"' + (c.open ? '' : ' hidden') + '>' + (c.open ? S.compareHtml(f, c) : '') + '</div>';
};

// The book is the package's monsters.json, read once per page when the
// director first opens the comparison.
StatblockPanel.prototype.toggleCompare = function () {
  var self = this, S = DrawSteelStatblock, c = this.cmp;
  c.open = !c.open;
  if (!c.open) { c.msg = ''; c.undo = null; this.render(); this.focus('[data-sbx-act="compare"]'); return; }
  if (c.book || c.missing) { this.render(); this.focus('.sbx-cmp-h h4'); return; }
  c.loading = true; c.error = false;
  this.render();
  var slug = S.bookSource(this.fields());
  S.getJSON('/campaigns/' + encodeURIComponent(this.cid) + '/systems/drawsteel/data/monsters.json').then(function (list) {
    c.book = S.findBySlug(S.unwrap(list), slug);
    c.missing = !c.book;
  }).catch(function () {
    c.error = true;
  }).then(function () {
    c.loading = false;
    self.render();
    self.focus('.sbx-cmp-h h4');
  });
};

StatblockPanel.prototype.focus = function (sel) {
  var x = this.el.querySelector && this.el.querySelector(sel);
  if (x && x.focus) x.focus();
};

// saveFields lays a patch over the page's current fields (read fresh, so values
// Foundry sent back survive) and saves; undefined removes a key.
StatblockPanel.prototype.saveFields = function (patch) {
  var self = this, S = DrawSteelStatblock;
  var url = '/api/v1/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(this.eid);
  return S.getJSON(url).then(function (cur) {
    var merged = {}, k, now = (cur && cur.fields_data) || {};
    for (k in now) if (Object.prototype.hasOwnProperty.call(now, k)) merged[k] = now[k];
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) { if (patch[k] === undefined) delete merged[k]; else merged[k] = patch[k]; }
    var name = (cur && cur.name) || (self.entity && self.entity.name) || '';
    return S.apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, fields_data: merged }) })
      .then(function (res) {
        if (!res.ok) throw new Error('save ' + res.status);
        self.entity.fields_data = merged;
      });
  });
};

// take applies the book's value for one difference (n), all of them ('all'),
// or puts back what the last take replaced ('undo').
StatblockPanel.prototype.take = function (what) {
  var self = this, S = DrawSteelStatblock, c = this.cmp, f = this.fields(), patch, prev, said;
  if (c.saving || !c.book) return;
  if (what === 'undo') {
    if (!c.undo) return;
    patch = c.undo; prev = null; said = 'Undone.';
  } else {
    var ds = S.bookDiffs(f, c.book.properties || {});
    var pick = what === 'all' ? ds : (ds[+what] ? [ds[+what]] : []);
    if (!pick.length) return;
    patch = S.takeBook(f, c.book.properties || {}, pick);
    prev = {};
    Object.keys(patch).forEach(function (k) { prev[k] = Object.prototype.hasOwnProperty.call(f, k) ? f[k] : undefined; });
    said = what === 'all' ? 'Took the book’s values for everything.' : 'Took the book’s ' + pick[0].label.toLowerCase() + '.';
  }
  c.saving = true; c.msg = 'Saving…'; c.msgKind = '';
  this.render();
  this.saveFields(patch).then(function () {
    c.undo = prev; c.msg = said;
  }, function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not take the book’s value', err);
    c.msg = 'Could not save that. Try again.'; c.msgKind = 'error';
  }).then(function () {
    c.saving = false;
    self.render();
    self.focus('.sbx-cmp-h h4');
  });
};

StatblockPanel.prototype.stateUrl = function () {
  return '/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(this.eid) + '/system-state/drawsteel/foundry';
};

// drawFoundry redraws only the box, so a toggle never re-renders the stat block.
StatblockPanel.prototype.drawFoundry = function () {
  var box = this.el.querySelector && this.el.querySelector('[data-sbx-fvtt-box]');
  if (box) box.innerHTML = DrawSteelStatblock.foundryHtml(this.fields(), this.fvtt);
};

StatblockPanel.prototype.loadFoundry = function () {
  var self = this;
  return DrawSteelStatblock.getJSON(this.stateUrl()).then(function (state) {
    var gm = (state && state.gm && typeof state.gm === 'object') ? state.gm : {};
    self.fvtt.gm = gm;
    self.fvtt.sendBack = gm.sendBack === true;
    self.drawFoundry();
  }).catch(function () {
    self.fvtt.error = 'Could not read whether Foundry may send values back. Reload to try again.';
    self.drawFoundry();
  });
};

// setSendBack writes only the gm half, keeping any other keys in it; a failed
// save puts the box back as it was.
StatblockPanel.prototype.setSendBack = function (on) {
  var self = this, prev = this.fvtt.sendBack;
  var gm = {}, k;
  for (k in this.fvtt.gm) if (Object.prototype.hasOwnProperty.call(this.fvtt.gm, k)) gm[k] = this.fvtt.gm[k];
  gm.sendBack = on === true;
  this.fvtt.sendBack = gm.sendBack;
  this.fvtt.saving = true;
  this.fvtt.error = '';
  this.drawFoundry();
  return DrawSteelStatblock.apiFetch(this.stateUrl(), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gm: gm })
  }).then(function (res) {
    if (!res.ok) throw new Error('save ' + res.status);
    self.fvtt.gm = gm;
  }).catch(function () {
    self.fvtt.sendBack = prev;
    self.fvtt.error = 'Could not save that. Try again.';
  }).then(function () {
    self.fvtt.saving = false;
    self.drawFoundry();
  });
};

StatblockPanel.prototype.publishHtml = function () {
  return '<div class="sbx-pub"><p class="sbx-line">Share this stat block in the community bestiary, where directors on this Chronicle can add it to their campaigns.</p>' +
    '<p class="sbx-pub-acts"><button type="button" class="btn-primary btn-sm" data-sbx-pub="published">Publish for everyone</button>' +
    '<button type="button" class="btn-secondary btn-sm" data-sbx-pub="draft">Save as a private draft</button>' +
    '<button type="button" class="btn-ghost btn-sm" data-sbx-act="publish">Cancel</button></p></div>';
};

StatblockPanel.prototype.bind = function () {
  var self = this;
  if (this._bound) return;
  this._bound = true;
  this.el.addEventListener('click', function (e) {
    var act = e.target.closest && e.target.closest('[data-sbx-act]');
    if (act && self.el.contains(act)) {
      var which = act.getAttribute('data-sbx-act');
      if (which === 'edit') self.edit();
      else if (which === 'compare') self.toggleCompare();
      else { self.publishOpen = !self.publishOpen; self.render(); }
      return;
    }
    var cmp = e.target.closest && e.target.closest('[data-sbx-cmp]');
    if (cmp && self.el.contains(cmp)) { self.take(cmp.getAttribute('data-sbx-cmp')); return; }
    var pub = e.target.closest && e.target.closest('[data-sbx-pub]');
    if (pub && self.el.contains(pub)) self.publish(pub.getAttribute('data-sbx-pub'));
  });
  this.el.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-sbx-fvtt') === 'sendback') self.setSendBack(!!t.checked);
  });
};

StatblockPanel.prototype.say = function (msg, kind) {
  var m = this.el.querySelector('.sbx-msg');
  if (!m) return;
  m.className = 'sbx-msg' + (kind ? ' is-' + kind : '');
  m.textContent = msg;
};

// publish posts the stat block to the instance's community bestiary, named as a
// Draw Steel creature so the bestiary's Draw Steel search finds it; only a fixed
// message is ever shown for a failure.
StatblockPanel.prototype.publish = function (visibility) {
  var self = this, S = DrawSteelStatblock;
  var c = S.normalize(this.fields());
  var name = (this.entity && this.entity.name) || c.name;
  var body = {
    name: String(name || '').slice(0, 200),
    statblock_json: S.toStatblock(name, c),
    visibility: visibility === 'published' ? 'published' : 'draft',
    system_id: 'drawsteel',
    source_campaign_id: this.cid,
    source_entity_id: this.eid
  };
  this.publishOpen = false;
  this.render();
  this.say('Publishing…');
  S.apiFetch('/bestiary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (res) {
      if (res.status === 429) { self.say('You have reached the bestiary’s publishing limit for now. Try again in an hour.', 'error'); return; }
      if (!res.ok) throw new Error('publish ' + res.status);
      self.say(body.visibility === 'published'
        ? 'Published to the community bestiary.'
        : 'Saved as a private draft in the community bestiary. Only you can see it.', 'ok');
    })
    .catch(function (err) {
      if (typeof console !== 'undefined') console.warn('Stat block: publish failed', err);
      self.say('Could not publish this stat block. Try again.', 'error');
    });
};

// edit swaps the stat block for the builder, in place. The builder lives in
// monster-builder.js and is looked up now, not at load: widget scripts load in
// manifest order and this one may run first.
StatblockPanel.prototype.edit = function () {
  var self = this;
  var Ed = (typeof DrawSteelCreatureEditor !== 'undefined') ? DrawSteelCreatureEditor : null;
  if (!Ed) { this.say('The stat block editor did not load. Reload the page to try again.', 'error'); return; }
  this.el.innerHTML = '';
  var host = this.el.ownerDocument.createElement('div');
  this.el.appendChild(host);
  this.editor = Ed.mount(host, {
    campaignId: this.cid,
    entityId: this.eid,
    entity: this.entity,
    refs: this.refs,
    ref: this.ref,
    onClose: function (saved) {
      self.editor = null;
      if (saved) self.entity = saved;
      self.render();
    }
  });
};

StatblockPanel.prototype.destroy = function () {
  if (this.editor && this.editor.destroy) this.editor.destroy();
  this.editor = null;
};

DrawSteelStatblock.Panel = StatblockPanel;

if (typeof Chronicle !== 'undefined' && Chronicle && Chronicle.register) {
  Chronicle.register('statblock-renderer', {
    init: function (el, config) {
      var p = new StatblockPanel(el, config);
      el._dsStatblock = p;
      p.start();
    },
    destroy: function (el) {
      if (el._dsStatblock) el._dsStatblock.destroy();
      el._dsStatblock = null;
      el.innerHTML = '';
    }
  });
}

// Test seam: inert in a browser (no CommonJS module).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrawSteelStatblock;
}
