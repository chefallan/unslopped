import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rightSideLines, reviewPayload, prBody, prTitle, githubClient, createPr, findOpenPr } from '../src/github.ts';
import { parseFindings } from '../src/practices.ts';
import type { Cycle } from '../src/types.ts';

function cycle(extra: Partial<Cycle> = {}): Cycle {
  return { id: 'c1', goal: 'Add health endpoint', phase: 'release', startedAt: 'now', startCommit: null, configHash: 'h', issue: null, approvals: {}, history: [{ phase: 'plan', at: 'a', pass: false, advanced: false, checks: [] }, { phase: 'plan', at: 'b', pass: true, advanced: true, checks: [] }], ...extra };
}

test('parseFindings extracts severity, file:line', () => {
  const f = parseFindings('- [critical] SQL injection in src/db.js:12 via string concat\n- [major]: no timeout (see lib/net.ts:40)\n- [minor] rename foo\n');
  assert.deepEqual(f[0], { severity: 'critical', text: 'SQL injection in src/db.js:12 via string concat', file: 'src/db.js', line: 12 });
  assert.equal(f[1].file, 'lib/net.ts');
  assert.equal(f[1].line, 40);
  assert.equal(f[2].file, undefined);
});

test('rightSideLines maps a patch to commentable line numbers', () => {
  const patch = '@@ -1,3 +1,4 @@\n a\n-b\n+B\n+C\n d\n@@ -10,2 +11,2 @@\n x\n-y\n+Y';
  const lines = rightSideLines(patch);
  assert.deepEqual([...lines].sort((a, b) => a - b), [1, 2, 3, 4, 11, 12]);
  assert.equal(rightSideLines(undefined).size, 0);
});

test('reviewPayload places findings inline when the line is in the diff, picks the event', () => {
  const allowed = new Map([['src/db.js', new Set([10, 11, 12])]]);
  const findings = parseFindings('- [critical] concat in src/db.js:12\n- [major] slow query in src/db.js:99\n- [minor] typo');
  const p = reviewPayload(findings, allowed, { header: 'R' });
  assert.equal(p.event, 'REQUEST_CHANGES');
  assert.equal(p.comments.length, 1);
  assert.deepEqual(p.comments[0], { path: 'src/db.js', line: 12, side: 'RIGHT', body: '**Must fix**: concat in src/db.js:12' });
  assert.match(p.body, /1 must be fixed before merge, 1 worth fixing, 1 small note\./);
  assert.match(p.body, /The comment sits on the line it talks about\./);
  assert.match(p.body, /- Worth fixing: slow query/);
  assert.match(p.body, /- Minor: typo/);
  assert.doesNotMatch(p.body, /placed inline|\[major\]|\[minor\]/);
  assert.equal(reviewPayload(parseFindings('- [minor] x'), allowed, { approve: true }).event, 'APPROVE');
  assert.equal(reviewPayload(parseFindings('- [major] x'), allowed, { approve: true }).event, 'COMMENT');
  assert.equal(reviewPayload([], allowed).event, 'COMMENT');
  assert.match(reviewPayload([], allowed).body, /Nothing to flag\. Looks good\./);
});

test('PR title, body come from the cycle, the plan', () => {
  const plan = '# g\n\n## Goal\nExpose /health\n\n## Approach\nOne module\n\n## Acceptance criteria\n- [x] returns 200\n- [ ] logs\n\n## Monitor\n';
  const c = cycle({ issue: { key: 'acme/app#12', title: 't', description: '', url: 'https://github.com/acme/app/issues/12' } });
  assert.equal(prTitle(c), 'acme/app#12: Add health endpoint');
  const body = prBody(c, plan, 'acme/app');
  assert.match(body, /## Why\nExpose \/health/);
  assert.match(body, /## What changed\nOne module/);
  assert.match(body, /Behavior after merge, each point verified by a test:\n- \[x\] returns 200\n- \[ \] logs/);
  assert.match(body, /Closes #12/);
  assert.match(body, /2 gate run\(s\), 1 failed/);
  assert.doesNotMatch(body, /## Review focus/);
  const linear = prBody(cycle({ issue: { key: 'ENG-7', title: 't', description: '', url: 'https://linear.app/x/ENG-7' } }), plan, 'acme/app');
  assert.match(linear, /Issue: ENG-7 \(https:\/\/linear\.app\/x\/ENG-7\)/);
  assert.equal(prTitle(cycle({ goal: 'x'.repeat(100) })).length, 72);

  const focused = prBody(c, plan, 'acme/app', ['Decisions a reviewer could reasonably push back on:', '- kept offset paging', 'Indexes: none']);
  assert.match(focused, /## Review focus\nDecisions a reviewer could reasonably push back on:\n- kept offset paging\nIndexes: none\n\nCloses #12/);
  const bare = prBody(cycle({ goal: 'Tidy the docs' }), '', 'acme/app');
  assert.match(bare, /## Why\nTidy the docs\n\n## What changed/);
});

test('a conventional PR title is derived from the cycle commits, the touched area', () => {
  const c = cycle({ goal: 'Add health endpoint ENG-7', issue: { key: 'ENG-7', title: 't', description: '', url: null } });
  assert.equal(prTitle(c, { conventional: true, subjects: ['feat(api): add route', 'feat(api): wire probe', 'test(api): cover 200'], area: 'src' }), 'feat(api): add health endpoint');
  assert.equal(prTitle(c, { conventional: true, subjects: ['chore: tidy'], area: 'ops' }), 'chore(ops): add health endpoint');
  assert.equal(prTitle(c, { conventional: true, subjects: [], area: null }), 'feat: add health endpoint');
  assert.equal(prTitle(cycle({ goal: 'Rework ' + 'y'.repeat(80) }), { conventional: true, subjects: [], area: 'core' }).length, 72);
});

test('githubClient sends auth headers, hits the right endpoints', async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const f = async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const body = url.includes('state=open') ? [] : { number: 5, html_url: 'https://github.com/o/r/pull/5', head: { ref: 'f', sha: 's' }, base: { ref: 'main', sha: 'b' }, state: 'open', merged: false, merged_at: null, draft: false, title: 't', body: '' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const c = githubClient('o/r', 'tok', { UNSLOPPED_GITHUB_API: 'https://api.example/' }, f as any);
  assert.equal(await findOpenPr(c, 'feat'), null);
  assert.equal(calls[0].url, 'https://api.example/repos/o/r/pulls?state=open&head=o%3Afeat');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  const pr = await createPr(c, { head: 'feat', base: 'main', title: 't', body: 'b', draft: false });
  assert.equal(pr.number, 5);
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(calls[1].body, { head: 'feat', base: 'main', title: 't', body: 'b', draft: false });
  const bad = githubClient('o/r', 'tok', {}, (async () => ({ ok: false, status: 404, text: async () => 'nope' })) as any);
  await assert.rejects(() => findOpenPr(bad, 'x'), /GitHub GET \/repos\/o\/r\/pulls.* -> 404 nope/);
});
