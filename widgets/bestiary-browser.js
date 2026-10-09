/**
 * Draw Steel Bestiary Browser Widget
 * Browsable creature catalog with filtering, search, and popup statblocks.
 */
Chronicle.register('bestiary-browser', {
  init: function (el, config) {
    var self = this;
    this.el = el;
    this.config = config;
    this.orgTemplates = [
      { slug: 'minion', name: 'Minion' },
      { slug: 'horde', name: 'Horde' },
      { slug: 'platoon', name: 'Platoon' },
      { slug: 'elite', name: 'Elite' },
      { slug: 'leader', name: 'Leader' },
      { slug: 'solo', name: 'Solo' },
      { slug: 'swarm', name: 'Swarm' }
    ];
    this.roleTemplates = [
      { slug: 'ambusher', name: 'Ambusher' },
      { slug: 'artillery', name: 'Artillery' },
      { slug: 'brute', name: 'Brute' },
      { slug: 'controller', name: 'Controller' },
      { slug: 'defender', name: 'Defender' },
      { slug: 'harrier', name: 'Harrier' },
      { slug: 'hexer', name: 'Hexer' },
      { slug: 'mount', name: 'Mount' },
      { slug: 'support', name: 'Support' }
    ];
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

    // The old second argument built '/api/v1/campaigns/:id/extensions/drawsteel/
    // assets/', a route Chronicle does not have. It only ever fed the renderer's
    // no-campaign fallback, so this worked by accident whenever a campaign id
    // was present and failed silently when it was not. The renderer owns the
    // real path now (see reference-renderer.js).
    this._ref = new DrawSteelRefRenderer('', config.campaignId);

    Promise.all([this._ref.load(), this._fetchCreatures()]).then(function () {
      self._ref.injectStyles();
      self._deriveKeywords();
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

  _apiError: function (res, fallback) {
    return res.json().then(
      function (body) { return body && body.message ? body.message : fallback; },
      function () { return fallback; }
    );
  },

  // _entityUrl builds a campaign entity API path. campaignId/entityId are
  // normally numeric ids from Chronicle's own config or entity data, but
  // percent-encoding keeps a stray "/" or "?" from reshaping the request path.
  _entityUrl: function (campaignId, entityId) {
    var url = '/api/v1/campaigns/' + encodeURIComponent(campaignId) + '/entities';
    if (entityId !== undefined && entityId !== null && entityId !== '') {
      url += '/' + encodeURIComponent(entityId);
    }
    return url;
  },

  // _boundCreatureFields returns a size-capped copy of a creature so an
  // oversized name or ability/trait list from an import can't be written to
  // an entity's fields_data. Defense in depth: Chronicle's server is the
  // real limit enforcer. Pure — never mutates the creature passed in.
  _boundCreatureFields: function (cr) {
    var MAX_NAME = 200, MAX_LIST = 50;
    var capArray = function (arr) {
      return Array.isArray(arr) && arr.length > MAX_LIST ? arr.slice(0, MAX_LIST) : arr;
    };
    var bounded = {};
    for (var k in cr) { if (cr.hasOwnProperty(k)) bounded[k] = cr[k]; }
    bounded.name = String(cr.name || '').slice(0, MAX_NAME);
    bounded.level = Math.max(1, Math.min(20, Number(cr.level) || 1));
    bounded.abilities = capArray(cr.abilities);
    bounded.traits = capArray(cr.traits);
    bounded.villain_actions = capArray(cr.villain_actions);
    return bounded;
  },

  // ── Data Loading ──

  _deriveKeywords: function () {
    var seen = {};
    var list = [];
    this.state.creatures.forEach(function (cr) {
      cr.keywords.forEach(function (kw) {
        if (!seen[kw]) {
          seen[kw] = true;
          list.push({ slug: kw.toLowerCase().replace(/\s+/g, '-'), name: kw });
        }
      });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    this.creatureKeywords = list;
  },

  // Chronicle returns some list endpoints as a bare JSON array and others
  // wrapped as {"data":[…],"total":N}. A consumer that assumes one shape
  // silently renders empty — /api/v1/campaigns/:id/entities is an envelope
  // endpoint, and reading it as `data.entities || data.results` is exactly
  // why campaign mode showed zero creatures. Accept both.
  _unwrapList: function (body) {
    if (Array.isArray(body)) return body;
    if (!body) return [];
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.entities)) return body.entities;
    return [];
  },

  // Resolve the campaign's Creature entity type id. `?preset=drawsteel-creature`
  // is not a parameter Chronicle reads — ListEntities takes type_id/page/
  // per_page/q only, so an unknown param is ignored and the response is every
  // entity in the campaign. The manifest preset slug is not stored on the type
  // either: Chronicle records the preset's `category` as `preset_category` and
  // derives the slug from the name. Match preset_category first, then the
  // slug/name fallbacks the monster builder already uses.
  _resolveCreatureTypeId: function () {
    var self = this;
    var url = '/api/v1/campaigns/' + encodeURIComponent(this.config.campaignId) + '/entity-types';
    return Chronicle.apiFetch(url)
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var types = self._unwrapList(body);
        var i, match = null;
        for (i = 0; i < types.length; i++) {
          if (types[i].preset_category === 'creature') { match = types[i]; break; }
        }
        for (i = 0; !match && i < types.length; i++) {
          if (types[i].slug === 'drawsteel-creature') { match = types[i]; break; }
        }
        for (i = 0; !match && i < types.length; i++) {
          if (String(types[i].name || '').toLowerCase() === 'creature') { match = types[i]; break; }
        }
        return match ? match.id : 0;
      })
      .catch(function () { return 0; });
  },

  // Walk every page of the entity list. per_page defaults to 20 server-side and
  // is capped at 100, so a single unpaged GET shows at most 20 creatures however
  // many the campaign holds. Bounded so a bad `total` cannot spin forever.
  _fetchEntityPages: function (typeId) {
    var self = this;
    var acc = [];
    var base = this._entityUrl(this.config.campaignId) + '?per_page=100';
    if (typeId) base += '&type_id=' + encodeURIComponent(typeId);
    var MAX_PAGES = 50;

    function page(n) {
      return Chronicle.apiFetch(base + '&page=' + n)
        .then(function (r) { return r.json(); })
        .then(function (body) {
          var items = self._unwrapList(body);
          acc = acc.concat(items);
          var total = (body && typeof body.total === 'number') ? body.total : acc.length;
          if (items.length === 0 || acc.length >= total || n >= MAX_PAGES) return acc;
          return page(n + 1);
        });
    }
    return page(1);
  },

  _fetchCreatures: function () {
    var self = this;
    if (this.state.source === 'campaign' && this.config.campaignId) {
      return this._resolveCreatureTypeId()
        .then(function (typeId) {
          self._creatureTypeId = typeId;
          if (!typeId) {
            // Degraded, but visible: without the type we cannot filter
            // server-side, so show what the campaign has rather than nothing.
            console.warn('Bestiary Browser: no Creature entity type found; listing all entities.');
          }
          return self._fetchEntityPages(typeId);
        })
        .then(function (entities) {
          self.state.creatures = entities.map(function (e) { return self._normalizeEntity(e); });
        });
    }
    // Bestiary mode: Search, not Browse, because only Search filters by system
    // (Browse lists every game's creatures); with no query it lists them all.
    // Both cap a page at 50, so walk the pages. Rows are summaries without a
    // stat block; _openModal fetches the full one when a card opens.
    var acc = [];
    function page(n) {
      return Chronicle.apiFetch('/bestiary/search?system_id=drawsteel&per_page=50&page=' + n)
        .then(function (r) {
          if (!r.ok) throw new Error('bestiary search -> ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var items = self._unwrapList(data);
          acc = acc.concat(items);
          var total = (data && typeof data.total === 'number') ? data.total : acc.length;
          if (items.length === 0 || acc.length >= total || n >= 40) return acc;
          return page(n + 1);
        });
    }
    return page(1)
      .then(function (items) {
        self.state.creatures = items.map(function (e) {
          var c = self._normalizeEntity(e);
          // A publication's id is not a campaign entity: it must never reach the
          // Edit/Delete paths, which act on this campaign's pages.
          c.id = '';
          c._slug = e.slug || '';
          c._summary = e;
          return c;
        });
      })
      .catch(function (err) {
        // A server-sourced message is never shown verbatim, same as the
        // import/delete/save/publish paths below — only a fixed, safe
        // string reaches the user; the real error stays in the console.
        console.warn('Bestiary Browser: bestiary fetch failed; falling back to unavailable panel', err);
        self.state.creatures = [];
        self._bestiaryUnavailable = true;
        self._bestiaryUnavailableMessage = 'Community Bestiary is not available on this instance. Try using campaign source instead.';
      });
  },

  _normalizeEntity: function (entity) {
    // Chronicle's Entity carries its custom fields as `fields_data`; it has no
    // `custom_fields` key. Bestiary publications use `custom_fields`, so both
    // are accepted, but fields_data wins.
    var f = entity.fields_data || entity.custom_fields || entity;
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
      abilities: this._parseJSON(f.abilities_json !== undefined ? f.abilities_json : f.abilities, []),
      villain_actions: this._parseJSON(f.villain_actions_json !== undefined ? f.villain_actions_json : f.villain_actions, []),
      // The stored fields as they came, for the shared stat block, which tells
      // an unset figure from a 0.
      _raw: f
    };
  },

  // Inverse of _normalizeEntity: the fields_data map Chronicle stores. traits /
  // abilities_json / villain_actions_json are JSON strings on the wire (the
  // shape the monster builder writes and _parseJSON reads back).
  _toFieldsData: function (cr) {
    return {
      level: cr.level, organization: cr.organization, role: cr.role, ev: cr.ev,
      size: cr.size, keywords: (cr.keywords || []).join(', '), faction: cr.faction,
      stamina: cr.stamina, winded: cr.winded, speed: cr.speed, stability: cr.stability,
      might: cr.might, agility: cr.agility, reason: cr.reason,
      intuition: cr.intuition, presence: cr.presence,
      immunities: (cr.immunities || []).join(', '), free_strike: cr.free_strike,
      traits: JSON.stringify(cr.traits || []),
      abilities_json: JSON.stringify(cr.abilities || []),
      villain_actions_json: JSON.stringify(cr.villain_actions || [])
    };
  },

  // ── Utilities ──

  _parseList: function (val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { var arr = JSON.parse(val); if (Array.isArray(arr)) return arr; } catch (e) {}
    return String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  },

  // Every caller passes an array fallback (traits/abilities/villain_actions,
  // all rendered with .filter/.forEach) — a stored value that parses as
  // valid JSON but isn't an array (e.g. a JSON-encoded string) must fall
  // back too, and a null/non-object array entry must never reach the
  // renderer's dotted property access unfiltered.
  _parseJSON: function (val, fallback) {
    if (!val) return fallback;
    var parsed;
    // A bestiary stat block carries real arrays; stored fields carry JSON text.
    if (typeof val !== 'string') parsed = val;
    else { try { parsed = JSON.parse(val); } catch (e) { return fallback; } }
    if (Array.isArray(fallback)) {
      if (!Array.isArray(parsed)) return fallback;
      return parsed.filter(function (item) { return item !== null && typeof item === 'object'; });
    }
    return parsed;
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
      var skeletonHtml = '<div class="bb-grid" style="margin-top:16px">';
      for (var s = 0; s < 6; s++) { skeletonHtml += '<div class="bb-skeleton bb-skeleton-card"></div>'; }
      skeletonHtml += '</div>';
      el.innerHTML += skeletonHtml;
      return;
    }

    if (this._bestiaryUnavailable && this.state.source !== 'campaign') {
      var unavailableMsg = this._bestiaryUnavailableMessage || 'Community Bestiary is not available on this instance. Try using campaign source instead.';
      el.innerHTML += '<div class="bb-empty">' +
        '<div class="bb-empty-icon">&#9888;</div>' +
        '<div class="bb-empty-title">Bestiary unavailable</div>' +
        '<div class="bb-empty-desc">' + Chronicle.escapeHtml(unavailableMsg) + '</div>' +
      '</div>';
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

    if (this.config.editable !== false && this.config.campaignId) {
      var createBtn = document.createElement('button');
      createBtn.className = 'btn btn-primary';
      createBtn.textContent = '+ Create Creature';
      createBtn.style.marginLeft = 'auto';
      createBtn.addEventListener('click', function () {
        // NewForm preselects the category from `?type=<entity_type_id>`;
        // `?preset=<slug>` is not read and lands the user on an unpicked form.
        var q = self._creatureTypeId ? '?type=' + encodeURIComponent(self._creatureTypeId) : '';
        window.location.href = '/campaigns/' + self.config.campaignId + '/entities/new' + q;
      });
      toolbar.appendChild(createBtn);
    }

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
      // ── Root container ──
      '.bb-root { font-family:Inter,system-ui,-apple-system,sans-serif; font-size:14px; color:var(--color-text-primary,#111827); background:var(--color-card-bg,#fff); border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); border:1px solid var(--color-border,#e5e7eb); padding:16px; }',
      // ── Toolbar ──
      '.bb-toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; align-items:center; position:sticky; top:0; z-index:5; background:var(--color-card-bg,#fff); padding:8px 0; }',
      '.bb-search { flex:1; min-width:200px; padding:8px 12px; border-radius:8px; font-size:14px; background:var(--color-input-bg,#fff); border:1px solid var(--color-input-border,#d1d5db); color:var(--color-text-primary,#111827); transition:all 200ms ease; }',
      '.bb-search:focus { outline:none; box-shadow:0 0 0 2px rgba(var(--color-accent-rgb,99,102,241),0.3); border-color:var(--color-accent,#6366f1); }',
      '.bb-sort { padding:8px 12px; border-radius:8px; font-size:14px; background:var(--color-input-bg,#fff); border:1px solid var(--color-input-border,#d1d5db); color:var(--color-text-primary,#111827); transition:all 200ms ease; }',
      '.bb-sort:focus { outline:none; box-shadow:0 0 0 2px rgba(var(--color-accent-rgb,99,102,241),0.3); border-color:var(--color-accent,#6366f1); }',
      '.bb-sort option { background:var(--color-card-bg,#fff); color:var(--color-text-primary,#111827); }',
      '.bb-results-count { font-size:12px; color:var(--color-text-secondary,#6b7280); white-space:nowrap; }',
      '.bb-filter-toggle { padding:8px 16px; border-radius:8px; font-weight:500; font-size:14px; background:var(--color-card-bg,#fff); border:1px solid var(--color-border,#e5e7eb); color:var(--color-text-body,#374151); cursor:pointer; transition:all 200ms ease; }',
      '.bb-filter-toggle:hover { background:var(--color-bg-tertiary,#f3f4f6); }',
      '.bb-filter-toggle:active { transform:scale(0.98); }',
      // ── Filter pills ──
      '.bb-pills { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }',
      '.bb-pill { display:inline-flex; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:rgba(var(--color-accent-rgb,99,102,241),0.1); color:var(--color-accent,#6366f1); gap:4px; }',
      '.bb-pill-x { cursor:pointer; font-weight:600; opacity:0.6; border:none; background:none; padding:0; font-size:1em; color:inherit; transition:opacity 100ms ease; }',
      '.bb-pill-x:hover { opacity:1; }',
      // ── Layout ──
      '.bb-body { display:flex; gap:16px; }',
      '.bb-sidebar { width:220px; flex-shrink:0; }',
      '.bb-sidebar.collapsed { display:none; }',
      '.bb-grid-area { flex:1; min-width:0; }',
      '.bb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }',
      // ── Cards ──
      '.bb-card { background:var(--color-card-bg,#fff); border:1px solid var(--color-border,#e5e7eb); border-radius:12px; overflow:hidden; cursor:pointer; transition:transform 150ms ease,box-shadow 150ms ease; box-shadow:0 1px 2px rgba(0,0,0,0.05); }',
      '.bb-card:hover { transform:translateY(-2px); box-shadow:0 4px 6px rgba(0,0,0,0.1); }',
      '.bb-card:active { transform:translateY(0); }',
      '.bb-card-accent { height:4px; }',
      '.bb-card-body { padding:12px 16px; }',
      '.bb-card-header { display:flex; justify-content:space-between; align-items:center; }',
      '.bb-card-name { font-weight:600; font-size:14px; color:var(--color-text-primary,#111827); }',
      '.bb-card-level { display:inline-flex; align-items:center; padding:2px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.bb-card-subtitle { color:var(--color-text-secondary,#6b7280); font-size:12px; margin-top:4px; }',
      '.bb-card-tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }',
      '.bb-tag { display:inline-flex; align-items:center; padding:2px 8px; border-radius:9999px; font-size:12px; font-weight:500; background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-secondary,#6b7280); }',
      '.bb-card-stats { font-size:12px; color:var(--color-text-body,#374151); margin-top:8px; }',
      '.bb-card-chars { font-size:12px; color:var(--color-text-secondary,#6b7280); margin-top:4px; }',
      // ── Filter sidebar ──
      '.bb-filter-section { margin-bottom:16px; }',
      '.bb-filter-section h4 { cursor:pointer; margin:0 0 8px; font-size:12px; font-weight:600; color:var(--color-text-secondary,#6b7280); text-transform:uppercase; letter-spacing:0.05em; user-select:none; }',
      '.bb-filter-btn { display:inline-block; padding:4px 10px; margin:2px; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; cursor:pointer; font-size:12px; font-weight:500; background:var(--color-card-bg,#fff); color:var(--color-text-body,#374151); transition:all 150ms ease; }',
      '.bb-filter-btn:hover { background:var(--color-bg-tertiary,#f3f4f6); }',
      '.bb-filter-btn.active { background:var(--color-accent,#6366f1); color:#fff; border-color:var(--color-accent,#6366f1); }',
      '.bb-filter-btn.active:hover { background:var(--color-accent-hover,#4f46e5); border-color:var(--color-accent-hover,#4f46e5); }',
      '.bb-level-inputs { display:flex; gap:6px; align-items:center; font-size:12px; color:var(--color-text-secondary,#6b7280); }',
      '.bb-level-input { width:60px; padding:6px 8px; border:1px solid var(--color-input-border,#d1d5db); border-radius:8px; font-size:12px; background:var(--color-input-bg,#fff); color:var(--color-text-primary,#111827); transition:all 200ms ease; }',
      '.bb-level-input:focus { outline:none; box-shadow:0 0 0 2px rgba(var(--color-accent-rgb,99,102,241),0.3); border-color:var(--color-accent,#6366f1); }',
      '.bb-clear-btn { margin-top:8px; padding:6px 12px; font-size:12px; font-weight:500; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; cursor:pointer; background:var(--color-card-bg,#fff); color:var(--color-text-body,#374151); transition:all 200ms ease; }',
      '.bb-clear-btn:hover { background:var(--color-bg-tertiary,#f3f4f6); }',
      // ── Pagination ──
      '.bb-pagination { display:flex; gap:4px; justify-content:center; margin-top:16px; }',
      '.bb-page-btn { padding:6px 12px; border:1px solid var(--color-border,#e5e7eb); border-radius:8px; cursor:pointer; background:var(--color-card-bg,#fff); font-size:12px; font-weight:500; color:var(--color-text-body,#374151); transition:all 150ms ease; }',
      '.bb-page-btn.active { background:var(--color-accent,#6366f1); color:#fff; border-color:var(--color-accent,#6366f1); }',
      '.bb-page-btn.active:hover { background:var(--color-accent-hover,#4f46e5); border-color:var(--color-accent-hover,#4f46e5); }',
      '.bb-page-btn:hover:not(.active) { background:var(--color-bg-tertiary,#f3f4f6); }',
      // ── Modal ──
      '@keyframes bb-backdrop-in { from { opacity:0; } to { opacity:1; } }',
      '@keyframes bb-modal-in { from { opacity:0; transform:scale(0.98) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }',
      '.bb-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000; animation:bb-backdrop-in 200ms ease-out; }',
      '.bb-modal { background:var(--color-card-bg,#fff); border-radius:12px; max-width:700px; width:90%; max-height:85vh; overflow-y:auto; box-shadow:0 25px 50px rgba(0,0,0,0.25); animation:bb-modal-in 200ms ease-out; }',
      '.bb-modal-header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--color-border,#e5e7eb); }',
      '.bb-modal-header h2 { margin:0; font-size:20px; font-weight:600; color:var(--color-text-primary,#111827); font-family:var(--font-campaign,Inter,system-ui,-apple-system,sans-serif); }',
      '.bb-modal-close { background:none; border:none; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1; color:var(--color-text-secondary,#6b7280); border-radius:6px; transition:all 100ms ease; }',
      '.bb-modal-close:hover { background:var(--color-bg-tertiary,#f3f4f6); color:var(--color-text-primary,#111827); }',
      '.bb-modal-body { padding:16px; }',
      '.bb-modal-body .sbx { border-left:0; border-right:0; border-bottom:0; border-radius:0; padding:0; }',
      '.bb-modal-actions { padding:12px 20px; border-top:1px solid var(--color-border,#e5e7eb); display:flex; gap:8px; }',
      // ── Empty & loading states ──
      '.bb-empty { text-align:center; padding:48px 16px; }',
      '.bb-empty-icon { width:48px; height:48px; border-radius:9999px; background:var(--color-bg-tertiary,#f3f4f6); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px; font-size:20px; color:var(--color-text-muted,#9ca3af); }',
      '.bb-empty-title { font-size:18px; font-weight:600; color:var(--color-text-primary,#111827); margin:0 0 4px; }',
      '.bb-empty-desc { font-size:14px; color:var(--color-text-secondary,#6b7280); max-width:24rem; margin:0 auto; }',
      '.bb-loading { text-align:center; padding:48px 16px; color:var(--color-text-secondary,#6b7280); }',
      '@keyframes bb-shimmer { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }',
      '.bb-skeleton { border-radius:12px; background:linear-gradient(90deg,var(--color-bg-tertiary,#f3f4f6) 25%,var(--color-border-light,#f3f4f6) 50%,var(--color-bg-tertiary,#f3f4f6) 75%); background-size:200% 100%; animation:bb-shimmer 1.5s ease-in-out infinite; }',
      '.bb-skeleton-card { height:140px; border-radius:12px; }',
      // ── Statblock styles (for modal) ──
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
      if (this.state.creatures.length === 0) {
        grid.innerHTML = '<div class="bb-empty">' +
          '<div class="bb-empty-icon">&#128026;</div>' +
          '<div class="bb-empty-title">No creatures loaded</div>' +
          '<div class="bb-empty-desc">Add creatures to your campaign or switch to the community bestiary.</div>' +
          '</div>';
      } else {
        grid.innerHTML = '<div class="bb-empty">' +
          '<div class="bb-empty-icon">&#128269;</div>' +
          '<div class="bb-empty-title">No matches</div>' +
          '<div class="bb-empty-desc">No creatures match your current filters. Try adjusting or clearing them.</div>' +
          '</div>';
      }
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

    var accent = '<div class="bb-card-accent" style="background:' + this._getOrgColor(creature.organization) + '"></div>';

    var header = '<div class="bb-card-header">' +
      '<span class="bb-card-name">' + h(creature.name) + '</span>' +
      '<span class="bb-card-level">L' + (Number(creature.level) || 0) + '</span></div>';

    // C-1 (client half): organization/role come from unsanitized publication /
    // custom-field data — escape them (element content) before rendering. The
    // numeric fields are Number()-coerced here too, defence in depth against a
    // publication JSON that carries strings where numbers are expected.
    var subtitle = '<div class="bb-card-subtitle">';
    if (creature.organization) subtitle += h(this._capitalize(creature.organization)) + ' ';
    if (creature.role) subtitle += h(this._capitalize(creature.role));
    if (creature.ev) subtitle += ' &middot; EV ' + (Number(creature.ev) || 0);
    subtitle += '</div>';

    var tags = '';
    if (creature.keywords.length > 0) {
      tags = '<div class="bb-card-tags">' + creature.keywords.map(function (k) {
        return '<span class="bb-tag">' + h(k) + '</span>';
      }).join('') + '</div>';
    }

    var charSign = function (v) { v = Number(v) || 0; return v >= 0 ? '+' + v : '' + v; };
    var stats = '<div class="bb-card-stats">STM ' + (Number(creature.stamina) || 0) + ' &middot; SPD ' + (Number(creature.speed) || 0) + '</div>';
    var chars = '<div class="bb-card-chars">MGT ' + charSign(creature.might) +
      ' AGI ' + charSign(creature.agility) +
      ' RSN ' + charSign(creature.reason) +
      ' INT ' + charSign(creature.intuition) +
      ' PRS ' + charSign(creature.presence) + '</div>';

    // A bestiary summary has no figures yet, so the card shows how often it was
    // added and its rating rather than a row of zeros.
    var sum = creature._summary;
    if (sum) {
      stats = '<div class="bb-card-stats">' + (Number(sum.downloads) || 0) + ' added &middot; rated ' +
        (Number(sum.rating_average) || 0).toFixed(1) + ' (' + (Number(sum.rating_count) || 0) + ')</div>';
      chars = '';
    }

    card.innerHTML = accent + '<div class="bb-card-body">' + header + subtitle + tags + stats + chars + '</div>';
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

  // _openModal shows a creature. A bestiary summary first fetches its full
  // stat block, so the modal and Add work from the real figures and abilities.
  _openModal: function (creature) {
    var self = this;
    if (creature._slug && !creature._full) {
      Chronicle.apiFetch('/bestiary/' + encodeURIComponent(creature._slug) + '/statblock')
        .then(function (r) {
          if (!r.ok) throw new Error('statblock -> ' + r.status);
          return r.json();
        })
        .then(function (sb) {
          var full = self._normalizeEntity({ name: creature.name, custom_fields: sb || {} });
          full.id = '';
          full._slug = creature._slug;
          full._summary = creature._summary;
          full._full = true;
          self._openModal(full);
        })
        .catch(function (err) {
          if (typeof console !== 'undefined') console.warn('Bestiary Browser: stat block fetch failed', err);
          alert('Could not load this creature’s stat block. Please try again.');
        });
      return;
    }
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
    var isOwnedEntity = !!(creature.id && self.config.campaignId && self.state.source === 'campaign');
    var editable = self.config.editable !== false;

    if (isOwnedEntity && editable) {
      // Edit button — links to entity page
      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-primary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () {
        window.location.href = '/campaigns/' + self.config.campaignId + '/entities/' + creature.id;
      });
      actions.appendChild(editBtn);
    } else if (!isOwnedEntity) {
      // Import button — for bestiary creatures not yet in campaign
      var importBtn = document.createElement('button');
      importBtn.className = 'btn btn-primary';
      importBtn.textContent = 'Add to this campaign';
      importBtn.addEventListener('click', function () {
        if (!self.config.campaignId) { alert('No campaign selected.'); return; }
        // CreateEntity binds {name, entity_type_id, fields_data} and rejects a
        // zero entity_type_id outright; `preset`/`custom_fields` are not read.
        // The source creature is another user's published bestiary entry, so
        // bound its fields before writing them into this campaign.
        var bounded = self._boundCreatureFields(creature);
        var typeId = self._creatureTypeId;
        var url = self._entityUrl(self.config.campaignId);
        var start = typeId
          ? Promise.resolve(typeId)
          : self._resolveCreatureTypeId().then(function (id) { self._creatureTypeId = id; return id; });
        start.then(function (id) {
          if (!id) throw new Error('The Draw Steel "Creature" entity type is not installed in this campaign.');
          // The shared stat block's field writer keeps an unset figure unset
          // instead of writing a 0, and caps every list.
          var S = (typeof DrawSteelStatblock !== 'undefined') ? DrawSteelStatblock : null;
          var fields = S ? S.toFields(S.normalize(creature._raw || creature)) : self._toFieldsData(bounded);
          var payload = { name: bounded.name, entity_type_id: id, type_label: 'drawsteel-creature', fields_data: fields };
          return Chronicle.apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        })
          .then(function (res) {
            if (!res.ok) {
              return self._apiError(res, 'Could not import this creature. Please try again.').then(function (msg) {
                var e = new Error(msg); e.fromServer = true; throw e;
              });
            }
            importBtn.textContent = 'Added'; importBtn.disabled = true;
          })
          .catch(function (err) {
            // A server-sourced message is never shown verbatim — only a
            // fixed, safe string reaches the user; the real error stays in
            // the console for diagnostics. A message this widget generated
            // itself (e.g. the entity type isn't installed) is safe and
            // still useful to show.
            if (typeof console !== 'undefined') console.warn('Bestiary Browser: import failed', err);
            alert((err && !err.fromServer && err.message) ? err.message : 'Could not import this creature. Please try again.');
          });
      });
      actions.appendChild(importBtn);
    }

    var exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-secondary';
    exportBtn.textContent = 'Export JSON';
    exportBtn.addEventListener('click', function () {
      var out = {};
      for (var k in creature) { if (creature.hasOwnProperty(k) && k.charAt(0) !== '_') out[k] = creature[k]; }
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (creature.name || 'creature').replace(/[^a-z0-9]/gi, '_') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    actions.appendChild(exportBtn);

    if (isOwnedEntity && editable) {
      // Delete button
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.cssText = 'margin-left:auto;';
      deleteBtn.addEventListener('click', function () {
        if (!confirm('Delete "' + creature.name + '"? This cannot be undone.')) return;
        var url = self._entityUrl(self.config.campaignId, creature.id);
        Chronicle.apiFetch(url, { method: 'DELETE' })
          .then(function (res) {
            if (res && res.ok === false) {
              return self._apiError(res, 'Could not delete this creature. Please try again.').then(function (msg) {
                var e = new Error(msg); e.fromServer = true; throw e;
              });
            }
            self.state.creatures = self.state.creatures.filter(function (c) { return c.id !== creature.id; });
            self._closeModal();
            self._applyFilters();
            self._renderGrid();
            self._renderCount();
            self._renderPagination();
          })
          .catch(function (err) {
            // Server-sourced text is never shown verbatim; see the import
            // handler above for why a client-generated message still is.
            if (typeof console !== 'undefined') console.warn('Bestiary Browser: delete failed', err);
            alert((err && !err.fromServer && err.message) ? err.message : 'Could not delete this creature. Please try again.');
          });
      });
      actions.appendChild(deleteBtn);
    }

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

  // The modal draws the same stat block as a creature's own page, from
  // DrawSteelStatblock (statblock-renderer.js), looked up now because widget
  // scripts load in manifest order.
  _buildStatblockHtml: function (creature) {
    var S = (typeof DrawSteelStatblock !== 'undefined') ? DrawSteelStatblock : null;
    if (!S) return '<p class="bb-modal-fallback">The stat block could not be drawn. Reload the page to try again.</p>';
    S.injectStyles(document);
    var src = creature._raw || creature;
    return S.html(creature.name, src, { ref: this._ref });
  }
});
