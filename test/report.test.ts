import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { protocolBody } from '../src/protocol.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

test('the generated protocol carries a report section', () => {
  const body = protocolBody();
  assert.match(body, /## How to report/);
  assert.match(body, /next action/i);
  assert.match(body, /one concrete next step/i);
  assert.match(body, /no preamble/i);
});

test('the report section caps a long list at five per group', () => {
  assert.match(protocolBody(), /five/i);
});

test('the report section credits its source', () => {
  assert.match(protocolBody(), /i-have-adhd/);
});

test('the old one-line reporting rule is gone', () => {
  assert.equal(/End every task with .* and a short report/.test(protocolBody()), false);
});

function repo() {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  return dir;
}

function log(dir: string, n: number, category: string) {
  for (let i = 1; i <= n; i++) cli(dir, 'debt', `${category} item number ${i}`, `--category=${category}`);
}

test('debt caps a category at five rows, counts the rest', () => {
  const dir = repo();
  log(dir, 8, 'cleanup');
  const r = cli(dir, 'debt');
  assert.equal(r.code, 0);
  assert.equal(r.out.split('\n').filter((l) => l.trim().startsWith('- ')).length, 5);
  assert.match(r.out, /3 more/);
});

test('debt prints every row when a category holds five or fewer', () => {
  const dir = repo();
  log(dir, 4, 'soon');
  const r = cli(dir, 'debt');
  assert.equal(r.out.split('\n').filter((l) => l.trim().startsWith('- ')).length, 4);
  assert.equal(/more/.test(r.out), false);
});

test('debt leaves an empty category out of the listing', () => {
  const dir = repo();
  log(dir, 1, 'pattern');
  const r = cli(dir, 'debt');
  assert.match(r.out, /pattern \(1\)/);
  assert.equal(/cleanup \(/.test(r.out), false);
  assert.equal(/accepted \(/.test(r.out), false);
});

test('debt caps each category on its own', () => {
  const dir = repo();
  log(dir, 7, 'cleanup');
  log(dir, 6, 'soon');
  const r = cli(dir, 'debt');
  assert.equal(r.out.split('\n').filter((l) => l.trim().startsWith('- ')).length, 10);
  assert.match(r.out, /2 more/);
  assert.match(r.out, /1 more/);
});

test('the readme names the report contract', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /i-have-adhd/);
});
