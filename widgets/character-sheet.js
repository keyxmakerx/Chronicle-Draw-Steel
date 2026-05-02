/**
 * Draw Steel Character Sheet Widget
 *
 * Mounts on a drawsteel-character entity page via Chronicle's manifest-driven
 * renderer registration (CH4.5). Reads entity fields_data + ancestors/children
 * from the mount div's data attributes for first paint without an API call.
 *
 * Pre-CH4.5: this widget can also be embedded as a normal Chronicle widget
 * with entity_id + campaign_id config and will fall back to apiFetch.
 *
 * LAYOUT CONTRACT (Option C, 2026-04-30)
 *
 * This renderer owns system-flavored sections — header, vitals,
 * characteristics, heroic resource, movement, damage, abilities, features,
 * progression, notes. These are Draw Steel-specific and should not be
 * forced through generic Chronicle blocks.
 *
 * Cross-system surfaces mount as Chronicle blocks at the bottom of the
 * page via slot points emitted by _renderBlockSlots(). Three slots are
 * reserved:
 *   - character_skills           (manifest-driven via skill_fields)
 *   - character_inventory        (reads fields_data inventory_fields)
 *   - character_purchase_history (reads armory/transactions by entity)
 *
 * The data-attribute names on those slot divs are PLACEHOLDERS — the
 * concrete mount-by-data-attr contract lands once Chronicle's block
 * registry surfaces a stable hydration path. Coordinate with the
 * Chronicle dev when Phase 3 widgets ship before relying on the names.
 */
