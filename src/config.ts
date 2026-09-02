import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mergeTracker, trackerDefaults } from './tracker.ts';
import { mergePractices, practiceDefaults } from './practices.ts';
import { graphDefaults, mergeGraph } from './graph.ts';
import type { Commands, Config, Cycle } from './types.ts';

export const CONFIG_FILE = 'unslopped.config.json';
export const ASSISTANTS = ['agents', 'claude', 'cursor', 'copilot', 'windsurf', 'gemini'];

const EMPTY_COMMANDS: Commands = {
  setup: null,
  lint: null,
  build: null,
  test: null,
  release: null,
  deploy: null,
  rollback: null,
  healthcheck: null,
  monitor: null,
};

const NPM_DEFAULT_TEST = /echo .*Error: no test specified/;

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export function packageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function detectCommands(root: string): Commands {
  const commands = { ...EMPTY_COMMANDS };
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const pm = packageManager(root);
    const run = (s: string) => (pm === 'npm' ? `npm run ${s}` : `${pm} run ${s}`);
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const lock = fs.existsSync(path.join(root, 'package-lock.json'));
    commands.setup = pm === 'npm' ? (lock ? 'npm ci' : 'npm install') : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --frozen-lockfile' : 'bun install';
    if (scripts.lint) commands.lint = run('lint');
    if (scripts.build) commands.build = run('build');
    if (scripts.test && !NPM_DEFAULT_TEST.test(scripts.test)) commands.test = pm === 'npm' ? 'npm test' : `${pm} test`;
    if (scripts.release) commands.release = run('release');
    if (scripts.deploy) commands.deploy = run('deploy');
    if (scripts.rollback) commands.rollback = run('rollback');
    return commands;
  }
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
    return { ...commands, build: 'cargo build', test: 'cargo test', lint: 'cargo clippy -- -D warnings' };
  }
  if (fs.existsSync(path.join(root, 'go.mod'))) {
    return { ...commands, build: 'go build ./...', test: 'go test ./...', lint: 'go vet ./...' };
  }
  if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'pytest.ini'))) {
    return { ...commands, test: 'pytest' };
  }
  if (fs.existsSync(path.join(root, 'Makefile'))) {
    return { ...commands, build: 'make', test: 'make test' };
  }
  return commands;
}

export function detectAudit(root: string): string | null {
  if (!fs.existsSync(path.join(root, 'package.json'))) return null;
  const pm = packageManager(root);
  if (pm === 'npm' && fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm audit --audit-level=high';
  if (pm === 'pnpm') return 'pnpm audit --audit-level=high';
  return null;
}

export function defaultConfig(root: string): Config {
  return {
    commands: detectCommands(root),
    deploy: { requireApproval: true },
    tracker: trackerDefaults(),
    memory: { skills: true, history: true },
    tokens: { mode: 'compact', outputLines: 25, pointerFiles: true },
    practices: { ...practiceDefaults(), audit: detectAudit(root) },
    graph: graphDefaults(),
    assistants: [...ASSISTANTS],
  };
}

export function configPath(root: string): string {
  return path.join(root, CONFIG_FILE);
}

export function loadConfig(root: string): Config | null {
  const cfg = readJson(configPath(root));
  if (!cfg) return null;
  const tokens = (cfg.tokens ?? {}) as Partial<Config['tokens']>;
  return {
    commands: { ...EMPTY_COMMANDS, ...((cfg.commands ?? {}) as Partial<Commands>) },
    deploy: { requireApproval: true, ...((cfg.deploy ?? {}) as Partial<Config['deploy']>) },
    tracker: mergeTracker(cfg.tracker as Partial<Config['tracker']> | undefined),
    memory: { skills: true, history: true, ...((cfg.memory ?? {}) as Partial<Config['memory']>) },
    tokens: { mode: 'compact', outputLines: 25, pointerFiles: true, ...tokens },
    practices: mergePractices(cfg.practices as Partial<Config['practices']> | undefined),
    graph: mergeGraph(cfg.graph as Partial<Config['graph']> | undefined),
    assistants: (cfg.assistants as string[] | undefined) ?? [...ASSISTANTS],
  };
}

export function saveConfig(root: string, cfg: Config): void {
  fs.writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, stable(obj[k])]));
  }
  return value;
}

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function readConfigText(root: string): string | null {
  try {
    return fs.readFileSync(configPath(root), 'utf8');
  } catch {
    return null;
  }
}

export function configDriftLines(root: string, config: Config, cycle: Cycle): string[] | null {
  if (cycle.configText != null) {
    const current = readConfigText(root) ?? '';
    if (current === cycle.configText) return null;
    const before = cycle.configText.split(/\r?\n/);
    const after = current.split(/\r?\n/);
    const gone = before.filter((l) => l.trim() && !after.includes(l));
    const added = after.filter((l) => l.trim() && !before.includes(l));
    const shown = [...gone.slice(0, 4).map((l) => `- ${l.trim()}`), ...added.slice(0, 4).map((l) => `+ ${l.trim()}`)];
    return ['unslopped.config.json changed during this cycle:', ...shown];
  }
  const current = configHash(config);
  if (current === cycle.configHash) return null;
  return [`unslopped.config.json changed during this cycle (${cycle.configHash} -> ${current}).`];
}

export function configHash(cfg: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(cfg))).digest('hex').slice(0, 16);
}
