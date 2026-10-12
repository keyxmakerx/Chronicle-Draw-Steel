/**
 * Draw Steel bestiary viewer.
 *
 * DrawSteelBestiary lists creatures from this campaign's Creature pages and
 * from the Monsters book (data/monsters.json). A row opens its stat block in
 * place; the stat block is the shared one (DrawSteelStatblock), drawn "live":
 * power rolls get roll buttons, and conditions, keywords, abilities,
 * organizations and roles open Chronicle's hover card. A card can be pinned to
 * the reference tray beside the list, which also keeps the last five rolls.
 *
 * Two layouts: "full" (filters, sorting, explanations, tray) for a Bestiary
 * page, and "compact" for a block on any page, which only opens, hovers and
 * rolls. Every animation follows html[data-motion] and prefers-reduced-motion.
 *
 * The pure parts (rows, filtering, the HTML) are exported for the Node tests;
 * mount wires them to the page.
 */
var DrawSteelBestiary = (function () {
  'use strict';

  var ORGS = ['minion', 'horde', 'platoon', 'elite', 'leader', 'solo', 'swarm'];
  var ROLES = ['ambusher', 'artillery', 'brute', 'controller', 'defender', 'harrier', 'hexer', 'mount', 'support'];
  var SOURCES = [['all', 'Everything'], ['campaign', 'This campaign'], ['book', 'Draw Steel book']];
  var PAGE = 60, MAX_PINS = 8, MAX_ROLLS = 5;

  function SB() { return (typeof DrawSteelStatblock !== 'undefined') ? DrawSteelStatblock : null; }

  // Escapes for element content and attribute values alike.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  // ── Rows ──────────────────────────────────────────────────────────────────

  // A row is one creature, from either source, with its stat block normalized
  // once. `key` is unique across sources and safe in an attribute.
  function fromEntity(e) {
    var S = SB();
    var f = (e && (e.fields_data || e.custom_fields)) || {};
    var c = S.normalize(f);
    return { key: 'c' + String(e.id).replace(/[^A-Za-z0-9_-]/g, ''), src: 'campaign', id: String(e.id), name: String(e.name || f.name || 'Unnamed'), c: c, fields: f, group: '' };
  }

  function fromBook(item) {
    var S = SB();
    var p = (item && item.properties) || {};
    return { key: 'b' + String(item.slug || '').replace(/[^A-Za-z0-9_-]/g, ''), src: 'book', slug: String(item.slug || ''), name: String(item.name || ''), c: S.normalize(p), fields: p, group: String(p.group || '') };
  }

  // haystack is what the search box matches: name, keywords, the book chapter
  // and every ability's name.
  function haystack(row) {
    var c = row.c;
    return [row.name, row.group, c.keywords.join(' '), c.abilities.concat(c.villain_actions).map(function (a) { return a.name || ''; }).join(' ')]
      .join(' ').toLowerCase();
  }

  function matches(row, v) {
    var c = row.c;
    if (v.src !== 'all' && row.src !== v.src) return false;
    if (v.org && c.organization !== v.org) return false;
    if (v.role && c.role !== v.role) return false;
    var lvl = c.level === null ? 0 : c.level;
    if (v.lmin && lvl < v.lmin) return false;
    if (v.lmax && lvl > v.lmax) return false;
    var q = String(v.q || '').trim().toLowerCase();
    if (q && haystack(row).indexOf(q) === -1) return false;
    if (v.only && v.only.length && v.only.indexOf(row.name.toLowerCase()) === -1 && v.only.indexOf(row.slug || '') === -1) return false;
    return true;
  }

  function sortKey(row, by) {
    if (by === 'level') return row.c.level === null ? -1 : row.c.level;
    if (by === 'ev') return row.c.ev === null ? -1 : row.c.ev;
    return row.name.toLowerCase();
  }

  function visible(rows, v) {
    return rows.filter(function (r) { return matches(r, v); }).sort(function (a, b) {
      var x = sortKey(a, v.sort), y = sortKey(b, v.sort);
      var d = x < y ? -1 : x > y ? 1 : 0;
      return d * (v.dir || 1) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
    });
  }

  function levels(rows) {
    var seen = {};
    rows.forEach(function (r) { if (r.c.level !== null) seen[r.c.level] = true; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  // ── Filter bar ────────────────────────────────────────────────────────────

  function chipsHtml(name, list, on, have) {
    return list.filter(function (s) { return !have || have[s]; }).map(function (s) {
      return '<button type="button" class="bb-chip" data-bb-' + name + '="' + esc(s) + '" aria-pressed="' + (on === s) + '">' + esc(cap(s)) + '</button>';
    }).join('');
  }

  function levelOptions(ls, sel) {
    return ls.map(function (l) { return '<option value="' + l + '"' + (l === sel ? ' selected' : '') + '>' + l + '</option>'; }).join('');
  }

  // filterBarHtml is drawn once per load; the chips' pressed state is updated
  // in place so the search box keeps its focus while typing.
  function filterBarHtml(v, rows, opts) {
    var o = opts || {};
    var ls = levels(rows), have = {};
    rows.forEach(function (r) { have[r.c.organization] = true; have[r.c.role] = true; });
    var srcs = SOURCES.filter(function (s) { return s[0] !== 'book' || o.book; }).map(function (s) {
      return '<label><input type="radio" name="bb-src-' + esc(o.uid) + '" value="' + s[0] + '"' + (v.src === s[0] ? ' checked' : '') + '> ' + esc(s[1]) + '</label>';
    }).join('');
    return '<div class="bb-fbar" role="search">' +
      '<div class="bb-grp bb-grow"><label class="bb-lbl" for="bb-q-' + esc(o.uid) + '">Search</label>' +
        '<input type="search" class="bb-q" id="bb-q-' + esc(o.uid) + '" placeholder="Name, keyword or ability" autocomplete="off" value="' + esc(v.q) + '"></div>' +
      (ls.length ? '<div class="bb-grp"><span class="bb-lbl">Level</span><div class="bb-lvl">' +
        '<select data-bb-lmin aria-label="Lowest level">' + levelOptions(ls, v.lmin || ls[0]) + '</select>to' +
        '<select data-bb-lmax aria-label="Highest level">' + levelOptions(ls, v.lmax || ls[ls.length - 1]) + '</select></div></div>' : '') +
      '<div class="bb-grp"><span class="bb-lbl">Organization</span><div class="bb-chips">' + chipsHtml('org', ORGS, v.org, have) + '</div></div>' +
      '<div class="bb-grp"><span class="bb-lbl">Role</span><div class="bb-chips">' + chipsHtml('role', ROLES, v.role, have) + '</div></div>' +
      '<div class="bb-grp"><span class="bb-lbl">From</span><div class="bb-srcs">' + srcs +
        '<button type="button" class="bb-taped" data-bb-market aria-disabled="true">Market<span class="bb-tape" aria-hidden="true"><span>Construction</span></span></button></div></div>' +
      '<div class="bb-grp"><span class="bb-lbl" aria-hidden="true">&nbsp;</span><button type="button" class="bb-btn" data-bb-guide aria-pressed="false">What do these mean?</button></div>' +
    '</div>';
  }

  // ── Explanations ──────────────────────────────────────────────────────────

  function find(list, slug) {
    for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].slug === slug) return list[i];
    return null;
  }

  // orgLine and roleLine say what a filter means, from the package's templates.
  function orgLine(slug, refs) {
    var o = find(refs.orgs, slug);
    if (!o) return '';
    var m = o.organization_modifier;
    var ev = (m === null || m === undefined)
      ? 'Not a published organization, so its EV and Stamina are the director’s.'
      : 'EV is (2 × level + 4) × ' + m + (slug === 'minion' ? ', for four minions.' : '.');
    var va = Number(o.villain_action_count) || 0;
    return String(o.description || '') + ' ' + ev + (va ? ' Takes ' + va + ' villain actions.' : '');
  }

  function roleLine(slug, refs) {
    var r = find(refs.roles, slug);
    if (!r) return '';
    return String(r.description || '') + (r.primary_stat ? ' Its best characteristic is usually ' + cap(r.primary_stat) + '.' : '');
  }

  function explainHtml(v, refs, n) {
    var parts = [];
    if (v.org) parts.push('<div class="bb-ex"><b>' + esc(cap(v.org)) + '</b><span>' + esc(orgLine(v.org, refs)) + '</span></div>');
    if (v.role) parts.push('<div class="bb-ex"><b>' + esc(cap(v.role)) + '</b><span>' + esc(roleLine(v.role, refs)) + '</span></div>');
    if (!parts.length) return '';
    return parts.join('') + '<span class="bb-ex-n">' + n + ' match' + (n === 1 ? '' : 'es') + '</span>';
  }

  // guideHtml is the whole "What do these mean?" table for one of the two
  // filters, pinned to the tray as a card.
  function guideHtml(kind, refs) {
    var list = kind === 'orgs' ? ORGS : ROLES;
    return '<table class="bb-guide">' + list.map(function (s) {
      var line = kind === 'orgs' ? orgLine(s, refs) : roleLine(s, refs);
      return line ? '<tr><td>' + esc(cap(s)) + '</td><td>' + esc(line) + '</td></tr>' : '';
    }).join('') + '</table>';
  }

  // ── The list ──────────────────────────────────────────────────────────────

  function sortHead(by, label, v) {
    var on = v.sort === by;
    return '<button type="button" data-bb-sort="' + by + '" aria-sort="' + (on ? (v.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + label + '</button>';
  }

  function listHeadHtml(v) {
    return '<div class="bb-lhead">' + sortHead('name', 'Name', v) + sortHead('level', 'Level', v) + '<span>Organization</span>' + sortHead('ev', 'EV', v) + '</div>';
  }

  // rowHtml draws one row: a head that opens it, and a body that holds the stat
  // block while it is open.
  function rowHtml(row, open, ctx) {
    var c = row.c, x = ctx || {};
    var noRole = c.organization === 'leader' || c.organization === 'solo';
    var kw = c.keywords.join(', ');
    var head = '<div class="bb-rhead" role="button" tabindex="0" aria-expanded="' + !!open + '" data-bb-toggle>' +
      '<span class="bb-nm"><span class="bb-car" aria-hidden="true">▶</span><span class="bb-nmt"><span class="bb-t" data-bb-cr="' + esc(row.key) + '">' + esc(row.name) + '</span>' +
      (kw ? '<span class="bb-kw">' + esc(kw) + '</span>' : '') + '</span></span>';
    if (x.compact) {
      head += '<span class="bb-c">' + (c.level !== null ? 'L' + esc(c.level) + ' · ' : '') + esc(cap(c.organization)) + '</span>';
    } else {
      head += '<span class="bb-c">' + (c.level === null ? '—' : esc(c.level)) + '</span>' +
        '<span class="bb-c bb-org">' + esc(cap(c.organization)) + (c.role && !noRole ? ' <small>' + esc(cap(c.role)) + '</small>' : '') + '</span>' +
        '<span class="bb-c">' + (c.ev === null ? '—' : esc(c.ev)) + '</span>';
    }
    head += '</div>';
    return '<div class="bb-row' + (open ? ' is-open' : '') + '" data-bb-row="' + esc(row.key) + '">' + head +
      '<div class="bb-rbody"><div>' + (open ? bodyHtml(row, x) : '') + '</div></div></div>';
  }

  // bodyHtml is an open row: the live stat block and what can be done with it.
  function bodyHtml(row, ctx) {
    var S = SB(), x = ctx || {};
    var h = '<div class="bb-sb">' + S.html(row.name, row.c, { ref: x.ref, refs: x.refs, live: true });
    var foot = [];
    if (row.src === 'campaign') {
      foot.push('<span class="bb-pill is-ok">On a page</span>');
      if (x.campaignId) foot.push('<a class="bb-btn" href="/campaigns/' + encodeURIComponent(x.campaignId) + '/entities/' + encodeURIComponent(row.id) + '">Open the page</a>');
    } else {
      foot.push('<span class="bb-pill">Draw Steel book' + (row.group ? ' · ' + esc(row.group) : '') + '</span>');
      if (x.added && x.added[row.key]) {
        foot.push('<a class="bb-btn" href="/campaigns/' + encodeURIComponent(x.campaignId) + '/entities/' + encodeURIComponent(x.added[row.key]) + '">Added. Open the page</a>');
      } else if (x.canAdd) {
        foot.push('<button type="button" class="bb-btn" data-bb-add>Add to campaign</button>');
      }
    }
    if (x.tray) foot.push('<button type="button" class="bb-btn" data-bb-pin="cr|' + esc(row.key) + '">Pin card</button>');
    return h + '<div class="bb-foot">' + foot.join('') + '<span class="bb-msg" role="status"></span></div></div>';
  }

  function countText(n, total, v) {
    var where = v.src === 'campaign' ? ' in this campaign' : v.src === 'book' ? ' from the Draw Steel book' : '';
    return n + ' of ' + total + ' creatures' + where;
  }

  // ── Cards: hover cards and the tray share one description ─────────────

  // cardFor turns a key into { kind, title, body } with body already safe HTML.
  // Keys: 'g|<glossary id>', 'o|<org>', 'r|<role>', 'cr|<row>', 'ab|<row>|<ability
  // key>', 'guide|orgs', 'guide|roles', 'mk'. ctx: { rows (by key), ref, refs, inst }.
  function cardFor(key, ctx) {
    var S = SB(), x = ctx || {}, refs = x.refs || {};
    var p = String(key || '').split('|');
    var ref = x.ref || null;
    if (p[0] === 'g') {
      var en = ref && ref.getEntry ? ref.getEntry(p[1]) : null;
      if (!en) return null;
      var cat = (en.properties && en.properties.category) || en.category || 'Rule';
      return { kind: cap(cat), title: en.name || p[1], body: '<p>' + S.text(en.description || '', ref) + '</p>' };
    }
    if (p[0] === 'o' && orgLine(p[1], refs)) return { kind: 'Organization', title: cap(p[1]), body: '<p>' + esc(orgLine(p[1], refs)) + '</p>' };
    if (p[0] === 'r' && roleLine(p[1], refs)) return { kind: 'Role', title: cap(p[1]), body: '<p>' + esc(roleLine(p[1], refs)) + '</p>' };
    if (p[0] === 'guide') {
      return { kind: 'Guide', title: p[1] === 'orgs' ? 'Organizations: how many and how tough' : 'Roles: how it fights', body: guideHtml(p[1] === 'orgs' ? 'orgs' : 'roles', refs) };
    }
    if (p[0] === 'mk') return { kind: 'Source', title: 'Market', body: '<p>Creatures other directors share, ready to add. It is still being built.</p>' };
    var row = x.rows && x.rows[p[1]];
    if (!row) return null;
    if (p[0] === 'cr') {
      var c = row.c, sig = c.abilities.filter(function (a) { return a.type === 'signature'; })[0] || c.abilities[0];
      var noRole = c.organization === 'leader' || c.organization === 'solo';
      var facts = [['Level', c.level], ['EV', c.ev], ['Stamina', c.stamina], ['Speed', c.speed]].map(function (f) {
        return '<div><b>' + (f[1] === null ? '—' : esc(f[1])) + '</b>' + f[0] + '</div>';
      }).join('');
      return {
        kind: 'Creature', title: row.name,
        body: '<p class="bb-cmeta">' + esc([cap(c.organization) + (c.role && !noRole ? ' ' + cap(c.role) : ''), c.keywords.join(', ')].filter(Boolean).join(' · ')) + '</p>' +
          '<div class="bb-mini">' + facts + '</div>' +
          (sig ? '<p class="bb-csig"><span>Signature</span> ' + esc(sig.name || 'Ability') + '</p>' + abilityCardBody(row, sig, 'a' + c.abilities.indexOf(sig), x) : '')
      };
    }
    if (p[0] === 'ab') {
      var a = S.abilityByKey(row.c, p[2]);
      if (!a) return null;
      return { kind: a.label || S.KIND[a.type] || 'Ability', title: a.name || 'Ability', body: '<p class="bb-cmeta">' + esc(row.name) + '</p>' + abilityCardBody(row, a, p[2], x) };
    }
    return null;
  }

  // abilityCardBody is an ability in a card: what it reaches, its tiers and a
  // roll button that names its creature, since a card lives outside the row.
  function abilityCardBody(row, a, akey, x) {
    var S = SB(), ref = x.ref || null;
    var meta = [S.parseList(a.keywords).join(', '), a.distance, a.target].filter(Boolean).join(' · ');
    var h = meta ? '<p class="bb-cmeta">' + esc(meta) + '</p>' : '';
    if (a.trigger) h += '<p><b>Trigger</b> ' + S.text(a.trigger, ref) + '</p>';
    if (a.tier1 || a.tier2 || a.tier3) {
      h += '<dl class="bb-tiers">' + S.TIERS.map(function (t) {
        return a[t[0]] ? '<dt>' + esc(t[1]) + '</dt><dd>' + S.text(a[t[0]], ref) + '</dd>' : '';
      }).join('') + '</dl>';
      var bonus = S.rollBonus(a.power_roll);
      if (bonus !== null && x.inst) {
        h += '<p>' + S.rollButtonHtml(akey, bonus, a.name).replace('<button ', '<button data-bb-rk="' + esc(row.key) + '" data-bb-inst="' + esc(x.inst) + '" ') + '</p>';
      }
    }
    var eff = a.effect || a.description;
    if (eff) h += '<p>' + S.text(eff, ref) + '</p>';
    return h;
  }

  // termKey reads the card key from a hovered element in a live stat block.
  function termKey(el, rowKey) {
    var g = function (n) { return el.getAttribute(n); };
    if (g('data-sbx-ab')) return rowKey ? 'ab|' + rowKey + '|' + g('data-sbx-ab') : null;
    if (g('data-sbx-org')) return 'o|' + g('data-sbx-org');
    if (g('data-sbx-role')) return 'r|' + g('data-sbx-role');
    if (g('data-bb-cr')) return 'cr|' + g('data-bb-cr');
    if (el.hasAttribute('data-bb-market')) return 'mk';
    if (/\bds-ref\b/.test(el.className || '')) return 'g|' + String(g('data-ref-id') || el.textContent || '').trim().toLowerCase();
    return null;
  }

  // ── Rolls ─────────────────────────────────────────────────────────────────

  // rollAbility rolls 2d10 + the ability's bonus. rnd() returns [0, 1).
  function rollAbility(row, akey, rnd) {
    var S = SB(), a = S.abilityByKey(row.c, akey);
    if (!a) return null;
    var bonus = S.rollBonus(a.power_roll);
    if (bonus === null) return null;
    var r = rnd || Math.random;
    var d1 = 1 + Math.floor(r() * 10), d2 = 1 + Math.floor(r() * 10);
    var tier = S.rollTier(d1, d2, bonus);
    return { who: row.name, name: a.name || 'Ability', d1: d1, d2: d2, bonus: bonus, total: d1 + d2 + bonus, tier: tier, result: a['tier' + tier] || '' };
  }

  function diceText(r) {
    return r.d1 + ' + ' + r.d2 + (r.bonus < 0 ? ' − ' : ' + ') + Math.abs(r.bonus) + (r.d1 + r.d2 >= 19 ? ', a natural ' + (r.d1 + r.d2) + ' is always tier 3' : '');
  }

  function rollToastHtml(r, ref) {
    var S = SB();
    return '<span class="bb-die">' + esc(r.total) + '</span><span class="bb-rt"><b>' + esc(r.who) + ' · ' + esc(r.name) + '</b> ' +
      '<span class="bb-tier t' + r.tier + '">Tier ' + r.tier + '</span><br><span class="bb-dice">' + esc(diceText(r)) + '</span>' +
      (r.result ? '<br>' + S.text(r.result, ref) : '') + '</span>';
  }

  // ── The tray ──────────────────────────────────────────────────────────────

  function pinsHtml(pins, ctx) {
    if (!pins.length) return '<p class="bb-empty">Pinned cards stay here while you read: conditions, abilities, whole creatures. Click a card’s title to fold it.</p>';
    return pins.map(function (pin) {
      var card = cardFor(pin.key, ctx);
      if (!card) return '';
      return '<div class="bb-ref' + (pin.closed ? ' is-closed' : '') + (pin.fresh ? ' is-new' : '') + '" data-bb-ref="' + esc(pin.key) + '">' +
        '<div class="bb-ref-h"><span class="bb-ref-k">' + esc(card.kind) + '</span>' +
        '<button type="button" class="bb-ref-t" data-bb-fold aria-expanded="' + !pin.closed + '">' + esc(card.title) + '</button>' +
        '<button type="button" class="bb-ref-x" data-bb-unpin aria-label="' + esc('Unpin ' + card.title) + '">×</button></div>' +
        '<div class="bb-ref-b">' + card.body + '</div></div>';
    }).join('');
  }

  function rollsHtml(rolls, ref) {
    if (!rolls.length) return '<li class="bb-empty">Your last five rolls, with the tier they hit.</li>';
    var S = SB();
    return rolls.map(function (r) {
      return '<li class="t' + r.tier + '"><b>' + esc(r.total) + '</b> · ' + esc(r.who + ' · ' + r.name) + ' <span class="bb-dice">(' + esc(diceText(r)) + ')</span><br>Tier ' + r.tier + (r.result ? ': ' + S.text(r.result, ref) : '') + '</li>';
    }).join('');
  }

  // ── Motion ────────────────────────────────────────────────────────────────

  // Off and reduced motion skip every animation; Calm keeps fades (CSS).
  function still(doc) {
    var d = doc || document;
    if (d.documentElement.getAttribute('data-motion') === 'off') return true;
    var w = d.defaultView;
    return !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  var uidSeq = 0;

  // ── Mount ─────────────────────────────────────────────────────────────────

  // mount draws the viewer into el. cfg: { campaignId, editable, layout
  // ('full' | 'compact'), source ('all' | 'campaign' | 'book'), creatures
  // (comma names or book ids, for a compact block), title }. inst is the
  // registered widget, whose loaders read this campaign's Creature pages.
  function mount(el, cfg, inst) {
    var S = SB(), doc = el.ownerDocument;
    var uid = 'bb' + (++uidSeq);
    var cid = cfg.campaignId ? String(cfg.campaignId) : '';
    var compact = cfg.layout === 'compact';
    var editable = cfg.editable === true || cfg.editable === 'true';
    var only = String(cfg.creatures || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var src = /^(all|campaign|book)$/.test(cfg.source || '') ? cfg.source : 'all';
    var v = { q: '', org: '', role: '', src: src, lmin: 0, lmax: 0, sort: compact ? 'level' : 'name', dir: 1, only: only };
    var st = { rows: [], byKey: {}, open: {}, limit: PAGE, pins: [], rolls: [], added: {}, refs: { orgs: [], roles: [] }, ref: null, book: false, gone: false };
    var timers = [], unbinds = [], docHandlers = [];
    var ctx = function () { return { rows: st.byKey, ref: st.ref, refs: st.refs, inst: uid, campaignId: cid, canAdd: editable && !!cid && !compact, added: st.added, tray: !compact, compact: compact }; };

    el.classList.add('bb-root');
    if (compact) el.classList.add('bb-compact');
    S.injectStyles(doc);
    injectStyles(doc);
    el.innerHTML = '<p class="bb-loading" role="status">Loading creatures…</p>';

    var ref = (typeof DrawSteelRefRenderer !== 'undefined' && cid) ? new DrawSteelRefRenderer('', cid) : null;
    var loads = [
      cid ? inst._fetchCampaignCreatures().catch(function () { return null; }) : Promise.resolve([]),
      cid ? S.getJSON('/campaigns/' + encodeURIComponent(cid) + '/systems/drawsteel/data/monsters.json').catch(function () { return null; }) : Promise.resolve(null),
      S.loadRefs(cid),
      ref ? ref.load().then(function () { return ref; }, function () { return null; }) : Promise.resolve(null)
    ];
    Promise.all(loads).then(function (r) {
      if (st.gone) return;
      st.ref = r[3];
      if (st.ref && st.ref.injectStyles) st.ref.injectStyles();
      st.refs = r[2] || st.refs;
      var camp = (r[0] || []).map(fromEntity);
      var book = Array.isArray(r[1]) ? r[1].map(fromBook) : [];
      st.book = book.length > 0;
      st.campaignFailed = r[0] === null;
      if (!st.book && v.src === 'book') v.src = 'all';
      st.rows = camp.concat(book);
      st.rows.forEach(function (row) { st.byKey[row.key] = row; });
      draw();
    });

    // ── Drawing ──
    function q(sel) { return el.querySelector(sel); }

    function draw() {
      var h;
      if (compact) {
        h = '<div class="bb-card"><div class="bb-card-h"><b>' + esc(cfg.title || 'Creatures here') + '</b></div>' +
          (only.length ? '' : '<div class="bb-card-q"><input type="search" class="bb-q" placeholder="Find a creature" aria-label="Find a creature" autocomplete="off"></div>') +
          '<div class="bb-rows"></div><p class="bb-count" role="status"></p></div>';
      } else {
        h = '<div class="bb-app"><div class="bb-list">' +
          (editable && cid ? '<div class="bb-top"><button type="button" class="bb-btn" data-bb-new>+ New creature</button></div>' : '') +
          filterBarHtml(v, st.rows, { uid: uid, book: st.book }) +
          '<div class="bb-explain" aria-live="polite"></div>' + listHeadHtml(v) +
          '<div class="bb-rows"></div><p class="bb-count" role="status"></p></div>' +
          '<aside class="bb-tray" aria-label="Reference tray"><div><h4>Reference<button type="button" class="bb-link" data-bb-clear hidden>Clear</button></h4><div class="bb-refs"></div></div>' +
          '<div><h4>Rolls</h4><ul class="bb-rolls"></ul></div></aside></div>';
      }
      el.innerHTML = h + '<div class="bb-toast" role="status" aria-live="polite" hidden></div>';
      drawRows();
      drawTray();
    }

    function drawRows() {
      var list = visible(st.rows, v);
      var shown = list.slice(0, st.limit);
      var x = ctx();
      var rowsEl = q('.bb-rows');
      if (!rowsEl) return;
      var empty = !st.rows.length
        ? (cid ? 'No creatures yet.' + (st.campaignFailed ? ' This campaign’s Creature pages could not be loaded.' : '') : 'Open this on a campaign page to see its creatures.')
        : 'No creatures match. Clear a filter or the search.';
      rowsEl.innerHTML = shown.length ? shown.map(function (row) { return rowHtml(row, st.open[row.key], x); }).join('') : '<p class="bb-empty">' + esc(empty) + '</p>';
      if (list.length > shown.length) {
        var left = list.length - shown.length;
        rowsEl.insertAdjacentHTML('beforeend', '<p class="bb-more"><button type="button" class="bb-btn" data-bb-more>Show ' + Math.min(PAGE, left) + ' more (' + left + ' left)</button></p>');
      }
      var c = q('.bb-count');
      if (c) c.textContent = compact ? '' : countText(list.length, st.rows.length, v);
      var ex = q('.bb-explain');
      if (ex) {
        ex.innerHTML = explainHtml(v, st.refs, list.length);
        ex.classList.remove('is-in');
        if (ex.innerHTML && !still(doc)) { void ex.offsetWidth; ex.classList.add('is-in'); }
      }
    }

    function drawTray() {
      var refs = q('.bb-refs');
      if (!refs) return;
      refs.innerHTML = pinsHtml(st.pins, ctx());
      st.pins.forEach(function (p) { p.fresh = false; });
      var clr = q('[data-bb-clear]');
      if (clr) clr.hidden = !st.pins.length;
      var rl = q('.bb-rolls');
      if (rl) rl.innerHTML = rollsHtml(st.rolls, st.ref);
      var g = q('[data-bb-guide]');
      if (g) { var on = guideShown(); g.setAttribute('aria-pressed', String(on)); g.textContent = on ? 'Hide the guide' : 'What do these mean?'; }
    }

    function pin(key) {
      if (!cardFor(key, ctx())) return;
      st.pins = st.pins.filter(function (p) { return p.key !== key; });
      st.pins.unshift({ key: key, closed: false, fresh: !still(doc) });
      st.pins = st.pins.slice(0, MAX_PINS);
      drawTray();
    }

    function guideShown() { return st.pins.some(function (p) { return /^guide\|/.test(p.key); }); }
    function setGuide(on) {
      st.pins = st.pins.filter(function (p) { return !/^guide\|/.test(p.key); });
      if (on) { pin('guide|roles'); pin('guide|orgs'); } else drawTray();
      var t = q('.bb-tray');
      if (on && t && doc.defaultView && doc.defaultView.innerWidth <= 1100 && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: still(doc) ? 'auto' : 'smooth' });
    }

    // Rows open in place, so their height can animate; a closed row drops its
    // stat block once the fold has finished.
    function toggleRow(rowEl) {
      var key = rowEl.getAttribute('data-bb-row'), row = st.byKey[key];
      if (!row) return;
      var open = !st.open[key];
      st.open[key] = open;
      var body = rowEl.querySelector('.bb-rbody > div');
      if (open) body.innerHTML = bodyHtml(row, ctx());
      rowEl.classList.toggle('is-open', open);
      rowEl.querySelector('[data-bb-toggle]').setAttribute('aria-expanded', String(open));
      if (!open) timers.push(setTimeout(function () { if (!st.open[key]) body.innerHTML = ''; }, still(doc) ? 0 : 220));
    }

    function redrawRow(key) {
      var rowEl = el.querySelector('[data-bb-row="' + key + '"]');
      if (rowEl && st.open[key]) rowEl.querySelector('.bb-rbody > div').innerHTML = bodyHtml(st.byKey[key], ctx());
    }

    var toastTimer = 0;
    function roll(rowKey, akey) {
      var row = st.byKey[rowKey];
      var r = row && rollAbility(row, akey);
      if (!r) return;
      var t = q('.bb-toast');
      t.innerHTML = rollToastHtml(r, st.ref);
      t.hidden = false;
      t.classList.remove('is-in');
      if (!still(doc)) { void t.offsetWidth; t.classList.add('is-in'); }
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
      st.rolls.unshift(r);
      st.rolls = st.rolls.slice(0, MAX_ROLLS);
      drawTray();
    }

    // Add to campaign copies a book creature onto a new Creature page. A
    // server message is never shown; the widget's own words are.
    function addToCampaign(row, btn) {
      var msg = btn.parentNode.querySelector('.bb-msg');
      btn.disabled = true;
      if (msg) msg.textContent = 'Adding…';
      inst._creatureType().then(function (id) {
        if (!id) { var e = new Error('The Draw Steel “Creature” type is not installed in this campaign.'); e.ours = true; throw e; }
        var fields = S.toFields(row.c);
        // The copy remembers its book entry, for Compare with the book.
        if (row.src === 'book' && row.slug) fields[S.SOURCE_KEY] = row.slug;
        return Chronicle.apiFetch(inst._entityUrl(cid), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: row.name.slice(0, 200), entity_type_id: id, type_label: 'drawsteel-creature', fields_data: fields })
        }).then(function (res) {
          if (!res.ok) throw new Error('create -> ' + res.status);
          return res.json().catch(function () { return {}; });
        }).then(function (made) {
          var newId = made && (made.id || (made.data && made.data.id));
          if (!newId) throw new Error('create returned no id');
          st.added[row.key] = String(newId);
          var copy = fromEntity({ id: newId, name: row.name, fields_data: fields });
          st.rows.push(copy);
          st.byKey[copy.key] = copy;
          redrawRow(row.key);
          var c = q('.bb-count');
          if (c && !compact) c.textContent = countText(visible(st.rows, v).length, st.rows.length, v);
        });
      }).catch(function (err) {
        if (typeof console !== 'undefined') console.warn('Bestiary: add failed', err);
        btn.disabled = false;
        if (msg) msg.textContent = err && err.ours ? err.message : 'Could not add this creature. Please try again.';
      });
    }

    // ── Events ──
    function onClick(e) {
      var t = e.target, b;
      if ((b = t.closest('[data-bb-org]'))) { v.org = v.org === b.getAttribute('data-bb-org') ? '' : b.getAttribute('data-bb-org'); press('[data-bb-org]', 'data-bb-org', v.org); refilter(); return; }
      if ((b = t.closest('[data-bb-role]'))) { v.role = v.role === b.getAttribute('data-bb-role') ? '' : b.getAttribute('data-bb-role'); press('[data-bb-role]', 'data-bb-role', v.role); refilter(); return; }
      if ((b = t.closest('[data-bb-sort]'))) {
        var by = b.getAttribute('data-bb-sort');
        v.dir = v.sort === by ? -v.dir : 1; v.sort = by;
        Array.prototype.forEach.call(el.querySelectorAll('[data-bb-sort]'), function (x) {
          x.setAttribute('aria-sort', x === b ? (v.dir > 0 ? 'ascending' : 'descending') : 'none');
        });
        drawRows(); return;
      }
      if (t.closest('[data-bb-more]')) {
        var before = el.querySelectorAll('[data-bb-row]').length;
        st.limit += PAGE; drawRows();
        var next = el.querySelectorAll('[data-bb-toggle]')[before];
        if (next) next.focus();
        return;
      }
      if ((b = t.closest('[data-bb-add]'))) { var rk = b.closest('[data-bb-row]').getAttribute('data-bb-row'); if (st.byKey[rk]) addToCampaign(st.byKey[rk], b); return; }
      if (t.closest('[data-bb-new]')) {
        inst._creatureType().then(function (id) {
          doc.defaultView.location.href = '/campaigns/' + encodeURIComponent(cid) + '/entities/new' + (id ? '?type=' + encodeURIComponent(id) : '');
        });
        return;
      }
      if (t.closest('[data-bb-guide]')) { setGuide(!guideShown()); return; }
      if (t.closest('[data-bb-clear]')) { st.pins = []; drawTray(); return; }
      var refEl = t.closest('[data-bb-ref]');
      if (refEl && t.closest('[data-bb-unpin]')) { var k = refEl.getAttribute('data-bb-ref'); st.pins = st.pins.filter(function (p) { return p.key !== k; }); drawTray(); return; }
      if (refEl && t.closest('[data-bb-fold]')) { var fk = refEl.getAttribute('data-bb-ref'); st.pins.forEach(function (p) { if (p.key === fk) p.closed = !p.closed; }); drawTray(); return; }
      if (t.closest('[data-bb-pin]') && !t.closest('.chc')) { pin(t.closest('[data-bb-pin]').getAttribute('data-bb-pin')); return; }
      if (t.closest('a, button, input, select, [data-sbx-ab], [data-sbx-org], [data-sbx-role], .ds-ref')) return;
      var h = t.closest('[data-bb-toggle]');
      if (h) toggleRow(h.parentNode);
    }

    function press(sel, attr, val) {
      Array.prototype.forEach.call(el.querySelectorAll(sel), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute(attr) === val)); });
    }
    function refilter() { st.limit = PAGE; drawRows(); }

    var typing = 0;
    function onInput(e) {
      if (!e.target.classList.contains('bb-q')) return;
      var val = e.target.value;
      clearTimeout(typing);
      typing = setTimeout(function () { v.q = val; refilter(); }, 150);
    }
    function onChange(e) {
      var t = e.target;
      if (t.hasAttribute('data-bb-lmin')) { v.lmin = Number(t.value) || 0; refilter(); }
      else if (t.hasAttribute('data-bb-lmax')) { v.lmax = Number(t.value) || 0; refilter(); }
      else if (t.type === 'radio' && t.name === 'bb-src-' + uid) { v.src = t.value; refilter(); }
    }
    function onKey(e) {
      var h = e.target.closest && e.target.closest('[data-bb-toggle]');
      if (h && e.target === h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleRow(h.parentNode); }
    }
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey);

    // Roll and Pin buttons also live inside a hover card, outside el, and the
    // card swallows its own clicks; listening on the document in the capture
    // phase reaches them first. A card's buttons name this viewer.
    function onDocClick(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest('[data-sbx-roll]');
      if (b) {
        var inCard = !el.contains(b);
        if (inCard && b.getAttribute('data-bb-inst') !== uid) return;
        var rowEl = inCard ? null : b.closest('[data-bb-row]');
        var rk = rowEl ? rowEl.getAttribute('data-bb-row') : b.getAttribute('data-bb-rk');
        e.preventDefault(); e.stopPropagation();
        roll(rk, b.getAttribute('data-sbx-roll'));
        return;
      }
      var p = t.closest('.chc [data-bb-pin]');
      if (p && p.getAttribute('data-bb-inst') === uid) {
        e.preventDefault(); e.stopPropagation();
        pin(p.getAttribute('data-bb-pin'));
        if (typeof Chronicle !== 'undefined' && Chronicle.hovercard) Chronicle.hovercard.close();
      }
    }
    // The guide is a toggle: a click anywhere but the button, the guide's own
    // cards or a hover card puts it away. Cards pinned by hand stay.
    function onDocBubble(e) {
      if (!guideShown() || !e.target || !e.target.closest) return;
      if (e.target.closest('[data-bb-guide], [data-bb-ref^="guide|"], .chc')) return;
      setGuide(false);
    }
    doc.addEventListener('click', onDocClick, true);
    doc.addEventListener('click', onDocBubble);
    docHandlers.push(['click', onDocClick, true], ['click', onDocBubble, false]);

    // ── Hover cards ──
    var HC = (typeof Chronicle !== 'undefined' && Chronicle.hovercard) ? Chronicle.hovercard : null;
    if (HC) {
      el.classList.add('bb-hc');
      var content = function (t) {
        var rowEl = t.closest('[data-bb-row]');
        var rowKey = rowEl ? rowEl.getAttribute('data-bb-row') : '';
        if (!rowKey) { var r = t.closest('[data-bb-ref]'); if (r) rowKey = String(r.getAttribute('data-bb-ref')).split('|')[1] || ''; }
        var key = termKey(t, rowKey);
        var card = key && cardFor(key, ctx());
        if (!card) return null;
        var pinBtn = !compact && !/^guide\|/.test(key) && key !== 'mk'
          ? '<p class="bb-cpin"><button type="button" class="bb-btn" data-bb-pin="' + esc(key) + '" data-bb-inst="' + esc(uid) + '">Pin to the tray</button></p>' : '';
        return { kind: card.kind, title: card.title, extraHTML: '<div class="bb-cbody">' + card.body + '</div>' + pinBtn };
      };
      unbinds.push(HC.bind(el, '.ds-ref, [data-sbx-ab], [data-sbx-org], [data-sbx-role], [data-bb-market]', content, { pinOnClick: true }));
      unbinds.push(HC.bind(el, '[data-bb-cr]', content, {}));
    }

    return {
      destroy: function () {
        st.gone = true;
        timers.forEach(clearTimeout);
        clearTimeout(toastTimer); clearTimeout(typing);
        unbinds.forEach(function (u) { u(); });
        docHandlers.forEach(function (h) { doc.removeEventListener(h[0], h[1], h[2]); });
        el.removeEventListener('click', onClick);
        el.removeEventListener('input', onInput);
        el.removeEventListener('change', onChange);
        el.removeEventListener('keydown', onKey);
        el.innerHTML = '';
      },
      state: st, view: v
    };
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  // Chronicle's colour tokens, so light and dark follow the site. Every
  // transition and animation has a Calm (fade only) and an Off (none) rule,
  // and reduced motion counts as Off.
  var T = { card: 'var(--color-card-bg,#fff)', edge: 'var(--color-border,#e5e7eb)', text: 'var(--color-text-primary,#111827)', body: 'var(--color-text-body,#374151)', muted: 'var(--color-text-secondary,#6b7280)', alt: 'var(--color-bg-tertiary,#f3f4f6)', acc: 'var(--color-accent,#6366f1)', soft: 'rgba(var(--color-accent-rgb,99,102,241),.12)' };
  var CSS = [
    '.bb-root{font-size:14px;color:' + T.body + ';--bb-t1:#94a3b8;--bb-t2:#6366f1;--bb-t3:#16a34a;--bb-tape:#facc15;--bb-tape-ink:#1f2937}',
    '.dark .bb-root{--bb-t1:#64748b;--bb-t2:#818cf8;--bb-t3:#4ade80;--bb-tape:#eab308;--bb-tape-ink:#111827}',
    '.bb-loading,.bb-empty{color:' + T.muted + ';font-size:13px;margin:0;padding:12px 0}',
    '.bb-app{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px;align-items:start}',
    '.bb-list{min-width:0;display:flex;flex-direction:column}',
    '.bb-top{display:flex;justify-content:flex-end;margin-bottom:8px}',
    '.bb-fbar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;padding:12px;border:1px solid ' + T.edge + ';border-radius:12px;background:' + T.card + ';margin-bottom:8px}',
    '.bb-grp{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.bb-grow{flex:1 1 200px}',
    '.bb-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:' + T.muted + ';font-weight:600}',
    '.bb-q{width:100%;box-sizing:border-box;border:1px solid ' + T.edge + ';border-radius:8px;padding:6px 10px;background:var(--color-input-bg,' + T.card + ');color:' + T.text + ';font:inherit;font-size:13.5px}',
    '.bb-lvl{display:flex;gap:6px;align-items:center;font-size:12.5px}',
    '.bb-lvl select{border:1px solid ' + T.edge + ';border-radius:8px;padding:4px 6px;background:var(--color-input-bg,' + T.card + ');color:' + T.text + ';font:inherit;font-size:12.5px}',
    '.bb-chips{display:flex;gap:5px;flex-wrap:wrap}',
    '.bb-chip{border:1px solid ' + T.edge + ';background:' + T.card + ';color:' + T.body + ';border-radius:999px;padding:2px 9px;font:inherit;font-size:12px;cursor:pointer}',
    '.bb-chip[aria-pressed="true"]{background:' + T.soft + ';color:' + T.acc + ';border-color:transparent;font-weight:600}',
    '.bb-srcs{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.bb-srcs label{display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer}',
    '.bb-srcs input{accent-color:' + T.acc + '}',
    '.bb-taped{position:relative;overflow:hidden;display:inline-flex;align-items:center;border:1px dashed ' + T.edge + ';border-radius:6px;padding:3px 8px 13px;min-width:92px;justify-content:center;font:inherit;font-size:13px;background:none;color:' + T.muted + ';cursor:not-allowed}',
    '.bb-tape{position:absolute;left:-10%;right:-10%;bottom:1px;height:12px;transform:rotate(-3deg);background:repeating-linear-gradient(-45deg,var(--bb-tape) 0 9px,var(--bb-tape-ink) 9px 18px);display:grid;place-items:center;pointer-events:none}',
    '.bb-tape span{background:var(--bb-tape);color:var(--bb-tape-ink);font-size:8px;font-weight:800;letter-spacing:.08em;padding:0 4px;line-height:12px;text-transform:uppercase}',
    '.bb-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid ' + T.edge + ';background:' + T.card + ';color:' + T.text + ';border-radius:8px;padding:5px 10px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}',
    '.bb-btn:hover{background:' + T.alt + '}',
    '.bb-btn[aria-pressed="true"]{background:' + T.soft + ';color:' + T.acc + '}',
    '.bb-btn:disabled{opacity:.6;cursor:default}',
    '.bb-link{border:0;background:none;color:' + T.acc + ';cursor:pointer;font:inherit;font-size:12px;margin-left:auto;text-transform:none;letter-spacing:0}',
    '.bb-explain:empty{display:none}',
    '.bb-explain{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:' + T.soft + ';color:' + T.text + ';font-size:13px}',
    '.bb-ex{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.bb-ex b{color:' + T.acc + '}',
    '.bb-ex-n{align-self:center;color:' + T.muted + ';font-size:12.5px}',
    '.bb-lhead,.bb-rhead{display:grid;grid-template-columns:minmax(0,1fr) 54px 150px 46px;gap:8px;align-items:center}',
    '.bb-lhead{padding:0 10px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:' + T.muted + ';font-weight:600;border-bottom:1px solid ' + T.edge + '}',
    '.bb-lhead button{all:unset;cursor:pointer}',
    '.bb-lhead button:focus-visible{outline:2px solid ' + T.acc + '}',
    '.bb-lhead button[aria-sort="ascending"]::after{content:" ↑"}',
    '.bb-lhead button[aria-sort="descending"]::after{content:" ↓"}',
    '.bb-row{border-bottom:1px solid ' + T.edge + '}',
    '.bb-rhead{padding:8px 10px;cursor:pointer}',
    '.bb-rhead:hover{background:' + T.alt + '}',
    '.bb-rhead:focus-visible{outline:2px solid ' + T.acc + ';outline-offset:-2px}',
    '.bb-row.is-open>.bb-rhead{background:' + T.soft + '}',
    '.bb-nm{font-weight:600;color:' + T.text + ';display:flex;align-items:center;gap:8px;min-width:0}',
    '.bb-nmt{min-width:0}',
    '.bb-car{color:' + T.muted + ';font-size:11px;flex-shrink:0;transition:transform 160ms cubic-bezier(.2,.8,.2,1)}',
    '.bb-row.is-open .bb-car{transform:rotate(90deg)}',
    '.bb-t{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bb-kw{display:block;font-size:12px;color:' + T.muted + ';font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bb-c{font-size:13px;font-variant-numeric:tabular-nums}',
    '.bb-c small{color:' + T.muted + '}',
    '.bb-rbody{display:grid;grid-template-rows:0fr;transition:grid-template-rows 200ms cubic-bezier(.2,.8,.2,1)}',
    '.bb-row.is-open>.bb-rbody{grid-template-rows:1fr}',
    '.bb-rbody>div{overflow:hidden;min-height:0}',
    '.bb-sb{padding:10px 10px 14px 30px;display:flex;flex-direction:column;gap:8px}',
    '.bb-sb .sbx{padding:14px 16px}',
    '.bb-foot{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.bb-pill{display:inline-flex;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:' + T.alt + ';color:' + T.body + '}',
    '.bb-pill.is-ok{background:rgba(22,163,74,.12);color:#15803d}',
    '.dark .bb-pill.is-ok{color:#4ade80}',
    '.bb-msg{font-size:12.5px;color:' + T.muted + '}',
    '.bb-more{text-align:center;margin:10px 0 0}',
    '.bb-count{font-size:12.5px;color:' + T.muted + ';padding:8px 10px 0;margin:0}',
    '.bb-hc .ds-ref:hover::after{content:none;display:none}',
    '.bb-tray{position:sticky;top:12px;display:flex;flex-direction:column;gap:14px}',
    '.bb-tray h4{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:' + T.muted + ';font-weight:600}',
    '.bb-refs{display:flex;flex-direction:column;gap:8px}',
    '.bb-ref{border:1px solid ' + T.edge + ';border-radius:10px;background:' + T.card + ';font-size:12.5px}',
    '.bb-ref-h{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 10px}',
    '.bb-ref-k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:' + T.muted + ';font-weight:600}',
    '.bb-ref-t{flex:1;min-width:0;border:0;background:none;padding:0;text-align:left;font:inherit;font-weight:700;color:' + T.text + ';cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bb-ref-x{border:0;background:none;color:' + T.muted + ';cursor:pointer;font-size:15px;line-height:1;padding:0 4px}',
    '.bb-ref-b{padding:0 10px 10px}',
    '.bb-ref.is-closed .bb-ref-b{display:none}',
    '.bb-ref-b p,.bb-cbody p{margin:0 0 6px}',
    '.bb-cmeta{color:' + T.muted + ';font-size:12px}',
    '.bb-csig{font-weight:700}',
    '.bb-csig span{font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;opacity:.7}',
    '.bb-tiers{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 8px;margin:0 0 6px}',
    '.bb-tiers dt{font:600 11px/1.6 ui-monospace,Consolas,monospace;color:' + T.muted + '}',
    '.bb-tiers dd{margin:0}',
    '.bb-mini{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0 0 6px;text-align:center}',
    '.bb-mini div{background:' + T.alt + ';border-radius:6px;padding:3px 2px;font-size:11px;color:' + T.muted + '}',
    '.bb-mini b{display:block;font-size:14px;color:' + T.text + ';font-variant-numeric:tabular-nums}',
    '.bb-guide{width:100%;border-collapse:collapse;font-size:12px}',
    '.bb-guide td{padding:4px;border-bottom:1px solid ' + T.edge + ';vertical-align:top}',
    '.bb-guide td:first-child{font-weight:600;color:' + T.text + ';white-space:nowrap}',
    '.bb-rolls{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:12.5px}',
    '.bb-rolls li{border-left:3px solid var(--bb-t2);padding:2px 0 2px 8px}',
    '.bb-rolls li.t1{border-color:var(--bb-t1)}.bb-rolls li.t3{border-color:var(--bb-t3)}',
    '.bb-rolls li.bb-empty{border:1px dashed ' + T.edge + ';border-radius:8px;padding:8px}',
    '.bb-dice{font:500 11.5px/1.5 ui-monospace,Consolas,monospace;color:' + T.muted + '}',
    '.bb-toast{position:fixed;left:50%;top:72px;transform:translateX(-50%);z-index:60;background:' + T.card + ';border:1px solid ' + T.edge + ';box-shadow:0 14px 32px rgba(17,24,39,.16);border-radius:12px;padding:10px 14px;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px);font-size:13px;color:' + T.body + '}',
    '.bb-toast[hidden]{display:none}',
    '.bb-die{font-size:24px;font-weight:800;color:' + T.text + ';font-variant-numeric:tabular-nums;min-width:34px;text-align:center}',
    '.bb-tier{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;color:#fff;background:var(--bb-t2)}',
    '.bb-tier.t1{background:var(--bb-t1)}.bb-tier.t3{background:var(--bb-t3)}',
    '.bb-card{border:1px solid ' + T.edge + ';border-radius:12px;background:' + T.card + ';overflow:hidden}',
    '.bb-card-h{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid ' + T.edge + ';font-size:13px;color:' + T.text + '}',
    '.bb-card-q{padding:8px 12px;border-bottom:1px solid ' + T.edge + '}',
    '.bb-compact .bb-rhead{grid-template-columns:minmax(0,1fr) auto}',
    '.bb-compact .bb-sb{padding:8px 10px 12px}',
    '.bb-compact .bb-row:last-child{border-bottom:0}',
    '.bb-compact .bb-count:empty{display:none}',
    '@keyframes bb-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes bb-drop{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}',
    '@keyframes bb-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
    '.bb-explain.is-in{animation:bb-fade 160ms linear}',
    '.bb-toast.is-in{animation:bb-drop 220ms cubic-bezier(.2,.8,.2,1)}',
    '.bb-ref.is-new{animation:bb-in 220ms cubic-bezier(.2,.8,.2,1)}',
    'html[data-motion="calm"] .bb-rbody{transition:none}',
    'html[data-motion="calm"] .bb-row.is-open>.bb-rbody>div{animation:bb-fade 180ms linear}',
    'html[data-motion="calm"] .bb-car{transition:none}',
    'html[data-motion="calm"] .bb-toast.is-in,html[data-motion="calm"] .bb-ref.is-new{animation:bb-fade 160ms linear}',
    'html[data-motion="off"] .bb-rbody,html[data-motion="off"] .bb-car{transition:none}',
    'html[data-motion="off"] .bb-root *{animation:none!important}',
    '@media (prefers-reduced-motion:reduce){.bb-rbody,.bb-car{transition:none}.bb-root *{animation:none!important}}',
    '@media (max-width:1100px){.bb-app{grid-template-columns:1fr}.bb-tray{position:static;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}',
    '@media (max-width:640px){.bb-lhead{display:none}.bb-rhead{grid-template-columns:minmax(0,1fr) auto auto}.bb-org{display:none}.bb-sb{padding-left:10px}.bb-toast{top:auto;bottom:16px}}'
  ].join('\n');

  // injectStyles puts the CSS in <head> once, never inside the mount, which a
  // redraw would wipe.
  function injectStyles(doc) {
    var d = doc || document;
    if (!d.head || d.querySelector('style[data-ds-bestiary]')) return;
    var s = d.createElement('style');
    s.setAttribute('data-ds-bestiary', 'true');
    s.textContent = CSS;
    d.head.appendChild(s);
  }

  return {
    ORGS: ORGS, ROLES: ROLES, PAGE: PAGE, MAX_PINS: MAX_PINS, MAX_ROLLS: MAX_ROLLS,
    esc: esc, fromEntity: fromEntity, fromBook: fromBook, matches: matches, visible: visible, levels: levels,
    filterBarHtml: filterBarHtml, orgLine: orgLine, roleLine: roleLine, explainHtml: explainHtml, guideHtml: guideHtml,
    listHeadHtml: listHeadHtml, rowHtml: rowHtml, bodyHtml: bodyHtml, countText: countText,
    cardFor: cardFor, termKey: termKey, rollAbility: rollAbility, rollToastHtml: rollToastHtml, diceText: diceText,
    pinsHtml: pinsHtml, rollsHtml: rollsHtml, mount: mount, CSS: CSS
  };
})();

