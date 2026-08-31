import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init, upsertBlock } from '../src/init.ts';
import { START, END } from '../src/protocol.ts';
import { tmpDir, NO_TRACKER_ENV } from './helpers.ts';

const env = NO_TRACKER_ENV;

function count(text, needle) {
  return text.split(needle).length - 1;
}

test('upsertBlock appends once, replaces in place', () => {
  const block = `${START}\nv1\n${END}\n`;
  const first = upsertBlock('# My project\n', block);
  assert.ok(first.startsWith('# My project'));
  assert.equal(count(first, START), 1);
  const second = upsertBlock(first + '\nfooter\n', `${START}\nv2\n${END}\n`);
  assert.equal(count(second, START), 1);
  assert.match(second, /v2/);
  assert.doesNotMatch(second, /v1/);
  assert.match(second, /footer/);
});

test('init writes config, instruction files, plans dir, gitignore', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const r = init(dir, { env });
  assert.equal(r.configCreated, true);
  assert.equal(r.config.commands.test, 'npm test');
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/ade.mdc', '.windsurf/rules/ade.md']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(count(text, START), 1, f);
    assert.match(text, /npx awesome-delivery-engine next/);
  }
  assert.match(fs.readFileSync(path.join(dir, '.cursor/rules/ade.mdc'), 'utf8'), /^---\ndescription/);
  assert.ok(fs.existsSync(path.join(dir, '.ade', 'plans')));
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.ade\/state\.json/);
});

test('init is idempotent, keeps an existing config', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Rules\nkeep me\n');
  init(dir, { env });
  fs.writeFileSync(path.join(dir, 'ade.config.json'), JSON.stringify({ commands: { test: 'custom' } }));
  const r = init(dir, { env });
  assert.equal(r.configCreated, false);
  assert.equal(r.config.commands.test, 'custom');
  const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(count(claude, START), 1);
  assert.match(claude, /keep me/);
  const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.equal(count(ignore, '.ade/cycles/'), 1);
});

test('init --only limits the files written', () => {
  const dir = tmpDir();
  const r = init(dir, { only: ['claude'], env });
  assert.deepEqual(r.written, ['CLAUDE.md']);
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')));
});

test('protocol text has no em dashes', () => {
  const dir = tmpDir();
  init(dir, { only: ['agents'], env });
  const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(text, /—/);
});
