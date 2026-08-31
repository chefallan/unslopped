import { spawnSync } from 'node:child_process';

const TAIL_LINES = 40;
const MAX_OUTPUT = 512 * 1024;

export interface RunResult {
  cmd: string;
  code: number;
  ms: number;
  output: string;
}

export function tail(text: string, lines = TAIL_LINES): string {
  const parts = text.trimEnd().split(/\r?\n/);
  if (parts.length <= lines) return parts.join('\n');
  return `... (${parts.length - lines} lines omitted)\n${parts.slice(-lines).join('\n')}`;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export function runCommand(cmd: string, cwd: string, { timeoutMs = 10 * 60 * 1000, env = {} }: RunOptions = {}): RunResult {
  const started = Date.now();
  const r = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI ?? 'true', FORCE_COLOR: '0', ...env },
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error && !timedOut ? r.error.message : ''}`;
  return {
    cmd,
    code: timedOut ? 124 : (r.status ?? 1),
    ms: Date.now() - started,
    output: output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output,
  };
}
