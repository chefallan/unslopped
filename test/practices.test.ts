import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isTestFile, isSourceFile, testEvidenceCheck, diffSizeCheck, scanSecrets, secretScanCheck, criteriaItems, criteriaCheckedCheck, commitFormatCheck, reviewApprovalCheck, rollbackCheck, monitorNotesCheck, protectedBranchProblem, branchSuggestion, practiceDefaults, DEFAULT_TEST_PATTERNS, planSectionsCheck, parseCoverage, coverageCheck, changelogCheck } from '../src/practices.ts';
import { runGate } from '../src/gates.ts';
import { newCycle, planPath, plansDir } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { toolDecision } from '../src/hooks.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, BIN, NO_TRACKER_ENV, PRACTICES_OFF } from './helpers.ts';

function repo(practices = {}) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, ...practices } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('Add health endpoint', 'h', git(dir, 'rev-parse', 'HEAD'));
  fs.mkdirSync(plansDir(dir), { recursive: true });
  return { dir, cycle, ctx: () => ({ root: dir, config: loadConfig(dir)!, cycle }) };
}

function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...NO_TRACKER_ENV } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('test, source file classification', () => {
  const p = DEFAULT_TEST_PATTERNS;
  assert.equal(isTestFile('src/a.test.ts', p), true);
  assert.equal(isTestFile('test/cli.test.js', p), true);
  assert.equal(isTestFile('pkg/thing_test.go', p), true);
  assert.equal(isTestFile('tests/test_login.py', p), true);
  assert.equal(isTestFile('src/LoginTest.java', p), true);
  assert.equal(isTestFile('src/login.ts', p), false);
  assert.equal(isSourceFile('src/login.ts', p), true);
  assert.equal(isSourceFile('README.md', p), false);
  assert.equal(isSourceFile('package.json', p), false);
  assert.equal(isSourceFile('src/login.test.ts', p), false);
});

test('test evidence requires a test change next to a source change', () => {
  const { dir, ctx } = repo({ testEvidence: true });
  fs.writeFileSync(path.join(dir, 'docs.md'), 'notes\n');
  assert.equal(testEvidenceCheck(ctx())!.ok, true);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'health.js'), '1\n');
  const fail = testEvidenceCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /src\/health\.js/);
  fs.writeFileSync(path.join(dir, 'src', 'health.test.js'), '1\n');
  assert.equal(testEvidenceCheck(ctx())!.ok, true);
  const off = repo({ testEvidence: false });
  assert.equal(testEvidenceCheck(off.ctx()), null);
});

test('diff size counts tracked, untracked lines', () => {
  const { dir, ctx } = repo({ maxDiffLines: 10 });
  fs.writeFileSync(path.join(dir, 'a.js'), Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n') + '\n');
  assert.equal(diffSizeCheck(ctx())!.ok, true);
  fs.writeFileSync(path.join(dir, 'README.md'), Array.from({ length: 5 }, (_, i) => `doc ${i}`).join('\n') + '\n');
  const fail = diffSizeCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /exceeds the limit of 10/);
  assert.equal(diffSizeCheck(repo({ maxDiffLines: 0 }).ctx()), null);
});

test('secret scan finds credentials in added lines, skips placeholders, lockfiles', () => {
  const { dir, ctx } = repo({ secretScan: true });
  assert.equal(secretScanCheck(ctx())!.ok, true);
  fs.writeFileSync(path.join(dir, 'config.js'), `const key = "AKIA${'A'.repeat(16)}";\nconst ok = process.env.SECRET;\nconst token = "example-token-value-here";\n`);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), `{"x":"AKIA${'B'.repeat(16)}"}`);
  const hits = scanSecrets(dir, ctx().cycle.startCommit);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'config.js');
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].name, 'AWS access key');
  const fail = secretScanCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /config\.js:1 looks like a AWS access key/);
  git(dir, 'add', 'config.js');
  git(dir, 'commit', '-q', '-m', 'feat: leak');
  assert.equal(secretScanCheck(ctx())!.ok, false);
  fs.writeFileSync(path.join(dir, 'config.js'), 'const key = process.env.KEY;\n');
  fs.unlinkSync(path.join(dir, 'package-lock.json'));
  git(dir, 'add', 'config.js');
  git(dir, 'commit', '-q', '-m', 'fix: use env');
  assert.equal(secretScanCheck(ctx())!.ok, true);
});

test('acceptance criteria must be ticked before release', () => {
  assert.deepEqual(criteriaItems('## Acceptance criteria\n- [ ] a\n- [x] b\n- c\n\n## Monitor\n- [ ] not this'), [
    { text: 'a', checked: false },
    { text: 'b', checked: true },
    { text: 'c', checked: false },
  ]);
  const { dir, cycle, ctx } = repo({ criteriaChecked: true });
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [ ] returns 200\n- [x] logs request\n');
  const fail = criteriaCheckedCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /1 acceptance criterion\(s\) not ticked/);
  assert.match(fail.detail, /- returns 200/);
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [x] returns 200\n- [X] logs request\n');
  assert.equal(criteriaCheckedCheck(ctx())!.ok, true);
});

