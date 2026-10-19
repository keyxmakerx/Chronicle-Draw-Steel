#!/usr/bin/env node
/**
 * Creature pictures: the art is the page picture, the token a field, both
 * stored as media ids; each place falls back to the other picture, then to
 * the generic monster token.
 *
 * Run: `node --test tools/test-creature-pictures.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();

const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;
const Ed = require('../widgets/monster-builder.js');

const A = '0f8b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f';
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const XSS = '"><img src=x onerror=alert(1)>';

test('the token field is declared with no Foundry path', () => {
  const creature = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
    .entity_presets.find((p) => p.slug === 'drawsteel-creature');
  const f = creature.fields.find((x) => x.key === S.TOKEN_KEY);
  assert.ok(f);
  assert.equal(f.foundry_path, undefined, 'the module downloads it itself');
});

test('only a media id is ever read as a picture', () => {
  assert.equal(S.mediaId(A), A);
  assert.equal(S.mediaId(A.toUpperCase()), A);
  assert.equal(S.mediaId('2026/03/' + A + '.jpg'), A, 'older pages hold a dated path');
  for (const bad of ['', null, 'javascript:alert(1)', '../' + A + '/x', 'https://evil.example/' + A + 'x', XSS]) {
    assert.equal(S.mediaId(bad), '', String(bad));
  }
  assert.equal(S.mediaSrc(A), '/media/' + A);
  assert.equal(S.mediaSrc('nope'), '');
});

test('each place falls back to the other picture', () => {
  const both = S.pictures({ image_path: A, fields_data: { token_image: T } });
  assert.deepEqual([both.page, both.tokenShown], [A, T]);
  const artOnly = S.pictures({ image_path: A, fields_data: {} });
  assert.deepEqual([artOnly.page, artOnly.tokenShown], [A, A]);
  const tokOnly = S.pictures({ fields_data: { token_image: T } });
  assert.deepEqual([tokOnly.page, tokOnly.tokenShown], [T, T]);
  const none = S.pictures({ fields_data: { token_image: XSS } });
  assert.deepEqual([none.page, none.tokenShown], ['', '']);
});

test('the page’s stat block leads with the picture; the bestiary shows none', () => {
  const f = { level: 1, organization: 'horde', role: 'harrier' };
  assert.match(S.html('Goblin', f, { picture: S.pictures({ image_path: A, fields_data: f }) }), new RegExp('<img src="/media/' + A + '" alt="Goblin"'));
  const generic = S.html('Goblin', f, { picture: S.pictures({ fields_data: f }) });
  assert.match(generic, /sbx-pic is-round"><svg class="sbx-generic"/);
  assert.ok(!/sbx-pic/.test(S.html('Goblin', f, {})));
  const named = S.html(XSS, f, { picture: S.pictures({ image_path: A, fields_data: f }) });
  assert.ok(!named.includes('<img src=x'), 'the name is escaped in the alt text');
});

test('the Pictures box says what stands in for an empty token', () => {
  assert.match(Ed.picsHtml({ art: A, token: T }), /Used for the Foundry token and the map\./);
  assert.match(Ed.picsHtml({ art: A, token: '' }), /uses <b>the art<\/b>, cropped to a circle/);
  assert.match(Ed.picsHtml({ art: '', token: '' }), /uses <b>the generic monster token<\/b>/);
  assert.match(Ed.picsHtml({ art: '', token: '' }), /No art/);
  assert.match(Ed.picsHtml({ art: A, token: '' }), /data-sbe-act="pic-clear" data-sbe-pic-k="art"/);
  assert.match(Ed.picsHtml({ art: '', token: '', busy: 'token' }), /Uploading…/);
  assert.ok(!Ed.picsHtml({ art: '', token: '', msg: XSS }).includes('<img src=x'), 'the message is escaped');
});

test('an upload must be a picture of a sensible size', () => {
  assert.equal(Ed.picProblem({ type: 'image/png', size: 1000 }), '');
  assert.match(Ed.picProblem({ type: 'image/svg+xml', size: 1000 }), /PNG, JPEG, WebP or GIF/);
  assert.match(Ed.picProblem({ type: 'image/jpeg', size: 11 * 1024 * 1024 }), /over 10 MB/);
  assert.match(Ed.picProblem(null), /Choose a picture/);
});

test('the editor starts from the page’s pictures', () => {
  const p = Ed.newPics({ image_path: '2026/03/' + A + '.png', fields_data: { token_image: T } });
  assert.deepEqual([p.art, p.token, p.art0], [A, T, A]);
});

test('the token slot offers Chronicle’s token maker only where Chronicle has one', () => {
  const make = /id="sbe-pic-make" data-sbe-act="pic-make"/;
  assert.ok(!make.test(Ed.picsHtml({ art: A, token: '' })), 'no maker, no button');
  globalThis.Chronicle.tokenMaker = { open() {} };
  try {
    const html = Ed.picsHtml({ art: A, token: '' });
    assert.equal(html.match(/data-sbe-act="pic-make"/g).length, 1, 'on the token slot only');
    assert.ok(html.indexOf('data-sbe-act="pic-make"') > html.indexOf('data-sbe-pic="token"'));
    assert.match(Ed.picsHtml({ art: '', token: '' }), make, 'a picture can be chosen in the maker');
    assert.match(Ed.picsHtml({ art: A, token: '', busy: 'token' }), /data-sbe-act="pic-make" disabled/);
  } finally {
    delete globalThis.Chronicle.tokenMaker;
  }
});
