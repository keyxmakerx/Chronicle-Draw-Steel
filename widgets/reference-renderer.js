/**
 * Draw Steel Reference Renderer
 * Resolves {@category term} references in text to styled tooltip spans.
 * Compatible with Chronicle.escapeHtml() — parse AFTER escaping.
 *
 * Usage in widgets:
 *   var ref = new DrawSteelRefRenderer(basePath);
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

  function RefRenderer(basePath) {
    this._basePath = basePath || '';
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
    var url = self._basePath + 'data/rules-glossary.json';
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var map = {};
        var entries = data.entries || [];
        for (var i = 0; i < entries.length; i++) {
          map[entries[i].id] = entries[i];
        }
        _glossaryCache = map;
        self._glossary = map;
        self._loaded = true;
      })
      .catch(function () {
        _glossaryCache = {};
        self._glossary = {};
        self._loaded = true;
      });
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
      var label = displayOverride || entry.name;
      var tip = entry.description || '';
      tip = tip.replace(/"/g, '&quot;');
      return '<span class="ds-ref ds-ref--' + _safeClass(category) + '"' +
        ' data-ref-id="' + _safeAttr(entry.id) + '"' +
        ' data-ref-tip="' + tip + '">' +
        label + '</span>';
    });
  };

  function _safeClass(str) {
    return str.replace(/[^a-z0-9-]/g, '');
  }

  function _safeAttr(str) {
    return str.replace(/[^a-z0-9_-]/g, '');
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
