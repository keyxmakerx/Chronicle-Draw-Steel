#!/usr/bin/env node
/**
 * The hero's portrait: it draws the page picture (image_path), falling back
 * to the Foundry token art, and clicking it opens the picture picker only for
 * a viewer the host lets change the picture. Anyone else gets the art full
 * size, and an empty portrait does nothing for them.
 *
 * Run: `node --test tools/test-character-sheet-portrait.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');

const MEDIA = '0b7c2e9a-1d2f-4a3b-8c4d-5e6f7a8b9c0d';

test('portraitSrc: the page picture wins, then the token art', () => {
  const cases = [
    { name: 'bare media id', data: { imagePath: MEDIA, fields: { portrait_url: 'worlds/x/token.png' } }, want: '/media/' + MEDIA },
    { name: 'dated path', data: { imagePath: '2026/03/' + MEDIA.toUpperCase() + '.jpg', fields: {} }, want: '/media/' + MEDIA },
    { name: 'no picture: token art', data: { imagePath: '', fields: { portrait_url: '/art/bren.png' } }, want: '/art/bren.png' },
    { name: 'neither', data: { fields: {} }, want: '' },
    { name: 'a picture that is not a media id falls back', data: { imagePath: 'javascript:alert(1)', fields: {} }, want: '' },
  ];
  for (const c of cases) assert.equal(cs.portraitSrc(c.data), c.want, c.name);
});

// Each role as the host reports it: the hero's owner and the Director team
// may change the picture; another player and a visitor may not.
const ROLES = [
  { who: 'claimed owner', canChangeImage: true },
  { who: 'Director', canChangeImage: true },
  { who: 'another player', canChangeImage: false },
  { who: 'visitor', canChangeImage: false },
];

for (const draw of [
  { name: 'band', html: (d) => cs.rIdentity({}, d) },
  { name: 'paper sheet', html: (d) => cs.paperSheetHtml(d).match(/<header class="sh-top">([^]*?)<\/header>/)[1] },
]) {
  for (const r of ROLES) {
    test(`${draw.name}, ${r.who}: what a portrait click does`, () => {
      globalThis.window.Chronicle.sheetMotion = draw.name === 'paper sheet' ? {} : undefined;
      const base = { name: 'Bren', canChangeImage: r.canChangeImage, fields: { class: 'Tactician', level: 1 } };
      const set = draw.html(Object.assign({}, base, { imagePath: MEDIA }));
      const portrait = set.match(/<img[^>]*data-cs-portrait[^>]*>/);
      assert.ok(portrait, 'the page picture is drawn');
      assert.ok(portrait[0].includes('src="/media/' + MEDIA + '"'));
      assert.equal(/data-cs-change-image/.test(portrait[0]), r.canChangeImage, 'opens the picker only when allowed');
      assert.equal(/data-cs-portrait-view=/.test(portrait[0]), !r.canChangeImage, 'otherwise opens the art full size');

      const empty = draw.html(base);
      const ph = empty.match(/<(?:div|span)[^>]*data-cs-portrait[^>]*>/)[0];
      assert.equal(/data-cs-change-image/.test(ph), r.canChangeImage, 'an empty portrait opens the picker only when allowed');
      if (!r.canChangeImage) {
        assert.ok(!/data-cs-portrait-view/.test(ph), 'an empty portrait opens nothing for anyone else');
        assert.ok(!/tabindex/.test(ph), 'an empty portrait is not focusable for anyone else');
      }
    });
  }
}
