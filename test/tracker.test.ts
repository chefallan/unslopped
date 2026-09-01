import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, notifyTracker, missingSettings, mergeTracker, parseGithubRef, adfText, eventMessage } from '../src/tracker.ts';

function fakeFetch(responses) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const r = responses.shift() ?? { status: 200, body: {} };
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  };
  return { f, calls };
}

function config(tracker) {
  return { tracker: mergeTracker(tracker) };
}

test('createTracker returns null without a provider, rejects unknown ones', () => {
  assert.equal(createTracker(config({}), {}), null);
  assert.throws(() => createTracker(config({ provider: 'trello' }), {}), /unknown tracker provider/);
});

test('missing credentials are named', () => {
  assert.deepEqual(missingSettings(mergeTracker({ provider: 'linear' }), {}), ['LINEAR_API_KEY']);
  assert.deepEqual(missingSettings(mergeTracker({ provider: 'jira' }), { JIRA_EMAIL: 'e' }), ['JIRA_API_TOKEN', 'tracker.jira.baseUrl or JIRA_BASE_URL']);
  assert.deepEqual(missingSettings(mergeTracker({ provider: 'jira', jira: { baseUrl: 'https://x.atlassian.net' } }), { JIRA_EMAIL: 'e', JIRA_API_TOKEN: 't' }), []);
  assert.throws(() => createTracker(config({ provider: 'github' }), {}), /missing GITHUB_TOKEN/);
});

test('linear fetches by identifier, comments, transitions by state name', async () => {
  const { f, calls } = fakeFetch([
    { status: 200, body: { data: { issue: { id: 'uuid-1', identifier: 'ENG-7', title: 'Add health', description: 'Return 200', url: 'https://linear.app/x/ENG-7', state: { name: 'Todo' } } } } },
    { status: 200, body: { data: { commentCreate: { success: true } } } },
    { status: 200, body: { data: { issue: { team: { states: { nodes: [{ id: 's1', name: 'Todo' }, { id: 's2', name: 'In Progress' }] } } } } } },
    { status: 200, body: { data: { issueUpdate: { success: true } } } },
  ]);
  const t = createTracker(config({ provider: 'linear' }), { LINEAR_API_KEY: 'lin_key' }, f);
  const issue = await t.fetchIssue('ENG-7');
  assert.equal(issue.id, 'uuid-1');
  assert.equal(issue.key, 'ENG-7');
  assert.equal(issue.description, 'Return 200');
  assert.equal(calls[0].headers.Authorization, 'lin_key');
  assert.equal(calls[0].body.variables.id, 'ENG-7');
  await t.comment(issue, 'hello');
  assert.deepEqual(calls[1].body.variables.input, { issueId: 'uuid-1', body: 'hello' });
  await t.transition(issue, 'in progress');
  assert.deepEqual(calls[3].body.variables, { id: 'uuid-1', input: { stateId: 's2' } });
});

test('linear surfaces graphql errors', async () => {
  const { f } = fakeFetch([{ status: 200, body: { errors: [{ message: 'Entity not found' }] } }]);
  const t = createTracker(config({ provider: 'linear' }), { LINEAR_API_KEY: 'k' }, f);
  await assert.rejects(() => t.fetchIssue('ENG-404'), /Entity not found/);
});

test('jira uses basic auth, flattens ADF, picks transitions by target status', async () => {
  const { f, calls } = fakeFetch([
    { status: 200, body: { id: '10001', key: 'PROJ-3', fields: { summary: 'Fix login', status: { name: 'To Do' }, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Users ' }, { type: 'text', text: 'cannot log in' }] }] } } } },
    { status: 201, body: { id: 'c1' } },
    { status: 200, body: { transitions: [{ id: '11', name: 'Start progress', to: { name: 'In Progress' } }, { id: '31', name: 'Done', to: { name: 'Done' } }] } },
    { status: 204, body: undefined },
  ]);
  const env = { JIRA_EMAIL: 'me@x.io', JIRA_API_TOKEN: 'tok', JIRA_BASE_URL: 'https://x.atlassian.net/' };
  const t = createTracker(config({ provider: 'jira' }), env, f);
  const issue = await t.fetchIssue('PROJ-3');
  assert.equal(issue.title, 'Fix login');
  assert.equal(issue.description, 'Users cannot log in');
  assert.equal(issue.url, 'https://x.atlassian.net/browse/PROJ-3');
  assert.equal(calls[0].url, 'https://x.atlassian.net/rest/api/3/issue/PROJ-3?fields=summary,description,status,updated');
  assert.equal(calls[0].headers.Authorization, 'Basic ' + Buffer.from('me@x.io:tok').toString('base64'));
  await t.comment(issue, 'note');
  assert.equal(calls[1].url, 'https://x.atlassian.net/rest/api/3/issue/PROJ-3/comment');
  assert.equal(calls[1].body.body.content[0].content[0].text, 'note');
  await t.transition(issue, 'In Progress');
  assert.equal(calls[3].method, 'POST');
  assert.deepEqual(calls[3].body, { transition: { id: '11' } });
});

test('jira reports a missing transition, http errors', async () => {
  const { f } = fakeFetch([
    { status: 200, body: { transitions: [{ id: '31', name: 'Done', to: { name: 'Done' } }] } },
    { status: 401, body: { errorMessages: ['Unauthorized'] } },
  ]);
  const t = createTracker(config({ provider: 'jira', jira: { baseUrl: 'https://x.atlassian.net' } }), { JIRA_EMAIL: 'e', JIRA_API_TOKEN: 't' }, f);
  await assert.rejects(() => t.transition({ key: 'P-1' }, 'In Review'), /no Jira transition to "In Review"/);
  await assert.rejects(() => t.fetchIssue('P-1'), /401/);
});

test('adfText flattens nested nodes', () => {
  const doc = { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'H' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] }] };
  assert.equal(adfText(doc).trim(), 'H\na');
  assert.equal(adfText(null), '');
});

