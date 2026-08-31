import fs from 'node:fs';
import path from 'node:path';
import { protocol, pointerBlock, START, END } from './protocol.ts';
import { configPath, defaultConfig, loadConfig, saveConfig } from './config.ts';
import { plansDir } from './state.ts';
import { detectTracker, applyDetection } from './detect.ts';
import { ensureGraph } from './graph.ts';
import type { Config, Env, Provider } from './types.ts';

interface Target {
  file: string;
  header?: string;
  note?: string;
}

export const TARGETS: Record<string, Target> = {
  agents: { file: 'AGENTS.md', note: 'Codex, OpenCode, Amp, Copilot CLI, Cursor, Jules and others' },
  claude: { file: 'CLAUDE.md' },
  gemini: { file: 'GEMINI.md' },
  copilot: { file: path.join('.github', 'copilot-instructions.md') },
  windsurf: { file: path.join('.windsurf', 'rules', 'ade.md') },
  cursor: {
    file: path.join('.cursor', 'rules', 'ade.mdc'),
    header: '---\ndescription: ADE SDLC protocol\nalwaysApply: true\n---\n\n',
  },
  cline: { file: path.join('.clinerules', 'ade.md') },
  roo: { file: path.join('.roo', 'rules', 'ade.md') },
  kilo: { file: path.join('.kilocode', 'rules', 'ade.md') },
  continue: { file: path.join('.continue', 'rules', 'ade.md') },
  junie: { file: path.join('.junie', 'guidelines.md') },
  amazonq: { file: path.join('.amazonq', 'rules', 'ade.md') },
  kiro: { file: path.join('.kiro', 'steering', 'ade.md') },
  augment: { file: path.join('.augment', 'rules', 'ade.md') },
  trae: { file: path.join('.trae', 'rules', 'project_rules.md') },
  aider: { file: 'CONVENTIONS.md' },
  goose: { file: '.goosehints' },
  zed: { file: '.rules' },
  warp: { file: 'WARP.md' },
  crush: { file: 'CRUSH.md' },
};

export const ALL_ASSISTANTS = Object.keys(TARGETS);

export function upsertBlock(existing: string, block: string): string {
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    return existing.slice(0, s) + block.trimEnd() + existing.slice(e + END.length);
  }
  if (!existing.trim()) return block;
  return existing.trimEnd() + '\n\n' + block;
}

const READS_AGENTS_MD = new Set(['cursor', 'copilot']);

