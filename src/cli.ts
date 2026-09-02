import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PHASES, nextPhase, phaseIndex } from './phases.ts';
import { statusLines } from './status.ts';
import { install, uninstall, onPath } from './install.ts';
import { readStdinJson, readStdinText, sessionContext, promptContext, toolDecision } from './hooks.ts';
import { loadConfig, saveConfig, configHash, textHash, CONFIG_FILE } from './config.ts';
import { loadState, saveState, newCycle, archiveCycle, archivedCycles, planPath, planTemplate, plansDir, proposalPath, stateDir, STATE_DIR } from './state.ts';
import { resumeLines } from './resume.ts';
import { briefEvidence } from './brief.ts';
import { runGate, describeGate } from './gates.ts';
import { init } from './init.ts';
import { isRepo, headSha, currentBranch, addWorktree, commitsSinceDate, porcelain, addedLines } from './git.ts';
import { scanExploitable } from './vulns.ts';
import { runCommand } from './run.ts';
import { digest, account } from './tokens.ts';
import { changedTestFiles, configSecretProblem, countFindings, planSection, redactSecrets } from './practices.ts';
import { addDebt, debtCounts, listDebt, removeDebtEntries, DEBT_CATEGORIES } from './debt.ts';
import { formatCandidates, nextCycleCandidates, seedPlanWithDebt, selectDebt, sweepGoal, DEBT_SELECTORS } from './loop.ts';
import type { DebtSelector } from './loop.ts';
import { createDecision, listDecisions } from './decisions.ts';
import type { DebtCategory } from './debt.ts';
import { createTracker, notifyTracker, requiredSettings, mergeTracker, PROVIDERS } from './tracker.ts';
import { detectTracker, applyDetection, discoverSecrets, findIssueRef } from './detect.ts';
import { listSkills, loadSkill, saveSkill, matchSkills, learnFromCycle, health, skillsDir, globalSkillsDir, addPreference, readProfile, refreshDetected, profilePath, globalProfilePath, recall } from './memory.ts';
import { reportLines, summarize } from './tokens.ts';
import { branchSuggestion, protectedBranchProblem } from './practices.ts';
import { computeMetrics, metricsLines } from './metrics.ts';
import { openPullRequest, pullRequestStatus, reviewPullRequest } from './pr.ts';
import { ensureGraph, findFile, formatHits, formatNode, formatPath, fullReport, loadGraph, nodeView, queryGraph, queryRationale, refreshGraph, shortestPath, writeHtml, writeReport } from './graph.ts';
import { computeImpact, formatImpact, localChanges } from './impact.ts';
import type { Config, Cycle, Deps, Env, Flags, GateResult, Issue, Provider, ReviewRecord, SkillMatch, State, Writer } from './types.ts';

const HELP = `unslopped <command>

  the loop: you prompt, the assistant starts a cycle, and the phases run:
  plan, code, build, test, release, deploy, operate, monitor. every phase
  ends in a gate that runs real commands and reads exit codes.

  your moments: answer the design questions, approve commit, approve pr,
  approve deploy, merge the pull request. everything else runs itself.
  the long guide lives in the README.

  install [--only=claude,codex]            one time, per machine: hooks for Claude Code and Cursor, global rules for
                                           Codex, Gemini, Windsurf, Copilot, OpenCode, Cline, Roo, Kilo, Continue, Goose
  uninstall [--only=...]                   remove what install wrote
  init [--force] [--all] [--only=claude,cursor] [--tracker=linear] [--ci]
                                           per project: write unslopped.config.json and assistant instruction files.
                                           --ci adds a GitHub Actions workflow that reviews every pull request
  status [--json]                          show the active cycle and its phase
  resume                                   where the active cycle stands and what to do next (alias: continue)
  start "<goal>" [--issue=KEY] [--no-issue] [--worktree] [--from-debt[=cleanup|pattern|soon|all]]
                                           begin a cycle at the plan phase. issue keys in the goal or branch name are linked automatically.
                                           --worktree runs the cycle in its own checkout on a new branch.
                                           --from-debt seeds the plan from the debt log; swept entries clear on completion
  check [--json] [--full]                  run the current phase gate without advancing
  next [--json] [--full]                   run the current phase gate and advance on pass. --full prints raw output
  red                                      run the tests expecting a failure and record it (TDD evidence for the test gate)
  review [--file=review.md]                record a code review from practices.reviewCommand, a file, or stdin
  review --pr=<n> [--approve] [--no-post]  review a GitHub pull request and post the findings as a PR review
  pr [--draft]                             push the branch and open a GitHub pull request from the plan
  pr status [--number=<n>]                 show the PR state; on merge tell the tracker and move the issue to done
  tokens [--json]                          token accounting: gate output shown vs raw, hook context, per cycle and total
  metrics [--json]                         lead time, deployment frequency, change failure rate, recovery time, gate first-pass rates
  approve deploy|config|review|commit|pr   record a human approval
  propose commit "<subject>" [--file=<body.md>]
                                           write the commit message for the human to review
  commit                                   create the commit from the approved proposal
  rollback                                 run commands.rollback (humans only)
  log                                      print gate history for the active cycle
  tracker [--issue=KEY]                    show tracker settings, optionally fetch an issue
  reset ["<goal>"] [start flags]           abandon the active cycle; with a goal, start the next one in the same step
  skills [--json]                          list learned skills with health
  skill show|save|rm <name|"title">        read, write ([--file=notes.md] [--global]) or delete a skill
  debt "<what>" [--where=path] [--category=cleanup|pattern|soon|accepted]
                                           log a known deviation to .unslopped/DEBT.md instead of fixing it out of scope
  debt                                     list the logged debt by category
  decide "<title>"                         scaffold docs/decisions/NNNN-<slug>.md for a decision others must follow
  decide                                   list recorded decisions with their status
  prefer "<statement>" [--project]         remember a user preference across sessions
  profile                                  show remembered and detected preferences
  recall "<words>" [--limit=5] [--json]    full-text search over skills, cycles, plans, prompts, preferences
  graph "<words>" [--limit=5] [--json]     query the code map: files, symbols, imports, importers. no words prints the map
  graph node <file>                        one file: symbols, rationale, what it imports and uses, who imports it and what they use
  graph path <from> <to>                   shortest import chain between two files
  graph why "<topic>"                      design rationale, constraints and debt markers mined from comments and docs
  graph impact [--since=<ref>] [files...]  what the current changes touch: symbols, dependents, covering tests, hot exports
  graph report                             write .unslopped/GRAPH.md: areas, god files, cross-area and surprising imports
  graph html                               write .unslopped/graph.html, an interactive map to open in a browser
  graph refresh [--quiet]                  rebuild the code map (runs by itself from hooks; rarely needed by hand)
  hook claude session|prompt|tool          called by Claude Code hooks, reads the event from stdin
  hook cursor shell                        called by the Cursor beforeShellExecution hook
  help

Trackers: ${PROVIDERS.join(', ')}. Detected from env vars, project files, the git remote and MCP configs.
Credentials come from env vars (or gh auth for GitHub), never from the config file.
Exit codes: 0 ok, 1 gate failed, 2 usage or state error.
`;

