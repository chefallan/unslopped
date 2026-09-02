import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sessionContext, promptContext, toolDecision } from '../src/hooks.ts';
import { tmpDir, initRepo, git, writeConfig, PASS } from './helpers.ts';

function project({ cycle = false } = {}) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  if (cycle) {
    fs.mkdirSync(path.join(dir, '.unslopped'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.unslopped', 'state.json'), JSON.stringify({ cycle: { id: 'c1', goal: 'g', phase: 'code', history: [], approvals: {}, configHash: 'x' } }));
  }
  return dir;
}

test('session context carries the protocol, the status', () => {
  const dir = project({ cycle: true });
  const text = sessionContext(dir);
  assert.match(text, /# Unslopped SDLC protocol/);
  assert.match(text, /unslopped next/);
  assert.doesNotMatch(text, /npx unslopped/);
  assert.match(text, /phase code \(2\/8\)/);
  assert.equal(sessionContext(tmpDir()), '');
});

test('session context asks for init when the project has no config', () => {
  const dir = tmpDir();
  initRepo(dir);
  assert.match(sessionContext(dir), /not initialized. Run `unslopped init`/);
});

test('prompt context proposes a start command, the detected issue', () => {
  const dir = project();
  const text = promptContext(dir, 'Fix the login timeout ENG-42\nmore detail');
  assert.match(text, /no active cycle/);
  assert.match(text, /unslopped start "Fix the login timeout ENG-42"/);
  assert.match(text, /Issue ENG-42 will be linked/);
  git(dir, 'checkout', '-q', '-b', 'bob/app-9-thing');
  assert.match(promptContext(dir, 'tidy up'), /Issue APP-9 will be linked/);
});

test('prompt context reports the active cycle', () => {
  const dir = project({ cycle: true });
  const text = promptContext(dir, 'whatever');
  assert.match(text, /active cycle/);
  assert.match(text, /phase code/);
  assert.match(text, /Continue this cycle/);
});

test('prompt context asks for init on an uninitialized repo, is silent outside git', () => {
  const dir = tmpDir();
  initRepo(dir);
  assert.match(promptContext(dir, 'x'), /Run `unslopped init` first/);
  assert.equal(promptContext(tmpDir(), 'x'), '');
});

test('tool decisions block human only commands, state edits', () => {
  const dir = project({ cycle: true });
  const bash = (command) => toolDecision(dir, 'Bash', { command });
  assert.equal(bash('unslopped approve deploy').ask, true);
  assert.equal(bash('npx unslopped reset').ask, true);
  assert.equal(bash('git commit --no-verify -m x').block, true);
  assert.equal(bash('git push --force origin main').block, true);
  assert.equal(bash('git push -f').block, true);
  assert.equal(bash('echo {} > .unslopped/state.json').block, true);
  assert.equal(bash('rm -rf .unslopped/cycles').block, true);
  assert.equal(bash('cat .unslopped/state.json').block, false);
  assert.equal(bash('unslopped status --json').block, false);
  assert.equal(bash('sed -i s/a/b/ unslopped.config.json').block, true);
  assert.equal(bash('cat unslopped.config.json').block, false);
  assert.equal(bash('git push origin main').block, false);
  assert.equal(bash('npm test').block, false);
  assert.equal(bash('unslopped next').block, false);
});

test('tool decisions block edits to state and, mid cycle, to config', () => {
  const active = project({ cycle: true });
  assert.equal(toolDecision(active, 'Edit', { file_path: path.join(active, '.unslopped', 'state.json') }).block, true);
  assert.equal(toolDecision(active, 'Write', { file_path: path.join(active, '.unslopped', 'cycles', 'x.json') }).block, true);
  assert.equal(toolDecision(active, 'Write', { file_path: path.join(active, 'unslopped.config.json') }).block, true);
  assert.equal(toolDecision(active, 'Edit', { file_path: path.join(active, 'src', 'a.js') }).block, false);
  assert.equal(toolDecision(active, 'Edit', { file_path: path.join(active, '.unslopped', 'plans', 'c1.md') }).block, false);
  const idle = project();
  assert.equal(toolDecision(idle, 'Write', { file_path: path.join(idle, 'unslopped.config.json') }).block, false);
  assert.equal(toolDecision(idle, 'Bash', { command: 'echo x > unslopped.config.json' }).block, false);
});

test('tool decisions stay out of projects that do not use unslopped', () => {
  const dir = tmpDir();
  initRepo(dir);
  assert.equal(toolDecision(dir, 'Bash', { command: 'git push --force' }).block, false);
  assert.equal(toolDecision(dir, 'Bash', { command: 'unslopped approve deploy' }).block, false);
});
