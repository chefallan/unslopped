import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir, cli } from './helpers.ts';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

test('--version prints the package version', () => {
  const r = cli(tmpDir(), '--version');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.trim(), pkg.version);
});

test('-v prints the package version', () => {
  const r = cli(tmpDir(), '-v');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.trim(), pkg.version);
});

test('version prints the package version', () => {
  const r = cli(tmpDir(), 'version');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.trim(), pkg.version);
});
