/**
 * Draw Steel Statblock Renderer Widget
 * Read-only formatted creature statblock display.
 */
Chronicle.register('statblock-renderer', {
  init: function (el, config) {
    var self = this;
    this.el = el;
    this.config = config;
    this.creature = null;
    var base = config.campaignId
      ? '/api/v1/campaigns/' + config.campaignId + '/extensions/drawsteel/assets/'
      : '/extensions/drawsteel/assets/';
    this._ref = new DrawSteelRefRenderer(base, config.campaignId);

    Promise.all([this._loadEntity(), this._ref.load()]).then(function () {
      self._ref.injectStyles();
      self._render();
    });
  },

  destroy: function (el) {
    el.innerHTML = '';
  },

  _loadEntity: function () {
    var self = this;
    if (!this.config.entityId || !this.config.campaignId) {
      return Promise.resolve();
    }

    var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities/' + this.config.entityId;
    return Chronicle.apiFetch(url)
      .then(function (r) { return r.json(); })
      .then(function (entity) {
        if (!entity || !entity.custom_fields) return;
        var f = entity.custom_fields;
        self.creature = {
          name: entity.name || 'Unnamed Creature',
          level: Number(f.level) || 1,
          organization: f.organization || '',
          role: f.role || '',
          ev: Number(f.ev) || 0,
          size: f.size || 'M',
          keywords: self._parseList(f.keywords),
          faction: f.faction || '',
          stamina: Number(f.stamina) || 0,
          winded: Number(f.winded) || 0,
          speed: Number(f.speed) || 5,
          stability: Number(f.stability) || 0,
          might: Number(f.might) || 0,
          agility: Number(f.agility) || 0,
          reason: Number(f.reason) || 0,
          intuition: Number(f.intuition) || 0,
          presence: Number(f.presence) || 0,
          immunities: self._parseList(f.immunities),
          free_strike: f.free_strike || '',
          traits: self._parseJSON(f.traits, []),
          abilities: self._parseJSON(f.abilities_json, []),
          villain_actions: self._parseJSON(f.villain_actions_json, [])
        };
      })
      .catch(function () { /* no entity data */ });
  },

  _parseList: function (val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { var arr = JSON.parse(val); if (Array.isArray(arr)) return arr; } catch (e) {}
    return String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  },

  _parseJSON: function (val, fallback) {
    if (!val) return fallback;
    try { return JSON.parse(val); } catch (e) { return fallback; }
  },

  _injectStyles: function () {
    if (this.el.querySelector('style.sb-styles')) return;
    var style = document.createElement('style');
    style.className = 'sb-styles';
    style.textContent = [
      '.statblock-renderer { font-family:Inter,system-ui,-apple-system,sans-serif; font-size:14px; border-radius:12px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,0.05); border:1px solid var(--color-border,#e5e7eb); background:var(--color-card-bg,#fff); }',
      '.sb-header { background:var(--color-accent,#6366f1); padding:16px 20px; }',
      '.sb-name { margin:0 0 4px; font-size:20px; font-weight:700; color:#fff; }',
      '.sb-subtitle { color:rgba(255,255,255,0.85); font-size:14px; }',
      '.sb-keywords { font-style:italic; color:rgba(255,255,255,0.7); font-size:12px; margin-top:4px; }',
      '.sb-faction { color:rgba(255,255,255,0.7); font-size:12px; }',
      '.sb-ev { display:inline-block; margin-top:6px; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:600; background:rgba(255,255,255,0.2); color:#fff; }',
      '.sb-content { padding:16px 20px; }',
      '.sb-divider { border:none; border-top:2px solid var(--color-accent,#6366f1); margin:12px 0; opacity:0.3; }',
      '.sb-stats { margin:8px 0; }',
      '.sb-stat-row { display:flex; gap:8px; flex-wrap:wrap; }',
      '.sb-stat { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-primary,#111827); }',
      '.sb-stat strong { font-weight:600; color:var(--color-text-secondary,#6b7280); }',
      '.sb-characteristics { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0; }',
      '.sb-char { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); }',
      '.sb-char strong { font-weight:600; color:var(--color-text-secondary,#6b7280); }',
      '.sb-char.positive { background:rgba(16,185,129,0.1); color:#047857; }',
      '.sb-char.negative { background:rgba(239,68,68,0.1); color:#b91c1c; }',
      '.sb-char.zero { background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.sb-immunities { margin:8px 0; font-size:14px; color:var(--color-text-body,#374151); }',
      '.sb-free-strike { margin:8px 0; font-size:14px; color:var(--color-text-body,#374151); }',
      '.sb-ability { padding:10px 0; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.sb-ability:last-child { border-bottom:none; }',
      '.sb-ability-name { font-weight:600; font-size:14px; color:var(--color-text-primary,#111827); }',
      '.sb-ability-type { display:inline-block; margin-left:6px; padding:1px 8px; border-radius:9999px; font-size:11px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); vertical-align:middle; }',
      '.sb-ability-kw { font-style:italic; color:var(--color-text-secondary,#6b7280); font-size:12px; margin-top:2px; }',
      '.sb-ability-meta { color:var(--color-text-body,#374151); font-size:12px; margin-top:4px; }',
      '.sb-ability-trigger { font-size:14px; margin-top:4px; color:var(--color-text-body,#374151); }',
      '.sb-ability-tiers { border-left:2px solid var(--color-border,#e5e7eb); padding-left:12px; margin:6px 0; font-size:14px; }',
      '.sb-ability-tiers > div { margin:2px 0; color:var(--color-text-body,#374151); }',
      '.sb-ability-effect { font-size:14px; margin-top:4px; color:var(--color-text-body,#374151); }',
      '.sb-ability-vp { font-size:14px; margin-top:4px; color:var(--color-accent,#6366f1); font-weight:600; }',
      '.sb-section-title { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); margin:0 0 8px; }',
      '.sb-va { margin:8px 0; }',
      '.sb-va-name { font-weight:600; font-size:14px; color:var(--color-text-primary,#111827); }',
      '.sb-va-desc { font-size:14px; margin-top:2px; color:var(--color-text-body,#374151); }',
      '.sb-va-roll { font-size:12px; color:var(--color-text-secondary,#6b7280); margin-top:2px; }',
      '.sb-va-tiers { border-left:2px solid var(--color-border,#e5e7eb); padding-left:12px; margin:6px 0; font-size:14px; }',
      '.sb-va-tiers > div { margin:2px 0; color:var(--color-text-body,#374151); }',
      '.sb-trait { margin:6px 0; font-size:14px; color:var(--color-text-body,#374151); }',
      '.sb-empty { text-align:center; padding:48px 16px; }',
      '.sb-empty-icon { width:48px; height:48px; border-radius:9999px; background:var(--color-bg-tertiary,#f3f4f6); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px; font-size:20px; color:var(--color-text-muted,#9ca3af); }',
      '.sb-empty-title { font-size:18px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 4px; }',
      '.sb-empty-desc { font-size:14px; color:var(--color-text-secondary,#6b7280); max-width:24rem; margin:0 auto; }'
    ].join('\n');
    this.el.insertBefore(style, this.el.firstChild);
  },

  _render: function () {
    var el = this.el;
    el.innerHTML = '';
    el.className = 'statblock-renderer';
    this._injectStyles();

    if (!this.creature) {
      el.innerHTML = '<div class="sb-empty">' +
        '<div class="sb-empty-icon">&#128026;</div>' +
        '<div class="sb-empty-title">No creature data</div>' +
        '<div class="sb-empty-desc">Configure the entity_id to display a creature statblock.</div>' +
        '</div>';
      return;
    }

    var cr = this.creature;
    var h = Chronicle.escapeHtml;
    var ref = this._ref;
    var html = '';

    // Header (accent bar)
    html += '<div class="sb-header">';
    html += '<h2 class="sb-name">' + h(cr.name) + '</h2>';
    html += '<div class="sb-subtitle">';
    html += 'Level ' + cr.level + ' ';
    if (cr.size) html += cr.size + ' ';
    if (cr.organization) html += h(cr.organization.charAt(0).toUpperCase() + cr.organization.slice(1)) + ' ';
    if (cr.role) html += h(cr.role.charAt(0).toUpperCase() + cr.role.slice(1));
    html += '</div>';
    if (cr.keywords.length > 0) {
      html += '<div class="sb-keywords">' + cr.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
    }
    if (cr.faction) {
      html += '<div class="sb-faction">' + h(cr.faction) + '</div>';
    }
    html += '<span class="sb-ev">EV ' + cr.ev + '</span>';
    html += '</div>';

    // Content body
    html += '<div class="sb-content">';

    // Core stats
    html += '<div class="sb-stats">';
    html += '<div class="sb-stat-row">';
    html += '<span class="sb-stat"><strong>STM</strong> ' + cr.stamina + '</span>';
    html += '<span class="sb-stat"><strong>Winded</strong> ' + cr.winded + '</span>';
    html += '<span class="sb-stat"><strong>SPD</strong> ' + cr.speed + '</span>';
    html += '<span class="sb-stat"><strong>Stability</strong> ' + cr.stability + '</span>';
    html += '</div>';
    html += '</div>';

    // Characteristics with +/- coloring
    html += '<div class="sb-characteristics">';
    var chars = ['might', 'agility', 'reason', 'intuition', 'presence'];
    chars.forEach(function (stat) {
      var val = cr[stat];
      var sign = val >= 0 ? '+' : '';
      var cls = val > 0 ? 'positive' : (val < 0 ? 'negative' : 'zero');
      html += '<span class="sb-char ' + cls + '"><strong>' + stat.charAt(0).toUpperCase() + stat.slice(1, 3).toUpperCase() + '</strong> ' + sign + val + '</span>';
    });
    html += '</div>';

    // Immunities
    if (cr.immunities.length > 0) {
      html += '<div class="sb-immunities"><strong>Immunities:</strong> ' + cr.immunities.map(function (i) { return h(i); }).join(', ') + '</div>';
    }

    html += '<div class="sb-divider"></div>';

    // Free Strike
    if (cr.free_strike) {
      html += '<div class="sb-free-strike"><strong>Free Strike:</strong> ' + h(cr.free_strike) + '</div>';
    }

    // Abilities
    if (cr.abilities.length > 0) {
      html += '<div class="sb-abilities">';
      cr.abilities.forEach(function (ab) {
        var typeLabel = ab.type === 'signature' ? '&#9733; ' : '';
        html += '<div class="sb-ability">';
        html += '<div class="sb-ability-name">' + typeLabel + h(ab.name) + ' <span class="sb-ability-type">' + h(ab.type) + '</span></div>';
        if (ab.keywords && ab.keywords.length > 0) {
          html += '<div class="sb-ability-kw">' + ab.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
        }
        var meta = [];
        if (ab.distance) meta.push(h(ab.distance));
        if (ab.target) meta.push(h(ab.target));
        if (ab.power_roll) meta.push(h(ab.power_roll));
        if (meta.length > 0) {
          html += '<div class="sb-ability-meta">' + meta.join(' &bull; ') + '</div>';
        }
        if (ab.trigger) {
          html += '<div class="sb-ability-trigger"><strong>Trigger:</strong> ' + ref.renderText(h(ab.trigger)) + '</div>';
        }
        if (ab.tier1 || ab.tier2 || ab.tier3) {
          html += '<div class="sb-ability-tiers">';
          if (ab.tier1) html += '<div><strong>11 or lower:</strong> ' + ref.renderText(h(ab.tier1)) + '</div>';
          if (ab.tier2) html += '<div><strong>12-16:</strong> ' + ref.renderText(h(ab.tier2)) + '</div>';
          if (ab.tier3) html += '<div><strong>17+:</strong> ' + ref.renderText(h(ab.tier3)) + '</div>';
          html += '</div>';
        }
        if (ab.effect) {
          html += '<div class="sb-ability-effect"><strong>Effect:</strong> ' + ref.renderText(h(ab.effect)) + '</div>';
        }
        if (ab.spend_vp && ab.spend_vp > 0) {
          html += '<div class="sb-ability-vp"><strong>Spend ' + ab.spend_vp + ' VP:</strong> Enhanced effect</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Villain Actions
    var filledVA = cr.villain_actions.filter(function (va) { return va.name && va.name.trim() !== ''; });
    if (filledVA.length > 0) {
      html += '<div class="sb-divider"></div>';
      html += '<div class="sb-villain-actions">';
      html += '<h3 class="sb-section-title">Villain Actions</h3>';
      var orderLabels = { 'opener': 'Opener', 'crowd-control': 'Crowd Control', 'ultimate': 'Ultimate' };
      filledVA.forEach(function (va) {
        var label = orderLabels[va.order] || va.order;
        html += '<div class="sb-va">';
        html += '<div class="sb-va-name"><strong>' + h(label) + ':</strong> ' + h(va.name) + '</div>';
        if (va.description) html += '<div class="sb-va-desc">' + ref.renderText(h(va.description)) + '</div>';
        if (va.power_roll) html += '<div class="sb-va-roll">' + h(va.power_roll) + '</div>';
        if (va.tier1 || va.tier2 || va.tier3) {
          html += '<div class="sb-va-tiers">';
          if (va.tier1) html += '<div><strong>11 or lower:</strong> ' + ref.renderText(h(va.tier1)) + '</div>';
          if (va.tier2) html += '<div><strong>12-16:</strong> ' + ref.renderText(h(va.tier2)) + '</div>';
          if (va.tier3) html += '<div><strong>17+:</strong> ' + ref.renderText(h(va.tier3)) + '</div>';
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Traits
    if (cr.traits.length > 0) {
      html += '<div class="sb-divider"></div>';
      html += '<div class="sb-traits">';
      html += '<h3 class="sb-section-title">Traits</h3>';
      cr.traits.forEach(function (trait) {
        html += '<div class="sb-trait"><strong>' + h(trait.name) + '.</strong> ' + ref.renderText(h(trait.description)) + '</div>';
      });
      html += '</div>';
    }

    html += '</div>'; // close sb-content
    el.innerHTML = html;
  }
});
