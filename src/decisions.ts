import fs from 'node:fs';
import path from 'node:path';
import { slugify } from './memory.ts';

export function decisionsDir(root: string): string {
  return path.join(root, 'docs', 'decisions');
}

export interface DecisionRef {
  number: number;
  status: string;
  title: string;
  file: string;
}

export function listDecisions(root: string): DecisionRef[] {
  const dir = decisionsDir(root);
  if (!fs.existsSync(dir)) return [];
  const out: DecisionRef[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const title = text.match(/^#\s+Decision \d+:\s*(.+)$/m)?.[1] ?? f.replace(/^\d{4}-/, '').replace(/\.md$/, '');
    const status = text.match(/^Status:\s*(\S+)/m)?.[1] ?? 'unknown';
    out.push({ number: Number(f.slice(0, 4)), status, title: title.trim(), file: path.join('docs', 'decisions', f).replace(/\\/g, '/') });
  }
  return out;
}

export function createDecision(root: string, title: string, cycleId: string | null): { file: string; number: number } {
  const dir = decisionsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const number = listDecisions(root).reduce((n, d) => Math.max(n, d.number), 0) + 1;
  const id = String(number).padStart(4, '0');
  const file = path.join(dir, `${id}-${slugify(title)}.md`);
  const body = `# Decision ${id}: ${title}

Status: proposed
Date: ${new Date().toISOString().slice(0, 10)}${cycleId ? `\nCycle: ${cycleId}` : ''}

## Context

What forces this decision. What breaks or stays ambiguous without it.

## Decision

What was decided, specific enough that the next person can act on it without asking.

## Options considered

- <option>: rejected because <reason>

## Consequences

What gets easier, what gets harder, what follow-up work this implies.
`;
  fs.writeFileSync(file, body);
  return { file: path.join('docs', 'decisions', `${id}-${slugify(title)}.md`).replace(/\\/g, '/'), number };
}
