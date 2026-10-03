/**
 * Draw Steel Negotiation Tracker Widget
 *
 * A compact card Chronicle mounts below the title of NPC pages. The GM runs
 * the negotiation (meters, motivations, arguments, log); players only ever
 * see the `public` half the GM widget derives from the `gm` half.
 *
 * Every number comes from data/negotiation.json (read via the systems data
 * route), never from tables in this file. The pure rules live in `Logic`
 * below and are exported for tools/test-negotiation-tracker.mjs.
 */
(function () {
  'use strict';

  var STATE_KEY = 'negotiation';
  var LOG_CAP = 30;
  var METER_MAX = 5;

  // ── Pure logic (no DOM) ─────────────────────────────────────

  function clamp(n, lo, hi) {
    n = Number(n);
    if (isNaN(n)) n = lo;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function uniq(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      if (typeof s === 'string' && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  function without(list, slug) {
    return list.filter(function (s) { return s !== slug; });
  }

  // buildRules turns data/negotiation.json entries into the lookup tables the
  // logic needs. Returns null when a required entry is missing so callers can
  // say so instead of guessing numbers.
  function buildRules(entries) {
    var rules = { attitudes: [], motivations: [], offers: {}, args: {} };
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      var p = (e && e.properties) || {};
      if (p.kind === 'attitude') {
        rules.attitudes.push({ slug: String(e.slug).replace(/^attitude-/, ''), name: e.name,
          interest: p.interest, patience: p.patience });
      } else if (p.kind === 'motivation') {
        rules.motivations.push({ slug: String(e.slug).replace(/^motivation-/, ''), name: e.name });
      } else if (p.kind === 'offer') {
        rules.offers[p.interest] = { response: p.response, description: e.description || '' };
      } else if (p.kind === 'argument-outcome') {
        rules.args[e.slug] = p;
      } else if (e && e.slug === 'interest' && p.kind === 'rule') {
        rules.interest = p;
      } else if (e && e.slug === 'patience' && p.kind === 'rule') {
        rules.patience = p;
      }
    });
    var a = rules.args;
    var ok = rules.attitudes.length && rules.motivations.length &&
      a['argument-appeal-to-motivation'] && a['argument-appeal-to-motivation'].tiers &&
      a['argument-no-motivation'] && a['argument-no-motivation'].tiers &&
      a['argument-motivation-reused'] && a['argument-pitfall-used'] && a['argument-caught-in-lie'] &&
      rules.offers[0] && rules.offers[5];
    return ok ? rules : null;
  }

  function motivationName(rules, slug) {
    for (var i = 0; i < rules.motivations.length; i++) {
      if (rules.motivations[i].slug === slug) return rules.motivations[i].name;
    }
    return '';
  }

  function attitudeFor(rules, slug) {
    for (var i = 0; i < rules.attitudes.length; i++) {
      if (rules.attitudes[i].slug === slug) return rules.attitudes[i];
    }
    return null;
  }

  function pushLog(gm, text, now) {
    gm.log = gm.log.concat([{ at: now || new Date().toISOString(), text: text }]);
    if (gm.log.length > LOG_CAP) gm.log = gm.log.slice(gm.log.length - LOG_CAP);
  }

  // normalizeGm coerces whatever was stored into the contract shape, so a
  // hand-edited or older record can never crash the widget.
  function normalizeGm(rules, raw) {
    var r = (raw && typeof raw === 'object') ? raw : {};
    var known = function (s) { return !!motivationName(rules, s); };
    var found = (r.found && typeof r.found === 'object') ? r.found : {};
    var att = attitudeFor(rules, r.attitude) || attitudeFor(rules, 'neutral') || rules.attitudes[0];
    var imp = r.impression;
    return {
      attitude: att.slug,
      interest: clamp(r.interest === undefined ? att.interest : r.interest, 0, METER_MAX),
      patience: clamp(r.patience === undefined ? att.patience : r.patience, 0, METER_MAX),
      impression: (imp === null || imp === undefined || imp === '') ? null : clamp(imp, 1, 12),
      motivations: uniq(r.motivations).filter(known),
      pitfalls: uniq(r.pitfalls).filter(known),
      found: { motivations: uniq(found.motivations).filter(known), pitfalls: uniq(found.pitfalls).filter(known) },
      used: uniq(r.used).filter(known),
      shown: r.shown === true,
      over: r.over === true,
      log: (Array.isArray(r.log) ? r.log : []).filter(function (l) {
        return l && typeof l.text === 'string';
      }).map(function (l) { return { at: String(l.at || ''), text: l.text }; }).slice(-LOG_CAP)
    };
  }

  // startFromAttitude resets the meters to an attitude's starting values and
  // clears the play state, keeping the NPC's motivations, pitfalls and impression.
  function startFromAttitude(rules, gm, slug, now) {
    var att = attitudeFor(rules, slug);
    if (!att) return gm;
    var next = normalizeGm(rules, gm);
    next.attitude = att.slug;
    next.interest = clamp(att.interest, 0, METER_MAX);
    next.patience = clamp(att.patience, 0, METER_MAX);
    next.over = false;
    next.used = [];
    pushLog(next, 'Starting attitude ' + att.name + ': interest ' + next.interest +
      ', patience ' + next.patience + '.', now);
    return next;
  }

  // endReason is the ending rule from "Interest", "Patience" and "Keep Going
  // or Stop": interest 5 or patience 0 is a final offer, interest 0 is no deal.
  function endReason(gm) {
    if (gm.interest <= 0) return 'Interest dropped to 0: no deal.';
    if (gm.interest >= METER_MAX) return 'Interest reached 5: final offer.';
    if (gm.patience <= 0) return 'Patience ran out: final offer.';
    return '';
  }

  // settle sets `over` from the meters and logs the reason when it newly ends.
  function settle(gm, now) {
    var reason = endReason(gm);
    if (reason && !gm.over) pushLog(gm, reason, now);
    gm.over = !!reason;
    return gm;
  }

  // setMeter is the GM's by-hand edit of one meter.
  function setMeter(rules, gm, which, value, now) {
    var next = normalizeGm(rules, gm);
    next[which] = clamp(value, 0, METER_MAX);
    pushLog(next, (which === 'interest' ? 'Interest' : 'Patience') + ' set to ' + next[which] + '.', now);
    return settle(next, now);
  }

  function tierKey(tier) { return tier === 1 ? 't1' : tier === 3 ? 't3' : 't2'; }

  // applyArgument applies one argument using the deltas in negotiation.json.
  // arg = { type: 'appeal'|'none'|'pitfall'|'lie', slug, tier: 1|2|3 }.
  function applyArgument(rules, gm, arg, now) {
    var next = normalizeGm(rules, gm);
    if (next.over) return next;
    var a = rules.args;
    var d = { interest: 0, patience: 0 };
    var label;
    var name = motivationName(rules, arg.slug);
    var tier = clamp(arg.tier || 2, 1, 3);
    var tierText = tier === 1 ? ' (11 or less)' : tier === 3 ? ' (17 or more)' : ' (12 to 16)';
    if (arg.type === 'appeal' && next.used.indexOf(arg.slug) >= 0) {
      d = a['argument-motivation-reused'];
      label = 'Appealed to ' + name + ' again';
    } else if (arg.type === 'appeal') {
      d = a['argument-appeal-to-motivation'].tiers[tierKey(tier)];
      label = 'Appealed to ' + name + tierText;
    } else if (arg.type === 'pitfall') {
      d = a['argument-pitfall-used'];
      label = 'Touched a pitfall, ' + name;
    } else if (arg.type === 'lie') {
      d = a['argument-caught-in-lie'];
      label = 'Caught in a lie';
    } else {
      d = a['argument-no-motivation'].tiers[tierKey(tier)];
      label = 'Argument with no motivation' + tierText;
    }
    var di = Number(d.interest) || 0;
    var dp = Number(d.patience) || 0;
    next.interest = clamp(next.interest + di, 0, METER_MAX);
    next.patience = clamp(next.patience + dp, 0, METER_MAX);
    // A motivation counts as appealed to (and becomes known) only when the
    // argument actually raised interest; a pitfall is learned by touching it.
    if (arg.type === 'appeal' && di > 0 && next.used.indexOf(arg.slug) < 0) {
      next.used = next.used.concat([arg.slug]);
      if (next.found.motivations.indexOf(arg.slug) < 0) next.found.motivations.push(arg.slug);
    }
    if (arg.type === 'pitfall' && next.found.pitfalls.indexOf(arg.slug) < 0) {
      next.found.pitfalls.push(arg.slug);
    }
    var parts = [];
    if (di) parts.push('interest ' + (di > 0 ? '+' : '') + di);
    if (dp) parts.push('patience ' + (dp > 0 ? '+' : '') + dp);
    pushLog(next, label + ': ' + (parts.length ? parts.join(', ') : 'no change') +
      ' (now ' + next.interest + '/' + next.patience + ').', now);
    return settle(next, now);
  }

  // derivePublic builds the half players may read. It names only found
  // motivations/pitfalls and shows the meters only when the GM has shown them.
  function derivePublic(rules, gm) {
    var g = normalizeGm(rules, gm);
    var names = function (slugs) {
      return slugs.map(function (s) { return motivationName(rules, s); }).filter(Boolean);
    };
    var pub = {
      shown: g.shown,
      motivationsFound: names(g.found.motivations),
      pitfallsFound: names(g.found.pitfalls)
    };
    if (g.shown) {
      pub.interest = g.interest;
      pub.patience = g.patience;
      pub.response = (rules.offers[g.interest] || {}).response || '';
    }
    return pub;
  }

  // startOver restarts the negotiation from the NPC's current attitude, keeping
  // who the NPC is (motivations, pitfalls, impression) but not what was learned.
  function startOver(rules, gm, now) {
    var g = normalizeGm(rules, gm);
    g.found = { motivations: [], pitfalls: [] };
    g.shown = false;
    g.log = [];
    return startFromAttitude(rules, g, g.attitude, now);
  }

  var Logic = {
    startOver: startOver,
    LOG_CAP: LOG_CAP, buildRules: buildRules, normalizeGm: normalizeGm, startFromAttitude: startFromAttitude,
    applyArgument: applyArgument, derivePublic: derivePublic, setMeter: setMeter, settle: settle,
    endReason: endReason, motivationName: motivationName, clamp: clamp, pushLog: pushLog
  };
  if (typeof window !== 'undefined') window.ChronicleDrawSteelNegotiation = Logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

  // ── UI ──────────────────────────────────────────────────────

  var STYLES = [
    '.dsn { font-family:Inter,system-ui,-apple-system,sans-serif; font-size:14px; color:var(--color-text-primary,#111827); background:var(--color-card-bg,var(--bg-primary,#fff)); border:1px solid var(--color-border,#e5e7eb); border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); padding:16px; margin:12px 0; }',
    '.dsn h3 { font-size:16px; font-weight:600; margin:0 0 12px; }',
    '.dsn-note { color:var(--color-text-secondary,#6b7280); font-size:13px; margin:0; }',
    '.dsn-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; margin-bottom:12px; }',
    '.dsn-field { display:flex; align-items:center; gap:6px; }',
    '.dsn label, .dsn-label { font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); }',
    '.dsn select, .dsn input[type=number] { font:inherit; padding:4px 8px; border:1px solid var(--color-border,#e5e7eb); border-radius:6px; background:var(--color-card-bg,var(--bg-primary,#fff)); color:inherit; }',
    '.dsn input[type=number] { width:64px; }',
    '.dsn button { font:inherit; cursor:pointer; }',
    '.dsn button:disabled, .dsn select:disabled, .dsn input:disabled { opacity:0.55; cursor:not-allowed; }',
    '.dsn button:focus-visible, .dsn select:focus-visible, .dsn input:focus-visible { outline:2px solid var(--color-accent,#6366f1); outline-offset:2px; }',
    '.dsn-meter { display:flex; align-items:center; gap:6px; }',
    '.dsn-pips { display:inline-flex; gap:4px; }',
    '.dsn-pip { width:18px; height:18px; padding:0; border-radius:50%; border:2px solid var(--color-border,#d1d5db); background:transparent; transition:background-color 0.15s; }',
    '.dsn-pip.on { background:var(--color-accent,#6366f1); border-color:var(--color-accent,#6366f1); }',
    '.dsn-pip.patience.on { background:var(--color-warning,#d97706); border-color:var(--color-warning,#d97706); }',
    'span.dsn-pip { display:inline-block; }',
    '.dsn-chips { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:12px; }',
    '.dsn-chip { display:inline-flex; align-items:center; border:1px solid var(--color-border,#d1d5db); border-radius:999px; overflow:hidden; font-size:13px; }',
    '.dsn-chip button { border:0; background:transparent; color:inherit; padding:3px 10px; }',
    '.dsn-chip button.x { padding:3px 8px 3px 2px; color:var(--color-text-secondary,#6b7280); }',
    '.dsn-chip.found { background:var(--color-accent-light,#eef2ff); border-color:var(--color-accent,#6366f1); }',
    '.dsn-chip.pit.found { background:var(--color-danger-light,#fef2f2); border-color:var(--color-danger,#dc2626); }',
    '.dsn-chip small { color:var(--color-text-secondary,#6b7280); margin-left:4px; }',
    '.dsn-offer { padding:8px 12px; border-radius:8px; background:var(--color-bg-secondary,#f9fafb); margin-bottom:12px; }',
    '.dsn-btn { border:1px solid var(--color-border,#d1d5db); background:var(--color-card-bg,var(--bg-primary,#fff)); color:inherit; border-radius:6px; padding:5px 12px; }',
    '.dsn-btn.primary { background:var(--color-accent,#6366f1); border-color:var(--color-accent,#6366f1); color:#fff; }',
    '.dsn-log { list-style:none; margin:0 0 12px; padding:0; font-size:13px; max-height:160px; overflow:auto; }',
    '.dsn-log li { padding:2px 0; border-top:1px solid var(--color-border,#f3f4f6); }',
    '.dsn-over { font-weight:600; margin:0 0 12px; }',
    '.dsn-status { font-size:12px; color:var(--color-text-secondary,#6b7280); min-height:16px; }',
    '@media (prefers-reduced-motion: reduce) { .dsn-pip { transition:none; } }'
  ].join('\n');

  function esc(s) { return Chronicle.escapeHtml(s); }
  function escA(s) { return (Chronicle.escapeAttr || Chronicle.escapeHtml)(s); }

  function pipsHtml(count, cls, which, editable, disabled) {
    var out = '<span class="dsn-pips" role="group" aria-label="' + escA(which) + ' ' + count + ' of ' + METER_MAX + '">';
    for (var i = 1; i <= METER_MAX; i++) {
      var on = i <= count ? ' on' : '';
      if (editable) {
        out += '<button type="button" class="dsn-pip ' + cls + on + '" data-act="pip" data-meter="' + cls +
          '" data-n="' + i + '" data-k="pip-' + cls + '-' + i + '" aria-pressed="' + (i <= count) +
          '" aria-label="Set ' + escA(which) + ' to ' + i + '"' + (disabled ? ' disabled' : '') + '></button>';
      } else {
        out += '<span class="dsn-pip ' + cls + on + '" aria-hidden="true"></span>';
      }
    }
    return out + '</span>';
  }

  function chipHtml(rules, slug, kind, gm, disabled) {
    var found = gm.found[kind].indexOf(slug) >= 0;
    var nm = motivationName(rules, slug);
    return '<span class="dsn-chip ' + (kind === 'pitfalls' ? 'pit' : 'mot') + (found ? ' found' : '') + '">' +
      '<button type="button" data-act="found" data-kind="' + kind + '" data-slug="' + escA(slug) +
      '" data-k="found-' + kind + '-' + escA(slug) + '" aria-pressed="' + found + '"' + (disabled ? ' disabled' : '') + '>' +
      esc(nm) + (found ? '' : '<small>not found</small>') + '</button>' +
      '<button type="button" class="x" data-act="remove" data-kind="' + kind + '" data-slug="' + escA(slug) +
      '" aria-label="Remove ' + escA(nm) + '"' + (disabled ? ' disabled' : '') + '>&times;</button></span>';
  }

  function pickerHtml(rules, gm, kind, disabled) {
    var opts = '<option value="">Add ' + (kind === 'motivations' ? 'motivation' : 'pitfall') + '…</option>';
    rules.motivations.forEach(function (m) {
      if (gm.motivations.indexOf(m.slug) >= 0 || gm.pitfalls.indexOf(m.slug) >= 0) return;
      opts += '<option value="' + escA(m.slug) + '">' + esc(m.name) + '</option>';
    });
    return '<select data-act="add" data-kind="' + kind + '" data-k="add-' + kind + '" aria-label="Add ' +
      (kind === 'motivations' ? 'a motivation' : 'a pitfall') + '"' + (disabled ? ' disabled' : '') + '>' + opts + '</select>';
  }

  function chipListHtml(rules, gm, kind, disabled) {
    var out = '<div class="dsn-chips" data-list="' + kind + '">';
    gm[kind].forEach(function (s) { out += chipHtml(rules, s, kind, gm, disabled); });
    if (!gm[kind].length) out += '<span class="dsn-note">None yet.</span>';
    return out + pickerHtml(rules, gm, kind, disabled) + '</div>';
  }

  function playerHtml(rules, pub) {
    var chips = function (list, cls) {
      return list.map(function (n) { return '<span class="dsn-chip ' + cls + ' found"><button type="button" disabled>' + esc(n) + '</button></span>'; }).join('');
    };
    var out = '<div class="dsn" role="region" aria-label="Negotiation"><h3>Negotiation</h3>';
    if (pub.shown) {
      out += '<div class="dsn-row"><span class="dsn-meter"><span class="dsn-label">Interest</span>' +
        pipsHtml(pub.interest, 'interest', 'Interest', false) + '</span>' +
        '<span class="dsn-meter"><span class="dsn-label">Patience</span>' +
        pipsHtml(pub.patience, 'patience', 'Patience', false) + '</span></div>';
      if (pub.response) out += '<div class="dsn-offer">If they answered now: <strong>' + esc(pub.response) + '</strong></div>';
    } else {
      out += '<p class="dsn-note">The GM hasn\'t shown the meters yet.</p>';
    }
    if (pub.motivationsFound.length) out += '<div class="dsn-label">Motivations found</div><div class="dsn-chips">' + chips(pub.motivationsFound, 'mot') + '</div>';
    if (pub.pitfallsFound.length) out += '<div class="dsn-label">Pitfalls found</div><div class="dsn-chips">' + chips(pub.pitfallsFound, 'pit') + '</div>';
    return out + '</div>';
  }

  // sanitizePublic reads the server's public half defensively; only names the
  // GM widget wrote are displayed, as escaped text.
  function sanitizePublic(p) {
    p = (p && typeof p === 'object') ? p : {};
    var names = function (l) {
      return (Array.isArray(l) ? l : []).filter(function (x) { return typeof x === 'string' && x; });
    };
    return {
      shown: p.shown === true,
      interest: clamp(p.interest, 0, METER_MAX),
      patience: clamp(p.patience, 0, METER_MAX),
      response: typeof p.response === 'string' ? p.response : '',
      motivationsFound: names(p.motivationsFound),
      pitfallsFound: names(p.pitfallsFound)
    };
  }

  function argSelectHtml(rules, gm, sel, disabled) {
    var o = '';
    var opt = function (v, t) {
      o += '<option value="' + escA(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(t) + '</option>';
    };
    gm.motivations.forEach(function (s) {
      if (gm.used.indexOf(s) < 0) opt('appeal:' + s, 'Appeals to ' + motivationName(rules, s));
    });
    gm.motivations.forEach(function (s) {
      if (gm.used.indexOf(s) >= 0) opt('appeal:' + s, 'Appeals to ' + motivationName(rules, s) + ' (already used)');
    });
    opt('none', 'No motivation');
    gm.pitfalls.forEach(function (s) { opt('pitfall:' + s, 'Touches ' + motivationName(rules, s)); });
    opt('lie', 'Caught in a lie');
    return '<select data-act="argsel" data-k="argsel" aria-label="Argument"' + (disabled ? ' disabled' : '') + '>' + o + '</select>';
  }

  function parseSel(sel) {
    var i = sel.indexOf(':');
    if (i < 0) return { type: sel, slug: '' };
    return { type: sel.slice(0, i), slug: sel.slice(i + 1) };
  }

  function needsTier(gm, a) {
    if (a.type === 'pitfall' || a.type === 'lie') return false;
    if (a.type === 'appeal' && gm.used.indexOf(a.slug) >= 0) return false;
    return true;
  }

  function gmHtml(rules, gm, ui, busy) {
    var d = busy ? ' disabled' : '';
    var attOpts = rules.attitudes.map(function (a) {
      return '<option value="' + escA(a.slug) + '"' + (a.slug === gm.attitude ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
    var offer = rules.offers[gm.interest] || {};
    var sel = ui.sel;
    var parsed = parseSel(sel);
    var valid = sel === 'none' || sel === 'lie' || (parsed.slug && (gm.motivations.indexOf(parsed.slug) >= 0 || gm.pitfalls.indexOf(parsed.slug) >= 0));
    if (!valid) { sel = 'none'; parsed = { type: 'none', slug: '' }; }
    var out = '<div class="dsn" role="region" aria-label="Negotiation"><h3>Negotiation</h3>';
    out += '<div class="dsn-row"><span class="dsn-field"><label for="dsn-att">Starting attitude</label>' +
      '<select id="dsn-att" data-act="attitude" data-k="attitude"' + d + '>' + attOpts + '</select></span>' +
      '<span class="dsn-field"><label for="dsn-imp">Impression</label>' +
      '<input id="dsn-imp" type="number" min="1" max="12" step="1" data-act="impression" data-k="impression" value="' +
      (gm.impression === null ? '' : gm.impression) + '"' + d + '></span></div>';
    out += '<div class="dsn-row"><span class="dsn-meter"><span class="dsn-label">Interest</span>' +
      pipsHtml(gm.interest, 'interest', 'Interest', true, busy) + '<span>' + gm.interest + '</span></span>' +
      '<span class="dsn-meter"><span class="dsn-label">Patience</span>' +
      pipsHtml(gm.patience, 'patience', 'Patience', true, busy) + '<span>' + gm.patience + '</span></span></div>';
    out += '<div class="dsn-label">Motivations</div>' + chipListHtml(rules, gm, 'motivations', busy);
    out += '<div class="dsn-label">Pitfalls</div>' + chipListHtml(rules, gm, 'pitfalls', busy);
    out += '<div class="dsn-offer">If they answered now: <strong>' + esc(offer.response || '') + '</strong>' +
      (offer.description ? ' <span class="dsn-note">' + esc(offer.description) + '</span>' : '') + '</div>';
    if (gm.over) out += '<p class="dsn-over">' + esc(Logic.endReason(gm)) + '</p>';
    var dd = (busy || gm.over) ? ' disabled' : '';
    out += '<div class="dsn-row">' + argSelectHtml(rules, gm, sel, busy || gm.over);
    if (needsTier(gm, parsed)) {
      out += '<select data-act="tier" data-k="tier" aria-label="Test result"' + dd + '>' +
        [[1, '11 or less'], [2, '12 to 16'], [3, '17 or more']].map(function (t) {
          return '<option value="' + t[0] + '"' + (t[0] === ui.tier ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('') + '</select>';
    }
    out += '<button type="button" class="dsn-btn primary" data-act="argue" data-k="argue"' + dd + '>Make the argument</button></div>';
    if (gm.log.length) {
      out += '<ul class="dsn-log" aria-label="Negotiation log">';
      gm.log.slice().reverse().forEach(function (l) { out += '<li>' + esc(l.text) + '</li>'; });
      out += '</ul>';
    }
    out += '<div class="dsn-row"><button type="button" class="dsn-btn" data-act="show" data-k="show"' + d + '>' +
      (gm.shown ? 'Hide from players' : 'Show players the meters') + '</button>' +
      '<button type="button" class="dsn-btn" data-act="reset" data-k="reset"' + d + '>Start over</button>' +
      '<span class="dsn-status" role="status" aria-live="polite">' + esc(ui.status) + '</span></div></div>';
    return out;
  }

  Chronicle.register('negotiation-tracker', {
    init: function (el, config) {
      var self = this;
      var ds = el.dataset || {};
      config = config || {};
      this.el = el;
      this.campaignId = config.campaign_id || config.campaignId || ds.campaignId || '';
      this.entityId = config.entity_id || config.entityId || ds.entityId || '';
      this.rules = null;
      this.gm = null;
      this.ui = { sel: 'none', tier: 2, status: '' };
      this.busy = false;
      this.dirty = false;
      this.timer = null;
      this.isGm = false;
      this.dead = false;
      this._onClick = function (e) { self._handle(e, 'click'); };
      this._onChange = function (e) { self._handle(e, 'change'); };
      el.addEventListener('click', this._onClick);
      el.addEventListener('change', this._onChange);

      if (!this.campaignId || !this.entityId) {
        // Without ids there is nothing to load; only the GM gets a hint.
        if (ds.isGm === 'true') this._note('The negotiation tracker needs a campaign and an NPC page.');
        return;
      }
      this._load();
    },

    destroy: function (el) {
      this.dead = true;
      if (this.timer) clearTimeout(this.timer);
      if (this._onClick) el.removeEventListener('click', this._onClick);
      if (this._onChange) el.removeEventListener('change', this._onChange);
      el.innerHTML = '';
    },

    _stateUrl: function () {
      return '/campaigns/' + encodeURIComponent(this.campaignId) + '/entities/' +
        encodeURIComponent(this.entityId) + '/system-state/drawsteel/' + STATE_KEY;
    },

    _dataUrl: function () {
      return '/campaigns/' + encodeURIComponent(this.campaignId) + '/systems/drawsteel/data/negotiation.json';
    },

    // _note shows one quiet line (GM only, callers decide).
    _note: function (text) {
      this._styles();
      this.el.innerHTML = '<div class="dsn"><p class="dsn-note">' + esc(text) + '</p></div>';
    },

    _styles: function () {
      if (this.el.querySelector && this.el.querySelector('style.dsn-styles')) return;
      var style = document.createElement('style');
      style.className = 'dsn-styles';
      style.textContent = STYLES;
      this.el.appendChild(style);
    },

    _load: function () {
      var self = this;
      var wantGm = (this.el.dataset || {}).isGm === 'true';
      Chronicle.apiFetch(this._stateUrl()).then(function (r) {
        if (!r.ok) { var err = new Error('state ' + r.status); err.status = r.status; throw err; }
        return r.json();
      }).then(function (state) {
        if (self.dead) return;
        state = state || {};
        if (state.isGm === true && state.gm && typeof state.gm === 'object') {
          self.isGm = true;
          return Chronicle.apiFetch(self._dataUrl()).then(function (r) {
            if (!r.ok) throw new Error('rules ' + r.status);
            return r.json();
          }).then(function (entries) {
            if (self.dead) return;
            self.rules = buildRules(entries);
            if (!self.rules) { self._note('The negotiation rules could not be read.'); return; }
            self.gm = normalizeGm(self.rules, state.gm);
            self._render();
          });
        }
        // Players read only the public half.
        self.pub = sanitizePublic(state.public);
        self._render();
      }).catch(function (err) {
        if (self.dead) return;
        self.el.innerHTML = '';
        if (!wantGm) return;
        self._note(err && err.status === 404 ? 'This needs a newer Chronicle.' :
          'The negotiation tracker could not load. Reload the page to try again.');
      });
    },

    _render: function () {
      var active = (typeof document !== 'undefined' && document.activeElement) || null;
      var key = active && active.getAttribute ? active.getAttribute('data-k') : null;
      var html;
      if (this.isGm) {
        html = gmHtml(this.rules, this.gm, this.ui, this.busy);
      } else {
        var p = this.pub;
        if (!p || (!p.shown && !p.motivationsFound.length && !p.pitfallsFound.length)) {
          this.el.innerHTML = '';
          return;
        }
        html = playerHtml(this.rules, p);
      }
      this.el.innerHTML = '<style class="dsn-styles">' + STYLES + '</style>' + html;
      if (key && this.el.querySelector) {
        var again = this.el.querySelector('[data-k="' + key.replace(/"/g, '') + '"]');
        if (again && again.focus && !again.disabled) again.focus();
      }
    },

    // _handle routes delegated clicks and changes by data-act.
    _handle: function (e, type) {
      if (!this.isGm || !this.gm || this.busy) return;
      var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t) return;
      var act = t.getAttribute('data-act');
      var rules = this.rules;
      var self = this;
      var value = t.value;
      if (type === 'click') {
        if (act === 'pip') {
          var n = Number(t.getAttribute('data-n'));
          var meter = t.getAttribute('data-meter');
          var cur = this.gm[meter];
          // Clicking the lit last pip turns it off, so 0 is reachable by hand.
          this._apply(function (gm) { return Logic.setMeter(rules, gm, meter, n === cur ? n - 1 : n); });
        } else if (act === 'found') {
          var kind = t.getAttribute('data-kind');
          var slug = t.getAttribute('data-slug');
          this._apply(function (gm) {
            var g = Logic.normalizeGm(rules, gm);
            var on = g.found[kind].indexOf(slug) >= 0;
            g.found[kind] = on ? without(g.found[kind], slug) : g.found[kind].concat([slug]);
            return g;
          });
        } else if (act === 'remove') {
          var k2 = t.getAttribute('data-kind');
          var s2 = t.getAttribute('data-slug');
          this._apply(function (gm) {
            var g = Logic.normalizeGm(rules, gm);
            g[k2] = without(g[k2], s2);
            g.found[k2] = without(g.found[k2], s2);
            if (k2 === 'motivations') g.used = without(g.used, s2);
            return g;
          });
        } else if (act === 'argue') {
          var a = parseSel(this.ui.sel);
          a.tier = this.ui.tier;
          this._apply(function (gm) { return applyArgument(rules, gm, a); });
        } else if (act === 'show') {
          this._apply(function (gm) {
            var g = Logic.normalizeGm(rules, gm);
            g.shown = !g.shown;
            return g;
          });
        } else if (act === 'reset') {
          if (typeof window !== 'undefined' && window.confirm &&
              !window.confirm('Start this negotiation over? The meters, found items and log are cleared.')) return;
          this._apply(function (gm) { return Logic.startOver(rules, gm); });
        }
        return;
      }
      if (act === 'attitude') {
        this._apply(function (gm) { return startFromAttitude(rules, gm, value); });
      } else if (act === 'impression') {
        this._apply(function (gm) {
          var g = Logic.normalizeGm(rules, gm);
          g.impression = value === '' ? null : clamp(value, 1, 12);
          return g;
        });
      } else if (act === 'add') {
        var k3 = t.getAttribute('data-kind');
        if (!value) return;
        this._apply(function (gm) {
          var g = Logic.normalizeGm(rules, gm);
          if (g.motivations.indexOf(value) < 0 && g.pitfalls.indexOf(value) < 0) g[k3] = g[k3].concat([value]);
          return g;
        });
      } else if (act === 'argsel') {
        this.ui.sel = value;
        this._render();
      } else if (act === 'tier') {
        this.ui.tier = clamp(value, 1, 3);
      }
    },

    // _apply runs one edit, redraws, and schedules the debounced save.
    _apply: function (fn) {
      var self = this;
      this.gm = fn(this.gm);
      this.dirty = true;
      this.ui.status = '';
      this._render();
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(function () { self._save(); }, 400);
    },

    // _save sends both halves in one PUT; public is always re-derived from gm.
    _save: function () {
      var self = this;
      this.timer = null;
      if (this.dead || !this.dirty) return;
      this.busy = true;
      this.ui.status = 'Saving…';
      this._render();
      var body = JSON.stringify({ public: derivePublic(this.rules, this.gm), gm: this.gm });
      Chronicle.apiFetch(this._stateUrl(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).then(function (r) {
        if (!r.ok) throw new Error('save ' + r.status);
        self.dirty = false;
        self.ui.status = 'Saved';
      }).catch(function () {
        self.ui.status = 'Couldn\'t save — try again.';
      }).then(function () {
        self.busy = false;
        if (!self.dead) self._render();
      });
    }
  });
})();
