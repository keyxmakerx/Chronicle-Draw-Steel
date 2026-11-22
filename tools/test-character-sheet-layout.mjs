#!/usr/bin/env node
/**
 * Layout contract for widgets/character-sheet.js: the identity band, the
 * schema order (which is also the phone order), the removed stub buttons and
 * the ability tabs.
 *
 * Run: `node --test tools/test-character-sheet-layout.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');

const ids = (schema) => schema.rows.map((r) => r.columns.map((c) => c.boxes.map((b) => b.id)));

test('rIdentity: origin values are buttons only when the host allows editing', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const data = { name: 'Bren', foundryLinked: true, fields: { ancestry: 'Human', class: 'Fury', level: 3 } };
  const ro = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: false }));
  assert.ok(!/data-cs-pick=/.test(ro) && !/data-cs-change-image/.test(ro), 'read-only: no pickers, no Change chip');
  assert.ok(/set in Foundry/.test(ro) && /Fury/.test(ro), 'class shown read-only with the hint');
  const rw = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: true }));
  for (const k of ['ancestry', 'culture', 'career', 'kit']) assert.ok(rw.includes('data-cs-pick="' + k + '"'), k);
  assert.ok(!/data-cs-change-image/.test(rw), 'identity editing alone gives no Change chip');
  const gm = cs.rIdentity({}, Object.assign({}, data, { canEditIdentity: true, canChangeImage: true }));
  assert.ok(/data-cs-change-image/.test(gm), 'Change chip when the picture may be replaced');
  assert.ok(!/>Bren</.test(rw), "the name is Chronicle's header job");
});

test('rIdentity: without Chronicle.pickChoice the values stay plain text', () => {
  const saved = globalThis.window.Chronicle.pickChoice;
  delete globalThis.window.Chronicle.pickChoice;
  const html = cs.rIdentity({}, { name: 'Bren', canEditIdentity: true, fields: { ancestry: 'Human' } });
  assert.ok(!/data-cs-pick=/.test(html) && /Human/.test(html));
  globalThis.window.Chronicle.pickChoice = saved;
});

test('no stub buttons (Roll, Level Up, Share, Roll Might) remain', () => {
  const data = { name: 'Bren', fields: { stamina_max: 30, stamina_current: 30 } };
  const html = cs.rIdentity({}, data) + cs.rVitals({}, data);
  assert.ok(!/data-cs-act|Roll Might|Level Up|Share|coming later/i.test(html));
});

test('buildSchema: identity, vitals, characteristics, then main | side columns', () => {
  const rows = ids(cs.buildSchema({ isGm: false, isOwner: false, armoryItems: false }));
  assert.deepEqual(rows[0], [['ds-identity']]);
  assert.deepEqual(rows[1], [['ds-vitals']]);
  assert.deepEqual(rows[2], [['ds-characteristics']]);
  assert.deepEqual(rows[3][0], ['ds-abilities', 'ds-features', 'ds-skills']);
  assert.deepEqual(rows[3][1], ['ds-combat', 'ds-kit', 'ds-damage', 'ds-inventory', 'ds-progression']);
  assert.equal(rows.length, 4, 'no Background or GM lore for a plain viewer');
});

test('buildSchema: armory-items drops the in-sheet Inventory; Background and GM lore are gated', () => {
  const flat = (d) => ids(cs.buildSchema(d)).flat(2);
  assert.ok(!flat({ armoryItems: true }).includes('ds-inventory'));
  assert.ok(flat({ isOwner: true }).includes('ds-notes') && !flat({ isOwner: true }).includes('ds-gmlore'));
  assert.ok(flat({ isGm: true }).includes('ds-notes') && flat({ isGm: true }).includes('ds-gmlore'));
});

test('rAbilities: a tablist with counts, signature open first', () => {
  const abilities = [
    { name: 'Hit', category: 'signature' }, { name: 'Smash', category: 'heroic', cost: 3 },
    { name: 'Aid' }, { name: 'Run' }
  ];
  const html = cs.rAbilities({}, { fields: { abilities_json: JSON.stringify(abilities) } });
  assert.ok(/role="tablist"/.test(html));
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.ok(/data-ds-tab="maneuver"[^>]*>Other <em>2<\/em>/.test(html), 'not signature or heroic: named Other, not Maneuver');
  assert.ok(/id="ds-tab-signature"[^>]*aria-selected="true"/.test(html));
});

// ── Paper layout (Chronicle.sheetMotion present) ──────────────────────────
const PAPER = {
  name: 'Bren', isGm: true, isOwner: true, canEditIdentity: true, canChangeImage: true,
  fields: {
    ancestry: 'Human', class: 'Tactician', level: 2, stamina_current: 19, stamina_max: 42, winded: 21,
    recoveries: 7, recoveries_max: 10, heroic_resource_current: 2, surges: 1, might: 2, presence: -1,
    victories: 3, xp: 9, backstory: 'A veteran.', gm_notes: 'secret',
    skills_json: JSON.stringify(['endurance']),
    features_json: JSON.stringify([{ name: 'Mark', level: 1, description: 'Mark a foe' }]),
    treasures_json: JSON.stringify([{ name: 'Torch', quantity: 3 }]),
    kit_details_json: JSON.stringify([{ name: 'Armor', meleeDamageT1: 2, stamina: 12 }]),
    abilities_json: JSON.stringify([{ name: 'Hit', category: 'signature' }, { name: 'Aid' }])
  }
};
const panelIds = (html) => [...html.matchAll(/<template data-sheet-panel="([^"]*)"/g)].map((m) => m[1]);
const sectionIds = (html) => [...html.matchAll(/data-sheet-section="([^"]*)"/g)].map((m) => m[1]);

test('paperAvailable follows Chronicle.sheetMotion.mount', () => {
  const C = globalThis.window.Chronicle;
  assert.equal(cs.paperAvailable(), false, 'older Chronicle: box render');
  C.sheetMotion = { mount() {}, land() {} };
  assert.equal(cs.paperAvailable(), true);
  delete C.sheetMotion;
  assert.equal(cs.paperAvailable(), false);
});

test('paperSheetHtml: contract root, folio, paper stack, changing numbers', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(/^<div class="sh-root" data-sheet>/.test(html), 'data-sheet root');
  assert.ok(/data-sheet-folio/.test(html));
  assert.ok(/<div class="paper-stack[^"]*"><article class="paper[ "]/.test(html), '.paper-stack > .paper');
  for (const v of ['stamina', 'hr', 'surges', 'rec']) assert.ok(html.includes('data-v="' + v + '"'), 'data-v ' + v);
  for (const v of ['victories', 'xp']) assert.ok(html.includes('data-pv="' + v + '"'), 'data-pv ' + v);
});

test('paperSheetHtml: every section has an open button and a matching template panel', () => {
  const html = cs.paperSheetHtml(PAPER);
  const secs = sectionIds(html);
  const panels = panelIds(html);
  for (const id of secs) assert.ok(panels.includes(id), 'panel ' + id);
  for (const id of panels) assert.ok(html.includes('data-sheet-open="' + id + '"'), 'open button ' + id);
  for (const id of secs) assert.ok(html.includes('data-sheet-open="' + id + '"'), 'open button ' + id);
  assert.ok(secs.includes('kit') && !/data-sheet-section="abilities"/.test(html), 'kit is a ledger line; abilities open from their own link');
  assert.ok(/<template data-sheet-panel="abilities" data-title="[^"]+" data-kind="[^"]+">/.test(html));
  assert.ok(!/<template[^>]*>\s*<template/.test(html));
});

test('paperPanels: items, notes and GM lore follow the same gates as the box schema', () => {
  const ids2 = (d) => cs.paperPanels(d).map((p) => p.id);
  assert.ok(ids2({ fields: {} }).includes('items'));
  assert.ok(!ids2({ armoryItems: true, fields: {} }).includes('items'));
  assert.ok(!ids2({ fields: {} }).includes('notes'), 'plain viewer: no notes');
  assert.ok(ids2({ isOwner: true, fields: {} }).includes('notes'));
  const lore = (d) => cs.paperPanels(d).find((p) => p.id === 'notes').html.includes('secret');
  assert.equal(lore({ isOwner: true, fields: { gm_notes: 'secret' } }), false, 'owner never sees GM lore');
  assert.equal(lore({ isGm: true, fields: { gm_notes: 'secret' } }), true);
  const html = cs.paperSheetHtml({ fields: {} });
  assert.ok(!/data-sheet-section="notes"/.test(html) && !/data-sheet-section="items"[^]*armory/.test(html));
});

test('GM lore written as HTML reads as text, with its paragraphs kept', () => {
  const gm = '<p>Moved from the backstory &amp; hidden.</p><p>Ended up thrown out.</p>';
  const html = cs.paperPanels({ isGm: true, fields: { gm_notes: gm } }).find((p) => p.id === 'notes').html;
  assert.ok(!/&lt;p&gt;|&lt;\/p&gt;/.test(html), 'no tag text shown');
  assert.ok(/Moved from the backstory &amp; hidden\.\n\nEnded up thrown out\./.test(html), 'paragraphs survive as line breaks');
});

test('paper folds use the contract: details > .fold-body > .fold-in[data-move=fold]', () => {
  const html = cs.paperPanels(PAPER).map((p) => p.html).join('');
  assert.ok(/<details[^>]*data-sheet-fold/.test(html), 'a fold is present');
  assert.ok(/<div class="fold-body"><div class="fold-in" data-move="fold">/.test(html));
});

test('paper identity: the line holds what is chosen, and every origin keeps a picker hook', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const rw = cs.pIdentity(PAPER);
  for (const k of ['ancestry', 'culture', 'career', 'kit']) assert.ok(rw.includes('data-cs-pick="' + k + '"'), k);
  assert.ok(/data-cs-pick-fold/.test(rw) && /data-cs-change-image/.test(rw));
  const line = rw.match(/<p class="sh-idline[^"]*">([^]*?)<\/p>/)[1];
  assert.ok(/Human/.test(line) && /Tactician 2/.test(line), 'ancestry, class and level on the line');
  assert.ok(!/data-cs-pick="(culture|career|kit)"/.test(line) && !/Not set/.test(rw), 'a choice not made is not on the line');
  assert.ok(!/class="sh-dot"/.test(line), "Chronicle's share page owns .sh-dot and draws a disc on it");
  const ro = cs.pIdentity(Object.assign({}, PAPER, { canEditIdentity: false, canChangeImage: false }));
  assert.ok(!/data-cs-pick=/.test(ro) && !/data-cs-change-image/.test(ro));
  assert.ok(/data-v="origin-ancestry"/.test(ro), 'value is still a changing number');
  assert.ok(!/<img/.test(rw), 'the page header owns the picture');
});

test('paper identity: the name opens its entry, and Change beside it is the picker', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const hero = Object.assign({}, PAPER, { campaignId: 'c-1', entityId: 'h-9',
    fields: Object.assign({}, PAPER.fields, { ancestry: "Hakaan's Kin", kit: 'High Elf' }) });
  const rw = cs.pIdentity(hero);
  const href = '/campaigns/c-1/systems/drawsteel/named/ancestry?name=Hakaan%27s%20Kin&amp;hero=h-9';
  const link = rw.match(/<a class="sh-idpick sh-idname" href="([^"]+)" data-entry-peek="([^"]+)"[^>]*>([^<]*)<\/a>/);
  assert.ok(link, 'the name is a link');
  assert.equal(link[1], href, 'a real address, by kind and name, for this hero');
  assert.equal(link[2], href, 'the same address opens the peek');
  assert.ok(/^Hakaan(&#39;|')s Kin$/.test(link[3]), 'the name is the link text');
  for (const b of rw.matchAll(/<button[^>]*>([^]*?)<\/button>/g)) assert.ok(!/sh-idname/.test(b[1]), 'the link is never inside a button');
  const change = rw.match(/<button type="button" class="sh-idpick sh-idchange" data-cs-pick="ancestry"[^>]*>([^<]*)<\/button>/);
  assert.ok(change && change[1] === 'Change', 'Change is its own quiet word');
  assert.ok(/aria-label="Change ancestry"/.test(rw));
  assert.ok(/named\/kit\?name=High%20Elf&amp;hero=h-9/.test(rw), 'every origin links the same way');
  const ro = cs.pIdentity(Object.assign({}, hero, { canEditIdentity: false }));
  assert.ok(/sh-idname/.test(ro) && !/sh-idchange/.test(ro) && !/data-cs-pick=/.test(ro), 'a reader who may not edit gets the link and no Change');
  const nowhere = cs.pIdentity(Object.assign({}, hero, { campaignId: '' }));
  assert.ok(!/sh-idname/.test(nowhere) && /data-v="origin-ancestry"/.test(nowhere), 'no campaign, no address: the name stays text');
});

test('paper identity: choices not made are named on one "Still to choose" line', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const todo = (html) => (html.match(/<p class="sh-idtodo[^"]*">([^]*?)<\/p>/) || [])[1];
  const some = todo(cs.pIdentity(PAPER));
  assert.ok(/Still to choose/.test(some));
  assert.deepEqual([...some.matchAll(/data-cs-pick="([a-z]+)"/g)].map((m) => m[1]), ['culture', 'career', 'kit'], 'in the order the book makes them');
  assert.ok(/aria-label="Choose culture"/.test(some));
  const ro = todo(cs.pIdentity(Object.assign({}, PAPER, { canEditIdentity: false })));
  assert.ok(/Culture/.test(ro) && !/<button/.test(ro), 'a reader who may not edit sees the words, not buttons');
  const full = Object.assign({}, PAPER, { fields: Object.assign({}, PAPER.fields, { culture: 'Nomadic', career: 'Disciple', kit: 'Mountain' }) });
  assert.equal(todo(cs.pIdentity(full)), undefined, 'the line goes when nothing is left');
});

test('paper identity: the paper styles keep culture and career one fold away; the quiet look labels every choice', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const one = cs.pIdentity(Object.assign({}, PAPER, { foundryLinked: true, fields: Object.assign({}, PAPER.fields, { career: 'Disciple' }) }));
  const fold = one.match(/<details class="ft sh-origins sh-id-l[^>]*>([^]*?)<\/details>/)[1];
  assert.ok(/<summary>Career and complication<\/summary>/.test(fold) && /Disciple/.test(fold) && /set in Foundry/.test(fold));
  const none = cs.pIdentity(Object.assign({}, PAPER, { canEditIdentity: false, fields: { class: 'Fury', level: 1 } }));
  assert.ok(!/sh-origins/.test(none) && /set in Foundry/.test(none), 'no empty fold; the Foundry hint is still said');
  const set = one.match(/<dl class="sh-idset sh-id-q">([^]*?)<\/dl>/)[1];
  assert.deepEqual([...set.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]), ['Ancestry', 'Career', 'Complication']);
  assert.ok(/<p class="sh-idwho sh-id-q">[^]*Tactician[^]*level 2/.test(one), 'the class is the heading');
});

test('paper sheet: the name is printed once, as the computer dashboard\'s heading; the face leaves it to the page header', () => {
  const full = cs.paperSheetHtml(Object.assign({}, PAPER, { name: 'Zorblax' }));
  // The pinned strip repeats it for sighted readers once the header scrolls
  // away; it is hidden from screen readers, so it is not a second reading.
  const pin = full.match(/<div class="sh-dpin sh-dq" aria-hidden="true">[^]*?<\/div><\/div>/);
  assert.ok(pin && />Zorblax</.test(pin[0]), 'the pinned strip carries the name, hidden from screen readers');
  const html = full.replace(pin[0], '');
  assert.deepEqual(html.match(/>Zorblax</g), ['>Zorblax<']);
  assert.ok(/<h2 class="sh-dname sh-dq">Zorblax<\/h2>/.test(html), 'only the dashboard, which no phone or paper style shows, prints it');
  assert.ok(/Hero · Draw Steel/.test(html));
});

test('one word per look on the parts: no Rules, Details or Sources labels', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(!/class="sh-pull">(Rules|Details|Sources)</.test(html));
  assert.equal((html.match(/class="sh-pull"><span class="only-paper">Pull out<\/span><span class="only-modern">Open<\/span>/g) || []).length, (html.match(/class="sh-pull"/g) || []).length);
});

test('phone: the sheet parts fill the column and the recoveries dots wrap', () => {
  const src = readFileSync(new URL('../widgets/character-sheet.js', import.meta.url), 'utf8');
  assert.ok(/\.sh-body \{ display:flex;flex-direction:column;align-items:stretch;/.test(src), 'a part is as wide as the sheet');
  assert.ok(/\.sh-pips \{ display:block;max-width:100%;[^']*word-break:break-all/.test(src), 'twelve dots wrap inside their column');
});

test('mountSheet: without sheetMotion the box render runs (no paper markup)', () => {
  const el = { innerHTML: '', querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {} };
  assert.equal(cs.paperAvailable(), false);
  const html = cs.buildSchema({}) && cs.rIdentity({}, PAPER);
  assert.ok(!/data-sheet/.test(html), 'box identity carries no paper contract');
  assert.equal(el.innerHTML, '');
});

test('paper abilities panel lists every ability of a group as its own fold', () => {
  const abilities = [
    { name: 'Blessed Light', category: 'signature' }, { name: 'Drain', category: 'signature' },
    { name: 'Judgment', category: 'heroic', cost: 7 }, { name: 'Command', category: 'heroic', cost: 3 },
    { name: 'Shove', type: 'maneuver' }
  ];
  const data = { name: 'Tyne', fields: { abilities_json: JSON.stringify(abilities) } };
  const html = cs.paperPanels(data).find((p) => p.id === 'abilities').html;
  for (const a of abilities) assert.ok(html.includes('data-ds-name="' + a.name + '"'), a.name);
  assert.equal((html.match(/<details class="ft ab-fold/g) || []).length, abilities.length, 'one fold each');
  assert.equal((html.match(/ab-fold is-in/g) || []).length, 1, 'only the first of the open group starts open');
  assert.ok(html.indexOf('Command') < html.indexOf('Judgment'), 'cheapest first within a group');
  assert.ok(!/data-ds-pane/.test(html), 'no single-ability detail pane on paper');
})

test('paper abilities panel escapes ability names', () => {
  const data = { name: 'X', fields: { abilities_json: JSON.stringify([{ name: '<img src=x onerror=1>"', category: 'signature' }]) } };
  const html = cs.paperPanels(data).find((p) => p.id === 'abilities').html;
  assert.ok(!/<img src=x/.test(html) && !/data-ds-name="<img/.test(html));
});

// ── Abilities on the face ─────────────────────────────────────────────────
const dmg = (a, b, c, types) => [{ damage: { tier1: { value: a, types: types || [] }, tier2: { value: b, types: types || [] }, tier3: { value: c, types: types || [] } } }];
const FACE = [
  { name: 'Halt', category: 'signature', type: 'action', distanceType: 'melee', distance: 1, powerRollChars: ['might'], tiers: dmg('2 + @chr', '5 + @chr', '7 + @chr', ['holy']), effectAfter: 'The target is slowed. Save ends.' },
  { name: 'Arrest', category: 'heroic', type: 'action', cost: 5, powerRollChars: ['might'], tiers: dmg('6 + @chr', '9 + @chr', '13 + @chr') },
  { name: 'Driving', category: 'heroic', type: 'action', cost: 3, powerRollChars: ['might'], tiers: dmg('3 + @chr', '6 + @chr', '9 + @chr') },
  { name: 'Judgment', type: 'maneuver', distanceType: 'ranged', distance: 10, effectAfter: 'Judge one creature.' },
  { name: 'Wrath', type: 'triggered', trigger: 'A judged creature hurts an ally' },
  { name: 'Strike', category: 'freeStrike', type: 'none', powerRollChars: ['might'], tiers: dmg('2 + @chr', '2 + @chr', '2 + @chr') }
];
const faceData = (abs, extra) => ({ name: 'Tyne', fields: Object.assign({ might: 2, heroic_resource_name: 'Wrath', heroic_resource_current: 4, abilities_json: JSON.stringify(abs) }, extra || {}) });

test('actionKind groups by when an ability is used, from the type Foundry sends', () => {
  const k = (a) => cs.actionKind(a);
  for (const t of ['main', 'action']) assert.equal(k({ type: t }), 'main', t);
  assert.equal(k({ type: 'main', name: 'Charge' }), 'main', 'a plain main action with no roll is still a main action');
  for (const t of ['maneuver', 'freeManeuver', 'move', 'free']) assert.equal(k({ type: t }), 'maneuver', t);
  for (const t of ['triggered', 'freeTriggered']) assert.equal(k({ type: t }), 'triggered', t);
  assert.equal(k({ type: 'none', category: 'freeStrike' }), 'free');
  assert.equal(k({ category: 'signature' }), 'main', 'unknown type: signature is a main action');
  assert.equal(k({ cost: 3 }), 'main');
  assert.equal(k({ name: 'Plain' }), 'maneuver');
});

test('common abilities are the pack\'s own list, and a hero\'s abilities come before them', () => {
  const pack = JSON.parse(readFileSync(new URL('../data/abilities.json', import.meta.url), 'utf8'))
    .filter((a) => a.properties && a.properties.category === 'common' && a.name !== 'Free Strike')
    .map((a) => a.name.toLowerCase()).sort();
  assert.deepEqual([...cs.COMMON_ABILITIES].sort(), pack, 'free strikes have their own heading');
  assert.ok(cs.isCommonAbility({ name: 'Charge', type: 'main' }));
  assert.ok(!cs.isCommonAbility({ name: 'Charge', category: 'signature' }) && !cs.isCommonAbility({ name: 'Heal', cost: 3 }), "a class ability that shares a name is the hero's own");
  const html = cs.pAbilities(faceData([
    { name: 'Defend', type: 'main' }, { name: 'Smite', type: 'main', category: 'signature' },
    { name: 'Grab', type: 'maneuver' }, { name: 'Advance', type: 'move' }, { name: 'Bless', type: 'maneuver' }
  ]));
  assert.ok(html.indexOf('Smite') < html.indexOf('data-cs-common="main"'), 'own main action first');
  assert.ok(html.indexOf('Bless') < html.indexOf('data-cs-common="maneuver"'), 'own maneuver first');
  assert.ok(/<details data-cs-common="main" class="ft sx-std is-in" data-sheet-fold open>/.test(html), 'open as rendered: a paper style has no heading to open it with');
  const man = html.slice(html.indexOf('data-cs-common="maneuver"'));
  assert.ok(/Every hero’s maneuvers and moves<\/span><span class="sx-std-c num">2</.test(man) && /Grab/.test(man) && /Advance/.test(man));
});

test('the common fold starts shut only in the quiet look, and keeps what the reader chose', () => {
  const fold = (kind) => {
    const d = { open: true, cls: new Set(['is-in']), getAttribute: () => kind, removeAttribute: () => { d.open = false; } };
    d.classList = { remove: (c) => d.cls.delete(c) };
    return d;
  };
  const root = (style, folds) => ({ getAttribute: () => style, querySelectorAll: () => folds });
  const run = (style, kept) => { const f = [fold('main'), fold('maneuver')]; cs.shutCommonFolds(root(style, f), kept); return f.map((d) => d.open && d.cls.has('is-in')); };
  assert.deepEqual(run('modern', null), [false, false]);
  assert.deepEqual(run(null, null), [false, false], 'no style named is the default look');
  assert.deepEqual(run('ledger', null), [true, true], 'a paper style lists them');
  assert.deepEqual(run('modern', { maneuver: true }), [false, true], 'a redraw keeps an opened fold open');
  assert.deepEqual(run('ledger', { main: false }), [false, true]);
});

test('face: four headings in order, each ability once, empty headings left out', () => {
  const html = cs.pAbilities(faceData(FACE));
  const heads = [...html.matchAll(/<span class="paper-kind">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Main action', 'Maneuver', 'Triggered', 'Free strike']);
  assert.equal((html.match(/<details class="ft sx-line/g) || []).length, FACE.length);
  const only = cs.pAbilities(faceData([FACE[0]]));
  const h2 = [...only.matchAll(/<span class="paper-kind">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(h2, ['Main action', 'Free strike'], 'no Maneuver or Triggered heading with nothing under it');
});

test('face: the hero\'s own tier results, the star, the cost tag and the unaffordable reason', () => {
  const html = cs.pAbilities(faceData(FACE));
  assert.ok(html.includes('4 · 7 · 9 holy'), 'Might 2 worked into the three tiers');
  assert.ok(/role="img" aria-label="Signature">★/.test(html), 'signature star has a spoken label');
  assert.ok(html.includes('3 Wrath</span>') && !html.includes('3 Wrath, you have'), 'affordable: plain cost tag');
  assert.ok(html.includes('5 Wrath, you have 4'), 'unaffordable: the tag gives the reason');
  assert.equal((html.match(/sx-line sx-no/g) || []).length, 1, 'only Arrest is greyed');
  assert.ok(html.indexOf('Driving') < html.indexOf('Arrest'), 'cheaper first');
  assert.ok(html.indexOf('Halt') < html.indexOf('Driving'), 'signature first');
  assert.ok(html.includes('Ranged 10'), 'no power roll: the distance stands in');
  assert.ok(/data-sheet-fold/.test(html) && /data-move="fold"/.test(html), 'unfolds with the Fold move');
  assert.ok(!/data-sheet-open="abilities"[^>]*>Full card/.test(html), 'Full card no longer pulls the side panel');
  assert.equal((html.match(/data-cs-fullcard="\d+" aria-expanded="false">Full card</g) || []).length, FACE.length, 'every line has its own full card');
  assert.equal((html.match(/data-sheet-open="abilities"/g) || []).length, 1, 'the filterable list keeps one way in');
});

test('face: a line\'s Full card points at that ability in the synced list', () => {
  const html = cs.pAbilities(faceData(FACE));
  FACE.forEach((a, i) => {
    const at = html.indexOf('data-cs-fullcard="' + i + '"');
    assert.ok(at > 0, a.name);
    const head = html.slice(html.lastIndexOf('<summary>', at), at);
    assert.ok(head.includes(a.name), a.name + ' owns index ' + i);
  });
  assert.ok(/data-cs-short>/.test(html) && /data-cs-full hidden>/.test(html), 'short card shown, full card empty until asked for');
});

test('face: a free strike is always listed, worked out from the kit when none is synced', () => {
  const kit = JSON.stringify([{ name: 'Armor', meleeDamageT1: 2, meleeDamageT2: 2, meleeDamageT3: 2 }]);
  const html = cs.pAbilities(faceData([], { kit_details_json: kit }));
  assert.ok(/Free strike/.test(html) && /kit \+2 · \+2 · \+2/.test(html));
  assert.ok(/No abilities yet/.test(html));
  assert.ok(/Free strike/.test(cs.pAbilities(faceData([]))), 'listed even with no kit');
});

test('face: ability text is escaped', () => {
  const html = cs.pAbilities(faceData([{ name: '<img src=x onerror=1>', type: 'action', cost: 1, effectAfter: '<b>x</b>', trigger: '<i>t</i>' }]));
  assert.ok(!/<img src=x|<b>x|<i>t/.test(html));
});

test('kit is a quiet ledger line, not a part', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(/data-sheet-section="kit"/.test(html) && /<span class="sh-nm">Kit<\/span>/.test(html));
  assert.ok(!/aria-label="Kit"/.test(html), 'no Kit part in the side column');
});

test('complication: shown with the origins, pickable, and an empty one reads as optional', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const empty = cs.pIdentity(PAPER);
  assert.ok(empty.includes('data-cs-pick="complication"') && /No complication \u2014 optional/.test(empty));
  const todo = (empty.match(/<p class="sh-idtodo[^"]*">([^]*?)<\/p>/) || [])[1];
  assert.ok(!/complication/i.test(todo), 'optional, so never "still to choose"');
  const set = cs.pIdentity(Object.assign({}, PAPER, { fields: Object.assign({}, PAPER.fields, { complication: 'Lucky' }) }));
  assert.ok(/data-v="origin-complication">Lucky</.test(set));
  const ro = cs.pIdentity(Object.assign({}, PAPER, { canEditIdentity: false }));
  assert.ok(!/complication/i.test(ro), 'a reader sees no row for a complication nobody chose');
  const old = cs.rIdentity({}, { name: 'Bren', canEditIdentity: true, fields: {} });
  assert.ok(old.includes('data-cs-pick="complication"') && /No complication/.test(old));
});

test('a Foundry placeholder name is no choice: unset, no entry link, the picker opens empty', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  for (const placeholder of ['Complication', 'New Complication', ' complication ']) {
    const d = Object.assign({}, PAPER, { campaignId: 'c1', fields: Object.assign({}, PAPER.fields, { complication: placeholder }) });
    const html = cs.pIdentity(d);
    assert.ok(/No complication \u2014 optional/.test(html), placeholder + ' reads as unset');
    assert.ok(!/named\/complication/.test(html), placeholder + ' names no entry');
    const old = cs.rIdentity({}, Object.assign({ name: 'Bren', canEditIdentity: true }, { fields: { complication: placeholder } }));
    assert.ok(/No complication/.test(old), placeholder + ' reads as unset in the classic band');
  }
  const real = cs.pIdentity(Object.assign({}, PAPER, { campaignId: 'c1', fields: Object.assign({}, PAPER.fields, { complication: 'Complicated Past' }) }));
  assert.ok(/data-v="origin-complication">Complicated Past</.test(real), 'a real name that only starts with the word stays');
});

test('class and the Foundry line follow whether a Foundry world is linked', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const linked = cs.pIdentity(Object.assign({}, PAPER, { foundryLinked: true }));
  assert.ok(/set in Foundry/.test(linked) && !/data-cs-pick="class"/.test(linked));
  const free = cs.pIdentity(Object.assign({}, PAPER, { foundryLinked: false }));
  assert.ok(!/set in Foundry/.test(free) && free.includes('data-cs-pick="class"'));
  const ro = cs.pIdentity(Object.assign({}, PAPER, { foundryLinked: false, canEditIdentity: false }));
  assert.ok(!/set in Foundry/.test(ro) && !/data-cs-pick=/.test(ro), 'a reader may not pick the class');
  const noClass = cs.pIdentity(Object.assign({}, PAPER, { foundryLinked: false, fields: {} }));
  assert.ok(/aria-label="Choose class"/.test(noClass));
  const old = cs.rIdentity({}, { name: 'Bren', canEditIdentity: true, foundryLinked: false, fields: { class: 'Fury' } });
  assert.ok(old.includes('data-cs-pick="class"') && !/set in Foundry/.test(old));
});

const LONG = 'First paragraph of the tale, told plainly for the table to read.\n\n' +
  'Second paragraph that goes on for a good while so the lead is long enough to stop here and no further than this. ' + 'More words to pad it past the lead length. '.repeat(5) + '\n\n' +
  'Third paragraph the reader only sees after asking to keep reading.';

test('the Notes row and panel are called Story, ids unchanged, and the panel is tall', () => {
  const html = cs.paperSheetHtml(PAPER);
  assert.ok(/data-sheet-section="notes"/.test(html) && />Story</.test(html), 'ledger row labelled Story');
  assert.ok(!/<span class="sh-nm">Notes</.test(html), 'no Notes label left');
  const tpl = html.match(/<template data-sheet-panel="notes"[^>]*>/)[0];
  assert.ok(/data-title="Story"/.test(tpl) && /data-size="tall"/.test(tpl), tpl);
  assert.ok(!/data-size=/.test(html.match(/<template data-sheet-panel="kit"[^>]*>/)[0]), 'other panels keep their size');
});

test('the Story panel reads in place: Keep reading is a quiet fold, no pin, jump words for the GM', () => {
  const html = cs.pNotesPanel(Object.assign({}, PAPER, { fields: Object.assign({}, PAPER.fields, { backstory: LONG }) }));
  assert.ok(/data-sheet-fold/.test(html) && />Keep reading</.test(html) && />Show less</.test(html));
  assert.ok(!/data-cs-read-story|Read full story|paper-pin|data-unpin/.test(html), 'the pin is gone');
  assert.ok(/data-cs-jump="story-bg"/.test(html) && /data-cs-jump="story-gm"/.test(html));
  assert.ok(html.indexOf('First paragraph') < html.indexOf('Keep reading') && html.indexOf('Keep reading') < html.indexOf('Third paragraph'));
  const player = cs.pNotesPanel({ isOwner: true, fields: { backstory: LONG } });
  assert.ok(!/data-cs-jump|GM lore/.test(player), 'no GM jump for a player');
  const short = cs.pNotesPanel({ isOwner: true, fields: { backstory: 'A veteran.' } });
  assert.ok(!/Keep reading/.test(short), 'a short story has nothing to unfold');
});

test('the Items row shows only when the items live in the Armory', () => {
  const on = cs.paperSheetHtml(Object.assign({}, PAPER, { armoryItems: true }));
  assert.ok(/data-cs-go-items/.test(on) && /Go to items/.test(on));
  assert.ok(/data-cs-items-row hidden/.test(on), 'hidden until the page has the tab');
  assert.ok(!/data-sheet-open="items"/.test(on), 'no in-sheet Items panel');
  const off = cs.paperSheetHtml(Object.assign({}, PAPER, { armoryItems: false }));
  assert.ok(!/data-cs-go-items/.test(off) && /data-sheet-open="items"/.test(off), 'the sheet keeps its own Items panel');
});

test('a Story jump word scrolls only the panel body, and not when it has nothing to scroll', () => {
  assert.equal(cs.jumpTop(120, 520, 0, 2000, 700), 400, 'anchor brought to the top of the body');
  assert.equal(cs.jumpTop(120, 300, 400, 2000, 700), 580, 'measured from where the body already is');
  assert.equal(cs.jumpTop(120, 5000, 0, 2000, 700), 1300, 'never past the end');
  assert.equal(cs.jumpTop(120, 520, 0, 700, 700), null, 'a body that fits does not move');
  const src = readFileSync(new URL('../widgets/character-sheet.js', import.meta.url), 'utf8');
  const branch = src.slice(src.indexOf("closest('[data-cs-jump]')"), src.indexOf("closest('[data-cs-go-items]')"));
  assert.ok(!/scrollIntoView/.test(branch), 'scrollIntoView scrolls the page as well as the panel');
});

test('a synced ability with no effect text takes it from the package, and Foundry text still wins', async () => {
  const pack = JSON.parse(readFileSync(new URL('../data/abilities.json', import.meta.url), 'utf8'));
  globalThis.window.Chronicle.apiFetch = async () => ({ ok: true, json: async () => pack });
  await cs.loadAbilityDefs('c1');
  assert.equal(cs.abilityKey('Hesitation is Weakness'), cs.abilityKey('Hesitation Is Weakness (1 Insight)'));
  const bare = cs.fillFromPackage({ name: 'Hesitation is Weakness', type: 'freeTriggered', trigger: '' });
  assert.match(bare.effectAfter, /You take your turn after the triggering hero/);
  assert.match(bare.trigger, /Another hero ends their turn/);
  const defend = cs.fillFromPackage({ name: 'Defend', type: 'main' });
  assert.match(defend.effectAfter, /double/, 'a common action gets its rules text');
  const own = cs.fillFromPackage({ name: 'Coat the Blade', effectAfter: '<p>Mine.</p>', trigger: 'Mine too' });
  assert.equal(own.effectAfter, '<p>Mine.</p>');
  assert.equal(own.trigger, 'Mine too');
  assert.equal(cs.fillFromPackage({ name: 'Ability', type: 'triggered' }).effectAfter, undefined, 'no match, nothing invented');
});

test('the full card and the glossary pass leave no markup in the visible text for package text', async () => {
  const RefRenderer = require('../widgets/reference-renderer.js');
  const read = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
  const pack = read('abilities.json');
  const r = new RefRenderer('', '');
  r._glossary = Object.fromEntries(read('rules-glossary.json').map((e) => [e.slug, e]));
  r._loaded = true;
  cs.setRefRenderer(r);
  globalThis.window.Chronicle.apiFetch = async () => ({ ok: true, json: async () => pack });
  await cs.loadAbilityDefs('c2');
  // Text between tags, reading quoted attribute values as part of their tag.
  const visible = (html) => html.replace(/<[^>"]*(?:"[^"]*"[^>"]*)*>/g, '');
  const spans = (html) => (html.match(/<span class="ds-ref (?:ds-ref--unknown|[^"]*"[^>]*data-ref-id=)/g) || []).length;
  const check = (html, source, label) => {
    assert.ok(!/data-ref-id="(?![\w-]+")/.test(html), label + ': a ref id attribute holds markup');
    assert.equal((html.match(/<span\b/g) || []).length, (html.match(/<\/span>/g) || []).length, label + ': spans balance');
    const v = visible(html);
    assert.ok(!/data-ref|&gt;|&quot;/.test(v), label + ': markup leaked into the text: ' + v.slice(0, 160));
    assert.equal(spans(html), (source.match(/\{@/g) || []).length, label + ': one span per marker');
  };
  for (const name of ['Stand Up', 'Black Ash Teleport', 'Coat the Blade']) {
    const a = cs.fillFromPackage({ name, type: 'maneuver' });
    const src = (a.effectAfter || '') + ' ' + (a.trigger || '');
    assert.ok(/\{@/.test(src), name + ' carries a marker');
    check(cs.abilityRulesHtml(a), src, name);
  }
  // The feature and perk paths read package text through the same two calls.
  for (const f of ['perks.json', 'abilities.json', 'kits.json', 'rules-glossary.json']) {
    for (const e of read(f)) {
      const src = String(e.description || '').replace(/\s+/g, ' ');
      if (!/\{@/.test(src)) continue;
      const html = r.scanText(r.renderText(src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')));
      check(html, src, f + ' ' + e.slug);
    }
  }
});

// ── The computer dashboard ─────────────────────────────────────────────────

test('dashboard: its pieces are dashboard-only, and the face parts it replaces are face-only', () => {
  const html = cs.paperSheetHtml(PAPER);
  for (const cls of ['sh-dport', 'sh-dprog', 'sh-dboxes', 'sh-drail', 'sh-dunder', 'sh-dtabs', 'sh-dpin']) {
    assert.ok(new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*\\bsh-dq\\b').test(html), cls + ' is marked sh-dq');
  }
  assert.ok(/class="sh-turn paper-pull sh-fq"/.test(html) && /class="sh-ledger sh-o3 sh-fq"/.test(html), 'This turn and the ledger give way');
  assert.ok(/class="sh-o1 sh-fq"/.test(html) && /sh-o4 sh-fq/.test(html) && /sh-o5 sh-fq/.test(html), 'characteristics, damage and progression give way');
  assert.ok(/<div class="sh-body" id="cs-dp-\d+-abilities">[^]*class="sh-band sh-abs/.test(html), 'the ability list is the Abilities pane, so phones keep it where it was');
  const css = cs.dashCss().join('\n');
  assert.ok(/\[data-sheet\] \.sh-dq \{ display:none; \}/.test(css), 'hidden unless the quiet look is wide');
  assert.ok(/@container shdash \(min-width:820px\)/.test(css) && !/\[data-sheet-style="(ledger|night|brass)"\]/.test(css), 'only the quiet look, only a wide sheet');
});

test('dashboard: potency is the synced value, else the glossary rule from the highest characteristic', () => {
  assert.deepEqual(cs.potencyOf({ fields: { might: 2, agility: 5, reason: 0 } }), [3, 4, 5]);
  assert.deepEqual(cs.potencyOf({ fields: { might: 2, potency_weak: 1, potency_average: 2, potency_strong: 4 } }), [1, 2, 4]);
  assert.equal(cs.potencyOf({ fields: {} }), null, 'nothing synced: no box rather than a guess');
  assert.equal(cs.topChar({ fields: { might: -1, presence: -2 } }), -1);
  const under = cs.dashUnder({ name: 'B', fields: { agility: 5, surges: 2, heroic_resource_name: 'Insight', heroic_resource_current: 3 } });
  assert.ok(/\+5 damage each/.test(under) && />Insight</.test(under) && /<b>3<\/b><b>4<\/b><b>5<\/b>/.test(under));
  assert.ok(!/sh-dpot/.test(cs.dashUnder({ name: 'B', fields: {} })), 'no potency box without a characteristic');
});

test('dashboard: Story is a tab only for the Director and the player; Skills only while the sheet is narrow', () => {
  const tabs = (d) => cs.dashTabList(Object.assign({}, PAPER, d)).map((t) => t.id + (t.narrow ? '*' : ''));
  assert.deepEqual(tabs({}), ['abilities', 'skills*', 'features', 'equipment', 'story']);
  assert.deepEqual(tabs({ isGm: false, isOwner: false }), ['abilities', 'skills*', 'features', 'equipment']);
  const counts = cs.dashTabList(PAPER).reduce((m, t) => (m[t.id] = t.n, m), {});
  assert.equal(counts.abilities, 2);
  assert.equal(counts.features, 1);
  const html = cs.paperSheetHtml(Object.assign({}, PAPER, { isGm: false, isOwner: false }));
  assert.ok(!/data-cs-dtab="story"/.test(html) && !/data-dpane="story"/.test(html) && !/secret/.test(html), 'no Story pane, and the GM lore is nowhere');
});

test('dashboard: a choice not made is a dashed tag that opens the same picker', () => {
  globalThis.window.Chronicle.pickChoice = () => Promise.resolve(null);
  const tags = cs.dashTodoTags(PAPER, true);
  assert.deepEqual([...tags.matchAll(/data-cs-pick="([a-z]+)"/g)].map((m) => m[1]), ['culture', 'career', 'kit']);
  assert.ok(/class="sh-idset-todo sh-dq"/.test(tags) && /Still to choose/.test(tags));
  const ro = cs.dashTodoTags(PAPER, false);
  assert.ok(!/<button/.test(ro) && /Culture/.test(ro), 'a reader sees the words, not buttons');
  const full = Object.assign({}, PAPER, { fields: Object.assign({}, PAPER.fields, { culture: 'Nomadic', career: 'Disciple', kit: 'Mountain' }) });
  assert.equal(cs.dashTodoTags(full, true), '');
});

test('dashboard: the left column and panes escape what the hero carries', () => {
  const bad = '<img src=x onerror=1>';
  const d = Object.assign({}, PAPER, { fields: Object.assign({}, PAPER.fields, {
    skills_json: JSON.stringify([bad]), languages_json: JSON.stringify([bad]), kit: bad,
    kit_details_json: JSON.stringify([{ name: bad, speed: bad, meleeDamageT1: bad }]),
    conditions_json: JSON.stringify([bad]), immunities: JSON.stringify([{ type: bad, value: 1 }]), heroic_resource_name: bad
  }) });
  const html = cs.dashRailInner(d) + cs.dashUnder(d) + cs.dashBoxes(d) + cs.dashPaneHtml('equipment', d) + cs.dashPaneHtml('skills', d) + cs.paperSheetHtml(d);
  assert.ok(!/<img src=x/.test(html));
});

test('dashboard: the Skills tab keeps the way into the Skills panel, as the left column does', () => {
  // Between 820 and 1100 wide the tab replaces both the ledger row and the
  // left column, so without this word an owner could not choose skills.
  assert.ok(/data-sheet-open="skills"/.test(cs.dashPaneHtml('skills', PAPER)));
  assert.ok(/data-sheet-open="skills"/.test(cs.dashRailInner(PAPER)));
});

test('dashboard: setDashTab opens a tab the sheet has and ignores one it does not', () => {
  const tabs = ['abilities', 'features', 'story'].map((id) => ({ id, attrs: {}, getAttribute(k) { return k === 'data-cs-dtab' ? id : null; }, setAttribute(k, v) { this.attrs[k] = v; } }));
  const main = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    querySelector(sel) { const m = sel.match(/data-cs-dtab="([a-z]+)"/); return tabs.find((t) => t.id === m[1]) || null; },
    querySelectorAll() { return tabs; } };
  const el = { querySelector: () => main };
  assert.equal(cs.setDashTab(el, 'features'), main);
  assert.equal(main.attrs['data-dtab'], 'features');
  assert.deepEqual(tabs.map((t) => t.attrs['aria-selected']), ['false', 'true', 'false']);
  assert.deepEqual(tabs.map((t) => t.attrs.tabindex), ['-1', '0', '-1']);
  assert.equal(cs.setDashTab(el, 'equipment'), null);
  assert.equal(main.attrs['data-dtab'], 'features', 'a missing tab leaves the open one open');
});

test('dashboard: the open tab survives the page refreshing itself after a save', () => {
  // Chronicle reloads the page's markup after a save, which destroys this
  // sheet and mounts a new one on a fresh, empty element.
  const main = { getAttribute: (k) => (k === 'data-dtab' ? 'story' : null) };
  const old = { _csKey: 'c1/e1', innerHTML: '<div>sheet</div>', classList: { remove() {} }, removeEventListener() {},
    querySelector: (sel) => (sel === '[data-cs-dmain]' ? main : null) };
  globalThis.window.Chronicle.registry['character-sheet'].destroy(old);
  assert.equal(old.innerHTML, '', 'destroy still empties the element');
  const fresh = { _csKey: 'c1/e1', querySelector: () => null };
  assert.equal(cs.dashTabToKeep(fresh), 'story', 'the new sheet opens on the tab the reader had');
  assert.equal(cs.dashTabToKeep(fresh), null, 'kept once: a later visit starts on Abilities');
  const other = { _csKey: 'c1/e2', querySelector: () => null };
  cs.keepDashTab(old);
  assert.equal(cs.dashTabToKeep(other), null, 'another hero\'s page does not take it');
  const inPlace = { _csKey: 'c1/e1', querySelector: (sel) => (sel === '[data-cs-dmain]' ? { getAttribute: () => 'features' } : null) };
  assert.equal(cs.dashTabToKeep(inPlace), 'features', 'a redraw in place keeps what is on screen');
});

// ── The dashboard's ability lists ─────────────────────────────────────────

test('dashboard abilities: one group per action, own columns, the face list kept for phones', () => {
  const data = faceData(FACE.concat([{ name: 'Charge', type: 'main' }, { name: 'Free Strike', type: 'main' }]));
  const html = cs.paperSheetHtml(data);
  assert.ok(/<section class="sh-band sh-abs sh-o2 sh-fq"/.test(html), 'the face list is hidden only on the dashboard');
  assert.ok(/<section class="sh-dabs sh-dq" data-cs-dabs/.test(html), 'the dashboard list shows only on the dashboard');
  const d = cs.dashAbilities(data, 1);
  const groups = [...d.matchAll(/data-dgroup="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['main', 'maneuver', 'triggered', 'free', 'every']);
  assert.ok(/<span>Cost<\/span><span>Distance<\/span><span>Target<\/span>/.test(d));
  assert.ok(/Damage at/.test(d.split('data-dgroup="maneuver"')[0]), 'main actions carry the damage heading');
  assert.ok(/<span class="sh-danote">Judge one creature\.<\/span>/.test(d), 'a maneuver says what it does under its name');
  assert.ok(/<span class="sh-danote"><b>Trigger<\/b> A judged creature hurts an ally<\/span>/.test(d), 'a triggered action names its trigger');
  assert.ok(/<span class="sh-dadm-n">4<i aria-hidden="true">·<\/i>7<i aria-hidden="true">·<\/i>9<\/span> <small>holy<\/small>/.test(d),
    'Halt: the hero\'s own tier results, the damage type under them so a long one cannot run into Target');
  // The Free Strike main action joins the moves every hero has, here only.
  const every = d.split('data-dgroup="every"')[1];
  assert.ok(/>Charge</.test(every) && />Free Strike</.test(every));
  assert.ok(/>Free Strike</.test(cs.pAbilities(data).split('sx-std')[0]), 'the face keeps Free Strike where it was');
});

test('dashboard abilities: what the resource cannot pay for folds into one line naming each', () => {
  const d = cs.dashAbilities(faceData(FACE), 1);
  assert.ok(/<div class="sh-dai is-short">.*?Arrest/.test(d), 'Arrest (5) costs more than 4 Wrath');
  assert.ok(!/<div class="sh-dai is-short">[^]*?Driving/.test(d.split('Arrest')[0]), 'Driving (3) is paid for');
  assert.ok(/1 more cost over 4 Wrath<\/span>.*Arrest <b class="num">5<\/b>/.test(d));
  assert.ok(/role="switch" aria-checked="true" data-cs-dafford>.*Only what 4 Wrath pays for<small class="num">5 of 6<\/small>/.test(d));
  assert.ok(/<span class="sh-sr">, you have 4<\/span>/.test(d), 'a screen reader hears why a row is grey');
  const rich = cs.dashAbilities(faceData(FACE, { heroic_resource_current: 9 }), 1);
  assert.ok(!/data-cs-dafford/.test(rich) && !/sh-dcut/.test(rich), 'no switch when everything is paid for');
});

test('dashboard abilities: a resource below zero still lists everything that costs nothing', () => {
  const d = cs.dashAbilities(faceData([
    { name: 'Spike', category: 'signature', type: 'action' }, { name: 'Grip', category: 'heroic', type: 'action', cost: 5 },
    { name: 'Step', type: 'maneuver' }
  ], { heroic_resource_name: 'Clarity', heroic_resource_current: -2 }), 1);
  assert.equal((d.match(/sh-dai is-short/g) || []).length, 1, 'only Grip, which has a cost, is out of reach');
  assert.ok(/1 more cost over -2 Clarity<\/span>.*Grip <b class="num">5<\/b>/.test(d));
  assert.ok(/pays for<small class="num">2 of 3<\/small>/.test(d));
});

test('dashboard abilities: a hero with no free strike synced gets the kit\'s line', () => {
  const d = cs.dashAbilities(faceData(FACE.filter((a) => a.category !== 'freeStrike'), {
    kit_details_json: JSON.stringify([{ meleeDamageT1: 1, meleeDamageT2: 2, meleeDamageT3: 3 }])
  }), 1);
  assert.ok(/data-cs-dar="-1"/.test(d) && /Melee free strike/.test(d) && /kit \+1 · \+2 · \+3/.test(d));
  assert.ok(/<h3>Free strike<\/h3>/.test(d) && /data-cs-dfilt="free" aria-pressed="false">Free strike<\/button>/.test(d),
    'the kit\'s line is not counted, so the groups add up to All');
});

test('dashboard full card: the rules, then the roll worked out for this hero and what it costs', () => {
  const data = faceData(FACE, { might: 2 });
  const arrest = cs.dashAbCard(FACE[1], data);
  assert.ok(/<h4>For Tyne<\/h4>/.test(arrest));
  assert.ok(/2d10 \+ 2<span>most often 12 to 16<\/span>/.test(arrest));
  assert.ok(/<dd>8 damage<\/dd>/.test(arrest) && /36 in 100/.test(arrest));
  assert.ok(/Costs 5 Wrath\. You have 4, so 1 short\./.test(arrest));
  const halt = cs.dashAbCard(FACE[0], data);
  assert.ok(/A signature ability\. It costs nothing\./.test(halt));
  const pushed = { name: 'Shove', type: 'action', powerRollChars: ['might'],
    tiers: [{ type: 'applied', applied: { tier1: { display: '{{potency}} slowed', potency: { characteristic: 'might', value: '@potency.weak' } } } }] };
  assert.ok(/<dd>M &lt; 0 /.test(cs.dashAbCard(pushed, data)), 'potency is filled in from the hero\'s numbers');
  assert.ok(!/For Tyne/.test(cs.dashAbCard({ name: 'Look', type: 'maneuver' }, data)), 'nothing to work out, no hero column');
});

test('dashboard abilities escape what the hero carries', () => {
  const bad = '<img src=x onerror=1>';
  const data = faceData([{ name: bad, type: 'maneuver', effectAfter: bad, trigger: bad, targetCustom: bad },
    { name: bad, type: 'triggered', trigger: bad, cost: 9 }, { name: 'Charge', type: 'main' }], { heroic_resource_name: bad });
  const html = cs.dashAbilities(data, 1) + cs.dashAbCard(JSON.parse(data.fields.abilities_json)[0], Object.assign({}, data, { name: bad }));
  assert.ok(!/<img src=x/.test(html));
});

test('dashboard abilities: the filter shows one group, the switch brings back what cannot be paid for', () => {
  const mk = (attrs) => ({ attrs: Object.assign({}, attrs), hidden: false,
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; } });
  const btns = ['all', 'main', 'every'].map((id) => mk({ 'data-cs-dfilt': id }));
  const groups = ['main', 'maneuver', 'every'].map((id) => mk({ 'data-dgroup': id }));
  const sw = mk({ 'aria-checked': 'true' });
  const box = mk({ 'data-dfilter': 'all', 'data-dafford': '' });
  box.querySelector = (sel) => { const m = sel.match(/data-cs-dfilt="([a-z]+)"/); return m ? (btns.find((b) => b.attrs['data-cs-dfilt'] === m[1]) || null) : sw; };
  box.querySelectorAll = (sel) => (/dfilt/.test(sel) ? btns : groups);
  const el = { querySelector: () => box };
  cs.setDashFilter(el, 'main');
  assert.deepEqual(groups.map((g) => g.hidden), [false, true, true]);
  assert.deepEqual(btns.map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false']);
  assert.equal(cs.setDashFilter(el, 'maneuver'), null, 'a filter the list does not have changes nothing');
  assert.equal(box.attrs['data-dfilter'], 'main');
  cs.setDashAfford(el, false);
  assert.ok(!('data-dafford' in box.attrs) && sw.attrs['aria-checked'] === 'false');
});