interface Parsed {
  command: string;
  args: string[];
  flags: Flags;
}

function parse(argv: string[]): Parsed {
  const flags: Flags = {};
  const args: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? true;
    } else {
      args.push(a);
    }
  }
  return { command: args[0] ?? 'help', args: args.slice(1), flags };
}

function str(flag: string | boolean | undefined): string | null {
  return typeof flag === 'string' ? flag : null;
}

function list(flag: string | boolean | undefined): string[] | null {
  const s = str(flag);
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null;
}

function out(io: Writer, line = ''): void {
  io.write(line + '\n');
}

function fail(io: Writer, msg: string): number {
  out(io, `error: ${msg}`);
  return 2;
}

function printChecks(io: Writer, result: GateResult): void {
  for (const c of result.checks) {
    const mark = c.ok ? 'ok  ' : 'FAIL';
    const [first, ...rest] = c.detail.split('\n');
    out(io, `  ${mark} ${c.name}: ${first}`);
    for (const l of rest) out(io, `         ${l}`);
  }
}

function requireCycle(io: Writer, state: State): Cycle | null {
  if (!state.cycle) {
    fail(io, 'no active cycle. run: unslopped start "<goal>"');
    return null;
  }
  return state.cycle;
}

function requireConfig(io: Writer, root: string): Config | null {
  const config = loadConfig(root);
  if (!config) {
    fail(io, `${CONFIG_FILE} not found. run: unslopped init`);
    return null;
  }
  const problem = configSecretProblem(config);
  if (problem) {
    fail(io, problem);
    return null;
  }
  return config;
}

function configDrift(io: Writer, config: Config, cycle: Cycle): boolean {
  const current = configHash(config);
  if (current === cycle.configHash) return false;
  out(io, `FAIL ${CONFIG_FILE} changed during this cycle (${cycle.configHash} -> ${current}).`);
  out(io, 'A human must review the change and run: unslopped approve config');
  return true;
}

function cmdInit(io: Writer, root: string, flags: Flags, deps: Deps): number {
  const tracker = str(flags.tracker);
  if (tracker && !(PROVIDERS as string[]).includes(tracker)) return fail(io, `unknown tracker "${tracker}". valid: ${PROVIDERS.join(', ')}`);
  const r = init(root, { force: Boolean(flags.force), only: list(flags.only), all: Boolean(flags.all), tracker: tracker as Provider | null, env: deps.env, ci: Boolean(flags.ci) });
  out(io, `${r.configCreated ? 'wrote' : 'kept'} ${CONFIG_FILE}`);
  for (const f of r.written) out(io, `wrote ${f}`);
  if (r.ciFile) out(io, `wrote ${r.ciFile} (set practices.reviewCommand and any secrets it needs in the repository settings)`);
  if (r.prTemplateFile) out(io, `wrote ${r.prTemplateFile} (GitHub pre-fills it into PRs opened by hand)`);
  for (const h of r.gitHooks) out(io, `wrote ${h} (refreshes the code map after commits and checkouts)`);
  if (r.gitignore) out(io, 'updated .gitignore');
  const c = r.config.commands;
  out(io);
  out(io, 'commands:');
  for (const k of Object.keys(c) as Array<keyof typeof c>) out(io, `  ${k.padEnd(12)} ${c[k] ?? '(not set)'}`);
  out(io, `tracker: ${r.config.tracker.provider ?? '(none detected)'}${r.detected ? ` (${r.detected})` : ''}`);
  const p = r.config.practices;
  out(io, `practices: plan sections ${p.planSections.join('/') || 'off'}, scope ${p.scope ? 'on' : 'off'}, test evidence ${p.testEvidence ? 'on' : 'off'}, tests kept ${p.testDeletion ? 'on' : 'off'}, coverage ${p.coverage ? `>= ${p.coverage.min}%` : 'off'}, diff limit ${p.maxDiffLines || 'off'}, secret scan ${p.secretScan ? 'on' : 'off'}, style ${p.style ? 'on' : 'off'}, commit format ${p.commitPattern ? 'on' : 'off'}, changelog ${p.changelog ? 'on' : 'off'}, protected branches ${p.protectedBranches.join(', ') || 'none'}, guarded paths ${p.guardedPaths.length}, audit ${p.audit ?? 'off'}, security scan ${p.securityScan ?? 'off'}`);
  if (!c.test) out(io, `\nset commands.test in ${CONFIG_FILE}. the test gate cannot pass without it.`);
  if (!isRepo(root)) out(io, '\nnot a git repository. run git init before starting a cycle.');
  return 0;
}

function cmdStatus(io: Writer, root: string, flags: Flags): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  if (flags.json) {
    out(io, JSON.stringify(state, null, 2));
    return 0;
  }
  for (const line of statusLines(root, config, state)) out(io, line);
  return 0;
}

function cmdInstall(io: Writer, flags: Flags, deps: Deps, remove: boolean): number {
  const opts = { only: list(flags.only), env: deps.env, platform: process.platform };
  if (remove) {
    const r = uninstall(deps.home, opts);
    for (const x of r.removed) out(io, `cleaned ${x.file}`);
    if (!r.removed.length) out(io, 'nothing to remove');
    return 0;
  }
  const r = install(deps.home, opts);
  for (const x of r.written) out(io, `wrote ${x.file}  (${x.key}: ${x.note})`);
  out(io);
  out(io, 'every project you open now gets the protocol. run `unslopped init` in a project once to set its commands, or let the assistant do it.');
  if (!onPath('unslopped')) out(io, '\nWARN unslopped is not on PATH. hooks call `unslopped`. install it globally: npm i -g unslopped');
  return 0;
}

