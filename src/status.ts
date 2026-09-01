import { PHASES, phaseIndex } from './phases.ts';
import { describeGate } from './gates.ts';
import { planPath } from './state.ts';
import { configHash, CONFIG_FILE } from './config.ts';
import { debtCounts } from './debt.ts';
import type { Config, State } from './types.ts';

export function statusLines(root: string, config: Config, state: State, cmd = 'unslopped'): string[] {
  const debt = debtCounts(root);
  if (!state.cycle) return [`no active cycle. run: ${cmd} start "<goal>"`, ...(debt ? [`debt  ${debt} (${cmd} debt)`] : [])];
  const c = state.cycle;
  const lines = [
    `cycle ${c.id}  ${JSON.stringify(c.goal)}`,
    `phase ${c.phase} (${phaseIndex(c.phase)}/${PHASES.length})`,
    `gate  ${describeGate(c.phase, config)}`,
    `plan  ${planPath(root, c.id)}`,
  ];
  if (c.issue) lines.push(`issue ${c.issue.key}${c.issue.url ? ' ' + c.issue.url : ''}`);
  if (configHash(config) !== c.configHash) lines.push(`WARN  ${CONFIG_FILE} changed during this cycle, gates are blocked until: ${cmd} approve config`);
  const last = c.history.at(-1);
  if (last) lines.push(`last  ${last.phase} ${last.pass ? 'pass' : 'FAIL'} at ${last.at}`);
  const g = c.tokens?.gate;
  if (g && g.raw > g.shown) lines.push(`tokens ~${Math.ceil((g.raw - g.shown) / 4)} saved on gate output, see: ${cmd} tokens`);
  if (debt) lines.push(`debt  ${debt} (${cmd} debt)`);
  return lines;
}