test('commit messages must match the pattern, merges are ignored', () => {
  const { dir, ctx } = repo({ commitPattern: practiceDefaults().commitPattern });
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'added stuff');
  const fail = commitFormatCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /- added stuff/);
  git(dir, 'commit', '-q', '--amend', '-m', 'feat(api): add stuff');
  assert.equal(commitFormatCheck(ctx())!.ok, true);
  fs.writeFileSync(path.join(dir, 'b.js'), '1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', "Merge branch 'x'");
  assert.equal(commitFormatCheck(ctx())!.ok, true);
  assert.equal(commitFormatCheck(repo({ commitPattern: null }).ctx()), null);
});

test('review approval, rollback readiness, monitor notes', () => {
  const { cycle, ctx } = repo({ reviewApproval: true, rollback: true, monitorNotes: true });
  assert.equal(reviewApprovalCheck(ctx())!.ok, false);
  cycle.approvals.review = { at: 'now' };
  assert.equal(reviewApprovalCheck(ctx())!.ok, true);

  assert.equal(rollbackCheck(ctx()), null);
  const c = ctx();
  c.config.commands.deploy = PASS;
  const noRollback = rollbackCheck(c)!;
  assert.equal(noRollback.ok, false);
  assert.match(noRollback.detail, /commands\.rollback is not set/);
  c.config.commands.rollback = 'echo undo';
  assert.equal(rollbackCheck(c)!.ok, true);

  assert.equal(monitorNotesCheck(ctx(), '')!.ok, true);
  cycle.history.push({ phase: 'test', at: 'now', pass: false, advanced: false, checks: [] });
  assert.equal(monitorNotesCheck(ctx(), '')!.ok, false);
  assert.equal(monitorNotesCheck(ctx(), 'flaky test, retried')!.ok, true);
});

test('plan sections must be filled in, empty checkboxes do not count', () => {
  const { ctx } = repo({ planSections: ['Goal', 'Approach', 'Files to touch'] });
  const empty = '# g\n\n## Goal\n\n## Approach\n\n## Files to touch\n- [ ]\n\n## Acceptance criteria\n- [ ] x\n';
  const fail = planSectionsCheck(ctx(), empty)!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /"## Goal", "## Approach", "## Files to touch"/);
  const partial = empty.replace('## Goal\n', '## Goal\nship it\n').replace('## Approach\n', '## Approach\nsmall change\n');
  assert.match(planSectionsCheck(ctx(), partial)!.detail, /^fill in "## Files to touch"/);
  const full = partial.replace('## Files to touch\n- [ ]\n', '## Files to touch\n- src/a.ts\n');
  assert.equal(planSectionsCheck(ctx(), full)!.ok, true);
  assert.equal(planSectionsCheck(repo({ planSections: [] }).ctx(), empty), null);
});

test('coverage percentages are read from common reporters', () => {
  assert.equal(parseCoverage('----------|---------|\nFile      | % Stmts |\nAll files |   85.71 |     100 |   80 |   85.71 |\n'), 85.71);
  assert.equal(parseCoverage('Name    Stmts   Miss  Cover\nTOTAL     120     10    92%\n'), 92);
  assert.equal(parseCoverage('ok  pkg  0.5s  coverage: 73.4% of statements\n'), 73.4);
  assert.equal(parseCoverage('|| Tested/Total Lines:\n|| src/lib.rs: 40/50\n||\n80.00% coverage, 40/50 lines covered\n'), 80);
  assert.equal(parseCoverage('nothing here'), null);
});

test('coverage check runs the command, compares against the minimum', () => {
  const { ctx } = repo({ coverage: { command: 'cov', min: 80 } });
  const fake = (output: string, code = 0) => () => ({ code, output, ms: 1 });
  assert.equal(coverageCheck(ctx(), fake('All files | 91.2 | 100 |'))!.ok, true);
  const low = coverageCheck(ctx(), fake('TOTAL 100 30 70%'))!;
  assert.equal(low.ok, false);
  assert.match(low.detail, /70% is below the minimum of 80%/);
  assert.match(coverageCheck(ctx(), fake('no numbers'))!.detail, /no coverage percentage was found/);
  assert.match(coverageCheck(ctx(), fake('boom', 1))!.detail, /exit 1/);
  assert.equal(coverageCheck(repo().ctx(), fake('x')), null);
});

