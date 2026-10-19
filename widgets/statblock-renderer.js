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
 *   Creature and NPC page (manifest entity_panels). It draws only on a page whose
 *   type is a Creature, and for the director it carries Edit stat block and Publish.
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

  // note is the form's caption under a figure ("Changed in this form").
  function cell(label, value, extra, note) {
    return '<div class="sbx-cell"><span class="sbx-v">' + value + '</span><span class="sbx-l">' + label + (extra || '') + '</span>' + (note || '') + '</div>';
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
    var tag = (o.tag && key) ? o.tag('item', key) : '';
    var h = '<section class="sbx-ab"' + (live ? ' data-sbx-key="' + esc(key) + '"' : '') + '><div class="sbx-ab-top"><h4 class="sbx-ab-name"><i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
      name + '</h4>' + tag + (kind ? '<span class="sbx-kind">' + esc(kind) + '</span>' : '') + '</div>';
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
    // A page's stat block leads with the creature's picture; the bestiary
    // passes none and keeps its rows compact.
    var pic = o.picture ? picHtml(o.picture.page, title, !o.picture.art) : '';
    h += '<header class="sbx-head' + (pic ? ' has-pic' : '') + '">' + pic + '<div class="sbx-title"><h3 class="sbx-name">' + esc(title) + '</h3>';
    if (c.keywords.length || c.faction) {
      h += '<p class="sbx-kw">' + esc(c.keywords.join(', ')) + (c.keywords.length && c.faction ? ' <span class="sbx-dot">·</span> ' : '') + esc(c.faction) + '</p>';
    }
    // A minion's encounter value buys four of them, as the book prints it.
    h += '</div><div class="sbx-rank"><span class="sbx-lvl">' + rank.trim() + '</span>' +
      '<span class="sbx-ev">EV ' + figure(c.ev) + (c.organization === 'minion' && c.ev !== null ? ' <span class="sbx-ev-n">for four</span>' : '') +
      mark(pr.ev, 'Encounter value') + '</span></div></header>';
    // A form's view captions each figure with where it comes from.
    function tg(k) { return o.tag ? o.tag('fig', k) : ''; }
    h += '<div class="sbx-strip">' + cell('Size', esc(c.size), '', tg('size')) + cell('Speed', figure(c.speed), '', tg('speed')) +
      cell('Stamina', figure(c.stamina), mark(pr.stamina, 'Stamina'), tg('stamina')) + cell('Stability', figure(c.stability), '', tg('stability')) +
      cell('Free strike', figure(freeStrikeNumber(c.free_strike) !== null ? freeStrikeNumber(c.free_strike) : c.free_strike), mark(pr.free_strike, 'Free strike'), tg('free_strike')) + '</div>';
    h += '<div class="sbx-strip sbx-chars">' + CHARS.map(function (k) { return cell(cap(k), signed(c[k]), '', tg(k)); }).join('') + '</div>';
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

  // ── Pictures ──────────────────────────────────────────────────────────────

  // A creature's art is its page picture (image_path); its token is the
  // token_image field. Both hold a bare media id: an uploader's link is signed
  // for that one session and expires, while /media/<id> serves any member.
  // Older pages hold a dated path ("2026/03/<id>.jpg"), read the same way.
  var TOKEN_KEY = 'token_image';
  var MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function mediaId(v) {
    var s = String(v == null ? '' : v).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    return MEDIA_ID.test(s) ? s.toLowerCase() : '';
  }
  function mediaSrc(v) { var id = mediaId(v); return id ? '/media/' + id : ''; }

  // The generic monster token stands in wherever a creature has neither picture.
  var GENERIC_TOKEN = '<svg class="sbx-generic" viewBox="0 0 120 120" role="img" aria-label="Generic monster token">' +
    '<circle cx="60" cy="60" r="58" fill="#3f3a36"/><circle cx="60" cy="60" r="51" fill="#c9b79c"/>' +
    '<circle cx="60" cy="60" r="51" fill="none" stroke="#3f3a36" stroke-width="2" stroke-dasharray="3 5"/>' +
    '<path fill="#3f3a36" d="M36 40 L46 52 L50 36 L56 50 L60 32 L64 50 L70 36 L74 52 L84 40 L80 70 C78 86 70 94 60 94 C50 94 42 86 40 70 Z"/>' +
    '<path fill="#c9b79c" d="M49 64 l9 4 l-9 3z M71 64 l-9 4 l9 3z M52 80 l3 5 l3 -5 l2 5 l2 -5 l3 5 l3 -5z"/></svg>';

  // pictures says what a creature shows where: the page and stat block prefer
  // the art, a token prefers the token, and either falls back to the other,
  // then to the generic token.
  function pictures(entity) {
    var e = entity || {}, f = e.fields_data || e.custom_fields || {};
    var art = mediaId(e.image_path), token = mediaId(f[TOKEN_KEY]);
    return { art: art, token: token, page: art || token, tokenShown: token || art };
  }

  function picHtml(id, label, round) {
    return '<span class="sbx-pic' + (round ? ' is-round' : '') + '">' +
      (id ? '<img src="' + esc(mediaSrc(id)) + '" alt="' + esc(label) + '" loading="lazy">' : GENERIC_TOKEN) + '</span>';
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
    // Variants are rows on the page under a tab, not a box: hairlines, quiet
    // words and the theme tokens only, so a style kit and the campaign's
    // colour restyle them like the rest of the page.
    '.sbx-var{margin-top:16px;display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--color-text-body,#374151)}',
    '.sbx-var-tab{margin:0;align-self:flex-start;font-size:12px;font-weight:600;font-variant:small-caps;letter-spacing:.06em;text-transform:lowercase;color:var(--color-text-secondary,#6b7280);padding:0 8px 2px 0;border-bottom:1px solid var(--color-border,#e5e7eb);border-right:1px solid var(--color-border,#e5e7eb)}',
    '.sbx-var-line{margin:0}',
    '.sbx-var a,.sbx-quiet{color:var(--color-accent-link,var(--color-accent,#6366f1))}',
    '.sbx-quiet{background:none;border:0;padding:0 2px;font:inherit;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}',
    '.sbx-quiet:hover{text-decoration-style:solid}',
    '.sbx-quiet:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:2px}',
    '.sbx-var-acts{margin:0;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}',
    '.sbx-var-fold{border-top:1px solid var(--color-border,#e5e7eb);padding-top:8px;display:flex;flex-direction:column;gap:8px}',
    '.sbx-var-q{border:0;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}',
    '.sbx-var-q legend{float:left;margin-right:10px;font-size:12px;font-variant:small-caps;letter-spacing:.06em;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-var-q input[type=radio],.sbx-var-q input[type=checkbox]{accent-color:var(--color-accent,#6366f1)}',
    '.sbx-var-field{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
    '.sbx-var input[type=text]{font:inherit;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--color-border,#e5e7eb);padding:2px 0;min-width:10em}',
    '.sbx-var input[type=text]:focus{outline:none;border-bottom-color:var(--color-accent,#6366f1)}',
    '.sbx-var-row{display:grid;grid-template-columns:minmax(7em,auto) auto 1fr;gap:10px;align-items:baseline;padding:4px 0;border-top:1px solid var(--color-border,#e5e7eb)}',
    '.sbx-var-src .sbx-var-row:first-child{border-top:0}',
    '.sbx-var-s{color:var(--color-text-secondary,#6b7280);font-size:12px;display:flex;flex-wrap:wrap;gap:4px 10px}',
    '.sbx-var-s.is-recipe{color:var(--color-accent-link,var(--color-accent,#6366f1))}',
    '.sbx-var-msg{margin:0;font-size:13px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-var-msg:empty{display:none}',
    '.sbx-var-msg.is-error{color:var(--color-danger,#dc2626)}',
    '@media (max-width:640px){.sbx-var-row{grid-template-columns:1fr auto}.sbx-var-row .sbx-var-s{grid-column:1 / -1}}',
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
    '.sbx-head.has-pic{flex-wrap:nowrap;align-items:center}',
    '.sbx-head.has-pic .sbx-title{flex:1}',
    '.sbx-pic{flex:0 0 72px;width:72px;height:72px;border-radius:8px;overflow:hidden;background:var(--color-bg-tertiary,#f3f4f6);box-shadow:0 0 0 1px var(--color-border,#e5e7eb)}',
    '.sbx-pic.is-round{border-radius:50%;box-shadow:none;background:none}',
    '.sbx-pic img,.sbx-pic svg{display:block;width:100%;height:100%;object-fit:cover}',
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
    '.sbx-forms{display:flex;gap:2px;align-items:flex-end;border-bottom:1px solid var(--color-border,#e5e7eb);overflow-x:auto}',
    '.sbx-tab{display:inline-flex;gap:8px;align-items:center;border:0;border-bottom:2px solid transparent;background:none;padding:8px 12px 6px;min-height:36px;font-size:13px;font-weight:600;color:var(--color-text-secondary,#6b7280);cursor:pointer;white-space:nowrap}',
    '.sbx-tab:hover{color:var(--color-text-primary,#111827)}',
    '.sbx-tab[aria-selected="true"]{color:var(--color-text-primary,#111827);border-bottom-color:var(--sbx-accent,#DC2626)}',
    '.sbx-tab:focus-visible,.sbx-forms-add:focus-visible,.sbx-link:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:2px}',
    '.sbx-tab-n{font:500 11px/1 ui-monospace,Consolas,monospace;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-tab-hid{font-size:11px;opacity:.7}',
    '.sbx-forms-add{border:1px dashed var(--color-border,#d1d5db);background:none;color:var(--color-text-secondary,#6b7280);border-radius:6px;padding:4px 10px;margin:0 0 4px 8px;min-height:32px;font-size:13px;cursor:pointer;white-space:nowrap}',
    '.sbx-forms-add:hover{color:var(--color-accent,#6366f1);border-color:var(--color-accent,#6366f1)}',
    '.sbx-formnote{display:flex;flex-direction:column;gap:6px;font-size:14px}',
    '.sbx-formnote-h{color:var(--color-text-secondary,#6b7280);font-size:13px}',
    '.sbx-formnote-acts{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:flex-end}',
    '.sbx-fstam{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-fstam select{min-width:200px}',
    '.sbx-dm{margin:0;font-size:13px;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-dm-t{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b45309;margin-right:4px}',
    '.dark .sbx-dm-t{color:#fbbf24}',
    '.sbx-from{display:block;max-width:100%;margin-top:2px;font-size:11px;color:var(--color-text-secondary,#6b7280);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sbx-from.is-changed{color:var(--sbx-own);font-weight:600;white-space:normal}',
    '.sbx-chip{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--color-bg-tertiary,#f3f4f6);color:var(--color-text-secondary,#6b7280);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
    '.sbx-chip.is-changed{background:rgba(245,158,11,.14);color:var(--sbx-own)}',
    '.sbx-chip.is-new{background:rgba(var(--color-accent-rgb,99,102,241),.12);color:var(--color-accent,#6366f1)}',
    '.sbx-link{border:0;background:none;padding:0;font:inherit;color:var(--color-accent,#6366f1);text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
    '.sbx-gone{display:flex;flex-direction:column;gap:6px;font-size:14px}',
    '.sbx-gone ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}',
    '.sbx-gone li{display:flex;justify-content:space-between;gap:8px;align-items:baseline;color:var(--color-text-secondary,#6b7280)}',
    '.sbx-gone li>span{text-decoration:line-through;text-decoration-color:rgba(107,114,128,.5)}',
    '@media (max-width:640px){.sbx-head.has-pic{flex-wrap:wrap}.sbx-pic{flex-basis:56px;width:56px;height:56px}}',
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
    TOKEN_KEY: TOKEN_KEY,
    GENERIC_TOKEN: GENERIC_TOKEN,
    mediaId: mediaId,
    mediaSrc: mediaSrc,
    pictures: pictures,
    picHtml: picHtml,
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

// ── Forms ───────────────────────────────────────────────────────────────────

// DrawSteelForms is a creature's other forms, kept apart from its page so a
// player never receives one before the director shows it. The page's fields
// are the first form. Every other form is a list of changes to them, stored as
// the page's system state: `forms` holds the order (gm half) and which forms
// players have been shown and which one is current (public half); each
// `form-<id>` holds one form in its gm half, and the same form in its public
// half once it has been shown. A form a director changes later borrows any
// change made to the first form, because it stores only what differs.
var DrawSteelForms = (function () {
  'use strict';
  var S = DrawSteelStatblock;

  var INDEX_KEY = 'forms';
  var ID = /^[a-z0-9]{1,24}$/;
  var MAX_FORMS = 12;
  var NAME_MAX = 80;
  // The figures a form may change: every scalar the editor writes.
  var FIGURES = ['level', 'organization', 'role', 'ev', 'size', 'keywords', 'faction', 'stamina', 'winded', 'speed',
    'stability', 'immunities', 'weaknesses', 'movement', 'with_captain', 'free_strike'].concat(S.CHARS);
  var LABELS = { ev: 'EV', free_strike: 'Free strike', with_captain: 'With a captain' };
  // Lists a form changes item by item, matched by name.
  var LISTS = [['traits', 't'], ['abilities_json', 'a'], ['villain_actions_json', 'v']];
  var STAMINA = { carry: 'Damage carries over', fresh: 'Starts at full Stamina' };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function label(k) { return LABELS[k] || S.cap(k); }
  function formKey(id) { return 'form-' + id; }

  function scalar(v) {
    return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  }

  // listOf reads a list field the way the stat block does.
  function listOf(fields, key) {
    var v = fields ? fields[key] : undefined;
    if (key === 'traits') {
      if (typeof v === 'string' && v.trim() && !/^\s*\[/.test(v)) return S.normalize({ traits: v }).traits;
    }
    return S.parseObjects(v);
  }

  // canon compares two items by content: key order and the editor's own
  // review marks never count as a change.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter(function (k) { return k !== 'from_ai' && k !== 'from_book' && v[k] !== undefined; }).sort()
        .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function itemName(x) { return String((x && x.name) || '').trim(); }

  // clean reads a stored form defensively; anything malformed is dropped, and
  // a form without a valid id is no form at all.
  function clean(raw) {
    var r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
    if (!r || !ID.test(String(r.id || ''))) return null;
    var f = { id: String(r.id), name: String(r.name || '').trim().slice(0, NAME_MAX) || 'Unnamed form',
      stamina: r.stamina === 'fresh' ? 'fresh' : 'carry', changes: {}, lists: {}, art: S.mediaId(r.art), token: S.mediaId(r.token) };
    var ch = (r.changes && typeof r.changes === 'object') ? r.changes : {};
    FIGURES.forEach(function (k) { if (own(ch, k) && scalar(ch[k])) f.changes[k] = ch[k]; });
    var ls = (r.lists && typeof r.lists === 'object') ? r.lists : {};
    LISTS.forEach(function (l) {
      var d = ls[l[0]];
      if (!d || typeof d !== 'object') return;
      var drop = Array.isArray(d.drop) ? d.drop.map(String).filter(Boolean).slice(0, 50) : [];
      var add = S.parseObjects(d.add);
      if (drop.length || add.length) f.lists[l[0]] = { drop: drop, add: add };
    });
    return f;
  }

  // mergeList lays a form's change to one list over the first form's: a
  // dropped name with an added item of the same name is changed in place,
  // other drops are gone, other adds come last. states runs parallel to items.
  function mergeList(base, d) {
    var drop = (d && d.drop) ? d.drop.slice() : [], add = (d && d.add) ? d.add.slice() : [];
    var items = [], states = [], gone = [];
    base.forEach(function (b) {
      var i = drop.indexOf(itemName(b));
      if (i === -1) { items.push(b); states.push('base'); return; }
      drop.splice(i, 1);
      var j = -1;
      add.forEach(function (a, n) { if (j === -1 && itemName(a) === itemName(b)) j = n; });
      if (j === -1) { gone.push(b); return; }
      items.push(add.splice(j, 1)[0]); states.push('changed');
    });
    add.forEach(function (a) { items.push(a); states.push('new'); });
    return { items: items, states: states, gone: gone };
  }

  // view is a form as the page draws it: the first form's fields with this
  // form's changes laid over, its pictures, and where each figure and item
  // comes from. A form without its own picture borrows the first form's; a
  // form with art but no token lets Foundry crop the art, as a page does.
  function view(fields, picture, form) {
    var base = fields || {}, out = {}, k;
    for (k in base) if (own(base, k)) out[k] = base[k];
    var pic = picture || {};
    if (!form) return { fields: out, art: pic.art || '', token: pic.token || '', changed: {}, states: {}, gone: {} };
    var changed = {};
    for (k in form.changes) if (own(form.changes, k)) { out[k] = form.changes[k]; changed[k] = true; }
    var states = {}, gone = {};
    LISTS.forEach(function (l) {
      var m = mergeList(listOf(base, l[0]), form.lists[l[0]]);
      states[l[1]] = m.states; gone[l[1]] = m.gone;
      if (form.lists[l[0]]) out[l[0]] = JSON.stringify(m.items);
    });
    var art = form.art || pic.art || '';
    var token = form.token || (form.art ? '' : (pic.token || ''));
    out[S.TOKEN_KEY] = token;
    return { fields: out, art: art, token: token, changed: changed, states: states, gone: gone };
  }

  // diffList is the change from one list to another, by name.
  function diffList(base, now) {
    var left = base.slice(), drop = [], add = [];
    now.forEach(function (e) {
      var i = -1;
      left.forEach(function (b, n) { if (i === -1 && itemName(b) === itemName(e)) i = n; });
      if (i === -1) { add.push(e); return; }
      var b = left.splice(i, 1)[0];
      if (canon(b) !== canon(e)) { drop.push(itemName(b)); add.push(e); }
    });
    left.forEach(function (b) { drop.push(itemName(b)); });
    return (drop.length || add.length) ? { drop: drop, add: add } : null;
  }

  // diff is a form saved from the editor: only what differs from the first
  // form's fields, so later changes to the first form still reach it.
  function diff(base, edited) {
    var b = base || {}, e = edited || {}, out = { changes: {}, lists: {} };
    FIGURES.forEach(function (k) {
      if (!own(e, k) || !scalar(e[k])) return;
      if (canon(e[k]) !== canon(own(b, k) ? b[k] : null) && !(e[k] === '' && !own(b, k))) out.changes[k] = e[k];
    });
    LISTS.forEach(function (l) {
      var d = diffList(listOf(b, l[0]), listOf(e, l[0]));
      if (d) out.lists[l[0]] = d;
    });
    return out;
  }

  // summary says what a form changes, in a phrase: "4 figures, its art and its abilities".
  function summary(form) {
    var parts = [], n = Object.keys(form.changes).length;
    if (n) parts.push(n + ' figure' + (n === 1 ? '' : 's'));
    if (form.art) parts.push('its art');
    if (form.token) parts.push('its token');
    if (form.lists.traits) parts.push('its traits');
    if (form.lists.abilities_json) parts.push('its abilities');
    if (form.lists.villain_actions_json) parts.push('its villain actions');
    if (!parts.length) return 'nothing yet';
    return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  function newId(rand) {
    var r = typeof rand === 'function' ? rand : Math.random;
    var id = '';
    while (id.length < 10) id += Math.floor(r() * 36).toString(36);
    return id;
  }

  // index reads the `forms` document: the ids a director has, in order, and
  // the ids players have been shown and the current one.
  function index(doc) {
    var d = doc || {};
    function ids(v) {
      var seen = {};
      return (Array.isArray(v) ? v : []).filter(function (x) {
        if (typeof x !== 'string' || !ID.test(x) || seen[x]) return false;
        seen[x] = true; return true;
      }).slice(0, MAX_FORMS);
    }
    var pub = (d.public && typeof d.public === 'object') ? d.public : {};
    var gm = (d.gm && typeof d.gm === 'object') ? d.gm : null;
    var current = ID.test(String(pub.current || '')) ? String(pub.current) : '';
    return { order: gm ? ids(gm.order) : null, shown: ids(pub.shown), current: current, pub: pub };
  }

  return {
    INDEX_KEY: INDEX_KEY, MAX_FORMS: MAX_FORMS, NAME_MAX: NAME_MAX, FIGURES: FIGURES, LISTS: LISTS, STAMINA: STAMINA,
    formKey: formKey, label: label, clean: clean, view: view, diff: diff, mergeList: mergeList, diffList: diffList, canon: canon,
    summary: summary, newId: newId, index: index
  };
})();

DrawSteelStatblock.Forms = DrawSteelForms;

// ── Variants (a campaign's own homebrew recipes) ────────────────────────────

// DrawSteelVariants turns a creature into a linked variant by a recipe the
// director made, so no variant rule ships in this package. A recipe is a list
// of steps read off a sample creature the director edited; a variant keeps
// only its own changes, so later edits to the original still reach it.
//
// One system-state key, `variant`, gm half only (players never read it):
//   recipe page   {v, recipe: {name, part, label, sample, steps}}
//   variant page  {v, follow: {of, parts: [recipe page ids], base}}
//   any page      {v, children: [variant page ids]}
// `base` is the variant's fields as the original and recipe gave them last
// time, so whatever changed on the page since (the editor, Foundry, the AI
// page) is the director's own change and survives the next refresh.
var DrawSteelVariants = (function () {
  'use strict';
  var S = DrawSteelStatblock, F = DrawSteelForms;

  var KEY = 'variant';
  var ID = /^[A-Za-z0-9_-]{1,64}$/;
  var NAME_MAX = 60;
  var MAX_PARTS = 6;
  var MAX_CHILDREN = 100;
  // Figures the published formulas work out again after a recipe: a recipe
  // never carries them.
  var FORMULA = ['ev', 'stamina', 'free_strike', 'winded'];
  var NUMBERS = ['level', 'speed', 'stability'].concat(S.CHARS);
  var WORDS = ['keywords', 'immunities', 'weaknesses', 'movement'];
  // Organizations ranked by the published organization modifier; a leader
  // ranks with elite, so a leader one step down is a platoon.
  var ORG_LADDER = ['minion', 'horde', 'platoon', 'elite', 'solo'];
  var SIZE_LADDER = ['1T', '1S', '1M', '1L', '2', '3', '4', '5'];
  var LADDERS = { organization: ORG_LADDER, size: SIZE_LADDER };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
  function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || NAME_MAX); }
  function int(v) { var n = Number(v); return (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && isFinite(n) ? Math.round(n) : null; }
  function words(v) { return S.parseList(v).map(function (w) { return String(w).trim(); }).filter(Boolean); }
  function lower(a) { return a.map(function (w) { return w.toLowerCase(); }); }

  function rank(k, v) {
    var lad = LADDERS[k], s = String(v == null ? '' : v).toLowerCase();
    if (!lad) return -1;
    if (k === 'organization' && s === 'leader') s = 'elite';
    for (var i = 0; i < lad.length; i++) if (lad[i].toLowerCase() === s) return i;
    return -1;
  }

  // cleanStep keeps one step's own shape and drops anything else.
  function cleanStep(k, raw) {
    var r = obj(raw);
    if (!r) return null;
    if (r.mode === 'by' && NUMBERS.indexOf(k) !== -1 && int(r.by) !== null && int(r.by) !== 0) return { mode: 'by', by: int(r.by), to: int(r.to) };
    if (r.mode === 'step' && LADDERS[k] && int(r.by) !== null && int(r.by) !== 0) return { mode: 'step', by: int(r.by), to: str(r.to) };
    if (r.mode === 'words' && WORDS.indexOf(k) !== -1) {
      var add = Array.isArray(r.add) ? r.add.map(function (w) { return str(w); }).filter(Boolean).slice(0, 20) : [];
      var drop = Array.isArray(r.drop) ? r.drop.map(function (w) { return str(w); }).filter(Boolean).slice(0, 20) : [];
      return (add.length || drop.length) ? { mode: 'words', add: add, drop: drop } : null;
    }
    if (r.mode === 'set' && (r.to === null || typeof r.to === 'string' || typeof r.to === 'number' || typeof r.to === 'boolean')) {
      var out = { mode: 'set', to: typeof r.to === 'string' ? r.to.slice(0, 500) : r.to };
      var was = obj(r.was) && (r.was.mode === 'by' || r.was.mode === 'step') ? cleanStep(k, r.was) : null;
      if (was) out.was = was;
      return out;
    }
    return null;
  }

  function cleanSteps(raw) {
    var r = obj(raw) || {}, out = { changes: {}, lists: {} };
    var ch = obj(r.changes) || {};
    F.FIGURES.forEach(function (k) {
      if (FORMULA.indexOf(k) !== -1 || !own(ch, k)) return;
      var s = cleanStep(k, ch[k]);
      if (s) out.changes[k] = s;
    });
    var cleaned = F.clean({ id: 'recipe', lists: r.lists });
    out.lists = cleaned ? cleaned.lists : {};
    return out;
  }

  // read takes a stored `variant` document's gm half apart defensively.
  function read(gm) {
    var g = obj(gm) || {}, out = { recipe: null, follow: null, children: [] };
    var rc = obj(g.recipe);
    if (rc && str(rc.name)) {
      out.recipe = { name: str(rc.name), part: rc.part === 'addon' ? 'addon' : 'base', label: str(rc.label),
        sample: ID.test(String(rc.sample || '')) ? String(rc.sample) : '', steps: cleanSteps(rc.steps) };
      if (out.recipe.part === 'addon' && !out.recipe.label) out.recipe.part = 'base';
    }
    var fl = obj(g.follow);
    if (fl && ID.test(String(fl.of || ''))) {
      var seen = {};
      out.follow = { of: String(fl.of), base: obj(fl.base) || {},
        parts: (Array.isArray(fl.parts) ? fl.parts : []).filter(function (p) {
          if (typeof p !== 'string' || !ID.test(p) || seen[p]) return false;
          seen[p] = true; return true;
        }).slice(0, MAX_PARTS) };
    }
    var kids = {};
    out.children = (Array.isArray(g.children) ? g.children : []).filter(function (x) {
      if (typeof x !== 'string' || !ID.test(x) || kids[x]) return false;
      kids[x] = true; return true;
    }).slice(0, MAX_CHILDREN);
    return out;
  }

  // stepsFrom reads a recipe off a sample: what the director changed on it
  // becomes a step that works on any creature. A number moves by the same
  // amount, an organization or size by the same steps, a list of words adds
  // and drops the same words, anything else is set; formula figures are left
  // to the formulas.
  function stepsFrom(sample, edited) {
    var d = F.diff(sample, edited), out = { changes: {}, lists: d.lists };
    Object.keys(d.changes).forEach(function (k) {
      if (FORMULA.indexOf(k) !== -1) return;
      var was = own(sample, k) ? sample[k] : null, now = d.changes[k];
      if (NUMBERS.indexOf(k) !== -1 && int(was) !== null && int(now) !== null) {
        if (int(now) !== int(was)) out.changes[k] = { mode: 'by', by: int(now) - int(was), to: int(now) };
        return;
      }
      if (LADDERS[k] && rank(k, was) !== -1 && rank(k, now) !== -1 && rank(k, now) !== rank(k, was)) {
        out.changes[k] = { mode: 'step', by: rank(k, now) - rank(k, was), to: String(now) };
        return;
      }
      if (WORDS.indexOf(k) !== -1) {
        var a = words(was), b = words(now), la = lower(a), lb = lower(b);
        var add = b.filter(function (w) { return la.indexOf(w.toLowerCase()) === -1; });
        var drop = a.filter(function (w) { return lb.indexOf(w.toLowerCase()) === -1; });
        if (add.length || drop.length) out.changes[k] = { mode: 'words', add: add, drop: drop };
        return;
      }
      out.changes[k] = { mode: 'set', to: now };
    });
    return cleanSteps(out);
  }

  // fixed turns a relative step into "always set to" what the sample got.
  function fixed(step) {
    if (!step || (step.mode !== 'by' && step.mode !== 'step') || step.to === null || step.to === '') return null;
    return { mode: 'set', to: step.to, was: step };
  }

  // applyStep is one step on one creature's value; a relative step on a value
  // it can't move (no number, an organization off the ladder) leaves it.
  function applyStep(k, v, step) {
    if (step.mode === 'set') return step.to;
    if (step.mode === 'by') { var n = int(v); return n === null ? v : n + step.by; }
    if (step.mode === 'step') {
      var lad = LADDERS[k], i = rank(k, v);
      if (i === -1) return v;
      return lad[Math.max(0, Math.min(lad.length - 1, i + step.by))];
    }
    if (step.mode === 'words') {
      var list = words(v).filter(function (w) { return lower(step.drop).indexOf(w.toLowerCase()) === -1; });
      step.add.forEach(function (w) { if (lower(list).indexOf(w.toLowerCase()) === -1) list.push(w); });
      return list.join(', ');
    }
    return v;
  }

  // apply lays a recipe's steps over a creature's fields; only stat block
  // keys change, and a list step changes items by name as a form does.
  function apply(fields, steps) {
    var out = {}, k, st = steps || { changes: {}, lists: {} };
    for (k in fields) if (own(fields, k)) out[k] = fields[k];
    Object.keys(st.changes).forEach(function (key) { out[key] = applyStep(key, own(out, key) ? out[key] : null, st.changes[key]); });
    F.LISTS.forEach(function (l) {
      if (!st.lists[l[0]]) return;
      var m = F.mergeList(listOf(out, l[0]), st.lists[l[0]]);
      out[l[0]] = JSON.stringify(m.items);
    });
    return out;
  }

  function listOf(fields, key) {
    var v = fields ? fields[key] : undefined;
    if (key === 'traits' && typeof v === 'string' && v.trim() && !/^\s*\[/.test(v)) return S.normalize({ traits: v }).traits;
    return S.parseObjects(v);
  }

  // statKeys are the keys a variant's recipe and own changes may touch; the
  // page's other fields (its token, its book source, Stamina in a fight) are
  // its own and never come from the original.
  function statKeys() { return F.FIGURES.concat(F.LISTS.map(function (l) { return l[0]; })); }
  function pick(fields) {
    var out = {};
    statKeys().forEach(function (k) { if (own(fields, k)) out[k] = fields[k]; });
    return out;
  }

  // recompute has the editor work the formula figures out again. Figures the
  // director typed on the original stay typed; Ed is DrawSteelCreatureEditor.
  function recompute(Ed, fields, refs, typed) {
    var st = Ed.newState('', fields, refs);
    Ed.startFrom(st, null, fields);
    st.own = {};
    Object.keys(typed || {}).forEach(function (k) { if (typed[k]) st.own[k] = true; });
    Ed.derive(st);
    return pick(Ed.toSave(st).fields);
  }

  function typedOn(Ed, fields, refs) {
    var st = Ed.newState('', fields, refs), out = {};
    Object.keys(st.own || {}).forEach(function (k) { if (st.own[k]) out[k] = true; });
    return out;
  }

  // base is the variant as the original and the recipe parts give it.
  function base(Ed, original, parts, refs) {
    var f = pick(original || {});
    (parts || []).forEach(function (p) { if (p && p.steps) f = apply(f, p.steps); });
    return recompute(Ed, f, refs, typedOn(Ed, pick(original || {}), refs));
  }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // compact is a base as stored: figures as they are, list items only by
  // name and a hash of their content, so a long stat block still fits in the
  // page's state, and a changed item is still told from an untouched one.
  function compact(b) {
    var out = {};
    F.FIGURES.forEach(function (k) { if (own(b, k)) out[k] = b[k]; });
    F.LISTS.forEach(function (l) {
      out[l[0]] = listOf(b, l[0]).map(function (x) { return { n: String((x && x.name) || '').trim(), h: hash(F.canon(x)) }; });
    });
    return out;
  }

  // listChanges is one list's change from a compact base to the page, by name.
  function listChanges(was, now) {
    var left = (Array.isArray(was) ? was : []).filter(function (x) { return x && typeof x.n === 'string'; }).slice(), drop = [], add = [];
    now.forEach(function (e) {
      var name = String((e && e.name) || '').trim(), i = -1;
      left.forEach(function (b, n) { if (i === -1 && b.n === name) i = n; });
      if (i === -1) { add.push(e); return; }
      var b = left.splice(i, 1)[0];
      if (b.h !== hash(F.canon(e))) { drop.push(name); add.push(e); }
    });
    left.forEach(function (b) { drop.push(b.n); });
    return (drop.length || add.length) ? { drop: drop, add: add } : null;
  }

  // ownChanges is what the page holds that the last base did not. A formula
  // figure that still matches its formula is the formula's, not the
  // director's, so a level change on the variant keeps EV following.
  function ownChanges(lastBase, page, refs) {
    var figs = {}, lb = lastBase || {};
    F.FIGURES.forEach(function (k) { if (own(lb, k)) figs[k] = lb[k]; });
    var d = F.diff(figs, pick(page || {}));
    d.lists = {};
    F.LISTS.forEach(function (l) {
      var c = listChanges(lb[l[0]], listOf(page || {}, l[0]));
      if (c) d.lists[l[0]] = c;
    });
    var pr = S.provenance(S.normalize(page || {}), refs);
    FORMULA.forEach(function (k) {
      if (!own(d.changes, k)) return;
      if (k === 'winded') { var c = S.normalize(page || {}); if (c.stamina !== null && c.winded === Math.floor(c.stamina / 2)) delete d.changes[k]; return; }
      if (pr[k] && pr[k].state === 'formula') delete d.changes[k];
    });
    return d;
  }

  // materialize is the variant's stat block now: the base with the
  // director's own changes laid over, then formulas worked out again for
  // whatever those changes moved.
  function materialize(Ed, original, parts, page, lastBase, refs) {
    var mine = lastBase ? ownChanges(lastBase, page, refs) : { changes: {}, lists: {} };
    var b = base(Ed, original, parts, refs);
    var v = F.view(b, null, { changes: mine.changes, lists: mine.lists, art: '', token: '' }).fields;
    var typed = typedOn(Ed, pick(original || {}), refs);
    FORMULA.forEach(function (k) { if (own(mine.changes, k)) typed[k] = true; });
    var fields = recompute(Ed, pick(v), refs, typed);
    return { base: compact(b), full: b, fields: fields, mine: mine };
  }

  // stale says whether the page's stat block differs from what it should be.
  function stale(page, fields) {
    return statKeys().some(function (k) {
      var a = own(page, k) ? page[k] : null, b = own(fields, k) ? fields[k] : null;
      return JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b === undefined ? null : b);
    });
  }

  // show writes one figure's value the way the stat block does.
  function show(k, v) {
    if (v === null || v === undefined || v === '') return 'empty';
    if (k === 'organization' || k === 'role') return S.cap(v);
    if (S.CHARS.indexOf(k) !== -1 && isFinite(Number(v))) return S.signed(Number(v));
    return String(v);
  }

  function nameFor(recipeName, originalName) {
    return (str(recipeName) + ' of ' + String(originalName || '').trim()).slice(0, 200);
  }

  function partLabel(r) { return r.part === 'addon' ? r.label : r.name; }

  // describe says each step in words, for the recipe page.
  function describe(steps) {
    var rows = [];
    Object.keys(steps.changes).forEach(function (k) {
      var s = steps.changes[k], what = F.label(k), text;
      if (s.mode === 'by') text = (s.by > 0 ? 'up ' : 'down ') + Math.abs(s.by);
      else if (s.mode === 'step') text = Math.abs(s.by) + ' step' + (Math.abs(s.by) === 1 ? '' : 's') + (s.by > 0 ? ' up' : ' down');
      else if (s.mode === 'words') text = [s.add.length ? 'adds ' + s.add.join(', ') : '', s.drop.length ? 'drops ' + s.drop.join(', ') : ''].filter(Boolean).join('; ');
      else text = 'becomes ' + show(k, s.to);
      rows.push({ key: k, what: what, text: text, mode: s.mode, canFix: !!fixed(s), canFree: s.mode === 'set' && !!s.was });
    });
    F.LISTS.forEach(function (l) {
      var d = steps.lists[l[0]];
      if (!d) return;
      var kind = l[0] === 'traits' ? 'trait' : l[0] === 'abilities_json' ? 'ability' : 'villain action';
      var added = d.add.map(function (a) { return a.name; }), changed = added.filter(function (n) { return d.drop.indexOf(n) !== -1; });
      d.add.forEach(function (a) {
        rows.push({ key: l[0], what: S.cap(kind), text: (changed.indexOf(a.name) !== -1 ? 'changes ' : 'adds ') + String(a.name || 'one with no name'), mode: 'list' });
      });
      d.drop.forEach(function (n) { if (added.indexOf(n) === -1) rows.push({ key: l[0], what: S.cap(kind), text: 'drops ' + n + ' if it has one', mode: 'list' }); });
    });
    return rows;
  }

  // sources says where each figure on a variant comes from, for the director.
  function sources(original, b, page, parts) {
    var rows = [], o = pick(original || {}), mine = ownChanges(b, page);
    var byRecipe = {};
    (parts || []).forEach(function (p) {
      if (!p || !p.steps) return;
      Object.keys(p.steps.changes).forEach(function (k) { byRecipe[k] = true; });
      F.LISTS.forEach(function (l) { if (p.steps.lists[l[0]]) byRecipe[l[0]] = true; });
    });
    F.FIGURES.forEach(function (k) {
      if (!own(page, k) && !own(b, k)) return;
      var v = own(page, k) ? page[k] : null;
      if (v === null || v === '' || v === undefined) return;
      var src;
      if (own(mine.changes, k)) src = 'yours';
      else if (byRecipe[k]) src = 'recipe';
      else if (FORMULA.indexOf(k) !== -1) src = 'formula';
      else if (JSON.stringify(o[k]) === JSON.stringify(b[k])) src = 'original';
      else src = 'formula';
      rows.push({ key: k, what: F.label(k), value: v, was: own(o, k) ? o[k] : null, src: src });
    });
    return rows;
  }

  return {
    MAX_BYTES: 15 * 1024, KEY: KEY, ORG_LADDER: ORG_LADDER, SIZE_LADDER: SIZE_LADDER, FORMULA: FORMULA, MAX_PARTS: MAX_PARTS, MAX_CHILDREN: MAX_CHILDREN,
    read: read, cleanSteps: cleanSteps, stepsFrom: stepsFrom, fixed: fixed, apply: apply, base: base, ownChanges: ownChanges,
    materialize: materialize, stale: stale, nameFor: nameFor, partLabel: partLabel, describe: describe, sources: sources,
    pick: pick, rank: rank, show: show, compact: compact
  };
})();

DrawSteelStatblock.Variants = DrawSteelVariants;

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
  // tab is the form on show: '' for the first form, else a form id.
  this.forms = { list: [], shown: [], current: '', loaded: false, error: false, saving: false, tab: '', msg: '', msgKind: '' };
  // vr is what this page is to variants: a recipe, a variant, an original.
  this.vr = { loaded: false, doc: null, kids: [], recipes: null, open: '', pick: '', msg: '', msgHtml: '', msgKind: '', saving: false };
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
      return Promise.all([self.loadForms(), self.isGM ? self.loadVariant() : null]);
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
  if (this.isGM && this.vr.doc && this.vr.doc.recipe) {
    this.el.innerHTML = this.recipeHtml();
    this.bind();
    return;
  }
  // A recipe page has no stat block; wait to learn it is one before offering to build one.
  if (!S.hasStatblock(f) && this.isGM && !this.vr.loaded) { this.el.hidden = true; return; }
  if (!S.hasStatblock(f) && this.isGM && this.vr.error) {
    this.el.innerHTML = '<div class="sbx sbx-start"><p class="sbx-line">Could not read whether this page is a variant recipe. Reload to try again.</p></div>';
    return;
  }
  if (!S.hasStatblock(f)) {
    // A Creature page with no stat block yet: the director gets a way to start
    // one; a player sees nothing rather than an empty card.
    if (!this.isGM) { this.el.hidden = true; return; }
    this.el.innerHTML = '<div class="sbx sbx-start"><p class="sbx-line"><b>' + esc(name) + '</b> has no stat block yet.</p>' +
      '<p class="sbx-line"><button type="button" class="btn-primary btn-sm" data-sbx-act="edit"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i> Build its stat block</button></p></div>';
    this.bind();
    return;
  }
  var form = this.form();
  var bar = '<div class="sbx-bar"><span class="sbx-bar-l"><i class="fa-solid fa-paw" aria-hidden="true"></i> Stat block</span>';
  if (this.isGM && form) {
    bar += '<span class="sbx-bar-r"><button type="button" class="btn-secondary btn-sm" data-sbx-act="form-edit"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i> Edit form</button></span>';
  } else if (this.isGM) {
    bar += '<span class="sbx-bar-r"><button type="button" class="btn-secondary btn-sm" data-sbx-act="edit"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i> Edit stat block</button>' +
      '<button type="button" class="btn-ghost btn-sm" data-sbx-act="publish" aria-expanded="' + (this.publishOpen ? 'true' : 'false') + '"><i class="fa-solid fa-share-nodes mr-1" aria-hidden="true"></i> Publish</button></span>';
  }
  bar += '</div>';
  var pub = (this.isGM && this.publishOpen && !form) ? this.publishHtml() : '';
  var body;
  if (form) {
    var v = DrawSteelForms.view(f, S.pictures(this.entity), form);
    body = this.formNoteHtml(form, v) + S.html(name, v.fields, { ref: this.ref, refs: this.refs, picture: { art: v.art, token: v.token, page: v.art || v.token }, tag: this.tagFor(v) }) +
      this.goneHtml(v);
  } else {
    body = this.sourceHtml() + S.html(name, f, { ref: this.ref, refs: this.refs, picture: S.pictures(this.entity) });
  }
  this.el.innerHTML = '<div class="sbx-wrap">' + bar + pub + this.tabsHtml() + '<div class="sbx-msg" role="status" aria-live="polite"></div>' + body +
    (this.isGM && !form ? '<div data-sbx-fvtt-box>' + S.foundryHtml(f, this.fvtt) + '</div>' + this.variantsHtml() : '') + '</div>';
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

// ── Forms on the page ───────────────────────────────────────────────────────

StatblockPanel.prototype.formUrl = function (key) {
  return '/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(this.eid) + '/system-state/drawsteel/' + key;
};

// loadForms reads the director's forms, or for a player the forms they have
// been shown. A form that fails to load is left out; the first form is
// always there, so nothing here can hide the stat block.
StatblockPanel.prototype.loadForms = function () {
  var self = this, F = DrawSteelForms, S = DrawSteelStatblock, fm = this.forms;
  return S.getJSON(this.formUrl(F.INDEX_KEY)).then(function (doc) {
    var idx = F.index(doc);
    fm.shown = idx.shown; fm.current = idx.current;
    var ids = self.isGM ? (idx.order || []) : idx.shown;
    return Promise.all(ids.map(function (id) {
      return S.getJSON(self.formUrl(F.formKey(id))).then(function (d) {
        var half = self.isGM ? d && d.gm : d && d.public;
        var form = F.clean(half);
        return form && form.id === id ? form : null;
      }, function () { return null; });
    }));
  }).then(function (list) {
    fm.list = list.filter(Boolean);
    fm.loaded = true;
    // A player opens on the form the creature is in at the table.
    if (!self.isGM && fm.current && self.formById(fm.current)) fm.tab = fm.current;
  }, function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not load this creature’s forms', err);
    fm.loaded = true; fm.error = true;
  }).then(function () { if (!self.editor) self.render(); });
};

StatblockPanel.prototype.formById = function (id) {
  var l = this.forms.list;
  for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
};

// form is the form on show, or null for the first form.
StatblockPanel.prototype.form = function () {
  return this.forms.tab ? this.formById(this.forms.tab) : null;
};

StatblockPanel.prototype.baseName = function () {
  return (this.entity && this.entity.name) || 'the first form';
};

// tabsHtml is the strip of forms above the stat block. A creature with one
// form shows no strip to players; the director always has the dashed slot.
StatblockPanel.prototype.tabsHtml = function () {
  var esc = DrawSteelStatblock.esc, fm = this.forms;
  if (!fm.list.length && !(this.isGM && fm.loaded && !fm.error)) return '';
  var tabs = [{ id: '', name: this.baseName() }].concat(fm.list);
  var h = '<div class="sbx-forms" role="tablist" aria-label="Forms">' + tabs.map(function (x, i) {
    var on = (fm.tab || '') === x.id;
    return '<button type="button" role="tab" class="sbx-tab" data-sbx-form="' + esc(x.id) + '" aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '">' +
      '<span class="sbx-tab-n">' + (i + 1) + '</span>' + esc(x.name) +
      (this.isGM && x.id && fm.shown.indexOf(x.id) === -1 ? '<span class="sbx-sr"> (not shown to players)</span><i class="fa-solid fa-eye-slash sbx-tab-hid" aria-hidden="true" title="Not shown to players yet"></i>' : '') + '</button>';
  }, this).join('');
  if (this.isGM && fm.list.length < DrawSteelForms.MAX_FORMS) {
    h += '<button type="button" class="sbx-forms-add" data-sbx-act="form-add"' + (fm.saving ? ' disabled' : '') + '>Add a form</button>';
  }
  return h + '</div>' + (fm.error && this.isGM ? '<p class="sbx-msg is-error">Could not load this creature’s other forms. Reload to try again.</p>' : '');
};

// formNoteHtml says what the form on show changes and, for the director,
// how it starts, how Stamina carries, and whether players have seen it.
StatblockPanel.prototype.formNoteHtml = function (form, v) {
  var S = DrawSteelStatblock, F = DrawSteelForms, esc = S.esc, fm = this.forms;
  var cells = { size: 1, speed: 1, stamina: 1, stability: 1, free_strike: 1 };
  S.CHARS.forEach(function (k) { cells[k] = 1; });
  var also = Object.keys(v.changed).filter(function (k) { return !cells[k]; }).map(F.label);
  var h = '<div class="sbx-formnote"><p class="sbx-line"><b>' + esc(form.name) + '</b> changes ' + esc(F.summary(form)) + '.' +
    (also.length ? ' Also changed: ' + esc(also.join(', ')) + '.' : '') + '</p>';
  if (!this.isGM) return h + '</div>';
  var shown = fm.shown.indexOf(form.id) !== -1;
  h += '<p class="sbx-line sbx-formnote-h">When it starts is up to each encounter, or you by hand from the token in Foundry.</p>' +
    '<div class="sbx-formnote-acts"><label class="sbx-fstam"><span>When it takes this form</span><select class="input" data-sbx-fstam' + (fm.saving ? ' disabled' : '') + '>' +
    Object.keys(F.STAMINA).map(function (k) { return '<option value="' + k + '"' + (form.stamina === k ? ' selected' : '') + '>' + esc(F.STAMINA[k]) + '</option>'; }).join('') + '</select></label>' +
    '<button type="button" class="btn-secondary btn-sm" data-sbx-act="form-show"' + (fm.saving ? ' disabled' : '') + '>' + (shown ? 'Hide from players' : 'Show to players') + '</button>' +
    '<button type="button" class="btn-ghost btn-sm" data-sbx-act="form-remove"' + (fm.saving ? ' disabled' : '') + '>Remove form</button></div>' +
    '<p class="sbx-dm"><span class="sbx-dm-t">Only you see this</span> ' + (shown
      ? 'Players can see this form on the page.'
      : 'Players see this form on the page once it has been shown to them. Until then it isn’t listed for them at all.') + '</p>' +
    (fm.msg ? '<p class="sbx-msg' + (fm.msgKind ? ' is-' + fm.msgKind : '') + '" role="status">' + esc(fm.msg) + '</p>' : '');
  return h + '</div>';
};

// tagFor captions each figure and item of a form with where it comes from.
StatblockPanel.prototype.tagFor = function (v) {
  var esc = DrawSteelStatblock.esc, base = this.baseName(), gm = this.isGM;
  var from = 'From ' + base;
  return function (kind, key) {
    if (kind === 'fig') {
      if (!v.changed[key]) return '<span class="sbx-from" title="' + esc(from) + '">' + esc(from) + '</span>';
      return '<span class="sbx-from is-changed">Changed in this form' +
        (gm ? ' · <button type="button" class="sbx-link" data-sbx-reset="' + esc(key) + '">Use ' + esc(base) + '’s</button>' : '') + '</span>';
    }
    var m = /^([atv])(\d+)$/.exec(key);
    var st = m && v.states[m[1]] ? v.states[m[1]][Number(m[2])] : 'base';
    if (st === 'changed') return '<span class="sbx-chip is-changed">Changed in this form</span>';
    if (st === 'new') return '<span class="sbx-chip is-new">Only in this form</span>';
    return '<span class="sbx-chip">' + esc(from) + '</span>';
  };
};

// goneHtml lists, for the director, what the first form has and this one drops.
StatblockPanel.prototype.goneHtml = function (v) {
  if (!this.isGM) return '';
  var esc = DrawSteelStatblock.esc, rows = [];
  [['t', 'Trait'], ['a', 'Ability'], ['v', 'Villain action']].forEach(function (k) {
    (v.gone[k[0]] || []).forEach(function (x) {
      rows.push('<li><span>' + esc(x.name || 'Untitled') + ' <span class="sbx-kind">' + k[1] + '</span></span>' +
        '<button type="button" class="sbx-link" data-sbx-putback="' + k[0] + '" data-sbx-name="' + esc(x.name || '') + '">Put back</button></li>');
    });
  });
  if (!rows.length) return '';
  return '<section class="sbx-gone"><p class="sbx-sec">Not in this form</p><ul>' + rows.join('') + '</ul></section>';
};

StatblockPanel.prototype.pickForm = function (id) {
  if (id && !this.formById(id)) return;
  this.forms.tab = id || '';
  this.forms.msg = '';
  this.publishOpen = false;
  this.render();
  this.focus('.sbx-tab[aria-selected="true"]');
};

// writeIndex reads the `forms` document fresh and saves it changed by fn, so
// what Foundry wrote there (the current form) survives.
StatblockPanel.prototype.writeIndex = function (fn) {
  var self = this, S = DrawSteelStatblock, F = DrawSteelForms;
  return S.getJSON(this.formUrl(F.INDEX_KEY)).then(function (doc) {
    var idx = F.index(doc);
    var next = fn({ order: idx.order || [], shown: idx.shown, current: idx.current });
    var pub = {}, k;
    for (k in idx.pub) if (Object.prototype.hasOwnProperty.call(idx.pub, k)) pub[k] = idx.pub[k];
    pub.v = 1;
    pub.shown = next.order.filter(function (id) { return next.shown.indexOf(id) !== -1; });
    pub.current = pub.shown.indexOf(next.current) !== -1 ? next.current : '';
    return S.apiFetch(self.formUrl(F.INDEX_KEY), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gm: { v: 1, order: next.order }, public: pub }) }).then(function (res) {
      if (!res.ok) throw new Error('save ' + res.status);
      self.forms.shown = pub.shown; self.forms.current = pub.current;
      return next.order;
    });
  });
};

