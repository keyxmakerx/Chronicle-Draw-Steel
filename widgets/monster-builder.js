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
    // Reference data is loaded from data/*.json at init (see _loadReferenceData),
    // never hard-coded inline. The data files are the single source of truth, so
    // updating a file is enough — there is no second copy to keep in sync (B-8).
    // These start empty and are populated before the first render.
    this.orgTemplates = [];
    this.roleTemplates = [];
    this.creatureKeywords = [];
    this.abilityKeywords = [];
    this.damageBaselines = {};
    this.templateAbilities = [];
    this._dataError = false;

    // Creature state
    this.creature = {
      name: '',
      level: 1,
      size: '1M',
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
    this._assetBase = base;
    this._ref = new DrawSteelRefRenderer(base, config.campaignId);
    this._saveStatus = 'clean';

    // Encounter-calculator state lives on the instance so it survives step
    // navigation instead of resetting every time Step 3 re-renders (B-7).
    this._encounterState = { partySize: 4, partyLevel: this.creature.level };

    // Bestiary publish state: the "Publish to Bestiary" button is enabled only
    // after a successful entity save, and defaults to a private (draft) listing.
    this._entityIsPrivate = false;
    this._canPublish = false;
    this._publishVisibility = 'draft';

    Promise.all([this._loadReferenceData(), this._ref.load()]).then(function () {
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

  // _fetchData loads a single reference JSON file from the extension's asset
  // path. Draw Steel ships its reference data as data/*.json (CLAUDE.md
  // "Widget Patterns"); these are static package assets, not campaign data, so
  // they are fetched directly rather than through the entity API. We try the
  // configured asset base first, then fall back to the instance-global
  // /extensions/drawsteel/assets/ path so the data resolves whether or not the
  // current context exposes a campaign-scoped asset route.
  _fetchData: function (file) {
    var candidates = [];
    if (this._assetBase) candidates.push(this._assetBase + 'data/' + file);
    var globalPath = '/extensions/drawsteel/assets/data/' + file;
    if (candidates.indexOf(globalPath) === -1) candidates.push(globalPath);

    var tryNext = function (i) {
      if (i >= candidates.length) {
        return Promise.reject(new Error('could not load data/' + file));
      }
      return fetch(candidates[i], { credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error(candidates[i] + ' -> ' + r.status);
          return r.json();
        })
        .catch(function () { return tryNext(i + 1); });
    };
    return tryNext(0);
  },

  // _loadReferenceData populates every reference collection from data/*.json.
  // Organization and role templates are required for the builder to function
  // (without them there is nothing to pick and no stats to derive), so failing
  // to load them flips this._dataError and the UI shows a clear diagnostic
  // instead of silently rendering empty pickers.
  _loadReferenceData: function () {
    var self = this;
    var load = function (file, assign) {
      return self._fetchData(file)
        .then(function (data) { assign(data); })
        .catch(function (err) { console.warn('Monster Builder: failed to load ' + file, err); });
    };
    return Promise.all([
      load('organization-templates.json', function (d) { self.orgTemplates = Array.isArray(d) ? d : []; }),
      load('role-templates.json', function (d) { self.roleTemplates = Array.isArray(d) ? d : []; }),
      load('creature-keywords.json', function (d) { self.creatureKeywords = Array.isArray(d) ? d : []; }),
      load('ability-keywords.json', function (d) { self.abilityKeywords = Array.isArray(d) ? d : []; }),
      load('damage-baselines.json', function (d) { self.damageBaselines = self._extractBaselines(d); }),
      load('creature-abilities.json', function (d) { self.templateAbilities = Array.isArray(d) ? d : []; })
    ]).then(function () {
      self._dataError = (self.orgTemplates.length === 0 || self.roleTemplates.length === 0);
    });
  },

  // _extractBaselines normalizes damage-baselines.json (a single ReferenceItem
  // whose properties.baselines holds the per-organization damage table) into a
  // slug -> { tier1, tier2, tier3, per_level } map. See docs/DATA-SCHEMA.md.
  _extractBaselines: function (data) {
    if (Array.isArray(data) && data[0] && data[0].properties && data[0].properties.baselines) {
      return data[0].properties.baselines;
    }
    return {};
  },

  _loadExistingEntity: function () {
    var self = this;
    if (!this.config.entityId || !this.config.campaignId) return Promise.resolve();

    var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities/' + this.config.entityId;
    return Chronicle.apiFetch(url)
      .then(function (r) { return r.json(); })
      .then(function (entity) {
        if (!entity) return;
        // An existing entity is already persisted, so publishing is allowed.
        // Preserve its privacy flag so a later save (PUT) doesn't flip it.
        self._entityIsPrivate = !!entity.is_private;
        self._canPublish = true;
        self.creature.name = entity.name || '';
        // Chronicle returns custom fields under the `fields_data` key; earlier
        // code read the wrong key (B-2), so every saved creature loaded blank.
        var f = entity.fields_data;
        if (!f) return;
        var numFields = ['level', 'ev', 'stamina', 'winded', 'speed', 'stability',
          'might', 'agility', 'reason', 'intuition', 'presence', 'free_strike_damage'];
        numFields.forEach(function (k) {
          if (f[k] !== undefined) self.creature[k] = Number(f[k]) || 0;
        });
        var strFields = ['organization', 'role', 'size', 'faction', 'free_strike', 'immunities', 'keywords'];
        strFields.forEach(function (k) {
          if (f[k] !== undefined) self.creature[k] = f[k];
        });
        // Normalize legacy single-letter sizes (T/S/M/L/H/G) saved by earlier
        // builds to the DATA-SCHEMA multi-hex notation (1T/1S/1M/1L/2/3) (B-6).
        self.creature.size = self._normalizeSize(self.creature.size);
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

  // Canonical Draw Steel size notation (docs/DATA-SCHEMA.md) paired with
  // friendly display labels. The notation string is what gets stored on the
  // entity; the label is only for the dropdown (B-6).
  _sizeOptions: [
    { value: '1T', label: '1T — Tiny' },
    { value: '1S', label: '1S — Small' },
    { value: '1M', label: '1M — Medium' },
    { value: '1L', label: '1L — Large' },
    { value: '2', label: '2 — Huge' },
    { value: '3', label: '3 — Gargantuan' }
  ],

  // _normalizeSize maps legacy single-letter sizes (T/S/M/L/H/G) to the
  // DATA-SCHEMA notation and leaves already-canonical values untouched.
  _normalizeSize: function (size) {
    var legacy = { T: '1T', S: '1S', M: '1M', L: '1L', H: '2', G: '3' };
    if (legacy[size]) return legacy[size];
    return size || '1M';
  },

  // _dataErrorBanner renders a visible diagnostic when the reference data files
  // failed to load, so an empty org/role picker is never a silent mystery.
  _dataErrorBanner: function () {
    if (!this._dataError) return '';
    return '<div class="mb-inline-warn" style="display:flex">' +
      '<span>&#9888;</span><span>Reference data could not be loaded from the Draw Steel ' +
      'package (<code>data/*.json</code>). Organization and role options are unavailable — ' +
      'check that the package assets are being served.</span></div>';
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
      '.mb-header h2 { font-size:20px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 16px; font-family:var(--font-campaign,Inter,system-ui,-apple-system,sans-serif); }',
      '.mb-header h2 i { margin-right:8px; color:var(--color-accent,#6366f1); }',
      // ── Step navigation ──
      '.mb-step-nav { display:flex; flex-wrap:wrap; gap:0; margin-bottom:16px; border-bottom:1px solid var(--color-border,#e5e7eb); }',
      '.mb-step-tab { padding:8px 14px; border:none; border-bottom:2px solid transparent; cursor:pointer; font-size:13px; font-weight:500; background:transparent; color:var(--color-text-body,#374151); transition:all 150ms ease; margin-bottom:-1px; }',
      '.mb-step-tab.active { color:var(--color-accent,#6366f1); border-bottom-color:var(--color-accent,#6366f1); }',
      '.mb-step-tab:hover:not(.active) { background:rgba(var(--color-accent-rgb,99,102,241),0.05); color:var(--color-accent,#6366f1); }',
      '.mb-step-tab:active { transform:scale(0.98); }',
      // ── Step content & sections ──
      '.mb-step-content { min-height:200px; }',
      '.mb-section { background:var(--color-bg-primary,#f9fafb); border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid var(--color-border-light,#f3f4f6); }',
      '.mb-card { background:var(--color-card-bg,#fff); border:1px solid var(--color-border-light,#f3f4f6); border-radius:6px; padding:12px 14px; margin:8px 0; }',
      '.mb-card h4 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-secondary,#6b7280); margin:0 0 10px; }',
      '.mb-section h3 { font-size:18px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 12px; font-family:var(--font-campaign,Inter,system-ui,-apple-system,sans-serif); }',
      // ── Form fields ──
      '.mb-field-row { margin-bottom:12px; }',
      '.mb-field-row label { display:block; font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); margin-bottom:4px; }',
      '.mb-input { width:100%; padding:8px 12px; border-radius:8px; font-size:14px; background:var(--color-input-bg,#fff); border:1px solid var(--color-input-border,#d1d5db); color:var(--color-text-primary,#111827); transition:all 200ms ease; box-sizing:border-box; }',
      '.mb-input:focus { outline:none; box-shadow:0 0 0 2px rgba(var(--color-accent-rgb,99,102,241),0.3); border-color:var(--color-accent,#6366f1); }',
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
      '.mb-radio-card.selected { border:2px solid var(--color-accent,#6366f1); background:rgba(var(--color-accent-rgb,99,102,241),0.05); box-shadow:0 0 0 2px rgba(var(--color-accent-rgb,99,102,241),0.15); }',
      '.mb-radio-card strong { font-size:14px; color:var(--color-text-primary,#111827); }',
      '.mb-radio-card small { font-size:12px; color:var(--color-text-secondary,#6b7280); }',
      '.mb-ev-display { display:inline-flex; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:rgba(var(--color-accent-rgb,99,102,241),0.1); color:var(--color-accent,#6366f1); }',
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
      '.mb-preview .sb-trait { margin:6px 0; font-size:14px; color:var(--color-text-body,#374151); }',
      // ── Sticky save bar ──
      '.mb-save-bar { position:sticky; bottom:0; display:flex; align-items:center; gap:12px; padding:12px 16px; margin:16px -20px -20px; background:var(--color-card-bg,#fff); border-top:1px solid var(--color-border,#e5e7eb); z-index:10; }',
      '.mb-save-status { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--color-text-secondary,#6b7280); }',
      '.mb-save-status::before { content:""; display:inline-block; width:8px; height:8px; border-radius:9999px; background:var(--color-text-muted,#9ca3af); }',
      '.mb-save-status.clean::before { background:var(--color-text-muted,#9ca3af); }',
      '.mb-save-status.unsaved::before { background:#d97706; }',
      '.mb-save-status.saving::before { background:var(--color-accent,#6366f1); animation:mb-pulse 1s ease-in-out infinite; }',
      '.mb-save-status.saved::before { background:#10b981; }',
      '.mb-save-status.error::before { background:#dc2626; }',
      '@keyframes mb-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }',
      '.mb-save-bar-actions { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }',
      '.mb-save-bar-actions .mb-publish-vis { width:auto; padding:6px 8px; font-size:12px; }',
      '.mb-publish-msg { padding:8px 12px; margin:8px 0 0; border-radius:6px; font-size:13px; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-body,#374151); }',
      '.mb-publish-msg.mb-publish-ok { background:rgba(16,185,129,0.1); color:#047857; }',
      '.mb-publish-msg.mb-publish-error { background:rgba(239,68,68,0.08); color:#991b1b; }'
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

    // Validation panel
    var validation = document.createElement('div');
    validation.className = 'mb-validation';
    el.appendChild(validation);
    this._validationEl = validation;

    // Sticky save bar (status + nav buttons)
    var saveBar = document.createElement('div');
    saveBar.className = 'mb-save-bar';
    el.appendChild(saveBar);
    this._saveBarEl = saveBar;
    this._buttonsEl = saveBar; // back-compat: existing _renderButtons writes here

    // Mark step content as the unsaved-detection scope
    var self = this;
    content.addEventListener('input', function () {
      if (self._saveStatus === 'clean' || self._saveStatus === 'saved') {
        self._setSaveStatus('unsaved');
      }
    });
    content.addEventListener('change', function () {
      self._refreshInlineValidation();
    });

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
    this._refreshInlineValidation();
  },

  _saveStatusLabels: {
    clean: 'No unsaved changes',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed'
  },

  _setSaveStatus: function (status) {
    this._saveStatus = status;
    if (this._saveBarEl) this._renderButtons();
  },

  _renderButtons: function () {
    var self = this;
    var b = this._saveBarEl || this._buttonsEl;
    if (!b) return;
    b.innerHTML = '';

    var status = this._saveStatus || 'clean';
    var statusEl = document.createElement('span');
    statusEl.className = 'mb-save-status ' + status;
    statusEl.textContent = this._saveStatusLabels[status] || '';
    b.appendChild(statusEl);

    var actions = document.createElement('div');
    actions.className = 'mb-save-bar-actions';
    b.appendChild(actions);

    if (this.currentStep > 0) {
      var prev = document.createElement('button');
      prev.className = 'btn btn-secondary';
      prev.textContent = 'Previous';
      prev.addEventListener('click', function () {
        self.currentStep--;
        if (self.currentStep === 5 && self.creature.organization !== 'leader' && self.creature.organization !== 'solo') {
          self.currentStep--;
        }
        self._renderCurrentStep();
      });
      actions.appendChild(prev);
    }

    if (this.currentStep < this.steps.length - 1) {
      var next = document.createElement('button');
      next.className = 'btn btn-primary';
      next.textContent = 'Next';
      next.addEventListener('click', function () {
        self.currentStep++;
        if (self.currentStep === 5 && self.creature.organization !== 'leader' && self.creature.organization !== 'solo') {
          self.currentStep++;
        }
        self._renderCurrentStep();
      });
      actions.appendChild(next);
    }

    var preview = document.createElement('button');
    preview.className = 'btn btn-secondary';
    preview.textContent = 'Preview Statblock';
    preview.addEventListener('click', function () { self._showPreview(); });
    actions.appendChild(preview);

    var save = document.createElement('button');
    save.className = 'btn btn-success';
    save.textContent = 'Save Creature';
    save.disabled = (status === 'saving');
    save.addEventListener('click', function () { self._save(); });
    actions.appendChild(save);

    // Bestiary publish controls — visibility toggle + publish button. Both are
    // disabled until a successful save exists, since publishing references the
    // saved entity (B-9). Default visibility is private (draft).
    var vis = document.createElement('select');
    vis.className = 'mb-input mb-publish-vis';
    vis.title = 'Bestiary visibility';
    vis.innerHTML =
      '<option value="draft">Private (only me)</option>' +
      '<option value="published">Public (shared)</option>';
    vis.value = this._publishVisibility || 'draft';
    vis.disabled = !this._canPublish;
    vis.addEventListener('change', function () { self._publishVisibility = this.value; });
    actions.appendChild(vis);

    var publish = document.createElement('button');
    publish.className = 'btn btn-secondary';
    publish.textContent = 'Publish to Bestiary';
    publish.disabled = !this._canPublish || status === 'saving';
    publish.title = this._canPublish ? 'Publish this creature to the community bestiary' : 'Save the creature first';
    publish.addEventListener('click', function () { self._publishToBestiary(); });
    actions.appendChild(publish);
  },

  // ── Step 1: Identity ──────────────────────────────────────

  _renderStep1Identity: function () {
    var self = this;
    var c = this._contentEl;
    var h = Chronicle.escapeHtml;
    var ha = Chronicle.escapeAttr;   // H-5: attribute-context escaping (escapes quotes)

    c.innerHTML =
      '<div class="mb-section">' +
      '<h3>Step 1: Identity</h3>' +
      '<div id="mb-step1-warn" class="mb-inline-warn" style="display:none"></div>' +
      '<div class="mb-field-row">' +
        '<label>Name<input type="text" class="mb-input" id="mb-name" value="' + ha(this.creature.name) + '" placeholder="Creature name"></label>' +
        '<label>Level (1-20)<input type="number" class="mb-input" id="mb-level" min="1" max="20" value="' + (Number(this.creature.level) || 1) + '"></label>' +
        '<label>Size<select class="mb-input" id="mb-size">' +
          this._sizeOptions.map(function (s) {
            return '<option value="' + s.value + '"' + (self.creature.size === s.value ? ' selected' : '') + '>' + Chronicle.escapeHtml(s.label) + '</option>';
          }).join('') +
        '</select></label>' +
        '<label>Faction<input type="text" class="mb-input" id="mb-faction" value="' + ha(this.creature.faction) + '" placeholder="e.g. Goblin, Dragon"></label>' +
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
      '<div id="mb-step2-warn" class="mb-inline-warn" style="display:none"></div>' +
      this._dataErrorBanner() +
      '<div class="mb-card-grid"><div class="mb-card-col"><h4>Organization</h4>';
    this.orgTemplates.forEach(function (o) {
      var sel = self.creature.organization === o.slug ? ' selected' : '';
      orgHtml += '<button class="mb-radio-card' + sel + '" data-org="' + Chronicle.escapeAttr(o.slug) + '">' +   // M-2
        '<strong>' + Chronicle.escapeHtml(o.name) + '</strong> (' + Chronicle.escapeHtml(String(o.ev_multiplier)) + ' EV/level)' +
        '<br><small>' + Chronicle.escapeHtml(o.description || '') + '</small></button>';
    });
    orgHtml += '</div><div class="mb-card-col"><h4>Role</h4>';
    this.roleTemplates.forEach(function (r) {
      var sel = self.creature.role === r.slug ? ' selected' : '';
      orgHtml += '<button class="mb-radio-card' + sel + '" data-role="' + Chronicle.escapeAttr(r.slug) + '">' +   // M-2
        '<strong>' + Chronicle.escapeHtml(r.name) + '</strong>' +
        '<br><small>' + Chronicle.escapeHtml(r.description || '') + '</small></button>';
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
      '<div class="mb-card"><h4>Vitals</h4>' +
      '<div class="mb-field-row">' +
        '<label>Stamina<input type="number" class="mb-input" id="mb-stamina" value="' + cr.stamina + '">' +
        '<small class="mb-suggestion">suggested: ' + suggested.stamina + '</small></label>' +
        '<label>Winded<input type="number" class="mb-input" id="mb-winded" value="' + cr.winded + '" readonly>' +
        '<small class="mb-suggestion">auto: floor(stamina/2)</small></label>' +
        '<label>Speed<input type="number" class="mb-input" id="mb-speed" value="' + cr.speed + '">' +
        '<small class="mb-suggestion">suggested: ' + suggested.speed + '</small></label>' +
        '<label>Stability<input type="number" class="mb-input" id="mb-stability" value="' + cr.stability + '">' +
        '<small class="mb-suggestion">suggested: ' + suggested.stability + '</small></label>' +
      '</div></div>' +
      '<div class="mb-card"><h4>Characteristics</h4>' +
      '<div class="mb-field-row">' +
        '<label>Might<input type="number" class="mb-input" id="mb-might" value="' + cr.might + '"></label>' +
        '<label>Agility<input type="number" class="mb-input" id="mb-agility" value="' + cr.agility + '"></label>' +
        '<label>Reason<input type="number" class="mb-input" id="mb-reason" value="' + cr.reason + '"></label>' +
        '<label>Intuition<input type="number" class="mb-input" id="mb-intuition" value="' + cr.intuition + '"></label>' +
        '<label>Presence<input type="number" class="mb-input" id="mb-presence" value="' + cr.presence + '"></label>' +
      '</div></div>' +
      '<div class="mb-card"><h4>Immunities</h4>' +
      '<div id="mb-immunities-list" class="mb-list-editor"></div>' +
      '<button class="btn btn-sm btn-secondary" id="mb-add-immunity">+ Add Immunity</button>' +
      '</div>' +
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
      row.innerHTML = '<input type="text" class="mb-input" value="' + Chronicle.escapeAttr(imm) + '" placeholder="e.g. Magic 2">' +
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

  _setInlineWarn: function (id, message) {
    if (!this._contentEl) return;
    var el = this._contentEl.querySelector('#' + id);
    if (!el) return;
    if (message) {
      el.style.display = 'flex';
      el.innerHTML = '<span>&#9888;</span><span>' + message + '</span>';
    } else {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  },

  _refreshInlineValidation: function () {
    if (!this._contentEl) return;
    var rules = this._validate();
    var pickError = function (substring) {
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].severity === 'error' && rules[i].message.indexOf(substring) !== -1) {
          return Chronicle.escapeHtml(rules[i].message);
        }
      }
      return '';
    };

    this._setInlineWarn('mb-step1-warn', pickError('name'));

    var orgErr = pickError('Organization is required');
    var roleErr = pickError('Role is required');
    var step2Msg = '';
    if (orgErr && roleErr) step2Msg = 'Both organization and role are required.';
    else if (orgErr) step2Msg = orgErr;
    else if (roleErr) step2Msg = roleErr;
    this._setInlineWarn('mb-step2-warn', step2Msg);

    var hasSignature = this.creature.abilities.some(function (a) { return a.type === 'signature'; });
    var sigWarn = this._contentEl.querySelector('#mb-signature-warn');
    if (sigWarn) {
      if (hasSignature) {
        sigWarn.style.display = 'none';
        sigWarn.innerHTML = '';
      } else {
        sigWarn.style.display = 'flex';
        sigWarn.innerHTML = '<span>&#9888;</span><span>Every creature must have at least 1 <strong>signature</strong> ability. Add one, or change an existing ability\'s type to <em>signature</em>.</span>';
      }
    }

    this._setInlineWarn('mb-step6-warn', pickError('villain actions'));

    this._renderValidation();
  },

  _refreshAbilityValidation: function () {
    this._refreshInlineValidation();
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
          '<input type="text" class="mb-input mb-ability-name" value="' + Chronicle.escapeAttr(ability.name) + '">' +
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
            '<label>Distance<input type="text" class="mb-input mb-ab-distance" value="' + Chronicle.escapeAttr(ability.distance) + '"></label>' +
            '<label>Target<input type="text" class="mb-input mb-ab-target" value="' + Chronicle.escapeAttr(ability.target) + '"></label>' +
          '</div>' +
          '<div class="mb-field-row">' +
            '<label>Power Roll<input type="text" class="mb-input mb-ab-roll" value="' + Chronicle.escapeAttr(ability.power_roll || '') + '" placeholder="e.g. Might vs. Agility"></label>' +
          '</div>' +
          '<div class="mb-field-row mb-tiers">' +
            '<label>T1 (11-)<input type="text" class="mb-input mb-ab-t1" value="' + Chronicle.escapeAttr(ability.tier1 || '') + '"></label>' +
            '<label>T2 (12-16)<input type="text" class="mb-input mb-ab-t2" value="' + Chronicle.escapeAttr(ability.tier2 || '') + '"></label>' +
            '<label>T3 (17+)<input type="text" class="mb-input mb-ab-t3" value="' + Chronicle.escapeAttr(ability.tier3 || '') + '"></label>' +
          '</div>' +
          '<div class="mb-damage-hints">' + self._getDamageHints() + '</div>' +
          '<label>Effect<textarea class="mb-input mb-ab-effect" rows="2">' + Chronicle.escapeHtml(ability.effect || '') + '</textarea></label>' +
          '<div class="mb-field-row">' +
            '<label>Trigger (triggered only)<input type="text" class="mb-input mb-ab-trigger" value="' + Chronicle.escapeAttr(ability.trigger || '') + '"></label>' +
            '<label>VP Cost<input type="number" class="mb-input mb-ab-vp" value="' + (Number(ability.spend_vp) || 0) + '" min="0"></label>' +   // H-5: coerce, never a raw string
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
      btn.innerHTML = '<strong>' + Chronicle.escapeHtml(tmpl.name) + '</strong> [' + Chronicle.escapeHtml(p.type || '') + ']' +   // M-3
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
        '<label>Description (optional)<input type="text" class="mb-input" id="mb-fs-desc" value="' + Chronicle.escapeAttr(cr.free_strike) + '" placeholder="e.g. 5 damage"></label>' +
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
      '<div id="mb-step6-warn" class="mb-inline-warn" style="display:none"></div>' +
      '<p class="mb-hint">Leaders and Solos get exactly 3 villain actions, used once each per encounter in order.</p>';

    labels.forEach(function (slot, i) {
      var va = cr.villain_actions[i];
      html += '<div class="mb-va-card">' +
        '<div class="mb-va-header"><span class="mb-va-num">' + slot.icon + '</span> ' +
        '<strong>' + slot.label + '</strong> <small>' + slot.desc + '</small></div>' +
        '<div class="mb-field-row">' +
          '<label>Name<input type="text" class="mb-input mb-va-name" data-idx="' + i + '" value="' + Chronicle.escapeAttr(va.name) + '" placeholder="Villain action name"></label>' +
        '</div>' +
        '<label>Description<textarea class="mb-input mb-va-desc" data-idx="' + i + '" rows="3" placeholder="What this villain action does...">' + Chronicle.escapeHtml(va.description) + '</textarea></label>' +
        '<div class="mb-field-row">' +
          '<label>Power Roll (optional)<input type="text" class="mb-input mb-va-roll" data-idx="' + i + '" value="' + Chronicle.escapeAttr(va.power_roll || '') + '" placeholder="e.g. Might vs. Agility"></label>' +
        '</div>' +
        '<div class="mb-field-row mb-tiers">' +
          '<label>T1 (11-)<input type="text" class="mb-input mb-va-t1" data-idx="' + i + '" value="' + Chronicle.escapeAttr(va.tier1 || '') + '"></label>' +
          '<label>T2 (12-16)<input type="text" class="mb-input mb-va-t2" data-idx="' + i + '" value="' + Chronicle.escapeAttr(va.tier2 || '') + '"></label>' +
          '<label>T3 (17+)<input type="text" class="mb-input mb-va-t3" data-idx="' + i + '" value="' + Chronicle.escapeAttr(va.tier3 || '') + '"></label>' +
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
          '<label>Name<input type="text" class="mb-input mb-trait-name" value="' + Chronicle.escapeAttr(trait.name) + '" placeholder="Trait name"></label>' +
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
    var cr = this.creature;
    if (!cr.ev || cr.ev <= 0) return;

    // Party size/level persist on the instance so they survive step navigation
    // and validation re-renders instead of resetting to defaults (B-7).
    var st = this._encounterState;
    st.partySize = Math.max(1, Math.min(10, st.partySize || 4));
    st.partyLevel = Math.max(1, Math.min(20, st.partyLevel || cr.level));

    var calc = document.createElement('div');
    calc.className = 'mb-encounter-calc';
    // The structure is built once; only .mb-ec-output is rewritten on input, so
    // the number fields keep focus while typing instead of losing it every
    // keystroke to a full innerHTML rebuild (B-7).
    calc.innerHTML =
      '<h4 style="margin:0 0 8px;font-size:0.95em">Encounter Calculator</h4>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
        '<label style="font-size:0.85em">Party size: <input type="number" class="mb-input mb-ec-party" value="' + st.partySize + '" min="1" max="10" style="width:50px"></label>' +
        '<label style="font-size:0.85em">Party level: <input type="number" class="mb-input mb-ec-level" value="' + st.partyLevel + '" min="1" max="20" style="width:50px"></label>' +
      '</div>' +
      '<div style="font-size:0.9em" class="mb-ec-output"></div>';

    var output = calc.querySelector('.mb-ec-output');
    var refresh = function () {
      var budget = st.partySize * st.partyLevel;
      var count = Math.max(1, Math.round(budget / cr.ev));
      var totalEV = count * cr.ev;
      output.innerHTML =
        '<strong>Budget:</strong> ' + budget + ' EV (' + st.partySize + ' heroes \u00d7 level ' + st.partyLevel + ')<br>' +
        '<strong>Use ~' + count + '</strong> of this ' + Chronicle.escapeHtml(cr.organization || 'creature') + ' (EV ' + cr.ev + ' each = ' + totalEV + ' total EV)';
    };

    calc.querySelector('.mb-ec-party').addEventListener('input', function () {
      st.partySize = Math.max(1, Math.min(10, parseInt(this.value) || 4));
      refresh();
    });
    calc.querySelector('.mb-ec-level').addEventListener('input', function () {
      st.partyLevel = Math.max(1, Math.min(20, parseInt(this.value) || cr.level));
      refresh();
    });

    refresh();
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
    if (cr.size) html += h(cr.size) + ' ';   // H-5: escape size in the preview
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
        var svp = Number(ab.spend_vp);   // L-4: coerce so no string reaches output
        if (svp > 0) html += '<div class="sb-ability-vp"><strong>Spend ' + svp + ' VP:</strong> Enhanced effect</div>';
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

  // _buildFieldsData assembles the fields_data map persisted on the entity.
  // Chronicle reads custom fields under the `fields_data` key (B-2/B-3); the old
  // key was silently dropped on write. free_strike_damage is included so a manual
  // free-strike override round-trips instead of being recomputed on reload (B-10).
  _buildFieldsData: function () {
    var cr = this.creature;
    return {
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
      free_strike_damage: cr.free_strike_damage,
      traits: JSON.stringify(cr.traits),
      abilities_json: JSON.stringify(cr.abilities),
      villain_actions_json: JSON.stringify(cr.villain_actions)
    };
  },

  _save: function () {
    var self = this;

    var errors = this._validate().filter(function (r) { return r.severity === 'error'; });
    if (errors.length > 0) {
      alert('Cannot save: ' + errors[0].message);
      return;
    }
    if (!this.config.campaignId) {
      alert('No campaign context. Saving a creature requires a campaign.');
      return;
    }

    var fieldsData = this._buildFieldsData();
    this._setSaveStatus('saving');

    // PUT updates an existing entity; POST creates one when none is configured
    // (B-4). Chronicle has no partial-update route for entities (B-3) — the old
    // request method never matched a handler, so saves silently no-op'd.
    var promise = this.config.entityId
      ? this._updateEntity(fieldsData)
      : this._createEntity(fieldsData);

    promise.then(function () {
      self._onSaveSuccess();
    }).catch(function (err) {
      self._setSaveStatus('error');
      alert(err && err.message ? err.message : 'Could not save creature. Please try again.');
    });
  },

  _updateEntity: function (fieldsData) {
    var self = this;
    var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities/' + this.config.entityId;
    return Chronicle.apiFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: this.creature.name,
        type_label: 'drawsteel-creature',
        is_private: this._entityIsPrivate,
        fields_data: fieldsData
      })
    }).then(function (res) {
      if (!res.ok) {
        return self._apiError(res, 'Could not save creature. Please try again.').then(function (msg) {
          throw new Error(msg);
        });
      }
    });
  },

  // _createEntity resolves the Draw Steel creature entity type, POSTs a new
  // entity, and stores the returned id so later saves switch to PUT (B-4).
  _createEntity: function (fieldsData) {
    var self = this;
    return this._resolveEntityTypeId().then(function (typeId) {
      var url = '/api/v1/campaigns/' + self.config.campaignId + '/entities';
      return Chronicle.apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: self.creature.name,
          entity_type_id: typeId,
          type_label: 'drawsteel-creature',
          is_private: self._entityIsPrivate,
          fields_data: fieldsData
        })
      });
    }).then(function (res) {
      if (!res.ok) {
        return self._apiError(res, 'Could not create creature. Please try again.').then(function (msg) {
          throw new Error(msg);
        });
      }
      return res.json();
    }).then(function (entity) {
      if (entity && entity.id) self.config.entityId = entity.id;
    });
  },

  // _resolveEntityTypeId looks up the numeric entity_type_id for Draw Steel
  // creatures. type_label is display-only on Chronicle and does NOT select the
  // type — without an explicit id the create handler defaults to the campaign's
  // first type. We match the `drawsteel-creature` slug (falling back to the
  // "Creature" name) and error clearly if the type isn't installed.
  _resolveEntityTypeId: function () {
    var url = '/api/v1/campaigns/' + this.config.campaignId + '/entity-types';
    return Chronicle.apiFetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Could not load entity types for this campaign.');
        return r.json();
      })
      .then(function (data) {
        var types = (data && data.data) || (Array.isArray(data) ? data : []);
        var match = null, i;
        for (i = 0; i < types.length; i++) {
          if (types[i].slug === 'drawsteel-creature') { match = types[i]; break; }
        }
        if (!match) {
          for (i = 0; i < types.length; i++) {
            if ((types[i].name || '').toLowerCase() === 'creature') { match = types[i]; break; }
          }
        }
        if (!match) {
          throw new Error('The Draw Steel "Creature" entity type is not installed in this campaign. Install the Draw Steel package, then try again.');
        }
        return match.id;
      });
  },

  // _onSaveSuccess marks the form clean and unlocks bestiary publishing.
  _onSaveSuccess: function () {
    var self = this;
    Chronicle.markClean('monster-builder');
    this._canPublish = true;
    this._setSaveStatus('saved');
    this._renderButtons();
    setTimeout(function () {
      if (self._saveStatus === 'saved') self._setSaveStatus('clean');
    }, 2000);
  },

  // ── Bestiary publish (B-9) ───────────────────────────────

  // _buildStatblock produces the freeform statblock object stored on the
  // bestiary publication. It MUST include a top-level `name` (the server rejects
  // a statblock without one) and carries level/organization/role so the bestiary
  // can index and filter the publication.
  _buildStatblock: function () {
    var cr = this.creature;
    return {
      name: cr.name,
      level: cr.level,
      size: cr.size,
      organization: cr.organization,
      role: cr.role,
      ev: cr.ev,
      keywords: cr.keywords,
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
      immunities: cr.immunities,
      free_strike: cr.free_strike,
      free_strike_damage: cr.free_strike_damage,
      abilities: cr.abilities,
      villain_actions: cr.villain_actions,
      traits: cr.traits
    };
  },

  // _publishToBestiary publishes the saved creature to the instance-level
  // community bestiary (POST /bestiary — not under /campaigns). We omit
  // system_id and send source_campaign_id/source_entity_id so the server stamps
  // the campaign's real system slug authoritatively. visibility defaults to
  // draft (private to the creator); the toggle switches it to published.
  _publishToBestiary: function () {
    var self = this;
    if (!this._canPublish) {
      alert('Save the creature before publishing it to the bestiary.');
      return;
    }
    if (!this.creature.name || !this.creature.name.trim()) {
      alert('The creature needs a name before it can be published.');
      return;
    }

    var body = {
      name: this.creature.name,
      statblock_json: this._buildStatblock(),
      visibility: this._publishVisibility || 'draft'
    };
    if (this.config.campaignId) body.source_campaign_id = this.config.campaignId;
    if (this.config.entityId) body.source_entity_id = this.config.entityId;

    this._setPublishMsg('Publishing…', '');
    Chronicle.apiFetch('/bestiary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 429) {
        self._setPublishMsg('Bestiary publish limit reached (10 per hour). Please try again later.', 'error');
        return null;
      }
      if (!res.ok) {
        return self._apiError(res, 'Could not publish to the bestiary.').then(function (msg) {
          self._setPublishMsg(msg, 'error');
          return null;
        });
      }
      return res.json().then(function (pub) {
        var where = self._publishVisibility === 'published' ? 'the public bestiary' : 'My Creations (private)';
        var name = (pub && pub.name) ? pub.name : self.creature.name;
        self._setPublishMsg('Published "' + name + '" to ' + where + '.', 'ok');
      });
    }).catch(function (err) {
      self._setPublishMsg(err && err.message ? err.message : 'Could not publish to the bestiary.', 'error');
    });
  },

  // _setPublishMsg shows publish feedback just above the save bar. textContent
  // keeps it XSS-safe regardless of the creature/publication name.
  _setPublishMsg: function (msg, kind) {
    if (!this._saveBarEl || !this._saveBarEl.parentNode) return;
    var el = this.el.querySelector('.mb-publish-msg');
    if (!el) {
      el = document.createElement('div');
      el.className = 'mb-publish-msg';
      this._saveBarEl.parentNode.insertBefore(el, this._saveBarEl);
    }
    el.className = 'mb-publish-msg' + (kind ? ' mb-publish-' + kind : '');
    el.textContent = msg;
  }
});
