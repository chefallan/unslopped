import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toolDecision } from '../src/hooks.ts';
import { stagedFiles } from '../src/git.ts';
import { quizCheck, practiceDefaults } from '../src/practices.ts';
import { parseQuiz } from '../src/quiz.ts';
import { newCycle } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

const ARTIFACT = ['1. Why?', '- a) one', '- b) two', 'answer: b', ''].join('\n');

function project(practices: Record<string, unknown> = {}) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, messageApproval: true, ...practices } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  return dir;
}

function stage(dir: string, file: string, body = 'x\n') {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  git(dir, 'add', '--', file);
}

test('stagedFiles lists what is staged, with forward slashes', () => {
  const dir = project();
  stage(dir, '.unslopped/DEBT.md');
  stage(dir, 'src/thing.ts');
  assert.deepEqual(stagedFiles(dir).sort(), ['.unslopped/DEBT.md', 'src/thing.ts']);
});

test('stagedFiles is empty when nothing is staged', () => {
  assert.deepEqual(stagedFiles(project()), []);
});

test('with no cycle, a commit of only unslopped bookkeeping is allowed', () => {
  const dir = project();
  stage(dir, '.unslopped/DEBT.md');
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit -m "chore(debt): log it"' }).block, false);
});

test('with no cycle, a commit touching source is refused', () => {
  const dir = project();
  stage(dir, 'src/thing.ts');
  const d = toolDecision(dir, 'Bash', { command: 'git commit -m "feat: sneak it in"' });
  assert.equal(d.block, true);
  assert.match(d.reason!, /src\/thing\.ts/);
  assert.match(d.reason!, /start a cycle/i);
});

test('with no cycle, a mixed commit is refused for the source half', () => {
  const dir = project();
  stage(dir, '.unslopped/DEBT.md');
  stage(dir, 'src/thing.ts');
  const d = toolDecision(dir, 'Bash', { command: 'git commit -m "chore: bookkeeping"' });
  assert.equal(d.block, true);
  assert.match(d.reason!, /src\/thing\.ts/);
});

test('with a cycle active, a commit still needs the approved message', () => {
  const dir = project();
  stage(dir, '.unslopped/DEBT.md');
  cli(dir, 'start', 'do a thing');
  const d = toolDecision(dir, 'Bash', { command: 'git commit -m "chore(debt): log it"' });
  assert.equal(d.block, true);
  assert.match(d.reason!, /propose commit/);
});

test('with no cycle, commit -a is refused for a tracked source change it would sweep in', () => {
  const dir = project();
  stage(dir, 'src/thing.ts');
  git(dir, 'commit', '-q', '-m', 'chore: land it');
  fs.writeFileSync(path.join(dir, 'src/thing.ts'), 'edited\n');
  const d = toolDecision(dir, 'Bash', { command: 'git commit -am "feat: sneak it in"' });
  assert.equal(d.block, true);
  assert.match(d.reason!, /src\/thing\.ts/);
});

test('with no cycle, commit --amend is not mistaken for commit --all', () => {
  const dir = project();
  stage(dir, 'src/thing.ts');
  git(dir, 'commit', '-q', '-m', 'chore: land it');
  fs.writeFileSync(path.join(dir, 'src/thing.ts'), 'edited\n');
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit --amend --no-edit' }).block, false);
});

test('with no cycle, commit -a of only bookkeeping is still allowed', () => {
  const dir = project();
  stage(dir, '.unslopped/DEBT.md');
  git(dir, 'commit', '-q', '-m', 'chore: land it');
  fs.writeFileSync(path.join(dir, '.unslopped/DEBT.md'), 'edited\n');
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit -am "chore(debt): log it"' }).block, false);
});

test('message approval off leaves commits alone outside a cycle', () => {
  const dir = project({ messageApproval: false });
  stage(dir, 'src/thing.ts');
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit -m "feat: fine"' }).block, false);
});

function quizRepo() {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, quiz: { enabled: true, minLines: 1, pass: 100, maxAttempts: 3 } } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('goal', 'h', git(dir, 'rev-parse', 'HEAD'));
  fs.writeFileSync(path.join(dir, 'src.txt'), 'a\nb\nc\n');
  return { dir, cycle, ctx: () => ({ root: dir, config: loadConfig(dir)!, cycle }) };
}

test('quizCheck calls a recorded quiz with no attempt waiting, not wrong', () => {
  const r = quizRepo();
  const questions = parseQuiz(ARTIFACT).questions;
  r.cycle.quiz = { at: new Date().toISOString(), total: 1, correct: 0, missed: [1], attempts: 0, passed: false, questions };
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /waiting for an answer/i);
  assert.equal(/0 of 1 right/.test(c.detail), false);
  assert.equal(/missed question/.test(c.detail), false);
});

test('quizCheck still reports the score once an attempt exists', () => {
  const r = quizRepo();
  const questions = parseQuiz(ARTIFACT).questions;
  r.cycle.quiz = { at: new Date().toISOString(), total: 1, correct: 0, missed: [1], attempts: 1, passed: false, questions };
  const c = quizCheck(r.ctx(), null)!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /0 of 1 right/);
  assert.match(c.detail, /missed question 1/);
});

test('log prints the archived cycles when none is active', () => {
  const dir = project();
  cli(dir, 'start', 'first goal');
  const before = cli(dir, 'log');
  assert.equal(before.code, 0);
  cli(dir, 'reset');
  const r = cli(dir, 'log');
  assert.equal(r.code, 0);
  assert.equal(/^error:/m.test(r.out), false);
  assert.match(r.out, /1 archived/);
  assert.match(r.out, /first goal/);
});

test('log says so plainly when the repository has no cycles at all', () => {
  const r = cli(project(), 'log');
  assert.equal(r.code, 0);
  assert.match(r.out, /no cycles yet/i);
});

test('log with an active cycle still prints that cycle gate runs', () => {
  const dir = project();
  cli(dir, 'start', 'a goal');
  cli(dir, 'check');
  const r = cli(dir, 'log');
  assert.equal(r.code, 0);
  assert.match(r.out, /plan/);
});

test('the readme journey names the ladder rung, the quiz, the real moment count', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const journey = readme.slice(readme.indexOf('## The journey'), readme.indexOf('## How a cycle runs'));
  assert.match(journey, /rung/i);
  assert.match(journey, /quiz/i);
  assert.equal(/five moments/i.test(journey), false);
  const steps = journey.match(/^\d+\. \*\*/gm) ?? [];
  assert.ok(steps.length >= 8);
  const moments = journey.slice(journey.indexOf('Your moments'));
  for (const named of ['design questions', 'approve commit', 'approve pr', 'approve deploy', 'merge']) {
    assert.match(moments, new RegExp(named));
  }
  assert.match(moments, /six or seven/i);
});

test('the quiz practice stays off by default so the readme claim holds', () => {
  assert.equal(practiceDefaults().quiz!.enabled, false);
});
