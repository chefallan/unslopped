import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, cli } from './helpers.ts';

test('-h exits 0 with the same text as help', () => {
  const dir = tmpDir();
  const short = cli(dir, '-h');
  assert.equal(short.code, 0);
  assert.equal(short.out, cli(dir, 'help').out);
});

test('help opens with the loop, the five human moments', () => {
  const dir = tmpDir();
  const r = cli(dir, 'help');
  assert.equal(r.code, 0);
  const beforeCommands = r.out.slice(0, r.out.indexOf('install ['));
  assert.match(beforeCommands, /the loop:/);
  assert.match(beforeCommands, /plan, code, build, test, release, deploy, operate, monitor/);
  assert.match(beforeCommands, /your moments:/);
  assert.match(beforeCommands, /approve deploy/);
  assert.match(beforeCommands, /merge the pull request/);
});