function writeTarget(root: string, key: string, pointer = false): string {
  const t = TARGETS[key];
  if (!t) throw new Error(`unknown assistant: ${key}. valid: ${Object.keys(TARGETS).join(', ')}`);
  const file = path.join(root, t.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let next = upsertBlock(existing, pointer ? pointerBlock() : protocol());
  if (t.header && !next.startsWith('---')) next = t.header + next;
  fs.writeFileSync(file, next);
  return t.file;
}

function ensureGitignore(root: string): boolean {
  const file = path.join(root, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const wanted = ['.ade/state.json', '.ade/cycles/', '.ade/history.jsonl', '.ade/logs/', '.ade/worktrees/', '.ade/graph.json', '.ade/graph.html', '.ade/GRAPH.md'];
  const missing = wanted.filter((w) => !existing.split(/\r?\n/).includes(w));
  if (missing.length === 0) return false;
  fs.writeFileSync(file, (existing.trimEnd() + '\n' + missing.join('\n') + '\n').replace(/^\n/, ''));
  return true;
}

export interface InitOptions {
  force?: boolean;
  only?: string[] | null;
  all?: boolean;
  tracker?: Provider | null;
  env?: Env;
  ci?: boolean;
}

export interface InitResult {
  configCreated: boolean;
  configFile: string;
  written: string[];
  gitignore: boolean;
  config: Config;
  detected: string | null;
  ciFile: string | null;
  prTemplateFile: string | null;
  gitHooks: string[];
}

export const CI_WORKFLOW_FILE = path.join('.github', 'workflows', 'ade-review.yml');

export function ciWorkflow(): string {
  return `name: ADE review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Review the pull request with ADE
        run: npx -y awesome-delivery-engine review --pr=\${{ github.event.pull_request.number }}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          # Add the secrets your practices.reviewCommand needs, for example:
          # ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`;
}

const GIT_HOOK_MARK = '# ade: refresh the code map';
const GIT_HOOK_LINE = 'command -v ade >/dev/null 2>&1 && ade graph refresh --quiet >/dev/null 2>&1 || true';

export function installGitHooks(root: string): string[] {
  const hooksDir = path.join(root, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) return [];
  const written: string[] = [];
  for (const name of ['post-commit', 'post-checkout', 'post-merge']) {
    const file = path.join(hooksDir, name);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (existing.includes(GIT_HOOK_MARK)) continue;
    const next = existing.trim() ? `${existing.trimEnd()}\n${GIT_HOOK_MARK}\n${GIT_HOOK_LINE}\n` : `#!/bin/sh\n${GIT_HOOK_MARK}\n${GIT_HOOK_LINE}\n`;
    fs.writeFileSync(file, next);
    try {
      fs.chmodSync(file, 0o755);
    } catch {
      continue;
    }
    written.push(`.git/hooks/${name}`);
  }
  return written;
}

export function writeCiWorkflow(root: string, force = false): string | null {
  const file = path.join(root, CI_WORKFLOW_FILE);
  if (fs.existsSync(file) && !force) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ciWorkflow());
  return CI_WORKFLOW_FILE;
}

export const PR_TEMPLATE_FILE = path.join('.github', 'pull_request_template.md');

export function prTemplate(): string {
  return `## Why

<!-- One or two sentences: the intent, what breaks or stays broken without this. -->

## What changed

<!-- Behavior after merge, not a tour of the diff. Say what the diff cannot. -->

## Review focus

<!-- The risky calls. Boundary, security or product-behavior changes. Decisions
     made at pickup a reviewer could push back on. Verification done beyond CI.
     Deliberate non-changes. -->

<!-- Write for the reviewer deciding whether to approve. Skip file lists, test
     counts and command logs: CI and the diff already show those. -->
`;
}

export function writePrTemplate(root: string): string | null {
  const file = path.join(root, PR_TEMPLATE_FILE);
  if (fs.existsSync(file)) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, prTemplate());
  return PR_TEMPLATE_FILE;
}

export function init(root: string, { force = false, only = null, all = false, tracker = null, env = process.env, ci = false }: InitOptions = {}): InitResult {
  const written: string[] = [];
  let config = force ? null : loadConfig(root);
  let configCreated = false;
  let detected: string | null = null;
  if (!config) {
    config = defaultConfig(root);
    configCreated = true;
  }
  if (tracker) {
    config.tracker = { ...config.tracker, provider: tracker };
  } else if (!config.tracker.provider) {
    const d = detectTracker(root, env);
    if (d.provider) {
      config.tracker = applyDetection(config.tracker, d);
      detected = d.evidence[0].split(': ')[1];
    }
  }
  if (all) config.assistants = [...ALL_ASSISTANTS];
  if (configCreated || tracker || detected || all) saveConfig(root, config);
  const targets = only ?? config.assistants;
  const usePointers = config.tokens.pointerFiles !== false && targets.includes('agents');
  for (const key of targets) written.push(writeTarget(root, key, usePointers && READS_AGENTS_MD.has(key)));
  fs.mkdirSync(plansDir(root), { recursive: true });
  const gitignore = ensureGitignore(root);
  const ciFile = ci ? writeCiWorkflow(root, force) : null;
  const prTemplateFile = ci ? writePrTemplate(root) : null;
  const gitHooks = config.graph.enabled ? installGitHooks(root) : [];
  if (config.graph.enabled) ensureGraph(root, config.graph);
  return { configCreated, configFile: configPath(root), written, gitignore, config, detected, ciFile, prTemplateFile, gitHooks };
}
