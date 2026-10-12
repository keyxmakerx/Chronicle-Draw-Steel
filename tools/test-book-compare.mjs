#!/usr/bin/env node
/**
 * Compare with the book (widgets/statblock-renderer.js): a creature page
 * copied from the Monsters book remembers its entry, the director sees each
 * difference from it, and "Use the book's" saves only that field, with Undo.
 *
 * Run: `node --test tools/test-book-compare.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle, makeEl, assertNoInjection } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const S = require('../widgets/statblock-renderer.js');

const load = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const BOOK = load('data/monsters.json');
const entry = (slug) => BOOK.find((m) => m.slug === slug);
const XSS = '<img src=x onerror=alert(1)>';

// A book entry as Add to campaign saves it.
const copyOf = (slug) => Object.assign(S.toFields(S.normalize(entry(slug).properties)), { book_source: slug });

test('the creature type carries the source, director-only and never sent to Foundry', () => {
  const creature = load('manifest.json').entity_presets.find((p) => p.slug === 'drawsteel-creature');
  const f = creature.fields.find((x) => x.key === S.SOURCE_KEY);
  assert.ok(f, 'book_source is declared');
  assert.equal(f.gm_only, true);
  assert.equal(f.foundry_path, undefined);
  assert.ok(!creature.foundry_pull_fields.includes(S.SOURCE_KEY));
});

test('a fresh copy matches its book entry for every book creature', () => {
  for (const m of BOOK) {
    const ds = S.bookDiffs(copyOf(m.slug), m.properties);
    assert.deepEqual(ds.map((d) => d.label), [], m.slug);
  }
});

test('a copy keeps the book’s movement and captain bonus', () => {
  const m = BOOK.find((x) => x.properties.movement && x.properties.with_captain);
  const back = S.normalize(copyOf(m.slug));
  assert.equal(back.movement.join(', ').toLowerCase(), String(m.properties.movement).toLowerCase());
  assert.equal(back.with_captain, m.properties.with_captain);
});

test('each change shows as one row, and a renamed ability pairs with the book’s', () => {
  const slug = BOOK[0].slug, page = copyOf(slug);
  page.stamina = 99;
  const ab = JSON.parse(page.abilities_json);
  ab[0].name = 'Renamed';
  page.abilities_json = JSON.stringify(ab);
  page.traits = JSON.stringify(JSON.parse(page.traits).concat([{ name: 'Extra', description: 'Mine.' }]));
  const ds = S.bookDiffs(page, entry(slug).properties);
  assert.deepEqual(ds.map((d) => d.label), ['Stamina', 'Trait 2', 'Ability 1']);
  assert.equal(ds[0].mine, '99');
  assert.equal(ds[1].book, null, 'the book has no second trait');
  assert.equal(ds[2].mine.name, 'Renamed');
});

test('key order and empty values are not differences', () => {
  const slug = BOOK[0].slug, page = copyOf(slug);
  const ab = JSON.parse(page.abilities_json).map((a) => {
    const out = { effect: a.effect, name: a.name };
    Object.keys(a).reverse().forEach((k) => { out[k] = a[k]; });
    out.extra_empty = '';
    return out;
  });
  page.abilities_json = JSON.stringify(ab);
  assert.deepEqual(S.bookDiffs(page, entry(slug).properties), []);
});

test('taking the book’s value patches only that field', () => {
  const slug = BOOK[0].slug, page = copyOf(slug);
  page.stamina = 99; page.speed = 1;
  const ds = S.bookDiffs(page, entry(slug).properties);
  const patch = S.takeBook(page, entry(slug).properties, [ds[0]]);
  assert.deepEqual(Object.keys(patch), ['stamina']);
  assert.equal(patch.stamina, entry(slug).properties.stamina);
});

test('taking list items replaces, removes extras, and all at once ends the same as the book', () => {
  const slug = BOOK[0].slug, book = entry(slug).properties, page = copyOf(slug);
  page.level = 9;
  page.traits = JSON.stringify(JSON.parse(page.traits).concat([{ name: 'A' }, { name: 'B' }]));
  const ab = JSON.parse(page.abilities_json); ab[0].name = 'X'; page.abilities_json = JSON.stringify(ab);
  const ds = S.bookDiffs(page, book);
  const patch = S.takeBook(page, book, ds);
  const after = Object.assign({}, page, patch);
  assert.deepEqual(S.bookDiffs(after, book), []);
  const one = S.takeBook(page, book, ds.filter((d) => d.label === 'Trait 3'));
  assert.equal(JSON.parse(one.traits).length, JSON.parse(page.traits).length - 1);
});

test('the comparison escapes the page’s words and says what Use the book’s does', () => {
  const slug = BOOK[0].slug, page = copyOf(slug);
  page.keywords = XSS;
  page.abilities_json = JSON.stringify([{ name: XSS, effect: XSS }]);
  const html = S.compareHtml(page, { book: entry(slug) });
  assertNoInjection(assert, html, "compare");
  assert.match(html, /2 differences from the book/);
  assert.match(html, /data-sbx-cmp="all"/);
  assert.match(html, /saves that one field to this page straight away/);
  assert.match(S.compareHtml(copyOf(slug), { book: entry(slug) }), /Same as the book/);
  assert.match(S.compareHtml(page, { missing: true }), /not in the Draw Steel package installed here/);
  assert.match(S.compareHtml(page, { error: true }), /role="alert"/);
});

// A panel over a fake Chronicle that records every save.
function panel(fields, opts) {
  const o = opts || {};
  const saves = [];
  let stored = Object.assign({}, fields, o.extra || {});
  globalThis.Chronicle.apiFetch = (url, req) => {
    if (/monsters\.json$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(BOOK) });
    if (req && req.method === 'PUT') {
      const body = JSON.parse(req.body);
      saves.push(body);
      if (o.fail) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      stored = body.fields_data;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 5, name: 'Copy', fields_data: stored }) });
  };
  const el = makeEl();
  const p = new S.Panel(el, { campaignId: 'c1', entityId: '5', isGm: o.player ? false : true });
  p.entity = { id: 5, name: 'Copy', fields_data: Object.assign({}, fields) };
  return { p, el, saves, stored: () => stored };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('only the director sees the banner, and only on a copied page', () => {
  const slug = BOOK[0].slug;
  let t = panel(copyOf(slug)); t.p.render();
  assert.match(t.el.innerHTML, /Copied from the <b>Draw Steel book<\/b>/);
  assert.match(t.el.innerHTML, /Compare with the book/);
  t = panel(copyOf(slug), { player: true }); t.p.render();
  assert.ok(!/Copied from/.test(t.el.innerHTML));
  const own = copyOf(slug); delete own.book_source;
  t = panel(own); t.p.render();
  assert.ok(!/Copied from/.test(t.el.innerHTML));
});

test('Use the book’s saves one field over the page’s current values, and Undo puts it back', async () => {
  const slug = BOOK[0].slug, page = copyOf(slug);
  page.stamina = 99;
  const t = panel(page, { extra: { stamina_current: 3 } });
  t.p.toggleCompare(); await tick(); await tick();
  assert.match(t.el.innerHTML, /1 difference from the book/);
  t.p.take('0'); await tick(); await tick(); await tick();
  assert.equal(t.saves.length, 1);
  assert.equal(t.saves[0].fields_data.stamina, entry(slug).properties.stamina);
  assert.equal(t.saves[0].fields_data.stamina_current, 3, 'a value Foundry sent back survives');
  assert.equal(t.saves[0].fields_data.book_source, slug);
  assert.match(t.el.innerHTML, /Took the book’s stamina\./);
  assert.match(t.el.innerHTML, /data-sbx-cmp="undo"/);
  t.p.take('undo'); await tick(); await tick(); await tick();
  assert.equal(t.saves[1].fields_data.stamina, 99);
  assert.match(t.el.innerHTML, /Undone\./);
  assert.ok(!/data-sbx-cmp="undo"/.test(t.el.innerHTML));
});

test('a failed save says so in the widget’s words and changes nothing', async () => {
  const slug = BOOK[0].slug, page = copyOf(slug);
  page.stamina = 99;
  const t = panel(page, { fail: true });
  t.p.toggleCompare(); await tick(); await tick();
  t.p.take('0'); await tick(); await tick(); await tick();
  assert.equal(t.p.fields().stamina, 99);
  assert.match(t.el.innerHTML, /Could not save that\. Try again\./);
  assert.ok(!/data-sbx-cmp="undo"/.test(t.el.innerHTML));
});

test('Add to campaign records the book entry on the copy', () => {
  const src = readFileSync(new URL('../widgets/bestiary-browser.js', import.meta.url), 'utf8');
  assert.match(src, /row\.src === 'book' && row\.slug\) fields\[S\.SOURCE_KEY\] = row\.slug/);
});
