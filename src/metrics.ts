import { PHASES } from './phases.ts';
import type { Cycle, Phase } from './types.ts';

export interface Metrics {
  cycles: number;
  completed: number;
  abandoned: number;
  active: number;
  leadTimeMedianMs: number | null;
  leadTimeMeanMs: number | null;
  deployments: number;
  deploymentsPerWeek: number | null;
  changeFailures: number;
  changeFailureRate: number | null;
  rollbacks: number;
  mttrMedianMs: number | null;
  gateRuns: number;
  gateFailures: number;
  firstPass: Partial<Record<Phase, { passed: number; reached: number }>>;
  failuresByPhase: Partial<Record<Phase, number>>;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function ms(iso: string | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

function deployedAt(cycle: Cycle): number | null {
  const entry = cycle.history.find((h) => h.phase === 'deploy' && h.pass && h.advanced);
  return entry ? ms(entry.at) : null;
}

function hadChangeFailure(cycle: Cycle): boolean {
  return cycle.history.some((h) => (h.phase === 'operate' && !h.pass) || h.checks.some((c) => c.name === 'rollback'));
}

function recoveryMs(cycle: Cycle): number | null {
  const firstFail = cycle.history.find((h) => h.phase === 'operate' && !h.pass);
  if (!firstFail) return null;
  const start = ms(firstFail.at);
  const fixed = cycle.history.find((h) => Date.parse(h.at) > (start ?? 0) && ((h.phase === 'operate' && h.pass) || h.checks.some((c) => c.name === 'rollback' && c.ok)));
  const end = fixed ? ms(fixed.at) : null;
  return start !== null && end !== null ? end - start : null;
}

export function computeMetrics(cycles: Cycle[]): Metrics {
  const completed = cycles.filter((c) => c.status === 'complete');
  const abandoned = cycles.filter((c) => c.status === 'abandoned');
  const active = cycles.filter((c) => !c.status);
  const leadTimes = completed.map((c) => (ms(c.endedAt) ?? 0) - (ms(c.startedAt) ?? 0)).filter((n) => n > 0);
  const deployTimes = cycles.map(deployedAt).filter((t): t is number => t !== null);
  const deployed = cycles.filter((c) => deployedAt(c) !== null);
  const failures = deployed.filter(hadChangeFailure);
  const rollbacks = cycles.reduce((n, c) => n + c.history.filter((h) => h.checks.some((x) => x.name === 'rollback')).length, 0);
  const recoveries = cycles.map(recoveryMs).filter((n): n is number => n !== null);

  let deploymentsPerWeek: number | null = null;
  if (deployTimes.length) {
    const span = Math.max(...deployTimes) - Math.min(...deployTimes);
    const weeks = Math.max(1, span / (7 * 24 * 3600 * 1000));
    deploymentsPerWeek = deployTimes.length / weeks;
  }

  const firstPass: Metrics['firstPass'] = {};
  const failuresByPhase: Metrics['failuresByPhase'] = {};
  let gateRuns = 0;
  let gateFailures = 0;
  for (const c of cycles) {
    const seen = new Set<Phase>();
    for (const h of c.history) {
      if (h.checks.some((x) => x.name === 'rollback')) continue;
      gateRuns++;
      if (!h.pass) {
        gateFailures++;
        failuresByPhase[h.phase] = (failuresByPhase[h.phase] ?? 0) + 1;
      }
      if (!seen.has(h.phase)) {
        seen.add(h.phase);
        const fp = (firstPass[h.phase] ??= { passed: 0, reached: 0 });
        fp.reached++;
        if (h.pass) fp.passed++;
      }
    }
  }

  return {
    cycles: cycles.length,
    completed: completed.length,
    abandoned: abandoned.length,
    active: active.length,
    leadTimeMedianMs: median(leadTimes),
    leadTimeMeanMs: mean(leadTimes),
    deployments: deployed.length,
    deploymentsPerWeek,
    changeFailures: failures.length,
    changeFailureRate: deployed.length ? failures.length / deployed.length : null,
    rollbacks,
    mttrMedianMs: median(recoveries),
    gateRuns,
    gateFailures,
    firstPass,
    failuresByPhase,
  };
}

export function formatDuration(value: number | null): string {
  if (value === null) return 'n/a';
  const minutes = Math.floor(value / 60000);
  if (minutes < 1) return `${Math.round(value / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
}

export function metricsLines(m: Metrics): string[] {
  const first = PHASES.filter((p) => m.firstPass[p]).map((p) => {
    const fp = m.firstPass[p]!;
    return `${p} ${pct(fp.passed / fp.reached)}`;
  });
  const byPhase = (Object.entries(m.failuresByPhase) as Array<[Phase, number]>).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`);
  return [
    `cycles         ${m.completed} completed, ${m.abandoned} abandoned, ${m.active} active`,
    `lead time      median ${formatDuration(m.leadTimeMedianMs)}, mean ${formatDuration(m.leadTimeMeanMs)} (start to complete)`,
    `deployments    ${m.deployments}${m.deploymentsPerWeek !== null ? ` (${m.deploymentsPerWeek.toFixed(1)} per week)` : ''}`,
    `change failure ${pct(m.changeFailureRate)}${m.deployments ? ` (${m.changeFailures} of ${m.deployments} deploys hit a failed healthcheck or a rollback)` : ''}`,
    `recovery       median ${formatDuration(m.mttrMedianMs)} from failed healthcheck to pass or rollback${m.rollbacks ? `, ${m.rollbacks} rollback(s)` : ''}`,
    `gate runs      ${m.gateRuns}, ${m.gateFailures} failed${m.gateRuns ? ` (${pct(m.gateFailures / m.gateRuns)})` : ''}`,
    `first pass     ${first.length ? first.join('  ') : 'n/a'}`,
    `failures       ${byPhase.length ? byPhase.join(', ') : 'none'}`,
  ];
}
