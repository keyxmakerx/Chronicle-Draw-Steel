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

test('buildLair: every part is wired to its own script, not marked "soon"', () => {
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

// ── buildLair: the open sheet is a real dialog, not just a styled panel ─────
test('buildLair: the sheet carries dialog semantics — role, aria-modal, and an aria-label naming the scene', () => {
  const html = F.buildLair(SCENE);
  assert.match(html, /<div class="rb-wing" role="dialog" aria-modal="true" aria-label="The Lich's Lair" data-rbx-board>/);
});

test('buildLair: dialog semantics sit on the sheet itself, not the host card', () => {
  const html = F.buildLair(SCENE);
  const hostOpenTag = html.slice(0, html.indexOf('<div class="rb-wing"'));
  assert.ok(!/role="dialog"/.test(hostOpenTag), 'the host card (the trigger) must not itself claim to be the dialog');
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
  assert.deepEqual(parts.map((p) => p.play), [
    'bursting-the-door', 'the-grapple', 'kaelen-swings', 'into-the-lair', 'minion-skirmish', 'the-lich-fight', 'aftermath',
  ], 'the seven parts, in the signed board\'s chip order');
  for (const part of parts) {
    assert.ok(part.slug && part.play, `part ${part.name} needs both a slug and a play script`);
  }
  assert.ok(parts.some((p) => p.slug === scene.properties.openOn), 'openOn names one of the parts');
  assert.equal(F.buildLairConfig(scene).openOn, 'kaelen-swings', 'the board opens on Kaelen swings, as signed');

  const terms = new Set();
  for (const chip of scene.properties.teaches.chips) terms.add(chip.term);
  for (const list of Object.values(scene.properties.rulesInPlay)) for (const c of list) terms.add(c.term);
  for (const missing of [...terms].filter((t) => !glossarySlugs.has(t))) {
    assert.fail(`teaches/rulesInPlay references glossary term "${missing}", which rules-glossary.json lacks`);
  }

  const hero = items.find((i) => i.properties && i.properties.kind === 'hero');
  assert.ok(hero.properties.readerExtras && hero.properties.readerExtras.example, 'the hero carries readerExtras.example');
});

// An open Lair card must not keep (or ease out of) a transform: a transformed
// ancestor is the containing block of the fixed sheet inside it, so the sheet
// opened off-screen and focusing it scrolled the whole page.
test('css: an open Lair card has no transform and no transform transition', () => {
  const sheet = F.css();
  const rules = sheet.match(/[^{}]*\.rb-lair\.is-open[^{}]*\{[^}]*\}/g) || [];
  const open = rules.find((r) => /\.rb-lair\.is-open\s*,|\.rb-lair\.is-open\{/.test(r) && /cursor:default/.test(r));
  assert.ok(open, 'the open-card rule exists');
  assert.match(open, /\.rb-lair\.is-open:hover/, 'the rule also covers the hovered open card');
  assert.match(open, /transform:none/);
  const transition = (open.match(/transition:([^;}]*)/) || [])[1];
  assert.ok(transition, 'the open card sets its own transition');
  assert.doesNotMatch(transition, /transform/, 'no transform transition while open');
});

test('fold engine: opening or closing a sheet never scrolls the page', () => {
  const src = readFileSync(join(HERE, '..', 'widgets', 'rulebook-fold-engine.js'), 'utf8');
  const bare = src.match(/(?:_wingReturnFocus|host|wing|firstCtl|readerSheet|firstBtn|_readerReturnFocus|readerTrigger)\.focus\(\)/g);
  assert.equal(bare, null, `sheet focus calls without preventScroll: ${bare}`);
});

// ── the board: one column with a header, part chips, the scene and drawers ──
test('buildLair: the board is one column: header, part chips, the parts, then two drawers', () => {
  const html = F.buildLair(SCENE);
  const order = ['data-rbx-board-title', 'data-rbx-board-replay', 'data-rb-close-wing', 'class="rb-lbparts"',
    'data-rbx-script="into-the-lair"', 'data-rbx-lair-table', 'data-rbx-lair-rules'];
  let at = -1;
  for (const mark of order) {
    const i = html.indexOf(mark);
    assert.ok(i > at, `${mark} comes after the previous piece of the board`);
    at = i;
  }
  assert.match(html, /<details><summary>THE TABLE<\/summary><div class="rb-lbin" data-rbx-lair-table>/);
  assert.match(html, /<details><summary>RULES IN THIS PART<\/summary>/);
  assert.ok(html.indexOf('data-rbx-lair-table') > html.indexOf('<div class="rb-wing"'), 'the drawers live inside the board');
  for (const gone of ['data-rb-sheet-side', 'data-rb-sheet-tabs', 'data-rb-sheet-below', 'data-rbx-back', 'rb-lair-overview'])
    assert.ok(!html.includes(gone), `${gone} belongs to the old side-panel board`);
});

test('buildLair: each part is a chip that plays its own board container', () => {
  const html = F.buildLair(SCENE);
  const chips = html.slice(html.indexOf('class="rb-lbparts"'), html.indexOf('data-rb-sheet-body'));
  assert.equal((chips.match(/<button class="rb-lbchip" type="button" data-rbx-play=/g) || []).length, 4);
  for (const slug of ['into-the-lair', 'aftermath'])
    assert.ok(html.includes(`id="rbx-lair-${slug}" data-rbx-script="${slug}"`), `${slug} has an id the reader's container does not share`);
});

// ── the card is the closed pop-up book ───────────────────────────────────────
test('buildLair: the card face is the closed book, with the title and description beside it', () => {
  const html = F.buildLair(SCENE);
  const face = html.slice(0, html.indexOf('<div class="rb-wing"'));
  assert.ok(face.includes('data-rb-sheet-token'), 'the closed book is the engine token');
  assert.match(face, /<div class="rb-bkcover"><span>The Lich's Lair<\/span><\/div>/, 'the cover carries the scene name, as the board book does');
  assert.match(face, /<div class="rb-bkspread" data-rb-sheet-tilt>/, 'the spread is what eases into the board book\'s tilt');
  assert.equal((face.match(/data-rb-sheet-fade/g) || []).length, 2, 'the page edge and the shadow are the card\'s alone');
  assert.match(face, /<div class="rb-bkslot" aria-hidden="true">/, 'the drawing is decoration; the card itself is the control');
  assert.match(face, /<h3>🏰 The Lich's Lair<\/h3>/);
  assert.match(face, /<div class="rb-d">d<\/div>/);
  assert.ok(face.indexOf('data-rb-sheet-token') < face.indexOf('<h3>'), 'the book comes before the text');
});

test('buildLair: the host tells the engine where the book lands and which piece it tilts into', () => {
  const html = F.buildLair(SCENE);
  assert.match(html, /data-rb-sheet-land="\.rbx-on \.rbs-fit"/, 'the playing part\'s stage');
  assert.match(html, /data-rb-sheet-land-tilt="\.rbs-spread"/);
});

test('buildLair: no folded-map pieces are left on the card or the board', () => {
  const html = F.buildLair(SCENE);
  for (const gone of ['data-rb-sheet-surface', 'data-rb-sheet-cover', 'data-rb-sheet-shade', 'data-rb-sheet-crease', 'rb-lbcover', 'rb-lbshade', 'rb-lbcrease'])
    assert.ok(!html.includes(gone), `${gone} belonged to the folded map`);
  assert.ok(!/\.rb-lbcover|\.rb-lbshade|\.rb-lbcrease/.test(F.css()), 'no folded-map styles remain');
});

// The hand-over is invisible only if the card's book is the scene's book:
// the same stage, perspective and spread box. Read both stylesheets.
test('css: the card book is drawn on the same stage as the scene book', () => {
  const P = require('../widgets/rulebook-example-player.js');
  const scene = P.sceneCss(), card = F.css();
  const rule = (src, sel) => (src.match(new RegExp(sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}')) || [])[1] || '';
  const prop = (body, k) => (body.match(new RegExp('(?:^|;)' + k + ':([^;]*)')) || [])[1];
  for (const k of ['width', 'height']) assert.equal(prop(rule(card, '.rb-bkfit'), k), prop(rule(scene, '.rbs-fit'), k), `stage ${k}`);
  for (const k of ['perspective', 'perspective-origin']) assert.equal(prop(rule(card, '.rb-bkbook'), k), prop(rule(scene, '.rbs-book'), k), k);
  for (const k of ['left', 'top', 'width', 'height']) assert.equal(prop(rule(card, '.rb-bkspread'), k), prop(rule(scene, '.rbs-spread'), k), `spread ${k}`);
  assert.equal(prop(rule(card, '.rb-bkpl'), 'transform'), prop(rule(scene, '.rbs-closed .rbs-pl'), 'transform'), 'the left page folds over the same way');
  assert.equal(prop(rule(card, '.rb-bkcover'), 'transform'), prop(rule(scene, '.rbs-cover'), 'transform'), 'the cover sits on the page the same way');
  assert.notEqual(prop(rule(card, '.rb-bkspread'), 'transform'), prop(rule(scene, '.rbs-spread'), 'transform'), 'only the tilt differs, the engine eases it');
});

test('css: a shut board takes no room, so a hovered card cannot widen the page', () => {
  assert.match(F.css(), /\[data-rb-wing-mode="sheet"\]:not\(\.is-open\)>\.rb-wing\{display:none\}/);
});

test('css: the travelling book rides over the board only while the card is open', () => {
  const css = F.css();
  assert.match(css, /\.rb-lair\.is-open \.rb-bk\{z-index:64\}/);
  assert.doesNotMatch((css.match(/\.rb-bk\{[^}]*\}/) || [''])[0], /z-index/, 'a closed card\'s book never sits over other folds');
});

test('buildLair: nothing of the board sits outside the sheet, so the card never grows', () => {
  const html = F.buildLair(SCENE);
  const wingAt = html.indexOf('<div class="rb-wing"');
  assert.ok(html.endsWith('</div></div></div>'), 'the card closes straight after the sheet');
  assert.ok(!/data-rbx-lair-|data-rbx-script/.test(html.slice(0, wingAt)), 'no slot before the sheet');
  assert.ok(!/\.rb-lbside|\.rb-lbtabs/.test(F.css()), 'no side-panel or tab-bar styles remain');
});

test('buildLairConfig: carries the cover title and the part the board opens on, defaulting to the first', () => {
  const cfg = F.buildLairConfig(SCENE);
  assert.equal(cfg.title, "The Lich's Lair");
  assert.equal(cfg.openOn, 'into-the-lair', 'no openOn: the first part');
  const named = F.buildLairConfig({ ...SCENE, properties: { ...SCENE.properties, openOn: 'p3' } });
  assert.equal(named.openOn, 'the-lich-fight');
});

test('css: once the book has landed on the board, the card keeps its text and an empty slot, not a second book', () => {
  const css = F.css();
  assert.match(css, /\.rb-lair\.rb-sheet-away \.rb-bk\{visibility:hidden\}/);
  assert.doesNotMatch(css, /\.rb-lair\.rb-sheet-away\{/, 'the card itself stays');
});
