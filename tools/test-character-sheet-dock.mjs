#!/usr/bin/env node
/**
 * The sheet's side of the host dock: while the dashboard's tab row is on
 * screen, Chronicle's page pieces join it (Chronicle's
 * docs/system-package-rendering.md, "The sheet's dock"). The sheet draws
 * three empty slots, wears data-sheet-dock="open" on its root while they are
 * there, says chronicle:sheet-dock when they arrive and chronicle:sheet-undock
 * just before they go, tells the host when it opens a tab of its own, opens
 * the dock pane area when the host asks, and walks the docked tabs with the
 * row's arrow keys.
 *
 * The browser half runs the real widget in Chromium when playwright-core and
 * a Chromium are found, and skips otherwise.
 *
 * Run: `node --test tools/test-character-sheet-dock.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');
const SRC = readFileSync(new URL('../widgets/character-sheet.js', import.meta.url), 'utf8');

const HERO = {
  name: 'Bren', isGm: true, isOwner: true,
  fields: { class: 'Tactician', level: 2, stamina_current: 19, stamina_max: 42, kit: 'Panther' }
};

test('the tab row, the pane area and Equipment each draw an empty slot', () => {
  const html = cs.paperSheetHtml(Object.assign({}, HERO, { armoryItems: true }));
  const row = html.slice(html.indexOf('class="sh-dtabs'), html.indexOf('</div>', html.indexOf('class="sh-dtabs')));
  assert.match(row, /data-cs-dtab="story"[^]*<span class="sh-dhost" data-sheet-dock-tabs><\/span>$/, 'tab slot is the row\'s last child');
  assert.match(html, /<div class="sh-dhostp sh-dq" data-sheet-dock-panes><\/div><\/div><\/div>/, 'pane slot closes the tab area');
  const eq = cs.dashEquipment(Object.assign({}, HERO, { armoryItems: true }));
  assert.match(eq, /data-sheet-dock-piece="items"><h3 class="sh-dsec">Pack and money<\/h3><\/div><div class="sh-dslotfb">/,
    'the Items slot comes right before the fallback the CSS hides behind it');
  assert.match(eq, /sh-dslotfb[^]*Pack and money live in the page’s Items tab[^]*data-cs-go-items/, 'a host that does not dock keeps today\'s pointer');
  const own = cs.dashEquipment(Object.assign({}, HERO, { armoryItems: false }));
  assert.ok(!/data-sheet-dock-piece/.test(own), 'with its own Items list the sheet offers no slot');
});

test('the CSS shows the pane slot only while the host\'s tab is open and hides the fallback behind a filled slot', () => {
  const css = cs.dashCss().join('\n');
  assert.match(css, /\.sh-dmain:not\(\[data-dtab="dock"\]\) > \[data-sheet-dock-panes\] \{ display:none; \}/);
  assert.match(css, /\[data-sheet-dock-piece\]:not\(\[data-docked\]\),\S+ \[data-sheet-dock-piece\]\[data-docked\] \+ \.sh-dslotfb \{ display:none; \}/);
  assert.match(css, /\.sh-dhost > \[role="tab"\]\[hidden\] \{ display:none; \}/, 'a tab the host hides stays hidden');
  assert.match(css, /\.sh-dhost:not\(:empty\)::before/, 'the divider shows only with docked tabs');
  assert.match(css, /\.sh-dtabs:has\(> \.sh-dhost:not\(:empty\)\) \{ column-gap:22px; \}/, 'the joined row is set tighter so it fits one line');
});

// A stand-in for the drawn sheet: the mount, its [data-sheet] root, the
// slots and the tab holder, with real events.
class Node extends EventTarget {
  constructor(attrs) { super(); this.attrs = Object.assign({}, attrs); this.isConnected = true; this.kids = {}; this.all = {}; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  querySelector(s) { return this.kids[s] || null; }
  querySelectorAll(s) { return this.all[s] || []; }
}
function drawn() {
  const el = new Node(), root = new Node(), main = new Node({ 'data-dtab': 'abilities' });
  const tabs = ['abilities', 'features'].map((id) => new Node({ 'data-cs-dtab': id, 'aria-selected': id === 'abilities' ? 'true' : 'false' }));
  const slot = new Node(), panes = new Node();
  root.kids = { '[data-sheet-dock-tabs]': slot, '[data-sheet-dock-panes]': panes };
  main.kids = { '[data-sheet-dock-panes]': panes, '[data-cs-dtab="abilities"]': tabs[0], '[data-cs-dtab="features"]': tabs[1] };
  main.all = { '[data-cs-dtab]': tabs };
  el.kids = { '[data-sheet]': root, '[data-cs-dmain]': main };
  const said = [];
  for (const n of ['chronicle:sheet-dock', 'chronicle:sheet-undock', 'chronicle:sheet-tab']) {
    root.addEventListener(n, (e) => said.push([n, e.detail ? e.detail.tab : undefined, e.bubbles]));
    el.addEventListener(n, (e) => { if (e.target === el) said.push([n + ' (mount)']); });
  }
  return { el, root, main, tabs, said };
}

test('the dock opens once, on the root, and closes before the slots go', () => {
  const { el, root, main, said } = drawn();
  cs.syncDock(el, true);
  cs.syncDock(el, true);
  assert.equal(root.getAttribute('data-sheet-dock'), 'open');
  assert.deepEqual(said, [['chronicle:sheet-dock', undefined, true]], 'said once, bubbling');
  main.setAttribute('data-dtab', 'dock');
  cs.syncDock(el, false);
  assert.equal(root.getAttribute('data-sheet-dock'), null);
  assert.deepEqual(said.slice(1), [['chronicle:sheet-undock', undefined, true], ['chronicle:sheet-tab', 'abilities', true]],
    'undock first, so the host takes its tab back before the sheet falls back to Abilities');
  assert.equal(main.getAttribute('data-dtab'), 'abilities');
  cs.syncDock(el, false);
  assert.equal(said.length, 3, 'closing twice says nothing more');
});

test('a sheet without the slots never opens a dock', () => {
  const { el, root, said } = drawn();
  root.kids = {};
  cs.syncDock(el, true);
  assert.deepEqual(said, []);
  assert.equal(root.getAttribute('data-sheet-dock'), null);
});

test('a root already off the page says undock from the mount', () => {
  const { el, root, said } = drawn();
  cs.syncDock(el, true);
  root.isConnected = false;
  cs.syncDock(el, false);
  assert.deepEqual(said.slice(1), [['chronicle:sheet-undock (mount)']]);
});

test('opening the dock leaves none of the sheet\'s tabs selected; opening its own tells the host', () => {
  const { el, main, tabs, said } = drawn();
  assert.ok(cs.setDashTab(el, 'dock'));
  assert.equal(main.getAttribute('data-dtab'), 'dock');
  assert.deepEqual(tabs.map((t) => [t.getAttribute('aria-selected'), t.getAttribute('tabindex')]), [['false', '-1'], ['false', '-1']]);
  assert.deepEqual(said, [], 'the dock is the host\'s own tab: nothing to tell it');
  cs.setDashTab(el, 'features');
  assert.deepEqual(said, [['chronicle:sheet-tab', 'features', true]]);
});

test('a kept view never reopens the host\'s tab: the host does that after docking', () => {
  assert.match(SRC, /tab: tab === 'dock' \? 'abilities' : tab,/);
});

test('every redraw and destroy closes the dock before replacing the drawing, and a redraw docks again in the same task', () => {
  const mp = SRC.slice(SRC.indexOf('function mountPaper('), SRC.indexOf('function mountSheet('));
  assert.ok(mp.indexOf('syncDock(el, false)') < mp.indexOf('el.innerHTML = paperSheetHtml(data)'));
  assert.match(mp, /syncDock\(el, dashWide\(el\)\);\s*\}\s*$/);
  const ms = SRC.slice(SRC.indexOf('function mountSheet('), SRC.indexOf('// ── API fetch fallback'));
  assert.ok(ms.indexOf('syncDock(el, false)') < ms.indexOf("el.innerHTML = ''"));
  const ds = SRC.slice(SRC.indexOf('    destroy: function (el) {'), SRC.indexOf('if (Chronicle) registerBoxes();'));
  assert.ok(ds.indexOf('syncDock(el, false)') >= 0 && ds.indexOf('syncDock(el, false)') < ds.indexOf("el.innerHTML = ''"));
  assert.match(SRC, /syncPageHooks\(root, dash\);\s*syncDock\(el, dash\);/, 'the width observer opens and closes it');
});

// ---- In a browser ----
function findBrowser() {
  let pw = null;
  for (const base of ['/opt/node-tools/x.js', import.meta.url, process.env.NODE_PATH ? process.env.NODE_PATH + '/x.js' : null]) {
    if (!base) continue;
    try { pw = createRequire(base)('playwright-core'); break; } catch (e) { /* next */ }
  }
  let chrome = process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM) ? process.env.PW_CHROMIUM : null;
  try {
    for (const d of readdirSync('/opt/pw-browsers')) {
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const c = `/opt/pw-browsers/${d}/${sub}/chrome`;
        if (!chrome && d.startsWith('chromium-') && existsSync(c)) chrome = c;
      }
    }
  } catch (e) { /* none */ }
  return pw && chrome ? { pw, chrome } : null;
}
const B = findBrowser();
const skip = B ? false : 'playwright-core or Chromium not found';

