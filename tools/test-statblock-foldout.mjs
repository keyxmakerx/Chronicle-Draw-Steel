#!/usr/bin/env node
/**
 * The stat block's fold-out (DrawSteelStatblock.foldOut): the editor grows out
 * of the page panel into a full-screen sheet and shrinks back into it, follows
 * the site's motion setting, and never closes over unsaved work without
 * asking through Chronicle's ask-in-place slip.
 *
 * Run: `node --test tools/test-statblock-foldout.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle } from './_xss-harness.mjs';

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
