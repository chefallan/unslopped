import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ladderCheck, practiceDefaults, mergePractices, RUNGS } from '../src/practices.ts';
import { protocolBody } from '../src/protocol.ts';
import { runGate } from '../src/gates.ts';
import { newCycle, planPath, plansDir } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, PRACTICES_OFF } from './helpers.ts';

function repo(ladder: unknown = true) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, ladder } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('Add a ladder', 'h', git(dir, 'rev-parse', 'HEAD'));
  fs.mkdirSync(plansDir(dir), { recursive: true });
  return { dir, cycle, ctx: () => ({ root: dir, config: loadConfig(dir)!, cycle }) };
}

function plan(approach: string): string {
  return `# goal\n\n## Goal\nship it\n\n## Approach\n${approach}\n\n## Files to touch\n- src/a.ts\n\n## Acceptance criteria\n- [ ] it works\n`;
}

test('the ladder has seven rungs, in order', () => {
  assert.equal(RUNGS.length, 7);
  assert.match(RUNGS[0], /need to exist/i);
  assert.match(RUNGS[1], /codebase/i);
  assert.match(RUNGS[6], /minimum/i);
});

test('ladderCheck fails an approach with no rung marker', () => {
  const r = repo();
  const c = ladderCheck(r.ctx(), plan('I will rewrite the parser from scratch.'))!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /need to exist/i);
  assert.match(c.detail, /minimum/i);
});

test('ladderCheck passes an approach that names a rung', () => {
  const r = repo();
  const c = ladderCheck(r.ctx(), plan('Rung 2. The helper already exists in src/git.ts, so reuse it.'))!;
  assert.equal(c.ok, true);
  assert.match(c.detail, /rung 2/i);
});

test('ladderCheck reads the marker in any letter case', () => {
  const r = repo();
  assert.equal(ladderCheck(r.ctx(), plan('rung 5, the installed dependency covers it'))!.ok, true);
  assert.equal(ladderCheck(r.ctx(), plan('RUNG 7: the minimum that works'))!.ok, true);
});

test('ladderCheck rejects a rung number outside one to seven', () => {
  const r = repo();
  assert.equal(ladderCheck(r.ctx(), plan('Rung 0. nothing to do here'))!.ok, false);
  assert.equal(ladderCheck(r.ctx(), plan('Rung 8. off the top of the ladder'))!.ok, false);
  assert.equal(ladderCheck(r.ctx(), plan('Rung 12'))!.ok, false);
});

test('ladderCheck ignores a rung marker outside the approach section', () => {
  const r = repo();
  const p = `## Goal\nRung 2 somewhere it does not count\n\n## Approach\nrewrite everything\n`;
  assert.equal(ladderCheck(r.ctx(), p)!.ok, false);
});

test('ladderCheck is absent when the practice is off', () => {
  const r = repo(false);
  assert.equal(ladderCheck(r.ctx(), plan('no rung here')), null);
});

test('the ladder practice defaults on', () => {
  assert.equal(practiceDefaults().ladder, true);
  assert.equal(mergePractices({}).ladder, true);
});

test('the plan gate refuses a plan that climbs no rung', () => {
  const r = repo();
  fs.writeFileSync(planPath(r.dir, r.cycle.id), plan('rewrite the parser'));
  const result = runGate('plan', r.ctx());
  assert.equal(result.pass, false);
  assert.equal(result.checks.find((c) => c.name === 'leanness ladder')!.ok, false);
});

test('the plan gate accepts the same plan once it names a rung', () => {
  const r = repo();
  fs.writeFileSync(planPath(r.dir, r.cycle.id), plan('Rung 3. The stdlib parser covers this.'));
  const result = runGate('plan', r.ctx());
  assert.equal(result.pass, true);
});

test('the generated protocol carries the ladder, its rungs, what it never cuts', () => {
  const body = protocolBody();
  assert.match(body, /## Leanness ladder/);
  for (const rung of RUNGS) assert.equal(body.includes(rung), true);
  assert.match(body, /trust-boundary validation/i);
  assert.match(body, /data loss/i);
  assert.match(body, /accessibility/i);
  assert.match(body, /read the code the change touches/i);
});
