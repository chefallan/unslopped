import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { loadState, saveState } from './state.ts';
import { isRepo, currentBranch } from './git.ts';
import { protocolBody, START } from './protocol.ts';
import { account } from './tokens.ts';
import { statusLines } from './status.ts';
import { findIssueRef } from './detect.ts';
import { homeDir, matchSkills, readProfile, listSkills, appendHistory } from './memory.ts';
import { ensureGraph, graphContext, summarize } from './graph.ts';
import type { State } from './types.ts';

export function readStdinText(): string {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function readStdinJson(): Record<string, unknown> {
  try {
    const text = readStdinText();
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function memoryLines(root: string, home: string, prompt: string, cmd: string, graphCfg?: { enabled: boolean; maxFiles: number; maxFileKb: number; ignore: string[] }): string[] {
  const lines: string[] = [];
  if (graphCfg) {
    const graph = ensureGraph(root, graphCfg);
    if (graph) lines.push(...graphContext(graph, prompt, cmd));
  }
  const skills = matchSkills(root, home, prompt, 2);
  if (skills.length) lines.push(`Saved skills that match: ${skills.map((s) => `${s.name} (${s.health}) ${s.file}`).join('; ')}. Read them before planning.`);
  const prefs = readProfile(root, home);
  if (prefs.length) lines.push(`Remembered preferences: ${prefs.slice(0, 8).map((p) => p.replace(/^- /, '').replace(/\s+\(.*\)$/, '')).join('; ')}.`);
  lines.push(`Past work: ${cmd} recall "<words>".`);
  return lines;
}

function projectCarriesProtocol(root: string, file: string): boolean {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8').includes(START);
  } catch {
    return false;
  }
}

function accountHook(root: string, state: State, raw: number, shown: number): void {
  if (!state.cycle) return;
  account(state.cycle, 'hook', raw, shown);
  saveState(root, state);
}

export function sessionContext(root: string, cmd = 'ade', home = homeDir(), instructionFile = 'CLAUDE.md'): string {
  if (!isRepo(root)) return '';
  const config = loadConfig(root);
  const full = protocolBody(cmd);
  const carried = projectCarriesProtocol(root, instructionFile);
  const lines = [carried ? `ADE protocol: follow the ade block in ${instructionFile}. It is not repeated here.` : full, ''];
  if (!config) {
    lines.push(`This project is not initialized. Run \`${cmd} init\` before any work.`);
    return lines.join('\n') + '\n';
  }
  const state = loadState(root);
  lines.push(...statusLines(root, config, state, cmd));
  const prefs = readProfile(root, home);
  if (prefs.length) lines.push('', '## Preferences', ...prefs);
  const count = listSkills(root, home).length;
  if (count) lines.push('', `${count} saved skill(s). Matching ones are listed when a cycle starts.`);
  const graph = ensureGraph(root, config.graph);
  if (graph) {
    const s = summarize(graph);
    lines.push('', `## Code map (${s.files} files, ${s.symbols} symbols)`);
    lines.push(`Areas: ${s.areas.map((a) => `${a.name} (${a.files})`).join(', ')}`);
    if (s.godFiles.length) lines.push(`Most depended on: ${s.godFiles.slice(0, 5).map((g) => `${g.file} (${g.importers})`).join(', ')}`);
    lines.push(`Before reading or searching files, run ${cmd} graph "<words>" and read only what it points to.`);
  }
  const text = lines.join('\n') + '\n';
  accountHook(root, state, text.length + (carried ? full.length : 0), text.length);
  return text;
}

export function promptContext(root: string, prompt: string, cmd = 'ade', home = homeDir()): string {
  if (!isRepo(root)) return '';
  const config = loadConfig(root);
  if (!config) return `ade: this project is not initialized. Run \`${cmd} init\` first, then handle the request.\n`;
  const state = loadState(root);
  const p = String(prompt ?? '');
  if (config.memory.history && p.trim()) {
    appendHistory(root, { at: new Date().toISOString(), prompt: p.slice(0, 500), cycle: state.cycle?.id ?? null });
  }
  if (state.cycle) {
    const text = ['ade: active cycle', ...statusLines(root, config, state, cmd).map((l) => '  ' + l), `Continue this cycle. Advance with \`${cmd} next\`.`, ...memoryLines(root, home, p, cmd, config.graph)].join('\n') + '\n';
    accountHook(root, state, text.length, text.length);
    return text;
  }
  const goal = p.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 120) ?? '';
  const provider = config.tracker.provider;
  const issue = findIssueRef(p, provider) ?? findIssueRef(currentBranch(root), provider, { branch: true });
  const lines = ['ade: no active cycle.'];
  if (goal) lines.push(`If this request changes code, start one first: ${cmd} start ${JSON.stringify(goal)}`);
  lines.push('If it is more than a one-file change, ask the user two or three design questions first and record the options under "## Approach".');
  if (issue) lines.push(`Issue ${issue} will be linked.`);
  const branch = currentBranch(root);
  if (branch && config.practices.protectedBranches.includes(branch)) lines.push(`Branch ${branch} is protected. Create a working branch before starting.`);
  lines.push(`Then follow the phases and advance with \`${cmd} next\`.`);
  lines.push(...memoryLines(root, home, p, cmd, config.graph));
  return lines.join('\n') + '\n';
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell']);
const STATE_PATH = /\.ade[\\/](state\.json|cycles)/;
const READ_ONLY = /^\s*(cat|type|less|more|head|tail|grep|ade|npx\s+awesome-delivery-engine)\b/;

export interface Decision {
  block: boolean;
  reason?: string;
}

function block(reason: string): Decision {
  return { block: true, reason };
}

export function toolDecision(root: string, toolName: unknown, input: Record<string, unknown> = {}): Decision {
  const config = loadConfig(root);
  if (!config) return { block: false };
  const active = Boolean(loadState(root).cycle);
  const tool = String(toolName ?? '');
  if (EDIT_TOOLS.has(tool)) {
    const file = String(input.file_path ?? input.notebook_path ?? '');
    if (STATE_PATH.test(file)) return block('.ade/state.json and .ade/cycles are written by ade only. Read state with `ade status --json`.');
    if (active && /(^|[\\/])ade\.config\.json$/.test(file)) return block('ade.config.json cannot change during an active cycle. Ask the human to edit it and run `ade approve config`.');
    return { block: false };
  }
  if (SHELL_TOOLS.has(tool)) {
    const c = String(input.command ?? '');
    if (/\b(?:ade|awesome-delivery-engine)\s+(approve|reset|rollback)\b/.test(c)) return block('`ade approve`, `ade reset` and `ade rollback` are for humans. Ask the human to run it.');
    if (/--no-verify\b/.test(c)) return block('--no-verify is not allowed. Fix what the hook reports.');
    if (/\bgit\s+push\b[^|;&]*\s(--force|-f)\b/.test(c)) return block('force push is not allowed.');
    if (STATE_PATH.test(c) && !READ_ONLY.test(c)) return block('.ade/state.json and .ade/cycles are written by ade only. Read state with `ade status --json`.');
    if (active && /ade\.config\.json/.test(c) && /(>|\bsed\s+-i|\btee\b|\brm\b|\bmv\b|\bcp\b)/.test(c)) {
      return block('ade.config.json cannot change during an active cycle. Ask the human to edit it and run `ade approve config`.');
    }
  }
  return { block: false };
}
