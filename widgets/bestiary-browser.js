/**
 * Draw Steel Bestiary Browser Widget
 * Browsable creature catalog with filtering, search, and popup statblocks.
 */
Chronicle.register('bestiary-browser', {
  init: function (el, config) {
    var self = this;
    this.el = el;
    this.config = config;
    this.orgTemplates = [];
    this.roleTemplates = [];
    this.creatureKeywords = [];
    this.state = {
      source: config.source || 'campaign',
      creatures: [],
      filtered: [],
      page: 0,
      perPage: Number(config.perPage) || 20,
      sort: 'level-asc',
      search: '',
      filters: { organization: '', role: '', levelMin: 1, levelMax: 20, keywords: [] },
      filtersOpen: true,
      modalCreature: null,
      loading: true
    };

    this._escHandler = function (e) {
      if (e.key === 'Escape' && self.state.modalCreature) self._closeModal();
    };
    document.addEventListener('keydown', this._escHandler);

    this._loadData().then(function () {
      return self._fetchCreatures();
    }).then(function () {
      self.state.loading = false;
      self._applyFilters();
      self._render();
    }).catch(function (err) {
      console.error('Bestiary Browser: load failed', err);
      self.state.loading = false;
      self._render();
    });
  },

  destroy: function (el) {
    document.removeEventListener('keydown', this._escHandler);
    el.innerHTML = '';
  },

  // ── Data Loading ──

  _loadData: function () {
    var self = this;
    var base = this.config.campaignId
      ? '/api/v1/campaigns/' + this.config.campaignId + '/extensions/drawsteel/assets/'
      : '/extensions/drawsteel/assets/';
    return Promise.all([
      fetch(base + 'data/organization-templates.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/role-templates.json').then(function (r) { return r.json(); }),
      fetch(base + 'data/creature-keywords.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
      self.orgTemplates = results[0];
      self.roleTemplates = results[1];
      self.creatureKeywords = results[2];
    });
  },

  _fetchCreatures: function () {
    var self = this;
    if (this.state.source === 'campaign' && this.config.campaignId) {
      var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities?preset=drawsteel-creature';
      return Chronicle.apiFetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var entities = Array.isArray(data) ? data : (data.entities || data.results || []);
          self.state.creatures = entities.map(function (e) { return self._normalizeEntity(e); });
        });
    }
    // Bestiary mode
    return Chronicle.apiFetch('/bestiary?limit=500')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = Array.isArray(data) ? data : (data.results || []);
        self.state.creatures = items.map(function (e) { return self._normalizeEntity(e); });
      })
      .catch(function () {
        self.state.creatures = [];
        self._bestiaryUnavailable = true;
      });
  },

  _normalizeEntity: function (entity) {
    var f = entity.custom_fields || entity;
    return {
      id: entity.id || '',
      name: entity.name || f.name || 'Unnamed',
      level: Number(f.level) || 1,
      organization: f.organization || '',
      role: f.role || '',
      ev: Number(f.ev) || 0,
      size: f.size || 'M',
      keywords: this._parseList(f.keywords),
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
      immunities: this._parseList(f.immunities),
      free_strike: f.free_strike || '',
      traits: this._parseJSON(f.traits, []),
      abilities: this._parseJSON(f.abilities_json, []),
      villain_actions: this._parseJSON(f.villain_actions_json, [])
    };
  },

  // ── Utilities ──

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

  _capitalize: function (s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  },

  _debounce: function (fn, ms) {
    var timer;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  },

  _getOrgColor: function (slug) {
    var colors = { minion: '#999', horde: '#d97706', platoon: '#2563eb', elite: '#7c3aed', leader: '#dc2626', solo: '#d97706', swarm: '#059669' };
    return colors[slug] || '#999';
  },

  // ── Filtering & Sorting ──

  _applyFilters: function () {
    var self = this;
    var s = this.state;
    var f = s.filters;
    var searchLower = s.search.toLowerCase();

    s.filtered = s.creatures.filter(function (cr) {
      if (searchLower) {
        var haystack = (cr.name + ' ' + cr.faction + ' ' + cr.keywords.join(' ')).toLowerCase();
        if (haystack.indexOf(searchLower) === -1) return false;
      }
      if (f.organization && cr.organization !== f.organization) return false;
      if (f.role && cr.role !== f.role) return false;
      if (cr.level < f.levelMin || cr.level > f.levelMax) return false;
      if (f.keywords.length > 0) {
        var has = false;
        for (var i = 0; i < f.keywords.length; i++) {
          if (cr.keywords.indexOf(f.keywords[i]) !== -1) { has = true; break; }
        }
        if (!has) return false;
      }
      return true;
    });

    this._sortCreatures();
    s.page = 0;
  },

  _sortCreatures: function () {
    var sort = this.state.sort;
    this.state.filtered.sort(function (a, b) {
      if (sort === 'level-asc') return a.level - b.level || a.name.localeCompare(b.name);
      if (sort === 'level-desc') return b.level - a.level || a.name.localeCompare(b.name);
      if (sort === 'name-az') return a.name.localeCompare(b.name);
      if (sort === 'name-za') return b.name.localeCompare(a.name);
      if (sort === 'ev-desc') return b.ev - a.ev || a.name.localeCompare(b.name);
      return 0;
    });
  },

  _getPageSlice: function () {
    var s = this.state;
    var start = s.page * s.perPage;
    return s.filtered.slice(start, start + s.perPage);
  },

  _totalPages: function () {
    return Math.max(1, Math.ceil(this.state.filtered.length / this.state.perPage));
  },

  // ── RENDER (main shell) ──

  _render: function () {
    var self = this;
    var el = this.el;
    el.innerHTML = '';
    el.className = 'bb-root';
    this._injectStyles();

    if (this.state.loading) {
      el.innerHTML += '<div class="bb-loading">Loading creatures...</div>';
      return;
    }

    if (this._bestiaryUnavailable && this.state.source !== 'campaign') {
      el.innerHTML += '<div class="bb-empty">Community Bestiary is not available on this instance. Try using <strong>campaign</strong> source instead.</div>';
      return;
    }

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'bb-toolbar';

    var search = document.createElement('input');
    search.className = 'bb-search';
    search.type = 'text';
    search.placeholder = 'Search creatures...';
    search.value = this.state.search;
    var debouncedSearch = this._debounce(function () {
      self.state.search = search.value;
      self._applyFilters();
      self._renderGrid();
      self._renderPills();
      self._renderCount();
      self._renderPagination();
    }, 300);
    search.addEventListener('input', debouncedSearch);
    toolbar.appendChild(search);

    var sort = document.createElement('select');
    sort.className = 'bb-sort';
    var sortOpts = [
      ['level-asc', 'Level (Low-High)'], ['level-desc', 'Level (High-Low)'],
      ['name-az', 'Name (A-Z)'], ['name-za', 'Name (Z-A)'], ['ev-desc', 'EV (Highest)']
    ];
    sortOpts.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1];
      if (self.state.sort === opt[0]) o.selected = true;
      sort.appendChild(o);
    });
    sort.addEventListener('change', function () {
      self.state.sort = sort.value;
      self._applyFilters();
      self._renderGrid();
      self._renderPagination();
    });
    toolbar.appendChild(sort);

    this._countEl = document.createElement('span');
    this._countEl.className = 'bb-results-count';
    toolbar.appendChild(this._countEl);

    var filterToggle = document.createElement('button');
    filterToggle.className = 'bb-filter-toggle';
    filterToggle.textContent = 'Filters';
    filterToggle.addEventListener('click', function () {
      self.state.filtersOpen = !self.state.filtersOpen;
      self._sidebarEl.classList.toggle('collapsed', !self.state.filtersOpen);
    });
    toolbar.appendChild(filterToggle);

    el.appendChild(toolbar);

    // Pills
    this._pillsEl = document.createElement('div');
    this._pillsEl.className = 'bb-pills';
    el.appendChild(this._pillsEl);

    // Body (sidebar + grid area)
    var body = document.createElement('div');
    body.className = 'bb-body';

    this._sidebarEl = document.createElement('aside');
    this._sidebarEl.className = 'bb-sidebar' + (this.state.filtersOpen ? '' : ' collapsed');
    this._renderFilters();
    body.appendChild(this._sidebarEl);

    var gridArea = document.createElement('div');
    gridArea.className = 'bb-grid-area';

    this._gridEl = document.createElement('div');
    this._gridEl.className = 'bb-grid';
    gridArea.appendChild(this._gridEl);

    this._paginationEl = document.createElement('div');
    this._paginationEl.className = 'bb-pagination';
    gridArea.appendChild(this._paginationEl);

    body.appendChild(gridArea);
    el.appendChild(body);

    // Modal container (hidden)
    this._modalOverlay = document.createElement('div');
    this._modalOverlay.className = 'bb-modal-overlay';
    this._modalOverlay.style.display = 'none';
    this._modalOverlay.addEventListener('click', function (e) {
      if (e.target === self._modalOverlay) self._closeModal();
    });
    el.appendChild(this._modalOverlay);

    // Initial render of dynamic parts
    this._renderGrid();
    this._renderPills();
    this._renderCount();
    this._renderPagination();
  },

  _injectStyles: function () {
    if (this.el.querySelector('style.bb-styles')) return;
    var style = document.createElement('style');
    style.className = 'bb-styles';
    style.textContent = [
      '.bb-root { font-family: inherit; }',
      '.bb-toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center; }',
      '.bb-search { flex:1; min-width:200px; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:0.95em; }',
      '.bb-sort { padding:8px; border:1px solid #ccc; border-radius:4px; font-size:0.9em; }',
      '.bb-results-count { font-size:0.85em; color:#666; white-space:nowrap; }',
      '.bb-filter-toggle { padding:6px 12px; border:1px solid #ccc; border-radius:4px; cursor:pointer; background:#f9f9f9; font-size:0.85em; }',
      '.bb-pills { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }',
      '.bb-pill { background:#e8f0fe; border-radius:12px; padding:3px 10px; font-size:0.8em; display:inline-flex; align-items:center; gap:4px; }',
      '.bb-pill-x { cursor:pointer; font-weight:bold; opacity:0.6; border:none; background:none; padding:0; font-size:1em; }',
      '.bb-pill-x:hover { opacity:1; }',
      '.bb-body { display:flex; gap:16px; }',
      '.bb-sidebar { width:220px; flex-shrink:0; }',
      '.bb-sidebar.collapsed { display:none; }',
      '.bb-grid-area { flex:1; min-width:0; }',
      '.bb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }',
      '.bb-card { border:1px solid #ddd; border-radius:6px; padding:12px; cursor:pointer; transition:box-shadow 0.15s; border-left:4px solid #999; }',
      '.bb-card:hover { box-shadow:0 2px 8px rgba(0,0,0,0.12); }',
      '.bb-card-header { display:flex; justify-content:space-between; align-items:center; }',
      '.bb-card-name { font-weight:bold; font-size:1.05em; }',
      '.bb-card-level { background:#eee; border-radius:4px; padding:2px 6px; font-size:0.85em; white-space:nowrap; }',
      '.bb-card-subtitle { color:#666; font-size:0.9em; margin:4px 0; }',
      '.bb-card-tags { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }',
      '.bb-tag { background:#f0f0f0; border-radius:10px; padding:2px 8px; font-size:0.75em; }',
      '.bb-card-stats { font-size:0.85em; color:#444; margin-top:6px; }',
      '.bb-card-chars { font-size:0.8em; color:#555; margin-top:4px; }',
      '.bb-filter-section { margin-bottom:12px; }',
      '.bb-filter-section h4 { cursor:pointer; margin:0 0 6px; font-size:0.9em; user-select:none; }',
      '.bb-filter-btn { display:inline-block; padding:3px 8px; margin:2px; border:1px solid #ccc; border-radius:4px; cursor:pointer; font-size:0.8em; background:white; }',
      '.bb-filter-btn.active { background:#4a90d9; color:white; border-color:#4a90d9; }',
      '.bb-level-inputs { display:flex; gap:6px; align-items:center; }',
      '.bb-level-input { width:55px; padding:4px; border:1px solid #ccc; border-radius:4px; font-size:0.85em; }',
      '.bb-clear-btn { margin-top:8px; padding:4px 10px; font-size:0.8em; border:1px solid #ccc; border-radius:4px; cursor:pointer; background:#f9f9f9; }',
      '.bb-pagination { display:flex; gap:4px; justify-content:center; margin-top:12px; }',
      '.bb-page-btn { padding:4px 10px; border:1px solid #ccc; border-radius:4px; cursor:pointer; background:white; font-size:0.85em; }',
      '.bb-page-btn.active { background:#4a90d9; color:white; border-color:#4a90d9; }',
      '.bb-page-btn:hover:not(.active) { background:#f0f0f0; }',
      '.bb-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000; }',
      '.bb-modal { background:white; border-radius:8px; max-width:700px; width:90%; max-height:85vh; overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,0.3); }',
      '.bb-modal-header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid #eee; }',
      '.bb-modal-header h2 { margin:0; font-size:1.3em; }',
      '.bb-modal-close { background:none; border:none; font-size:24px; cursor:pointer; padding:0; line-height:1; color:#666; }',
      '.bb-modal-close:hover { color:#000; }',
      '.bb-modal-body { padding:20px; }',
      '.bb-modal-actions { padding:12px 20px; border-top:1px solid #eee; display:flex; gap:8px; }',
      '.bb-empty { text-align:center; padding:40px; color:#999; }',
      '.bb-loading { text-align:center; padding:40px; color:#666; }',
      // Statblock fallback styles (in case platform sb-* styles not loaded)
      '.sb-header { margin-bottom:8px; }',
      '.sb-name { margin:0 0 4px; font-size:1.3em; }',
      '.sb-subtitle { color:#666; font-size:0.95em; }',
      '.sb-keywords { font-style:italic; color:#555; font-size:0.9em; }',
      '.sb-faction { color:#888; font-size:0.9em; }',
      '.sb-ev { font-weight:bold; margin-top:4px; }',
      '.sb-divider { border-top:2px solid #7c3aed; margin:10px 0; }',
      '.sb-stats { margin:8px 0; }',
      '.sb-stat-row { display:flex; gap:16px; flex-wrap:wrap; }',
      '.sb-stat { font-size:0.95em; }',
      '.sb-characteristics { display:flex; gap:12px; flex-wrap:wrap; margin:8px 0; }',
      '.sb-char { font-size:0.95em; }',
      '.sb-immunities { margin:6px 0; font-size:0.9em; }',
      '.sb-free-strike { margin:6px 0; font-size:0.9em; }',
      '.sb-ability { margin:8px 0; padding:6px 0; border-bottom:1px solid #f0f0f0; }',
      '.sb-ability-name { font-weight:bold; font-size:0.95em; }',
      '.sb-ability-type { font-weight:normal; color:#888; font-size:0.85em; }',
      '.sb-ability-kw { font-style:italic; color:#666; font-size:0.85em; }',
      '.sb-ability-meta { color:#555; font-size:0.85em; margin:2px 0; }',
      '.sb-ability-trigger { font-size:0.9em; margin:2px 0; }',
      '.sb-ability-tiers { margin:4px 0 4px 12px; font-size:0.9em; }',
      '.sb-ability-effect { font-size:0.9em; margin:2px 0; }',
      '.sb-ability-vp { font-size:0.9em; color:#7c3aed; }',
      '.sb-villain-actions h3 { font-size:1.05em; margin:0 0 6px; }',
      '.sb-va { margin:6px 0; }',
      '.sb-va-name { font-weight:bold; font-size:0.95em; }',
      '.sb-va-tiers { margin:4px 0 4px 12px; font-size:0.9em; }',
      '.sb-traits h3 { font-size:1.05em; margin:0 0 6px; }',
      '.sb-trait { margin:4px 0; font-size:0.9em; }'
    ].join('\n');
    this.el.insertBefore(style, this.el.firstChild);
  },

  _renderGrid: function () {
    var self = this;
    var grid = this._gridEl;
    if (!grid) return;
    grid.innerHTML = '';
    var slice = this._getPageSlice();
    if (slice.length === 0) {
      grid.innerHTML = '<div class="bb-empty">' +
        (this.state.creatures.length === 0 ? 'No creatures loaded.' : 'No creatures match your filters.') +
        '</div>';
      return;
    }
    slice.forEach(function (cr, i) {
      grid.appendChild(self._renderCard(cr, i));
    });
  },

  _renderCard: function (creature, idx) {
    var self = this;
    var h = Chronicle.escapeHtml;
    var card = document.createElement('div');
    card.className = 'bb-card';
    card.style.borderLeftColor = this._getOrgColor(creature.organization);

    var header = '<div class="bb-card-header">' +
      '<span class="bb-card-name">' + h(creature.name) + '</span>' +
      '<span class="bb-card-level">L' + creature.level + '</span></div>';

    var subtitle = '<div class="bb-card-subtitle">';
    if (creature.organization) subtitle += this._capitalize(creature.organization) + ' ';
    if (creature.role) subtitle += this._capitalize(creature.role);
    if (creature.ev) subtitle += ' &middot; EV ' + creature.ev;
    subtitle += '</div>';

    var tags = '';
    if (creature.keywords.length > 0) {
      tags = '<div class="bb-card-tags">' + creature.keywords.map(function (k) {
        return '<span class="bb-tag">' + h(k) + '</span>';
      }).join('') + '</div>';
    }

    var charSign = function (v) { return v >= 0 ? '+' + v : '' + v; };
    var stats = '<div class="bb-card-stats">STM ' + creature.stamina + ' &middot; SPD ' + creature.speed + '</div>';
    var chars = '<div class="bb-card-chars">MGT ' + charSign(creature.might) +
      ' AGI ' + charSign(creature.agility) +
      ' RSN ' + charSign(creature.reason) +
      ' INT ' + charSign(creature.intuition) +
      ' PRS ' + charSign(creature.presence) + '</div>';

    card.innerHTML = header + subtitle + tags + stats + chars;
    card.addEventListener('click', function () { self._openModal(creature); });
    return card;
  },

  _renderFilters: function () {
    var self = this;
    var sidebar = this._sidebarEl;
    if (!sidebar) return;
    sidebar.innerHTML = '';

    // Organization section
    var orgSection = document.createElement('div');
    orgSection.className = 'bb-filter-section';
    orgSection.innerHTML = '<h4>Organization</h4>';
    var orgBtns = document.createElement('div');
    this.orgTemplates.forEach(function (org) {
      var btn = document.createElement('button');
      btn.className = 'bb-filter-btn' + (self.state.filters.organization === org.slug ? ' active' : '');
      btn.textContent = org.name;
      btn.addEventListener('click', function () {
        self.state.filters.organization = self.state.filters.organization === org.slug ? '' : org.slug;
        self._applyFilters();
        self._renderFilters();
        self._renderGrid();
        self._renderPills();
        self._renderCount();
        self._renderPagination();
      });
      orgBtns.appendChild(btn);
    });
    orgSection.appendChild(orgBtns);
    sidebar.appendChild(orgSection);

    // Role section
    var roleSection = document.createElement('div');
    roleSection.className = 'bb-filter-section';
    roleSection.innerHTML = '<h4>Role</h4>';
    var roleBtns = document.createElement('div');
    this.roleTemplates.forEach(function (role) {
      var btn = document.createElement('button');
      btn.className = 'bb-filter-btn' + (self.state.filters.role === role.slug ? ' active' : '');
      btn.textContent = role.name;
      btn.addEventListener('click', function () {
        self.state.filters.role = self.state.filters.role === role.slug ? '' : role.slug;
        self._applyFilters();
        self._renderFilters();
        self._renderGrid();
        self._renderPills();
        self._renderCount();
        self._renderPagination();
      });
      roleBtns.appendChild(btn);
    });
    roleSection.appendChild(roleBtns);
    sidebar.appendChild(roleSection);

    // Level range section
    var levelSection = document.createElement('div');
    levelSection.className = 'bb-filter-section';
    levelSection.innerHTML = '<h4>Level Range</h4>';
    var levelDiv = document.createElement('div');
    levelDiv.className = 'bb-level-inputs';
    var minInput = document.createElement('input');
    minInput.type = 'number'; minInput.className = 'bb-level-input';
    minInput.min = 1; minInput.max = 20; minInput.value = self.state.filters.levelMin;
    var span = document.createElement('span');
    span.textContent = ' to ';
    var maxInput = document.createElement('input');
    maxInput.type = 'number'; maxInput.className = 'bb-level-input';
    maxInput.min = 1; maxInput.max = 20; maxInput.value = self.state.filters.levelMax;
    var onLevelChange = function () {
      self.state.filters.levelMin = Math.max(1, Math.min(20, Number(minInput.value) || 1));
      self.state.filters.levelMax = Math.max(1, Math.min(20, Number(maxInput.value) || 20));
      self._applyFilters();
      self._renderGrid();
      self._renderPills();
      self._renderCount();
      self._renderPagination();
    };
    minInput.addEventListener('change', onLevelChange);
    maxInput.addEventListener('change', onLevelChange);
    levelDiv.appendChild(minInput);
    levelDiv.appendChild(span);
    levelDiv.appendChild(maxInput);
    levelSection.appendChild(levelDiv);
    sidebar.appendChild(levelSection);

    // Keywords section
    var kwSection = document.createElement('div');
    kwSection.className = 'bb-filter-section';
    kwSection.innerHTML = '<h4>Keywords</h4>';
    var kwBtns = document.createElement('div');
    this.creatureKeywords.forEach(function (kw) {
      var btn = document.createElement('button');
      var isActive = self.state.filters.keywords.indexOf(kw.name) !== -1;
      btn.className = 'bb-filter-btn' + (isActive ? ' active' : '');
      btn.textContent = kw.name;
      btn.addEventListener('click', function () {
        var idx = self.state.filters.keywords.indexOf(kw.name);
        if (idx === -1) { self.state.filters.keywords.push(kw.name); }
        else { self.state.filters.keywords.splice(idx, 1); }
        self._applyFilters();
        self._renderFilters();
        self._renderGrid();
        self._renderPills();
        self._renderCount();
        self._renderPagination();
      });
      kwBtns.appendChild(btn);
    });
    kwSection.appendChild(kwBtns);
    sidebar.appendChild(kwSection);

    // Clear all button
    var clearBtn = document.createElement('button');
    clearBtn.className = 'bb-clear-btn';
    clearBtn.textContent = 'Clear All Filters';
    clearBtn.addEventListener('click', function () {
      self.state.filters = { organization: '', role: '', levelMin: 1, levelMax: 20, keywords: [] };
      self._applyFilters();
      self._renderFilters();
      self._renderGrid();
      self._renderPills();
      self._renderCount();
      self._renderPagination();
    });
    sidebar.appendChild(clearBtn);
  },

  _renderPills: function () {
    var self = this;
    var el = this._pillsEl;
    if (!el) return;
    el.innerHTML = '';
    var f = this.state.filters;
    var pills = [];

    if (f.organization) pills.push({ label: this._capitalize(f.organization), clear: function () { self.state.filters.organization = ''; } });
    if (f.role) pills.push({ label: this._capitalize(f.role), clear: function () { self.state.filters.role = ''; } });
    if (f.levelMin > 1 || f.levelMax < 20) pills.push({ label: 'Level ' + f.levelMin + '-' + f.levelMax, clear: function () { self.state.filters.levelMin = 1; self.state.filters.levelMax = 20; } });
    f.keywords.forEach(function (kw, i) {
      pills.push({ label: kw, clear: function () { self.state.filters.keywords.splice(self.state.filters.keywords.indexOf(kw), 1); } });
    });
    if (this.state.search) pills.push({ label: 'Search: "' + this.state.search + '"', clear: function () { self.state.search = ''; var inp = self.el.querySelector('.bb-search'); if (inp) inp.value = ''; } });

    pills.forEach(function (p) {
      var pill = document.createElement('span');
      pill.className = 'bb-pill';
      pill.textContent = p.label + ' ';
      var x = document.createElement('button');
      x.className = 'bb-pill-x';
      x.textContent = '\u00d7';
      x.addEventListener('click', function () {
        p.clear();
        self._applyFilters();
        self._renderFilters();
        self._renderGrid();
        self._renderPills();
        self._renderCount();
        self._renderPagination();
      });
      pill.appendChild(x);
      el.appendChild(pill);
    });
  },

  _renderPagination: function () {
    var self = this;
    var el = this._paginationEl;
    if (!el) return;
    el.innerHTML = '';
    var total = this._totalPages();
    if (total <= 1) return;
    var current = this.state.page;

    var addBtn = function (label, page, active) {
      var btn = document.createElement('button');
      btn.className = 'bb-page-btn' + (active ? ' active' : '');
      btn.textContent = label;
      if (!active) {
        btn.addEventListener('click', function () {
          self.state.page = page;
          self._renderGrid();
          self._renderPagination();
          self._renderCount();
          if (self._gridEl) self._gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      el.appendChild(btn);
    };

    // Show: first, ... current-1, current, current+1, ... last
    var pages = [];
    pages.push(0);
    for (var i = current - 2; i <= current + 2; i++) {
      if (i > 0 && i < total - 1) pages.push(i);
    }
    if (total > 1) pages.push(total - 1);
    // Deduplicate and sort
    var seen = {};
    pages = pages.filter(function (p) { if (seen[p]) return false; seen[p] = true; return true; });

    var last = -1;
    pages.forEach(function (p) {
      if (last >= 0 && p - last > 1) {
        var ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '4px';
        el.appendChild(ellipsis);
      }
      addBtn(String(p + 1), p, p === current);
      last = p;
    });
  },

  _renderCount: function () {
    if (!this._countEl) return;
    var s = this.state;
    var total = s.filtered.length;
    if (total === 0) { this._countEl.textContent = '0 creatures'; return; }
    var start = s.page * s.perPage + 1;
    var end = Math.min(start + s.perPage - 1, total);
    this._countEl.textContent = start + '-' + end + ' of ' + total + ' creatures';
  },

  _openModal: function (creature) {
    var self = this;
    var h = Chronicle.escapeHtml;
    this.state.modalCreature = creature;
    var overlay = this._modalOverlay;
    overlay.style.display = 'flex';

    var modal = document.createElement('div');
    modal.className = 'bb-modal';

    var header = document.createElement('div');
    header.className = 'bb-modal-header';
    header.innerHTML = '<h2>' + h(creature.name) + '</h2>';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'bb-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { self._closeModal(); });
    header.appendChild(closeBtn);
    modal.appendChild(header);

    var body = document.createElement('div');
    body.className = 'bb-modal-body';
    body.innerHTML = this._buildStatblockHtml(creature);
    modal.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'bb-modal-actions';
    var importBtn = document.createElement('button');
    importBtn.className = 'btn btn-primary';
    importBtn.textContent = 'Import to Campaign';
    importBtn.addEventListener('click', function () {
      if (!self.config.campaignId) { alert('No campaign selected.'); return; }
      var url = '/api/v1/campaigns/' + self.config.campaignId + '/entities';
      var payload = { name: creature.name, preset: 'drawsteel-creature', custom_fields: creature };
      Chronicle.apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function () { importBtn.textContent = 'Imported!'; importBtn.disabled = true; })
        .catch(function () { alert('Import failed.'); });
    });
    actions.appendChild(importBtn);

    var exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-secondary';
    exportBtn.textContent = 'Export JSON';
    exportBtn.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(creature, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (creature.name || 'creature').replace(/[^a-z0-9]/gi, '_') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    actions.appendChild(exportBtn);

    modal.appendChild(actions);
    overlay.innerHTML = '';
    overlay.appendChild(modal);
  },

  _closeModal: function () {
    this.state.modalCreature = null;
    if (this._modalOverlay) {
      this._modalOverlay.style.display = 'none';
      this._modalOverlay.innerHTML = '';
    }
  },

  _buildStatblockHtml: function (creature) {
    var cr = creature;
    var h = Chronicle.escapeHtml;
    var html = '';

    // Header
    html += '<div class="sb-header">';
    html += '<h2 class="sb-name">' + h(cr.name) + '</h2>';
    html += '<div class="sb-subtitle">Level ' + cr.level + ' ';
    if (cr.size) html += cr.size + ' ';
    if (cr.organization) html += h(cr.organization.charAt(0).toUpperCase() + cr.organization.slice(1)) + ' ';
    if (cr.role) html += h(cr.role.charAt(0).toUpperCase() + cr.role.slice(1));
    html += '</div>';
    if (cr.keywords.length > 0) {
      html += '<div class="sb-keywords">' + cr.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
    }
    if (cr.faction) html += '<div class="sb-faction">' + h(cr.faction) + '</div>';
    html += '<div class="sb-ev">EV ' + cr.ev + '</div>';
    html += '</div>';

    html += '<div class="sb-divider"></div>';

    // Core stats
    html += '<div class="sb-stats"><div class="sb-stat-row">';
    html += '<span class="sb-stat"><strong>STM</strong> ' + cr.stamina + '</span>';
    html += '<span class="sb-stat"><strong>Winded</strong> ' + cr.winded + '</span>';
    html += '<span class="sb-stat"><strong>SPD</strong> ' + cr.speed + '</span>';
    html += '<span class="sb-stat"><strong>Stability</strong> ' + cr.stability + '</span>';
    html += '</div></div>';

    // Characteristics
    html += '<div class="sb-characteristics">';
    var chars = ['might', 'agility', 'reason', 'intuition', 'presence'];
    chars.forEach(function (stat) {
      var val = cr[stat];
      var sign = val >= 0 ? '+' : '';
      html += '<span class="sb-char"><strong>' + stat.charAt(0).toUpperCase() + stat.slice(1, 3).toUpperCase() + '</strong> ' + sign + val + '</span>';
    });
    html += '</div>';

    // Immunities
    if (cr.immunities && cr.immunities.length > 0) {
      html += '<div class="sb-immunities"><strong>Immunities:</strong> ' + cr.immunities.map(function (i) { return h(i); }).join(', ') + '</div>';
    }

    html += '<div class="sb-divider"></div>';

    // Free Strike
    if (cr.free_strike) {
      html += '<div class="sb-free-strike"><strong>Free Strike:</strong> ' + h(cr.free_strike) + '</div>';
    }

    // Abilities
    if (cr.abilities && cr.abilities.length > 0) {
      html += '<div class="sb-abilities">';
      cr.abilities.forEach(function (ab) {
        var typeLabel = ab.type === 'signature' ? '\u2605 ' : '';
        html += '<div class="sb-ability">';
        html += '<div class="sb-ability-name">' + typeLabel + h(ab.name || '') + ' <span class="sb-ability-type">[' + h(ab.type || '') + ']</span></div>';
        if (ab.keywords && ab.keywords.length > 0) {
          html += '<div class="sb-ability-kw">' + ab.keywords.map(function (k) { return h(k); }).join(', ') + '</div>';
        }
        var meta = [];
        if (ab.distance) meta.push(h(ab.distance));
        if (ab.target) meta.push(h(ab.target));
        if (ab.power_roll) meta.push(h(ab.power_roll));
        if (meta.length > 0) html += '<div class="sb-ability-meta">' + meta.join(' &bull; ') + '</div>';
        if (ab.trigger) html += '<div class="sb-ability-trigger"><strong>Trigger:</strong> ' + h(ab.trigger) + '</div>';
        if (ab.tier1 || ab.tier2 || ab.tier3) {
          html += '<div class="sb-ability-tiers">';
          if (ab.tier1) html += '<div><strong>11 or lower:</strong> ' + h(ab.tier1) + '</div>';
          if (ab.tier2) html += '<div><strong>12-16:</strong> ' + h(ab.tier2) + '</div>';
          if (ab.tier3) html += '<div><strong>17+:</strong> ' + h(ab.tier3) + '</div>';
          html += '</div>';
        }
        if (ab.effect) html += '<div class="sb-ability-effect"><strong>Effect:</strong> ' + h(ab.effect) + '</div>';
        if (ab.spend_vp && ab.spend_vp > 0) html += '<div class="sb-ability-vp"><strong>Spend ' + ab.spend_vp + ' VP:</strong> Enhanced effect</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Villain Actions
    var va = cr.villain_actions ? cr.villain_actions.filter(function (v) { return v.name && v.name.trim(); }) : [];
    if (va.length > 0) {
      html += '<div class="sb-divider"></div>';
      html += '<div class="sb-villain-actions"><h3>Villain Actions</h3>';
      var orderLabels = { 'opener': 'Opener', 'crowd-control': 'Crowd Control', 'ultimate': 'Ultimate' };
      va.forEach(function (v) {
        html += '<div class="sb-va">';
        html += '<div class="sb-va-name"><strong>' + h(orderLabels[v.order] || v.order || '') + ':</strong> ' + h(v.name) + '</div>';
        if (v.description) html += '<div class="sb-va-desc">' + h(v.description) + '</div>';
        if (v.power_roll) html += '<div class="sb-va-roll">' + h(v.power_roll) + '</div>';
        if (v.tier1 || v.tier2 || v.tier3) {
          html += '<div class="sb-va-tiers">';
          if (v.tier1) html += '<div><strong>11 or lower:</strong> ' + h(v.tier1) + '</div>';
          if (v.tier2) html += '<div><strong>12-16:</strong> ' + h(v.tier2) + '</div>';
          if (v.tier3) html += '<div><strong>17+:</strong> ' + h(v.tier3) + '</div>';
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Traits
    if (cr.traits && cr.traits.length > 0) {
      html += '<div class="sb-divider"></div>';
      html += '<div class="sb-traits"><h3>Traits</h3>';
      cr.traits.forEach(function (t) {
        html += '<div class="sb-trait"><strong>' + h(t.name || '') + '.</strong> ' + h(t.description || '') + '</div>';
      });
      html += '</div>';
    }

    return html;
  }
});
