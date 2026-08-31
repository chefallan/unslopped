import type { Phase } from './types.ts';

export const PHASES: Phase[] = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'];

export function nextPhase(phase: Phase): Phase | null {
  const i = PHASES.indexOf(phase);
  if (i === -1 || i === PHASES.length - 1) return null;
  return PHASES[i + 1];
}

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase) + 1;
}
