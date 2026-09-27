#!/usr/bin/env node
/**
 * Unit tests for the pure builder functions of widgets/rulebook-frontpage.js:
 * refBrowserUrl (the reference-browser link the "soon" buttons now use),
 * buildLairConfig (the example player's Lair context), and the Lich's Lair
 * sheet-mode/teaching-panel markup. The widget calls Chronicle.register() at
 * load time, so global.Chronicle must exist BEFORE require() — the same
 * reasoning as the fold engine / example player's own test seams.
 *
 * Run: `node --test tools/test-rulebook-frontpage.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

global.Chronicle = {
  register: function () {},
  escapeHtml: function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};
const F = require('../widgets/rulebook-frontpage.js');

// ── refBrowserUrl: the "soon" buttons' real destination ──────────────────────
test('refBrowserUrl: builds the systems-route category page, defaulting to rules-glossary', () => {
  assert.equal(F.refBrowserUrl('camp-1'), '/campaigns/camp-1/systems/drawsteel/rules-glossary');
  assert.equal(F.refBrowserUrl('camp-1', 'abilities'), '/campaigns/camp-1/systems/drawsteel/abilities');
});

test('refBrowserUrl: no campaign id -> no route, same as dataUrl', () => {
  assert.equal(F.refBrowserUrl(''), null);
  assert.equal(F.refBrowserUrl(null), null);
});

test('refBrowserUrl and dataUrl agree on how a campaign id is encoded', () => {
  const id = 'a b/c';
  assert.equal(F.refBrowserUrl(id), '/campaigns/' + encodeURIComponent(id) + '/systems/drawsteel/rules-glossary');
  assert.equal(F.dataUrl('x.json', id), '/campaigns/' + encodeURIComponent(id) + '/systems/drawsteel/data/x.json');
});

// ── buildTile: the "Full chapter" control links out or degrades honestly ────
const CHAR_ITEM = {
  slug: 'characteristic-might', name: 'Might',
  description: 'Might drives things.',
  properties: { kind: 'characteristic', emoji: '🗡', color: 'pur', examples: [], related: [], chapterLabel: 'Full chapter' },
};

test('buildTile: with a campaign id, "Full chapter" is a real link to the reference browser', () => {
  const html = F.buildTile(CHAR_ITEM, 0, 'camp-9');
  assert.match(html, /<a class="rb-exbtn rb-ghost" href="\/campaigns\/camp-9\/systems\/drawsteel\/rules-glossary"/);
  assert.match(html, /target="_blank" rel="noopener"/);
  assert.ok(!/rb-exbtn--soon/.test(html.slice(html.indexOf('Full chapter') - 400, html.indexOf('Full chapter'))),
    'the linked chapter button must not also carry the disabled "soon" styling');
});

test('buildTile: with no campaign id, "Full chapter" stays honestly disabled', () => {
  const html = F.buildTile(CHAR_ITEM, 0, '');
  assert.match(html, /<button class="rb-exbtn rb-ghost rb-exbtn--soon" type="button"\s+disabled aria-disabled="true">/);
  assert.ok(!html.includes('<a class="rb-exbtn rb-ghost"'), 'no dead link when there is no route');
});

// ── buildLair: parts 2-4 wired, sheet mode, teaching chips ───────────────────
const SCENE = {
  slug: 'worked-scene-lichs-lair', name: "The Lich's Lair", description: 'd',
  properties: {
    kind: 'worked-scene', emoji: '🏰', kicker: 'WORKED SCENE', kickerNo: '4', chips: [], intro: 'i',
    parts: [
      { slug: 'p1', emoji: '🚪', name: 'Into the lair', note: 'n', play: 'into-the-lair' },
      { slug: 'p2', emoji: '⚔', name: 'Minion skirmish', note: 'n', play: 'minion-skirmish' },
      { slug: 'p3', emoji: '💀', name: 'The lich fight', note: 'n', play: 'the-lich-fight' },
      { slug: 'p4', emoji: '🏆', name: 'Aftermath', note: 'n', play: 'aftermath' },
    ],
    teaches: { chips: [{ key: 'malice', label: 'Malice', term: 'malice', stops: ['p3'] }] },
    table: { heroes: [{ slug: 'orden', fig: '🛡', name: 'Orden' }] },
    rulesInPlay: { p3: [{ key: 'malice', label: 'Malice', term: 'malice' }] },
    lessons: { p3: { kind: 'solo', title: 'x', lede: 'y' } },
  },
};

test('buildLair: uses the FLIP sheet mode, not a hinge side, and carries no leftover dim wiring', () => {
  const html = F.buildLair(SCENE);
  assert.match(html, /data-rb-wing-mode="sheet"/);
  assert.ok(!/data-rb-dim=/.test(html), 'a centred sheet has its own veil — dimming a neighbour block is a leftover from the old hinge design');
});

test('buildLair: every part (1-4) is wired to its own script, not marked "soon"', () => {
  const html = F.buildLair(SCENE);
  for (const slug of ['into-the-lair', 'minion-skirmish', 'the-lich-fight', 'aftermath']) {
    assert.ok(html.includes('data-rbx-play="' + slug + '"'), `part ${slug} is not wired to data-rbx-play`);
    assert.ok(html.includes('data-rbx-script="' + slug + '"'), `part ${slug} has no script container`);
  }
  assert.ok(!/rb-part--soon/.test(html), 'no part should render as "soon" once every part has a script');
});

test('buildLair: renders a hover-card term chip per teaches entry', () => {
  const html = F.buildLair(SCENE);
  assert.match(html, /data-rb-term="malice"[^>]*>Malice</);
});

// ── buildLairConfig: the example player's Lair context ───────────────────────
test('buildLairConfig: maps script slug -> part slug, and passes table/rulesInPlay/lessons through', () => {
  const cfg = F.buildLairConfig(SCENE);
  assert.deepEqual(cfg.partsBySlug, {
    'into-the-lair': 'p1', 'minion-skirmish': 'p2', 'the-lich-fight': 'p3', 'aftermath': 'p4',
  });
  assert.deepEqual(cfg.table, SCENE.properties.table);
  assert.deepEqual(cfg.rulesInPlay, SCENE.properties.rulesInPlay);
  assert.deepEqual(cfg.lessons, SCENE.properties.lessons);
});

test('buildLairConfig: tolerates a missing scene (data still loading / absent)', () => {
  const cfg = F.buildLairConfig(null);
  assert.deepEqual(cfg.partsBySlug, {});
  assert.deepEqual(cfg.table, {});
});

// ── buildReader: readerExtras replaces the old hard-coded example/related ───
const HERO = {
  slug: 'hero-power-roll', name: 'Everything is a Power Roll', description: 'd',
  properties: {
    kind: 'hero', kickerNo: '1', kicker: 'K', readCrumb: 'c', reader: [{ type: 'p', text: 'body' }],
    readerExtras: {
      example: 'kaelen-swings',
      related: [{ icon: '💪', label: 'Might', goto: 'card', target: 't-might' }],
    },
  },
};

test('buildReader: plays hero.readerExtras.example and renders its related chips', () => {
  const html = F.buildReader(HERO);
  assert.ok(html.includes('data-rbx-play="kaelen-swings"'));
  assert.ok(html.includes('data-rbx-script="kaelen-swings"'));
  assert.ok(html.includes('data-rb-goto-card="t-might"'));
});

test('buildReader: a hero with no readerExtras renders no example row and no related row', () => {
  const bare = { slug: 'x', name: 'X', description: 'd', properties: { reader: [] } };
  const html = F.buildReader(bare);
  assert.ok(!html.includes('data-rbx-play'));
  assert.ok(!html.includes('RELATED'));
});

// ── the seed data actually matches what these builders expect ───────────────
test('seed data/rulebook-frontpage.json: parts carry slug+play, and glossary terms used by teaches/rulesInPlay/lessons exist', () => {
  const items = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rulebook-frontpage.json'), 'utf8'));
  const glossary = JSON.parse(readFileSync(join(HERE, '..', 'data', 'rules-glossary.json'), 'utf8'));
  const glossarySlugs = new Set(glossary.map((g) => g.slug));
  const scene = items.find((i) => i.properties && i.properties.kind === 'worked-scene');
  assert.ok(scene, 'a worked-scene item exists');

  const parts = scene.properties.parts;
  assert.equal(parts.length, 4);
  for (const part of parts) {
    assert.ok(part.slug && part.play, `part ${part.name} needs both a slug and a play script`);
  }

  const terms = new Set();
  for (const chip of scene.properties.teaches.chips) terms.add(chip.term);
  for (const list of Object.values(scene.properties.rulesInPlay)) for (const c of list) terms.add(c.term);
  for (const missing of [...terms].filter((t) => !glossarySlugs.has(t))) {
    assert.fail(`teaches/rulesInPlay references glossary term "${missing}", which rules-glossary.json lacks`);
  }

  const hero = items.find((i) => i.properties && i.properties.kind === 'hero');
  assert.ok(hero.properties.readerExtras && hero.properties.readerExtras.example, 'the hero carries readerExtras.example');
});
