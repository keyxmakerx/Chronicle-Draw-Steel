/**
 * The Lich's Lair card is the closed pop-up book: opening it lifts the book
 * off the card onto the board's own closed book, and closing shuts the book
 * and flies it home. These tests drive the fold engine's real mount() over a
 * tiny fake DOM shaped like the card buildLair renders, and step its film by
 * finishing the animations it starts. Pinned here: the open and closed
 * state of the card, the token's pinning, where it lands, the shut handshake,
 * focus, and the reduced-motion path.
 *
 * Run: `node --test tools/test-rulebook-lair-book.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
global.Chronicle = { register() {}, escapeHtml: (s) => String(s) };
const F = require('../widgets/rulebook-frontpage.js');
const E = require('../widgets/rulebook-fold-engine.js');

// ── a fake DOM, just enough for the engine ──────────────────────────────────
let ANIMS = [];
function classList(el) {
  const set = new Set();
  return { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c), has: set };
}
function matchOne(el, compound) {
  const parts = compound.match(/(\.[\w-]+|\[[^\]]+\]|^[a-z]+)/g) || [];
  return parts.every((p) => {
    if (p[0] === '.') return el.classList.contains(p.slice(1));
    if (p[0] === '[') {
      const m = p.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
      if (!m) return false;
      const v = el.getAttribute(m[1]);
      return m[2] === undefined ? v != null : v === m[2];
    }
    return el.tagName.toLowerCase() === p;
  });
}
function matches(el, sel) {
  return sel.split(',').some((alt) => {
    const chain = alt.trim().split(/\s+/);
    if (!matchOne(el, chain[chain.length - 1])) return false;
    let node = el.parentNode, i = chain.length - 2;
    while (i >= 0 && node && node.nodeType === 1) { if (matchOne(node, chain[i])) i--; node = node.parentNode; }
    return i < 0;
  });
}
function el(tag, attrs, kids, rect) {
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), attrs: { ...(attrs || {}) }, children: [], parentNode: null,
    style: {}, listeners: {}, rect: rect || { left: 0, top: 0, width: 0, height: 0 }, computed: {},
    getAttribute(k) { return k === 'class' ? null : (k in this.attrs ? this.attrs[k] : null); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    hasAttribute(k) { return k in this.attrs; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    dispatch(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev })); },
    contains(o) { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; },
    querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); }); walk(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    getBoundingClientRect() { const r = this.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height }; },
    getClientRects() { return [this.rect]; },
    get offsetWidth() { return this.rect.width; }, get offsetHeight() { return this.rect.height; },
    get id() { return this.attrs.id || ''; },
    focus(o) { DOC.activeElement = this; this.focusOpts = o; },
    animate(kf, opts) {
      const a = { el: this, kf, opts, playState: 'running', playbackRate: 1, onfinish: null,
        reverse() { this.playbackRate *= -1; this.playState = 'running'; }, play() { this.playState = 'running'; },
        cancel() { this.playState = 'idle'; } };
      ANIMS.push(a);
      return a;
    },
  };
  e.classList = classList(e);
  String((attrs && attrs.class) || '').split(/\s+/).filter(Boolean).forEach((c) => e.classList.add(c));
  (kids || []).forEach((k) => { k.parentNode = e; e.children.push(k); });
  return e;
}
const DOC = { activeElement: null, body: null, listeners: {}, documentElement: { clientWidth: 1440, clientHeight: 900 },
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
  removeEventListener() {},
  key(k) { (this.listeners.keydown || []).forEach((fn) => fn({ key: k, target: DOC.activeElement, preventDefault() {}, stopPropagation() {} })); } };
DOC.scrollingElement = DOC.documentElement;
let REDUCED = false;
global.window = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {},
  setTimeout: (fn) => 0, clearTimeout() {},
  matchMedia: () => ({ matches: REDUCED }), getComputedStyle: (e) => ({ transform: e.computed.transform || 'none', visibility: 'visible' }) };

// finish runs the film to its end: each step's animations finish in turn.
function finish() {
  for (let guard = 0; guard < 50; guard++) {
    const live = ANIMS.filter((a) => a.playState === 'running' && a.onfinish);
    if (!live.length) return;
    live.forEach((a) => { a.playState = 'finished'; const f = a.onfinish; a.onfinish = null; f(); });
  }
}

// ── the card, shaped like buildLair's markup ────────────────────────────────
const SCENE = { name: "The Lich's Lair", description: 'd',
  properties: { kind: 'worked-scene', emoji: '🏰', kicker: 'WORKED SCENE', kickerNo: '4',
    parts: [{ slug: 'p1', name: 'Into the lair', play: 'into-the-lair' }] } };
const HTML = F.buildLair(SCENE);
const attr = (name) => (HTML.match(new RegExp(name + '="([^"]*)"')) || [])[1];

// mount builds a fresh card; `twin` false leaves the board with no scene.
function mount(opts) {
  const o = { twin: true, ...(opts || {}) };
  ANIMS = [];
  const tilt = el('div', { class: 'rb-bkspread', 'data-rb-sheet-tilt': '' }, [el('div', { 'data-rb-sheet-fade': '' })]);
  tilt.computed.transform = 'matrix3d(card)';
  const token = el('div', { class: 'rb-bk', 'data-rb-sheet-token': '' }, [tilt], { left: 870, top: 370, width: 350, height: 180 });
  const spread = el('div', { class: 'rbs-spread' });
  spread.computed.transform = 'matrix3d(scene)';
  const fit = el('div', { class: 'rbs-fit' }, [spread], { left: 400, top: 200, width: 700, height: 360 });
  const script = el('div', { class: o.twin ? 'rbx-script rbx-on' : 'rbx-script' }, [fit]);
  const close = el('button', { 'data-rb-close-wing': '' });
  const body = el('div', { 'data-rb-sheet-body': '' }, [script]);
  const panel = el('div', { class: 'rb-wing', role: 'dialog' }, [el('div', {}, [close]), body], { left: 340, top: 130, width: 760, height: 640 });
  const host = el('div', { class: 'rb-blk rb-lair', id: 't-lair', 'data-rb-block': '', 'data-rb-wing': '',
    'data-rb-wing-mode': attr('data-rb-wing-mode'), 'data-rb-sheet-land': attr('data-rb-sheet-land'),
    'data-rb-sheet-land-tilt': attr('data-rb-sheet-land-tilt') }, [el('div', { class: 'rb-lairface' }, [token]), panel],
  { left: 845, top: 327, width: 427, height: 246 });
  const root = el('div', { class: 'rb-root' }, [host]);
  root.ownerDocument = DOC;
  DOC.activeElement = null;
  const calls = [];
  const api = E.mount(root, {
    onOpen: (k, id) => calls.push('open:' + id), onSettle: (k, id) => calls.push('settle:' + id),
    onClose: (k) => calls.push('close:' + k), onShut: (k, id) => { calls.push('shut:' + id); return o.shutMs || 0; } });
  return { root, host, token, tilt, panel, close, calls, api };
}
const tokenAnims = (c) => ANIMS.filter((a) => a.el === c.token);

test('the card names a twin the engine can find, and is a sheet', () => {
  assert.equal(attr('data-rb-wing-mode'), 'sheet');
  assert.equal(attr('data-rb-sheet-land'), '.rbx-on .rbs-fit');
  assert.equal(attr('data-rb-sheet-land-tilt'), '.rbs-spread');
});

test('opening: the book is pinned where it lies, lifts, then travels onto the board book', () => {
  REDUCED = false;
  const c = mount();
  c.host.dispatch('click');
  assert.ok(c.host.classList.contains('is-open'));
  assert.equal(c.host.getAttribute('aria-expanded'), 'true');
  assert.equal(c.token.style.position, 'fixed', 'pinned, so no scrolling ancestor clips the flight');
  assert.equal(c.token.style.left, '870px');
  assert.equal(c.token.style.top, '370px');
  assert.deepEqual(tokenAnims(c).map((a) => a.kf[1].transform), ['translate(0px,-8px) scale(1)'], 'first it lifts');
  assert.ok(!c.root.classList.contains('rb-lair-open'), 'the page is not veiled until it travels');
  // finish the lift: the travel starts
  ANIMS.filter((a) => a.onfinish).forEach((a) => { a.playState = 'finished'; const f = a.onfinish; a.onfinish = null; f(); });
  assert.ok(c.root.classList.contains('rb-lair-open'));
  const travel = tokenAnims(c)[1];
  assert.equal(travel.kf[1].transform, 'translate(-470px,-170px) scale(2)', 'lands exactly on the board book');
  const tilt = ANIMS.find((a) => a.el === c.tilt);
  assert.deepEqual(tilt.kf.map((k) => k.transform), ['matrix3d(card)', 'matrix3d(scene)'], 'eases into the scene book\'s tilt');
  const fade = ANIMS.find((a) => a.el.attrs['data-rb-sheet-fade'] != null);
  assert.deepEqual(fade.kf.map((k) => k.opacity), [1, 0], 'the card-only page edge fades on the way');
  finish();
  assert.ok(c.host.classList.contains('rb-sheet-away'), 'one book: the card keeps an empty slot');
  assert.equal(c.token.style.position, '', 'unpinned once it has handed over');
  assert.deepEqual(c.calls, ['open:t-lair', 'settle:t-lair']);
  assert.equal(DOC.activeElement, c.close, 'focus is inside the board');
  assert.deepEqual(c.close.focusOpts, { preventScroll: true });
  c.api.destroy();
});

test('closing: the board shuts its book first, then the book flies home and focus returns', () => {
  REDUCED = false;
  const c = mount({ shutMs: 640 });
  c.host.dispatch('click');
  finish();
  c.calls.length = 0;
  ANIMS = [];
  DOC.key('Escape');
  assert.deepEqual(c.calls, ['shut:t-lair'], 'the board is asked to put its book away');
  assert.equal(ANIMS[0].opts.duration, 640, 'and the film waits that long');
  assert.ok(c.host.classList.contains('is-open'), 'still open while the book shuts');
  assert.equal(c.token.style.position, 'fixed', 'pinned at the card again for the way back');
  finish();
  assert.ok(!c.host.classList.contains('is-open'));
  assert.ok(!c.host.classList.contains('rb-sheet-away'));
  assert.ok(!c.root.classList.contains('rb-lair-open'));
  assert.equal(c.token.style.position, '');
  assert.equal(c.host.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(c.calls, ['shut:t-lair', 'close:wing']);
  assert.equal(DOC.activeElement, c.host, 'focus returns to the card');
  assert.deepEqual(c.host.focusOpts, { preventScroll: true }, 'without scrolling the page');
  c.api.destroy();
});

test('no book on the board: the book heads for the middle and fades, and the board still opens', () => {
  REDUCED = false;
  const c = mount({ twin: false });
  c.host.dispatch('click');
  ANIMS.filter((a) => a.onfinish).forEach((a) => { a.playState = 'finished'; const f = a.onfinish; a.onfinish = null; f(); });
  const travel = tokenAnims(c)[1];
  assert.equal(travel.kf[1].opacity, 0);
  assert.match(travel.kf[1].transform, /scale\(1\)$/);
  finish();
  assert.deepEqual(c.calls, ['open:t-lair', 'settle:t-lair']);
  c.api.destroy();
});

test('reduced motion: the board simply appears and goes; the book never moves', () => {
  REDUCED = true;
  const c = mount({ shutMs: 640 });
  c.host.dispatch('click');
  assert.equal(c.token.style.position, undefined, 'never pinned');
  assert.equal(tokenAnims(c).length, 0);
  finish();
  assert.ok(c.host.classList.contains('is-open'));
  assert.ok(!c.host.classList.contains('rb-sheet-away'), 'the book stays on its card');
  DOC.key('Escape');
  finish();
  assert.ok(!c.host.classList.contains('is-open'));
  assert.ok(!c.calls.includes('shut:t-lair'), 'nothing to wait for');
  assert.equal(DOC.activeElement, c.host);
  c.api.destroy();
  REDUCED = false;
});
