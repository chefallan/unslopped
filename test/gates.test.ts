import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runGate, acceptanceCriteria } from '../src/gates.ts';
import { newCycle, planPath, plansDir, planTemplate } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { nextPhase, PHASES } from '../src/phases.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, FAIL } from './helpers.ts';

function ctx(dir, commands, extra) {
  writeConfig(dir, commands, extra);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'config');
  const cycle = newCycle('goal', 'h', git(dir, 'rev-parse', 'HEAD'));
  return { root: dir, config: loadConfig(dir), cycle };
}

test('phase order, terminal phase', () => {
  assert.equal(PHASES.length, 8);
  assert.equal(nextPhase('plan'), 'code');
  assert.equal(nextPhase('monitor'), null);
  assert.equal(nextPhase('nope'), null);
});

test('acceptanceCriteria parses list items, ignores empty checkboxes', () => {
  assert.deepEqual(acceptanceCriteria('## Acceptance criteria\n- [ ]\n- [ ] login works\n* logout works\n\n## Monitor\n- not this'), ['login works', 'logout works']);
  assert.deepEqual(acceptanceCriteria('# nothing'), []);
});

test('plan gate fails on the template, passes with a criterion', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: PASS });
  fs.mkdirSync(plansDir(dir), { recursive: true });
  const file = planPath(dir, c.cycle.id);
  assert.equal(runGate('plan', c).pass, false);
  fs.writeFileSync(file, planTemplate(c.cycle));
  assert.equal(runGate('plan', c).pass, false);
  fs.writeFileSync(file, planTemplate(c.cycle).replace('- [ ]', '- [ ] endpoint returns 200'));
  assert.equal(runGate('plan', c).pass, true);
});

test('code gate requires changes, a passing lint', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: PASS, lint: PASS });
  assert.equal(runGate('code', c).pass, false);
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  assert.equal(runGate('code', c).pass, true);
  c.config.commands.lint = FAIL;
  const r = runGate('code', c);
  assert.equal(r.pass, false);
  assert.match(r.checks.find((x) => x.name === 'lint').detail, /boom/);
});

test('test gate fails without a test command, reports command output on failure', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: null });
  let r = runGate('test', c);
  assert.equal(r.pass, false);
  assert.match(r.checks[0].detail, /commands.test is not set/);
  c.config.commands.test = FAIL;
  r = runGate('test', c);
  assert.equal(r.pass, false);
  assert.match(r.checks[0].detail, /exit 1/);
  assert.match(r.checks[0].detail, /boom/);
  c.config.commands.test = PASS;
  assert.equal(runGate('test', c).pass, true);
});

test('build gate skips when no build command is configured', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: PASS });
  const r = runGate('build', c);
  assert.equal(r.pass, true);
  assert.match(r.checks[0].detail, /skipped/);
});

test('release gate requires a clean tree, new commits', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: PASS });
  assert.equal(runGate('release', c).pass, false);
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  assert.equal(runGate('release', c).pass, false);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: a');
  assert.equal(runGate('release', c).pass, true);
});

test('deploy gate blocks until a human approves, runs the deploy command', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: PASS, deploy: FAIL });
  let r = runGate('deploy', c);
  assert.equal(r.pass, false);
  assert.equal(r.checks.length, 1);
  assert.match(r.checks[0].detail, /approve deploy/);
  c.cycle.approvals.deploy = { at: 'now' };
  r = runGate('deploy', c);
  assert.equal(r.pass, false);
  assert.equal(r.checks[1].name, 'deploy');
  c.config.commands.deploy = PASS;
  assert.equal(runGate('deploy', c).pass, true);
});

test('deploy gate skips approval when disabled in config', () => {
  const dir = tmpDir();
  initRepo(dir);
  const c = ctx(dir, { test: PASS }, { deploy: { requireApproval: false } });
  const r = runGate('deploy', c);
  assert.equal(r.pass, true);
  assert.equal(r.checks[0].name, 'deploy');
});
