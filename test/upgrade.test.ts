import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { upsertBlock, installGitHooks } from '../src/init.ts';
import { protocol, START } from '../src/protocol.ts';
import { mergeClaudeSettings } from '../src/install.ts';
import { toolDecision } from '../src/hooks.ts';
import { tmpDir, initRepo } from './helpers.ts';

const LEGACY_BLOCK = '<!' + '-- ade:start --' + '>\nold protocol body\n<!' + '-- ade:end --' + '>';

test('upsertBlock replaces a legacy-marked block in place', () => {
  const existing = `# My project\n\n${LEGACY_BLOCK}\n\ncustom trailer\n`;
  const next = upsertBlock(existing, protocol());
  assert.equal(next.split(START).length, 2);
  assert.doesNotMatch(next, /ade:start/);
  assert.doesNotMatch(next, /old protocol body/);
  assert.match(next, /# My project/);
  assert.match(next, /custom trailer/);
});

test('mergeClaudeSettings replaces legacy hook entries', () => {
  const settings = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'ade hook claude session' }] },
        { hooks: [{ type: 'command', command: 'someone-else --flag' }] },
      ],
    },
  };
  const merged = mergeClaudeSettings(settings);
  const entries = merged.hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>;
  const ours = entries.filter((e) => e.hooks.some((h) => /\b(unslopped|ade)\s+hook\b/.test(h.command)));
  assert.equal(ours.length, 1);
  assert.match(ours[0].hooks[0].command, /^unslopped hook claude session$/);
  assert.ok(entries.some((e) => e.hooks.some((h) => h.command === 'someone-else --flag')));
});

function activeProject(): string {
  const dir = tmpDir();
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'unslopped.config.json'), '{}\n');
  fs.mkdirSync(path.join(dir, '.unslopped'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.unslopped', 'state.json'), JSON.stringify({ cycle: { id: 'x', phase: 'code' } }) + '\n');
  return dir;
}

test('tool hook blocks the legacy command names', () => {
  const dir = activeProject();
  const legacyReset = toolDecision(dir, 'Bash', { command: 'ade reset' });
  assert.ok(legacyReset.block || legacyReset.ask);
  const legacyApprove = toolDecision(dir, 'Bash', { command: 'npx awesome-delivery-engine approve deploy' });
  assert.ok(legacyApprove.block || legacyApprove.ask);
  const roll = toolDecision(dir, 'Bash', { command: 'unslopped rollback' });
  assert.ok(roll.block || roll.ask);
  assert.equal(toolDecision(dir, 'Bash', { command: 'unslopped status' }).block, false);
});

test('tool hook blocks writes to the legacy config filename mid-cycle', () => {
  const dir = activeProject();
  assert.equal(toolDecision(dir, 'Bash', { command: 'echo x > ade.config.json' }).block, true);
  assert.equal(toolDecision(dir, 'Edit', { file_path: path.join(dir, 'ade.config.json') }).block, true);
  assert.equal(toolDecision(dir, 'Edit', { file_path: path.join(dir, 'src', 'a.ts') }).block, false);
});

test('installGitHooks leaves hooks carrying the legacy mark alone', () => {
  const dir = tmpDir();
  initRepo(dir);
  const hook = path.join(dir, '.git', 'hooks', 'post-commit');
  fs.writeFileSync(hook, '#!/bin/sh\n# ade: refresh the code map\nade graph refresh --quiet\n');
  const written = installGitHooks(dir);
  assert.ok(!written.includes('.git/hooks/post-commit'));
  const text = fs.readFileSync(hook, 'utf8');
  assert.equal(text.split('refresh the code map').length, 2);
});
