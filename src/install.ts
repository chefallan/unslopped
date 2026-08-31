import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { protocol, START, END } from './protocol.ts';
import { upsertBlock } from './init.ts';
import type { Env } from './types.ts';

const CMD = 'ade';
const OURS = /\bade\s+hook\b/;

type Json = Record<string, any>;

function readJson(f: string): Json {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as Json;
  } catch {
    return {};
  }
}

function writeJson(f: string, value: unknown): void {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(value, null, 2) + '\n');
}

export function claudeHooks(cmd = CMD): Json {
  return {
    SessionStart: [{ hooks: [{ type: 'command', command: `${cmd} hook claude session` }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${cmd} hook claude prompt` }] }],
    PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: `${cmd} hook claude tool` }] }],
  };
}

export function cursorHooks(cmd = CMD): Json {
  return { beforeShellExecution: [{ command: `${cmd} hook cursor shell` }] };
}

function isOurs(entry: Json): boolean {
  return ((entry?.hooks ?? []) as Json[]).some((h) => OURS.test(String(h?.command ?? ''))) || OURS.test(String(entry?.command ?? ''));
}

function mergeHooks(existingHooks: Json | undefined, hooks: Json): Json {
  const next: Json = { ...(existingHooks ?? {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    next[event] = [...((next[event] ?? []) as Json[]).filter((e) => !isOurs(e)), ...(entries as Json[])];
  }
  return next;
}

function stripHooks(existingHooks: Json | undefined): Json {
  const next: Json = {};
  for (const [event, entries] of Object.entries(existingHooks ?? {})) {
    const kept = ((entries ?? []) as Json[]).filter((e) => !isOurs(e));
    if (kept.length) next[event] = kept;
  }
  return next;
}

export function mergeClaudeSettings(settings: Json, hooks: Json = claudeHooks()): Json {
  return { ...settings, hooks: mergeHooks(settings.hooks, hooks) };
}

export function stripClaudeSettings(settings: Json): Json {
  const hooks = stripHooks(settings.hooks);
  const next: Json = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

export function mergeCursorHooks(existing: Json, hooks: Json = cursorHooks()): Json {
  return { version: 1, ...existing, hooks: mergeHooks(existing.hooks, hooks) };
}

export function stripCursorHooks(existing: Json): Json {
  return { ...existing, hooks: stripHooks(existing.hooks) };
}

export function removeBlock(text: string): string {
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s === -1 || e === -1 || e < s) return text;
  return (text.slice(0, s) + text.slice(e + END.length)).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '\n');
}

function vscodeUserDir(home: string, env: Env, platform: string): string {
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Code', 'User');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Code', 'User');
}

const COPILOT_HEADER = '---\napplyTo: "**"\n---\n\n';

interface GlobalTarget {
  kind: 'claude-hooks' | 'cursor-hooks' | 'markdown';
  file: (home: string, env: Env, platform: string) => string;
  note?: string;
  header?: string;
}

export const GLOBAL_TARGETS: Record<string, GlobalTarget> = {
  claude: { kind: 'claude-hooks', file: (h) => path.join(h, '.claude', 'settings.json'), note: 'hooks: context on every prompt, blocked tool calls' },
  cursor: { kind: 'cursor-hooks', file: (h) => path.join(h, '.cursor', 'hooks.json'), note: 'hook: blocked shell commands' },
  codex: { kind: 'markdown', file: (h) => path.join(h, '.codex', 'AGENTS.md') },
  gemini: { kind: 'markdown', file: (h) => path.join(h, '.gemini', 'GEMINI.md') },
  windsurf: { kind: 'markdown', file: (h) => path.join(h, '.codeium', 'windsurf', 'memories', 'global_rules.md') },
  copilot: { kind: 'markdown', file: (h, env, platform) => path.join(vscodeUserDir(h, env, platform), 'prompts', 'ade.instructions.md'), header: COPILOT_HEADER },
  opencode: { kind: 'markdown', file: (h, env) => path.join(env.XDG_CONFIG_HOME ?? path.join(h, '.config'), 'opencode', 'AGENTS.md') },
  cline: { kind: 'markdown', file: (h) => path.join(h, 'Documents', 'Cline', 'Rules', 'ade.md') },
  roo: { kind: 'markdown', file: (h) => path.join(h, '.roo', 'rules', 'ade.md') },
  kilo: { kind: 'markdown', file: (h) => path.join(h, '.kilocode', 'rules', 'ade.md') },
  continue: { kind: 'markdown', file: (h) => path.join(h, '.continue', 'rules', 'ade.md') },
  goose: { kind: 'markdown', file: (h, env) => path.join(env.XDG_CONFIG_HOME ?? path.join(h, '.config'), 'goose', '.goosehints') },
};

export const GLOBAL_TARGET_NAMES = Object.keys(GLOBAL_TARGETS);

export function targetPath(home: string, key: string, env: Env = process.env, platform: string = process.platform): string {
  const t = GLOBAL_TARGETS[key];
  if (!t) throw new Error(`unknown target: ${key}. valid: ${GLOBAL_TARGET_NAMES.join(', ')}`);
  return t.file(home, env, platform);
}

export function onPath(cmd = CMD, platform: string = process.platform): boolean {
  const r = spawnSync(platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

export interface InstallOptions {
  only?: string[] | null;
  env?: Env;
  platform?: string;
}

export interface Written {
  key: string;
  file: string;
  note: string;
}

export function install(home: string, { only = null, env = process.env, platform = process.platform }: InstallOptions = {}): { written: Written[] } {
  const written: Written[] = [];
  for (const key of only ?? GLOBAL_TARGET_NAMES) {
    const t = GLOBAL_TARGETS[key];
    if (!t) throw new Error(`unknown target: ${key}. valid: ${GLOBAL_TARGET_NAMES.join(', ')}`);
    const f = t.file(home, env, platform);
    if (t.kind === 'claude-hooks') writeJson(f, mergeClaudeSettings(readJson(f)));
    else if (t.kind === 'cursor-hooks') writeJson(f, mergeCursorHooks(readJson(f)));
    else {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const existing = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      let next = upsertBlock(existing, protocol(CMD));
      if (t.header && !next.startsWith('---')) next = t.header + next;
      fs.writeFileSync(f, next);
    }
    written.push({ key, file: f, note: t.note ?? 'global instructions' });
  }
  return { written };
}

export function uninstall(home: string, { only = null, env = process.env, platform = process.platform }: InstallOptions = {}): { removed: Array<{ key: string; file: string }> } {
  const removed: Array<{ key: string; file: string }> = [];
  for (const key of only ?? GLOBAL_TARGET_NAMES) {
    const t = GLOBAL_TARGETS[key];
    if (!t) throw new Error(`unknown target: ${key}. valid: ${GLOBAL_TARGET_NAMES.join(', ')}`);
    const f = t.file(home, env, platform);
    if (!fs.existsSync(f)) continue;
    if (t.kind === 'claude-hooks') writeJson(f, stripClaudeSettings(readJson(f)));
    else if (t.kind === 'cursor-hooks') writeJson(f, stripCursorHooks(readJson(f)));
    else {
      const rest = removeBlock(fs.readFileSync(f, 'utf8'));
      if (rest.replace(COPILOT_HEADER.trim(), '').trim()) fs.writeFileSync(f, rest);
      else fs.unlinkSync(f);
    }
    removed.push({ key, file: f });
  }
  return { removed };
}
