import fs from 'node:fs';
import path from 'node:path';
import { trackedFiles } from './git.ts';
import { isTestFile } from './practices.ts';
import type { AddedLine } from './git.ts';
import type { Finding } from './types.ts';

interface BloatPattern {
  re: RegExp;
  instead: string;
}

const ARG = '(?:[^()\\n]|\\([^()\\n]*\\))*';

const PATTERNS: BloatPattern[] = [
  { re: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/, instead: 'this clones through JSON, which drops dates, maps and undefined. structuredClone does it properly' },
  { re: new RegExp(`\\.filter\\s*\\(${ARG}\\)\\s*\\.length\\s*(?:[><]=?|===?|!==?)\\s*0\\b`), instead: 'this builds a whole array to ask whether anything matched. some answers that, and stops at the first hit' },
  { re: new RegExp(`\\.filter\\s*\\(${ARG}\\)\\s*\\[\\s*0\\s*\\]`), instead: 'this builds a whole array to take the first match. find returns it directly' },
  { re: /\.indexOf\s*\([^\n]*\)\s*(?:!==?|===?)\s*-\s*1|\.indexOf\s*\([^\n]*\)\s*>\s*-\s*1|\.indexOf\s*\([^\n]*\)\s*<\s*0\b/, instead: 'this compares a position to say whether something is present. includes says it in one word' },
  { re: /Object\.assign\s*\(\s*(?:\{\s*\}|\[\s*\])\s*,/, instead: 'this copies into a fresh literal at runtime. the spread says the same thing and reads as a copy' },
  { re: /catch\s*(?:\(\s*\w+\s*\))?\s*\{\s*throw\s+\w+\s*;?\s*\}/, instead: 'this catch only rethrows, so it changes nothing. remove it and let the error travel' },
  { re: /Object\.keys\s*\(\s*(\w+)\s*\)\s*\.map\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\s*\[\s*\2\s*\]\s*\)/, instead: 'this rebuilds the values from the keys. Object.values returns them' },
  { re: /(?:if|while)\s*\(\s*!?\w+(?:[.?]\w+)*\s*===?\s*(?:true|false)\s*\)/, instead: 'comparing a boolean to a boolean literal adds nothing. test the value itself, negated when you meant false' },
  { re: /\bnew Promise\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*setTimeout\s*\(\s*\1\s*,/, instead: 'this wraps setTimeout to wait. the timers/promises setTimeout is already a promise' },
];

const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|.*\.min\.js|.*\.map|.*\.lock|.*\.md)$/;
const READABLE = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/;
const MAX_FILE_BYTES = 512 * 1024;

export const BLOAT_CAP = 12;

function finding(file: string, line: number, instead: string): Finding {
  return { severity: 'minor', text: `${file}:${line} ${instead}`, file, line };
}

export function scanBloat(lines: AddedLine[], testPatterns: string[]): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    if (SKIP.test(l.file) || isTestFile(l.file, testPatterns)) continue;
    for (const p of PATTERNS) {
      if (!p.re.test(l.text)) continue;
      out.push(finding(l.file, l.line, p.instead));
      break;
    }
    if (out.length >= BLOAT_CAP) break;
  }
  return out;
}

export function scanBloatFiles(root: string, testPatterns: string[]): Finding[] {
  const out: Finding[] = [];
  for (const file of trackedFiles(root)) {
    if (!READABLE.test(file) || SKIP.test(file) || isTestFile(file, testPatterns)) continue;
    let text = '';
    try {
      const full = path.join(root, file);
      if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).map((t, i) => ({ file, line: i + 1, text: t }));
    out.push(...scanBloat(lines, testPatterns));
    if (out.length >= BLOAT_CAP) return out.slice(0, BLOAT_CAP);
  }
  return out;
}
