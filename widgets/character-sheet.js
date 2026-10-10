/**
 * Draw Steel Character Sheet Widget — dynamic-surface adopter.
 *
 * Mounts on a drawsteel-character entity page via Chronicle's manifest-driven
 * renderer registration. Reads entity fields_data + children from the mount
 * div's data attributes for first paint without an API call; falls back to
 * the entities API when embedded as a plain widget.
 *
 * MOUNT CONTRACT (do not change — the manifest binding
 * `drawsteel-character → character-sheet` depends on it):
 *   Chronicle.register('character-sheet', { init, destroy })
 *   init reads el.dataset.{fieldsData,entityId,campaignId,csrfToken,children,
 *   isGm,isOwner,visibility,canEditIdentity,canChangeImage,armoryItems}
 *
 * When Chronicle.sheetMotion exists the sheet is laid out as paper (see the
 * "Paper sheet" section): a data-sheet root, one .paper of parts, each part
 * a pull with its panel in a <template>. Without it the box render below
 * runs unchanged.
 *
 * Mounts via Chronicle's dynamic-surface frame (`Chronicle.surface`): each
 * section is a box renderer (`registerBox('ds-*', fn)`) emitting INNER
 * content only — the frame owns box chrome. Only boxes with content are
 * included, so empty sections are absent, not empty titled boxes.
 *
 * The Abilities box is a master-detail (rail + detail pane) wired via one
 * delegated listener, since the frame re-renders box bodies.
 *
 * Foundry is the source of truth. The one write path is the origin picker
 * (ancestry / culture / career / kit), delegated to Chronicle.pickChoice.
 *
 * LAYOUT: cross-system slot points (character_skills / character_inventory /
 * character_purchase_history) are appended after the surface, inert + hidden
 * until Chronicle's block registry has a stable hydration path. Names are
 * placeholders.
 */
