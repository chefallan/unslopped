import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, initRepo, git, cli, writeConfig, PASS, FAIL } from './helpers.ts';

test('full cycle through the CLI with gates blocking bad moves', () => {
  const dir = tmpDir();
  initRepo(dir);
  const testScript = 'node -e "process.exit(require(\'fs\').readFileSync(\'health.js\', \'utf8\').includes(\'ready\') ? 0 : 1)"';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: testScript } }));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'pkg');

  let r = cli(dir, 'status');
  assert.equal(r.code, 2);
  assert.match(r.out, /unslopped init/);

  r = cli(dir, 'init', '--only=agents');
  assert.equal(r.code, 0);
  assert.match(r.out, /wrote unslopped.config.json/);
  assert.match(r.out, /practices: plan sections Goal\/Approach\/Files to touch, scope on, test evidence on/);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'unslopped');

  r = cli(dir, 'next');
  assert.equal(r.code, 2);
  assert.match(r.out, /no active cycle/);

  r = cli(dir, 'start', 'Add', 'health', 'endpoint');
  assert.equal(r.code, 2);
  assert.match(r.out, /is protected/);
  git(dir, 'checkout', '-q', '-b', 'add-health-endpoint');

  r = cli(dir, 'start', 'Add', 'health', 'endpoint');
  assert.equal(r.code, 0);
  const id = r.out.match(/started cycle (\S+)/)[1];
  const plan = path.join(dir, '.unslopped', 'plans', `${id}.md`);
  assert.ok(fs.existsSync(plan));
  assert.match(fs.readFileSync(plan, 'utf8'), /# Add health endpoint/);

  r = cli(dir, 'start', 'another');
  assert.equal(r.code, 2);
  assert.match(r.out, /is active/);

  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /plan gate: FAIL/);
  assert.match(r.out, /FAIL plan sections: fill in "## Goal", "## Approach", "## Files to touch"/);
  assert.match(r.out, /FAIL acceptance criteria/);

  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ]', '- [ ] GET /health returns 200'));
  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /ok   acceptance criteria/);
  assert.match(r.out, /FAIL leanness ladder/);
  fs.writeFileSync(
    plan,
    fs
      .readFileSync(plan, 'utf8')
      .replace('## Goal\n', '## Goal\nExpose GET /health\n')
      .replace('## Approach\n', '## Approach\nRung 6. One module, one test\n')
      .replace('## Files to touch\n', '## Files to touch\n- health.js\n- health.test.js\n')
  );
  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /ok   plan sections/);
  assert.match(r.out, /ok   leanness ladder/);
  assert.match(r.out, /now in phase code/);

  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /no changes since the cycle started/);

  fs.writeFileSync(path.join(dir, 'health.js'), 'export const ok = true;\n');
  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL test evidence: source changed \(health\.js\)/);

  fs.writeFileSync(path.join(dir, 'health.test.js'), 'import { ok } from "./health.js";\n');
  r = cli(dir, 'red');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /red recorded \(exit 1\) for health\.test\.js/);
  fs.writeFileSync(path.join(dir, 'health.js'), 'export const ok = true; // ready\n');
  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /ok   test evidence/);
  assert.match(r.out, /ok   secret scan/);
  assert.match(r.out, /now in phase build/);

  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /now in phase test/);
  r = cli(dir, 'check');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok   red before green/);

  const cfgFile = path.join(dir, 'unslopped.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, commands: { ...cfg.commands, test: 'true' } }, null, 2));
  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /changed during this cycle/);
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');

  r = cli(dir, 'check');
  assert.equal(r.code, 0);
  assert.match(r.out, /test gate: pass/);
  r = cli(dir, 'status');
  assert.match(r.out, /phase test \(4\/8\)/);

  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /now in phase release/);

  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /uncommitted changes/);
  assert.match(r.out, /FAIL criteria verified: 1 acceptance criterion/);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'health stuff');
  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL commit format/);
  assert.match(r.out, /- health stuff/);
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ] GET /health returns 200', '- [x] GET /health returns 200'));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '--amend', '-m', 'feat: health endpoint');
  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /ok   criteria verified/);
  assert.match(r.out, /ok   commit format/);
  assert.match(r.out, /deploy needs a human/);

  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /approve deploy/);
  r = cli(dir, 'approve', 'deploy');
  assert.equal(r.code, 0);
  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /now in phase operate/);

  r = cli(dir, 'next');
  assert.match(r.out, /now in phase monitor/);
  r = cli(dir, 'log');
  assert.equal(r.code, 0);
  assert.match(r.out, /plan\s+FAIL/);
  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL monitor notes/);
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('## Monitor\n', '## Monitor\nforgot the test file first, then wrote a bad commit message\n'));
  r = cli(dir, 'next');
  assert.equal(r.code, 0);
  assert.match(r.out, /complete/);
  assert.ok(fs.existsSync(path.join(dir, '.unslopped', 'cycles', `${id}.json`)));
  r = cli(dir, 'status');
  assert.match(r.out, /no active cycle/);

  r = cli(dir, 'metrics');
  assert.equal(r.code, 0);
  assert.match(r.out, /cycles\s+1 completed, 0 abandoned, 0 active/);
  assert.match(r.out, /deployments\s+1/);
  assert.match(r.out, /change failure 0%/);
  assert.match(r.out, /first pass\s+plan 0%\s+code 0%\s+build 100%/);
  const m = JSON.parse(cli(dir, 'metrics', '--json').out);
  assert.equal(m.completed, 1);
  assert.equal(m.gateFailures >= 6, true);
});

test('failing test command blocks with its output, reset archives the cycle', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: FAIL });
  let r = cli(dir, 'start', 'x');
  assert.equal(r.code, 0);
  const id = r.out.match(/started cycle (\S+)/)[1];
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'state.json'), 'utf8'));
  state.cycle.phase = 'test';
  fs.writeFileSync(path.join(dir, '.unslopped', 'state.json'), JSON.stringify(state));
  r = cli(dir, 'next');
  assert.equal(r.code, 1);
  assert.match(r.out, /boom/);
  assert.match(r.out, /do not edit tests/);
  r = cli(dir, 'tokens');
  assert.equal(r.code, 0);
  assert.match(r.out, /active cycle/);
  assert.match(r.out, /gate output   1 run\(s\)/);
  assert.match(cli(dir, 'tokens', '--json').out, /"count": 1/);
  r = cli(dir, 'reset');
  assert.equal(r.code, 0);
  const archived = JSON.parse(fs.readFileSync(path.join(dir, '.unslopped', 'cycles', `${id}.json`), 'utf8'));
  assert.equal(archived.status, 'abandoned');
  assert.equal(archived.history.length, 1);
});

test('start refuses outside a git repository', () => {
  const dir = tmpDir();
  writeConfig(dir, { test: PASS });
  const r = cli(dir, 'start', 'x');
  assert.equal(r.code, 2);
  assert.match(r.out, /git init/);
});

test('unknown command prints help, exits 2', () => {
  const r = cli(tmpDir(), 'bogus');
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown command/);
});