function cmdHook(io: Writer, root: string, args: string[], deps: Deps): number {
  const [assistant, event] = args;
  const input = deps.stdin ?? readStdinJson();
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
  if (assistant === 'claude') {
    if (event === 'session') {
      io.write(sessionContext(cwd, 'unslopped', deps.home));
      return 0;
    }
    if (event === 'prompt') {
      io.write(promptContext(cwd, String(input.prompt ?? ''), 'unslopped', deps.home));
      return 0;
    }
    if (event === 'tool') {
      const d = toolDecision(cwd, input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
      if (!d.block) return 0;
      deps.stderr.write(`unslopped: ${d.reason}\n`);
      return 2;
    }
  }
  if (assistant === 'cursor' && event === 'shell') {
    const d = toolDecision(cwd, 'Bash', { command: input.command });
    const verdict = d.block ? { permission: 'deny', userMessage: `unslopped: ${d.reason}`, agentMessage: `unslopped: ${d.reason}` } : { permission: 'allow' };
    io.write(JSON.stringify(verdict) + '\n');
    return 0;
  }
  return fail(io, 'usage: unslopped hook claude session|prompt|tool, unslopped hook cursor shell');
}

async function resolveIssue(io: Writer, config: Config, ref: string, deps: Deps): Promise<Issue> {
  const fallback: Issue = { key: ref, title: ref, description: '', url: null };
  let tracker;
  try {
    tracker = createTracker(config, deps.env, deps.fetchImpl);
  } catch (e) {
    out(io, `WARN tracker: ${(e as Error).message}`);
    return fallback;
  }
  if (!tracker) {
    out(io, `WARN tracker.provider is not set in ${CONFIG_FILE}. issue ${ref} recorded as a reference only.`);
    return fallback;
  }
  try {
    return await tracker.fetchIssue(ref);
  } catch (e) {
    out(io, `WARN tracker: ${(e as Error).message}`);
    return fallback;
  }
}

function autoDetect(io: Writer, root: string, config: Config, env: Env): Config {
  if (config.tracker.provider) return config;
  const detected = detectTracker(root, env);
  if (!detected.provider) return config;
  config.tracker = applyDetection(config.tracker, detected);
  saveConfig(root, config);
  out(io, `detected tracker ${detected.provider} (${detected.evidence[0].split(': ')[1]}), saved to ${CONFIG_FILE}`);
  return config;
}

function inferIssue(io: Writer, root: string, goal: string, provider: Provider | null): string | null {
  const fromGoal = findIssueRef(goal, provider);
  if (fromGoal) {
    out(io, `linked issue ${fromGoal} found in the goal`);
    return fromGoal;
  }
  const branch = currentBranch(root);
  const fromBranch = findIssueRef(branch, provider, { branch: true });
  if (fromBranch) out(io, `linked issue ${fromBranch} found in branch ${branch}`);
  return fromBranch;
}

function createWorktree(io: Writer, root: string, config: Config, branch: string): string | null {
  const dir = path.join(stateDir(root), 'worktrees', branch.replace(/[\\/]+/g, '-'));
  if (fs.existsSync(dir)) {
    fail(io, `worktree ${dir} already exists. remove it with: git worktree remove ${dir}`);
    return null;
  }
  const r = addWorktree(root, dir, branch);
  if (!r.ok) {
    fail(io, `git worktree add failed: ${r.err || r.out}`);
    return null;
  }
  for (const rel of [CONFIG_FILE, '.gitignore', path.join('.unslopped', 'skills'), path.join('.unslopped', 'profile.md')]) {
    const src = path.join(root, rel);
    const dst = path.join(dir, rel);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(src, dst, { recursive: true });
    }
  }
  out(io, `worktree created at ${dir} on branch ${branch}`);
  if (config.commands.setup) {
    out(io, `running setup: ${config.commands.setup}`);
    const s = runCommand(config.commands.setup, dir);
    if (s.code !== 0) out(io, `WARN setup exited ${s.code}\n${digest(s.output, { lines: 8 }).text}`);
  }
  return dir;
}

function cmdRed(io: Writer, root: string): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  if (!config.commands.test) return fail(io, `commands.test is not set in ${CONFIG_FILE}`);
  const tests = changedTestFiles(root, cycle.startCommit, config.practices.testPatterns);
  if (!tests.length) return fail(io, 'no test file changed since the cycle started. write the failing test first, then run unslopped red');
  const r = runCommand(config.commands.test, root);
  const d = digest(redactSecrets(r.output).text, { lines: config.tokens.outputLines });
  if (r.code === 0) {
    out(io, 'tests pass. nothing is red. the new test must fail before you implement; make it fail for the right reason, then run unslopped red again');
    return 1;
  }
  cycle.red ??= [];
  cycle.red.push({ at: new Date().toISOString(), code: r.code, testFiles: tests, summary: d.text.split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 200) });
  account(cycle, 'gate', r.output.length, d.text.length);
  saveState(root, state);
  out(io, `red recorded (exit ${r.code}) for ${tests.join(', ')}`);
  for (const l of d.text.split('\n')) out(io, `  ${l}`);
  out(io, 'now implement until green, then: unslopped next');
  return 0;
}

async function cmdPr(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): Promise<number> {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  deps = { ...deps, env: discoverSecrets({ tracker: { ...config.tracker, provider: 'github' } }, deps.env, root) };
  if (args[0] === 'status') {
    const n = str(flags.number);
    return pullRequestStatus(io, root, config, state, deps, n ? Number(n) : null);
  }
  if (args[0] && args[0] !== 'open') return fail(io, 'usage: unslopped pr [--draft], unslopped pr status [--number=<n>]');
  return openPullRequest(io, root, config, state, deps, { draft: flags.draft ? true : undefined });
}

