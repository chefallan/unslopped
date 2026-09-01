import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authorshipCheck, mergePractices } from '../src/practices.ts';
import { toolDecision } from '../src/hooks.ts';
import { tmpDir, initRepo, git, PRACTICES_OFF } from './helpers.ts';

function repo(): { dir: string; start: string } {
  const dir = tmpDir();
  initRepo(dir);
  return { dir, start: git(dir, 'rev-parse', 'HEAD') };
}

function ctx(dir: string, start: string, on = true) {
  const practices = mergePractices({ ...PRACTICES_OFF, humanAuthorship: on } as never);
  return { root: dir, config: { practices }, cycle: { startCommit: start } } as never;
}

function commitFile(dir: string, ...args: string[]) {
  fs.writeFileSync(path.join(dir, `f${Date.now()}${Math.random()}.js`), '1\n');
  git(dir, 'add', '.');
  git(dir, ...args);
}

test('an assistant co-author trailer fails the release check', () => {
  const { dir, start } = repo();
  commitFile(dir, 'commit', '-q', '-m', 'feat: x', '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>');
  const c = authorshipCheck(ctx(dir, start))!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /Co-Authored-By: Claude/);
});

test('an assistant author identity fails the release check', () => {
  const { dir, start } = repo();
  commitFile(dir, '-c', 'user.name=Claude', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '-m', 'feat: y');
  const c = authorshipCheck(ctx(dir, start))!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /looks like an assistant/);
});

test('a generated-with badge line fails the release check', () => {
  const { dir, start } = repo();
  commitFile(dir, 'commit', '-q', '-m', 'feat: z', '-m', 'Generated with Claude Code');
  const c = authorshipCheck(ctx(dir, start))!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /attribution badge/);
});

test('a human co-author trailer passes the release check', () => {
  const { dir, start } = repo();
  commitFile(dir, 'commit', '-q', '-m', 'feat: pair work', '-m', 'Co-authored-by: Jane Doe <jane@corp.example>');
  const c = authorshipCheck(ctx(dir, start))!;
  assert.equal(c.ok, true, c.detail);
});

test('humanAuthorship off skips the check', () => {
  const { dir, start } = repo();
  commitFile(dir, 'commit', '-q', '-m', 'feat: q', '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>');
  assert.equal(authorshipCheck(ctx(dir, start, false)), null);
});

function activeProject(): string {
  const dir = tmpDir();
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'unslopped.config.json'), '{ "practices": { "messageApproval": false } }\n');
  fs.mkdirSync(path.join(dir, '.unslopped'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'state.json'), JSON.stringify({ cycle: { id: 'x', phase: 'code' } }) + '\n');
  return dir;
}

test('the tool hook denies a commit carrying an assistant co-author', () => {
  const dir = activeProject();
  const bad = 'git commit -m "feat: x" -m "Co-Authored-By: Claude <noreply@anthropic.com>"';
  assert.equal(toolDecision(dir, 'Bash', { command: bad }).block, true);
  const human = 'git commit -m "feat: x" -m "Co-authored-by: Jane Doe <jane@corp.example>"';
  assert.equal(toolDecision(dir, 'Bash', { command: human }).block, false);
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit -m "docs: claude hooks"' }).block, false);
});
