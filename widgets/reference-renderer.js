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
    // Campaign-scoped is the only shape Chronicle actually serves (SystemDataAPI);
    // basePath is a fallback for a host serving the package statically. With
    // neither, there is no source and the catch below leaves an empty glossary.
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
        // Degrade this instance only; don't cache {} into _glossaryCache, or one
        // transient fetch failure freezes every later renderer with no retry.
        self._glossary = {};
        self._loaded = true;
      });
  };

  // Looks up a glossary entry by slug/term (case-insensitive), for attaching a
  // tooltip to a bare term not wrapped in {@…} syntax. Null until loaded.
  RefRenderer.prototype.getEntry = function (termId) {
    if (!this._glossary || termId == null) return null;
    return this._glossary[String(termId).toLowerCase().trim()] || null;
  };

  // Wraps bare condition terms found in already-escaped plain text (for synced
  // Foundry prose with no {@…} markup) — conditions only, whole-word, first
  // occurrence of each. Caller must guarantee no existing ds-ref spans in the
  // input, or a match could land inside a tooltip attribute. Keywords are
  // handled separately via badges and are not scanned here.
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
        // Function replacer so a `$`-sequence in t.def or the matched term is
        // literal, not a String.replace pattern ($1, $&, $`, $').
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
      // displayOverride is already-escaped (renderText's input contract); entry.name
      // comes from glossary data (untrusted) and must be escaped before use as HTML.
      var label = displayOverride || _escHtml(entry.name);
      var tip = entry.description || '';
      tip = tip.replace(/"/g, '&quot;');
      return '<span class="ds-ref ds-ref--' + _safeClass(category) + '"' +
        ' data-ref-id="' + _safeAttr(entry.slug || entry.id || termId) + '"' +
        ' data-ref-tip="' + tip + '">' +
        label + '</span>';
    });
  };

  // Resolves every {@category term} reference inside an already-rendered DOM
  // element, in place. No-op until the glossary has loaded, so a failed load
  // degrades to plain tokens rather than throwing.
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

  // Escapes a string for HTML element content (& < > only, matches
  // Chronicle.escapeHtml). Self-contained so it works without the Chronicle
  // global and is testable from Node. Glossary entry.name is untrusted
  // (attacker-controlled systems-data) and must go through this before use as HTML.
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
