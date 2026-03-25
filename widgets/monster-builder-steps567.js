/**
 * Monster Builder - Steps 5-7, Validation, Save
 * This file patches the monster-builder widget with the remaining methods.
 * Load after monster-builder.js
 */
(function () {
  var proto = Chronicle._widgetRegistry && Chronicle._widgetRegistry['monster-builder'];
  if (!proto) {
    console.error('monster-builder-steps567: base widget not found');
    return;
  }

  // Step 5: Free Strike
  proto._renderStep5FreeStrike = function () {
    var self = this;
    var c = this._contentEl;
    var cr = this.creature;
    var role = this._getRoleTemplate();
    var primaryStat = role ? role.primary_stat : 'might';
    var autoVal = cr.level + (cr[primaryStat] || 0);

    c.innerHTML =
      '<div class="mb-section"><h3>Step 5: Free Strike</h3>' +
      '<p class="mb-hint">Every creature should have a free strike. Auto-calculated as level + ' + primaryStat + ' modifier.</p>' +
      '<div class="mb-field-row">' +
        '<label>Damage<input type="number" class="mb-input" id="mb-fs-damage" value="' + cr.free_strike_damage + '">' +
        '<small class="mb-suggestion">auto: ' + autoVal + ' (level ' + cr.level + ' + ' + primaryStat + ' ' + (cr[primaryStat] || 0) + ')</small></label>' +
        '<label>Type<select class="mb-input" id="mb-fs-type">' +
          '<option value="melee"' + (cr.free_strike.indexOf('ranged') === -1 ? ' selected' : '') + '>Melee</option>' +
          '<option value="ranged"' + (cr.free_strike.indexOf('ranged') !== -1 ? ' selected' : '') + '>Ranged</option>' +
        '</select></label>' +
        '<label>Description (optional)<input type="text" class="mb-input" id="mb-fs-desc" value="' + Chronicle.escapeHtml(cr.free_strike) + '" placeholder="e.g. 5 damage"></label>' +
      '</div>' +
      '</div>';

    c.querySelector('#mb-fs-damage').addEventListener('change', function () {
      self.creature.free_strike_damage = parseInt(this.value) || 0;
      self.creature.free_strike = self.creature.free_strike_damage + ' damage';
      c.querySelector('#mb-fs-desc').value = self.creature.free_strike;
    });
    c.querySelector('#mb-fs-desc').addEventListener('change', function () {
      self.creature.free_strike = this.value;
    });
  };

  // Step 6: Villain Actions
  proto._renderStep6VillainActions = function () {
    var self = this;
    var c = this._contentEl;
    var cr = this.creature;
    var labels = [
      { order: 'opener', label: 'Opener', icon: '1', desc: 'Used first. Often buffs allies or repositions.' },
      { order: 'crowd-control', label: 'Crowd Control', icon: '2', desc: 'Used mid-fight. Area effects, conditions, or disruption.' },
      { order: 'ultimate', label: 'Ultimate', icon: '3', desc: 'The big finisher. Massive damage or dramatic effect.' }
    ];

    var html = '<div class="mb-section"><h3>Step 6: Villain Actions</h3>' +
      '<p class="mb-hint">Leaders and Solos get exactly 3 villain actions, used once each per encounter in order.</p>';

    labels.forEach(function (slot, i) {
      var va = cr.villain_actions[i];
      html += '<div class="mb-va-card">' +
        '<div class="mb-va-header"><span class="mb-va-num">' + slot.icon + '</span> ' +
        '<strong>' + slot.label + '</strong> <small>' + slot.desc + '</small></div>' +
        '<div class="mb-field-row">' +
          '<label>Name<input type="text" class="mb-input mb-va-name" data-idx="' + i + '" value="' + Chronicle.escapeHtml(va.name) + '" placeholder="Villain action name"></label>' +
        '</div>' +
        '<label>Description<textarea class="mb-input mb-va-desc" data-idx="' + i + '" rows="3" placeholder="What this villain action does...">' + Chronicle.escapeHtml(va.description) + '</textarea></label>' +
        '<div class="mb-field-row">' +
          '<label>Power Roll (optional)<input type="text" class="mb-input mb-va-roll" data-idx="' + i + '" value="' + Chronicle.escapeHtml(va.power_roll || '') + '" placeholder="e.g. Might vs. Agility"></label>' +
        '</div>' +
        '<div class="mb-field-row mb-tiers">' +
          '<label>T1 (11-)<input type="text" class="mb-input mb-va-t1" data-idx="' + i + '" value="' + Chronicle.escapeHtml(va.tier1 || '') + '"></label>' +
          '<label>T2 (12-16)<input type="text" class="mb-input mb-va-t2" data-idx="' + i + '" value="' + Chronicle.escapeHtml(va.tier2 || '') + '"></label>' +
          '<label>T3 (17+)<input type="text" class="mb-input mb-va-t3" data-idx="' + i + '" value="' + Chronicle.escapeHtml(va.tier3 || '') + '"></label>' +
        '</div>' +
        '</div>';
    });

    html += '</div>';
    c.innerHTML = html;

    // Bind VA fields
    c.querySelectorAll('.mb-va-name').forEach(function (el) {
      el.addEventListener('change', function () { cr.villain_actions[parseInt(this.dataset.idx)].name = this.value; });
    });
    c.querySelectorAll('.mb-va-desc').forEach(function (el) {
      el.addEventListener('change', function () { cr.villain_actions[parseInt(this.dataset.idx)].description = this.value; });
    });
    c.querySelectorAll('.mb-va-roll').forEach(function (el) {
      el.addEventListener('change', function () { cr.villain_actions[parseInt(this.dataset.idx)].power_roll = this.value; });
    });
    c.querySelectorAll('.mb-va-t1').forEach(function (el) {
      el.addEventListener('change', function () { cr.villain_actions[parseInt(this.dataset.idx)].tier1 = this.value; });
    });
    c.querySelectorAll('.mb-va-t2').forEach(function (el) {
      el.addEventListener('change', function () { cr.villain_actions[parseInt(this.dataset.idx)].tier2 = this.value; });
    });
    c.querySelectorAll('.mb-va-t3').forEach(function (el) {
      el.addEventListener('change', function () { cr.villain_actions[parseInt(this.dataset.idx)].tier3 = this.value; });
    });
  };

  // Step 7: Traits
  proto._renderStep7Traits = function () {
    var self = this;
    var c = this._contentEl;

    c.innerHTML =
      '<div class="mb-section"><h3>Step 7: Traits</h3>' +
      '<p class="mb-hint">Passive features like resistances, auras, or special movement.</p>' +
      '<div id="mb-traits-list"></div>' +
      '<button class="btn btn-sm btn-primary" id="mb-add-trait">+ Add Trait</button>' +
      '</div>';

    this._renderTraitsList(c.querySelector('#mb-traits-list'));

    c.querySelector('#mb-add-trait').addEventListener('click', function () {
      self.creature.traits.push({ name: '', description: '' });
      self._renderTraitsList(c.querySelector('#mb-traits-list'));
    });
  };

  proto._renderTraitsList = function (container) {
    var self = this;
    container.innerHTML = '';

    if (this.creature.traits.length === 0) {
      container.innerHTML = '<p class="mb-empty">No traits yet.</p>';
      return;
    }

    this.creature.traits.forEach(function (trait, i) {
      var row = document.createElement('div');
      row.className = 'mb-trait-row';
      row.innerHTML =
        '<div class="mb-field-row">' +
          '<label>Name<input type="text" class="mb-input mb-trait-name" value="' + Chronicle.escapeHtml(trait.name) + '" placeholder="Trait name"></label>' +
          '<button class="btn btn-sm btn-danger mb-del-trait">X</button>' +
        '</div>' +
        '<label>Description<textarea class="mb-input mb-trait-desc" rows="2" placeholder="What this trait does...">' + Chronicle.escapeHtml(trait.description) + '</textarea></label>';

      row.querySelector('.mb-trait-name').addEventListener('change', function () { trait.name = this.value; });
      row.querySelector('.mb-trait-desc').addEventListener('change', function () { trait.description = this.value; });
      row.querySelector('.mb-del-trait').addEventListener('click', function () {
        self.creature.traits.splice(i, 1);
        self._renderTraitsList(container);
      });
      container.appendChild(row);
    });
  };

  // Validation
  proto._renderValidation = function () {
    var v = this._validationEl;
    if (!v) return;
    v.innerHTML = '';

    var rules = this._validate();
    if (rules.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'mb-validation-panel';
    panel.innerHTML = '<h4>Validation</h4>';

    rules.forEach(function (rule) {
      var item = document.createElement('div');
      var icon = rule.severity === 'error' ? '&#10060;' : rule.severity === 'warning' ? '&#9888;' : '&#8505;';
      item.className = 'mb-validation-item mb-v-' + rule.severity;
      item.innerHTML = '<span class="mb-v-icon">' + icon + '</span> ' + Chronicle.escapeHtml(rule.message);
      panel.appendChild(item);
    });

    v.appendChild(panel);
  };

  proto._validate = function () {
    var cr = this.creature;
    var rules = [];

    // E-rules (errors)
    if (!cr.name || cr.name.trim() === '') {
      rules.push({ severity: 'error', message: 'Creature must have a name.' });
    }
    if (!cr.organization) {
      rules.push({ severity: 'error', message: 'Organization is required.' });
    }
    if (!cr.role) {
      rules.push({ severity: 'error', message: 'Role is required.' });
    }

    var hasSignature = cr.abilities.some(function (a) { return a.type === 'signature'; });
    if (!hasSignature) {
      rules.push({ severity: 'error', message: 'Every creature must have at least 1 signature ability.' });
    }

    if (cr.organization === 'leader' || cr.organization === 'solo') {
      var vaCount = cr.villain_actions.filter(function (va) { return va.name && va.name.trim() !== ''; }).length;
      if (vaCount < 3) {
        rules.push({ severity: 'error', message: 'Leaders and solos must have exactly 3 villain actions. Currently: ' + vaCount + '.' });
      }
    }

    // W-rules (warnings)
    var org = null;
    for (var i = 0; i < (this.orgTemplates || []).length; i++) {
      if (this.orgTemplates[i].slug === cr.organization) { org = this.orgTemplates[i]; break; }
    }
    if (org) {
      var suggestedStamina = org.stamina_base + (org.stamina_per_level * cr.level);
      var deviation = Math.abs(cr.stamina - suggestedStamina) / suggestedStamina;
      if (deviation > 0.3) {
        rules.push({ severity: 'warning', message: 'Stamina (' + cr.stamina + ') deviates >30% from baseline (' + suggestedStamina + ').' });
      }
      var expectedEV = org.ev_multiplier * cr.level;
      if (cr.ev !== expectedEV) {
        rules.push({ severity: 'warning', message: 'EV (' + cr.ev + ') does not match formula (' + expectedEV + ').' });
      }
    }

    if (cr.organization !== 'leader' && cr.organization !== 'solo') {
      var hasVA = cr.villain_actions.some(function (va) { return va.name && va.name.trim() !== ''; });
      if (hasVA) {
        rules.push({ severity: 'warning', message: 'Only leaders and solos should have villain actions.' });
      }
    }

    if (!cr.free_strike || cr.free_strike.trim() === '') {
      rules.push({ severity: 'warning', message: 'Every creature should have a free strike defined.' });
    }

    // I-rules (info)
    if (cr.organization === 'swarm') {
      var hasArea = cr.abilities.some(function (a) { return (a.keywords || []).indexOf('Area') !== -1; });
      if (!hasArea) {
        rules.push({ severity: 'info', message: 'Swarm creatures typically have area-based abilities.' });
      }
    }

    // Success messages
    if (hasSignature) {
      rules.push({ severity: 'info', message: 'Signature ability present.' });
    }

    return rules;
  };

  // Save
  proto._save = function () {
    var self = this;
    var cr = this.creature;

    // Check for blocking errors
    var errors = this._validate().filter(function (r) { return r.severity === 'error'; });
    if (errors.length > 0) {
      alert('Cannot save: ' + errors[0].message);
      return;
    }

    if (!this.config.entityId || !this.config.campaignId) {
      alert('No entity context. Save is not available in preview mode.');
      return;
    }

    var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities/' + this.config.entityId;

    var payload = {
      name: cr.name,
      custom_fields: {
        level: cr.level,
        organization: cr.organization,
        role: cr.role,
        ev: cr.ev,
        size: cr.size,
        keywords: JSON.stringify(cr.keywords),
        faction: cr.faction,
        stamina: cr.stamina,
        winded: cr.winded,
        speed: cr.speed,
        stability: cr.stability,
        might: cr.might,
        agility: cr.agility,
        reason: cr.reason,
        intuition: cr.intuition,
        presence: cr.presence,
        immunities: JSON.stringify(cr.immunities),
        free_strike: cr.free_strike,
        traits: JSON.stringify(cr.traits),
        abilities_json: JSON.stringify(cr.abilities),
        villain_actions_json: JSON.stringify(cr.villain_actions)
      }
    };

    Chronicle.apiFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('Save failed: ' + res.status);
      Chronicle.markClean('monster-builder');
      // Show success briefly
      var btn = self._buttonsEl.querySelector('.btn-success');
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = 'Saved!';
        btn.disabled = true;
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2000);
      }
    }).catch(function (err) {
      alert('Failed to save creature: ' + err.message);
    });
  };
})();