// writeForm saves one form; players get the same copy once it is shown.
StatblockPanel.prototype.writeForm = function (form, shown) {
  var body = JSON.stringify({ gm: form, public: shown ? form : {} });
  if (body.length > 15 * 1024) {
    var e = new Error('This form is too big to save. Change fewer abilities in it, or make it a creature of its own.');
    e.user = true;
    return Promise.reject(e);
  }
  return DrawSteelStatblock.apiFetch(this.formUrl(DrawSteelForms.formKey(form.id)), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body
  }).then(function (res) { if (!res.ok) throw new Error('save ' + res.status); });
};

// changeForm saves an edit made on the page itself, then redraws.
StatblockPanel.prototype.changeForm = function (form, said) {
  var self = this, fm = this.forms;
  fm.saving = true; fm.msg = 'Saving…'; fm.msgKind = '';
  this.render();
  return this.writeForm(form, fm.shown.indexOf(form.id) !== -1).then(function () {
    var l = fm.list;
    for (var i = 0; i < l.length; i++) if (l[i].id === form.id) l[i] = form;
    fm.msg = said || 'Saved.'; fm.msgKind = 'ok';
  }, function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not save this form', err);
    fm.msg = (err && err.user) ? err.message : 'Could not save that. Try again.'; fm.msgKind = 'error';
  }).then(function () { fm.saving = false; self.render(); });
};

