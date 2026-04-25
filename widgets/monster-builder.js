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
    this.orgTemplates = [
      { slug: 'minion', name: 'Minion', ev_multiplier: 1, stamina_base: 5, stamina_per_level: 2, default_speed: 5, default_stability: 0, villain_action_count: 0 },
      { slug: 'horde', name: 'Horde', ev_multiplier: 2, stamina_base: 8, stamina_per_level: 3, default_speed: 5, default_stability: 0, villain_action_count: 0 },
      { slug: 'platoon', name: 'Platoon', ev_multiplier: 4, stamina_base: 20, stamina_per_level: 6, default_speed: 5, default_stability: 1, villain_action_count: 0 },
      { slug: 'elite', name: 'Elite', ev_multiplier: 8, stamina_base: 40, stamina_per_level: 10, default_speed: 5, default_stability: 2, villain_action_count: 0 },
      { slug: 'leader', name: 'Leader', ev_multiplier: 8, stamina_base: 40, stamina_per_level: 10, default_speed: 5, default_stability: 2, villain_action_count: 3 },
      { slug: 'solo', name: 'Solo', ev_multiplier: 24, stamina_base: 80, stamina_per_level: 20, default_speed: 5, default_stability: 3, villain_action_count: 3 },
      { slug: 'swarm', name: 'Swarm', ev_multiplier: 4, stamina_base: 20, stamina_per_level: 6, default_speed: 5, default_stability: 0, villain_action_count: 0 }
    ];
    this.roleTemplates = [
      { slug: 'ambusher', name: 'Ambusher', primary_stat: 'agility', characteristics: { might: 1, agility: 3, reason: 0, intuition: 1, presence: -2 } },
      { slug: 'artillery', name: 'Artillery', primary_stat: 'reason', characteristics: { might: -2, agility: 1, reason: 3, intuition: 0, presence: 1 } },
      { slug: 'brute', name: 'Brute', primary_stat: 'might', characteristics: { might: 3, agility: 0, reason: -1, intuition: 0, presence: 1 } },
      { slug: 'controller', name: 'Controller', primary_stat: 'reason', characteristics: { might: -1, agility: 0, reason: 3, intuition: 1, presence: 0 } },
      { slug: 'defender', name: 'Defender', primary_stat: 'might', characteristics: { might: 2, agility: -1, reason: 0, intuition: 0, presence: 2 } },
      { slug: 'harrier', name: 'Harrier', primary_stat: 'agility', characteristics: { might: 0, agility: 3, reason: 0, intuition: 1, presence: -1 } },
      { slug: 'hexer', name: 'Hexer', primary_stat: 'reason', characteristics: { might: -1, agility: 0, reason: 2, intuition: 0, presence: 2 } },
      { slug: 'mount', name: 'Mount', primary_stat: 'might', characteristics: { might: 2, agility: 1, reason: -2, intuition: 1, presence: -1 } },
      { slug: 'support', name: 'Support', primary_stat: 'presence', characteristics: { might: -1, agility: 0, reason: 1, intuition: 1, presence: 3 } }
    ];
    this.creatureKeywords = [
      { slug: 'abyssal', name: 'Abyssal', description: 'Connected to abyssal planes or demonic forces.' },
      { slug: 'accursed', name: 'Accursed', description: 'Afflicted by or radiating a supernatural curse.' },
      { slug: 'animal', name: 'Animal', description: 'A natural animal with no supernatural abilities.' },
      { slug: 'beast', name: 'Beast', description: 'A large or monstrous creature with animal-like traits.' },
      { slug: 'construct', name: 'Construct', description: 'An artificial creature animated by magic or technology.' },
      { slug: 'devil', name: 'Devil', description: 'A fiendish creature from infernal planes.' },
      { slug: 'dragon', name: 'Dragon', description: 'A draconic creature, typically with breath weapons and flight.' },
      { slug: 'dwarf', name: 'Dwarf', description: 'Of dwarven ancestry or origin.' },
      { slug: 'elemental', name: 'Elemental', description: 'A creature composed of or powered by elemental forces.' },
      { slug: 'elf', name: 'Elf', description: 'Of elven ancestry or origin.' },
      { slug: 'fey', name: 'Fey', description: 'Connected to the fey realms or faerie courts.' },
      { slug: 'giant', name: 'Giant', description: 'An enormous humanoid creature.' },
      { slug: 'goblin', name: 'Goblin', description: 'A small, cunning creature of goblinoid ancestry.' },
      { slug: 'humanoid', name: 'Humanoid', description: 'A creature of roughly human shape and intelligence.' },
      { slug: 'infernal', name: 'Infernal', description: 'Connected to infernal planes.' },
      { slug: 'insect', name: 'Insect', description: 'A creature with insectoid features.' },
      { slug: 'monstrous', name: 'Monstrous', description: 'A creature that defies natural categorization.' },
      { slug: 'orc', name: 'Orc', description: 'Of orcish ancestry or origin.' },
      { slug: 'plant', name: 'Plant', description: 'A creature with plant-like biology.' },
      { slug: 'planar', name: 'Planar', description: 'Native to or strongly connected to another plane.' },
      { slug: 'revenant', name: 'Revenant', description: 'A creature returned from death with purpose.' },
      { slug: 'shapechanger', name: 'Shapechanger', description: 'A creature that can alter its physical form.' },
      { slug: 'undead', name: 'Undead', description: 'An animated corpse or spirit of a deceased creature.' }
    ];
    this.abilityKeywords = [
      { slug: 'area', name: 'Area', description: 'Affects an area rather than individual targets.' },
      { slug: 'attack', name: 'Attack', description: 'An offensive action that involves a power roll against a target.' },
      { slug: 'charge', name: 'Charge', description: 'The creature moves and attacks in a single action.' },
      { slug: 'magic', name: 'Magic', description: 'The ability is magical in nature.' },
      { slug: 'melee', name: 'Melee', description: 'Requires the creature to be adjacent or within reach.' },
      { slug: 'psionic', name: 'Psionic', description: 'The ability is psionic in nature.' },
      { slug: 'ranged', name: 'Ranged', description: 'Can target creatures at a distance.' },
      { slug: 'resistance', name: 'Resistance', description: 'Provides damage resistance or damage reduction.' },
      { slug: 'weapon', name: 'Weapon', description: 'Uses a physical weapon for the attack.' }
    ];
    this.damageBaselines = {
      minion: { tier1: 2, tier2: 3, tier3: 4, per_level: 1 },
      horde: { tier1: 3, tier2: 5, tier3: 7, per_level: 1.5 },
      platoon: { tier1: 4, tier2: 7, tier3: 10, per_level: 2 },
      elite: { tier1: 6, tier2: 10, tier3: 14, per_level: 3 },
      leader: { tier1: 6, tier2: 10, tier3: 14, per_level: 3 },
      solo: { tier1: 8, tier2: 14, tier3: 20, per_level: 4 },
      swarm: { tier1: 4, tier2: 7, tier3: 10, per_level: 2 }
    };
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

    var base = config.campaignId
      ? '/api/v1/campaigns/' + config.campaignId + '/extensions/drawsteel/assets/'
      : '/extensions/drawsteel/assets/';
    this._ref = new DrawSteelRefRenderer(base, config.campaignId);

    Promise.all([this._loadTemplateAbilities(), this._ref.load()]).then(function () {
      self._ref.injectStyles();
      return self._loadExistingEntity();
    }).then(function () {
      self._render();
    }).catch(function (err) {
      console.error('Monster Builder: init failed', err);
      self._render();
    });
  },

  destroy: function (el) {
    el.innerHTML = '';
  },

  _apiError: function (res, fallback) {
    return res.json().then(
      function (body) { return body && body.message ? body.message : fallback; },
      function () { return fallback; }
    );
  },

  _loadTemplateAbilities: function () {
    var self = this;
    if (!this.config.campaignId) return Promise.resolve();
    var url = '/api/v1/campaigns/' + this.config.campaignId + '/systems/drawsteel/creature-abilities';
    return Chronicle.apiFetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = Array.isArray(data) ? data : (data.results || data.entries || []);
        self.templateAbilities = items;
      })
      .catch(function (err) {
        console.warn('Monster Builder: ability templates unavailable', err);
        self.templateAbilities = [];
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
      .catch(function (err) {
        console.warn('Monster Builder: existing entity load failed; using defaults', err);
      });
  },

  // ── Rendering ──────────────────────────────────────────────

  _injectStyles: function () {
    if (this.el.querySelector('style.mb-styles')) return;
    var style = document.createElement('style');
    style.className = 'mb-styles';
    style.textContent = [
      // ── Root container ──
      '.monster-builder { font-family:Inter,system-ui,-apple-system,sans-serif; font-size:14px; color:var(--color-text-primary,#111827); background:var(--color-card-bg,#fff); border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); border:1px solid var(--color-border,#e5e7eb); padding:20px; }',
      // ── Header ─��
      '.mb-header h2 { font-size:20px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 16px; }',
      '.mb-header h2 i { margin-right:8px; color:var(--color-accent,#6366f1); }',
      // ── Step navigation ──
      '.mb-step-nav { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--color-border,#e5e7eb); }',
      '.mb-step-tab { padding:6px 14px; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; cursor:pointer; font-size:12px; font-weight:500; background:var(--color-card-bg,#fff); color:var(--color-text-body,#374151); transition:all 200ms ease; }',
      '.mb-step-tab.active { background:var(--color-accent,#6366f1); color:#fff; border-color:var(--color-accent,#6366f1); }',
      '.mb-step-tab:hover:not(.active) { background:var(--color-bg-tertiary,#f3f4f6); }',
      '.mb-step-tab:active { transform:scale(0.98); }',
      // ── Step content & sections ──
      '.mb-step-content { min-height:200px; }',
      '.mb-section { background:var(--color-bg-primary,#f9fafb); border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid var(--color-border-light,#f3f4f6); }',
      '.mb-section h3 { font-size:18px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 12px; }',
      // ── Form fields ──
      '.mb-field-row { margin-bottom:12px; }',
      '.mb-field-row label { display:block; font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); margin-bottom:4px; }',
      '.mb-input { width:100%; padding:8px 12px; border-radius:8px; font-size:14px; background:var(--color-input-bg,#fff); border:1px solid var(--color-input-border,#d1d5db); color:var(--color-text-primary,#111827); transition:all 200ms ease; box-sizing:border-box; }',
      '.mb-input:focus { outline:none; box-shadow:0 0 0 2px rgba(99,102,241,0.3); border-color:var(--color-accent,#6366f1); }',
      'select.mb-input option { background:var(--color-card-bg,#fff); color:var(--color-text-primary,#111827); }',
      '.mb-hint { font-size:12px; color:var(--color-text-muted,#9ca3af); margin-top:4px; font-style:italic; }',
      '.mb-suggestion { font-size:12px; color:var(--color-text-secondary,#6b7280); margin-top:2px; }',
      // ── Tags/Keywords ──
      '.mb-keyword-list { display:flex; flex-wrap:wrap; gap:4px; }',
      '.mb-tag { display:inline-block; padding:4px 10px; margin:0; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; cursor:pointer; font-size:12px; font-weight:500; background:var(--color-card-bg,#fff); color:var(--color-text-body,#374151); transition:all 150ms ease; }',
      '.mb-tag:hover { background:var(--color-bg-tertiary,#f3f4f6); }',
      '.mb-tag.selected { background:var(--color-accent,#6366f1); color:#fff; border-color:var(--color-accent,#6366f1); }',
      // ── Radio cards (org/role selection) ──
      '.mb-card-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }',
      '.mb-card-col { display:flex; flex-direction:column; gap:8px; }',
      '.mb-card-col h4 { font-size:14px; font-weight:600; color:var(--color-text-secondary,#6b7280); text-transform:uppercase; letter-spacing:0.05em; margin:0; }',
      '.mb-radio-card { display:block; width:100%; text-align:left; padding:12px; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; cursor:pointer; background:var(--color-card-bg,#fff); transition:all 200ms ease; }',
      '.mb-radio-card:hover { background:var(--color-bg-tertiary,#f3f4f6); }',
      '.mb-radio-card.selected { border:2px solid var(--color-accent,#6366f1); background:rgba(99,102,241,0.05); box-shadow:0 0 0 2px rgba(99,102,241,0.15); }',
      '.mb-radio-card strong { font-size:14px; color:var(--color-text-primary,#111827); }',
      '.mb-radio-card small { font-size:12px; color:var(--color-text-secondary,#6b7280); }',
      '.mb-ev-display { display:inline-flex; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:rgba(99,102,241,0.1); color:var(--color-accent,#6366f1); }',
      // ── Abilities ──
      '.mb-ability-actions { display:flex; gap:8px; margin-bottom:12px; }',
      '.mb-ability-card { background:var(--color-card-bg,#fff); border:1px solid var(--color-border,#e5e7eb); border-radius:8px; padding:12px; margin-bottom:8px; transition:all 200ms ease; }',
      '.mb-ability-header { display:flex; justify-content:space-between; align-items:center; cursor:pointer; }',
      '.mb-ability-type { display:inline-block; padding:1px 8px; border-radius:9999px; font-size:11px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.mb-ability-summary { font-size:12px; color:var(--color-text-secondary,#6b7280); margin-top:4px; }',
      '.mb-ability-detail { overflow:hidden; transition:max-height 300ms ease-out; }',
      '.mb-tiers { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }',
      '.mb-damage-hints { font-size:12px; color:var(--color-text-muted,#9ca3af); font-style:italic; margin:-4px 0 6px; }',
      // ── Template picker ──
      '.mb-template-btn { display:block; width:100%; text-align:left; padding:10px 12px; margin:4px 0; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; background:var(--color-card-bg,#fff); cursor:pointer; transition:all 150ms ease; color:inherit; }',
      '.mb-template-btn:hover { background:var(--color-bg-tertiary,#f3f4f6); }',
      '.mb-template-btn strong { font-size:14px; color:var(--color-text-primary,#111827); }',
      '.mb-template-btn small { font-size:12px; color:var(--color-text-secondary,#6b7280); }',
      // ── Villain actions ──
      '.mb-va-card { background:var(--color-card-bg,#fff); border:1px solid var(--color-border,#e5e7eb); border-left:3px solid var(--color-accent,#6366f1); border-radius:8px; padding:12px; margin-bottom:8px; }',
      '.mb-va-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }',
      '.mb-va-num { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:9999px; background:var(--color-accent,#6366f1); color:#fff; font-size:12px; font-weight:600; }',
      // ── Traits ─��
      '.mb-trait-row { display:flex; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.mb-trait-row:last-child { border-bottom:none; }',
      '.mb-empty { text-align:center; padding:24px; color:var(--color-text-muted,#9ca3af); font-size:14px; }',
      // ── Validation ──
      '.mb-validation-panel { border-radius:8px; border:1px solid var(--color-border,#e5e7eb); overflow:hidden; margin-top:12px; }',
      '.mb-validation-item { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; font-size:12px; }',
      '.mb-v-error { background:rgba(239,68,68,0.05); border-left:3px solid #dc2626; color:#991b1b; }',
      '.mb-v-warning { background:rgba(245,158,11,0.05); border-left:3px solid #d97706; color:#92400e; }',
      '.mb-v-info { background:rgba(59,130,246,0.05); border-left:3px solid #2563eb; color:#1e40af; }',
      '.mb-v-icon { flex-shrink:0; }',
      '.mb-inline-warn { display:flex; align-items:center; gap:8px; padding:8px 12px; margin:0 0 12px; border-radius:6px; font-size:13px; background:rgba(239,68,68,0.05); border-left:3px solid #dc2626; color:#991b1b; }',
      // ── Encounter calculator ──
      '.mb-encounter-calc { margin-top:12px; padding:12px; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; background:var(--color-bg-primary,#f9fafb); }',
      // ── Preview ──
      '.mb-preview { border:2px solid var(--color-accent,#6366f1); border-radius:12px; overflow:hidden; background:var(--color-card-bg,#fff); }',
      // ── Buttons ──
      '.mb-buttons { display:flex; gap:8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--color-border,#e5e7eb); }',
      // ── Statblock styles (for preview) ──
      '.mb-preview .sb-header { background:var(--color-accent,#6366f1); padding:16px 20px; }',
      '.mb-preview .sb-name { margin:0 0 4px; font-size:20px; font-weight:700; color:#fff; }',
      '.mb-preview .sb-subtitle { color:rgba(255,255,255,0.85); font-size:14px; }',
      '.mb-preview .sb-keywords { font-style:italic; color:rgba(255,255,255,0.7); font-size:12px; margin-top:4px; }',
      '.mb-preview .sb-faction { color:rgba(255,255,255,0.7); font-size:12px; }',
      '.mb-preview .sb-ev { display:inline-block; margin-top:6px; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:600; background:rgba(255,255,255,0.2); color:#fff; }',
      '.mb-preview .sb-content { padding:16px 20px; }',
      '.mb-preview .sb-divider { border:none; border-top:2px solid var(--color-accent,#6366f1); margin:12px 0; opacity:0.3; }',
      '.mb-preview .sb-stat { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); }',
      '.mb-preview .sb-stat strong { font-weight:600; color:var(--color-text-secondary,#6b7280); }',
      '.mb-preview .sb-char { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:500; }',
      '.mb-preview .sb-char strong { font-weight:600; color:var(--color-text-secondary,#6b7280); }',
      '.mb-preview .sb-char.positive { background:rgba(16,185,129,0.1); color:#047857; }',
      '.mb-preview .sb-char.negative { background:rgba(239,68,68,0.1); color:#b91c1c; }',
      '.mb-preview .sb-char.zero { background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.mb-preview .sb-ability { padding:10px 0; border-bottom:1px solid var(--color-border-light,#f3f4f6); }',
      '.mb-preview .sb-ability-name { font-weight:600; font-size:14px; }',
      '.mb-preview .sb-ability-type { display:inline-block; margin-left:6px; padding:1px 8px; border-radius:9999px; font-size:11px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.mb-preview .sb-ability-tiers { border-left:2px solid var(--color-border,#e5e7eb); padding-left:12px; margin:6px 0; font-size:14px; }',
      '.mb-preview .sb-ability-vp { color:var(--color-accent,#6366f1); font-weight:600; }',
      '.mb-preview .sb-section-title { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-secondary,#6b7280); margin:0 0 8px; }',
      '.mb-preview .sb-va { margin:8px 0; }',
      '.mb-preview .sb-va-tiers { border-left:2px solid var(--color-border,#e5e7eb); padding-left:12px; margin:6px 0; font-size:14px; }',
      '.mb-preview .sb-trait { margin:6px 0; font-size:14px; color:var(--color-text-body,#374151); }'
    ].join('\n');
    this.el.insertBefore(style, this.el.firstChild);
  },

  _render: function () {
    var el = this.el;
    el.innerHTML = '';
    el.className = 'monster-builder';
    this._injectStyles();

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
      '<div id="mb-signature-warn" class="mb-inline-warn" style="display:none"></div>' +
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

  _refreshAbilityValidation: function () {
    if (!this._contentEl) return;
    var warn = this._contentEl.querySelector('#mb-signature-warn');
    if (warn) {
      var hasSignature = this.creature.abilities.some(function (a) { return a.type === 'signature'; });
      if (hasSignature) {
        warn.style.display = 'none';
        warn.innerHTML = '';
      } else {
        warn.style.display = 'flex';
        warn.innerHTML = '<span>&#9888;</span><span>Every creature must have at least 1 <strong>signature</strong> ability. Add one, or change an existing ability\'s type to <em>signature</em>.</span>';
      }
    }
    this._renderValidation();
  },

  _renderAbilitiesList: function (container) {
    var self = this;
    container.innerHTML = '';

    if (this.creature.abilities.length === 0) {
      container.innerHTML = '<p class="mb-empty">No abilities yet. Add one or use a template.</p>';
      self._refreshAbilityValidation();
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
          '<div class="mb-damage-hints">' + self._getDamageHints() + '</div>' +
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
        self._refreshAbilityValidation();
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

    self._refreshAbilityValidation();
  },

  _renderTemplatePicker: function (container) {
    var self = this;
    container.innerHTML = '<h4>Ability Templates</h4>';
    this.templateAbilities.forEach(function (tmpl) {
      var p = tmpl.properties || {};
      var btn = document.createElement('button');
      btn.className = 'mb-template-btn';
      btn.innerHTML = '<strong>' + Chronicle.escapeHtml(tmpl.name) + '</strong> [' + (p.type || '') + ']' +
        '<br><small>' + Chronicle.escapeHtml(tmpl.description || '') + '</small>';
      btn.addEventListener('click', function () {
        var ability = JSON.parse(JSON.stringify(p));
        ability.name = tmpl.name;
        self.creature.abilities.push(ability);
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
    // Styled via .mb-encounter-calc class

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
    // Styled via .mb-preview class

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
    var ref = this._ref;
    var html = '';

    html += '<div class="sb-header">';
    html += '<h2 class="sb-name">' + h(cr.name || 'Unnamed') + '</h2>';
    html += '<div class="sb-subtitle">Level ' + cr.level + ' ';
    if (cr.size) html += cr.size + ' ';
    if (cr.organization) html += h(cr.organization.charAt(0).toUpperCase() + cr.organization.slice(1)) + ' ';
    if (cr.role) html += h(cr.role.charAt(0).toUpperCase() + cr.role.slice(1));
    html += '</div>';
    if (cr.keywords && cr.keywords.length > 0) {
      html += '<div class="sb-keywords">' + cr.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
    }
    if (cr.faction) html += '<div class="sb-faction">' + h(cr.faction) + '</div>';
    html += '<span class="sb-ev">EV ' + cr.ev + '</span>';
    html += '</div>';

    html += '<div class="sb-content">';

    html += '<div class="sb-stats"><div class="sb-stat-row">';
    html += '<span class="sb-stat"><strong>STM</strong> ' + cr.stamina + '</span>';
    html += '<span class="sb-stat"><strong>Winded</strong> ' + cr.winded + '</span>';
    html += '<span class="sb-stat"><strong>SPD</strong> ' + cr.speed + '</span>';
    html += '<span class="sb-stat"><strong>Stability</strong> ' + cr.stability + '</span>';
    html += '</div></div>';

    html += '<div class="sb-characteristics">';
    var chars = ['might', 'agility', 'reason', 'intuition', 'presence'];
    chars.forEach(function (stat) {
      var val = cr[stat];
      var sign = val >= 0 ? '+' : '';
      var cls = val > 0 ? 'positive' : (val < 0 ? 'negative' : 'zero');
      html += '<span class="sb-char ' + cls + '"><strong>' + stat.charAt(0).toUpperCase() + stat.slice(1, 3).toUpperCase() + '</strong> ' + sign + val + '</span>';
    });
    html += '</div>';

    if (cr.immunities && cr.immunities.length > 0) {
      html += '<div class="sb-immunities"><strong>Immunities:</strong> ' + cr.immunities.map(function (i) { return h(typeof i === 'string' ? i : i.type + ' ' + i.value); }).join(', ') + '</div>';
    }

    html += '<div class="sb-divider"></div>';

    if (cr.free_strike) {
      html += '<div class="sb-free-strike"><strong>Free Strike:</strong> ' + h(cr.free_strike) + '</div>';
    }

    if (cr.abilities && cr.abilities.length > 0) {
      cr.abilities.forEach(function (ab) {
        var typeLabel = ab.type === 'signature' ? '\u2605 ' : '';
        html += '<div class="sb-ability">';
        html += '<div class="sb-ability-name">' + typeLabel + h(ab.name || '') + ' <span class="sb-ability-type">' + h(ab.type || '') + '</span></div>';
        if (ab.keywords && ab.keywords.length > 0) {
          html += '<div class="sb-ability-kw">' + ab.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
        }
        var meta = [];
        if (ab.distance) meta.push(h(ab.distance));
        if (ab.target) meta.push(h(ab.target));
        if (ab.power_roll) meta.push(h(ab.power_roll));
        if (meta.length > 0) html += '<div class="sb-ability-meta">' + meta.join(' \u2022 ') + '</div>';
        if (ab.trigger) html += '<div class="sb-ability-trigger"><strong>Trigger:</strong> ' + ref.renderText(h(ab.trigger)) + '</div>';
        if (ab.tier1 || ab.tier2 || ab.tier3) {
          html += '<div class="sb-ability-tiers">';
          if (ab.tier1) html += '<div><strong>11 or lower:</strong> ' + ref.renderText(h(ab.tier1)) + '</div>';
          if (ab.tier2) html += '<div><strong>12-16:</strong> ' + ref.renderText(h(ab.tier2)) + '</div>';
          if (ab.tier3) html += '<div><strong>17+:</strong> ' + ref.renderText(h(ab.tier3)) + '</div>';
          html += '</div>';
        }
        if (ab.effect) html += '<div class="sb-ability-effect"><strong>Effect:</strong> ' + ref.renderText(h(ab.effect)) + '</div>';
        if (ab.spend_vp && ab.spend_vp > 0) html += '<div class="sb-ability-vp"><strong>Spend ' + ab.spend_vp + ' VP:</strong> Enhanced effect</div>';
        html += '</div>';
      });
    }

    var va = cr.villain_actions ? cr.villain_actions.filter(function (v) { return v.name && v.name.trim(); }) : [];
    if (va.length > 0) {
      html += '<div class="sb-divider"></div>';
      html += '<h3 class="sb-section-title">Villain Actions</h3>';
      var orderLabels = { 'opener': 'Opener', 'crowd-control': 'Crowd Control', 'ultimate': 'Ultimate' };
      va.forEach(function (v) {
        html += '<div class="sb-va">';
        html += '<div class="sb-va-name"><strong>' + h(orderLabels[v.order] || v.order || '') + ':</strong> ' + h(v.name) + '</div>';
        if (v.description) html += '<div class="sb-va-desc">' + ref.renderText(h(v.description)) + '</div>';
        if (v.tier1 || v.tier2 || v.tier3) {
          html += '<div class="sb-va-tiers">';
          if (v.tier1) html += '<div><strong>11 or lower:</strong> ' + ref.renderText(h(v.tier1)) + '</div>';
          if (v.tier2) html += '<div><strong>12-16:</strong> ' + ref.renderText(h(v.tier2)) + '</div>';
          if (v.tier3) html += '<div><strong>17+:</strong> ' + ref.renderText(h(v.tier3)) + '</div>';
          html += '</div>';
        }
        html += '</div>';
      });
    }

    if (cr.traits && cr.traits.length > 0) {
      html += '<div class="sb-divider"></div>';
      html += '<h3 class="sb-section-title">Traits</h3>';
      cr.traits.forEach(function (t) {
        html += '<div class="sb-trait"><strong>' + h(t.name || '') + '.</strong> ' + ref.renderText(h(t.description || '')) + '</div>';
      });
    }

    html += '</div>'; // close sb-content

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
      if (!res.ok) {
        return self._apiError(res, 'Could not save creature. Please try again.').then(function (msg) {
          throw new Error(msg);
        });
      }
      Chronicle.markClean('monster-builder');
      var btn = self._buttonsEl.querySelector('.btn-success');
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = 'Saved!';
        btn.disabled = true;
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2000);
      }
    }).catch(function (err) {
      alert(err && err.message ? err.message : 'Could not save creature. Please try again.');
    });
  }
});
