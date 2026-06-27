/**
 * Draw Steel Character Sheet Widget — dynamic-surface adopter.
 *
 * Mounts on a drawsteel-character entity page via Chronicle's manifest-driven
 * renderer registration (CH4.5). Reads entity fields_data + children from the
 * mount div's data attributes for first paint without an API call; falls back
 * to the entities API when embedded as a plain widget (pre-CH4.5).
 *
 * MOUNT CONTRACT (do not change — the manifest binding
 * `drawsteel-character → character-sheet` and CH4.5's renderer depend on it):
 *   Chronicle.register('character-sheet', { init, destroy })
 *   init reads el.dataset.{fieldsData,entityId,campaignId,csrfToken,children}
 *     - fieldsData parses to the entity object ({ name, custom_fields, … })
 *
 * RENDER MODEL (2026-06-22): instead of one big innerHTML string, the sheet
 * mounts via Chronicle's dynamic-surface frame (`Chronicle.surface`). Each of
 * the former sections is a SYSTEM box renderer (`registerBox('ds-*', fn)`); the
 * frame owns the box chrome (collapsible title bar, motion, localStorage view
 * state). Renderers therefore emit INNER content only (no `.cs-card` wrapper),
 * reusing the existing `cs-*` styles. The schema is built per-mount from the
 * entity data and only includes boxes that have content, so empty sections are
 * absent rather than rendered as empty titled boxes.
 *
 * DYNAMIC WIN: ability cards are compact in-box and open a power-roll OVERLAY
 * on click (Chronicle.surface.overlay.push), wired via one delegated listener.
 *
 * READ-ONLY: Foundry is the source of truth; Chronicle mirrors fields_data
 * one-way. This widget never writes/saves.
 *
 * LAYOUT / Option C: cross-system surfaces still mount as Chronicle blocks via
 * the reserved slot points appended after the surface (character_skills /
 * character_inventory / character_purchase_history); inert + hidden until
 * Chronicle's block registry surfaces a stable hydration path. Names are
 * placeholders — coordinate with the Chronicle dev before relying on them.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.Chronicle) return;
  var Chronicle = window.Chronicle;

  // Module-singleton reference renderer. One Draw Steel system per page, so a
  // single shared renderer (and its glossary cache) backs every box renderer.
  var refRenderer = null;

  // ── primitive helpers ──────────────────────────────────────────────

  function esc(s) {
    return Chronicle.escapeHtml(s == null ? '' : String(s));
  }

  // refText escapes THEN resolves {@category term} tokens to ref spans. Safe to
  // call before the glossary loads (renderText degrades to plain text), but the
  // mount is deferred until refRenderer.load() resolves so first paint is lit.
  function refText(s) {
    var e = esc(s);
    return refRenderer ? refRenderer.renderText(e) : e;
  }

  function parseJson(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
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

  // ── box renderers (INNER content only; the frame owns the box chrome) ──
  // Each is a pure function of (boxDef, seed). Registered once via registerBoxes.

  function rHeader(def, data) {
    var name = data.name || 'Unnamed Hero';
    var portrait = f(data, 'portrait_url', '');
    var level = num(data, 'level', 1);
    var ancestry = f(data, 'ancestry', '');
    var className = f(data, 'class', '');
    var subclass = f(data, 'subclass', '');
    var kit = f(data, 'kit', '');
    var faction = f(data, 'faction', '');

    var parts = [];
    if (ancestry) parts.push(esc(ancestry));
    if (className) parts.push(esc(className) + (subclass ? ' (' + esc(subclass) + ')' : ''));
    if (kit) parts.push(esc(kit) + ' kit');
    var subtitle = parts.join(' &bull; ');

    var portraitHtml = portrait
      ? '<img class="cs-portrait" src="' + esc(portrait) + '" alt="' + esc(name) + '">'
      : '<div class="cs-portrait cs-portrait-placeholder"><i class="fa-solid fa-shield-halved"></i></div>';

    // Status pills (claimed / visibility) — only when the host supplied context.
    var pills = '';
    if (data.claimed) {
      pills += '<span class="cs-pill cs-pill--claim"><i class="fa-solid fa-circle-check"></i> Claimed by you</span>';
    }
    if (data.visibility) {
      pills += '<span class="cs-pill">Visibility: ' + esc(String(data.visibility)) + '</span>';
    }

    // v3 action affordances + live dot (display-first; behavior is a follow-up).
    var actions = '<div class="cs-header-actions">' +
      '<button type="button" class="cs-act cs-act--primary" data-cs-act="roll"><i class="fa-solid fa-dice-d20"></i> Roll</button>' +
      '<button type="button" class="cs-act" data-cs-act="levelup"><i class="fa-solid fa-arrow-up-right-dots"></i> Level Up</button>' +
      '<button type="button" class="cs-act" data-cs-act="share"><i class="fa-solid fa-share-nodes"></i> Share</button>' +
      '<span class="cs-live" title="Live"><span class="cs-live-dot"></span> live</span>' +
    '</div>';

    return '<div class="cs-header">' +
      portraitHtml +
      '<div class="cs-header-text">' +
        '<div class="cs-header-name">' + esc(name) + '</div>' +
        '<div class="cs-header-meta">' +
          '<span class="cs-level-badge">Level ' + level + '</span>' +
          (subtitle ? '<span class="cs-header-subtitle">' + subtitle + '</span>' : '') +
          (faction ? '<span class="cs-header-faction">' + esc(faction) + '</span>' : '') +
        '</div>' +
        (pills ? '<div class="cs-header-pills">' + pills + '</div>' : '') +
      '</div>' +
      actions +
    '</div>';
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

  // rVitals is the v3 composite "top stats" box: stamina bar + recoveries (dots)
  // + heroic resource (pips) + a Roll Might button on the left, and the
  // characteristics grid on the right. Folds in the former Characteristics and
  // Heroic-Resource boxes so the layout matches the reference.
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
    var hrMax = num(data, 'heroic_resource_max', 0);

    var left =
      '<div class="cs-bar-wrap">' +
        '<div class="cs-bar-label">Stamina <span class="cs-bar-value">' + current + ' / ' + max + '</span></div>' +
        '<div class="cs-bar"><div class="cs-bar-fill' + dangerClass + '" style="width:' + pct + '%"></div>' +
          (winded > 0 ? '<div class="cs-bar-threshold" style="left:' + windedPct + '%" title="Winded"></div>' : '') +
        '</div>' +
        (winded > 0 ? '<div class="cs-bar-sub">Winded at ' + winded + '</div>' : '') +
      '</div>' +
      '<div class="cs-statline"><span class="cs-statline-label">Recoveries</span>' +
        renderPips(recoveries, recoveriesMax, '●', '○', 'cs-dots') + '</div>' +
      '<div class="cs-statline"><span class="cs-statline-label">' + esc(hrName) + '</span>' +
        renderPips(hrCur, hrMax, '◆', '◇', 'cs-hr-pips') + '</div>' +
      '<button type="button" class="cs-act cs-act--primary cs-roll-might" data-cs-act="roll-might">' +
        '<i class="fa-solid fa-dice-d20"></i> Roll Might</button>';

    var right =
      '<div class="cs-vitals-stats">' +
        '<div class="cs-subhead">Characteristics</div>' +
        rCharacteristics(def, data) +
      '</div>';

    return '<div class="cs-vitals"><div class="cs-vitals-main">' + left + '</div>' + right + '</div>';
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
  function rHeroicResource(def, data) {
    // The box title carries the resource NAME (computed at schema-build); the
    // body is just the bar.
    var current = num(data, 'heroic_resource_current', NaN);
    var max = num(data, 'heroic_resource_max', NaN);
    var currentTxt = isNaN(current) ? '0' : String(current);
    var maxTxt = isNaN(max) ? '' : ' / ' + max;
    var pct = (!isNaN(current) && !isNaN(max) && max > 0)
      ? Math.max(0, Math.min(100, (current / max) * 100))
      : (isNaN(current) ? 0 : Math.min(100, current * 10));

    return '<div class="cs-bar-wrap">' +
        '<div class="cs-bar-label"><span class="cs-bar-value">' + currentTxt + maxTxt + '</span></div>' +
        '<div class="cs-bar"><div class="cs-bar-fill cs-bar-accent" style="width:' + pct + '%"></div></div>' +
      '</div>';
  }

  function rMovement(def, data) {
    var speed = num(data, 'speed', 0);
    var stability = num(data, 'stability', 0);
    return '<div class="cs-chip-row">' +
        '<div class="cs-chip"><span class="cs-chip-label">Speed</span><span class="cs-chip-value">' + speed + '</span></div>' +
        '<div class="cs-chip"><span class="cs-chip-label">Stability</span><span class="cs-chip-value">' + stability + '</span></div>' +
      '</div>';
  }

  // rCombat is the v3 COMBAT panel: an in-combat/round status line, the
  // Initiative / Speed / Stability chips, and condition pills. Always rendered
  // (placeholders when empty); combat state + conditions populate via sync later.
  function rCombat(def, data) {
    var inCombat = num(data, 'in_combat', 0);
    var round = num(data, 'combat_round', 0);
    var status = inCombat
      ? '<div class="cs-combat-status cs-combat-status--active"><span class="cs-combat-dot"></span> In combat' +
          (round ? ' &mdash; round ' + esc(String(round)) : '') + '</div>'
      : '<div class="cs-combat-status">Not in combat</div>';

    var chip = function (label, key) {
      var v = f(data, key, null);
      var val = (v == null || v === '') ? '–' : esc(String(scalar(v)));
      return '<div class="cs-chip"><span class="cs-chip-label">' + esc(label) + '</span>' +
        '<span class="cs-chip-value">' + val + '</span></div>';
    };
    var chips = '<div class="cs-chip-row">' +
      chip('Initiative', 'initiative') + chip('Speed', 'speed') + chip('Stability', 'stability') +
    '</div>';

    var conds = parseJson(f(data, 'conditions_json', ''), []);
    var pills;
    if (conds && conds.length) {
      pills = '<div class="cs-cond-row">' + conds.map(function (c) {
        var name = (c && (c.name || c)) || '';
        var sev = (c && c.severity) || '';
        var cls = 'cs-cond';
        if (/bleed|burn|dam|poison/i.test(name + ' ' + sev)) cls += ' cs-cond--danger';
        else if (/slow|weak|daz|frighten|restrain/i.test(name + ' ' + sev)) cls += ' cs-cond--warn';
        return '<span class="' + cls + '">' + esc(String(name)) + '</span>';
      }).join('') + '</div>';
    } else {
      pills = ph('No conditions.');
    }
    return status + chips + pills;
  }
  function rDamage(def, data) {
    var imm = parseJson(f(data, 'immunities', ''), []);
    var weak = parseJson(f(data, 'weaknesses', ''), []);

    var rowFor = function (entry) {
      if (entry == null) return '';
      if (typeof entry === 'string') return esc(entry);
      var type = entry.type ? esc(String(entry.type)) : '';
      var value = (entry.value != null && entry.value !== '') ? ' ' + esc(String(entry.value)) : '';
      return type + value;
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

    return (immHtml + weakHtml) || ph('No immunities or weaknesses.');
  }
  var ABILITY_TYPE_ORDER = ['signature', 'action', 'maneuver', 'triggered', 'free-strike', 'trait'];
  var ABILITY_TYPE_LABELS = {
    'signature': 'Signature', 'action': 'Actions', 'maneuver': 'Maneuvers',
    'triggered': 'Triggered', 'free-strike': 'Free Strikes', 'trait': 'Traits'
  };

  function rAbilities(def, data) {
    var abilities = parseAbilities(data);
    if (!abilities.length) return ph('No abilities yet.');

    // Group by type while preserving each ability's ORIGINAL flat index — the
    // index is what the overlay handler looks up, so the two must agree.
    var groups = {};
    abilities.forEach(function (a, idx) {
      var t = (a && a.type) || 'action';
      if (!groups[t]) groups[t] = [];
      groups[t].push({ a: a, idx: idx });
    });

    function groupHtml(t) {
      if (!groups[t] || !groups[t].length) return '';
      var label = ABILITY_TYPE_LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1));
      var rows = groups[t].map(function (g) { return abilityRow(g.a, g.idx); }).join('');
      return '<div class="cs-ability-group">' +
        '<h4 class="cs-ability-group-title">' + esc(label) + '</h4>' +
        '<div class="cs-ability-list">' + rows + '</div>' +
      '</div>';
    }

    var html = ABILITY_TYPE_ORDER.map(groupHtml).join('');
    Object.keys(groups).forEach(function (t) {
      if (ABILITY_TYPE_ORDER.indexOf(t) === -1) html += groupHtml(t);
    });
    return html;
  }
  function rFeatures(def, data) {
    var classFt = parseJson(f(data, 'class_features_json', ''), []);
    var ancestryFt = parseJson(f(data, 'ancestry_features_json', ''), []);
    var kitFt = parseJson(f(data, 'kit_features_json', ''), []);

    var renderFt = function (ft) {
      var name = esc(ft.name || 'Feature');
      var levelTag = ft.level ? '<span class="cs-tag cs-tag-level">L' + esc(String(ft.level)) + '</span>' : '';
      var desc = ft.description ? '<div class="cs-feature-desc">' + refText(ft.description) + '</div>' : '';
      var source = ft.source ? '<div class="cs-feature-source">' + esc(String(ft.source)) + '</div>' : '';
      return '<article class="cs-feature"><header class="cs-feature-header">' +
        '<span class="cs-feature-name">' + name + '</span>' + levelTag +
      '</header>' + source + desc + '</article>';
    };

    var groupHtml = function (label, list) {
      if (!list || !list.length) return '';
      return '<div class="cs-feature-group">' +
        '<h4 class="cs-feature-group-title">' + esc(label) + '</h4>' +
        '<div class="cs-feature-list">' + list.map(renderFt).join('') + '</div>' +
      '</div>';
    };

    var out = groupHtml('Class', classFt) + groupHtml('Ancestry', ancestryFt) + groupHtml('Kit', kitFt);
    return out || ph('No features yet.');
  }

  function rProgression(def, data) {
    var entries = [
      { label: 'XP', key: 'xp' },
      { label: 'Victories', key: 'victories' },
      { label: 'Renown', key: 'renown' },
      { label: 'Project Points', key: 'project_points' },
      { label: 'Wealth', key: 'wealth' }
    ];
    // v3: always render all five chips; unset values show "–" so the section's
    // structure is visible even on a fresh hero.
    var chips = entries.map(function (e) {
      var v = f(data, e.key, null);
      var val = (v == null || v === '') ? '–' : esc(String(v));
      return '<div class="cs-chip"><span class="cs-chip-label">' + esc(e.label) + '</span>' +
        '<span class="cs-chip-value">' + val + '</span></div>';
    }).join('');
    return '<div class="cs-chip-row">' + chips + '</div>';
  }

  function rInventory(def, data) {
    var items = invItems(data);
    if (!items.length) return ph('Empty.');
    var cid = data.campaignId;
    var rows = items.map(function (it) {
      var entity = it.entity || it;
      var name = esc(entity.name || 'Item');
      var qty = (it.metadata && it.metadata.quantity) ? ' &times; ' + esc(String(it.metadata.quantity)) : '';
      var equipped = (it.metadata && it.metadata.equipped) ? ' <span class="cs-tag">equipped</span>' : '';
      var href = (entity.id && cid) ? '/campaigns/' + cid + '/entities/' + entity.id : '';
      var label = href
        ? '<a class="cs-inventory-link" href="' + esc(href) + '">' + name + '</a>'
        : name;
      return '<li class="cs-inventory-item">' + label + qty + equipped + '</li>';
    }).join('');
    return '<ul class="cs-inventory-list">' + rows + '</ul>';
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
      '<p class="cs-bg__teaser">' + esc(teaser(notes, 180)) + '</p>' +
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
      '<div class="cs-reading__body">' + refText(prose) + '</div>';
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

  // abilityRow — one accordion item: a ONE-LINER button (star + name + a muted
  // glance of distance / power-roll + a chevron) and a collapsed detail panel
  // below it. Clicking the row expands the detail IN PLACE (no overlay); the
  // panel is filled lazily on first open by attachInteractions. Native <button>
  // so Enter/Space activate it for free.
  // abilityTypeLabel returns the singular badge label for an ability type
  // (ABILITY_TYPE_LABELS holds the plural group headings).
  function abilityTypeLabel(t) {
    var map = { signature: 'Signature', action: 'Action', maneuver: 'Maneuver', triggered: 'Triggered', 'free-strike': 'Free Strike', trait: 'Trait' };
    return map[t] || (t.charAt(0).toUpperCase() + t.slice(1));
  }

  function abilityRow(a, idx) {
    var name = esc(a.name || 'Untitled Ability');
    var star = a.type === 'signature' ? '<span class="cs-ability-row__star" aria-hidden="true">&#9733;</span>' : '';
    var glance = [];
    if (a.distance) glance.push(esc(String(a.distance)));
    if (a.power_roll) glance.push(esc(String(a.power_roll)));
    var glanceHtml = glance.length
      ? '<span class="cs-ability-row__meta">' + glance.join(' &middot; ') + '</span>'
      : '';

    // v3.1 right-aligned badges: a cost pill (e.g. "3 Heroic") + a type label
    // (Signature / Triggered / …).
    var cost = a.spend_resource || a.spend_vp || a.cost;
    var costPill = cost ? '<span class="cs-ability-cost">' + esc(String(cost)) + '</span>' : '';
    var typeBadge = '';
    if (a.type) {
      var t = String(a.type);
      var tcls = (t === 'signature') ? ' cs-ability-badge--sig' : (t === 'triggered') ? ' cs-ability-badge--trig' : '';
      typeBadge = '<span class="cs-ability-badge' + tcls + '">' + esc(abilityTypeLabel(t)) + '</span>';
    }
    var badges = (costPill || typeBadge)
      ? '<span class="cs-ability-row__badges">' + costPill + typeBadge + '</span>'
      : '';

    return '<div class="cs-ability-item">' +
      '<button type="button" class="cs-ability-row" data-ds-ability="' + idx + '"' +
          ' aria-expanded="false" aria-label="' + name + ' — toggle details">' +
        star +
        '<span class="cs-ability-row__name">' + name + '</span>' +
        glanceHtml +
        badges +
        '<span class="cs-ability-row__more" aria-hidden="true">&rsaquo;</span>' +
      '</button>' +
      '<div class="cs-ability-acc" data-ds-acc></div>' +
    '</div>';
  }

  // renderAbilityBody — the inline accordion detail for one ability: keywords +
  // a stat rail (distance / target / spend) + the power-roll band + the tinted
  // miss→partial→hit tier ladder + trigger / effect. No banner — the one-liner
  // row above already shows the name. Text fields run through refText so {@…}
  // tokens light up. READ-ONLY (Foundry is the source of truth).
  function renderAbilityBody(a) {
    var keywords = (a.keywords && a.keywords.length)
      ? '<div class="cs-ad__keywords">' + a.keywords.map(function (k) {
          return '<span class="cs-tag">' + esc(String(k)) + '</span>';
        }).join('') + '</div>'
      : '';

    // Stat rail — distance / target / spend as compact cards. Omitted when empty.
    var stats = [];
    if (a.distance) stats.push('<div class="cs-ad__stat"><span class="cs-ad__stat-k">Distance</span><span class="cs-ad__stat-v">' + esc(String(a.distance)) + '</span></div>');
    if (a.target) stats.push('<div class="cs-ad__stat"><span class="cs-ad__stat-k">Target</span><span class="cs-ad__stat-v">' + esc(String(a.target)) + '</span></div>');
    var spendTxt = a.spend_vp || a.spend_resource;
    if (spendTxt) stats.push('<div class="cs-ad__stat cs-ad__stat--spend"><span class="cs-ad__stat-k">Spend</span><span class="cs-ad__stat-v">' + esc(String(spendTxt)) + '</span></div>');
    var statRail = stats.length ? '<div class="cs-ad__stats">' + stats.join('') + '</div>' : '';

    // Power roll band.
    var prHtml = a.power_roll
      ? '<div class="cs-ad__pr"><span class="cs-ad__pr-k">Power Roll</span><span class="cs-ad__pr-v">' + esc(String(a.power_roll)) + '</span></div>'
      : '';

    // Tier ladder — the centerpiece. Each rung shows its band + outcome, tinted
    // miss→partial→hit for an at-a-glance read.
    var ladder = '';
    if (a.tier1 || a.tier2 || a.tier3) {
      var rung = function (band, txt) {
        if (!txt) return '';
        return '<div class="cs-ad__tier"><span class="cs-ad__tier-band">' + band + '</span>' +
          '<span class="cs-ad__tier-text">' + refText(txt) + '</span></div>';
      };
      ladder = '<div class="cs-ad__ladder">' +
        rung('&le;11', a.tier1) + rung('12&ndash;16', a.tier2) + rung('17+', a.tier3) +
      '</div>';
    }

    var trigger = a.trigger ? '<div class="cs-ad__block"><span class="cs-ad__block-k">Trigger</span><div class="cs-ad__block-v">' + refText(a.trigger) + '</div></div>' : '';
    var effect = a.effect ? '<div class="cs-ad__block"><span class="cs-ad__block-k">Effect</span><div class="cs-ad__block-v">' + refText(a.effect) + '</div></div>' : '';

    return '<div class="cs-ad cs-ad--inline"><div class="cs-ad__body">' +
      keywords + statRail + prHtml + ladder + trigger + effect +
    '</div></div>';
  }

  // ── empty-state placeholder ──────────────────────────────────────────────
  // v3: every section ALWAYS renders (no content gating) so the sheet's
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

  // buildSchema assembles the rows/columns/boxes for `data`, omitting any box
  // whose content predicate is false so empty sections are absent entirely.
  function buildSchema(data) {
    var rows = [];

    // Row 1 — identity banner (headless pinned box; head hidden via CSS).
    rows.push({ columns: [ { width: 12, boxes: [
      boxDef('ds-header', '', 'ds-header', 'expanded', { pinned: true })
    ] } ] });

    // Row 2 — main column (8) + side column (4). v3: ALL sections always render;
    // each box's renderer shows a placeholder when its data is absent, so the
    // sheet's full structure is visible even on a fresh/unsynced hero.
    // v3.1: Vitals is now a composite box (stamina + recoveries + heroic
    // resource + Roll Might + characteristics), so the standalone Characteristics
    // and Heroic-Resource boxes are folded in and dropped here.
    var main = [
      boxDef('ds-vitals', 'Vitals', 'ds-vitals', 'expanded', { pinned: true }),
      boxDef('ds-abilities', 'Abilities', 'ds-abilities', 'expanded')
    ];
    var side = [
      boxDef('ds-combat', 'Combat', 'ds-combat', 'expanded', { pinned: true }),
      boxDef('ds-damage', 'Damage', 'ds-damage', 'collapsed'),
      boxDef('ds-progression', 'Progression', 'ds-progression', 'collapsed')
    ];
    rows.push({ columns: [ { width: 8, boxes: main }, { width: 4, boxes: side } ] });

    // Row 3 — Features (6) + Inventory (6), always present.
    rows.push({ columns: [
      { width: 6, boxes: [ boxDef('ds-features', 'Features', 'ds-features', 'collapsed') ] },
      { width: 6, boxes: [ boxDef('ds-inventory', 'Inventory', 'ds-inventory', 'collapsed') ] }
    ] });

    // Row 4 — Background (12). Pinned/expanded: the box shows a teaser + a
    // "Read full story" that opens the reading-view overlay (not an accordion).
    rows.push({ columns: [ { width: 12, boxes: [
      boxDef('ds-notes', 'Background', 'ds-notes', 'expanded', { pinned: true })
    ] } ] });

    // Row 5 — GM Lore (12), GM ONLY. Scheduled solely when the viewer is a GM so
    // DM-only content never reaches a player (a permission gate, not a data gate).
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
    s.registerBox('ds-header', rHeader);
    s.registerBox('ds-vitals', rVitals);
    s.registerBox('ds-characteristics', rCharacteristics);
    s.registerBox('ds-heroic-resource', rHeroicResource);
    s.registerBox('ds-movement', rMovement);
    s.registerBox('ds-combat', rCombat);
    s.registerBox('ds-damage', rDamage);
    s.registerBox('ds-abilities', rAbilities);
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

  // expandAcc / collapseAcc animate a panel's height (0 ↔ content) with the inner
  // detail fading in. After opening, height is set to auto so the content can
  // reflow; on close it stays at 0 but the content is kept for an instant reopen.
  function expandAcc(row, acc) {
    row.setAttribute('aria-expanded', 'true');
    var inner = acc.firstChild;
    if (reduced()) { acc.style.height = 'auto'; if (inner) inner.style.opacity = '1'; return; }
    var h = inner ? inner.offsetHeight : acc.scrollHeight;
    acc.style.height = '0px';
    acc.style.transition = 'height 240ms cubic-bezier(.4,0,.2,1)';
    if (inner) { inner.style.opacity = '0'; inner.style.transition = 'opacity 220ms ease 40ms'; }
    requestAnimationFrame(function () { acc.style.height = h + 'px'; if (inner) inner.style.opacity = '1'; });
    var done = function (e) {
      if (e && (e.target !== acc || e.propertyName !== 'height')) return;
      acc.style.height = 'auto'; acc.style.transition = '';
      acc.removeEventListener('transitionend', done);
    };
    acc.addEventListener('transitionend', done);
  }
  function collapseAcc(row, acc) {
    row.setAttribute('aria-expanded', 'false');
    var inner = acc.firstChild;
    if (reduced()) { acc.style.height = '0px'; return; }
    acc.style.height = acc.offsetHeight + 'px';
    acc.style.transition = 'height 220ms cubic-bezier(.4,0,.2,1)';
    if (inner) inner.style.opacity = '0';
    requestAnimationFrame(function () { acc.style.height = '0px'; });
  }

  // attachInteractions wires ONE delegated click listener on the mounted root:
  //   • a [data-ds-ability] one-liner row toggles its inline accordion detail
  //     (the detail body is built lazily on first open)
  //   • the [data-cs-read-story] button opens the backstory reading view
  // Rows are native <button>s, so Enter/Space activate them without a separate
  // keydown handler. No per-card listeners (the frame re-renders box bodies).
  function attachInteractions(inst, el, data) {
    var abilities = parseAbilities(data);
    function toggleAbility(row) {
      var item = row.parentNode;
      var acc = item ? item.querySelector('[data-ds-acc]') : null;
      var a = abilities[parseInt(row.getAttribute('data-ds-ability'), 10)];
      if (!acc || !a) return;
      if (row.getAttribute('aria-expanded') === 'true') { collapseAcc(row, acc); return; }
      if (!acc.firstChild) {
        var inner = document.createElement('div');
        inner.className = 'cs-ability-acc__inner';
        inner.innerHTML = renderAbilityBody(a);
        acc.appendChild(inner);
      }
      expandAcc(row, acc);
    }
    inst._onAbilityClick = function (e) {
      var rs = (e.target && e.target.closest) ? e.target.closest('[data-cs-read-story]') : null;
      if (rs) { e.preventDefault(); openReadingView(data.name || 'Background', f(data, 'notes', '')); return; }
      var row = (e.target && e.target.closest) ? e.target.closest('[data-ds-ability]') : null;
      if (row) { e.preventDefault(); toggleAbility(row); }
    };
    el.addEventListener('click', inst._onAbilityClick);
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
  }

  function mountSheet(inst, el, data) {
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
    playEntrance(el);
  }

  // ── API fetch fallback (pre-CH4.5 embed without data attributes) ───

  function fetchEntity(cid, eid) {
    var url = '/api/v1/campaigns/' + cid + '/entities/' + eid;
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
      // v3.1 sheet ACCENT (the "highlight"). Scoped to the sheet and driven by an
      // overridable var so a future owner-page setting can recolor it (and add
      // highlight 2/3) by setting --ds-accent / --ds-accent-rgb on .ds-sheet —
      // no CSS change needed. Default = violet.
      '.ds-sheet { --color-accent: var(--ds-accent, #a855f7); --color-accent-rgb: var(--ds-accent-rgb, 168,85,247); }',
      // v3.1 Vitals composite: stamina/recoveries/HR/roll on the left, the
      // characteristics grid on the right (stacks on narrow widths).
      '.cs-vitals { display:flex; flex-wrap:wrap; gap:16px 24px; align-items:flex-start; }',
      '.cs-vitals-main { flex:1 1 220px; min-width:200px; display:flex; flex-direction:column; gap:10px; }',
      '.cs-vitals-stats { flex:1 1 280px; min-width:240px; }',
      '.cs-subhead { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-text-muted,#9ca3af); margin-bottom:8px; }',
      '.cs-statline { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:12px; }',
      '.cs-statline-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-dots, .cs-hr-pips { letter-spacing:2px; font-size:13px; color:var(--color-accent,#a855f7); }',
      '.cs-pips-count { margin-left:8px; font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); letter-spacing:normal; font-variant-numeric:tabular-nums; }',
      '.cs-pips-empty { color:var(--color-text-muted,#9ca3af); }',
      '.cs-roll-might { align-self:flex-start; margin-top:2px; }',
      // v3.1 ability badges (right-aligned: cost pill + type label).
      '.cs-ability-row__badges { margin-left:auto; display:inline-flex; align-items:center; gap:6px; flex:none; }',
      '.cs-ability-badge { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; background:rgba(var(--color-accent-rgb,168,85,247),0.14); color:var(--color-accent,#a855f7); }',
      '.cs-ability-cost { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:10px; font-weight:600; background:var(--color-accent,#a855f7); color:#fff; }',
      // ── Headless identity banner + clean pinned boxes (frame box hooks) ──
      '.cs-box[data-box-key="ds-header"] > .cs-box__head { display:none; }',
      '.cs-box[data-box-key="ds-header"] > .cs-box__body { padding:16px; }',
      '.cs-box[data-box-pinned] .cs-box__caret { display:none; }',
      '.cs-box[data-box-pinned] .cs-box__toggle { cursor:default; }',
      // ── Header ──
      '.cs-header { display:flex; gap:16px; align-items:center; }',
      '.cs-portrait { width:88px; height:88px; border-radius:12px; object-fit:cover; flex-shrink:0; border:2px solid var(--color-border,#e5e7eb); background:var(--color-bg-tertiary,#f3f4f6); }',
      '.cs-portrait-placeholder { display:flex; align-items:center; justify-content:center; color:var(--color-text-muted,#9ca3af); font-size:32px; }',
      '.cs-header-text { display:flex; flex-direction:column; gap:6px; min-width:0; flex:1; }',
      '.cs-header-name { font-size:24px; font-weight:700; line-height:1.1; color:var(--color-text-primary,#111827); font-family:var(--font-campaign,Inter,system-ui,-apple-system,sans-serif); }',
      '.cs-header-meta { display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; font-size:13px; color:var(--color-text-secondary,#6b7280); }',
      '.cs-level-badge { display:inline-flex; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:600; background:var(--color-accent,#6366f1); color:#fff; }',
      '.cs-header-faction { font-style:italic; }',
      // ── Bars (stamina, heroic resource) ──
      '.cs-bar-wrap { display:flex; flex-direction:column; gap:4px; }',
      '.cs-bar-label { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; font-weight:600; color:var(--color-text-body,#374151); }',
      '.cs-bar-value { font-variant-numeric:tabular-nums; color:var(--color-text-primary,#111827); }',
      '.cs-bar { position:relative; height:10px; background:var(--color-bg-tertiary,#f3f4f6); border-radius:9999px; overflow:hidden; }',
      '.cs-bar-fill { height:100%; background:#10b981; border-radius:9999px; transition:width 200ms ease; }',
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
      '.cs-stat-row { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }',
      '.cs-stat { display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 6px; border-radius:8px; border:1px solid var(--color-border-light,#f3f4f6); background:var(--color-bg-primary,#f9fafb); }',
      '.cs-stat-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-stat-value { font-size:22px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }',
      '.cs-stat-positive .cs-stat-value { color:#047857; }',
      '.cs-stat-negative .cs-stat-value { color:#b91c1c; }',
      '.cs-stat-zero .cs-stat-value { color:var(--color-text-secondary,#6b7280); }',
      // ── Damage ──
      '.cs-damage-row { display:flex; gap:10px; align-items:flex-start; padding:6px 0; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-damage-row:last-child { border-bottom:none; }',
      '.cs-damage-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); width:100px; flex-shrink:0; padding-top:4px; }',
      '.cs-damage-list { display:flex; flex-wrap:wrap; gap:6px; flex:1; }',
      // ── Abilities ──
      '.cs-ability-group { margin-top:14px; }',
      '.cs-ability-group:first-child { margin-top:0; }',
      '.cs-ability-group-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-accent,#6366f1); margin:0 0 6px; }',
      // One-liner ability rows: name + muted glance + chevron; click zooms the full card.
      '.cs-ability-list { display:flex; flex-direction:column; border-radius:10px; overflow:hidden; border:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-ability-item { border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-ability-list .cs-ability-item:last-child { border-bottom:0; }',
      '.cs-ability-row { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:9px 12px; background:var(--color-bg-primary,#f9fafb); border:0; font:inherit; cursor:pointer; transition:background 120ms ease; }',
      '.cs-ability-row:hover { background:rgba(var(--color-accent-rgb,99,102,241),0.06); }',
      '.cs-ability-row[aria-expanded="true"] { background:rgba(var(--color-accent-rgb,99,102,241),0.06); }',
      '.cs-ability-row:focus-visible { outline:2px solid var(--color-accent,#6366f1); outline-offset:-2px; }',
      '.cs-ability-row__star { flex:none; color:var(--color-accent,#6366f1); font-size:13px; }',
      '.cs-ability-row__name { flex:none; font-weight:600; font-size:14px; color:var(--color-text-primary,#111827); }',
      '.cs-ability-row__meta { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--color-text-muted,#9ca3af); font-variant-numeric:tabular-nums; }',
      '.cs-ability-row__more { flex:none; margin-left:auto; font-size:18px; line-height:1; color:var(--color-text-muted,#9ca3af); transition:color 150ms ease, transform 200ms cubic-bezier(.4,0,.2,1); }',
      '.cs-ability-row:not([aria-expanded="true"]):hover .cs-ability-row__more { color:var(--color-accent,#6366f1); transform:translateX(2px); }',
      '.cs-ability-row[aria-expanded="true"] .cs-ability-row__more { color:var(--color-accent,#6366f1); transform:rotate(90deg); }',
      '.cs-ability-acc { height:0; overflow:hidden; }',
      '.cs-ability-acc__inner { opacity:0; }',
      '.cs-ad--inline { max-width:none; margin:0; padding:12px 14px 16px; border-top:3px solid var(--color-accent,#a855f7); background:rgba(var(--color-accent-rgb,168,85,247),0.05); }',
      '.cs-ad--inline .cs-ad__keywords { margin-top:0; }',
      // ── Ability detail overlay — the zoom destination (expansive, centered) ──
      '.cs-ad { max-width:760px; margin:0 auto; padding:6px 6px 14px; }',
      '.cs-ad__banner { padding:22px 26px; border-radius:14px; margin-bottom:18px; background:linear-gradient(135deg,rgba(var(--color-accent-rgb,99,102,241),0.14),rgba(var(--color-accent-rgb,99,102,241),0.03)); border:1px solid rgba(var(--color-accent-rgb,99,102,241),0.18); }',
      '.cs-ad__title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }',
      '.cs-ad__star { color:var(--color-accent,#6366f1); font-size:20px; }',
      '.cs-ad__name { font-size:26px; font-weight:800; line-height:1.1; letter-spacing:-0.01em; color:var(--color-text-primary,#111827); font-family:var(--font-campaign,Inter,system-ui,-apple-system,sans-serif); }',
      '.cs-ad__type { padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; background:var(--color-accent,#6366f1); color:#fff; }',
      '.cs-ad__keywords { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }',
      '.cs-ad__body { display:flex; flex-direction:column; gap:16px; }',
      '.cs-ad__stats { display:flex; flex-wrap:wrap; gap:10px; }',
      '.cs-ad__stat { display:flex; flex-direction:column; gap:2px; padding:10px 14px; border-radius:10px; background:var(--color-bg-tertiary,#f3f4f6); min-width:120px; flex:1; }',
      '.cs-ad__stat--spend { background:rgba(var(--color-accent-rgb,99,102,241),0.10); }',
      '.cs-ad__stat-k { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-ad__stat-v { font-size:16px; font-weight:600; color:var(--color-text-primary,#111827); }',
      '.cs-ad__pr { display:flex; align-items:center; gap:12px; padding:14px 18px; border-radius:12px; background:var(--color-accent,#6366f1); color:#fff; }',
      '.cs-ad__pr-k { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; opacity:0.85; }',
      '.cs-ad__pr-v { font-size:18px; font-weight:700; font-variant-numeric:tabular-nums; }',
      '.cs-ad__ladder { display:flex; flex-direction:column; border-radius:12px; overflow:hidden; border:1px solid var(--color-border,#e5e7eb); }',
      '.cs-ad__tier { display:flex; gap:14px; align-items:flex-start; padding:13px 16px; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-ad__tier:last-child { border-bottom:none; }',
      '.cs-ad__tier:nth-child(1) { background:rgba(220,38,38,0.05); }',
      '.cs-ad__tier:nth-child(2) { background:rgba(245,158,11,0.06); }',
      '.cs-ad__tier:nth-child(3) { background:rgba(16,185,129,0.06); }',
      '.cs-ad__tier-band { flex-shrink:0; min-width:58px; font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--color-text-secondary,#6b7280); }',
      '.cs-ad__tier-text { font-size:14px; line-height:1.5; color:var(--color-text-body,#374151); }',
      '.cs-ad__block { padding:12px 16px; border-radius:10px; background:var(--color-bg-primary,#f9fafb); border:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-ad__block-k { display:block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--color-accent,#6366f1); margin-bottom:4px; }',
      '.cs-ad__block-v { font-size:14px; line-height:1.55; color:var(--color-text-body,#374151); }',
      // ── Tags ──
      '.cs-tag { display:inline-block; padding:1px 8px; border-radius:9999px; font-size:11px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.cs-tag-level { background:rgba(var(--color-accent-rgb,99,102,241),0.1); color:var(--color-accent,#6366f1); }',
      // ── Features ──
      '.cs-feature-group { margin-top:12px; }',
      '.cs-feature-group:first-child { margin-top:0; }',
      '.cs-feature-group-title { font-size:13px; font-weight:600; color:var(--color-text-secondary,#6b7280); margin:0 0 8px; text-transform:uppercase; letter-spacing:0.05em; }',
      '.cs-feature-list { display:flex; flex-direction:column; gap:8px; }',
      '.cs-feature { background:var(--color-bg-primary,#f9fafb); border:1px solid var(--color-border-light,#f3f4f6); border-radius:8px; padding:10px 12px; }',
      '.cs-feature-header { display:flex; align-items:center; gap:8px; margin-bottom:4px; }',
      '.cs-feature-name { font-weight:600; font-size:14px; }',
      '.cs-feature-source { font-size:12px; color:var(--color-text-muted,#9ca3af); margin-bottom:4px; }',
      '.cs-feature-desc { font-size:13px; color:var(--color-text-body,#374151); }',
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
      // v3: muted placeholder shown by a section that has no data yet, so the
      // sheet always shows its full structure instead of collapsing.
      '.cs-placeholder { color:var(--color-text-muted,#9ca3af); font-size:13px; font-style:italic; padding:6px 2px; }',
      // ── v3 Combat panel ──
      '.cs-combat-status { font-size:13px; font-weight:600; color:var(--color-text-secondary,#6b7280); margin-bottom:8px; display:flex; align-items:center; gap:6px; }',
      '.cs-combat-status--active { color:#dc2626; }',
      '.cs-combat-dot { width:8px; height:8px; border-radius:9999px; background:#dc2626; box-shadow:0 0 0 0 rgba(220,38,38,0.5); animation:ds-pulse 1.5s ease-in-out infinite; }',
      '.cs-cond-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }',
      '.cs-cond { display:inline-flex; align-items:center; padding:2px 9px; border-radius:9999px; font-size:11px; font-weight:600; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.cs-cond--danger { background:rgba(220,38,38,0.12); color:#dc2626; }',
      '.cs-cond--warn { background:rgba(217,119,6,0.14); color:#b45309; }',
      // ── v3 GM Lore ──
      '.cs-gmlore { font-size:13px; line-height:1.6; color:var(--color-text-body,#374151); border-left:3px solid rgba(var(--color-accent-rgb,99,102,241),0.5); padding:4px 0 4px 12px; }',
      // ── v3 Header: status pills + actions + live dot ──
      '.cs-header-pills { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }',
      '.cs-pill { display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:9999px; font-size:11px; font-weight:600; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.cs-pill--claim { background:rgba(16,185,129,0.14); color:#059669; }',
      '.cs-header-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-left:auto; align-self:flex-start; }',
      '.cs-act { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:1px solid var(--color-border,#e5e7eb); background:var(--color-bg-primary,#f9fafb); color:var(--color-text-secondary,#6b7280); transition:background 150ms ease, border-color 150ms ease, transform 150ms ease; }',
      '.cs-act:hover { transform:translateY(-1px); border-color:rgba(var(--color-accent-rgb,99,102,241),0.4); }',
      '.cs-act--primary { background:var(--color-accent,#6366f1); color:#fff; border-color:transparent; }',
      '.cs-live { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:#059669; }',
      '.cs-live-dot { width:8px; height:8px; border-radius:9999px; background:#10b981; }',
      // ── Mobile ──
      '@media (max-width:600px) {',
      '  .cs-stat-row { grid-template-columns:repeat(5,1fr); gap:4px; }',
      '  .cs-stat { padding:8px 4px; }',
      '  .cs-stat-value { font-size:18px; }',
      '  .cs-header { flex-direction:column; align-items:flex-start; }',
      '  .cs-portrait { width:64px; height:64px; }',
      '  .cs-damage-row { flex-direction:column; gap:4px; }',
      '  .cs-damage-label { width:auto; padding-top:0; }',
      '}',
      // ── Motion / animation layer (entrance + ambient; reduce-motion aware) ──
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
      '.cs-portrait { transition:transform 220ms cubic-bezier(.2,.7,.2,1); }',
      '.cs-header:hover .cs-portrait { transform:scale(1.04); }',
      // Respect the OS reduce-motion setting: kill ambient + entrance motion.
      '@media (prefers-reduced-motion: reduce) {',
      '  .ds-sheet .cs-box.ds-anim-in { animation:none; }',
      '  .cs-bar-fill.cs-bar-danger, .cs-bar-fill.cs-bar-accent { animation:none; }',
      '  .cs-bar-fill.cs-bar-accent { background-image:none; }',
      '  .cs-level-badge::after { display:none; }',
      '  .cs-stat:hover { transform:none; box-shadow:none; }',
      '  .cs-header:hover .cs-portrait { transform:none; }',
      '}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'ds-character-sheet-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── widget ─────────────────────────────────────────────────────────

  Chronicle.register('character-sheet', {
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

      var base = campaignId
        ? '/api/v1/campaigns/' + campaignId + '/extensions/drawsteel/assets/'
        : '/extensions/drawsteel/assets/';
      refRenderer = (typeof DrawSteelRefRenderer !== 'undefined')
        ? new DrawSteelRefRenderer(base, campaignId)
        : null;

      injectStyles();
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
          // Viewer/permission context passed by the Chronicle mount (data-* attrs).
          // isGm gates the GM-only lore box; visibility/claimed drive the header
          // pills. All default to safe/empty when the host doesn't supply them.
          isGm: ds.isGm === 'true' || ds.isGm === '1',
          visibility: (entity && entity.visibility) || ds.visibility || '',
          claimed: ds.claimed === 'true' || ds.claimed === '1'
        };
        var loadRef = refRenderer ? refRenderer.load() : Promise.resolve();
        loadRef.then(function () {
          if (refRenderer) refRenderer.injectStyles();
          mountSheet(self, el, data);
        });
      }

      if (entityObj && (entityObj.fields_data || entityObj.custom_fields)) {
        finish(entityObj);
      } else if (entityId && campaignId) {
        fetchEntity(campaignId, entityId).then(finish).catch(function (err) {
          renderError(el, (err && err.message) ? err.message : 'Failed to load character.');
        });
      } else {
        renderError(el, 'No entity context available.');
      }
    },

    destroy: function (el) {
      if (el._csSurfaceCleanup) { try { el._csSurfaceCleanup(); } catch (e) {} el._csSurfaceCleanup = null; }
      if (this._onAbilityClick) el.removeEventListener('click', this._onAbilityClick);
      if (this._onAbilityKey) el.removeEventListener('keydown', this._onAbilityKey);
      this._onAbilityClick = null;
      this._onAbilityKey = null;
      el.classList.remove('ds-sheet');
      el.innerHTML = '';
    }
  });

  registerBoxes();
})();
