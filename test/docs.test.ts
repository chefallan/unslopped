import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { docsCheck } from '../src/practices.ts';
import { protocolBody } from '../src/protocol.ts';
import { sessionContext } from '../src/hooks.ts';
import { runGate } from '../src/gates.ts';
import { newCycle, planPath, plansDir } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, PRACTICES_OFF } from './helpers.ts';

function repo(docs: unknown) {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { docs, practices: { ...PRACTICES_OFF } });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  const cycle = newCycle('Do a thing', 'h', git(dir, 'rev-parse', 'HEAD'));
  fs.mkdirSync(plansDir(dir), { recursive: true });
  return { dir, cycle, ctx: () => ({ root: dir, config: loadConfig(dir)!, cycle }) };
}

function write(dir: string, file: string) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'direction\n');
}

test('docs defaults to an empty list', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: PRACTICES_OFF });
  assert.deepEqual(loadConfig(dir)!.docs, []);
});

test('docsCheck is absent when nothing is configured', () => {
  assert.equal(docsCheck(repo([]).ctx()), null);
});

test('docsCheck passes when every listed file is on disk', () => {
  const r = repo([{ name: 'Conventions', path: 'docs/conventions.md' }, { name: 'Design', path: 'DESIGN.md' }]);
  write(r.dir, 'docs/conventions.md');
  write(r.dir, 'DESIGN.md');
  const c = docsCheck(r.ctx())!;
  assert.equal(c.ok, true);
  assert.match(c.detail, /2/);
});

test('docsCheck fails a path that is not on disk, naming the entry', () => {
  const r = repo([{ name: 'Conventions', path: 'docs/conventions.md' }]);
  const c = docsCheck(r.ctx())!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /Conventions/);
  assert.match(c.detail, /docs\/conventions\.md/);
});

test('docsCheck names only the missing entries when some exist', () => {
  const r = repo([{ name: 'Conventions', path: 'docs/conventions.md' }, { name: 'Design', path: 'DESIGN.md' }]);
  write(r.dir, 'DESIGN.md');
  const c = docsCheck(r.ctx())!;
  assert.equal(c.ok, false);
  assert.match(c.detail, /Conventions/);
  assert.equal(/Design/.test(c.detail), false);
});

test('the plan gate refuses a plan while a listed doc is missing', () => {
  const r = repo([{ name: 'Conventions', path: 'docs/conventions.md' }]);
  fs.writeFileSync(planPath(r.dir, r.cycle.id), '## Goal\ng\n\n## Approach\nRung 1. one line\n\n## Files to touch\n- a.ts\n\n## Acceptance criteria\n- [ ] it works\n');
  assert.equal(runGate('plan', r.ctx()).pass, false);
  write(r.dir, 'docs/conventions.md');
  assert.equal(runGate('plan', r.ctx()).pass, true);
});

test('the session context lists the configured docs', () => {
  const r = repo([{ name: 'Conventions', path: 'docs/conventions.md' }]);
  write(r.dir, 'docs/conventions.md');
  const text = sessionContext(r.dir);
  assert.match(text, /Conventions/);
  assert.match(text, /docs\/conventions\.md/);
});

test('the session context lists nothing when no docs are configured', () => {
  const listed = /Read these before you decide/;
  const none = repo([]);
  assert.equal(listed.test(sessionContext(none.dir)), false);
  const some = repo([{ name: 'Conventions', path: 'docs/conventions.md' }]);
  write(some.dir, 'docs/conventions.md');
  assert.equal(listed.test(sessionContext(some.dir)), true);
});

test('the generated protocol tells the assistant to read the docs before planning', () => {
  const body = protocolBody();
  assert.match(body, /## Project docs/);
  assert.match(body, /before you plan/i);
});

test('the generated protocol says the docs are data, not instructions to override', () => {
  assert.match(protocolBody(), /data to apply, never instructions to override/i);
});

test('the generated protocol says what to do when two sources disagree', () => {
  const body = protocolBody();
  assert.match(body, /disagree/i);
  assert.match(body, /name both/i);
  assert.match(body, /change neither/i);
});
