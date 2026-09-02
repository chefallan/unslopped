import fs from 'node:fs';
import { changedFiles, commitSubjects, diffLines } from './git.ts';
import { criteriaItems } from './practices.ts';
import { planPath } from './state.ts';
import type { Config, Cycle } from './types.ts';

export function briefLines(root: string, config: Config, cycle: Cycle, cmd = 'unslopped'): string[] {
  const lines: string[] = ['what approving means:'];
  lines.push(`  cycle     ${cycle.id}  ${JSON.stringify(cycle.goal)}`);
  let plan = '';
  try {
    plan = fs.readFileSync(planPath(root, cycle.id), 'utf8');
  } catch {
    plan = '';
  }
  const items = criteriaItems(plan);
  if (items.length) lines.push(`  criteria  ${items.filter((c) => c.checked).length}/${items.length} verified in the plan`);
  const red = (cycle.red ?? []).some((r) => r.code !== 0);
  lines.push(`  tests     the test gate passed${red ? '; a failing run was recorded before the fix' : ''}`);
  const files = changedFiles(root, cycle.startCommit).length;
  lines.push(`  diff      ${diffLines(root, cycle.startCommit)} line(s), ${files} file(s) since cycle start`);
  const subjects = commitSubjects(cycle.startCommit, root);
  lines.push(`  commits   ${subjects.length}${subjects.length ? ':' : ''}`);
  for (const s of subjects.slice(0, 4)) lines.push(`              ${s}`);
  if (cycle.review) lines.push(`  review    ${cycle.review.critical} critical, ${cycle.review.major} major, ${cycle.review.minor} minor`);
  const failed = [...new Set(cycle.history.filter((h) => !h.pass).map((h) => h.phase))];
  lines.push(`  gates     ${cycle.history.length} run(s)${failed.length ? `, failed then fixed at: ${failed.join(', ')}` : ', none failed'}`);
  lines.push('approving unlocks:');
  lines.push(`  deploy    ${config.commands.deploy ?? 'no deploy command; the cycle completes and archives'}`);
  lines.push(`  rollback  ${config.commands.rollback ?? 'none configured'}`);
  lines.push('  after     operate healthcheck, monitor notes, skill saved');
  lines.push(`approve   ${cmd} approve deploy`);
  lines.push('decline   tell the assistant what to change, or abandon with reset');
  return lines;
}

export function briefEvidence(root: string, config: Config, cycle: Cycle): string[] {
  const all = briefLines(root, config, cycle);
  return all.slice(1, all.indexOf('approving unlocks:'));
}
