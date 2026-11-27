#!/usr/bin/env node
/**
 * The hero sheet at phone width. An ability's three results drop under its
 * name as three tier boxes, so a long name keeps the whole line; each box says
 * which roll it answers after a pause on hover, and at once on a tap without
 * opening the ability. The identity line keeps each dot with the part before
 * it, so a wrapped line never starts with a dot.
 *
 * The browser half runs the real widget in Chromium when playwright-core and
 * a Chromium are found, and skips otherwise.
 *
 * Run: `node --test tools/test-character-sheet-phone.mjs`
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

const dmg = (a, b, c, types) => [{ damage: { tier1: { value: a, types }, tier2: { value: b, types }, tier3: { value: c, types } } }];
const LONG = 'Unbinding of the Withering Hollow Night';
const ABS = [
  { name: LONG, category: 'signature', type: 'action', distanceType: 'ranged', distance: 10, powerRollChars: ['reason'], tiers: dmg('12 + @chr', '14 + @chr', '18 + @chr', ['corruption', 'psychic']), effectAfter: 'Each target is weakened.' },
  { name: 'Judgment', type: 'maneuver', distanceType: 'ranged', distance: 10, effectAfter: 'Judge one creature.' }
];
const FIELDS = { class: 'Talent', level: 3, reason: 3, ancestry: 'Memonek', subclass: 'Chronopathy', kit: 'Wandering Lowland Caravan Guard', faction: 'Disciples of the Ninth Circle',
  heroic_resource_name: 'Clarity', heroic_resource_current: 2, abilities_json: JSON.stringify(ABS) };

test('a rolled ability carries three tier boxes, each saying which roll it answers', () => {
  const html = cs.pAbilities({ name: 'Ysolde', fields: FIELDS });
  const tb = html.match(/<span class="sx-tb">([^]*?)<\/span><span class="sx-meta">/);
  assert.ok(tb, 'the boxes follow the line\'s top');
  const boxes = [...tb[1].matchAll(/<span class="sx-tbx num" data-tip="([^"]+)" data-tip-delay data-cs-tier><span class="sh-sr">([^<]+)<\/span>(\d+)<\/span>/g)];
  assert.deepEqual(boxes.map((m) => m[3]), ['15', '17', '21'], 'Reason 3 worked into each tier');
  assert.deepEqual(boxes.map((m) => m[1]), ['Tier 1: a power roll of 11 or less', 'Tier 2: a power roll of 12 to 16', 'Tier 3: a power roll of 17 or more']);
  assert.ok(boxes.every((m) => m[2] === m[1] + ': '), 'a screen reader hears the same words');
  assert.match(tb[1], /<span class="sx-tbt">corruption, psychic<\/span>$/);
  assert.match(html, /<span class="sx-res num sx-res-t">15 · 17 · 21 corruption\/psychic<\/span>/, 'wider screens keep today\'s result');
});

test('an ability with no roll keeps its distance and gets no boxes', () => {
  const html = cs.pAbilities({ name: 'Ysolde', fields: Object.assign({}, FIELDS, { abilities_json: JSON.stringify([ABS[1]]) }) });
  const line = html.slice(html.indexOf('Judgment'));
  assert.ok(/<span class="sx-res num">Ranged 10<\/span>/.test(line));
  assert.ok(!/sx-tbx/.test(line.slice(0, line.indexOf('</summary>'))));
});

test('the identity line puts each dot at the end of the part before it', () => {
  const line = cs.pIdentity({ name: 'Ysolde', fields: FIELDS }).match(/<p class="sh-idline[^"]*">([^]*?)<\/p>/)[1];
  const seps = line.match(/<span class="sh-idsep" aria-hidden="true">·<\/span><\/span>/g) || [];
  assert.equal(seps.length, 4, 'five parts, four dots, each closing its group');
  assert.ok(!/sh-idsep[^>]*>·<\/span>$/.test(line), 'no dot after the last part');
});

test('the quiet look\'s dot or rule follows the class and each sub-part, never leads one', () => {
  assert.match(SRC, /Q :is\(\.sh-idcls,\.sh-idsub\):has\(\+ \.sh-idsub\)::after \{ content:"\\\\00b7"/);
  assert.ok(!/\.sh-idsub::before/.test(SRC));
  assert.match(SRC, /'Q :is\(\.sh-idcls,\.sh-idsub\):has\(\+ \.sh-idsub\) \{ margin-right:14px;padding-right:14px;border-right:1px solid/, 'the rule between parts trails the part before');
  assert.ok(!/sh-idsub \{[^}]*border-left:1px/.test(SRC), 'no rule leads a part');
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

// Chronicle's sheet styles make [data-sheet] the "sheet" container; the stub
// fold motion opens a fold from a click inside the sheet, as Chronicle's does.
async function mountAt(browser, width) {
  const p = await browser.newPage({ viewport: { width: width + 20, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setContent('<!doctype html><html><head><style>[data-sheet]{container:sheet / inline-size}</style></head><body style="margin:0"><div id="mount" style="width:' + width + 'px"></div></body></html>');
  await p.addScriptTag({ content: `window.Chronicle = { register: function (n, w) { window.W = w; }, escapeHtml: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); },
    sheetMotion: { mount: function (root) { root.addEventListener('click', function (e) { var sm = e.target.closest('[data-sheet-fold] > summary'); if (sm) { e.preventDefault(); sm.parentNode.open = !sm.parentNode.open; } }); }, rescan: function () {}, land: function () {} },
    apiFetch: function () { return Promise.reject(new Error('offline')); } };
    Chronicle.escapeAttr = Chronicle.escapeHtml;` });
  await p.addScriptTag({ content: SRC });
  await p.evaluate((fields) => {
    const el = document.getElementById('mount');
    el.dataset.fieldsData = JSON.stringify({ name: 'Ysolde', fields_data: fields });
    el.dataset.campaignId = 'c1'; el.dataset.entityId = 'h1';
    window.W.init.call(window.W, el, {});
  }, FIELDS);
  await p.waitForSelector('.sx-line', { state: 'attached' });
  return { p, errors };
}
const shown = (p, sel) => p.evaluate((s) => [].filter.call(document.querySelectorAll(s), (n) => n.getClientRects().length > 0).length, sel);

test('in a browser: on a phone the name gets the line and the boxes sit under it', { skip }, async (t) => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { p, errors } = await mountAt(browser, 375);
  assert.equal(await shown(p, '.sx-res-t'), 0, 'the right-hand result is put away');
  assert.equal(await shown(p, '.sx-tbx'), 3, 'three boxes show');
  const geo = await p.evaluate((n) => {
    const line = [].find.call(document.querySelectorAll('.sx-line'), (d) => d.textContent.includes(n));
    const name = line.querySelector('.sx-name').getBoundingClientRect(), sum = line.querySelector('summary').getBoundingClientRect();
    const box = line.querySelector('.sx-tbx').getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(line.querySelector('.sx-name')).lineHeight) || 20;
    return { nameW: name.width, sumW: sum.width, lines: Math.round(name.height / lh), below: box.top >= name.bottom - 1 };
  }, LONG);
  assert.ok(geo.nameW > geo.sumW * 0.8, 'the name spans the line (' + Math.round(geo.nameW) + ' of ' + Math.round(geo.sumW) + ')');
  assert.ok(geo.lines <= 2, 'the long name wraps at most once, not three or four times (' + geo.lines + ')');
  assert.ok(geo.below, 'the boxes sit under the name');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.sx-tbx')).cursor), 'help', 'a help cursor says there is more to read');

  // Hover: nothing at once, the tip after the pause.
  await p.hover('.sx-tbx:nth-child(3)');
  assert.equal(await p.evaluate(() => (document.querySelector('.ds-tipbox--visible') || {}).textContent || ''), '', 'no tip the moment the pointer arrives');
  await p.waitForFunction(() => /17 or more/.test((document.querySelector('.ds-tipbox--visible') || {}).textContent || ''), null, { timeout: 2000 });
  await p.mouse.move(5, 880);
  await p.waitForFunction(() => !document.querySelector('.ds-tipbox--visible'));

  // Tap: the tip at once, and the ability stays shut; a tap elsewhere puts it away.
  await p.evaluate(() => document.querySelector('.sx-tbx').click());
  assert.match(await p.evaluate(() => document.querySelector('.ds-tipbox--visible').textContent), /11 or less/);
  assert.equal(await p.evaluate(() => document.querySelector('.sx-tbx').closest('details').open), false, 'the tap did not open the ability');
  await p.evaluate(() => document.querySelector('.sx-tbx').closest('summary').querySelector('.sx-name').click());
  assert.equal(await p.evaluate(() => !!document.querySelector('.ds-tipbox--visible')), false, 'the next tap put the tip away');
  assert.equal(await p.evaluate(() => document.querySelector('.sx-tbx').closest('details').open), true, 'and a tap on the name still opens it');

  // The tip floats over the page: a scroll, a press outside the sheet, or a
  // redraw puts it away.
  const tipUp = () => p.evaluate(() => !!document.querySelector('.ds-tipbox--visible'));
  await p.evaluate(() => document.querySelector('.sx-tbx').click());
  assert.equal(await tipUp(), true);
  await p.evaluate(() => document.dispatchEvent(new Event('scroll')));
  assert.equal(await tipUp(), false, 'a scroll puts the tip away');
  await p.evaluate(() => document.querySelector('.sx-tbx').click());
  await p.evaluate(() => { const o = document.createElement('div'); o.id = 'out'; document.body.appendChild(o); o.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  assert.equal(await tipUp(), false, 'a press outside the sheet puts it away');
  await p.evaluate(() => document.querySelector('.sx-tbx').click());
  await p.evaluate(() => window.W.destroy.call(window.W, document.getElementById('mount')));
  assert.equal(await tipUp(), false, 'taking the sheet down leaves no tip behind');
  await p.evaluate((fields) => { const el = document.getElementById('mount'); el.dataset.fieldsData = JSON.stringify({ name: 'Ysolde', fields_data: fields }); window.W.init.call(window.W, el, {}); }, FIELDS);
  await p.waitForSelector('.sx-tbx', { state: 'attached' });

  // The identity line: no wrapped line starts with a dot.
  const starts = await p.evaluate(() => {
    document.querySelector('[data-sheet]').setAttribute('data-sheet-style', 'ledger');
    const line = document.querySelector('.sh-idline');
    if (!line || !line.getClientRects().length) return null;
    const left = line.getBoundingClientRect().left;
    return [].map.call(line.querySelectorAll('.sh-idsep'), (s) => s.getBoundingClientRect().left - left);
  });
  assert.ok(starts, 'the identity line shows');
  assert.ok(starts.every((x) => x > 4), 'a dot never starts a line: ' + starts.map(Math.round).join(','));
  // A part that is a button (the subclass that opens its rules) wraps as one
  // box; its dot still keeps a place beside it.
  const besideButton = await p.evaluate(() => {
    const line = document.querySelector('.sh-idline'), g = [].find.call(line.querySelectorAll('.sh-idgrp'), (x) => /Chronopathy/.test(x.textContent));
    g.firstChild.innerHTML = '<button type="button" class="sh-link sh-idsubopen">College of the Harlequin Mask of the Many Faced Moon</button>';
    const b = g.querySelector('button').getBoundingClientRect(), sep = g.querySelector('.sh-idsep').getBoundingClientRect();
    return { wrapped: b.height > 30, beside: sep.left - line.getBoundingClientRect().left > 4 && sep.top < b.bottom };
  });
  assert.ok(besideButton.wrapped, 'the fixture button wraps');
  assert.ok(besideButton.beside, 'the dot after a wrapped button stays on its line');
  assert.deepEqual(errors, []);
});

test('in a browser: a computer keeps today\'s result on the right', { skip }, async (t) => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { p, errors } = await mountAt(browser, 700);
  assert.equal(await shown(p, '.sx-tbx'), 0);
  assert.ok(await shown(p, '.sx-res-t') >= 1);
  assert.deepEqual(errors, []);
});