test('in a browser: the real sheet docks a host, hands over a tab and walks it with the arrow keys', { skip }, async (t) => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const p = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setContent('<!doctype html><html><body style="margin:0"><div id="mount" style="width:1100px"></div></body></html>');
  await p.addScriptTag({ content: `window.Chronicle = { register: function (n, w) { window.W = w; }, escapeHtml: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); },
    sheetMotion: { mount: function () {}, rescan: function () {} }, apiFetch: function () { return Promise.reject(new Error('offline')); } };
    Chronicle.escapeAttr = Chronicle.escapeHtml;
    window.said = [];
    ['chronicle:sheet-dock', 'chronicle:sheet-undock', 'chronicle:sheet-tab'].forEach(function (n) { document.addEventListener(n, function (e) { said.push(n + (e.detail && e.detail.tab ? ':' + e.detail.tab : '')); }); });
    // A host keeping its side: one tab and one pane, docked on every dock.
    document.addEventListener('chronicle:sheet-dock', function (e) {
      var b = document.createElement('button'); b.setAttribute('role', 'tab'); b.id = 'host-tab'; b.textContent = 'Notes';
      b.setAttribute('aria-selected', 'false'); b.tabIndex = -1;
      b.onclick = function () { b.setAttribute('aria-selected', 'true'); b.dispatchEvent(new CustomEvent('chronicle:sheet-dock-open', { bubbles: true })); };
      e.target.querySelector('[data-sheet-dock-tabs]').appendChild(b);
      var pn = document.createElement('div'); pn.id = 'host-pane'; pn.textContent = 'A note';
      e.target.querySelector('[data-sheet-dock-panes]').appendChild(pn);
    });` });
  await p.addScriptTag({ content: SRC });
  await p.evaluate((fields) => {
    const el = document.getElementById('mount');
    el.dataset.fieldsData = JSON.stringify({ name: 'Bren', fields_data: fields });
    el.dataset.isOwner = 'true'; el.dataset.armoryItems = 'true';
    window.W.init.call(window.W, el, {});
  }, HERO.fields);
  await p.waitForSelector('[data-sheet][data-sheet-dock="open"]');
  assert.deepEqual(await p.evaluate(() => window.said), ['chronicle:sheet-dock']);
  assert.equal(await p.isVisible('#host-pane'), false, 'the pane area waits for the host\'s tab');
  await p.click('#host-tab');
  assert.equal(await p.getAttribute('[data-cs-dmain]', 'data-dtab'), 'dock');
  assert.equal(await p.isVisible('#host-pane'), true);
  assert.equal(await p.isVisible('[data-dpane="features"]'), false);
  // Arrow keys: from the host's tab round to Abilities, and back from Story to it.
  await p.focus('#host-tab');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.getAttribute('[data-cs-dmain]', 'data-dtab'), 'abilities');
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute('data-cs-dtab')), 'abilities');
  assert.ok((await p.evaluate(() => window.said)).includes('chronicle:sheet-tab:abilities'));
  await p.focus('[data-cs-dtab="story"]');
  await p.keyboard.press('ArrowRight');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'host-tab');
  assert.equal(await p.getAttribute('[data-cs-dmain]', 'data-dtab'), 'dock');
  // A phone-width sheet takes the dock away.
  await p.evaluate(() => { document.getElementById('mount').style.width = '390px'; });
  await p.waitForFunction(() => !document.querySelector('[data-sheet-dock="open"]'));
  assert.equal(await p.getAttribute('[data-cs-dmain]', 'data-dtab'), 'abilities');
  assert.equal((await p.evaluate(() => window.said)).filter((n) => n === 'chronicle:sheet-undock').length, 1);
  assert.deepEqual(errors, []);
});
