import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { redCheck, countFindings, reviewArtifactCheck } from '../src/practices.ts';
import { runGate } from '../src/gates.ts';
import { newCycle } from '../src/state.ts';
import { loadConfig, detectCommands } from '../src/config.ts';
import { lastCommitMs } from '../src/git.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, BIN, NO_TRACKER_ENV, PRACTICES_OFF } from './helpers.ts';

const RED_GREEN_TEST = 'node -e "process.exit(require(\'fs\').existsSync(\'impl.js\') ? 0 : 1)"';

function cli(cwd: string, args: string[], input?: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, ...NO_TRACKER_ENV } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function readState(dir: string) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.ade', 'state.json'), 'utf8'));
}

function setPhase(dir: string, phase: string) {
  const s = readState(dir);
  s.cycle.phase = phase;
  fs.writeFileSync(path.join(dir, '.ade', 'state.json'), JSON.stringify(s));
}

function repo(commands: Record<string, string | null>, practices: Record<string, unknown>) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, commands, { practices: { ...PRACTICES_OFF, ...practices } });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.ade/state.json\n.ade/cycles/\n.ade/logs/\n.ade/worktrees/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  return dir;
}

test('ade red records a failing run for the changed tests, the test gate demands it', () => {
  const dir = repo({ test: RED_GREEN_TEST }, { tdd: true });
  assert.equal(cli(dir, ['start', 'Add impl']).code, 0);

  let r = cli(dir, ['red']);
  assert.equal(r.code, 2);
  assert.match(r.out, /no test file changed/);

  fs.writeFileSync(path.join(dir, 'impl.test.js'), 'require("./impl.js");\n');
  r = cli(dir, ['red']);
  assert.equal(r.code, 0);
  assert.match(r.out, /red recorded \(exit 1\) for impl\.test\.js/);
  const red = readState(dir).cycle.red;
  assert.equal(red.length, 1);
  assert.deepEqual(red[0].testFiles, ['impl.test.js']);

  fs.writeFileSync(path.join(dir, 'impl.js'), 'module.exports = 1;\n');
  r = cli(dir, ['red']);
  assert.equal(r.code, 1);
  assert.match(r.out, /nothing is red/);
  assert.equal(readState(dir).cycle.red.length, 1);

  setPhase(dir, 'test');
  r = cli(dir, ['next']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok   red before green: 1 failing run\(s\) recorded/);
});

test('without a red run the test gate fails, refactors without tests are exempt', () => {
  const dir = repo({ test: PASS }, { tdd: true });
  const cycle = newCycle('g', 'h', git(dir, 'rev-parse', 'HEAD'));
  const ctx = () => ({ root: dir, config: loadConfig(dir)!, cycle });
  assert.match(redCheck(ctx())!.detail, /nothing to prove/);
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  assert.match(redCheck(ctx())!.detail, /nothing to prove/);
  fs.writeFileSync(path.join(dir, 'a.test.js'), '1\n');
  const fail = redCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /run `ade red`/);
  cycle.red = [{ at: 'now', code: 1, testFiles: ['other.test.js'], summary: '' }];
  assert.equal(redCheck(ctx())!.ok, false);
  cycle.red.push({ at: 'now', code: 1, testFiles: ['a.test.js'], summary: '' });
  assert.equal(redCheck(ctx())!.ok, true);
  const gate = runGate('test', ctx());
  assert.deepEqual(gate.checks.map((c) => c.name), ['test', 'red before green']);
  assert.equal(gate.pass, true);
});

test('review findings are counted by severity markers', () => {
  const text = ['# Review', '', '- [critical] SQL built by string concat in db.js:12', '- [Major]: no timeout on fetch', '1. [minor] rename foo', '- blocker: secrets in log', '- nit: trailing space', 'looks fine otherwise'].join('\n');
  assert.deepEqual(countFindings(text), { critical: 2, major: 1, minor: 2 });
  assert.deepEqual(countFindings('LGTM'), { critical: 0, major: 0, minor: 0 });
});

