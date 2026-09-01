import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { remoteUrl } from './git.ts';
import type { Env, Provider, TrackerConfig } from './types.ts';

export { currentBranch, remoteUrl } from './git.ts';

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function run(cmd: string, args: string[], cwd?: string): string | null {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function githubRepoFromUrl(url: string | null | undefined): string | null {
  const m = String(url ?? '').match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const HINT_FILES = ['README.md', 'CONTRIBUTING.md', 'package.json', 'docs/README.md'];
const MCP_FILES = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.windsurf/mcp.json', '.gemini/settings.json'];
const PLACEHOLDER_HOSTS = new Set(['acme', 'example', 'company', 'mycompany', 'yourcompany', 'your-company', 'your-domain', 'yourdomain', 'xyz', 'foo', 'test']);

function mcpServerNames(root: string): string[] {
  const names: string[] = [];
  for (const f of MCP_FILES) {
    try {
      const j = JSON.parse(readText(path.join(root, f))) as Record<string, unknown>;
      const servers = (j.mcpServers ?? j.servers ?? {}) as Record<string, unknown>;
      names.push(...Object.keys(servers).map((n) => n.toLowerCase()));
    } catch {
      continue;
    }
  }
  return names;
}

export interface Detection {
  provider: Provider | null;
  jira: { baseUrl?: string };
  github: { repo?: string };
  webhook: { url?: string };
  evidence: string[];
}

export function detectTracker(root: string, env: Env = process.env): Detection {
  const evidence: string[] = [];
  const found: Detection = { provider: null, jira: {}, github: {}, webhook: {}, evidence };
  const pick = (provider: Provider, why: string) => {
    if (!found.provider) found.provider = provider;
    evidence.push(`${provider}: ${why}`);
  };

  if (env.LINEAR_API_KEY) pick('linear', 'LINEAR_API_KEY is set');
  if (env.JIRA_API_TOKEN || env.JIRA_BASE_URL) {
    pick('jira', `${env.JIRA_API_TOKEN ? 'JIRA_API_TOKEN' : 'JIRA_BASE_URL'} is set`);
    if (env.JIRA_BASE_URL) found.jira.baseUrl = env.JIRA_BASE_URL;
  }
  if (env.GITHUB_TOKEN || env.GH_TOKEN) pick('github', `${env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'GH_TOKEN'} is set`);
  if (env.UNSLOPPED_WEBHOOK_URL) {
    pick('webhook', 'UNSLOPPED_WEBHOOK_URL is set');
    found.webhook.url = env.UNSLOPPED_WEBHOOK_URL;
  }

  const text = HINT_FILES.map((f) => readText(path.join(root, f))).join('\n');
  const jira = [...text.matchAll(/https:\/\/([\w-]+)\.atlassian\.net/g)].find((m) => !PLACEHOLDER_HOSTS.has(m[1].toLowerCase()));
  if (jira) {
    pick('jira', `${jira[1]}.atlassian.net referenced in project files`);
    found.jira.baseUrl ??= `https://${jira[1]}.atlassian.net`;
  }
  if (/linear\.app\//.test(text)) pick('linear', 'linear.app link in project files');

  const repo = githubRepoFromUrl(remoteUrl(root));
  if (repo) {
    pick('github', `git remote origin is github.com/${repo}`);
    found.github.repo = repo;
  }

  for (const n of mcpServerNames(root)) {
    if (n.includes('linear')) pick('linear', `MCP server "${n}" configured`);
    else if (n.includes('jira') || n.includes('atlassian')) pick('jira', `MCP server "${n}" configured`);
    else if (n.includes('github')) pick('github', `MCP server "${n}" configured`);
  }

  return found;
}

export function applyDetection(tracker: TrackerConfig, detected: Detection): TrackerConfig {
  const next: TrackerConfig = { ...tracker, provider: detected.provider };
  if (detected.jira?.baseUrl && !tracker.jira?.baseUrl) next.jira = { ...tracker.jira, baseUrl: detected.jira.baseUrl };
  if (detected.github?.repo && !tracker.github?.repo) next.github = { ...tracker.github, repo: detected.github.repo };
  if (detected.webhook?.url && !tracker.webhook?.url) next.webhook = { ...tracker.webhook, url: detected.webhook.url };
  return next;
}

let ghTokenCache: string | null | undefined;

function ghAuthToken(): string | null {
  if (ghTokenCache === undefined) ghTokenCache = run('gh', ['auth', 'token']) || null;
  return ghTokenCache;
}

export function githubToken(env: Env): string | undefined {
  return env.GITHUB_TOKEN || env.GH_TOKEN || ghAuthToken() || undefined;
}

export function githubRepo(root: string, configured: string | null | undefined, env: Env): string | null {
  return configured ?? env.GITHUB_REPOSITORY ?? githubRepoFromUrl(remoteUrl(root));
}

export function discoverSecrets(config: { tracker?: Partial<TrackerConfig> }, env: Env, root: string): Env {
  const t = config.tracker ?? {};
  if (t.provider !== 'github') return env;
  const next: Env = { ...env };
  if (!next.GITHUB_TOKEN) next.GITHUB_TOKEN = next.GH_TOKEN || ghAuthToken() || undefined;
  if (!next.GITHUB_REPOSITORY && !t.github?.repo) next.GITHUB_REPOSITORY = githubRepoFromUrl(remoteUrl(root)) ?? undefined;
  return next;
}

const NOT_ISSUE_PREFIXES = new Set(['UTF', 'SHA', 'MD', 'RFC', 'ISO', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'AES', 'RSA', 'ES', 'CVE', 'GPT', 'IEEE', 'IPV', 'OAUTH', 'X', 'V', 'PY', 'GO', 'NODE']);

function keyMatch(text: string, caseInsensitive: boolean): string | null {
  const re = caseInsensitive ? /(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9}-\d+)(?![A-Za-z0-9])/g : /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d+)(?![A-Za-z0-9])/g;
  for (const m of text.matchAll(re)) {
    const key = m[1].toUpperCase();
    if (!NOT_ISSUE_PREFIXES.has(key.split('-')[0])) return key;
  }
  return null;
}

export function findIssueRef(text: string | null | undefined, provider: Provider | null = null, { branch = false } = {}): string | null {
  const s = String(text ?? '');
  if (!s) return null;
  const linear = s.match(/linear\.app\/[\w-]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/);
  if (linear) return linear[1].toUpperCase();
  const jira = s.match(/atlassian\.net\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/);
  if (jira) return jira[1].toUpperCase();
  const gh = s.match(/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/);
  if (gh) return `${gh[1]}#${gh[2]}`;

  const key = keyMatch(s, branch);
  const hash = s.match(/(?:^|[\s(\[])#(\d+)\b/);
  const branchNum = branch ? s.match(/(?:^|\/)(?:issue-?|gh-)?(\d+)(?=-)/i) : null;

  if (provider === 'github') return hash ? `#${hash[1]}` : branchNum ? `#${branchNum[1]}` : null;
  if (provider === 'linear' || provider === 'jira') return key;
  return key ?? (hash ? `#${hash[1]}` : branchNum ? `#${branchNum[1]}` : null);
}
