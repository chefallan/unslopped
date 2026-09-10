import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { loadState, proposalPath, saveState, STATE_DIR } from './state.ts';
import { briefEvidence } from './brief.ts';
import { isRepo, currentBranch, numstatSince, stagedFiles } from './git.ts';
import { protocolBody, START } from './protocol.ts';
import { account } from './tokens.ts';
import { statusLines } from './status.ts';
import { findIssueRef } from './detect.ts';
import { ASSISTANT_ID } from './practices.ts';
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

export function sessionContext(root: string, cmd = 'unslopped', home = homeDir(), instructionFile = 'CLAUDE.md'): string {
  if (!isRepo(root)) return '';
  const config = loadConfig(root);
  const full = protocolBody(cmd);
  const carried = projectCarriesProtocol(root, instructionFile);
  const lines = [carried ? `Unslopped protocol: follow the unslopped block in ${instructionFile}. It is not repeated here.` : full, ''];
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

export function promptContext(root: string, prompt: string, cmd = 'unslopped', home = homeDir()): string {
  if (!isRepo(root)) return '';
  const config = loadConfig(root);
  if (!config) return `unslopped: this project is not initialized. Run \`${cmd} init\` first, then handle the request.\n`;
  const state = loadState(root);
  const p = String(prompt ?? '');
  if (config.memory.history && p.trim()) {
    appendHistory(root, { at: new Date().toISOString(), prompt: p.slice(0, 500), cycle: state.cycle?.id ?? null });
  }
  if (state.cycle) {
    const text = ['unslopped: active cycle', ...statusLines(root, config, state, cmd).map((l) => '  ' + l), `Continue this cycle: \`${cmd} resume\` lists the next actions. Advance with \`${cmd} next\`.`, ...memoryLines(root, home, p, cmd, config.graph)].join('\n') + '\n';
    accountHook(root, state, text.length, text.length);
    return text;
  }
  const goal = p.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 120) ?? '';
  const provider = config.tracker.provider;
  const issue = findIssueRef(p, provider) ?? findIssueRef(currentBranch(root), provider, { branch: true });
  const lines = ['unslopped: no active cycle.'];
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
const STATE_PATH = /\.unslopped[\\/](state\.json|cycles)/;
const READ_ONLY = /^\s*(cat|type|less|more|head|tail|grep|unslopped|npx\s+unslopped)\b/;

const HUMAN_ONLY = /(^|[|&;(]\s*)(?:npx\s+)?(?:unslopped|ade|awesome-delivery-engine)\s+(approve|reset|rollback)\b/m;
const GIT_COMMIT = /(^|[|&;(]\s*)git\b(?:\s+-[cC]\s+\S+|\s+--?[A-Za-z][^\s|;&]*)*\s+commit\b/m;
const COMMIT_ALL = /\s(?:--all\b|-[A-Za-z]*a[A-Za-z]*\b)/;
const GIT_PUSH_FORCE = /(^|[|&;(]\s*)git\s+push\b[^|;&\n]*\s(--force|-f)\b/m;
const CONFIG_FILE_NAME = /(?:unslopped|ade)\.config\.json/;
const CONFIG_WRITE = new RegExp(`>>?\\s*\\S*${CONFIG_FILE_NAME.source}|\\b(?:sed\\s+-i|tee|rm|mv|cp)\\b[^|;&\\n]*${CONFIG_FILE_NAME.source}`);

function commandView(command: string): string {
  const heredoc = command.search(/<<-?\s*['"]?\w/);
  return heredoc === -1 ? command : command.slice(0, heredoc);
}

export interface Decision {
  block: boolean;
  ask?: boolean;
  reason?: string;
}

function block(reason: string): Decision {
  return { block: true, reason };
}

function askHuman(reason: string): Decision {
  return { block: false, ask: true, reason };
}

export function toolDecision(root: string, toolName: unknown, input: Record<string, unknown> = {}): Decision {
  const config = loadConfig(root);
  if (!config) return { block: false };
  const state = loadState(root);
  const active = Boolean(state.cycle);
  const tool = String(toolName ?? '');
  if (EDIT_TOOLS.has(tool)) {
    const file = String(input.file_path ?? input.notebook_path ?? '');
    if (STATE_PATH.test(file)) return block('.unslopped/state.json and .unslopped/cycles are written by unslopped only. Read state with `unslopped status --json`.');
    if (active && /(^|[\\/])(?:unslopped|ade)\.config\.json$/.test(file)) return block('unslopped.config.json cannot change during an active cycle. Ask the human to edit it and run `unslopped approve config`.');
    return { block: false };
  }
  if (SHELL_TOOLS.has(tool)) {
    const c = commandView(String(input.command ?? ''));
    const humanOnly = c.match(HUMAN_ONLY);
    if (humanOnly) {
      if (config.approvals === 'command') return block('`unslopped approve`, `unslopped reset` and `unslopped rollback` are for humans. Ask the human to run it.');
      const cycle = state.cycle;
      const verb = humanOnly[2];
      if (verb === 'approve') {
        const target = c.match(/approve\s+(deploy|config|review|commit|pr)\b/)?.[1] ?? 'this';
        const parts = [`The human decides this. Allowing runs: unslopped approve ${target}${cycle ? ` for cycle ${cycle.id} ${JSON.stringify(cycle.goal)}` : ''}.`];
        if (target === 'commit' || target === 'pr') {
          try {
            parts.push(fs.readFileSync(proposalPath(root, target), 'utf8').trimEnd());
          } catch {
            parts.push('nothing is pending; the command will refuse if allowed.');
          }
        }
        if (target === 'deploy') {
          if (cycle) parts.push(...briefEvidence(root, config, cycle));
          else parts.push('nothing is pending, no cycle is active; the command will refuse if allowed.');
        }
        if (!cycle && target !== 'deploy' && target !== 'commit' && target !== 'pr') parts.push('nothing is pending, no cycle is active; the command will refuse if allowed.');
        return askHuman(parts.join('\n'));
      }
      if (verb === 'reset') {
        const what = cycle
          ? `Allowing abandons cycle ${cycle.id} ${JSON.stringify(cycle.goal ?? '')} at phase ${cycle.phase} and archives it as abandoned.`
          : 'No cycle is active; the command will refuse.';
        return askHuman(`The human decides this. ${what}`);
      }
      return askHuman(`The human decides this. Allowing runs the rollback command: ${config.commands.rollback ?? '(none configured; the command will refuse)'}.`);
    }
    if (/--no-verify\b/.test(c)) return block('--no-verify is not allowed. Fix what the hook reports.');
    if (GIT_COMMIT.test(c) && /co-authored-by/i.test(c) && ASSISTANT_ID.test(c)) {
      return block('commits carry the human as the only author. Drop the assistant co-author trailer and commit again.');
    }
    if (config.practices.messageApproval && GIT_COMMIT.test(c)) {
      if (active) {
        return block('commit messages need the human to approve them first. Propose with `unslopped propose commit "<type(scope): subject>"`, ask the human to run `unslopped approve commit`, then run `unslopped commit`.');
      }
      const sweeps = COMMIT_ALL.test(c) ? numstatSince(root, null).map((f) => f.file.replace(/\\/g, '/')) : [];
      const source = [...new Set([...stagedFiles(root), ...sweeps])].filter((f) => !f.startsWith(`${STATE_DIR}/`));
      if (source.length) {
        const shown = source.slice(0, 3).join(', ') + (source.length > 3 ? `, +${source.length - 3} more` : '');
        return block(`no cycle is active, so this commit carries no approved message, and it stages ${source.length} file(s) outside ${STATE_DIR}/: ${shown}. start a cycle so the message goes through propose and approve, or leave this commit to the human.`);
      }
    }
    if (GIT_PUSH_FORCE.test(c)) return block('force push is not allowed.');
    if (STATE_PATH.test(c) && !READ_ONLY.test(c)) return block('.unslopped/state.json and .unslopped/cycles are written by unslopped only. Read state with `unslopped status --json`.');
    if (active && CONFIG_WRITE.test(c)) {
      return block('unslopped.config.json cannot change during an active cycle. Ask the human to edit it and run `unslopped approve config`.');
    }
  }
  return { block: false };
}
