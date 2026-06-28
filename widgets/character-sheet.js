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
  // ── Abilities: bare "Option D" master–detail (the locked design) ──────────
  // A grouped list (master rail) + a detail pane. Clicking a row fills the pane
  // with an even-smaller BARE card; hovering the card lifts+glows; clicking it
  // grows the two-section big card (① rules ② "For <hero>" odds). Monochrome
  // with a single violet accent. See docs/CHARACTER-SHEET-DESIGN.md.
  //
  // rAbilities emits ONLY the static shell (rail rows + a resting pane). The
  // pane is populated imperatively by attachInteractions (which closes over the
  // ability array + entity data), so selection state lives in the DOM and the
  // box renderer stays a pure function of (def, data).

  var GROUP_ORDER = ['signature', 'heroic', 'maneuver'];
  var GROUP_LABELS = { signature: 'Signature', heroic: 'Heroic', maneuver: 'Maneuvers' };
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

    var rail = GROUP_ORDER.map(function (g) {
      var list = groups[g];
      if (!list.length) return '';
      // within a group, order by heroic-resource cost ascending (the flat index
      // stays attached to each entry, so selection lookups are unaffected).
      list.sort(function (x, y) { return (Number(x.a.cost) || 0) - (Number(y.a.cost) || 0); });
      var rows = list.map(function (it) { return railRow(it.a, it.idx, g); }).join('');
      return '<div class="ds-ab-grp ds-ab-grp--' + g + '">' +
        '<div class="ds-ab-grp__label">' + esc(GROUP_LABELS[g]) + '</div>' + rows +
      '</div>';
    }).join('');

    return '<div class="ds-md">' +
      '<div class="ds-rail" role="listbox" aria-label="Abilities">' + rail + '</div>' +
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
  // substituted. The input is regex-restricted to digits/space/+-*/() so the
  // Function constructor can't reach any identifier or call — no eval risk.
  function safeEvalArith(s) {
    s = String(s == null ? '' : s).trim();
    if (s === '' || !/^[0-9+\-*/(). ]+$/.test(s)) return null;
    try {
      var v = Function('"use strict";return (' + s + ');')();
      return (typeof v === 'number' && isFinite(v)) ? v : null;
    } catch (e) { return null; }
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
        if (disp) frags.push(htmlToText(disp));
      } else if (typeof tt === 'string' && tt) {
        frags.push(htmlToText(tt));
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
        '<span class="ds-tr__t">' + (txt ? refText(txt) : '<span class="ds-muted">—</span>') + '</span></div>';
    }
    return any ? rows : '';
  }

  // fallbackBodyHtml — when an ability has no derivable tier ladder (a non-damage
  // effect, or pre-Phase-C data), show a power-roll line + a teaser of its effect.
  function fallbackBodyHtml(a) {
    var bits = '';
    var pr = powerRollLabel(a);
    if (pr) bits += '<div class="ds-card__line"><span class="ds-card__k">Power Roll</span><span>2d10 + ' + esc(pr) + '</span></div>';
    var eff = htmlToText(a.effectAfter) || (a.story ? String(a.story) : '') || htmlToText(a.effectBefore);
    if (eff) bits += '<div class="ds-card__eff">' + refText(teaser(eff, 170)) + '</div>';
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
        ' aria-label="' + esc((a && a.name) || 'Ability') + ' — click to expand">' +
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
        '<span class="ds-big__tt">' + (txt ? refText(txt) : '<span class="ds-muted">—</span>') + '</span></div>';
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
      ? '<div class="ds-big__kw">' + a.keywords.map(function (k) { return '<span>' + esc(String(k)) + '</span>'; }).join('') + '</div>' : '';
    var effBefore = a.effectBefore ? '<div class="ds-big__flavor">' + refText(htmlToText(a.effectBefore)) + '</div>' : '';
    var trig = a.trigger ? '<div class="ds-big__block"><span class="ds-big__block-k">Trigger</span><span>' + refText(htmlToText(a.trigger)) + '</span></div>' : '';
    var effAfter = a.effectAfter ? '<div class="ds-big__block"><span class="ds-big__block-k">Effect</span><span>' + refText(htmlToText(a.effectAfter)) + '</span></div>' : '';
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
  //   • the big card's [data-ds-collapse-btn] → shrink back to the small card
  //   • [data-cs-read-story] → open the backstory reading view
  // The pane is filled here (not in rAbilities) so selection state lives in the
  // DOM while the box renderer stays a pure function. On mount the first ability
  // (preferring a signature) is auto-selected so the pane is never blank.
  function attachInteractions(inst, el, data) {
    var abilities = parseAbilities(data);
    function pane() { return el.querySelector('[data-ds-pane]'); }

    function selectAbility(idx) {
      var a = abilities[idx];
      if (!a) return;
      var rows = el.querySelectorAll('[data-ds-ability]');
      Array.prototype.forEach.call(rows, function (r) {
        var on = r.getAttribute('data-ds-ability') === String(idx);
        r.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) r.classList.add('ds-li--sel'); else r.classList.remove('ds-li--sel');
      });
      var p = pane();
      if (!p) return;
      p.innerHTML = smallCardHtml(a, idx, data);
      animateCardIn(p.firstChild, false);
    }
    function expandAbility(idx) {
      var a = abilities[idx];
      var p = pane();
      if (!a || !p) return;
      p.innerHTML = bigCardHtml(a, idx, data);
      animateCardIn(p.firstChild, true);
    }

    inst._onAbilityClick = function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var rs = t.closest('[data-cs-read-story]');
      if (rs) { e.preventDefault(); openReadingView(data.name || 'Background', f(data, 'backstory', '') || f(data, 'notes', '')); return; }
      var collapseBtn = t.closest('[data-ds-collapse-btn]');
      if (collapseBtn) {
        var big = t.closest('[data-ds-collapse]');
        if (big) { e.preventDefault(); selectAbility(parseInt(big.getAttribute('data-ds-collapse'), 10)); }
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
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var t = e.target;
      var card = (t && t.closest) ? t.closest('[data-ds-expand]') : null;
      if (card) { e.preventDefault(); expandAbility(parseInt(card.getAttribute('data-ds-expand'), 10)); }
    };
    el.addEventListener('keydown', inst._onAbilityKey);

    // Auto-select the first ability (prefer a signature) so the pane shows a card
    // immediately instead of the resting prompt.
    if (abilities.length) {
      var firstIdx = 0;
      for (var i = 0; i < abilities.length; i++) {
        if (groupOf(abilities[i]) === 'signature') { firstIdx = i; break; }
      }
      selectAbility(firstIdx);
    }
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
    // v3.1: the recovery dots + heroic-resource pips fade/rise in just after the
    // bars, so the new Vitals glyphs reveal intentionally rather than snapping in.
    Array.prototype.forEach.call(el.querySelectorAll('.cs-dots, .cs-hr-pips'), function (n, i) {
      n.style.opacity = '0';
      n.style.transform = 'translateY(3px)';
      n.style.transition = 'opacity 300ms ease ' + (120 + i * 80) + 'ms, transform 300ms ease ' + (120 + i * 80) + 'ms';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { n.style.opacity = '1'; n.style.transform = 'none'; });
      });
    });
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
      '.cs-vitals-main { flex:1 1 180px; min-width:170px; display:flex; flex-direction:column; gap:10px; }',
      '.cs-vitals-stats { flex:1.5 1 300px; min-width:260px; }',
      '.cs-subhead { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-text-muted,#9ca3af); margin-bottom:8px; }',
      '.cs-statline { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:12px; }',
      '.cs-statline-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-secondary,#6b7280); }',
      '.cs-dots, .cs-hr-pips { letter-spacing:2px; font-size:13px; color:var(--color-accent,#a855f7); }',
      '.cs-pips-count { margin-left:8px; font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); letter-spacing:normal; font-variant-numeric:tabular-nums; }',
      '.cs-pips-empty { color:var(--color-text-muted,#9ca3af); }',
      '.cs-roll-might { align-self:flex-start; margin-top:2px; }',
      // ── Headless identity banner + clean pinned boxes (frame box hooks) ──
      '.cs-box[data-box-key="ds-header"] > .cs-box__head { display:none; }',
      '.cs-box[data-box-key="ds-header"] > .cs-box__body { padding:16px; }',
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
      '.ds-rail { flex:0 0 218px; min-width:0; border:1px solid var(--color-border,#e5e7eb); border-radius:11px; overflow:hidden; background:var(--color-bg-primary,#f9fafb); }',
      '.ds-ab-grp__label { font-size:9px; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:var(--color-text-muted,#9ca3af); padding:10px 13px 5px; }',
      '.ds-li { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 13px; background:none; border:0; border-top:1px solid var(--color-border-light,#f3f4f6); font:inherit; font-size:13px; color:var(--color-text-secondary,#6b7280); cursor:pointer; transition:background 120ms ease, color 120ms ease; }',
      '.ds-ab-grp__label + .ds-li { border-top:0; }',
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
      '.ds-big__h { display:flex; align-items:center; gap:9px; padding:11px 15px; background:linear-gradient(90deg,var(--color-accent,#a855f7),#7c3aed); color:#fff; }',
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
      // Inventory (see playEntrance for the JS-driven ones):
      //   1. staggered box entrance   2. low-stamina stamina-bar pulse
      //   3. (retired in v3.1 — was the heroic-resource BAR shimmer; HR is now
      //      pips, so this rule is inert and kept only as a no-op)
      //   4. level-badge sheen   5. stat-card hover lift   6. portrait hover zoom
      //   7. v3.1: stamina-bar fill + characteristic count-up + recovery-dot /
      //      heroic-pip fade-rise reveal (all in playEntrance, skipped on reduce-motion)
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
