import type { Cycle, Env, FetchLike, Finding } from './types.ts';
import { planSection, criteriaItems } from './practices.ts';

export interface GithubClient {
  repo: string;
  owner: string;
  request<T>(method: string, apiPath: string, body?: unknown, accept?: string): Promise<T>;
  text(apiPath: string, accept: string): Promise<string>;
}

export function githubApiBase(env: Env): string {
  return (env.UNSLOPPED_GITHUB_API ?? 'https://api.github.com').replace(/\/+$/, '');
}

export function githubClient(repo: string, token: string, env: Env, fetchImpl: FetchLike): GithubClient {
  const base = githubApiBase(env);
  const headers = (accept: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'User-Agent': 'unslopped',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  });
  async function raw(method: string, apiPath: string, body: unknown, accept: string): Promise<string> {
    const res = await fetchImpl(`${base}${apiPath}`, { method, headers: headers(accept), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`GitHub ${method} ${apiPath} -> ${res.status} ${text.slice(0, 300)}`);
    return text;
  }
  return {
    repo,
    owner: repo.split('/')[0],
    async request<T>(method: string, apiPath: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<T> {
      const text = await raw(method, apiPath, body, accept);
      return (text ? JSON.parse(text) : null) as T;
    },
    text(apiPath: string, accept: string): Promise<string> {
      return raw('GET', apiPath, undefined, accept);
    },
  };
}

export interface PullRequest {
  number: number;
  html_url: string;
  title: string;
  state: string;
  merged: boolean;
  merged_at: string | null;
  draft: boolean;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  body: string | null;
}

export interface PrFile {
  filename: string;
  patch?: string;
}

export async function defaultBranch(c: GithubClient): Promise<string> {
  const r = await c.request<{ default_branch: string }>('GET', `/repos/${c.repo}`);
  return r.default_branch;
}

export async function findOpenPr(c: GithubClient, head: string): Promise<PullRequest | null> {
  const list = await c.request<PullRequest[]>('GET', `/repos/${c.repo}/pulls?state=open&head=${encodeURIComponent(`${c.owner}:${head}`)}`);
  return list[0] ?? null;
}

export async function createPr(c: GithubClient, input: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<PullRequest> {
  return c.request<PullRequest>('POST', `/repos/${c.repo}/pulls`, input);
}

export async function getPr(c: GithubClient, number: number): Promise<PullRequest> {
  return c.request<PullRequest>('GET', `/repos/${c.repo}/pulls/${number}`);
}

export async function getPrDiff(c: GithubClient, number: number): Promise<string> {
  return c.text(`/repos/${c.repo}/pulls/${number}`, 'application/vnd.github.diff');
}

export async function getPrFiles(c: GithubClient, number: number): Promise<PrFile[]> {
  const out: PrFile[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await c.request<PrFile[]>('GET', `/repos/${c.repo}/pulls/${number}/files?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

export interface ReviewInput {
  commit_id: string;
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments: ReviewComment[];
}

export async function createReview(c: GithubClient, number: number, review: ReviewInput): Promise<{ id: number; html_url: string }> {
  return c.request<{ id: number; html_url: string }>('POST', `/repos/${c.repo}/pulls/${number}/reviews`, review);
}

export function rightSideLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;
  let current = 0;
  for (const raw of patch.split(/\r?\n/)) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      current = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('-')) continue;
    if (raw.startsWith('+') || raw.startsWith(' ') || raw === '') {
      if (raw.startsWith('\\')) continue;
      lines.add(current);
      current++;
    }
  }
  return lines;
}

const SEVERITY_LABEL: Record<Finding['severity'], string> = { critical: 'Must fix', major: 'Worth fixing', minor: 'Minor' };

function saidInWords(counts: Record<'critical' | 'major' | 'minor', number>): string {
  const parts: string[] = [];
  if (counts.critical) parts.push(`${counts.critical} must be fixed before merge`);
  if (counts.major) parts.push(`${counts.major} worth fixing`);
  if (counts.minor) parts.push(`${counts.minor} small note${counts.minor > 1 ? 's' : ''}`);
  return parts.join(', ') + '.';
}

export function reviewPayload(findings: Finding[], allowed: Map<string, Set<number>>, { approve = false, header = 'Unslopped review' } = {}): Omit<ReviewInput, 'commit_id'> {
  const comments: ReviewComment[] = [];
  const rest: Finding[] = [];
  for (const f of findings) {
    if (f.file && f.line && allowed.get(f.file)?.has(f.line)) comments.push({ path: f.file, line: f.line, side: 'RIGHT', body: `**${SEVERITY_LABEL[f.severity]}**: ${f.text}` });
    else rest.push(f);
  }
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  const lines = [header, ''];
  if (!findings.length) {
    lines.push('Nothing to flag. Looks good.');
  } else {
    lines.push(saidInWords(counts));
    if (comments.length) lines.push(comments.length === 1 ? 'The comment sits on the line it talks about.' : `${comments.length} comments sit on the lines they talk about.`);
  }
  if (rest.length) {
    lines.push('');
    for (const f of rest) lines.push(`- ${SEVERITY_LABEL[f.severity]}: ${f.text}`);
  }
  const event: ReviewInput['event'] = counts.critical ? 'REQUEST_CHANGES' : approve && !counts.major ? 'APPROVE' : 'COMMENT';
  return { body: lines.join('\n'), event, comments };
}

function mostCommon(values: Array<string | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) {
    if (c > n) {
      best = v;
      n = c;
    }
  }
  return best;
}

export interface TitleOptions {
  conventional?: boolean;
  subjects?: string[];
  area?: string | null;
}

export function prTitle(cycle: Cycle, opts: TitleOptions = {}): string {
  const clamp = (t: string) => (t.length > 72 ? t.slice(0, 69).trimEnd() + '...' : t);
  if (opts.conventional) {
    const parsed = (opts.subjects ?? []).map((s) => s.match(/^(\w+)(?:\(([^)]+)\))?!?:/)).filter((m): m is RegExpMatchArray => Boolean(m));
    const type = mostCommon(parsed.map((m) => m[1])) ?? 'feat';
    const scope = mostCommon(parsed.map((m) => m[2])) ?? opts.area ?? null;
    const stripped = cycle.issue?.key ? cycle.goal.replace(cycle.issue.key, '').replace(/\s{2,}/g, ' ').trim() : cycle.goal;
    const text = stripped || cycle.goal;
    const subject = text.charAt(0).toLowerCase() + text.slice(1);
    return clamp(`${type}${scope ? `(${scope})` : ''}: ${subject}`);
  }
  const key = cycle.issue?.key ? `${cycle.issue.key}: ` : '';
  return clamp(`${key}${cycle.goal}`);
}

export function prBody(cycle: Cycle, plan: string, repo: string, reviewFocus: string[] = []): string {
  const parts: string[] = [];
  const goal = planSection(plan, 'Goal');
  const approach = planSection(plan, 'Approach');
  const criteria = criteriaItems(plan);
  parts.push('## Why', goal || cycle.goal, '');
  parts.push('## What changed');
  if (approach) parts.push(approach, '');
  if (criteria.length) parts.push('Behavior after merge, each point verified by a test:', ...criteria.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`), '');
  if (reviewFocus.length) parts.push('## Review focus', ...reviewFocus, '');
  if (cycle.issue) {
    const key = cycle.issue.key;
    const sameRepo = key.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    if (sameRepo && sameRepo[1] === repo) parts.push(`Closes #${sameRepo[2]}`);
    else parts.push(`Issue: ${key}${cycle.issue.url ? ` (${cycle.issue.url})` : ''}`);
    parts.push('');
  }
  const runs = cycle.history.length;
  const failed = cycle.history.filter((h) => !h.pass).length;
  const review = cycle.review ? `, review: ${cycle.review.critical} critical / ${cycle.review.major} major / ${cycle.review.minor} minor` : '';
  parts.push(`Unslopped cycle ${cycle.id}: ${runs} gate run(s), ${failed} failed${review}.`);
  return parts.join('\n').trim() + '\n';
}
