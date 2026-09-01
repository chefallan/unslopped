import { statusLines } from './status.ts';
import type { Config, Cycle, Phase, State } from './types.ts';

export function nextSteps(phase: Phase, config: Config, cycle: Cycle, cmd = 'unslopped'): string[] {
  const p = config.practices;
  switch (phase) {
    case 'plan':
      return ['fill in the plan: goal, approach, out of scope, files to touch, acceptance criteria', `${cmd} next`];
    case 'code': {
      const steps: string[] = [];
      if (p.tdd && !(cycle.red ?? []).some((r) => r.code !== 0)) steps.push(`write the failing test, then: ${cmd} red`);
      steps.push("implement inside the plan's files to touch until tests pass", `${cmd} next`);
      return steps;
    }
    case 'test':
      return [`${cmd} next (on failure fix the code, not the test)`];
    case 'release': {
      const steps = ['verify each acceptance criterion, tick it [x] in the plan'];
      if (p.messageApproval) steps.push(`propose the commit message: ${cmd} propose commit "<type(scope): subject>"`, `ask the human to run: ${cmd} approve commit`, `${cmd} commit`);
      else steps.push('commit as type(scope): imperative subject');
      if (p.reviewArtifact) steps.push(`get the diff reviewed: ${cmd} review`);
      steps.push(`${cmd} next`);
      return steps;
    }
    case 'deploy': {
      const steps: string[] = [];
      if (config.tracker.provider === 'github' && !cycle.pr) steps.push(`open the pull request: ${cmd} pr`);
      if (config.deploy.requireApproval && !cycle.approvals?.deploy) steps.push(`ask the human to run: ${cmd} approve deploy`);
      steps.push(`${cmd} next`);
      return steps;
    }
    case 'operate':
      return [`${cmd} next (healthcheck)`, ...(cycle.pr ? [`${cmd} pr status`] : [])];
    case 'monitor':
      return ['write what you learned under "## Monitor" in the plan', `${cmd} next (completes the cycle)`];
    default:
      return [`${cmd} next`];
  }
}

export function resumeLines(root: string, config: Config, state: State, cmd = 'unslopped'): string[] {
  const cycle = state.cycle;
  if (!cycle) return [`no active cycle. run: ${cmd} start "<goal>"`];
  const lines = statusLines(root, config, state, cmd);
  const last = cycle.history.at(-1);
  if (last && !last.pass) {
    for (const c of last.checks.filter((x) => !x.ok).slice(0, 4)) lines.push(`      FAIL ${c.name}: ${c.detail.split('\n')[0]}`);
  }
  lines.push('do next:');
  nextSteps(cycle.phase, config, cycle, cmd).forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  return lines;
}
