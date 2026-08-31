import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, formatDuration, metricsLines } from '../src/metrics.ts';
import type { Cycle, HistoryEntry, Phase } from '../src/types.ts';

function entry(phase: Phase, pass: boolean, at: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { phase, pass, at, advanced: pass, checks: [], ...extra };
}

function cycle(id: string, startedAt: string, endedAt: string | undefined, status: string | undefined, history: HistoryEntry[]): Cycle {
  return { id, goal: id, phase: 'monitor', startedAt, endedAt, status, startCommit: null, configHash: 'h', issue: null, approvals: {}, history };
}

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 1, h, m)).toISOString();

test('metrics cover lead time, deployments, change failures, recovery, first pass', () => {
  const good = cycle('a', T(9), T(11), 'complete', [
    entry('plan', false, T(9, 5)),
    entry('plan', true, T(9, 10)),
    entry('code', true, T(9, 30)),
    entry('build', true, T(9, 40)),
    entry('test', true, T(9, 50)),
    entry('release', true, T(10)),
    entry('deploy', true, T(10, 10)),
    entry('operate', true, T(10, 20)),
    entry('monitor', true, T(11)),
  ]);
  const bad = cycle('b', T(12), T(15), 'complete', [
    entry('plan', true, T(12, 5)),
    entry('code', true, T(12, 30)),
    entry('build', true, T(12, 40)),
    entry('test', false, T(12, 50)),
    entry('test', true, T(13)),
    entry('release', true, T(13, 10)),
    entry('deploy', true, T(13, 20)),
    entry('operate', false, T(13, 30)),
    { ...entry('operate', false, T(13, 45), { advanced: false }), checks: [{ name: 'rollback', ok: true, detail: 'undo' }] },
    entry('operate', true, T(14)),
    entry('monitor', true, T(15)),
  ]);
  const dropped = cycle('c', T(16), T(16, 30), 'abandoned', [entry('plan', false, T(16, 10))]);
  const live = cycle('d', T(17), undefined, undefined, [entry('plan', true, T(17, 5))]);

  const m = computeMetrics([good, bad, dropped, live]);
  assert.equal(m.cycles, 4);
  assert.equal(m.completed, 2);
  assert.equal(m.abandoned, 1);
  assert.equal(m.active, 1);
  assert.equal(m.leadTimeMedianMs, 2.5 * 3600 * 1000);
  assert.equal(m.deployments, 2);
  assert.equal(m.deploymentsPerWeek, 2);
  assert.equal(m.changeFailures, 1);
  assert.equal(m.changeFailureRate, 0.5);
  assert.equal(m.rollbacks, 1);
  assert.equal(m.mttrMedianMs, 15 * 60 * 1000);
  assert.equal(m.gateRuns, 21);
  assert.equal(m.gateFailures, 4);
  assert.deepEqual(m.firstPass.plan, { passed: 2, reached: 4 });
  assert.deepEqual(m.firstPass.test, { passed: 1, reached: 2 });
  assert.deepEqual(m.failuresByPhase, { plan: 2, test: 1, operate: 1 });

  const lines = metricsLines(m);
  assert.match(lines[0], /2 completed, 1 abandoned, 1 active/);
  assert.match(lines[1], /median 2h 30m/);
  assert.match(lines[3], /change failure 50% \(1 of 2 deploys/);
  assert.match(lines[4], /median 15m .* 1 rollback\(s\)/);
  assert.match(lines[6], /plan 50%\s+code 100%/);
  assert.match(lines[7], /plan 2, test 1, operate 1/);
});

test('metrics handle an empty history, format durations', () => {
  const m = computeMetrics([]);
  assert.equal(m.leadTimeMedianMs, null);
  assert.equal(m.changeFailureRate, null);
  assert.equal(m.deploymentsPerWeek, null);
  assert.match(metricsLines(m)[1], /median n\/a/);
  assert.equal(formatDuration(null), 'n/a');
  assert.equal(formatDuration(30 * 1000), '30s');
  assert.equal(formatDuration(45 * 60 * 1000), '45m');
  assert.equal(formatDuration(26 * 3600 * 1000), '1d 2h');
});
