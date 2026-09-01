import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toolDecision } from '../src/hooks.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

function project(on = true): string {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, messageApproval: on } });
  assert.equal(cli(dir, 'start', 'guarded words').code, 0);
  fs.writeFileSync(path.join(dir, 'work.js'), '1\n');
  git(dir, 'add', '.');
  return dir;
}

function proposeThing(dir: string): void {
  fs.writeFileSync(path.join(dir, 'body.md'), 'It adds the thing.\n');
  const r = cli(dir, 'propose', 'commit', 'feat: add thing', '--file=body.md');
  assert.equal(r.code, 0, r.out);
}

test('commit refuses without a proposal', () => {
  const dir = project();
  const r = cli(dir, 'commit');
  assert.equal(r.code, 2);
  assert.match(r.out, /propose commit/);
});

test('propose commit records the message, waits for the human', () => {
  const dir = project();
  proposeThing(dir);
  const r = cli(dir, 'propose', 'commit', 'feat: add thing', '--file=body.md');
  assert.match(r.out, /approve commit/);
  const text = fs.readFileSync(path.join(dir, '.unslopped', 'proposals', 'commit.md'), 'utf8');
  assert.match(text, /^feat: add thing\n\nIt adds the thing\./);
});

test('commit refuses before approval', () => {
  const dir = project();
  proposeThing(dir);
  const r = cli(dir, 'commit');
  assert.equal(r.code, 2);
  assert.match(r.out, /approve commit/);
});

test('approved text commits verbatim, approval is consumed', () => {
  const dir = project();
  proposeThing(dir);
  const a = cli(dir, 'approve', 'commit');
  assert.equal(a.code, 0, a.out);
  assert.match(a.out, /feat: add thing/);
  const c = cli(dir, 'commit');
  assert.equal(c.code, 0, c.out);
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'feat: add thing');
  assert.match(git(dir, 'log', '-1', '--format=%b'), /It adds the thing\./);
  fs.writeFileSync(path.join(dir, 'work2.js'), '1\n');
  git(dir, 'add', '.');
  const again = cli(dir, 'commit');
  assert.equal(again.code, 2);
  assert.match(again.out, /propose commit/);
});

test('a proposal edited after approval refuses to commit', () => {
  const dir = project();
  proposeThing(dir);
  assert.equal(cli(dir, 'approve', 'commit').code, 0);
  fs.appendFileSync(path.join(dir, '.unslopped', 'proposals', 'commit.md'), 'sneaky extra line\n');
  const r = cli(dir, 'commit');
  assert.equal(r.code, 2);
  assert.match(r.out, /changed after approval/);
});

test('the tool hook denies raw git commit while approval is on', () => {
  const on = project();
  assert.equal(toolDecision(on, 'Bash', { command: 'git commit -m "feat: x"' }).block, true);
  const off = project(false);
  assert.equal(toolDecision(off, 'Bash', { command: 'git commit -m "feat: x"' }).block, false);
});
