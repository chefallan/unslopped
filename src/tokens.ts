import type { Cycle, TokenBucket } from './types.ts';

export function estimate(text: string): number {
  return Math.ceil(String(text ?? '').length / 4);
}

export function stripAnsi(text: string): string {
  return String(text ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

const SIGNAL = /\b(error|errors|fail|failed|failing|failure|failures|assert|assertion|expected|received|actual|exception|traceback|panic|fatal|cannot|not found|denied|timeout|timed out|exit code|unhandled|rejected|missing)\b|✖|×|✗|^\s*at .+:\d+|\S+:\d+:\d+/i;
const NOISE = /^\s*$|^\s*npm (warn|notice|info)|^\s*[|/\\-]\s*$|^[\s.]+$|^\s*(added|audited|found) \d+ packages|^\s*\d{1,3}%|^\s*[━═▶►]+\s*$|^\s*> .* (test|build|lint|check)\s*$|^\s*>\s*\S+@\S+ (test|build|lint|check)\s*$/;

export interface Digest {
  text: string;
  kept: number;
  omitted: number;
  total: number;
  signal: boolean;
  truncated: boolean;
}

export function digest(output: string, { lines = 25, context = 1 } = {}): Digest {
  const all = stripAnsi(output).split(/\r?\n/).map((l) => l.trimEnd());
  const keep = new Set<number>();
  all.forEach((l, i) => {
    if (!SIGNAL.test(l) || NOISE.test(l)) return;
    for (let j = Math.max(0, i - context); j <= Math.min(all.length - 1, i + context); j++) {
      if (!NOISE.test(all[j])) keep.add(j);
    }
  });
  let idx = [...keep].sort((a, b) => a - b);
  const signal = idx.length > 0;
  if (!signal) idx = all.map((_, i) => i).filter((i) => !NOISE.test(all[i])).slice(-Math.min(lines, 15));
  const truncated = idx.length > lines;
  if (truncated) idx = idx.slice(-lines);
  const out: string[] = [];
  let prev = -2;
  for (const i of idx) {
    if (out.length && i !== prev + 1) out.push('...');
    out.push(all[i]);
    prev = i;
  }
  return { text: out.join('\n'), kept: idx.length, omitted: all.length - idx.length, total: all.length, signal, truncated };
}

export function account(cycle: Cycle | null | undefined, kind: string, rawChars: number, shownChars: number): void {
  if (!cycle) return;
  cycle.tokens ??= {};
  const t = (cycle.tokens[kind] ??= { raw: 0, shown: 0, count: 0 });
  t.raw += rawChars;
  t.shown += shownChars;
  t.count += 1;
}

export type TokenSummary = Record<'gate' | 'hook', TokenBucket>;

export function summarize(cycles: Array<Partial<Cycle> | null | undefined>): TokenSummary {
  const sum: TokenSummary = { gate: { raw: 0, shown: 0, count: 0 }, hook: { raw: 0, shown: 0, count: 0 } };
  for (const c of cycles) {
    for (const kind of Object.keys(sum) as Array<keyof TokenSummary>) {
      const t = c?.tokens?.[kind];
      if (!t) continue;
      sum[kind].raw += t.raw;
      sum[kind].shown += t.shown;
      sum[kind].count += t.count;
    }
  }
  return sum;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function tok(chars: number): number {
  return Math.ceil(chars / 4);
}

export function reportLines(label: string, tokens: Record<string, TokenBucket> | undefined): string[] {
  const g = tokens?.gate ?? { raw: 0, shown: 0, count: 0 };
  const h = tokens?.hook ?? { raw: 0, shown: 0, count: 0 };
  const saved = Math.max(0, tok(g.raw) - tok(g.shown));
  return [
    label,
    `  gate output   ${g.count} run(s)   raw ${fmt(g.raw)} chars (~${fmt(tok(g.raw))} tok)   shown ${fmt(g.shown)} chars (~${fmt(tok(g.shown))} tok)   saved ~${fmt(saved)} tok`,
    `  hook context  ${h.count} injection(s)   shown ${fmt(h.shown)} chars (~${fmt(tok(h.shown))} tok)${h.raw > h.shown ? `   skipped ~${fmt(tok(h.raw - h.shown))} tok of duplicate protocol` : ''}`,
  ];
}