async function cmdReview(io: Writer, root: string, flags: Flags, deps: Deps): Promise<number> {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const prNumber = str(flags.pr);
  if (prNumber !== null || flags.pr === true) {
    const n = Number(prNumber);
    if (!Number.isInteger(n) || n <= 0) return fail(io, 'usage: unslopped review --pr=<number> [--file=review.md] [--approve] [--no-post]');
    deps = { ...deps, env: discoverSecrets({ tracker: { ...config.tracker, provider: 'github' } }, deps.env, root) };
    return reviewPullRequest(io, root, config, deps, n, flags);
  }
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  const dir = path.join(stateDir(root), 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${cycle.id}.md`);
  let text = '';
  let source: ReviewRecord['source'];
  const fromFile = str(flags.file);
  if (fromFile) {
    text = fs.readFileSync(fromFile, 'utf8');
    source = 'file';
  } else if (config.practices.reviewCommand) {
    out(io, `running reviewer: ${config.practices.reviewCommand}`);
    const before = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
    const r = runCommand(config.practices.reviewCommand, root, { env: { UNSLOPPED_CYCLE_ID: cycle.id, UNSLOPPED_BASE_COMMIT: cycle.startCommit ?? '', UNSLOPPED_REVIEW_FILE: file, UNSLOPPED_ROOT: root } });
    if (r.code !== 0) {
      out(io, `reviewer exited ${r.code}`);
      out(io, digest(r.output, { lines: config.tokens.outputLines }).text);
      return 1;
    }
    const wroteFile = fs.existsSync(file) && fs.statSync(file).mtimeMs > before;
    text = wroteFile ? fs.readFileSync(file, 'utf8') : r.output;
    source = 'command';
  } else {
    text = deps.stdinText ?? readStdinText();
    source = 'stdin';
    if (!text.trim()) return fail(io, 'usage: unslopped review --file=<review.md>, pipe the review on stdin, or set practices.reviewCommand');
  }
  if (config.practices.exploitScan) {
    const risky = scanExploitable(addedLines(root, cycle.startCommit), config.practices.testPatterns);
    if (risky.length) {
      text = `${risky.map((f) => `- [major] ${f.text}`).join('\n')}\n${text}`;
      out(io, `${risky.length} exploitable-looking line(s) added as findings`);
    }
  }
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
  const counts = countFindings(text);
  cycle.review = { at: new Date().toISOString(), file: path.relative(root, file).replace(/\\/g, '/'), source, ...counts };
  saveState(root, state);
  out(io, `review recorded: ${cycle.review.file} (${counts.critical} critical, ${counts.major} major, ${counts.minor} minor, from ${source})`);
  if (counts.critical) out(io, 'critical findings block release. fix them, commit, and run unslopped review again');
  return 0;
}

function withMemory(template: string, matches: SkillMatch[], prefs: string[], code: string[]): string {
  const skills = matches.length ? matches.map((m) => `- ${m.name} (${m.health}, ${m.runs} run(s)): ${m.file}`).join('\n') : '- none saved yet';
  const preferences = prefs.length ? prefs.join('\n') : '- none remembered yet';
  const relevant = code.length ? code.join('\n') : '- no matching files in the code map yet';
  return template.replace('## Acceptance criteria', `## Relevant code\n${relevant}\n\n## Relevant skills\n${skills}\n\n## Preferences\n${preferences}\n\n## Acceptance criteria`);
}

function relevantCode(root: string, config: Config, goal: string): string[] {
  const graph = ensureGraph(root, config.graph);
  if (!graph) return [];
  return queryGraph(graph, goal, 5).map((h) => `- ${h.file}${h.symbols.length ? `: ${h.symbols.slice(0, 6).join(', ')}` : ''}${h.importedBy.length ? ` (imported by ${h.importedBy.length})` : ''}`);
}

async function cmdStart(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): Promise<number> {
  let config = requireConfig(io, root);
  if (!config) return 2;
  let goal = args.join(' ').trim();
  const explicit = str(flags.issue)?.trim() ?? null;
  let sweep: ReturnType<typeof selectDebt> | null = null;
  if (flags['from-debt']) {
    const selector = (str(flags['from-debt']) ?? 'cleanup') as DebtSelector;
    if (!DEBT_SELECTORS.includes(selector)) return fail(io, `unknown debt selector "${selector}". valid: ${DEBT_SELECTORS.join(', ')}`);
    sweep = selectDebt(root, selector);
    if (!sweep.length) return fail(io, `no ${selector === 'all' ? 'sweepable' : selector} entries in the debt log. see: unslopped debt`);
    if (!goal) goal = sweepGoal(selector, sweep.length);
  }
  if (!goal && !explicit) return fail(io, 'usage: unslopped start "<goal>" [--issue=KEY] [--no-issue] [--from-debt]');
  const state = loadState(root);
  if (state.cycle) return fail(io, `cycle ${state.cycle.id} is active in phase ${state.cycle.phase}. finish it or run: unslopped reset`);
  if (!isRepo(root)) return fail(io, 'not a git repository. run git init first');
  config = autoDetect(io, root, config, deps.env);
  deps = { ...deps, env: discoverSecrets(config, deps.env, root) };
  const ref = explicit ?? (flags['no-issue'] ? null : inferIssue(io, root, goal, config.tracker.provider));
  const issue = ref ? await resolveIssue(io, config, ref, deps) : null;
  if (!goal && issue) goal = issue.title;
  if (issue?.updatedAt) {
    const days = Math.floor((Date.now() - Date.parse(issue.updatedAt)) / 86400000);
    const commits = commitsSinceDate(root, issue.updatedAt);
    if (days >= 7 || commits >= 20) out(io, `issue last updated ${days} day(s) ago, ${commits} commit(s) landed since. re-check its scope against the code as it is now before planning`);
  }
  const suggestion = branchSuggestion(goal || ref || 'work', ref);
  const useWorktree = Boolean(flags.worktree) || config.practices.worktree;
  let work = root;
  if (useWorktree) {
    const created = createWorktree(io, root, config, suggestion);
    if (!created) return 2;
    work = created;
  } else {
    const protectedProblem = protectedBranchProblem(config.practices, currentBranch(root), suggestion);
    if (protectedProblem) return fail(io, protectedProblem);
  }
  if (work === root) {
    const dirty = porcelain(root, { exclude: [STATE_DIR] }).split(/\r?\n/).filter(Boolean).length;
    if (dirty) out(io, `WARN ${dirty} uncommitted file(s) predate this cycle and will count toward its diff gates. commit or stash them first for a clean baseline`);
  }
  const matches = config.memory.skills ? matchSkills(root, deps.home, goal) : [];
  const cycle = newCycle(goal, configHash(config), headSha(work), issue);
  cycle.usedSkills = matches.filter((m) => m.strong).map((m) => m.name);
  if (useWorktree) cycle.worktree = work;
  refreshDetected(work);
  const prefs = readProfile(root, deps.home);
  fs.mkdirSync(plansDir(work), { recursive: true });
  const plan = planPath(work, cycle.id);
  if (!fs.existsSync(plan)) {
    let planText = withMemory(planTemplate(cycle), matches, prefs, relevantCode(work, config, goal));
    if (sweep) {
      planText = seedPlanWithDebt(planText, sweep);
      cycle.debt = sweep.map((e) => e.text);
    }
    fs.writeFileSync(plan, planText);
  }
  saveState(work, { cycle });
  if (sweep) out(io, `plan seeded with ${sweep.length} debt item(s); they clear from the log when this cycle completes`);
  out(io, `started cycle ${cycle.id}`);
  if (useWorktree) out(io, `worktree ${work}\ncd ${JSON.stringify(work)} before continuing. every unslopped command for this cycle runs there.`);
  if (issue) out(io, `issue ${issue.key}${issue.url ? ' ' + issue.url : ''}`);
  if (matches.length) out(io, `skills ${matches.map((m) => `${m.name} (${m.health}${m.strong ? ', reused' : ''})`).join(', ')}`);
  for (const m of matches.filter((m) => m.health === 'underperforming')) out(io, `WARN skill ${m.name} is underperforming (${m.runs} runs, ${m.gateFailures} gate failures). Fix its Notes during the monitor phase.`);
  if (prefs.length) out(io, `prefs  ${prefs.length} remembered, listed in the plan`);
  out(io, `phase plan (1/${PHASES.length})`);
  out(io, `fill in ${plan}, then run: unslopped next`);
  await notifyTracker({ config, cycle, event: { type: 'started', to: 'plan' }, io, env: deps.env, fetchImpl: deps.fetchImpl });
  return 0;
}

async function gate(io: Writer, root: string, flags: Flags, advance: boolean, deps: Deps): Promise<number> {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  if (configDrift(io, config, cycle)) return 1;
  if (cycle.issue) deps = { ...deps, env: discoverSecrets(config, deps.env, root) };
  const gateConfig: Config = flags.full ? { ...config, tokens: { ...config.tokens, mode: 'full' } } : config;
  const result = runGate(cycle.phase, { root, config: gateConfig, cycle });
  cycle.history.push({
    phase: cycle.phase,
    at: new Date().toISOString(),
    pass: result.pass,
    advanced: advance && result.pass,
    checks: result.checks,
  });
  if (flags.json) {
    out(io, JSON.stringify(result, null, 2));
  } else {
    out(io, `${cycle.phase} gate: ${result.pass ? 'pass' : 'FAIL'}`);
    printChecks(io, result);
  }
  if (!result.pass) {
    saveState(root, state);
    if (!flags.json) out(io, `\nfix the cause and run again. do not edit tests, ${CONFIG_FILE}, or .unslopped/state.json.`);
    return 1;
  }
  if (!advance) {
    saveState(root, state);
    return 0;
  }
  const from = cycle.phase;
  const following = nextPhase(from);
  if (!following) {
    archiveCycle(root, cycle, 'complete');
    saveState(root, { cycle: null });
    if (!flags.json) out(io, `\ncycle ${cycle.id} complete. archived to .unslopped/cycles/${cycle.id}.json`);
    if (cycle.worktree && !flags.json) out(io, `worktree ${cycle.worktree} kept. once the branch is merged: git worktree remove ${JSON.stringify(cycle.worktree)}`);
    if (config.memory.skills) {
      const learned = learnFromCycle(root, deps.home, cycle, 'complete');
      if (learned.action !== 'none' && !flags.json) out(io, `skill ${learned.name} ${learned.action} (${learned.health}): ${learned.file}`);
    }
    if (config.practices.handoffNote && cycle.issue) {
      try {
        const note = planSection(fs.readFileSync(planPath(root, cycle.id), 'utf8'), 'Handoff');
        const tr = createTracker(config, deps.env, deps.fetchImpl);
        if (note.trim() && tr) {
          await tr.comment(cycle.issue, `verification handoff for cycle ${cycle.id}:\n${note.trim()}`);
          if (!flags.json) out(io, `handoff note posted to ${cycle.issue.key}`);
        }
      } catch (e) {
        out(io, `WARN tracker: ${(e as Error).message}`);
      }
    }
    if (cycle.debt?.length) {
      const cleared = removeDebtEntries(root, cycle.debt);
      if (cleared && !flags.json) out(io, `cleared ${cleared} swept entrie(s) from .unslopped/DEBT.md`);
    }
    if (!flags.json) {
      const candidates = nextCycleCandidates(root, cycle);
      if (candidates.length) for (const l of formatCandidates(candidates)) out(io, l);
    }
    await notifyTracker({ config, cycle, event: { type: 'complete' }, io, env: deps.env, fetchImpl: deps.fetchImpl });
    return 0;
  }
  cycle.phase = following;
  saveState(root, state);
  if (!flags.json) {
    out(io, `\nnow in phase ${following} (${phaseIndex(following)}/${PHASES.length})`);
    out(io, `gate: ${describeGate(following, config)}`);
    if (following === 'deploy' && config.deploy.requireApproval) out(io, 'deploy needs a human: unslopped approve deploy');
    if (following === 'release' && config.practices.reviewApproval) out(io, 'release needs a reviewer: unslopped approve review');
  }
  if (from === 'release' && config.practices.pullRequest.auto && !cycle.pr) {
    const prDeps = { ...deps, env: discoverSecrets({ tracker: { ...config.tracker, provider: 'github' } }, deps.env, root) };
    const code = await openPullRequest(io, root, config, state, prDeps);
    if (code !== 0 && !flags.json) out(io, 'WARN pull request not opened. run unslopped pr when the repository and token are available');
  }
  await notifyTracker({ config, cycle, event: { type: 'advanced', from, to: following }, io, env: deps.env, fetchImpl: deps.fetchImpl });
  return 0;
}

function cmdApprove(io: Writer, root: string, args: string[]): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const what = args[0];
  if (!['deploy', 'config', 'review', 'commit', 'pr'].includes(what)) return fail(io, 'usage: unslopped approve deploy|config|review|commit|pr');
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  if (what === 'commit' || what === 'pr') {
    const file = proposalPath(root, what);
    if (!fs.existsSync(file)) return fail(io, `nothing proposed for ${what} yet`);
    const text = fs.readFileSync(file, 'utf8');
    cycle.approvals[what] = { at: new Date().toISOString(), hash: textHash(text) };
    saveState(root, state);
    out(io, `approved this ${what === 'commit' ? 'commit message' : 'pull request text'}:`);
    for (const l of text.trimEnd().split('\n')) out(io, `  ${l}`);
    out(io, `the assistant can now run: unslopped ${what === 'commit' ? 'commit' : 'pr'}`);
    return 0;
  }
  cycle.approvals[what] = { at: new Date().toISOString() };
  if (what === 'config') cycle.configHash = configHash(config);
  saveState(root, state);
  if (what === 'deploy') {
    out(io, 'you signed off on:');
    for (const l of briefEvidence(root, config, cycle)) out(io, l);
  }
  out(io, `approved ${what} for cycle ${cycle.id}`);
  return 0;
}

