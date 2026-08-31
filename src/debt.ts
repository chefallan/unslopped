import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.ts';

export const DEBT_CATEGORIES = ['cleanup', 'pattern', 'soon', 'accepted'] as const;
export type DebtCategory = (typeof DEBT_CATEGORIES)[number];

export interface DebtEntry {
  category: DebtCategory;
  text: string;
}

export function debtPath(root: string): string {
  return path.join(stateDir(root), 'DEBT.md');
}

const HEADER = `# Debt log

Known deviations we are deliberately not fixing in the change where they were found.
One line each, logged on the spot instead of opening a work item. Sweep the cleanup
items in one batch at a quiet moment; accepted items stay, with the reason, so nobody
re-litigates them.

Categories: cleanup (mechanical, safe to batch), pattern (a wrong shape new code would
copy; fix it before it spreads), soon (costs someone time while it exists), accepted
(evaluated and staying as is).

`;

export function addDebt(root: string, category: DebtCategory, what: string, where: string | null, cycle: string | null): string {
  const file = debtPath(root);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HEADER;
  const date = new Date().toISOString().slice(0, 10);
  const line = `- [${category}] ${what.trim()}${where ? ` (${where})` : ''} :: logged ${date}${cycle ? `, cycle ${cycle}` : ''}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, existing.trimEnd() + '\n' + line + '\n');
  return line;
}

export function listDebt(root: string): DebtEntry[] {
  const file = debtPath(root);
  if (!fs.existsSync(file)) return [];
  const out: DebtEntry[] = [];
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^- \[(cleanup|pattern|soon|accepted)\] (.+)$/);
    if (m) out.push({ category: m[1] as DebtCategory, text: m[2] });
  }
  return out;
}

export function removeDebtEntries(root: string, texts: string[]): number {
  const file = debtPath(root);
  if (!fs.existsSync(file) || !texts.length) return 0;
  const wanted = new Set(texts);
  let removed = 0;
  const kept = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => {
      const m = l.match(/^- \[(?:cleanup|pattern|soon|accepted)\] (.+)$/);
      if (m && wanted.has(m[1])) {
        removed++;
        return false;
      }
      return true;
    });
  fs.writeFileSync(file, kept.join('\n').replace(/\n{3,}$/, '\n'));
  return removed;
}

export function debtCounts(root: string): string | null {
  const entries = listDebt(root);
  if (!entries.length) return null;
  const parts = DEBT_CATEGORIES.map((c) => {
    const n = entries.filter((e) => e.category === c).length;
    return n ? `${n} ${c}` : null;
  }).filter(Boolean);
  return parts.join(', ');
}
