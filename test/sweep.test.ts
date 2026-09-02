import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toolDecision } from '../src/hooks.ts';
import { scopeCheck, mergePractices } from '../src/practices.ts';
import { configDriftLines, configHash, loadConfig } from '../src/config.ts';
import { tmpDir, initRepo, git, writeConfig, cli, PASS, PRACTICES_OFF } from './helpers.ts';

function activeProject(practices: Record<string, unknown> = {}): string {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, ...practices } });
  fs.mkdirSync(path.join(dir, '.unslopped'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'state.json'), JSON.stringify({ cycle: { id: 'x', phase: 'code' } }) + '\n');
  return dir;
}

test('heredoc bodies no longer trip the human-only rule', () => {
  const dir = activeProject();
  const heredoc = "cat > notes.md << 'EOF'\nplease ask a human to run: unslopped reset\nEOF";
  assert.equal(toolDecision(dir, 'Bash', { command: heredoc }).block, false);
  assert.ok(toolDecision(dir, 'Bash', { command: 'unslopped reset' }).ask, 'reset is intercepted');
  const chained = toolDecision(dir, 'Bash', { command: 'cd sub && npx unslopped approve deploy' });
  assert.ok(chained.block || chained.ask, 'a chained approve is still intercepted');
  assert.equal(toolDecision(dir, 'Bash', { command: 'echo "the docs mention unslopped approve deploy"' }).block, false);
});

test('the config rule fires on real writes only', () => {
  const dir = activeProject();
  const mention = 'node -e "console.log(require(\'./unslopped.config.json\'))" 2>&1';
  assert.equal(toolDecision(dir, 'Bash', { command: mention }).block, false);
  assert.equal(toolDecision(dir, 'Bash', { command: 'echo x > unslopped.config.json' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'git mv unslopped.config.json backup.json' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'cat unslopped.config.json' }).block, false);
});

test('the commit rule matches command position, not prose', () => {
  const dir = activeProject({ messageApproval: true });
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit -m "feat: x"' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'a && git commit -m "feat: x"' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'echo "how git commit works here"' }).block, false);
});

test('a parenthetical note on a declared file still covers it', () => {
  const dir = tmpDir();
  initRepo(dir);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), '1\n');
  const practices = mergePractices({ ...PRACTICES_OFF, scope: true } as never);
  const ctx = { root: dir, config: { practices }, cycle: { startCommit: git(dir, 'rev-parse', 'HEAD') } } as never;
  const plan = '## Files to touch\n- src/a.ts (new helper)\n';
  const c = scopeCheck(ctx, plan)!;
  assert.equal(c.ok, true, c.detail);
});

test('stored config text beats a stale hash, edits print the changed lines', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const config = loadConfig(dir)!;
  const text = fs.readFileSync(path.join(dir, 'unslopped.config.json'), 'utf8');
  const fresh = { configText: text, configHash: 'stalehash12345678' } as never;
  assert.equal(configDriftLines(dir, config, fresh), null);
  fs.writeFileSync(path.join(dir, 'unslopped.config.json'), text.replace('"deploy": {', '"deploy": { "extra": 1,'));
  const drift = configDriftLines(dir, loadConfig(dir)!, fresh)!;
  assert.ok(drift.some((l) => l.startsWith('-')));
  assert.ok(drift.some((l) => l.startsWith('+') && l.includes('extra')));
  const legacyOk = { configHash: configHash(config) } as never;
  assert.equal(configDriftLines(dir, config, legacyOk), null);
});

test('the start refusal names resume before reset', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  assert.equal(cli(dir, 'start', 'first goal').code, 0);
  const r = cli(dir, 'start', 'second goal');
  assert.equal(r.code, 2);
  assert.match(r.out, /continue it with: unslopped resume/);
  assert.match(r.out, /abandon it with: unslopped reset/);
});

test('approving prints the next action', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  assert.equal(cli(dir, 'start', 'approve goal').code, 0);
  const deploy = cli(dir, 'approve', 'deploy');
  assert.equal(deploy.code, 0);
  assert.match(deploy.out, /advance with: unslopped next/);
  const config = cli(dir, 'approve', 'config');
  assert.equal(config.code, 0);
  assert.match(config.out, /advance with: unslopped next/);
});

function bareProject(): string {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  return dir;
}

test('the approve prompt shows pending text without an active cycle', () => {
  const dir = bareProject();
  fs.mkdirSync(path.join(dir, '.unslopped', 'proposals'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'proposals', 'commit.md'), 'feat: pending thing\n\nBody line.\n');
  const d = toolDecision(dir, 'Bash', { command: 'unslopped approve commit' });
  assert.equal(d.ask, true);
  assert.match(d.reason ?? '', /feat: pending thing/);
});

test('the approve prompt says when nothing is pending', () => {
  const dir = bareProject();
  const d = toolDecision(dir, 'Bash', { command: 'unslopped approve commit' });
  assert.equal(d.ask, true);
  assert.match(d.reason ?? '', /nothing is pending/i);
});

test('the force-push rule matches command position only', () => {
  const dir = activeProject();
  assert.equal(toolDecision(dir, 'Bash', { command: 'git push --force origin main' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'echo "never git push --force origin main"' }).block, false);
});

test('the commit rule ignores commit as a filename', () => {
  const dir = activeProject({ messageApproval: true });
  assert.equal(toolDecision(dir, 'Bash', { command: 'git restore .unslopped/proposals/commit.md' }).block, false);
  assert.equal(toolDecision(dir, 'Bash', { command: 'git show HEAD:.unslopped/proposals/commit.md' }).block, false);
  assert.equal(toolDecision(dir, 'Bash', { command: 'git -c user.name=t commit -m "feat: x"' }).block, true);
  assert.equal(toolDecision(dir, 'Bash', { command: 'git commit -m "feat: x"' }).block, true);
});
