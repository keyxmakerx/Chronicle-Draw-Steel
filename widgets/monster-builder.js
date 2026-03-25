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

    // Preview button
    var preview = document.createElement('button');
    preview.className = 'btn btn-secondary';
    preview.textContent = 'Preview Statblock';
    preview.addEventListener('click', function () { self._showPreview(); });
    b.appendChild(preview);

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
          '<div class="mb-damage-hints" style="font-size:0.8em;color:#888;font-style:italic;margin:-4px 0 6px;">' + self._getDamageHints() + '</div>' +
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
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;margin:4px 0;border:1px solid #ddd;border-radius:4px;background:#f9f9f9;cursor:pointer;';
      btn.innerHTML = '<strong>' + Chronicle.escapeHtml(tmpl.name) + '</strong> [' + tmpl.type + ']' +
        '<br><small style="color:#666">' + Chronicle.escapeHtml(tmpl.description || '') + '</small>';
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
      var lvl = this.creature.level;
      var primaryBonuses = [4, 8, 12, 16, 20].filter(function (l) { return lvl >= l; }).length;
      var secondaryBonuses = [6, 12, 18].filter(function (l) { return lvl >= l; }).length;
      var secondaryStat = this._getSecondaryStat(role);
      var stats = ['might', 'agility', 'reason', 'intuition', 'presence'];
      for (var i = 0; i < stats.length; i++) {
        var s = stats[i];
        var base = role.characteristics[s];
        if (s === role.primary_stat) base += primaryBonuses;
        else if (s === secondaryStat) base += secondaryBonuses;
        this.creature[s] = base;
      }
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

  _getSecondaryStat: function (role) {
    var chars = role.characteristics;
    var primary = role.primary_stat;
    var best = null;
    var bestVal = -Infinity;
    var stats = ['might', 'agility', 'reason', 'intuition', 'presence'];
    for (var i = 0; i < stats.length; i++) {
      if (stats[i] !== primary && chars[stats[i]] > bestVal) {
        bestVal = chars[stats[i]];
        best = stats[i];
      }
    }
    return best;
  },

  _getDamageHints: function () {
    var org = this._getOrgTemplate();
    if (!org || !this.damageBaselines[org.slug]) return '';
    var bl = this.damageBaselines[org.slug];
    var lvl = this.creature.level;
    var t1 = Math.round(bl.tier1 + (bl.per_level * (lvl - 1)));
    var t2 = Math.round(bl.tier2 + (bl.per_level * (lvl - 1)));
    var t3 = Math.round(bl.tier3 + (bl.per_level * (lvl - 1)));
    return 'Damage baseline: T1 ~' + t1 + ' &middot; T2 ~' + t2 + ' &middot; T3 ~' + t3;
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

  // ── Step 5: Free Strike ──────────────────────────────────

  _renderStep5FreeStrike: function () {
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
  },

  // ── Step 6: Villain Actions ─────────────────────────────

  _renderStep6VillainActions: function () {
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
  },

  // ── Step 7: Traits ──────────────────────────────────────

  _renderStep7Traits: function () {
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
  },

  _renderTraitsList: function (container) {
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
  },

  // ── Validation ──────────────────────────────────────────

  _renderValidation: function () {
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

    // Encounter budget calculator
    this._renderEncounterCalc(v);
  },

  _renderEncounterCalc: function (container) {
    var self = this;
    var cr = this.creature;
    if (!cr.ev || cr.ev <= 0) return;

    var calc = document.createElement('div');
    calc.className = 'mb-encounter-calc';
    calc.style.cssText = 'margin-top:12px;padding:12px;border:1px solid #ddd;border-radius:6px;background:#f9fafb;';

    var partySize = 4;
    var partyLevel = cr.level;

    var renderCalcContent = function () {
      var budget = partySize * partyLevel;
      var count = Math.max(1, Math.round(budget / cr.ev));
      var totalEV = count * cr.ev;
      calc.innerHTML =
        '<h4 style="margin:0 0 8px;font-size:0.95em">Encounter Calculator</h4>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
          '<label style="font-size:0.85em">Party size: <input type="number" class="mb-input mb-ec-party" value="' + partySize + '" min="1" max="10" style="width:50px"></label>' +
          '<label style="font-size:0.85em">Party level: <input type="number" class="mb-input mb-ec-level" value="' + partyLevel + '" min="1" max="20" style="width:50px"></label>' +
        '</div>' +
        '<div style="font-size:0.9em">' +
          '<strong>Budget:</strong> ' + budget + ' EV (' + partySize + ' heroes \u00d7 level ' + partyLevel + ')<br>' +
          '<strong>Use ~' + count + '</strong> of this ' + (cr.organization || 'creature') + ' (EV ' + cr.ev + ' each = ' + totalEV + ' total EV)' +
        '</div>';

      calc.querySelector('.mb-ec-party').addEventListener('change', function () {
        partySize = Math.max(1, Math.min(10, parseInt(this.value) || 4));
        renderCalcContent();
      });
      calc.querySelector('.mb-ec-level').addEventListener('change', function () {
        partyLevel = Math.max(1, Math.min(20, parseInt(this.value) || cr.level));
        renderCalcContent();
      });
    };

    renderCalcContent();
    container.appendChild(calc);
  },

  _validate: function () {
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
    var org = this._getOrgTemplate();
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

    if (hasSignature) {
      rules.push({ severity: 'info', message: 'Signature ability present.' });
    }

    return rules;
  },

  // ── Preview ──────────────────────────────────────────────

  _showPreview: function () {
    var self = this;
    var c = this._contentEl;
    c.innerHTML = '';

    // Hide step nav, show preview
    this._navEl.style.display = 'none';

    var previewWrap = document.createElement('div');
    previewWrap.className = 'mb-preview';
    previewWrap.style.cssText = 'border:2px solid #7c3aed;border-radius:8px;padding:20px;background:#faf9ff;';

    previewWrap.innerHTML = this._buildPreviewHtml(this.creature);
    c.appendChild(previewWrap);

    // Action buttons
    var actions = document.createElement('div');
    actions.style.cssText = 'margin-top:12px;display:flex;gap:8px;';

    var backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.textContent = 'Back to Editor';
    backBtn.addEventListener('click', function () {
      self._navEl.style.display = '';
      self._renderCurrentStep();
    });
    actions.appendChild(backBtn);

    var copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.addEventListener('click', function () {
      var text = previewWrap.innerText;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        });
      }
    });
    actions.appendChild(copyBtn);

    c.appendChild(actions);

    // Update buttons to only show back + save
    this._buttonsEl.innerHTML = '';
  },

  _buildPreviewHtml: function (cr) {
    var h = Chronicle.escapeHtml;
    var html = '';

    html += '<div class="sb-header">';
    html += '<h2 class="sb-name">' + h(cr.name || 'Unnamed') + '</h2>';
    html += '<div class="sb-subtitle">Level ' + cr.level + ' ';
    if (cr.size) html += cr.size + ' ';
    if (cr.organization) html += h(cr.organization.charAt(0).toUpperCase() + cr.organization.slice(1)) + ' ';
    if (cr.role) html += h(cr.role.charAt(0).toUpperCase() + cr.role.slice(1));
    html += '</div>';
    if (cr.keywords && cr.keywords.length > 0) {
      html += '<div class="sb-keywords" style="font-style:italic;color:#555">' + cr.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
    }
    if (cr.faction) html += '<div class="sb-faction" style="color:#888">' + h(cr.faction) + '</div>';
    html += '<div class="sb-ev" style="font-weight:bold;margin-top:4px">EV ' + cr.ev + '</div>';
    html += '</div>';

    html += '<hr style="border:none;border-top:2px solid #7c3aed;margin:10px 0">';

    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0">';
    html += '<span><strong>STM</strong> ' + cr.stamina + '</span>';
    html += '<span><strong>Winded</strong> ' + cr.winded + '</span>';
    html += '<span><strong>SPD</strong> ' + cr.speed + '</span>';
    html += '<span><strong>Stability</strong> ' + cr.stability + '</span>';
    html += '</div>';

    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0">';
    var chars = ['might', 'agility', 'reason', 'intuition', 'presence'];
    chars.forEach(function (stat) {
      var val = cr[stat];
      var sign = val >= 0 ? '+' : '';
      html += '<span><strong>' + stat.charAt(0).toUpperCase() + stat.slice(1, 3).toUpperCase() + '</strong> ' + sign + val + '</span>';
    });
    html += '</div>';

    if (cr.immunities && cr.immunities.length > 0) {
      html += '<div style="margin:6px 0"><strong>Immunities:</strong> ' + cr.immunities.map(function (i) { return h(typeof i === 'string' ? i : i.type + ' ' + i.value); }).join(', ') + '</div>';
    }

    html += '<hr style="border:none;border-top:2px solid #7c3aed;margin:10px 0">';

    if (cr.free_strike) {
      html += '<div style="margin:6px 0"><strong>Free Strike:</strong> ' + h(cr.free_strike) + '</div>';
    }

    if (cr.abilities && cr.abilities.length > 0) {
      cr.abilities.forEach(function (ab) {
        var typeLabel = ab.type === 'signature' ? '\u2605 ' : '';
        html += '<div style="margin:8px 0;padding:6px 0;border-bottom:1px solid #e0e0e0">';
        html += '<div style="font-weight:bold">' + typeLabel + h(ab.name || '') + ' <span style="font-weight:normal;color:#888;font-size:0.85em">[' + h(ab.type || '') + ']</span></div>';
        if (ab.keywords && ab.keywords.length > 0) {
          html += '<div style="font-style:italic;color:#666;font-size:0.85em">' + ab.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
        }
        var meta = [];
        if (ab.distance) meta.push(h(ab.distance));
        if (ab.target) meta.push(h(ab.target));
        if (ab.power_roll) meta.push(h(ab.power_roll));
        if (meta.length > 0) html += '<div style="color:#555;font-size:0.85em">' + meta.join(' \u2022 ') + '</div>';
        if (ab.trigger) html += '<div style="font-size:0.9em"><strong>Trigger:</strong> ' + h(ab.trigger) + '</div>';
        if (ab.tier1 || ab.tier2 || ab.tier3) {
          html += '<div style="margin:4px 0 4px 12px;font-size:0.9em">';
          if (ab.tier1) html += '<div><strong>11 or lower:</strong> ' + h(ab.tier1) + '</div>';
          if (ab.tier2) html += '<div><strong>12-16:</strong> ' + h(ab.tier2) + '</div>';
          if (ab.tier3) html += '<div><strong>17+:</strong> ' + h(ab.tier3) + '</div>';
          html += '</div>';
        }
        if (ab.effect) html += '<div style="font-size:0.9em"><strong>Effect:</strong> ' + h(ab.effect) + '</div>';
        if (ab.spend_vp && ab.spend_vp > 0) html += '<div style="font-size:0.9em;color:#7c3aed"><strong>Spend ' + ab.spend_vp + ' VP:</strong> Enhanced effect</div>';
        html += '</div>';
      });
    }

    var va = cr.villain_actions ? cr.villain_actions.filter(function (v) { return v.name && v.name.trim(); }) : [];
    if (va.length > 0) {
      html += '<hr style="border:none;border-top:2px solid #7c3aed;margin:10px 0">';
      html += '<h3 style="font-size:1.05em;margin:0 0 6px">Villain Actions</h3>';
      var orderLabels = { 'opener': 'Opener', 'crowd-control': 'Crowd Control', 'ultimate': 'Ultimate' };
      va.forEach(function (v) {
        html += '<div style="margin:6px 0"><strong>' + h(orderLabels[v.order] || v.order || '') + ':</strong> ' + h(v.name);
        if (v.description) html += ' &mdash; ' + h(v.description);
        html += '</div>';
        if (v.tier1 || v.tier2 || v.tier3) {
          html += '<div style="margin:4px 0 4px 12px;font-size:0.9em">';
          if (v.tier1) html += '<div><strong>11 or lower:</strong> ' + h(v.tier1) + '</div>';
          if (v.tier2) html += '<div><strong>12-16:</strong> ' + h(v.tier2) + '</div>';
          if (v.tier3) html += '<div><strong>17+:</strong> ' + h(v.tier3) + '</div>';
          html += '</div>';
        }
      });
    }

    if (cr.traits && cr.traits.length > 0) {
      html += '<hr style="border:none;border-top:2px solid #7c3aed;margin:10px 0">';
      html += '<h3 style="font-size:1.05em;margin:0 0 6px">Traits</h3>';
      cr.traits.forEach(function (t) {
        html += '<div style="margin:4px 0"><strong>' + h(t.name || '') + '.</strong> ' + h(t.description || '') + '</div>';
      });
    }

    return html;
  },

  // ── Save ────────────────────────────────────────────────

  _save: function () {
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
  }
});