(function () {
  'use strict';

  // In a browser this is window.Chronicle; in Node (the unit tests below) it's
  // null — the register/registerBoxes side-effects are guarded on it, while the
  // pure helpers are exported for testing. Browser behavior is unchanged.
  var Chronicle = (typeof window !== 'undefined' && window.Chronicle) ? window.Chronicle : null;

  // Module-singleton reference renderer. One Draw Steel system per page, so a
  // single shared renderer (and its glossary cache) backs every box renderer.
  var refRenderer = null;

  // Skill catalog (slug → {name, description, group}) from data/skills.json,
  // loaded once at mount so skill chips can show a definition tooltip. Module
  // singleton like the reference renderer (one DS system per page).
  var skillDefs = null;
  function loadSkillDefs(campaignId) {
    if (skillDefs) return Promise.resolve();
    // Campaign-scoped is the only route Chronicle serves for this file. With
    // no campaign id the honest behaviour is the degraded one the .catch
    // below already provides: empty defs, no tooltips, no fake fetch.
    if (!campaignId) { skillDefs = {}; return Promise.resolve(); }
    var url = '/campaigns/' + encodeURIComponent(campaignId) + '/systems/drawsteel/data/skills.json';
    var fetchFn = Chronicle.apiFetch || fetch;
    return fetchFn(url)
      .then(function (r) { return r.json(); })
      .then(function (arr) {
        var m = {};
        (Array.isArray(arr) ? arr : []).forEach(function (s) { if (s && s.slug) m[String(s.slug).toLowerCase()] = s; });
        skillDefs = m;
      })
      .catch(function () { skillDefs = {}; });
  }

  // ── primitive helpers ──────────────────────────────────────────────

  function esc(s) {
    return Chronicle.escapeHtml(s == null ? '' : String(s));
  }

  // escAttr escapes for HTML ATTRIBUTE context — it also escapes quotes, which
  // Chronicle.escapeHtml does NOT, so it is required wherever a value lands
  // inside a "…" attribute (else a value with a double-quote breaks out and
  // injects an event handler). Prefers the platform helper; falls back to a
  // self-contained implementation so the widget stays robust across Chronicle
  // versions and testable off-browser.
  function escAttr(s) {
    s = (s == null) ? '' : String(s);
    if (Chronicle && Chronicle.escapeAttr) return Chronicle.escapeAttr(s);
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // safeImgUrl returns the URL only when it is http(s), protocol-relative,
  // root-relative, or a scheme-less relative path; otherwise '' (caller shows a
  // placeholder). Blocks javascript:/data:/vbscript: portrait_url values. (H-1)
  function safeImgUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (!u) return '';
    if (/^(?:https?:)?\/\//i.test(u)) return u;   // http(s):// or //host
    if (u.charAt(0) === '/') return u;             // root-relative /path
    if (u.indexOf(':') === -1) return u;           // scheme-less relative
    return '';                                      // foreign scheme -> reject
  }

  // refText escapes THEN resolves {@category term} tokens to ref spans. Safe to
  // call before the glossary loads (renderText degrades to plain text), but the
  // mount is deferred until refRenderer.load() resolves so first paint is lit.
  function refText(s) {
    var e = esc(s);
    return refRenderer ? refRenderer.renderText(e) : e;
  }

  // refSynced renders SYNCED Foundry prose (already enricher-cleaned to plain
  // text): escape, resolve any {@…} (usually none), THEN scan for bare condition
  // terms and wrap them with glossary tooltips — so synced text gets the same
  // condition definitions hand-authored {@…} text would. Safe because the input
  // is plain (no pre-existing ref spans for the scanner to corrupt).
  function refSynced(s) {
    var e = esc(s);
    if (!refRenderer) return e;
    e = refRenderer.renderText(e);
    return refRenderer.scanText ? refRenderer.scanText(e) : e;
  }

  function parseJson(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  // parseStrList coerces a Set-derived field (array, JSON-string array, or CSV)
  // into an array of strings. For movement modes / languages / status immunities.
  function parseStrList(v) {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'object') return Object.keys(v).map(String);
    var s = String(v).trim();
    if (s.charAt(0) === '[') { var p = parseJson(s, null); if (Array.isArray(p)) return p.map(String); }
    return s.split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function parseJsonAttr(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  // f / num read a custom field off the seed bundle (data.fields = the entity's
  // custom_fields), mirroring the former this._f / this._num helpers.
  function f(data, key, fallback) {
    var cf = (data && data.fields) || {};
    var v = cf[key];
    if (v === undefined || v === null || v === '') return fallback;
    return v;
  }

  // scalar unwraps Foundry's power-roll object shape to a plain value. The
  // Foundry sync writes characteristics as { value, dice, edges, banes } objects
  // (not bare numbers), so num()/isNum() must read .value or every stat reads 0.
  function scalar(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.value !== undefined) return v.value;
    return v;
  }

  function num(data, key, fallback) {
    var v = scalar(f(data, key, fallback));
    var n = Number(v);
    return isNaN(n) ? fallback : n;
  }

  function isNum(data, key) {
    var v = scalar(f(data, key, null));
    if (v == null) return false;
    return !isNaN(Number(v));
  }

  // invItems returns the entity's has-item child relations (inventory source).
  function invItems(data) {
    var ch = data && data.children;
    if (!Array.isArray(ch)) return [];
    return ch.filter(function (c) { return c && c.relation && c.relation.slug === 'has-item'; });
  }

  // parseAbilities returns the flat ability array (the indices used by the
  // in-box cards' data-ds-ability and the overlay handler MUST agree).
  function parseAbilities(data) {
    var arr = parseJson(f(data, 'abilities_json', ''), []);
    return Array.isArray(arr) ? arr : [];
  }

  // flag reads a boolean mount attribute defensively: absent means false.
  function flag(v) { return v === 'true' || v === '1'; }

  // ── box renderers (INNER content only; the frame owns the box chrome) ──
  // Each is a pure function of (boxDef, seed). Registered once via registerBoxes.

  // rIdentity is the identity band under Chronicle's page header (which shows
  // the name): portrait, the four origin choices, and the fixed Foundry-owned
  // facts. Editable origin values are buttons only when the host says the
  // viewer may edit them; otherwise they are plain text.
  var ORIGIN_SLOTS = [
    { key: 'ancestry', label: 'Ancestry' },
    { key: 'culture', label: 'Culture' },
    { key: 'career', label: 'Career' },
    { key: 'kit', label: 'Kit' }
  ];

  function rIdentity(def, data) {
    var name = data.name || 'Unnamed Hero';
    var level = num(data, 'level', 1);
    var canEdit = !!data.canEditIdentity;
    // Without Chronicle's picker an editable-looking value would do nothing,
    // so the values stay plain text.
    var canPick = canEdit && typeof Chronicle.pickChoice === 'function';

    // portrait_url is user-authored: validate the scheme and escape both
    // attribute values (escAttr, not esc, since escapeHtml leaves quotes).
    var safePortrait = safeImgUrl(f(data, 'portrait_url', ''));
    var portraitHtml = safePortrait
      ? '<img class="cs-portrait" data-cs-portrait src="' + escAttr(safePortrait) + '" alt="' + escAttr(name) + '">'
      : '<div class="cs-portrait cs-portrait-placeholder" data-cs-portrait><i class="fa-solid fa-shield-halved"></i></div>';
    // A claimed player may edit identity but not replace the picture, so the
    // chip follows its own flag; Chronicle has no upload for them to reach.
    var chip = data.canChangeImage
      ? '<button type="button" class="cs-port-chip" data-cs-change-image><i class="fa-solid fa-camera"></i> Change</button>'
      : '';

    var slots = ORIGIN_SLOTS.map(function (s) {
      var v = f(data, s.key, '');
      var text = v ? esc(v) : '<span class="cs-id-unset">Not set</span>';
      var inner = canPick
        ? '<button type="button" class="cs-id-pick" data-cs-pick="' + s.key + '" data-cs-label="' + s.label + '" aria-expanded="false">' +
            '<span data-cs-val>' + text + '</span><span class="cs-id-chev" aria-hidden="true"></span></button>'
        : '<span class="cs-id-val" data-cs-val>' + text + '</span>';
      return '<div class="cs-id-slot"><span class="cs-id-k">' + s.label + '</span>' + inner + '</div>';
    }).join('');

    var className = f(data, 'class', '');
    var subclass = f(data, 'subclass', '');
    var faction = f(data, 'faction', '');
    var fixed =
      '<div class="cs-id-fixed">' +
        '<span class="cs-id-ro"><span class="cs-id-k">Class</span><span class="cs-id-val">' + (className ? esc(className) : '&ndash;') + '</span></span>' +
        '<span class="cs-id-ro"><span class="cs-id-k">Subclass</span><span class="cs-id-val">' + (subclass ? esc(subclass) : '&ndash;') + '</span></span>' +
        '<span class="cs-id-ro"><span class="cs-id-k">Level</span><span class="cs-id-val">' + level + '</span></span>' +
        (faction ? '<span class="cs-id-ro"><span class="cs-id-k">Faction</span><span class="cs-id-val">' + esc(faction) + '</span></span>' : '') +
        '<span class="cs-id-hint"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> set in Foundry</span>' +
      '</div>';

    return '<div class="cs-id">' +
      '<div class="cs-port">' + portraitHtml + chip + '</div>' +
      '<div class="cs-id-main"><div class="cs-id-orig">' + slots + '</div>' + fixed + '</div>' +
    '</div>' +
    '<div class="cs-id-fold" data-cs-pick-fold tabindex="-1"></div>';
  }

  // renderPips draws filled/empty glyphs for a small pool (recoveries, heroic
  // resource) capped so a large pool doesn't blow out the row, with a trailing
  // count. Returns a muted dash when there's nothing to show.
  function renderPips(cur, max, fullCh, emptyCh, cls) {
    var n = max || cur;
    if (!n) return '<span class="cs-pips-empty">–</span>';
    if (n > 12) n = 12;
    var out = '';
    for (var i = 0; i < n; i++) out += (i < cur) ? fullCh : emptyCh;
    return '<span class="' + cls + '">' + out + '</span>' +
      '<span class="cs-pips-count">' + cur + (max ? '/' + max : '') + '</span>';
  }

  // rVitals is the full-width vitals strip: stamina bar, recoveries, heroic
  // resource and surges. Characteristics are their own box below it.
  function rVitals(def, data) {
    var current = num(data, 'stamina_current', 0);
    var max = num(data, 'stamina_max', 0);
    var winded = num(data, 'winded', max ? Math.floor(max / 2) : 0);
    var recoveries = num(data, 'recoveries', 0);
    var recoveriesMax = num(data, 'recoveries_max', 0);

    var pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    var windedPct = max > 0 ? (winded / max) * 100 : 0;
    var dangerClass = (current <= winded) ? ' cs-bar-danger' : '';

    var hrName = f(data, 'heroic_resource_name', '') || 'Heroic Resource';
    var hrCur = num(data, 'heroic_resource_current', 0);

    var stamina =
      '<div class="cs-bar-wrap">' +
        '<div class="cs-bar-label">Stamina <span class="cs-bar-value">' + current + ' / ' + max + '</span></div>' +
        '<div class="cs-bar"><div class="cs-bar-fill' + dangerClass + '" style="width:' + pct + '%"></div>' +
          (winded > 0 ? '<div class="cs-bar-threshold" style="left:' + windedPct + '%" title="Winded"></div>' : '') +
        '</div>' +
        (winded > 0 ? '<div class="cs-bar-sub">Winded at ' + winded + '</div>' : '') +
      '</div>';
    var rec =
      '<span class="cs-statline-label">Recoveries</span>' +
      '<span class="cs-vit-v">' + recoveries + (recoveriesMax ? '<small>/ ' + recoveriesMax + '</small>' : '') + '</span>' +
      (recoveriesMax ? renderPips(recoveries, recoveriesMax, '●', '○', 'cs-dots').replace(/<span class="cs-pips-count">.*?<\/span>/, '') : '');
    // Heroic resources have no fixed max (you accumulate them), so a bare
    // count with a single accent pip rather than a pool that implies a cap.
    var hr =
      '<span class="cs-statline-label">' + esc(hrName) + '</span>' +
      '<span class="cs-vit-v"><span class="cs-hr-pips">&#9670;</span> ' + hrCur + '</span>' +
      '<span class="cs-bar-sub">Heroic resource</span>';
    var surges = isNum(data, 'surges')
      ? '<div class="cs-vit"><span class="cs-statline-label">Surges</span><span class="cs-vit-v">' + num(data, 'surges', 0) + '</span></div>'
      : '';

    return '<div class="cs-vitals">' +
      '<div class="cs-vit">' + stamina + '</div>' +
      '<div class="cs-vit">' + rec + '</div>' +
      '<div class="cs-vit">' + hr + '</div>' + surges +
    '</div>';
  }

  function rCharacteristics(def, data) {
    var stats = ['might', 'agility', 'reason', 'intuition', 'presence'];
    var labels = { might: 'Might', agility: 'Agility', reason: 'Reason', intuition: 'Intuition', presence: 'Presence' };
    var cells = stats.map(function (s) {
      var v = num(data, s, 0);
      var sign = v > 0 ? '+' : '';
      var tone = v > 0 ? ' cs-stat-positive' : (v < 0 ? ' cs-stat-negative' : ' cs-stat-zero');
      return '<div class="cs-stat' + tone + '">' +
        '<div class="cs-stat-label">' + labels[s] + '</div>' +
        '<div class="cs-stat-value">' + sign + v + '</div>' +
      '</div>';
    }).join('');
    return '<div class="cs-stat-row">' + cells + '</div>';
  }

  // rCombat is the COMBAT panel: the static combat-reference scalars (Speed /
  // Stability / Disengage / Size), the potency thresholds, and current
  // conditions. Live combat STATE (initiative / in-combat / round) is NOT shown
  // here — Draw Steel uses alternating activation (no initiative), and turn order
  // lives on the Character viewer page, not the reference sheet.
  function rCombat(def, data) {
    var chip = function (label, key) {
      var v = f(data, key, null);
      var val = (v == null || v === '') ? '–' : esc(String(scalar(v)));
      return '<div class="cs-chip"><span class="cs-chip-label">' + esc(label) + '</span>' +
        '<span class="cs-chip-value">' + val + '</span></div>';
    };
    // chips: static combat-relevant scalars. Disengage/Size/Save render only when synced.
    var chipList = chip('Speed', 'speed') + chip('Stability', 'stability');
    if (isNum(data, 'disengage') || f(data, 'disengage', '') !== '') chipList += chip('Disengage', 'disengage');
    if (f(data, 'size', '') !== '') chipList += chip('Size', 'size');
    // Save (roll ≥ threshold to end an effect) — how sticky conditions are on this hero.
    if (isNum(data, 'save_threshold')) {
      var sb = f(data, 'save_bonus', '');
      var sbTxt = (sb != null && String(sb).trim() !== '' && String(sb) !== '0')
        ? ' ' + (String(sb).charAt(0) === '-' ? '' : '+') + esc(String(sb)) : '';
      chipList += '<div class="cs-chip"><span class="cs-chip-label">Save</span>' +
        '<span class="cs-chip-value">' + num(data, 'save_threshold', 6) + '+' + sbTxt + '</span></div>';
    }
    var chips = '<div class="cs-chip-row">' + chipList + '</div>';

    // Movement modes (fly / climb / swim / burrow / teleport / hover) — dictates
    // terrain & line-of-effect design. Plain "walk" is the default, omitted here.
    var modes = parseStrList(f(data, 'movement_types', '')).map(function (m) { return String(m).toLowerCase(); });
    var special = modes.filter(function (m) { return m && m !== 'walk'; });
    var moveHtml = '';
    if (special.length || num(data, 'movement_hover', 0)) {
      var badges = special.map(function (m) { return '<span class="cs-move-mode">' + esc(humanizeId(m)) + '</span>'; });
      if (num(data, 'movement_hover', 0)) badges.push('<span class="cs-move-mode">Hover</span>');
      moveHtml = '<div class="cs-move-modes"><span class="cs-statline-label">Movement</span>' + badges.join('') + '</div>';
    }

    // Potency strip (weak / average / strong) — the derived thresholds an
    // ability's potency checks compare against. Compact, only when present.
    var potency = '';
    if (isNum(data, 'potency_weak') || isNum(data, 'potency_average') || isNum(data, 'potency_strong')) {
      var pot = function (lbl, key) {
        return '<span class="cs-pot"><span class="cs-pot__k">' + lbl + '</span>' +
          '<span class="cs-pot__v">' + (isNum(data, key) ? num(data, key, 0) : '–') + '</span></span>';
      };
      potency = '<div class="cs-pot-strip"><span class="cs-pot-strip__label">Potency</span>' +
        pot('Weak', 'potency_weak') + pot('Avg', 'potency_average') + pot('Strong', 'potency_strong') + '</div>';
    }

    // conditions: status ids from actor.statuses (or {name,severity} objects).
    var conds = parseJson(f(data, 'conditions_json', ''), []);
    var pills;
    if (Array.isArray(conds) && conds.length) {
      pills = '<div class="cs-cond-row">' + conds.map(function (c) {
        var raw = (c && (c.name || c)) || '';
        var sev = (c && c.severity) || '';
        var cls = 'cs-cond';
        if (/bleed|burn|dam|poison/i.test(raw + ' ' + sev)) cls += ' cs-cond--danger';
        else if (/slow|weak|daz|frighten|restrain|prone|grab|taunt/i.test(raw + ' ' + sev)) cls += ' cs-cond--warn';
        return '<span class="' + cls + '">' + esc(humanizeId(raw)) + '</span>';
      }).join('') + '</div>';
    } else {
      pills = ph('No conditions.');
    }
    return chips + moveHtml + potency + pills;
  }
  // toDamageEntries tolerates every shape immunities/weaknesses can sync as: an
  // array, a JSON string, a CSV/plain string, a bare number (a blanket "all"),
  // or a per-type object { fire: 5, all: 0, … } → [{type,value}] (drops zeros).
  function toDamageEntries(v) {
    if (v == null || v === '' || v === 0) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'number') return [{ type: 'All', value: v }];
    if (typeof v === 'object') {
      var out = [];
      Object.keys(v).forEach(function (k) {
        var val = v[k];
        if (val != null && val !== 0 && val !== '') out.push({ type: humanizeId(k), value: val });
      });
      return out;
    }
    var s = String(v).trim();
    if (!s) return [];
    if (s.charAt(0) === '[' || s.charAt(0) === '{') { var p = parseJson(s, null); if (p) return toDamageEntries(p); }
    return s.split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function rDamage(def, data) {
    var imm = toDamageEntries(f(data, 'immunities', ''));
    var weak = toDamageEntries(f(data, 'weaknesses', ''));

    var rowFor = function (entry) {
      if (entry == null) return '';
      if (typeof entry === 'string') return esc(entry);
      var type = entry.type ? esc(String(entry.type)) : '';
      var value = (entry.value != null && entry.value !== '') ? ' ' + esc(String(entry.value)) : '';
      return (type + value).trim();
    };

    var immHtml = (imm && imm.length)
      ? '<div class="cs-damage-row"><div class="cs-damage-label">Immunities</div><div class="cs-damage-list">' +
          imm.map(function (e) { return '<span class="cs-chip cs-chip-pill">' + rowFor(e) + '</span>'; }).join('') +
        '</div></div>'
      : '';
    var weakHtml = (weak && weak.length)
      ? '<div class="cs-damage-row"><div class="cs-damage-label">Weaknesses</div><div class="cs-damage-list">' +
          weak.map(function (e) { return '<span class="cs-chip cs-chip-pill cs-chip-warn">' + rowFor(e) + '</span>'; }).join('') +
        '</div></div>'
      : '';

    // Condition immunities — which statuses are wasted on this hero (a DM
    // building a control-focused monster wants to know in advance).
    var statusImm = parseStrList(f(data, 'status_immunities', ''));
    var statusHtml = statusImm.length
      ? '<div class="cs-damage-row"><div class="cs-damage-label">Cond. Immunities</div><div class="cs-damage-list">' +
          statusImm.map(function (s) { return '<span class="cs-chip cs-chip-pill">' + esc(humanizeId(s)) + '</span>'; }).join('') +
        '</div></div>'
      : '';

    return (immHtml + weakHtml + statusHtml) || ph('No immunities or weaknesses.');
  }

  // humanizeId turns a Foundry id ("handleAnimals", "criminalUnderworld",
  // "pickLock") into a display label ("Handle Animals", …): split camelCase,
  // then Title-case each word. Used for skills, conditions, and damage types.
  function humanizeId(id) {
    var s = String(id == null ? '' : id).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return s.replace(/\b\w/g, function (m) { return m.toUpperCase(); }).trim();
  }

  // ── Skills (grouped by the five Draw Steel skill groups, like the sheet) ──
  var SKILL_GROUPS = [
    { key: 'crafting', label: 'Crafting', ids: ['alchemy', 'architecture', 'blacksmithing', 'carpentry', 'cooking', 'fletching', 'forgery', 'jewelry', 'mechanics', 'tailoring'] },
    { key: 'exploration', label: 'Exploration', ids: ['climb', 'drive', 'endurance', 'gymnastics', 'heal', 'jump', 'lift', 'navigate', 'ride', 'swim'] },
    { key: 'interpersonal', label: 'Interpersonal', ids: ['brag', 'empathize', 'flirt', 'gamble', 'handleAnimals', 'interrogate', 'intimidate', 'lead', 'lie', 'music', 'perform', 'persuade', 'readPerson'] },
    { key: 'intrigue', label: 'Intrigue', ids: ['alertness', 'concealObject', 'disguise', 'eavesdrop', 'escapeArtist', 'hide', 'pickLock', 'pickPocket', 'sabotage', 'search', 'sneak', 'track'] },
    { key: 'lore', label: 'Lore', ids: ['culture', 'criminalUnderworld', 'history', 'magic', 'monsters', 'nature', 'psionics', 'religion', 'rumors', 'society', 'strategy', 'timescape'] }
  ];
  // group lookup: skill id → group key (so a skill the catalog doesn't know still
  // lands in an "Other" bucket rather than vanishing).
  var SKILL_TO_GROUP = (function () {
    var m = {};
    SKILL_GROUPS.forEach(function (g) { g.ids.forEach(function (id) { m[id.toLowerCase()] = g.key; }); });
    return m;
  })();

  // rSkills renders the hero's trained skills as compact chips grouped by the
  // five DS skill groups — the official sheet's organization, not a flat dump.
  // A skill is a plain id string in skills_json (a Foundry Set → array).
  function rSkills(def, data) {
    var skills = parseJson(f(data, 'skills_json', ''), []);
    var langs = parseStrList(f(data, 'languages_json', ''));
    var html = '';

    if (Array.isArray(skills) && skills.length) {
      var buckets = {};
      skills.forEach(function (s) {
        var id = String(s == null ? '' : s);
        var gk = SKILL_TO_GROUP[id.toLowerCase()] || 'other';
        (buckets[gk] = buckets[gk] || []).push(id);
      });
      var skillTip = function (id) {
        var d = skillDefs && skillDefs[String(id).toLowerCase()];
        return (d && d.description) ? ' data-tip="' + escAttr(d.description) + '" tabindex="0"' : '';   // M-4
      };
      var groupOut = function (key, label, cls) {
        var list = buckets[key];
        if (!list || !list.length) return '';
        var chips = list.map(function (id) {
          return '<span class="cs-skill' + (cls || '') + '"' + skillTip(id) + '>' + esc(humanizeId(id)) + '</span>';
        }).join('');
        return '<div class="cs-skill-grp"><div class="cs-skill-grp__label">' + esc(label) + '</div>' +
          '<div class="cs-skill-list">' + chips + '</div></div>';
      };
      html += SKILL_GROUPS.map(function (g) { return groupOut(g.key, g.label); }).join('');
      if (buckets.other) html += groupOut('other', 'Other');
    }

    if (langs.length) {
      html += '<div class="cs-skill-grp"><div class="cs-skill-grp__label">Languages</div>' +
        '<div class="cs-skill-list">' + langs.map(function (l) {
          return '<span class="cs-skill cs-skill--lang">' + esc(humanizeId(l)) + '</span>';
        }).join('') + '</div></div>';
    }

    return html || ph('No trained skills.');
  }

  // rKit renders the equipped kit's mechanical bonuses as a compact stat box:
  // the melee/ranged damage tier mini-ladder + the flat bonus chips. Reads the
  // single kit projection (kit_details_json → a one-element array). Distinct from
  // the ability cards — a kit is reference stats, not a clickable action.
  function rKit(def, data) {
    var arr = parseJson(f(data, 'kit_details_json', ''), []);
    var k = Array.isArray(arr) ? arr[0] : (arr && typeof arr === 'object' ? arr : null);
    if (!k) return ph('No kit equipped.');

    var has = function (v) { return v != null && v !== '' && v !== 0; };
    // H-2: escape the non-numeric branch — kit_details_json values are
    // user-authored and 'v > 0' is false for a string, so String(v) would
    // otherwise reach element content raw. (v > 0 implies a number, so '+' + v
    // is inherently safe.)
    var fmt = function (v) { return (v == null || v === '') ? '–' : (v > 0 ? '+' + v : esc(String(v))); };

    // damage tier mini-ladder (melee / ranged rows × T1/T2/T3) — only if any set.
    var dmgRows = '';
    [['Melee', 'melee'], ['Ranged', 'ranged']].forEach(function (pair) {
      var p = pair[1];
      var t1 = k[p + 'DamageT1'], t2 = k[p + 'DamageT2'], t3 = k[p + 'DamageT3'];
      var dist = k[p + 'Distance'];
      if (!(has(t1) || has(t2) || has(t3) || has(dist))) return;
      dmgRows += '<div class="cs-kit-row">' +
        '<span class="cs-kit-row__k">' + pair[0] + (has(dist) ? ' <span class="cs-kit-dist">' + esc(String(dist)) + '</span>' : '') + '</span>' +
        '<span class="cs-kit-tiers"><span>' + fmt(t1) + '</span><span>' + fmt(t2) + '</span><span>' + fmt(t3) + '</span></span>' +
      '</div>';
    });
    var dmg = dmgRows
      ? '<div class="cs-kit-dmg"><div class="cs-kit-dmg__head"><span>Damage</span><span class="cs-kit-tierhead"><span>≤11</span><span>12–16</span><span>17+</span></span></div>' + dmgRows + '</div>'
      : '';

    // flat bonus chips (stability / speed / stamina / disengage).
    var bonuses = [['Stability', 'stability'], ['Speed', 'speed'], ['Stamina', 'stamina'], ['Disengage', 'disengage']]
      .filter(function (b) { return has(k[b[1]]); })
      .map(function (b) {
        return '<div class="cs-chip"><span class="cs-chip-label">' + b[0] + '</span>' +
          '<span class="cs-chip-value">' + fmt(k[b[1]]) + '</span></div>';
      }).join('');
    var bonusHtml = bonuses ? '<div class="cs-chip-row">' + bonuses + '</div>' : '';

    var name = k.name ? '<div class="cs-kit-name">' + esc(String(k.name)) + '</div>' : '';
    return name + dmg + bonusHtml || ph('No kit details.');
  }
  // ── Abilities: bare master–detail ─────────────────────────────────────────
  // A grouped list (master rail) + a detail pane. Clicking a row fills the pane
  // with an even-smaller BARE card; hovering the card lifts+glows; clicking it
  // grows the two-section big card (① rules ② "For <hero>" odds). Monochrome
  // with a single violet accent. Design contract: docs/CHARACTER-SHEET-DESIGN.md.
  //
  // rAbilities emits ONLY the static shell (rail rows + a resting pane). The
  // pane is populated imperatively by attachInteractions (which closes over the
  // ability array + entity data), so selection state lives in the DOM and the
  // box renderer stays a pure function of (def, data).

  var GROUP_ORDER = ['signature', 'heroic', 'maneuver'];
  var GROUP_LABELS = { signature: 'Signature', heroic: 'Heroic', maneuver: 'Maneuver' };
  var CHAR_LABELS = { might: 'Might', agility: 'Agility', reason: 'Reason', intuition: 'Intuition', presence: 'Presence' };

  // groupOf buckets a Draw Steel ability into the three list groups. Categories
  // (signature/heroic/freeStrike/villain) and a heroic-resource cost decide it;
  // everything else (maneuvers, free strikes, moves, utility actions) is the
  // dimmed "Maneuvers" bucket. Defensive for sparse pre-Phase-C data.
  function groupOf(a) {
    var c = String((a && a.category) || '').toLowerCase();
    if (c === 'signature') return 'signature';
    if (c === 'heroic') return 'heroic';
    if (Number(a && a.cost) > 0) return 'heroic';
    return 'maneuver';
  }

  function charLabel(k) {
    var key = String(k || '').toLowerCase();
    return CHAR_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
  }

  function firstName(name) {
    return String(name || '').split(/[\s,]+/)[0] || 'this hero';
  }

  function rAbilities(def, data) {
    var abilities = parseAbilities(data);
    if (!abilities.length) return ph('No abilities yet.');

    var groups = { signature: [], heroic: [], maneuver: [] };
    abilities.forEach(function (a, idx) { groups[groupOf(a)].push({ a: a, idx: idx }); });

    // Open on Signature, or the first group that has anything.
    var active = GROUP_ORDER.filter(function (g) { return groups[g].length; })[0] || 'signature';
    if (groups.signature.length) active = 'signature';

    var tabs = GROUP_ORDER.map(function (g) {
      var on = g === active;
      return '<button type="button" role="tab" class="ds-tab' + (on ? ' ds-tab--on' : '') + '" id="ds-tab-' + g + '"' +
        ' aria-selected="' + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '" data-ds-tab="' + g + '">' +
        esc(GROUP_LABELS[g]) + ' <em>' + groups[g].length + '</em></button>';
    }).join('');

    // A long list gets a filter; it narrows the open tab only.
    var many = abilities.length >= 10;

    var rail = GROUP_ORDER.map(function (g) {
      var list = groups[g];
      // within a group, order by heroic-resource cost ascending (the flat index
      // stays attached to each entry, so selection lookups are unaffected).
      list.sort(function (x, y) { return (Number(x.a.cost) || 0) - (Number(y.a.cost) || 0); });
      var rows = list.length
        ? list.map(function (it) { return railRow(it.a, it.idx, g); }).join('')
        : '<div class="ds-rail__empty">None yet.</div>';
      return '<div class="ds-ab-grp ds-ab-grp--' + g + (g === active ? '' : ' ds-ab-grp--off') + '" data-ds-grp="' + g + '">' +
        '<div class="ds-ab-grp__rows">' + rows + '</div>' +
      '</div>';
    }).join('');

    var tools = many
      ? '<div class="ds-rail__tools"><input type="text" class="ds-rail__filter" data-ds-filter' +
          ' placeholder="Filter abilities…" aria-label="Filter abilities" autocomplete="off"></div>'
      : '';

    return '<div class="ds-tabs" role="tablist" aria-label="Ability groups">' + tabs + '</div>' +
      '<div class="ds-md">' +
      '<div class="ds-rail" role="listbox" aria-label="Abilities">' +
        tools + rail +
        '<div class="ds-rail__empty" data-ds-no-match hidden>No matching abilities.</div>' +
      '</div>' +
      '<div class="ds-pane" data-ds-pane>' + paneEmptyHtml() + '</div>' +
    '</div>';
  }

  // railRow — one plain master-list entry: name + (heroic) cost number. A native
  // <button> so Enter/Space select it for free. Maneuvers are dimmed.
  function railRow(a, idx, g) {
    var costN = Number(a && a.cost);
    var cost = (g !== 'maneuver' && costN > 0)
      ? '<span class="ds-li__c">' + esc(String(costN)) + '</span>' : '';
    return '<button type="button" class="ds-li' + (g === 'maneuver' ? ' ds-li--dim' : '') + '"' +
        ' role="option" aria-selected="false" data-ds-ability="' + idx + '">' +
      '<span class="ds-li__nm">' + esc((a && a.name) || 'Untitled') + '</span>' + cost +
    '</button>';
  }

  function paneEmptyHtml() {
    return '<div class="ds-pane__empty">' +
      '<div class="ds-pane__empty-t">Select an ability</div>' +
      '<div class="ds-pane__empty-d">Pick one on the left to see its card and tiers.</div>' +
    '</div>';
  }
  // slugify normalizes a name to a comparable slug ("Sword and Board" →
  // "sword-and-board") for matching a feature against its origin.
  function slugify(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // FEATURES FRAMEWORK
  // ------------------
  // Draw Steel stores class/ancestry/kit/culture/career features all as generic
  // `feature` items, and a feature does NOT record which item granted it
  // (system.source is the publication book, not the origin). So we can't trust a
  // single field. Instead we classify defensively: match each feature's rules-id
  // (_dsid) / name against the hero's KNOWN origin names (class/ancestry/kit/…,
  // which we already sync) and bucket it there; anything we can't place lands in
  // a generic group. If nothing classifies, we render ONE flat "Features" list
  // rather than fake groups. When live data shows which signal actually carries
  // the origin, the classifier tightens — but it already works, ungrouped at worst.
  var FEATURE_ORIGINS = [
    { key: 'class', label: 'Class', field: 'class' },
    { key: 'subclass', label: 'Subclass', field: 'subclass' },
    { key: 'ancestry', label: 'Ancestry', field: 'ancestry' },
    { key: 'culture', label: 'Culture', field: 'culture' },
    { key: 'career', label: 'Career', field: 'career' },
    { key: 'kit', label: 'Kit', field: 'kit' }
  ];
  var FEATURE_GROUP_ORDER = ['class', 'subclass', 'ancestry', 'culture', 'career', 'kit', 'other'];
  var FEATURE_GROUP_LABELS = { class: 'Class', subclass: 'Subclass', ancestry: 'Ancestry', culture: 'Culture', career: 'Career', kit: 'Kit', other: 'Features' };

  // classifyFeature picks an origin key by looking for an origin's slug or name
  // inside the feature's _dsid + name. Specific origins are tried first.
  function classifyFeature(ft, origins) {
    var hay = (String((ft && ft.dsid) || '') + ' ' + String((ft && ft.name) || '')).toLowerCase();
    for (var i = 0; i < origins.length; i++) {
      var o = origins[i];
      if ((o.slug && hay.indexOf(o.slug) !== -1) || (o.lname && hay.indexOf(o.lname) !== -1)) return o.key;
    }
    return 'other';
  }

  // renderFeature — a native <details> accordion (name + level → description on
  // expand) so a long feature list collapses with zero JS. Flat row when there's
  // no description to reveal.
  function renderFeature(ft) {
    var name = esc((ft && ft.name) || 'Feature');
    var lvl = (ft && ft.level) ? '<span class="cs-tag cs-tag-level">L' + esc(String(ft.level)) + '</span>' : '';
    var descTxt = cleanFoundryText(ft && ft.description);
    if (descTxt) {
      return '<details class="cs-feature"><summary class="cs-feature__sum">' +
        '<span class="cs-feature-name">' + name + '</span>' + lvl +
        '<span class="cs-feature__caret" aria-hidden="true">&#9662;</span>' +
      '</summary><div class="cs-feature-desc">' + refSynced(descTxt) + '</div></details>';
    }
    return '<div class="cs-feature cs-feature--flat"><span class="cs-feature-name">' + name + '</span>' + lvl + '</div>';
  }

  function featureGroupHtml(label, list) {
    if (!list || !list.length) return '';
    return '<div class="cs-feature-group">' +
      '<h4 class="cs-feature-group-title">' + esc(label) + '</h4>' +
      '<div class="cs-feature-list">' + list.map(renderFeature).join('') + '</div>' +
    '</div>';
  }

  function rFeatures(def, data) {
    var feats = parseJson(f(data, 'features_json', ''), []);
    // Perks (build choices) + Titles (aspirational progression) are their own
    // Foundry item types, rendered as extra groups after the origin features.
    var extra = featureGroupHtml('Perks', parseJson(f(data, 'perks_json', ''), [])) +
      featureGroupHtml('Titles', parseJson(f(data, 'titles_json', ''), []));

    if (Array.isArray(feats) && feats.length) {
      // build the origin matchers from the hero's known identity.
      var origins = FEATURE_ORIGINS.map(function (o) {
        var nm = f(data, o.field, '');
        return { key: o.key, lname: String(nm).toLowerCase(), slug: slugify(nm) };
      }).filter(function (o) { return o.lname; });

      var buckets = {};
      feats.forEach(function (ft) {
        var g = classifyFeature(ft, origins);
        (buckets[g] = buckets[g] || []).push(ft);
      });

      // If we couldn't confidently place ANY feature, show one flat list instead
      // of a misleading lone "Features" group header.
      var placed = FEATURE_GROUP_ORDER.filter(function (k) { return k !== 'other' && buckets[k]; });
      if (!placed.length) {
        return '<div class="cs-feature-list">' + feats.map(renderFeature).join('') + '</div>' + extra;
      }
      return FEATURE_GROUP_ORDER.map(function (k) {
        return featureGroupHtml(FEATURE_GROUP_LABELS[k], buckets[k]);
      }).join('') + extra;
    }

    // No origin/class features synced yet — still show Perks/Titles if present,
    // otherwise a placeholder.
    return extra || ph('No features yet.');
  }

  function rProgression(def, data) {
    var entries = [
      { label: 'XP', key: 'xp' },
      { label: 'Victories', key: 'victories' },
      { label: 'Renown', key: 'renown' },
      { label: 'Wealth', key: 'wealth' }
    ];
    // always render the chips; unset values show "–" so the section's structure
    // is visible even on a fresh hero. (Project Points → the Projects item type,
    // handled separately — not a hero scalar.)
    var chips = entries.map(function (e) {
      var v = f(data, e.key, null);
      var val = (v == null || v === '') ? '–' : esc(String(v));
      return '<div class="cs-chip"><span class="cs-chip-label">' + esc(e.label) + '</span>' +
        '<span class="cs-chip-value">' + val + '</span></div>';
    }).join('');
    return '<div class="cs-chip-row">' + chips + '</div>';
  }

  // Treasures = Draw Steel's magic-item system (consumable / trinket / leveled /
  // artifact). They change what a hero can DO in a fight, so they belong on a
  // DM-reference sheet. Grouped by category; each a <details> accordion.
  var TREASURE_CATS = [
    { key: 'leveled', label: 'Leveled Treasures' },
    { key: 'trinket', label: 'Trinkets' },
    { key: 'consumable', label: 'Consumables' },
    { key: 'artifact', label: 'Artifacts' }
  ];
  function renderTreasure(t) {
    var name = esc((t && t.name) || 'Treasure');
    var ech = (t && t.echelon) ? '<span class="cs-tag cs-tag-level">E' + esc(String(t.echelon)) + '</span>' : '';
    var qN = Number(t && t.quantity);
    var qty = (qN > 1) ? '<span class="cs-treasure__qty">&times;' + qN + '</span>' : '';
    var kws = (Array.isArray(t && t.keywords) && t.keywords.length)
      ? '<div class="cs-treasure__kws">' + t.keywords.map(function (k) { return esc(String(k)); }).join(' &middot; ') + '</div>' : '';
    var desc = cleanFoundryText(t && t.description);
    if (desc) {
      return '<details class="cs-feature"><summary class="cs-feature__sum">' +
        '<span class="cs-feature-name">' + name + '</span>' + ech + qty +
        '<span class="cs-feature__caret" aria-hidden="true">&#9662;</span></summary>' +
        kws + '<div class="cs-feature-desc">' + refSynced(desc) + '</div></details>';
    }
    return '<div class="cs-feature cs-feature--flat"><span class="cs-feature-name">' + name + '</span>' + ech + qty + '</div>';
  }
  function renderTreasures(list) {
    var buckets = {};
    list.forEach(function (t) { var c = String((t && t.category) || 'other').toLowerCase(); (buckets[c] = buckets[c] || []).push(t); });
    var grp = function (label, b) {
      return '<div class="cs-feature-group"><h4 class="cs-feature-group-title">' + esc(label) +
        '</h4><div class="cs-feature-list">' + b.map(renderTreasure).join('') + '</div></div>';
    };
    var html = TREASURE_CATS.map(function (c) { return buckets[c.key] && buckets[c.key].length ? grp(c.label, buckets[c.key]) : ''; }).join('');
    Object.keys(buckets).forEach(function (k) {
      if (!TREASURE_CATS.some(function (c) { return c.key === k; })) html += grp(humanizeId(k), buckets[k]);
    });
    return html;
  }

  function rInventory(def, data) {
    var out = '';
    var treasures = parseJson(f(data, 'treasures_json', ''), []);
    if (Array.isArray(treasures) && treasures.length) out += renderTreasures(treasures);

    var items = invItems(data);
    if (items.length) {
      var cid = data.campaignId;
      var rows = items.map(function (it) {
        var entity = it.entity || it;
        var name = esc(entity.name || 'Item');
        var qty = (it.metadata && it.metadata.quantity) ? ' &times; ' + esc(String(it.metadata.quantity)) : '';
        var equipped = (it.metadata && it.metadata.equipped) ? ' <span class="cs-tag">equipped</span>' : '';
        var href = (entity.id && cid) ? '/campaigns/' + cid + '/entities/' + entity.id : '';
        var label = href ? '<a class="cs-inventory-link" href="' + escAttr(href) + '">' + name + '</a>' : name;   // L-2
        return '<li class="cs-inventory-item">' + label + qty + equipped + '</li>';
      }).join('');
      out += '<ul class="cs-inventory-list">' + rows + '</ul>';
    }
    return out || ph('Empty.');
  }

  // rNotes renders the Background section as a TEASER + "Read full story" — the
  // full prose opens in the reading-view overlay (openReadingView). Large lore
  // shouldn't accordion-shove the sheet; it gets its own typeset page instead.
  function rNotes(def, data) {
    // Backstory is stored under `backstory` (the manifest field synced from Foundry
    // system.biography.value); older payloads used `notes`, so fall back to it.
    var notes = f(data, 'backstory', '') || f(data, 'notes', '');
    if (!notes) return ph('No backstory yet.');
    return '<div class="cs-bg">' +
      '<p class="cs-bg__teaser">' + esc(teaser(cleanFoundryText(notes), 180)) + '</p>' +
      '<button type="button" class="cs-bg__read" data-cs-read-story>Read full story &rsaquo;</button>' +
    '</div>';
  }

  // rGmLore renders GM-only notes. Scheduled ONLY when data.isGm (the buildSchema
  // gate), so it never reaches a player; rendered inline (not the reading overlay).
  function rGmLore(def, data) {
    var notes = f(data, 'gm_notes', '');
    if (!notes) return ph('No GM notes.');
    return '<div class="cs-gmlore">' + refText(notes) + '</div>';
  }

  // teaser flattens {@cat term|disp} tokens to plain words, collapses whitespace,
  // and trims to ~n chars on a word boundary for the Background preview line.
  function teaser(s, n) {
    s = String(s).replace(/\{@\w+\s+([^|}]+)(?:\|([^}]+))?\}/g, function (_m, term, disp) { return (disp || term).trim(); });
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    var cut = s.slice(0, n), sp = cut.lastIndexOf(' ');
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut + '…';
  }

  // readingIsDark picks the reading-view palette (parchment vs ink-blue) by the
  // page background's luminance, so the lore page tracks Chronicle's light/dark
  // theme without needing to know the theme toggle's mechanism.
  function readingIsDark() {
    var c = (Chronicle.surface && Chronicle.surface.cssVar) ? Chronicle.surface.cssVar('--color-bg-primary', '') : '';
    if (!c) { try { c = getComputedStyle(document.body).backgroundColor; } catch (e) { c = ''; } }
    c = String(c).trim();
    var r, g, b, m;
    if (c.charAt(0) === '#') {
      if (c.length === 4) { r = parseInt(c.charAt(1) + c.charAt(1), 16); g = parseInt(c.charAt(2) + c.charAt(2), 16); b = parseInt(c.charAt(3) + c.charAt(3), 16); }
      else { r = parseInt(c.substr(1, 2), 16); g = parseInt(c.substr(3, 2), 16); b = parseInt(c.substr(5, 2), 16); }
    } else if ((m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/))) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else { return false; }
    if (isNaN(r) || isNaN(g) || isNaN(b)) return false;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
  }

  // renderReadingView builds the lore page node (eyebrow + serif title + drop-cap
  // body) with its Back control wired to pop the overlay.
  function renderReadingView(title, prose) {
    var node = document.createElement('div');
    node.className = 'cs-reading';
    node.innerHTML =
      '<button type="button" class="cs-reading__back" data-cs-reading-back>&lsaquo; Back to sheet</button>' +
      '<div class="cs-reading__eyebrow">Background</div>' +
      '<h1 class="cs-reading__title">' + esc(title || 'Background') + '</h1>' +
      '<div class="cs-reading__body">' + refSynced(cleanFoundryProse(prose)) + '</div>';
    var back = node.querySelector('[data-cs-reading-back]');
    if (back) back.addEventListener('click', function () { Chronicle.surface.overlay.pop(); });
    return node;
  }

  // openReadingView pushes the lore page as a full overlay, themed light/dark.
  // The page dims behind it; Escape / backdrop / Back all return to the sheet.
  function openReadingView(title, prose) {
    if (!prose || !Chronicle.surface || !Chronicle.surface.overlay) return;
    Chronicle.surface.overlay.push(renderReadingView(title, prose), {
      transition: 'scale-fade',
      label: title || 'Background',
      panelClass: 'cs-overlay__panel--reading' + (readingIsDark() ? ' cs-reading-dark' : '')
    });
  }

  // ── ability text/label helpers ────────────────────────────────────────────

  // htmlToText flattens Foundry HTML fields (effect.before/after) to plain text:
  // strips tags, decodes the common entities, collapses whitespace. The result
  // is then re-escaped + {@…}-resolved by refText, so it's render-safe.
  function htmlToText(h) {
    if (!h) return '';
    return String(h)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }

  // stripEnrichers removes Foundry rich-text enrichers that arrive raw in synced
  // ability/feature/biography text and would otherwise show as literal junk:
  //   [[/surge 1]]                       → "surge 1"   (bare command)
  //   [[lookup @hero.victories]]{your …} → "your …"    (labeled)
  //   @UUID[Item.x]{Falchion}            → "Falchion"  (document link)
  // Labeled forms keep the display label; bare forms keep the cleaned command
  // (drop a leading "/", the "lookup" keyword, and @path tokens).
  function stripEnrichers(s) {
    return String(s == null ? '' : s)
      .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1')
      .replace(/\[\[([^\]]*)\]\]/g, function (_m, inner) {
        return String(inner).replace(/^\s*\//, '').replace(/\blookup\b/g, '')
          .replace(/@[\w.]+/g, '').replace(/\s+/g, ' ').trim();
      })
      .replace(/@UUID\[[^\]]*\]/g, '');
  }

  // cleanFoundryText — inline-safe plain text from a synced rich field: strip
  // tags + decode entities (htmlToText) THEN strip enrichers. Use for chips,
  // cards, and teasers.
  function cleanFoundryText(h) {
    return stripEnrichers(htmlToText(h)).replace(/\s+/g, ' ').trim();
  }

  // cleanFoundryProse — like cleanFoundryText but PRESERVES paragraph breaks
  // (block close-tags / <br> → newlines) for the reading-view lore page, which
  // renders white-space:pre-wrap. Use for full backstory / long descriptions.
  function cleanFoundryProse(h) {
    if (!h) return '';
    var s = String(h)
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
    return stripEnrichers(s).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  function powerRollChars(a) {
    var cs = a && a.powerRollChars;
    return Array.isArray(cs) ? cs.filter(Boolean) : [];
  }
  function powerRollLabel(a) {
    var cs = powerRollChars(a).map(charLabel).filter(Boolean);
    return cs.length ? cs.join(' or ') : '';
  }

  // distanceLabel / targetLabel humanize the Foundry distance/target shapes into
  // a short phrase (e.g. "Ranged 10", "1 creature"). Best-effort + defensive.
  function distanceLabel(a) {
    if (!a) return '';
    var t = String(a.distanceType || '').toLowerCase();
    var d = (a.distance != null && a.distance !== '') ? a.distance : '';
    if (!t && d === '') return '';
    if (t === 'self') return 'Self';
    var label = t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    if (d !== '') label += (label ? ' ' : '') + d;
    if (a.distanceSecondary) label += ' × ' + a.distanceSecondary;
    return label.trim();
  }
  function targetLabel(a) {
    if (!a) return '';
    if (a.targetCustom) return String(a.targetCustom);
    var t = String(a.targetType || '');
    var v = (a.target != null && a.target !== '') ? a.target : '';
    if (!t && v === '') return '';
    var human = t.replace(/([A-Z])/g, ' $1').replace(/^./, function (m) { return m.toUpperCase(); }).trim();
    return (v !== '') ? (v + ' ' + human).trim() : human;
  }

  function costLabel(a, data) {
    var c = Number(a && a.cost);
    if (!(c > 0)) return '';
    var hr = f(data, 'heroic_resource_name', '');
    return hr ? c + ' ' + hr : c + '';
  }

  // ── power-roll math (the "For <hero>" section) ─────────────────────────────

  // safeEvalArith evaluates a pure-arithmetic string ("2 + 3") after @chr was
  // substituted. The input is regex-restricted to digits/space/+-*/() and then
  // parsed by a tiny hand-written recursive-descent evaluator — NO Function /
  // eval, ever. Grammar: decimal numbers, binary + - * /, unary + -,
  // parentheses. Returns a finite number, or null on empty / gate-fail /
  // parse-error / non-finite result (e.g. division by zero). Never throws:
  // pathological input (deep paren/unary-sign nesting) that would otherwise
  // overflow the call stack is also folded into the "returns null" contract
  // via a try/catch around the parse.
  function safeEvalArith(s) {
    s = String(s == null ? '' : s).trim();
    // Belt-and-suspenders: keep the original character gate.
    if (s === '' || !/^[0-9+\-*/(). ]+$/.test(s)) return null;

    var pos = 0;
    function peek() { return s.charAt(pos); }
    function skipSpace() { while (peek() === ' ') pos++; }

    // number — a maximal digits-and-single-dot run. A leading-zero integer
    // ("08") is rejected to match the old strict-mode octal SyntaxError.
    function parseNumber() {
      skipSpace();
      var start = pos, seenDot = false, c;
      while (pos < s.length) {
        c = s.charAt(pos);
        if (c >= '0' && c <= '9') { pos++; }
        else if (c === '.' && !seenDot) { seenDot = true; pos++; }
        else break;
      }
      if (pos === start) return null;
      var tok = s.slice(start, pos);
      if (/^0[0-9]/.test(tok)) return null;
      var n = Number(tok);
      return isFinite(n) ? n : null;
    }

    // factor — unary +/-, a parenthesised expression, or a number.
    function parseFactor() {
      skipSpace();
      var c = peek();
      if (c === '+') { pos++; return parseFactor(); }
      if (c === '-') { pos++; var f = parseFactor(); return f === null ? null : -f; }
      if (c === '(') {
        pos++;
        var e = parseExpr();
        if (e === null) return null;
        skipSpace();
        if (peek() !== ')') return null;
        pos++;
        return e;
      }
      return parseNumber();
    }

    // term — factor (('*' | '/') factor)*
    function parseTerm() {
      var v = parseFactor();
      if (v === null) return null;
      for (;;) {
        skipSpace();
        var c = peek();
        if (c === '*' || c === '/') {
          pos++;
          var r = parseFactor();
          if (r === null) return null;
          v = (c === '*') ? v * r : v / r;
        } else break;
      }
      return v;
    }

    // expr — term (('+' | '-') term)*
    function parseExpr() {
      var v = parseTerm();
      if (v === null) return null;
      for (;;) {
        skipSpace();
        var c = peek();
        if (c === '+' || c === '-') {
          pos++;
          var r = parseTerm();
          if (r === null) return null;
          v = (c === '+') ? v + r : v - r;
        } else break;
      }
      return v;
    }

    var result;
    try {
      result = parseExpr();
    } catch (e) {
      // Pathological input (thousands of nested parens or unary signs) can
      // exceed the call stack — degrade to null like any other parse
      // failure instead of throwing an uncaught RangeError through
      // substituteFormula -> tierFragments -> the card render.
      return null;
    }
    skipSpace();
    if (result === null || pos !== s.length) return null; // parse error / trailing garbage
    return (typeof result === 'number' && isFinite(result)) ? result : null;
  }

  // substituteFormula resolves a tier damage formula. With subVal (a hero's
  // characteristic value) it substitutes @chr and evaluates to a number; without
  // it (the generic card) it shows @chr as the characteristic letter(s).
  function substituteFormula(formula, subVal, a) {
    var s = String(formula == null ? '' : formula);
    if (s === '') return '';
    if (subVal == null) {
      var cs = powerRollChars(a).map(function (k) { return charLabel(k).charAt(0); });
      var letter = cs.length ? cs.join('/') : 'M';
      return s.replace(/@chr/gi, letter);
    }
    var ev = safeEvalArith(s.replace(/@chr/gi, String(subVal)));
    return ev != null ? String(ev) : s.replace(/@chr/gi, String(subVal));
  }

  // tierFragments builds the outcome text for one tier (1..3) from the ability's
  // power-roll effects (system.power.effects, normalized to an array). Handles
  // the damage-effect shape well; degrades to '' for effect types we don't model
  // (the caller then falls back to the ability's effect text). subVal substitutes
  // the hero's characteristic into damage formulas (null = generic).
  function tierFragments(a, n, subVal) {
    var tiers = a && a.tiers;
    if (!Array.isArray(tiers) || !tiers.length) return '';
    var frags = [];
    tiers.forEach(function (eff) {
      if (!eff || typeof eff !== 'object') return;
      var key = 'tier' + n;
      // damage effect: { damage: { tier1: { value, types[] }, … } }
      if (eff.damage && eff.damage[key]) {
        var td = eff.damage[key];
        var val = substituteFormula(td.value, subVal, a);
        if (val === '' || val === '0') return;
        var types = Array.isArray(td.types) ? td.types.filter(Boolean) : [];
        frags.push(val + (types.length ? ' ' + types.join('/') : '') + ' damage');
        return;
      }
      // generic per-tier text shapes (applied/other effects): a display/text/value
      var tt = eff[key];
      if (tt && typeof tt === 'object') {
        var disp = tt.display || tt.text || tt.description;
        if (disp) frags.push(cleanFoundryText(disp));
      } else if (typeof tt === 'string' && tt) {
        frags.push(cleanFoundryText(tt));
      }
    });
    return frags.join('; ');
  }

  // tierOdds returns [T1%, T2%, T3%] for a 2d10 + mod power roll, folding in the
  // natural-19/20 → auto Tier 3 rule. Exact (enumerates all 100 outcomes).
  function tierOdds(mod) {
    var t = [0, 0, 0];
    for (var d1 = 1; d1 <= 10; d1++) {
      for (var d2 = 1; d2 <= 10; d2++) {
        var nat = d1 + d2, tier;
        if (nat >= 19) tier = 3; // natural 19-20 auto Tier 3
        else { var tot = nat + mod; tier = tot <= 11 ? 1 : (tot <= 16 ? 2 : 3); }
        t[tier - 1]++;
      }
    }
    return t; // counts out of 100 == percentages
  }

  // ── the cards ──────────────────────────────────────────────────────────────

  // tierLinesHtml — the three plain tier lines for the SMALL card (no tint, no
  // glyphs). Returns '' when no tier text is derivable (caller shows a fallback).
  function tierLinesHtml(a, subVal) {
    var bands = ['≤11', '12–16', '17+'];
    var any = false, rows = '';
    for (var n = 1; n <= 3; n++) {
      var txt = tierFragments(a, n, subVal);
      if (txt) any = true;
      rows += '<div class="ds-tr"><span class="ds-tr__b">' + bands[n - 1] + '</span>' +
        '<span class="ds-tr__t">' + (txt ? refSynced(txt) : '<span class="ds-muted">—</span>') + '</span></div>';
    }
    return any ? rows : '';
  }

  // fallbackBodyHtml — when an ability has no derivable tier ladder (a non-damage
  // effect, or pre-Phase-C data), show a power-roll line + a teaser of its effect.
  function fallbackBodyHtml(a) {
    var bits = '';
    var pr = powerRollLabel(a);
    if (pr) bits += '<div class="ds-card__line"><span class="ds-card__k">Power Roll</span><span>2d10 + ' + esc(pr) + '</span></div>';
    var eff = cleanFoundryText(a.effectAfter) || (a.story ? cleanFoundryText(a.story) : '') || cleanFoundryText(a.effectBefore);
    if (eff) bits += '<div class="ds-card__eff">' + refSynced(teaser(eff, 170)) + '</div>';
    if (!bits) bits = '<div class="ds-card__eff ds-muted">No detail synced yet.</div>';
    return bits;
  }

  // smallCardHtml — the EVEN-SMALLER bare card (the default detail). Header line
  // (name · Sig · cost) + three plain tier lines (or a fallback), glossary terms
  // in accent. The whole card is the click target; hover lifts+glows (CSS).
  function smallCardHtml(a, idx, data) {
    var sig = groupOf(a) === 'signature' ? '<span class="ds-card__sig">Sig</span>' : '';
    var cost = costLabel(a, data);
    var costHtml = cost ? '<span class="ds-card__cost">' + esc(cost) + '</span>' : '';
    var body = tierLinesHtml(a, null) || fallbackBodyHtml(a);
    return '<div class="ds-card" data-ds-expand="' + idx + '" role="button" tabindex="0"' +
        ' aria-label="' + escAttr((a && a.name) || 'Ability') + ' — click to expand">' +   // L-1
      '<div class="ds-card__h"><span class="ds-card__nm">' + esc((a && a.name) || 'Untitled') + '</span>' + sig + costHtml + '</div>' +
      body +
      '<div class="ds-card__hint" aria-hidden="true">↳ click to expand</div>' +
    '</div>';
  }

  // bigStatRow — distance / target / power-roll cells for the big card's rules.
  function bigStatRow(a) {
    var cells = [];
    function cell(k, v) { return '<div class="ds-big__stat"><span class="ds-big__sk">' + esc(k) + '</span><span class="ds-big__sv">' + esc(v) + '</span></div>'; }
    var d = distanceLabel(a); if (d) cells.push(cell('Distance', d));
    var t = targetLabel(a); if (t) cells.push(cell('Target', t));
    var pr = powerRollLabel(a); if (pr) cells.push(cell('Power Roll', pr));
    return cells.length ? '<div class="ds-big__stats">' + cells.join('') + '</div>' : '';
  }

  // bigLadderHtml — the tier ladder for the big card (subtle tier accent edge).
  function bigLadderHtml(a, subVal) {
    var bands = ['≤11', '12–16', '17+'];
    var any = false, rows = '';
    for (var n = 1; n <= 3; n++) {
      var txt = tierFragments(a, n, subVal);
      if (txt) any = true;
      rows += '<div class="ds-big__tier ds-big__tier--t' + n + '"><span class="ds-big__tb">' + bands[n - 1] + '</span>' +
        '<span class="ds-big__tt">' + (txt ? refSynced(txt) : '<span class="ds-muted">—</span>') + '</span></div>';
    }
    return any ? '<div class="ds-big__ladder">' + rows + '</div>' : '';
  }

  // forHeroHtml — section ②: computed for THIS hero. Roll expression, average →
  // tier, the T1/T2/T3 odds bar, and resolved per-tier damage. Renders only when
  // the ability has power-roll characteristics AND the hero's stats are synced.
  function forHeroHtml(a, data) {
    var chars = powerRollChars(a);
    if (!chars.length) return '';
    var best = null, bestKey = null;
    chars.forEach(function (k) {
      var v = num(data, String(k).toLowerCase(), null);
      if (v != null && (best == null || v > best)) { best = v; bestKey = k; }
    });
    if (best == null) return '';
    var odds = tierOdds(best);
    var avg = 11 + best;
    var avgTier = avg <= 11 ? 1 : (avg <= 16 ? 2 : 3);
    var roll = '2d10 + ' + best + ' (' + esc(charLabel(bestKey)) + ')';
    var resolved = bigLadderHtml(a, best);
    var resolvedHtml = resolved
      ? '<div class="ds-for__sub">Resolved for ' + esc(firstName(data.name)) + '</div>' + resolved : '';
    var bar = '<div class="ds-for__bar">' +
        '<i class="ds-for__o1" style="width:' + odds[0] + '%"></i>' +
        '<i class="ds-for__o2" style="width:' + odds[1] + '%"></i>' +
        '<i class="ds-for__o3" style="width:' + odds[2] + '%"></i>' +
      '</div>' +
      '<div class="ds-for__key">' +
        '<span><i class="ds-sw ds-sw--1"></i>T1 <b>' + odds[0] + '%</b></span>' +
        '<span><i class="ds-sw ds-sw--2"></i>T2 <b>' + odds[1] + '%</b></span>' +
        '<span><i class="ds-sw ds-sw--3"></i>T3 <b>' + odds[2] + '%</b></span>' +
      '</div>';
    return '<div class="ds-for">' +
      '<div class="ds-for__roll"><b>' + roll + '</b> → avg <b>' + avg + '</b> → likely <span class="ds-for__tier">Tier ' + avgTier + '</span></div>' +
      bar + resolvedHtml +
    '</div>';
  }

  // bigCardHtml — the grown two-section card: ① the rules (keywords / distance /
  // target / power roll / tier ladder / effect text) and ② "For <hero>" odds.
  function bigCardHtml(a, idx, data) {
    var g = groupOf(a);
    var star = g === 'signature' ? '★ ' : '';
    var meta = [costLabel(a, data), GROUP_LABELS[g]].filter(Boolean).join(' · ');
    var kw = (Array.isArray(a.keywords) && a.keywords.length)
      ? '<div class="ds-big__kw">' + a.keywords.map(function (k) {
          var en = (refRenderer && refRenderer.getEntry) ? refRenderer.getEntry(k) : null;
          var tip = (en && en.description) ? ' data-tip="' + escAttr(en.description) + '" tabindex="0"' : '';   // M-5
          return '<span' + tip + '>' + esc(String(k)) + '</span>';
        }).join('') + '</div>' : '';
    var effBefore = a.effectBefore ? '<div class="ds-big__flavor">' + refSynced(cleanFoundryText(a.effectBefore)) + '</div>' : '';
    var trig = a.trigger ? '<div class="ds-big__block"><span class="ds-big__block-k">Trigger</span><span>' + refSynced(cleanFoundryText(a.trigger)) + '</span></div>' : '';
    var effAfter = a.effectAfter ? '<div class="ds-big__block"><span class="ds-big__block-k">Effect</span><span>' + refSynced(cleanFoundryText(a.effectAfter)) + '</span></div>' : '';
    var forHero = forHeroHtml(a, data);

    return '<div class="ds-big" data-ds-collapse="' + idx + '">' +
      '<div class="ds-big__h"><span class="ds-big__nm">' + star + esc((a && a.name) || 'Untitled') + '</span>' +
        (meta ? '<span class="ds-big__meta">' + esc(meta) + '</span>' : '') +
        '<button type="button" class="ds-big__x" data-ds-collapse-btn aria-label="Collapse to card">✕</button></div>' +
      '<div class="ds-big__sec"><span class="ds-big__n">①</span> The rules</div>' +
      kw + bigStatRow(a) + effBefore + bigLadderHtml(a, null) + trig + effAfter +
      (forHero
        ? '<div class="ds-big__sec ds-big__sec--for"><span class="ds-big__n">②</span> For ' + esc(firstName(data.name)) + '</div>' + forHero
        : '') +
    '</div>';
  }

  // ── empty-state placeholder ──────────────────────────────────────────────
  // Every section ALWAYS renders (no content gating) so the sheet's
  // structure, spacing, and chrome are visible even on a sparse hero. A section
  // with no data shows this muted placeholder instead of vanishing.
  function ph(text) { return '<div class="cs-placeholder">' + esc(text) + '</div>'; }

  // ── schema builder ─────────────────────────────────────────────────

  // boxDef builds one box definition for the surface schema. `expand` is
  // 'expanded' | 'collapsed'; pinned boxes render open with the toggle disabled.
  function boxDef(id, title, block, expand, opts) {
    opts = opts || {};
    var def = { id: id, title: title, block: block, expand: expand };
    if (opts.pinned) def.pinned = true;
    if (opts.transition) def.transition = opts.transition;
    return def;
  }

  // buildSchema lays the sheet out top to bottom: identity, vitals,
  // characteristics (each full width), then a main column (abilities,
  // features, skills) beside a side column (combat, kit, progression). The
  // frame wraps the two columns into one on a phone, so DOM order is the
  // phone order. Chronicle places its own Items and money panel; the in-sheet
  // Inventory stays only when the host does not show that panel.
  function buildSchema(data) {
    var rows = [];

    rows.push({ columns: [ { width: 12, boxes: [
      boxDef('ds-identity', '', 'ds-identity', 'expanded', { pinned: true })
    ] } ] });
    rows.push({ columns: [ { width: 12, boxes: [
      boxDef('ds-vitals', 'Vitals', 'ds-vitals', 'expanded', { pinned: true })
    ] } ] });
    rows.push({ columns: [ { width: 12, boxes: [
      boxDef('ds-characteristics', 'Characteristics', 'ds-characteristics', 'expanded', { pinned: true })
    ] } ] });

    var main = [
      boxDef('ds-abilities', 'Abilities', 'ds-abilities', 'expanded'),
      boxDef('ds-features', 'Features', 'ds-features', 'collapsed'),
      boxDef('ds-skills', 'Skills', 'ds-skills', 'collapsed')
    ];
    var side = [
      boxDef('ds-combat', 'Combat', 'ds-combat', 'expanded', { pinned: true }),
      boxDef('ds-kit', 'Kit', 'ds-kit', 'collapsed'),
      boxDef('ds-damage', 'Damage', 'ds-damage', 'collapsed')
    ];
    if (!data.armoryItems) side.push(boxDef('ds-inventory', 'Inventory', 'ds-inventory', 'collapsed'));
    side.push(boxDef('ds-progression', 'Progression', 'ds-progression', 'collapsed'));
    rows.push({ columns: [ { width: 8, boxes: main }, { width: 4, boxes: side } ] });

    // Background and GM lore are permission gates, not data gates: a viewer
    // who may not read them gets no box at all rather than an empty one.
    if (data.isGm || data.isOwner) {
      rows.push({ columns: [ { width: 12, boxes: [
        boxDef('ds-notes', 'Background', 'ds-notes', 'expanded', { pinned: true })
      ] } ] });
    }
    if (data.isGm) {
      rows.push({ columns: [ { width: 12, boxes: [
        boxDef('ds-gmlore', 'GM Lore', 'ds-gmlore', 'collapsed')
      ] } ] });
    }

    return { provider: { key: 'drawsteel:entity:' + (data.entityId || 'anon'), seed: data }, rows: rows };
  }

  // ── one-time box registration ──────────────────────────────────────

  function registerBoxes() {
    var s = Chronicle.surface;
    if (!s || !s.registerBox) return;
    s.registerBox('ds-identity', rIdentity);
    s.registerBox('ds-vitals', rVitals);
    s.registerBox('ds-characteristics', rCharacteristics);
    s.registerBox('ds-combat', rCombat);
    s.registerBox('ds-kit', rKit);
    s.registerBox('ds-damage', rDamage);
    s.registerBox('ds-abilities', rAbilities);
    s.registerBox('ds-skills', rSkills);
    s.registerBox('ds-features', rFeatures);
    s.registerBox('ds-progression', rProgression);
    s.registerBox('ds-inventory', rInventory);
    s.registerBox('ds-notes', rNotes);
    s.registerBox('ds-gmlore', rGmLore);
  }

  // ── mount + ability overlay ────────────────────────────────────────

  // appendBlockSlots emits the reserved Option-C slot points after the surface.
  function appendBlockSlots(el, data) {
    if (!data.entityId || !data.campaignId) return;
    var eid = esc(String(data.entityId));
    var cid = esc(String(data.campaignId));
    var blocks = ['character_skills', 'character_inventory', 'character_purchase_history'];
    blocks.forEach(function (b) {
      var div = document.createElement('div');
      div.className = 'cs-slot';
      div.setAttribute('data-block', b);
      div.setAttribute('data-entity-id', eid);
      div.setAttribute('data-campaign-id', cid);
      el.appendChild(div);
    });
  }

  // reduced reflects the OS reduce-motion preference (via the frame, with a
  // direct fallback) so the accordion snaps instead of animating when asked.
  function reduced() {
    if (Chronicle.surface && Chronicle.surface.reducedMotion) return Chronicle.surface.reducedMotion();
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // animateCardIn plays the card's reveal: the small card rises+fades, the big
  // card scales+fades up (the "grows into the bigger card" motion). Skipped under
  // reduce-motion (the final state is already in the DOM).
  function animateCardIn(node, isBig) {
    if (!node || reduced()) return;
    node.style.opacity = '0';
    node.style.transform = isBig ? 'scale(0.97)' : 'translateY(5px)';
    node.style.transition = 'opacity 200ms ease, transform 260ms cubic-bezier(.2,.7,.2,1)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { node.style.opacity = '1'; node.style.transform = 'none'; });
    });
  }

  // attachInteractions wires the master–detail interactions with ONE delegated
  // click + one keydown listener on the mounted root (the frame re-renders box
  // bodies, so per-node listeners would leak):
  //   • a [data-ds-ability] rail row → SELECT it (fill the pane with the small card)
  //   • the small [data-ds-expand] card (or Enter/Space on it) → GROW to the big card
  //   • clicking anywhere on the big [data-ds-collapse] card (the ✕, or Escape)
  //     → shrink back to the small card (glossary refs / text selection excepted)
  //   • [data-cs-read-story] → open the backstory reading view
  // The pane is filled here (not in rAbilities) so selection state lives in the
  // DOM while the box renderer stays a pure function. On mount the first ability
  // (preferring a signature) is auto-selected so the pane is never blank.
  function attachInteractions(inst, el, data) {
    var abilities = parseAbilities(data);
    // The abilities live in the box on the old render and in the open panel
    // on the paper render, so ability lookups start from whichever is current.
    function scope() { return (inst._panelBody && inst._panelBody.isConnected) ? inst._panelBody : el; }
    function pane() { return scope().querySelector('[data-ds-pane]'); }
    function cardIn(node, isBig) { if (inst._paper) growIn(node); else animateCardIn(node, isBig); }

    function selectAbility(idx) {
      var a = abilities[idx];
      if (!a) return;
      var rows = scope().querySelectorAll('[data-ds-ability]');
      Array.prototype.forEach.call(rows, function (r) {
        var on = r.getAttribute('data-ds-ability') === String(idx);
        r.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) r.classList.add('ds-li--sel'); else r.classList.remove('ds-li--sel');
      });
      var p = pane();
      if (!p) return;
      p.innerHTML = smallCardHtml(a, idx, data);
      cardIn(p.firstChild, false);
    }
    function expandAbility(idx) {
      var a = abilities[idx];
      var p = pane();
      if (!a || !p) return;
      p.innerHTML = bigCardHtml(a, idx, data);
      cardIn(p.firstChild, true);
    }

    // Filter the rail rows by name; hide empty groups and force groups open while
    // a query is active so matches inside a collapsed group still surface.
    function applyFilter(q) {
      q = String(q || '').trim().toLowerCase();
      var rail = scope().querySelector('.ds-rail');
      if (!rail) return;
      var anyShown = false;
      Array.prototype.forEach.call(rail.querySelectorAll('.ds-ab-grp'), function (grp) {
        var shown = 0;
        Array.prototype.forEach.call(grp.querySelectorAll('[data-ds-ability]'), function (r) {
          var match = !q || (r.textContent || '').toLowerCase().indexOf(q) !== -1;
          if (match) { r.classList.remove('ds-li--hidden'); shown++; }
          else r.classList.add('ds-li--hidden');
        });
        if (shown === 0 && q) grp.classList.add('ds-ab-grp--empty');
        else grp.classList.remove('ds-ab-grp--empty');
        if (q) grp.classList.add('ds-ab-grp--filtering');
        else grp.classList.remove('ds-ab-grp--filtering');
        if (shown && !grp.classList.contains('ds-ab-grp--off')) anyShown = true;
      });
      var none = rail.querySelector('[data-ds-no-match]');
      if (none) none.hidden = anyShown;
    }

    // Show one ability group: flip the tab state, hide the other groups' rows,
    // and select a card in it (the one already open if it belongs here).
    function selectTab(g, focusTab) {
      var tabs = scope().querySelectorAll('[data-ds-tab]');
      Array.prototype.forEach.call(tabs, function (b) {
        var on = b.getAttribute('data-ds-tab') === g;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
        if (on) { b.classList.add('ds-tab--on'); if (focusTab) b.focus(); } else b.classList.remove('ds-tab--on');
      });
      Array.prototype.forEach.call(scope().querySelectorAll('.ds-ab-grp'), function (grp) {
        if (grp.getAttribute('data-ds-grp') === g) grp.classList.remove('ds-ab-grp--off');
        else grp.classList.add('ds-ab-grp--off');
      });
      var filter = scope().querySelector('[data-ds-filter]');
      if (filter && filter.value) applyFilter(filter.value);
      var cur = scope().querySelector('.ds-li--sel');
      var curGrp = cur ? cur.closest('.ds-ab-grp') : null;
      if (curGrp && curGrp.getAttribute('data-ds-grp') === g) return;
      var first = scope().querySelector('.ds-ab-grp[data-ds-grp="' + g + '"] [data-ds-ability]');
      if (first) selectAbility(parseInt(first.getAttribute('data-ds-ability'), 10));
      else { var p = pane(); if (p) p.innerHTML = paneEmptyHtml(); }
    }

    // The picture upload lives in Chronicle; the widget only asks for it.
    function requestImageChange(btn) {
      var ev;
      try {
        ev = new CustomEvent('chronicle:change-image', { bubbles: true, detail: { entityId: data.entityId } });
      } catch (e) { return; }
      btn.dispatchEvent(ev);
    }

    // Origin values open Chronicle's shared choice picker under the band.
    // Without the picker the values simply stay text, as for a viewer who
    // may not edit.
    var openPick = null;
    function pickOrigin(btn) {
      if (typeof Chronicle.pickChoice !== 'function') return;
      var key = btn.getAttribute('data-cs-pick');
      var fold = el.querySelector('[data-cs-pick-fold]');
      if (!fold || !data.campaignId) return;
      // pickChoice toggles on the anchor, so a second field means closing the
      // first fold before opening the next.
      var reopen = openPick && openPick !== key;
      if (openPick) {
        var prev = el.querySelector('[data-cs-pick="' + openPick + '"]');
        Chronicle.pickChoice({ campaignId: data.campaignId, fieldKey: openPick, anchorEl: fold });
        if (prev) prev.setAttribute('aria-expanded', 'false');
        openPick = null;
        if (!reopen) return;
      }
      openPick = key;
      btn.setAttribute('aria-expanded', 'true');
      var p;
      try {
        p = Chronicle.pickChoice({
          campaignId: data.campaignId, entityId: data.entityId, fieldKey: key,
          current: f(data, key, ''), label: btn.getAttribute('data-cs-label') || key,
          anchorEl: fold, save: true
        });
      } catch (err) { openPick = null; btn.setAttribute('aria-expanded', 'false'); return; }
      Promise.resolve(p).then(function (res) {
        if (openPick === key) openPick = null;
        btn.setAttribute('aria-expanded', 'false');
        if (!res || res.value == null) {
          // The picker hands focus back to the fold, which is hidden once
          // empty, so a cancel would leave keyboard users nowhere.
          var a = document.activeElement;
          if ((!a || a === document.body || fold.contains(a)) && btn.focus) btn.focus();
          return;
        }
        data.fields[key] = res.value;
        var out = btn.querySelector('[data-cs-val]');
        if (out) {
          var before = out.textContent;
          out.textContent = res.value;
          if (inst._paper) {
            // Chronicle shows the change the way the sheet's style does.
            Chronicle.sheetMotion.land(out, before);
            btn.setAttribute('aria-label', (btn.getAttribute('data-cs-label') || key) + ': ' + res.value + '. Change');
          } else if (!reduced()) {
            out.classList.remove('ag-landed');
            void out.offsetWidth;
            out.classList.add('ag-landed');
          }
        }
        if (btn.focus) btn.focus();
      }, function () {
        if (openPick === key) openPick = null;
        btn.setAttribute('aria-expanded', 'false');
      });
    }

    inst._onAbilityClick = function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tab = t.closest('[data-ds-tab]');
      if (tab) { e.preventDefault(); selectTab(tab.getAttribute('data-ds-tab'), false); return; }
      var chip = t.closest('[data-cs-change-image]');
      if (chip) { e.preventDefault(); requestImageChange(chip); return; }
      var pick = t.closest('[data-cs-pick]');
      if (pick) { e.preventDefault(); pickOrigin(pick); return; }
      var unp = t.closest('[data-unpin]');
      if (unp) { e.preventDefault(); unpin(inst, true); return; }
      var rs = t.closest('[data-cs-read-story]');
      if (rs) {
        e.preventDefault();
        // On paper the story is pinned onto the open Notes panel.
        if (inst._paper) openStoryPin(inst, rs, data);
        else openReadingView(data.name || 'Background', f(data, 'backstory', '') || f(data, 'notes', ''));
        return;
      }
      // Clicking anywhere on the big card returns to the small card (symmetric
      // with the small card being wholly clickable to expand). Guarded: don't
      // hijack a glossary ref / link, and don't collapse on the click that ends
      // a text selection (so the rules text stays readable/selectable).
      var big = t.closest('[data-ds-collapse]');
      if (big) {
        if (t.closest('.ds-ref') || t.closest('a')) return;
        var sel = '';
        try { sel = window.getSelection ? String(window.getSelection()) : ''; } catch (e2) {}
        if (sel) return;
        e.preventDefault();
        selectAbility(parseInt(big.getAttribute('data-ds-collapse'), 10));
        return;
      }
      var card = t.closest('[data-ds-expand]');
      if (card) { e.preventDefault(); expandAbility(parseInt(card.getAttribute('data-ds-expand'), 10)); return; }
      var row = t.closest('[data-ds-ability]');
      if (row) { e.preventDefault(); selectAbility(parseInt(row.getAttribute('data-ds-ability'), 10)); }
    };
    el.addEventListener('click', inst._onAbilityClick);

    // The small card is a div[role=button]; rail rows are native <button>s, so
    // only the card needs an explicit Enter/Space handler.
    inst._onAbilityKey = function (e) {
      var t = e.target;
      // Escape on the big card → shrink back to the small card.
      if (e.key === 'Escape' || e.key === 'Esc') {
        var openBig = (t && t.closest) ? t.closest('[data-ds-collapse]') : null;
        if (!openBig) { var p0 = pane(); openBig = p0 ? p0.querySelector('[data-ds-collapse]') : null; }
        if (openBig) { e.preventDefault(); selectAbility(parseInt(openBig.getAttribute('data-ds-collapse'), 10)); }
        return;
      }
      var tabEl = (t && t.closest) ? t.closest('[data-ds-tab]') : null;
      if (tabEl) {
        var order = GROUP_ORDER, i = order.indexOf(tabEl.getAttribute('data-ds-tab')), to = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % order.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + order.length - 1) % order.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = order.length - 1;
        if (to >= 0) { e.preventDefault(); selectTab(order[to], true); return; }
      }
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var card = (t && t.closest) ? t.closest('[data-ds-expand]') : null;
      if (card) { e.preventDefault(); expandAbility(parseInt(card.getAttribute('data-ds-expand'), 10)); }
    };
    el.addEventListener('keydown', inst._onAbilityKey);

    // The rail filter (present only on long lists) narrows rows as you type.
    inst._onAbilityInput = function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-ds-filter') !== null) applyFilter(t.value);
    };
    el.addEventListener('input', inst._onAbilityInput);

    // Auto-select the first ability (prefer a signature) so the pane shows a card
    // immediately instead of the resting prompt. On paper the abilities exist
    // only while their panel is open, so the panel-ready handler calls this.
    function selectFirst() {
      if (!abilities.length) return;
      var firstRow = scope().querySelector('.ds-ab-grp:not(.ds-ab-grp--off) [data-ds-ability]');
      selectAbility(firstRow ? parseInt(firstRow.getAttribute('data-ds-ability'), 10) : 0);
    }
    inst._selectFirst = selectFirst;
    inst._collapse = selectAbility;
    if (!inst._paper) selectFirst();
  }

  // ── tooltips (viewport-clamped) ──────────────────────────────────────────
  // Glossary-term tooltips (.ds-ref[data-ref-tip], from reference-renderer.js)
  // and definition tooltips ([data-tip]) render via one shared floating
  // element appended to <body> (escapes any ancestor's overflow clip) and
  // positioned with position:fixed from a pure, unit-testable placement
  // function — never a CSS popover, which an ancestor with overflow:hidden
  // would clip and which has no viewport awareness near an edge. The CSS
  // popover is suppressed below in injectStyles.
  var TIP_SELECTOR = '[data-tip], .ds-ref[data-ref-tip]';
  var TIP_MARGIN = 8;
  var TIP_GAP = 7;

  // clampTooltipPos is pure (plain rect-shaped objects in, plain {left,top,
  // placement} out) so it's testable off-DOM. Centers the tip on the anchor
  // horizontally, clamped so it never crosses the viewport's left/right edge;
  // prefers placing it above the anchor, flipping below when there isn't room
  // (e.g. the anchor sits near the top of the viewport or a scrolled container).
  function clampTooltipPos(anchor, tip, viewport, gap) {
    gap = (gap == null) ? TIP_GAP : gap;
    var left = anchor.left + (anchor.width / 2) - (tip.width / 2);
    var maxLeft = viewport.width - tip.width - TIP_MARGIN;
    if (left > maxLeft) left = maxLeft;
    if (left < TIP_MARGIN) left = TIP_MARGIN;

    var placement = 'above';
    var top = anchor.top - tip.height - gap;
    if (top < TIP_MARGIN) {
      placement = 'below';
      top = anchor.bottom + gap;
      var maxTop = viewport.height - tip.height - TIP_MARGIN;
      if (top > maxTop) top = (maxTop < TIP_MARGIN) ? TIP_MARGIN : maxTop;
    }
    return { left: left, top: top, placement: placement };
  }

  // One shared tooltip node per page (module singleton — same "one DS system per
  // page" assumption as refRenderer/skillDefs above), created lazily and reused
  // across hovers so we never leak nodes.
  var _tipbox = null;
  function getTipbox() {
    if (!_tipbox) {
      _tipbox = document.createElement('div');
      _tipbox.className = 'ds-tipbox';
      _tipbox.setAttribute('role', 'tooltip');
      (document.body || document.documentElement).appendChild(_tipbox);
    }
    return _tipbox;
  }

  function tipTextFor(trigger) {
    var t = trigger.getAttribute('data-tip');
    if (t == null) t = trigger.getAttribute('data-ref-tip');
    return t;
  }

  // showTipFor measures the tip off-screen first (so the reveal never flashes at
  // the wrong spot), then clamps against the live viewport size — re-derived on
  // every show, not cached, so a resize/rotate between hovers is always honored.
  function showTipFor(trigger) {
    var text = tipTextFor(trigger);
    if (!text) return;
    var box = getTipbox();
    box.textContent = text;
    box.style.maxWidth = Math.min(280, window.innerWidth - TIP_MARGIN * 2) + 'px';
    box.className = 'ds-tipbox ds-tipbox--measuring';
    var tipSize = { width: box.offsetWidth, height: box.offsetHeight };
    var a = trigger.getBoundingClientRect();
    var viewport = { width: window.innerWidth, height: window.innerHeight };
    var pos = clampTooltipPos(
      { left: a.left, top: a.top, bottom: a.bottom, width: a.width, height: a.height },
      tipSize, viewport
    );
    box.style.left = pos.left + 'px';
    box.style.top = pos.top + 'px';
    box.className = 'ds-tipbox ds-tipbox--visible ds-tipbox--' + pos.placement;
  }

  function hideTipbox() {
    if (!_tipbox) return;
    _tipbox.className = 'ds-tipbox';
    _tipbox.textContent = '';
  }

  // attachTooltips wires ONE delegated mouseover/mouseout + focusin/focusout
  // pair (same "one listener on the mount root" approach as attachInteractions)
  // covering every current and future [data-tip]/.ds-ref in the sheet, so box
  // re-renders never need per-node rewiring.
  function attachTooltips(inst, el) {
    var current = null;
    inst._onTipShow = function (e) {
      var t = e.target;
      var trigger = (t && t.closest) ? t.closest(TIP_SELECTOR) : null;
      if (!trigger || !el.contains(trigger) || trigger === current) return;
      current = trigger;
      showTipFor(trigger);
    };
    inst._onTipHide = function (e) {
      var t = e.target;
      var trigger = (t && t.closest) ? t.closest(TIP_SELECTOR) : null;
      var related = e.relatedTarget;
      if (trigger && related && trigger.contains(related)) return; // stayed within the same trigger
      current = null;
      hideTipbox();
    };
    el.addEventListener('mouseover', inst._onTipShow);
    el.addEventListener('mouseout', inst._onTipHide);
    el.addEventListener('focusin', inst._onTipShow);
    el.addEventListener('focusout', inst._onTipHide);
  }

  // ── entrance motion ────────────────────────────────────────────────
  // countUp animates a single integer-bearing node from 0 → its value, keeping
  // any surrounding text (a leading sign, a " / max"). Restores the exact
  // original string on finish so signs/zeroes stay pixel-correct.
  function countUp(node) {
    var raw = node.textContent;
    var m = raw && raw.match(/-?\d+/);
    if (!m) return;
    var target = parseInt(m[0], 10);
    if (!target) return; // 0 / NaN — nothing to count toward
    var pre = raw.slice(0, m.index), post = raw.slice(m.index + m[0].length);
    var dur = 500, t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var v = Math.round(target * (1 - Math.pow(1 - p, 3))); // easeOutCubic
      node.textContent = pre + v + post;
      if (p < 1) requestAnimationFrame(step);
      else node.textContent = raw;
    }
    requestAnimationFrame(step);
  }

  // playEntrance choreographs the sheet's reveal: a staggered box rise, bars that
  // fill from empty, and characteristic values that count up. The box stagger is
  // CSS (class + per-box delay), so it collapses cleanly under reduce-motion via
  // the @media guard; the bar/number motion is JS and is skipped outright when
  // reduce-motion is set (the final values are already in the DOM). Called once
  // per mount, synchronously — the seeded surface renders box bodies before this
  // runs, so the 0-state is set before first paint (no flash of full values).
  function playEntrance(el) {
    var boxes = el.querySelectorAll('.cs-box');
    Array.prototype.forEach.call(boxes, function (box, i) {
      box.style.animationDelay = (Math.min(i, 9) * 50) + 'ms';
      box.classList.add('ds-anim-in');
    });
    if (reduced()) return;
    Array.prototype.forEach.call(el.querySelectorAll('.cs-bar-fill'), function (bar) {
      var target = bar.style.width;
      if (!target) return;
      bar.style.width = '0%';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { bar.style.width = target; });
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll('.cs-stat-value'), countUp);
    // Recovery dots + heroic-resource pips fade/rise in just after the bars,
    // so the Vitals glyphs reveal intentionally rather than snapping in.
    Array.prototype.forEach.call(el.querySelectorAll('.cs-dots, .cs-hr-pips'), function (n, i) {
      n.style.opacity = '0';
      n.style.transform = 'translateY(3px)';
      n.style.transition = 'opacity 300ms ease ' + (120 + i * 80) + 'ms, transform 300ms ease ' + (120 + i * 80) + 'ms';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { n.style.opacity = '1'; n.style.transform = 'none'; });
      });
    });
  }

  // ── Paper sheet ──────────────────────────────────────────────────────────
  // When Chronicle.sheetMotion exists the sheet is laid out as paper: a root
  // carrying data-sheet, one .paper holding the parts, and each part that has
  // more to show is a .paper-pull with a data-sheet-open button whose body is
  // a <template data-sheet-panel>. Chronicle owns the style, the motion and
  // the panel chrome; this file writes layout only, from --paper-* tokens.
  // Without sheetMotion (an older Chronicle) mountSheet keeps the box render.
  //
  // Every builder here is a pure function of the seed so the markup can be
  // checked without a DOM. Anything user-authored goes through esc (text) or
  // escAttr (attribute), exactly as in the box renderers.

  function paperAvailable() {
    return !!(Chronicle && Chronicle.sheetMotion && typeof Chronicle.sheetMotion.mount === 'function');
  }

  function fa(name) { return '<i class="fa-solid fa-' + name + '" aria-hidden="true"></i>'; }
  function pEmpty(text) { return '<p class="sh-sub sh-empty">' + esc(text) + '</p>'; }
  function signedStat(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '')) + Math.abs(n); }

  // A part's button. The label defaults to the style-dependent "Pull out" /
  // "Open" pair that the sheet CSS shows one of.
  function pullBtn(id, inner, label) {
    return '<button type="button" class="sh-pullbtn" data-sheet-open="' + escAttr(id) + '" aria-expanded="false">' + inner +
      '<span class="sh-pull">' + (label ? esc(label) : '<span class="only-paper">Pull out</span><span class="only-modern">Open</span>') +
      fa('chevron-right') + '</span></button>';
  }

  // A fold is <details data-sheet-fold>; Chronicle measures .fold-body and
  // animates it to its real height. head and body are already-escaped HTML.
  function foldHtml(cls, head, body, open) {
    return '<details class="ft' + (cls ? ' ' + cls : '') + (open ? ' is-in' : '') + '" data-sheet-fold' + (open ? ' open' : '') + '>' +
      '<summary>' + head + '</summary><div class="fold-body"><div class="fold-in" data-move="fold">' + body + '</div></div></details>';
  }

  // Dying at 0 and dead at minus the winded value are the Draw Steel rules the
  // Winded/Dying glossary entries state; nothing here is hero-specific.
  function staminaState(current, winded, max) {
    if (!(max > 0)) return null;
    if (winded > 0 && current <= -winded) return ['dead', 'Dead'];
    if (current <= 0) return ['dying', 'Dying'];
    if (winded > 0 && current <= winded) return ['winded', 'Winded'];
    return null;
  }

  function pHead(data) {
    return '<header class="sh-head paper-title"><div><div class="paper-kind">Hero · Draw Steel</div>' +
      '<div class="sh-name"><h2>' + esc(data.name || 'Unnamed Hero') + '</h2></div></div></header>';
  }

  // The origin values are pickers only when the host allows editing and
  // Chronicle can open its picker; the picker itself stays Chronicle's.
  function pIdentity(data) {
    var name = data.name || 'Unnamed Hero';
    var canPick = !!data.canEditIdentity && typeof Chronicle.pickChoice === 'function';
    var safePortrait = safeImgUrl(f(data, 'portrait_url', ''));
    var portrait = safePortrait
      ? '<img src="' + escAttr(safePortrait) + '" alt="' + escAttr(name) + '" data-cs-portrait>'
      : '<span class="sh-port-ph" data-cs-portrait>' + fa('shield-halved') + '</span>';
    var chip = data.canChangeImage ? '<button type="button" data-cs-change-image>' + fa('camera') + ' Change</button>' : '';

    var slots = ORIGIN_SLOTS.map(function (s) {
      var v = f(data, s.key, '');
      var text = v ? esc(v) : '<span class="sh-unset">Not set</span>';
      var inner = canPick
        ? '<button type="button" class="sh-pick" data-cs-pick="' + s.key + '" data-cs-label="' + s.label + '" aria-expanded="false"' +
            ' aria-label="' + escAttr(s.label + ': ' + (v ? v : 'Not set') + '. Change') + '">' +
            '<span data-cs-val data-v="origin-' + s.key + '">' + text + '</span>' + fa('chevron-right') + '</button>'
        : '<div class="sh-v-plain" data-cs-val data-v="origin-' + s.key + '">' + text + '</div>';
      return '<div class="sh-slot" data-slot="' + s.key + '"><span class="sh-k">' + s.label + '</span>' + inner + '</div>';
    }).join('');

    var className = f(data, 'class', '');
    var subclass = f(data, 'subclass', '');
    var faction = f(data, 'faction', '');
    var fixed = '<div class="sh-fixed">' +
      '<span><span class="sh-k">Class</span>' + (className ? esc(className) : '&ndash;') + '</span>' +
      '<span><span class="sh-k">Subclass</span>' + (subclass ? esc(subclass) : '&ndash;') + '</span>' +
      '<span><span class="sh-k">Level</span>' + num(data, 'level', 1) + '</span>' +
      (faction ? '<span><span class="sh-k">Faction</span>' + esc(faction) + '</span>' : '') +
      '<small>' + fa('arrows-rotate') + ' set in Foundry</small></div>';

    return '<section class="sh-id" aria-label="' + escAttr('Who ' + name + ' is') + '">' +
      '<div class="sh-port">' + portrait + chip + '</div>' +
      '<div><div class="sh-slots">' + slots + '</div>' + fixed + '</div>' +
      '<div class="sh-fold" data-cs-pick-fold tabindex="-1"></div></section>';
  }

  function pStamina(cur, max, winded) {
    var st = staminaState(cur, winded, max);
    var pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    var bar = max > 0
      ? '<div class="sh-bar" aria-hidden="true"><span style="width:' + pct + '%"></span>' +
          (winded > 0 ? '<i class="w" style="left:' + Math.min(100, (winded / max) * 100) + '%"></i>' : '') + '</div>'
      : '';
    var sub = winded > 0
      ? '<span class="sh-sub num">Winded ' + winded + ' · Dying at 0 · Dead at −' + winded + '</span>' : '';
    return '<div class="sh-v"><span class="sh-k">Stamina' + (st ? ' <span class="sh-state ' + st[0] + '">' + st[1] + '</span>' : '') + '</span>' +
      '<div class="sh-big"><span class="sh-num"><span data-v="stamina">' + cur + '</span> <small>/ ' + max + '</small></span></div>' +
      bar + sub + '</div>';
  }

  function pConditions(data) {
    var conds = parseJson(f(data, 'conditions_json', ''), []);
    var chips = (Array.isArray(conds) ? conds : []).map(function (c) {
      var raw = (c && (c.name || c)) || '';
      var sev = (c && c.severity) || '';
      var cls = 'sh-cnd';
      if (/bleed|burn|dam|poison/i.test(raw + ' ' + sev)) cls += ' sh-cnd--danger';
      else if (/slow|weak|daz|frighten|restrain|prone|grab|taunt/i.test(raw + ' ' + sev)) cls += ' sh-cnd--warn';
      return '<span class="' + cls + '">' + esc(humanizeId(raw)) + '</span>';
    }).join('');
    return '<div class="sh-cond"><span class="sh-k lbl">Conditions</span>' + (chips || '<span class="sh-sub">None</span>') + '</div>';
  }

  // The static combat scalars. Disengage, Size and Save show only when synced.
  function pStats(data) {
    function stat(label, key) {
      var v = f(data, key, null);
      return '<span>' + label + '<b>' + ((v == null || v === '') ? '–' : esc(String(scalar(v)))) + '</b></span>';
    }
    var out = stat('Speed', 'speed') + stat('Stability', 'stability');
    if (isNum(data, 'disengage') || f(data, 'disengage', '') !== '') out += stat('Disengage', 'disengage');
    if (f(data, 'size', '') !== '') out += stat('Size', 'size');
    if (isNum(data, 'potency_weak') || isNum(data, 'potency_average') || isNum(data, 'potency_strong')) {
      var pv = function (k) { return '<b>' + (isNum(data, k) ? num(data, k, 0) : '–') + '</b>'; };
      out += '<span>Potency ' + pv('potency_weak') + ' · ' + pv('potency_average') + ' · ' + pv('potency_strong') + '</span>';
    }
    if (isNum(data, 'save_threshold')) {
      var sb = f(data, 'save_bonus', '');
      var sbTxt = (sb != null && String(sb).trim() !== '' && String(sb) !== '0')
        ? ' ' + (String(sb).charAt(0) === '-' ? '' : '+') + esc(String(sb)) : '';
      out += '<span>Save<b>' + num(data, 'save_threshold', 6) + '+' + sbTxt + '</b></span>';
    }
    var modes = parseStrList(f(data, 'movement_types', '')).map(function (m) { return String(m).toLowerCase(); })
      .filter(function (m) { return m && m !== 'walk'; });
    var labels = modes.map(function (m) { return esc(humanizeId(m)); });
    if (num(data, 'movement_hover', 0)) labels.push('Hover');
    if (labels.length) out += '<span>Movement<b>' + labels.join(', ') + '</b></span>';
    return '<div class="sh-stats">' + out + '</div>';
  }

  function pTurn(data) {
    var cur = num(data, 'stamina_current', 0), max = num(data, 'stamina_max', 0);
    var winded = num(data, 'winded', max ? Math.floor(max / 2) : 0);
    var rec = num(data, 'recoveries', 0), recMax = num(data, 'recoveries_max', 0);
    var hrName = f(data, 'heroic_resource_name', '') || 'Heroic Resource';
    var pips = '';
    for (var i = 0; i < Math.min(recMax, 12); i++) pips += i < rec ? '●' : '○';
    var top = pStamina(cur, max, winded) +
      '<div class="sh-v"><span class="sh-k">' + esc(hrName) + '</span><span class="sh-num" data-v="hr">' + num(data, 'heroic_resource_current', 0) + '</span><span class="sh-sub">Heroic resource</span></div>' +
      (isNum(data, 'surges') ? '<div class="sh-v"><span class="sh-k">Surges</span><span class="sh-num" data-v="surges">' + num(data, 'surges', 0) + '</span></div>' : '') +
      '<div class="sh-v"><span class="sh-k">Recoveries</span><span class="sh-num"><span data-v="rec">' + rec + '</span>' +
        (recMax ? ' <small>/ ' + recMax + '</small>' : '') + '</span>' +
        (pips ? '<span class="sh-pips" aria-hidden="true">' + pips + '</span>' : '') +
        (max > 0 ? '<span class="sh-sub">Catch Breath heals ' + Math.floor(max / 3) + '</span>' : '') + '</div>';
    return '<section class="sh-turn paper-pull" data-sheet-section="turn" aria-label="This turn">' +
      '<div class="sh-turnhead">' + pullBtn('turn', '<span class="paper-kind">This turn</span>', 'Rules') + '</div>' +
      '<div class="sh-turn-top">' + top + '</div>' + pConditions(data) + pStats(data) + '</section>';
  }

  function pCharacteristics(data) {
    var cells = ['might', 'agility', 'reason', 'intuition', 'presence'].map(function (k) {
      var v = num(data, k, 0);
      return '<div><span>' + CHAR_LABELS[k] + '</span><b class="' + (v < 0 ? 'sh-neg' : '') + '">' + signedStat(v) + '</b></div>';
    }).join('');
    return '<section class="sh-o1" aria-label="Characteristics"><div class="paper-kind">Characteristics</div><div class="sh-chars">' + cells + '</div></section>';
  }

  function pAbilityBand(data) {
    var abilities = parseAbilities(data);
    var n = { signature: 0, heroic: 0, maneuver: 0 };
    var sig = null;
    abilities.forEach(function (a) {
      var g = groupOf(a);
      n[g]++;
      if (g === 'signature' && !sig) sig = a;
    });
    var row = abilities.length
      ? '<span class="sh-row">' +
          (sig ? '<span>' + fa('star') + ' <b>' + esc(sig.name || 'Untitled') + '</b></span>' : '') +
          '<span>Signature <b>' + n.signature + '</b></span><span>Heroic <b>' + n.heroic + '</b></span><span>Maneuvers <b>' + n.maneuver + '</b></span></span>'
      : '<span class="sh-row"><span>No abilities yet.</span></span>';
    return '<section class="sh-band paper-pull sh-o2" data-sheet-section="abilities">' +
      pullBtn('abilities', '<span class="paper-kind">Abilities</span>' + row) + '</section>';
  }

  // Counts shown on the ledger lines. Each is a number or an escaped label.
  function treasureList(data) {
    var t = parseJson(f(data, 'treasures_json', ''), []);
    return Array.isArray(t) ? t : [];
  }
  function featureCount(data) {
    var n = 0;
    ['features_json', 'perks_json', 'titles_json'].forEach(function (k) {
      var a = parseJson(f(data, k, ''), []);
      if (Array.isArray(a)) n += a.length;
    });
    return n;
  }
  function skillLists(data) {
    var s = parseJson(f(data, 'skills_json', ''), []);
    return { skills: Array.isArray(s) ? s : [], langs: parseStrList(f(data, 'languages_json', '')) };
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // The ledger lines for the panels that exist. Items is absent when the
  // host shows its own item list; Notes is a permission gate, as before.
  function paperLedger(data) {
    var lines = [];
    if (!data.armoryItems) {
      var count = treasureList(data).length + invItems(data).length;
      var wealth = f(data, 'wealth', null);
      lines.push(['items', 'Items', plural(count, 'item', 'items') + (wealth != null ? ' · Wealth ' + esc(String(wealth)) : '')]);
    }
    var fc = featureCount(data);
    lines.push(['features', 'Features', fc ? plural(fc, 'feature', 'features') : 'None synced yet']);
    var sl = skillLists(data);
    lines.push(['skills', 'Skills', plural(sl.skills.length, 'skill', 'skills') + (sl.langs.length ? ' · ' + plural(sl.langs.length, 'language', 'languages') : '')]);
    if (data.isGm || data.isOwner) lines.push(['notes', 'Notes', 'Background' + (data.isGm ? ', GM lore' : '')]);
    return '<section class="sh-ledger sh-o6">' + lines.map(function (l) {
      return '<div class="paper-pull" data-sheet-section="' + l[0] + '">' +
        pullBtn(l[0], '<span class="sh-nm">' + l[1] + '</span><span class="sh-ds" data-ds="' + l[0] + '">' + l[2] + '</span>') + '</div>';
    }).join('') + '</section>';
  }

  // A damage-type entry as one phrase ("Fire 5"). Shared by the part and panel.
  function dmgEntryText(entry) {
    if (entry == null) return '';
    if (typeof entry === 'string') return entry;
    var type = entry.type ? String(entry.type) : '';
    var value = (entry.value != null && entry.value !== '') ? ' ' + String(entry.value) : '';
    return (type + value).trim();
  }
  function damageLists(data) {
    return {
      imm: toDamageEntries(f(data, 'immunities', '')).map(dmgEntryText).filter(Boolean),
      weak: toDamageEntries(f(data, 'weaknesses', '')).map(dmgEntryText).filter(Boolean),
      status: parseStrList(f(data, 'status_immunities', '')).map(humanizeId)
    };
  }

  // The kit as the part and its panel both show it: a name, the melee and
  // ranged damage bonuses per tier, and the flat bonuses. Values are user
  // authored, so a non-numeric one is escaped rather than signed.
  function kitFacts(data) {
    var arr = parseJson(f(data, 'kit_details_json', ''), []);
    var k = Array.isArray(arr) ? arr[0] : (arr && typeof arr === 'object' ? arr : null);
    var name = f(data, 'kit', '') || (k && k.name) || '';
    if (!k) return { name: name, grid: '', chips: [] };
    var has = function (v) { return v != null && v !== '' && v !== 0; };
    var fmt = function (v) { return (v == null || v === '') ? '–' : (v > 0 ? '+' + v : esc(String(v))); };
    var rows = '';
    [['Melee', 'melee'], ['Ranged', 'ranged']].forEach(function (pair) {
      var p = pair[1], t1 = k[p + 'DamageT1'], t2 = k[p + 'DamageT2'], t3 = k[p + 'DamageT3'];
      if (!(has(t1) || has(t2) || has(t3))) return;
      rows += '<span>' + pair[0] + '</span><span>' + fmt(t1) + '</span><span>' + fmt(t2) + '</span><span>' + fmt(t3) + '</span>';
    });
    var grid = rows
      ? '<div class="sh-kit num"><span class="sh-h">Damage bonus</span><span class="sh-h">T1</span><span class="sh-h">T2</span><span class="sh-h">T3</span>' + rows + '</div>'
      : '';
    var chips = [['Stamina', 'stamina'], ['Stability', 'stability'], ['Speed', 'speed'], ['Disengage', 'disengage']]
      .filter(function (b) { return has(k[b[1]]); })
      .map(function (b) { return '<span class="sh-chip">' + b[0] + ' ' + fmt(k[b[1]]) + '</span>'; });
    return { name: name, grid: grid, chips: chips };
  }

  function pKitPart(data) {
    var k = kitFacts(data);
    var body = (k.name ? '<div class="sh-kit-name">' + esc(k.name) + '</div>' : '') + k.grid +
      (k.chips.length ? '<div class="sh-line">' + k.chips.join('') + '</div>' : '') +
      ((!k.name && !k.grid && !k.chips.length) ? '<div class="sh-line">No kit equipped.</div>' : '');
    return '<section class="sh-sec paper-pull sh-o3" data-sheet-section="kit" aria-label="Kit">' +
      pullBtn('kit', '<span class="paper-kind">Kit</span>', 'Details') + body + '</section>';
  }

  function pDamagePart(data) {
    var d = damageLists(data);
    var line = function (label, list) {
      return '<div class="sh-line"><span class="sh-k" style="display:inline">' + label + '</span> ' + (list.length ? esc(list.join(' · ')) : 'None') + '</div>';
    };
    return '<section class="sh-sec paper-pull sh-o4" data-sheet-section="damage" aria-label="Damage">' +
      pullBtn('damage', '<span class="paper-kind">Damage</span>', 'Sources') +
      line('Immunities', d.imm) + line('Weaknesses', d.weak) + (d.status.length ? line('Condition immunities', d.status) : '') + '</section>';
  }

  // Progression values are shown as the sheet has them; "–" when unset.
  var PROGRESS_KEYS = [['Victories', 'victories'], ['XP', 'xp'], ['Renown', 'renown'], ['Wealth', 'wealth']];
  function progValue(data, key) {
    var v = f(data, key, null);
    return (v == null || v === '') ? '–' : esc(String(v));
  }
  function pProgPart(data) {
    var cells = '<div><span class="sh-k">Level</span><b>' + num(data, 'level', 1) + '</b></div>' + PROGRESS_KEYS.map(function (p) {
      var attr = (p[1] === 'victories' || p[1] === 'xp') ? ' data-pv="' + p[1] + '"' : '';
      return '<div><span class="sh-k">' + p[0] + '</span><b' + attr + '>' + progValue(data, p[1]) + '</b></div>';
    }).join('');
    return '<section class="sh-sec paper-pull sh-o5" data-sheet-section="progression" aria-label="Progression">' +
      pullBtn('progression', '<span class="paper-kind">Progression</span>', 'Details') + '<div class="sh-dl">' + cells + '</div></section>';
  }

  function pFoot() {
    return '<footer class="sh-foot"><span><span class="only-paper">Tap any section to pull out the paper behind it.</span>' +
      '<span class="only-modern">Select any section to open its panel.</span></span><span>Synced with Foundry</span></footer>';
  }

  // ── Panels (the papers pulled out from behind a part) ──────────────────────

  function glossaryEntry(slug) {
    return (refRenderer && refRenderer.getEntry) ? refRenderer.getEntry(slug) : null;
  }
  // One rules entry from the package glossary; empty when the glossary has no
  // such term, so a missing entry never leaves a blank heading.
  function pRule(entry, on) {
    if (!entry) return '';
    return '<div class="rule' + (on ? ' on' : '') + '"><b>' + esc(entry.name || entry.slug || '') +
      (on ? ' <span class="sh-on">on now</span>' : '') + '</b><p>' + refText(entry.description || '') + '</p></div>';
  }
  function pRuleGroup(label, slugs, on) {
    var rules = slugs.map(function (s) { return pRule(glossaryEntry(s), on); }).join('');
    return rules ? '<div class="lf-grp"><span class="sh-k">' + esc(label) + '</span>' + rules + '</div>' : '';
  }

  function pTurnPanel(data) {
    var conds = parseJson(f(data, 'conditions_json', ''), []);
    var onNow = (Array.isArray(conds) ? conds : []).map(function (c) {
      return slugify(humanizeId((c && (c.name || c)) || ''));
    }).filter(Boolean);
    var html = pRuleGroup('On ' + firstName(data.name) + ' now', onNow, true) +
      pRuleGroup('Stamina', ['winded', 'dying', 'temporary-stamina']) +
      pRuleGroup('On your turn', ['catch-breath', 'recovery', 'save-ends', 'potency']);
    return html || pEmpty('The rules glossary has not loaded.');
  }

  function pTreasure(t) {
    var name = esc((t && t.name) || 'Treasure');
    var ech = (t && t.echelon) ? ' <span class="sh-lvl">E' + esc(String(t.echelon)) + '</span>' : '';
    var qN = Number(t && t.quantity);
    var qty = (qN > 1) ? ' <span class="sh-q">×' + qN + '</span>' : '';
    var kws = (Array.isArray(t && t.keywords) && t.keywords.length)
      ? '<p class="sh-sub">' + t.keywords.map(function (k) { return esc(String(k)); }).join(' · ') + '</p>' : '';
    var desc = cleanFoundryText(t && t.description);
    if (!desc && !kws) return '<div class="ft ft-flat">' + name + ech + qty + '</div>';
    return foldHtml('', name + ech + qty, kws + (desc ? '<p>' + refSynced(desc) + '</p>' : ''), false);
  }
  function pTreasureGroups(list) {
    var buckets = {};
    list.forEach(function (t) { var c = String((t && t.category) || 'other').toLowerCase(); (buckets[c] = buckets[c] || []).push(t); });
    var grp = function (label, b) { return '<div class="lf-grp"><span class="sh-k">' + esc(label) + '</span>' + b.map(pTreasure).join('') + '</div>'; };
    var html = TREASURE_CATS.map(function (c) { return buckets[c.key] && buckets[c.key].length ? grp(c.label, buckets[c.key]) : ''; }).join('');
    Object.keys(buckets).forEach(function (k) {
      if (!TREASURE_CATS.some(function (c) { return c.key === k; })) html += grp(humanizeId(k), buckets[k]);
    });
    return html;
  }

  function pItemRow(it, cid) {
    var entity = it.entity || it;
    var name = esc(entity.name || 'Item');
    var href = (entity.id && cid) ? '/campaigns/' + cid + '/entities/' + entity.id : '';
    var label = href ? '<a class="sh-link" href="' + escAttr(href) + '">' + name + '</a>' : name;
    var qty = (it.metadata && it.metadata.quantity) ? ' <span class="sh-q num">× ' + esc(String(it.metadata.quantity)) + '</span>' : '';
    var equipped = (it.metadata && it.metadata.equipped) ? '<span class="sh-chip">equipped</span>' : '';
    return '<li class="it-li"><div class="it-row"><span>' + label + qty + '</span>' + equipped + '</div></li>';
  }

  function pItemsPanel(data) {
    var treasures = treasureList(data);
    var items = invItems(data);
    var html = '';
    if (treasures.length) html += pTreasureGroups(treasures);
    if (items.length) html += '<ul class="lf-list">' + items.map(function (it) { return pItemRow(it, data.campaignId); }).join('') + '</ul>';
    if (!html) html = pEmpty('Nothing carried yet.');
    var wealth = f(data, 'wealth', null);
    return html + (wealth != null
      ? '<div class="lf-money"><span>Wealth <b class="num">' + esc(String(wealth)) + '</b></span><small>Draw Steel uses Wealth instead of coins.</small></div>' : '');
  }

  function pFeatureFold(ft) {
    var name = esc((ft && ft.name) || 'Feature');
    var lvl = (ft && ft.level) ? ' <span class="sh-lvl">L' + esc(String(ft.level)) + '</span>' : '';
    var desc = cleanFoundryText(ft && ft.description);
    if (!desc) return '<div class="ft ft-flat">' + name + lvl + '</div>';
    return foldHtml('', name + lvl, '<p>' + refSynced(desc) + '</p>', false);
  }
  function pFeatureGroup(label, list) {
    if (!list || !list.length) return '';
    return '<div class="lf-grp"><span class="sh-k">' + esc(label) + '</span>' + list.map(pFeatureFold).join('') + '</div>';
  }

  function pFeaturesPanel(data) {
    var feats = parseJson(f(data, 'features_json', ''), []);
    var extra = pFeatureGroup('Perks', parseJson(f(data, 'perks_json', ''), [])) +
      pFeatureGroup('Titles', parseJson(f(data, 'titles_json', ''), []));
    if (Array.isArray(feats) && feats.length) {
      var origins = FEATURE_ORIGINS.map(function (o) {
        var nm = f(data, o.field, '');
        return { key: o.key, lname: String(nm).toLowerCase(), slug: slugify(nm) };
      }).filter(function (o) { return o.lname; });
      var buckets = {};
      feats.forEach(function (ft) { var g = classifyFeature(ft, origins); (buckets[g] = buckets[g] || []).push(ft); });
      var placed = FEATURE_GROUP_ORDER.filter(function (k) { return k !== 'other' && buckets[k]; });
      // With nothing placed, one flat list is more honest than a lone "Features" group.
      if (!placed.length) return pFeatureGroup('Features', feats) + extra;
      return FEATURE_GROUP_ORDER.map(function (k) { return pFeatureGroup(FEATURE_GROUP_LABELS[k], buckets[k]); }).join('') + extra;
    }
    return extra || pEmpty('No features yet.');
  }

  function skillTipAttr(id) {
    var d = skillDefs && skillDefs[String(id).toLowerCase()];
    return (d && d.description) ? ' data-tip="' + escAttr(d.description) + '" tabindex="0"' : '';
  }
  function pSkillsPanel(data) {
    var sl = skillLists(data);
    var html = '';
    if (sl.skills.length) {
      var buckets = {};
      sl.skills.forEach(function (s) {
        var id = String(s == null ? '' : s);
        (buckets[SKILL_TO_GROUP[id.toLowerCase()] || 'other'] = buckets[SKILL_TO_GROUP[id.toLowerCase()] || 'other'] || []).push(id);
      });
      var grp = function (label, list) {
        if (!list || !list.length) return '';
        return '<div class="lf-grp"><span class="sh-k">' + esc(label) + '</span><div class="skills">' +
          list.map(function (id) { return '<span class="sh-chip"' + skillTipAttr(id) + '>' + esc(humanizeId(id)) + '</span>'; }).join('') + '</div></div>';
      };
      html += SKILL_GROUPS.map(function (g) { return grp(g.label, buckets[g.key]); }).join('') + grp('Other', buckets.other);
    }
    if (sl.langs.length) {
      html += '<div class="lf-grp"><span class="sh-k">Languages</span><div class="skills">' +
        sl.langs.map(function (l) { return '<span class="sh-chip">' + esc(humanizeId(l)) + '</span>'; }).join('') + '</div></div>';
    }
    return html || pEmpty('No trained skills.');
  }

  function pNotesPanel(data) {
    var notes = f(data, 'backstory', '') || f(data, 'notes', '');
    var out = '<div class="lf-grp"><span class="sh-k">Background</span>' + (notes
      ? '<p class="lf-text">' + esc(teaser(cleanFoundryText(notes), 180)) + '</p>' +
        '<button type="button" class="sh-link" data-cs-read-story aria-expanded="false">Read full story</button>'
      : pEmpty('No backstory yet.')) + '</div>';
    if (data.isGm) {
      var gm = f(data, 'gm_notes', '');
      out += foldHtml('lf-grp', 'GM lore <span class="sh-seal">GM only</span>', gm ? '<p class="lore">' + refText(gm) + '</p>' : pEmpty('No GM notes.'), false);
    }
    return out;
  }

  function pKitPanel(data) {
    var k = kitFacts(data);
    if (!k.name && !k.grid && !k.chips.length) return pEmpty('No kit equipped.');
    return '<div class="lf-grp"><span class="sh-k">Kit</span><div class="sh-kit-name" style="font-size:19px">' + esc(k.name || 'Kit') + '</div></div>' +
      (k.grid || k.chips.length
        ? '<div class="lf-grp"><span class="sh-k">Bonuses</span>' + k.grid + (k.chips.length ? '<div class="sh-line" style="margin-top:8px">' + k.chips.join('') + '</div>' : '') + '</div>'
        : pEmpty('No kit details synced.'));
  }

  function pDamagePanel(data) {
    var d = damageLists(data);
    var grp = function (label, list) {
      return '<div class="lf-grp"><span class="sh-k">' + label + '</span>' +
        (list.length ? list.map(function (x) { return '<div class="rule dmg"><b>' + esc(x) + '</b></div>'; }).join('') : pEmpty('None.')) + '</div>';
    };
    return grp('Immunities', d.imm) + grp('Weaknesses', d.weak) + (d.status.length ? grp('Condition immunities', d.status) : '') +
      pRuleGroup('How it works', ['damage-immunity', 'damage-weakness']) + pEmpty('Read only. Set in Foundry.');
  }

  function pProgPanel(data) {
    var row = function (label, html) { return '<div class="lf-money"><span>' + label + ' <b class="num">' + html + '</b></span></div>'; };
    return '<div class="lf-grp"><span class="sh-k">Now</span>' + row('Level', String(num(data, 'level', 1))) +
      PROGRESS_KEYS.map(function (p) { return row(p[0], progValue(data, p[1])); }).join('') +
      '</div>' + pEmpty('Read only. Set in Foundry.');
  }

  // Every panel the sheet can open, in ledger order. Items and Notes exist
  // only when their part does.
  function paperPanels(data) {
    var name = data.name || 'Unnamed Hero';
    var list = [
      { id: 'turn', title: 'Rules at hand', kind: 'This turn', html: pTurnPanel(data) },
      { id: 'abilities', title: 'Abilities', kind: name, html: parseAbilities(data).length ? rAbilities({}, data) : pEmpty('No abilities yet.') },
      { id: 'kit', title: 'Kit', kind: name, html: pKitPanel(data) },
      { id: 'damage', title: 'Damage', kind: name, html: pDamagePanel(data) },
      { id: 'progression', title: 'Progression', kind: name, html: pProgPanel(data) }
    ];
    if (!data.armoryItems) list.push({ id: 'items', title: 'Items', kind: name, html: pItemsPanel(data) });
    list.push({ id: 'features', title: 'Features', kind: name, html: pFeaturesPanel(data) });
    list.push({ id: 'skills', title: 'Skills', kind: name, html: pSkillsPanel(data) });
    if (data.isGm || data.isOwner) list.push({ id: 'notes', title: 'Notes', kind: name, html: pNotesPanel(data) });
    return list;
  }

  function paperSheetHtml(data) {
    var name = data.name || 'Unnamed Hero';
    var templates = paperPanels(data).map(function (p) {
      return '<template data-sheet-panel="' + p.id + '" data-title="' + escAttr(p.title) + '" data-kind="' + escAttr(p.kind) + '">' + p.html + '</template>';
    }).join('');
    var sheet = '<article class="paper sh-sheet" aria-label="' + escAttr(name + "'s sheet") + '">' +
      pHead(data) + pIdentity(data) + pTurn(data) +
      '<div class="sh-body"><div class="sh-col">' + pCharacteristics(data) + pAbilityBand(data) + paperLedger(data) + '</div>' +
      '<div class="sh-col">' + pKitPart(data) + pDamagePart(data) + pProgPart(data) + '</div></div>' + pFoot() + '</article>';
    return '<div class="sh-root" data-sheet>' +
      '<div class="sh-settle paper-settle" data-move="settle"><div class="sh-folio" data-sheet-folio><div class="paper-stack sh-stack">' + sheet + '</div></div></div>' +
      templates + '</div>';
  }

  // ── Paper interactions ─────────────────────────────────────────────────────

  // The longest transition on an element, so a pin is removed only after its
  // own move has played (Calm and Off already shorten or remove it in CSS).
  function transitionMs(node) {
    var cs = getComputedStyle(node), d = cs.transitionDuration.split(','), l = cs.transitionDelay.split(','), m = 0;
    function ms(x) { x = String(x).trim(); return (parseFloat(x) || 0) * (/ms$/.test(x) ? 1 : 1000); }
    d.forEach(function (x, i) { m = Math.max(m, ms(x) + ms(l[i % l.length])); });
    return m;
  }

  // A pin is a slip tacked onto the open panel. Chronicle styles it
  // (.paper-pin) and moves it by toggling .is-pinned; the engine has no
  // call for it, so the widget places and removes it.
  function unpin(inst, focus) {
    var p = inst._pin;
    if (!p) return;
    inst._pin = null;
    p.el.classList.remove('is-pinned');
    p.trigger.setAttribute('aria-expanded', 'false');
    if (focus && p.trigger.isConnected && p.trigger.focus) p.trigger.focus({ preventScroll: true });
    setTimeout(function () { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); }, transitionMs(p.el) + 20);
  }

  function storyPinHtml(data) {
    var title = (data.name || 'Background') + '’s story';
    var prose = cleanFoundryProse(f(data, 'backstory', '') || f(data, 'notes', ''));
    var paras = prose.split(/\n{2,}/).filter(Boolean).map(function (p) { return '<p>' + refSynced(p) + '</p>'; }).join('');
    return '<span class="pin" aria-hidden="true"></span><div class="slip-in"><div class="slip-head"><h3 tabindex="-1">' + esc(title) + '</h3>' +
      '<button type="button" class="unpin" data-unpin aria-label="' + escAttr('Unpin ' + title) + '">' + fa('xmark') + ' Unpin</button></div>' + paras + '</div>';
  }

  function openStoryPin(inst, trigger, data) {
    var body = trigger.closest ? trigger.closest('.paper-dbody') : null;
    if (!body) return;
    if (inst._pin && inst._pin.trigger === trigger) { unpin(inst, true); return; }
    unpin(inst, false);
    var el = document.createElement('div');
    el.className = 'paper-pin' + ((inst._pinFlip = (inst._pinFlip || 0) + 1) % 2 ? '' : ' alt');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', (data.name || 'Background') + '’s story');
    el.innerHTML = storyPinHtml(data);
    var br = body.getBoundingClientRect(), tr = trigger.getBoundingClientRect();
    el.style.top = (tr.bottom - br.top + body.scrollTop + 8) + 'px';
    body.appendChild(el);
    el.style.setProperty('--ox', Math.round(tr.left + tr.width / 2 - el.getBoundingClientRect().left) + 'px');
    el.style.setProperty('--oy', '0px');
    void el.offsetWidth;
    el.classList.add('is-pinned');
    trigger.setAttribute('aria-expanded', 'true');
    inst._pin = { el: el, trigger: trigger };
    setTimeout(function () {
      var h = el.querySelector('h3');
      if (h) h.focus({ preventScroll: true });
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }, 40);
  }

  // The panel body is a fresh clone each time a panel opens, so anything
  // interactive inside it is wired from sheet:panel-ready, never at mount.
  function attachPaperPanels(inst, el, root) {
    inst._onPanelReady = function (e) {
      var d = e.detail || {};
      inst._pin = null;
      inst._panelBody = d.body || null;
      if (d.id === 'abilities' && inst._selectFirst) inst._selectFirst();
    };
    inst._onPanelClose = function () { inst._pin = null; inst._panelBody = null; };
    root.addEventListener('sheet:panel-ready', inst._onPanelReady);
    root.addEventListener('sheet:close', inst._onPanelClose);

    // Escape steps back one layer at a time (pin, then an expanded ability
    // card, then the panel). The engine closes the panel on Escape, so this
    // listens first, in the capture phase, and stops the event when it has
    // a smaller layer to put away.
    inst._onPaperKey = function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (inst._pin) { e.preventDefault(); e.stopPropagation(); unpin(inst, true); return; }
      var big = inst._panelBody && inst._panelBody.querySelector ? inst._panelBody.querySelector('[data-ds-collapse]') : null;
      if (big && inst._collapse) { e.preventDefault(); e.stopPropagation(); inst._collapse(parseInt(big.getAttribute('data-ds-collapse'), 10)); }
    };
    el.addEventListener('keydown', inst._onPaperKey, true);
  }

  // Grow is the contract's move for something drawn out of the thing pressed:
  // the style supplies the look, Calm and Off are enforced by Chronicle.
  function growIn(node) {
    if (!node) return;
    node.setAttribute('data-move', 'grow');
    void node.offsetWidth;
    node.classList.add('is-open');
  }

  function mountPaper(inst, el, data) {
    var sm = Chronicle.sheetMotion;
    if (el._csSurfaceCleanup) { try { el._csSurfaceCleanup(); } catch (e) {} el._csSurfaceCleanup = null; }
    inst._paper = true;
    el.innerHTML = paperSheetHtml(data);
    appendBlockSlots(el, data);
    var root = el.querySelector('[data-sheet]');
    if (typeof sm.rescan === 'function') sm.rescan();
    if (root) sm.mount(root);
    attachInteractions(inst, el, data);
    if (root) attachPaperPanels(inst, el, root);
    attachTooltips(inst, el);
  }


  function mountSheet(inst, el, data) {
    inst._paper = false;
    if (paperAvailable()) { mountPaper(inst, el, data); return; }
    // The dynamic-surface frame is a core widget loaded before system widgets,
    // so this is belt-and-suspenders — degrade gracefully rather than throw if
    // it is somehow absent.
    if (!Chronicle.surface || !Chronicle.surface.mount) {
      renderError(el, 'Dynamic surface unavailable.');
      return;
    }
    if (el._csSurfaceCleanup) { try { el._csSurfaceCleanup(); } catch (e) {} el._csSurfaceCleanup = null; }
    el.innerHTML = '';
    Chronicle.surface.mount(el, buildSchema(data));
    appendBlockSlots(el, data);
    attachInteractions(inst, el, data);
    attachTooltips(inst, el);
    playEntrance(el);
  }

  // ── API fetch fallback (embed without data attributes) ───

  function fetchEntity(cid, eid) {
    var url = '/api/v1/campaigns/' + encodeURIComponent(cid) + '/entities/' + encodeURIComponent(eid);
    return Chronicle.apiFetch(url).then(function (res) {
      if (!res.ok) {
        return res.json().then(
          function (b) { throw new Error((b && b.message) ? b.message : 'Could not load character.'); },
          function () { throw new Error('Could not load character.'); }
        );
      }
      return res.json();
    });
  }

  function renderError(el, message) {
    el.innerHTML = '<div class="cs-empty">' +
      '<div class="cs-empty-icon">&#9888;</div>' +
      '<div class="cs-empty-title">Character unavailable</div>' +
      '<div class="cs-empty-desc">' + esc(message) + '</div>' +
    '</div>';
  }

  // ── styles ─────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('ds-character-sheet-styles')) return;
    var css = [
      // ── Base (the frame's .cs-surface owns layout; we only set type/color) ──
      '.ds-sheet { font-family:Inter,system-ui,-apple-system,sans-serif; font-size:14px; color:var(--color-text-primary,#111827); }',
      // Sheet ACCENT (the "highlight"). Scoped to the sheet and driven by an
      // overridable var so an owner-page setting can recolor it by setting
      // --ds-accent / --ds-accent-rgb on .ds-sheet — no CSS change needed.
      // Default = violet.
      '.ds-sheet { --color-accent: var(--ds-accent, #a855f7); --color-accent-rgb: var(--ds-accent-rgb, 168,85,247); }',
      // Vitals composite: stamina/recoveries/HR/roll on the left, the
      // characteristics grid on the right (stacks on narrow widths).
      '.cs-subhead { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-text-muted,#9ca3af); margin-bottom:8px; }',
      '.cs-statline { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:12px; }',
      '.cs-statline-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-dots, .cs-hr-pips { letter-spacing:2px; font-size:13px; color:var(--color-accent,#a855f7); }',
      '.cs-pips-count { margin-left:8px; font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); letter-spacing:normal; font-variant-numeric:tabular-nums; }',
      '.cs-pips-empty { color:var(--color-text-muted,#9ca3af); }',
      '.cs-box[data-box-pinned] .cs-box__caret { display:none; }',
      '.cs-box[data-box-pinned] .cs-box__toggle { cursor:default; }',
      // v3.2 dynamic affordance: collapsible boxes read as clickable (DDB-style).
      // A subtle accent lift on hover + a pointer/clickable head signal "open me";
      // pinned boxes (always-open) are exempt. Purely additive over the frame chrome.
      '.cs-box:not([data-box-pinned]) { transition:box-shadow 160ms ease, border-color 160ms ease; }',
      '.cs-box:not([data-box-pinned]):hover { box-shadow:0 2px 16px rgba(var(--color-accent-rgb,168,85,247),0.10); border-color:rgba(var(--color-accent-rgb,168,85,247),0.28); }',
      '.cs-box:not([data-box-pinned]) > .cs-box__head { cursor:pointer; transition:background 140ms ease; }',
      '.cs-box:not([data-box-pinned]) > .cs-box__head:hover { background:rgba(var(--color-accent-rgb,168,85,247),0.05); }',
      '.cs-box:not([data-box-pinned]) > .cs-box__head:hover .cs-box__caret { color:var(--color-accent,#a855f7); }',
      '.cs-box__caret { transition:transform 200ms cubic-bezier(.4,0,.2,1), color 140ms ease; }',
      '.cs-ability-row:active { transform:translateY(0.5px); }',
      '.cs-level-badge { display:inline-flex; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:600; background:var(--color-accent,#6366f1); color:#fff; }',
      // ── Identity band (headless pinned box) ──
      '.cs-box[data-box-key="ds-identity"] > .cs-box__head { display:none; }',
      '.cs-box[data-box-key="ds-identity"] > .cs-box__body { padding:16px 16px 22px; }',
      '.cs-id { display:flex; gap:18px; align-items:flex-start; }',
      '.cs-port { position:relative; flex:none; width:96px; }',
      '.cs-portrait { display:block; width:96px; height:96px; border-radius:12px; object-fit:cover; box-sizing:border-box; border:2px solid var(--color-border,#e5e7eb); background:var(--color-bg-tertiary,#f3f4f6); }',
      '.cs-portrait-placeholder { display:flex; align-items:center; justify-content:center; color:var(--color-text-muted,#9ca3af); font-size:32px; }',
      '.cs-port-chip { position:absolute; left:50%; bottom:-10px; transform:translateX(-50%); display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 10px; border-radius:9999px; border:1px solid var(--color-border,#e5e7eb); background:var(--color-card-bg,#fff); color:var(--color-text-primary,#111827); font:inherit; font-size:11.5px; font-weight:600; white-space:nowrap; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.12); }',
      '.cs-port-chip:hover, .cs-port-chip:focus-visible { border-color:var(--color-accent,#a855f7); color:var(--color-accent,#a855f7); outline:none; }',
      '.cs-id-main { flex:1; min-width:0; }',
      '.cs-id-orig { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px 12px; }',
      '.cs-id-slot { min-width:0; display:flex; flex-direction:column; align-items:flex-start; }',
      '.cs-id-k { display:block; font-size:10px; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:var(--color-text-muted,#9ca3af); }',
      '.cs-id-val { font-size:14px; font-weight:600; color:var(--color-text-primary,#111827); padding:3px 0; overflow-wrap:anywhere; }',
      '.cs-id-unset { font-weight:500; color:var(--color-text-muted,#9ca3af); }',
      '.cs-id-pick { display:inline-flex; align-items:center; gap:6px; max-width:100%; margin-left:-6px; padding:3px 6px; border:1px solid transparent; border-radius:7px; background:transparent; color:var(--color-text-primary,#111827); font:inherit; font-size:14px; font-weight:600; text-align:left; cursor:pointer; }',
      '.cs-id-pick:hover, .cs-id-pick[aria-expanded="true"] { background:rgba(var(--color-accent-rgb,168,85,247),0.12); border-color:rgba(var(--color-accent-rgb,168,85,247),0.35); color:var(--color-accent,#a855f7); }',
      '.cs-id-pick:focus-visible { outline:2px solid var(--color-accent,#a855f7); outline-offset:2px; background:rgba(var(--color-accent-rgb,168,85,247),0.12); }',
      '.cs-id-chev { flex:none; width:6px; height:6px; margin:-3px 2px 0 0; border-right:2px solid currentColor; border-bottom:2px solid currentColor; transform:rotate(45deg); opacity:0.55; }',
      '.cs-id-pick:hover .cs-id-chev, .cs-id-pick:focus-visible .cs-id-chev, .cs-id-pick[aria-expanded="true"] .cs-id-chev { opacity:1; }',
      '.cs-id-fixed { display:flex; flex-wrap:wrap; align-items:center; gap:6px 18px; margin-top:12px; padding-top:10px; border-top:1px solid var(--color-border-light,var(--color-border,#e5e7eb)); }',
      '.cs-id-ro { display:inline-flex; align-items:baseline; gap:7px; }',
      '.cs-id-ro .cs-id-val { padding:0; }',
      '.cs-id-hint { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--color-text-muted,#9ca3af); }',
      '.cs-id-fold:empty { display:none; }',
      '.cs-id-fold { margin:4px 16px 14px; }',
      '@keyframes ag-land-fallback { 0% { background:rgba(var(--color-accent-rgb,168,85,247),0.28); } 100% { background:transparent; } }',
      '.cs-id .ag-landed { animation:ag-land-fallback 1.1s ease-out; border-radius:6px; }',
      // ── Vitals strip + characteristics ──
      '.cs-vitals { display:grid; grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr)); gap:14px 22px; align-items:start; }',
      '.cs-vit { display:flex; flex-direction:column; gap:6px; min-width:0; }',
      '.cs-vit-v { font-size:18px; font-weight:700; color:var(--color-text-primary,#111827); font-variant-numeric:tabular-nums; line-height:1.1; }',
      '.cs-vit-v small { font-size:12px; font-weight:600; color:var(--color-text-muted,#9ca3af); margin-left:3px; }',
      '.cs-vit .cs-dots { letter-spacing:1px; font-size:11px; }',
      '.cs-box[data-box-key="ds-characteristics"] .cs-stat-row { gap:8px; }',
      '.cs-box[data-box-key="ds-characteristics"] .cs-stat { padding:11px 3px; }',
      '.cs-box[data-box-key="ds-characteristics"] .cs-stat-label { font-size:10px; }',
      '.cs-box[data-box-key="ds-characteristics"] .cs-stat-value { font-size:22px; }',
      // ── Ability tabs ──
      '.ds-tabs { display:flex; flex-wrap:wrap; gap:2px; padding:3px; border-radius:9px; background:var(--color-bg-tertiary,#f3f4f6); width:max-content; max-width:100%; margin-bottom:12px; }',
      '.ds-tab { display:inline-flex; align-items:center; gap:6px; border:0; border-radius:7px; padding:5px 12px; background:transparent; color:var(--color-text-secondary,#6b7280); font:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:background 120ms ease, color 120ms ease; }',
      '.ds-tab:focus-visible { outline:2px solid var(--color-accent,#a855f7); outline-offset:1px; }',
      '.ds-tab--on { background:var(--color-card-bg,#fff); color:var(--color-text-primary,#111827); box-shadow:0 1px 2px rgba(0,0,0,0.14); }',
      '.ds-tab em { font-style:normal; font-size:11px; color:var(--color-text-muted,#9ca3af); font-variant-numeric:tabular-nums; }',
      '.ds-ab-grp--off { display:none; }',
      // The frame's columns wrap by min-width; below this width force a single
      // column in DOM order so the phone order never depends on wrapping.
      '@media (max-width:1000px) {',
      '  .ds-sheet .cs-row { flex-direction:column; }',
      '  .ds-sheet .cs-row > .cs-col { flex:none !important; width:100%; }',
      '}',
      '@media (max-width:760px) { .cs-id-orig { grid-template-columns:repeat(2,minmax(0,1fr)); } }',
      '@media (max-width:640px) {',
      '  .cs-vitals { grid-template-columns:repeat(3,minmax(0,1fr)); }',
      '  .cs-vitals .cs-vit:first-child { grid-column:1 / -1; }',
      '}',
      '@media (max-width:480px) {',
      '  .cs-id { flex-direction:column; align-items:stretch; gap:20px; }',
      '  .cs-port, .cs-portrait { width:72px; }',
      '  .cs-portrait { height:72px; }',
      '}',
      // ── Bars (stamina, heroic resource) ──
      '.cs-bar-wrap { display:flex; flex-direction:column; gap:4px; }',
      '.cs-bar-label { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; font-weight:600; color:var(--color-text-body,#374151); }',
      '.cs-bar-value { font-variant-numeric:tabular-nums; color:var(--color-text-primary,#111827); }',
      '.cs-bar { position:relative; height:10px; background:var(--color-bg-tertiary,#f3f4f6); border-radius:9999px; overflow:hidden; }',
      '.cs-bar-fill { height:100%; background:linear-gradient(90deg,#059669,#10b981); border-radius:9999px; transition:width 200ms ease; }',
      '.cs-bar-fill.cs-bar-danger { background:#dc2626; }',
      '.cs-bar-fill.cs-bar-accent { background:var(--color-accent,#6366f1); }',
      '.cs-bar-threshold { position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--color-text-muted,#9ca3af); }',
      '.cs-bar-sub { font-size:11px; color:var(--color-text-muted,#9ca3af); }',
      // ── Chips ──
      '.cs-chip-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }',
      '.cs-chip-row:first-child { margin-top:0; }',
      '.cs-chip { display:inline-flex; flex-direction:column; padding:6px 10px; border-radius:8px; background:var(--color-bg-tertiary,#f3f4f6); min-width:0; }',
      '.cs-chip-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-chip-value { font-size:14px; font-weight:600; color:var(--color-text-primary,#111827); font-variant-numeric:tabular-nums; }',
      '.cs-chip-pill { display:inline-flex; flex-direction:row; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:rgba(var(--color-accent-rgb,99,102,241),0.1); color:var(--color-accent,#6366f1); }',
      '.cs-chip-warn { background:rgba(239,68,68,0.1); color:#b91c1c; }',
      // ── Characteristics ──
      '.cs-stat-row { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; }',
      '.cs-stat { display:flex; flex-direction:column; align-items:center; gap:4px; padding:9px 3px; border-radius:9px; border:1px solid var(--color-border-light,#f3f4f6); background:var(--color-bg-primary,#f9fafb); }',
      '.cs-stat-label { font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:0.01em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-stat-value { font-size:19px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }',
      '.cs-stat-positive .cs-stat-value { color:#047857; }',
      '.cs-stat-negative .cs-stat-value { color:#b91c1c; }',
      '.cs-stat-zero .cs-stat-value { color:var(--color-text-secondary,#6b7280); }',
      // ── Damage ──
      '.cs-damage-row { display:flex; gap:10px; align-items:flex-start; padding:6px 0; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-damage-row:last-child { border-bottom:none; }',
      '.cs-damage-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); width:100px; flex-shrink:0; padding-top:4px; }',
      '.cs-damage-list { display:flex; flex-wrap:wrap; gap:6px; flex:1; }',
      // ── Abilities: bare "Option D" master–detail (monochrome + one violet accent) ──
      '.ds-md { display:flex; gap:14px; align-items:flex-start; }',
      // master rail — a plain grouped list
      // capped scroll area so a long list (a full kit + every universal maneuver)
      // never shoves the detail pane down; x hidden, y auto.
      '.ds-rail { flex:0 0 218px; min-width:0; border:1px solid var(--color-border,#e5e7eb); border-radius:11px; overflow:hidden auto; max-height:none; background:var(--color-bg-primary,#f9fafb); }',
      // sticky filter (long lists only) — type to narrow the rows.
      '.ds-rail__tools { position:sticky; top:0; z-index:2; padding:8px; background:var(--color-bg-primary,#f9fafb); border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-rail__filter { width:100%; box-sizing:border-box; padding:6px 9px; border:1px solid var(--color-border,#e5e7eb); border-radius:7px; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-primary,#111827); font:inherit; font-size:12.5px; }',
      '.ds-rail__filter::placeholder { color:var(--color-text-muted,#9ca3af); }',
      '.ds-rail__filter:focus { outline:none; border-color:var(--color-accent,#a855f7); box-shadow:0 0 0 2px rgba(var(--color-accent-rgb,168,85,247),0.18); }',
      '.ds-rail__empty { padding:14px; text-align:center; font-size:12px; color:var(--color-text-muted,#9ca3af); }',
      // Group label is a collapse toggle button (caret + label + count). Given
      // a background/radius/heavier weight so it reads as a distinct SECTION
      // header rather than another row in the list.
      // the chevron itself is the "collapsible" affordance — sized and colored to
      // read as a control, not decorative text.
      // while filtering, force groups open so a match in a collapsed group shows;
      // rows that do not match and groups with zero matches are hidden.
      '.ds-ab-grp--filtering .ds-ab-grp__rows { display:block; }',
      '.ds-li--hidden { display:none; }',
      '.ds-ab-grp--empty { display:none; }',
      '.ds-li { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 13px; background:none; border:0; border-top:1px solid var(--color-border-light,#f3f4f6); font:inherit; font-size:13px; color:var(--color-text-secondary,#6b7280); cursor:pointer; transition:background 120ms ease, color 120ms ease; }',
      '.ds-li:hover { background:rgba(var(--color-accent-rgb,168,85,247),0.05); color:var(--color-text-primary,#111827); }',
      '.ds-li:focus-visible { outline:2px solid var(--color-accent,#a855f7); outline-offset:-2px; }',
      '.ds-li__nm { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '.ds-li__c { margin-left:auto; flex:none; font-weight:600; font-size:12px; color:var(--color-text-muted,#9ca3af); font-variant-numeric:tabular-nums; }',
      '.ds-li--sel { color:var(--color-text-primary,#111827); font-weight:600; background:rgba(var(--color-accent-rgb,168,85,247),0.09); box-shadow:inset 2px 0 0 var(--color-accent,#a855f7); }',
      '.ds-li--sel .ds-li__c { color:var(--color-accent,#a855f7); }',
      '.ds-li--dim { color:var(--color-text-muted,#9ca3af); }',
      // detail pane
      '.ds-pane { flex:1; min-width:0; }',
      '.ds-pane__empty { border:1px dashed var(--color-border,#e5e7eb); border-radius:11px; padding:38px 20px; text-align:center; color:var(--color-text-muted,#9ca3af); }',
      '.ds-pane__empty-t { font-weight:700; font-size:14px; color:var(--color-text-secondary,#6b7280); margin-bottom:3px; }',
      '.ds-pane__empty-d { font-size:12.5px; }',
      '.ds-muted { color:var(--color-text-muted,#9ca3af); }',
      // the small BARE card (narrow — addresses "too wide"; whole card clickable)
      '.ds-card { max-width:420px; border:1px solid var(--color-border,#e5e7eb); border-radius:11px; background:var(--color-bg-primary,#f9fafb); padding:11px 14px; cursor:pointer; transition:transform 160ms cubic-bezier(.4,0,.2,1), box-shadow 160ms ease, border-color 160ms ease; }',
      '.ds-card:hover, .ds-card:focus-visible { transform:translateY(-3px); box-shadow:0 14px 30px -14px rgba(var(--color-accent-rgb,168,85,247),0.5); border-color:rgba(var(--color-accent-rgb,168,85,247),0.5); outline:none; }',
      '.ds-card__h { display:flex; align-items:center; gap:8px; margin-bottom:7px; }',
      '.ds-card__nm { font-size:15px; font-weight:700; color:var(--color-text-primary,#111827); }',
      '.ds-card__sig { flex:none; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#fff; background:var(--color-accent,#a855f7); padding:2px 7px; border-radius:9999px; }',
      '.ds-card__cost { margin-left:auto; flex:none; font-size:11px; font-weight:600; color:var(--color-text-secondary,#6b7280); }',
      '.ds-tr { display:flex; gap:11px; padding:3px 0; font-size:13px; line-height:1.45; }',
      '.ds-tr__b { flex:none; min-width:46px; font-weight:700; color:var(--color-text-muted,#9ca3af); font-variant-numeric:tabular-nums; }',
      '.ds-tr__t { color:var(--color-text-body,#374151); }',
      '.ds-card__line { display:flex; gap:10px; padding:3px 0; font-size:13px; color:var(--color-text-body,#374151); }',
      '.ds-card__k { flex:none; min-width:74px; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-muted,#9ca3af); padding-top:2px; }',
      '.ds-card__eff { font-size:13px; line-height:1.5; color:var(--color-text-body,#374151); padding:3px 0; }',
      '.ds-card__hint { font-size:11px; font-weight:600; color:var(--color-accent,#a855f7); margin-top:7px; opacity:0; transition:opacity 150ms ease; }',
      '.ds-card:hover .ds-card__hint, .ds-card:focus-visible .ds-card__hint { opacity:0.9; }',
      // the grown BIG card — two sections, width-constrained
      '.ds-big { max-width:520px; border:1px solid rgba(var(--color-accent-rgb,168,85,247),0.4); border-radius:12px; overflow:hidden; background:var(--color-bg-primary,#f9fafb); box-shadow:0 18px 44px -26px rgba(var(--color-accent-rgb,168,85,247),0.55); }',
      '.ds-big__h { display:flex; align-items:center; gap:9px; padding:11px 15px; background:linear-gradient(90deg,var(--color-accent,#a855f7),#7c3aed); color:#fff; cursor:pointer; }',
      '.ds-big__h:hover .ds-big__x { opacity:1; transform:scale(1.08); }',
      '.ds-big__x { transition:opacity 140ms ease, transform 140ms ease; }',
      '.ds-big__nm { font-size:16px; font-weight:800; }',
      '.ds-big__meta { margin-left:auto; font-size:11px; font-weight:700; opacity:0.92; }',
      '.ds-big__x { flex:none; background:none; border:0; color:#fff; opacity:0.8; cursor:pointer; font:inherit; font-size:13px; line-height:1; padding:2px 0 2px 4px; }',
      '.ds-big__x:hover { opacity:1; }',
      '.ds-big__sec { font-size:9px; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:var(--color-text-muted,#9ca3af); background:var(--color-bg-tertiary,#f3f4f6); padding:7px 15px; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__sec--for { border-top:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__n { color:var(--color-accent,#a855f7); margin-right:5px; }',
      '.ds-big__kw { display:flex; flex-wrap:wrap; gap:6px; padding:10px 15px; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__kw span { font-size:9px; text-transform:uppercase; letter-spacing:0.03em; background:var(--color-bg-tertiary,#f3f4f6); border:1px solid var(--color-border-light,#f3f4f6); color:var(--color-text-secondary,#6b7280); padding:2px 8px; border-radius:9999px; }',
      '.ds-big__stats { display:flex; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__stat { flex:1; padding:8px 15px; border-right:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__stat:last-child { border-right:0; }',
      '.ds-big__sk { display:block; font-size:9px; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted,#9ca3af); }',
      '.ds-big__sv { display:block; font-weight:700; font-size:12.5px; color:var(--color-text-primary,#111827); margin-top:1px; }',
      '.ds-big__flavor { padding:9px 15px; font-size:12.5px; font-style:italic; line-height:1.5; color:var(--color-text-secondary,#6b7280); border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__ladder { display:flex; flex-direction:column; }',
      '.ds-big__tier { display:flex; gap:12px; align-items:flex-start; padding:8px 15px; font-size:13px; line-height:1.5; border-top:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__tier--t1 { box-shadow:inset 3px 0 0 rgba(var(--color-accent-rgb,168,85,247),0.35); }',
      '.ds-big__tier--t2 { box-shadow:inset 3px 0 0 rgba(var(--color-accent-rgb,168,85,247),0.6); }',
      '.ds-big__tier--t3 { box-shadow:inset 3px 0 0 var(--color-accent,#a855f7); }',
      '.ds-big__tb { flex:none; min-width:48px; font-weight:700; color:var(--color-text-muted,#9ca3af); font-variant-numeric:tabular-nums; }',
      '.ds-big__tt { color:var(--color-text-body,#374151); }',
      '.ds-big__block { padding:9px 15px; font-size:12.5px; line-height:1.5; color:var(--color-text-body,#374151); border-top:1px solid var(--color-border-light,#f3f4f6); }',
      '.ds-big__block-k { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-accent,#a855f7); margin-right:6px; }',
      // section ② — "For <hero>" computed odds
      '.ds-for { padding:11px 15px 14px; background:rgba(var(--color-accent-rgb,168,85,247),0.06); }',
      '.ds-for__roll { font-size:13px; color:var(--color-text-body,#374151); margin-bottom:9px; }',
      '.ds-for__roll b { color:var(--color-text-primary,#111827); }',
      '.ds-for__tier { font-weight:800; color:var(--color-accent,#a855f7); }',
      '.ds-for__bar { display:flex; height:9px; border-radius:9999px; overflow:hidden; background:var(--color-bg-tertiary,#f3f4f6); margin-bottom:7px; }',
      '.ds-for__bar i { display:block; height:100%; }',
      '.ds-for__o1 { background:rgba(var(--color-accent-rgb,168,85,247),0.32); }',
      '.ds-for__o2 { background:rgba(var(--color-accent-rgb,168,85,247),0.6); }',
      '.ds-for__o3 { background:var(--color-accent,#a855f7); }',
      '.ds-for__key { display:flex; gap:14px; font-size:11px; color:var(--color-text-secondary,#6b7280); }',
      '.ds-for__key b { color:var(--color-text-primary,#111827); }',
      '.ds-sw { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:5px; vertical-align:middle; }',
      '.ds-sw--1 { background:rgba(var(--color-accent-rgb,168,85,247),0.32); }',
      '.ds-sw--2 { background:rgba(var(--color-accent-rgb,168,85,247),0.6); }',
      '.ds-sw--3 { background:var(--color-accent,#a855f7); }',
      '.ds-for__sub { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-muted,#9ca3af); margin:10px 0 4px; }',
      // responsive — stack the rail above the pane; cards fill width (tap reveals below)
      '@media (max-width:680px) {',
      '  .ds-md { flex-direction:column; }',
      '  .ds-rail { flex:1 1 auto; width:100%; }',
      '  .ds-card, .ds-big { max-width:none; }',
      '}',
      // ── Tags ──
      '.cs-tag { display:inline-block; padding:1px 8px; border-radius:9999px; font-size:11px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.cs-tag-level { background:rgba(var(--color-accent-rgb,99,102,241),0.1); color:var(--color-accent,#6366f1); }',
      // ── Features ──
      '.cs-feature-group { margin-top:12px; }',
      '.cs-feature-group:first-child { margin-top:0; }',
      '.cs-feature-group-title { font-size:13px; font-weight:600; color:var(--color-text-secondary,#6b7280); margin:0 0 8px; text-transform:uppercase; letter-spacing:0.05em; }',
      '.cs-feature-list { display:flex; flex-direction:column; gap:8px; }',
      '.cs-feature { background:var(--color-bg-primary,#f9fafb); border:1px solid var(--color-border-light,#f3f4f6); border-radius:8px; padding:0; overflow:hidden; }',
      '.cs-feature-header { display:flex; align-items:center; gap:8px; margin-bottom:4px; }',
      '.cs-feature-name { font-weight:600; font-size:14px; }',
      '.cs-feature-source { font-size:12px; color:var(--color-text-muted,#9ca3af); margin-bottom:4px; }',
      '.cs-feature-desc { font-size:13px; line-height:1.55; color:var(--color-text-body,#374151); padding:0 12px 11px; max-height:260px; overflow-y:auto; }',
      // native <details> feature accordion — collapses a long feature list, no JS.
      '.cs-feature__sum { display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:pointer; list-style:none; }',
      '.cs-feature__sum::-webkit-details-marker { display:none; }',
      '.cs-feature__sum:hover { background:rgba(var(--color-accent-rgb,168,85,247),0.05); }',
      '.cs-feature__sum:focus-visible { outline:2px solid var(--color-accent,#a855f7); outline-offset:-2px; }',
      '.cs-feature__caret { margin-left:auto; font-size:9px; color:var(--color-text-muted,#9ca3af); transition:transform 160ms ease; }',
      '.cs-feature[open] .cs-feature__caret { transform:rotate(180deg); color:var(--color-accent,#a855f7); }',
      '.cs-feature--flat { padding:10px 12px; display:flex; align-items:center; gap:8px; }',
      // ── Inventory ──
      '.cs-inventory-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px; }',
      '.cs-inventory-item { padding:8px 10px; background:var(--color-bg-primary,#f9fafb); border-radius:6px; font-size:13px; }',
      '.cs-inventory-link { color:var(--color-accent,#6366f1); text-decoration:none; }',
      '.cs-inventory-link:hover { text-decoration:underline; }',
      // ── Background (teaser in the box) ──
      '.cs-bg__teaser { font-size:13px; line-height:1.6; color:var(--color-text-secondary,#6b7280); margin:0 0 10px; }',
      '.cs-bg__read { display:inline-flex; align-items:center; gap:5px; background:none; border:0; padding:0; cursor:pointer; font:inherit; font-size:13px; font-weight:600; color:var(--color-accent,#6366f1); }',
      '.cs-bg__read:hover { text-decoration:underline; }',
      // ── Background reading view (overlay) — typeset lore page, theme-aware ──
      '.cs-overlay__panel--reading { max-width:min(96vw,1080px); width:100%; max-height:94vh; min-height:min(88vh,600px); padding:44px clamp(24px,7vw,110px) 56px; background:radial-gradient(120% 80% at 50% 0%,#fbf7ee,#f1e9db); border:1px solid #e7ddc7; color:#2c271e; }',
      '.cs-overlay__panel--reading.cs-reading-dark { background:#16191f; border-color:#232831; color:#ece7da; }',
      '.cs-reading__back { display:inline-flex; align-items:center; gap:5px; background:none; border:0; padding:0; margin-bottom:16px; cursor:pointer; font:inherit; font-size:12px; font-weight:600; color:#7c3aed; }',
      '.cs-reading-dark .cs-reading__back { color:#bda6f4; }',
      '.cs-reading__eyebrow { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#b0915c; text-align:center; }',
      '.cs-reading-dark .cs-reading__eyebrow { color:#cdb06b; }',
      '.cs-reading__title { font-family:Georgia,"Iowan Old Style","Times New Roman",serif; font-size:32px; font-weight:700; text-align:center; margin:4px 0 24px; color:#211c14; }',
      '.cs-reading-dark .cs-reading__title { color:#f7f1e3; }',
      '.cs-reading__body { font-family:Georgia,"Iowan Old Style","Times New Roman",serif; font-size:17px; line-height:1.95; max-width:600px; margin:0 auto; white-space:pre-wrap; }',
      '.cs-reading__body::first-letter { float:left; font-family:Georgia,serif; font-weight:700; font-size:52px; line-height:0.72; padding:7px 10px 0 0; color:#7c3aed; }',
      '.cs-reading-dark .cs-reading__body::first-letter { color:#bda6f4; }',
      // ── Reserved Option-C block slots — hidden until Chronicle hydrates ──
      '.cs-slot:empty { display:none; }',
      // ── Empty / error ──
      '.cs-empty { text-align:center; padding:48px 16px; }',
      '.cs-empty-icon { width:48px; height:48px; border-radius:9999px; background:var(--color-bg-tertiary,#f3f4f6); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px; font-size:20px; color:var(--color-text-muted,#9ca3af); }',
      '.cs-empty-title { font-size:18px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 4px; }',
      '.cs-empty-desc { font-size:14px; color:var(--color-text-secondary,#6b7280); max-width:24rem; margin:0 auto; }',
      // Muted placeholder shown by a section that has no data yet, so the
      // sheet always shows its full structure instead of collapsing.
      '.cs-placeholder { color:var(--color-text-muted,#9ca3af); font-size:13px; font-style:italic; padding:6px 2px; }',
      // ── Combat panel ──
      '.cs-cond-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }',
      '.cs-cond { display:inline-flex; align-items:center; padding:2px 9px; border-radius:9999px; font-size:11px; font-weight:600; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.cs-cond--danger { background:rgba(220,38,38,0.12); color:#dc2626; }',
      '.cs-cond--warn { background:rgba(217,119,6,0.14); color:#b45309; }',
      // Potency strip (weak / avg / strong thresholds).
      '.cs-pot-strip { display:flex; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap; }',
      '.cs-pot-strip__label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-muted,#9ca3af); }',
      '.cs-pot { display:inline-flex; align-items:center; gap:5px; }',
      '.cs-pot__k { font-size:10px; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-muted,#9ca3af); }',
      '.cs-pot__v { font-size:13px; font-weight:700; color:var(--color-text-primary,#111827); font-variant-numeric:tabular-nums; }',
      // ── Skills (grouped chips) ──
      '.cs-skill-grp { margin-top:10px; }',
      '.cs-skill-grp:first-child { margin-top:0; }',
      '.cs-skill-grp__label { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-text-muted,#9ca3af); margin-bottom:5px; }',
      '.cs-skill-list { display:flex; flex-wrap:wrap; gap:5px; }',
      '.cs-skill { display:inline-block; padding:2px 9px; border-radius:9999px; font-size:11.5px; font-weight:500; background:rgba(var(--color-accent-rgb,168,85,247),0.10); color:var(--color-text-body,#374151); border:1px solid rgba(var(--color-accent-rgb,168,85,247),0.18); }',
      '.cs-skill--lang { background:var(--color-bg-tertiary,#f3f4f6); border-color:var(--color-border-light,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      // generic definition tooltip (skill chips, ability-keyword badges) — cursor
      // affordance only; the floating card itself is .ds-tipbox (a real,
      // JS-positioned DOM node — see attachTooltips), not a CSS ::after popover,
      // so it can escape ancestor overflow:hidden and clamp to the viewport.
      '.ds-sheet [data-tip] { cursor:help; }',
      // Glossary refs (.ds-ref) ship their own CSS-only ::after popover from
      // reference-renderer.js (shared by other widgets — left alone there). On
      // the character sheet it is superseded by the same .ds-tipbox mechanism
      // (attachTooltips reads [data-ref-tip] too), so it's suppressed here —
      // otherwise both would show. Selector specificity wins regardless of
      // stylesheet injection order (two classes beat reference-renderer's one).
      '.ds-sheet .ds-ref:hover::after, .ds-sheet .ds-ref:focus-visible::after { content:none; }',
      '.ds-tipbox { box-sizing:border-box; position:fixed; z-index:9999; width:max-content; max-width:280px; white-space:normal; padding:8px 11px; border-radius:8px; font-size:11.5px; font-weight:500; line-height:1.45; color:#f1f5f9; background:#1e293b; border:1px solid rgba(var(--color-accent-rgb,168,85,247),0.45); box-shadow:0 10px 28px -8px rgba(0,0,0,0.55); pointer-events:none; opacity:0; visibility:hidden; }',
      '.ds-tipbox--measuring { left:-9999px; top:-9999px; }',
      '.ds-tipbox--visible { visibility:visible; opacity:1; }',
      // movement modes (Combat) — DM-relevant non-walk movement.
      '.cs-move-modes { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:10px; }',
      '.cs-move-mode { display:inline-block; padding:2px 9px; border-radius:9999px; font-size:11px; font-weight:600; background:rgba(var(--color-accent-rgb,168,85,247),0.12); color:var(--color-accent,#a855f7); }',
      // treasures (Inventory) — keyword line + quantity badge on the accordion.
      '.cs-treasure__qty { font-size:11px; font-weight:600; color:var(--color-text-muted,#9ca3af); margin-left:2px; }',
      '.cs-treasure__kws { padding:0 12px 6px; font-size:10px; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-muted,#9ca3af); }',
      // ── Kit (stat box: damage tier mini-ladder + bonus chips) ──
      '.cs-kit-name { font-size:14px; font-weight:700; color:var(--color-text-primary,#111827); margin-bottom:8px; }',
      '.cs-kit-dmg { border:1px solid var(--color-border-light,#f3f4f6); border-radius:9px; overflow:hidden; margin-bottom:10px; }',
      '.cs-kit-dmg__head, .cs-kit-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; font-size:12px; }',
      '.cs-kit-dmg__head { background:var(--color-bg-tertiary,#f3f4f6); font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-muted,#9ca3af); }',
      '.cs-kit-row { border-top:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-kit-row__k { font-weight:600; color:var(--color-text-secondary,#6b7280); }',
      '.cs-kit-dist { font-weight:500; color:var(--color-text-muted,#9ca3af); font-size:11px; }',
      '.cs-kit-tiers, .cs-kit-tierhead { display:flex; gap:6px; }',
      '.cs-kit-tiers span, .cs-kit-tierhead span { display:inline-block; min-width:34px; text-align:center; font-variant-numeric:tabular-nums; }',
      '.cs-kit-tiers span { font-weight:700; color:var(--color-text-primary,#111827); }',
      // ── v3 GM Lore ──
      '.cs-gmlore { font-size:13px; line-height:1.6; color:var(--color-text-body,#374151); border-left:3px solid rgba(var(--color-accent-rgb,99,102,241),0.5); padding:4px 0 4px 12px; }',
      // ── Mobile ──
      '@media (max-width:600px) {',
      '  .cs-stat-row { grid-template-columns:repeat(5,1fr); gap:4px; }',
      '  .cs-stat { padding:8px 4px; }',
      '  .cs-stat-value { font-size:18px; }',
      '  .cs-damage-row { flex-direction:column; gap:4px; }',
      '  .cs-damage-label { width:auto; padding-top:0; }',
      '}',
      // ── Motion / animation layer (entrance + ambient; reduce-motion aware) ──
      // See playEntrance for the JS-driven entrance animations (stamina-bar
      // fill, characteristic count-up, recovery-dot / heroic-pip reveal).
      // 1. Staggered box entrance (class + per-box delay set in playEntrance).
      '@keyframes ds-box-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }',
      '.ds-sheet .cs-box.ds-anim-in { animation:ds-box-in 380ms cubic-bezier(.2,.7,.2,1) both; }',
      // 2. Low-stamina danger pulse on the stamina bar.
      // (box-shadow would be clipped by .cs-bar overflow:hidden — pulse brightness instead)
      '@keyframes ds-pulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.35); } }',
      '.cs-bar-fill.cs-bar-danger { animation:ds-pulse 1.5s ease-in-out infinite; }',
      // 3. Heroic-resource accent shimmer.
      '@keyframes ds-shimmer { 0% { background-position:-120% 0; } 100% { background-position:220% 0; } }',
      '.cs-bar-fill.cs-bar-accent { background-image:linear-gradient(100deg,transparent 30%,rgba(255,255,255,0.38) 50%,transparent 70%); background-size:220% 100%; animation:ds-shimmer 2.8s linear infinite; }',
      // 4. Level-badge sheen sweep.
      '.cs-level-badge { position:relative; overflow:hidden; }',
      '.cs-level-badge::after { content:""; position:absolute; top:0; left:-60%; width:45%; height:100%; background:linear-gradient(100deg,transparent,rgba(255,255,255,0.55),transparent); transform:skewX(-18deg); animation:ds-sheen 4.5s ease-in-out infinite; }',
      '@keyframes ds-sheen { 0%,72% { left:-60%; } 100% { left:170%; } }',
      // 5. Stat-card hover lift + 6. portrait hover zoom.
      '.cs-stat { transition:transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease; }',
      '.cs-stat:hover { transform:translateY(-2px); box-shadow:0 5px 14px -6px rgba(0,0,0,0.22); border-color:rgba(var(--color-accent-rgb,99,102,241),0.35); }',
      // Respect the OS reduce-motion setting: kill ambient + entrance motion.
      '@media (prefers-reduced-motion: reduce) {',
      '  .ds-sheet .cs-box.ds-anim-in { animation:none; }',
      '  .cs-bar-fill.cs-bar-danger, .cs-bar-fill.cs-bar-accent { animation:none; }',
      '  .cs-bar-fill.cs-bar-accent { background-image:none; }',
      '  .cs-level-badge::after { display:none; }',
      '  .cs-stat:hover { transform:none; box-shadow:none; }',
      '}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'ds-character-sheet-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── Paper styles ─────────────────────────────────────────────────────

  function injectPaperStyles() {
    if (document.getElementById('ds-character-sheet-paper-styles')) return;
    var css = [
      // Layout for the paper sheet: the .sh-* rules, read from the --paper-* tokens Chronicle derives from the sheet's style.
      // Everything is scoped under [data-sheet], so nothing outside the sheet changes. Chronicle owns the paper, the pulls, the panels and the motion.
      '[data-sheet] .sh-k { font:600 calc(10px * var(--ts)) var(--paper-ui-font);letter-spacing:.1em;text-transform:uppercase;color:var(--paper-mute); }',
      '[data-sheet] .sh-link { border:0;background:none;padding:0;color:var(--paper-accent);font:600 calc(12.5px * var(--ts)) var(--paper-ui-font); }',
      '[data-sheet] .sh-link:hover { text-decoration:underline; }',
      '[data-sheet] .sh-chip { display:inline-flex;align-items:center;gap:4px;border:1px solid var(--paper-edge);border-radius:999px;padding:1px 9px;font:600 calc(11px * var(--ts)) var(--paper-ui-font);color:var(--paper-ink-soft);background:rgb(var(--paper-hl) / calc(.3 * var(--hlk))); }',
      '[data-sheet] .num { font-variant-numeric:tabular-nums; }',
      '[data-sheet] .sh-folio { position:relative;isolation:isolate;width:920px;max-width:100%;margin-inline:auto; }',
      '[data-sheet] .sh-stack { position:relative;z-index:2;width:100%; }',
      '[data-sheet] .sh-sheet { padding:24px 36px 26px;display:flex;flex-direction:column;gap:16px;font-size:calc(13.5px * var(--ts));line-height:1.55; }',
      '[data-sheet] .sh-body { display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:16px 36px;align-items:start; }',
      '[data-sheet] .sh-col { display:flex;flex-direction:column;gap:16px;min-width:0; }',
      '[data-sheet] .sh-o1 { order:1; }',
      '[data-sheet] .sh-o2 { order:2; }',
      '[data-sheet] .sh-o3 { order:3; }',
      '[data-sheet] .sh-o4 { order:4; }',
      '[data-sheet] .sh-o5 { order:5; }',
      '[data-sheet] .sh-o6 { order:6; }',
      '[data-sheet] .sh-k { display:block; }',
      '[data-sheet] .sh-sec.paper-pull { padding:8px 10px 8px 0; }',
      '[data-sheet] .sh-pullbtn { display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:0;text-align:left;color:inherit;font:inherit;cursor:pointer; }',
      '[data-sheet] .sh-pullbtn .sh-pull { margin-left:auto;margin-right:18px;font:600 calc(11px * var(--ts)) var(--paper-ui-font);color:var(--paper-accent);white-space:nowrap; }',
      '[data-sheet] .sh-pullbtn .sh-pull i,[data-sheet] .sh-pullbtn .sh-pull svg { font-size:calc(9px * var(--ts));margin-left:3px; }',
      '[data-sheet] .sh-head { display:flex;align-items:flex-end;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;padding-bottom:10px; }',
      '[data-sheet] .sh-name { display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0; }',
      '[data-sheet] .sh-name h2 { margin:2px 0 0;font:700 calc(32px * var(--ts))/1.05 var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .sh-seal { display:inline-flex;align-items:center;gap:5px;border:1px solid var(--paper-accent);color:var(--paper-accent);border-radius:3px;padding:0 6px;font:600 calc(10px * var(--ts))/17px var(--paper-ui-font);letter-spacing:.08em;text-transform:uppercase;background:color-mix(in srgb,var(--paper-accent) 7%,transparent);white-space:nowrap; }',
      '[data-sheet] .sh-id { display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;padding:4px 0; }',
      '[data-sheet] .sh-port { position:relative;width:86px;height:86px;border-radius:3px;overflow:hidden;box-shadow:0 0 0 1px var(--paper-edge); }',
      '[data-sheet] .sh-port img { display:block;width:100%;height:100%; }',
      '[data-sheet] .sh-port button { position:absolute;left:50%;bottom:5px;transform:translateX(-50%);border:1px solid var(--paper-edge);background:var(--paper-cut);color:var(--paper-ink);border-radius:999px;padding:1px 8px;font:600 calc(10.5px * var(--ts)) var(--paper-ui-font);white-space:nowrap;display:inline-flex;gap:4px;align-items:center; }',
      '[data-sheet] .sh-slots { display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1fr) minmax(0,.9fr) minmax(0,1.35fr);gap:2px 12px; }',
      '[data-sheet] .sh-slot { min-width:0;display:flex;flex-direction:column;gap:1px; }',
      '[data-sheet] .sh-pick { position:relative;display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:0;border-bottom:1px dashed var(--paper-edge);background:none;padding:2px 0 3px;font:600 calc(15.5px * var(--ts))/1.3 var(--paper-font);color:var(--paper-ink);min-width:0; }',
      '[data-sheet] .sh-pick span { min-width:0;position:relative;z-index:1; }',
      '[data-sheet] .sh-pick i,[data-sheet] .sh-pick svg { margin-left:auto;font-size:calc(9px * var(--ts));color:var(--paper-accent);flex:none; }',
      '[data-sheet] .sh-pick:hover,[data-sheet] .sh-pick[aria-expanded="true"] { border-bottom:1px solid var(--paper-accent); }',
      '[data-sheet] .sh-v-plain { font:600 calc(15.5px * var(--ts))/1.3 var(--paper-font);color:var(--paper-ink);padding:2px 0 3px;border-bottom:1px dashed transparent; }',
      '[data-sheet] .sh-fixed { display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;margin-top:10px;font:600 calc(14px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .sh-fixed .sh-k { display:inline;margin-right:5px; }',
      '[data-sheet] .sh-fixed small { font:500 calc(11.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-mute); }',
      '[data-sheet] .sh-turn { border-top:1.5px solid var(--paper-accent);border-bottom:1px solid var(--paper-edge);padding:8px 0 10px;display:flex;flex-direction:column;gap:10px; }',
      '[data-sheet] .sh-turn-top { display:grid;grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(0,1fr));gap:12px; }',
      '[data-sheet] .sh-v { display:flex;flex-direction:column;gap:2px;min-width:0; }',
      '[data-sheet] .sh-big { display:flex;align-items:baseline;gap:6px;flex-wrap:wrap; }',
      '[data-sheet] .sh-num { font:700 calc(23px * var(--ts))/1.1 var(--paper-font);color:var(--paper-ink);font-variant-numeric:tabular-nums;border:0;background:none;padding:0;position:relative; }',
      '[data-sheet] button.sh-num { border-bottom:1px dashed var(--paper-accent);cursor:pointer; }',
      '[data-sheet] button.sh-num:hover { color:var(--paper-accent); }',
      '[data-sheet] .sh-num small,[data-sheet] .sh-big small { font:500 calc(13px * var(--ts)) var(--paper-font);color:var(--paper-mute); }',
      '[data-sheet] .sh-state { font:700 calc(10px * var(--ts))/16px var(--paper-ui-font);letter-spacing:.08em;text-transform:uppercase;border-radius:3px;padding:0 6px;color:var(--paper-on-accent);background:var(--paper-neg); }',
      '[data-sheet] .sh-state.winded { background:var(--paper-warn); }',
      '[data-sheet] .sh-bar { position:relative;height:6px;border-radius:3px;background:rgb(var(--paper-burn) / .16);margin:4px 0 1px;overflow:hidden; }',
      '[data-sheet] .sh-bar span { position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--paper-bar);transition:width var(--dur-slide) var(--ease-slide); }',
      '[data-sheet] .sh-bar .w { position:absolute;top:0;bottom:0;width:1.5px;background:var(--paper-ink);border-radius:0; }',
      '[data-sheet] .sh-sub { font:500 calc(11.5px * var(--ts))/1.35 var(--paper-ui-font);color:var(--paper-mute); }',
      '[data-sheet] .sh-pips { font-size:calc(10px * var(--ts));letter-spacing:1.5px;color:var(--paper-accent); }',
      '[data-sheet] .sh-cond { display:flex;flex-wrap:wrap;align-items:center;gap:6px; }',
      '[data-sheet] .sh-cond .lbl { margin-right:2px; }',
      '[data-sheet] .sh-cnd { display:inline-flex;align-items:center;gap:6px;border:1px solid var(--paper-neg);color:var(--paper-neg);border-radius:3px;padding:0 4px 0 7px;font:600 calc(12px * var(--ts))/20px var(--paper-ui-font);background:color-mix(in srgb,var(--paper-neg) 6%,transparent); }',
      '[data-sheet] .sh-cnd small { font-weight:500;color:var(--paper-ink-soft); }',
      '[data-sheet] .sh-cnd button { border:0;background:none;color:var(--paper-neg);padding:0 3px;font-size:calc(13px * var(--ts));line-height:1; }',
      '[data-sheet] .sh-stats { display:flex;flex-wrap:wrap;gap:4px 18px;font:500 calc(12px * var(--ts)) var(--paper-ui-font);color:var(--paper-ink-soft);align-items:baseline; }',
      '[data-sheet] .sh-stats b { font:700 calc(15px * var(--ts)) var(--paper-font);color:var(--paper-ink);margin-left:4px;font-variant-numeric:tabular-nums; }',
      '[data-sheet] .sh-turnhead { display:flex;align-items:center;gap:10px; }',
      '[data-sheet] .sh-turnhead .sh-pullbtn { position:relative; }',
      '[data-sheet] .sh-turnhead .paper-kind { white-space:nowrap; }',
      '[data-sheet] .sh-chars { display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-bottom:1px solid var(--paper-edge); }',
      '[data-sheet] .sh-chars div { display:flex;flex-direction:column;align-items:center;padding:6px 2px 6px;min-width:0; }',
      '[data-sheet] .sh-chars div+div { border-left:1px dashed var(--paper-edge); }',
      '[data-sheet] .sh-chars b { font:700 calc(25px * var(--ts))/1.1 var(--paper-font);color:var(--paper-ink);font-variant-numeric:tabular-nums; }',
      '[data-sheet] .sh-chars b.sh-neg { color:var(--paper-neg); }',
      '[data-sheet] .sh-chars span { font:600 calc(9.5px * var(--ts)) var(--paper-ui-font);letter-spacing:.09em;text-transform:uppercase;color:var(--paper-mute); }',
      '[data-sheet] .sh-band { padding:8px 10px 8px 0; }',
      '[data-sheet] .sh-band .sh-pullbtn { align-items:flex-start;flex-direction:column;gap:4px; }',
      '[data-sheet] .sh-band .sh-pullbtn .sh-pull { position:absolute;top:9px;right:0; }',
      '[data-sheet] .sh-band .sh-row { display:flex;flex-wrap:wrap;gap:4px 14px;font:500 calc(12.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-ink-soft); }',
      '[data-sheet] .sh-band .sh-row b { font:700 calc(14px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .sh-sec { display:flex;flex-direction:column;gap:6px;min-width:0; }',
      '[data-sheet] .sh-kit-name { font:700 calc(15px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .sh-kit { display:grid;grid-template-columns:1fr repeat(3,28px);gap:2px 6px;font:500 calc(12.5px * var(--ts)) var(--paper-font);border-top:1px dashed var(--paper-edge);border-bottom:1px dashed var(--paper-edge);padding:4px 0;text-align:center; }',
      '[data-sheet] .sh-kit span:first-child,[data-sheet] .sh-kit span:nth-child(5) { text-align:left; }',
      '[data-sheet] .sh-kit .sh-h { font:600 calc(9.5px * var(--ts)) var(--paper-ui-font);letter-spacing:.08em;text-transform:uppercase;color:var(--paper-mute); }',
      '[data-sheet] .sh-line { font:500 calc(12.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-ink-soft);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center; }',
      '[data-sheet] .sh-line b { font:700 calc(13.5px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .sh-dl { display:grid;grid-template-columns:repeat(5,auto);justify-content:start;gap:2px 16px; }',
      '[data-sheet] .sh-dl div { display:flex;flex-direction:column; }',
      '[data-sheet] .sh-dl b { white-space:nowrap;font:700 calc(17px * var(--ts)) var(--paper-font);color:var(--paper-ink);font-variant-numeric:tabular-nums; }',
      '[data-sheet] .sh-ledger { position:relative;border-top:1px solid var(--paper-edge); }',
      '[data-sheet] .sh-ledger .paper-pull { border-bottom:1px dashed var(--paper-edge); }',
      '[data-sheet] .sh-ledger .sh-pullbtn { padding:9px 0;align-items:baseline; }',
      '[data-sheet] .sh-ledger .sh-nm { font:700 calc(15px * var(--ts)) var(--paper-font);color:var(--paper-ink);min-width:calc(78px * var(--ts) * 1.12); }',
      '[data-sheet] .sh-ledger .sh-ds { font:500 calc(12.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-mute);min-width:0; }',
      '[data-sheet] .sh-foot { border-top:1px dashed var(--paper-edge);padding-top:9px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font:500 calc(12px * var(--ts)) var(--paper-ui-font);color:var(--paper-mute); }',
      '[data-sheet] .slip-in { padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px; }',
      '[data-sheet] .slip-head { display:flex;align-items:center;gap:8px; }',
      '[data-sheet] .slip-head h4,[data-sheet] .slip-head h3 { margin:0;font:700 calc(14.5px * var(--ts)) var(--paper-font);color:var(--paper-ink);outline:none; }',
      '[data-sheet] .paper-pin .slip-in { padding:14px 14px 12px; }',
      '[data-sheet] .paper-pin .unpin { border:0;background:none;color:var(--paper-ink-soft);font:600 calc(11.5px * var(--ts)) var(--paper-ui-font);padding:2px 4px;margin-left:auto;display:inline-flex;gap:4px;align-items:center; }',
      '[data-sheet] .paper-pin .unpin:hover { color:var(--paper-neg); }',
      '[data-sheet] .ab { position:relative;padding:8px 0 9px;border-bottom:1px dashed var(--paper-edge); }',
      '[data-sheet] .ab-name { font:700 calc(15px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .ab .sh-link { font-size:calc(12px * var(--ts));margin-top:3px; }',
      '[data-sheet] .it-row { display:flex;align-items:center;gap:10px;padding:8px 2px;font:600 calc(14.5px * var(--ts)) var(--paper-font);color:var(--paper-ink);border-bottom:1px dashed var(--paper-edge);position:relative; }',
      '[data-sheet] .it-row .sh-q { font:500 calc(12.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-mute); }',
      '[data-sheet] .it-li { position:relative;list-style:none; }',
      '[data-sheet] .lf-list { list-style:none;margin:0;padding:0; }',
      '[data-sheet] .lf-money { display:flex;white-space:nowrap;justify-content:space-between;gap:12px;padding:9px 2px;font:600 calc(14.5px * var(--ts)) var(--paper-font);color:var(--paper-ink);border-bottom:1px dashed var(--paper-edge); }',
      '[data-sheet] .lf-money small { white-space:normal;font:500 calc(11.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-mute);text-align:right;max-width:220px; }',
      '[data-sheet] .lf-grp { margin:4px 0 12px; }',
      '[data-sheet] .lf-grp>.sh-k { margin-bottom:4px; }',
      '[data-sheet] .ft { border-bottom:1px dashed var(--paper-edge); }',
      '[data-sheet] .ft summary { display:flex;align-items:center;gap:8px;padding:7px 2px;cursor:pointer;list-style:none;font:700 calc(14.5px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .ft summary::-webkit-details-marker { display:none; }',
      '[data-sheet] .ft summary::after { content:"\\25BE";margin-left:auto;font-size:calc(10px * var(--ts));color:var(--paper-mute);transition:transform var(--dur-micro) var(--ease-out); }',
      '[data-sheet] .ft.is-in>summary::after { transform:rotate(180deg); }',
      '[data-sheet] .ft p { margin:0 2px 9px;font-size:calc(13px * var(--ts)); }',
      '[data-sheet] .ft .lore { margin-bottom:9px; }',
      '[data-sheet] .sh-lvl { font:600 calc(10px * var(--ts)) var(--paper-ui-font);color:var(--paper-accent);border:1px solid var(--paper-edge);border-radius:3px;padding:0 4px; }',
      '[data-sheet] .skills { display:flex;flex-wrap:wrap;gap:5px; }',
      '[data-sheet] .lf-text { margin:0 0 6px;font-size:calc(14px * var(--ts));line-height:1.6;color:var(--paper-ink-soft); }',
      '[data-sheet] .lore { border-left:2px solid var(--paper-accent);padding:2px 0 2px 10px;font-style:italic; }',
      '[data-sheet] .rule { margin:0 0 10px; }',
      '[data-sheet] .rule b { display:block;font:700 calc(14px * var(--ts)) var(--paper-font);color:var(--paper-ink); }',
      '[data-sheet] .rule p { margin:2px 0 0;font-size:calc(13px * var(--ts)); }',
      '@container sheet (max-width:819px) {',
      '  [data-sheet] .sh-sheet { padding:22px 26px 24px;gap:14px; }',
      '  [data-sheet] .sh-body { display:flex;flex-direction:column;gap:14px; }',
      '  [data-sheet] .sh-col { display:contents; }',
      '}',
      '@container sheet (max-width:600px) {',
      '  [data-sheet] .sh-sheet { padding:18px 15px 20px; }',
      '  [data-sheet] .sh-name h2 { font-size:calc(28px * var(--ts)); }',
      '  [data-sheet] .sh-id { grid-template-columns:72px minmax(0,1fr);gap:12px; }',
      '  [data-sheet] .sh-port { width:72px;height:72px; }',
      '  [data-sheet] .sh-slots { grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px; }',
      '  [data-sheet] .sh-turn-top { grid-template-columns:repeat(3,minmax(0,1fr)); }',
      '  [data-sheet] .sh-turn-top>.sh-v:first-child { grid-column:1/-1; }',
      '  [data-sheet] .sh-chars b { font-size:calc(21px * var(--ts)); }',
      '  [data-sheet] .sh-chars span { font-size:calc(8.5px * var(--ts));letter-spacing:.04em; }',
      '  [data-sheet] .sh-dl { grid-template-columns:repeat(3,auto); }',
      '}',
      '[data-sheet] .sh-name h2,[data-sheet] .slip-head h4,[data-sheet] .slip-head h3,[data-sheet] .sh-kit-name,[data-sheet] .ab-name,[data-sheet] .sh-ledger .sh-nm,[data-sheet] .rule b,[data-sheet] .ft summary,[data-sheet] .it-row,[data-sheet] .lf-money,[data-sheet] .lf-grp>.sh-k+.sh-kit-name { font-family:var(--paper-head-font); }',
      '[data-sheet] .sh-num,[data-sheet] .sh-chars b,[data-sheet] .sh-dl b,[data-sheet] .sh-stats b,[data-sheet] .sh-band .sh-row b,[data-sheet] .sh-line b,[data-sheet] .sh-pick,[data-sheet] .sh-v-plain,[data-sheet] .sh-fixed,[data-sheet] .sh-kit,[data-sheet] .sh-num small,[data-sheet] .sh-big small { font-family:var(--paper-num-font); }',
      // Per-style looks for the sheet's own classes. The paper, panels and moves of each style are Chronicle's sheet_styles.css and sheet_motion.css.
      '[data-sheet][data-sheet-style="ledger"] .sh-turn { border-top:3px double var(--paper-accent); }',
      '[data-sheet][data-sheet-style="ledger"] .sh-k,[data-sheet][data-sheet-style="ledger"] .sh-chars span,[data-sheet][data-sheet-style="ledger"] .sh-kit .sh-h { font-family:var(--paper-num-font);letter-spacing:.06em; }',
      '[data-sheet][data-sheet-style="ledger"] .sh-chars div+div { border-left-style:solid; }',
      '[data-sheet][data-sheet-style="ledger"] .sh-name h2 { letter-spacing:-.01em; }',
      '[data-sheet][data-sheet-style="journal"] .sh-turn { border-top:2px dashed var(--paper-accent); }',
      '[data-sheet][data-sheet-style="vellum"] .sh-turn { border-top:3px double var(--gilt); }',
      '[data-sheet][data-sheet-style="vellum"] .sh-k { color:var(--paper-accent);letter-spacing:.12em; }',
      '[data-sheet][data-sheet-style="vellum"] .sh-name h2 { letter-spacing:.02em;font-weight:700; }',
      '[data-sheet][data-sheet-style="vellum"] .sh-name h2::first-letter { font-size:1.5em;color:var(--paper-accent);text-shadow:1px 1px 0 var(--gilt),2px 2px 0 color-mix(in srgb,var(--gilt) 40%,transparent); }',
      '[data-sheet][data-sheet-style="night"] .sh-name h2 { text-transform:uppercase;letter-spacing:.05em; }',
      '[data-sheet][data-sheet-style="night"] .sh-k { letter-spacing:.14em; }',
      '[data-sheet][data-sheet-style="night"] .sh-bar { background:rgb(160 200 255 / .2); }',
      '[data-sheet][data-sheet-style="deck"] .sh-turn { border-top:3px solid var(--paper-ink); }',
      '[data-sheet][data-sheet-style="deck"] .sh-name h2 { font-weight:800;letter-spacing:-.01em; }',
      '[data-sheet][data-sheet-style="deck"] .sh-chars div { border-radius:10px; }',
      '[data-sheet][data-sheet-style="deck"] .sh-chars { gap:6px;border-bottom:0; }',
      '[data-sheet][data-sheet-style="deck"] .sh-chars div,[data-sheet][data-sheet-style="deck"] .sh-chars div+div { border:1.5px solid var(--paper-ink);background:rgb(var(--paper-hl) / .55); }',
      '[data-sheet][data-sheet-style="deck"] .sh-pullbtn .sh-pull { font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-turn { border-top:0; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-k,[data-sheet][data-sheet-style="pencil"] .sh-chars span,[data-sheet][data-sheet-style="pencil"] .sh-kit .sh-h { font-family:var(--paper-ui-font);font-weight:700;letter-spacing:.12em;color:var(--pc-rule); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-k { font-size:calc(11.5px * var(--ts)); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars span { font-size:calc(11px * var(--ts)); }',
      '[data-sheet][data-sheet-style="pencil"] .ab-name,[data-sheet][data-sheet-style="pencil"] .ft summary,[data-sheet][data-sheet-style="pencil"] .rule b,[data-sheet][data-sheet-style="pencil"] .sh-ledger .sh-nm,[data-sheet][data-sheet-style="pencil"] .slip-head h3,[data-sheet][data-sheet-style="pencil"] .slip-head h4 { font-size:calc(17px * var(--ts));font-weight:700;letter-spacing:.02em; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-id,[data-sheet][data-sheet-style="pencil"] .sh-turn,[data-sheet][data-sheet-style="pencil"] .sh-band,[data-sheet][data-sheet-style="pencil"] .sh-sec.paper-pull,[data-sheet][data-sheet-style="pencil"] .sh-ledger { border:1.5px solid var(--pc-rule);border-radius:3px;background:transparent; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-id { padding:10px 12px; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-turn { padding:10px 12px 12px;gap:12px; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-band,[data-sheet][data-sheet-style="pencil"] .sh-sec.paper-pull { padding:10px 12px; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-ledger { border-top:1.5px solid var(--pc-rule); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-ledger .paper-pull { padding:0 12px;border-bottom:1px solid var(--paper-edge); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-ledger .paper-pull:last-child { border-bottom:0; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-ledger .sh-pullbtn .sh-pull { margin-right:0; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars { gap:6px;border-bottom:0; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars div,[data-sheet][data-sheet-style="pencil"] .sh-chars div+div { border:1.5px solid var(--pc-rule);border-radius:3px;padding:2px 2px 6px;flex-direction:column-reverse; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars span { border-top:1px solid var(--paper-edge);width:100%;text-align:center;padding-top:2px;margin-top:2px; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-pick,[data-sheet][data-sheet-style="pencil"] .sh-v-plain { border-bottom:1px solid var(--pc-rule); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-pick:hover,[data-sheet][data-sheet-style="pencil"] .sh-pick[aria-expanded="true"] { border-bottom:2px solid var(--paper-accent); }',
      '[data-sheet][data-sheet-style="pencil"] button.sh-num { border-bottom:1px solid var(--pc-rule); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-foot { border-top:1.5px solid var(--pc-rule); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-bar { height:8px;border:1px solid var(--pc-rule);border-radius:1px;background:transparent; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-bar span { border-radius:0;background:repeating-linear-gradient(135deg,#4f545b 0 2px,#868b92 2px 4px); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-port { border-radius:1px;box-shadow:0 0 0 1.5px var(--pc-rule); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-port img { filter:grayscale(.92) contrast(1.05); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chip { border-radius:2px; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-name h2 { font-size:calc(44px * var(--ts));font-weight:700;line-height:1;rotate:-.8deg;transform-origin:left bottom;letter-spacing:0; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-num { font-size:calc(31px * var(--ts));font-weight:700;rotate:-.9deg; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-num small,[data-sheet][data-sheet-style="pencil"] .sh-big small { font-size:calc(21px * var(--ts));font-weight:500;color:var(--pc-lead); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars b { font-size:calc(34px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars div:nth-child(odd) b { rotate:-1.2deg; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars div:nth-child(even) b { rotate:1deg; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-chars b.sh-neg { color:var(--pc-lead); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-dl b { font-size:calc(23px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-stats b { font-size:calc(21px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-band .sh-row b { font-size:calc(19px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-line b { font-size:calc(18px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-pick,[data-sheet][data-sheet-style="pencil"] .sh-v-plain { font-size:calc(22px * var(--ts));font-weight:500;line-height:1.1; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-slot:nth-child(odd) .sh-pick,[data-sheet][data-sheet-style="pencil"] .sh-slot:nth-child(odd) .sh-v-plain { rotate:-.5deg; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-slot:nth-child(even) .sh-pick,[data-sheet][data-sheet-style="pencil"] .sh-slot:nth-child(even) .sh-v-plain { rotate:.4deg; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-fixed { font-size:calc(20px * var(--ts));font-weight:500; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-fixed small { font:500 calc(12.5px * var(--ts)) var(--paper-ui-font);color:var(--paper-mute);text-shadow:none; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-kit { font-size:calc(19px * var(--ts));font-weight:500; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-kit .sh-h,[data-sheet][data-sheet-style="pencil"] .sh-kit span:nth-child(5) { font-family:var(--paper-ui-font);color:var(--pc-rule);text-shadow:none; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-kit-name { font-size:calc(25px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-cnd { font-size:calc(18px * var(--ts));font-weight:500;line-height:22px;border-color:var(--pc-lead);border-radius:20px 14px 18px 12px / 14px 18px 12px 20px;background:transparent;color:var(--pc-lead); }',
      '[data-sheet][data-sheet-style="pencil"] .sh-cnd small { font:500 calc(12px * var(--ts)) var(--paper-ui-font);color:var(--paper-ink-soft);text-shadow:none; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-cnd button { color:var(--pc-lead); }',
      '[data-sheet][data-sheet-style="pencil"] .it-row { font-size:calc(21px * var(--ts));font-weight:500; }',
      '[data-sheet][data-sheet-style="pencil"] .it-row .sh-q { font:500 calc(14px * var(--ts)) var(--paper-ui-font);text-shadow:none; }',
      '[data-sheet][data-sheet-style="pencil"] .it-row .sh-link { text-shadow:none; }',
      '[data-sheet][data-sheet-style="pencil"] .lf-money b { font-size:calc(21px * var(--ts));font-weight:700; }',
      '[data-sheet][data-sheet-style="pencil"] .sh-num small,[data-sheet][data-sheet-style="pencil"] .sh-big small { text-shadow:none; }',
      '@container sheet (max-width:600px) {',
      '  [data-sheet][data-sheet-style="pencil"] .sh-chars b { font-size:calc(28px * var(--ts)); }',
      '  [data-sheet][data-sheet-style="pencil"] .sh-chars span { font-size:calc(10px * var(--ts));letter-spacing:.06em; }',
      '  [data-sheet][data-sheet-style="pencil"] .sh-name h2 { font-size:calc(38px * var(--ts)); }',
      '}',
      '[data-sheet][data-sheet-style="starship"] .sh-id,[data-sheet][data-sheet-style="starship"] .sh-turn,[data-sheet][data-sheet-style="starship"] .sh-band,[data-sheet][data-sheet-style="starship"] .sh-sec.paper-pull,[data-sheet][data-sheet-style="starship"] .sh-ledger { border:1px solid var(--hud-dim);border-radius:2px;background:linear-gradient(rgb(95 215 245 / .06),rgb(95 215 245 / .015)); }',
      '[data-sheet][data-sheet-style="starship"] .sh-id { padding:12px 14px; }',
      '[data-sheet][data-sheet-style="starship"] .sh-turn { padding:12px 14px 14px;gap:12px;border-top:2px solid var(--hud-a); }',
      '[data-sheet][data-sheet-style="starship"] .sh-band,[data-sheet][data-sheet-style="starship"] .sh-sec.paper-pull { padding:10px 14px; }',
      '[data-sheet][data-sheet-style="starship"] .sh-ledger { overflow:hidden; }',
      '[data-sheet][data-sheet-style="starship"] .sh-ledger .paper-pull { padding:0 14px;border-bottom:1px solid var(--hud-dim); }',
      '[data-sheet][data-sheet-style="starship"] .sh-ledger .paper-pull:last-child { border-bottom:0; }',
      '[data-sheet][data-sheet-style="starship"] .sh-ledger .sh-pullbtn .sh-pull { margin-right:0; }',
      '[data-sheet][data-sheet-style="starship"] .sh-chars { gap:6px;border-bottom:0; }',
      '[data-sheet][data-sheet-style="starship"] .sh-chars div,[data-sheet][data-sheet-style="starship"] .sh-chars div+div { border:1px solid var(--hud-dim);border-bottom:2px solid var(--hud);border-radius:0;background:rgb(95 215 245 / .05); }',
      '[data-sheet][data-sheet-style="starship"] .sh-pick,[data-sheet][data-sheet-style="starship"] .sh-v-plain { border-bottom:1px solid var(--hud-dim); }',
      '[data-sheet][data-sheet-style="starship"] .sh-pick:hover,[data-sheet][data-sheet-style="starship"] .sh-pick[aria-expanded="true"] { border-bottom:1px solid var(--hud); }',
      '[data-sheet][data-sheet-style="starship"] button.sh-num { border-bottom:1px solid var(--hud-dim); }',
      '[data-sheet][data-sheet-style="starship"] .sh-foot { border-top:1px solid var(--hud-dim); }',
      '[data-sheet][data-sheet-style="starship"] .sh-bar { background:rgb(95 215 245 / .16);border-radius:0;height:6px; }',
      '[data-sheet][data-sheet-style="starship"] .sh-bar span { border-radius:0; }',
      '[data-sheet][data-sheet-style="starship"] .sh-port { border-radius:0;box-shadow:0 0 0 1px var(--hud-dim); }',
      '[data-sheet][data-sheet-style="starship"] .sh-chip,[data-sheet][data-sheet-style="starship"] .sh-cnd,[data-sheet][data-sheet-style="starship"] .sh-seal { border-radius:0; }',
      '[data-sheet][data-sheet-style="starship"] .sh-name h2 { font-family:"Orbitron","Rajdhani",sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.07em; }',
      '[data-sheet][data-sheet-style="starship"] .sh-name h2 { font-size:calc(27px * var(--ts)); }',
      '[data-sheet][data-sheet-style="starship"] .sh-k,[data-sheet][data-sheet-style="starship"] .sh-chars span,[data-sheet][data-sheet-style="starship"] .sh-kit .sh-h { font-family:var(--paper-head-font);font-weight:700;letter-spacing:.16em; }',
      '[data-sheet][data-sheet-style="starship"] .sh-k { font-size:calc(11.5px * var(--ts)); }',
      '[data-sheet][data-sheet-style="starship"] .ab-name,[data-sheet][data-sheet-style="starship"] .ft summary,[data-sheet][data-sheet-style="starship"] .rule b,[data-sheet][data-sheet-style="starship"] .sh-ledger .sh-nm,[data-sheet][data-sheet-style="starship"] .slip-head h3,[data-sheet][data-sheet-style="starship"] .slip-head h4,[data-sheet][data-sheet-style="starship"] .sh-kit-name { font-size:calc(17px * var(--ts));font-weight:700;letter-spacing:.03em; }',
      '[data-sheet][data-sheet-style="starship"] :is(.sh-num,.sh-chars b,.sh-dl b) { text-shadow:0 0 8px rgb(95 215 245 / .38);font-weight:400; }',
      '[data-sheet][data-sheet-style="starship"] .sh-num { font-size:calc(26px * var(--ts)); }',
      '[data-sheet][data-sheet-style="starship"] .sh-chars b { font-size:calc(26px * var(--ts)); }',
      '[data-sheet][data-sheet-style="starship"] .sh-chars b.sh-neg { color:var(--paper-neg); }',
      '@container sheet (max-width:600px) {',
      '  [data-sheet][data-sheet-style="starship"] .sh-chars b { font-size:calc(21px * var(--ts)); }',
      '  [data-sheet][data-sheet-style="starship"] .sh-chars span { letter-spacing:.06em; }',
      '  [data-sheet][data-sheet-style="starship"] .sh-name h2 { font-size:calc(22px * var(--ts)); }',
      '}',
      '[data-sheet][data-sheet-style="neon"] :is(.sh-id,.sh-turn,.sh-band,.sh-sec.paper-pull,.sh-ledger) { border:1px solid var(--nx-dim);border-radius:0;background:linear-gradient(rgb(255 63 180 / .06),rgb(56 243 255 / .015)); }',
      '[data-sheet][data-sheet-style="neon"] .sh-id { padding:12px 14px; }',
      '[data-sheet][data-sheet-style="neon"] .sh-turn { padding:12px 14px 14px;gap:12px;border-top:2px solid var(--nx-mag); }',
      '[data-sheet][data-sheet-style="neon"] :is(.sh-band,.sh-sec.paper-pull) { padding:10px 14px; }',
      '[data-sheet][data-sheet-style="neon"] .sh-ledger { overflow:hidden; }',
      '[data-sheet][data-sheet-style="neon"] .sh-ledger .paper-pull { padding:0 14px;border-bottom:1px solid var(--nx-dim); }',
      '[data-sheet][data-sheet-style="neon"] .sh-ledger .paper-pull:last-child { border-bottom:0; }',
      '[data-sheet][data-sheet-style="neon"] .sh-ledger .sh-pullbtn .sh-pull { margin-right:0; }',
      '[data-sheet][data-sheet-style="neon"] .sh-chars { gap:6px;border-bottom:0; }',
      '[data-sheet][data-sheet-style="neon"] .sh-chars div,[data-sheet][data-sheet-style="neon"] .sh-chars div+div { border:1px solid var(--nx-dimc,rgb(56 243 255 / .36));border-bottom:2px solid var(--nx-cy);border-radius:0;background:rgb(56 243 255 / .05); }',
      '[data-sheet][data-sheet-style="neon"] :is(.sh-pick,.sh-v-plain,button.sh-num) { border-bottom:1px solid var(--nx-dimc,rgb(56 243 255 / .36)); }',
      '[data-sheet][data-sheet-style="neon"] :is(.sh-pick:hover,.sh-pick[aria-expanded="true"]) { border-bottom:1px solid var(--nx-cy); }',
      '[data-sheet][data-sheet-style="neon"] .sh-foot { border-top:1px solid var(--nx-dim); }',
      '[data-sheet][data-sheet-style="neon"] .sh-port { border-radius:0;box-shadow:0 0 0 1px var(--nx-dim); }',
      '[data-sheet][data-sheet-style="neon"] .sh-name h2 { font-size:calc(42px * var(--ts));text-shadow:0 0 10px rgb(255 63 180 / .55),0 0 2px rgb(255 63 180 / .7); }',
      '[data-sheet][data-sheet-style="neon"] :is(.paper-kind,.sh-k,.sh-chars span,.sh-kit .sh-h) { font-family:var(--paper-ui-font);font-weight:700;letter-spacing:.1em; }',
      '[data-sheet][data-sheet-style="neon"] :is(.sh-num,.sh-chars b,.sh-dl b) { text-shadow:0 0 8px rgb(56 243 255 / .45);font-weight:700; }',
      '[data-sheet][data-sheet-style="neon"] .sh-chars b.sh-neg { color:var(--paper-neg);text-shadow:0 0 8px rgb(255 143 176 / .4); }',
      '@container sheet (max-width:600px) {',
      '  [data-sheet][data-sheet-style="neon"] .sh-chars b { font-size:calc(20px * var(--ts)); }',
      '  [data-sheet][data-sheet-style="neon"] .sh-chars span { letter-spacing:.02em; }',
      '  [data-sheet][data-sheet-style="neon"] .sh-name h2 { font-size:calc(34px * var(--ts)); }',
      '}',
      '[data-sheet][data-sheet-style="runes"] :is(.sh-id,.sh-turn,.sh-band,.sh-sec.paper-pull,.sh-ledger) { border:0;border-radius:0;background:var(--rn-tablet,linear-gradient(rgb(5 6 10 / .58),rgb(5 6 10 / .46)),var(--rn-stone) 40px 90px/320px 320px,#1b1c22);box-shadow:var(--rn-carve,inset 4px 5px 10px -1px rgb(0 0 0 / .85),inset 0 0 0 1px rgb(0 0 0 / .5),inset -2px -2px 0 rgb(255 255 255 / .09));clip-path:var(--rn-ch-t,polygon(-22px -10px,9px -10px,9px 1px,37% 0,71% 2px,calc(100% - 11px) 0,100% 7px,calc(100% - 1px) 50%,100% calc(100% - 9px),calc(100% - 8px) 100%,56% calc(100% - 2px),23% 100%,7px calc(100% - 1px),0 calc(100% - 8px),2px 62%,0 12px,-22px 12px)); }',
      '@media (hover:hover) {',
      '  [data-sheet][data-sheet-style="runes"] :is(.sh-id,.sh-turn,.sh-band,.sh-sec.paper-pull):hover { box-shadow:var(--rn-carve,inset 4px 5px 10px -1px rgb(0 0 0 / .85),inset 0 0 0 1px rgb(0 0 0 / .5),inset -2px -2px 0 rgb(255 255 255 / .09)),inset 0 0 22px rgb(111 233 214 / .1); }',
      '}',
      '[data-sheet][data-sheet-style="runes"] .sh-id { padding:12px 14px; }',
      '[data-sheet][data-sheet-style="runes"] .sh-turn { padding:12px 14px 14px;gap:12px; }',
      '[data-sheet][data-sheet-style="runes"] :is(.sh-band,.sh-sec.paper-pull) { padding:10px 14px; }',
      '[data-sheet][data-sheet-style="runes"] .sh-ledger { overflow:visible; }',
      '[data-sheet][data-sheet-style="runes"] .sh-ledger .paper-pull { padding:0 14px;border-bottom:1px solid rgb(0 0 0 / .5);box-shadow:0 1px 0 rgb(255 255 255 / .06); }',
      '[data-sheet][data-sheet-style="runes"] .sh-ledger .paper-pull:last-child { border-bottom:0;box-shadow:none; }',
      '[data-sheet][data-sheet-style="runes"] .sh-ledger .sh-pullbtn .sh-pull { margin-right:0; }',
      '[data-sheet][data-sheet-style="runes"] .sh-chars { gap:7px;border-bottom:0; }',
      '[data-sheet][data-sheet-style="runes"] .sh-chars div,[data-sheet][data-sheet-style="runes"] .sh-chars div+div { border:0;border-radius:0;background:var(--rn-tablet,linear-gradient(rgb(5 6 10 / .58),rgb(5 6 10 / .46)),var(--rn-stone) 40px 90px/320px 320px,#1b1c22);box-shadow:var(--rn-carve,inset 4px 5px 10px -1px rgb(0 0 0 / .85),inset 0 0 0 1px rgb(0 0 0 / .5),inset -2px -2px 0 rgb(255 255 255 / .09));clip-path:var(--rn-ch-s); }',
      '[data-sheet][data-sheet-style="runes"] :is(.sh-pick,.sh-v-plain,button.sh-num) { border-bottom:1px solid rgb(0 0 0 / .55);box-shadow:0 1px 0 rgb(255 255 255 / .07); }',
      '[data-sheet][data-sheet-style="runes"] :is(.sh-pick:hover,.sh-pick[aria-expanded="true"]) { border-bottom:1px solid var(--rn-t);box-shadow:0 1px 0 var(--rn-glow); }',
      '[data-sheet][data-sheet-style="runes"] .sh-foot { border-top:1px solid rgb(0 0 0 / .5);box-shadow:0 -1px 0 rgb(255 255 255 / .06); }',
      '[data-sheet][data-sheet-style="runes"] .sh-port { box-shadow:inset 0 0 0 2px rgb(0 0 0 / .65),0 0 0 1px rgb(255 255 255 / .09),0 0 14px -4px var(--rn-glow); }',
      '[data-sheet][data-sheet-style="runes"] .sh-name h2 { font-size:calc(30px * var(--ts)); }',
      '[data-sheet][data-sheet-style="runes"] :is(.paper-kind,.sh-k,.sh-chars span,.sh-kit .sh-h) { letter-spacing:.14em; }',
      '[data-sheet][data-sheet-style="runes"] :is(.paper-kind,.sh-ledger .sh-nm)::before { content:"\\16DF";margin-right:.55em;font:400 .9em var(--rn-rune);color:var(--rn-v);text-shadow:0 0 8px var(--rn-glowv),-1px -1px 0 rgb(0 0 0 / .7); }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="turn"] .paper-kind::before { content:"\\16B1"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="abilities"] .paper-kind::before { content:"\\16A0"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="kit"] .paper-kind::before { content:"\\16CF"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="damage"] .paper-kind::before { content:"\\16C9"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="progression"] .paper-kind::before { content:"\\16C3"; }',
      '[data-sheet][data-sheet-style="runes"] .sh-o1 .paper-kind::before { content:"\\16B7"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="items"] .sh-nm::before { content:"\\16A2"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="features"] .sh-nm::before { content:"\\16A8"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="skills"] .sh-nm::before { content:"\\16CA"; }',
      '[data-sheet][data-sheet-style="runes"] [data-sheet-section="notes"] .sh-nm::before { content:"\\16BE"; }',
      '[data-sheet][data-sheet-style="runes"] :is(.sh-num,.sh-chars b,.sh-dl b) { text-shadow:0 0 10px var(--rn-glow),-1px -1px 0 rgb(0 0 0 / .7);font-weight:700; }',
      '[data-sheet][data-sheet-style="runes"] .sh-chars b.sh-neg { color:var(--paper-neg); }',
      '@container sheet (max-width:600px) {',
      '  [data-sheet][data-sheet-style="runes"] .sh-chars b { font-size:calc(19px * var(--ts)); }',
      '  [data-sheet][data-sheet-style="runes"] .sh-chars span { letter-spacing:.06em; }',
      '  [data-sheet][data-sheet-style="runes"] .sh-name h2 { font-size:calc(24px * var(--ts)); }',
      '}',
      '[data-sheet][data-sheet-style="brass"] :is(.sh-id,.sh-turn,.sh-band,.sh-sec.paper-pull,.sh-ledger) { border:1px solid var(--bs-line,rgb(184 138 53 / .55));border-radius:3px;background:linear-gradient(rgb(0 0 0 / .3),rgb(0 0 0 / .14));box-shadow:inset 0 1px 4px rgb(0 0 0 / .6),0 1px 0 rgb(255 220 150 / .12); }',
      '[data-sheet][data-sheet-style="brass"] .sh-id { padding:12px 14px; }',
      '[data-sheet][data-sheet-style="brass"] .sh-turn { padding:12px 14px 14px;gap:12px;border-top:3px solid var(--bs-b2); }',
      '[data-sheet][data-sheet-style="brass"] :is(.sh-band,.sh-sec.paper-pull) { padding:10px 14px; }',
      '[data-sheet][data-sheet-style="brass"] .sh-ledger { overflow:hidden; }',
      '[data-sheet][data-sheet-style="brass"] .sh-ledger .paper-pull { padding:0 14px;border-bottom:1px solid var(--bs-line,rgb(184 138 53 / .55)); }',
      '[data-sheet][data-sheet-style="brass"] .sh-ledger .paper-pull:last-child { border-bottom:0; }',
      '[data-sheet][data-sheet-style="brass"] .sh-ledger .sh-pullbtn .sh-pull { margin-right:0; }',
      '[data-sheet][data-sheet-style="brass"] .sh-chars { gap:8px;border-bottom:0; }',
      '[data-sheet][data-sheet-style="brass"] .sh-chars div,[data-sheet][data-sheet-style="brass"] .sh-chars div+div { border:3px solid transparent;border-image:var(--bs-brass) 1;border-radius:0;padding:5px 2px 6px;background:radial-gradient(circle at 50% 38%,#fbf4de,#e6d6ad 88%);box-shadow:inset 0 2px 6px rgb(80 50 10 / .45),0 2px 3px rgb(0 0 0 / .6); }',
      '[data-sheet][data-sheet-style="brass"] .sh-chars b { color:var(--bs-plate-ink); }',
      '[data-sheet][data-sheet-style="brass"] .sh-chars b.sh-neg { color:var(--bs-plate-neg,#8b1c10); }',
      '[data-sheet][data-sheet-style="brass"] .sh-chars span { color:var(--bs-plate-mute,#5c4322);font-weight:700; }',
      '[data-sheet][data-sheet-style="brass"] :is(.sh-pick,.sh-v-plain,button.sh-num) { border-bottom:1px solid var(--bs-line,rgb(184 138 53 / .55)); }',
      '[data-sheet][data-sheet-style="brass"] :is(.sh-pick:hover,.sh-pick[aria-expanded="true"]) { border-bottom:1px solid var(--bs-b1,#f3d27f); }',
      '[data-sheet][data-sheet-style="brass"] .sh-foot { border-top:1px solid var(--bs-line,rgb(184 138 53 / .55)); }',
      '[data-sheet][data-sheet-style="brass"] .sh-port { border-radius:0;box-shadow:0 0 0 2px var(--bs-b2),0 0 0 3px #120a05; }',
      '[data-sheet][data-sheet-style="brass"] .sh-name h2 { font-size:calc(38px * var(--ts)); }',
      '[data-sheet][data-sheet-style="brass"] :is(.sh-k,.sh-chars span) { letter-spacing:.1em; }',
      '[data-sheet][data-sheet-style="brass"] .sh-pick { font-size:calc(14px * var(--ts)); }',
      '@container sheet (max-width:600px) {',
      '  [data-sheet][data-sheet-style="brass"] .sh-chars b { font-size:calc(19px * var(--ts)); }',
      '  [data-sheet][data-sheet-style="brass"] .sh-chars span { letter-spacing:.03em; }',
      '  [data-sheet][data-sheet-style="brass"] .sh-name h2 { font-size:calc(30px * var(--ts)); }',
      '}',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-sheet { padding:28px 32px 26px;gap:18px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-name h2 { font-weight:700;letter-spacing:-.02em; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-seal { border-radius:999px;padding:0 9px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-id,[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-turn,[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-band,[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-sec.paper-pull,[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-ledger { border:1px solid var(--paper-edge);border-radius:12px;background:var(--paper-cut);box-shadow:0 1px 2px rgb(var(--s-sh) / calc(.06 * var(--shk))); }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-id { padding:14px 16px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-turn { padding:14px 16px 16px;border-top:3px solid var(--paper-accent);gap:12px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-band,[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-sec.paper-pull { padding:12px 16px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-band .sh-pullbtn .sh-pull { right:0; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-ledger { overflow:hidden;border-top:1px solid var(--paper-edge); }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-ledger .paper-pull { padding:0 16px;border-bottom:1px solid var(--paper-edge); }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-ledger .paper-pull:last-child { border-bottom:0; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-ledger .sh-pullbtn .sh-pull { margin-right:0; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-chars { border-bottom:0;gap:8px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-chars div { border:1px solid var(--paper-edge);border-radius:10px;background:var(--paper-under);padding:8px 2px; }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-chars div+div { border-left:1px solid var(--paper-edge); }',
      '@media (hover:hover) {',
      '  [data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-ledger .paper-pull:hover { transform:none;box-shadow:none;background:var(--paper-under); }',
      '}',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-pullbtn .sh-pull { transition:transform var(--dur-micro) var(--ease-out); }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .paper-pull:hover .sh-pull,[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .paper-pull:focus-within .sh-pull { transform:translateX(3px); }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-foot { border-top:1px solid var(--paper-edge); }',
      '[data-sheet]:is([data-sheet-style="modern"],:not([data-sheet-style])) .sh-chip { background:var(--paper-under); }',
      '@container sheet (min-width:820px) {',
      '  [data-sheet][data-sheet-style="journal"] .sh-sheet { padding-left:44px; }',
      '  [data-sheet][data-sheet-style="vellum"] .sh-sheet { padding-inline:42px; }',
      '  [data-sheet][data-sheet-style="night"] .sh-sheet { padding-inline:40px; }',
      '  [data-sheet][data-sheet-style="deck"] .sh-sheet { padding-inline:42px; }',
      '}',
      '@container sheet (max-width:819px) {',
      '  [data-sheet][data-sheet-style="journal"] .sh-sheet { padding-left:36px; }',
      '  [data-sheet][data-sheet-style="vellum"] .sh-sheet,[data-sheet][data-sheet-style="night"] .sh-sheet,[data-sheet][data-sheet-style="deck"] .sh-sheet { padding-inline:30px; }',
      '}',
      '@container sheet (max-width:600px) {',
      '  [data-sheet][data-sheet-style="journal"] .sh-sheet { padding-left:30px;padding-right:18px; }',
      '  [data-sheet][data-sheet-style="vellum"] .sh-sheet,[data-sheet][data-sheet-style="night"] .sh-sheet,[data-sheet][data-sheet-style="deck"] .sh-sheet { padding-inline:22px; }',
      '}',
      // Pieces the design draws that need a rule of their own.
      '[data-sheet] .fold-body { overflow: hidden; }',
      '[data-sheet] .sh-port img { object-fit: cover; }',
      '[data-sheet] .sh-port-ph { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: var(--paper-mute); font-size: calc(30px * var(--ts)); }',
      '[data-sheet] .sh-fold { grid-column: 1 / -1; }',
      '[data-sheet] .sh-fold:empty { display: none; }',
      '[data-sheet] .sh-empty { margin: 0; font-style: italic; }',
      '[data-sheet] .sh-unset { font-weight: 500; color: var(--paper-mute); }',
      '[data-sheet] .sh-on { font: 600 calc(10.5px * var(--ts)) var(--paper-ui-font); color: var(--paper-neg); }',
      '[data-sheet] .sh-cnd--warn { border-color: var(--paper-warn); color: var(--paper-warn); background: color-mix(in srgb, var(--paper-warn) 6%, transparent); }',
      '[data-sheet] .ft-flat { display: flex; align-items: center; gap: 8px; padding: 7px 2px; font: 700 calc(14.5px * var(--ts)) var(--paper-font); color: var(--paper-ink); }',
      '[data-sheet] .paper-pin .slip-in { max-height: min(60vh, 420px); overflow: auto; }',
      '[data-sheet] .paper-pin p { margin: 0 0 8px; white-space: pre-line; }',
      '[data-sheet] [data-tip] { cursor: help; }',
      '[data-sheet] .ds-ref:hover::after, [data-sheet] .ds-ref:focus-visible::after { content: none; }',
      // The abilities panel is a master-detail; a panel is 390px wide, so the rail sits above the card instead of beside it.
      '[data-sheet] .ds-tabs { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 10px; border-bottom: 1px solid var(--paper-edge); }',
      '[data-sheet] .ds-tab { display: inline-flex; align-items: center; gap: 6px; border: 0; border-bottom: 2px solid transparent; background: none; padding: 5px 10px; color: var(--paper-mute); font: 600 calc(12.5px * var(--ts)) var(--paper-ui-font); cursor: pointer; }',
      '[data-sheet] .ds-tab--on { color: var(--paper-ink); border-bottom-color: var(--paper-accent); }',
      '[data-sheet] .ds-tab em { font-style: normal; font-size: calc(11px * var(--ts)); color: var(--paper-mute); font-variant-numeric: tabular-nums; }',
      '[data-sheet] .ds-ab-grp--off, [data-sheet] .ds-ab-grp--empty, [data-sheet] .ds-li--hidden { display: none; }',
      '[data-sheet] .ds-ab-grp--filtering .ds-ab-grp__rows { display: block; }',
      '[data-sheet] .ds-md { display: flex; flex-direction: column; gap: 10px; }',
      '[data-sheet] .ds-rail { border: 1px solid var(--paper-edge); border-radius: 4px; max-height: 210px; overflow: hidden auto; overscroll-behavior: contain; }',
      '[data-sheet] .ds-rail__tools { position: sticky; top: 0; z-index: 2; padding: 6px; background: var(--paper-cut); border-bottom: 1px solid var(--paper-edge); }',
      '[data-sheet] .ds-rail__filter { width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--paper-edge); border-radius: 4px; background: rgb(var(--paper-hl) / calc(.55 * var(--hlk))); color: var(--paper-ink); font: 500 calc(13px * var(--ts)) var(--paper-ui-font); }',
      '[data-sheet] .ds-rail__empty { padding: 12px; text-align: center; font: 500 calc(12px * var(--ts)) var(--paper-ui-font); color: var(--paper-mute); }',
      '[data-sheet] .ds-li { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-top: 1px dashed var(--paper-edge); background: none; text-align: left; color: var(--paper-ink-soft); font: 600 calc(13.5px * var(--ts)) var(--paper-font); cursor: pointer; }',
      '[data-sheet] .ds-li:first-child { border-top: 0; }',
      '[data-sheet] .ds-li:hover { background: rgb(var(--paper-hl) / calc(.4 * var(--hlk))); }',
      '[data-sheet] .ds-li--sel { color: var(--paper-ink); background: rgb(var(--paper-hl) / calc(.6 * var(--hlk))); box-shadow: inset 3px 0 0 var(--paper-accent); }',
      '[data-sheet] .ds-li--dim { color: var(--paper-mute); }',
      '[data-sheet] .ds-li__nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '[data-sheet] .ds-li__c { margin-left: auto; flex: none; color: var(--paper-accent); font: 600 calc(12px * var(--ts)) var(--paper-ui-font); font-variant-numeric: tabular-nums; }',
      '[data-sheet] .ds-pane { min-width: 0; }',
      '[data-sheet] .ds-pane__empty { border: 1px dashed var(--paper-edge); border-radius: 4px; padding: 24px 16px; text-align: center; color: var(--paper-mute); }',
      '[data-sheet] .ds-pane__empty-t { font-weight: 700; color: var(--paper-ink-soft); }',
      '[data-sheet] .ds-pane__empty-d { font: 500 calc(12px * var(--ts)) var(--paper-ui-font); }',
      '[data-sheet] .ds-muted { color: var(--paper-mute); }',
      '[data-sheet] .ds-card { border: 1px solid var(--paper-edge); border-radius: 4px; padding: 10px 12px; background: rgb(var(--paper-hl) / calc(.3 * var(--hlk))); cursor: pointer; }',
      '[data-sheet] .ds-card:hover, [data-sheet] .ds-card:focus-visible { border-color: var(--paper-accent); }',
      '[data-sheet] .ds-card__h, [data-sheet] .ds-big__h { display: flex; align-items: center; gap: 8px; }',
      '[data-sheet] .ds-card__h { margin-bottom: 6px; }',
      '[data-sheet] .ds-card__nm, [data-sheet] .ds-big__nm { font: 700 calc(15px * var(--ts)) var(--paper-head-font); color: var(--paper-ink); }',
      '[data-sheet] .ds-card__sig { flex: none; border: 1px solid var(--paper-accent); border-radius: 3px; padding: 0 5px; color: var(--paper-accent); font: 700 calc(9.5px * var(--ts)) / 15px var(--paper-ui-font); letter-spacing: .08em; text-transform: uppercase; }',
      '[data-sheet] .ds-card__cost, [data-sheet] .ds-big__meta { margin-left: auto; flex: none; color: var(--paper-accent); font: 600 calc(11px * var(--ts)) var(--paper-ui-font); }',
      '[data-sheet] .ds-tr, [data-sheet] .ds-big__tier { display: flex; gap: 10px; padding: 3px 0; font-size: calc(13px * var(--ts)); line-height: 1.45; }',
      '[data-sheet] .ds-tr__b, [data-sheet] .ds-big__tb { flex: none; min-width: 46px; color: var(--paper-accent); font: 700 calc(11.5px * var(--ts)) / 1.7 var(--paper-ui-font); font-variant-numeric: tabular-nums; }',
      '[data-sheet] .ds-tr__t, [data-sheet] .ds-big__tt { color: var(--paper-ink); }',
      '[data-sheet] .ds-card__line { display: flex; gap: 10px; padding: 3px 0; font-size: calc(13px * var(--ts)); }',
      '[data-sheet] .ds-card__k, [data-sheet] .ds-big__sk, [data-sheet] .ds-big__block-k, [data-sheet] .ds-big__sec, [data-sheet] .ds-for__sub { color: var(--paper-mute); font: 600 calc(9.5px * var(--ts)) var(--paper-ui-font); letter-spacing: .09em; text-transform: uppercase; }',
      '[data-sheet] .ds-card__eff { padding: 3px 0; font-size: calc(13px * var(--ts)); line-height: 1.5; }',
      '[data-sheet] .ds-card__hint { margin-top: 6px; color: var(--paper-accent); font: 600 calc(11px * var(--ts)) var(--paper-ui-font); }',
      '[data-sheet] .ds-big { border: 1px solid var(--paper-accent); border-radius: 4px; background: rgb(var(--paper-hl) / calc(.3 * var(--hlk))); }',
      '[data-sheet] .ds-big__h { padding: 9px 12px; border-bottom: 1px solid var(--paper-edge); cursor: pointer; }',
      '[data-sheet] .ds-big__x { flex: none; border: 0; background: none; padding: 2px 4px; color: var(--paper-ink-soft); font: inherit; cursor: pointer; }',
      '[data-sheet] .ds-big__sec { padding: 6px 12px; border-bottom: 1px solid var(--paper-edge); }',
      '[data-sheet] .ds-big__n { margin-right: 5px; color: var(--paper-accent); }',
      '[data-sheet] .ds-big__kw { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 12px; }',
      '[data-sheet] .ds-big__kw span { border: 1px solid var(--paper-edge); border-radius: 999px; padding: 0 8px; color: var(--paper-ink-soft); font: 600 calc(10.5px * var(--ts)) var(--paper-ui-font); }',
      '[data-sheet] .ds-big__stats { display: flex; flex-wrap: wrap; border-bottom: 1px dashed var(--paper-edge); }',
      '[data-sheet] .ds-big__stat { flex: 1 1 33%; padding: 6px 12px; }',
      '[data-sheet] .ds-big__sk, [data-sheet] .ds-big__sv { display: block; }',
      '[data-sheet] .ds-big__sv { color: var(--paper-ink); font: 700 calc(13px * var(--ts)) var(--paper-font); }',
      '[data-sheet] .ds-big__flavor { padding: 8px 12px; font-style: italic; border-bottom: 1px dashed var(--paper-edge); }',
      '[data-sheet] .ds-big__ladder { display: flex; flex-direction: column; padding: 4px 12px; }',
      '[data-sheet] .ds-big__block { padding: 8px 12px; border-top: 1px dashed var(--paper-edge); font-size: calc(13px * var(--ts)); line-height: 1.5; }',
      '[data-sheet] .ds-big__block-k { margin-right: 6px; color: var(--paper-accent); }',
      '[data-sheet] .ds-for { padding: 10px 12px 12px; }',
      '[data-sheet] .ds-for__roll { margin-bottom: 8px; font-size: calc(13px * var(--ts)); }',
      '[data-sheet] .ds-for__tier { font-weight: 700; color: var(--paper-accent); }',
      '[data-sheet] .ds-for__bar { display: flex; height: 8px; margin-bottom: 6px; border-radius: 3px; overflow: hidden; background: rgb(var(--paper-burn) / .16); }',
      '[data-sheet] .ds-for__bar i { display: block; height: 100%; }',
      '[data-sheet] .ds-for__o1, [data-sheet] .ds-sw--1 { background: color-mix(in srgb, var(--paper-accent) 32%, transparent); }',
      '[data-sheet] .ds-for__o2, [data-sheet] .ds-sw--2 { background: color-mix(in srgb, var(--paper-accent) 62%, transparent); }',
      '[data-sheet] .ds-for__o3, [data-sheet] .ds-sw--3 { background: var(--paper-accent); }',
      '[data-sheet] .ds-for__key { display: flex; flex-wrap: wrap; gap: 12px; font: 500 calc(11px * var(--ts)) var(--paper-ui-font); color: var(--paper-mute); }',
      '[data-sheet] .ds-for__key b { color: var(--paper-ink); }',
      '[data-sheet] .ds-sw { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; vertical-align: middle; }',
      '[data-sheet] .ds-for__sub { margin: 8px 0 3px; }',
      // The floating definition tooltip is appended to <body>, outside the sheet, as on the box render.
      '.ds-tipbox { box-sizing: border-box; position: fixed; z-index: 9999; width: max-content; max-width: 280px; white-space: normal; padding: 8px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 500; line-height: 1.45; color: #f1f5f9; background: #1e293b; border: 1px solid rgba(168, 85, 247, 0.45); box-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.55); pointer-events: none; opacity: 0; visibility: hidden; }',
      '.ds-tipbox--measuring { left: -9999px; top: -9999px; }',
      '.ds-tipbox--visible { visibility: visible; opacity: 1; }'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'ds-character-sheet-paper-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── widget ─────────────────────────────────────────────────────────

  if (Chronicle) Chronicle.register('character-sheet', {
    init: function (el, config) {
      config = config || {};
      var ds = el.dataset || {};
      var entityId = config.entity_id || config.entityId || ds.entityId || '';
      var campaignId = config.campaign_id || config.campaignId || ds.campaignId || '';
      // csrfToken/ancestors are read for contract-compat; unused by the read-only sheet.
      var csrfToken = ds.csrfToken || '';
      void csrfToken;
      var entityObj = parseJsonAttr(ds.fieldsData, null);
      var children = parseJsonAttr(ds.children, []);

      // The renderer owns the real glossary route and degrades to an empty
      // glossary when there is no campaign id; the basePath argument has no
      // route behind it, so passing '' makes the degradation explicit.
      refRenderer = (typeof DrawSteelRefRenderer !== 'undefined')
        ? new DrawSteelRefRenderer('', campaignId)
        : null;

      if (paperAvailable()) injectPaperStyles(); else injectStyles();
      el.classList.add('ds-sheet');

      var self = this;
      function finish(entity) {
        var data = {
          // Chronicle serializes the field bundle as `fields_data` (the platform-wide
          // key — entity API and the mount seed both use it). Earlier payloads used
          // `custom_fields`; read fields_data first, fall back for compatibility.
          // Reading the wrong key here is what rendered every stat as 0.
          fields: (entity && (entity.fields_data || entity.custom_fields)) || {},
          name: (entity && entity.name) || 'Unnamed Hero',
          campaignId: campaignId,
          entityId: entityId,
          children: Array.isArray(children) ? children : [],
          // Viewer/permission context from the Chronicle mount (data-* attrs),
          // all false/empty when the host omits them. isGm gates GM Lore;
          // isOwner (with isGm) gates the private Background, so a viewer who
          // may not read them sees no box. canEditIdentity makes the origin
          // values pickable; canChangeImage shows the picture's Change chip;
          // armoryItems drops the in-sheet Inventory because
          // the host shows one item list itself.
          isGm: flag(ds.isGm),
          isOwner: flag(ds.isOwner),
          visibility: (entity && entity.visibility) || ds.visibility || '',
          canEditIdentity: flag(ds.canEditIdentity),
          canChangeImage: flag(ds.canChangeImage),
          armoryItems: flag(ds.armoryItems)
        };
        var loadRef = refRenderer ? refRenderer.load() : Promise.resolve();
        Promise.all([loadRef, loadSkillDefs(campaignId)]).then(function () {
          if (refRenderer) refRenderer.injectStyles();
          mountSheet(self, el, data);
        });
      }

      if (entityObj && (entityObj.fields_data || entityObj.custom_fields)) {
        finish(entityObj);
      } else if (entityId && campaignId) {
        fetchEntity(campaignId, entityId).then(finish).catch(function (err) {
          // The server's message is never shown verbatim — only a fixed,
          // safe string reaches the user; the real error stays in the
          // console for diagnostics.
          if (typeof console !== 'undefined') console.warn('Character Sheet: entity load failed', err);
          renderError(el, 'Failed to load character.');
        });
      } else {
        renderError(el, 'No entity context available.');
      }
    },

    destroy: function (el) {
      if (el._csSurfaceCleanup) { try { el._csSurfaceCleanup(); } catch (e) {} el._csSurfaceCleanup = null; }
      if (this._onAbilityClick) el.removeEventListener('click', this._onAbilityClick);
      if (this._onAbilityKey) el.removeEventListener('keydown', this._onAbilityKey);
      if (this._onAbilityInput) el.removeEventListener('input', this._onAbilityInput);
      if (this._onPaperKey) el.removeEventListener('keydown', this._onPaperKey, true);
      this._onPaperKey = null;
      this._onPanelReady = null;
      this._onPanelClose = null;
      this._panelBody = null;
      this._pin = null;
      if (this._onTipShow) { el.removeEventListener('mouseover', this._onTipShow); el.removeEventListener('focusin', this._onTipShow); }
      if (this._onTipHide) { el.removeEventListener('mouseout', this._onTipHide); el.removeEventListener('focusout', this._onTipHide); }
      this._onAbilityClick = null;
      this._onAbilityKey = null;
      this._onAbilityInput = null;
      this._onTipShow = null;
      this._onTipHide = null;
      if (_tipbox && _tipbox.parentNode) _tipbox.parentNode.removeChild(_tipbox);
      _tipbox = null;
      el.classList.remove('ds-sheet');
      el.innerHTML = '';
    }
  });

  if (Chronicle) registerBoxes();

  // Test seam: expose the pure helpers for Node unit tests. Inert in a browser
  // (no CommonJS `module`), so the widget's runtime behavior is unchanged.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      groupOf: groupOf, charLabel: charLabel, firstName: firstName, slugify: slugify,
      humanizeId: humanizeId, powerRollLabel: powerRollLabel, distanceLabel: distanceLabel,
      targetLabel: targetLabel, costLabel: costLabel, safeEvalArith: safeEvalArith,
      substituteFormula: substituteFormula, tierFragments: tierFragments, tierOdds: tierOdds,
      classifyFeature: classifyFeature, htmlToText: htmlToText,
      stripEnrichers: stripEnrichers, cleanFoundryText: cleanFoundryText,
      cleanFoundryProse: cleanFoundryProse, SKILL_TO_GROUP: SKILL_TO_GROUP,
      esc: esc, escAttr: escAttr, safeImgUrl: safeImgUrl, rIdentity: rIdentity, buildSchema: buildSchema, rVitals: rVitals, rAbilities: rAbilities, rKit: rKit,
      clampTooltipPos: clampTooltipPos, fetchEntity: fetchEntity,
      paperAvailable: paperAvailable, paperSheetHtml: paperSheetHtml, paperPanels: paperPanels,
      pIdentity: pIdentity, pTurn: pTurn, pKitPart: pKitPart, pKitPanel: pKitPanel,
      pItemsPanel: pItemsPanel, pFeaturesPanel: pFeaturesPanel, pSkillsPanel: pSkillsPanel,
      pNotesPanel: pNotesPanel, pDamagePanel: pDamagePanel, storyPinHtml: storyPinHtml,
      staminaState: staminaState, mountSheet: mountSheet
    };
  }
})();