function cmdPropose(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  const usage = 'usage: unslopped propose commit "<type(scope): subject>" [--file=<body.md>]';
  if (args[0] !== 'commit') return fail(io, usage);
  const subject = args.slice(1).join(' ').trim();
  if (!subject) return fail(io, usage);
  const fromFile = str(flags.file);
  const body = (fromFile ? fs.readFileSync(fromFile, 'utf8') : deps.stdinText ?? '').trim();
  const text = body ? `${subject}\n\n${body}\n` : `${subject}\n`;
  const file = proposalPath(root, 'commit');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  delete cycle.approvals.commit;
  saveState(root, state);
  out(io, `proposed commit message, ${path.relative(root, file).replace(/\\/g, '/')}:`);
  for (const l of text.trimEnd().split('\n')) out(io, `  ${l}`);
  out(io, 'waiting for the human to review it and run: unslopped approve commit');
  return 0;
}

function cmdCommit(io: Writer, root: string): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  const file = proposalPath(root, 'commit');
  if (!fs.existsSync(file)) return fail(io, 'nothing proposed. run: unslopped propose commit "<type(scope): subject>" [--file=<body.md>]');
  const text = fs.readFileSync(file, 'utf8');
  const a = cycle.approvals.commit;
  if (!a) return fail(io, 'the human has not approved this message yet. ask them to run: unslopped approve commit');
  if (a.hash !== textHash(text)) return fail(io, 'the proposal changed after approval. ask the human to review it again with: unslopped approve commit');
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const r = runCommand(`git commit -F "${rel}"`, root);
  if (r.code !== 0) {
    out(io, digest(redactSecrets(r.output).text, { lines: config.tokens.outputLines }).text);
    return fail(io, `git commit exited ${r.code}`);
  }
  delete cycle.approvals.commit;
  saveState(root, state);
  fs.unlinkSync(file);
  out(io, `committed: ${text.split('\n')[0]}`);
  return 0;
}

