/**
 * Shared Node test harness for the register-pattern widgets (statblock-renderer,
 * bestiary-browser, monster-builder). These widgets call Chronicle.register at
 * module load and build HTML into DOM nodes, so testing them off-browser needs a
 * minimal `document`/`Chronicle` shim. Used by the DS-SEC-FIXES-R1 XSS
 * regression tests. No jsdom dependency — just enough surface for the render
 * paths under test (innerHTML assignment, createElement, insertBefore, etc.).
 */

// A tiny DOM element stand-in: records innerHTML/textContent so tests can assert
// on what the widget produced.
export function makeEl() {
  return {
    innerHTML: '', textContent: '', className: '', value: '',
    style: {}, dataset: {}, firstChild: null, children: [],
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    scrollIntoView() {}, focus() {}, click() {}, closest() { return null; }
  };
}

export function installDom() {
  if (!globalThis.document) {
    globalThis.document = {
      createElement() { return makeEl(); },
      createElementNS() { return makeEl(); },
      createTextNode(t) { return { textContent: t }; },
      head: makeEl(), body: makeEl(),
      getElementById() { return null; }, querySelector() { return null; }
    };
  }
  if (!globalThis.navigator) globalThis.navigator = {};
}

// Chronicle.escapeHtml (element content: escapes & < > only) and escapeAttr
// (attributes: also escapes " ') — byte-for-byte the boot.js implementations.
export function makeChronicle() {
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const registry = {};
  const Chronicle = {
    registry,
    register(slug, def) { registry[slug] = def; },
    escapeHtml, escapeAttr,
    apiFetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
  };
  return Chronicle;
}

// Identity reference renderer (input to renderText is already escaped by the
// caller in the widgets, so identity is faithful for these tests).
export function FakeRef() {}
FakeRef.prototype.load = function () { return Promise.resolve(); };
FakeRef.prototype.renderText = function (s) { return s; };
FakeRef.prototype.scanText = function (s) { return s; };
FakeRef.prototype.getEntry = function () { return null; };
FakeRef.prototype.injectStyles = function () {};

// Assert a rendered HTML string carries no executable injection: no raw tag that
// would run (img/script/svg/iframe) and no unquoted event-handler breakout.
export function assertNoInjection(assert, html, label) {
  assert.ok(!/<img/i.test(html), (label || '') + ': raw <img must not appear');
  assert.ok(!/<script/i.test(html), (label || '') + ': raw <script must not appear');
  assert.ok(!/<svg/i.test(html), (label || '') + ': raw <svg must not appear');
  // An event handler is only dangerous if it sits OUTSIDE a quoted attr value,
  // i.e. a bare `" onerror=` breakout. Escaped quotes (&quot;) cannot break out.
  assert.ok(!/"\s+on\w+=/i.test(html), (label || '') + ': attribute breakout (" on...=) must not appear');
}
