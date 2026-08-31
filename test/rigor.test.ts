import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { globToRegExp, matchesAny, isVagueCriterion, criteriaVagueCheck, negativeCriterionCheck, scopeCheck, exclusiveCheck, testDeletionCheck, declarationsCheck, handoffCheck, reviewApprovalCheck, commitFormatCheck, scanStyle, styleDefaults } from '../src/practices.ts';
import { runGate } from '../src/gates.ts';
import { newCycle, planPath, plansDir } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { addDebt, listDebt, debtCounts } from '../src/debt.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

function repo(practices: Record<string, unknown> = {}) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, ...practices } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('Add login rate limit', 'h', git(dir, 'rev-parse', 'HEAD'));
  fs.mkdirSync(plansDir(dir), { recursive: true });
  const ctx = () => ({ root: dir, config: loadConfig(dir)!, cycle });
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  return { dir, cycle, ctx, write };
}

test('globs match path segments the way ignores expect', () => {
  assert.equal(matchesAny('src/auth/login.ts', ['**/auth/**']), true);
  assert.equal(matchesAny('auth/login.ts', ['**/auth/**']), true);
  assert.equal(matchesAny('src/author/list.ts', ['**/auth/**']), false);
  assert.equal(matchesAny('db/migrations/0001_init.sql', ['**/migrations/**']), true);
  assert.equal(matchesAny('src/a.ts', ['src/*.ts']), true);
  assert.equal(matchesAny('src/deep/a.ts', ['src/*.ts']), false);
  assert.equal(globToRegExp('a?c').test('abc'), true);
  assert.equal(globToRegExp('a?c').test('a/c'), false);
});

test('vague criteria are refused, observable ones pass', () => {
  assert.equal(isVagueCriterion('slug validation works'), true);
  assert.equal(isVagueCriterion('access checks are handled appropriately'), true);
  assert.equal(isVagueCriterion('a viewer requesting /admin receives 403'), false);
  assert.equal(isVagueCriterion('the login form works only after 3 failed attempts are rejected'), false);
  const { ctx } = repo({ criteriaQuality: true });
  const bad = criteriaVagueCheck(ctx(), '## Acceptance criteria\n- [ ] validation works\n- [ ] a duplicate slug insert fails at the DB\n')!;
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /- validation works/);
  assert.doesNotMatch(bad.detail, /duplicate slug/);
  assert.equal(criteriaVagueCheck(ctx(), '## Acceptance criteria\n- [ ] returns 200\n')!.ok, true);
  assert.equal(criteriaVagueCheck(repo().ctx(), '- [ ] works'), null);
});

test('touching guarded paths demands a rejection criterion, a human review, no matter the diff size', () => {
  const { ctx, write } = repo({ criteriaQuality: true, guardedPaths: ['**/auth/**'] });
  write('src/auth/limit.ts', 'export const LIMIT = 3;\n');
  const plan = '## Acceptance criteria\n- [x] limit is 3\n';
  const missing = negativeCriterionCheck(ctx(), plan)!;
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /guarded paths \(src\/auth\/limit\.ts\)/);
  assert.equal(negativeCriterionCheck(ctx(), '## Acceptance criteria\n- [x] a fourth attempt within a minute is rejected with 429\n')!.ok, true);

  const review = reviewApprovalCheck(ctx())!;
  assert.equal(review.ok, false);
  assert.match(review.detail, /guarded paths were touched .* human reader is required no matter how small/);
  ctx().cycle.approvals.review = { at: 'now' };
  assert.equal(reviewApprovalCheck(ctx())!.ok, true);

  const calm = repo({ criteriaQuality: true, guardedPaths: ['**/auth/**'] });
  calm.write('src/ui/button.ts', '1\n');
  assert.equal(negativeCriterionCheck(calm.ctx(), plan), null);
  assert.equal(reviewApprovalCheck(calm.ctx()), null);
});

