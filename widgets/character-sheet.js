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

  function num(data, key, fallback) {
    var v = f(data, key, fallback);
    var n = Number(v);
    return isNaN(n) ? fallback : n;
  }

  function isNum(data, key) {
    var v = f(data, key, null);
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

    return '<div class="cs-header">' +
      portraitHtml +
      '<div class="cs-header-text">' +
        '<div class="cs-header-name">' + esc(name) + '</div>' +
        '<div class="cs-header-meta">' +
          '<span class="cs-level-badge">Level ' + level + '</span>' +
          (subtitle ? '<span class="cs-header-subtitle">' + subtitle + '</span>' : '') +
          (faction ? '<span class="cs-header-faction">' + esc(faction) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function rVitals(def, data) {
    var current = num(data, 'stamina_current', 0);
    var max = num(data, 'stamina_max', 0);
    var winded = num(data, 'winded', max ? Math.floor(max / 2) : 0);
    var recoveries = num(data, 'recoveries', 0);
    var recoveriesMax = num(data, 'recoveries_max', 0);

    var pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    var windedPct = max > 0 ? (winded / max) * 100 : 0;
    var dangerClass = (current <= winded) ? ' cs-bar-danger' : '';

    var recChips = '';
    if (recoveriesMax > 0 || recoveries > 0) {
      recChips = '<div class="cs-chip"><span class="cs-chip-label">Recoveries</span>' +
        '<span class="cs-chip-value">' + recoveries + (recoveriesMax > 0 ? ' / ' + recoveriesMax : '') + '</span></div>';
    }

    return '<div class="cs-bar-wrap">' +
        '<div class="cs-bar-label">Stamina <span class="cs-bar-value">' + current + ' / ' + max + '</span></div>' +
        '<div class="cs-bar"><div class="cs-bar-fill' + dangerClass + '" style="width:' + pct + '%"></div>' +
          (winded > 0 ? '<div class="cs-bar-threshold" style="left:' + windedPct + '%" title="Winded"></div>' : '') +
        '</div>' +
        (winded > 0 ? '<div class="cs-bar-sub">Winded at ' + winded + '</div>' : '') +
      '</div>' +
      (recChips ? '<div class="cs-chip-row">' + recChips + '</div>' : '');
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

    return immHtml + weakHtml;
  }
  var ABILITY_TYPE_ORDER = ['signature', 'action', 'maneuver', 'triggered', 'free-strike', 'trait'];
  var ABILITY_TYPE_LABELS = {
    'signature': 'Signature', 'action': 'Actions', 'maneuver': 'Maneuvers',
    'triggered': 'Triggered', 'free-strike': 'Free Strikes', 'trait': 'Traits'
  };

  function rAbilities(def, data) {
    var abilities = parseAbilities(data);
    if (!abilities.length) return '';

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
      var cards = groups[t].map(function (g) { return abilityCardCompact(g.a, g.idx); }).join('');
      return '<div class="cs-ability-group">' +
        '<h4 class="cs-ability-group-title">' + esc(label) + '</h4>' +
        '<div class="cs-ability-grid">' + cards + '</div>' +
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

    return groupHtml('Class', classFt) + groupHtml('Ancestry', ancestryFt) + groupHtml('Kit', kitFt);
  }

  function rProgression(def, data) {
    var entries = [
      { label: 'XP', key: 'xp' },
      { label: 'Victories', key: 'victories' },
      { label: 'Renown', key: 'renown' },
      { label: 'Project Points', key: 'project_points' },
      { label: 'Wealth', key: 'wealth' }
    ];
    var chips = entries.map(function (e) {
      var v = f(data, e.key, null);
      if (v == null) return '';
      return '<div class="cs-chip"><span class="cs-chip-label">' + esc(e.label) + '</span>' +
        '<span class="cs-chip-value">' + esc(String(v)) + '</span></div>';
    }).filter(function (s) { return s; }).join('');
    if (!chips) return '';
    return '<div class="cs-chip-row">' + chips + '</div>';
  }

  function rInventory(def, data) {
    var items = invItems(data);
    if (!items.length) return '';
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

  function rNotes(def, data) {
    var notes = f(data, 'notes', '');
    if (!notes) return '';
    return '<div class="cs-notes-body">' + refText(notes) + '</div>';
  }

  // abilityCardCompact — the in-box card: identity + keywords + a short meta
  // line. Clicking it opens the full power-roll overlay (delegated handler).
  function abilityCardCompact(a, idx) {
    var name = esc(a.name || 'Untitled Ability');
    var star = a.type === 'signature' ? '<span class="cs-ability-star">&#9733;</span>' : '';
    var keywords = (a.keywords && a.keywords.length)
      ? '<div class="cs-ability-keywords">' + a.keywords.map(function (k) { return '<span class="cs-tag">' + esc(String(k)) + '</span>'; }).join('') + '</div>'
      : '';
    var meta = [];
    if (a.distance) meta.push(esc(String(a.distance)));
    if (a.target) meta.push(esc(String(a.target)));
    if (a.power_roll) meta.push(esc(String(a.power_roll)));
    var metaHtml = meta.length ? '<div class="cs-ability-meta">' + meta.join(' &bull; ') + '</div>' : '';

    return '<article class="cs-ability cs-ability--clickable" data-ds-ability="' + idx + '"' +
        ' role="button" tabindex="0" aria-label="' + name + ' — view details">' +
      '<header class="cs-ability-header">' + star +
        '<span class="cs-ability-name">' + name + '</span>' +
        '<span class="cs-ability-more" aria-hidden="true">Details &rsaquo;</span>' +
      '</header>' +
      keywords + metaHtml +
    '</article>';
  }

  // renderAbilityDetail — the overlay body: the full power-roll card. Text
  // fields (tiers / trigger / effect) run through refText so {@…} tokens light up.
  function renderAbilityDetail(a) {
    var name = esc(a.name || 'Untitled Ability');
    var star = a.type === 'signature' ? '<span class="cs-ability-star">&#9733;</span>' : '';
    var typeTag = a.type ? '<span class="cs-tag cs-tag-level">' + esc(String(a.type)) + '</span>' : '';
    var keywords = (a.keywords && a.keywords.length)
      ? '<div class="cs-ability-keywords">' + a.keywords.map(function (k) { return '<span class="cs-tag">' + esc(String(k)) + '</span>'; }).join('') + '</div>'
      : '';

    var meta = [];
    if (a.distance) meta.push('<span><strong>Distance:</strong> ' + esc(String(a.distance)) + '</span>');
    if (a.target) meta.push('<span><strong>Target:</strong> ' + esc(String(a.target)) + '</span>');
    var metaHtml = meta.length ? '<div class="cs-ability-detail-meta">' + meta.join('') + '</div>' : '';

    var prHtml = a.power_roll
      ? '<div class="cs-ability-detail-pr"><span class="cs-pr-label">Power Roll</span>' + esc(String(a.power_roll)) + '</div>'
      : '';

    var tiers = '';
    if (a.tier1 || a.tier2 || a.tier3) {
      tiers = '<div class="cs-ability-tiers">' +
        (a.tier1 ? '<div class="cs-tier"><span class="cs-tier-label">11-</span> ' + refText(a.tier1) + '</div>' : '') +
        (a.tier2 ? '<div class="cs-tier"><span class="cs-tier-label">12-16</span> ' + refText(a.tier2) + '</div>' : '') +
        (a.tier3 ? '<div class="cs-tier"><span class="cs-tier-label">17+</span> ' + refText(a.tier3) + '</div>' : '') +
      '</div>';
    }

    var trigger = a.trigger ? '<div class="cs-ability-trigger"><strong>Trigger:</strong> ' + refText(a.trigger) + '</div>' : '';
    var effect = a.effect ? '<div class="cs-ability-effect">' + refText(a.effect) + '</div>' : '';
    var spend = (a.spend_vp || a.spend_resource)
      ? '<div class="cs-ability-spend">Spend ' + esc(String(a.spend_vp || a.spend_resource)) + '</div>'
      : '';

    return '<div class="cs-ability-detail">' +
      '<header class="cs-ability-detail-head">' + star +
        '<span class="cs-ability-detail-name">' + name + '</span>' + typeTag +
      '</header>' +
      keywords + metaHtml + prHtml + tiers + trigger + effect + spend +
    '</div>';
  }

  // ── content predicates (decide which optional boxes the schema includes) ──

  function hasHeroicResource(data) {
    return !!f(data, 'heroic_resource_name', '') || isNum(data, 'heroic_resource_current') || isNum(data, 'heroic_resource_max');
  }
  function hasMovement(data) { return !!num(data, 'speed', 0) || !!num(data, 'stability', 0); }
  function hasDamage(data) {
    var i = parseJson(f(data, 'immunities', ''), []);
    var w = parseJson(f(data, 'weaknesses', ''), []);
    return !!((i && i.length) || (w && w.length));
  }
  function hasAbilities(data) { return parseAbilities(data).length > 0; }
  function hasFeatures(data) {
    var c = parseJson(f(data, 'class_features_json', ''), []);
    var a = parseJson(f(data, 'ancestry_features_json', ''), []);
    var k = parseJson(f(data, 'kit_features_json', ''), []);
    return !!((c && c.length) || (a && a.length) || (k && k.length));
  }
  function hasProgression(data) {
    var keys = ['xp', 'victories', 'renown', 'project_points', 'wealth'];
    for (var i = 0; i < keys.length; i++) { if (f(data, keys[i], null) != null) return true; }
    return false;
  }
  function hasInventory(data) { return invItems(data).length > 0; }
  function hasNotes(data) { return !!f(data, 'notes', ''); }

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

    // Row 2 — main column (8) + side column (4).
    var main = [
      boxDef('ds-vitals', 'Vitals', 'ds-vitals', 'expanded', { pinned: true }),
      boxDef('ds-characteristics', 'Characteristics', 'ds-characteristics', 'expanded', { pinned: true })
    ];
    if (hasAbilities(data)) main.push(boxDef('ds-abilities', 'Abilities', 'ds-abilities', 'expanded'));

    var side = [];
    if (hasHeroicResource(data)) {
      var hrLabel = f(data, 'heroic_resource_name', '') || 'Heroic Resource';
      side.push(boxDef('ds-heroic-resource', hrLabel, 'ds-heroic-resource', 'expanded', { pinned: true }));
    }
    if (hasMovement(data)) side.push(boxDef('ds-movement', 'Movement', 'ds-movement', 'expanded'));
    if (hasDamage(data)) side.push(boxDef('ds-damage', 'Damage', 'ds-damage', 'collapsed'));
    if (hasProgression(data)) side.push(boxDef('ds-progression', 'Progression', 'ds-progression', 'collapsed'));

    var row2 = [ { width: 8, boxes: main } ];
    if (side.length) row2.push({ width: 4, boxes: side });
    rows.push({ columns: row2 });

    // Row 3 — features (6) + inventory (6); skip empties, skip the row if both gone.
    var row3 = [];
    if (hasFeatures(data)) row3.push({ width: 6, boxes: [ boxDef('ds-features', 'Features', 'ds-features', 'collapsed') ] });
    if (hasInventory(data)) row3.push({ width: 6, boxes: [ boxDef('ds-inventory', 'Inventory', 'ds-inventory', 'collapsed') ] });
    if (row3.length) rows.push({ columns: row3 });

    // Row 4 — notes (12).
    if (hasNotes(data)) {
      rows.push({ columns: [ { width: 12, boxes: [ boxDef('ds-notes', 'Notes', 'ds-notes', 'collapsed') ] } ] });
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
    s.registerBox('ds-damage', rDamage);
    s.registerBox('ds-abilities', rAbilities);
    s.registerBox('ds-features', rFeatures);
    s.registerBox('ds-progression', rProgression);
    s.registerBox('ds-inventory', rInventory);
    s.registerBox('ds-notes', rNotes);
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

  // attachAbilityOverlay wires ONE delegated click/keydown listener on the
  // mounted root: a click on a [data-ds-ability] card pushes the power-roll
  // overlay. No per-card listeners (cards are re-rendered by the frame).
  function attachAbilityOverlay(inst, el, data) {
    var abilities = parseAbilities(data);
    function openFrom(target) {
      var node = (target && target.closest) ? target.closest('[data-ds-ability]') : null;
      if (!node) return false;
      var idx = parseInt(node.getAttribute('data-ds-ability'), 10);
      var a = abilities[idx];
      if (!a) return false;
      Chronicle.surface.overlay.push(renderAbilityDetail(a), {
        transition: 'scale-fade', label: (a.name || 'Ability')
      });
      return true;
    }
    inst._onAbilityClick = function (e) { if (openFrom(e.target)) e.preventDefault(); };
    inst._onAbilityKey = function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var node = (e.target && e.target.closest) ? e.target.closest('[data-ds-ability]') : null;
      if (node && openFrom(e.target)) e.preventDefault();
    };
    el.addEventListener('click', inst._onAbilityClick);
    el.addEventListener('keydown', inst._onAbilityKey);
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
    attachAbilityOverlay(inst, el, data);
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
      '.cs-ability-group { margin-top:12px; }',
      '.cs-ability-group:first-child { margin-top:0; }',
      '.cs-ability-group-title { font-size:13px; font-weight:600; color:var(--color-accent,#6366f1); margin:0 0 8px; padding-bottom:4px; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-ability-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }',
      '.cs-ability { background:var(--color-bg-primary,#f9fafb); border:1px solid var(--color-border-light,#f3f4f6); border-radius:8px; padding:10px 12px; }',
      '.cs-ability--clickable { cursor:pointer; transition:box-shadow 150ms ease, transform 150ms ease, border-color 150ms ease; }',
      '.cs-ability--clickable:hover { box-shadow:0 4px 12px rgba(0,0,0,0.08); transform:translateY(-1px); border-color:var(--color-accent,#6366f1); }',
      '.cs-ability--clickable:focus-visible { outline:2px solid var(--color-accent,#6366f1); outline-offset:2px; }',
      '.cs-ability-header { display:flex; align-items:center; gap:6px; margin-bottom:4px; }',
      '.cs-ability-star { color:var(--color-accent,#6366f1); font-size:14px; }',
      '.cs-ability-name { font-weight:600; font-size:14px; color:var(--color-text-primary,#111827); }',
      '.cs-ability-more { margin-left:auto; font-size:12px; font-weight:500; color:var(--color-text-muted,#9ca3af); flex-shrink:0; }',
      '.cs-ability--clickable:hover .cs-ability-more { color:var(--color-accent,#6366f1); }',
      '.cs-ability-keywords { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }',
      '.cs-ability-meta { font-size:12px; color:var(--color-text-secondary,#6b7280); }',
      '.cs-ability-tiers { border-left:2px solid var(--color-border,#e5e7eb); padding-left:10px; margin:6px 0; }',
      '.cs-tier { font-size:13px; line-height:1.5; }',
      '.cs-tier-label { display:inline-block; min-width:38px; font-weight:600; color:var(--color-text-secondary,#6b7280); font-variant-numeric:tabular-nums; }',
      '.cs-ability-effect { font-size:13px; color:var(--color-text-body,#374151); margin-top:4px; }',
      '.cs-ability-trigger { font-size:13px; color:var(--color-text-body,#374151); margin-top:4px; }',
      '.cs-ability-spend { font-size:12px; font-weight:600; color:var(--color-accent,#6366f1); margin-top:4px; }',
      // ── Ability detail overlay ──
      '.cs-ability-detail { padding:20px 22px; }',
      '.cs-ability-detail-head { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }',
      '.cs-ability-detail-name { font-size:20px; font-weight:700; line-height:1.15; color:var(--color-text-primary,#111827); }',
      '.cs-ability-detail-meta { display:flex; flex-wrap:wrap; gap:6px 18px; font-size:13px; color:var(--color-text-body,#374151); margin-bottom:10px; }',
      '.cs-ability-detail-pr { font-size:14px; margin-bottom:10px; padding:8px 10px; background:var(--color-bg-tertiary,#f3f4f6); border-radius:8px; }',
      '.cs-pr-label { font-weight:700; text-transform:uppercase; font-size:11px; letter-spacing:0.05em; color:var(--color-accent,#6366f1); margin-right:8px; }',
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
      // ── Notes ──
      '.cs-notes-body { font-size:13px; color:var(--color-text-body,#374151); white-space:pre-wrap; line-height:1.6; }',
      // ── Reserved Option-C block slots — hidden until Chronicle hydrates ──
      '.cs-slot:empty { display:none; }',
      // ── Empty / error ──
      '.cs-empty { text-align:center; padding:48px 16px; }',
      '.cs-empty-icon { width:48px; height:48px; border-radius:9999px; background:var(--color-bg-tertiary,#f3f4f6); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px; font-size:20px; color:var(--color-text-muted,#9ca3af); }',
      '.cs-empty-title { font-size:18px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 4px; }',
      '.cs-empty-desc { font-size:14px; color:var(--color-text-secondary,#6b7280); max-width:24rem; margin:0 auto; }',
      // ── Mobile ──
      '@media (max-width:600px) {',
      '  .cs-stat-row { grid-template-columns:repeat(5,1fr); gap:4px; }',
      '  .cs-stat { padding:8px 4px; }',
      '  .cs-stat-value { font-size:18px; }',
      '  .cs-header { flex-direction:column; align-items:flex-start; }',
      '  .cs-portrait { width:64px; height:64px; }',
      '  .cs-ability-grid { grid-template-columns:1fr; }',
      '  .cs-damage-row { flex-direction:column; gap:4px; }',
      '  .cs-damage-label { width:auto; padding-top:0; }',
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
          fields: (entity && entity.custom_fields) || {},
          name: (entity && entity.name) || 'Unnamed Hero',
          campaignId: campaignId,
          entityId: entityId,
          children: Array.isArray(children) ? children : []
        };
        var loadRef = refRenderer ? refRenderer.load() : Promise.resolve();
        loadRef.then(function () {
          if (refRenderer) refRenderer.injectStyles();
          mountSheet(self, el, data);
        });
      }

      if (entityObj && entityObj.custom_fields) {
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
