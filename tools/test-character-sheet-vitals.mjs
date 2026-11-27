#!/usr/bin/env node
/**
 * The hero sheet's vitals controls. For the hero's owner or the Director,
 * Stamina, the heroic resource, Surges and Recoveries are numbers to press:
 * minus and plus either side of a box to type in, Damage and Heal under
 * Stamina, and Spend a Recovery under Recoveries. Everyone else sees plain
 * numbers. Each change saves at once; minus and plus wait for a short pause
 * so a run of presses is one save.
 *
 * The browser half runs the real widget in Chromium when playwright-core and
 * a Chromium are found, and skips otherwise.
 *
 * Run: `node --test tools/test-character-sheet-vitals.mjs`
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

const FIELDS = { class: 'Shadow', level: 1, stamina_max: 27, stamina_current: 19, winded: 13, recoveries: 6, recoveries_max: 8,
  heroic_resource_name: 'Insight', heroic_resource_current: 3, surges: 1 };
const owner = { name: 'Brannoc', fields: FIELDS, isOwner: true, campaignId: 'c1', entityId: 'h1' };
const reader = { name: 'Brannoc', fields: FIELDS, campaignId: 'c1', entityId: 'h1' };

test('the owner gets a button on each number; a reader gets plain numbers', () => {
  const mine = cs.pTurn(owner), theirs = cs.pTurn(reader);
  for (const k of ['stamina', 'hr', 'surges', 'rec']) {
    assert.ok(mine.includes('data-cs-vt="' + k + '"'), k + ' is a button for the owner');
    assert.ok(mine.includes('data-v="' + k + '"'), k + ' keeps its number span');
    assert.ok(theirs.includes('data-v="' + k + '"'), k + ' is shown to a reader');
  }
  assert.ok(!/data-cs-vt/.test(theirs), 'a reader gets no controls');
  assert.ok(cs.pTurn({ name: 'B', fields: FIELDS, isGm: true, campaignId: 'c1', entityId: 'h1' }).includes('data-cs-vt="stamina"'), 'the Director edits too');
});

test('the limits follow the rules: Stamina from minus Winded to its maximum, Recoveries from 0 to theirs', () => {
  assert.deepEqual(cs.vtLimits(owner, 'stamina'), { min: -13, max: 27 });
  assert.deepEqual(cs.vtLimits(owner, 'rec'), { min: 0, max: 8 });
  assert.deepEqual(cs.vtLimits(owner, 'surges'), { min: 0, max: null });
  assert.deepEqual(cs.vtLimits(owner, 'hr'), { min: null, max: null }, 'some classes go below 0');
  assert.equal(cs.vtClamp(40, cs.vtLimits(owner, 'stamina')), 27);
  assert.equal(cs.vtClamp(-20, cs.vtLimits(owner, 'stamina')), -13);
});

test('a typed number reads minus signs and dashes, and nothing else', () => {
  assert.equal(cs.vtParse('12'), 12);
  assert.equal(cs.vtParse(' −4 '), -4);
  assert.equal(cs.vtParse('–3'), -3);
  assert.equal(cs.vtParse('+2'), 2);
  assert.equal(cs.vtParse('2.5'), null);
  assert.equal(cs.vtParse('ten'), null);
  assert.equal(cs.vtParse(''), null);
});

test('Stamina offers Damage and Heal; Recoveries offers a spend that heals a third of Stamina', () => {
  const st = cs.vtPopHtml(owner, 'stamina');
  assert.match(st, /data-cs-vt-step="-1"[^]*data-cs-vt-in[^]*data-cs-vt-step="1"/, 'minus, the box, plus');
  assert.match(st, /data-cs-vt-hit="-1">Damage<[^]*data-cs-vt-hit="1">Heal</);
  assert.match(cs.vtPopHtml(owner, 'rec'), /data-cs-vt-spend>Spend one, heal 9</);
  assert.ok(!/data-cs-vt-spend/.test(cs.vtPopHtml({ fields: { recoveries: 2 } }, 'rec')), 'no spend without a Stamina maximum');
  assert.ok(!/data-cs-vt-hit/.test(cs.vtPopHtml(owner, 'surges')));
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

// Saves are recorded on window.PUTS; window.FAIL makes the next ones fail,
// and window.DELAY holds each reply back that many milliseconds.
async function mountAt(browser, width, isOwner) {
  const p = await browser.newPage({ viewport: { width: width + 20, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setContent('<!doctype html><html><head><style>[data-sheet]{container:sheet / inline-size}</style></head><body style="margin:0"><div id="mount" style="width:' + width + 'px"></div><button id="away">away</button></body></html>');
  await p.addScriptTag({ content: `window.PUTS = []; window.Chronicle = { register: function (n, w) { window.W = w; }, escapeHtml: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); },
    sheetMotion: { mount: function () {}, rescan: function () {}, land: function () {} },
    apiFetch: function (u, o) { if (o && o.method === 'PUT') { window.PUTS.push(o.body.fields_patch); var res = { ok: !window.FAIL, status: window.FAIL ? 500 : 200 }; return window.DELAY ? new Promise(function (r) { setTimeout(function () { r(res); }, window.DELAY); }) : Promise.resolve(res); } return Promise.reject(new Error('offline')); } };
    Chronicle.escapeAttr = Chronicle.escapeHtml;` });
  await p.addScriptTag({ content: SRC });
  await p.evaluate(([fields, own]) => {
    const el = document.getElementById('mount');
    el.dataset.fieldsData = JSON.stringify({ name: 'Brannoc', fields_data: fields });
    if (own) el.dataset.isOwner = 'true';
    el.dataset.campaignId = 'c1'; el.dataset.entityId = 'h1';
    window.W.init.call(window.W, el, {});
  }, [FIELDS, isOwner]);
  await p.waitForSelector('[data-sheet]', { state: 'attached' });
  return { p, errors };
}
const vis = (p, sel) => p.locator(sel).filter({ visible: true }).first();
const puts = (p) => p.evaluate(() => window.PUTS.slice());
const shownText = (p, k) => p.evaluate((kk) => [].map.call(document.querySelectorAll('[data-v="' + kk + '"]'), (n) => n.textContent), k);

test('in a browser: damage, heal, spend and the stepper save and repaint every copy', { skip }, async () => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  try {
    const { p, errors } = await mountAt(browser, 400, true);
    assert.equal(await p.locator('[data-cs-vt-pop]').count(), 0, 'closed until a number is pressed');
    await vis(p, '[data-cs-vt="stamina"]').click();
    assert.equal(await vis(p, '[data-cs-vt="stamina"]').getAttribute('aria-expanded'), 'true');
    await p.fill('[data-cs-vt-amt]', '40');
    await p.click('[data-cs-vt-hit="-1"]');
    await p.waitForFunction(() => window.PUTS.length === 1);
    assert.deepEqual((await puts(p))[0], { stamina_current: -13 }, 'damage stops at dead');
    assert.deepEqual([...new Set(await shownText(p, 'stamina'))], ['\u221213'], 'every Stamina copy repaints, with a true minus');
    await p.fill('[data-cs-vt-amt]', '4');
    await p.click('[data-cs-vt-hit="1"]');
    await p.waitForFunction(() => window.PUTS.length === 2);
    assert.deepEqual((await puts(p))[1], { stamina_current: -9 });

    await vis(p, '[data-cs-vt="rec"]').click();
    assert.equal(await p.locator('[data-cs-vt-pop]').count(), 1, 'one set of controls at a time');
    await p.click('[data-cs-vt-spend]');
    await p.waitForFunction(() => window.PUTS.length === 3);
    assert.deepEqual((await puts(p))[2], { recoveries: 5, stamina_current: 0 }, 'a Recovery heals 9 and is spent');
    assert.match(await p.textContent('.sh-vt-msg'), /Spent a Recovery/);

    await vis(p, '[data-cs-vt="hr"]').click();
    for (let i = 0; i < 3; i++) await p.click('[data-cs-vt-step="1"]');
    await p.waitForFunction(() => window.PUTS.length >= 4);
    await p.waitForTimeout(600);
    const all = await puts(p);
    assert.equal(all.length, 4, 'three presses, one save');
    assert.deepEqual(all[3], { heroic_resource_current: 6 });
    assert.deepEqual([...new Set(await shownText(p, 'hr'))], ['6']);

    await p.keyboard.press('Escape');
    assert.equal(await p.locator('[data-cs-vt-pop]').count(), 0, 'Escape puts the controls away');
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('data-cs-vt')), 'hr', 'focus goes back to the number');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('in a browser: a typed number saves on Enter, a press outside closes, a failure offers Try again', { skip }, async () => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  try {
    const { p, errors } = await mountAt(browser, 400, true);
    await vis(p, '[data-cs-vt="surges"]').click();
    await p.fill('[data-cs-vt-in]', '-2');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.PUTS.length === 1);
    assert.deepEqual((await puts(p))[0], { surges: 0 }, 'Surges stop at 0');
    assert.equal(await p.locator('[data-cs-vt-step="-1"]').isDisabled(), true, 'minus greys out at the floor');

    await p.click('#away');
    assert.equal(await p.locator('[data-cs-vt-pop]').count(), 0, 'a press outside closes');

    await p.evaluate(() => { window.FAIL = true; });
    await vis(p, '[data-cs-vt="surges"]').click();
    await p.click('[data-cs-vt-step="1"]');
    await p.waitForSelector('.sh-vt-msg.is-err');
    assert.match(await p.textContent('.sh-vt-msg'), /Not saved\.[^]*still 0/, 'the old number stands');
    assert.ok((await shownText(p, 'surges')).every((t) => t === '0'));
    await p.evaluate(() => { window.FAIL = false; });
    await p.click('[data-cs-vt-retry]');
    await p.waitForFunction(() => window.PUTS.length === 3);
    assert.ok((await shownText(p, 'surges')).every((t) => t === '1'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('in a browser: Damage or a Spend pressed while plus waits builds on it, in one save', { skip }, async () => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  try {
    const { p, errors } = await mountAt(browser, 400, true);
    await vis(p, '[data-cs-vt="stamina"]').click();
    await p.click('[data-cs-vt-step="1"]');
    await p.fill('[data-cs-vt-amt]', '5');
    await p.click('[data-cs-vt-hit="-1"]');
    await p.waitForTimeout(700);
    assert.deepEqual(await puts(p), [{ stamina_current: 15 }], '19 + 1 - 5, and the plus is not saved over it');

    await vis(p, '[data-cs-vt="rec"]').click();
    await p.click('[data-cs-vt-step="-1"]');
    await p.click('[data-cs-vt-spend]');
    await p.waitForTimeout(700);
    assert.deepEqual((await puts(p)).slice(1), [{ recoveries: 4, stamina_current: 24 }], 'the minus and the spend both count');
    assert.ok((await shownText(p, 'rec')).every((t) => t === '4'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('in a browser: a second quick Damage or Spend builds on the first while it is still saving', { skip }, async () => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  try {
    const { p, errors } = await mountAt(browser, 400, true);
    await p.evaluate(() => { window.DELAY = 150; });
    await vis(p, '[data-cs-vt="stamina"]').click();
    await p.fill('[data-cs-vt-amt]', '5');
    await p.click('[data-cs-vt-hit="-1"]');
    await p.fill('[data-cs-vt-amt]', '5');
    await p.click('[data-cs-vt-hit="-1"]');
    await p.waitForFunction(() => window.PUTS.length === 2);
    await p.waitForTimeout(400);
    assert.deepEqual(await puts(p), [{ stamina_current: 14 }, { stamina_current: 9 }]);
    assert.ok((await shownText(p, 'stamina')).every((t) => t === '9'));

    await vis(p, '[data-cs-vt="rec"]').click();
    await p.click('[data-cs-vt-spend]');
    await p.click('[data-cs-vt-spend]');
    await p.waitForFunction(() => window.PUTS.length === 4);
    await p.waitForTimeout(400);
    assert.deepEqual((await puts(p)).slice(2), [{ recoveries: 5, stamina_current: 18 }, { recoveries: 4, stamina_current: 27 }], 'two Recoveries spent');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('in a browser: a reader sees no controls', { skip }, async () => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  try {
    const { p, errors } = await mountAt(browser, 400, false);
    assert.equal(await p.locator('[data-cs-vt]').count(), 0);
    assert.equal(await p.locator('.sh-dk-open').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