function copyForm(f) { return DrawSteelForms.clean(JSON.parse(JSON.stringify(f))); }

StatblockPanel.prototype.resetFigure = function (key) {
  var form = this.form();
  if (!form || this.forms.saving) return;
  var next = copyForm(form);
  delete next.changes[key];
  this.changeForm(next, 'Now uses ' + this.baseName() + '’s ' + DrawSteelForms.label(key).toLowerCase() + '.');
};

StatblockPanel.prototype.putBack = function (kind, name) {
  var form = this.form(), F = DrawSteelForms;
  if (!form || this.forms.saving) return;
  var key = null;
  F.LISTS.forEach(function (l) { if (l[1] === kind) key = l[0]; });
  var next = copyForm(form), d = key && next.lists[key];
  if (!d || d.drop.indexOf(name) === -1) return;
  d.drop.splice(d.drop.indexOf(name), 1);
  if (!d.drop.length && !d.add.length) delete next.lists[key];
  this.changeForm(next, 'Put back ' + (name || 'it') + '.');
};

StatblockPanel.prototype.setStamina = function (mode) {
  var form = this.form();
  if (!form || this.forms.saving || !DrawSteelForms.STAMINA[mode]) return;
  var next = copyForm(form);
  next.stamina = mode;
  this.changeForm(next, 'Saved.');
};

