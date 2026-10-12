#!/usr/bin/env node
/**
 * Pins what a release's source zip carries. Chronicle installs this package
 * from GitHub's source archive and refuses it if any file has an extension
 * on its package scan's blocklist, so .gitattributes keeps dev-only folders
 * out and this checks the archive git would build from the tracked tree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors dangerousExtensions in Chronicle's internal/plugins/packages/validation.go.
const BLOCKED = new Set([
  '.exe', '.bat', '.cmd', '.com', '.sh', '.bash', '.zsh', '.fish',
  '.dll', '.so', '.dylib', '.msi', '.deb', '.rpm',
  '.ps1', '.psm1', '.psd1', '.jar', '.class', '.py', '.rb', '.pl',
]);

// --worktree-attributes reads the checked-out .gitattributes, so the test
// sees an uncommitted change to it too.
const files = execFileSync(
  'sh',
  ['-c', 'git archive --worktree-attributes --format=tar HEAD | tar -t'],
  { cwd: ROOT, encoding: 'utf8' },
).split('\n').filter((f) => f && !f.endsWith('/'));

test('archive has no file Chronicle would refuse', () => {
  const bad = files.filter((f) => BLOCKED.has(extname(f).toLowerCase()));
  assert.deepEqual(bad, []);
});

test('archive leaves out dev-only folders', () => {
  const dev = files.filter((f) => /^(tools|\.github)\//.test(f));
  assert.deepEqual(dev, []);
});

test('archive keeps what Chronicle loads', () => {
  const manifest = JSON.parse(execFileSync('git', ['show', 'HEAD:manifest.json'], { cwd: ROOT, encoding: 'utf8' }));
  const needed = ['manifest.json', 'LICENSE', 'data/NOTICE.md'];
  for (const w of manifest.widgets || []) needed.push(w.script_file);
  for (const f of needed) {
    assert.ok(files.includes(f), `${f} missing from the release archive`);
  }
  assert.ok(files.some((f) => f.startsWith('data/') && f.endsWith('.json')), 'no data files in the release archive');
  assert.ok(files.some((f) => f.startsWith('book/')), 'no rulebook book in the release archive');
});
