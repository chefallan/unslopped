import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpDir, initRepo, git, writeConfig, BIN, PASS, NO_TRACKER_ENV, PRACTICES_OFF } from './helpers.ts';

interface Recorded {
  method: string;
  url: string;
  body: any;
}

function fakeGithub() {
  const calls: Recorded[] = [];
  const state = { merged: false, openPrs: [] as any[] };
  const pr = () => ({ number: 7, html_url: 'https://github.com/acme/app/pull/7', title: 'ABC-1: Ship it', state: state.merged ? 'closed' : 'open', merged: state.merged, merged_at: state.merged ? '2026-01-02T00:00:00Z' : null, draft: false, head: { ref: 'feat', sha: 'abcdef1234567890' }, base: { ref: 'main', sha: 'base' }, body: '' });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      calls.push({ method: req.method ?? '', url, body: body ? JSON.parse(body) : null });
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (url === '/hook') return json(200, {});
      if (url === '/repos/acme/app') return json(200, { default_branch: 'main' });
      if (url.startsWith('/repos/acme/app/pulls?')) return json(200, state.openPrs);
      if (url === '/repos/acme/app/pulls' && req.method === 'POST') {
        state.openPrs = [pr()];
        return json(201, pr());
      }
      if (url === '/repos/acme/app/pulls/7' && req.headers.accept === 'application/vnd.github.diff') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('diff --git a/a.js b/a.js\n@@ -0,0 +1,3 @@\n+1\n+2\n+3\n');
      }
      if (url === '/repos/acme/app/pulls/7') return json(200, pr());
      if (url.startsWith('/repos/acme/app/pulls/7/files')) return json(200, [{ filename: 'a.js', patch: '@@ -0,0 +1,3 @@\n+1\n+2\n+3' }]);
      if (url === '/repos/acme/app/pulls/7/reviews' && req.method === 'POST') return json(200, { id: 99, html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-99' });
      json(404, { message: 'not found' });
    });
  });
  return new Promise<{ server: http.Server; calls: Recorded[]; state: typeof state; base: string }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, state, base: `http://127.0.0.1:${(server.address() as any).port}` })));
}

function cli(cwd: string, env: Record<string, string>, args: string[], input?: string) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...NO_TRACKER_ENV, ...env } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    child.on('close', (code) => resolve({ code, out }));
  });
}

function readState(dir: string) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.ade', 'state.json'), 'utf8'));
}