function cmdRollback(io: Writer, root: string): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const cmd = config.commands.rollback;
  if (!cmd) return fail(io, `commands.rollback is not set in ${CONFIG_FILE}`);
  out(io, `running rollback: ${cmd}`);
  const r = runCommand(cmd, root);
  out(io, redactSecrets(r.output).text.trimEnd());
  out(io, `rollback ${r.code === 0 ? 'ok' : `FAILED (exit ${r.code})`} in ${r.ms}ms`);
  const state = loadState(root);
  if (state.cycle) {
    state.cycle.history.push({ phase: state.cycle.phase, at: new Date().toISOString(), pass: r.code === 0, advanced: false, checks: [{ name: 'rollback', ok: r.code === 0, detail: `${cmd} (exit ${r.code}, ${r.ms}ms)` }] });
    saveState(root, state);
  }
  return r.code === 0 ? 0 : 1;
}

function cmdLog(io: Writer, root: string): number {
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  if (cycle.history.length === 0) {
    out(io, 'no gate runs yet');
    return 0;
  }
  for (const h of cycle.history) {
    out(io, `${h.at}  ${h.phase.padEnd(8)} ${h.pass ? 'pass' : 'FAIL'}${h.advanced ? '  advanced' : ''}`);
    for (const c of h.checks) if (!c.ok) out(io, `    ${c.name}: ${c.detail.split('\n')[0]}`);
  }
  return 0;
}

async function cmdTracker(io: Writer, root: string, flags: Flags, deps: Deps): Promise<number> {
  let config = requireConfig(io, root);
  if (!config) return 2;
  let t = mergeTracker(config.tracker);
  if (!t.provider) {
    const detected = detectTracker(root, deps.env);
    if (!detected.provider) {
      out(io, 'provider     (none detected)');
      out(io, `nothing in env vars, project files, git remote or MCP configs points at a tracker. set tracker.provider in ${CONFIG_FILE} to one of: ${PROVIDERS.join(', ')}`);
      return 0;
    }
    t = mergeTracker(applyDetection(t, detected));
    out(io, `provider     ${t.provider} (detected, not saved. start saves it)`);
    for (const e of detected.evidence) out(io, `evidence     ${e}`);
  } else {
    out(io, `provider     ${t.provider}`);
  }
  out(io, `comments     ${t.comments}`);
  out(io, `transitions  ${JSON.stringify(t.transitions)}`);
  const env = discoverSecrets({ tracker: t }, deps.env, root);
  config = { ...config, tracker: t };
  let missing = 0;
  for (const [name, value] of requiredSettings(t, env)) {
    out(io, `${value ? 'ok  ' : 'MISSING'} ${name}`);
    if (!value) missing++;
  }
  if (missing) return 1;
  const ref = str(flags.issue);
  if (!ref) return 0;
  try {
    const tracker = createTracker(config, env, deps.fetchImpl);
    if (!tracker) return 0;
    const issue = await tracker.fetchIssue(ref);
    out(io, `issue        ${issue.key}  ${issue.title}`);
    if (issue.url) out(io, `url          ${issue.url}`);
    if (issue.state) out(io, `state        ${issue.state}`);
    return 0;
  } catch (e) {
    return fail(io, (e as Error).message);
  }
}

async function cmdReset(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): Promise<number> {
  const config = loadConfig(root);
  const state = loadState(root);
  const cycle = requireCycle(io, state);
  if (!cycle) return 2;
  archiveCycle(root, cycle, 'abandoned');
  saveState(root, { cycle: null });
  out(io, `abandoned cycle ${cycle.id}. archived to .unslopped/cycles/${cycle.id}.json`);
  if (cycle.worktree) out(io, `worktree ${cycle.worktree} kept. remove it with: git worktree remove ${JSON.stringify(cycle.worktree)}`);
  if (config?.memory.skills) {
    const learned = learnFromCycle(root, deps.home, cycle, 'abandoned');
    if (learned.action !== 'none') out(io, `skill ${learned.name} marked abandoned (${learned.health})`);
  }
  if (config && cycle.issue) await notifyTracker({ config, cycle, event: { type: 'abandoned' }, io, env: discoverSecrets(config, deps.env, root), fetchImpl: deps.fetchImpl });
  if (args.length || flags.issue || flags['from-debt']) {
    out(io);
    return cmdStart(io, root, args, flags, deps);
  }
  return 0;
}

function cmdResume(io: Writer, root: string): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  if (!requireCycle(io, state)) return 2;
  for (const line of resumeLines(root, config, state)) out(io, line);
  return 0;
}

function cmdSkills(io: Writer, root: string, flags: Flags, deps: Deps): number {
  const skills = listSkills(root, deps.home);
  if (flags.json) {
    out(io, JSON.stringify(skills.map(({ body, ...s }) => ({ ...s, health: health(s) })), null, 2));
    return 0;
  }
  if (!skills.length) {
    out(io, 'no skills yet. Unslopped saves one from every completed cycle.');
    return 0;
  }
  for (const s of skills) out(io, `${s.name.padEnd(42)} ${health(s).padEnd(16)} runs ${String(s.runs).padStart(3)}  failures ${String(s.gateFailures).padStart(3)}  ${s.scope}`);
  return 0;
}

