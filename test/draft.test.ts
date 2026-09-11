import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.ts';
import { tmpDir, initRepo, git, writeConfig, BIN, PASS, NO_TRACKER_ENV, PRACTICES_OFF } from './helpers.ts';

interface Recorded {
  method: string;
  url: string;
}

function fakeGithub() {
  const calls: Recorded[] = [];
  const pr = () => ({ number: 7, html_url: 'https://github.com/acme/app/pull/7', title: 'Ship it', state: 'open', merged: false, merged_at: null, draft: false, head: { ref: 'feat', sha: 'abcdef1234567890' }, base: { ref: 'main', sha: 'base' }, body: '' });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      calls.push({ method: req.method ?? '', url });
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (url === '/hook') return json(200, {});
      if (url === '/repos/acme/app') return json(200, { default_branch: 'main' });
      if (url.startsWith('/repos/acme/app/pulls?')) return json(200, []);
      if (url === '/repos/acme/app/pulls' && req.method === 'POST') return json(201, pr());
      if (url === '/repos/acme/app/pulls/7' && req.headers.accept === 'application/vnd.github.diff') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('diff --git a/a.js b/a.js\n@@ -0,0 +1,3 @@\n+1\n+2\n+3\n');
      }
      if (url === '/repos/acme/app/pulls/7') return json(200, pr());
      if (url.startsWith('/repos/acme/app/pulls/7/files')) return json(200, [{ filename: 'a.js', patch: '@@ -0,0 +1,3 @@\n+1\n+2\n+3' }]);
      if (url === '/repos/acme/app/pulls/7/reviews' && req.method === 'POST') return json(200, { id: 99, html_url: 'https://x/1' });
      json(404, { message: 'not found' });
    });
  });
  return new Promise<{ server: http.Server; calls: Recorded[]; base: string }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, base: `http://127.0.0.1:${(server.address() as any).port}` })));
}

function cli(cwd: string, env: Record<string, string>, args: string[]) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...NO_TRACKER_ENV, ...env } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.stdin.end();
    child.on('close', (code) => resolve({ code, out }));
  });
}

function project(base: string, posting: string) {
  const dir = tmpDir();
  initRepo(dir);
  const origin = tmpDir();
  git(origin, 'init', '-q', '--bare');
  git(dir, 'remote', 'add', 'origin', origin);
  writeConfig(dir, { test: PASS }, {
    posting,
    practices: { ...PRACTICES_OFF, protectedBranches: ['main', 'master'] },
    tracker: { provider: 'webhook', github: { repo: 'acme/app' }, transitions: { plan: 'In Progress', done: 'Done' } },
  });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.unslopped/state.json\n.unslopped/cycles/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: config');
  git(dir, 'checkout', '-q', '-b', 'feat');
  return dir;
}

function proposals(dir: string, name: string) {
  return path.join(dir, '.unslopped', 'proposals', name);
}

test('posting defaults to auto', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { practices: PRACTICES_OFF });
  assert.equal(loadConfig(dir)!.posting, 'auto');
});

test('posting draft is read from the config', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { posting: 'draft', practices: PRACTICES_OFF });
  assert.equal(loadConfig(dir)!.posting, 'draft');
});

test('an unknown posting value falls back to auto, never to draft', () => {
  const dir = tmpDir();
  initRepo(dir);
  writeConfig(dir, { test: PASS }, { posting: 'sometimes', practices: PRACTICES_OFF });
  assert.equal(loadConfig(dir)!.posting, 'auto');
});

test('draft posting writes the tracker text instead of sending it', async () => {
  const gh = await fakeGithub();
  try {
    const dir = project(gh.base, 'draft');
    const env = { GITHUB_TOKEN: 'tok', UNSLOPPED_GITHUB_API: gh.base, UNSLOPPED_WEBHOOK_URL: `${gh.base}/hook` };
    const r = await cli(dir, env, ['start', 'Ship it ABC-1']);
    assert.equal(r.code, 0, r.out);
    const file = proposals(dir, 'tracker.md');
    assert.equal(fs.existsSync(file), true);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /ABC-1/);
    assert.match(text, /In Progress/);
    assert.match(r.out, /proposals[\\/]tracker\.md/);
    assert.deepEqual(gh.calls.filter((c) => c.url === '/hook'), []);
  } finally {
    gh.server.close();
  }
});

test('auto posting still sends the tracker text', async () => {
  const gh = await fakeGithub();
  try {
    const dir = project(gh.base, 'auto');
    const env = { GITHUB_TOKEN: 'tok', UNSLOPPED_GITHUB_API: gh.base, UNSLOPPED_WEBHOOK_URL: `${gh.base}/hook` };
    await cli(dir, env, ['start', 'Ship it ABC-1']);
    assert.equal(gh.calls.some((c) => c.url === '/hook'), true);
    assert.equal(fs.existsSync(proposals(dir, 'tracker.md')), false);
  } finally {
    gh.server.close();
  }
});

async function readyForPr(dir: string, env: Record<string, string>) {
  const r = await cli(dir, env, ['start', 'Ship it ABC-1']);
  const id = r.out.match(/started cycle (\S+)/)![1];
  const plan = path.join(dir, '.unslopped', 'plans', `${id}.md`);
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('## Goal\n', '## Goal\nShip the thing\n').replace('- [ ]', '- [x] it ships'));
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n2\n3\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feat: ship');
}

test('draft posting writes the pull request text, pushes, opens nothing', async () => {
  const gh = await fakeGithub();
  try {
    const dir = project(gh.base, 'draft');
    const env = { GITHUB_TOKEN: 'tok', UNSLOPPED_GITHUB_API: gh.base, UNSLOPPED_WEBHOOK_URL: `${gh.base}/hook` };
    await readyForPr(dir, env);
    const r = await cli(dir, env, ['pr']);
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.existsSync(proposals(dir, 'pr.md')), true);
    assert.match(r.out, /proposals[\\/]pr\.md/);
    assert.match(r.out, /pushed feat/);
    assert.deepEqual(gh.calls.filter((c) => c.method === 'POST' && c.url === '/repos/acme/app/pulls'), []);
  } finally {
    gh.server.close();
  }
});

test('draft posting writes review findings without posting them', async () => {
  const gh = await fakeGithub();
  try {
    const dir = project(gh.base, 'draft');
    const env = { GITHUB_TOKEN: 'tok', UNSLOPPED_GITHUB_API: gh.base, UNSLOPPED_WEBHOOK_URL: `${gh.base}/hook` };
    await readyForPr(dir, env);
    const findings = path.join(dir, 'findings.md');
    fs.writeFileSync(findings, '- [minor] a.js:1 worth a second look\n');
    const r = await cli(dir, env, ['review', '--pr=7', `--file=${findings}`]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not sent/);
    assert.deepEqual(gh.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/reviews')), []);
  } finally {
    gh.server.close();
  }
});