test('ade pr pushes the branch, opens a PR from the plan, tells the tracker, follows the merge', async () => {
  const gh = await fakeGithub();
  try {
    const dir = tmpDir();
    initRepo(dir);
    const origin = tmpDir();
    git(origin, 'init', '-q', '--bare');
    git(dir, 'remote', 'add', 'origin', origin);
    writeConfig(dir, { test: PASS }, { practices: { ...PRACTICES_OFF, protectedBranches: ['main', 'master'] }, tracker: { provider: 'webhook', github: { repo: 'acme/app' }, transitions: { done: 'Done' } } });
    fs.writeFileSync(path.join(dir, '.gitignore'), '.ade/state.json\n.ade/cycles/\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: config');
    const env = { GITHUB_TOKEN: 'tok', ADE_GITHUB_API: gh.base, ADE_WEBHOOK_URL: `${gh.base}/hook` };

    let r = await cli(dir, env, ['start', 'Ship it ABC-1']);
    assert.equal(r.code, 2);
    r = await cli(dir, env, ['pr']);
    assert.equal(r.code, 2);
    assert.match(r.out, /no active cycle/);

    git(dir, 'checkout', '-q', '-b', 'feat');
    r = await cli(dir, env, ['start', 'Ship it ABC-1']);
    assert.equal(r.code, 0, r.out);
    const id = r.out.match(/started cycle (\S+)/)![1];
    const plan = path.join(dir, '.ade', 'plans', `${id}.md`);
    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('## Goal\n', '## Goal\nShip the thing\n').replace('- [ ]', '- [x] it ships'));
    fs.writeFileSync(path.join(dir, 'a.js'), '1\n2\n3\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'feat: ship');

    r = await cli(dir, env, ['pr']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /pushed feat to origin/);
    assert.match(r.out, /opened pull request #7: https:\/\/github\.com\/acme\/app\/pull\/7/);
    assert.match(git(origin, 'branch'), /feat/);
    const created = gh.calls.find((c) => c.method === 'POST' && c.url === '/repos/acme/app/pulls')!;
    assert.equal(created.body.head, 'feat');
    assert.equal(created.body.base, 'main');
    assert.equal(created.body.title, 'ABC-1: Ship it ABC-1');
    assert.match(created.body.body, /## Why\nShip the thing/);
    assert.match(created.body.body, /- \[x\] it ships/);
    assert.match(created.body.body, /Issue: ABC-1/);
    assert.match(created.body.body, /## Impact\n\d+ file\(s\) changed, 0 dependent file\(s\) within 3 hops\.\n- a\.js: no symbols; 0 importer\(s\); no covering test/);
    const hookOpen = gh.calls.find((c) => c.url === '/hook' && /pull request opened/.test(c.body?.body ?? ''));
    assert.ok(hookOpen, 'tracker told about the PR');
    const st = readState(dir);
    assert.equal(st.cycle.pr.number, 7);
    assert.equal(st.cycle.pr.merged, false);

    r = await cli(dir, env, ['pr']);
    assert.match(r.out, /already open: #7/);

    r = await cli(dir, env, ['pr', 'status']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /state\s+open/);
    assert.match(r.out, /branch\s+feat -> main/);

    gh.state.merged = true;
    r = await cli(dir, env, ['pr', 'status']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /state\s+merged/);
    assert.match(r.out, /issue ABC-1 told the PR merged and moved to Done/);
    assert.equal(readState(dir).cycle.pr.merged, true);
    const transition = gh.calls.find((c) => c.url === '/hook' && c.body?.event === 'transition' && c.body?.state === 'Done');
    assert.ok(transition, 'tracker moved to Done');
    r = await cli(dir, env, ['pr', 'status']);
    assert.doesNotMatch(r.out, /told the PR merged/);
  } finally {
    gh.server.close();
  }
});

test('ade review --pr posts inline, summary comments, fails on critical findings', async () => {
  const gh = await fakeGithub();
  try {
    const dir = tmpDir();
    initRepo(dir);
    writeConfig(dir, { test: PASS }, { tracker: { provider: null, github: { repo: 'acme/app' } } });
    const env = { GITHUB_TOKEN: 'tok', ADE_GITHUB_API: gh.base };

    fs.writeFileSync(path.join(dir, 'r.md'), '- [critical] off by one in a.js:2\n- [major] missing test for a.js:50\n- [minor] naming\n');
    let r = await cli(dir, env, ['review', '--pr=7', '--file=r.md']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reviewing #7 ABC-1: Ship it \(1 file\(s\), feat -> main\)/);
    assert.match(r.out, /findings: 1 critical, 1 major, 1 minor \(from file\)/);
    assert.match(r.out, /posted REQUEST_CHANGES review with 1 inline comment\(s\)/);
    const posted = gh.calls.find((c) => c.url === '/repos/acme/app/pulls/7/reviews')!;
    assert.equal(posted.body.event, 'REQUEST_CHANGES');
    assert.equal(posted.body.commit_id, 'abcdef1234567890');
    assert.deepEqual(posted.body.comments, [{ path: 'a.js', line: 2, side: 'RIGHT', body: '**critical**: off by one in a.js:2' }]);
    assert.match(posted.body.body, /- \[major\] missing test for a\.js:50/);
    assert.match(posted.body.body, /## Impact\n1 file\(s\) changed, 0 dependent file\(s\) within 3 hops\./);
    assert.match(r.out, /impact: 0 dependent file\(s\) within 3 hops/);
    assert.ok(fs.existsSync(path.join(dir, '.ade', 'reviews', 'pr-7.md')));
    assert.ok(fs.existsSync(path.join(dir, '.ade', 'reviews', 'pr-7.diff')));

    r = await cli(dir, env, ['review', '--pr=7', '--approve'], '- [minor] naming\n');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /posted APPROVE review with 0 inline comment\(s\)/);

    const cfgFile = path.join(dir, 'ade.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg.practices.reviewCommand = 'node -e "console.log(\'- [major] \' + process.env.ADE_PR_NUMBER + \' \' + require(\'fs\').existsSync(process.env.ADE_PR_DIFF_FILE))"';
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    r = await cli(dir, env, ['review', '--pr=7', '--no-post']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /findings: 0 critical, 1 major, 0 minor \(from command\)/);
    assert.match(fs.readFileSync(path.join(dir, '.ade', 'reviews', 'pr-7.md'), 'utf8'), /\[major\] 7 true/);
    assert.equal(gh.calls.filter((c) => c.url === '/repos/acme/app/pulls/7/reviews').length, 2);

    r = await cli(dir, { ADE_GITHUB_API: gh.base, GITHUB_TOKEN: '' }, ['review', '--pr=7', '--file=r.md']);
    assert.equal(r.code, 2);
    assert.match(r.out, /no GitHub token/);
    assert.equal((await cli(dir, env, ['review', '--pr=zero'])).code, 2);
  } finally {
    gh.server.close();
  }
});

test('init --ci writes the review workflow once', async () => {
  const dir = tmpDir();
  let r = await cli(dir, {}, ['init', '--only=agents', '--ci']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /wrote \.github[\\/]workflows[\\/]ade-review\.yml/);
  const file = path.join(dir, '.github', 'workflows', 'ade-review.yml');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /on:\n  pull_request:/);
  assert.match(text, /pull-requests: write/);
  assert.match(text, /npx -y awesome-delivery-engine review --pr=\$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(r.out, /wrote \.github[\\/]pull_request_template\.md/);
  const template = fs.readFileSync(path.join(dir, '.github', 'pull_request_template.md'), 'utf8');
  assert.match(template, /## Why\n[\s\S]*## What changed\n[\s\S]*## Review focus/);
  assert.match(template, /reviewer deciding whether to approve/);
  fs.writeFileSync(file, 'custom\n');
  fs.writeFileSync(path.join(dir, '.github', 'pull_request_template.md'), 'mine\n');
  r = await cli(dir, {}, ['init', '--only=agents', '--ci']);
  assert.equal(fs.readFileSync(file, 'utf8'), 'custom\n');
  assert.equal(fs.readFileSync(path.join(dir, '.github', 'pull_request_template.md'), 'utf8'), 'mine\n');
  assert.doesNotMatch(r.out, /ade-review\.yml|pull_request_template/);
});
