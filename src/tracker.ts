import fs from 'node:fs';
import path from 'node:path';
import { proposalPath } from './state.ts';
import type { Cycle, Env, FetchLike, Issue, Provider, Tracker, TrackerConfig, TrackerEvent, Writer } from './types.ts';

export const PROVIDERS: Provider[] = ['linear', 'jira', 'github', 'webhook'];

export function trackerDefaults(): TrackerConfig {
  return {
    provider: null,
    comments: true,
    transitions: { code: 'In Progress', release: 'In Review', done: 'Done' },
    jira: { baseUrl: null },
    github: { repo: null },
    webhook: { url: null },
  };
}

export function mergeTracker(raw: Partial<TrackerConfig> | undefined = {}): TrackerConfig {
  const d = trackerDefaults();
  return {
    ...d,
    ...raw,
    transitions: raw.transitions ?? d.transitions,
    jira: { ...d.jira, ...(raw.jira ?? {}) },
    github: { ...d.github, ...(raw.github ?? {}) },
    webhook: { ...d.webhook, ...(raw.webhook ?? {}) },
  };
}

export function requiredSettings(tracker: TrackerConfig, env: Env): Array<[string, string | null | undefined]> {
  switch (tracker.provider) {
    case 'linear':
      return [['LINEAR_API_KEY', env.LINEAR_API_KEY]];
    case 'jira':
      return [
        ['JIRA_EMAIL', env.JIRA_EMAIL],
        ['JIRA_API_TOKEN', env.JIRA_API_TOKEN],
        ['tracker.jira.baseUrl or JIRA_BASE_URL', tracker.jira?.baseUrl ?? env.JIRA_BASE_URL],
      ];
    case 'github':
      return [['GITHUB_TOKEN', env.GITHUB_TOKEN]];
    case 'webhook':
      return [['tracker.webhook.url or UNSLOPPED_WEBHOOK_URL', tracker.webhook?.url ?? env.UNSLOPPED_WEBHOOK_URL]];
    default:
      return [];
  }
}

export function missingSettings(tracker: TrackerConfig, env: Env): string[] {
  return requiredSettings(tracker, env).filter(([, v]) => !v).map(([k]) => k);
}

