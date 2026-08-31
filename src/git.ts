import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

export function git(args: string[], cwd: string): GitResult {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export function isRepo(cwd: string): boolean {
  return git(['rev-parse', '--is-inside-work-tree'], cwd).ok;
}

export function headSha(cwd: string): string | null {
  const r = git(['rev-parse', 'HEAD'], cwd);
  return r.ok ? r.out : null;
}

export function currentBranch(cwd: string): string | null {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return r.ok && r.out && r.out !== 'HEAD' ? r.out : null;
}

export function remoteUrl(cwd: string): string | null {
  const r = git(['remote', 'get-url', 'origin'], cwd);
  return r.ok ? r.out : null;
}

export function porcelain(cwd: string, { exclude = [] as string[] } = {}): string {
  const pathspec = exclude.length ? ['--', '.', ...exclude.map((e) => ':(exclude)' + e)] : [];
  return git(['status', '--porcelain', ...pathspec], cwd).out;
}

export function commitsSince(sha: string | null, cwd: string): number {
  const r = sha ? git(['rev-list', '--count', `${sha}..HEAD`], cwd) : git(['rev-list', '--count', 'HEAD'], cwd);
  return r.ok ? Number(r.out) : 0;
}

export function lastCommitMs(cwd: string): number | null {
  const r = git(['log', '-1', '--format=%cI', '--', '.', ':(exclude).ade'], cwd);
  if (!r.ok || !r.out) return null;
  const t = Date.parse(r.out);
  return Number.isNaN(t) ? null : t;
}

export function branchExists(cwd: string, branch: string): boolean {
  return git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd).ok;
}

export function addWorktree(cwd: string, dir: string, branch: string): GitResult {
  return branchExists(cwd, branch) ? git(['worktree', 'add', dir, branch], cwd) : git(['worktree', 'add', '-b', branch, dir], cwd);
}

export interface FileStat {
  file: string;
  added: number;
  deleted: number;
}

export function numstatSince(cwd: string, since: string | null): FileStat[] {
  const r = git(['diff', '--numstat', since ?? 'HEAD'], cwd);
  const out: FileStat[] = [];
  for (const line of r.out.split(/\r?\n/)) {
    const [added, deleted, file] = line.split('\t');
    if (!file) continue;
    out.push({ file: file.trim(), added: Number(added) || 0, deleted: Number(deleted) || 0 });
  }
  return out;
}

export function commitsSinceDate(cwd: string, iso: string): number {
  const r = git(['rev-list', '--count', 'HEAD', `--since=${iso}`], cwd);
  return r.ok ? Number(r.out) || 0 : 0;
}

export function pushBranch(cwd: string, branch: string): GitResult {
  return git(['push', '--set-upstream', 'origin', branch], cwd);
}

export function commitSubjects(sha: string | null, cwd: string): string[] {
  const range = sha ? `${sha}..HEAD` : 'HEAD';
  const r = git(['log', range, '--format=%s'], cwd);
  return r.ok ? r.out.split(/\r?\n/).filter(Boolean) : [];
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function untrackedFiles(cwd: string): string[] {
  return lines(git(['ls-files', '--others', '--exclude-standard'], cwd).out);
}

export function changedFiles(cwd: string, since: string | null): string[] {
  const tracked = since ? lines(git(['diff', '--name-only', since], cwd).out) : lines(git(['diff', '--name-only', 'HEAD'], cwd).out);
  return [...new Set([...tracked, ...untrackedFiles(cwd)])].filter((f) => !f.startsWith('.ade/'));
}

function countLines(file: string): number {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return 0;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\u0000')) return 0;
    return text.split(/\r?\n/).filter((l) => l.length).length;
  } catch {
    return 0;
  }
}

export function diffLines(cwd: string, since: string | null): number {
  const r = git(['diff', '--numstat', since ?? 'HEAD'], cwd);
  let total = 0;
  for (const line of lines(r.out)) {
    const [added, deleted, file] = line.split('\t');
    if (!file || file.startsWith('.ade/')) continue;
    total += (Number(added) || 0) + (Number(deleted) || 0);
  }
  for (const f of untrackedFiles(cwd)) {
    if (f.startsWith('.ade/')) continue;
    total += countLines(path.join(cwd, f));
  }
  return total;
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export function parseUnifiedDiff(text: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = '';
  let lineNo = 0;
  let inHunk = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '').trim();
      inHunk = false;
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      out.push({ file, line: lineNo, text: raw.slice(1) });
      lineNo++;
    } else if (raw.startsWith(' ') || raw === '') {
      lineNo++;
    }
  }
  return out;
}

export function addedLines(cwd: string, since: string | null): AddedLine[] {
  const out: AddedLine[] = parseUnifiedDiff(git(['diff', '--unified=0', since ?? 'HEAD'], cwd).out);
  for (const f of untrackedFiles(cwd)) {
    if (f.startsWith('.ade/')) continue;
    const full = path.join(cwd, f);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes('\u0000')) continue;
      text.replace(/\r?\n$/, '').split(/\r?\n/).forEach((t, i) => out.push({ file: f, line: i + 1, text: t }));
    } catch {
      continue;
    }
  }
  return out;
}