function cmdSkill(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): number {
  const [action, ...rest] = args;
  if (action === 'show') {
    const s = loadSkill(root, deps.home, rest[0] ?? '');
    if (!s) return fail(io, `no skill named "${rest[0] ?? ''}"`);
    io.write(fs.readFileSync(s.file, 'utf8'));
    return 0;
  }
  if (action === 'save') {
    const title = rest.join(' ').trim();
    if (!title) return fail(io, 'usage: unslopped skill save "<title>" [--file=notes.md] [--global]');
    const file = str(flags.file);
    const body = file ? fs.readFileSync(file, 'utf8') : deps.stdinText ?? readStdinText();
    const r = saveSkill(flags.global ? globalSkillsDir(deps.home) : skillsDir(root), title, body);
    out(io, `saved skill ${r.name}: ${r.file}`);
    return 0;
  }
  if (action === 'rm') {
    const s = loadSkill(root, deps.home, rest[0] ?? '');
    if (!s) return fail(io, `no skill named "${rest[0] ?? ''}"`);
    fs.unlinkSync(s.file);
    out(io, `removed ${s.file}`);
    return 0;
  }
  return fail(io, 'usage: unslopped skill show|save|rm');
}

function cmdDebt(io: Writer, root: string, args: string[], flags: Flags): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const what = args.join(' ').trim();
  if (!what) {
    const entries = listDebt(root);
    if (!entries.length) {
      out(io, 'no debt logged. when you spot a deviation you are not fixing here: unslopped debt "<what>" --where=<path> --category=cleanup|pattern|soon|accepted');
      return 0;
    }
    for (const c of DEBT_CATEGORIES) {
      const rows = entries.filter((e) => e.category === c);
      if (!rows.length) continue;
      out(io, `${c} (${rows.length})`);
      for (const r of rows) out(io, `  - ${r.text}`);
    }
    return 0;
  }
  const category = (str(flags.category) ?? 'cleanup') as DebtCategory;
  if (!DEBT_CATEGORIES.includes(category)) return fail(io, `unknown category "${category}". valid: ${DEBT_CATEGORIES.join(', ')}`);
  const cycle = loadState(root).cycle;
  const line = addDebt(root, category, what, str(flags.where), cycle?.id ?? null);
  out(io, `logged: ${line}`);
  out(io, 'commit .unslopped/DEBT.md with the cycle so the log travels with the code');
  return 0;
}

function cmdDecide(io: Writer, root: string, args: string[]): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const title = args.join(' ').trim();
  if (!title) {
    const decisions = listDecisions(root);
    if (!decisions.length) {
      out(io, 'no decisions recorded. when a choice others must follow is made: unslopped decide "<title>"');
      return 0;
    }
    for (const d of decisions) out(io, `${String(d.number).padStart(4, '0')}  ${d.status.padEnd(10)} ${d.title}  (${d.file})`);
    return 0;
  }
  const cycle = loadState(root).cycle;
  const r = createDecision(root, title, cycle?.id ?? null);
  out(io, `wrote ${r.file}`);
  out(io, 'fill in Context, Decision, Options considered (real ones, with why they lost) and Consequences, then commit it. the code map indexes it, so unslopped graph why will find it');
  return 0;
}

function cmdPrefer(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): number {
  const statement = args.join(' ').trim();
  if (!statement) return fail(io, 'usage: unslopped prefer "<statement>" [--project]');
  const file = flags.project ? profilePath(root) : globalProfilePath(deps.home);
  const added = addPreference(file, statement);
  out(io, added ? `remembered (${flags.project ? 'project' : 'global'}): ${statement}` : `already remembered: ${statement}`);
  return 0;
}

function cmdProfile(io: Writer, root: string, deps: Deps): number {
  refreshDetected(root);
  const lines = readProfile(root, deps.home);
  if (!lines.length) {
    out(io, 'no preferences yet. add one with: unslopped prefer "<statement>"');
    return 0;
  }
  for (const l of lines) out(io, l);
  return 0;
}

function cmdTokens(io: Writer, root: string, flags: Flags): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  const archived = archivedCycles(root);
  const all = summarize([...archived, ...(state.cycle ? [state.cycle] : [])]);
  if (flags.json) {
    out(io, JSON.stringify({ active: state.cycle ? { id: state.cycle.id, tokens: state.cycle.tokens ?? {} } : null, archivedCycles: archived.length, total: all }, null, 2));
    return 0;
  }
  out(io, `mode ${config.tokens.mode}, ${config.tokens.outputLines} digest lines, pointer files ${config.tokens.pointerFiles ? 'on' : 'off'}. token counts are estimates (chars / 4).`);
  out(io);
  if (state.cycle) for (const l of reportLines(`active cycle ${state.cycle.id}`, state.cycle.tokens)) out(io, l);
  else out(io, 'no active cycle');
  out(io);
  for (const l of reportLines(`all cycles (${archived.length} archived${state.cycle ? ' + active' : ''})`, all)) out(io, l);
  return 0;
}