async function request(fetchImpl: FetchLike, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function same(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

type Json = Record<string, any>;

function linear(tracker: TrackerConfig, env: Env, f: FetchLike): Tracker {
  const gql = async (query: string, variables: Json): Promise<Json> => {
    const data = (await request(f, 'https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: env.LINEAR_API_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })) as Json;
    if (data.errors?.length) throw new Error(data.errors.map((e: Json) => e.message).join('; '));
    return data.data;
  };
  return {
    name: 'linear',
    async fetchIssue(ref) {
      const d = await gql('query($id: String!) { issue(id: $id) { id identifier title description url updatedAt state { name } } }', { id: ref });
      const i = d.issue;
      return { id: i.id, key: i.identifier, title: i.title, description: i.description ?? '', url: i.url, state: i.state?.name ?? null, updatedAt: i.updatedAt ?? null };
    },
    async comment(issue, body) {
      await gql('mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }', { input: { issueId: issue.id, body } });
    },
    async transition(issue, stateName) {
      const d = await gql('query($id: String!) { issue(id: $id) { team { states { nodes { id name } } } } }', { id: issue.id });
      const s = d.issue.team.states.nodes.find((n: Json) => same(n.name, stateName));
      if (!s) throw new Error(`no Linear workflow state named "${stateName}"`);
      await gql('mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issue.id, input: { stateId: s.id } });
    },
  };
}

export function adfText(node: Json | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  const inner = ((node.content ?? []) as Json[]).map(adfText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type) ? inner + '\n' : inner;
}

function jira(tracker: TrackerConfig, env: Env, f: FetchLike): Tracker {
  const base = (tracker.jira.baseUrl ?? env.JIRA_BASE_URL ?? '').replace(/\/+$/, '');
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64'),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const issueUrl = (key: string) => `${base}/rest/api/3/issue/${encodeURIComponent(key)}`;
  return {
    name: 'jira',
    async fetchIssue(ref) {
      const d = (await request(f, `${issueUrl(ref)}?fields=summary,description,status,updated`, { headers })) as Json;
      return { id: d.id, key: d.key, title: d.fields.summary, description: adfText(d.fields.description).trim(), url: `${base}/browse/${d.key}`, state: d.fields.status?.name ?? null, updatedAt: d.fields.updated ?? null };
    },
    async comment(issue, body) {
      const doc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] };
      await request(f, `${issueUrl(issue.key)}/comment`, { method: 'POST', headers, body: JSON.stringify({ body: doc }) });
    },
    async transition(issue, stateName) {
      const d = (await request(f, `${issueUrl(issue.key)}/transitions`, { headers })) as Json;
      const t = ((d.transitions ?? []) as Json[]).find((x) => same(x.name, stateName) || same(x.to?.name, stateName));
      if (!t) throw new Error(`no Jira transition to "${stateName}" from the current status`);
      await request(f, `${issueUrl(issue.key)}/transitions`, { method: 'POST', headers, body: JSON.stringify({ transition: { id: t.id } }) });
    },
  };
}

export function parseGithubRef(ref: string, defaultRepo: string | null | undefined): { repo: string; number: number } {
  const m = String(ref).match(/^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/);
  if (!m) throw new Error(`cannot parse GitHub issue "${ref}". use 12, #12 or owner/repo#12`);
  const repo = m[1] ?? defaultRepo;
  if (!repo) throw new Error('set tracker.github.repo or GITHUB_REPOSITORY, or use owner/repo#12');
  return { repo, number: Number(m[2]) };
}

function github(tracker: TrackerConfig, env: Env, f: FetchLike): Tracker {
  const api = 'https://api.github.com';
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'unslopped',
    'Content-Type': 'application/json',
  };
  return {
    name: 'github',
    async fetchIssue(ref) {
      const { repo, number } = parseGithubRef(ref, tracker.github.repo ?? env.GITHUB_REPOSITORY);
      const d = (await request(f, `${api}/repos/${repo}/issues/${number}`, { headers })) as Json;
      return { id: String(d.id), key: `${repo}#${number}`, title: d.title, description: d.body ?? '', url: d.html_url, state: d.state, updatedAt: d.updated_at ?? null, repo, number };
    },
    async comment(issue, body) {
      await request(f, `${api}/repos/${issue.repo}/issues/${issue.number}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
    },
    async transition(issue, stateName) {
      if (same(stateName, 'closed') || same(stateName, 'done')) {
        await request(f, `${api}/repos/${issue.repo}/issues/${issue.number}`, { method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }) });
        return;
      }
      await request(f, `${api}/repos/${issue.repo}/issues/${issue.number}/labels`, { method: 'POST', headers, body: JSON.stringify({ labels: [stateName] }) });
    },
  };
}

function webhook(tracker: TrackerConfig, env: Env, f: FetchLike): Tracker {
  const url = tracker.webhook.url ?? env.UNSLOPPED_WEBHOOK_URL ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.UNSLOPPED_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${env.UNSLOPPED_WEBHOOK_TOKEN}`;
  const post = (payload: unknown) => request(f, url, { method: 'POST', headers, body: JSON.stringify(payload) });
  return {
    name: 'webhook',
    async fetchIssue(ref) {
      return { id: ref, key: ref, title: ref, description: '', url: null, state: null };
    },
    async comment(issue, body) {
      await post({ event: 'comment', issue, body });
    },
    async transition(issue, stateName) {
      await post({ event: 'transition', issue, state: stateName });
    },
  };
}

const FACTORIES: Record<Provider, (t: TrackerConfig, env: Env, f: FetchLike) => Tracker> = { linear, jira, github, webhook };

export function createTracker(config: { tracker?: Partial<TrackerConfig> }, env: Env = process.env, fetchImpl: FetchLike = globalThis.fetch as FetchLike): Tracker | null {
  const t = mergeTracker(config.tracker);
  if (!t.provider) return null;
  const factory = FACTORIES[t.provider];
  if (!factory) throw new Error(`unknown tracker provider "${t.provider}". valid: ${PROVIDERS.join(', ')}`);
  const missing = missingSettings(t, env);
  if (missing.length) throw new Error(`tracker ${t.provider}: missing ${missing.join(', ')}`);
  return factory(t, env, fetchImpl);
}

export function eventMessage(cycle: Cycle, event: TrackerEvent): string {
  switch (event.type) {
    case 'started':
      return `unslopped cycle ${cycle.id} started: ${cycle.goal}`;
    case 'advanced':
      return `unslopped cycle ${cycle.id}: ${event.from} gate passed, now in ${event.to}`;
    case 'complete':
      return `unslopped cycle ${cycle.id} complete after ${cycle.history.length} gate run(s)`;
    case 'abandoned':
      return `unslopped cycle ${cycle.id} abandoned in phase ${cycle.phase}`;
  }
}

export interface NotifyArgs {
  root: string;
  config: { tracker?: Partial<TrackerConfig>; posting?: 'auto' | 'draft' };
  cycle: Cycle;
  event: TrackerEvent;
  io: Writer;
  env?: Env;
  fetchImpl?: FetchLike;
}

export function draftTracker(root: string, cycle: Cycle, message: string, target: string | null): string {
  const file = proposalPath(root, 'tracker');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = [`## ${cycle.issue?.key ?? cycle.id} at ${new Date().toISOString()}`, target ? `Move to: ${target}` : 'Move to: no change', '', message, ''].join('\n');
  fs.appendFileSync(file, (fs.existsSync(file) ? '\n' : '') + entry);
  return `tracker text drafted, post it yourself: ${path.relative(root, file).replace(/\\/g, '/')}`;
}

export async function notifyTracker({ root, config, cycle, event, io, env = process.env, fetchImpl = globalThis.fetch as FetchLike }: NotifyArgs): Promise<void> {
  if (!cycle.issue) return;
  const t = mergeTracker(config.tracker);
  let tracker: Tracker | null;
  try {
    tracker = createTracker(config, env, fetchImpl);
  } catch (e) {
    io.write(`WARN tracker: ${(e as Error).message}\n`);
    return;
  }
  if (!tracker) return;
  const target = event.type === 'complete' ? t.transitions.done : event.type === 'advanced' || event.type === 'started' ? t.transitions[event.to] : null;
  if (config.posting === 'draft') {
    io.write(draftTracker(root, cycle, eventMessage(cycle, event), target) + '\n');
    return;
  }
  try {
    if (t.comments) await tracker.comment(cycle.issue, eventMessage(cycle, event));
    if (target) await tracker.transition(cycle.issue, target);
  } catch (e) {
    io.write(`WARN tracker: ${(e as Error).message}\n`);
  }
}
