import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, initRepo, writeConfig, BIN, PASS, NO_TRACKER_ENV } from './helpers.ts';

function run(cwd, input, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input: input === null ? undefined : JSON.stringify(input), env: { ...process.env, ...NO_TRACKER_ENV } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

test('claude hooks read the event from stdin, use its cwd', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const elsewhere = tmpDir();

  let r = run(elsewhere, { cwd: dir, hook_event_name: 'SessionStart' }, 'hook', 'claude', 'session');
  assert.equal(r.code, 0);
  assert.match(r.out, /# ADE SDLC protocol/);
  assert.match(r.out, /no active cycle/);

  r = run(elsewhere, { cwd: dir, prompt: 'Add /health endpoint for APP-3' }, 'hook', 'claude', 'prompt');
  assert.equal(r.code, 0);
  assert.match(r.out, /ade start "Add \/health endpoint for APP-3"/);
  assert.match(r.out, /Issue APP-3 will be linked/);

  r = run(elsewhere, { cwd: dir, tool_name: 'Bash', tool_input: { command: 'ade approve deploy' } }, 'hook', 'claude', 'tool');
  assert.equal(r.code, 2);
  assert.match(r.err, /for humans/);
  assert.equal(r.out, '');

  r = run(elsewhere, { cwd: dir, tool_name: 'Bash', tool_input: { command: 'npm test' } }, 'hook', 'claude', 'tool');
  assert.equal(r.code, 0);
  assert.equal(r.out, '');

  r = run(dir, {}, 'hook', 'claude', 'prompt');
  assert.equal(r.code, 0);
  assert.match(r.out, /no active cycle/);
});

test('cursor shell hook answers with a permission object', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  let r = run(dir, { command: 'git push --force', cwd: dir }, 'hook', 'cursor', 'shell');
  assert.equal(r.code, 0);
  let verdict = JSON.parse(r.out);
  assert.equal(verdict.permission, 'deny');
  assert.match(verdict.agentMessage, /force push/);
  r = run(dir, { command: 'npm test', cwd: dir }, 'hook', 'cursor', 'shell');
  verdict = JSON.parse(r.out);
  assert.deepEqual(verdict, { permission: 'allow' });
});

test('install, uninstall honor ADE_HOME', () => {
  const home = tmpDir();
  const env = { ...process.env, ...NO_TRACKER_ENV, ADE_HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(home, '.config') };
  let r = spawnSync(process.execPath, [BIN, 'install', '--only=claude,codex,opencode'], { encoding: 'utf8', env });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /settings\.json/);
  assert.match(r.stdout, /opencode/);
  assert.ok(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')));
  r = spawnSync(process.execPath, [BIN, 'uninstall', '--only=claude,codex,opencode'], { encoding: 'utf8', env });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')), {});
});

test('init --all writes every project target', () => {
  const dir = tmpDir();
  const r = run(dir, null, 'init', '--all');
  assert.equal(r.code, 0);
  for (const f of ['AGENTS.md', '.clinerules/ade.md', '.roo/rules/ade.md', '.kilocode/rules/ade.md', '.junie/guidelines.md', '.kiro/steering/ade.md', 'CONVENTIONS.md', '.goosehints', 'WARP.md', '.rules']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'ade.config.json'), 'utf8'));
  assert.ok(cfg.assistants.includes('roo'));
});