// toggleShown shows a form to players, or takes it back. The form's public
// copy is written before the index lists it, so a player never sees an id
// with nothing behind it.
StatblockPanel.prototype.toggleShown = function () {
  var self = this, form = this.form(), fm = this.forms;
  if (!form || fm.saving) return;
  var show = fm.shown.indexOf(form.id) === -1;
  fm.saving = true; fm.msg = 'Saving…'; fm.msgKind = '';
  this.render();
  var steps = show
    ? this.writeForm(form, true).then(function () { return self.writeIndex(function (x) { x.shown = x.shown.concat([form.id]); return x; }); })
    : this.writeIndex(function (x) { x.shown = x.shown.filter(function (id) { return id !== form.id; }); return x; })
      .then(function () { return self.writeForm(form, false); });
  steps.then(function () {
    fm.msg = show ? 'Players can now see ' + form.name + '.' : form.name + ' is hidden from players again.'; fm.msgKind = 'ok';
  }, function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not change who sees this form', err);
    fm.msg = 'Could not save that. Try again.'; fm.msgKind = 'error';
  }).then(function () { fm.saving = false; self.render(); self.focus('[data-sbx-act="form-show"]'); });
};

StatblockPanel.prototype.removeForm = function () {
  var self = this, form = this.form(), fm = this.forms;
  if (!form || fm.saving) return;
  if (typeof confirm === 'function' && !confirm('Remove the form ' + form.name + '? Its changes are deleted. The rest of the creature stays as it is.')) return;
  fm.saving = true; fm.msg = 'Removing…'; fm.msgKind = '';
  this.render();
  this.writeIndex(function (x) {
    x.order = x.order.filter(function (id) { return id !== form.id; });
    x.shown = x.shown.filter(function (id) { return id !== form.id; });
    return x;
  }).then(function () {
    fm.list = fm.list.filter(function (f) { return f.id !== form.id; });
    fm.tab = ''; fm.msg = '';
    // The index no longer lists it, so a failure here leaves only an orphan.
    return DrawSteelStatblock.apiFetch(self.formUrl(DrawSteelForms.formKey(form.id)), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gm: {}, public: {} })
    }).catch(function () { return null; });
  }, function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not remove this form', err);
    fm.msg = 'Could not remove that form. Try again.'; fm.msgKind = 'error';
  }).then(function () { fm.saving = false; self.render(); self.focus('.sbx-tab[aria-selected="true"]'); });
};

