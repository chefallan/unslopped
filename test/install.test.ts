import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { install, uninstall, GLOBAL_TARGET_NAMES, mergeClaudeSettings, stripClaudeSettings, removeBlock, targetPath } from '../src/install.ts';
import { START, END } from '../src/protocol.ts';
import { tmpDir } from './helpers.ts';

function count(text, needle) {
  return text.split(needle).length - 1;
}

const env = (home) => ({ APPDATA: path.join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(home, '.config') });

test('install writes every global target, is idempotent', () => {
  const home = tmpDir();
  const r = install(home, { env: env(home), platform: 'linux' });
  assert.equal(r.written.length, GLOBAL_TARGET_NAMES.length);
  install(home, { env: env(home), platform: 'linux' });
  for (const key of ['codex', 'gemini', 'windsurf', 'copilot', 'opencode', 'cline', 'roo', 'kilo', 'continue', 'goose']) {
    const text = fs.readFileSync(targetPath(home, key, env(home), 'linux'), 'utf8');
    assert.equal(count(text, START), 1, key);
    assert.match(text, /ade next/);
    assert.doesNotMatch(text, /npx awesome-delivery-engine/);
  }
  assert.match(fs.readFileSync(targetPath(home, 'copilot', env(home), 'linux'), 'utf8'), /^---\napplyTo: "\*\*"/);
  assert.equal(targetPath(home, 'opencode', env(home), 'linux'), path.join(home, '.config', 'opencode', 'AGENTS.md'));
  assert.equal(targetPath(home, 'cline', env(home), 'linux'), path.join(home, 'Documents', 'Cline', 'Rules', 'ade.md'));
  const claude = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(claude.hooks.UserPromptSubmit.length, 1);
  assert.equal(claude.hooks.UserPromptSubmit[0].hooks[0].command, 'ade hook claude prompt');
  assert.equal(claude.hooks.PreToolUse[0].matcher, 'Bash|Edit|Write|MultiEdit|NotebookEdit');
  const cursor = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
  assert.equal(cursor.version, 1);
  assert.equal(cursor.hooks.beforeShellExecution[0].command, 'ade hook cursor shell');
});

test('copilot path follows the platform', () => {
  const home = tmpDir();
  assert.equal(targetPath(home, 'copilot', env(home), 'win32'), path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'prompts', 'ade.instructions.md'));
  assert.equal(targetPath(home, 'copilot', {}, 'darwin'), path.join(home, 'Library', 'Application Support', 'Code', 'User', 'prompts', 'ade.instructions.md'));
});

test('existing claude settings, hooks survive install, uninstall', () => {
  const home = tmpDir();
  const settingsFile = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const before = { model: 'opus', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } };
  fs.writeFileSync(settingsFile, JSON.stringify(before));
  install(home, { only: ['claude'], env: env(home), platform: 'linux' });
  let after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.equal(after.hooks.UserPromptSubmit.length, 2);
  assert.equal(after.hooks.UserPromptSubmit[0].hooks[0].command, 'echo hi');
  assert.ok(after.hooks.SessionStart);
  uninstall(home, { only: ['claude'], env: env(home), platform: 'linux' });
  after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.deepEqual(after, before);
});

test('merge, strip are pure, handle empty settings', () => {
  const merged = mergeClaudeSettings({});
  assert.equal(Object.keys(merged.hooks).length, 3);
  assert.deepEqual(stripClaudeSettings(merged), {});
  assert.deepEqual(stripClaudeSettings({ a: 1 }), { a: 1 });
});

test('uninstall removes markdown blocks, keeps other content, deletes empty files', () => {
  const home = tmpDir();
  const codex = path.join(home, '.codex', 'AGENTS.md');
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, '# mine\nkeep\n');
  install(home, { only: ['codex', 'gemini'], env: env(home), platform: 'linux' });
  const r = uninstall(home, { only: ['codex', 'gemini', 'roo'], env: env(home), platform: 'linux' });
  assert.equal(r.removed.length, 2);
  assert.equal(fs.readFileSync(codex, 'utf8'), '# mine\nkeep\n');
  assert.equal(fs.existsSync(path.join(home, '.gemini', 'GEMINI.md')), false);
  assert.equal(removeBlock(`a\n\n${START}\nx\n${END}\n\nb\n`), 'a\n\nb\n');
});

test('unknown targets are rejected', () => {
  assert.throws(() => install(tmpDir(), { only: ['emacs'] }), /unknown target: emacs/);
});
