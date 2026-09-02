import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'unslopped.js');

export function tmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unslopped-')));
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function initRepo(cwd: string): void {
  git(cwd, 'init', '-q');
  fs.writeFileSync(path.join(cwd, 'README.md'), 'x\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'init');
}

export const NO_TRACKER_ENV = { LINEAR_API_KEY: '', JIRA_API_TOKEN: '', JIRA_BASE_URL: '', GITHUB_TOKEN: '', GH_TOKEN: '', UNSLOPPED_WEBHOOK_URL: '', UNSLOPPED_NO_GH_AUTH: '1' };

export const PRACTICES_OFF = {
  planSections: [] as string[],
  coverage: null,
  securityScan: null,
  changelog: false,
  tdd: false,
  reviewArtifact: false,
  reviewCommand: null,
  worktree: false,
  pullRequest: { auto: false, base: null, draft: false },
  style: null,
  scope: false,
  criteriaQuality: false,
  testDeletion: false,
  guardedPaths: [] as string[],
  exclusivePaths: [] as string[],
  declarations: [] as Array<{ name: string; when: string }>,
  handoffNote: false,
  testEvidence: false,
  criteriaChecked: false,
  commitPattern: null,
  humanAuthorship: false,
  protectedBranches: [] as string[],
  maxDiffLines: 0,
  secretScan: false,
  exploitScan: false,
  audit: null,
  rollback: false,
  reviewApproval: false,
  messageApproval: false,
  monitorNotes: false,
};

export function cli(cwd: string, ...args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...NO_TRACKER_ENV } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

export function writeConfig(cwd: string, commands: Record<string, string | null>, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(cwd, 'unslopped.config.json'),
    JSON.stringify({ commands, deploy: { requireApproval: true }, assistants: ['agents'], practices: PRACTICES_OFF, ...extra }, null, 2)
  );
}

export const PASS = 'node -e "process.exit(0)"';
export const FAIL = 'node -e "console.error(\'boom\'); process.exit(1)"';
