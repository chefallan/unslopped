import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { briefLines } from '../src/brief.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS } from './helpers.ts';

function toDeploy(dir: string, commands: Record<string, string | null> = {}): string {
  initRepo(dir);
  writeConfig(dir, { test: PASS, ...commands });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  let r = cli(dir, 'start', 'brief the human');
  assert.equal(r.code, 0, r.out);
  const id = r.out.match(/started cycle (\S+)/)![1];
  const plan = path.join(dir, '.unslopped', 'plans', `${id}.md`);
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ]', '- [x] the brief shows'));
  assert.equal(cli(dir, 'next').code, 0);
  fs.writeFileSync(path.join(dir, 'work.js'), '1\n');
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  assert.equal(cli(dir, 'next').code, 0);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: work');
  r = cli(dir, 'next');
  assert.equal(r.code, 0, r.out);
  return id;
}

test('the failing deploy gate prints the brief', () => {
  const dir = tmpDir();
  toDeploy(dir);
  const r = cli(dir, 'check');
  assert.equal(r.code, 1);
  assert.match(r.out, /what approving means:/);
  assert.match(r.out, /criteria\s+1\/1 verified/);
  assert.match(r.out, /feat: work/);
  assert.match(r.out, /no deploy command; the cycle completes and archives/);
  assert.match(r.out, /decline\s+tell the assistant what to change/);
});

test('resume at deploy shows the brief', () => {
  const dir = tmpDir();
  toDeploy(dir);
  const r = cli(dir, 'resume');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /what approving means:/);
  assert.match(r.out, /gates\s+\d+ run\(s\)/);
});

test('approving deploy echoes the evidence it recorded', () => {
  const dir = tmpDir();
  toDeploy(dir);
  const r = cli(dir, 'approve', 'deploy');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /you signed off on:/);
  assert.match(r.out, /feat: work/);
  assert.match(r.out, /approved deploy for cycle/);
});

test('the brief names a configured deploy command', () => {
  const dir = tmpDir();
  toDeploy(dir, { deploy: PASS });
  const r = cli(dir, 'check');
  assert.match(r.out, /deploy\s+node -e/);
});

test('the brief includes review counts when one is recorded', () => {
  const dir = tmpDir();
  toDeploy(dir);
  fs.writeFileSync(path.join(dir, 'r.md'), '- [minor] naming nit\n');
  assert.equal(cli(dir, 'review', '--file=r.md').code, 0);
  const r = cli(dir, 'check');
  assert.match(r.out, /review\s+0 critical, 0 major, 1 minor/);
});

test('briefLines reads records straight from the cycle', () => {
  const dir = tmpDir();
  toDeploy(dir);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'unslopped.config.json'), 'utf8'));
  config.practices ??= {};
  const lines = briefLines(dir, { ...config, commands: config.commands }, state.cycle);
  assert.match(lines.join('\n'), /cycle\s+\S+\s+"brief the human"/);
  assert.match(lines.join('\n'), /approving unlocks:/);
});
