import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toolDecision } from '../src/hooks.ts';
import { main } from '../src/cli.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, PRACTICES_OFF } from './helpers.ts';

function project(extra: Record<string, unknown> = {}): string {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF }, ...extra });
  const cycle = {
    id: 'c1',
    goal: 'ship the thing',
    phase: 'deploy',
    startCommit: git(dir, 'rev-parse', 'HEAD'),
    configHash: 'x',
    approvals: {},
    history: [],
  };
  fs.mkdirSync(path.join(dir, '.unslopped'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'state.json'), JSON.stringify({ cycle }) + '\n');
  return dir;
}

function capture() {
  let text = '';
  return { io: { write: (c: string) => (text += c) }, get: () => text };
}

test('approve returns ask with the deploy brief under prompt mode', () => {
  const dir = project();
  const d = toolDecision(dir, 'Bash', { command: 'unslopped approve deploy' });
  assert.equal(d.ask, true);
  assert.ok(!d.block);
  assert.match(d.reason ?? '', /ship the thing/);
  assert.match(d.reason ?? '', /commits/);
});

test('approve commit carries the proposal text', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.unslopped', 'proposals'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'proposals', 'commit.md'), 'feat: add thing\n\nIt adds the thing.\n');
  const d = toolDecision(dir, 'Bash', { command: 'unslopped approve commit' });
  assert.equal(d.ask, true);
  assert.match(d.reason ?? '', /feat: add thing/);
});

test('reset, rollback raise the prompt with their consequences', () => {
  const dir = project();
  const reset = toolDecision(dir, 'Bash', { command: 'unslopped reset' });
  assert.equal(reset.ask, true);
  assert.match(reset.reason ?? '', /abandon/i);
  assert.match(reset.reason ?? '', /ship the thing/);
  const rollback = toolDecision(dir, 'Bash', { command: 'unslopped rollback' });
  assert.equal(rollback.ask, true);
  assert.match(rollback.reason ?? '', /rollback/i);
});

test('command mode keeps reset, rollback denied', () => {
  const dir = project({ approvals: 'command' });
  assert.equal(toolDecision(dir, 'Bash', { command: 'unslopped reset' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'unslopped rollback' }).block, true);
});

test('command mode keeps approve denied', () => {
  const dir = project({ approvals: 'command' });
  const d = toolDecision(dir, 'Bash', { command: 'unslopped approve deploy' });
  assert.equal(d.block, true);
  assert.ok(!d.ask);
});

test('the claude tool hook emits ask JSON with exit 0', async () => {
  const dir = project();
  const c = capture();
  const code = await main(['hook', 'claude', 'tool'], dir, c.io, { stdin: { tool_name: 'Bash', tool_input: { command: 'unslopped approve deploy' }, cwd: dir } });
  assert.equal(code, 0);
  assert.match(c.get(), /"permissionDecision":"ask"/);
  assert.match(c.get(), /ship the thing/);
});

test('the claude tool hook still exits 2 for denials', async () => {
  const dir = project();
  const c = capture();
  const err = capture();
  const forcePush = ['git', 'push', '--force', 'origin', 'main'].join(' ');
  const code = await main(['hook', 'claude', 'tool'], dir, c.io, { stderr: err.io, stdin: { tool_name: 'Bash', tool_input: { command: forcePush }, cwd: dir } });
  assert.equal(code, 2);
  assert.match(err.get(), /force push/);
});

test('the cursor hook answers permission ask', async () => {
  const dir = project();
  const c = capture();
  const code = await main(['hook', 'cursor', 'shell'], dir, c.io, { stdin: { command: 'unslopped approve deploy', cwd: dir } });
  assert.equal(code, 0);
  const verdict = JSON.parse(c.get());
  assert.equal(verdict.permission, 'ask');
  assert.match(verdict.userMessage, /ship the thing/);
});

test('proposals lists the pending text, its state', async () => {
  const dir = project();
  const c1 = capture();
  assert.equal(await main(['proposals'], dir, c1.io), 0);
  assert.match(c1.get(), /no proposals pending/);
  fs.mkdirSync(path.join(dir, '.unslopped', 'proposals'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'proposals', 'commit.md'), 'feat: add thing\n\nIt adds the thing.\n');
  const c2 = capture();
  assert.equal(await main(['proposals'], dir, c2.io), 0);
  assert.match(c2.get(), /commit proposal/);
  assert.match(c2.get(), /feat: add thing/);
  assert.match(c2.get(), /It adds the thing\./);
  assert.match(c2.get(), /waiting for/);
});