// editForm opens the editor on a form, or on a new one when form is null.
// The editor sees the form as the page draws it; what it saves is only what
// differs from the first form, and a picture it was only borrowing stays
// borrowed.
StatblockPanel.prototype.editForm = function (form) {
  var self = this, S = DrawSteelStatblock, F = DrawSteelForms, fm = this.forms;
  var Ed = (typeof DrawSteelCreatureEditor !== 'undefined') ? DrawSteelCreatureEditor : null;
  if (!Ed || !Ed.roundTrip) { this.say('The stat block editor did not load. Reload the page to try again.', 'error'); return; }
  var isNew = !form;
  var cur = form || { id: F.newId(), name: 'Form ' + (fm.list.length + 2), stamina: 'carry', changes: {}, lists: {}, art: '', token: '' };
  var v = F.view(this.fields(), S.pictures(this.entity), cur);
  this.el.innerHTML = '';
  var host = this.el.ownerDocument.createElement('div');
  this.el.appendChild(host);
  this.editor = Ed.mount(host, {
    campaignId: this.cid,
    entityId: this.eid,
    entity: { name: cur.name, image_path: v.art, fields_data: v.fields },
    refs: this.refs,
    ref: this.ref,
    form: { heading: isNew ? 'New form' : 'Editing form', nameLabel: 'Form name', dirtyKey: 'monster-builder:form:' + this.eid + ':' + cur.id },
    saveAs: function (out, pics) {
      var base = Ed.roundTrip(self.baseName(), self.fields(), self.refs);
      var d = F.diff(base, out.fields);
      var next = F.clean({ id: cur.id, name: out.name, stamina: cur.stamina, changes: d.changes, lists: d.lists,
        art: pics.art === v.art ? cur.art : pics.art, token: pics.token === v.token ? cur.token : pics.token });
      var shown = fm.shown.indexOf(cur.id) !== -1;
      return self.writeForm(next, shown).then(function () {
        if (!isNew) return null;
        return self.writeIndex(function (x) { if (x.order.indexOf(cur.id) === -1) x.order = x.order.concat([cur.id]); return x; });
      }).then(function () {
        if (isNew) fm.list.push(next);
        else fm.list = fm.list.map(function (f) { return f.id === next.id ? next : f; });
        fm.tab = next.id;
        fm.msg = isNew ? 'Added ' + next.name + '. Players don’t see it until you show it to them.' : 'Saved.';
        fm.msgKind = 'ok';
        return next;
      });
    },
    onClose: function () {
      self.editor = null;
      self.render();
      self.focus('.sbx-tab[aria-selected="true"]');
    }
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
      else if (which === 'form-add') self.editForm(null);
      else if (which === 'form-edit') { if (self.form()) self.editForm(self.form()); }
      else if (which === 'form-show') self.toggleShown();
      else if (which === 'form-remove') self.removeForm();
      else { self.publishOpen = !self.publishOpen; self.render(); }
      return;
    }
    var va = e.target.closest && e.target.closest('[data-sbx-var], [data-sbx-var-fix], [data-sbx-var-free], [data-sbx-var-drop]');
    if (va && self.el.contains(va)) {
      if (va.hasAttribute('data-sbx-var-fix')) { self.editStep('fix', va.getAttribute('data-sbx-var-fix')); return; }
      if (va.hasAttribute('data-sbx-var-free')) { self.editStep('free', va.getAttribute('data-sbx-var-free')); return; }
      if (va.hasAttribute('data-sbx-var-drop')) { self.editStep('drop', va.getAttribute('data-sbx-var-drop')); return; }
      var v = va.getAttribute('data-sbx-var');
      if (v === 'make' || v === 'new') self.openVariantFold(v);
      else if (v === 'sources') { self.vr.open = self.vr.open === 'sources' ? '' : 'sources'; self.render(); self.focus('[data-sbx-var="sources"]'); }
      else if (v === 'go') self.makeVariant();
      else if (v === 'author') self.authorRecipe(null);
      else if (v === 'reedit') self.reeditRecipe();
      return;
    }
    var tab = e.target.closest && e.target.closest('[data-sbx-form]');
    if (tab && self.el.contains(tab)) { self.pickForm(tab.getAttribute('data-sbx-form')); return; }
    var reset = e.target.closest && e.target.closest('[data-sbx-reset]');
    if (reset && self.el.contains(reset)) { self.resetFigure(reset.getAttribute('data-sbx-reset')); return; }
    var back = e.target.closest && e.target.closest('[data-sbx-putback]');
    if (back && self.el.contains(back)) { self.putBack(back.getAttribute('data-sbx-putback'), back.getAttribute('data-sbx-name') || ''); return; }
    var cmp = e.target.closest && e.target.closest('[data-sbx-cmp]');
    if (cmp && self.el.contains(cmp)) { self.take(cmp.getAttribute('data-sbx-cmp')); return; }
    var pub = e.target.closest && e.target.closest('[data-sbx-pub]');
    if (pub && self.el.contains(pub)) self.publish(pub.getAttribute('data-sbx-pub'));
  });
  this.el.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-sbx-fvtt') === 'sendback') self.setSendBack(!!t.checked);
    if (t && t.hasAttribute && t.hasAttribute('data-sbx-fstam')) self.setStamina(t.value);
    if (t && t.hasAttribute && t.hasAttribute('data-sbx-var-recipe')) { self.vr.pick = t.value; self.render(); self.focus('[data-sbx-var-recipe]:checked'); }
  });
  // The form tabs move with the arrow keys, Home and End, as tabs do.
  this.el.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || t.getAttribute('role') !== 'tab') return;
    var tabs = Array.prototype.slice.call(self.el.querySelectorAll('.sbx-tab'));
    var i = tabs.indexOf(t), to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') to = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tabs.length - 1;
    if (to === -1 || !tabs[to]) return;
    e.preventDefault();
    self.pickForm(tabs[to].getAttribute('data-sbx-form'));
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
      if (saved && self.isGM) self.refreshKids();
    }
  });
};