Chronicle.register('character-sheet', {
  init: function (el, config) {
    var self = this;
    this.el = el;
    this.config = config || {};

    // Read mount-div context (set by chronicle's manifest renderer in CH4.5)
    var ds = el.dataset || {};
    this._entityId = config.entity_id || config.entityId || ds.entityId || '';
    this._campaignId = config.campaign_id || config.campaignId || ds.campaignId || '';
    this._csrfToken = ds.csrfToken || '';

    // Try to parse fields_data + ancestors + children from data attributes
    this.entity = this._parseJsonAttr(ds.fieldsData, {});
    this.ancestors = this._parseJsonAttr(ds.ancestors, []);
    this.children = this._parseJsonAttr(ds.children, []);

    // Reference renderer for {@condition}-style cross-links inside text
    var base = this._campaignId
      ? '/api/v1/campaigns/' + this._campaignId + '/extensions/drawsteel/assets/'
      : '/extensions/drawsteel/assets/';
    this._ref = (typeof DrawSteelRefRenderer !== 'undefined')
      ? new DrawSteelRefRenderer(base, this._campaignId)
      : null;

    this._injectStyles();
    el.className = 'cs-root';

    // If we got the entity from data attributes, paint immediately.
    // Otherwise fall back to API fetch.
    var loadRef = this._ref ? this._ref.load() : Promise.resolve();
    if (this.entity && this.entity.custom_fields) {
      loadRef.then(function () {
        if (self._ref) self._ref.injectStyles();
        self._render();
      });
    } else if (this._entityId && this._campaignId) {
      Promise.all([loadRef, this._fetchEntity()]).then(function () {
        if (self._ref) self._ref.injectStyles();
        self._render();
      }).catch(function (err) {
        console.warn('Character Sheet: load failed', err);
        self._renderError(err && err.message ? err.message : 'Failed to load character.');
      });
    } else {
      this._renderError('No entity context available.');
    }
  },

  destroy: function (el) {
    el.innerHTML = '';
  },

  // ── Helpers ────────────────────────────────────────────────────

  _parseJsonAttr: function (raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  },

  _parseJsonField: function (raw, fallback) {
    if (raw == null || raw === '') return fallback;
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  },

  _apiError: function (res, fallback) {
    return res.json().then(
      function (body) { return body && body.message ? body.message : fallback; },
      function () { return fallback; }
    );
  },

  _fetchEntity: function () {
    var self = this;
    var url = '/api/v1/campaigns/' + this._campaignId + '/entities/' + this._entityId;
    return Chronicle.apiFetch(url)
      .then(function (res) {
        if (!res.ok) {
          return self._apiError(res, 'Could not load character.').then(function (msg) {
            throw new Error(msg);
          });
        }
        return res.json();
      })
      .then(function (entity) {
        self.entity = entity || {};
      });
  },

  _f: function (key, fallback) {
    var cf = (this.entity && this.entity.custom_fields) || {};
    var v = cf[key];
    if (v === undefined || v === null || v === '') return fallback;
    return v;
  },

  _num: function (key, fallback) {
    var v = this._f(key, fallback);
    var n = Number(v);
    return isNaN(n) ? fallback : n;
  },

  _renderError: function (message) {
    var h = (typeof Chronicle !== 'undefined' && Chronicle.escapeHtml) ? Chronicle.escapeHtml : function (s) { return s; };
    this.el.innerHTML = '<div class="cs-empty">' +
      '<div class="cs-empty-icon">&#9888;</div>' +
      '<div class="cs-empty-title">Character unavailable</div>' +
      '<div class="cs-empty-desc">' + h(message) + '</div>' +
      '</div>';
  },

  // ── Render ─────────────────────────────────────────────────────

  _render: function () {
    var sections = [
      this._renderHeader(),
      this._renderVitals(),
      this._renderCharacteristics(),
      this._renderHeroicResource(),
      this._renderMovement(),
      this._renderDamage(),
      this._renderAbilities(),
      this._renderFeatures(),
      this._renderProgression(),
      this._renderInventory(),
      this._renderNotes(),
      this._renderBlockSlots()
    ];
    this.el.innerHTML = sections.filter(function (s) { return s; }).join('');

    if (this._ref && this._ref.applyToContainer) {
      this._ref.applyToContainer(this.el);
    }
  },

  _renderHeader: function () {
    var h = Chronicle.escapeHtml;
    var name = (this.entity && this.entity.name) || 'Unnamed Hero';
    var portrait = this._f('portrait_url', '');
    var level = this._num('level', 1);
    var ancestry = this._f('ancestry', '');
    var className = this._f('class', '');
    var subclass = this._f('subclass', '');
    var kit = this._f('kit', '');
    var faction = this._f('faction', '');

    var subtitleParts = [];
    if (ancestry) subtitleParts.push(h(ancestry));
    if (className) subtitleParts.push(h(className) + (subclass ? ' (' + h(subclass) + ')' : ''));
    if (kit) subtitleParts.push(h(kit) + ' kit');
    var subtitle = subtitleParts.join(' &bull; ');

    var portraitHtml = portrait
      ? '<img class="cs-portrait" src="' + h(portrait) + '" alt="' + h(name) + '">'
      : '<div class="cs-portrait cs-portrait-placeholder"><i class="fa-solid fa-shield-halved"></i></div>';

    return '<section class="cs-card cs-header">' +
      portraitHtml +
      '<div class="cs-header-text">' +
        '<div class="cs-header-name">' + h(name) + '</div>' +
        '<div class="cs-header-meta">' +
          '<span class="cs-level-badge">Level ' + level + '</span>' +
          (subtitle ? '<span class="cs-header-subtitle">' + subtitle + '</span>' : '') +
          (faction ? '<span class="cs-header-faction">' + h(faction) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</section>';
  },

  _renderVitals: function () {
    var current = this._num('stamina_current', 0);
    var max = this._num('stamina_max', 0);
    var winded = this._num('winded', max ? Math.floor(max / 2) : 0);
    var recoveries = this._num('recoveries', 0);
    var recoveriesMax = this._num('recoveries_max', 0);

    var pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    var windedPct = max > 0 ? (winded / max) * 100 : 0;
    var dangerClass = (current <= winded) ? ' cs-bar-danger' : '';

    var recChips = '';
    if (recoveriesMax > 0 || recoveries > 0) {
      recChips = '<div class="cs-chip"><span class="cs-chip-label">Recoveries</span>' +
        '<span class="cs-chip-value">' + recoveries + (recoveriesMax > 0 ? ' / ' + recoveriesMax : '') + '</span></div>';
    }

    return '<section class="cs-card cs-vitals">' +
      '<h3 class="cs-card-title">Vitals</h3>' +
      '<div class="cs-bar-wrap">' +
        '<div class="cs-bar-label">Stamina <span class="cs-bar-value">' + current + ' / ' + max + '</span></div>' +
        '<div class="cs-bar"><div class="cs-bar-fill' + dangerClass + '" style="width:' + pct + '%"></div>' +
          (winded > 0 ? '<div class="cs-bar-threshold" style="left:' + windedPct + '%" title="Winded"></div>' : '') +
        '</div>' +
        (winded > 0 ? '<div class="cs-bar-sub">Winded at ' + winded + '</div>' : '') +
      '</div>' +
      (recChips ? '<div class="cs-chip-row">' + recChips + '</div>' : '') +
    '</section>';
  },

  _renderCharacteristics: function () {
    var stats = ['might', 'agility', 'reason', 'intuition', 'presence'];
    var labels = { might: 'Might', agility: 'Agility', reason: 'Reason', intuition: 'Intuition', presence: 'Presence' };
    var self = this;
    var cells = stats.map(function (s) {
      var v = self._num(s, 0);
      var sign = v > 0 ? '+' : '';
      var toneClass = v > 0 ? ' cs-stat-positive' : (v < 0 ? ' cs-stat-negative' : ' cs-stat-zero');
      return '<div class="cs-stat' + toneClass + '">' +
        '<div class="cs-stat-label">' + labels[s] + '</div>' +
        '<div class="cs-stat-value">' + sign + v + '</div>' +
      '</div>';
    }).join('');

    return '<section class="cs-card cs-characteristics">' +
      '<h3 class="cs-card-title">Characteristics</h3>' +
      '<div class="cs-stat-row">' + cells + '</div>' +
    '</section>';
  },
  _renderHeroicResource: function () {
    var h = Chronicle.escapeHtml;
    var label = this._f('heroic_resource_name', '');
    var current = this._num('heroic_resource_current', NaN);
    var max = this._num('heroic_resource_max', NaN);

    if (!label && isNaN(current) && isNaN(max)) return '';

    var displayLabel = label ? h(label) : 'Heroic Resource';
    var currentTxt = isNaN(current) ? '0' : String(current);
    var maxTxt = isNaN(max) ? '' : ' / ' + max;
    var pct = (!isNaN(current) && !isNaN(max) && max > 0)
      ? Math.max(0, Math.min(100, (current / max) * 100))
      : (isNaN(current) ? 0 : Math.min(100, current * 10));

    return '<section class="cs-card cs-heroic-resource">' +
      '<h3 class="cs-card-title">' + displayLabel + '</h3>' +
      '<div class="cs-bar-wrap">' +
        '<div class="cs-bar-label"><span class="cs-bar-value">' + currentTxt + maxTxt + '</span></div>' +
        '<div class="cs-bar"><div class="cs-bar-fill cs-bar-accent" style="width:' + pct + '%"></div></div>' +
      '</div>' +
    '</section>';
  },

  _renderMovement: function () {
    var speed = this._num('speed', 0);
    var stability = this._num('stability', 0);
    if (!speed && !stability) return '';
    return '<section class="cs-card cs-movement">' +
      '<h3 class="cs-card-title">Movement</h3>' +
      '<div class="cs-chip-row">' +
        '<div class="cs-chip"><span class="cs-chip-label">Speed</span><span class="cs-chip-value">' + speed + '</span></div>' +
        '<div class="cs-chip"><span class="cs-chip-label">Stability</span><span class="cs-chip-value">' + stability + '</span></div>' +
      '</div>' +
    '</section>';
  },

  _renderDamage: function () {
    var h = Chronicle.escapeHtml;
    var imm = this._parseJsonField(this._f('immunities', ''), []);
    var weak = this._parseJsonField(this._f('weaknesses', ''), []);

    if ((!imm || !imm.length) && (!weak || !weak.length)) return '';

    var rowFor = function (entry) {
      if (entry == null) return '';
      if (typeof entry === 'string') return h(entry);
      var type = entry.type ? h(String(entry.type)) : '';
      var value = (entry.value != null && entry.value !== '') ? ' ' + h(String(entry.value)) : '';
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

    return '<section class="cs-card cs-damage">' +
      '<h3 class="cs-card-title">Damage</h3>' +
      immHtml + weakHtml +
    '</section>';
  },
  _renderAbilities: function () {
    var h = Chronicle.escapeHtml;
    var abilities = this._parseJsonField(this._f('abilities_json', ''), []);
    if (!Array.isArray(abilities) || abilities.length === 0) return '';

    var typeOrder = ['signature', 'action', 'maneuver', 'triggered', 'free-strike', 'trait'];
    var typeLabels = {
      'signature': 'Signature',
      'action': 'Actions',
      'maneuver': 'Maneuvers',
      'triggered': 'Triggered',
      'free-strike': 'Free Strikes',
      'trait': 'Traits'
    };
    var groups = {};
    abilities.forEach(function (a) {
      var t = (a && a.type) || 'action';
      if (!groups[t]) groups[t] = [];
      groups[t].push(a);
    });

    var renderAbility = function (a) {
      var name = h(a.name || 'Untitled Ability');
      var typeIcon = a.type === 'signature' ? '<span class="cs-ability-star">&#9733;</span>' : '';
      var keywords = (a.keywords && a.keywords.length)
        ? '<div class="cs-ability-keywords">' + a.keywords.map(function (k) { return '<span class="cs-tag">' + h(String(k)) + '</span>'; }).join('') + '</div>'
        : '';
      var meta = [];
      if (a.distance) meta.push(h(String(a.distance)));
      if (a.target) meta.push(h(String(a.target)));
      if (a.power_roll) meta.push(h(String(a.power_roll)));
      var metaHtml = meta.length ? '<div class="cs-ability-meta">' + meta.join(' &bull; ') + '</div>' : '';

      var tiers = '';
      if (a.tier1 || a.tier2 || a.tier3) {
        tiers = '<div class="cs-ability-tiers">' +
          (a.tier1 ? '<div class="cs-tier"><span class="cs-tier-label">11-</span> ' + h(String(a.tier1)) + '</div>' : '') +
          (a.tier2 ? '<div class="cs-tier"><span class="cs-tier-label">12-16</span> ' + h(String(a.tier2)) + '</div>' : '') +
          (a.tier3 ? '<div class="cs-tier"><span class="cs-tier-label">17+</span> ' + h(String(a.tier3)) + '</div>' : '') +
        '</div>';
      }

      var effect = a.effect ? '<div class="cs-ability-effect">' + h(String(a.effect)) + '</div>' : '';
      var trigger = a.trigger ? '<div class="cs-ability-trigger"><strong>Trigger:</strong> ' + h(String(a.trigger)) + '</div>' : '';
      var spend = (a.spend_vp || a.spend_resource)
        ? '<div class="cs-ability-spend">Spend ' + h(String(a.spend_vp || a.spend_resource)) + '</div>'
        : '';

      return '<article class="cs-ability">' +
        '<header class="cs-ability-header">' + typeIcon + '<span class="cs-ability-name">' + name + '</span></header>' +
        keywords + metaHtml + tiers + trigger + effect + spend +
      '</article>';
    };

    var sectionsHtml = typeOrder.map(function (t) {
      if (!groups[t] || !groups[t].length) return '';
      var label = typeLabels[t] || (t.charAt(0).toUpperCase() + t.slice(1));
      return '<div class="cs-ability-group">' +
        '<h4 class="cs-ability-group-title">' + h(label) + '</h4>' +
        '<div class="cs-ability-grid">' + groups[t].map(renderAbility).join('') + '</div>' +
      '</div>';
    }).join('');
    var leftover = Object.keys(groups).filter(function (t) { return typeOrder.indexOf(t) === -1; });
    leftover.forEach(function (t) {
      sectionsHtml += '<div class="cs-ability-group">' +
        '<h4 class="cs-ability-group-title">' + h(t) + '</h4>' +
        '<div class="cs-ability-grid">' + groups[t].map(renderAbility).join('') + '</div>' +
      '</div>';
    });

    return '<section class="cs-card cs-abilities">' +
      '<h3 class="cs-card-title">Abilities</h3>' +
      sectionsHtml +
    '</section>';
  },

  _renderFeatures: function () {
    var h = Chronicle.escapeHtml;
    var classFt = this._parseJsonField(this._f('class_features_json', ''), []);
    var ancestryFt = this._parseJsonField(this._f('ancestry_features_json', ''), []);
    var kitFt = this._parseJsonField(this._f('kit_features_json', ''), []);

    if ((!classFt || !classFt.length) && (!ancestryFt || !ancestryFt.length) && (!kitFt || !kitFt.length)) return '';

    var renderFt = function (f) {
      var name = h(f.name || 'Feature');
      var levelTag = f.level ? '<span class="cs-tag cs-tag-level">L' + f.level + '</span>' : '';
      var desc = f.description ? '<div class="cs-feature-desc">' + h(String(f.description)) + '</div>' : '';
      var source = f.source ? '<div class="cs-feature-source">' + h(String(f.source)) + '</div>' : '';
      return '<article class="cs-feature"><header class="cs-feature-header">' +
        '<span class="cs-feature-name">' + name + '</span>' + levelTag +
      '</header>' + source + desc + '</article>';
    };

    var groupHtml = function (label, list) {
      if (!list || !list.length) return '';
      return '<div class="cs-feature-group">' +
        '<h4 class="cs-feature-group-title">' + h(label) + '</h4>' +
        '<div class="cs-feature-list">' + list.map(renderFt).join('') + '</div>' +
      '</div>';
    };

    return '<section class="cs-card cs-features">' +
      '<h3 class="cs-card-title">Features</h3>' +
      groupHtml('Class', classFt) +
      groupHtml('Ancestry', ancestryFt) +
      groupHtml('Kit', kitFt) +
    '</section>';
  },
  _renderProgression: function () {
    var h = Chronicle.escapeHtml;
    var entries = [
      { label: 'XP', key: 'xp' },
      { label: 'Victories', key: 'victories' },
      { label: 'Renown', key: 'renown' },
      { label: 'Project Points', key: 'project_points' },
      { label: 'Wealth', key: 'wealth' }
    ];
    var self = this;
    var chips = entries.map(function (e) {
      var v = self._f(e.key, null);
      if (v == null) return '';
      return '<div class="cs-chip"><span class="cs-chip-label">' + h(e.label) + '</span>' +
        '<span class="cs-chip-value">' + h(String(v)) + '</span></div>';
    }).filter(function (s) { return s; }).join('');

    if (!chips) return '';

    return '<section class="cs-card cs-progression">' +
      '<h3 class="cs-card-title">Progression</h3>' +
      '<div class="cs-chip-row">' + chips + '</div>' +
    '</section>';
  },

  _renderInventory: function () {
    var h = Chronicle.escapeHtml;
    var items = [];
    if (Array.isArray(this.children)) {
      items = this.children.filter(function (c) {
        return c && c.relation && c.relation.slug === 'has-item';
      });
    }
    if (!items.length) return '';

    var rows = items.map(function (it) {
      var entity = it.entity || it;
      var name = h(entity.name || 'Item');
      var qty = (it.metadata && it.metadata.quantity) ? ' &times; ' + h(String(it.metadata.quantity)) : '';
      var equipped = (it.metadata && it.metadata.equipped) ? ' <span class="cs-tag">equipped</span>' : '';
      var href = entity.id && this._campaignId ? '/campaigns/' + this._campaignId + '/entities/' + entity.id : '';
      var label = href
        ? '<a class="cs-inventory-link" href="' + h(href) + '">' + name + '</a>'
        : name;
      return '<li class="cs-inventory-item">' + label + qty + equipped + '</li>';
    }, this).join('');

    return '<section class="cs-card cs-inventory">' +
      '<h3 class="cs-card-title">Inventory</h3>' +
      '<ul class="cs-inventory-list">' + rows + '</ul>' +
    '</section>';
  },

  _renderNotes: function () {
    var notes = this._f('notes', '');
    if (!notes) return '';
    var h = Chronicle.escapeHtml;
    return '<section class="cs-card cs-notes">' +
      '<h3 class="cs-card-title">Notes</h3>' +
      '<div class="cs-notes-body">' + h(String(notes)) + '</div>' +
    '</section>';
  },

  // Phase 3 / Option C slot points. Emits inert mount divs for Chronicle's
  // generic character_* block widgets. Hydrated by Chronicle's block registry
  // once it surfaces a stable mount-by-data-attr path; until then these stay
  // empty and are hidden by the .cs-slot:empty rule. Attribute names are
  // placeholders — see file header.
  _renderBlockSlots: function () {
    if (!this._entityId || !this._campaignId) return '';
    var h = Chronicle.escapeHtml;
    var eid = h(String(this._entityId));
    var cid = h(String(this._campaignId));
    return '<div class="cs-slot" data-block="character_skills"' +
        ' data-entity-id="' + eid + '" data-campaign-id="' + cid + '"></div>' +
      '<div class="cs-slot" data-block="character_inventory"' +
        ' data-entity-id="' + eid + '" data-campaign-id="' + cid + '"></div>' +
      '<div class="cs-slot" data-block="character_purchase_history"' +
        ' data-entity-id="' + eid + '" data-campaign-id="' + cid + '"></div>';
  },

  // ── Styles (filled in below) ───────────────────────────────────

  _injectStyles: function () {
    if (document.querySelector('style.cs-styles')) return;
    var style = document.createElement('style');
    style.className = 'cs-styles';
    style.textContent = this._stylesheetText();
    document.head.appendChild(style);
  },

  _stylesheetText: function () {
    return [
      // ── Root layout ──
      '.cs-root { font-family:Inter,system-ui,-apple-system,sans-serif; font-size:14px; color:var(--color-text-primary,#111827); display:flex; flex-direction:column; gap:12px; }',
      '.cs-card { background:var(--color-card-bg,#fff); border:1px solid var(--color-border,#e5e7eb); border-radius:12px; padding:16px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }',
      '.cs-card-title { font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); margin:0 0 12px; font-family:var(--font-campaign,Inter,system-ui,-apple-system,sans-serif); }',
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
      // ── Movement / Damage ──
      '.cs-damage-row { display:flex; gap:10px; align-items:flex-start; padding:6px 0; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-damage-row:last-child { border-bottom:none; }',
      '.cs-damage-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); width:100px; flex-shrink:0; padding-top:4px; }',
      '.cs-damage-list { display:flex; flex-wrap:wrap; gap:6px; flex:1; }',
      // ── Abilities ──
      '.cs-ability-group { margin-top:12px; }',
      '.cs-ability-group:first-child { margin-top:0; }',
      '.cs-ability-group-title { font-size:13px; font-weight:600; color:var(--color-accent,#6366f1); margin:0 0 8px; padding-bottom:4px; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.cs-ability-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:10px; }',
      '.cs-ability { background:var(--color-bg-primary,#f9fafb); border:1px solid var(--color-border-light,#f3f4f6); border-radius:8px; padding:10px 12px; }',
      '.cs-ability-header { display:flex; align-items:center; gap:6px; margin-bottom:4px; }',
      '.cs-ability-star { color:var(--color-accent,#6366f1); font-size:14px; }',
      '.cs-ability-name { font-weight:600; font-size:14px; color:var(--color-text-primary,#111827); }',
      '.cs-ability-keywords { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }',
      '.cs-ability-meta { font-size:12px; color:var(--color-text-secondary,#6b7280); margin-bottom:6px; }',
      '.cs-ability-tiers { border-left:2px solid var(--color-border,#e5e7eb); padding-left:10px; margin:6px 0; }',
      '.cs-tier { font-size:13px; line-height:1.5; }',
      '.cs-tier-label { display:inline-block; min-width:38px; font-weight:600; color:var(--color-text-secondary,#6b7280); font-variant-numeric:tabular-nums; }',
      '.cs-ability-effect { font-size:13px; color:var(--color-text-body,#374151); margin-top:4px; }',
      '.cs-ability-trigger { font-size:13px; color:var(--color-text-body,#374151); margin-top:4px; }',
      '.cs-ability-spend { font-size:12px; font-weight:600; color:var(--color-accent,#6366f1); margin-top:4px; }',
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
      // ── Block slots (Phase 3 / Option C) — hidden until Chronicle hydrates ──
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
  }
});
