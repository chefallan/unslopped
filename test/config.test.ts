import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectCommands, configHash, loadConfig, saveConfig } from '../src/config.ts';
import { tmpDir } from './helpers.ts';

test('detects npm scripts, ignores the npm placeholder test', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { build: 'tsc', lint: 'eslint .', test: 'echo "Error: no test specified" && exit 1' } })
  );
  const c = detectCommands(dir);
  assert.equal(c.build, 'npm run build');
  assert.equal(c.lint, 'npm run lint');
  assert.equal(c.test, null);
  assert.equal(c.deploy, null);
});

test('uses pnpm when a pnpm lockfile exists', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build' } }));
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  const c = detectCommands(dir);
  assert.equal(c.test, 'pnpm test');
  assert.equal(c.build, 'pnpm run build');
});

test('detects cargo, go projects', () => {
  const rust = tmpDir();
  fs.writeFileSync(path.join(rust, 'Cargo.toml'), '');
  assert.equal(detectCommands(rust).test, 'cargo test');
  const go = tmpDir();
  fs.writeFileSync(path.join(go, 'go.mod'), '');
  assert.equal(detectCommands(go).test, 'go test ./...');
});

test('returns empty commands for an unknown project', () => {
  const c = detectCommands(tmpDir());
  assert.ok(Object.values(c).every((v) => v === null));
});

test('config hash is stable across key order, changes with values', () => {
  const a = { commands: { test: 'npm test', build: null }, deploy: { requireApproval: true } };
  const b = { deploy: { requireApproval: true }, commands: { build: null, test: 'npm test' } };
  assert.equal(configHash(a), configHash(b));
  assert.notEqual(configHash(a), configHash({ ...a, commands: { ...a.commands, test: 'true' } }));
});

test('loadConfig fills defaults, returns null when missing', () => {
  const dir = tmpDir();
  assert.equal(loadConfig(dir), null);
  saveConfig(dir, { commands: { test: 'npm test' } });
  const c = loadConfig(dir);
  assert.equal(c.commands.test, 'npm test');
  assert.equal(c.commands.build, null);
  assert.equal(c.deploy.requireApproval, true);
  assert.ok(c.assistants.includes('claude'));
});
