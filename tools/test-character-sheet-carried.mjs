#!/usr/bin/env node
/**
 * What a hero carries, when the host shows no item panel for this viewer
 * (data-armory-items false, as for another player): the sheet reads the
 * page's links as that viewer may see them and lists the Has Item ones.
 *
 * Run: `node --test tools/test-character-sheet-carried.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeChronicle } from './_xss-harness.mjs';

globalThis.window = { Chronicle: makeChronicle() };
const require = createRequire(import.meta.url);
const cs = require('../widgets/character-sheet.js');

const answer = (body, ok = true) => () => Promise.resolve({ ok, json: () => Promise.resolve(body) });

test('the Has Item links become the sheet\'s carried items, others are left out', async () => {
  const asked = [];
  window.Chronicle.apiFetch = (url) => { asked.push(url); return answer([
    { relationType: 'Has Item', targetEntityId: 'i1', targetEntityName: 'Rope', metadata: { quantity: 2, equipped: false } },
    { relationType: 'Has Item', targetEntityId: 'i2', targetEntityName: 'Shield', metadata: '{"equipped":true}' },
    { relationType: 'Ally', targetEntityId: 'p1', targetEntityName: 'Wren' },
    { relationType: 'Has Item', targetEntityName: 'No page' }
  ])(); };
  const got = await cs.fetchCarried('c 1', 'h1');
  assert.deepEqual(asked, ['/campaigns/c%201/entities/h1/relations']);
  assert.deepEqual(got.map((c) => c.entity.name), ['Rope', 'Shield']);
  assert.equal(got[0].relation.slug, 'has-item');
  assert.equal(got[0].metadata.quantity, 2);
  assert.equal(got[1].metadata.equipped, true, 'metadata sent as text is read too');
  const panel = cs.pItemsPanel({ campaignId: 'c1', fields: {}, children: got });
  assert.match(panel, /Rope/);
  assert.match(panel, /× 2/);
  assert.ok(!/Nothing carried yet/.test(panel));
});

test('a refused or failed read is an empty list, never an error', async () => {
  window.Chronicle.apiFetch = answer({ message: 'no' }, false);
  assert.deepEqual(await cs.fetchCarried('c1', 'h1'), []);
  window.Chronicle.apiFetch = () => Promise.reject(new Error('offline'));
  assert.deepEqual(await cs.fetchCarried('c1', 'h1'), []);
  assert.deepEqual(await cs.fetchCarried('', 'h1'), [], 'no campaign, no fetch');
});