// The placeable widget. Its loaders read this campaign's Creature pages: the
// entity list is an envelope, paged at most 100 at a time, filtered by the
// Creature type's id.
if (typeof Chronicle !== 'undefined' && Chronicle && Chronicle.register) {
  Chronicle.register('bestiary-browser', {
    init: function (el, config) {
      this.el = el;
      this.config = config || {};
      if (typeof DrawSteelStatblock === 'undefined') { el.textContent = 'The Draw Steel stat block did not load. Reload the page to try again.'; return; }
      this._view = DrawSteelBestiary.mount(el, this.config, this);
    },

    destroy: function (el) {
      if (this._view) this._view.destroy();
      this._view = null;
      el.innerHTML = '';
    },

    // _entityUrl builds a campaign entity API path; percent-encoding keeps a
    // stray "/" or "?" in an id from reshaping the request path.
    _entityUrl: function (campaignId, entityId) {
      var url = '/api/v1/campaigns/' + encodeURIComponent(campaignId) + '/entities';
      if (entityId !== undefined && entityId !== null && entityId !== '') url += '/' + encodeURIComponent(entityId);
      return url;
    },

    // Lists are a bare array or {data:[…],total:N}; accept both.
    _unwrapList: function (body) {
      if (Array.isArray(body)) return body;
      if (!body) return [];
      if (Array.isArray(body.data)) return body.data;
      if (Array.isArray(body.results)) return body.results;
      return [];
    },

    // The Creature type's id: Chronicle records a system preset's category as
    // preset_category, and ListEntities filters by type_id only.
    _resolveCreatureTypeId: function () {
      var self = this;
      return Chronicle.apiFetch('/api/v1/campaigns/' + encodeURIComponent(this.config.campaignId) + '/entity-types')
        .then(function (r) { return r.json(); })
        .then(function (body) {
          var types = self._unwrapList(body), i;
          for (i = 0; i < types.length; i++) if (types[i] && types[i].preset_category === 'creature') return types[i].id;
          for (i = 0; i < types.length; i++) if (types[i] && types[i].slug === 'drawsteel-creature') return types[i].id;
          for (i = 0; i < types.length; i++) if (types[i] && String(types[i].name || '').toLowerCase() === 'creature') return types[i].id;
          return 0;
        })
        .catch(function () { return 0; });
    },

    _creatureType: function () {
      if (!this._typeP) this._typeP = this._resolveCreatureTypeId();
      return this._typeP;
    },

    // Walk every page: per_page defaults to 20 and is capped at 100. Bounded so
    // a bad `total` cannot spin forever.
    _fetchEntityPages: function (typeId) {
      var self = this, acc = [];
      var base = this._entityUrl(this.config.campaignId) + '?per_page=100' + (typeId ? '&type_id=' + encodeURIComponent(typeId) : '');
      function page(n) {
        return Chronicle.apiFetch(base + '&page=' + n)
          .then(function (r) { if (!r.ok) throw new Error('entities -> ' + r.status); return r.json(); })
          .then(function (body) {
            var items = self._unwrapList(body);
            acc = acc.concat(items);
            var total = (body && typeof body.total === 'number') ? body.total : acc.length;
            if (items.length === 0 || acc.length >= total || n >= 50) return acc;
            return page(n + 1);
          });
      }
      return page(1);
    },

    // Only pages of the Creature type: without it the campaign's other pages
    // would show as creatures, so none are listed.
    _fetchCampaignCreatures: function () {
      var self = this;
      return this._creatureType().then(function (id) { return id ? self._fetchEntityPages(id) : []; });
    }
  });
}

// Test seam: inert in a browser (no CommonJS module).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrawSteelBestiary;
}
