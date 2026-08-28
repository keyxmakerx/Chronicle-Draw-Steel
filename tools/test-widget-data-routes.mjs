#!/usr/bin/env node
/**
 * The data-route contract for every widget that loads a data/*.json file.
 *
 * WHY THIS EXISTS. Four of the five data-loading widgets fetched their JSON
 * from URLs Chronicle has never served:
 *
 *     /api/v1/campaigns/:id/extensions/drawsteel/assets/data/<file>.json
 *     /extensions/drawsteel/assets/data/<file>.json          (the "fallback")
 *
 * Three independent reasons each one is dead:
 *   1. Chronicle has no /api/v1/campaigns/:id/extensions/... route at all.
 *   2. Its real extension-asset route (ServeAsset) allowlists
 *      .svg .png .webp .jpg .jpeg .css .js and answers 400 for .json.
 *   3. ServeAsset resolves under the EXTENSIONS directory, while Draw Steel
 *      installs as a SYSTEM package, so it is not there either.
 *
 * rulebook-frontpage had no fallback and so rendered its error panel every
 * time it was mounted; monster-builder walked two dead candidates and showed
 * its data-error diagnostic. character-sheet used the systems route and
 * worked, which is the shape everything uses now:
 *
 *     GET /campaigns/:id/systems/drawsteel/data/<file>.json   (SystemDataAPI)
 *
 * The failure mode this guards is silent: a widget that fetches a URL with no
 * route behind it looks like a server problem, not a client bug, and every
 * unit test in this repo passed the whole time it was broken.
 *
 * Run: `node --test tools/test-widget-data-routes.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = (f) => join(HERE, '..', 'widgets', f);

// Every widget that reads a packaged data file or the glossary.
const DATA_WIDGETS = [
  'rulebook-frontpage.js',
  'monster-builder.js',
  'bestiary-browser.js',
  'statblock-renderer.js',
  'character-sheet.js',
  'reference-renderer.js',
];

// Strip comments so the prose explaining the dead route cannot trip the guard
// that forbids it.
//
// This walks the source instead of running two regexes over it, because the
// regex version was wrong in a way worth remembering: these files contain the
// literal text `data/*.json` in both comments and a user-facing string, and
// the `/*` inside it opened a block comment that swallowed real code up to the
// next `*/`. The guard then reported that monster-builder had stopped building
// the systems route when it had not. A stripper that does not understand
// string literals cannot be trusted on a codebase that talks about globs.
//
// Regex literals are not tracked; none of these files contains one whose body
// could be mistaken for a comment opener.
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      // Copy the whole string literal through, honouring escapes.
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

test('no widget builds a URL under the dead extension-asset path', () => {
  for (const f of DATA_WIDGETS) {
    const code = stripComments(readFileSync(W(f), 'utf8'));
    assert.ok(
      !code.includes('extensions/drawsteel/assets'),
      `${f} builds a URL under /extensions/drawsteel/assets/. Chronicle has no ` +
      `such route for .json: the /api/v1/... form does not exist, and the real ` +
      `extension-asset route refuses .json and looks in the extensions dir ` +
      `while this package installs as a system package. Use ` +
      `/campaigns/:id/systems/drawsteel/data/<file>.json instead.`);
  }
});

test('every data fetch uses the systems route Chronicle actually serves', () => {
  // The two that read data/*.json by name must name the systems path.
  for (const f of ['rulebook-frontpage.js', 'monster-builder.js', 'character-sheet.js']) {
    const code = stripComments(readFileSync(W(f), 'utf8'));
    assert.ok(
      code.includes("'/systems/drawsteel/data/'") ||
      code.includes("/systems/drawsteel/data/"),
      `${f} no longer builds the systems data route`);
  }
});

test('monster-builder fetches data over the systems route, and says so when it cannot', async () => {
  // The widget is a bare Chronicle.register(...) call, so a stub captures the
  // object without needing a DOM.
  let widget = null;
  const seen = [];
  const sandbox = {
    console,
    Chronicle: {
      register: (_slug, impl) => { widget = impl; },
      apiFetch: (url) => {
        seen.push(url);
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      },
    },
  };
  vm.runInNewContext(readFileSync(W('monster-builder.js'), 'utf8'), sandbox);
  assert.ok(widget && typeof widget._fetchData === 'function', 'widget did not register');

  const ctx = { _campaignId: 'camp-1', _fetchData: widget._fetchData };
  await ctx._fetchData('creature-keywords.json');

  assert.deepEqual(seen, ['/campaigns/camp-1/systems/drawsteel/data/creature-keywords.json']);

  // Without a campaign id there is no route, and the widget must say that
  // rather than fetch something that cannot resolve.
  let rejected = null;
  await Object.assign({}, ctx, { _campaignId: '' })
    ._fetchData('creature-keywords.json')
    .catch((e) => { rejected = e; });
  assert.ok(rejected, 'a mount with no campaign id should reject');
  assert.match(String(rejected.message), /no campaign id/i);
});

test('the reference renderer loads the glossary over the systems route', async () => {
  const sandbox = { console };
  vm.runInNewContext(
    readFileSync(W('reference-renderer.js'), 'utf8') + '\n;globalThis.__R = DrawSteelRefRenderer;',
    sandbox);
  const R = sandbox.__R;

  const seen = [];
  sandbox.Chronicle = {
    apiFetch: (url) => { seen.push(url); return Promise.resolve({ json: () => Promise.resolve([]) }); },
  };
  // The renderer reads Chronicle from its own scope, so install it there.
  vm.runInNewContext('globalThis.Chronicle = C;', Object.assign(sandbox, { C: sandbox.Chronicle }));

  const ref = new R('', 'camp-2');
  await ref.load();
  assert.deepEqual(seen, ['/campaigns/camp-2/systems/drawsteel/rules-glossary']);
});

test('with neither a campaign id nor a base path the renderer degrades, it does not guess', async () => {
  const sandbox = { console };
  vm.runInNewContext(
    readFileSync(W('reference-renderer.js'), 'utf8') + '\n;globalThis.__R = DrawSteelRefRenderer;',
    sandbox);
  const R = sandbox.__R;

  let fetched = false;
  vm.runInNewContext('globalThis.fetch = function () { globalThis.__f = true; };', sandbox);

  const ref = new R('', '');
  await ref.load();
  fetched = sandbox.__f === true;
  assert.equal(fetched, false, 'it must not fetch a URL it cannot construct');
  assert.deepEqual(ref.getEntry('anything'), null);
});
