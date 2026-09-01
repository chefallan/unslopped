import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanStyle, styleDefaults } from '../src/practices.ts';
import { nextSteps } from '../src/resume.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS } from './helpers.ts';

function startCycle(dir: string, goal: string): string {
  const r = cli(dir, 'start', goal);
  assert.equal(r.code, 0, r.out);
  return r.out.match(/started cycle (\S+)/)![1];
}

test('resume with no active cycle points at start', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const r = cli(dir, 'resume');
  assert.equal(r.code, 2);
  assert.match(r.out, /no active cycle/);
  assert.match(r.out, /unslopped start/);
});

test('resume lists the phase, the plan path, the next actions', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const id = startCycle(dir, 'resume goal');
  const r = cli(dir, 'resume');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cycle .+resume goal/);
  assert.match(r.out, /phase plan \(1\/8\)/);
  assert.match(r.out, new RegExp(`plans.${id}\\.md`));
  assert.match(r.out, /do next:/);
  assert.match(r.out, /1\. fill in the plan/);
  assert.match(r.out, /unslopped next/);
});

test('resume shows the failing checks from the last gate run', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  startCycle(dir, 'failing gate');
  assert.equal(cli(dir, 'next').code, 1);
  const r = cli(dir, 'resume');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /last {2}plan FAIL/);
  assert.match(r.out, /FAIL acceptance criteria/);
});

test('continue prints the same output as resume', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  startCycle(dir, 'alias goal');
  assert.equal(cli(dir, 'continue').out, cli(dir, 'resume').out);
});

test('reset with a goal starts the next cycle in one invocation', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const first = startCycle(dir, 'first goal');
  const r = cli(dir, 'reset', 'second goal');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`abandoned cycle ${first}`));
  assert.match(r.out, /started cycle/);
  const archived = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'cycles', `${first}.json`), 'utf8'));
  assert.equal(archived.status, 'abandoned');
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  assert.equal(state.cycle.goal, 'second goal');
  assert.notEqual(state.cycle.id, first);
});

test('reset without a goal only abandons', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  startCycle(dir, 'lone goal');
  const r = cli(dir, 'reset');
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /started cycle/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  assert.equal(state.cycle, null);
});

test('start warns when uncommitted files predate the cycle', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  fs.writeFileSync(path.join(dir, 'stray.js'), '1\n');
  const r = cli(dir, 'start', 'dirty baseline');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\d+ uncommitted file\(s\) predate this cycle/);
});

test('start stays quiet on a clean baseline', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const r = cli(dir, 'start', 'clean baseline');
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /predate this cycle/);
});

test('scanStyle skips the unslopped config file', () => {
  const dash = String.fromCharCode(0x2014);
  const rules = styleDefaults();
  const hits = scanStyle(
    [
      { file: 'unslopped.config.json', line: 3, text: `"forbidden": ["${dash}"]` },
      { file: 'src/a.ts', line: 1, text: `const s = "${dash}";` },
    ],
    rules,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'src/a.ts');
});

test('nextSteps asks for a red run only before one is recorded', () => {
  const config = { practices: { tdd: true, reviewArtifact: false }, deploy: { requireApproval: true }, tracker: { provider: null } } as never;
  const bare = { red: [], approvals: {} } as never;
  const before = nextSteps('code', config, bare);
  assert.match(before[0], /unslopped red/);
  const seen = { red: [{ at: 'x', code: 1, testFiles: [], summary: '' }], approvals: {} } as never;
  const after = nextSteps('code', config, seen);
  assert.doesNotMatch(after[0], /unslopped red/);
});
