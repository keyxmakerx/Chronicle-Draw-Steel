#!/usr/bin/env node
/**
 * The stat block's fold-out (DrawSteelStatblock.foldOut). On a computer with
 * room the editor docks beside the page, which narrows, so the stat block it
 * edits stays in view and follows each change; otherwise it grows out of the
 * page panel into a full-screen sheet and shrinks back into it. Both follow
 * the site's motion setting and never close over unsaved work without asking
 * through Chronicle's ask-in-place slip.
 *
 * Run: `node --test tools/test-statblock-foldout.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, assertNoInjection } from './_xss-harness.mjs';

const XSS = '<img src=x onerror=alert(1)>';

installDom();
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
const S = require('../widgets/statblock-renderer.js');

// A document just big enough for the fold-out: elements with children,
// listeners, a rect and a recording animate().
function fakeDoc(motion) {
  const listeners = {};
  const doc = {
    activeElement: null,
    documentElement: { getAttribute: (k) => (k === 'data-motion' ? motion || '' : null) },
    defaultView: {
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      matchMedia: () => ({ matches: motion === 'reduce' })
    },
    getElementById: () => null,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    fire(t, e) { (listeners[t] || []).slice().forEach((fn) => fn(e)); },
    listening: (t) => (listeners[t] || []).length
  };
  doc.createElement = () => el(doc);
  doc.head = el(doc);
  doc.body = el(doc);
  return doc;
}

function el(doc, rect) {
  const on = {};
  return {
    ownerDocument: doc, children: [], parentNode: null, attrs: {}, style: {}, anims: [], isConnected: true,
    rect: rect || { left: 0, top: 0, width: 1000, height: 800 },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    getBoundingClientRect() { return this.rect; },
    addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); },
    removeEventListener(t, fn) { on[t] = (on[t] || []).filter((f) => f !== fn); },
    click() { (on.click || []).slice().forEach((fn) => fn({})); },
    contains: () => false,
    querySelectorAll: () => [],
    focus() { doc.activeElement = this; },
    animate(frames, opts) { this.anims.push({ frames, opts }); return { finished: Promise.resolve() }; }
  };
}

function setup(motion, o) {
  const doc = fakeDoc(motion);
  const from = el(doc, { left: 100, top: 200, width: 500, height: 100 });
  const content = el(doc);
  const asked = [];
  const C = {
    reducedMotion: () => motion === 'reduce' || motion === 'calm',
    askSlip: Object.assign((box, opts) => asked.push({ box, opts }), { close() {} })
  };
  let left = 0;
  const fold = S.foldOut(from, content, Object.assign({ chronicle: C, label: 'Stat block for Gorrick', leave: () => { left++; } }, o));
  const layer = doc.body.children[0];
  return { doc, from, content, fold, layer, bg: layer && layer.children[0], panel: layer && layer.children[1], asked, left: () => left };
}

const esc = () => ({ key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test('the editor grows out of the panel into a sheet over the page', () => {
  const t = setup('');
  assert.ok(t.fold, 'it opens');
  assert.equal(t.layer.className, 'sbx-fold');
  assert.equal(t.panel.children[0], t.content, 'the editor sits in the sheet');
  assert.equal(t.panel.attrs.role, 'dialog');
  assert.equal(t.panel.attrs['aria-label'], 'Stat block for Gorrick');
  const first = t.panel.anims[0].frames[0];
  assert.equal(first.transform, 'translate(100px,200px) scale(0.5,0.125)', 'it starts on the panel’s spot');
  assert.equal(t.panel.anims[0].frames[1].transform, 'none');
  assert.equal(t.doc.activeElement, t.panel, 'focus moves into the sheet');
});

test('clicking off or Escape with nothing unsaved just leaves', () => {
  const t = setup('', { isDirty: () => false });
  t.bg.click();
  t.doc.fire('keydown', esc());
  assert.equal(t.left(), 2);
  assert.equal(t.asked.length, 0);
});

test('with unsaved work it asks in place and leaves only on Discard', () => {
  const t = setup('', { isDirty: () => true, detail: 'Your changes to Gorrick’s stat block haven’t been saved.' });
  t.doc.fire('keydown', esc());
  t.bg.click();
  assert.equal(t.left(), 0, 'nothing closes behind the person’s back');
  assert.equal(t.asked.length, 2);
  assert.equal(t.asked[0].box, t.panel, 'the slip comes out under the sheet');
  assert.match(t.asked[0].opts.ask, /Discard your changes/);
  assert.match(t.asked[0].opts.detail, /Gorrick/);
  t.asked[0].opts.onDiscard();
  assert.equal(t.left(), 1);
});

test('an Escape something inside already handled is left alone', () => {
  const t = setup('', { isDirty: () => false });
  t.doc.fire('keydown', { key: 'Escape', defaultPrevented: true, preventDefault() {} });
  assert.equal(t.left(), 0);
});

test('closing shrinks the sheet back into the panel, then takes it away', async () => {
  const t = setup('');
  t.doc.activeElement = null;
  t.fold.close();
  const shrink = t.panel.anims[1].frames;
  assert.equal(shrink[0].transform, 'none');
  assert.equal(shrink[1].transform, 'translate(100px,200px) scale(0.5,0.125)', 'it ends on the panel’s spot');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(t.doc.body.children.length, 0, 'the sheet is gone');
  assert.equal(t.doc.listening('keydown'), 0, 'Escape no longer reaches it');
  t.fold.close();
  assert.equal(t.panel.anims.length, 2, 'a second close does nothing');
});

test('Calm fades instead of growing, and Off simply appears and goes', () => {
  const calm = setup('calm');
  assert.equal(calm.panel.anims[0].frames[0].transform, undefined, 'no grow under Calm');
  assert.equal(calm.panel.anims[0].frames[0].opacity, 0);
  const off = setup('off');
  assert.equal(off.panel.anims.length, 0, 'no motion under Off');
  off.fold.close();
  assert.equal(off.doc.body.children.length, 0, 'it goes at once');
});

test('without a document to lay it over, it does not open', () => {
  assert.equal(S.foldOut({ ownerDocument: null }, {}, {}), null);
});

// ── Docked beside the page ──────────────────────────────────────────────────

// A page with Chronicle's column: #main-content inside its row, the stat block
// inside the column. mainW is the column's width; beside is room taken by
// pages open beside it.
function dockPage(motion, mainW, o) {
  o = o || {};
  const doc = fakeDoc(motion);
  const winOn = {};
  let mr = o.base || 0;
  doc.defaultView.getComputedStyle = (x) => ({ getPropertyValue: () => '', marginRight: x === main ? mr + 'px' : '0px' });
  doc.defaultView.addEventListener = (t, fn) => { (winOn[t] = winOn[t] || []).push(fn); };
  doc.defaultView.removeEventListener = (t, fn) => { winOn[t] = (winOn[t] || []).filter((f) => f !== fn); };
  doc.defaultView.setTimeout = () => 0;
  const row = el(doc, { left: 256, top: 97, right: 256 + mainW + (o.beside || 0) + mr, bottom: 900, width: mainW + (o.beside || 0) + mr, height: 803 });
  const main = el(doc, { left: 256, top: 97, right: 256 + mainW, bottom: 900, width: mainW, height: 803 });
  main.parentElement = row;
  const from = el(doc, { left: 292, top: 281, width: 400, height: 300 });
  main.contains = (x) => x === from;
  doc.getElementById = (id) => (id === 'main-content' ? main : null);
  const content = el(doc);
  const asked = [];
  const C = {
    reducedMotion: () => motion === 'reduce' || motion === 'calm',
    askSlip: Object.assign((box, opts) => asked.push({ box, opts }), { close() {} })
  };
  let left = 0;
  const fold = S.foldOut(from, content, Object.assign({ chronicle: C, label: 'Stat block for Gorrick', leave: () => { left++; } }, o.opts || {}));
  const panel = doc.body.children[0];
  return { doc, main, from, content, fold, panel, asked, left: () => left, resizes: () => (winOn.resize || []).length };
}

test('on a computer with room the editor docks beside the page, which narrows', () => {
  const t = dockPage('', 1184);
  assert.ok(t.fold && t.fold.docked, 'it docks');
  assert.equal(t.panel.className, 'sbx-dock');
  assert.equal(t.panel.children[0], t.content, 'the editor sits in the panel');
  assert.equal(t.panel.attrs.role, 'region', 'a side panel, not a dialog over the page');
  assert.equal(t.panel.attrs['aria-modal'], undefined);
  assert.equal(t.panel.attrs['aria-label'], 'Stat block for Gorrick');
  assert.equal(t.main.style.marginRight, '444px', 'the page keeps 740 pixels and the panel takes the rest');
  assert.equal(t.panel.style.width, '444px');
  assert.equal(t.panel.style.left, (256 + 1184 - 444) + 'px', 'it stands on the page column’s right-hand edge');
  assert.equal(t.panel.style.top, '97px', 'under Chronicle’s bar');
  assert.equal(t.panel.style.height, '803px');
  assert.equal(t.doc.activeElement, t.panel, 'focus moves into the panel');
  assert.equal(t.doc.body.children.length, 1, 'nothing dims the page');
});

test('the panel is never wider than 600 pixels, and with too little room it is the sheet', () => {
  assert.equal(dockPage('', 1664).panel.style.width, '600px');
  const narrow = dockPage('', 1110);
  assert.equal(narrow.fold.docked, false, 'a 1110-pixel column cannot keep 740 for the page beside a usable panel');
  assert.equal(narrow.panel.className, 'sbx-fold');
});

test('with pages open beside this one, the editor is the sheet rather than cover them', () => {
  const t = dockPage('', 1400, { beside: 740 });
  assert.equal(t.fold.docked, false);
  assert.equal(t.panel.className, 'sbx-fold');
});

test('room the notes already take on the right is kept, and the panel stands beside them', () => {
  const t = dockPage('', 1200, { base: 320 });
  assert.equal(t.main.style.marginRight, (320 + 460) + 'px');
  assert.equal(t.panel.style.left, (256 + 1200 - 460) + 'px');
});

test('docked, the panel slides out from behind the page edge as the page narrows', () => {
  const t = dockPage('', 1184);
  assert.deepEqual(t.panel.anims[0].frames, [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }]);
  assert.match(t.main.style.transition, /^margin-right 200ms/);
  const calm = dockPage('calm', 1184);
  assert.deepEqual(calm.panel.anims[0].frames, [{ opacity: 0 }, { opacity: 1 }], 'Calm fades');
  assert.equal(calm.main.style.transition, 'none', 'and the page changes width at once');
  const off = dockPage('off', 1184);
  assert.equal(off.panel.anims.length, 0, 'Off simply appears');
  assert.equal(off.main.style.marginRight, '444px');
});

test('docked, Escape from the panel leaves, and asks first over unsaved work', () => {
  const clean = dockPage('', 1184, { opts: { isDirty: () => false } });
  clean.doc.fire('keydown', Object.assign(esc(), { target: clean.doc.body }));
  assert.equal(clean.left(), 1);
  const dirty = dockPage('', 1184, { opts: { isDirty: () => true } });
  dirty.panel.contains = () => true;
  dirty.doc.fire('keydown', Object.assign(esc(), { target: {} }));
  assert.equal(dirty.left(), 0, 'nothing closes behind the person’s back');
  assert.equal(dirty.asked[0].box, dirty.panel, 'the slip comes out of the panel');
  dirty.asked[0].opts.onDiscard();
  assert.equal(dirty.left(), 1);
});

test('docked, an Escape meant for something else on the page is left alone', () => {
  const t = dockPage('', 1184, { opts: { isDirty: () => false } });
  t.doc.fire('keydown', Object.assign(esc(), { target: { tagName: 'INPUT' } }));
  assert.equal(t.left(), 0);
});

test('closing the docked panel gives the page its room back, then takes the panel away', async () => {
  const t = dockPage('', 1184, { base: 0 });
  t.fold.close();
  assert.equal(t.main.style.marginRight, '', 'the page widens again');
  assert.deepEqual(t.panel.anims[1].frames, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(t.doc.body.children.length, 0, 'the panel is gone');
  assert.equal(t.doc.listening('keydown'), 0, 'Escape no longer reaches it');
  assert.equal(t.resizes(), 0, 'it stops following the window');
  assert.equal(t.main.style.transition, '', 'the page’s own transition is back');
});

test('a page change that takes the stat block away closes the docked panel at once', () => {
  const t = dockPage('', 1184, { opts: { isDirty: () => true } });
  t.doc.fire('htmx:afterSwap', {});
  assert.equal(t.left(), 0, 'a swap that keeps the stat block changes nothing');
  t.from.isConnected = false;
  t.doc.fire('htmx:afterSwap', {});
  assert.equal(t.left(), 1, 'Chronicle already asked before the page changed');
  assert.equal(t.asked.length, 0);
});

test('docked, the stat block on the page follows the editor, escaped', () => {
  const pel = { innerHTML: '', hidden: true, className: '', ownerDocument: globalThis.document, addEventListener() {}, querySelector() { return null; } };
  const p = new S.Panel(pel, { campaignId: 'c1', entityId: 'e1', isGm: true });
  p.drawDraft(XSS, {}, {}, null);
  assert.equal(pel.hidden, false);
  assert.match(pel.innerHTML, /Editing · updates as you type/);
  assert.match(pel.innerHTML, /stat block appears here as you fill it in/, 'a page with no stat block yet says it will appear');
  assertNoInjection(assert, pel.innerHTML, 'draft name');
  p.drawDraft('Gorrick', { level: 3, organization: 'elite', role: 'brute', stamina: 60, abilities_json: JSON.stringify([{ name: 'Maul', kind: 'signature' }]) }, {}, null);
  assert.match(pel.innerHTML, /Gorrick/);
  assert.match(pel.innerHTML, /Maul/, 'the stat block is drawn as the editor has it');
  assert.doesNotMatch(pel.innerHTML, /data-sbx-act="edit"/, 'no second way into the editor while it is open');
});

test('both editors hand the docked page their draft as it changes', () => {
  const src = readFileSync(new URL('../widgets/statblock-renderer.js', import.meta.url), 'utf8');
  for (const [from, to] of [['StatblockPanel.prototype.edit = ', 'StatblockPanel.prototype.drawDraft'], ['StatblockPanel.prototype.editForm', 'StatblockPanel.prototype.publishHtml']]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.match(body, /onDraft: function \(out\) \{\s*if \(self\.fold && self\.fold\.docked\) self\.drawDraft\(/, from);
  }
  const ed = readFileSync(new URL('../widgets/monster-builder.js', import.meta.url), 'utf8');
  assert.match(ed, /function dirty\(\) \{[^\n]*draft\(\); \}/, 'every change the editor marks reaches onDraft');
  assert.match(ed, /o\.onDraft\(toSave\(st\)\)/, 'what onDraft hears is what Save would write');
});
