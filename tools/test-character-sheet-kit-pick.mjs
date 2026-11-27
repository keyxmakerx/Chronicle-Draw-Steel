#!/usr/bin/env node
/**
 * Picking a kit on the sheet. The kit's numbers come from Foundry's synced
 * kit_details_json, so between a pick and the next sync the sheet has the new
 * kit's name and the old kit's numbers. It must never show the old numbers
 * under the new name: it names the new kit and says its numbers arrive with
 * the next sync. A pick redraws every place the kit shows, the dashboard's
 * Kit card and Equipment tab included, without touching the docked Items
 * piece.
 *
 * The browser half runs the real widget in Chromium when playwright-core and
 * a Chromium are found, and skips otherwise.
 *
 * Run: `node --test tools/test-character-sheet-kit-pick.mjs`
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

const PANTHER = { name: 'Panther', stamina: 6, speed: 1, meleeDamageT1: 1, meleeDamageT2: 1, meleeDamageT3: 1 };
const hero = (kit, details, over) => Object.assign({
  name: 'Bren', isOwner: true, campaignId: 'c1', entityId: 'h1',
  fields: { class: 'Fury', level: 1, kit, kit_details_json: JSON.stringify(details) }
}, over);

test('synced numbers that match the kit field are used', () => {
  const d = hero('Panther', [PANTHER]);
  assert.equal(cs.kitObject(d).name, 'Panther');
  assert.deepEqual(cs.kitNames(d), ['Panther']);
  assert.match(cs.dashEquipment(d), /Melee damage/);
});

test('a second kit set in Foundry still shows beside the one the field names', () => {
  const d = hero('Panther', [PANTHER, { name: 'Mountain', stability: 2 }]);
  assert.deepEqual(cs.kitNames(d), ['Panther', 'Mountain']);
  assert.ok(cs.kitObject(d));
});

test('a kit picked since the last sync: the new name, no old numbers, and when they arrive', () => {
  const d = hero('Mountain', [PANTHER]);
  assert.equal(cs.kitObject(d), null, 'the old kit\'s numbers are not used');
  assert.deepEqual(cs.kitNames(d), ['Mountain'], 'the old kit is not named beside it');
  const eq = cs.dashEquipment(d);
  assert.match(eq, /Kit: Mountain/);
  assert.match(eq, /Its numbers arrive with the next Foundry sync\./);
  assert.ok(!/Melee damage|Panther/.test(eq), 'nothing of the old kit');
  const panel = cs.pKitPanel(d);
  assert.match(panel, /Mountain/);
  assert.match(panel, /Its numbers arrive with the next Foundry sync\./);
  assert.ok(!/Panther/.test(panel));
});

test('with no Foundry world nothing will arrive, so the sheet does not promise it', () => {
  const d = hero('Mountain', [PANTHER], { foundryLinked: false });
  assert.match(cs.dashEquipment(d), /No kit details synced\./);
  assert.ok(!/next Foundry sync/.test(cs.dashEquipment(d)));
});

test('unnamed synced details are kept, since they can\'t be told apart', () => {
  assert.ok(cs.kitObject(hero('Mountain', [{ name: 'New kit', speed: 1 }])));
  assert.ok(cs.kitObject(hero('Mountain', [{ speed: 1 }])));
});

test('the Equipment tab keeps its kit part apart from the docked Items piece', () => {
  const eq = cs.dashEquipment(hero('Panther', [PANTHER], { armoryItems: true }));
  const kitPart = eq.slice(eq.indexOf('<div data-cs-dkit>'), eq.indexOf('data-sheet-dock-piece'));
  assert.ok(kitPart.length > 0 && kitPart.includes('Kit: Panther'));
  assert.ok(!kitPart.includes('data-sheet-dock-piece'));
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

test('in a browser: a kit pick redraws the Kit card, the Equipment tab and the Kit panel', { skip }, async (t) => {
  const browser = await B.pw.chromium.launch({ executablePath: B.chrome, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const p = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setContent('<!doctype html><html><body style="margin:0"><div id="mount" style="width:1100px"></div></body></html>');
  await p.addScriptTag({ content: `window.Chronicle = { register: function (n, w) { window.W = w; }, escapeHtml: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); },
    sheetMotion: { mount: function () {}, rescan: function () {}, land: function () {} }, apiFetch: function () { return Promise.reject(new Error('offline')); },
    pickChoice: function (o) { return o.save ? Promise.resolve({ value: 'Mountain' }) : null; } };
    Chronicle.escapeAttr = Chronicle.escapeHtml;` });
  await p.addScriptTag({ content: SRC });
  await p.evaluate((fields) => {
    const el = document.getElementById('mount');
    el.dataset.fieldsData = JSON.stringify({ name: 'Bren', fields_data: fields });
    el.dataset.isOwner = 'true'; el.dataset.canEditIdentity = 'true';
    el.dataset.campaignId = 'c1'; el.dataset.entityId = 'h1';
    window.W.init.call(window.W, el, {});
  }, Object.assign({}, hero('Panther', [PANTHER]).fields, { abilities_json: JSON.stringify([{ name: 'Spike', category: 'signature', type: 'action' }]) }));
  await p.waitForSelector('[data-cs-drail]', { state: 'attached' });
  const rail = () => p.textContent('[data-cs-drail]');
  const equip = () => p.evaluate(() => document.querySelector('[data-cs-dkit]').textContent);
  const panel = () => p.evaluate(() => document.querySelector('template[data-sheet-panel="kit"]').innerHTML);
  assert.match(await rail(), /Panther/);
  const fsDash = () => p.evaluate(() => { const n = document.querySelector('[data-cs-dar="-1"] .sh-dadm'); return n ? n.textContent : null; });
  const fsFace = () => p.evaluate(() => [].map.call(document.querySelectorAll('[data-cs-fs] .sx-res'), (n) => n.textContent).join('|'));
  assert.match(await fsDash(), /kit \+1/, 'the free strike starts with the old kit\'s bonus');
  await p.evaluate(() => {
    const b = [].filter.call(document.querySelectorAll('[data-cs-pick="kit"]'), (n) => n.offsetParent !== null)[0];
    b.click();
  });
  await p.waitForFunction(() => /Mountain/.test(document.querySelector('[data-cs-drail]').textContent));
  assert.match(await rail(), /Its numbers arrive with the next Foundry sync\./);
  assert.ok(!/Panther|Melee damage/.test(await rail()), 'the card holds nothing of the old kit');
  assert.match(await equip(), /Kit: Mountain/);
  assert.ok(!/Panther/.test(await equip()));
  assert.match(await panel(), /Mountain/);
  assert.equal(await fsDash(), '', 'the dashboard\'s free strike drops the old kit\'s bonus');
  assert.ok(!/kit/.test(await fsFace()), 'and so does the face\'s');
  assert.deepEqual(errors, []);
});

test('the Equipment tab\'s Kit heading keeps the first heading\'s 12px top inside its wrapper', () => {
  assert.match(SRC, /Q \.sh-dpane > \.sh-dsec:first-child,Q \.sh-dpane > \[data-cs-dkit\]:first-child > \.sh-dsec:first-child \{ margin-top:12px; \}/);
});
