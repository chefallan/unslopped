import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PHASES } from './phases.ts';
import type { Cycle, Issue, State } from './types.ts';

export const STATE_DIR = '.unslopped';

export function stateDir(root: string): string {
  return path.join(root, STATE_DIR);
}

export function statePath(root: string): string {
  return path.join(stateDir(root), 'state.json');
}

export function plansDir(root: string): string {
  return path.join(stateDir(root), 'plans');
}

export function planPath(root: string, id: string): string {
  return path.join(plansDir(root), `${id}.md`);
}

export function loadState(root: string): State {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8')) as State;
  } catch {
    return { cycle: null };
  }
}

export function saveState(root: string, state: State): void {
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

export function newCycle(goal: string, configHash: string, startCommit: string | null, issue: Issue | null = null): Cycle {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replaceAll('-', '');
  return {
    id: `${stamp}-${randomBytes(3).toString('hex')}`,
    goal,
    phase: PHASES[0],
    startedAt: d.toISOString(),
    startCommit,
    configHash,
    issue,
    approvals: {},
    history: [],
  };
}

export function archiveCycle(root: string, cycle: Cycle, status: 'complete' | 'abandoned'): Cycle {
  const dir = path.join(stateDir(root), 'cycles');
  fs.mkdirSync(dir, { recursive: true });
  const record: Cycle = { ...cycle, status, endedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, `${cycle.id}.json`), JSON.stringify(record, null, 2) + '\n');
  return record;
}

export function archivedCycles(root: string): Cycle[] {
  const dir = path.join(stateDir(root), 'cycles');
  if (!fs.existsSync(dir)) return [];
  const out: Cycle[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Cycle);
    } catch {
      continue;
    }
  }
  return out;
}

export function planTemplate(cycle: Cycle): string {
  const issue = cycle.issue ? `Issue: ${cycle.issue.key}${cycle.issue.url ? ' ' + cycle.issue.url : ''}\n` : '';
  const goal = cycle.issue?.description ? cycle.issue.description.trim() + '\n' : '';
  return `# ${cycle.goal}

Cycle: ${cycle.id}
Started: ${cycle.startedAt}
${issue}
## Goal
${goal}
## Approach

## Out of scope

## Files to touch

## Acceptance criteria
- [ ]

## Open questions

## Monitor
`;
}