// ── Variants on the page (directors only) ───────────────────────────────────

StatblockPanel.prototype.variantUrl = function (eid) {
  return '/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(eid || this.eid) + '/system-state/drawsteel/' + DrawSteelVariants.KEY;
};

StatblockPanel.prototype.entityUrl = function (eid) {
  return '/api/v1/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(eid || this.eid);
};

StatblockPanel.prototype.pageHref = function (eid) {
  return '/campaigns/' + encodeURIComponent(this.cid) + '/entities/' + encodeURIComponent(eid);
};

// readVariant reads one page's `variant` gm half; a page without one reads empty.
StatblockPanel.prototype.readVariant = function (eid) {
  var S = DrawSteelStatblock, V = DrawSteelVariants;
  return S.getJSON(this.variantUrl(eid)).then(function (d) {
    var gm = d && d.gm && typeof d.gm === 'object' ? d.gm : {};
    return { gm: gm, v: V.read(gm) };
  });
};

// writeVariant lays a change over a page's gm half, keeping its other keys.
StatblockPanel.prototype.writeVariant = function (eid, change) {
  var S = DrawSteelStatblock, self = this;
  // A failed read stops the write: writing the change alone would drop the
  // page's other links.
  return this.readVariant(eid).then(function (cur) {
    var gm = {}, k;
    for (k in cur.gm) if (Object.prototype.hasOwnProperty.call(cur.gm, k)) gm[k] = cur.gm[k];
    change(gm);
    gm.v = 1;
    if (JSON.stringify(gm).length > DrawSteelVariants.MAX_BYTES) throw new Error('variant too large');
    return S.apiFetch(self.variantUrl(eid), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gm: gm }) })
      .then(function (res) { if (!res.ok) throw new Error('variant ' + res.status); return gm; });
  });
};

// putFields saves another page's stat block keys over its current fields.
// The page is read fresh, so a value Foundry or the AI page wrote since it
// loaded survives.
StatblockPanel.prototype.putFields = function (eid, entity, statFields) {
  var S = DrawSteelStatblock, url = this.entityUrl(eid);
  return S.getJSON(url).then(function (cur) {
    var merged = {}, k, now = (cur && cur.fields_data) || {};
    for (k in now) if (Object.prototype.hasOwnProperty.call(now, k)) merged[k] = now[k];
    for (k in statFields) if (Object.prototype.hasOwnProperty.call(statFields, k)) merged[k] = statFields[k];
    var name = (cur && cur.name) || (entity && entity.name) || '';
    return S.apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, fields_data: merged }) })
      .then(function (res) { if (!res.ok) throw new Error('save ' + res.status); return merged; });
  });
};

// loadVariant reads what this page is: a recipe, a variant that follows an
// original (brought up to date now, so the original's edits arrive), and the
// variants made from it.
StatblockPanel.prototype.loadVariant = function () {
  var self = this, S = DrawSteelStatblock, vr = this.vr;
  return this.readVariant().then(function (r) {
    vr.doc = r.v;
    var jobs = [];
    if (r.v.recipe && r.v.recipe.sample) {
      jobs.push(S.getJSON(self.entityUrl(r.v.recipe.sample)).then(function (e) { vr.sampleName = e && e.name ? String(e.name) : ''; }, function () { vr.sampleName = ''; }));
    }
    if (r.v.follow) jobs.push(self.followUp(r.v.follow));
    jobs.push(Promise.all(r.v.children.map(function (id) {
      return S.getJSON(self.entityUrl(id)).then(function (e) { return { id: id, name: e && e.name ? String(e.name) : '' }; }, function () { return null; });
    })).then(function (kids) { vr.kids = kids.filter(Boolean); }));
    return Promise.all(jobs);
  }).catch(function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not read this creature’s variants', err);
    vr.error = true;
  }).then(function () { vr.loaded = true; if (!self.editor) self.render(); });
};

// refresh brings one variant up to date with its original and recipe parts,
// saving only when its stat block would change. It returns what it read, so
// the page it is on can say where each figure comes from.
StatblockPanel.prototype.refresh = function (vid, ventity, follow) {
  var self = this, S = DrawSteelStatblock, V = DrawSteelVariants;
  var Ed = (typeof DrawSteelCreatureEditor !== 'undefined') ? DrawSteelCreatureEditor : null;
  if (!Ed) return Promise.reject(new Error('editor missing'));
  return Promise.all([
    S.getJSON(this.entityUrl(follow.of)),
    Promise.all(follow.parts.map(function (id) {
      // A recipe that can't be read stops the refresh; one that is gone (its
      // page deleted) is simply no longer applied.
      return self.readVariant(id).then(function (r) { return r.v.recipe ? { id: id, recipe: r.v.recipe, steps: r.v.recipe.steps } : null; }, function (err) {
        if (err && /-> 404$/.test(String(err.message))) return null;
        throw err;
      });
    }))
  ]).then(function (x) {
    var orig = x[0], parts = x[1].filter(Boolean);
    var page = (ventity && ventity.fields_data) || {};
    var m = V.materialize(Ed, (orig && orig.fields_data) || {}, parts, page, follow.base, self.refs);
    var out = { original: orig, parts: parts, base: m.base, fields: m.fields };
    if (!V.stale(page, m.fields) && JSON.stringify(follow.base) === JSON.stringify(m.base)) { out.fields = V.pick(page); return out; }
    return self.putFields(vid, ventity, m.fields).then(function (merged) {
      if (vid === self.eid && self.entity) self.entity.fields_data = merged;
      return self.writeVariant(vid, function (gm) {
        gm.follow = { of: follow.of, parts: follow.parts, base: m.base };
      });
    }).then(function () { return out; });
  });
};

StatblockPanel.prototype.followUp = function (follow) {
  var vr = this.vr;
  return this.refresh(this.eid, this.entity, follow).then(function (out) {
    vr.original = out.original ? { id: follow.of, name: String(out.original.name || '') } : null;
    vr.parts = out.parts;
    vr.base = out.base;
    vr.origFields = (out.original && out.original.fields_data) || {};
  }, function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not bring this variant up to date', err);
    vr.msg = err && err.message === 'editor missing'
      ? 'The stat block editor did not load, so this page may be behind its original. Reload to try again.'
      : err && err.message === 'variant too large'
        ? 'This variant’s stat block is too long to keep following its original. Its figures are saved; shorten its abilities to link it again.'
        : 'Could not read the original or its recipe, so this page may be behind. Reload to try again.';
    vr.msgKind = 'error';
  });
};

// refreshKids passes a saved edit on to every variant made from this page.
StatblockPanel.prototype.refreshKids = function () {
  var self = this, S = DrawSteelStatblock, vr = this.vr;
  var ids = (vr.doc && vr.doc.children) || [];
  if (!ids.length) return Promise.resolve();
  var failed = 0;
  return Promise.all(ids.map(function (id) {
    return Promise.all([S.getJSON(self.entityUrl(id)), self.readVariant(id)]).then(function (x) {
      if (!x[1].v.follow || x[1].v.follow.of !== self.eid) return null;
      return self.refresh(id, x[0], x[1].v.follow);
    }).catch(function () { failed++; });
  })).then(function () {
    if (failed) { vr.msg = failed + ' of its variants could not be brought up to date. Opening one updates it.'; vr.msgKind = 'error'; self.render(); }
  });
};

// loadRecipes lists the campaign's recipe pages, once per page view.
StatblockPanel.prototype.loadRecipes = function () {
  var self = this, S = DrawSteelStatblock, V = DrawSteelVariants, vr = this.vr;
  if (vr.recipes) return Promise.resolve(vr.recipes);
  return S.getJSON('/campaigns/' + encodeURIComponent(this.cid) + '/system-state/drawsteel/' + V.KEY).then(function (d) {
    var items = (d && Array.isArray(d.items)) ? d.items : [];
    vr.recipes = items.map(function (it) {
      var r = V.read(it && it.gm).recipe;
      return r && it.entityId ? { id: String(it.entityId), page: String(it.entityName || ''), recipe: r } : null;
    }).filter(Boolean);
    vr.truncated = !!(d && d.truncated);
    return vr.recipes;
  });
};

// recipeNames is each recipe once, its base part first.
StatblockPanel.prototype.recipeGroups = function () {
  var groups = {}, order = [];
  (this.vr.recipes || []).forEach(function (r) {
    var key = r.recipe.name.toLowerCase();
    if (!groups[key]) { groups[key] = { name: r.recipe.name, base: null, addons: [] }; order.push(key); }
    if (r.recipe.part === 'base' && !groups[key].base) groups[key].base = r;
    else if (r.recipe.part === 'addon') groups[key].addons.push(r);
  });
  return order.map(function (k) { return groups[k]; }).filter(function (g) { return g.base; });
};

StatblockPanel.prototype.openVariantFold = function (which) {
  var self = this, vr = this.vr;
  vr.open = vr.open === which ? '' : which;
  vr.msg = ''; vr.msgKind = '';
  if (!vr.open) { this.render(); this.focus('[data-sbx-var="' + which + '"]'); return; }
  vr.loading = true;
  this.render();
  this.loadRecipes().catch(function () { vr.listError = true; }).then(function () {
    vr.loading = false;
    var g = self.recipeGroups();
    if (!vr.pick && g.length) vr.pick = g[0].name.toLowerCase();
    self.render();
    self.focus('.sbx-var-fold input, .sbx-var-fold button');
  });
};

