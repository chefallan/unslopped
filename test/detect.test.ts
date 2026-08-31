import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectTracker, findIssueRef, githubRepoFromUrl, applyDetection, currentBranch } from '../src/detect.ts';
import { tmpDir, initRepo, git } from './helpers.ts';

const NONE = { LINEAR_API_KEY: '', JIRA_API_TOKEN: '', JIRA_BASE_URL: '', GITHUB_TOKEN: '', GH_TOKEN: '', ADE_WEBHOOK_URL: '' };

test('githubRepoFromUrl handles ssh, https remotes', () => {
  assert.equal(githubRepoFromUrl('git@github.com:acme/app.git'), 'acme/app');
  assert.equal(githubRepoFromUrl('https://github.com/acme/app'), 'acme/app');
  assert.equal(githubRepoFromUrl('https://github.com/acme/app.git/'), 'acme/app');
  assert.equal(githubRepoFromUrl('https://gitlab.com/acme/app.git'), null);
  assert.equal(githubRepoFromUrl(null), null);
});

test('env vars decide the provider first', () => {
  assert.equal(detectTracker(tmpDir(), { ...NONE, LINEAR_API_KEY: 'k' }).provider, 'linear');
  const jira = detectTracker(tmpDir(), { ...NONE, JIRA_API_TOKEN: 't', JIRA_BASE_URL: 'https://a.atlassian.net' });
  assert.equal(jira.provider, 'jira');
  assert.equal(jira.jira.baseUrl, 'https://a.atlassian.net');
  assert.equal(detectTracker(tmpDir(), { ...NONE, GH_TOKEN: 't' }).provider, 'github');
  const hook = detectTracker(tmpDir(), { ...NONE, ADE_WEBHOOK_URL: 'https://h' });
  assert.equal(hook.provider, 'webhook');
  assert.equal(hook.webhook.url, 'https://h');
  assert.equal(detectTracker(tmpDir(), NONE).provider, null);
});

test('project files reveal jira, linear', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'README.md'), 'Track work at https://initech.atlassian.net/browse/APP\n');
  const d = detectTracker(dir, NONE);
  assert.equal(d.provider, 'jira');
  assert.equal(d.jira.baseUrl, 'https://initech.atlassian.net');
  assert.match(d.evidence[0], /initech.atlassian.net referenced/);
  const dir2 = tmpDir();
  fs.writeFileSync(path.join(dir2, 'CONTRIBUTING.md'), 'Issues live in https://linear.app/acme/team/ENG\n');
  assert.equal(detectTracker(dir2, NONE).provider, 'linear');
});

test('placeholder atlassian hosts in docs do not count', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'README.md'), 'Example: https://acme.atlassian.net and https://example.atlassian.net\n');
  assert.equal(detectTracker(dir, NONE).provider, null);
});

test('a github remote is detected with its repo, file hints win over it', () => {
  const dir = tmpDir();
  initRepo(dir);
  git(dir, 'remote', 'add', 'origin', 'git@github.com:acme/app.git');
  const d = detectTracker(dir, NONE);
  assert.equal(d.provider, 'github');
  assert.equal(d.github.repo, 'acme/app');
  fs.writeFileSync(path.join(dir, 'README.md'), 'https://initech.atlassian.net\n');
  const d2 = detectTracker(dir, NONE);
  assert.equal(d2.provider, 'jira');
  assert.equal(d2.github.repo, 'acme/app');
  assert.equal(d2.evidence.length, 2);
});

test('mcp server names are a last resort hint', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.cursor'));
  fs.writeFileSync(path.join(dir, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { 'Linear MCP': {} } }));
  const d = detectTracker(dir, NONE);
  assert.equal(d.provider, 'linear');
  assert.match(d.evidence[0], /MCP server "linear mcp"/);
});

test('applyDetection fills provider, blanks without overriding explicit values', () => {
  const t = { provider: null, jira: { baseUrl: null }, github: { repo: 'x/y' }, webhook: { url: null } };
  const next = applyDetection(t, { provider: 'github', github: { repo: 'a/b' }, jira: { baseUrl: 'https://j' }, webhook: {} });
  assert.equal(next.provider, 'github');
  assert.equal(next.github.repo, 'x/y');
  assert.equal(next.jira.baseUrl, 'https://j');
});

test('findIssueRef reads keys, hashes, urls from prose', () => {
  assert.equal(findIssueRef('Fix the login bug ENG-123 today'), 'ENG-123');
  assert.equal(findIssueRef('see https://linear.app/acme/issue/ENG-9/login-broken'), 'ENG-9');
  assert.equal(findIssueRef('https://acme.atlassian.net/browse/APP-42 is blocked'), 'APP-42');
  assert.equal(findIssueRef('https://github.com/acme/app/issues/17'), 'acme/app#17');
  assert.equal(findIssueRef('closes #17', 'github'), '#17');
  assert.equal(findIssueRef('closes #17'), '#17');
  assert.equal(findIssueRef('ENG-123 and #17', 'github'), '#17');
  assert.equal(findIssueRef('ENG-123 and #17', 'jira'), 'ENG-123');
  assert.equal(findIssueRef('use UTF-8 and SHA-256 with node-18'), null);
  assert.equal(findIssueRef('migrate to es-2015 style'), null);
  assert.equal(findIssueRef('add a /health endpoint'), null);
  assert.equal(findIssueRef(''), null);
});

test('findIssueRef reads branch names case insensitively', () => {
  assert.equal(findIssueRef('alice/eng-123-add-login', 'linear', { branch: true }), 'ENG-123');
  assert.equal(findIssueRef('feature/APP-7', 'jira', { branch: true }), 'APP-7');
  assert.equal(findIssueRef('17-fix-login', 'github', { branch: true }), '#17');
  assert.equal(findIssueRef('issue-17-fix-login', 'github', { branch: true }), '#17');
  assert.equal(findIssueRef('main', null, { branch: true }), null);
  assert.equal(findIssueRef('feature/node-18-upgrade', null, { branch: true }), null);
});

test('currentBranch returns the checked out branch', () => {
  const dir = tmpDir();
  initRepo(dir);
  git(dir, 'checkout', '-q', '-b', 'alice/eng-5-thing');
  assert.equal(currentBranch(dir), 'alice/eng-5-thing');
});
