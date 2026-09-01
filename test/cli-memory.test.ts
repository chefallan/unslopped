import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, initRepo, git, writeConfig, BIN, PASS, NO_TRACKER_ENV } from './helpers.ts';

function runner(home) {
  return (cwd, ...args) => {
    const input = typeof args.at(-1) === 'object' ? args.pop().input : undefined;
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, ...NO_TRACKER_ENV, UNSLOPPED_HOME: home } });
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
  };
}

function completeCycle(cli, dir, goal, file) {
  let r = cli(dir, 'start', goal);
  assert.equal(r.code, 0, r.out);
  const id = r.out.match(/started cycle (\S+)/)[1];
  const plan = path.join(dir, '.unslopped', 'plans', `${id}.md`);
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ]', '- [ ] works'));
  assert.equal(cli(dir, 'next').code, 0);
  fs.writeFileSync(path.join(dir, file), 'export const ok = true;\n');
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `feat: ${goal}`);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'approve', 'deploy').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  r = cli(dir, 'next');
  assert.equal(r.code, 0, r.out);
  return { id, out: r.out };
}

test('completed cycles become skills that later cycles reuse', () => {
  const home = tmpDir();
  const cli = runner(home);
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'cfg');

  const first = completeCycle(cli, dir, 'Add health endpoint', 'health.js');
  assert.match(first.out, /skill add-health-endpoint created \(new\)/);
  const skill = path.join(dir, '.unslopped', 'skills', 'add-health-endpoint.md');
  assert.ok(fs.existsSync(skill));
  assert.match(fs.readFileSync(skill, 'utf8'), /- health\.js/);

  let r = cli(dir, 'skills');
  assert.equal(r.code, 0);
  assert.match(r.out, /add-health-endpoint\s+new\s+runs\s+1/);

  r = cli(dir, 'start', 'Add health endpoint for the admin app');
  assert.equal(r.code, 0);
  assert.match(r.out, /skills add-health-endpoint \(new, reused\)/);
  const id = r.out.match(/started cycle (\S+)/)[1];
  const plan = fs.readFileSync(path.join(dir, '.unslopped', 'plans', `${id}.md`), 'utf8');
  assert.match(plan, /## Relevant skills\n- add-health-endpoint \(new, 1 run\(s\)\)/);
  assert.match(plan, /## Preferences\n/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  assert.deepEqual(state.cycle.usedSkills, ['add-health-endpoint']);

  r = cli(dir, 'reset');
  assert.match(r.out, /skill add-health-endpoint marked abandoned/);
  assert.match(fs.readFileSync(skill, 'utf8'), /abandoned: 1/);

  r = cli(dir, 'skill', 'show', 'add-health-endpoint');
  assert.equal(r.code, 0);
  assert.match(r.out, /## Playbook/);
  r = cli(dir, 'skill', 'save', 'Rotate secrets', { input: '## Notes\nuse the vault cli\n' });
  assert.equal(r.code, 0);
  assert.match(fs.readFileSync(path.join(dir, '.unslopped', 'skills', 'rotate-secrets.md'), 'utf8'), /use the vault cli/);
  r = cli(dir, 'skill', 'rm', 'rotate-secrets');
  assert.equal(r.code, 0);
  assert.equal(cli(dir, 'skill', 'show', 'rotate-secrets').code, 2);
});

test('prefer, profile, recall work across the global home', () => {
  const home = tmpDir();
  const cli = runner(home);
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  let r = cli(dir, 'prefer', 'No em dashes anywhere');
  assert.equal(r.code, 0);
  assert.match(r.out, /remembered \(global\)/);
  assert.match(cli(dir, 'prefer', 'No em dashes anywhere').out, /already remembered/);
  cli(dir, 'prefer', '--project', 'Tests live next to the code');
  r = cli(dir, 'profile');
  assert.match(r.out, /No em dashes anywhere  \(global\)/);
  assert.match(r.out, /Tests live next to the code  \(project\)/);
  assert.ok(fs.existsSync(path.join(home, '.unslopped', 'profile.md')));

  const other = tmpDir();
  initRepo(other);
  writeConfig(other, { test: PASS });
  assert.match(cli(other, 'profile').out, /No em dashes anywhere/);
  assert.doesNotMatch(cli(other, 'profile').out, /Tests live next/);

  r = cli(dir, 'recall', 'em dashes');
  assert.equal(r.code, 0);
  assert.match(r.out, /preference/);
  r = cli(dir, 'recall', 'zzz');
  assert.match(r.out, /nothing matched/);
  assert.equal(cli(dir, 'recall').code, 2);
});

test('the prompt hook records history, surfaces skills, preferences', () => {
  const home = tmpDir();
  const cli = runner(home);
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'cfg');
  completeCycle(cli, dir, 'Add health endpoint', 'health.js');
  cli(dir, 'prefer', 'Keep functions under 40 lines');
  const r = cli(dir, 'hook', 'claude', 'prompt', { input: JSON.stringify({ cwd: dir, prompt: 'add a health endpoint to the worker' }) });
  assert.equal(r.code, 0);
  assert.match(r.out, /Saved skills that match: add-health-endpoint/);
  assert.match(r.out, /Remembered preferences: Keep functions under 40 lines/);
  const history = fs.readFileSync(path.join(dir, '.unslopped', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(history.length, 1);
  assert.equal(history[0].prompt, 'add a health endpoint to the worker');
  const recall = cli(dir, 'recall', 'worker');
  assert.match(recall.out, /prompt/);
  const session = cli(dir, 'hook', 'claude', 'session', { input: JSON.stringify({ cwd: dir }) });
  assert.match(session.out, /## Preferences\n- Keep functions under 40 lines/);
  assert.match(session.out, /1 saved skill\(s\)/);
});