test('changelog must be updated when the project keeps one', () => {
  const { dir, ctx } = repo({ changelog: true });
  assert.equal(changelogCheck(ctx()), null);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'docs: changelog');
  const c = ctx();
  c.cycle.startCommit = git(dir, 'rev-parse', 'HEAD');
  const fail = changelogCheck(c)!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /CHANGELOG\.md exists but was not updated/);
  fs.appendFileSync(path.join(dir, 'CHANGELOG.md'), '## 0.2.0\n- health endpoint\n');
  assert.equal(changelogCheck(c)!.ok, true);
  assert.equal(changelogCheck(repo({ changelog: false }).ctx()), null);
});

test('protected branches, branch suggestions', () => {
  const p = practiceDefaults();
  assert.equal(protectedBranchProblem(p, 'feature/x', 'y'), null);
  assert.match(protectedBranchProblem(p, 'main', 'eng-12-add-health')!, /git checkout -b eng-12-add-health/);
  assert.equal(protectedBranchProblem({ ...p, protectedBranches: [] }, 'main', 'y'), null);
  assert.equal(branchSuggestion('Add /health endpoint for the load balancer please', 'ENG-12'), 'eng-12-add-health-endpoint-load-balancer');
  assert.equal(branchSuggestion('Fix login', '#7'), '7-fix-login');
  assert.equal(branchSuggestion('', null), 'work');
});

test('gates wire the practices in: code, release, deploy, monitor', () => {
  const { dir, cycle, ctx } = repo({ testEvidence: true, maxDiffLines: 400, secretScan: true, criteriaChecked: true, commitPattern: practiceDefaults().commitPattern, rollback: true, monitorNotes: true });
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [ ] works\n\n## Monitor\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const x = 1;\n');
  let r = runGate('code', ctx());
  assert.equal(r.pass, false);
  assert.deepEqual(r.checks.map((c) => c.name), ['changes', 'test evidence', 'diff size', 'secret scan', 'lint']);
  assert.equal(r.checks.find((c) => c.name === 'test evidence')!.ok, false);
  fs.writeFileSync(path.join(dir, 'app.test.js'), 'test\n');
  assert.equal(runGate('code', ctx()).pass, true);

  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'bad message');
  r = runGate('release', ctx());
  assert.equal(r.pass, false);
  assert.equal(r.checks.find((c) => c.name === 'criteria verified')!.ok, false);
  assert.equal(r.checks.find((c) => c.name === 'commit format')!.ok, false);
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [x] works\n\n## Monitor\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '--amend', '-m', 'feat: works');
  assert.equal(runGate('release', ctx()).pass, true);

  const withDeploy = ctx();
  withDeploy.config.commands.deploy = PASS;
  cycle.approvals.deploy = { at: 'now' };
  r = runGate('deploy', withDeploy);
  assert.equal(r.pass, false);
  assert.deepEqual(r.checks.map((c) => c.name), ['approval', 'rollback ready']);
  withDeploy.config.commands.rollback = 'echo undo';
  assert.equal(runGate('deploy', withDeploy).pass, true);

  cycle.history.push({ phase: 'test', at: 'now', pass: false, advanced: false, checks: [] });
  r = runGate('monitor', ctx());
  assert.equal(r.pass, false);
  assert.match(r.checks.find((c) => c.name === 'monitor notes')!.detail, /write what happened/);
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [x] works\n\n## Monitor\nthe test was flaky\n');
  assert.equal(runGate('monitor', ctx()).pass, true);
});

test('start refuses protected branches, suggests one, approve review, rollback work from the CLI', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS, deploy: PASS, rollback: 'node -e "console.log(\'undone\')"' }, { practices: { ...PRACTICES_OFF, protectedBranches: ['main', 'master'], reviewApproval: true } });
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  assert.ok(['main', 'master'].includes(branch), branch);
  let r = cli(dir, 'start', 'Add health endpoint ENG-4');
  assert.equal(r.code, 2);
  assert.match(r.out, /branch "(main|master)" is protected/);
  assert.match(r.out, /git checkout -b eng-4-add-health-endpoint/);
  git(dir, 'checkout', '-q', '-b', 'eng-4-add-health-endpoint');
  r = cli(dir, 'start', 'Add health endpoint ENG-4');
  assert.equal(r.code, 0);

  r = cli(dir, 'approve', 'review');
  assert.equal(r.code, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  assert.ok(state.cycle.approvals.review.at);

  r = cli(dir, 'rollback');
  assert.equal(r.code, 0);
  assert.match(r.out, /undone/);
  assert.match(r.out, /rollback ok/);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  assert.equal(after.cycle.history.at(-1).checks[0].name, 'rollback');

  const intercepted = toolDecision(dir, 'Bash', { command: 'unslopped rollback' });
  assert.ok(intercepted.block || intercepted.ask, 'rollback is intercepted');
  assert.equal(cli(dir, 'approve', 'bogus').code, 2);
});
