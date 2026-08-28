/**
 * Draw Steel Reference Renderer
 * Resolves {@category term} references in text to styled tooltip spans.
 * Compatible with Chronicle.escapeHtml() — parse AFTER escaping.
 *
 * Usage in widgets:
 *   var ref = new DrawSteelRefRenderer(basePath, campaignId);
 *   ref.load().then(function () {
 *     var html = ref.renderText(Chronicle.escapeHtml(someText));
 *   });
 *
 * Future: Chronicle platform text_renderers integration via entry_point.
 */
/* global Chronicle */
var DrawSteelRefRenderer = (function () {
  'use strict';

  var REF_PATTERN = /\{@(\w+)\s+([^|}]+)(?:\|([^}]+))?\}/g;
  var _glossaryCache = null;
  var _stylesInjected = false;

  function RefRenderer(basePath, campaignId) {
    this._basePath = basePath || '';
    this._campaignId = campaignId || '';
    this._glossary = null;
    this._loaded = false;
  }

  RefRenderer.prototype.load = function () {
    var self = this;
    if (_glossaryCache) {
      self._glossary = _glossaryCache;
      self._loaded = true;
      return Promise.resolve();
    }
    // Campaign-scoped is the only shape Chronicle actually serves. The
    // basePath fallback survives for a host that serves the package's files
    // statically, but callers in this repo now pass '' — the URL they used to
    // pass ('/api/v1/campaigns/:id/extensions/drawsteel/assets/') was never a
    // Chronicle route, and the extension-asset route that does exist refuses
    // .json. Without a campaign id and without a real basePath there is no
    // source, and the catch below leaves an empty glossary rather than
    // pretending otherwise.
    var url = this._campaignId
      ? '/campaigns/' + encodeURIComponent(this._campaignId) + '/systems/drawsteel/rules-glossary'
      : (this._basePath ? this._basePath + 'data/rules-glossary.json' : '');
    if (!url) {
      self._glossary = {};
      self._loaded = true;
      return Promise.resolve();
    }
    var fetchFn = this._campaignId && typeof Chronicle !== 'undefined' && Chronicle.apiFetch
      ? Chronicle.apiFetch
      : fetch;
    return fetchFn(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var map = {};
        var entries = Array.isArray(data) ? data : (data.results || data.entries || []);
        for (var i = 0; i < entries.length; i++) {
          map[entries[i].slug || entries[i].id] = entries[i];
        }
        _glossaryCache = map;
        self._glossary = map;
        self._loaded = true;
      })
      .catch(function () {
        // Degrade THIS instance, but do not poison the module cache: caching
        // {} here made one transient failure (a network blip, a 503) freeze
        // every later renderer on the page into an empty glossary for the
        // rest of its life, with no retry path.
        self._glossary = {};
        self._loaded = true;
      });
  };

  // getEntry looks up a glossary entry by slug/term (case-insensitive). Used to
  // attach a definition tooltip to a bare term (e.g. an ability keyword badge)
  // that isn't wrapped in {@…} syntax. Returns null until the glossary loads.
  RefRenderer.prototype.getEntry = function (termId) {
    if (!this._glossary || termId == null) return null;
    return this._glossary[String(termId).toLowerCase().trim()] || null;
  };

  // scanText wraps BARE rule terms (DS conditions) found in already-escaped PLAIN
  // text — for synced Foundry prose that has no {@…} markup of its own. Conservative
  // by design: conditions only (unambiguous), whole-word, first occurrence of each.
  // MUST be given plain escaped text with no existing ds-ref spans (else it could
  // match inside a tooltip attribute) — the caller guarantees this for cleaned
  // synced text. Keywords are handled separately via keyword badges, so they are
  // NOT scanned here (too common in prose).
  RefRenderer.prototype.scanText = function (escapedHtml) {
    if (!this._loaded || !escapedHtml || !this._glossary) return escapedHtml || '';
    if (!this._scanList) {
      var list = [];
      for (var slug in this._glossary) {
        if (!Object.prototype.hasOwnProperty.call(this._glossary, slug)) continue;
        var e = this._glossary[slug];
        var cat = (e.properties && e.properties.category) || e.category || '';
        if (cat === 'condition') list.push({ name: e.name || slug, slug: slug, cat: cat, def: e.description || '' });
      }
      list.sort(function (a, b) { return b.name.length - a.name.length; });
      this._scanList = list;
    }
    var html = escapedHtml;
    this._scanList.forEach(function (t) {
      var re = new RegExp('\\b(' + t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'i');
      if (re.test(html)) {
        // L-5: use a function replacer so a `$`-sequence in the glossary
        // description (t.def) or in the matched term is treated literally, not
        // as a String.replace replacement pattern ($1, $&, $`, $').
        html = html.replace(re, function (m, g1) {
          return '<span class="ds-ref ds-ref--' + _safeClass(t.cat) + '"' +
            ' data-ref-tip="' + String(t.def).replace(/"/g, '&quot;') + '">' + g1 + '</span>';
        });
      }
    });
    return html;
  };

  RefRenderer.prototype.renderText = function (escapedHtml) {
    if (!this._loaded || !escapedHtml) return escapedHtml || '';
    var glossary = this._glossary;

    return escapedHtml.replace(REF_PATTERN, function (match, category, termId, displayOverride) {
      termId = termId.trim();
      var entry = glossary[termId];
      if (!entry) {
        var displayName = displayOverride || termId;
        return '<span class="ds-ref ds-ref--unknown">' + displayName + '</span>';
      }
      // H-6: displayOverride comes from the caller's ALREADY-escaped input text
      // (renderText's contract), so it is safe as-is; entry.name comes from the
      // glossary data (untrusted) and must be escaped before it becomes HTML.
      var label = displayOverride || _escHtml(entry.name);
      var tip = entry.description || '';
      tip = tip.replace(/"/g, '&quot;');
      return '<span class="ds-ref ds-ref--' + _safeClass(category) + '"' +
        ' data-ref-id="' + _safeAttr(entry.slug || entry.id || termId) + '"' +
        ' data-ref-tip="' + tip + '">' +
        label + '</span>';
    });
  };

  // applyToContainer resolves every {@category term} reference inside an
  // already-rendered DOM element, in place, swapping the tokens for ref spans.
  // Callers (e.g. the character sheet) build escaped HTML, insert it, then call
  // this to light up references. Guarded: a no-op until the glossary has loaded
  // (and renderText itself re-checks _loaded), so a failed load degrades to
  // plain tokens rather than throwing.
  RefRenderer.prototype.applyToContainer = function (el) {
    if (!el || !this._loaded) return;
    el.innerHTML = this.renderText(el.innerHTML);
  };

  function _safeClass(str) {
    return str.replace(/[^a-z0-9-]/g, '');
  }

  function _safeAttr(str) {
    return str.replace(/[^a-z0-9_-]/g, '');
  }

  // _escHtml escapes a string for safe insertion into HTML *element content*
  // (matches Chronicle.escapeHtml: escapes & < > only). Kept self-contained so
  // the renderer can escape untrusted glossary values without depending on the
  // platform Chronicle global (and so the Node tests can exercise it directly).
  // H-6: the resolved glossary label (entry.name) is attacker-influenceable
  // (a malicious package / systems-data glossary entry) and must be escaped.
  function _escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  RefRenderer.prototype.injectStyles = function () {
    if (_stylesInjected) return;
    _stylesInjected = true;

    var css = '' +
      '.ds-ref {' +
      '  border-bottom: 1px dotted currentColor;' +
      '  cursor: help;' +
      '  position: relative;' +
      '  font-weight: 600;' +
      '}' +
      '.ds-ref--condition { color: #b91c1c; }' +
      '.ds-ref--movement { color: #0369a1; }' +
      '.ds-ref--duration { color: #6d28d9; }' +
      '.ds-ref--resource { color: #047857; }' +
      '.ds-ref--action { color: #c2410c; }' +
      '.ds-ref--combat { color: #4338ca; }' +
      '.ds-ref--unknown { color: #71717a; font-style: italic; }' +
      '.ds-ref:hover::after {' +
      '  content: attr(data-ref-tip);' +
      '  position: absolute;' +
      '  bottom: 100%;' +
      '  left: 50%;' +
      '  transform: translateX(-50%);' +
      '  background: #1e293b;' +
      '  color: #f1f5f9;' +
      '  padding: 6px 10px;' +
      '  border-radius: 6px;' +
      '  font-size: 12px;' +
      '  font-weight: 400;' +
      '  line-height: 1.4;' +
      '  white-space: normal;' +
      '  width: max-content;' +
      '  max-width: 280px;' +
      '  z-index: 9999;' +
      '  pointer-events: none;' +
      '  box-shadow: 0 2px 8px rgba(0,0,0,0.25);' +
      '  margin-bottom: 4px;' +
      '}';

    var style = document.createElement('style');
    style.setAttribute('data-ds-ref', 'true');
    style.textContent = css;
    document.head.appendChild(style);
  };

  return RefRenderer;
})();

// Test seam: expose the constructor for Node unit tests. Inert in a browser
// (no CommonJS `module`), so the widget's runtime behavior is unchanged.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrawSteelRefRenderer;
}
