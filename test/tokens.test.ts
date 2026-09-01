import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { estimate, stripAnsi, digest, account, summarize, reportLines } from '../src/tokens.ts';
import { runGate } from '../src/gates.ts';
import { newCycle } from '../src/state.ts';
import { loadConfig } from '../src/config.ts';
import { sessionContext } from '../src/hooks.ts';
import { init } from '../src/init.ts';
import { START } from '../src/protocol.ts';
import { tmpDir, initRepo, git, writeConfig, PASS, NO_TRACKER_ENV } from './helpers.ts';

const NOISY = [
  '> app@1.0.0 test',
  '> vitest run',
  '',
  ...Array.from({ length: 60 }, (_, i) => `✓ src/things.test.js > case ${i}`),
  '\u001b[31m✖ src/login.test.js > logs in\u001b[0m',
  'AssertionError: expected 401 to equal 200',
  '    at Context.<anonymous> (src/login.test.js:14:5)',
  '',
  'Tests  1 failed | 60 passed',
  'npm notice something irrelevant',
].join('\n');

test('estimate, stripAnsi', () => {
  assert.equal(estimate('abcd'), 1);
  assert.equal(estimate('abcde'), 2);
  assert.equal(estimate(''), 0);
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
});

test('digest keeps failure lines with context, drops the rest', () => {
  const d = digest(NOISY, { lines: 25 });
  assert.equal(d.signal, true);
  assert.match(d.text, /✖ src\/login\.test\.js > logs in/);
  assert.match(d.text, /AssertionError: expected 401 to equal 200/);
  assert.match(d.text, /at Context/);
  assert.match(d.text, /1 failed \| 60 passed/);
  assert.doesNotMatch(d.text, /case 30/);
  assert.doesNotMatch(d.text, /npm notice/);
  assert.doesNotMatch(d.text, /\[31m/);
  assert.ok(d.omitted > 50);
  assert.ok(d.kept <= 12);
});

test('digest falls back to the tail when nothing looks like an error, caps long signal', () => {
  const plain = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const d = digest(plain);
  assert.equal(d.signal, false);
  assert.equal(d.kept, 15);
  assert.match(d.text, /line 29/);
  assert.doesNotMatch(d.text, /line 0\b/);
  const many = Array.from({ length: 80 }, (_, i) => `Error: problem ${i}`).join('\n');
  const capped = digest(many, { lines: 10, context: 0 });
  assert.equal(capped.kept, 10);
  assert.equal(capped.truncated, true);
  assert.match(capped.text, /problem 79/);
});

test('account, summarize add up per kind', () => {
  const cycle = { id: 'c' };
  account(cycle, 'gate', 1000, 100);
  account(cycle, 'gate', 500, 50);
  account(cycle, 'hook', 300, 200);
  account(null, 'gate', 1, 1);
  assert.deepEqual(cycle.tokens.gate, { raw: 1500, shown: 150, count: 2 });
  const sum = summarize([cycle, { tokens: { gate: { raw: 100, shown: 100, count: 1 } } }, {}]);
  assert.equal(sum.gate.raw, 1600);
  assert.equal(sum.gate.count, 3);
  assert.equal(sum.hook.shown, 200);
  const lines = reportLines('x', cycle.tokens);
  assert.match(lines[1], /saved ~337 tok/);
  assert.match(lines[2], /skipped ~25 tok of duplicate protocol/);
});

test('failing gates print a digest, write the full log, account the savings', () => {
  const dir = tmpDir();
  initRepo(dir);
  const script = path.join(dir, 'noisy.cjs');
  fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(NOISY)}); process.exit(1);`);
  writeConfig(dir, { test: `node noisy.cjs` });
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'cfg');
  const cycle = newCycle('g', 'h', git(dir, 'rev-parse', 'HEAD'));
  const config = loadConfig(dir);
  const r = runGate('test', { root: dir, config, cycle });
  assert.equal(r.pass, false);
  const detail = r.checks[0].detail;
  assert.match(detail, /AssertionError/);
  assert.doesNotMatch(detail, /case 30/);
  const m = detail.match(/full log: (\S+)/);
  assert.ok(m, detail);
  assert.match(fs.readFileSync(path.join(dir, m[1]), 'utf8'), /case 30/);
  assert.ok(cycle.tokens.gate.raw > cycle.tokens.gate.shown * 3);
  assert.equal(cycle.tokens.gate.count, 1);

  const full = runGate('test', { root: dir, config: { ...config, tokens: { ...config.tokens, mode: 'full' } }, cycle });
  assert.match(full.checks[0].detail, /case 30/);
  assert.doesNotMatch(full.checks[0].detail, /full log/);
});

test('cursor, copilot get a pointer to AGENTS.md instead of a second protocol copy', () => {
  const dir = tmpDir();
  init(dir, { env: NO_TRACKER_ENV });
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const cursor = fs.readFileSync(path.join(dir, '.cursor/rules/unslopped.mdc'), 'utf8');
  const copilot = fs.readFileSync(path.join(dir, '.github/copilot-instructions.md'), 'utf8');
  const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(agents, /## Phases/);
  assert.match(claude, /## Phases/);
  assert.doesNotMatch(cursor, /## Phases/);
  assert.match(cursor, /defined in AGENTS\.md/);
  assert.match(cursor, /^---\ndescription/);
  assert.doesNotMatch(copilot, /## Phases/);
  assert.ok(cursor.length < agents.length / 3);
  const alone = tmpDir();
  init(alone, { only: ['cursor'], env: NO_TRACKER_ENV });
  assert.match(fs.readFileSync(path.join(alone, '.cursor/rules/unslopped.mdc'), 'utf8'), /## Phases/);
  const off = tmpDir();
  fs.writeFileSync(path.join(off, 'unslopped.config.json'), JSON.stringify({ commands: { test: 'x' }, tokens: { pointerFiles: false } }));
  init(off, { env: NO_TRACKER_ENV });
  assert.match(fs.readFileSync(path.join(off, '.cursor/rules/unslopped.mdc'), 'utf8'), /## Phases/);
});

test('the session hook does not repeat a protocol the project already carries', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const withProtocol = sessionContext(dir);
  assert.match(withProtocol, /## Phases/);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${START}\nstuff\n<!-- unslopped:end -->\n`);
  const slim = sessionContext(dir);
  assert.doesNotMatch(slim, /## Phases/);
  assert.match(slim, /follow the unslopped block in CLAUDE\.md/);
  assert.match(slim, /no active cycle/);
  assert.ok(slim.length < withProtocol.length / 4);
});
