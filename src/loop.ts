import fs from 'node:fs';
import path from 'node:path';
import { listDebt } from './debt.ts';
import { parseFindings, planSection } from './practices.ts';
import { planPath } from './state.ts';
import type { DebtEntry } from './debt.ts';
import type { Cycle } from './types.ts';

export interface Candidate {
  goal: string;
  source: string;
}

function short(text: string, max = 90): string {
  const stripped = text.replace(/\s*::\s*logged .*$/, '').trim();
  return stripped.length > max ? stripped.slice(0, max - 3).trimEnd() + '...' : stripped;
}

export function nextCycleCandidates(root: string, cycle: Cycle, limit = 4): Candidate[] {
  const out: Candidate[] = [];
  const debt = listDebt(root);
  for (const e of debt.filter((d) => d.category === 'soon').slice(0, 2)) out.push({ goal: `Clear debt: ${short(e.text)}`, source: 'debt, soon' });
  for (const e of debt.filter((d) => d.category === 'pattern').slice(0, 1)) out.push({ goal: `Fix before it spreads: ${short(e.text)}`, source: 'debt, pattern' });
  if (cycle.review?.file) {
    try {
      const findings = parseFindings(fs.readFileSync(path.join(root, cycle.review.file), 'utf8'));
      for (const f of [...findings.filter((x) => x.severity === 'major').slice(0, 2), ...findings.filter((x) => x.severity === 'minor').slice(0, 1)]) {
        out.push({ goal: `Address review finding: ${short(f.text)}`, source: `review, ${f.severity}` });
      }
    } catch {
      // the review file is optional input here
    }
  }
  try {
    const monitor = planSection(fs.readFileSync(planPath(root, cycle.id), 'utf8'), 'Monitor');
    for (const line of monitor.split(/\r?\n/).map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && /\b(todo|next|follow|should|needs|remains|still|missing)\b/i.test(l)).slice(0, 2)) {
      out.push({ goal: short(line), source: 'monitor note' });
    }
  } catch {
    // no plan, no monitor candidates
  }
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.goal) && seen.add(c.goal)).slice(0, limit);
}

export function formatCandidates(candidates: Candidate[]): string[] {
  return ['next cycle candidates, offer them rather than starting one unasked:', ...candidates.map((c) => `  unslopped start ${JSON.stringify(c.goal)}   (${c.source})`)];
}

export const DEBT_SELECTORS = ['cleanup', 'pattern', 'soon', 'all'] as const;
export type DebtSelector = (typeof DEBT_SELECTORS)[number];

export function selectDebt(root: string, selector: DebtSelector): DebtEntry[] {
  const entries = listDebt(root);
  if (selector === 'all') return entries.filter((e) => e.category !== 'accepted');
  return entries.filter((e) => e.category === selector);
}

export function sweepGoal(selector: DebtSelector, count: number): string {
  return `Debt sweep, ${selector}: ${count} item(s)`;
}

export function seedPlanWithDebt(planText: string, entries: DebtEntry[]): string {
  const items = entries.map((e) => `- ${e.text}`).join('\n');
  const criteria = entries.map((e) => `- [ ] ${short(e.text)}`).join('\n');
  let next = planText.replace('## Acceptance criteria\n- [ ]', `## Debt items\n${items}\n\n## Acceptance criteria\n${criteria}`);
  const where = [...new Set(entries.map((e) => e.text.match(/\(([^)]+)\)\s*::\s*logged/)?.[1]).filter((w): w is string => Boolean(w)))];
  if (where.length) next = next.replace('## Files to touch\n', `## Files to touch\n${where.map((w) => `- ${w}`).join('\n')}\n`);
  return next;
}