test('ade review records an artifact, release blocks on critical or stale reviews', () => {
  const dir = repo({ test: PASS }, { reviewArtifact: true });
  assert.equal(cli(dir, ['start', 'Add thing']).code, 0);
  fs.writeFileSync(path.join(dir, 'thing.js'), '1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: thing');
  setPhase(dir, 'release');

  let r = cli(dir, ['next']);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL review artifact: no review recorded/);

  assert.equal(cli(dir, ['review']).code, 2);

  fs.writeFileSync(path.join(dir, 'r.md'), '- [critical] unbounded loop\n- [minor] naming\n');
  r = cli(dir, ['review', '--file=r.md']);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 critical, 0 major, 1 minor, from file/);
  assert.match(r.out, /critical findings block release/);
  assert.ok(fs.existsSync(path.join(dir, '.ade', 'reviews', `${readState(dir).cycle.id}.md`)));
  fs.unlinkSync(path.join(dir, 'r.md'));
  r = cli(dir, ['next']);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL review artifact: 1 critical finding/);

  r = cli(dir, ['review'], '- [minor] naming\nLGTM\n');
  assert.equal(r.code, 0);
  assert.match(r.out, /0 critical, 0 major, 1 minor, from stdin/);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'docs: review');
  r = cli(dir, ['next']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok   review artifact/);

  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'ade.config.json'), 'utf8'));
  const cycle = readState(dir).cycle;
  const ctx = { root: dir, config: loadConfig(dir)!, cycle };
  assert.equal(reviewArtifactCheck(ctx, lastCommitMs(dir))!.ok, true);
  assert.equal(reviewArtifactCheck(ctx, Date.parse(cycle.review.at) + 60000)!.ok, false);
  assert.match(reviewArtifactCheck(ctx, Date.parse(cycle.review.at) + 60000)!.detail, /older than the latest commit/);
  assert.equal(cfg.practices.reviewArtifact, true);
});

test('a configured reviewer command produces the artifact, via stdout or the file it is told to write', () => {
  const dir = repo({ test: PASS }, { reviewArtifact: true, reviewCommand: 'node -e "console.log(\'- [major] use const\')"' });
  assert.equal(cli(dir, ['start', 'x']).code, 0);
  let r = cli(dir, ['review']);
  assert.equal(r.code, 0);
  assert.match(r.out, /0 critical, 1 major, 0 minor, from command/);

  const cfgFile = path.join(dir, 'ade.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.practices.reviewCommand = 'node -e "require(\'fs\').writeFileSync(process.env.ADE_REVIEW_FILE, \'- [critical] \' + process.env.ADE_CYCLE_ID)"';
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  r = cli(dir, ['review']);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 critical/);
  const id = readState(dir).cycle.id;
  assert.match(fs.readFileSync(path.join(dir, '.ade', 'reviews', `${id}.md`), 'utf8'), new RegExp(`\\[critical\\] ${id}`));

  cfg.practices.reviewCommand = 'node -e "process.exit(3)"';
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  r = cli(dir, ['review']);
  assert.equal(r.code, 1);
  assert.match(r.out, /reviewer exited 3/);
});

test('start --worktree runs the cycle in an isolated checkout on a new branch', () => {
  const dir = repo({ test: PASS, setup: 'node -e "require(\'fs\').writeFileSync(\'setup-ran\', \'1\')"' }, { protectedBranches: ['main', 'master'] });
  let r = cli(dir, ['start', 'Add health endpoint ENG-9']);
  assert.equal(r.code, 2);
  assert.match(r.out, /ade start --worktree/);

  r = cli(dir, ['start', '--worktree', 'Add health endpoint ENG-9']);
  assert.equal(r.code, 0, r.out);
  const m = r.out.match(/worktree created at (.+) on branch (\S+)/);
  assert.ok(m, r.out);
  const wt = m![1];
  const branch = m![2];
  assert.equal(branch, 'eng-9-add-health-endpoint');
  assert.ok(wt.startsWith(path.join(dir, '.ade', 'worktrees')));
  assert.match(r.out, /running setup/);
  assert.ok(fs.existsSync(path.join(wt, 'setup-ran')));
  assert.ok(fs.existsSync(path.join(wt, '.ade', 'state.json')));
  assert.ok(!fs.existsSync(path.join(dir, '.ade', 'state.json')));
  assert.equal(readState(wt).cycle.worktree, wt);
  assert.match(git(dir, 'worktree', 'list'), new RegExp(branch));
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), branch);
  assert.equal(git(dir, 'status', '--porcelain'), '');

  r = cli(wt, ['status']);
  assert.equal(r.code, 0);
  assert.match(r.out, /phase plan/);
  r = cli(dir, ['status']);
  assert.match(r.out, /no active cycle/);

  r = cli(dir, ['start', '--worktree', 'Add health endpoint ENG-9']);
  assert.equal(r.code, 2);
  assert.match(r.out, /already exists/);

  r = cli(wt, ['reset']);
  assert.equal(r.code, 0);
  assert.match(r.out, /git worktree remove/);
});

test('setup command is detected per package manager', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  assert.equal(detectCommands(dir).setup, 'npm install');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  assert.equal(detectCommands(dir).setup, 'npm ci');
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  assert.equal(detectCommands(dir).setup, 'pnpm install --frozen-lockfile');
  assert.equal(detectCommands(tmpDir()).setup, null);
});
