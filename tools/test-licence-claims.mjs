// test-licence-claims.mjs — the package may not claim someone else's rules text
// is Creative Commons.
//
// Run: node --test tools/test-licence-claims.mjs
//
// This package reproduces DRAW STEEL rules text under MCDM's DRAW STEEL Creator
// License. For most of its life it *also* declared itself CC-BY-4.0 — in
// LICENSE, README.md, manifest.json's `license` and `description`, all 35
// `source` strings in creatures.json (which Chronicle prints on every creature
// page), and three docs. That is a misrepresentation of what a downstream user
// may do with the package, and it survived for months because nothing was
// watching for it. This file watches.
//
// The rule is not "never say CC-BY". The package's OWN work — widgets/, tools/,
// docs/, manifest.json, and the data entries flagged "source": "custom" — is
// genuinely CC-BY-4.0, and saying so is correct. The rule is that every mention
// must be SCOPED: near the mention, in plain words, it must be clear that it is
// this package's own work being licensed, or that a past CC-BY claim is being
// corrected. An unscoped mention reads as a claim over the rules text.
//
// See LICENSE (the two-part statement) and data/NOTICE.md ("The CC-BY-4.0
// misstatement, and where it was corrected").

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// Any spelling of the thing this package is not.
const CC = /cc-?by|creative\s*commons|creativecommons/i;

// The verbatim attribution the Creator License position rests on.
const ATTRIBUTION = 'DRAW STEEL © 2024 MCDM Productions, LLC';
const CREATOR_LICENCE = 'DRAW STEEL Creator License';

// Files allowed to mention Creative Commons at all. Each still has to scope
// every mention (see SCOPING_MARKERS). Anything not on this list must not
// mention it — a stray CC-BY in a widget header or a new doc is the exact
// regression this file exists to catch.
const MAY_MENTION_CC = new Set([
  'LICENSE',
  'README.md',
  'CLAUDE.md',
  'manifest.json',
  'data/NOTICE.md',
  'docs/DATA-SCHEMA.md',
  'docs/PROJECT-HANDOFF.md',
  'docs/implementation-checklist.md',
  'tools/test-licence-claims.mjs', // this file
]);

// A mention is scoped when its 3-line neighbourhood says, in words a reader
// would understand, that it is about this package's own work or about a past
// claim being corrected. Matched case-insensitively against text with markdown
// emphasis stripped, so `**not** Creative Commons` still reads as prose.
const SCOPING_MARKERS = [
  'this package',
  'contributors',
  'not creative commons',
  'has not released',
  'never been released',
  'wrong',
  'correct', // corrected / correction / incorrect
  'misrepresent',
  'creativecommons.org',
  'unusual choice',
  'source": "custom',
];

const TEXT_EXT = new Set(['.md', '.json', '.js', '.mjs', '.yml', '.yaml', '.txt']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'images']);

/** Every text file in the repo, as repo-relative POSIX paths. */
function textFiles(dir = ROOT, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      textFiles(abs, acc);
      continue;
    }
    if (TEXT_EXT.has(path.extname(name)) || name === 'LICENSE') {
      acc.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
  }
  return acc;
}

/** Strip markdown emphasis so `**not** Creative Commons` reads as prose. */
const plain = (s) => s.replace(/[*_`~]/g, '').toLowerCase();

test('no file outside the allowlist mentions Creative Commons', () => {
  const strays = textFiles().filter((rel) => !MAY_MENTION_CC.has(rel) && CC.test(read(rel)));
  assert.deepEqual(
    strays,
    [],
    `these files mention Creative Commons but are not allowed to. This package ` +
      `reproduces Draw Steel rules text under the ${CREATOR_LICENCE}, not under any ` +
      `CC licence. If the mention is genuinely about this package's own code or ` +
      `"source": "custom" data, add the file to MAY_MENTION_CC in ` +
      `tools/test-licence-claims.mjs and scope the mention.`,
  );
});

test('every Creative Commons mention is scoped to this package own work', () => {
  const unscoped = [];
  for (const rel of MAY_MENTION_CC) {
    if (rel === 'tools/test-licence-claims.mjs') continue; // markers live here
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      if (!CC.test(line)) return;
      const window = plain(lines.slice(Math.max(0, i - 1), i + 2).join(' '));
      if (!SCOPING_MARKERS.some((m) => window.includes(m))) {
        unscoped.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    unscoped,
    [],
    `these Creative Commons mentions are not scoped. Read on its own, each one ` +
      `claims CC-BY over material this package does not own. Say near the mention ` +
      `whose work it covers ("this package's own work", "the Chronicle Draw Steel ` +
      `contributors") or that a past claim is being corrected.`,
  );
});

test('no data entry claims Creative Commons provenance', () => {
  // creatures.json shipped 35 of these, and system_pages.templ prints
  // item.Source in the detail header — so the misstatement was on the page.
  const offenders = [];
  for (const file of readdirSync(path.join(ROOT, 'data'))) {
    if (!file.endsWith('.json')) continue;
    for (const item of JSON.parse(read(`data/${file}`))) {
      const src = item?.source;
      if (typeof src === 'string' && CC.test(src)) offenders.push(`data/${file}: ${item.slug} -> "${src}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a root "source" naming a Creative Commons licence is printed verbatim on the ` +
      `item's page in Chronicle's reference browser. Published Draw Steel entries ` +
      `cite the book and chapter; this package's own entries say exactly "custom".`,
  );
});

test('the manifest declares both positions, and neither alone', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(
    manifest.license.includes('Creator License'),
    `manifest.json "license" must name the ${CREATOR_LICENCE} — it is the permission ` +
      `the rules text in data/ actually relies on, and Chronicle renders this string ` +
      `in Admin > Extensions and the system diagnostics header. Got: ${manifest.license}`,
  );
  assert.ok(
    !CC.test(manifest.description),
    `manifest.json "description" must not describe the content as Creative Commons. ` +
      `Got: ${manifest.description}`,
  );
  assert.ok(
    manifest.description.includes('Creator License'),
    'manifest.json "description" must state the Creator License position.',
  );
});

test('the attribution and the Creator License are stated where anyone would look', () => {
  for (const rel of ['LICENSE', 'README.md', 'data/NOTICE.md']) {
    const body = read(rel);
    assert.ok(body.includes(ATTRIBUTION), `${rel} must carry the attribution "${ATTRIBUTION}".`);
    assert.ok(
      body.toLowerCase().includes(CREATOR_LICENCE.toLowerCase()),
      `${rel} must name the ${CREATOR_LICENCE}.`,
    );
  }
});

test('the unread-licence limitation is stated, not papered over', () => {
  // Nobody working on this package has read the Creator License:
  // mcdmproductions.com is blocked by the authoring environment's egress proxy.
  // The position is reasoned, not verified, and saying so is part of the
  // position. Delete this test only when a human has read the licence and
  // removed the limitation sections from LICENSE and data/NOTICE.md together.
  for (const rel of ['LICENSE', 'data/NOTICE.md']) {
    const body = read(rel).toLowerCase();
    assert.ok(
      body.includes('mcdmproductions.com') && body.includes('unreachable'),
      `${rel} must record that the Creator License text itself could not be read ` +
        `(mcdmproductions.com is unreachable from the authoring environment), so no ` +
        `reader mistakes this package's position for a reading of the licence.`,
    );
  }
});