test('every changed file must be declared in the plan', () => {
  const { cycle, ctx, write, dir } = repo({ scope: true });
  fs.writeFileSync(planPath(dir, cycle.id), '## Files to touch\n- src/limit.ts\n- `test/limit.test.ts`\n');
  write('src/limit.ts', '1\n');
  write('test/limit.test.ts', '1\n');
  assert.equal(scopeCheck(ctx(), fs.readFileSync(planPath(dir, cycle.id), 'utf8'))!.ok, true);
  write('src/sneaky.ts', '1\n');
  const fail = scopeCheck(ctx(), fs.readFileSync(planPath(dir, cycle.id), 'utf8'))!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /- src\/sneaky\.ts/);
  assert.match(fail.detail, /widening scope silently/);
  fs.writeFileSync(planPath(dir, cycle.id), '## Files to touch\n- src/\n- test/limit.test.ts\n');
  assert.equal(scopeCheck(ctx(), fs.readFileSync(planPath(dir, cycle.id), 'utf8'))!.ok, true);
  assert.equal(scopeCheck(ctx(), '## Files to touch\n'), null);
  assert.equal(scopeCheck(repo().ctx(), '## Files to touch\n- x\n'), null);
});

test('a shared boundary change ships alone', () => {
  const { ctx, write } = repo({ exclusivePaths: ['packages/contracts/**'] });
  assert.equal(exclusiveCheck(ctx()), null);
  write('packages/contracts/api.ts', 'export type A = 1;\n');
  write('packages/contracts/api.test.ts', '1\n');
  assert.equal(exclusiveCheck(ctx())!.ok, true);
  write('src/feature.ts', '1\n');
  const fail = exclusiveCheck(ctx())!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /packages\/contracts\/api\.ts is an exclusive path .* also changed: src\/feature\.ts/);
});

test('deleting or gutting a test needs a written justification', () => {
  const { dir, cycle, ctx, write } = repo({ testDeletion: true });
  write('big.test.ts', Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n');
  write('gone.test.ts', 'test\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'test: baseline');
  cycle.startCommit = git(dir, 'rev-parse', 'HEAD');
  assert.equal(testDeletionCheck(ctx(), '')!.ok, true);
  fs.unlinkSync(path.join(dir, 'gone.test.ts'));
  write('big.test.ts', 'line 0\n');
  const fail = testDeletionCheck(ctx(), '')!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /- gone\.test\.ts deleted/);
  assert.match(fail.detail, /- big\.test\.ts lost 29 line\(s\)/);
  assert.equal(testDeletionCheck(ctx(), '## Removed tests\nboth suites moved into consolidated.test.ts\n')!.ok, true);
  assert.equal(testDeletionCheck(ctx(), '## Removed tests\nN/A\n')!.ok, false);
});

test('declarations are demanded when the matching paths change', () => {
  const { ctx, write } = repo({ declarations: [{ name: 'Indexes', when: '**/migrations/**' }, { name: 'Recorded events', when: 'src/events/**' }] });
  assert.equal(declarationsCheck(ctx(), ''), null);
  write('db/migrations/0001_users.sql', 'create table users();\n');
  const fail = declarationsCheck(ctx(), '## Goal\nx\n')!;
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /add a line "Indexes: \.\.\."/);
  assert.doesNotMatch(fail.detail, /Recorded events/);
  assert.equal(declarationsCheck(ctx(), 'Indexes: unique on users(email)\n')!.ok, true);
});

test('the handoff note is demanded at monitor, posted on completion', () => {
  const { dir, cycle, ctx } = repo({ handoffNote: true });
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [x] ok\n\n## Handoff\n\n## Monitor\nfine\n');
  const gate = runGate('monitor', ctx());
  assert.equal(gate.pass, false);
  assert.match(gate.checks.find((c) => c.name === 'handoff note')!.detail, /what to verify, how to reach it/);
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [x] ok\n\n## Handoff\n- verify: POST /login locks after 3 failures\n- data: seeded user demo, wrong password\n- expect: 429 on the fourth try\n\n## Monitor\nfine\n');
  assert.equal(runGate('monitor', ctx()).pass, true);
  assert.equal(handoffCheck(repo().ctx(), ''), null);
});