// variantsHtml is the director's Variants section under the stat block.
StatblockPanel.prototype.variantsHtml = function () {
  var S = DrawSteelStatblock, esc = S.esc, vr = this.vr, self = this;
  if (!this.isGM || !vr.loaded) return '';
  var out = '<section class="sbx-var" aria-label="Variants"><h4 class="sbx-var-tab">Variants</h4>';
  var d = vr.doc || {};
  if (d.follow && vr.original) {
    var parts = (vr.parts || []).map(function (p) { return DrawSteelVariants.partLabel(p.recipe); });
    out += '<p class="sbx-var-line">Follows <a href="' + esc(this.pageHref(vr.original.id)) + '">' + esc(vr.original.name || 'its original') + '</a>' +
      (parts.length ? ' · ' + esc(parts.join(', ')) : '') + '. Changes to the original reach this page unless you changed the same thing here.' +
      ' <button type="button" class="sbx-quiet" data-sbx-var="sources" aria-expanded="' + (vr.open === 'sources') + '">Where each figure comes from</button></p>';
    if (vr.open === 'sources') out += this.sourcesHtml();
  }
  if (vr.kids && vr.kids.length) {
    out += '<p class="sbx-var-line">Made from it: ' + vr.kids.map(function (k) {
      return '<a href="' + esc(self.pageHref(k.id)) + '">' + esc(k.name || 'a variant') + '</a>';
    }).join(', ') + '</p>';
  }
  out += '<p class="sbx-var-acts"><button type="button" class="sbx-quiet" data-sbx-var="make" aria-expanded="' + (vr.open === 'make') + '">Make a variant</button>' +
    '<button type="button" class="sbx-quiet" data-sbx-var="new" aria-expanded="' + (vr.open === 'new') + '">New recipe from this creature</button></p>';
  if (vr.open === 'make') out += this.makeHtml();
  if (vr.open === 'new') out += this.newRecipeHtml();
  out += '<p class="sbx-var-msg' + (vr.msgKind ? ' is-' + vr.msgKind : '') + '" role="status" aria-live="polite">' + (vr.msgHtml || esc(vr.msg || '')) + '</p></section>';
  return out;
};

StatblockPanel.prototype.sourcesHtml = function () {
  var S = DrawSteelStatblock, esc = S.esc, vr = this.vr;
  var rows = DrawSteelVariants.sources(vr.origFields, vr.base || {}, this.fields(), vr.parts);
  var show = DrawSteelVariants.show;
  var text = { yours: 'changed by you', original: 'from the original', formula: 'published formula' };
  return '<div class="sbx-var-fold sbx-var-src">' + rows.map(function (r) {
    var src = r.src === 'recipe'
      ? 'recipe' + (r.was !== null && r.was !== '' && r.was !== undefined ? ' (was ' + show(r.key, r.was) + ')' : '')
      : text[r.src];
    return '<div class="sbx-var-row"><span>' + esc(r.what) + '</span><b>' + esc(show(r.key, r.value)) + '</b><span class="sbx-var-s is-' + esc(r.src) + '">' + esc(src) + '</span></div>';
  }).join('') + '</div>';
};

StatblockPanel.prototype.makeHtml = function () {
  var S = DrawSteelStatblock, esc = S.esc, vr = this.vr, self = this;
  if (vr.loading) return '<div class="sbx-var-fold"><p class="sbx-var-line">Reading this campaign’s recipes…</p></div>';
  if (vr.listError) return '<div class="sbx-var-fold"><p class="sbx-var-line">Could not read this campaign’s recipes. Try again.</p></div>';
  var groups = this.recipeGroups();
  if (!groups.length) return '<div class="sbx-var-fold"><p class="sbx-var-line">No recipes yet. Use <b>New recipe from this creature</b> to make one: change this creature the way the recipe should, and every step is read from what you changed.</p></div>';
  var g = null;
  groups.forEach(function (x) { if (x.name.toLowerCase() === vr.pick) g = x; });
  g = g || groups[0];
  var name = DrawSteelVariants.nameFor(g.name, this.entity && this.entity.name);
  var out = '<div class="sbx-var-fold"><fieldset class="sbx-var-q"><legend>Recipe</legend>' + groups.map(function (x) {
    return '<label><input type="radio" name="sbx-var-recipe-' + esc(self.eid) + '" value="' + esc(x.name.toLowerCase()) + '" data-sbx-var-recipe' +
      (x === g ? ' checked' : '') + '> ' + esc(x.name) + '</label>';
  }).join('') + '</fieldset>';
  if (g.addons.length) {
    out += '<fieldset class="sbx-var-q"><legend>Add-ons</legend>' + g.addons.map(function (a) {
      return '<label><input type="checkbox" value="' + esc(a.id) + '" data-sbx-var-addon> ' + esc(a.recipe.label) + '</label>';
    }).join('') + '</fieldset>';
  }
  if (vr.truncated) out += '<p class="sbx-var-line">Only the first 200 recipe pages are listed.</p>';
  out += '<p class="sbx-var-line">Makes a new page, <b>' + esc(name) + '</b>, that follows this one. You can rename it.</p>' +
    '<p class="sbx-var-acts"><button type="button" class="btn-primary btn-sm" data-sbx-var="go"' + (vr.saving ? ' disabled' : '') + '>Make the variant</button></p></div>';
  return out;
};

StatblockPanel.prototype.newRecipeHtml = function () {
  var S = DrawSteelStatblock, esc = S.esc, vr = this.vr, eid = esc(this.eid);
  var names = this.recipeGroups().map(function (g) { return '<option value="' + esc(g.name) + '"></option>'; }).join('');
  return '<div class="sbx-var-fold">' +
    '<p class="sbx-var-line">You change this creature the way the recipe should, and each change becomes a step that works on any creature: a number moves by the same amount, an organization or size by the same steps. This creature itself is not changed.</p>' +
    '<label class="sbx-var-field">Recipe name <input type="text" maxlength="60" list="sbx-var-names-' + eid + '" data-sbx-var-name placeholder="Name this recipe"></label>' +
    '<datalist id="sbx-var-names-' + eid + '">' + names + '</datalist>' +
    '<fieldset class="sbx-var-q"><legend>This is</legend>' +
    '<label><input type="radio" name="sbx-var-part-' + eid + '" value="base" checked data-sbx-var-part> the recipe itself</label>' +
    '<label><input type="radio" name="sbx-var-part-' + eid + '" value="addon" data-sbx-var-part> an add-on to it, called <input type="text" maxlength="60" data-sbx-var-label placeholder="add-on name" aria-label="Add-on name"></label></fieldset>' +
    '<p class="sbx-var-acts"><button type="button" class="btn-primary btn-sm" data-sbx-var="author">Change this creature to show it</button></p></div>';
};

// makeVariant makes the new page, links it to this one and to its recipe
// parts, and tells the director where it is.
StatblockPanel.prototype.makeVariant = function () {
  var self = this, V = DrawSteelVariants, vr = this.vr, esc = DrawSteelStatblock.esc;
  var g = null;
  this.recipeGroups().forEach(function (x) { if (x.name.toLowerCase() === vr.pick) g = x; });
  if (typeof DrawSteelCreatureEditor === 'undefined') { vr.msg = 'The stat block editor did not load. Reload the page to try again.'; vr.msgKind = 'error'; this.render(); return; }
  if (!g || vr.saving) return;
  var ticked = Array.prototype.slice.call(this.el.querySelectorAll('[data-sbx-var-addon]')).filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
  var parts = [g.base].concat(g.addons.filter(function (a) { return ticked.indexOf(a.id) !== -1; })).slice(0, V.MAX_PARTS);
  var made = { id: null, name: V.nameFor(g.name, this.entity && this.entity.name) };
  vr.saving = true; vr.msg = 'Making ' + made.name + '…'; vr.msgKind = ''; vr.msgHtml = '';
  this.render();
  this.makeLinked(parts, made).then(function () {
    vr.doc.children = (vr.doc.children || []).concat([made.id]);
    vr.kids = (vr.kids || []).concat([{ id: made.id, name: made.name }]);
    vr.open = '';
    vr.msgHtml = 'Made <a href="' + esc(self.pageHref(made.id)) + '">' + esc(made.name) + '</a>.';
    vr.msgKind = 'ok';
  }).catch(function (err) {
    if (typeof console !== 'undefined') console.warn('Stat block: could not make the variant', err);
    vr.msgHtml = made.id ? 'Made <a href="' + esc(self.pageHref(made.id)) + '">' + esc(made.name) + '</a>, but could not link it to this page' +
      (err && err.message === 'variant too large' ? ', because its stat block is too long to follow its original. It stays as a plain copy.' : '. Delete it and try again.') : '';
    vr.msg = 'Could not make the variant. Try again.';
    vr.msgKind = 'error';
  }).then(function () { vr.saving = false; self.render(); self.focus('.sbx-var-msg a, [data-sbx-var="make"]'); });
};

// makeLinked makes this creature's variant by the given recipe parts
// ({id, recipe}) as a new page that follows it, and links it back here.
// made.name is the new page's name; made.id is set as soon as the page
// exists, so a caller can name a page that was made but not linked.
StatblockPanel.prototype.makeLinked = function (parts, made) {
  var self = this, S = DrawSteelStatblock, V = DrawSteelVariants;
  var m = V.materialize(DrawSteelCreatureEditor, this.fields(), parts.map(function (p) { return { steps: p.recipe.steps }; }), {}, null, this.refs);
  var fields = {}, k;
  for (k in m.fields) if (Object.prototype.hasOwnProperty.call(m.fields, k)) fields[k] = m.fields[k];
  if (this.fields()[S.TOKEN_KEY]) fields[S.TOKEN_KEY] = this.fields()[S.TOKEN_KEY];
  return S.apiFetch('/api/v1/campaigns/' + encodeURIComponent(this.cid) + '/entities', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: made.name, entity_type_id: this.entity.entity_type_id, is_private: this.entity.is_private === true, fields_data: fields })
  }).then(function (res) {
    if (!res.ok) throw new Error('create ' + res.status);
    return res.json();
  }).then(function (page) {
    made.id = page && page.id ? String(page.id) : null;
    if (!made.id) throw new Error('create returned no id');
    return self.writeVariant(made.id, function (gm) { gm.follow = { of: self.eid, parts: parts.map(function (p) { return p.id; }), base: m.base }; });
  }).then(function () {
    return self.writeVariant(self.eid, function (gm) {
      var kids = Array.isArray(gm.children) ? gm.children.slice(0, V.MAX_CHILDREN - 1) : [];
      if (kids.indexOf(made.id) === -1) kids.push(made.id);
      gm.children = kids;
    });
  }).then(function () { return made; });
};

