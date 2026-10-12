#!/usr/bin/env node
/**
 * The stat block's "In Foundry" box and the editor's save, around the two
 * fields Foundry owns (current Stamina and conditions): the box shows them
 * escaped, its toggle writes only the page's `foundry` gm half, and a stat
 * block save never wipes them.
 *
 * Run: `node --test tools/test-creature-in-foundry.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom, makeChronicle } from './_xss-harness.mjs';

installDom();
globalThis.Chronicle = makeChronicle();
const require = createRequire(import.meta.url);
const Engine = require('../widgets/monster-engine.js');
globalThis.DrawSteelFormulas = Engine.Formulas;
globalThis.MonsterEngine = Engine;
globalThis.MonsterParty = require('../widgets/monster-party.js');
const S = require('../widgets/statblock-renderer.js');
globalThis.DrawSteelStatblock = S;
const Ed = require('../widgets/monster-builder.js');

const XSS = '<img src=x onerror=alert(1)>';

test('the box shows what Foundry sent, escaped', async (t) => {
  const cases = [
    ['nothing sent yet', { stamina: 140 }, ['Not sent from Foundry yet', '>None<']],
    ['stamina and conditions', { stamina: 140, stamina_current: 72, conditions_json: '["prone","frightened"]' }, ['72 / 140', 'Prone, Frightened']],
    ['conditions as an array', { stamina_current: 5, conditions_json: ['dazed'] }, ['>5<', 'Dazed']],
    ['bad conditions text', { conditions_json: '{oops' }, ['>None<']],
  ];
  for (const [name, f, wants] of cases) {
    await t.test(name, () => {
      const html = S.foundryHtml(f, { sendBack: false });
      for (const w of wants) assert.ok(html.includes(w), `${w} in ${html}`);
    });
  }
  const html = S.foundryHtml({ conditions_json: JSON.stringify([XSS]) }, { sendBack: false });
  assert.ok(!html.includes('<img'), 'condition names are escaped');
});

test('the toggle follows the page state and is off until known', async (t) => {
  const cases = [
    ['unknown', { sendBack: null }, { checked: false, disabled: true }],
    ['off', { sendBack: false }, { checked: false, disabled: false }],
    ['on', { sendBack: true }, { checked: true, disabled: false }],
    ['saving', { sendBack: true, saving: true }, { checked: true, disabled: true }],
  ];
  for (const [name, state, want] of cases) {
    await t.test(name, () => {
      const input = /<input[^>]*>/.exec(S.foundryHtml({}, state))[0];
      assert.equal(/ checked/.test(input), want.checked);
      assert.equal(/ disabled/.test(input), want.disabled);
    });
  }
});

function fakePanel(respond) {
  const calls = [];
  globalThis.Chronicle.apiFetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve(respond(url, opts));
  };
  const box = { innerHTML: '' };
  const el = { querySelector: (sel) => (sel === '[data-sbx-fvtt-box]' ? box : null) };
  const p = new S.Panel(el, { campaignId: 'c1', entityId: 'e1', isGm: true });
  p.entity = { name: 'Skrix', fields_data: { stamina: 140 } };
  return { p, box, calls };
}

test('turning send-back on writes only the gm half and keeps its other keys', async () => {
  const { p, box, calls } = fakePanel(() => ({ ok: true, json: () => Promise.resolve({}) }));
  p.fvtt.gm = { note: 'kept' };
  p.fvtt.sendBack = false;
  await p.setSendBack(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/campaigns/c1/entities/e1/system-state/drawsteel/foundry');
  assert.equal(calls[0].opts.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { gm: { note: 'kept', sendBack: true } });
  assert.equal(p.fvtt.sendBack, true);
  assert.ok(/ checked/.test(box.innerHTML));
});

test('a failed save puts the toggle back and says so', async () => {
  const { p, box } = fakePanel(() => ({ ok: false, status: 500 }));
  p.fvtt.sendBack = false;
  await p.setSendBack(true);
  assert.equal(p.fvtt.sendBack, false);
  assert.ok(box.innerHTML.includes('Could not save that'));
});

test('loading reads the gm half; a page with no state is off', async () => {
  const { p } = fakePanel(() => ({ ok: true, json: () => Promise.resolve({ public: {}, gm: {}, isGm: true }) }));
  await p.loadFoundry();
  assert.equal(p.fvtt.sendBack, false);
});

test('saving the stat block keeps the fields Foundry sent back', async () => {
  const calls = [];
  globalThis.Chronicle.apiFetch = (url, opts) => {
    calls.push({ url, opts });
    if (!opts) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'e1', fields_data: { stamina: 140, stamina_current: 72, conditions_json: '["prone"]' } }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  };
  const st = Ed.newState('Skrix', { level: 4, organization: 'leader', stamina: 150 }, { orgs: [], roles: [] });
  const saved = await Ed.save(st, { campaignId: 'c1', entityId: 'e1' });
  const put = calls.find((c) => c.opts && c.opts.method === 'PUT');
  const body = JSON.parse(put.opts.body);
  assert.equal(body.fields_data.stamina_current, 72);
  assert.equal(body.fields_data.conditions_json, '["prone"]');
  assert.equal(body.fields_data.level, 4, 'the editor\'s own fields win');
  assert.equal(saved.fields_data.stamina_current, 72);
});

test('a save that cannot read the page first does not write', async () => {
  const calls = [];
  globalThis.Chronicle.apiFetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: false, status: 500 });
  };
  const st = Ed.newState('Skrix', { level: 4 }, { orgs: [], roles: [] });
  await assert.rejects(Ed.save(st, { campaignId: 'c1', entityId: 'e1' }));
  assert.equal(calls.filter((c) => c.opts && c.opts.method === 'PUT').length, 0);
});
