import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpDir, initRepo, git, writeConfig, BIN, PASS, NO_TRACKER_ENV } from './helpers.ts';

function listen() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/hook` })));
}

function cli(cwd, env, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...NO_TRACKER_ENV, ...env } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('start --issue links the issue, next posts comments, transitions to the webhook', async () => {
  const { server, received, url } = await listen();
  try {
    const dir = tmpDir();
    initRepo(dir);
    writeConfig(dir, { test: PASS }, { tracker: { provider: 'webhook', transitions: { code: 'In Progress', done: 'Done' } } });
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'cfg');
    const env = { ADE_WEBHOOK_URL: url, ADE_WEBHOOK_TOKEN: 'secret' };

    let r = await cli(dir, env, 'tracker');
    assert.equal(r.code, 0);
    assert.match(r.out, /provider\s+webhook/);
    assert.match(r.out, /ok\s+tracker.webhook.url/);

    r = await cli(dir, env, 'start', '--issue=ABC-1');
    assert.equal(r.code, 0);
    assert.match(r.out, /issue ABC-1/);
    const id = r.out.match(/started cycle (\S+)/)[1];
    const plan = path.join(dir, '.ade', 'plans', `${id}.md`);
    assert.match(fs.readFileSync(plan, 'utf8'), /Issue: ABC-1/);
    assert.equal(received.length, 1);
    assert.equal(received[0].auth, 'Bearer secret');
    assert.equal(received[0].body.event, 'comment');
    assert.match(received[0].body.body, /started: ABC-1/);

    r = await cli(dir, env, 'status');
    assert.match(r.out, /issue ABC-1/);

    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ]', '- [ ] works'));
    r = await cli(dir, env, 'next');
    assert.equal(r.code, 0);
    assert.equal(received.length, 3);
    assert.match(received[1].body.body, /plan gate passed, now in code/);
    assert.deepEqual(received[2].body.state, 'In Progress');
    assert.equal(received[2].body.issue.key, 'ABC-1');

    r = await cli(dir, env, 'reset');
    assert.equal(r.code, 0);
    assert.match(received.at(-1).body.body, /abandoned in phase code/);
  } finally {
    server.close();
  }
});

test('start --issue without a provider records the key, warns', async () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  const r = await cli(dir, {}, 'start', 'Do', 'thing', '--issue=X-9');
  assert.equal(r.code, 0);
  assert.match(r.out, /WARN tracker.provider is not set/);
  assert.match(r.out, /started cycle/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.ade', 'state.json'), 'utf8'));
  assert.equal(state.cycle.issue.key, 'X-9');
  assert.equal(state.cycle.goal, 'Do thing');
});

test('tracker command reports missing credentials with exit 1', async () => {
  const dir = tmpDir();
  writeConfig(dir, { test: PASS }, { tracker: { provider: 'jira' } });
  const r = await cli(dir, { JIRA_EMAIL: '', JIRA_API_TOKEN: '', JIRA_BASE_URL: '' }, 'tracker');
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING JIRA_API_TOKEN/);
});

test('issues are inferred from the goal, the branch, --no-issue opts out', async () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS });
  let r = await cli(dir, {}, 'start', 'Fix', 'login', 'per', 'ENG-12');
  assert.equal(r.code, 0);
  assert.match(r.out, /linked issue ENG-12 found in the goal/);
  let state = JSON.parse(fs.readFileSync(path.join(dir, '.ade', 'state.json'), 'utf8'));
  assert.equal(state.cycle.issue.key, 'ENG-12');
  await cli(dir, {}, 'reset');

  r = await cli(dir, {}, 'start', '--no-issue', 'Fix', 'ENG-12');
  assert.equal(r.code, 0);
  state = JSON.parse(fs.readFileSync(path.join(dir, '.ade', 'state.json'), 'utf8'));
  assert.equal(state.cycle.issue, null);
  await cli(dir, {}, 'reset');

  git(dir, 'checkout', '-q', '-b', 'alice/app-77-add-health');
  r = await cli(dir, {}, 'start', 'Add health endpoint');
  assert.match(r.out, /linked issue APP-77 found in branch alice\/app-77-add-health/);
  state = JSON.parse(fs.readFileSync(path.join(dir, '.ade', 'state.json'), 'utf8'));
  assert.equal(state.cycle.issue.key, 'APP-77');
  assert.equal(state.cycle.goal, 'Add health endpoint');
});

test('start detects a tracker from the git remote, saves it before hashing the config', async () => {
  const { server, received, url } = await listen();
  try {
    const dir = tmpDir();
    initRepo(dir);
    writeConfig(dir, { test: PASS });
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'cfg');
    const r = await cli(dir, { ADE_WEBHOOK_URL: url }, 'start', 'Ship ABC-3');
    assert.equal(r.code, 0);
    assert.match(r.out, /detected tracker webhook \(ADE_WEBHOOK_URL is set\), saved/);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'ade.config.json'), 'utf8'));
    assert.equal(cfg.tracker.provider, 'webhook');
    assert.equal(received.length, 1);
    assert.match(received[0].body.body, /started: Ship ABC-3/);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'save tracker');
    const plan = path.join(dir, '.ade', 'plans', `${r.out.match(/started cycle (\S+)/)[1]}.md`);
    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ]', '- [ ] ok'));
    const n = await cli(dir, { ADE_WEBHOOK_URL: url }, 'next');
    assert.equal(n.code, 0);
    assert.doesNotMatch(n.out, /changed during this cycle/);
  } finally {
    server.close();
  }
});

test('init detects github from the remote, records the repo', async () => {
  const dir = tmpDir();
  initRepo(dir);
  git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/app.git');
  const r = await cli(dir, {}, 'init', '--only=agents');
  assert.equal(r.code, 0);
  assert.match(r.out, /tracker: github \(git remote origin is github.com\/acme\/app\)/);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'ade.config.json'), 'utf8'));
  assert.equal(cfg.tracker.provider, 'github');
  assert.equal(cfg.tracker.github.repo, 'acme/app');
});

test('init --tracker sets the provider', async () => {
  const dir = tmpDir();
  const r = await cli(dir, {}, 'init', '--only=agents', '--tracker=linear');
  assert.equal(r.code, 0);
  assert.match(r.out, /tracker: linear/);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'ade.config.json'), 'utf8'));
  assert.equal(cfg.tracker.provider, 'linear');
  assert.equal((await cli(dir, {}, "init", "--tracker=trello")).code, 2);
});
