/**
 * Draw Steel Monster Builder Widget
 * A stepped creature authoring tool with mechanical intelligence.
 */
Chronicle.register('monster-builder', {
  init: function (el, config) {
    var self = this;
    this.el = el;
    this.config = config;
    this.currentStep = 0;
    this.steps = ['Identity', 'Organization & Role', 'Statistics', 'Abilities', 'Free Strike', 'Villain Actions', 'Traits'];
    this.orgTemplates = [];
    this.roleTemplates = [];
    this.creatureKeywords = [];
    this.abilityKeywords = [];
    this.damageBaselines = {};
    this.templateAbilities = [];

    // Creature state
    this.creature = {
      name: '',
      level: 1,
      size: 'M',
      faction: '',
      keywords: [],
      organization: '',
      role: '',
      ev: 0,
      stamina: 0,
      winded: 0,
      speed: 5,
      stability: 0,
      might: 0,
      agility: 0,
      reason: 0,
      intuition: 0,
      presence: 0,
      immunities: [],
      free_strike: '',
      free_strike_damage: 0,
      abilities: [],
      villain_actions: [
        { order: 'opener', name: '', description: '', power_roll: '', tier1: '', tier2: '', tier3: '' },
        { order: 'crowd-control', name: '', description: '', power_roll: '', tier1: '', tier2: '', tier3: '' },
        { order: 'ultimate', name: '', description: '', power_roll: '', tier1: '', tier2: '', tier3: '' }
      ],
      traits: []
    };

    this._loadData().then(function () {
      self._loadExistingEntity().then(function () {
        self._render();
      });
    });
  },

  destroy: function (el) {
    el.innerHTML = '';
  },

  _loadData: function () {
    var self = this;
    var base = this.config.campaignId
      ? '/api/v1/campaigns/' + this.config.campaignId + '/extensions/drawsteel/assets/'
      : '/extensions/drawsteel/assets/';

    return Promise.all([
      fetch(base + 'data/organization-templates.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/role-templates.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/creature-keywords.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/ability-keywords.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/damage-baselines.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/creature-abilities.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
      self.orgTemplates = results[0];
      self.roleTemplates = results[1];
      self.creatureKeywords = results[2];
      self.abilityKeywords = results[3];
      self.damageBaselines = results[4].baselines || {};
      self.templateAbilities = results[5];
    }).catch(function (err) {
      console.error('Monster Builder: failed to load reference data', err);
    });
  },

  _loadExistingEntity: function () {
    var self = this;
    if (!this.config.entityId || !this.config.campaignId) return Promise.resolve();

    var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities/' + this.config.entityId;
    return Chronicle.apiFetch(url)
      .then(function (r) { return r.json(); })
      .then(function (entity) {
        if (!entity || !entity.custom_fields) return;
        var f = entity.custom_fields;
        self.creature.name = entity.name || '';
        var numFields = ['level', 'ev', 'stamina', 'winded', 'speed', 'stability',
          'might', 'agility', 'reason', 'intuition', 'presence', 'free_strike_damage'];
        numFields.forEach(function (k) {
          if (f[k] !== undefined) self.creature[k] = Number(f[k]) || 0;
        });
        var strFields = ['organization', 'role', 'size', 'faction', 'free_strike', 'immunities', 'keywords'];
        strFields.forEach(function (k) {
          if (f[k] !== undefined) self.creature[k] = f[k];
        });
        // Parse JSON fields
        if (f.keywords && typeof f.keywords === 'string') {
          try { self.creature.keywords = JSON.parse(f.keywords); } catch (e) {
            self.creature.keywords = f.keywords.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          }
        }
        if (f.immunities && typeof f.immunities === 'string') {
          try { self.creature.immunities = JSON.parse(f.immunities); } catch (e) {
            self.creature.immunities = f.immunities.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          }
        }
        if (f.abilities_json) {
          try { self.creature.abilities = JSON.parse(f.abilities_json); } catch (e) { /* keep empty */ }
        }
        if (f.villain_actions_json) {
          try {
            var va = JSON.parse(f.villain_actions_json);
            if (Array.isArray(va) && va.length === 3) self.creature.villain_actions = va;
          } catch (e) { /* keep defaults */ }
        }
        if (f.traits) {
          try { self.creature.traits = JSON.parse(f.traits); } catch (e) {
            self.creature.traits = typeof f.traits === 'string' ? [{ name: '', description: f.traits }] : [];
          }
        }
      })
      .catch(function () { /* new creature, use defaults */ });
  },

  // ── Rendering ──────────────────────────────────────────────

  _render: function () {
    var el = this.el;
    el.innerHTML = '';
    el.className = 'monster-builder';

    // Header
    var header = document.createElement('div');
    header.className = 'mb-header';
    header.innerHTML = '<h2><i class="fa-solid fa-dragon"></i> Draw Steel Monster Builder</h2>';
    el.appendChild(header);

    // Step indicator
    var nav = document.createElement('div');
    nav.className = 'mb-step-nav';
    this._renderStepIndicator(nav);
    el.appendChild(nav);
    this._navEl = nav;

    // Step content
    var content = document.createElement('div');
    content.className = 'mb-step-content';
    el.appendChild(content);
    this._contentEl = content;

    // Navigation buttons
    var buttons = document.createElement('div');
    buttons.className = 'mb-buttons';
    el.appendChild(buttons);
    this._buttonsEl = buttons;

    // Validation panel
    var validation = document.createElement('div');
    validation.className = 'mb-validation';
    el.appendChild(validation);
    this._validationEl = validation;

    this._renderCurrentStep();
  },

  _renderStepIndicator: function (nav) {
    var self = this;
    nav.innerHTML = '';
    for (var i = 0; i < this.steps.length; i++) {
      var step = document.createElement('button');
      step.className = 'mb-step-tab' + (i === this.currentStep ? ' active' : '');
      step.textContent = (i + 1) + '. ' + this.steps[i];
      step.dataset.step = i;
      // Hide villain actions tab unless leader/solo
      if (i === 5 && this.creature.organization !== 'leader' && this.creature.organization !== 'solo') {
        step.style.display = 'none';
      }
      step.addEventListener('click', function () {
        self.currentStep = parseInt(this.dataset.step);
        self._renderCurrentStep();
      });
      nav.appendChild(step);
    }
  },

  _renderCurrentStep: function () {
    this._renderStepIndicator(this._navEl);
    this._contentEl.innerHTML = '';

    switch (this.currentStep) {
      case 0: this._renderStep1Identity(); break;
      case 1: this._renderStep2OrgRole(); break;
      case 2: this._renderStep3Stats(); break;
      case 3: this._renderStep4Abilities(); break;
      case 4: this._renderStep5FreeStrike(); break;
      case 5: this._renderStep6VillainActions(); break;
      case 6: this._renderStep7Traits(); break;
    }

    this._renderButtons();
    this._renderValidation();
  },

  _renderButtons: function () {
    var self = this;
    var b = this._buttonsEl;
    b.innerHTML = '';

    if (this.currentStep > 0) {
      var prev = document.createElement('button');
      prev.className = 'btn btn-secondary';
      prev.textContent = 'Previous';
      prev.addEventListener('click', function () {
        self.currentStep--;
        // Skip villain actions if not leader/solo
        if (self.currentStep === 5 && self.creature.organization !== 'leader' && self.creature.organization !== 'solo') {
          self.currentStep--;
        }
        self._renderCurrentStep();
      });
      b.appendChild(prev);
    }

    if (this.currentStep < this.steps.length - 1) {
      var next = document.createElement('button');
      next.className = 'btn btn-primary';
      next.textContent = 'Next';
      next.addEventListener('click', function () {
        self.currentStep++;
        // Skip villain actions if not leader/solo
        if (self.currentStep === 5 && self.creature.organization !== 'leader' && self.creature.organization !== 'solo') {
          self.currentStep++;
        }
        self._renderCurrentStep();
      });
      b.appendChild(next);
    }

    // Save button always visible
    var save = document.createElement('button');
    save.className = 'btn btn-success';
    save.textContent = 'Save Creature';
    save.addEventListener('click', function () { self._save(); });
    b.appendChild(save);
  },

  // ── Step 1: Identity ──────────────────────────────────────

  _renderStep1Identity: function () {
    var self = this;
    var c = this._contentEl;
    var h = Chronicle.escapeHtml;

    c.innerHTML =
      '<div class="mb-section">' +
      '<h3>Step 1: Identity</h3>' +
      '<div class="mb-field-row">' +
        '<label>Name<input type="text" class="mb-input" id="mb-name" value="' + h(this.creature.name) + '" placeholder="Creature name"></label>' +
        '<label>Level (1-20)<input type="number" class="mb-input" id="mb-level" min="1" max="20" value="' + this.creature.level + '"></label>' +
        '<label>Size<select class="mb-input" id="mb-size">' +
          ['T', 'S', 'M', 'L', 'H', 'G'].map(function (s) {
            return '<option value="' + s + '"' + (self.creature.size === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') +
        '</select></label>' +
        '<label>Faction<input type="text" class="mb-input" id="mb-faction" value="' + h(this.creature.faction) + '" placeholder="e.g. Goblin, Dragon"></label>' +
      '</div>' +
      '<div class="mb-field-row">' +
        '<label>Keywords</label>' +
        '<div class="mb-keyword-list" id="mb-keywords"></div>' +
      '</div>' +
      '</div>';

    // Keyword multi-select
    var kwContainer = c.querySelector('#mb-keywords');
    this.creatureKeywords.forEach(function (kw) {
      var selected = self.creature.keywords.indexOf(kw.name) !== -1;
      var tag = document.createElement('button');
      tag.className = 'mb-tag' + (selected ? ' selected' : '');
      tag.textContent = kw.name;
      tag.title = kw.description;
      tag.addEventListener('click', function () {
        var idx = self.creature.keywords.indexOf(kw.name);
        if (idx === -1) { self.creature.keywords.push(kw.name); tag.classList.add('selected'); }
        else { self.creature.keywords.splice(idx, 1); tag.classList.remove('selected'); }
      });
      kwContainer.appendChild(tag);
    });

    // Bind inputs
    c.querySelector('#mb-name').addEventListener('input', function () { self.creature.name = this.value; });
    c.querySelector('#mb-level').addEventListener('change', function () {
      self.creature.level = Math.max(1, Math.min(20, parseInt(this.value) || 1));
      self._recalcAuto();
    });
    c.querySelector('#mb-size').addEventListener('change', function () { self.creature.size = this.value; });
    c.querySelector('#mb-faction').addEventListener('input', function () { self.creature.faction = this.value; });
  },

  // ── Step 2: Organization & Role ───────────────────────────

  _renderStep2OrgRole: function () {
    var self = this;
    var c = this._contentEl;

    var orgHtml = '<div class="mb-section"><h3>Step 2: Organization & Role</h3>' +
      '<div class="mb-card-grid"><div class="mb-card-col"><h4>Organization</h4>';
    this.orgTemplates.forEach(function (o) {
      var sel = self.creature.organization === o.slug ? ' selected' : '';
      orgHtml += '<button class="mb-radio-card' + sel + '" data-org="' + o.slug + '">' +
        '<strong>' + Chronicle.escapeHtml(o.name) + '</strong> (' + o.ev_multiplier + ' EV/level)' +
        '<br><small>' + Chronicle.escapeHtml(o.description) + '</small></button>';
    });
    orgHtml += '</div><div class="mb-card-col"><h4>Role</h4>';
    this.roleTemplates.forEach(function (r) {
      var sel = self.creature.role === r.slug ? ' selected' : '';
      orgHtml += '<button class="mb-radio-card' + sel + '" data-role="' + r.slug + '">' +
        '<strong>' + Chronicle.escapeHtml(r.name) + '</strong>' +
        '<br><small>' + Chronicle.escapeHtml(r.description) + '</small></button>';
    });
    orgHtml += '</div></div>';
    orgHtml += '<div class="mb-ev-display">EV: <strong id="mb-ev-value">' + this.creature.ev + '</strong></div>';
    orgHtml += '</div>';
    c.innerHTML = orgHtml;

    // Bind org cards
    c.querySelectorAll('[data-org]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        c.querySelectorAll('[data-org]').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        self.creature.organization = btn.dataset.org;
        self._recalcAuto();
        c.querySelector('#mb-ev-value').textContent = self.creature.ev;
        // Re-render step nav to show/hide villain actions tab
        self._renderStepIndicator(self._navEl);
      });
    });

    // Bind role cards
    c.querySelectorAll('[data-role]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        c.querySelectorAll('[data-role]').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        self.creature.role = btn.dataset.role;
        self._recalcAuto();
      });
    });
  },

  // ── Step 3: Statistics ────────────────────────────────────

  _renderStep3Stats: function () {
    var self = this;
    var c = this._contentEl;
    var cr = this.creature;
    var suggested = this._getSuggestedStats();

    c.innerHTML =
      '<div class="mb-section"><h3>Step 3: Statistics</h3>' +
      '<p class="mb-hint">Values auto-filled from organization and role templates. Edit to customize.</p>' +
      '<div class="mb-field-row">' +
        '<label>Stamina<input type="number" class="mb-input" id="mb-stamina" value="' + cr.stamina + '">' +
        '<small class="mb-suggestion">suggested: ' + suggested.stamina + '</small></label>' +
        '<label>Winded<input type="number" class="mb-input" id="mb-winded" value="' + cr.winded + '" readonly>' +
        '<small class="mb-suggestion">auto: floor(stamina/2)</small></label>' +
        '<label>Speed<input type="number" class="mb-input" id="mb-speed" value="' + cr.speed + '">' +
        '<small class="mb-suggestion">suggested: ' + suggested.speed + '</small></label>' +
        '<label>Stability<input type="number" class="mb-input" id="mb-stability" value="' + cr.stability + '">' +
        '<small class="mb-suggestion">suggested: ' + suggested.stability + '</small></label>' +
      '</div>' +
      '<h4>Characteristics</h4>' +
      '<div class="mb-field-row">' +
        '<label>Might<input type="number" class="mb-input" id="mb-might" value="' + cr.might + '"></label>' +
        '<label>Agility<input type="number" class="mb-input" id="mb-agility" value="' + cr.agility + '"></label>' +
        '<label>Reason<input type="number" class="mb-input" id="mb-reason" value="' + cr.reason + '"></label>' +
        '<label>Intuition<input type="number" class="mb-input" id="mb-intuition" value="' + cr.intuition + '"></label>' +
        '<label>Presence<input type="number" class="mb-input" id="mb-presence" value="' + cr.presence + '"></label>' +
      '</div>' +
      '<h4>Immunities</h4>' +
      '<div id="mb-immunities-list" class="mb-list-editor"></div>' +
      '<button class="btn btn-sm btn-secondary" id="mb-add-immunity">+ Add Immunity</button>' +
      '</div>';

    // Bind stat inputs
    ['stamina', 'speed', 'stability', 'might', 'agility', 'reason', 'intuition', 'presence'].forEach(function (field) {
      var input = c.querySelector('#mb-' + field);
      if (input) {
        input.addEventListener('change', function () {
          self.creature[field] = parseInt(this.value) || 0;
          if (field === 'stamina') {
            self.creature.winded = Math.floor(self.creature.stamina / 2);
            c.querySelector('#mb-winded').value = self.creature.winded;
          }
        });
      }
    });

    // Immunities editor
    this._renderImmunities(c.querySelector('#mb-immunities-list'));
    c.querySelector('#mb-add-immunity').addEventListener('click', function () {
      self.creature.immunities.push('');
      self._renderImmunities(c.querySelector('#mb-immunities-list'));
    });
  },

  _renderImmunities: function (container) {
    var self = this;
    container.innerHTML = '';
    this.creature.immunities.forEach(function (imm, i) {
      var row = document.createElement('div');
      row.className = 'mb-list-row';
      row.innerHTML = '<input type="text" class="mb-input" value="' + Chronicle.escapeHtml(imm) + '" placeholder="e.g. Magic 2">' +
        '<button class="btn btn-sm btn-danger">X</button>';
      row.querySelector('input').addEventListener('change', function () {
        self.creature.immunities[i] = this.value;
      });
      row.querySelector('button').addEventListener('click', function () {
        self.creature.immunities.splice(i, 1);
        self._renderImmunities(container);
      });
      container.appendChild(row);
    });
  },

  // ── Step 4: Abilities ─────────────────────────────────────

  _renderStep4Abilities: function () {
    var self = this;
    var c = this._contentEl;

    c.innerHTML =
      '<div class="mb-section"><h3>Step 4: Abilities</h3>' +
      '<div id="mb-abilities-list"></div>' +
      '<div class="mb-ability-actions">' +
        '<button class="btn btn-primary" id="mb-add-ability">+ Add Ability</button>' +
        '<button class="btn btn-secondary" id="mb-use-template">Use Template</button>' +
      '</div>' +
      '<div id="mb-template-picker" style="display:none"></div>' +
      '</div>';

    this._renderAbilitiesList(c.querySelector('#mb-abilities-list'));

    c.querySelector('#mb-add-ability').addEventListener('click', function () {
      self.creature.abilities.push({
        name: 'New Ability',
        type: 'signature',
        keywords: [],
        distance: 'Melee 1',
        target: '1 creature',
        power_roll: '',
        tier1: '',
        tier2: '',
        tier3: '',
        effect: '',
        trigger: '',
        spend_vp: 0
      });
      self._renderAbilitiesList(c.querySelector('#mb-abilities-list'));
    });

    c.querySelector('#mb-use-template').addEventListener('click', function () {
      var picker = c.querySelector('#mb-template-picker');
      if (picker.style.display === 'none') {
        self._renderTemplatePicker(picker);
        picker.style.display = 'block';
      } else {
        picker.style.display = 'none';
      }
    });
  },

  _renderAbilitiesList: function (container) {
    var self = this;
    container.innerHTML = '';

    if (this.creature.abilities.length === 0) {
      container.innerHTML = '<p class="mb-empty">No abilities yet. Add one or use a template.</p>';
      return;
    }

    this.creature.abilities.forEach(function (ability, index) {
      var card = document.createElement('div');
      card.className = 'mb-ability-card';
      var typeIcon = ability.type === 'signature' ? '&#9733; ' : '';
      var typeLabel = ability.type.charAt(0).toUpperCase() + ability.type.slice(1);

      card.innerHTML =
        '<div class="mb-ability-header">' +
          '<span class="mb-ability-type">[' + typeLabel + ']</span> ' +
          '<input type="text" class="mb-input mb-ability-name" value="' + Chronicle.escapeHtml(ability.name) + '">' +
          '<button class="btn btn-sm btn-danger mb-delete-ability">Delete</button>' +
          '<button class="btn btn-sm btn-secondary mb-toggle-ability">Edit</button>' +
        '</div>' +
        '<div class="mb-ability-summary">' +
          Chronicle.escapeHtml(ability.distance) + ' &bull; ' + Chronicle.escapeHtml(ability.target) +
          (ability.power_roll ? ' &bull; ' + Chronicle.escapeHtml(ability.power_roll) : '') +
        '</div>' +
        '<div class="mb-ability-detail" style="display:none">' +
          '<div class="mb-field-row">' +
            '<label>Type<select class="mb-input mb-ab-type">' +
              ['signature', 'action', 'maneuver', 'triggered', 'villain-action', 'trait'].map(function (t) {
                return '<option value="' + t + '"' + (ability.type === t ? ' selected' : '') + '>' + t + '</option>';
              }).join('') +
            '</select></label>' +
            '<label>Distance<input type="text" class="mb-input mb-ab-distance" value="' + Chronicle.escapeHtml(ability.distance) + '"></label>' +
            '<label>Target<input type="text" class="mb-input mb-ab-target" value="' + Chronicle.escapeHtml(ability.target) + '"></label>' +
          '</div>' +
          '<div class="mb-field-row">' +
            '<label>Power Roll<input type="text" class="mb-input mb-ab-roll" value="' + Chronicle.escapeHtml(ability.power_roll || '') + '" placeholder="e.g. Might vs. Agility"></label>' +
          '</div>' +
          '<div class="mb-field-row mb-tiers">' +
            '<label>T1 (11-)<input type="text" class="mb-input mb-ab-t1" value="' + Chronicle.escapeHtml(ability.tier1 || '') + '"></label>' +
            '<label>T2 (12-16)<input type="text" class="mb-input mb-ab-t2" value="' + Chronicle.escapeHtml(ability.tier2 || '') + '"></label>' +
            '<label>T3 (17+)<input type="text" class="mb-input mb-ab-t3" value="' + Chronicle.escapeHtml(ability.tier3 || '') + '"></label>' +
          '</div>' +
          '<label>Effect<textarea class="mb-input mb-ab-effect" rows="2">' + Chronicle.escapeHtml(ability.effect || '') + '</textarea></label>' +
          '<div class="mb-field-row">' +
            '<label>Trigger (triggered only)<input type="text" class="mb-input mb-ab-trigger" value="' + Chronicle.escapeHtml(ability.trigger || '') + '"></label>' +
            '<label>VP Cost<input type="number" class="mb-input mb-ab-vp" value="' + (ability.spend_vp || 0) + '" min="0"></label>' +
          '</div>' +
          '<div class="mb-keyword-list mb-ab-keywords"></div>' +
        '</div>';

      // Toggle detail
      card.querySelector('.mb-toggle-ability').addEventListener('click', function () {
        var detail = card.querySelector('.mb-ability-detail');
        detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
      });

      // Delete
      card.querySelector('.mb-delete-ability').addEventListener('click', function () {
        self.creature.abilities.splice(index, 1);
        self._renderAbilitiesList(container);
      });

      // Bind fields
      card.querySelector('.mb-ability-name').addEventListener('change', function () { ability.name = this.value; });
      card.querySelector('.mb-ab-type').addEventListener('change', function () {
        ability.type = this.value;
        card.querySelector('.mb-ability-type').textContent = '[' + this.value.charAt(0).toUpperCase() + this.value.slice(1) + ']';
      });
      card.querySelector('.mb-ab-distance').addEventListener('change', function () { ability.distance = this.value; });
      card.querySelector('.mb-ab-target').addEventListener('change', function () { ability.target = this.value; });
      card.querySelector('.mb-ab-roll').addEventListener('change', function () { ability.power_roll = this.value; });
      card.querySelector('.mb-ab-t1').addEventListener('change', function () { ability.tier1 = this.value; });
      card.querySelector('.mb-ab-t2').addEventListener('change', function () { ability.tier2 = this.value; });
      card.querySelector('.mb-ab-t3').addEventListener('change', function () { ability.tier3 = this.value; });
      card.querySelector('.mb-ab-effect').addEventListener('change', function () { ability.effect = this.value; });
      card.querySelector('.mb-ab-trigger').addEventListener('change', function () { ability.trigger = this.value; });
      card.querySelector('.mb-ab-vp').addEventListener('change', function () { ability.spend_vp = parseInt(this.value) || 0; });

      // Ability keywords
      var kwList = card.querySelector('.mb-ab-keywords');
      self.abilityKeywords.forEach(function (kw) {
        var selected = (ability.keywords || []).indexOf(kw.name) !== -1;
        var tag = document.createElement('button');
        tag.className = 'mb-tag mb-tag-sm' + (selected ? ' selected' : '');
        tag.textContent = kw.name;
        tag.title = kw.description;
        tag.addEventListener('click', function () {
          if (!ability.keywords) ability.keywords = [];
          var idx = ability.keywords.indexOf(kw.name);
          if (idx === -1) { ability.keywords.push(kw.name); tag.classList.add('selected'); }
          else { ability.keywords.splice(idx, 1); tag.classList.remove('selected'); }
        });
        kwList.appendChild(tag);
      });

      container.appendChild(card);
    });
  },

  _renderTemplatePicker: function (container) {
    var self = this;
    container.innerHTML = '<h4>Ability Templates</h4>';
    this.templateAbilities.forEach(function (tmpl) {
      var btn = document.createElement('button');
      btn.className = 'mb-template-btn';
      btn.innerHTML = '<strong>' + Chronicle.escapeHtml(tmpl.name) + '</strong> [' + tmpl.type + ']' +
        '<br><small>' + Chronicle.escapeHtml(tmpl.description || '') + '</small>';
      btn.addEventListener('click', function () {
        var copy = JSON.parse(JSON.stringify(tmpl));
        delete copy.description;
        self.creature.abilities.push(copy);
        self._renderAbilitiesList(self._contentEl.querySelector('#mb-abilities-list'));
        container.style.display = 'none';
      });
      container.appendChild(btn);
    });
  },

  // ── Auto-calculation ──────────────────────────────────────

  _recalcAuto: function () {
    var org = this._getOrgTemplate();
    var role = this._getRoleTemplate();
    if (org) {
      this.creature.ev = org.ev_multiplier * this.creature.level;
      this.creature.stamina = org.stamina_base + (org.stamina_per_level * this.creature.level);
      this.creature.winded = Math.floor(this.creature.stamina / 2);
      this.creature.speed = org.default_speed;
      this.creature.stability = org.default_stability;
    }
    if (role) {
      this.creature.might = role.characteristics.might;
      this.creature.agility = role.characteristics.agility;
      this.creature.reason = role.characteristics.reason;
      this.creature.intuition = role.characteristics.intuition;
      this.creature.presence = role.characteristics.presence;
    }
    // Auto free strike
    var primaryStat = role ? this.creature[role.primary_stat] : 0;
    this.creature.free_strike_damage = this.creature.level + primaryStat;
    this.creature.free_strike = this.creature.free_strike_damage + ' damage';
  },

  _getOrgTemplate: function () {
    var slug = this.creature.organization;
    for (var i = 0; i < this.orgTemplates.length; i++) {
      if (this.orgTemplates[i].slug === slug) return this.orgTemplates[i];
    }
    return null;
  },

  _getRoleTemplate: function () {
    var slug = this.creature.role;
    for (var i = 0; i < this.roleTemplates.length; i++) {
      if (this.roleTemplates[i].slug === slug) return this.roleTemplates[i];
    }
    return null;
  },

  _getSuggestedStats: function () {
    var org = this._getOrgTemplate();
    if (!org) return { stamina: '?', speed: '?', stability: '?' };
    return {
      stamina: org.stamina_base + (org.stamina_per_level * this.creature.level),
      speed: org.default_speed,
      stability: org.default_stability
    };
  },

  // ── Steps 5-7, Validation, Save — defined in next commit ──
  _renderStep5FreeStrike: function () { this._contentEl.innerHTML = '<p>Loading...</p>'; },
  _renderStep6VillainActions: function () { this._contentEl.innerHTML = '<p>Loading...</p>'; },
  _renderStep7Traits: function () { this._contentEl.innerHTML = '<p>Loading...</p>'; },
  _renderValidation: function () {},
  _save: function () {}
});