// authorRecipe opens the editor on this creature; what the director saves is
// read as recipe steps on a new private page, and this creature is untouched.
StatblockPanel.prototype.authorRecipe = function (existing) {
  var self = this, S = DrawSteelStatblock, V = DrawSteelVariants, vr = this.vr, esc = S.esc;
  var Ed = (typeof DrawSteelCreatureEditor !== 'undefined') ? DrawSteelCreatureEditor : null;
  if (!Ed || !Ed.roundTrip) { vr.msg = 'The stat block editor did not load. Reload the page to try again.'; vr.msgKind = 'error'; this.render(); return; }
  var recipe = existing ? existing.recipe : null;
  if (!recipe) {
    var nameEl = this.el.querySelector('[data-sbx-var-name]'), partEl = this.el.querySelector('[data-sbx-var-part]:checked'), labelEl = this.el.querySelector('[data-sbx-var-label]');
    var rname = nameEl ? String(nameEl.value || '').trim().slice(0, 60) : '';
    var part = partEl && partEl.value === 'addon' ? 'addon' : 'base';
    var label = labelEl ? String(labelEl.value || '').trim().slice(0, 60) : '';
    if (!rname) { vr.msg = 'Give the recipe a name first.'; vr.msgKind = 'error'; this.render(); this.focus('[data-sbx-var-name]'); return; }
    if (part === 'addon' && !label) { vr.msg = 'Give the add-on a name first.'; vr.msgKind = 'error'; this.render(); this.focus('[data-sbx-var-label]'); return; }
    recipe = { name: rname, part: part, label: label, sample: this.eid, steps: { changes: {}, lists: {} } };
  }
  var sampleFields = existing ? existing.sampleFields : this.fields();
  var sampleName = existing ? existing.sampleName : ((this.entity && this.entity.name) || '');
  var start = V.apply(Ed.roundTrip(sampleName, sampleFields, this.refs), recipe.steps);
  var title = recipe.part === 'addon' ? recipe.name + ': ' + recipe.label : recipe.name;
  this.el.innerHTML = '';
  var host = this.el.ownerDocument.createElement('div');
  this.el.appendChild(host);
  this.editor = Ed.mount(host, {
    campaignId: this.cid,
    entityId: existing ? existing.sampleId : this.eid,
    entity: { name: sampleName, image_path: '', fields_data: start },
    refs: this.refs,
    ref: this.ref,
    form: { heading: title + ' recipe, shown on ' + sampleName, nameLabel: 'Name (not saved)', dirtyKey: 'monster-builder:recipe:' + this.eid },
    saveAs: function (out) {
      var steps = V.stepsFrom(Ed.roundTrip(sampleName, sampleFields, self.refs), out.fields);
      var next = { name: recipe.name, part: recipe.part, label: recipe.label, sample: existing ? existing.sampleId : self.eid, steps: steps };
      if (existing) return self.writeVariant(self.eid, function (gm) { gm.recipe = next; }).then(function () { self.vr.doc.recipe = V.read({ recipe: next }).recipe; return next; });
      return S.apiFetch('/api/v1/campaigns/' + encodeURIComponent(self.cid) + '/entities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title + ' (recipe)', entity_type_id: self.entity.entity_type_id, is_private: true, fields_data: {} })
      }).then(function (res) {
        if (!res.ok) throw new Error('create ' + res.status);
        return res.json();
      }).then(function (made) {
        var id = made && made.id ? String(made.id) : null;
        if (!id) throw new Error('create returned no id');
        return self.writeVariant(id, function (gm) { gm.recipe = next; }).catch(function (err) {
          vr.msgHtml = 'Made the page <a href="' + esc(self.pageHref(id)) + '">' + esc(title + ' (recipe)') + '</a> but could not save the recipe on it' +
            (err && err.message === 'variant too large' ? ', because it is too long. Make it with fewer or shorter changes.' : '. Delete that page and try again.');
          vr.msgKind = 'error';
          throw err;
        }).then(function () {
          vr.recipes = null; vr.open = '';
          vr.msgHtml = 'Saved the recipe on its own page, <a href="' + esc(self.pageHref(id)) + '">' + esc(title + ' (recipe)') + '</a>, which only directors see. ' +
            (Object.keys(steps.changes).length || Object.keys(steps.lists).length ? '' : 'You changed nothing, so it has no steps yet.');
          vr.msgKind = 'ok';
          return next;
        });
      });
    },
    onClose: function () { self.editor = null; self.render(); self.focus('.sbx-var-msg a, [data-sbx-var="new"]'); }
  });
};

// ── The recipe page ──

StatblockPanel.prototype.recipeHtml = function () {
  var S = DrawSteelStatblock, esc = S.esc, V = DrawSteelVariants, vr = this.vr, r = vr.doc.recipe;
  var rows = V.describe(r.steps);
  var title = r.part === 'addon' ? 'Add-on <b>' + esc(r.label) + '</b> to the recipe <b>' + esc(r.name) + '</b>' : 'The recipe <b>' + esc(r.name) + '</b>';
  var out = '<div class="sbx-wrap"><div class="sbx-bar"><span class="sbx-bar-l"><i class="fa-solid fa-flask" aria-hidden="true"></i> Variant recipe</span></div>' +
    '<section class="sbx-var"><p class="sbx-var-line">' + title + '. Players never see a recipe. Use <b>Make a variant</b> on any creature’s page to apply it.</p>';
  out += rows.length ? '<div class="sbx-var-src">' + rows.map(function (x, i) {
    var acts = '';
    if (x.canFix) acts += '<button type="button" class="sbx-quiet" data-sbx-var-fix="' + esc(x.key) + '">always ' + esc(V.show(x.key, r.steps.changes[x.key].to)) + ' instead</button>';
    if (x.canFree) acts += '<button type="button" class="sbx-quiet" data-sbx-var-free="' + esc(x.key) + '">' + (r.steps.changes[x.key].was.mode === 'step' ? 'move by steps instead' : 'move by the amount instead') + '</button>';
    if (x.mode !== 'list') acts += '<button type="button" class="sbx-quiet" data-sbx-var-drop="' + esc(x.key) + '">remove</button>';
    return '<div class="sbx-var-row" data-i="' + i + '"><span>' + esc(x.what) + '</span><b>' + esc(x.text) + '</b><span class="sbx-var-s">' + acts + '</span></div>';
  }).join('') + '</div>' : '<p class="sbx-var-line">No steps yet.</p>';
  out += '<p class="sbx-var-acts"><button type="button" class="sbx-quiet" data-sbx-var="reedit">' +
    (vr.sampleName ? 'Change it on ' + esc(vr.sampleName) : 'Change it on its sample creature') + '</button></p>' +
    '<p class="sbx-var-msg' + (vr.msgKind ? ' is-' + vr.msgKind : '') + '" role="status" aria-live="polite">' + (vr.msgHtml || esc(vr.msg || '')) + '</p></section></div>';
  return out;
};

// editStep switches one step between relative and fixed, or removes it.
StatblockPanel.prototype.editStep = function (how, key) {
  var self = this, V = DrawSteelVariants, vr = this.vr, r = vr.doc.recipe;
  var s = r.steps.changes[key];
  if (!s) return;
  var steps = { changes: {}, lists: r.steps.lists };
  Object.keys(r.steps.changes).forEach(function (k) { if (k !== key) steps.changes[k] = r.steps.changes[k]; });
  if (how === 'fix') steps.changes[key] = V.fixed(s);
  else if (how === 'free' && s.was) steps.changes[key] = s.was;
  if (how !== 'drop' && !steps.changes[key]) return;
  var next = { name: r.name, part: r.part, label: r.label, sample: r.sample, steps: V.cleanSteps(steps) };
  vr.msg = 'Saving…'; vr.msgKind = ''; vr.msgHtml = '';
  this.render();
  this.writeVariant(this.eid, function (gm) { gm.recipe = next; }).then(function () {
    vr.doc.recipe = V.read({ recipe: next }).recipe;
    vr.msg = 'Saved. Variants made with it change when their page is next opened, or their original is next saved.'; vr.msgKind = 'ok';
  }, function () { vr.msg = 'Could not save that. Try again.'; vr.msgKind = 'error'; }).then(function () { self.render(); });
};

StatblockPanel.prototype.reeditRecipe = function () {
  var self = this, S = DrawSteelStatblock, vr = this.vr, r = vr.doc.recipe;
  if (!r.sample) { vr.msg = 'This recipe has no sample creature. Make a new recipe from a creature’s page.'; vr.msgKind = 'error'; this.render(); return; }
  S.getJSON(this.entityUrl(r.sample)).then(function (e) {
    self.authorRecipe({ recipe: r, sampleId: r.sample, sampleName: String((e && e.name) || ''), sampleFields: (e && e.fields_data) || {} });
  }, function () { vr.msg = 'Could not open its sample creature. It may have been deleted; make the recipe again from another creature.'; vr.msgKind = 'error'; self.render(); });
};

StatblockPanel.prototype.destroy = function () {
  if (this.editor && this.editor.destroy) this.editor.destroy();
  this.editor = null;
};

DrawSteelStatblock.Panel = StatblockPanel;

// ── Rise as a variant (a Homebrew Workshop action) ──────────────────────────

// DrawSteelRise is the browser side of the Workshop's `rise-as-variant`
// action. A campaign's own rule ("when a marked creature dies, it rises as
// its variant") is held in the Homebrew drawer, and when the director presses
// Run the drawer calls this: only this package can work a variant's stat
// block out. The rule's creature-mark part names the recipe, its add-ons and
// the marked creatures; the run's scope is the creature that died. The new
// page is recorded on the mark, so one creature never rises twice.
var DrawSteelRise = (function () {
  'use strict';
  var MARK = 'creature-mark';

  // plain is a failure the director can read as it is; any other one (a
  // network or server answer) is put in words by run.
  function plain(msg) { var e = new Error(msg); e.plain = true; return e; }

  function recipeUrl(cid, rid) {
    return '/campaigns/' + encodeURIComponent(cid) + '/homebrew/recipes/' + encodeURIComponent(rid);
  }

  // markOf finds the step's mark part in a Workshop recipe.
  function markOf(recipe, key) {
    var parts = (recipe && recipe.doc && Array.isArray(recipe.doc.parts)) ? recipe.doc.parts : [];
    for (var i = 0; i < parts.length; i++) if (parts[i] && parts[i].key === key && parts[i].kind === MARK) return parts[i];
    return null;
  }

  // record writes the new variant onto the mark, reading the recipe fresh
  // and trying once more if someone saved it in between.
  function record(cid, rid, key, from, to, tries) {
    var S = DrawSteelStatblock;
    return S.getJSON(recipeUrl(cid, rid)).then(function (r) {
      var part = markOf(r, key);
      if (!part) throw plain('its mark is gone from the recipe.');
      var d = part.data || {};
      d.variants = d.variants || {};
      d.variants[from] = to;
      part.data = d;
      return S.apiFetch(recipeUrl(cid, rid), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: r.name, doc: r.doc, version: r.version }) });
    }).then(function (res) {
      if (res.status === 409 && tries > 1) return record(cid, rid, key, from, to, tries - 1);
      if (!res.ok) throw plain('could not note the variant on the mark.');
    });
  }

  // run raises the creature named by the run, and says what happened in one
  // line for the drawer. A failure throws with the reason in plain words.
  function run(ctx) {
    var S = DrawSteelStatblock, V = DrawSteelVariants;
    var cid = ctx && ctx.campaignId ? String(ctx.campaignId) : '';
    var r = (ctx && ctx.run) || {}, step = (ctx && ctx.step) || {};
    var rid = r.recipeId ? String(r.recipeId) : '', eid = r.scope ? String(r.scope) : '';
    if (!cid || !rid || !eid) return Promise.reject(plain('it does not say which creature died.'));
    if (typeof DrawSteelCreatureEditor === 'undefined') return Promise.reject(plain('the stat block editor did not load. Reload the page to try again.'));
    var p = Object.create(StatblockPanel.prototype);
    p.cid = cid; p.eid = eid;
    var mark, made;
    return S.getJSON(recipeUrl(cid, rid)).then(function (recipe) {
      var part = markOf(recipe, step.part);
      if (!part) throw plain('its mark is gone from the recipe.');
      mark = part.data || {};
      return Promise.all([S.getJSON(p.entityUrl(eid)), S.loadRefs(cid)]);
    }).then(function (x) {
      p.entity = x[0] || {};
      p.refs = x[1];
      var name = String(p.entity.name || 'The creature');
      if ((mark.marked || []).indexOf(eid) === -1) return name + ' is not marked, so nothing rose.';
      if (mark.variants && mark.variants[eid]) return name + ' has already risen.';
      var ids = [mark.recipe].concat(mark.addons || []).slice(0, V.MAX_PARTS);
      return Promise.all(ids.map(function (id) {
        return p.readVariant(id).then(function (rv) { return rv.v.recipe ? { id: id, recipe: rv.v.recipe } : null; });
      })).then(function (parts) {
        if (!parts[0] || parts[0].recipe.part !== 'base') throw plain('its recipe page is no longer a recipe.');
        parts = parts.filter(Boolean);
        made = { id: null, name: V.nameFor(parts[0].recipe.name, name) };
        return p.makeLinked(parts, made);
      }).then(function () {
        return record(cid, rid, step.part, eid, made.id, 2);
      }).then(function () {
        return name + ' rose as ' + made.name + '.';
      });
    }).catch(function (err) {
      if (typeof console !== 'undefined') console.warn('Rise as its variant:', err);
      var why = err && err.plain ? err.message : made ? 'could not make its variant page.' : 'could not read the recipe or the creature.';
      if (made && made.id) throw plain('made ' + made.name + ', but ' + (err && err.plain ? err.message : 'could not link it to its original.'));
      throw plain(why);
    });
  }

  return { run: run, MARK: MARK };
})();

DrawSteelStatblock.Rise = DrawSteelRise;

if (typeof Chronicle !== 'undefined' && Chronicle) {
  Chronicle.homebrewActions = Chronicle.homebrewActions || {};
  Chronicle.homebrewActions['rise-as-variant'] = DrawSteelRise.run;
}

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
