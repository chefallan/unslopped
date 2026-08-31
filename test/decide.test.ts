import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDecision, listDecisions } from '../src/decisions.ts';
import { openQuestionsCheck } from '../src/practices.ts';
import { runGate } from '../src/gates.ts';
import { newCycle, planPath, plansDir, planTemplate } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { extractRationale } from '../src/graph.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

test('decision records are numbered, listed, indexed by the rationale miner', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  let r = cli(dir, 'decide');
  assert.match(r.out, /no decisions recorded/);
  r = cli(dir, 'decide', 'Offset pagination for list endpoints');
  assert.equal(r.code, 0);
  assert.match(r.out, /wrote docs\/decisions\/0001-offset-pagination-for-list-endpoints\.md/);
  assert.match(r.out, /ade graph why will find it/);
  const text = fs.readFileSync(path.join(dir, 'docs', 'decisions', '0001-offset-pagination-for-list-endpoints.md'), 'utf8');
  assert.match(text, /^# Decision 0001: Offset pagination for list endpoints/);
  assert.match(text, /Status: proposed/);
  assert.match(text, /## Options considered/);

  const second = createDecision(dir, 'One database per tenant', 'cycle-9');
  assert.equal(second.number, 2);
  assert.match(fs.readFileSync(path.join(dir, second.file), 'utf8'), /Cycle: cycle-9/);
  const list = listDecisions(dir);
  assert.deepEqual(list.map((d) => [d.number, d.status, d.title]), [[1, 'proposed', 'Offset pagination for list endpoints'], [2, 'proposed', 'One database per tenant']]);
  r = cli(dir, 'decide');
  assert.match(r.out, /0001  proposed   Offset pagination for list endpoints/);

  const mined = extractRationale('md', fs.readFileSync(path.join(dir, second.file), 'utf8'));
  assert.ok(mined.length >= 1);
  assert.match(mined.map((m) => m.text).join('\n'), /Decision/);
});

test('open questions in the plan block release until resolved', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, criteriaQuality: true } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('g', 'h', git(dir, 'rev-parse', 'HEAD'));
  const ctx = () => ({ root: dir, config: loadConfig(dir)!, cycle });
  assert.match(planTemplate(cycle), /## Open questions\n/);

  assert.equal(openQuestionsCheck(ctx(), '# g\n\n## Acceptance criteria\n- [x] a\n')!.ok, true);
  assert.equal(openQuestionsCheck(ctx(), '## Open questions\n\n## Monitor\n')!.ok, true);
  const blocked = openQuestionsCheck(ctx(), '## Open questions\n- should deletes cascade or refuse?\n- [ ] who owns the retention window?\n')!;
  assert.equal(blocked.ok, false);
  assert.match(blocked.detail, /2 open question\(s\)/);
  assert.match(blocked.detail, /- should deletes cascade or refuse\?/);
  assert.equal(openQuestionsCheck(ctx(), '## Open questions\n- resolved: deletes refuse, per the human 2026-08-30\n')!.ok, true);
  assert.equal(openQuestionsCheck(repo0(), '## Open questions\n- x?\n'), null);

  fs.mkdirSync(plansDir(dir), { recursive: true });
  fs.writeFileSync(planPath(dir, cycle.id), '# g\n\n## Acceptance criteria\n- [x] a\n\n## Open questions\n- cascade or refuse?\n');
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: a');
  const gate = runGate('release', ctx());
  assert.equal(gate.pass, false);
  assert.equal(gate.checks.find((c) => c.name === 'no open questions')!.ok, false);

  function repo0() {
    const d = tmpDir();
    initRepo(d);
    writeConfig(d, { test: PASS });
    return { root: d, config: loadConfig(d)!, cycle };
  }
});