test('commit subjects must stay short, carry a known scope when scopes are set', () => {
  const { dir, ctx, write } = repo({ commitPattern: '^(feat|fix|chore|docs|refactor|test)(\\([^)]+\\))?!?: .+', commitScopes: ['api', 'core'] });
  write('a.ts', '1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: no scope here');
  let r = commitFormatCheck(ctx())!;
  assert.equal(r.ok, false);
  assert.match(r.detail, /a scope is required/);
  git(dir, 'commit', '-q', '--amend', '-m', 'feat(web): wrong area');
  r = commitFormatCheck(ctx())!;
  assert.match(r.detail, /scope "web" is not one of: api, core/);
  git(dir, 'commit', '-q', '--amend', '-m', `feat(api): ${'x'.repeat(80)}`);
  r = commitFormatCheck(ctx())!;
  assert.match(r.detail, /keep it under 72/);
  git(dir, 'commit', '-q', '--amend', '-m', 'feat(api): add the rate limit');
  r = commitFormatCheck(ctx())!;
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /scoped, subjects under 72 chars/);
});

test('the debt log takes one-liners, lists by category, shows in status', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  let r = cli(dir, 'debt');
  assert.match(r.out, /no debt logged/);
  r = cli(dir, 'debt', 'six copies of escapePattern, move one helper to shared', '--where=src/*/repo.ts', '--category=cleanup');
  assert.equal(r.code, 0);
  assert.match(r.out, /logged: - \[cleanup\] six copies/);
  cli(dir, 'debt', 'fixture ids shared across suites, they delete each other', '--category=soon');
  cli(dir, 'debt', 'two deployables cannot share a runtime class, mirrored DTOs stay', '--category=accepted');
  assert.equal(cli(dir, 'debt', 'x', '--category=bogus').code, 2);
  const entries = listDebt(dir);
  assert.deepEqual(entries.map((e) => e.category), ['cleanup', 'soon', 'accepted']);
  assert.match(entries[0].text, /\(src\/\*\/repo\.ts\) :: logged \d{4}-\d{2}-\d{2}/);
  assert.equal(debtCounts(dir), '1 cleanup, 1 soon, 1 accepted');
  r = cli(dir, 'debt');
  assert.match(r.out, /cleanup \(1\)\n  - six copies/);
  r = cli(dir, 'status');
  assert.match(r.out, /debt  1 cleanup, 1 soon, 1 accepted \(ade debt\)/);
});

test('style flags issue references in comments, bundled test names', () => {
  const rules = styleDefaults();
  const hits = scanStyle(
    [
      { file: 'src/a.ts', line: 1, text: '// Per APP-197 a closed profile exposes only these' },
      { file: 'src/a.ts', line: 2, text: '// TODO replace with the typed constant once shared, APP-190' },
      { file: 'src/a.ts', line: 3, text: 'const key = "APP-197";' },
      { file: 'src/a.ts', line: 4, text: '// stored as UTF-8 because the client demands it' },
      { file: 'test/a.test.ts', line: 5, text: "it('creates the identity and persists credentials and mails the invite', () => {" },
      { file: 'test/a.test.ts', line: 6, text: "it('rejects a duplicate slug', () => {" },
    ],
    rules
  );
  assert.deepEqual(hits.map((h) => [h.line, h.problem.split(' ').slice(0, 3).join(' ')]), [
    [1, 'issue reference APP-197'],
    [5, 'test name bundles'],
  ]);
  assert.equal(scanStyle([{ file: 'src/a.ts', line: 1, text: '// APP-1 x' }], { ...rules, noIssueRefs: false }).length, 0);
});
