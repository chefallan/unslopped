import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseSkill, renderSkill, getSection, setSection, slugify, health, learnFromCycle, matchSkills, listSkills, saveSkill, addPreference, readProfile, globalProfilePath, profilePath, recall, appendHistory, refreshDetected } from '../src/memory.ts';
import { newCycle, planPath, plansDir, archiveCycle } from '../src/state.ts';
import { tmpDir, initRepo, git } from './helpers.ts';

function repoWithCycle(goal, { fail = 0 } = {}) {
  const dir = tmpDir();
  initRepo(dir);
  const cycle = newCycle(goal, 'h', git(dir, 'rev-parse', 'HEAD'));
  fs.mkdirSync(plansDir(dir), { recursive: true });
  fs.writeFileSync(planPath(dir, cycle.id), `# ${goal}\n\n## Acceptance criteria\n- [x] GET /health returns 200\n\n## Monitor\nLatency fine\n`);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'health.js'), '1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: health');
  for (let i = 0; i < fail; i++) cycle.history.push({ phase: 'test', at: 'now', pass: false, checks: [{ name: 'test', ok: false, detail: 'npm test (exit 1, 5ms)\nAssertionError: expected 200' }] });
  cycle.history.push({ phase: 'test', at: 'now', pass: true, advanced: true, checks: [{ name: 'test', ok: true, detail: 'npm test (exit 0, 5ms)' }] });
  return { dir, cycle };
}

test('skill frontmatter round trips, sections are edited in place', () => {
  const text = renderSkill({ name: 'x', runs: 2, tags: ['a', 'b'] }, '# X\n\n## Playbook\nold\n\n## Notes\nkeep me\n');
  const { meta, body } = parseSkill(text);
  assert.equal(meta.runs, 2);
  assert.deepEqual(meta.tags, ['a', 'b']);
  assert.equal(getSection(body, 'Notes'), 'keep me');
  const next = setSection(body, 'Playbook', 'new\nlines');
  assert.equal(getSection(next, 'Playbook'), 'new\nlines');
  assert.equal(getSection(next, 'Notes'), 'keep me');
  assert.equal(getSection(setSection(body, 'Fresh', 'x'), 'Fresh'), 'x');
  assert.deepEqual(parseSkill('no frontmatter').meta, {});
});

test('slugify, health thresholds', () => {
  assert.equal(slugify('Add /health endpoint!'), 'add-health-endpoint');
  assert.equal(slugify('!!!'), 'skill');
  assert.equal(health({ runs: 1 }), 'new');
  assert.equal(health({ runs: 3, completed: 3, gateFailures: 2 }), 'healthy');
  assert.equal(health({ runs: 2, completed: 2, gateFailures: 4 }), 'underperforming');
  assert.equal(health({ runs: 4, completed: 1, gateFailures: 0 }), 'underperforming');
});

