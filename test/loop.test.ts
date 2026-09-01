import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nextCycleCandidates, formatCandidates, selectDebt, seedPlanWithDebt, sweepGoal } from '../src/loop.ts';
import { addDebt, listDebt, removeDebtEntries } from '../src/debt.ts';
import { newCycle, planPath, plansDir, planTemplate } from '../src/state.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS } from './helpers.ts';

function completeCycle(dir: string, goal: string, extraArgs: string[] = []) {
  let r = cli(dir, 'start', ...extraArgs, goal);
  assert.equal(r.code, 0, r.out);
  const id = r.out.match(/started cycle (\S+)/)![1];
  const plan = path.join(dir, '.unslopped', 'plans', `${id}.md`);
  let text = fs.readFileSync(plan, 'utf8');
  if (!/- \[ \] \S/.test(text)) text = text.replace('- [ ]', '- [ ] the sweep is done');
  fs.writeFileSync(plan, text.replace(/- \[ \] /g, '- [x] '));
  assert.equal(cli(dir, 'next').code, 0);
  fs.writeFileSync(path.join(dir, `work-${id}.js`), '1\n');
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `feat: ${goal.slice(0, 30)}`);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'approve', 'deploy').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  r = cli(dir, 'next');
  assert.equal(r.code, 0, r.out);
  return { id, out: r.out, plan };
}

test('candidates come from debt, review leftovers, monitor notes, deduplicated, capped', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  addDebt(dir, 'soon', 'shared fixture ids race between suites', 'test/', null);
  addDebt(dir, 'soon', 'pagination offset is unbounded', null, null);
  addDebt(dir, 'pattern', 'reason consts hoisted away from their routes', null, null);
  addDebt(dir, 'accepted', 'mirrored DTOs stay', null, null);
  const cycle = newCycle('g', 'h', null);
  fs.mkdirSync(plansDir(dir), { recursive: true });
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Monitor\n- flaky retries still need a cap\n- everything else fine\n');
  fs.mkdirSync(path.join(dir, '.unslopped', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'reviews', 'r.md'), '- [major] no timeout on fetch\n- [minor] rename runner\n- [critical] was fixed already\n');
  cycle.review = { at: 'now', file: '.unslopped/reviews/r.md', source: 'file', critical: 0, major: 1, minor: 1 };

  const candidates = nextCycleCandidates(dir, cycle, 10);
  assert.deepEqual(candidates.map((c) => c.source), ['debt, soon', 'debt, soon', 'debt, pattern', 'review, major', 'review, minor', 'monitor note']);
  assert.match(candidates[0].goal, /^Clear debt: shared fixture ids race between suites \(test\/\)$/);
  assert.match(candidates[2].goal, /^Fix before it spreads: reason consts/);
  assert.match(candidates[3].goal, /^Address review finding: no timeout on fetch/);
  assert.equal(candidates[5].goal, 'flaky retries still need a cap');
  assert.equal(nextCycleCandidates(dir, cycle).length, 4);
  const lines = formatCandidates(candidates.slice(0, 2));
  assert.match(lines[0], /offer them rather than starting one unasked/);
  assert.match(lines[1], /^  unslopped start "Clear debt: shared fixture ids race/);
  const empty = newCycle('g2', 'h', null);
  assert.equal(nextCycleCandidates(tmpDir(), empty).length, 0);
});

test('selectDebt filters by category, seedPlanWithDebt fills items, criteria, files', () => {
  const dir = tmpDir();
  initRepo(dir);
  addDebt(dir, 'cleanup', 'six copies of escapePattern', 'src/*/repo.ts', null);
  addDebt(dir, 'cleanup', 'converge DTO decorator style', 'src/api/currency.dto.ts', null);
  addDebt(dir, 'soon', 'unbounded page number', null, null);
  addDebt(dir, 'accepted', 'stays as is', null, null);
  assert.equal(selectDebt(dir, 'cleanup').length, 2);
  assert.equal(selectDebt(dir, 'soon').length, 1);
  assert.equal(selectDebt(dir, 'all').length, 3);
  assert.equal(sweepGoal('cleanup', 2), 'Debt sweep, cleanup: 2 item(s)');

  const cycle = newCycle(sweepGoal('cleanup', 2), 'h', null);
  const seeded = seedPlanWithDebt(planTemplate(cycle), selectDebt(dir, 'cleanup'));
  assert.match(seeded, /## Debt items\n- six copies of escapePattern \(src\/\*\/repo\.ts\) :: logged/);
  assert.match(seeded, /## Acceptance criteria\n- \[ \] six copies of escapePattern \(src\/\*\/repo\.ts\)\n- \[ \] converge DTO decorator style/);
  assert.match(seeded, /## Files to touch\n- src\/\*\/repo\.ts\n- src\/api\/currency\.dto\.ts\n/);
});

test('a sweep cycle seeds the plan, clears its entries on completion, suggests what is left', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  assert.equal(cli(dir, 'start', '--from-debt').code, 2);
  cli(dir, 'debt', 'six copies of escapePattern', '--where=src', '--category=cleanup');
  cli(dir, 'debt', 'converge decorator style', '--category=cleanup');
  cli(dir, 'debt', 'unbounded page number reaches the db', '--category=soon');
  assert.equal(cli(dir, 'start', '--from-debt=bogus').code, 2);

  let r = cli(dir, 'start', '--from-debt');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /started cycle/);
  assert.match(r.out, /plan seeded with 2 debt item\(s\)/);
  const id = r.out.match(/started cycle (\S+)/)![1];
  const plan = fs.readFileSync(path.join(dir, '.unslopped', 'plans', `${id}.md`), 'utf8');
  assert.match(plan, /# Debt sweep, cleanup: 2 item\(s\)/);
  assert.match(plan, /## Debt items\n- six copies of escapePattern \(src\)/);
  assert.match(plan, /- \[ \] converge decorator style/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  assert.equal(state.cycle.debt.length, 2);
  cli(dir, 'reset');
  assert.equal(listDebt(dir).length, 3);

  const done = completeCycle(dir, '', ['--from-debt']);
  assert.match(done.out, /cleared 2 swept entrie\(s\) from \.unslopped\/DEBT\.md/);
  assert.match(done.out, /next cycle candidates/);
  assert.match(done.out, /unslopped start "Clear debt: unbounded page number reaches the db"/);
  const remaining = listDebt(dir);
  assert.deepEqual(remaining.map((e) => e.category), ['soon']);
  assert.equal(removeDebtEntries(dir, ['not there']), 0);

  const swept = completeCycle(dir, '', ['--from-debt=soon']);
  assert.match(swept.out, /cleared 1 swept entrie\(s\)/);
  assert.doesNotMatch(swept.out, /next cycle candidates/);
  assert.equal(listDebt(dir).length, 0);
});