test('github parses refs, comments, labels, closes', async () => {
  assert.deepEqual(parseGithubRef('#12', 'o/r'), { repo: 'o/r', number: 12 });
  assert.deepEqual(parseGithubRef('a/b#3', 'o/r'), { repo: 'a/b', number: 3 });
  assert.throws(() => parseGithubRef('12', null), /tracker.github.repo/);
  assert.throws(() => parseGithubRef('ENG-1', 'o/r'), /cannot parse/);
  const { f, calls } = fakeFetch([
    { status: 200, body: { id: 99, number: 12, title: 'Bug', body: 'It breaks', html_url: 'https://github.com/o/r/issues/12', state: 'open' } },
    { status: 201, body: {} },
    { status: 200, body: [] },
    { status: 200, body: {} },
  ]);
  const t = createTracker(config({ provider: 'github', github: { repo: 'o/r' } }), { GITHUB_TOKEN: 'ghp' }, f);
  const issue = await t.fetchIssue('12');
  assert.equal(issue.key, 'o/r#12');
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/issues/12');
  assert.equal(calls[0].headers.Authorization, 'Bearer ghp');
  assert.ok(calls[0].headers['User-Agent']);
  await t.comment(issue, 'c');
  assert.equal(calls[1].url, 'https://api.github.com/repos/o/r/issues/12/comments');
  await t.transition(issue, 'In Progress');
  assert.equal(calls[2].url, 'https://api.github.com/repos/o/r/issues/12/labels');
  assert.deepEqual(calls[2].body, { labels: ['In Progress'] });
  await t.transition(issue, 'Done');
  assert.equal(calls[3].method, 'PATCH');
  assert.deepEqual(calls[3].body, { state: 'closed' });
});

test('webhook posts events, needs no fetch for issues', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
  const t = createTracker(config({ provider: 'webhook', webhook: { url: 'https://hook.example/x' } }), { UNSLOPPED_WEBHOOK_TOKEN: 's3' }, f);
  const issue = await t.fetchIssue('ABC-1');
  assert.equal(issue.key, 'ABC-1');
  assert.equal(calls.length, 0);
  await t.comment(issue, 'm');
  assert.equal(calls[0].headers.Authorization, 'Bearer s3');
  assert.equal(calls[0].body.event, 'comment');
  await t.transition(issue, 'Done');
  assert.deepEqual(calls[1].body, { event: 'transition', issue, state: 'Done' });
});

test('notifyTracker comments, transitions on mapped phases, never throws', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }, { status: 500, body: { err: 1 } }]);
  const cfg = config({ provider: 'webhook', webhook: { url: 'https://hook' } });
  const cycle = { id: 'c1', goal: 'g', phase: 'code', history: [], issue: { key: 'ABC-1' } };
  let log = '';
  const io = { write: (s) => (log += s) };
  await notifyTracker({ config: cfg, cycle, event: { type: 'advanced', from: 'plan', to: 'code' }, io, env: {}, fetchImpl: f });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.body, eventMessage(cycle, { type: 'advanced', from: 'plan', to: 'code' }));
  assert.equal(calls[1].body.state, 'In Progress');
  await notifyTracker({ config: cfg, cycle, event: { type: 'advanced', from: 'code', to: 'build' }, io, env: {}, fetchImpl: f });
  assert.equal(calls.length, 3);
  await notifyTracker({ config: cfg, cycle, event: { type: 'complete' }, io, env: {}, fetchImpl: f });
  assert.match(log, /WARN tracker: POST https:\/\/hook -> 500/);
  await notifyTracker({ config: cfg, cycle: { ...cycle, issue: null }, event: { type: 'complete' }, io, env: {}, fetchImpl: f });
  assert.equal(calls.length, 4);
  await notifyTracker({ config: config({ provider: 'linear' }), cycle, event: { type: 'complete' }, io, env: {}, fetchImpl: f });
  assert.match(log, /missing LINEAR_API_KEY/);
});

test('comments can be turned off while transitions stay on', async () => {
  const { f, calls } = fakeFetch([{ status: 200, body: {} }]);
  const cfg = config({ provider: 'webhook', comments: false, webhook: { url: 'https://hook' }, transitions: { done: 'Closed' } });
  const cycle = { id: 'c1', goal: 'g', phase: 'monitor', history: [], issue: { key: 'A-1' } };
  await notifyTracker({ config: cfg, cycle, event: { type: 'complete' }, io: { write() {} }, env: {}, fetchImpl: f });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.state, 'Closed');
});