test('a completed cycle creates a skill with files, criteria, failures, notes', () => {
  const home = tmpDir();
  const { dir, cycle } = repoWithCycle('Add health endpoint', { fail: 1 });
  const r = learnFromCycle(dir, home, cycle, 'complete');
  assert.equal(r.action, 'created');
  assert.equal(r.name, 'add-health-endpoint');
  const text = fs.readFileSync(r.file, 'utf8');
  assert.match(text, /runs: 1/);
  assert.match(text, /gateFailures: 1/);
  assert.match(text, /- src\/health\.js/);
  assert.match(text, /- GET \/health returns 200/);
  assert.match(text, /test gate, test failed 1 time\(s\): AssertionError: expected 200/);
  assert.match(text, /## Notes\nLatency fine/);
  assert.doesNotMatch(text, /\.ade\//);
  const again = learnFromCycle(dir, home, { ...cycle, id: 'other', usedSkills: [] }, 'complete');
  assert.equal(again.name, 'add-health-endpoint-2');
});

test('a reused skill is updated in place, its notes survive', () => {
  const home = tmpDir();
  const { dir, cycle } = repoWithCycle('Add health endpoint');
  const first = learnFromCycle(dir, home, cycle, 'complete');
  let text = fs.readFileSync(first.file, 'utf8');
  fs.writeFileSync(first.file, text.replace(/## Notes\n[\s\S]*$/, '## Notes\nhuman wisdom\n'));
  const second = { ...cycle, id: 'c2', goal: 'Add health endpoint again', usedSkills: [first.name], history: [...cycle.history, ...cycle.history] };
  const r = learnFromCycle(dir, home, second, 'complete');
  assert.equal(r.action, 'updated');
  text = fs.readFileSync(r.file, 'utf8');
  assert.match(text, /runs: 2/);
  assert.match(text, /completed: 2/);
  assert.match(text, /- "Add health endpoint again"/);
  assert.match(text, /human wisdom/);
  assert.match(text, /Gate runs: 2/);
  const abandoned = learnFromCycle(dir, home, { ...second, id: 'c3' }, 'abandoned');
  assert.equal(abandoned.action, 'updated');
  assert.match(fs.readFileSync(r.file, 'utf8'), /abandoned: 1/);
  assert.equal(learnFromCycle(dir, home, { ...second, usedSkills: [] }, 'abandoned').action, 'none');
});

test('matchSkills finds related skills, flags strong matches', () => {
  const home = tmpDir();
  const { dir, cycle } = repoWithCycle('Add health endpoint');
  learnFromCycle(dir, home, cycle, 'complete');
  saveSkill(path.join(home, '.ade', 'skills'), 'Rotate database credentials', '## Notes\nuse vault\n');
  const strong = matchSkills(dir, home, 'add a health endpoint for the load balancer');
  assert.equal(strong[0].name, 'add-health-endpoint');
  assert.equal(strong[0].strong, true);
  const weak = matchSkills(dir, home, 'rotate the endpoint');
  assert.ok(weak.length >= 1);
  assert.equal(weak.every((m) => !m.strong || m.name === 'rotate-database-credentials'), true);
  assert.equal(matchSkills(dir, home, 'unrelated words entirely').length, 0);
  assert.equal(listSkills(dir, home).length, 2);
  assert.equal(listSkills(dir, home).find((s) => s.scope === 'global').name, 'rotate-database-credentials');
});

test('preferences are stored once, read from both scopes', () => {
  const home = tmpDir();
  const dir = tmpDir();
  assert.equal(addPreference(globalProfilePath(home), 'No em dashes'), true);
  assert.equal(addPreference(globalProfilePath(home), 'No em dashes'), false);
  assert.equal(addPreference(globalProfilePath(home), 'Minimal comments'), true);
  addPreference(profilePath(dir), 'Use pnpm');
  const lines = readProfile(dir, home);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /No em dashes  \(global\)/);
  assert.match(lines[2], /Use pnpm  \(project\)/);
});

test('detected conventions are refreshed without touching stated preferences', () => {
  const dir = tmpDir();
  initRepo(dir);
  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), `${i}\n`);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', `feat: change ${i}`);
  }
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  addPreference(profilePath(dir), 'Tabs not spaces');
  const detected = refreshDetected(dir);
  assert.ok(detected.includes('Commit messages follow Conventional Commits'));
  assert.ok(detected.includes('Package manager is npm'));
  const lines = readProfile(dir, tmpDir());
  assert.match(lines.find((l) => /Tabs/.test(l)), /\(project\)/);
  assert.match(lines.find((l) => /Conventional/.test(l)), /\(project, detected\)/);
});

test('recall searches skills, cycles, plans, prompts, preferences', () => {
  const home = tmpDir();
  const { dir, cycle } = repoWithCycle('Add health endpoint', { fail: 1 });
  learnFromCycle(dir, home, cycle, 'complete');
  archiveCycle(dir, cycle, 'complete');
  appendHistory(dir, { at: '2026-01-01T00:00:00Z', prompt: 'why does the login page time out', cycle: null });
  addPreference(globalProfilePath(home), 'Always write a login test');
  const kinds = (q) => recall(dir, home, q, 10).map((r) => r.kind);
  assert.ok(kinds('health endpoint').includes('skill'));
  assert.ok(kinds('health endpoint').includes('cycle'));
  assert.ok(kinds('health endpoint').includes('plan'));
  assert.ok(kinds('login').includes('prompt'));
  assert.ok(kinds('login').includes('preference'));
  const failure = recall(dir, home, 'AssertionError expected 200', 3);
  assert.equal(failure[0].kind, 'cycle');
  assert.match(failure[0].snippet, /AssertionError/);
  assert.equal(recall(dir, home, 'zzz qqq', 3).length, 0);
});