function cmdGraph(io: Writer, root: string, args: string[], flags: Flags): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  if (!config.graph.enabled) {
    out(io, 'code map is disabled (graph.enabled is false)');
    return 0;
  }
  if (args[0] === 'refresh') {
    const r = refreshGraph(root, config.graph);
    if (!flags.quiet) out(io, `code map: ${r.scanned} files scanned, ${r.changed} re-read, ${r.removed} removed, ${r.ms}ms`);
    return 0;
  }
  const graph = ensureGraph(root, config.graph) ?? loadGraph(root);
  if (!graph) return fail(io, 'no code map yet');
  const resolve = (q: string): string | null => {
    const found = findFile(graph, q);
    if (found.length === 1) return found[0];
    if (!found.length) fail(io, `no file in the code map matches "${q}"`);
    else fail(io, `"${q}" matches ${found.length} files, be more specific:\n${found.slice(0, 8).map((f) => `  ${f}`).join('\n')}`);
    return null;
  };
  if (args[0] === 'node') {
    if (!args[1]) return fail(io, 'usage: unslopped graph node <file>');
    const file = resolve(args[1]);
    if (!file) return 2;
    const v = nodeView(graph, file);
    if (!v) return fail(io, `no file in the code map matches "${args[1]}"`);
    if (flags.json) out(io, JSON.stringify(v, null, 2));
    else for (const l of formatNode(v)) out(io, l);
    return 0;
  }
  if (args[0] === 'path') {
    if (!args[1] || !args[2]) return fail(io, 'usage: unslopped graph path <from> <to>');
    const from = resolve(args[1]);
    if (!from) return 2;
    const to = resolve(args[2]);
    if (!to) return 2;
    const p = shortestPath(graph, from, to);
    if (!p) {
      out(io, `${from} and ${to} are not connected by imports`);
      return 1;
    }
    if (flags.json) out(io, JSON.stringify(p, null, 2));
    else for (const l of formatPath(graph, p)) out(io, l);
    return 0;
  }
  if (args[0] === 'why') {
    const topic = args.slice(1).join(' ').trim();
    if (!topic) return fail(io, 'usage: unslopped graph why "<topic>"');
    const hits = queryRationale(graph, topic, Number(flags.limit) || 8);
    if (flags.json) out(io, JSON.stringify(hits, null, 2));
    else if (!hits.length) out(io, 'no rationale, constraint or debt marker matches. comments that say because, so that, to avoid, must, never, TODO or FIXME are what this reads');
    else for (const h of hits) out(io, `${h.file}:${h.line} [${h.kind}] ${h.text}`);
    return 0;
  }
  if (args[0] === 'impact') {
    const state = loadState(root);
    const since = str(flags.since) ?? state.cycle?.startCommit ?? null;
    let changed = localChanges(root, since);
    const explicit = args.slice(1);
    if (explicit.length) changed = new Map(explicit.map((f) => [f.replace(/\\/g, '/'), []]));
    if (!changed.size) {
      out(io, `no changes ${since ? `since ${since.slice(0, 7)}` : 'in the working tree'}`);
      return 0;
    }
    const impact = computeImpact(graph, changed, config.practices.testPatterns);
    if (flags.json) out(io, JSON.stringify(impact, null, 2));
    else for (const l of formatImpact(impact)) out(io, l);
    return 0;
  }
  if (args[0] === 'report') {
    const file = writeReport(root, graph);
    out(io, `wrote ${path.relative(root, file).replace(/\\/g, '/')}`);
    return 0;
  }
  if (args[0] === 'html') {
    const file = writeHtml(root, graph);
    out(io, `wrote ${path.relative(root, file).replace(/\\/g, '/')}. open it in a browser`);
    return 0;
  }
  const query = args.join(' ').trim();
  if (!query) {
    io.write(fullReport(graph));
    return 0;
  }
  const hits = queryGraph(graph, query, Number(flags.limit) || 5);
  if (flags.json) {
    out(io, JSON.stringify(hits, null, 2));
    return 0;
  }
  if (!hits.length) {
    out(io, 'nothing in the code map matches. try other words or a symbol name');
    return 0;
  }
  for (const l of formatHits(hits)) out(io, l);
  return 0;
}

function cmdMetrics(io: Writer, root: string, flags: Flags): number {
  const config = requireConfig(io, root);
  if (!config) return 2;
  const state = loadState(root);
  const cycles = [...archivedCycles(root), ...(state.cycle ? [state.cycle] : [])];
  const m = computeMetrics(cycles);
  if (flags.json) {
    out(io, JSON.stringify(m, null, 2));
    return 0;
  }
  if (!cycles.length) {
    out(io, 'no cycles yet. metrics appear after the first unslopped cycle.');
    return 0;
  }
  for (const l of metricsLines(m)) out(io, l);
  return 0;
}

function cmdRecall(io: Writer, root: string, args: string[], flags: Flags, deps: Deps): number {
  const query = args.join(' ').trim();
  if (!query) return fail(io, 'usage: unslopped recall "<words>" [--limit=5] [--json]');
  const limit = Number(flags.limit) || 5;
  const results = recall(root, deps.home, query, limit);
  if (flags.json) {
    out(io, JSON.stringify(results, null, 2));
    return 0;
  }
  if (!results.length) {
    out(io, 'nothing matched');
    return 0;
  }
  for (const r of results) {
    out(io, `${r.kind.padEnd(10)} ${r.score.toFixed(2).padStart(6)}  ${r.id}${r.when ? `  ${r.when}` : ''}`);
    out(io, `           ${r.snippet}`);
    if (r.file) out(io, `           ${r.file}`);
  }
  return 0;
}

export async function main(argv: string[], root: string, io: Writer = process.stdout, deps: Partial<Deps> = {}): Promise<number> {
  const { command, args, flags } = parse(argv);
  const env = deps.env ?? process.env;
  const d: Deps = {
    env,
    fetchImpl: deps.fetchImpl ?? (globalThis.fetch as Deps['fetchImpl']),
    home: deps.home ?? env.UNSLOPPED_HOME ?? os.homedir(),
    stderr: deps.stderr ?? process.stderr,
    stdin: deps.stdin,
    stdinText: deps.stdinText,
  };
  try {
    switch (command) {
      case 'install':
        return cmdInstall(io, flags, d, false);
      case 'uninstall':
        return cmdInstall(io, flags, d, true);
      case 'hook':
        return cmdHook(io, root, args, d);
      case 'init':
        return cmdInit(io, root, flags, d);
      case 'status':
        return cmdStatus(io, root, flags);
      case 'start':
        return await cmdStart(io, root, args, flags, d);
      case 'check':
        return await gate(io, root, flags, false, d);
      case 'next':
        return await gate(io, root, flags, true, d);
      case 'approve':
        return cmdApprove(io, root, args);
      case 'propose':
        return cmdPropose(io, root, args, flags, d);
      case 'commit':
        return cmdCommit(io, root);
      case 'red':
        return cmdRed(io, root);
      case 'review':
        return await cmdReview(io, root, flags, d);
      case 'pr':
        return await cmdPr(io, root, args, flags, d);
      case 'rollback':
        return cmdRollback(io, root);
      case 'log':
        return cmdLog(io, root);
      case 'tracker':
        return await cmdTracker(io, root, flags, d);
      case 'reset':
        return await cmdReset(io, root, args, flags, d);
      case 'resume':
      case 'continue':
        return cmdResume(io, root);
      case 'skills':
        return cmdSkills(io, root, flags, d);
      case 'skill':
        return cmdSkill(io, root, args, flags, d);
      case 'debt':
        return cmdDebt(io, root, args, flags);
      case 'decide':
        return cmdDecide(io, root, args);
      case 'prefer':
        return cmdPrefer(io, root, args, flags, d);
      case 'profile':
        return cmdProfile(io, root, d);
      case 'recall':
        return cmdRecall(io, root, args, flags, d);
      case 'tokens':
        return cmdTokens(io, root, flags);
      case 'metrics':
        return cmdMetrics(io, root, flags);
      case 'graph':
        return cmdGraph(io, root, args, flags);
      case 'help':
      case '--help':
      case '-h':
        out(io, HELP);
        return 0;
      default:
        out(io, HELP);
        return fail(io, `unknown command: ${command}`);
    }
  } catch (e) {
    return fail(io, (e as Error).message);
  }
}
